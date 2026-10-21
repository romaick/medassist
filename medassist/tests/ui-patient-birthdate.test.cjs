"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const {pathToFileURL} = require("node:url");
const {chromium} = require(process.env.MEDASSIST_PLAYWRIGHT || "playwright");
const {clickAction: click, enterPolyclinic} = require("./ui-actions.cjs");
const appRoot = path.resolve(process.env.MEDASSIST_APP_ROOT || path.join(__dirname, "../app"));
const core = require(path.join(appRoot, "core.js"));
const url = pathToFileURL(path.join(appRoot, "index.html")).href;
const key = "medassist.demo.v4";
const now = "2032-04-19T08:00:00.000Z";
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const tab = async (page, name) => {
  await page.locator('[data-action="tab"][data-tab="' + name + '"]').first().click();
  await page.locator('#visit-tab-' + name + '[aria-selected="true"]').waitFor();
};
async function openApp(t) {
  const browser = await chromium.launch({
    headless: true, ...(process.env.MEDASSIST_BROWSER ? {executablePath: process.env.MEDASSIST_BROWSER} : {channel: "msedge"}),
    args: ["--no-first-run", "--disable-background-networking"]
  });
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: {width: 1366, height: 1000}, timezoneId: "Europe/Minsk", reducedMotion: "reduce"});
  context.setDefaultTimeout(6000);
  await context.setOffline(true);
  const errors = [], requests = [];
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {if (/^https?:/.test(request.url())) requests.push(request.url());});
  });
  t.after(() => {assert.deepEqual(errors, []); assert.deepEqual(requests, [], "patient dates work offline");});
  const newPage = async () => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(now));
    await page.goto(url); await enterPolyclinic(page);
    await page.locator("#main-navigation").waitFor();
    return page;
  };
  return {page: await newPage(), newPage};
}
function fixture(withBirthDate = true) {
  const patients = [
    core.createPatient({id: "patient-demo-one", label: "ДЕМО Тестов Вымышленный", now, ...(withBirthDate ? {birthDate: "2000-04-19"} : {})}),
    core.createPatient({id: "patient-demo-two", label: "ДЕМО Тестов Вымышленный", now, birthDate: "1985-11-12"})
  ];
  const encounters = ["2031-04-18", "2031-04-19"].map((date, index) => {
    const entry = core.createEncounter({id: "visit-demo-" + index, patientId: patients[0].id, now});
    entry.visitDate = date;
    entry.age = "30";
    entry.history.complaints = "ДЕМО жалобы " + index;
    entry.history.medications = "ДЕМО постоянный препарат";
    entry.draft.text = "ДЕМО ручной текст " + index;
    entry.workflow.reviewStatus = "reviewed";
    entry.workflow.reviewedAt = now;
    return entry;
  });
  const other = core.createEncounter({id: "visit-demo-other", patientId: patients[1].id, now});
  other.draft.text = "ДЕМО чужая запись";
  other.workflow.reviewStatus = "reviewed"; other.workflow.reviewedAt = now;
  return {patients, encounters: encounters.concat(other)};
}
async function seed(page, data = fixture()) {
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value: core.serializeBundle(data.encounters, data.patients)});
  await page.reload();
  await page.locator("#main-navigation").waitFor();
  return data;
}
async function openCard(page, id = "patient-demo-one") {
  await click(page, "patients");
  await page.locator('.patient-row[data-patient-id="' + id + '"] [data-action="patient"]').click();
  await page.locator("#patient-heading").waitFor();
}
async function openVisit(page, id = "visit-demo-1") {
  await openCard(page);
  await page.locator('[data-action="open"][data-id="' + id + '"]').click();
  await page.locator("#patient-birth-date").waitFor();
}

test("optional birth date alone saves a real card, computes age on visit date and survives reload", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await click(page, "new");
  assert.equal(await page.locator("#patient-birth-date").inputValue(), "");
  await click(page, "patients");
  assert.equal(await raw(page), null, "opening an empty form never creates a patient");
  await click(page, "new");
  await page.locator("#patient-birth-date").fill("2000-04-20");
  assert.equal(await page.locator("#field-age").inputValue(), "31");
  assert.equal(await page.locator("#field-age").evaluate(node => node.readOnly), true);
  await page.locator("#field-visitDate").fill("2032-04-20");
  assert.equal(await page.locator("#field-age").inputValue(), "32");
  const bundle = await saved(page);
  assert.equal(bundle.patients.length, 1);
  assert.equal(bundle.patients[0].birthDate, "2000-04-20");
  assert.equal(bundle.encounters[0].age, "", "calculated age never replaces legacy manual value");
  await tab(page, "draft");
  await click(page, "generate");
  assert.match(await page.locator("#draft-text").inputValue(), /Возраст \(полных лет\): 32/);
  await page.reload();
  await click(page, "patients");
  await page.locator('[data-action="patient"]').first().click();
  assert.match(await page.locator(".patient-card-identity").innerText(), /20\.04\.2000/);
  await page.locator('[data-action="open"]').first().click();
  assert.equal(await page.locator("#field-age").inputValue(), "32");
});

