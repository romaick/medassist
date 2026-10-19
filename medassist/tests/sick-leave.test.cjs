"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const core = require("../app/core.js");
const { createRepository, KEY } = require("../app/storage.js");
const NOW = "2032-04-15T09:00:00.000Z";
const LATER = "2032-04-16T10:00:00.000Z";
const period = (from, to) => ({ from, to });
function patient(id = "fictional-patient") { return core.createPatient({ id, label: "Вымышленный Пациент", now: NOW }); }
function issue(card = patient(), changes = {}, encounters = []) {
  return core.issueSickLeave(card, { id: "leave-1", eventId: "event-1", number: "ДЕМО-101", from: "2032-04-01", to: "2032-04-05", now: NOW, ...changes }, encounters);
}
function encounter(id = "source-1", changes = {}) {
  const entry = core.createEncounter({ id, patientId: "fictional-patient", now: NOW });
  Object.assign(entry.assessment, { sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-101", sickLeaveFrom: "2032-04-01", sickLeaveTo: "2032-04-05", ...changes });
  return entry;
}
function freeze(value) {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function bundle(card, encounters = []) { return JSON.parse(core.serializeBundle(encounters, [card])); }

test("total days count the inclusive union of overlapping, nested, duplicate and disjoint periods", () => {
  const periods = freeze([
    period("2032-04-10", "2032-04-12"), period("2032-04-03", "2032-04-07"),
    period("2032-04-01", "2032-04-05"), period("2032-04-02", "2032-04-03"),
    period("2032-04-10", "2032-04-12"), period("2032-04-08", "2032-04-08")
  ]);
  assert.equal(core.calculateSickLeaveTotalDays(periods), 11);
  assert.equal(core.calculateSickLeaveTotalDays([...periods].reverse()), 11);
  assert.equal(core.calculateSickLeaveTotalDays([]), 0);
  assert.equal(core.calculateSickLeaveTotalDays([period("2032-02-27", "2032-03-02")]), 5);
  assert.equal(core.calculateSickLeaveTotalDays([period("0001-01-01", "0001-01-01"), period("9999-12-31", "9999-12-31")]), 2);
});

test("union counting rejects incomplete, malformed and reversed periods instead of guessing days", () => {
  for (const input of [null, {}, "", [null], Array(1), [{}], [{ from: "2032-04-01" }], [period("2031-02-29", "2031-03-01")], [period("2032-04-03", "2032-04-01")], [period("", "2032-04-01")], [{ ...period("2032-04-01", "2032-04-02"), extra: true }]]) {
    assert.throws(() => core.calculateSickLeaveTotalDays(input));
  }
});

test("union totals match independent unique-day enumeration across varied period orders", () => {
  const base = Date.parse("2032-01-01T00:00:00.000Z");
  const date = offset => new Date(base + offset * 86400000).toISOString().slice(0, 10);
  for (let seed = 0; seed < 100; seed += 1) {
    const days = new Set();
    const periods = [];
    for (let index = 0; index < 12; index += 1) {
      const start = (seed * 19 + index * 7) % 90;
      const end = start + (seed * 11 + index * 3) % 20;
      periods.unshift(period(date(start), date(end)));
      for (let day = start; day <= end; day += 1) days.add(day);
    }
    assert.equal(core.calculateSickLeaveTotalDays(periods), days.size, "seed " + seed);
    assert.equal(core.calculateSickLeaveTotalDays([...periods, ...periods]), days.size, "duplicates for seed " + seed);
  }
});

test("union days stay equal across DST, local time zones, leap days and year boundaries", () => {
  const intervals = [period("2032-03-27", "2032-03-29"), period("2032-03-29", "2032-03-31"), period("2032-02-28", "2032-03-01"), period("2031-12-31", "2032-01-01")];
  const script = "process.stdout.write(String(require(" + JSON.stringify(require.resolve("../app/core.js")) + ").calculateSickLeaveTotalDays(" + JSON.stringify(intervals) + ")))";
  for (const TZ of ["UTC", "Europe/Minsk", "Europe/Berlin", "America/New_York", "Pacific/Apia"]) {
    assert.equal(execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ }, encoding: "utf8" }), "10", TZ);
  }
});

