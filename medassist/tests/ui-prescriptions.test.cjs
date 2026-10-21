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
const patientId = "fictional-prescription-patient";
const firstId = "fictional-prescription-first";
const manual = "ДЕМО: сохранённый врачом текст для проверки назначений.";
const fields = ["name", "dose", "route", "frequency", "duration", "note"];
const prescription = {
  name: "ДЕМО препарат Альфа <условный>",
  dose: "ДЕМО: доза А",
  route: "ДЕМО: способ А",
  frequency: "ДЕМО: кратность А",
  duration: "ДЕМО: срок А",
  note: "ДЕМО: собственное уточнение."
};
const action = (page, name) => page.locator('[data-action="' + name + '"]').first();
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const entry = async (page, id = firstId) => (await saved(page)).encounters.find(item => item.id === id);
const accept = page => page.locator("#dialog-accept").click();
const row = (page, id) => page.locator('.prescription-row[data-prescription-id="' + id + '"]');

async function openApp(t) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MEDASSIST_BROWSER ? {executablePath: process.env.MEDASSIST_BROWSER} : {channel: "msedge"}),
    args: ["--no-first-run", "--disable-background-networking"]
  });
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: {width: 1366, height: 900}, timezoneId: "Europe/Minsk"});
  context.setDefaultTimeout(5000);
  await context.setOffline(true);
  const errors = [], requests = [];
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  });
  t.after(() => {
    assert.deepEqual(errors, [], "no uncaught application errors");
    assert.deepEqual(requests, [], "prescriptions work offline");
  });
  const newPage = async () => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(now));
    await page.goto(url); await enterPolyclinic(page);
    await action(page, "patients").waitFor();
    return page;
  };
  return {page: await newPage(), newPage};
}

function visit(id = firstId, date = "2032-04-19") {
  const result = core.createEncounter({id, patientId, now: date + "T08:00:00.000Z"});
  result.history.complaints = "ДЕМО: вымышленные жалобы.";
  result.history.medications = "ДЕМО: прежний постоянный препарат";
  result.history.allergies = "ДЕМО: уточнение аллергологического анамнеза";
  result.history.conditions = "ДЕМО: заболевание в анамнезе";
  result.assessment.summary = "ДЕМО: условный диагноз";
  result.assessment.plan = "ДЕМО: рекомендации свободным текстом";
  result.assessment.returnVisitDate = "2032-04-30";
  result.draft = {text: manual, generatedAt: now, sourceFingerprint: core.fingerprint(result)};
  return result;
}

async function seed(page, visits = [visit()], templates = []) {
  const patient = core.createPatient({id: patientId, label: "Тестова Полина Вымышленная", now});
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {
    key, value: core.serializeBundle(visits, [patient], templates)
  });
  await page.reload();
}

async function openCard(page) {
  await click(page, "patients");
  await page.locator('.patient-row[data-patient-id="' + patientId + '"] [data-action="patient"]').click();
}

async function openVisit(page, id = firstId) {
  await openCard(page);
  await page.locator('#patient-history [data-action="open"][data-id="' + id + '"]').click();
  await page.locator('[data-action="tab"][data-tab="draft"]').first().click();
  await page.locator("#prescription-list").waitFor({state: "visible"});
}

async function fillForm(page, values) {
  for (const name of fields) await page.locator("#prescription-" + name).fill(values[name] || "");
}

async function saveForm(page) {
  await page.locator("#prescription-save").click();
  await page.locator("#prescription-dialog").waitFor({state: "hidden"});
}

async function add(page, values = prescription) {
  await click(page, "prescription-add");
  await fillForm(page, values);
  await saveForm(page);
}

