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
