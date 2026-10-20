(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"), root);
  else root.MedAssistStorage = factory(root.MedAssistCore, root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, root) {
  "use strict";
  const KEY = "medassist.demo.v4";
  const PREVIOUS_KEY = "medassist.demo.v3";
  const V2_KEY = "medassist.demo.v2";
  const LEGACY_KEY = "medassist.demo.v1";
  const WATCHED_KEYS = Object.freeze([KEY, PREVIOUS_KEY, V2_KEY, LEGACY_KEY]);
  const BACKUP_KEY = "medassist.backup-info.v1";
  const BACKUP_FIELDS = ["lastExportAt", "fileName", "remindAfter"];

  function describe(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function emptyBackupInfo() {
    return { lastExportAt: "", fileName: "", remindAfter: "" };
  }

  function validBackupTimestamp(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    const date = new Date(value);
    return value.slice(0, 4) !== "0000" && Number.isFinite(date.getTime()) && date.toISOString() === value;
  }

  function validateBackupInfo(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== BACKUP_FIELDS.length ||
      BACKUP_FIELDS.some(field => typeof value[field] !== "string")) {
      throw new Error("Неверная структура сведений о резервной копии.");
    }
    if (["lastExportAt", "remindAfter"].some(field => value[field] !== "" && !validBackupTimestamp(value[field]))) {
      throw new Error("Некорректная дата в сведениях о резервной копии.");
    }
    return Object.fromEntries(BACKUP_FIELDS.map(field => [field, value[field]]));
  }

  function createBackupTracker(storage) {
    function target() {
      const result = typeof storage === "function" ? storage() : storage;
      if (!result || typeof result.getItem !== "function" || typeof result.setItem !== "function") {
        throw new Error("Браузер не предоставил локальное хранилище.");
      }
      return result;
    }

    function readBackupInfo() {
      try {
        const raw = target().getItem(BACKUP_KEY);
        return { ok: true, info: raw === null ? emptyBackupInfo() : validateBackupInfo(JSON.parse(raw)) };
      } catch (error) {
        return { ok: false, info: emptyBackupInfo(), error: "Не удалось прочитать сведения о последней резервной копии. " + describe(error) };
      }
    }

    function recordBackupExport(value) {
      try {
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 ||
          !validBackupTimestamp(value.lastExportAt) || typeof value.fileName !== "string") {
          throw new Error("Укажите дату выгрузки в формате ISO UTC и имя файла.");
        }
        const info = validateBackupInfo({ lastExportAt: value.lastExportAt, fileName: value.fileName, remindAfter: "" });
        target().setItem(BACKUP_KEY, JSON.stringify(info));
        return { ok: true, info };
      } catch (error) {
        return { ok: false, info: emptyBackupInfo(), error: "Не удалось сохранить сведения о выгрузке резервной копии. " + describe(error) };
      }
    }

    function postponeBackupReminder(until) {
      const current = readBackupInfo();
      if (!current.ok) return current;
      try {
        if (!validBackupTimestamp(until)) throw new Error("Укажите дату напоминания в формате ISO UTC.");
        const info = { ...current.info, remindAfter: until };
        target().setItem(BACKUP_KEY, JSON.stringify(info));
        return { ok: true, info };
      } catch (error) {
        return { ok: false, info: current.info, error: "Не удалось отложить напоминание о резервной копии. " + describe(error) };
      }
    }

    return Object.freeze({ readBackupInfo, recordBackupExport, postponeBackupReminder });
  }

  function backupReminderDue(info, now, hasData) {
    if (typeof hasData !== "boolean") throw new Error("Наличие данных для резервного копирования должно быть указано явно.");
    if (!hasData) return false;
    if (!validBackupTimestamp(now)) return true;
    if (!info || typeof info !== "object" || Array.isArray(info)) return true;
    if (validBackupTimestamp(info.remindAfter) && info.remindAfter > now) return false;
    if (!validBackupTimestamp(info.lastExportAt) || info.lastExportAt > now) return true;
    return Date.parse(now) - Date.parse(info.lastExportAt) >= 7 * 86400000;
  }

  function summarizeBackup(bundle) {
    const visitDates = bundle.encounters.map(encounter => encounter.visitDate).filter(Boolean).sort();
    const patients = bundle.patients.map(patient => {
      const encounters = bundle.encounters.filter(encounter => encounter.patientId === patient.id);
      const dates = encounters.map(encounter => encounter.visitDate).filter(Boolean).sort();
      return { id: patient.id, label: patient.label, encounterCount: encounters.length, lastVisitDate: dates[dates.length - 1] || "" };
    });
    return {
      patientCount: bundle.patients.length,
      encounterCount: bundle.encounters.length,
      templateCount: (bundle.templates || []).length,
      investigationCount: bundle.patients.reduce((count, patient) => count + (patient.investigations || []).length, 0),
      sickLeaveCount: bundle.patients.reduce((count, patient) => {
        const journal = core.getSickLeaveJournal(patient, bundle.encounters);
        return count + journal.leaves.length + journal.legacy.length;
      }, 0),
      firstVisitDate: visitDates[0] || "",
      lastVisitDate: visitDates[visitDates.length - 1] || "",
      exportedAt: bundle.exportedAt,
      patients
    };
  }

  function createRepository(storage) {
    let checked = false;
    let blocked = null;
    let storedTemplates = [];

    function target() {
      const result = typeof storage === "function" ? storage() : storage;
      if (!result || typeof result.getItem !== "function" || typeof result.setItem !== "function") {
        throw new Error("Браузер не предоставил локальное хранилище.");
      }
      return result;
    }

    function load() {
      try {
        const storage = target();
        let raw = null;
        let migrated = false;
        for (const key of WATCHED_KEYS) {
          raw = storage.getItem(key);
          if (raw !== null) {
            migrated = key !== KEY;
            break;
          }
        }
        const { patients, encounters, templates = [] } = raw === null ? { patients: [], encounters: [] } : core.parseBundle(raw);
        storedTemplates = core.validateTemplates(templates);
        checked = true;
        blocked = null;
        return { patients, encounters, ...(templates.length ? { templates } : {}), error: null, ...(migrated ? { migrated: true } : {}) };
      } catch (error) {
        checked = true;
        blocked = "Не удалось прочитать локальное сохранение. Автоматическая запись остановлена, исходные данные не изменены. " + describe(error);
        return { patients: [], encounters: [], error: blocked };
      }
    }

    function save(encounters, patients, templates) {
      if (!checked) load();
      if (blocked) return { ok: false, error: blocked };
      try {
        const nextTemplates = templates === undefined ? storedTemplates : core.validateTemplates(templates);
        target().setItem(KEY, core.serializeBundle(encounters, patients, nextTemplates));
        storedTemplates = core.validateTemplates(nextTemplates);
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: "Не удалось сохранить данные в браузере. " + describe(error) };
      }
    }

    function reset(encounters = [], patients = [], templates = []) {
      try {
        const nextTemplates = core.validateTemplates(templates);
        target().setItem(KEY, core.serializeBundle(encounters, patients, nextTemplates));
        storedTemplates = nextTemplates;
        checked = true;
        blocked = null;
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: "Не удалось заменить локальное сохранение. " + describe(error) };
      }
    }

    return Object.freeze({ load, save, reset });
  }

  const repository = createRepository(() => root.localStorage);
  const backupTracker = createBackupTracker(() => root.localStorage);
  return Object.freeze({
    KEY, PREVIOUS_KEY, V2_KEY, LEGACY_KEY, WATCHED_KEYS, BACKUP_KEY,
    createRepository, load: repository.load, save: repository.save, reset: repository.reset,
    createBackupTracker, readBackupInfo: backupTracker.readBackupInfo, recordBackupExport: backupTracker.recordBackupExport,
    postponeBackupReminder: backupTracker.postponeBackupReminder, backupReminderDue, summarizeBackup
  });
});
