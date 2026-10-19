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
const patientId = "demo-leave-patient";
const visitId = "demo-leave-visit";
const manualDraft = "ДЕМО: вымышленная запись. Этот текст врач изменил и проверил вручную.";
const click = (page, action) => page.locator('[data-action="' + action + '"]').first().click();
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const savedPatient = async page => (await saved(page)).patients.find(patient => patient.id === patientId);
const leaves = async page => (await savedPatient(page)).sickLeaves || [];
const dialog = page => page.locator("#sick-leave-dialog");
const row = (page, id) => page.locator('.sick-leave-entry[data-leave-id="' + id + '"]');
const total = async page => Number((await page.locator("#sick-leave-total").innerText()).match(/\d+/)?.[0]);

async function openApp(t) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MEDASSIST_BROWSER ? { executablePath: process.env.MEDASSIST_BROWSER } : { channel: "msedge" }),
    args: ["--no-first-run", "--disable-background-networking"]
  });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Europe/Minsk" });
  await context.setOffline(true);
  context.setDefaultTimeout(5000);
  const errors = [], requests = [];
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  });
  t.after(() => {
    assert.deepEqual(errors, [], "no page errors");
    assert.deepEqual(requests, [], "journal operates without HTTP requests");
  });
  const newPage = async () => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(now));
    await page.goto(url);
    return page;
  };
  return { page: await newPage(), newPage };
}

