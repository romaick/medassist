"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../app/core.js");

const egfr = core.calculateEgfrCkdEpi2021;

// Reference values worked by hand from Inker et al., NEJM 2021: when creatinine equals kappa both
// ratio terms are 1, so eGFR = 142 × 0.9938^age (× 1.012 for women).
test("CKD-EPI 2021 matches hand-worked reference values", () => {
  const cases = [
    [{age: "50", sex: "male", creatinine: "0.9", unit: "mg"}, 104.049, 104, "G1"],
    [{age: "50", sex: "female", creatinine: "0.7", unit: "mg"}, 105.298, 105, "G1"],
    // 142 × (2.0/0.9)^-1.2 × 0.9938^60 = 142 × 0.38358 × 0.68857
    [{age: "60", sex: "male", creatinine: "2.0", unit: "mg"}, 37.504, 38, "G3b"],
    // 142 × (0.5/0.7)^-0.241 × 0.9938^40 × 1.012 = 142 × 1.08447 × 0.77975 × 1.012
    [{age: "40", sex: "female", creatinine: "0.5", unit: "mg"}, 121.519, 122, "G1"]
  ];
  for (const [input, exact, value, category] of cases) {
    const {result, errors, missing} = egfr(input);
    assert.deepEqual([errors, missing], [{}, []], JSON.stringify(input));
    assert.ok(Math.abs(result.exact - exact) < 0.001, JSON.stringify(input) + " exact " + result.exact);
    assert.equal(result.value, value);
    assert.equal(result.category, category);
  }
});

test("micromoles convert at 88.4 µmol/L per mg/dL and a decimal comma is accepted", () => {
  const mg = egfr({age: "60", sex: "male", creatinine: "2.0", unit: "mg"}).result;
  const umol = egfr({age: "60", sex: "male", creatinine: "176,8", unit: "umol"}).result;
  assert.ok(Math.abs(mg.exact - umol.exact) < 1e-9);
  assert.equal(egfr({age: "60", sex: "male", creatinine: "176.8"}).result.value, 38, "micromoles are the default unit");
  assert.equal(egfr({age: " 50 ", sex: "female", creatinine: " 0,7 ", unit: "mg"}).result.value, 105);
});

test("the female factor and sex-specific kappa and alpha are applied", () => {
  const male = egfr({age: "50", sex: "male", creatinine: "0.7", unit: "mg"}).result.exact;
  const female = egfr({age: "50", sex: "female", creatinine: "0.7", unit: "mg"}).result.exact;
  // Men: (0.7/0.9)^-0.302; women: ratio 1 and ×1.012.
  assert.ok(Math.abs(male - 142 * (0.7 / 0.9) ** -0.302 * 0.9938 ** 50) < 1e-9);
  assert.ok(Math.abs(female - 142 * 0.9938 ** 50 * 1.012) < 1e-9);
});

test("categories follow KDIGO thresholds on the displayed whole number", () => {
  const seen = new Map();
  for (let micromoles = 40; micromoles <= 1200; micromoles += 1) {
    const {result} = egfr({age: "65", sex: "female", creatinine: String(micromoles)});
    const expected = result.value >= 90 ? "G1" : result.value >= 60 ? "G2" : result.value >= 45 ? "G3a" : result.value >= 30 ? "G3b" : result.value >= 15 ? "G4" : "G5";
    assert.equal(result.category, expected, micromoles + " µmol/L → " + result.value);
    seen.set(result.category, result.categoryLabel);
  }
  assert.deepEqual([...seen.keys()], ["G1", "G2", "G3a", "G3b", "G4", "G5"]);
  assert.equal(seen.get("G5"), "почечная недостаточность");
});

