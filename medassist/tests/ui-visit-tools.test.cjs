"use strict";
const {clickAction: click} = require("./ui-actions.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.MEDASSIST_PLAYWRIGHT || "playwright");
const root = path.resolve(process.env.MEDASSIST_APP_ROOT || path.join(__dirname, "../app"));
const core = require(path.join(root, "core.js"));
const exam = require(path.join(root, "exam-options.js"));
const url = pathToFileURL(path.join(root, "index.html")).href;
const key = "medassist.demo.v4";
const patientId = "fictional-tools-patient";
const now = "2032-04-19T08:00:00.000Z";
const manual = "ДЕМО: запись врача, сохранённая вручную.";
const action = (page, name) => page.locator('[data-action="' + name + '"]').first();
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const current = async (page, id) => (await saved(page)).encounters.find(entry => entry.id === id);
const card = async page => (await saved(page)).patients.find(entry => entry.id === patientId);
const accept = page => page.locator("#dialog-accept").click();

async function openApp(t) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MEDASSIST_BROWSER ? {executablePath: process.env.MEDASSIST_BROWSER} : {channel: "msedge"}),
    args: ["--no-first-run", "--disable-background-networking"]
  });
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: {width: 1366, height: 900}, timezoneId: "Europe/Minsk"});
  await context.setOffline(true);
  context.setDefaultTimeout(5000);
  const errors = [], requests = [];
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  });
  t.after(() => {
    assert.deepEqual(errors, [], "no uncaught browser errors");
    assert.deepEqual(requests, [], "all clinical workflows remain offline");
  });
  const newPage = async () => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(now));
    await page.goto(url);
    await action(page, "patients").waitFor();
    return page;
  };
  return {page: await newPage(), newPage};
}

function visit(id = "tools-first", date = "2032-04-19", changes = {}) {
  const entry = core.createEncounter({id, patientId, now: date + "T08:00:00.000Z"});
  entry.history.complaints = "ДЕМО: вымышленные жалобы " + id;
  entry.draft.text = manual + " " + id;
  Object.assign(entry.assessment, changes);
  return entry;
}

async function seed(page, entries = [visit()], options = {}) {
  const patient = core.createPatient({id: patientId, label: "Тестов Пациент Вымышленный", now});
  const value = core.serializeBundle(entries, [patient, ...(options.patients || [])], options.templates || []);
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value});
  await page.reload();
  return value;
}

async function openCard(page) {
  await click(page, "patients");
  await page.locator('.patient-row[data-patient-id="' + patientId + '"] [data-action="patient"]').click();
}

async function openVisit(page, id = "tools-first", tab = "draft") {
  await openCard(page);
  await page.locator('#patient-history [data-action="open"][data-id="' + id + '"]').click();
  await page.locator('[data-action="tab"][data-tab="' + tab + '"]').first().click();
}

async function period(page, from, to) {
  await page.locator("#sick-leave-from").fill(from);
  await page.locator("#sick-leave-to").fill(to);
}

async function saveLeave(page) {
  await page.locator("#sick-leave-save").click();
  await page.locator("#sick-leave-dialog").waitFor({state: "hidden"});
}

async function repeat(page, date) {
  await page.clock.setFixedTime(new Date(date + "T08:00:00.000Z"));
  const before = new Set((await saved(page)).encounters.map(entry => entry.id));
  await openCard(page);
  await click(page, "repeat");
  await page.locator("#repeat-create").click();
  const entry = (await saved(page)).encounters.find(entry => !before.has(entry.id));
  await page.locator('[data-action="tab"][data-tab="draft"]').first().click();
  return entry.id;
}

async function openTemplates(page, kind) {
  await page.locator('[data-action="tab"][data-tab="' + (kind === "exam" ? "exam" : "draft") + '"]').first().click();
  await page.locator('[data-action="visit-templates"][data-template-kind="' + kind + '"]').click();
  await page.locator("#template-dialog").waitFor({state: "visible"});
}

