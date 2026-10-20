"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../app/core.js");
const NOW = "2032-04-19T09:00:00.000Z";
const TODAY = "2032-04-19";
const PATIENT_ID = "briefing-patient";

function patient(id = PATIENT_ID) {
  return core.createPatient({ id, label: "Вымышленный Пациент Сводки", now: NOW });
}
function visit(id = "visit-1", date = TODAY, patientId = PATIENT_ID, createdAt = NOW) {
  const encounter = core.createEncounter({ id, patientId, now: createdAt });
  encounter.visitDate = date;
  return encounter;
}
function prescription(id, name = "Вымышленный препарат") {
  return { id, name, dose: "условная доза", route: "введено вручную", frequency: "условная частота", duration: "запись прошлого приёма", note: "Только демонстрация" };
}
function result(id, date = TODAY, changes = {}) {
  return { id, kind: "lab", date, name: "Вымышленный показатель " + id, result: "0", unit: "усл. ед.", reference: "Из вымышленного бланка", note: "", ...changes };
}
function reportRows(id, date, count = 2, kind = "lab") {
  return Array.from({ length: count }, (_, index) => result(id + "-row-" + index, date, {
    kind, reportId: id, reportTitle: "Вымышленный бланк " + id, panelId: "demo-panel", fieldId: "field-" + index
  }));
}
function legacyVisit(id, from = "2032-04-01", to = "2032-04-05", patientId = PATIENT_ID) {
  const encounter = visit(id, TODAY, patientId);
  Object.assign(encounter.assessment, { sickLeaveIssued: "yes", sickLeaveNumber: "ДЕМО-" + id, sickLeaveFrom: from, sickLeaveTo: to });
  return encounter;
}
function returnVisit(id, date, status = "planned", patientId = PATIENT_ID) {
  const encounter = visit(id, "2032-04-01", patientId);
  encounter.assessment.returnVisitDate = date;
  encounter.workflow.returnVisitStatus = status;
  return encounter;
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
}
function objectReferences(value, found = new Set()) {
  if (value && typeof value === "object" && !found.has(value)) {
    found.add(value);
    for (const item of Object.values(value)) objectReferences(item, found);
  }
  return found;
}

test("an empty patient briefing states missing information without inferred clinical findings", () => {
  assert.deepEqual(core.getPatientBriefing(patient(), [], TODAY), {
    patientId: PATIENT_ID, today: TODAY, visitCount: 0, diagnoses: [],
    facts: { conditions: null, medications: null, allergies: null },
    prescriptions: null, investigations: [], investigationCount: 0,
    sickLeaves: { open: [], legacy: [] }, nextReturn: null, overdueReturnCount: 0
  });
  assert.equal(core.SCHEMA_VERSION, 4);
});

test("blank recent visits neither invent absence nor erase separately dated historical facts", () => {
  const allergy = visit("allergy-source", "2032-03-01");
  allergy.history.allergies = "  Вымышленная реакция из старой записи  ";
  const medications = visit("medication-source", "2032-04-02");
  medications.history.medications = "Условный постоянный препарат";
  const conditions = visit("condition-source", "2032-04-03");
  conditions.history.conditions = "Заболевание из учебного сценария";
  const blank = visit("blank-newer", TODAY);
  blank.history.allergies = " \n ";
  blank.history.medications = "\t";
  blank.history.conditions = " ";
  const summary = core.getPatientBriefing(patient(), [conditions, blank, allergy, medications], TODAY);
  assert.equal(summary.visitCount, 4);
  assert.deepEqual(summary.facts, {
    allergies: { encounterId: allergy.id, date: allergy.visitDate, text: allergy.history.allergies },
    medications: { encounterId: medications.id, date: medications.visitDate, text: medications.history.medications },
    conditions: { encounterId: conditions.id, date: conditions.visitDate, text: conditions.history.conditions }
  });
  assert.deepEqual(summary.diagnoses, []);
  assert.equal(summary.prescriptions, null);
});

