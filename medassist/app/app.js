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
  const updateScheme = /^#updates=(medassist-update-[a-f0-9]{32})$/.exec(window.location.hash);
  const updateUrl = window.location.protocol === 'file:' && updateScheme ? updateScheme[1] + '://check' : '';
  const state = {
    encounters: loaded.encounters, patients: loaded.patients, view: 'home', activeId: null, patientId: null, tab: 'basic', patientSearch: '',
    error: loaded.error, saved: !loaded.error, externalChange: false, search: '', migrated: Boolean(loaded.migrated),
    recordFilter: 'all', followupFilter: 'today', followupDay: '', repeatPlanId: null, patientListDay: ''
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
  const filledCount = (object) => Object.values(object).filter((value) => value.trim()).length;
  const dateText = (value) => value ? new Date(value + 'T12:00:00').toLocaleDateString('ru-RU') : 'Дата не указана';
  const localDate = () => new Date().toLocaleDateString('sv-SE');
  const headerDateFormat = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long'});
  function updateClock() {
    const now = new Date();
    const month = headerDateFormat.formatToParts(now).find((part) => part.type === 'month').value;
    const monthNumber = String(now.getMonth() + 1).padStart(2, '0');
    const date = document.getElementById('current-date');
    const time = document.getElementById('current-time');
    date.textContent = now.getDate() + ' ' + month + '(' + monthNumber + ') ' + now.getFullYear();
    date.dateTime = now.getFullYear() + '-' + monthNumber + '-' + String(now.getDate()).padStart(2, '0');
    time.textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    time.dateTime = time.textContent;
    if (state.view === 'followups' && state.followupDay !== date.dateTime) refreshFollowups();
    if (state.view === 'patients' && state.patientListDay !== date.dateTime) document.getElementById('patient-list').innerHTML = renderPatientList();
  }
  const shortId = (entry) => entry.id.replace(/^(visit|patient)-/, '').slice(0, 8).toUpperCase();
  const patientName = (patient) => patient.label.trim() || 'Демо-пациент · ' + shortId(patient);
  const patientFor = (entry) => state.patients.find((patient) => patient.id === entry.patientId);
  const patientLabel = (entry) => patientName(patientFor(entry));
  const selectedPatient = () => state.patients.find((patient) => patient.id === state.patientId);
  const patientHistory = (id) => state.encounters.filter((entry) => entry.patientId === id).sort((a, b) => b.visitDate.localeCompare(a.visitDate) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
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
    if (state.view === 'patient' && !selectedPatient()) state.view = 'patients';
    const sectionName = {home: 'Обзор', patients: 'Пациенты', followups: 'Повторные приёмы', patient: 'Карточка пациента', visit: 'Демонстрационный приём', modules: 'Модули', help: 'Помощь и данные'}[state.view];
    app.innerHTML = '<div class="shell"><aside class="sidebar" aria-label="Главная навигация"><div class="brand"><img src="icon.svg" alt=""><div><strong>МедАссистент</strong><small>ПОЛИКЛИНИЧЕСКИЙ РЕЖИМ</small></div></div><p class="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</p><nav class="nav">' +
      navButton('home', 'Обзор', 'home') + navButton('patients', 'Пациенты', 'user') + navButton('new', 'Новый пациент', 'plus') +
      (current ? navButton('visit', 'Текущий приём', 'document') : '') + navButton('followups', 'Повторные приёмы', 'calendar') + navButton('modules', 'Модули', 'grid') + navButton('help', 'Помощь и данные', 'help') + navButton('check-updates', 'Проверить обновления', 'download') +
      '</nav><div class="side-bottom"><div class="local-indicator"><span class="dot"></span>Работает локально</div><div class="version">Прототип 0.7.2 · Демонстрация</div></div></aside><div class="workspace"><header class="topbar"><div class="topbar-left">Поликлиника <span aria-hidden="true">/</span> <span>' + sectionName + '</span></div><div class="topbar-right"><div class="current-datetime" title="Дата и время на этом компьютере"><time id="current-date"></time><time id="current-time"></time></div><span class="pill"><span class="dot"></span>Офлайн · деморежим</span><span class="avatar" aria-hidden="true">МА</span></div></header><main id="main" tabindex="-1"><div id="storage-banner"></div>' +
      (state.migrated ? '<div class="migration-notice">Прежние записи доступны со статусом «Черновик». Карточки, данные и ручные тексты сохранены. Исходное сохранение предыдущей версии не изменяется.</div>' : '') +
      ({home: renderHome, patients: renderPatients, followups: renderFollowups, patient: renderPatient, visit: renderVisit, modules: renderModules, help: renderHelp}[state.view])() +
      '<footer class="footer-note"><span>Только вымышленные данные. Черновики требуют проверки врачом.</span><span>МедАссистент · 0.7.2</span></footer></main></div></div>';
    updateClock();
    updateSaveStatus();
    if (state.view === 'visit') { updateValidation(); updateDraftState(); updateReviewState(); }
  }
  function navButton(view, text, symbol) {
    return '<button type="button" data-action="' + view + '"' + (state.view === view ? ' class="active" aria-current="page"' : '') + '>' + icon(symbol) + '<span>' + text + '</span>' + (state.view === view ? '<span class="tiny-dot"></span>' : '') + '</button>';
  }
  function demoNotice() { return '<div class="demo-notice">' + icon('info') + '<span>Демонстрационный прототип. Используйте только вымышленные данные.</span></div>'; }
  function recordStatus(entry) {
    const reviewed = entry.workflow.reviewStatus === 'reviewed';
    return '<span class="record-status' + (reviewed ? ' reviewed' : '') + '">' + (reviewed ? 'Проверено врачом' : 'Черновик') + '</span>';
  }
  function filterButtons(action, choices, selected) {
    return choices.map(([value, label, count]) => button(action, label + ' · ' + count, null, (value === selected ? 'primary' : 'secondary') + ' compact', 'data-filter="' + value + '" aria-pressed="' + (value === selected) + '"')).join('');
  }
  function recordFilters() {
    return filterButtons('record-filter', [['all', 'Все', state.encounters.length], ['draft', 'Черновики', state.encounters.filter(entry => entry.workflow.reviewStatus === 'draft').length], ['reviewed', 'Проверено врачом', state.encounters.filter(entry => entry.workflow.reviewStatus === 'reviewed').length]], state.recordFilter);
  }
  const followupBuckets = [['today', 'Сегодня'], ['upcoming', 'Ближайшие'], ['past', 'Дата прошла'], ['completed', 'Состоявшиеся']];
  function followupFilters() {
    const items = core.getReturnVisits(state.encounters, localDate());
    return filterButtons('followup-filter', followupBuckets.map(([key, label]) => [key, label, items.filter(item => item.bucket === key).length]), state.followupFilter);
  }
  function renderFollowups() {
    state.followupDay = localDate();
    return '<div class="page-heading"><div><h1>Повторные приёмы</h1><p>Даты, назначенные в разделе «Запись» предыдущих приёмов.</p></div></div>' + demoNotice() +
      '<section class="card"><div class="card-head"><h2>План повторных приёмов</h2></div><div id="followup-filters" class="workflow-filters" aria-label="Период повторных приёмов">' + followupFilters() + '</div><p class="workflow-hint">«Ближайшие» — все будущие даты. Прошедшая дата не означает неявку. Отметку «Состоялся» ставьте только после подтверждения факта приёма.</p><div id="followup-list" class="list">' + renderFollowupList() + '</div></section>';
  }
  function renderFollowupList() {
    const items = core.getReturnVisits(state.encounters, localDate()).filter(item => item.bucket === state.followupFilter);
    if (!items.length) return '<div class="empty"><h3>В этом списке пока нет приёмов</h3><p>Дата повторного приёма задаётся в конце раздела «Запись».</p></div>';
    return items.map(item => {
      const source = state.encounters.find(entry => entry.id === item.encounterId);
      const completed = item.bucket === 'completed';
      return '<div class="visit-row followup-row" data-followup-id="' + escape(source.id) + '"><div class="visit-text"><strong>' + escape(patientLabel(source)) + '</strong><p class="followup-date">' + escape(dateText(item.date)) + ' · ' + (completed ? 'Состоялся' : item.linkedEncounterId ? 'Запись приёма начата' : 'Запланирован') + '</p><p>Назначено в записи от ' + escape(dateText(source.visitDate)) + ' · ' + escape(shortId(source)) + '</p></div><div class="actions followup-actions">' +
        button('patient', 'Карточка', null, 'secondary compact', 'data-patient-id="' + escape(source.patientId) + '"') +
        (item.linkedEncounterId || !completed ? button('start-followup', item.linkedEncounterId ? 'Открыть начатый приём' : 'Начать повторный приём', null, 'primary compact', 'data-id="' + escape(source.id) + '"') : '') +
        button(completed ? 'followup-reopen' : 'followup-complete', completed ? 'Вернуть в план' : 'Отметить: состоялся', null, 'secondary compact', 'data-id="' + escape(source.id) + '"') + '</div></div>';
    }).join('');
  }
  function refreshFollowups() {
    state.followupDay = localDate();
    document.getElementById('followup-filters').innerHTML = followupFilters();
    document.getElementById('followup-list').innerHTML = renderFollowupList();
  }
  function updateReviewState() {
    const entry = active();
    if (!entry || state.view !== 'visit') return;
    const heading = document.getElementById('visit-record-status');
    if (heading) heading.innerHTML = recordStatus(entry);
    const target = document.getElementById('record-review-state');
    if (!target) return;
    const reviewed = entry.workflow.reviewStatus === 'reviewed';
    target.innerHTML = recordStatus(entry) + '<p>' + (reviewed ? 'Отмечено ' + escape(new Date(entry.workflow.reviewedAt).toLocaleString('ru-RU')) + '. Изменение сведений или текста вернёт запись в черновики.' : 'Проверьте текст и его соответствие полям приёма. Программа не проверяет медицинское содержание.') + '</p>' + button(reviewed ? 'reopen-record' : 'review-record', reviewed ? 'Вернуть в черновики' : 'Отметить: проверено врачом', 'check', 'secondary');
  }
  function invalidateReview(entry) {
    const wasReviewed = entry.workflow.reviewStatus === 'reviewed';
    entry.workflow.reviewStatus = 'draft'; entry.workflow.reviewedAt = '';
    if (wasReviewed) entry.updatedAt = new Date().toISOString();
    return wasReviewed;
  }
  function requireFreshState() {
    if (!state.externalChange) return true;
    toast('Данные изменены в другом окне. Загрузите сохранённую версию перед продолжением.', true);
    return false;
  }
  function commitEncounters(encounters, patients = state.patients) {
    if (!requireFreshState()) return false;
    const result = repository.save(encounters, patients);
    state.saved = result.ok; state.error = result.error;
    if (result.ok) { state.encounters = encounters; state.patients = patients; }
    updateSaveStatus();
    if (!result.ok) toast(result.error, true);
    return result.ok;
  }
  function renderHome() {
    const drafts = state.encounters.filter((entry) => entry.workflow.reviewStatus === 'draft').length;
    return '<div class="page-heading"><div><h1>Хорошего рабочего дня.</h1><p>Для повторного приёма откройте карточку в разделе «Пациенты».</p></div>' + button('new', 'Новый пациент и приём', 'plus', 'primary') + '</div>' + demoNotice() +
      '<section class="welcome"><div><p class="eyebrow">Спокойный порядок в записях</p><h2>От приёма к понятному черновику</h2><p>Заполните анамнез и осмотр. МедАссистент соберёт введённые сведения в текст, который вы сможете проверить и отредактировать.</p><div class="actions">' + button('new', 'Начать приём', 'arrow', 'primary') + button('example', 'Открыть пример', null, 'ghost') + '</div></div><div class="welcome-illustration" aria-hidden="true"><div class="sheet-art">' + icon('document') + '<span class="art-line"></span><span class="art-line"></span><span class="art-line short"></span><span class="art-line"></span></div><div class="art-check">' + icon('check') + '</div></div></section>' +
      '<div class="stats"><div class="stat"><div class="icon-tile">' + icon('calendar') + '</div><div><div class="stat-label">Приёмов в рабочем списке</div><div class="stat-value">' + state.encounters.length + '</div></div></div><div class="stat"><div class="icon-tile">' + icon('document') + '</div><div><div class="stat-label">Незавершённые записи</div><div class="stat-value">' + drafts + '</div></div></div><div class="stat"><div class="icon-tile">' + icon('shield') + '</div><div><div class="stat-label">Проверено врачом</div><div class="stat-value">' + (state.encounters.length - drafts) + '</div></div></div></div>' +
      '<div class="dashboard-grid"><section class="card"><div class="card-head"><h2>Рабочий список</h2><span class="result-count">' + state.encounters.length + ' записей</span></div>' + (state.encounters.length ? '<div id="record-filters" class="workflow-filters" aria-label="Статус записи">' + recordFilters() + '</div><div class="search-wrap"><input class="search-field" id="visit-search" aria-label="Найти приём" placeholder="Поиск по имени, коду, дате или жалобам" value="' + escape(state.search) + '"></div><div id="visit-list" class="list">' + renderList() + '</div>' : '<div class="empty"><div class="icon-tile">' + icon('document') + '</div><h3>Здесь появятся ваши приёмы</h3><p>Начните с пустой формы или откройте заполненный вымышленный пример.</p>' + button('example', 'Открыть пример', 'document') + '</div>') + '</section><section class="card"><div class="card-head"><h2>Первый приём за 3 шага</h2></div><div class="guide-steps">' +
      [['01', 'Заполните сведения', 'Жалобы, анамнез и данные осмотра. Все поля можно оставить пустыми.'], ['02', 'Соберите запись', 'В черновик попадут только введённые вами сведения.'], ['03', 'Проверьте и сохраните', 'Отредактируйте текст и скачайте его в файл.']].map(([number, title, body]) => '<div class="guide-step"><span class="step-number">' + number + '</span><div><h3>' + title + '</h3><p>' + body + '</p></div></div>').join('') + '</div></section></div>' +
      '<div class="module-strip"><div class="icon-tile">' + icon('grid') + '</div><div><h3>Основа для дальнейших модулей</h3><p>Калькуляторы, анализы и диспансерное наблюдение.</p></div>' + button('modules', 'Что дальше', 'arrow', 'ghost') + '</div>';
  }
  function renderList() {
    const query = state.search.toLocaleLowerCase('ru').trim();
    const entries = [...state.encounters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter((entry) => [patientLabel(entry), entry.visitDate, dateText(entry.visitDate), entry.history.complaints].join(' ').toLocaleLowerCase('ru').includes(query)).filter(entry => state.recordFilter === 'all' || entry.workflow.reviewStatus === state.recordFilter);
    if (!entries.length) return '<p class="muted small">По вашему запросу приёмов нет.</p>';
    return entries.map((entry) => '<div class="visit-row" data-record-id="' + escape(entry.id) + '"><div class="visit-identity"><div class="icon-tile">' + icon('user') + '</div><div class="visit-text"><strong>' + escape(patientLabel(entry)) + '</strong><p>' + escape(dateText(entry.visitDate)) + ' · ' + escape(entry.history.complaints.trim() || 'Жалобы не указаны') + '</p><p>' + recordStatus(entry) + '</p></div></div>' + button('open', 'Открыть', null, 'secondary compact', 'data-id="' + escape(entry.id) + '" aria-label="Открыть ' + escape(patientLabel(entry)) + '"') + '</div>').join('');
  }
  function renderPatients() {
    return '<div class="page-heading"><div><h1>Пациенты</h1><p>Вымышленные карточки и история приёмов.</p></div>' + button('new', 'Новый пациент и приём', 'plus', 'primary') + '</div>' + demoNotice() +
      '<section class="card"><div class="card-head"><h2>Карточки пациентов</h2><span class="result-count">' + state.patients.length + ' карточек</span></div><div class="search-wrap"><input class="search-field" id="patient-search" aria-label="Найти пациента" placeholder="Поиск по вымышленному имени или коду" value="' + escape(state.patientSearch) + '"></div><div id="patient-list" class="list">' + renderPatientList() + '</div></section>';
  }
  function renderPatientList() {
    const today = localDate();
    state.patientListDay = today;
    const appointments = new Map();
    for (const item of core.getReturnVisits(state.encounters, today)) {
      if (item.bucket === 'completed') continue;
      if (!appointments.has(item.patientId)) appointments.set(item.patientId, {next: '', past: ''});
      const dates = appointments.get(item.patientId);
      if (item.bucket === 'past') { if (!dates.past) dates.past = item.date; }
      else if (!dates.next) dates.next = item.date;
    }
    const query = state.patientSearch.trim().toLocaleLowerCase('ru');
    const patients = state.patients.map(patient => {
      const dates = appointments.get(patient.id) || {next: '', past: ''};
      return {patient, ...dates, rank: dates.next ? 0 : dates.past ? 1 : 2};
    }).sort((a, b) => a.rank - b.rank || (a.next || a.past).localeCompare(b.next || b.past) || b.patient.updatedAt.localeCompare(a.patient.updatedAt) || a.patient.id.localeCompare(b.patient.id)).filter(({patient}) => [patientName(patient), patient.id, shortId(patient)].join(' ').toLocaleLowerCase('ru').includes(query));
    if (!patients.length) return '<div class="empty"><p>' + (state.patients.length ? 'Пациенты не найдены.' : 'Создайте первый приём — для него появится карточка пациента.') + '</p></div>';
    return patients.map(({patient, next, past}) => {
      const visits = patientHistory(patient.id);
      return '<div class="visit-row patient-row" data-patient-id="' + escape(patient.id) + '"><div class="visit-text"><strong>' + escape(patientName(patient)) + '</strong><p>Код: ' + escape(shortId(patient)) + ' · Приёмов: ' + visits.length + '</p><p>' + (visits.length ? 'Последний приём: ' + escape(dateText(visits[0].visitDate)) : 'Приёмов пока нет') + '</p>' +
        (next ? '<p class="patient-return">Повторная явка: ' + escape(dateText(next)) + (next === today ? ' · сегодня' : '') + '</p>' : '') +
        (past ? '<p class="patient-overdue">Дата явки прошла: ' + escape(dateText(past)) + ' · исход не отмечен</p>' : '') +
        '</div>' + button('patient', 'Открыть карточку', null, 'secondary compact', 'data-patient-id="' + escape(patient.id) + '"') + '</div>';
    }).join('');
  }
  function patientNameField(patient) {
    return '<div class="field full"><label for="patient-label">ФИО пациента</label><input id="patient-label" type="text" maxlength="' + core.MAX_PATIENT_LABEL_LENGTH + '" autocomplete="off" value="' + escape(patient.label) + '" placeholder="Например, Тестов Иван Демонстрационный" aria-describedby="patient-label-hint"><p id="patient-label-hint" class="hint">Только вымышленные фамилия, имя и отчество. ФИО сохраняется в карточке и отображается во всех её приёмах. Если поле пустое, используется код пациента.</p></div>';
  }
  function renderPatient() {
    const patient = selectedPatient();
    const visits = patientHistory(patient.id);
    return '<div class="page-heading"><div><h1 id="patient-heading">' + escape(patientName(patient)) + '</h1><p>Карточка · Код ' + escape(shortId(patient)) + '</p></div><div id="save-status" class="save-indicator" role="status"></div></div>' + demoNotice() +
      '<div class="patient-actions">' + button('patients', 'Все пациенты', 'user') + button('repeat', visits.length ? 'Повторный приём' : 'Первый приём', 'plus', 'primary') + '</div>' +
      '<section class="card form-card patient-details"><h2>Сведения о пациенте</h2>' + patientNameField(patient) + '</section>' +
      '<section class="card"><div class="card-head"><h2>История приёмов</h2><span class="result-count">' + visits.length + ' записей</span></div><div class="list">' + (visits.length ? visits.map((entry) => '<div class="visit-row patient-visit-row" data-visit-id="' + escape(entry.id) + '"><div class="visit-text"><strong>' + escape(dateText(entry.visitDate)) + '</strong><p>' + escape(entry.history.complaints.trim() || 'Жалобы не указаны') + '</p><p>Диагноз: ' + escape(entry.assessment.summary.trim() || 'не указан') + '</p><p>' + recordStatus(entry) + ' · Приём ' + escape(shortId(entry)) + '</p></div>' + button('open', 'Открыть приём', null, 'secondary compact', 'data-id="' + escape(entry.id) + '"') + '</div>').join('') : '<div class="empty"><p>Здесь появятся приёмы этого пациента.</p></div>') + '</div></section>';
  }
  const carryFields = [['medications', 'Принимаемые препараты на постоянной основе'], ['allergies', 'Аллергологический анамнез'], ['conditions', 'Заболевания и операции в анамнезе']];
  function updateCarryPreview() {
    const source = state.encounters.find((entry) => entry.id === document.getElementById('repeat-source').value && entry.patientId === state.patientId);
    document.getElementById('repeat-fields').innerHTML = source ? carryFields.map(([key, title]) => '<label class="carry-choice"><input type="checkbox" name="carry-history" value="' + key + '"' + (source.history[key].trim() ? '' : ' disabled') + '><span><strong>' + title + '</strong><span class="carry-preview">' + escape(source.history[key].trim() || 'Не заполнено — переносить нечего') + '</span></span></label>').join('') : '';
  }
  function openRepeatDialog(planId = null) {
    state.repeatPlanId = planId;
    const patient = selectedPatient();
    const visits = patientHistory(patient.id);
    document.getElementById('repeat-patient').textContent = patientName(patient);
    document.getElementById('repeat-title').textContent = visits.length ? 'Повторный приём' : 'Первый приём';
    const select = document.getElementById('repeat-source');
    select.innerHTML = visits.map((entry) => '<option value="' + escape(entry.id) + '">' + escape(dateText(entry.visitDate)) + ' · ' + escape(shortId(entry)) + ' · ' + escape(entry.history.complaints.trim().slice(0, 100) || 'Жалобы не указаны') + '</option>').join('');
    select.disabled = Boolean(planId);
    if (planId) select.value = planId;
    document.getElementById('repeat-source-wrap').hidden = !visits.length;
    updateCarryPreview();
    document.getElementById('repeat-dialog').showModal();
    document.getElementById('repeat-cancel').focus();
  }
  function createRepeat() {
    if (state.externalChange) {
      document.getElementById('repeat-dialog').close();
      toast('Данные изменены в другом окне. Загрузите сохранённую версию перед новым приёмом.', true); return;
    }
    const patient = selectedPatient();
    if (!patient) throw new Error('Карточка пациента больше не доступна.');
    if (state.encounters.length >= core.MAX_ENCOUNTERS) throw new Error('Достигнут лимит 500 приёмов. Сначала сохраните резервную копию.');
    const visits = patientHistory(patient.id);
    const sourceId = document.getElementById('repeat-source').value;
    const source = visits.find((entry) => entry.id === sourceId);
    if (visits.length && !source) throw new Error('Исходный приём не найден. Откройте диалог заново.');
    if (state.repeatPlanId && (!source || source.id !== state.repeatPlanId || !source.assessment.returnVisitDate)) throw new Error('План изменился. Откройте список повторных приёмов заново.');
    if (state.repeatPlanId && source.workflow.returnVisitEncounterId) {
      document.getElementById('repeat-dialog').close();
      state.activeId = source.workflow.returnVisitEncounterId; navigate('visit', 'basic'); return;
    }
    const fields = Array.from(document.querySelectorAll('#repeat-fields input:checked'), (input) => input.value);
    const entry = source ? core.createRepeatEncounter(source, {carryHistoryFields: fields}) : core.createEncounter({patientId: patient.id});
    const encounters = state.encounters.map(item => state.repeatPlanId && item.id === source.id ? {...core.linkReturnVisit(item, entry), updatedAt: entry.createdAt} : item).concat(entry);
    const patients = state.patients.map(item => item.id === patient.id ? {...item, updatedAt: entry.createdAt} : item);
    document.getElementById('repeat-dialog').close();
    if (!commitEncounters(encounters, patients)) return;
    state.activeId = entry.id; state.repeatPlanId = null; navigate('visit', 'basic');
    toast(fields.length ? 'Приём создан. Перенесены только отмеченные сведения анамнеза; проверьте их актуальность.' : 'Приём создан с пустыми полями. Сведения из прошлых приёмов не перенесены.');
  }
  function renderVisit() {
    return '<div class="page-heading visit-heading"><div><h1 id="visit-patient-heading">' + escape(patientLabel(active())) + '</h1><p id="visit-date-summary">Демонстрационный приём · ' + escape(dateText(active().visitDate)) + '</p><div id="visit-record-status">' + recordStatus(active()) + '</div></div><div id="save-status" class="save-indicator" role="status"></div></div>' + demoNotice() +
      '<div class="patient-actions">' + button('patient', 'Карточка и история пациента', 'user', 'secondary compact', 'data-patient-id="' + escape(active().patientId) + '"') + '<span class="muted small">Код пациента: ' + escape(shortId({id: active().patientId})) + ' · Приём: ' + escape(shortId(active())) + '</span></div>' +
      '<nav class="tab-bar" aria-label="Разделы приёма">' + tabs.map(([key, label], i) => '<button type="button" class="tab' + (state.tab === key ? ' active' : '') + '" data-action="tab" data-tab="' + key + '"' + (state.tab === key ? ' aria-current="step"' : '') + '><span class="step-number">' + (i + 1) + '</span>' + label + '</button>').join('') + '</nav>' +
      ({basic: renderBasic, history: renderHistory, exam: renderExam, draft: renderDraft}[state.tab])();
  }
  function aside(title, text) {
    const entry = active();
    return '<aside class="side-card">' + icon('edit') + '<h3>' + title + '</h3><p>' + text + '</p><div class="summary-rows"><div class="summary-row"><span>Анамнез</span><span data-summary="history">' + filledCount(entry.history) + ' из 7 полей</span></div><div class="summary-row"><span>Признаки осмотра</span><span id="exam-total">' + filledCount(entry.examSelections) + ' из ' + examCatalog.FIELDS.length + '</span></div><div class="summary-row"><span>Показатели</span><span data-summary="vitals">' + filledCount(entry.vitals) + ' из 8 полей</span></div></div></aside>';
  }
  function nextFooter(previous, next, label) {
    return '<div class="form-footer">' + (previous ? button('tab', 'Назад', null, 'secondary', 'data-tab="' + previous + '"') : '<span class="muted small">Все поля необязательны</span>') + button('tab', label, 'arrow', 'primary', 'data-tab="' + next + '"') + '</div>';
  }
  function renderBasic() {
    return '<div class="form-layout"><section class="card form-card"><h2>Сведения о приёме</h2><p class="section-intro">Укажите вымышленное ФИО и сведения об этом приёме. Все поля необязательны.</p><div class="field-grid three">' + patientNameField(patientFor(active())) +
      field('visitDate', 'Дата приёма', '', {type: 'date'}) + field('age', 'Возраст, полных лет', 'Не указан', {type: 'text', numeric: true}) +
      field('sex', 'Пол', '', {select: [['', 'Не указан'], ['female', 'Женский'], ['male', 'Мужской'], ['unspecified', 'Не уточнён']]}) +
      '</div>' + nextFooter(null, 'history', 'Перейти к анамнезу') + '</section>' + aside('Карточка пациента', 'Сведения сохраняются при вводе. ФИО связано с карточкой пациента; возраст и пол относятся к этому приёму. Для переноса данных используйте резервную копию.') + '</div>';
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
      '<div class="form-section"><p class="small muted">Сформируйте текст из заполненных разделов и проверьте его перед использованием.</p>' + button('generate', 'Сформировать черновик', 'document', 'primary') + '</div></section><section class="card draft-card"><div class="card-head"><h2>Текст записи</h2><span class="pill neutral">Редактируемый текст</span></div><div id="draft-state" class="draft-state" role="status"></div><label class="small muted" for="draft-text">Текст записи · свободное редактирование</label><textarea class="draft-editor" id="draft-text" data-field="draft.text" maxlength="100000" aria-describedby="draft-state field-draft-text-error" placeholder="Нажмите «Сформировать черновик» или начните писать здесь.">' + escape(active().draft.text) + '</textarea><p class="field-error" id="field-draft-text-error" hidden></p><div class="actions">' + button('copy', 'Копировать', 'copy') + button('download-text', 'Скачать .txt', 'download') + '</div><div id="record-review-state" class="record-review-state"></div><p class="small muted">Это свободный демонстрационный черновик, не нормативная форма Беларуси.</p></section></div>';
  }
  function renderModules() {
    return '<div class="page-heading"><div><h1>Модули</h1><p>Направления расширения МедАссистента.</p></div><span class="pill neutral">План развития</span></div>' + demoNotice() +
      '<p class="section-intro">Сейчас работает модуль приёма и черновика. Карточки ниже описывают будущие возможности; отдельные калькуляторы, анализы, расписания и официальные формы ещё не подключены. ИМТ уже рассчитывается в разделе «Осмотр».</p><div class="module-grid">' + window.MedAssistModules.map((module) => '<section class="card module-card"><div class="module-head"><div class="icon-tile">' + icon(module.icon) + '</div><span class="pill neutral">' + (module.status === 'verification' ? 'После проверки источников' : 'Запланировано') + '</span></div><h2>' + escape(module.title) + '</h2><p>' + escape(module.description) + '</p><details><summary>Что потребуется для добавления</summary><p>' + escape(module.requirements) + '</p></details></section>').join('') + '</div>';
  }
  function renderHelp() {
    return '<div class="page-heading"><div><h1>Помощь и данные</h1><p>Первый запуск, сохранение и границы прототипа.</p></div></div><div class="help-layout"><section class="card help-card"><h2>Как пройти демонстрационный приём</h2><ol><li>Нажмите «Новый пациент» для новой карточки и пустого приёма или «Открыть пример» на главной.</li><li>Заполните сведения о приёме, анамнез и осмотр. Вводите только вымышленные данные.</li><li>В разделе «Запись» заполните диагноз, при необходимости рекомендации, дату повторного приёма и отметку о больничном. Нажмите «Сформировать черновик».</li><li>Проверьте и отредактируйте текст. Скачайте .txt или скопируйте его.</li></ol><h2>Карточка и повторный приём</h2><p>Раздел «Пациенты» содержит карточки с историей по датам. В списке видны последний приём и ближайшая предстоящая повторная явка. Пациенты с явкой сегодня или позже идут первыми, от ближайшей даты к дальней; только с прошедшей незакрытой датой — следом, без назначений — в конце. Состоявшиеся приёмы не участвуют в этом порядке. ФИО пациента можно ввести в начале вкладки «Приём» или изменить в карточке. Это одно общее поле; используйте только вымышленные фамилию, имя и отчество. Кнопка «Повторный приём» создаёт отдельную запись того же пациента. Выберите исходный приём и отметьте нужные препараты, аллергии и заболевания; нажмите «Создать приём» для подтверждения. Без отметок перенос не выполняется. При смене источника отметки сбрасываются. Возраст, пол, жалобы, осмотр, показатели и заключение заполните заново.</p><h2>Повторные даты и проверка записи</h2><p>Дата в конце раздела «Запись» появляется в списке «Повторные приёмы». Там доступны сегодняшние, все будущие и прошедшие даты. Прошедшая дата не означает неявку. «Начать повторный приём» создаёт связанную запись после подтверждения переноса; повторное нажатие открывает её. Отдельно отметьте «Состоялся» после фактического приёма. Изменение назначенной даты сбрасывает отметку и связь, но сохраняет запись в истории.</p><p>На вкладке «Запись» нажмите «Отметить: проверено врачом» после проверки непустого текста. Это личная отметка, не электронная подпись. Правки сведений, текста или ФИО снимают её. На главной фильтр «Черновики» показывает незавершённые записи. Статус записи и факт состоявшегося приёма независимы.</p><h2>Режимы работы</h2><p>Сейчас доступен поликлинический режим. Стационарный режим запланирован отдельно; его формы и функции будут определены на следующем этапе.</p><h2>Что делает прототип</h2><p>Собирает введённые сведения в свободный текст. Работает из локальных файлов, без аккаунта, сервера, МИС и внешних запросов приложения.</p><p>Диагноз и рекомендации вводит врач. Программа не назначает лечение и не оформляет больничные документы. Варианты осмотра — вспомогательные формулировки; источники и ограничения перечислены в EXAM-SOURCES.md. Нормативные формы Беларуси не реализованы.</p><h2>Запуск в Windows</h2><p>Распакуйте архив в постоянную папку и откройте <span class="code-path">Start-MedAssist.cmd</span>. Приложение использует установленный Edge или Chrome. Также можно открыть <span class="code-path">app/index.html</span>.</p></section><section class="card help-card"><h2>Сохранение на этом компьютере</h2><p>Изменения автоматически сохраняются в локальном хранилище текущего браузера. Статус сохранения показан в приёме. При ошибке вы увидите сообщение.</p><p>Хранение локальных HTML-файлов зависит от браузера. Перемещение папки, другой профиль или очистка данных браузера могут сделать записи недоступными. Перед этим скачайте резервную копию.</p><p>Резервная копия содержит карточки, связанные приёмы и отредактированные черновики. Восстановление заменит все карточки и приёмы после подтверждения.</p><div class="backup-actions">' + button('backup', 'Резервная копия', 'download', 'primary') + button('import', 'Восстановить', 'upload') + button('reset', 'Очистить демонстрационные записи', null, 'secondary') + '</div><h2>Обновление программы через интернет</h2><p>Нажмите «Проверить обновления» в левом меню. Откроется окно проверки; браузер может попросить разрешить его запуск. Если доступна новая версия, сохраните резервную копию, закройте окна МедАссистента и подтвердите установку в окне обновления.</p><p>Для работы кнопки запускайте программу через <span class="code-path">Start-MedAssist.cmd</span> или обычный ярлык <span class="code-path">MedAssist</span>. При открытии файла index.html напрямую потребуется повторный запуск через ярлык. Отдельный <span class="code-path">Update-MedAssist.cmd</span> остаётся запасным способом.</p><p>Обновления загружаются из публичного проекта romaick/medassist на GitHub. Скачивать и распаковывать архивы вручную не понадобится. Без интернета приёмы работают как раньше.</p><h2>Перенос записей из прежней папки</h2><p>Сначала скачайте резервную копию в старой версии. Новая версия принимает её через «Восстановить» и сохраняет старые тексты. Если файлы обновлены в той же папке и браузере, доступные старые записи загрузятся автоматически. Новые копии со статусами и планом повторных приёмов открываются в версии 0.7 и новее. Из копий версий 1 и 2 каждый приём получает отдельную карточку; карточки версии 3 сохраняются. Автоматического объединения пациентов нет.</p><h2>Только демонстрация</h2><p>Данные сохраняются без шифрования. Прототип не подготовлен для реальных медицинских записей. Используйте только вымышленные сведения.</p></section></div>';
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
    const result = repository.save(state.encounters, state.patients);
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
    if (action === 'check-updates') {
      if (!updateUrl) { document.getElementById('update-help').showModal(); return; }
      window.location.assign(updateUrl);
      toast('Если браузер запросит разрешение, нажмите «Открыть». Результат проверки появится в отдельном окне.');
      return;
    }
    if (['home', 'patients', 'followups', 'help', 'modules', 'visit'].includes(action)) { navigate(action); return; }
    if (action === 'record-filter') {
      state.recordFilter = target.dataset.filter;
      document.getElementById('record-filters').innerHTML = recordFilters();
      document.getElementById('visit-list').innerHTML = renderList(); return;
    }
    if (action === 'followup-filter') { state.followupFilter = target.dataset.filter; refreshFollowups(); return; }
    if (action === 'start-followup') {
      const source = state.encounters.find(entry => entry.id === target.dataset.id);
      if (!source || !requireFreshState()) return;
      if (source.workflow.returnVisitEncounterId) { state.activeId = source.workflow.returnVisitEncounterId; navigate('visit', 'basic'); return; }
      state.patientId = source.patientId; openRepeatDialog(source.id); return;
    }
    if (action === 'followup-complete' || action === 'followup-reopen') {
      if (!requireFreshState()) return;
      const source = state.encounters.find(entry => entry.id === target.dataset.id);
      if (!source) return;
      const completed = action === 'followup-complete';
      if (!await confirmAction(completed ? 'Повторный приём состоялся?' : 'Вернуть дату в план?', patientLabel(source) + ' · ' + dateText(source.assessment.returnVisitDate) + '.\n' + (completed ? 'Подтвердите, что приём действительно состоялся. Это не отмечает врачебную запись как проверенную.' : 'Отметка «Состоялся» будет снята. Связанная запись и её текст сохранятся.'), completed ? 'Да, состоялся' : 'Вернуть в план')) return;
      if (!requireFreshState()) return;
      const updated = core.setReturnVisitStatus(source, completed ? 'completed' : 'planned');
      updated.updatedAt = new Date().toISOString();
      if (!commitEncounters(state.encounters.map(entry => entry.id === source.id ? updated : entry))) return;
      render(); toast(completed ? 'Приём отмечен как состоявшийся.' : 'Дата возвращена в план.'); return;
    }
    if (action === 'review-record' || action === 'reopen-record') {
      if (!requireFreshState()) return;
      const source = active();
      const reviewed = action === 'review-record';
      if (reviewed && !source.draft.text.trim()) { toast('Сначала сформируйте или напишите текст записи и проверьте его.', true); return; }
      if (reviewed && updateValidation().length) { toast('Исправьте отмеченные ошибки полей перед проверкой записи.', true); return; }
      if (!await confirmAction(reviewed ? 'Отметить запись как проверенную?' : 'Вернуть запись в черновики?', reviewed ? 'Подтвердите, что вы проверили текст и его соответствие сведениям приёма. Программа не оценивает медицинское содержание. Отметка не является электронной подписью.' : 'Текст останется без изменений. Отметка проверки врачом будет снята.', reviewed ? 'Проверено врачом' : 'Вернуть в черновики')) return;
      if (!requireFreshState()) return;
      const updated = core.setReviewStatus(source, reviewed ? 'reviewed' : 'draft');
      updated.updatedAt = new Date().toISOString();
      if (!commitEncounters(state.encounters.map(entry => entry.id === source.id ? updated : entry))) return;
      render(); toast(reviewed ? 'Запись отмечена: проверено врачом.' : 'Запись возвращена в черновики.'); return;
    }
    if (action === 'patient') { state.patientId = target.dataset.patientId; navigate('patient'); return; }
    if (action === 'repeat') {
      if (state.externalChange) { toast('Сначала загрузите сохранённую версию: данные изменились в другом окне.', true); return; }
      openRepeatDialog(); return;
    }
    if (action === 'tab') { navigate('visit', target.dataset.tab); return; }
    if (action === 'new' || action === 'example') {
      if (state.encounters.length >= 500) { toast('В прототипе можно хранить до 500 приёмов. Скачайте резервную копию перед очисткой.', true); return; }
      if (state.patients.length >= core.MAX_PATIENTS) { toast('Достигнут лимит 500 карточек. Скачайте резервную копию перед очисткой.', true); return; }
      const patient = core.createPatient();
      const entry = action === 'new' ? core.createEncounter({patientId: patient.id}) : core.createDemoEncounter({patientId: patient.id});
      state.patients.push(patient); state.patientId = patient.id;
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
      if (!requireFreshState()) return;
      invalidateReview(entry);
      entry.draft = {text: core.generateDraft(entry), generatedAt: new Date().toISOString(), sourceFingerprint: core.fingerprint(entry)};
      entry.updatedAt = new Date().toISOString(); persist(); render(); document.getElementById('draft-text').focus(); toast('Черновик сформирован. Проверьте и отредактируйте текст.'); return;
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
      download(core.serializeBundle(state.encounters, state.patients), 'MedAssist-backup-' + localDate() + '.json', 'application/json');
      toast('Резервная копия передана браузеру для сохранения.'); return;
    }
    if (action === 'import') { document.getElementById('import-file').click(); return; }
    if (action === 'reset') {
      if (!await confirmAction('Очистить демонстрационные записи?', 'Будут удалены все сохранённые в этом браузере приёмы и ручные черновики МедАссистента. Скачанные файлы останутся. При необходимости сначала сделайте резервную копию.', 'Очистить записи')) return;
      const result = repository.reset([]);
      if (!result.ok) { state.error = result.error; state.saved = false; updateSaveStatus(); toast(result.error, true); return; }
      state.encounters = []; state.patients = []; state.activeId = null; state.patientId = null; state.externalChange = false; state.saved = true; state.error = null; state.migrated = false; navigate('home'); toast('Демонстрационные записи очищены.'); return;
    }
    if (action === 'reload') {
      if (!await confirmAction('Загрузить сохранённую версию?', 'Текущие изменения в этом окне будут заменены данными из локального хранилища. При необходимости сначала скачайте резервную копию.', 'Загрузить')) return;
      const result = repository.load();
      if (result.error) { toast(result.error, true); return; }
      state.encounters = result.encounters; state.patients = result.patients; state.activeId = null; state.patientId = null; state.externalChange = false; state.error = null; state.saved = true; state.migrated = Boolean(result.migrated); navigate('home');
    }
    if (action === 'normal-exam' || action === 'normal-exam-section') {
      const entry = active();
      const section = action === 'normal-exam-section' ? examCatalog.SECTIONS.find((item) => item.id === target.dataset.section) : null;
      if (!entry || (action === 'normal-exam-section' && !section)) return;
      const fields = examCatalog.FIELDS.filter((field) => !section || field.section === section.id);
      const hasDifferentSelection = fields.some((field) => entry.examSelections[field.id] && entry.examSelections[field.id] !== examCatalog.NORMAL_SELECTIONS[field.id]);
      const scope = section ? 'В разделе «' + section.title + '»' : 'В осмотре';
      if (hasDifferentSelection && !await confirmAction('Заменить выбранные признаки осмотра?', scope + ' уже есть варианты, отличающиеся от «без особенностей». Они будут заменены. Ваши уточнения и измеренные показатели сохранятся; проверьте их согласованность с выбранными признаками.', 'Заполнить без особенностей')) return;
      if (!requireFreshState()) return;
      const reviewReset = fields.some(field => entry.examSelections[field.id] !== examCatalog.NORMAL_SELECTIONS[field.id]) && invalidateReview(entry);
      const openSections = new Set(Array.from(app.querySelectorAll('.exam-group[open]'), (group) => group.dataset.examSection));
      for (const field of fields) entry.examSelections[field.id] = examCatalog.NORMAL_SELECTIONS[field.id];
      entry.updatedAt = new Date().toISOString();
      persist(); render();
      app.querySelectorAll('.exam-group').forEach((group) => { group.open = !section || group.dataset.examSection === section.id || openSections.has(group.dataset.examSection); });
      app.querySelector(section ? '[data-action="normal-exam-section"][data-section="' + section.id + '"]' : '[data-action="normal-exam"]').focus({preventScroll: true});
      toast((section ? 'Заполнен раздел «' + section.title + '».' : 'Варианты осмотра заполнены.') + ' Проверьте признаки и при необходимости измените отдельные пункты.' + (reviewReset ? ' Запись возвращена в черновики.' : ''));
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
    if (control.id === 'patient-search') {
      state.patientSearch = control.value; document.getElementById('patient-list').innerHTML = renderPatientList(); return;
    }
    if (control.id === 'patient-label') {
      const patient = state.view === 'visit' ? patientFor(active()) : selectedPatient();
      if (patient.label === control.value) return;
      patient.label = control.value; patient.updatedAt = new Date().toISOString();
      let reviewReset = false;
      state.encounters.filter(entry => entry.patientId === patient.id).forEach(entry => { if (invalidateReview(entry)) reviewReset = true; });
      document.getElementById(state.view === 'visit' ? 'visit-patient-heading' : 'patient-heading').textContent = patientName(patient);
      persist(); updateReviewState();
      if (state.view === 'patient') app.querySelectorAll('[data-visit-id]').forEach(row => { row.querySelector('.record-status').outerHTML = recordStatus(state.encounters.find(entry => entry.id === row.dataset.visitId)); });
      if (reviewReset) toast('ФИО изменено. Проверенные записи этой карточки возвращены в черновики.');
      return;
    }
    if (control.id === 'visit-search') {
      state.search = control.value; document.getElementById('visit-list').innerHTML = renderList(); return;
    }
    if (!control.dataset.field || !active()) return;
    if (get(active(), control.dataset.field) === control.value) return;
    const reviewReset = invalidateReview(active());
    const planReset = control.dataset.field === 'assessment.returnVisitDate' && (active().workflow.returnVisitStatus === 'completed' || Boolean(active().workflow.returnVisitEncounterId));
    if (control.dataset.field === 'assessment.returnVisitDate') {
      active().workflow.returnVisitStatus = 'planned'; active().workflow.returnVisitEncounterId = '';
    }
    set(active(), control.dataset.field, control.value);
    active().updatedAt = new Date().toISOString();
    if (control.dataset.field === 'visitDate') document.getElementById('visit-date-summary').textContent = 'Демонстрационный приём · ' + dateText(active().visitDate);
    app.querySelectorAll('[data-summary]').forEach((element) => {
      const fields = active()[element.dataset.summary];
      element.textContent = filledCount(fields) + ' из ' + Object.keys(fields).length + ' полей';
    });
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
      if (total) total.textContent = filledCount(active().examSelections) + ' из ' + examCatalog.FIELDS.length;
    }
    updateValidation(); persist(); updateDraftState(); updateReviewState();
    if (planReset || reviewReset) toast((planReset ? 'Дата изменена: отметка и связь с повторным приёмом сброшены. Сам приём сохранён в истории. ' : '') + (reviewReset ? 'Запись возвращена в черновики.' : ''));
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
      if (!await confirmAction('Восстановить резервную копию?', 'В файле приёмов: ' + bundle.encounters.length + '. Текущих приёмов: ' + state.encounters.length + '.\nВсе текущие карточки, приёмы и черновики будут заменены данными из файла.', 'Восстановить')) return;
      const result = repository.reset(bundle.encounters, bundle.patients);
      if (!result.ok) throw new Error(result.error);
      state.encounters = bundle.encounters; state.patients = bundle.patients; state.activeId = null; state.patientId = null; state.externalChange = false; state.saved = true; state.error = null; state.migrated = false;
      navigate('home'); toast('Резервная копия восстановлена.');
    } catch (error) { toast('Восстановление не выполнено: ' + error.message, true); }
  });
  window.addEventListener('beforeunload', (event) => { if (!state.saved && (state.encounters.length || state.patients.length)) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('storage', (event) => {
    if (!repository.WATCHED_KEYS.includes(event.key) && event.key !== null) return;
    state.externalChange = true; state.saved = false;
    state.error = 'Данные изменены в другом окне. Автосохранение приостановлено, чтобы не перезаписать их. Скачайте нужные изменения или загрузите сохранённую версию.';
    updateSaveStatus();
  });
  render();
  document.getElementById('repeat-source').addEventListener('change', updateCarryPreview);
  document.getElementById('repeat-cancel').addEventListener('click', () => document.getElementById('repeat-dialog').close());
  document.getElementById('repeat-create').addEventListener('click', () => {
    try { createRepeat(); } catch (error) { document.getElementById('repeat-dialog').close(); toast(error.message, true); }
  });
  window.setInterval(updateClock, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });
  document.querySelector('.skip-link').addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('main').focus();
  });
  document.getElementById('update-help-close').addEventListener('click', () => document.getElementById('update-help').close());
})();
