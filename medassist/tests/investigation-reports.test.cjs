"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../app/core.js");
const { createRepository, KEY } = require("../app/storage.js");
const NOW = "2032-04-19T09:00:00.000Z";
const LATER = "2032-04-23T09:00:00.000Z";
const META = ["reportId", "reportTitle", "panelId", "fieldId"];
function patient(id = "report-patient") { return core.createPatient({ id, label: "Вымышленный Пациент Бланков", now: NOW }); }
function visit(id = "report-visit", patientId = patient().id) {
  return core.createEncounter({ id, patientId, now: NOW });
}
function row(fieldId = "demo-a", overrides = {}) {
  return { fieldId, name: "Вымышленный показатель А", result: "12,5", unit: "усл. ед.", reference: "8–15 (вымышленный бланк)", note: "", ...overrides };
}
function report(overrides = {}) {
  return { panelId: "demo-lab", title: "Демонстрационный бланк", kind: "lab", date: "2032-04-19", rows: [row()], ...overrides };
}
function withReport(values = report()) { return core.upsertInvestigationReport(patient(), values, { now: NOW }); }
function legacyValue(overrides = {}) {
  return { kind: "study", date: "2032-04-19", name: "Вымышленное отдельное исследование", result: "Описание вручную", unit: "", reference: "", note: "", ...overrides };
}
function reviewed(encounter) {
  return core.setReviewStatus({ ...encounter, draft: { text: "Ручной текст врача", generatedAt: NOW, sourceFingerprint: "сохранённый отпечаток" } }, "reviewed", { now: NOW });
}
function freeze(value) {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function context(card, encounters = []) { return { patient: card, encounters }; }

test("blank panel rows are omitted, zero and original strings survive, and saves do not mutate inputs", () => {
  const original = freeze(patient());
  const values = freeze(report({ rows: [row("a", { result: " \n" }), row("b", { result: " 0 ", unit: " усл. ед. " }), row("c", { result: "< 5", note: " Вымышленная пометка " })] }));
  const card = core.upsertInvestigationReport(original, values, { now: LATER });
  assert.equal(Object.hasOwn(original, "investigations"), false);
  assert.equal(card.updatedAt, LATER);
  assert.equal(card.investigations.length, 2);
  assert.deepEqual(card.investigations.map(item => item.fieldId), ["b", "c"]);
  assert.equal(card.investigations[0].result, " 0 ");
  assert.equal(card.investigations[0].unit, " усл. ед. ");
  assert.equal(card.investigations[1].note, " Вымышленная пометка ");
  const groups = core.getInvestigationReports(card);
  assert.equal(groups.length, 1);
  assert.deepEqual(Object.keys(groups[0]), ["id", "panelId", "title", "kind", "date", "results"]);
  assert.equal(groups[0].title, values.title);
  assert.notEqual(groups[0].results[0], card.investigations[0]);
  assert.ok(groups[0].id.startsWith("report-"));
  assert.deepEqual(core.validatePatient(card), []);
});

test("report replacement retains result IDs by field while removing blank fields and adding new ones", () => {
  const original = freeze(withReport(report({ rows: [row("a"), row("b", { result: "10" })] })));
  const id = original.investigations[0].reportId;
  const changed = core.upsertInvestigationReport(original, report({ title: "Изменённый вымышленный бланк", date: "2032-04-23", rows: [row("a", { result: "" }), row("b", { result: "11" }), row("c", { result: "0" })] }), { id, now: LATER });
  assert.equal(changed.investigations.length, 2);
  assert.equal(changed.investigations[0].id, original.investigations[1].id);
  assert.notEqual(changed.investigations[1].id, original.investigations[0].id);
  assert.deepEqual(changed.investigations.map(item => item.fieldId), ["b", "c"]);
  assert.ok(changed.investigations.every(item => item.reportId === id && item.date === "2032-04-23" && item.reportTitle === "Изменённый вымышленный бланк"));
  assert.equal(original.investigations[0].fieldId, "a");
  assert.equal(original.investigations[1].result, "10");
});

test("report groups sort newest first with deterministic ties and exclude independent legacy results", () => {
  let card = withReport();
  card = core.upsertInvestigationReport(card, report({ date: "2032-04-23", title: "Поздний вымышленный бланк" }), { now: LATER });
  card = core.upsertInvestigationReport(card, report({ date: "2032-04-23", title: "Другой вымышленный бланк" }), { now: LATER });
  card = core.upsertInvestigation(card, legacyValue(), { now: LATER });
  const groups = core.getInvestigationReports(freeze(card));
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(item => item.date), ["2032-04-23", "2032-04-23", "2032-04-19"]);
  assert.ok(groups[0].id.localeCompare(groups[1].id) < 0);
  assert.equal(groups.flatMap(item => item.results).length, 3);
  assert.equal(core.getInvestigationSeries(card).length, 2);
});

