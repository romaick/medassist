"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.MEDASSIST_PLAYWRIGHT || "playwright");

const appRoot = path.resolve(process.env.MEDASSIST_APP_ROOT || path.join(__dirname, "../app"));
const url = pathToFileURL(path.join(appRoot, "index.html")).href;
const key = "medassist.demo.v4";
const click = (page, action) => page.locator('[data-action="' + action + '"]').first().click();
const tab = (page, name) => page.locator('[data-action="tab"][data-tab="' + name + '"]').first().click();
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const openVisit = (page, id) => page.locator('[data-action="open"][data-id="' + id + '"]').click();

async function openApp(t) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MEDASSIST_BROWSER ? { executablePath: process.env.MEDASSIST_BROWSER } : { channel: "msedge" }),
    args: ["--no-first-run", "--disable-background-networking"]
  });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Europe/Minsk" });
  await context.setOffline(true);
  context.setDefaultTimeout(5000);
  const errors = [], requests = [];
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  });
  t.after(() => { assert.deepEqual(errors, [], "no page errors"); assert.deepEqual(requests, [], "offline application makes no HTTP requests"); });
  const page = await context.newPage();
  await page.goto(url);
  return { context, page };
}

test("patient list keeps the last visit, prioritizes the nearest pending return date and refreshes after completion or midnight", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  const core = require(path.join(appRoot, 'core.js'));
  const now = '2032-04-15T07:00:00.000Z';
  await page.clock.setFixedTime(new Date(now));
  const labels = {today: 'Тестов Сегодня', soon: 'Тестова Ближайшая', later: 'Тестов Поздний', past: 'Тестова Прошедшая', none: 'Тестов Без назначения', completed: 'Тестова Завершённая', empty: 'Тестов Без приёмов'};
  const patients = Object.entries(labels).map(([id, label]) => core.createPatient({id: 'patient-' + id, label, now}));
  function entry(id, patient, date, visitDate = '2032-04-01', completed = false) {
    const record = core.createEncounter({id: 'visit-' + id, patientId: 'patient-' + patient, now});
    record.visitDate = visitDate; record.assessment.returnVisitDate = date;
    return completed ? core.setReturnVisitStatus(record, 'completed') : record;
  }
  const encounters = [entry('today', 'today', '2032-04-15'), entry('later', 'later', '2032-04-25'), entry('soon', 'soon', '2032-04-18'), entry('soon-later', 'soon', '2032-04-25', '2032-04-10'), entry('soon-past', 'soon', '2032-04-12', '2032-04-02'), entry('soon-completed', 'soon', '2032-04-16', '2032-04-03', true), entry('past', 'past', '2032-04-14'), entry('none', 'none', ''), entry('completed', 'completed', '2032-04-16', '2032-04-01', true)];
  const initial = core.serializeBundle(encounters, patients);
  await page.evaluate(({key, raw}) => localStorage.setItem(key, raw), {key, raw: initial});
  await page.reload(); await click(page, 'patients');
  const row = id => page.locator('.patient-row[data-patient-id="patient-' + id + '"]');
  const order = () => page.locator('.patient-row').evaluateAll(rows => rows.map(row => row.dataset.patientId));
  assert.deepEqual((await order()).slice(0, 4), ['patient-today', 'patient-soon', 'patient-later', 'patient-past']);
  assert.equal(await page.locator('.patient-row').count(), 7);
  assert.match(await row('today').locator('.patient-return').innerText(), /15\.04\.2032 · сегодня/);
  assert.match(await row('soon').locator('.patient-last').innerText(), /10\.04\.2032/);
  assert.match(await row('soon').locator('.patient-return').innerText(), /18\.04\.2032/);
  assert.match(await row('soon').locator('.patient-overdue').innerText(), /12\.04\.2032[\s\S]*исход не отмечен/);
  for (const id of ['none', 'completed', 'empty']) assert.equal(await row(id).locator('.patient-return,.patient-overdue').count(), 0);
  assert.match(await row('empty').innerText(), /Приёмов пока нет/);
  await page.locator('#patient-search').fill('Ближайшая');
  assert.deepEqual(await order(), ['patient-soon']);
  await page.locator('#patient-search').fill('');
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({width, height: 1000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), initial, 'rendering, sorting and search do not write records');
  await click(page, 'followups');
  await page.locator('[data-action="followup-filter"][data-filter="upcoming"]').click();
  await page.locator('[data-followup-id="visit-soon"] [data-action="followup-complete"]').click();
  await page.locator('#dialog-accept').click();
  await click(page, 'patients');
  assert.match(await row('soon').locator('.patient-return').innerText(), /25\.04\.2032/);
  assert.deepEqual((await order()).slice(0, 4), ['patient-today', 'patient-later', 'patient-soon', 'patient-past']);
  const afterCompletion = await page.evaluate(key => localStorage.getItem(key), key);
  await page.clock.setFixedTime(new Date('2032-04-15T21:01:00.000Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  assert.deepEqual((await order()).slice(0, 4), ['patient-later', 'patient-soon', 'patient-past', 'patient-today']);
  assert.equal(await row('today').locator('.patient-return').count(), 0);
  assert.match(await row('today').locator('.patient-overdue').innerText(), /15\.04\.2032/);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), afterCompletion, 'clock refresh never marks attendance or saves');
  await row('soon').locator('[data-action="patient"]').click();
  assert.equal(await page.locator('#patient-heading').innerText(), labels.soon);
});

