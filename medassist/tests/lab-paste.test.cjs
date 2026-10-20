'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modulePath = path.resolve(process.env.MEDASSIST_APP_ROOT || path.join(__dirname, '../app'), 'modules.js');
const context = {window: {}, Uint8Array, atob, Blob, Response, DecompressionStream};
vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), context);
test.before(async () => { await context.window.MedAssistICDReady; });
const parser = context.window.MedAssistLabPaste;
const parse = value => JSON.parse(JSON.stringify(parser.parse(value)));
const expectedRow = (sourceLine, values) => ({sourceLine, name: '', result: '', unit: '', reference: '', note: '', warnings: [], ...values});

test('pasted fictional tabular results preserve explicit cells, decimal commas and zero', () => {
  const source = 'Показатель\tРезультат\tЕдиницы\tНорма\nДЕМО Альфа\t0\tдемо/л\t0–1\nДЕМО Бета\t5,1\t\t';
  const value = parse(source);
  assert.deepEqual(value.rows, [
    expectedRow('ДЕМО Альфа\t0\tдемо/л\t0–1', {name: 'ДЕМО Альфа', result: '0', unit: 'демо/л', reference: '0–1'}),
    expectedRow('ДЕМО Бета\t5,1\t\t', {name: 'ДЕМО Бета', result: '5,1'})
  ]);
  assert.equal(value.notices.length, 1);
  assert.match(value.notices[0], /Заголовок столбцов/);
});

test('known Russian headers can reorder fields without assuming the printed order', () => {
  const row = parse('Результат;Ед. изм.;Наименование;Примечание;Референсные значения\n< 0,1;демо/л;ДЕМО показатель;вымышленный бланк;0–2').rows[0];
  assert.equal(row.name, 'ДЕМО показатель');
  assert.equal(row.result, '< 0,1');
  assert.equal(row.unit, 'демо/л');
  assert.equal(row.note, 'вымышленный бланк');
  assert.equal(row.reference, '0–2');
  assert.deepEqual(row.warnings, []);
});

test('pipe and repeated-space columns support explicit non-numeric results', () => {
  for (const delimiter of ['|', ';', '  ']) {
    const source = ['ДЕМО тест', 'не обнаружено', 'условная/ед', 'из бланка', 'демо'].join(delimiter);
    assert.deepEqual(parse(source).rows[0], expectedRow(source, {name: 'ДЕМО тест', result: 'не обнаружено', unit: 'условная/ед', reference: 'из бланка', note: 'демо'}));
  }
});

test('simple numeric lines preserve comparator, decimal separator and scientific units', () => {
  const examples = [
    ['ДЕМО гемоглобин: 130 г/л', 'ДЕМО гемоглобин', '130', 'г/л'],
    ['ДЕМО лейкоциты 4,2 10^9/л', 'ДЕМО лейкоциты', '4,2', '10^9/л'],
    ['ДЕМО показатель < 0,1 мг/л', 'ДЕМО показатель', '< 0,1', 'мг/л'],
    ['ДЕМО показатель ≥5 ммоль/л', 'ДЕМО показатель', '≥5', 'ммоль/л'],
    ['ДЕМО HbA1c 5,8 %', 'ДЕМО HbA1c', '5,8', '%'],
    ['ДЕМО показатель 0', 'ДЕМО показатель', '0', ''],
    ['ДЕМО показатель 1.2e-3 ед/л', 'ДЕМО показатель', '1.2e-3', 'ед/л'],
    ['ДЕМО лейкоциты 4,2 10⁹/л', 'ДЕМО лейкоциты', '4,2', '10⁹/л']
  ];
  for (const [sourceLine, name, result, unit] of examples) assert.deepEqual(parse(sourceLine).rows[0], expectedRow(sourceLine, {name, result, unit}));
});

test('reference text is copied only after an explicit marker in a simple line', () => {
  for (const marker of ['норма:', 'референс:', 'референсные значения:', '; норма:', 'референтный интервал:']) {
    const row = parse(`ДЕМО глюкоза 5,1 ммоль/л ${marker} 3,3–5,5`).rows[0];
    assert.equal(row.result, '5,1');
    assert.equal(row.unit, 'ммоль/л');
    assert.equal(row.reference, '3,3–5,5');
  }
  const ambiguous = parse('ДЕМО глюкоза 5,1 ммоль/л 3,3–5,5').rows[0];
  assert.equal(ambiguous.name, '');
  assert.equal(ambiguous.reference, '');
  assert.equal(ambiguous.warnings.length, 1);
});

test('ambiguous prose, dates and qualitative free text stay visible for manual review', () => {
  for (const sourceLine of ['Неясный текст вымышленного бланка', 'Дата 20.10.2026', 'ДЕМО белок: отрицательно', 'ДЕМО показатель 10 20']) {
    const row = parse(sourceLine).rows[0];
    assert.equal(row.sourceLine, sourceLine);
    assert.equal(row.name, '');
    assert.equal(row.result, '');
    assert.equal(row.unit, '');
    assert.ok(row.warnings.length);
  }
});

