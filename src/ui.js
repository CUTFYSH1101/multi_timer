/* UI 層 — 所有 DOM 操作集中在這裡。這一層不做任何倒數計算或狀態判斷。 */

import { STR, LANG_ABBR, t, nextLang, isLang } from './i18n.js';
import { fmt, parseTime } from './time.js';
import { splitColumns } from './layout.js';
import { buildAnnouncement } from './announcer.js';

const TICK_MS = 200;

export function createUI(config) {
  const {
    doc,
    store,
    cookieStore,
    speaker,
    beep = () => {},
    ensureAudio = () => {},
    confirmFn = () => true,
    lang: initialLang = 'zh-Hant',
    voice: initialVoice = true,
    announceGroup: initialAnnounceGroup = false,
  } = config;

  let lang = isLang(initialLang) ? initialLang : 'zh-Hant';
  let announceGroup = initialAnnounceGroup;
  let clockId = null;

  const el = id => doc.getElementById(id);
  const colLeft = el('colLeft');
  const colRight = el('colRight');
  const voiceToggle = el('voiceToggle');
  const langBtn = el('langBtn');
  const announceBtn = el('announceModeBtn');
  const saveWarn = el('saveWarn');

  voiceToggle.checked = initialVoice !== false;

  const tr = key => t(lang, key);

  /* ---------------- 儲存 ---------------- */

  function save() {
    const result = cookieStore.save({
      voice: voiceToggle.checked,
      announceGroup,
      lang,
      items: store.toJSON(),
    });
    if (saveWarn) {
      saveWarn.textContent = result.ok ? '' : tr('cookieTooLarge');
      saveWarn.style.display = result.ok ? 'none' : 'block';
    }
    return result;
  }

  /* ---------------- 翻譯 ---------------- */

  function applyStaticTranslations() {
    doc.title = tr('title');
    el('uiTitle').textContent = tr('title');
    el('uiSubtitle').textContent = tr('subtitle');
    el('startAllBtn').textContent = tr('startAll');
    el('pauseAllBtn').textContent = tr('pauseAll');
    el('resetAllBtn').textContent = tr('resetAll');
    el('addTimerBtn').textContent = tr('addTimer');
    el('addGroupBtn').textContent = tr('addGroup');
    el('uiVoiceLabel').textContent = tr('voice');
    announceBtn.textContent = announceGroup ? tr('announceGroupLabel') : tr('announceLabelOnly');
    el('uiFooter1').innerHTML = tr('footer1');
    el('uiFooter2').innerHTML = tr('footer2');
    langBtn.textContent = LANG_ABBR[lang];
    doc.documentElement.lang = lang;
  }

  /* ---------------- 視覺更新 ---------------- */

  function applyRowVisual(row, timer) {
    if (!row) return;
    const timeDisplay = row.querySelector('.time-display');
    const timeInput = row.querySelector('.time-input');
    const active = timer.running || timer.done || timer.restartAt !== null;
    if (active) {
      timeDisplay.style.display = 'block';
      timeInput.style.display = 'none';
      timeDisplay.textContent = fmt(timer.remainingSec);
    } else {
      timeDisplay.style.display = 'none';
      timeInput.style.display = 'block';
    }
    row.classList.toggle('done', timer.done);

    const startBtn = row.querySelector('.start-btn');
    startBtn.textContent = timer.running ? '⏸' : '▶';
    startBtn.title = timer.running ? tr('pauseTip') : tr('startTip');
    startBtn.classList.toggle('active', timer.running);
    row.querySelector('.loop-btn').classList.toggle('active', timer.loop);
  }

  function updateRowVisual(timer) {
    applyRowVisual(doc.getElementById('row-' + timer.id), timer);
  }

  function updateGroupBadge(group) {
    const badge = doc.getElementById('groupcount-' + group.id);
    if (!badge) return;
    const running = group.timers.filter(x => x.running).length;
    badge.textContent = group.timers.length + (running > 0 ? ' · ▶' + running : '');
  }

  function flashGroupHeader(gid) {
    const header = doc.getElementById('groupheader-' + gid);
    if (!header) return;
    header.classList.add('flash-alert');
    setTimeout(() => header.classList.remove('flash-alert'), 1600);
  }

  /* ---------------- DOM 建構 ---------------- */

  function buildTimerRow(timer, colorOverride, nested) {
    const row = doc.createElement('div');
    row.className = 'row' + (nested ? ' nested' : '');
    row.id = 'row-' + timer.id;
    row.style.setProperty('--row-color', colorOverride || timer.color);
    // 結構用 innerHTML，使用者輸入的值一律用 property 指派，避免引號破版
    row.innerHTML =
      '<input class="label-input" maxlength="20">' +
      '<div style="position:relative;">' +
        '<span class="time-display"></span>' +
        '<input class="time-input" style="display:none">' +
      '</div>' +
      '<button class="icon-btn start-btn">▶</button>' +
      '<button class="icon-btn loop-btn">🔁</button>' +
      '<button class="icon-btn reset-btn">⟲</button>' +
      '<button class="del-btn">✕</button>';

    const labelInput = row.querySelector('.label-input');
    labelInput.value = timer.label;
    labelInput.addEventListener('input', () => { timer.label = labelInput.value || tr('newTimerLabel'); });
    labelInput.addEventListener('change', save);

    const timeInput = row.querySelector('.time-input');
    timeInput.value = fmt(timer.totalSec);
    timeInput.addEventListener('input', () => store.setDuration(timer, parseTime(timeInput.value)));
    timeInput.addEventListener('change', () => { timeInput.value = fmt(timer.totalSec); save(); });

    row.querySelector('.time-display').textContent = fmt(timer.remainingSec);

    const startBtn = row.querySelector('.start-btn');
    startBtn.title = tr('startTip');
    startBtn.addEventListener('click', () => {
      ensureAudio();
      if (timer.running) store.pause(timer); else store.start(timer);
      updateRowVisual(timer);
      refreshBadges();
    });

    const loopBtn = row.querySelector('.loop-btn');
    loopBtn.title = tr('loopTip');
    loopBtn.addEventListener('click', () => { store.toggleLoop(timer); updateRowVisual(timer); });

    const resetBtn = row.querySelector('.reset-btn');
    resetBtn.title = tr('resetTip');
    resetBtn.addEventListener('click', () => {
      store.reset(timer);
      timeInput.value = fmt(timer.totalSec);
      updateRowVisual(timer);
      refreshBadges();
    });

    const delBtn = row.querySelector('.del-btn');
    delBtn.title = tr('delTip');
    delBtn.addEventListener('click', () => { store.removeTimer(timer.id); render(); });

    applyRowVisual(row, timer);
    return row;
  }

  function buildGroupBlock(group) {
    const wrap = doc.createElement('div');
    wrap.className = 'group-block';

    const anyRunning = group.timers.some(x => x.running);
    const allLooping = group.timers.length > 0 && group.timers.every(x => x.loop);
    const runningCount = group.timers.filter(x => x.running).length;

    const header = doc.createElement('div');
    header.className = 'group-header';
    header.id = 'groupheader-' + group.id;
    header.style.setProperty('--row-color', group.color);
    header.innerHTML =
      '<button class="collapse-btn">' + (group.collapsed ? '▸' : '▾') + '</button>' +
      '<input class="group-label-input" maxlength="24">' +
      '<span class="group-count" id="groupcount-' + group.id + '"></span>' +
      '<button class="icon-btn start-btn' + (anyRunning ? ' active' : '') + '">' + (anyRunning ? '⏸' : '▶') + '</button>' +
      '<button class="icon-btn loop-btn' + (allLooping ? ' active' : '') + '">🔁</button>' +
      '<button class="icon-btn reset-btn">⟲</button>' +
      '<button class="del-btn">✕</button>';
    wrap.appendChild(header);

    header.querySelector('.group-count').textContent =
      group.timers.length + (runningCount > 0 ? ' · ▶' + runningCount : '');

    const collapseBtn = header.querySelector('.collapse-btn');
    collapseBtn.title = tr('collapseTip');
    collapseBtn.addEventListener('click', () => { group.collapsed = !group.collapsed; render(); });

    const glabel = header.querySelector('.group-label-input');
    glabel.value = group.label;
    glabel.addEventListener('input', () => { group.label = glabel.value || tr('newGroupLabel'); });
    glabel.addEventListener('change', save);

    const startBtn = header.querySelector('.start-btn');
    startBtn.title = tr('startAllTip');
    startBtn.addEventListener('click', () => { ensureAudio(); store.batchToggleStart(group.timers); render(); });

    const loopBtn = header.querySelector('.loop-btn');
    loopBtn.title = tr('loopAllTip');
    loopBtn.addEventListener('click', () => { store.batchToggleLoop(group.timers); render(); });

    const resetBtn = header.querySelector('.reset-btn');
    resetBtn.title = tr('resetAllTip');
    resetBtn.addEventListener('click', () => { store.batchReset(group.timers); render(); });

    const delBtn = header.querySelector('.del-btn');
    delBtn.title = tr('delGroupTip');
    delBtn.addEventListener('click', () => {
      if (!confirmFn(tr('confirmDeleteGroup'))) return;
      store.removeGroup(group.id);
      render();
    });

    if (!group.collapsed) {
      const members = doc.createElement('div');
      members.className = 'group-members';
      group.timers.forEach(x => members.appendChild(buildTimerRow(x, group.color, true)));
      const addTile = doc.createElement('div');
      addTile.className = 'add-to-group';
      addTile.textContent = tr('addToGroup');
      addTile.addEventListener('click', () => {
        store.addTimerToGroup(group.id, tr('newTimerLabel'));
        render();
      });
      members.appendChild(addTile);
      wrap.appendChild(members);
    }

    return wrap;
  }

  /* ---------------- render ---------------- */

  function render() {
    colLeft.innerHTML = '';
    colRight.innerHTML = '';
    const [left, right] = splitColumns(store.items);
    const build = it => (it.kind === 'timer' ? buildTimerRow(it, null, false) : buildGroupBlock(it));
    left.forEach(it => colLeft.appendChild(build(it)));
    right.forEach(it => colRight.appendChild(build(it)));
    save();
  }

  function refreshBadges() {
    store.items.forEach(it => { if (it.kind === 'group') updateGroupBadge(it); });
  }

  /* ---------------- 時間推進 ---------------- */

  function handleEvents(events) {
    for (const ev of events) {
      if (ev.type !== 'expired') continue;
      beep();
      speaker.speak(buildAnnouncement({
        timerLabel: ev.timer.label,
        groupLabel: ev.group ? ev.group.label : null,
        announceGroup,
        suffix: STR[lang].timeUpSuffix,
      }));
      if (ev.group && ev.group.collapsed) flashGroupHeader(ev.group.id);
    }
  }

  function step() {
    const events = store.tick();
    handleEvents(events);
    store.flatten().forEach(timer => {
      if (timer.running || timer.done) updateRowVisual(timer);
    });
    refreshBadges();
  }

  /* ---------------- 工具列 ---------------- */

  function wireToolbar() {
    el('startAllBtn').addEventListener('click', () => { ensureAudio(); store.batchStart(store.flatten()); render(); });
    el('pauseAllBtn').addEventListener('click', () => { store.batchPause(store.flatten()); render(); });
    el('resetAllBtn').addEventListener('click', () => { store.batchReset(store.flatten()); speaker.stop(); render(); });
    el('addTimerBtn').addEventListener('click', () => { store.addTimer(tr('newTimerLabel')); render(); });
    el('addGroupBtn').addEventListener('click', () => { store.addGroup(tr('newGroupLabel')); render(); });

    voiceToggle.addEventListener('change', () => { if (!voiceToggle.checked) speaker.stop(); save(); });

    announceBtn.addEventListener('click', () => {
      announceGroup = !announceGroup;
      announceBtn.textContent = announceGroup ? tr('announceGroupLabel') : tr('announceLabelOnly');
      save();
    });

    langBtn.addEventListener('click', () => {
      lang = nextLang(lang);
      applyStaticTranslations();
      render();
    });
  }

  return {
    start() {
      wireToolbar();
      applyStaticTranslations();
      render();
      // 用 setInterval 而不是 requestAnimationFrame：分頁切到背景時 rAF 會完全停住，
      // 提醒會延遲到切回來那一刻才響。setInterval 在背景只被降頻，不會停。
      clockId = setInterval(step, TICK_MS);
    },
    stop() { if (clockId) clearInterval(clockId); clockId = null; },
    render,
    applyStaticTranslations,
    getLang: () => lang,
    isAnnounceGroup: () => announceGroup,
    isVoiceOn: () => voiceToggle.checked,
  };
}
