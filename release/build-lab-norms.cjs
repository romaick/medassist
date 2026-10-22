"use strict";
const fs = require("node:fs");
const path = require("node:path");
const start = "/* Generated laboratory reference ranges. Rebuild with node release/build-lab-norms.cjs. */";
const end = "/* End laboratory reference ranges. */";
const hosts = {invitro: "https://www.invitro.by/", lode: "https://www.lode.by/", helix: "https://helix.ru/"};
const kinds = ["порог диагноза", "цель лечения", "референсный предел", "классификация"];

function build({
  normsPath = path.resolve(__dirname, "../medassist/research/lab-reference-ranges.json"),
  catalogPath = path.resolve(__dirname, "../medassist/research/investigation-catalog.json"),
  modulePath = path.resolve(__dirname, "../medassist/app/modules.js")
} = {}) {
  const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const norms = read(normsPath), catalog = read(catalogPath);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(norms.checkedAt || "") || !Array.isArray(norms.labs) || !Array.isArray(norms.panels) || !norms.panels.length) throw new Error("Missing reference ranges.");
  const labIds = norms.labs.map(lab => lab.id);
  if (labIds.join() !== Object.keys(hosts).join() || norms.labs.some(lab => !lab.title || !lab.country || lab.site !== hosts[lab.id])) throw new Error("Invalid laboratories.");
  const panelIds = new Set();
  let rows = 0;
  for (const panel of norms.panels) {
    const source = catalog.panels.find(item => item.id === panel.panelId && item.kind === "lab");
    if (!source || panelIds.has(panel.panelId) || !Array.isArray(panel.rows)) throw new Error("Unknown or repeated panel: " + panel.panelId);
    panelIds.add(panel.panelId);
    const fieldIds = panel.rows.map(row => row.fieldId);
    if (fieldIds.join() !== source.fields.map(field => field.id).join()) throw new Error("Rows must follow the catalog fields of " + panel.panelId);
    for (const row of panel.rows) {
      for (const id of labIds) {
        const value = row[id];
        if (value === null) continue;
        if (!value || typeof value.value !== "string" || !value.value.trim() || value.value.length > 300 || typeof value.unit !== "string" || value.unit.length > 40 || !value.url?.startsWith(hosts[id]))
          throw new Error("Invalid " + id + " value: " + panel.panelId + "/" + row.fieldId);
      }
      if (row.helix && row.lode) throw new Error("Helix is shown only where LODE publishes nothing: " + row.fieldId);
      for (const item of row.international || []) {
        if (!item || !item.org || !Number.isInteger(item.year) || item.year < 1990 || item.year > 2100 || !kinds.includes(item.kind) || typeof item.text !== "string" || !item.text.trim() || item.text.length > 300 ||
          typeof item.title !== "string" || !item.title.trim() || !/^https:\/\//.test(item.url || "") || item.verified !== true)
          throw new Error("Invalid international guidance: " + panel.panelId + "/" + row.fieldId);
      }
      if (typeof row.differs !== "boolean" || typeof row.note !== "string" || row.note.length > 400) throw new Error("Invalid row: " + row.fieldId);
      rows += 1;
    }
  }
  let module = fs.readFileSync(modulePath, "utf8");
  const first = module.indexOf(start), last = module.indexOf(end);
  if ((first < 0) !== (last < 0) || (first >= 0 && last < first)) throw new Error("Broken reference range markers.");
  const block = start + "\nwindow.MedAssistLabNorms = Object.freeze(" + JSON.stringify(norms).replace(/</g, "\\u003c") + ");\n" + end + "\n\n";
  const anchor = "window.MedAssistModules = Object.freeze([";
  if (first < 0 && module.split(anchor).length !== 2) throw new Error("Modules registry not found.");
  module = first < 0 ? module.replace(anchor, block + anchor) : module.slice(0, first) + block + module.slice(last + end.length).replace(/^\s*\n/, "");
  fs.writeFileSync(modulePath, module);
  return {panels: norms.panels.length, rows, checkedAt: norms.checkedAt};
}
module.exports = build;
if (require.main === module) console.log(JSON.stringify(build()));
