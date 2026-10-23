"use strict";
const fs = require("node:fs");
const path = require("node:path");
const start = "/* Generated laboratory reference registry. Rebuild with node release/build-lab-registry.cjs. */";
const end = "/* End laboratory reference registry. */";
const groups = ["referenceIntervals", "researchExamples", "clinicalLimits"];

// Embeds the research registry of reference candidates as shown in «Нормы анализов». Approval flags stay false: the registry is shown, never applied to patient results.
function build({
  registryPath = path.resolve(__dirname, "../medassist/research/lab-reference-registry.json"),
  displayPath = path.resolve(__dirname, "../medassist/research/lab-reference-display.json"),
  catalogPath = path.resolve(__dirname, "../medassist/research/investigation-catalog.json"),
  modulePath = path.resolve(__dirname, "../medassist/app/modules.js")
} = {}) {
  const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const registry = read(registryPath), display = read(displayPath), catalog = read(catalogPath);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(registry.checkedAt || "") || !Array.isArray(registry.rows) || !Array.isArray(registry.sources)) throw new Error("Missing registry.");
  if (registry.approvedForImport !== false) throw new Error("The registry must stay unapproved for import.");
  const sources = new Map();
  for (const source of registry.sources) {
    if (!source.id || sources.has(source.id) || !source.title || !/^https:\/\//.test(source.url || "")) throw new Error("Invalid source: " + source.id);
    sources.set(source.id, source);
  }
  const fields = catalog.panels.filter(panel => panel.kind === "lab").flatMap(panel => panel.fields.map(field => panel.id + "/" + field.id));
  const keys = registry.rows.map(row => row.key);
  if (new Set(keys).size !== keys.length || keys.slice().sort().join() !== fields.slice().sort().join()) throw new Error("Registry rows must match the lab form fields one to one.");
  const unconfirmed = registry.supplement?.unconfirmedBelarusUnits || [];
  const rows = registry.rows.map(row => {
    if (row.key !== row.panelId + "/" + row.fieldId || row.approvedForClinicalUse !== false || !row.name || !row.displayUnit || !row.unitAudit) throw new Error("Invalid row: " + row.key);
    if (Boolean(row.unitAudit.belarusPublicationConfirmed) === unconfirmed.includes(row.key)) throw new Error("Unit confirmation mismatch: " + row.key);
    const label = display.rows?.[row.key];
    if (!label?.shortName || !label.abbreviation) throw new Error("Missing display label: " + row.key);
    for (const group of groups) {
      if (!Array.isArray(row[group])) throw new Error("Missing " + group + ": " + row.key);
      for (const item of row[group]) {
        if (!item.value?.trim() || !item.kind || !sources.has(item.source) || item.transferValidated === true) throw new Error("Invalid " + group + " entry: " + row.key);
      }
    }
    if (!row.referenceIntervals.length && !row.researchExamples.length) throw new Error("No candidate to show: " + row.key);
    if (row.sources.some(id => !sources.has(id))) throw new Error("Unknown source in " + row.key);
    return {...row, shortName: label.shortName, abbreviation: label.abbreviation};
  });
  const used = new Set(rows.flatMap(row => [...row.sources, ...groups.flatMap(group => row[group].map(item => item.source))]));
  const data = {checkedAt: registry.checkedAt, revision: registry.revision, approvedForImport: false, limitations: registry.limitations, unconfirmedBelarusUnits: unconfirmed, rows, sources: registry.sources.filter(source => used.has(source.id))};
  let module = fs.readFileSync(modulePath, "utf8");
  const first = module.indexOf(start), last = module.indexOf(end);
  if ((first < 0) !== (last < 0) || (first >= 0 && last < first)) throw new Error("Broken registry markers.");
  const block = start + "\nwindow.MedAssistLabRegistry = Object.freeze(" + JSON.stringify(data).replace(/</g, "\\u003c") + ");\n" + end + "\n\n";
  const anchor = "window.MedAssistModules = Object.freeze([";
  if (first < 0 && module.split(anchor).length !== 2) throw new Error("Modules registry not found.");
  module = first < 0 ? module.replace(anchor, block + anchor) : module.slice(0, first) + block + module.slice(last + end.length).replace(/^\s*\n/, "");
  fs.writeFileSync(modulePath, module);
  return {rows: rows.length, sources: data.sources.length, checkedAt: data.checkedAt, revision: data.revision};
}
module.exports = build;
if (require.main === module) console.log(JSON.stringify(build()));