test("missing fields give no result and no error; invalid values give a clear message", () => {
  assert.deepEqual(egfr({}), {result: null, errors: {}, missing: ["age", "sex", "creatinine"]});
  assert.deepEqual(egfr(null).missing, ["age", "sex", "creatinine"]);
  for (const age of ["17", "121", "45.5", "сорок", "-30"]) {
    assert.match(egfr({age, sex: "male", creatinine: "80"}).errors.age, /от 18 до 120/, age);
  }
  for (const age of ["18", "120"]) assert.equal(egfr({age, sex: "male", creatinine: "80"}).result !== null, true, age);
  for (const creatinine of ["19.9", "3001", "abc", "0", "1e3", "80 мкмоль"]) {
    assert.match(egfr({age: "50", sex: "male", creatinine}).errors.creatinine, /от 20 до 3000 мкмоль\/л/, creatinine);
  }
  for (const creatinine of ["0.19", "34.1"]) {
    assert.match(egfr({age: "50", sex: "male", creatinine, unit: "mg"}).errors.creatinine, /от 0,2 до 34 мг\/дл/, creatinine);
  }
  assert.deepEqual(egfr({age: "50", sex: "other", creatinine: "80"}).missing, ["sex"]);
});

const cockcroft = core.calculateCockcroftGault;

// Cockcroft & Gault, Nephron 1976: (140 − age) × weight / (72 × Scr mg/100 mL), 15% less in women.
test("Cockcroft–Gault matches hand-worked reference values", () => {
  const cases = [
    // (140 − 60) × 72 / (72 × 1.0) = 80
    [{age: "60", sex: "male", weight: "72", creatinine: "1.0", unit: "mg"}, 80, 80],
    [{age: "60", sex: "female", weight: "72", creatinine: "1.0", unit: "mg"}, 68, 68],
    [{age: "60", sex: "male", weight: "72", creatinine: "88,4"}, 80, 80],
    // 55 × 50 / (72 × 150 / 88.4) × 0.85 = 2750 / 122.1719 × 0.85
    [{age: "85", sex: "female", weight: "50", creatinine: "150"}, 19.133, 19],
    [{age: "40", sex: "male", weight: "72,5", creatinine: "2", unit: "mg"}, 50.347, 50]
  ];
  for (const [input, exact, value] of cases) {
    const {result, errors, missing} = cockcroft(input);
    assert.deepEqual([errors, missing], [{}, []], JSON.stringify(input));
    assert.ok(Math.abs(result.exact - exact) < 0.001, JSON.stringify(input) + " exact " + result.exact);
    assert.equal(result.value, value);
  }
});

test("Cockcroft–Gault checks weight and reuses the eGFR checks of age, sex and creatinine", () => {
  assert.deepEqual(cockcroft({}), {result: null, errors: {}, missing: ["age", "sex", "creatinine", "weight"]});
  for (const weight of ["19.9", "301", "abc", "0", "70 кг"]) {
    assert.equal(cockcroft({age: "50", sex: "male", weight, creatinine: "80"}).errors.weight, "Масса тела — число от 20 до 300 кг.", weight);
  }
  assert.match(cockcroft({age: "17", sex: "male", weight: "70", creatinine: "80"}).errors.age, /от 18 до 120/);
  assert.match(cockcroft({age: "50", sex: "male", weight: "70", creatinine: "5000"}).errors.creatinine, /от 20 до 3000/);
  assert.equal(cockcroft({age: "50", sex: "male", weight: "70", creatinine: "5000"}).result, null);
});

