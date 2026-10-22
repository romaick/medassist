(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./exam-options.js"));
  else root.MedAssistCore = factory(root.MedAssistExam);
})(typeof globalThis !== "undefined" ? globalThis : this, function (examCatalog) {
  "use strict";

  const FORMAT = "medassist-demo";
  const SCHEMA_VERSION = 4;
  const MAX_ENCOUNTERS = 500;
  const MAX_PATIENTS = 500;
  const MAX_PATIENT_LABEL_LENGTH = 120;
  const MAX_PERSONAL_NOTE_LENGTH = 5000;
  const MAX_SICK_LEAVES = 100;
  const MAX_SICK_LEAVE_EVENTS = 100;
  const MAX_SICK_LEAVE_NUMBER_LENGTH = 120;
  const MAX_TEMPLATES = 100;
  const MAX_TEMPLATE_NAME_LENGTH = 120;
  const MAX_SHORTCUTS = 100;
  const MAX_SHORTCUT_CODE_LENGTH = 40;
  const MAX_SHORTCUT_TEXT_LENGTH = 10000;
  const MAX_PRESCRIPTIONS = 50;
  const MAX_PRESCRIPTION_FIELD_LENGTH = 200;
  const MAX_PRESCRIPTION_NOTE_LENGTH = 1000;
  const MAX_DIAGNOSES = 30;
  const MAX_DIAGNOSIS_TEXT_LENGTH = 10000;
  const MAX_DIAGNOSIS_SUMMARY_LENGTH = 100000;
  const MAX_INVESTIGATIONS = 500;
  const MAX_INVESTIGATION_REPORT_FIELDS = 100;
  const INVESTIGATION_FIELD_LIMITS = Object.freeze({ name: 200, result: 2000, unit: 80, reference: 500, note: 1000 });
  const MAX_TEXT_LENGTH = 10000;
  const MAX_DRAFT_LENGTH = 100000;
  const MAX_FINGERPRINT_LENGTH = 350000;
  const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
  const PATIENT_FIELDS = ["id", "label", "createdAt", "updatedAt"];
  const CARRY_HISTORY_FIELDS = ["conditions", "medications", "allergies"];
  const PRESCRIPTION_VALUE_FIELDS = ["name", "dose", "route", "frequency", "duration", "note"];
  const PRESCRIPTION_FIELDS = ["id", ...PRESCRIPTION_VALUE_FIELDS];
  const DIAGNOSIS_FIELDS = ["id", "kind", "text"];
  const DIAGNOSIS_LABELS = Object.freeze({ primary: "Основной диагноз", comorbidity: "Сопутствующее заболевание", complication: "Осложнение" });
  const INVESTIGATION_VALUE_FIELDS = ["kind", "date", "name", "result", "unit", "reference", "note"];
  const INVESTIGATION_FIELDS = ["id", ...INVESTIGATION_VALUE_FIELDS];
  const INVESTIGATION_REPORT_FIELDS = ["reportId", "reportTitle", "panelId", "fieldId"];
  const INVESTIGATION_REPORT_ROW_FIELDS = ["fieldId", "name", "result", "unit", "reference", "note"];
  const LEGACY_GROUPS = {
    history: ["complaints", "onset", "course", "conditions", "medications", "allergies", "context"],
    exam: ["general", "cardiovascular", "respiratory", "abdomen", "neurological", "other"],
    vitals: ["systolic", "diastolic", "pulse", "temperature", "respiratoryRate", "spo2", "weight", "height"],
    assessment: ["summary", "plan", "followUp"],
    draft: ["text", "generatedAt", "sourceFingerprint"]
  };
  const NEW_ASSESSMENT_FIELDS = ["returnVisitDate", "sickLeaveIssued", "sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"];
  const V2_GROUPS = {
    ...LEGACY_GROUPS,
    assessment: [...LEGACY_GROUPS.assessment, ...NEW_ASSESSMENT_FIELDS],
    examSelections: examCatalog.FIELDS.map(field => field.id)
  };
  const GROUPS = { ...V2_GROUPS, workflow: ["reviewStatus", "reviewedAt", "returnVisitStatus", "returnVisitEncounterId"] };
  const LEGACY_ROOT_FIELDS = ["id", "createdAt", "updatedAt", "visitDate", "age", "sex", "reason", ...Object.keys(LEGACY_GROUPS)];
  const V2_ROOT_FIELDS = ["id", "createdAt", "updatedAt", "visitDate", "age", "sex", "reason", ...Object.keys(V2_GROUPS)];
  const V3_ROOT_FIELDS = ["id", "patientId", ...V2_ROOT_FIELDS.slice(1)];
  const ROOT_FIELDS = [...V3_ROOT_FIELDS, "workflow"];
  const SEXES = { "": "не указано", female: "женский", male: "мужской", unspecified: "не указан" };
  const RECORD_SECTIONS = Object.freeze(["history", "exam", "investigations", "diagnosis", "recommendations", "sickLeave"]);
  const DEFAULT_RECORD_FORMAT = Object.freeze({
    order: RECORD_SECTIONS,
    titles: Object.freeze({ history: "АНАМНЕЗ", exam: "ОСМОТР", investigations: "ИССЛЕДОВАНИЯ", diagnosis: "Диагноз", recommendations: "Рекомендации", sickLeave: "Листок нетрудоспособности", returnVisit: "Повторный приём" }),
    headings: true,
    examStyle: "lines",
    recommendationsStyle: "paragraph",
    shortLabels: false
  });

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validateRecordFormat(value) {
    const fields = Object.keys(DEFAULT_RECORD_FORMAT);
    const titleFields = Object.keys(DEFAULT_RECORD_FORMAT.titles);
    if (!isObject(value) || Object.keys(value).some(field => !fields.includes(field)) || fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))) throw new Error("Неверная структура настроек врачебной записи.");
    if (!Array.isArray(value.order) || value.order.length !== RECORD_SECTIONS.length || new Set(value.order).size !== RECORD_SECTIONS.length || RECORD_SECTIONS.some(section => !value.order.includes(section))) throw new Error("В порядке разделов должны быть все разделы без повторений. Повторный приём всегда находится в конце.");
    if (!isObject(value.titles) || Object.keys(value.titles).some(field => !titleFields.includes(field)) || titleFields.some(field => !Object.prototype.hasOwnProperty.call(value.titles, field) || typeof value.titles[field] !== "string" || !value.titles[field].trim() || value.titles[field].length > 80 || /[\r\n\u2028\u2029]/.test(value.titles[field]))) throw new Error("Название каждого раздела должно содержать от 1 до 80 символов без переноса строки.");
    if (typeof value.headings !== "boolean" || typeof value.shortLabels !== "boolean" || !["lines", "paragraph"].includes(value.examStyle) || !["paragraph", "list"].includes(value.recommendationsStyle)) throw new Error("Некорректные варианты оформления врачебной записи.");
    return {
      order: [...value.order],
      titles: Object.fromEntries(titleFields.map(field => [field, value.titles[field].trim()])),
      headings: value.headings,
      examStyle: value.examStyle,
      recommendationsStyle: value.recommendationsStyle,
      shortLabels: value.shortLabels
    };
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

  // CKD-EPI 2021 by creatinine, without race: Inker LA et al. N Engl J Med 2021;385:1737-1749.
  // Categories G1-G5 follow KDIGO 2024. Inputs are the strings typed by the doctor; nothing is stored.
  const CREATININE_UMOL_PER_MG = 88.4;
  const EGFR_LIMITS = Object.freeze({ age: [18, 120], umol: [20, 3000], mg: [0.2, 34] });
  const EGFR_CATEGORIES = Object.freeze([
    [90, "G1", "нормальная или высокая"], [60, "G2", "незначительно снижена"], [45, "G3a", "умеренно снижена"],
    [30, "G3b", "существенно снижена"], [15, "G4", "резко снижена"], [0, "G5", "почечная недостаточность"]
  ]);

  function calculateEgfrCkdEpi2021(input) {
    const values = isObject(input) ? input : {};
    const text = key => typeof values[key] === "string" ? values[key].trim() : "";
    const errors = {}, missing = [];
    const unit = values.unit === "mg" ? "mg" : "umol";
    const ageText = text("age"), creatinineText = text("creatinine");
    if (!ageText) missing.push("age");
    else if (!/^\d{1,3}$/.test(ageText) || Number(ageText) < EGFR_LIMITS.age[0] || Number(ageText) > EGFR_LIMITS.age[1]) {
      errors.age = "Возраст — целое число лет от 18 до 120: формула предназначена для взрослых.";
    }
    if (!["female", "male"].includes(values.sex)) missing.push("sex");
    const [low, high] = EGFR_LIMITS[unit];
    if (!creatinineText) missing.push("creatinine");
    else if (!DECIMAL_PATTERN.test(creatinineText) || !(Number(creatinineText.replace(",", ".")) >= low && Number(creatinineText.replace(",", ".")) <= high)) {
      errors.creatinine = unit === "mg" ? "Креатинин — число от 0,2 до 34 мг/дл." : "Креатинин — число от 20 до 3000 мкмоль/л.";
    }
    if (missing.length || Object.keys(errors).length) return { result: null, errors, missing };
    const female = values.sex === "female";
    const kappa = female ? 0.7 : 0.9;
    const alpha = female ? -0.241 : -0.302;
    const creatinine = Number(creatinineText.replace(",", "."));
    const ratio = (unit === "mg" ? creatinine : creatinine / CREATININE_UMOL_PER_MG) / kappa;
    const exact = 142 * Math.min(ratio, 1) ** alpha * Math.max(ratio, 1) ** -1.2 * 0.9938 ** Number(ageText) * (female ? 1.012 : 1);
    const value = Math.round(exact);
    const [, code, label] = EGFR_CATEGORIES.find(([from]) => value >= from);
    return { result: { value, exact, category: code, categoryLabel: label }, errors, missing };
  }

  // Cockcroft DW, Gault MH. Nephron 1976;16(1):31-41: CrCl, mL/min = (140 - age) x weight, kg / (72 x Scr, mg/100 mL), 15% less in women.
  // Actual body weight as in the original; the result is not normalised to body surface area. Age, sex and creatinine are checked as for eGFR.
  const WEIGHT_LIMITS_KG = Object.freeze([20, 300]);

  function calculateCockcroftGault(input) {
    const values = isObject(input) ? input : {};
    const base = calculateEgfrCkdEpi2021(values);
    const errors = { ...base.errors }, missing = [...base.missing];
    const weightText = typeof values.weight === "string" ? values.weight.trim() : "";
    const weight = Number(weightText.replace(",", "."));
    if (!weightText) missing.push("weight");
    else if (!DECIMAL_PATTERN.test(weightText) || !(weight >= WEIGHT_LIMITS_KG[0] && weight <= WEIGHT_LIMITS_KG[1])) errors.weight = "Масса тела — число от 20 до 300 кг.";
    if (missing.length || Object.keys(errors).length) return { result: null, errors, missing };
    const creatinine = Number(values.creatinine.trim().replace(",", "."));
    const milligrams = values.unit === "mg" ? creatinine : creatinine / CREATININE_UMOL_PER_MG;
    const exact = (140 - Number(values.age.trim())) * weight / (72 * milligrams) * (values.sex === "female" ? 0.85 : 1);
    return { result: { value: Math.round(exact), exact }, errors, missing };
  }

  // CHA2DS2-VASc: Lip GY et al. Chest 2010;137(2):263-272. CHA2DS2-VA is the same score without sex (ESC 2024 AF guideline,
  // Van Gelder IC et al. Eur Heart J 2024;45(36):3314-3414): 2 or more - anticoagulation recommended, 1 - should be considered.
  function scoreChadsVasc(input) {
    const values = isObject(input) ? input : {};
    const ageText = typeof values.age === "string" ? values.age.trim() : "";
    const errors = {}, missing = [];
    if (!ageText) missing.push("age");
    else if (!/^\d{1,3}$/.test(ageText) || Number(ageText) < 18 || Number(ageText) > 120) errors.age = "Возраст — целое число лет от 18 до 120.";
    if (!["female", "male"].includes(values.sex)) missing.push("sex");
    if (missing.length || Object.keys(errors).length) return { result: null, errors, missing };
    const age = Number(ageText);
    const points = {
      chf: values.chf === true ? 1 : 0, hypertension: values.hypertension === true ? 1 : 0, age75: age >= 75 ? 2 : 0,
      diabetes: values.diabetes === true ? 1 : 0, stroke: values.stroke === true ? 2 : 0, vascular: values.vascular === true ? 1 : 0,
      age65: age >= 65 && age < 75 ? 1 : 0
    };
    const factors = Object.keys(points).filter(key => points[key] > 0);
    const va = factors.reduce((sum, key) => sum + points[key], 0);
    const female = values.sex === "female";
    return { result: { va, vasc: va + (female ? 1 : 0), factors, female, recommendation: va >= 2 ? "recommended" : va === 1 ? "consider" : "none" }, errors, missing };
  }

  // HAS-BLED: Pisters R et al. Chest 2010;138(5):1093-1100. One point per item, 0-9; 3 or more marks a high bleeding risk.
  const HAS_BLED_ITEMS = Object.freeze(["hypertension", "renal", "liver", "stroke", "bleeding", "labileInr", "elderly", "drugs", "alcohol"]);

  function scoreHasBled(input) {
    const values = isObject(input) ? input : {};
    const factors = HAS_BLED_ITEMS.filter(key => values[key] === true);
    return { result: { score: factors.length, factors, high: factors.length >= 3 }, errors: {}, missing: [] };
  }

  // CRB-65: Lim WS et al. Thorax 2003;58(5):377-382. Risk bands of 30-day mortality as in NICE NG250 (2025).
  const CRB65_ITEMS = Object.freeze(["confusion", "respiratory", "pressure", "age65"]);

  function scoreCrb65(input) {
    const values = isObject(input) ? input : {};
    const factors = CRB65_ITEMS.filter(key => values[key] === true);
    const score = factors.length;
    return { result: { score, factors, risk: score === 0 ? "low" : score <= 2 ? "intermediate" : "high" }, errors: {}, missing: [] };
  }

  // Centor RM et al. Med Decis Making 1981;1(3):239-246, interpreted as in NICE NG84 (2018).
  // McIsaac WJ et al. CMAJ 1998;158(1):75-83 adds an age modifier: 3-14 years +1, 15-44 years 0, 45 and older -1.
  const CENTOR_ITEMS = Object.freeze(["exudate", "nodes", "fever", "noCough"]);
  const MCISAAC_AGE_POINTS = Object.freeze({ child: 1, young: 0, older: -1 });

  function scoreCentor(input) {
    const values = isObject(input) ? input : {};
    const factors = CENTOR_ITEMS.filter(key => values[key] === true);
    const centor = factors.length;
    const ageGroup = Object.prototype.hasOwnProperty.call(MCISAAC_AGE_POINTS, values.ageGroup) ? values.ageGroup : "";
    return { result: { centor, mcIsaac: ageGroup ? centor + MCISAAC_AGE_POINTS[ageGroup] : null, ageGroup, factors, likely: centor >= 3 }, errors: {}, missing: ageGroup ? [] : ["ageGroup"] };
  }

  // Reads one typed number for a calculator: empty goes to missing, a malformed or out-of-range value to errors.
  function readCalculatorNumber(values, key, [low, high], integer, message, errors, missing) {
    const text = typeof values[key] === "string" ? values[key].trim() : "";
    if (!text) { missing.push(key); return null; }
    const number = Number(text.replace(",", "."));
    if (!(integer ? /^\d{1,4}$/.test(text) : DECIMAL_PATTERN.test(text)) || !(number >= low && number <= high)) { errors[key] = message; return null; }
    return number;
  }

  // FIB-4: Sterling RK et al. Hepatology 2006;43(6):1317-1325: age x AST / (platelets, 10^9/L x sqrt(ALT)).
  // Advanced fibrosis thresholds 1.30 and 2.67 (Shah AG et al. Clin Gastroenterol Hepatol 2009;7:1104-1112);
  // at 65 and older the lower threshold is 2.0 and the upper one is unchanged (McPherson S et al. Am J Gastroenterol 2017;112:740-751).
  function calculateFib4(input) {
    const values = isObject(input) ? input : {};
    const errors = {}, missing = [];
    const age = readCalculatorNumber(values, "age", [18, 120], true, "Возраст — целое число лет от 18 до 120.", errors, missing);
    const ast = readCalculatorNumber(values, "ast", [1, 10000], false, "АСТ — число от 1 до 10 000 Ед/л.", errors, missing);
    const alt = readCalculatorNumber(values, "alt", [1, 10000], false, "АЛТ — число от 1 до 10 000 Ед/л.", errors, missing);
    const platelets = readCalculatorNumber(values, "platelets", [1, 2000], false, "Тромбоциты — число от 1 до 2000 × 10⁹/л.", errors, missing);
    if (missing.length || Object.keys(errors).length) return { result: null, errors, missing };
    const exact = age * ast / (platelets * Math.sqrt(alt));
    const value = Math.round(exact * 100) / 100;
    const lower = age >= 65 ? 2 : 1.3;
    const risk = value <= lower ? "low" : value >= 2.67 ? "high" : "indeterminate";
    return { result: { value, exact, lower, upper: 2.67, risk, lowAccuracy: age <= 35 }, errors, missing };
  }

  // QT correction with RR = 60 / heart rate in seconds: Bazett QT / RR^1/2, Fridericia QT / RR^1/3 (Vandenberk B et al. J Am Heart Assoc 2016;5:e003264).
  // Upper limits of normal (99th percentile) 470 ms in men and 480 ms in women; over 500 ms is dangerous (Drew BJ et al. Circulation 2010;121:1047-1060).
  function calculateQtc(input) {
    const values = isObject(input) ? input : {};
    const errors = {}, missing = [];
    const qt = readCalculatorNumber(values, "qt", [200, 800], true, "QT — целое число от 200 до 800 мс.", errors, missing);
    const rate = readCalculatorNumber(values, "rate", [30, 250], true, "ЧСС — целое число от 30 до 250 в минуту.", errors, missing);
    if (!["female", "male"].includes(values.sex)) missing.push("sex");
    if (missing.length || Object.keys(errors).length) return { result: null, errors, missing };
    const rr = 60 / rate;
    const limit = values.sex === "female" ? 480 : 470;
    const grade = value => value > 500 ? "dangerous" : value > limit ? "prolonged" : "normal";
    const bazett = Math.round(qt / Math.sqrt(rr)), fridericia = Math.round(qt / Math.cbrt(rr));
    return { result: { rr, bazett, fridericia, limit, bazettGrade: grade(bazett), fridericiaGrade: grade(fridericia) }, errors, missing };
  }

  // FINDRISC form: Lindström J, Tuomilehto J. Diabetes Care 2003;26(3):725-731, with family history and age over 64 added on the
  // published form (Lindström J. National Public Health Institute A 18/2006). Total 0-26 and the five 10-year risk bands of that form.
  const FINDRISC_POINTS = Object.freeze({
    age: { "lt45": 0, "45-54": 2, "55-64": 3, "gt64": 4 }, bmi: { "lt25": 0, "25-30": 1, "gt30": 3 }, waist: { low: 0, middle: 3, high: 4 },
    activity: { yes: 0, no: 2 }, vegetables: { daily: 0, notDaily: 1 }, bpDrugs: { no: 0, yes: 2 }, glucose: { no: 0, yes: 5 },
    family: { no: 0, second: 3, first: 5 }
  });
  const FINDRISC_BANDS = Object.freeze([[21, "veryHigh", 2], [15, "high", 3], [12, "moderate", 6], [7, "slight", 25], [0, "low", 100]]);

  function scoreFindrisc(input) {
    const values = isObject(input) ? input : {};
    const missing = Object.keys(FINDRISC_POINTS).filter(key => !Object.prototype.hasOwnProperty.call(FINDRISC_POINTS[key], values[key]));
    if (missing.length) return { result: null, errors: {}, missing };
    const score = Object.keys(FINDRISC_POINTS).reduce((sum, key) => sum + FINDRISC_POINTS[key][values[key]], 0);
    const [, risk, oneIn] = FINDRISC_BANDS.find(([from]) => score >= from);
    return { result: { score, risk, oneIn }, errors: {}, missing };
  }

  // PHQ-9 (Kroenke K et al. J Gen Intern Med 2001;16:606-613) and GAD-7 (Spitzer RL et al. Arch Intern Med 2006;166:1092-1097):
  // every answer scores 0-3; severity cut points as in the official PHQ and GAD-7 instruction manual.
  function scoreSymptomQuestionnaire(input, count, cuts) {
    const values = isObject(input) ? input : {};
    const keys = Array.from({ length: count }, (_, index) => "q" + (index + 1));
    const missing = keys.filter(key => !["0", "1", "2", "3"].includes(values[key]));
    if (missing.length) return { result: null, errors: {}, missing };
    const score = keys.reduce((sum, key) => sum + Number(values[key]), 0);
    const [, severity] = cuts.find(([from]) => score >= from);
    return { result: { score, severity, item9: count === 9 ? Number(values.q9) : null }, errors: {}, missing };
  }

  function scorePhq9(input) {
    return scoreSymptomQuestionnaire(input, 9, [[20, "severe"], [15, "moderatelySevere"], [10, "moderate"], [5, "mild"], [0, "minimal"]]);
  }

  function scoreGad7(input) {
    return scoreSymptomQuestionnaire(input, 7, [[15, "severe"], [10, "moderate"], [5, "mild"], [0, "minimal"]]);
  }

  // SCORE2 (age 40-69): SCORE2 working group and ESC Cardiovascular risk collaboration. Eur Heart J 2021;42(25):2439-2454.
  // SCORE2-OP (age 70 and older): SCORE2-OP working group. Eur Heart J 2021;42(25):2455-2467, Table 2 and supplementary
  // methods tables 1-2 (baseline survival, mean linear predictor, region rescaling factors).
  // 10-year fatal and non-fatal CVD risk without CVD or diabetes (the diabetes term is 0), recalibrated to the very high-risk
  // region that includes Belarus. Categories follow the ESC 2021 prevention guideline: 2.5/7.5% under 50, 5/10% at 50-69, 7.5/15% from 70.
  // Each factor is centred and scaled as (value - centre) / step; interactions multiply by the centred age.
  const SCORE2_CENTRES = Object.freeze({ age: [60, 5], sbp: [120, 20], tchol: [6, 1], hdl: [1.3, 0.5] });
  const SCORE2_OP_CENTRES = Object.freeze({ age: [73, 1], sbp: [150, 1], tchol: [6, 1], hdl: [1.4, 1] });
  const SCORE2_MODELS = Object.freeze({
    male: { centres: SCORE2_CENTRES, age: 0.3742, smoking: 0.6012, sbp: 0.2777, tchol: 0.1458, hdl: -0.2698, smokingAge: -0.0755, sbpAge: -0.0255, tcholAge: -0.0281, hdlAge: 0.0426, survival: 0.9605, meanLinear: 0, scale: [0.5836, 0.8294] },
    female: { centres: SCORE2_CENTRES, age: 0.4648, smoking: 0.7744, sbp: 0.3131, tchol: 0.1002, hdl: -0.2606, smokingAge: -0.1088, sbpAge: -0.0277, tcholAge: -0.0226, hdlAge: 0.0613, survival: 0.9776, meanLinear: 0, scale: [0.9412, 0.8329] }
  });
  const SCORE2_OP_MODELS = Object.freeze({
    male: { centres: SCORE2_OP_CENTRES, age: 0.0634, smoking: 0.3524, sbp: 0.0094, tchol: 0.0850, hdl: -0.3564, smokingAge: -0.0247, sbpAge: -0.0005, tcholAge: 0.0073, hdlAge: 0.0091, survival: 0.7576, meanLinear: 0.0929, scale: [0.05, 0.7] },
    female: { centres: SCORE2_OP_CENTRES, age: 0.0789, smoking: 0.4921, sbp: 0.0102, tchol: 0.0605, hdl: -0.3040, smokingAge: -0.0255, sbpAge: -0.0004, tcholAge: -0.0009, hdlAge: 0.0154, survival: 0.8082, meanLinear: 0.229, scale: [0.38, 0.69] }
  });

  function calculateScore2(input) {
    const values = isObject(input) ? input : {};
    const errors = {}, missing = [];
    const age = readCalculatorNumber(values, "age", [40, 100], true, "Возраст — целое число лет от 40 до 100: SCORE2 для 40–69 лет, SCORE2-OP для 70 лет и старше.", errors, missing);
    if (!["female", "male"].includes(values.sex)) missing.push("sex");
    if (!["yes", "no"].includes(values.smoking)) missing.push("smoking");
    const sbp = readCalculatorNumber(values, "sbp", [60, 300], true, "САД — целое число от 60 до 300 мм рт. ст.", errors, missing);
    const tchol = readCalculatorNumber(values, "tchol", [1, 20], false, "Общий холестерин — число от 1 до 20 ммоль/л.", errors, missing);
    const hdl = readCalculatorNumber(values, "hdl", [0.2, 5], false, "Холестерин ЛПВП — число от 0,2 до 5 ммоль/л.", errors, missing);
    if (missing.length || Object.keys(errors).length) return { result: null, errors, missing };
    const older = age >= 70;
    const model = (older ? SCORE2_OP_MODELS : SCORE2_MODELS)[values.sex];
    const centred = (key, value) => (value - model.centres[key][0]) / model.centres[key][1];
    const a = centred("age", age), s = centred("sbp", sbp), c = centred("tchol", tchol), h = centred("hdl", hdl), smoker = values.smoking === "yes" ? 1 : 0;
    const linear = model.age * a + model.smoking * smoker + model.sbp * s + model.tchol * c + model.hdl * h +
      model.smokingAge * a * smoker + model.sbpAge * a * s + model.tcholAge * a * c + model.hdlAge * a * h;
    const uncalibrated = 1 - model.survival ** Math.exp(linear - model.meanLinear);
    const exact = 100 * (1 - Math.exp(-Math.exp(model.scale[0] + model.scale[1] * Math.log(-Math.log(1 - uncalibrated)))));
    const percent = Math.round(exact * 10) / 10;
    const limits = older ? [7.5, 15] : age < 50 ? [2.5, 7.5] : [5, 10];
    const category = percent < limits[0] ? "lowModerate" : percent < limits[1] ? "high" : "veryHigh";
    return { result: { model: older ? "SCORE2-OP" : "SCORE2", percent, exact, uncalibrated: 100 * uncalibrated, limits, category }, errors, missing };
  }

  // Calculator prefill takes a lab value only from a report field (panel and field ids), never from free-text results.
  // The latest dated result wins; differing results on that date, a non-numeric result or an unknown unit are reported, not guessed.
  const LAB_UNIT_ALIASES = Object.freeze({
    umol: ["мкмоль/л", "umol/l", "µmol/l", "μmol/l"], mg: ["мг/дл", "mg/dl"], mmol: ["ммоль/л", "mmol/l"],
    unitsPerLitre: ["ед/л", "е/л", "ме/л", "u/l", "iu/l"], perNanolitre: ["109/л", "109/l", "тыс/мкл", "103/мкл", "103/µl", "103/μl"]
  });
  const SUPERSCRIPT_DIGITS = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

  function labUnitKind(unit) {
    const text = String(unit || "").toLowerCase().replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, char => SUPERSCRIPT_DIGITS[char]).replace(/[\s×x*^.]/g, "");
    return Object.keys(LAB_UNIT_ALIASES).find(kind => LAB_UNIT_ALIASES[kind].includes(text)) || "";
  }

  function findLatestLabResult(investigations, panelId, fieldId, kinds) {
    const rows = (Array.isArray(investigations) ? investigations : []).filter(item => isObject(item) && item.kind === "lab" && item.panelId === panelId && item.fieldId === fieldId && typeof item.result === "string" && item.result.trim());
    if (!rows.length) return null;
    const date = rows.reduce((latest, item) => item.date > latest ? item.date : latest, "");
    const latest = rows.filter(item => item.date === date);
    const item = latest[0], text = item.result.trim();
    const base = { date, reportTitle: item.reportTitle || "" };
    if (latest.some(row => row.result.trim() !== text || labUnitKind(row.unit) !== labUnitKind(item.unit))) return { ...base, problem: "conflict" };
    if (!DECIMAL_PATTERN.test(text)) return { ...base, problem: "notNumber", result: text };
    const unit = labUnitKind(item.unit);
    if (!kinds.includes(unit)) return { ...base, problem: "unit", unitText: String(item.unit || "").trim() };
    return { ...base, value: text, unit };
  }

  function calculateAge(birthDate, visitDate) {
    if (typeof birthDate !== "string" || typeof visitDate !== "string" || !validDate(birthDate) || !validDate(visitDate) || birthDate > visitDate) return null;
    // В невисокосный год полный год для родившихся 29 февраля наступает 1 марта.
    return Number(visitDate.slice(0, 4)) - Number(birthDate.slice(0, 4)) - (visitDate.slice(5) < birthDate.slice(5) ? 1 : 0);
  }

  function encounterAge(encounter, patient) {
    if (!isObject(encounter) || typeof encounter.age !== "string") throw new Error("Возраст приёма должен быть строкой.");
    if (patient === undefined) return encounter.age;
    assertPatient(patient);
    if (patient.id !== encounter.patientId) throw new Error("Дата рождения относится к другому пациенту.");
    if (!patient.birthDate) return encounter.age;
    const age = calculateAge(patient.birthDate, encounter.visitDate);
    if (age === null) throw new Error("Для расчёта возраста укажите корректную дату приёма не раньше даты рождения.");
    return String(age);
  }

  function calculateSickLeaveDays(from, to) {
    if (typeof from !== "string" || typeof to !== "string" || !validDate(from) || !validDate(to) || from > to) return null;
    return (Date.parse(to + "T00:00:00.000Z") - Date.parse(from + "T00:00:00.000Z")) / 86400000 + 1;
  }

  function mergeSickLeavePeriods(periods) {
    if (!Array.isArray(periods)) throw new Error("Периоды больничного должны быть массивом.");
    const sorted = Array.from(periods, period => {
      if (!isObject(period) || Object.keys(period).some(field => !["from", "to"].includes(field)) || ["from", "to"].some(field => !Object.prototype.hasOwnProperty.call(period, field)) || calculateSickLeaveDays(period.from, period.to) === null) {
        throw new Error("Укажите корректные даты начала и окончания каждого периода больничного.");
      }
      return { from: period.from, to: period.to };
    }).sort((first, second) => first.from.localeCompare(second.from) || first.to.localeCompare(second.to));
    const mergedPeriods = [];
    let merged = null;
    for (const period of sorted) {
      if (merged && Date.parse(period.from + "T00:00:00.000Z") - Date.parse(merged.to + "T00:00:00.000Z") <= 86400000) {
        if (period.to > merged.to) merged.to = period.to;
      } else {
        if (merged) mergedPeriods.push(merged);
        merged = period;
      }
    }
    if (merged) mergedPeriods.push(merged);
    return mergedPeriods;
  }

  function calculateSickLeaveTotalDays(periods) {
    return mergeSickLeavePeriods(periods).reduce((total, period) => total + calculateSickLeaveDays(period.from, period.to), 0);
  }

  function sickLeavePeriods(leave) {
    const last = leave.events[leave.events.length - 1];
    const closedOn = last.type === "close" ? last.to : "";
    return mergeSickLeavePeriods(leave.events.filter(event => event.type !== "close" && (!closedOn || event.from <= closedOn)).map(event => ({
      from: event.from,
      to: closedOn && event.to > closedOn ? closedOn : event.to
    })));
  }

  function validateSickLeaves(leaves) {
    const errors = [];
    const add = (field, message) => errors.push({ field: "sickLeaves" + field, message });
    if (!Array.isArray(leaves)) return [{ field: "sickLeaves", message: "Журнал больничных должен быть массивом." }];
    if (leaves.length > MAX_SICK_LEAVES) add("", "Допускается не более 100 больничных в одной карточке.");
    const leaveIds = new Set();
    const eventIds = new Set();
    const sources = new Set();
    const linkedEncounters = new Set();
    for (let index = 0; index < leaves.length; index += 1) {
      const leave = leaves[index];
      const path = "[" + index + "]";
      if (!isObject(leave)) { add(path, "Ожидается запись больничного."); continue; }
      const fields = ["id", "number", "sourceEncounterId", "events"];
      if (Object.keys(leave).some(field => !fields.includes(field)) || fields.some(field => !Object.prototype.hasOwnProperty.call(leave, field))) add(path, "Неверная структура записи больничного.");
      if (typeof leave.id !== "string" || !ID_PATTERN.test(leave.id) || leaveIds.has(leave.id)) add(path + ".id", "Некорректный или повторяющийся идентификатор больничного.");
      leaveIds.add(leave.id);
      if (typeof leave.number !== "string" || leave.number.length > MAX_SICK_LEAVE_NUMBER_LENGTH) add(path + ".number", "Номер больничного должен быть строкой не длиннее 120 символов.");
      if (typeof leave.sourceEncounterId !== "string" || (leave.sourceEncounterId !== "" && (!ID_PATTERN.test(leave.sourceEncounterId) || sources.has(leave.sourceEncounterId)))) add(path + ".sourceEncounterId", "Некорректная или повторная ссылка на исходный приём.");
      if (leave.sourceEncounterId) sources.add(leave.sourceEncounterId);
      if (!Array.isArray(leave.events)) { add(path + ".events", "Действия с больничным должны быть массивом."); continue; }
      if (!leave.events.length || leave.events.length > MAX_SICK_LEAVE_EVENTS) add(path + ".events", "В больничном должно быть от 1 до 100 действий.");
      let firstFrom = "";
      let latestTo = "";
      let closed = false;
      const periods = [];
      for (let eventIndex = 0; eventIndex < leave.events.length; eventIndex += 1) {
        const event = leave.events[eventIndex];
        const eventPath = path + ".events[" + eventIndex + "]";
        if (!isObject(event)) { add(eventPath, "Ожидается действие с больничным."); continue; }
        const eventFields = ["id", "type", "from", "to", "recordedAt"];
        if (Object.keys(event).some(field => !eventFields.includes(field) && field !== "encounterId") || eventFields.some(field => !Object.prototype.hasOwnProperty.call(event, field))) add(eventPath, "Неверная структура действия с больничным.");
        if (Object.prototype.hasOwnProperty.call(event, "encounterId")) {
          if (typeof event.encounterId !== "string" || !ID_PATTERN.test(event.encounterId) || linkedEncounters.has(event.encounterId)) add(eventPath + ".encounterId", "Некорректная или повторная ссылка действия на приём.");
          linkedEncounters.add(event.encounterId);
        }
        if (typeof event.id !== "string" || !ID_PATTERN.test(event.id) || eventIds.has(event.id)) add(eventPath + ".id", "Некорректный или повторяющийся идентификатор действия.");
        eventIds.add(event.id);
        if (typeof event.recordedAt !== "string" || !validTimestamp(event.recordedAt)) add(eventPath + ".recordedAt", "Некорректная дата и время действия; ожидается формат ISO UTC.");
        if (closed) add(eventPath, "После закрытия больничного нельзя добавлять действия.");
        if (eventIndex === 0 ? event.type !== "issue" : !["extend", "close"].includes(event.type)) add(eventPath + ".type", "Первым действием должна быть выдача, затем продление или закрытие.");
        if (event.type === "close") {
          if (event.from !== "" || typeof event.to !== "string" || !validDate(event.to) || !periods.some(period => period.from <= event.to && event.to <= period.to)) add(eventPath, "Дата закрытия должна входить в один из указанных периодов больничного.");
          closed = true;
        } else if (["issue", "extend"].includes(event.type)) {
          if (calculateSickLeaveDays(event.from, event.to) === null) { add(eventPath, "Укажите корректные даты начала и окончания периода больничного."); continue; }
          if (event.type === "issue") firstFrom = event.from;
          else if (!firstFrom || event.from < firstFrom || event.to <= latestTo) add(eventPath, "Продление должно начинаться не раньше выдачи и увеличивать конечную дату больничного.");
          periods.push({ from: event.from, to: event.to });
          if (event.to > latestTo) latestTo = event.to;
        }
      }
    }
    return errors;
  }

  function normalizePatient(patient) {
    return {
      ...Object.fromEntries(PATIENT_FIELDS.map(field => [field, patient[field]])),
      ...(Object.prototype.hasOwnProperty.call(patient, "birthDate") ? { birthDate: patient.birthDate } : {}),
      ...(Object.prototype.hasOwnProperty.call(patient, "personalNote") ? { personalNote: patient.personalNote } : {}),
      ...(Object.prototype.hasOwnProperty.call(patient, "sickLeaves") ? {
        sickLeaves: patient.sickLeaves.map(leave => ({ ...leave, events: leave.events.map(event => ({ ...event })) }))
      } : {}),
      ...(patient.investigations?.length ? {
        investigations: patient.investigations.map(item => Object.fromEntries([...INVESTIGATION_FIELDS, ...INVESTIGATION_REPORT_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(item, field))].map(field => [field, item[field]])))
      } : {})
    };
  }

  function validateJournalEncounters(encounters) {
    if (!Array.isArray(encounters) || encounters.length > MAX_ENCOUNTERS) throw new Error("Ожидается список не более 500 приёмов.");
    const ids = new Set();
    for (const encounter of encounters) {
      if (!isObject(encounter) || ["id", "patientId"].some(field => typeof encounter[field] !== "string" || !ID_PATTERN.test(encounter[field])) || ids.has(encounter.id)) throw new Error("Некорректный или повторный идентификатор приёма.");
      ids.add(encounter.id);
      const assessment = encounter.assessment;
      if (!isObject(assessment) || !["", "no", "yes"].includes(assessment.sickLeaveIssued) || ["sickLeaveNumber", "sickLeaveFrom", "sickLeaveTo"].some(field => typeof assessment[field] !== "string" || assessment[field].length > MAX_TEXT_LENGTH)) throw new Error("Некорректные сведения о больничном в приёме.");
    }
  }

  function getSickLeaveJournal(patient, encounters = []) {
    assertPatient(patient);
    validateJournalEncounters(encounters);
    const leaves = (patient.sickLeaves || []).map(leave => {
      const last = leave.events[leave.events.length - 1];
      const periods = sickLeavePeriods(leave);
      return {
        ...leave,
        events: leave.events.map(event => ({ ...event })),
        status: last.type === "close" ? "closed" : "open",
        closedOn: last.type === "close" ? last.to : "",
        periods,
        days: calculateSickLeaveTotalDays(periods)
      };
    });
    const sourceIds = new Set(leaves.flatMap(leave => [leave.sourceEncounterId, ...leave.events.map(event => event.encounterId)]).filter(Boolean));
    const legacy = encounters.filter(encounter => encounter.patientId === patient.id && encounter.assessment.sickLeaveIssued === "yes" && !sourceIds.has(encounter.id)).map(encounter => {
      const { sickLeaveNumber: number, sickLeaveFrom: from, sickLeaveTo: to } = encounter.assessment;
      return { encounterId: encounter.id, number, from, to, days: calculateSickLeaveDays(from, to) };
    });
    return {
      leaves,
      legacy,
      totalDays: calculateSickLeaveTotalDays([...leaves.flatMap(leave => leave.periods), ...legacy.filter(leave => leave.days !== null).map(leave => ({ from: leave.from, to: leave.to }))]),
      incompleteCount: legacy.filter(leave => leave.days === null).length
    };
  }

  function getEncounterSickLeaveSummary(encounter, patient, encounters = []) {
    assertPatient(patient);
    validateJournalEncounters([encounter]);
    validateJournalEncounters(encounters);
    if (encounter.patientId !== patient.id) throw new Error("Приём и журнал больничных должны относиться к одному пациенту.");
    const assessment = encounter.assessment;
    const number = assessment.sickLeaveNumber.trim().toLocaleLowerCase("ru");
    const periodDays = assessment.sickLeaveIssued === "yes" ? calculateSickLeaveDays(assessment.sickLeaveFrom, assessment.sickLeaveTo) : null;
    const summary = { periodDays, totalDays: null, from: "", to: "", unnumbered: !number, hasPrevious: false };
    const action = getEncounterSickLeaveAction(patient, encounter);
    if (action) {
      const throughAction = { ...action.leave, events: action.leave.events.slice(0, action.leave.events.findIndex(event => event.id === action.event.id) + 1) };
      const periods = sickLeavePeriods(throughAction);
      const totalDays = calculateSickLeaveTotalDays(periods);
      const actionDays = action.event.type === "close" ? 0 : calculateSickLeaveDays(action.event.from, action.event.to);
      return { periodDays: actionDays, totalDays, from: periods[0].from, to: periods[periods.length - 1].to, unnumbered: !action.leave.number.trim(), hasPrevious: totalDays > actionDays };
    }
    if (periodDays === null) return summary;
    const older = typeof encounter.visitDate === "string" && validDate(encounter.visitDate)
      ? encounters.filter(entry => entry.id !== encounter.id && entry.patientId === patient.id && typeof entry.visitDate === "string" && validDate(entry.visitDate) && entry.visitDate <= encounter.visitDate)
      : [];
    const journal = getSickLeaveJournal(patient, older);
    const sameNumber = leave => leave.number.trim().toLocaleLowerCase("ru") === number;
    const periods = [
      ...journal.leaves.filter(sameNumber).flatMap(leave => leave.periods),
      ...journal.legacy.filter(leave => sameNumber(leave) && leave.days !== null).map(leave => ({ from: leave.from, to: leave.to }))
    ].filter(period => period.from <= assessment.sickLeaveTo).map(period => ({ from: period.from, to: period.to > assessment.sickLeaveTo ? assessment.sickLeaveTo : period.to }));
    periods.push({ from: assessment.sickLeaveFrom, to: assessment.sickLeaveTo });
    const connected = mergeSickLeavePeriods(periods).find(period => period.from <= assessment.sickLeaveFrom && period.to >= assessment.sickLeaveTo);
    const totalDays = calculateSickLeaveDays(connected.from, connected.to);
    return { periodDays, totalDays, from: connected.from, to: connected.to, unnumbered: !number, hasPrevious: totalDays > periodDays };
  }

  function sickLeaveActionTime(options, allowed) {
    if (!isObject(options) || Object.keys(options).some(field => !allowed.includes(field))) throw new Error("Некорректные параметры действия с больничным.");
    const now = options.now === undefined ? new Date() : new Date(options.now);
    if (!Number.isFinite(now.getTime()) || now.getUTCFullYear() < 1 || now.getUTCFullYear() > 9999) throw new Error("Некорректное время действия с больничным.");
    return now.toISOString();
  }

  function issueSickLeave(patient, options, encounters = []) {
    assertPatient(patient);
    const recordedAt = sickLeaveActionTime(options, ["number", "from", "to", "sourceEncounterId", "id", "eventId", "now"]);
    validateJournalEncounters(encounters);
    const sourceEncounterId = options.sourceEncounterId === undefined ? "" : options.sourceEncounterId;
    if (sourceEncounterId) {
      const source = encounters.find(encounter => encounter.id === sourceEncounterId);
      if (!source || source.patientId !== patient.id || source.assessment.sickLeaveIssued !== "yes") throw new Error("Исходный приём с выданным больничным должен относиться к этому пациенту.");
      if (source.assessment.sickLeaveNumber !== options.number || source.assessment.sickLeaveFrom !== options.from || source.assessment.sickLeaveTo !== options.to) throw new Error("Данные выдачи должны совпадать с больничным в исходном приёме.");
      if ((patient.sickLeaves || []).some(leave => leave.events.some(event => event.encounterId === sourceEncounterId))) throw new Error("Приём уже связан с действием журнала больничных.");
    }
    const result = normalizePatient(patient);
    result.sickLeaves = [...(result.sickLeaves || []), {
      id: options.id === undefined ? newId("leave") : options.id,
      number: options.number,
      sourceEncounterId,
      events: [{ id: options.eventId === undefined ? newId("leave-event") : options.eventId, type: "issue", from: options.from, to: options.to, recordedAt }]
    }];
    result.updatedAt = recordedAt;
    assertPatient(result);
    return result;
  }

  function appendSickLeaveAction(patient, leaveId, options, type) {
    assertPatient(patient);
    const recordedAt = sickLeaveActionTime(options, type === "close" ? ["date", "eventId", "now"] : ["from", "to", "eventId", "now"]);
    const result = normalizePatient(patient);
    const leave = result.sickLeaves?.find(entry => entry.id === leaveId);
    if (!leave) throw new Error("Больничный не найден в карточке пациента.");
    leave.events.push({
      id: options.eventId === undefined ? newId("leave-event") : options.eventId,
      type,
      from: type === "close" ? "" : options.from,
      to: type === "close" ? options.date : options.to,
      recordedAt
    });
    result.updatedAt = recordedAt;
    assertPatient(result);
    return result;
  }

  function extendSickLeave(patient, leaveId, options) {
    return appendSickLeaveAction(patient, leaveId, options, "extend");
  }

  function closeSickLeave(patient, leaveId, options) {
    return appendSickLeaveAction(patient, leaveId, options, "close");
  }

  function undoSickLeaveAction(patient, leaveId, options = {}) {
    assertPatient(patient);
    const recordedAt = sickLeaveActionTime(options, ["now"]);
    const result = normalizePatient(patient);
    const leave = result.sickLeaves?.find(entry => entry.id === leaveId);
    if (!leave) throw new Error("Больничный не найден в карточке пациента.");
    if (leave.events[leave.events.length - 1].encounterId) throw new Error("Действие связано с приёмом. Откройте этот приём и отмените действие там.");
    leave.events.pop();
    result.sickLeaves = result.sickLeaves.filter(entry => entry.events.length);
    if (!result.sickLeaves.length) delete result.sickLeaves;
    result.updatedAt = recordedAt;
    assertPatient(result);
    return result;
  }

  function getEncounterSickLeaveAction(patient, encounter) {
    assertPatient(patient);
    validateJournalEncounters([encounter]);
    if (encounter.patientId !== patient.id) throw new Error("Приём и журнал больничных должны относиться к одному пациенту.");
    for (const leave of patient.sickLeaves || []) {
      const event = leave.events.find(entry => entry.encounterId === encounter.id);
      if (event) return { leave: { ...leave, events: leave.events.map(entry => ({ ...entry })) }, event: { ...event } };
    }
    return null;
  }

  function assessmentForSickLeaveAction(leave, event) {
    const throughAction = { ...leave, events: leave.events.slice(0, leave.events.findIndex(entry => entry.id === event.id) + 1) };
    const periods = sickLeavePeriods(throughAction);
    return {
      sickLeaveIssued: "yes",
      sickLeaveNumber: leave.number,
      sickLeaveFrom: event.type === "close" ? periods[0].from : event.from,
      sickLeaveTo: event.to
    };
  }

  function assertSickLeaveLinks(patient, encounters) {
    const byId = new Map(encounters.map(encounter => [encounter.id, encounter]));
    const leaves = patient.sickLeaves || [];
    const sources = new Map(leaves.filter(leave => leave.sourceEncounterId).map(leave => [leave.sourceEncounterId, leave.id]));
    for (const leave of leaves) {
      if (leave.sourceEncounterId) {
        const source = byId.get(leave.sourceEncounterId);
        if (!source || source.patientId !== patient.id) throw new Error("Исходный приём больничного отсутствует или относится к другому пациенту.");
      }
      for (const event of leave.events) {
        if (!event.encounterId) continue;
        const encounter = byId.get(event.encounterId);
        if (!encounter || encounter.patientId !== patient.id) throw new Error("Связанный с больничным приём отсутствует или относится к другому пациенту.");
        if (sources.has(event.encounterId) && (sources.get(event.encounterId) !== leave.id || event.type !== "issue")) throw new Error("Приём уже используется как источник другого действия с больничным.");
        const expected = assessmentForSickLeaveAction(leave, event);
        if (Object.entries(expected).some(([field, value]) => encounter.assessment[field] !== value)) throw new Error("Сведения о больничном в приёме не совпадают со связанным действием журнала. Измените действие через этот приём.");
      }
    }
  }

  function applyEncounterSickLeave(patient, encounter, options, encounters = []) {
    assertPatient(patient);
    assertEncounter(encounter);
    validateJournalEncounters(encounters);
    const recordedAt = sickLeaveActionTime(options, ["type", "leaveId", "sourceEncounterId", "number", "from", "to", "date", "id", "eventId", "now"]);
    if (encounter.patientId !== patient.id) throw new Error("Приём и журнал больничных должны относиться к одному пациенту.");
    if (!validDate(encounter.visitDate)) throw new Error("Укажите дату приёма перед действием с больничным.");
    if (!["issue", "extend", "close"].includes(options.type)) throw new Error("Выберите выдачу, продление или закрытие больничного.");
    if (getEncounterSickLeaveAction(patient, encounter)) throw new Error("В этом приёме уже сохранено действие с больничным. Сначала отмените его.");
    const allEncounters = [...encounters.filter(entry => entry.id !== encounter.id), encounter];
    assertSickLeaveLinks(patient, allEncounters);
    let updatedPatient = normalizePatient(patient);
    let leave;
    if (options.type === "issue") {
      if (options.leaveId !== undefined || options.sourceEncounterId !== undefined || options.date !== undefined) throw new Error("Для новой выдачи укажите номер и период больничного.");
      leave = updatedPatient.sickLeaves?.find(entry => entry.sourceEncounterId === encounter.id);
      if (leave) {
        const first = leave.events[0];
        if (leave.number !== options.number || first.from !== options.from || first.to !== options.to) throw new Error("Выдача уже перенесена в журнал. Укажите её сохранённые номер и период.");
      } else {
        updatedPatient = issueSickLeave(updatedPatient, { number: options.number, from: options.from, to: options.to, id: options.id, eventId: options.eventId, now: recordedAt }, allEncounters);
        leave = updatedPatient.sickLeaves[updatedPatient.sickLeaves.length - 1];
      }
      leave.events[0].encounterId = encounter.id;
    } else {
      if (options.number !== undefined || (options.type === "extend" ? options.date !== undefined : options.from !== undefined || options.to !== undefined)) throw new Error("Для действия с существующим больничным используются его сохранённый номер и выбранные даты.");
      if (!!options.leaveId === !!options.sourceEncounterId) throw new Error("Выберите один открытый больничный или исходный приём.");
      let leaveId = options.leaveId;
      const selectedLeave = updatedPatient.sickLeaves?.find(entry => entry.id === leaveId);
      if (selectedLeave?.events.some(event => event.encounterId && allEncounters.find(entry => entry.id === event.encounterId).visitDate > encounter.visitDate)) throw new Error("В этом больничном уже есть действие из более позднего приёма. Выберите приём с подходящей датой.");
      if (options.sourceEncounterId) {
        const source = allEncounters.find(entry => entry.id === options.sourceEncounterId);
        if (!source || source.id === encounter.id || source.patientId !== patient.id || !validDate(source.visitDate) || !validDate(encounter.visitDate) || source.visitDate > encounter.visitDate) throw new Error("Исходный больничный должен быть в предыдущем приёме этого пациента.");
        if ((updatedPatient.sickLeaves || []).some(entry => entry.sourceEncounterId === source.id || entry.events.some(event => event.encounterId === source.id))) throw new Error("Этот больничный уже перенесён в журнал. Выберите его в списке.");
        updatedPatient = issueSickLeave(updatedPatient, {
          number: source.assessment.sickLeaveNumber, from: source.assessment.sickLeaveFrom, to: source.assessment.sickLeaveTo,
          sourceEncounterId: source.id, id: options.id, now: recordedAt
        }, allEncounters);
        leaveId = updatedPatient.sickLeaves[updatedPatient.sickLeaves.length - 1].id;
      }
      updatedPatient = options.type === "extend"
        ? extendSickLeave(updatedPatient, leaveId, { from: options.from, to: options.to, eventId: options.eventId, now: recordedAt })
        : closeSickLeave(updatedPatient, leaveId, { date: options.date, eventId: options.eventId, now: recordedAt });
      leave = updatedPatient.sickLeaves.find(entry => entry.id === leaveId);
      leave.events[leave.events.length - 1].encounterId = encounter.id;
    }
    updatedPatient.updatedAt = recordedAt;
    assertPatient(updatedPatient);
    const event = leave.events.find(entry => entry.encounterId === encounter.id);
    const updatedEncounter = setReviewStatus({
      ...encounter, updatedAt: recordedAt, assessment: { ...encounter.assessment, ...assessmentForSickLeaveAction(leave, event) }
    }, "draft");
    assertSickLeaveLinks(updatedPatient, [...allEncounters.filter(entry => entry.id !== encounter.id), updatedEncounter]);
    return { patient: updatedPatient, encounter: updatedEncounter };
  }

  function undoEncounterSickLeave(patient, encounter, encounters = []) {
    assertEncounter(encounter);
    validateJournalEncounters(encounters);
    const action = getEncounterSickLeaveAction(patient, encounter);
    if (!action) throw new Error("В этом приёме нет связанного действия с больничным.");
    if (action.leave.events[action.leave.events.length - 1].id !== action.event.id) throw new Error("После этого действия уже есть продление или закрытие. Сначала отмените более поздние действия.");
    const allEncounters = [...encounters.filter(entry => entry.id !== encounter.id), encounter];
    assertSickLeaveLinks(patient, allEncounters);
    const updatedPatient = normalizePatient(patient);
    const leave = updatedPatient.sickLeaves.find(entry => entry.id === action.leave.id);
    leave.events.pop();
    updatedPatient.sickLeaves = updatedPatient.sickLeaves.filter(entry => entry.events.length);
    if (!updatedPatient.sickLeaves.length) delete updatedPatient.sickLeaves;
    const now = new Date().toISOString();
    updatedPatient.updatedAt = now;
    const updatedEncounter = setReviewStatus({
      ...encounter, updatedAt: now,
      assessment: { ...encounter.assessment, sickLeaveIssued: "", sickLeaveNumber: "", sickLeaveFrom: "", sickLeaveTo: "" }
    }, "draft");
    assertPatient(updatedPatient);
    assertSickLeaveLinks(updatedPatient, [...allEncounters.filter(entry => entry.id !== encounter.id), updatedEncounter]);
    return { patient: updatedPatient, encounter: updatedEncounter };
  }

  function newId(prefix = "visit") {
    if (typeof globalThis.crypto?.randomUUID === "function") return prefix + "-" + globalThis.crypto.randomUUID();
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function emptyWorkflow() {
    return { reviewStatus: "draft", reviewedAt: "", returnVisitStatus: "planned", returnVisitEncounterId: "" };
  }

  function validatePatient(patient) {
    const errors = [];
    if (!isObject(patient)) return [{ field: "patient", message: "Ожидается объект карточки пациента." }];
    for (const field of PATIENT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(patient, field)) errors.push({ field, message: "Обязательное поле отсутствует." });
      else if (typeof patient[field] !== "string") errors.push({ field, message: "Значение должно быть строкой." });
    }
    for (const field of Object.keys(patient)) {
      if (!PATIENT_FIELDS.includes(field) && !["birthDate", "personalNote", "sickLeaves", "investigations"].includes(field)) errors.push({ field, message: "Неизвестное поле карточки пациента." });
    }
    if (typeof patient.id === "string" && !ID_PATTERN.test(patient.id)) errors.push({ field: "id", message: "Некорректный идентификатор карточки пациента." });
    if (typeof patient.label === "string" && patient.label.length > MAX_PATIENT_LABEL_LENGTH) errors.push({ field: "label", message: "Условное имя не должно превышать 120 символов." });
    if (Object.prototype.hasOwnProperty.call(patient, "birthDate") && (typeof patient.birthDate !== "string" || (patient.birthDate !== "" && !validDate(patient.birthDate)))) errors.push({ field: "birthDate", message: "Укажите существующую дату рождения в формате ГГГГ-ММ-ДД или оставьте поле пустым." });
    if (Object.prototype.hasOwnProperty.call(patient, "personalNote") && (typeof patient.personalNote !== "string" || patient.personalNote.length > MAX_PERSONAL_NOTE_LENGTH)) errors.push({ field: "personalNote", message: "Личная заметка должна быть строкой не длиннее 5000 символов." });
    for (const field of ["createdAt", "updatedAt"]) {
      if (typeof patient[field] === "string" && !validTimestamp(patient[field])) errors.push({ field, message: "Некорректная дата и время; ожидается формат ISO UTC." });
    }
    if (Object.prototype.hasOwnProperty.call(patient, "sickLeaves")) errors.push(...validateSickLeaves(patient.sickLeaves));
    if (Object.prototype.hasOwnProperty.call(patient, "investigations")) errors.push(...validateInvestigations(patient.investigations));
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
      ...(options.birthDate === undefined ? {} : { birthDate: options.birthDate }),
      ...(options.personalNote === undefined ? {} : { personalNote: options.personalNote }),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    assertPatient(patient);
    return patient;
  }

  function setPatientNote(patient, text, options = {}) {
    assertPatient(patient);
    if (!isObject(options) || Object.keys(options).some(field => field !== "now")) throw new Error("Некорректные параметры изменения личной заметки.");
    if (typeof text !== "string" || text.length > MAX_PERSONAL_NOTE_LENGTH) throw new Error("Личная заметка должна быть строкой не длиннее 5000 символов.");
    const now = options.now === undefined ? new Date() : new Date(options.now);
    if (!Number.isFinite(now.getTime()) || now.getUTCFullYear() < 1 || now.getUTCFullYear() > 9999) throw new Error("Некорректное время изменения личной заметки.");
    const result = normalizePatient(patient);
    if ((patient.personalNote || "") === text) return result;
    if (text) result.personalNote = text;
    else delete result.personalNote;
    result.updatedAt = now.toISOString();
    return result;
  }

  function validateInvestigations(investigations) {
    if (!Array.isArray(investigations)) return [{ field: "investigations", message: "Анализы и исследования должны быть массивом." }];
    const errors = [];
    const ids = new Set();
    const reports = new Map();
    if (investigations.length > MAX_INVESTIGATIONS) errors.push({ field: "investigations", message: "Допускается не более 500 результатов в одной карточке." });
    for (let index = 0; index < investigations.length; index += 1) {
      const item = investigations[index];
      const prefix = "investigations." + index;
      if (!isObject(item)) {
        errors.push({ field: prefix, message: "Ожидается объект результата исследования." });
        continue;
      }
      for (const field of INVESTIGATION_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(item, field)) errors.push({ field: prefix + "." + field, message: "Обязательное поле отсутствует." });
        else if (typeof item[field] !== "string") errors.push({ field: prefix + "." + field, message: "Значение должно быть строкой." });
      }
      for (const field of Object.keys(item)) {
        if (!INVESTIGATION_FIELDS.includes(field) && !INVESTIGATION_REPORT_FIELDS.includes(field)) errors.push({ field: prefix + "." + field, message: "Неизвестное поле результата исследования." });
      }
      if (INVESTIGATION_REPORT_FIELDS.some(field => Object.prototype.hasOwnProperty.call(item, field))) {
        for (const field of INVESTIGATION_REPORT_FIELDS) {
          if (typeof item[field] !== "string" || (field === "reportTitle" ? !item[field].trim() || item[field].length > 200 : !ID_PATTERN.test(item[field]))) {
            errors.push({ field: prefix + "." + field, message: field === "reportTitle" ? "Название бланка должно содержать от 1 до 200 символов." : "Укажите корректный идентификатор бланка или показателя." });
          }
        }
        if (typeof item.reportId === "string") {
          if (!reports.has(item.reportId)) reports.set(item.reportId, { item, fields: new Set(), count: 0 });
          const report = reports.get(item.reportId);
          if (["reportTitle", "panelId", "kind", "date"].some(field => report.item[field] !== item[field])) errors.push({ field: prefix, message: "Название, тип и дата должны совпадать у всех показателей одного бланка." });
          if (report.fields.has(item.fieldId)) errors.push({ field: prefix + ".fieldId", message: "Показатель не должен повторяться в одном бланке." });
          report.fields.add(item.fieldId);
          report.count += 1;
          if (report.count > MAX_INVESTIGATION_REPORT_FIELDS) errors.push({ field: prefix, message: "В одном бланке допускается не более 100 показателей." });
        }
      }
      if (typeof item.id === "string") {
        if (!ID_PATTERN.test(item.id) || ids.has(item.id)) errors.push({ field: prefix + ".id", message: "Некорректный или повторяющийся идентификатор результата." });
        ids.add(item.id);
      }
      if (!["lab", "study"].includes(item.kind)) errors.push({ field: prefix + ".kind", message: "Выберите анализ или исследование." });
      if (typeof item.date === "string" && !validDate(item.date)) errors.push({ field: prefix + ".date", message: "Укажите существующую дату результата." });
      for (const [field, limit] of Object.entries(INVESTIGATION_FIELD_LIMITS)) {
        if (typeof item[field] === "string" && item[field].length > limit) errors.push({ field: prefix + "." + field, message: "Превышен лимит: " + limit + " символов." });
      }
      for (const [field, message] of [["name", "Укажите название анализа или исследования."], ["result", "Укажите результат."]]) {
        if (typeof item[field] === "string" && !item[field].trim()) errors.push({ field: prefix + "." + field, message });
      }
    }
    return errors;
  }

  function investigationChangeTime(options, fields) {
    if (!isObject(options) || Object.keys(options).some(field => !fields.includes(field))) throw new Error("Некорректные параметры изменения результата.");
    const now = options.now === undefined ? new Date() : new Date(options.now);
    if (!Number.isFinite(now.getTime()) || now.getUTCFullYear() < 1 || now.getUTCFullYear() > 9999) throw new Error("Некорректное время изменения результата.");
    return now.toISOString();
  }

  function upsertInvestigation(patient, values, options = {}) {
    assertPatient(patient);
    const updatedAt = investigationChangeTime(options, ["id", "now"]);
    if (!isObject(values) || Object.keys(values).some(field => !INVESTIGATION_VALUE_FIELDS.includes(field)) || INVESTIGATION_VALUE_FIELDS.some(field => !Object.prototype.hasOwnProperty.call(values, field))) throw new Error("Неверная структура результата исследования.");
    const existing = patient.investigations || [];
    if (options.id !== undefined && (typeof options.id !== "string" || !existing.some(item => item.id === options.id))) throw new Error("Результат для изменения не найден.");
    const previous = existing.find(item => item.id === options.id);
    const item = {
      id: options.id === undefined ? newId("investigation") : options.id,
      ...values,
      ...(previous?.reportId ? Object.fromEntries(INVESTIGATION_REPORT_FIELDS.map(field => [field, previous[field]])) : {})
    };
    const investigations = options.id === undefined ? [...existing, item] : existing.map(entry => entry.id === options.id ? item : entry);
    const result = { ...patient, investigations, updatedAt };
    assertPatient(result);
    return normalizePatient(result);
  }

  function removeInvestigation(patient, id, options = {}) {
    assertPatient(patient);
    const updatedAt = investigationChangeTime(options, ["now"]);
    if (typeof id !== "string" || !(patient.investigations || []).some(item => item.id === id)) throw new Error("Результат для удаления не найден.");
    return normalizePatient({ ...patient, investigations: patient.investigations.filter(item => item.id !== id), updatedAt });
  }

  function getInvestigationReports(patient) {
    assertPatient(patient);
    const reports = new Map();
    for (const item of patient.investigations || []) {
      if (!item.reportId) continue;
      if (!reports.has(item.reportId)) reports.set(item.reportId, { id: item.reportId, panelId: item.panelId, title: item.reportTitle, kind: item.kind, date: item.date, results: [] });
      reports.get(item.reportId).results.push({ ...item });
    }
    return [...reports.values()].sort((first, second) => second.date.localeCompare(first.date) || first.id.localeCompare(second.id));
  }

  function upsertInvestigationReport(patient, values, options = {}) {
    assertPatient(patient);
    const updatedAt = investigationChangeTime(options, ["id", "now"]);
    const fields = ["panelId", "title", "kind", "date", "rows"];
    if (!isObject(values) || fields.some(field => !Object.prototype.hasOwnProperty.call(values, field)) || Object.keys(values).some(field => !fields.includes(field))) throw new Error("Неверная структура бланка исследования.");
    if (typeof values.panelId !== "string" || !ID_PATTERN.test(values.panelId)) throw new Error("Некорректный идентификатор вида бланка.");
    if (typeof values.title !== "string" || !values.title.trim() || values.title.length > 200) throw new Error("Название бланка должно содержать от 1 до 200 символов.");
    if (!["lab", "study"].includes(values.kind) || typeof values.date !== "string" || !validDate(values.date)) throw new Error("Укажите тип исследования и существующую дату бланка.");
    if (!Array.isArray(values.rows) || values.rows.length > MAX_INVESTIGATION_REPORT_FIELDS) throw new Error("В одном бланке допускается не более 100 показателей.");
    const existing = patient.investigations || [];
    if (options.id !== undefined && (typeof options.id !== "string" || !existing.some(item => item.reportId === options.id))) throw new Error("Бланк для изменения не найден.");
    const reportId = options.id === undefined ? newId("report") : options.id;
    const previous = new Map(existing.filter(item => item.reportId === reportId).map(item => [item.fieldId, item]));
    const seenFields = new Set();
    const rows = [];
    for (const row of values.rows) {
      if (!isObject(row) || INVESTIGATION_REPORT_ROW_FIELDS.some(field => typeof row[field] !== "string") || Object.keys(row).some(field => !INVESTIGATION_REPORT_ROW_FIELDS.includes(field))) throw new Error("Неверная структура показателя в бланке.");
      if (!ID_PATTERN.test(row.fieldId) || seenFields.has(row.fieldId)) throw new Error("Идентификаторы показателей бланка должны быть корректными и уникальными.");
      seenFields.add(row.fieldId);
      for (const [field, limit] of Object.entries(INVESTIGATION_FIELD_LIMITS)) {
        if (row[field].length > limit) throw new Error("Превышен лимит поля показателя: " + field + " — " + limit + " символов.");
      }
      if (!row.result.trim()) continue;
      rows.push({
        id: previous.get(row.fieldId)?.id || newId("investigation"),
        kind: values.kind, date: values.date,
        ...Object.fromEntries(INVESTIGATION_REPORT_ROW_FIELDS.filter(field => field !== "fieldId").map(field => [field, row[field]])),
        reportId, reportTitle: values.title, panelId: values.panelId, fieldId: row.fieldId
      });
    }
    if (!rows.length) throw new Error("Заполните хотя бы один результат в бланке.");
    const investigations = [];
    let replaced = false;
    for (const item of existing) {
      if (item.reportId === reportId) {
        if (!replaced) investigations.push(...rows);
        replaced = true;
      } else investigations.push(item);
    }
    if (!replaced) investigations.push(...rows);
    const result = { ...patient, investigations, updatedAt };
    assertPatient(result);
    return normalizePatient(result);
  }

  function removeInvestigationReport(patient, id, options = {}) {
    assertPatient(patient);
    const updatedAt = investigationChangeTime(options, ["now"]);
    if (typeof id !== "string" || !(patient.investigations || []).some(item => item.reportId === id)) throw new Error("Бланк для удаления не найден.");
    return normalizePatient({ ...patient, investigations: patient.investigations.filter(item => item.reportId !== id), updatedAt });
  }

  function validateInvestigationIds(ids) {
    if (!Array.isArray(ids) || ids.length > MAX_INVESTIGATIONS || new Set(ids).size !== ids.length || Array.from(ids).some(id => typeof id !== "string" || !ID_PATTERN.test(id))) {
      return [{ field: "investigationIds", message: "Выберите не более 500 существующих результатов без повторений." }];
    }
    return [];
  }

  function encounterInvestigations(encounter, patient) {
    assertPatient(patient);
    if (patient.id !== encounter.patientId) throw new Error("Приём и результаты исследований должны относиться к одному пациенту.");
    const byId = new Map((patient.investigations || []).map(item => [item.id, item]));
    return (encounter.investigationIds || []).map(id => {
      if (!byId.has(id)) throw new Error("В карточке пациента отсутствует результат, связанный с приёмом.");
      return byId.get(id);
    });
  }

  function setEncounterInvestigations(encounter, patient, ids, options = {}) {
    assertEncounter(encounter);
    const updatedAt = investigationChangeTime(options, ["now"]);
    const errors = validateInvestigationIds(ids);
    if (errors.length) throw new Error(errors[0].message);
    const result = { ...encounter, investigationIds: [...ids] };
    encounterInvestigations(result, patient);
    if (JSON.stringify(encounter.investigationIds || []) === JSON.stringify(ids)) return normalizeEncounter(encounter);
    return setReviewStatus({ ...result, updatedAt }, "draft");
  }

  function reconcileInvestigationReferences(beforePatient, afterPatient, encounters, options = {}) {
    assertPatient(beforePatient);
    assertPatient(afterPatient);
    if (beforePatient.id !== afterPatient.id) throw new Error("Изменение результатов должно относиться к одному пациенту.");
    const updatedAt = investigationChangeTime(options, ["now"]);
    if (!Array.isArray(encounters) || encounters.length > MAX_ENCOUNTERS) throw new Error("Ожидается список не более 500 приёмов.");
    const beforeById = new Map((beforePatient.investigations || []).map(item => [item.id, item]));
    const afterById = new Map((afterPatient.investigations || []).map(item => [item.id, item]));
    const comparable = results => results.map(item => [...INVESTIGATION_FIELDS, ...INVESTIGATION_REPORT_FIELDS].map(field => item[field]));
    const encounterIds = new Set();
    return Array.from(encounters, encounter => {
      assertEncounter(encounter);
      if (encounterIds.has(encounter.id)) throw new Error("Повторяющийся идентификатор приёма.");
      encounterIds.add(encounter.id);
      if (encounter.patientId !== beforePatient.id || !encounter.investigationIds?.length) return normalizeEncounter(encounter);
      const previous = encounterInvestigations(encounter, beforePatient);
      const reports = new Set(previous.map(item => item.reportId).filter(Boolean));
      const ids = encounter.investigationIds.filter(id => afterById.has(id));
      for (const item of afterPatient.investigations || []) {
        if (item.reportId && reports.has(item.reportId) && !beforeById.has(item.id) && !ids.includes(item.id)) ids.push(item.id);
      }
      const next = { ...encounter, investigationIds: ids };
      const changed = JSON.stringify(comparable(previous)) !== JSON.stringify(comparable(encounterInvestigations(next, afterPatient)));
      return changed ? setReviewStatus({ ...next, updatedAt }, "draft") : normalizeEncounter(encounter);
    });
  }

  function getInvestigationSeries(patient) {
    assertPatient(patient);
    const groups = new Map();
    for (const item of patient.investigations || []) {
      const name = item.name.trim().replace(/\s+/g, " ");
      const unit = item.unit.trim().replace(/\s+/g, " ");
      const key = JSON.stringify([item.kind, name.toLocaleLowerCase("ru").replace(/ё/g, "е"), unit]);
      if (!groups.has(key)) groups.set(key, { key, kind: item.kind, name, unit, results: [] });
      groups.get(key).results.push({ ...item });
    }
    return [...groups.values()].map(series => {
      series.results.sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id));
      const values = series.results.map(item => {
        const text = item.result.trim();
        const value = DECIMAL_PATTERN.test(text) ? Number(text.replace(",", ".")) : NaN;
        return Number.isFinite(value) ? value : null;
      });
      const reason = series.results.length < 2 ? "insufficient"
        : values.some(value => value === null) ? "non-numeric"
          : new Set(series.results.map(item => item.date)).size !== series.results.length ? "duplicate-date" : "";
      const difference = reason ? null : values[values.length - 1] - values[values.length - 2];
      return {
        ...series,
        numeric: !reason,
        reason,
        points: reason ? [] : series.results.map((item, index) => ({ id: item.id, date: item.date, value: values[index] })),
        delta: difference === null || !Number.isFinite(difference) ? null : difference === 0 ? 0 : difference,
        referenceChanged: new Set(series.results.map(item => item.reference)).size > 1
      };
    }).sort((first, second) => first.name.localeCompare(second.name, "ru") || first.kind.localeCompare(second.kind) || first.unit.localeCompare(second.unit));
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
    encounter.workflow = emptyWorkflow();
    assertEncounter(encounter);
    return encounter;
  }

  function createRepeatEncounter(source, options = {}) {
    assertEncounter(source);
    const fields = options.carryHistoryFields === undefined ? [] : options.carryHistoryFields;
    if (!Array.isArray(fields) || Array.from(fields).some(field => !CARRY_HISTORY_FIELDS.includes(field))) {
      throw new Error("Можно перенести только явно выбранные заболевания, препараты и аллергии.");
    }
    const prescriptionIds = options.carryPrescriptionIds === undefined ? [] : options.carryPrescriptionIds;
    if (!Array.isArray(prescriptionIds) || new Set(prescriptionIds).size !== prescriptionIds.length || Array.from(prescriptionIds).some(id => typeof id !== "string" || !(source.prescriptions || []).some(item => item.id === id))) {
      throw new Error("Для переноса назначений выберите существующие препараты без повторений.");
    }
    const encounter = createEncounter({ id: options.id, now: options.now, patientId: source.patientId });
    if (encounter.id === source.id) throw new Error("У повторного приёма должен быть новый идентификатор.");
    for (const field of fields) encounter.history[field] = source.history[field];
    if (prescriptionIds.length) {
      encounter.prescriptions = source.prescriptions.filter(item => prescriptionIds.includes(item.id)).map(item => ({ ...item, id: newId("prescription") }));
      assertEncounter(encounter);
    }
    return encounter;
  }

  function validateDiagnoses(diagnoses) {
    if (!Array.isArray(diagnoses)) return [{ field: "diagnoses", message: "Диагнозы должны быть массивом." }];
    const errors = [];
    if (diagnoses.length > MAX_DIAGNOSES) errors.push({ field: "diagnoses", message: "Допускается не более 30 диагнозов в одном приёме." });
    const ids = new Set();
    let primaryCount = 0;
    let summaryLength = 0;
    for (let index = 0; index < diagnoses.length; index += 1) {
      const item = diagnoses[index];
      const prefix = "diagnoses." + index;
      if (!isObject(item)) { errors.push({ field: prefix, message: "Ожидается объект диагноза." }); continue; }
      if (Object.keys(item).some(field => !DIAGNOSIS_FIELDS.includes(field)) || DIAGNOSIS_FIELDS.some(field => !Object.prototype.hasOwnProperty.call(item, field))) errors.push({ field: prefix, message: "Неверная структура диагноза." });
      if (typeof item.id !== "string" || !ID_PATTERN.test(item.id) || ids.has(item.id)) errors.push({ field: prefix + ".id", message: "Некорректный или повторяющийся идентификатор диагноза." });
      ids.add(item.id);
      if (typeof item.kind !== "string" || !Object.prototype.hasOwnProperty.call(DIAGNOSIS_LABELS, item.kind)) errors.push({ field: prefix + ".kind", message: "Выберите основной диагноз, сопутствующее заболевание или осложнение." });
      if (item.kind === "primary") primaryCount += 1;
      if (typeof item.text !== "string" || !item.text.trim() || item.text.length > MAX_DIAGNOSIS_TEXT_LENGTH) errors.push({ field: prefix + ".text", message: "Текст диагноза должен содержать от 1 до 10000 символов." });
      if (typeof item.text === "string" && Object.prototype.hasOwnProperty.call(DIAGNOSIS_LABELS, item.kind)) summaryLength += DIAGNOSIS_LABELS[item.kind].length + 2 + item.text.trim().length + (index ? 1 : 0);
    }
    if (primaryCount > 1) errors.push({ field: "diagnoses", message: "Можно указать только один основной диагноз." });
    if (summaryLength > MAX_DIAGNOSIS_SUMMARY_LENGTH) errors.push({ field: "diagnoses", message: "Общий текст диагнозов не должен превышать 100000 символов." });
    return errors;
  }

  function formatDiagnoses(diagnoses) {
    const errors = validateDiagnoses(diagnoses);
    if (errors.length) throw new Error("Некорректные диагнозы: " + errors[0].message);
    return diagnoses.map(item => DIAGNOSIS_LABELS[item.kind] + ": " + item.text.trim()).join("\n");
  }

  function getDiagnoses(encounter) {
    assertEncounter(encounter);
    if (encounter.diagnoses?.length) return encounter.diagnoses.map(item => ({ ...item }));
    return encounter.assessment.summary.trim() ? [{ id: "legacy-diagnosis", kind: "primary", text: encounter.assessment.summary }] : [];
  }

  function diagnosisChangeTime(options, fields) {
    if (!isObject(options) || Object.keys(options).some(field => !fields.includes(field))) throw new Error("Некорректные параметры изменения диагноза.");
    const now = options.now === undefined ? new Date() : new Date(options.now);
    if (!Number.isFinite(now.getTime()) || now.getUTCFullYear() < 1 || now.getUTCFullYear() > 9999) throw new Error("Некорректное время изменения диагноза.");
    return now.toISOString();
  }

  function withDiagnoses(encounter, diagnoses, updatedAt) {
    const result = { ...encounter, assessment: { ...encounter.assessment, summary: formatDiagnoses(diagnoses) }, updatedAt };
    if (diagnoses.length) result.diagnoses = diagnoses;
    else delete result.diagnoses;
    return setReviewStatus(result, "draft");
  }

  function upsertDiagnosis(encounter, values, options = {}) {
    const existing = getDiagnoses(encounter);
    const updatedAt = diagnosisChangeTime(options, ["id", "now"]);
    if (!isObject(values) || Object.keys(values).some(field => !["kind", "text"].includes(field)) || ["kind", "text"].some(field => !Object.prototype.hasOwnProperty.call(values, field))) throw new Error("Неверная структура диагноза.");
    if (options.id !== undefined && (typeof options.id !== "string" || !existing.some(item => item.id === options.id))) throw new Error("Диагноз для изменения не найден.");
    const diagnosis = { id: options.id === undefined ? newId("diagnosis") : options.id, ...values };
    const diagnoses = options.id === undefined ? [...existing, diagnosis] : existing.map(item => item.id === options.id ? diagnosis : item);
    return withDiagnoses(encounter, diagnoses, updatedAt);
  }

  function removeDiagnosis(encounter, id, options = {}) {
    const existing = getDiagnoses(encounter);
    const updatedAt = diagnosisChangeTime(options, ["now"]);
    if (typeof id !== "string" || !existing.some(item => item.id === id)) throw new Error("Диагноз для удаления не найден.");
    return withDiagnoses(encounter, existing.filter(item => item.id !== id), updatedAt);
  }

  function moveDiagnosis(encounter, id, direction, options = {}) {
    const diagnoses = getDiagnoses(encounter);
    const updatedAt = diagnosisChangeTime(options, ["now"]);
    const index = diagnoses.findIndex(item => item.id === id);
    if (typeof id !== "string" || index < 0) throw new Error("Диагноз для перемещения не найден.");
    if (![-1, 1].includes(direction)) throw new Error("Выберите перемещение диагноза на одну позицию вверх или вниз.");
    const target = index + direction;
    if (target < 0 || target >= diagnoses.length) return normalizeEncounter(encounter);
    [diagnoses[index], diagnoses[target]] = [diagnoses[target], diagnoses[index]];
    return withDiagnoses(encounter, diagnoses, updatedAt);
  }

  function validatePrescriptions(prescriptions) {
    if (!Array.isArray(prescriptions)) return [{ field: "prescriptions", message: "Назначения препаратов должны быть массивом." }];
    const errors = [];
    const ids = new Set();
    if (prescriptions.length > MAX_PRESCRIPTIONS) errors.push({ field: "prescriptions", message: "Допускается не более 50 назначений в одном приёме." });
    for (let index = 0; index < prescriptions.length; index += 1) {
      const item = prescriptions[index];
      const prefix = "prescriptions." + index;
      if (!isObject(item)) {
        errors.push({ field: prefix, message: "Ожидается объект назначения препарата." });
        continue;
      }
      for (const field of PRESCRIPTION_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(item, field)) errors.push({ field: prefix + "." + field, message: "Обязательное поле отсутствует." });
        else if (typeof item[field] !== "string") errors.push({ field: prefix + "." + field, message: "Значение должно быть строкой." });
      }
      for (const field of Object.keys(item)) {
        if (!PRESCRIPTION_FIELDS.includes(field)) errors.push({ field: prefix + "." + field, message: "Неизвестное поле назначения препарата." });
      }
      if (typeof item.id === "string") {
        if (!ID_PATTERN.test(item.id) || ids.has(item.id)) errors.push({ field: prefix + ".id", message: "Некорректный или повторяющийся идентификатор назначения." });
        ids.add(item.id);
      }
      for (const field of PRESCRIPTION_VALUE_FIELDS) {
        const limit = field === "note" ? MAX_PRESCRIPTION_NOTE_LENGTH : MAX_PRESCRIPTION_FIELD_LENGTH;
        if (typeof item[field] === "string" && item[field].length > limit) errors.push({ field: prefix + "." + field, message: "Превышен лимит: " + limit + " символов." });
      }
      if (typeof item.name === "string" && !item.name.trim()) errors.push({ field: prefix + ".name", message: "Укажите название препарата." });
    }
    return errors;
  }

  function prescriptionChangeTime(options, fields) {
    if (!isObject(options) || Object.keys(options).some(field => !fields.includes(field))) throw new Error("Некорректные параметры изменения назначения.");
    const now = options.now === undefined ? new Date() : new Date(options.now);
    if (!Number.isFinite(now.getTime()) || now.getUTCFullYear() < 1 || now.getUTCFullYear() > 9999) throw new Error("Некорректное время изменения назначения.");
    return now.toISOString();
  }

  function upsertPrescription(encounter, values, options = {}) {
    assertEncounter(encounter);
    const updatedAt = prescriptionChangeTime(options, ["id", "now"]);
    if (!isObject(values) || Object.keys(values).some(field => !PRESCRIPTION_VALUE_FIELDS.includes(field)) || PRESCRIPTION_VALUE_FIELDS.some(field => !Object.prototype.hasOwnProperty.call(values, field))) throw new Error("Неверная структура назначения препарата.");
    const existing = encounter.prescriptions || [];
    if (options.id !== undefined && (typeof options.id !== "string" || !existing.some(item => item.id === options.id))) throw new Error("Назначение для изменения не найдено.");
    const prescription = { id: options.id === undefined ? newId("prescription") : options.id, ...values };
    const prescriptions = options.id === undefined ? [...existing, prescription] : existing.map(item => item.id === options.id ? prescription : item);
    return setReviewStatus({ ...encounter, prescriptions, updatedAt }, "draft");
  }

  function removePrescription(encounter, id, options = {}) {
    assertEncounter(encounter);
    const updatedAt = prescriptionChangeTime(options, ["now"]);
    if (typeof id !== "string" || !(encounter.prescriptions || []).some(item => item.id === id)) throw new Error("Назначение для удаления не найдено.");
    const result = { ...encounter, updatedAt };
    const prescriptions = encounter.prescriptions.filter(item => item.id !== id);
    if (prescriptions.length) result.prescriptions = prescriptions;
    else delete result.prescriptions;
    return setReviewStatus(result, "draft");
  }

  function formatPrescription(prescription) {
    const errors = validatePrescriptions([prescription]);
    if (errors.length) throw new Error("Некорректное назначение препарата: " + errors[0].message);
    const text = value => value.trim() || "не указано";
    return prescription.name.trim() + ". Дозировка: " + text(prescription.dose)
      + "; способ приёма: " + text(prescription.route)
      + "; кратность: " + text(prescription.frequency)
      + "; длительность: " + text(prescription.duration)
      + (prescription.note.trim() ? "; примечание: " + prescription.note.trim() : "") + ".";
  }

  function validateShortcuts(shortcuts) {
    if (!Array.isArray(shortcuts) || shortcuts.length > MAX_SHORTCUTS) throw new Error("Допускается не более 100 текстовых сокращений.");
    const ids = new Set();
    const codes = new Set();
    return Array.from(shortcuts, shortcut => {
      const fields = ["id", "code", "text"];
      if (!isObject(shortcut) || Object.keys(shortcut).some(field => !fields.includes(field)) || fields.some(field => !Object.prototype.hasOwnProperty.call(shortcut, field))) throw new Error("Неверная структура текстового сокращения.");
      if (typeof shortcut.id !== "string" || !ID_PATTERN.test(shortcut.id) || ids.has(shortcut.id)) throw new Error("Некорректный или повторяющийся идентификатор сокращения.");
      if (typeof shortcut.code !== "string") throw new Error("Обозначение сокращения должно быть текстом.");
      const code = shortcut.code.trim();
      if (!code || code.length > MAX_SHORTCUT_CODE_LENGTH || !/^[\p{L}\p{N}._-]+$/u.test(code)) throw new Error("Обозначение сокращения должно содержать от 1 до 40 букв, цифр или символов . _ - без пробелов.");
      const key = code.toLocaleLowerCase("ru-RU");
      if (codes.has(key)) throw new Error("Такое обозначение сокращения уже существует.");
      if (typeof shortcut.text !== "string" || !shortcut.text.trim() || shortcut.text.length > MAX_SHORTCUT_TEXT_LENGTH) throw new Error("Текст сокращения должен содержать от 1 до 10000 символов.");
      ids.add(shortcut.id);
      codes.add(key);
      return { id: shortcut.id, code, text: shortcut.text };
    });
  }

  function upsertShortcut(shortcuts, values, options = {}) {
    const existing = validateShortcuts(shortcuts);
    if (!isObject(options) || Object.keys(options).some(field => field !== "id")) throw new Error("Некорректные параметры текстового сокращения.");
    if (!isObject(values) || Object.keys(values).some(field => !["code", "text"].includes(field)) || !Object.prototype.hasOwnProperty.call(values, "code") || !Object.prototype.hasOwnProperty.call(values, "text")) throw new Error("Укажите обозначение и текст сокращения.");
    if (options.id !== undefined && (typeof options.id !== "string" || !existing.some(item => item.id === options.id))) throw new Error("Сокращение для изменения не найдено.");
    const shortcut = { id: options.id === undefined ? newId("shortcut") : options.id, code: values.code, text: values.text };
    return validateShortcuts(options.id === undefined ? [...existing, shortcut] : existing.map(item => item.id === options.id ? shortcut : item));
  }

  function removeShortcut(shortcuts, id) {
    const existing = validateShortcuts(shortcuts);
    if (typeof id !== "string" || !existing.some(item => item.id === id)) throw new Error("Сокращение для удаления не найдено.");
    return existing.filter(item => item.id !== id);
  }

  function assertShortcutSelection(value, start, end) {
    if (typeof value !== "string" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > value.length) throw new Error("Некорректное выделение текста для вставки сокращения.");
  }

  function shortcutToken(value, start, end) {
    if (/^[\p{L}\p{N}._-]/u.test(value.slice(end))) return null;
    if (start !== end) {
      if (/[\p{L}\p{N}._-]$/u.test(value.slice(0, start))) return null;
      return { text: value.slice(start, end), start };
    }
    const token = value.slice(0, start).match(/[\p{L}\p{N}._-]+$/u);
    return token ? { text: token[0], start: start - token[0].length } : null;
  }

  function findShortcutAtCaret(value, start, end, shortcuts) {
    assertShortcutSelection(value, start, end);
    const existing = validateShortcuts(shortcuts);
    const token = shortcutToken(value, start, end);
    return token ? existing.find(item => item.code.toLocaleLowerCase("ru-RU") === token.text.toLocaleLowerCase("ru-RU")) || null : null;
  }

  function shortcutReplacement(value, start, end, shortcut, maxLength) {
    assertShortcutSelection(value, start, end);
    if (!Number.isInteger(maxLength) || maxLength < 0) throw new Error("Некорректное ограничение длины поля.");
    const saved = validateShortcuts([shortcut])[0];
    let replacementStart = start;
    if (start === end) {
      const token = shortcutToken(value, start, end);
      if (token && saved.code.toLocaleLowerCase("ru-RU") === token.text.toLocaleLowerCase("ru-RU")) replacementStart = token.start;
    }
    const result = value.slice(0, replacementStart) + saved.text + value.slice(end);
    if (result.length > maxLength) throw new Error("После вставки текст превышает допустимую длину поля. Сократите текст или выделите фрагмент для замены.");
    const caret = replacementStart + saved.text.length;
    return { value: result, selectionStart: caret, selectionEnd: caret };
  }

  function validateTemplates(templates) {
    if (!Array.isArray(templates) || templates.length > MAX_TEMPLATES) throw new Error("Допускается не более 100 личных шаблонов.");
    const ids = new Set();
    return Array.from(templates, template => {
      const fields = ["id", "name", "kind", "createdAt", "updatedAt", "content"];
      if (!isObject(template) || Object.keys(template).some(field => !fields.includes(field)) || fields.some(field => !Object.prototype.hasOwnProperty.call(template, field))) throw new Error("Неверная структура личного шаблона.");
      if (typeof template.id !== "string" || !ID_PATTERN.test(template.id) || ids.has(template.id)) throw new Error("Некорректный или повторяющийся идентификатор шаблона.");
      ids.add(template.id);
      if (typeof template.name !== "string" || !template.name.trim() || template.name.length > MAX_TEMPLATE_NAME_LENGTH) throw new Error("Название шаблона должно содержать от 1 до 120 символов.");
      if (!["exam", "recommendations"].includes(template.kind)) throw new Error("Шаблон может содержать только осмотр или рекомендации.");
      if (["createdAt", "updatedAt"].some(field => typeof template[field] !== "string" || !validTimestamp(template[field]))) throw new Error("Некорректная дата создания или изменения шаблона.");
      const contentFields = template.kind === "exam" ? ["exam", "examSelections"] : ["plan"];
      if (!isObject(template.content) || Object.keys(template.content).some(field => !contentFields.includes(field)) || contentFields.some(field => !Object.prototype.hasOwnProperty.call(template.content, field))) throw new Error("Содержание шаблона не соответствует выбранному разделу.");
      const sample = createEncounter({ id: "template-validation", now: template.createdAt });
      if (template.kind === "exam") {
        sample.exam = template.content.exam;
        sample.examSelections = template.content.examSelections;
      } else sample.assessment.plan = template.content.plan;
      assertEncounter(sample, "Некорректное содержание шаблона");
      const values = template.kind === "exam" ? [...Object.values(sample.exam), ...Object.values(sample.examSelections)] : [sample.assessment.plan];
      if (!values.some(value => value.trim())) throw new Error("В пустом разделе нечего сохранять в шаблон.");
      return {
        id: template.id, name: template.name, kind: template.kind, createdAt: template.createdAt, updatedAt: template.updatedAt,
        content: template.kind === "exam" ? { exam: { ...sample.exam }, examSelections: { ...sample.examSelections } } : { plan: sample.assessment.plan }
      };
    });
  }

  function createVisitTemplate(encounter, options) {
    assertEncounter(encounter);
    if (!isObject(options) || Object.keys(options).some(field => !["name", "kind", "id", "now"].includes(field))) throw new Error("Некорректные параметры личного шаблона.");
    const now = options.now === undefined ? new Date() : new Date(options.now);
    if (!Number.isFinite(now.getTime()) || now.getUTCFullYear() < 1 || now.getUTCFullYear() > 9999) throw new Error("Некорректное время создания шаблона.");
    const template = {
      id: options.id === undefined ? newId("template") : options.id,
      name: typeof options.name === "string" ? options.name.trim() : options.name,
      kind: options.kind, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      content: options.kind === "exam" ? { exam: { ...encounter.exam }, examSelections: { ...encounter.examSelections } } : { plan: encounter.assessment.plan }
    };
    return validateTemplates([template])[0];
  }

  function applyVisitTemplate(encounter, template) {
    assertEncounter(encounter);
    const saved = validateTemplates([template])[0];
    const updated = normalizeEncounter(encounter);
    if (saved.kind === "exam") {
      updated.exam = saved.content.exam;
      updated.examSelections = saved.content.examSelections;
    } else updated.assessment.plan = saved.content.plan;
    updated.updatedAt = new Date().toISOString();
    return setReviewStatus(updated, "draft");
  }

  function setReviewStatus(encounter, status, options = {}) {
    if (!["draft", "reviewed"].includes(status)) throw new Error("Неизвестный статус проверки записи.");
    let reviewedAt = "";
    if (status === "reviewed") {
      const now = options.now === undefined ? new Date() : new Date(options.now);
      if (!Number.isFinite(now.getTime()) || now.getUTCFullYear() < 1 || now.getUTCFullYear() > 9999) throw new Error("Некорректное время проверки записи.");
      reviewedAt = now.toISOString();
    }
    const result = { ...encounter, workflow: { ...encounter?.workflow, reviewStatus: status, reviewedAt } };
    assertEncounter(result);
    return normalizeEncounter(result);
  }

  function setReturnVisitStatus(encounter, status) {
    if (!["planned", "completed"].includes(status)) throw new Error("Неизвестная отметка повторного приёма.");
    const result = { ...encounter, workflow: { ...encounter?.workflow, returnVisitStatus: status } };
    assertEncounter(result);
    return normalizeEncounter(result);
  }

  function linkReturnVisit(source, target) {
    assertEncounter(source);
    assertEncounter(target);
    if (!source.assessment.returnVisitDate) throw new Error("Для связи повторного приёма сначала укажите его дату.");
    if (source.id === target.id) throw new Error("Повторный приём не может ссылаться на себя.");
    if (source.patientId !== target.patientId) throw new Error("Повторный приём должен относиться к тому же пациенту.");
    if (source.workflow.returnVisitEncounterId && source.workflow.returnVisitEncounterId !== target.id) throw new Error("У этой даты уже есть связанный повторный приём.");
    if (target.workflow.returnVisitEncounterId === source.id) throw new Error("Связи повторных приёмов не должны образовывать цикл.");
    return normalizeEncounter({ ...source, workflow: { ...source.workflow, returnVisitEncounterId: target.id } });
  }

  function getReturnVisits(encounters, today) {
    if (!Array.isArray(encounters)) throw new Error("Список приёмов должен быть массивом.");
    if (typeof today !== "string" || !validDate(today)) throw new Error("Укажите сегодняшнюю дату в формате ГГГГ-ММ-ДД.");
    for (const encounter of encounters) {
      if (!isObject(encounter) || ["id", "patientId"].some(field => typeof encounter[field] !== "string" || !ID_PATTERN.test(encounter[field]))) throw new Error("Для списка повторных приёмов требуется корректный идентификатор приёма и пациента.");
      const date = encounter.assessment?.returnVisitDate;
      if (typeof date !== "string" || (date !== "" && !validDate(date))) throw new Error("Укажите существующую дату повторного приёма в формате ГГГГ-ММ-ДД.");
      const workflow = encounter.workflow;
      if (!isObject(workflow) || !["planned", "completed"].includes(workflow.returnVisitStatus)) throw new Error("Выберите отметку повторного приёма.");
      if (typeof workflow.returnVisitEncounterId !== "string" || (workflow.returnVisitEncounterId !== "" && !ID_PATTERN.test(workflow.returnVisitEncounterId))) throw new Error("Некорректная ссылка повторного приёма.");
      if (workflow.returnVisitEncounterId === encounter.id) throw new Error("Повторный приём не может ссылаться на себя.");
      if (!date && (workflow.returnVisitStatus === "completed" || workflow.returnVisitEncounterId !== "")) throw new Error("Для отметки или связи повторного приёма укажите дату.");
    }
    return encounters.filter(encounter => encounter.assessment.returnVisitDate).map(encounter => {
      const date = encounter.assessment.returnVisitDate;
      return {
        encounterId: encounter.id,
        patientId: encounter.patientId,
        date,
        bucket: encounter.workflow.returnVisitStatus === "completed" ? "completed" : date === today ? "today" : date > today ? "upcoming" : "past",
        linkedEncounterId: encounter.workflow.returnVisitEncounterId
      };
    }).sort((first, second) => first.date < second.date ? -1 : first.date > second.date ? 1 : first.encounterId < second.encounterId ? -1 : first.encounterId > second.encounterId ? 1 : 0);
  }

  function getPatientBriefing(patient, encounters, today) {
    assertPatient(patient);
    if (typeof today !== "string" || !validDate(today)) throw new Error("Укажите сегодняшнюю дату в формате ГГГГ-ММ-ДД.");
    if (!Array.isArray(encounters) || encounters.length > MAX_ENCOUNTERS) throw new Error("Ожидается список не более 500 приёмов.");
    const ids = new Set();
    for (const encounter of encounters) {
      assertEncounter(encounter);
      if (ids.has(encounter.id)) throw new Error("Повторный идентификатор приёма.");
      ids.add(encounter.id);
    }
    const visits = encounters.filter(encounter => encounter.patientId === patient.id).sort((first, second) =>
      second.visitDate.localeCompare(first.visitDate) || second.createdAt.localeCompare(first.createdAt) || first.id.localeCompare(second.id));
    const facts = Object.fromEntries(CARRY_HISTORY_FIELDS.map(field => {
      const source = visits.find(encounter => encounter.history[field].trim());
      return [field, source ? { encounterId: source.id, date: source.visitDate, text: source.history[field] } : null];
    }));
    const prescriptionSource = visits.find(encounter => encounter.prescriptions?.length);
    const investigations = [
      ...getInvestigationReports(patient).map(report => ({
        id: report.id, type: "report", date: report.date, title: report.title, kind: report.kind, results: report.results
      })),
      ...(patient.investigations || []).filter(item => !item.reportId).map(item => ({
        id: item.id, type: "result", date: item.date, title: item.name, kind: item.kind, results: [{ ...item }]
      }))
    ].sort((first, second) => second.date.localeCompare(first.date) || first.id.localeCompare(second.id) || first.type.localeCompare(second.type));
    const journal = getSickLeaveJournal(patient, visits);
    const returnVisits = getReturnVisits(visits, today);
    return {
      patientId: patient.id,
      today,
      visitCount: visits.length,
      diagnoses: visits.filter(encounter => encounter.assessment.summary.trim()).slice(0, 3).map(encounter => ({
        encounterId: encounter.id, date: encounter.visitDate, text: encounter.assessment.summary, reviewStatus: encounter.workflow.reviewStatus
      })),
      facts,
      prescriptions: prescriptionSource ? {
        encounterId: prescriptionSource.id, date: prescriptionSource.visitDate, items: prescriptionSource.prescriptions.map(item => ({ ...item }))
      } : null,
      investigations: investigations.slice(0, 3),
      investigationCount: investigations.length,
      sickLeaves: { open: journal.leaves.filter(leave => leave.status === "open"), legacy: journal.legacy },
      nextReturn: returnVisits.find(item => item.bucket === "today" || item.bucket === "upcoming") || null,
      overdueReturnCount: returnVisits.filter(item => item.bucket === "past").length
    };
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
    const groups = version === 1 ? LEGACY_GROUPS : version < 4 ? V2_GROUPS : GROUPS;
    const rootFields = version === 1 ? LEGACY_ROOT_FIELDS : version === 2 ? V2_ROOT_FIELDS : version === 3 ? V3_ROOT_FIELDS : ROOT_FIELDS;
    const errors = [];
    function problem(field, message) { errors.push({ field, message }); }
    function shape(value, fields, prefix, optionalFields = []) {
      if (!isObject(value)) {
        problem(prefix || "encounter", "Ожидается объект с полями приёма.");
        return false;
      }
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(value, field)) problem(prefix ? prefix + "." + field : field, "Обязательное поле отсутствует.");
      }
      for (const field of Object.keys(value)) {
        if (!fields.includes(field) && !optionalFields.includes(field)) problem(prefix ? prefix + "." + field : field, "Неизвестное поле для версии данных " + version + ".");
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
    if (!shape(encounter, rootFields, "", version >= 4 ? ["prescriptions", "investigationIds", "diagnoses"] : [])) return errors;
    if (version >= 4 && Object.prototype.hasOwnProperty.call(encounter, "prescriptions")) errors.push(...validatePrescriptions(encounter.prescriptions));
    if (version >= 4 && Object.prototype.hasOwnProperty.call(encounter, "investigationIds")) errors.push(...validateInvestigationIds(encounter.investigationIds));
    if (version >= 4 && Object.prototype.hasOwnProperty.call(encounter, "diagnoses")) {
      const diagnosisErrors = validateDiagnoses(encounter.diagnoses);
      errors.push(...diagnosisErrors);
      if (!diagnosisErrors.length && encounter.diagnoses.length && encounter.assessment?.summary !== formatDiagnoses(encounter.diagnoses)) problem("assessment.summary", "Текст диагноза не соответствует списку диагнозов.");
    }
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
        const limit = group === "draft" && field === "text" ? MAX_DRAFT_LENGTH : group === "draft" && field === "sourceFingerprint" ? MAX_FINGERPRINT_LENGTH : group === "assessment" && field === "summary" && Array.isArray(encounter.diagnoses) && encounter.diagnoses.length ? MAX_DIAGNOSIS_SUMMARY_LENGTH : MAX_TEXT_LENGTH;
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
    if (version >= 4 && isObject(encounter.workflow)) {
      const workflow = encounter.workflow;
      if (!["draft", "reviewed"].includes(workflow.reviewStatus)) problem("workflow.reviewStatus", "Выберите статус проверки записи.");
      if (workflow.reviewStatus === "reviewed") {
        if (typeof workflow.reviewedAt !== "string" || !validTimestamp(workflow.reviewedAt)) problem("workflow.reviewedAt", "Для проверенной записи требуется дата и время проверки.");
        if (typeof encounter.draft?.text !== "string" || !encounter.draft.text.trim()) problem("draft.text", "Для проверки врачом заполните текст записи.");
      } else if (workflow.reviewedAt !== "") problem("workflow.reviewedAt", "У черновика не должно быть даты проверки.");
      if (!["planned", "completed"].includes(workflow.returnVisitStatus)) problem("workflow.returnVisitStatus", "Выберите отметку повторного приёма.");
      if (typeof workflow.returnVisitEncounterId === "string" && workflow.returnVisitEncounterId !== "" && !ID_PATTERN.test(workflow.returnVisitEncounterId)) problem("workflow.returnVisitEncounterId", "Некорректная ссылка повторного приёма.");
      if (workflow.returnVisitEncounterId === encounter.id) problem("workflow.returnVisitEncounterId", "Повторный приём не может ссылаться на себя.");
      if (!encounter.assessment?.returnVisitDate && (workflow.returnVisitStatus === "completed" || workflow.returnVisitEncounterId !== "")) problem("assessment.returnVisitDate", "Для отметки или связи повторного приёма укажите дату.");
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
    if (encounter.prescriptions?.length) source.prescriptions = encounter.prescriptions.map(item => Object.fromEntries(PRESCRIPTION_VALUE_FIELDS.map(field => [field, item[field]])));
    if (encounter.diagnoses?.length) source.diagnoses = encounter.diagnoses.map(item => ({ ...item }));
    return source;
  }

  function selectedInvestigationData(encounter, context) {
    if (!encounter.investigationIds?.length) return [];
    if (!isObject(context) || !isObject(context.patient)) throw new Error("Для формирования записи с исследованиями требуется карточка пациента с результатами.");
    return encounterInvestigations(encounter, context.patient);
  }

  function investigationDraftLines(results, format) {
    if (!results.length) return [];
    const reports = new Map();
    for (const item of results) {
      const key = item.reportId ? "report:" + item.reportId : "result:" + item.id;
      if (!reports.has(key)) reports.set(key, { id: key, title: item.reportTitle || "", date: item.date, results: [] });
      reports.get(key).results.push(item);
    }
    const lines = format.headings ? [format.titles.investigations] : [];
    for (const report of [...reports.values()].sort((first, second) => second.date.localeCompare(first.date) || first.id.localeCompare(second.id))) {
      const date = report.date.split("-").reverse().join(".");
      if (report.title) lines.push(report.title.trim() + " от " + date + ":");
      for (const item of report.results) {
        lines.push((report.title ? "" : date + " — ") + item.name.trim() + ": " + item.result.trim()
          + (item.kind === "lab" && item.unit.trim() ? " " + item.unit.trim() : "")
          + (item.reference.trim() ? "; нормы из бланка: " + item.reference.trim() : "")
          + (item.note.trim() ? "; примечание: " + item.note.trim() : ""));
      }
    }
    return [...lines, ""];
  }

  function fingerprint(encounter, context) {
    assertEncounter(encounter);
    const source = sourceData(encounter);
    const investigations = selectedInvestigationData(encounter, context);
    if (investigations.length) source.investigations = investigations.map(item => Object.fromEntries([...INVESTIGATION_VALUE_FIELDS, ...INVESTIGATION_REPORT_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(item, field))].map(field => [field, item[field]])));
    if (context !== undefined) {
      source.age = encounterAge(encounter, context.patient);
      if (context.patient.birthDate) source.birthDate = context.patient.birthDate;
      const summary = getEncounterSickLeaveSummary(encounter, context.patient, context.encounters);
      if (summary.hasPrevious) source.sickLeaveSummary = { from: summary.from, to: summary.to, totalDays: summary.totalDays };
      const action = getEncounterSickLeaveAction(context.patient, encounter);
      if (action) source.sickLeaveAction = { leaveId: action.leave.id, eventId: action.event.id, type: action.event.type };
    }
    const result = JSON.stringify(source);
    if (result.length > MAX_FINGERPRINT_LENGTH) throw new Error("Данные для черновика слишком велики. Сократите текст или число выбранных исследований.");
    return result;
  }

  function generateDraft(encounter, context, recordFormat = DEFAULT_RECORD_FORMAT) {
    assertEncounter(encounter);
    const format = validateRecordFormat(recordFormat);
    const investigations = selectedInvestigationData(encounter, context);
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
      const days = calculateSickLeaveDays(assessment.sickLeaveFrom, assessment.sickLeaveTo);
      const summary = context === undefined ? null : getEncounterSickLeaveSummary(encounter, context.patient, context.encounters);
      const action = context === undefined ? null : getEncounterSickLeaveAction(context.patient, encounter);
      if (action) {
        const wording = { issue: "выдан", extend: "продлён", close: "закрыт" };
        return [format.titles.sickLeave + ": " + wording[action.event.type] + "."
          + (action.leave.number.trim() ? " № " + action.leave.number.trim() + "." : "")
          + (action.event.type === "close" ? " Дата закрытия: " + formatDate(action.event.to) + "." : " Период: " + period.join(" ") + ". Календарных дней за текущий период: " + summary.periodDays + ".")
          + " Всего по этому больничному: " + summary.totalDays + " календарных дней."];
      }
      const count = summary?.hasPrevious
        ? " Календарных дней за текущий период: " + days + ". Всего за непрерывный период с " + formatDate(summary.from) + " по " + formatDate(summary.to) + ": " + summary.totalDays + "."
        : days !== null ? " Календарных дней: " + days + "." : "";
      return [format.titles.sickLeave + ": выдан."
        + (assessment.sickLeaveNumber.trim() ? " № " + assessment.sickLeaveNumber.trim() + "." : "")
        + (period.length ? " Период: " + period.join(" ") + "." : "")
        + count];
    }
    const date = encounter.visitDate ? formatDate(encounter.visitDate) : "не указана";
    const bmi = calculateBmi(encounter.vitals.weight, encounter.vitals.height);
    const examLines = [
      "Общий осмотр: " + examText("general"),
      "Сердечно-сосудистая система: " + examText("cardiovascular"),
      "Дыхательная система: " + examText("respiratory"),
      "Живот: " + examText("abdomen"),
      "Неврологический статус: " + examText("neurological"),
      ...optional("Другие данные осмотра", encounter.exam.other)
    ];
    const vitalLines = [
      line(format.shortLabels ? "САД" : "Систолическое АД", encounter.vitals.systolic, " мм рт. ст."),
      line(format.shortLabels ? "ДАД" : "Диастолическое АД", encounter.vitals.diastolic, " мм рт. ст."),
      line("Пульс", encounter.vitals.pulse, " уд/мин"),
      line(format.shortLabels ? "Т" : "Температура", encounter.vitals.temperature, " °C"),
      line(format.shortLabels ? "ЧДД" : "Частота дыхания", encounter.vitals.respiratoryRate, " в мин"),
      line("SpO₂", encounter.vitals.spo2, " %"),
      line(format.shortLabels ? "Масса" : "Масса тела", encounter.vitals.weight, " кг"),
      line("Рост", encounter.vitals.height, " см"),
      ...(bmi ? [(format.shortLabels ? "ИМТ" : "Индекс массы тела") + ": " + bmi + " кг/м²."] : [])
    ];
    const recommendations = format.recommendationsStyle === "list" && encounter.assessment.plan.trim()
      ? [format.titles.recommendations + ":", ...encounter.assessment.plan.split(/\r\n|\r|\n/).map(value => value.trim()).filter(Boolean).map(value => "• " + value)]
      : optional(format.titles.recommendations, encounter.assessment.plan);
    const sections = {
      history: [
        ...(format.headings ? [format.titles.history] : []),
        "Жалобы: " + text(encounter.history.complaints),
        "Начало симптомов: " + text(encounter.history.onset),
        "Течение: " + text(encounter.history.course),
        "Известные заболевания: " + text(encounter.history.conditions),
        "Принимаемые препараты на постоянной основе: " + text(encounter.history.medications),
        "Аллергии и реакции: " + text(encounter.history.allergies),
        ...optional("Дополнительный анамнез", encounter.history.context),
        ""
      ],
      exam: [
        ...(format.headings ? [format.titles.exam] : []),
        ...(format.examStyle === "paragraph"
          ? [[...examLines, ...vitalLines].map(value => {
            const sentence = value.replace(/\s*[\r\n]+\s*/g, " ").trim();
            return /[.!?;]$/.test(sentence) ? sentence : sentence + ".";
          }).join(" ")]
          : [...examLines, "", ...(format.headings ? ["ПОКАЗАТЕЛИ"] : []), ...vitalLines]),
        ""
      ],
      investigations: investigationDraftLines(investigations, format),
      diagnosis: [
        ...(format.headings ? ["ЗАКЛЮЧЕНИЕ"] : []),
        ...(encounter.diagnoses?.length
          ? [(format.titles.diagnosis === DEFAULT_RECORD_FORMAT.titles.diagnosis ? "Диагнозы" : format.titles.diagnosis) + ":", ...formatDiagnoses(encounter.diagnoses).split("\n")]
          : [format.titles.diagnosis + ": " + text(encounter.assessment.summary)])
      ],
      recommendations: [
        ...recommendations,
        ...optional("Наблюдение (из предыдущей версии)", encounter.assessment.followUp),
        ...(encounter.prescriptions?.length ? ["Назначения препаратов:", ...encounter.prescriptions.map((item, index) => (index + 1) + ". " + formatPrescription(item))] : [])
      ],
      sickLeave: sickLeave()
    };
    const draft = [
      "МЕДАССИСТЕНТ · ДЕМОНСТРАЦИОННЫЙ ЧЕРНОВИК",
      "Только вымышленные данные. Неофициальный шаблон; не является нормативной формой Республики Беларусь.",
      "Автоматически собран из введённых полей. Требует проверки и редактирования врачом.",
      "",
      "Демо-пациент. Дата приёма: " + date + ".",
      line("Возраст (полных лет)", encounterAge(encounter, context?.patient)),
      "Пол: " + SEXES[encounter.sex] + ".",
      "",
      ...format.order.flatMap(section => sections[section]),
      ...optional(format.titles.returnVisit, encounter.assessment.returnVisitDate ? formatDate(encounter.assessment.returnVisitDate) : "")
    ].join("\n");
    if (draft.length > MAX_DRAFT_LENGTH) throw new Error("Черновик превышает 100000 символов. Сократите текст в полях приёма и повторите генерацию.");
    return draft;
  }

  function normalizeEncounter(encounter, version = SCHEMA_VERSION) {
    const groups = version === 1 ? LEGACY_GROUPS : version < 4 ? V2_GROUPS : GROUPS;
    const rootFields = version === 1 ? LEGACY_ROOT_FIELDS : version === 2 ? V2_ROOT_FIELDS : version === 3 ? V3_ROOT_FIELDS : ROOT_FIELDS;
    const result = {};
    for (const field of rootFields) {
      result[field] = Object.prototype.hasOwnProperty.call(groups, field)
        ? Object.fromEntries(groups[field].map(key => [key, encounter[field][key]]))
        : encounter[field];
    }
    if (version >= 4 && encounter.prescriptions?.length) result.prescriptions = encounter.prescriptions.map(item => Object.fromEntries(PRESCRIPTION_FIELDS.map(field => [field, item[field]])));
    if (version >= 4 && encounter.investigationIds?.length) result.investigationIds = [...encounter.investigationIds];
    if (version >= 4 && encounter.diagnoses?.length) result.diagnoses = encounter.diagnoses.map(item => ({ ...item }));
    return result;
  }

  function validateBundle(value) {
    return validateBundleVersion(value, SCHEMA_VERSION);
  }

  function validateBundleVersion(value, version) {
    if (!isObject(value)) throw new Error("Резервная копия должна быть объектом JSON.");
    const fields = ["format", "schemaVersion", "exportedAt", ...(version >= 3 ? ["patients"] : []), "encounters"];
    if (Object.keys(value).some(field => !fields.includes(field) && !(version >= 4 && ["templates", "shortcuts"].includes(field))) || fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))) {
      throw new Error("Неверная структура резервной копии: ожидаются " + fields.join(", ") + ".");
    }
    if (value.format !== FORMAT) throw new Error("Этот файл не является резервной копией МедАссистента.");
    if (value.schemaVersion !== version) throw new Error("Неподдерживаемая версия данных. Поддерживается версия 4 и импорт резервных копий версий 1, 2 и 3.");
    if (typeof value.exportedAt !== "string" || !validTimestamp(value.exportedAt)) throw new Error("В резервной копии указана некорректная дата экспорта.");
    const templates = Object.prototype.hasOwnProperty.call(value, "templates") ? validateTemplates(value.templates) : [];
    const shortcuts = Object.prototype.hasOwnProperty.call(value, "shortcuts") ? validateShortcuts(value.shortcuts) : [];
    const patientIds = new Set();
    let patients;
    if (version >= 3) {
      if (!Array.isArray(value.patients)) throw new Error("Список карточек пациентов в резервной копии должен быть массивом.");
      if (value.patients.length > MAX_PATIENTS) throw new Error("В одном файле допускается не более 500 демонстрационных карточек пациентов.");
      patients = value.patients.map((patient, index) => {
        assertPatient(patient, "Карточка пациента №" + (index + 1));
        if (version < 4 && Object.prototype.hasOwnProperty.call(patient, "sickLeaves")) throw new Error("Журнал больничных не поддерживается в резервной копии версии " + version + ".");
        if (version < 4 && Object.prototype.hasOwnProperty.call(patient, "investigations")) throw new Error("Анализы и исследования не поддерживаются в резервной копии версии " + version + ".");
        if (version < 4 && Object.prototype.hasOwnProperty.call(patient, "birthDate")) throw new Error("Дата рождения не поддерживается в резервной копии версии " + version + ".");
        if (version < 4 && Object.prototype.hasOwnProperty.call(patient, "personalNote")) throw new Error("Личная заметка не поддерживается в резервной копии версии " + version + ".");
        if (patientIds.has(patient.id)) throw new Error("В резервной копии повторяется идентификатор карточки пациента №" + (index + 1) + ".");
        patientIds.add(patient.id);
        return normalizePatient(patient);
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
    if (version >= 4) {
      const byId = new Map(encounters.map(encounter => [encounter.id, encounter]));
      for (const patient of patients) {
        assertSickLeaveLinks(patient, encounters);
      }
      const patientsById = new Map(patients.map(patient => [patient.id, patient]));
      for (const encounter of encounters) {
        const patient = patientsById.get(encounter.patientId);
        if (patient.birthDate && calculateAge(patient.birthDate, encounter.visitDate) === null) throw new Error("Укажите корректную дату приёма не раньше даты рождения пациента.");
        if (encounter.investigationIds?.length) encounterInvestigations(encounter, patientsById.get(encounter.patientId));
      }
      const linkedIds = new Set();
      for (const encounter of encounters) {
        const targetId = encounter.workflow.returnVisitEncounterId;
        if (!targetId) continue;
        const target = byId.get(targetId);
        if (!target) throw new Error("Для повторного приёма отсутствует связанная запись.");
        if (target.patientId !== encounter.patientId) throw new Error("Связанный повторный приём относится к другому пациенту.");
        if (linkedIds.has(targetId)) throw new Error("Один повторный приём не может быть связан с несколькими датами.");
        linkedIds.add(targetId);
      }
      for (const encounter of encounters) {
        const visited = new Set();
        let current = encounter;
        while (current) {
          if (visited.has(current.id)) throw new Error("Связи повторных приёмов не должны образовывать цикл.");
          visited.add(current.id);
          current = byId.get(current.workflow.returnVisitEncounterId);
        }
      }
    }
    return { format: FORMAT, schemaVersion: version, exportedAt: value.exportedAt, ...(version >= 3 ? { patients } : {}), encounters, ...(templates.length ? { templates } : {}), ...(shortcuts.length ? { shortcuts } : {}) };
  }

  function serializeBundle(encounters, patients, templates, shortcuts) {
    return JSON.stringify(validateBundle({ format: FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), patients, encounters, ...(templates === undefined ? {} : { templates }), ...(shortcuts === undefined ? {} : { shortcuts }) }), null, 2);
  }

  function parseBundle(text) {
    if (typeof text !== "string") throw new Error("Содержимое резервной копии должно быть текстом JSON.");
    let parsed;
    try { parsed = JSON.parse(text.replace(/^\uFEFF/, "")); }
    catch { throw new Error("Не удалось прочитать JSON. Файл повреждён или имеет другой формат."); }
    if (isObject(parsed) && [1, 2, 3].includes(parsed.schemaVersion)) {
      const legacy = validateBundleVersion(parsed, parsed.schemaVersion);
      const encounters = legacy.encounters.map(encounter => ({
        ...encounter,
        patientId: legacy.schemaVersion === 3 ? encounter.patientId : encounter.id,
        workflow: emptyWorkflow(),
        ...(legacy.schemaVersion === 1 ? {
          assessment: { ...encounter.assessment, ...Object.fromEntries(NEW_ASSESSMENT_FIELDS.map(field => [field, ""])) },
          examSelections: Object.fromEntries(GROUPS.examSelections.map(field => [field, ""]))
        } : {})
      }));
      const patients = legacy.schemaVersion === 3 ? legacy.patients : legacy.encounters.map(encounter => ({ id: encounter.id, label: "", createdAt: encounter.createdAt, updatedAt: encounter.updatedAt }));
      return validateBundle({ ...legacy, schemaVersion: SCHEMA_VERSION, patients, encounters });
    }
    return validateBundle(parsed);
  }

  return Object.freeze({ validateShortcuts, upsertShortcut, removeShortcut, findShortcutAtCaret, shortcutReplacement, MAX_SHORTCUTS, MAX_SHORTCUT_CODE_LENGTH, MAX_SHORTCUT_TEXT_LENGTH, DEFAULT_RECORD_FORMAT, RECORD_SECTIONS, validateRecordFormat, setPatientNote, MAX_PERSONAL_NOTE_LENGTH, calculateAge, encounterAge, getDiagnoses, formatDiagnoses, upsertDiagnosis, removeDiagnosis, moveDiagnosis, validateDiagnoses, MAX_DIAGNOSES, MAX_DIAGNOSIS_TEXT_LENGTH, MAX_DIAGNOSIS_SUMMARY_LENGTH, DIAGNOSIS_LABELS, createPatient, createEncounter, createRepeatEncounter, createDemoEncounter, upsertInvestigation, removeInvestigation, validateInvestigations, getInvestigationSeries, getInvestigationReports, upsertInvestigationReport, removeInvestigationReport, setEncounterInvestigations, reconcileInvestigationReferences, upsertPrescription, removePrescription, formatPrescription, validatePrescriptions, setReviewStatus, setReturnVisitStatus, linkReturnVisit, getReturnVisits, getPatientBriefing, calculateBmi, calculateEgfrCkdEpi2021, calculateCockcroftGault, scoreChadsVasc, scoreHasBled, scoreCrb65, scoreCentor, calculateFib4, calculateQtc, scoreFindrisc, scorePhq9, scoreGad7, calculateScore2, findLatestLabResult, calculateSickLeaveDays, calculateSickLeaveTotalDays, getSickLeaveJournal, getEncounterSickLeaveSummary, getEncounterSickLeaveAction, applyEncounterSickLeave, undoEncounterSickLeave, issueSickLeave, extendSickLeave, closeSickLeave, undoSickLeaveAction, createVisitTemplate, applyVisitTemplate, validateTemplates, generateDraft, fingerprint, validatePatient, validateEncounter, validateBundle, serializeBundle, parseBundle, MAX_ENCOUNTERS, MAX_PATIENTS, MAX_PATIENT_LABEL_LENGTH, MAX_SICK_LEAVES, MAX_SICK_LEAVE_EVENTS, MAX_SICK_LEAVE_NUMBER_LENGTH, MAX_TEMPLATES, MAX_TEMPLATE_NAME_LENGTH, MAX_PRESCRIPTIONS, MAX_PRESCRIPTION_FIELD_LENGTH, MAX_PRESCRIPTION_NOTE_LENGTH, MAX_INVESTIGATIONS, MAX_INVESTIGATION_REPORT_FIELDS, INVESTIGATION_FIELD_LIMITS, MAX_TEXT_LENGTH, MAX_DRAFT_LENGTH, SCHEMA_VERSION });
});
