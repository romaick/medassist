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
const visitId = "demo-icd-visit";
const manualDraft = "ДЕМО: вымышленная запись, вручную проверяемая при испытании интерфейса.";
const diagnosis = page => page.locator("#field-assessment-summary");
const panel = page => page.locator("#diagnosis-suggestions");
const options = page => page.locator("#diagnosis-options [role=option]");
const codeOption = (page, code) => page.locator('#diagnosis-options [role=option][data-code="' + code + '"]');
const {clickAction: click, enterPolyclinic} = require("./ui-actions.cjs");
const tab = (page, name) => page.locator('[data-action="tab"][data-tab="' + name + '"]').first().click();
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const savedVisit = async page => JSON.parse(await raw(page)).encounters.find(entry => entry.id === visitId);

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
  t.after(() => { assert.deepEqual(errors, [], "no page errors"); assert.deepEqual(requests, [], "ICD search makes no HTTP requests"); });
  const newPage = async () => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(now));
    await page.goto(url); await enterPolyclinic(page);
    return page;
  };
  return {page: await newPage(), newPage};
}

async function openRecord(page) {
  await page.locator('[data-action="record-filter"][data-filter="all"]').click();
  await page.locator('[data-action="record-filter"][data-filter="all"][aria-selected="true"]').waitFor({state: "visible"});
  await page.locator('[data-action="open"][data-id="' + visitId + '"]').click();
  await tab(page, "draft");
  assert.equal(await diagnosis(page).getAttribute("role"), "combobox", "the bundled ICD catalog is available offline");
}

async function seed(page, {summary = "", reviewed = false} = {}) {
  const patient = core.createPatient({id: "demo-icd-patient", now, label: "Тестова Анна Учебная"});
  let entry = core.createEncounter({id: visitId, patientId: patient.id, now});
  entry.assessment.summary = summary;
  entry.draft.text = manualDraft;
  if (reviewed) entry = core.setReviewStatus(entry, "reviewed", {now});
  const serialized = core.serializeBundle([entry], [patient]);
  await page.evaluate(({key, serialized}) => localStorage.setItem(key, serialized), {key, serialized});
  await page.reload();
  await openRecord(page);
}

async function query(page, text) {
  await diagnosis(page).fill(text);
  await diagnosis(page).click();
}

test("ICD keywords and codes select an explicit diagnosis, reset review, persist and generate only on request", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await seed(page, {summary: "острый бронхит", reviewed: true});
  const before = await raw(page);
  await diagnosis(page).focus();
  assert.equal(await panel(page).isVisible(), true);
  assert.equal(await diagnosis(page).getAttribute("aria-expanded"), "true");
  assert.equal(await diagnosis(page).getAttribute("aria-activedescendant"), null);
  assert.equal(await codeOption(page, "J20").locator("strong").innerText(), "Острый бронхит");
  assert.equal(await codeOption(page, "J20").locator(".diagnosis-code").innerText(), "J20");
  assert.equal(await raw(page), before, "opening suggestions does not change or unreview the record");
  await codeOption(page, "J20").click();
  assert.equal(await diagnosis(page).inputValue(), "Острый бронхит (J20)");
  assert.equal(await panel(page).isVisible(), false);
  assert.equal(await page.locator("#draft-text").inputValue(), manualDraft);
  assert.equal((await savedVisit(page)).workflow.reviewStatus, "draft");
  assert.equal((await savedVisit(page)).workflow.reviewedAt, "");
  assert.match(await page.locator("#record-review-state").innerText(), /Черновик/);
  await page.reload(); await openRecord(page);
  assert.equal(await diagnosis(page).inputValue(), "Острый бронхит (J20)");
  assert.equal(await page.locator("#draft-text").inputValue(), manualDraft);
  await click(page, "generate"); await page.locator("#dialog-cancel").click();
  assert.equal(await page.locator("#draft-text").inputValue(), manualDraft);
  await click(page, "generate"); await page.locator("#dialog-accept").click();
  assert.match(await page.locator("#draft-text").inputValue(), /Диагноз: Острый бронхит \(J20\)/);
  await query(page, "j20.9");
  assert.equal(await codeOption(page, "J20.9").count(), 1);
  const title = await codeOption(page, "J20.9").locator("strong").innerText();
  await codeOption(page, "J20.9").click();
  assert.equal(await diagnosis(page).inputValue(), title + " (J20.9)");
  await page.locator(".icd-source summary").click();
  const metadata = await page.evaluate(async () => (await window.MedAssistICDReady).metadata);
  const sourceText = await page.locator(".icd-source").innerText();
  assert.ok(sourceText.includes(metadata.publisher));
  assert.ok(sourceText.includes(metadata.release));
  assert.ok(sourceText.includes(metadata.note));
  assert.equal(await page.locator(".icd-source a").getAttribute("href"), metadata.sourceUrl);
});

