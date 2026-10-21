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
const patientId = "demo-briefing-patient";
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const historyChoice = (page, name) => page.locator('#repeat-fields input[name="carry-history"][value="' + name + '"]');
const prescriptionChoice = (page, id) => page.locator('#repeat-prescriptions input[name="carry-prescription"][value="' + id + '"]');
const sourceButton = (page, type, id) => page.locator('#repeat-briefing [data-briefing-source="' + type + '"][data-source-id="' + id + '"]').first();

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
    assert.deepEqual(requests, [], "the briefing works offline");
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

function fixture() {
  let patient = core.createPatient({id: patientId, label: "ДЕМО Тестова <Вымышленная>", now});
  const other = core.createPatient({id: "demo-briefing-other", label: "ДЕМО Другой Пациент", now});
  function visit(id, date) {
    const result = core.createEncounter({id, patientId, now: date + "T08:00:00.000Z"});
    result.visitDate = date;
    result.history.complaints = "ДЕМО: жалобы " + id;
    result.assessment.summary = "ДЕМО диагноз " + id;
    result.assessment.plan = "ДЕМО: рекомендации " + id;
    result.draft.text = "ДЕМО: ручная запись <без изменений> " + id;
    return result;
  }
  const recent = visit("demo-briefing-recent", "2032-04-18");
  recent.history.medications = 'ДЕМО препарат <img src="missing" onerror="throw 1"> & постоянный';
  recent.assessment.returnVisitDate = "2032-04-25";
  let middle = visit("demo-briefing-middle", "2032-04-16");
  middle.history.allergies = "ДЕМО аллергия <script>throw 1</script> & уточнение";
  middle.assessment.returnVisitDate = "2032-04-19";
  middle = core.upsertPrescription(middle, {
    name: "ДЕМО назначение <условное>", dose: "ДЕМО доза", route: "ДЕМО путь",
    frequency: "ДЕМО режим", duration: "ДЕМО срок", note: "ДЕМО примечание"
  }, {now});
  let older = visit("demo-briefing-older", "2032-04-12");
  older.history.conditions = "ДЕМО заболевание из старой записи";
  older.assessment.returnVisitDate = "2032-04-17";
  let oldest = visit("demo-briefing-oldest", "2032-04-05");
  oldest.history.allergies = "ДЕМО прежняя аллергия";
  oldest.assessment.returnVisitDate = "2032-04-20";
  Object.assign(oldest.assessment, {sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-СТАРАЯ-ОТМЕТКА", sickLeaveFrom: "2032-04-05", sickLeaveTo: "2032-04-06"});
  oldest = core.setReturnVisitStatus(oldest, "completed");
  const foreign = visit("demo-briefing-foreign", "2032-04-19");
  foreign.patientId = other.id;
  foreign.history.allergies = "ДЕМО НЕ ПОКАЗЫВАТЬ чужую аллергию";
  foreign.assessment.summary = "ДЕМО НЕ ПОКАЗЫВАТЬ чужой диагноз";
  foreign.assessment.returnVisitDate = "2032-04-19";
  patient = core.upsertInvestigationReport(patient, {
    panelId: "cbc", title: "ДЕМО общий анализ крови", kind: "lab", date: "2032-04-18",
    rows: [
      {fieldId: "demo-hgb", name: "ДЕМО гемоглобин", result: "123", unit: "г/л", reference: "ДЕМО из бланка", note: "ДЕМО строка А"},
      {fieldId: "demo-wbc", name: "ДЕМО лейкоциты", result: "5,1", unit: "10⁹/л", reference: "ДЕМО другая норма", note: "ДЕМО строка Б"}
    ]
  }, {now});
  const reportId = patient.investigations[0].reportId;
  for (const [date, name, kind] of [
    ["2032-04-17", "ДЕМО отдельный лабораторный результат", "lab"],
    ["2032-04-16", "ДЕМО инструментальное исследование", "study"],
    ["2032-04-01", "ДЕМО старый результат вне краткой сводки", "lab"]
  ]) {
    patient = core.upsertInvestigation(patient, {
      kind, date, name, result: "ДЕМО заключение <буквально>", unit: kind === "lab" ? "ДЕМО ед." : "",
      reference: "ДЕМО норма из бланка", note: "ДЕМО примечание к результату"
    }, {now});
  }
  const resultId = patient.investigations.find(item => item.date === "2032-04-17").id;
  for (const [id, from, to, number] of [
    ["demo-leave-open", "2032-04-15", "2032-04-22", "ДЕМО-ОТКРЫТ"],
    ["demo-leave-expired", "2032-04-01", "2032-04-03", "ДЕМО-ПЕРИОД-ИСТЁК"],
    ["demo-leave-closed", "2032-03-01", "2032-03-02", "ДЕМО-ЗАКРЫТ"]
  ]) patient = core.issueSickLeave(patient, {id, number, from, to, now});
  patient = core.closeSickLeave(patient, "demo-leave-closed", {date: "2032-03-02", now});
  return {patients: [patient, other], encounters: [oldest, foreign, recent, older, middle], recent, middle, older, oldest, reportId, resultId};
}

async function seed(page, data = fixture()) {
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {
    key, value: core.serializeBundle(data.encounters, data.patients)
  });
  await page.reload();
  return data;
}

async function openCard(page) {
  await click(page, "patients");
  await page.locator('.patient-row[data-patient-id="' + patientId + '"] [data-action="patient"]').click();
}

async function openBriefing(page) {
  await openCard(page);
  await click(page, "repeat");
  await page.locator("#repeat-briefing").waitFor({state: "visible"});
}

async function peek(page, type, id) {
  await sourceButton(page, type, id).click();
  await page.locator("#briefing-source-dialog").waitFor({state: "visible"});
}

test("briefing shows dated evidence from this patient, latest diagnoses and grouped results without writing data", {timeout: 25000}, async t => {
  const {page} = await openApp(t);
  const data = await seed(page), before = await raw(page);
  await openBriefing(page);
  const diagnoses = await page.locator("#briefing-diagnoses").innerText();
  for (const entry of [data.recent, data.middle, data.older]) assert.ok(diagnoses.includes(entry.assessment.summary));
  assert.ok(!diagnoses.includes(data.oldest.assessment.summary), "only three latest nonempty diagnoses");
  assert.ok(diagnoses.indexOf(data.recent.assessment.summary) < diagnoses.indexOf(data.middle.assessment.summary));
  const facts = await page.locator("#briefing-facts").innerText();
  for (const value of [data.recent.history.medications, data.middle.history.allergies, data.older.history.conditions]) assert.ok(facts.includes(value));
  for (const [entry, date] of [[data.recent, "18.04.2032"], [data.middle, "16.04.2032"], [data.older, "12.04.2032"]]) {
    const row = page.locator("#briefing-facts .briefing-fact").filter({has: page.locator('[data-source-id="' + entry.id + '"]')});
    assert.ok((await row.innerText()).includes(date), "each fact retains its own source date");
  }
  const prescriptions = await page.locator("#briefing-prescriptions").innerText();
  assert.match(prescriptions, /ДЕМО назначение <условное>/);
  assert.match(prescriptions, /16\.04\.2032/);
  const investigations = await page.locator("#briefing-investigations").innerText();
  for (const name of ["ДЕМО общий анализ крови", "ДЕМО гемоглобин", "123", "ДЕМО лейкоциты", "5,1", "ДЕМО отдельный лабораторный результат", "ДЕМО инструментальное исследование"]) assert.ok(investigations.includes(name));
  assert.doesNotMatch(investigations, /старый результат вне краткой сводки/);
  assert.equal(await page.locator('#briefing-investigations [data-briefing-source="report"]').count(), 1, "a multi-row report is one source");
  const leaves = await page.locator("#briefing-sick-leaves").innerText();
  assert.match(leaves, /ДЕМО-ОТКРЫТ/);
  assert.match(leaves, /ДЕМО-ПЕРИОД-ИСТЁК/);
  assert.match(leaves, /ДЕМО-СТАРАЯ-ОТМЕТКА/);
  assert.doesNotMatch(leaves, /ДЕМО-ЗАКРЫТ/);
  assert.match(leaves, /период закончился; закрытие не отмечено/);
  assert.match(leaves, /Статус закрытия по ним не установлен/);
  const returns = await page.locator("#briefing-return").innerText();
  assert.match(returns, /19\.04\.2032/);
  assert.match(returns, /Прошедших дат без отметки «Состоялся»: 1/);
  assert.doesNotMatch(returns, /20\.04\.2032|25\.04\.2032/, "nearest pending date wins over completed and later dates");
  assert.doesNotMatch(await page.locator("#repeat-briefing").innerText(), /НЕ ПОКАЗЫВАТЬ/);
  assert.equal(await page.locator("#repeat-briefing input,#repeat-briefing textarea,#repeat-briefing img,#repeat-briefing script").count(), 0);
  assert.equal(await raw(page), before, "opening and reading the summary creates no visit and changes no record");
  await page.locator("#repeat-cancel").click();
  assert.equal(await raw(page), before, "cancelling leaves every field and journal unchanged");
});

test("source peeks display the original encounter, report, result and journal read-only and preserve carry choices", {timeout: 25000}, async t => {
  const {page} = await openApp(t);
  const data = await seed(page), before = await raw(page);
  await openBriefing(page);
  await historyChoice(page, "medications").check();
  for (const [type, id, expected] of [
    ["encounter", data.recent.id, data.recent.draft.text],
    ["report", data.reportId, "ДЕМО другая норма"],
    ["result", data.resultId, "ДЕМО заключение <буквально>"],
    ["journal", "demo-leave-open", "ДЕМО-ОТКРЫТ"]
  ]) {
    await peek(page, type, id);
    assert.ok((await page.locator("#briefing-source-content").innerText()).includes(expected), type + " source content");
    assert.ok((await page.locator("#briefing-source-title").innerText()).trim());
    assert.equal(await page.locator("#briefing-source-content input,#briefing-source-content textarea,#briefing-source-content [contenteditable],#briefing-source-content img,#briefing-source-content script").count(), 0);
    await page.locator("#briefing-source-close").click();
    assert.equal(await page.locator("#repeat-dialog").isVisible(), true);
    assert.equal(await historyChoice(page, "medications").isChecked(), true);
    assert.equal(await raw(page), before, "viewing " + type + " is read only");
  }
  await peek(page, "encounter", data.middle.id);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#briefing-source-dialog").isVisible(), false);
  assert.equal(await page.locator("#repeat-dialog").isVisible(), true, "Escape closes only the top source dialog");
  assert.equal(await historyChoice(page, "medications").isChecked(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#repeat-dialog").isVisible(), false);
  assert.equal(await raw(page), before);
});

test("a repeat with no selections stays empty although summary facts, prescriptions and results are visible", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const data = await seed(page);
  await openBriefing(page);
  assert.equal(await page.locator('#repeat-fields input:checked').count(), 0);
  assert.match(await page.locator("#repeat-carry-status").innerText(), /Перенос не выбран[\s\S]*пустыми полями/);
  await page.locator("#repeat-create").click();
  await page.locator("#repeat-dialog").waitFor({state: "hidden"});
  const after = await saved(page);
  const repeated = after.encounters.find(item => !data.encounters.some(original => original.id === item.id));
  assert.ok(repeated);
  assert.equal(after.encounters.length, data.encounters.length + 1);
  assert.equal(after.patients.length, data.patients.length);
  for (const value of Object.values(repeated.history)) assert.equal(value, "");
  for (const field of ["summary", "plan", "returnVisitDate", "sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"]) assert.equal(repeated.assessment[field], "");
  assert.equal(repeated.draft.text, "");
  assert.equal((repeated.prescriptions || []).length, 0);
  assert.equal((repeated.investigationIds || []).length, 0);
  assert.deepEqual(after.patients, data.patients);
  assert.deepEqual(after.encounters.filter(item => item.id !== repeated.id), data.encounters);
});

test("transfer uses only explicitly selected fields from one source and changing the source resets consent", {timeout: 25000}, async t => {
  const {page} = await openApp(t);
  const data = await seed(page), before = await raw(page);
  await openBriefing(page);
  await historyChoice(page, "medications").check();
  await page.locator("#repeat-source").selectOption(data.middle.id);
  assert.equal(await page.locator('#repeat-fields input:checked').count(), 0);
  await historyChoice(page, "allergies").check();
  const prescription = data.middle.prescriptions[0];
  await prescriptionChoice(page, prescription.id).check();
  assert.match(await page.locator("#repeat-carry-status").innerText(), /сведений анамнеза — 1, назначений — 1/);
  await peek(page, "encounter", data.recent.id);
  await page.locator("#briefing-source-close").click();
  assert.equal(await historyChoice(page, "allergies").isChecked(), true);
  assert.equal(await prescriptionChoice(page, prescription.id).isChecked(), true);
  assert.equal(await raw(page), before, "checking transfer boxes does not save a visit");
  await page.locator("#repeat-create").click();
  await page.locator("#repeat-dialog").waitFor({state: "hidden"});
  const after = await saved(page);
  const repeated = after.encounters.find(item => !data.encounters.some(original => original.id === item.id));
  assert.equal(repeated.history.allergies, data.middle.history.allergies);
  assert.equal(repeated.history.medications, "");
  assert.equal(repeated.history.conditions, "");
  assert.equal(repeated.history.complaints, "");
  assert.equal(repeated.prescriptions.length, 1);
  assert.notEqual(repeated.prescriptions[0].id, prescription.id);
  for (const field of ["name", "dose", "route", "frequency", "duration", "note"]) assert.equal(repeated.prescriptions[0][field], prescription[field]);
  assert.equal(repeated.assessment.summary, "");
  assert.equal(repeated.assessment.plan, "");
  assert.equal(repeated.draft.text, "");
  assert.equal((repeated.investigationIds || []).length, 0);
  assert.deepEqual(after.encounters.filter(item => item.id !== repeated.id), data.encounters);
});

test("failed repeat save keeps summary, selected consent and inline error; retry creates exactly one visit", {timeout: 25000}, async t => {
  const {page} = await openApp(t);
  const data = await seed(page), before = await raw(page);
  await openBriefing(page);
  await historyChoice(page, "medications").check();
  await page.evaluate(key => {
    window.restoreBriefingStorage = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("ДЕМО: хранилище заполнено", "QuotaExceededError");
      return window.restoreBriefingStorage.call(this, name, value);
    };
  }, key);
  await page.locator("#repeat-create").click();
  assert.equal(await page.locator("#repeat-dialog").isVisible(), true);
  assert.equal(await page.locator("#repeat-error").isVisible(), true);
  assert.equal(await historyChoice(page, "medications").isChecked(), true);
  assert.equal(await raw(page), before);
  await page.evaluate(() => {
    Storage.prototype.setItem = window.restoreBriefingStorage;
    delete window.restoreBriefingStorage;
  });
  await page.locator("#repeat-create").click();
  await page.locator("#repeat-dialog").waitFor({state: "hidden"});
  const after = await saved(page);
  assert.equal(after.encounters.length, data.encounters.length + 1);
  const repeated = after.encounters.find(item => !data.encounters.some(original => original.id === item.id));
  assert.equal(repeated.history.medications, data.recent.history.medications);
  assert.deepEqual(after.encounters.filter(item => item.id !== repeated.id), data.encounters);
});

test("a second window warns inside the open briefing and blocks stale repeat creation without losing newer data", {timeout: 25000}, async t => {
  const {page, newPage} = await openApp(t);
  const data = await seed(page);
  const other = await newPage();
  await openBriefing(page);
  await historyChoice(page, "medications").check();
  await openCard(other);
  await other.locator('#patient-history [data-action="open"][data-id="' + data.recent.id + '"]').click();
  const tab = other.locator('[data-action="tab"][data-tab="history"]').first();
  await tab.click();
  await other.locator('[data-action="tab"][data-tab="history"][aria-selected="true"]').waitFor();
  await other.locator('[data-field="history.medications"]').fill("ДЕМО: изменено во втором окне");
  await page.locator("#repeat-error").waitFor({state: "visible"});
  assert.match(await page.locator("#repeat-error").innerText(), /другом окне/);
  const latest = await raw(page);
  await page.locator("#repeat-create").click();
  assert.equal(await page.locator("#repeat-dialog").isVisible(), false);
  assert.equal(await raw(page), latest);
  assert.equal((await saved(page)).encounters.length, data.encounters.length);
  assert.match(await page.locator("#toast").innerText(), /другом окне/);
});

test("a backing-store change without a storage event cannot be overwritten by confirming an outdated briefing", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const data = await seed(page);
  await openBriefing(page);
  await historyChoice(page, "medications").check();
  await page.evaluate(key => {
    const bundle = JSON.parse(localStorage.getItem(key));
    bundle.encounters.find(item => item.id === "demo-briefing-recent").history.medications = "ДЕМО: более новая сохранённая версия";
    localStorage.setItem(key, JSON.stringify(bundle));
  }, key);
  const latest = await raw(page);
  await page.locator("#repeat-create").click();
  assert.equal(await raw(page), latest);
  assert.equal((await saved(page)).encounters.length, data.encounters.length);
  const warning = await page.locator("#repeat-error").isVisible() ? await page.locator("#repeat-error").innerText() : await page.locator("#toast").innerText();
  assert.match(warning, /измен|обнов|откр/i);
});

