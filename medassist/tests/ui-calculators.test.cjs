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
const view = page => page.locator("#app").getAttribute("data-view");
const storageSnapshot = page => page.evaluate(() => JSON.stringify({local: Object.entries(localStorage), session: Object.entries(sessionStorage)}));
const groups = page => page.locator(".calculator-group h2").allInnerTexts();
const resultText = async page => (await page.locator("#egfr-result").innerText()).replace(/\s+/g, " ").trim();

async function openApp(t, viewport = {width: 1366, height: 900}) {
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
  t.after(() => { assert.deepEqual(errors, [], "no uncaught application errors"); assert.deepEqual(requests, [], "calculators work offline"); });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(now));
  await page.goto(url);
  await page.locator('[data-action="enter-modules"]').click();
  await page.locator("#main-navigation").waitFor();
  return page;
}
async function openCalculators(page) {
  await page.locator('#main-navigation [data-action="calculators"]').click();
  await page.locator("#calculator-list").waitFor();
}
async function openEgfr(page) {
  await openCalculators(page);
  await page.locator('[data-action="calc-open"][data-calculator="egfr"]').click();
  await page.locator("#egfr-age").waitFor();
}
async function fillEgfr(page, {age, sex, creatinine, unit}) {
  if (unit) await page.locator("#egfr-unit").selectOption(unit);
  if (age !== undefined) await page.locator("#egfr-age").fill(age);
  if (sex) await page.locator('input[name="egfr-sex"][value="' + sex + '"]').check();
  if (creatinine !== undefined) await page.locator("#egfr-creatinine").fill(creatinine);
}

test("Калькуляторы sit in the Modules menu with system rubrics; only ready calculators open", {timeout: 25000}, async t => {
  const page = await openApp(t);
  assert.deepEqual(await page.locator("#main-navigation button").evaluateAll(nodes => nodes.map(node => node.dataset.action)), ["modules", "calculators", "norms", "choose-area"]);
  const moduleCard = page.locator(".module-card").filter({hasText: "Калькуляторы"});
  assert.match(await moduleCard.locator(".pill").innerText(), /Доступно/);
  await moduleCard.locator('[data-action="calculators"]').click();
  await page.locator("#calculator-list").waitFor();
  assert.equal(await view(page), "calculators");
  assert.match(await page.title(), / — модули$/);
  assert.equal(await page.locator('#main-navigation [data-action="calculators"]').getAttribute("aria-current"), "page");
  assert.match(await page.locator(".calculator-disclaimer").innerText(), /Не заменяет клиническое решение/);
  assert.deepEqual(await page.locator("#calculator-rubrics [role=tab]").allInnerTexts(), ["Все", "Почки", "Сердце и сосуды", "Инфекции и лёгкие", "Обмен веществ", "Печень", "Психика"]);
  assert.deepEqual(await groups(page), ["Почки", "Сердце и сосуды", "Инфекции и лёгкие", "Обмен веществ", "Печень", "Психика"]);
  assert.deepEqual(await page.locator('[data-action="calc-open"]').evaluateAll(nodes => nodes.map(node => node.dataset.calculator)),
    ["egfr", "cockcroft", "chads", "hasbled", "score2", "qtc", "crb65", "centor", "findrisc", "fib4", "phq9", "gad7"], "only calculators verified against sources open");
  assert.deepEqual(await page.locator(".calculator-item.unavailable").filter({hasText: "Готовится"}).allInnerTexts().then(items => items.map(item => item.split("\n")[0])), [], "every listed calculator is ready");
  assert.match(await page.locator(".calculator-item.unavailable").filter({hasText: "Индекс массы тела"}).innerText(), /В разделе «Осмотр»/);

  await page.locator("#calc-rubric-kidney").click();
  assert.deepEqual(await groups(page), ["Почки"]);
  assert.equal(await page.locator("#calc-rubric-kidney").getAttribute("aria-selected"), "true");
  assert.equal(await page.evaluate(() => document.activeElement.id), "calc-rubric-kidney");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.activeElement.id), "calc-rubric-heart");
  assert.deepEqual(await groups(page), ["Сердце и сосуды"]);
  await page.keyboard.press("Home");
  assert.deepEqual(await groups(page), ["Почки", "Сердце и сосуды", "Инфекции и лёгкие", "Обмен веществ", "Печень", "Психика"]);

  await page.keyboard.press("Control+KeyK");
  assert.equal(await view(page), "calculators", "Ctrl+K does not jump into the polyclinic");
  await page.reload();
  await page.locator("#main-navigation").waitFor();
  assert.equal(await view(page), "modules", "a reload stays in the Modules area");
});

test("eGFR shows the hand-checked CKD-EPI 2021 value, KDIGO category, formula and sources", {timeout: 25000}, async t => {
  const page = await openApp(t);
  await openEgfr(page);
  assert.equal(await page.locator("h1").innerText(), "СКФ по CKD-EPI (2021)");
  assert.match(await page.locator(".calculator-disclaimer").innerText(), /Не заменяет клиническое решение/);
  assert.equal(await resultText(page), "Введите возраст, пол и креатинин.");
  assert.equal(await page.locator("#egfr-copy").isDisabled(), true);

  await fillEgfr(page, {age: "60", sex: "male", creatinine: "176,8"});
  assert.match(await resultText(page), /^38 мл\/мин\/1,73 м² G3b существенно снижена \(категория KDIGO\)/);
  assert.equal(await page.locator("#egfr-copy").isDisabled(), false);
  await page.locator("#egfr-unit").selectOption("mg");
  assert.equal(await page.locator("#egfr-creatinine-error").innerText(), "Креатинин — число от 0,2 до 34 мг/дл.");
  assert.equal(await page.locator("#egfr-creatinine").getAttribute("aria-invalid"), "true");
  assert.equal(await resultText(page), "Исправьте отмеченные поля.");
  await fillEgfr(page, {creatinine: "2,0"});
  assert.match(await resultText(page), /^38 мл\/мин\/1,73 м² G3b/);
  assert.equal(await page.locator("#egfr-creatinine-error").isHidden(), true);
  await fillEgfr(page, {age: "50", sex: "female", creatinine: "0.7"});
  assert.match(await resultText(page), /^105 мл\/мин\/1,73 м² G1 нормальная или высокая/);

  const formula = await page.locator(".calculator-reference").innerText();
  assert.match(formula, /142 × min\(Scr\/κ; 1\)α × max\(Scr\/κ; 1\)−1,200 × 0,9938возраст × 1,012 \[для женщин\]/);
  assert.match(formula, /κ = 0,7 для женщин и 0,9 для мужчин; α = −0,241 для женщин и −0,302 для мужчин/);
  assert.match(formula, /мкмоль\/л ÷ 88,4/);
  assert.deepEqual(await page.locator(".calculator-table tbody tr").allInnerTexts().then(rows => rows.map(row => row.split("\t")[0])), ["G1", "G2", "G3a", "G3b", "G4", "G5"]);
  assert.deepEqual(await page.locator(".calculator-sources a").evaluateAll(links => links.map(link => [link.getAttribute("href"), link.target, link.rel])),
    [["https://doi.org/10.1056/NEJMoa2102953", "_blank", "noopener noreferrer"], ["https://doi.org/10.1016/j.kint.2023.10.018", "_blank", "noopener noreferrer"]]);
  assert.equal(core.calculateEgfrCkdEpi2021({age: "50", sex: "female", creatinine: "0.7", unit: "mg"}).result.value, 105, "the screen and the core agree");
});

