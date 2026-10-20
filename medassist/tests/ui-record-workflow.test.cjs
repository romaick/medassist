"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require(process.env.MEDASSIST_PLAYWRIGHT || "playwright");
const {clickAction: click} = require("./ui-actions.cjs");
const appRoot = path.resolve(process.env.MEDASSIST_APP_ROOT || path.join(__dirname, "../app"));
const core = require(path.join(appRoot, "core.js"));
const url = pathToFileURL(path.join(appRoot, "index.html")).href;
const key = "medassist.demo.v4", formatKey = "medassist.record-format.v1";
const now = "2032-04-19T08:00:00.000Z", patientId = "fictional-record-patient", visitId = "fictional-record-visit";
const manual = "ДЕМО: ручная запись врача, которую нельзя менять автоматически.";
const note = "ДЕМО: на следующем приёме уточнить название документа. Личная пометка <буквально>.";
const labText = "Показатель\tРезультат\tЕдиницы\tНорма\nДЕМО Альфа\t0\tдемо/л\t0–1\nДЕМО Бета\t5,1\t\t";
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const rawFormat = page => page.evaluate(key => localStorage.getItem(key), formatKey);
const saved = async page => JSON.parse(await raw(page));
const savedPatient = async page => (await saved(page)).patients.find(item => item.id === patientId);
const savedVisit = async page => (await saved(page)).encounters.find(item => item.id === visitId);
const section = (page, name) => page.locator('[data-format-section="' + name + '"]');
const pasteRows = page => page.locator("#lab-paste-rows > .lab-paste-row");
const pasteField = (row, name) => row.locator('[data-paste-field="' + name + '"]');

async function openApp(t) {
  const browser = await chromium.launch({headless: true,
    ...(process.env.MEDASSIST_BROWSER ? {executablePath: process.env.MEDASSIST_BROWSER} : {channel: "msedge"}),
    args: ["--no-first-run", "--disable-background-networking"]});
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: {width: 1366, height: 1000}, timezoneId: "Europe/Minsk"});
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors = [], requests = [];
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {if (/^https?:/.test(request.url())) requests.push(request.url());});
  });
  t.after(() => {assert.deepEqual(errors, [], "no uncaught application errors"); assert.deepEqual(requests, [], "all workflow tools remain offline");});
  const newPage = async () => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(now)); await page.goto(url);
    await page.locator("#main-navigation").waitFor();
    return page;
  };
  return {page: await newPage(), newPage};
}

async function seed(page, {personalNote = "", reviewed = true} = {}) {
  const patient = core.createPatient({id: patientId, label: "ДЕМО Форматова Анна Вымышленная", now});
  if (personalNote) patient.personalNote = personalNote;
  let visit = core.createEncounter({id: visitId, patientId, now});
  visit.visitDate = "2032-04-19";
  visit.history.complaints = "ДЕМО: жалобы для проверки формата";
  visit.history.conditions = "ДЕМО: сведения анамнеза";
  visit.exam.general = "ДЕМО: общее состояние";
  visit.exam.cardiovascular = "ДЕМО: описание сердечно-сосудистой системы";
  visit.vitals.systolic = "120"; visit.vitals.diastolic = "80";
  visit.assessment.summary = "ДЕМО: вымышленный диагноз";
  visit.assessment.plan = "ДЕМО: первая рекомендация\nДЕМО: вторая рекомендация";
  visit.assessment.returnVisitDate = "2032-04-25";
  visit.draft = {text: manual, generatedAt: now, sourceFingerprint: core.fingerprint(visit, {patient, encounters: [visit]})};
  if (reviewed) visit = core.setReviewStatus(visit, "reviewed", {now});
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value: core.serializeBundle([visit], [patient])});
  await page.reload();
  return {patient, visit};
}

