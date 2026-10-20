"use strict";
const {clickAction: click} = require("./ui-actions.cjs");
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
const patientId = "fictional-investigation-patient";
const visitId = "fictional-investigation-visit";
const values = {kind: "lab", date: "2032-04-18", name: "ДЕМО показатель Альфа <условный>", result: "12,5", unit: "демо/л", reference: "ДЕМО диапазон из бланка: 10–20", note: "ДЕМО: вручную переписано"};
const fieldNames = ["date", "name", "result", "unit", "reference", "note"];
const action = (page, name) => page.locator('[data-action="' + name + '"]').first();
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));
const patient = async page => (await saved(page)).patients.find(item => item.id === patientId);
const row = (page, id) => page.locator('.investigation-row[data-investigation-id="' + id + '"]');
const accept = page => page.locator("#dialog-accept").click();

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
    assert.deepEqual(requests, [], "investigations work offline");
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

async function seed(page, investigations = [], withVisit = true) {
  const card = core.createPatient({id: patientId, label: "Тестова Дина Вымышленная", now});
  if (investigations.length) card.investigations = investigations.map((item, i) => ({id: "fictional-result-" + i, ...values, ...item}));
  let entry = core.createEncounter({id: visitId, patientId, now});
  entry.history.complaints = "ДЕМО: вымышленные жалобы";
  entry.assessment.summary = "ДЕМО: диагноз";
  entry.draft = {text: "ДЕМО: сохранённый ручной текст", generatedAt: now, sourceFingerprint: core.fingerprint(entry)};
  entry = core.setReviewStatus(entry, "reviewed", {now});
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {
    key, value: core.serializeBundle(withVisit ? [entry] : [], [card])
  });
  await page.reload();
  return entry;
}

async function openCard(page) {
  await click(page, "patients");
  await page.locator('.patient-row[data-patient-id="' + patientId + '"] [data-action="patient"]').click();
  await page.locator('.patient-tabs [data-card-tab="investigations"]').click();
}
async function fillForm(page, data = values) {
  await page.locator("#investigation-kind").selectOption(data.kind);
  for (const field of fieldNames) await page.locator("#investigation-" + field).fill(data[field] || "");
}
async function saveForm(page) {
  await page.locator("#investigation-save").click();
  await page.locator("#investigation-dialog").waitFor({state: "hidden"});
}
async function add(page, data = values) {
  await click(page, "investigation-add");
  await fillForm(page, data);
  await saveForm(page);
}
async function chooseSeries(page, predicate) {
  const series = core.getInvestigationSeries(await patient(page)).find(predicate);
  assert.ok(series, "expected result series exists");
  await page.locator("#investigation-series").selectOption(series.key);
}

test("result form saves explicitly, validates required input and works for a card without visits", {timeout: 20000}, async t => {
  const {page} = await openApp(t);
  await seed(page, [], false); await openCard(page);
  await click(page, "investigations");
  const before = await raw(page);
  await click(page, "investigation-add"); await fillForm(page);
  await page.locator("#investigation-cancel").click();
  assert.equal(await raw(page), before);
  await click(page, "investigation-add"); await fillForm(page, {...values, name: "   "});
  await page.locator("#investigation-save").click();
  assert.equal(await raw(page), before);
  assert.equal(await page.locator("#investigation-error").isVisible(), true);
  await page.locator("#investigation-name").fill(values.name);
  await saveForm(page);
  const bundle = await saved(page);
  assert.equal(bundle.patients.length, 1);
  assert.equal(bundle.encounters.length, 0, "a lab result never creates an encounter");
  assert.equal(bundle.patients[0].investigations.length, 1);
  for (const field of ["kind", ...fieldNames]) assert.equal(bundle.patients[0].investigations[0][field], values[field]);
  assert.equal(await page.locator("#patient-investigations условный").count(), 0, "name is escaped");
});