async function patientFilterFixture(page) {
  const core = require(path.join(appRoot, 'core.js'));
  const now = '2032-04-15T07:00:00.000Z';
  await page.clock.setFixedTime(new Date(now));
  const labels = {a: 'Альфа Тестовая', b: 'Бета Тестовая', c: 'Гамма Тестовая', d: 'Дельта Тестовая', u: 'Уточнение Тестовое', ended: 'Завершённый Тестовый', future: 'Будущий Тестовый', no: 'Нет Тестовый', empty: 'Пустая Тестовая'};
  const patients = Object.entries(labels).map(([id, label]) => core.createPatient({id: 'patient-' + id, label, now}));
  const encounters = [];
  function visit(id, patient, {from = '', to = '', number = '', issued = 'yes', date = '', visitDate = '2032-04-14', reviewed = true, completed = false} = {}) {
    let entry = core.createEncounter({id: 'visit-' + id, patientId: 'patient-' + patient, now});
    entry.visitDate = visitDate;
    Object.assign(entry.assessment, {sickLeaveIssued: issued, sickLeaveNumber: number, sickLeaveFrom: from, sickLeaveTo: to, returnVisitDate: date});
    entry.draft.text = 'Вымышленная запись для проверки фильтров.';
    if (reviewed) entry = core.setReviewStatus(entry, 'reviewed', {now});
    if (completed) entry = core.setReturnVisitStatus(entry, 'completed');
    encounters.push(entry);
  }
  visit('a', 'a', {from: '2032-04-15', to: '2032-04-15', number: 'DEMO-001', date: '2032-04-15'});
  visit('b', 'b', {from: '2032-04-13', to: '2032-04-20', number: '<ДЕМО & №2>', date: '2032-04-18', reviewed: false});
  visit('b-duplicate', 'b', {from: '2032-04-13', to: '2032-04-20', number: '<ДЕМО & №2>', date: '2032-04-21'});
  visit('b-old', 'b', {from: '2032-04-01', to: '2032-04-14', number: 'DEMO-OLD', date: '2032-04-25', visitDate: '2032-04-01'});
  visit('b-unknown', 'b', {from: '2032-04-15', number: 'DEMO-PARTIAL'});
  visit('c', 'c', {from: '2032-04-10', to: '2032-04-17', number: 'DEMO-003', date: '2032-04-22', reviewed: false, visitDate: '2032-04-12'});
  visit('d', 'd', {from: '2032-04-10', to: '2032-04-18', number: 'DEMO-004', date: '2032-04-14', visitDate: '2032-04-13'});
  visit('u', 'u', {to: '2032-04-15', number: 'DEMO-UNKNOWN', reviewed: false});
  visit('ended', 'ended', {from: '2032-04-01', to: '2032-04-14', number: 'DEMO-ENDED', date: '2032-04-15', completed: true, visitDate: '2032-04-10'});
  visit('future', 'future', {from: '2032-04-16', to: '2032-04-25', number: 'DEMO-FUTURE', date: '2032-04-16'});
  visit('no', 'no', {issued: 'no', number: 'HIDDEN-NUMBER', reviewed: false});
  const initial = core.serializeBundle(encounters, patients);
  await page.evaluate(({key, raw}) => localStorage.setItem(key, raw), {key, raw: initial});
  await page.reload(); await click(page, 'patients');
  return initial;
}
const patientCategory = (page, category) => page.locator('[data-action="patient-category"][data-category="' + category + '"]');
const patientIds = page => page.locator('.patient-row').evaluateAll(rows => rows.map(row => row.dataset.patientId.replace('patient-', '')));
const patientFilter = (page, key) => page.locator('#patient-filter-' + key);