async function openCard(page) {
  await click(page, "patients");
  await page.locator('.patient-row[data-patient-id="' + patientId + '"] [data-action="patient"]').click();
}
async function openVisit(page, tab = "draft") {
  await openCard(page);
  await page.locator('.patient-tabs [data-card-tab="history"]').click();
  await page.locator('#patient-history [data-action="open"][data-id="' + visitId + '"]').click();
  await page.locator('[data-action="tab"][data-tab="' + tab + '"]').first().click();
}
async function openPaste(page, text = labText) {
  await click(page, "lab-paste"); await page.locator("#lab-paste-source").fill(text);
  await page.locator("#lab-paste-parse").click();
  assert.equal(await page.locator("#lab-paste-error").textContent(), "", "supported text parses without a form error");
  await pasteRows(page).first().waitFor();
}
async function approvePaste(page, rows = [0], date = "2032-04-18") {
  await page.locator("#lab-paste-date").fill(date);
  for (const index of rows) await pasteRows(page).nth(index).locator("[data-paste-include]").check();
  await page.locator("#lab-paste-confirm").check();
}
async function savePaste(page) {
  await page.locator("#lab-paste-save").click();
  await page.locator("#lab-paste-dialog").waitFor({state: "hidden"});
}
async function generate(page) {
  await click(page, "generate");
  if (await page.locator("#confirmation").isVisible()) await page.locator("#dialog-accept").click();
  return page.locator("#draft-text").inputValue();
}
async function failWrites(page, storageKey) {
  await page.evaluate(storageKey => {
    window.restoreWorkflowStorage = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === storageKey) throw new DOMException("ДЕМО: хранилище заполнено", "QuotaExceededError");
      return window.restoreWorkflowStorage.call(this, name, value);
    };
  }, storageKey);
}
async function restoreWrites(page) {
  await page.evaluate(() => {Storage.prototype.setItem = window.restoreWorkflowStorage; delete window.restoreWorkflowStorage;});
}

test("format preview, cancellation and reset never rewrite the saved clinical record", {timeout: 24000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page);
  const before = await raw(page), beforeFormat = await rawFormat(page);
  await click(page, "record-format");
  const original = await page.locator("#record-format-preview").inputValue();
  assert.match(original, /ДЕМО: жалобы для проверки формата/);
  assert.equal(await page.locator("#record-format-preview").getAttribute("readonly"), "");
  await section(page, "history").locator("[data-format-title]").fill("Мой анамнез");
  assert.match(await page.locator("#record-format-preview").inputValue(), /Мой анамнез/);
  await page.locator("#record-format-reset").click();
  assert.equal(await page.locator("#record-format-preview").inputValue(), original);
  await page.locator("#record-format-cancel").click();
  assert.equal(await rawFormat(page), beforeFormat);
  assert.equal(await raw(page), before);
});

test("saved format changes only the next explicit generation and survives reload", {timeout: 28000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page);
  const before = await raw(page);
  await click(page, "record-format");
  await section(page, "history").locator("[data-format-title]").fill("ДЕМО МОЙ АНАМНЕЗ");
  await section(page, "diagnosis").locator("[data-format-title]").fill("ДЕМО МОЙ ДИАГНОЗ");
  for (let i = 0; i < 3; i++) await section(page, "diagnosis").locator('[data-format-move="up"]').click();
  await page.locator("#format-exam-style").selectOption("paragraph");
  await page.locator("#format-recommendations-style").selectOption("list");
  await page.locator("#format-short-labels").check();
  await page.locator("#format-return-title").fill("ДЕМО Контрольная явка");
  const preview = await page.locator("#record-format-preview").inputValue();
  assert.ok(preview.indexOf("ДЕМО МОЙ ДИАГНОЗ") < preview.indexOf("ДЕМО МОЙ АНАМНЕЗ"));
  assert.match(preview.trim().split("\n").at(-1), /ДЕМО Контрольная явка.*25\.04\.2032/);
  await page.locator("#record-format-save").click();
  await page.locator("#record-format-dialog").waitFor({state: "hidden"});
  assert.equal(await raw(page), before, "format settings do not alter a reviewed visit or its manual text");
  assert.ok(await rawFormat(page));
  assert.equal(await page.locator("#draft-text").inputValue(), manual);
  await page.reload(); await openVisit(page);
  await click(page, "record-format");
  assert.equal(await section(page, "history").locator("[data-format-title]").inputValue(), "ДЕМО МОЙ АНАМНЕЗ");
  assert.equal(await page.locator("#record-format-preview").inputValue(), preview);
  await page.locator("#record-format-cancel").click();
  assert.equal(await generate(page), preview);
  assert.equal((await savedVisit(page)).workflow.reviewStatus, "draft");
});

