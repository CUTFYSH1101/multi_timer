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

  /** 計時器在下拉選單裡的顯示名稱：（母群組 / ）群組名 / 標籤 */
  function timerOptionLabel(timer) {
    const g = store.groupOf(timer);
    const sg = g ? store.superGroupOf(g) : null;
    const crumbs = [sg && sg.label, g && g.label].filter(Boolean);
    return (crumbs.length ? crumbs.join(' / ') + ' / ' : '') + timer.label + '  (' + fmt(timer.totalSec) + ')';
  }

  /** 群組在下拉選單裡的顯示名稱：（母群組 / ）群組名 */
  function groupOptionLabel(group) {
    const sg = store.superGroupOf(group);
    return (sg ? sg.label + ' / ' : '') + group.label;
  }

  /* ---------------- 連線合併語音：層級共用小工具（只支援子群組/單元，不支援母群組） ---------------- */

  const LINK_LEVELS = ['group', 'timer'];

  function linkLevelLabelKey(level) {
    if (level === 'group') return 'linkLevelGroup';
    return 'linkLevelTimer';
  }

  function entityOptionLabel(level, entity) {
    if (level === 'group') return groupOptionLabel(entity);
    return timerOptionLabel(entity);
  }

  /** 這個層級目前還沒被連走的候選清單 */
  function linkableEntities(level) {
    const linked = store.linkedIds(level);
    const all = level === 'group' ? store.allGroups() : store.flatten();
    return all.filter(e => !linked.has(e.id));
  }

  function entitySelect(level, selectedId) {
    const sel = doc.createElement('select');
    sel.className = 'set-select';
    for (const e of linkableEntities(level)) {
      const o = doc.createElement('option');
      o.value = e.id;
      o.textContent = entityOptionLabel(level, e);
      if (e.id === selectedId) o.selected = true;
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

  /* ---------------- 合併語音通知 ---------------- */

  let linkLevel = 'group';

  function buildLinks() {
    const box = section('linksTitle', 'linksHint');

    if (store.links.length === 0) box.appendChild(mk('p', 'set-empty', tr('noLinks')));

    for (const link of store.links) {
      const row = mk('div', 'set-row');

      const members = mk('span', 'set-members',
        '[' + tr(linkLevelLabelKey(link.level)) + '] ' +
        store.linkMembers(link).map(e => entityOptionLabel(link.level, e)).join('  ＋  '));

      const text = input('set-name', link.text, tr('linkTextPh'));
      text.addEventListener('input', () => { link.text = text.value; });
      text.addEventListener('change', () => onChange(false));

      const tol = input('set-tol', String(link.toleranceSec), tr('linkTolPh'));
      tol.addEventListener('change', () => {
        const n = Number(tol.value);
        link.toleranceSec = Number.isFinite(n) && n >= 0 ? n : DEFAULT_TOLERANCE_SEC;
        tol.value = String(link.toleranceSec);
        onChange(false);
      });

      row.appendChild(members);
      row.appendChild(text);
      row.appendChild(tol);
      row.appendChild(delButton(() => { store.removeLink(link.id); onChange(false); render(); }));
      box.appendChild(row);
    }

    const levelSel = doc.createElement('select');
    levelSel.className = 'set-select';
    for (const lvl of LINK_LEVELS) {
      const o = doc.createElement('option');
      o.value = lvl;
      o.textContent = tr(linkLevelLabelKey(lvl));
      if (lvl === linkLevel) o.selected = true;
      levelSel.appendChild(o);
    }
    levelSel.addEventListener('change', () => { linkLevel = levelSel.value; render(); });

    const candidates = linkableEntities(linkLevel);
    if (candidates.length >= 2) {
      const addRow = mk('div', 'set-row set-addlink');
      const selA = entitySelect(linkLevel, candidates[0].id);
      const selB = entitySelect(linkLevel, candidates[1].id);
      const text = input('set-name', '', tr('linkTextPh'));
      const tol = input('set-tol', String(DEFAULT_TOLERANCE_SEC), tr('linkTolPh'));

      const add = mk('button', 'btn-ghost set-add', tr('addLink'));
      add.addEventListener('click', () => {
        if (selA.value === selB.value) { alertFn(tr('linkNeedTwo')); return; }
        const link = store.addLink(linkLevel, [selA.value, selB.value], text.value, Number(tol.value));
        if (!link) { alertFn(tr('linkNeedTwo')); return; }
        onChange(false);
        render();
      });

      addRow.appendChild(levelSel);
      addRow.appendChild(selA);
      addRow.appendChild(selB);
      addRow.appendChild(text);
      addRow.appendChild(tol);
      addRow.appendChild(add);
      box.appendChild(addRow);
    } else {
      const addRow = mk('div', 'set-row set-addlink');
      addRow.appendChild(levelSel);
      box.appendChild(addRow);
    }

    return box;
  }

  /* ---------------- 快捷鍵 ---------------- */

  function buildHotkeys() {
    const box = section('hotkeysTitle', 'hotkeysHint');
    const owners = store.hotkeyOwners();

    if (owners.length === 0) {
      box.appendChild(mk('p', 'set-empty', tr('noGroups')));
      return box;
    }

    for (const owner of owners) {
      const row = mk('div', 'set-row');
      const key = input('set-key', owner.hotkey || '', tr('hotkeyPh'));
      key.maxLength = 1;
      key.addEventListener('change', () => {
        store.setHotkey(owner, key.value);
        onChange(true);
        render();
      });
      const prefix = owner.kind === 'supergroup' ? '[' + tr('linkLevelSuperGroup') + '] ' : '';
      row.appendChild(key);
      row.appendChild(mk('span', 'set-members', prefix + owner.label));
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
    panel.appendChild(buildLinks());
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
