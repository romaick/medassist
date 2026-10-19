"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.MEDASSIST_PLAYWRIGHT || "playwright");

const appRoot = path.resolve(process.env.MEDASSIST_APP_ROOT || path.join(__dirname, "../app"));
const core = require(path.join(appRoot, "core.js"));
const examCatalog = require(path.join(appRoot, "exam-options.js"));
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

test('sick leave day counter updates the entered period, hides inactive leave and preserves manual text until generation', {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const data = fixture();
  await seed(page, data); await openVisit(page, 'demo-today'); await tab(page, 'draft');
  const status = page.locator('[data-field="assessment.sickLeaveIssued"]');
  const from = page.locator('[data-field="assessment.sickLeaveFrom"]');
  const to = page.locator('[data-field="assessment.sickLeaveTo"]');
  const counter = page.locator('#sickleave-days');
  const manual = await page.locator('#draft-text').inputValue();
  assert.equal(await counter.isVisible(), false);
  await status.selectOption('yes');
  assert.equal(await counter.innerText(), '—');
  await from.fill('2032-02-28');
  assert.equal(await counter.innerText(), '—');
  await to.fill('2032-03-01');
  assert.equal(await counter.innerText(), '3');
  assert.equal(await to.evaluate(node => node === document.activeElement), true);
  assert.match(await page.locator('#sickleave-days-hint').innerText(), /обе даты и выходные включены/);
  await to.fill('2032-02-28');
  assert.equal(await counter.innerText(), '1');
  await to.fill('2032-02-27');
  assert.equal(await counter.innerText(), '—');
  assert.equal(await to.getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('#field-assessment-sickLeaveTo-error').isVisible(), true);
  await to.fill('');
  assert.equal(await counter.innerText(), '—');
  await from.fill('2031-12-31'); await to.fill('2032-01-02');
  assert.equal(await counter.innerText(), '3');
  await status.selectOption('no');
  assert.equal(await counter.isVisible(), false);
  await status.selectOption('yes');
  assert.equal(await counter.innerText(), '3');
  assert.equal(await from.inputValue(), '2031-12-31');
  assert.equal(await to.inputValue(), '2032-01-02');
  assert.equal(await page.locator('#draft-text').inputValue(), manual);
  await page.reload(); await openVisit(page, 'demo-today'); await tab(page, 'draft');
  const before = await raw(page);
  assert.equal(await counter.innerText(), '3');
  assert.equal(await page.locator('#draft-text').inputValue(), manual);
  for (const width of [1366, 800, 390]) {
    await page.setViewportSize({width, height:844});
    await counter.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.equal(await raw(page), before, 'reading the calculated value does not save or change the schema');
  await click(page, 'generate'); await cancel(page);
  assert.equal(await page.locator('#draft-text').inputValue(), manual);
  await click(page, 'generate'); await accept(page);
  const generated = await page.locator('#draft-text').inputValue();
  assert.match(generated, /Период: с 31\.12\.2031 по 02\.01\.2032\. Календарных дней: 3\./);
  assert.equal(generated.split('\n').at(-1), 'Повторный приём: 15.04.2032');
  await markReviewed(page); await to.fill('2032-01-03');
  assert.equal(await counter.innerText(), '4');
  assert.equal(await page.locator('#draft-text').inputValue(), generated, 'date changes keep the manually editable draft intact');
  await assertReview(page, 'demo-today', 'draft');
});

test('sick leave day counter in the patient list describes each period without adding overlapping records', {timeout:20000}, async t => {
  const {page} = await openApp(t);
  const data = fixture();
  Object.assign(data.encounters[0].assessment, {sickLeaveIssued:'yes', sickLeaveNumber:'ДЕМО-101', sickLeaveFrom:'2032-04-14', sickLeaveTo:'2032-04-16'});
  Object.assign(data.encounters[1].assessment, {sickLeaveIssued:'yes', sickLeaveNumber:'ДЕМО-101', sickLeaveFrom:'2032-04-14', sickLeaveTo:'2032-04-16'});
  Object.assign(data.encounters[2].assessment, {sickLeaveIssued:'yes', sickLeaveNumber:'ДЕМО-102', sickLeaveFrom:'2032-04-15', sickLeaveTo:'2032-04-18'});
  Object.assign(data.encounters[4].assessment, {sickLeaveIssued:'yes', sickLeaveNumber:'ДЕМО-201', sickLeaveFrom:'2032-04-15', sickLeaveTo:''});
  await seed(page, data); const initial = await raw(page); await click(page, 'patients');
  const first = page.locator('[data-patient-id="demo-patient-a"].patient-row');
  assert.equal(await first.locator('.patient-sick').count(), 2, 'identical period display remains deduplicated');
  assert.equal(await first.locator('.patient-sick').filter({hasText:'ДЕМО-101'}).locator('.patient-sick-days').innerText(), 'Календарных дней: 3');
  assert.equal(await first.locator('.patient-sick').filter({hasText:'ДЕМО-102'}).locator('.patient-sick-days').innerText(), 'Календарных дней: 4');
  const second = page.locator('[data-patient-id="demo-patient-b"].patient-row');
  assert.equal(await second.locator('.patient-sick-days').count(), 0);
  assert.match(await second.locator('.patient-sick').innerText(), /окончание не указано/);
  for(const width of [1366,800,390]) {
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
  }
  assert.equal(await raw(page), initial);
});

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
  await page.reload(); await filter(page, "record", "reviewed"); await openVisit(page, "demo-today"); await tab(page, "draft");
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
  await click(page, "home"); await openVisit(page, "demo-today"); await tab(page, "basic");
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

test("compact exam starts closed, exposes measurements first and supports keyboard and all-section controls without saving", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page); await openVisit(page, "demo-today"); await tab(page, "exam");
  const before = await raw(page);
  assert.equal(await page.locator('.exam-group').count(), 5);
  assert.equal(await page.locator('.exam-group[open]').count(), 0);
  assert.equal(await page.locator('.exam-selected-preview').allTextContents().then(texts => texts.every(text => text === 'Признаки не выбраны')), true);
  assert.equal(await page.locator('.exam-workspace .side-card').count(), 0);
  const firstSummary = page.locator('[data-exam-section="general"] > summary');
  await firstSummary.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-field="examSelections.generalCondition"]').isVisible(), true);
  await firstSummary.focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('.exam-group[open]').count(), 0);
  await click(page, 'expand-exam');
  assert.equal(await page.locator('.exam-group[open]').count(), 5);
  await click(page, 'collapse-exam');
  assert.equal(await page.locator('.exam-group[open]').count(), 0);
  assert.equal(await raw(page), before, 'view controls do not write records');
  for (const width of [1366, 800, 390]) {
    await page.setViewportSize({ width, height: 768 });
    const layout = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= innerWidth,
      measuresBottom: document.querySelector('.exam-measurements').getBoundingClientRect().bottom,
      firstGroupTop: document.querySelector('.exam-group').getBoundingClientRect().top
    }));
    assert.equal(layout.fits, true, 'compact examination fits width ' + width);
    assert.ok(layout.measuresBottom < layout.firstGroupTop, 'measurements precede descriptions');
  }
});

