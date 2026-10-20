"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require(process.env.MEDASSIST_PLAYWRIGHT || "playwright");
const {clickAction: click} = require("./ui-actions.cjs");
const appRoot = path.resolve(process.env.MEDASSIST_APP_ROOT || path.join(__dirname, "../app"));
const core = require(path.join(appRoot, "core.js"));
const url = pathToFileURL(path.join(appRoot, "index.html")).href;
const key = "medassist.demo.v4";
const now = "2032-04-19T08:00:00.000Z";
const patientId = "fictional-shortcuts-patient", visitId = "fictional-shortcuts-visit";
const manual = "ДЕМО: исходный текст, отредактированный вручную.";
const entries = [
  {id: "fictional-shortcut-complaint", code: "жал", text: "ДЕМО: первая вымышленная фраза.\nДЕМО: вторая строка."},
  {id: "fictional-shortcut-exam", code: "осм", text: "ДЕМО: выбранное врачом уточнение осмотра."},
  {id: "fictional-shortcut-diagnosis", code: "диаг", text: "ДЕМО: собственная формулировка диагноза (Z00.0)"}
];
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const savedVisit = async page => (await saved(page)).encounters.find(item => item.id === visitId);
const choice = (page, id) => page.locator('#shortcuts-list [data-shortcut-id="' + id + '"]');
const trigger = (page, target) => page.locator('[data-shortcut-target="' + target + '"]');
const close = page => page.locator("#shortcuts-close").click();

async function openApp(t) {
  const browser = await chromium.launch({headless: true,
    ...(process.env.MEDASSIST_BROWSER ? {executablePath: process.env.MEDASSIST_BROWSER} : {channel: "msedge"}),
    args: ["--no-first-run", "--disable-background-networking"]});
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: {width: 1366, height: 1000}, timezoneId: "Europe/Minsk"});
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors = [], requests = [];
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {if (/^https?:/.test(request.url())) requests.push(request.url());});
  });
  t.after(() => {assert.deepEqual(errors, [], "no uncaught application errors"); assert.deepEqual(requests, [], "shortcuts work fully offline");});
  const newPage = async () => {
    const page = await context.newPage(); await page.clock.setFixedTime(new Date(now)); await page.goto(url);
    await page.locator('[data-action="patients"]').first().waitFor(); return page;
  };
  return {page: await newPage(), newPage};
}

async function seed(page, {shortcuts = entries, reviewed = false, empty = false} = {}) {
  const patient = core.createPatient({id: patientId, label: "ДЕМО Сокращений Анна Вымышленная", now});
  let visit = core.createEncounter({id: visitId, patientId, now});
  visit.history.complaints = "ДЕМО: исходные жалобы";
  visit.assessment.summary = "ДЕМО: исходный диагноз";
  visit.draft = {text: manual, generatedAt: now, sourceFingerprint: core.fingerprint(visit)};
  if (reviewed) visit = core.setReviewStatus(visit, "reviewed", {now});
  const bundle = JSON.parse(core.serializeBundle(empty ? [] : [visit], empty ? [] : [patient]));
  bundle.shortcuts = shortcuts;
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value: JSON.stringify(bundle)});
  await page.reload(); return visit;
}

