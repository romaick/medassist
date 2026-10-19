"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const createLookup = require("../icd/lookup.cjs");

// These labels and codes exercise text lookup only; they are not a clinical catalog.
function catalog(entries = [
  {code: "A03", title: "Другие острые тестовые состояния", kind: "category"},
  {code: "A02", title: "Острая тестовая запись", kind: "category"},
  {code: "A01.1", title: "Острый тестовый пример с уточнением", kind: "subcategory"},
  {code: "A01", title: "Острый тестовый пример", kind: "category", aliases: ["Проверочный синоним"]},
  {code: "A04", title: "Ёмкая тестовая запись", kind: "category"},
  {code: "A05", title: "Хронический тестовый пример", kind: "category"}
]) {
  return {
    metadata: {classification: "TEST ONLY", release: "test-1", publisher: "Test fixture", sourceUrl: "https://example.invalid/catalog", checkedAt: "2026-10-19", note: "Synthetic data; not for medical use."},
    entries
  };
}
function codes(result) { return result.items.map(entry => entry.code); }

test("ICD lookup normalizes case, whitespace and ё", () => {
  const lookup = createLookup(catalog());
  assert.deepEqual(codes(lookup.search("  ЁМКАЯ\n\tТЕСТОВАЯ  ")), ["A04"]);
  assert.deepEqual(codes(lookup.search("емкая")), ["A04"]);
  assert.equal(lookup.search("Емкая").items[0].title, "Ёмкая тестовая запись");
});

test("ICD lookup handles adjective forms while requiring every keyword", () => {
  const lookup = createLookup(catalog());
  assert.deepEqual(codes(lookup.search("острый")), ["A01", "A01.1", "A02", "A03"]);
  assert.deepEqual(codes(lookup.search("тестовый острый пример")), ["A01", "A01.1"]);
  assert.deepEqual(codes(lookup.search("пример неизвестный")), []);
  assert.deepEqual(codes(lookup.search("тес прим")), ["A01", "A01.1", "A05"]);
});

test("ICD lookup orders exact code before code prefix matches and accepts lowercase", () => {
  const lookup = createLookup(catalog());
  assert.deepEqual(codes(lookup.search("a01")), ["A01", "A01.1"]);
  assert.deepEqual(codes(lookup.search("A01.1")), ["A01.1"]);
  assert.deepEqual(codes(lookup.search("A01.")), ["A01.1"]);
  assert.deepEqual(codes(lookup.search("A01 уточнением")), ["A01.1"]);
});

test("ICD lookup distinguishes national suffix codes from their unsuffixed prefixes", () => {
  const lookup = createLookup(catalog([
    {code: "I20A", title: "Тестовая рубрика с суффиксом", kind: "category"},
    {code: "I20.0A", title: "Тестовая подрубрика с суффиксом", kind: "subcategory"},
    {code: "I20.1A", title: "Другая тестовая подрубрика с суффиксом", kind: "subcategory"},
    {code: "I20.0", title: "Тестовая подрубрика", kind: "subcategory"},
    {code: "I20", title: "Тестовая рубрика", kind: "category"},
    {code: "K04.3X", title: "Тестовая запись с другим суффиксом", kind: "subcategory"}
  ]));
  assert.deepEqual(codes(lookup.search("i20")), ["I20", "I20.0", "I20.0A", "I20.1A", "I20A"]);
  assert.deepEqual(codes(lookup.search("i20a")), ["I20A"]);
  assert.deepEqual(codes(lookup.search("i20.0")), ["I20.0", "I20.0A"]);
  assert.deepEqual(codes(lookup.search("i20.0a")), ["I20.0A"]);
  assert.deepEqual(codes(lookup.search("i20.")), ["I20.0", "I20.0A", "I20.1A"]);
  assert.deepEqual(codes(lookup.search("k04.3x")), ["K04.3X"]);
  assert.deepEqual(codes(lookup.search("k04.3")), ["K04.3X"]);
  assert.deepEqual(codes(lookup.search("i20.0x")), []);
});

