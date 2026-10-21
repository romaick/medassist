"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require(process.env.MEDASSIST_PLAYWRIGHT || "playwright");
const {clickAction: click, enterPolyclinic} = require("./ui-actions.cjs");
const appRoot = path.resolve(process.env.MEDASSIST_APP_ROOT || path.join(__dirname, "../app"));
const core = require(path.join(appRoot, "core.js"));
const url = pathToFileURL(path.join(appRoot, "index.html")).href;
const key = "medassist.demo.v4";
const now = "2032-04-19T08:00:00.000Z";
const patientId = "fictional-design-patient", visitId = "fictional-design-visit";
const manual = "ДЕМО: ручной текст, который проверяет врач.";
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const savedVisit = async page => (await saved(page)).encounters.find(entry => entry.id === visitId);
const visitTab = (page, name) => page.locator('#visit-tab-' + name);

async function openApp(t) {
  const browser = await chromium.launch({headless: true,
    ...(process.env.MEDASSIST_BROWSER ? {executablePath: process.env.MEDASSIST_BROWSER} : {channel: "msedge"}),
    args: ["--no-first-run", "--disable-background-networking"]});
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: {width: 1366, height: 900}, timezoneId: "Europe/Minsk", reducedMotion: "reduce"});
  context.setDefaultTimeout(6000);
  await context.setOffline(true);
  const page = await context.newPage(), errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {if (/^https?:/.test(request.url())) requests.push(request.url());});
  t.after(() => {assert.deepEqual(errors, [], "no uncaught application errors"); assert.deepEqual(requests, [], "new controls work fully offline");});
  await page.clock.setFixedTime(new Date(now));
  await page.goto(url); await enterPolyclinic(page);
  await page.locator('[data-action="search-patients"]').waitFor();
  return page;
}

async function seed(page, reviewed = false) {
  const patient = core.createPatient({id: patientId, label: "ДЕМО Интерфейсова Анна Вымышленная", now});
  let visit = core.createEncounter({id: visitId, patientId, now});
  visit.history.complaints = "ДЕМО: сведения только для проверки интерфейса";
  visit.assessment.summary = "ДЕМО: формулировка, введённая вручную";
  visit.draft = {text: manual, generatedAt: now, sourceFingerprint: core.fingerprint(visit)};
  if (reviewed) visit = core.setReviewStatus(visit, "reviewed", {now});
  const value = core.serializeBundle([visit], [patient]);
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value});
  await page.reload();
  await page.locator("#main").focus();
}

async function openVisit(page) {
  await click(page, "patients");
  await page.locator('.patient-row[data-patient-id="' + patientId + '"] [data-action="patient"]').click();
  await page.locator('#patient-history [data-action="open"][data-id="' + visitId + '"]').click();
  await visitTab(page, "basic").waitFor();
}

async function shortcutTab(page, number, name) {
  await page.keyboard.press("Alt+" + number);
  await page.locator('#visit-tab-' + name + '[aria-selected="true"]').waitFor();
  assert.equal(await visitTab(page, name).evaluate(node => node === document.activeElement), true, "tab shortcut restores keyboard focus");
  assert.equal(await page.locator("#visit-form-panel").getAttribute("aria-labelledby"), "visit-tab-" + name);
}

test("global patient search is reachable by keyboard and preserves the selected query without writes", {timeout: 22000}, async t => {
  const page = await openApp(t);
  await page.reload(); await page.locator("#main-navigation").waitFor();
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(".skip-link").evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#main").evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Control+k");
  const search = page.locator("#patient-search");
  await search.waitFor();
  assert.equal(await search.evaluate(node => node === document.activeElement), true);
  assert.equal(await raw(page), null, "searching the empty workspace creates no patient");
  await seed(page);
  await page.keyboard.press("Control+k");
  await search.fill("Интерфейсова");
  assert.equal(await page.locator(".patient-row").count(), 1);
  const before = await raw(page);
  await page.keyboard.press("Control+k");
  assert.deepEqual(await search.evaluate(node => [node === document.activeElement, node.selectionStart, node.selectionEnd]), [true, 0, "Интерфейсова".length]);
  await click(page, "home");
  await click(page, "search-patients");
  assert.equal(await search.inputValue(), "Интерфейсова");
  assert.deepEqual(await search.evaluate(node => [node === document.activeElement, node.selectionStart, node.selectionEnd]), [true, 0, "Интерфейсова".length]);
  assert.equal(await raw(page), before, "global navigation and search never change clinical records");
});