test("explicit newer history wording replaces older wording without interpreting its meaning", () => {
  const older = visit("older-history", "2032-04-01");
  older.history.allergies = "Вымышленная реакция";
  const newer = visit("newer-history", TODAY);
  newer.history.allergies = "Сведения уточняются";
  const summary = core.getPatientBriefing(patient(), [older, newer], TODAY);
  assert.deepEqual(summary.facts.allergies, { encounterId: newer.id, date: TODAY, text: "Сведения уточняются" });
  assert.equal(summary.facts.medications, null);
  assert.equal(summary.facts.conditions, null);
});

test("the latest three nonempty diagnoses use visit date, creation time and identifier ties", () => {
  const oldest = visit("oldest", "2032-03-31");
  const z = visit("tie-z", "2032-04-18", PATIENT_ID, "2032-04-18T09:00:00.000Z");
  const a = visit("tie-a", "2032-04-18", PATIENT_ID, "2032-04-18T09:00:00.000Z");
  const newerTime = visit("newer-time", "2032-04-18", PATIENT_ID, "2032-04-18T10:00:00.000Z");
  const blank = visit("blank", TODAY);
  const entries = [oldest, z, blank, a, newerTime];
  for (const encounter of [oldest, z, a, newerTime]) encounter.assessment.summary = "Демонстрационный диагноз " + encounter.id;
  a.draft.text = "Ручная вымышленная запись";
  const reviewedA = core.setReviewStatus(a, "reviewed", { now: NOW });
  entries[3] = reviewedA;
  blank.assessment.summary = " \n ";
  const summary = core.getPatientBriefing(patient(), entries, TODAY);
  assert.deepEqual(summary.diagnoses, [newerTime, reviewedA, z].map(encounter => ({
    encounterId: encounter.id, date: encounter.visitDate, text: encounter.assessment.summary, reviewStatus: encounter.workflow.reviewStatus
  })));
  assert.equal(summary.visitCount, 5);
  assert.deepEqual(core.getPatientBriefing(patient(), [...entries].reverse(), TODAY), summary);
});

test("future dated entries and investigations remain dated facts rather than being silently discarded", () => {
  const future = visit("future-visit", "2032-05-01");
  future.assessment.summary = "Вымышленный будущий диагноз";
  future.history.medications = "Вымышленная запись с будущей датой";
  future.prescriptions = [prescription("future-prescription")];
  const past = visit("past-visit", "2032-04-01");
  past.assessment.summary = "Вымышленный прошлый диагноз";
  const card = { ...patient(), investigations: [result("future-result", "2032-05-02")] };
  const summary = core.getPatientBriefing(card, [past, future], TODAY);
  assert.deepEqual(summary.diagnoses.map(item => item.date), ["2032-05-01", "2032-04-01"]);
  assert.equal(summary.facts.medications.date, "2032-05-01");
  assert.equal(summary.prescriptions.date, "2032-05-01");
  assert.equal(summary.investigations[0].date, "2032-05-02");
  assert.equal(summary.today, TODAY);
});

test("foreign patients cannot supply diagnoses, facts, prescriptions, legacy leaves or return dates", () => {
  const own = visit("own-empty");
  const foreign = legacyVisit("foreign", "2032-04-01", "2032-04-05", "other-patient");
  foreign.visitDate = "2032-05-01";
  foreign.assessment.summary = "СЕКРЕТ ДРУГОГО ПАЦИЕНТА";
  foreign.history.conditions = foreign.history.medications = foreign.history.allergies = "СЕКРЕТ ДРУГОГО ПАЦИЕНТА";
  foreign.prescriptions = [prescription("foreign-rx", "СЕКРЕТ ДРУГОГО ПАЦИЕНТА")];
  foreign.assessment.returnVisitDate = TODAY;
  const foreignPast = returnVisit("foreign-past", "2032-04-18", "planned", "other-patient");
  const summary = core.getPatientBriefing(patient(), [foreign, own, foreignPast], TODAY);
  assert.equal(summary.visitCount, 1);
  assert.deepEqual(summary.diagnoses, []);
  assert.deepEqual(summary.facts, { conditions: null, medications: null, allergies: null });
  assert.equal(summary.prescriptions, null);
  assert.deepEqual(summary.sickLeaves, { open: [], legacy: [] });
  assert.equal(summary.nextReturn, null);
  assert.equal(summary.overdueReturnCount, 0);
  assert.doesNotMatch(JSON.stringify(summary), /СЕКРЕТ|foreign|other-patient/);
});