test("a scheduled repeat shows the same briefing with a locked source, then reuses the linked visit without new copying", {timeout: 25000}, async t => {
  const {page} = await openApp(t);
  const data = await seed(page);
  const start = () => page.locator('#followup-list [data-followup-id="' + data.middle.id + '"] [data-action="start-followup"]').click();
  await click(page, "followups");
  await start();
  assert.equal(await page.locator("#repeat-briefing").isVisible(), true);
  assert.equal(await page.locator("#repeat-source").inputValue(), data.middle.id);
  assert.equal(await page.locator("#repeat-source").isDisabled(), true);
  assert.equal(await page.locator("#repeat-fields input:checked").count(), 0);
  await historyChoice(page, "allergies").check();
  await page.locator("#repeat-create").click();
  await page.locator("#repeat-dialog").waitFor({state: "hidden"});
  let after = await saved(page);
  const source = after.encounters.find(item => item.id === data.middle.id);
  const repeated = after.encounters.find(item => item.id === source.workflow.returnVisitEncounterId);
  assert.ok(repeated);
  assert.equal(repeated.history.allergies, data.middle.history.allergies);
  assert.equal(repeated.history.medications, "");
  assert.equal(source.workflow.returnVisitStatus, "planned");
  await click(page, "followups");
  await start();
  assert.equal(await page.locator("#repeat-dialog").isVisible(), false);
  after = await saved(page);
  assert.equal(after.encounters.length, data.encounters.length + 1);
  assert.equal(after.encounters.find(item => item.id === data.middle.id).workflow.returnVisitEncounterId, repeated.id);
});

