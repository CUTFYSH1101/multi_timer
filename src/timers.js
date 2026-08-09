/* 計時器狀態機 — 完全不碰 DOM、不碰 window，時鐘由外部注入。
 *
 * 設計重點：
 *   1. tick() 不直接發聲，而是「回傳事件陣列」，由 UI 層決定怎麼處理。
 *      這樣才能在 Node 裡純邏輯測試到期行為。
 *   2. 循環重啟不用 setTimeout，改成記在 restartAt 上由 tick 判斷，
 *      測試才能用假時鐘瞬間快轉。
 *   3. 最高原則：系統不准懂遊戲。時間軸、配對合併文字、快捷鍵全都是使用者輸入的資料，
 *      這一層只負責「照這串數字算下一個」跟「照這串字唸」，不解讀任何語意。
 */

export const COLORS = ['#5EEAD4', '#F0B429', '#C084FC', '#FB7185', '#60A5FA', '#34D399'];
export const LOOP_RESTART_MS = 900;
export const DEFAULT_SEC = 300;

/** 配對合併的預設容許誤差（秒） */
export const DEFAULT_TOLERANCE_SEC = 3;
/** 本場長度預設值；時間軸的時間點是掛在這個倒數上的刻度 */
export const DEFAULT_SESSION_SEC = 600;
/** 預設分配給前幾個群組的快捷鍵。鍵盤按鍵有限，計時器沒有，所以只綁群組。 */
export const DEFAULT_HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8'];

const EPS = 1e-6;

/** 時間點正規化：去掉壞值與重複，由大到小排（跟使用者輸入「8:50, 7:20, 6:00」的習慣順序一致） */
export function sortPoints(points) {
  const clean = (Array.isArray(points) ? points : [])
    .map(Number)
    .filter(n => Number.isFinite(n) && n >= 0);
  return [...new Set(clean)].sort((a, b) => b - a);
}

export class TimerStore {
  /** @param {{now?: () => number}} opts now() 需回傳毫秒 */
  constructor(opts = {}) {
    this.now = opts.now || (() => Date.now());
    this.items = [];
    /** 使用者自建的時間軸模板 */
    this.timelines = [];
    /** 使用者手動綁的配對（絕不由系統自己猜） */
    this.pairs = [];
    /** 本場長度：時間軸模板套用時，拿它當「本場長度－時間點」的換算基準 */
    this.session = { lengthSec: DEFAULT_SESSION_SEC };
    this._id = 0;
    this._color = 0;
  }

  /* ---------- 建立 ---------- */

  _nextId(prefix) { return prefix + (this._id++); }
  _nextColor() { return COLORS[(this._color++) % COLORS.length]; }

  createTimer(label, totalSec, parentGroupId = null) {
    const sec = Math.max(0, Number(totalSec) || 0);
    return {
      id: this._nextId('t'),
      kind: 'timer',
      label: String(label),
      totalSec: sec,
      remainingSec: sec,
      running: false,
      loop: false,
      done: false,
      restartAt: null,
      lastTick: null,
      color: this._nextColor(),
      parentGroupId,
      /** 本輪靜音：只影響「到期那一刻出不出聲」，倒數完全不受影響 */
      mutedThisRound: false,
    };
  }

  createGroup(label) {
    return {
      id: this._nextId('g'),
      kind: 'group',
      label: String(label),
      collapsed: false,
      color: this._nextColor(),
      timers: [],
      mutedThisRound: false,
      /** 掛哪一張時間軸模板；null = 不掛，行為跟以前完全一樣 */
      timelineId: null,
      /** 快捷鍵控制的是這個群組的本輪靜音 */
      hotkey: null,
    };
  }

  addTimer(label, totalSec = DEFAULT_SEC) {
    const timer = this.createTimer(label, totalSec, null);
    this.items.push(timer);
    return timer;
  }

  addGroup(label) {
    const group = this.createGroup(label);
    this.items.push(group);
    return group;
  }

  addTimerToGroup(groupId, label, totalSec = DEFAULT_SEC) {
    const group = this.findGroup(groupId);
    if (!group) return null;
    const timer = this.createTimer(label, totalSec, group.id);
    group.timers.push(timer);
    return timer;
  }

