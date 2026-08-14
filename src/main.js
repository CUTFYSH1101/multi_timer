/* 組裝層 — 唯一碰到瀏覽器 API（AudioContext / speechSynthesis / localStorage）的地方 */

import { TimerStore } from './timers.js';
import { createLocalStore, readCookieValue, COOKIE_NAME } from './persistence.js';
import { createSpeaker } from './announcer.js';
import { createUI } from './ui.js';
import { STR, isLang } from './i18n.js';

/* ---------------- 音效 ---------------- */
let audioCtx = null;
function ensureAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* 沒有音效不影響倒數 */ }
}

function beep() {
  try {
    ensureAudio();
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    o.start(now);
    o.stop(now + 0.55);
  } catch (e) { /* ignore */ }
}

/* ---------------- 讀取設定 ---------------- */
const storage = createLocalStore({
  getItem: k => window.localStorage.getItem(k),
  setItem: (k, v) => window.localStorage.setItem(k, v),
});

// 舊版存在 cookie 裡；localStorage 還是空的時候，搬過來一次就好，順便把舊 cookie 清掉。
if (window.localStorage.getItem(COOKIE_NAME) === null) {
  const legacy = readCookieValue(document.cookie, COOKIE_NAME);
  if (legacy !== null) {
    window.localStorage.setItem(COOKIE_NAME, legacy);
    document.cookie = COOKIE_NAME + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
  }
}

const saved = storage.load();
const lang = isLang(saved.lang) ? saved.lang : 'zh-Hant';

/* ---------------- 建立狀態 ---------------- */
const store = new TimerStore({ now: () => performance.now() });

if (!saved.empty) {
  store.loadState(saved, {
    timerLabel: STR[lang].newTimerLabel,
    groupLabel: STR[lang].newGroupLabel,
  });
} else {
  store.addTimer('目標 1', 8 * 60 + 50);
  store.addTimer('目標 2', 7 * 60 + 20);
  store.addTimer('目標 3', 8 * 60 + 0);
}

/* ---------------- 語音 ---------------- */
const voiceToggleEl = document.getElementById('voiceToggle');
const speaker = createSpeaker({
  synth: 'speechSynthesis' in window ? window.speechSynthesis : null,
  Utterance: typeof window.SpeechSynthesisUtterance === 'function' ? window.SpeechSynthesisUtterance : null,
  isEnabled: () => voiceToggleEl.checked,
  getLang: () => STR[ui.getLang()].speechLang,
});

/* ---------------- 啟動 ---------------- */
const ui = createUI({
  doc: document,
  store,
  storage,
  speaker,
  beep,
  ensureAudio,
  confirmFn: msg => window.confirm(msg),
  alertFn: msg => window.alert(msg),
  promptFn: (msg, def) => window.prompt(msg, def),
  lang,
  voice: saved.voice,
  announceMode: saved.announceMode,
});

ui.start();

// 方便手動測試時在 console 裡戳
window.__multiTimer = { store, ui, storage, speaker };
