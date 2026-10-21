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
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const view = page => page.locator("#app").getAttribute("data-view");
const card = (page, area) => page.locator('.area-card[data-area="' + area + '"]');
const focusedArea = page => page.evaluate(() => document.activeElement?.dataset.area || "");
const menuActions = page => page.locator("#main-navigation button").evaluateAll(nodes => nodes.map(node => node.dataset.action));

async function openContext(t, viewport = {width: 1366, height: 768}) {
  const browser = await chromium.launch({headless: true,
    ...(process.env.MEDASSIST_BROWSER ? {executablePath: process.env.MEDASSIST_BROWSER} : {channel: "msedge"}),
    args: ["--no-first-run", "--disable-background-networking"]});
  t.after(() => browser.close());
  const context = await browser.newContext({viewport, timezoneId: "Europe/Minsk", reducedMotion: "reduce"});
  context.setDefaultTimeout(6000);
  await context.setOffline(true);
  const errors = [], requests = [];
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  });
  t.after(() => { assert.deepEqual(errors, [], "no uncaught application errors"); assert.deepEqual(requests, [], "the area choice works offline"); });
  const launch = async () => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(now));
    await page.goto(url);
    await card(page, "polyclinic").waitFor();
    return page;
  };
  return {context, launch};
}

async function seedPatient(page) {
  const patient = core.createPatient({id: "fictional-start-patient", label: "ДЕМО Стартова Анна Вымышленная", now});
  const visit = core.createEncounter({id: "fictional-start-visit", patientId: patient.id, now});
  visit.history.complaints = "ДЕМО: сведения только для проверки экрана выбора";
  const value = core.serializeBundle([visit], [patient]);
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value});
  return value;
}

test("launch shows the area choice; Поликлиника opens the existing workspace and the choice stays for this window only", {timeout: 30000}, async t => {
  const {launch} = await openContext(t);
  const page = await launch();
  assert.equal(await view(page), "start");
  assert.match(await page.title(), /^Медасист \d+\.\d+\.\d+$/, "the window title names no area before the choice");
  assert.equal(await page.locator("h1").innerText(), "Выберите раздел");
  assert.deepEqual(await page.locator(".area-card").evaluateAll(nodes => nodes.map(node => [node.dataset.area, node.disabled])),
    [["polyclinic", false], ["inpatient", true], ["modules", false]]);
  assert.match(await card(page, "inpatient").innerText(), /Стационар\s*В работе/);
  assert.equal(await card(page, "inpatient").getAttribute("data-action"), null, "the inpatient card has no action");
  assert.equal(await page.locator("#main-navigation").count(), 0, "no polyclinic menu before the choice");
  assert.equal(await focusedArea(page), "polyclinic", "Enter opens the polyclinic right after launch");
  assert.match(await page.locator("#current-date").textContent(), /^19 апреля\(04\) 2032$/);
  assert.equal(await raw(page), null, "showing the choice writes no records");

  await page.keyboard.press("Control+KeyK");
  assert.equal(await view(page), "start", "patient search is not opened outside the polyclinic");
  await page.keyboard.press("Enter");
  await page.locator('#main-navigation [data-action="home"][aria-current="page"]').waitFor();
  assert.equal(await view(page), "home");
  assert.match(await page.title(), / — поликлиника$/);
  const actions = await menuActions(page);
  assert.equal(actions.includes("modules"), false, "Модули moved out of the polyclinic menu");
  assert.deepEqual(actions.slice(-2), ["check-updates", "choose-area"]);
  assert.equal(await page.locator('#main-navigation [data-action="choose-area"]').evaluate(node => node.classList.contains("pager-tab")), false);
  assert.equal(await page.locator(".context-mode").innerText(), "Поликлиника");
  assert.equal(await raw(page), null, "entering the polyclinic writes no records");

  await page.reload();
  await page.locator("#main-navigation").waitFor();
  assert.equal(await view(page), "home", "a reload keeps the chosen area");
  const second = await launch();
  assert.equal(await view(second), "start", "a new window starts at the choice");
  await second.close();

  await page.locator('#main-navigation [data-action="choose-area"]').click();
  await card(page, "polyclinic").waitFor();
  assert.equal(await view(page), "start");
  assert.equal(await focusedArea(page), "polyclinic");
  await page.reload();
  await card(page, "polyclinic").waitFor();
  assert.equal(await view(page), "start", "after returning to the choice a reload shows the choice");
});

