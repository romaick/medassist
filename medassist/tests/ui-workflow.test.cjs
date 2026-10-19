"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.MEDASSIST_PLAYWRIGHT || "playwright");

const appRoot = path.resolve(process.env.MEDASSIST_APP_ROOT || path.join(__dirname, "../app"));
const core = require(path.join(appRoot, "core.js"));
const url = pathToFileURL(path.join(appRoot, "index.html")).href;
const key = "medassist.demo.v4";
const now = "2032-04-15T07:00:00.000Z";
const today = "2032-04-15";
const click = (page, action) => page.locator('[data-action="' + action + '"]').first().click();
const tab = (page, name) => page.locator('[data-action="tab"][data-tab="' + name + '"]').first().click();
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const openVisit = (page, id) => page.locator('[data-action="open"][data-id="' + id + '"]').click();
const followup = (page, id) => page.locator('#followup-list [data-followup-id="' + id + '"]');
const followupAction = (page, id, action) => followup(page, id).locator('[data-action="' + action + '"]').click();
const filter = (page, kind, value) => page.locator('[data-action="' + kind + '-filter"][data-filter="' + value + '"]').click();
const accept = page => page.locator("#dialog-accept").click();
const cancel = page => page.locator("#dialog-cancel").click();

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
  const newPage = async () => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(now));
    await page.goto(url);
    return page;
  };
  return { page: await newPage(), newPage };
}

function fixture() {
  const patient = core.createPatient({ id: "demo-patient-a", now, label: "Тестова Анна Учебная" });
  const otherPatient = core.createPatient({ id: "demo-patient-b", now, label: "Тестов Борис Учебный" });
  const entry = (id, date = "", patientId = patient.id) => {
    const result = core.createEncounter({ id, patientId, now });
    result.assessment.returnVisitDate = date;
    result.draft.text = "ДЕМО: вымышленная запись " + id + ".";
    result.history.medications = "ДЕМО: сведения о препарате, подтвердить перед переносом.";
    return result;
  };
  return {
    patients: [patient, otherPatient],
    encounters: [entry("demo-today", today), entry("demo-future", "2032-04-18"), entry("demo-past", "2032-04-12"), entry("demo-empty"), entry("demo-other", "", otherPatient.id)]
  };
}

async function seed(page, data = fixture()) {
  const serialized = core.serializeBundle(data.encounters, data.patients);
  await page.evaluate(({ key, serialized }) => localStorage.setItem(key, serialized), { key, serialized });
  await page.reload();
  return data;
}

async function listedIds(page, selector, attribute) {
  return page.locator(selector).evaluateAll((rows, attribute) => rows.map(row => row.getAttribute(attribute)), attribute);
}

async function assertReview(page, id, status) {
  const entry = (await saved(page)).encounters.find(entry => entry.id === id);
  assert.equal(entry.workflow.reviewStatus, status);
  assert.equal(Boolean(entry.workflow.reviewedAt), status === "reviewed");
  assert.match(await page.locator("#record-review-state").innerText(), status === "reviewed" ? /Проверено врачом/ : /Черновик/);
}

async function markReviewed(page) {
  await click(page, "review-record");
  await accept(page);
}

async function assertVisibleWarning(page) {
  assert.equal(await page.locator("#confirmation").isVisible(), false, "the confirmation must close before showing the warning");
  assert.equal(await page.locator("#toast").isVisible(), true);
  assert.match(await page.locator("#toast").innerText(), /другом окне/);
  const hit = await page.locator("#toast").evaluate(node => {
    const box = node.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.id;
  });
  assert.equal(hit, "toast", "the warning is not covered by a modal");
}