async function tab(page, name) {
  await page.locator('[data-action="tab"][data-tab="' + name + '"]').first().click();
  await page.locator('#visit-tab-' + name + '[aria-selected="true"]').waitFor({state: "visible"});
}
async function openCard(page) {
  await click(page, "patients");
  await page.locator('.patient-row[data-patient-id="' + patientId + '"] [data-action="patient"]').click();
}
async function openVisit(page, name = "history") {
  await openCard(page); await page.locator('#patient-history [data-action="open"][data-id="' + visitId + '"]').click();
  if (name !== "basic") await tab(page, name);
}
async function manage(page) {
  await click(page, "help"); await click(page, "shortcuts-manage");
  await page.locator("#shortcuts-dialog").waitFor({state: "visible"});
}
async function editFields(page, code, text) {
  await page.locator("#shortcut-code").fill(code); await page.locator("#shortcut-text").fill(text);
}
async function add(page, code, text) {
  await page.locator("#shortcut-new").click(); await editFields(page, code, text);
  await page.locator("#shortcut-save").click(); await page.locator("#shortcut-editor").waitFor({state: "hidden"});
}
async function select(page, id = entries[0].id) {await choice(page, id).click();}
async function insert(page, target, id = entries[0].id) {
  await trigger(page, target).click(); await select(page, id); await page.locator("#shortcut-insert").click();
  await page.locator("#shortcuts-dialog").waitFor({state: "hidden"});
}
async function caret(page, target, start, end = start) {
  await page.locator("#" + target).evaluate((node, {start, end}) => {node.focus(); node.setSelectionRange(start, end);}, {start, end});
}
async function failWrites(page) {
  await page.evaluate(key => {
    window.restoreShortcutWrites = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === key) throw new DOMException("ДЕМО: место закончилось", "QuotaExceededError");
      return window.restoreShortcutWrites.call(this, name, value);
    };
  }, key);
}
async function restoreWrites(page) {await page.evaluate(() => {Storage.prototype.setItem = window.restoreShortcutWrites; delete window.restoreShortcutWrites;});}

test("explicit dictionary saves never create an empty patient; creation, editing, cancellation and deletion survive reload", {timeout: 30000}, async t => {
  const {page} = await openApp(t); await seed(page, {empty: true, shortcuts: []}); await click(page, "new");
  await click(page, "shortcuts-manage"); const before = await raw(page);
  await page.locator("#shortcut-new").click(); await editFields(page, "перв", "ДЕМО: несохранённая фраза");
  await page.locator("#shortcut-edit-cancel").click(); assert.equal(await raw(page), before);
  await add(page, "перв", "ДЕМО: сохранённая фраза\nВторая строка");
  let bundle = await saved(page); assert.equal(bundle.patients.length, 0); assert.equal(bundle.encounters.length, 0); assert.equal(bundle.shortcuts.length, 1);
  assert.equal(await page.locator("#shortcut-insert").isEnabled(), false, "management cannot insert into a clinical field");
  const id = bundle.shortcuts[0].id; await select(page, id); await page.locator("#shortcut-edit").click();
  await editFields(page, "друг", "ДЕМО: уточнённая фраза"); await page.locator("#shortcut-save").click();
  await page.locator("#shortcut-editor").waitFor({state: "hidden"}); assert.equal((await saved(page)).shortcuts[0].code, "друг");
  await close(page); await page.reload(); await manage(page); await select(page, id);
  assert.equal(await page.locator("#shortcut-preview").textContent(), "ДЕМО: уточнённая фраза");
  await page.locator("#shortcut-delete").click(); await page.locator("#dialog-cancel").click(); assert.equal((await saved(page)).shortcuts.length, 1);
  await page.locator("#shortcut-delete").click(); await page.locator("#dialog-accept").click();
  bundle = await saved(page); assert.equal(bundle.shortcuts?.length || 0, 0); assert.equal(bundle.patients.length, 0); assert.equal(bundle.encounters.length, 0);
});

