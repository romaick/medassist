"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../app/core.js");
const { BACKUP_KEY, KEY, WATCHED_KEYS, createRepository, createBackupTracker, backupReminderDue, summarizeBackup } = require("../app/storage.js");
const NOW = "2032-04-19T09:00:00.000Z";
const WEEK = "2032-04-26T09:00:00.000Z";
const FILE = "medassist-demo-2032-04-19.json";
const EMPTY = { lastExportAt: "", fileName: "", remindAfter: "" };
const EXPORTED = { lastExportAt: NOW, fileName: FILE, remindAfter: "" };

function memoryStorage(raw = null) {
  const values = new Map(raw === null ? [] : [[BACKUP_KEY, raw]]);
  return {
    values, reads: [], writes: [], failRead: false, failWrite: false,
    getItem(key) { this.reads.push(key); if (this.failRead) throw new Error("Read unavailable"); return values.get(key) ?? null; },
    setItem(key, value) { if (this.failWrite) throw new Error("Quota exceeded"); this.writes.push(key); values.set(key, value); }
  };
}
function freeze(value) {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function patient(id = "fictional-patient", label = "Вымышленный Пациент") { return core.createPatient({ id, label, now: NOW }); }
function encounter(id = "visit-1", patientId = "fictional-patient", visitDate = "2032-04-19") {
  const entry = core.createEncounter({ id, patientId, now: NOW });
  entry.visitDate = visitDate;
  return entry;
}
function parsedBundle(patients = [], encounters = [], templates = []) {
  const bundle = JSON.parse(core.serializeBundle(encounters, patients, templates));
  bundle.exportedAt = NOW;
  return core.parseBundle(JSON.stringify(bundle));
}

test("backup metadata is lazy, separate from patient keys and absent until explicit export", () => {
  const storage = memoryStorage();
  let requests = 0;
  const tracker = createBackupTracker(() => { requests += 1; return storage; });
  assert.equal(requests, 0);
  assert.equal(WATCHED_KEYS.includes(BACKUP_KEY), false);
  assert.deepEqual(tracker.readBackupInfo(), { ok: true, info: EMPTY });
  assert.deepEqual(storage.reads, [BACKUP_KEY]);
  assert.deepEqual(storage.writes, []);
  const returned = tracker.readBackupInfo();
  returned.info.lastExportAt = NOW;
  assert.deepEqual(tracker.readBackupInfo().info, EMPTY);
});

test("recording a prepared export stores only its date and filename and clears postponement", () => {
  const storage = memoryStorage(JSON.stringify({ ...EXPORTED, remindAfter: WEEK }));
  storage.values.set(KEY, "patient bundle must stay untouched");
  const tracker = createBackupTracker(storage);
  assert.deepEqual(tracker.recordBackupExport({ lastExportAt: WEEK, fileName: "medassist-demo-next.json" }), {
    ok: true, info: { lastExportAt: WEEK, fileName: "medassist-demo-next.json", remindAfter: "" }
  });
  assert.deepEqual(JSON.parse(storage.values.get(BACKUP_KEY)), { lastExportAt: WEEK, fileName: "medassist-demo-next.json", remindAfter: "" });
  assert.equal(storage.values.get(KEY), "patient bundle must stay untouched");
  assert.deepEqual(storage.writes, [BACKUP_KEY]);
  assert.deepEqual(storage.reads, []);
});

test("metadata never includes clinical content or additional export fields", () => {
  const storage = memoryStorage();
  const tracker = createBackupTracker(storage);
  const privateFields = { patients: [patient()], encounters: [encounter()], label: "Вымышленный Пациент", diagnosis: "Демонстрационный диагноз" };
  for (const [field, value] of Object.entries(privateFields)) {
    const result = tracker.recordBackupExport({ lastExportAt: NOW, fileName: FILE, [field]: value });
    assert.equal(result.ok, false);
    assert.match(result.error, /дату выгрузки/);
  }
  assert.deepEqual(storage.writes, []);
  assert.equal(tracker.recordBackupExport({ lastExportAt: NOW, fileName: FILE }).ok, true);
  assert.deepEqual(Object.keys(JSON.parse(storage.values.get(BACKUP_KEY))).sort(), ["fileName", "lastExportAt", "remindAfter"]);
  assert.doesNotMatch(storage.values.get(BACKUP_KEY), /Вымышленный|Пациент|диагноз/);
});

test("corrupt metadata is reported and postponement cannot overwrite it", () => {
  const corrupt = [
    "{broken", "null", "[]", "42", "{}",
    JSON.stringify({ ...EXPORTED, extra: "not allowed" }),
    JSON.stringify({ ...EXPORTED, fileName: 123 }),
    JSON.stringify({ ...EXPORTED, lastExportAt: "2032-02-30T09:00:00.000Z" }),
    JSON.stringify({ ...EXPORTED, remindAfter: "tomorrow" })
  ];
  for (const raw of corrupt) {
    const storage = memoryStorage(raw);
    const tracker = createBackupTracker(storage);
    const read = tracker.readBackupInfo();
    assert.equal(read.ok, false, raw);
    assert.deepEqual(read.info, EMPTY);
    assert.match(read.error, /Не удалось прочитать/);
    assert.equal(tracker.postponeBackupReminder(WEEK).ok, false);
    assert.equal(storage.values.get(BACKUP_KEY), raw);
    assert.deepEqual(storage.writes, []);
  }
});

test("a successful explicit export can replace corrupt metadata without reading it", () => {
  const storage = memoryStorage("{broken");
  storage.failRead = true;
  const tracker = createBackupTracker(storage);
  assert.deepEqual(tracker.recordBackupExport({ lastExportAt: NOW, fileName: FILE }), { ok: true, info: EXPORTED });
  assert.deepEqual(storage.reads, []);
  storage.failRead = false;
  assert.deepEqual(tracker.readBackupInfo(), { ok: true, info: EXPORTED });
});

test("storage read failures remain visible and do not write or alter metadata", () => {
  const storage = memoryStorage(JSON.stringify(EXPORTED));
  storage.failRead = true;
  const tracker = createBackupTracker(storage);
  for (const result of [tracker.readBackupInfo(), tracker.postponeBackupReminder(WEEK)]) {
    assert.equal(result.ok, false);
    assert.deepEqual(result.info, EMPTY);
    assert.match(result.error, /Read unavailable/);
  }
  assert.equal(storage.values.get(BACKUP_KEY), JSON.stringify(EXPORTED));
  assert.deepEqual(storage.writes, []);
});

test("failed export and postponement writes are reported and leave the prior marker intact", () => {
  const storage = memoryStorage(JSON.stringify(EXPORTED));
  storage.failWrite = true;
  const tracker = createBackupTracker(storage);
  const exportResult = tracker.recordBackupExport({ lastExportAt: WEEK, fileName: "next.json" });
  assert.equal(exportResult.ok, false);
  assert.match(exportResult.error, /Не удалось сохранить.*Quota exceeded/);
  const postponeResult = tracker.postponeBackupReminder(WEEK);
  assert.equal(postponeResult.ok, false);
  assert.match(postponeResult.error, /Не удалось отложить.*Quota exceeded/);
  assert.deepEqual(postponeResult.info, EXPORTED);
  assert.equal(storage.values.get(BACKUP_KEY), JSON.stringify(EXPORTED));
  assert.deepEqual(storage.writes, []);
});

test("unavailable storage providers return useful errors without throwing", () => {
  for (const provider of [null, {}, { getItem() {} }, () => { throw new Error("Storage access denied"); }]) {
    const tracker = createBackupTracker(provider);
    for (const result of [tracker.readBackupInfo(), tracker.recordBackupExport({ lastExportAt: NOW, fileName: FILE }), tracker.postponeBackupReminder(WEEK)]) {
      assert.equal(result.ok, false);
      assert.match(result.error, /хранилище|Storage access denied/);
    }
  }
});

test("invalid timestamp and filename arguments never replace a valid marker", () => {
  const invalidTimes = ["", "tomorrow", "2032-02-30T09:00:00.000Z", "2032-04-19", "2032-04-19T09:00:00Z", "2032-04-19T25:00:00.000Z", "0000-04-19T09:00:00.000Z", null, 0];
  const storage = memoryStorage(JSON.stringify(EXPORTED));
  const tracker = createBackupTracker(storage);
  for (const value of invalidTimes) {
    assert.equal(tracker.recordBackupExport({ lastExportAt: value, fileName: FILE }).ok, false);
    assert.equal(tracker.postponeBackupReminder(value).ok, false);
  }
  for (const value of [null, [], {}, { lastExportAt: NOW }, { lastExportAt: NOW, fileName: 42 }]) {
    assert.equal(tracker.recordBackupExport(value).ok, false);
  }
  assert.equal(storage.values.get(BACKUP_KEY), JSON.stringify(EXPORTED));
  assert.deepEqual(storage.writes, []);
});

test("postponement preserves the last export and can postpone an initial reminder", () => {
  for (const initial of [null, JSON.stringify(EXPORTED)]) {
    const storage = memoryStorage(initial);
    const tracker = createBackupTracker(storage);
    const result = tracker.postponeBackupReminder(WEEK);
    assert.deepEqual(result, { ok: true, info: { ...(initial === null ? EMPTY : EXPORTED), remindAfter: WEEK } });
    assert.deepEqual(tracker.readBackupInfo(), result);
    assert.deepEqual(storage.writes, [BACKUP_KEY]);
  }
});

test("reminder starts with data, reaches seven full days and respects a finite postponement", () => {
  assert.equal(backupReminderDue(EMPTY, NOW, false), false);
  assert.equal(backupReminderDue(EMPTY, NOW, true), true);
  assert.equal(backupReminderDue(EXPORTED, NOW, true), false);
  assert.equal(backupReminderDue(EXPORTED, "2032-04-26T08:59:59.999Z", true), false);
  assert.equal(backupReminderDue(EXPORTED, WEEK, true), true);
  assert.equal(backupReminderDue(EXPORTED, "2032-04-27T09:00:00.000Z", true), true);
  assert.equal(backupReminderDue({ ...EMPTY, remindAfter: WEEK }, NOW, true), false);
  assert.equal(backupReminderDue({ ...EMPTY, remindAfter: WEEK }, WEEK, true), true);
  assert.equal(backupReminderDue({ ...EXPORTED, remindAfter: "2032-04-28T09:00:00.000Z" }, WEEK, true), false);
});

test("invalid clocks, invalid export dates and clock rollback never silently hide the reminder", () => {
  for (const info of [null, [], {}, { ...EXPORTED, lastExportAt: "wrong" }, { ...EXPORTED, lastExportAt: "2032-02-30T09:00:00.000Z" }, { ...EXPORTED, lastExportAt: "9999-12-31T23:59:59.999Z" }]) {
    assert.equal(backupReminderDue(info, NOW, true), true);
  }
  assert.equal(backupReminderDue(EXPORTED, "wrong", true), true);
  assert.equal(backupReminderDue(null, "wrong", false), false);
  assert.throws(() => backupReminderDue(EXPORTED, NOW, 1), /указано явно/);
});

test("normal data loads, saves and replacement do not touch backup metadata", () => {
  const storage = memoryStorage(JSON.stringify(EXPORTED));
  const repository = createRepository(storage);
  assert.deepEqual(repository.load(), { patients: [], encounters: [], error: null });
  assert.equal(repository.save([encounter()], [patient()]).ok, true);
  assert.equal(repository.reset().ok, true);
  assert.equal(storage.values.get(BACKUP_KEY), JSON.stringify(EXPORTED));
  assert.equal(storage.reads.includes(BACKUP_KEY), false);
  assert.deepEqual(storage.writes, [KEY, KEY]);
});

test("backup preview counts records, result rows, templates and leaves without linked duplicates or mutations", () => {
  const first = encounter("visit-first", "fictional-patient", "2032-04-17");
  first.history.complaints = "Не переносить жалобы в краткое описание копии";
  first.exam.general = "Вымышленное описание осмотра для шаблона.";
  const issued = core.applyEncounterSickLeave(patient(), first, { type: "issue", id: "leave-1", eventId: "event-1", number: "ДЕМО-101", from: "2032-04-17", to: "2032-04-21", now: NOW });
  const extension = encounter("visit-latest", "fictional-patient", "2032-04-21");
  const extended = core.applyEncounterSickLeave(issued.patient, extension, { type: "extend", leaveId: "leave-1", eventId: "event-2", from: "2032-04-21", to: "2032-04-23", now: NOW }, [issued.encounter]);
  const card = core.upsertInvestigationReport(extended.patient, {
    date: "2032-04-19", title: "Вымышленный бланк", panelId: "demo-lab", kind: "lab",
    rows: [
      { fieldId: "value-a", name: "Показатель А", result: "1", unit: "усл. ед.", reference: "", note: "" },
      { fieldId: "value-b", name: "Показатель Б", result: "2", unit: "усл. ед.", reference: "", note: "" }
    ]
  }, { now: NOW });
  const secondCard = patient("patient-other", "Другая Вымышленная");
  const legacyLeave = encounter("visit-old", secondCard.id, "2032-03-29");
  Object.assign(legacyLeave.assessment, { sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-202", sickLeaveFrom: "2032-03-29", sickLeaveTo: "2032-04-01" });
  const template = core.createVisitTemplate(first, { id: "template-1", name: "Тестовый шаблон", kind: "exam", now: NOW });
  const bundle = freeze(parsedBundle([card, secondCard, patient("patient-empty", "")], [extended.encounter, legacyLeave, issued.encounter], [template]));
  const before = JSON.stringify(bundle);
  const summary = summarizeBackup(bundle);
  assert.deepEqual(summary, {
    patientCount: 3, encounterCount: 3, templateCount: 1, shortcutCount: 0, investigationCount: 2, sickLeaveCount: 2,
    firstVisitDate: "2032-03-29", lastVisitDate: "2032-04-21", exportedAt: NOW,
    patients: [
      { id: "fictional-patient", label: "Вымышленный Пациент", encounterCount: 2, lastVisitDate: "2032-04-21" },
      { id: "patient-other", label: "Другая Вымышленная", encounterCount: 1, lastVisitDate: "2032-03-29" },
      { id: "patient-empty", label: "", encounterCount: 0, lastVisitDate: "" }
    ]
  });
  assert.equal(JSON.stringify(bundle), before);
  assert.doesNotMatch(JSON.stringify(summary), /Не переносить жалобы|Показатель А|ДЕМО-101/);
  summary.patients[0].label = "Изменено только в описании";
  assert.equal(bundle.patients[0].label, "Вымышленный Пациент");
});

test("empty backup preview has zero counts and no invented visit dates", () => {
  assert.deepEqual(summarizeBackup(freeze(parsedBundle())), {
    patientCount: 0, encounterCount: 0, templateCount: 0, shortcutCount: 0, investigationCount: 0, sickLeaveCount: 0,
    firstVisitDate: "", lastVisitDate: "", exportedAt: NOW, patients: []
  });
});

test("legacy imports are summarized after the existing parser migrates them in memory", () => {
  for (const version of [1, 2, 3]) {
    const bundle = parsedBundle([patient()], [encounter()]);
    bundle.schemaVersion = version;
    delete bundle.encounters[0].workflow;
    if (version < 3) { delete bundle.patients; delete bundle.encounters[0].patientId; }
    if (version === 1) {
      delete bundle.encounters[0].examSelections;
      for (const field of ["returnVisitDate", "sickLeaveIssued", "sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"]) delete bundle.encounters[0].assessment[field];
    }
    const original = JSON.stringify(bundle);
    const migrated = core.parseBundle(original);
    assert.equal(migrated.schemaVersion, 4);
    const summary = summarizeBackup(freeze(migrated));
    assert.equal(summary.patientCount, 1);
    assert.equal(summary.encounterCount, 1);
    assert.equal(summary.firstVisitDate, "2032-04-19");
    assert.equal(summary.lastVisitDate, "2032-04-19");
    assert.equal(summary.exportedAt, NOW);
    assert.equal(summary.patients[0].id, version === 3 ? "fictional-patient" : "visit-1");
    assert.equal(summary.patients[0].label, version === 3 ? "Вымышленный Пациент" : "");
    assert.equal(JSON.stringify(bundle), original);
  }
});
