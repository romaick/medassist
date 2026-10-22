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
const patientId = "fictional-shortcuts-patient", visitId = "fictional-shortcuts-visit";
const manual = "ДЕМО: исходный текст, отредактированный вручную.";
const entries = [
  {id: "fictional-shortcut-complaint", code: "жал", text: "ДЕМО: первая вымышленная фраза.\nДЕМО: вторая строка."},
  {id: "fictional-shortcut-exam", code: "осм", text: "ДЕМО: выбранное врачом уточнение осмотра."},
  {id: "fictional-shortcut-diagnosis", code: "диаг", text: "ДЕМО: собственная формулировка диагноза (Z00.0)"}
];
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const savedVisit = async page => (await saved(page)).encounters.find(item => item.id === visitId);

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
  t.after(() => {assert.deepEqual(errors, [], "no uncaught application errors"); assert.deepEqual(requests, [], "shortcuts work fully offline");});
  const newPage = async () => {
    const page = await context.newPage(); await page.clock.setFixedTime(new Date(now)); await page.goto(url); await enterPolyclinic(page);
    await page.locator('[data-action="patients"]').first().waitFor(); return page;
  };
  return {page: await newPage(), newPage};
}

async function seed(page, {shortcuts = entries, reviewed = false, empty = false} = {}) {
  const patient = core.createPatient({id: patientId, label: "ДЕМО Сокращений Анна Вымышленная", now});
  let visit = core.createEncounter({id: visitId, patientId, now});
  visit.history.complaints = "ДЕМО: исходные жалобы";
  visit.assessment.summary = "ДЕМО: исходный диагноз";
  visit.draft = {text: manual, generatedAt: now, sourceFingerprint: core.fingerprint(visit)};
  if (reviewed) visit = core.setReviewStatus(visit, "reviewed", {now});
  const bundle = JSON.parse(core.serializeBundle(empty ? [] : [visit], empty ? [] : [patient]));
  bundle.shortcuts = shortcuts;
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value: JSON.stringify(bundle)});
  await page.reload(); return visit;
}

async function tab(page, name) {
  await page.locator('[data-action="tab"][data-tab="' + name + '"]').first().click();
  await page.locator('#visit-tab-' + name + '[aria-selected="true"]').waitFor({state: "visible"});
}
async function openCard(page) {
  await click(page, "patients");
  await page.locator('.patient-row[data-patient-id="' + patientId + '"] [data-action="patient"]').click();
}
async function openVisit(page, name = "history") {
  await openCard(page); await page.locator('#patient-history [data-action="open"][data-id="' + visitId + '"]').click();
  if (name !== "basic") await tab(page, name);
}
async function caret(page, target, start, end = start) {
  await page.locator("#" + target).evaluate((node, {start, end}) => {node.focus(); node.setSelectionRange(start, end);}, {start, end});
}

// "Мои сокращения" were removed from the interface; phrases saved by 0.22–0.24 stay in the data untouched.
test("the removed phrase picker leaves no buttons, dialog or Ctrl+Space expansion in the visit, diagnosis or help", {timeout: 26000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page, "basic");
  for (const name of ["basic", "history", "exam", "draft"]) {
    await tab(page, name);
    assert.equal(await page.locator("[data-shortcut-target], .shortcut-trigger").count(), 0, name + " has no insertion control");
    assert.equal(await page.locator('[data-action="shortcuts-manage"]').count(), 0, name + " has no phrase list button");
  }
  assert.equal(await page.locator("#shortcuts-dialog").count(), 0, "the phrase dialog is gone");
  await tab(page, "history");
  const target = "field-history-complaints", original = await page.locator("#" + target).inputValue();
  await caret(page, target, original.length); await page.keyboard.type(" жал"); await page.keyboard.press("Control+Space");
  assert.equal(await page.locator("dialog[open]").count(), 0, "Ctrl+Space opens nothing");
  assert.equal(await page.locator("#" + target).inputValue(), original + " жал", "a known code is never expanded");
  await page.reload(); await page.locator("#main-navigation").waitFor();
  assert.equal((await savedVisit(page)).history.complaints, original + " жал");
  await openVisit(page, "draft"); await click(page, "diagnosis-add");
  await page.locator("#diagnosis-dialog").waitFor({state: "visible"});
  assert.equal(await page.locator("[data-shortcut-target], .shortcut-trigger").count(), 0, "diagnosis text has no insertion control");
  await page.locator("#diagnosis-cancel").click();
  await click(page, "help");
  const help = await page.locator("#app").innerText();
  assert.doesNotMatch(help, /Мои сокращения|Ctrl \+ Пробел|Вставить фразу/);
  assert.equal(await page.locator('[data-action="shortcuts-manage"]').count(), 0);
});

test("phrases saved by earlier versions survive editing, reload, backup and restore", {timeout: 30000}, async t => {
  const {page, newPage} = await openApp(t); await seed(page); await openVisit(page);
  await page.locator("#field-history-complaints").fill("ДЕМО: изменённые жалобы");
  assert.equal((await savedVisit(page)).history.complaints, "ДЕМО: изменённые жалобы");
  assert.deepEqual((await saved(page)).shortcuts, entries, "an ordinary save keeps stored phrases");
  await page.reload(); await page.locator("#main-navigation").waitFor(); assert.deepEqual((await saved(page)).shortcuts, entries);
  await click(page, "help");
  const pending = page.waitForEvent("download"); await click(page, "backup"); const download = await pending;
  const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk); const buffer = Buffer.concat(chunks);
  assert.deepEqual(core.parseBundle(buffer.toString("utf8")).shortcuts, entries, "the backup still carries stored phrases");
  const other = await newPage(); await seed(other, {empty: true, shortcuts: [{id: "fictional-other-shortcut", code: "друг", text: "ДЕМО: другая фраза"}]}); await click(other, "help");
  await other.locator("#import-file").setInputFiles({name: "fictional-shortcuts.json", mimeType: "application/json", buffer});
  const summary = other.locator("#restore-summary tr").filter({hasText: "Сохранённые сокращения"});
  assert.equal(await summary.count(), 1); assert.deepEqual(await summary.locator("td").allTextContents(), ["1", "3"]);
  await other.locator("#dialog-accept").click();
  assert.deepEqual((await saved(other)).shortcuts, entries); assert.equal((await saved(other)).patients.length, 1);
});