test("prescriptions come from one latest nonempty source and are not merged or inferred active", () => {
  const old = visit("old-rx", "2032-04-01");
  old.prescriptions = [prescription("old-prescription", "Старое условное назначение")];
  const newer = visit("new-rx", "2032-04-02");
  newer.prescriptions = [prescription("new-one"), prescription("new-two")];
  newer.prescriptions[0].duration = "Курс завершился в прошлом";
  const latestEmpty = visit("latest-empty", TODAY);
  const summary = core.getPatientBriefing(patient(), [latestEmpty, old, newer], TODAY);
  assert.deepEqual(summary.prescriptions, { encounterId: newer.id, date: newer.visitDate, items: newer.prescriptions });
  assert.notEqual(summary.prescriptions.items, newer.prescriptions);
  assert.notEqual(summary.prescriptions.items[0], newer.prescriptions[0]);
  assert.equal(summary.prescriptions.items[0].duration, "Курс завершился в прошлом");
});

test("investigation limits count entire reports once and include standalone results in date order", () => {
  const card = { ...patient(), investigations: [
    ...reportRows("old-report", "2032-04-01", 4),
    result("standalone-middle", "2032-04-15"),
    ...reportRows("recent-report", "2032-04-18", 5),
    result("standalone-newest", TODAY, { kind: "study", result: "Вымышленное инструментальное заключение", unit: "" })
  ] };
  const summary = core.getPatientBriefing(card, [], TODAY);
  assert.equal(summary.investigationCount, 4);
  assert.deepEqual(summary.investigations.map(item => [item.id, item.type, item.results.length]), [
    ["standalone-newest", "result", 1], ["recent-report", "report", 5], ["standalone-middle", "result", 1]
  ]);
  assert.equal(summary.investigations[0].kind, "study");
  assert.equal(summary.investigations[0].title, card.investigations.at(-1).name);
  assert.equal(summary.investigations[1].title, "Вымышленный бланк recent-report");
  assert.deepEqual(summary.investigations[1].results, card.investigations.filter(item => item.reportId === "recent-report"));
});

test("mixed investigation groups use stable identifier ties and preserve manually entered strings", () => {
  const text = "  <5,0\nиз вымышленного бланка  ";
  const card = { ...patient(), investigations: [
    result("z-result", TODAY, { result: text, reference: "Нормы не внесены врачом", note: "<b>Текст, не HTML</b>" }),
    ...reportRows("b-report", TODAY, 2),
    result("a-result", TODAY, { result: "0", unit: "Условная единица" })
  ] };
  const summary = core.getPatientBriefing(card, [], TODAY);
  assert.deepEqual(summary.investigations.map(item => item.id), ["a-result", "b-report", "z-result"]);
  assert.equal(summary.investigations.at(-1).results[0].result, text);
  assert.equal(summary.investigations.at(-1).results[0].note, "<b>Текст, не HTML</b>");
  assert.equal(summary.investigations[0].results[0].result, "0");
  assert.deepEqual(core.getPatientBriefing({ ...card, investigations: [...card.investigations].reverse() }, [], TODAY).investigations.map(item => item.id), ["a-result", "b-report", "z-result"]);
});

test("all explicitly open sick leaves remain visible even after their dates; closed leaves are excluded", () => {
  let card = patient();
  for (let index = 1; index <= 5; index += 1) {
    card = core.issueSickLeave(card, {
      id: "leave-" + index, eventId: "event-" + index, number: "ДЕМО-" + index,
      from: "2032-04-01", to: "2032-04-05", now: NOW
    });
  }
  card = core.closeSickLeave(card, "leave-5", { date: "2032-04-05", eventId: "close-5", now: NOW });
  const summary = core.getPatientBriefing(card, [], TODAY);
  assert.equal(summary.sickLeaves.open.length, 4);
  assert.deepEqual(summary.sickLeaves.open.map(item => item.id), ["leave-1", "leave-2", "leave-3", "leave-4"]);
  assert.ok(summary.sickLeaves.open.every(item => item.status === "open" && item.closedOn === "" && item.days === 5));
  assert.ok(summary.sickLeaves.open.every(item => item.periods[0].to < TODAY));
  assert.deepEqual(summary.sickLeaves.legacy, []);
});

