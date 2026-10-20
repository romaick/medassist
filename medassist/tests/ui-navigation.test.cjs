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
const action = (page, name) => page.locator('[data-action="' + name + '"]').first();
const visitTab = (page, name) => page.locator('.tab-bar [data-tab="' + name + '"]');
const cardTab = (page, name) => page.locator('.patient-tabs [data-card-tab="' + name + '"]');
const category = (page, name) => page.locator('#patient-categories [data-category="' + name + '"]');
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
const saved = async page => JSON.parse(await raw(page));

async function openApp(t, {reducedMotion = "no-preference", fallback = false} = {}) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.MEDASSIST_BROWSER ? {executablePath: process.env.MEDASSIST_BROWSER} : {channel: "msedge"}),
    args: ["--no-first-run", "--disable-background-networking"]
  });
  t.after(() => browser.close());
  const context = await browser.newContext({viewport: {width: 1366, height: 1000}, timezoneId: "Europe/Minsk", reducedMotion, hasTouch: true});
  context.setDefaultTimeout(6000);
  await context.setOffline(true);
  if (fallback) await context.addInitScript(() => { document.startViewTransition = undefined; });
  const errors = [], requests = [];
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  t.after(() => { assert.deepEqual(errors, [], "navigation has no uncaught errors"); assert.deepEqual(requests, [], "navigation works offline"); });
  await page.clock.setFixedTime(new Date(now));
  await page.goto(url);
  await action(page, "patients").waitFor();
  return page;
}
async function selected(locator) {
  await locator.page().waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-selected") === "true", await locator.evaluate(node => {
    if (node.dataset.cardTab) return '.patient-tabs [data-card-tab="' + node.dataset.cardTab + '"]';
    if (node.dataset.category) return '#patient-categories [data-category="' + node.dataset.category + '"]';
    return '.tab-bar [data-tab="' + node.dataset.tab + '"]';
  }));
  assert.equal(await locator.getAttribute("tabindex"), "0");
}
async function choose(locator) {
  await locator.click();
  await selected(locator);
}
async function settle(page) {
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== "running" && animation.playState !== "pending"));
}
async function seed(page) {
  const ids = ["main", "return", "plain", "draft"];
  let patients = ids.map((id, i) => core.createPatient({id: "nav-" + id, label: "Тестов " + ["Антон", "Борис", "Виктор", "Глеб"][i] + " Вымышленный", now}));
  const encounters = ids.map(id => {
    let entry = core.createEncounter({id: "nav-visit-" + id, patientId: "nav-" + id, now});
    entry.history.complaints = "ДЕМО: жалобы " + id;
    entry.assessment.summary = "ДЕМО: заключение " + id;
    entry.draft.text = "ДЕМО: сохранённый ручной текст " + id;
    if (id === "main" || id === "return") entry.assessment.returnVisitDate = "2032-04-21";
    if (id === "return" || id === "plain") entry = core.setReviewStatus(entry, "reviewed", {now});
    return entry;
  });
  patients[0] = core.issueSickLeave(patients[0], {id: "nav-leave", eventId: "nav-leave-issued", number: "ДЕМО-016", from: "2032-04-18", to: "2032-04-23", now}, encounters);
  patients[0] = core.upsertInvestigationReport(patients[0], {panelId: "cbc", title: "ДЕМО ОАК", kind: "lab", date: "2032-04-18",
    rows: [{fieldId: "hemoglobin", name: "Гемоглобин крови (HGB/Hb)", result: "123", unit: "г/л", reference: "ДЕМО норма из бланка", note: ""}]}, {now});
  const value = core.serializeBundle(encounters, patients);
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value});
  await page.reload();
  return {patients, encounters, value};
}
async function openCard(page, id = "main") {
  await action(page, "patients").click();
  await page.locator('.patient-row[data-patient-id="nav-' + id + '"] [data-action="patient"]').click();
  await selected(cardTab(page, "history"));
}
async function openVisit(page) {
  await openCard(page);
  await page.locator('#patient-history [data-action="open"][data-id="nav-visit-main"]').click();
  await selected(visitTab(page, "basic"));
}
async function touchSwipe(page, selector, dx, dy = 0) {
  await page.locator(selector).evaluate((node, {dx, dy}) => {
    const box = node.getBoundingClientRect();
    const x = box.left + Math.min(230, box.width * .65), y = box.top + 20;
    const event = (type, clientX, clientY) => node.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 71, pointerType: "touch", isPrimary: true, button: 0, clientX, clientY}));
    event("pointerdown", x, y);
    event("pointermove", x + dx, y + dy);
    event("pointerup", x + dx, y + dy);
  }, {dx, dy});
}
async function activeKeys(page, selector, attribute) {
  return page.locator(selector + '[aria-selected="true"]').evaluateAll((nodes, attribute) => nodes.map(node => node.getAttribute(attribute)), attribute);
}

