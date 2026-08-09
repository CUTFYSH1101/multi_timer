/* 雙欄排版規則 — 純函式
 *
 * 規格（使用者明確要求，不是隨便均分）：
 *   - 20 個以內：左欄先塞滿，最多 10 個，其餘進右欄
 *   - 超過 20 個：左右平均分配，奇數時左邊多一個
 */

export const COLUMN_FILL_LIMIT = 10;
export const COLUMN_BALANCE_THRESHOLD = 20;

/** 回傳左欄該放幾個 */
export function leftColumnCount(n) {
  if (n <= 0) return 0;
  if (n <= COLUMN_BALANCE_THRESHOLD) return Math.min(COLUMN_FILL_LIMIT, n);
  return Math.ceil(n / 2);
}

/** @returns {[Array, Array]} [左欄, 右欄] */
export function splitColumns(arr) {
  const n = arr.length;
  if (n === 0) return [[], []];
  const left = leftColumnCount(n);
  return [arr.slice(0, left), arr.slice(left)];
}