  /* ---------- 查詢 ---------- */

  /** 攤平成一維計時器陣列（含群組內的） */
  flatten() {
    const all = [];
    for (const it of this.items) {
      if (it.kind === 'timer') all.push(it);
      else all.push(...it.timers);
    }
    return all;
  }

  groups() {
    return this.items.filter(it => it.kind === 'group');
  }

  findGroup(gid) {
    return this.items.find(it => it.kind === 'group' && it.id === gid) || null;
  }

  findTimer(tid) {
    return this.flatten().find(t => t.id === tid) || null;
  }

  /** 這個計時器所屬的群組，頂層計時器回傳 null */
  groupOf(timer) {
    return timer.parentGroupId ? this.findGroup(timer.parentGroupId) : null;
  }

  /* ---------- 刪除 ---------- */

  removeTimer(tid) {
    const before = this.flatten().length;
    this.items = this.items.filter(it => !(it.kind === 'timer' && it.id === tid));
    for (const it of this.items) {
      if (it.kind === 'group') it.timers = it.timers.filter(t => t.id !== tid);
    }
    const removed = this.flatten().length < before;
    if (removed) this._prunePairs();
    return removed;
  }

  removeGroup(gid) {
    const before = this.items.length;
    this.items = this.items.filter(it => it.id !== gid);
    const removed = this.items.length < before;
    if (removed) this._prunePairs();
    return removed;
  }

  /* ---------- 單一計時器操作 ---------- */

  /** 開始 / 從暫停處繼續。已歸零或已到期的會先回填成完整時間。 */
  start(timer, now = this.now()) {
    if (timer.remainingSec <= 0 || timer.done) timer.remainingSec = timer.totalSec;
    timer.done = false;
    timer.restartAt = null;
    timer.running = true;
    timer.lastTick = now;
    return timer;
  }

  /** 暫停。remainingSec 原封不動保留，繼續時才會從這裡接下去。 */
  pause(timer) {
    timer.running = false;
    timer.restartAt = null;
    timer.lastTick = null;
    return timer;
  }

  reset(timer) {
    timer.running = false;
    timer.done = false;
    timer.restartAt = null;
    timer.lastTick = null;
    timer.remainingSec = timer.totalSec;
    return timer;
  }

  toggleLoop(timer) {
    timer.loop = !timer.loop;
    if (!timer.loop) timer.restartAt = null;
    return timer;
  }

  /** 改長度時，沒在跑的計時器剩餘時間也一起跟上 */
  setDuration(timer, totalSec) {
    const sec = Math.max(0, Number(totalSec) || 0);
    timer.totalSec = sec;
    if (!timer.running) timer.remainingSec = sec;
    return timer;
  }

  /* ---------- 本輪靜音 ---------- */

  /**
   * 切換本輪靜音。群組跟單元都可以叫，因為兩邊都有 mutedThisRound。
   * 刻意不碰 running / remainingSec：靜音、暫停、停止是三件不同的事。
   */
  toggleMute(target) {
    target.mutedThisRound = !target.mutedThisRound;
    return target.mutedThisRound;
  }

  setMute(target, value) {
    target.mutedThisRound = !!value;
    return target.mutedThisRound;
  }

  /** 群組靜音蓋過單元靜音：勾了群組，底下全部這輪都不唸 */
  isSilenced(timer) {
    const group = this.groupOf(timer);
    if (group && group.mutedThisRound) return true;
    return !!timer.mutedThisRound;
  }

  /** 靜音旗標不會自己消失，只有開場重置會一次清空 */
  clearMutes() {
    for (const it of this.items) {
      it.mutedThisRound = false;
      if (it.kind === 'group') it.timers.forEach(t => { t.mutedThisRound = false; });
    }
  }

  /* ---------- 快捷鍵（綁群組，不綁計時器） ---------- */

  normalizeHotkey(key) {
    if (key === null || key === undefined) return null;
    const k = String(key).trim();
    if (!k) return null;
    return k.length === 1 ? k.toLowerCase() : k;
  }

  /** 同一顆鍵只能綁一個群組，設過去會把別人身上的解掉 */
  setHotkey(group, key) {
    const k = this.normalizeHotkey(key);
    if (k) {
      for (const g of this.groups()) {
        if (g !== group && g.hotkey === k) g.hotkey = null;
      }
    }
    group.hotkey = k;
    return k;
  }

