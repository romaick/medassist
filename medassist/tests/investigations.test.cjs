"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../app/core.js");
const { createRepository, KEY } = require("../app/storage.js");
const NOW = "2032-04-19T09:00:00.000Z";
const LATER = "2032-04-23T09:00:00.000Z";
const FIELDS = ["kind", "date", "name", "result", "unit", "reference", "note"];
function patient() { return core.createPatient({ id: "investigation-patient", label: "Вымышленный Пациент", now: NOW }); }
function encounter() {
  const result = core.createEncounter({ id: "investigation-visit", patientId: patient().id, now: NOW });
  result.visitDate = NOW.slice(0, 10);
  return result;
}
function values(overrides = {}) {
  return { kind: "lab", date: "2032-04-19", name: "Демонстрационный показатель А", result: " 12,50 ", unit: "усл. ед.", reference: "Из вымышленного бланка: 8–15", note: "Только вымышленные данные", ...overrides };
}
function entry(id, overrides = {}) { return { id, ...values(overrides) }; }
function withResults(entries) { return { ...patient(), investigations: entries }; }
function freeze(value) {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function memoryStorage(raw = null) {
  return { raw, getItem(key) { return key === KEY ? this.raw : null; }, setItem(key, value) { assert.equal(key, KEY); this.raw = value; } };
}
function pair(first, second, overrides = {}) {
  return withResults([entry("result-first", { result: first, date: "2032-04-19", ...overrides }), entry("result-second", { result: second, date: "2032-04-23", ...overrides })]);
}

test("old cards remain unchanged and an empty results array is omitted from schema four backups", () => {
  const original = freeze(patient());
  assert.equal(Object.hasOwn(original, "investigations"), false);
  const data = core.parseBundle(core.serializeBundle([], [original]));
  assert.deepEqual(data.patients, [original]);
  assert.deepEqual(core.getInvestigationSeries(original), []);
  const empty = { ...original, investigations: [] };
  assert.deepEqual(core.validatePatient(empty), []);
  assert.deepEqual(core.parseBundle(core.serializeBundle([], [empty])).patients, [original]);
  assert.equal(core.SCHEMA_VERSION, 4);
});

test("result backup round-trips preserve raw strings and deep-clone records without creating visits", () => {
  const original = freeze(withResults([entry("result-a"), entry("result-b", { kind: "study", name: "Демонстрационное исследование", result: "Вымышленное текстовое заключение\nПродолжение", unit: "", reference: "" })]));
  const serialized = core.serializeBundle([], [original]);
  const parsed = core.parseBundle(serialized);
  assert.deepEqual(parsed.encounters, []);
  assert.deepEqual(parsed.patients, [original]);
  assert.equal(parsed.patients[0].investigations[0].result, " 12,50 ");
  assert.notEqual(parsed.patients[0].investigations, original.investigations);
  assert.notEqual(parsed.patients[0].investigations[0], original.investigations[0]);
  parsed.patients[0].investigations[0].reference = "Только в копии";
  assert.equal(original.investigations[0].reference, "Из вымышленного бланка: 8–15");
});

test("legacy schema three rejects the extension while schema one through three still import existing data", () => {
  for (const version of [1, 2, 3]) {
    const data = JSON.parse(core.serializeBundle([encounter()], [patient()]));
    data.schemaVersion = version;
    delete data.encounters[0].workflow;
    if (version < 3) { delete data.patients; delete data.encounters[0].patientId; }
    if (version === 1) {
      delete data.encounters[0].examSelections;
      for (const field of ["returnVisitDate", "sickLeaveIssued", "sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"]) delete data.encounters[0].assessment[field];
    }
    const imported = core.parseBundle(JSON.stringify(data));
    assert.equal(imported.schemaVersion, 4);
    assert.equal(Object.hasOwn(imported.patients[0], "investigations"), false);
    if (version === 3) {
      for (const investigations of [[], [entry("result-a")]]) {
        data.patients[0].investigations = investigations;
        assert.throws(() => core.parseBundle(JSON.stringify(data)), /исследования не поддерживаются.*3/);
      }
    }
  }
});

test("result validation rejects malformed structures, sparse arrays, duplicate IDs and every missing or non-string field", () => {
  const valid = entry("result-a");
  const invalid = [null, {}, "", 42, [null], [[]], [true], new Array(1), [{ ...valid, extra: "" }],
    [{ ...valid, id: "-invalid" }], [{ ...valid, id: "невалидный" }], [{ ...valid, id: "a".repeat(81) }], [valid, { ...valid }]];
  for (const field of ["id", ...FIELDS]) {
    const missing = { ...valid };
    delete missing[field];
    invalid.push([missing], [{ ...valid, [field]: null }], [{ ...valid, [field]: 12 }]);
  }
  for (const investigations of invalid) {
    assert.ok(core.validateInvestigations(investigations).length, JSON.stringify(investigations));
    assert.ok(core.validatePatient(withResults(investigations)).length);
    assert.throws(() => core.serializeBundle([], [withResults(investigations)]));
  }
  assert.ok(core.validatePatient({ ...patient(), unexpected: "field" }).some(error => error.field === "unexpected"));
});

test("only supported kinds and actual calendar dates are accepted, and name/result must be nonblank", () => {
  for (const date of ["", "2032-02-30", "2031-02-29", "0000-01-01", "10000-01-01", "2032-04-31", "2032-13-01", "19.04.2032", "2032-4-19"]) {
    assert.ok(core.validateInvestigations([entry("a", { date })]).some(error => error.field.endsWith(".date")), date);
  }
  for (const date of ["0001-01-01", "2032-02-29", "9999-12-31"]) assert.deepEqual(core.validateInvestigations([entry("a", { date })]), []);
  for (const kind of ["", "LAB", "other"]) assert.ok(core.validateInvestigations([entry("a", { kind })]).some(error => error.field.endsWith(".kind")));
  for (const field of ["name", "result"]) {
    for (const empty of ["", " \t\n"]) assert.ok(core.validateInvestigations([entry("a", { [field]: empty })]).some(error => error.field.endsWith("." + field)));
  }
  assert.deepEqual(core.validateInvestigations([entry("a", { unit: "", reference: "", note: "" })]), []);
});

test("five hundred entries and exact field boundaries are accepted while every overflow is rejected", () => {
  assert.equal(core.MAX_INVESTIGATIONS, 500);
  assert.deepEqual(core.INVESTIGATION_FIELD_LIMITS, { name: 200, result: 2000, unit: 80, reference: 500, note: 1000 });
  const boundary = Object.fromEntries(Object.entries(core.INVESTIGATION_FIELD_LIMITS).map(([field, limit]) => [field, "я".repeat(limit)]));
  const card = withResults(Array.from({ length: 500 }, (_, index) => entry("result-" + index, boundary)));
  assert.deepEqual(core.validatePatient(card), []);
  assert.throws(() => core.upsertInvestigation(freeze(card), values()), /не более 500/);
  assert.doesNotThrow(() => core.upsertInvestigation(card, values(), { id: "result-250", now: LATER }));
  for (const field of Object.keys(boundary)) {
    assert.ok(core.validateInvestigations([entry("a", { ...boundary, [field]: boundary[field] + "я" })]).some(error => error.field.endsWith("." + field)));
  }
});

test("adding and editing results preserve source objects and set only the patient update time", () => {
  const original = freeze(patient());
  const added = core.upsertInvestigation(original, freeze(values()), { now: NOW });
  assert.equal(Object.hasOwn(original, "investigations"), false);
  assert.equal(added.updatedAt, NOW);
  const id = added.investigations[0].id;
  assert.ok(id.startsWith("investigation-"));
  const both = core.upsertInvestigation(freeze(added), values({ name: "Демонстрационный показатель Б" }), { now: LATER });
  assert.equal(both.investigations.length, 2);
  assert.notEqual(both.investigations[1].id, id);
  assert.notEqual(both.investigations[0], added.investigations[0]);
  const edited = core.upsertInvestigation(freeze(both), values({ result: "13,00", reference: "Иная строка из вымышленного бланка" }), { id, now: LATER });
  assert.equal(edited.investigations.length, 2);
  assert.equal(edited.investigations[0].id, id);
  assert.equal(edited.investigations[0].result, "13,00");
  assert.equal(both.investigations[0].result, " 12,50 ");
  assert.equal(edited.updatedAt, LATER);
  for (const field of ["id", "label", "createdAt"]) assert.equal(edited[field], original[field]);
});

test("removing a result deep-clones survivors and drops the optional property after the last deletion", () => {
  const original = freeze(withResults([entry("a"), entry("b", { name: "Демо Б" })]));
  const remaining = core.removeInvestigation(original, "a", { now: LATER });
  assert.deepEqual(remaining.investigations, [original.investigations[1]]);
  assert.notEqual(remaining.investigations[0], original.investigations[1]);
  assert.equal(remaining.updatedAt, LATER);
  assert.equal(original.investigations.length, 2);
  const empty = core.removeInvestigation(freeze(remaining), "b", { now: LATER });
  assert.equal(Object.hasOwn(empty, "investigations"), false);
  assert.deepEqual(core.validatePatient(empty), []);
});

test("invalid CRUD targets, values, timestamps and options never mutate the original card", () => {
  const original = freeze(withResults([entry("a")]));
  const snapshot = JSON.stringify(original);
  for (const id of ["missing", "", null, 5]) {
    assert.throws(() => core.upsertInvestigation(original, values(), { id }), /не найден/);
    assert.throws(() => core.removeInvestigation(original, id), /не найден/);
  }
  for (const invalid of [null, [], {}, { ...values(), id: "injected" }, { ...values(), extra: "" }, values({ result: "" }), values({ date: "2032-02-30" }), values({ unit: 4 })]) {
    assert.throws(() => core.upsertInvestigation(original, invalid));
  }
  for (const now of ["invalid", "0000-01-01", "+010000-01-01"]) {
    assert.throws(() => core.upsertInvestigation(original, values(), { now }), /время/);
    assert.throws(() => core.removeInvestigation(original, "a", { now }), /время/);
  }
  for (const options of [null, [], { unknown: true }]) assert.throws(() => core.upsertInvestigation(original, values(), options), /параметры/);
  assert.throws(() => core.removeInvestigation(original, "a", { id: "b" }), /параметры/);
  assert.equal(JSON.stringify(original), snapshot);
});

test("series group normalized names but keep result kind and case-sensitive units separate", () => {
  const original = freeze(withResults([
    entry("a", { name: "  ДЕМО   Ёлка ", unit: "усл.   ед.", date: "2032-04-19" }),
    entry("b", { name: "демо елка", unit: " усл. ед. ", date: "2032-04-23" }),
    entry("c", { name: "демо елка", unit: "УСЛ. ЕД." }),
    entry("d", { name: "демо елка", unit: "усл. ед.", kind: "study" }),
    entry("e", { name: "Другое название", unit: "усл. ед." }),
    entry("f", { name: "демо елка", unit: "" }),
    entry("g", { name: "демо елка", unit: " \t ", date: "2032-04-23" })
  ]));
  const series = core.getInvestigationSeries(original);
  assert.equal(series.length, 5);
  const matching = series.find(item => item.results.some(result => result.id === "a"));
  assert.equal(matching.key, JSON.stringify(["lab", "демо елка", "усл. ед."]));
  assert.equal(matching.name, "ДЕМО Ёлка");
  assert.equal(matching.unit, "усл. ед.");
  assert.deepEqual(matching.results.map(item => item.id), ["a", "b"]);
  assert.equal(matching.numeric, true);
  assert.equal(matching.results[0].name, "  ДЕМО   Ёлка ");
  assert.notEqual(matching.results[0], original.investigations[0]);
  const noUnit = series.find(item => item.unit === "");
  assert.deepEqual(noUnit.results.map(item => item.id), ["f", "g"]);
});

test("numeric dynamics sort by date, show all points and compare the two latest dates", () => {
  const original = freeze(withResults([
    entry("c", { date: "2032-04-23", result: "8.5" }),
    entry("a", { date: "2032-04-01", result: "+12,5" }),
    entry("b", { date: "2032-04-19", result: " 10,5 " })
  ]));
  const [series] = core.getInvestigationSeries(original);
  assert.equal(series.numeric, true);
  assert.equal(series.reason, "");
  assert.equal(series.delta, -2);
  assert.equal(series.referenceChanged, false);
  assert.deepEqual(series.points, [
    { id: "a", date: "2032-04-01", value: 12.5 },
    { id: "b", date: "2032-04-19", value: 10.5 },
    { id: "c", date: "2032-04-23", value: 8.5 }
  ]);
  assert.deepEqual(original.investigations.map(item => item.id), ["c", "a", "b"]);
  assert.deepEqual(series.results.map(item => item.result), ["+12,5", " 10,5 ", "8.5"]);
});

test("numeric parsing accepts only complete finite decimal strings while retaining every text row", () => {
  for (const [raw, expected] of [["0", 0], ["-0", -0], ["-1,25", -1.25], ["+.5", 0.5], [" ,5 ", 0.5], ["0012.50", 12.5]]) {
    const [series] = core.getInvestigationSeries(pair(raw, "2"));
    assert.equal(series.numeric, true, raw);
    assert.equal(series.points[0].value, expected, raw);
    assert.equal(series.results[0].result, raw);
  }
  for (const raw of ["<5", "≤ 5", ">7", "5–7", "5-7", "7 усл. ед.", "1e3", "0x10", "NaN", "Infinity", "1 000", "1.2.3", "1,234.5", "1.", ".", "Обнаружено", "1".repeat(310)]) {
    const [series] = core.getInvestigationSeries(pair(raw, "2"));
    assert.equal(series.numeric, false, raw);
    assert.equal(series.reason, "non-numeric", raw);
    assert.deepEqual(series.points, []);
    assert.equal(series.delta, null);
    assert.equal(series.results.length, 2);
    assert.equal(series.results[0].result, raw);
  }
});

test("mixed text series are not partially charted and a single result has no numeric dynamics", () => {
  const [mixed] = core.getInvestigationSeries(withResults([
    entry("a", { result: "12", date: "2032-04-01" }),
    entry("b", { result: "Вымышленное заключение", date: "2032-04-19" }),
    entry("c", { result: "10", date: "2032-04-23" })
  ]));
  assert.equal(mixed.reason, "non-numeric");
  assert.equal(mixed.results.length, 3);
  assert.deepEqual(mixed.points, []);
  for (const result of ["5", "Вымышленное заключение"]) {
    const [one] = core.getInvestigationSeries(withResults([entry("a", { result })]));
    assert.equal(one.reason, "insufficient");
    assert.equal(one.numeric, false);
    assert.deepEqual(one.points, []);
    assert.equal(one.delta, null);
  }
});

test("repeated dates block numeric charting without inventing same-day chronology and reason precedence is stable", () => {
  const card = withResults([
    entry("z", { result: "7", date: "2032-04-19" }),
    entry("a", { result: "8", date: "2032-04-19" }),
    entry("b", { result: "9", date: "2032-04-23" })
  ]);
  const [series] = core.getInvestigationSeries(card);
  assert.equal(series.reason, "duplicate-date");
  assert.equal(series.numeric, false);
  assert.deepEqual(series.points, []);
  assert.equal(series.delta, null);
  assert.deepEqual(series.results.map(item => item.id), ["a", "z", "b"]);
  card.investigations[1].result = "<8";
  assert.equal(core.getInvestigationSeries(card)[0].reason, "non-numeric");
});

test("reference differences are reported as source string differences without interpreting ranges", () => {
  const original = pair("50", "-10");
  assert.equal(core.getInvestigationSeries(original)[0].referenceChanged, false);
  for (const reference of ["Иная норма из бланка", "", "Из вымышленного бланка: 8–15 "]) {
    original.investigations[1].reference = reference;
    const [series] = core.getInvestigationSeries(original);
    assert.equal(series.referenceChanged, true);
    assert.equal(series.numeric, true);
    assert.equal(series.delta, -60);
    assert.equal(series.results[1].reference, reference);
    assert.deepEqual(Object.keys(series).sort(), ["key", "kind", "name", "unit", "results", "numeric", "reason", "points", "delta", "referenceChanged"].sort());
  }
});

test("finite numeric points never expose a non-finite delta on overflow", () => {
  const huge = "1" + "0".repeat(308);
  const [series] = core.getInvestigationSeries(pair("-" + huge, huge));
  assert.equal(series.numeric, true);
  assert.equal(series.reason, "");
  assert.ok(series.points.every(point => Number.isFinite(point.value)));
  assert.equal(series.delta, null);
  const [zero] = core.getInvestigationSeries(pair("0", "-0"));
  assert.equal(zero.delta, 0);
});

test("results do not alter existing visits, manual drafts, review state or source fingerprints", () => {
  const initial = encounter();
  initial.draft.text = "Ручная вымышленная запись";
  initial.draft.sourceFingerprint = core.fingerprint(initial);
  initial.draft.generatedAt = NOW;
  const reviewed = freeze(core.setReviewStatus(initial, "reviewed", { now: NOW }));
  const original = freeze(patient());
  const originalDraft = core.generateDraft(reviewed, { patient: original, encounters: [reviewed] });
  const originalFingerprint = core.fingerprint(reviewed, { patient: original, encounters: [reviewed] });
  const added = core.upsertInvestigation(original, values(), { now: LATER });
  const edited = core.upsertInvestigation(added, values({ result: "14" }), { id: added.investigations[0].id, now: LATER });
  const removed = core.removeInvestigation(edited, edited.investigations[0].id, { now: LATER });
  for (const card of [added, edited, removed]) {
    const parsed = core.parseBundle(core.serializeBundle([reviewed], [card]));
    assert.deepEqual(parsed.encounters, [reviewed]);
    assert.equal(core.generateDraft(reviewed, { patient: card, encounters: [reviewed] }), originalDraft);
    assert.equal(core.fingerprint(reviewed, { patient: card, encounters: [reviewed] }), originalFingerprint);
  }
});

test("journal actions and linked encounter actions preserve independent results through every patient normalizer", () => {
  const original = freeze(withResults([entry("a")]));
  const issued = core.issueSickLeave(original, { number: "ДЕМО-14", from: "2032-04-19", to: "2032-04-23", now: NOW });
  const leaveId = issued.sickLeaves[0].id;
  const extended = core.extendSickLeave(freeze(issued), leaveId, { from: "2032-04-23", to: "2032-04-27", now: LATER });
  const closed = core.closeSickLeave(freeze(extended), leaveId, { date: "2032-04-27", now: LATER });
  const undone = core.undoSickLeaveAction(freeze(closed), leaveId, { now: LATER });
  const linked = core.applyEncounterSickLeave(original, encounter(), { type: "issue", number: "ДЕМО-15", from: "2032-04-19", to: "2032-04-23", now: NOW });
  const unlinked = core.undoEncounterSickLeave(linked.patient, linked.encounter, [linked.encounter]);
  for (const card of [issued, extended, closed, undone, linked.patient, unlinked.patient]) {
    assert.deepEqual(card.investigations, original.investigations);
    assert.notEqual(card.investigations[0], original.investigations[0]);
  }
  const added = core.upsertInvestigation(issued, values({ result: "14" }), { now: LATER });
  assert.deepEqual(added.sickLeaves, issued.sickLeaves);
  assert.notEqual(added.sickLeaves[0].events[0], issued.sickLeaves[0].events[0]);
  const removed = core.removeInvestigation(added, added.investigations[1].id, { now: LATER });
  assert.deepEqual(removed.sickLeaves, issued.sickLeaves);
});

test("repository save, load and restore retain results and templates, while quota and malformed data preserve prior storage", () => {
  const card = withResults([entry("a")]);
  const visit = encounter();
  visit.assessment.plan = "Вымышленный план";
  const template = core.createVisitTemplate(visit, { kind: "recommendations", name: "Вымышленный шаблон", now: NOW });
  const storage = memoryStorage();
  const repository = createRepository(storage);
  assert.equal(repository.save([visit], [card], [template]).ok, true);
  assert.deepEqual(createRepository(storage).load().patients, [card]);
  const changed = core.upsertInvestigation(card, values({ result: "13" }), { id: "a", now: LATER });
  assert.equal(repository.save([visit], [changed]).ok, true);
  assert.deepEqual(core.parseBundle(storage.raw).templates, [template]);
  const beforeFailure = storage.raw;
  storage.setItem = () => { throw new Error("Вымышленный отказ записи"); };
  assert.equal(repository.save([visit], [card]).ok, false);
  assert.equal(storage.raw, beforeFailure);
  storage.setItem = function (key, value) { assert.equal(key, KEY); this.raw = value; };
  assert.equal(repository.save([visit], [withResults([entry("bad", { date: "2032-02-30" })])]).ok, false);
  assert.equal(storage.raw, beforeFailure);
  assert.equal(repository.reset([visit], [card], [template]).ok, true);
  assert.deepEqual(repository.load().patients, [card]);
  const corrupt = JSON.parse(storage.raw);
  corrupt.patients[0].investigations[0].date = "2032-02-30";
  storage.raw = JSON.stringify(corrupt);
  const corruptedRaw = storage.raw;
  const blocked = createRepository(storage);
  assert.match(blocked.load().error, /Автоматическая запись остановлена/);
  assert.equal(blocked.save([], []).ok, false);
  assert.equal(storage.raw, corruptedRaw);
  assert.equal(repository.reset().ok, true);
  assert.deepEqual(repository.load(), { patients: [], encounters: [], error: null });
});