test("legacy leave marks retain unknown status and incomplete dates without joining the open journal", () => {
  const entries = [
    legacyVisit("legacy-1"), legacyVisit("legacy-2"), legacyVisit("legacy-3"), legacyVisit("legacy-4", "", ""),
    legacyVisit("foreign-legacy", "2032-04-01", "2032-04-05", "foreign-patient")
  ];
  const summary = core.getPatientBriefing(patient(), entries, TODAY);
  assert.deepEqual(summary.sickLeaves.open, []);
  assert.equal(summary.sickLeaves.legacy.length, 4);
  assert.deepEqual(summary.sickLeaves.legacy.find(item => item.encounterId === "legacy-4"), {
    encounterId: "legacy-4", number: "ДЕМО-legacy-4", from: "", to: "", days: null
  });
  assert.ok(summary.sickLeaves.legacy.every(item => !Object.hasOwn(item, "status")));
});

test("encounter-linked journal actions do not appear again as legacy sick leave marks", () => {
  const issue = core.applyEncounterSickLeave(patient(), visit("issue-visit"), {
    type: "issue", id: "linked-leave", eventId: "issue-event", number: "ДЕМО-ЖУРНАЛ",
    from: "2032-04-19", to: "2032-04-23", now: NOW
  });
  const extension = core.applyEncounterSickLeave(issue.patient, visit("extend-visit", "2032-04-23"), {
    type: "extend", leaveId: "linked-leave", eventId: "extend-event", from: "2032-04-23", to: "2032-04-27", now: NOW
  }, [issue.encounter]);
  const summary = core.getPatientBriefing(extension.patient, [issue.encounter, extension.encounter], TODAY);
  assert.equal(summary.sickLeaves.open.length, 1);
  assert.equal(summary.sickLeaves.open[0].days, 9);
  assert.equal(summary.sickLeaves.open[0].events.length, 2);
  assert.deepEqual(summary.sickLeaves.legacy, []);
});

test("nearest planned return includes today, excludes completed dates and counts all overdue plans", () => {
  const todayA = returnVisit("today-a", TODAY);
  todayA.workflow.returnVisitEncounterId = "linked-repeat";
  const entries = [
    returnVisit("later", "2032-04-22"),
    returnVisit("past-two", "2032-04-18"),
    returnVisit("today-z", TODAY),
    returnVisit("completed-today", TODAY, "completed"),
    returnVisit("completed-past", "2032-04-17", "completed"),
    returnVisit("past-one", "2032-04-16"),
    returnVisit("foreign-today", TODAY, "planned", "foreign-patient"),
    todayA, visit("linked-repeat")
  ];
  const summary = core.getPatientBriefing(patient(), entries, TODAY);
  assert.deepEqual(summary.nextReturn, {
    encounterId: todayA.id, patientId: PATIENT_ID, date: TODAY, bucket: "today", linkedEncounterId: "linked-repeat"
  });
  assert.equal(summary.overdueReturnCount, 2);
  const later = core.getPatientBriefing(patient(), entries, "2032-04-20");
  assert.equal(later.nextReturn.encounterId, "later");
  assert.equal(later.nextReturn.bucket, "upcoming");
  assert.equal(later.overdueReturnCount, 4);
});

test("overdue or completed return dates alone do not invent an upcoming appointment", () => {
  const summary = core.getPatientBriefing(patient(), [
    returnVisit("past", "2032-04-18"), returnVisit("future-completed", "2032-04-21", "completed"), visit("no-date")
  ], TODAY);
  assert.equal(summary.nextReturn, null);
  assert.equal(summary.overdueReturnCount, 1);
});

test("visits without a recorded date stay undated and sort after dated visits", () => {
  const undated = visit("undated", "");
  undated.assessment.summary = "Вымышленный диагноз без даты";
  undated.history.allergies = "Вымышленная запись без даты";
  const dated = visit("dated", "2032-04-01");
  dated.assessment.summary = "Вымышленный диагноз с датой";
  const summary = core.getPatientBriefing(patient(), [undated, dated], TODAY);
  assert.deepEqual(summary.diagnoses.map(item => item.date), [dated.visitDate, ""]);
  assert.equal(summary.facts.allergies.date, "");
});