test("deleting a report preserves separate results and other reports and removes the optional array when empty", () => {
  const first = withReport();
  const id = first.investigations[0].reportId;
  const both = core.upsertInvestigation(first, legacyValue(), { now: NOW });
  const remaining = core.removeInvestigationReport(freeze(both), id, { now: LATER });
  assert.equal(remaining.investigations.length, 1);
  assert.equal(remaining.investigations[0].name, "Вымышленное отдельное исследование");
  assert.equal(remaining.updatedAt, LATER);
  assert.notEqual(remaining.investigations[0], both.investigations[1]);
  const empty = core.removeInvestigationReport(freeze(first), id, { now: LATER });
  assert.equal(Object.hasOwn(empty, "investigations"), false);
  assert.deepEqual(core.getInvestigationReports(empty), []);
  assert.throws(() => core.removeInvestigationReport(both, both.investigations[1].id), /не найден/);
});

test("all four metadata fields are required together and report invariants are validated on import", () => {
  const card = withReport(report({ rows: [row("a"), row("b")] }));
  const valid = card.investigations[0];
  for (const field of META) {
    for (const value of [undefined, null, 12, "", field === "reportTitle" ? " ".repeat(5) : "-bad"]) {
      const changed = structuredClone(card);
      if (value === undefined) delete changed.investigations[0][field];
      else changed.investigations[0][field] = value;
      assert.ok(core.validatePatient(changed).length, field + ":" + value);
      assert.throws(() => core.serializeBundle([], [changed]));
    }
  }
  for (const field of ["reportTitle", "panelId", "date", "kind", "fieldId"]) {
    const changed = structuredClone(card);
    changed.investigations[1][field] = field === "fieldId" ? "a" : field === "date" ? "2032-04-23" : field === "kind" ? "study" : "other";
    assert.ok(core.validateInvestigations(changed.investigations).length, field);
  }
  for (const [field, value] of [["reportTitle", "я".repeat(201)], ["reportId", "a".repeat(81)], ["panelId", "a".repeat(81)], ["fieldId", "a".repeat(81)]]) {
    assert.ok(core.validateInvestigations([{ ...valid, [field]: value }]).length);
  }
  assert.ok(core.validateInvestigations([{ ...valid, unexpected: "ignored?" }]).length);
});

test("empty, malformed and duplicate-field report requests fail atomically, including malformed blank rows", () => {
  const original = freeze(withReport());
  const snapshot = JSON.stringify(original);
  const invalid = [null, {}, [], report({ unknown: true }), report({ rows: [] }), report({ rows: [row("a", { result: " \n" })] }),
    report({ panelId: "" }), report({ title: "" }), report({ title: "я".repeat(201) }), report({ kind: "unknown" }),
    report({ date: "2032-02-30" }), report({ rows: new Array(1) }), report({ rows: [row(), row()] }),
    report({ rows: [row("a", { result: "", unit: 10 })] }), report({ rows: [row("a", { name: "", result: "12" })] }),
    report({ rows: [{ ...row(), unexpected: "" }] }), report({ rows: [row("-bad")] })];
  for (const field of ["fieldId", "name", "result", "unit", "reference", "note"]) {
    const missing = row();
    delete missing[field];
    invalid.push(report({ rows: [missing] }));
  }
  for (const value of invalid) assert.throws(() => core.upsertInvestigationReport(original, value), JSON.stringify(value));
  for (const id of ["missing", null, 1, ""]) {
    assert.throws(() => core.upsertInvestigationReport(original, report(), { id }), /не найден/);
    assert.throws(() => core.removeInvestigationReport(original, id), /не найден/);
  }
  for (const now of ["invalid", "0000-01-01", "+010000-01-01"]) {
    assert.throws(() => core.upsertInvestigationReport(original, report(), { now }), /время/);
    assert.throws(() => core.removeInvestigationReport(original, original.investigations[0].reportId, { now }), /время/);
  }
  assert.throws(() => core.upsertInvestigationReport(original, report(), { other: true }), /параметры/);
  assert.equal(JSON.stringify(original), snapshot);
});