test("patient categories count unique patients; sick leave filters use inclusive dates, incomplete periods and refresh at midnight without saving", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const initial = await patientFilterFixture(page);
  await click(page, 'patient-toggle-filters');
  for (const [category, count] of [['all', 9], ['sick', 5], ['return', 5], ['draft', 4]]) {
    assert.match(await patientCategory(page, category).innerText(), new RegExp('· ' + count + '$'));
  }
  await patientCategory(page, 'sick').click();
  assert.deepEqual(await patientIds(page), ['a', 'c', 'd', 'b', 'u']);
  assert.equal(await patientFilter(page, 'sort').inputValue(), 'sick');
  const rowB = page.locator('.patient-row[data-patient-id="patient-b"]');
  assert.equal(await rowB.locator('.patient-sick').count(), 2, 'identical sick-leave rows are displayed once');
  assert.match(await rowB.innerText(), /ЛН №<ДЕМО & №2>/);
  assert.match(await rowB.innerText(), /период требует уточнения/);
  await patientFilter(page, 'sick').selectOption('current');
  assert.deepEqual(await patientIds(page), ['a', 'c', 'd', 'b']);
  await patientFilter(page, 'sick').selectOption('today');
  assert.deepEqual(await patientIds(page), ['a'], 'partial period with an end today is not inferred active');
  await patientFilter(page, 'sick').selectOption('soon');
  assert.deepEqual(await patientIds(page), ['a', 'c'], 'today plus two calendar days; expired and day four excluded');
  await patientFilter(page, 'sick').selectOption('unknown');
  assert.deepEqual((await patientIds(page)).sort(), ['b', 'u']);
  await page.locator('#patient-search').fill('demo-partial');
  assert.deepEqual(await patientIds(page), ['b']);
  assert.match(await page.locator('#patient-filter-summary').innerText(), /Поиск: demo-partial/);
  assert.match(await patientCategory(page, 'sick').innerText(), /· 5$/, 'counts remain unfiltered');
  await click(page, 'patient-reset-filters');
  assert.deepEqual(await patientIds(page), ['a', 'c', 'd', 'b', 'u']);
  assert.equal(await patientCategory(page, 'sick').getAttribute('aria-pressed'), 'true');
  await patientFilter(page, 'sick').selectOption('current');
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({width, height: 1000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'filters fit viewport ' + width);
  }
  await page.clock.setFixedTime(new Date('2032-04-15T21:01:00.000Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  assert.deepEqual(await patientIds(page), ['c', 'd', 'b', 'future'], 'ended period leaves, newly started period enters');
  assert.match(await patientCategory(page, 'sick').innerText(), /· 5$/);
  assert.equal(await patientFilter(page, 'sick').inputValue(), 'current');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), initial, 'rubrics, filters and midnight are read only');
});

