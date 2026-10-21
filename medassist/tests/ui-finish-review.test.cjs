"use strict";
const {clickAction: click, enterPolyclinic} = require("./ui-actions.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require(process.env.MEDASSIST_PLAYWRIGHT || "playwright");
const appRoot = path.resolve(process.env.MEDASSIST_APP_ROOT || path.join(__dirname, "../app"));
const core = require(path.join(appRoot, "core.js"));
const url = pathToFileURL(path.join(appRoot, "index.html")).href;
const key = "medassist.demo.v4";
const now = "2032-04-19T08:00:00.000Z";
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const dialog = page => page.locator("#finish-review-dialog");

async function openApp(t) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MEDASSIST_BROWSER ? {executablePath: process.env.MEDASSIST_BROWSER} : {channel: "msedge"}),
    args: ["--no-first-run", "--disable-background-networking"]
  });
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: {width: 1366, height: 1000}, timezoneId: "Europe/Minsk", reducedMotion: "reduce"});
  context.setDefaultTimeout(6000);
  await context.setOffline(true);
  const errors = [], requests = [];
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(requests, []); });
  await page.clock.setFixedTime(new Date(now));
  await page.goto(url); await enterPolyclinic(page);
  await page.locator('#main-navigation [data-action="new"]').waitFor();
  return page;
}
async function chooseTab(page, tab) {
  await page.locator('.tab-bar [data-tab="' + tab + '"]').click();
  await page.locator('.tab-bar [data-tab="' + tab + '"][aria-selected="true"]').waitFor();
}
async function seed(page, {text = "ДЕМО: свободный текст врача.", generated = false, reviewed = false, sick = false} = {}) {
  const patient = core.createPatient({id: "finish-patient", label: "Тестов Завершение Вымышленный", now});
  let entry = core.createEncounter({id: "finish-visit", patientId: patient.id, now});
  entry.history.complaints = "ДЕМО: контрольный осмотр";
  entry.assessment.returnVisitDate = "2032-04-22";
  if (sick) entry.assessment.sickLeaveIssued = "yes";
  if (generated) {
    const context = {patient, encounters: [entry]};
    entry.draft = {text: core.generateDraft(entry, context), generatedAt: now, sourceFingerprint: core.fingerprint(entry, context)};
  } else entry.draft.text = text;
  if (reviewed) entry = core.setReviewStatus(entry, "reviewed", {now});
  const value = core.serializeBundle([entry], [patient]);
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value});
  await page.reload();
  await openVisit(page);
  return {patient, entry};
}
async function openVisit(page) {
  await click(page, "patients");
  await page.locator('[data-action="patient"][data-patient-id="finish-patient"]').first().click();
  await page.locator('#patient-history [data-action="open"][data-id="finish-visit"]').click();
  await chooseTab(page, "draft");
}
async function finish(page) {
  await click(page, "finish-visit");
  await dialog(page).waitFor({state: "visible"});
}

test("finish review leaves an untouched new form empty and closes it without warnings", {timeout: 12000}, async t => {
  const page = await openApp(t);
  await click(page, "new");
  await chooseTab(page, "draft");
  await click(page, "finish-visit");
  assert.equal(await dialog(page).isVisible(), false);
  assert.equal(await raw(page), null);
  assert.equal(await page.locator('#main-navigation [data-action="new"]').count(), 1);
});

for (const generated of [false, true]) {
  test("finish review accepts " + (generated ? "a current generated" : "a manual") + " text without requiring diagnosis or recommendations", {timeout: 12000}, async t => {
    const page = await openApp(t);
    await seed(page, {generated, reviewed: true});
    if (!generated) {
      await chooseTab(page, "history");
      await page.locator('[data-field="history.complaints"]').fill("ДЕМО: уточнено после ручной записи");
      await chooseTab(page, "draft");
    }
    const before = await saved(page);
    await click(page, "finish-visit");
    await page.locator("#patient-history").waitFor();
    assert.equal(await dialog(page).isVisible(), false);
    const after = await saved(page);
    assert.deepEqual(after.encounters, before.encounters);
    assert.equal(after.encounters[0].workflow.reviewStatus, generated ? "reviewed" : "draft");
    assert.equal(after.encounters[0].assessment.summary, "");
    assert.equal(after.encounters[0].assessment.plan, "");
  });
}