test("numeric history updates after edits and confirmed deletion without changing checked encounters", {timeout: 22000}, async t => {
  const {page} = await openApp(t);
  const entry = await seed(page); await openCard(page);
  await add(page);
  await add(page, {...values, date: "2032-04-19", result: "15.5"});
  assert.equal(await page.locator(".investigation-chart circle").count(), 2);
  assert.match(await page.locator("#investigation-dynamics").innerText(), /3/);
  const entries = (await patient(page)).investigations;
  await row(page, entries[1].id).locator('[data-action="investigation-edit"]').click();
  await page.locator("#investigation-result").fill("17,5"); await saveForm(page);
  assert.equal((await patient(page)).investigations[1].id, entries[1].id);
  assert.equal(core.getInvestigationSeries(await patient(page))[0].delta, 5);
  const beforeDelete = await raw(page);
  await row(page, entries[0].id).locator('[data-action="investigation-delete"]').click();
  await page.locator("#dialog-cancel").click();
  assert.equal(await raw(page), beforeDelete);
  await row(page, entries[0].id).locator('[data-action="investigation-delete"]').click(); await accept(page);
  assert.equal((await patient(page)).investigations.length, 1);
  assert.equal(await page.locator(".investigation-chart").count(), 0);
  assert.deepEqual((await saved(page)).encounters, [entry], "draft, status, fingerprint and dates are unchanged");
  await page.reload(); await openCard(page);
  assert.equal(await page.locator(".investigation-row").count(), 1);
  assert.match(await row(page, entries[1].id).innerText(), /17,5/);
  await row(page, entries[1].id).locator('[data-action="investigation-delete"]').click(); await accept(page);
  assert.equal(Object.hasOwn(await patient(page), "investigations"), false);
});

test("dynamics separates units and kinds, shows original references, and never charts text or duplicate dates", {timeout: 22000}, async t => {
  const {page} = await openApp(t);
  await seed(page, [
    {},
    {date: "2032-04-19", result: "14", reference: "ДЕМО другой диапазон 11–21"},
    {date: "2032-04-19", result: "140", unit: "ДЕМО/л"},
    {kind: "study", date: "2032-04-19", result: "ДЕМО: текстовое заключение\nСтрока два"},
    {name: "ДЕМО повтор даты", date: "2032-04-18", result: "1"},
    {name: "ДЕМО повтор даты", date: "2032-04-18", result: "2"},
    {name: "ДЕМО порог", date: "2032-04-18", result: "<5"},
    {name: "ДЕМО порог", date: "2032-04-19", result: "4"}
  ]);
  await openCard(page);
  assert.equal(await page.locator("#investigation-series option").count(), 5);
  await chooseSeries(page, s => s.name === values.name && s.kind === "lab" && s.unit === values.unit);
  assert.equal(await page.locator(".investigation-chart circle").count(), 2);
  const text = await page.locator("#patient-investigations").innerText();
  assert.ok(text.includes(values.reference));
  assert.ok(text.includes("ДЕМО другой диапазон 11–21"));
  assert.match(text, /норм.*(различ|отлич)|различ.*норм/i);
  for (const predicate of [
    s => s.kind === "study",
    s => s.name === "ДЕМО повтор даты",
    s => s.name === "ДЕМО порог",
    s => s.unit === "ДЕМО/л"
  ]) {
    await chooseSeries(page, predicate);
    assert.equal(await page.locator(".investigation-chart").count(), 0);
    const selected = core.getInvestigationSeries(await patient(page)).find(predicate);
    for (const entry of selected.results) assert.ok((await page.locator("#patient-investigations .investigation-table").innerText()).includes(entry.result));
  }
});

test("all manually entered result fields are searchable and preserved in a backup restore", {timeout: 23000}, async t => {
  const {page, newPage} = await openApp(t);
  await seed(page, [{note: "ДЕМО маркерисследования", result: "ДЕМО заключениетест", reference: "ДЕМО нормаизбланкатест"}]);
  await click(page, "patients");
  for (const query of ["маркерисследования", "заключениетест", "нормаизбланкатест", "18.04.2032", "демо/л"]) {
    await page.locator("#patient-search").fill(query);
    assert.equal(await page.locator('.patient-row[data-patient-id="' + patientId + '"]').count(), 1, query);
  }
  const original = await patient(page);
  await click(page, "help");
  const download = page.waitForEvent("download"); await click(page, "backup");
  const file = await download, chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  const restored = await newPage(); await click(restored, "help");
  await restored.locator("#import-file").setInputFiles({name: "fictional-investigations.json", mimeType: "application/json", buffer: Buffer.concat(chunks)});
  await accept(restored); await openCard(restored);
  assert.deepEqual((await patient(restored)).investigations, original.investigations);
  assert.equal(await row(restored, original.investigations[0].id).count(), 1);
});

