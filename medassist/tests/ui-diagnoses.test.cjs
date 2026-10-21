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
const patientId = "fictional-diagnoses-patient";
const visitId = "fictional-diagnoses-visit";
const legacyText = "ДЕМО: прежняя формулировка врача (Z00.0)\nДЕМО: собственное уточнение.";
const manual = "ДЕМО: ручной текст записи, который нельзя заменить автоматически.";
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const savedVisit = async (page, id = visitId) => (await saved(page)).encounters.find(item => item.id === id);
const row = (page, id) => page.locator('.diagnosis-row[data-diagnosis-id="' + id + '"]');
const accept = page => page.locator("#dialog-accept").click();
const codeOption = (page, code) => page.locator('#diagnosis-edit-options [role="option"][data-code="' + code + '"]');

test("an unresolved birth-date error remains visible and blocks a diagnosis save without replacing valid dates", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const patient = core.createPatient({id: patientId, label: "ДЕМО Проверка Даты", birthDate: "1990-04-20", now});
  await seed(page, [visit()], [patient]);
  await openVisit(page);
  const before = await raw(page);
  await page.locator('[data-action="tab"][data-tab="basic"]').first().click();
  await page.locator("#patient-birth-date").fill("2040-01-01");
  await page.locator('[data-action="tab"][data-tab="draft"]').first().click();
  await click(page, "diagnosis-add");
  await fill(page, "comorbidity", "ДЕМО: условный диагноз");
  await page.locator("#diagnosis-save").click();
  assert.equal(await page.locator("#diagnosis-dialog").isVisible(), true);
  assert.match(await page.locator("#diagnosis-error").innerText(), /Дата рождения/);
  assert.equal(await raw(page), before);
  await page.locator("#diagnosis-cancel").click();
  await page.locator('[data-action="tab"][data-tab="basic"]').first().click();
  assert.equal(await page.locator("#patient-birth-date").inputValue(), "2040-01-01");
  await page.locator("#patient-birth-date").fill("1990-04-20");
  await page.locator('[data-action="tab"][data-tab="draft"]').first().click();
  await add(page, "comorbidity", "ДЕМО: условный диагноз");
  assert.equal((await savedVisit(page)).diagnoses.length, 2);
  assert.equal((await saved(page)).patients[0].birthDate, "1990-04-20");
});

async function openApp(t) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MEDASSIST_BROWSER ? {executablePath: process.env.MEDASSIST_BROWSER} : {channel: "msedge"}),
    args: ["--no-first-run", "--disable-background-networking"]
  });
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: {width: 1366, height: 1000}, timezoneId: "Europe/Minsk"});
  context.setDefaultTimeout(6000);
  await context.setOffline(true);
  const errors = [], requests = [];
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  });
  t.after(() => {
    assert.deepEqual(errors, [], "no uncaught application errors");
    assert.deepEqual(requests, [], "diagnosis entry and ICD search work offline");
  });
  const newPage = async () => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(now));
    await page.goto(url); await enterPolyclinic(page);
    await page.locator('[data-action="patients"]').first().waitFor();
    return page;
  };
  return {page: await newPage(), newPage};
}

function visit({summary = legacyText, reviewed = false, id = visitId} = {}) {
  let result = core.createEncounter({id, patientId, now});
  result.visitDate = "2032-04-19";
  result.history.complaints = "ДЕМО: условные жалобы";
  result.history.conditions = "ДЕМО: явно переносимые сведения анамнеза";
  result.assessment.summary = summary;
  result.assessment.returnVisitDate = "2032-04-25";
  result.draft = {text: manual, generatedAt: now, sourceFingerprint: core.fingerprint(result)};
  if (reviewed) result = core.setReviewStatus(result, "reviewed", {now});
  return result;
}

function structured() {
  return core.upsertDiagnosis(visit({summary: ""}), {kind: "primary", text: "ДЕМО: исходный основной диагноз (Z00.0)"}, {now});
}

async function seed(page, visits = [visit()], patients) {
  const cards = patients || [core.createPatient({id: patientId, label: "ДЕМО Диагнозова Анна Вымышленная", now})];
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value: core.serializeBundle(visits, cards)});
  await page.reload();
}

async function openCard(page) {
  await click(page, "patients");
  await page.locator('.patient-row[data-patient-id="' + patientId + '"] [data-action="patient"]').click();
}

