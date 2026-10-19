"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../app/core.js");
const examCatalog = require("../app/exam-options.js");
const { createRepository, KEY, PREVIOUS_KEY, V2_KEY, LEGACY_KEY, WATCHED_KEYS } = require("../app/storage.js");
const NOW = "2026-10-19T09:30:00.000Z";

function encounter(id = "test-visit-1") { return core.createEncounter({ now: NOW, id }); }
function patientsFor(encounters) { return [...new Set(encounters.map(data => data.patientId))].map(id => core.createPatient({ id, now: NOW })); }
function serialize(encounters, patients = patientsFor(encounters)) { return core.serializeBundle(encounters, patients); }
function bundle(encounters, patients = patientsFor(encounters)) { return JSON.parse(serialize(encounters, patients)); }
function memoryStorage(initial = null, legacy = null, v2 = null, previous = null) {
  const values = new Map([[KEY, initial], [PREVIOUS_KEY, previous], [V2_KEY, v2], [LEGACY_KEY, legacy]]);
  let writes = 0;
  const reads = [];
  return {
    getItem(key) { assert.ok(values.has(key)); reads.push(key); return values.get(key); },
    setItem(key, value) { assert.equal(key, KEY); values.set(key, value); writes += 1; },
    get raw() { return values.get(KEY); },
    get legacyRaw() { return values.get(LEGACY_KEY); },
    get previousRaw() { return values.get(PREVIOUS_KEY); },
    get v2Raw() { return values.get(V2_KEY); },
    get reads() { return reads; },
    get writes() { return writes; }
  };
}

function previousBundle(data = encounter()) {
  const value = bundle([data]);
  value.schemaVersion = 2;
  delete value.patients;
  delete value.encounters[0].patientId;
  delete value.encounters[0].workflow;
  return value;
}

function version3Bundle(encounters, patients = patientsFor(encounters)) {
  const value = bundle(encounters, patients);
  value.schemaVersion = 3;
  for (const entry of value.encounters) delete entry.workflow;
  return value;
}

function legacyBundle(data = encounter()) {
  const value = previousBundle(data);
  value.schemaVersion = 1;
  delete value.encounters[0].examSelections;
  for (const field of ["returnVisitDate", "sickLeaveIssued", "sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"]) delete value.encounters[0].assessment[field];
  return value;
}