test("CHA2DS2-VASc and CHA2DS2-VA follow the published points and ESC 2024 thresholds", () => {
  const score = core.scoreChadsVasc;
  const r = input => score(input).result;
  assert.deepEqual(r({age: "50", sex: "male"}), {va: 0, vasc: 0, factors: [], female: false, recommendation: "none"});
  assert.deepEqual([r({age: "50", sex: "female"}).va, r({age: "50", sex: "female"}).vasc], [0, 1], "female sex counts only in VASc");
  assert.deepEqual([r({age: "64", sex: "male"}).va, r({age: "65", sex: "male"}).va, r({age: "74", sex: "male"}).va, r({age: "75", sex: "male"}).va], [0, 1, 1, 2]);
  assert.deepEqual(r({age: "75", sex: "male"}).factors, ["age75"], "age 75 and over is not also counted as 65–74");
  assert.equal(r({age: "65", sex: "male"}).recommendation, "consider");
  assert.equal(r({age: "40", sex: "male", stroke: true}).va, 2);
  assert.equal(r({age: "40", sex: "male", stroke: true}).recommendation, "recommended");
  const all = r({age: "80", sex: "female", chf: true, hypertension: true, diabetes: true, stroke: true, vascular: true});
  assert.deepEqual([all.va, all.vasc], [8, 9]);
  assert.deepEqual(all.factors, ["chf", "hypertension", "age75", "diabetes", "stroke", "vascular"]);
  assert.equal(r({age: "50", sex: "male", chf: "true", diabetes: 1}).va, 0, "only true ticks count");
  assert.deepEqual(score({}).missing, ["age", "sex"]);
  assert.equal(score({age: "17", sex: "male"}).errors.age, "Возраст — целое число лет от 18 до 120.");
  assert.equal(score({age: "17", sex: "male"}).result, null);
});

test("HAS-BLED, CRB-65 and Centor/McIsaac add one point per ticked item", () => {
  const hasBled = core.scoreHasBled;
  const allBled = {hypertension: true, renal: true, liver: true, stroke: true, bleeding: true, labileInr: true, elderly: true, drugs: true, alcohol: true};
  assert.deepEqual(hasBled(allBled).result, {score: 9, factors: Object.keys(allBled), high: true});
  assert.deepEqual(hasBled({}).result, {score: 0, factors: [], high: false});
  assert.equal(hasBled({hypertension: true, elderly: true}).result.high, false);
  assert.equal(hasBled({hypertension: true, elderly: true, drugs: true}).result.high, true, "3 points is high risk");
  assert.equal(hasBled({renal: "yes"}).result.score, 0);

  const crb = core.scoreCrb65;
  const risks = [{}, {age65: true}, {age65: true, confusion: true}, {age65: true, confusion: true, pressure: true},
    {age65: true, confusion: true, pressure: true, respiratory: true}].map(input => [crb(input).result.score, crb(input).result.risk]);
  assert.deepEqual(risks, [[0, "low"], [1, "intermediate"], [2, "intermediate"], [3, "high"], [4, "high"]]);
  assert.deepEqual(crb({respiratory: true, age65: true}).result.factors, ["respiratory", "age65"]);

  const centor = core.scoreCentor;
  const full = {exudate: true, nodes: true, fever: true, noCough: true};
  assert.deepEqual(centor({...full, ageGroup: "older"}).result, {centor: 4, mcIsaac: 3, ageGroup: "older", factors: ["exudate", "nodes", "fever", "noCough"], likely: true});
  assert.equal(centor({ageGroup: "child"}).result.mcIsaac, 1);
  assert.equal(centor({fever: true, ageGroup: "young"}).result.mcIsaac, 1);
  assert.equal(centor({ageGroup: "older"}).result.mcIsaac, -1);
  assert.deepEqual([centor({fever: true, nodes: true}).result.mcIsaac, centor({fever: true, nodes: true}).missing], [null, ["ageGroup"]]);
  assert.equal(centor({exudate: true, nodes: true}).result.likely, false);
  assert.equal(centor({exudate: true, nodes: true, noCough: true}).result.likely, true);
  assert.equal(centor({ageGroup: "toString"}).result.ageGroup, "", "unknown age groups are ignored");
});