test("issuing a leave adds an explicit open journal while an empty card retains its previous shape", () => {
  const original = freeze(patient());
  const card = issue(original);
  assert.equal(Object.hasOwn(original, "sickLeaves"), false);
  assert.equal(core.SCHEMA_VERSION, 4);
  assert.deepEqual(core.validatePatient(card), []);
  assert.equal(card.sickLeaves.length, 1);
  assert.equal(card.sickLeaves[0].events[0].type, "issue");
  const journal = core.getSickLeaveJournal(card, []);
  assert.equal(journal.leaves[0].status, "open");
  assert.equal(journal.leaves[0].closedOn, "");
  assert.equal(journal.leaves[0].days, 5);
  assert.equal(journal.totalDays, 5);
  assert.equal(journal.incompleteCount, 0);
  assert.deepEqual(journal.legacy, []);
  assert.deepEqual(core.getSickLeaveJournal(original, []), { leaves: [], legacy: [], totalDays: 0, incompleteCount: 0 });
});

test("extension preserves its full overlap and adds only previously uncovered days", () => {
  const original = freeze(issue());
  const card = core.extendSickLeave(original, "leave-1", { from: "2032-04-04", to: "2032-04-08", eventId: "event-2", now: LATER });
  const journal = core.getSickLeaveJournal(card, []);
  assert.equal(original.sickLeaves[0].events.length, 1);
  assert.equal(card.updatedAt, LATER);
  assert.equal(journal.leaves[0].status, "open");
  assert.deepEqual(journal.leaves[0].periods, [period("2032-04-01", "2032-04-08")]);
  assert.equal(card.sickLeaves[0].events[1].from, "2032-04-04");
  assert.equal(journal.leaves[0].days, 8);
  assert.equal(journal.totalDays, 8);
});

test("closing on an earlier covered day clips every period and never adds a day for the close event", () => {
  const extended = core.extendSickLeave(issue(), "leave-1", { from: "2032-04-04", to: "2032-04-10", eventId: "event-2", now: NOW });
  const closed = core.closeSickLeave(freeze(extended), "leave-1", { date: "2032-04-06", eventId: "event-3", now: LATER });
  const journal = core.getSickLeaveJournal(closed, []);
  assert.equal(journal.totalDays, 6);
  assert.equal(journal.leaves[0].status, "closed");
  assert.equal(journal.leaves[0].closedOn, "2032-04-06");
  assert.equal(closed.sickLeaves[0].events[1].to, "2032-04-10");
  assert.deepEqual(journal.leaves[0].periods, [period("2032-04-01", "2032-04-06")]);
  assert.equal(core.getSickLeaveJournal(core.closeSickLeave(extended, "leave-1", { date: "2032-04-01", now: NOW }), []).totalDays, 1);
  assert.equal(core.getSickLeaveJournal(core.closeSickLeave(extended, "leave-1", { date: "2032-04-10", now: NOW }), []).totalDays, 10);
});

test("gaps remain uncounted and cannot be selected as a close date", () => {
  const extended = core.extendSickLeave(issue(), "leave-1", { from: "2032-04-10", to: "2032-04-12", now: NOW });
  assert.equal(core.getSickLeaveJournal(extended, []).totalDays, 8);
  assert.throws(() => core.closeSickLeave(extended, "leave-1", { date: "2032-04-08", now: NOW }), /Дата закрытия/);
  const closed = core.closeSickLeave(extended, "leave-1", { date: "2032-04-03", now: NOW });
  assert.deepEqual(core.getSickLeaveJournal(closed, []).leaves[0].periods, [period("2032-04-01", "2032-04-03")]);
  assert.equal(core.getSickLeaveJournal(closed, []).totalDays, 3);
  const filled = core.extendSickLeave(extended, "leave-1", { from: "2032-04-06", to: "2032-04-13", now: NOW });
  assert.deepEqual(core.getSickLeaveJournal(filled, []).leaves[0].periods, [period("2032-04-01", "2032-04-13")]);
});

