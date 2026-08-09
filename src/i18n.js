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
    muteTip: '本輪靜音：時間到不出聲，倒數照跑', unmuteTip: '取消本輪靜音',
    muteGroupTip: '整個群組本輪靜音（蓋過單元設定）', unmuteGroupTip: '取消群組本輪靜音',
    settings: '⚙ 設定', settingsTip: '展開/收合設定',
    sessionTitle: '本場長度',
    sessionHint: '用本場長度將時間軸時間點換算成倒數時間。例如 10:00 → 8:50 = 1:10。只作為換算基準，不會自動倒數。',
    timelinesTitle: '時間軸模板',
    timelinesHint: '自訂名稱並輸入遊戲時間點（逗號或空白分隔，例如 8:50, 7:20, 6:00）。套用後依順序換算成計時器倒數時間；多出的時間點不使用，多出的計時器會先詢問是否刪除。套用後時間會鎖定，改回「不掛時間軸」才能手動修改。「全部重設」只設定時間，不會開始倒數。',
    addTimeline: '+ 新增時間軸', newTimelineLabel: '新時間軸', timelineNone: '（不掛時間軸）',
    timelineNamePh: '名稱', timelinePointsPh: '8:50, 7:20, 6:00',
    timelineApplyConfirm: '套用這個時間軸模板會刪除群組內多出來的 {n} 個計時器，確定要套用嗎？',
    timelineLockedTip: '時間已套用時間軸模板，鎖住無法手動輸入；改回「不掛時間軸」才能手動打時間。',
    pairsTitle: '合併語音通知',
    pairsHint: '手動綁定兩個以上的計時器：時間接近時合併成一次語音通知。',
    addPair: '+ 新增配對', pairTextPh: '合併後要唸的字', pairTolPh: '誤差秒',
    pairNeedTwo: '至少要選兩個不同的計時器才能綁成一對。',
    hotkeysTitle: '靜音快捷鍵',
    hotkeysHint: '按鍵切換的是「群組的本輪靜音」。不需要每個群組都設；沒設的用畫面上的 🔊 鈕。輸入框聚焦時快捷鍵不作用。',
    assignDefaultKeys: '自動分配預設鍵', hotkeyPh: '鍵',
    noGroups: '目前沒有群組。', noPairs: '目前沒有配對。', noTimelines: '目前沒有時間軸模板。',
    del: '刪除',
    footer3: '🔊 是<b>本輪靜音</b>：時間到那一刻不出聲，但倒數照跑、循環照接下一輪，跟暫停完全是兩回事。群組靜音蓋過單元靜音。靜音旗標只有按「⟲ 全部重設」（＝開場）才會一次清空。',
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
    muteTip: '本轮静音：时间到不出声，倒数照跑', unmuteTip: '取消本轮静音',
    muteGroupTip: '整个群组本轮静音（盖过单元设定）', unmuteGroupTip: '取消群组本轮静音',
    settings: '⚙ 设定', settingsTip: '展开/折叠设定',
    sessionTitle: '本场长度',
    sessionHint: '用本场长度将时间轴时间点换算成倒数时间。例如 10:00 → 8:50 = 1:10。只作为换算基准，不会自动倒数。',
    timelinesTitle: '时间轴模板',
    timelinesHint: '自定义名称并输入游戏时间点（逗号或空白分隔，例如 8:50, 7:20, 6:00）。套用后按顺序换算成计时器倒数时间；多出的时间点不使用，多出的计时器会先询问是否删除。套用后时间会锁定，改回「不挂时间轴」才能手动修改。「全部重设」只设定时间，不会开始倒数。',
    addTimeline: '+ 新增时间轴', newTimelineLabel: '新时间轴', timelineNone: '（不挂时间轴）',
    timelineNamePh: '名称', timelinePointsPh: '8:50, 7:20, 6:00',
    timelineApplyConfirm: '套用这个时间轴模板会删除群组内多出来的 {n} 个计时器，确定要套用吗？',
    timelineLockedTip: '时间已套用时间轴模板，锁住无法手动输入；改回「不挂时间轴」才能手动打时间。',
    pairsTitle: '合并语音通知',
    pairsHint: '手动绑定两个以上的计时器：时间接近时合并成一次语音通知。',
    addPair: '+ 新增配对', pairTextPh: '合并后要念的字', pairTolPh: '误差秒',
    pairNeedTwo: '至少要选两个不同的计时器才能绑成一对。',
    hotkeysTitle: '静音快捷键',
    hotkeysHint: '按键切换的是「群组的本轮静音」。不需要每个群组都设；没设的用画面上的 🔊 钮。输入框聚焦时快捷键不作用。',
    assignDefaultKeys: '自动分配预设键', hotkeyPh: '键',
    noGroups: '目前没有群组。', noPairs: '目前没有配对。', noTimelines: '目前没有时间轴模板。',
    del: '删除',
    footer3: '🔊 是<b>本轮静音</b>：时间到那一刻不出声，但倒数照跑、循环照接下一轮，跟暂停完全是两回事。群组静音盖过单元静音。静音旗标只有按「⟲ 全部重设」（＝开场）才会一次清空。',
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
    muteTip: 'Mute this round: silent at zero, countdown keeps running', unmuteTip: 'Unmute this round',
    muteGroupTip: 'Mute the whole group this round (overrides per-timer mute)', unmuteGroupTip: 'Unmute this group',
    settings: '⚙ Settings', settingsTip: 'Show/hide settings',
    sessionTitle: 'Session Length',
    sessionHint: 'Use the session length to convert timeline points into countdowns. Example: 10:00 → 8:50 = 1:10. Conversion baseline only; it does not run automatically.',
    timelinesTitle: 'Timeline Templates',
    timelinesHint: 'Name it and enter in-game time points (comma or space separated, e.g. 8:50, 7:20, 6:00). Applied in order as timer countdowns; extra points are unused, and extra timers prompt before deletion. Applied durations are locked until switched back to "no timeline". "Reset All" only sets the times; it does not start them.',
    addTimeline: '+ Add Timeline', newTimelineLabel: 'New Timeline', timelineNone: '(no timeline)',
    timelineNamePh: 'Name', timelinePointsPh: '8:50, 7:20, 6:00',
    timelineApplyConfirm: 'Applying this timeline will delete {n} extra timer(s) in this group. Continue?',
    timelineLockedTip: 'This duration comes from a timeline template and is locked. Switch back to "no timeline" to edit it by hand.',
    pairsTitle: 'Merged Voice Notifications',
    pairsHint: 'Manually bind two or more timers: when their times are close, merge them into one voice notification.',
    addPair: '+ Add Pair', pairTextPh: 'Text to announce', pairTolPh: 'tol s',
    pairNeedTwo: 'Pick at least two different timers to bind them together.',
    hotkeysTitle: 'Mute Shortcut Keys',
    hotkeysHint: 'A key toggles a group’s mute-this-round. Not every group needs one — use the 🔊 button for the rest. Keys are ignored while typing in a field.',
    assignDefaultKeys: 'Assign Defaults', hotkeyPh: 'key',
    noGroups: 'No groups yet.', noPairs: 'No pairs yet.', noTimelines: 'No timeline templates yet.',
    del: 'Delete',
    footer3: '🔊 is <b>mute this round</b>: silent at zero, but the countdown keeps running and loops still roll into the next round — it is not a pause. A muted group overrides its timers. Mute flags are only cleared by "⟲ Reset All" (kickoff).',
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