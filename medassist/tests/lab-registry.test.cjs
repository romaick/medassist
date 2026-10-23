"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const registry = require("../research/lab-reference-registry.json");
const display = require("../research/lab-reference-display.json");
const ranges = require("../research/lab-reference-ranges.json");
const catalog = require("../research/investigation-catalog.json");
const build = require("../../release/build-lab-registry.cjs");
const start = "/* Generated laboratory reference registry. Rebuild with node release/build-lab-registry.cjs. */";
const end = "/* End laboratory reference registry. */";
const modulePath = path.join(__dirname, "../app/modules.js");
const groups = ["referenceIntervals", "researchExamples", "clinicalLimits", "unconfirmed", "history"];
const row = key => registry.rows.find(item => item.key === key);
const values = (key, group) => row(key)[group].map(item => item.value + " | " + item.source);
const text = (key, group) => row(key)[group].map(item => item.value + " " + item.scope).join(" ");
const claims = ranges.panels.flatMap(panel => panel.rows.flatMap(item => (item.international || []).map(claim => ({...claim, key: panel.panelId + "/" + item.fieldId}))));

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
      assert.notEqual(entry.approvedForClinicalUse, true, item.key);
      assert.ok(sources.get(entry.source)?.url.startsWith("https://"), item.key + " " + entry.source);
    }
    for (const id of item.sources) assert.ok(sources.has(id), item.key + " " + id);
  }
  assert.equal(registry.supplement.unconfirmedBelarusUnits.length, 12, "the 12 Belarusian unit gaps stay open after the international audit");
  assert.deepEqual(registry.rows.filter(item => !item.unitAudit.belarusPublicationConfirmed).map(item => item.key).sort(), registry.supplement.unconfirmedBelarusUnits.slice().sort());
});

test("registry keeps reference intervals, research examples and clinical limits apart and leaves excluded numbers out", () => {
  assert.deepEqual(values("coagulation/inr", "referenceIntervals"), ["0,8–1,2 | RU-HELIX-INR"]);
  assert.match(row("coagulation/inr").clinicalLimits[0].value, /^ФП на антагонисте витамина К: цель МНО 2,0–3,0/, "INR treatment target is a clinical limit, not a reference");
  assert.match(row("cbc/segmented").referenceIntervals[0].scope, /Именно сегментоядерные, не все нейтрофилы/);
  assert.match(row("biochemistry/ldl").referenceIntervals[0].kind, /Желательный уровень лаборатории; не референсный интервал/);
  assert.ok(!groups.some(group => row("biochemistry/ggt")[group].some(entry => entry.source.startsWith("BY-INV"))), "contradictory INVITRO GGT numbers stay excluded");
  assert.ok(!row("thyroid/ft3").referenceIntervals.some(entry => entry.source.startsWith("BY-BIO")), "contradictory Biomedica FT3 stays excluded");
  assert.ok(row("coagulation/fibrinogen").notes.some(note => /0,01/.test(note)), "fibrinogen conversion note is kept");
  assert.ok(row("cbc/hemoglobin").researchExamples.every(entry => /не международная рекомендация/.test(entry.kind)), "CBC study values are not called recommendations");
});