  groupByHotkey(key) {
    const k = this.normalizeHotkey(key);
    if (!k) return null;
    return this.groups().find(g => g.hotkey === k) || null;
  }

  /** 按下快捷鍵 = 切換那個群組的本輪靜音。沒綁到就什麼都不做。 */
  triggerHotkey(key) {
    const group = this.groupByHotkey(key);
    if (!group) return null;
    this.toggleMute(group);
    return group;
  }

  /** 依建立順序把預設鍵發給還沒有快捷鍵的群組；已經設過的不動 */
  assignDefaultHotkeys(keys = DEFAULT_HOTKEYS) {
    const used = new Set(this.groups().map(g => g.hotkey).filter(Boolean));
    const free = keys.map(k => this.normalizeHotkey(k)).filter(k => k && !used.has(k));
    for (const g of this.groups()) {
      if (g.hotkey) continue;
      const k = free.shift();
      if (!k) break;
      g.hotkey = k;
    }
    return this.groups().filter(g => g.hotkey);
  }

  /* ---------- 時間軸模板 ---------- */

  addTimeline(name, points = []) {
    const tl = { id: this._nextId('tl'), name: String(name), points: sortPoints(points) };
    this.timelines.push(tl);
    return tl;
  }

  findTimeline(id) {
    return this.timelines.find(x => x.id === id) || null;
  }

  setTimelinePoints(timeline, points) {
    timeline.points = sortPoints(points);
    return timeline;
  }

  removeTimeline(id) {
    const before = this.timelines.length;
    this.timelines = this.timelines.filter(x => x.id !== id);
    for (const g of this.groups()) if (g.timelineId === id) g.timelineId = null;
    return this.timelines.length < before;
  }

  /** 群組掛的時間軸；沒掛回傳 null */
  timelineOf(group) {
    return group && group.timelineId ? this.findTimeline(group.timelineId) : null;
  }

  timelineOfTimer(timer) {
    return this.timelineOf(this.groupOf(timer));
  }

  /** 純設定 group.timelineId，不動任何計時器。loadJSON 還原存檔用的就是這個。 */
  attachTimeline(group, timelineId) {
    group.timelineId = timelineId && this.findTimeline(timelineId) ? timelineId : null;
    return group.timelineId;
  }

  /* ---------- 本場 ---------- */

  setSessionLength(sec) {
    const n = Number(sec);
    this.session.lengthSec = Number.isFinite(n) && n > 0 ? n : DEFAULT_SESSION_SEC;
    return this.session.lengthSec;
  }

  /**
   * 套用時間軸模板前先算一次，讓 UI 知道會不會刪計時器（好跳出確認框）。
   * 換算是一次性的靜態計算：每個時間點 → 本場長度－時間點 ＝ 倒數秒數，
   * 跟本場時鐘有沒有在跑、跑到哪完全無關。
   */
  planTimelineApply(group, timelineId) {
    const tl = timelineId ? this.findTimeline(timelineId) : null;
    if (!tl) return { timeline: null, durations: [], deleteCount: 0 };
    const durations = tl.points.map(p => Math.max(0, this.session.lengthSec - p));
    const deleteCount = Math.max(0, group.timers.length - durations.length);
    return { timeline: tl, durations, deleteCount };
  }