test("case-insensitive code or phrase search and multiline markup preview are literal and never insert automatically", {timeout: 24000}, async t => {
  const {page} = await openApp(t); const markup = 'ДЕМО <img src="missing" onerror="throw 1"> & буквальный текст\nВторая строка';
  await seed(page); await manage(page); await add(page, "букв", markup);
  const id = (await saved(page)).shortcuts.find(item => item.code === "букв").id;
  await page.locator("#shortcuts-search").fill("БУКВ"); assert.equal(await page.locator("#shortcuts-list [data-shortcut-id]").count(), 1);
  await select(page, id); assert.equal(await page.locator("#shortcut-preview").textContent(), markup);
  assert.equal(await page.locator("#shortcuts-dialog img").count(), 0);
  await page.locator("#shortcuts-search").fill("ПЕРВАЯ ВЫМЫШЛЕННАЯ"); assert.equal(await choice(page, entries[0].id).count(), 1);
  assert.equal(await choice(page, id).count(), 0); await page.locator("#shortcuts-search").fill("небывалый запрос");
  assert.equal(await page.locator("#shortcuts-list [data-shortcut-id]").count(), 0);
  assert.equal((await savedVisit(page)).draft.text, manual); await close(page);
});

test("duplicate codes, blank content and values beyond editor limits cannot replace the dictionary", {timeout: 25000}, async t => {
  const {page} = await openApp(t); await seed(page); await manage(page); const before = await raw(page);
  await page.locator("#shortcut-new").click(); await editFields(page, "ЖАЛ", "ДЕМО: дубликат"); await page.locator("#shortcut-save").click();
  assert.equal(await page.locator("#shortcut-error").isVisible(), true); assert.equal(await raw(page), before);
  await editFields(page, "нов", "   "); await page.locator("#shortcut-save").click(); assert.equal(await raw(page), before);
  assert.equal(await page.locator("#shortcut-code").getAttribute("maxlength"), "40");
  assert.equal(await page.locator("#shortcut-text").getAttribute("maxlength"), "10000");
  await page.locator("#shortcut-text").evaluate(node => {node.value = "я".repeat(10001); node.dispatchEvent(new Event("input", {bubbles: true}));});
  await page.locator("#shortcut-save").click(); assert.equal(await raw(page), before);
  await page.locator("#shortcut-text").fill("ДЕМО: допустимая фраза");
  await page.locator("#shortcut-code").evaluate(node => {node.value = "я".repeat(41); node.dispatchEvent(new Event("input", {bubbles: true}));});
  await page.locator("#shortcut-save").click(); assert.equal(await raw(page), before);
  await close(page); await manage(page); assert.equal(await page.locator("#shortcut-editor").isVisible(), false);
  assert.equal((await saved(page)).shortcuts.length, entries.length);
});

test("Ctrl+Space only opens the picker; space, Enter, selecting and closing never expand text automatically", {timeout: 25000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page);
  const field = page.locator("#field-history-complaints"); await field.fill("жал"); await field.press("Space"); await field.press("Enter");
  assert.equal(await field.inputValue(), "жал \n"); assert.equal(await page.locator("#shortcuts-dialog").isVisible(), false);
  await field.fill("жал"); await field.press("Control+Space"); await page.locator("#shortcuts-dialog").waitFor({state: "visible"});
  const before = await raw(page); await select(page); assert.equal(await field.inputValue(), "жал"); assert.equal(await raw(page), before);
  await close(page); assert.equal(await field.inputValue(), "жал"); assert.equal(await raw(page), before);
  assert.deepEqual(await field.evaluate(node => [node.selectionStart, node.selectionEnd]), [3, 3], "closing the picker preserves the original caret");
  await field.press("Control+Space"); await page.locator("#shortcuts-close").focus(); await page.keyboard.press("Escape");
  await page.locator("#shortcuts-dialog").waitFor({state: "hidden"});
  assert.deepEqual(await field.evaluate(node => [node.selectionStart, node.selectionEnd]), [3, 3], "Escape preserves the original caret");
  assert.equal(await raw(page), before);
  await field.press("Control+Space"); await select(page); await page.locator("#shortcut-insert").click();
  assert.equal(await field.inputValue(), entries[0].text); assert.equal((await savedVisit(page)).history.complaints, entries[0].text);
  assert.equal((await savedVisit(page)).draft.text, manual);
});