test("errors appear after leaving a field, typing never shows a half-typed error, and copy gives the record line", {timeout: 25000}, async t => {
  const page = await openApp(t);
  await openEgfr(page);
  await page.evaluate(() => {
    window.copiedText = [];
    Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText: async text => { window.copiedText.push(text); }}});
  });
  await page.locator("#egfr-age").fill("1");
  assert.equal(await page.locator("#egfr-age-error").isHidden(), true, "no error while the doctor is still typing");
  await page.locator("#egfr-creatinine").focus();
  assert.equal(await page.locator("#egfr-age-error").innerText(), "Возраст — целое число лет от 18 до 120: формула предназначена для взрослых.");
  assert.equal(await page.locator("#egfr-age").getAttribute("aria-invalid"), "true");
  await page.locator("#egfr-age").fill("40");
  assert.equal(await page.locator("#egfr-age-error").isHidden(), true, "a corrected value clears the error at once");
  await fillEgfr(page, {sex: "female", creatinine: "44,2"});
  assert.match(await resultText(page), /^122 мл\/мин\/1,73 м² G1/);
  assert.equal(await page.evaluate(() => document.activeElement.id), "egfr-creatinine", "live results keep the cursor in place");
  await page.locator("#egfr-copy").click();
  await page.locator("#toast").filter({hasText: "Результат скопирован."}).waitFor();
  assert.deepEqual(await page.evaluate(() => window.copiedText), ["СКФ (CKD-EPI 2021) 122 мл/мин/1,73 м², категория G1 по KDIGO; креатинин 44,2 мкмоль/л."]);
});

test("calculator inputs are never saved, survive switching rubrics in this window and return focus on Back", {timeout: 25000}, async t => {
  const page = await openApp(t);
  const value = core.serializeBundle([], [core.createPatient({id: "fictional-calc-patient", label: "ДЕМО Расчётова Вера Вымышленная", now})]);
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value});
  const before = await storageSnapshot(page);
  await openEgfr(page);
  await fillEgfr(page, {age: "60", sex: "male", creatinine: "176.8"});
  await page.locator("#egfr-age").blur();
  assert.equal(await storageSnapshot(page), before, "nothing is written to localStorage or sessionStorage");
  await page.locator('[data-action="calc-back"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.calculator), "egfr");
  await page.locator("#calc-rubric-mind").click();
  await page.locator("#calc-rubric-all").click();
  await page.locator('[data-action="calc-open"][data-calculator="egfr"]').click();
  assert.equal(await page.locator("#egfr-age").inputValue(), "60");
  assert.match(await resultText(page), /^38 /);
  await page.locator('#main-navigation [data-action="calculators"]').click();
  await page.locator("#calculator-list").waitFor();
  assert.equal(await page.locator("#egfr-age").count(), 0, "the menu item returns to the list");
  assert.equal(await storageSnapshot(page), before);
});

test("calculator list and eGFR fit a 390px screen without horizontal page scrolling", {timeout: 25000}, async t => {
  const page = await openApp(t, {width: 390, height: 844});
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await openCalculators(page);
  assert.equal(await overflow(), 0);
  await page.locator("#calc-rubric-mind").scrollIntoViewIfNeeded();
  await page.locator("#calc-rubric-mind").click();
  assert.deepEqual(await groups(page), ["Психика"]);
  assert.deepEqual(await page.locator('[data-action="calc-open"]').evaluateAll(nodes => nodes.map(node => node.dataset.calculator)), ["phq9", "gad7"]);
  await page.locator("#calc-rubric-kidney").scrollIntoViewIfNeeded();
  await page.locator("#calc-rubric-kidney").click();
  await page.locator('[data-action="calc-open"][data-calculator="egfr"]').click();
  await fillEgfr(page, {age: "75", sex: "female", creatinine: "300"});
  assert.match(await resultText(page), /G4|G5/);
  assert.equal(await overflow(), 0);
  const box = await page.locator("#egfr-unit").boundingBox();
  assert.equal(box.x + box.width <= 390, true, "the unit selector stays on screen");
});

const resultOf = async (page, id) => (await page.locator("#" + id + "-result").innerText()).replace(/\s+/g, " ").trim();
async function openCalculator(page, id) {
  await openCalculators(page);
  await page.locator('[data-action="calc-open"][data-calculator="' + id + '"]').click();
  await page.locator("#" + id + "-result").waitFor();
}
async function stubClipboard(page) {
  await page.evaluate(() => {
    window.copiedText = [];
    Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText: async text => { window.copiedText.push(text); }}});
  });
}
async function copyResult(page, id) {
  await page.locator("#" + id + "-copy").click();
  await page.locator("#toast").filter({hasText: "Результат скопирован."}).waitFor();
  return page.evaluate(() => window.copiedText.pop());
}
const sourceLinks = page => page.locator(".calculator-sources a").evaluateAll(links => links.map(link => link.getAttribute("href")));

test("Cockcroft–Gault gives the hand-checked clearance, validates weight and cites the 1976 paper", {timeout: 25000}, async t => {
  const page = await openApp(t);
  await openCalculator(page, "cockcroft");
  await stubClipboard(page);
  assert.equal(await page.locator("h1").innerText(), "Клиренс креатинина по Кокрофту–Голту");
  assert.match(await page.locator(".calculator-disclaimer").innerText(), /Не заменяет клиническое решение/);
  assert.equal(await resultOf(page, "cockcroft"), "Введите возраст, пол, массу тела и креатинин.");
  await page.locator("#cockcroft-unit").selectOption("mg");
  await page.locator("#cockcroft-age").fill("60");
  await page.locator('input[name="cockcroft-sex"][value="male"]').check();
  await page.locator("#cockcroft-weight").fill("10");
  await page.locator("#cockcroft-creatinine").focus();
  assert.equal(await page.locator("#cockcroft-weight-error").innerText(), "Масса тела — число от 20 до 300 кг.");
  assert.equal(await page.locator("#cockcroft-weight").getAttribute("aria-invalid"), "true");
  await page.locator("#cockcroft-weight").fill("72");
  await page.locator("#cockcroft-creatinine").fill("1,0");
  assert.match(await resultOf(page, "cockcroft"), /^80 мл\/мин/);
  await page.locator('input[name="cockcroft-sex"][value="female"]').check();
  assert.match(await resultOf(page, "cockcroft"), /^68 мл\/мин/);
  assert.equal(await copyResult(page, "cockcroft"), "Клиренс креатинина (Кокрофт–Голт) 68 мл/мин; масса тела 72 кг, креатинин 1,0 мг/дл.");
  assert.match(await page.locator(".calculator-reference").innerText(), /КлКр = \(140 − возраст\) × масса тела \/ \(72 × Scr\) × 0,85 \[для женщин\]/);
  assert.deepEqual(await sourceLinks(page), ["https://doi.org/10.1159/000180580"]);
  assert.equal(core.calculateCockcroftGault({age: "60", sex: "female", weight: "72", creatinine: "1,0", unit: "mg"}).result.value, 68, "the screen and the core agree");
});

test("CHA2DS2-VASc shows both scores with the ESC 2024 CHA2DS2-VA verdict", {timeout: 25000}, async t => {
  const page = await openApp(t);
  await openCalculator(page, "chads");
  await stubClipboard(page);
  assert.equal(await page.locator("h1").innerText(), "CHA₂DS₂-VASc и CHA₂DS₂-VA");
  assert.equal(await resultOf(page, "chads"), "Укажите возраст и пол.");
  assert.equal(await page.locator("#chads-copy").isDisabled(), true);
  assert.deepEqual(await page.locator(".calculator-check .calculator-points").allInnerTexts(), ["+1", "+1", "+1", "+2", "+1"]);
  await page.locator("#chads-age").fill("50");
  await page.locator('input[name="chads-sex"][value="male"]').check();
  assert.match(await resultOf(page, "chads"), /^0 баллов по CHA₂DS₂-VA CHA₂DS₂-VASc: 0 баллов По шкале показаний к антикоагулянтной терапии нет/);
  await page.locator("#chads-age").fill("72");
  assert.match(await resultOf(page, "chads"), /^1 балл по CHA₂DS₂-VA .*следует рассмотреть/);
  await page.locator('input[name="chads-sex"][value="female"]').check();
  await page.locator("#chads-hypertension").check();
  assert.match(await resultOf(page, "chads"), /^2 балла по CHA₂DS₂-VA CHA₂DS₂-VASc: 3 балла Пероральная антикоагулянтная терапия рекомендуется/);
  assert.equal(await copyResult(page, "chads"), "CHA₂DS₂-VA — 2 балла, CHA₂DS₂-VASc — 3 балла; учтены: артериальная гипертензия, возраст 65–74 года, женский пол (только в CHA₂DS₂-VASc).");
  await page.locator("#chads-age").fill("17");
  await page.locator("#chads-stroke").focus();
  assert.equal(await page.locator("#chads-age-error").innerText(), "Возраст — целое число лет от 18 до 120.");
  assert.equal(await resultOf(page, "chads"), "Исправьте отмеченные поля.");
  const reference = await page.locator(".calculator-reference").innerText();
  assert.match(reference, /Толкование \(ESC 2024, CHA₂DS₂-VA\)/);
  assert.match(reference, /механическом протезе клапана или умеренном и тяжёлом митральном стенозе/);
  assert.match(reference, /клиническим протоколом Минздрава Республики Беларусь/);
  assert.deepEqual(await sourceLinks(page), ["https://doi.org/10.1378/chest.09-1584", "https://doi.org/10.1093/eurheartj/ehae176", "https://doi.org/10.1093/europace/euae298"]);
});

