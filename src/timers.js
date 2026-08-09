/* 計時器狀態機 — 完全不碰 DOM、不碰 window，時鐘由外部注入。
 *
 * 設計重點：
 *   1. tick() 不直接發聲，而是「回傳事件陣列」，由 UI 層決定怎麼處理。
 *      這樣才能在 Node 裡純邏輯測試到期行為。
 *   2. 循環重啟不用 setTimeout，改成記在 restartAt 上由 tick 判斷，
 *      測試才能用假時鐘瞬間快轉。
 */

export const COLORS = ['#5EEAD4', '#F0B429', '#C084FC', '#FB7185', '#60A5FA', '#34D399'];
export const LOOP_RESTART_MS = 900;
export const DEFAULT_SEC = 300;

export class TimerStore {
  /** @param {{now?: () => number}} opts now() 需回傳毫秒 */
  constructor(opts = {}) {
    this.now = opts.now || (() => Date.now());
    this.items = [];
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
    return this.flatten().length < before;
  }

  removeGroup(gid) {
    const before = this.items.length;
    this.items = this.items.filter(it => it.id !== gid);
    return this.items.length < before;
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

  /* ---------- 批次操作 ---------- */

  batchStart(list, now = this.now()) { list.forEach(t => this.start(t, now)); }
  batchPause(list) { list.forEach(t => this.pause(t)); }
  batchReset(list) { list.forEach(t => this.reset(t)); }

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

  /* ---------- 時間推進 ---------- */

  /**
   * 推進到 now，回傳這一格內發生的事件。
   * @returns {Array<{type:'expired'|'restart', timer:object, group:object|null}>}
   */
  tick(now = this.now()) {
    const events = [];
    for (const timer of this.flatten()) {
      // 循環等待中
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
        timer.remainingSec = 0;
        timer.running = false;
        timer.done = true;
        if (timer.loop) timer.restartAt = now + LOOP_RESTART_MS;
        events.push({ type: 'expired', timer, group: this.groupOf(timer) });
      }
    }
    return events;
  }

  /* ---------- 序列化 ---------- */

  /** 只存「使用者設定」，不存當下的倒數/循環/收合狀態（刻意的） */
  toJSON() {
    return this.items.map(it =>
      it.kind === 'timer'
        ? { kind: 'timer', label: it.label, totalSec: it.totalSec }
        : { kind: 'group', label: it.label, timers: it.timers.map(x => ({ label: x.label, totalSec: x.totalSec })) }
    );
  }

  /**
   * 從序列化資料重建。壞掉的欄位會被補上預設值而不是整包丟掉。
   * @param {Array} data
   * @param {{timerLabel:string, groupLabel:string}} fallback 預設標籤（依語言不同）
   */
  loadJSON(data, fallback = { timerLabel: 'Timer', groupLabel: 'Group' }) {
    this.items = [];
    if (!Array.isArray(data)) return this;
    for (const it of data) {
      if (!it || typeof it !== 'object') continue;
      if (it.kind === 'group') {
        const g = this.addGroup(it.label || fallback.groupLabel);
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
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SEC;
}
