/* i18n — 純資料與純函式，不碰 DOM */

export const LANGS = ['zh-Hant', 'zh-Hans', 'en'];
export const LANG_ABBR = { 'zh-Hant': '繁', 'zh-Hans': '简', 'en': 'US' };

export const STR = {
  'zh-Hant': {
    title: '多重倒數計時器',
    subtitle: '同時追蹤多個目標，時間到自動語音提醒 —— 適合 LoL / Pokémon UNITE 等多目標遊戲',
    startAll: '▶ 全部開始', pauseAll: '⏸ 全部暫停', resetAll: '⟲ 全部重設',
    addTimer: '+ 新增計時器', addGroup: '+ 新增群組',
    voice: '🔊 語音提醒',
    footer1: '點時間數字可直接輸入新的分:秒（例如 8:50）。🔁 開啟後時間到會自動重新倒數。群組可收合成一行，收合後點群組列的 ▶/🔁/⟲ 會套用到群組內<b>所有</b>計時器；收合時內部欄位無法個別操作，展開後才能各自調整。',
    footer2: '標籤文字、時間與語音開關會存進瀏覽器 Cookie 永久保留，下次打開這個檔案會自動還原。<b>注意：</b>Cookie 需要透過網頁伺服器（例如 GitHub Pages）開啟才會運作；用 file:// 直接開啟本機檔案時瀏覽器會封鎖 Cookie。',
    newTimerLabel: '新計時器', newGroupLabel: '新群組', addToGroup: '+ 新增計時器到此群組',
    startTip: '開始', pauseTip: '暫停', loopTip: '循環', resetTip: '重設', delTip: '刪除',
    startAllTip: '開始/暫停全部', loopAllTip: '循環全部', resetAllTip: '重設全部', delGroupTip: '刪除群組',
    collapseTip: '收合/展開',
    confirmDeleteGroup: '確定要刪除整個群組嗎？群組內所有計時器也會一併刪除。',
    timeUpSuffix: ' 時間到',
    speechLang: 'zh-TW',
    announceLabelOnly: '只唸標籤', announceGroupLabel: '唸群組+標籤',
    cookieTooLarge: '⚠ 計時器數量或標籤太長，已超過瀏覽器 Cookie 容量上限，這次的設定沒有存進去。',
  },
  'zh-Hans': {
    title: '多重倒计时器',
    subtitle: '同时追踪多个目标，时间到自动语音提醒 —— 适合 LoL / Pokémon UNITE 等多目标游戏',
    startAll: '▶ 全部开始', pauseAll: '⏸ 全部暂停', resetAll: '⟲ 全部重设',
    addTimer: '+ 新增计时器', addGroup: '+ 新增群组',
    voice: '🔊 语音提醒',
    footer1: '点时间数字可直接输入新的分:秒（例如 8:50）。🔁 开启后时间到会自动重新倒数。群组可折叠成一行，折叠后点群组列的 ▶/🔁/⟲ 会套用到群组内<b>所有</b>计时器；折叠时内部栏位无法个别操作，展开后才能各自调整。',
    footer2: '标签文字、时间与语音开关会存进浏览器 Cookie 永久保留，下次打开这个文件会自动还原。<b>注意：</b>Cookie 需要透过网页服务器（例如 GitHub Pages）开启才会运作；用 file:// 直接打开本机文件时浏览器会封锁 Cookie。',
    newTimerLabel: '新计时器', newGroupLabel: '新群组', addToGroup: '+ 新增计时器到此群组',
    startTip: '开始', pauseTip: '暂停', loopTip: '循环', resetTip: '重设', delTip: '删除',
    startAllTip: '开始/暂停全部', loopAllTip: '循环全部', resetAllTip: '重设全部', delGroupTip: '删除群组',
    collapseTip: '折叠/展开',
    confirmDeleteGroup: '确定要删除整个群组吗？群组内所有计时器也会一并删除。',
    timeUpSuffix: ' 时间到',
    speechLang: 'zh-TW',
    announceLabelOnly: '只念标签', announceGroupLabel: '念群组+标签',
    cookieTooLarge: '⚠ 计时器数量或标签太长，已超过浏览器 Cookie 容量上限，这次的设定没有存进去。',
  },
  'en': {
    title: 'Multi Countdown Timer',
    subtitle: 'Track multiple objectives at once with voice alerts when time is up — great for LoL / Pokémon UNITE.',
    startAll: '▶ Start All', pauseAll: '⏸ Pause All', resetAll: '⟲ Reset All',
    addTimer: '+ Add Timer', addGroup: '+ Add Group',
    voice: '🔊 Voice Alerts',
    footer1: 'Click the time to type a new mm:ss (e.g. 8:50). Turn on 🔁 to auto-restart when it hits zero. Groups can collapse into a single row — the ▶/🔁/⟲ on a collapsed group act on <b>every</b> timer inside it; individual timers can only be controlled once the group is expanded.',
    footer2: 'Labels, durations and the voice toggle are saved permanently in a browser cookie and restored next time you open this page. <b>Note:</b> cookies only work when the page is served over http(s) — for example GitHub Pages. Opening the file directly via file:// blocks them.',
    newTimerLabel: 'New Timer', newGroupLabel: 'New Group', addToGroup: '+ Add Timer To Group',
    startTip: 'Start', pauseTip: 'Pause', loopTip: 'Loop', resetTip: 'Reset', delTip: 'Delete',
    startAllTip: 'Start/Pause All', loopAllTip: 'Loop All', resetAllTip: 'Reset All', delGroupTip: 'Delete Group',
    collapseTip: 'Collapse/Expand',
    confirmDeleteGroup: 'Delete this whole group? All timers inside it will be removed too.',
    timeUpSuffix: ' time is up',
    speechLang: 'en-US',
    announceLabelOnly: 'Label Only', announceGroupLabel: 'Group + Label',
    cookieTooLarge: '⚠ Too many timers or labels too long — the browser cookie size limit was exceeded and this change was not saved.',
  },
};

export function isLang(x) {
  return LANGS.includes(x);
}

/** 取翻譯字串；語言不合法時退回 zh-Hant */
export function t(lang, key) {
  const table = STR[lang] || STR['zh-Hant'];
  return table[key];
}

/** 循環切換到下一個語言 */
export function nextLang(lang) {
  const idx = LANGS.indexOf(lang);
  return LANGS[(idx + 1) % LANGS.length];
}