test("HAS-BLED, CRB-65 and Centor/McIsaac count ticks from the keyboard and keep them in this window only", {timeout: 30000}, async t => {
  const page = await openApp(t);
  const before = await storageSnapshot(page);
  await openCalculator(page, "hasbled");
  await stubClipboard(page);
  assert.match(await resultOf(page, "hasbled"), /^0 баллов по HAS-BLED не относится к высокому риску/);
  assert.equal(await page.locator("#hasbled-copy").isDisabled(), false);
  assert.match(await page.locator(".calculator-note").innerText(), /вторичных источников/);
  for (const key of ["hypertension", "elderly"]) await page.locator("#hasbled-" + key).check();
  assert.match(await resultOf(page, "hasbled"), /^2 балла по HAS-BLED не относится к высокому риску/);
  await page.locator("#hasbled-drugs").focus();
  await page.keyboard.press("Space");
  assert.match(await resultOf(page, "hasbled"), /^3 балла по HAS-BLED высокий риск кровотечения .*не причина отказываться от антикоагулянта/);
  assert.equal(await copyResult(page, "hasbled"), "HAS-BLED — 3 балла (высокий риск кровотечения); учтены: неконтролируемая артериальная гипертензия, возраст старше 65 лет, антиагреганты или НПВС.");
  assert.deepEqual(await sourceLinks(page), ["https://doi.org/10.1378/chest.10-0134", "https://doi.org/10.4070/kcj.2014.44.5.281"]);

  await page.locator('[data-action="calc-back"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.calculator), "hasbled");
  await page.locator('[data-action="calc-open"][data-calculator="crb65"]').click();
  assert.match(await resultOf(page, "crb65"), /^0 баллов по CRB-65 низкий риск 30-дневная летальность менее 1%/);
  await page.locator("#crb65-age65").check();
  await page.locator("#crb65-confusion").check();
  assert.match(await resultOf(page, "crb65"), /^2 балла по CRB-65 промежуточный риск 30-дневная летальность 1–10% Рассмотрите направление в стационар/);
  assert.equal(await copyResult(page, "crb65"), "CRB-65 — 2 балла (промежуточный риск, 30-дневная летальность 1–10%); учтены: нарушение сознания, возраст 65 лет и старше.");
  assert.deepEqual(await sourceLinks(page), ["https://doi.org/10.1136/thorax.58.5.377", "https://www.nice.org.uk/guidance/ng250"]);

  await page.locator('[data-action="calc-back"]').click();
  await page.locator('[data-action="calc-open"][data-calculator="centor"]').click();
  for (const key of ["exudate", "fever", "noCough"]) await page.locator("#centor-" + key).check();
  assert.match(await resultOf(page, "centor"), /^3 балла по Centor McIsaac: укажите возраст Вероятность стрептококковой инфекции 32–56%/);
  await page.locator('input[name="centor-ageGroup"][value="older"]').check();
  assert.match(await resultOf(page, "centor"), /^3 балла по Centor McIsaac: 2 балла/);
  await page.locator("#centor-exudate").uncheck();
  await page.locator('input[name="centor-ageGroup"][value="child"]').check();
  assert.match(await resultOf(page, "centor"), /^2 балла по Centor McIsaac: 3 балла Вероятность стрептококковой инфекции 3–17%. Антибиотик не назначается/);
  assert.equal(await copyResult(page, "centor"), "Centor — 2 балла, McIsaac — 3 балла; учтены: лихорадка выше 38 °C, нет кашля; возраст 3–14 лет.");
  assert.match(await page.locator(".calculator-reference").innerText(), /Балл McIsaac показан без толкования/);

  await page.locator('[data-action="calc-back"]').click();
  await page.locator('[data-action="calc-open"][data-calculator="hasbled"]').click();
  assert.equal(await page.locator("#hasbled-drugs").isChecked(), true, "ticks survive switching calculators in this window");
  assert.match(await resultOf(page, "hasbled"), /^3 балла/);
  assert.equal(await storageSnapshot(page), before, "nothing is written to localStorage or sessionStorage");
});

test("score calculators fit a 390px screen without horizontal page scrolling", {timeout: 25000}, async t => {
  const page = await openApp(t, {width: 390, height: 844});
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const id of ["cockcroft", "chads", "hasbled", "crb65", "centor"]) {
    await page.locator('#main-navigation [data-action="calculators"]').click();
    await page.locator("#calculator-list").waitFor();
    await page.locator('[data-action="calc-open"][data-calculator="' + id + '"]').click();
    await page.locator("#" + id + "-result").waitFor();
    if (id === "chads") { await page.locator("#chads-age").fill("80"); await page.locator('input[name="chads-sex"][value="female"]').check(); await page.locator("#chads-vascular").check(); }
    assert.equal(await overflow(), 0, id);
    const box = await page.locator(".calculator-form").boundingBox();
    assert.equal(box.x + box.width <= 390, true, id + " form stays on screen");
  }
});

async function answerAll(page, id, values) {
  for (const [name, value] of Object.entries(values)) await page.locator('input[name="' + id + '-' + name + '"][value="' + value + '"]').check();
}

test("FIB-4 and corrected QT show hand-checked values, thresholds and sources", {timeout: 25000}, async t => {
  const page = await openApp(t);
  await openCalculator(page, "fib4");
  await stubClipboard(page);
  assert.equal(await page.locator("h1").innerText(), "FIB-4");
  assert.equal(await resultOf(page, "fib4"), "Введите возраст, АСТ, АЛТ и тромбоциты.");
  await page.locator("#fib4-age").fill("50");
  await page.locator("#fib4-ast").fill("40");
  await page.locator("#fib4-alt").fill("25");
  await page.locator("#fib4-platelets").fill("0");
  await page.locator("#fib4-age").focus();
  assert.equal(await page.locator("#fib4-platelets-error").innerText(), "Тромбоциты — число от 1 до 2000 × 10⁹/л.");
  await page.locator("#fib4-platelets").fill("200");
  // 50 × 40 / (200 × √25) = 2.00
  assert.match(await resultOf(page, "fib4"), /^2,00 FIB-4 неопределённая зона пороги 1,30 и 2,67 Между порогами/);
  await page.locator("#fib4-age").fill("65");
  assert.match(await resultOf(page, "fib4"), /^2,60 FIB-4 неопределённая зона пороги 2,0 и 2,67/);
  await page.locator("#fib4-ast").fill("30");
  assert.match(await resultOf(page, "fib4"), /^1,95 FIB-4 выраженный фиброз маловероятен пороги 2,0 и 2,67/);
  assert.equal(await copyResult(page, "fib4"), "FIB-4 1,95 (выраженный фиброз маловероятен); возраст 65 лет, АСТ 30 Ед/л, АЛТ 25 Ед/л, тромбоциты 200 × 10⁹/л.");
  assert.match(await page.locator(".calculator-reference").innerText(), /FIB-4 = возраст × АСТ \/ \(тромбоциты × √АЛТ\)/);
  assert.deepEqual(await sourceLinks(page), ["https://doi.org/10.1002/hep.21178", "https://doi.org/10.1016/j.cgh.2009.05.033", "https://doi.org/10.1038/ajg.2016.453", "https://doi.org/10.1016/j.jhep.2024.04.031"]);

  await page.locator('[data-action="calc-back"]').click();
  await page.locator('[data-action="calc-open"][data-calculator="qtc"]').click();
  assert.equal(await page.locator("h1").innerText(), "Корригированный интервал QT");
  await page.locator("#qtc-qt").fill("400");
  await page.locator("#qtc-rate").fill("75");
  await page.locator('input[name="qtc-sex"][value="male"]').check();
  // RR 0.8 s: 400 / ∛0.8 = 431; 400 / √0.8 = 447
  assert.match(await resultOf(page, "qtc"), /^431 мс по Фридериции не выше верхней границы нормы По Базетту: 447 мс — не выше верхней границы нормы\. Верхняя граница нормы \(99-й перцентиль\) — 470 мс/);
  await page.locator("#qtc-rate").fill("120");
  assert.match(await resultOf(page, "qtc"), /^504 мс по Фридериции опасное удлинение, более 500 мс По Базетту: 566 мс/);
  assert.equal(await copyResult(page, "qtc"), "QTc по Фридериции 504 мс (опасное удлинение, более 500 мс), по Базетту 566 мс (опасное удлинение, более 500 мс); QT 400 мс, ЧСС 120 в минуту.");
  await page.locator('input[name="qtc-sex"][value="female"]').check();
  await page.locator("#qtc-rate").fill("60");
  await page.locator("#qtc-qt").fill("481");
  assert.match(await resultOf(page, "qtc"), /^481 мс по Фридериции удлинён .*480 мс/);
  assert.deepEqual(await sourceLinks(page), ["https://doi.org/10.1046/j.1542-474X.2003.08413.x", "https://doi.org/10.1161/JAHA.116.003264", "https://doi.org/10.1161/CIRCULATIONAHA.109.192704"]);
  assert.match(await page.locator(".calculator-sources").innerText(), /Bazett HC\. An analysis of the time-relations of electrocardiograms\. Heart\. 1920;7:353–370\./);
});