test("empty text warning supports cancel, Escape and explicit completion exactly once", {timeout: 18000}, async t => {
  const page = await openApp(t);
  await seed(page, {text: ""});
  const before = await saved(page);
  for (const cancel of ["button", "escape"]) {
    await finish(page);
    assert.equal(await page.locator("#finish-review-list li").count(), 1);
    assert.match(await page.locator("#finish-review-list").innerText(), /Текст записи пуст/);
    assert.equal(await page.locator("#finish-review-cancel").evaluate(node => node === document.activeElement), true);
    if (cancel === "button") await page.locator("#finish-review-cancel").click();
    else await page.keyboard.press("Escape");
    assert.equal(await dialog(page).isVisible(), false);
    assert.equal(await page.locator("#draft-text").evaluate(node => node === document.activeElement), true);
    assert.deepEqual((await saved(page)).encounters, before.encounters);
  }
  await finish(page);
  await page.locator("#finish-review-accept").evaluate(node => { node.click(); node.click(); });
  await page.locator("#patient-history").waitFor();
  assert.equal(await dialog(page).isVisible(), false);
  assert.deepEqual((await saved(page)).encounters, before.encounters);
  assert.equal(await page.locator('#main-navigation [data-action="new"]').count(), 1);
});

test("stale generated text is explained and remains byte-for-byte unchanged after completion with remarks", {timeout: 18000}, async t => {
  const page = await openApp(t);
  await seed(page, {generated: true});
  const text = await page.locator("#draft-text").inputValue() + "\nДЕМО: ручное дополнение врача.";
  await page.locator("#draft-text").fill(text);
  await chooseTab(page, "history");
  await page.locator('[data-field="history.complaints"]').fill("ДЕМО: сведения обновлены");
  await chooseTab(page, "draft");
  const before = await saved(page);
  await finish(page);
  assert.match(await page.locator("#finish-review-list").innerText(), /изменились после формирования/);
  await page.locator('#finish-review-list [data-finish-issue="0"]').click();
  assert.equal(await page.locator("#draft-text").evaluate(node => node === document.activeElement), true);
  assert.equal(await page.locator("#draft-text").inputValue(), text);
  await finish(page);
  await page.locator("#finish-review-accept").click();
  await page.locator("#patient-history").waitFor();
  const after = await saved(page);
  assert.deepEqual(after.encounters, before.encounters);
  assert.equal(after.encounters[0].draft.text, text);
  assert.equal(after.encounters[0].assessment.returnVisitDate, "2032-04-22");
});

