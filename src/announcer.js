/* 語音提醒 — 文字組裝是純函式，語音引擎是注入的 */

/** 播報模式五選一，依序循環：只唸標籤 → 只唸子群組+標籤 → 只唸母群組+標籤 → 只唸母子群組 → 全唸 */
export const ANNOUNCE_MODES = ['label', 'group', 'mother', 'motherGroup', 'all'];

/** 循環切換到下一個播報模式 */
export function nextAnnounceMode(mode) {
  const idx = ANNOUNCE_MODES.indexOf(mode);
  return ANNOUNCE_MODES[(idx + 1) % ANNOUNCE_MODES.length];
}

/** 每個模式要不要拼母群組/子群組/標籤這三段 */
const ANNOUNCE_INCLUDE = {
  label: { mother: false, group: false, label: true },
  group: { mother: false, group: true, label: true },
  mother: { mother: true, group: false, label: true },
  motherGroup: { mother: true, group: true, label: false },
  all: { mother: true, group: true, label: true },
};

/**
 * 組出要唸的字串。母群組/子群組/標籤各自的名字由呼叫端算好傳進來
 * （呼叫端負責把連線取代後的字換上去，這裡只管照 mode 拼不拼）。
 * 三段都被模式排除掉（例如頂層計時器沒有母群組/子群組又選了「只唸母子群組」）時，
 * 保底至少唸標籤，不要唸出空字串。
 */
export function buildAnnouncement(opts) {
  const { motherLabel = null, groupLabel = null, timerLabel, mode = 'label', suffix = '' } = opts;
  const inc = ANNOUNCE_INCLUDE[mode] || ANNOUNCE_INCLUDE.label;
  const parts = [];
  if (inc.mother && motherLabel) parts.push(motherLabel);
  if (inc.group && groupLabel) parts.push(groupLabel);
  if (inc.label) parts.push(timerLabel);
  if (parts.length === 0) parts.push(timerLabel);
  return parts.join(' ') + suffix;
}

/**
 * 從一個到期事件組出這一聲要唸的字；不用出聲時回傳 null。
 *
 * 合併語音通知（連線 links）唸的是綁定時就算好的整句話，直接唸、不跟播報模式拼字——
 * 程式不會去把「上路」跟「下路」兜成「上下路」，那需要程式看懂標籤的語意，
 * 會踩到「系統不准懂遊戲」；連線要唸的「文字 + 雙方標籤」也是在 TimerStore._mergedLinkText()
 * 就先算好塞進 mergedText，這裡不重算。
 * motherLabel/groupLabel/timerLabel 由呼叫端算好傳進來；沒傳 timerLabel 時退回 ev.timer.label，
 * 方便舊呼叫端相容。
 */
export function announcementFor(ev, opts = {}) {
  if (!ev || ev.type !== 'expired') return null;
  if (ev.silent || ev.suppressed) return null;
  const { mode = 'label', suffix = '', motherLabel = null, groupLabel = null, timerLabel } = opts;
  if (ev.mergedText) return ev.mergedText + suffix;
  return buildAnnouncement({
    motherLabel,
    groupLabel,
    timerLabel: timerLabel !== undefined ? timerLabel : ev.timer.label,
    mode,
    suffix,
  });
}

/**
 * @param {{
 *   synth: {speak:Function, cancel?:Function} | null,
 *   Utterance: Function | null,
 *   isEnabled?: () => boolean,
 *   getLang?: () => string,
 *   rate?: number
 * }} deps
 */
export function createSpeaker(deps) {
  const { synth, Utterance, isEnabled = () => true, getLang = () => 'en-US', rate = 1.05 } = deps;

  return {
    /**
     * 唸一段字。回傳是否真的送進語音引擎。
     *
     * 注意：這裡刻意「不」呼叫 synth.cancel()。
     * 原本的版本每次發聲前都先 cancel，導致同一格內兩個計時器同時到期時，
     * 第二個會把第一個沖掉，只聽得到最後一個。
     * Web Speech API 本身就有佇列，交給它排就好。
     */
    speak(text) {
      if (!isEnabled()) return false;
      if (!synth || !Utterance) return false;
      try {
        const u = new Utterance(text);
        u.lang = getLang();
        u.rate = rate;
        synth.speak(u);
        return true;
      } catch (e) {
        return false;
      }
    },
    /** 使用者關掉語音、或全部重設時清空待唸佇列 */
    stop() {
      try { synth && synth.cancel && synth.cancel(); } catch (e) { /* ignore */ }
    },
  };
}