test("FINDRISC counts unanswered questions and sums the form points", {timeout: 25000}, async t => {
  const page = await openApp(t);
  await openCalculator(page, "findrisc");
  await stubClipboard(page);
  assert.equal(await resultOf(page, "findrisc"), "Ответьте на все 8 вопросов: осталось 8.");
  assert.equal(await page.locator("#findrisc-copy").isDisabled(), true);
  await answerAll(page, "findrisc", {age: "55-64", bmi: "25-30", waist: "middle", activity: "no", vegetables: "daily", bpDrugs: "yes", glucose: "no"});
  assert.equal(await resultOf(page, "findrisc"), "Ответьте на все 8 вопросов: осталось 1.");
  await answerAll(page, "findrisc", {family: "second"});
  // 3 + 1 + 3 + 2 + 0 + 2 + 0 + 3 = 14
  assert.match(await resultOf(page, "findrisc"), /^14 баллов по FINDRISC умеренный риск Ориентировочно 1 из 6 человек/);
  await answerAll(page, "findrisc", {family: "first"});
  assert.match(await resultOf(page, "findrisc"), /^16 баллов по FINDRISC высокий риск Ориентировочно 1 из 3 человек/);
  assert.equal(await copyResult(page, "findrisc"), "FINDRISC — 16 баллов: высокий риск сахарного диабета 2 типа (около 1 из 3 за 10 лет).");
  assert.deepEqual(await page.locator(".calculator-table tbody tr").allInnerTexts().then(rows => rows.map(row => row.split("\t")[0])), ["менее 7", "7–11", "12–14", "15–20", "более 20"]);
  assert.match(await page.locator(".calculator-reference").innerText(), /наш перевод, а не валидированная версия анкеты/);
});

test("PHQ-9 and GAD-7 use the official Russian wording, flag question 9 and copy the record line", {timeout: 30000}, async t => {
  const page = await openApp(t);
  const before = await storageSnapshot(page);
  await openCalculator(page, "phq9");
  await stubClipboard(page);
  assert.equal(await page.locator(".calculator-intro").innerText(), "Как часто за последние 2 недели Вас беспокоили следующие проблемы?");
  const legends = await page.locator(".calculator-form legend").allInnerTexts();
  assert.equal(legends.length, 10);
  assert.equal(legends[0], "1. Вам не хотелось ничего делать");
  assert.equal(legends[8], "9. Вас посещали мысли о том, что Вам лучше было бы умереть, или о том, чтобы причинить себе какой-нибудь вред");
  assert.deepEqual(await page.locator('input[name="phq9-q1"]').evaluateAll(nodes => nodes.map(node => node.closest("label").innerText.trim())), ["ни разу — 0", "несколько дней — 1", "более недели — 2", "почти каждый день — 3"]);
  assert.match(await page.locator(".calculator-note").innerText(), /официальный русский перевод/);
  assert.equal(await resultOf(page, "phq9"), "Ответьте на все 9 вопросов: осталось 9.");
  await answerAll(page, "phq9", {q1: "2", q2: "2", q3: "1", q4: "2", q5: "1", q6: "1", q7: "1", q8: "0", q9: "0"});
  assert.match(await resultOf(page, "phq9"), /^10 баллов по PHQ-9 выраженность депрессии: умеренная Предлагаемые действия по руководству PHQ — план лечения/);
  assert.equal(await page.locator(".calculator-alert").count(), 0);
  await answerAll(page, "phq9", {q9: "1", difficulty: "some"});
  assert.match(await resultOf(page, "phq9"), /^11 баллов по PHQ-9 .*Вопрос 9 — положительный ответ\. Требуется клиническая оценка суицидального риска\./);
  assert.equal(await copyResult(page, "phq9"), "PHQ-9 — 11 баллов (выраженность депрессии: умеренная); вопрос 9 — 1 балл; трудности из-за этих проблем: немного трудно.");
  await page.locator('input[name="phq9-q8"][value="2"]').focus();
  await page.keyboard.press("Space");
  assert.match(await resultOf(page, "phq9"), /^13 баллов/, "answers work from the keyboard");

  await page.locator('[data-action="calc-back"]').click();
  await page.locator('[data-action="calc-open"][data-calculator="gad7"]').click();
  assert.equal(await page.locator(".calculator-intro").innerText(), "Как часто Вас за последние 14 дней беспокоили следующие проблемы?");
  assert.equal(await page.locator(".calculator-form legend").last().innerText(), "7. Вы испытывали страх, словно должно произойти нечто ужасное");
  await answerAll(page, "gad7", {q1: "2", q2: "1", q3: "2", q4: "1", q5: "0", q6: "1", q7: "1"});
  assert.match(await resultOf(page, "gad7"), /^8 баллов по GAD-7 выраженность тревоги: лёгкая Ниже порога 10 баллов/);
  await answerAll(page, "gad7", {q5: "2"});
  assert.match(await resultOf(page, "gad7"), /^10 баллов по GAD-7 выраженность тревоги: умеренная 10 баллов и более — рекомендуемый порог/);
  assert.equal(await copyResult(page, "gad7"), "GAD-7 — 10 баллов (выраженность тревоги: умеренная).");
  assert.deepEqual(await sourceLinks(page), ["https://doi.org/10.1001/archinte.166.10.1092", "https://www.phqscreeners.com/images/sites/g/files/g10016261/f/201412/instructions.pdf", "https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/GAD7_Russian%20for%20Russia.pdf"]);
  await page.locator('[data-action="calc-back"]').click();
  await page.locator('[data-action="calc-open"][data-calculator="phq9"]').click();
  assert.equal(await page.locator('input[name="phq9-q9"][value="1"]').isChecked(), true, "answers survive switching calculators in this window");
  assert.equal(await storageSnapshot(page), before, "nothing is written to localStorage or sessionStorage");
});