test("extension and closure reject invalid transitions and preserve their input", () => {
  const card = freeze(issue());
  for (const dates of [period("2032-03-31", "2032-04-07"), period("2032-04-01", "2032-04-05"), period("2032-04-03", "2032-04-04"), period("2032-04-10", "2032-04-08"), period("", "2032-04-08")]) assert.throws(() => core.extendSickLeave(card, "leave-1", { ...dates, now: NOW }));
  for (const date of ["2032-03-31", "2032-04-06", "2032-02-30", ""]) assert.throws(() => core.closeSickLeave(card, "leave-1", { date, now: NOW }));
  const closed = freeze(core.closeSickLeave(card, "leave-1", { date: "2032-04-05", now: NOW }));
  assert.throws(() => core.extendSickLeave(closed, "leave-1", { from: "2032-04-06", to: "2032-04-09", now: NOW }), /После закрытия/);
  assert.throws(() => core.closeSickLeave(closed, "leave-1", { date: "2032-04-04", now: NOW }), /После закрытия/);
  for (const fn of [core.extendSickLeave, core.closeSickLeave, core.undoSickLeaveAction]) assert.throws(() => fn(card, "missing", { now: NOW }), /не найден/);
});

test("undo restores the previous state, reopens a closed leave and removes an undone sole issuance", () => {
  const original = issue();
  const extended = core.extendSickLeave(original, "leave-1", { from: "2032-04-04", to: "2032-04-10", now: NOW });
  const closed = freeze(core.closeSickLeave(extended, "leave-1", { date: "2032-04-07", now: NOW }));
  const reopened = core.undoSickLeaveAction(closed, "leave-1", { now: LATER });
  assert.equal(core.getSickLeaveJournal(reopened, []).leaves[0].status, "open");
  assert.equal(core.getSickLeaveJournal(reopened, []).totalDays, 10);
  assert.equal(reopened.updatedAt, LATER);
  const issued = core.undoSickLeaveAction(reopened, "leave-1", { now: NOW });
  assert.deepEqual(issued, original);
  const empty = core.undoSickLeaveAction(issued, "leave-1", { now: NOW });
  assert.deepEqual(empty, patient());
  assert.equal(closed.sickLeaves[0].events.length, 3);
});

test("the patient total counts overlaps across separate leaves and legacy encounters only once", () => {
  const card = issue(issue(), { id: "leave-2", eventId: "event-2", number: "ДЕМО-202", from: "2032-04-04", to: "2032-04-08" });
  const entries = [encounter("source-1", { sickLeaveFrom: "2032-04-07", sickLeaveTo: "2032-04-10" }), encounter("source-2", { sickLeaveFrom: "2032-04-15", sickLeaveTo: "2032-04-16" })];
  const journal = core.getSickLeaveJournal(card, entries);
  assert.deepEqual(journal.leaves.map(leave => leave.days), [5, 5]);
  assert.deepEqual(journal.legacy.map(leave => leave.days), [4, 2]);
  assert.equal(journal.totalDays, 12);
});

test("incomplete or invalid legacy entries remain visible and do not enter the total", () => {
  const entries = [encounter("missing", { sickLeaveFrom: "" }), encounter("reversed", { sickLeaveFrom: "2032-04-07" }), encounter("invalid", { sickLeaveTo: "2032-02-30" }), encounter("complete")];
  const other = encounter("other"); other.patientId = "another-patient"; entries.push(other);
  const noLeave = encounter("not-issued", { sickLeaveIssued: "no" }); entries.push(noLeave);
  const journal = core.getSickLeaveJournal(patient(), entries);
  assert.equal(journal.incompleteCount, 3);
  assert.equal(journal.totalDays, 5);
  assert.deepEqual(journal.legacy.map(leave => leave.days), [null, null, null, 5]);
  assert.equal(core.getSickLeaveJournal(issue(), []).leaves[0].status, "open", "past end dates never imply closure");
});