test("birth date overrides but preserves manual age and reviewed text; clearing restores legacy input", {timeout: 20000}, async t => {
  const {page} = await openApp(t), data = await seed(page, fixture(false));
  await openVisit(page);
  assert.equal(await page.locator("#field-age").inputValue(), "30");
  assert.equal(await page.locator("#field-age").evaluate(node => node.readOnly), false);
  await page.locator("#patient-birth-date").fill("2000-04-19");
  assert.equal(await page.locator("#field-age").inputValue(), "31");
  let bundle = await saved(page);
  for (const entry of bundle.encounters.filter(entry => entry.patientId === data.patients[0].id)) {
    assert.equal(entry.workflow.reviewStatus, "draft");
    assert.equal(entry.age, "30");
    assert.equal(entry.draft.text, data.encounters.find(original => original.id === entry.id).draft.text);
  }
  assert.deepEqual(bundle.encounters.at(-1), data.encounters.at(-1));
  await page.locator("#patient-birth-date").fill("");
  assert.equal(await page.locator("#field-age").inputValue(), "30");
  assert.equal(await page.locator("#field-age").evaluate(node => node.readOnly), false);
  await page.locator("#field-age").fill("29");
  bundle = await saved(page);
  assert.equal(bundle.encounters.find(entry => entry.id === "visit-demo-1").age, "29");
  assert.equal(bundle.patients[0].birthDate, "");
});

test("duplicate names remain distinguishable and card history shows each visit's age without edits", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await seed(page);
  const before = await raw(page);
  await click(page, "patients");
  const first = page.locator('.patient-row[data-patient-id="patient-demo-one"]');
  const second = page.locator('.patient-row[data-patient-id="patient-demo-two"]');
  assert.match(await first.innerText(), /19\.04\.2000[\s\S]*32[\s\S]*DEMO-ONE/);
  assert.match(await second.innerText(), /12\.11\.1985[\s\S]*46[\s\S]*DEMO-TWO/);
  await first.locator('[data-action="patient"]').click();
  assert.equal(await page.locator("#patient-edit-panel").isVisible(), false);
  assert.equal(await page.locator('[data-visit-id="visit-demo-0"] [data-encounter-age]').innerText(), "30");
  assert.equal(await page.locator('[data-visit-id="visit-demo-1"] [data-encounter-age]').innerText(), "31");
  assert.equal(await page.locator('[data-patient-information="age"]').innerText(), "31");
  await page.clock.setFixedTime(new Date("2033-04-19T08:00:00.000Z"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  assert.match(await page.locator("[data-patient-age-summary]").innerText(), /Полных лет: 33/);
  assert.equal(await page.locator('[data-patient-information="age"]').innerText(), "31", "today's age never replaces historical age");
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await click(page, "edit-patient");
  assert.equal(await page.locator("#patient-birth-date").inputValue(), "2000-04-19");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await click(page, "finish-patient-edit");
  await page.locator('[data-action="open"][data-id="visit-demo-0"]').click();
  assert.match(await page.locator(".visit-context").innerText(), /19\.04\.2000[\s\S]*30[\s\S]*DEMO-ONE/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await raw(page), before, "viewing calculated ages never rewrites historical records");
});

test("invalid future or post-visit birth date and earlier visit date stay visible but are never saved", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await seed(page);
  await openVisit(page);
  const before = await raw(page);
  await page.locator("#patient-birth-date").fill("2032-04-20");
  assert.match(await page.locator("#patient-birth-date-error").innerText(), /сегодняшнего/);
  assert.equal(await raw(page), before);
  await tab(page, "history");
  await tab(page, "basic");
  assert.equal(await page.locator("#patient-birth-date").inputValue(), "2032-04-20");
  await page.locator("#patient-birth-date").fill("2031-04-19");
  assert.match(await page.locator("#patient-birth-date-error").innerText(), /18\.04\.2031/);
  assert.equal(await raw(page), before);
  await page.locator("#patient-birth-date").fill("2000-04-19");
  assert.equal(await page.locator("#patient-birth-date-error").isVisible(), false);
  await page.locator("#field-visitDate").fill("1999-04-19");
  assert.match(await page.locator("#field-visitDate-error").innerText(), /не раньше даты рождения/);
  assert.equal((await saved(page)).encounters.find(entry => entry.id === "visit-demo-1").visitDate, "2031-04-19");
  await tab(page, "draft");
  await click(page, "generate");
  await page.locator("#field-visitDate").waitFor();
  assert.equal(await page.locator("#field-visitDate").inputValue(), "1999-04-19");
  await page.locator("#field-visitDate").fill("2031-04-19");
  assert.equal(await page.locator("#field-visitDate-error").isVisible(), false);
  assert.match(await page.locator("#save-status").innerText(), /Сохранено/);
});

