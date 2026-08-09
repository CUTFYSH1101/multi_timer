/* 組裝層 — 唯一碰到瀏覽器 API（AudioContext / speechSynthesis / document.cookie）的地方 */

import { TimerStore } from './timers.js';
import { createCookieStore } from './persistence.js';
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
const cookieStore = createCookieStore({
  getCookie: () => document.cookie,
  setCookie: s => { document.cookie = s; },
});

const saved = cookieStore.load();
const lang = isLang(saved.lang) ? saved.lang : 'zh-Hant';

/* ---------------- 建立狀態 ---------------- */
const store = new TimerStore({ now: () => performance.now() });

if (!saved.empty) {
  store.loadJSON(saved.items, {
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
  cookieStore,
  speaker,
  beep,
  ensureAudio,
  confirmFn: msg => window.confirm(msg),
  lang,
  voice: saved.voice,
  announceGroup: saved.announceGroup,
});

ui.start();

// 方便手動測試時在 console 裡戳
window.__multiTimer = { store, ui, cookieStore, speaker };