test("briefing reads frozen inputs without mutations and exposes no aliases to source objects", () => {
  const encounter = legacyVisit("source");
  encounter.history.allergies = "Вымышленная аллергия";
  encounter.history.medications = "Вымышленный постоянный препарат";
  encounter.history.conditions = "Вымышленное заболевание";
  encounter.assessment.summary = "Вымышленный диагноз";
  encounter.assessment.returnVisitDate = "2032-04-23";
  encounter.prescriptions = [prescription("source-prescription")];
  let card = core.issueSickLeave(patient(), {
    id: "independent-leave", eventId: "leave-event", number: "ДЕМО-ОТДЕЛЬНО",
    from: "2032-04-10", to: "2032-04-12", now: NOW
  });
  card.investigations = [...reportRows("report", TODAY, 2), result("single", "2032-04-18")];
  card = freeze(card);
  const encounters = freeze([encounter]);
  const inputSnapshot = JSON.stringify([card, encounters]);
  const summary = core.getPatientBriefing(card, encounters, TODAY);
  const sources = objectReferences([card, encounters]);
  for (const item of objectReferences(summary)) assert.equal(sources.has(item), false);
  summary.facts.allergies.text = "Изменено в результате";
  summary.diagnoses[0].text = "Изменено в результате";
  summary.prescriptions.items[0].name = "Изменено в результате";
  summary.investigations[0].results[0].result = "Изменено в результате";
  summary.sickLeaves.open[0].events[0].to = "2032-04-30";
  summary.sickLeaves.open[0].periods[0].from = "2032-04-01";
  summary.sickLeaves.legacy[0].number = "Изменено в результате";
  summary.nextReturn.date = "2032-04-30";
  assert.equal(JSON.stringify([card, encounters]), inputSnapshot);
  const next = core.getPatientBriefing(card, encounters, TODAY);
  assert.equal(next.facts.allergies.text, encounter.history.allergies);
  assert.equal(next.investigations[0].results[0].result, "0");
  assert.equal(next.nextReturn.date, "2032-04-23");
});

test("reading the briefing does not change the default empty transfer into a repeat encounter", () => {
  const source = visit();
  source.history.allergies = "Вымышленная аллергия";
  source.history.medications = "Вымышленный препарат";
  source.history.conditions = "Вымышленное заболевание";
  source.assessment.summary = "Вымышленный диагноз";
  source.prescriptions = [prescription("old-prescription")];
  core.getPatientBriefing(patient(), [source], TODAY);
  const repeated = core.createRepeatEncounter(source, { id: "repeated", now: NOW });
  assert.equal(repeated.patientId, source.patientId);
  assert.ok(Object.values(repeated.history).every(value => value === ""));
  assert.equal(repeated.assessment.summary, "");
  assert.equal(repeated.prescriptions, undefined);
  assert.equal(repeated.investigationIds, undefined);
});

test("malformed patient, date, visit structures, duplicate IDs and excessive lists fail explicitly", () => {
  for (const card of [null, {}, [], { ...patient(), label: 42 }]) {
    assert.throws(() => core.getPatientBriefing(card, [], TODAY), /карточка пациента/);
  }
  for (const today of [null, undefined, 20320419, "", "19.04.2032", "2031-02-29", "2032-13-01"]) {
    assert.throws(() => core.getPatientBriefing(patient(), [], today), /сегодняшнюю дату/);
  }
  for (const entries of [null, {}, "", Array(core.MAX_ENCOUNTERS + 1)]) {
    assert.throws(() => core.getPatientBriefing(patient(), entries, TODAY), /список/);
  }
  for (const entries of [[null], [{}], Array(1), [{ ...visit(), history: null }], [{ ...visit(), createdAt: "invalid" }], [{ ...visit(), visitDate: "2032-02-30" }]]) {
    assert.throws(() => core.getPatientBriefing(patient(), entries, TODAY), /данные приёма/);
  }
  assert.throws(() => core.getPatientBriefing(patient(), [visit(), visit()], TODAY), /Повторный идентификатор/);
});
