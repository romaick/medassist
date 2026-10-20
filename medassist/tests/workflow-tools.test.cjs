"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../app/core.js");
const { createRepository, KEY } = require("../app/storage.js");
const NOW = "2032-04-19T09:00:00.000Z";
const LATER = "2032-04-23T09:00:00.000Z";
const LAST = "2032-04-27T09:00:00.000Z";
function patient() { return core.createPatient({ id: "fictional-patient", label: "Вымышленный Пациент", now: NOW }); }
function encounter(id = "visit-1", now = NOW) { return core.createEncounter({ id, patientId: "fictional-patient", now }); }
function freeze(value) {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function issue() {
  return core.applyEncounterSickLeave(patient(), encounter(), { type: "issue", id: "leave-1", eventId: "event-1", number: "ДЕМО-101", from: "2032-04-19", to: "2032-04-23", now: NOW });
}
function extended() {
  const first = issue();
  const next = core.applyEncounterSickLeave(first.patient, encounter("visit-2", LATER), { type: "extend", leaveId: "leave-1", eventId: "event-2", from: "2032-04-23", to: "2032-04-27", now: LATER }, [first.encounter]);
  return { ...next, first: first.encounter };
}
function bundle(card, encounters, templates) { return JSON.parse(core.serializeBundle(encounters, [card], templates)); }
function template(kind = "exam", id = "template-1") {
  const source = encounter();
  source.exam.general = "Вымышленный осмотр для шаблона.";
  source.assessment.plan = "Демонстрационные рекомендации.";
  return core.createVisitTemplate(source, { name: "Мой шаблон", kind, id, now: NOW });
}
function memoryStorage(raw = null) {
  return { raw, fail: false, getItem(key) { return key === KEY ? this.raw : null; }, setItem(key, value) { if (this.fail) throw new Error("Quota exceeded"); this.raw = value; } };
}

test("linked issuance updates an immutable pair and preserves the doctor's manual text", () => {
  const original = encounter();
  original.draft.text = "Текст врача";
  original.draft.sourceFingerprint = core.fingerprint(original);
  const reviewed = core.setReviewStatus(original, "reviewed", { now: NOW });
  const result = core.applyEncounterSickLeave(freeze(patient()), freeze(reviewed), { type: "issue", id: "leave-1", eventId: "event-1", number: "ДЕМО", from: "2032-04-19", to: "2032-04-23", now: LATER });
  assert.equal(Object.hasOwn(patient(), "sickLeaves"), false);
  assert.equal(reviewed.assessment.sickLeaveIssued, "");
  assert.equal(result.patient.updatedAt, LATER);
  assert.equal(result.encounter.updatedAt, LATER);
  assert.equal(result.encounter.workflow.reviewStatus, "draft");
  assert.equal(result.encounter.workflow.reviewedAt, "");
  assert.deepEqual(result.encounter.draft, original.draft);
  assert.equal(core.getEncounterSickLeaveAction(result.patient, result.encounter).event.encounterId, result.encounter.id);
  const restored = core.parseBundle(core.serializeBundle([result.encounter], [result.patient]));
  assert.deepEqual(restored.patients, [result.patient]);
  assert.deepEqual(restored.encounters, [result.encounter]);
  assert.equal(core.getSickLeaveJournal(result.patient, [result.encounter]).legacy.length, 0);
});

test("issue, extension and closure retain historical totals while the patient journal counts nine unique days", () => {
  const next = extended();
  const closed = core.applyEncounterSickLeave(freeze(next.patient), freeze(encounter("visit-3", LAST)), { type: "close", leaveId: "leave-1", date: "2032-04-27", eventId: "event-3", now: LAST }, [next.first, next.encounter]);
  const entries = [next.first, next.encounter, closed.encounter];
  assert.equal(core.getEncounterSickLeaveSummary(entries[0], closed.patient, entries).totalDays, 5);
  assert.deepEqual(core.getEncounterSickLeaveSummary(entries[1], closed.patient, entries), { periodDays: 5, totalDays: 9, from: "2032-04-19", to: "2032-04-27", unnumbered: false, hasPrevious: true });
  assert.equal(core.getEncounterSickLeaveSummary(entries[2], closed.patient, entries).periodDays, 0);
  assert.equal(core.getEncounterSickLeaveSummary(entries[2], closed.patient, entries).totalDays, 9);
  const journal = core.getSickLeaveJournal(closed.patient, entries);
  assert.equal(journal.totalDays, 9);
  assert.equal(journal.leaves[0].status, "closed");
  assert.deepEqual(journal.legacy, []);
  assert.doesNotThrow(() => core.serializeBundle(entries, [closed.patient]));
});

test("explicit leave selection separates identical numbers and preserves gaps in totals", () => {
  const first = issue();
  const other = core.issueSickLeave(first.patient, { id: "other-leave", number: "ДЕМО-101", from: "2032-04-01", to: "2032-04-18", now: NOW });
  const next = core.applyEncounterSickLeave(other, encounter("visit-2", LATER), { type: "extend", leaveId: "leave-1", from: "2032-04-25", to: "2032-04-27", now: LATER }, [first.encounter]);
  const summary = core.getEncounterSickLeaveSummary(next.encounter, next.patient, [first.encounter, next.encounter]);
  assert.equal(summary.periodDays, 3);
  assert.equal(summary.totalDays, 8);
  const closed = core.applyEncounterSickLeave(next.patient, encounter("visit-3", LAST), { type: "close", leaveId: "leave-1", date: "2032-04-25", now: LAST }, [first.encounter, next.encounter]);
  assert.equal(core.getEncounterSickLeaveSummary(closed.encounter, closed.patient).totalDays, 6);
  assert.equal(core.getEncounterSickLeaveSummary(next.encounter, closed.patient).totalDays, 8);
});

test("linked drafts describe each action and keep the repeat appointment as the final line", () => {
  const next = extended();
  next.encounter.assessment.returnVisitDate = "2032-04-29";
  const context = { patient: next.patient, encounters: [next.first, next.encounter] };
  assert.match(core.generateDraft(next.first, context), /Листок нетрудоспособности: выдан\./);
  const draft = core.generateDraft(next.encounter, context);
  assert.match(draft, /Листок нетрудоспособности: продлён\./);
  assert.match(draft, /за текущий период: 5\./);
  assert.match(draft, /Всего по этому больничному: 9 календарных дней\./);
  assert.equal(draft.split("\n").at(-1), "Повторный приём: 29.04.2032");
  const closed = core.applyEncounterSickLeave(next.patient, encounter("visit-3", LAST), { type: "close", leaveId: "leave-1", date: "2032-04-27", now: LAST }, context.encounters);
  assert.match(core.generateDraft(closed.encounter, { patient: closed.patient, encounters: [...context.encounters, closed.encounter] }), /закрыт\..*Дата закрытия: 27\.04\.2032\..*9 календарных дней/);
  assert.notEqual(core.fingerprint(next.encounter, context), core.fingerprint(next.encounter));
  assert.equal(core.fingerprint(next.first, context), core.fingerprint(next.first, { patient: issue().patient, encounters: [next.first] }));
});

test("a prior legacy visit can be adopted and extended atomically without duplicate legacy counting", () => {
  const source = encounter();
  Object.assign(source.assessment, { sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-101", sickLeaveFrom: "2032-04-19", sickLeaveTo: "2032-04-23" });
  const sourceCopy = structuredClone(source);
  const next = core.applyEncounterSickLeave(freeze(patient()), freeze(encounter("visit-2", LATER)), { type: "extend", sourceEncounterId: source.id, id: "adopted-leave", from: "2032-04-23", to: "2032-04-27", now: LATER }, [freeze(source)]);
  assert.deepEqual(source, sourceCopy);
  assert.equal(next.patient.sickLeaves[0].sourceEncounterId, source.id);
  assert.equal(Object.hasOwn(next.patient.sickLeaves[0].events[0], "encounterId"), false);
  assert.equal(next.patient.sickLeaves[0].events[1].encounterId, next.encounter.id);
  assert.equal(core.getSickLeaveJournal(next.patient, [source, next.encounter]).totalDays, 9);
  assert.deepEqual(core.getSickLeaveJournal(next.patient, [source, next.encounter]).legacy, []);
  assert.doesNotThrow(() => core.serializeBundle([source, next.encounter], [next.patient]));
  const empty = freeze(patient());
  assert.throws(() => core.applyEncounterSickLeave(empty, encounter("visit-2", LATER), { type: "extend", sourceEncounterId: source.id, from: "2032-04-20", to: "2032-04-21" }, [source]), /увеличивать/);
  assert.equal(Object.hasOwn(empty, "sickLeaves"), false);
});

test("atomic adoption rejects future, foreign, missing, already adopted and self sources", () => {
  const source = encounter();
  Object.assign(source.assessment, { sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-101", sickLeaveFrom: "2032-04-19", sickLeaveTo: "2032-04-23" });
  const options = { type: "extend", sourceEncounterId: source.id, from: "2032-04-23", to: "2032-04-27", now: LATER };
  assert.throws(() => core.applyEncounterSickLeave(patient(), encounter("visit-2", NOW), options, [{ ...source, visitDate: "2032-04-20" }]), /предыдущем/);
  assert.throws(() => core.applyEncounterSickLeave(patient(), encounter("visit-2", LATER), options, [{ ...source, patientId: "other-patient" }]), /предыдущем/);
  assert.throws(() => core.applyEncounterSickLeave(patient(), encounter("visit-2", LATER), options), /предыдущем/);
  assert.throws(() => core.applyEncounterSickLeave(patient(), source, options, [source]), /предыдущем/);
  const adopted = core.issueSickLeave(patient(), { number: "ДЕМО-101", from: "2032-04-19", to: "2032-04-23", sourceEncounterId: source.id, now: NOW }, [source]);
  assert.throws(() => core.applyEncounterSickLeave(adopted, encounter("visit-2", LATER), options, [source]), /уже перенесён/);
});

test("one linked action per encounter rejects duplicate submission without modifying either original", () => {
  const first = freeze(issue());
  assert.throws(() => core.applyEncounterSickLeave(first.patient, first.encounter, { type: "issue", number: "ДЕМО", from: "2032-04-19", to: "2032-04-23", now: NOW }), /уже сохранено/);
  assert.throws(() => core.applyEncounterSickLeave(first.patient, encounter("visit-2", LATER), { type: "extend", leaveId: "leave-1", sourceEncounterId: "visit-1", from: "2032-04-23", to: "2032-04-27" }, [first.encounter]), /один/);
  assert.throws(() => core.applyEncounterSickLeave(first.patient, encounter("visit-2", LATER), { type: "extend", leaveId: "leave-1", number: "new", from: "2032-04-23", to: "2032-04-27" }, [first.encounter]), /сохранённый номер/);
  assert.equal(first.patient.sickLeaves[0].events.length, 1);
});

test("appending cannot precede a linked visit and requires a visit date without imposing period-date rules", () => {
  const next = freeze(extended());
  const earlier = freeze(encounter("earlier", NOW));
  const before = JSON.stringify(next);
  assert.throws(() => core.applyEncounterSickLeave(next.patient, earlier, { type: "extend", leaveId: "leave-1", from: "2032-04-27", to: "2032-04-29" }, [next.first, next.encounter]), /более позднего приёма/);
  assert.throws(() => core.applyEncounterSickLeave(next.patient, earlier, { type: "close", leaveId: "leave-1", date: "2032-04-27" }, [next.first, next.encounter]), /более позднего приёма/);
  assert.equal(JSON.stringify(next), before);
  assert.equal(earlier.assessment.sickLeaveIssued, "");
  const undated = { ...encounter("undated"), visitDate: "" };
  assert.throws(() => core.applyEncounterSickLeave(patient(), undated, { type: "issue", number: "ДЕМО", from: "2032-04-19", to: "2032-04-23" }), /Укажите дату приёма/);
  const futurePeriod = core.applyEncounterSickLeave(patient(), encounter(), { type: "issue", id: "future-leave", number: "ДЕМО", from: "2032-05-01", to: "2032-05-05", now: NOW });
  assert.doesNotThrow(() => core.applyEncounterSickLeave(futurePeriod.patient, encounter("visit-2", LATER), { type: "extend", leaveId: "future-leave", from: "2032-05-05", to: "2032-05-09", now: LATER }, [futurePeriod.encounter]));
});

test("linked undo only permits the latest action, clears its fields and leaves the manual draft intact", () => {
  const next = extended();
  next.encounter.draft.text = "Ручной черновик врача";
  next.encounter.draft.sourceFingerprint = core.fingerprint(next.encounter, { patient: next.patient, encounters: [next.first, next.encounter] });
  const reviewed = core.setReviewStatus(next.encounter, "reviewed", { now: LAST });
  assert.throws(() => core.undoEncounterSickLeave(next.patient, next.first, [next.first, reviewed]), /более поздние/);
  assert.throws(() => core.undoSickLeaveAction(next.patient, "leave-1"), /Откройте этот приём/);
  const result = core.undoEncounterSickLeave(freeze(next.patient), freeze(reviewed), [next.first, reviewed]);
  assert.equal(result.patient.sickLeaves[0].events.length, 1);
  for (const field of ["sickLeaveIssued", "sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"]) assert.equal(result.encounter.assessment[field], "");
  assert.equal(result.encounter.workflow.reviewStatus, "draft");
  assert.deepEqual(result.encounter.draft, reviewed.draft);
  assert.notEqual(result.encounter.draft.sourceFingerprint, core.fingerprint(result.encounter, { patient: result.patient, encounters: [next.first, result.encounter] }));
  assert.doesNotThrow(() => core.serializeBundle([next.first, result.encounter], [result.patient]));
  const removed = core.undoEncounterSickLeave(result.patient, next.first, [next.first, result.encounter]);
  assert.equal(Object.hasOwn(removed.patient, "sickLeaves"), false);
});

test("backup validation rejects broken, duplicate, cross-patient and mismatched linked snapshots", () => {
  const next = extended();
  const valid = bundle(next.patient, [next.first, next.encounter]);
  const variants = [
    data => { data.encounters.pop(); },
    data => { data.patients.push(core.createPatient({ id: "other-patient", now: NOW })); data.encounters[1].patientId = "other-patient"; },
    data => { data.patients[0].sickLeaves[0].events[1].encounterId = data.encounters[0].id; },
    data => { data.patients[0].sickLeaves[0].events[1].encounterId = ""; },
    data => { data.patients[0].sickLeaves[0].events[1].encounterId = 1; },
    data => { data.encounters[1].assessment.sickLeaveTo = "2032-04-28"; },
    data => { data.encounters[1].assessment.sickLeaveIssued = "no"; },
    data => { data.patients[0].sickLeaves[0].number = "edited"; },
    data => { data.patients[0].sickLeaves[0].events[1].unexpected = "value"; }
  ];
  for (const mutate of variants) {
    const changed = structuredClone(valid);
    mutate(changed);
    assert.throws(() => core.validateBundle(changed));
  }
  const detached = core.validateBundle(freeze(valid));
  detached.patients[0].sickLeaves[0].events[0].encounterId = "changed";
  assert.equal(valid.patients[0].sickLeaves[0].events[0].encounterId, "visit-1");
});

test("legacy adoption and an explicit linked issuance may share exactly their own source", () => {
  const source = encounter();
  Object.assign(source.assessment, { sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-101", sickLeaveFrom: "2032-04-19", sickLeaveTo: "2032-04-23" });
  const adopted = core.issueSickLeave(patient(), { id: "leave-1", number: "ДЕМО-101", from: "2032-04-19", to: "2032-04-23", sourceEncounterId: source.id, now: NOW }, [source]);
  const linked = core.applyEncounterSickLeave(adopted, source, { type: "issue", number: "ДЕМО-101", from: "2032-04-19", to: "2032-04-23", now: NOW }, [source]);
  assert.equal(linked.patient.sickLeaves.length, 1);
  assert.doesNotThrow(() => core.serializeBundle([linked.encounter], [linked.patient]));
  assert.throws(() => core.issueSickLeave(linked.patient, { number: "ДЕМО-101", from: "2032-04-19", to: "2032-04-23", sourceEncounterId: source.id }, [linked.encounter]), /уже связан/);
});

test("templates contain only the selected section and cannot carry patient, history, diagnosis or vital data", () => {
  const source = encounter();
  source.exam.general = "Текст осмотра";
  source.assessment.plan = "Текст рекомендаций";
  source.assessment.summary = "Чужой диагноз";
  source.history.medications = "Чужой препарат";
  source.vitals.pulse = "78";
  const exam = core.createVisitTemplate(freeze(source), { name: "  Осмотр  ", kind: "exam", id: "exam-template", now: NOW });
  assert.equal(exam.name, "Осмотр");
  assert.deepEqual(Object.keys(exam.content), ["exam", "examSelections"]);
  assert.deepEqual(core.createVisitTemplate(source, { name: "План", kind: "recommendations", now: NOW }).content, { plan: "Текст рекомендаций" });
  const target = encounter("target");
  target.history.allergies = "Демонстрационная аллергия";
  target.assessment.summary = "Собственный диагноз";
  target.assessment.plan = "Собственные рекомендации";
  target.vitals.pulse = "88";
  target.draft.text = "Ручная запись";
  const reviewed = core.setReviewStatus(target, "reviewed", { now: NOW });
  const applied = core.applyVisitTemplate(freeze(reviewed), freeze(exam));
  assert.deepEqual(applied.exam, source.exam);
  assert.deepEqual(applied.examSelections, source.examSelections);
  assert.deepEqual(applied.history, target.history);
  assert.deepEqual(applied.assessment, target.assessment);
  assert.deepEqual(applied.vitals, target.vitals);
  assert.deepEqual(applied.draft, target.draft);
  assert.equal(applied.id, target.id);
  assert.equal(applied.workflow.reviewStatus, "draft");
  applied.exam.general = "Отдельное изменение";
  assert.equal(exam.content.exam.general, "Текст осмотра");
});

test("recommendation templates replace only the recommendation field and preserve all other sections", () => {
  const saved = template("recommendations");
  const target = encounter("target");
  target.assessment.summary = "Исходный диагноз";
  target.assessment.returnVisitDate = "2032-05-01";
  target.exam.general = "Исходный осмотр";
  target.draft.text = "Не перезаписывать";
  const applied = core.applyVisitTemplate(freeze(target), freeze(saved));
  assert.equal(applied.assessment.plan, saved.content.plan);
  assert.equal(applied.assessment.summary, target.assessment.summary);
  assert.equal(applied.assessment.returnVisitDate, target.assessment.returnVisitDate);
  assert.deepEqual(applied.exam, target.exam);
  assert.deepEqual(applied.draft, target.draft);
});

test("empty, malformed, oversized and unrestricted templates are rejected before saving or applying", () => {
  for (const kind of ["exam", "recommendations"]) assert.throws(() => core.createVisitTemplate(encounter(), { name: "Пустой", kind }), /пустом разделе/);
  const valid = template();
  for (const mutate of [
    item => { item.name = " "; }, item => { item.name = "a".repeat(121); }, item => { item.kind = "history"; },
    item => { item.id = "../bad"; }, item => { item.updatedAt = "2032-02-30T00:00:00.000Z"; },
    item => { item.content.history = {}; }, item => { item.content.exam.patient = "unwanted"; },
    item => { item.content.exam.general = "a".repeat(core.MAX_TEXT_LENGTH + 1); },
    item => { item.content.examSelections[Object.keys(item.content.examSelections)[0]] = "not-an-option"; },
    item => { item.content = null; }, item => { delete item.createdAt; }, item => { item.patientId = "forbidden"; }
  ]) {
    const item = structuredClone(valid);
    mutate(item);
    assert.throws(() => core.validateTemplates([item]));
    assert.throws(() => core.applyVisitTemplate(encounter(), item));
  }
  for (const value of [null, {}, [null], Array(1), [valid, valid], Array.from({ length: 101 }, (_, index) => ({ ...valid, id: "template-" + index }))]) assert.throws(() => core.validateTemplates(value));
});

test("optional templates round-trip in schema four while empty and historical bundles keep their shapes", () => {
  const saved = [template(), template("recommendations", "template-2")];
  const old = bundle(patient(), [encounter()]);
  assert.equal(Object.hasOwn(old, "templates"), false);
  assert.equal(Object.hasOwn(bundle(patient(), [encounter()], []), "templates"), false);
  const restored = core.parseBundle(core.serializeBundle([encounter()], [patient()], freeze(saved)));
  assert.equal(restored.schemaVersion, 4);
  assert.deepEqual(restored.templates, saved);
  restored.templates[0].content.exam.general = "Changed";
  assert.notEqual(saved[0].content.exam.general, "Changed");
  const historical = { ...old, schemaVersion: 3, encounters: old.encounters.map(({ workflow, ...entry }) => entry) };
  assert.equal(Object.hasOwn(core.parseBundle(JSON.stringify(historical)), "templates"), false);
  assert.throws(() => core.parseBundle(JSON.stringify({ ...historical, templates: saved })), /структура/);
});

test("ordinary saves preserve loaded templates, failed saves are atomic and reset explicitly clears them", () => {
  const saved = [template()];
  const storage = memoryStorage(core.serializeBundle([encounter()], [patient()], saved));
  const repository = createRepository(storage);
  const loaded = repository.load();
  assert.deepEqual(loaded.templates, saved);
  loaded.templates[0].name = "Unsaved UI change";
  assert.equal(repository.save([encounter()], [patient()]).ok, true);
  assert.deepEqual(core.parseBundle(storage.raw).templates, saved);
  const before = storage.raw;
  storage.fail = true;
  assert.equal(repository.save([encounter()], [patient()], [template("recommendations", "new-template")]).ok, false);
  assert.equal(storage.raw, before);
  storage.fail = false;
  assert.equal(repository.save([encounter()], [patient()]).ok, true);
  assert.deepEqual(core.parseBundle(storage.raw).templates, saved);
  assert.equal(repository.save([encounter()], [patient()], [{ ...saved[0], unexpected: "bad" }]).ok, false);
  assert.equal(repository.reset([], [], saved).ok, true);
  assert.deepEqual(repository.load().templates, saved);
  assert.equal(repository.reset().ok, true);
  assert.deepEqual(repository.load(), { patients: [], encounters: [], error: null });
});

test("linked journal and encounter commit is rejected atomically when one side is missing or edited", () => {
  const first = issue();
  const storage = memoryStorage(core.serializeBundle([first.encounter], [first.patient]));
  const repository = createRepository(storage);
  repository.load();
  const next = core.applyEncounterSickLeave(first.patient, encounter("visit-2", LATER), { type: "extend", leaveId: "leave-1", from: "2032-04-23", to: "2032-04-27", now: LATER }, [first.encounter]);
  const before = storage.raw;
  assert.equal(repository.save([first.encounter], [next.patient]).ok, false);
  assert.equal(storage.raw, before);
  const edited = structuredClone(next.encounter);
  edited.assessment.sickLeaveNumber = "Другой номер";
  assert.equal(repository.save([first.encounter, edited], [next.patient]).ok, false);
  assert.equal(storage.raw, before);
  assert.equal(repository.save([first.encounter, next.encounter], [next.patient]).ok, true);
});