async function seed(page, { existingLeave = false, legacy = false } = {}) {
  let patient = core.createPatient({ id: patientId, label: "Тестова Анна Вымышленная", now });
  let entry = core.createEncounter({ id: visitId, patientId, now });
  entry.visitDate = "2032-04-01";
  entry.history.complaints = "Вымышленные жалобы для проверки журнала.";
  entry.draft.text = manualDraft;
  if (legacy) Object.assign(entry.assessment, {
    sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-СТАРЫЙ-015", sickLeaveFrom: "2032-04-01", sickLeaveTo: "2032-04-05"
  });
  entry = core.setReviewStatus(entry, "reviewed", { now });
  const encounters = [entry];
  if (legacy) {
    const partial = core.createEncounter({ id: "demo-leave-partial", patientId, now });
    partial.visitDate = "2032-04-02";
    Object.assign(partial.assessment, { sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-УТОЧНИТЬ", sickLeaveFrom: "2032-04-06" });
    encounters.push(partial);
  }
  if (existingLeave) patient = core.issueSickLeave(patient, {
    number: "ДЕМО-ОСНОВНОЙ-032", from: "2032-04-01", to: "2032-04-20", id: "demo-leave-existing", eventId: "demo-leave-issued", now
  }, encounters);
  const initial = core.serializeBundle(encounters, [patient]);
  await page.evaluate(({ key, initial }) => localStorage.setItem(key, initial), { key, initial });
  await page.reload();
  await openCard(page);
  return { initial, encounters };
}

async function openCard(page) {
  await click(page, "patients");
  await page.locator('.patient-row[data-patient-id="' + patientId + '"] [data-action="patient"]').click();
  await page.locator("#sick-leave-journal").waitFor();
}

async function period(page, from, to) {
  await page.locator("#sick-leave-from").fill(from);
  await page.locator("#sick-leave-to").fill(to);
}

async function saveDialog(page) {
  await page.locator("#sick-leave-save").click();
  await dialog(page).waitFor({ state: "hidden" });
}

async function issue(page, number, from, to) {
  await click(page, "sick-issue");
  await page.locator("#sick-leave-number").fill(number);
  await period(page, from, to);
  await saveDialog(page);
  return (await leaves(page)).at(-1).id;
}

async function extend(page, id, from, to) {
  await row(page, id).locator('[data-action="sick-extend"]').click();
  await period(page, from, to);
  await saveDialog(page);
}

async function closeLeave(page, id, date) {
  await row(page, id).locator('[data-action="sick-close"]').click();
  await page.locator("#sick-leave-close-date").fill(date);
  await saveDialog(page);
}

test("sick leave issue, overlapping extension, closure and undo retain history and count each calendar day once", { timeout: 25000 }, async t => {
  const { page } = await openApp(t);
  const { encounters } = await seed(page);
  const first = await issue(page, "ДЕМО-032 <первый>", "2032-04-01", "2032-04-05");
  assert.equal(await total(page), 5);
  assert.match(await row(page, first).innerText(), /ДЕМО-032 <первый>/, "manually entered numbers remain plain text");
  assert.equal(await row(page, first).locator("первый").count(), 0);
  await extend(page, first, "2032-04-04", "2032-04-08");
  assert.equal(await total(page), 8, "Apr 4–5 are already included in the issue period");
  assert.deepEqual((await leaves(page))[0].events.map(event => event.type), ["issue", "extend"]);
  await closeLeave(page, first, "2032-04-07");
  assert.equal(await total(page), 7, "closing on Apr 7 excludes the previously planned Apr 8");
  assert.match(await row(page, first).innerText(), /Закрыт/i);
  await row(page, first).locator(".sick-leave-events summary").click();
  assert.deepEqual(await row(page, first).locator(".sick-leave-events li strong").allTextContents(), ["Выдача", "Продление", "Закрытие"]);
  assert.match(await row(page, first).locator(".sick-leave-events li").nth(1).innerText(), /04\.04\.2032 — 08\.04\.2032/);
  const extendButton = row(page, first).locator('[data-action="sick-extend"]');
  assert.equal(await extendButton.count() === 0 || await extendButton.isDisabled() || !await extendButton.isVisible(), true, "closed leave cannot be extended directly");
  await row(page, first).locator('[data-action="sick-undo"]').click();
  await page.locator("#dialog-accept").click();
  assert.equal(await total(page), 8);
  assert.deepEqual((await leaves(page))[0].events.map(event => event.type), ["issue", "extend"]);
  assert.equal(await row(page, first).locator('[data-action="sick-extend"]').isEnabled(), true);
  await closeLeave(page, first, "2032-04-07");
  await issue(page, "ДЕМО-ВТОРОЙ", "2032-04-06", "2032-04-10");
  assert.equal(await total(page), 10, "overlap between distinct leave numbers is counted once in the patient's total");
  assert.equal((await leaves(page)).length, 2);
  assert.deepEqual((await saved(page)).encounters, encounters, "journal actions create no encounter and do not change reviewed or manual notes");
  await page.reload(); await openCard(page);
  assert.equal(await total(page), 10);
  assert.equal(await page.locator(".sick-leave-entry").count(), 2);
  assert.match(await row(page, first).innerText(), /Закрыт/i);
});

test("opening, cancelling and rejecting invalid journal actions never creates an empty episode or modifies the patient", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  const { initial } = await seed(page);
  await click(page, "sick-issue");
  assert.equal(await raw(page), initial);
  await page.locator("#sick-leave-number").fill("ДЕМО-ОТМЕНА");
  await period(page, "2032-04-10", "2032-04-09");
  await page.locator("#sick-leave-save").click();
  assert.equal(await dialog(page).isVisible(), true);
  assert.equal(await page.locator("#sick-leave-error").isVisible(), true);
  assert.ok((await page.locator("#sick-leave-error").innerText()).trim());
  assert.equal(await raw(page), initial);
  await page.locator("#sick-leave-cancel").click();
  assert.equal(await dialog(page).isVisible(), false);
  assert.equal(await raw(page), initial);
  assert.equal(await page.locator(".sick-leave-entry").count(), 0);
  assert.equal(await total(page), 0);
});

test("legacy visit marks remain visible until explicit adoption and never inflate the journal total", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  const { initial, encounters } = await seed(page, { legacy: true });
  const legacy = page.locator('.sick-leave-legacy[data-encounter-id="' + visitId + '"]');
  const partial = page.locator('.sick-leave-legacy[data-encounter-id="demo-leave-partial"]');
  assert.equal(await total(page), 5);
  assert.equal(await legacy.isVisible(), true);
  assert.equal(await partial.isVisible(), true);
  assert.match(await partial.innerText(), /уточн/i);
  assert.equal(await partial.locator('[data-action="sick-adopt"]').count(), 0, "incomplete historical periods cannot silently become a journal issue");
  assert.equal(await raw(page), initial, "displaying old marks is read only");
  await legacy.locator('[data-action="sick-adopt"]').click();
  assert.equal(await page.locator("#sick-leave-number").inputValue(), "ДЕМО-СТАРЫЙ-015");
  for (const selector of ["#sick-leave-number", "#sick-leave-from", "#sick-leave-to"]) {
    assert.equal(await page.locator(selector).evaluate(node => node.readOnly), true);
  }
  await page.locator("#sick-leave-cancel").click();
  assert.equal(await raw(page), initial);
  await legacy.locator('[data-action="sick-adopt"]').click();
  await saveDialog(page);
  const adopted = (await leaves(page))[0];
  assert.equal(adopted.sourceEncounterId, visitId);
  assert.equal(await legacy.count(), 0);
  assert.equal(await total(page), 5, "the source mark is not counted in addition to its adopted issue");
  await extend(page, adopted.id, "2032-04-04", "2032-04-08");
  assert.equal(await total(page), 8);
  assert.deepEqual((await saved(page)).encounters, encounters, "adoption preserves the historical mark, manual draft and review status");
});