test("new encounters have independent, valid empty fields and a local visit date", () => {
  const first = encounter();
  const second = encounter("test-visit-2");
  assert.deepEqual(core.validateEncounter(first), []);
  const date = new Date(NOW);
  assert.equal(first.visitDate, [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"));
  first.history.complaints = "Changed";
  assert.equal(second.history.complaints, "");
  assert.equal(first.draft.text, "");
  assert.equal(core.SCHEMA_VERSION, 4);
  assert.deepEqual(Object.keys(first.examSelections), examCatalog.FIELDS.map(field => field.id));
  assert.ok(Object.values(first.examSelections).every(value => value === ""));
  assert.equal(core.createDemoEncounter({ now: NOW }).assessment.followUp, "");
  assert.equal(core.createDemoEncounter({ now: NOW }).assessment.sickLeaveIssued, "");
});

test("blank fields remain explicitly unfilled without inferred clinical findings", () => {
  const draft = core.generateDraft(encounter());
  assert.match(draft, /Только вымышленные данные/);
  assert.match(draft, /Неофициальный шаблон/);
  assert.match(draft, /Аллергии и реакции: не заполнено/);
  assert.match(draft, /Общий осмотр: не заполнено/);
  assert.match(draft, /Диагноз: не заполнено/);
  assert.doesNotMatch(draft, /Рекомендации|Повторный приём:|Дополнительный анамнез:|Другие данные осмотра:|Наблюдение|Листок нетрудоспособности/i);
  assert.doesNotMatch(draft, /без особенностей|аллерги[ийя] нет|в норме|удовлетворительное/i);
});

test("the explicit normal preset covers the catalog with valid findings and keeps encounters independent", () => {
  assert.ok(Object.isFrozen(examCatalog.NORMAL_SELECTIONS));
  assert.deepEqual(Object.keys(examCatalog.NORMAL_SELECTIONS), examCatalog.FIELDS.map(field => field.id));
  for (const field of examCatalog.FIELDS) {
    assert.ok(field.options.some(option => option.value === examCatalog.NORMAL_SELECTIONS[field.id]), field.id);
  }
  const data = encounter();
  Object.assign(data.examSelections, examCatalog.NORMAL_SELECTIONS);
  assert.deepEqual(core.validateEncounter(data), []);
  const draft = core.generateDraft(data);
  assert.match(draft, /Общее состояние удовлетворительное/);
  assert.match(draft, /Тоны сердца ритмичные/);
  assert.match(draft, /Тоны сердца ясные/);
  assert.match(draft, /Дыхание везикулярное/);
  assert.match(draft, /Живот при пальпации безболезненный/);
  assert.match(draft, /Сознание ясное/);
  const fingerprint = core.fingerprint(data);
  data.examSelections.heartRhythm = "irregular";
  assert.match(core.generateDraft(data), /Тоны сердца аритмичные/);
  assert.doesNotMatch(core.generateDraft(data), /Тоны сердца ритмичные/);
  assert.notEqual(core.fingerprint(data), fingerprint);
  assert.equal(examCatalog.NORMAL_SELECTIONS.heartRhythm, "regular");
  assert.ok(Object.values(encounter("another-visit").examSelections).every(value => value === ""));
});

test("optional free text appears only when filled and permanent medications have their new label", () => {
  const data = encounter();
  data.history.context = " \n\t ";
  data.exam.other = "\n ";
  data.assessment.plan = "\t ";
  assert.doesNotMatch(core.generateDraft(data), /Дополнительный анамнез:|Другие данные осмотра:|Рекомендации:/);
  data.history.context = "Дополнительные вымышленные сведения";
  data.exam.other = "Дополнительный вымышленный результат осмотра";
  data.assessment.plan = "Вручную внесённые рекомендации";
  data.history.medications = "Вымышленный препарат";
  const draft = core.generateDraft(data);
  assert.ok(draft.includes("Дополнительный анамнез: " + data.history.context));
  assert.ok(draft.includes("Другие данные осмотра: " + data.exam.other));
  assert.ok(draft.includes("Рекомендации: " + data.assessment.plan));
  assert.ok(draft.includes("Принимаемые препараты на постоянной основе: " + data.history.medications));
});

test("each catalog option generates its exact phrase only after selection and preserves written notes", () => {
  for (const field of examCatalog.FIELDS) {
    for (const option of field.options.filter(option => option.value !== "")) {
      const data = encounter();
      data.examSelections[field.id] = option.value;
      data.exam[field.section] = "Дополнение врача к разделу " + field.section;
      assert.deepEqual(core.validateEncounter(data), [], field.id + ": " + option.value);
      const before = JSON.stringify(data);
      const draft = core.generateDraft(data);
      assert.ok(draft.includes(option.text), field.id + ": " + option.value);
      assert.ok(draft.includes(data.exam[field.section]));
      assert.equal(JSON.stringify(data), before);
      data.examSelections[field.id] = "";
      assert.ok(!core.generateDraft(data).includes(option.text), field.id + ": cleared " + option.value);
    }
  }
});

test("catalog selections reject unknown values, fields and non-string values", () => {
  const field = examCatalog.FIELDS[0];
  for (const value of ["unsupported-value", false, null, {}, 1]) {
    const data = encounter();
    data.examSelections[field.id] = value;
    assert.ok(core.validateEncounter(data).some(error => error.field === "examSelections." + field.id));
    assert.throws(() => core.generateDraft(data));
  }
  const extra = encounter(); extra.examSelections.unexpected = "value";
  assert.ok(core.validateEncounter(extra).some(error => error.field === "examSelections.unexpected"));
  const missing = encounter(); delete missing.examSelections[field.id];
  assert.ok(core.validateEncounter(missing).some(error => error.field === "examSelections." + field.id));
});

test("heart rhythm and heart sound clarity remain independent selections in the generated note", () => {
  const data = encounter();
  const rhythm = examCatalog.FIELDS.find(field => field.id === "heartRhythm");
  const sounds = examCatalog.FIELDS.find(field => field.id === "heartSounds");
  assert.ok(rhythm);
  assert.ok(sounds);
  data.examSelections.heartRhythm = "irregular";
  data.examSelections.heartSounds = "muffled";
  const draft = core.generateDraft(data);
  assert.ok(draft.includes(rhythm.options.find(option => option.value === "irregular").text));
  assert.ok(draft.includes(sounds.options.find(option => option.value === "muffled").text));
  data.examSelections.heartSounds = "clear";
  const changed = core.generateDraft(data);
  assert.ok(changed.includes(rhythm.options.find(option => option.value === "irregular").text));
  assert.ok(changed.includes(sounds.options.find(option => option.value === "clear").text));
  assert.ok(!changed.includes(sounds.options.find(option => option.value === "muffled").text));
});

test("repeat visit uses a formatted calendar date and preserves legacy observation separately", () => {
  const data = encounter();
  data.assessment.returnVisitDate = "2026-11-05";
  data.assessment.followUp = "Обратиться при изменении жалоб — запись старой версии";
  const draft = core.generateDraft(data);
  assert.match(draft, /Повторный приём: 05\.11\.2026/);
  assert.ok(draft.includes("Наблюдение (из предыдущей версии): " + data.assessment.followUp));
  data.assessment.returnVisitDate = "";
  assert.doesNotMatch(core.generateDraft(data), /Повторный приём:/);
  for (const field of ["returnVisitDate", "sickLeaveFrom", "sickLeaveTo"]) {
    for (const value of ["2026-02-29", "2026-04-31", "2026-1-01", "0000-01-01", "завтра", 1]) {
      const invalid = encounter(); invalid.assessment[field] = value;
      assert.ok(core.validateEncounter(invalid).some(error => error.field === "assessment." + field), field + ": " + value);
    }
    const leap = encounter(); leap.assessment[field] = "2028-02-29";
    assert.deepEqual(core.validateEncounter(leap), []);
  }
});

test("sick leave is generated only when issued, with optional dates and validated date order", () => {
  const data = encounter();
  data.assessment.sickLeaveFrom = "2026-10-19";
  data.assessment.sickLeaveTo = "2026-10-22";
  for (const status of ["", "no"]) {
    data.assessment.sickLeaveIssued = status;
    assert.doesNotMatch(core.generateDraft(data), /Листок нетрудоспособности|19\.10\.2026 по 22\.10\.2026/);
    assert.deepEqual(core.parseBundle(serialize([data])).encounters[0].assessment, data.assessment);
  }
  data.assessment.sickLeaveIssued = "yes";
  assert.match(core.generateDraft(data), /Листок нетрудоспособности: выдан\. Период: с 19\.10\.2026 по 22\.10\.2026\./);
  data.assessment.sickLeaveTo = "";
  assert.match(core.generateDraft(data), /Листок нетрудоспособности: выдан\. Период: с 19\.10\.2026\./);
  data.assessment.sickLeaveFrom = "";
  assert.match(core.generateDraft(data), /Листок нетрудоспособности: выдан\.$/);
  data.assessment.sickLeaveTo = "2026-10-22";
  assert.match(core.generateDraft(data), /Листок нетрудоспособности: выдан\. Период: по 22\.10\.2026\./);
  data.assessment.sickLeaveFrom = "2026-10-23";
  assert.ok(core.validateEncounter(data).some(error => error.field === "assessment.sickLeaveTo"));
  data.assessment.sickLeaveIssued = "no";
  assert.deepEqual(core.validateEncounter(data), []);
  assert.doesNotMatch(core.generateDraft(data), /Листок нетрудоспособности/);
  data.assessment.sickLeaveIssued = "unknown";
  assert.ok(core.validateEncounter(data).some(error => error.field === "assessment.sickLeaveIssued"));
});

test("repeat visit is the last generated line after recommendations, legacy observation and sick leave", () => {
  const data = encounter();
  Object.assign(data.assessment, {
    summary: "Вымышленный диагноз",
    plan: "Вымышленные рекомендации",
    followUp: "Наблюдение прежней версии",
    returnVisitDate: "2026-11-05",
    sickLeaveIssued: "yes",
    sickLeaveNumber: "ДЕМО-12345",
    sickLeaveFrom: "2026-10-19",
    sickLeaveTo: "2026-10-22"
  });
  const lines = core.generateDraft(data).split("\n");
  assert.deepEqual(lines.slice(-5), [
    "Диагноз: Вымышленный диагноз",
    "Рекомендации: Вымышленные рекомендации",
    "Наблюдение (из предыдущей версии): Наблюдение прежней версии",
    "Листок нетрудоспособности: выдан. № ДЕМО-12345. Период: с 19.10.2026 по 22.10.2026. Календарных дней: 4.",
    "Повторный приём: 05.11.2026"
  ]);
  data.assessment.returnVisitDate = "";
  const withoutDate = core.generateDraft(data);
  assert.doesNotMatch(withoutDate, /Повторный приём:/);
  assert.equal(withoutDate.split("\n").at(-1), lines.at(-2));
});

test("sick leave number is entered manually, precedes dates and is omitted with inactive sick leave", () => {
  const data = encounter();
  data.assessment.sickLeaveNumber = "  ДЕМО-АБ/12345  ";
  data.assessment.sickLeaveFrom = "2026-10-19";
  data.assessment.sickLeaveTo = "2026-10-22";
  for (const status of ["", "no"]) {
    data.assessment.sickLeaveIssued = status;
    const draft = core.generateDraft(data);
    assert.doesNotMatch(draft, /ДЕМО-АБ\/12345|Листок нетрудоспособности|Период:/);
    assert.equal(core.parseBundle(serialize([data])).encounters[0].assessment.sickLeaveNumber, data.assessment.sickLeaveNumber);
  }
  data.assessment.sickLeaveIssued = "yes";
  assert.match(core.generateDraft(data), /Листок нетрудоспособности: выдан\. № ДЕМО-АБ\/12345\. Период: с 19\.10\.2026 по 22\.10\.2026\./);
  data.assessment.sickLeaveFrom = "";
  data.assessment.sickLeaveTo = "";
  assert.match(core.generateDraft(data), /Листок нетрудоспособности: выдан\. № ДЕМО-АБ\/12345\.$/);
  data.assessment.sickLeaveNumber = " \t ";
  assert.match(core.generateDraft(data), /Листок нетрудоспособности: выдан\.$/);
  data.assessment.sickLeaveNumber = 12345;
  assert.ok(core.validateEncounter(data).some(error => error.field === "assessment.sickLeaveNumber"));
  data.assessment.sickLeaveNumber = "x".repeat(10001);
  assert.ok(core.validateEncounter(data).some(error => error.field === "assessment.sickLeaveNumber"));
});

test("sick leave days include both dates across month, year and leap-year boundaries", () => {
  for (const [from, to, expected] of [
    ["2026-10-19", "2026-10-19", 1], ["2026-10-19", "2026-10-22", 4],
    ["2026-04-30", "2026-05-02", 3], ["2026-12-31", "2027-01-02", 3],
    ["2028-02-28", "2028-03-01", 3], ["2027-02-28", "2027-03-01", 2],
    ["1900-02-28", "1900-03-01", 2], ["2000-02-28", "2000-03-01", 3],
    ["2028-01-01", "2028-12-31", 366], ["0099-12-31", "0100-01-01", 2],
    ["0001-01-01", "0001-12-31", 365], ["9999-01-01", "9999-12-31", 365]
  ]) assert.equal(core.calculateSickLeaveDays(from, to), expected, from + " to " + to);
});

test("sick leave days stay unknown for incomplete, invalid or reversed dates", () => {
  for (const value of ["", " ", "2027-02-29", "2028-04-31", "2026-13-01", "0000-01-01", "10000-01-01", "19.10.2026", "2026-10-19T00:00:00Z", null, undefined, 20261019, {}, Symbol("date")]) {
    assert.equal(core.calculateSickLeaveDays(value, "2026-10-19"), null);
    assert.equal(core.calculateSickLeaveDays("2026-10-19", value), null);
  }
  assert.equal(core.calculateSickLeaveDays("2026-10-22", "2026-10-19"), null);
});

test("sick leave days are calendar counts across time zones and clock changes", () => {
  const {execFileSync} = require("node:child_process");
  const script = "const core=require(process.argv[1]);process.stdout.write(JSON.stringify([['2026-03-28','2026-03-30'],['2026-10-24','2026-10-26'],['2011-12-29','2011-12-31']].map(([from,to])=>core.calculateSickLeaveDays(from,to))));";
  for (const zone of ["UTC", "Europe/Minsk", "Europe/Berlin", "America/New_York", "Pacific/Apia"]) {
    const result = execFileSync(process.execPath, ["-e", script, path.resolve(__dirname, "../app/core.js")], {encoding: "utf8", env: {...process.env, TZ: zone}, windowsHide: true});
    assert.deepEqual(JSON.parse(result), [3, 3, 3], zone);
  }
});

test("sick leave days appear only for an issued complete period without mutating saved drafts or schema", () => {
  const data = encounter();
  Object.assign(data.assessment, {sickLeaveIssued: "yes", sickLeaveFrom: "2028-02-28", sickLeaveTo: "2028-03-01", returnVisitDate: "2028-03-02"});
  data.draft.text = "ДЕМО: ручной текст сохранить";
  const beforeEncounter = JSON.stringify(data);
  const before = serialize([data]);
  const generated = core.generateDraft(data);
  assert.match(generated, /Календарных дней: 3\./);
  assert.equal(generated.split("\n").at(-1), "Повторный приём: 02.03.2028");
  assert.equal(JSON.stringify(data), beforeEncounter);
  assert.deepEqual(core.parseBundle(before).encounters[0], data);
  for (const status of ["", "no"]) {
    data.assessment.sickLeaveIssued = status;
    assert.doesNotMatch(core.generateDraft(data), /Календарных дней|Листок нетрудоспособности/);
  }
  data.assessment.sickLeaveIssued = "yes";
  data.assessment.sickLeaveTo = "";
  assert.doesNotMatch(core.generateDraft(data), /Календарных дней/);
});

test("draft generation uses entered text, accepts a Russian decimal and never mutates the encounter", () => {
  const data = encounter();
  data.history.complaints = "Текст, введённый врачом <script>alert(1)</script>";
  data.vitals.temperature = "36,6";
  data.assessment.summary = "Ручное заключение";
  const before = JSON.stringify(data);
  const draft = core.generateDraft(data);
  assert.match(draft, /Температура: 36,6 °C/);
  assert.ok(draft.includes(data.history.complaints));
  assert.match(draft, /Ручное заключение/);
  assert.equal(JSON.stringify(data), before);
});

test("fingerprint detects source edits and ignores metadata, key ordering and manual draft edits", () => {
  const original = encounter();
  const copy = JSON.parse(JSON.stringify(original));
  copy.id = "another-id";
  copy.updatedAt = "2026-10-20T00:00:00.000Z";
  copy.draft.text = "Ручной текст";
  copy.history = Object.fromEntries(Object.entries(copy.history).reverse());
  assert.equal(core.fingerprint(copy), core.fingerprint(original));
  copy.history.allergies = "Вымышленное уточнение";
  assert.notEqual(core.fingerprint(copy), core.fingerprint(original));
});

test("fingerprint tracks selected exam findings, repeat date and sick leave details", () => {
  const data = encounter();
  const initial = core.fingerprint(data);
  data.examSelections.heartRhythm = "regular";
  assert.notEqual(core.fingerprint(data), initial);
  const selected = core.fingerprint(data);
  data.examSelections = Object.fromEntries(Object.entries(data.examSelections).reverse());
  assert.equal(core.fingerprint(data), selected);
  for (const [field, value] of [["returnVisitDate", "2026-11-01"], ["sickLeaveIssued", "yes"], ["sickLeaveNumber", "DEMO-1"], ["sickLeaveFrom", "2026-10-19"], ["sickLeaveTo", "2026-10-20"]]) {
    const before = core.fingerprint(data);
    data.assessment[field] = value;
    assert.notEqual(core.fingerprint(data), before, field);
  }
});

test("JSON round trip preserves manual draft independently of edited source fields", () => {
  const data = core.createDemoEncounter({ now: NOW, id: "demo-test" });
  data.examSelections.heartRhythm = "irregular";
  data.examSelections.heartSounds = "muffled";
  data.assessment.returnVisitDate = "2026-11-05";
  data.assessment.sickLeaveIssued = "yes";
  data.assessment.sickLeaveNumber = "DEMO-12345";
  data.assessment.sickLeaveFrom = "2026-10-19";
  data.assessment.sickLeaveTo = "2026-10-22";
  data.draft.text = "Черновик после ручной правки\nВторая строка <b>текст</b>";
  data.draft.generatedAt = NOW;
  data.draft.sourceFingerprint = core.fingerprint(data);
  data.history.complaints = "Обновлённое поле без перезаписи черновика";
  const restored = core.parseBundle("\uFEFF" + serialize([data])).encounters[0];
  assert.deepEqual(restored, data);
  assert.notEqual(restored.draft.sourceFingerprint, core.fingerprint(restored));
  assert.equal(restored.draft.text, data.draft.text);
});

test("version 1 import preserves every original field and manual draft while adding empty version 2 fields", () => {
  const original = encounter();
  for (const group of ["history", "exam", "assessment"]) {
    for (const field of Object.keys(original[group])) {
      if (!["returnVisitDate", "sickLeaveIssued", "sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"].includes(field)) original[group][field] = "  Вымышленное поле " + group + "." + field + "\nСохранить без изменения  ";
    }
  }
  original.draft = { text: "  Черновик врача\nПроизвольные ручные правки <текст>  ", generatedAt: NOW, sourceFingerprint: "legacy-source-fingerprint" };
  const oldBundle = legacyBundle(original);
  const oldBefore = JSON.stringify(oldBundle);
  const restoredBundle = core.parseBundle(oldBefore);
  const restored = restoredBundle.encounters[0];
  assert.equal(restoredBundle.schemaVersion, 4);
  assert.equal(restoredBundle.exportedAt, oldBundle.exportedAt);
  for (const [key, value] of Object.entries(oldBundle.encounters[0])) {
    if (key === "assessment") {
      for (const [field, text] of Object.entries(value)) assert.equal(restored.assessment[field], text);
    } else assert.deepEqual(restored[key], value, key);
  }
  assert.ok(Object.values(restored.examSelections).every(value => value === ""));
  for (const field of ["returnVisitDate", "sickLeaveIssued", "sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"]) assert.equal(restored.assessment[field], "");
  assert.deepEqual(restored.draft, original.draft);
  assert.notEqual(core.fingerprint(restored), restored.draft.sourceFingerprint);
  assert.equal(JSON.stringify(oldBundle), oldBefore);
  assert.deepEqual(core.parseBundle(serialize([restored])).encounters[0], restored);
  assert.ok(core.validateEncounter(oldBundle.encounters[0]).length);
  assert.throws(() => core.validateBundle(oldBundle), /структура|версия/);
});

test("version 1 import rejects invalid legacy data before migration instead of discarding it", () => {
  const unknown = legacyBundle(); unknown.encounters[0].exam.unexpected = "Не терять молча";
  assert.throws(() => core.parseBundle(JSON.stringify(unknown)), /Неизвестное поле/);
  const invalid = legacyBundle(); invalid.encounters[0].assessment.followUp = { unexpected: true };
  assert.throws(() => core.parseBundle(JSON.stringify(invalid)), /строкой/);
  const missing = legacyBundle(); delete missing.encounters[0].draft.text;
  assert.throws(() => core.parseBundle(JSON.stringify(missing)), /отсутствует/);
  const duplicate = legacyBundle(); duplicate.encounters.push(duplicate.encounters[0]);
  assert.throws(() => core.parseBundle(JSON.stringify(duplicate)), /повторяется/);
});

test("validation rejects invalid types, unknown fields and unsafe IDs", () => {
  for (const [field, value] of [["age", 30], ["sex", "other"], ["id", "<x>"], ["id", "a".repeat(81)]]) {
    const data = encounter(); data[field] = value;
    assert.ok(core.validateEncounter(data).some(error => error.field === field));
  }
  const extra = encounter(); extra.patientName = "Unexpected field";
  assert.ok(core.validateEncounter(extra).some(error => error.field === "patientName"));
  const missing = encounter(); delete missing.history.allergies;
  assert.ok(core.validateEncounter(missing).some(error => error.field === "history.allergies"));
  const array = encounter(); array.exam = [];
  assert.ok(core.validateEncounter(array).some(error => error.field === "exam"));
  assert.ok(core.validateEncounter(null).length);
});

test("date validation rejects nonexistent days and invalid timestamps while accepting leap days", () => {
  const data = encounter();
  for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "2026-1-01"]) {
    data.visitDate = value;
    assert.ok(core.validateEncounter(data).some(error => error.field === "visitDate"), value);
  }
  data.visitDate = "2024-02-29";
  assert.deepEqual(core.validateEncounter(data), []);
  data.createdAt = "2026-02-30T00:00:00.000Z";
  assert.ok(core.validateEncounter(data).some(error => error.field === "createdAt"));
  data.createdAt = NOW;
  data.draft.generatedAt = "2026-10-19T24:00:00.000Z";
  assert.ok(core.validateEncounter(data).some(error => error.field === "draft.generatedAt"));
});

