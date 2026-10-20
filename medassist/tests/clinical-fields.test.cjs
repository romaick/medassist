"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../app/core.js");
const { createRepository, KEY } = require("../app/storage.js");
const NOW = "2026-10-20T09:00:00.000Z";
const LATER = "2026-10-20T11:00:00.000Z";
function encounter() {
  const entry = core.createEncounter({ id: "clinical-visit", patientId: "clinical-patient", now: NOW });
  entry.visitDate = "2026-10-20";
  return entry;
}
function patient(birthDate) {
  return core.createPatient({ id: "clinical-patient", label: "Вымышленный Пациент", now: NOW, ...(birthDate === undefined ? {} : { birthDate }) });
}
function freeze(value) {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function bundle(entry = encounter(), card = patient()) {
  return JSON.parse(core.serializeBundle([entry], [card]));
}
function values(kind = "primary", text = "Вымышленный основной диагноз (МКБ-10: Z00.0)") { return { kind, text }; }
function diagnosed() { return core.upsertDiagnosis(encounter(), values(), { now: NOW }); }
function reviewed(entry) {
  const copy = structuredClone(entry);
  if (!copy.draft.text) copy.draft = { text: "Ручная формулировка врача", generatedAt: NOW, sourceFingerprint: core.fingerprint(entry) };
  return core.setReviewStatus(copy, "reviewed", { now: NOW });
}

test("full years use visit calendar date, including same day, prior birthday and historical visits", () => {
  assert.equal(core.calculateAge("2000-10-20", "2026-10-19"), 25);
  assert.equal(core.calculateAge("2000-10-20", "2026-10-20"), 26);
  assert.equal(core.calculateAge("2000-10-20", "2026-10-21"), 26);
  assert.equal(core.calculateAge("2026-10-20", "2026-10-20"), 0);
  assert.equal(core.calculateAge("2000-10-20", "2010-01-01"), 9);
  assert.equal(core.calculateAge("0001-01-01", "0099-01-01"), 98);
});

test("February 29 birthdays advance March 1 in non-leap years, independent of host timezone", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "Europe/Minsk", "Pacific/Honolulu", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      assert.equal(core.calculateAge("2000-02-29", "2025-02-28"), 24, zone);
      assert.equal(core.calculateAge("2000-02-29", "2025-03-01"), 25, zone);
      assert.equal(core.calculateAge("2000-02-29", "2024-02-28"), 23, zone);
      assert.equal(core.calculateAge("2000-02-29", "2024-02-29"), 24, zone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("age calculator rejects nonexistent, non-ISO and reversed dates without inventing age", () => {
  for (const invalid of ["", "2000-02-30", "1900-02-29", "2025-02-29", "0000-01-01", "2000-13-01", "2000-1-01", "20.10.2000", "2000-01-01T00:00:00Z", null, 2000, {}, " 2000-01-01"]) {
    assert.equal(core.calculateAge(invalid, "2026-10-20"), null);
    assert.equal(core.calculateAge("2000-01-01", invalid), null);
  }
  assert.equal(core.calculateAge("2026-10-21", "2026-10-20"), null);
});

test("optional birthday survives cloning, serialization and repository reads without changing legacy cards", () => {
  for (const date of [undefined, "", "2000-02-29"]) {
    const card = freeze(patient(date));
    const normalized = core.validateBundle(freeze(bundle(encounter(), card)));
    assert.deepEqual(normalized.patients[0], card);
    assert.notEqual(normalized.patients[0], card);
    const raw = core.serializeBundle([encounter()], [card]);
    assert.deepEqual(core.parseBundle(raw).patients[0], card);
    const memory = { getItem: key => key === KEY ? raw : null, setItem() { throw new Error("Не ожидается запись"); } };
    const loaded = createRepository(memory).load();
    assert.equal(loaded.error, null);
    assert.deepEqual(loaded.patients[0], card);
    assert.equal(Object.hasOwn(card, "birthDate"), date !== undefined);
  }
});

test("invalid birthday imports and dates before birth are rejected without writing storage", () => {
  for (const date of [null, 0, [], {}, " ", "2026-02-29", "0000-01-01", "2000-00-01"]) {
    const data = bundle();
    data.patients[0].birthDate = date;
    assert.ok(core.validatePatient(data.patients[0]).some(error => error.field === "birthDate"));
    assert.throws(() => core.parseBundle(JSON.stringify(data)), /дата рождения|birthDate/);
    assert.throws(() => patient(date), /дата рождения|birthDate/);
  }
  assert.throws(() => bundle(encounter(), patient("2026-10-21")), /раньше даты рождения/);
  assert.throws(() => bundle({ ...encounter(), visitDate: "" }, patient("2000-01-01")), /корректную дату приёма/);
  const data = bundle();
  data.patients[0].birthDate = "2026-10-21";
  const memory = { getItem: key => key === KEY ? JSON.stringify(data) : null, setItem() { throw new Error("Не ожидается запись"); } };
  assert.match(createRepository(memory).load().error, /раньше даты рождения/);
});

test("DOB-based encounter age rejects missing visit dates and different patients instead of using manual age", () => {
  const entry = encounter();
  entry.age = "83";
  assert.equal(core.encounterAge(entry), "83");
  assert.equal(core.encounterAge(entry, patient()), "83");
  assert.equal(core.encounterAge(entry, patient("")), "83");
  assert.equal(core.encounterAge(entry, patient("2000-10-21")), "25");
  assert.throws(() => core.encounterAge(entry, patient("2026-10-21")), /даты рождения/);
  assert.throws(() => core.encounterAge({ ...entry, visitDate: "" }, patient("2000-01-01")), /дату приёма/);
  assert.throws(() => core.encounterAge(entry, { ...patient("2000-01-01"), id: "other" }), /другому пациенту/);
  assert.throws(() => core.encounterAge(entry, { ...patient(), birthDate: "bad" }), /birthDate/);
});

test("age display preserves invalid editable values while draft generation and saving still reject the encounter", () => {
  const card = patient();
  for (const age of ["-1", "1.5", "не число"]) {
    const entry = freeze({ ...encounter(), age });
    assert.equal(core.encounterAge(entry), age);
    assert.equal(core.encounterAge(entry, card), age);
    assert.throws(() => core.generateDraft(entry, { patient: card, encounters: [entry] }), /age/);
    assert.throws(() => core.fingerprint(entry, { patient: card, encounters: [entry] }), /age/);
    assert.throws(() => core.serializeBundle([entry], [card]), /age/);
  }
  const entry = encounter();
  entry.age = "83";
  entry.vitals.pulse = "не число";
  freeze(entry);
  assert.equal(core.encounterAge(entry, card), "83");
  assert.equal(core.encounterAge(entry, patient("2000-10-21")), "25");
  assert.throws(() => core.generateDraft(entry, { patient: card, encounters: [entry] }), /vitals.pulse/);
  assert.throws(() => core.serializeBundle([entry], [card]), /vitals.pulse/);
  for (const invalid of [null, {}, { age: 3 }]) assert.throws(() => core.encounterAge(invalid, card), /строкой/);
});

test("generated draft uses age on visit date and birthday changes invalidate source without altering saved manual text", () => {
  const entry = freeze(reviewed(encounter()));
  const card = freeze(patient("2000-10-21"));
  const context = { patient: card, encounters: [entry] };
  assert.match(core.generateDraft(entry, context), /Возраст \(полных лет\): 25\./);
  const source = JSON.parse(core.fingerprint(entry, context));
  assert.equal(source.age, "25");
  assert.equal(source.birthDate, card.birthDate);
  assert.notEqual(core.fingerprint(entry, context), core.fingerprint(entry, { ...context, patient: patient("2000-10-20") }));
  assert.notEqual(core.fingerprint(entry, context), core.fingerprint(entry, { ...context, patient: patient("2000-10-22") }));
  assert.equal(entry.draft.text, "Ручная формулировка врача");
  assert.equal(entry.workflow.reviewStatus, "reviewed");
  assert.equal(core.fingerprint(entry, { ...context, patient: patient("") }), core.fingerprint(entry));
  assert.throws(() => core.generateDraft(entry, { ...context, patient: patient("2026-10-21") }), /даты рождения/);
  assert.throws(() => core.fingerprint(entry, { ...context, patient: patient("2026-10-21") }), /даты рождения/);
});

test("legacy diagnoses remain unchanged until an explicit mutation and effective list is a detached copy", () => {
  const entry = encounter();
  entry.assessment.summary = "  Старый вымышленный диагноз (МКБ-10: Z00.0)\nУточнение врача  ";
  freeze(entry);
  const fingerprint = core.fingerprint(entry);
  const draft = core.generateDraft(entry);
  const rows = core.getDiagnoses(entry);
  assert.deepEqual(rows, [{ id: "legacy-diagnosis", kind: "primary", text: entry.assessment.summary }]);
  rows[0].text = "Меняется только копия";
  assert.equal(core.fingerprint(entry), fingerprint);
  assert.equal(core.generateDraft(entry), draft);
  assert.deepEqual(core.parseBundle(core.serializeBundle([entry], [patient()])).encounters[0], entry);
  assert.deepEqual(core.getDiagnoses(encounter()), []);
  const empty = { ...entry, diagnoses: [] };
  assert.equal(core.fingerprint(empty), fingerprint);
  assert.equal(core.generateDraft(empty), draft);
  assert.equal(Object.hasOwn(core.validateBundle(bundle(empty)).encounters[0], "diagnoses"), false);
});

test("first explicit addition converts even maximum-length legacy text and retains diagnosis codes and custom wording", () => {
  const entry = encounter();
  entry.assessment.summary = "я".repeat(10000);
  const added = core.upsertDiagnosis(freeze(entry), values("complication", "Вымышленное осложнение (МКБ-10: Z00.1), уточнение"), { now: LATER });
  assert.equal(added.diagnoses.length, 2);
  assert.equal(added.diagnoses[0].id, "legacy-diagnosis");
  assert.equal(added.diagnoses[0].text, entry.assessment.summary);
  assert.equal(added.diagnoses[1].kind, "complication");
  assert.match(added.assessment.summary, /Осложнение: Вымышленное осложнение \(МКБ-10: Z00\.1\), уточнение$/);
  assert.deepEqual(core.validateEncounter(added), []);
  assert.equal(Object.hasOwn(entry, "diagnoses"), false);
});

test("diagnosis add, edit, remove and reordering are immutable, reset review and preserve manual draft", () => {
  const original = freeze(reviewed(diagnosed()));
  const firstId = original.diagnoses[0].id;
  const added = core.upsertDiagnosis(original, freeze(values("comorbidity", "Вымышленное сопутствующее заболевание (МКБ-10: Z00.2)")), { now: LATER });
  assert.equal(added.updatedAt, LATER);
  assert.equal(added.workflow.reviewStatus, "draft");
  assert.equal(added.workflow.reviewedAt, "");
  assert.deepEqual(added.draft, original.draft);
  assert.notEqual(added.draft, original.draft);
  assert.equal(original.diagnoses.length, 1);
  const edited = core.upsertDiagnosis(freeze(reviewed(added)), values("primary", "Основной после уточнения (МКБ-10: Z00.3)"), { id: firstId, now: LATER });
  assert.equal(edited.diagnoses[0].id, firstId);
  assert.match(edited.assessment.summary, /Основной после уточнения/);
  assert.equal(edited.workflow.reviewStatus, "draft");
  const moved = core.moveDiagnosis(freeze(reviewed(edited)), firstId, 1, { now: LATER });
  assert.equal(moved.diagnoses[1].id, firstId);
  assert.ok(moved.assessment.summary.startsWith("Сопутствующее заболевание:"));
  assert.ok(core.generateDraft(moved).includes("Диагнозы:\n" + moved.assessment.summary));
  assert.equal(moved.workflow.reviewStatus, "draft");
  assert.deepEqual(moved.draft, edited.draft);
  const removed = core.removeDiagnosis(freeze(reviewed(moved)), firstId, { now: LATER });
  assert.equal(removed.diagnoses.length, 1);
  assert.equal(removed.workflow.reviewStatus, "draft");
  assert.deepEqual(removed.draft, original.draft);
});

test("removing the last structured or legacy diagnosis clears summary and omits optional list", () => {
  const entry = freeze(reviewed(diagnosed()));
  const empty = core.removeDiagnosis(entry, entry.diagnoses[0].id, { now: LATER });
  assert.equal(empty.assessment.summary, "");
  assert.equal(Object.hasOwn(empty, "diagnoses"), false);
  assert.equal(empty.draft.text, entry.draft.text);
  const legacy = encounter();
  legacy.assessment.summary = "Вымышленная прежняя запись";
  const removed = core.removeDiagnosis(freeze(legacy), "legacy-diagnosis");
  assert.equal(removed.assessment.summary, "");
  assert.equal(Object.hasOwn(removed, "diagnoses"), false);
});

test("boundary moves return an independent unchanged record and invalid changes fail without mutating", () => {
  const entry = freeze(reviewed(diagnosed()));
  const id = entry.diagnoses[0].id;
  const before = JSON.stringify(entry);
  for (const direction of [-1, 1]) {
    const unchanged = core.moveDiagnosis(entry, id, direction, { now: LATER });
    assert.deepEqual(unchanged, entry);
    assert.notEqual(unchanged, entry);
    assert.notEqual(unchanged.diagnoses[0], entry.diagnoses[0]);
  }
  for (const idValue of ["missing", "", null, 8]) {
    assert.throws(() => core.upsertDiagnosis(entry, values(), { id: idValue }), /не найден/);
    assert.throws(() => core.removeDiagnosis(entry, idValue), /не найден/);
    assert.throws(() => core.moveDiagnosis(entry, idValue, 1), /не найден/);
  }
  for (const direction of [0, 2, "1", null]) assert.throws(() => core.moveDiagnosis(entry, id, direction), /перемещение/);
  for (const options of [{ unexpected: true }, { now: "bad" }]) {
    assert.throws(() => core.upsertDiagnosis(entry, values("comorbidity"), options));
    assert.throws(() => core.removeDiagnosis(entry, id, options));
    assert.throws(() => core.moveDiagnosis(entry, id, 1, options));
  }
  for (const bad of [null, {}, { kind: "primary" }, { text: "a" }, { ...values(), unknown: true }]) assert.throws(() => core.upsertDiagnosis(entry, bad), /структура/);
  assert.equal(JSON.stringify(entry), before);
});

test("diagnosis backup validation rejects malformed rows, duplicates, multiple primary and unsynchronized summary", () => {
  const valid = diagnosed().diagnoses[0];
  const malformed = [null, {}, "text", [null], [[]], [true], new Array(1),
    [{ ...valid, unknown: true }], [{ ...valid, id: "-bad" }], [{ ...valid, id: "я" }], [{ ...valid, id: "x".repeat(81) }],
    [{ ...valid, kind: "other" }], [{ ...valid, text: " \n" }], [{ ...valid, text: "я".repeat(10001) }],
    [valid, { ...valid }], [valid, { ...valid, id: "other" }]];
  for (const field of ["id", "kind", "text"]) {
    const missing = { ...valid };
    delete missing[field];
    malformed.push([missing], [{ ...valid, [field]: null }], [{ ...valid, [field]: 3 }]);
  }
  for (const rows of malformed) {
    const entry = { ...encounter(), diagnoses: rows };
    assert.ok(core.validateEncounter(entry).length, JSON.stringify(rows));
    assert.throws(() => core.serializeBundle([entry], [patient()]));
  }
  const wrongSummary = diagnosed();
  wrongSummary.assessment.summary = "Другой диагноз";
  assert.ok(core.validateEncounter(wrongSummary).some(error => error.field === "assessment.summary"));
  assert.throws(() => core.serializeBundle([wrongSummary], [patient()]), /не соответствует/);
});

test("diagnosis row count, row text and combined summary enforce stated boundaries", () => {
  assert.equal(core.MAX_DIAGNOSES, 30);
  assert.equal(core.MAX_DIAGNOSIS_TEXT_LENGTH, 10000);
  assert.equal(core.MAX_DIAGNOSIS_SUMMARY_LENGTH, 100000);
  const rows = Array.from({ length: 30 }, (_, index) => ({ id: "d-" + index, kind: index === 0 ? "primary" : "comorbidity", text: "Вымышленный диагноз " + index }));
  const entry = { ...encounter(), diagnoses: rows };
  entry.assessment.summary = core.formatDiagnoses(rows);
  assert.deepEqual(core.validateEncounter(entry), []);
  assert.throws(() => core.upsertDiagnosis(entry, values("complication")), /не более 30/);
  assert.doesNotThrow(() => core.upsertDiagnosis(entry, values("primary", "я".repeat(10000)), { id: "d-0" }));
  assert.throws(() => core.upsertDiagnosis(entry, values("primary", "я".repeat(10001)), { id: "d-0" }), /10000/);
  const oversized = Array.from({ length: 10 }, (_, index) => ({ id: "large-" + index, kind: "comorbidity", text: "я".repeat(10000) }));
  assert.ok(core.validateDiagnoses(oversized).some(error => /Общий текст/.test(error.message)));
  assert.throws(() => core.formatDiagnoses(oversized), /Общий текст/);
});

test("schema four preserves structured diagnosis order, birthdate, manual text and detached rows on round-trip", () => {
  const entry = core.upsertDiagnosis(reviewed(diagnosed()), values("complication", "Вымышленное осложнение"), { now: LATER });
  const card = patient("2000-01-01");
  const backup = freeze(bundle(entry, card));
  const normalized = core.validateBundle(backup);
  assert.equal(normalized.schemaVersion, 4);
  assert.deepEqual(normalized.encounters[0], entry);
  assert.deepEqual(normalized.patients[0], card);
  assert.notEqual(normalized.encounters[0].diagnoses[0], backup.encounters[0].diagnoses[0]);
  normalized.encounters[0].diagnoses[0].text = "Изменена только копия";
  assert.notEqual(entry.diagnoses[0].text, normalized.encounters[0].diagnoses[0].text);
  assert.deepEqual(core.parseBundle(core.serializeBundle([entry], [card])).encounters[0], entry);
});

test("legacy schema three rejects new birthday and diagnoses extensions while unchanged legacy data still imports", () => {
  const legacy = bundle();
  legacy.schemaVersion = 3;
  delete legacy.encounters[0].workflow;
  assert.equal(core.parseBundle(JSON.stringify(legacy)).schemaVersion, 4);
  for (const diagnoses of [[], diagnosed().diagnoses]) {
    const changed = structuredClone(legacy);
    changed.encounters[0].diagnoses = diagnoses;
    assert.throws(() => core.parseBundle(JSON.stringify(changed)), /diagnoses.*Неизвестное поле/);
  }
  for (const date of ["", "2000-01-01"]) {
    const changed = structuredClone(legacy);
    changed.patients[0].birthDate = date;
    assert.throws(() => core.parseBundle(JSON.stringify(changed)), /Дата рождения не поддерживается/);
  }
});

test("diagnosis order and kind affect source fingerprint and fresh repeats have no diagnoses even with explicit history carry", () => {
  const entry = core.upsertDiagnosis(diagnosed(), values("complication", "Вымышленное осложнение"), { now: NOW });
  entry.history.conditions = "Только выбранные сведения анамнеза";
  const original = core.fingerprint(entry);
  const moved = core.moveDiagnosis(entry, entry.diagnoses[1].id, -1, { now: LATER });
  assert.notEqual(core.fingerprint(moved), original);
  const changedKind = core.upsertDiagnosis(entry, values("comorbidity", entry.diagnoses[1].text), { id: entry.diagnoses[1].id, now: LATER });
  assert.notEqual(core.fingerprint(changedKind), original);
  const repeat = core.createRepeatEncounter(freeze(entry), { id: "repeat-visit", now: LATER, carryHistoryFields: ["conditions"] });
  assert.equal(repeat.history.conditions, entry.history.conditions);
  assert.equal(repeat.assessment.summary, "");
  assert.equal(Object.hasOwn(repeat, "diagnoses"), false);
  assert.equal(core.getPatientBriefing(patient(), [entry], "2026-10-20").diagnoses[0].text, entry.assessment.summary);
});