test("FIB-4, QT, FINDRISC, PHQ-9 and GAD-7 fit a 390px screen", {timeout: 25000}, async t => {
  const page = await openApp(t, {width: 390, height: 844});
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const id of ["fib4", "qtc", "findrisc", "phq9", "gad7"]) {
    await page.locator('#main-navigation [data-action="calculators"]').click();
    await page.locator("#calculator-list").waitFor();
    await page.locator('[data-action="calc-open"][data-calculator="' + id + '"]').click();
    await page.locator("#" + id + "-result").waitFor();
    assert.equal(await overflow(), 0, id);
    const box = await page.locator(".calculator-form").boundingBox();
    assert.equal(box.x + box.width <= 390, true, id + " form stays on screen");
  }
});

test("SCORE2 and SCORE2-OP reproduce the published examples, explain their limits and fit 390px", {timeout: 25000}, async t => {
  const page = await openApp(t);
  await openCalculator(page, "score2");
  await stubClipboard(page);
  assert.equal(await page.locator("h1").innerText(), "SCORE2 и SCORE2-OP");
  assert.equal(await resultOf(page, "score2"), "Введите возраст, пол, курение, САД, общий холестерин и ЛПВП.");
  assert.match(await page.locator("#score2-age-hint").innerText(), /70 лет и старше — SCORE2-OP/);
  await page.locator("#score2-age").fill("101");
  await page.locator("#score2-sbp").focus();
  assert.equal(await page.locator("#score2-age-error").innerText(), "Возраст — целое число лет от 40 до 100: SCORE2 для 40–69 лет, SCORE2-OP для 70 лет и старше.");
  await page.locator("#score2-age").fill("50");
  await page.locator('input[name="score2-sex"][value="male"]').check();
  await page.locator('input[name="score2-smoking"][value="yes"]').check();
  await page.locator("#score2-sbp").fill("140");
  await page.locator("#score2-tchol").fill("5,5");
  await page.locator("#score2-hdl").fill("1,3");
  assert.match(await resultOf(page, "score2"), /^14,0 % за 10 лет по SCORE2 очень высокий риск пороги для этого возраста: 5,0 и 10,0 %/);
  await page.locator('input[name="score2-sex"][value="female"]').check();
  assert.match(await resultOf(page, "score2"), /^13,7 % за 10 лет по SCORE2 очень высокий риск/);
  await page.locator("#score2-age").fill("75");
  // SCORE2-OP supplement example (woman, 75, smoker, SBP 140, cholesterol 5.5, HDL 1.3): 24.4% before, 45.5% after very high-risk rescaling.
  assert.match(await resultOf(page, "score2"), /^45,5 % за 10 лет по SCORE2-OP очень высокий риск пороги для этого возраста: 7,5 и 15,0 %/);
  await page.locator("#score2-age").fill("50");
  assert.equal(await copyResult(page, "score2"), "SCORE2 (регион очень высокого риска) — 13,7% за 10 лет: очень высокий риск; возраст 50 лет, курит, САД 140 мм рт. ст., общий холестерин 5,5 ммоль/л, ЛПВП 1,3 ммоль/л.");
  await page.locator("#score2-age").fill("45");
  await page.locator('input[name="score2-smoking"][value="no"]').check();
  await page.locator("#score2-sbp").fill("110");
  await page.locator("#score2-tchol").fill("4.5");
  await page.locator("#score2-hdl").fill("1.6");
  assert.match(await resultOf(page, "score2"), /^1,9 % за 10 лет по SCORE2 низкий или умеренный риск пороги для этого возраста: 2,5 и 7,5 %/);
  const reference = await page.locator(".calculator-reference").innerText();
  assert.match(reference, /0,5836 и 0,8294 у мужчин, 0,9412 и 0,8329 у женщин/);
  assert.match(reference, /0,05 и 0,70 у мужчин, 0,38 и 0,69 у женщин/);
  assert.match(reference, /70 лет и старше\tменее 7,5%/);
  assert.match(reference, /Беларусь в него входит/);
  assert.match(reference, /сверены по вторичным источникам/);
  assert.deepEqual(await sourceLinks(page), ["https://doi.org/10.1093/eurheartj/ehab309", "https://doi.org/10.1093/eurheartj/ehab312", "https://doi.org/10.1093/eurheartj/ehab484", "https://doi.org/10.1038/s44161-024-00438-8", "https://doi.org/10.1093/eurheartj/ehad539"]);
  assert.match(await page.locator(".calculator-sources + .hint").innerText(), /14,0% у мужчин и 13,7% у женщин/);
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
});

// Prefill: two fictional patients, one with a birth date, an open appointment and lab reports, one with only an older appointment.
const prefillNow = {now};
function prefillBundle() {
  let anna = core.createPatient({id: "prefill-anna", label: "Тестова Анна Вымышленная", now});
  anna = {...anna, birthDate: "1970-03-15"};
  anna = core.upsertInvestigationReport(anna, {panelId: "biochemistry", title: "Биохимический анализ крови", kind: "lab", date: "2032-04-18", rows: [
    {fieldId: "creatinine", name: "Креатинин крови", result: "80", unit: "мкмоль/л", reference: "", note: ""},
    {fieldId: "cholesterol-total", name: "Холестерин общий крови", result: "6,1", unit: "ммоль/л", reference: "", note: ""},
    {fieldId: "hdl", name: "Холестерин ЛПВП крови", result: "1,3", unit: "ммоль/л", reference: "", note: ""},
    {fieldId: "alt", name: "Аланинаминотрансфераза крови (АЛТ)", result: "40", unit: "Ед/л", reference: "", note: ""},
    {fieldId: "ast", name: "Аспартатаминотрансфераза крови (АСТ)", result: "35", unit: "Ед/л", reference: "", note: ""}]}, prefillNow);
  anna = core.upsertInvestigationReport(anna, {panelId: "cbc", title: "Общий анализ крови", kind: "lab", date: "2032-04-18", rows: [
    {fieldId: "platelets", name: "Тромбоциты крови (PLT)", result: "180", unit: "10⁹/л", reference: "", note: ""}]}, prefillNow);
  const annaVisit = core.createEncounter({id: "prefill-anna-visit", patientId: anna.id, now});
  annaVisit.sex = "female";
  Object.assign(annaVisit.vitals, {systolic: "150", diastolic: "95", respiratoryRate: "18", weight: "70", height: "165"});
  const boris = core.createPatient({id: "prefill-boris", label: "Примеров Борис Вымышленный", now});
  const borisVisit = core.createEncounter({id: "prefill-boris-visit", patientId: boris.id, now});
  Object.assign(borisVisit, {visitDate: "2032-04-10", age: "72", sex: "male"});
  Object.assign(borisVisit.vitals, {systolic: "85", diastolic: "55", respiratoryRate: "32", weight: "90", height: "180"});
  return core.serializeBundle([annaVisit, borisVisit], [anna, boris]);
}
const origin = (page, id, key) => page.locator("#" + id + "-" + key + "-origin").innerText();
async function prefill(page, id, patientId) {
  if (patientId) await page.locator("#" + id + "-patient").selectOption(patientId);
  await page.locator("#" + id + "-prefill").click();
  await page.locator("#" + id + "-prefill-status").filter({hasText: "Подставлено"}).waitFor();
}