test("the audit of 23.10.2026 is applied: every row has a result and every 0.33.0 claim a decision shown in one place", () => {
  assert.equal(registry.audit.reviewedAt, "2026-10-23");
  assert.equal(registry.revision, "19-international-audit-2026-10-23");
  for (const item of registry.rows) {
    assert.ok(["kept", "corrected", "replaced", "retired", "pending-verification"].includes(item.audit.decision), item.key);
    assert.ok(item.audit.verdict && item.audit.summary && Array.isArray(item.audit.unverified), item.key);
  }
  assert.equal(claims.length, 59, "all 59 audited claims are accounted for");
  const shownAt = new Map();
  for (const item of registry.rows) for (const group of ["clinicalLimits", "unconfirmed", "history"]) for (const entry of item[group]) {
    assert.ok(entry.verification && Array.isArray(entry.claimIds), item.key + " " + group + " entry is traced");
    assert.ok(entry.claimIds.length || entry.added, item.key + " untraced entries must be marked as new");
    for (const id of entry.claimIds) shownAt.set(id, [...(shownAt.get(id) || []), group]);
  }
  for (const claim of claims) {
    const at = shownAt.get(claim.id) || [];
    assert.ok(at.length, claim.id + " is represented");
    if (["kept", "corrected"].includes(claim.audit.decision)) assert.ok(at.includes("clinicalLimits"), claim.id + " current");
    if (claim.audit.decision === "retired") assert.deepEqual(at, ["history"], claim.id + " only in history");
    assert.equal(claim.verified, ["kept", "corrected"].includes(claim.audit.decision), claim.id + " old verified flag follows the audit");
    assert.deepEqual(claim.audit.shownIn.slice().sort(), [...new Set(at)].sort(), claim.id + " shownIn matches the registry");
  }
  // No claim is shown in its old wording next to the new one: archived wording appears only in history.
  for (const claim of claims) for (const item of registry.rows) for (const group of ["clinicalLimits", "unconfirmed"]) assert.ok(!item[group].some(entry => entry.value === claim.text), claim.id + " old wording is not current");
  const added = registry.rows.flatMap(item => groups.flatMap(group => item[group].filter(entry => entry.added).map(entry => ({key: item.key, group, entry}))));
  assert.deepEqual(added.map(({key, group}) => key + " " + group).sort(), ["biochemistry/ferritin clinicalLimits", "biochemistry/ferritin clinicalLimits", "biochemistry/ldl clinicalLimits", "biochemistry/triglycerides unconfirmed", "coagulation/inr unconfirmed", "thyroid/tsh clinicalLimits"].sort());
  for (const {entry} of added) assert.match(entry.verification, /^(Новая запись по аудиту 23\.10\.2026|Аудит 23\.10\.2026)/, "new entries state their origin");
  for (const item of registry.rows) for (const entry of item.history) assert.match(entry.archivedFrom, /Medasist 0\.33\.0–0\.34\.0.*23\.10\.2026/, item.key + " history is dated");
});

