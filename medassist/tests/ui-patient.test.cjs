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
  assert.match(await row('soon').innerText(), /Последний приём: 10\.04\.2032/);
  assert.match(await row('soon').locator('.patient-return').innerText(), /18\.04\.2032/);
  assert.match(await row('soon').locator('.patient-overdue').innerText(), /12\.04\.2032.*исход не отмечен/);
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

test("two windows: a conflict cancels repeat creation and exposes the warning, then explicit reload permits a confirmed repeat", { timeout: 20000 }, async t => {
  const { context, page } = await openApp(t);
  await click(page, "new");
  const initial = await saved(page);
  const source = initial.encounters[0];
  await tab(page, "history");
  await page.locator('[data-field="history.medications"]').fill("ДЕМО: исходная запись о препарате");
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

  await click(page, "home"); await openVisit(page, first.id);
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
  await page.reload(); await openVisit(page, repeated.id); assert.equal(await fullName().inputValue(), finalName);
  await click(page, "home"); await openVisit(page, first.id); assert.equal(await fullName().inputValue(), finalName);
  await tab(page, "draft"); assert.equal(await page.locator("#draft-text").inputValue(), original.draft.text);
  await click(page, "home"); await openVisit(page, second.id); assert.equal(await fullName().inputValue(), "Тестов Борис Демонстрационный");
  await fullName().fill("Ф".repeat(120));
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "long patient name fits the encounter at width " + width);
  }
});