test("report limits allow one hundred fields and five hundred patient results but reject overflow", () => {
  assert.equal(core.MAX_INVESTIGATION_REPORT_FIELDS, 100);
  const rows = Array.from({ length: 100 }, (_, index) => row("field-" + index));
  let card = patient();
  for (let index = 0; index < 5; index += 1) card = core.upsertInvestigationReport(card, report({ rows }), { now: NOW });
  assert.equal(card.investigations.length, 500);
  assert.deepEqual(core.validatePatient(card), []);
  assert.throws(() => core.upsertInvestigationReport(card, report(), { now: NOW }), /не более 500/);
  assert.throws(() => core.upsertInvestigationReport(patient(), report({ rows: [...rows, row("overflow")] })), /не более 100/);
  const oversized = { ...patient(), investigations: [...card.investigations.slice(0, 100), { ...card.investigations[0], id: "overflow-result", fieldId: "overflow" }] };
  assert.ok(core.validatePatient(oversized).some(error => error.message.includes("100")));
  const id = card.investigations[0].reportId;
  assert.doesNotThrow(() => core.upsertInvestigationReport(card, report({ rows: rows.map(item => ({ ...item, result: "13" })) }), { id, now: LATER }));
});

test("legacy individual edits retain grouping metadata and cannot break common report fields", () => {
  const original = freeze(withReport(report({ rows: [row("a"), row("b")] })));
  const item = original.investigations[0];
  const values = Object.fromEntries(["kind", "date", "name", "result", "unit", "reference", "note"].map(field => [field, item[field]]));
  const changed = core.upsertInvestigation(original, { ...values, result: "0" }, { id: item.id, now: LATER });
  assert.deepEqual(META.map(field => changed.investigations[0][field]), META.map(field => item[field]));
  assert.equal(changed.investigations[0].result, "0");
  assert.throws(() => core.upsertInvestigation(original, { ...values, date: "2032-04-23" }, { id: item.id }), /совпадать/);
  assert.throws(() => core.upsertInvestigation(original, { ...values, kind: "study" }, { id: item.id }), /совпадать/);
  const remaining = core.removeInvestigation(original, item.id, { now: LATER });
  assert.equal(core.getInvestigationReports(remaining)[0].results.length, 1);
  assert.equal(core.getInvestigationReports(remaining)[0].id, item.reportId);
});

test("explicit attachment resets review, retains manual text and canonicalizes empty links", () => {
  const card = freeze(withReport(report({ rows: [row("a"), row("b")] })));
  const original = freeze(reviewed(visit()));
  const ids = card.investigations.map(item => item.id);
  const linked = core.setEncounterInvestigations(original, card, ids, { now: LATER });
  assert.deepEqual(linked.investigationIds, ids);
  assert.notEqual(linked.investigationIds, ids);
  assert.equal(linked.workflow.reviewStatus, "draft");
  assert.equal(linked.workflow.reviewedAt, "");
  assert.equal(linked.updatedAt, LATER);
  assert.deepEqual(linked.draft, original.draft);
  const checked = reviewed(linked);
  const unchanged = core.setEncounterInvestigations(freeze(checked), card, ids, { now: LATER });
  assert.deepEqual(unchanged, checked);
  assert.notEqual(unchanged.investigationIds, checked.investigationIds);
  const detached = core.setEncounterInvestigations(checked, card, [], { now: LATER });
  assert.equal(Object.hasOwn(detached, "investigationIds"), false);
  assert.equal(detached.workflow.reviewStatus, "draft");
  assert.deepEqual(detached.draft, checked.draft);
});