test("calculators take age, sex, pressure and lab results from the patient's data and show where each value came from", {timeout: 40000}, async t => {
  const page = await openApp(t);
  await page.evaluate(({key, value}) => localStorage.setItem(key, value), {key, value: prefillBundle()});
  await page.reload();
  await page.locator('#main-navigation [data-action="choose-area"]').click();
  await page.locator('[data-action="enter-polyclinic"]').click();
  await page.locator('#main-navigation [data-action="patients"]').click();
  await page.locator('.patient-row[data-patient-id="prefill-anna"] [data-action="patient"]').click();
  await page.locator('#patient-history [data-action="open"][data-id="prefill-anna-visit"]').click();
  await page.locator('#main-navigation [data-action="visit"]').waitFor();
  await page.locator('#main-navigation [data-action="choose-area"]').click();
  await page.locator('[data-action="enter-modules"]').click();
  await openCalculator(page, "score2");
  const before = await storageSnapshot(page);

  assert.deepEqual(await page.locator("#score2-patient option").allInnerTexts(), ["Тестова Анна Вымышленная — текущий приём", "Примеров Борис Вымышленный"], "the open appointment comes first");
  assert.equal(await page.locator("#score2-patient").inputValue(), "prefill-anna");
  assert.equal(await page.locator("#score2-age").inputValue(), "", "nothing is filled until the doctor asks");
  await prefill(page, "score2");
  assert.deepEqual(await Promise.all(["age", "sbp", "tchol", "hdl"].map(key => page.locator("#score2-" + key).inputValue())), ["62", "150", "6,1", "1,3"]);
  assert.equal(await page.locator('input[name="score2-sex"]:checked').getAttribute("value"), "female");
  assert.equal(await page.locator('input[name="score2-smoking"]:checked').count(), 0, "smoking is not recorded in the card and stays for the doctor");
  assert.equal(await origin(page, "score2", "age"), "По дате рождения из карточки (15.03.1970)");
  assert.equal(await origin(page, "score2", "sex"), "Из текущего приёма от 19.04.2032");
  assert.equal(await origin(page, "score2", "sbp"), "Из текущего приёма от 19.04.2032");
  assert.equal(await origin(page, "score2", "tchol"), "Из бланка «Биохимический анализ крови» от 18.04.2032");
  assert.match(await page.locator("#score2-age").getAttribute("aria-describedby"), /score2-age-origin/);
  assert.equal(await page.locator("#score2-prefill-status").innerText(), "Подставлено для: Тестова Анна Вымышленная. Из данных пациента: возраст, пол, систолическое АД, общий холестерин, холестерин ЛПВП. Проверьте значения.");
  await page.locator('input[name="score2-smoking"][value="no"]').check();
  const expected = core.calculateScore2({age: "62", sex: "female", smoking: "no", sbp: "150", tchol: "6,1", hdl: "1,3"}).result;
  assert.match(await resultOf(page, "score2"), new RegExp(expected.percent.toFixed(1).replace(".", ",") + " % за 10 лет по SCORE2"));

  await page.locator("#score2-sbp").fill("140");
  assert.equal(await origin(page, "score2", "sbp"), "Изменено вручную");
  assert.equal(await page.locator("#score2-sbp-origin").getAttribute("class"), "calculator-origin manual");
  await page.locator("#score2-sbp").fill("150");
  assert.equal(await origin(page, "score2", "sbp"), "Из текущего приёма от 19.04.2032", "the source returns when the filled value is restored");

  await prefill(page, "score2", "prefill-boris");
  assert.deepEqual(await Promise.all(["age", "sbp", "tchol", "hdl"].map(key => page.locator("#score2-" + key).inputValue())), ["72", "85", "", ""], "another patient's values never stay in the form");
  assert.equal(await page.locator('input[name="score2-smoking"]:checked').count(), 0, "prefill clears answers given for the previous patient");
  assert.equal(await origin(page, "score2", "age"), "Из приёма от 10.04.2032");
  assert.equal(await page.locator("#score2-tchol-origin").count(), 0);
  assert.match(await page.locator("#score2-prefill-status").innerText(), /Не найдено: общий холестерин; холестерин ЛПВП — введите вручную\./);

  await page.locator('[data-action="calc-back"]').click();
  await openCalculator(page, "crb65");
  assert.equal(await page.locator("#crb65-patient").inputValue(), "prefill-boris", "the chosen patient stays for the next calculator in this window");
  await prefill(page, "crb65");
  assert.deepEqual(await Promise.all(["confusion", "respiratory", "pressure", "age65"].map(key => page.locator("#crb65-" + key).isChecked())), [false, true, true, true]);
  assert.equal(await origin(page, "crb65", "respiratory"), "ЧДД 32 в минуту из приёма от 10.04.2032");
  assert.equal(await origin(page, "crb65", "pressure"), "АД 85/55 мм рт. ст. из приёма от 10.04.2032");
  assert.equal(await origin(page, "crb65", "age65"), "Возраст 72 года из приёма от 10.04.2032");
  assert.equal(await page.locator("#crb65-confusion-origin").count(), 0, "confusion is never guessed");

  await page.locator('[data-action="calc-back"]').click();
  await openCalculator(page, "fib4");
  await prefill(page, "fib4", "prefill-anna");
  assert.deepEqual(await Promise.all(["age", "ast", "alt", "platelets"].map(key => page.locator("#fib4-" + key).inputValue())), ["62", "35", "40", "180"]);
  assert.equal(await origin(page, "fib4", "platelets"), "Из бланка «Общий анализ крови» от 18.04.2032");
  assert.match(await resultOf(page, "fib4"), new RegExp(core.calculateFib4({age: "62", ast: "35", alt: "40", platelets: "180"}).result.value.toFixed(2).replace(".", ",")));

  await page.locator('[data-action="calc-back"]').click();
  await openCalculator(page, "egfr");
  await prefill(page, "egfr");
  assert.equal(await page.locator("#egfr-creatinine").inputValue(), "80");
  assert.equal(await page.locator("#egfr-unit").inputValue(), "umol");
  assert.match(await resultOf(page, "egfr"), new RegExp("^" + core.calculateEgfrCkdEpi2021({age: "62", sex: "female", creatinine: "80", unit: "umol"}).result.value + " "));
  await page.locator("#egfr-unit").selectOption("mg");
  assert.equal(await origin(page, "egfr", "creatinine"), "Изменено вручную", "changing the unit also marks the value as edited");

  await page.locator('[data-action="calc-back"]').click();
  await openCalculator(page, "findrisc");
  await prefill(page, "findrisc");
  assert.equal(await page.locator('input[name="findrisc-age"]:checked').getAttribute("value"), "55-64");
  assert.equal(await page.locator('input[name="findrisc-bmi"]:checked').getAttribute("value"), "25-30");
  assert.equal(await origin(page, "findrisc", "bmi"), "ИМТ 25,7 кг/м² по массе и росту из текущего приёма от 19.04.2032");

  await page.locator('[data-action="calc-back"]').click();
  await openCalculator(page, "phq9");
  assert.equal(await page.locator("#phq9-patient").count(), 0, "questionnaires have nothing to take from the card");
  assert.equal(await storageSnapshot(page), before, "prefill writes nothing to localStorage or sessionStorage");
});

test("without patient cards the prefill choice is disabled", {timeout: 25000}, async t => {
  const page = await openApp(t);
  await openCalculator(page, "egfr");
  assert.deepEqual(await page.locator("#egfr-patient option").allInnerTexts(), ["Карточек пациентов нет"]);
  assert.equal(await page.locator("#egfr-patient").isDisabled(), true);
  assert.equal(await page.locator("#egfr-prefill").isDisabled(), true);
  assert.equal(await page.locator("#egfr-prefill-status").isVisible(), false);
});

