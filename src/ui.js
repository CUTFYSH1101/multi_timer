/* UI 層 — 所有 DOM 操作集中在這裡。這一層不做任何倒數計算或狀態判斷。 */

import { STR, LANG_ABBR, t, nextLang, isLang } from './i18n.js';
import { fmt, parseTime } from './time.js';
import { splitColumns } from './layout.js';
import { announcementFor, nextAnnounceMode, ANNOUNCE_MODES } from './announcer.js';
import { createSettingsPanel } from './settingsui.js';

const TICK_MS = 200;

/** 播報模式 → 按鈕文案的 i18n key */
const ANNOUNCE_MODE_KEY = {
  label: 'announceLabelOnly',
  group: 'announceSubGroupLabel',
  mother: 'announceMotherLabel',
  motherGroup: 'announceMotherSubLabel',
  all: 'announceAllLabel',
};

export function createUI(config) {
  const {
    doc,
    store,
    storage,
    speaker,
    beep = () => {},
    ensureAudio = () => {},
    confirmFn = () => true,
    alertFn = () => {},
    promptFn = () => null,
    lang: initialLang = 'zh-Hant',
    voice: initialVoice = true,
    announceMode: initialAnnounceMode = 'label',
  } = config;

  let lang = isLang(initialLang) ? initialLang : 'zh-Hant';
  let announceMode = ANNOUNCE_MODES.includes(initialAnnounceMode) ? initialAnnounceMode : 'label';
  let clockId = null;
  let keyHandler = null;

  const el = id => doc.getElementById(id);
  const colLeft = el('colLeft');
  const colRight = el('colRight');
  const voiceToggle = el('voiceToggle');
  const langBtn = el('langBtn');
  const announceBtn = el('announceModeBtn');
  const saveWarn = el('saveWarn');
  const addSuperGroupBtn = el('addSuperGroupBtn');

  voiceToggle.checked = initialVoice !== false;

  const tr = key => t(lang, key);

  /* ---------------- 儲存 ---------------- */

  function save() {
    const result = storage.save({
      voice: voiceToggle.checked,
      announceMode,
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
    el('resetAllBtn').title = tr('resetAllTip');
    el('rewindAllBtn').textContent = tr('rewindAll');
    el('rewindAllBtn').title = tr('rewindAllTip');
    el('fastForwardAllBtn').textContent = tr('fastForwardAll');
    el('fastForwardAllBtn').title = tr('fastForwardAllTip');
    el('addTimerBtn').textContent = tr('addTimer');
    el('addGroupBtn').textContent = tr('addGroup');
    if (addSuperGroupBtn) addSuperGroupBtn.textContent = tr('addSuperGroup');
    el('uiVoiceLabel').textContent = tr('voice');
    announceBtn.textContent = tr(ANNOUNCE_MODE_KEY[announceMode]);
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
    const loopBtn = row.querySelector('.loop-btn');
    loopBtn.classList.toggle('active', timer.loop);
    const hasCustomRepeat = timer.repeatSec != null && timer.repeatSec !== timer.totalSec;
    loopBtn.classList.toggle('has-repeat', hasCustomRepeat);
    loopBtn.title = hasCustomRepeat
      ? tr('loopTip') + '（' + tr('repeatSecTip') + ' ' + fmt(timer.repeatSec) + '）'
      : tr('loopTip') + '（' + tr('repeatSecHint') + '）';
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

  function updateSuperGroupBadge(supergroup) {
    const badge = doc.getElementById('groupcount-' + supergroup.id);
    if (!badge) return;
    const allTimers = supergroup.groups.flatMap(g => g.timers);
    const running = allTimers.filter(x => x.running).length;
    badge.textContent = allTimers.length + (running > 0 ? ' · ▶' + running : '');
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
    loopBtn.addEventListener('click', () => { store.toggleLoop(timer); updateRowVisual(timer); });
    loopBtn.addEventListener('contextmenu', e => {
      e.preventDefault();
      const ans = promptFn(tr('repeatSecPrompt'), fmt(timer.repeatSec != null ? timer.repeatSec : timer.totalSec));
      if (ans === null) return;
      const trimmed = ans.trim();
      store.setRepeatSec(timer, trimmed === '' ? null : parseTime(trimmed));
      updateRowVisual(timer);
      save();
    });

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

  /**
   * 群組區塊。nestedInSuper=true 表示這個群組是巢狀在母群組底下的子群組——
   * 邏輯、按鈕、事件完全一樣，只多一個縮排用的 CSS class。
   */
  function buildGroupBlock(group, nestedInSuper) {
    const wrap = doc.createElement('div');
    wrap.className = 'group-block' + (nestedInSuper ? ' subgroup' : '');

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

    // 群組靜音蓋過單元靜音：勾了群組，底下全部這輪都不唸。子群組即使在循環中，
    // 這顆鈕一樣可以手動點——手動點只是暫時覆蓋目前循環指到的位置，不會壞掉。
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

  /**
   * 母群組區塊：外觀跟群組一致的 header，底下塞每個子群組（用 buildGroupBlock 巢狀顯示）。
   * 母群組本身沒有靜音鈕——靜音狀態完全體現在子群組的 🔊/🔇 上，快捷鍵循環也是切子群組。
   */
  function buildSuperGroupBlock(supergroup) {
    const wrap = doc.createElement('div');
    wrap.className = 'group-block supergroup-block';

    const allTimers = supergroup.groups.flatMap(g => g.timers);
    const anyRunning = allTimers.some(x => x.running);
    const allLooping = allTimers.length > 0 && allTimers.every(x => x.loop);
    const runningCount = allTimers.filter(x => x.running).length;

    const header = doc.createElement('div');
    header.className = 'group-header supergroup-header';
    header.id = 'groupheader-' + supergroup.id;
    header.style.setProperty('--row-color', supergroup.color);
    header.innerHTML =
      '<button class="collapse-btn">' + (supergroup.collapsed ? '▸' : '▾') + '</button>' +
      '<input class="group-label-input" maxlength="24">' +
      '<span class="hotkey-badge"></span>' +
      '<span class="group-count" id="groupcount-' + supergroup.id + '"></span>' +
      '<button class="icon-btn start-btn' + (anyRunning ? ' active' : '') + '">' + (anyRunning ? '⏸' : '▶') + '</button>' +
      '<button class="icon-btn loop-btn' + (allLooping ? ' active' : '') + '">🔁</button>' +
      '<button class="icon-btn reset-btn">⟲</button>' +
      '<button class="del-btn">✕</button>';
    wrap.appendChild(header);

    header.querySelector('.group-count').textContent =
      allTimers.length + (runningCount > 0 ? ' · ▶' + runningCount : '');
    header.querySelector('.hotkey-badge').textContent = supergroup.hotkey ? '[' + supergroup.hotkey + ']' : '';

    const collapseBtn = header.querySelector('.collapse-btn');
    collapseBtn.title = tr('collapseTip');
    collapseBtn.addEventListener('click', () => { supergroup.collapsed = !supergroup.collapsed; render(); });

    const glabel = header.querySelector('.group-label-input');
    glabel.value = supergroup.label;
    glabel.addEventListener('input', () => { supergroup.label = glabel.value || tr('newSuperGroupLabel'); });
    glabel.addEventListener('change', save);

    const startBtn = header.querySelector('.start-btn');
    startBtn.title = tr('startAllTip');
    startBtn.addEventListener('click', () => { ensureAudio(); store.batchToggleStart(allTimers); render(); });

    const loopBtn = header.querySelector('.loop-btn');
    loopBtn.title = tr('loopAllTip');
    loopBtn.addEventListener('click', () => { store.batchToggleLoop(allTimers); render(); });

    const resetBtn = header.querySelector('.reset-btn');
    resetBtn.title = tr('resetAllTip');
    resetBtn.addEventListener('click', () => { store.resetSuperGroup(supergroup); render(); });

    const delBtn = header.querySelector('.del-btn');
    delBtn.title = tr('delSuperGroupTip');
    delBtn.addEventListener('click', () => {
      if (!confirmFn(tr('confirmDeleteSuperGroup'))) return;
      store.removeSuperGroup(supergroup.id);
      render();
    });

    if (!supergroup.collapsed) {
      const members = doc.createElement('div');
      members.className = 'group-members supergroup-members';
      supergroup.groups.forEach(g => members.appendChild(buildGroupBlock(g, true)));
      const addTile = doc.createElement('div');
      addTile.className = 'add-to-group';
      addTile.textContent = tr('addSubGroup');
      addTile.addEventListener('click', () => {
        store.addGroupToSuperGroup(supergroup.id, tr('newGroupLabel'));
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
    const build = it => {
      if (it.kind === 'timer') return buildTimerRow(it, null, false);
      if (it.kind === 'supergroup') return buildSuperGroupBlock(it);
      return buildGroupBlock(it, false);
    };
    left.forEach(it => colLeft.appendChild(build(it)));
    right.forEach(it => colRight.appendChild(build(it)));
    updateToggleAllButton();
    settings.render();
    save();
  }

  function refreshBadges() {
    for (const it of store.items) {
      if (it.kind === 'group') updateGroupBadge(it);
      else if (it.kind === 'supergroup') {
        it.groups.forEach(updateGroupBadge);
        updateSuperGroupBadge(it);
      }
    }
    updateToggleAllButton();
  }

  /* ---------------- 時間推進 ---------------- */

  function handleEvents(events) {
    for (const ev of events) {
      if (ev.type !== 'expired') continue;
      const group = ev.group;
      const supergroup = group ? store.superGroupOf(group) : null;
      // 靜音／被連線或配對合併吃掉的那一聲：畫面照閃，但不出聲。
      // 連線只有在雙方時間對上時才會走到 ev.mergedText；沒對上就照真正的名字唸，不套用連線文字。
      const text = announcementFor(ev, {
        mode: announceMode,
        suffix: STR[lang].timeUpSuffix,
        motherLabel: supergroup ? supergroup.label : null,
        groupLabel: group ? group.label : null,
        timerLabel: ev.timer.label,
      });
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

  /** 按 Enter 跳到下一個欄位（標籤/時間，包含群組與母群組的標籤）：即時抓目前畫面上的順序，跳過收合群組跟被鎖住/隱藏的時間輸入框 */
  function focusNextField(current) {
    const fields = Array.from(doc.querySelectorAll('.label-input, .time-input, .group-label-input'))
      .filter(node => node.offsetParent !== null);
    const idx = fields.indexOf(current);
    if (idx === -1) return;
    const next = fields[idx + 1];
    if (!next) return;
    next.focus();
    if (typeof next.select === 'function') next.select();
  }

  /** 全部計時器一起快進/倒退幾秒：模擬「假設現實世界快進/回到過去幾秒」，遊戲中太慢按全部開始時拿來補時間差。 */
  function nudgeAll(deltaSec) {
    ensureAudio();
    const events = store.nudgeAll(deltaSec);
    handleEvents(events);
    render();
  }

  /** 全域快捷鍵：空白鍵＝全部開始/暫停，Delete/Backspace＝全部重設，←/→＝全部倒退/快進5秒。跟個別群組的快捷鍵不衝突（那些鍵不會落在這裡）。 */
  function onKeyDown(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('.label-input, .time-input, .group-label-input')) {
      e.preventDefault();
      focusNextField(e.target);
      return;
    }

    if (isTypingTarget(e.target)) return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      nudgeAll(e.key === 'ArrowRight' ? -5 : 5);
      return;
    }

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      ensureAudio();
      store.batchToggleStart(store.flatten());
      render();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      ensureAudio();
      store.resetAll();
      speaker.stop();
      render();
      return;
    }

    const target = store.triggerHotkey(e.key);
    if (!target) return;
    if (e.preventDefault) e.preventDefault();
    // 綁到母群組：循環切換的是底下每個子群組的靜音旗標，逐一刷新它們的 🔊/🔇
    if (target.kind === 'supergroup') target.groups.forEach(updateMuteVisual);
    else updateMuteVisual(target);
  }

  /* ---------------- 工具列 ---------------- */

  function wireToolbar() {
    el('toggleAllBtn').addEventListener('click', () => {
      ensureAudio();
      store.batchToggleStart(store.flatten());
      render();
    });

    // 全部重設：計時器歸位、本輪靜音一次清空（母群組的循環也一起打回第一個子群組），只設定不自動開始倒數
    el('resetAllBtn').addEventListener('click', () => {
      ensureAudio();
      store.resetAll();
      speaker.stop();
      render();
    });

    el('rewindAllBtn').addEventListener('click', () => nudgeAll(5));
    el('fastForwardAllBtn').addEventListener('click', () => nudgeAll(-5));

    el('addTimerBtn').addEventListener('click', () => { store.addTimer(tr('newTimerLabel')); render(); });
    el('addGroupBtn').addEventListener('click', () => { store.addGroup(tr('newGroupLabel')); render(); });
    if (addSuperGroupBtn) {
      addSuperGroupBtn.addEventListener('click', () => { store.addSuperGroup(tr('newSuperGroupLabel')); render(); });
    }

    voiceToggle.addEventListener('change', () => { if (!voiceToggle.checked) speaker.stop(); save(); });

    announceBtn.addEventListener('click', () => {
      announceMode = nextAnnounceMode(announceMode);
      announceBtn.textContent = tr(ANNOUNCE_MODE_KEY[announceMode]);
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
    getAnnounceMode: () => announceMode,
    isVoiceOn: () => voiceToggle.checked,
  };
}