test("Alt+1 through Alt+5 switch encounter sections with focus and never confirm or regenerate a record", {timeout: 22000}, async t => {
  const page = await openApp(t); await seed(page, true); await openVisit(page);
  const before = await raw(page);
  for (const [number, name] of [[2, "history"], [3, "exam"], [4, "investigations"], [5, "draft"], [1, "basic"]])
    await shortcutTab(page, number, name);
  assert.equal(await raw(page), before);
  await shortcutTab(page, 5, "draft");
  assert.equal(await page.locator("#draft-text").inputValue(), manual);
  assert.equal((await savedVisit(page)).workflow.reviewStatus, "reviewed");
  await click(page, "patients");
  await page.locator("#patient-search").focus();
  await page.keyboard.press("Alt+2");
  assert.equal(await page.locator("#patient-search").evaluate(node => node === document.activeElement), true, "visit shortcuts do not navigate from another page");
  assert.equal(await raw(page), before);
});

test("Ctrl+S retries local saving in place, preserves manual text and cannot mark the record reviewed", {timeout: 24000}, async t => {
  const page = await openApp(t);
  await click(page, "new");
  await page.keyboard.press("Control+s");
  assert.equal(await raw(page), null, "explicit save does not create an untouched patient");
  await seed(page, true); await openVisit(page); await shortcutTab(page, 2, "history");
  const before = await raw(page);
  await page.evaluate(key => {
    window.designRestoreWrites = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException("ДЕМО: хранилище временно недоступно", "QuotaExceededError");
      return window.designRestoreWrites.call(this, name, value);
    };
  }, key);
  const field = page.locator("#field-history-complaints"), value = "ДЕМО: уточнение, ожидающее сохранения";
  await field.fill(value);
  assert.equal(await raw(page), before, "the failed automatic write leaves the saved record intact");
  await page.evaluate(() => {Storage.prototype.setItem = window.designRestoreWrites; delete window.designRestoreWrites;});
  await page.keyboard.press("Control+s");
  await page.waitForFunction(({key, visitId, value}) => JSON.parse(localStorage.getItem(key)).encounters.find(entry => entry.id === visitId).history.complaints === value, {key, visitId, value});
  assert.equal(await field.evaluate(node => node === document.activeElement), true);
  assert.equal(await visitTab(page, "history").getAttribute("aria-selected"), "true");
  const visit = await savedVisit(page);
  assert.equal(visit.workflow.reviewStatus, "draft");
  assert.equal(visit.draft.text, manual);
  assert.equal((await saved(page)).encounters.length, 1);
  assert.equal((await saved(page)).patients.length, 1);
  await page.reload(); await openVisit(page); await shortcutTab(page, 2, "history");
  assert.equal(await field.inputValue(), value, "the explicit save survives reopening");
  assert.equal((await savedVisit(page)).workflow.reviewStatus, "draft");
});

test("global shortcuts leave an open clinical dialog and its unsaved text untouched", {timeout: 22000}, async t => {
  const page = await openApp(t); await seed(page); await openVisit(page); await shortcutTab(page, 5, "draft");
  await click(page, "diagnosis-add");
  const text = page.locator("#diagnosis-text"), dialog = page.locator("#diagnosis-dialog");
  await text.fill("ДЕМО: ещё не сохранённая формулировка");
  const before = await raw(page);
  for (const shortcut of ["Control+k", "Control+s", "Alt+1"]) {
    await page.keyboard.press(shortcut);
    assert.equal(await dialog.isVisible(), true, shortcut + " keeps the dialog open");
    assert.equal(await text.evaluate(node => node === document.activeElement), true);
    assert.equal(await text.inputValue(), "ДЕМО: ещё не сохранённая формулировка");
    assert.equal(await visitTab(page, "draft").getAttribute("aria-selected"), "true");
    assert.equal(await raw(page), before, shortcut + " cannot commit dialog contents");
  }
  await page.locator("#diagnosis-cancel").click();
  await page.locator("#draft-text").focus(); await page.keyboard.press("Control+Space");
  assert.equal(await page.locator("#shortcuts-dialog").isVisible(), true, "existing phrase shortcut still works");
  await page.locator("#shortcuts-close").click();
  assert.equal(await raw(page), before);
});

test("workspace navigation, search and encounter controls fit desktop, tablet and narrow windows", {timeout: 26000}, async t => {
  const page = await openApp(t); await seed(page);
  const before = await raw(page);
  for (const width of [1366, 800, 390]) {
    await page.setViewportSize({width, height: width === 1366 ? 768 : 844});
    for (const view of ["home", "patients"]) {
      await click(page, view);
      assert.equal(await page.locator("#main-navigation").isVisible(), true);
      assert.equal(await page.locator('[data-action="search-patients"]').isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, view + " has no horizontal page overflow at " + width);
    }
    await openVisit(page);
    for (const [number, name] of [[1, "basic"], [5, "draft"]]) {
      await shortcutTab(page, number, name);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + " has no horizontal page overflow at " + width);
      assert.equal(await page.locator(".visit-action-bar").isVisible(), true);
    }
  }
  assert.equal(await raw(page), before, "resizing and navigation preserve records");
});