test("visit issuance, overlapping repeat extension and closure persist one journal with 9 unique days", {timeout: 35000}, async t => {
  const {page} = await openApp(t);
  await seed(page); await openVisit(page);
  await click(page, "visit-sick-issue");
  await page.locator("#sick-leave-number").fill("ДЕМО-ЕДИНЫЙ-019");
  await period(page, "2032-04-19", "2032-04-23");
  await saveLeave(page);
  const issued = await current(page, "tools-first");
  const leaveId = (await card(page)).sickLeaves[0].id;
  assert.equal(issued.assessment.sickLeaveNumber, "ДЕМО-ЕДИНЫЙ-019");
  assert.equal(issued.draft.text, manual + " tools-first");
  assert.equal((await card(page)).sickLeaves[0].events[0].encounterId, issued.id);
  assert.equal(await page.locator("#sickleave-days").innerText(), "5");
  assert.equal(await action(page, "visit-sick-issue").count(), 0, "a linked visit cannot issue twice");
  const secondId = await repeat(page, "2032-04-23");
  await click(page, "visit-sick-extend");
  assert.equal(await page.locator("#sick-leave-select").inputValue(), "", "the clinician chooses the leaf explicitly");
  await page.locator("#sick-leave-select").selectOption("journal:" + leaveId);
  assert.equal(await page.locator("#sick-leave-number").inputValue(), "ДЕМО-ЕДИНЫЙ-019");
  await period(page, "2032-04-23", "2032-04-27");
  assert.match(await page.locator("#sick-leave-preview").innerText(), /9/);
  await saveLeave(page);
  assert.equal(await page.locator("#sickleave-days").innerText(), "9");
  assert.match(await page.locator("#sickleave-current-period").innerText(), /5/);
  assert.deepEqual(await current(page, issued.id), issued, "extension leaves previous visit intact");
  const second = await current(page, secondId);
  assert.equal(second.assessment.sickLeaveNumber, issued.assessment.sickLeaveNumber);
  assert.equal(second.assessment.sickLeaveFrom, "2032-04-23");
  await click(page, "generate");
  assert.match(await page.locator("#draft-text").inputValue(), /[Пп]родл/);
  assert.match(await page.locator("#draft-text").inputValue(), /9/);
  const thirdId = await repeat(page, "2032-04-27");
  await click(page, "visit-sick-close");
  await page.locator("#sick-leave-select").selectOption("journal:" + leaveId);
  await page.locator("#sick-leave-close-date").fill("2032-04-27");
  await saveLeave(page);
  await page.locator("#field-assessment-returnVisitDate").fill("2032-05-02");
  await click(page, "generate");
  const text = await page.locator("#draft-text").inputValue();
  assert.match(text, /[Зз]акры/);
  assert.match(text, /9/);
  assert.match(text.trim().split("\n").at(-1), /02\.05\.2032/);
  const bundle = await saved(page);
  const journal = core.getSickLeaveJournal(bundle.patients[0], bundle.encounters);
  assert.equal(journal.totalDays, 9);
  assert.equal(journal.legacy.length, 0);
  assert.equal(journal.leaves.length, 1);
  assert.deepEqual(journal.leaves[0].events.map(event => event.type), ["issue", "extend", "close"]);
  assert.deepEqual(journal.leaves[0].events.map(event => event.encounterId), [issued.id, secondId, thirdId]);
  await page.reload(); await openVisit(page, issued.id);
  assert.equal(await page.locator("#sickleave-days").innerText(), "5", "later events do not change old visit count");
  await openVisit(page, thirdId);
  assert.equal(await page.locator("#draft-text").inputValue(), text);
  await click(page, "visit-sick-undo"); await accept(page);
  assert.equal((await card(page)).sickLeaves[0].events.length, 2);
  assert.equal((await current(page, thirdId)).assessment.sickLeaveIssued, "");
  assert.equal((await current(page, thirdId)).draft.text, text, "undo does not rewrite a draft");
});

