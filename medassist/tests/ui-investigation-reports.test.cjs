"use strict";
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
const patientId = "fictional-report-patient";
const visitId = "fictional-report-visit";
const action = (page, name) => page.locator('[data-action="' + name + '"]').first();
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const patient = async page => (await saved(page)).patients.find(item => item.id === patientId);
const entry = async page => (await saved(page)).encounters.find(item => item.id === visitId);
const accept = page => page.locator("#dialog-accept").click();
const field = (page, id, type = "result") => page.locator('.report-field[data-field-id="' + id + '"] [data-report-value="' + type + '"]');
const reportRow = (page, id) => page.locator('#patient-investigation-reports .investigation-report[data-report-id="' + id + '"]');

async function openApp(t) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MEDASSIST_BROWSER ? {executablePath: process.env.MEDASSIST_BROWSER} : {channel: "msedge"}),
    args: ["--no-first-run", "--disable-background-networking"]
  });
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: {width: 1366, height: 1000}, timezoneId: "Europe/Minsk"});
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors = [], requests = [];
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  });
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(requests, [], "all input forms work offline"); });
  const newPage = async () => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(now)); await page.goto(url);
    await action(page, "patients").waitFor();
    return page;
  };
  return {page: await newPage(), newPage};
}
function reportValues(overrides = {}) {
  return {panelId: "cbc", title: "Общий анализ крови", kind: "lab", date: "2032-04-18",
    rows: [{fieldId: "hemoglobin", name: "Гемоглобин (HGB)", result: "123", unit: "г/л", reference: "ДЕМО из бланка", note: ""}], ...overrides};
}
async function seed(page, {report = true, linked = true, checked = true, custom = null, selectedFields = null} = {}) {
  let card = core.createPatient({id: patientId, label: "Тестов Артём Вымышленный", now});
  if (report) card = core.upsertInvestigationReport(card, custom || reportValues(), {now});
  let visit = core.createEncounter({id: visitId, patientId, now});
  visit.history.complaints = "ДЕМО: жалобы";
  visit.history.medications = "ДЕМО: постоянные препараты";
  if (report && linked) visit = core.setEncounterInvestigations(visit, card, card.investigations.filter(item => !selectedFields || selectedFields.includes(item.fieldId)).map(item => item.id), {now});
  visit.draft = {text: "ДЕМО: сохранённая ручная запись", generatedAt: now, sourceFingerprint: core.fingerprint(visit, {patient: card, encounters: [visit]})};
  if (checked) visit = core.setReviewStatus(visit, "reviewed", {now});
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value: core.serializeBundle([visit], [card])});
  await page.reload();
  return {card, visit};
}
async function openCard(page) {
  await action(page, "patients").click();
  await page.locator('.patient-row[data-patient-id="' + patientId + '"] [data-action="patient"]').click();
}
async function openVisit(page) {
  await openCard(page);
  await page.locator('#patient-history [data-action="open"][data-id="' + visitId + '"]').click();
  await page.locator('[data-action="tab"][data-tab="investigations"]').click();
}
async function openReport(page, template = "cbc") {
  await action(page, "investigation-report-add").click();
  await page.locator("#investigation-report-template").selectOption(template);
}
async function saveReport(page) {
  await page.locator("#investigation-report-save").click();
  await page.locator("#investigation-report-dialog").waitFor({state: "hidden"});
}
async function generate(page) {
  await page.locator('.tab-bar [data-action="tab"][data-tab="draft"]').click();
  await action(page, "generate").click();
  if (await page.locator("#confirmation").isVisible()) await accept(page);
  return page.locator("#draft-text").inputValue();
}
async function revealField(page, id, type) {
  const control = field(page, id, type);
  if (!await control.isVisible()) {
    const row = page.locator('.report-field[data-field-id="' + id + '"]');
    await row.locator("summary").first().click();
  }
  return control;
}