test("FIB-4 matches hand-worked values and the age-specific thresholds", () => {
  const fib4 = core.calculateFib4;
  // 50 × 40 / (200 × √25) = 2000 / 1000 = 2.00
  assert.deepEqual(fib4({age: "50", ast: "40", alt: "25", platelets: "200"}).result, {value: 2, exact: 2, lower: 1.3, upper: 2.67, risk: "indeterminate", lowAccuracy: false});
  // 45 × 20 / (250 × √36) = 900 / 1500 = 0.60
  assert.equal(fib4({age: "45", ast: "20", alt: "36", platelets: "250"}).result.risk, "low");
  // 70 × 60 / (120 × √16) = 4200 / 480 = 8.75
  const high = fib4({age: "70", ast: "60", alt: "16", platelets: "120"}).result;
  assert.deepEqual([high.value, high.risk], [8.75, "high"]);
  // With ALT 1 and platelets 100 the index is age × AST / 100: ≤1.30 is low, ≥2.67 is high, from 65 the lower threshold is 2.0.
  const at = (age, ast) => fib4({age: String(age), ast: String(ast), alt: "1", platelets: "100"}).result;
  assert.deepEqual([at(50, 2.6).value, at(50, 2.6).risk], [1.3, "low"], "1.30 is still low");
  assert.equal(at(50, 2.62).risk, "indeterminate");
  assert.deepEqual([at(50, 5.34).value, at(50, 5.34).risk], [2.67, "high"], "2.67 is already high");
  assert.equal(at(65, 3.077).value, 2);
  assert.deepEqual([at(65, 3.077).risk, at(64, 3.125).risk], ["low", "indeterminate"], "2.0 is low only from age 65");
  assert.deepEqual([at(35, 1).lowAccuracy, at(36, 1).lowAccuracy], [true, false]);
  assert.equal(fib4({age: "50", ast: "40,5", alt: "25", platelets: "200"}).result.value, 2.03, "decimal comma");
  assert.deepEqual(fib4({}).missing, ["age", "ast", "alt", "platelets"]);
  assert.equal(fib4({age: "17", ast: "40", alt: "25", platelets: "200"}).errors.age, "Возраст — целое число лет от 18 до 120.");
  assert.equal(fib4({age: "50", ast: "0", alt: "25", platelets: "200"}).errors.ast, "АСТ — число от 1 до 10 000 Ед/л.");
  assert.equal(fib4({age: "50", ast: "40", alt: "abc", platelets: "200"}).errors.alt, "АЛТ — число от 1 до 10 000 Ед/л.");
  assert.equal(fib4({age: "50", ast: "40", alt: "25", platelets: "2001"}).errors.platelets, "Тромбоциты — число от 1 до 2000 × 10⁹/л.");
});

test("QTc by Bazett and Fridericia uses RR = 60 / heart rate and sex-specific limits", () => {
  const qtc = core.calculateQtc;
  // RR 0.8 s: 400 / √0.8 = 447.2; 400 / ∛0.8 = 430.9
  assert.deepEqual(qtc({qt: "400", rate: "75", sex: "male"}).result, {rr: 0.8, bazett: 447, fridericia: 431, limit: 470, bazettGrade: "normal", fridericiaGrade: "normal"});
  // At 60 per minute RR is 1 s and both formulas return QT unchanged.
  const r60 = qtc({qt: "471", rate: "60", sex: "male"}).result;
  assert.deepEqual([r60.bazett, r60.fridericia, r60.bazettGrade], [471, 471, "prolonged"]);
  assert.equal(qtc({qt: "470", rate: "60", sex: "male"}).result.bazettGrade, "normal", "470 ms is the male upper limit");
  assert.equal(qtc({qt: "480", rate: "60", sex: "female"}).result.bazettGrade, "normal", "480 ms is the female upper limit");
  assert.equal(qtc({qt: "481", rate: "60", sex: "female"}).result.bazettGrade, "prolonged");
  assert.equal(qtc({qt: "500", rate: "60", sex: "female"}).result.bazettGrade, "prolonged");
  assert.equal(qtc({qt: "501", rate: "60", sex: "female"}).result.bazettGrade, "dangerous");
  // RR 0.5 s: 400 / √0.5 = 565.7; 400 / ∛0.5 = 504.0 — Bazett corrects more at a fast rate.
  const fast = qtc({qt: "400", rate: "120", sex: "male"}).result;
  assert.deepEqual([fast.bazett, fast.fridericia, fast.bazettGrade, fast.fridericiaGrade], [566, 504, "dangerous", "dangerous"]);
  assert.deepEqual(qtc({}).missing, ["qt", "rate", "sex"]);
  assert.equal(qtc({qt: "199", rate: "60", sex: "male"}).errors.qt, "QT — целое число от 200 до 800 мс.");
  assert.equal(qtc({qt: "400", rate: "75.5", sex: "male"}).errors.rate, "ЧСС — целое число от 30 до 250 в минуту.");
});