test("opening and cancelling prescriptions keeps a new card empty; explicit save creates exactly one patient and encounter", {timeout: 18000}, async t => {
  const {page} = await openApp(t);
  await click(page, "new");
  await page.locator('[data-action="tab"][data-tab="draft"]').first().click();
  const before = await raw(page);
  await click(page, "prescription-add");
  await fillForm(page, prescription);
  await page.locator("#prescription-cancel").click();
  assert.equal(await raw(page), before);
  await click(page, "prescription-add");
  await fillForm(page, {...prescription, name: "   "});
  await page.locator("#prescription-save").click();
  assert.equal(await raw(page), before);
  assert.equal(await page.locator("#prescription-error").isVisible(), true);
  await page.locator("#prescription-name").fill(prescription.name);
  await saveForm(page);
  const bundle = await saved(page);
  assert.equal(bundle.patients.length, 1);
  assert.equal(bundle.encounters.length, 1);
  assert.equal(bundle.encounters[0].prescriptions.length, 1);
  assert.equal(bundle.encounters[0].prescriptions[0].name, prescription.name);
  assert.equal(bundle.encounters[0].history.medications, "");
  assert.equal(await page.locator("#prescription-list условный").count(), 0, "name is escaped text");
});

test("multiple prescriptions edit and delete explicitly, reset review and retain the manual draft", {timeout: 22000}, async t => {
  const {page} = await openApp(t);
  const source = core.setReviewStatus(visit(), "reviewed", {now});
  await seed(page, [source]); await openVisit(page);
  await add(page);
  const first = (await entry(page)).prescriptions[0];
  assert.equal((await entry(page)).workflow.reviewStatus, "draft");
  assert.equal((await entry(page)).draft.text, manual);
  assert.match(await page.locator("#draft-state").getAttribute("class"), /stale/);
  await add(page, {...prescription, name: "ДЕМО препарат Бета", note: ""});
  assert.equal((await entry(page)).prescriptions.length, 2);
  await row(page, first.id).locator('[data-action="prescription-edit"]').click();
  await page.locator("#prescription-dose").fill("ДЕМО: изменённая доза");
  await saveForm(page);
  const changed = await entry(page);
  assert.equal(changed.prescriptions[0].id, first.id);
  assert.equal(changed.prescriptions[0].dose, "ДЕМО: изменённая доза");
  assert.equal(changed.prescriptions.length, 2);
  assert.equal(changed.draft.text, manual);
  assert.deepEqual(changed.history, source.history);
  const beforeDelete = await raw(page);
  await row(page, first.id).locator('[data-action="prescription-delete"]').click();
  await page.locator("#dialog-cancel").click();
  assert.equal(await raw(page), beforeDelete);
  await row(page, first.id).locator('[data-action="prescription-delete"]').click(); await accept(page);
  assert.equal((await entry(page)).prescriptions.length, 1);
  assert.equal((await entry(page)).prescriptions[0].name, "ДЕМО препарат Бета");
  await page.reload(); await openVisit(page);
  assert.equal(await page.locator("#prescription-list .prescription-row").count(), 1);
  assert.equal(await page.locator("#draft-text").inputValue(), manual);
});

test("generated prescription text states entered and missing parameters and leaves return date last", {timeout: 18000}, async t => {
  const {page} = await openApp(t);
  await seed(page); await openVisit(page);
  await add(page);
  await add(page, {name: "ДЕМО препарат без режима", dose: "   ", route: "   ", note: "   "});
  const incompleteRow = (await entry(page)).prescriptions[1];
  assert.equal(await row(page, incompleteRow.id).locator(".prescription-missing").count(), 4, "spaces are visibly missing parameters");
  assert.equal(await row(page, incompleteRow.id).locator(".prescription-note").count(), 0, "blank note is omitted");
  await click(page, "generate"); await accept(page);
  const draft = await page.locator("#draft-text").inputValue();
  assert.match(draft, /Назначения препаратов/i);
  for (const value of Object.values(prescription)) assert.ok(draft.includes(value), value);
  const incomplete = draft.slice(draft.indexOf("ДЕМО препарат без режима"));
  assert.match(incomplete, /не указан/);
  assert.match(draft.trim().split("\n").at(-1), /30\.04\.2032/);
  assert.match(draft, /Рекомендации: ДЕМО: рекомендации свободным текстом/);
  const items = (await entry(page)).prescriptions;
  for (const item of items) {
    await row(page, item.id).locator('[data-action="prescription-delete"]').click(); await accept(page);
  }
  assert.equal(Object.hasOwn(await entry(page), "prescriptions"), false);
  assert.equal(await page.locator("#draft-text").inputValue(), draft);
  await click(page, "generate"); await accept(page);
  assert.doesNotMatch(await page.locator("#draft-text").inputValue(), /Назначения препаратов/i);
});