test("attachment rejects missing, foreign, repeated and malformed IDs before data can be saved", () => {
  const card = freeze(withReport());
  const encounter = freeze(visit());
  const id = card.investigations[0].id;
  for (const ids of [null, {}, "not-array", new Array(1), [null], ["-bad"], [id, id], ["missing"], Array.from({ length: 501 }, (_, index) => "id-" + index)]) {
    assert.throws(() => core.setEncounterInvestigations(encounter, card, ids));
    if (Array.isArray(ids) && ids[0] === "missing") continue;
    assert.ok(core.validateEncounter({ ...encounter, investigationIds: ids }).length);
  }
  assert.throws(() => core.setEncounterInvestigations(encounter, { ...card, id: "another-patient" }, [id]), /одному пациенту/);
  assert.throws(() => core.setEncounterInvestigations(encounter, card, [id], { now: "invalid" }), /время/);
  assert.throws(() => core.setEncounterInvestigations(encounter, card, [id], { unknown: true }), /параметры/);
  assert.equal(Object.hasOwn(encounter, "investigationIds"), false);
});

test("reconciliation adds newly filled fields to linked reports and resets only affected visits", () => {
  const before = freeze(withReport(report({ rows: [row("a"), row("b")] })));
  const id = before.investigations[0].reportId;
  const linked = freeze(reviewed(core.setEncounterInvestigations(visit(), before, [before.investigations[0].id], { now: NOW })));
  const unlinked = freeze(reviewed(visit("unlinked")));
  const foreign = freeze(reviewed(visit("foreign", "another-patient")));
  const after = freeze(core.upsertInvestigationReport(before, report({ rows: [row("a", { result: "13" }), row("b"), row("c", { result: "0" })] }), { id, now: LATER }));
  const reconciled = core.reconcileInvestigationReferences(before, after, freeze([linked, unlinked, foreign]), { now: LATER });
  assert.deepEqual(reconciled[0].investigationIds, [before.investigations[0].id, after.investigations[2].id]);
  assert.equal(reconciled[0].workflow.reviewStatus, "draft");
  assert.equal(reconciled[0].updatedAt, LATER);
  assert.deepEqual(reconciled[0].draft, linked.draft);
  assert.deepEqual(reconciled[1], unlinked);
  assert.deepEqual(reconciled[2], foreign);
  assert.equal(linked.workflow.reviewStatus, "reviewed");
  assert.deepEqual(core.parseBundle(core.serializeBundle(reconciled, [after, patient("another-patient")])).encounters, reconciled);
});

test("reconciliation removes deleted references and leaves unrelated result changes and report fields alone", () => {
  const before = withReport(report({ rows: [row("a"), row("b")] }));
  const id = before.investigations[0].reportId;
  const linked = reviewed(core.setEncounterInvestigations(visit(), before, [before.investigations[0].id], { now: NOW }));
  const otherFieldChanged = core.upsertInvestigationReport(before, report({ rows: [row("a"), row("b", { result: "99" })] }), { id, now: LATER });
  assert.deepEqual(core.reconcileInvestigationReferences(before, otherFieldChanged, [linked], { now: LATER }), [linked]);
  const unlinkedAdded = core.upsertInvestigationReport(before, report({ title: "Другой бланк" }), { now: LATER });
  assert.deepEqual(core.reconcileInvestigationReferences(before, unlinkedAdded, [linked], { now: LATER }), [linked]);
  const removed = core.removeInvestigationReport(before, id, { now: LATER });
  const [detached] = core.reconcileInvestigationReferences(before, removed, [freeze(linked)], { now: LATER });
  assert.equal(Object.hasOwn(detached, "investigationIds"), false);
  assert.equal(detached.workflow.reviewStatus, "draft");
  assert.equal(detached.updatedAt, LATER);
  assert.deepEqual(detached.draft, linked.draft);
});

