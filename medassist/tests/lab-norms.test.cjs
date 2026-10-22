"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const norms = require("../research/lab-reference-ranges.json");
const catalog = require("../research/investigation-catalog.json");
const build = require("../../release/build-lab-norms.cjs");
const start = "/* Generated laboratory reference ranges. Rebuild with node release/build-lab-norms.cjs. */";
const end = "/* End laboratory reference ranges. */";
const modulePath = path.join(__dirname, "../app/modules.js");
const hosts = {invitro: "https://www.invitro.by/", lode: "https://www.lode.by/", helix: "https://helix.ru/"};

test("reference ranges cover every lab form field in catalog order and trace each value to its laboratory page", () => {
  assert.match(norms.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(norms.labs.map(lab => [lab.id, lab.site]), Object.entries(hosts));
  const labPanels = catalog.panels.filter(panel => panel.kind === "lab");
  assert.deepEqual(norms.panels.map(panel => panel.panelId).sort(), labPanels.map(panel => panel.id).sort(), "every existing lab form has a reference table");
  for (const panel of norms.panels) {
    const source = labPanels.find(item => item.id === panel.panelId);
    assert.deepEqual(panel.rows.map(row => row.fieldId), source.fields.map(field => field.id), panel.panelId + " follows the form");
    for (const row of panel.rows) {
      for (const [id, host] of Object.entries(hosts)) {
        if (row[id] === null) continue;
        assert.ok(row[id].value.trim(), row.fieldId + " " + id + " has a value");
        assert.ok(row[id].url.startsWith(host), row.fieldId + " " + id + " links to its laboratory");
      }
      assert.ok(!(row.helix && row.lode), "Helix appears only where LODE publishes nothing: " + row.fieldId);
      assert.equal(typeof row.differs, "boolean");
    }
  }
  const value = (panelId, fieldId) => norms.panels.find(panel => panel.panelId === panelId).rows.find(row => row.fieldId === fieldId);
  assert.match(value("biochemistry", "creatinine").lode.value, /44–80.*62–106/, "values copied from the LODE page");
  assert.match(value("thyroid", "tsh").helix.value, /0,27–4,2/);
  assert.equal(value("coagulation", "inr").invitro, null, "INVITRO publishes only therapy targets for INR");
});

test("modules.js carries exactly the built reference ranges and the build is repeatable and strict", () => {
  const source = fs.readFileSync(modulePath, "utf8");
  const block = source.slice(source.indexOf(start), source.indexOf(end));
  const json = block.slice(block.indexOf("Object.freeze(") + 14, block.lastIndexOf(");"));
  assert.deepEqual(JSON.parse(json), norms);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "medassist-norms-"));
  try {
    const copy = path.join(dir, "modules.js");
    fs.writeFileSync(copy, source);
    build({modulePath: copy});
    assert.equal(fs.readFileSync(copy, "utf8"), source, "rebuilding changes nothing");
    const broken = structuredClone(norms);
    const row = broken.panels.find(panel => panel.panelId === "coagulation").rows[0];
    row.lode = {value: "1–2", unit: "", url: "https://www.lode.by/x/"};
    const brokenPath = path.join(dir, "norms.json");
    fs.writeFileSync(brokenPath, JSON.stringify(broken));
    assert.throws(() => build({normsPath: brokenPath, modulePath: copy}), /Helix is shown only/);
    row.lode = null; row.helix.url = "https://example.com/";
    fs.writeFileSync(brokenPath, JSON.stringify(broken));
    assert.throws(() => build({normsPath: brokenPath, modulePath: copy}), /Invalid helix value/);
    broken.panels.find(panel => panel.panelId === "coagulation").rows.reverse();
    fs.writeFileSync(brokenPath, JSON.stringify(broken));
    assert.throws(() => build({normsPath: brokenPath, modulePath: copy}), /follow the catalog fields/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
