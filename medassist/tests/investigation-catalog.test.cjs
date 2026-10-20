"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const catalog = require("../research/investigation-catalog.json");
const build = require("../../release/build-investigations.cjs");
const start = "/* Generated investigation input catalog. Rebuild with node release/build-investigations.cjs. */";
const end = "/* End investigation input catalog. */";

test("input catalog traces each panel and indicator to checked primary sources and supplies no results or norms", () => {
  const sources = new Map(catalog.sources.map(source => [source.id, source]));
  assert.equal(sources.size, catalog.sources.length);
  assert.ok(catalog.panels.length >= 4);
  const ids = new Set();
  for (const panel of catalog.panels) {
    assert.ok(!ids.has(panel.id)); ids.add(panel.id);
    assert.ok(["lab", "study"].includes(panel.kind));
    assert.ok(panel.fields.length > 0 && panel.fields.length <= 100);
    assert.equal(new Set(panel.fields.map(field => field.id)).size, panel.fields.length);
    for (const item of [panel, ...panel.fields]) {
      assert.ok(item.sourceIds.length > 0);
      for (const id of item.sourceIds) {
        assert.ok(sources.has(id), "known primary source " + id);
        assert.match(sources.get(id).url, /^https:\/\//);
      }
      for (const prohibited of ["result", "reference", "normal", "diagnosis", "recommendation"]) assert.equal(Object.hasOwn(item, prohibited), false);
    }
    for (const field of panel.fields) {
      assert.equal(typeof field.name, "string"); assert.equal(typeof field.unit, "string");
      assert.ok(field.name.trim()); assert.ok(field.name.length <= 200 && field.unit.length <= 80);
    }
  }
});

test("CBC basic indicators keep their documented units and common reports have separate indicator names", () => {
  const cbc = catalog.panels.find(panel => panel.id === "cbc");
  assert.ok(cbc);
  assert.equal(cbc.fields.find(field => field.id === "hemoglobin").unit, "г/л");
  assert.match(cbc.fields.find(field => field.id === "erythrocytes").unit, /10.*12|10¹²/);
  assert.match(cbc.fields.find(field => field.id === "leukocytes").unit, /10.*9|10⁹/);
  assert.ok(catalog.panels.some(panel => panel.id === "urinalysis"));
  assert.ok(catalog.panels.some(panel => panel.id === "biochemistry"));
  assert.ok(catalog.panels.some(panel => panel.kind === "study"));
  const normalized = name => name.trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
  const urineNames = new Set(catalog.panels.find(panel => panel.id === "urinalysis").fields.map(field => normalized(field.name)));
  for (const panel of catalog.panels.filter(panel => panel.kind === "lab" && panel.id !== "urinalysis")) {
    for (const field of panel.fields) assert.ok(!urineNames.has(normalized(field.name)), "blood and urine indicators are distinguishable: " + field.name);
  }
});

test("offline catalog matches reviewed JSON and building it twice preserves unrelated module content", t => {
  const source = fs.readFileSync(path.resolve(__dirname, "../app/modules.js"), "utf8");
  assert.equal(source.split(start).length, 2); assert.equal(source.split(end).length, 2);
  const context = {window: {}};
  vm.runInNewContext(source.slice(source.indexOf(start) + start.length, source.indexOf(end)), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.MedAssistInvestigationCatalog)), catalog);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "medassist-catalog-test-"));
  const modulePath = path.join(folder, "modules.js");
  t.after(() => { fs.unlinkSync(modulePath); fs.rmdirSync(folder); });
  fs.writeFileSync(modulePath, "window.demoCatalogSentinel = 'ДЕМО';\n");
  build({modulePath}); const once = fs.readFileSync(modulePath, "utf8");
  build({modulePath}); const twice = fs.readFileSync(modulePath, "utf8");
  assert.equal(twice, once);
  assert.ok(twice.endsWith("window.demoCatalogSentinel = 'ДЕМО';\n"));
});
