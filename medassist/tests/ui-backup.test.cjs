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
const key = "medassist.demo.v4", backupKey = "medassist.backup-info.v1";
const now = "2032-04-19T08:00:00.000Z";
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const metadata = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), backupKey);
const modal = page => page.locator("#confirmation");

function fixture(id = "current", expanded = false) {
  let patient = core.createPatient({id, label: expanded ? "Демо <img src=x> Копия" : "Демо Текущий Пациент", now});
  let entry = core.createEncounter({id: "visit-" + id, patientId: id, now});
  entry.visitDate = expanded ? "2032-04-17" : "2032-04-19";
  entry.history.complaints = "ДЕМО: вымышленные жалобы";
  entry.draft.text = "ДЕМО: ручной текст, который должен сохраниться.";
  const templates = [];
  if (expanded) {
    const issued = core.applyEncounterSickLeave(patient, entry, {type: "issue", id: "demo-leave", eventId: "demo-event", number: "ДЕМО-101", from: "2032-04-17", to: "2032-04-21", now});
    patient = core.upsertInvestigationReport(issued.patient, {
      date: "2032-04-18", title: "Вымышленный бланк", panelId: "demo-lab", kind: "lab",
      rows: [{fieldId: "demo-value", name: "Вымышленный показатель", result: "12", unit: "усл. ед.", reference: "из бланка", note: ""}]
    }, {now});
    entry = issued.encounter;
    entry.assessment.plan = "ДЕМО: текст рекомендаций";
    templates.push(core.createVisitTemplate(entry, {id: "demo-template", name: "Мой вымышленный шаблон", kind: "recommendations", now}));
  }
  return core.serializeBundle([entry], [patient], templates);
}
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
  t.after(() => {assert.deepEqual(errors, []); assert.deepEqual(requests, []);});
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(now));
  await page.goto(url); await enterPolyclinic(page);
  await page.locator("#main-navigation").waitFor();
  return page;
}
async function seed(page, value = fixture()) {
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value});
  await page.reload();
  await page.locator("#main-navigation").waitFor();
}
async function selectFile(page, value = fixture("imported", true), name = "ДЕМО-копия.json") {
  await page.locator("#import-file").setInputFiles({name, mimeType: "application/json", buffer: Buffer.from(value)});
  await page.locator("#restore-preview-area").waitFor({state: "visible"});
}
async function download(page, action = '[data-action="backup"]') {
  const promise = page.waitForEvent("download");
  await page.locator(action).first().click();
  const file = await promise;
  return {name: file.suggestedFilename(), value: JSON.parse((await fs.readFile(await file.path(), "utf8")).replace(/^\uFEFF/, ""))};
}

test("export reminder appears only with data and records a truthful timestamp and complete offline copy", {timeout: 16000}, async t => {
  const page = await openApp(t);
  assert.equal(await page.locator("#backup-reminder").isVisible(), false);
  await seed(page);
  await page.locator("#backup-reminder").waitFor({state: "visible"});
  const before = await raw(page);
  const file = await download(page);
  assert.equal(file.name, "MedAssist-backup-2032-04-19.json");
  assert.deepEqual(file.value.encounters, JSON.parse(before).encounters);
  assert.deepEqual(await metadata(page), {lastExportAt: now, fileName: file.name, remindAfter: ""});
  assert.equal(await page.locator("#backup-reminder").isVisible(), false);
  assert.match(await page.locator("#toast").innerText(), /Проверьте, что файл сохранён/);
  assert.equal(await raw(page), before);
  await page.reload(); await click(page, "help");
  assert.match(await page.locator("#backup-status").innerText(), /19 апреля 2032/);
  assert.match(await page.locator("#backup-status").innerText(), /означает подготовку/);
});

test("reminder returns after seven days, snoozes for a day and stays off other pages", {timeout: 16000}, async t => {
  const page = await openApp(t); await seed(page); await download(page);
  await page.clock.setFixedTime(new Date("2032-04-26T08:00:00.000Z"));
  await page.locator("#backup-reminder").waitFor({state: "visible"});
  await click(page, "backup-later");
  assert.equal((await metadata(page)).remindAfter, "2032-04-27T08:00:00.000Z");
  await page.reload();
  assert.equal(await page.locator("#backup-reminder").isVisible(), false);
  await page.clock.setFixedTime(new Date("2032-04-27T08:00:00.000Z"));
  await page.locator("#backup-reminder").waitFor({state: "visible"});
  await click(page, "patients");
  assert.equal(await page.locator("#backup-reminder").isVisible(), false);
});

