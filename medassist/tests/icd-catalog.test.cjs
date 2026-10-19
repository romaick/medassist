'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const createLookup = require('../icd/lookup.cjs');
const catalog = require('../icd/catalog.json');
const source = require('../icd/source.json');

test('Belarus 1.98 catalog preserves the checked source inventory and excludes class/range headings', () => {
  assert.equal(source.sourceFileSha256, 'd83976647f2bab47efcd22986d756ca0c8f4d78fc31ecaeb594bb13ca8dbd538');
  assert.equal(source.sourceVersion, '1.98 (2025-10-15 16:03:30)');
  assert.equal(source.sourceRowsExcludingHeader, 15619);
  assert.equal(source.excludedClassAndRangeCodes.length, 296);
  assert.equal(catalog.entries.length, 15323);
  assert.equal(new Set(catalog.entries.map(entry => entry.code)).size, 15323);
  assert.equal(catalog.entries.filter(entry => entry.kind === 'category').length, 2070);
  assert.equal(catalog.entries.filter(entry => entry.kind === 'subcategory').length, 13253);
  assert.equal(catalog.entries.filter(entry => /[A-Z]$/.test(entry.code)).length, 119);
  assert.equal(catalog.entries.filter(entry => /[*†‡+]/.test(entry.title)).length, 156);
  assert.ok(catalog.entries.every(entry => !source.excludedClassAndRangeCodes.includes(entry.code)));
  assert.equal(createLookup(catalog).size, 15323);
});

test('verified source examples keep full names, Belarus letter suffixes and cross-references', () => {
  const expected = new Map([
    ['J20', 'Острый бронхит'],
    ['J20.9', 'Острый бронхит неуточненный'],
    ['H10.3', 'Острый конъюнктивит неуточненный'],
    ['N10', 'Острый тубулоинтерстициальный нефрит'],
    ['I20A', 'Стенокардия [грудная жаба] на фоне АГ'],
    ['I20.0A', 'Нестабильная стенокардия на фоне АГ'],
    ['K04.3X', 'Вторичный или иррегулярный дентин'],
    ['A06.4', 'Амебный абсцесс печени (K77.0*)']
  ]);
  const lookup = createLookup(catalog);
  for (const [code, title] of expected) {
    const match = lookup.search(code.toLowerCase()).items[0];
    assert.equal(match.code, code);
    assert.equal(match.title, title);
  }
});

test('real catalog searches words and codes without inferring an undocumented synonym', () => {
  const lookup = createLookup(catalog);
  assert.equal(lookup.search('острый бронхит').items[0].code, 'J20');
  assert.equal(lookup.search('бронхит острый').items[0].code, 'J20');
  assert.ok(lookup.search('острый').total > 20);
  assert.equal(lookup.search('острый').items.length, 20);
  assert.equal(lookup.search('i20.0a').total, 1);
  assert.equal(lookup.search('i20a').total, 1);
  assert.ok(lookup.search('пиелонефрит').items.every(entry => entry.code !== 'N10'));
  assert.ok(catalog.entries.every(entry => entry.aliases === undefined));
});

test('bundled compressed catalog decodes to the verified source offline with no runtime imports', async () => {
  const modulePath = path.resolve(process.env.MEDASSIST_APP_ROOT || path.join(__dirname, '../app'), 'modules.js');
  let decoded;
  class CapturingResponse extends Response {
    async json() { decoded = await super.json(); return decoded; }
  }
  const context = {window: {}, Uint8Array, atob, Blob, Response: CapturingResponse, DecompressionStream};
  vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), context);
  const runtime = await context.window.MedAssistICDReady;
  assert.equal(runtime.size, catalog.entries.length);
  assert.equal(runtime.metadata.release, catalog.metadata.release);
  assert.equal(runtime.metadata.sourceUrl, catalog.metadata.sourceUrl);
  assert.deepEqual(decoded, catalog);
  for (const entry of catalog.entries.filter(entry => ['J20', 'J20.9', 'I20A', 'I20.0A', 'K04.3X', 'A06.4'].includes(entry.code))) {
    const match = runtime.search(entry.code, 1).items[0];
    assert.equal(match?.code, entry.code);
    assert.equal(match?.title, entry.title);
  }
});