test("Add result offers every ready-made investigation in the patient card and saves the chosen CBC", {timeout: 24000}, async t => {
  const {page} = await openApp(t);
  await seed(page, {report: false}); await openCard(page);
  const before = await raw(page);
  await action(page, "investigation-add").click();
  const options = await page.locator("#investigation-kind option").evaluateAll(items => items.map(item => ({value: item.value, label: item.textContent})));
  assert.equal(options.filter(item => item.value.startsWith("report:")).length, 13);
  for (const [id, shortName] of [["cbc", "ОАК"], ["urinalysis", "ОАМ"], ["biochemistry", "БАК"]]) {
    assert.match(options.find(item => item.value === "report:" + id).label, new RegExp(shortName));
  }
  assert.ok(options.some(item => item.value === "lab")); assert.ok(options.some(item => item.value === "study"));
  assert.equal(await page.locator("#investigation-name").isVisible(), false);
  await page.locator("#investigation-date").fill("2032-04-17");
  await page.locator("#investigation-kind").selectOption("report:cbc");
  assert.equal(await page.locator("#investigation-report-template").inputValue(), "cbc");
  assert.equal(await page.locator("#investigation-report-date").inputValue(), "2032-04-17");
  assert.equal(await field(page, "hemoglobin", "unit").inputValue(), "г/л");
  assert.equal(await raw(page), before, "opening a template does not save an empty result");
  await field(page, "hemoglobin").fill("123");
  await saveReport(page);
  assert.equal(await page.locator("#investigation-dialog").isVisible(), false);
  const bundle = await saved(page);
  assert.equal(bundle.patients[0].investigations.length, 1);
  assert.equal(bundle.patients[0].investigations[0].panelId, "cbc");
  assert.equal(bundle.encounters[0].investigationIds, undefined, "card entry is not automatically linked to an old visit");
});

test("Add result selects urine and biochemistry forms in primary and repeat encounters", {timeout: 24000}, async t => {
  const {page} = await openApp(t);
  await action(page, "new").click();
  await page.locator('[data-action="tab"][data-tab="investigations"]').click();
  const before = await raw(page);
  await action(page, "investigation-add").click();
  await page.locator("#investigation-kind").selectOption("report:urinalysis");
  assert.equal(await page.locator("#investigation-report-template").inputValue(), "urinalysis");
  await page.locator("#investigation-report-cancel").click();
  await page.locator("#investigation-cancel").click();
  assert.equal(await raw(page), before, "cancel creates neither an empty patient nor a visit");
  await action(page, "investigation-add").click();
  await page.locator("#investigation-kind").selectOption("report:urinalysis");
  await field(page, "color").fill("ДЕМО: цвет из бланка");
  await saveReport(page);
  let bundle = await saved(page);
  assert.equal(bundle.patients.length, 1); assert.equal(bundle.encounters.length, 1);
  assert.equal(bundle.encounters[0].investigationIds[0], bundle.patients[0].investigations[0].id);
  assert.match(await generate(page), /ДЕМО: цвет из бланка/);

  await seed(page, {report: false}); await openCard(page);
  await action(page, "repeat").click(); await page.locator("#repeat-create").click();
  await page.locator('[data-action="tab"][data-tab="investigations"]').click();
  await action(page, "investigation-add").click();
  await page.locator("#investigation-kind").selectOption("report:biochemistry");
  assert.equal(await field(page, "glucose", "unit").inputValue(), "ммоль/л");
  await field(page, "glucose").fill("5,1"); await saveReport(page);
  bundle = await saved(page);
  const next = bundle.encounters.find(item => item.id !== visitId);
  assert.equal(bundle.encounters.length, 2);
  assert.equal(next.investigationIds.length, 1);
  assert.equal(bundle.encounters.find(item => item.id === visitId).investigationIds, undefined);
  assert.equal(bundle.patients[0].investigations[0].panelId, "biochemistry");
  assert.match(await generate(page), /5,1 ммоль\/л/);
});