test("FINDRISC sums the published form points into the five 10-year risk bands", () => {
  const findrisc = core.scoreFindrisc;
  const lowest = {age: "lt45", bmi: "lt25", waist: "low", activity: "yes", vegetables: "daily", bpDrugs: "no", glucose: "no", family: "no"};
  const highest = {age: "gt64", bmi: "gt30", waist: "high", activity: "no", vegetables: "notDaily", bpDrugs: "yes", glucose: "yes", family: "first"};
  assert.deepEqual(findrisc(lowest).result, {score: 0, risk: "low", oneIn: 100});
  assert.deepEqual(findrisc(highest).result, {score: 26, risk: "veryHigh", oneIn: 2}, "4+3+4+2+1+2+5+5");
  const band = changes => findrisc({...lowest, ...changes}).result;
  assert.deepEqual([band({age: "45-54"}).score, band({age: "55-64"}).score, band({bmi: "25-30"}).score, band({waist: "middle"}).score, band({family: "second"}).score], [2, 3, 1, 3, 3]);
  const cases = [[6, {age: "55-64", waist: "middle"}, "low"], [7, {age: "gt64", waist: "middle"}, "slight"], [11, {age: "gt64", waist: "middle", bpDrugs: "yes", activity: "no"}, "slight"],
    [12, {age: "gt64", waist: "middle", glucose: "yes"}, "moderate"], [14, {age: "gt64", waist: "high", glucose: "yes", vegetables: "notDaily"}, "moderate"],
    [15, {age: "gt64", waist: "high", glucose: "yes", activity: "no"}, "high"], [20, {age: "gt64", waist: "high", glucose: "yes", family: "first", activity: "no"}, "high"],
    [21, {age: "gt64", waist: "high", glucose: "yes", family: "first", activity: "no", vegetables: "notDaily"}, "veryHigh"]];
  for (const [score, changes, risk] of cases) assert.deepEqual([band(changes).score, band(changes).risk], [score, risk], String(score));
  assert.deepEqual(findrisc({}).missing, ["age", "bmi", "waist", "activity", "vegetables", "bpDrugs", "glucose", "family"]);
  assert.deepEqual(findrisc({...lowest, family: "toString"}).missing, ["family"]);
});

test("PHQ-9 and GAD-7 add 0-3 per answer and use the manual's severity cut points", () => {
  const answers = (count, value) => Object.fromEntries(Array.from({length: count}, (_, index) => ["q" + (index + 1), String(value)]));
  // Spreads a total over the items one point at a time.
  const spread = (count, total) => { const values = answers(count, 0); for (let index = 0; index < total; index++) values["q" + (index % count + 1)] = String(Math.floor(index / count) + 1); return values; };
  const phq = values => core.scorePhq9(values).result;
  assert.deepEqual(phq(answers(9, 0)), {score: 0, severity: "minimal", item9: 0});
  assert.deepEqual(phq(answers(9, 3)), {score: 27, severity: "severe", item9: 3});
  assert.deepEqual([4, 5, 9, 10, 14, 15, 19, 20].map(total => { const result = phq(spread(9, total)); assert.equal(result.score, total); return result.severity; }),
    ["minimal", "mild", "mild", "moderate", "moderate", "moderatelySevere", "moderatelySevere", "severe"]);
  assert.equal(phq({...answers(9, 0), q9: "1"}).item9, 1);
  assert.deepEqual(core.scorePhq9({...answers(9, 1), q4: "4"}).missing, ["q4"]);
  assert.deepEqual(core.scorePhq9({...answers(9, 1), q2: 2}).missing, ["q2"], "answers are the radio values");
  const gad = values => core.scoreGad7(values).result;
  assert.deepEqual(gad(answers(7, 3)), {score: 21, severity: "severe", item9: null});
  assert.deepEqual([4, 5, 9, 10, 14, 15].map(total => { const result = gad(spread(7, total)); assert.equal(result.score, total); return result.severity; }),
    ["minimal", "mild", "mild", "moderate", "moderate", "severe"]);
  assert.deepEqual(core.scoreGad7({}).missing, ["q1", "q2", "q3", "q4", "q5", "q6", "q7"]);
});