test("literal section titles are escaped in the interface and headings can be omitted", {timeout: 22000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page);
  await click(page, "record-format");
  const title = 'ДЕМО <img src="missing" onerror="throw 1"> & раздел';
  await section(page, "history").locator("[data-format-title]").fill(title);
  assert.ok((await page.locator("#record-format-preview").inputValue()).includes(title));
  assert.equal(await page.locator("#record-format-dialog img").count(), 0);
  await page.locator("#format-headings").uncheck();
  const text = await page.locator("#record-format-preview").inputValue();
  assert.ok(!text.includes(title)); assert.match(text, /ДЕМО: жалобы для проверки формата/);
  await page.locator("#record-format-save").click();
  assert.equal(await generate(page), text);
});

test("malformed stored formatting reports an error and requires explicit reset before replacement", {timeout: 20000}, async t => {
  const {page} = await openApp(t); await seed(page);
  await page.evaluate(key => localStorage.setItem(key, '{"broken":'), formatKey);
  await page.reload(); await openVisit(page);
  const before = await raw(page); await click(page, "record-format");
  assert.equal(await page.locator("#record-format-error").isVisible(), true);
  await page.locator("#record-format-cancel").click();
  assert.equal(await rawFormat(page), '{"broken":'); assert.equal(await raw(page), before);
  await click(page, "record-format"); await page.locator("#record-format-reset").click();
  await page.locator("#record-format-save").click();
  await page.locator("#record-format-dialog").waitFor({state: "hidden"});
  const repaired = await rawFormat(page);
  assert.doesNotThrow(() => JSON.parse(repaired)); assert.equal(await raw(page), before);
});

test("failed format write preserves controls and a retry saves without changing patient data", {timeout: 20000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page);
  const before = await raw(page), beforeFormat = await rawFormat(page);
  await click(page, "record-format"); await section(page, "history").locator("[data-format-title]").fill("ДЕМО После ошибки");
  await failWrites(page, formatKey); await page.locator("#record-format-save").click();
  assert.equal(await page.locator("#record-format-error").isVisible(), true);
  assert.equal(await rawFormat(page), beforeFormat); assert.equal(await raw(page), before);
  assert.equal(await section(page, "history").locator("[data-format-title]").inputValue(), "ДЕМО После ошибки");
  await restoreWrites(page); await page.locator("#record-format-save").click();
  await page.locator("#record-format-dialog").waitFor({state: "hidden"});
  assert.match(await rawFormat(page), /ДЕМО После ошибки/); assert.equal(await raw(page), before);
});

test("a stale format dialog cannot overwrite settings saved in another window", {timeout: 24000}, async t => {
  const {page, newPage} = await openApp(t); await seed(page); await openVisit(page);
  const other = await newPage(); await openVisit(other);
  await click(other, "record-format"); await section(other, "history").locator("[data-format-title]").fill("ДЕМО Устаревший формат");
  await click(page, "record-format"); await section(page, "history").locator("[data-format-title]").fill("ДЕМО Актуальный формат");
  await page.locator("#record-format-save").click();
  const before = await rawFormat(page);
  await other.locator("#record-format-save").click();
  assert.equal(await other.locator("#record-format-error").isVisible(), true);
  assert.match(await other.locator("#record-format-error").innerText(), /другом окне|изменились/);
  assert.equal(await rawFormat(page), before);
  assert.equal(await section(other, "history").locator("[data-format-title]").inputValue(), "ДЕМО Устаревший формат");
});

