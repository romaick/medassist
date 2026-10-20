"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../app/core.js");
const exam = require("../app/exam-options.js");
const { createRepository, KEY } = require("../app/storage.js");
const NOW = "2026-10-20T09:00:00.000Z";
const LATER = "2026-10-20T10:00:00.000Z";
function patient(options = {}) { return core.createPatient({ id: "format-patient", label: "Вымышленный Пациент", now: NOW, ...options }); }
function encounter() {
  const item = core.createEncounter({ id: "format-visit", patientId: "format-patient", now: NOW });
  item.visitDate = "2026-10-20";
  return item;
}
function format(changes = {}) { return { ...structuredClone(core.DEFAULT_RECORD_FORMAT), ...changes }; }
function freeze(value) {
  if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
function sample() {
  let item = encounter();
  item.history.complaints = "Вымышленная жалоба";
  item.history.context = "Дополнительное сведение врача";
  item.exam.other = "Дополнительный осмотр";
  Object.assign(item.examSelections, exam.NORMAL_SELECTIONS);
  Object.assign(item.vitals, { systolic: "120", diastolic: "80", pulse: "70", temperature: "36,6", respiratoryRate: "16", spo2: "98", weight: "70", height: "175" });
  Object.assign(item.assessment, { summary: "Вымышленный диагноз", plan: "Первый пункт\nВторой пункт", followUp: "Старое наблюдение", returnVisitDate: "2026-10-25", sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-21", sickLeaveFrom: "2026-10-20", sickLeaveTo: "2026-10-23" });
  item = core.upsertPrescription(item, { name: "Вымышленный препарат", dose: "Доза врача", route: "Путь врача", frequency: "Частота врача", duration: "Срок врача", note: "Примечание врача" }, { now: NOW });
  const card = core.upsertInvestigation(patient(), { kind: "lab", date: "2026-10-20", name: "Вымышленный показатель", result: "25", unit: "мг/л", reference: "Из бланка", note: "Учебный пример" }, { now: NOW });
  item = core.setEncounterInvestigations(item, card, card.investigations.map(result => result.id), { now: NOW });
  return { item, card, context: { patient: card, encounters: [item] } };
}

test("default formatting preserves the complete legacy empty note byte for byte", () => {
  const expected = [
    "МЕДАССИСТЕНТ · ДЕМОНСТРАЦИОННЫЙ ЧЕРНОВИК",
    "Только вымышленные данные. Неофициальный шаблон; не является нормативной формой Республики Беларусь.",
    "Автоматически собран из введённых полей. Требует проверки и редактирования врачом.",
    "",
    "Демо-пациент. Дата приёма: 20.10.2026.",
    "Возраст (полных лет): не заполнено.",
    "Пол: не указано.",
    "",
    "АНАМНЕЗ",
    "Жалобы: не заполнено",
    "Начало симптомов: не заполнено",
    "Течение: не заполнено",
    "Известные заболевания: не заполнено",
    "Принимаемые препараты на постоянной основе: не заполнено",
    "Аллергии и реакции: не заполнено",
    "",
    "ОСМОТР",
    "Общий осмотр: не заполнено",
    "Сердечно-сосудистая система: не заполнено",
    "Дыхательная система: не заполнено",
    "Живот: не заполнено",
    "Неврологический статус: не заполнено",
    "",
    "ПОКАЗАТЕЛИ",
    "Систолическое АД: не заполнено.",
    "Диастолическое АД: не заполнено.",
    "Пульс: не заполнено.",
    "Температура: не заполнено.",
    "Частота дыхания: не заполнено.",
    "SpO₂: не заполнено.",
    "Масса тела: не заполнено.",
    "Рост: не заполнено.",
    "",
    "ЗАКЛЮЧЕНИЕ",
    "Диагноз: не заполнено"
  ].join("\n");
  assert.equal(core.generateDraft(encounter()), expected);
  assert.equal(core.generateDraft(encounter(), undefined, core.DEFAULT_RECORD_FORMAT), expected);
});

test("format validation returns detached normalized settings without mutating frozen defaults", () => {
  assert.ok(Object.isFrozen(core.DEFAULT_RECORD_FORMAT));
  assert.ok(Object.isFrozen(core.DEFAULT_RECORD_FORMAT.order));
  assert.ok(Object.isFrozen(core.DEFAULT_RECORD_FORMAT.titles));
  assert.deepEqual(core.RECORD_SECTIONS, ["history", "exam", "investigations", "diagnosis", "recommendations", "sickLeave"]);
  const input = format();
  input.titles.history = "  Сведения  ";
  const normalized = core.validateRecordFormat(freeze(input));
  assert.equal(normalized.titles.history, "Сведения");
  normalized.order.reverse();
  normalized.titles.exam = "Мой осмотр";
  assert.equal(input.titles.history, "  Сведения  ");
  assert.deepEqual(input.order, core.RECORD_SECTIONS);
  assert.equal(core.DEFAULT_RECORD_FORMAT.titles.exam, "ОСМОТР");
});

test("all six sections may be reordered and renamed while every filled value and final return visit remain", () => {
  const { item, context } = sample();
  const custom = format({ order: [...core.RECORD_SECTIONS].reverse() });
  for (const key of Object.keys(custom.titles)) custom.titles[key] = "Мой " + key;
  const draft = core.generateDraft(freeze(item), freeze(context), freeze(custom));
  let previous = -1;
  for (const section of custom.order) {
    const index = draft.indexOf(custom.titles[section]);
    assert.ok(index > previous, section);
    previous = index;
  }
  assert.ok(draft.endsWith("Мой returnVisit: 25.10.2026"));
  for (const value of ["Вымышленная жалоба", "Дополнительное сведение врача", "Дополнительный осмотр", "Вымышленный показатель: 25 мг/л", "Вымышленный диагноз", "Первый пункт\nВторой пункт", "Старое наблюдение", "Вымышленный препарат", "ДЕМО-21", "Календарных дней: 4."]) assert.ok(draft.includes(value), value);
  assert.equal(draft.split("\n").slice(0, 8).join("\n"), core.generateDraft(item, context).split("\n").slice(0, 8).join("\n"));
});

test("paragraph exam preserves selected findings and labels without inferring missing values", () => {
  const { item, context } = sample();
  const draft = core.generateDraft(item, context, format({ examStyle: "paragraph" }));
  const start = draft.indexOf("ОСМОТР\n") + "ОСМОТР\n".length;
  const paragraph = draft.slice(start, draft.indexOf("\n\n", start));
  assert.equal(paragraph.includes("\n"), false);
  for (const field of exam.FIELDS) {
    const selected = field.options.find(option => option.value === item.examSelections[field.id]);
    assert.ok(paragraph.includes(selected.text.replace(/[.\s]+$/, "")), field.id);
  }
  assert.ok(paragraph.includes("Дополнительный осмотр. Систолическое АД: 120 мм рт. ст."));
  assert.ok(paragraph.endsWith("Индекс массы тела: 22,9 кг/м²."));
  assert.match(core.generateDraft(encounter(), undefined, format({ examStyle: "paragraph" })), /Общий осмотр: не заполнено\. Сердечно-сосудистая система: не заполнено\./);
});

test("recommendation lists split only explicit line breaks and retain punctuation and user numbering", () => {
  const item = encounter();
  item.assessment.plan = " Одно предложение. Второе; уточнение. \r\n\r\n  1. Уже пронумеровано\n- Авторский пункт\rПоследний пункт ";
  const draft = core.generateDraft(item, undefined, format({ recommendationsStyle: "list" }));
  assert.ok(draft.endsWith("Рекомендации:\n• Одно предложение. Второе; уточнение.\n• 1. Уже пронумеровано\n• - Авторский пункт\n• Последний пункт"));
  assert.equal(draft.split("\n").filter(line => line.startsWith("• ")).length, 4);
  assert.ok(core.generateDraft(item).endsWith("Рекомендации: " + item.assessment.plan.trim()));
});

test("compact vital labels change only known labels and never change entered clinical phrases", () => {
  const { item, context } = sample();
  item.exam.general = "Температура — слово в ручной фразе врача";
  const draft = core.generateDraft(item, context, format({ shortLabels: true }));
  for (const value of ["САД: 120 мм рт. ст.", "ДАД: 80 мм рт. ст.", "Пульс: 70 уд/мин.", "Т: 36,6 °C.", "ЧДД: 16 в мин.", "SpO₂: 98 %.", "Масса: 70 кг.", "Рост: 175 см.", "ИМТ: 22,9 кг/м².", item.exam.general]) assert.ok(draft.includes(value), value);
  assert.doesNotMatch(draft, /Систолическое АД:|Диастолическое АД:|Индекс массы тела:|ЧСС:/);
});

test("hiding standalone headings retains contextual field labels and all entered data", () => {
  const { item, context } = sample();
  const draft = core.generateDraft(item, context, format({ headings: false }));
  assert.doesNotMatch(draft, /^(АНАМНЕЗ|ОСМОТР|ПОКАЗАТЕЛИ|ИССЛЕДОВАНИЯ|ЗАКЛЮЧЕНИЕ)$/m);
  for (const value of ["Жалобы: Вымышленная жалоба", "Общий осмотр:", "20.10.2026 — Вымышленный показатель: 25 мг/л", "Диагноз: Вымышленный диагноз", "Рекомендации:", "Листок нетрудоспособности:", "Повторный приём:"]) assert.ok(draft.includes(value), value);
  assert.match(draft, /^МЕДАССИСТЕНТ · ДЕМОНСТРАЦИОННЫЙ ЧЕРНОВИК\nТолько вымышленные данные\./);
});

test("custom diagnosis title applies to structured diagnoses and default plural remains compatible", () => {
  const item = core.upsertDiagnosis(encounter(), { kind: "primary", text: "Вымышленный диагноз (МКБ-10: Z00.0)" }, { now: NOW });
  assert.match(core.generateDraft(item), /Диагнозы:\nОсновной диагноз: Вымышленный диагноз \(МКБ-10: Z00\.0\)/);
  const custom = format();
  custom.titles.diagnosis = "Клиническое заключение";
  const draft = core.generateDraft(item, undefined, custom);
  assert.match(draft, /Клиническое заключение:\nОсновной диагноз: Вымышленный диагноз \(МКБ-10: Z00\.0\)/);
});

test("empty optional sections remain omitted in every custom mode and inactive sick leave stays absent", () => {
  const item = encounter();
  item.assessment.sickLeaveIssued = "no";
  item.assessment.sickLeaveNumber = "НЕ ВЫДАВАЛСЯ";
  item.history.context = " \n ";
  item.exam.other = " \n ";
  item.assessment.plan = " \n ";
  const custom = format({ order: [...core.RECORD_SECTIONS].reverse(), headings: false, examStyle: "paragraph", recommendationsStyle: "list", shortLabels: true });
  const draft = core.generateDraft(item, undefined, custom);
  assert.doesNotMatch(draft, /Дополнительный анамнез|Другие данные осмотра|ИССЛЕДОВАНИЯ|Рекомендации|Листок нетрудоспособности|НЕ ВЫДАВАЛСЯ|Повторный приём/);
});

test("format changes are pure and do not invalidate fingerprints or rewrite manually reviewed drafts", () => {
  const { item, context } = sample();
  item.draft = { text: "Ручная запись врача", generatedAt: NOW, sourceFingerprint: core.fingerprint(item, context) };
  const reviewed = freeze(core.setReviewStatus(item, "reviewed", { now: NOW }));
  const before = JSON.stringify(reviewed);
  const fingerprint = core.fingerprint(reviewed, context);
  const custom = format({ headings: false, examStyle: "paragraph", recommendationsStyle: "list", shortLabels: true });
  assert.notEqual(core.generateDraft(reviewed, context, custom), core.generateDraft(reviewed, context));
  assert.equal(core.fingerprint(reviewed, context), fingerprint);
  assert.equal(JSON.stringify(reviewed), before);
  assert.equal(reviewed.workflow.reviewStatus, "reviewed");
  assert.equal(reviewed.draft.text, "Ручная запись врача");
});

test("invalid or incomplete format settings fail explicitly without allowing omitted or duplicate sections", () => {
  for (const value of [undefined, null, 4, [], {}, { ...format(), extra: true }]) assert.throws(() => core.validateRecordFormat(value));
  for (const order of [[], ["history"], [...core.RECORD_SECTIONS, "returnVisit"], ["history", ...core.RECORD_SECTIONS.slice(0, 5)], [...core.RECORD_SECTIONS.slice(0, 5), "unknown"], "history"]) assert.throws(() => core.validateRecordFormat(format({ order })), /порядке разделов/);
  for (const key of Object.keys(core.DEFAULT_RECORD_FORMAT)) {
    const value = format();
    delete value[key];
    assert.throws(() => core.validateRecordFormat(value), /структура/);
  }
  for (const title of ["", " ", "a\nb", "a\rb", "a\u2028b", "a\u2029b", "я".repeat(81), null, 9]) {
    const value = format();
    value.titles.history = title;
    assert.throws(() => core.validateRecordFormat(value), /Название/);
    assert.throws(() => core.generateDraft(encounter(), undefined, value), /Название/);
  }
  const absent = format(); delete absent.titles.returnVisit;
  assert.throws(() => core.validateRecordFormat(absent), /Название/);
  const unknown = format(); unknown.titles.unknown = "Другой";
  assert.throws(() => core.validateRecordFormat(unknown), /Название/);
  for (const changes of [{ headings: "false" }, { shortLabels: 1 }, { examStyle: "list" }, { recommendationsStyle: "lines" }]) assert.throws(() => core.validateRecordFormat(format(changes)), /варианты/);
  const boundary = format(); boundary.titles.history = "я".repeat(80);
  assert.equal(core.validateRecordFormat(boundary).titles.history.length, 80);
});

test("personal notes are optional exact text and survive schema-four backups and repository reads", () => {
  for (const personalNote of [undefined, "", "  Личная вымышленная заметка\nУточнить название препарата  ", "я".repeat(core.MAX_PERSONAL_NOTE_LENGTH)]) {
    const card = freeze(patient(personalNote === undefined ? {} : { personalNote }));
    assert.equal(Object.hasOwn(card, "personalNote"), personalNote !== undefined);
    const raw = core.serializeBundle([encounter()], [card]);
    const loaded = core.parseBundle(raw);
    assert.deepEqual(loaded.patients[0], card);
    assert.notEqual(loaded.patients[0], card);
    assert.equal(loaded.schemaVersion, 4);
    const memory = { getItem: key => key === KEY ? raw : null, setItem() { throw new Error("Не ожидается запись"); } };
    const stored = createRepository(memory).load();
    assert.equal(stored.error, null);
    assert.deepEqual(stored.patients[0], card);
  }
});

test("personal note edits are immutable and preserve other patient data with independent nested copies", () => {
  const { card } = sample();
  const original = freeze({ ...card, birthDate: "2000-10-20", sickLeaves: [] });
  const changed = core.setPatientNote(original, "  Личная заметка\nДля себя  ", { now: LATER });
  assert.equal(changed.personalNote, "  Личная заметка\nДля себя  ");
  assert.equal(changed.updatedAt, LATER);
  const expected = { ...original, personalNote: changed.personalNote, updatedAt: LATER };
  assert.deepEqual(changed, expected);
  assert.notEqual(changed.investigations, original.investigations);
  assert.notEqual(changed.investigations[0], original.investigations[0]);
  assert.notEqual(changed.sickLeaves, original.sickLeaves);
  assert.equal(Object.hasOwn(original, "personalNote"), false);
  const same = core.setPatientNote(freeze(changed), changed.personalNote, { now: "2026-10-20T12:00:00.000Z" });
  assert.deepEqual(same, changed);
  assert.notEqual(same, changed);
  const cleared = core.setPatientNote(changed, "", { now: "2026-10-20T12:00:00.000Z" });
  assert.equal(Object.hasOwn(cleared, "personalNote"), false);
  assert.equal(cleared.updatedAt, "2026-10-20T12:00:00.000Z");
});

test("personal notes never enter generated notes, source fingerprints, clinical briefings, templates or repeat visits", () => {
  const { item, card, context } = sample();
  item.draft = { text: "Ручная запись врача", generatedAt: NOW, sourceFingerprint: core.fingerprint(item, context) };
  const reviewed = freeze(core.setReviewStatus(item, "reviewed", { now: NOW }));
  const secret = "Личная вымышленная заметка не для записи";
  const changed = freeze(core.setPatientNote(card, secret, { now: LATER }));
  const beforeContext = { patient: card, encounters: [reviewed] };
  const afterContext = { patient: changed, encounters: [reviewed] };
  assert.equal(core.generateDraft(reviewed, beforeContext), core.generateDraft(reviewed, afterContext));
  assert.equal(core.fingerprint(reviewed, beforeContext), core.fingerprint(reviewed, afterContext));
  assert.deepEqual(core.getPatientBriefing(changed, [reviewed], "2026-10-20"), core.getPatientBriefing(card, [reviewed], "2026-10-20"));
  const repeated = core.createRepeatEncounter(reviewed, { id: "format-repeat", now: LATER, carryHistoryFields: ["conditions", "medications", "allergies"] });
  assert.equal(JSON.stringify(repeated).includes(secret), false);
  assert.equal(JSON.stringify(core.createVisitTemplate(reviewed, { name: "Тестовый шаблон", kind: "exam", now: LATER })).includes(secret), false);
  assert.equal(reviewed.workflow.reviewStatus, "reviewed");
  assert.equal(reviewed.draft.text, "Ручная запись врача");
});

test("patient mutations retain personal notes while malformed notes and legacy imports fail without writes", () => {
  const card = freeze(patient({ personalNote: "Сохранить личную заметку" }));
  const values = { kind: "lab", date: "2026-10-20", name: "Вымышленный показатель", result: "1", unit: "мг/л", reference: "", note: "" };
  const withResult = core.upsertInvestigation(card, values, { now: LATER });
  assert.equal(withResult.personalNote, card.personalNote);
  assert.equal(core.removeInvestigation(withResult, withResult.investigations[0].id, { now: LATER }).personalNote, card.personalNote);
  const withLeave = core.issueSickLeave(card, { number: "ДЕМО", from: "2026-10-20", to: "2026-10-21", now: LATER });
  assert.equal(withLeave.personalNote, card.personalNote);
  for (const invalid of [null, 5, {}, [], "я".repeat(core.MAX_PERSONAL_NOTE_LENGTH + 1)]) {
    assert.throws(() => patient({ personalNote: invalid }), /личная заметка/i);
    assert.throws(() => core.setPatientNote(card, invalid), /Личная заметка/);
    const data = JSON.parse(core.serializeBundle([encounter()], [patient()]));
    data.patients[0].personalNote = invalid;
    assert.ok(core.validatePatient(data.patients[0]).some(error => error.field === "personalNote"));
    assert.throws(() => core.parseBundle(JSON.stringify(data)), /личная заметка/i);
    const memory = { getItem: key => key === KEY ? JSON.stringify(data) : null, setItem() { throw new Error("Не ожидается запись"); } };
    assert.match(createRepository(memory).load().error, /личная заметка/i);
  }
  for (const options of [null, { extra: true }, { now: "invalid" }]) assert.throws(() => core.setPatientNote(card, "Текст", options), /заметки/);
  const legacy = JSON.parse(core.serializeBundle([encounter()], [card]));
  legacy.schemaVersion = 3;
  delete legacy.encounters[0].workflow;
  assert.throws(() => core.parseBundle(JSON.stringify(legacy)), /Личная заметка не поддерживается/);
});