test('missing explicit reference value is not invented', () => {
  const row = parse('ДЕМО показатель 0 мг/л норма:').rows[0];
  assert.equal(row.result, '0');
  assert.equal(row.reference, '');
  assert.match(row.warnings[0], /нет значения/);
});

test('words beginning with a reference marker do not manufacture a reference interval', () => {
  const row = parse('Норметанефрин 1 мг/л').rows[0];
  assert.equal(row.name, 'Норметанефрин');
  assert.equal(row.result, '1');
  assert.equal(row.reference, '');
  const unclear = parse('ДЕМО показатель 1 мг/л нормально').rows[0];
  assert.equal(unclear.reference, '');
  assert.ok(unclear.warnings.length);
});

test('extra columns and header mismatches warn while exact original text stays available', () => {
  const sourceLine = 'ДЕМО показатель\t1\tдемо/л\t0–2\tпометка\tдополнительный текст';
  const row = parse(sourceLine).rows[0];
  assert.equal(row.sourceLine, sourceLine);
  assert.equal(row.note, 'пометка');
  assert.match(row.warnings[0], /дополнительные столбцы/);
  const mapped = parse(`Показатель\tРезультат\n${sourceLine}`).rows[0];
  assert.equal(mapped.warnings.length, 2);
});

test('unrecognized or duplicate header columns preserve table rows for manual mapping', () => {
  for (const header of ['Показатель\tНеизвестная графа\tРезультат', 'Показатель\tРезультат\tРезультат']) {
    const result = parse(`${header}\nДЕМО показатель\t1\t2`);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].sourceLine, header);
    assert.ok(result.rows.every(row => !row.result && row.warnings.length));
    assert.deepEqual(result.notices, []);
  }
});

test('a subsequent valid table header restores explicit column mapping', () => {
  const value = parse('Показатель|Неизвестная графа|Результат\nДЕМО первый|1|2\nПоказатель|Результат|Единицы\nДЕМО второй|0|демо/л');
  assert.equal(value.rows.length, 3);
  assert.equal(value.rows[2].name, 'ДЕМО второй');
  assert.equal(value.rows[2].result, '0');
  assert.equal(value.rows[2].unit, 'демо/л');
});

test('source whitespace, duplicate records and CRLF ordering are preserved', () => {
  const original = '  ДЕМО показатель\t0\tдемо/л  ';
  const value = parse(`${original}\r\n\r\n${original}\r\n`);
  assert.equal(value.rows.length, 2);
  assert.equal(value.rows[0].sourceLine, original);
  assert.deepEqual(value.rows[0], value.rows[1]);
  assert.match(value.notices[0], /пустых строк: 1/);
});

test('pasted HTML or script text remains a literal value without evaluation', () => {
  const source = '<img src=x onerror=globalThis.injected=true>\t<script>throw 1</script>\tдемо/л';
  const row = parse(source).rows[0];
  assert.equal(row.name, '<img src=x onerror=globalThis.injected=true>');
  assert.equal(row.result, '<script>throw 1</script>');
  assert.equal(context.injected, undefined);
});

test('blank cells remain blank and missing mandatory cells receive a warning', () => {
  const row = parse('\t0\t\t\t').rows[0];
  assert.equal(row.name, '');
  assert.equal(row.result, '0');
  assert.equal(row.unit, '');
  assert.equal(row.reference, '');
  assert.equal(row.warnings.length, 1);
});

test('a single word after a simple result is flagged for unit review', () => {
  const row = parse('ДЕМО показатель 1 слово').rows[0];
  assert.equal(row.unit, 'слово');
  assert.match(row.warnings[0], /единицу измерения/);
});

test('empty text is accepted without creating a proposed result', () => {
  assert.deepEqual(parse(''), {rows: [], notices: []});
  assert.deepEqual(parse('\n'), {rows: [], notices: ['Пропущено пустых строк: 1.']});
});

test('oversized text, over 100 physical lines and NUL fail without partial output', () => {
  assert.equal(parser.MAX_TEXT_LENGTH, 20000);
  assert.equal(parser.MAX_ROWS, 100);
  assert.throws(() => parse('x'.repeat(20001)), /20000/);
  assert.equal(parse('x'.repeat(20000)).rows.length, 1);
  assert.throws(() => parse('ДЕМО\n'.repeat(101)), /100 строк/);
  assert.throws(() => parse('\n'.repeat(101)), /100 строк/);
  assert.equal(parse('ДЕМО\t0\n'.repeat(100)).rows.length, 100);
  assert.throws(() => parse('ДЕМО\t0\0'), /нулевой символ/);
  assert.throws(() => parse(null), /виде текста/);
});

test('parse results are independent and no optional date or selected state is inferred', () => {
  const first = parse('ДЕМО показатель\t0');
  first.rows[0].name = 'изменено';
  const second = parse('ДЕМО показатель\t0');
  assert.equal(second.rows[0].name, 'ДЕМО показатель');
  assert.deepEqual(Object.keys(second.rows[0]), ['sourceLine', 'name', 'result', 'unit', 'reference', 'note', 'warnings']);
});