test("audit corrections keep units, signs and scope: no merged ranges, no qualitative zero, no unconfirmed number as current", () => {
  assert.match(text("cbc/hemoglobin", "clinicalLimits"), /Анемия, 15–65 лет: женщины вне беременности Hb <120 г\/л; мужчины <130 г\/л/);
  assert.match(text("cbc/hemoglobin", "clinicalLimits"), /верхнюю границу здорового интервала документ не задаёт/);
  assert.match(text("cbc/platelets", "clinicalLimits"), /впервые выявленная ИТП — условно предпочтительна госпитализация; уже установленная ИТП — амбулаторное ведение/);
  assert.match(text("biochemistry/alt", "clinicalLimits"), /а не интервалы «нормы 29–33\/19–25»; нижняя граница не установлена/);
  assert.doesNotMatch(text("biochemistry/alt", "clinicalLimits"), /«Истинно здоровая» норма/);
  assert.equal(row("urinalysis/bilirubin").referenceIntervals[0].unit, "мкмоль/л", "LODE publishes urine bilirubin in µmol/l with a qualitative answer");
  assert.match(row("urinalysis/bilirubin").referenceIntervals[0].scope, /не нулевая концентрация/);
  for (const key of ["urinalysis/specific-gravity", "urinalysis/ph"]) assert.equal(row(key).referenceIntervals[0].unit, "безразмерно", key + " is numeric");
  assert.match(text("urinalysis/leukocytes", "clinicalLimits"), /центрифугированном осадке первой порции.*В мазке из уретры — ≥5 ПЯЛ в поле зрения \(×1000\)/);
  assert.match(text("urinalysis/bacteria", "clinicalLimits"), /≥10⁵ КОЕ\/мл.*≥10³ КОЕ\/мл.*КОЕ\/мл посева не равны ед\/мл анализатора/);
  assert.match(text("biochemistry/creatinine", "clinicalLimits"), /Категории рСКФ \(не креатинина\)/);
  for (const key of ["biochemistry/cholesterol-total", "biochemistry/hdl", "biochemistry/ldl", "biochemistry/triglycerides"]) assert.doesNotMatch(row(key).referenceIntervals[0].value, /Цель/, key + " laboratory desirable level is not a target");
  assert.match(text("biochemistry/ferritin", "clinicalLimits"), /<15 мкг\/л.*<70 мкг\/л/, "WHO 2020 is kept");
  assert.match(text("biochemistry/ferritin", "clinicalLimits"), /порог ферритина 30 мкг\/л вместо 15.*50 мкг\/л/, "ASH 2026 is added beside WHO");
  assert.doesNotMatch(text("biochemistry/ferritin", "clinicalLimits"), /≤500|TSAT ≤30/, "KDIGO CKD therapy thresholds are not shown as ferritin norms");
  assert.match(text("biochemistry/ldl", "clinicalLimits"), /<100 мг\/дл.*<70 мг\/дл.*<55 мг\/дл.*не совпадают — не объединять/, "ACC/AHA 2026 stays in its own units and risk scale");
  assert.match(text("biochemistry/vitamin-d-25oh", "clinicalLimits"), /12–<20 нг\/мл/);
  assert.match(text("biochemistry/vitamin-d-25oh", "history"), /Endocrine Society 2011/);
  assert.doesNotMatch(text("coagulation/inr", "clinicalLimits"), /2,5–4,0|ESC\/EACTS 2021/, "the 2021 valve matrix is not current");
  assert.match(text("coagulation/inr", "history"), /ESC\/EACTS 2021.*2,5–4,0/);
  assert.match(text("coagulation/inr", "unconfirmed"), /3,0 \(2,5–3,5\).*3,5 \(3,0–4,0\)/, "ESC/EACTS 2025 table stays marked as not checked against the full text");
  assert.match(row("coagulation/inr").unconfirmed[0].verification, /Не применять без сверки/);
  assert.match(text("coagulation/inr", "clinicalLimits"), /только у пациентов, которым ПОАК подходят/);
  assert.doesNotMatch(text("thyroid/tsh", "clinicalLimits"), /I триместр 2,5, II — 3,0, III — 3,5/, "ETA 2014 pregnancy limits are not current");
  assert.match(text("thyroid/tsh", "history"), /ETA 2014.*2,5.*3,0.*3,5/);
  assert.match(row("thyroid/tsh").referenceIntervals.find(entry => entry.source === "ATA26").scope, /Только I и II триместры/);
  assert.match(text("thyroid/ft4", "history"), /10,30 пмоль\/л/);
  assert.equal(row("thyroid/ft4").clinicalLimits.length, 0);
  // Numbers the audit could not re-read were re-checked at release against the laboratory page or PDF.
  for (const [key, id] of [["cbc/esr", "BY-INV-ESR"], ["cbc/bands", "BY-INV-DIFF"], ["cbc/rdw-sd", "US-NYU-RDW"]]) {
    assert.match(registry.sources.find(source => source.id === id).recheck, /^Сверено при подготовке Medasist 0\.35\.0 \(23\.10\.2026\)/, key);
    assert.ok(row(key).audit.recheck.length, key + " shows the release re-check");
  }
  for (const item of registry.rows) for (const group of ["referenceIntervals", "researchExamples"]) assert.ok(item[group].every(entry => entry.status === undefined), item.key + " has no unconfirmed candidate after the re-check");
});