test("compact exam summaries show only selected facts and visible notes; edits keep focus and BMI", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  const data = fixture();
  const entry = data.encounters[0];
  entry.examSelections.heartRhythm = 'irregular';
  entry.exam.cardiovascular = 'ДЕМО: уточнение <проверить> ' + 'подробность '.repeat(30);
  await seed(page, data); await openVisit(page, entry.id); await tab(page, 'exam');
  const group = page.locator('[data-exam-section="cardiovascular"]');
  const preview = group.locator('.exam-preview');
  assert.equal(await group.getAttribute('open'), null);
  assert.match(await preview.innerText(), /Тоны сердца аритмичные/);
  assert.doesNotMatch(await preview.innerText(), /Тоны сердца ясные|Шумы сердца не выслушиваются/);
  assert.match(await preview.innerText(), /Уточнение: ДЕМО: уточнение <проверить>/);
  assert.match(await preview.innerText(), /Открыть полный текст и поля/);
  assert.equal(await preview.locator('проверить').count(), 0, 'saved text is escaped');
  await group.locator(':scope > summary').click({ position: { x: 12, y: 15 } });
  assert.equal(await group.locator('.exam-note[open]').count(), 1);
  const rhythm = page.locator('[data-field="examSelections.heartRhythm"]');
  await rhythm.focus(); await rhythm.selectOption('regular');
  assert.equal(await rhythm.evaluate(node => document.activeElement === node), true);
  assert.match(await preview.innerText(), /Тоны сердца ритмичные/);
  assert.doesNotMatch(await preview.innerText(), /аритмичные/);
  await rhythm.selectOption('');
  assert.match(await preview.innerText(), /Признаки не выбраны/);
  const note = page.locator('[data-field="exam.cardiovascular"]');
  assert.equal(await note.inputValue(), entry.exam.cardiovascular);
  await note.fill('ДЕМО: короткое уточнение.');
  assert.equal(await note.evaluate(node => document.activeElement === node), true);
  assert.match(await preview.innerText(), /ДЕМО: короткое уточнение\./);
  await page.locator('[data-field="vitals.weight"]').fill('72');
  await page.locator('[data-field="vitals.height"]').fill('180');
  assert.equal(await page.locator('#bmi-value').innerText(), '22,2');
  assert.equal(await page.locator('[data-field="vitals.height"]').evaluate(node => document.activeElement === node), true);
  const stored = (await saved(page)).encounters.find(value => value.id === entry.id);
  assert.equal(stored.exam.cardiovascular, 'ДЕМО: короткое уточнение.');
  assert.deepEqual(stored.draft, entry.draft, 'editing the summary does not rewrite manual text');
});

