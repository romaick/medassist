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

  function describe(error) {
    return error instanceof Error ? error.message : String(error);
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
  return Object.freeze({ KEY, PREVIOUS_KEY, V2_KEY, LEGACY_KEY, WATCHED_KEYS, createRepository, load: repository.load, save: repository.save, reset: repository.reset });
});