test("numeric validation checks representation and finite nonnegative values without clinical thresholds", () => {
  for (const value of ["Infinity", "NaN", "12abc", "12,3,4", "-1", "9".repeat(400)]) {
    const data = encounter(); data.vitals.pulse = value;
    assert.ok(core.validateEncounter(data).some(error => error.field === "vitals.pulse"), value);
  }
  for (const value of ["", "0", "36,6", "36.6", "999999", " 72 "]) {
    const data = encounter(); data.vitals.temperature = value;
    assert.deepEqual(core.validateEncounter(data), [], value);
  }
});

test("BMI uses kilograms and centimetres with one decimal and accepts the existing numeric grammar", () => {
  for (const [weight, height, expected] of [
    ["72.5", "175", "23,7"],
    ["100", "200", "25,0"],
    [" 72,5 ", " 175,0 ", "23,7"],
    ["+100", "+200", "25,0"],
    [".5", "10", "50,0"],
    [",5", "10", "50,0"]
  ]) assert.equal(core.calculateBmi(weight, height), expected, weight + "/" + height);
});

test("BMI is unavailable for incomplete, invalid, nonpositive or unrepresentable results", () => {
  for (const value of ["", " \t ", "0", "-0", "-1", "NaN", "Infinity", "12abc", "12,3,4", "1e2", "0x10", "1.", "9".repeat(400), null, undefined, 72, {}]) {
    assert.equal(core.calculateBmi(value, "175"), "", "weight: " + value);
    assert.equal(core.calculateBmi("72.5", value), "", "height: " + value);
  }
  const tiny = "0." + "0".repeat(199) + "1";
  assert.equal(core.calculateBmi("72.5", tiny), "", "squared height underflows");
  assert.equal(core.calculateBmi("72.5", "9".repeat(200)), "", "squared height overflows");
  assert.equal(core.calculateBmi("0.001", "200"), "", "positive value rounding to zero is not shown as 0.0");
  assert.equal(core.calculateBmi("9".repeat(22), "100"), "", "exponential result is not presented as one-decimal BMI");
});