test("returning from a ready-made form preserves manual input and editing a saved result keeps its type", {timeout: 24000}, async t => {
  const {page} = await openApp(t);
  await seed(page, {report: false}); await openCard(page);
  await action(page, "investigation-add").click();
  await page.locator("#investigation-kind").selectOption("lab");
  const values = {date: "2032-04-16", name: "ДЕМО: особый показатель", result: "0", unit: "демо/л", reference: "ДЕМО норма из бланка", note: "ДЕМО примечание"};
  for (const [key, value] of Object.entries(values)) await page.locator("#investigation-" + key).fill(value);
  const before = await raw(page);
  await page.locator("#investigation-kind").selectOption("report:cbc");
  assert.equal(await page.locator("#investigation-report-cancel").innerText(), "Назад");
  await page.locator("#investigation-report-cancel").click();
  assert.equal(await page.locator("#investigation-kind").inputValue(), "lab");
  for (const [key, value] of Object.entries(values)) assert.equal(await page.locator("#investigation-" + key).inputValue(), value);
  assert.equal(await raw(page), before);
  await page.locator("#investigation-kind").selectOption("report:ecg");
  await page.keyboard.press("Escape");
  await page.locator("#investigation-save").click();
  await page.locator("#investigation-dialog").waitFor({state: "hidden"});
  const card = await patient(page);
  assert.equal(card.investigations.length, 1);
  assert.equal(card.investigations[0].reportId, undefined);
  assert.equal(card.investigations[0].result, "0");
  await page.locator('[data-action="investigation-edit"]').first().click();
  assert.equal(await page.locator('#investigation-kind option[value^="report:"]').count(), 0);
  assert.equal(await page.locator("#investigation-kind").inputValue(), "lab");
  for (const [key, value] of Object.entries(values)) assert.equal(await page.locator("#investigation-" + key).inputValue(), value);
  await page.locator("#investigation-cancel").click();
});

test("new encounter accepts a preset report atomically and omits every blank indicator, retaining zero", {timeout: 24000}, async t => {
  const {page} = await openApp(t);
  await action(page, "new").click();
  await page.locator('[data-action="tab"][data-tab="investigations"]').click();
  const before = await raw(page);
  await openReport(page);
  assert.equal(await field(page, "hemoglobin", "result").inputValue(), "");
  assert.equal(await field(page, "hemoglobin", "unit").inputValue(), "г/л");
  await page.locator("#investigation-report-save").click();
  assert.equal(await raw(page), before);
  assert.equal(await page.locator("#investigation-report-error").isVisible(), true);
  await field(page, "hemoglobin").fill("123");
  await page.locator("#investigation-report-cancel").click();
  assert.equal(await raw(page), before, "cancel never creates an empty card");
  await openReport(page);
  await page.locator("#investigation-report-date").fill("2032-04-18");
  await field(page, "hemoglobin").fill("123");
  await field(page, "leukocytes").fill("0");
  await saveReport(page);
  const bundle = await saved(page), card = bundle.patients[0], visit = bundle.encounters[0];
  assert.equal(bundle.patients.length, 1); assert.equal(bundle.encounters.length, 1);
  assert.equal(card.investigations.length, 2); assert.equal(visit.investigationIds.length, 2);
  assert.deepEqual(new Set(visit.investigationIds), new Set(card.investigations.map(item => item.id)));
  assert.ok(card.investigations.some(item => item.result === "0"));
  const draft = await generate(page);
  assert.match(draft, /Общий анализ крови/); assert.match(draft, /18\.04\.2032/);
  assert.match(draft, /123 г\/л/); assert.doesNotMatch(draft, /Эритроциты|RBC/);
  assert.ok(draft.indexOf("Общий анализ крови") < draft.indexOf("ЗАКЛЮЧЕНИЕ"));
});