test("compact exam normal buttons preserve collapsed groups, expanded notes, measurements and confirmation", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  const data = fixture(), entry = data.encounters[0];
  entry.examSelections.heartRhythm = 'irregular';
  entry.exam.general = 'ДЕМО: сохранить уточнение общего осмотра.';
  entry.exam.cardiovascular = 'ДЕМО: сохранить уточнение сердца.';
  entry.vitals.weight = '72'; entry.vitals.height = '180';
  await seed(page, data); await openVisit(page, entry.id); await tab(page, 'exam');
  const general = page.locator('[data-exam-section="general"]');
  const cardio = page.locator('[data-exam-section="cardiovascular"]');
  await general.locator(':scope > summary').click({ position: { x: 12, y: 15 } });
  await general.locator('.exam-note > summary').click();
  const normalCardio = cardio.locator('[data-action="normal-exam-section"]');
  const before = await raw(page);
  await normalCardio.click(); await cancel(page);
  assert.equal(await raw(page), before);
  assert.equal(await cardio.getAttribute('open'), null);
  await normalCardio.click(); await accept(page);
  assert.deepEqual(await listedIds(page, '.exam-group[open]', 'data-exam-section'), ['general']);
  assert.equal(await general.locator('.exam-note[open]').count(), 0, 'closed note stays closed');
  assert.equal(await cardio.locator('.exam-note[open]').count(), 1, 'existing note state survives the render');
  assert.equal(await normalCardio.evaluate(node => document.activeElement === node), true);
  let stored = (await saved(page)).encounters.find(value => value.id === entry.id);
  assert.equal(stored.examSelections.generalCondition, '', 'section button changes only its section');
  assert.equal(stored.examSelections.heartRhythm, 'regular');
  assert.deepEqual(stored.exam, entry.exam); assert.deepEqual(stored.vitals, entry.vitals); assert.deepEqual(stored.draft, entry.draft);
  await click(page, 'normal-exam');
  assert.deepEqual(await listedIds(page, '.exam-group[open]', 'data-exam-section'), ['general']);
  await click(page, 'collapse-exam'); await click(page, 'normal-exam');
  assert.equal(await page.locator('.exam-group[open]').count(), 0, 'normal-all leaves every closed group closed');
  stored = (await saved(page)).encounters.find(value => value.id === entry.id);
  assert.deepEqual(stored.examSelections, examCatalog.NORMAL_SELECTIONS);
  assert.deepEqual(stored.exam, entry.exam); assert.deepEqual(stored.vitals, entry.vitals); assert.deepEqual(stored.draft, entry.draft);
  assert.equal(await page.locator('#bmi-value').innerText(), '22,2');
});

test("compact exam validation reveals the hidden erroneous field without losing entered text", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page); await openVisit(page, 'demo-today'); await tab(page, 'exam');
  const group = page.locator('[data-exam-section="general"]');
  await group.locator(':scope > summary').click({ position: { x: 12, y: 15 } });
  await group.locator('.exam-note > summary').click();
  const note = page.locator('[data-field="exam.general"]');
  await note.evaluate(node => node.removeAttribute('maxlength'));
  const invalid = 'ДЕМО: ' + 'я'.repeat(core.MAX_TEXT_LENGTH);
  const before = await raw(page);
  await note.fill(invalid);
  assert.equal(await note.getAttribute('aria-invalid'), 'true');
  assert.equal(await raw(page), before, 'invalid data does not replace saved records');
  await click(page, 'collapse-exam'); await tab(page, 'draft'); await click(page, 'generate');
  assert.equal(await group.getAttribute('open'), '');
  assert.equal(await group.locator('.exam-note[open]').count(), 1);
  assert.equal(await note.inputValue(), invalid);
  assert.equal(await note.evaluate(node => document.activeElement === node), true);
  assert.equal(await page.locator('#field-exam-general-error').isVisible(), true);
  await note.fill('ДЕМО: исправленное описание.');
  assert.equal(await note.getAttribute('aria-invalid'), 'false');
  assert.equal((await saved(page)).encounters.find(value => value.id === 'demo-today').exam.general, 'ДЕМО: исправленное описание.');
});

test("invalid clinical fields prevent review even when the draft text is nonempty", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page); await openVisit(page, "demo-today"); await tab(page, "basic");
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
  await seed(page); await openVisit(page, "demo-today"); await tab(page, "basic");
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