test("patient filters combine search, return dates, latest visit and review status; reset and sorting preserve records", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const initial = await patientFilterFixture(page);
  await click(page, 'patient-toggle-filters');
  await patientCategory(page, 'draft').click();
  assert.deepEqual((await patientIds(page)).sort(), ['b', 'c', 'no', 'u']);
  await patientCategory(page, 'return').click();
  assert.equal((await patientIds(page)).length, 5);
  await patientCategory(page, 'all').click();
  await patientFilter(page, 'return').selectOption('today');
  assert.deepEqual(await patientIds(page), ['a']);
  await patientFilter(page, 'return').selectOption('week');
  assert.deepEqual(await patientIds(page), ['a', 'future', 'b']);
  await patientFilter(page, 'review').selectOption('draft');
  assert.deepEqual(await patientIds(page), ['b']);
  await patientCategory(page, 'sick').click();
  assert.deepEqual(await patientIds(page), ['b'], 'shared filters persist across categories');
  assert.match(await page.locator('#patient-filter-summary').innerText(), /Есть черновики/);
  await patientFilter(page, 'sick').selectOption('soon');
  assert.deepEqual(await patientIds(page), [], 'all conditions must hold for a patient');
  assert.match(await page.locator('#patient-list').innerText(), /не найдены/);
  await click(page, 'patient-reset-filters'); await patientCategory(page, 'all').click();
  await patientFilter(page, 'return').selectOption('range');
  await patientFilter(page, 'returnFrom').fill('2032-04-21');
  await patientFilter(page, 'returnTo').fill('2032-04-21');
  assert.deepEqual(await patientIds(page), ['b'], 'matches a later appointment, not just nearest');
  assert.match(await page.locator('.patient-row').innerText(), /Другие явки по фильтру: 21\.04\.2032/);
  await patientFilter(page, 'returnFrom').fill('2032-04-19');
  await patientFilter(page, 'returnTo').fill('2032-04-20');
  assert.deepEqual(await patientIds(page), [], 'both bounds must match the same appointment');
  await patientFilter(page, 'returnFrom').fill('2032-04-22');
  assert.match(await page.locator('#patient-filter-error').innerText(), /Повторная явка/);
  assert.equal(await patientFilter(page, 'returnFrom').getAttribute('aria-invalid'), 'true');
  await patientFilter(page, 'return').selectOption('past');
  assert.deepEqual(await patientIds(page), ['d']);
  assert.equal(await page.locator('#patient-filter-error').innerText(), '');
  await patientFilter(page, 'return').selectOption('none');
  assert.deepEqual((await patientIds(page)).sort(), ['empty', 'ended', 'no', 'u']);
  await click(page, 'patient-reset-filters');
  await patientFilter(page, 'review').selectOption('reviewed');
  assert.deepEqual((await patientIds(page)).sort(), ['a', 'd', 'ended', 'future'], 'no visits and mixed review status excluded');
  await patientFilter(page, 'lastFrom').fill('2032-04-10');
  await patientFilter(page, 'lastTo').fill('2032-04-13');
  assert.deepEqual((await patientIds(page)).sort(), ['d', 'ended']);
  await patientFilter(page, 'lastFrom').fill('2032-04-14');
  assert.match(await page.locator('#patient-filter-error').innerText(), /Последний приём/);
  await click(page, 'patient-reset-filters');
  await patientFilter(page, 'lastFrom').fill('2032-04-01');
  await patientFilter(page, 'lastTo').fill('2032-04-01');
  assert.deepEqual(await patientIds(page), [], 'an older visit does not satisfy the latest-visit filter');
  await click(page, 'patient-reset-filters');
  await patientFilter(page, 'sort').selectOption('name');
  assert.deepEqual(await patientIds(page), ['a', 'b', 'future', 'c', 'd', 'ended', 'no', 'empty', 'u']);
  await patientFilter(page, 'sort').selectOption('last');
  assert.deepEqual((await patientIds(page)).slice(-4), ['d', 'c', 'ended', 'empty']);
  await page.locator('#patient-search').fill('DEMO-ENDED');
  assert.deepEqual(await patientIds(page), ['ended'], 'search finds historical sick leave');
  assert.match(await page.locator('.patient-sick').innerText(), /указанный период прошёл/);
  await page.locator('#patient-search').fill('HIDDEN-NUMBER');
  assert.deepEqual(await patientIds(page), [], 'not-issued leave number is ignored');
  await page.locator('#patient-search').fill('patient-b');
  assert.deepEqual(await patientIds(page), ['b']);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), initial);
  await page.locator('.patient-row [data-action="patient"]').click();
  assert.equal(await page.locator('#patient-heading').innerText(), 'Бета Тестовая');
});

