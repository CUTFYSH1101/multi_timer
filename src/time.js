/* 時間字串處理 — 純函式 */

/**
 * 解析 "m:ss" 或 "ss"。無法解析的部分視為 0，結果不會小於 0。
 * @returns {number} 總秒數
 */
export function parseTime(str) {
  const parts = String(str).split(':').map(s => parseInt(s, 10));
  let m = 0, s = 0;
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    m = parts[0];
    s = parts[1];
  } else if (parts.length === 1 && !isNaN(parts[0])) {
    s = parts[0];
  }
  if (isNaN(m)) m = 0;
  if (isNaN(s)) s = 0;
  return Math.max(0, m * 60 + s);
}

/** 秒數格式化為 "m:ss"（四捨五入，不會出現負數） */
export function fmt(totalSec) {
  const v = Math.max(0, Math.round(Number(totalSec) || 0));
  const m = Math.floor(v / 60);
  const s = v % 60;
  return m + ':' + String(s).padStart(2, '0');
}
