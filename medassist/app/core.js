(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./exam-options.js"));
  else root.MedAssistCore = factory(root.MedAssistExam);
})(typeof globalThis !== "undefined" ? globalThis : this, function (examCatalog) {
  "use strict";

  const FORMAT = "medassist-demo";
  const SCHEMA_VERSION = 3;
  const MAX_ENCOUNTERS = 500;
  const MAX_PATIENTS = 500;
  const MAX_PATIENT_LABEL_LENGTH = 120;
  const MAX_TEXT_LENGTH = 10000;
  const MAX_DRAFT_LENGTH = 100000;
  const MAX_FINGERPRINT_LENGTH = 350000;
  const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
  const PATIENT_FIELDS = ["id", "label", "createdAt", "updatedAt"];
  const CARRY_HISTORY_FIELDS = ["conditions", "medications", "allergies"];
  const LEGACY_GROUPS = {
    history: ["complaints", "onset", "course", "conditions", "medications", "allergies", "context"],
    exam: ["general", "cardiovascular", "respiratory", "abdomen", "neurological", "other"],
    vitals: ["systolic", "diastolic", "pulse", "temperature", "respiratoryRate", "spo2", "weight", "height"],
    assessment: ["summary", "plan", "followUp"],
    draft: ["text", "generatedAt", "sourceFingerprint"]
  };
  const NEW_ASSESSMENT_FIELDS = ["returnVisitDate", "sickLeaveIssued", "sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"];
  const GROUPS = {
    ...LEGACY_GROUPS,
    assessment: [...LEGACY_GROUPS.assessment, ...NEW_ASSESSMENT_FIELDS],
    examSelections: examCatalog.FIELDS.map(field => field.id)
  };
  const LEGACY_ROOT_FIELDS = ["id", "createdAt", "updatedAt", "visitDate", "age", "sex", "reason", ...Object.keys(LEGACY_GROUPS)];
  const V2_ROOT_FIELDS = ["id", "createdAt", "updatedAt", "visitDate", "age", "sex", "reason", ...Object.keys(GROUPS)];
  const ROOT_FIELDS = ["id", "patientId", ...V2_ROOT_FIELDS.slice(1)];
  const SEXES = { "": "не указано", female: "женский", male: "мужской", unspecified: "не указан" };

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }

  function validTimestamp(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    if (!validDate(value.slice(0, 10))) return false;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  }

  function localDate(date) {
    return [String(date.getFullYear()).padStart(4, "0"), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }

  function calculateBmi(weightKg, heightCm) {
    if ([weightKg, heightCm].some(value => typeof value !== "string" || !DECIMAL_PATTERN.test(value.trim()))) return "";
    const weight = Number(weightKg.trim().replace(",", "."));
    const height = Number(heightCm.trim().replace(",", "."));
    if (!Number.isFinite(weight) || !Number.isFinite(height) || weight <= 0 || height <= 0) return "";
    const bmi = weight / (height / 100) ** 2;
    if (!Number.isFinite(bmi)) return "";
    const rounded = bmi.toFixed(1);
    return Number(rounded) > 0 && !rounded.includes("e") ? rounded.replace(".", ",") : "";
  }

  function newId(prefix = "visit") {
    if (typeof globalThis.crypto?.randomUUID === "function") return prefix + "-" + globalThis.crypto.randomUUID();
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function validatePatient(patient) {
    const errors = [];
    if (!isObject(patient)) return [{ field: "patient", message: "Ожидается объект карточки пациента." }];
    for (const field of PATIENT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(patient, field)) errors.push({ field, message: "Обязательное поле отсутствует." });
      else if (typeof patient[field] !== "string") errors.push({ field, message: "Значение должно быть строкой." });
    }
    for (const field of Object.keys(patient)) {
      if (!PATIENT_FIELDS.includes(field)) errors.push({ field, message: "Неизвестное поле карточки пациента." });
    }
    if (typeof patient.id === "string" && !ID_PATTERN.test(patient.id)) errors.push({ field: "id", message: "Некорректный идентификатор карточки пациента." });
    if (typeof patient.label === "string" && patient.label.length > MAX_PATIENT_LABEL_LENGTH) errors.push({ field: "label", message: "Условное имя не должно превышать 120 символов." });
    for (const field of ["createdAt", "updatedAt"]) {
      if (typeof patient[field] === "string" && !validTimestamp(patient[field])) errors.push({ field, message: "Некорректная дата и время; ожидается формат ISO UTC." });
    }
    return errors;
  }

  function assertPatient(patient, prefix = "Некорректная карточка пациента") {
    const errors = validatePatient(patient);
    if (errors.length) throw new Error(prefix + ": " + errors.slice(0, 4).map(error => error.field + " — " + error.message).join("; "));
  }

  function createPatient(options = {}) {
    const now = options.now === undefined ? new Date() : new Date(options.now);
    if (!Number.isFinite(now.getTime()) || now.getFullYear() < 1 || now.getFullYear() > 9999) {
      throw new Error("Не удалось создать карточку пациента: некорректное время.");
    }
    const patient = {
      id: options.id === undefined ? newId("patient") : options.id,
      label: options.label === undefined ? "" : options.label,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    assertPatient(patient);
    return patient;
  }

  function createEncounter(options = {}) {
    const now = options.now === undefined ? new Date() : new Date(options.now);
    if (!Number.isFinite(now.getTime()) || now.getFullYear() < 1 || now.getFullYear() > 9999) {
      throw new Error("Не удалось создать приём: некорректное время.");
    }
    const id = options.id === undefined ? newId() : options.id;
    const encounter = {
      id,
      patientId: options.patientId === undefined ? id : options.patientId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      visitDate: localDate(now),
      age: "",
      sex: "",
      reason: ""
    };
    for (const [group, fields] of Object.entries(GROUPS)) {
      encounter[group] = Object.fromEntries(fields.map(field => [field, ""]));
    }
    assertEncounter(encounter);
    return encounter;
  }

  function createRepeatEncounter(source, options = {}) {
    assertEncounter(source);
    const fields = options.carryHistoryFields === undefined ? [] : options.carryHistoryFields;
    if (!Array.isArray(fields) || Array.from(fields).some(field => !CARRY_HISTORY_FIELDS.includes(field))) {
      throw new Error("Можно перенести только явно выбранные заболевания, препараты и аллергии.");
    }
    const encounter = createEncounter({ id: options.id, now: options.now, patientId: source.patientId });
    if (encounter.id === source.id) throw new Error("У повторного приёма должен быть новый идентификатор.");
    for (const field of fields) encounter.history[field] = source.history[field];
    return encounter;
  }

  function createDemoEncounter(options = {}) {
    const encounter = createEncounter(options);
    encounter.age = "36";
    encounter.sex = "female";
    encounter.history.complaints = "Вымышленный пример: ощущение усталости к концу дня.";
    encounter.history.onset = "В учебном сценарии жалоба появилась несколько дней назад.";
    encounter.history.course = "Поле заполнено для демонстрации структуры анамнеза.";
    encounter.history.conditions = "Демонстрационные сведения не внесены.";
    encounter.history.medications = "Демонстрационные сведения не внесены.";
    encounter.history.allergies = "Демонстрационные сведения не внесены.";
    encounter.history.context = "Персонаж вымышленный. Данные не относятся к реальному пациенту.";
    encounter.exam.general = "Учебная запись общего осмотра: описание врач может изменить вручную.";
    encounter.vitals.systolic = "120";
    encounter.vitals.diastolic = "80";
    encounter.vitals.pulse = "72";
    encounter.vitals.temperature = "36,6";
    encounter.assessment.summary = "Демонстрация поля диагноза. Клинический вывод не сформирован.";
    encounter.assessment.plan = "Демонстрация поля рекомендаций. Назначения и рекомендации отсутствуют.";
    return encounter;
  }

  function validateEncounter(encounter) {
    return validateEncounterVersion(encounter, SCHEMA_VERSION);
  }

  function validateEncounterVersion(encounter, version) {
    const groups = version === 1 ? LEGACY_GROUPS : GROUPS;
    const rootFields = version === 1 ? LEGACY_ROOT_FIELDS : version === 2 ? V2_ROOT_FIELDS : ROOT_FIELDS;
    const errors = [];
    function problem(field, message) { errors.push({ field, message }); }
    function shape(value, fields, prefix) {
      if (!isObject(value)) {
        problem(prefix || "encounter", "Ожидается объект с полями приёма.");
        return false;
      }
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(value, field)) problem(prefix ? prefix + "." + field : field, "Обязательное поле отсутствует.");
      }
      for (const field of Object.keys(value)) {
        if (!fields.includes(field)) problem(prefix ? prefix + "." + field : field, "Неизвестное поле для версии данных " + version + ".");
      }
      return true;
    }
    function string(value, field, limit = MAX_TEXT_LENGTH) {
      if (typeof value !== "string") {
        problem(field, "Значение должно быть строкой.");
        return false;
      }
      if (value.length > limit) {
        problem(field, "Превышен лимит: " + limit + " символов.");
        return false;
      }
      return true;
    }
    function numeric(value, field) {
      if (typeof value !== "string" || value.trim() === "") return;
      const input = value.trim();
      if (!DECIMAL_PATTERN.test(input) || !Number.isFinite(Number(input.replace(",", ".")))) {
        problem(field, "Введите конечное число; десятичный разделитель — точка или запятая.");
      } else if (Number(input.replace(",", ".")) < 0) {
        problem(field, "Значение не может быть отрицательным.");
      }
    }
    if (!shape(encounter, rootFields, "")) return errors;
    for (const field of ["id", "createdAt", "updatedAt", "visitDate", "age", "sex", "reason"]) string(encounter[field], field);
    if (typeof encounter.id === "string" && !ID_PATTERN.test(encounter.id)) {
      problem("id", "Идентификатор должен содержать 1–80 латинских букв, цифр, дефисов или подчёркиваний и начинаться с буквы или цифры.");
    }
    if (version >= 3 && string(encounter.patientId, "patientId") && !ID_PATTERN.test(encounter.patientId)) {
      problem("patientId", "Некорректный идентификатор карточки пациента.");
    }
    for (const field of ["createdAt", "updatedAt"]) {
      if (typeof encounter[field] === "string" && !validTimestamp(encounter[field])) problem(field, "Некорректная дата и время; ожидается формат ISO UTC.");
    }
    if (typeof encounter.visitDate === "string" && encounter.visitDate !== "" && !validDate(encounter.visitDate)) {
      problem("visitDate", "Укажите существующую дату в формате ГГГГ-ММ-ДД.");
    }
    if (typeof encounter.sex === "string" && !Object.prototype.hasOwnProperty.call(SEXES, encounter.sex)) problem("sex", "Неизвестное значение поля пола.");
    numeric(encounter.age, "age");
    if (typeof encounter.age === "string" && encounter.age.trim() !== "" && Number.isFinite(Number(encounter.age.replace(",", "."))) && !Number.isInteger(Number(encounter.age.replace(",", ".")))) {
      problem("age", "Укажите возраст целым числом полных лет.");
    }
    for (const [group, fields] of Object.entries(groups)) {
      if (!shape(encounter[group], fields, group)) continue;
      for (const field of fields) {
        const limit = group === "draft" && field === "text" ? MAX_DRAFT_LENGTH : group === "draft" && field === "sourceFingerprint" ? MAX_FINGERPRINT_LENGTH : MAX_TEXT_LENGTH;
        string(encounter[group][field], group + "." + field, limit);
        if (group === "vitals") numeric(encounter[group][field], group + "." + field);
      }
    }
    if (version >= 2 && isObject(encounter.examSelections)) {
      for (const field of examCatalog.FIELDS) {
        const value = encounter.examSelections[field.id];
        if (typeof value === "string" && value !== "" && !field.options.some(option => option.value === value)) {
          problem("examSelections." + field.id, "Неизвестный вариант осмотра.");
        }
      }
    }
    if (version >= 2 && isObject(encounter.assessment)) {
      const assessment = encounter.assessment;
      if (typeof assessment.sickLeaveIssued === "string" && !["", "no", "yes"].includes(assessment.sickLeaveIssued)) {
        problem("assessment.sickLeaveIssued", "Выберите, выдавался ли листок нетрудоспособности.");
      }
      for (const field of ["returnVisitDate", "sickLeaveFrom", "sickLeaveTo"]) {
        if (typeof assessment[field] === "string" && assessment[field] !== "" && !validDate(assessment[field])) {
          problem("assessment." + field, "Укажите существующую дату в формате ГГГГ-ММ-ДД.");
        }
      }
      if (assessment.sickLeaveIssued === "yes" && validDate(assessment.sickLeaveFrom) && validDate(assessment.sickLeaveTo) && assessment.sickLeaveFrom > assessment.sickLeaveTo) {
        problem("assessment.sickLeaveTo", "Дата окончания не может быть раньше даты начала.");
      }
    }
    if (isObject(encounter.draft) && typeof encounter.draft.generatedAt === "string" && encounter.draft.generatedAt !== "" && !validTimestamp(encounter.draft.generatedAt)) {
      problem("draft.generatedAt", "Некорректная дата генерации черновика.");
    }
    return errors;
  }

  function assertEncounter(encounter, prefix = "Некорректные данные приёма", version = SCHEMA_VERSION) {
    const errors = validateEncounterVersion(encounter, version);
    if (errors.length) throw new Error(prefix + ": " + errors.slice(0, 4).map(error => error.field + " — " + error.message).join("; "));
  }

  function sourceData(encounter) {
    const source = {};
    for (const field of ["visitDate", "age", "sex", "reason"]) source[field] = encounter[field];
    for (const group of ["history", "exam", "examSelections", "vitals", "assessment"]) {
      source[group] = Object.fromEntries(GROUPS[group].map(field => [field, encounter[group][field]]));
    }
    return source;
  }

  function fingerprint(encounter) {
    assertEncounter(encounter);
    return JSON.stringify(sourceData(encounter));
  }

  function generateDraft(encounter) {
    assertEncounter(encounter);
    function text(value) { return value.trim() || "не заполнено"; }
    function line(label, value, unit = "") { return label + ": " + (value.trim() ? value.trim() + unit : "не заполнено") + "."; }
    function formatDate(value) { return value.split("-").reverse().join("."); }
    function optional(label, value) { return value.trim() ? [label + ": " + value.trim()] : []; }
    function examText(section) {
      const selections = examCatalog.FIELDS.filter(field => field.section === section)
        .filter(field => encounter.examSelections[field.id] !== "")
        .map(field => field.options.find(option => option.value === encounter.examSelections[field.id]))
        .filter(Boolean)
        .map(option => option.text.replace(/[.\s]+$/, "") + ".");
      if (encounter.exam[section].trim()) selections.push(encounter.exam[section].trim());
      return selections.join(" ") || "не заполнено";
    }
    function sickLeave() {
      const assessment = encounter.assessment;
      if (assessment.sickLeaveIssued !== "yes") return [];
      const period = [];
      if (assessment.sickLeaveFrom) period.push("с " + formatDate(assessment.sickLeaveFrom));
      if (assessment.sickLeaveTo) period.push("по " + formatDate(assessment.sickLeaveTo));
      return ["Листок нетрудоспособности: выдан."
        + (assessment.sickLeaveNumber.trim() ? " № " + assessment.sickLeaveNumber.trim() + "." : "")
        + (period.length ? " Период: " + period.join(" ") + "." : "")];
    }
    const date = encounter.visitDate ? formatDate(encounter.visitDate) : "не указана";
    const bmi = calculateBmi(encounter.vitals.weight, encounter.vitals.height);
    const draft = [
      "МЕДАССИСТЕНТ · ДЕМОНСТРАЦИОННЫЙ ЧЕРНОВИК",
      "Только вымышленные данные. Неофициальный шаблон; не является нормативной формой Республики Беларусь.",
      "Автоматически собран из введённых полей. Требует проверки и редактирования врачом.",
      "",
      "Демо-пациент. Дата приёма: " + date + ".",
      line("Возраст (полных лет)", encounter.age),
      "Пол: " + SEXES[encounter.sex] + ".",
      "",
      "АНАМНЕЗ",
      "Жалобы: " + text(encounter.history.complaints),
      "Начало симптомов: " + text(encounter.history.onset),
      "Течение: " + text(encounter.history.course),
      "Известные заболевания: " + text(encounter.history.conditions),
      "Принимаемые препараты на постоянной основе: " + text(encounter.history.medications),
      "Аллергии и реакции: " + text(encounter.history.allergies),
      ...optional("Дополнительный анамнез", encounter.history.context),
      "",
      "ОСМОТР",
      "Общий осмотр: " + examText("general"),
      "Сердечно-сосудистая система: " + examText("cardiovascular"),
      "Дыхательная система: " + examText("respiratory"),
      "Живот: " + examText("abdomen"),
      "Неврологический статус: " + examText("neurological"),
      ...optional("Другие данные осмотра", encounter.exam.other),
      "",
      "ПОКАЗАТЕЛИ",
      line("Систолическое АД", encounter.vitals.systolic, " мм рт. ст."),
      line("Диастолическое АД", encounter.vitals.diastolic, " мм рт. ст."),
      line("Пульс", encounter.vitals.pulse, " уд/мин"),
      line("Температура", encounter.vitals.temperature, " °C"),
      line("Частота дыхания", encounter.vitals.respiratoryRate, " в мин"),
      line("SpO₂", encounter.vitals.spo2, " %"),
      line("Масса тела", encounter.vitals.weight, " кг"),
      line("Рост", encounter.vitals.height, " см"),
      ...(bmi ? ["Индекс массы тела: " + bmi + " кг/м²."] : []),
      "",
      "ЗАКЛЮЧЕНИЕ",
      "Диагноз: " + text(encounter.assessment.summary),
      ...optional("Рекомендации", encounter.assessment.plan),
      ...optional("Наблюдение (из предыдущей версии)", encounter.assessment.followUp),
      ...sickLeave(),
      ...optional("Повторный приём", encounter.assessment.returnVisitDate ? formatDate(encounter.assessment.returnVisitDate) : "")
    ].join("\n");
    if (draft.length > MAX_DRAFT_LENGTH) throw new Error("Черновик превышает 100000 символов. Сократите текст в полях приёма и повторите генерацию.");
    return draft;
  }

  function normalizeEncounter(encounter, version = SCHEMA_VERSION) {
    const groups = version === 1 ? LEGACY_GROUPS : GROUPS;
    const rootFields = version === 1 ? LEGACY_ROOT_FIELDS : version === 2 ? V2_ROOT_FIELDS : ROOT_FIELDS;
    const result = {};
    for (const field of rootFields) {
      result[field] = Object.prototype.hasOwnProperty.call(groups, field)
        ? Object.fromEntries(groups[field].map(key => [key, encounter[field][key]]))
        : encounter[field];
    }
    return result;
  }

  function validateBundle(value) {
    return validateBundleVersion(value, SCHEMA_VERSION);
  }

  function validateBundleVersion(value, version) {
    if (!isObject(value)) throw new Error("Резервная копия должна быть объектом JSON.");
    const fields = ["format", "schemaVersion", "exportedAt", ...(version >= 3 ? ["patients"] : []), "encounters"];
    if (Object.keys(value).some(field => !fields.includes(field)) || fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))) {
      throw new Error("Неверная структура резервной копии: ожидаются " + fields.join(", ") + ".");
    }
    if (value.format !== FORMAT) throw new Error("Этот файл не является резервной копией МедАссистента.");
    if (value.schemaVersion !== version) throw new Error("Неподдерживаемая версия данных. Поддерживается версия 3 и импорт резервных копий версий 1 и 2.");
    if (typeof value.exportedAt !== "string" || !validTimestamp(value.exportedAt)) throw new Error("В резервной копии указана некорректная дата экспорта.");
    const patientIds = new Set();
    let patients;
    if (version >= 3) {
      if (!Array.isArray(value.patients)) throw new Error("Список карточек пациентов в резервной копии должен быть массивом.");
      if (value.patients.length > MAX_PATIENTS) throw new Error("В одном файле допускается не более 500 демонстрационных карточек пациентов.");
      patients = value.patients.map((patient, index) => {
        assertPatient(patient, "Карточка пациента №" + (index + 1));
        if (patientIds.has(patient.id)) throw new Error("В резервной копии повторяется идентификатор карточки пациента №" + (index + 1) + ".");
        patientIds.add(patient.id);
        return Object.fromEntries(PATIENT_FIELDS.map(field => [field, patient[field]]));
      });
    }
    if (!Array.isArray(value.encounters)) throw new Error("Список приёмов в резервной копии должен быть массивом.");
    if (value.encounters.length > MAX_ENCOUNTERS) throw new Error("В одном файле допускается не более 500 демонстрационных приёмов.");
    const ids = new Set();
    const encounters = value.encounters.map((encounter, index) => {
      assertEncounter(encounter, "Приём №" + (index + 1), version);
      if (ids.has(encounter.id)) throw new Error("В резервной копии повторяется идентификатор приёма №" + (index + 1) + ".");
      ids.add(encounter.id);
      if (version >= 3 && !patientIds.has(encounter.patientId)) throw new Error("Для приёма №" + (index + 1) + " отсутствует карточка пациента.");
      return normalizeEncounter(encounter, version);
    });
    return { format: FORMAT, schemaVersion: version, exportedAt: value.exportedAt, ...(version >= 3 ? { patients } : {}), encounters };
  }

  function serializeBundle(encounters, patients) {
    return JSON.stringify(validateBundle({ format: FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), patients, encounters }), null, 2);
  }

  function parseBundle(text) {
    if (typeof text !== "string") throw new Error("Содержимое резервной копии должно быть текстом JSON.");
    let parsed;
    try { parsed = JSON.parse(text.replace(/^\uFEFF/, "")); }
    catch { throw new Error("Не удалось прочитать JSON. Файл повреждён или имеет другой формат."); }
    if (isObject(parsed) && [1, 2].includes(parsed.schemaVersion)) {
      const legacy = validateBundleVersion(parsed, parsed.schemaVersion);
      const encounters = legacy.encounters.map(encounter => ({
        ...encounter,
        patientId: encounter.id,
        ...(legacy.schemaVersion === 1 ? {
          assessment: { ...encounter.assessment, ...Object.fromEntries(NEW_ASSESSMENT_FIELDS.map(field => [field, ""])) },
          examSelections: Object.fromEntries(GROUPS.examSelections.map(field => [field, ""]))
        } : {})
      }));
      const patients = legacy.encounters.map(encounter => ({ id: encounter.id, label: "", createdAt: encounter.createdAt, updatedAt: encounter.updatedAt }));
      return validateBundle({ ...legacy, schemaVersion: SCHEMA_VERSION, patients, encounters });
    }
    return validateBundle(parsed);
  }

  return Object.freeze({ createPatient, createEncounter, createRepeatEncounter, createDemoEncounter, calculateBmi, generateDraft, fingerprint, validatePatient, validateEncounter, validateBundle, serializeBundle, parseBundle, MAX_ENCOUNTERS, MAX_PATIENTS, MAX_PATIENT_LABEL_LENGTH, MAX_TEXT_LENGTH, MAX_DRAFT_LENGTH, SCHEMA_VERSION });
});