test("patient search finds historical encounters and dates; collapsed filters retain visible conditions without saving", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const raw = JSON.parse(await patientFilterFixture(page));
  const old = raw.encounters.find(entry => entry.id === 'visit-b-old');
  old.history.complaints = 'Вымышленный кашель'; old.assessment.summary = 'Учебный бронхит';
  old.history.medications = 'Демонстрационный препарат'; old.assessment.plan = 'Учебная рекомендация';
  old.examSelections.heartSounds = 'muffled'; old.draft.text = 'Ручная <вымышленная> заметка';
  raw.encounters.find(entry => entry.id === 'visit-b').history.complaints = 'Учебная головная боль';
  const initial = JSON.stringify(raw);
  await page.evaluate(({key, raw}) => localStorage.setItem(key, raw), {key, raw: initial});
  await page.reload(); await click(page, 'patients');
  const search = page.locator('#patient-search');
  assert.equal(await page.locator('#patient-search-scope').count(), 0);
  const panel = page.locator('#patient-filter-panel'), toggle = page.locator('[data-action="patient-toggle-filters"]');
  assert.equal(await panel.isVisible(), false);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await toggle.getAttribute('aria-controls'), 'patient-filter-panel');
  assert.equal(await patientFilter(page, 'sort').isVisible(), false);
  assert.equal(await page.locator('#patient-filter-summary').innerText(), '');
  for (const [query, expected] of [
    ['Бета 01.04.2032', ['b']],
    ['БЕТА   кашель', ['b']],
    ['Бета кашель 14.04.2032', ['b']],
    ['01.04.2032', ['b']],
    ['2032-04-01', ['b']],
    ['1/4/2032', ['b']],
    ['1 апреля 2032', ['b']],
    ['1 апреля(04) 2032', ['b']],
    ['01.04', ['b']],
    ['15.04.2032', ['a', 'ended']],
    ['25 апреля 2032', ['b']],
    ['visit-b-old', ['b']],
    ['patient-b', ['b']],
    ['Бета', ['b']],
    ['DEMO-OLD', ['b']],
    ['HIDDEN-NUMBER', []],
    ['учебный бронхит', ['b']],
    ['демонстрационный препарат', ['b']],
    ['учебная рекомендация', ['b']],
    ['приглушенные', ['b']],
    ['ручная <вымышленная>', ['b']]
  ]) {
    await search.fill(query);
    assert.deepEqual((await patientIds(page)).sort(), expected, query);
    if (query === 'Бета кашель 14.04.2032') assert.match(await page.locator('.patient-search-reason').innerText(), /Совпало слов: 2 из 3/);
  }
  assert.match(await page.locator('#patient-filter-summary').innerText(), /ручная <вымышленная>/);
  assert.equal(await page.locator('.patient-search-matches [data-action="open"]').count(), 1);
  await page.locator('.patient-search-matches [data-id="visit-b-old"]').click();
  assert.equal(await page.locator('[data-field="visitDate"]').inputValue(), '2032-04-01');
  await click(page, 'patients');
  assert.equal(await search.inputValue(), 'ручная <вымышленная>');
  assert.equal(await panel.isVisible(), false);
  await click(page, 'patient-reset-filters');
  assert.equal(await search.inputValue(), '');
  await toggle.focus(); await page.keyboard.press('Enter');
  assert.equal(await panel.isVisible(), true);
  await patientFilter(page, 'return').selectOption('today');
  await patientFilter(page, 'review').selectOption('reviewed');
  await patientFilter(page, 'sort').selectOption('name');
  await toggle.click();
  assert.equal(await panel.isVisible(), false);
  assert.deepEqual(await patientIds(page), ['a']);
  assert.match(await page.locator('#patient-filter-summary').innerText(), /Явка: Сегодня/);
  assert.match(await page.locator('#patient-filter-summary').innerText(), /Все записи проверены врачом/);
  assert.match(await page.locator('#patient-filter-summary').innerText(), /По ФИО/);
  await patientCategory(page, 'sick').click();
  assert.equal(await panel.isVisible(), false, 'rubric change does not expose filters');
  assert.deepEqual(await patientIds(page), ['a']);
  await toggle.click();
  assert.equal(await patientFilter(page, 'return').inputValue(), 'today');
  await patientFilter(page, 'lastFrom').fill('2032-04-20');
  await patientFilter(page, 'lastTo').fill('2032-04-10');
  await toggle.click();
  assert.equal(await page.locator('#patient-filter-error').isVisible(), true);
  assert.match(await page.locator('#patient-filter-error').innerText(), /Последний приём/);
  await click(page, 'patient-reset-filters');
  assert.equal(await panel.isVisible(), false);
  assert.deepEqual(await patientIds(page), ['a', 'c', 'd', 'b', 'u']);
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({width, height: 1000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await toggle.click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await toggle.click();
  }
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), initial, 'search, navigation and collapsing do not write records');
  await page.reload(); await click(page, 'patients');
  assert.equal(await panel.isVisible(), false, 'fresh launch always starts collapsed');
});