test("SCORE2 reproduces the published very high-risk example and the ESC 2021 age-specific categories", () => {
  const score2 = core.calculateScore2;
  const base = {age: "50", sex: "male", smoking: "yes", sbp: "140", tchol: "5.5", hdl: "1.3"};
  // SCORE2 abstract: 50-year-old smoker, SBP 140, total cholesterol 5.5, HDL 1.3 — 14.0% for men and 13.7% for women in very high-risk countries.
  assert.equal(score2(base).result.percent, 14);
  assert.ok(Math.abs(score2(base).result.exact - 14.0486) < 0.001);
  assert.equal(score2({...base, sex: "female"}).result.percent, 13.7);
  assert.equal(score2({...base, tchol: "5,5", hdl: "1,3"}).result.percent, 14, "decimal comma");
  // At the centring values (age 60, SBP 120, cholesterol 6, HDL 1.3, non-smoker) the linear predictor is 0:
  // 1 − 0.9605 = 0.0395 → 1 − exp(−exp(0.5836 + 0.8294 × ln(−ln 0.9605))) = 11.745%.
  assert.ok(Math.abs(score2({age: "60", sex: "male", smoking: "no", sbp: "120", tchol: "6", hdl: "1.3"}).result.exact - 11.7451) < 0.001);
  assert.deepEqual(score2(base).result.limits, [5, 10]);
  assert.equal(score2(base).result.category, "veryHigh");
  assert.deepEqual(score2({...base, age: "49"}).result.limits, [2.5, 7.5], "under 50 the thresholds are 2.5 and 7.5%");
  const category = changes => score2({...base, ...changes}).result;
  const low = category({age: "45", smoking: "no", sbp: "110", tchol: "4.5", hdl: "1.6", sex: "female"});
  assert.deepEqual([low.percent, low.category], [1.9, "lowModerate"]);
  const mid = category({age: "55", smoking: "no", sbp: "120", tchol: "5", hdl: "1.4", sex: "female"});
  assert.deepEqual([mid.percent, mid.category], [6.2, "high"]);
  assert.deepEqual(score2({}).missing, ["age", "sex", "smoking", "sbp", "tchol", "hdl"]);
  for (const age of ["39", "101", "55.5"]) assert.equal(score2({...base, age}).errors.age, "Возраст — целое число лет от 40 до 100: SCORE2 для 40–69 лет, SCORE2-OP для 70 лет и старше.", age);
  assert.equal(score2({...base, sbp: "301"}).errors.sbp, "САД — целое число от 60 до 300 мм рт. ст.");
  assert.equal(score2({...base, tchol: "0.5"}).errors.tchol, "Общий холестерин — число от 1 до 20 ммоль/л.");
  assert.equal(score2({...base, hdl: "6"}).errors.hdl, "Холестерин ЛПВП — число от 0,2 до 5 ммоль/л.");
  assert.equal(score2({...base, smoking: "sometimes"}).missing[0], "smoking");
});