test("an empty patient card has an empty briefing and still creates a first visit only after confirmation", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const data = {patients: [core.createPatient({id: patientId, label: "ДЕМО Без истории", now})], encounters: []};
  await seed(page, data);
  const before = await raw(page);
  await openBriefing(page);
  assert.equal(await page.locator("#repeat-source-wrap").isVisible(), false);
  assert.equal(await page.locator("#repeat-fields input").count(), 0);
  assert.equal(await page.locator("#repeat-briefing [data-briefing-source]").count(), 0);
  assert.equal(await raw(page), before);
  await page.locator("#repeat-create").click();
  await page.locator("#repeat-dialog").waitFor({state: "hidden"});
  const after = await saved(page);
  assert.equal(after.encounters.length, 1);
  assert.equal(after.patients.length, 1);
  assert.equal(after.encounters[0].patientId, patientId);
  assert.equal(after.encounters[0].draft.text, "");
});

test("future-dated evidence is marked and the briefing remains usable at 390 pixels with keyboard source navigation", {timeout: 25000}, async t => {
  const {page} = await openApp(t);
  const data = fixture();
  data.recent.visitDate = "2032-04-22";
  for (const item of data.patients[0].investigations.filter(item => item.reportId === data.reportId)) item.date = "2032-04-25";
  await seed(page, data);
  await page.setViewportSize({width: 390, height: 844});
  const before = await raw(page);
  await openBriefing(page);
  assert.match(await page.locator("#briefing-diagnoses").innerText(), /Будущая дата/);
  assert.match(await page.locator("#briefing-investigations").innerText(), /Будущая дата/);
  const bounds = await page.locator("#repeat-dialog").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391 && bounds.y >= 0 && bounds.y + bounds.height <= 845, "repeat dialog fits mobile viewport");
  assert.equal(await page.locator("#repeat-dialog").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, "no horizontal scrolling");
  const create = await page.locator("#repeat-create").boundingBox();
  assert.ok(create.y >= 0 && create.y + create.height <= 844, "confirmation stays in view");
  await historyChoice(page, "medications").check();
  await sourceButton(page, "encounter", data.recent.id).focus();
  await page.keyboard.press("Enter");
  await page.locator("#briefing-source-dialog").waitFor({state: "visible"});
  const sourceBounds = await page.locator("#briefing-source-dialog").boundingBox();
  assert.ok(sourceBounds.x >= 0 && sourceBounds.x + sourceBounds.width <= 391 && sourceBounds.y >= 0 && sourceBounds.y + sourceBounds.height <= 845, "source dialog fits mobile viewport");
  await page.keyboard.press("Escape");
  assert.equal(await historyChoice(page, "medications").isChecked(), true);
  assert.equal(await page.locator("#repeat-dialog").isVisible(), true);
  await page.locator("#repeat-cancel").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#repeat-dialog").isVisible(), false);
  assert.equal(await raw(page), before);
});