test("insertion replaces only the explicit selection or matching whole code and preserves surrounding text and caret", {timeout: 30000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page); const target = "field-history-complaints", field = page.locator("#" + target);
  const cases = [
    {text: "До ЖАЛ после", start: 6, end: 6, expected: "До " + entries[0].text + " после", position: 3 + entries[0].text.length},
    {text: "До старое после", start: 3, end: 9, expected: "До " + entries[0].text + " после", position: 3 + entries[0].text.length},
    {text: "преджал после", start: 7, end: 7, expected: "преджал" + entries[0].text + " после", position: 7 + entries[0].text.length},
    {text: "До  после", start: 3, end: 3, expected: "До " + entries[0].text + " после", position: 3 + entries[0].text.length}
  ];
  for (const item of cases) {
    await field.fill(item.text); await caret(page, target, item.start, item.end); await insert(page, target);
    assert.equal(await field.inputValue(), item.expected);
    assert.deepEqual(await field.evaluate(node => [node.selectionStart, node.selectionEnd]), [item.position, item.position]);
    assert.equal((await savedVisit(page)).history.complaints, item.expected);
  }
  await field.fill("жал"); await caret(page, target, 3); await trigger(page, target).click(); await page.locator("#shortcuts-search").fill("");
  await select(page, entries[1].id); await page.locator("#shortcut-insert").click(); assert.equal(await field.inputValue(), "жал" + entries[1].text);
});

test("main field insertion resets clinical review and keeps manual draft; direct draft insertion updates only that text", {timeout: 26000}, async t => {
  const {page} = await openApp(t); await seed(page, {reviewed: true}); await openVisit(page);
  const target = "field-history-complaints", original = await page.locator("#" + target).inputValue(); await caret(page, target, original.length);
  await insert(page, target); let visit = await savedVisit(page);
  assert.equal(visit.workflow.reviewStatus, "draft"); assert.equal(visit.workflow.reviewedAt, ""); assert.equal(visit.draft.text, manual);
  await tab(page, "draft"); assert.match(await page.locator("#draft-state").getAttribute("class"), /stale/);
  await caret(page, "draft-text", manual.length); await insert(page, "draft-text", entries[1].id);
  visit = await savedVisit(page); assert.equal(visit.draft.text, manual + entries[1].text); assert.equal(visit.history.complaints, original + entries[0].text);
});

test("history, examination and recommendations expose insertion while dates, vitals and patient identity stay ordinary fields", {timeout: 28000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page);
  const excluded = ["patient-label", "patient-birth-date", "field-visitDate", "field-age", "field-vitals-weight", "field-vitals-systolic", "field-assessment-returnVisitDate"];
  for (const name of ["basic", "history", "exam", "draft"]) {
    await tab(page, name); for (const id of excluded) assert.equal(await trigger(page, id).count(), 0, id + " has no insertion control");
  }
  const cases = [{tab: "history", id: "field-history-conditions", section: "history", field: "conditions"},
    {tab: "exam", id: "field-exam-other", section: "exam", field: "other"},
    {tab: "draft", id: "field-assessment-plan", section: "assessment", field: "plan"}];
  for (const item of cases) {
    await tab(page, item.tab); await page.locator("#" + item.id).fill(""); await insert(page, item.id, entries[1].id);
    assert.equal((await savedVisit(page))[item.section][item.field], entries[1].text);
  }
  await tab(page, "basic"); await page.locator("#patient-birth-date").focus(); await page.keyboard.press("Control+Space");
  assert.equal(await page.locator("#shortcuts-dialog").isVisible(), false);
});