test("follow-up dates are grouped without inferring attendance, with explicit completion and reopening", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  const initial = await seed(page);
  await click(page, "followups");
  for (const [bucket, ids] of [["today", ["demo-today"]], ["upcoming", ["demo-future"]], ["past", ["demo-past"]], ["completed", []]]) {
    await filter(page, "followup", bucket);
    assert.deepEqual(await listedIds(page, "#followup-list [data-followup-id]", "data-followup-id"), ids);
  }
  assert.equal((await saved(page)).encounters.find(entry => entry.id === "demo-past").workflow.returnVisitStatus, "planned");
  await filter(page, "followup", "past");
  const unchanged = await raw(page);
  await followupAction(page, "demo-past", "followup-complete");
  await cancel(page);
  assert.equal(await raw(page), unchanged, "cancel does not mark attendance");
  await followupAction(page, "demo-past", "followup-complete");
  await accept(page);
  const completed = (await saved(page)).encounters.find(entry => entry.id === "demo-past");
  assert.equal(completed.workflow.returnVisitStatus, "completed");
  assert.deepEqual(completed.draft, initial.encounters[2].draft);
  assert.equal(completed.workflow.reviewStatus, "draft");
  assert.equal(await followup(page, "demo-past").count(), 0);
  await filter(page, "followup", "completed");
  assert.equal(await followup(page, "demo-past").count(), 1);
  await page.reload(); await click(page, "followups"); await filter(page, "followup", "completed");
  assert.equal(await followup(page, "demo-past").count(), 1, "attendance survives reopening the program");
  await followupAction(page, "demo-past", "followup-reopen"); await cancel(page);
  assert.equal((await saved(page)).encounters.find(entry => entry.id === "demo-past").workflow.returnVisitStatus, "completed");
  await followupAction(page, "demo-past", "followup-reopen"); await accept(page);
  await filter(page, "followup", "past");
  assert.equal(await followup(page, "demo-past").count(), 1);
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "schedule fits width " + width);
  }
  await followupAction(page, "demo-past", "patient");
  assert.equal(await page.locator("#patient-heading").innerText(), initial.patients[0].label);
});

test("starting a scheduled repeat fixes its source and reopens one linked encounter without marking attendance", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page); await click(page, "followups");
  await followupAction(page, "demo-today", "start-followup");
  assert.equal(await page.locator("#repeat-source").inputValue(), "demo-today");
  assert.equal(await page.locator("#repeat-source").isDisabled(), true);
  assert.equal(await page.locator("#repeat-fields input:checked").count(), 0);
  await page.locator("#repeat-create").click();
  const data = await saved(page);
  assert.equal(data.encounters.length, 6);
  const source = data.encounters.find(entry => entry.id === "demo-today");
  const repeated = data.encounters.find(entry => entry.id === source.workflow.returnVisitEncounterId);
  assert.ok(repeated);
  assert.equal(repeated.patientId, source.patientId);
  assert.equal(repeated.history.medications, "", "the schedule does not bypass confirmation of carried history");
  assert.equal(repeated.draft.text, "");
  assert.equal(repeated.workflow.reviewStatus, "draft");
  assert.equal(source.workflow.returnVisitStatus, "planned", "starting a repeat does not imply attendance");
  await page.getByLabel("ФИО пациента", { exact: true }).fill("Тестова Анна После Повтора");
  await click(page, "followups"); await followupAction(page, "demo-today", "start-followup");
  assert.equal(await page.locator("#repeat-dialog").isVisible(), false);
  assert.equal((await saved(page)).encounters.length, 6);
  assert.equal(await page.getByLabel("ФИО пациента", { exact: true }).inputValue(), "Тестова Анна После Повтора");
  await tab(page, "draft"); await page.locator("#draft-text").fill("ДЕМО: продолжение именно связанного приёма.");
  assert.equal((await saved(page)).encounters.find(entry => entry.id === repeated.id).draft.text, "ДЕМО: продолжение именно связанного приёма.");
  await page.reload(); await click(page, "followups"); await followupAction(page, "demo-today", "start-followup");
  assert.equal((await saved(page)).encounters.length, 6, "reloading retains the link");
  await tab(page, "draft");
  assert.equal(await page.locator("#draft-text").inputValue(), "ДЕМО: продолжение именно связанного приёма.");
  await click(page, "home"); await openVisit(page, source.id); await tab(page, "draft");
  await page.locator('[data-field="assessment.returnVisitDate"]').fill("2032-04-20");
  const rescheduled = await saved(page);
  assert.equal(rescheduled.encounters.find(entry => entry.id === source.id).workflow.returnVisitEncounterId, "");
  assert.equal(rescheduled.encounters.length, 6, "changing the appointment date preserves the existing clinical record");
});

