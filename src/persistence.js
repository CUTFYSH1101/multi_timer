/* localStorage 儲存 — 讀寫是注入的，所以邏輯可以在 Node 裡測 */

export const STORAGE_KEY = 'multiTimerData';

/* localStorage 單一網站通常有 5MB 上限（以 UTF-16 code unit 算），
 * 留很大的餘裕，正常使用幾乎不可能撞到。 */
export const STORAGE_MAX_BYTES = 4_000_000;

/* 舊版用 cookie 存，cookie 名稱跟現在的 localStorage key 一樣叫 multiTimerData。
 * 遷移時只需要從 cookie 字串裡挑出這個名字的值。 */
export const COOKIE_NAME = STORAGE_KEY;

/** 從 document.cookie 這種字串裡挑出某個 cookie 的原始值（搬家用） */
export function readCookieValue(cookieString, name = COOKIE_NAME) {
  if (!cookieString) return null;
  const m = String(cookieString).match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? m[1] : null;
}

export function encodeState(state) {
  return encodeURIComponent(JSON.stringify(state));
}

export function decodeState(encoded) {
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

/** 播報模式舊資料換算：舊版只有 announceGroup 布林，true＝子群組+標籤，false＝只唸標籤 */
function legacyAnnounceMode(raw) {
  if (typeof raw.announceMode === 'string') return raw.announceMode;
  return raw.announceGroup === true ? 'group' : 'label';
}

/** 把讀回來的資料補齊成固定形狀，缺的用預設值 */
export function normalizeState(raw, defaults = {}) {
  const base = {
    voice: true,
    announceMode: 'label',
    lang: 'zh-Hant',
    items: [],
    sessionSec: 600,
    timelines: [],
    links: [],
    ...defaults,
  };
  if (!raw || typeof raw !== 'object') return { ...base, empty: true };
  const sessionSec = Number(raw.sessionSec);
  return {
    voice: raw.voice !== false,
    // 向下兼容舊版的 announceGroup 布林；新資料一律看 announceMode
    announceMode: legacyAnnounceMode(raw),
    lang: typeof raw.lang === 'string' ? raw.lang : base.lang,
    items: Array.isArray(raw.items) ? raw.items : [],
    // 時間軸、連線是使用者自己建的資料，跟計時器一樣要還原
    sessionSec: Number.isFinite(sessionSec) && sessionSec > 0 ? sessionSec : base.sessionSec,
    timelines: Array.isArray(raw.timelines) ? raw.timelines : [],
    links: Array.isArray(raw.links) ? raw.links : [],
    empty: !Array.isArray(raw.items) || raw.items.length === 0,
  };
}

/** 實際會被寫進 storage 的字元數 */
export function measureStorageBytes(encodedValue) {
  return encodedValue.length;
}

/**
 * @param {{getItem:()=>string, setItem:(s:string)=>void, key?:string}} io
 */
export function createLocalStore(io) {
  const key = io.key || STORAGE_KEY;
  return {
    /** @returns {{ok:boolean, bytes:number, reason?:string}} */
    save(state) {
      const encoded = encodeState(state);
      const bytes = measureStorageBytes(encoded);
      if (bytes > STORAGE_MAX_BYTES) {
        return { ok: false, bytes, reason: 'too-large' };
      }
      try {
        io.setItem(key, encoded);
      } catch (e) {
        return { ok: false, bytes, reason: 'write-failed' };
      }
      return { ok: true, bytes };
    },
    load() {
      const raw = io.getItem(key);
      return normalizeState(decodeState(raw));
    },
  };
}