test("ICD lookup keeps suffix codes together when combined with words or punctuation", () => {
  const lookup = createLookup(catalog([
    {code: "I20.0A", title: "Проверочная тестовая запись", kind: "subcategory"},
    {code: "I20.0", title: "Проверочная тестовая запись", kind: "subcategory"},
    {code: "I20A", title: "Проверочная тестовая рубрика", kind: "category"},
    {code: "K04.3X", title: "Тестовая ссылка на I20.0A", kind: "subcategory"}
  ]));
  assert.deepEqual(codes(lookup.search("[i20.0a]")), ["I20.0A"]);
  assert.deepEqual(codes(lookup.search("(I20A),")), ["I20A"]);
  assert.deepEqual(codes(lookup.search("проверочная, [i20.0a] запись")), ["I20.0A"]);
  assert.deepEqual(codes(lookup.search("i20a проверочная рубрика")), ["I20A"]);
  assert.deepEqual(codes(lookup.search("i20.0a неизвестное")), []);
});

test("ICD lookup preserves national codes and source title cross references verbatim", () => {
  const title = "Тестовая запись [уточнение] (I20.0A*+)";
  const lookup = createLookup(catalog([{code: "K04.3X", title, kind: "subcategory"}]));
  assert.deepEqual(lookup.search("тестовая").items[0], {code: "K04.3X", title, kind: "subcategory"});
  assert.deepEqual(codes(lookup.search("запись I20.0A")), ["K04.3X"]);
});

test("ICD lookup preserves immutable parent context without searching it or changing titles", () => {
  for (const code of ["B03", "B00-B09", "III"]) {
    const parent = {code, title: "Справочная группа [уточнение] (B03*+)"};
    const source = catalog([{code: "A01.1", title: "Краткий", kind: "subcategory", parent}]);
    const lookup = createLookup(source);
    const entry = lookup.search("краткий").items[0];
    assert.equal(entry.title, "Краткий");
    assert.deepEqual(entry.parent, parent);
    assert.notEqual(entry.parent, parent);
    assert.ok(Object.isFrozen(entry.parent));
    parent.code = "Changed";
    parent.title = "Changed";
    assert.equal(entry.parent.code, code);
    assert.equal(entry.parent.title, "Справочная группа [уточнение] (B03*+)");
    assert.throws(() => { entry.parent.title = "Changed"; }, TypeError);
    assert.equal(lookup.search("справочная").total, 0);
    assert.equal(lookup.search("B03").total, 0);
    assert.equal(lookup.search("краткий справочная").total, 0);
  }
});

test("ICD lookup ranks exact title, phrase and keyword prefix, with deterministic code ties", () => {
  const lookup = createLookup(catalog([
    {code: "A01", title: "Тестовой пример", kind: "category"},
    {code: "A04", title: "Тест", kind: "category"},
    {code: "A03", title: "Другой тест", kind: "category"},
    {code: "A02", title: "Тестовый пример", kind: "category"}
  ]));
  assert.deepEqual(codes(lookup.search("тест")), ["A04", "A03", "A01", "A02"]);
});

test("ICD lookup searches only supplied aliases and does not infer a diagnosis", () => {
  const lookup = createLookup(catalog());
  assert.deepEqual(codes(lookup.search("проверочный синоним")), ["A01"]);
  assert.deepEqual(codes(lookup.search("проверочный пример")), ["A01"]);
  assert.deepEqual(codes(lookup.search("бронхит")), []);
});

test("ICD lookup returns no matches for empty, one-letter or unmatched queries", () => {
  const lookup = createLookup(catalog());
  for (const query of ["", "  ", "а", "a", " а  ", "?", "---", "неизвестный"]) {
    assert.deepEqual(lookup.search(query), {items: [], total: 0});
  }
});

test("ICD lookup limits displayed results while preserving the full match count", () => {
  const entries = Array.from({length: 60}, (_, index) => ({code: `A${String(index).padStart(2, "0")}`, title: `Тестовый пример ${index}`, kind: "category"}));
  const lookup = createLookup(catalog(entries));
  assert.equal(lookup.search("тест").items.length, 20);
  assert.equal(lookup.search("тест", 7).items.length, 7);
  assert.equal(lookup.search("тест", 100).items.length, 50);
  assert.equal(lookup.search("тест", 7).total, 60);
  assert.deepEqual(codes(lookup.search("тест", 3)), ["A00", "A01", "A02"]);
  for (const limit of [0, -1, 1.5, NaN, Infinity, "20"]) assert.throws(() => lookup.search("тест", limit), RangeError);
});