test("repeat encounter copies only selected prescriptions after explicit confirmation and keeps history consent independent", {timeout: 25000}, async t => {
  const {page} = await openApp(t);
  let source = core.upsertPrescription(visit(), prescription);
  source = core.upsertPrescription(source, {...prescription, name: "ДЕМО препарат Бета"});
  let older = core.upsertPrescription(visit("fictional-prescription-older", "2032-04-17"), {...prescription, name: "ДЕМО старое назначение"});
  await seed(page, [source, older]); await openCard(page);
  await click(page, "repeat");
  assert.equal(await page.locator('#repeat-prescriptions input[name="carry-prescription"]:checked').count(), 0);
  await page.locator('#repeat-prescriptions input[name="carry-prescription"][value="' + source.prescriptions[0].id + '"]').check();
  await page.locator("#repeat-source").selectOption(older.id);
  assert.equal(await page.locator('#repeat-prescriptions input[name="carry-prescription"]:checked').count(), 0);
  await page.locator("#repeat-source").selectOption(source.id);
  assert.equal(await page.locator('#repeat-prescriptions input[name="carry-prescription"]:checked').count(), 0);
  const beforeCancel = await raw(page);
  await page.locator("#repeat-cancel").click();
  assert.equal(await raw(page), beforeCancel);
  await click(page, "repeat");
  await page.locator("#repeat-create").click();
  const empty = (await saved(page)).encounters.find(item => item.id !== source.id && item.id !== older.id);
  assert.equal((empty.prescriptions || []).length, 0);
  assert.equal(empty.history.medications, "");
  await openCard(page); await click(page, "repeat");
  await page.locator("#repeat-source").selectOption(source.id);
  await page.locator('#repeat-prescriptions input[name="carry-prescription"][value="' + source.prescriptions[1].id + '"]').check();
  await page.locator('#repeat-fields input[name="carry-history"][value="allergies"]').check();
  const beforeIds = new Set((await saved(page)).encounters.map(item => item.id));
  await page.locator("#repeat-create").click();
  const carried = (await saved(page)).encounters.find(item => !beforeIds.has(item.id));
  assert.equal(carried.prescriptions.length, 1);
  assert.equal(carried.prescriptions[0].name, "ДЕМО препарат Бета");
  assert.notEqual(carried.prescriptions[0].id, source.prescriptions[1].id);
  assert.equal(carried.history.medications, "");
  assert.equal(carried.history.conditions, "");
  assert.equal(carried.history.allergies, source.history.allergies);
  assert.equal(carried.assessment.plan, "");
  assert.equal(carried.draft.text, "");
  assert.deepEqual(await entry(page, source.id), source);
});

test("prescriptions are searchable, visible read-only in previous visit and included in backup restore", {timeout: 22000}, async t => {
  const {page, newPage} = await openApp(t);
  const source = core.upsertPrescription(visit(), {...prescription, note: "ДЕМО: маркерпоисканазначения"});
  const next = visit("fictional-prescription-next", "2032-04-23");
  await seed(page, [source, next]);
  await click(page, "patients");
  await page.locator("#patient-search").fill("маркерпоисканазначения");
  assert.equal(await page.locator('.patient-row[data-patient-id="' + patientId + '"]').count(), 1);
  await page.locator("#patient-search").fill("");
  await openVisit(page, next.id);
  const before = await raw(page);
  await click(page, "previous-visit");
  assert.match(await page.locator("#previous-visit-panel").innerText(), /ДЕМО препарат Альфа <условный>/);
  assert.equal(await raw(page), before);
  assert.equal((await entry(page, next.id)).history.medications, next.history.medications);
  assert.equal((await entry(page, next.id)).prescriptions, undefined);
  await click(page, "help");
  const download = page.waitForEvent("download");
  await click(page, "backup");
  const file = await download;
  const chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const restored = await newPage(); await click(restored, "help");
  await restored.locator("#import-file").setInputFiles({name: "fictional-prescriptions.json", mimeType: "application/json", buffer});
  await accept(restored); await openVisit(restored);
  assert.deepEqual((await entry(restored)).prescriptions, source.prescriptions);
  assert.equal(await row(restored, source.prescriptions[0].id).count(), 1);
});