  /**
   * 套用時間軸模板：把模板的時間點依序換算成群組內計時器的長度，一次性設定好，
   * 不是持續追蹤的關係——套用完之後改本場長度或模板點數，不會回頭更新已經算好的計時器。
   *
   * 群組沒有計時器：依點數生出新的計時器。
   * 計時器比點數少：只套用前面幾個點，多的點不用。
   * 計時器比點數多：多出來的計時器會被刪掉（呼叫前應該先用 planTimelineApply 問過使用者）。
   *
   * 套用之後這個群組的計時器時間就「鎖住」了（不能再手動編輯），
   * 直到把時間軸改回不掛才能再手動打時間。
   */
  applyTimelineTemplate(group, timelineId, defaultLabel = 'Timer') {
    const plan = this.planTimelineApply(group, timelineId);
    if (!plan.timeline) {
      this.attachTimeline(group, null);
      return { attached: null, created: 0, updated: 0, deleted: 0 };
    }

    const { durations } = plan;
    const n = durations.length;
    let created = 0;
    let updated = 0;
    let deleted = 0;

    if (group.timers.length === 0) {
      for (let i = 0; i < n; i++) {
        const timer = this.createTimer(defaultLabel + ' ' + (i + 1), durations[i], group.id);
        group.timers.push(timer);
        created++;
      }
    } else {
      const applyCount = Math.min(group.timers.length, n);
      for (let i = 0; i < applyCount; i++) {
        this.setDuration(group.timers[i], durations[i]);
        this.reset(group.timers[i]);
        updated++;
      }
      if (group.timers.length > n) {
        deleted = group.timers.length - n;
        group.timers.splice(n);
        this._prunePairs();
      }
    }

    this.attachTimeline(group, plan.timeline.id);
    return { attached: plan.timeline, created, updated, deleted };
  }

  /* ---------- 批次操作 ---------- */

  batchStart(list, now = this.now()) { list.forEach(t => this.start(t, now)); }
  batchPause(list) { list.forEach(t => this.pause(t)); }
  batchReset(list) { list.forEach(t => this.reset(t)); }

  /** 群組重設：單純把群組內每個計時器設回自己的長度，不會自動開始倒數。 */
  resetGroup(group) {
    this.batchReset(group.timers);
  }

  /**
   * 開場重置：整場重來。這是唯一會清空本輪靜音旗標的動作。
   * 只設定計時器（remainingSec 回到 totalSec），不自動開始倒數。
   */
  resetAll() {
    this.batchReset(this.flatten());
    this.clearMutes();
    return this;
  }

  /** 有任何一個在跑（或正等待循環重啟）→ 全部暫停；否則全部開始 */
  batchToggleStart(list, now = this.now()) {
    const anyActive = list.some(t => t.running || t.restartAt !== null);
    if (anyActive) this.batchPause(list);
    else this.batchStart(list, now);
  }

  /** 全開才會關；否則一律開 */
  batchToggleLoop(list) {
    const allOn = list.length > 0 && list.every(t => t.loop);
    list.forEach(t => {
      t.loop = !allOn;
      if (!t.loop) t.restartAt = null;
    });
  }

  /* ---------- 配對合併播報 ---------- */

  /**
   * 手動綁定一組計時器，到期時間相近就合成一句話唸。
   * @param {string[]} timerIds
   * @param {string} text 合併後要唸的字，由使用者自己打（程式不負責把標籤兜起來）
   * @param {number} toleranceSec 容許誤差
   */
  addPair(timerIds, text, toleranceSec = DEFAULT_TOLERANCE_SEC) {
    const ids = [...new Set((Array.isArray(timerIds) ? timerIds : []).filter(id => this.findTimer(id)))];
    if (ids.length < 2) return null;
    // 一個計時器只能屬於一組配對，重綁時先從舊的拿掉
    for (const p of this.pairs) p.timerIds = p.timerIds.filter(id => !ids.includes(id));
    this.pairs = this.pairs.filter(p => p.timerIds.length >= 2);

    const tol = Number(toleranceSec);
    const pair = {
      id: this._nextId('p'),
      timerIds: ids,
      text: String(text ?? ''),
      toleranceSec: Number.isFinite(tol) && tol >= 0 ? tol : DEFAULT_TOLERANCE_SEC,
    };
    this.pairs.push(pair);
    return pair;
  }

  removePair(pid) {
    const before = this.pairs.length;
    this.pairs = this.pairs.filter(p => p.id !== pid);
    return this.pairs.length < before;
  }

  pairOf(timer) {
    return this.pairs.find(p => p.timerIds.includes(timer.id)) || null;
  }

  pairMembers(pair) {
    return pair.timerIds.map(id => this.findTimer(id)).filter(Boolean);
  }

  /** 計時器被刪掉之後，剩不到兩個成員的配對就不成立了 */
  _prunePairs() {
    const alive = new Set(this.flatten().map(t => t.id));
    this.pairs = this.pairs
      .map(p => ({ ...p, timerIds: p.timerIds.filter(id => alive.has(id)) }))
      .filter(p => p.timerIds.length >= 2);
  }

