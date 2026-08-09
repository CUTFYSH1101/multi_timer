import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TimerStore } from '../src/timers.js';
import { createSpeaker, buildAnnouncement } from '../src/announcer.js';
import { STR } from '../src/i18n.js';

/* 這支不需要 jsdom：直接組 TimerStore + 假語音引擎，
 * 模擬 ui.js 的 handleEvents() 怎麼把 tick() 的到期事件送進語音，
 * 驗證「到期真的會觸發語音」這件事，不用真的開瀏覽器。 */

function fakeSynth() {
  const spoken = [];
  let cancelled = 0;
  return {
    spoken,
    cancelCount: () => cancelled,
    synth: { speak: u => spoken.push(u), cancel() { cancelled++; } },
    Utterance: class { constructor(text) { this.text = text; } },
  };
}

/** 對應 ui.js 的 handleEvents：把到期事件轉成語音 */
function announceExpired(events, speaker, lang, announceGroup) {
  events
    .filter(ev => ev.type === 'expired')
    .forEach(ev => speaker.speak(buildAnnouncement({
      timerLabel: ev.timer.label,
      groupLabel: ev.group ? ev.group.label : null,
      announceGroup,
      suffix: STR[lang].timeUpSuffix,
    })));
}

describe('是否時間到觸發語音', () => {
  test('計時器倒數到 0 會觸發語音，文字與語言正確', () => {
    let now = 0;
    const store = new TimerStore({ now: () => now });
    const t = store.addTimer('大龍', 5);
    store.start(t);
    now = 6000;

    const f = fakeSynth();
    const speaker = createSpeaker({ synth: f.synth, Utterance: f.Utterance, getLang: () => 'zh-TW' });
    announceExpired(store.tick(now), speaker, 'zh-Hant', false);

    assert.equal(f.spoken.length, 1);
    assert.equal(f.spoken[0].text, '大龍 時間到');
    assert.equal(f.spoken[0].lang, 'zh-TW');
  });

  test('同一時刻多個計時器一起到期，每一個都會觸發語音（不會只剩最後一個）', () => {
    let now = 0;
    const store = new TimerStore({ now: () => now });
    const a = store.addTimer('小龍', 5);
    const b = store.addTimer('大龍', 5);
    store.batchStart([a, b]);
    now = 6000;

    const f = fakeSynth();
    const speaker = createSpeaker({ synth: f.synth, Utterance: f.Utterance, getLang: () => 'zh-TW' });
    announceExpired(store.tick(now), speaker, 'zh-Hant', false);

    assert.equal(f.spoken.length, 2, '兩個同時到期應該各自觸發一次語音');
    assert.deepEqual(f.spoken.map(u => u.text).sort(), ['大龍 時間到', '小龍 時間到']);
    assert.equal(f.cancelCount(), 0, '不該把前一個沖掉才對（這是曾經修過的回歸問題）');
  });
});

describe('只念標籤/唸群組+標籤切換後觸發的語音正常', () => {
  test('預設只念標籤：群組內計時器到期時不會唸出群組名稱', () => {
    let now = 0;
    const store = new TimerStore({ now: () => now });
    const g = store.addGroup('野區');
    const t = store.addTimerToGroup(g.id, '藍 Buff', 5);
    store.start(t);
    now = 6000;

    const f = fakeSynth();
    const speaker = createSpeaker({ synth: f.synth, Utterance: f.Utterance, getLang: () => 'zh-TW' });
    announceExpired(store.tick(now), speaker, 'zh-Hant', false);

    assert.equal(f.spoken[0].text, '藍 Buff 時間到');
  });

  test('切換成唸群組+標籤後，群組內計時器會加上群組名稱；頂層計時器不受影響', () => {
    let now = 0;
    const store = new TimerStore({ now: () => now });
    const g = store.addGroup('野區');
    const grouped = store.addTimerToGroup(g.id, '藍 Buff', 5);
    const top = store.addTimer('大龍', 5);
    store.batchStart([grouped, top]);
    now = 6000;

    const f = fakeSynth();
    const speaker = createSpeaker({ synth: f.synth, Utterance: f.Utterance, getLang: () => 'zh-TW' });
    announceExpired(store.tick(now), speaker, 'zh-Hant', true);

    const texts = f.spoken.map(u => u.text);
    assert.ok(texts.includes('野區 藍 Buff 時間到'), '群組內的計時器應該加上群組名稱');
    assert.ok(texts.includes('大龍 時間到'), '頂層計時器沒有群組，兩種模式應該一樣');
  });
});