test("starting a visit chooses a patient; abandoned new forms and whitespace never create stored cards", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  assert.equal(await raw(page), null);
  await click(page, 'start-visit');
  assert.equal(await page.locator('#patient-search').isVisible(), true);
  assert.equal(await page.locator('#patient-search').evaluate(node => node === document.activeElement), true);
  assert.equal(await raw(page), null);
  await click(page, 'new');
  await page.getByLabel('ФИО пациента', { exact: true }).fill('   ');
  await page.locator('[data-field="visitDate"]').fill(today);
  for (const name of ['history', 'exam', 'draft', 'basic']) {
    await tab(page, name);
    if (name === 'history') await page.locator('[data-field="history.complaints"]').fill(' \n ');
    if (name === 'exam') await page.locator('[data-field="exam.other"]').fill('   ');
    if (name === 'draft') await page.locator('#draft-text').fill(' \n ');
    assert.equal(await raw(page), null, 'empty tab ' + name + ' must not create records');
  }
  await click(page, 'home');
  assert.equal(await raw(page), null);
  await click(page, 'new'); await page.reload();
  assert.equal(await raw(page), null, 'reopening the program drops a new untouched form');
  await seed(page); const initial = await raw(page);
  await click(page, 'new'); await tab(page, 'history'); await click(page, 'patients');
  assert.equal(await raw(page), initial, 'abandoning a new form also preserves an existing bundle byte for byte');
  assert.equal(await page.locator('.patient-row').count(), 2);
  await page.reload(); assert.equal(await raw(page), initial);
});

test("the first meaningful name, clinical input, examination, date or manual text saves one new patient and encounter", { timeout: 30000 }, async t => {
  const { page } = await openApp(t);
  const cases = [
    { tab: 'basic', value: 'Тестова Анна Новая' },
    { tab: 'history', selector: '[data-field="history.complaints"]', value: 'ДЕМО: учебная жалоба' },
    { tab: 'basic', selector: '[data-field="visitDate"]', value: '2032-04-14' },
    { tab: 'draft', selector: '#draft-text', value: 'ДЕМО: ручная учебная запись' },
    { tab: 'exam', action: 'normal-exam' }
  ];
  for (const [index, change] of cases.entries()) {
    const before = await raw(page);
    await click(page, 'new'); await tab(page, change.tab);
    assert.equal(await raw(page), before);
    if (change.action) await click(page, change.action);
    else if (index === 0) await page.getByLabel('ФИО пациента', { exact: true }).fill(change.value);
    else await page.locator(change.selector).fill(change.value);
    const data = await saved(page);
    assert.equal(data.patients.length, index + 1);
    assert.equal(data.encounters.length, index + 1);
    const entry = data.encounters.at(-1);
    assert.equal(entry.patientId, data.patients.at(-1).id);
    if (change.action) assert.ok(Object.values(entry.examSelections).some(Boolean));
    else if (index === 0) assert.equal(data.patients.at(-1).label, change.value);
    else if (change.tab === 'history') assert.equal(entry.history.complaints, change.value);
    else if (change.tab === 'draft') assert.equal(entry.draft.text, change.value);
    else assert.equal(entry.visitDate, change.value);
    assert.match(await page.locator('#save-status').innerText(), /Сохранено/);
    await tab(page, 'history');
    await page.locator('[data-field="history.complaints"]').fill('ДЕМО: дополнение ' + index);
    assert.equal((await saved(page)).encounters.length, index + 1, 'continued typing does not create a second encounter');
    await page.reload();
    assert.equal((await saved(page)).encounters.length, index + 1, 'first meaningful input survives restart');
  }
});

test("failed first save retains the new form and a later successful input saves it exactly once", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await click(page, 'new');
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    window.restoreDemoStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('ДЕМО: хранилище заполнено', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, key);
  await page.getByLabel('ФИО пациента', { exact: true }).fill('Тестова Анна Несохранённая');
  assert.equal(await raw(page), null);
  assert.match(await page.locator('#save-status').innerText(), /не сохранены/);
  assert.equal(await page.locator('#storage-banner').isVisible(), true);
  assert.equal(await page.getByLabel('ФИО пациента', { exact: true }).inputValue(), 'Тестова Анна Несохранённая');
  await page.evaluate(() => window.restoreDemoStorage());
  await tab(page, 'history');
  await page.locator('[data-field="history.complaints"]').fill('ДЕМО: сведения сохранены после восстановления');
  const result = await saved(page);
  assert.equal(result.patients.length, 1);
  assert.equal(result.encounters.length, 1);
  assert.equal(result.patients[0].label, 'Тестова Анна Несохранённая');
  assert.equal(result.encounters[0].history.complaints, 'ДЕМО: сведения сохранены после восстановления');
  assert.match(await page.locator('#save-status').innerText(), /Сохранено/);
  await page.reload(); assert.deepEqual(await saved(page), result);
});