test("adopting a legacy entry requires its exact source and removes its duplicate contribution", () => {
  const source = freeze(encounter());
  const card = issue(patient(), { sourceEncounterId: source.id }, [source]);
  assert.equal(core.getSickLeaveJournal(card, [source]).legacy.length, 0);
  assert.equal(core.getSickLeaveJournal(card, [source]).totalDays, 5);
  const closed = core.closeSickLeave(card, "leave-1", { date: "2032-04-03", now: NOW });
  assert.equal(core.getSickLeaveJournal(closed, [source]).totalDays, 3, "the old source must not restore clipped days");
  const undone = core.undoSickLeaveAction(card, "leave-1", { now: NOW });
  assert.equal(core.getSickLeaveJournal(undone, [source]).legacy.length, 1);
  for (const changes of [{ number: "other" }, { from: "2032-04-02" }, { to: "2032-04-06" }, { sourceEncounterId: "missing" }]) assert.throws(() => issue(patient(), { sourceEncounterId: source.id, ...changes }, [source]));
  assert.throws(() => issue(card, { id: "another-leave", eventId: "another-event", sourceEncounterId: source.id }, [source]), /повторная ссылка/);
  assert.throws(() => issue(patient("another-patient"), { sourceEncounterId: source.id }, [source]), /этому пациенту/);
  assert.throws(() => issue(patient(), { sourceEncounterId: source.id }, [encounter("source-1", { sickLeaveIssued: "no" })]), /выданным больничным/);
});

test("source changes after adoption never rewrite journal history or saved drafts", () => {
  const source = encounter(); source.draft.text = "Ручной вымышленный текст";
  const card = issue(patient(), { sourceEncounterId: source.id }, [source]);
  const before = structuredClone(card);
  source.assessment.sickLeaveIssued = "no";
  source.assessment.sickLeaveNumber = "ИЗМЕНЁННЫЙ";
  source.assessment.sickLeaveFrom = "2032-04-20";
  source.assessment.sickLeaveTo = "2032-04-30";
  const restored = core.parseBundle(core.serializeBundle([source], [card]));
  assert.deepEqual(restored.patients[0], before);
  assert.equal(restored.encounters[0].draft.text, "Ручной вымышленный текст");
  assert.equal(core.getSickLeaveJournal(restored.patients[0], restored.encounters).totalDays, 5);
});

test("journal backup import and normalization preserve every value while detaching nested objects", () => {
  const original = core.closeSickLeave(core.extendSickLeave(issue(), "leave-1", { from: "2032-04-04", to: "2032-04-10", now: NOW }), "leave-1", { date: "2032-04-08", now: LATER });
  const raw = bundle(original);
  const validated = core.validateBundle(freeze(raw));
  const restored = core.parseBundle(JSON.stringify(raw));
  assert.deepEqual(restored.patients[0], original);
  validated.patients[0].sickLeaves[0].events[0].from = "2032-04-02";
  assert.equal(raw.patients[0].sickLeaves[0].events[0].from, "2032-04-01");
  const journal = core.getSickLeaveJournal(freeze(original), []);
  journal.leaves[0].events[0].from = "2032-04-02";
  journal.leaves[0].periods[0].from = "2032-04-03";
  assert.equal(original.sickLeaves[0].events[0].from, "2032-04-01");
});

test("bundle validation rejects missing or cross-patient journal source references", () => {
  const source = encounter();
  const card = issue(patient(), { sourceEncounterId: source.id }, [source]);
  assert.throws(() => core.serializeBundle([], [card]), /Исходный приём/);
  const other = patient("another-patient");
  source.patientId = other.id;
  assert.throws(() => core.serializeBundle([source], [card, other]), /другому пациенту/);
});