test("failed result save retains inputs; stale second window cannot overwrite or duplicate results", {timeout: 23000}, async t => {
  const {page, newPage} = await openApp(t);
  await seed(page); await openCard(page);
  const other = await newPage(); await openCard(other);
  for (const target of [page, other]) {
    await click(target, "investigation-add"); await fillForm(target);
  }
  const before = await raw(page);
  await page.evaluate(key => {
    window.demoRestoreInvestigationStorage = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("ДЕМО: хранилище заполнено", "QuotaExceededError");
      return window.demoRestoreInvestigationStorage.call(this, name, value);
    };
  }, key);
  await page.locator("#investigation-save").click();
  assert.equal(await raw(page), before);
  for (const field of fieldNames) assert.equal(await page.locator("#investigation-" + field).inputValue(), values[field]);
  assert.equal(await page.locator("#investigation-error").isVisible(), true);
  await page.evaluate(() => { Storage.prototype.setItem = window.demoRestoreInvestigationStorage; delete window.demoRestoreInvestigationStorage; });
  await saveForm(page);
  await other.locator("#investigation-error").waitFor({state: "visible"});
  await other.locator("#investigation-save").click();
  assert.match(await other.locator("#investigation-error").innerText(), /другом окне/);
  assert.equal((await patient(page)).investigations.length, 1);
  assert.equal((await saved(page)).encounters.length, 1);
});

test("stale confirmation cannot delete a result changed in another window", {timeout: 20000}, async t => {
  const {page, newPage} = await openApp(t);
  await seed(page, [{}]); await openCard(page);
  const id = (await patient(page)).investigations[0].id;
  const other = await newPage(); await openCard(other);
  await row(other, id).locator('[data-action="investigation-delete"]').click();
  await row(page, id).locator('[data-action="investigation-edit"]').click();
  await page.locator("#investigation-result").fill("16"); await saveForm(page);
  await accept(other);
  assert.equal((await patient(page)).investigations.length, 1);
  assert.equal((await patient(page)).investigations[0].result, "16");
  assert.match(await other.locator("#toast").innerText(), /другом окне/);
  assert.equal(await other.locator("#toast").isVisible(), true);
});

test("results, graph and form remain usable at narrow widths; viewing never writes", {timeout: 23000}, async t => {
  const {page} = await openApp(t);
  await seed(page, [{}, {date: "2032-04-19", result: "15.5", note: "ДЕМО: " + "длиннаястрока".repeat(30)}]);
  await openCard(page);
  const before = await raw(page);
  const id = (await patient(page)).investigations[0].id;
  for (const width of [1366, 1024, 800, 390]) {
    await page.setViewportSize({width, height: 900});
    await click(page, "investigations");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no page overflow at " + width);
    assert.equal(await page.locator(".investigation-chart").count(), 1);
    const graph = await page.locator(".investigation-chart").boundingBox();
    assert.ok(graph.x >= 0 && graph.x + graph.width <= width + 1);
    await row(page, id).locator('[data-action="investigation-edit"]').click();
    const bounds = await page.locator("#investigation-dialog").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, "dialog fits at " + width);
    await page.locator("#investigation-note").fill("ДЕМО: отменённое изменение");
    await page.locator("#investigation-cancel").click();
  }
  assert.equal(await raw(page), before);
  const order = await page.evaluate(() => {
    const history = document.querySelector("#patient-history");
    const investigations = document.querySelector("#patient-investigations");
    return Boolean(history.compareDocumentPosition(investigations) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.equal(order, true, "visit history still comes first");
});

test("numeric chart keeps extreme values finite and axis labels within the graphic", {timeout: 16000}, async t => {
  const {page} = await openApp(t);
  const large = "123456789012" + "0".repeat(297);
  await seed(page, [{result: "-" + large}, {date: "2032-04-19", result: large}]); await openCard(page);
  assert.match(await page.locator("#investigation-dynamics").innerText(), /Разность вне числового диапазона/);
  const geometry = await page.locator(".investigation-chart svg").evaluate(svg => ({
    points: [...svg.querySelectorAll("circle")].map(circle => [Number(circle.getAttribute("cx")), Number(circle.getAttribute("cy"))]),
    texts: [...svg.querySelectorAll("text")].map(text => {
      const bounds = text.getBBox();
      return {label: text.textContent, x: bounds.x, right: bounds.x + bounds.width};
    }),
    line: svg.querySelector("polyline").getAttribute("points")
  }));
  assert.ok(geometry.points.flat().every(Number.isFinite));
  assert.doesNotMatch(geometry.line, /NaN|Infinity/);
  for (const label of geometry.texts) assert.ok(label.x >= 0 && label.right <= 570, JSON.stringify(label));
  assert.ok((await page.locator(".investigation-table").innerText()).includes(large), "table preserves full original value");
});

test("a forged imported result is rejected without replacing the current records", {timeout: 18000}, async t => {
  const {page} = await openApp(t);
  await seed(page, [{}]); const before = await raw(page);
  const invalid = JSON.parse(before);
  invalid.patients[0].investigations[0].date = "2032-02-30";
  await click(page, "help");
  await page.locator("#import-file").setInputFiles({name: "fictional-invalid-result.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid))});
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.trim());
  assert.equal(await raw(page), before);
  assert.equal(await page.locator("#confirmation").isVisible(), false);
});
