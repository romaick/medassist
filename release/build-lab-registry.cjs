"use strict";
const fs = require("node:fs");
const path = require("node:path");
const start = "/* Generated laboratory reference registry. Rebuild with node release/build-lab-registry.cjs. */";
const end = "/* End laboratory reference registry. */";
const candidates = ["referenceIntervals", "researchExamples"];
const guidance = ["clinicalLimits", "unconfirmed", "history"];
const groups = [...candidates, ...guidance];
const decisions = ["kept", "corrected", "replaced", "retired", "pending-verification"];

// Embeds the research registry of reference candidates as shown in «Нормы анализов». Approval flags stay false: the registry is shown, never applied to patient results.
// Guidance after the audit of 23.10.2026: current wording in clinicalLimits, wording not checked against the full text in unconfirmed, previous editions in history.
// Every 0.33.0 guidance claim of lab-reference-ranges.json has to be represented in the row it belongs to.
function build({
  registryPath = path.resolve(__dirname, "../medassist/research/lab-reference-registry.json"),
  displayPath = path.resolve(__dirname, "../medassist/research/lab-reference-display.json"),
  rangesPath = path.resolve(__dirname, "../medassist/research/lab-reference-ranges.json"),
  catalogPath = path.resolve(__dirname, "../medassist/research/investigation-catalog.json"),
  modulePath = path.resolve(__dirname, "../medassist/app/modules.js")
} = {}) {
  const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const registry = read(registryPath), display = read(displayPath), ranges = read(rangesPath), catalog = read(catalogPath);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(registry.checkedAt || "") || !Array.isArray(registry.rows) || !Array.isArray(registry.sources)) throw new Error("Missing registry.");
  if (registry.approvedForImport !== false) throw new Error("The registry must stay unapproved for import.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(registry.audit?.reviewedAt || "")) throw new Error("Missing audit summary.");
  const sources = new Map();
  for (const source of registry.sources) {
    if (!source.id || sources.has(source.id) || !source.title || !/^https:\/\//.test(source.url || "")) throw new Error("Invalid source: " + source.id);
    sources.set(source.id, source);
  }
  const claims = new Map();
  for (const panel of ranges.panels) for (const claim of panel.rows.flatMap(row => (row.international || []).map(item => ({...item, key: panel.panelId + "/" + row.fieldId})))) {
    if (!claim.id?.startsWith(claim.key + "#") || claims.has(claim.id) || !decisions.includes(claim.audit?.decision)) throw new Error("Invalid guidance claim: " + claim.id);
    claims.set(claim.id, {decision: claim.audit.decision, groups: new Set()});
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
    const audit = row.audit;
    if (!audit || !/^\d{4}-\d{2}-\d{2}$/.test(audit.reviewedAt || "") || !audit.verdict || !decisions.includes(audit.decision) || !audit.summary || !Array.isArray(audit.unverified) || !Array.isArray(audit.recheck))
      throw new Error("Missing audit result: " + row.key);
    for (const group of groups) {
      if (!Array.isArray(row[group])) throw new Error("Missing " + group + ": " + row.key);
      for (const item of row[group]) {
        if (!item.value?.trim() || !item.kind || !sources.has(item.source) || item.transferValidated === true || item.approvedForClinicalUse === true) throw new Error("Invalid " + group + " entry: " + row.key);
        if (item.status !== undefined && (item.status !== "unconfirmed" || !candidates.includes(group))) throw new Error("Invalid status in " + group + ": " + row.key);
        if (!guidance.includes(group)) continue;
        if (!item.verification || !Array.isArray(item.claimIds) || (!item.claimIds.length && !item.added)) throw new Error("Untraced " + group + " entry: " + row.key);
        for (const id of item.claimIds) {
          if (!claims.has(id) || !id.startsWith(row.key + "#")) throw new Error("Unknown guidance claim " + id + " in " + row.key);
          claims.get(id).groups.add(group);
        }
      }
    }
    // A row without a confirmed candidate shows an honest empty state with its reason, never a substitute number.
    if (!candidates.some(group => row[group].some(item => item.status !== "unconfirmed")) && !row.noCandidateReason?.trim()) throw new Error("No candidate to show: " + row.key);
    if (row.sources.some(id => !sources.has(id))) throw new Error("Unknown source in " + row.key);
    return {...row, shortName: label.shortName, abbreviation: label.abbreviation};
  });
  for (const [id, claim] of claims) {
    if (!claim.groups.size) throw new Error("Guidance claim not represented: " + id);
    if (["retired", "pending-verification"].includes(claim.decision) && claim.groups.has("clinicalLimits")) throw new Error("Retired or unconfirmed claim shown as current: " + id);
    if (["kept", "corrected"].includes(claim.decision) && !claim.groups.has("clinicalLimits")) throw new Error("Kept claim missing from current guidance: " + id);
  }
  const used = new Set(rows.flatMap(row => [...row.sources, ...groups.flatMap(group => row[group].map(item => item.source))]));
  const data = {checkedAt: registry.checkedAt, revision: registry.revision, approvedForImport: false, audit: registry.audit, limitations: registry.limitations, unconfirmedBelarusUnits: unconfirmed, rows, sources: registry.sources.filter(source => used.has(source.id))};
  let module = fs.readFileSync(modulePath, "utf8");
  const first = module.indexOf(start), last = module.indexOf(end);
  if ((first < 0) !== (last < 0) || (first >= 0 && last < first)) throw new Error("Broken registry markers.");
  const block = start + "\nwindow.MedAssistLabRegistry = Object.freeze(" + JSON.stringify(data).replace(/</g, "\\u003c") + ");\n" + end + "\n\n";
  const anchor = "window.MedAssistModules = Object.freeze([";
  if (first < 0 && module.split(anchor).length !== 2) throw new Error("Modules registry not found.");
  module = first < 0 ? module.replace(anchor, block + anchor) : module.slice(0, first) + block + module.slice(last + end.length).replace(/^\s*\n/, "");
  fs.writeFileSync(modulePath, module);
  return {rows: rows.length, sources: data.sources.length, checkedAt: data.checkedAt, revision: data.revision, claims: claims.size};
}
module.exports = build;
if (require.main === module) console.log(JSON.stringify(build()));