test("legacy leaf adoption and extension happen together only after explicit save", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const first = visit("tools-first", "2032-04-19", {sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-СТАРЫЙ", sickLeaveFrom: "2032-04-19", sickLeaveTo: "2032-04-23"});
  await seed(page, [first, visit("tools-second", "2032-04-23")]); await openVisit(page, "tools-second");
  const before = await raw(page);
  await click(page, "visit-sick-extend");
  await page.locator("#sick-leave-select").selectOption("legacy:tools-first");
  await period(page, "2032-04-23", "2032-04-27");
  await page.locator("#sick-leave-cancel").click();
  assert.equal(await raw(page), before);
  await click(page, "visit-sick-extend");
  await page.locator("#sick-leave-select").selectOption("legacy:tools-first");
  await period(page, "2032-04-23", "2032-04-27");
  await saveLeave(page);
  const result = await saved(page);
  assert.equal(result.patients[0].sickLeaves.length, 1);
  assert.equal(result.patients[0].sickLeaves[0].events.length, 2);
  assert.equal(core.getSickLeaveJournal(result.patients[0], result.encounters).legacy.length, 0);
  assert.deepEqual(result.encounters.find(entry => entry.id === first.id), first);
  assert.equal(await page.locator("#sickleave-days").innerText(), "9");
});

test("failed paired save keeps form values and a stale second window cannot add a duplicate", {timeout: 25000}, async t => {
  const {page, newPage} = await openApp(t);
  await seed(page); await openVisit(page);
  const other = await newPage(); await openVisit(other);
  for (const target of [page, other]) {
    await click(target, "visit-sick-issue");
    await target.locator("#sick-leave-number").fill("ДЕМО-АТОМАРНО");
    await period(target, "2032-04-19", "2032-04-23");
  }
  const before = await raw(page);
  await page.evaluate(key => {
    window.restoreDemoStorage = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("ДЕМО: место закончилось", "QuotaExceededError");
      return window.restoreDemoStorage.call(this, name, value);
    };
  }, key);
  await page.locator("#sick-leave-save").click();
  assert.equal(await raw(page), before, "neither encounter nor journal was partly saved");
  assert.equal(await page.locator("#sick-leave-number").inputValue(), "ДЕМО-АТОМАРНО");
  assert.equal(await page.locator("#sick-leave-dialog").isVisible(), true);
  assert.match(await page.locator("#sick-leave-error").innerText(), /сохран|место/i);
  await page.evaluate(() => { Storage.prototype.setItem = window.restoreDemoStorage; delete window.restoreDemoStorage; });
  await saveLeave(page);
  await other.locator("#sick-leave-error").waitFor({state: "visible"});
  await other.locator("#sick-leave-save").click();
  assert.match(await other.locator("#sick-leave-error").innerText(), /другом окне/);
  assert.equal((await card(page)).sickLeaves.length, 1);
  assert.equal((await card(page)).sickLeaves[0].events.length, 1);
});