  /* ---------- 時間推進 ---------- */

  _expire(timer, now) {
    timer.remainingSec = 0;
    timer.running = false;
    timer.done = true;
    if (timer.loop) timer.restartAt = now + LOOP_RESTART_MS;
  }

  _expiredEvent(timer, forced = false) {
    return {
      type: 'expired',
      timer,
      group: this.groupOf(timer),
      forced,
      /** 本輪靜音 → 到期那一刻不出聲（但事件照發，畫面還是要閃） */
      silent: this.isSilenced(timer),
      /** 這一聲被別人的合併播報吃掉了，不要重複唸 */
      suppressed: false,
      /** 合併播報的字（只掛在代表事件上） */
      mergedText: null,
      /** 一起被合併進來的其他計時器 */
      mergedWith: [],
    };
  }

  /**
   * 推進到 now，回傳這一格內發生的事件。
   * @returns {Array<{type:'expired'|'restart', timer:object, group:object|null}>}
   */
  tick(now = this.now()) {
    const events = [];
    for (const timer of this.flatten()) {
      // 循環等待中：單純重新倒數同一個長度，不管有沒有掛時間軸都一樣
      if (timer.restartAt !== null) {
        if (now >= timer.restartAt) {
          timer.restartAt = null;
          timer.remainingSec = timer.totalSec;
          timer.done = false;
          timer.running = true;
          timer.lastTick = now;
          events.push({ type: 'restart', timer, group: this.groupOf(timer) });
        }
        continue;
      }

      if (!timer.running) continue;

      const dt = (now - (timer.lastTick ?? now)) / 1000;
      timer.lastTick = now;
      timer.remainingSec -= dt;

      if (timer.remainingSec <= 0) {
        this._expire(timer, now);
        events.push(this._expiredEvent(timer));
      }
    }
    this._applyPairing(events, now);
    return events;
  }

  /**
   * 配對合併：快的先到 0，回頭看配對對象還剩幾秒。
   *   - 超出容許誤差 → 各唸各的
   *   - 在容許誤差內 → 慢的直接強制歸零，兩個一起只唸一次合併文字
   * 寧可提前一兩秒，也不要為了等慢的而延後提醒。
   */
  _applyPairing(events, now) {
    if (this.pairs.length === 0) return;

    const byTimer = new Map();
    for (const ev of events) if (ev.type === 'expired') byTimer.set(ev.timer.id, ev);
    if (byTimer.size === 0) return;

    const handled = new Set();
    // 只走這一格「自然到期」的事件，強制歸零補進來的不再當代表
    const leaders = [...byTimer.values()];

    for (const ev of leaders) {
      if (handled.has(ev.timer.id)) continue;
      handled.add(ev.timer.id);

      const pair = this.pairOf(ev.timer);
      if (!pair) continue;

      const partners = [];
      for (const other of this.pairMembers(pair)) {
        if (other.id === ev.timer.id || handled.has(other.id)) continue;

        if (byTimer.has(other.id)) {
          // 同一格一起到期，本來就該合併
          partners.push(other);
          handled.add(other.id);
          continue;
        }
        if (other.running && other.remainingSec > 0 && other.remainingSec <= pair.toleranceSec + EPS) {
          this._expire(other, now);
          const forcedEv = this._expiredEvent(other, true);
          events.push(forcedEv);
          byTimer.set(other.id, forcedEv);
          partners.push(other);
          handled.add(other.id);
        }
        // 超出誤差：什麼都不做，它晚點自己到期再唸自己的
      }

      if (partners.length === 0) continue;

      // 被靜音的不參與合併——不然「上路」這輪不去卻聽到合併文字，等於靜音沒效果
      const speaking = [ev.timer, ...partners].filter(t => !this.isSilenced(t));
      if (speaking.length < 2) continue;

      const leaderEv = byTimer.get(speaking[0].id);
      leaderEv.mergedText = pair.text;
      leaderEv.mergedWith = speaking.slice(1);
      for (const t of speaking.slice(1)) byTimer.get(t.id).suppressed = true;
    }
  }

  /* ---------- 序列化 ---------- */

