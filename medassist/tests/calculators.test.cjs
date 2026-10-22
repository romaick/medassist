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