test("SCORE2-OP reproduces the supplement's worked example and uses the very high-risk rescaling factors from age 70", () => {
  const score2 = core.calculateScore2;
  const example = {age: "75", sex: "female", smoking: "yes", sbp: "140", tchol: "5.5", hdl: "1.3"};
  // Supplementary methods table 2: linear predictor 0.5029 (women) and 0.3298 (men); unrecalibrated 10-year risk 24.4% and 29.7%.
  const woman = score2(example).result, man = score2({...example, sex: "male"}).result;
  assert.deepEqual([woman.model, man.model], ["SCORE2-OP", "SCORE2-OP"]);
  assert.ok(Math.abs(woman.uncalibrated - 24.42) < 0.01, String(woman.uncalibrated));
  assert.ok(Math.abs(man.uncalibrated - 29.66) < 0.01, String(man.uncalibrated));
  // Very high-risk region (supplementary methods table 1): women 0.38 / 0.69, men 0.05 / 0.70.
  // Women: 1 − exp(−exp(0.38 + 0.69 × ln(−ln(1 − 0.24424)))) = 45.53%; men: 1 − exp(−exp(0.05 + 0.70 × ln(−ln(1 − 0.29659)))) = 39.71%.
  assert.deepEqual([woman.percent, man.percent], [45.5, 39.7]);
  assert.deepEqual([woman.limits, woman.category], [[7.5, 15], "veryHigh"]);
  assert.equal(score2({...example, age: "69"}).result.model, "SCORE2");
  assert.equal(score2({...example, age: "70"}).result.model, "SCORE2-OP");
  assert.equal(score2({...example, age: "100"}).result.model, "SCORE2-OP");
  const low = score2({age: "72", sex: "female", smoking: "no", sbp: "125", tchol: "5", hdl: "1.8"}).result;
  assert.deepEqual([low.percent, low.category], [25.7, "veryHigh"]);
});

test("calculator prefill takes the latest report value and reports conflicts, non-numbers and unknown units", () => {
  const row = (fieldId, result, unit, date, panelId = "biochemistry") => ({id: fieldId + date + result, kind: "lab", panelId, fieldId, result, unit, date, reportTitle: "Биохимический анализ крови"});
  const rows = [row("creatinine", "98", "мкмоль/л", "2032-03-01"), row("creatinine", "1,1", "мг/дл", "2032-04-18"), row("platelets", "250", "10⁹/л", "2032-04-18", "cbc"),
    row("hdl", "1,2", "ммоль/л", "2032-04-18"), row("hdl", "1,4", "ммоль/л", "2032-04-18"), row("alt", "<5", "Ед/л", "2032-04-18"), row("ast", "30", "мккат/л", "2032-04-18"),
    {kind: "lab", name: "Креатинин", result: "70", unit: "мкмоль/л", date: "2032-05-01"}];
  assert.deepEqual(core.findLatestLabResult(rows, "biochemistry", "creatinine", ["umol", "mg"]), {date: "2032-04-18", reportTitle: "Биохимический анализ крови", value: "1,1", unit: "mg"}, "the latest report wins; free-text results are ignored");
  assert.equal(core.findLatestLabResult(rows, "cbc", "platelets", ["perNanolitre"]).unit, "perNanolitre");
  for (const unit of ["× 10^9/л", "10*9/л", "тыс/мкл", "10³/мкл"]) assert.equal(core.findLatestLabResult([row("platelets", "250", unit, "2032-04-18", "cbc")], "cbc", "platelets", ["perNanolitre"]).unit, "perNanolitre", unit);
  assert.equal(core.findLatestLabResult(rows, "biochemistry", "hdl", ["mmol"]).problem, "conflict");
  assert.deepEqual(core.findLatestLabResult(rows, "biochemistry", "alt", ["unitsPerLitre"]), {date: "2032-04-18", reportTitle: "Биохимический анализ крови", problem: "notNumber", result: "<5"});
  assert.deepEqual(core.findLatestLabResult(rows, "biochemistry", "ast", ["unitsPerLitre"]), {date: "2032-04-18", reportTitle: "Биохимический анализ крови", problem: "unit", unitText: "мккат/л"});
  assert.equal(core.findLatestLabResult(rows, "biochemistry", "creatinine", ["umol"]).problem, "unit", "milligrams are refused where only micromoles fit");
  assert.equal(core.findLatestLabResult(rows, "biochemistry", "cholesterol-total", ["mmol"]), null);
  assert.equal(core.findLatestLabResult(undefined, "biochemistry", "hdl", ["mmol"]), null);
});
