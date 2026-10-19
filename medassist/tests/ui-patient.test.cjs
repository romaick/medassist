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
