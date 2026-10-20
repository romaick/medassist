"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../app/core.js");
const { createRepository, summarizeBackup, KEY } = require("../app/storage.js");
const NOW = "2032-04-19T09:00:00.000Z";

function shortcut(id = "shortcut-demo", code = "демо", text = "Демонстрационный текст.") { return { id, code, text }; }
function freeze(value) {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function clinicalData() {
  const patient = core.createPatient({ id: "fictional-patient", label: "Вымышленный Пациент", now: NOW });
  const encounter = core.createEncounter({ id: "fictional-visit", patientId: patient.id, now: NOW });
  encounter.history.complaints = "Жалобы вымышленного пациента";
  encounter.exam.general = "Демонстрационный осмотр";
  const template = core.createVisitTemplate(encounter, { name: "Вымышленный шаблон", kind: "exam", id: "template-demo", now: NOW });
  return { patient, encounter, template };
}
function memoryStorage(raw = null) {
  return {
    raw, fail: false, writes: 0,
    getItem(key) { return key === KEY ? this.raw : null; },
    setItem(key, value) { assert.equal(key, KEY); if (this.fail) throw new Error("Quota exceeded"); this.writes += 1; this.raw = value; }
  };
}
function bundle(shortcuts = []) { return JSON.parse(core.serializeBundle([], [], [], shortcuts)); }

test("shortcut validation canonicalizes codes but preserves exact multiline text in a detached dictionary", () => {
  const input = freeze([shortcut("one", "  Демо-1._  ", "  Первая строка.\nВторая строка.\n ")]);
  const result = core.validateShortcuts(input);
  assert.deepEqual(result, [{ id: "one", code: "Демо-1._", text: input[0].text }]);
  assert.notEqual(result, input);
  assert.notEqual(result[0], input[0]);
  result[0].text = "Changed";
  assert.equal(input[0].text, "  Первая строка.\nВторая строка.\n ");
  assert.deepEqual(core.validateShortcuts([]), []);
});

test("malformed shortcut dictionaries are rejected without silently dropping fields or sparse entries", () => {
  const bad = [null, {}, "text", Array(1), [null], [1], ["text"], [{}], [{ ...shortcut(), other: true }], [{ code: "демо", text: "text" }], [{ ...shortcut(), id: "<id>" }], [{ ...shortcut(), id: 1 }], [{ ...shortcut(), code: null }], [{ ...shortcut(), code: "" }], [{ ...shortcut(), code: " \n " }], [{ ...shortcut(), code: "два слова" }], [{ ...shortcut(), code: "<демо>" }], [{ ...shortcut(), code: "демо/1" }], [{ ...shortcut(), text: null }], [{ ...shortcut(), text: "\n\t " }]];
  for (const value of bad) assert.throws(() => core.validateShortcuts(value), JSON.stringify(value));
});

test("shortcut IDs are unique and codes ignore case while distinguishing е and ё", () => {
  assert.throws(() => core.validateShortcuts([shortcut("one", "ДЕМО"), shortcut("two", "демо")]), /уже существует/);
  assert.throws(() => core.validateShortcuts([shortcut("one", "ДЕМО"), shortcut("two", "  демо  ")]), /уже существует/);
  assert.throws(() => core.validateShortcuts([shortcut("same", "один"), shortcut("same", "два")]), /идентификатор/);
  assert.equal(core.validateShortcuts([shortcut("one", "все"), shortcut("two", "всё")]).length, 2);
});

test("dictionary and entry size limits accept their boundaries and reject one extra item or character", () => {
  assert.equal(core.MAX_SHORTCUTS, 100);
  assert.equal(core.MAX_SHORTCUT_CODE_LENGTH, 40);
  assert.equal(core.MAX_SHORTCUT_TEXT_LENGTH, 10000);
  const maximum = Array.from({ length: 100 }, (_, index) => shortcut("item-" + index, "демо" + index));
  assert.equal(core.validateShortcuts(freeze(maximum)).length, 100);
  assert.throws(() => core.upsertShortcut(maximum, { code: "новый", text: "Демо" }), /100/);
  assert.equal(core.validateShortcuts([shortcut("limit", "д".repeat(40), "т".repeat(10000))])[0].text.length, 10000);
  assert.throws(() => core.validateShortcuts([shortcut("limit", "д".repeat(41))]), /40/);
  assert.throws(() => core.validateShortcuts([shortcut("limit", "д", "т".repeat(10001))]), /10000/);
  assert.equal(core.upsertShortcut(maximum, { code: "обновлено", text: "Демо" }, { id: "item-0" }).length, 100);
});

test("create and edit preserve IDs, order, unrelated entries and all immutable input data", () => {
  const original = freeze([shortcut("one", "один"), shortcut("two", "два")]);
  const added = core.upsertShortcut(original, { code: "  Три  ", text: "\n Третья строка \n" });
  assert.equal(added.length, 3);
  assert.match(added[2].id, /^shortcut-/);
  assert.equal(added[2].code, "Три");
  assert.equal(added[2].text, "\n Третья строка \n");
  const updated = core.upsertShortcut(freeze(added), { code: "ОДИН", text: "Изменённый текст" }, { id: "one" });
  assert.deepEqual(updated.map(item => item.id), added.map(item => item.id));
  assert.deepEqual(updated[1], original[1]);
  assert.notEqual(updated[1], original[1]);
  assert.equal(original[0].text, "Демонстрационный текст.");
  assert.equal(updated[0].text, "Изменённый текст");
});

test("duplicate, missing and unexpected mutation parameters fail without modifying the dictionary", () => {
  const original = freeze([shortcut("one", "один"), shortcut("two", "два")]);
  const before = JSON.stringify(original);
  assert.throws(() => core.upsertShortcut(original, { code: "ОДИН", text: "Демо" }), /уже существует/);
  assert.throws(() => core.upsertShortcut(original, { code: "ОДИН", text: "Демо" }, { id: "two" }), /уже существует/);
  assert.throws(() => core.upsertShortcut(original, { code: "три", text: "Демо" }, { id: "missing" }), /не найдено/);
  for (const values of [null, {}, { code: "три" }, { code: "три", text: "Демо", extra: true }]) assert.throws(() => core.upsertShortcut(original, values));
  for (const options of [null, [], { extra: true }, { id: 123 }]) assert.throws(() => core.upsertShortcut(original, { code: "три", text: "Демо" }, options));
  assert.equal(JSON.stringify(original), before);
});

test("delete returns detached remaining entries and rejects stale missing IDs", () => {
  const original = freeze([shortcut("one", "один"), shortcut("two", "два")]);
  const remaining = core.removeShortcut(original, "one");
  assert.deepEqual(remaining, [original[1]]);
  assert.notEqual(remaining[0], original[1]);
  assert.deepEqual(core.removeShortcut(remaining, "two"), []);
  for (const id of [null, "", "missing", 1]) assert.throws(() => core.removeShortcut(original, id), /не найдено/);
  assert.equal(original.length, 2);
});

test("caret lookup matches whole Cyrillic and Unicode codes case-insensitively and returns a clone", () => {
  const entries = freeze([shortcut("one", "дЁмо"), shortcut("two", "демо"), shortcut("three", "症1"), shortcut("four", "𐐀1")]);
  for (const [value, id] of [["До: ДЁМО", "one"], ["демо", "two"], ["症1", "three"], ["𐐨1", "four"]]) {
    const found = core.findShortcutAtCaret(value, value.length, value.length, entries);
    assert.equal(found.id, id);
    assert.notEqual(found, entries.find(item => item.id === id));
  }
  assert.equal(core.findShortcutAtCaret("ДЕМО", 4, 4, [entries[0]]), null);
});

test("lookup requires complete tokens on both sides and accepts punctuation outside the code alphabet", () => {
  const entries = [shortcut()];
  for (const prefix of ["а", "1", "_", ".", "-", "症", "𐐀"]) {
    const value = prefix + "демо";
    assert.equal(core.findShortcutAtCaret(value, value.length, value.length, entries), null, value);
  }
  for (const suffix of ["а", "1", "_", ".", "-", "症", "𐐀"]) assert.equal(core.findShortcutAtCaret("демо" + suffix, 4, 4, entries), null, suffix);
  for (const value of ["(демо)", " демо,", "\nдемо:", "«демо»"]) {
    const end = value.indexOf("демо") + 4;
    assert.equal(core.findShortcutAtCaret(value, end, end, entries).id, "shortcut-demo");
  }
  assert.equal(core.findShortcutAtCaret("дем", 3, 3, entries), null);
  assert.equal(core.findShortcutAtCaret("демо ", 5, 5, entries), null);
  assert.equal(core.findShortcutAtCaret("", 0, 0, entries), null);
});

test("selection lookup matches exact selected codes without selecting part of another token", () => {
  const entries = [shortcut()];
  assert.equal(core.findShortcutAtCaret("До ДЕМО после", 3, 7, entries).id, "shortcut-demo");
  assert.equal(core.findShortcutAtCaret("адемо", 1, 5, entries), null);
  assert.equal(core.findShortcutAtCaret("демоа", 0, 4, entries), null);
  assert.equal(core.findShortcutAtCaret(" демо ", 0, 6, entries), null);
  assert.equal(core.findShortcutAtCaret("демонстрация", 0, 4, entries), null);
});

test("explicit selection replaces only that span with literal multiline text and places caret after it", () => {
  const value = "Начало: удалить эти слова. Конец.";
  const start = value.indexOf("удалить");
  const end = value.indexOf(". Конец");
  const chosen = freeze(shortcut("chosen", "иная", "  Новый\nтекст  "));
  const result = core.shortcutReplacement(value, start, end, chosen, 1000);
  assert.equal(result.value, "Начало:   Новый\nтекст  . Конец.");
  assert.equal(result.selectionStart, start + chosen.text.length);
  assert.equal(result.selectionEnd, result.selectionStart);
  assert.equal(core.shortcutReplacement("адемоб", 1, 5, shortcut("x", "иная", "X"), 10).value, "аXб");
});

test("collapsed replacement expands only the matching token immediately before the caret", () => {
  const chosen = shortcut("chosen", "Демо", "Раскрыто");
  const value = "демо, затем ДЕМО, ещё демо";
  const caret = value.indexOf(", ещё");
  const result = core.shortcutReplacement(value, caret, caret, chosen, 100);
  assert.equal(result.value, "демо, затем Раскрыто, ещё демо");
  assert.equal(result.selectionStart, "демо, затем Раскрыто".length);
  assert.equal(core.shortcutReplacement("демо", 4, 4, chosen, 100).value, "Раскрыто");
});

test("choosing another shortcut or a partial token inserts at caret without deleting adjacent text", () => {
  const chosen = shortcut("chosen", "демо", "X");
  const cases = [["иной", 4, "инойX"], ["адемо", 5, "адемоX"], ["демоа", 4, "демоXа"], ["демо.", 4, "демоX."], ["демо-", 5, "демо-X"], ["до после", 3, "до Xпосле"], ["", 0, "X"]];
  for (const [value, caret, expected] of cases) assert.equal(core.shortcutReplacement(value, caret, caret, chosen, 100).value, expected);
});

test("insertion never evaluates or changes markup-looking shortcut text", () => {
  const text = '<img src=x onerror="alert(1)">\n<script>demo</script>& < >';
  assert.deepEqual(core.shortcutReplacement("демо", 0, 4, shortcut("safe", "демо", text), 1000), { value: text, selectionStart: text.length, selectionEnd: text.length });
});

test("replacement applies the field limit after replacement and rejects overflow without truncation", () => {
  const chosen = freeze(shortcut("chosen", "демо", "12345"));
  assert.equal(core.shortcutReplacement("демо", 4, 4, chosen, 5).value, "12345");
  assert.throws(() => core.shortcutReplacement("демо", 4, 4, chosen, 4), /превышает/);
  const oldText = "очень длинный старый текст";
  assert.equal(core.shortcutReplacement(oldText, 0, oldText.length, chosen, 5).value, "12345");
  assert.throws(() => core.shortcutReplacement("x", 1, 1, chosen, 5), /превышает/);
  assert.equal(chosen.text, "12345");
});

test("invalid caret ranges and field limits are rejected explicitly", () => {
  const chosen = shortcut();
  for (const [value, start, end] of [[null, 0, 0], ["demo", -1, 0], ["demo", 3, 2], ["demo", 0, 5], ["demo", 1.1, 2], ["demo", 0, NaN], ["demo", "0", 4]]) {
    assert.throws(() => core.findShortcutAtCaret(value, start, end, [chosen]), /выделение/);
    assert.throws(() => core.shortcutReplacement(value, start, end, chosen, 100), /выделение/);
  }
  for (const limit of [undefined, null, -1, Infinity, 1.1, "100"]) assert.throws(() => core.shortcutReplacement("", 0, 0, chosen, limit), /ограничение/);
  assert.throws(() => core.shortcutReplacement("", 0, 0, { ...chosen, text: "" }, 100), /Текст/);
});

test("backup roundtrip retains shortcuts independently of patients, encounters and visit templates", () => {
  const { patient, encounter, template } = clinicalData();
  const shortcuts = freeze([shortcut()]);
  const result = core.parseBundle(core.serializeBundle([freeze(encounter)], [freeze(patient)], [freeze(template)], shortcuts));
  assert.deepEqual(result.shortcuts, shortcuts);
  assert.deepEqual(result.encounters, [encounter]);
  assert.deepEqual(result.patients, [patient]);
  assert.deepEqual(result.templates, [template]);
  assert.equal(result.schemaVersion, 4);
  result.shortcuts[0].text = "Changed";
  assert.equal(shortcuts[0].text, "Демонстрационный текст.");
  assert.deepEqual(core.parseBundle(core.serializeBundle([], [], undefined, shortcuts)).shortcuts, shortcuts);
});

test("absent or empty shortcuts leave the legacy bundle shape unchanged", () => {
  for (const shortcuts of [undefined, []]) {
    const parsed = core.parseBundle(core.serializeBundle([], [], undefined, shortcuts));
    assert.deepEqual(Object.keys(parsed), ["format", "schemaVersion", "exportedAt", "patients", "encounters"]);
  }
  const legacy = bundle();
  legacy.schemaVersion = 3;
  assert.equal(Object.hasOwn(core.parseBundle(JSON.stringify(legacy)), "shortcuts"), false);
  legacy.shortcuts = [shortcut()];
  assert.throws(() => core.parseBundle(JSON.stringify(legacy)), /структура/);
});

test("corrupt shortcut fields and duplicate codes fail backup validation instead of disappearing", () => {
  const original = freeze(bundle([shortcut()]));
  for (const shortcuts of [null, {}, [shortcut(), shortcut("other", "ДЕМО")], [{ ...shortcut(), text: 123 }], [{ ...shortcut(), patientId: "fictional-patient" }]]) {
    const invalid = { ...original, shortcuts };
    assert.throws(() => core.validateBundle(invalid));
    assert.throws(() => core.parseBundle(JSON.stringify(invalid)));
  }
  const detached = core.validateBundle(original);
  detached.shortcuts[0].text = "Changed";
  assert.equal(original.shortcuts[0].text, "Демонстрационный текст.");
});

test("dictionary edits do not alter patient records, drafts, review status or generated text", () => {
  const { patient, encounter } = clinicalData();
  encounter.draft.text = "Ручной текст врача";
  const reviewed = core.setReviewStatus(encounter, "reviewed", { now: NOW });
  const before = core.fingerprint(reviewed, { patient });
  const entries = core.upsertShortcut([], { code: "демо", text: "Личный сохранённый текст" });
  const parsed = core.parseBundle(core.serializeBundle([freeze(reviewed)], [freeze(patient)], [], entries));
  assert.deepEqual(parsed.encounters, [reviewed]);
  assert.equal(core.fingerprint(parsed.encounters[0], { patient: parsed.patients[0] }), before);
  assert.doesNotMatch(core.generateDraft(parsed.encounters[0], { patient: parsed.patients[0] }), /Личный сохранённый текст/);
});

test("repository reads saved shortcuts lazily and preserves them across older two- and three-argument saves", () => {
  const { patient, encounter, template } = clinicalData();
  const entries = [shortcut()];
  const storage = memoryStorage(core.serializeBundle([encounter], [patient], [template], entries));
  const repository = createRepository(storage);
  assert.equal(repository.save([encounter], [patient]).ok, true);
  assert.deepEqual(core.parseBundle(storage.raw).shortcuts, entries);
  assert.deepEqual(core.parseBundle(storage.raw).templates, [template]);
  assert.equal(repository.save([encounter], [patient], []).ok, true);
  assert.deepEqual(repository.load().shortcuts, entries);
  assert.equal(Object.hasOwn(repository.load(), "templates"), false);
});

test("repository caches cloned dictionaries and honors explicit clearing", () => {
  const entries = [shortcut()];
  const storage = memoryStorage(core.serializeBundle([], [], [], entries));
  const repository = createRepository(storage);
  const loaded = repository.load();
  loaded.shortcuts[0].text = "Caller mutation";
  assert.equal(repository.save([], []).ok, true);
  assert.equal(core.parseBundle(storage.raw).shortcuts[0].text, entries[0].text);
  const next = [shortcut("next", "новый", "Новый текст")];
  assert.equal(repository.save([], [], undefined, next).ok, true);
  next[0].text = "Another caller mutation";
  assert.equal(repository.save([], []).ok, true);
  assert.equal(core.parseBundle(storage.raw).shortcuts[0].text, "Новый текст");
  assert.equal(repository.save([], [], undefined, []).ok, true);
  assert.equal(Object.hasOwn(core.parseBundle(storage.raw), "shortcuts"), false);
  assert.deepEqual(repository.load(), { patients: [], encounters: [], error: null });
});

test("failed dictionary writes preserve stored data and the repository cache for a later normal save", () => {
  const original = [shortcut()];
  const storage = memoryStorage(core.serializeBundle([], [], [], original));
  const repository = createRepository(storage);
  repository.load();
  const previous = storage.raw;
  storage.fail = true;
  const result = repository.save([], [], [], [shortcut("next", "новый")]);
  assert.equal(result.ok, false);
  assert.match(result.error, /Quota exceeded/);
  assert.equal(storage.raw, previous);
  storage.fail = false;
  assert.equal(repository.save([], []).ok, true);
  assert.deepEqual(core.parseBundle(storage.raw).shortcuts, original);
  assert.equal(repository.save([], [], [], null).ok, false);
  assert.deepEqual(core.parseBundle(storage.raw).shortcuts, original);
});

test("reset replaces shortcut dictionaries atomically and default reset clears them", () => {
  const original = [shortcut()];
  const storage = memoryStorage(core.serializeBundle([], [], [], original));
  const repository = createRepository(storage);
  repository.load();
  storage.fail = true;
  assert.equal(repository.reset([], [], [], [shortcut("next", "новый")]).ok, false);
  storage.fail = false;
  assert.equal(repository.save([], []).ok, true);
  assert.deepEqual(core.parseBundle(storage.raw).shortcuts, original);
  const restored = [shortcut("restored", "восстановлен", "Восстановленная фраза")];
  assert.equal(repository.reset([], [], [], restored).ok, true);
  restored[0].text = "Caller mutation";
  assert.equal(repository.save([], []).ok, true);
  assert.equal(repository.load().shortcuts[0].text, "Восстановленная фраза");
  assert.equal(repository.reset().ok, true);
  assert.deepEqual(repository.load(), { patients: [], encounters: [], error: null });
});

test("corrupt saved dictionaries stop ordinary saves until explicit successful replacement", () => {
  const corrupt = JSON.stringify({ ...bundle(), shortcuts: [{ ...shortcut(), code: "два слова" }] });
  const storage = memoryStorage(corrupt);
  const repository = createRepository(storage);
  assert.match(repository.load().error, /Автоматическая запись остановлена/);
  assert.equal(repository.save([], [], [], []).ok, false);
  assert.equal(storage.raw, corrupt);
  assert.equal(storage.writes, 0);
  assert.equal(repository.reset([], [], [], [shortcut()]).ok, true);
  assert.deepEqual(repository.load().shortcuts, [shortcut()]);
});

test("backup summary counts shortcuts even when there are no patient cards", () => {
  const empty = summarizeBackup(freeze(bundle()));
  assert.equal(empty.shortcutCount, 0);
  const summary = summarizeBackup(freeze(bundle([shortcut("one", "один"), shortcut("two", "два")])));
  assert.equal(summary.shortcutCount, 2);
  assert.equal(summary.patientCount, 0);
  assert.equal(summary.encounterCount, 0);
  assert.equal(summary.templateCount, 0);
});