test("old schema 4 cards remain unchanged and schema 3 still rejects the new optional field", () => {
  const card = patient();
  const data = bundle(card, [encounter()]);
  const before = JSON.stringify(data);
  assert.deepEqual(core.parseBundle(before), data);
  assert.equal(JSON.stringify(data), before);
  assert.equal(Object.hasOwn(core.parseBundle(before).patients[0], "sickLeaves"), false);
  const old = bundle(issue(), [encounter()]);
  old.schemaVersion = 3;
  delete old.encounters[0].workflow;
  assert.throws(() => core.parseBundle(JSON.stringify(old)), /не поддерживается/);
});

test("strict journal validation rejects unknown fields, missing fields, invalid dates, types and repeated IDs", () => {
  const invalid = [
    card => { card.sickLeaves = null; }, card => { card.sickLeaves = [null]; },
    card => { card.sickLeaves[0].extra = true; }, card => { delete card.sickLeaves[0].number; },
    card => { card.sickLeaves[0].id = ""; }, card => { card.sickLeaves[0].number = 123; },
    card => { card.sickLeaves[0].number = "1".repeat(121); }, card => { card.sickLeaves[0].sourceEncounterId = null; },
    card => { card.sickLeaves[0].events = []; }, card => { card.sickLeaves[0].events = null; },
    card => { card.sickLeaves[0].events = [null]; }, card => { card.sickLeaves[0].events[0].extra = true; },
    card => { delete card.sickLeaves[0].events[0].recordedAt; }, card => { card.sickLeaves[0].events[0].recordedAt = "2032-04-15"; },
    card => { card.sickLeaves[0].events[0].recordedAt = "2032-02-30T09:00:00.000Z"; },
    card => { card.sickLeaves[0].events[0].type = "extend"; }, card => { card.sickLeaves[0].events[0].type = "unknown"; },
    card => { card.sickLeaves[0].events[0].from = "2032-02-30"; }, card => { card.sickLeaves[0].events[0].to = "2032-03-31"; },
    card => { card.sickLeaves.push(structuredClone(card.sickLeaves[0])); },
    card => { card.sickLeaves.push({ ...structuredClone(card.sickLeaves[0]), id: "unique-leave" }); },
    card => { card.sickLeaves[0].events.push({ ...card.sickLeaves[0].events[0], id: "unique-event", from: "2032-04-06", to: "2032-04-08" }); }
  ];
  for (const mutate of invalid) {
    const card = issue(); mutate(card);
    assert.notDeepEqual(core.validatePatient(card), [], String(mutate));
    assert.throws(() => core.serializeBundle([], [card]), String(mutate));
  }
});

test("action inputs reject unknown fields, malformed time, duplicate IDs and missing required values", () => {
  for (const changes of [{ extra: true }, { now: "bad time" }, { id: "" }, { eventId: "bad id" }, { number: undefined }, { from: undefined }, { sourceEncounterId: null }]) assert.throws(() => issue(patient(), changes));
  assert.throws(() => issue(issue(), { eventId: "new-event" }), /повторяющийся/);
  assert.throws(() => core.extendSickLeave(issue(), "leave-1", { from: "2032-04-05", to: "2032-04-10", eventId: "event-1", now: NOW }), /повторяющийся/);
  assert.throws(() => core.closeSickLeave(issue(), "leave-1", { date: "2032-04-05", from: "", now: NOW }), /параметры/);
  assert.throws(() => core.undoSickLeaveAction(issue(), "leave-1", { surprise: true }), /параметры/);
  assert.throws(() => core.getSickLeaveJournal(patient(), [encounter(), encounter()]), /повторный идентификатор/);
});