test("review after a failed first save commits the pending patient, entered text and confirmed review together", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await click(page, 'new'); await tab(page, 'draft');
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    window.restoreDemoStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('ДЕМО: первое сохранение недоступно', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, key);
  const text = 'ДЕМО: запись проверена после восстановления хранилища';
  await page.locator('#draft-text').fill(text);
  assert.equal(await raw(page), null);
  await markReviewed(page);
  assert.equal(await raw(page), null, 'review while storage is still unavailable must not save a partial bundle');
  assert.match(await page.locator('#visit-record-status').innerText(), /Черновик/);
  assert.match(await page.locator('#toast').innerText(), /[Нн]е удалось сохранить/);
  assert.equal(await page.locator('#draft-text').inputValue(), text);
  await page.evaluate(() => window.restoreDemoStorage());
  await markReviewed(page);
  const result = await saved(page);
  assert.equal(result.patients.length, 1, 'review must save the pending patient');
  assert.equal(result.encounters.length, 1, 'review must save the pending encounter');
  assert.equal(result.encounters[0].patientId, result.patients[0].id);
  assert.equal(result.encounters[0].draft.text, text);
  await assertReview(page, result.encounters[0].id, 'reviewed');
  assert.match(await page.locator('#visit-record-status').innerText(), /Проверено врачом/);
  await page.reload(); await filter(page, 'record', 'reviewed'); await openVisit(page, result.encounters[0].id); await tab(page, 'draft');
  await assertReview(page, result.encounters[0].id, 'reviewed');
  assert.equal(await page.locator('#draft-text').inputValue(), text);
});

async function downloadedBackup(page) {
  const downloadReady = page.waitForEvent('download');
  await click(page, 'backup');
  const stream = await (await downloadReady).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
}

test("backup omits abandoned blank forms but includes meaningful pending data after a failed save", { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await click(page, 'new'); await click(page, 'help');
  const blank = await downloadedBackup(page);
  assert.deepEqual(blank.patients, []);
  assert.deepEqual(blank.encounters, []);
  assert.equal(await raw(page), null, 'making a blank backup does not create stored cards');
  await click(page, 'new');
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('ДЕМО: сохранение недоступно', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, key);
  await page.getByLabel('ФИО пациента', { exact: true }).fill('Тестова Анна Для Копии');
  await tab(page, 'draft');
  const text = 'ДЕМО: несохранённый текст для резервной копии';
  await page.locator('#draft-text').fill(text);
  assert.equal(await raw(page), null);
  const backup = await downloadedBackup(page);
  assert.equal(backup.patients.length, 1);
  assert.equal(backup.encounters.length, 1);
  assert.equal(backup.patients[0].label, 'Тестова Анна Для Копии');
  assert.equal(backup.encounters[0].patientId, backup.patients[0].id);
  assert.equal(backup.encounters[0].draft.text, text);
  assert.equal(backup.encounters[0].workflow.reviewStatus, 'draft');
  assert.equal(await raw(page), null, 'download remains available without pretending that browser storage succeeded');
});

test("two windows: a pending new form cannot overwrite a later edit or create a stray card", { timeout: 20000 }, async t => {
  const { page, newPage } = await openApp(t);
  await seed(page); await click(page, 'new');
  const second = await newPage();
  await openVisit(second, 'demo-today'); await tab(second, 'history');
  await second.locator('[data-field="history.complaints"]').fill('ДЕМО: более новая запись во втором окне');
  await page.waitForFunction(() => document.getElementById('storage-banner').textContent.includes('другом окне'));
  const latest = await raw(page);
  await page.getByLabel('ФИО пациента', { exact: true }).fill('Тестова Анна Из Первого Окна');
  assert.equal(await raw(page), latest);
  assert.match(await page.locator('#save-status').innerText(), /не сохранены/);
  assert.equal(await page.locator('#storage-banner').isVisible(), true);
  assert.match(await page.locator('#storage-banner').innerText(), /другом окне/);
  await tab(page, 'history');
  await page.locator('[data-field="history.complaints"]').fill('ДЕМО: ввод в несохранённой новой карточке');
  assert.equal(await raw(page), latest, 'repeated input still cannot overwrite the newer bundle');
  assert.equal((await saved(page)).patients.length, 2);
  assert.equal((await saved(page)).encounters.length, 5);
  await click(page, 'reload'); await accept(page);
  assert.equal(await raw(page), latest, 'explicit reload discards the pending form without creating records');
  await click(page, 'patients'); assert.equal(await page.locator('.patient-row').count(), 2);
});

async function visibleInViewport(locator) {
  return locator.evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
  });
}

function overviewFixture() {
  const patients = [
    core.createPatient({ id: 'today-patient-a', now, label: 'Тестова Анна <Учебная>' }),
    core.createPatient({ id: 'today-patient-b', now, label: 'Тестов Борис Учебный' })
  ];
  const entry = (id, visitDate, updatedAt, returnDate = '', reviewed = false, completed = false) => {
    let result = core.createEncounter({ id, patientId: patients[id === 'reviewed-today' ? 1 : 0].id, now });
    result.visitDate = visitDate;
    result.updatedAt = updatedAt;
    result.assessment.returnVisitDate = returnDate;
    result.history.medications = 'ДЕМО: постоянный препарат из исходного приёма';
    result.history.allergies = 'ДЕМО: сведения об аллергии для подтверждения';
    result.history.conditions = 'ДЕМО: заболевание из исходного приёма';
    result.draft.text = 'ДЕМО: вымышленная запись ' + id;
    if (reviewed) result = core.setReviewStatus(result, 'reviewed', { now });
    if (completed) result = core.setReturnVisitStatus(result, 'completed');
    return result;
  };
  return { patients, encounters: [
    entry('draft-older', '2032-04-10', '2032-04-15T09:00:00.000Z', today),
    entry('draft-today-a', today, '2032-04-15T06:00:00.000Z'),
    entry('draft-today-b', today, '2032-04-15T08:00:00.000Z'),
    entry('reviewed-today', today, '2032-04-15T10:00:00.000Z', '', true),
    entry('completed-today', '2032-04-12', '2032-04-12T07:00:00.000Z', today, true, true),
    entry('due-tomorrow', '2032-04-13', '2032-04-13T07:00:00.000Z', '2032-04-16', true)
  ] };
}

