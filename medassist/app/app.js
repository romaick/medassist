(function () {
  'use strict';
  const core = window.MedAssistCore;
  const repository = window.MedAssistStorage;
  const app = document.getElementById('app');
  if (!core || !repository || !window.MedAssistExam) {
    app.textContent = 'Не удалось загрузить файлы приложения. Распакуйте архив полностью и запустите Start-MedAssist.cmd ещё раз.';
    return;
  }

  const loaded = repository.load();
  const state = {
    encounters: loaded.encounters, view: 'home', activeId: null, tab: 'basic',
    error: loaded.error, saved: !loaded.error, externalChange: false, search: '', migrated: Boolean(loaded.migrated)
  };
  const icons = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    document: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2M12 17h.01"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18M8 15h2m4 0h2m-8 3h2"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    edit: '<path d="m16 3 5 5-12 12-6 1 1-6zM13 6l5 5"/>',
    calculator: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8v3H8zM8 13h1m6 0h1m-8 4h1m6 0h1"/>',
    flask: '<path d="M9 3h6m-5 0v6L4 19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2L14 9V3M7 15h10"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>'
  };
  const tabs = [['basic', 'Приём'], ['history', 'Анамнез'], ['exam', 'Осмотр'], ['draft', 'Запись']];
  const historyFields = [
    ['complaints', 'Жалобы', 'Жалобы со слов демонстрационного пациента'],
    ['onset', 'Начало и длительность', 'Когда появились симптомы, сколько сохраняются'],
    ['course', 'Течение и предпринятые меры', 'Динамика, обращения и действия до приёма'],
    ['conditions', 'Заболевания и операции в анамнезе', 'Только известные сведения'],
    ['medications', 'Принимаемые препараты на постоянной основе', 'Название и режим постоянного приёма — если известны'],
    ['allergies', 'Аллергологический анамнез', 'Укажите сведения; пустое поле означает «не указано»'],
    ['context', 'Дополнительный анамнез', 'Необязательно. Пустое поле не попадёт в черновик']
  ];
  const examCatalog = window.MedAssistExam;
  const vitalFields = [
    ['systolic', 'АД систолическое', 'мм рт. ст.'], ['diastolic', 'АД диастолическое', 'мм рт. ст.'],
    ['pulse', 'Пульс', 'уд/мин'], ['temperature', 'Температура', '°C'],
    ['respiratoryRate', 'Частота дыхания', 'в минуту'], ['spo2', 'SpO₂', '%'],
    ['weight', 'Масса', 'кг'], ['height', 'Рост', 'см']
  ];
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const icon = (name) => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || icons.document) + '</svg>';
  const active = () => state.encounters.find((entry) => entry.id === state.activeId);
  const dateText = (value) => value ? new Date(value + 'T12:00:00').toLocaleDateString('ru-RU') : 'Дата не указана';
  const localDate = () => new Date().toLocaleDateString('sv-SE');
  const shortId = (entry) => entry.id.replace(/^visit-/, '').slice(0, 8).toUpperCase();
  const patientLabel = (entry) => 'Демо-пациент · ' + shortId(entry);
  const get = (object, path) => path.split('.').reduce((value, key) => value[key], object);
  function set(object, path, value) {
    const parts = path.split('.');
    const key = parts.pop();
    const target = parts.reduce((item, name) => item[name], object);
    target[key] = value;
  }
  function button(action, text, symbol, variant = 'secondary', extra = '') {
    return '<button type="button" class="button ' + variant + '" data-action="' + action + '" ' + extra + '>' + (symbol ? icon(symbol) : '') + escape(text) + '</button>';
  }
  function field(path, title, placeholder = '', options = {}) {
    const value = get(active(), path);
    const id = 'field-' + path.replaceAll('.', '-');
    const shared = ' id="' + id + '" data-field="' + path + '" aria-describedby="' + id + '-error' + (options.hint ? ' ' + id + '-hint' : '') + '"';
    let control;
    if (options.select) {
      control = '<select' + shared + '>' + options.select.map(([key, label]) => '<option value="' + escape(key) + '"' + (value === key ? ' selected' : '') + '>' + escape(label) + '</option>').join('') + '</select>';
    } else if (options.type) {
      control = '<input' + shared + ' type="' + options.type + '"' + (options.numeric ? ' inputmode="decimal"' : '') + ' maxlength="' + (options.numeric ? '30' : '10000') + '" value="' + escape(value) + '" placeholder="' + escape(placeholder) + '">';
    } else {
      control = '<textarea' + shared + ' maxlength="10000" rows="3" placeholder="' + escape(placeholder) + '">' + escape(value) + '</textarea>';
    }
    return '<div class="field' + (options.full ? ' full' : '') + '"><label for="' + id + '">' + escape(title) + '</label>' + control + (options.hint ? '<p class="hint" id="' + id + '-hint">' + escape(options.hint) + '</p>' : '') + '<p class="field-error" id="' + id + '-error" hidden></p></div>';
  }

  function render() {
    const current = active();
    if (state.view === 'visit' && !current) state.view = 'home';
    const sectionName = {home: 'Обзор', visit: 'Демонстрационный приём', modules: 'Модули', help: 'Помощь и данные'}[state.view];
    app.innerHTML = '<div class="shell"><aside class="sidebar" aria-label="Главная навигация"><div class="brand"><img src="icon.svg" alt=""><div><strong>МедАссистент</strong><small>ПОЛИКЛИНИЧЕСКИЙ РЕЖИМ</small></div></div><p class="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</p><nav class="nav">' +
      navButton('home', 'Обзор', 'home') + navButton('new', 'Новый приём', 'plus') +
      (current ? navButton('visit', 'Текущий приём', 'document') : '') + navButton('modules', 'Модули', 'grid') + navButton('help', 'Помощь и данные', 'help') +
      '</nav><div class="side-bottom"><div class="local-indicator"><span class="dot"></span>Работает локально</div><div class="version">Прототип 0.4 · Демонстрация</div></div></aside><div class="workspace"><header class="topbar"><div class="topbar-left">Поликлиника <span aria-hidden="true">/</span> <span>' + sectionName + '</span></div><div class="topbar-right"><span class="date muted">' + new Date().toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'}) + '</span><span class="pill"><span class="dot"></span>Офлайн · деморежим</span><span class="avatar" aria-hidden="true">МА</span></div></header><main id="main" tabindex="-1"><div id="storage-banner"></div>' +
      (state.migrated ? '<div class="migration-notice">Записи предыдущей версии загружены. Старый текст осмотра, наблюдения и ручные правки сохранены. Проверьте их перед повторной генерацией.</div>' : '') +
      ({home: renderHome, visit: renderVisit, modules: renderModules, help: renderHelp}[state.view])() +
      '<footer class="footer-note"><span>Только вымышленные данные. Черновики требуют проверки врачом.</span><span>МедАссистент · 0.4</span></footer></main></div></div>';
    updateSaveStatus();
    if (state.view === 'visit') { updateValidation(); updateDraftState(); }
  }
  function navButton(view, text, symbol) {
    return '<button type="button" data-action="' + view + '"' + (state.view === view ? ' class="active" aria-current="page"' : '') + '>' + icon(symbol) + '<span>' + text + '</span>' + (state.view === view ? '<span class="tiny-dot"></span>' : '') + '</button>';
  }
  function demoNotice() { return '<div class="demo-notice">' + icon('info') + '<span>Демонстрационный прототип. Используйте только вымышленные данные.</span></div>'; }
  function renderHome() {
    const drafts = state.encounters.filter((entry) => entry.draft.text.trim()).length;
    return '<div class="page-heading"><div><h1>Хорошего рабочего дня.</h1><p>Всё для первой записи — в одном рабочем пространстве.</p></div>' + button('new', 'Новый приём', 'plus', 'primary') + '</div>' + demoNotice() +
      '<section class="welcome"><div><p class="eyebrow">Спокойный порядок в записях</p><h2>От приёма к понятному черновику</h2><p>Заполните анамнез и осмотр. МедАссистент соберёт введённые сведения в текст, который вы сможете проверить и отредактировать.</p><div class="actions">' + button('new', 'Начать приём', 'arrow', 'primary') + button('example', 'Открыть пример', null, 'ghost') + '</div></div><div class="welcome-illustration" aria-hidden="true"><div class="sheet-art">' + icon('document') + '<span class="art-line"></span><span class="art-line"></span><span class="art-line short"></span><span class="art-line"></span></div><div class="art-check">' + icon('check') + '</div></div></section>' +
      '<div class="stats"><div class="stat"><div class="icon-tile">' + icon('calendar') + '</div><div><div class="stat-label">Приёмов в рабочем списке</div><div class="stat-value">' + state.encounters.length + '</div></div></div><div class="stat"><div class="icon-tile">' + icon('document') + '</div><div><div class="stat-label">С текстом черновика</div><div class="stat-value">' + drafts + '</div></div></div><div class="stat"><div class="icon-tile">' + icon('shield') + '</div><div><div class="stat-label">Режим работы</div><div class="stat-value text">На этом компьютере</div></div></div></div>' +
      '<div class="dashboard-grid"><section class="card"><div class="card-head"><h2>Рабочий список</h2><span class="result-count">' + state.encounters.length + ' записей</span></div>' + (state.encounters.length ? '<div class="search-wrap"><input class="search-field" id="visit-search" aria-label="Найти приём" placeholder="Поиск по коду, дате или поводу обращения" value="' + escape(state.search) + '"></div><div id="visit-list" class="list">' + renderList() + '</div>' : '<div class="empty"><div class="icon-tile">' + icon('document') + '</div><h3>Здесь появятся ваши приёмы</h3><p>Начните с пустой формы или откройте заполненный вымышленный пример.</p>' + button('example', 'Открыть пример', 'document') + '</div>') + '</section><section class="card"><div class="card-head"><h2>Первый приём за 3 шага</h2></div><div class="guide-steps">' +
      [['01', 'Заполните сведения', 'Повод обращения, анамнез и данные осмотра. Все поля можно оставить пустыми.'], ['02', 'Соберите запись', 'В черновик попадут только введённые вами сведения.'], ['03', 'Проверьте и сохраните', 'Отредактируйте текст и скачайте его в файл.']].map(([number, title, body]) => '<div class="guide-step"><span class="step-number">' + number + '</span><div><h3>' + title + '</h3><p>' + body + '</p></div></div>').join('') + '</div></section></div>' +
      '<div class="module-strip"><div class="icon-tile">' + icon('grid') + '</div><div><h3>Основа для дальнейших модулей</h3><p>Калькуляторы, анализы и диспансерное наблюдение.</p></div>' + button('modules', 'Что дальше', 'arrow', 'ghost') + '</div>';
  }
  function renderList() {
    const query = state.search.toLocaleLowerCase('ru').trim();
    const entries = [...state.encounters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter((entry) => [patientLabel(entry), entry.visitDate, dateText(entry.visitDate), entry.reason].join(' ').toLocaleLowerCase('ru').includes(query));
    if (!entries.length) return '<p class="muted small">По вашему запросу приёмов нет.</p>';
    return entries.map((entry) => '<div class="visit-row"><div class="visit-identity"><div class="icon-tile">' + icon('user') + '</div><div class="visit-text"><strong>' + escape(patientLabel(entry)) + '</strong><p>' + escape(dateText(entry.visitDate)) + ' · ' + escape(entry.reason || 'Повод обращения не указан') + '</p><p>' + (entry.draft.text.trim() ? 'Черновик сохранён' : 'Форма приёма') + '</p></div></div>' + button('open', 'Открыть', null, 'secondary compact', 'data-id="' + escape(entry.id) + '" aria-label="Открыть ' + escape(patientLabel(entry)) + '"') + '</div>').join('');
  }
  function renderVisit() {
    return '<div class="page-heading visit-heading"><div><h1>' + escape(patientLabel(active())) + '</h1><p>Демонстрационный приём · ' + escape(dateText(active().visitDate)) + '</p></div><div id="save-status" class="save-indicator" role="status"></div></div>' + demoNotice() +
      '<nav class="tab-bar" aria-label="Разделы приёма">' + tabs.map(([key, label], i) => '<button type="button" class="tab' + (state.tab === key ? ' active' : '') + '" data-action="tab" data-tab="' + key + '"' + (state.tab === key ? ' aria-current="step"' : '') + '><span class="step-number">' + (i + 1) + '</span>' + label + '</button>').join('') + '</nav>' +
      ({basic: renderBasic, history: renderHistory, exam: renderExam, draft: renderDraft}[state.tab])();
  }
  function aside(title, text) {
    const entry = active();
    const count = (obj) => Object.values(obj).filter((value) => value.trim()).length;
    return '<aside class="side-card">' + icon('edit') + '<h3>' + title + '</h3><p>' + text + '</p><div class="summary-rows"><div class="summary-row"><span>Анамнез</span><span>' + count(entry.history) + ' из 7 полей</span></div><div class="summary-row"><span>Признаки осмотра</span><span id="exam-total">' + count(entry.examSelections) + ' из ' + examCatalog.FIELDS.length + '</span></div><div class="summary-row"><span>Показатели</span><span>' + count(entry.vitals) + ' из 8 полей</span></div></div></aside>';
  }
  function nextFooter(previous, next, label) {
    return '<div class="form-footer">' + (previous ? button('tab', 'Назад', null, 'secondary', 'data-tab="' + previous + '"') : '<span class="muted small">Все поля необязательны</span>') + button('tab', label, 'arrow', 'primary', 'data-tab="' + next + '"') + '</div>';
  }
  function renderBasic() {
    return '<div class="form-layout"><section class="card form-card"><h2>Сведения о приёме</h2><p class="section-intro">Форма для знакомства с рабочим процессом. Для пациента автоматически создан демонстрационный код.</p><div class="field-grid three">' +
      field('visitDate', 'Дата приёма', '', {type: 'date'}) + field('age', 'Возраст, полных лет', 'Не указан', {type: 'text', numeric: true}) +
      field('sex', 'Пол', '', {select: [['', 'Не указан'], ['female', 'Женский'], ['male', 'Мужской'], ['unspecified', 'Не уточнён']]}) +
      field('reason', 'Повод обращения', 'Кратко опишите повод демонстрационного приёма', {full: true}) + '</div>' + nextFooter(null, 'history', 'Перейти к анамнезу') + '</section>' + aside('Начните с контекста', 'Имена и контактные данные здесь не нужны. На каждом шаге сведения сохраняются в этом браузере. Для переноса используйте резервную копию.') + '</div>';
  }
  function renderHistory() {
    return '<div class="form-layout"><section class="card form-card"><h2>Анамнез</h2><p class="section-intro">Запишите известные сведения. Пустое поле не означает отсутствие симптомов, заболеваний или аллергии. Дополнительный анамнез включается только при заполнении.</p><div class="field-grid">' + historyFields.map(([key, title, hint], i) => field('history.' + key, title, hint, {full: i === 0 || i === 6})).join('') + '</div>' + nextFooter('basic', 'exam', 'Перейти к осмотру') + '</section>' + aside('Никаких предположений', 'Генератор упорядочит ваши формулировки. Пустой дополнительный анамнез будет пропущен; основные незаполненные поля останутся обозначены.') + '</div>';
  }
  function renderExamGroup(section) {
    const items = examCatalog.FIELDS.filter((item) => item.section === section.id);
    const count = items.filter((item) => active().examSelections[item.id]).length;
    const note = active().exam[section.id];
    return '<details class="exam-group" data-exam-section="' + section.id + '"' + (section.id === 'general' || section.id === 'cardiovascular' || note.trim() ? ' open' : '') + '><summary><span>' + escape(section.title) + '</span><span class="exam-count" data-count-section="' + section.id + '">' + count + ' из ' + items.length + '</span>' + button('normal-exam-section', 'Осмотр без особенностей', null, 'secondary compact exam-section-normal', 'data-section="' + section.id + '" aria-label="Осмотр без особенностей: ' + escape(section.title) + '"') + '</summary><div class="exam-group-content"><div class="field-grid">' + items.map((item) => field('examSelections.' + item.id, item.label, '', {select: [['', 'Не выбрано'], ...item.options.map((option) => [option.value, option.label])]})).join('') + '</div><details class="exam-note"' + (note.trim() ? ' open' : '') + '><summary>Уточнение или сохранённое описание</summary>' + field('exam.' + section.id, 'Уточнение: ' + section.title.toLocaleLowerCase('ru'), 'Локализация, особенности или своя формулировка (необязательно)', {hint: 'Этот текст включается вместе с выбранными признаками. Проверьте их согласованность.'}) + '</details></div></details>';
  }
  function bmiHint(value) {
    return value ? 'кг/м² · Рассчитано по массе и росту' : 'Для расчёта нужны корректные масса (кг) и рост (см) больше нуля.';
  }
  function renderBmi() {
    const value = core.calculateBmi(active().vitals.weight, active().vitals.height);
    return '<div class="field bmi-field"><label for="bmi-value">Индекс массы тела</label><output id="bmi-value" for="field-vitals-weight field-vitals-height" aria-live="polite" aria-describedby="bmi-hint">' + (value || '—') + '</output><p class="hint" id="bmi-hint">' + bmiHint(value) + '</p></div>';
  }
  function updateBmi() {
    const output = document.getElementById('bmi-value');
    if (!output) return;
    const value = core.calculateBmi(active().vitals.weight, active().vitals.height);
    output.textContent = value || '—';
    document.getElementById('bmi-hint').textContent = bmiHint(value);
  }
  function renderExam() {
    return '<div class="form-layout"><section class="card form-card"><h2>Осмотр</h2><p class="section-intro">Выберите только оценённые признаки. Ритм и звучность тонов задаются отдельно. Для локализации и особенностей можно добавить уточнение.</p><div class="exam-toolbar"><h3>Описание осмотра</h3><div class="actions">' + button('normal-exam', 'Осмотр без особенностей', 'check') + button('expand-exam', 'Раскрыть все разделы', null, 'ghost') + '</div></div><p class="small muted">Кнопка «Осмотр без особенностей» заполняет варианты осмотра. Проверьте каждый признак и при необходимости измените его. Кнопка у названия раздела заполняет только этот раздел. Измеренные показатели и ваши уточнения сохраняются без изменений.</p>' + examCatalog.SECTIONS.map(renderExamGroup).join('') + '<div class="form-section">' + field('exam.other', 'Другие данные осмотра', 'Необязательно. Пустое поле не попадёт в черновик') + '</div><div class="form-section"><h3>Измеренные показатели</h3><div class="field-grid three">' + vitalFields.map(([key, title, unit]) => field('vitals.' + key, title, 'Не указано', {type: 'text', numeric: true, hint: unit})).join('') + renderBmi() + '</div></div>' + nextFooter('history', 'draft', 'Перейти к записи') + '</section>' + aside('Только выбранные признаки', 'Ни один результат не выбран заранее. Списки служат для записи осмотра и не определяют диагноз. Если нужного варианта нет, используйте уточнение. Источники перечислены в файле EXAM-SOURCES.md.') + '</div>';
  }
  function renderDraft() {
    return '<div class="draft-layout"><section class="card draft-controls"><h2>Диагноз и рекомендации</h2><p class="section-intro">Заполняет врач. Рекомендации, повторный приём и больничный включаются в текст только при заполнении или явной отметке.</p>' +
      field('assessment.summary', 'Диагноз', 'Введите диагноз самостоятельно') + field('assessment.plan', 'Рекомендации', 'Необязательно. Пустое поле не попадёт в черновик') +
      (active().assessment.followUp.trim() ? '<div class="legacy-note"><p>Сохранено из предыдущей версии. Перенесите нужное в рекомендации или выберите дату, затем очистите старый текст, если он больше не нужен.</p>' + field('assessment.followUp', 'Наблюдение из предыдущей версии', '') + '</div>' : '') +
      field('assessment.sickLeaveIssued', 'Листок нетрудоспособности', '', {select: [['', 'Не отмечено — не включать'], ['no', 'Не выдавался — не включать'], ['yes', 'Выдан']], hint: 'Это только отметка в черновике, не оформление документа.'}) +
      '<div id="sickleave-period"' + (active().assessment.sickLeaveIssued === 'yes' ? '' : ' hidden') + '>' + field('assessment.sickLeaveNumber', 'Номер листка нетрудоспособности', 'Введите номер вручную', {type: 'text'}) + '<div class="field-grid">' + field('assessment.sickLeaveFrom', 'Период: с', '', {type: 'date'}) + field('assessment.sickLeaveTo', 'По', '', {type: 'date'}) + '</div><p class="small muted">Номер и даты необязательны. Срок программа не рассчитывает.</p></div>' +
      field('assessment.returnVisitDate', 'Повторный приём', '', {type: 'date', hint: 'Оставьте дату пустой, чтобы не включать повторный приём в запись.'}) +
      '<div class="form-section"><p class="small muted">Сформируйте текст из заполненных разделов и проверьте его перед использованием.</p>' + button('generate', 'Сформировать черновик', 'document', 'primary') + '</div></section><section class="card draft-card"><div class="card-head"><h2>Черновик записи</h2><span class="pill neutral">Редактируемый текст</span></div><div id="draft-state" class="draft-state" role="status"></div><label class="small muted" for="draft-text">Текст черновика · свободное редактирование</label><textarea class="draft-editor" id="draft-text" data-field="draft.text" maxlength="100000" aria-describedby="draft-state field-draft-text-error" placeholder="Нажмите «Сформировать черновик» или начните писать здесь.">' + escape(active().draft.text) + '</textarea><p class="field-error" id="field-draft-text-error" hidden></p><div class="actions">' + button('copy', 'Копировать', 'copy') + button('download-text', 'Скачать .txt', 'download') + '</div><p class="small muted">Это свободный демонстрационный черновик, не нормативная форма Беларуси.</p></section></div>';
  }
  function renderModules() {
    return '<div class="page-heading"><div><h1>Модули</h1><p>Направления расширения МедАссистента.</p></div><span class="pill neutral">План развития</span></div>' + demoNotice() +
      '<p class="section-intro">Сейчас работает модуль приёма и черновика. Карточки ниже описывают будущие возможности; отдельные калькуляторы, анализы, расписания и официальные формы ещё не подключены. ИМТ уже рассчитывается в разделе «Осмотр».</p><div class="module-grid">' + window.MedAssistModules.map((module) => '<section class="card module-card"><div class="module-head"><div class="icon-tile">' + icon(module.icon) + '</div><span class="pill neutral">' + (module.status === 'verification' ? 'После проверки источников' : 'Запланировано') + '</span></div><h2>' + escape(module.title) + '</h2><p>' + escape(module.description) + '</p><details><summary>Что потребуется для добавления</summary><p>' + escape(module.requirements) + '</p></details></section>').join('') + '</div>';
  }
  function renderHelp() {
    return '<div class="page-heading"><div><h1>Помощь и данные</h1><p>Первый запуск, сохранение и границы прототипа.</p></div></div><div class="help-layout"><section class="card help-card"><h2>Как пройти демонстрационный приём</h2><ol><li>Нажмите «Новый приём» для пустой формы или «Открыть пример» на главной.</li><li>Заполните сведения о приёме, анамнез и осмотр. Вводите только вымышленные данные.</li><li>В разделе «Запись» заполните диагноз, при необходимости рекомендации, дату повторного приёма и отметку о больничном. Нажмите «Сформировать черновик».</li><li>Проверьте и отредактируйте текст. Скачайте .txt или скопируйте его.</li></ol><h2>Режимы работы</h2><p>Сейчас доступен поликлинический режим. Стационарный режим запланирован отдельно; его формы и функции будут определены на следующем этапе.</p><h2>Что делает прототип</h2><p>Собирает введённые сведения в свободный текст. Работает из локальных файлов, без аккаунта, сервера, МИС и внешних запросов приложения.</p><p>Диагноз и рекомендации вводит врач. Программа не назначает лечение и не оформляет больничные документы. Варианты осмотра — вспомогательные формулировки; источники и ограничения перечислены в EXAM-SOURCES.md. Нормативные формы Беларуси не реализованы.</p><h2>Запуск в Windows</h2><p>Распакуйте архив в постоянную папку и откройте <span class="code-path">Start-MedAssist.cmd</span>. Приложение использует установленный Edge или Chrome. Также можно открыть <span class="code-path">app/index.html</span>.</p></section><section class="card help-card"><h2>Сохранение на этом компьютере</h2><p>Изменения автоматически сохраняются в локальном хранилище текущего браузера. Статус сохранения показан в приёме. При ошибке вы увидите сообщение.</p><p>Хранение локальных HTML-файлов зависит от браузера. Перемещение папки, другой профиль или очистка данных браузера могут сделать записи недоступными. Перед этим скачайте резервную копию.</p><p>Резервная копия содержит формы и отредактированные черновики. Восстановление заменит весь текущий список после подтверждения.</p><div class="backup-actions">' + button('backup', 'Резервная копия', 'download', 'primary') + button('import', 'Восстановить', 'upload') + button('reset', 'Очистить демонстрационные записи', null, 'secondary') + '</div><h2>Обновление программы через интернет</h2><p>Запустите <span class="code-path">Pin-MedAssist.cmd</span> один раз: появятся ярлыки запуска и обновления. Для проверки новой версии используйте <span class="code-path">MedAssist Update</span> на рабочем столе или <span class="code-path">Update-MedAssist.cmd</span> в папке программы. Перед установкой сохраните резервную копию и закройте окна приложения.</p><p>Обновления загружаются из публичного проекта romaick/medassist на GitHub. Скачивать и распаковывать архивы вручную не понадобится. Без интернета приёмы работают как раньше.</p><h2>Перенос записей из прежней папки</h2><p>Сначала скачайте резервную копию в старой версии. Новая версия принимает её через «Восстановить» и сохраняет старые тексты. Если файлы обновлены в той же папке и браузере, доступные старые записи загрузятся автоматически. Новые копии версии 0.2 в старой программе не открываются.</p><h2>Только демонстрация</h2><p>Данные сохраняются без шифрования. Прототип не подготовлен для реальных медицинских записей. Используйте только вымышленные сведения.</p></section></div>';
  }

  function updateValidation() {
    const entry = active();
    if (!entry) return [];
    const errors = core.validateEncounter(entry);
    app.querySelectorAll('[data-field]').forEach((control) => {
      const error = errors.find((item) => item.field === control.dataset.field);
      control.setAttribute('aria-invalid', error ? 'true' : 'false');
      const message = document.getElementById('field-' + control.dataset.field.replaceAll('.', '-') + '-error');
      if (message) { message.textContent = error ? error.message : ''; message.hidden = !error; }
    });
    return errors;
  }
  function updateSaveStatus() {
    const status = document.getElementById('save-status');
    if (status) {
      status.className = 'save-indicator' + (state.saved ? '' : ' failed');
      status.innerHTML = icon(state.saved ? 'check' : 'info') + (state.saved ? 'Сохранено в этом браузере' : 'Изменения не сохранены');
    }
    const banner = document.getElementById('storage-banner');
    banner.className = state.error ? 'storage-warning' : '';
    banner.innerHTML = state.error ? '<p><strong>Сохранение требует внимания.</strong> ' + escape(state.error) + '</p><p>Не закрывайте окно с нужными изменениями. Можно скачать резервную копию текущих данных.</p>' + button('backup', 'Резервная копия', 'download', 'secondary compact') + (state.externalChange ? button('reload', 'Загрузить сохранённую версию', null, 'secondary compact') : button('help', 'Помощь и данные', null, 'secondary compact')) : '';
  }
  function updateDraftState() {
    const target = document.getElementById('draft-state');
    if (!target) return;
    const entry = active();
    let message = 'Черновик пока пуст. Его можно сформировать из полей или написать вручную.';
    let stale = false;
    if (entry.draft.text.trim()) {
      if (!entry.draft.sourceFingerprint) message = 'Текст введён вручную. Изменения полей не изменяют его автоматически.';
      else {
        try { stale = entry.draft.sourceFingerprint !== core.fingerprint(entry); }
        catch (error) { stale = true; }
        message = stale ? 'Поля приёма изменились после генерации. Проверьте текст; повторная генерация заменит ручные правки.' : 'Черновик можно редактировать. Ручные правки сохраняются отдельно от полей формы.';
      }
    }
    target.textContent = message;
    target.className = 'draft-state' + (stale ? ' stale' : '');
  }
  function persist() {
    if (state.externalChange) { state.saved = false; updateSaveStatus(); return; }
    const result = repository.save(state.encounters);
    state.saved = result.ok;
    state.error = result.error;
    updateSaveStatus();
  }
  function toast(message, error = false) {
    const target = document.getElementById('toast');
    clearTimeout(toast.timeout);
    target.textContent = message; target.className = error ? 'error' : ''; target.hidden = false;
    toast.timeout = setTimeout(() => { target.hidden = true; }, error ? 9000 : 4500);
  }
  function confirmAction(title, message, acceptLabel = 'Продолжить') {
    const dialog = document.getElementById('confirmation');
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-message').textContent = message;
    const acceptButton = document.getElementById('dialog-accept');
    const cancelButton = document.getElementById('dialog-cancel');
    acceptButton.textContent = acceptLabel;
    return new Promise((resolve) => {
      const close = (accepted) => {
        acceptButton.removeEventListener('click', accept);
        cancelButton.removeEventListener('click', cancel);
        dialog.removeEventListener('cancel', cancel);
        dialog.close(); resolve(accepted);
      };
      const accept = () => close(true);
      const cancel = (event) => { event.preventDefault(); close(false); };
      acceptButton.addEventListener('click', accept);
      cancelButton.addEventListener('click', cancel);
      dialog.addEventListener('cancel', cancel);
      dialog.showModal(); cancelButton.focus();
    });
  }
  function download(text, name, mime) {
    const blob = new Blob(['\ufeff', text], {type: mime + ';charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function navigate(view, tab) {
    state.view = view;
    if (tab) state.tab = tab;
    render();
    document.getElementById('main').focus({preventScroll: true});
    window.scrollTo({top: 0});
  }
  async function handleAction(action, target) {
    if (['home', 'help', 'modules', 'visit'].includes(action)) { navigate(action); return; }
    if (action === 'tab') { navigate('visit', target.dataset.tab); return; }
    if (action === 'new' || action === 'example') {
      if (state.encounters.length >= 500) { toast('В прототипе можно хранить до 500 приёмов. Скачайте резервную копию перед очисткой.', true); return; }
      const entry = action === 'new' ? core.createEncounter() : core.createDemoEncounter();
      state.encounters.push(entry); state.activeId = entry.id; persist(); navigate('visit', 'basic'); return;
    }
    if (action === 'open') { state.activeId = target.dataset.id; navigate('visit', 'basic'); return; }
    if (action === 'generate') {
      const entry = active();
      const errors = updateValidation();
      if (errors.length) {
        const first = errors[0];
        const section = first.field.startsWith('history.') ? 'history' : (first.field.startsWith('exam.') || first.field.startsWith('examSelections.') || first.field.startsWith('vitals.')) ? 'exam' : first.field.startsWith('assessment.') || first.field.startsWith('draft.') ? 'draft' : 'basic';
        navigate('visit', section);
        const control = app.querySelector('[data-field="' + first.field + '"]');
        if (control) {
          for (let parent = control.parentElement; parent; parent = parent.parentElement) {
            if (parent.tagName === 'DETAILS') parent.open = true;
          }
          control.focus();
        }
        toast(first.message, true); return;
      }
      if (entry.draft.text.trim() && !await confirmAction('Заменить текст черновика?', 'Будет создан новый текст из текущих полей приёма. Все ручные правки в этом черновике будут заменены. Чтобы сохранить их отдельно, сначала скачайте .txt.', 'Заменить черновик')) return;
      entry.draft = {text: core.generateDraft(entry), generatedAt: new Date().toISOString(), sourceFingerprint: core.fingerprint(entry)};
      entry.updatedAt = new Date().toISOString(); persist(); render(); toast('Черновик сформирован. Проверьте и отредактируйте текст.'); return;
    }
    if (action === 'download-text' || action === 'copy') {
      const entry = active();
      if (!entry.draft.text.trim()) { toast('Сначала сформируйте или напишите текст черновика.', true); return; }
      if (action === 'download-text') {
        download(entry.draft.text, 'MedAssist-demo-' + shortId(entry) + '.txt', 'text/plain'); toast('Файл .txt передан браузеру для сохранения.');
      } else {
        try {
          if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
          await navigator.clipboard.writeText(entry.draft.text); toast('Текст скопирован.');
        } catch (error) {
          const editor = document.getElementById('draft-text'); editor.focus(); editor.select();
          toast('Браузер не разрешил копирование. Текст выделен — нажмите Ctrl+C.', true);
        }
      }
      return;
    }
    if (action === 'backup') {
      download(core.serializeBundle(state.encounters), 'MedAssist-backup-' + localDate() + '.json', 'application/json');
      toast('Резервная копия передана браузеру для сохранения.'); return;
    }
    if (action === 'import') { document.getElementById('import-file').click(); return; }
    if (action === 'reset') {
      if (!await confirmAction('Очистить демонстрационные записи?', 'Будут удалены все сохранённые в этом браузере приёмы и ручные черновики МедАссистента. Скачанные файлы останутся. При необходимости сначала сделайте резервную копию.', 'Очистить записи')) return;
      const result = repository.reset([]);
      if (!result.ok) { state.error = result.error; state.saved = false; updateSaveStatus(); toast(result.error, true); return; }
      state.encounters = []; state.activeId = null; state.externalChange = false; state.saved = true; state.error = null; state.migrated = false; navigate('home'); toast('Демонстрационные записи очищены.'); return;
    }
    if (action === 'reload') {
      if (!await confirmAction('Загрузить сохранённую версию?', 'Текущие изменения в этом окне будут заменены данными из локального хранилища. При необходимости сначала скачайте резервную копию.', 'Загрузить')) return;
      const result = repository.load();
      if (result.error) { toast(result.error, true); return; }
      state.encounters = result.encounters; state.activeId = null; state.externalChange = false; state.error = null; state.saved = true; state.migrated = Boolean(result.migrated); navigate('home');
    }
    if (action === 'normal-exam' || action === 'normal-exam-section') {
      const entry = active();
      const section = action === 'normal-exam-section' ? examCatalog.SECTIONS.find((item) => item.id === target.dataset.section) : null;
      if (!entry || (action === 'normal-exam-section' && !section)) return;
      const fields = examCatalog.FIELDS.filter((field) => !section || field.section === section.id);
      const hasDifferentSelection = fields.some((field) => entry.examSelections[field.id] && entry.examSelections[field.id] !== examCatalog.NORMAL_SELECTIONS[field.id]);
      const scope = section ? 'В разделе «' + section.title + '»' : 'В осмотре';
      if (hasDifferentSelection && !await confirmAction('Заменить выбранные признаки осмотра?', scope + ' уже есть варианты, отличающиеся от «без особенностей». Они будут заменены. Ваши уточнения и измеренные показатели сохранятся; проверьте их согласованность с выбранными признаками.', 'Заполнить без особенностей')) return;
      const openSections = new Set(Array.from(app.querySelectorAll('.exam-group[open]'), (group) => group.dataset.examSection));
      for (const field of fields) entry.examSelections[field.id] = examCatalog.NORMAL_SELECTIONS[field.id];
      entry.updatedAt = new Date().toISOString();
      persist(); render();
      app.querySelectorAll('.exam-group').forEach((group) => { group.open = !section || group.dataset.examSection === section.id || openSections.has(group.dataset.examSection); });
      app.querySelector(section ? '[data-action="normal-exam-section"][data-section="' + section.id + '"]' : '[data-action="normal-exam"]').focus({preventScroll: true});
      toast((section ? 'Заполнен раздел «' + section.title + '».' : 'Варианты осмотра заполнены.') + ' Проверьте признаки и при необходимости измените отдельные пункты.');
      return;
    }
    if (action === 'expand-exam') {
      app.querySelectorAll('.exam-group').forEach((group) => { group.open = true; });
    }
  }
  app.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (target && target.dataset.action === 'normal-exam-section') event.preventDefault();
    if (target && !target.disabled) handleAction(target.dataset.action, target).catch((error) => toast(error.message, true));
  });
  function handleInput(event) {
    const control = event.target;
    if (control.id === 'visit-search') {
      state.search = control.value; document.getElementById('visit-list').innerHTML = renderList(); return;
    }
    if (!control.dataset.field || !active()) return;
    set(active(), control.dataset.field, control.value);
    active().updatedAt = new Date().toISOString();
    if (control.dataset.field === 'vitals.weight' || control.dataset.field === 'vitals.height') updateBmi();
    if (control.dataset.field === 'assessment.sickLeaveIssued') {
      document.getElementById('sickleave-period').hidden = control.value !== 'yes';
    }
    if (control.dataset.field.startsWith('examSelections.')) {
      app.querySelectorAll('[data-count-section]').forEach((element) => {
        const items = examCatalog.FIELDS.filter((item) => item.section === element.dataset.countSection);
        element.textContent = items.filter((item) => active().examSelections[item.id]).length + ' из ' + items.length;
      });
      const total = document.getElementById('exam-total');
      if (total) total.textContent = Object.values(active().examSelections).filter(Boolean).length + ' из ' + examCatalog.FIELDS.length;
    }
    updateValidation(); persist(); updateDraftState();
  }
  app.addEventListener('input', handleInput);
  app.addEventListener('change', (event) => { if (event.target.tagName === 'SELECT') handleInput(event); });
  document.getElementById('import-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Файл слишком большой. Максимум для импорта — 20 МБ.');
      const bundle = core.parseBundle((await file.text()).replace(/^\uFEFF/, ''));
      if (!await confirmAction('Восстановить резервную копию?', 'В файле приёмов: ' + bundle.encounters.length + '. Текущих приёмов: ' + state.encounters.length + '.\nВесь текущий список и его черновики будут заменены данными из файла.', 'Восстановить')) return;
      const result = repository.reset(bundle.encounters);
      if (!result.ok) throw new Error(result.error);
      state.encounters = bundle.encounters; state.activeId = null; state.externalChange = false; state.saved = true; state.error = null; state.migrated = false;
      navigate('home'); toast('Резервная копия восстановлена.');
    } catch (error) { toast('Восстановление не выполнено: ' + error.message, true); }
  });
  window.addEventListener('beforeunload', (event) => { if (!state.saved && state.encounters.length) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('storage', (event) => {
    if (event.key !== repository.KEY && event.key !== repository.LEGACY_KEY && event.key !== null) return;
    state.externalChange = true; state.saved = false;
    state.error = 'Данные изменены в другом окне. Автосохранение приостановлено, чтобы не перезаписать их. Скачайте нужные изменения или загрузите сохранённую версию.';
    updateSaveStatus();
  });
  render();
})();