test("failed birth-date save preserves edits and manual text, then retry saves once", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await seed(page, fixture(false));
  await openCard(page);
  await click(page, "edit-patient");
  const before = await raw(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    window.restoreBirthStorage = () => {Storage.prototype.setItem = original;};
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException("ДЕМО: нет места", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, key);
  await page.locator("#patient-birth-date").fill("2000-04-19");
  assert.equal(await raw(page), before);
  assert.equal(await page.locator("#patient-birth-date").inputValue(), "2000-04-19");
  assert.match(await page.locator("#save-status").innerText(), /не сохранены/);
  await click(page, "finish-patient-edit");
  assert.equal(await page.locator("#patient-edit-panel").isVisible(), true);
  await page.evaluate(() => window.restoreBirthStorage());
  await click(page, "finish-patient-edit");
  assert.equal(await page.locator("#patient-edit-panel").isVisible(), false);
  const bundle = await saved(page);
  assert.equal(bundle.patients.length, 2);
  assert.equal(bundle.encounters.length, 3);
  assert.equal(bundle.patients[0].birthDate, "2000-04-19");
  assert.equal(bundle.encounters[0].draft.text, "ДЕМО ручной текст 0");
});

test("a birth-date edit in another window is visible and cannot be overwritten by stale input", {timeout: 20000}, async t => {
  const {page, newPage} = await openApp(t);
  await seed(page);
  await openCard(page);
  await click(page, "edit-patient");
  const other = await newPage();
  await openCard(other);
  await click(other, "edit-patient");
  await other.locator("#patient-birth-date").fill("1999-04-19");
  await page.locator("#storage-banner").waitFor({state: "visible"});
  assert.match(await page.locator("#storage-banner").innerText(), /другом окне/);
  const latest = await raw(other);
  await page.locator("#patient-birth-date").fill("1998-04-19");
  assert.equal(await raw(page), latest);
  assert.match(await page.locator("#toast").innerText(), /другом окне/);
  await click(page, "reload");
  await page.locator("#dialog-accept").click();
  await page.locator("#confirmation").waitFor({state: "hidden"});
  await openCard(page);
  assert.match(await page.locator(".patient-card-identity").innerText(), /19\.04\.1999/);
});

test("backup export and confirmed restore retain birth date, manual age and edited text", {timeout: 20000}, async t => {
  const {page} = await openApp(t), data = await seed(page);
  await click(page, "help");
  const downloading = page.waitForEvent("download");
  await click(page, "backup");
  const file = await downloading;
  const value = (await fs.readFile(await file.path(), "utf8")).replace(/^\uFEFF/, "");
  assert.equal(JSON.parse(value).patients[0].birthDate, "2000-04-19");
  await openCard(page);
  await click(page, "edit-patient");
  await page.locator("#patient-birth-date").fill("1999-04-19");
  await click(page, "help");
  await page.locator("#import-file").setInputFiles({name: "ДЕМО-даты.json", mimeType: "application/json", buffer: Buffer.from(value)});
  await page.locator("#restore-preview-area").waitFor({state: "visible"});
  assert.equal((await saved(page)).patients[0].birthDate, "1999-04-19", "preview does not restore");
  await page.locator("#dialog-accept").click();
  await page.locator("#confirmation").waitFor({state: "hidden"});
  const restored = await saved(page);
  assert.deepEqual(restored.patients, data.patients);
  assert.deepEqual(restored.encounters, data.encounters);
  await openVisit(page);
  assert.equal(await page.locator("#field-age").inputValue(), "31");
});

test("repeat uses patient birth date while all history transfer remains unchecked", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await seed(page);
  await openCard(page);
  await click(page, "repeat");
  assert.equal(await page.locator('#repeat-fields input:checked').count(), 0);
  await page.locator("#repeat-create").click();
  await page.locator("#patient-birth-date").waitFor();
  assert.equal(await page.locator("#patient-birth-date").inputValue(), "2000-04-19");
  assert.equal(await page.locator("#field-age").inputValue(), "32");
  const bundle = await saved(page), added = bundle.encounters.find(entry => !["visit-demo-0", "visit-demo-1", "visit-demo-other"].includes(entry.id));
  assert.equal(added.age, "");
  for (const value of Object.values(added.history)) assert.equal(value, "");
  assert.equal(bundle.patients.length, 2);
});