test("one search line ranks exact words, fragments and typos; numbers stay literal and history is not merged", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const core = require(path.join(appRoot, 'core.js'));
  const now = '2032-04-15T07:00:00.000Z';
  await page.clock.setFixedTime(new Date(now));
  const patients = [], encounters = [];
  for (const [id, label, complaints] of [
    ['exact', 'Иванов Тестовый', 'Учебный кашель'],
    ['prefix', 'Иванова Тестовая', 'Учебный кашель'],
    ['typo', 'Ивонов Тестовый', 'Учебный кашель'],
    ['mention', 'Сидоров Тестовый', 'Учебная отметка: Иванов кашель'],
    ['split', 'Раздельный Тестовый', 'Учебный кашель'],
    ['other', 'Другой Тестовый', 'Учебная усталость']
  ]) {
    const patient = core.createPatient({id: 'patient-' + id, label, now}); patients.push(patient);
    const entry = core.createEncounter({id: 'visit-' + id, patientId: patient.id, now});
    entry.visitDate = id === 'exact' ? '2032-04-01' : '2032-04-10';
    entry.history.complaints = complaints;
    entry.assessment.returnVisitDate = id === 'exact' ? '2032-04-25' : '2032-04-15';
    entry.assessment.sickLeaveIssued = 'yes';
    entry.assessment.sickLeaveNumber = id === 'exact' ? '123456' : id === 'prefix' ? '123457' : '';
    encounters.push(entry);
  }
  const second = core.createEncounter({id: 'visit-split-second', patientId: 'patient-split', now});
  second.history.complaints = 'Учебная сыпь'; second.visitDate = '2032-04-12'; encounters.push(second);
  const old = core.createEncounter({id: 'visit-exact-old', patientId: 'patient-exact', now});
  old.history.complaints = 'Учебный кашелёк'; old.visitDate = '2032-03-01'; encounters.push(old);
  const initial = core.serializeBundle(encounters, patients);
  await page.evaluate(({key, raw}) => localStorage.setItem(key, raw), {key, raw: initial});
  await page.reload(); await click(page, 'patients');
  const search = page.locator('#patient-search');
  const reason = id => page.locator('.patient-row[data-patient-id="patient-' + id + '"] .patient-search-reason');
  const defaultOrder = await patientIds(page);
  assert.equal(defaultOrder.at(-1), 'exact');
  assert.equal(await page.locator('#patient-search-scope').count(), 0);
  await search.fill('Иванов');
  assert.deepEqual(await patientIds(page), ['exact', 'mention', 'prefix', 'typo']);
  assert.match(await reason('exact').innerText(), /Совпадение: ФИО/);
  assert.match(await reason('mention').innerText(), /Жалобы/);
  assert.match(await reason('typo').innerText(), /похожее написание/);
  assert.match(await page.locator('#patient-filter-summary').innerText(), /наиболее близкие/);
  await search.fill('Иванов кашель');
  assert.deepEqual(await patientIds(page), ['exact', 'mention', 'prefix', 'typo']);
  assert.equal(await page.locator('.patient-row[data-patient-id="patient-exact"] .patient-search-matches [data-action="open"]').first().getAttribute('data-id'), 'visit-exact');
  await search.fill('Иванов Иванов кашель');
  assert.deepEqual(await patientIds(page), ['exact', 'mention', 'prefix', 'typo'], 'repeated words do not change scores');
  await search.fill('Раздельный кашель сыпь');
  assert.deepEqual(await patientIds(page), ['split']);
  assert.match(await reason('split').innerText(), /Совпало слов: 2 из 3/, 'separate encounters cannot become a full match');
  await search.fill('Иванво');
  assert.equal((await patientIds(page))[0], 'exact', 'one transposition is accepted');
  for (const [query, expected] of [['Иваанов', 'exact'], ['Ивонов', 'typo']]) {
    await search.fill(query); assert.equal((await patientIds(page))[0], expected, query);
  }
  await search.fill('Ивнов');
  assert.ok((await patientIds(page)).includes('exact'));
  assert.ok((await patientIds(page)).includes('typo'), 'one missing letter can match two different names');
  assert.match(await reason('exact').innerText(), /похожее написание/);
  assert.match(await reason('typo').innerText(), /похожее написание/);
  await search.fill('123456'); assert.deepEqual(await patientIds(page), ['exact']);
  await search.fill('123458'); assert.deepEqual(await patientIds(page), []);
  await search.fill('Иванов кашель 123458'); assert.deepEqual(await patientIds(page), [], 'numeric terms may not be dropped');
  await search.fill('2032-04-02'); assert.deepEqual(await patientIds(page), []);
  await search.fill('кашель 2032-04-01'); assert.deepEqual(await patientIds(page), ['exact']);
  await search.fill('!!!'); assert.deepEqual(await patientIds(page), []);
  await search.fill(''); assert.deepEqual(await patientIds(page), defaultOrder, 'clearing query restores scheduled order');
  await click(page, 'patient-toggle-filters'); await patientFilter(page, 'sort').selectOption('name');
  const byName = await patientIds(page);
  await search.fill('Иванов'); assert.deepEqual(await patientIds(page), ['exact', 'mention', 'prefix', 'typo']);
  await patientFilter(page, 'return').selectOption('today');
  assert.deepEqual(await patientIds(page), ['mention', 'prefix', 'typo'], 'filters still constrain ranked results');
  await patientFilter(page, 'return').selectOption('all');
  await search.fill(''); assert.deepEqual(await patientIds(page), byName);
  await search.fill('Иванов кашель'); await click(page, 'patient-toggle-filters');
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({width, height: 1000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.locator('.patient-row[data-patient-id="patient-exact"] .patient-search-matches [data-id="visit-exact"]').click();
  assert.equal(await page.locator('[data-field="visitDate"]').inputValue(), '2032-04-01');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), initial);
});