test("personal note is shown before repeat entry, exported in a backup and excluded from the clinical record", {timeout: 26000}, async t => {
  const {page} = await openApp(t); const original = await seed(page); await openCard(page);
  await click(page, "patient-note"); await page.locator("#personal-note-text").fill(note);
  await page.locator("#personal-note-save").click(); await page.locator("#personal-note-dialog").waitFor({state: "hidden"});
  assert.match(await page.locator("#patient-personal-note").innerText(), /Личная пометка <буквально>/);
  assert.equal((await savedPatient(page)).personalNote, note);
  assert.deepEqual(await savedVisit(page), original.visit);
  assert.equal(core.fingerprint(original.visit, {patient: await savedPatient(page), encounters: [original.visit]}), original.visit.draft.sourceFingerprint);
  await page.reload(); await openCard(page); await click(page, "repeat");
  assert.ok((await page.locator("#repeat-personal-note").innerText()).includes(note));
  await page.locator("#repeat-create").click();
  const repeat = (await saved(page)).encounters.find(item => item.id !== visitId);
  assert.ok(repeat); assert.ok(!JSON.stringify(repeat).includes(note));
  await page.locator('[data-action="tab"][data-tab="draft"]').first().click();
  assert.ok(!(await generate(page)).includes(note));
  await click(page, "help");
  const downloadPromise = page.waitForEvent("download"); await click(page, "backup");
  const download = await downloadPromise;
  const backup = JSON.parse((await fs.readFile(await download.path(), "utf8")).replace(/^\uFEFF/, ""));
  assert.equal(backup.patients.find(item => item.id === patientId).personalNote, note);
  assert.ok(!JSON.stringify(backup.encounters).includes(note));
});

test("personal note editing, cancellation and explicit clearing preserve clinical review and manual draft", {timeout: 22000}, async t => {
  const {page} = await openApp(t); const original = await seed(page, {personalNote: note}); await openCard(page);
  const before = await raw(page); await click(page, "patient-note");
  await page.locator("#personal-note-text").fill("ДЕМО: несохранённая правка"); await page.locator("#personal-note-cancel").click();
  assert.equal(await raw(page), before);
  await click(page, "patient-note"); assert.equal(await page.locator("#personal-note-text").inputValue(), note);
  const markup = 'ДЕМО <img src="missing" onerror="throw 1"> & заметка';
  await page.locator("#personal-note-text").fill(markup); await page.locator("#personal-note-save").click();
  assert.ok((await page.locator("#patient-personal-note").innerText()).includes(markup));
  assert.equal(await page.locator("#patient-personal-note img").count(), 0);
  await click(page, "patient-note"); await page.locator("#personal-note-text").fill(""); await page.locator("#personal-note-save").click();
  assert.equal((await savedPatient(page)).personalNote || "", "");
  assert.deepEqual(await savedVisit(page), original.visit);
});

test("failed personal note save retains text and retry creates no duplicate encounter", {timeout: 22000}, async t => {
  const {page} = await openApp(t); await seed(page); await openCard(page); await click(page, "patient-note");
  await page.locator("#personal-note-text").fill(note); const before = await raw(page);
  await failWrites(page, key); await page.locator("#personal-note-save").click();
  assert.equal(await page.locator("#personal-note-error").isVisible(), true);
  assert.equal(await page.locator("#personal-note-text").inputValue(), note); assert.equal(await raw(page), before);
  await restoreWrites(page); await page.locator("#personal-note-save").click();
  await page.locator("#personal-note-dialog").waitFor({state: "hidden"});
  assert.equal((await savedPatient(page)).personalNote, note); assert.equal((await saved(page)).encounters.length, 1);
});

test("personal note conflict is visible in two windows and cannot overwrite the newer note", {timeout: 24000}, async t => {
  const {page, newPage} = await openApp(t); await seed(page); await openCard(page);
  const other = await newPage(); await openCard(other); await click(other, "patient-note");
  await other.locator("#personal-note-text").fill("ДЕМО: устаревшая заметка");
  await click(page, "patient-note"); await page.locator("#personal-note-text").fill(note); await page.locator("#personal-note-save").click();
  await other.locator("#personal-note-error").waitFor({state: "visible"});
  const before = await raw(page); await other.locator("#personal-note-save").click();
  assert.match(await other.locator("#personal-note-error").innerText(), /другом окне|изменились/);
  assert.equal(await raw(page), before); assert.equal((await savedPatient(page)).personalNote, note);
  assert.equal(await other.locator("#personal-note-text").inputValue(), "ДЕМО: устаревшая заметка");
});