const homeIds = page => listedIds(page, '#visit-list [data-record-id]', 'data-record-id');
const homeFollowups = page => listedIds(page, '#home-followup-list [data-followup-id]', 'data-followup-id');
const resumeCurrent = page => page.locator('#home-current [data-action="resume-visit"]');
const homeRepeat = page => page.locator('#home-followup-list [data-action="start-followup"]');

test('today overview handles empty and fully reviewed data without creating records', { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  assert.equal(await page.locator('h1').innerText(), 'Сегодня');
  assert.equal(await resumeCurrent(page).count(), 0);
  assert.deepEqual(await homeIds(page), []);
  assert.deepEqual(await homeFollowups(page), []);
  assert.equal(await raw(page), null);
  await click(page, 'new'); await click(page, 'home');
  assert.equal(await resumeCurrent(page).count(), 0, 'an untouched pending form is not an unfinished patient');
  assert.equal(await raw(page), null);
  const data = overviewFixture();
  data.encounters = data.encounters.map(entry => core.setReviewStatus(entry, 'reviewed', { now }));
  await seed(page, data);
  const before = await raw(page);
  assert.equal(await resumeCurrent(page).count(), 0);
  assert.deepEqual(await homeIds(page), []);
  assert.equal(await page.locator('[data-action="record-filter"][data-filter="draft"]').getAttribute('aria-pressed'), 'true');
  assert.equal((await page.locator('#home-review-today-count').innerText()).trim(), '0');
  await filter(page, 'record', 'all'); assert.equal((await homeIds(page)).length, 6);
  await filter(page, 'record', 'reviewed'); assert.equal((await homeIds(page)).length, 6);
  assert.equal(await raw(page), before, 'viewing finished records does not change review status');
});

test('today overview orders drafts, excludes completed appointments and resumes the chosen visit without writes', { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page, overviewFixture());
  const before = await raw(page);
  assert.match(await page.locator('#home-record-heading').innerText(), /Записи для проверки/);
  assert.deepEqual(await homeIds(page), ['draft-today-b', 'draft-today-a', 'draft-older']);
  assert.deepEqual(await homeFollowups(page), ['draft-older']);
  assert.equal((await page.locator('#home-followup-count').innerText()).trim(), '1');
  assert.equal((await page.locator('#home-review-today-count').innerText()).trim(), '2');
  assert.equal(await resumeCurrent(page).getAttribute('data-id'), 'draft-older', 'latest updated draft is recoverable even if its visit date is older');
  assert.match(await page.locator('#home-current').innerText(), /Тестова Анна <Учебная>/);
  assert.equal(await page.locator('#home-current script').count(), 0);
  await resumeCurrent(page).click();
  assert.equal(await page.locator('[data-field="visitDate"]').inputValue(), '2032-04-10');
  await tab(page, 'history'); await click(page, 'home');
  await resumeCurrent(page).click();
  assert.equal(await page.locator('[data-field="history.complaints"]').isVisible(), true, 'resume preserves the in-memory encounter tab');
  await click(page, 'home'); await openVisit(page, 'draft-today-a');
  assert.equal(await page.locator('#draft-text').isVisible(), true, 'the review queue opens the record text directly');
  await click(page, 'home');
  assert.equal(await resumeCurrent(page).getAttribute('data-id'), 'draft-today-a', 'the active draft takes precedence over latest update time');
  await page.reload();
  assert.equal(await resumeCurrent(page).getAttribute('data-id'), 'draft-older', 'restart recovers latest saved draft without a separate active-id save');
  assert.equal(await raw(page), before, 'overview, resume, queue opening and restart are read-only');
});

test('today review queue removes only confirmed reviews and includes records again after an edit', { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page, overviewFixture());
  await openVisit(page, 'draft-today-b');
  assert.equal(await page.locator('#draft-text').isVisible(), true);
  const before = await raw(page);
  await click(page, 'review-record'); await cancel(page);
  assert.equal(await raw(page), before);
  await markReviewed(page); await click(page, 'home');
  assert.deepEqual(await homeIds(page), ['draft-today-a', 'draft-older']);
  assert.equal((await page.locator('#home-review-today-count').innerText()).trim(), '1');
  await filter(page, 'record', 'reviewed'); await openVisit(page, 'draft-today-b');
  await tab(page, 'draft'); await page.locator('#draft-text').fill('ДЕМО: уточнение после проверки');
  await click(page, 'home'); await filter(page, 'record', 'draft');
  assert.ok((await homeIds(page)).includes('draft-today-b'));
  assert.equal((await page.locator('#home-review-today-count').innerText()).trim(), '2');
  assert.equal((await saved(page)).encounters.find(entry => entry.id === 'reviewed-today').workflow.reviewStatus, 'reviewed');
});

