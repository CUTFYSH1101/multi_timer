/* 設定面板 — 時間軸模板、配對合併、快捷鍵、本場長度。
 *
 * 為什麼獨立一支：遊戲中最重要的是看計時器，不是看設定，所以這一區預設收起來、
 * 跟主畫面的渲染流程分開，免得把 ui.js 撐爆。
 * 一樣只碰 DOM，不做任何倒數計算。
 */

import { fmt, parseTime, parsePointList, fmtPointList } from './time.js';
import { DEFAULT_TOLERANCE_SEC } from './timers.js';

/**
 * @param {{
 *   doc: Document,
 *   store: import('./timers.js').TimerStore,
 *   tr: (key:string) => string,
 *   onChange: (needsRender?: boolean) => void,
 *   alertFn?: (msg:string) => void,
 * }} config
 */
export function createSettingsPanel(config) {
  const { doc, store, tr, onChange, alertFn = () => {} } = config;

  const panel = doc.getElementById('settingsPanel');
  const toggleBtn = doc.getElementById('settingsBtn');
  let open = false;

  const mk = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  function input(cls, value, placeholder) {
    const e = doc.createElement('input');
    e.className = cls;
    e.value = value ?? '';
    if (placeholder) e.placeholder = placeholder;
    return e;
  }

  function section(titleKey, hintKey) {
    const box = mk('div', 'set-section');
    box.appendChild(mk('h3', null, tr(titleKey)));
    if (hintKey) box.appendChild(mk('p', 'set-hint', tr(hintKey)));
    return box;
  }

  function delButton(onClick) {
    const b = mk('button', 'del-btn', '✕');
    b.title = tr('del');
    b.addEventListener('click', onClick);
    return b;
  }

  /** 計時器在下拉選單裡的顯示名稱：群組名 / 標籤 */
  function timerOptionLabel(timer) {
    const g = store.groupOf(timer);
    return (g ? g.label + ' / ' : '') + timer.label + '  (' + fmt(timer.totalSec) + ')';
  }

  function timerSelect(selectedId) {
    const sel = doc.createElement('select');
    sel.className = 'set-select';
    for (const t of store.flatten()) {
      const o = doc.createElement('option');
      o.value = t.id;
      o.textContent = timerOptionLabel(t);
      if (t.id === selectedId) o.selected = true;
      sel.appendChild(o);
    }
    return sel;
  }

  /* ---------------- 本場長度 ---------------- */

  function buildSession() {
    const box = section('sessionTitle', 'sessionHint');
    const row = mk('div', 'set-row');
    const inp = input('set-time', fmt(store.session.lengthSec));
    inp.addEventListener('change', () => {
      store.setSessionLength(parseTime(inp.value));
      inp.value = fmt(store.session.lengthSec);
      onChange(false);
    });
    row.appendChild(inp);
    box.appendChild(row);
    return box;
  }

  /* ---------------- 時間軸模板 ---------------- */

  function buildTimelines() {
    const box = section('timelinesTitle', 'timelinesHint');

    if (store.timelines.length === 0) box.appendChild(mk('p', 'set-empty', tr('noTimelines')));

    for (const tl of store.timelines) {
      const row = mk('div', 'set-row');

      const name = input('set-name', tl.name, tr('timelineNamePh'));
      name.addEventListener('input', () => { tl.name = name.value || tr('newTimelineLabel'); });
      name.addEventListener('change', () => onChange(true));

      const points = input('set-points', fmtPointList(tl.points), tr('timelinePointsPh'));
      points.addEventListener('change', () => {
        store.setTimelinePoints(tl, parsePointList(points.value));
        points.value = fmtPointList(tl.points);
        onChange(false);
      });

      row.appendChild(name);
      row.appendChild(points);
      row.appendChild(delButton(() => { store.removeTimeline(tl.id); onChange(true); render(); }));
      box.appendChild(row);
    }

    const add = mk('button', 'btn-ghost set-add', tr('addTimeline'));
    add.addEventListener('click', () => {
      store.addTimeline(tr('newTimelineLabel'), []);
      onChange(true);
      render();
    });
    box.appendChild(add);
    return box;
  }

  /* ---------------- 配對合併播報 ---------------- */

  function buildPairs() {
    const box = section('pairsTitle', 'pairsHint');

    if (store.pairs.length === 0) box.appendChild(mk('p', 'set-empty', tr('noPairs')));

    for (const pair of store.pairs) {
      const row = mk('div', 'set-row');

      const members = mk('span', 'set-members',
        store.pairMembers(pair).map(timerOptionLabel).join('  ＋  '));

      const text = input('set-name', pair.text, tr('pairTextPh'));
      text.addEventListener('input', () => { pair.text = text.value; });
      text.addEventListener('change', () => onChange(false));

      const tol = input('set-tol', String(pair.toleranceSec), tr('pairTolPh'));
      tol.addEventListener('change', () => {
        const n = Number(tol.value);
        pair.toleranceSec = Number.isFinite(n) && n >= 0 ? n : DEFAULT_TOLERANCE_SEC;
        tol.value = String(pair.toleranceSec);
        onChange(false);
      });

      row.appendChild(members);
      row.appendChild(text);
      row.appendChild(tol);
      row.appendChild(delButton(() => { store.removePair(pair.id); onChange(false); render(); }));
      box.appendChild(row);
    }

    const all = store.flatten();
    if (all.length >= 2) {
      const addRow = mk('div', 'set-row set-addpair');
      const selA = timerSelect(all[0].id);
      const selB = timerSelect(all[1].id);
      const text = input('set-name', '', tr('pairTextPh'));
      const tol = input('set-tol', String(DEFAULT_TOLERANCE_SEC), tr('pairTolPh'));

      const add = mk('button', 'btn-ghost set-add', tr('addPair'));
      add.addEventListener('click', () => {
        if (selA.value === selB.value) { alertFn(tr('pairNeedTwo')); return; }
        const pair = store.addPair([selA.value, selB.value], text.value, Number(tol.value));
        if (!pair) { alertFn(tr('pairNeedTwo')); return; }
        onChange(false);
        render();
      });

      addRow.appendChild(selA);
      addRow.appendChild(selB);
      addRow.appendChild(text);
      addRow.appendChild(tol);
      addRow.appendChild(add);
      box.appendChild(addRow);
    }

    return box;
  }

  /* ---------------- 快捷鍵 ---------------- */

  function buildHotkeys() {
    const box = section('hotkeysTitle', 'hotkeysHint');
    const groups = store.groups();

    if (groups.length === 0) {
      box.appendChild(mk('p', 'set-empty', tr('noGroups')));
      return box;
    }

    for (const g of groups) {
      const row = mk('div', 'set-row');
      const key = input('set-key', g.hotkey || '', tr('hotkeyPh'));
      key.maxLength = 1;
      key.addEventListener('change', () => {
        store.setHotkey(g, key.value);
        onChange(true);
        render();
      });
      row.appendChild(key);
      row.appendChild(mk('span', 'set-members', g.label));
      box.appendChild(row);
    }

    const assign = mk('button', 'btn-ghost set-add', tr('assignDefaultKeys'));
    assign.addEventListener('click', () => { store.assignDefaultHotkeys(); onChange(true); render(); });
    box.appendChild(assign);
    return box;
  }

  /* ---------------- 組裝 ---------------- */

  function render() {
    if (!panel) return;
    panel.innerHTML = '';
    panel.style.display = open ? 'block' : 'none';
    if (!open) return;
    panel.appendChild(buildSession());
    panel.appendChild(buildTimelines());
    panel.appendChild(buildPairs());
    panel.appendChild(buildHotkeys());
  }

  function setOpen(v) {
    open = !!v;
    if (toggleBtn) toggleBtn.classList.toggle('active', open);
    render();
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => setOpen(!open));
  }

  return {
    render,
    setOpen,
    isOpen: () => open,
    applyLabels() { if (toggleBtn) { toggleBtn.textContent = tr('settings'); toggleBtn.title = tr('settingsTip'); } render(); },
  };
}