test("diagnosis and personal-note insertion remains unsaved until their own form is explicitly saved", {timeout: 30000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page, "draft"); const before = await raw(page);
  await click(page, "diagnosis-add"); await insert(page, "diagnosis-text", entries[2].id);
  assert.equal(await page.locator("#diagnosis-text").inputValue(), entries[2].text); assert.equal(await raw(page), before);
  await page.locator("#diagnosis-cancel").click(); assert.equal(await raw(page), before);
  await click(page, "diagnosis-add"); await insert(page, "diagnosis-text", entries[2].id); await page.locator("#diagnosis-save").click();
  await page.locator("#diagnosis-dialog").waitFor({state: "hidden"}); assert.ok((await savedVisit(page)).diagnoses.some(item => item.text === entries[2].text));
  await openCard(page); const beforeNote = await raw(page); await click(page, "patient-note"); await insert(page, "personal-note-text");
  assert.equal(await raw(page), beforeNote); assert.equal(await page.locator("#personal-note-text").inputValue(), entries[0].text);
  await page.locator("#personal-note-cancel").click(); assert.equal(await raw(page), beforeNote);
  await click(page, "patient-note"); await insert(page, "personal-note-text"); await page.locator("#personal-note-save").click();
  await page.locator("#personal-note-dialog").waitFor({state: "hidden"}); assert.equal((await saved(page)).patients[0].personalNote, entries[0].text);
  assert.equal((await savedVisit(page)).draft.text, manual);
});

test("creating and editing a phrase inside a nested picker preserves explicit diagnosis and personal-note saves", {timeout: 28000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page, "draft"); const before = await savedVisit(page);
  await click(page, "diagnosis-add"); await trigger(page, "diagnosis-text").click();
  await add(page, "новдиаг", "ДЕМО: новый диагноз из собственного словаря");
  const id = (await saved(page)).shortcuts.find(item => item.code === "новдиаг").id;
  assert.deepEqual(await savedVisit(page), before, "saving the phrase alone does not save a diagnosis");
  await select(page, id); await page.locator("#shortcut-insert").click(); await page.locator("#diagnosis-save").click();
  await page.locator("#diagnosis-dialog").waitFor({state: "hidden"});
  assert.ok((await savedVisit(page)).diagnoses.some(item => item.text === "ДЕМО: новый диагноз из собственного словаря"));
  await openCard(page); await click(page, "patient-note"); await trigger(page, "personal-note-text").click(); await select(page, id);
  await page.locator("#shortcut-edit").click(); await page.locator("#shortcut-text").fill("ДЕМО: новая фраза для личной заметки");
  await page.locator("#shortcut-save").click(); await page.locator("#shortcut-editor").waitFor({state: "hidden"});
  assert.equal((await saved(page)).patients[0].personalNote || "", "");
  await page.locator("#shortcut-insert").click(); await page.locator("#personal-note-save").click();
  await page.locator("#personal-note-dialog").waitFor({state: "hidden"});
  assert.equal((await saved(page)).patients[0].personalNote, "ДЕМО: новая фраза для личной заметки");
  assert.equal((await savedVisit(page)).draft.text, manual);
});

test("an over-limit insertion is all-or-nothing and a changed target cannot be overwritten by an open picker", {timeout: 24000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page); const target = "field-history-complaints", field = page.locator("#" + target);
  const limit = Number(await field.getAttribute("maxlength")); assert.ok(limit > 0);
  await field.fill("я".repeat(limit - 1)); await caret(page, target, limit - 1); const before = await raw(page);
  await trigger(page, target).click(); await select(page); await page.locator("#shortcut-insert").click();
  assert.equal(await page.locator("#shortcuts-dialog").isVisible(), true); assert.equal(await page.locator("#shortcut-error").isVisible(), true);
  assert.equal(await field.inputValue(), "я".repeat(limit - 1)); assert.equal(await raw(page), before); await close(page);
  await field.fill("ДЕМО: текст до выбора"); await trigger(page, target).click(); await select(page);
  await field.evaluate(node => {node.value = "ДЕМО: текст изменён после выбора";});
  const beforeChanged = await raw(page); await page.locator("#shortcut-insert").click();
  assert.equal(await field.inputValue(), "ДЕМО: текст изменён после выбора"); assert.equal(await raw(page), beforeChanged);
  assert.equal(await page.locator("#shortcut-error").isVisible(), true);
});