test("journal limits cap leaves and events without losing valid existing data", () => {
  const card = issue();
  card.sickLeaves = Array.from({ length: core.MAX_SICK_LEAVES }, (_, index) => ({ ...structuredClone(card.sickLeaves[0]), id: "leave-" + index, events: [{ ...card.sickLeaves[0].events[0], id: "event-" + index }] }));
  assert.deepEqual(core.validatePatient(card), []);
  assert.throws(() => issue(freeze(card), { id: "overflow", eventId: "overflow-event" }), /не более 100/);
  const full = issue();
  const first = full.sickLeaves[0].events[0];
  full.sickLeaves[0].events = Array.from({ length: core.MAX_SICK_LEAVE_EVENTS }, (_, index) => ({ ...first, id: "event-" + index, type: index ? "extend" : "issue", to: new Date(Date.parse("2032-04-05T00:00:00.000Z") + index * 86400000).toISOString().slice(0, 10) }));
  assert.deepEqual(core.validatePatient(full), []);
  assert.throws(() => core.closeSickLeave(freeze(full), "leave-1", { date: "2032-04-05", now: NOW }), /от 1 до 100/);
  assert.equal(core.undoSickLeaveAction(full, "leave-1", { now: NOW }).sickLeaves[0].events.length, 99);
});

test("repository round trip includes the journal and invalid saves cannot replace it", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const first = createRepository(storage);
  const second = createRepository(storage);
  first.load(); second.load();
  const card = issue();
  first.save([], [card]);
  const saved = values.get(KEY);
  const invalid = structuredClone(card);
  invalid.sickLeaves[0].events[0].to = "2032-02-30";
  assert.equal(second.save([], [invalid]).ok, false);
  assert.equal(values.get(KEY), saved);
  assert.deepEqual(second.load().patients[0], card);
});

function countedEncounter(id, from, to, number = "ЛН-2032", visitDate = from) {
  const result = encounter(id, { sickLeaveFrom: from, sickLeaveTo: to, sickLeaveNumber: number });
  result.visitDate = visitDate;
  return result;
}

test("repeat encounter counts 19–23 and 23–27 as nine continuous days for matching numbered or unnamed leaves", () => {
  for (const number of ["ЛН-2032", ""]) {
    const previous = countedEncounter("previous", "2032-04-19", "2032-04-23", number);
    const current = countedEncounter("current", "2032-04-23", "2032-04-27", number);
    const summary = core.getEncounterSickLeaveSummary(current, patient(), [previous, current]);
    assert.deepEqual(summary, { periodDays: 5, totalDays: 9, from: "2032-04-19", to: "2032-04-27", unnumbered: number === "", hasPrevious: true });
    assert.equal(core.calculateSickLeaveDays(current.assessment.sickLeaveFrom, current.assessment.sickLeaveTo), 5);
  }
});

test("adjacent periods join with matching trimmed case-insensitive numbers", () => {
  const previous = countedEncounter("previous", "2032-04-19", "2032-04-23", "  ЛН-2032 ");
  const current = countedEncounter("current", "2032-04-24", "2032-04-27", "лн-2032");
  assert.deepEqual(core.getEncounterSickLeaveSummary(current, patient(), [previous, current]), { periodDays: 4, totalDays: 9, from: "2032-04-19", to: "2032-04-27", unnumbered: false, hasPrevious: true });
});

test("continuous summary excludes different numbers, different patients, gaps, future visits and inactive leaves", () => {
  const current = countedEncounter("current", "2032-04-23", "2032-04-27");
  const otherPatient = countedEncounter("other-patient", "2032-04-19", "2032-04-23"); otherPatient.patientId = "another-patient";
  const notIssued = countedEncounter("not-issued", "2032-04-19", "2032-04-23"); notIssued.assessment.sickLeaveIssued = "no";
  const blankVisit = countedEncounter("blank-visit", "2032-04-19", "2032-04-23", "ЛН-2032", "");
  const entries = [current, otherPatient, notIssued, blankVisit,
    countedEncounter("different-number", "2032-04-19", "2032-04-23", "ЛН-OTHER"),
    countedEncounter("blank-number", "2032-04-19", "2032-04-23", ""),
    countedEncounter("gap", "2032-04-19", "2032-04-21"),
    countedEncounter("future-visit", "2032-04-19", "2032-04-23", "ЛН-2032", "2032-04-24"),
    countedEncounter("future-period", "2032-04-28", "2032-04-30", "ЛН-2032", "2032-04-20")
  ];
  assert.equal(core.getEncounterSickLeaveSummary(current, patient(), entries).totalDays, 5);
  assert.equal(core.getEncounterSickLeaveSummary(current, patient(), entries).hasPrevious, false);
  const unnamed = countedEncounter("unnamed-current", "2032-04-23", "2032-04-27", " ");
  assert.equal(core.getEncounterSickLeaveSummary(unnamed, patient(), [unnamed, countedEncounter("numbered-previous", "2032-04-19", "2032-04-23")]).totalDays, 5);
});