test("modules.js carries the registry with display labels; the build is repeatable and refuses approval, untraced guidance or invented candidates", () => {
  const source = fs.readFileSync(modulePath, "utf8");
  const block = source.slice(source.indexOf(start), source.indexOf(end));
  const shipped = JSON.parse(block.slice(block.indexOf("Object.freeze(") + 14, block.lastIndexOf(");")));
  assert.equal(shipped.approvedForImport, false);
  assert.deepEqual(shipped.audit, registry.audit);
  assert.deepEqual(shipped.rows.map(item => item.key), registry.rows.map(item => item.key), "registry order is kept");
  for (const item of shipped.rows) {
    const original = row(item.key);
    for (const group of [...groups, "notes", "sources", "unitAudit", "unitStatus", "displayUnit", "name", "readiness", "audit"]) assert.deepEqual(item[group], original[group], item.key + " " + group);
    assert.deepEqual([item.shortName, item.abbreviation], [display.rows[item.key].shortName, display.rows[item.key].abbreviation]);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "medassist-registry-"));
  try {
    const copy = path.join(dir, "modules.js"), brokenPath = path.join(dir, "registry.json"), rangesPath = path.join(dir, "ranges.json");
    fs.writeFileSync(copy, source);
    build({modulePath: copy});
    assert.equal(fs.readFileSync(copy, "utf8"), source, "rebuilding changes nothing");
    const at = key => registry.rows.findIndex(item => item.key === key);
    const cases = [
      [data => { data.approvedForImport = true; }, /unapproved for import/],
      [data => { data.rows[0].approvedForClinicalUse = true; }, /Invalid row/],
      [data => { data.rows[0].researchExamples[0].transferValidated = true; }, /Invalid researchExamples entry/],
      [data => { data.rows[0].clinicalLimits[0].source = "NOWHERE"; }, /Invalid clinicalLimits entry/],
      [data => { data.rows[0].clinicalLimits[0].approvedForClinicalUse = true; }, /Invalid clinicalLimits entry/],
      [data => { data.rows.pop(); }, /one to one/],
      [data => { data.sources[0].url = "http://example.com/"; }, /Invalid source/],
      [data => { delete data.rows[0].audit; }, /Missing audit result/],
      [data => { data.rows[0].clinicalLimits[0].claimIds = []; }, /Untraced clinicalLimits entry/],
      [data => { data.rows[0].clinicalLimits[0].claimIds = ["cbc/erythrocytes#1"]; }, /Unknown guidance claim/],
      [data => { const item = data.rows[at("thyroid/ft4")]; item.clinicalLimits.push(item.history[0]); }, /Retired or unconfirmed claim shown as current/],
      [data => { const item = data.rows[at("cbc/hematocrit")]; item.history = item.clinicalLimits; item.clinicalLimits = []; }, /Kept claim missing from current guidance/],
      [data => { data.rows[0].clinicalLimits[0].status = "unconfirmed"; }, /Invalid status/],
      [data => { const item = data.rows[at("cbc/esr")]; for (const entry of item.referenceIntervals) entry.status = "unconfirmed"; }, /No candidate to show: cbc\/esr/]
    ];
    for (const [change, error] of cases) {
      const broken = structuredClone(registry);
      change(broken);
      fs.writeFileSync(brokenPath, JSON.stringify(broken));
      assert.throws(() => build({registryPath: brokenPath, modulePath: copy}), error);
    }
    // An honest empty state builds: the unconfirmed number stays in the data, marked, with a stated reason.
    const empty = structuredClone(registry), esr = empty.rows[at("cbc/esr")];
    for (const entry of esr.referenceIntervals) entry.status = "unconfirmed";
    esr.noCandidateReason = "Проверочная причина: повторная сверка не завершена.";
    fs.writeFileSync(brokenPath, JSON.stringify(empty));
    build({registryPath: brokenPath, modulePath: copy});
    assert.match(fs.readFileSync(copy, "utf8"), /Проверочная причина: повторная сверка не завершена\./);
    // A guidance claim without an audit decision is refused.
    const brokenRanges = structuredClone(ranges);
    delete brokenRanges.panels[0].rows[0].international[0].audit;
    fs.writeFileSync(rangesPath, JSON.stringify(brokenRanges));
    assert.throws(() => build({rangesPath, modulePath: copy}), /Invalid guidance claim/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