test("new visit keeps entered identity, history and manual draft through rapid forward and backward tab changes", {timeout: 25000}, async t => {
  const page = await openApp(t);
  await action(page, "new").click();
  await page.locator("#patient-label").fill("Тестова Навигация Вымышленная");
  await page.locator('[data-field="age"]').fill("42");
  await choose(visitTab(page, "history"));
  await page.locator('[data-field="history.complaints"]').fill("ДЕМО: жалобы сохраняются при перелистывании.");
  await page.locator('[data-field="history.medications"]').fill("ДЕМО: постоянный препарат.");
  await choose(visitTab(page, "draft"));
  await page.locator("#draft-text").fill("ДЕМО: мой ручной текст, который нельзя заменять.");
  const before = await raw(page);
  await page.evaluate(() => {
    for (const name of ["basic", "exam", "history", "investigations", "draft", "history"])
      document.querySelector('.tab-bar [data-tab="' + name + '"]').click();
  });
  await selected(visitTab(page, "history"));
  await settle(page);
  assert.equal(await page.locator('[data-field="history.complaints"]').inputValue(), "ДЕМО: жалобы сохраняются при перелистывании.");
  assert.equal(await page.locator('[data-field="history.medications"]').inputValue(), "ДЕМО: постоянный препарат.");
  await choose(visitTab(page, "basic"));
  assert.equal(await page.locator("#patient-label").inputValue(), "Тестова Навигация Вымышленная");
  assert.equal(await page.locator('[data-field="age"]').inputValue(), "42");
  await choose(visitTab(page, "draft"));
  assert.equal(await page.locator("#draft-text").inputValue(), "ДЕМО: мой ручной текст, который нельзя заменять.");
  assert.equal(await raw(page), before, "view changes must not write or duplicate patient data");
  assert.equal((await saved(page)).patients.length, 1);
  assert.equal((await saved(page)).encounters.length, 1);
});