test("Модули open as a separate area without polyclinic search and return to the choice", {timeout: 20000}, async t => {
  const {launch} = await openContext(t);
  const page = await launch();
  await card(page, "modules").click();
  await page.locator('#main-navigation [data-action="modules"][aria-current="page"]').waitFor();
  assert.equal(await view(page), "modules");
  assert.match(await page.title(), / — модули$/);
  assert.deepEqual(await menuActions(page), ["modules", "choose-area"]);
  assert.equal(await page.locator(".context-mode").innerText(), "Модули");
  assert.equal(await page.locator('[data-action="search-patients"]').count(), 0);
  assert.equal(await page.locator(".module-card").count() > 0, true);
  await page.locator("#main").focus();
  await page.keyboard.press("Control+KeyK");
  assert.equal(await view(page), "modules", "Ctrl+K does not jump into the polyclinic");
  await page.locator('#main-navigation [data-action="modules"]').click();
  assert.equal(await view(page), "modules");
  await page.reload();
  await page.locator("#main-navigation").waitFor();
  assert.equal(await view(page), "modules", "a reload keeps the modules area");
  await page.locator('#main-navigation [data-action="modules"]').focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), "choose-area");
  await page.keyboard.press("Enter");
  await card(page, "modules").waitFor();
  assert.equal(await view(page), "start");
  assert.equal(await raw(page), null);
});

test("returning to the choice keeps the open visit and discards an empty new form", {timeout: 25000}, async t => {
  const {launch} = await openContext(t);
  const page = await launch();
  await card(page, "polyclinic").click();
  await page.locator("#main-navigation").waitFor();
  await click(page, "new");
  await page.locator("#patient-label").waitFor();
  await page.locator('#main-navigation [data-action="choose-area"]').click();
  await card(page, "polyclinic").click();
  await page.locator("#main-navigation").waitFor();
  assert.equal(await raw(page), null, "a blank new form creates nothing");
  assert.equal(await page.locator('#main-navigation [data-action="new"]').count(), 1);

  await click(page, "new");
  await page.locator("#patient-label").fill("ДЕМО Выборова Анна Учебная");
  await page.waitForFunction(key => localStorage.getItem(key) !== null, key);
  const saved = await raw(page);
  await page.locator('#main-navigation [data-action="choose-area"]').click();
  assert.equal(await raw(page), saved, "the choice does not change records");
  await card(page, "polyclinic").click();
  await page.locator('#main-navigation [data-action="visit"]').waitFor();
  await click(page, "visit");
  assert.equal(await page.locator("#patient-label").inputValue(), "ДЕМО Выборова Анна Учебная");
  assert.equal(await raw(page), saved);
});

test("the choice shows storage problems and changes made in another window", {timeout: 25000}, async t => {
  const {launch} = await openContext(t);
  const page = await launch();
  const original = await seedPatient(page);
  const other = await launch();
  await card(other, "polyclinic").click();
  await other.locator("#main-navigation").waitFor();
  await click(other, "new");
  await other.locator("#patient-label").fill("ДЕМО Другое Окно Вымышленное");
  await page.locator("#storage-banner.storage-warning").waitFor();
  assert.match(await page.locator("#storage-banner").innerText(), /изменены в другом окне/);
  assert.equal(await view(page), "start");
  assert.notEqual(await raw(page), original, "the other window saved its change");
  const changed = await raw(page);
  await card(page, "polyclinic").click();
  await page.locator("#main-navigation").waitFor();
  assert.equal(await raw(page), changed, "entering the polyclinic does not overwrite the newer data");
  await other.close();

  await page.evaluate(key => localStorage.setItem(key, "{\"broken\""), key);
  const broken = await launch();
  await broken.locator("#storage-banner.storage-warning").waitFor();
  assert.equal(await view(broken), "start");
  assert.match(await broken.locator("#storage-banner").innerText(), /Сохранение требует внимания/);
  assert.equal(await raw(broken), "{\"broken\"", "a damaged save is left untouched");
});

test("the three areas fit common screens without horizontal scrolling", {timeout: 25000}, async t => {
  const {launch} = await openContext(t);
  const page = await launch();
  for (const [width, height, columns] of [[1366, 768, 3], [1024, 768, 3], [390, 844, 1]]) {
    await page.setViewportSize({width, height});
    const layout = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".area-card"), node => node.getBoundingClientRect());
      return {
        scroll: document.documentElement.scrollWidth, width: innerWidth,
        rows: new Set(cards.map(box => Math.round(box.top))).size,
        inside: cards.every(box => box.left >= 0 && box.right <= innerWidth + 1)
      };
    });
    assert.ok(layout.scroll <= layout.width + 1, "no horizontal scroll at " + width);
    assert.equal(layout.inside, true, "cards stay inside at " + width);
    assert.equal(layout.rows, columns === 3 ? 1 : 3, "card rows at " + width);
    if (width >= 1024) {
      const fits = await page.evaluate(() => Array.from(document.querySelectorAll(".area-card")).every(node => node.getBoundingClientRect().bottom <= innerHeight));
      assert.equal(fits, true, "all choices are visible without scrolling at " + width);
    }
  }
});