test("export metadata from another window refreshes without suspending medical data", {timeout: 16000}, async t => {
  const page = await openApp(t); await seed(page);
  const other = await page.context().newPage();
  await other.clock.setFixedTime(new Date(now));
  await other.goto(url); await enterPolyclinic(other); await other.locator("#main-navigation").waitFor();
  const before = await raw(page);
  await download(other);
  await page.locator("#backup-reminder").waitFor({state: "hidden"});
  assert.doesNotMatch(await page.locator("#storage-banner").innerText(), /другом окне/);
  assert.equal(await raw(page), before);
  await click(page, "help");
  assert.match(await page.locator("#backup-status").innerText(), /19 апреля 2032/);
});

test("failed download preparation or metadata write never claims a successful saved backup", {timeout: 18000}, async t => {
  const page = await openApp(t); await seed(page);
  await page.evaluate(() => {
    window.originalBlobURL = URL.createObjectURL;
    URL.createObjectURL = () => {throw new Error("ДЕМО: создание файла недоступно");};
  });
  await click(page, "backup");
  assert.equal(await metadata(page), null);
  assert.match(await page.locator("#toast").innerText(), /Копия не подготовлена/);
  await page.evaluate(backupKey => {
    URL.createObjectURL = window.originalBlobURL;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === backupKey) throw new DOMException("ДЕМО: нет места", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, backupKey);
  const file = await download(page);
  assert.equal(file.value.encounters.length, 1);
  assert.equal(await metadata(page), null);
  assert.match(await page.locator("#toast").innerText(), /дата выгрузки не записана/);
  assert.equal(await page.locator("#backup-reminder").isVisible(), true);
});

test("restore preview shows counts, dates and searchable escaped patients; cancel and Escape are read-only", {timeout: 16000}, async t => {
  const page = await openApp(t); await seed(page); await click(page, "help");
  const before = await raw(page);
  await selectFile(page);
  assert.equal(await page.locator("#dialog-cancel").evaluate(node => node === document.activeElement), true);
  const rows = await page.locator("#restore-summary tbody tr").allTextContents();
  assert.deepEqual(rows.slice(0, 6), ["Пациенты11", "Приёмы11", "Личные шаблоны01", "Мои сокращения00", "Результаты и показатели01", "Записи больничных01"]);
  assert.match(rows.at(-1), /19.04.2032.*17.04.2032/);
  assert.match(await page.locator("#restore-patients").innerText(), /Демо <img src=x> Копия/);
  assert.equal(await page.locator("#restore-patients img").count(), 0);
  await page.locator("#restore-patient-search").fill("нет такого");
  assert.match(await page.locator("#restore-patient-count").innerText(), /0 из 1/);
  await page.locator("#restore-patient-search").fill("imported");
  assert.match(await page.locator("#restore-patient-count").innerText(), /1 из 1/);
  assert.equal(await raw(page), before);
  await page.locator("#dialog-cancel").click();
  assert.equal(await raw(page), before);
  await selectFile(page); await page.keyboard.press("Escape");
  assert.equal(await modal(page).isVisible(), false);
  assert.equal(await raw(page), before);
});

test("preview can export current data and explicit replacement preserves incoming text, results, leaves and templates", {timeout: 17000}, async t => {
  const page = await openApp(t); await seed(page);
  const incoming = fixture("imported", true);
  await selectFile(page, incoming);
  const old = await download(page, "#restore-backup");
  assert.equal(old.value.patients[0].id, "current");
  assert.equal(await modal(page).isVisible(), true);
  assert.match(await page.locator("#restore-backup-status").innerText(), /Проверьте/);
  await page.locator("#dialog-accept").click();
  await modal(page).waitFor({state: "hidden"});
  const result = JSON.parse(await raw(page)), expected = core.parseBundle(incoming);
  for (const field of ["encounters", "patients", "templates"]) assert.deepEqual(result[field], expected[field]);
  assert.equal(await page.locator('#main-navigation [data-action="new"]').count(), 1);
});

test("failed restore keeps the preview and existing data, then retries safely", {timeout: 16000}, async t => {
  const page = await openApp(t); await seed(page); await selectFile(page);
  const before = await raw(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    window.restoreStorage = () => {Storage.prototype.setItem = original;};
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException("ДЕМО: нет места", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, key);
  await page.locator("#dialog-accept").click();
  assert.equal(await raw(page), before);
  assert.equal(await modal(page).isVisible(), true);
  assert.match(await page.locator("#restore-preview-error").innerText(), /Не удалось заменить/);
  assert.equal(await page.locator("#dialog-accept").isEnabled(), true);
  await page.evaluate(() => window.restoreStorage());
  await page.locator("#dialog-accept").click();
  assert.equal(JSON.parse(await raw(page)).patients[0].id, "imported");
});

test("another window blocks replacement visibly and a same-window disk change is also detected", {timeout: 20000}, async t => {
  const page = await openApp(t); await seed(page); await selectFile(page);
  const other = await page.context().newPage(); await other.goto(url); await enterPolyclinic(other);
  const latest = fixture("other");
  await other.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value: latest});
  await page.locator("#restore-preview-error").waitFor({state: "visible"});
  assert.match(await page.locator("#restore-preview-error").innerText(), /другом окне/);
  assert.equal(await page.locator("#dialog-accept").isDisabled(), true);
  await page.locator("#dialog-accept").evaluate(node => node.dispatchEvent(new MouseEvent("click", {bubbles: true})));
  assert.equal(await raw(page), latest);
  await page.locator("#dialog-cancel").click();
  await page.reload(); await selectFile(page);
  const newest = fixture("newest");
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value: newest});
  await page.locator("#dialog-accept").click();
  assert.equal(await raw(page), newest);
  assert.match(await page.locator("#restore-preview-error").innerText(), /изменились после открытия/);
  assert.equal(await page.locator("#dialog-accept").isDisabled(), true);
});