for (const fallback of [false, true]) {
  test("content moves in the selected direction " + (fallback ? "without View Transitions" : "with View Transitions"), {timeout: 18000}, async t => {
    const page = await openApp(t, {fallback});
    await action(page, "new").click();
    for (const [name, direction] of [["history", "next"], ["basic", "previous"]]) {
      await settle(page);
      await visitTab(page, name).evaluate(node => node.click());
      const handle = await page.waitForFunction(({fallback, direction}) => {
        const animations = document.getAnimations().filter(animation => animation.playState === "running");
        if (!fallback) {
          const names = animations.map(animation => animation.animationName || "");
          return names.some(name => name === "medassist-pager-new-" + direction) && names.some(name => name === "medassist-pager-old-" + direction) ? names : false;
        }
        const frames = animations.filter(animation => animation.effect?.target?.matches?.(".current-visit-form")).map(animation => animation.effect.getKeyframes());
        return frames.find(values => values.some(value => value.transform?.includes("translateX"))) || false;
      }, {fallback, direction});
      const observed = await handle.jsonValue();
      if (fallback) {
        const transform = observed.find(frame => frame.transform?.includes("translateX")).transform;
        assert.equal(/translateX\(-/.test(transform), direction === "previous", transform);
      }
      await selected(visitTab(page, name));
    }
  });
}

test("patient categories preserve search and filtering while showing the correct records", {timeout: 20000}, async t => {
  const page = await openApp(t);
  const original = await seed(page);
  await action(page, "patients").click();
  await page.locator("#patient-search").fill("Тестов");
  await action(page, "patient-toggle-filters").click();
  await page.locator("#patient-filter-review").selectOption("draft");
  const rows = () => page.locator("#patient-list .patient-row").evaluateAll(nodes => nodes.map(node => node.dataset.patientId).sort());
  for (const [name, ids] of [["all", ["nav-draft", "nav-main"]], ["sick", ["nav-main"]], ["return", ["nav-main"]], ["draft", ["nav-draft", "nav-main"]], ["all", ["nav-draft", "nav-main"]]]) {
    await choose(category(page, name));
    assert.deepEqual(await rows(), ids);
    assert.equal(await page.locator("#patient-search").inputValue(), "Тестов");
    assert.equal(await page.locator("#patient-filter-review").inputValue(), "draft");
    assert.equal(await page.locator("#patient-filter-panel").isVisible(), true);
    assert.deepEqual(await activeKeys(page, "#patient-categories [data-category]", "data-category"), [name]);
  }
  assert.equal(await raw(page), original.value, "search and categories are read-only");
});

test("patient card shows one module, retains edits in its module and starts another card with history", {timeout: 23000}, async t => {
  const page = await openApp(t);
  const original = await seed(page);
  await openCard(page);
  const visible = () => page.locator("[data-card-panel]").evaluateAll(nodes => nodes.filter(node => !node.hidden && node.getBoundingClientRect().height > 0).map(node => node.dataset.cardPanel));
  assert.deepEqual(await visible(), ["history"]);
  assert.equal(await page.locator("#patient-history [data-action=open]").count(), 1);
  await choose(cardTab(page, "investigations"));
  assert.deepEqual(await visible(), ["investigations"]);
  await action(page, "investigation-add").click();
  await page.locator("#investigation-kind").selectOption("lab");
  await page.locator("#investigation-date").fill("2032-04-19");
  await page.locator("#investigation-name").fill("ДЕМО: новый показатель");
  await page.locator("#investigation-result").fill("7");
  await page.locator("#investigation-unit").fill("демо/л");
  await page.locator("#investigation-save").click();
  await page.locator("#investigation-dialog").waitFor({state: "hidden"});
  await selected(cardTab(page, "investigations"));
  assert.deepEqual(await visible(), ["investigations"]);
  assert.equal((await saved(page)).patients[0].investigations.length, 2);
  await choose(cardTab(page, "sick"));
  assert.deepEqual(await visible(), ["sick"]);
  await page.locator('.sick-leave-entry[data-leave-id="nav-leave"] [data-action="sick-extend"]').click();
  await page.locator("#sick-leave-from").fill("2032-04-23");
  await page.locator("#sick-leave-to").fill("2032-04-25");
  await page.locator("#sick-leave-save").click();
  await page.locator("#sick-leave-dialog").waitFor({state: "hidden"});
  await selected(cardTab(page, "sick"));
  assert.match(await page.locator("#sick-leave-total").innerText(), /8/);
  assert.deepEqual((await saved(page)).encounters, original.encounters, "module changes preserve existing visit text");
  await openCard(page, "return");
  assert.deepEqual(await visible(), ["history"]);
  assert.equal(await page.locator("#patient-heading").innerText(), "Тестов Борис Вымышленный");
  await openCard(page);
  assert.deepEqual(await visible(), ["history"]);
});

test("all three tab strips support arrows, Home and End with focus on the selected tab", {timeout: 23000}, async t => {
  const page = await openApp(t);
  await seed(page);
  const check = async (first, second, last) => {
    await first.focus();
    await page.keyboard.press("ArrowRight"); await selected(second);
    assert.equal(await second.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press("End"); await selected(last);
    assert.equal(await last.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press("Home"); await selected(first);
    assert.equal(await first.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press("ArrowRight"); await selected(second);
    await page.keyboard.press("ArrowLeft"); await selected(first);
  };
  await openVisit(page);
  await check(visitTab(page, "basic"), visitTab(page, "history"), visitTab(page, "draft"));
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
  });
  await selected(visitTab(page, "exam"));
  assert.equal(await visitTab(page, "exam").evaluate(node => node === document.activeElement), true, "rapid arrows advance from the requested tab while animation is pending");
  await action(page, "patients").click();
  await check(category(page, "all"), category(page, "sick"), category(page, "draft"));
  await openCard(page);
  await check(cardTab(page, "history"), cardTab(page, "investigations"), cardTab(page, "sick"));
});

test("touch swipes navigate content without hijacking vertical gestures or form controls and stop at the ends", {timeout: 23000}, async t => {
  const page = await openApp(t);
  await seed(page);
  await openVisit(page);
  await touchSwipe(page, ".current-visit-form", 180);
  await settle(page);
  await selected(visitTab(page, "basic"));
  await touchSwipe(page, ".current-visit-form", -180, 190);
  await settle(page);
  await selected(visitTab(page, "basic"));
  await touchSwipe(page, "#patient-label", -180);
  await settle(page);
  await selected(visitTab(page, "basic"));
  await touchSwipe(page, ".current-visit-form", -180);
  await selected(visitTab(page, "history"));
  await touchSwipe(page, ".current-visit-form", 180);
  await selected(visitTab(page, "basic"));
  await choose(visitTab(page, "draft"));
  await touchSwipe(page, ".current-visit-form", -180);
  await settle(page);
  await selected(visitTab(page, "draft"));
  await action(page, "patients").click();
  await touchSwipe(page, "#patient-list", -180);
  await selected(category(page, "sick"));
  await touchSwipe(page, "#patient-list", 180);
  await selected(category(page, "all"));
  await openCard(page);
  await touchSwipe(page, "#patient-module-panel", -180);
  await selected(cardTab(page, "investigations"));
  await action(page, "investigation-add").click();
  await page.locator("#investigation-kind").selectOption("lab");
  await page.locator("#investigation-name").fill("ДЕМО: ещё не сохранено");
  await touchSwipe(page, "#patient-module-panel", -180);
  await selected(cardTab(page, "investigations"));
  assert.equal(await page.locator("#investigation-name").inputValue(), "ДЕМО: ещё не сохранено", "an open dialog prevents gestures from switching the page behind it");
  await page.locator("#investigation-cancel").click();
  await touchSwipe(page, "#patient-module-panel", -180);
  await selected(cardTab(page, "sick"));
  await touchSwipe(page, "#patient-module-panel", -180);
  await settle(page);
  await selected(cardTab(page, "sick"));
  await touchSwipe(page, "#patient-module-panel", 180, 250);
  await settle(page);
  await selected(cardTab(page, "sick"));
});

test("reduced motion switches every surface immediately without content or indicator animations", {timeout: 18000}, async t => {
  const page = await openApp(t, {reducedMotion: "reduce"});
  await seed(page);
  const check = async locator => {
    await locator.evaluate(node => node.click());
    await selected(locator);
    assert.deepEqual(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && animation.effect.getComputedTiming().duration > 0).map(animation => animation.animationName || "WAAPI")), []);
  };
  await openVisit(page);
  await check(visitTab(page, "draft"));
  await action(page, "patients").click();
  await check(category(page, "sick"));
  await openCard(page);
  await check(cardTab(page, "sick"));
});