test("ICD keyboard navigation requires explicit highlighting; Escape, Tab and ordinary Enter never choose a diagnosis", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await seed(page);
  await query(page, "J20");
  assert.equal(await options(page).first().getAttribute("data-code"), "J20");
  await diagnosis(page).press("End");
  await diagnosis(page).press("Enter");
  assert.equal(await diagnosis(page).inputValue(), "J20\n", "Enter without a highlighted option remains a line break");
  assert.equal(await panel(page).isVisible(), false);
  await query(page, "J20");
  await diagnosis(page).press("ArrowDown");
  const firstId = await options(page).first().getAttribute("id");
  assert.equal(await diagnosis(page).getAttribute("aria-activedescendant"), firstId);
  await diagnosis(page).press("ArrowDown");
  assert.equal(await diagnosis(page).getAttribute("aria-activedescendant"), await options(page).nth(1).getAttribute("id"));
  await diagnosis(page).press("Escape");
  assert.equal(await panel(page).isVisible(), false);
  assert.equal(await diagnosis(page).inputValue(), "J20");
  assert.equal(await diagnosis(page).getAttribute("aria-activedescendant"), null);
  await diagnosis(page).click();
  await diagnosis(page).press("Tab");
  assert.equal(await panel(page).isVisible(), false);
  assert.equal(await diagnosis(page).inputValue(), "J20");
  await diagnosis(page).focus();
  await diagnosis(page).press("ArrowDown");
  await diagnosis(page).press("ArrowDown");
  await diagnosis(page).press("ArrowUp");
  assert.equal(await options(page).first().getAttribute("aria-selected"), "true");
  await diagnosis(page).press("Enter");
  assert.equal(await diagnosis(page).inputValue(), "Острый бронхит (J20)");
  assert.equal(await panel(page).isVisible(), false);
  assert.equal(await page.locator("#draft-text").inputValue(), manualDraft);
});

test("ICD selection replaces only the current diagnosis line and ignores selections spanning multiple lines", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  const initial = "ДЕМО: первая строка.\nострый бронхит\nДЕМО: последняя строка.";
  await seed(page, {summary: initial});
  await diagnosis(page).focus();
  await diagnosis(page).evaluate(node => {
    const caret = node.value.indexOf("острый") + 3;
    node.setSelectionRange(caret, caret);
    node.dispatchEvent(new MouseEvent("click", {bubbles: true}));
  });
  await codeOption(page, "J20").click();
  const expected = "ДЕМО: первая строка.\nОстрый бронхит (J20)\nДЕМО: последняя строка.";
  assert.equal(await diagnosis(page).inputValue(), expected);
  assert.equal((await savedVisit(page)).assessment.summary, expected);
  assert.equal(await page.locator("#draft-text").inputValue(), manualDraft);
  await diagnosis(page).fill(initial);
  await diagnosis(page).evaluate(node => {
    const caret = node.value.indexOf("острый") + 3;
    node.setSelectionRange(caret, caret);
    node.dispatchEvent(new MouseEvent("click", {bubbles: true}));
  });
  assert.equal(await codeOption(page, "J20").count(), 1);
  await diagnosis(page).press("Control+Home");
  assert.equal(await diagnosis(page).evaluate(node => node.selectionStart), 0);
  assert.equal(await options(page).count(), 0, "keyboard movement refreshes suggestions for the current line");
  await diagnosis(page).press("Control+End");
  assert.equal(await diagnosis(page).evaluate(node => node.selectionStart), initial.length);
  assert.equal(await options(page).count(), 0);
  await diagnosis(page).evaluate(node => {
    const caret = node.value.indexOf("острый") + 3;
    node.setSelectionRange(caret, caret);
    node.dispatchEvent(new MouseEvent("click", {bubbles: true}));
  });
  await diagnosis(page).press("Shift+ArrowUp");
  const selection = await diagnosis(page).evaluate(node => ({start: node.selectionStart, end: node.selectionEnd}));
  assert.ok(selection.start < initial.indexOf("острый") && selection.end > initial.indexOf("острый"), "Shift+ArrowUp keeps native multiline text selection");
  assert.equal(await panel(page).isVisible(), false);
  await diagnosis(page).evaluate(node => {
    const caret = node.value.indexOf("острый") + 3;
    node.setSelectionRange(caret, caret);
    node.dispatchEvent(new MouseEvent("click", {bubbles: true}));
  });
  await diagnosis(page).press("Control+ArrowDown");
  assert.notEqual(await diagnosis(page).evaluate(node => node.selectionStart), initial.indexOf("острый") + 3, "Ctrl+ArrowDown retains native text navigation");
  assert.equal(await diagnosis(page).getAttribute("aria-activedescendant"), null);
  await diagnosis(page).evaluate(node => {
    node.setSelectionRange(0, node.value.indexOf("острый") + 3);
    node.dispatchEvent(new MouseEvent("click", {bubbles: true}));
  });
  assert.equal(await panel(page).isVisible(), false, "cross-line selections cannot silently replace several diagnoses");
  await diagnosis(page).press("ArrowDown");
  assert.equal(await panel(page).isVisible(), false);
  assert.equal(await diagnosis(page).inputValue(), initial);
});