test("review is explicitly confirmed, filterable and persistent; editing text, fields and patient name resets the affected reviews", { timeout: 30000 }, async t => {
  const { page } = await openApp(t);
  const data = fixture();
  data.encounters[3].draft.text = "";
  await seed(page, data);
  await openVisit(page, "demo-empty"); await tab(page, "draft");
  const reviewEmpty = page.locator('[data-action="review-record"]');
  if (!await reviewEmpty.isDisabled()) await reviewEmpty.click();
  assert.equal(await page.locator("#confirmation").isVisible(), false, "an empty draft cannot be approved");
  await assertReview(page, "demo-empty", "draft");
  await click(page, "home"); await openVisit(page, "demo-today"); await tab(page, "draft");
  const unchanged = await raw(page);
  await click(page, "review-record"); await cancel(page);
  assert.equal(await raw(page), unchanged);
  await markReviewed(page); await assertReview(page, "demo-today", "reviewed");
  await page.reload(); await openVisit(page, "demo-today"); await tab(page, "draft");
  await assertReview(page, "demo-today", "reviewed");
  await click(page, "home"); await filter(page, "record", "reviewed");
  assert.deepEqual(await listedIds(page, "#visit-list [data-record-id]", "data-record-id"), ["demo-today"]);
  assert.match(await page.locator('#visit-list [data-record-id="demo-today"] .record-status').innerText(), /Проверено врачом/);
  await filter(page, "record", "draft");
  assert.equal(await page.locator('#visit-list [data-record-id="demo-today"]').count(), 0);
  assert.equal(await page.locator("#visit-list [data-record-id]").count(), 4);
  await filter(page, "record", "all"); await openVisit(page, "demo-today"); await tab(page, "draft");
  await click(page, "reopen-record"); await cancel(page); await assertReview(page, "demo-today", "reviewed");
  await click(page, "reopen-record"); await accept(page); await assertReview(page, "demo-today", "draft");
  await markReviewed(page);
  await page.locator("#draft-text").fill("ДЕМО: врач исправил текст после проверки.");
  await assertReview(page, "demo-today", "draft");
  await markReviewed(page); await tab(page, "history");
  await page.locator('[data-field="history.complaints"]').fill("ДЕМО: уточнённая жалоба.");
  await tab(page, "draft"); await assertReview(page, "demo-today", "draft");
  await markReviewed(page);
  await click(page, "home"); await openVisit(page, "demo-future"); await tab(page, "draft"); await markReviewed(page);
  await click(page, "home"); await openVisit(page, "demo-other"); await tab(page, "draft"); await markReviewed(page);
  await click(page, "home"); await openVisit(page, "demo-today");
  await page.getByLabel("ФИО пациента", { exact: true }).fill("Тестова Анна Уточнённая");
  const renamed = await saved(page);
  assert.equal(renamed.encounters.find(entry => entry.id === "demo-today").workflow.reviewStatus, "draft");
  assert.equal(renamed.encounters.find(entry => entry.id === "demo-future").workflow.reviewStatus, "draft");
  assert.equal(renamed.encounters.find(entry => entry.id === "demo-other").workflow.reviewStatus, "reviewed", "a different patient's review is unchanged");
  await tab(page, "draft");
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "review controls fit width " + width);
  }
});

test("normal examination and replacing generated text each return a reviewed record to draft", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page); await openVisit(page, "demo-today"); await tab(page, "draft");
  await markReviewed(page); await tab(page, "exam"); await click(page, "normal-exam");
  await tab(page, "draft"); await assertReview(page, "demo-today", "draft");
  await markReviewed(page); await click(page, "generate"); await cancel(page);
  await assertReview(page, "demo-today", "reviewed");
  await click(page, "generate"); await accept(page);
  await assertReview(page, "demo-today", "draft");
});

