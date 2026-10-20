(async function () {
  'use strict';
  const core = window.MedAssistCore;
  const repository = window.MedAssistStorage;
  const pager = window.MedAssistPager;
  const app = document.getElementById('app');
  if (!core || !repository || !window.MedAssistExam || !pager) {
    app.textContent = 'Не удалось загрузить файлы приложения. Распакуйте архив полностью и запустите Start-MedAssist.cmd ещё раз.';
    return;
  }

  let icd;
  let icdLoadError = '';
  try {
    if (!window.MedAssistICDReady) throw new Error('Файл справочника отсутствует.');
    icd = await window.MedAssistICDReady;
  } catch (error) { icdLoadError = error.message; }
  const loaded = repository.load();
  const updateScheme = /^#updates=(medassist-update-[a-f0-9]{32})$/.exec(window.location.hash);
  const updateUrl = window.location.protocol === 'file:' && updateScheme ? updateScheme[1] + '://check' : '';
  const state = {
    encounters: loaded.encounters, patients: loaded.patients, templates: loaded.templates || [], view: 'home', activeId: null, patientId: null, tab: 'basic', patientSearch: '',
    error: loaded.error, saved: !loaded.error, externalChange: false, search: '', migrated: Boolean(loaded.migrated),
    recordFilter: 'draft', followupFilter: 'today', followupDay: '', repeatPlanId: null, patientListDay: '', homeDay: '',
    patientCategory: 'all', patientFilters: defaultPatientFilters(), patientFiltersOpen: false, pendingNew: null,
    patientEditOpen: false, patientCardDay: '', patientTab: 'history', previousOpen: false, previousId: '', previousForId: '',
    investigationPatientId: '', investigationSeriesKey: '', birthDateInputs: {}, visitDateInputs: {}
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
  const tabs = [['basic', 'Приём'], ['history', 'Анамнез'], ['exam', 'Осмотр'], ['investigations', 'Исследования'], ['draft', 'Запись']];
  const patientModules = [
    {id: 'history', title: 'История приёмов', action: 'patient-history', render: renderPatientHistory},
    {id: 'investigations', title: 'Анализы и исследования', action: 'investigations', render: renderInvestigations},
    {id: 'sick', title: 'Журнал больничных', action: 'sick-journal', render: renderSickLeaveJournal}
  ];
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
  let diagnosisSuggestions = null;
  let diagnosisForm = null;
  let diagnosisDeletePending = false;
  let sickLeaveForm = null;
  let templateForm = null;
  let prescriptionForm = null;
  let prescriptionDeletePending = false;
  let investigationForm = null;
  let investigationDeletePending = false;
  let investigationReportForm = null;
  let investigationAttachForm = null;
  let backupStatusMinute = '';
  let restorePreview = null;
  let restoreReadToken = 0;
  let repeatPreparation = null;
  const investigationFields = ['kind', 'date', 'name', 'result', 'unit', 'reference', 'note'];
  const prescriptionFields = [
    ['name', 'Название препарата'], ['dose', 'Дозировка / доза на приём'],
    ['route', 'Способ применения'], ['frequency', 'Кратность / режим приёма'],
    ['duration', 'Длительность'], ['note', 'Примечание']
  ];
  const vitalFields = [
    ['systolic', 'АД систолическое', 'мм рт. ст.'], ['diastolic', 'АД диастолическое', 'мм рт. ст.'],
    ['pulse', 'Пульс', 'уд/мин'], ['temperature', 'Температура', '°C'],
    ['respiratoryRate', 'Частота дыхания', 'в минуту'], ['spo2', 'SpO₂', '%'],
    ['weight', 'Масса', 'кг'], ['height', 'Рост', 'см']
  ];
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const icon = (name) => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || icons.document) + '</svg>';
  const active = () => state.encounters.find((entry) => entry.id === state.activeId) || (state.pendingNew?.entry.id === state.activeId ? state.pendingNew.entry : undefined);
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
    const backupMinute = now.toISOString().slice(0, 16);
    if (backupStatusMinute !== backupMinute) { backupStatusMinute = backupMinute; updateBackupStatus(); }
    if (state.view === 'followups' && state.followupDay !== date.dateTime) refreshFollowups();
    if (state.view === 'patients' && state.patientListDay !== date.dateTime) refreshPatients();
    if (state.view === 'home' && state.homeDay !== date.dateTime) refreshHomeDay();
    if (state.view === 'patient' && state.patientCardDay !== date.dateTime) refreshPatientReturn();
  }
  const shortId = (entry) => entry.id.replace(/^(visit|patient)-/, '').slice(0, 8).toUpperCase();
  const patientName = (patient) => patient.label.trim() || 'Демо-пациент · ' + shortId(patient);
  const patientFor = (entry) => state.patients.find((patient) => patient.id === entry.patientId) || (state.pendingNew?.patient.id === entry.patientId ? state.pendingNew.patient : undefined);
  const patientLabel = (entry) => patientName(patientFor(entry));
  const selectedPatient = () => state.patients.find((patient) => patient.id === state.patientId);
  const patientHistory = (id) => state.encounters.filter((entry) => entry.patientId === id).sort((a, b) => b.visitDate.localeCompare(a.visitDate) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  function patientIdentityDetails(patient, date = localDate(), includeCode = false) {
    const age = core.calculateAge(patient.birthDate || '', date);
    return (patient.birthDate ? 'Дата рождения: ' + dateText(patient.birthDate) + (age === null ? '' : ' · Полных лет: ' + age) : 'Дата рождения не указана') +
      (includeCode ? ' · Код: ' + shortId(patient) : '');
  }
  function patientBirthDateError(patient, value) {
    if (!value) return '';
    if (core.calculateAge(value, localDate()) === null) return value > localDate() ? 'Дата рождения не может быть позже сегодняшнего дня.' : 'Укажите существующую дату рождения.';
    const visits = patientHistory(patient.id).concat(state.pendingNew?.patient.id === patient.id ? [state.pendingNew.entry] : []);
    const invalidVisit = visits.find(entry => core.calculateAge(value, entry.visitDate) === null);
    return invalidVisit ? 'Дата рождения должна быть не позже даты каждого приёма. Проверьте приём ' + dateText(invalidVisit.visitDate) + '.' : '';
  }
  function dateInputIssues(entry = active()) {
    const patient = state.view === 'patient' ? selectedPatient() : entry && patientFor(entry);
    const issues = [];
    if (patient && state.birthDateInputs[patient.id]) issues.push({field: 'patient.birthDate', message: state.birthDateInputs[patient.id].error});
    if (state.view === 'visit' && entry && state.visitDateInputs[entry.id]) issues.push({field: 'visitDate', message: state.visitDateInputs[entry.id].error});
    return issues;
  }
  function updatePatientAgeDisplays(patient) {
    app.querySelectorAll('[data-patient-age-summary]').forEach(element => {
      element.textContent = patientIdentityDetails(patient, state.view === 'visit' ? active().visitDate : localDate(), state.view === 'visit');
    });
    app.querySelectorAll('[data-encounter-age]').forEach(element => {
      const entry = state.encounters.find(item => item.id === element.dataset.encounterAge) || active();
      if (entry) element.textContent = core.encounterAge(entry, patient).trim() || 'Не указан';
    });
    const control = document.getElementById('field-age');
    if (control) {
      control.value = core.encounterAge(active(), patient);
      control.readOnly = Boolean(patient.birthDate);
      document.getElementById('field-age-hint').textContent = patient.birthDate ? 'Рассчитан по дате рождения на дату этого приёма.' : 'Можно указать вручную, если дата рождения неизвестна.';
    }
  }
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
    const value = path === 'visitDate' && state.visitDateInputs[active().id] ? state.visitDateInputs[active().id].value : get(active(), path);
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
    pager.invalidate();
    diagnosisSuggestions = null;
    const current = active();
    if (state.view === 'visit' && !current) state.view = 'home';
    if (state.view === 'patient' && !selectedPatient()) state.view = 'patients';
    document.body.classList.toggle('visit-view', state.view === 'visit');
    const sectionName = {home: 'Обзор', patients: 'Пациенты', followups: 'Повторные приёмы', patient: 'Карточка пациента', visit: 'Демонстрационный приём', modules: 'Модули', help: 'Помощь и данные'}[state.view];
    app.innerHTML = '<div class="shell"><header class="navigation-header"><div class="brand"><img src="icon.svg" alt=""><div><strong>МедАссистент</strong><small>ПОЛИКЛИНИЧЕСКИЙ РЕЖИМ</small></div></div><nav id="main-navigation" class="nav pager-tabs" aria-label="Главная навигация">' +
      navButton('home', 'Обзор', 'home') + navButton('patients', 'Пациенты', 'user') +
      (current ? navButton('visit', 'Текущий приём', 'document') : navButton('new', 'Новый пациент', 'plus')) + navButton('followups', 'Повторные приёмы', 'calendar') + navButton('modules', 'Модули', 'grid') + navButton('help', 'Помощь и данные', 'help') + navButton('check-updates', 'Проверить обновления', 'download') +
      '</nav></header><aside class="topbar context-sidebar" aria-label="Дата, время и текущий раздел"><div class="current-datetime" title="Дата и время на этом компьютере"><time id="current-date"></time><time id="current-time"></time></div><div class="topbar-left"><span class="context-mode">Поликлиника</span><strong>' + sectionName + '</strong></div><div class="side-bottom"><span class="pill"><span class="dot"></span>Офлайн · деморежим</span><div class="version">Прототип 0.20.0 · Демонстрация</div></div></aside><div class="workspace"><main id="main" tabindex="-1"><div id="storage-banner"></div>' +
      (state.migrated ? '<div class="migration-notice">Прежние записи доступны со статусом «Черновик». Карточки, данные и ручные тексты сохранены. Исходное сохранение предыдущей версии не изменяется.</div>' : '') +
      ({home: renderHome, patients: renderPatients, followups: renderFollowups, patient: renderPatient, visit: renderVisit, modules: renderModules, help: renderHelp}[state.view])() +
      '<footer class="footer-note"><span>Только вымышленные данные. Черновики требуют проверки врачом.</span><span>МедАссистент · 0.20.0</span></footer></main></div></div>';
    const reminder = document.createElement('section');
    reminder.id = 'backup-reminder'; reminder.className = 'backup-reminder'; reminder.hidden = true;
    document.getElementById('storage-banner').after(reminder);
    app.querySelector('.backup-actions')?.insertAdjacentHTML('beforebegin', '<section id="backup-status" class="backup-status" aria-label="Последняя резервная копия"></section>');
    updateClock();
    updateBackupStatus();
    updateSaveStatus();
    if (state.view === 'visit') { updateValidation(); updateDraftState(); updateReviewState(); }
    observeVisitLayout();
    bindPageNavigation();
  }
  function navButton(view, text, symbol) {
    const current = view === (state.view === 'patient' ? 'patients' : state.view);
    return '<button type="button" data-action="' + view + '" class="' + (view === 'check-updates' ? 'nav-command' : 'pager-tab') + (current ? ' active' : '') + '"' + (current ? ' aria-current="page"' : '') + '>' + icon(symbol) + '<span>' + text + '</span>' + (current ? '<span class="tiny-dot"></span>' : '') + '</button>';
  }
  function demoNotice() { return '<div class="demo-notice">' + icon('info') + '<span>Демонстрационный прототип. Используйте только вымышленные данные.</span></div>'; }
  function recordStatus(entry) {
    const reviewed = entry.workflow.reviewStatus === 'reviewed';
    return '<span class="record-status' + (reviewed ? ' reviewed' : '') + '">' + (reviewed ? 'Проверено врачом' : 'Черновик') + '</span>';
  }
  function filterButtons(action, choices, selected, panelId) {
    return choices.map(([value, label, count]) => button(action, label + ' · ' + count, null, (value === selected ? 'primary active' : 'secondary') + ' compact pager-tab', 'id="' + action + '-' + value + '" role="tab" data-filter="' + value + '" aria-controls="' + panelId + '" aria-selected="' + (value === selected) + '" aria-pressed="' + (value === selected) + '" tabindex="' + (value === selected ? '0' : '-1') + '"')).join('');
  }
  const recordBuckets = [['all', 'Все'], ['draft', 'Черновики'], ['reviewed', 'Проверено врачом']];
  function recordFilters() {
    return filterButtons('record-filter', recordBuckets.map(([key, label]) => [key, label, state.encounters.filter(entry => key === 'all' || entry.workflow.reviewStatus === key).length]), state.recordFilter, 'visit-list');
  }
  const followupBuckets = [['today', 'Сегодня'], ['upcoming', 'Ближайшие'], ['past', 'Дата прошла'], ['completed', 'Состоявшиеся']];
  function followupFilters() {
    const items = core.getReturnVisits(state.encounters, localDate());
    return filterButtons('followup-filter', followupBuckets.map(([key, label]) => [key, label, items.filter(item => item.bucket === key).length]), state.followupFilter, 'followup-list');
  }
  function renderFollowups() {
    state.followupDay = localDate();
    return '<div class="page-heading"><div><h1>Повторные приёмы</h1><p>Даты, назначенные в разделе «Запись» предыдущих приёмов.</p></div></div>' + demoNotice() +
      '<section class="card"><div class="card-head"><h2>План повторных приёмов</h2></div><div id="followup-filters" class="workflow-filters pager-tabs" role="tablist" aria-label="Период повторных приёмов">' + followupFilters() + '</div><p class="workflow-hint">«Ближайшие» — все будущие даты. Прошедшая дата не означает неявку. Отметку «Состоялся» ставьте только после подтверждения факта приёма.</p><div id="followup-list" class="list pager-viewport" role="tabpanel" aria-labelledby="followup-filter-' + state.followupFilter + '" tabindex="0">' + renderFollowupList() + '</div></section>';
  }
  function renderFollowupList(bucket = state.followupFilter, compact = false) {
    const items = core.getReturnVisits(state.encounters, localDate()).filter(item => item.bucket === bucket);
    if (!items.length) return '<div class="empty"><h3>' + (compact ? 'На сегодня явок нет' : 'В этом списке пока нет приёмов') + '</h3><p>' + (compact ? 'Все назначенные даты доступны в разделе «Повторные приёмы».' : 'Дата повторного приёма задаётся в конце раздела «Запись».') + '</p></div>';
    return items.map(item => {
      const source = state.encounters.find(entry => entry.id === item.encounterId);
      const completed = item.bucket === 'completed';
      return '<div class="visit-row followup-row" data-followup-id="' + escape(source.id) + '"><div class="visit-text"><strong>' + escape(patientLabel(source)) + '</strong><p class="followup-date">' + escape(dateText(item.date)) + ' · ' + (completed ? 'Состоялся' : item.linkedEncounterId ? 'Запись приёма начата' : 'Запланирован') + '</p><p>Назначено в записи от ' + escape(dateText(source.visitDate)) + ' · ' + escape(shortId(source)) + '</p></div><div class="actions followup-actions">' +
        button('patient', 'Карточка', null, 'secondary compact', 'data-patient-id="' + escape(source.patientId) + '"') +
        (item.linkedEncounterId || !completed ? button('start-followup', item.linkedEncounterId ? 'Открыть начатый приём' : 'Начать повторный приём', null, 'primary compact', 'data-id="' + escape(source.id) + '"') : '') +
        (compact ? '' : button(completed ? 'followup-reopen' : 'followup-complete', completed ? 'Вернуть в план' : 'Отметить: состоялся', null, 'secondary compact', 'data-id="' + escape(source.id) + '"')) + '</div></div>';
    }).join('');
  }
  function refreshFollowups() {
    pager.invalidate();
    const focusedTab = document.activeElement.closest('#followup-filters [role="tab"]')?.id;
    state.followupDay = localDate();
    document.getElementById('followup-filters').innerHTML = followupFilters();
    document.getElementById('followup-list').innerHTML = renderFollowupList();
    document.getElementById('followup-list').setAttribute('aria-labelledby', 'followup-filter-' + state.followupFilter);
    bindPageNavigation();
    if (focusedTab) document.getElementById(focusedTab)?.focus({preventScroll: true});
  }
  function updateReviewState() {
    const entry = active();
    if (!entry || state.view !== 'visit') return;
    const heading = document.getElementById('visit-record-status');
    if (heading) heading.innerHTML = recordStatus(entry);
    const target = document.getElementById('record-review-state');
    if (!target) return;
    const reviewed = entry.workflow.reviewStatus === 'reviewed';
    target.innerHTML = recordStatus(entry) + '<p>' + (reviewed ? 'Отмечено ' + escape(new Date(entry.workflow.reviewedAt).toLocaleString('ru-RU')) + '. Изменение сведений или текста вернёт запись в черновики.' : 'Проверьте текст и его соответствие полям приёма. Программа не проверяет медицинское содержание.') + '</p>';
    document.getElementById('record-review-actions').innerHTML = button(reviewed ? 'reopen-record' : 'review-record', reviewed ? 'Вернуть в черновики' : 'Отметить: проверено врачом', 'check', 'secondary');
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
    const result = repository.save(encounters, patients, state.templates);
    state.saved = result.ok; state.error = result.error;
    if (result.ok) { state.encounters = encounters; state.patients = patients; }
    updateSaveStatus();
    if (!result.ok) toast(result.error, true);
    return result.ok;
  }
  function homeCurrentEncounter() {
    const current = active();
    if (current?.workflow.reviewStatus === 'draft' && (!state.pendingNew || pendingHasContent())) return current;
    return [...state.encounters].filter(entry => entry.workflow.reviewStatus === 'draft').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))[0];
  }
  function refreshHomeDay() {
    pager.invalidate();
    const today = localDate();
    state.homeDay = today;
    document.getElementById('home-followup-list').innerHTML = renderFollowupList('today', true);
    document.getElementById('home-followup-count').textContent = String(core.getReturnVisits(state.encounters, today).filter(item => item.bucket === 'today').length);
    document.getElementById('home-review-today-count').textContent = String(state.encounters.filter(entry => entry.workflow.reviewStatus === 'draft' && entry.visitDate === today).length);
    document.getElementById('visit-list').innerHTML = renderList();
    bindPageNavigation();
  }
  function refreshRecords() {
    pager.invalidate();
    const focusedTab = document.activeElement.closest('#record-filters [role="tab"]')?.id;
    document.getElementById('record-filters').innerHTML = recordFilters();
    document.getElementById('home-record-heading').textContent = {draft: 'Записи для проверки', all: 'Все записи', reviewed: 'Проверенные записи'}[state.recordFilter];
    document.getElementById('visit-list').innerHTML = renderList();
    document.getElementById('visit-list').setAttribute('aria-labelledby', 'record-filter-' + state.recordFilter);
    bindPageNavigation();
    if (focusedTab) document.getElementById(focusedTab)?.focus({preventScroll: true});
  }
  function renderHome() {
    state.homeDay = localDate();
    const current = homeCurrentEncounter();
    const todayFollowups = core.getReturnVisits(state.encounters, state.homeDay).filter(item => item.bucket === 'today').length;
    const todayDrafts = state.encounters.filter(entry => entry.workflow.reviewStatus === 'draft' && entry.visitDate === state.homeDay).length;
    const listHeading = state.recordFilter === 'draft' ? 'Записи для проверки' : state.recordFilter === 'reviewed' ? 'Проверенные записи' : 'Все записи';
    return '<div class="home-page"><div class="page-heading"><div><h1>Сегодня</h1><p class="home-demo-note">Деморежим · только вымышленные данные</p></div>' + button('start-visit', 'Начать приём', 'plus', 'primary') + '</div>' +
      '<section id="home-current" class="card home-current" aria-labelledby="home-current-heading"><div class="home-current-content"><h2 id="home-current-heading">' + (current && current.id !== state.activeId ? 'Последний сохранённый черновик' : 'Текущий приём') + '</h2>' +
      (current ? '<div class="home-current-patient"><strong>' + escape(patientLabel(current)) + '</strong>' + recordStatus(current) + '</div><p class="home-current-meta">' + escape(dateText(current.visitDate)) + (current.id !== state.activeId ? ' · Последний изменённый черновик' : '') + '</p><p class="home-current-complaint">' + escape(current.history.complaints.trim() || 'Жалобы пока не указаны') + '</p>' : '<p class="home-current-empty">Незавершённого приёма нет. Выберите пациента, чтобы начать новый.</p>') + '</div>' +
      (current ? button('resume-visit', current.id === state.activeId ? 'Продолжить приём' : 'Открыть черновик', 'arrow', 'primary', 'data-id="' + escape(current.id) + '"') : !state.encounters.length ? button('example', 'Открыть вымышленный пример', 'document', 'secondary compact') : '') + '</section>' +
      '<div class="home-dashboard"><section class="card home-followups" aria-labelledby="home-followup-heading"><div class="card-head"><h2 id="home-followup-heading">Явки сегодня <span id="home-followup-count" class="home-count">' + todayFollowups + '</span></h2>' + button('home-followups', 'План явок', 'arrow', 'ghost') + '</div><div id="home-followup-list" class="list">' + renderFollowupList('today', true) + '</div></section>' +
      '<section class="card home-records" aria-labelledby="home-record-heading"><div class="card-head"><h2 id="home-record-heading">' + listHeading + '</h2><p class="home-today-summary">Черновиков сегодня: <strong id="home-review-today-count">' + todayDrafts + '</strong></p></div><div id="record-filters" class="workflow-filters pager-tabs" role="tablist" aria-label="Статус записи">' + recordFilters() + '</div><div class="search-wrap"><label class="home-search-label" for="visit-search">Найти запись</label><input class="search-field" id="visit-search" type="search" placeholder="ФИО, код, дата или жалобы" value="' + escape(state.search) + '"></div><div id="visit-list" class="list pager-viewport" role="tabpanel" aria-labelledby="record-filter-' + state.recordFilter + '" tabindex="0">' + renderList() + '</div></section></div></div>';
  }
  function renderList() {
    const query = state.search.toLocaleLowerCase('ru').trim();
    const today = localDate();
    const entries = [...state.encounters].sort((a, b) => Number(b.visitDate === today) - Number(a.visitDate === today) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).filter((entry) => [patientLabel(entry), shortId(entry), entry.visitDate, dateText(entry.visitDate), entry.history.complaints].join(' ').toLocaleLowerCase('ru').includes(query)).filter(entry => state.recordFilter === 'all' || entry.workflow.reviewStatus === state.recordFilter);
    if (!entries.length) return '<div class="home-list-empty"><p>' + (query ? 'По вашему запросу записей нет.' : state.recordFilter === 'draft' ? 'Записей для проверки нет.' : state.recordFilter === 'reviewed' ? 'Проверенных записей пока нет.' : 'Записей пока нет.') + '</p></div>';
    return entries.map((entry) => '<div class="visit-row" data-record-id="' + escape(entry.id) + '"><div class="visit-identity"><div class="visit-text"><strong>' + escape(patientLabel(entry)) + '</strong><p class="home-record-date">' + escape(dateText(entry.visitDate)) + (entry.visitDate === today ? ' · Сегодня' : '') + ' · ' + escape(shortId(entry)) + '</p><p class="home-record-complaint">' + escape(entry.history.complaints.trim() || 'Жалобы не указаны') + '</p>' + recordStatus(entry) + '</div></div>' + button('open', state.recordFilter === 'draft' ? 'Проверить запись' : 'Открыть', null, 'secondary compact', 'data-id="' + escape(entry.id) + '"' + (state.recordFilter === 'draft' ? ' data-tab="draft"' : '') + ' aria-label="' + (state.recordFilter === 'draft' ? 'Проверить запись: ' : 'Открыть ') + escape(patientLabel(entry)) + '"') + '</div>').join('');
  }
  const patientCategories = [['all', 'Все пациенты'], ['sick', 'На больничном'], ['return', 'Повторная явка'], ['draft', 'Незавершённые записи']];
  function normalizePatientSearch(value, dates = true) {
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const iso = (day, month, year) => year + '-' + String(month).padStart(2, '0') + '-' + day.padStart(2, '0');
    const text = value.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    if (!dates) return text;
    return text
      .replace(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g, (_, day, month, year) => iso(day, month, year))
      .replace(/\b(\d{1,2}) (января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s*\(\d{1,2}\))? (\d{4})\b/g, (_, day, month, year) => iso(day, months.indexOf(month) + 1, year));
  }
  const searchWords = text => text.match(/[\p{L}\p{N}]+(?:[./_-][\p{L}\p{N}]+)*/gu) || [];
  function oneSearchEdit(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return a.length < b.length ? a.slice(i) === b.slice(i + 1) : a.slice(i + 1) === b.slice(i);
  }
  function patientSearchField(label, value, weight, approximate = true, identity = false) {
    const text = normalizePatientSearch(value) + ' ' + normalizePatientSearch(value, false);
    return {label, value, weight, approximate, identity, text, words: new Set(searchWords(text))};
  }
  function scorePatientSearch(fields, terms) {
    const found = [];
    for (const term of terms) {
      let best = null;
      for (const field of fields) {
        let quality = field.words.has(term) ? 3 : field.text.includes(term) ? 2 : 0;
        if (!quality && field.approximate && /^[\p{L}]{5,}$/u.test(term) && [...field.words].some(word => /^[\p{L}]+$/u.test(word) && oneSearchEdit(term, word))) quality = 1;
        if (quality && (!best || quality > best.quality || (quality === best.quality && field.weight > best.field.weight))) best = {quality, field, term};
      }
      if (!best && /\d/.test(term)) return null;
      if (best) found.push(best);
    }
    if (!terms.length || found.length < Math.ceil(terms.length * 2 / 3)) return null;
    const score = found.length * 1000000 + found.reduce((sum, item) => sum + item.quality * 1000 + item.field.weight, 0);
    const labels = [...new Set(found.map(item => item.field.label))];
    const partial = found.length < terms.length ? 'Совпало слов: ' + found.length + ' из ' + terms.length + '. ' : '';
    const approximate = found.some(item => item.quality === 1) ? ' · похожее написание' : '';
    const context = found.find(item => !item.field.identity && item.field.approximate);
    let excerpt = '';
    if (context) {
      const value = context.field.value.replace(/\s+/g, ' ').trim();
      const start = Math.max(0, normalizePatientSearch(value, false).indexOf(context.term) - 45);
      excerpt = context.field.label + ': ' + (start ? '…' : '') + value.slice(start, start + 160) + (value.length > start + 160 ? '…' : '');
    }
    return {score, reason: partial + 'Совпадение: ' + labels.join(', ') + approximate, excerpt, recordMatch: found.some(item => !item.field.identity)};
  }
  function patientSearchMatch(row, terms) {
    if (!state.patientSearch.trim()) return {searchHit: true, searchMatches: [], searchScore: 0, searchReason: '', searchExcerpt: ''};
    const identity = [patientSearchField('ФИО', patientName(row.patient), 6, true, true), patientSearchField('Код пациента', row.patient.id + ' ' + shortId(row.patient), 6, false, true)];
    const identityMatch = scorePatientSearch(identity, terms);
    const candidates = row.visits.map(entry => {
      const fields = [...identity, patientSearchField('Код приёма', entry.id + ' ' + shortId(entry), 5, false)];
      for (const [label, date] of [['Дата приёма', entry.visitDate], ['Повторная явка', entry.assessment.returnVisitDate]]) {
        if (date) fields.push(patientSearchField(label, date + ' ' + dateText(date) + ' ' + headerDateFormat.format(new Date(date + 'T12:00:00')) + ' ' + date.slice(0, 4), 4, false));
      }
      if (entry.assessment.sickLeaveIssued === 'yes') fields.push(patientSearchField('Номер ЛН', entry.assessment.sickLeaveNumber, 5, false));
      fields.push(patientSearchField('Жалобы', entry.history.complaints, 4), patientSearchField('Диагноз', entry.assessment.summary, 4));
      fields.push(patientSearchField('Анамнез', Object.entries(entry.history).filter(([key]) => key !== 'complaints').map(([, value]) => value).join(' '), 2));
      const exam = Object.values(entry.exam);
      for (const field of examCatalog.FIELDS) {
        const selected = field.options.find(option => option.value === entry.examSelections[field.id]);
        if (selected) exam.push(selected.text);
      }
      fields.push(patientSearchField('Осмотр', exam.join(' '), 2), patientSearchField('Рекомендации', entry.assessment.plan + ' ' + entry.assessment.followUp, 2), patientSearchField('Текст записи', entry.draft.text, 1));
      if (entry.prescriptions?.length) fields.push(patientSearchField('Назначения препаратов', entry.prescriptions.map(item => prescriptionFields.map(([key]) => item[key]).join(' ')).join(' '), 3));
      const match = scorePatientSearch(fields, terms);
      return match ? {...match, entry} : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score || b.entry.visitDate.localeCompare(a.entry.visitDate) || a.entry.id.localeCompare(b.entry.id));
    const journalMatch = scorePatientSearch([...identity, ...row.leaves.filter(leave => leave.journal).map(leave => patientSearchField('Номер ЛН в журнале', leave.number, 5, false))], terms);
    const investigationMatches = (row.patient.investigations || []).map(item => scorePatientSearch([...identity,
      patientSearchField('Анализы и исследования', (item.reportTitle || '') + ' ' + item.name + ' ' + (item.kind === 'lab' ? 'Анализ' : 'Исследование'), 4),
      patientSearchField('Дата исследования', item.date + ' ' + dateText(item.date) + ' ' + headerDateFormat.format(new Date(item.date + 'T12:00:00')) + ' ' + item.date.slice(0, 4), 4, false),
      patientSearchField('Результат', item.result + ' ' + item.unit, 3),
      patientSearchField('Нормы из бланка', item.reference, 2), patientSearchField('Примечание к исследованию', item.note, 2)
    ], terms));
    const best = [identityMatch, journalMatch, ...investigationMatches, ...candidates].filter(Boolean).sort((a, b) => b.score - a.score)[0];
    return {searchHit: Boolean(best), searchScore: best?.score || 0, searchReason: best?.reason || '', searchExcerpt: best?.excerpt || '', searchMatches: candidates.filter(item => item.recordMatch).map(item => item.entry)};
  }
  function defaultPatientFilters(category = 'all') {
    return {sick: 'all', return: 'all', returnFrom: '', returnTo: '', lastFrom: '', lastTo: '', review: 'all', sort: category === 'sick' ? 'sick' : 'return'};
  }
  const patientFilterOptions = {
    sick: [['all', 'Открытые и требующие уточнения'], ['current', 'Действует по указанным датам'], ['today', 'Заканчивается сегодня'], ['soon', 'Заканчивается за 3 дня, включая сегодня'], ['unknown', 'Период не указан полностью']],
    return: [['all', 'Любая'], ['today', 'Сегодня'], ['week', 'Ближайшие 7 дней, включая сегодня'], ['range', 'Диапазон дат'], ['past', 'Дата прошла'], ['none', 'Не назначена / все состоялись']],
    review: [['all', 'Любой статус'], ['draft', 'Есть черновики'], ['reviewed', 'Все записи проверены врачом']],
    sort: [['return', 'По ближайшей явке'], ['sick', 'По окончанию действующего ЛН'], ['last', 'По последнему приёму: новые выше'], ['name', 'По ФИО: А–Я']]
  };
  function patientFilterField(key, title, type) {
    const id = 'patient-filter-' + key;
    const value = state.patientFilters[key];
    return '<div class="field"><label for="' + id + '">' + title + '</label>' + (type === 'date' ? '<input type="date" id="' + id + '" data-patient-filter="' + key + '" value="' + escape(value) + '" aria-describedby="patient-filter-error">' : '<select id="' + id + '" data-patient-filter="' + key + '">' + patientFilterOptions[key].map(([code, label]) => '<option value="' + code + '"' + (value === code ? ' selected' : '') + '>' + label + '</option>').join('') + '</select>') + '</div>';
  }
  function calendarOffset(today, days) {
    const date = new Date(today + 'T12:00:00');
    date.setDate(date.getDate() + days);
    return date.toLocaleDateString('sv-SE');
  }
  function patientRows(today) {
    const appointments = new Map();
    for (const item of core.getReturnVisits(state.encounters, today)) {
      if (item.bucket === 'completed') continue;
      if (!appointments.has(item.patientId)) appointments.set(item.patientId, []);
      appointments.get(item.patientId).push(item.date);
    }
    return state.patients.map(patient => {
      const visits = patientHistory(patient.id);
      const dates = appointments.get(patient.id) || [];
      const next = dates.find(date => date >= today) || '';
      const past = dates.find(date => date < today) || '';
      const journal = core.getSickLeaveJournal(patient, state.encounters);
      const leaves = journal.leaves.map(leave => ({number: leave.number, from: leave.periods[0].from, to: leave.periods.at(-1).to, days: leave.days, current: leave.status === 'open' && leave.periods.some(period => period.from <= today && period.to >= today), unknown: false, open: leave.status === 'open', journal: true})).concat(journal.legacy.map(leave => ({...leave, current: Boolean(leave.from && leave.to && leave.from <= today && leave.to >= today), unknown: !leave.from || !leave.to})));
      return {patient, visits, dates, next, past, leaves, rank: next ? 0 : past ? 1 : 2, drafts: visits.filter(entry => entry.workflow.reviewStatus === 'draft').length};
    });
  }
  function inPatientCategory(row, category) {
    return category === 'all' || (category === 'sick' && row.leaves.some(leave => leave.open || leave.current || leave.unknown)) || (category === 'return' && row.dates.length > 0) || (category === 'draft' && row.drafts > 0);
  }
  function patientCategoryButtons(rows) {
    return patientCategories.map(([key, title]) => button('patient-category', title + ' · ' + rows.filter(row => inPatientCategory(row, key)).length, null, (state.patientCategory === key ? 'primary active' : 'secondary') + ' compact pager-tab', 'id="patient-category-' + key + '" role="tab" data-category="' + key + '" aria-controls="patient-list" aria-selected="' + (state.patientCategory === key) + '" aria-pressed="' + (state.patientCategory === key) + '" tabindex="' + (state.patientCategory === key ? '0' : '-1') + '"')).join('');
  }
  function patientFilterError() {
    const f = state.patientFilters;
    if (f.return === 'range' && f.returnFrom && f.returnTo && f.returnFrom > f.returnTo) return 'Повторная явка: дата «с» должна быть не позже даты «по».';
    if (f.lastFrom && f.lastTo && f.lastFrom > f.lastTo) return 'Последний приём: дата «с» должна быть не позже даты «по».';
    return '';
  }
  function matchesSickFilter(leave, today) {
    const filter = state.patientFilters.sick;
    if (filter === 'unknown') return leave.unknown;
    if (filter === 'all') return leave.open || leave.current || leave.unknown;
    return leave.current && (filter === 'current' || (filter === 'today' && leave.to === today) || (filter === 'soon' && leave.to <= calendarOffset(today, 2)));
  }
  function matchesPatientReturnDate(date, today) {
    const f = state.patientFilters;
    return (f.return === 'today' && date === today) || (f.return === 'week' && date >= today && date <= calendarOffset(today, 6)) || (f.return === 'past' && date < today) || (f.return === 'range' && (!f.returnFrom || date >= f.returnFrom) && (!f.returnTo || date <= f.returnTo));
  }
  function filteredPatients(rows, today) {
    if (patientFilterError()) return [];
    const f = state.patientFilters;
    const within = (date, from, to) => Boolean(date) && (!from || date >= from) && (!to || date <= to);
    const terms = [...new Set(searchWords(normalizePatientSearch(state.patientSearch)))];
    const result = rows.map(row => ({...row, ...patientSearchMatch(row, terms)})).filter(row => {
      if (!inPatientCategory(row, state.patientCategory)) return false;
      if (!row.searchHit) return false;
      if (state.patientCategory === 'sick' && !row.leaves.some(leave => matchesSickFilter(leave, today))) return false;
      if (f.return === 'none' && row.dates.length) return false;
      if (!['all', 'none'].includes(f.return) && !row.dates.some(date => matchesPatientReturnDate(date, today))) return false;
      if ((f.lastFrom || f.lastTo) && !within(row.visits[0]?.visitDate, f.lastFrom, f.lastTo)) return false;
      if (f.review === 'draft' && !row.drafts) return false;
      if (f.review === 'reviewed' && (!row.visits.length || row.drafts)) return false;
      return true;
    });
    const sickEnd = row => row.leaves.filter(leave => (leave.open || leave.current) && (state.patientCategory !== 'sick' || matchesSickFilter(leave, today))).map(leave => leave.to).sort()[0] || '';
    const missingLast = (a, b, descending = false) => !a ? (b ? 1 : 0) : !b ? -1 : (descending ? b.localeCompare(a) : a.localeCompare(b));
    return result.sort((a, b) => {
      if (state.patientSearch.trim() && a.searchScore !== b.searchScore) return b.searchScore - a.searchScore;
      let order;
      if (f.sort === 'name') order = patientName(a.patient).localeCompare(patientName(b.patient), 'ru');
      else if (f.sort === 'last') order = missingLast(a.visits[0]?.visitDate, b.visits[0]?.visitDate, true);
      else if (f.sort === 'sick') order = missingLast(sickEnd(a), sickEnd(b));
      else order = a.rank - b.rank || (a.next || a.past).localeCompare(b.next || b.past);
      return order || b.patient.updatedAt.localeCompare(a.patient.updatedAt) || a.patient.id.localeCompare(b.patient.id);
    });
  }
  function patientFilterSummary() {
    const f = state.patientFilters;
    const labels = [];
    if (state.patientSearch.trim()) labels.push('Поиск: ' + state.patientSearch.trim());
    for (const [key, title] of [['sick', 'ЛН'], ['return', 'Явка'], ['review', 'Записи']]) {
      if (key === 'sick' && state.patientCategory !== 'sick') continue;
      if (f[key] !== 'all') labels.push(title + ': ' + patientFilterOptions[key].find(([code]) => code === f[key])[1]);
    }
    if (f.return === 'range' && (f.returnFrom || f.returnTo)) labels.push('Явка ' + (f.returnFrom ? 'с ' + dateText(f.returnFrom) : '') + (f.returnTo ? ' по ' + dateText(f.returnTo) : ''));
    if (f.lastFrom || f.lastTo) labels.push('Последний приём ' + (f.lastFrom ? 'с ' + dateText(f.lastFrom) : '') + (f.lastTo ? ' по ' + dateText(f.lastTo) : ''));
    if (state.patientSearch.trim()) labels.push('Порядок: сначала наиболее близкие совпадения');
    else if (f.sort !== defaultPatientFilters(state.patientCategory).sort) labels.push('Порядок: ' + patientFilterOptions.sort.find(([code]) => code === f.sort)[1]);
    return labels.map(label => '<span class="patient-filter-chip">' + escape(label) + '</span>').join('');
  }
  function renderPatients() {
    const today = localDate();
    state.patientListDay = today;
    const rows = patientRows(today), filtered = filteredPatients(rows, today);
    return '<div class="patients-page"><div class="page-heading"><div class="patients-title"><h1>Пациенты</h1><span class="result-count" id="patient-result-count" role="status">Показано: ' + filtered.length + ' из ' + rows.length + '</span></div>' + button('new', 'Новый пациент и приём', 'plus', 'primary') + '</div>' + demoNotice() +
      '<section class="card patients-card" aria-label="Карточки пациентов">' +
      '<div id="patient-categories" class="workflow-filters pager-tabs" role="tablist" aria-label="Рубрики пациентов" title="Количество пациентов до применения фильтров. Пациент может входить в несколько рубрик.">' + patientCategoryButtons(rows) + '</div>' +
      '<div class="patient-search-toolbar"><div class="field patient-search-input"><label for="patient-search">Поиск пациентов и приёмов</label><input id="patient-search" type="search" maxlength="200" aria-describedby="patient-search-hint" placeholder="Фамилия, жалоба, диагноз, дата, номер больничного…" value="' + escape(state.patientSearch) + '"></div>' + button('patient-toggle-filters', state.patientFiltersOpen ? 'Скрыть фильтры' : 'Фильтры', null, 'secondary', 'aria-controls="patient-filter-panel" aria-expanded="' + state.patientFiltersOpen + '"') + '</div>' +
      '<details class="patients-search-help"><summary>Как работает поиск</summary><p id="patient-search-hint">По всей истории, включая анализы и исследования: одно или несколько ключевых слов, наиболее близкие совпадения выше. Даты: 19.10.2026 или 19 октября 2026. Рубрика и фильтры действуют и при поиске. Числа в рубриках учитывают пациентов до фильтрации; пациент может входить в несколько рубрик.</p></details>' +
      '<div id="patient-filter-panel" class="patient-filter-panel"' + (state.patientFiltersOpen ? '' : ' hidden') + '><div id="patient-sick-filter"' + (state.patientCategory === 'sick' ? '' : ' hidden') + '>' + patientFilterField('sick', 'Больничный лист') + '<p class="small muted">Открытые записи журнала остаются в рубрике до отметки закрытия. Прежние отметки из приёмов учитываются по датам; неполный период требует уточнения. Фильтры по срокам используют только внесённые периоды.</p></div>' +
      '<div class="field-grid three">' + patientFilterField('return', 'Повторная явка') + patientFilterField('review', 'Статус записей') + patientFilterField('sort', 'Сортировка') + '</div>' +
      '<div id="patient-return-range" class="field-grid patient-date-range"' + (state.patientFilters.return === 'range' ? '' : ' hidden') + '>' + patientFilterField('returnFrom', 'Явка: с', 'date') + patientFilterField('returnTo', 'Явка: по', 'date') + '</div>' +
      '<div class="field-grid patient-date-range">' + patientFilterField('lastFrom', 'Последний приём: с', 'date') + patientFilterField('lastTo', 'Последний приём: по', 'date') + '</div>' +
      '</div><div class="patient-active-filters"><p id="patient-filter-error" class="field-error" role="alert">' + patientFilterError() + '</p><div id="patient-filter-summary" class="patient-filter-summary">' + patientFilterSummary() + '</div>' + button('patient-reset-filters', 'Сбросить фильтры и поиск', null, 'secondary compact', patientFilterSummary() ? '' : 'hidden') + '</div>' +
      '<div class="patients-columns" aria-hidden="true"><span>Пациент</span><span>Последний приём</span><span>Повторная явка</span><span>Больничный лист</span><span>Статус записей</span><span></span></div><div id="patient-list" class="list pager-viewport" role="tabpanel" aria-labelledby="patient-category-' + state.patientCategory + '" tabindex="0">' + renderPatientList(filtered, today) + '</div></section></div>';
  }
  function refreshPatients() {
    pager.invalidate();
    const today = localDate();
    state.patientListDay = today;
    const rows = patientRows(today), filtered = filteredPatients(rows, today);
    document.getElementById('patient-categories').innerHTML = patientCategoryButtons(rows);
    document.getElementById('patient-result-count').textContent = 'Показано: ' + filtered.length + ' из ' + rows.length;
    document.getElementById('patient-list').innerHTML = renderPatientList(filtered, today);
    document.getElementById('patient-list').setAttribute('aria-labelledby', 'patient-category-' + state.patientCategory);
    document.getElementById('patient-filter-summary').innerHTML = patientFilterSummary();
    app.querySelector('[data-action="patient-reset-filters"]').hidden = !patientFilterSummary();
    document.getElementById('patient-return-range').hidden = state.patientFilters.return !== 'range';
    document.getElementById('patient-filter-error').textContent = patientFilterError();
    for (const [from, to, enabled] of [['returnFrom', 'returnTo', state.patientFilters.return === 'range'], ['lastFrom', 'lastTo', true]]) {
      const invalid = Boolean(enabled && state.patientFilters[from] && state.patientFilters[to] && state.patientFilters[from] > state.patientFilters[to]);
      for (const key of [from, to]) document.getElementById('patient-filter-' + key).setAttribute('aria-invalid', String(invalid));
    }
    bindPageNavigation();
  }
  function renderPatientList(patients, today) {
    if (!patients.length) return '<div class="empty"><p>' + (patientFilterError() ? 'Исправьте диапазон дат, чтобы увидеть пациентов.' : state.patients.length ? 'По выбранным условиям пациенты не найдены.' : 'Создайте первый приём — для него появится карточка пациента.') + '</p></div>';
    return patients.map(({patient, visits, dates, next, past, leaves, drafts, searchMatches, searchReason, searchExcerpt}) => {
      const matchedDates = [...new Set(dates.filter(date => date !== next && date !== past && matchesPatientReturnDate(date, today)))];
      let shownLeaves = leaves.filter(leave => state.patientCategory === 'sick' ? matchesSickFilter(leave, today) : leave.open || leave.current || leave.unknown);
      if (!shownLeaves.length && leaves.length && state.patientCategory !== 'sick') shownLeaves = [leaves[0]];
      const uniqueLeaves = new Map(shownLeaves.map(leave => [JSON.stringify([leave.number, leave.from, leave.to, leave.open]), leave]));
      const sickText = [...uniqueLeaves.values()].map(leave => '<p class="patient-sick"><span>ЛН ' + (leave.number.trim() ? '№' + escape(leave.number) : '· номер не указан') + '</span><span class="patient-cell-note">' + (leave.from ? 'с ' + escape(dateText(leave.from)) : 'начало не указано') + ' · ' + (leave.to ? 'по ' + escape(dateText(leave.to)) : 'окончание не указано') + '</span>' + (leave.days !== null ? '<span class="patient-cell-note patient-sick-days">Календарных дней: ' + leave.days + '</span>' : '') + (leave.journal ? '<span class="patient-cell-note">' + (leave.open ? 'Открыт' : 'Закрыт') + ' · в журнале</span>' : '') + (leave.current || (leave.journal && !leave.open) ? '' : '<span class="patient-cell-note">' + (leave.unknown ? 'период требует уточнения' : leave.from > today ? 'период ещё не начался' : 'указанный период прошёл') + '</span>') + '</p>').join('');
      const matchButton = entry => button('open', 'Приём ' + dateText(entry.visitDate) + ' · ' + shortId(entry), null, 'secondary compact', 'data-id="' + escape(entry.id) + '"');
      return '<div class="visit-row patient-row" data-patient-id="' + escape(patient.id) + '"><div class="patient-cell patient-identity visit-text"><strong>' + escape(patientName(patient)) + '</strong><p class="patient-birth-summary">' + escape(patientIdentityDetails(patient)) + '</p><p>Код: ' + escape(shortId(patient)) + ' · Приёмов: ' + visits.length + '</p></div>' +
        '<div class="patient-cell patient-last"><p>' + (visits.length ? '<span class="patient-cell-label">Последний приём: </span>' + escape(dateText(visits[0].visitDate)) : 'Приёмов пока нет') + '</p></div>' +
        '<div class="patient-cell patient-return-cell">' + (next ? '<p class="patient-return"><span class="patient-cell-label">Повторная явка: </span>' + escape(dateText(next)) + (next === today ? ' · сегодня' : '') + '</p>' : '') +
        (past ? '<p class="patient-overdue">' + escape(dateText(past)) + '<span class="patient-cell-note">Дата прошла · исход не отмечен</span></p>' : '') +
        (matchedDates.length ? '<p class="patient-return">Другие явки по фильтру: ' + matchedDates.map(date => escape(dateText(date))).join(', ') + '</p>' : '') + (!next && !past ? '<p class="patient-cell-empty"><span class="patient-cell-label">Повторная явка: </span>Не назначена</p>' : '') + '</div>' +
        '<div class="patient-cell patient-sick-cell">' + (sickText || '<p class="patient-cell-empty"><span class="patient-cell-label">Больничный лист: </span>Не указан</p>') + '</div>' +
        '<div class="patient-cell patient-status-cell">' + (visits.length ? '<span class="record-status' + (drafts ? '' : ' reviewed') + '">' + (drafts ? 'Черновиков: ' + drafts : 'Все записи проверены врачом') + '</span>' : '<p class="patient-cell-empty">Нет записей</p>') + '</div>' +
        '<div class="patient-cell patient-open">' + button('patient', 'Карточка', null, 'secondary compact', 'data-patient-id="' + escape(patient.id) + '" aria-label="Открыть карточку ' + escape(patientName(patient)) + '"') + '</div>' +
        (searchReason || searchExcerpt || searchMatches.length ? '<div class="patient-search-result">' + (searchReason ? '<p class="patient-search-reason">' + escape(searchReason) + '</p>' : '') + (searchExcerpt ? '<p class="patient-search-excerpt">' + escape(searchExcerpt) + '</p>' : '') +
        (searchMatches.length ? '<div class="patient-search-matches">' + matchButton(searchMatches[0]) + (searchMatches.length > 1 ? '<details><summary>Ещё приёмов по поиску: ' + (searchMatches.length - 1) + '</summary><div>' + searchMatches.slice(1).map(matchButton).join('') + '</div></details>' : '') + '</div>' : '') + '</div>' : '') + '</div>';
    }).join('');
  }
  function patientNameField(patient) {
    return '<div class="field full"><label for="patient-label">ФИО пациента</label><input id="patient-label" type="text" maxlength="' + core.MAX_PATIENT_LABEL_LENGTH + '" autocomplete="off" value="' + escape(patient.label) + '" placeholder="Например, Тестов Иван Демонстрационный" aria-describedby="patient-label-hint"><p id="patient-label-hint" class="hint">Только вымышленные фамилия, имя и отчество. ФИО сохраняется в карточке и отображается во всех её приёмах. Если поле пустое, используется код пациента.</p></div>';
  }
  function patientBirthDateField(patient) {
    const pending = state.birthDateInputs[patient.id];
    return '<div class="field patient-birth-field"><label for="patient-birth-date">Дата рождения</label><input id="patient-birth-date" data-field="patient.birthDate" type="date" max="' + localDate() + '" value="' + escape(pending ? pending.value : patient.birthDate || '') + '" aria-invalid="' + Boolean(pending) + '" aria-describedby="patient-birth-date-hint patient-birth-date-error"><p id="patient-birth-date-hint" class="hint">Необязательно. Сохраняется в карточке; возраст рассчитывается на дату каждого приёма.</p><p id="patient-birth-date-error" class="field-error"' + (pending ? '' : ' hidden') + '>' + escape(pending?.error || '') + '</p></div>';
  }
  function renderEncounterAge() {
    const patient = patientFor(active());
    return '<div class="field"><label for="field-age">Возраст, полных лет</label><input id="field-age" data-field="age" type="text" inputmode="decimal" maxlength="30" value="' + escape(core.encounterAge(active(), patient)) + '" placeholder="Не указан"' + (patient.birthDate ? ' readonly' : '') + ' aria-describedby="field-age-error field-age-hint"><p id="field-age-hint" class="hint">' + (patient.birthDate ? 'Рассчитан по дате рождения на дату этого приёма.' : 'Можно указать вручную, если дата рождения неизвестна.') + '</p><p id="field-age-error" class="field-error" hidden></p></div>';
  }
  function renderPatient() {
    const patient = selectedPatient();
    const visits = patientHistory(patient.id);
    state.patientCardDay = localDate();
    return '<div class="patient-card-page"><div class="patient-card-nav">' + button('patients', 'Все пациенты', 'user', 'ghost') + '<span class="small muted">Только вымышленные данные</span></div>' +
      '<section class="card patient-card-header" aria-labelledby="patient-heading"><div class="patient-card-identity"><div class="patient-card-name"><h1 id="patient-heading">' + escape(patientName(patient)) + '</h1>' + button('edit-patient', 'Изменить', 'edit', 'secondary compact', 'aria-controls="patient-edit-panel" aria-expanded="' + state.patientEditOpen + '" aria-label="Изменить сведения пациента"') + '</div><div class="patient-card-meta"><span data-patient-age-summary>' + escape(patientIdentityDetails(patient)) + '</span><span>Код пациента: ' + escape(shortId(patient)) + '</span><div id="save-status" class="save-indicator" role="status"></div></div></div>' +
      '<div class="patient-card-actions"><div id="patient-next-return" class="patient-next-return">' + renderPatientReturn() + '</div>' + button('repeat', visits.length ? 'Повторный приём' : 'Первый приём', 'plus', 'primary') + '</div>' + renderPatientInformation(visits[0]) +
      '<div id="patient-edit-panel" class="patient-edit-panel"' + (state.patientEditOpen ? '' : ' hidden') + '>' + patientNameField(patient) + patientBirthDateField(patient) + '<div class="patient-edit-actions"><span class="small muted">Изменения сохраняются при вводе.</span>' + button('finish-patient-edit', 'Готово', 'check', 'secondary compact') + '</div></div></section>' +
      '<nav class="patient-tabs pager-tabs" role="tablist" aria-label="Разделы карточки пациента">' + patientModules.map(module => '<button type="button" id="patient-tab-' + module.id + '" class="tab pager-tab' + (state.patientTab === module.id ? ' active' : '') + '" role="tab" data-action="' + module.action + '" data-card-tab="' + module.id + '" aria-controls="patient-panel-' + module.id + '" aria-selected="' + (state.patientTab === module.id) + '" tabindex="' + (state.patientTab === module.id ? '0' : '-1') + '">' + module.title + '</button>').join('') + '</nav>' +
      '<div id="patient-module-panel" class="pager-viewport">' + patientModules.map(module => '<div id="patient-panel-' + module.id + '" role="tabpanel" aria-labelledby="patient-tab-' + module.id + '" data-card-panel="' + module.id + '" tabindex="0"' + (state.patientTab === module.id ? '' : ' hidden') + '>' + module.render(patient, visits) + '</div>').join('') + '</div></div>';
  }
  function renderPatientHistory(patient, visits) {
    return '<section id="patient-history" class="card"><div class="card-head"><h2 id="patient-history-heading" tabindex="-1">История приёмов</h2><span class="result-count">' + visits.length + ' записей</span></div><div class="list">' + (visits.length ? visits.map((entry) => '<div class="visit-row patient-visit-row" data-visit-id="' + escape(entry.id) + '"><div class="visit-text"><strong>' + escape(dateText(entry.visitDate)) + '</strong><span class="patient-history-age"> · Возраст на дату приёма: <span data-encounter-age="' + escape(entry.id) + '">' + escape(core.encounterAge(entry, patient).trim() || 'Не указан') + '</span></span><p>' + escape(entry.history.complaints.trim() || 'Жалобы не указаны') + '</p><p>Диагноз: ' + escape(entry.assessment.summary.trim() || 'не указан') + '</p><p>' + recordStatus(entry) + ' · Приём ' + escape(shortId(entry)) + '</p></div>' + button('open', 'Открыть приём', null, 'secondary compact', 'data-id="' + escape(entry.id) + '"') + '</div>').join('') : '<div class="empty"><p>Здесь появятся приёмы этого пациента.</p></div>') + '</div></section>';
  }
  function investigationNumber(value) {
    const absolute = Math.abs(value);
    return value.toLocaleString('ru-RU', {useGrouping: false, maximumSignificantDigits: 12, ...(absolute >= 1e8 || (absolute && absolute < 0.0001) ? {notation: 'scientific'} : {})});
  }
  function investigationUnit(item) {
    return item.kind === 'lab' ? item.unit : '';
  }
  function renderInvestigationChart(series) {
    const points = series.points;
    const scale = Math.max(...points.map(point => Math.abs(point.value))) || 1;
    const scaled = points.map(point => point.value / scale);
    const low = Math.min(...scaled), high = Math.max(...scaled);
    const firstDate = Date.parse(points[0].date), lastDate = Date.parse(points.at(-1).date);
    const coords = points.map((point, index) => ({...point,
      x: 85 + (Date.parse(point.date) - firstDate) / (lastDate - firstDate) * 460,
      y: high === low ? 110 : 180 - (scaled[index] - low) / (high - low) * 140
    }));
    const minValue = Math.min(...points.map(point => point.value)), maxValue = Math.max(...points.map(point => point.value));
    const axisNumber = value => value.toLocaleString('ru-RU', {useGrouping: false, maximumSignificantDigits: 4, ...(Math.abs(value) >= 1e4 || (value && Math.abs(value) < 0.0001) ? {notation: 'scientific'} : {})});
    return '<div class="investigation-chart"><svg viewBox="0 0 570 230" role="img" aria-labelledby="investigation-chart-title investigation-chart-description">' +
      '<title id="investigation-chart-title">' + escape(series.name) + ' — динамика</title><desc id="investigation-chart-description">По горизонтали — дата, по вертикали — результат' + (series.kind === 'study' ? '' : series.unit ? ' в ' + escape(series.unit) : ', единицы не указаны') + '. Все исходные значения приведены в таблице ниже.</desc>' +
      '<path class="investigation-axis" d="M85 30V180H545"/><path class="investigation-grid" d="M85 40H545"/>' +
      '<text x="78" y="' + (high === low ? '114' : '44') + '" text-anchor="end">' + escape(axisNumber(maxValue)) + '</text>' +
      (high === low ? '' : '<text x="78" y="184" text-anchor="end">' + escape(axisNumber(minValue)) + '</text>') +
      '<text x="85" y="208">' + escape(dateText(points[0].date)) + '</text><text x="545" y="208" text-anchor="end">' + escape(dateText(points.at(-1).date)) + '</text>' +
      '<polyline class="investigation-line" points="' + coords.map(point => point.x.toFixed(3) + ',' + point.y.toFixed(3)).join(' ') + '"/>' +
      coords.map(point => '<circle cx="' + point.x.toFixed(3) + '" cy="' + point.y.toFixed(3) + '" r="4" data-investigation-id="' + escape(point.id) + '"><title>' + escape(dateText(point.date) + ': ' + investigationNumber(point.value) + (investigationUnit(series) ? ' ' + investigationUnit(series) : '')) + '</title></circle>').join('') + '</svg></div>';
  }
  function renderInvestigationDynamics(series) {
    const reasons = {insufficient: 'Для графика нужны хотя бы два числовых результата на разные даты.', 'non-numeric': 'В серии есть текстовый результат, диапазон или знак сравнения. Динамика показана в таблице без числового графика.', 'duplicate-date': 'В серии есть несколько результатов на одну дату. Их порядок внутри дня неизвестен, поэтому график и разность не рассчитываются.'};
    const latest = series.results.at(-1), previous = series.results.at(-2);
    return '<div id="investigation-dynamics" class="investigation-dynamics" aria-live="polite"><h3>Динамика · ' + escape(series.name) + '</h3>' +
      (series.numeric ? '<p class="investigation-delta">' + (series.delta === null ? 'Разность вне числового диапазона.' : 'Изменение к предыдущему результату: <strong>' + (series.delta > 0 ? '+' : '') + escape(investigationNumber(series.delta)) + (investigationUnit(series) ? ' ' + escape(investigationUnit(series)) : '') + '</strong>') + ' <span>' + escape(dateText(previous.date)) + ' → ' + escape(dateText(latest.date)) + '</span></p>' + renderInvestigationChart(series) : '<p class="hint">' + reasons[series.reason] + '</p>') +
      (series.referenceChanged ? '<p class="investigation-reference-notice">Нормы из бланков различаются. Сверяйте результат с нормами в соответствующей строке.</p>' : '') +
      '<p class="hint">' + (series.kind === 'lab' ? 'Сопоставлены одинаковые названия и единицы. Единицы не пересчитываются; метод исследования и сопоставимость результатов проверьте по бланкам.' : 'Метод исследования и сопоставимость заключений проверьте по исходным бланкам.') + '</p></div>';
  }
  function investigationPatient() {
    return state.view === 'visit' && active() ? patientFor(active()) : state.view === 'patient' ? selectedPatient() : null;
  }
  function investigationContext(patient) {
    return {patientId: patient.id, encounterId: state.view === 'visit' ? active().id : '', view: state.view};
  }
  function investigationContextMatches(context) {
    return context && context.view === state.view && context.patientId === investigationPatient()?.id && (!context.encounterId || context.encounterId === active()?.id);
  }
  function commitInvestigationChange(before, after, context, addedIds = []) {
    let encounters = core.reconcileInvestigationReferences(before, after, state.encounters);
    const pending = context.encounterId && state.pendingNew?.entry.id === context.encounterId;
    if (context.encounterId) {
      const entry = pending ? state.pendingNew.entry : encounters.find(item => item.id === context.encounterId);
      if (!entry) throw new Error('Приём не найден. Закройте форму и откройте нужный приём.');
      const updated = core.setEncounterInvestigations(entry, after, [...new Set([...(entry.investigationIds || []), ...addedIds])]);
      encounters = pending ? encounters.concat(updated) : encounters.map(item => item.id === updated.id ? updated : item);
    }
    const patients = pending ? state.patients.concat(after) : state.patients.map(item => item.id === after.id ? after : item);
    if (!commitEncounters(encounters, patients)) return false;
    if (pending) state.pendingNew = null;
    return true;
  }
  function finishInvestigationChange(message) {
    render(); focusInvestigations(); toast(message + (state.view === 'visit' ? ' Обновите черновик, когда будете готовы.' : ''));
  }
  function renderReportRows(results) {
    return '<dl class="report-result-list">' + results.map(item => '<div class="report-result-row" data-investigation-id="' + escape(item.id) + '"><dt>' + escape(item.name) + '</dt><dd><strong>' + escape(item.result) + '</strong>' + (investigationUnit(item).trim() ? ' <span class="report-result-unit">' + escape(investigationUnit(item)) + '</span>' : '') +
      (item.reference.trim() ? '<span class="report-result-reference">Нормы из бланка: ' + escape(item.reference) + '</span>' : '') +
      (item.note.trim() ? '<span class="report-result-note">' + escape(item.note) + '</span>' : '') + '</dd></div>').join('') + '</dl>';
  }
  function renderInvestigationReport(report, visit = false) {
    return '<article class="investigation-report" data-report-id="' + escape(report.id) + '"><div class="investigation-report-head"><div><h3>' + escape(report.title) + '</h3><p>' + escape(dateText(report.date)) + ' · ' + report.results.length + ' показ.</p></div><div class="actions">' +
      button('investigation-report-edit', 'Изменить бланк', null, 'secondary compact', 'data-report-id="' + escape(report.id) + '"') +
      (visit ? button('investigation-detach', 'Убрать из приёма', null, 'ghost compact', 'data-report-id="' + escape(report.id) + '"') : button('investigation-report-delete', 'Удалить', null, 'ghost compact', 'data-report-id="' + escape(report.id) + '"')) +
      '</div></div><details class="report-results"><summary>Показатели и результаты</summary>' + renderReportRows(report.results) + '</details></article>';
  }
  function renderVisitInvestigations() {
    const entry = active(), patient = patientFor(entry), selected = new Set(entry.investigationIds || []);
    const results = (patient.investigations || []).filter(item => selected.has(item.id));
    const reports = core.getInvestigationReports(patient).map(report => ({...report, results: report.results.filter(item => selected.has(item.id))})).filter(report => report.results.length);
    const individual = results.filter(item => !item.reportId).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'ru'));
    return '<section id="visit-investigations" class="card form-card"><h2 id="visit-investigations-heading" tabindex="-1">Исследования в этом приёме</h2><p class="section-intro">Добавьте имеющиеся результаты первичного или повторного приёма. Они сохранятся в карточке пациента и войдут в новый черновик этой записи. Результаты прежних приёмов выбираются отдельно.</p><div class="actions investigation-add-actions">' +
      button('investigation-add', 'Добавить результат', 'plus', 'primary') + button('investigation-report-add', 'Бланки анализов', 'flask', 'secondary') +
      button('investigation-attach', 'Выбрать из карточки', 'document', 'secondary', patient.investigations?.length ? '' : 'disabled') + '</div><div id="visit-investigation-list">' +
      reports.map(report => renderInvestigationReport(report, true)).join('') +
      individual.map(item => '<article class="investigation-report investigation-individual" data-investigation-id="' + escape(item.id) + '"><div class="investigation-report-head"><div><h3>' + escape(item.name) + '</h3><p>' + escape(dateText(item.date)) + '</p></div><div class="actions">' +
        button('investigation-edit', 'Изменить', null, 'secondary compact', 'data-investigation-id="' + escape(item.id) + '"') + button('investigation-detach', 'Убрать из приёма', null, 'ghost compact', 'data-investigation-id="' + escape(item.id) + '"') + '</div></div>' + renderReportRows([item]) + '</article>').join('') +
      (!results.length ? '<p class="investigation-empty">Для этого приёма исследования пока не выбраны.</p>' : '<p class="hint">Изменения связанного результата сохранятся в карточке и снимут отметку проверки у связанных приёмов. Ручной текст записи не переписывается.</p>') + '</div></section>';
  }
  function renderInvestigations(patient) {
    const series = core.getInvestigationSeries(patient);
    if (state.investigationPatientId !== patient.id || !series.some(item => item.key === state.investigationSeriesKey)) {
      const latest = [...(patient.investigations || [])].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))[0];
      state.investigationPatientId = patient.id;
      state.investigationSeriesKey = series.find(item => item.results.some(result => result.id === latest?.id))?.key || '';
    }
    const chosen = series.find(item => item.key === state.investigationSeriesKey);
    return '<section id="patient-investigations" class="card patient-investigations" aria-labelledby="investigations-heading"><div class="card-head"><h2 id="investigations-heading" tabindex="-1">Анализы и исследования</h2>' +
      '<div class="actions">' + button('investigation-add', 'Добавить результат', 'plus', 'primary compact', (patient.investigations?.length || 0) >= core.MAX_INVESTIGATIONS ? 'disabled' : '') +
      button('investigation-report-add', 'Бланки анализов', 'flask', 'secondary compact', (patient.investigations?.length || 0) >= core.MAX_INVESTIGATIONS ? 'disabled' : '') + '</div>' +
      '</div><div class="investigations-content"><p class="hint">Выберите готовый набор показателей или введите другое исследование вручную. Нормы переписывайте из конкретного бланка.</p>' +
      '<div id="patient-investigation-reports">' + core.getInvestigationReports(patient).map(report => renderInvestigationReport(report)).join('') + '</div>' +
      (chosen ? '<div class="field investigation-series-field"><label for="investigation-series">Показатель или исследование</label><select id="investigation-series">' + series.map(item => '<option value="' + escape(item.key) + '"' + (item.key === chosen.key ? ' selected' : '') + '>' + escape(item.name + (item.kind === 'lab' ? ' · ' + (item.unit || 'единицы не указаны') : '') + ' · ' + (item.kind === 'lab' ? 'анализ' : 'исследование') + ' · ' + item.results.length + ' рез.') + '</option>').join('') + '</select></div>' + renderInvestigationDynamics(chosen) +
      '<table class="investigation-table"><caption>Результаты по датам · сначала последние</caption><thead><tr><th scope="col">Дата / название</th><th scope="col">Результат</th><th scope="col">Нормы из бланка</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead><tbody>' +
      [...chosen.results].reverse().map(item => '<tr class="investigation-row" data-investigation-id="' + escape(item.id) + '"><th scope="row"><time datetime="' + escape(item.date) + '">' + escape(dateText(item.date)) + '</time><span class="investigation-name">' + escape(item.name) + '</span></th><td data-label="Результат"><div class="investigation-result">' + escape(item.result) + '</div>' + (item.kind === 'lab' ? '<span class="investigation-unit">' + escape(item.unit.trim() ? item.unit : 'Единицы не указаны') + '</span>' : '') + (item.note.trim() ? '<p class="investigation-note"><strong>Примечание:</strong> ' + escape(item.note) + '</p>' : '') + '</td><td data-label="Нормы из бланка"><div class="investigation-reference">' + escape(item.reference.trim() ? item.reference : 'Не указаны') + '</div></td><td class="investigation-actions"><div class="actions">' +
        (item.reportId ? button('investigation-report-edit', 'Изменить бланк', null, 'secondary compact', 'data-report-id="' + escape(item.reportId) + '"') : button('investigation-edit', 'Изменить', null, 'secondary compact', 'data-investigation-id="' + escape(item.id) + '" aria-label="Изменить результат: ' + escape(item.name) + ' от ' + escape(dateText(item.date)) + '"') +
        button('investigation-delete', 'Удалить', null, 'ghost compact', 'data-investigation-id="' + escape(item.id) + '" aria-label="Удалить результат: ' + escape(item.name) + ' от ' + escape(dateText(item.date)) + '"')) + '</div></td></tr>').join('') + '</tbody></table>' : '<p class="investigation-empty">Результатов пока нет. Добавьте анализ или текстовое заключение исследования.</p>') + '</div></section>';
  }
  function focusInvestigations() {
    document.getElementById(state.view === 'visit' ? 'visit-investigations-heading' : 'investigations-heading')?.focus({preventScroll: true});
    document.getElementById(state.view === 'visit' ? 'visit-investigations' : 'patient-investigations')?.scrollIntoView({block: 'start'});
  }
  function investigationError(message) {
    const target = document.getElementById('investigation-error');
    target.textContent = message; target.hidden = !message;
  }
  function openInvestigationForm(id = '') {
    const patient = investigationPatient();
    if (!patient || !requireFreshState()) return;
    const item = id ? patient.investigations?.find(row => row.id === id) : null;
    if (id && !item) { toast('Результат не найден. Откройте карточку заново.', true); return; }
    if (item?.reportId) { openInvestigationReport(item.reportId); return; }
    if (!id && (patient.investigations?.length || 0) >= core.MAX_INVESTIGATIONS) { toast('В карточке можно сохранить до 500 результатов.', true); return; }
    investigationForm = {...investigationContext(patient), id, kind: item?.kind || '', saving: false};
    document.getElementById('investigation-title').textContent = id ? 'Изменить результат' : 'Добавить результат';
    document.getElementById('investigation-patient').textContent = patientName(patient);
    document.getElementById('investigation-description').textContent = id
      ? 'Перепишите сведения из бланка. Дата, название и результат обязательны. Нормы и единицы указывайте для этого результата.'
      : 'Выберите ОАК, ОАМ, БАК или другое исследование. В готовом бланке уже указаны показатели и единицы; для своего показателя выберите «Другое».';
    const panels = window.MedAssistInvestigationCatalog?.panels || [];
    document.getElementById('investigation-kind').innerHTML = (id ? '' : '<option value="">Выберите исследование</option>' +
      ['lab', 'study'].map(kind => '<optgroup label="' + (kind === 'lab' ? 'Лабораторные бланки' : 'Инструментальные исследования') + '">' +
        panels.filter(panel => panel.kind === kind).map(panel => '<option value="report:' + escape(panel.id) + '">' + escape(investigationPanelLabel(panel)) + '</option>').join('') + '</optgroup>').join('')) +
      '<optgroup label="Ручной ввод"><option value="lab">Другое лабораторное исследование</option><option value="study">Другое инструментальное исследование</option></optgroup>';
    for (const key of investigationFields) {
      const control = document.getElementById('investigation-' + key);
      control.value = item?.[key] || (key === 'date' ? localDate() : '');
      control.removeAttribute('aria-invalid');
    }
    updateInvestigationUnitField();
    document.getElementById('investigation-manual-fields').hidden = !id;
    document.getElementById('investigation-save').hidden = !id;
    document.getElementById('investigation-save').disabled = false;
    investigationError('');
    document.getElementById('investigation-dialog').showModal();
    document.getElementById(id ? 'investigation-name' : 'investigation-kind').focus();
  }
  function updateInvestigationUnitField() {
    const study = investigationForm.kind === 'study';
    document.getElementById('investigation-unit').closest('.field').hidden = study;
    document.getElementById('investigation-name-hint').textContent = study
      ? 'Для истории используйте одинаковое название исследования.'
      : 'Для динамики используйте одинаковое название и единицы.';
    document.getElementById('investigation-description').textContent = study
      ? 'Перепишите сведения из бланка. Дата, название и заключение обязательны.'
      : investigationForm.kind === 'lab'
        ? 'Перепишите сведения из бланка. Дата, название и результат обязательны. Нормы и единицы указывайте для этого результата.'
        : 'Выберите ОАК, ОАМ, БАК или другое исследование. Для своего показателя или заключения выберите «Другое».';
  }
  function changeInvestigationKind() {
    if (!investigationForm || investigationForm.saving) return;
    const select = document.getElementById('investigation-kind'), kind = select.value;
    if (kind.startsWith('report:')) {
      select.value = investigationForm.kind;
      if (!investigationForm.id) openInvestigationReport('', {panelId: kind.slice(7), date: document.getElementById('investigation-date').value, fromResult: true});
      return;
    }
    investigationForm.kind = kind;
    updateInvestigationUnitField();
    document.getElementById('investigation-manual-fields').hidden = !kind;
    document.getElementById('investigation-save').hidden = !kind;
    investigationError('');
  }
  function saveInvestigation() {
    if (!investigationForm || investigationForm.saving) return;
    if (!investigationForm.kind) { investigationError('Выберите исследование.'); document.getElementById('investigation-kind').focus(); return; }
    if (!requireFreshState()) { investigationError('Данные изменены в другом окне. Закройте форму и загрузите сохранённую версию.'); return; }
    const patient = investigationPatient();
    if (!investigationContextMatches(investigationForm)) { investigationError('Эта карточка или приём уже не открыты. Закройте форму и откройте нужного пациента.'); return; }
    const values = Object.fromEntries(investigationFields.map(key => [key, document.getElementById('investigation-' + key).value]));
    if (values.kind === 'study') {
      const previous = patient.investigations?.find(item => item.id === investigationForm.id);
      values.unit = previous?.kind === 'study' ? previous.unit : '';
    }
    const missing = [['name', 'Укажите название анализа или исследования.'], ['date', 'Укажите дату результата из бланка.'], ['result', 'Введите результат или заключение.']].find(([key]) => !values[key].trim());
    if (missing) {
      investigationError(missing[1]);
      document.getElementById('investigation-' + missing[0]).setAttribute('aria-invalid', 'true');
      document.getElementById('investigation-' + missing[0]).focus(); return;
    }
    investigationForm.saving = true;
    document.getElementById('investigation-save').disabled = true;
    try {
      const updated = core.upsertInvestigation(patient, values, investigationForm.id ? {id: investigationForm.id} : {});
      const savedId = investigationForm.id || updated.investigations.find(item => !(patient.investigations || []).some(old => old.id === item.id)).id;
      if (!commitInvestigationChange(patient, updated, investigationForm, [savedId])) {
        investigationError((state.error || 'Не удалось сохранить результат.') + ' Введённые значения остаются в форме.'); return;
      }
      state.investigationPatientId = patient.id;
      state.investigationSeriesKey = core.getInvestigationSeries(updated).find(item => item.results.some(result => result.id === savedId)).key;
      document.getElementById('investigation-dialog').close(); investigationForm = null;
      finishInvestigationChange('Результат сохранён в карточке пациента.');
    } catch (error) { investigationError(error.message); }
    finally {
      if (investigationForm) investigationForm.saving = false;
      document.getElementById('investigation-save').disabled = false;
    }
  }
  async function deleteInvestigation(id) {
    if (investigationDeletePending || !requireFreshState()) return;
    const patient = investigationPatient();
    const item = patient?.investigations?.find(row => row.id === id);
    if (!item || state.view !== 'patient' || item.reportId) return;
    const context = investigationContext(patient);
    investigationDeletePending = true;
    try {
      if (!await confirmAction('Удалить результат?', 'Результат «' + item.name + '» от ' + dateText(item.date) + ' будет удалён из карточки и связей с приёмами. Связанные проверенные записи вернутся в черновики, сохранённый текст останется для вашей проверки.', 'Удалить результат') || !requireFreshState()) return;
      if (!investigationContextMatches(context)) { toast('Откройте нужную карточку заново перед удалением.', true); return; }
      const updated = core.removeInvestigation(selectedPatient(), id);
      if (!commitInvestigationChange(patient, updated, context)) return;
      finishInvestigationChange('Результат удалён. Проверьте сохранённые тексты связанных приёмов.');
    } catch (error) { toast(error.message, true); }
    finally { investigationDeletePending = false; }
  }
  function investigationReportError(message) {
    const target = document.getElementById('investigation-report-error');
    target.textContent = message; target.hidden = !message;
    if (message && document.getElementById('investigation-report-dialog').open) target.scrollIntoView({block: 'nearest'});
  }
  function reportPanel(id) {
    return window.MedAssistInvestigationCatalog?.panels.find(panel => panel.id === id);
  }
  function investigationPanelLabel(panel) {
    const shortName = {cbc: 'ОАК', urinalysis: 'ОАМ', biochemistry: 'БАК'}[panel.id];
    return panel.title + (shortName ? ' (' + shortName + ')' : '');
  }
  function readReportValues() {
    const form = investigationReportForm;
    return {
      panelId: form.panelId, kind: form.kind,
      title: document.getElementById('investigation-report-title').value,
      date: document.getElementById('investigation-report-date').value,
      rows: Array.from(document.querySelectorAll('#investigation-report-rows .report-field'), row => ({
        fieldId: row.dataset.fieldId,
        ...Object.fromEntries(['name', 'result', 'unit', 'reference', 'note'].map(key => [key, row.querySelector('[data-report-value="' + key + '"]').value]))
      }))
    };
  }
  function renderReportFormValues(values) {
    const study = values.kind === 'study';
    document.getElementById('investigation-report-description').textContent = study
      ? 'Перепишите заключение из бланка. Строки без результата не сохраняются и не попадут в запись.'
      : 'Перепишите только выполненные показатели. Строки без результата не сохраняются и не попадут в запись. Единицы можно исправить по бланку; нормы вводятся вручную.';
    document.getElementById('investigation-report-title').value = values.title;
    document.getElementById('investigation-report-date').value = values.date;
    document.getElementById('investigation-report-rows').innerHTML = values.rows.map((row, index) => {
      const prefix = 'report-field-' + index;
      return '<div class="report-field" data-field-id="' + escape(row.fieldId) + '"><div class="report-field-main' + (study ? ' report-field-study' : '') + '"><div class="field report-field-name"><label for="' + prefix + '-result">' + escape(row.name) + '</label><input type="hidden" data-report-value="name" value="' + escape(row.name) + '"></div>' +
        '<div class="field report-field-value"><textarea id="' + prefix + '-result" data-report-value="result" rows="1" maxlength="2000" placeholder="Результат">' + escape(row.result) + '</textarea></div>' +
        (study ? '<input data-report-value="unit" type="hidden" value="' + escape(row.unit) + '">' : '<div class="field report-field-unit"><label for="' + prefix + '-unit">Единицы</label><input id="' + prefix + '-unit" data-report-value="unit" type="text" maxlength="80" value="' + escape(row.unit) + '" autocomplete="off"></div>') + '</div>' +
        '<details class="report-field-extra"' + (row.reference.trim() || row.note.trim() ? ' open' : '') + '><summary>Нормы из бланка и примечание</summary><div class="field-grid"><div class="field"><label for="' + prefix + '-reference">Нормы из бланка</label><textarea id="' + prefix + '-reference" data-report-value="reference" maxlength="500" rows="2">' + escape(row.reference) + '</textarea></div><div class="field"><label for="' + prefix + '-note">Примечание</label><textarea id="' + prefix + '-note" data-report-value="note" maxlength="1000" rows="2">' + escape(row.note) + '</textarea></div></div></details></div>';
    }).join('');
    const panel = reportPanel(values.panelId), catalog = window.MedAssistInvestigationCatalog;
    const sources = panel ? (catalog.sources || []).filter(source => (panel.sourceIds || []).includes(source.id)) : [];
    document.getElementById('investigation-report-sources').innerHTML = '<details class="report-sources"><summary>О наборе показателей и источниках</summary><p>Это набор для ручного ввода. ' + (study ? 'Содержание сверьте с выданным бланком.' : 'Состав и единицы сверьте с выданным бланком.') + ' Пустые показатели пропускаются; нормы и нормальные ответы не подставляются.</p>' +
      (sources.length ? '<ul>' + sources.map(source => '<li>' + (/^https:\/\//.test(source.url) ? '<a href="' + escape(source.url) + '" target="_blank" rel="noopener noreferrer">' + escape(source.title) + '</a>' : escape(source.title)) + '</li>').join('') + '</ul>' : '<p>Каталог источника этого сохранённого бланка недоступен. Его прежние сведения сохранены.</p>') + '</details>';
  }
  function freshReportValues(panel, date) {
    return {panelId: panel.id, kind: panel.kind, title: panel.title, date,
      rows: panel.fields.map(field => ({fieldId: field.id, name: field.name, unit: panel.kind === 'study' ? '' : field.unit || '', result: '', reference: '', note: ''}))};
  }
  function openInvestigationReport(id = '', {panelId: selectedPanelId, date = localDate(), fromResult = false} = {}) {
    const patient = investigationPatient();
    if (!patient || !requireFreshState()) return;
    const report = id ? core.getInvestigationReports(patient).find(item => item.id === id) : null;
    if (id && !report) { toast('Бланк не найден. Откройте карточку заново.', true); return; }
    const panels = window.MedAssistInvestigationCatalog?.panels || [];
    if (!id && !panels.length) { toast('Каталог бланков не загрузился. Можно добавить другое исследование вручную.', true); return; }
    if (!id && (patient.investigations?.length || 0) >= core.MAX_INVESTIGATIONS) { toast('В карточке можно сохранить до 500 результатов.', true); return; }
    const panelId = report?.panelId || selectedPanelId || panels[0].id, panel = reportPanel(panelId);
    if (!report && !panel) { toast('Выбранный бланк не найден. Откройте список исследований заново.', true); return; }
    const values = report ? {panelId, kind: report.kind, title: report.title, date: report.date,
      rows: [...report.results.map(item => ({fieldId: item.fieldId, name: item.name, unit: item.unit, result: item.result, reference: item.reference, note: item.note})),
        ...(panel?.fields || []).filter(field => !report.results.some(item => item.fieldId === field.id)).map(field => ({fieldId: field.id, name: field.name, unit: field.unit || '', result: '', reference: '', note: ''}))]} : freshReportValues(panel, date);
    investigationReportForm = {...investigationContext(patient), id, panelId, kind: values.kind, drafts: {}, saving: false, fromResult};
    document.getElementById('investigation-report-heading').textContent = id ? 'Изменить бланк' : 'Добавить бланк';
    document.getElementById('investigation-report-patient').textContent = patientName(patient);
    const select = document.getElementById('investigation-report-template');
    select.innerHTML = panels.map(item => '<option value="' + escape(item.id) + '">' + escape(investigationPanelLabel(item)) + '</option>').join('') + (!panel ? '<option value="' + escape(panelId) + '">Сохранённый бланк · ' + escape(report.title) + '</option>' : '');
    select.value = panelId; select.disabled = Boolean(id);
    document.getElementById('investigation-report-save').disabled = false;
    document.getElementById('investigation-report-cancel').textContent = fromResult ? 'Назад' : 'Отмена';
    renderReportFormValues(values); investigationReportError('');
    document.getElementById('investigation-report-dialog').showModal();
    document.getElementById('investigation-report-date').focus();
  }
  function changeInvestigationReportTemplate() {
    if (!investigationReportForm || investigationReportForm.id) return;
    const previous = readReportValues();
    investigationReportForm.drafts[previous.panelId] = previous;
    const panel = reportPanel(document.getElementById('investigation-report-template').value);
    if (!panel) { investigationReportError('Набор показателей не найден. Закройте форму и откройте её заново.'); return; }
    const values = investigationReportForm.drafts[panel.id] || freshReportValues(panel, previous.date);
    investigationReportForm.panelId = panel.id; investigationReportForm.kind = values.kind;
    renderReportFormValues(values); investigationReportError('');
  }
  function saveInvestigationReport() {
    if (!investigationReportForm || investigationReportForm.saving) return;
    if (!requireFreshState()) { investigationReportError('Данные изменены в другом окне. Закройте форму и загрузите сохранённую версию.'); return; }
    if (!investigationContextMatches(investigationReportForm)) { investigationReportError('Карточка или приём уже не открыты. Закройте форму и откройте нужного пациента.'); return; }
    const values = readReportValues();
    values.rows = values.rows.filter(row => row.result.trim());
    if (!values.title.trim() || !values.date || !values.rows.length) {
      investigationReportError('Укажите дату, название бланка и хотя бы один результат. Пустые показатели не сохраняются.'); return;
    }
    investigationReportForm.saving = true; document.getElementById('investigation-report-save').disabled = true;
    try {
      const patient = investigationPatient();
      const updated = core.upsertInvestigationReport(patient, values, investigationReportForm.id ? {id: investigationReportForm.id} : {});
      const reportId = investigationReportForm.id || updated.investigations.find(item => !(patient.investigations || []).some(old => old.id === item.id)).reportId;
      const savedRows = updated.investigations.filter(item => item.reportId === reportId);
      if (!commitInvestigationChange(patient, updated, investigationReportForm, investigationReportForm.id ? [] : savedRows.map(item => item.id))) {
        investigationReportError((state.error || 'Не удалось сохранить бланк.') + ' Введённые значения остаются в форме.'); return;
      }
      state.investigationPatientId = patient.id;
      state.investigationSeriesKey = core.getInvestigationSeries(updated).find(series => series.results.some(item => item.id === savedRows[0].id)).key;
      if (investigationReportForm.fromResult) { document.getElementById('investigation-dialog').close(); investigationForm = null; }
      document.getElementById('investigation-report-dialog').close(); investigationReportForm = null;
      finishInvestigationChange('Бланк сохранён в карточке пациента. Пустые показатели пропущены.');
    } catch (error) { investigationReportError(error.message); }
    finally {
      if (investigationReportForm) investigationReportForm.saving = false;
      document.getElementById('investigation-report-save').disabled = false;
    }
  }
  async function deleteInvestigationReport(id) {
    if (investigationDeletePending || !requireFreshState()) return;
    const patient = investigationPatient(), report = patient && core.getInvestigationReports(patient).find(item => item.id === id);
    if (!report || state.view !== 'patient') return;
    const context = investigationContext(patient);
    investigationDeletePending = true;
    try {
      if (!await confirmAction('Удалить бланк?', 'Бланк «' + report.title + '» от ' + dateText(report.date) + ' и все его результаты будут удалены из карточки и связей с приёмами. Связанные проверенные записи вернутся в черновики; сохранённый текст останется для вашей проверки.', 'Удалить бланк') || !requireFreshState()) return;
      if (!investigationContextMatches(context)) { toast('Откройте нужную карточку заново перед удалением.', true); return; }
      if (!commitInvestigationChange(patient, core.removeInvestigationReport(patient, id), context)) return;
      finishInvestigationChange('Бланк удалён. Проверьте сохранённые тексты связанных приёмов.');
    } catch (error) { toast(error.message, true); }
    finally { investigationDeletePending = false; }
  }
  function investigationAttachError(message) {
    const target = document.getElementById('investigation-attach-error');
    target.textContent = message; target.hidden = !message;
    if (message && document.getElementById('investigation-attach-dialog').open) target.scrollIntoView({block: 'nearest'});
  }
  function updateReportAttachCheckboxes() {
    document.querySelectorAll('#investigation-attach-options .investigation-attach-group').forEach(group => {
      const controls = Array.from(group.querySelectorAll('[name="attach-investigation"]')), selected = controls.filter(control => control.checked).length;
      const toggle = group.querySelector('[name="attach-report"]');
      toggle.checked = selected === controls.length; toggle.indeterminate = selected > 0 && selected < controls.length;
    });
  }
  function openInvestigationAttach() {
    const entry = active(), patient = investigationPatient();
    if (!entry || state.view !== 'visit' || !patient || !requireFreshState()) return;
    investigationAttachForm = {...investigationContext(patient), saving: false};
    const ids = new Set(entry.investigationIds || []);
    const checkbox = item => '<label class="investigation-attach-row"><input type="checkbox" name="attach-investigation" value="' + escape(item.id) + '"' + (ids.has(item.id) ? ' checked' : '') + '><span><strong>' + escape(item.name) + '</strong><span>' + escape(dateText(item.date)) + ' · ' + escape(item.result) + (investigationUnit(item).trim() ? ' ' + escape(investigationUnit(item)) : '') + '</span></span></label>';
    document.getElementById('investigation-attach-options').innerHTML = core.getInvestigationReports(patient).map(report => '<div class="investigation-attach-group" data-report-id="' + escape(report.id) + '"><label class="investigation-attach-row investigation-attach-group-label"><input type="checkbox" name="attach-report" value="' + escape(report.id) + '"><span><strong>' + escape(report.title) + '</strong><span>' + escape(dateText(report.date)) + ' · выбрать весь бланк</span></span></label><details><summary>Выбрать отдельные показатели (' + report.results.length + ')</summary>' + report.results.map(checkbox).join('') + '</details></div>').join('') +
      (patient.investigations || []).filter(item => !item.reportId).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'ru')).map(checkbox).join('');
    updateReportAttachCheckboxes(); investigationAttachError('');
    document.getElementById('investigation-attach-save').disabled = false;
    document.getElementById('investigation-attach-dialog').showModal();
  }
  function saveInvestigationAttach() {
    if (!investigationAttachForm || investigationAttachForm.saving) return;
    if (!requireFreshState()) { investigationAttachError('Данные изменены в другом окне. Закройте выбор и загрузите сохранённую версию.'); return; }
    if (!investigationContextMatches(investigationAttachForm)) { investigationAttachError('Этот приём уже не открыт. Закройте выбор и откройте нужный приём.'); return; }
    investigationAttachForm.saving = true; document.getElementById('investigation-attach-save').disabled = true;
    try {
      const ids = Array.from(document.querySelectorAll('#investigation-attach-options [name="attach-investigation"]:checked'), input => input.value);
      const updated = core.setEncounterInvestigations(active(), investigationPatient(), ids);
      if (!commitVisitChange(updated)) { investigationAttachError((state.error || 'Не удалось сохранить выбор.') + ' Выбранные результаты остаются отмечены.'); return; }
      document.getElementById('investigation-attach-dialog').close(); investigationAttachForm = null;
      finishInvestigationChange('Выбор исследований сохранён для этого приёма.');
    } catch (error) { investigationAttachError(error.message); }
    finally {
      if (investigationAttachForm) investigationAttachForm.saving = false;
      document.getElementById('investigation-attach-save').disabled = false;
    }
  }
  async function detachInvestigation(target) {
    if (investigationDeletePending || state.view !== 'visit' || !requireFreshState()) return;
    const entry = active(), patient = investigationPatient(), context = investigationContext(patient);
    const ids = new Set((patient.investigations || []).filter(item => target.dataset.reportId ? item.reportId === target.dataset.reportId : item.id === target.dataset.investigationId).map(item => item.id));
    if (!(entry.investigationIds || []).some(id => ids.has(id))) return;
    investigationDeletePending = true;
    try {
      if (!await confirmAction('Убрать исследования из приёма?', 'Результаты останутся в карточке пациента. Они не войдут в новый черновик этого приёма. Сохранённый текст останется для вашей проверки.', 'Убрать из приёма') || !requireFreshState()) return;
      if (!investigationContextMatches(context)) { toast('Откройте нужный приём заново.', true); return; }
      const updated = core.setEncounterInvestigations(active(), patient, (active().investigationIds || []).filter(id => !ids.has(id)));
      if (!commitVisitChange(updated)) return;
      finishInvestigationChange('Связь с приёмом убрана. Результаты остаются в карточке.');
    } catch (error) { toast(error.message, true); }
    finally { investigationDeletePending = false; }
  }
  function renderSickLeaveJournal(patient) {
    const journal = core.getSickLeaveJournal(patient, state.encounters);
    const numberText = number => number.trim() ? 'ЛН № ' + escape(number) : 'ЛН · номер не указан';
    const periodsText = periods => periods.map(period => escape(dateText(period.from)) + ' — ' + escape(dateText(period.to))).join('; ');
    const leaves = [...journal.leaves].sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || b.events[0].from.localeCompare(a.events[0].from));
    return '<section id="sick-leave-journal" class="card sick-leave-journal" aria-labelledby="sick-leave-heading"><div class="card-head"><h2 id="sick-leave-heading" tabindex="-1">Журнал больничных</h2>' + button('sick-issue', 'Выдать больничный', 'plus', 'primary compact') + '</div>' +
      '<div class="sick-leave-summary"><div><span>Всего календарных дней</span><output id="sick-leave-total">' + journal.totalDays + '</output></div><p>За все внесённые периоды пациента, включая отметки из приёмов. Обе даты включены; пересекающийся день считается один раз.</p>' + (journal.incompleteCount ? '<p class="sick-leave-warning">Не включено в подсчёт: ' + journal.incompleteCount + ' отметок с неполными датами. Уточните их в исходных приёмах.</p>' : '') + '</div>' +
      '<div class="sick-leave-list">' + leaves.map(leave => {
        const source = state.encounters.find(entry => entry.id === leave.sourceEncounterId);
        const changedSource = source && (source.assessment.sickLeaveIssued !== 'yes' || source.assessment.sickLeaveNumber !== leave.number || source.assessment.sickLeaveFrom !== leave.events[0].from || source.assessment.sickLeaveTo !== leave.events[0].to);
        return '<article class="sick-leave-entry" data-leave-id="' + escape(leave.id) + '"><div class="sick-leave-entry-head"><h3>' + numberText(leave.number) + '</h3><span class="record-status' + (leave.status === 'closed' ? ' reviewed' : '') + '">' + (leave.status === 'closed' ? 'Закрыт · ' + escape(dateText(leave.closedOn)) : 'Открыт') + '</span></div><p class="sick-leave-periods">Учтённые периоды: ' + periodsText(leave.periods) + '</p><p class="sick-leave-days">Календарных дней: <strong>' + leave.days + '</strong></p>' +
          (leave.status === 'open' && leave.periods.at(-1).to < localDate() ? '<p class="sick-leave-warning">Указанный период прошёл. Закрытие не отмечено.</p>' : '') +
          (source ? '<p class="hint">Перенесён из приёма от ' + escape(dateText(source.visitDate)) + '. Журнал ведётся отдельно; исходная запись сохраняется.' + (changedSource ? ' Сведения в исходном приёме отличаются от журнала.' : '') + '</p>' : '') +
          '<details class="sick-leave-events"><summary>История действий · ' + leave.events.length + '</summary><ol>' + leave.events.map(event => '<li><strong>' + {issue: 'Выдача', extend: 'Продление', close: 'Закрытие'}[event.type] + '</strong> · ' + (event.type === 'close' ? escape(dateText(event.to)) : escape(dateText(event.from)) + ' — ' + escape(dateText(event.to))) + '<span>Внесено ' + escape(new Date(event.recordedAt).toLocaleString('ru-RU')) + '</span></li>').join('') + '</ol></details>' +
          '<div class="sick-leave-actions">' + (leave.status === 'open' ? button('sick-extend', 'Продлить', null, 'secondary compact', 'data-leave-id="' + escape(leave.id) + '"') + button('sick-close', 'Закрыть', 'check', 'secondary compact', 'data-leave-id="' + escape(leave.id) + '"') : '') + (leave.events.some(event => event.encounterId) ? '' : button('sick-number', 'Изменить номер', null, 'ghost compact', 'data-leave-id="' + escape(leave.id) + '"')) + (leave.events.at(-1).encounterId ? button('open', 'Открыть связанный приём', null, 'ghost compact', 'data-id="' + escape(leave.events.at(-1).encounterId) + '" data-tab="draft"') : button('sick-undo', 'Отменить последнее действие', null, 'ghost compact', 'data-leave-id="' + escape(leave.id) + '"')) + '</div>' +
          (leave.events.some(event => event.encounterId) ? '<p class="hint">Действия связаны с приёмами. Для исправления откройте связанный приём и отмените его действие, если оно последнее в журнале.</p>' : '') + '</article>';
      }).join('') + (!leaves.length ? '<p class="muted">В журнале пока нет больничных. Внесите выдачу или перенесите отметку из приёма ниже.</p>' : '') + '</div>' +
      (journal.legacy.length ? '<div class="sick-leave-legacy-list"><h3>Отметки из приёмов</h3><p class="hint">Даты уже входят в общий счётчик. Статус закрытия неизвестен. Для продления или закрытия сначала перенесите отметку в журнал.</p>' + journal.legacy.map(leave => '<div class="sick-leave-legacy" data-encounter-id="' + escape(leave.encounterId) + '"><div><strong>' + numberText(leave.number) + '</strong><p>' + (leave.from ? escape(dateText(leave.from)) : 'Начало не указано') + ' — ' + (leave.to ? escape(dateText(leave.to)) : 'Окончание не указано') + (leave.days !== null ? ' · ' + leave.days + ' календ. дн.' : ' · период требует уточнения') + '</p></div><div class="sick-leave-actions">' + (leave.days !== null ? button('sick-adopt', 'Перенести в журнал', null, 'secondary compact', 'data-id="' + escape(leave.encounterId) + '"') : '') + button('open', 'Открыть приём', null, 'ghost compact', 'data-id="' + escape(leave.encounterId) + '" data-tab="draft"') + '</div></div>').join('') + '</div>' : '') +
      '<p class="sick-leave-footnote">Это учёт введённых сведений. Он не оформляет документ и не рассчитывает оплату больничного. Сохранённые тексты приёмов не меняются.</p></section>';
  }
  function sickLeaveError(message) {
    const target = document.getElementById('sick-leave-error');
    target.textContent = message; target.hidden = !message;
  }
  function focusSickLeaveJournal() {
    document.getElementById('sick-leave-heading').focus({preventScroll: true});
    document.getElementById('sick-leave-journal').scrollIntoView({block: 'start'});
  }
  function openSickLeaveForm(mode, target) {
    if (!requireFreshState() || !canReplaceActive() || state.view !== 'patient') return;
    if (!state.saved) { persist(); if (!state.saved) return; }
    const patient = selectedPatient();
    const journal = core.getSickLeaveJournal(patient, state.encounters);
    const leave = journal.leaves.find(item => item.id === target.dataset.leaveId);
    const source = journal.legacy.find(item => item.encounterId === target.dataset.id);
    if (['extend', 'close', 'number'].includes(mode) && !leave) return;
    if (mode === 'adopt' && (!source || source.days === null)) return;
    if (['extend', 'close'].includes(mode) && leave.status !== 'open') return;
    if (mode === 'number' && leave.events.some(event => event.encounterId)) { toast('Номер связан с приёмом. Откройте связанный приём и отмените его последнее действие перед исправлением.', true); return; }
    sickLeaveForm = {mode, patientId: patient.id, leaveId: leave?.id || '', sourceEncounterId: source?.encounterId || ''};
    document.getElementById('sick-leave-select-field').hidden = true;
    document.getElementById('sick-leave-save').disabled = false;
    document.getElementById('sick-leave-title').textContent = {issue: 'Выдача больничного', extend: 'Продление больничного', close: 'Закрытие больничного', adopt: 'Перенести больничный в журнал', number: 'Номер больничного'}[mode];
    document.getElementById('sick-leave-patient').textContent = patientName(patient);
    document.getElementById('sick-leave-description').textContent = {
      issue: 'Внесите номер и период. Данные попадут в журнал после нажатия «Сохранить».',
      extend: 'Укажите период продления. Последняя дата должна быть позже предыдущей; пересекающиеся дни повторно не считаются.',
      close: 'Укажите последний день в пределах внесённых периодов. Дни после этой даты исключаются из подсчёта. Для более поздней даты сначала внесите продление.',
      adopt: 'Подтвердите перенос отметки из приёма. Её даты уже включены в общий счётчик и не будут добавлены второй раз. Исходный приём останется без изменений.',
      number: 'Номер изменится только в журнале. Сведения и тексты прежних приёмов сохранятся.'
    }[mode];
    const number = document.getElementById('sick-leave-number');
    number.value = source?.number || leave?.number || ''; number.readOnly = !['issue', 'number'].includes(mode);
    const from = document.getElementById('sick-leave-from'), to = document.getElementById('sick-leave-to');
    from.value = source?.from || (mode === 'extend' ? calendarOffset(leave.periods.at(-1).to, 1) : localDate());
    to.value = source?.to || '';
    from.readOnly = to.readOnly = mode === 'adopt';
    document.getElementById('sick-leave-period-fields').hidden = ['close', 'number'].includes(mode);
    document.getElementById('sick-leave-close-field').hidden = mode !== 'close';
    document.getElementById('sick-leave-close-date').value = leave?.periods.at(-1).to || '';
    sickLeaveError(''); updateSickLeavePreview();
    document.getElementById('sick-leave-dialog').showModal();
    (mode === 'close' ? document.getElementById('sick-leave-close-date') : mode === 'extend' ? from : mode === 'adopt' ? document.getElementById('sick-leave-save') : number).focus();
  }
  function encounterSickLeaveChoices(patient, entry) {
    const journal = core.getSickLeaveJournal(patient, state.encounters);
    const previousVisit = id => {
      const source = state.encounters.find(item => item.id === id);
      return source && core.calculateSickLeaveDays(source.visitDate, source.visitDate) !== null && source.visitDate <= entry.visitDate;
    };
    return [
      ...journal.leaves.filter(leave => leave.status === 'open' && leave.events.every(event => !event.encounterId || previousVisit(event.encounterId))).map(leave => ({value: 'journal:' + leave.id, leaveId: leave.id, number: leave.number, from: leave.events[0].from, to: leave.periods.at(-1).to, periods: leave.periods})),
      ...journal.legacy.filter(leave => leave.days !== null && leave.encounterId !== entry.id && previousVisit(leave.encounterId)).map(leave => ({value: 'legacy:' + leave.encounterId, sourceEncounterId: leave.encounterId, number: leave.number, from: leave.from, to: leave.to, periods: [{from: leave.from, to: leave.to}]}))
    ];
  }
  function openEncounterSickLeaveForm(mode) {
    const entry = active();
    if (!requireFreshState() || state.view !== 'visit' || !entry) return;
    const patient = patientFor(entry);
    if (core.getEncounterSickLeaveAction(patient, entry)) { toast('В этом приёме уже сохранено действие с больничным. Сначала отмените его, если нужно исправить.', true); return; }
    if (core.calculateSickLeaveDays(entry.visitDate, entry.visitDate) === null) { toast('Укажите дату приёма перед действием с больничным.', true); return; }
    const choices = encounterSickLeaveChoices(patient, entry);
    sickLeaveForm = {mode, patientId: patient.id, encounterId: entry.id, choices, leaveId: '', sourceEncounterId: ''};
    document.getElementById('sick-leave-title').textContent = {issue: 'Выдать новый больничный', extend: 'Продлить существующий больничный', close: 'Закрыть больничный'}[mode];
    document.getElementById('sick-leave-patient').textContent = patientName(patient) + ' · приём ' + dateText(entry.visitDate);
    document.getElementById('sick-leave-description').textContent = {
      issue: 'Укажите номер и период. «Сохранить» внесёт выдачу одновременно в приём и журнал. Введённая ранее отметка в этом приёме будет заменена; текст черновика сохранится.',
      extend: 'Выберите больничный и укажите период продления. «Сохранить» внесёт действие одновременно в приём и журнал. Пересекающиеся дни считаются один раз.',
      close: 'Выберите больничный и его последний день в пределах внесённых периодов. Действие сохранится одновременно в приёме и журнале; дни после закрытия не учитываются.'
    }[mode];
    const selecting = mode !== 'issue';
    document.getElementById('sick-leave-select-field').hidden = !selecting;
    document.getElementById('sick-leave-select').innerHTML = '<option value="">Выберите больничный</option>' + choices.map(choice => '<option value="' + escape(choice.value) + '">' + escape((choice.number ? 'ЛН № ' + choice.number : 'ЛН без номера') + ' · ' + dateText(choice.from) + ' — ' + dateText(choice.to) + (choice.sourceEncounterId ? ' · отметка из приёма' : ' · открыт')) + '</option>').join('');
    document.getElementById('sick-leave-selection-hint').textContent = choices.length ? 'Выберите конкретный больничный. Связь не определяется автоматически по номеру.' : 'Подходящих открытых больничных и прежних отметок с полными датами нет. Можно выдать новый больничный.';
    const number = document.getElementById('sick-leave-number');
    number.value = mode === 'issue' ? entry.assessment.sickLeaveNumber : '';
    number.readOnly = selecting;
    const from = document.getElementById('sick-leave-from'), to = document.getElementById('sick-leave-to');
    from.readOnly = to.readOnly = false;
    from.value = mode === 'issue' ? entry.assessment.sickLeaveFrom || entry.visitDate : '';
    to.value = mode === 'issue' ? entry.assessment.sickLeaveTo : '';
    document.getElementById('sick-leave-close-date').value = '';
    document.getElementById('sick-leave-period-fields').hidden = mode === 'close';
    document.getElementById('sick-leave-close-field').hidden = mode !== 'close';
    document.getElementById('sick-leave-save').disabled = selecting;
    sickLeaveError(''); updateSickLeavePreview();
    document.getElementById('sick-leave-dialog').showModal();
    (selecting ? document.getElementById('sick-leave-select') : number).focus();
  }
  function selectEncounterSickLeave() {
    if (!sickLeaveForm?.encounterId) return;
    const choice = sickLeaveForm.choices.find(item => item.value === document.getElementById('sick-leave-select').value);
    sickLeaveForm.leaveId = choice?.leaveId || '';
    sickLeaveForm.sourceEncounterId = choice?.sourceEncounterId || '';
    document.getElementById('sick-leave-number').value = choice?.number || '';
    document.getElementById('sick-leave-from').value = choice ? calendarOffset(choice.to, 1) : '';
    document.getElementById('sick-leave-to').value = '';
    document.getElementById('sick-leave-close-date').value = choice?.to || '';
    document.getElementById('sick-leave-selection-hint').textContent = choice?.sourceEncounterId ? 'При сохранении эта прежняя отметка будет перенесена в журнал, затем добавится выбранное действие. Исходный приём сохранится; дни не дублируются.' : choice ? 'Номер подставлен из выбранного больничного. Действие будет связано с ним и текущим приёмом.' : 'Выберите конкретный больничный. Связь не определяется автоматически по номеру.';
    document.getElementById('sick-leave-save').disabled = !choice;
    sickLeaveError(''); updateSickLeavePreview();
  }
  function updateSickLeavePreview() {
    if (!sickLeaveForm) return;
    const from = document.getElementById('sick-leave-from').value, to = document.getElementById('sick-leave-to').value;
    const days = core.calculateSickLeaveDays(from, to);
    let text = ['close', 'number'].includes(sickLeaveForm.mode) ? '' : days === null ? 'Укажите обе даты в правильном порядке.' : 'В этом периоде: ' + days + ' календ. дн. Пересечения будут исключены из общего подсчёта.';
    if (sickLeaveForm.encounterId && ['extend', 'close'].includes(sickLeaveForm.mode)) {
      const choice = sickLeaveForm.choices.find(item => item.value === document.getElementById('sick-leave-select').value);
      if (!choice) text = 'Сначала выберите больничный пациента.';
      else if (sickLeaveForm.mode === 'extend' && days !== null && from >= choice.from && to > choice.to) text = 'После продления — всего ' + core.calculateSickLeaveTotalDays([...choice.periods, {from, to}]) + ' календ. дн. В текущем периоде: ' + days + '. Пересекающиеся дни учитываются один раз.';
      else if (sickLeaveForm.mode === 'close') {
        const date = document.getElementById('sick-leave-close-date').value;
        text = choice.periods.some(period => period.from <= date && period.to >= date) ? 'После закрытия — всего ' + core.calculateSickLeaveTotalDays(choice.periods.filter(period => period.from <= date).map(period => ({from: period.from, to: period.to > date ? date : period.to}))) + ' календ. дн. Последний день: ' + dateText(date) + '.' : 'Дата закрытия должна входить в один из внесённых периодов.';
      }
    } else if (sickLeaveForm.mode === 'extend' && days !== null) {
      const patient = state.patients.find(item => item.id === sickLeaveForm.patientId);
      const leave = core.getSickLeaveJournal(patient, state.encounters).leaves.find(item => item.id === sickLeaveForm.leaveId);
      if (leave && from >= leave.events[0].from && to > leave.periods.at(-1).to) text = 'После продления — всего ' + core.calculateSickLeaveTotalDays([...leave.periods, {from, to}]) + ' календ. дн. В текущем периоде: ' + days + '. Пересекающиеся дни учитываются один раз.';
    }
    document.getElementById('sick-leave-preview').textContent = text;
  }
  function commitEncounterSickLeave(pair) {
    const pending = state.pendingNew?.entry.id === pair.encounter.id;
    const encounters = pending ? state.encounters.concat(pair.encounter) : state.encounters.map(entry => entry.id === pair.encounter.id ? pair.encounter : entry);
    const patients = pending ? state.patients.concat(pair.patient) : state.patients.map(patient => patient.id === pair.patient.id ? pair.patient : patient);
    if (!commitEncounters(encounters, patients)) return false;
    if (pending) state.pendingNew = null;
    return true;
  }
  function saveEncounterSickLeave() {
    const entry = active();
    if (!entry || entry.id !== sickLeaveForm.encounterId || state.view !== 'visit') { sickLeaveError('Этот приём уже не открыт. Закройте форму и откройте нужный приём.'); return; }
    if (sickLeaveForm.mode !== 'issue' && !sickLeaveForm.leaveId && !sickLeaveForm.sourceEncounterId) { sickLeaveError('Выберите больничный пациента.'); return; }
    const options = {type: sickLeaveForm.mode};
    if (options.type === 'issue') options.number = document.getElementById('sick-leave-number').value;
    if (options.type === 'close') options.date = document.getElementById('sick-leave-close-date').value;
    else {
      options.from = document.getElementById('sick-leave-from').value;
      options.to = document.getElementById('sick-leave-to').value;
    }
    if (sickLeaveForm.leaveId) options.leaveId = sickLeaveForm.leaveId;
    if (sickLeaveForm.sourceEncounterId) options.sourceEncounterId = sickLeaveForm.sourceEncounterId;
    try {
      const pair = core.applyEncounterSickLeave(patientFor(entry), entry, options, state.encounters);
      if (!commitEncounterSickLeave(pair)) { sickLeaveError(state.error || 'Не удалось сохранить приём и журнал. Повторите сохранение.'); return; }
      document.getElementById('sick-leave-dialog').close(); sickLeaveForm = null;
      render();
      document.getElementById('visit-sick-heading').focus({preventScroll: true});
      toast('Действие сохранено в приёме и журнале. Проверьте черновик перед его обновлением.');
    } catch (error) { sickLeaveError(error.message); }
  }
  function saveSickLeave() {
    if (!sickLeaveForm) return;
    if (!requireFreshState()) { sickLeaveError('Данные изменены в другом окне. Закройте форму и загрузите сохранённую версию.'); return; }
    if (sickLeaveForm.encounterId) { saveEncounterSickLeave(); return; }
    const {mode, patientId, leaveId, sourceEncounterId} = sickLeaveForm;
    const patient = state.patients.find(item => item.id === patientId);
    const number = document.getElementById('sick-leave-number').value;
    const from = document.getElementById('sick-leave-from').value, to = document.getElementById('sick-leave-to').value;
    const leave = patient.sickLeaves?.find(item => item.id === leaveId);
    if (number.length > core.MAX_SICK_LEAVE_NUMBER_LENGTH) { sickLeaveError('Номер не должен превышать 120 символов. Для переноса сначала уточните номер в исходном приёме.'); return; }
    if (['issue', 'adopt', 'extend'].includes(mode) && core.calculateSickLeaveDays(from, to) === null) { sickLeaveError('Укажите обе даты периода. Окончание не может быть раньше начала.'); return; }
    if (mode === 'extend' && (from < leave.events[0].from || to <= leave.events.at(-1).to)) { sickLeaveError('Продление должно начинаться не раньше выдачи, а заканчиваться позже последнего внесённого периода.'); return; }
    if (mode === 'close') {
      const date = document.getElementById('sick-leave-close-date').value;
      if (!date || !leave.events.some(event => event.from <= date && event.to >= date)) { sickLeaveError('Дата закрытия должна входить в один из внесённых периодов. Для более поздней даты сначала добавьте продление.'); return; }
    }
    try {
      let updated;
      if (mode === 'issue' || mode === 'adopt') updated = core.issueSickLeave(patient, {number, from, to, sourceEncounterId}, state.encounters);
      else if (mode === 'extend') updated = core.extendSickLeave(patient, leaveId, {from, to});
      else if (mode === 'close') updated = core.closeSickLeave(patient, leaveId, {date: document.getElementById('sick-leave-close-date').value});
      else updated = {...patient, updatedAt: new Date().toISOString(), sickLeaves: patient.sickLeaves.map(leave => leave.id === leaveId ? {...leave, number} : leave)};
      if (!commitEncounters(state.encounters, state.patients.map(item => item.id === patientId ? updated : item))) { sickLeaveError(state.error || 'Не удалось сохранить журнал.'); return; }
      document.getElementById('sick-leave-dialog').close(); sickLeaveForm = null;
      render(); focusSickLeaveJournal(); toast('Журнал больничных сохранён.');
    } catch (error) { sickLeaveError(error.message); }
  }
  function patientInformationValue(value) {
    const text = value.trim();
    if (!text) return '<span class="patient-fact-empty">Не указаны</span>';
    if (text.length <= 180) return '<p>' + escape(text) + '</p>';
    return '<details class="patient-fact-long"><summary><span class="patient-fact-preview">' + escape(text.slice(0, 180)) + '…</span><span class="patient-fact-expand">Показать полностью</span><span class="patient-fact-collapse">Свернуть</span></summary><p>' + escape(text) + '</p></details>';
  }
  function renderPatientInformation(entry) {
    if (!entry) return '<section id="patient-information" class="patient-information"><p class="patient-fact-empty">Сведения появятся после первого приёма.</p></section>';
    const sex = {female: 'Женский', male: 'Мужской', unspecified: 'Не уточнён'}[entry.sex] || 'Не указан';
    return '<section id="patient-information" class="patient-information" aria-labelledby="patient-information-heading"><div class="patient-information-heading"><h2 id="patient-information-heading">Сведения из последнего приёма · <time datetime="' + escape(entry.visitDate) + '">' + escape(dateText(entry.visitDate)) + '</time></h2>' + button('edit-patient-information', 'Изменить сведения', 'edit', 'secondary compact', 'data-id="' + escape(entry.id) + '" aria-label="Изменить сведения в приёме от ' + escape(dateText(entry.visitDate)) + '"') + '</div>' +
      '<dl class="patient-demographics"><div><dt>Возраст на дату приёма</dt><dd data-patient-information="age" data-encounter-age="' + escape(entry.id) + '">' + escape(core.encounterAge(entry, patientFor(entry)).trim() || 'Не указан') + '</dd></div><div><dt>Пол</dt><dd data-patient-information="sex">' + escape(sex) + '</dd></div></dl>' +
      '<dl class="patient-facts">' + [['allergies', 'Аллергии'], ['medications', 'Постоянные препараты'], ['conditions', 'Заболевания и операции']].map(([key, title]) => '<div><dt>' + title + '</dt><dd data-patient-information="' + key + '">' + patientInformationValue(entry.history[key]) + '</dd></div>').join('') + '</dl></section>';
  }
  function renderPatientReturn() {
    const today = localDate();
    const plans = core.getReturnVisits(state.encounters, today).filter(item => item.patientId === state.patientId && item.bucket !== 'completed');
    const next = plans.find(item => item.date >= today);
    const past = plans.filter(item => item.date < today).at(-1);
    return '<span class="patient-return-label">Ближайшая явка</span>' +
      (next ? '<strong>' + escape(dateText(next.date)) + (next.date === today ? ' · сегодня' : '') + '</strong>' : '<strong class="muted">' + (past ? 'Будущая дата не назначена' : 'Не назначена') + '</strong>') +
      (!next && past ? '<span class="patient-return-past">Дата явки прошла: ' + escape(dateText(past.date)) + ' · исход не отмечен</span>' : '');
  }
  function refreshPatientReturn() {
    state.patientCardDay = localDate();
    document.getElementById('patient-next-return').innerHTML = renderPatientReturn();
    updatePatientAgeDisplays(selectedPatient());
  }
  const carryFields = [['medications', 'Принимаемые препараты на постоянной основе'], ['allergies', 'Аллергологический анамнез'], ['conditions', 'Заболевания и операции в анамнезе']];
  function briefingSource(type, id, label = 'Источник') {
    return '<button type="button" class="briefing-source button ghost compact" data-briefing-source="' + type + '" data-source-id="' + escape(id) + '">' + escape(label) + '</button>';
  }
  function briefingDate(value) {
    return escape(dateText(value)) + (value > localDate() ? ' <span class="briefing-future">Будущая дата</span>' : '');
  }
  function briefingText(value, limit = 180) {
    return escape(value.length > limit ? value.slice(0, limit) + '…' : value);
  }
  function renderPatientBriefing(brief) {
    const empty = '<p class="small">Нет внесённых сведений.</p>';
    const section = (id, title, content) => '<section id="' + id + '" class="briefing-section"><h3>' + title + '</h3>' + content + '</section>';
    const diagnoses = brief.diagnoses.map(item => '<li><p>' + briefingText(item.text) + '</p><div class="briefing-meta">' + briefingDate(item.date) + ' · ' +
      (item.reviewStatus === 'reviewed' ? 'Проверено врачом' : 'Черновик') + briefingSource('encounter', item.encounterId) + '</div></li>').join('');
    const facts = [['allergies', 'Аллергии'], ['medications', 'Постоянные препараты'], ['conditions', 'Заболевания и операции']].map(([key, label]) => {
      const fact = brief.facts[key];
      return '<div class="briefing-fact"><strong>' + label + '</strong><p>' + (fact ? briefingText(fact.text) : 'Не указано в сохранённых записях.') +
        '</p>' + (fact ? '<div class="briefing-meta">' + briefingDate(fact.date) + briefingSource('encounter', fact.encounterId) + '</div>' : '') + '</div>';
    }).join('');
    const prescribed = brief.prescriptions;
    const prescriptions = prescribed ? '<div class="briefing-meta">' + briefingDate(prescribed.date) + briefingSource('encounter', prescribed.encounterId) +
      '</div><ul class="briefing-items">' + prescribed.items.slice(0, 3).map(item => '<li>' + briefingText(core.formatPrescription(item)) + '</li>').join('') +
      '</ul>' + (prescribed.items.length > 3 ? '<p class="small">Ещё назначений: ' + (prescribed.items.length - 3) + '. Все — в источнике.</p>' : '') +
      '<p class="hint">Назначения из записи; актуальность и продолжение курса требуют вашей проверки.</p>' : empty;
    const investigations = brief.investigations.map(item => '<li><strong>' + escape(item.title) + '</strong><div class="briefing-meta">' + briefingDate(item.date) +
      briefingSource(item.type, item.id) + '</div><p>' + briefingText(item.results.slice(0, 2).map(result => result.name + ': ' + result.result +
      (investigationUnit(result) ? ' ' + investigationUnit(result) : '')).join('; ')) + '</p>' +
      (item.results.length > 2 ? '<p class="small">Ещё показателей: ' + (item.results.length - 2) + ' — в источнике.</p>' : '') + '</li>').join('');
    const leaves = brief.sickLeaves.open;
    const legacy = brief.sickLeaves.legacy;
    const sick = leaves.slice(0, 3).map(leave => {
      const last = leave.events.at(-1);
      const from = leave.periods[0]?.from || last.from;
      const to = leave.periods.at(-1)?.to || last.to;
      return '<li><strong>№ ' + escape(leave.number || 'не указан') + ' · Не закрыт</strong><p>' + briefingDate(from) + ' — ' + briefingDate(to) +
        ' · ' + leave.days + ' календ. дн.</p>' + (to < brief.today ? '<p class="small">Указанный период закончился; закрытие не отмечено.</p>' : '') +
        briefingSource('journal', leave.id) + '</li>';
    }).join('');
    const legacySummary = legacy.length ? '<p class="small">Старые отметки из приёмов: ' + legacy.length + '. Статус закрытия по ним не установлен.</p>' +
      legacy.slice(0, 2).map(item => '<div class="briefing-meta">№ ' + escape(item.number || 'не указан') + ' · ' +
        (item.from ? briefingDate(item.from) : 'Начало не указано') + ' — ' + (item.to ? briefingDate(item.to) : 'Окончание не указано') +
        briefingSource('encounter', item.encounterId) + '</div>').join('') : '';
    const returnVisit = brief.nextReturn;
    const upcoming = returnVisit ? '<p class="briefing-return-date">' + escape(dateText(returnVisit.date)) + (returnVisit.date === brief.today ? ' · Сегодня' : '') +
      '</p><p class="small">' + (returnVisit.linkedEncounterId ? 'Запись приёма уже начата.' : 'Явка назначена.') + '</p>' +
      briefingSource('encounter', returnVisit.encounterId, 'Где назначена') : '<p class="small">Предстоящая явка не назначена.</p>';
    return '<div class="briefing-heading"><h3>Краткая сводка</h3><span class="small">Записей: ' + brief.visitCount + '</span></div><div class="briefing-grid">' +
      section('briefing-facts', 'Последние внесённые сведения', facts) +
      section('briefing-diagnoses', 'Последние диагнозы', diagnoses ? '<ul class="briefing-items">' + diagnoses + '</ul>' : empty) +
      section('briefing-prescriptions', 'Последние внесённые назначения', prescriptions) +
      section('briefing-investigations', 'Свежие исследования', investigations ? '<ul class="briefing-items">' + investigations + '</ul>' +
        (brief.investigationCount > 3 ? '<p class="small">Показаны 3 из ' + brief.investigationCount + '. Полная история — в карточке.</p>' : '') : empty) +
      section('briefing-sick-leaves', 'Больничные', (sick ? '<ul class="briefing-items">' + sick + '</ul>' : '<p class="small">Незакрытых листков в журнале нет.</p>') +
        (leaves.length > 3 ? '<p class="small">Ещё незакрытых листков: ' + (leaves.length - 3) + '.</p>' + briefingSource('journal', '', 'Все незакрытые листки') : '') + legacySummary +
        (legacy.length > 2 ? briefingSource('journal', '', 'Все старые отметки') : '')) +
      section('briefing-return', 'Ближайшая повторная явка', upcoming + (brief.overdueReturnCount ? '<p class="small">Прошедших дат без отметки «Состоялся»: ' + brief.overdueReturnCount + '.</p>' : '')) +
      '</div>';
  }
  function briefingJournalSource(patient, leafId) {
    const journal = core.getSickLeaveJournal(patient, state.encounters);
    const leaves = leafId ? journal.leaves.filter(item => item.id === leafId) : journal.leaves.filter(item => item.status === 'open');
    const html = leaves.map(leave => '<section class="briefing-source-section"><h3>№ ' + escape(leave.number || 'не указан') + ' · ' +
      (leave.status === 'closed' ? 'Закрыт' : 'Не закрыт') + '</h3><p>Всего календарных дней: ' + leave.days + '</p><ul class="briefing-items">' +
      leave.events.map(event => '<li><strong>' + ({issue: 'Выдача', extend: 'Продление', close: 'Закрытие'}[event.type]) + '</strong> · ' +
        (event.type === 'close' ? briefingDate(event.to) : briefingDate(event.from) + ' — ' + briefingDate(event.to)) + '</li>').join('') + '</ul></section>').join('');
    return html + (!leafId && journal.legacy.length ? '<h3>Старые отметки, статус закрытия неизвестен</h3>' +
      journal.legacy.map(item => '<p>№ ' + escape(item.number || 'не указан') + ' · ' + (item.from ? briefingDate(item.from) : 'Начало не указано') +
        ' — ' + (item.to ? briefingDate(item.to) : 'Окончание не указано') + ' · Приём ' +
        escape(dateText(state.encounters.find(entry => entry.id === item.encounterId).visitDate)) + '</p>').join('') : '');
  }
  function openBriefingSource(target) {
    if (!repeatPreparation || !document.getElementById('repeat-dialog').open) return;
    const patient = state.patients.find(item => item.id === repeatPreparation.patientId);
    if (!patient) return;
    const type = target.dataset.briefingSource, id = target.dataset.sourceId;
    let title, html;
    if (type === 'encounter') {
      const entry = state.encounters.find(item => item.id === id && item.patientId === patient.id);
      if (!entry) return;
      title = 'Приём от ' + dateText(entry.visitDate);
      html = '<p>' + recordStatus(entry) + '</p><dl class="historical-fields">' +
        historyFields.map(([key, label]) => historicalField(label, entry.history[key])).join('') +
        vitalFields.filter(([key]) => entry.vitals[key].trim()).map(([key, label, unit]) => historicalField(label, entry.vitals[key] + ' ' + unit)).join('') +
        examDescription(entry.exam, entry.examSelections).filter(item => item.text).map(item => historicalField(item.title, item.text)).join('') +
        historicalField('Диагноз', entry.assessment.summary) +
        historicalField('Назначения препаратов', (entry.prescriptions || []).map(core.formatPrescription).join('\n\n')) +
        historicalField('Рекомендации', entry.assessment.plan) +
        historicalField('Повторная явка', entry.assessment.returnVisitDate ? dateText(entry.assessment.returnVisitDate) : '') +
        (entry.assessment.sickLeaveIssued === 'yes' ? historicalField('Больничный', '№ ' + (entry.assessment.sickLeaveNumber || 'не указан') + ' · ' +
          dateText(entry.assessment.sickLeaveFrom) + ' — ' + dateText(entry.assessment.sickLeaveTo)) : '') +
        '</dl>' + ((entry.investigationIds || []).length ? '<h3>Выбранные исследования</h3>' +
          renderReportRows((patient.investigations || []).filter(item => entry.investigationIds.includes(item.id))) : '') +
        '<h3>Сохранённый текст записи</h3><p class="briefing-saved-text">' + escape(entry.draft.text || 'Текст не заполнен.') + '</p>';
    } else if (type === 'report' || type === 'result') {
      const report = type === 'report' ? core.getInvestigationReports(patient).find(item => item.id === id) : null;
      const result = type === 'result' ? (patient.investigations || []).find(item => item.id === id && !item.reportId) : null;
      if (!report && !result) return;
      title = report ? report.title : result.name;
      html = '<p>' + briefingDate((report || result).date) + '</p>' + renderReportRows(report ? report.results : [result]);
    } else if (type === 'journal') {
      title = 'Журнал больничных';
      html = briefingJournalSource(patient, id);
      if (!html) return;
    } else return;
    document.getElementById('briefing-source-title').textContent = title;
    document.getElementById('briefing-source-notice').textContent = state.externalChange ?
      'Сведения в другом окне изменились. Здесь показана прежняя версия только для просмотра. Загрузите сохранённую версию перед созданием приёма.' :
      'Только просмотр. Для переноса вернитесь к сводке и отметьте нужные сведения.';
    document.getElementById('briefing-source-content').innerHTML = '<p class="small">' + escape(patientName(patient)) + '</p>' + html;
    const dialog = document.getElementById('briefing-source-dialog');
    dialog.showModal(); dialog.scrollTop = 0; document.getElementById('briefing-source-title').focus({preventScroll: true});
  }
  function repeatError(message) {
    const error = document.getElementById('repeat-error');
    error.textContent = message; error.hidden = !message;
  }
  function updateCarryStatus() {
    const historyCount = document.querySelectorAll('#repeat-fields input[name="carry-history"]:checked').length;
    const prescriptions = document.querySelectorAll('#repeat-fields input[name="carry-prescription"]:checked').length;
    document.getElementById('repeat-carry-status').textContent = historyCount || prescriptions ?
      'После подтверждения: сведений анамнеза — ' + historyCount + ', назначений — ' + prescriptions + '.' :
      'Перенос не выбран. Новый приём будет создан с пустыми полями.';
  }
  function updateCarryPreview() {
    const source = state.encounters.find((entry) => entry.id === document.getElementById('repeat-source').value && entry.patientId === state.patientId);
    document.getElementById('repeat-history-fields').innerHTML = source ? carryFields.map(([key, title]) => '<label class="carry-choice"><input type="checkbox" name="carry-history" value="' + key + '"' + (source.history[key].trim() ? '' : ' disabled') + '><span><strong>' + title + '</strong><span class="carry-preview">' + escape(source.history[key].trim() || 'Не заполнено — переносить нечего') + '</span></span></label>').join('') : '';
    const prescriptions = source?.prescriptions || [];
    document.getElementById('repeat-prescriptions-section').hidden = !prescriptions.length;
    document.getElementById('repeat-prescriptions').innerHTML = prescriptions.map(item => '<label class="carry-choice"><input type="checkbox" name="carry-prescription" value="' + escape(item.id) + '"><span><strong>' + escape(item.name) + '</strong><span class="carry-preview">' + escape(core.formatPrescription(item)) + '</span></span></label>').join('');
    updateCarryStatus();
  }
  function openRepeatDialog(planId = null) {
    if (document.getElementById('repeat-dialog').open || !requireFreshState()) return;
    state.repeatPlanId = planId;
    const patient = selectedPatient();
    if (!patient) return;
    if (state.birthDateInputs[patient.id]) { toast('Перед созданием приёма исправьте дату рождения в карточке пациента.', true); return; }
    const brief = core.getPatientBriefing(patient, state.encounters, localDate());
    const snapshot = dataSnapshot();
    repeatPreparation = {patientId: patient.id, snapshot, today: brief.today};
    const visits = patientHistory(patient.id);
    document.getElementById('repeat-patient').textContent = patientName(patient);
    document.getElementById('repeat-title').textContent = visits.length ? 'Повторный приём' : 'Первый приём';
    const select = document.getElementById('repeat-source');
    select.innerHTML = visits.map((entry) => '<option value="' + escape(entry.id) + '">' + escape(dateText(entry.visitDate)) + ' · ' + escape(shortId(entry)) + ' · ' + escape(entry.history.complaints.trim().slice(0, 100) || 'Жалобы не указаны') + '</option>').join('');
    select.disabled = Boolean(planId);
    if (planId) select.value = planId;
    document.getElementById('repeat-source-wrap').hidden = !visits.length;
    document.getElementById('repeat-briefing').innerHTML = renderPatientBriefing(brief);
    repeatError('');
    updateCarryPreview();
    document.getElementById('repeat-dialog').showModal();
    document.getElementById('repeat-dialog').scrollTop = 0;
    document.getElementById('repeat-title').focus({preventScroll: true});
  }
  function createRepeat() {
    if (!repeatPreparation || !document.getElementById('repeat-dialog').open) return;
    if (state.externalChange || repeatPreparation.snapshot !== dataSnapshot()) {
      state.externalChange = true; state.saved = false;
      state.error = 'Данные изменены после открытия сводки. Загрузите сохранённую версию перед новым приёмом.';
      updateSaveStatus();
      document.getElementById('repeat-dialog').close();
      toast('Данные изменены в другом окне или после открытия сводки. Загрузите сохранённую версию перед новым приёмом.', true); return;
    }
    const patient = selectedPatient();
    if (!patient || patient.id !== repeatPreparation.patientId) throw new Error('Карточка пациента больше не доступна.');
    if (repeatPreparation.today !== localDate()) throw new Error('Дата изменилась. Закройте сводку и откройте её заново.');
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
    const fields = Array.from(document.querySelectorAll('#repeat-fields input[name="carry-history"]:checked'), (input) => input.value);
    const prescriptionIds = Array.from(document.querySelectorAll('#repeat-prescriptions input[name="carry-prescription"]:checked'), (input) => input.value);
    const entry = source ? core.createRepeatEncounter(source, {carryHistoryFields: fields, carryPrescriptionIds: prescriptionIds}) : core.createEncounter({patientId: patient.id});
    const encounters = state.encounters.map(item => state.repeatPlanId && item.id === source.id ? {...core.linkReturnVisit(item, entry), updatedAt: entry.createdAt} : item).concat(entry);
    const patients = state.patients.map(item => item.id === patient.id ? {...item, updatedAt: entry.createdAt} : item);
    if (!commitEncounters(encounters, patients)) { repeatError(state.error || 'Приём не сохранён. Выбор остался в форме; повторите попытку.'); return; }
    document.getElementById('repeat-dialog').close();
    state.activeId = entry.id; state.repeatPlanId = null; navigate('visit', 'basic');
    const carried = [fields.length ? 'отмеченные сведения анамнеза' : '', prescriptionIds.length ? 'выбранные назначения препаратов (' + prescriptionIds.length + ')' : ''].filter(Boolean);
    toast(carried.length ? 'Приём создан. Перенесены только ' + carried.join(' и ') + '; проверьте их актуальность.' : 'Приём создан с пустыми полями. Сведения из прошлых приёмов не перенесены.');
  }
  function precedingVisits() {
    const entry = active();
    const order = (a, b) => a.visitDate.localeCompare(b.visitDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    return entry ? state.encounters.filter(item => item.patientId === entry.patientId && item.id !== entry.id && order(item, entry) < 0).sort((a, b) => order(b, a)) : [];
  }
  function historicalField(title, value) {
    return '<div class="historical-field"><dt>' + escape(title) + '</dt><dd>' + escape(value.trim() || 'Не указано') + '</dd></div>';
  }
  function examDescription(exam, selections) {
    return examCatalog.SECTIONS.map(section => {
      const selected = examCatalog.FIELDS.filter(item => item.section === section.id).map(item => item.options.find(option => option.value === selections[item.id])?.text).filter(Boolean);
      if (exam[section.id].trim()) selected.push(exam[section.id].trim());
      return {title: section.title, text: selected.join('; ')};
    }).concat({title: 'Другие данные осмотра', text: exam.other.trim()});
  }
  function renderPreviousVisit() {
    const visits = precedingVisits();
    if (!visits.some(item => item.id === state.previousId)) state.previousId = visits[0]?.id || '';
    const source = visits.find(item => item.id === state.previousId);
    if (!source) return '<p class="muted">Предыдущих приёмов пока нет.</p>';
    return '<div class="previous-visit-title"><h2 id="previous-visit-title">Предыдущий приём</h2>' + button('previous-visit', 'Скрыть', null, 'ghost compact') + '</div><p class="historical-notice">Сведения из истории · только просмотр. В текущий приём ничего не переносится.</p>' +
      '<div class="field"><label for="previous-visit-select">Запись из истории</label><select id="previous-visit-select">' + visits.map(item => '<option value="' + escape(item.id) + '"' + (item.id === source.id ? ' selected' : '') + '>' + escape(dateText(item.visitDate) + ' · ' + shortId(item)) + '</option>').join('') + '</select></div>' +
      '<p class="previous-visit-date"><strong>' + escape(dateText(source.visitDate)) + '</strong> ' + recordStatus(source) + '</p><dl class="historical-fields">' +
      historyFields.map(([key, title]) => historicalField(title, source.history[key])).join('') +
      vitalFields.map(([key, title, unit]) => source.vitals[key].trim() ? historicalField(title, source.vitals[key] + ' ' + unit) : '').join('') +
      examDescription(source.exam, source.examSelections).filter(item => item.text).map(item => historicalField(item.title, item.text)).join('') +
      historicalField('Диагноз', source.assessment.summary) +
      (source.prescriptions?.length ? historicalField('Назначения препаратов', source.prescriptions.map(core.formatPrescription).join('\n\n')) : '') +
      historicalField('Рекомендации', source.assessment.plan) + '</dl>';
  }
  function refreshPreviousVisit() {
    const available = precedingVisits().length > 0;
    const toggle = app.querySelector('.visit-heading [data-action="previous-visit"]');
    if (toggle) { toggle.disabled = !available; toggle.setAttribute('aria-expanded', String(state.previousOpen && available)); }
    const panel = document.getElementById('previous-visit-panel');
    if (!panel) return;
    panel.hidden = !state.previousOpen || !available;
    panel.innerHTML = panel.hidden ? '' : renderPreviousVisit();
    panel.closest('.visit-comparison').classList.toggle('has-previous', !panel.hidden);
  }
  function templateError(message) {
    const target = document.getElementById('template-error');
    target.textContent = message; target.hidden = !message;
  }
  function selectedTemplate() {
    return state.templates.find(item => item.id === document.getElementById('template-select').value && item.kind === templateForm?.kind);
  }
  function updateTemplatePreview() {
    const template = selectedTemplate();
    const preview = document.getElementById('template-preview');
    preview.textContent = template ? (template.kind === 'exam' ? examDescription(template.content.exam, template.content.examSelections).filter(item => item.text).map(item => item.title + ': ' + item.text).join('\n\n') : template.content.plan) : 'Выберите сохранённый шаблон, чтобы увидеть его текст.';
    ['apply', 'update', 'delete'].forEach(action => { document.getElementById('template-' + action).disabled = !template; });
    document.getElementById('template-name').value = template?.name || '';
  }
  function refreshTemplateList(selectedId = '') {
    const items = state.templates.filter(item => item.kind === templateForm.kind);
    document.getElementById('template-select').innerHTML = '<option value="">Выберите шаблон</option>' + items.map(item => '<option value="' + escape(item.id) + '"' + (item.id === selectedId ? ' selected' : '') + '>' + escape(item.name) + '</option>').join('');
    document.getElementById('template-empty').hidden = items.length > 0;
    updateTemplatePreview();
  }
  function openVisitTemplates(kind) {
    if (!active() || !['exam', 'recommendations'].includes(kind)) return;
    templateForm = {kind, encounterId: active().id};
    document.getElementById('template-title').textContent = kind === 'exam' ? 'Мои шаблоны осмотра' : 'Мои шаблоны рекомендаций';
    document.getElementById('template-scope').textContent = kind === 'exam' ? 'Сохраняются выбранные признаки и текстовые уточнения осмотра. Измеренные показатели, ФИО и анамнез не входят в шаблон. Проверьте, что в уточнениях нет личных данных.' : 'Сохраняется только текст поля «Рекомендации». Отдельный список назначений препаратов в этот шаблон не входит. Проверьте, что в тексте нет личных данных и сведений конкретного пациента.';
    templateError(''); refreshTemplateList();
    document.getElementById('template-dialog').showModal();
    document.getElementById(state.templates.some(item => item.kind === kind) ? 'template-select' : 'template-name').focus();
  }
  function saveTemplates(templates) {
    if (!requireFreshState()) { templateError('Данные изменены в другом окне. Закройте шаблоны и загрузите сохранённую версию.'); return false; }
    const includePending = state.pendingNew && pendingHasContent();
    const encounters = includePending ? state.encounters.concat(state.pendingNew.entry) : state.encounters;
    const patients = includePending ? state.patients.concat(state.pendingNew.patient) : state.patients;
    const result = repository.save(encounters, patients, templates);
    state.saved = result.ok; state.error = result.error;
    if (result.ok) {
      state.templates = templates;
      if (includePending) { state.encounters = encounters; state.patients = patients; state.pendingNew = null; }
    }
    updateSaveStatus();
    if (!result.ok) templateError(result.error);
    return result.ok;
  }
  async function templateAction(action) {
    if (!templateForm || active()?.id !== templateForm.encounterId) return;
    if (!requireFreshState()) { templateError('Данные изменены в другом окне. Закройте шаблоны и загрузите сохранённую версию.'); return; }
    const template = selectedTemplate();
    templateError('');
    try {
      if (action === 'save' || action === 'update') {
        if (action === 'update' && !template) return;
        const next = core.createVisitTemplate(active(), {kind: templateForm.kind, name: document.getElementById('template-name').value, ...(action === 'update' ? {id: template.id} : {})});
        if (action === 'update') {
          next.createdAt = template.createdAt;
          if (!await confirmAction('Обновить выбранный шаблон?', 'Название и содержимое шаблона «' + template.name + '» будут заменены текущим разделом приёма. Другие записи не изменятся.', 'Обновить шаблон')) return;
        }
        const templates = action === 'update' ? state.templates.map(item => item.id === template.id ? next : item) : state.templates.concat(next);
        if (!saveTemplates(templates)) return;
        refreshTemplateList(next.id); toast(action === 'update' ? 'Шаблон обновлён.' : 'Шаблон сохранён.');
      } else if (action === 'delete' && template) {
        if (!await confirmAction('Удалить шаблон?', 'Шаблон «' + template.name + '» будет удалён. Текущий приём и сохранённые записи останутся без изменений.', 'Удалить шаблон')) return;
        if (!saveTemplates(state.templates.filter(item => item.id !== template.id))) return;
        refreshTemplateList(); toast('Шаблон удалён.');
      } else if (action === 'apply' && template) {
        const entry = active();
        const meaningful = template.kind === 'exam' ? [entry.exam, entry.examSelections].some(group => Object.values(group).some(value => value.trim())) : Boolean(entry.assessment.plan.trim());
        if (meaningful && !await confirmAction('Заменить текущий раздел шаблоном?', (template.kind === 'exam' ? 'Выбранные признаки и уточнения осмотра' : 'Рекомендации') + ' будут заменены содержимым шаблона «' + template.name + '». Существующий текст черновика сохранится; после применения проверьте актуальность всех формулировок.', 'Применить шаблон')) return;
        if (!requireFreshState()) { templateError('Данные изменены в другом окне. Закройте шаблоны и загрузите сохранённую версию.'); return; }
        const updated = core.applyVisitTemplate(entry, template);
        if (state.pendingNew?.entry.id === entry.id) state.pendingNew.entry = updated;
        else state.encounters = state.encounters.map(item => item.id === entry.id ? updated : item);
        persist(); render();
        if (!state.saved) { templateError(state.error || 'Изменения не сохранены. Сведения остаются в форме этого окна.'); return; }
        document.getElementById('template-dialog').close();
        app.querySelector('[data-action="visit-templates"][data-template-kind="' + template.kind + '"]')?.focus({preventScroll: true});
        toast('Шаблон применён. Проверьте сведения и измените отдельные пункты при необходимости. Текст черновика сохранён.');
      }
    } catch (error) { templateError(error.message); }
  }
  function renderVisit() {
    if (state.previousForId !== active().id) { state.previousOpen = false; state.previousId = ''; state.previousForId = active().id; }
    const previous = state.previousOpen && precedingVisits().length > 0;
    return '<section class="visit-context" aria-label="Пациент и приём"><div class="visit-heading"><h1 id="visit-patient-heading">' + escape(patientLabel(active())) + '</h1><div class="actions">' + button('previous-visit', 'Предыдущий приём', 'clock', 'secondary compact', 'aria-controls="previous-visit-panel" aria-expanded="' + previous + '"' + (precedingVisits().length ? '' : ' disabled')) + button('patient', 'Карточка и история', 'user', 'secondary compact', 'data-patient-id="' + escape(active().patientId) + '"') + '</div></div><p class="patient-birth-summary" data-patient-age-summary>' + escape(patientIdentityDetails(patientFor(active()), active().visitDate, true)) + '</p><div class="visit-meta"><p id="visit-date-summary">Демонстрационный приём · ' + escape(dateText(active().visitDate)) + '</p><div id="visit-record-status">' + recordStatus(active()) + '</div><div id="save-status" class="save-indicator" role="status"></div></div>' +
      '<nav class="tab-bar pager-tabs" role="tablist" aria-label="Разделы приёма">' + tabs.map(([key, label], i) => '<button type="button" id="visit-tab-' + key + '" class="tab pager-tab' + (state.tab === key ? ' active' : '') + '" role="tab" data-action="tab" data-tab="' + key + '" aria-controls="visit-form-panel" aria-selected="' + (state.tab === key) + '" tabindex="' + (state.tab === key ? '0' : '-1') + '"' + (state.tab === key ? ' aria-current="step"' : '') + '><span class="step-number">' + (i + 1) + '</span>' + label + '</button>').join('') + '</nav></section>' +
      '<div class="visit-comparison' + (previous ? ' has-previous' : '') + '"><div id="visit-form-panel" class="current-visit-form pager-viewport" role="tabpanel" aria-labelledby="visit-tab-' + state.tab + '" tabindex="0">' + ({basic: renderBasic, history: renderHistory, exam: renderExam, investigations: renderVisitInvestigations, draft: renderDraft}[state.tab])() + '</div><aside id="previous-visit-panel" class="card previous-visit-panel" aria-labelledby="previous-visit-title"' + (previous ? '' : ' hidden') + '>' + (previous ? renderPreviousVisit() : '') + '</aside></div>' + renderVisitActions();
  }
  function renderVisitActions() {
    const controls = state.tab === 'draft' ? button('generate', 'Сформировать черновик', 'document', 'secondary') + button('copy', 'Копировать', 'copy') + button('download-text', 'Скачать .txt', 'download') + '<div id="record-review-actions"></div>' + button('finish-visit', 'Завершить приём', 'check', 'primary', 'title="Сохранить запись и открыть историю пациента"') :
      state.tab === 'basic' ? nextFooter(null, 'history', 'Перейти к анамнезу') : state.tab === 'history' ? nextFooter('basic', 'exam', 'Перейти к осмотру') : state.tab === 'exam' ? nextFooter('history', 'investigations', 'Перейти к исследованиям') : nextFooter('exam', 'draft', 'Перейти к записи');
    return '<div class="visit-action-bar" role="group" aria-label="Действия приёма">' + controls + '</div>';
  }
  let visitLayoutObserver;
  function observeVisitLayout() {
    if (visitLayoutObserver) visitLayoutObserver.disconnect();
    const header = app.querySelector('.visit-context'), actions = app.querySelector('.visit-action-bar'), notice = document.getElementById('toast');
    const measure = () => {
      document.documentElement.style.setProperty('--visit-context-height', header ? header.getBoundingClientRect().height + 'px' : '0px');
      document.documentElement.style.setProperty('--visit-actions-height', actions ? actions.getBoundingClientRect().height + 'px' : '0px');
      document.documentElement.style.setProperty('--visit-toast-height', header && !notice.hidden ? notice.getBoundingClientRect().height + 12 + 'px' : '0px');
    };
    measure();
    if (header && actions) { visitLayoutObserver = new ResizeObserver(measure); visitLayoutObserver.observe(header); visitLayoutObserver.observe(actions); visitLayoutObserver.observe(notice); }
  }
  function aside(title, text) {
    const entry = active();
    return '<aside class="side-card">' + icon('edit') + '<h3>' + title + '</h3><p>' + text + '</p><div class="summary-rows"><div class="summary-row"><span>Анамнез</span><span data-summary="history">' + filledCount(entry.history) + ' из 7 полей</span></div><div class="summary-row"><span>Признаки осмотра</span><span id="exam-total">' + filledCount(entry.examSelections) + ' из ' + examCatalog.FIELDS.length + '</span></div><div class="summary-row"><span>Показатели</span><span data-summary="vitals">' + filledCount(entry.vitals) + ' из 8 полей</span></div></div></aside>';
  }
  function nextFooter(previous, next, label) {
    return '<div class="form-footer">' + (previous ? button('tab', 'Назад', null, 'secondary', 'data-tab="' + previous + '"') : '<span class="muted small">Все поля необязательны</span>') + button('tab', label, 'arrow', 'primary', 'data-tab="' + next + '"') + '</div>';
  }
  function renderBasic() {
    return '<div class="form-layout"><section class="card form-card"><h2>Сведения о приёме</h2><p class="section-intro">Укажите вымышленное ФИО и сведения об этом приёме. Все поля необязательны.</p><div class="field-grid three">' + patientNameField(patientFor(active())) + patientBirthDateField(patientFor(active())) +
      field('visitDate', 'Дата приёма', '', {type: 'date'}) + renderEncounterAge() +
      field('sex', 'Пол', '', {select: [['', 'Не указан'], ['female', 'Женский'], ['male', 'Мужской'], ['unspecified', 'Не уточнён']]}) +
      '</div>' + '</section>' + aside('Карточка пациента', 'ФИО и дата рождения связаны с карточкой пациента. Возраст рассчитывается на дату приёма; если дата рождения неизвестна, можно указать возраст вручную. Для переноса данных используйте резервную копию.') + '</div>';
  }
  function renderHistory() {
    return '<div class="form-layout"><section class="card form-card"><h2>Анамнез</h2><p class="section-intro">Запишите известные сведения. Пустое поле не означает отсутствие симптомов, заболеваний или аллергии. Дополнительный анамнез включается только при заполнении.</p><div class="field-grid">' + historyFields.map(([key, title, hint], i) => field('history.' + key, title, hint, {full: i === 0 || i === 6})).join('') + '</div>' + '</section>' + aside('Никаких предположений', 'Генератор упорядочит ваши формулировки. Пустой дополнительный анамнез будет пропущен; основные незаполненные поля останутся обозначены.') + '</div>';
  }
  function renderExamGroup(section) {
    const items = examCatalog.FIELDS.filter((item) => item.section === section.id);
    const count = items.filter((item) => active().examSelections[item.id]).length;
    const note = active().exam[section.id];
    return '<details class="exam-group" data-exam-section="' + section.id + '"><summary><span class="exam-section-title">' + escape(section.title) + '</span><span class="exam-count" data-count-section="' + section.id + '">' + count + ' из ' + items.length + '</span>' + button('normal-exam-section', 'Осмотр без особенностей', null, 'secondary compact exam-section-normal', 'data-section="' + section.id + '" aria-label="Осмотр без особенностей: ' + escape(section.title) + '"') + '<span class="exam-preview" data-exam-preview="' + section.id + '">' + renderExamSummary(section) + '</span></summary><div class="exam-group-content"><div class="field-grid">' + items.map((item) => field('examSelections.' + item.id, item.label, '', {select: [['', 'Не выбрано'], ...item.options.map((option) => [option.value, option.label])]})).join('') + '</div><details class="exam-note"' + (note.trim() ? ' open' : '') + '><summary>Уточнение или сохранённое описание</summary>' + field('exam.' + section.id, 'Уточнение: ' + section.title.toLocaleLowerCase('ru'), 'Локализация, особенности или своя формулировка (необязательно)', {hint: 'Этот текст включается вместе с выбранными признаками. Проверьте их согласованность.'}) + '</details></div></details>';
  }
  function renderExamSummary(section) {
    const selected = examCatalog.FIELDS.filter(item => item.section === section.id).map(item => item.options.find(option => option.value === active().examSelections[item.id])).filter(Boolean);
    const description = selected.map(option => option.text).join('; ');
    const note = active().exam[section.id].trim();
    const shortened = description.length > 200 || note.length > 140;
    return '<span class="exam-selected-preview' + (description ? '' : ' muted') + '">' + (description ? escape(description.slice(0, 200)) + (description.length > 200 ? '…' : '') : 'Признаки не выбраны') + '</span>' +
      (note ? '<span class="exam-note-preview"><strong>Уточнение:</strong> ' + escape(note.slice(0, 140)) + (note.length > 140 ? '…' : '') + '</span>' : '') +
      '<span class="exam-open-label">' + (shortened ? 'Открыть полный текст и поля' : 'Открыть поля') + '</span>';
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
    return '<div class="exam-workspace"><section class="card form-card"><div class="visit-tools-heading"><h2>Осмотр</h2>' + button('visit-templates', 'Мои шаблоны', 'document', 'secondary compact', 'data-template-kind="exam"') + '</div><p class="section-intro">Выберите только оценённые признаки. Пустой раздел не означает норму.</p><section class="exam-measurements" aria-labelledby="exam-measurements-heading"><h3 id="exam-measurements-heading">Измеренные показатели</h3><div class="field-grid exam-vitals-grid">' + vitalFields.map(([key, title, unit]) => field('vitals.' + key, title, 'Не указано', {type: 'text', numeric: true, hint: unit})).join('') + renderBmi() + '</div></section><div class="exam-toolbar"><h3>Описание осмотра</h3><div class="actions">' + button('normal-exam', 'Осмотр без особенностей', 'check') + button('expand-exam', 'Раскрыть все', null, 'ghost') + button('collapse-exam', 'Свернуть все', null, 'ghost') + '</div></div><p class="exam-normal-hint">Кнопка у раздела заполняет его признаки; общая — весь осмотр. Уточнения и показатели сохраняются.</p>' + examCatalog.SECTIONS.map(renderExamGroup).join('') + '<div class="form-section">' + field('exam.other', 'Другие данные осмотра', 'Необязательно. Пустое поле не попадёт в черновик') + '</div></section></div>';
  }
  function renderDiagnosis() {
    const items = active().diagnoses || [];
    return '<section class="visit-diagnoses" aria-labelledby="diagnoses-heading"><div class="visit-tools-heading"><h3 id="diagnoses-heading" tabindex="-1">Диагнозы</h3>' +
      button('diagnosis-add', 'Добавить диагноз', 'plus', 'secondary compact', items.length >= core.MAX_DIAGNOSES ? 'disabled' : '') +
      '</div>' + (items.length ? '<p class="hint">Основной диагноз, сопутствующие заболевания и осложнения указываете вы. Стрелки меняют порядок в новом черновике.</p><div class="diagnosis-list">' +
        items.map((item, index) => '<article class="diagnosis-row" data-diagnosis-id="' + escape(item.id) + '"><div class="diagnosis-row-head"><h4>' + escape(core.DIAGNOSIS_LABELS[item.kind]) + '</h4><div class="actions">' +
          button('diagnosis-move', '↑', null, 'secondary compact', 'data-diagnosis-id="' + escape(item.id) + '" data-direction="-1" aria-label="Переместить диагноз выше"' + (index === 0 ? ' disabled' : '')) +
          button('diagnosis-move', '↓', null, 'secondary compact', 'data-diagnosis-id="' + escape(item.id) + '" data-direction="1" aria-label="Переместить диагноз ниже"' + (index === items.length - 1 ? ' disabled' : '')) +
          button('diagnosis-edit', 'Изменить', null, 'secondary compact', 'data-diagnosis-id="' + escape(item.id) + '"') +
          button('diagnosis-delete', 'Удалить', null, 'ghost compact', 'data-diagnosis-id="' + escape(item.id) + '"') +
          '</div></div><p class="diagnosis-text">' + escape(item.text) + '</p></article>').join('') + '</div>' : renderLegacyDiagnosis()) + '</section>';
  }
  function renderLegacyDiagnosis() {
    const id = 'field-assessment-summary';
    if (!icd) return field('assessment.summary', 'Диагноз', 'Введите диагноз самостоятельно', {hint: 'Справочник МКБ не загрузился: ' + icdLoadError + ' Можно сохранить собственную формулировку диагноза.'});
    return '<div class="field diagnosis-field"><label for="' + id + '">Диагноз</label>' +
      '<textarea id="' + id + '" data-field="assessment.summary" rows="3" maxlength="10000" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="diagnosis-options" aria-describedby="diagnosis-hint ' + id + '-error" placeholder="Начните вводить диагноз или код МКБ-10">' + escape(active().assessment.summary) + '</textarea>' +
      '<div id="diagnosis-suggestions" class="diagnosis-suggestions" hidden><p id="diagnosis-result-count" role="status" aria-live="polite"></p><div id="diagnosis-options" role="listbox" aria-label="Подсказки МКБ-10"></div></div>' +
      '<p class="hint" id="diagnosis-hint">Выберите подсказку или оставьте свою формулировку. После выбора диагноз можно уточнить. Каждый диагноз — с новой строки; выбор заменит текущую строку. ↓ ↑ — выбор, Enter — вставить, Esc — закрыть.</p>' +
      '<p class="field-error" id="' + id + '-error" hidden></p><details class="icd-source"><summary>О справочнике МКБ-10</summary><p>' + escape(icd.metadata.publisher + '. ' + icd.metadata.release) + '. Записей: ' + icd.size + '. Дата проверки: ' + escape(icd.metadata.checkedAt) + '.</p><p>' + escape(icd.metadata.note) + '</p><a href="' + escape(icd.metadata.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Источник справочника (интернет)</a></details></div>';
  }
  function closeDiagnosisSuggestions() {
    diagnosisSuggestions = null;
    for (const [controlId, prefix] of [['field-assessment-summary', 'diagnosis'], ['diagnosis-text', 'diagnosis-edit']]) {
      const control = document.getElementById(controlId);
      const panel = document.getElementById(prefix + '-suggestions');
      if (panel) panel.hidden = true;
      if (control) { control.setAttribute('aria-expanded', 'false'); control.removeAttribute('aria-activedescendant'); }
    }
  }
  function showDiagnosisSuggestions(control) {
    const prefix = control.id === 'diagnosis-text' ? 'diagnosis-edit' : 'diagnosis';
    if (!icd || !active() || !document.getElementById(prefix + '-options')) return;
    const start = control.selectionStart === 0 ? 0 : control.value.lastIndexOf('\n', control.selectionStart - 1) + 1;
    const nextLine = control.value.indexOf('\n', control.selectionStart);
    const end = nextLine === -1 ? control.value.length : nextLine;
    if (control.selectionEnd > end) { closeDiagnosisSuggestions(); return; }
    const query = control.value.slice(start, end).trim();
    if (query.length < 2) { closeDiagnosisSuggestions(); return; }
    const result = icd.search(query);
    diagnosisSuggestions = {entryId: active().id, controlId: control.id, prefix, value: control.value, start, end, items: result.items, selected: -1};
    const panel = document.getElementById(prefix + '-suggestions');
    document.getElementById(prefix + '-options').innerHTML = result.items.map((item, index) => '<div class="diagnosis-option" id="' + prefix + '-option-' + index + '" role="option" aria-selected="false" data-action="select-diagnosis" data-code="' + escape(item.code) + '"><span><strong>' + escape(item.title) + '</strong><small>' + (item.parent ? escape(item.parent.code + ' · ' + item.parent.title) : item.kind === 'category' ? 'Рубрика' : 'Подрубрика') + '</small></span><span class="diagnosis-code">' + escape(item.code) + '</span></div>').join('');
    document.getElementById(prefix + '-result-count').textContent = result.total ? (result.total > result.items.length ? 'Показано ' + result.items.length + ' из ' + result.total + '. Уточните название или код.' : 'Совпадений: ' + result.total + '. Выберите нужную формулировку.') : 'Совпадений в этом справочнике нет. Можно оставить введённый диагноз.';
    panel.hidden = false;
    document.getElementById(prefix + '-options').scrollTop = 0;
    control.setAttribute('aria-expanded', 'true'); control.removeAttribute('aria-activedescendant');
  }
  function highlightDiagnosisSuggestion(index) {
    const suggestions = diagnosisSuggestions;
    if (!suggestions || !suggestions.items.length) return;
    suggestions.selected = Math.max(0, Math.min(index, suggestions.items.length - 1));
    const options = document.getElementById(suggestions.prefix + '-options');
    Array.from(options.children).forEach((option, position) => option.setAttribute('aria-selected', String(position === suggestions.selected)));
    const selected = options.children[suggestions.selected];
    document.getElementById(suggestions.controlId).setAttribute('aria-activedescendant', selected.id);
    if (selected.offsetTop < options.scrollTop) options.scrollTop = selected.offsetTop;
    if (selected.offsetTop + selected.offsetHeight > options.scrollTop + options.clientHeight) options.scrollTop = selected.offsetTop + selected.offsetHeight - options.clientHeight;
  }
  function selectDiagnosis(code) {
    const suggestions = diagnosisSuggestions;
    const control = document.getElementById(suggestions?.controlId || 'field-assessment-summary');
    if (!suggestions || !control || !active() || suggestions.entryId !== active().id || suggestions.value !== control.value) { closeDiagnosisSuggestions(); return; }
    if (control.selectionStart < suggestions.start || control.selectionStart > suggestions.end || control.selectionEnd > suggestions.end) { showDiagnosisSuggestions(control); return; }
    const item = suggestions.items.find(item => item.code === code);
    if (!item || !requireFreshState()) return;
    const text = item.title + ' (' + item.code + ')';
    const value = control.value.slice(0, suggestions.start) + text + control.value.slice(suggestions.end);
    if (value.length > control.maxLength) { toast('Диагноз слишком длинный. Сократите текущую строку перед выбором.', true); return; }
    control.value = value;
    if (control.id === 'field-assessment-summary') handleInput({target: control});
    else { control.removeAttribute('aria-invalid'); diagnosisError(''); }
    control.focus({preventScroll: true});
    const caret = suggestions.start + text.length;
    control.setSelectionRange(caret, caret);
    closeDiagnosisSuggestions();
  }
  function diagnosisError(message) {
    const target = document.getElementById('diagnosis-error');
    target.textContent = message; target.hidden = !message;
  }
  function openDiagnosisForm(id = '') {
    const entry = active();
    if (!entry || state.view !== 'visit' || !requireFreshState()) return;
    const items = core.getDiagnoses(entry);
    const item = id ? items.find(row => row.id === id) : null;
    if (id && !item) { toast('Диагноз не найден. Откройте приём заново.', true); return; }
    if (!id && items.length >= core.MAX_DIAGNOSES) { toast('В одном приёме можно сохранить до ' + core.MAX_DIAGNOSES + ' диагнозов.', true); return; }
    closeDiagnosisSuggestions();
    diagnosisForm = {encounterId: entry.id, id, snapshot: dataSnapshot(), saving: false};
    document.getElementById('diagnosis-title').textContent = id ? 'Изменить диагноз' : 'Добавить диагноз';
    document.getElementById('diagnosis-kind').value = item?.kind || (items.some(row => row.kind === 'primary') ? 'comorbidity' : 'primary');
    const text = document.getElementById('diagnosis-text');
    text.value = item?.text || ''; text.maxLength = core.MAX_DIAGNOSIS_TEXT_LENGTH;
    text.removeAttribute('aria-invalid');
    document.getElementById('diagnosis-legacy-note').hidden = Boolean(entry.diagnoses?.length) || !entry.assessment.summary.trim();
    document.getElementById('diagnosis-lookup-note').textContent = icd ? 'Введите диагноз или код МКБ-10, выберите подсказку и уточните текст. Выбор не сохраняет запись до нажатия «Сохранить диагноз».' : 'Справочник МКБ не загрузился: ' + icdLoadError + '. Можно ввести собственную формулировку.';
    document.getElementById('diagnosis-save').disabled = false;
    diagnosisError('');
    document.getElementById('diagnosis-dialog').showModal(); text.focus();
  }
  function saveDiagnosis() {
    if (!diagnosisForm || diagnosisForm.saving) return;
    if (!requireFreshState() || diagnosisForm.snapshot !== dataSnapshot()) { diagnosisError('Данные изменились. Закройте форму, загрузите сохранённую версию и откройте диагноз заново.'); return; }
    const entry = active();
    if (!entry || entry.id !== diagnosisForm.encounterId || state.view !== 'visit') { diagnosisError('Откройте нужный приём заново.'); return; }
    diagnosisForm.saving = true; document.getElementById('diagnosis-save').disabled = true;
    try {
      const updated = core.upsertDiagnosis(entry, {kind: document.getElementById('diagnosis-kind').value, text: document.getElementById('diagnosis-text').value}, diagnosisForm.id ? {id: diagnosisForm.id} : {});
      if (!commitVisitChange(updated)) { diagnosisError(state.error || 'Не удалось сохранить диагноз. Попробуйте ещё раз.'); return; }
      document.getElementById('diagnosis-dialog').close(); diagnosisForm = null;
      render(); document.getElementById('diagnoses-heading').focus({preventScroll: true});
      toast('Диагноз сохранён. Обновите текст записи, когда будете готовы.');
    } catch (error) { diagnosisError(error.message); }
    finally { if (diagnosisForm) diagnosisForm.saving = false; document.getElementById('diagnosis-save').disabled = false; }
  }
  async function deleteDiagnosis(id) {
    if (diagnosisDeletePending || !requireFreshState() || state.view !== 'visit') return;
    const entry = active();
    const item = entry?.diagnoses?.find(row => row.id === id);
    if (!item) return;
    const snapshot = dataSnapshot();
    diagnosisDeletePending = true;
    try {
      if (!await confirmAction('Удалить диагноз?', 'Диагноз будет удалён из списка этого приёма. Сохранённый текст записи останется для вашей проверки.', 'Удалить диагноз') || !requireFreshState()) return;
      if (active()?.id !== entry.id || state.view !== 'visit' || dataSnapshot() !== snapshot) { toast('Данные изменились. Откройте диагноз заново.', true); return; }
      if (!commitVisitChange(core.removeDiagnosis(active(), id))) return;
      render(); document.getElementById('diagnoses-heading').focus({preventScroll: true});
      toast('Диагноз удалён. Проверьте сохранённый текст записи.');
    } catch (error) { toast(error.message, true); }
    finally { diagnosisDeletePending = false; }
  }
  function moveDiagnosis(id, direction) {
    if (!requireFreshState() || state.view !== 'visit' || !active()) return;
    try {
      if (!commitVisitChange(core.moveDiagnosis(active(), id, direction))) return;
      render(); document.getElementById('diagnoses-heading').focus({preventScroll: true});
    } catch (error) { toast(error.message, true); }
  }
  function renderPrescriptions() {
    const items = active().prescriptions || [];
    return '<section class="visit-prescriptions" aria-labelledby="prescriptions-heading"><div class="visit-tools-heading"><h3 id="prescriptions-heading" tabindex="-1">Назначения препаратов</h3>' +
      button('prescription-add', 'Добавить препарат', 'plus', 'secondary compact', items.length >= core.MAX_PRESCRIPTIONS ? 'disabled' : '') +
      '</div><p class="hint">Назначения и все параметры вводит врач. Пустые параметры отмечаются как незаполненные. Добавленные препараты включаются в новый черновик.</p><div id="prescription-list">' +
      (items.length ? items.map(item => '<article class="prescription-row" data-prescription-id="' + escape(item.id) + '"><div class="prescription-row-head"><h4>' + escape(item.name) + '</h4><div class="actions">' +
        button('prescription-edit', 'Изменить', null, 'secondary compact', 'data-prescription-id="' + escape(item.id) + '" aria-label="Изменить назначение: ' + escape(item.name) + '"') +
        button('prescription-delete', 'Удалить', null, 'ghost compact', 'data-prescription-id="' + escape(item.id) + '" aria-label="Удалить назначение: ' + escape(item.name) + '"') +
        '</div></div><dl class="prescription-parameters">' + prescriptionFields.slice(1, 5).map(([key, title]) => '<div><dt>' + title + '</dt><dd' + (item[key].trim() ? '' : ' class="prescription-missing"') + '>' + escape(item[key].trim() || 'Не заполнено') + '</dd></div>').join('') +
        '</dl>' + (item.note.trim() ? '<p class="prescription-note"><strong>Примечание:</strong> ' + escape(item.note) + '</p>' : '') + '</article>').join('') : '<p class="prescription-empty">Препараты пока не добавлены.</p>') +
      '</div>' + (items.length >= core.MAX_PRESCRIPTIONS ? '<p class="hint">Достигнут предел: 50 назначений в одном приёме.</p>' : '') + '</section>';
  }
  function prescriptionError(message) {
    const target = document.getElementById('prescription-error');
    target.textContent = message; target.hidden = !message;
  }
  function openPrescriptionForm(id = '') {
    const entry = active();
    if (!entry || state.view !== 'visit' || !requireFreshState()) return;
    const item = id ? entry.prescriptions?.find(row => row.id === id) : null;
    if (id && !item) { toast('Назначение не найдено. Откройте приём заново.', true); return; }
    if (!id && (entry.prescriptions?.length || 0) >= core.MAX_PRESCRIPTIONS) { toast('В одном приёме можно сохранить до 50 назначений.', true); return; }
    prescriptionForm = {encounterId: entry.id, id, saving: false};
    document.getElementById('prescription-title').textContent = id ? 'Изменить назначение' : 'Добавить препарат';
    for (const [key] of prescriptionFields) document.getElementById('prescription-' + key).value = item?.[key] || '';
    document.getElementById('prescription-name').removeAttribute('aria-invalid');
    document.getElementById('prescription-save').disabled = false;
    prescriptionError('');
    document.getElementById('prescription-dialog').showModal();
    document.getElementById('prescription-name').focus();
  }
  function commitVisitChange(entry) {
    const dateErrors = dateInputIssues(entry);
    if (dateErrors.length) {
      state.saved = false; state.error = dateErrors[0].message; updateSaveStatus(); return false;
    }
    const pending = state.pendingNew?.entry.id === entry.id;
    const encounters = pending ? state.encounters.concat(entry) : state.encounters.map(item => item.id === entry.id ? entry : item);
    const patients = pending ? state.patients.concat(state.pendingNew.patient) : state.patients;
    if (!commitEncounters(encounters, patients)) return false;
    if (pending) state.pendingNew = null;
    return true;
  }
  function savePrescription() {
    if (!prescriptionForm || prescriptionForm.saving) return;
    if (!requireFreshState()) { prescriptionError('Данные изменены в другом окне. Закройте форму и загрузите сохранённую версию.'); return; }
    const entry = active();
    if (!entry || entry.id !== prescriptionForm.encounterId || state.view !== 'visit') { prescriptionError('Этот приём уже не открыт. Закройте форму и откройте нужный приём.'); return; }
    const values = Object.fromEntries(prescriptionFields.map(([key]) => [key, document.getElementById('prescription-' + key).value]));
    if (!values.name.trim()) {
      prescriptionError('Укажите название препарата.');
      document.getElementById('prescription-name').setAttribute('aria-invalid', 'true');
      document.getElementById('prescription-name').focus();
      return;
    }
    prescriptionForm.saving = true;
    document.getElementById('prescription-save').disabled = true;
    try {
      const updated = core.upsertPrescription(entry, values, prescriptionForm.id ? {id: prescriptionForm.id} : {});
      if (!commitVisitChange(updated)) { prescriptionError(state.error || 'Не удалось сохранить назначение. Введённые значения остаются в форме; повторите сохранение.'); return; }
      document.getElementById('prescription-dialog').close(); prescriptionForm = null;
      render(); document.getElementById('prescriptions-heading').focus({preventScroll: true});
      toast('Назначение сохранено. Проверьте параметры и обновите черновик, когда будете готовы.');
    } catch (error) { prescriptionError(error.message); }
    finally {
      if (prescriptionForm) prescriptionForm.saving = false;
      document.getElementById('prescription-save').disabled = false;
    }
  }
  async function deletePrescription(id) {
    if (prescriptionDeletePending || !requireFreshState()) return;
    const entry = active();
    const item = entry?.prescriptions?.find(row => row.id === id);
    if (!item || state.view !== 'visit') return;
    prescriptionDeletePending = true;
    try {
      if (!await confirmAction('Удалить назначение?', 'Назначение «' + item.name + '» будет удалено из этого приёма. Сохранённый текст черновика останется для вашей проверки.', 'Удалить назначение') || !requireFreshState()) return;
      if (active()?.id !== entry.id || state.view !== 'visit') { toast('Откройте нужный приём заново перед удалением.', true); return; }
      if (!commitVisitChange(core.removePrescription(active(), id))) return;
      render(); document.getElementById('prescriptions-heading').focus({preventScroll: true});
      toast('Назначение удалено. Проверьте сохранённый текст черновика.');
    } catch (error) { toast(error.message, true); }
    finally { prescriptionDeletePending = false; }
  }
  function renderDraft() {
    return '<div class="draft-layout"><section class="card draft-controls"><h2>Диагноз и рекомендации</h2><p class="section-intro">Заполняет врач. Рекомендации, повторный приём и больничный включаются в текст только при заполнении или явной отметке.</p>' +
      renderDiagnosis() + renderPrescriptions() + '<div class="recommendation-templates">' + button('visit-templates', 'Мои шаблоны рекомендаций', 'document', 'secondary compact', 'data-template-kind="recommendations"') + '</div>' + field('assessment.plan', 'Рекомендации', 'Необязательно. Пустое поле не попадёт в черновик', {hint: 'Свободный текст и его шаблоны сохраняются отдельно от назначений препаратов.'}) +
      (active().assessment.followUp.trim() ? '<div class="legacy-note"><p>Сохранено из предыдущей версии. Перенесите нужное в рекомендации или выберите дату, затем очистите старый текст, если он больше не нужен.</p>' + field('assessment.followUp', 'Наблюдение из предыдущей версии', '') + '</div>' : '') +
      renderEncounterSickLeave() +
      field('assessment.returnVisitDate', 'Повторный приём', '', {type: 'date', hint: 'Оставьте дату пустой, чтобы не включать повторный приём в запись.'}) +
      '</section><section class="card draft-card"><div class="card-head"><h2>Текст записи</h2><span class="pill neutral">Редактируемый текст</span></div><div id="draft-state" class="draft-state" role="status"></div><label class="small muted" for="draft-text">Текст записи · свободное редактирование</label><textarea class="draft-editor" id="draft-text" data-field="draft.text" maxlength="100000" aria-describedby="draft-state field-draft-text-error" placeholder="Нажмите «Сформировать черновик» или начните писать здесь.">' + escape(active().draft.text) + '</textarea><p class="field-error" id="field-draft-text-error" hidden></p><div id="record-review-state" class="record-review-state"></div><p class="small muted">Это свободный демонстрационный черновик, не нормативная форма Беларуси.</p></section></div>';
  }
  function encounterContext(entry = active()) {
    return {patient: patientFor(entry), encounters: state.encounters};
  }
  function renderEncounterSickLeave() {
    const entry = active();
    const linked = core.getEncounterSickLeaveAction(patientFor(entry), entry);
    const heading = '<h3 id="visit-sick-heading" tabindex="-1">Листок нетрудоспособности</h3>';
    if (linked) {
      const {leave, event} = linked;
      const last = leave.events.at(-1).id === event.id;
      return '<section class="visit-sick-leave" aria-labelledby="visit-sick-heading">' + heading + '<div id="visit-sick-linked"><p class="visit-sick-action"><strong>' + {issue: 'Выдан', extend: 'Продлён', close: 'Закрыт'}[event.type] + '</strong> · ' + (leave.number ? 'ЛН № ' + escape(leave.number) : 'номер не указан') + '</p><p>' + (event.type === 'close' ? 'Последний день: ' + escape(dateText(event.to)) : 'Период: ' + escape(dateText(event.from)) + ' — ' + escape(dateText(event.to))) + '</p>' + renderEncounterSickLeaveDuration() +
        '<p class="hint">Сохранено вместе с журналом. Текст черновика меняется только после вашего действия.</p>' + (last ? button('visit-sick-undo', 'Отменить действие', null, 'secondary compact') : '<p class="hint">В журнале уже есть последующие действия. Для исправления сначала отмените их в обратном порядке.</p>') + '</div></section>';
    }
    return '<section class="visit-sick-leave" aria-labelledby="visit-sick-heading">' + heading + '<div class="visit-sick-actions">' +
      button('visit-sick-issue', 'Выдать новый', 'plus', 'secondary compact') + button('visit-sick-extend', 'Продлить существующий', null, 'secondary compact') + button('visit-sick-close', 'Закрыть', 'check', 'secondary compact') +
      '</div><p class="hint">Выберите действие, чтобы сохранить его сразу в приёме и журнале. Программа не оформляет официальный документ.</p>' +
      field('assessment.sickLeaveIssued', 'Отметка в приёме', '', {select: [['', 'Не отмечено — не включать'], ['no', 'Не выдавался — не включать'], ['yes', 'Выдан']], hint: 'Ручная отметка сохраняется без связи с действием в журнале. Прежние сведения доступны для переноса.'}) +
      '<div id="sickleave-period"' + (entry.assessment.sickLeaveIssued === 'yes' ? '' : ' hidden') + '>' + field('assessment.sickLeaveNumber', 'Номер листка нетрудоспособности', 'При продлении укажите прежний номер', {type: 'text'}) + '<div class="field-grid">' + field('assessment.sickLeaveFrom', 'Период: с', '', {type: 'date'}) + field('assessment.sickLeaveTo', 'По', '', {type: 'date'}) + '</div>' + renderEncounterSickLeaveDuration() + '</div></section>';
  }
  function encounterSickLeaveSummary() {
    return core.getEncounterSickLeaveSummary(active(), patientFor(active()), state.encounters);
  }
  function encounterSickLeaveHint(summary) {
    if (summary.totalDays === null) return 'Для расчёта нужны корректные начало и окончание. В расчёт обе даты и выходные включены.';
    if (core.getEncounterSickLeaveAction(patientFor(active()), active())) return 'Учтены периоды выбранного больничного по это действие включительно. Обе даты и выходные включены; пересечения считаются один раз.';
    return 'Непрерывный период: с ' + dateText(summary.from) + ' по ' + dateText(summary.to) + '. В расчёт обе даты и выходные включены; пересечения учитываются один раз. ' +
      (summary.unnumbered ? 'Без номера объединяются непрерывные периоды без номера. Укажите номер, чтобы различать больничные.' : 'Учтены непрерывные периоды с этим номером из истории пациента.');
  }
  function renderEncounterSickLeaveDuration() {
    const summary = encounterSickLeaveSummary();
    const closed = core.getEncounterSickLeaveAction(patientFor(active()), active())?.event.type === 'close';
    return '<div class="sickleave-duration"><label for="sickleave-days">Всего календарных дней</label><output id="sickleave-days" for="field-assessment-sickLeaveNumber field-assessment-sickLeaveFrom field-assessment-sickLeaveTo" aria-live="polite" aria-describedby="sickleave-current-period sickleave-days-hint">' + (summary.totalDays ?? '—') + '</output><p id="sickleave-current-period"' + (closed ? ' hidden' : '') + '>В текущем периоде: <strong>' + (summary.periodDays ?? '—') + '</strong> календ. дн.</p><p id="sickleave-days-hint">' + escape(encounterSickLeaveHint(summary)) + '</p></div>';
  }
  function updateSickLeaveDays() {
    const output = document.getElementById('sickleave-days');
    if (!output) return;
    const summary = encounterSickLeaveSummary();
    output.textContent = summary.totalDays ?? '—';
    document.querySelector('#sickleave-current-period strong').textContent = summary.periodDays ?? '—';
    document.getElementById('sickleave-days-hint').textContent = encounterSickLeaveHint(summary);
  }
  function renderModules() {
    return '<div class="page-heading"><div><h1>Модули</h1><p>Возможности и развитие МедАссистента.</p></div></div>' + demoNotice() +
      '<p class="section-intro">Во вкладке «Исследования» приёма и в карточке пациента доступны бланки и ручной ввод результатов. В карточке также доступны история и динамика. ИМТ рассчитывается в разделе «Осмотр». Отдельные калькуляторы, диспансерное наблюдение и официальные формы остаются в плане развития.</p><div class="module-grid">' + window.MedAssistModules.map((module) => '<section class="card module-card"><div class="module-head"><div class="icon-tile">' + icon(module.icon) + '</div><span class="pill neutral">' + (module.status === 'available' ? 'Доступно' : module.status === 'verification' ? 'После проверки источников' : 'Запланировано') + '</span></div><h2>' + escape(module.title) + '</h2><p>' + escape(module.description) + '</p><details><summary>' + (module.status === 'available' ? 'Как пользоваться' : 'Что потребуется для добавления') + '</summary><p>' + escape(module.requirements) + '</p></details></section>').join('') + '</div>';
  }
  function renderHelp() {
    return '<div class="page-heading"><div><h1>Помощь и данные</h1><p>Первый запуск, сохранение и границы прототипа.</p></div></div><div class="help-layout"><section class="card help-card"><h2>Анализы и исследования</h2><p>В первичном или повторном приёме откройте вкладку «Исследования»; в карточке пациента — раздел «Анализы и исследования». Нажмите «Добавить результат» и выберите ОАК, ОАМ, БАК или другое исследование. Откроется готовая форма; укажите дату и результаты. Единицы измерения заполняются только для лабораторных анализов. «Бланки анализов» открывает готовые формы напрямую. Предложенные единицы можно исправить по выданному бланку; нормы вводятся вручную. Пустые результаты не сохраняются и не попадают в запись, значение 0 сохраняется. В том же списке доступны «Другое лабораторное исследование» и «Другое инструментальное исследование» с ручным вводом названия, результата и примечания; поле единиц есть только у лабораторного исследования. Кнопка «Назад» из выбранного бланка возвращает к форме выбора, сохраняя прежний ручной ввод. Формы сохраняются только по нажатию кнопки.</p><p>Результаты, добавленные во время приёма, сохраняются и в карточке пациента. Для включения прежних результатов в приём нажмите «Выбрать из карточки» и отметьте нужные бланки или показатели; автоматического переноса в повторный приём нет. Изменение или удаление связанного результата снимает отметку проверки у связанных записей. Сохранённый текст остаётся для вашей проверки; чтобы включить актуальные результаты, заново сформируйте черновик. «Убрать из приёма» сохраняет результат в карточке.</p><p>В карточке выберите показатель, чтобы увидеть историю и динамику. График и разность доступны для числовых результатов с одинаковым названием и единицами на разные даты. Единицы не пересчитываются; текстовые результаты и результаты одного дня показываются таблицей. Нормы берутся из соответствующей строки, медицинская интерпретация не выполняется. Результаты доступны в поиске пациентов и резервной копии. Для копий с бланками или связями с приёмами нужна версия 0.15.0 или новее; отдельные результаты прежнего формата поддерживаются с 0.14.0.</p><h2>Назначения препаратов</h2><p>В разделе «Запись» нажмите «Добавить препарат». Введите название, дозировку, способ приёма, кратность, длительность и примечание, затем сохраните. Название обязательно; остальные параметры врач заполняет самостоятельно. Каждое назначение можно изменить или удалить. Новые назначения включаются при формировании черновика; сохранённый ручной текст остаётся.</p><p>При создании повторного приёма отметьте отдельные назначения для переноса. По умолчанию они выключены; постоянные препараты анамнеза, аллергии и заболевания подтверждаются отдельно. Назначения входят в резервную копию; копии с ними требуют версии 0.13.0 или новее. Шаблоны рекомендаций сохраняют только свободный текст рекомендаций.</p><h2>Возможности приёма</h2><p>В разделе «Запись» больничный можно выдать, продлить или закрыть с одновременным сохранением в журнале. При продлении и закрытии выберите конкретный листок. Чтобы исправить последнее связанное действие, отмените его в этом приёме и внесите заново.</p><p>«Предыдущий приём» открывает сведения из истории только для просмотра. «Мои шаблоны» возле осмотра и рекомендаций сохраняют ваши формулировки и применяются по нажатию. Шаблоны входят в резервную копию; копии с шаблонами или связанными действиями больничного требуют версии 0.12.0 или новее.</p><h2>Как пройти демонстрационный приём</h2><ol><li>Нажмите «Начать приём» и найдите пациента либо выберите «Новый пациент». Пустая новая форма не сохраняется; карточка появляется после первого ввода сведений. На главной также доступен вымышленный пример.</li><li>Заполните сведения о приёме, анамнез и осмотр. Вводите только вымышленные данные.</li><li>В разделе «Запись» заполните диагноз, при необходимости рекомендации, дату повторного приёма и отметку о больничном. Нажмите «Сформировать черновик».</li><li>Проверьте и отредактируйте текст. Скачайте .txt или скопируйте его.</li></ol><h2>Перелистывание разделов</h2><p>Главное меню, вкладки приёма, рубрики пациентов, периоды повторных приёмов, статусы записей на обзоре и разделы карточки переключаются с боковым перелистыванием. Команда «Проверить обновления» запускает обновлятор. В карточке открывается один раздел: «История приёмов», «Анализы и исследования» или «Журнал больничных». Для перехода нажмите вкладку, используйте стрелки влево и вправо, Home или End на выбранной вкладке либо проведите пальцем вбок по свободной области содержимого. В главном меню стрелки, Home и End перемещают фокус; Enter или пробел открывает выбранный раздел. Жесты перелистывания действуют только внутри списков и вкладок, не переключают главное меню. Ввод в полях и вертикальная прокрутка сохраняются. При включённом уменьшении анимации в системе переход происходит сразу.</p><h2>Карточка и повторный приём</h2><p>Раздел «Пациенты» содержит карточки с историей по датам. В списке видны последний приём и ближайшая предстоящая повторная явка. Пациенты с явкой сегодня или позже идут первыми, от ближайшей даты к дальней; только с прошедшей незакрытой датой — следом, без назначений — в конце. Состоявшиеся приёмы не участвуют в этом порядке. ФИО пациента можно ввести в начале вкладки «Приём» или изменить в карточке. Это одно общее поле; используйте только вымышленные фамилию, имя и отчество. Кнопка «Повторный приём» создаёт отдельную запись того же пациента. Выберите исходный приём и отметьте нужные препараты, аллергии и заболевания; нажмите «Создать приём» для подтверждения. Без отметок перенос не выполняется. При смене источника отметки сбрасываются. Возраст, пол, жалобы, осмотр, показатели и заключение заполните заново.</p><h2>Журнал больничных</h2><p>В карточке пациента откройте вкладку «Журнал больничных». Выдача, продление и закрытие сохраняются явно; автоматически по прошедшей дате больничный не закрывается. Можно изменить номер или отменить последнее действие. Общий счётчик объединяет все внесённые календарные периоды пациента: обе даты включены, пересечения учитываются один раз. Закрытие исключает дни после выбранной даты; для более позднего закрытия сначала внесите продление.</p><p>Прежние отметки видны под журналом и уже входят в общий подсчёт. Перенесите отметку в журнал, чтобы продлевать или закрывать её. Исходный приём и текст сохраняются; дальнейшие изменения ведутся отдельно. Неполные даты исключены из счётчика с предупреждением. Журнал входит в резервную копию; для её открытия нужна версия 0.11.0 или новее.</p><h2>Повторные даты и проверка записи</h2><p>Дата в конце раздела «Запись» появляется в списке «Повторные приёмы». Там доступны сегодняшние, все будущие и прошедшие даты. Прошедшая дата не означает неявку. «Начать повторный приём» создаёт связанную запись после подтверждения переноса; повторное нажатие открывает её. Отдельно отметьте «Состоялся» после фактического приёма. Изменение назначенной даты сбрасывает отметку и связь, но сохраняет запись в истории.</p><p>На вкладке «Запись» нажмите «Отметить: проверено врачом» после проверки непустого текста. Это личная отметка, не электронная подпись. Правки сведений, текста или ФИО снимают её. На главной фильтр «Черновики» показывает незавершённые записи. Статус записи и факт состоявшегося приёма независимы.</p><h2>Режимы работы</h2><p>Сейчас доступен поликлинический режим. Стационарный режим запланирован отдельно; его формы и функции будут определены на следующем этапе.</p><h2>Что делает прототип</h2><p>Собирает введённые сведения в свободный текст. Работает из локальных файлов, без аккаунта, сервера, МИС и внешних запросов приложения.</p><p>Диагноз и рекомендации вводит врач. Программа не назначает лечение и не оформляет больничные документы. Варианты осмотра — вспомогательные формулировки; источники и ограничения перечислены в EXAM-SOURCES.md. Нормативные формы Беларуси не реализованы.</p><h2>Запуск в Windows</h2><p>Распакуйте архив в постоянную папку и откройте <span class="code-path">Start-MedAssist.cmd</span>. Приложение использует установленный Edge или Chrome. Также можно открыть <span class="code-path">app/index.html</span>.</p></section><section class="card help-card"><h2>Сохранение на этом компьютере</h2><p>Изменения автоматически сохраняются в локальном хранилище текущего браузера. Статус сохранения показан в приёме. При ошибке вы увидите сообщение.</p><p>Хранение локальных HTML-файлов зависит от браузера. Перемещение папки, другой профиль или очистка данных браузера могут сделать записи недоступными. Перед этим скачайте резервную копию.</p><p>Резервная копия содержит карточки с анализами и исследованиями, связанные приёмы, отредактированные черновики и личные шаблоны. Восстановление заменит все карточки и приёмы после подтверждения.</p><div class="backup-actions">' + button('backup', 'Резервная копия', 'download', 'primary') + button('import', 'Восстановить', 'upload') + button('reset', 'Очистить демонстрационные записи', null, 'secondary') + '</div><h2>Обновление программы через интернет</h2><p>Нажмите «Проверить обновления» в верхнем меню. Откроется окно проверки; браузер может попросить разрешить его запуск. Если доступна новая версия, сохраните резервную копию, закройте окна МедАссистента и подтвердите установку в окне обновления.</p><p>Для работы кнопки запускайте программу через <span class="code-path">Start-MedAssist.cmd</span> или обычный ярлык <span class="code-path">MedAssist</span>. При открытии файла index.html напрямую потребуется повторный запуск через ярлык. Отдельный <span class="code-path">Update-MedAssist.cmd</span> остаётся запасным способом.</p><p>Обновления загружаются из публичного проекта romaick/medassist на GitHub. Скачивать и распаковывать архивы вручную не понадобится. Без интернета приёмы работают как раньше.</p><h2>Перенос записей из прежней папки</h2><p>Сначала скачайте резервную копию в старой версии. Новая версия принимает её через «Восстановить» и сохраняет старые тексты. Если файлы обновлены в той же папке и браузере, доступные старые записи загрузятся автоматически. Новые копии со статусами и планом повторных приёмов открываются в версии 0.7 и новее. Из копий версий 1 и 2 каждый приём получает отдельную карточку; карточки версии 3 сохраняются. Автоматического объединения пациентов нет.</p><h2>Только демонстрация</h2><p>Данные сохраняются без шифрования. Прототип не подготовлен для реальных медицинских записей. Используйте только вымышленные сведения.</p></section></div>';
  }

  function backupContents() {
    const includePending = pendingHasContent();
    return {
      encounters: includePending ? state.encounters.concat(state.pendingNew.entry) : state.encounters,
      patients: includePending ? state.patients.concat(state.pendingNew.patient) : state.patients,
      templates: state.templates
    };
  }
  function backupDate(value) {
    return value ? new Date(value).toLocaleString('ru-RU', {day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : 'ещё не было';
  }
  function updateBackupStatus() {
    const result = repository.readBackupInfo();
    const info = result.info;
    const status = document.getElementById('backup-status');
    if (status) {
      const html = '<h3>Последняя выгрузка: ' + escape(backupDate(info.lastExportAt)) + '</h3>' +
        (info.fileName ? '<p class="small">' + escape(info.fileName) + '</p>' : '') +
        '<p class="small">Эта дата означает подготовку копии для скачивания. Проверьте, что файл сохранён на компьютере.</p>' +
        (!result.ok ? '<p class="field-error" role="alert">' + escape(result.error) + '</p>' : '');
      if (status.innerHTML !== html) status.innerHTML = html;
    }
    const reminder = document.getElementById('backup-reminder');
    if (!reminder) return;
    const hasData = Boolean(state.encounters.length || state.patients.length || state.templates.length || pendingHasContent());
    reminder.hidden = state.view !== 'home' || !repository.backupReminderDue(info, new Date().toISOString(), hasData);
    if (reminder.hidden) return;
    const html = '<div><strong>' + (info.lastExportAt ? 'Пора сохранить резервную копию' : 'Сохраните первую резервную копию') +
      '</strong><p class="small">' + (info.lastExportAt ? 'Последняя выгрузка: ' + escape(backupDate(info.lastExportAt)) + '.' : 'Файл позволит восстановить карточки, записи и ваши шаблоны.') +
      '</p>' + (!result.ok ? '<p class="field-error">' + escape(result.error) + '</p>' : '') +
      '</div><div class="backup-reminder-actions"><button class="button secondary" data-action="backup">Скачать копию</button><button class="button ghost" data-action="backup-later">Напомнить завтра</button></div>';
    if (reminder.innerHTML !== html) reminder.innerHTML = html;
  }
  function exportBackup() {
    let message;
    let failed = false;
    try {
      const contents = backupContents();
      const text = core.serializeBundle(contents.encounters, contents.patients, contents.templates);
      const fileName = 'MedAssist-backup-' + localDate() + '.json';
      download(text, fileName, 'application/json');
      const result = repository.recordBackupExport({lastExportAt: new Date().toISOString(), fileName});
      failed = !result.ok;
      message = result.ok ? 'Копия подготовлена для скачивания. Проверьте, что файл сохранён на компьютере.' :
        'Копия подготовлена для скачивания, но дата выгрузки не записана. ' + result.error;
    } catch (error) {
      failed = true;
      message = 'Копия не подготовлена: ' + error.message;
    }
    updateBackupStatus();
    if (restorePreview) document.getElementById('restore-backup-status').textContent = message;
    toast(message, failed);
  }
  function dataSnapshot() {
    return JSON.stringify({
      memory: [state.encounters, state.patients, state.templates, state.pendingNew],
      disk: repository.WATCHED_KEYS.map(key => localStorage.getItem(key))
    });
  }
  function restoreError(message, block = false) {
    const element = document.getElementById('restore-preview-error');
    element.textContent = message; element.hidden = !message;
    document.getElementById('dialog-accept').disabled = block;
  }
  function renderRestorePatients() {
    if (!restorePreview) return;
    const query = document.getElementById('restore-patient-search').value.trim().toLocaleLowerCase('ru');
    const patients = restorePreview.summary.patients.filter(patient =>
      (patient.label + ' ' + patient.id).toLocaleLowerCase('ru').includes(query));
    document.getElementById('restore-patient-count').textContent = 'Найдено: ' + patients.length + ' из ' + restorePreview.summary.patientCount;
    document.getElementById('restore-patients').innerHTML = patients.length ? '<ul>' + patients.map(patient =>
      '<li><strong>' + escape(patient.label || 'ФИО не указано') + '</strong><span class="small">Код: ' + escape(patient.id) +
      ' · Приёмов: ' + patient.encounterCount + (patient.lastVisitDate ? ' · Последний: ' + escape(dateText(patient.lastVisitDate)) : '') +
      '</span></li>').join('') + '</ul>' : '<p class="small">Пациенты не найдены.</p>';
  }
  function openRestorePreview(bundle, fileName) {
    if (!requireFreshState()) return;
    const current = backupContents();
    const before = repository.summarizeBackup(core.parseBundle(core.serializeBundle(current.encounters, current.patients, current.templates)));
    const summary = repository.summarizeBackup(bundle);
    const snapshot = dataSnapshot();
    const dialog = document.getElementById('confirmation');
    const accept = document.getElementById('dialog-accept');
    const cancel = document.getElementById('dialog-cancel');
    const area = document.getElementById('restore-preview-area');
    const close = () => {
      accept.removeEventListener('click', replace);
      cancel.removeEventListener('click', cancelPreview);
      dialog.removeEventListener('cancel', cancelPreview);
      area.hidden = true; dialog.classList.remove('restore-preview'); accept.disabled = false;
      restorePreview = null; dialog.close();
    };
    const cancelPreview = event => { event.preventDefault(); close(); };
    const replace = () => {
      try {
        if (state.externalChange || snapshot !== dataSnapshot()) {
          restoreError('Данные изменились после открытия копии. Закройте просмотр, загрузите сохранённую версию и выберите файл заново.', true);
          return;
        }
        const result = repository.reset(bundle.encounters, bundle.patients, bundle.templates || []);
        if (!result.ok) { restoreError(result.error); return; }
        state.encounters = bundle.encounters; state.patients = bundle.patients; state.templates = bundle.templates || [];
        state.activeId = null; state.patientId = null; state.pendingNew = null; state.externalChange = false; state.birthDateInputs = {}; state.visitDateInputs = {};
        state.saved = true; state.error = null; state.migrated = false;
        close(); navigate('home'); toast('Резервная копия восстановлена.');
      } catch (error) { restoreError('Восстановление не выполнено: ' + error.message); }
    };
    restorePreview = {summary, close};
    document.getElementById('dialog-title').textContent = 'Восстановить резервную копию?';
    document.getElementById('dialog-message').textContent = 'Посмотрите содержимое файла. После подтверждения все текущие карточки, приёмы, черновики и шаблоны будут заменены данными из этой копии.';
    document.getElementById('restore-file-info').textContent = fileName + ' · Выгружено: ' + backupDate(summary.exportedAt);
    const range = item => item.firstVisitDate ? dateText(item.firstVisitDate) + ' — ' + dateText(item.lastVisitDate) : 'Нет приёмов';
    const rows = [['Пациенты', 'patientCount'], ['Приёмы', 'encounterCount'], ['Личные шаблоны', 'templateCount'],
      ['Результаты и показатели', 'investigationCount'], ['Записи больничных', 'sickLeaveCount']];
    document.getElementById('restore-summary').innerHTML = '<table><caption>Сравнение данных</caption><thead><tr><th scope="col">Содержимое</th><th scope="col">Сейчас</th><th scope="col">В файле</th></tr></thead><tbody>' +
      rows.map(([label, key]) => '<tr><th scope="row">' + label + '</th><td>' + before[key] + '</td><td>' + summary[key] + '</td></tr>').join('') +
      '<tr><th scope="row">Даты приёмов</th><td>' + escape(range(before)) + '</td><td>' + escape(range(summary)) + '</td></tr></tbody></table>';
    document.getElementById('restore-patient-search').value = '';
    document.getElementById('restore-backup-status').textContent = '';
    renderRestorePatients(); restoreError('');
    accept.textContent = 'Заменить текущие данные';
    area.hidden = false; dialog.classList.add('restore-preview');
    accept.addEventListener('click', replace);
    cancel.addEventListener('click', cancelPreview);
    dialog.addEventListener('cancel', cancelPreview);
    dialog.showModal(); cancel.focus();
  }
  function updateValidation() {
    const entry = active();
    if (!entry) return [];
    const errors = core.validateEncounter(entry).concat(dateInputIssues(entry));
    app.querySelectorAll('[data-field]').forEach((control) => {
      const error = errors.find((item) => item.field === control.dataset.field);
      control.setAttribute('aria-invalid', error ? 'true' : 'false');
      const message = document.getElementById('field-' + control.dataset.field.replaceAll('.', '-') + '-error');
      if (message) { message.textContent = error ? error.message : ''; message.hidden = !error; }
    });
    const birth = document.getElementById('patient-birth-date');
    if (birth) {
      const error = errors.find(item => item.field === 'patient.birthDate');
      birth.setAttribute('aria-invalid', String(Boolean(error)));
      document.getElementById('patient-birth-date-error').textContent = error?.message || '';
      document.getElementById('patient-birth-date-error').hidden = !error;
    }
    return errors;
  }
  function updateSaveStatus() {
    const status = document.getElementById('save-status');
    if (status) {
      const empty = state.pendingNew && !pendingHasContent() && !state.error;
      status.className = 'save-indicator' + (state.saved || empty ? '' : ' failed');
      status.innerHTML = icon(empty || !state.saved ? 'info' : 'check') + (empty ? 'Пустая форма · ещё не сохранена' : state.saved ? 'Сохранено в этом браузере' : 'Изменения не сохранены');
    }
    const cardButton = app.querySelector('.visit-context [data-action="patient"]');
    if (cardButton) cardButton.disabled = Boolean(state.pendingNew);
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
        try { stale = entry.draft.sourceFingerprint !== core.fingerprint(entry, encounterContext(entry)); }
        catch (error) { stale = true; }
        message = stale ? 'Сведения приёма или учтённые периоды больничного изменились после генерации. Проверьте текст; повторная генерация заменит ручные правки.' : 'Черновик можно редактировать. Ручные правки сохраняются отдельно от полей формы.';
      }
    }
    target.textContent = message;
    target.className = 'draft-state' + (stale ? ' stale' : '');
  }
  function pendingHasContent() {
    if (!state.pendingNew) return false;
    const {patient, entry, initialDate} = state.pendingNew;
    return Boolean(patient.label.trim() || patient.birthDate || state.birthDateInputs[patient.id]?.value || state.visitDateInputs[entry.id] || entry.age.trim() || entry.sex.trim() || entry.reason.trim() || entry.visitDate !== initialDate ||
      [entry.history, entry.exam, entry.examSelections, entry.vitals, entry.assessment].some(group => Object.values(group).some(value => value.trim())) || entry.draft.text.trim());
  }
  function discardEmptyForm() {
    if (!state.pendingNew || pendingHasContent()) return;
    if (state.activeId === state.pendingNew.entry.id) state.activeId = null;
    if (state.patientId === state.pendingNew.patient.id) state.patientId = null;
    state.pendingNew = null;
  }
  function canReplaceActive() {
    if (!state.pendingNew || !pendingHasContent()) return true;
    toast('Новый приём ещё не сохранён. Вернитесь в текущий приём; сохраните резервную копию или устраните ошибку сохранения.', true);
    return false;
  }
  function persist() {
    if (state.externalChange) { state.saved = false; updateSaveStatus(); return; }
    const dateIssues = dateInputIssues();
    if (dateIssues.length) { state.saved = false; state.error = dateIssues[0].message + ' Исправьте дату: введённое значение пока не сохранено.'; updateSaveStatus(); return; }
    if (state.pendingNew && !pendingHasContent()) { updateSaveStatus(); return; }
    const encounters = state.pendingNew ? state.encounters.concat(state.pendingNew.entry) : state.encounters;
    const patients = state.pendingNew ? state.patients.concat(state.pendingNew.patient) : state.patients;
    const result = repository.save(encounters, patients, state.templates);
    state.saved = result.ok;
    state.error = result.error;
    if (result.ok && state.pendingNew) { state.encounters = encounters; state.patients = patients; state.pendingNew = null; }
    updateSaveStatus();
  }
  function finishReviewTarget(field) {
    const section = field.startsWith('history.') ? 'history' :
      /^(exam\.|examSelections\.|vitals\.)/.test(field) ? 'exam' :
        /^(assessment\.|draft\.|prescriptions)/.test(field) ? 'draft' :
          field.startsWith('investigation') ? 'investigations' : 'basic';
    const titles = {
      visitDate: 'Дата приёма', age: 'Возраст', sex: 'Пол', 'patient.birthDate': 'Дата рождения',
      'assessment.sickLeaveFrom': 'Начало больничного', 'assessment.sickLeaveTo': 'Окончание больничного',
      'assessment.sickLeaveIssued': 'Отметка о больничном', 'assessment.returnVisitDate': 'Повторный приём',
      'assessment.summary': 'Диагноз', 'assessment.plan': 'Рекомендации', 'draft.text': 'Текст записи'
    };
    const label = titles[field] ||
      (field.startsWith('vitals.') ? vitalFields.find(item => 'vitals.' + item[0] === field)?.[1] : null) ||
      (field.startsWith('history.') ? historyFields.find(item => 'history.' + item[0] === field)?.[1] : null) ||
      tabs.find(item => item[0] === section)[1];
    return {section, label};
  }
  function finishReviewIssues(entry) {
    const errors = core.validateEncounter(entry).concat(dateInputIssues(entry));
    const issues = errors.map(error => ({...error, ...finishReviewTarget(error.field)}));
    if (!entry.draft.text.trim()) {
      issues.push({field: 'draft.text', section: 'draft', label: 'Текст записи', message: 'Текст записи пуст. Можно сформировать черновик или написать текст вручную.'});
    } else if (entry.draft.sourceFingerprint && !errors.length) {
      try {
        if (entry.draft.sourceFingerprint !== core.fingerprint(entry, encounterContext(entry)))
          issues.push({field: 'draft.text', section: 'draft', label: 'Текст записи', message: 'Сведения изменились после формирования черновика. Проверьте текст: последние изменения могли в него не попасть.'});
      } catch (error) {
        issues.push({field: 'draft.text', section: 'draft', label: 'Текст записи', message: 'Не удалось проверить соответствие текста полям: ' + error.message});
      }
    }
    if (entry.assessment.sickLeaveIssued === 'yes' && !core.getEncounterSickLeaveAction(patientFor(entry), entry)) {
      for (const field of ['sickLeaveFrom', 'sickLeaveTo']) {
        if (!entry.assessment[field])
          issues.push({field: 'assessment.' + field, ...finishReviewTarget('assessment.' + field), message: 'Отмечена выдача больничного, но ' + (field === 'sickLeaveFrom' ? 'дата начала' : 'дата окончания') + ' не указана.'});
      }
    }
    return issues;
  }
  function focusFinishReviewIssue(issue) {
    navigate('visit', issue.section);
    const control = Array.from(app.querySelectorAll('[data-field]')).find(node => node.dataset.field === issue.field) ||
      (issue.field.startsWith('prescriptions') ? document.getElementById('prescription-list') : null) ||
      document.getElementById('visit-form-panel');
    for (let parent = control.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    if (!control.matches('input, select, textarea, button, [tabindex]')) control.tabIndex = -1;
    control.focus();
    control.scrollIntoView({block: 'center'});
  }
  function finishReviewSnapshot(entry) {
    return JSON.stringify({entry, patient: patientFor(entry), encounters: state.encounters});
  }
  function openFinishReview(entry, issues) {
    const dialog = document.getElementById('finish-review-dialog');
    const list = document.getElementById('finish-review-list');
    const accept = document.getElementById('finish-review-accept');
    const cancel = document.getElementById('finish-review-cancel');
    const error = document.getElementById('finish-review-error');
    const snapshot = finishReviewSnapshot(entry);
    let completing = false;
    list.innerHTML = issues.map((issue, index) => '<li><div><strong>' + escape(issue.label) + '</strong><p>' + escape(issue.message) + '</p></div><button class="button secondary compact" type="button" data-finish-issue="' + index + '" aria-label="Перейти: ' + escape(issue.label) + '">Перейти</button></li>').join('');
    error.hidden = true;
    error.textContent = '';
    accept.disabled = false;
    const warn = message => { error.textContent = message; error.hidden = false; };
    const changedElsewhere = () => {
      if (!state.externalChange) return;
      warn('Данные изменены в другом окне. Завершение не выполнено. Вернитесь к записи и загрузите сохранённую версию.');
      accept.disabled = true;
    };
    const goBack = () => {
      dialog.close();
      if (state.view === 'visit' && active() === entry) focusFinishReviewIssue({field: 'draft.text', section: 'draft'});
    };
    const cancelReview = event => { event.preventDefault(); goBack(); };
    const goToIssue = event => {
      const target = event.target.closest('[data-finish-issue]');
      if (!target) return;
      if (state.view !== 'visit' || active() !== entry) { warn('Текущий приём изменился. Вернитесь к записи и повторите проверку.'); return; }
      dialog.close();
      focusFinishReviewIssue(issues[Number(target.dataset.finishIssue)]);
    };
    const complete = () => {
      if (completing) return;
      if (!requireFreshState()) { changedElsewhere(); return; }
      if (state.view !== 'visit' || active() !== entry || finishReviewSnapshot(entry) !== snapshot ||
          JSON.stringify(finishReviewIssues(entry)) !== JSON.stringify(issues)) {
        warn('Сведения изменились после открытия проверки. Вернитесь к записи и нажмите «Завершить приём» ещё раз.');
        accept.disabled = true;
        return;
      }
      completing = true;
      accept.disabled = true;
      if (saveFinishedVisit(entry)) {
        dialog.close();
        document.getElementById('main').focus({preventScroll: true});
      } else {
        completing = false;
        accept.disabled = false;
        warn(state.error || 'Не удалось сохранить приём. Данные остаются в форме. Устраните ошибку и повторите попытку.');
      }
    };
    const cleanup = () => {
      accept.removeEventListener('click', complete);
      cancel.removeEventListener('click', goBack);
      list.removeEventListener('click', goToIssue);
      dialog.removeEventListener('cancel', cancelReview);
      window.removeEventListener('storage', changedElsewhere);
    };
    accept.addEventListener('click', complete);
    cancel.addEventListener('click', goBack);
    list.addEventListener('click', goToIssue);
    dialog.addEventListener('cancel', cancelReview);
    dialog.addEventListener('close', cleanup, {once: true});
    window.addEventListener('storage', changedElsewhere);
    dialog.showModal();
    cancel.focus();
  }
  function finishVisit() {
    const entry = active();
    if (state.view !== 'visit' || !entry || document.getElementById('finish-review-dialog').open || !requireFreshState()) return;
    pager.invalidate();
    if (state.pendingNew && !pendingHasContent()) {
      discardEmptyForm();
      navigate('home');
      toast('Пустой приём закрыт. Карточка пациента не создана.');
      return;
    }
    const issues = finishReviewIssues(entry);
    if (issues.length) { openFinishReview(entry, issues); return; }
    saveFinishedVisit(entry);
  }
  function saveFinishedVisit(entry) {
    if (state.view !== 'visit' || active() !== entry || !requireFreshState()) return false;
    persist();
    if (!state.saved) {
      toast(state.error || 'Не удалось сохранить приём. Оставьте форму открытой и повторите попытку.', true);
      return false;
    }
    state.activeId = null;
    state.patientId = entry.patientId;
    state.patientTab = 'history';
    state.patientEditOpen = false;
    navigate('patient');
    toast('Приём сохранён в истории пациента.');
    return true;
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
    if (view !== 'visit') discardEmptyForm();
    if (view !== 'patient') state.patientEditOpen = false;
    state.view = view;
    if (tab) state.tab = tab;
    render();
    document.getElementById('main').focus({preventScroll: true});
    window.scrollTo({top: 0});
  }
  function createNewVisit(demonstration = false) {
    if (!canReplaceActive() || !requireFreshState()) return false;
    if (state.encounters.length >= 500) { toast('В прототипе можно хранить до 500 приёмов. Скачайте резервную копию перед очисткой.', true); return false; }
    if (state.patients.length >= core.MAX_PATIENTS) { toast('Достигнут лимит 500 карточек. Скачайте резервную копию перед очисткой.', true); return false; }
    const patient = core.createPatient();
    const entry = demonstration ? core.createDemoEncounter({patientId: patient.id}) : core.createEncounter({patientId: patient.id});
    discardEmptyForm();
    state.pendingNew = {patient, entry, initialDate: entry.visitDate};
    state.patientId = patient.id; state.activeId = entry.id;
    if (demonstration) persist();
    navigate('visit', 'basic');
    return true;
  }
  function switchMainPage(view) {
    const navigation = document.getElementById('main-navigation');
    const choices = Array.from(navigation.querySelectorAll('.pager-tab'), item => item.dataset.action);
    const to = choices.indexOf(view);
    if (to < 0) return;
    const before = state.view;
    let applied = false;
    return pager.transition({
      from: choices.indexOf(before === 'patient' ? 'patients' : before), to,
      viewport: document.getElementById('main'), tabList: navigation,
      getViewport: () => document.getElementById('main'), getTabList: () => document.getElementById('main-navigation'),
      update: () => {
        if (state.view !== before) return;
        if (view === 'new') applied = createNewVisit();
        else {
          navigate(view);
          applied = true;
        }
      },
      focus: () => {
        if (applied) document.querySelector('#main-navigation [aria-current="page"]')?.focus({preventScroll: true});
      }
    });
  }
  function switchVisitTab(key) {
    const to = tabs.findIndex(([id]) => id === key);
    if (state.view !== 'visit' || to < 0) return;
    const encounterId = active()?.id;
    pager.transition({
      from: tabs.findIndex(([id]) => id === state.tab), to,
      viewport: app.querySelector('.current-visit-form'), tabList: app.querySelector('.tab-bar'),
      getViewport: () => app.querySelector('.current-visit-form'), getTabList: () => app.querySelector('.tab-bar'),
      update: () => {
        if (state.view !== 'visit' || active()?.id !== encounterId) return;
        state.tab = key; render(); window.scrollTo({top: 0});
      },
      focus: () => document.getElementById('visit-tab-' + key)?.focus({preventScroll: true})
    });
  }
  function switchPatientCategory(key) {
    const to = patientCategories.findIndex(([id]) => id === key);
    if (state.view !== 'patients' || to < 0) return;
    pager.transition({
      from: patientCategories.findIndex(([id]) => id === state.patientCategory), to,
      viewport: document.getElementById('patient-list'), tabList: document.getElementById('patient-categories'),
      getViewport: () => document.getElementById('patient-list'), getTabList: () => document.getElementById('patient-categories'),
      update: () => {
        if (state.view !== 'patients') return;
        state.patientCategory = key;
        state.patientFilters.sick = 'all';
        state.patientFilters.sort = key === 'sick' ? 'sick' : 'return';
        render();
      },
      focus: () => document.getElementById('patient-category-' + key)?.focus({preventScroll: true})
    });
  }
  function switchPatientTab(key) {
    const to = patientModules.findIndex(module => module.id === key);
    if (state.view !== 'patient' || to < 0) return;
    const patientId = state.patientId;
    pager.transition({
      from: patientModules.findIndex(module => module.id === state.patientTab), to,
      viewport: document.getElementById('patient-module-panel'), tabList: app.querySelector('.patient-tabs'),
      getViewport: () => document.getElementById('patient-module-panel'), getTabList: () => app.querySelector('.patient-tabs'),
      update: () => {
        if (state.view !== 'patient' || state.patientId !== patientId) return;
        state.patientTab = key; render();
      },
      focus: () => document.getElementById('patient-tab-' + key)?.focus({preventScroll: true})
    });
  }
  function switchFollowupFilter(key) {
    const to = followupBuckets.findIndex(([id]) => id === key);
    if (state.view !== 'followups' || to < 0) return;
    return pager.transition({
      from: followupBuckets.findIndex(([id]) => id === state.followupFilter), to,
      viewport: document.getElementById('followup-list'), tabList: document.getElementById('followup-filters'),
      getViewport: () => document.getElementById('followup-list'), getTabList: () => document.getElementById('followup-filters'),
      update: () => {
        if (state.view !== 'followups') return;
        state.followupFilter = key; refreshFollowups();
      },
      focus: () => document.getElementById('followup-filter-' + key)?.focus({preventScroll: true})
    });
  }
  function switchRecordFilter(key) {
    const to = recordBuckets.findIndex(([id]) => id === key);
    if (state.view !== 'home' || to < 0) return;
    return pager.transition({
      from: recordBuckets.findIndex(([id]) => id === state.recordFilter), to,
      viewport: document.getElementById('visit-list'), tabList: document.getElementById('record-filters'),
      getViewport: () => document.getElementById('visit-list'), getTabList: () => document.getElementById('record-filters'),
      update: () => {
        if (state.view !== 'home') return;
        state.recordFilter = key; refreshRecords();
      },
      focus: () => document.getElementById('record-filter-' + key)?.focus({preventScroll: true})
    });
  }
  function bindPageNavigation() {
    app.querySelectorAll('.pager-tabs').forEach(list => pager.decorateTabs(list));
    if (state.view === 'visit') {
      pager.bindSwipe(app.querySelector('.current-visit-form'), direction => {
        const next = tabs[tabs.findIndex(([id]) => id === state.tab) + direction];
        if (next) switchVisitTab(next[0]);
      });
    } else if (state.view === 'patients') {
      pager.bindSwipe(document.getElementById('patient-list'), direction => {
        const next = patientCategories[patientCategories.findIndex(([id]) => id === state.patientCategory) + direction];
        if (next) switchPatientCategory(next[0]);
      });
    } else if (state.view === 'patient') {
      pager.bindSwipe(document.getElementById('patient-module-panel'), direction => {
        const next = patientModules[patientModules.findIndex(module => module.id === state.patientTab) + direction];
        if (next) switchPatientTab(next.id);
      });
    } else if (state.view === 'followups') {
      pager.bindSwipe(document.getElementById('followup-list'), direction => {
        const next = followupBuckets[followupBuckets.findIndex(([id]) => id === state.followupFilter) + direction];
        if (next) switchFollowupFilter(next[0]);
      });
    } else if (state.view === 'home') {
      pager.bindSwipe(document.getElementById('visit-list'), direction => {
        const next = recordBuckets[recordBuckets.findIndex(([id]) => id === state.recordFilter) + direction];
        if (next) switchRecordFilter(next[0]);
      });
    }
  }
  async function handleAction(action, target) {
    if (target.closest('#main-navigation') && action !== 'check-updates') return switchMainPage(action);
    if (action === 'finish-visit') { finishVisit(); return; }
    if (action === 'patient-history') { switchPatientTab('history'); return; }
    if (action === 'investigations') { switchPatientTab('investigations'); return; }
    if (action === 'investigation-add') { openInvestigationForm(); return; }
    if (action === 'investigation-edit') { openInvestigationForm(target.dataset.investigationId); return; }
    if (action === 'investigation-delete') { await deleteInvestigation(target.dataset.investigationId); return; }
    if (action === 'investigation-report-add') { openInvestigationReport(); return; }
    if (action === 'investigation-report-edit') { openInvestigationReport(target.dataset.reportId); return; }
    if (action === 'investigation-report-delete') { await deleteInvestigationReport(target.dataset.reportId); return; }
    if (action === 'investigation-attach') { openInvestigationAttach(); return; }
    if (action === 'investigation-detach') { await detachInvestigation(target); return; }
    if (action === 'diagnosis-add') { openDiagnosisForm(); return; }
    if (action === 'diagnosis-edit') { openDiagnosisForm(target.dataset.diagnosisId); return; }
    if (action === 'diagnosis-delete') { await deleteDiagnosis(target.dataset.diagnosisId); return; }
    if (action === 'diagnosis-move') { moveDiagnosis(target.dataset.diagnosisId, Number(target.dataset.direction)); return; }
    if (action === 'prescription-add') { openPrescriptionForm(); return; }
    if (action === 'prescription-edit') { openPrescriptionForm(target.dataset.prescriptionId); return; }
    if (action === 'prescription-delete') { await deletePrescription(target.dataset.prescriptionId); return; }
    if (action === 'visit-templates') { openVisitTemplates(target.dataset.templateKind); return; }
    if (action === 'previous-visit') {
      state.previousOpen = !state.previousOpen; refreshPreviousVisit();
      if (state.previousOpen) {
        document.getElementById('previous-visit-select')?.focus({preventScroll: true});
        if (window.matchMedia('(max-width:1150px)').matches) document.getElementById('previous-visit-panel').scrollIntoView({block: 'start'});
      }
      else app.querySelector('.visit-heading [data-action="previous-visit"]')?.focus({preventScroll: true});
      return;
    }
    if (['visit-sick-issue', 'visit-sick-extend', 'visit-sick-close'].includes(action)) { openEncounterSickLeaveForm(action.slice(11)); return; }
    if (action === 'visit-sick-undo') {
      const entry = active();
      if (!requireFreshState() || state.view !== 'visit' || !entry) return;
      const linked = core.getEncounterSickLeaveAction(patientFor(entry), entry);
      if (!linked || linked.leave.events.at(-1).id !== linked.event.id) { toast('Можно отменить только последнее действие больничного.', true); return; }
      if (!await confirmAction('Отменить действие с больничным?', 'Действие будет удалено из журнала и полей этого приёма. Сохранённый текст останется для вашей проверки. Остальные периоды сохранятся.', 'Отменить действие') || !requireFreshState()) return;
      try {
        const pair = core.undoEncounterSickLeave(patientFor(entry), entry, state.encounters);
        if (!commitEncounterSickLeave(pair)) return;
        render(); document.getElementById('visit-sick-heading').focus({preventScroll: true});
        toast('Действие отменено. Проверьте сохранённый текст записи.');
      } catch (error) { toast(error.message, true); }
      return;
    }
    if (action === 'sick-journal') { switchPatientTab('sick'); return; }
    if (['sick-issue', 'sick-extend', 'sick-close', 'sick-adopt', 'sick-number'].includes(action)) { openSickLeaveForm(action.slice(5), target); return; }
    if (action === 'sick-undo') {
      if (!requireFreshState() || state.view !== 'patient' || !canReplaceActive()) return;
      if (!state.saved) { persist(); if (!state.saved) return; }
      const patient = selectedPatient();
      const leave = patient.sickLeaves?.find(item => item.id === target.dataset.leaveId);
      if (!leave) return;
      if (leave.events.at(-1).encounterId) { toast('Откройте связанный приём, чтобы отменить действие одновременно в записи и журнале.', true); return; }
      const message = leave.events.length === 1 ? 'Выдача будет удалена из журнала. Исходная отметка в приёме, если она есть, снова будет учитываться отдельно.' : 'Последнее действие будет удалено из журнала. Статус и число дней пересчитаются по оставшимся действиям.';
      if (!await confirmAction('Отменить последнее действие с больничным?', message + ' Сохранённые приёмы и их тексты не меняются.', 'Отменить действие') || !requireFreshState()) return;
      const updated = core.undoSickLeaveAction(patient, leave.id);
      if (!commitEncounters(state.encounters, state.patients.map(item => item.id === patient.id ? updated : item))) return;
      render(); focusSickLeaveJournal(); toast('Последнее действие отменено.'); return;
    }
    if (action === 'select-diagnosis') { selectDiagnosis(target.dataset.code); return; }
    if (['new', 'example', 'open', 'repeat', 'start-followup', 'edit-patient-information'].includes(action) && !canReplaceActive()) return;
    if (action === 'edit-patient-information') {
      if (state.view !== 'patient' || !requireFreshState()) return;
      const entry = patientHistory(state.patientId)[0];
      if (!entry || entry.id !== target.dataset.id) return;
      state.activeId = entry.id; navigate('visit', 'history'); return;
    }
    if (action === 'edit-patient' || action === 'finish-patient-edit') {
      if (state.view !== 'patient' || !requireFreshState()) return;
      const opening = action === 'edit-patient';
      if (!opening && state.birthDateInputs[state.patientId]) {
        toast(state.birthDateInputs[state.patientId].error, true);
        document.getElementById('patient-birth-date').focus(); return;
      }
      if (!opening && !state.saved) {
        persist();
        if (!state.saved) { toast('Сведения пациента пока не сохранены. Оставьте окно открытым и сохраните резервную копию.', true); return; }
      }
      state.patientEditOpen = opening;
      document.getElementById('patient-edit-panel').hidden = !opening;
      const editButton = app.querySelector('[data-action="edit-patient"]');
      editButton.setAttribute('aria-expanded', String(opening));
      (opening ? document.getElementById('patient-label') : editButton).focus({preventScroll: true});
      return;
    }
    if (action === 'resume-visit') {
      const entry = homeCurrentEncounter();
      if (!entry || entry.id !== target.dataset.id) return;
      const tab = entry.id === state.activeId ? state.tab : 'basic';
      state.activeId = entry.id; navigate('visit', tab); return;
    }
    if (action === 'home-followups') { state.followupFilter = 'today'; navigate('followups'); return; }
    if (action === 'start-visit') { navigate('patients'); document.getElementById('patient-search').focus({preventScroll: true}); return; }
    if (action === 'check-updates') {
      if (!updateUrl) { document.getElementById('update-help').showModal(); return; }
      window.location.assign(updateUrl);
      toast('Если браузер запросит разрешение, нажмите «Открыть». Результат проверки появится в отдельном окне.');
      return;
    }
    if (['home', 'patients', 'followups', 'help', 'modules', 'visit'].includes(action)) { navigate(action); return; }
    if (action === 'patient-toggle-filters') {
      state.patientFiltersOpen = !state.patientFiltersOpen;
      document.getElementById('patient-filter-panel').hidden = !state.patientFiltersOpen;
      target.setAttribute('aria-expanded', String(state.patientFiltersOpen));
      target.textContent = state.patientFiltersOpen ? 'Скрыть фильтры' : 'Фильтры'; return;
    }
    if (action === 'patient-category') {
      switchPatientCategory(target.dataset.category); return;
    }
    if (action === 'patient-reset-filters') {
      state.patientSearch = ''; state.patientFilters = defaultPatientFilters(state.patientCategory);
      render(); document.getElementById('patient-search').focus({preventScroll: true}); return;
    }
    if (action === 'record-filter') return switchRecordFilter(target.dataset.filter);
    if (action === 'followup-filter') return switchFollowupFilter(target.dataset.filter);
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
      const pending = state.pendingNew?.entry.id === source.id;
      const encounters = pending ? state.encounters.concat(updated) : state.encounters.map(entry => entry.id === source.id ? updated : entry);
      const patients = pending ? state.patients.concat(state.pendingNew.patient) : state.patients;
      if (!commitEncounters(encounters, patients)) return;
      if (pending) state.pendingNew = null;
      render(); toast(reviewed ? 'Запись отмечена: проверено врачом.' : 'Запись возвращена в черновики.'); return;
    }
    if (action === 'patient') { state.patientId = target.dataset.patientId; state.patientTab = 'history'; state.patientEditOpen = false; navigate('patient'); return; }
    if (action === 'repeat') {
      if (state.externalChange) { toast('Сначала загрузите сохранённую версию: данные изменились в другом окне.', true); return; }
      openRepeatDialog(); return;
    }
    if (action === 'tab') { switchVisitTab(target.dataset.tab); return; }
    if (action === 'new' || action === 'example') {
      createNewVisit(action === 'example'); return;
    }
    if (action === 'open') { discardEmptyForm(); state.activeId = target.dataset.id; navigate('visit', target.dataset.tab === 'draft' ? 'draft' : 'basic'); return; }
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
      entry.draft = {text: core.generateDraft(entry, encounterContext(entry)), generatedAt: new Date().toISOString(), sourceFingerprint: core.fingerprint(entry, encounterContext(entry))};
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
      exportBackup(); return;
    }
    if (action === 'backup-later') {
      const result = repository.postponeBackupReminder(new Date(Date.now() + 86400000).toISOString());
      if (!result.ok) toast(result.error, true);
      updateBackupStatus(); return;
    }
    if (action === 'import') { document.getElementById('import-file').click(); return; }
    if (action === 'reset') {
      if (!await confirmAction('Очистить демонстрационные записи?', 'Будут удалены все сохранённые в этом браузере карточки, приёмы, ручные черновики и личные шаблоны МедАссистента. Скачанные файлы останутся. При необходимости сначала сделайте резервную копию.', 'Очистить записи')) return;
      const result = repository.reset([]);
      if (!result.ok) { state.error = result.error; state.saved = false; updateSaveStatus(); toast(result.error, true); return; }
      state.encounters = []; state.patients = []; state.templates = []; state.activeId = null; state.patientId = null; state.pendingNew = null; state.externalChange = false; state.birthDateInputs = {}; state.visitDateInputs = {}; state.saved = true; state.error = null; state.migrated = false; navigate('home'); toast('Демонстрационные записи и шаблоны очищены.'); return;
    }
    if (action === 'reload') {
      if (!await confirmAction('Загрузить сохранённую версию?', 'Текущие изменения в этом окне будут заменены данными из локального хранилища. При необходимости сначала скачайте резервную копию.', 'Загрузить')) return;
      const result = repository.load();
      if (result.error) { toast(result.error, true); return; }
      state.encounters = result.encounters; state.patients = result.patients; state.templates = result.templates || []; state.activeId = null; state.patientId = null; state.pendingNew = null; state.externalChange = false; state.birthDateInputs = {}; state.visitDateInputs = {}; state.error = null; state.saved = true; state.migrated = Boolean(result.migrated); navigate('home');
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
      const openNotes = new Set(Array.from(app.querySelectorAll('.exam-note[open]'), (note) => note.closest('.exam-group').dataset.examSection));
      for (const field of fields) entry.examSelections[field.id] = examCatalog.NORMAL_SELECTIONS[field.id];
      entry.updatedAt = new Date().toISOString();
      persist(); render();
      app.querySelectorAll('.exam-group').forEach((group) => { group.open = openSections.has(group.dataset.examSection); group.querySelector('.exam-note').open = openNotes.has(group.dataset.examSection); });
      app.querySelector(section ? '[data-action="normal-exam-section"][data-section="' + section.id + '"]' : '[data-action="normal-exam"]').focus({preventScroll: true});
      toast((section ? 'Заполнен раздел «' + section.title + '».' : 'Варианты осмотра заполнены.') + ' Проверьте признаки и при необходимости измените отдельные пункты.' + (reviewReset ? ' Запись возвращена в черновики.' : ''));
      return;
    }
    if (action === 'expand-exam' || action === 'collapse-exam') {
      app.querySelectorAll('.exam-group').forEach((group) => { group.open = action === 'expand-exam'; });
    }
  }
  app.addEventListener('click', (event) => {
    if (event.target.id === 'field-assessment-summary') showDiagnosisSuggestions(event.target);
    else if (!event.target.closest('#diagnosis-suggestions')) closeDiagnosisSuggestions();
    const target = event.target.closest('[data-action]');
    if (target && target.dataset.action === 'normal-exam-section') event.preventDefault();
    if (target && !target.disabled) handleAction(target.dataset.action, target).catch((error) => toast(error.message, true));
  });
  function handleInput(event) {
    const control = event.target;
    if (control.id === 'patient-birth-date') {
      const patient = state.view === 'visit' ? patientFor(active()) : selectedPatient();
      if (!requireFreshState()) return;
      const error = patientBirthDateError(patient, control.value);
      if (error) state.birthDateInputs[patient.id] = {value: control.value, error};
      else delete state.birthDateInputs[patient.id];
      control.setAttribute('aria-invalid', String(Boolean(error)));
      document.getElementById('patient-birth-date-error').textContent = error;
      document.getElementById('patient-birth-date-error').hidden = !error;
      if (error) { persist(); return; }
      if ((patient.birthDate || '') === control.value) { persist(); updateValidation(); return; }
      patient.birthDate = control.value; patient.updatedAt = new Date().toISOString();
      let reviewReset = false;
      state.encounters.filter(entry => entry.patientId === patient.id).forEach(entry => { if (invalidateReview(entry)) reviewReset = true; });
      updatePatientAgeDisplays(patient); persist(); updateValidation(); updateDraftState(); updateReviewState();
      if (state.view === 'patient') app.querySelectorAll('[data-visit-id]').forEach(row => { row.querySelector('.record-status').outerHTML = recordStatus(state.encounters.find(entry => entry.id === row.dataset.visitId)); });
      if (reviewReset) toast('Дата рождения изменена. Проверенные записи этой карточки возвращены в черновики; текст записей сохранён.');
      return;
    }
    if (control.id === 'investigation-series') {
      if (state.investigationSeriesKey === control.value) return;
      state.investigationSeriesKey = control.value;
      document.getElementById('patient-investigations').outerHTML = renderInvestigations(selectedPatient());
      document.getElementById('investigation-series').focus({preventScroll: true}); return;
    }
    if (control.id === 'previous-visit-select') {
      state.previousId = control.value; refreshPreviousVisit();
      document.getElementById('previous-visit-select')?.focus({preventScroll: true}); return;
    }
    if (control.id === 'patient-search') {
      state.patientSearch = control.value; refreshPatients(); return;
    }
    if (control.dataset.patientFilter) {
      state.patientFilters[control.dataset.patientFilter] = control.value; refreshPatients(); return;
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
      state.search = control.value; refreshRecords(); return;
    }
    if (!control.dataset.field || !active()) return;
    if (control.dataset.field === 'age' && patientFor(active()).birthDate) return;
    if (control.dataset.field === 'visitDate') {
      if (!requireFreshState()) return;
      const patient = patientFor(active());
      if (patient.birthDate && core.calculateAge(patient.birthDate, control.value) === null) {
        state.visitDateInputs[active().id] = {value: control.value, error: 'Укажите существующую дату приёма не раньше даты рождения пациента.'};
        updateValidation(); persist(); return;
      }
      delete state.visitDateInputs[active().id];
    }
    if (get(active(), control.dataset.field) === control.value) {
      if (control.dataset.field === 'visitDate') { updateValidation(); persist(); }
      return;
    }
    const reviewReset = invalidateReview(active());
    const planReset = control.dataset.field === 'assessment.returnVisitDate' && (active().workflow.returnVisitStatus === 'completed' || Boolean(active().workflow.returnVisitEncounterId));
    if (control.dataset.field === 'assessment.returnVisitDate') {
      active().workflow.returnVisitStatus = 'planned'; active().workflow.returnVisitEncounterId = '';
    }
    set(active(), control.dataset.field, control.value);
    active().updatedAt = new Date().toISOString();
    if (control.dataset.field === 'visitDate') { document.getElementById('visit-date-summary').textContent = 'Демонстрационный приём · ' + dateText(active().visitDate); updatePatientAgeDisplays(patientFor(active())); refreshPreviousVisit(); }
    app.querySelectorAll('[data-summary]').forEach((element) => {
      const fields = active()[element.dataset.summary];
      element.textContent = filledCount(fields) + ' из ' + Object.keys(fields).length + ' полей';
    });
    if (control.dataset.field === 'vitals.weight' || control.dataset.field === 'vitals.height') updateBmi();
    if (control.dataset.field === 'assessment.sickLeaveIssued') {
      document.getElementById('sickleave-period').hidden = control.value !== 'yes';
    }
    if (['assessment.sickLeaveIssued', 'assessment.sickLeaveNumber', 'assessment.sickLeaveFrom', 'assessment.sickLeaveTo', 'visitDate'].includes(control.dataset.field)) updateSickLeaveDays();
    if (control.dataset.field.startsWith('examSelections.')) {
      app.querySelectorAll('[data-count-section]').forEach((element) => {
        const items = examCatalog.FIELDS.filter((item) => item.section === element.dataset.countSection);
        element.textContent = items.filter((item) => active().examSelections[item.id]).length + ' из ' + items.length;
      });
      const total = document.getElementById('exam-total');
      if (total) total.textContent = filledCount(active().examSelections) + ' из ' + examCatalog.FIELDS.length;
    }
    if (control.dataset.field.startsWith('examSelections.') || control.dataset.field.startsWith('exam.')) {
      const group = control.closest('.exam-group');
      if (group) group.querySelector('.exam-preview').innerHTML = renderExamSummary(examCatalog.SECTIONS.find(section => section.id === group.dataset.examSection));
    }
    updateValidation(); persist(); updateDraftState(); updateReviewState();
    if (control.dataset.field === 'assessment.summary') {
      if (event.isComposing) closeDiagnosisSuggestions(); else showDiagnosisSuggestions(control);
    }
    if (planReset || reviewReset) toast((planReset ? 'Дата изменена: отметка и связь с повторным приёмом сброшены. Сам приём сохранён в истории. ' : '') + (reviewReset ? 'Запись возвращена в черновики.' : ''));
  }
  app.addEventListener('input', handleInput);
  app.addEventListener('focusin', (event) => { if (event.target.id === 'field-assessment-summary') showDiagnosisSuggestions(event.target); });
  app.addEventListener('focusout', (event) => { if (event.target.id === 'field-assessment-summary') closeDiagnosisSuggestions(); });
  app.addEventListener('pointerdown', (event) => { if (event.button === 0 && event.target.closest('.diagnosis-option')) event.preventDefault(); });
  app.addEventListener('compositionend', (event) => { if (event.target.id === 'field-assessment-summary') showDiagnosisSuggestions(event.target); });
  app.addEventListener('keyup', (event) => {
    if (event.target.id !== 'field-assessment-summary' || event.isComposing) return;
    if (['Home', 'End', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key) || ((event.ctrlKey || event.metaKey || event.shiftKey) && ['ArrowUp', 'ArrowDown', 'a', 'A'].includes(event.key))) showDiagnosisSuggestions(event.target);
  });
  app.addEventListener('keydown', (event) => {
    const tab = event.target.closest('.pager-tabs [role="tab"]');
    const navigationButton = event.target.closest('#main-navigation button');
    const control = tab || navigationButton;
    if (control && !event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const buttons = Array.from(control.closest('.pager-tabs').querySelectorAll(tab ? '[role="tab"]' : 'button'));
      const index = buttons.indexOf(control);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index + (event.key === 'ArrowRight' ? 1 : -1);
      event.preventDefault();
      if (buttons[next]) {
        buttons[next].focus({preventScroll: true});
        if (tab) buttons[next].click();
      }
      return;
    }
    if (event.target.id !== 'field-assessment-summary' || event.isComposing) return;
    if (event.key === 'Escape') { if (diagnosisSuggestions) event.preventDefault(); closeDiagnosisSuggestions(); return; }
    if (event.key === 'Tab') { closeDiagnosisSuggestions(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (event.ctrlKey || event.metaKey || event.shiftKey) { closeDiagnosisSuggestions(); return; }
      if (!diagnosisSuggestions) showDiagnosisSuggestions(event.target);
      if (!diagnosisSuggestions?.items.length) return;
      event.preventDefault();
      highlightDiagnosisSuggestion(diagnosisSuggestions.selected + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && diagnosisSuggestions?.selected >= 0) {
      event.preventDefault(); selectDiagnosis(diagnosisSuggestions.items[diagnosisSuggestions.selected].code);
    }
  });
  app.addEventListener('change', (event) => { if (event.target.tagName === 'SELECT') handleInput(event); });
  document.getElementById('import-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const token = ++restoreReadToken;
    if (restorePreview) restorePreview.close();
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Файл слишком большой. Максимум для импорта — 20 МБ.');
      const bundle = core.parseBundle((await file.text()).replace(/^\uFEFF/, ''));
      if (token === restoreReadToken) openRestorePreview(bundle, file.name);
    } catch (error) { if (token === restoreReadToken) toast('Восстановление не выполнено: ' + error.message, true); }
  });
  document.getElementById('restore-patient-search').addEventListener('input', renderRestorePatients);
  document.getElementById('restore-backup').addEventListener('click', exportBackup);
  window.addEventListener('beforeunload', (event) => { if ((!state.saved && (state.encounters.length || state.patients.length || state.templates.length || pendingHasContent())) || Object.keys(state.birthDateInputs).length || Object.keys(state.visitDateInputs).length) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('storage', (event) => {
    if (event.key === repository.BACKUP_KEY) { updateBackupStatus(); return; }
    if (!repository.WATCHED_KEYS.includes(event.key) && event.key !== null) return;
    state.externalChange = true; state.saved = false;
    state.error = 'Данные изменены в другом окне. Автосохранение приостановлено, чтобы не перезаписать их. Скачайте нужные изменения или загрузите сохранённую версию.';
    updateSaveStatus();
    if (restorePreview) restoreError('Данные изменены в другом окне. Закройте просмотр, загрузите сохранённую версию и выберите файл заново.', true);
    if (document.getElementById('repeat-dialog').open) repeatError('Данные изменены в другом окне. Создание приёма заблокировано. Закройте сводку и загрузите сохранённую версию.');
    if (document.getElementById('briefing-source-dialog').open) document.getElementById('briefing-source-notice').textContent = 'Данные изменены в другом окне. Здесь показана прежняя версия только для просмотра; создание приёма заблокировано.';
    if (templateForm) templateError('Данные изменены в другом окне. Закройте шаблоны и загрузите сохранённую версию перед сохранением.');
    if (sickLeaveForm) sickLeaveError('Данные изменены в другом окне. Закройте форму и загрузите сохранённую версию перед сохранением.');
    if (investigationForm) investigationError('Данные изменены в другом окне. Закройте форму и загрузите сохранённую версию перед сохранением.');
    if (investigationReportForm) investigationReportError('Данные изменены в другом окне. Закройте форму и загрузите сохранённую версию перед сохранением.');
    if (investigationAttachForm) investigationAttachError('Данные изменены в другом окне. Закройте выбор и загрузите сохранённую версию перед сохранением.');
    if (prescriptionForm) {
      prescriptionError('Данные изменены в другом окне. Закройте форму и загрузите сохранённую версию перед сохранением.');
    }
    if (diagnosisForm) diagnosisError('Данные изменены в другом окне. Закройте форму и загрузите сохранённую версию перед сохранением.');
    if ((prescriptionDeletePending || investigationDeletePending || diagnosisDeletePending) && document.getElementById('confirmation').open) document.getElementById('dialog-message').textContent = 'Данные изменены в другом окне. Удаление не будет выполнено. Закройте это окно и загрузите сохранённую версию.';
  });
  render();
  document.getElementById('diagnosis-form').addEventListener('submit', event => { event.preventDefault(); saveDiagnosis(); });
  document.getElementById('diagnosis-cancel').addEventListener('click', () => document.getElementById('diagnosis-dialog').close());
  document.getElementById('diagnosis-dialog').addEventListener('close', event => { if (!event.target.open) { diagnosisForm = null; closeDiagnosisSuggestions(); } });
  const diagnosisText = document.getElementById('diagnosis-text');
  ['input', 'focus', 'click', 'compositionend'].forEach(name => diagnosisText.addEventListener(name, event => { if (!event.isComposing) showDiagnosisSuggestions(diagnosisText); }));
  diagnosisText.addEventListener('blur', event => {
    if (!event.relatedTarget?.closest('#diagnosis-dialog .dialog-actions')) closeDiagnosisSuggestions();
  });
  diagnosisText.addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && !event.isComposing) showDiagnosisSuggestions(diagnosisText); });
  diagnosisText.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { if (diagnosisSuggestions) { event.preventDefault(); event.stopPropagation(); } closeDiagnosisSuggestions(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!diagnosisSuggestions) showDiagnosisSuggestions(diagnosisText);
      if (!diagnosisSuggestions?.items.length) return;
      event.preventDefault(); highlightDiagnosisSuggestion(diagnosisSuggestions.selected + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && diagnosisSuggestions?.selected >= 0) {
      event.preventDefault(); selectDiagnosis(diagnosisSuggestions.items[diagnosisSuggestions.selected].code);
    }
  });
  document.getElementById('diagnosis-edit-options').addEventListener('pointerdown', event => { if (event.button === 0 && event.target.closest('.diagnosis-option')) event.preventDefault(); });
  document.getElementById('diagnosis-edit-options').addEventListener('click', event => { const option = event.target.closest('[data-code]'); if (option) selectDiagnosis(option.dataset.code); });
  document.getElementById('investigation-form').addEventListener('submit', event => { event.preventDefault(); saveInvestigation(); });
  document.getElementById('investigation-form').addEventListener('input', event => { if (event.target.value.trim()) event.target.removeAttribute('aria-invalid'); });
  document.getElementById('investigation-cancel').addEventListener('click', () => document.getElementById('investigation-dialog').close());
  document.getElementById('investigation-kind').addEventListener('change', changeInvestigationKind);
  document.getElementById('investigation-dialog').addEventListener('close', event => { if (!event.target.open) investigationForm = null; });
  document.getElementById('investigation-report-form').addEventListener('submit', event => { event.preventDefault(); saveInvestigationReport(); });
  document.getElementById('investigation-report-template').addEventListener('change', changeInvestigationReportTemplate);
  document.getElementById('investigation-report-cancel').addEventListener('click', () => document.getElementById('investigation-report-dialog').close());
  document.getElementById('investigation-report-dialog').addEventListener('close', event => { if (!event.target.open) investigationReportForm = null; });
  document.getElementById('investigation-attach-form').addEventListener('submit', event => { event.preventDefault(); saveInvestigationAttach(); });
  document.getElementById('investigation-attach-cancel').addEventListener('click', () => document.getElementById('investigation-attach-dialog').close());
  document.getElementById('investigation-attach-dialog').addEventListener('close', event => { if (!event.target.open) investigationAttachForm = null; });
  document.getElementById('investigation-attach-options').addEventListener('change', event => {
    if (event.target.name === 'attach-report') event.target.closest('.investigation-attach-group').querySelectorAll('[name="attach-investigation"]').forEach(input => { input.checked = event.target.checked; });
    updateReportAttachCheckboxes();
  });
  document.getElementById('prescription-form').addEventListener('submit', event => { event.preventDefault(); savePrescription(); });
  document.getElementById('prescription-name').addEventListener('input', event => { if (event.target.value.trim()) event.target.removeAttribute('aria-invalid'); });
  document.getElementById('prescription-cancel').addEventListener('click', () => document.getElementById('prescription-dialog').close());
  document.getElementById('prescription-dialog').addEventListener('close', event => { if (!event.target.open) prescriptionForm = null; });
  document.getElementById('template-select').addEventListener('change', () => { templateError(''); updateTemplatePreview(); });
  ['save', 'apply', 'update', 'delete'].forEach(action => document.getElementById('template-' + action).addEventListener('click', () => templateAction(action)));
  document.getElementById('template-close').addEventListener('click', () => document.getElementById('template-dialog').close());
  document.getElementById('template-dialog').addEventListener('close', event => { if (!event.target.open) templateForm = null; });
  document.getElementById('sick-leave-form').addEventListener('submit', event => { event.preventDefault(); saveSickLeave(); });
  document.getElementById('sick-leave-form').addEventListener('input', updateSickLeavePreview);
  document.getElementById('sick-leave-select').addEventListener('change', selectEncounterSickLeave);
  document.getElementById('sick-leave-cancel').addEventListener('click', () => document.getElementById('sick-leave-dialog').close());
  document.getElementById('sick-leave-dialog').addEventListener('close', event => { if (!event.target.open) sickLeaveForm = null; });
  document.getElementById('repeat-source').addEventListener('change', updateCarryPreview);
  document.getElementById('repeat-fields').addEventListener('change', updateCarryStatus);
  document.getElementById('repeat-dialog').addEventListener('click', event => {
    const target = event.target.closest('[data-briefing-source]');
    if (target) openBriefingSource(target);
  });
  document.getElementById('repeat-dialog').addEventListener('close', event => {
    if (!event.target.open) { repeatPreparation = null; state.repeatPlanId = null; document.getElementById('briefing-source-dialog').close(); }
  });
  document.getElementById('briefing-source-close').addEventListener('click', () => document.getElementById('briefing-source-dialog').close());
  document.getElementById('repeat-cancel').addEventListener('click', () => document.getElementById('repeat-dialog').close());
  document.getElementById('repeat-create').addEventListener('click', () => {
    try { createRepeat(); } catch (error) { repeatError(error.message); }
  });
  window.setInterval(updateClock, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });
  document.querySelector('.skip-link').addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('main').focus();
  });
  document.getElementById('update-help-close').addEventListener('click', () => document.getElementById('update-help').close());
})();