async function openVisit(page, id = visitId) {
  await openCard(page);
  await page.locator('#patient-history [data-action="open"][data-id="' + id + '"]').click();
  await page.locator('[data-action="tab"][data-tab="draft"]').first().click();
  await page.locator("#diagnoses-heading").waitFor({state: "visible"});
}

async function fill(page, kind, text) {
  await page.locator("#diagnosis-kind").selectOption(kind);
  await page.locator("#diagnosis-text").fill(text);
}

async function saveForm(page) {
  await page.locator("#diagnosis-save").click();
  await page.locator("#diagnosis-dialog").waitFor({state: "hidden"});
}

async function add(page, kind, text) {
  await click(page, "diagnosis-add");
  await fill(page, kind, text);
  await saveForm(page);
}

test("opening, typing, searching and cancelling diagnoses never create an empty card; explicit save creates one visit", {timeout: 22000}, async t => {
  const {page} = await openApp(t);
  await click(page, "new");
  await page.locator('[data-action="tab"][data-tab="draft"]').first().click();
  const before = await raw(page);
  await click(page, "diagnosis-add");
  assert.equal(await page.locator("#diagnosis-kind").inputValue(), "primary");
  await page.locator("#diagnosis-text").fill("J20");
  await codeOption(page, "J20").waitFor({state: "visible"});
  assert.equal(await raw(page), before);
  await codeOption(page, "J20").click();
  assert.equal(await page.locator("#diagnosis-text").inputValue(), "Острый бронхит (J20)");
  assert.equal(await raw(page), before);
  await page.locator("#diagnosis-cancel").click();
  assert.equal(await raw(page), before);
  await click(page, "diagnosis-add");
  await page.locator("#diagnosis-text").fill("   ");
  await page.locator("#diagnosis-save").click();
  assert.equal(await raw(page), before);
  assert.equal(await page.locator("#diagnosis-error").isVisible(), true);
  await page.locator("#diagnosis-text").fill("ДЕМО: первая самостоятельная формулировка");
  await saveForm(page);
  const data = await saved(page);
  assert.equal(data.patients.length, 1);
  assert.equal(data.encounters.length, 1);
  assert.equal(data.encounters[0].diagnoses.length, 1);
  assert.equal(data.encounters[0].diagnoses[0].kind, "primary");
  assert.equal(data.encounters[0].draft.text, "");
});

test("legacy conversion retains original wording; all roles edit, reorder, delete and reload while manual text stays unchanged", {timeout: 28000}, async t => {
  const {page} = await openApp(t);
  await seed(page, [visit({reviewed: true})]); await openVisit(page);
  const before = await raw(page);
  await click(page, "diagnosis-add");
  assert.equal(await page.locator("#diagnosis-kind").inputValue(), "comorbidity");
  await fill(page, "comorbidity", "ДЕМО: сопутствующий диагноз (Z00.1)");
  await page.locator("#diagnosis-cancel").click();
  assert.equal(await raw(page), before);
  assert.equal(await page.locator("#field-assessment-summary").inputValue(), legacyText);
  await add(page, "comorbidity", "ДЕМО: сопутствующий диагноз (Z00.1)");
  const converted = await savedVisit(page);
  assert.equal(converted.diagnoses.length, 2);
  assert.equal(converted.diagnoses[0].text, legacyText);
  assert.equal(converted.diagnoses[0].kind, "primary");
  assert.equal(converted.workflow.reviewStatus, "draft");
  assert.equal(converted.workflow.reviewedAt, "");
  assert.equal(converted.draft.text, manual);
  assert.match(await page.locator("#draft-state").getAttribute("class"), /stale/);
  assert.equal(await page.locator("#field-assessment-summary").count(), 0);
  await add(page, "complication", "ДЕМО: осложнение (Z00.2)");
  const items = (await savedVisit(page)).diagnoses;
  await row(page, items[0].id).locator('[data-action="diagnosis-edit"]').click();
  await page.locator("#diagnosis-text").fill(legacyText + "\nДЕМО: уточнён врачом");
  await saveForm(page);
  await row(page, items[2].id).locator('[data-action="diagnosis-move"][data-direction="-1"]').click();
  assert.deepEqual((await savedVisit(page)).diagnoses.map(item => item.kind), ["primary", "complication", "comorbidity"]);
  assert.equal((await savedVisit(page)).draft.text, manual);
  await click(page, "generate"); await accept(page);
  const draft = await page.locator("#draft-text").inputValue();
  assert.ok(draft.includes("Основной диагноз: " + legacyText + "\nДЕМО: уточнён врачом"));
  assert.ok(draft.indexOf("Осложнение: ДЕМО: осложнение") < draft.indexOf("Сопутствующее заболевание:"));
  assert.match(draft.trim().split("\n").at(-1), /25\.04\.2032/);
  const beforeDelete = await raw(page);
  await row(page, items[1].id).locator('[data-action="diagnosis-delete"]').click();
  await page.locator("#dialog-cancel").click();
  assert.equal(await raw(page), beforeDelete);
  await row(page, items[1].id).locator('[data-action="diagnosis-delete"]').click(); await accept(page);
  assert.equal((await savedVisit(page)).diagnoses.length, 2);
  assert.equal((await savedVisit(page)).draft.text, draft);
  await page.reload(); await openVisit(page);
  assert.equal(await page.locator(".diagnosis-row").count(), 2);
  assert.equal(await page.locator("#draft-text").inputValue(), draft);
});