test("generated BMI follows height only when calculable and never changes the encounter or manual draft", () => {
  const data = encounter();
  data.draft.text = "Ручной черновик врача";
  for (const [weight, height] of [["", ""], ["72.5", ""], ["", "175"], ["0", "175"], ["72.5", "0"], ["0.001", "200"]]) {
    data.vitals.weight = weight;
    data.vitals.height = height;
    assert.doesNotMatch(core.generateDraft(data), /Индекс массы тела:/);
  }
  data.vitals.weight = "72,5";
  data.vitals.height = "175";
  const before = JSON.stringify(data);
  assert.match(core.generateDraft(data), /Рост: 175 см\.\nИндекс массы тела: 23,7 кг\/м²\.\n\nЗАКЛЮЧЕНИЕ/);
  assert.equal(JSON.stringify(data), before);
  data.vitals.weight = "100";
  data.vitals.height = "200";
  assert.match(core.generateDraft(data), /Индекс массы тела: 25,0 кг\/м²\./);
  assert.equal(data.draft.text, "Ручной черновик врача");
});

test("BMI is derived after old-schema import without adding fields to stored or exported data", () => {
  const data = encounter();
  data.vitals.weight = "72.5";
  data.vitals.height = "175";
  data.draft.text = "Черновик прежней версии без ИМТ";
  for (const original of [legacyBundle(data), bundle([data])]) {
    const restored = core.parseBundle(JSON.stringify(original)).encounters[0];
    assert.deepEqual(restored.vitals, data.vitals);
    assert.deepEqual(Object.keys(restored.vitals), Object.keys(data.vitals));
    assert.equal(restored.draft.text, data.draft.text);
    assert.equal(core.calculateBmi(restored.vitals.weight, restored.vitals.height), "23,7");
    assert.match(core.generateDraft(restored), /Индекс массы тела: 23,7 кг\/м²\./);
    const exported = bundle([restored]);
    assert.equal(exported.schemaVersion, 4);
    assert.deepEqual(exported.encounters[0], restored);
    assert.deepEqual(exported.encounters[0].vitals, data.vitals);
  }
});

test("import rejects unsupported format, version, duplicates, malformed JSON and oversized fields", () => {
  assert.throws(() => core.parseBundle("{bad"), /JSON/);
  assert.throws(() => core.validateBundle([]), /объектом/);
  const valid = bundle([encounter()]);
  assert.throws(() => core.validateBundle({ ...valid, format: "other" }), /не является/);
  assert.throws(() => core.validateBundle({ ...valid, schemaVersion: 5 }), /версия/);
  assert.throws(() => core.validateBundle({ ...valid, encounters: [encounter(), encounter()] }), /повторяется/);
  assert.throws(() => core.validateBundle({ ...valid, encounters: "wrong" }), /массивом/);
  assert.throws(() => core.validateBundle({ ...valid, exportedAt: "yesterday" }), /дата/);
  assert.throws(() => core.validateBundle({ ...valid, unexpected: true }), /структура/);
  const oversized = encounter(); oversized.history.complaints = "x".repeat(10001);
  assert.throws(() => serialize([oversized]), /10000/);
  oversized.history.complaints = ""; oversized.draft.text = "x".repeat(100001);
  assert.throws(() => serialize([oversized]), /100000/);
  assert.throws(() => serialize(Array.from({ length: 501 }, (_, i) => encounter("visit-" + i))), /500/);
});

test("bundle normalization returns detached values and rejects unknown prototype-like keys", () => {
  const valid = bundle([encounter()]);
  const normalized = core.validateBundle(valid);
  normalized.encounters[0].history.complaints = "Independent";
  assert.equal(valid.encounters[0].history.complaints, "");
  const poisoned = JSON.parse(JSON.stringify(valid).replace('"history":{', '"history":{"__proto__":{},'));
  assert.throws(() => core.validateBundle(poisoned), /Неизвестное поле/);
});

test("an oversized generated note is refused without altering source data", () => {
  const data = encounter();
  for (const group of [data.history, data.exam]) for (const field of Object.keys(group)) group[field] = "x".repeat(10000);
  assert.deepEqual(core.validateEncounter(data), []);
  assert.throws(() => core.generateDraft(data), /100000/);
  assert.equal(data.draft.text, "");
});

test("repository persists valid data and restores manual edits after reload", () => {
  const storage = memoryStorage();
  const first = createRepository(storage);
  assert.deepEqual(first.load(), { patients: [], encounters: [], error: null });
  const data = encounter(); data.draft.text = "Сохранённая ручная правка";
  assert.deepEqual(first.save([data], patientsFor([data])), { ok: true, error: null });
  assert.deepEqual(createRepository(storage).load(), { patients: patientsFor([data]), encounters: [data], error: null });
});

test("legacy storage is migrated in memory and kept untouched by read, save and reset", () => {
  const data = encounter();
  data.draft.text = "Ручной черновик прежней версии";
  data.exam.cardiovascular = "Свободный текст прежней версии";
  data.assessment.followUp = "Уточнить дату позже";
  const legacy = JSON.stringify(legacyBundle(data));
  const storage = memoryStorage(null, legacy);
  const repository = createRepository(storage);
  const result = repository.load();
  assert.equal(result.error, null);
  assert.equal(result.migrated, true);
  assert.equal(result.encounters[0].draft.text, data.draft.text);
  assert.equal(result.encounters[0].assessment.followUp, data.assessment.followUp);
  assert.equal(storage.writes, 0);
  assert.equal(storage.raw, null);
  assert.equal(storage.legacyRaw, legacy);
  assert.equal(repository.save(result.encounters, result.patients).ok, true);
  assert.equal(JSON.parse(storage.raw).schemaVersion, 4);
  assert.equal(storage.legacyRaw, legacy);
  assert.equal(createRepository(storage).load().migrated, undefined);
  assert.equal(repository.reset([]).ok, true);
  assert.deepEqual(repository.load(), { patients: [], encounters: [], error: null });
  assert.equal(storage.legacyRaw, legacy);
});

test("version 4 storage takes priority and corrupt version 4 never falls back to older copies", () => {
  const legacy = JSON.stringify(legacyBundle());
  const storage = memoryStorage(serialize([]), legacy);
  assert.deepEqual(createRepository(storage).load(), { patients: [], encounters: [], error: null });
  assert.deepEqual(storage.reads, [KEY]);
  const corrupt = memoryStorage("{broken", legacy);
  const repository = createRepository(corrupt);
  assert.match(repository.load().error, /Автоматическая запись остановлена/);
  assert.equal(repository.save([], []).ok, false);
  assert.deepEqual(corrupt.reads, [KEY]);
  assert.equal(corrupt.raw, "{broken");
  assert.equal(corrupt.legacyRaw, legacy);
  assert.equal(corrupt.writes, 0);
});

