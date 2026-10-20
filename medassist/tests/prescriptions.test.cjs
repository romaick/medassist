"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const core = require("../app/core.js");
const { createRepository, KEY } = require("../app/storage.js");
const NOW = "2032-04-19T09:00:00.000Z";
const LATER = "2032-04-23T09:00:00.000Z";
const VALUE_FIELDS = ["name", "dose", "route", "frequency", "duration", "note"];
function encounter(id = "rx-visit", now = NOW) {
  const entry = core.createEncounter({ id, patientId: "rx-patient", now });
  entry.visitDate = now.slice(0, 10);
  return entry;
}
function patient() { return core.createPatient({ id: "rx-patient", label: "Вымышленный Пациент", now: NOW }); }
function values(overrides = {}) {
  return { name: "Демонстрационный препарат А", dose: "условная дозировка", route: "условный способ", frequency: "условная кратность", duration: "условный срок", note: "Только вымышленные данные", ...overrides };
}
function prescribed(overrides = {}) { return core.upsertPrescription(encounter(), values(overrides), { now: NOW }); }
function freeze(value) {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function bundle(entry, card = patient()) { return JSON.parse(core.serializeBundle([entry], [card])); }
function legacy(entry, version) {
  const data = bundle(entry);
  data.schemaVersion = version;
  delete data.encounters[0].workflow;
  if (version < 3) { delete data.patients; delete data.encounters[0].patientId; }
  if (version === 1) {
    delete data.encounters[0].examSelections;
    for (const field of ["returnVisitDate", "sickLeaveIssued", "sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"]) delete data.encounters[0].assessment[field];
  }
  return data;
}
function memoryStorage(raw = null) {
  return { raw, getItem(key) { return key === KEY ? this.raw : null; }, setItem(key, value) { assert.equal(key, KEY); this.raw = value; } };
}
function hash(value) { return createHash("sha256").update(value).digest("hex"); }

test("appointments without prescriptions retain the exact pre-feature draft and source fingerprint", () => {
  const entry = encounter();
  assert.equal(Object.hasOwn(entry, "prescriptions"), false);
  assert.equal(hash(core.fingerprint(entry)), "5594331ae496a973a141cc26bebc071809a0dce09a3ec939a1104371b083041c");
  assert.equal(hash(core.generateDraft(entry)), "d194c95afa5f2bee4ffe60a94faf3409a63c90e41fc005a5d70b52cb38ea60eb");
  const empty = { ...entry, prescriptions: [] };
  assert.deepEqual(core.validateEncounter(empty), []);
  assert.equal(core.fingerprint(empty), core.fingerprint(entry));
  assert.equal(core.generateDraft(empty), core.generateDraft(entry));
  assert.equal(Object.hasOwn(core.validateBundle(bundle(empty)).encounters[0], "prescriptions"), false);
});

test("schema four accepts prescriptions and deep-clones every entry on backup round-trip", () => {
  const entry = prescribed();
  const backup = bundle(entry);
  assert.equal(backup.schemaVersion, 4);
  const normalized = core.validateBundle(freeze(backup));
  assert.deepEqual(normalized.encounters[0], entry);
  assert.notEqual(normalized.encounters[0].prescriptions, backup.encounters[0].prescriptions);
  assert.notEqual(normalized.encounters[0].prescriptions[0], backup.encounters[0].prescriptions[0]);
  normalized.encounters[0].prescriptions[0].dose = "Изменение только копии";
  assert.equal(entry.prescriptions[0].dose, "условная дозировка");
  assert.deepEqual(core.parseBundle(core.serializeBundle([entry], [patient()])).encounters[0], entry);
});

test("legacy schema versions reject even an empty prescription extension and still import old visits", () => {
  for (const version of [1, 2, 3]) {
    const withPrescriptions = legacy(prescribed(), version);
    assert.throws(() => core.parseBundle(JSON.stringify(withPrescriptions)), /prescriptions.*Неизвестное поле/);
    withPrescriptions.encounters[0].prescriptions = [];
    assert.throws(() => core.parseBundle(JSON.stringify(withPrescriptions)), /prescriptions.*Неизвестное поле/);
    delete withPrescriptions.encounters[0].prescriptions;
    const imported = core.parseBundle(JSON.stringify(withPrescriptions));
    assert.equal(imported.schemaVersion, 4);
    assert.equal(Object.hasOwn(imported.encounters[0], "prescriptions"), false);
  }
});

test("strict validation rejects malformed lists, incomplete objects, unknown fields, IDs and non-string values", () => {
  const valid = prescribed().prescriptions[0];
  const invalidLists = [null, {}, "препарат", [null], [[]], [true], new Array(1),
    [{ ...valid, unknown: "" }], [{ ...valid, id: "невалидный" }], [{ ...valid, id: "-rx" }], [{ ...valid, id: "x".repeat(81) }],
    [{ ...valid, name: " \t\n" }], [valid, { ...valid }]];
  for (const field of ["id", ...VALUE_FIELDS]) {
    const missing = { ...valid };
    delete missing[field];
    invalidLists.push([missing], [{ ...valid, [field]: 1 }], [{ ...valid, [field]: null }]);
  }
  for (const prescriptions of invalidLists) {
    const entry = { ...encounter(), prescriptions };
    assert.ok(core.validateEncounter(entry).length > 0);
    assert.throws(() => core.serializeBundle([entry], [patient()]));
  }
});

test("prescription limits allow fifty entries and exact text boundaries, rejecting every overflow", () => {
  const boundary = Object.fromEntries(VALUE_FIELDS.map(field => [field, "я".repeat(field === "note" ? 1000 : 200)]));
  const entry = { ...encounter(), prescriptions: Array.from({ length: 50 }, (_, index) => ({ id: "rx-" + index, ...boundary })) };
  assert.deepEqual(core.validateEncounter(entry), []);
  assert.equal(core.MAX_PRESCRIPTIONS, 50);
  assert.equal(core.MAX_PRESCRIPTION_FIELD_LENGTH, 200);
  assert.equal(core.MAX_PRESCRIPTION_NOTE_LENGTH, 1000);
  assert.throws(() => core.upsertPrescription(freeze(entry), values()), /не более 50/);
  assert.doesNotThrow(() => core.upsertPrescription(entry, values(), { id: "rx-25", now: LATER }));
  for (const field of VALUE_FIELDS) {
    assert.ok(core.validatePrescriptions([{ ...entry.prescriptions[0], [field]: boundary[field] + "я" }]).some(error => error.field.endsWith("." + field)));
  }
});

test("adding and editing prescriptions are immutable, update the review state and preserve manual text", () => {
  const original = encounter();
  original.draft.text = "Ручная запись врача";
  original.draft.sourceFingerprint = core.fingerprint(original);
  original.draft.generatedAt = NOW;
  const reviewed = freeze(core.setReviewStatus(original, "reviewed", { now: NOW }));
  const added = core.upsertPrescription(reviewed, freeze(values()), { now: LATER });
  assert.equal(Object.hasOwn(reviewed, "prescriptions"), false);
  assert.equal(added.updatedAt, LATER);
  assert.deepEqual(added.draft, original.draft);
  assert.equal(added.workflow.reviewStatus, "draft");
  assert.equal(added.workflow.reviewedAt, "");
  assert.notEqual(core.fingerprint(added), added.draft.sourceFingerprint);
  const id = added.prescriptions[0].id;
  const edited = core.upsertPrescription(freeze(core.setReviewStatus(added, "reviewed", { now: NOW })), values({ dose: "Другая вымышленная дозировка" }), { id, now: LATER });
  assert.equal(edited.prescriptions.length, 1);
  assert.equal(edited.prescriptions[0].id, id);
  assert.equal(added.prescriptions[0].dose, "условная дозировка");
  assert.equal(edited.workflow.reviewStatus, "draft");
  assert.deepEqual(edited.draft, original.draft);
  assert.notEqual(core.fingerprint(edited), core.fingerprint(added));
});

test("removing prescriptions retains other entries and omits the optional property after the last deletion", () => {
  const first = prescribed();
  const both = core.upsertPrescription(first, values({ name: "Демонстрационный препарат Б" }), { now: LATER });
  both.draft.text = "Ручная запись";
  const reviewed = freeze(core.setReviewStatus(both, "reviewed", { now: NOW }));
  const one = core.removePrescription(reviewed, both.prescriptions[0].id, { now: LATER });
  assert.equal(one.prescriptions.length, 1);
  assert.deepEqual(one.prescriptions[0], both.prescriptions[1]);
  assert.notEqual(one.prescriptions[0], both.prescriptions[1]);
  assert.equal(one.updatedAt, LATER);
  assert.equal(one.workflow.reviewStatus, "draft");
  assert.deepEqual(one.draft, both.draft);
  assert.equal(both.prescriptions.length, 2);
  const last = core.removePrescription(freeze(one), one.prescriptions[0].id, { now: LATER });
  assert.equal(Object.hasOwn(last, "prescriptions"), false);
  assert.equal(core.fingerprint(last), core.fingerprint(encounter()));
  assert.equal(last.draft.text, "Ручная запись");
});

test("CRUD rejects unknown targets, malformed input and timestamps without changing the source", () => {
  const entry = freeze(prescribed());
  const snapshot = JSON.stringify(entry);
  for (const id of ["unknown", "", null, 23]) {
    assert.throws(() => core.upsertPrescription(entry, values(), { id }), /не найдено/);
    assert.throws(() => core.removePrescription(entry, id), /не найдено/);
  }
  for (const bad of [null, {}, [], { ...values(), extra: "" }, { ...values(), id: "injected" }, values({ name: " " }), values({ dose: 5 })]) {
    assert.throws(() => core.upsertPrescription(entry, bad));
  }
  for (const now of ["bad time", "0000-01-01", "+010000-01-01"]) {
    assert.throws(() => core.upsertPrescription(entry, values(), { now }), /время/);
    assert.throws(() => core.removePrescription(entry, entry.prescriptions[0].id, { now }), /время/);
  }
  assert.throws(() => core.upsertPrescription(entry, values(), { unexpected: true }), /параметры/);
  assert.throws(() => core.removePrescription(entry, entry.prescriptions[0].id, { id: "wrong" }), /параметры/);
  assert.equal(JSON.stringify(entry), snapshot);
});

test("fingerprints include every clinical prescription field and order while excluding entry IDs", () => {
  const first = prescribed();
  const original = core.fingerprint(first);
  const changedId = structuredClone(first);
  changedId.prescriptions[0].id = "different-id";
  assert.equal(core.fingerprint(changedId), original);
  for (const field of VALUE_FIELDS) {
    const changed = structuredClone(first);
    changed.prescriptions[0][field] += " изменение";
    assert.notEqual(core.fingerprint(changed), original, field);
  }
  const both = core.upsertPrescription(first, values({ name: "Вымышленный препарат Б" }));
  const reversed = { ...both, prescriptions: [...both.prescriptions].reverse() };
  assert.notEqual(core.fingerprint(both), core.fingerprint(reversed));
});

test("repeat visits transfer no prescriptions by default and retain original history opt-in semantics", () => {
  const source = prescribed();
  source.history.medications = "Постоянный вымышленный препарат";
  source.history.conditions = "Вымышленное заболевание";
  source.history.allergies = "Вымышленная реакция";
  source.assessment.summary = "Предыдущий диагноз";
  source.assessment.plan = "Предыдущие рекомендации";
  source.exam.general = "Предыдущий осмотр";
  source.age = "45";
  source.sex = "male";
  source.draft.text = "Предыдущая запись";
  const repeat = core.createRepeatEncounter(freeze(source), { id: "repeat", now: LATER, carryHistoryFields: ["medications", "allergies"] });
  assert.equal(Object.hasOwn(repeat, "prescriptions"), false);
  assert.equal(repeat.history.medications, source.history.medications);
  assert.equal(repeat.history.allergies, source.history.allergies);
  assert.equal(repeat.history.conditions, "");
  assert.equal(repeat.assessment.plan, "");
  assert.equal(repeat.assessment.summary, "");
  assert.equal(repeat.exam.general, "");
  assert.equal(repeat.age, "");
  assert.equal(repeat.sex, "");
  assert.equal(repeat.draft.text, "");
  assert.equal(repeat.workflow.reviewStatus, "draft");
});

test("repeat prescription selection copies only selected entries, in source order, with fresh IDs", () => {
  const first = prescribed();
  const second = core.upsertPrescription(first, values({ name: "Демонстрационный препарат Б" }));
  const source = freeze(core.upsertPrescription(second, values({ name: "Демонстрационный препарат В" })));
  const ids = source.prescriptions.map(item => item.id);
  const repeat = core.createRepeatEncounter(source, { id: "repeat", now: LATER, carryPrescriptionIds: [ids[2], ids[0]] });
  assert.equal(repeat.prescriptions.length, 2);
  assert.deepEqual(repeat.prescriptions.map(item => item.name), [source.prescriptions[0].name, source.prescriptions[2].name]);
  assert.ok(repeat.prescriptions.every(item => !ids.includes(item.id)));
  assert.notEqual(repeat.prescriptions[0].id, repeat.prescriptions[1].id);
  for (const field of VALUE_FIELDS) assert.equal(repeat.prescriptions[0][field], source.prescriptions[0][field]);
  repeat.prescriptions[0].dose = "Только в новом приёме";
  assert.equal(source.prescriptions[0].dose, "условная дозировка");
  assert.equal(repeat.history.medications, "");
  assert.equal(repeat.createdAt, LATER);
});

test("repeat prescription selection rejects duplicate, foreign and malformed identifiers", () => {
  const source = freeze(prescribed());
  const id = source.prescriptions[0].id;
  for (const carryPrescriptionIds of [null, {}, id, [id, id], ["unknown"], [null], [42], new Array(1)]) {
    assert.throws(() => core.createRepeatEncounter(source, { id: "repeat", carryPrescriptionIds }), /переноса назначений/);
  }
  assert.throws(() => core.createRepeatEncounter(encounter(), { id: "repeat", carryPrescriptionIds: [id] }), /переноса назначений/);
  assert.throws(() => core.createRepeatEncounter(source, { id: "repeat", carryHistoryFields: ["complaints"] }), /только явно выбранные/);
});

test("drafts show manual prescription values before the sick note and keep the repeat visit last", () => {
  const entry = prescribed({ name: "Демо <А> & «Б»", note: "Вымышленное примечание" });
  Object.assign(entry.assessment, { plan: "Вымышленная рекомендация", sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-12", sickLeaveFrom: "2032-04-19", sickLeaveTo: "2032-04-23", returnVisitDate: "2032-04-27" });
  const draft = core.generateDraft(entry);
  assert.match(draft, /Назначения препаратов:\n1\. Демо <А> & «Б»\./);
  assert.match(draft, /Дозировка: условная дозировка; способ приёма: условный способ; кратность: условная кратность; длительность: условный срок; примечание: Вымышленное примечание\./);
  assert.ok(draft.indexOf("Рекомендации:") < draft.indexOf("Назначения препаратов:"));
  assert.ok(draft.indexOf("Назначения препаратов:") < draft.indexOf("Листок нетрудоспособности:"));
  assert.equal(draft.split("\n").at(-1), "Повторный приём: 27.04.2032");
});

test("incomplete prescriptions explicitly mark missing parameters without inventing clinical defaults", () => {
  const entry = prescribed({ dose: "", route: " ", frequency: "", duration: "\n", note: "" });
  const text = core.formatPrescription(entry.prescriptions[0]);
  assert.equal(text, "Демонстрационный препарат А. Дозировка: не указано; способ приёма: не указано; кратность: не указано; длительность: не указано.");
  assert.equal((text.match(/не указано/g) || []).length, 4);
  assert.doesNotMatch(text, /примечание/);
  assert.ok(core.generateDraft(entry).includes(text));
  assert.throws(() => core.formatPrescription({ ...entry.prescriptions[0], name: "" }), /название/);
});

test("review, repeat linking, sick-note actions and template application preserve prescription content", () => {
  const entry = prescribed();
  entry.draft.text = "Ручная запись";
  entry.assessment.plan = "Вымышленные рекомендации";
  entry.assessment.returnVisitDate = "2032-04-23";
  const reviewed = core.setReviewStatus(freeze(entry), "reviewed", { now: LATER });
  const target = core.createRepeatEncounter(entry, { id: "repeat", now: LATER });
  const linked = core.linkReturnVisit(reviewed, target);
  const completed = core.setReturnVisitStatus(linked, "completed");
  const sick = core.applyEncounterSickLeave(patient(), completed, { type: "issue", number: "ДЕМО", from: "2032-04-19", to: "2032-04-23", now: NOW });
  const undone = core.undoEncounterSickLeave(sick.patient, sick.encounter, [sick.encounter, target]);
  const sample = encounter("template-source");
  sample.exam.general = "Вымышленный осмотр";
  sample.assessment.plan = "Вымышленный план";
  const examTemplate = core.createVisitTemplate(sample, { kind: "exam", name: "Осмотр", now: NOW });
  const recommendations = core.createVisitTemplate(entry, { kind: "recommendations", name: "План", now: NOW });
  const appliedExam = core.applyVisitTemplate(undone.encounter, examTemplate);
  const appliedPlan = core.applyVisitTemplate(appliedExam, recommendations);
  for (const result of [reviewed, linked, completed, sick.encounter, undone.encounter, appliedExam, appliedPlan]) {
    assert.deepEqual(result.prescriptions, entry.prescriptions);
    assert.notEqual(result.prescriptions, entry.prescriptions);
    assert.notEqual(result.prescriptions[0], entry.prescriptions[0]);
  }
  assert.deepEqual(Object.keys(recommendations.content), ["plan"]);
  assert.equal(appliedPlan.workflow.reviewStatus, "draft");
  assert.equal(appliedPlan.draft.text, "Ручная запись");
});

test("repository saves, loads and explicitly resets prescriptions together with personal templates", () => {
  const entry = prescribed();
  entry.assessment.plan = "Вымышленный план";
  const template = core.createVisitTemplate(entry, { kind: "recommendations", name: "Личный план", now: NOW });
  const storage = memoryStorage();
  const repository = createRepository(storage);
  assert.equal(repository.save([entry], [patient()], [template]).ok, true);
  const loaded = createRepository(storage).load();
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.encounters[0].prescriptions, entry.prescriptions);
  assert.deepEqual(loaded.templates, [template]);
  const changed = core.upsertPrescription(entry, values({ dose: "Новая вымышленная дозировка" }), { id: entry.prescriptions[0].id, now: LATER });
  assert.equal(repository.save([changed], [patient()]).ok, true);
  assert.deepEqual(core.parseBundle(storage.raw).templates, [template]);
  const replacement = prescribed({ name: "Другой вымышленный препарат" });
  assert.equal(repository.reset([replacement], [patient()], [template]).ok, true);
  assert.deepEqual(repository.load().encounters[0].prescriptions, replacement.prescriptions);
  assert.equal(repository.reset().ok, true);
  assert.deepEqual(repository.load(), { patients: [], encounters: [], error: null });
});
