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
const action = (page, name) => page.locator('[data-action="' + name + '"]').first();
const visitTab = (page, name) => page.locator('.tab-bar [data-tab="' + name + '"]');
const cardTab = (page, name) => page.locator('.patient-tabs [data-card-tab="' + name + '"]');
const category = (page, name) => page.locator('#patient-categories [data-category="' + name + '"]');
const filterTab = (page, kind, name) => page.locator('#' + kind + '-filters [data-filter="' + name + '"]');
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
    if (node.dataset.filter) return '[data-action="' + node.dataset.action + '"][data-filter="' + node.dataset.filter + '"]';
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
  await click(page, "patients");
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
async function contentAnimation(page, {fallback = false, direction = "next", viewport}) {
  const handle = await page.waitForFunction(({fallback, direction, viewport}) => {
    const animations = document.getAnimations().filter(animation => animation.playState === "running");
    if (!fallback) {
      const names = animations.map(animation => animation.animationName || "");
      return names.includes("medassist-pager-new-" + direction) && names.includes("medassist-pager-old-" + direction) ? names : false;
    }
    const frames = animations.filter(animation => animation.effect?.target?.matches?.(viewport)).map(animation => animation.effect.getKeyframes());
    return frames.find(values => values.some(value => value.transform?.includes("translateX"))) || false;
  }, {fallback, direction, viewport}, {timeout: 2500});
  const observed = await handle.jsonValue();
  if (fallback) {
    const transform = observed.find(frame => frame.transform?.includes("translateX")).transform;
    assert.equal(/translateX\(-/.test(transform), direction === "previous", transform);
  }
}

for (const kind of ["followup", "record"]) {
  test("previously missing " + kind + " filter animates its content in both directions", {timeout: 13000}, async t => {
    const page = await openApp(t);
    await seed(page);
    if (kind === "followup") await click(page, "followups");
    await filterTab(page, kind, kind === "followup" ? "today" : "all").waitFor();
    const first = kind === "followup" ? "today" : "all";
    const last = kind === "followup" ? "completed" : "reviewed";
    for (const [value, direction] of [[last, "next"], [first, "previous"]]) {
      await settle(page);
      await filterTab(page, kind, value).evaluate(node => node.click());
      await contentAnimation(page, {direction, viewport: kind === "followup" ? "#followup-list" : "#visit-list"});
      await selected(filterTab(page, kind, value));
    }
  });
}

async function followupSeed(page) {
  const fixture = await seed(page);
  for (const [index, date] of ["2032-04-19", "2032-04-21", "2032-04-18", "2032-04-17"].entries())
    fixture.encounters[index].assessment.returnVisitDate = date;
  fixture.encounters[3] = core.setReturnVisitStatus(fixture.encounters[3], "completed", {now});
  fixture.value = core.serializeBundle(fixture.encounters, fixture.patients);
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value: fixture.value});
  await page.reload();
  return fixture;
}

test("followup and record filters retain directional content animations without View Transitions", {timeout: 20000}, async t => {
  const page = await openApp(t, {fallback: true});
  await followupSeed(page);
  for (const [kind, view, first, last, viewport] of [
    ["followup", "followups", "today", "completed", "#followup-list"],
    ["record", "home", "all", "reviewed", "#visit-list"]
  ]) {
    await click(page, view);
    for (const [value, direction] of [[last, "next"], [first, "previous"]]) {
      await settle(page);
      await filterTab(page, kind, value).evaluate(node => node.click());
      await contentAnimation(page, {fallback: true, direction, viewport});
      await selected(filterTab(page, kind, value));
    }
  }
});

test("local transitions move their own indicator while the global navigation indicator remains still", {timeout: 24000}, async t => {
  const page = await openApp(t);
  await seed(page);
  const check = async (locator, local) => {
    await settle(page);
    await locator.evaluate(node => node.click());
    const handle = await page.waitForFunction(local => {
      const running = document.getAnimations().filter(animation => animation.playState === "running");
      const localAnimations = running.filter(animation => animation.effect?.target?.matches?.(local + " > .pager-indicator"));
      if (!localAnimations.length) return false;
      return running.filter(animation => animation.effect?.target?.matches?.(".pager-indicator")).map(animation => animation.effect.target.parentElement.id || animation.effect.target.parentElement.className);
    }, local, {timeout: 2500});
    const owners = await handle.jsonValue();
    assert.ok(!owners.includes("main-navigation"), "local selection never borrows the global indicator: " + owners);
    assert.equal(owners.length, 1);
    await selected(locator);
  };
  await check(filterTab(page, "record", "reviewed"), "#record-filters");
  await click(page, "followups");
  await check(filterTab(page, "followup", "completed"), "#followup-filters");
  await openVisit(page);
  await check(visitTab(page, "draft"), ".tab-bar");
});