test("structured ICD input supports mouse and explicit keyboard choice, retains free wording and escapes markup", {timeout: 24000}, async t => {
  const {page} = await openApp(t);
  await seed(page, [visit({summary: ""})]); await openVisit(page);
  await click(page, "diagnosis-add");
  const before = await raw(page);
  await page.locator("#diagnosis-text").fill("J20");
  await codeOption(page, "J20").waitFor({state: "visible"});
  await page.locator("#diagnosis-text").press("ArrowDown");
  assert.equal(await codeOption(page, "J20").getAttribute("aria-selected"), "true");
  await page.locator("#diagnosis-text").press("Enter");
  assert.equal(await page.locator("#diagnosis-text").inputValue(), "Острый бронхит (J20)");
  assert.equal(await raw(page), before);
  await page.locator("#diagnosis-text").fill("Острый бронхит (J20)\nДЕМО: свободное уточнение врача");
  await saveForm(page);
  const first = (await savedVisit(page)).diagnoses[0];
  await row(page, first.id).locator('[data-action="diagnosis-edit"]').click();
  await page.locator("#diagnosis-text").fill("J20.9");
  const choice = codeOption(page, "J20.9");
  await choice.waitFor({state: "visible"});
  const title = await choice.locator("strong").innerText();
  await choice.click();
  assert.equal(await page.locator("#diagnosis-text").inputValue(), title + " (J20.9)");
  await saveForm(page);
  const custom = 'ДЕМО: <img id="diagnoses-injection" src=x onerror="window.diagnosesInjected=1"> собственная формулировка';
  await add(page, "complication", custom);
  const last = (await savedVisit(page)).diagnoses[1];
  assert.equal(last.text, custom);
  assert.equal(await row(page, last.id).locator(".diagnosis-text").innerText(), custom);
  assert.equal(await page.locator("#diagnoses-injection").count(), 0);
  assert.equal(await page.evaluate(() => window.diagnosesInjected), undefined);
  assert.equal((await savedVisit(page)).draft.text, manual);
});

test("a second primary diagnosis cannot silently replace the first; fixing its role saves the retained input once", {timeout: 18000}, async t => {
  const {page} = await openApp(t);
  const source = structured();
  await seed(page, [source]); await openVisit(page);
  await click(page, "diagnosis-add");
  await fill(page, "primary", "ДЕМО: второй диагноз");
  const before = await raw(page);
  await page.locator("#diagnosis-save").click();
  assert.match(await page.locator("#diagnosis-error").innerText(), /один основной диагноз/);
  assert.equal(await raw(page), before);
  assert.equal(await page.locator("#diagnosis-text").inputValue(), "ДЕМО: второй диагноз");
  await page.locator("#diagnosis-kind").selectOption("comorbidity");
  await saveForm(page);
  assert.equal((await savedVisit(page)).diagnoses.length, 2);
  assert.deepEqual((await savedVisit(page)).diagnoses[0], source.diagnoses[0]);
});

