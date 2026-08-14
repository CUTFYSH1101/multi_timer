import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TimerStore, LOOP_RESTART_MS } from '../src/timers.js';

/** 假時鐘：完全不用等真實時間 */
function harness() {
  let now = 0;
  const store = new TimerStore({ now: () => now });
  return {
    store,
    now: () => now,
    /** 時鐘前進並推進一次，回傳事件 */
    jump(ms) { now += ms; return store.tick(now); },
    /** 只動時鐘、不推進（模擬暫停期間過了很久） */
    move(ms) { now += ms; },
  };
}

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} 不接近 ${b}`);

describe('是否暫停後再撥放只用剩下的時間觸發到期', () => {
  test('暫停會凍結剩餘時間；繼續播放接著算，不是從頭重算', () => {
    const h = harness();
    const t = h.store.addTimer('目標 1', 10);
    h.store.start(t);
    h.jump(3000);           // 剩 7
    h.store.pause(t);
    near(t.remainingSec, 7);

    h.move(60000);          // 暫停中過了一分鐘，不該被扣掉
    near(t.remainingSec, 7);

    h.store.start(t);       // 繼續，只用剩下的 7 秒
    near(t.remainingSec, 7, 1e-9);
    h.jump(2000);
    near(t.remainingSec, 5);
  });

  test('暫停後繼續，到期時間恰好等於剩餘秒數之後才觸發', () => {
    const h = harness();
    const t = h.store.addTimer('目標 1', 10);
    h.store.start(t);
    h.jump(4000);            // 剩 6
    h.store.pause(t);
    h.move(999999);          // 暫停很久
    h.store.start(t);

    assert.equal(h.jump(5900).length, 0, '第 5.9 秒不該到期');
    const events = h.jump(200);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'expired');
  });
});

describe('是否全部開始/是否全部暫停/是否全部重設功能正常', () => {
  function seeded() {
    const h = harness();
    const a = h.store.addTimer('A', 10);
    const g = h.store.addGroup('G');
    const b = h.store.addTimerToGroup(g.id, 'B', 20);
    return { h, a, b, g };
  }

  test('全部開始會連群組裡的一起開；全部暫停會保留各自的剩餘時間', () => {
    const { h, a, b } = seeded();
    h.store.batchStart(h.store.flatten());
    assert.equal(a.running, true);
    assert.equal(b.running, true);

    h.jump(3000);
    h.store.batchPause(h.store.flatten());
    near(a.remainingSec, 7);
    near(b.remainingSec, 17);
    assert.equal(a.running, false);
    assert.equal(b.running, false);
  });

  test('全部重設會全部歸位', () => {
    const { h, a, b } = seeded();
    h.store.batchStart(h.store.flatten());
    h.jump(3000);
    h.store.batchReset(h.store.flatten());
    assert.equal(a.remainingSec, 10);
    assert.equal(b.remainingSec, 20);
    assert.equal(a.running, false);
    assert.equal(b.running, false);
  });
});

describe('是否群組的開始/循環/重置/刪除功能正常', () => {
  function grouped() {
    const h = harness();
    const g = h.store.addGroup('野區');
    const a = h.store.addTimerToGroup(g.id, '藍', 10);
    const b = h.store.addTimerToGroup(g.id, '紅', 20);
    const outsider = h.store.addTimer('外面的', 30);
    return { h, g, a, b, outsider };
  }

  test('群組開始只影響群組內，不動到外面的計時器', () => {
    const { h, g, a, b, outsider } = grouped();
    h.store.batchToggleStart(g.timers);
    assert.equal(a.running, true);
    assert.equal(b.running, true);
    assert.equal(outsider.running, false);
  });

  test('群組按鈕：有任一在跑就全部暫停；全部都停著時會全部開始', () => {
    const { h, g, a, b } = grouped();
    h.store.start(a); // 只開一個
    h.store.batchToggleStart(g.timers);
    assert.equal(a.running, false);
    assert.equal(b.running, false);

    h.store.batchToggleStart(g.timers);
    assert.equal(a.running, true);
    assert.equal(b.running, true);
  });

  test('群組循環：沒有全開時一律全開，全開時才全關', () => {
    const { h, g, a, b } = grouped();
    a.loop = true;

    h.store.batchToggleLoop(g.timers);
    assert.equal(a.loop, true);
    assert.equal(b.loop, true);

    h.store.batchToggleLoop(g.timers);
    assert.equal(a.loop, false);
    assert.equal(b.loop, false);
  });

  test('群組重設只重設群組內', () => {
    const { h, g, a, outsider } = grouped();
    h.store.batchStart(h.store.flatten());
    h.jump(3000);
    h.store.batchReset(g.timers);
    assert.equal(a.remainingSec, 10);
    near(outsider.remainingSec, 27);
  });

  test('刪除群組會連裡面的計時器一起刪掉', () => {
    const { h, g } = grouped();
    assert.equal(h.store.removeGroup(g.id), true);
    assert.equal(h.store.findGroup(g.id), null);
    assert.deepEqual(h.store.flatten().map(t => t.label), ['外面的']);
  });
});

describe('是否單元的開始/循環/重置/刪除功能正常', () => {
  test('開始：從暫停處繼續；歸零後再按開始會回填成完整時間', () => {
    const h = harness();
    const t = h.store.addTimer('目標 1', 5);
    h.store.start(t);
    h.jump(6000);
    assert.equal(t.remainingSec, 0);
    assert.equal(t.done, true);

    h.store.start(t); // 已到期，再按開始要回填滿血
    assert.equal(t.remainingSec, 5);
    assert.equal(t.done, false);
    assert.equal(t.running, true);
  });

  test('循環：開循環的計時器到期後會在 900ms 後自動重啟；沒開循環的不會', () => {
    const h = harness();
    const t = h.store.addTimer('目標 1', 5);
    t.loop = true;
    h.store.start(t);
    h.jump(6000);
    assert.equal(t.done, true);

    assert.equal(h.jump(LOOP_RESTART_MS - 100).length, 0, '還沒到重啟時間');
    const events = h.jump(200);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'restart');
    assert.equal(t.running, true);
    assert.equal(t.remainingSec, 5);

    const t2 = h.store.addTimer('目標 2', 5);
    h.store.start(t2);
    h.jump(6000);
    h.jump(5000);
    assert.equal(t2.running, false, '沒開循環不該自己重啟');
  });

  test('循環：設定 repeatSec 後，第一輪用 totalSec，之後每輪重啟用 repeatSec', () => {
    const h = harness();
    const t = h.store.addTimer('目標 1', 120); // 頭一輪 2 分鐘
    h.store.setRepeatSec(t, 90);               // 之後每輪 1.5 分鐘
    t.loop = true;
    h.store.start(t);
    near(t.remainingSec, 120);

    h.jump(120000); // 頭一輪到期
    assert.equal(t.done, true);
    h.jump(LOOP_RESTART_MS);
    assert.equal(t.remainingSec, 90, '重啟後應該用 repeatSec 而不是 totalSec');

    h.jump(90000); // 第二輪到期
    assert.equal(t.done, true);
    h.jump(LOOP_RESTART_MS);
    assert.equal(t.remainingSec, 90, '之後每輪都沿用 repeatSec');

    h.store.setRepeatSec(t, null); // 取消特別設定
    assert.equal(t.repeatSec, null);
  });

  test('循環：在等待重啟的空檔按暫停，就不會再重啟', () => {
    const h = harness();
    const t = h.store.addTimer('目標 1', 5);
    t.loop = true;
    h.store.start(t);
    h.jump(6000);
    h.store.pause(t);
    h.jump(5000);
    assert.equal(t.running, false);
  });

  test('toggleLoop 切換循環旗標', () => {
    const h = harness();
    const t = h.store.addTimer('目標 1', 10);
    assert.equal(t.loop, false);
    h.store.toggleLoop(t);
    assert.equal(t.loop, true);
    h.store.toggleLoop(t);
    assert.equal(t.loop, false);
  });

  test('reset 把剩餘時間歸位並停止', () => {
    const h = harness();
    const t = h.store.addTimer('目標 1', 10);
    h.store.start(t);
    h.jump(4000);
    h.store.reset(t);
    assert.equal(t.remainingSec, 10);
    assert.equal(t.running, false);
    assert.equal(t.done, false);
  });

  test('刪除頂層計時器；刪除群組內的計時器時群組本身留著', () => {
    const h = harness();
    const a = h.store.addTimer('A', 10);
    h.store.addTimer('B', 10);
    assert.equal(h.store.removeTimer(a.id), true);
    assert.deepEqual(h.store.flatten().map(t => t.label), ['B']);

    const g = h.store.addGroup('G');
    const c = h.store.addTimerToGroup(g.id, 'C', 10);
    h.store.addTimerToGroup(g.id, 'D', 10);
    h.store.removeTimer(c.id);
    assert.equal(h.store.findGroup(g.id).timers.map(x => x.label).join(), 'D');
  });
});

describe('序列化', () => {
  test('只存標籤與長度，不存執行中的狀態', () => {
    const h = harness();
    const t = h.store.addTimer('目標 1', 530);
    t.loop = true;
    h.store.start(t);
    h.jump(3000);

    const json = h.store.toJSON();
    assert.deepEqual(json, [{ kind: 'timer', label: '目標 1', totalSec: 530 }]);
    assert.ok(!('remainingSec' in json[0]));
    assert.ok(!('loop' in json[0]));
  });

  test('群組結構可以完整來回，還原後一律是停著的滿血狀態', () => {
    const h = harness();
    const g = h.store.addGroup('野區');
    h.store.addTimerToGroup(g.id, '藍', 300);
    h.store.addTimer('大龍', 360);

    const json = h.store.toJSON();
    const restored = new TimerStore().loadJSON(json);
    assert.deepEqual(restored.toJSON(), json);
    const t = restored.flatten()[0];
    assert.equal(t.running, false);
    assert.equal(t.done, false);
    assert.equal(t.remainingSec, t.totalSec);
  });

  test('壞掉的欄位會補預設值而不是整包炸掉，非陣列輸入直接清空', () => {
    const restored = new TimerStore().loadJSON([
      { kind: 'timer' },
      { kind: 'timer', label: 'B', totalSec: 'abc' },
      null,
      { kind: 'group', label: 'G' },
    ], { timerLabel: '新計時器', groupLabel: '新群組' });

    assert.equal(restored.items.length, 3);
    assert.equal(restored.flatten()[0].label, '新計時器');
    assert.equal(restored.flatten()[1].totalSec, 300);

    const store = new TimerStore();
    store.addTimer('A', 10);
    store.loadJSON(null);
    assert.deepEqual(store.items, []);
  });
});
