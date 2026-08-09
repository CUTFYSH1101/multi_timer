import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STR, nextLang, isLang, t } from '../src/i18n.js';

/* 這支只留一個純邏輯測試；另一個「繁簡英是否正常觸發」的測試
 * 放在 test/ui.smoke.test.js（點 langBtn 驗證真的換了畫面文字），
 * 兩個合起來剛好覆蓋「純邏輯」跟「接到 UI」兩層。 */

test('語言循環切換三語系正確；語音語系對應正確（繁簡共用 zh-TW，英文才是 en-US）', () => {
  assert.equal(nextLang('zh-Hant'), 'zh-Hans');
  assert.equal(nextLang('zh-Hans'), 'en');
  assert.equal(nextLang('en'), 'zh-Hant'); // 繞一圈回到原點

  assert.equal(STR['zh-Hant'].speechLang, 'zh-TW');
  assert.equal(STR['zh-Hans'].speechLang, 'zh-TW');
  assert.equal(STR['en'].speechLang, 'en-US');

  assert.equal(isLang('ja'), false); // 擋掉 cookie 裡的非法語言值
  assert.equal(t('ja', 'title'), STR['zh-Hant'].title); // 退回繁體，不會是 undefined
});