// «Нормы анализов»: the agreed compact sheet. The display rule below is rewritten independently of app.js.
const normsKinds = [["cbc", "ОАК"], ["biochemistry", "Биохимия крови"], ["urinalysis", "Общий анализ мочи"], ["coagulation", "Коагулограмма"], ["thyroid", "Щитовидная железа"], ["hba1c", "HbA1c"]];
function normsExpected(row) {
  const confirmed = list => list.filter(entry => entry.status !== "unconfirmed");
  const item = confirmed(row.referenceIntervals).find(entry => entry.source.startsWith("BY-")) || confirmed(row.referenceIntervals)[0] || confirmed(row.researchExamples)[0];
  const unit = ["качественно", "качественно / безразмерно", "безразмерно"].includes(item.unit || row.displayUnit) ? "—" : item.unit || row.displayUnit;
  return {item, research: !row.referenceIntervals.includes(item), unit: unit + (row.unitAudit.belarusPublicationConfirmed ? "" : " †")};
}
async function openNorms(t, viewport) {
  const page = await openApp(t, viewport);
  await page.locator('#main-navigation [data-action="norms"]').click();
  await page.locator("#norms-list table").waitFor();
  return page;
}
async function chooseKind(page, id, title) {
  await page.locator("#norms-kind").selectOption(id);
  await page.waitForFunction(text => document.getElementById("norms-title")?.textContent === text, title);
}
// Every visible text inside the sheet: its text fill against the nearest painted background (WCAG ratio) and its size.
const contrastReport = page => page.evaluate(() => {
  const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const background = node => { for (let el = node; el; el = el.parentElement) { const c = rgb(getComputedStyle(el).backgroundColor); if (c.length === 3 || c[3] > 0) return c.slice(0, 3); } return [255, 255, 255]; };
  const weak = [];
  let count = 0;
  for (const el of document.querySelectorAll(".norms-compact *")) {
    if (![...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
    const box = el.getBoundingClientRect(), style = getComputedStyle(el);
    if (!box.width || !box.height || style.visibility === "hidden") continue;
    const [a, b] = [lum(rgb(style.webkitTextFillColor || style.color)), lum(background(el))].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    count += 1;
    if (ratio < 4.5 || parseFloat(style.fontSize) < 12) weak.push(el.tagName + "." + el.className + " «" + el.textContent.trim().slice(0, 30) + "» " + ratio.toFixed(2) + " " + style.fontSize);
  }
  return {count, weak};
});

test("Нормы анализов show all 86 registry rows in six kinds with the agreed source, unit and value, and never write data", {timeout: 60000}, async t => {
  const page = await openApp(t);
  // The shipped data come from the page itself, so the scenario also checks an installed copy without research files.
  const {registry, catalog} = await page.evaluate(() => ({registry: window.MedAssistLabRegistry, catalog: window.MedAssistInvestigationCatalog}));
  assert.equal(registry.approvedForImport, false);
  assert.deepEqual(registry.rows.map(row => row.key).sort(), catalog.panels.filter(panel => panel.kind === "lab").flatMap(panel => panel.fields.map(field => panel.id + "/" + field.id)).sort());
  const before = await storageSnapshot(page);
  await page.locator(".module-card").filter({hasText: "Анализы и исследования"}).locator('[data-action="norms"]').click();
  await page.locator("#norms-list table").waitFor();
  assert.equal(await view(page), "norms");
  assert.match(await page.title(), / — модули$/);
  assert.equal(await page.locator('#main-navigation [data-action="norms"]').getAttribute("aria-current"), "page");
  assert.match(await page.locator(".norms-notice").innerText(), /Сверяйте результат с интервалом на бланке своей лаборатории/);
  assert.deepEqual(await page.locator("#norms-kind option").evaluateAll(nodes => nodes.map(node => [node.value, node.textContent])), normsKinds);
  assert.deepEqual((await page.locator("#norms-list thead th").allInnerTexts()).map(text => text.replace(/\u00ad/g, "")), ["Показатель", "Обозначение", "Ед. источника", "Интервал / опубликованный ориентир"]);
  const seen = [];
  for (const [id] of normsKinds) {
    const rows = registry.rows.filter(row => row.panelId === id);
    await chooseKind(page, id, rows[0].panelName);
    assert.equal(await page.locator("#norms-kind").inputValue(), id);
    assert.equal(await page.locator(".norms-count").innerText(), "Показателей: " + rows.length);
    const shown = await page.locator("#norms-list tr.norms-row").evaluateAll(nodes => nodes.map(node => ({
      key: node.dataset.norm, kind: node.dataset.kind, cells: [...node.children].map(cell => cell.innerText.replace(/\s+/g, " ").trim()),
      value: node.querySelector(".norms-value").textContent, origin: node.querySelector(".norms-origin").textContent, zebra: node.classList.contains("norms-zebra")
    })));
    assert.deepEqual(shown.map(row => row.key), rows.map(row => row.key), id + " lists every registry row in registry order");
    shown.forEach((row, index) => {
      const source = rows[index], expected = normsExpected(source);
      seen.push(row.key);
      assert.deepEqual(row.cells.slice(0, 3), [source.shortName, source.abbreviation, expected.unit], row.key);
      assert.equal(row.value, expected.item.value, row.key + " value comes from one source record");
      assert.equal(row.kind, expected.research ? "research" : "reference", row.key);
      if (expected.research) assert.match(row.origin, /^Исследовательский пример · /, row.key + " research examples are labelled in the row");
      else if (!expected.item.source.startsWith("BY-")) assert.doesNotMatch(row.origin, /Беларусь/, row.key + " foreign references are not called Belarusian");
      assert.equal(row.zebra, index % 2 === 0);
    });
    const foot = await page.locator(".norms-sheet-foot").innerText();
    assert.equal(foot.includes("† Формат единицы в отдельном бланке Беларуси не подтверждён."), rows.some(row => !row.unitAudit.belarusPublicationConfirmed));
  }
  assert.equal(new Set(seen).size, 86, "all 86 keys are shown");
  assert.equal(registry.rows.filter(row => !row.unitAudit.belarusPublicationConfirmed).length, 12);
  assert.equal(await storageSnapshot(page), before, "the reference never writes local or session data");
});

test("Нормы анализов open details under the value with every candidate, separate clinical limits, the audit and links, by mouse and keyboard", {timeout: 120000}, async t => {
  const page = await openNorms(t);
  const registry = await page.evaluate(() => window.MedAssistLabRegistry);
  const sources = new Map(registry.sources.map(source => [source.id, source]));
  for (const [id] of normsKinds) {
    const rows = registry.rows.filter(row => row.panelId === id);
    await chooseKind(page, id, rows[0].panelName);
    for (const row of rows) {
      const button = page.locator('#norms-list tr[data-norm="' + row.key + '"] .norms-ref');
      const detail = page.locator("#" + await button.getAttribute("aria-controls"));
      assert.equal(await button.getAttribute("aria-expanded"), "false");
      assert.equal(await detail.isVisible(), false);
      await button.click();
      assert.equal(await button.getAttribute("aria-expanded"), "true", row.key);
      const text = (await detail.innerText()).replace(/\s+/g, " ");
      for (const entry of [...row.referenceIntervals, ...row.researchExamples, ...row.clinicalLimits, ...row.unconfirmed, ...row.history]) {
        assert.ok(text.includes((entry.value + (entry.unit ? " " + entry.unit : "")).replace(/\s+/g, " ")), row.key + " shows " + entry.value);
        assert.ok(text.includes(entry.kind), row.key + " kind");
        if (entry.scope) assert.ok(text.includes(entry.scope.replace(/\s+/g, " ")), row.key + " keeps the full scope text");
        if (entry.archivedFrom) assert.ok(text.includes(entry.archivedFrom), row.key + " dates the archived wording");
      }
      assert.equal(text.includes("Клинические пороги и цели — не референсный интервал"), row.clinicalLimits.length > 0, row.key + " clinical block");
      assert.equal(text.includes("Исследовательские примеры — не локальные нормы"), row.researchExamples.length > 0, row.key + " research block");
      assert.equal(text.includes("Не подтверждено полностью — не применять без сверки с первоисточником"), row.unconfirmed.length > 0, row.key + " unconfirmed block");
      assert.equal(text.includes("История — прежние редакции, не действующие рекомендации"), row.history.length > 0, row.key + " history block");
      assert.ok(!text.includes("Международные рекомендации, сверенные для Medasist 0.33.0"), row.key + " the old guidance block is not repeated next to the audited one");
      assert.ok(text.includes("Аудит 23.10.2026") && text.includes(row.audit.summary.replace(/\s+/g, " ")), row.key + " audit result");
      for (const line of [...row.audit.unverified, ...row.audit.recheck]) assert.ok(text.includes(line.replace(/\s+/g, " ")), row.key + " " + line.slice(0, 40));
      for (const note of row.notes) assert.ok(text.includes(note.replace(/\s+/g, " ")), row.key + " note");
      const links = await detail.locator("a").evaluateAll(nodes => nodes.map(node => [node.getAttribute("href"), node.target, node.rel]));
      for (const sid of row.sources) assert.ok(links.some(([href]) => href === sources.get(sid).url), row.key + " links " + sid);
      assert.ok(links.every(([, target, rel]) => target === "_blank" && rel === "noopener noreferrer"));
      await button.click();
      assert.equal(await button.getAttribute("aria-expanded"), "false");
      assert.equal(await detail.isVisible(), false);
    }
  }
  await chooseKind(page, "coagulation", "Коагулограмма");
  const inr = page.locator('#norms-list tr[data-norm="coagulation/inr"]');
  assert.match(await inr.locator(".norms-value").innerText(), /^0,8–1,2$/, "INR reference, not the treatment target, in the row");
  await inr.locator(".norms-ref").click();
  const inrDetail = page.locator("#norms-detail-coagulation-inr");
  assert.doesNotMatch(await inrDetail.locator(".norms-clinical").innerText(), /2,5–4,0|ESC\/EACTS 2021/, "the superseded valve matrix is not current guidance");
  assert.match(await inrDetail.locator(".norms-unconfirmed").innerText(), /3,0 \(2,5–3,5\)[\s\S]*Не подтверждено — не применять без сверки с первоисточником/, "the 2025 valve table is visibly unconfirmed");
  assert.match(await inrDetail.locator(".norms-history").innerText(), /ESC\/EACTS 2021[\s\S]*Показывалось в Medasist 0\.33\.0–0\.34\.0/);
  await inr.locator(".norms-ref").click();
  await chooseKind(page, "cbc", "Общий анализ крови");
  await page.locator("#norms-kind").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "norms-search");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.className), "norms-table-wrap");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.closest("tr")?.dataset.norm), registry.rows.find(row => row.panelId === "cbc").key);
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "none", "visible keyboard focus");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-expanded")), "true");
  await page.keyboard.press("Space");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-expanded")), "false");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "norms-kind");
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => document.getElementById("norms-title")?.textContent === "Биохимический анализ крови");
  assert.equal(await page.evaluate(() => document.activeElement.id), "norms-kind", "arrows keep focus on the analysis choice");
});

