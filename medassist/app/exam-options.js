(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MedAssistExam = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SECTIONS = [
    { id: "general", title: "Общее состояние" },
    { id: "cardiovascular", title: "Сердечно-сосудистая система" },
    { id: "respiratory", title: "Дыхательная система" },
    { id: "abdomen", title: "Живот" },
    { id: "neurological", title: "Неврологический статус" }
  ];

  const FIELDS = [
    {
      id: "generalCondition", section: "general", label: "Общее состояние", options: [
        { value: "satisfactory", label: "Удовлетворительное", text: "Общее состояние удовлетворительное" },
        { value: "moderate", label: "Средней степени тяжести", text: "Общее состояние средней степени тяжести" },
        { value: "severe", label: "Тяжёлое", text: "Общее состояние тяжёлое" },
        { value: "critical", label: "Крайне тяжёлое", text: "Общее состояние крайне тяжёлое" }
      ]
    },
    {
      id: "heartRhythm", section: "cardiovascular", label: "Ритмичность тонов сердца", options: [
        { value: "regular", label: "Ритмичные", text: "Тоны сердца ритмичные" },
        { value: "irregular", label: "Аритмичные", text: "Тоны сердца аритмичные" }
      ]
    },
    {
      id: "heartSounds", section: "cardiovascular", label: "Звучность тонов сердца", options: [
        { value: "clear", label: "Ясные", text: "Тоны сердца ясные" },
        { value: "muffled", label: "Приглушённые", text: "Тоны сердца приглушённые" },
        { value: "dull", label: "Глухие", text: "Тоны сердца глухие" }
      ]
    },
    {
      id: "heartMurmur", section: "cardiovascular", label: "Шумы сердца", options: [
        { value: "none", label: "Не выслушиваются", text: "Шумы сердца не выслушиваются" },
        { value: "systolic", label: "Систолический", text: "Выслушивается систолический шум" },
        { value: "diastolic", label: "Диастолический", text: "Выслушивается диастолический шум" },
        { value: "systolicDiastolic", label: "Систолический и диастолический", text: "Выслушиваются систолический и диастолический шумы" },
        { value: "continuous", label: "Непрерывный", text: "Выслушивается непрерывный сердечный шум" }
      ]
    },
    {
      id: "pulseRhythm", section: "cardiovascular", label: "Ритм пульса", options: [
        { value: "regular", label: "Ритмичный", text: "Пульс ритмичный" },
        { value: "irregular", label: "Аритмичный", text: "Пульс аритмичный" }
      ]
    },
    {
      id: "pulseFilling", section: "cardiovascular", label: "Наполнение пульса", options: [
        { value: "normal", label: "Удовлетворительное", text: "Пульс удовлетворительного наполнения" },
        { value: "weak", label: "Слабое", text: "Пульс слабого наполнения" },
        { value: "full", label: "Полный", text: "Пульс полный" }
      ]
    },
    {
      id: "pulseSymmetry", section: "cardiovascular", label: "Пульс на лучевых артериях", options: [
        { value: "equal", label: "Одинаковый с обеих сторон", text: "Пульс на лучевых артериях одинаковый с обеих сторон" },
        { value: "unequal", label: "Различается справа и слева", text: "Пульс на лучевых артериях различается справа и слева" }
      ]
    },
    {
      id: "edema", section: "cardiovascular", label: "Периферические отёки", options: [
        { value: "none", label: "Не выявлены", text: "Периферические отёки не выявлены" },
        { value: "present", label: "Выявлены", text: "Выявлены периферические отёки" }
      ]
    },
    {
      id: "chestSymmetry", section: "respiratory", label: "Участие грудной клетки в дыхании", options: [
        { value: "symmetric", label: "Обе половины участвуют равномерно", text: "Обе половины грудной клетки участвуют в дыхании равномерно" },
        { value: "rightLag", label: "Правая половина отстаёт", text: "Правая половина грудной клетки отстаёт при дыхании" },
        { value: "leftLag", label: "Левая половина отстаёт", text: "Левая половина грудной клетки отстаёт при дыхании" }
      ]
    },
    {
      id: "breathing", section: "respiratory", label: "Основной дыхательный шум", options: [
        { value: "vesicular", label: "Везикулярное дыхание", text: "Дыхание везикулярное" },
        { value: "weakenedVesicular", label: "Ослабленное везикулярное", text: "Дыхание везикулярное, ослабленное" },
        { value: "harsh", label: "Жёсткое дыхание", text: "Дыхание жёсткое" },
        { value: "bronchial", label: "Бронхиальное дыхание", text: "Выслушивается бронхиальное дыхание" },
        { value: "inaudible", label: "Не выслушивается", text: "Дыхательные шумы не выслушиваются" }
      ]
    },
    {
      id: "rales", section: "respiratory", label: "Хрипы", options: [
        { value: "none", label: "Не выслушиваются", text: "Хрипы не выслушиваются" },
        { value: "dryWheezing", label: "Сухие свистящие", text: "Выслушиваются сухие свистящие хрипы" },
        { value: "dryRhonchi", label: "Сухие жужжащие", text: "Выслушиваются сухие жужжащие хрипы" },
        { value: "moistFine", label: "Влажные мелкопузырчатые", text: "Выслушиваются влажные мелкопузырчатые хрипы" },
        { value: "moistCoarse", label: "Влажные крупнопузырчатые", text: "Выслушиваются влажные крупнопузырчатые хрипы" },
        { value: "mixed", label: "Сухие и влажные", text: "Выслушиваются сухие и влажные хрипы" }
      ]
    },
    {
      id: "crepitation", section: "respiratory", label: "Крепитация", options: [
        { value: "none", label: "Не выслушивается", text: "Крепитация не выслушивается" },
        { value: "present", label: "Выслушивается", text: "Выслушивается крепитация" }
      ]
    },
    {
      id: "pleuralRub", section: "respiratory", label: "Шум трения плевры", options: [
        { value: "none", label: "Не выслушивается", text: "Шум трения плевры не выслушивается" },
        { value: "present", label: "Выслушивается", text: "Выслушивается шум трения плевры" }
      ]
    },
    {
      id: "percussion", section: "respiratory", label: "Перкуторный звук над лёгкими", options: [
        { value: "resonant", label: "Ясный лёгочный", text: "Над лёгкими определяется ясный лёгочный перкуторный звук" },
        { value: "dull", label: "Притупление", text: "Над лёгкими определяется притупление перкуторного звука" },
        { value: "hyperresonant", label: "Коробочный", text: "Над лёгкими определяется коробочный перкуторный звук" }
      ]
    },
    {
      id: "abdomenShape", section: "abdomen", label: "Вздутие живота", options: [
        { value: "notDistended", label: "Не вздут", text: "Живот не вздут" },
        { value: "distended", label: "Вздут", text: "Живот вздут" }
      ]
    },
    {
      id: "abdomenPalpation", section: "abdomen", label: "Живот при пальпации", options: [
        { value: "soft", label: "Мягкий", text: "Живот при пальпации мягкий" },
        { value: "guarding", label: "Мышечное напряжение", text: "При пальпации живота определяется мышечное напряжение" }
      ]
    },
    {
      id: "abdomenTenderness", section: "abdomen", label: "Болезненность при пальпации живота", options: [
        { value: "none", label: "Безболезненный", text: "Живот при пальпации безболезненный" },
        { value: "localized", label: "Локальная болезненность", text: "При пальпации живота выявляется локальная болезненность" },
        { value: "diffuse", label: "Разлитая болезненность", text: "При пальпации живота выявляется разлитая болезненность" }
      ]
    },
    {
      id: "peritonealSigns", section: "abdomen", label: "Симптомы раздражения брюшины", options: [
        { value: "negative", label: "Отрицательные", text: "Симптомы раздражения брюшины отрицательные" },
        { value: "positive", label: "Положительные", text: "Выявлены симптомы раздражения брюшины" }
      ]
    },
    {
      id: "bowelSounds", section: "abdomen", label: "Перистальтические шумы", options: [
        { value: "normal", label: "Обычные", text: "Перистальтические шумы обычные" },
        { value: "increased", label: "Усиленные", text: "Перистальтические шумы усилены" },
        { value: "decreased", label: "Ослабленные", text: "Перистальтические шумы ослаблены" },
        { value: "absent", label: "Не выслушиваются", text: "Перистальтические шумы не выслушиваются" }
      ]
    },
    {
      id: "consciousness", section: "neurological", label: "Сознание", options: [
        { value: "clear", label: "Ясное", text: "Сознание ясное" },
        { value: "impaired", label: "Нарушено — уточнить в дополнении", text: "Сознание нарушено" }
      ]
    },
    {
      id: "orientation", section: "neurological", label: "Ориентировка", options: [
        { value: "intact", label: "Сохранена", text: "Ориентировка в собственной личности, месте и времени сохранена" },
        { value: "impaired", label: "Нарушена — уточнить в дополнении", text: "Ориентировка нарушена" }
      ]
    },
    {
      id: "pupilEquality", section: "neurological", label: "Размер зрачков", options: [
        { value: "equal", label: "Равные", text: "Зрачки равные" },
        { value: "rightLarger", label: "Правый больше левого", text: "Правый зрачок больше левого" },
        { value: "leftLarger", label: "Левый больше правого", text: "Левый зрачок больше правого" }
      ]
    },
    {
      id: "pupilLight", section: "neurological", label: "Реакция зрачков на свет", options: [
        { value: "preserved", label: "Сохранена с обеих сторон", text: "Реакция зрачков на свет сохранена с обеих сторон" },
        { value: "sluggish", label: "Вялая — уточнить сторону", text: "Реакция зрачков на свет вялая" },
        { value: "absent", label: "Отсутствует — уточнить сторону", text: "Реакция зрачков на свет отсутствует" }
      ]
    },
    {
      id: "tendonReflexes", section: "neurological", label: "Сухожильные рефлексы", options: [
        { value: "normal", label: "Обычной выраженности", text: "Сухожильные рефлексы обычной выраженности" },
        { value: "increased", label: "Повышены", text: "Сухожильные рефлексы повышены" },
        { value: "decreased", label: "Снижены", text: "Сухожильные рефлексы снижены" },
        { value: "absent", label: "Не вызываются", text: "Сухожильные рефлексы не вызываются" },
        { value: "asymmetric", label: "Асимметричны — уточнить сторону", text: "Сухожильные рефлексы асимметричны" }
      ]
    },
    {
      id: "coordination", section: "neurological", label: "Пальценосовая проба", options: [
        { value: "accurate", label: "Выполняется точно", text: "Пальценосовая проба выполняется точно" },
        { value: "inaccurate", label: "Выполняется с промахиванием", text: "Пальценосовая проба выполняется с промахиванием" }
      ]
    },
    {
      id: "romberg", section: "neurological", label: "Поза Ромберга", options: [
        { value: "stable", label: "Устойчивость сохранена", text: "В позе Ромберга устойчивость сохранена" },
        { value: "unstable", label: "Пошатывание", text: "В позе Ромберга отмечается пошатывание" }
      ]
    },
    {
      id: "meningealSigns", section: "neurological", label: "Менингеальные симптомы", options: [
        { value: "negative", label: "Отрицательные", text: "Менингеальные симптомы отрицательные" },
        { value: "positive", label: "Положительные — уточнить симптомы", text: "Выявлены менингеальные симптомы" }
      ]
    }
  ];

  const NORMAL_SELECTIONS = Object.freeze({
    generalCondition: "satisfactory",
    heartRhythm: "regular",
    heartSounds: "clear",
    heartMurmur: "none",
    pulseRhythm: "regular",
    pulseFilling: "normal",
    pulseSymmetry: "equal",
    edema: "none",
    chestSymmetry: "symmetric",
    breathing: "vesicular",
    rales: "none",
    crepitation: "none",
    pleuralRub: "none",
    percussion: "resonant",
    abdomenShape: "notDistended",
    abdomenPalpation: "soft",
    abdomenTenderness: "none",
    peritonealSigns: "negative",
    bowelSounds: "normal",
    consciousness: "clear",
    orientation: "intact",
    pupilEquality: "equal",
    pupilLight: "preserved",
    tendonReflexes: "normal",
    coordination: "accurate",
    romberg: "stable",
    meningealSigns: "negative"
  });

  return { FIELDS, SECTIONS, NORMAL_SELECTIONS };
});
