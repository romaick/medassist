(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"), root);
  else root.MedAssistStorage = factory(root.MedAssistCore, root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, root) {
  "use strict";
  const KEY = "medassist.demo.v2";
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
      if (blocked) return { encounters: [], error: blocked };
      try {
        const storage = target();
        let raw = storage.getItem(KEY);
        let migrated = false;
        if (raw === null) {
          raw = storage.getItem(LEGACY_KEY);
          migrated = raw !== null;
        }
        const encounters = raw === null ? [] : core.parseBundle(raw).encounters;
        checked = true;
        return migrated ? { encounters, error: null, migrated: true } : { encounters, error: null };
      } catch (error) {
        checked = true;
        blocked = "Не удалось прочитать локальное сохранение. Автоматическая запись остановлена, исходные данные не изменены. " + describe(error);
        return { encounters: [], error: blocked };
      }
    }

    function save(encounters) {
      if (!checked) load();
      if (blocked) return { ok: false, error: blocked };
      try {
        target().setItem(KEY, core.serializeBundle(encounters));
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: "Не удалось сохранить данные в браузере. " + describe(error) };
      }
    }

    function reset(encounters = []) {
      try {
        target().setItem(KEY, core.serializeBundle(encounters));
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
  return Object.freeze({ KEY, LEGACY_KEY, createRepository, load: repository.load, save: repository.save, reset: repository.reset });
});