test("paste preview keeps zero and comma values, leaves rows unselected and persists only selected corrected rows", {timeout: 24000}, async t => {
  const {page} = await openApp(t); const original = await seed(page); await openCard(page);
  await page.locator('.patient-tabs [data-card-tab="investigations"]').click(); const before = await raw(page);
  await openPaste(page); assert.equal(await pasteRows(page).count(), 2);
  assert.equal(await page.locator("#lab-paste-date").inputValue(), "");
  assert.equal(await page.locator("#lab-paste-original").inputValue(), labText);
  assert.equal(await pasteField(pasteRows(page).nth(0), "result").inputValue(), "0");
  assert.equal(await pasteField(pasteRows(page).nth(1), "result").inputValue(), "5,1");
  assert.equal(await pasteField(pasteRows(page).nth(1), "unit").inputValue(), "");
  assert.equal(await pasteField(pasteRows(page).nth(1), "reference").inputValue(), "");
  assert.equal(await page.locator("#lab-paste-rows [data-paste-include]:checked").count(), 0);
  assert.equal(await raw(page), before);
  await pasteField(pasteRows(page).nth(0), "name").fill("ДЕМО Альфа: проверено врачом");
  await approvePaste(page); await savePaste(page);
  const card = await savedPatient(page); assert.equal(card.investigations.length, 1);
  const result = card.investigations[0];
  assert.equal(result.name, "ДЕМО Альфа: проверено врачом"); assert.equal(result.result, "0");
  assert.equal(result.unit, "демо/л"); assert.equal(result.reference, "0–1");
  assert.equal(result.date, "2032-04-18"); assert.equal(result.kind, "lab"); assert.equal(result.panelId, "pasted-text");
  assert.deepEqual(await savedVisit(page), original.visit, "card import is not attached to an old visit automatically");
});

test("paste requires a date, selected row and physician approval before any data is saved", {timeout: 24000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page, "investigations"); await openPaste(page);
  const before = await raw(page);
  await page.locator("#lab-paste-save").click(); assert.equal(await raw(page), before);
  await page.locator("#lab-paste-date").fill("2032-04-18");
  await page.locator("#lab-paste-confirm").check();
  await page.locator("#lab-paste-save").click(); assert.equal(await raw(page), before);
  await pasteRows(page).nth(1).locator("[data-paste-include]").check();
  assert.equal(await page.locator("#lab-paste-confirm").isChecked(), false);
  await page.locator("#lab-paste-save").click(); assert.equal(await raw(page), before);
  await page.locator("#lab-paste-confirm").check(); await savePaste(page);
  const data = await saved(page), result = data.patients[0].investigations[0];
  assert.equal(result.result, "5,1"); assert.equal(result.unit, ""); assert.equal(result.reference, "");
  assert.deepEqual(data.encounters[0].investigationIds, [result.id]);
  assert.equal(data.encounters[0].draft.text, manual);
  assert.equal(data.encounters[0].workflow.reviewStatus, "draft");
});

test("editing parsed rows or source invalidates approval and reparsing requires a fresh review", {timeout: 24000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page, "investigations"); await openPaste(page);
  const before = await raw(page); await approvePaste(page);
  await pasteField(pasteRows(page).first(), "result").fill("0,2");
  assert.equal(await page.locator("#lab-paste-confirm").isChecked(), false);
  await page.locator("#lab-paste-confirm").check();
  await page.locator("#lab-paste-source").fill("Показатель\tРезультат\tЕдиницы\tНорма\nДЕМО Гамма\t7\t\t");
  assert.equal(await page.locator("#lab-paste-confirm").isChecked(), false);
  assert.equal(await pasteRows(page).count(), 0);
  await page.locator("#lab-paste-save").click(); assert.equal(await raw(page), before);
  await page.locator("#lab-paste-parse").click(); assert.equal(await pasteRows(page).count(), 1);
  assert.equal(await page.locator("#lab-paste-rows [data-paste-include]:checked").count(), 0);
  await approvePaste(page); await savePaste(page);
  assert.equal((await savedPatient(page)).investigations[0].name, "ДЕМО Гамма");
  assert.equal((await savedPatient(page)).investigations[0].result, "7");
});

test("uncertain lines remain visible for manual review and never receive guessed units or normal ranges", {timeout: 22000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page, "investigations");
  const source = "ДЕМО: свободная строка без распознаваемого результата\nДЕМО показатель: 5,1";
  await openPaste(page, source);
  assert.equal(await page.locator("#lab-paste-original").inputValue(), source);
  assert.equal(await page.locator("#lab-paste-rows [data-paste-include]:checked").count(), 0);
  for (const candidate of await pasteRows(page).all()) {
    assert.equal(await pasteField(candidate, "unit").inputValue(), "");
    assert.equal(await pasteField(candidate, "reference").inputValue(), "");
  }
  assert.match(await page.locator("#lab-paste-dialog").innerText(), /проверь|провер|уточн|распозн|разобр/i);
  await page.locator("#lab-paste-cancel").click();
  assert.equal((await savedPatient(page)).investigations, undefined);
});