test("compact previews retain full long text, remaining report rows and all open leaves in their read-only sources", {timeout: 25000}, async t => {
  const {page} = await openApp(t);
  const data = fixture();
  const longText = "ДЕМО: " + "Вымышленное уточнение. ".repeat(25) + "ДЕМО окончание полного текста";
  data.recent.assessment.summary = longText;
  data.patients[0] = core.upsertInvestigationReport(data.patients[0], {
    panelId: "cbc", title: "ДЕМО общий анализ крови", kind: "lab", date: "2032-04-18",
    rows: ["А", "Б", "В", "Г"].map((suffix, index) => ({
      fieldId: "demo-row-" + index, name: "ДЕМО показатель " + suffix, result: String(index + 1),
      unit: "ДЕМО ед.", reference: "ДЕМО бланк", note: ""
    }))
  }, {id: data.reportId, now});
  for (const suffix of ["additional-a", "additional-b"]) {
    data.patients[0] = core.issueSickLeave(data.patients[0], {
      id: "demo-leave-" + suffix, number: "ДЕМО-" + suffix,
      from: "2032-04-10", to: "2032-04-21", now
    });
  }
  await seed(page, data);
  const before = await raw(page);
  await openBriefing(page);
  assert.doesNotMatch(await page.locator("#briefing-diagnoses").innerText(), /окончание полного текста/);
  await peek(page, "encounter", data.recent.id);
  assert.ok((await page.locator("#briefing-source-content").innerText()).includes(longText));
  await page.locator("#briefing-source-close").click();
  assert.doesNotMatch(await page.locator("#briefing-investigations").innerText(), /ДЕМО показатель Г/);
  await peek(page, "report", data.reportId);
  for (const suffix of ["А", "Б", "В", "Г"]) assert.ok((await page.locator("#briefing-source-content").innerText()).includes("ДЕМО показатель " + suffix));
  await page.locator("#briefing-source-close").click();
  await peek(page, "journal", "");
  const journal = await page.locator("#briefing-source-content").innerText();
  for (const number of ["ДЕМО-ОТКРЫТ", "ДЕМО-ПЕРИОД-ИСТЁК", "ДЕМО-additional-a", "ДЕМО-additional-b"]) assert.ok(journal.includes(number));
  await page.locator("#briefing-source-close").click();
  assert.equal(await page.locator("#repeat-fields input:checked").count(), 0);
  assert.equal(await raw(page), before);
});