test("individual result edits and deletions reconcile linked visits while a pending empty visit is supported", () => {
  const before = core.upsertInvestigation(patient(), legacyValue(), { now: NOW });
  const id = before.investigations[0].id;
  const linked = reviewed(core.setEncounterInvestigations(visit(), before, [id], { now: NOW }));
  const after = core.upsertInvestigation(before, legacyValue({ result: "Новое вымышленное заключение" }), { id, now: LATER });
  const pending = visit("pending-visit");
  const [changed, unchanged] = core.reconcileInvestigationReferences(before, after, [linked, pending], { now: LATER });
  assert.equal(changed.workflow.reviewStatus, "draft");
  assert.deepEqual(unchanged, pending);
  const [deleted] = core.reconcileInvestigationReferences(before, core.removeInvestigation(before, id), [linked]);
  assert.equal(Object.hasOwn(deleted, "investigationIds"), false);
  assert.throws(() => core.reconcileInvestigationReferences(before, { ...after, id: "other" }, [linked]), /одному пациенту/);
  assert.throws(() => core.reconcileInvestigationReferences(before, after, [linked, linked]), /Повторяющийся/);
  assert.throws(() => core.reconcileInvestigationReferences(before, after, [{ ...linked, investigationIds: ["missing"] }]), /отсутствует/);
});

test("reconciliation ignores property order in semantically identical imported result objects", () => {
  const before = withReport();
  const linked = reviewed(core.setEncounterInvestigations(visit(), before, [before.investigations[0].id]));
  const reordered = { ...before, updatedAt: LATER, investigations: before.investigations.map(item => Object.fromEntries(Object.entries(item).reverse())) };
  assert.deepEqual(core.validatePatient(reordered), []);
  assert.deepEqual(core.reconcileInvestigationReferences(before, reordered, [linked], { now: LATER }), [linked]);
});

test("selected reports generate a grouped section before conclusion with only entered values and return visit last", () => {
  let card = withReport(report({ rows: [row("a", { result: "0", reference: "", unit: "", note: "" }), row("b", { result: "", name: "Незаполненный показатель" }), row("c", { name: "Вымышленный показатель В", result: "4", note: "Демо-примечание" })] }));
  card = core.upsertInvestigation(card, legacyValue({ date: "2032-04-23" }), { now: LATER });
  const base = visit();
  base.assessment.summary = "Вымышленный диагноз";
  base.assessment.returnVisitDate = "2032-04-27";
  const encounter = core.setEncounterInvestigations(base, card, card.investigations.map(item => item.id), { now: NOW });
  const text = core.generateDraft(freeze(encounter), context(freeze(card), [encounter]));
  const section = text.slice(text.indexOf("ИССЛЕДОВАНИЯ"), text.indexOf("ЗАКЛЮЧЕНИЕ"));
  assert.match(section, /Демонстрационный бланк от 19\.04\.2032:/);
  assert.match(section, /Вымышленный показатель А: 0\n/);
  assert.match(section, /Вымышленный показатель В: 4 усл\. ед\.; нормы из бланка: 8–15 \(вымышленный бланк\); примечание: Демо-примечание/);
  assert.match(section, /23\.04\.2032 — Вымышленное отдельное исследование: Описание вручную/);
  assert.doesNotMatch(section, /Незаполненный показатель|не заполнено|не указано/);
  assert.ok(text.indexOf("ИССЛЕДОВАНИЯ") < text.indexOf("ЗАКЛЮЧЕНИЕ"));
  assert.ok(text.endsWith("Повторный приём: 27.04.2032"));
  const subset = core.setEncounterInvestigations(encounter, card, [card.investigations[0].id]);
  assert.doesNotMatch(core.generateDraft(subset, context(card)), /Вымышленный показатель В|Описание вручную/);
});

