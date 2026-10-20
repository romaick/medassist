"use strict";
const fs = require("node:fs");
const path = require("node:path");
const start = "/* Generated investigation input catalog. Rebuild with node release/build-investigations.cjs. */";
const end = "/* End investigation input catalog. */";

function build({
  catalogPath = path.resolve(__dirname, "../medassist/research/investigation-catalog.json"),
  modulePath = path.resolve(__dirname, "../medassist/app/modules.js")
} = {}) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(catalog.sources) || !Array.isArray(catalog.panels) || !catalog.panels.length) throw new Error("Missing investigation catalog.");
  const sourceIds = new Set(catalog.sources.map(source => source.id));
  if (sourceIds.size !== catalog.sources.length || catalog.sources.some(source => !source.id || !source.title || !/^https:\/\//.test(source.url))) throw new Error("Invalid catalog sources.");
  const panelIds = new Set();
  for (const panel of catalog.panels) {
    if (!panel.id || panelIds.has(panel.id) || !panel.title || !["lab", "study"].includes(panel.kind) || !panel.fields?.length || panel.fields.length > 100) throw new Error("Invalid input panel: " + panel.id);
    panelIds.add(panel.id);
    const fieldIds = new Set();
    for (const item of [panel, ...panel.fields]) {
      if (!item.sourceIds?.length || item.sourceIds.some(id => !sourceIds.has(id))) throw new Error("Missing source for " + panel.id + "/" + (item.id || ""));
      if ("result" in item || "reference" in item || "normal" in item) throw new Error("Catalog must not supply results or reference values.");
    }
    for (const field of panel.fields) {
      if (!field.id || fieldIds.has(field.id) || typeof field.name !== "string" || !field.name.trim() || field.name.length > 200 || typeof field.unit !== "string" || field.unit.length > 80) throw new Error("Invalid indicator: " + panel.id + "/" + field.id);
      fieldIds.add(field.id);
    }
  }
  let source = fs.readFileSync(modulePath, "utf8");
  const first = source.indexOf(start), last = source.indexOf(end);
  if ((first < 0) !== (last < 0) || (first >= 0 && last < first)) throw new Error("Broken investigation catalog markers.");
  const block = start + "\nwindow.MedAssistInvestigationCatalog = Object.freeze(" + JSON.stringify(catalog).replace(/</g, "\\u003c") + ");\n" + end + "\n\n";
  source = first < 0 ? block + source : source.slice(0, first) + block + source.slice(last + end.length).replace(/^\s*\n/, "");
  fs.writeFileSync(modulePath, source);
  return {panels: catalog.panels.length, indicators: catalog.panels.reduce((sum, panel) => sum + panel.fields.length, 0), sources: catalog.sources.length};
}
module.exports = build;
if (require.main === module) console.log(JSON.stringify(build()));