test('today appointments keep explicit carry confirmation, cancel safely and reuse a linked repeat without marking attendance', { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page, overviewFixture());
  assert.equal(await page.locator('#home-followup-list [data-action="followup-complete"]').count(), 0, 'home does not imply attendance');
  const before = await raw(page);
  await homeRepeat(page).click();
  assert.equal(await page.locator('#repeat-source').inputValue(), 'draft-older');
  assert.equal(await page.locator('#repeat-source').isDisabled(), true);
  assert.equal(await page.locator('#repeat-fields input:checked').count(), 0);
  await page.locator('#repeat-cancel').click();
  assert.equal(await raw(page), before);
  await homeRepeat(page).click();
  await page.locator('#repeat-fields input[value="medications"]').check();
  await page.locator('#repeat-create').click();
  let data = await saved(page);
  const source = data.encounters.find(entry => entry.id === 'draft-older');
  const repeated = data.encounters.find(entry => entry.id === source.workflow.returnVisitEncounterId);
  assert.equal(data.encounters.length, 7);
  assert.equal(repeated.history.medications, source.history.medications);
  assert.equal(repeated.history.allergies, '');
  assert.equal(repeated.history.conditions, '');
  assert.equal(source.workflow.returnVisitStatus, 'planned');
  await click(page, 'home');
  assert.deepEqual(await homeFollowups(page), ['draft-older']);
  assert.match(await homeRepeat(page).innerText(), /Открыть начатый приём/);
  await homeRepeat(page).click();
  assert.equal(await page.locator('#repeat-dialog').isVisible(), false);
  await page.reload(); await homeRepeat(page).click();
  data = await saved(page);
  assert.equal(data.encounters.length, 7, 'the home shortcut preserves one linked encounter across restart');
  assert.equal(data.encounters.find(entry => entry.id === 'draft-older').workflow.returnVisitStatus, 'planned');
  await click(page, 'home'); await click(page, 'home-followups');
  assert.deepEqual(await listedIds(page, '#followup-list [data-followup-id]', 'data-followup-id'), ['draft-older']);
});