  /** 這個計時器在 items 裡的位置。id 每次載入都會重編，所以配對用位置存。 */
  pathOfTimer(timer) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.kind === 'timer') {
        if (it.id === timer.id) return [i];
      } else {
        const j = it.timers.findIndex(t => t.id === timer.id);
        if (j >= 0) return [i, j];
      }
    }
    return null;
  }

  timerAtPath(path) {
    if (!Array.isArray(path) || path.length === 0) return null;
    const it = this.items[path[0]];
    if (!it) return null;
    if (path.length === 1) return it.kind === 'timer' ? it : null;
    return it.kind === 'group' ? (it.timers[path[1]] || null) : null;
  }

  /** 只存「使用者設定」，不存當下的倒數/循環/收合/靜音狀態（刻意的） */
  toJSON() {
    return this.items.map(it => {
      if (it.kind === 'timer') return { kind: 'timer', label: it.label, totalSec: it.totalSec };
      const g = { kind: 'group', label: it.label, timers: it.timers.map(x => ({ label: x.label, totalSec: x.totalSec })) };
      const tlIdx = this.timelines.findIndex(x => x.id === it.timelineId);
      if (tlIdx >= 0) g.tl = tlIdx;
      if (it.hotkey) g.key = it.hotkey;
      return g;
    });
  }

  /** 時間軸、配對、本場長度。跟 toJSON() 分開，免得動到既有的 items 格式。 */
  extrasJSON() {
    return {
      sessionSec: this.session.lengthSec,
      timelines: this.timelines.map(tl => ({ name: tl.name, points: tl.points })),
      pairs: this.pairs
        .map(p => ({
          text: p.text,
          tol: p.toleranceSec,
          members: this.pairMembers(p).map(t => this.pathOfTimer(t)).filter(Boolean),
        }))
        .filter(p => p.members.length >= 2),
    };
  }

  /**
   * 從序列化資料重建。壞掉的欄位會被補上預設值而不是整包丟掉。
   * @param {Array} data
   * @param {{timerLabel:string, groupLabel:string}} fallback 預設標籤（依語言不同）
   */
  loadJSON(data, fallback = { timerLabel: 'Timer', groupLabel: 'Group' }) {
    this.items = [];
    this.pairs = [];
    if (!Array.isArray(data)) return this;
    for (const it of data) {
      if (!it || typeof it !== 'object') continue;
      if (it.kind === 'group') {
        const g = this.addGroup(it.label || fallback.groupLabel);
        const tl = this.timelines[Number(it.tl)];
        if (tl) g.timelineId = tl.id;
        if (it.key) this.setHotkey(g, it.key);
        const timers = Array.isArray(it.timers) ? it.timers : [];
        for (const tt of timers) {
          if (!tt || typeof tt !== 'object') continue;
          this.addTimerToGroup(g.id, tt.label || fallback.timerLabel, num(tt.totalSec));
        }
      } else {
        this.addTimer(it.label || fallback.timerLabel, num(it.totalSec));
      }
    }
    return this;
  }

  /**
   * 完整還原（時間軸 → 計時器 → 配對，順序不能反：
   * 群組要靠時間軸索引找回模板，配對要靠計時器位置找回成員）。
   */
  loadState(state, fallback = { timerLabel: 'Timer', groupLabel: 'Group' }) {
    const s = state && typeof state === 'object' ? state : {};

    this.timelines = [];
    const rawTimelines = Array.isArray(s.timelines) ? s.timelines : [];
    for (const tl of rawTimelines) {
      if (!tl || typeof tl !== 'object') continue;
      this.addTimeline(tl.name || 'Timeline', tl.points);
    }

    this.setSessionLength(s.sessionSec);
    this.loadJSON(s.items, fallback);

    this.pairs = [];
    const rawPairs = Array.isArray(s.pairs) ? s.pairs : [];
    for (const p of rawPairs) {
      if (!p || typeof p !== 'object') continue;
      const members = (Array.isArray(p.members) ? p.members : [])
        .map(path => this.timerAtPath(path))
        .filter(Boolean);
      if (members.length < 2) continue;
      this.addPair(members.map(t => t.id), p.text, p.tol);
    }
    return this;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SEC;
}