test("failed dictionary writes retain editor input and retry stores exactly one phrase", {timeout: 22000}, async t => {
  const {page} = await openApp(t); await seed(page); await manage(page); await page.locator("#shortcut-new").click();
  await editFields(page, "сбой", "ДЕМО: фраза после исправления сохранения"); const before = await raw(page); await failWrites(page);
  await page.locator("#shortcut-save").click(); assert.equal(await raw(page), before); assert.equal(await page.locator("#shortcut-error").isVisible(), true);
  assert.equal(await page.locator("#shortcut-code").inputValue(), "сбой"); assert.equal(await page.locator("#shortcut-text").inputValue(), "ДЕМО: фраза после исправления сохранения");
  await restoreWrites(page); await page.locator("#shortcut-save").evaluate(node => {node.click(); node.click();});
  await page.locator("#shortcut-editor").waitFor({state: "hidden"}); assert.equal((await saved(page)).shortcuts.filter(item => item.code === "сбой").length, 1);
});

test("failed field persistence retains inserted text and a visible warning without overwriting the stored record", {timeout: 23000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page); const target = "field-history-complaints", field = page.locator("#" + target);
  const initial = await field.inputValue(); await caret(page, target, initial.length); const before = await raw(page); await failWrites(page);
  await insert(page, target); assert.equal(await field.inputValue(), initial + entries[0].text); assert.equal(await raw(page), before);
  assert.equal(await page.locator("#storage-banner").isVisible(), true);
  assert.match(await page.locator("#storage-banner").innerText(), /сохран|хранилищ|мест|ошиб/i);
  assert.match(await page.locator("#save-status").innerText(), /не сохранены/);
  await restoreWrites(page); await field.press("End"); await field.press("Space");
  assert.equal((await savedVisit(page)).history.complaints, initial + entries[0].text + " ");
  assert.equal((await savedVisit(page)).draft.text, manual);
});

test("two windows cannot save stale dictionary edits or insert from a stale picker; the conflict stays visible", {timeout: 30000}, async t => {
  const {page, newPage} = await openApp(t); await seed(page); await manage(page);
  const other = await newPage(); await manage(other); await select(other); await other.locator("#shortcut-edit").click();
  await other.locator("#shortcut-text").fill("ДЕМО: устаревшая правка");
  await select(page); await page.locator("#shortcut-edit").click(); await page.locator("#shortcut-text").fill("ДЕМО: новая подтверждённая фраза");
  await page.locator("#shortcut-save").click(); await other.locator("#shortcut-error").waitFor({state: "visible"});
  const before = await raw(page); await other.locator("#shortcut-save").click(); assert.equal(await raw(page), before);
  assert.match(await other.locator("#shortcut-error").innerText(), /другом окне|изменились/);
  assert.equal(await other.locator("#shortcut-text").inputValue(), "ДЕМО: устаревшая правка");
  await close(page); await other.reload(); await openVisit(other); const field = other.locator("#field-history-complaints"), original = await field.inputValue();
  await trigger(other, "field-history-complaints").click(); await select(other); await manage(page); await add(page, "новое", "ДЕМО: изменение в другом окне");
  await other.locator("#shortcut-error").waitFor({state: "visible"}); const after = await raw(page); await other.locator("#shortcut-insert").click();
  assert.equal(await field.inputValue(), original); assert.equal(await raw(page), after); assert.match(await other.locator("#shortcut-error").innerText(), /другом окне|изменились/);
});