test("corrupt legacy storage blocks ordinary saves and reset affects only the version 4 key", () => {
  const storage = memoryStorage(null, "{broken legacy");
  const repository = createRepository(storage);
  assert.equal(repository.save([encounter()], patientsFor([encounter()])).ok, false);
  assert.equal(storage.writes, 0);
  assert.equal(storage.raw, null);
  assert.equal(storage.legacyRaw, "{broken legacy");
  assert.equal(repository.reset([]).ok, true);
  assert.equal(storage.legacyRaw, "{broken legacy");
  assert.deepEqual(repository.load(), { patients: [], encounters: [], error: null });
});

test("corrupt data is never overwritten by ordinary save, even if load was not called", () => {
  const storage = memoryStorage("{broken");
  const repository = createRepository(storage);
  assert.equal(repository.save([encounter()], patientsFor([encounter()])).ok, false);
  assert.match(repository.load().error, /Автоматическая запись остановлена/);
  assert.equal(storage.raw, "{broken");
  assert.equal(storage.writes, 0);
  assert.equal(repository.reset([encounter()], patientsFor([encounter()])).ok, true);
  assert.equal(repository.load().error, null);
  assert.equal(repository.load().encounters.length, 1);
  assert.equal(repository.save([], []).ok, true);
});

test("invalid saves and resets leave previously stored data intact", () => {
  const initial = serialize([encounter()]);
  const storage = memoryStorage(initial);
  const repository = createRepository(storage);
  const invalid = encounter(); invalid.age = "not a number";
  assert.equal(repository.save([invalid], patientsFor([invalid])).ok, false);
  assert.equal(repository.reset([invalid], patientsFor([invalid])).ok, false);
  assert.equal(storage.raw, initial);
  assert.equal(storage.writes, 0);
});

test("denied storage access and quota failure are reported rather than claimed as saved", () => {
  const unavailable = createRepository(() => { throw new Error("Access denied"); });
  assert.match(unavailable.load().error, /Access denied/);
  assert.equal(unavailable.save([encounter()], patientsFor([encounter()])).ok, false);
  assert.equal(unavailable.reset([]).ok, false);
  const quota = createRepository({ getItem() { return null; }, setItem() { throw new Error("Quota exceeded"); } });
  assert.equal(quota.load().error, null);
  assert.deepEqual(quota.save([encounter()], patientsFor([encounter()])), { ok: false, error: "Не удалось сохранить данные в браузере. Quota exceeded" });
});

test("patient cards accept an optional display label and reject malformed fields without normalizing text", () => {
  const patient = core.createPatient({ id: "patient-1", now: NOW, label: "  Вымышленный пациент <1>\n  " });
  assert.deepEqual(patient, { id: "patient-1", label: "  Вымышленный пациент <1>\n  ", createdAt: NOW, updatedAt: NOW });
  assert.deepEqual(core.validatePatient(patient), []);
  assert.equal(core.createPatient({ now: NOW }).label, "");
  assert.notEqual(core.createPatient().id, core.createPatient().id);
  assert.equal(core.createPatient({ label: "я".repeat(120) }).label.length, 120);
  for (const [field, value] of [["id", "<unsafe>"], ["id", "x".repeat(81)], ["label", 3], ["label", "я".repeat(121)], ["createdAt", "2026-02-30T00:00:00.000Z"], ["updatedAt", NOW.slice(0, 10)]]) {
    assert.ok(core.validatePatient({ ...patient, [field]: value }).some(error => error.field === field), field);
  }
  assert.ok(core.validatePatient({ ...patient, unexpected: "value" }).some(error => error.field === "unexpected"));
  const missing = { ...patient }; delete missing.label;
  assert.ok(core.validatePatient(missing).some(error => error.field === "label"));
  for (const value of [null, [], "patient"]) assert.ok(core.validatePatient(value).length);
  assert.throws(() => core.createPatient({ label: "x".repeat(121) }), /120/);
  assert.throws(() => core.createPatient({ now: "invalid" }), /время/);
});

test("encounters require a valid patient ID and bundles require explicit existing patient references", () => {
  const patient = core.createPatient({ id: "shared-patient", now: NOW });
  const first = core.createEncounter({ id: "first-visit", patientId: patient.id, now: NOW });
  const second = core.createEncounter({ id: "second-visit", patientId: patient.id, now: NOW });
  assert.equal(encounter().patientId, encounter().id);
  assert.deepEqual(core.parseBundle(core.serializeBundle([first, second], [patient])).encounters, [first, second]);
  assert.throws(() => core.serializeBundle([first]), /карточек/);
  assert.throws(() => core.serializeBundle([first], []), /отсутствует карточка/);
  for (const value of [null, "", "<unsafe>", "x".repeat(81)]) {
    assert.ok(core.validateEncounter({ ...first, patientId: value }).some(error => error.field === "patientId"));
  }
  const missing = { ...first }; delete missing.patientId;
  assert.ok(core.validateEncounter(missing).some(error => error.field === "patientId"));
  assert.throws(() => core.serializeBundle([first], [patient, patient]), /повторяется идентификатор карточки/);
  assert.throws(() => core.serializeBundle([], "not an array"), /массивом/);
  const orphanCard = core.createPatient({ id: "card-without-visits", now: NOW });
  assert.deepEqual(core.parseBundle(core.serializeBundle([], [orphanCard])).patients, [orphanCard]);
});

test("patient and encounter IDs occupy independent namespaces and limits apply to each collection", () => {
  const first = encounter("same-id");
  const patients = patientsFor([first]);
  assert.deepEqual(core.parseBundle(core.serializeBundle([first], patients)).patients, patients);
  const manyCards = Array.from({ length: 500 }, (_, index) => core.createPatient({ id: "p-" + index, now: NOW }));
  assert.equal(core.parseBundle(core.serializeBundle([], manyCards)).patients.length, 500);
  assert.throws(() => core.serializeBundle([], [...manyCards, core.createPatient({ id: "p-extra", now: NOW })]), /500/);
  const manyVisits = Array.from({ length: 500 }, (_, index) => core.createEncounter({ id: "v-" + index, patientId: patients[0].id, now: NOW }));
  assert.equal(core.parseBundle(core.serializeBundle(manyVisits, patients)).encounters.length, 500);
  assert.throws(() => core.serializeBundle([...manyVisits, first], patients), /500 демонстрационных приёмов/);
});

test("repeat encounters copy only each explicitly selected combination of the three permitted history fields", () => {
  const source = core.createDemoEncounter({ id: "source-visit", patientId: "same-patient", now: NOW });
  source.history.conditions = "  Вымышленное заболевание\n  ";
  source.history.medications = "Вымышленный препарат";
  source.history.allergies = "Вымышленная реакция";
  source.reason = "Старый повод";
  source.assessment.sickLeaveNumber = "DEMO-1";
  source.assessment.returnVisitDate = "2026-10-26";
  source.draft = { text: "Ручная запись", generatedAt: NOW, sourceFingerprint: core.fingerprint(source) };
  Object.assign(source.examSelections, examCatalog.NORMAL_SELECTIONS);
  const before = JSON.stringify(source);
  const nextTime = "2026-10-26T09:30:00.000Z";
  const fields = ["conditions", "medications", "allergies"];
  for (let mask = 0; mask < 8; mask += 1) {
    const selected = fields.filter((_, index) => mask & (1 << index));
    const repeat = core.createRepeatEncounter(source, { id: "repeat-" + mask, now: nextTime, carryHistoryFields: selected });
    const expected = core.createEncounter({ id: repeat.id, now: nextTime, patientId: source.patientId });
    for (const field of selected) expected.history[field] = source.history[field];
    assert.deepEqual(repeat, expected);
    assert.notStrictEqual(repeat.history, source.history);
    assert.notStrictEqual(repeat.examSelections, source.examSelections);
    assert.deepEqual(core.validateEncounter(repeat), []);
  }
  assert.deepEqual(core.createRepeatEncounter(source, { id: "repeat-default", now: nextTime }), core.createEncounter({ id: "repeat-default", now: nextTime, patientId: source.patientId }));
  assert.equal(JSON.stringify(source), before);
});

test("repeat creation rejects unsupported carry fields and duplicate visit identity", () => {
  const source = encounter();
  for (const carryHistoryFields of [true, "allergies", null, {}, ["complaints"], ["conditions", "context"], [undefined], new Array(1), ["__proto__"]]) {
    assert.throws(() => core.createRepeatEncounter(source, { carryHistoryFields }), /явно выбранные/);
  }
  assert.throws(() => core.createRepeatEncounter(source, { id: source.id }), /новый идентификатор/);
  assert.throws(() => core.createRepeatEncounter({ ...source, patientId: "" }), /patientId/);
});

