/* 計時器狀態機 — 完全不碰 DOM、不碰 window，時鐘由外部注入。
 *
 * 設計重點：
 *   1. tick() 不直接發聲，而是「回傳事件陣列」，由 UI 層決定怎麼處理。
 *      這樣才能在 Node 裡純邏輯測試到期行為。
 *   2. 循環重啟不用 setTimeout，改成記在 restartAt 上由 tick 判斷，
 *      測試才能用假時鐘瞬間快轉。
 *   3. 最高原則：系統不准懂遊戲。時間軸、合併語音通知的文字、快捷鍵全都是使用者輸入的資料，
 *      這一層只負責「照這串數字算下一個」跟「照這串字唸」，不解讀任何語意。
 *   4. 母群組（supergroup）是選配的第三層，只有新建的母群組才有：母群組 → 子群組（group）→ 單元（timer）。
 *      沒有母群組的舊資料完全是「群組 → 單元」兩層，行為一個位元都不變。
 */

export const COLORS = ['#5EEAD4', '#F0B429', '#C084FC', '#FB7185', '#60A5FA', '#34D399'];
export const LOOP_RESTART_MS = 900;
export const DEFAULT_SEC = 300;

/** 合併語音通知的預設容許誤差（秒） */
export const DEFAULT_TOLERANCE_SEC = 3;
/** 本場長度預設值；時間軸的時間點是掛在這個倒數上的刻度 */
export const DEFAULT_SESSION_SEC = 600;
/** 預設分配給前幾個群組/母群組的快捷鍵。鍵盤按鍵有限，計時器沒有，所以只綁群組層級。 */
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
    /** 使用者手動綁的合併語音通知：同層級（子群組/計時器）兩個東西，時間對上時合併成一次語音 */
    this.links = [];
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
      /** 循環重複時要倒數的秒數；null＝跟 totalSec 一樣（預設行為，第一輪跟之後每輪都一樣長） */
      repeatSec: null,
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
      /** 快捷鍵控制的是這個群組的本輪靜音。巢狀在母群組底下的子群組永遠是 null，
       *  快捷鍵改綁在母群組上，子群組本身不再單獨可指派。 */
      hotkey: null,
      /** 屬於哪個母群組；頂層（舊）群組永遠是 null，行為完全不受母群組機制影響 */
      parentSuperGroupId: null,
    };
  }

  /** 母群組：新的第三層，只有明確新建才會出現。 */
  createSuperGroup(label) {
    return {
      id: this._nextId('sg'),
      kind: 'supergroup',
      label: String(label),
      collapsed: false,
      color: this._nextColor(),
      groups: [],
      /** 快捷鍵按下去＝循環切換下一個子群組有聲音 */
      hotkey: null,
      /** 目前「有聲音」的子群組在 groups 裡的位置 */
      activeGroupIndex: 0,
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

  addSuperGroup(label) {
    const supergroup = this.createSuperGroup(label);
    this.items.push(supergroup);
    return supergroup;
  }

  addTimerToGroup(groupId, label, totalSec = DEFAULT_SEC) {
    const group = this.findGroup(groupId);
    if (!group) return null;
    const timer = this.createTimer(label, totalSec, group.id);
    group.timers.push(timer);
    return timer;
  }

  /** 在母群組底下新增一個子群組。第一個子群組自動「有聲音」；之後加入的不打斷目前循環位置。 */
  addGroupToSuperGroup(superId, label) {
    const supergroup = this.findSuperGroup(superId);
    if (!supergroup) return null;
    const group = this.createGroup(label);
    group.parentSuperGroupId = supergroup.id;
    supergroup.groups.push(group);
    this._applyActiveGroup(supergroup);
    return group;
  }

  /* ---------- 查詢 ---------- */

  /** 攤平成一維計時器陣列（含群組內、母群組→子群組內的） */
  flatten() {
    const all = [];
    for (const it of this.items) {
      if (it.kind === 'timer') all.push(it);
      else if (it.kind === 'group') all.push(...it.timers);
      else if (it.kind === 'supergroup') { for (const g of it.groups) all.push(...g.timers); }
    }
    return all;
  }

  /** 只回傳頂層（舊）群組，不含巢狀在母群組底下的子群組 */
  groups() {
    return this.items.filter(it => it.kind === 'group');
  }

  superGroups() {
    return this.items.filter(it => it.kind === 'supergroup');
  }

  /** 頂層群組 + 所有母群組底下的子群組，連線/選單要看全部群組層級時用這個 */
  allGroups() {
    const all = [...this.groups()];
    for (const sg of this.superGroups()) all.push(...sg.groups);
    return all;
  }

  /** 找群組：頂層群組，或任何母群組底下的子群組 */
  findGroup(gid) {
    const top = this.items.find(it => it.kind === 'group' && it.id === gid);
    if (top) return top;
    for (const sg of this.superGroups()) {
      const g = sg.groups.find(g => g.id === gid);
      if (g) return g;
    }
    return null;
  }

  findSuperGroup(sgid) {
    return this.items.find(it => it.kind === 'supergroup' && it.id === sgid) || null;
  }

  findTimer(tid) {
    return this.flatten().find(t => t.id === tid) || null;
  }

  /** 這個計時器所屬的群組，頂層計時器回傳 null */
  groupOf(timer) {
    return timer.parentGroupId ? this.findGroup(timer.parentGroupId) : null;
  }

  /** 這個群組所屬的母群組，舊群組（不在母群組底下）回傳 null */
  superGroupOf(group) {
    return group && group.parentSuperGroupId ? this.findSuperGroup(group.parentSuperGroupId) : null;
  }

  superGroupOfTimer(timer) {
    return this.superGroupOf(this.groupOf(timer));
  }

  /* ---------- 刪除 ---------- */

  removeTimer(tid) {
    const before = this.flatten().length;
    this.items = this.items.filter(it => !(it.kind === 'timer' && it.id === tid));
    for (const it of this.items) {
      if (it.kind === 'group') it.timers = it.timers.filter(t => t.id !== tid);
      else if (it.kind === 'supergroup') {
        for (const g of it.groups) g.timers = g.timers.filter(t => t.id !== tid);
      }
    }
    const removed = this.flatten().length < before;
    if (removed) this._pruneLinks();
    return removed;
  }

  removeGroup(gid) {
    const beforeTop = this.items.length;
    this.items = this.items.filter(it => !(it.kind === 'group' && it.id === gid));
    let removed = this.items.length < beforeTop;

    if (!removed) {
      for (const sg of this.superGroups()) {
        const before = sg.groups.length;
        sg.groups = sg.groups.filter(g => g.id !== gid);
        if (sg.groups.length < before) {
          removed = true;
          if (sg.activeGroupIndex >= sg.groups.length) sg.activeGroupIndex = Math.max(0, sg.groups.length - 1);
          this._applyActiveGroup(sg);
        }
      }
    }

    if (removed) this._pruneLinks();
    return removed;
  }

  removeSuperGroup(sgid) {
    const before = this.items.length;
    this.items = this.items.filter(it => !(it.kind === 'supergroup' && it.id === sgid));
    const removed = this.items.length < before;
    if (removed) this._pruneLinks();
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

  /** 設定循環重複時要倒數的秒數；傳 null 就是「跟 totalSec 一樣」，取消特別設定 */
  setRepeatSec(timer, repeatSec) {
    timer.repeatSec = repeatSec == null ? null : Math.max(0, Number(repeatSec) || 0);
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

  /** 靜音旗標不會自己消失，只有開場重置會一次清空；母群組的循環也會一起打回第一個子群組 */
  clearMutes() {
    for (const it of this.items) {
      if (it.kind === 'group') {
        it.mutedThisRound = false;
        it.timers.forEach(t => { t.mutedThisRound = false; });
      } else if (it.kind === 'timer') {
        it.mutedThisRound = false;
      } else if (it.kind === 'supergroup') {
        for (const g of it.groups) g.timers.forEach(t => { t.mutedThisRound = false; });
      }
    }
    for (const sg of this.superGroups()) this.resetSuperGroupCycle(sg);
  }

  /* ---------- 母群組：快捷鍵循環子群組 ---------- */

  /** 依 activeGroupIndex 把子群組的本輪靜音全部套好：只有指到的那個有聲音 */
  _applyActiveGroup(supergroup) {
    supergroup.groups.forEach((g, i) => { g.mutedThisRound = i !== supergroup.activeGroupIndex; });
  }

  /** 快捷鍵按一次＝下一個子群組有聲音，其餘子群組靜音，最後一個再按會繞回第一個 */
  cycleActiveGroup(supergroup) {
    if (supergroup.groups.length === 0) return supergroup;
    supergroup.activeGroupIndex = (supergroup.activeGroupIndex + 1) % supergroup.groups.length;
    this._applyActiveGroup(supergroup);
    return supergroup;
  }

  /** 把循環位置打回第一個子群組（開場重置、母群組自己重設都會呼叫這個） */
  resetSuperGroupCycle(supergroup) {
    supergroup.activeGroupIndex = 0;
    this._applyActiveGroup(supergroup);
  }

  /* ---------- 快捷鍵（綁在頂層群組或母群組上，不綁計時器、不綁子群組） ---------- */

  normalizeHotkey(key) {
    if (key === null || key === undefined) return null;
    const k = String(key).trim();
    if (!k) return null;
    return k.length === 1 ? k.toLowerCase() : k;
  }

  /** 目前所有「可以擁有快捷鍵」的對象：頂層群組 + 母群組（巢狀子群組不算） */
  hotkeyOwners() {
    return this.items.filter(it => it.kind === 'group' || it.kind === 'supergroup');
  }

  /** 同一顆鍵只能綁一個對象，設過去會把別人身上的解掉 */
  setHotkey(target, key) {
    const k = this.normalizeHotkey(key);
    if (k) {
      for (const owner of this.hotkeyOwners()) {
        if (owner !== target && owner.hotkey === k) owner.hotkey = null;
      }
    }
    target.hotkey = k;
    return k;
  }

  groupByHotkey(key) {
    const k = this.normalizeHotkey(key);
    if (!k) return null;
    return this.groups().find(g => g.hotkey === k) || null;
  }

  superGroupByHotkey(key) {
    const k = this.normalizeHotkey(key);
    if (!k) return null;
    return this.superGroups().find(sg => sg.hotkey === k) || null;
  }

  /**
   * 按下快捷鍵：
   *   - 綁到頂層群組 → 切換那個群組的本輪靜音（跟以前一樣）
   *   - 綁到母群組   → 循環切換下一個子群組有聲音
   *   - 沒綁到       → 什麼都不做
   */
  triggerHotkey(key) {
    const group = this.groupByHotkey(key);
    if (group) { this.toggleMute(group); return group; }
    const supergroup = this.superGroupByHotkey(key);
    if (supergroup) { this.cycleActiveGroup(supergroup); return supergroup; }
    return null;
  }

  /** 依 items 建立順序，把預設鍵發給還沒有快捷鍵的頂層群組/母群組；已經設過的不動 */
  assignDefaultHotkeys(keys = DEFAULT_HOTKEYS) {
    const owners = this.hotkeyOwners();
    const used = new Set(owners.map(o => o.hotkey).filter(Boolean));
    const free = keys.map(k => this.normalizeHotkey(k)).filter(k => k && !used.has(k));
    for (const owner of owners) {
      if (owner.hotkey) continue;
      const k = free.shift();
      if (!k) break;
      owner.hotkey = k;
    }
    return owners.filter(o => o.hotkey);
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
    for (const g of this.allGroups()) if (g.timelineId === id) g.timelineId = null;
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
        this._pruneLinks();
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

  /** 母群組重設：底下所有子群組的計時器一起歸位，循環位置也打回第一個子群組。 */
  resetSuperGroup(supergroup) {
    for (const g of supergroup.groups) this.batchReset(g.timers);
    this.resetSuperGroupCycle(supergroup);
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

  /**
   * 全域快進/倒退：所有計時器的剩餘時間一起 ±deltaSec，模擬「假設現實世界快進/倒退幾秒」
   * （遊戲中太慢才按全部開始，用這個補回錯過的時間）。
   * 正在跑的計時器就地扣/加秒數，扣到 <=0 會照正常到期流程處理（含事件、循環、連線合併）；
   * 沒在跑的（暫停或還沒開始）只調整 remainingSec，不觸發到期，夾在 [0, totalSec] 之間。
   * 已經完全結束、不會再重啟的（done 且沒有 restartAt）不受影響——時間已經到了，不該被快進/倒退再去動它。
   * 循環中正在等待自動重啟的（restartAt 不是 null）仍然要跟著調整等待時間，不然自動重啟的時機會跟真實時間對不上。
   * @param {number} deltaSec 正值＝倒退（多留時間），負值＝快進（少留時間）
   * @returns {Array} 跟 tick() 一樣格式的事件陣列
   */
  nudgeAll(deltaSec, list = this.flatten(), now = this.now()) {
    const dt = Number(deltaSec) || 0;
    const events = [];
    if (dt === 0) return events;

    for (const timer of list) {
      if (timer.restartAt !== null) {
        timer.restartAt += dt * 1000;
        continue;
      }
      if (timer.done) continue;
      if (timer.running) {
        timer.remainingSec += dt;
        if (timer.remainingSec <= 0) {
          this._expire(timer, now);
          events.push(this._expiredEvent(timer));
        }
        continue;
      }
      timer.remainingSec = Math.max(0, Math.min(timer.totalSec, timer.remainingSec + dt));
    }

    this._applyLinking(events, now);
    return events;
  }

  /* ---------- 合併語音通知 ---------- */

  /**
   * 找某個層級目前有效的實體清單（給連線驗證/選單排除用）。
   * 只支援子群組跟單元兩層——母群組本身沒有自己的靜音狀態（有聲音的是它底下的子群組），
   * 連在母群組上會沒辦法判斷「兩邊是否都沒被靜音」，所以連線不開放母群組層級。
   * @param {'group'|'timer'} level
   */
  _entitiesOfLevel(level) {
    if (level === 'group') return this.allGroups();
    if (level === 'timer') return this.flatten();
    return [];
  }

  /**
   * 手動連線同一層級的兩個群組/計時器——一條連線永遠剛好兩個成員，程式只做兩兩配對，
   * 給超過兩個或少於兩個都直接擋下。子連子、單元連單元——不同層級不能連在一起。
   * 只有連線兩邊目前都沒被靜音時，才會去檢查底下的計時器是不是在容許誤差內幾乎同時到期；
   * 只要有一邊被靜音，這筆連線這一輪就當作不存在——不搜尋、不強制歸零、各自正常倒數。
   * @param {'group'|'timer'} level
   * @param {string[]} ids 必須剛好兩個
   * @param {string} text 合併時要唸的字，由使用者自己打
   * @param {number} toleranceSec 容許誤差
   */
  addLink(level, ids, text, toleranceSec = DEFAULT_TOLERANCE_SEC) {
    if (level !== 'group' && level !== 'timer') return null;
    const alive = new Set(this._entitiesOfLevel(level).map(e => e.id));
    const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).filter(id => alive.has(id)))];
    if (uniqueIds.length !== 2) return null;

    // 同一層級裡一個東西只能屬於一組連線，重綁時先從舊的拿掉
    for (const link of this.links) {
      if (link.level === level) link.memberIds = link.memberIds.filter(id => !uniqueIds.includes(id));
    }
    this.links = this.links.filter(l => l.memberIds.length === 2);

    const tol = Number(toleranceSec);
    const link = {
      id: this._nextId('lk'),
      level,
      memberIds: uniqueIds,
      text: String(text ?? ''),
      toleranceSec: Number.isFinite(tol) && tol >= 0 ? tol : DEFAULT_TOLERANCE_SEC,
    };
    this.links.push(link);
    return link;
  }

  removeLink(lid) {
    const before = this.links.length;
    this.links = this.links.filter(l => l.id !== lid);
    return this.links.length < before;
  }

  /** 這個東西在這個層級上是否連線；回傳連線物件或 null */
  linkOf(entity, level) {
    if (!entity) return null;
    return this.links.find(l => l.level === level && l.memberIds.includes(entity.id)) || null;
  }

  /** 這個層級目前已經被連走的 id 集合，UI 選單用來排除已連線的選項 */
  linkedIds(level) {
    const ids = new Set();
    for (const l of this.links) if (l.level === level) for (const id of l.memberIds) ids.add(id);
    return ids;
  }

  linkMembers(link) {
    return link.memberIds.map(id => this._entitiesOfLevel(link.level).find(e => e.id === id)).filter(Boolean);
  }

  /** 這個連線成員底下實際會倒數的計時器：標籤本身，或群組內全部 */
  _timersOfLinkMember(level, id) {
    if (level === 'timer') {
      const t = this.findTimer(id);
      return t ? [t] : [];
    }
    if (level === 'group') {
      const g = this.allGroups().find(x => x.id === id);
      return g ? g.timers : [];
    }
    return [];
  }

  /** 這個計時器往上找，屬於哪一筆連線（先看標籤本身，再看它的群組） */
  _linkMemberOf(timer) {
    let link = this.links.find(l => l.level === 'timer' && l.memberIds.includes(timer.id));
    if (link) return { level: 'timer', id: timer.id, link };

    const group = this.groupOf(timer);
    if (group) {
      link = this.links.find(l => l.level === 'group' && l.memberIds.includes(group.id));
      if (link) return { level: 'group', id: group.id, link };
    }
    return null;
  }

  /** 群組/計時器被刪掉之後，剩不到兩個成員的連線就不成立了 */
  _pruneLinks() {
    this.links = this.links
      .map(l => {
        const alive = new Set(this._entitiesOfLevel(l.level).map(e => e.id));
        return { ...l, memberIds: l.memberIds.filter(id => alive.has(id)) };
      })
      .filter(l => l.memberIds.length === 2);
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
      /** 這一聲被別人的合併語音吃掉了，不要重複唸 */
      suppressed: false,
      /** 合併語音要唸的字（只掛在代表事件上），已經是最終要唸的整句話 */
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
          timer.remainingSec = timer.repeatSec != null ? timer.repeatSec : timer.totalSec;
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
    this._applyLinking(events, now);
    return events;
  }

  /**
   * 合併語音通知：這個到期的計時器如果屬於某筆連線，就去看連線的另一邊（一定剛好只有一個成員）
   * 底下有沒有計時器也快到期：
   *   - 誤差內／同一格一起到期 → 合併成一次語音：連線文字 + 兩邊各自的標籤（標籤相同就只唸一次）
   *   - 沒對上時間 → 什麼都不做，各自照原本的名字唸
   * 快的先到 0，回頭看另一邊還剩幾秒；寧可提前一兩秒，也不要為了等慢的而延後提醒。
   *
   * 靜音是「這筆連線這一輪根本不存在」，不是「合併了但不出聲」：
   *   - 這個計時器自己被靜音（本輪靜音，或所屬群組本輪靜音）就直接跳過，
   *     連搜尋都不做——不會去動連線另一邊的計時器，更不會把它強制歸零。
   *   - 連線另一邊的候選計時器如果被靜音，一開始就不列入候選，
   *     不管時間對不對上都不會被強制歸零，繼續照自己的步調倒數。
   */
  _applyLinking(events, now) {
    if (this.links.length === 0) return;

    const byTimer = new Map();
    for (const ev of events) if (ev.type === 'expired') byTimer.set(ev.timer.id, ev);
    if (byTimer.size === 0) return;

    const handled = new Set();
    const leaders = [...byTimer.values()];

    for (const ev of leaders) {
      if (handled.has(ev.timer.id)) continue;
      handled.add(ev.timer.id);

      // 自己被靜音：這筆連線這一輪不存在，不搜尋、不動另一邊
      if (this.isSilenced(ev.timer)) continue;

      const member = this._linkMemberOf(ev.timer);
      if (!member) continue;
      const { link } = member;

      const otherId = link.memberIds.find(id => id !== member.id);
      // 另一邊也被靜音的候選一律不列入候選，不管時間對不對上都不會被強制歸零
      const partnerTimers = otherId
        ? this._timersOfLinkMember(link.level, otherId).filter(t => !this.isSilenced(t))
        : [];

      const partners = [];
      for (const other of partnerTimers) {
        if (other.id === ev.timer.id || handled.has(other.id)) continue;

        if (byTimer.has(other.id)) {
          // 同一格一起到期，本來就該合併
          partners.push(other);
          handled.add(other.id);
          continue;
        }
        if (other.running && other.remainingSec > 0 && other.remainingSec <= link.toleranceSec + EPS) {
          this._expire(other, now);
          const forcedEv = this._expiredEvent(other, true);
          events.push(forcedEv);
          byTimer.set(other.id, forcedEv);
          partners.push(other);
          handled.add(other.id);
        }
        // 超出誤差：什麼都不做，它晚點自己到期再唸自己本來的名字
      }

      if (partners.length === 0) continue;

      const speaking = [ev.timer, ...partners];
      const leaderEv = byTimer.get(speaking[0].id);
      leaderEv.mergedText = this._mergedLinkText(link, speaking);
      leaderEv.mergedWith = speaking.slice(1);
      for (const t of speaking.slice(1)) byTimer.get(t.id).suppressed = true;
    }
  }

  /**
   * 連線合併時實際要唸的字：
   *   - 單元層級連線：直接唸使用者填的字，不加任何標籤
   *     （這一層本來就是最細的，底下沒有更細的東西可以附加）。
   *   - 子群組層級連線：使用者填的字 + 這次合併到的每個計時器自己的標籤，
   *     標籤字串相同的只算一次（先出現的算數），順序依合併順序。
   */
  _mergedLinkText(link, speaking) {
    if (link.level === 'timer') return link.text;
    const labels = [];
    for (const t of speaking) if (!labels.includes(t.label)) labels.push(t.label);
    return [link.text, ...labels].join(' ');
  }

  /* ---------- 序列化 ---------- */

  /**
   * 任何東西（母群組/群組/計時器）在 items 裡的位置路徑。id 每次載入都會重編，所以連線用位置存。
   * 深度：
   *   [i]       頂層母群組 / 頂層群組 / 頂層計時器
   *   [i, j]    群組內計時器　或　母群組內第 j 個子群組
   *   [i, j, k] 母群組內第 j 個子群組裡的第 k 個計時器
   */
  pathOfId(id) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.id === id) return [i];
      if (it.kind === 'group') {
        const j = it.timers.findIndex(t => t.id === id);
        if (j >= 0) return [i, j];
      } else if (it.kind === 'supergroup') {
        for (let j = 0; j < it.groups.length; j++) {
          if (it.groups[j].id === id) return [i, j];
          const k = it.groups[j].timers.findIndex(t => t.id === id);
          if (k >= 0) return [i, j, k];
        }
      }
    }
    return null;
  }

  entityAtPath(path) {
    if (!Array.isArray(path) || path.length === 0) return null;
    const it = this.items[path[0]];
    if (!it) return null;
    if (path.length === 1) return it;
    if (it.kind === 'group') return it.timers[path[1]] || null;
    if (it.kind === 'supergroup') {
      const g = it.groups[path[1]];
      if (!g) return null;
      if (path.length === 2) return g;
      return g.timers[path[2]] || null;
    }
    return null;
  }

  /** 只存「使用者設定」，不存當下的倒數/循環/收合/靜音狀態（刻意的） */
  toJSON() {
    const serializeTimer = x => {
      const out = { label: x.label, totalSec: x.totalSec };
      if (x.repeatSec != null) out.repeatSec = x.repeatSec;
      return out;
    };
    const serializeGroup = g => {
      const out = { label: g.label, timers: g.timers.map(serializeTimer) };
      const tlIdx = this.timelines.findIndex(x => x.id === g.timelineId);
      if (tlIdx >= 0) out.tl = tlIdx;
      return out;
    };
    return this.items.map(it => {
      if (it.kind === 'timer') return { ...serializeTimer(it), kind: 'timer' };
      if (it.kind === 'supergroup') {
        const sg = { kind: 'supergroup', label: it.label, groups: it.groups.map(serializeGroup) };
        if (it.hotkey) sg.key = it.hotkey;
        return sg;
      }
      const g = serializeGroup(it);
      g.kind = 'group';
      if (it.hotkey) g.key = it.hotkey;
      return g;
    });
  }

  /** 時間軸、連線、本場長度。跟 toJSON() 分開，免得動到既有的 items 格式。 */
  extrasJSON() {
    return {
      sessionSec: this.session.lengthSec,
      timelines: this.timelines.map(tl => ({ name: tl.name, points: tl.points })),
      links: this.links
        .map(l => ({
          level: l.level,
          text: l.text,
          tol: l.toleranceSec,
          members: l.memberIds.map(id => this.pathOfId(id)).filter(Boolean),
        }))
        .filter(l => l.members.length >= 2),
    };
  }

  /**
   * 從序列化資料重建。壞掉的欄位會被補上預設值而不是整包丟掉。
   * @param {Array} data
   * @param {{timerLabel:string, groupLabel:string}} fallback 預設標籤（依語言不同）
   */
  loadJSON(data, fallback = { timerLabel: 'Timer', groupLabel: 'Group' }) {
    this.items = [];
    this.links = [];
    if (!Array.isArray(data)) return this;

    const loadGroupTimers = (g, timers) => {
      for (const tt of Array.isArray(timers) ? timers : []) {
        if (!tt || typeof tt !== 'object') continue;
        const timer = this.addTimerToGroup(g.id, tt.label || fallback.timerLabel, num(tt.totalSec));
        if (tt.repeatSec != null) this.setRepeatSec(timer, num(tt.repeatSec));
      }
    };

    for (const it of data) {
      if (!it || typeof it !== 'object') continue;
      if (it.kind === 'supergroup') {
        const sg = this.addSuperGroup(it.label || fallback.groupLabel);
        if (it.key) this.setHotkey(sg, it.key);
        for (const gg of Array.isArray(it.groups) ? it.groups : []) {
          if (!gg || typeof gg !== 'object') continue;
          const g = this.addGroupToSuperGroup(sg.id, gg.label || fallback.groupLabel);
          const tl = this.timelines[Number(gg.tl)];
          if (tl) g.timelineId = tl.id;
          loadGroupTimers(g, gg.timers);
        }
      } else if (it.kind === 'group') {
        const g = this.addGroup(it.label || fallback.groupLabel);
        const tl = this.timelines[Number(it.tl)];
        if (tl) g.timelineId = tl.id;
        if (it.key) this.setHotkey(g, it.key);
        loadGroupTimers(g, it.timers);
      } else {
        const timer = this.addTimer(it.label || fallback.timerLabel, num(it.totalSec));
        if (it.repeatSec != null) this.setRepeatSec(timer, num(it.repeatSec));
      }
    }
    return this;
  }

  /**
   * 完整還原（時間軸 → 計時器 → 連線，順序不能反：
   * 群組要靠時間軸索引找回模板，連線要靠位置找回成員）。
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

    this.links = [];
    const rawLinks = Array.isArray(s.links) ? s.links : [];
    for (const l of rawLinks) {
      if (!l || typeof l !== 'object') continue;
      const members = (Array.isArray(l.members) ? l.members : [])
        .map(path => this.entityAtPath(path))
        .filter(Boolean);
      if (members.length < 2) continue;
      this.addLink(l.level, members.map(e => e.id), l.text, l.tol);
    }

    return this;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SEC;
}