test("silent storage changes block stale insertion and deletion without erasing newer data", {timeout: 26000}, async t => {
  const {page} = await openApp(t); await seed(page); await openVisit(page); await trigger(page, "field-history-complaints").click(); await select(page);
  await page.evaluate(key => {const bundle = JSON.parse(localStorage.getItem(key)); bundle.shortcuts[0].text = "ДЕМО: сохранённая новая фраза"; localStorage.setItem(key, JSON.stringify(bundle));}, key);
  const before = await raw(page); await page.locator("#shortcut-insert").click(); assert.equal(await raw(page), before); assert.equal(await page.locator("#shortcut-error").isVisible(), true);
  await page.reload(); await manage(page); await select(page); await page.locator("#shortcut-delete").click();
  await page.evaluate(key => {const bundle = JSON.parse(localStorage.getItem(key)); bundle.shortcuts[0].text = "ДЕМО: ещё более новая фраза"; localStorage.setItem(key, JSON.stringify(bundle));}, key);
  const beforeDelete = await raw(page); await page.locator("#dialog-accept").click(); assert.equal(await raw(page), beforeDelete);
  assert.equal((await saved(page)).shortcuts[0].text, "ДЕМО: ещё более новая фраза"); assert.equal(await page.locator("#shortcut-error").isVisible(), true);
});

test("dictionary backup exports literal phrases and restore preview counts and replaces them only on confirmation", {timeout: 30000}, async t => {
  const {page, newPage} = await openApp(t); await seed(page); await click(page, "help");
  const pending = page.waitForEvent("download"); await click(page, "backup"); const download = await pending;
  const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk); const buffer = Buffer.concat(chunks);
  assert.deepEqual(core.parseBundle(buffer.toString("utf8")).shortcuts, entries);
  const other = await newPage(); await seed(other, {empty: true, shortcuts: [{id: "fictional-other-shortcut", code: "друг", text: "ДЕМО: другая фраза"}]}); await click(other, "help");
  const before = await raw(other); await other.locator("#import-file").setInputFiles({name: "fictional-shortcuts.json", mimeType: "application/json", buffer});
  const summary = other.locator("#restore-summary tr").filter({hasText: /сокращени/i});
  assert.equal(await summary.count(), 1); assert.deepEqual(await summary.locator("td").allTextContents(), ["1", "3"]);
  await other.locator("#dialog-cancel").click(); assert.equal(await raw(other), before);
  await other.locator("#import-file").setInputFiles({name: "fictional-shortcuts.json", mimeType: "application/json", buffer}); await other.locator("#dialog-accept").click();
  assert.deepEqual((await saved(other)).shortcuts, entries); assert.equal((await saved(other)).patients.length, 1); await manage(other); await select(other);
  assert.equal(await other.locator("#shortcut-preview").textContent(), entries[0].text);
});

test("dictionary controls and literal long phrases fit a 390px screen and remain usable", {timeout: 26000}, async t => {
  const {page} = await openApp(t); await seed(page); await page.setViewportSize({width: 390, height: 844}); await manage(page);
  const text = 'ДЕМО <img src="missing" onerror="throw 1"> ' + "я".repeat(600) + "\nКонец фразы";
  await add(page, "длин", text); const id = (await saved(page)).shortcuts.find(item => item.code === "длин").id; await select(page, id);
  assert.equal(await page.locator("#shortcut-preview").textContent(), text); assert.equal(await page.locator("#shortcuts-dialog img").count(), 0);
  let bounds = await page.locator("#shortcuts-dialog").boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  assert.equal(await page.locator("#shortcuts-dialog").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await page.locator("#shortcut-edit").click(); await page.locator("#shortcut-text").fill(text + "\nУточнение"); await page.locator("#shortcut-save").click();
  await page.locator("#shortcut-editor").waitFor({state: "hidden"}); bounds = await page.locator("#shortcuts-dialog").boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await close(page); await openVisit(page); await trigger(page, "field-history-complaints").click(); await page.locator("#shortcuts-search").fill("длин");
  await select(page, id); await page.locator("#shortcut-insert").click(); assert.ok((await savedVisit(page)).history.complaints.includes(text + "\nУточнение"));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
});