test("two windows: a conflict cancels repeat creation and exposes the warning, then explicit reload permits a confirmed repeat", { timeout: 20000 }, async t => {
  const { context, page } = await openApp(t);
  await click(page, "new");
  await tab(page, "history");
  await page.locator('[data-field="history.medications"]').fill("ДЕМО: исходная запись о препарате");
  const source = (await saved(page)).encounters[0];
  await click(page, "patient"); await click(page, "repeat");
  await page.locator('#repeat-fields input[value="medications"]').check();

  const second = await context.newPage(); await second.goto(url); await openVisit(second, source.id);
  await tab(second, "history");
  const updated = "ДЕМО: уточнение препарата во втором окне";
  await second.locator('[data-field="history.medications"]').fill(updated);
  await page.waitForFunction(() => document.getElementById("storage-banner").textContent.includes("другом окне"));
  const before = await page.evaluate(key => localStorage.getItem(key), key);
  await page.locator("#repeat-create").click();

  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), before, "conflicting creation must not write storage");
  assert.equal((await saved(page)).encounters.length, 1, "no extra encounter");
  assert.equal(await page.locator("#repeat-dialog").isVisible(), false, "warning must not remain behind the modal");
  assert.equal(await page.locator("#toast").isVisible(), true);
  assert.match(await page.locator("#toast").innerText(), /Данные изменены в другом окне/);
  const hit = await page.locator("#toast").evaluate(node => {
    const box = node.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.id;
  });
  assert.equal(hit, "toast", "warning is actually above other elements");

  await click(page, "reload"); await page.locator("#dialog-accept").click();
  await openVisit(page, source.id); await click(page, "patient"); await click(page, "repeat");
  assert.equal(await page.locator("#repeat-fields input:checked").count(), 0);
  assert.match(await page.locator("#repeat-fields").innerText(), /уточнение препарата во втором окне/);
  await page.locator('#repeat-fields input[value="medications"]').check(); await page.locator("#repeat-create").click();
  const after = await saved(page);
  assert.equal(after.encounters.length, 2);
  assert.equal(after.patients.length, 1);
  assert.equal(after.encounters[1].patientId, source.patientId);
  assert.equal(after.encounters[1].history.medications, updated);
  assert.deepEqual(after.encounters[0], JSON.parse(before).encounters[0]);
});