test("ICD lookup preserves literal catalog text and treats input as text", () => {
  const title = '<img src=x onerror="throw Error(1)"> Тестовая запись';
  const lookup = createLookup(catalog([{code: "A00", title, kind: "category"}]));
  assert.equal(lookup.search("тестовая").items[0].title, title);
  assert.equal(lookup.search(".*").total, 0);
  assert.equal(lookup.search("[тестовая]").total, 1);
  assert.equal(lookup.search("<script>alert(1)</script>").total, 0);
});

test("ICD lookup owns immutable copies of metadata, entries, aliases and results", () => {
  const source = catalog();
  const lookup = createLookup(source);
  const result = lookup.search("проверочный");
  source.entries[3].title = "Changed";
  source.entries[3].aliases.push("Added");
  source.entries.push({code: "B00", title: "Added", kind: "category"});
  source.metadata.release = "Changed";
  assert.equal(lookup.size, 6);
  assert.equal(lookup.metadata.release, "test-1");
  assert.equal(result.items[0].title, "Острый тестовый пример");
  assert.deepEqual(result.items[0].aliases, ["Проверочный синоним"]);
  for (const value of [lookup, lookup.metadata, result, result.items, result.items[0], result.items[0].aliases, lookup.search("").items]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { result.items[0].title = "Changed"; }, TypeError);
});

test("ICD lookup rejects malformed catalog data rather than silently skipping entries", () => {
  for (const value of [null, [], "catalog"]) assert.throws(() => createLookup(value), /catalog must be an object/);
  assert.throws(() => createLookup({entries: []}), /metadata/);
  for (const key of ["classification", "release", "publisher", "sourceUrl", "checkedAt", "note"]) {
    const source = catalog();
    delete source.metadata[key];
    assert.throws(() => createLookup(source), new RegExp(`metadata\\.${key}`));
  }
  assert.throws(() => createLookup({...catalog(), entries: {}}), /entries must be an array/);
  assert.throws(() => createLookup(catalog([null])), /entry 0 must be an object/);
  for (const code of ["", "a01", "A1", "A001", "A01.", "A01.x", "A01.12345", "A00-A09", "A01 ", "A01AA", "A01.1AA", "A01.1*", "A01.1+", "A01.1†", "A01А"]) {
    assert.throws(() => createLookup(catalog([{code, title: "Тест", kind: "category"}])), /invalid code/);
  }
  assert.throws(() => createLookup(catalog([{code: "A01", title: "Тест", kind: "other"}])), /invalid kind/);
  assert.throws(() => createLookup(catalog([{code: "A01.1", title: "Тест", kind: "category"}])), /kind does not match/);
  assert.throws(() => createLookup(catalog([{code: "A01", title: "Тест", kind: "subcategory"}])), /kind does not match/);
  for (const title of ["", "  ", null, 1]) assert.throws(() => createLookup(catalog([{code: "A01", title, kind: "category"}])), /non-empty title/);
  for (const aliases of [null, "alias", [""], [" "], [1]]) assert.throws(() => createLookup(catalog([{code: "A01", title: "Тест", kind: "category", aliases}])), /aliases/);
  for (const parent of [null, [], "parent", {}, {code: "", title: "Тест"}, {code: "A01", title: " "}, {code: 1, title: "Тест"}, {code: "A01", title: null}]) {
    assert.throws(() => createLookup(catalog([{code: "A01.1", title: "Тест", kind: "subcategory", parent}])), /parent must contain non-empty code and title strings/);
  }
  assert.throws(() => createLookup(catalog([{code: "A01", title: "Первый", kind: "category"}, {code: "A01", title: "Второй", kind: "category"}])), /duplicate code A01/);
});

test("ICD lookup can be serialized into the offline bundle without external dependencies", () => {
  const factory = vm.runInNewContext(`(${createLookup.toString()})`);
  const lookup = factory(catalog());
  assert.equal(lookup.search("острый").total, 4);
  assert.equal(lookup.metadata.classification, "TEST ONLY");
  const contextual = factory(catalog([{code: "I20.0A", title: "Тест", kind: "subcategory", parent: {code: "I20A", title: "Рубрика"}}]));
  assert.equal(contextual.search("i20.0a").items[0].parent.title, "Рубрика");
  assert.equal(createLookup(catalog([])).search("тест").total, 0);
  assert.throws(() => createLookup(catalog()).search(null), /query must be a string/);
});