test("diagnoses stay with their patient and are searchable, visible in sources and preserved through backup restore", {timeout: 28000}, async t => {
  const {page, newPage} = await openApp(t);
  const source = core.upsertDiagnosis(structured(), {kind: "comorbidity", text: "ДЕМО: диагнозмаркерпоиска (Z00.1)"}, {now});
  const card = core.createPatient({id: patientId, label: "ДЕМО Диагнозова Анна Вымышленная", now});
  const other = core.createPatient({id: "fictional-diagnoses-other", label: "ДЕМО Другой Пациент", now});
  const foreign = core.createEncounter({id: "fictional-diagnoses-foreign", patientId: other.id, now});
  foreign.assessment.summary = "ДЕМО: чужой диагноз не переносить";
  await seed(page, [source, foreign], [card, other]);
  await click(page, "patients");
  await page.locator("#patient-search").fill("диагнозмаркерпоиска");
  assert.equal(await page.locator(".patient-row").count(), 1);
  assert.equal(await page.locator('.patient-row[data-patient-id="' + patientId + '"]').count(), 1);
  await page.locator("#patient-search").fill("");
  await openCard(page); await click(page, "repeat");
  const briefing = await page.locator("#briefing-diagnoses").innerText();
  assert.ok(briefing.includes("диагнозмаркерпоиска"));
  assert.ok(!briefing.includes("чужой диагноз"));
  await page.locator('#briefing-diagnoses [data-briefing-source="encounter"]').first().click();
  assert.match(await page.locator("#briefing-source-content").innerText(), /диагнозмаркерпоиска/);
  await page.locator("#briefing-source-close").click(); await page.locator("#repeat-cancel").click();
  await click(page, "help");
  const downloaded = page.waitForEvent("download");
  await click(page, "backup");
  const file = await downloaded;
  const chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  assert.deepEqual(core.parseBundle(buffer.toString("utf8")).encounters.find(item => item.id === visitId).diagnoses, source.diagnoses);
  const restored = await newPage(); await click(restored, "help");
  await restored.locator("#import-file").setInputFiles({name: "fictional-diagnoses.json", mimeType: "application/json", buffer});
  await accept(restored); await openVisit(restored);
  assert.deepEqual((await savedVisit(restored)).diagnoses, source.diagnoses);
  assert.equal((await savedVisit(restored, foreign.id)).assessment.summary, foreign.assessment.summary);
});

test("repeat preparation displays diagnoses but transfers none even when history is explicitly selected", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const source = core.upsertDiagnosis(structured(), {kind: "complication", text: "ДЕМО: осложнение предыдущего приёма"}, {now});
  await seed(page, [source]); await openCard(page); await click(page, "repeat");
  assert.match(await page.locator("#briefing-diagnoses").innerText(), /осложнение предыдущего приёма/);
  await page.locator('#repeat-fields input[name="carry-history"][value="conditions"]').check();
  await page.locator("#repeat-create").click();
  const repeat = (await saved(page)).encounters.find(item => item.id !== visitId);
  assert.ok(repeat);
  assert.equal(repeat.history.conditions, source.history.conditions);
  assert.equal(repeat.assessment.summary, "");
  assert.equal(repeat.diagnoses, undefined);
  assert.equal(repeat.draft.text, "");
  assert.deepEqual(await savedVisit(page), source);
});

test("a failed diagnosis save retains input and retry creates one entry without changing the manual note", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await seed(page, [structured()]); await openVisit(page);
  await click(page, "diagnosis-add");
  await fill(page, "complication", "ДЕМО: сохранение после ошибки");
  const before = await raw(page);
  await page.evaluate(key => {
    window.restoreDiagnosisStorage = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("ДЕМО: хранилище заполнено", "QuotaExceededError");
      return window.restoreDiagnosisStorage.call(this, name, value);
    };
  }, key);
  await page.locator("#diagnosis-save").click();
  assert.equal(await raw(page), before);
  assert.equal(await page.locator("#diagnosis-error").isVisible(), true);
  assert.equal(await page.locator("#diagnosis-text").inputValue(), "ДЕМО: сохранение после ошибки");
  assert.equal(await page.locator("#diagnosis-kind").inputValue(), "complication");
  assert.equal(await page.locator("#diagnosis-save").isEnabled(), true);
  await page.evaluate(() => { Storage.prototype.setItem = window.restoreDiagnosisStorage; delete window.restoreDiagnosisStorage; });
  await page.locator("#diagnosis-save").evaluate(button => { button.click(); button.click(); });
  await page.locator("#diagnosis-dialog").waitFor({state: "hidden"});
  assert.equal((await savedVisit(page)).diagnoses.length, 2);
  assert.equal((await savedVisit(page)).diagnoses.filter(item => item.text === "ДЕМО: сохранение после ошибки").length, 1);
  assert.equal((await savedVisit(page)).draft.text, manual);
});

