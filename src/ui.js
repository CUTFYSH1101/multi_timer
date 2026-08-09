/* UI 層 — 所有 DOM 操作集中在這裡。這一層不做任何倒數計算或狀態判斷。 */

import { STR, LANG_ABBR, t, nextLang, isLang } from './i18n.js';
import { fmt, parseTime } from './time.js';
import { splitColumns } from './layout.js';
import { announcementFor } from './announcer.js';
import { createSettingsPanel } from './settingsui.js';

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
    alertFn = () => {},
    lang: initialLang = 'zh-Hant',
    voice: initialVoice = true,
    announceGroup: initialAnnounceGroup = false,
  } = config;

  let lang = isLang(initialLang) ? initialLang : 'zh-Hant';
  let announceGroup = initialAnnounceGroup;
  let clockId = null;
  let keyHandler = null;

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
      ...store.extrasJSON(),
    });
    if (saveWarn) {
      saveWarn.textContent = result.ok ? '' : tr('cookieTooLarge');
      saveWarn.style.display = result.ok ? 'none' : 'block';
    }
    return result;
  }

  /* ---------------- 設定面板 ---------------- */

  const settings = createSettingsPanel({
    doc,
    store,
    tr,
    alertFn,
    onChange: needsRender => { if (needsRender) render(); else save(); },
  });

  /* ---------------- 翻譯 ---------------- */

  function applyStaticTranslations() {
    doc.title = tr('title');
    el('uiTitle').textContent = tr('title');
    el('uiSubtitle').textContent = tr('subtitle');
    updateToggleAllButton();
    el('resetAllBtn').textContent = tr('resetAll');
    el('addTimerBtn').textContent = tr('addTimer');
    el('addGroupBtn').textContent = tr('addGroup');
    el('uiVoiceLabel').textContent = tr('voice');
    announceBtn.textContent = announceGroup ? tr('announceGroupLabel') : tr('announceLabelOnly');
    el('uiFooter1').innerHTML = tr('footer1');
    el('uiFooter2').innerHTML = tr('footer2');
    const f3 = el('uiFooter3');
    if (f3) f3.innerHTML = tr('footer3');
    langBtn.textContent = LANG_ABBR[lang];
    doc.documentElement.lang = lang;
    settings.applyLabels();
  }

  /* ---------------- 視覺更新 ---------------- */

  /** 本輪靜音的按鈕長相。靜音不影響倒數，所以這裡只換圖示跟樣式。 */
  function applyMuteVisual(node, target, isGroup) {
    if (!node) return;
    const btn = node.querySelector('.mute-btn');
    if (!btn) return;
    const muted = !!target.mutedThisRound;
    btn.textContent = muted ? '🔇' : '🔊';
    btn.classList.toggle('active', muted);
    btn.title = isGroup
      ? (muted ? tr('unmuteGroupTip') : tr('muteGroupTip'))
      : (muted ? tr('unmuteTip') : tr('muteTip'));
    node.classList.toggle('muted', muted);
  }

  function updateMuteVisual(target) {
    const isGroup = target.kind === 'group';
    const node = doc.getElementById((isGroup ? 'groupheader-' : 'row-') + target.id);
    applyMuteVisual(node, target, isGroup);
    // 群組靜音蓋過單元靜音，所以群組一動，底下每一列的「實際會不會出聲」也跟著變
    if (isGroup) target.timers.forEach(x => updateRowVisual(x));
  }

  function applyRowVisual(row, timer) {
    if (!row) return;
    const timeDisplay = row.querySelector('.time-display');
    const timeInput = row.querySelector('.time-input');
    const counting = timer.running || timer.done || timer.restartAt !== null;
    // 暫停但還沒重設回滿血：也用唯讀的剩餘時間顯示，不要秀出可編輯的總時長輸入框，
    // 否則暫停時看到的數字（總時長）會跟實際剩下的時間對不上。
    const pausedMidway = !counting && timer.remainingSec !== timer.totalSec;
    // 套用過時間軸模板的計時器：時間鎖住，永遠唯讀顯示，不准手動編輯
    const locked = !!store.timelineOfTimer(timer);
    if (counting || pausedMidway || locked) {
      timeDisplay.style.display = 'block';
      timeInput.style.display = 'none';
      timeDisplay.textContent = fmt(timer.remainingSec);
    } else {
      timeDisplay.style.display = 'none';
      timeInput.style.display = 'block';
    }
    timeInput.disabled = locked;
    row.classList.toggle('locked', locked);
    timeDisplay.title = locked ? tr('timelineLockedTip') : '';
    row.classList.toggle('done', timer.done);
    // 被群組蓋掉的單元也要看得出來這輪不會出聲
    row.classList.toggle('silenced', store.isSilenced(timer));

    const startBtn = row.querySelector('.start-btn');
    startBtn.textContent = timer.running ? '⏸' : '▶';
    startBtn.title = timer.running ? tr('pauseTip') : tr('startTip');
    startBtn.classList.toggle('active', timer.running);
    row.querySelector('.loop-btn').classList.toggle('active', timer.loop);
    applyMuteVisual(row, timer, false);
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

  function updateToggleAllButton() {
    const btn = el('toggleAllBtn');
    if (!btn) return;
    const anyActive = store.flatten().some(x => x.running || x.restartAt !== null);
    btn.textContent = anyActive ? tr('pauseAll') : tr('startAll');
    btn.title = tr('startAllTip'); // 這顆本來就是「開始/暫停全部」共用一個提示
    btn.classList.toggle('active', anyActive);
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
      '<button class="icon-btn mute-btn">🔊</button>' +
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

    // 本輪靜音：只切旗標，不碰 running / remainingSec
    row.querySelector('.mute-btn').addEventListener('click', () => {
      store.toggleMute(timer);
      updateRowVisual(timer);
    });

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

  /** 群組的時間軸模板選單。選了就把模板換算成群組內計時器的長度。沒有任何模板時整條不出現。 */
  function buildTimelineBar(group) {
    if (store.timelines.length === 0) return null;
    const bar = doc.createElement('div');
    bar.className = 'group-timeline';

    const sel = doc.createElement('select');
    sel.className = 'timeline-select';
    sel.id = 'timeline-' + group.id;

    const none = doc.createElement('option');
    none.value = '';
    none.textContent = tr('timelineNone');
    sel.appendChild(none);

    for (const tl of store.timelines) {
      const o = doc.createElement('option');
      o.value = tl.id;
      o.textContent = tl.name;
      sel.appendChild(o);
    }
    sel.value = group.timelineId || '';

    // 套用是一次性的換算動作：可能會新增或刪除計時器，刪除前要先問過使用者
    sel.addEventListener('change', () => {
      const timelineId = sel.value || null;
      const plan = store.planTimelineApply(group, timelineId);
      if (plan.deleteCount > 0 && !confirmFn(tr('timelineApplyConfirm').replace('{n}', String(plan.deleteCount)))) {
        sel.value = group.timelineId || '';
        return;
      }
      store.applyTimelineTemplate(group, timelineId, tr('newTimerLabel'));
      render();
    });

    bar.appendChild(sel);
    return bar;
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
      '<span class="hotkey-badge"></span>' +
      '<span class="group-count" id="groupcount-' + group.id + '"></span>' +
      '<button class="icon-btn mute-btn">🔊</button>' +
      '<button class="icon-btn start-btn' + (anyRunning ? ' active' : '') + '">' + (anyRunning ? '⏸' : '▶') + '</button>' +
      '<button class="icon-btn loop-btn' + (allLooping ? ' active' : '') + '">🔁</button>' +
      '<button class="icon-btn reset-btn">⟲</button>' +
      '<button class="del-btn">✕</button>';
    wrap.appendChild(header);

    header.querySelector('.group-count').textContent =
      group.timers.length + (runningCount > 0 ? ' · ▶' + runningCount : '');
    header.querySelector('.hotkey-badge').textContent = group.hotkey ? '[' + group.hotkey + ']' : '';

    const collapseBtn = header.querySelector('.collapse-btn');
    collapseBtn.title = tr('collapseTip');
    collapseBtn.addEventListener('click', () => { group.collapsed = !group.collapsed; render(); });

    const glabel = header.querySelector('.group-label-input');
    glabel.value = group.label;
    glabel.addEventListener('input', () => { group.label = glabel.value || tr('newGroupLabel'); });
    glabel.addEventListener('change', save);

    // 群組靜音蓋過單元靜音：勾了群組，底下全部這輪都不唸
    header.querySelector('.mute-btn').addEventListener('click', () => {
      store.toggleMute(group);
      updateMuteVisual(group);
    });

    const startBtn = header.querySelector('.start-btn');
    startBtn.title = tr('startAllTip');
    startBtn.addEventListener('click', () => { ensureAudio(); store.batchToggleStart(group.timers); render(); });

    const loopBtn = header.querySelector('.loop-btn');
    loopBtn.title = tr('loopAllTip');
    loopBtn.addEventListener('click', () => { store.batchToggleLoop(group.timers); render(); });

    const resetBtn = header.querySelector('.reset-btn');
    resetBtn.title = tr('resetAllTip');
    resetBtn.addEventListener('click', () => { store.resetGroup(group); render(); });

    const delBtn = header.querySelector('.del-btn');
    delBtn.title = tr('delGroupTip');
    delBtn.addEventListener('click', () => {
      if (!confirmFn(tr('confirmDeleteGroup'))) return;
      store.removeGroup(group.id);
      render();
    });

    const timelineBar = buildTimelineBar(group);
    if (timelineBar) wrap.appendChild(timelineBar);

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

    applyMuteVisual(header, group, true);
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
    updateToggleAllButton();
    settings.render();
    save();
  }

  function refreshBadges() {
    store.items.forEach(it => { if (it.kind === 'group') updateGroupBadge(it); });
    updateToggleAllButton();
  }

  /* ---------------- 時間推進 ---------------- */

  function handleEvents(events) {
    for (const ev of events) {
      if (ev.type !== 'expired') continue;
      // 靜音／被合併吃掉的那一聲：畫面照閃，但不出聲
      const text = announcementFor(ev, { announceGroup, suffix: STR[lang].timeUpSuffix });
      if (text !== null) {
        beep();
        speaker.speak(text);
      }
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

  /* ---------------- 快捷鍵 ---------------- */

  /** 在輸入框裡打字時不能被快捷鍵搶走按鍵 */
  function isTypingTarget(node) {
    if (!node) return false;
    const tag = (node.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true;
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (isTypingTarget(e.target)) return;
    const group = store.triggerHotkey(e.key);
    if (!group) return;
    if (e.preventDefault) e.preventDefault();
    updateMuteVisual(group);
  }

  /* ---------------- 工具列 ---------------- */

  function wireToolbar() {
    el('toggleAllBtn').addEventListener('click', () => {
      ensureAudio();
      store.batchToggleStart(store.flatten());
      render();
    });

    // 全部重設：計時器歸位、本輪靜音一次清空，只設定不自動開始倒數
    el('resetAllBtn').addEventListener('click', () => {
      ensureAudio();
      store.resetAll();
      speaker.stop();
      render();
    });

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

    keyHandler = onKeyDown;
    doc.addEventListener('keydown', keyHandler);
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
    stop() {
      if (clockId) clearInterval(clockId);
      clockId = null;
      if (keyHandler) doc.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    },
    render,
    applyStaticTranslations,
    settings,
    getLang: () => lang,
    isAnnounceGroup: () => announceGroup,
    isVoiceOn: () => voiceToggle.checked,
  };
}