test("summary joins a complete prior chain without bridging gaps or counting the same interval twice", () => {
  const current = countedEncounter("current", "2032-04-23", "2032-04-27");
  const entries = [current,
    countedEncounter("first", "2032-04-15", "2032-04-18"),
    countedEncounter("second", "2032-04-19", "2032-04-21"),
    countedEncounter("third", "2032-04-21", "2032-04-24"),
    countedEncounter("duplicate", "2032-04-21", "2032-04-24"),
    countedEncounter("disconnected", "2032-04-01", "2032-04-13")
  ];
  const summary = core.getEncounterSickLeaveSummary(current, patient(), entries);
  assert.equal(summary.totalDays, 13);
  assert.equal(summary.from, "2032-04-15");
  assert.deepEqual(core.getEncounterSickLeaveSummary(current, patient(), [...entries].reverse()), summary);
});

test("live summary tolerates unfinished clinical edits and returns unknown totals for invalid or inactive current periods", () => {
  const previous = countedEncounter("previous", "2032-04-19", "2032-04-23");
  const current = countedEncounter("current", "2032-04-23", "2032-04-27");
  current.vitals.weight = "not a number";
  current.assessment.returnVisitDate = "2032-02-30";
  assert.equal(core.getEncounterSickLeaveSummary(current, patient(), [previous, current]).totalDays, 9);
  for (const changes of [{ sickLeaveFrom: "" }, { sickLeaveTo: "" }, { sickLeaveFrom: "2032-04-28" }, { sickLeaveTo: "2032-02-30" }, { sickLeaveIssued: "no" }, { sickLeaveIssued: "" }]) {
    const edited = structuredClone(current); Object.assign(edited.assessment, changes);
    assert.deepEqual(core.getEncounterSickLeaveSummary(edited, patient(), [previous, edited]), { periodDays: null, totalDays: null, from: "", to: "", unnumbered: false, hasPrevious: false });
  }
  const noVisitDate = structuredClone(current); noVisitDate.visitDate = "";
  assert.equal(core.getEncounterSickLeaveSummary(noVisitDate, patient(), [previous]).totalDays, 5);
  const incompletePrevious = structuredClone(previous); incompletePrevious.assessment.sickLeaveFrom = "";
  assert.equal(core.getEncounterSickLeaveSummary(current, patient(), [incompletePrevious]).totalDays, 5);
});

test("opening an earlier encounter after a repeat visit never adds days after that encounter's period", () => {
  const previous = countedEncounter("previous", "2032-04-19", "2032-04-23");
  const current = countedEncounter("current", "2032-04-23", "2032-04-27");
  assert.deepEqual(core.getEncounterSickLeaveSummary(previous, patient(), [previous, current]), { periodDays: 5, totalDays: 5, from: "2032-04-19", to: "2032-04-23", unnumbered: false, hasPrevious: false });
  const overlap = countedEncounter("overlap", "2032-04-19", "2032-04-30", "ЛН-2032", "2032-04-20");
  assert.equal(core.getEncounterSickLeaveSummary(current, patient(), [previous, overlap, current]).totalDays, 9);
});