test("desktop and narrow navigation stay within the screen and scroll the active tab into view", {timeout: 25000}, async t => {
  const page = await openApp(t);
  await seed(page);
  const check = async (locator, label) => {
    await choose(locator);
    await settle(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, label + ": no page overflow");
    const bounds = await locator.evaluate(node => {
      const box = node.getBoundingClientRect(), list = node.closest('[role="tablist"]').getBoundingClientRect();
      return {left: box.left, right: box.right, listLeft: list.left, listRight: list.right, width: innerWidth};
    });
    assert.ok(bounds.left >= Math.max(0, bounds.listLeft) - 2 && bounds.right <= Math.min(bounds.width, bounds.listRight) + 2, label + ": selected tab reachable " + JSON.stringify(bounds));
  };
  for (const width of [1366, 390]) {
    await page.setViewportSize({width, height: 844});
    await openVisit(page);
    await check(visitTab(page, "draft"), width + " visit last");
    await check(visitTab(page, "basic"), width + " visit first");
    await action(page, "patients").click();
    await check(category(page, "draft"), width + " patients last");
    await check(category(page, "all"), width + " patients first");
    await openCard(page);
    await check(cardTab(page, "sick"), width + " card last");
    await check(cardTab(page, "history"), width + " card first");
  }
});
