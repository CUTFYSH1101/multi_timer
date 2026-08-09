/* Cookie 儲存 — cookie 的讀寫是注入的，所以邏輯可以在 Node 裡測 */

export const COOKIE_NAME = 'multiTimerData';

/* 瀏覽器單一 cookie 上限約 4096 bytes（含 name= 與屬性）。
 * 留一點餘裕給 expires / path / SameSite。 */
export const COOKIE_MAX_BYTES = 3800;

/** 從 document.cookie 這種字串裡挑出某個 cookie 的原始值 */
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

/** 把讀回來的資料補齊成固定形狀，缺的用預設值 */
export function normalizeState(raw, defaults = {}) {
  const base = {
    voice: true,
    announceGroup: false,
    lang: 'zh-Hant',
    items: [],
    sessionSec: 600,
    timelines: [],
    pairs: [],
    ...defaults,
  };
  if (!raw || typeof raw !== 'object') return { ...base, empty: true };
  const sessionSec = Number(raw.sessionSec);
  return {
    voice: raw.voice !== false,
    announceGroup: raw.announceGroup === true,
    lang: typeof raw.lang === 'string' ? raw.lang : base.lang,
    items: Array.isArray(raw.items) ? raw.items : [],
    // 時間軸與配對是使用者自己建的資料，跟計時器一樣要還原
    sessionSec: Number.isFinite(sessionSec) && sessionSec > 0 ? sessionSec : base.sessionSec,
    timelines: Array.isArray(raw.timelines) ? raw.timelines : [],
    pairs: Array.isArray(raw.pairs) ? raw.pairs : [],
    empty: !Array.isArray(raw.items) || raw.items.length === 0,
  };
}

/** 實際會被寫進 cookie 的位元組數（中文經過 encodeURIComponent 會膨脹到 9 bytes/字） */
export function measureCookieBytes(encodedValue, name = COOKIE_NAME) {
  return (name + '=' + encodedValue).length;
}

export function buildCookieString(encodedValue, opts = {}) {
  const name = opts.name || COOKIE_NAME;
  const years = opts.years ?? 10;
  const now = opts.now ? new Date(opts.now) : new Date();
  const exp = new Date(now.getTime());
  exp.setFullYear(exp.getFullYear() + years);
  return name + '=' + encodedValue + '; expires=' + exp.toUTCString() + '; path=/; SameSite=Lax';
}

/**
 * @param {{getCookie:()=>string, setCookie:(s:string)=>void, name?:string}} io
 */
export function createCookieStore(io) {
  const name = io.name || COOKIE_NAME;
  return {
    /** @returns {{ok:boolean, bytes:number, reason?:string}} */
    save(state) {
      const encoded = encodeState(state);
      const bytes = measureCookieBytes(encoded, name);
      if (bytes > COOKIE_MAX_BYTES) {
        return { ok: false, bytes, reason: 'too-large' };
      }
      try {
        io.setCookie(buildCookieString(encoded, { name }));
      } catch (e) {
        return { ok: false, bytes, reason: 'write-failed' };
      }
      return { ok: true, bytes };
    },
    load() {
      const raw = readCookieValue(io.getCookie(), name);
      return normalizeState(decodeState(raw));
    },
  };
}