test("contextual summary respects journal source snapshots and closed clipping", () => {
  const source = countedEncounter("previous", "2032-04-19", "2032-04-23");
  const current = countedEncounter("current", "2032-04-23", "2032-04-27");
  const card = issue(patient(), { number: "ЛН-2032", from: "2032-04-19", to: "2032-04-23", sourceEncounterId: source.id }, [source]);
  assert.equal(core.getEncounterSickLeaveSummary(current, card, [source, current]).totalDays, 9);
  source.assessment.sickLeaveFrom = "2032-04-10";
  assert.equal(core.getEncounterSickLeaveSummary(current, card, [source, current]).totalDays, 9, "source edits cannot rewrite adopted history");
  const closed = core.closeSickLeave(card, "leave-1", { date: "2032-04-21", now: NOW });
  assert.equal(core.getEncounterSickLeaveSummary(current, closed, [source, current]).totalDays, 5, "the closed interval leaves an uncovered day before the repeat");
  const connectedClose = core.closeSickLeave(card, "leave-1", { date: "2032-04-22", now: NOW });
  assert.equal(core.getEncounterSickLeaveSummary(current, connectedClose, [source, current]).totalDays, 9);
  const futureExtended = core.extendSickLeave(card, "leave-1", { from: "2032-04-23", to: "2032-04-30", now: NOW });
  assert.equal(core.getEncounterSickLeaveSummary(current, futureExtended, [source, current]).totalDays, 9);
});

test("unrelated journal numbers and periods cannot change a contextual total", () => {
  const current = countedEncounter("current", "2032-04-23", "2032-04-27");
  let card = issue(patient(), { number: "ЛН-OTHER", from: "2032-04-19", to: "2032-04-23" });
  card = issue(card, { id: "another-leave", eventId: "another-event", number: "ЛН-2032", from: "2032-04-29", to: "2032-04-30" });
  assert.equal(core.getEncounterSickLeaveSummary(current, card, [current]).totalDays, 5);
});

test("contextual draft reports the current period and nine-day continuous total without rewriting saved text", () => {
  const previous = countedEncounter("previous", "2032-04-19", "2032-04-23");
  const current = countedEncounter("current", "2032-04-23", "2032-04-27");
  current.draft.text = "Ручная запись вымышленного пациента";
  const context = freeze({ patient: patient(), encounters: [previous, current] });
  const before = JSON.stringify(context);
  const draft = core.generateDraft(current, context);
  assert.match(draft, /Период: с 23\.04\.2032 по 27\.04\.2032\./);
  assert.match(draft, /Календарных дней за текущий период: 5\. Всего за непрерывный период с 19\.04\.2032 по 27\.04\.2032: 9\./);
  assert.match(core.generateDraft(current), /Календарных дней: 5\./);
  assert.doesNotMatch(core.generateDraft(current), /Всего за непрерывный период/);
  assert.equal(JSON.stringify(context), before);
});

test("contextual fingerprints track only changed cumulative information and preserve old fingerprints otherwise", () => {
  const previous = countedEncounter("previous", "2032-04-19", "2032-04-23");
  const current = countedEncounter("current", "2032-04-23", "2032-04-27");
  const card = patient();
  const context = { patient: card, encounters: [previous, current] };
  const fingerprint = core.fingerprint(current, context);
  assert.notEqual(fingerprint, core.fingerprint(current));
  previous.history.complaints = "Изменён вымышленный текст";
  previous.draft.text = "Другой ручной текст";
  previous.updatedAt = LATER;
  assert.equal(core.fingerprint(current, context), fingerprint);
  previous.assessment.sickLeaveFrom = "2032-04-20";
  assert.notEqual(core.fingerprint(current, context), fingerprint);
  previous.assessment.sickLeaveNumber = "ДРУГОЙ-НОМЕР";
  assert.equal(core.fingerprint(current, context), core.fingerprint(current));
  assert.equal(core.generateDraft(current, context), core.generateDraft(current));
  assert.equal(core.fingerprint(current, { patient: card, encounters: [current] }), core.fingerprint(current));
  assert.equal(core.SCHEMA_VERSION, 4);
  assert.equal(Object.hasOwn(card, "sickLeaves"), false);
});