test("version 2 migration creates one deterministic unlabelled card per encounter and preserves every old value", () => {
  const source = core.createDemoEncounter({ id: "first-old", now: NOW });
  source.draft = { text: "  Ручной черновик\n<Текст>  ", generatedAt: NOW, sourceFingerprint: core.fingerprint(source) };
  const old = previousBundle(source);
  const second = previousBundle(core.createDemoEncounter({ id: "second-old", now: NOW })).encounters[0];
  old.encounters.push(second);
  const text = JSON.stringify(old);
  const migrated = core.parseBundle(text);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.exportedAt, old.exportedAt);
  assert.deepEqual(core.parseBundle(text), migrated);
  assert.equal(migrated.patients.length, 2);
  for (let index = 0; index < old.encounters.length; index += 1) {
    const original = old.encounters[index];
    const restored = migrated.encounters[index];
    assert.equal(restored.patientId, original.id);
    assert.deepEqual(migrated.patients[index], { id: original.id, label: "", createdAt: original.createdAt, updatedAt: original.updatedAt });
    const { patientId, workflow, ...oldFields } = restored;
    assert.deepEqual(oldFields, original);
    assert.deepEqual(workflow, encounter().workflow);
  }
  assert.equal(core.fingerprint(migrated.encounters[0]), source.draft.sourceFingerprint);
  assert.equal(JSON.stringify(old), text);
  const roundTrip = core.parseBundle(core.serializeBundle(migrated.encounters, migrated.patients));
  assert.deepEqual(roundTrip.patients, migrated.patients);
  assert.deepEqual(roundTrip.encounters, migrated.encounters);
});

test("version 2 import validates source fields before adding cards", () => {
  const unknown = previousBundle(); unknown.encounters[0].patientId = "unexpected";
  assert.throws(() => core.parseBundle(JSON.stringify(unknown)), /Неизвестное поле/);
  const invalid = previousBundle(); invalid.encounters[0].examSelections.heartRhythm = "unknown";
  assert.throws(() => core.parseBundle(JSON.stringify(invalid)), /Неизвестный вариант/);
  const missing = previousBundle(); delete missing.encounters[0].assessment.sickLeaveNumber;
  assert.throws(() => core.parseBundle(JSON.stringify(missing)), /отсутствует/);
  const duplicate = previousBundle(); duplicate.encounters.push(duplicate.encounters[0]);
  assert.throws(() => core.parseBundle(JSON.stringify(duplicate)), /повторяется/);
});

test("version 1 migration adds deterministic cards without merging encounters with similar clinical data", () => {
  const old = legacyBundle();
  old.encounters.push({ ...old.encounters[0], id: "another-old-visit" });
  const migrated = core.parseBundle(JSON.stringify(old));
  assert.equal(migrated.patients.length, 2);
  for (let index = 0; index < old.encounters.length; index += 1) {
    assert.equal(migrated.encounters[index].patientId, old.encounters[index].id);
    assert.equal(migrated.patients[index].id, old.encounters[index].id);
    assert.deepEqual(migrated.encounters[index].draft, old.encounters[index].draft);
  }
});

test("bundle normalization detaches patient labels and keeps multiple visits associated after round trip", () => {
  const patient = core.createPatient({ id: "patient-a", label: "Демо А", now: NOW });
  const first = core.createEncounter({ id: "first", patientId: patient.id, now: NOW });
  const second = core.createRepeatEncounter(first, { id: "second", now: NOW });
  const original = bundle([first, second], [patient]);
  const normalized = core.validateBundle(original);
  normalized.patients[0].label = "Изменённое условное имя";
  assert.equal(original.patients[0].label, "Демо А");
  assert.ok(normalized.encounters.every(data => data.patientId === patient.id));
  const poisoned = { ...original, patients: [{ ...patient, unexpected: "value" }] };
  assert.throws(() => core.validateBundle(poisoned), /Неизвестное поле/);
});

test("version 2 storage is read-only on migration, takes priority over v1, and remains intact after a v4 save", () => {
  const previous = JSON.stringify(previousBundle());
  const legacy = JSON.stringify(legacyBundle(encounter("legacy-only")));
  const storage = memoryStorage(null, legacy, previous);
  const repository = createRepository(storage);
  const loaded = repository.load();
  assert.equal(loaded.migrated, true);
  assert.equal(loaded.error, null);
  assert.equal(loaded.patients[0].id, encounter().id);
  assert.equal(storage.writes, 0);
  assert.deepEqual(storage.reads, [KEY, PREVIOUS_KEY, V2_KEY]);
  assert.equal(repository.save(loaded.encounters, loaded.patients).ok, true);
  assert.equal(storage.writes, 1);
  assert.equal(storage.v2Raw, previous);
  assert.equal(storage.legacyRaw, legacy);
  assert.deepEqual(JSON.parse(storage.raw).patients, loaded.patients);
  assert.deepEqual(createRepository(storage).load(), { patients: loaded.patients, encounters: loaded.encounters, error: null });
  assert.equal(repository.reset().ok, true);
  assert.equal(storage.v2Raw, previous);
  assert.equal(storage.legacyRaw, legacy);
});

test("corrupt version 2 storage blocks writing and never falls back to valid v1", () => {
  const legacy = JSON.stringify(legacyBundle());
  const storage = memoryStorage(null, legacy, "{broken v2");
  const repository = createRepository(storage);
  const result = repository.load();
  assert.match(result.error, /Автоматическая запись остановлена/);
  assert.deepEqual(result.patients, []);
  assert.equal(repository.save([], []).ok, false);
  assert.deepEqual(storage.reads, [KEY, PREVIOUS_KEY, V2_KEY]);
  assert.equal(storage.writes, 0);
  assert.equal(storage.v2Raw, "{broken v2");
  assert.equal(storage.legacyRaw, legacy);
});

test("patient and encounter edits are saved together and missing references cannot replace either collection", () => {
  const data = encounter();
  const patients = patientsFor([data]);
  const storage = memoryStorage(serialize([data], patients));
  const repository = createRepository(storage);
  const loaded = repository.load();
  loaded.patients[0].label = "Вымышленный пациент";
  loaded.encounters[0].history.complaints = "Вымышленные жалобы";
  assert.equal(repository.save(loaded.encounters, loaded.patients).ok, true);
  assert.equal(storage.writes, 1);
  const raw = storage.raw;
  assert.deepEqual(core.parseBundle(raw).patients, loaded.patients);
  assert.deepEqual(core.parseBundle(raw).encounters, loaded.encounters);
  for (const method of ["save", "reset"]) {
    assert.equal(repository[method](loaded.encounters, []).ok, false);
    assert.equal(storage.raw, raw);
    assert.equal(storage.writes, 1);
  }
});

test("classic browser scripts export their APIs without accessing localStorage during startup", () => {
  const browser = vm.createContext({ accesses: 0 });
  vm.runInContext('Object.defineProperty(globalThis, "localStorage", { get() { accesses += 1; throw new Error("Browser storage disabled"); } });', browser);
  for (const file of ["exam-options.js", "core.js", "storage.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../app", file), "utf8"), browser, { filename: file });
  }
  assert.equal(typeof browser.MedAssistCore.generateDraft, "function");
  assert.equal(typeof browser.MedAssistStorage.reset, "function");
  assert.equal(browser.accesses, 0);
  assert.match(browser.MedAssistStorage.load().error, /Browser storage disabled/);
  const accessesAfterLoad = browser.accesses;
  assert.ok(accessesAfterLoad > 0);
  assert.equal(browser.MedAssistStorage.save([], []).ok, false);
  assert.equal(browser.accesses, accessesAfterLoad);
});

test("workflow starts unreviewed and unscheduled with independent values, including repeat encounters", () => {
  const first = encounter();
  const second = encounter("second");
  const expected = { reviewStatus: "draft", reviewedAt: "", returnVisitStatus: "planned", returnVisitEncounterId: "" };
  assert.deepEqual(first.workflow, expected);
  first.draft.text = "Проверенная вымышленная запись";
  first.assessment.returnVisitDate = "2026-10-26";
  const source = core.setReturnVisitStatus(core.setReviewStatus(first, "reviewed", { now: NOW }), "completed");
  const repeat = core.createRepeatEncounter(source, { id: "repeat-workflow", now: NOW });
  assert.deepEqual(repeat.workflow, expected);
  assert.deepEqual(second.workflow, expected);
  repeat.workflow.reviewStatus = "changed";
  assert.equal(source.workflow.reviewStatus, "reviewed");
  assert.equal(second.workflow.reviewStatus, "draft");
});