test("a journal backup restores actions, totals and reviewed manual records in a fresh browser context", { timeout: 25000 }, async t => {
  const { page } = await openApp(t);
  const { encounters } = await seed(page);
  const id = await issue(page, "ДЕМО-КОПИЯ", "2032-04-01", "2032-04-05");
  await extend(page, id, "2032-04-04", "2032-04-08");
  await closeLeave(page, id, "2032-04-07");
  const expectedPatient = await savedPatient(page);
  await click(page, "help");
  const downloadReady = page.waitForEvent("download");
  await click(page, "backup");
  const stream = await (await downloadReady).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = Buffer.concat(chunks);
  const { page: restored } = await openApp(t);
  assert.equal(await raw(restored), null);
  await click(restored, "help");
  await restored.locator("#import-file").setInputFiles({ name: "MedAssist-demo-journal-backup.json", mimeType: "application/json", buffer: backup });
  await restored.locator("#dialog-accept").click();
  await restored.locator("#confirmation").waitFor({ state: "hidden" });
  await openCard(restored);
  assert.equal(await total(restored), 7);
  assert.deepEqual(await savedPatient(restored), expectedPatient);
  assert.deepEqual((await saved(restored)).encounters, encounters);
  assert.match(await row(restored, id).innerText(), /Закрыт/i);
});

test("a storage error keeps the entered journal period visible and leaves saved records unchanged", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  const { initial } = await seed(page);
  await click(page, "sick-issue");
  await page.locator("#sick-leave-number").fill("ДЕМО-НЕСОХРАНЁННЫЙ");
  await period(page, "2032-04-01", "2032-04-05");
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("ДЕМО: хранилище заполнено", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, key);
  await page.locator("#sick-leave-save").click();
  assert.equal(await raw(page), initial);
  assert.equal(await dialog(page).isVisible(), true);
  assert.equal(await page.locator("#sick-leave-number").inputValue(), "ДЕМО-НЕСОХРАНЁННЫЙ");
  assert.equal(await page.locator("#sick-leave-from").inputValue(), "2032-04-01");
  assert.equal(await page.locator("#sick-leave-to").inputValue(), "2032-04-05");
  assert.equal(await page.locator("#sick-leave-error").isVisible(), true);
  assert.match(await page.locator("#sick-leave-error").innerText(), /сохран/i);
  await page.locator("#sick-leave-cancel").click();
  assert.equal(await total(page), 0);
  assert.equal(await page.locator(".sick-leave-entry").count(), 0);
});