test("failed save retains prescription inputs and stale windows cannot overwrite or duplicate them", {timeout: 22000}, async t => {
  const {page, newPage} = await openApp(t);
  await seed(page); await openVisit(page);
  const other = await newPage(); await openVisit(other);
  for (const target of [page, other]) {
    await click(target, "prescription-add"); await fillForm(target, prescription);
  }
  const before = await raw(page);
  await page.evaluate(key => {
    window.demoRestoreRxStorage = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("ДЕМО: хранилище заполнено", "QuotaExceededError");
      return window.demoRestoreRxStorage.call(this, name, value);
    };
  }, key);
  await page.locator("#prescription-save").click();
  assert.equal(await raw(page), before);
  for (const name of fields) assert.equal(await page.locator("#prescription-" + name).inputValue(), prescription[name]);
  assert.equal(await page.locator("#prescription-error").isVisible(), true);
  await page.evaluate(() => { Storage.prototype.setItem = window.demoRestoreRxStorage; delete window.demoRestoreRxStorage; });
  await saveForm(page);
  await other.locator("#prescription-error").waitFor({state: "visible"});
  await other.locator("#prescription-save").click();
  assert.match(await other.locator("#prescription-error").innerText(), /другом окне/);
  assert.equal((await entry(page)).prescriptions.length, 1);
  assert.equal((await entry(page)).draft.text, manual);
});

test("recommendation template application preserves prescriptions and their responsive controls remain usable", {timeout: 22000}, async t => {
  const {page} = await openApp(t);
  const source = core.upsertPrescription(visit(), prescription);
  const sample = visit("fictional-template-source");
  sample.assessment.plan = "ДЕМО: отдельный текст шаблона";
  const template = core.createVisitTemplate(sample, {kind: "recommendations", name: "Демо-шаблон"});
  await seed(page, [source], [template]); await openVisit(page);
  await page.locator('[data-action="visit-templates"][data-template-kind="recommendations"]').click();
  await page.locator("#template-select").selectOption(template.id);
  await page.locator("#template-apply").click(); await accept(page);
  await page.locator("#template-dialog").waitFor({state: "hidden"});
  assert.deepEqual((await entry(page)).prescriptions, source.prescriptions);
  assert.equal((await entry(page)).assessment.plan, sample.assessment.plan);
  for (const width of [1366, 800, 390]) {
    await page.setViewportSize({width, height: 900});
    await row(page, source.prescriptions[0].id).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no page overflow at " + width);
    await row(page, source.prescriptions[0].id).locator('[data-action="prescription-edit"]').click();
    const bounds = await page.locator("#prescription-dialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, "dialog fits at " + width);
    await page.locator("#prescription-note").fill("ДЕМО: отменённое уточнение");
    await page.locator("#prescription-cancel").click();
    assert.deepEqual((await entry(page)).prescriptions, source.prescriptions);
  }
});

test("stale confirmation cannot delete a prescription saved by another window", {timeout: 20000}, async t => {
  const {page, newPage} = await openApp(t);
  const source = core.upsertPrescription(visit(), prescription);
  await seed(page, [source]); await openVisit(page);
  const other = await newPage(); await openVisit(other);
  await row(other, source.prescriptions[0].id).locator('[data-action="prescription-delete"]').click();
  await row(page, source.prescriptions[0].id).locator('[data-action="prescription-edit"]').click();
  await page.locator("#prescription-note").fill("ДЕМО: новое уточнение из первого окна");
  await saveForm(page);
  await accept(other);
  assert.equal((await entry(page)).prescriptions.length, 1);
  assert.equal((await entry(page)).prescriptions[0].note, "ДЕМО: новое уточнение из первого окна");
  assert.match(await other.locator("#toast").innerText(), /другом окне/);
  assert.equal(await other.locator("#toast").isVisible(), true);
});