test('today overview refreshes at Minsk midnight without losing a focused query, filters or saved data', { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page, overviewFixture());
  await filter(page, 'record', 'all');
  const query = page.locator('#visit-search');
  await query.fill('Тестова');
  await query.evaluate(node => node.setSelectionRange(2, 5));
  const before = await raw(page);
  await page.clock.setFixedTime(new Date('2032-04-15T21:01:00.000Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  assert.deepEqual(await homeFollowups(page), ['due-tomorrow']);
  assert.equal((await page.locator('#home-followup-count').innerText()).trim(), '1');
  assert.equal((await page.locator('#home-review-today-count').innerText()).trim(), '0');
  assert.equal(await query.inputValue(), 'Тестова');
  assert.deepEqual(await query.evaluate(node => ({ focused: node === document.activeElement, start: node.selectionStart, end: node.selectionEnd })), { focused: true, start: 2, end: 5 });
  assert.equal(await page.locator('[data-action="record-filter"][data-filter="all"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await homeIds(page), ['draft-older', 'draft-today-b', 'draft-today-a', 'due-tomorrow', 'completed-today']);
  assert.equal(await raw(page), before, 'calendar rollover does not infer attendance or review');
});

test('today overview retains a meaningful pending visit after failed save and warns about stale actions in two windows', { timeout: 20000 }, async t => {
  const { page, newPage } = await openApp(t);
  await seed(page, overviewFixture());
  const before = await raw(page);
  await click(page, 'new');
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('ДЕМО: сохранение недоступно', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, key);
  await page.getByLabel('ФИО пациента', { exact: true }).fill('Тестова Анна Несохранённая');
  await tab(page, 'history');
  await page.locator('[data-field="history.complaints"]').fill('ДЕМО: несохранённая жалоба');
  await click(page, 'home');
  assert.match(await page.locator('#home-current').innerText(), /Тестова Анна Несохранённая/);
  assert.equal(await page.locator('#storage-banner').isVisible(), true);
  assert.equal(await raw(page), before);
  await resumeCurrent(page).click();
  assert.equal(await page.locator('[data-field="history.complaints"]').inputValue(), 'ДЕМО: несохранённая жалоба');
  await click(page, 'home');
  const second = await newPage();
  await openVisit(second, 'draft-today-a');
  await second.locator('#draft-text').fill('ДЕМО: более новая запись во втором окне');
  await page.waitForFunction(() => document.getElementById('storage-banner').textContent.includes('другом окне'));
  const latest = await raw(page);
  await homeRepeat(page).click();
  assert.equal(await page.locator('#repeat-dialog').isVisible(), false);
  assert.equal(await raw(page), latest);
  assert.equal((await saved(page)).encounters.length, 6);
  assert.equal((await saved(page)).patients.length, 2);
  assert.equal(await page.locator('#toast').isVisible(), true);
  assert.match(await page.locator('#toast').innerText(), /другом окне|не сохранён/);
});

test('today overview fits desktop, tablet and narrow screens with usable working sections', { timeout: 20000 }, async t => {
  const { page } = await openApp(t);
  await seed(page, overviewFixture());
  const before = await raw(page);
  for (const width of [1366, 800, 390]) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'today layout fits width ' + width);
    assert.equal(await resumeCurrent(page).isVisible(), true);
    assert.equal(await homeRepeat(page).isVisible(), true);
    assert.equal(await page.locator('#visit-search').isVisible(), true);
    assert.equal(await page.locator('#record-filters').isVisible(), true);
    if (width === 1366) assert.equal(await visibleInViewport(resumeCurrent(page)), true, 'resume action is available before scrolling on a laptop');
  }
  assert.equal(await raw(page), before);
});

test("patient context and encounter actions remain visible while scrolling, update live and leave keyboard targets uncovered", { timeout: 30000 }, async t => {
  const { page } = await openApp(t);
  const data = fixture();
  Object.assign(data.encounters[0].assessment, { sickLeaveIssued: 'yes', sickLeaveNumber: 'ДЕМО-884', sickLeaveFrom: today, sickLeaveTo: '2032-04-18' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await seed(page, data); await openVisit(page, 'demo-today'); await tab(page, 'basic');
  await page.getByLabel('ФИО пациента', { exact: true }).fill('Тестова Анна <Учебная>');
  await page.locator('[data-field="visitDate"]').fill('2032-04-14');
  assert.equal(await page.locator('#visit-patient-heading').innerText(), 'Тестова Анна <Учебная>');
  assert.match(await page.locator('#visit-date-summary').innerText(), /14\.04\.2032/);
  assert.match(await page.locator('#visit-record-status').innerText(), /Черновик/);
  assert.match(await page.locator('#save-status').innerText(), /Сохранено/);
  for (const name of ['basic', 'history', 'exam', 'draft']) {
    await tab(page, name);
    for (const end of ['top', 'bottom']) {
      await page.evaluate(end => window.scrollTo(0, end === 'top' ? 0 : document.documentElement.scrollHeight), end);
      assert.equal(await visibleInViewport(page.locator('#visit-patient-heading')), true, name + ' patient heading visible at ' + end);
      assert.equal(await visibleInViewport(page.locator('#visit-date-summary')), true, name + ' visit date visible at ' + end);
      assert.equal(await visibleInViewport(page.locator('#visit-record-status')), true, name + ' record status visible at ' + end);
      assert.equal(await visibleInViewport(page.locator('#save-status')), true, name + ' save status visible at ' + end);
      assert.equal(await visibleInViewport(page.locator('.visit-action-bar')), true, name + ' actions visible at ' + end);
      if (name === 'draft') for (const action of ['generate', 'copy', 'download-text', 'review-record']) {
        const control = page.locator('[data-action="' + action + '"]');
        assert.equal(await control.count(), 1, 'one ' + action + ' button');
        assert.equal(await visibleInViewport(control), true, action + ' visible at ' + end);
      }
    }
  }
  await markReviewed(page);
  assert.match(await page.locator('#visit-record-status').innerText(), /Проверено врачом/);
  assert.equal(await page.locator('#record-review-actions [data-action="reopen-record"]').count(), 1);
  await page.locator('[data-field="assessment.plan"]').fill('ДЕМО: уточнённая рекомендация');
  assert.match(await page.locator('#visit-record-status').innerText(), /Черновик/);
  for (const width of [1366, 800, 390]) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
    await tab(page, 'draft');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'fixed controls fit width ' + width);
    for (const field of ['assessment.sickLeaveNumber', 'assessment.returnVisitDate']) {
      const input = page.locator('[data-field="' + field + '"]');
      await input.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      const target = await input.evaluate(node => {
        const box = node.getBoundingClientRect();
        const context = document.querySelector('.visit-context').getBoundingClientRect();
        const actions = document.querySelector('.visit-action-bar').getBoundingClientRect();
        return { focused: node === document.activeElement, top: box.top, bottom: box.bottom, contextBottom: context.bottom, actionTop: actions.top,
          hit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === node,
          covering: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.outerHTML.slice(0, 240) };
      });
      assert.equal(target.focused, true);
      assert.ok(target.top >= target.contextBottom && target.bottom <= target.actionTop, 'keyboard target remains between fixed panels at width ' + width + ': ' + JSON.stringify(target));
      assert.equal(target.hit, true, 'keyboard target is not covered: ' + field + ' at ' + width + ': ' + JSON.stringify(target));
    }
  }
});