test("cancelled text import creates no empty patient, while approved import creates one linked visit", {timeout: 24000}, async t => {
  const {page} = await openApp(t); await click(page, "new");
  await page.locator('[data-action="tab"][data-tab="investigations"]').first().click(); const before = await raw(page);
  await openPaste(page); await approvePaste(page); await page.locator("#lab-paste-cancel").click();
  assert.equal(await raw(page), before);
  await openPaste(page); await approvePaste(page, [0, 1]); await savePaste(page);
  const data = await saved(page); assert.equal(data.patients.length, 1); assert.equal(data.encounters.length, 1);
  assert.equal(data.patients[0].investigations.length, 2);
  assert.deepEqual(new Set(data.encounters[0].investigationIds), new Set(data.patients[0].investigations.map(item => item.id)));
  assert.equal(data.encounters[0].draft.text, "");
});

test("a failed multirow import is atomic and retry or double click creates just one report", {timeout: 24000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page, "investigations");
  await openPaste(page); await approvePaste(page, [0, 1]); const before = await raw(page);
  await failWrites(page, key); await page.locator("#lab-paste-save").click();
  assert.equal(await raw(page), before); assert.equal(await page.locator("#lab-paste-error").isVisible(), true);
  assert.equal(await pasteRows(page).count(), 2); assert.equal(await page.locator("#lab-paste-source").inputValue(), labText);
  await restoreWrites(page); await page.locator("#lab-paste-save").evaluate(button => {button.click(); button.click();});
  await page.locator("#lab-paste-dialog").waitFor({state: "hidden"});
  const card = await savedPatient(page); assert.equal(card.investigations.length, 2);
  assert.equal(new Set(card.investigations.map(item => item.reportId)).size, 1);
  assert.equal((await savedVisit(page)).investigationIds.length, 2);
  assert.equal((await saved(page)).encounters.length, 1);
});

test("another window's import prevents a stale paste form from saving duplicate rows", {timeout: 24000}, async t => {
  const {page, newPage} = await openApp(t); await seed(page); await openVisit(page, "investigations");
  const other = await newPage(); await openVisit(other, "investigations");
  await openPaste(other); await approvePaste(other, [0, 1]);
  await openPaste(page); await approvePaste(page); await savePaste(page);
  await other.locator("#lab-paste-error").waitFor({state: "visible"}); const before = await raw(page);
  await other.locator("#lab-paste-save").click();
  assert.match(await other.locator("#lab-paste-error").innerText(), /другом окне|изменились/);
  assert.equal(await raw(page), before); assert.equal((await savedPatient(page)).investigations.length, 1);
  assert.equal(await other.locator("#lab-paste-source").inputValue(), labText);
});

test("format, personal note and pasted result controls fit a narrow screen with literal long text", {timeout: 30000}, async t => {
  const {page} = await openApp(t); await seed(page); await page.setViewportSize({width: 390, height: 844});
  async function fits(id) {
    const bounds = await page.locator(id).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, id + " fits the viewport");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "page does not overflow");
  }
  await openCard(page); await click(page, "patient-note");
  await page.locator("#personal-note-text").fill(note + "я".repeat(500)); await fits("#personal-note-dialog");
  await page.locator("#personal-note-save").click();
  await openVisit(page); await click(page, "record-format"); await fits("#record-format-dialog");
  await page.locator("#record-format-cancel").click();
  await page.locator('[data-action="tab"][data-tab="investigations"]').first().click();
  await openPaste(page); await pasteField(pasteRows(page).first(), "name").fill('ДЕМО <img src="missing" onerror="throw 1"> ' + "я".repeat(300));
  await fits("#lab-paste-dialog"); assert.equal(await page.locator("#lab-paste-dialog img").count(), 0);
  await approvePaste(page); await savePaste(page);
  assert.equal((await savedPatient(page)).investigations.length, 1);
});