test("reports entered in the card are attached explicitly to a repeat visit, with no automatic history carry", {timeout: 24000}, async t => {
  const {page} = await openApp(t);
  const original = await seed(page, {linked: false}); await openCard(page);
  assert.equal(await reportRow(page, core.getInvestigationReports(original.card)[0].id).count(), 1);
  await action(page, "repeat").click(); await page.locator("#repeat-create").click();
  let next = (await saved(page)).encounters.find(item => item.id !== visitId);
  assert.equal((next.investigationIds || []).length, 0);
  assert.equal(next.history.medications, "");
  await page.locator('[data-action="tab"][data-tab="investigations"]').click();
  await action(page, "investigation-attach").click();
  assert.equal(await page.locator('input[name="attach-investigation"]:checked').count(), 0);
  if (!await page.locator('input[name="attach-investigation"]').first().isVisible()) await page.locator("#investigation-attach-options details summary").first().click();
  await page.locator('input[name="attach-investigation"]').first().check();
  const beforeCancel = await raw(page);
  await page.locator("#investigation-attach-cancel").click();
  assert.equal(await raw(page), beforeCancel);
  await action(page, "investigation-attach").click();
  assert.equal(await page.locator('input[name="attach-investigation"]:checked').count(), 0);
  await page.locator('input[name="attach-report"]').first().check();
  await page.locator("#investigation-attach-save").click();
  await page.locator("#investigation-attach-dialog").waitFor({state: "hidden"});
  next = (await saved(page)).encounters.find(item => item.id !== visitId);
  assert.equal(next.investigationIds.length, 1);
  assert.equal((await patient(page)).investigations.length, 1, "attach does not duplicate results");
  assert.deepEqual(await entry(page), original.visit);
  assert.match(await generate(page), /123 г\/л/);
});

test("editing a report preserves IDs, removes cleared rows and updates linked review status while retaining manual draft", {timeout: 24000}, async t => {
  const {page} = await openApp(t);
  const original = await seed(page); await openCard(page);
  const report = core.getInvestigationReports(original.card)[0];
  await reportRow(page, report.id).locator('[data-action="investigation-report-edit"]').click();
  await field(page, "hemoglobin").fill("125");
  await field(page, "erythrocytes").fill("4,1");
  await saveReport(page);
  let card = await patient(page), visit = await entry(page);
  assert.equal(card.investigations.find(item => item.fieldId === "hemoglobin").id, original.card.investigations[0].id);
  assert.equal(visit.investigationIds.length, 2); assert.equal(visit.workflow.reviewStatus, "draft");
  assert.equal(visit.draft.text, original.visit.draft.text);
  await reportRow(page, report.id).locator('[data-action="investigation-report-edit"]').click();
  await field(page, "hemoglobin").fill("   "); await saveReport(page);
  card = await patient(page); visit = await entry(page);
  assert.equal(card.investigations.length, 1); assert.equal(visit.investigationIds.length, 1);
  assert.equal(card.investigations[0].fieldId, "erythrocytes");
  await openVisit(page);
  const draft = await generate(page);
  assert.match(draft, /4,1/); assert.doesNotMatch(draft, /Гемоглобин|125/);
});

test("unit overrides and both custom investigation types are entered during a visit and appear in the card and draft", {timeout: 24000}, async t => {
  const {page} = await openApp(t);
  await seed(page, {report: false}); await openVisit(page);
  await openReport(page); await field(page, "hemoglobin").fill("12,3");
  const unit = await revealField(page, "hemoglobin", "unit"); await unit.fill("ДЕМО другая единица");
  await saveReport(page);
  for (const kind of ["lab", "study"]) {
    await action(page, "investigation-add").click();
    await page.locator("#investigation-kind").selectOption(kind);
    await page.locator("#investigation-name").fill(kind === "lab" ? "ДЕМО специальный показатель" : "ДЕМО специальное исследование");
    await page.locator("#investigation-result").fill(kind === "lab" ? "7,8" : "ДЕМО текстовое заключение");
    await page.locator("#investigation-unit").fill(kind === "lab" ? "демо/мл" : "");
    await page.locator("#investigation-save").click();
    await page.locator("#investigation-dialog").waitFor({state: "hidden"});
  }
  assert.equal((await patient(page)).investigations.length, 3);
  assert.equal((await entry(page)).investigationIds.length, 3);
  const draft = await generate(page);
  assert.ok(draft.includes("12,3 ДЕМО другая единица"));
  assert.ok(draft.includes("7,8 демо/мл")); assert.ok(draft.includes("ДЕМО текстовое заключение"));
  await openCard(page);
  assert.equal(core.getInvestigationReports(await patient(page)).length, 1);
  assert.equal(await page.locator("#investigation-series option").count(), 3);
});