test("Нормы анализов show «Нет подтверждённого интервала» with its reason when no candidate is confirmed, never a substitute number", {timeout: 60000}, async t => {
  const page = await openNorms(t);
  // The shipped registry has no such row after the release re-check; the scenario marks one row unconfirmed in this window only.
  const original = await page.evaluate(() => {
    const row = window.MedAssistLabRegistry.rows.find(item => item.key === "cbc/esr");
    const value = row.referenceIntervals[0].value;
    row.referenceIntervals = row.referenceIntervals.map(entry => ({...entry, status: "unconfirmed"}));
    row.noCandidateReason = "Проверочная причина: повторная сверка не завершена.";
    return value;
  });
  await chooseKind(page, "biochemistry", "Биохимический анализ крови");
  await chooseKind(page, "cbc", "Общий анализ крови");
  const esr = page.locator('#norms-list tr[data-norm="cbc/esr"]');
  assert.equal(await esr.getAttribute("data-kind"), "none");
  assert.equal(await esr.locator(".norms-value").innerText(), "Нет подтверждённого интервала");
  assert.equal(await esr.locator(".norms-origin").innerText(), "Причина — в подробностях");
  assert.equal((await esr.locator(".norms-unit").innerText()).trim(), "—");
  await esr.locator(".norms-ref").click();
  const detail = (await page.locator("#norms-detail-cbc-esr").innerText()).replace(/\s+/g, " ");
  assert.ok(detail.includes("Нет подтверждённого интервала. Проверочная причина: повторная сверка не завершена."), "the reason is stated");
  assert.ok(detail.includes(original) && detail.includes("Не подтверждено — не применять без сверки с первоисточником"), "the unconfirmed number stays visible only with its mark");
  assert.deepEqual((await contrastReport(page)).weak, [], "the empty state stays readable");
});

test("Нормы анализов search all kinds, keep Back and the shell, stay readable against forced white text and fit 1366–320 px", {timeout: 90000}, async t => {
  const page = await openNorms(t);
  const before = await storageSnapshot(page);
  await page.locator("#norms-search").fill("креатинин");
  await page.waitForFunction(() => document.querySelectorAll("#norms-list tr.norms-row").length === 1);
  assert.equal(await page.locator("#norms-list tr.norms-row").getAttribute("data-norm"), "biochemistry/creatinine");
  assert.equal(await page.locator("#norms-list tr.norms-group").innerText(), "Биохимический анализ крови");
  assert.equal(await page.locator(".norms-count").innerText(), "Найдено: 1");
  await page.locator("#norms-search").fill("ттг");
  await page.waitForFunction(() => document.querySelector("#norms-list tr.norms-row")?.dataset.norm === "thyroid/tsh");
  await page.locator("#norms-search").fill("несуществующий показатель");
  await page.locator(".norms-empty").waitFor();
  await page.locator('[data-action="norms-clear"]').click();
  assert.equal(await page.locator("#norms-search").inputValue(), "");
  assert.equal(await page.evaluate(() => document.activeElement.id), "norms-search");
  await chooseKind(page, "thyroid", "Гормоны щитовидной железы");
  await page.locator('#main-navigation [data-action="calculators"]').click();
  await page.locator("#calculator-list").waitFor();
  assert.equal(await page.locator('[data-action="go-back"]').getAttribute("aria-label"), "Назад: Нормы анализов");
  await page.locator('[data-action="go-back"]').click();
  await page.waitForFunction(() => document.getElementById("norms-title")?.textContent === "Гормоны щитовидной железы");
  assert.equal(await page.locator("#norms-kind").inputValue(), "thyroid");
  // Alt+← still goes back while the analysis choice has focus.
  await page.locator("#norms-kind").focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForFunction(() => document.getElementById("app").dataset.view !== "norms");
  await page.locator('#main-navigation [data-action="norms"]').click();
  await page.locator("#norms-list table").waitFor();
  assert.equal(await page.locator("#norms-kind").inputValue(), "thyroid", "the chosen kind is kept in this window");
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({colorScheme: scheme});
    await chooseKind(page, "cbc", "Общий анализ крови");
    await page.locator('#norms-list tr[data-norm="cbc/hemoglobin"] .norms-ref').click();
    await page.locator('#norms-list tr[data-norm="cbc/hemoglobin"] .norms-ref').hover();
    const plain = await contrastReport(page);
    assert.ok(plain.count > 150, scheme + " checks the visible sheet: " + plain.count);
    assert.deepEqual(plain.weak, [], scheme + " contrast and size");
    // A conflicting outer text colour (white, important) must not reach the sheet.
    await page.evaluate(() => { for (const el of [document.documentElement, document.body, document.getElementById("app")]) { el.style.setProperty("color", "#fff", "important"); el.style.setProperty("-webkit-text-fill-color", "#fff", "important"); } });
    const forced = await contrastReport(page);
    assert.deepEqual(forced.weak, [], scheme + " with forced white text outside");
    await page.evaluate(() => { for (const el of [document.documentElement, document.body, document.getElementById("app")]) { el.style.removeProperty("color"); el.style.removeProperty("-webkit-text-fill-color"); } });
  }
  await page.emulateMedia({colorScheme: "light"});
  for (const [width, height] of [[1366, 768], [1024, 768], [736, 900], [390, 844], [320, 700]]) {
    await page.setViewportSize({width, height});
    for (const [id, title] of [["cbc", "Общий анализ крови"], ["biochemistry", "Биохимический анализ крови"]]) {
      await chooseKind(page, id, title);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, width + " no horizontal page scroll");
      const last = page.locator("#norms-list tr.norms-row").last();
      await last.locator(".norms-ref").scrollIntoViewIfNeeded();
      await last.locator(".norms-ref").click();
      assert.equal(await last.locator(".norms-ref").getAttribute("aria-expanded"), "true", width + " last indicator is reachable");
      const detailBox = await page.locator("#" + await last.locator(".norms-ref").getAttribute("aria-controls") + " .norms-detail-body").boundingBox();
      assert.ok(detailBox.x >= 0 && detailBox.x + detailBox.width <= width + 1, width + " details stay within the window");
      assert.deepEqual(await page.locator("#norms-list tr.norms-row").evaluateAll(nodes => nodes.flatMap(node => [...node.children]).filter(cell => cell.scrollWidth > cell.clientWidth + 1).map(cell => cell.textContent)), [], width + " no clipped cells");
    }
  }
  assert.equal(await storageSnapshot(page), before, "the reference never writes local or session data");
});