test("followup buckets keep the selected period across midnight and never write patient records", {timeout: 18000}, async t => {
  const page = await openApp(t);
  const original = await followupSeed(page);
  await click(page, "followups");
  const ids = () => page.locator("#followup-list [data-followup-id]").evaluateAll(nodes => nodes.map(node => node.dataset.followupId).sort());
  for (const [name, expected] of [["today", ["nav-visit-main"]], ["upcoming", ["nav-visit-return"]], ["past", ["nav-visit-plain"]], ["completed", ["nav-visit-draft"]]]) {
    await choose(filterTab(page, "followup", name));
    assert.deepEqual(await ids(), expected);
  }
  await choose(filterTab(page, "followup", "past"));
  await page.clock.setFixedTime(new Date("2032-04-19T21:01:00.000Z"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await selected(filterTab(page, "followup", "past"));
  assert.deepEqual(await ids(), ["nav-visit-main", "nav-visit-plain"]);
  await choose(filterTab(page, "followup", "today"));
  assert.deepEqual(await ids(), []);
  assert.equal(await raw(page), original.value);
});

test("record search survives rapid filters and a search refresh cancels an obsolete pending transition", {timeout: 20000}, async t => {
  const page = await openApp(t);
  const original = await seed(page);
  await page.locator("#visit-search").fill("Тестов");
  await page.evaluate(() => {
    for (const name of ["all", "reviewed", "draft", "all", "reviewed"])
      document.querySelector('#record-filters [data-filter="' + name + '"]').click();
  });
  await selected(filterTab(page, "record", "reviewed"));
  await settle(page);
  assert.equal(await page.locator("#visit-search").inputValue(), "Тестов");
  assert.deepEqual(await page.locator("#visit-list [data-record-id]").evaluateAll(nodes => nodes.map(node => node.dataset.recordId).sort()), ["nav-visit-plain", "nav-visit-return"]);
  await page.evaluate(() => {
    document.querySelector('#record-filters [data-filter="draft"]').click();
    const input = document.getElementById("visit-search");
    input.focus();
    input.value = "Борис";
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
  await settle(page);
  await selected(filterTab(page, "record", "reviewed"));
  assert.equal(await page.locator("#visit-search").inputValue(), "Борис");
  assert.equal(await page.locator("#visit-search").evaluate(node => node === document.activeElement), true);
  assert.deepEqual(await page.locator("#visit-list [data-record-id]").evaluateAll(nodes => nodes.map(node => node.dataset.recordId)), ["nav-visit-return"]);
  assert.equal(await raw(page), original.value);
});

test("an actual confirmed repeat visit keeps all five animated sections and footer navigation without duplicate encounters", {timeout: 23000}, async t => {
  const page = await openApp(t);
  const original = await followupSeed(page);
  await click(page, "followups");
  await page.locator('#followup-list [data-followup-id="nav-visit-main"] [data-action="start-followup"]').click();
  await page.locator("#repeat-create").click();
  await selected(visitTab(page, "basic"));
  const created = (await saved(page)).encounters.find(entry => !original.encounters.some(old => old.id === entry.id));
  assert.ok(created);
  await page.locator('[data-field="age"]').fill("41");
  for (const name of ["history", "exam", "investigations", "draft"]) {
    await settle(page);
    await page.locator('.visit-action-bar [data-action="tab"][data-tab="' + name + '"]').evaluate(node => node.click());
    await contentAnimation(page, {direction: "next", viewport: ".current-visit-form"});
    await selected(visitTab(page, name));
    if (name === "history") await page.locator('[data-field="history.complaints"]').fill("ДЕМО: жалобы повторного приёма.");
    if (name === "draft") await page.locator("#draft-text").fill("ДЕМО: ручной текст повторного приёма.");
  }
  await choose(visitTab(page, "history"));
  assert.equal(await page.locator('[data-field="history.complaints"]').inputValue(), "ДЕМО: жалобы повторного приёма.");
  await choose(visitTab(page, "draft"));
  assert.equal(await page.locator("#draft-text").inputValue(), "ДЕМО: ручной текст повторного приёма.");
  const after = await saved(page);
  assert.equal(after.encounters.length, original.encounters.length + 1);
  assert.equal(after.patients.length, original.patients.length);
  assert.equal(after.encounters.find(entry => entry.id === created.id).age, "41");
  assert.equal(after.encounters.find(entry => entry.id === "nav-visit-main").draft.text, original.encounters[0].draft.text);
});

test("main navigation animates complete pages, preserves current input and cancels pending New without stray cards", {timeout: 26000}, async t => {
  const page = await openApp(t);
  const original = await seed(page);
  const menu = page.locator(".navigation-header .nav");
  for (const [name, direction] of [["help", "next"], ["home", "previous"]]) {
    await settle(page);
    await menu.locator('[data-action="' + name + '"]').evaluate(node => node.click());
    await contentAnimation(page, {direction, viewport: "#main"});
    await menu.locator('[data-action="' + name + '"][aria-current="page"]').waitFor();
  }
  await page.evaluate(() => {
    document.querySelector('.navigation-header [data-action="new"]').click();
    document.querySelector('.navigation-header [data-action="patients"]').click();
  });
  await menu.locator('[data-action="patients"][aria-current="page"]').waitFor();
  await settle(page);
  assert.equal(await raw(page), original.value, "cancelled pending New makes no patient or encounter");
  await click(page, "new");
  await click(page, "home");
  assert.equal(await raw(page), original.value, "leaving a displayed empty form also creates nothing");
  await openVisit(page);
  await choose(visitTab(page, "history"));
  await page.locator('[data-field="history.complaints"]').fill("ДЕМО: введено перед сменой главного раздела");
  const before = await raw(page);
  for (const name of ["patients", "followups", "modules", "help", "home"]) await click(page, name);
  await click(page, "visit");
  await selected(visitTab(page, "history"));
  assert.equal(await page.locator('[data-field="history.complaints"]').inputValue(), "ДЕМО: введено перед сменой главного раздела");
  assert.equal(await raw(page), before);
  await click(page, "help");
  await settle(page);
  await menu.locator('[data-action="check-updates"]').click();
  assert.equal(await page.locator("#update-help").isVisible(), true);
  assert.equal(await menu.locator('[data-action="help"]').getAttribute("aria-current"), "page");
  assert.equal(await menu.locator('[data-action="check-updates"]').evaluate(node => node.classList.contains("pager-tab")), false);
  assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.animationName?.startsWith("medassist-pager")).length), 0);
});

test("new filter menus support keyboard and touch with narrow tabs reachable and vertical gestures ignored", {timeout: 26000}, async t => {
  const page = await openApp(t);
  await followupSeed(page);
  for (const width of [1366, 390]) {
    await page.setViewportSize({width, height: 844});
    for (const [kind, view, first, second, last, viewport] of [
      ["followup", "followups", "today", "upcoming", "completed", "#followup-list"],
      ["record", "home", "all", "draft", "reviewed", "#visit-list"]
    ]) {
      await click(page, view);
      await choose(filterTab(page, kind, first));
      await filterTab(page, kind, first).focus();
      await page.keyboard.press("ArrowRight");
      await selected(filterTab(page, kind, second));
      await page.keyboard.press("End");
      await selected(filterTab(page, kind, last));
      await settle(page);
      const reachable = await filterTab(page, kind, last).evaluate(node => {
        const box = node.getBoundingClientRect(), list = node.parentElement.getBoundingClientRect();
        return box.left >= list.left - 1 && box.right <= list.right + 1;
      });
      assert.equal(reachable, true, kind + " selected tab reachable at " + width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.keyboard.press("Home");
      await selected(filterTab(page, kind, first));
      await touchSwipe(page, viewport, -150, 200);
      await settle(page);
      await selected(filterTab(page, kind, first));
      await touchSwipe(page, viewport, -150);
      await selected(filterTab(page, kind, second));
      assert.equal(await page.locator('.navigation-header [data-action="' + view + '"]').getAttribute("aria-current"), "page", "local gesture never switches main screens");
    }
  }
});

test("main and newly covered filters honor reduced motion without changing records", {timeout: 16000}, async t => {
  const page = await openApp(t, {reducedMotion: "reduce"});
  const original = await followupSeed(page);
  const noAnimation = async () => assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && animation.effect.getComputedTiming().duration > 0).length), 0);
  await click(page, "followups"); await noAnimation();
  await choose(filterTab(page, "followup", "completed")); await noAnimation();
  await click(page, "home"); await noAnimation();
  await choose(filterTab(page, "record", "reviewed")); await noAnimation();
  await click(page, "patients"); await noAnimation();
  assert.equal(await raw(page), original.value);
});

