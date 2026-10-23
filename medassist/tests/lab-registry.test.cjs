"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const registry = require("../research/lab-reference-registry.json");
const display = require("../research/lab-reference-display.json");
const catalog = require("../research/investigation-catalog.json");
const build = require("../../release/build-lab-registry.cjs");
const start = "/* Generated laboratory reference registry. Rebuild with node release/build-lab-registry.cjs. */";
const end = "/* End laboratory reference registry. */";
const modulePath = path.join(__dirname, "../app/modules.js");
const groups = ["referenceIntervals", "researchExamples", "clinicalLimits"];
const row = key => registry.rows.find(item => item.key === key);
const values = (key, group) => row(key)[group].map(item => item.value + " | " + item.source);

test("the research registry covers every lab form field once and stays unapproved for clinical use", () => {
  const fields = catalog.panels.filter(panel => panel.kind === "lab").flatMap(panel => panel.fields.map(field => panel.id + "/" + field.id));
  assert.equal(fields.length, 86);
  assert.deepEqual(registry.rows.map(item => item.key).sort(), fields.slice().sort());
  assert.deepEqual(Object.keys(display.rows).sort(), fields.slice().sort(), "every row has a short name and a designation");
  assert.equal(registry.approvedForImport, false);
  const sources = new Map(registry.sources.map(source => [source.id, source]));
  for (const item of registry.rows) {
    assert.equal(item.approvedForClinicalUse, false, item.key);
    assert.ok(item.referenceIntervals.length || item.researchExamples.length, item.key + " has something to show");
    for (const group of groups) for (const entry of item[group]) {
      assert.notEqual(entry.transferValidated, true, item.key);
      assert.ok(sources.get(entry.source)?.url.startsWith("https://"), item.key + " " + entry.source);
    }
  }
  assert.equal(registry.supplement.unconfirmedBelarusUnits.length, 12);
  assert.deepEqual(registry.rows.filter(item => !item.unitAudit.belarusPublicationConfirmed).map(item => item.key).sort(), registry.supplement.unconfirmedBelarusUnits.slice().sort());
});

test("registry keeps reference intervals, research examples and clinical limits apart and leaves excluded numbers out", () => {
  assert.deepEqual(values("coagulation/inr", "referenceIntervals"), ["0,8–1,2 | RU-HELIX-INR"]);
  assert.match(row("coagulation/inr").clinicalLimits[0].value, /^2,0–3,0 при ФП/, "INR treatment target is a clinical limit, not a reference");
  assert.match(row("cbc/segmented").referenceIntervals[0].scope, /Именно сегментоядерные, не все нейтрофилы/);
  assert.match(row("biochemistry/ldl").referenceIntervals[0].kind, /Желательный уровень лаборатории; не референсный интервал/);
  assert.ok(!groups.some(group => row("biochemistry/ggt")[group].some(entry => entry.source.startsWith("BY-INV"))), "contradictory INVITRO GGT numbers stay excluded");
  assert.ok(!row("thyroid/ft3").referenceIntervals.some(entry => entry.source.startsWith("BY-BIO")), "contradictory Biomedica FT3 stays excluded");
  assert.ok(row("coagulation/fibrinogen").notes.some(note => /0,01/.test(note)), "fibrinogen conversion note is kept");
  assert.ok(row("cbc/hemoglobin").researchExamples.every(entry => /не международная рекомендация/.test(entry.kind)), "CBC study values are not called recommendations");
});

test("modules.js carries the registry with display labels; the build is repeatable and refuses approval or untraced values", () => {
  const source = fs.readFileSync(modulePath, "utf8");
  const block = source.slice(source.indexOf(start), source.indexOf(end));
  const shipped = JSON.parse(block.slice(block.indexOf("Object.freeze(") + 14, block.lastIndexOf(");")));
  assert.equal(shipped.approvedForImport, false);
  assert.deepEqual(shipped.rows.map(item => item.key), registry.rows.map(item => item.key), "registry order is kept");
  for (const item of shipped.rows) {
    const original = row(item.key);
    for (const group of [...groups, "notes", "sources", "unitAudit", "unitStatus", "displayUnit", "name", "readiness"]) assert.deepEqual(item[group], original[group], item.key + " " + group);
    assert.deepEqual([item.shortName, item.abbreviation], [display.rows[item.key].shortName, display.rows[item.key].abbreviation]);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "medassist-registry-"));
  try {
    const copy = path.join(dir, "modules.js"), brokenPath = path.join(dir, "registry.json");
    fs.writeFileSync(copy, source);
    build({modulePath: copy});
    assert.equal(fs.readFileSync(copy, "utf8"), source, "rebuilding changes nothing");
    const cases = [
      [data => { data.approvedForImport = true; }, /unapproved for import/],
      [data => { data.rows[0].approvedForClinicalUse = true; }, /Invalid row/],
      [data => { data.rows[0].researchExamples[0].transferValidated = true; }, /Invalid researchExamples entry/],
      [data => { data.rows[0].clinicalLimits[0].source = "NOWHERE"; }, /Invalid clinicalLimits entry/],
      [data => { data.rows.pop(); }, /one to one/],
      [data => { data.sources[0].url = "http://example.com/"; }, /Invalid source/]
    ];
    for (const [change, error] of cases) {
      const broken = structuredClone(registry);
      change(broken);
      fs.writeFileSync(brokenPath, JSON.stringify(broken));
      assert.throws(() => build({registryPath: brokenPath, modulePath: copy}), error);
    }
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