test("technical validation and incomplete sick leave dates link to their fields with a readable narrow dialog", {timeout: 18000}, async t => {
  const page = await openApp(t);
  await seed(page, {sick: true});
  await page.setViewportSize({width: 390, height: 844});
  await chooseTab(page, "exam");
  await page.locator('[data-field="vitals.pulse"]').fill("-1");
  await chooseTab(page, "draft");
  await finish(page);
  const items = page.locator("#finish-review-list li");
  assert.equal(await items.count(), 3);
  assert.match(await items.nth(0).innerText(), /Пульс.*отрицательным/s);
  assert.match(await items.nth(1).innerText(), /дата начала не указана/);
  assert.match(await items.nth(2).innerText(), /дата окончания не указана/);
  assert.equal(await dialog(page).evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  assert.equal(await page.locator("#finish-review-accept").evaluate(node => {
    const rect = node.getBoundingClientRect(), modal = document.getElementById("finish-review-dialog").getBoundingClientRect();
    return rect.left >= modal.left && rect.right <= modal.right;
  }), true);
  await items.nth(0).locator("button").click();
  assert.equal(await page.locator('[data-field="vitals.pulse"]').evaluate(node => node === document.activeElement && !node.closest("details:not([open])")), true);
  await page.locator('[data-field="vitals.pulse"]').fill("72");
  await chooseTab(page, "draft");
  await finish(page);
  await page.locator("#finish-review-list li").nth(1).locator("button").click();
  assert.equal(await page.locator('[data-field="assessment.sickLeaveTo"]').evaluate(node => node === document.activeElement), true);
  assert.equal(await page.locator("#sickleave-period").isVisible(), true);
});

test("invalid values cannot be persisted through completion with remarks and remain in the form", {timeout: 14000}, async t => {
  const page = await openApp(t);
  await seed(page);
  const before = await raw(page);
  await chooseTab(page, "basic");
  await page.locator('[data-field="age"]').fill("-1");
  await chooseTab(page, "draft");
  await finish(page);
  await page.locator("#finish-review-accept").click();
  assert.equal(await dialog(page).isVisible(), true);
  assert.match(await page.locator("#finish-review-error").innerText(), /сохранить/i);
  assert.equal(await raw(page), before);
  await page.locator("#finish-review-list li button").first().click();
  assert.equal(await page.locator('[data-field="age"]').inputValue(), "-1");
  assert.equal(await page.locator('#main-navigation [data-action="visit"]').count(), 1);
});

test("storage failure during confirmation keeps the modal and retry preserves data without duplicates", {timeout: 16000}, async t => {
  const page = await openApp(t);
  await seed(page, {text: ""});
  const before = await saved(page);
  await finish(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    window.restoreFinishStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException("ДЕМО: хранилище заполнено", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, key);
  await page.locator("#finish-review-accept").click();
  assert.equal(await dialog(page).isVisible(), true);
  assert.equal(await page.locator("#finish-review-error").isVisible(), true);
  assert.equal(await page.locator("#finish-review-accept").isEnabled(), true);
  assert.deepEqual((await saved(page)).encounters, before.encounters);
  await page.evaluate(() => window.restoreFinishStorage());
  await page.locator("#finish-review-accept").click();
  await page.locator("#patient-history").waitFor();
  assert.deepEqual((await saved(page)).encounters, before.encounters);
  assert.equal((await saved(page)).patients.length, 1);
});

test("another window changing data while finish review is open visibly blocks stale completion", {timeout: 18000}, async t => {
  const page = await openApp(t);
  await seed(page, {text: ""});
  await finish(page);
  const other = await page.context().newPage();
  await other.goto(url); await enterPolyclinic(other);
  await openVisit(other);
  await other.locator("#draft-text").fill("ДЕМО: сохранено из второго окна");
  await page.locator("#finish-review-error").waitFor({state: "visible"});
  assert.match(await page.locator("#finish-review-error").innerText(), /другом окне/);
  assert.equal(await page.locator("#finish-review-accept").isDisabled(), true);
  const latest = await raw(page);
  await page.locator("#finish-review-accept").evaluate(node => node.dispatchEvent(new MouseEvent("click", {bubbles: true})));
  assert.equal(await raw(page), latest);
  assert.equal(await dialog(page).isVisible(), true);
  await page.locator("#finish-review-cancel").click();
  assert.equal(await page.locator("#draft-text").inputValue(), "");
  assert.equal(await page.locator('#main-navigation [data-action="visit"]').count(), 1);
});

test("changed current data requires a fresh review instead of accepting an outdated warning list", {timeout: 14000}, async t => {
  const page = await openApp(t);
  await seed(page, {text: ""});
  await finish(page);
  await page.locator('[data-field="assessment.plan"]').evaluate(node => {
    node.value = "ДЕМО: изменено во время проверки";
    node.dispatchEvent(new Event("input", {bubbles: true}));
  });
  const latest = await saved(page);
  await page.locator("#finish-review-accept").click();
  assert.equal(await dialog(page).isVisible(), true);
  assert.match(await page.locator("#finish-review-error").innerText(), /изменились после открытия/);
  assert.equal(await page.locator("#finish-review-accept").isDisabled(), true);
  assert.deepEqual((await saved(page)).encounters, latest.encounters);
  await page.locator("#finish-review-cancel").click();
  await finish(page);
  await page.locator("#finish-review-accept").click();
  await page.locator("#patient-history").waitFor();
  assert.deepEqual((await saved(page)).encounters, latest.encounters);
});