for (const operation of ["issue", "extend", "close"]) {
  test("two windows: pending sick leave " + operation + " displays its conflict inside the dialog without overwriting another edit", { timeout: 20000 }, async t => {
    const { page, newPage } = await openApp(t);
    await seed(page, { existingLeave: operation !== "issue" });
    if (operation === "issue") {
      await click(page, "sick-issue");
      await page.locator("#sick-leave-number").fill("ДЕМО-КОНФЛИКТ");
      await period(page, "2032-04-01", "2032-04-05");
    } else if (operation === "extend") {
      await row(page, "demo-leave-existing").locator('[data-action="sick-extend"]').click();
      await period(page, "2032-04-19", "2032-04-23");
    } else {
      await row(page, "demo-leave-existing").locator('[data-action="sick-close"]').click();
      await page.locator("#sick-leave-close-date").fill("2032-04-18");
    }
    const second = await newPage();
    await openCard(second);
    await second.locator('[data-action="open"][data-id="' + visitId + '"]').click();
    await second.locator('[data-action="tab"][data-tab="history"]').first().click();
    await second.locator('[data-field="history.complaints"]').fill("ДЕМО: новые жалобы введены в другом окне.");
    await page.waitForFunction(() => document.getElementById("storage-banner").textContent.includes("другом окне"));
    const latest = await raw(page);
    await page.locator("#sick-leave-save").click();
    assert.equal(await raw(page), latest);
    assert.equal(await dialog(page).isVisible(), true);
    const warning = page.locator("#sick-leave-error");
    assert.equal(await warning.isVisible(), true);
    assert.match(await warning.innerText(), /другом окне/i);
    const bounds = await warning.boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 900, "conflict is visible inside the active modal");
    assert.equal((await saved(page)).encounters.length, 1);
    assert.equal((await leaves(page)).length, operation === "issue" ? 0 : 1);
    if (operation !== "issue") assert.equal((await leaves(page))[0].events.length, 1);
  });
}

test("journal numbers are searchable and the patient sick-leave category responds to explicit closure", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page);
  const id = await issue(page, "ДЕМО-ИСКАТЬ-932", "2032-04-12", "2032-04-20");
  await click(page, "patients");
  await page.locator('#patient-search').fill("искать-932");
  assert.equal(await page.locator('.patient-row[data-patient-id="' + patientId + '"]').count(), 1);
  await page.locator('[data-action="patient-category"][data-category="sick"]').click();
  assert.equal(await page.locator('.patient-row[data-patient-id="' + patientId + '"]').count(), 1);
  await page.locator('.patient-row [data-action="patient"]').click();
  await row(page, id).locator('[data-action="sick-number"]').click();
  await page.locator("#sick-leave-number").fill("ДЕМО-УТОЧНЁННЫЙ-932");
  await saveDialog(page);
  assert.equal((await leaves(page))[0].events.length, 1, "correcting a number does not add a clinical period");
  assert.equal(await total(page), 9);
  await closeLeave(page, id, "2032-04-14");
  await click(page, "patients");
  await page.locator('[data-action="patient-category"][data-category="sick"]').click();
  assert.equal(await page.locator('.patient-row[data-patient-id="' + patientId + '"]').count(), 0);
  await page.locator('[data-action="patient-category"][data-category="all"]').click();
  await page.locator('#patient-search').fill("уточнённый-932");
  assert.equal(await page.locator('.patient-row[data-patient-id="' + patientId + '"]').count(), 1, "closed journal numbers remain searchable");
});

test("journal and its dialog fit narrow screens and support keyboard opening, cancellation and explicit save", { timeout: 25000 }, async t => {
  const { page } = await openApp(t);
  const { initial } = await seed(page);
  for (const width of [1366, 800, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await click(page, "sick-journal");
    await page.locator('[data-action="sick-issue"]').focus();
    await page.keyboard.press("Enter");
    assert.equal(await dialog(page).isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "page fits viewport " + width);
    assert.equal(await dialog(page).evaluate(node => node.scrollWidth <= node.clientWidth), true, "dialog has no horizontal overflow at " + width);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      assert.equal(await dialog(page).evaluate(node => node.contains(document.activeElement) || document.activeElement === document.body), true, "modal keyboard focus remains contained");
    }
    await page.keyboard.press("Escape");
    assert.equal(await dialog(page).isVisible(), false);
    assert.equal(await raw(page), initial);
  }
  await page.locator('[data-action="sick-issue"]').focus();
  await page.keyboard.press("Enter");
  await page.evaluate(() => new Promise(resolve => {
    document.getElementById("sick-leave-dialog").addEventListener("close", () => resolve(), { once: true });
    document.getElementById("sick-leave-cancel").click();
    document.querySelector('[data-action="sick-issue"]').click();
  }));
  assert.equal(await dialog(page).isVisible(), true, "a delayed close event must not reset a newly reopened form");
  await page.locator("#sick-leave-number").fill("ДЕМО-" + "Н".repeat(100));
  await period(page, "2032-04-15", "2032-04-15");
  await page.locator("#sick-leave-save").focus();
  await page.keyboard.press("Enter");
  await dialog(page).waitFor({ state: "hidden" });
  assert.equal(await total(page), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "long number wraps inside the narrow journal card");
});