test("linked draft and fingerprint require matching context and refuse missing results instead of silently omitting them", () => {
  const card = withReport();
  const encounter = core.setEncounterInvestigations(visit(), card, [card.investigations[0].id]);
  for (const fn of [core.generateDraft, core.fingerprint]) {
    assert.throws(() => fn(encounter), /требуется карточка/);
    assert.throws(() => fn(encounter, null), /требуется карточка/);
    assert.throws(() => fn(encounter, {}), /требуется карточка/);
    assert.throws(() => fn(encounter, context(patient())), /отсутствует/);
    assert.throws(() => fn(encounter, context({ ...card, id: "foreign" })), /одному пациенту/);
  }
});

test("fingerprints include exact selected data, ignore unselected results, and keep historical empty-link behavior", () => {
  const before = withReport(report({ rows: [row("a"), row("b")] }));
  const id = before.investigations[0].reportId;
  const unlinked = visit();
  assert.equal(core.fingerprint(unlinked), core.fingerprint({ ...unlinked, investigationIds: [] }));
  assert.equal(core.generateDraft(unlinked), core.generateDraft({ ...unlinked, investigationIds: [] }));
  assert.equal(core.fingerprint(unlinked), core.fingerprint(unlinked, context(before)));
  assert.equal(core.generateDraft(unlinked), core.generateDraft(unlinked, context(before)));
  const encounter = core.setEncounterInvestigations(unlinked, before, [before.investigations[0].id]);
  const original = core.fingerprint(encounter, context(before));
  const unselected = core.upsertInvestigationReport(before, report({ rows: [row("a"), row("b", { result: "99" })] }), { id });
  assert.equal(core.fingerprint(encounter, context(unselected)), original);
  for (const field of ["name", "result", "unit", "reference", "note"]) {
    const after = core.upsertInvestigationReport(before, report({ rows: [row("a", { [field]: "новое значение" }), row("b")] }), { id });
    assert.notEqual(core.fingerprint(encounter, context(after)), original, field);
  }
  const dated = core.upsertInvestigationReport(before, report({ date: "2032-04-23", title: "Новое название", rows: [row("a"), row("b")] }), { id });
  assert.notEqual(core.fingerprint(encounter, context(dated)), original);
  assert.equal(core.fingerprint({ ...encounter, updatedAt: LATER, draft: { ...encounter.draft, text: "Ручная правка" } }, context(before)), original);
});

test("schema four backups preserve grouped metadata and validate every linked result against its own patient", () => {
  const card = freeze(withReport());
  const encounter = freeze(core.setEncounterInvestigations(visit(), card, [card.investigations[0].id]));
  const serialized = core.serializeBundle([encounter], [card]);
  const parsed = core.parseBundle(serialized);
  assert.deepEqual(parsed.patients, [card]);
  assert.deepEqual(parsed.encounters, [encounter]);
  assert.notEqual(parsed.encounters[0].investigationIds, encounter.investigationIds);
  for (const modify of [
    data => { data.patients[0].investigations = []; },
    data => { data.encounters[0].investigationIds = ["missing"]; },
    data => { data.patients.push({ ...data.patients[0], id: "other" }); delete data.patients[0].investigations; },
    data => { data.encounters[0].investigationIds.push(data.encounters[0].investigationIds[0]); }
  ]) {
    const invalid = JSON.parse(serialized);
    modify(invalid);
    assert.throws(() => core.parseBundle(JSON.stringify(invalid)));
  }
  const empty = core.parseBundle(core.serializeBundle([{ ...visit(), investigationIds: [] }], [patient()]));
  assert.equal(Object.hasOwn(empty.encounters[0], "investigationIds"), false);
});

test("legacy schema versions reject encounter result links while ordinary legacy files still import", () => {
  for (const version of [1, 2, 3]) {
    const data = JSON.parse(core.serializeBundle([visit()], [patient()]));
    data.schemaVersion = version;
    delete data.encounters[0].workflow;
    if (version < 3) { delete data.patients; delete data.encounters[0].patientId; }
    if (version === 1) {
      delete data.encounters[0].examSelections;
      for (const field of ["returnVisitDate", "sickLeaveIssued", "sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"]) delete data.encounters[0].assessment[field];
    }
    assert.equal(core.parseBundle(JSON.stringify(data)).schemaVersion, 4);
    data.encounters[0].investigationIds = [];
    assert.throws(() => core.parseBundle(JSON.stringify(data)), /Неизвестное поле/);
  }
});