test("report save failure retains every entered value and a stale second window cannot duplicate the report", {timeout: 25000}, async t => {
  const {page, newPage} = await openApp(t);
  await seed(page, {report: false}); await openVisit(page);
  const other = await newPage(); await openVisit(other);
  for (const target of [page, other]) { await openReport(target); await field(target, "hemoglobin").fill("123"); }
  const before = await raw(page);
  await page.evaluate(key => {
    window.demoReportSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("ДЕМО: недостаточно места", "QuotaExceededError");
      return window.demoReportSetItem.call(this, name, value);
    };
  }, key);
  await page.locator("#investigation-report-save").click();
  assert.equal(await raw(page), before);
  assert.equal(await field(page, "hemoglobin").inputValue(), "123");
  assert.equal(await page.locator("#investigation-report-error").isVisible(), true);
  await page.evaluate(() => { Storage.prototype.setItem = window.demoReportSetItem; delete window.demoReportSetItem; });
  await saveReport(page);
  await other.locator("#investigation-report-error").waitFor({state: "visible"});
  await other.locator("#investigation-report-save").click();
  assert.match(await other.locator("#investigation-report-error").innerText(), /другом окне/);
  assert.equal(core.getInvestigationReports(await patient(page)).length, 1);
  assert.equal((await entry(page)).investigationIds.length, 1);
});

test("detaching a result keeps it in the card, and stale deletion cannot remove an edited report", {timeout: 25000}, async t => {
  const {page, newPage} = await openApp(t);
  const original = await seed(page); await openVisit(page);
  await action(page, "investigation-detach").click();
  if (await page.locator("#confirmation").isVisible()) await accept(page);
  assert.equal((await entry(page)).investigationIds, undefined);
  assert.equal((await patient(page)).investigations.length, 1);
  assert.equal((await entry(page)).draft.text, original.visit.draft.text);
  await openCard(page);
  const reportId = core.getInvestigationReports(await patient(page))[0].id;
  const other = await newPage(); await openCard(other);
  await reportRow(other, reportId).locator('[data-action="investigation-report-delete"]').click();
  await reportRow(page, reportId).locator('[data-action="investigation-report-edit"]').click();
  await field(page, "hemoglobin").fill("124"); await saveReport(page); await accept(other);
  assert.equal((await patient(page)).investigations[0].result, "124");
  assert.match(await other.locator("#toast").innerText(), /другом окне/);
});

test("report backup restores group and encounter links, and only entered indicators appear in its final view", {timeout: 23000}, async t => {
  const {page, newPage} = await openApp(t);
  const original = await seed(page); await openCard(page);
  const id = core.getInvestigationReports(original.card)[0].id;
  await reportRow(page, id).locator("summary").click();
  const text = await reportRow(page, id).innerText();
  assert.match(text, /123/); assert.doesNotMatch(text, /Эритроциты|RBC/);
  await action(page, "help").click();
  const download = page.waitForEvent("download"); await action(page, "backup").click();
  const file = await download, chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  const restored = await newPage(); await action(restored, "help").click();
  await restored.locator("#import-file").setInputFiles({name: "fictional-reports.json", mimeType: "application/json", buffer: Buffer.concat(chunks)});
  await accept(restored); await openCard(restored);
  assert.deepEqual(await patient(restored), original.card);
  assert.deepEqual((await entry(restored)).investigationIds, original.visit.investigationIds);
  assert.equal(await reportRow(restored, id).count(), 1);
});