test("ICD unmatched and HTML-like manual text stays literal and editable without a compulsory code", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await seed(page);
  await query(page, "а");
  assert.equal(await panel(page).isVisible(), false);
  const text = 'ДЕМО: <img id="icd-test-injection" src=x onerror="window.icdTestInjected=1"> неизвестная тестовая формулировка';
  await query(page, text);
  assert.equal(await panel(page).isVisible(), true);
  assert.equal(await options(page).count(), 0);
  assert.match(await page.locator("#diagnosis-result-count").innerText(), /Совпадений.*нет.*оставить введённый диагноз/);
  assert.equal(await page.locator("#icd-test-injection").count(), 0);
  assert.equal(await page.evaluate(() => window.icdTestInjected), undefined);
  assert.equal((await savedVisit(page)).assessment.summary, text);
  await page.reload(); await openRecord(page);
  assert.equal(await diagnosis(page).inputValue(), text);
  await click(page, "generate"); await page.locator("#dialog-accept").click();
  assert.ok((await page.locator("#draft-text").inputValue()).includes(text));
  assert.equal(await page.locator("#icd-test-injection").count(), 0);
});

test("ICD selection in a stale window keeps the other window's record and displays the conflict warning", {timeout: 20000}, async t => {
  const {page, newPage} = await openApp(t);
  await seed(page, {summary: "острый бронхит"});
  await diagnosis(page).focus();
  const second = await newPage();
  await openRecord(second); await tab(second, "history");
  await second.locator('[data-field="history.complaints"]').fill("ДЕМО: сведения изменены во втором окне.");
  await page.waitForFunction(() => document.getElementById("storage-banner").textContent.includes("другом окне"));
  const latest = await raw(page);
  await codeOption(page, "J20").click();
  assert.equal(await raw(page), latest, "a stale suggestion must not overwrite a newer saved encounter");
  assert.equal(await diagnosis(page).inputValue(), "острый бронхит");
  assert.equal(JSON.parse(await raw(page)).encounters.length, 1);
  assert.equal(await page.locator("#toast").isVisible(), true);
  assert.match(await page.locator("#toast").innerText(), /другом окне/);
  const visibleWarning = await page.locator("#toast").evaluate(node => {
    const rect = node.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.id;
  });
  assert.equal(visibleWarning, "toast");
});

test("ICD suggestion lists fit desktop, tablet and narrow widths and remain clickable", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await seed(page);
  for (const width of [1366, 800, 390]) {
    await page.setViewportSize({width, height: 844});
    await query(page, "острый");
    assert.equal(await options(page).count(), 20);
    assert.match(await page.locator("#diagnosis-result-count").innerText(), /Показано 20 из \d+/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no page overflow at " + width);
    assert.equal(await page.locator("#diagnosis-options").evaluate(node => node.scrollWidth <= node.clientWidth), true, "long diagnosis titles wrap at " + width);
    const selected = options(page).first();
    const title = await selected.locator("strong").innerText();
    const code = await selected.getAttribute("data-code");
    await selected.click();
    assert.equal(await diagnosis(page).inputValue(), title + " (" + code + ")");
    assert.equal(await panel(page).isVisible(), false);
  }
  assert.equal(await page.locator("#draft-text").inputValue(), manualDraft);
});

test("Belarus source letter suffixes and short titles show their parent context and remain editable", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await seed(page);
  await query(page, "i20.0a");
  assert.equal(await options(page).count(), 1);
  await codeOption(page, "I20.0A").click();
  assert.equal(await diagnosis(page).inputValue(), "Нестабильная стенокардия на фоне АГ (I20.0A)");
  assert.equal((await savedVisit(page)).assessment.summary, "Нестабильная стенокардия на фоне АГ (I20.0A)");
  await query(page, "K04.01");
  assert.equal(await codeOption(page, "K04.01").locator("strong").innerText(), "Острый");
  assert.equal(await codeOption(page, "K04.01").locator("small").innerText(), "K04 · Болезни пульпы и периапикальных тканей");
  await codeOption(page, "K04.01").click();
  assert.equal(await diagnosis(page).inputValue(), "Острый (K04.01)");
  await diagnosis(page).fill("ДЕМО: уточнённая врачом тестовая формулировка (K04.01)");
  await page.reload(); await openRecord(page);
  assert.equal(await diagnosis(page).inputValue(), "ДЕМО: уточнённая врачом тестовая формулировка (K04.01)");
  assert.equal(await page.locator("#draft-text").inputValue(), manualDraft);
});