test("repeat encounters never inherit results and ordinary normalization paths retain existing links and report data", () => {
  const card = withReport();
  const linked = core.setEncounterInvestigations(visit(), card, [card.investigations[0].id]);
  const repeated = core.createRepeatEncounter(freeze(linked), { id: "repeat", now: LATER });
  assert.equal(Object.hasOwn(repeated, "investigationIds"), false);
  const rx = core.upsertPrescription(linked, { name: "Вымышленный препарат", dose: "", route: "", frequency: "", duration: "", note: "" }, { now: LATER });
  assert.deepEqual(rx.investigationIds, linked.investigationIds);
  const recommendations = { ...linked, assessment: { ...linked.assessment, plan: "Демонстрационная рекомендация" } };
  const template = core.createVisitTemplate(recommendations, { name: "Демо-шаблон", kind: "recommendations", now: NOW });
  const applied = core.applyVisitTemplate(linked, template);
  assert.deepEqual(applied.investigationIds, linked.investigationIds);
  const result = core.applyEncounterSickLeave(card, linked, { type: "issue", number: "DEMO-REPORT", from: "2032-04-19", to: "2032-04-23", now: NOW }, [linked]);
  assert.deepEqual(result.patient.investigations, card.investigations);
  assert.deepEqual(result.encounter.investigationIds, linked.investigationIds);
  assert.deepEqual(core.setReviewStatus({ ...result.encounter, draft: { ...result.encounter.draft, text: "Демо-текст" } }, "reviewed", { now: LATER }).investigationIds, linked.investigationIds);
});

test("atomic repository saves reject one-sided creation or removal and preserve stored data on failures", () => {
  const storage = {
    raw: null, fail: false,
    getItem(key) { return key === KEY ? this.raw : null; },
    setItem(key, value) { assert.equal(key, KEY); if (this.fail) throw new Error("Демонстрационный отказ записи"); this.raw = value; }
  };
  const repository = createRepository(storage);
  repository.load();
  const card = withReport();
  const encounter = core.setEncounterInvestigations(visit(), card, [card.investigations[0].id]);
  assert.equal(repository.save([encounter], [patient()]).ok, false);
  assert.equal(storage.raw, null);
  assert.equal(repository.save([encounter], [card]).ok, true);
  const saved = storage.raw;
  const deleted = core.removeInvestigationReport(card, card.investigations[0].reportId);
  assert.equal(repository.save([encounter], [deleted]).ok, false);
  assert.equal(storage.raw, saved);
  const reconciled = core.reconcileInvestigationReferences(card, deleted, [encounter]);
  storage.fail = true;
  assert.equal(repository.save(reconciled, [deleted]).ok, false);
  assert.equal(storage.raw, saved);
  storage.fail = false;
  assert.equal(repository.save(reconciled, [deleted]).ok, true);
  assert.equal(Object.hasOwn(repository.load().encounters[0], "investigationIds"), false);
});

test("oversized selected research text is rejected explicitly without truncating stored results or manual draft", () => {
  let card = patient();
  const rows = Array.from({ length: 100 }, (_, index) => row("field-" + index, { result: "я".repeat(2000), note: "н".repeat(1000), reference: "р".repeat(500) }));
  card = core.upsertInvestigationReport(card, report({ rows }));
  const encounter = freeze(core.setEncounterInvestigations(reviewed(visit()), card, card.investigations.map(item => item.id)));
  assert.throws(() => core.generateDraft(encounter, context(card)), /100000/);
  assert.throws(() => core.fingerprint(encounter, context(card)), /слишком велики/);
  assert.equal(encounter.draft.text, "Ручной текст врача");
  assert.equal(card.investigations.length, 100);
  assert.equal(card.investigations[0].result.length, 2000);
  assert.doesNotThrow(() => core.serializeBundle([encounter], [card]));
});