test("switching templates retains unsaved input and the long form stays usable at desktop and narrow widths", {timeout: 26000}, async t => {
  const {page} = await openApp(t);
  await seed(page, {report: false}); await openVisit(page); const before = await raw(page);
  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({width, height: 900}); await openReport(page);
    await field(page, "hemoglobin").fill("123");
    const otherTemplate = await page.locator("#investigation-report-template option").evaluateAll(options => options.find(option => option.value && option.value !== "cbc").value);
    await page.locator("#investigation-report-template").selectOption(otherTemplate);
    await page.locator("#investigation-report-template").selectOption("cbc");
    assert.equal(await field(page, "hemoglobin").inputValue(), "123");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const bounds = await page.locator("#investigation-report-dialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await page.locator("#investigation-report-cancel").click();
  }
  assert.equal(await raw(page), before);
});

test("saved custom panel fields survive editing even when the preset is not in the current catalog", {timeout: 19000}, async t => {
  const {page} = await openApp(t);
  const custom = reportValues({panelId: "fictional-retired-panel", title: "ДЕМО сохранённый бланк", rows: [
    {fieldId: "fictional-retired-field", name: "ДЕМО редкий показатель", result: "7", unit: "демо/л", reference: "ДЕМО исходная норма", note: "ДЕМО исходное пояснение"}
  ]});
  const original = await seed(page, {custom}); await openCard(page);
  const id = core.getInvestigationReports(original.card)[0].id;
  await reportRow(page, id).locator('[data-action="investigation-report-edit"]').click();
  await field(page, "fictional-retired-field").fill("8"); await saveReport(page);
  const result = (await patient(page)).investigations[0];
  assert.equal(result.result, "8"); assert.equal(result.unit, "демо/л");
  assert.equal(result.name, "ДЕМО редкий показатель");
  assert.equal(result.reference, custom.rows[0].reference); assert.equal(result.note, custom.rows[0].note);
  assert.equal(result.id, original.card.investigations[0].id);
});

test("editing partially selected report does not select other existing fields; confirmed card deletion removes links only", {timeout: 22000}, async t => {
  const {page} = await openApp(t);
  const custom = reportValues();
  custom.rows.push({fieldId: "erythrocytes", name: "Эритроциты крови (RBC)", result: "4,2", unit: "10¹²/л", reference: "", note: ""});
  const original = await seed(page, {custom, selectedFields: ["hemoglobin"]}); await openVisit(page);
  await page.locator('#visit-investigations [data-action="investigation-report-edit"]').click();
  await field(page, "hemoglobin").fill("124"); await saveReport(page);
  assert.equal((await entry(page)).investigationIds.length, 1);
  assert.equal((await patient(page)).investigations.length, 2);
  assert.equal((await entry(page)).investigationIds[0], original.visit.investigationIds[0]);
  assert.equal((await entry(page)).draft.text, original.visit.draft.text);
  await openCard(page);
  const reportId = core.getInvestigationReports(await patient(page))[0].id;
  await reportRow(page, reportId).locator('[data-action="investigation-report-delete"]').click(); await accept(page);
  assert.equal((await patient(page)).investigations, undefined);
  assert.equal((await entry(page)).investigationIds, undefined);
  assert.equal((await entry(page)).draft.text, original.visit.draft.text);
  assert.equal((await entry(page)).workflow.reviewStatus, "draft");
});

test("a full saved report stays editable when its current preset has different fields", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const custom = reportValues({rows: Array.from({length: 100}, (_, i) => ({
    fieldId: "fictional-previous-field-" + i, name: "ДЕМО прежний показатель " + i,
    result: "1", unit: "демо", reference: "", note: ""
  }))});
  const original = await seed(page, {custom}); await openCard(page);
  const id = core.getInvestigationReports(original.card)[0].id;
  await reportRow(page, id).locator('[data-action="investigation-report-edit"]').click();
  await field(page, "fictional-previous-field-0").fill("2");
  await saveReport(page);
  assert.equal((await patient(page)).investigations.length, 100);
  assert.equal((await patient(page)).investigations[0].result, "2");
  assert.deepEqual((await patient(page)).investigations.slice(1), original.card.investigations.slice(1));
});
