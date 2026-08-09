/* 語音提醒 — 文字組裝是純函式，語音引擎是注入的 */

/**
 * 組出要唸的字串。
 * 只有群組內的計時器才會受 announceGroup 影響；頂層計時器兩種模式一樣。
 */
export function buildAnnouncement(opts) {
  const { timerLabel, groupLabel = null, announceGroup = false, suffix = '' } = opts;
  const head = (announceGroup && groupLabel) ? groupLabel + ' ' + timerLabel : timerLabel;
  return head + suffix;
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