test("invalid clinical fields prevent review even when the draft text is nonempty", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page); await openVisit(page, "demo-today");
  await page.locator('[data-field="age"]').fill("ДЕМО: не число");
  await tab(page, "draft");
  const before = await raw(page);
  await click(page, "review-record");
  assert.equal(await page.locator("#confirmation").isVisible(), false);
  assert.equal(await raw(page), before, "invalid input cannot replace the saved record with a reviewed one");
  assert.equal((await saved(page)).encounters.find(entry => entry.id === "demo-today").workflow.reviewStatus, "draft");
});

test("scheduled dates remain accessible after an invalid clinical edit, with the save warning and original storage preserved", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page); await openVisit(page, "demo-today");
  const before = await raw(page);
  await page.locator('[data-field="age"]').fill("ДЕМО: не число");
  assert.equal(await raw(page), before);
  await click(page, "followups");
  assert.equal(await page.locator("#followup-list").isVisible(), true);
  assert.deepEqual(await listedIds(page, "#followup-list [data-followup-id]", "data-followup-id"), ["demo-today"]);
  assert.match(await followup(page, "demo-today").innerText(), /15\.04\.2032/);
  assert.equal(await page.locator("#storage-banner").isVisible(), true);
  assert.match(await page.locator("#storage-banner").innerText(), /[Нн]е удалось сохранить/);
  assert.equal(await raw(page), before, "opening the schedule must not replace the last valid save");
});

for (const operation of ["review", "attendance"]) {
  test("storage failure while confirming " + operation + " leaves both saved data and visible status unchanged", { timeout: 20000 }, async t => {
    const { page } = await openApp(t);
    await seed(page);
    if (operation === "review") {
      await openVisit(page, "demo-today"); await tab(page, "draft"); await click(page, "review-record");
    } else {
      await click(page, "followups"); await followupAction(page, "demo-today", "followup-complete");
    }
    const before = await raw(page);
    await page.evaluate(key => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException("ДЕМО: хранилище заполнено", "QuotaExceededError");
        return original.call(this, name, value);
      };
    }, key);
    await accept(page);
    assert.equal(await raw(page), before);
    const entry = (await saved(page)).encounters.find(entry => entry.id === "demo-today");
    assert.equal(entry.workflow.reviewStatus, "draft");
    assert.equal(entry.workflow.returnVisitStatus, "planned");
    assert.equal(await page.locator("#confirmation").isVisible(), false);
    assert.match(await page.locator("#toast").innerText(), /[Нн]е удалось сохранить/);
    if (operation === "review") await assertReview(page, "demo-today", "draft");
    else assert.equal(await followup(page, "demo-today").locator('[data-action="followup-complete"]').count(), 1);
  });
}

for (const operation of ["review", "attendance"]) {
  test("two windows: " + operation + " confirmation detects an intervening edit without a false status or hidden warning", { timeout: 20000 }, async t => {
    const { page, newPage } = await openApp(t);
    await seed(page);
    if (operation === "review") {
      await openVisit(page, "demo-today"); await tab(page, "draft"); await click(page, "review-record");
    } else {
      await click(page, "followups"); await followupAction(page, "demo-today", "followup-complete");
    }
    const second = await newPage(); await openVisit(second, "demo-today"); await tab(second, "history");
    await second.locator('[data-field="history.complaints"]').fill("ДЕМО: данные изменены во втором окне.");
    await page.waitForFunction(() => document.getElementById("storage-banner").textContent.includes("другом окне"));
    const latest = await raw(page);
    await accept(page);
    assert.equal(await raw(page), latest, "confirmation must not overwrite the other window");
    const entry = (await saved(page)).encounters.find(entry => entry.id === "demo-today");
    assert.equal(entry.workflow.reviewStatus, "draft");
    assert.equal(entry.workflow.returnVisitStatus, "planned");
    assert.equal((await saved(page)).encounters.length, 5);
    await assertVisibleWarning(page);
  });
}