test("global menu stays above the workspace and the clock sits left, with usable narrow navigation and fixed visit controls", {timeout: 25000}, async t => {
  const page = await openApp(t, {reducedMotion: "reduce"});
  await page.setViewportSize({width: 1366, height: 768});
  const menu = page.locator('.navigation-header .nav');
  const desktop = await page.evaluate(() => {
    const rect = selector => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return {left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height};
    };
    return {header: rect('.navigation-header'), sidebar: rect('.context-sidebar'), main: rect('main'),
      menuRows: [...document.querySelectorAll('.navigation-header .nav button')].map(node => node.getBoundingClientRect().top)};
  });
  assert.ok(desktop.header.bottom <= desktop.sidebar.top + 1);
  assert.ok(desktop.sidebar.right <= desktop.main.left + 1);
  assert.ok(desktop.header.height <= 80, "the horizontal menu does not add an empty tall header");
  assert.equal(new Set(desktop.menuRows).size, 1, "all navigation entries occupy one horizontal row");
  assert.equal(await page.locator("#current-date").textContent(), "19 апреля(04) 2032");
  assert.equal(await page.locator("#current-time").textContent(), "11:00");
  for (const name of ["patients", "followups", "modules", "help", "home"]) {
    await menu.locator('[data-action="' + name + '"]').click();
    assert.equal(await menu.locator('[data-action="' + name + '"]').getAttribute("aria-current"), "page");
    assert.equal(await page.locator("#current-time").textContent(), "11:00");
  }
  await menu.locator('[data-action="new"]').click();
  await page.locator("#patient-label").fill("Тестов Верхнее Меню");
  await choose(visitTab(page, "exam"));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const pinned = await page.evaluate(() => {
    const head = document.querySelector(".visit-context").getBoundingClientRect();
    const actions = document.querySelector(".visit-action-bar").getBoundingClientRect();
    const side = document.querySelector(".context-sidebar").getBoundingClientRect();
    return {headTop: head.top, sideTop: side.top, actionBottom: actions.bottom, actionLeft: actions.left, sideRight: side.right};
  });
  assert.ok(pinned.headTop >= -1 && pinned.headTop <= 1, "visit identity stays at the viewport top");
  assert.ok(pinned.sideTop >= -1 && pinned.sideTop <= 1, "clock stays visible while scrolling");
  assert.equal(pinned.actionBottom, 768);
  assert.equal(pinned.actionLeft, pinned.sideRight);
  await page.setViewportSize({width: 390, height: 844});
  await menu.locator('[data-action="help"]').click();
  const narrow = await page.evaluate(() => {
    const nav = document.querySelector(".navigation-header .nav");
    const selected = nav.querySelector('[aria-current="page"]').getBoundingClientRect();
    const box = nav.getBoundingClientRect();
    return {overflow: document.documentElement.scrollWidth > innerWidth, scrollable: nav.scrollWidth > nav.clientWidth,
      visible: selected.left >= box.left - 1 && selected.right <= box.right + 1};
  });
  assert.equal(narrow.overflow, false);
  assert.equal(narrow.scrollable, true);
  assert.equal(narrow.visible, true, "active navigation remains visible after rendering");
  await menu.locator('[data-action="visit"]').click();
  assert.equal(await page.locator("#current-date").textContent(), "19 апреля(04) 2032");
  assert.equal(await page.locator(".visit-action-bar").evaluate(node => node.getBoundingClientRect().left), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
});

test("new visit keeps entered identity, history and manual draft through rapid forward and backward tab changes", {timeout: 25000}, async t => {
  const page = await openApp(t);
  await click(page, "new");
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
    await click(page, "new");
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
  await click(page, "patients");
  await page.locator("#patient-search").fill("Тестов");
  await click(page, "patient-toggle-filters");
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
  await click(page, "investigation-add");
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
  await click(page, "patients");
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
  await click(page, "patients");
  await touchSwipe(page, "#patient-list", -180);
  await selected(category(page, "sick"));
  await touchSwipe(page, "#patient-list", 180);
  await selected(category(page, "all"));
  await openCard(page);
  await touchSwipe(page, "#patient-module-panel", -180);
  await selected(cardTab(page, "investigations"));
  await click(page, "investigation-add");
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
  await click(page, "patients");
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
    await click(page, "patients");
    await check(category(page, "draft"), width + " patients last");
    await check(category(page, "all"), width + " patients first");
    await openCard(page);
    await check(cardTab(page, "sick"), width + " card last");
    await check(cardTab(page, "history"), width + " card first");
  }
});
