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

test("the 0.33.0 international guidance is an archive: every claim is dated, typed, linked and carries the audit decision of 23.10.2026", () => {
  const items = norms.panels.flatMap(panel => panel.rows.flatMap(row => (row.international || []).map((item, index) => ({panelId: panel.panelId, fieldId: row.fieldId, index, ...item}))));
  assert.equal(items.length, 59, "the audited 0.33.0 claims are all kept in the archive");
  const decisions = {};
  for (const item of items) {
    assert.equal(item.id, item.panelId + "/" + item.fieldId + "#" + (item.index + 1));
    assert.ok(item.url.startsWith("https://") && item.title.trim() && item.text.length <= 300, item.id);
    assert.ok(["порог диагноза", "цель лечения", "референсный предел", "классификация"].includes(item.kind));
    assert.equal(item.audit.reviewedAt, "2026-10-23", item.id);
    assert.equal(item.verified, ["kept", "corrected"].includes(item.audit.decision), item.id + " the old verified flag is not carried over blindly");
    decisions[item.audit.decision] = (decisions[item.audit.decision] || 0) + 1;
  }
  assert.deepEqual(decisions, {kept: 10, corrected: 42, replaced: 4, retired: 3});
  const decision = id => items.find(item => item.id === id).audit.decision;
  assert.equal(decision("coagulation/inr#3"), "replaced", "ESC/EACTS 2021 valve matrix is superseded");
  assert.equal(decision("thyroid/tsh#4"), "replaced", "ETA 2014 pregnancy TSH limits are superseded by ATA 2026");
  for (const id of ["urinalysis/protein#3", "biochemistry/vitamin-d-25oh#2", "thyroid/ft4#1"]) assert.equal(decision(id), "retired", id);
  assert.ok(items.filter(item => item.fieldId === "inr").every(item => item.kind === "цель лечения" && item.text.includes("не норма")), "INR targets are never a normal range");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "medassist-norms-"));
  try {
    const copy = path.join(dir, "modules.js"), brokenPath = path.join(dir, "norms.json");
    fs.writeFileSync(copy, fs.readFileSync(modulePath, "utf8"));
    const good = structuredClone(norms.panels[0].rows[0].international[0]);
    for (const [change, error] of [[{url: "http://example.com/"}, /Invalid international guidance/], [{kind: "мнение"}, /Invalid international guidance/], [{year: 26}, /Invalid international guidance/], [{title: ""}, /Invalid international guidance/],
      [{text: "x".repeat(301)}, /Invalid international guidance/], [{verified: "да"}, /Invalid international guidance/], [{audit: undefined}, /Missing audit decision/], [{id: "cbc/hemoglobin#9"}, /Missing audit decision/],
      [{audit: {...good.audit, decision: "approved"}}, /Missing audit decision/], [{audit: {...good.audit, shownIn: []}}, /Missing audit decision/], [{verified: false}, /Missing audit decision/]]) {
      const broken = structuredClone(norms);
      broken.panels[0].rows[0].international[0] = {...good, ...change};
      fs.writeFileSync(brokenPath, JSON.stringify(broken));
      assert.throws(() => build({normsPath: brokenPath, modulePath: copy}), error, JSON.stringify(change));
    }
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