test("a second-window change shows a warning in the open diagnosis form and blocks overwriting", {timeout: 22000}, async t => {
  const {page, newPage} = await openApp(t);
  const source = structured();
  await seed(page, [source]); await openVisit(page);
  const other = await newPage(); await openVisit(other);
  await click(other, "diagnosis-add"); await fill(other, "complication", "ДЕМО: несохранённый диагноз второго окна");
  await row(page, source.diagnoses[0].id).locator('[data-action="diagnosis-edit"]').click();
  await page.locator("#diagnosis-text").fill("ДЕМО: актуальное изменение первого окна");
  await saveForm(page);
  await other.locator("#diagnosis-error").waitFor({state: "visible"});
  assert.match(await other.locator("#diagnosis-error").innerText(), /другом окне|изменились/);
  const before = await raw(page);
  await other.locator("#diagnosis-save").click();
  assert.equal(await raw(page), before);
  assert.equal((await savedVisit(page)).diagnoses.length, 1);
  assert.equal((await savedVisit(page)).diagnoses[0].text, "ДЕМО: актуальное изменение первого окна");
  assert.equal(await other.locator("#diagnosis-text").inputValue(), "ДЕМО: несохранённый диагноз второго окна");
});

test("silent backing-store change blocks a stale diagnosis form without erasing the newer saved data", {timeout: 18000}, async t => {
  const {page} = await openApp(t);
  await seed(page, [structured()]); await openVisit(page);
  await click(page, "diagnosis-add"); await fill(page, "complication", "ДЕМО: устаревшее дополнение");
  await page.evaluate(({key, visitId}) => {
    const bundle = JSON.parse(localStorage.getItem(key));
    bundle.encounters.find(item => item.id === visitId).history.complaints = "ДЕМО: незаметно сохранённое изменение";
    localStorage.setItem(key, JSON.stringify(bundle));
  }, {key, visitId});
  const before = await raw(page);
  await page.locator("#diagnosis-save").click();
  assert.match(await page.locator("#diagnosis-error").innerText(), /изменились/);
  assert.equal(await raw(page), before);
  assert.equal((await savedVisit(page)).diagnoses.length, 1);
  assert.equal((await savedVisit(page)).history.complaints, "ДЕМО: незаметно сохранённое изменение");
});

test("a stale deletion confirmation cannot remove a diagnosis edited by another window", {timeout: 22000}, async t => {
  const {page, newPage} = await openApp(t);
  const source = structured();
  await seed(page, [source]); await openVisit(page);
  const other = await newPage(); await openVisit(other);
  await row(other, source.diagnoses[0].id).locator('[data-action="diagnosis-delete"]').click();
  await row(page, source.diagnoses[0].id).locator('[data-action="diagnosis-edit"]').click();
  await page.locator("#diagnosis-text").fill("ДЕМО: диагноз уточнён в первом окне");
  await saveForm(page);
  await accept(other);
  assert.equal((await savedVisit(page)).diagnoses.length, 1);
  assert.equal((await savedVisit(page)).diagnoses[0].text, "ДЕМО: диагноз уточнён в первом окне");
  assert.match(await other.locator("#toast").innerText(), /другом окне|изменились/);
});

test("long diagnosis text and action controls fit 390px; deleting the last item restores the empty diagnosis field", {timeout: 24000}, async t => {
  const {page} = await openApp(t);
  const text = "ДЕМО: длинная формулировка. " + "я".repeat(800) + "\nПоследняя строка уточнения.";
  const source = core.upsertDiagnosis(visit({summary: ""}), {kind: "primary", text}, {now});
  await seed(page, [source]); await openVisit(page);
  await page.setViewportSize({width: 390, height: 844});
  const target = row(page, source.diagnoses[0].id);
  await target.scrollIntoViewIfNeeded();
  assert.equal(await target.locator(".diagnosis-text").innerText(), text);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no page overflow with a long unbroken diagnosis");
  await target.locator('[data-action="diagnosis-edit"]').click();
  const bounds = await page.locator("#diagnosis-dialog").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, "dialog fits narrow viewport");
  await page.locator("#diagnosis-text").fill(text + "\nДЕМО: добавление");
  await saveForm(page);
  assert.equal((await savedVisit(page)).diagnoses[0].text, text + "\nДЕМО: добавление");
  await row(page, source.diagnoses[0].id).locator('[data-action="diagnosis-delete"]').click(); await accept(page);
  assert.equal((await savedVisit(page)).diagnoses, undefined);
  assert.equal((await savedVisit(page)).assessment.summary, "");
  assert.equal((await savedVisit(page)).draft.text, manual);
  assert.equal(await page.locator("#field-assessment-summary").inputValue(), "");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
});