test("invalid files leave data intact and restore preview fits a narrow screen", {timeout: 16000}, async t => {
  const page = await openApp(t); await seed(page); await click(page, "help");
  const before = await raw(page);
  await page.locator("#import-file").setInputFiles({name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{}")});
  await page.locator("#toast").waitFor({state: "visible"});
  assert.match(await page.locator("#toast").innerText(), /Восстановление не выполнено/);
  assert.equal(await modal(page).isVisible(), false);
  assert.equal(await raw(page), before);
  await page.setViewportSize({width: 390, height: 844});
  await selectFile(page);
  assert.equal(await modal(page).evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.locator("#dialog-accept").scrollIntoViewIfNeeded();
  assert.equal(await page.locator("#dialog-accept").evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
  }), true);
});

test("an unsaved new patient is included in the copy and preview without being silently saved or discarded", {timeout: 18000}, async t => {
  const page = await openApp(t); await click(page, "new");
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException("ДЕМО: нет места", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, key);
  await page.locator("#patient-label").fill("ДЕМО Несохранённый Пациент");
  await click(page, "help");
  const file = await download(page);
  assert.equal(file.value.patients[0].label, "ДЕМО Несохранённый Пациент");
  assert.equal(file.value.encounters.length, 1);
  assert.equal(await raw(page), null);
  await selectFile(page);
  assert.match((await page.locator("#restore-summary tbody tr").allTextContents())[0], /Пациенты11/);
  await page.locator("#dialog-cancel").click();
  await click(page, "visit");
  assert.equal(await page.locator("#patient-label").inputValue(), "ДЕМО Несохранённый Пациент");
  assert.equal(await raw(page), null);
});

test("a later file selection wins over an older read that finishes afterwards", {timeout: 14000}, async t => {
  const page = await openApp(t); await seed(page);
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function() {
      const text = await original.call(this);
      if (this.name === "slow.json") await new Promise(resolve => {window.finishOldRead = resolve;});
      return text;
    };
  });
  const old = fixture("old");
  await page.locator("#import-file").setInputFiles({name: "slow.json", mimeType: "application/json", buffer: Buffer.from(old)});
  await page.waitForFunction(() => typeof window.finishOldRead === "function");
  await selectFile(page, fixture("latest"), "latest.json");
  await page.evaluate(() => window.finishOldRead());
  assert.match(await page.locator("#restore-file-info").innerText(), /^latest.json/);
  assert.match(await page.locator("#restore-patients").innerText(), /Код: latest/);
  await page.locator("#dialog-accept").click();
  assert.equal(JSON.parse(await raw(page)).patients[0].id, "latest");
});