test("previous visit panel shows only earlier history of this patient and never copies data", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const older = visit("tools-older", "2032-04-10");
  Object.assign(older.history, {medications: "ДЕМО: старый препарат", allergies: "ДЕМО: старое уточнение", conditions: "ДЕМО: заболевание"});
  older.exam.other = "ДЕМО: старый осмотр <script>";
  older.assessment.plan = "ДЕМО: прежняя рекомендация";
  const recent = visit("tools-recent", "2032-04-18");
  const active = visit();
  const future = visit("tools-future", "2032-05-01");
  const stranger = core.createPatient({id: "fictional-other", label: "Другой Вымышленный Пациент", now});
  const otherVisit = {...visit("tools-other", "2032-04-17"), patientId: stranger.id};
  await seed(page, [older, recent, active, future, otherVisit], {patients: [stranger]}); await openVisit(page);
  const before = await raw(page);
  await click(page, "previous-visit");
  assert.equal(await page.locator("#previous-visit-select").inputValue(), recent.id);
  const values = await page.locator("#previous-visit-select option").evaluateAll(options => options.map(option => option.value));
  assert.deepEqual(new Set(values), new Set([older.id, recent.id]));
  await page.locator("#previous-visit-select").selectOption(older.id);
  const panel = await page.locator("#previous-visit-panel").innerText();
  assert.match(panel, /старый препарат/);
  assert.match(panel, /старое уточнение/);
  assert.match(panel, /старый осмотр <script>/);
  assert.match(panel, /прежняя рекомендация/);
  assert.equal(await page.locator("#previous-visit-panel script").count(), 0);
  assert.equal(await page.locator("#draft-text").inputValue(), active.draft.text);
  for (const width of [1366, 800, 390]) {
    await page.setViewportSize({width, height: 900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no horizontal overflow at " + width);
  }
  await click(page, "previous-visit");
  assert.equal(await raw(page), before);
  assert.equal((await current(page, active.id)).history.medications, "");
});

test("exam templates preserve measurements and history, require replacement confirmation and keep manual drafts", {timeout: 25000}, async t => {
  const {page} = await openApp(t);
  const source = visit();
  source.examSelections = {...exam.NORMAL_SELECTIONS};
  source.exam.other = "ДЕМО: сохранённая формулировка осмотра";
  source.vitals.weight = "68";
  source.history.medications = "ДЕМО: не включать в шаблон";
  const target = visit("tools-target", "2032-04-23");
  target.exam.other = "ДЕМО: прежнее уточнение";
  target.vitals.weight = "77"; target.vitals.height = "180";
  const reviewed = core.setReviewStatus(target, "reviewed", {now});
  await seed(page, [source, reviewed]); await openVisit(page, source.id, "exam");
  await openTemplates(page, "exam");
  await page.locator("#template-name").fill("Мой осмотр <демо>");
  await page.locator("#template-save").click();
  const template = (await saved(page)).templates[0];
  assert.equal(template.kind, "exam");
  assert.deepEqual(Object.keys(template.content).sort(), ["exam", "examSelections"]);
  await page.locator("#template-close").click();
  await openVisit(page, target.id, "exam"); await openTemplates(page, "exam");
  await page.locator("#template-select").selectOption(template.id);
  const before = await raw(page);
  await page.locator("#template-apply").click(); await page.locator("#dialog-cancel").click();
  assert.equal(await raw(page), before);
  await page.locator("#template-apply").click(); await accept(page);
  await page.locator("#template-dialog").waitFor({state: "hidden"});
  const applied = await current(page, target.id);
  assert.deepEqual(applied.exam, source.exam);
  assert.deepEqual(applied.examSelections, source.examSelections);
  assert.deepEqual(applied.vitals, target.vitals);
  assert.deepEqual(applied.history, target.history);
  assert.equal(applied.draft.text, target.draft.text);
  assert.equal(applied.workflow.reviewStatus, "draft");
  await page.locator("#field-exam-other").fill("ДЕМО: исправленная формулировка");
  await openTemplates(page, "exam"); await page.locator("#template-select").selectOption(template.id);
  await page.locator("#template-update").click(); await accept(page);
  assert.equal((await saved(page)).templates.length, 1);
  assert.equal((await saved(page)).templates[0].content.exam.other, "ДЕМО: исправленная формулировка");
  await page.locator("#template-close").click();
  await page.reload(); await openVisit(page, target.id);
  assert.equal((await saved(page)).templates[0].content.exam.other, "ДЕМО: исправленная формулировка");
});

test("recommendation templates survive backup, import and clinical edits; delete needs confirmation", {timeout: 25000}, async t => {
  const {page, newPage} = await openApp(t);
  const first = visit();
  first.assessment.plan = "ДЕМО: личная формулировка рекомендаций";
  first.assessment.summary = "ДЕМО: диагноз не входит в шаблон";
  await seed(page, [first, visit("tools-target", "2032-04-23")]); await openVisit(page);
  await openTemplates(page, "recommendations");
  await page.locator("#template-name").fill("Демо-рекомендация");
  await page.locator("#template-save").click();
  const template = (await saved(page)).templates[0];
  assert.deepEqual(template.content, {plan: first.assessment.plan});
  await page.locator("#template-close").click();
  await openVisit(page, "tools-target"); await openTemplates(page, "recommendations");
  await page.locator("#template-select").selectOption(template.id);
  await page.locator("#template-apply").click();
  await page.locator("#template-dialog").waitFor({state: "hidden"});
  assert.equal(await page.locator("#field-assessment-plan").inputValue(), first.assessment.plan);
  assert.equal(await page.locator("#field-assessment-summary").inputValue(), "");
  await page.locator("#field-assessment-plan").fill(first.assessment.plan + " — вручную изменено.");
  assert.equal((await saved(page)).templates[0].content.plan, first.assessment.plan);
  await click(page, "help");
  const download = page.waitForEvent("download");
  await click(page, "backup");
  const artifact = await download;
  const chunks = [];
  for await (const chunk of await artifact.createReadStream()) chunks.push(chunk);
  const backup = Buffer.concat(chunks);
  assert.equal(core.parseBundle(backup.toString("utf8")).templates[0].id, template.id);
  const restored = await newPage();
  await click(restored, "help");
  await restored.locator("#import-file").setInputFiles({name: "fictional-tools.json", mimeType: "application/json", buffer: backup});
  await accept(restored);
  await openVisit(restored, "tools-target"); await openTemplates(restored, "recommendations");
  await restored.locator("#template-select").selectOption(template.id);
  const before = await raw(restored);
  await restored.locator("#template-delete").click(); await restored.locator("#dialog-cancel").click();
  assert.equal(await raw(restored), before);
  await restored.locator("#template-delete").click(); await accept(restored);
  assert.equal(((await saved(restored)).templates || []).length, 0);
  assert.equal((await current(restored, "tools-target")).assessment.plan, first.assessment.plan + " — вручную изменено.");
});

test("empty template actions do not save empty patients; stale template windows show visible conflict", {timeout: 20000}, async t => {
  const {page, newPage} = await openApp(t);
  await click(page, "new");
  const initial = await raw(page);
  await openTemplates(page, "exam");
  await page.locator("#template-name").fill("Пустой шаблон");
  await page.locator("#template-save").click();
  assert.equal(await raw(page), initial);
  assert.equal(await page.locator("#template-error").isVisible(), true);
  await page.locator("#template-close").click();
  const first = visit(); first.assessment.plan = "ДЕМО: рекомендация";
  await seed(page, [first]); await openVisit(page);
  const other = await newPage(); await openVisit(other);
  await openTemplates(other, "recommendations");
  await other.locator("#template-name").fill("Конфликтующий шаблон");
  await openTemplates(page, "recommendations");
  await page.locator("#template-name").fill("Первый шаблон");
  await page.locator("#template-save").click();
  await other.locator("#template-save").click();
  assert.match(await other.locator("#template-error").innerText(), /другом окне/);
  assert.equal((await saved(page)).templates.length, 1);
  assert.equal((await saved(page)).templates[0].name, "Первый шаблон");
});

test("new patient leaf cancel writes nothing and issuance saves patient, visit and journal together", {timeout: 15000}, async t => {
  const {page} = await openApp(t);
  await click(page, "new");
  await page.locator('[data-action="tab"][data-tab="draft"]').first().click();
  const before = await raw(page);
  await click(page, "visit-sick-issue");
  await page.locator("#sick-leave-number").fill("ДЕМО-НОВАЯ-КАРТОЧКА");
  await period(page, "2032-04-19", "2032-04-23");
  await page.locator("#sick-leave-cancel").click();
  assert.equal(await raw(page), before);
  await click(page, "visit-sick-issue");
  await page.locator("#sick-leave-number").fill("ДЕМО-НОВАЯ-КАРТОЧКА");
  await period(page, "2032-04-19", "2032-04-23");
  await saveLeave(page);
  const result = await saved(page);
  assert.equal(result.patients.length, 1);
  assert.equal(result.encounters.length, 1);
  assert.equal(result.patients[0].sickLeaves[0].events[0].encounterId, result.encounters[0].id);
  assert.equal(result.encounters[0].patientId, result.patients[0].id);
  assert.equal(result.encounters[0].assessment.sickLeaveNumber, "ДЕМО-НОВАЯ-КАРТОЧКА");
  assert.equal(await page.locator("#sickleave-days").innerText(), "5");
});

test("template save failure keeps its name and does not lose existing templates on retry", {timeout: 18000}, async t => {
  const {page} = await openApp(t);
  const first = visit(); first.assessment.plan = "ДЕМО: текст для повторной попытки";
  await seed(page, [first]); await openVisit(page);
  await openTemplates(page, "recommendations");
  await page.locator("#template-name").fill("ДЕМО: существующий");
  await page.locator("#template-save").click();
  const oldTemplate = (await saved(page)).templates[0];
  await page.locator("#template-name").fill("ДЕМО: второй");
  const before = await raw(page);
  await page.evaluate(key => {
    window.restoreTemplateStorage = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("ДЕМО: место закончилось", "QuotaExceededError");
      return window.restoreTemplateStorage.call(this, name, value);
    };
  }, key);
  await page.locator("#template-save").click();
  assert.equal(await raw(page), before);
  assert.equal(await page.locator("#template-name").inputValue(), "ДЕМО: второй");
  assert.match(await page.locator("#template-error").innerText(), /сохран|место/i);
  await page.evaluate(() => { Storage.prototype.setItem = window.restoreTemplateStorage; delete window.restoreTemplateStorage; });
  await page.locator("#template-save").click();
  const templates = (await saved(page)).templates;
  assert.equal(templates.length, 2);
  assert.deepEqual(templates.find(item => item.id === oldTemplate.id), oldTemplate);
  assert.ok(templates.some(item => item.name === "ДЕМО: второй"));
});