test("review requires nonempty valid text and records an explicit time without mutating its source", () => {
  for (const text of ["", " \t\n "]) {
    const empty = encounter(); empty.draft.text = text;
    assert.throws(() => core.setReviewStatus(empty, "reviewed", { now: NOW }), /заполните текст записи/);
  }
  const source = encounter(); source.draft.text = "  Вымышленная запись врача\nС ручными правками  ";
  const before = JSON.stringify(source);
  const reviewed = core.setReviewStatus(source, "reviewed", { now: NOW });
  assert.equal(reviewed.workflow.reviewStatus, "reviewed");
  assert.equal(reviewed.workflow.reviewedAt, NOW);
  assert.equal(reviewed.draft.text, source.draft.text);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(core.setReviewStatus(reviewed, "draft"), source);
  reviewed.history.complaints = "Изменение отдельной копии";
  assert.equal(source.history.complaints, "");
  const invalid = encounter(); invalid.draft.text = "Есть текст"; invalid.age = "не число";
  assert.throws(() => core.setReviewStatus(invalid, "reviewed", { now: NOW }), /age/);
  for (const now of ["bad-date", "0000-01-01T00:00:00.000Z", "+010000-01-01T00:00:00.000Z"]) assert.throws(() => core.setReviewStatus(source, "reviewed", { now }), /время/);
  for (const status of ["done", "", null, true]) assert.throws(() => core.setReviewStatus(source, status), /статус/);
});

test("workflow validation rejects unknown, missing and contradictory metadata", () => {
  const invalidCases = [
    ["reviewStatus", "done"], ["reviewStatus", false], ["reviewedAt", NOW], ["reviewedAt", 4],
    ["returnVisitStatus", "missed"], ["returnVisitStatus", null],
    ["returnVisitEncounterId", "<unsafe>"], ["returnVisitEncounterId", false],
    ["returnVisitEncounterId", "x".repeat(81)]
  ];
  for (const [field, value] of invalidCases) {
    const data = encounter(); data.workflow[field] = value;
    assert.ok(core.validateEncounter(data).some(error => error.field === "workflow." + field), field + ": " + value);
  }
  for (const field of Object.keys(encounter().workflow)) {
    const data = encounter(); delete data.workflow[field];
    assert.ok(core.validateEncounter(data).some(error => error.field === "workflow." + field), field);
  }
  const unknown = encounter(); unknown.workflow.extra = "unknown";
  assert.ok(core.validateEncounter(unknown).some(error => error.field === "workflow.extra"));
  const missing = encounter(); delete missing.workflow;
  assert.ok(core.validateEncounter(missing).some(error => error.field === "workflow"));
  const reviewed = encounter(); reviewed.workflow.reviewStatus = "reviewed";
  assert.ok(core.validateEncounter(reviewed).some(error => error.field === "workflow.reviewedAt"));
  assert.ok(core.validateEncounter(reviewed).some(error => error.field === "draft.text"));
  reviewed.draft.text = "Вымышленный текст";
  for (const timestamp of ["2026-02-30T00:00:00.000Z", "2026-10-19", ""]) {
    reviewed.workflow.reviewedAt = timestamp;
    assert.ok(core.validateEncounter(reviewed).some(error => error.field === "workflow.reviewedAt"));
  }
});

test("return completion is explicit, requires a date and leaves review, draft and fingerprint unchanged", () => {
  const source = encounter();
  assert.throws(() => core.setReturnVisitStatus(source, "completed"), /укажите дату/);
  source.assessment.returnVisitDate = "2026-10-10";
  source.draft.text = "Вымышленная проверенная запись";
  const reviewed = core.setReviewStatus(source, "reviewed", { now: NOW });
  const before = JSON.stringify(reviewed);
  const completed = core.setReturnVisitStatus(reviewed, "completed");
  assert.equal(completed.workflow.returnVisitStatus, "completed");
  assert.equal(completed.workflow.reviewStatus, "reviewed");
  assert.equal(completed.workflow.reviewedAt, NOW);
  assert.deepEqual(completed.draft, reviewed.draft);
  assert.equal(core.fingerprint(completed), core.fingerprint(source));
  assert.equal(core.generateDraft(completed), core.generateDraft(source));
  assert.equal(JSON.stringify(reviewed), before);
  assert.deepEqual(core.setReturnVisitStatus(completed, "planned"), reviewed);
  completed.history.complaints = "Другая копия";
  assert.equal(reviewed.history.complaints, "");
  for (const status of ["missed", "", null, false]) assert.throws(() => core.setReturnVisitStatus(source, status), /отметка/);
  completed.assessment.returnVisitDate = "";
  assert.ok(core.validateEncounter(completed).some(error => error.field === "assessment.returnVisitDate"));
});

test("the return list uses calendar dates, deterministic order and explicit completion without inferring absence", () => {
  const make = (id, date, completed = false) => {
    const data = encounter(id); data.assessment.returnVisitDate = date;
    return completed ? core.setReturnVisitStatus(data, "completed") : data;
  };
  const entries = [make("upcoming", "2026-10-20"), make("same-b", "2026-10-19"), make("past", "2026-10-18"), make("completed", "2026-10-21", true), make("same-a", "2026-10-19"), encounter("no-date")];
  const before = JSON.stringify(entries);
  const actual = core.getReturnVisits(entries, "2026-10-19");
  assert.deepEqual(actual.map(item => [item.encounterId, item.date, item.bucket]), [
    ["past", "2026-10-18", "past"], ["same-a", "2026-10-19", "today"], ["same-b", "2026-10-19", "today"],
    ["upcoming", "2026-10-20", "upcoming"], ["completed", "2026-10-21", "completed"]
  ]);
  assert.deepEqual(actual[0], { encounterId: "past", patientId: "past", date: "2026-10-18", bucket: "past", linkedEncounterId: "" });
  assert.equal(core.getReturnVisits(entries, "2026-10-20").find(item => item.encounterId === "same-a").bucket, "past");
  assert.equal(entries[2].workflow.returnVisitStatus, "planned");
  assert.equal(JSON.stringify(entries), before);
  for (const date of ["2026-02-29", "2026-1-01", "0000-01-01", "", null]) assert.throws(() => core.getReturnVisits(entries, date), /дату/);
  assert.throws(() => core.getReturnVisits(null, "2026-10-19"), /массивом/);
});

test("the return list tolerates unfinished clinical edits but still rejects invalid scheduling data", () => {
  const entry = encounter("editing-visit");
  entry.assessment.returnVisitDate = "2026-10-26";
  entry.draft.text = "Вымышленная запись";
  entry.age = "abc";
  const before = JSON.stringify(entry);
  assert.deepEqual(core.getReturnVisits([entry], "2026-10-19"), [{
    encounterId: entry.id, patientId: entry.patientId, date: "2026-10-26", bucket: "upcoming", linkedEncounterId: ""
  }]);
  assert.equal(JSON.stringify(entry), before);
  assert.throws(() => core.setReviewStatus(entry, "reviewed", { now: NOW }), /age/);
  assert.throws(() => serialize([entry]), /age/);
  const emptyDate = { ...entry, assessment: { ...entry.assessment, returnVisitDate: "" } };
  assert.deepEqual(core.getReturnVisits([emptyDate], "2026-10-19"), []);
  for (const date of ["2026-02-29", "2026-1-01", "завтра", 1, null, undefined]) {
    const invalid = { ...entry, assessment: { ...entry.assessment, returnVisitDate: date } };
    assert.throws(() => core.getReturnVisits([invalid], "2026-10-19"), /дату повторного приёма/);
  }
  for (const field of ["id", "patientId"]) {
    assert.throws(() => core.getReturnVisits([{ ...entry, [field]: "<invalid>" }], "2026-10-19"), /идентификатор/);
  }
  for (const workflow of [null, {}, { ...entry.workflow, returnVisitStatus: "missed" }, { ...entry.workflow, returnVisitEncounterId: "<invalid>" }, { ...entry.workflow, returnVisitEncounterId: entry.id }]) {
    assert.throws(() => core.getReturnVisits([{ ...entry, workflow }], "2026-10-19"));
  }
  for (const workflow of [{ ...entry.workflow, returnVisitStatus: "completed" }, { ...entry.workflow, returnVisitEncounterId: "another-visit" }]) {
    assert.throws(() => core.getReturnVisits([{ ...emptyDate, workflow }], "2026-10-19"), /укажите дату/);
  }
});