test("patient full name is shared by card and visits without renaming a different patient or overwriting drafts", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await click(page, "new");
  const fullName = () => page.getByLabel("ФИО пациента", { exact: true });
  assert.equal(await fullName().count(), 1, "the first encounter step offers a clearly named field");
  await fullName().fill("Тестова Анна Демонстрационная");
  const first = (await saved(page)).encounters[0];
  await tab(page, "draft"); await page.locator("#draft-text").fill("ДЕМО: ручной текст, сохранить дословно.");
  const original = (await saved(page)).encounters[0];
  await click(page, "new"); await fullName().fill("Тестов Борис Демонстрационный");
  const second = (await saved(page)).encounters[1];

  await click(page, "home"); await openVisit(page, first.id); await tab(page, "basic");
  assert.equal(await fullName().inputValue(), "Тестова Анна Демонстрационная");
  const renamed = "Тестова Анна <Демонстрационная>";
  await fullName().fill(renamed);
  const data = await saved(page);
  assert.equal(data.patients.find(patient => patient.id === first.patientId).label, renamed);
  assert.equal(data.patients.find(patient => patient.id === second.patientId).label, "Тестов Борис Демонстрационный");
  assert.equal(await page.locator(".visit-heading h1").innerText(), renamed);
  assert.deepEqual(data.encounters[0], original, "editing the patient name does not rewrite the encounter or draft");

  await click(page, "patient"); assert.equal(await fullName().inputValue(), renamed);
  const finalName = "Тестова Анна Учебная";
  await fullName().fill(finalName); assert.equal(await page.locator("#patient-heading").innerText(), finalName);
  await click(page, "repeat"); await page.locator("#repeat-create").click();
  assert.equal(await fullName().inputValue(), finalName, "repeated encounter shares patient identity");
  const repeated = (await saved(page)).encounters.at(-1);
  await page.reload(); await openVisit(page, repeated.id); await tab(page, "basic"); assert.equal(await fullName().inputValue(), finalName);
  await click(page, "home"); await openVisit(page, first.id); await tab(page, "basic"); assert.equal(await fullName().inputValue(), finalName);
  await tab(page, "draft"); assert.equal(await page.locator("#draft-text").inputValue(), original.draft.text);
  await click(page, "home"); await openVisit(page, second.id); await tab(page, "basic"); assert.equal(await fullName().inputValue(), "Тестов Борис Демонстрационный");
  await fullName().fill("Ф".repeat(120));
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "long patient name fits the encounter at width " + width);
  }
});

test("compact patient list shows four complete desktop rows and keeps secondary search matches collapsed", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  const core = require(path.join(appRoot, 'core.js'));
  const now = '2032-04-15T07:00:00.000Z';
  await page.clock.setFixedTime(new Date(now));
  const patients = [], encounters = [];
  for (let i = 0; i < 24; i++) {
    const patient = core.createPatient({ id: 'demo-compact-' + i, label: 'Тестова Пациентка ' + String(i + 1).padStart(2, '0'), now });
    const entry = core.createEncounter({ id: 'demo-compact-visit-' + i, patientId: patient.id, now });
    entry.history.complaints = 'ДЕМО: учебный кашель';
    entry.assessment.returnVisitDate = '2032-04-' + String(15 + i % 15).padStart(2, '0');
    patients.push(patient); encounters.push(entry);
  }
  for (let i = 0; i < 2; i++) {
    const entry = core.createEncounter({ id: 'demo-compact-old-' + i, patientId: patients[0].id, now });
    entry.visitDate = '2032-03-0' + (i + 1);
    entry.history.complaints = 'ДЕМО: учебный кашель'; encounters.push(entry);
  }
  const initial = core.serializeBundle(encounters, patients);
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key, raw: initial });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.reload(); await click(page, 'patients');
  const completeRows = await page.locator('.patient-row').evaluateAll(rows => rows.filter(row => {
    const box = row.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight;
  }).length);
  assert.ok(completeRows >= 4, 'at least four whole patient rows fit at 1366×768; observed ' + completeRows);
  assert.equal(await page.locator('#patient-filter-panel').isVisible(), false);
  await page.locator('#patient-search').fill('Тестова кашель');
  const first = page.locator('.patient-row[data-patient-id="demo-compact-0"]');
  assert.equal(await first.locator('.patient-search-matches [data-action="open"]').count(), 3);
  assert.equal(await first.locator('.patient-search-matches [data-action="open"]').first().isVisible(), true);
  const details = first.locator('.patient-search-matches details');
  assert.equal(await details.count(), 1);
  assert.equal(await details.getAttribute('open'), null, 'secondary encounter matches are collapsed initially');
  assert.equal(await details.locator('[data-action="open"]').first().isVisible(), false);
  await details.locator('summary').focus(); await page.keyboard.press('Enter');
  assert.equal(await details.locator('[data-action="open"]').first().isVisible(), true);
  const historical = details.locator('[data-action="open"]').first();
  const historicalId = await historical.getAttribute('data-id');
  await historical.click();
  assert.equal(await page.locator('[data-field="visitDate"]').inputValue(), encounters.find(entry => entry.id === historicalId).visitDate);
  await click(page, 'patients');
  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'compact results fit width ' + width);
  }
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), initial, 'compact rendering and disclosure preserve data exactly');
});
