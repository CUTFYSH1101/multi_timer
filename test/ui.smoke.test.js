/* UI 層整合測試（選用）
 *
 * 這一支需要 jsdom，沒裝的話會自動跳過，不影響 `npm test`。
 *
 * 它驗證的是「接線」而不是邏輯：index.html 的 id 有沒有對上、按鈕有沒有接到 store、
 * 畫面有沒有跟著狀態換。到期是否觸發語音、只念標籤/唸群組+標籤 這兩項的核心邏輯
 * 已經在 test/voice.test.js 用不需要 jsdom 的方式測過，這裡不重複。
 * 要啟用：npm i -D jsdom
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TimerStore } from '../src/timers.js';
import { createCookieStore } from '../src/persistence.js';
import { createSpeaker } from '../src/announcer.js';
import { createUI } from '../src/ui.js';
import { STR } from '../src/i18n.js';

let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch { /* 沒裝就跳過 */ }

const skip = JSDOM ? false : '未安裝 jsdom，跳過 UI 整合測試（npm i -D jsdom 後啟用）';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function boot() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const doc = dom.window.document;

  let jar = '';
  const cookieStore = createCookieStore({
    getCookie: () => jar,
    setCookie: s => { jar = s.split(';')[0]; },
  });

  const spoken = [];
  let now = 0;
  const store = new TimerStore({ now: () => now });

  const ui = createUI({
    doc, store, cookieStore,
    speaker: createSpeaker({
      synth: { speak: u => spoken.push(u), cancel() {} },
      Utterance: class { constructor(text) { this.text = text; } },
      isEnabled: () => doc.getElementById('voiceToggle').checked,
      getLang: () => STR[ui.getLang()].speechLang,
    }),
    confirmFn: () => true,
  });

  return {
    dom, doc, store, ui, spoken, cookieStore,
    jar: () => jar,
    setNow(ms) { now = ms; },
    click(sel) { doc.querySelector(sel).dispatchEvent(new dom.window.Event('click', { bubbles: true })); },
    fire(elm, type) { elm.dispatchEvent(new dom.window.Event(type, { bubbles: true })); },
  };
}

describe('UI 整合', { skip }, () => {
  test('index.html 的元素 id 全部接得上，初始畫面渲染得出來', () => {
    const app = boot();
    app.store.addTimer('目標 1', 530);
    const g = app.store.addGroup('野區');
    app.store.addTimerToGroup(g.id, '藍 Buff', 300);
    app.ui.start();

    assert.equal(app.doc.querySelectorAll('.row').length, 2);
    assert.equal(app.doc.querySelectorAll('.group-block').length, 1);
    assert.equal(app.doc.getElementById('uiTitle').textContent, STR['zh-Hant'].title);
    app.ui.stop();
  });

  test('計時器自然到期歸零後，按鈕會自動變回顯示開始（不用手動按暫停）', async () => {
    const app = boot();
    app.store.addTimer('A', 5);
    app.ui.start();

    app.click('#toggleAllBtn');
    assert.equal(app.doc.getElementById('toggleAllBtn').textContent, STR['zh-Hant'].pauseAll);

    app.setNow(6000);
    await new Promise(r => setTimeout(r, 500));
    app.ui.stop();

    assert.equal(app.doc.getElementById('toggleAllBtn').textContent, STR['zh-Hant'].startAll);
  });

  test('暫停時顯示剩餘時間，不是總時長；重設後才變回可編輯的總時長輸入框', async () => {
    const app = boot();
    app.store.addTimer('目標 1', 10);
    app.ui.start();

    const row = () => app.doc.getElementById('row-' + app.store.flatten()[0].id);

    // 還沒開始：顯示可編輯的總時長輸入框
    assert.equal(row().querySelector('.time-input').style.display, 'block');
    assert.equal(row().querySelector('.time-display').style.display, 'none');

    app.click('.start-btn'); // 開始
    app.setNow(3000);
    await new Promise(r => setTimeout(r, 500)); // 讓計時迴圈跑掉 3 秒

    app.click('.start-btn'); // 暫停（同一顆按鈕）
    assert.equal(row().querySelector('.time-input').style.display, 'none', '暫停時不該顯示可編輯輸入框');
    assert.equal(row().querySelector('.time-display').style.display, 'block');
    assert.equal(row().querySelector('.time-display').textContent, '0:07', '應該顯示剩餘的 7 秒，不是總長的 10 秒');

    app.click('.reset-btn'); // 重設回滿血
    assert.equal(row().querySelector('.time-input').style.display, 'block', '重設後應該變回可編輯總時長');
    assert.equal(row().querySelector('.time-input').value, '0:10');

    app.ui.stop();
  });

  test('切換語言會換掉介面文字與語音語系', () => {
    const app = boot();
    app.store.addTimer('A', 10);
    app.ui.start();

    app.click('#langBtn');
    assert.equal(app.ui.getLang(), 'zh-Hans');
    assert.equal(app.doc.getElementById('uiTitle').textContent, STR['zh-Hans'].title);

    app.click('#langBtn');
    assert.equal(app.ui.getLang(), 'en');
    assert.equal(app.doc.getElementById('toggleAllBtn').textContent, STR.en.startAll);
    assert.equal(app.doc.documentElement.lang, 'en');
    app.ui.stop();
  });

  test('標籤含雙引號不會把版面弄壞（舊版 innerHTML 插值的 bug）', () => {
    const app = boot();
    app.store.addTimer('A', 10);
    app.store.addTimer('B', 10);
    app.ui.start();

    const input = app.doc.querySelector('.label-input');
    input.value = 'a" onerror="boom';
    app.fire(input, 'input');
    app.ui.render();

    assert.equal(app.doc.querySelectorAll('.row').length, 2, '引號讓列數跑掉了');
    assert.equal(app.doc.querySelector('.label-input').value, 'a" onerror="boom');
    app.ui.stop();
  });

  test('操作之後設定有寫進 cookie，讀回來一致', () => {
    const app = boot();
    app.store.addTimer('目標 1', 530);
    app.ui.start();

    app.click('#langBtn');        // → zh-Hans
    app.click('#announceModeBtn'); // → 唸群組

    const loaded = app.cookieStore.load();
    assert.equal(loaded.lang, 'zh-Hans');
    assert.equal(loaded.announceGroup, true);
    assert.deepEqual(loaded.items, [{ kind: 'timer', label: '目標 1', totalSec: 530 }]);
    app.ui.stop();
  });

  test('刪除群組會問過使用者才動手', () => {
    const app = boot();
    const g = app.store.addGroup('野區');
    app.store.addTimerToGroup(g.id, '藍', 300);
    app.ui.start();

    app.click('.group-header .del-btn');
    assert.equal(app.store.items.length, 0);
    assert.equal(app.doc.querySelectorAll('.group-block').length, 0);
    app.ui.stop();
  });
});