test("return links require one distinct encounter of the same patient and keep review and clinical data intact", () => {
  const source = encounter("source");
  const target = core.createRepeatEncounter(source, { id: "repeat", now: NOW });
  assert.throws(() => core.linkReturnVisit(source, target), /укажите его дату/);
  source.assessment.returnVisitDate = "2026-10-26";
  source.draft.text = "Проверенный вымышленный текст";
  const reviewed = core.setReviewStatus(source, "reviewed", { now: NOW });
  const linked = core.linkReturnVisit(reviewed, target);
  assert.equal(reviewed.workflow.returnVisitEncounterId, "");
  assert.equal(linked.workflow.returnVisitEncounterId, target.id);
  assert.equal(linked.workflow.returnVisitStatus, "planned");
  assert.equal(linked.workflow.reviewStatus, "reviewed");
  assert.equal(linked.workflow.reviewedAt, NOW);
  assert.deepEqual(linked.draft, reviewed.draft);
  assert.equal(core.fingerprint(linked), core.fingerprint(reviewed));
  assert.deepEqual(core.linkReturnVisit(linked, target), linked);
  assert.equal(core.getReturnVisits([linked, target], "2026-10-26")[0].linkedEncounterId, target.id);
  assert.throws(() => core.linkReturnVisit(source, source), /на себя/);
  assert.throws(() => core.linkReturnVisit(source, encounter("other-patient")), /тому же пациенту/);
  assert.throws(() => core.linkReturnVisit(linked, core.createRepeatEncounter(source, { id: "different-repeat", now: NOW })), /уже есть/);
  const reverse = { ...target, assessment: { ...target.assessment, returnVisitDate: "2026-11-01" }, workflow: { ...target.workflow, returnVisitEncounterId: source.id } };
  assert.throws(() => core.linkReturnVisit(source, reverse), /цикл/);
});

test("bundle links reject missing, cross-patient, self, duplicated targets and cycles of any length", () => {
  const make = id => {
    const data = core.createEncounter({ id, patientId: "shared-patient", now: NOW });
    data.assessment.returnVisitDate = "2026-10-26";
    return data;
  };
  const a = make("a"); const b = make("b"); const c = make("c");
  const linked = core.linkReturnVisit(a, b);
  const chain = core.linkReturnVisit(b, c);
  assert.deepEqual(core.parseBundle(serialize([linked, chain, c])).encounters, [linked, chain, c]);
  assert.throws(() => serialize([linked]), /отсутствует связанная запись/);
  assert.throws(() => serialize([linked, { ...b, patientId: "other-patient" }]), /другому пациенту/);
  assert.throws(() => serialize([{ ...a, workflow: { ...a.workflow, returnVisitEncounterId: a.id } }]), /на себя/);
  assert.throws(() => serialize([linked, b, core.linkReturnVisit(c, b)]), /несколькими датами/);
  const cyclic = { ...c, workflow: { ...c.workflow, returnVisitEncounterId: a.id } };
  assert.throws(() => serialize([linked, chain, cyclic]), /цикл/);
  const noDate = { ...linked, assessment: { ...linked.assessment, returnVisitDate: "" } };
  assert.throws(() => serialize([noDate, b]), /укажите дату/);
});

test("workflow round trip detaches nested metadata and preserves reviewed text and explicit links", () => {
  const source = encounter("source"); source.assessment.returnVisitDate = "2026-10-26"; source.draft.text = "  Вымышленный текст\n  ";
  const target = core.createRepeatEncounter(source, { id: "target", now: NOW });
  const reviewed = core.setReviewStatus(core.linkReturnVisit(source, target), "reviewed", { now: NOW });
  const completed = core.setReturnVisitStatus(reviewed, "completed");
  const restored = core.parseBundle(serialize([completed, target]));
  assert.deepEqual(restored.encounters, [completed, target]);
  restored.encounters[0].workflow.reviewStatus = "draft";
  assert.equal(completed.workflow.reviewStatus, "reviewed");
});

test("version 3 migration keeps shared cards and every original value while adding independent draft workflows", () => {
  const patient = core.createPatient({ id: "patient-with-two-visits", label: "  Тестов Иван Демонстрационный  ", now: NOW });
  const source = core.createDemoEncounter({ id: "old-first", patientId: patient.id, now: NOW });
  source.draft = { text: "  Ручная вымышленная запись\n<текст>  ", generatedAt: NOW, sourceFingerprint: core.fingerprint(source) };
  source.assessment.returnVisitDate = "2026-10-01";
  const second = core.createRepeatEncounter(source, { id: "old-second", now: NOW });
  const old = version3Bundle([source, second], [patient]);
  const original = JSON.stringify(old);
  const migrated = core.parseBundle(original);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.exportedAt, old.exportedAt);
  assert.deepEqual(migrated.patients, [patient]);
  for (let index = 0; index < old.encounters.length; index += 1) {
    const { workflow, ...unchanged } = migrated.encounters[index];
    assert.deepEqual(unchanged, old.encounters[index]);
    assert.deepEqual(workflow, encounter().workflow);
  }
  migrated.encounters[0].workflow.returnVisitStatus = "completed";
  assert.equal(migrated.encounters[1].workflow.returnVisitStatus, "planned");
  assert.equal(JSON.stringify(old), original);
});

test("version 3 import checks fields, card references and workflow absence before migration", () => {
  const unknown = version3Bundle([encounter()]); unknown.encounters[0].workflow = encounter().workflow;
  assert.throws(() => core.parseBundle(JSON.stringify(unknown)), /Неизвестное поле/);
  const invalid = version3Bundle([encounter()]); invalid.encounters[0].draft.text = null;
  assert.throws(() => core.parseBundle(JSON.stringify(invalid)), /строкой/);
  const missing = version3Bundle([encounter()]); missing.patients = [];
  assert.throws(() => core.parseBundle(JSON.stringify(missing)), /отсутствует карточка/);
});

test("storage watches all four keys in priority order and migrates version 3 without overwriting old copies", () => {
  assert.deepEqual(WATCHED_KEYS, ["medassist.demo.v4", "medassist.demo.v3", "medassist.demo.v2", "medassist.demo.v1"]);
  assert.ok(Object.isFrozen(WATCHED_KEYS));
  const old = JSON.stringify(version3Bundle([encounter()]));
  const v2 = JSON.stringify(previousBundle(encounter("old-v2")));
  const legacy = JSON.stringify(legacyBundle(encounter("old-v1")));
  const storage = memoryStorage(null, legacy, v2, old);
  const repository = createRepository(storage);
  const loaded = repository.load();
  assert.equal(loaded.migrated, true);
  assert.equal(loaded.error, null);
  assert.deepEqual(storage.reads, [KEY, PREVIOUS_KEY]);
  assert.equal(storage.writes, 0);
  assert.equal(storage.raw, null);
  assert.equal(loaded.encounters[0].id, encounter().id);
  assert.equal(repository.save(loaded.encounters, loaded.patients).ok, true);
  assert.equal(JSON.parse(storage.raw).schemaVersion, 4);
  assert.equal(storage.previousRaw, old);
  assert.equal(storage.v2Raw, v2);
  assert.equal(storage.legacyRaw, legacy);
  assert.equal(repository.reset().ok, true);
  assert.equal(storage.previousRaw, old);
  assert.equal(storage.v2Raw, v2);
  assert.equal(storage.legacyRaw, legacy);
  const corrupt = memoryStorage(null, legacy, v2, "{broken v3");
  const blocked = createRepository(corrupt);
  assert.match(blocked.load().error, /Автоматическая запись остановлена/);
  assert.equal(blocked.save([], []).ok, false);
  assert.deepEqual(corrupt.reads, [KEY, PREVIOUS_KEY]);
  assert.equal(corrupt.writes, 0);
});

test("invalid workflow or repeat references cannot replace an existing saved bundle", () => {
  const source = encounter("source"); source.assessment.returnVisitDate = "2026-10-26";
  const target = core.createRepeatEncounter(source, { id: "target", now: NOW });
  const linked = core.linkReturnVisit(source, target);
  const patients = patientsFor([source]);
  const original = serialize([linked, target], patients);
  const storage = memoryStorage(original);
  const repository = createRepository(storage);
  assert.equal(repository.load().error, null);
  for (const method of ["save", "reset"]) {
    assert.equal(repository[method]([linked], patients).ok, false);
    const invalid = { ...target, workflow: { ...target.workflow, reviewStatus: "reviewed", reviewedAt: NOW } };
    assert.equal(repository[method]([linked, invalid], patients).ok, false);
    assert.equal(storage.raw, original);
    assert.equal(storage.writes, 0);
  }
});
