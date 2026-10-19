(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"), root);
  else root.MedAssistStorage = factory(root.MedAssistCore, root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, root) {
  "use strict";
  const KEY = "medassist.demo.v3";
  const PREVIOUS_KEY = "medassist.demo.v2";
  const LEGACY_KEY = "medassist.demo.v1";

  function describe(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function createRepository(storage) {
    let checked = false;
    let blocked = null;

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
        let raw = storage.getItem(KEY);
        let migrated = false;
        if (raw === null) {
          raw = storage.getItem(PREVIOUS_KEY);
          migrated = raw !== null;
        }
        if (raw === null) {
          raw = storage.getItem(LEGACY_KEY);
          migrated = raw !== null;
        }
        const { patients, encounters } = raw === null ? { patients: [], encounters: [] } : core.parseBundle(raw);
        checked = true;
        blocked = null;
        return migrated ? { patients, encounters, error: null, migrated: true } : { patients, encounters, error: null };
      } catch (error) {
        checked = true;
        blocked = "Не удалось прочитать локальное сохранение. Автоматическая запись остановлена, исходные данные не изменены. " + describe(error);
        return { patients: [], encounters: [], error: blocked };
      }
    }

    function save(encounters, patients) {
      if (!checked) load();
      if (blocked) return { ok: false, error: blocked };
      try {
        target().setItem(KEY, core.serializeBundle(encounters, patients));
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: "Не удалось сохранить данные в браузере. " + describe(error) };
      }
    }

    function reset(encounters = [], patients = []) {
      try {
        target().setItem(KEY, core.serializeBundle(encounters, patients));
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
  return Object.freeze({ KEY, PREVIOUS_KEY, LEGACY_KEY, createRepository, load: repository.load, save: repository.save, reset: repository.reset });
});
