/**
 * 案件管制系統・後端（第 1 階段）
 * 綁定「總表」試算表的 Google Apps Script。這支程式是唯一碰觸試算表與 Drive 的地方。
 * 部署步驟見專案根目錄 README.md。
 */

var TZ = 'Asia/Taipei';
var BACKEND_VERSION = '0.1.0';
var GEOJSON_CELL_MAX = 50000;

/* ---------- 欄位結構（欄位名稱 = 試算表標題列） ---------- */
var CASE_FIELDS = [
  ['id', '案件編號'], ['name', '案件名稱'], ['type', '類型'], ['place', '地點'], ['lat', '緯度'], ['lng', '經度'],
  ['commander', '指揮官'], ['status', '狀態'], ['start', '開始時間'], ['end', '結束時間'], ['note', '備註'],
  ['sheetId', '試算表ID'], ['folderId', '資料夾ID'], ['joinCode', '加入碼'], ['version', '版本'], ['updated', '最後更新']
];
var ZONE_FIELDS = [
  ['id', '區域ID'], ['name', '名稱'], ['category', '類別'], ['color', '顏色'], ['geomType', '幾何類型'],
  ['radius', '半徑(m)'], ['geojson', 'GeoJSON'], ['measure', '量測'], ['hazard', '危險因子'], ['note', '備註'],
  ['created', '建立時間'], ['updated', '更新時間'],
  ['priority', '優先序'], ['status', '搜索狀態'], ['terrain', '地形說明'], ['quality', '搜索品質說明'], ['teamId', '關聯單位ID'], ['segmentId', '關聯分區ID']
];
var LOG_FIELDS = [
  ['time', '時間'], ['actor', '操作者'], ['action', '動作'], ['target', '對象ID'], ['content', '內容']
];
var UNIT_FIELDS = [
  ['id', '單位ID'], ['name', '名稱'], ['vehicles', '車輛'], ['leader', '帶隊官'], ['coord', '座標'], ['status', '狀態'], ['updated', '更新時間']
];
var MEMBER_FIELDS = [
  ['id', '人員ID'], ['name', '姓名'], ['unit', '單位'], ['identity', '身分'], ['status', '狀態'], ['group', '編組單位'],
  ['phone', '聯絡電話'], ['joined', '加入時間'], ['device', '裝置資訊'], ['token', '權杖']
];
var TASK_FIELDS = [
  ['id', '任務ID'], ['title', '標題'], ['content', '內容'], ['assignUnits', '指派單位'], ['assignPeople', '指派人員'],
  ['zoneId', '區域ID'], ['hazard', '危險因子'], ['status', '狀態'], ['tAssigned', '派遣時間'], ['tReceived', '接收時間'],
  ['tArrived', '抵達時間'], ['tRunning', '執行時間'], ['tDone', '完成時間'], ['tSupport', '需支援時間']
];
var REPORT_FIELDS = [
  ['id', '回報ID'], ['taskId', '任務ID'], ['zoneId', '區域ID'], ['reporter', '回報者'], ['source', '來源'], ['type', '類型'],
  ['content', '內容'], ['photos', '照片ID'], ['coord', '座標'], ['time', '時間']
];
var CAS_FIELDS = [
  ['id', '傷患ID'], ['mode', '模式'], ['triage', '檢傷'], ['red', '紅人數'], ['yellow', '黃人數'], ['green', '綠人數'], ['black', '黑人數'],
  ['parentId', '上層群體ID'], ['quick', '狀況快選'], ['desc', '描述'], ['photos', '照片ID'], ['coord', '發現座標'], ['reporter', '回報者'],
  ['taskId', '任務ID'], ['status', '後送狀態'], ['vehicle', '後送車輛'], ['hospital', '送往醫院'], ['tFound', '發現時間'],
  ['tTreated', '處置時間'], ['tTransporting', '後送時間'], ['tArrived', '到院時間'], ['time', '建立時間']
];
var PLAN_FIELDS = [
  ['id', '計畫ID'], ['type', '類型'], ['version', '版本'], ['periodStart', '期間起'], ['periodEnd', '期間迄'],
  ['content', '內容'], ['updatedBy', '更新者'], ['updated', '更新時間']
];
var ROSTER_UNIT_FIELDS = [['id', '單位ID'], ['name', '單位名稱'], ['category', '類別'], ['vehicles', '車輛'], ['order', '排序']];
var ROSTER_PEOPLE_FIELDS = [['id', '人員ID'], ['unit', '單位'], ['name', '姓名'], ['title', '職務'], ['order', '排序'], ['active', '啟用']];
var TASK_STATUS_TIME = { '已派遣': 'tAssigned', '已接收': 'tReceived', '已抵達': 'tArrived', '執行中': 'tRunning', '完成': 'tDone', '需支援': 'tSupport' };
var MASTER_SHEETS = {
  '案件索引': CASE_FIELDS.map(function (f) { return f[1]; }),
  '人員名冊': ROSTER_PEOPLE_FIELDS.map(function (f) { return f[1]; }),
  '單位名冊': ROSTER_UNIT_FIELDS.map(function (f) { return f[1]; }),
  '設定': ['參數名稱', '值']
};
// 之後階段新增的工作表（案件人員、單位部署、任務、回報、傷患…）加在這裡，ensureSheet_ 會自動補建
var CASE_SHEETS = {
  '區域': ZONE_FIELDS.map(function (f) { return f[1]; }),
  '事件日誌': LOG_FIELDS.map(function (f) { return f[1]; }),
  '案件人員': MEMBER_FIELDS.map(function (f) { return f[1]; }),
  '單位部署': UNIT_FIELDS.map(function (f) { return f[1]; }),
  '任務': TASK_FIELDS.map(function (f) { return f[1]; }),
  '回報': REPORT_FIELDS.map(function (f) { return f[1]; }),
  '傷患': CAS_FIELDS.map(function (f) { return f[1]; }),
  '計畫': PLAN_FIELDS.map(function (f) { return f[1]; })
};
var WRITE_ACTIONS = {
  createCase: 1, updateCase: 1, saveZone: 1, saveZones: 1, deleteZone: 1,
  saveRoster: 1, saveUnit: 1, deleteUnit: 1, addMember: 1, approveMember: 1, setMemberGroup: 1, revokeMember: 1,
  regenJoinCode: 1, joinCase: 1, joinAsTemp: 1, saveTask: 1, deleteTask: 1, updateTaskStatus: 1, submitReport: 1,
  fieldTaskStatus: 1, fieldReport: 1, fieldPhoto: 1,
  saveCasualty: 1, deleteCasualty: 1, splitCasualty: 1, updateTransport: 1, fieldCasualty: 1,
  savePlan: 1, deletePlan: 1
};
// 手機掃 QR 加入時還沒有個人權杖，改用「案件編號＋加入碼」驗證
// 手機端的 field* 與 getMyStatus/getFieldData 不用管理權杖，改在函式內以個人權杖 memberToken 驗證
var PUBLIC_ACTIONS = { getJoinInfo: 1, joinCase: 1, joinAsTemp: 1, getMyStatus: 1, getFieldData: 1, fieldTaskStatus: 1, fieldReport: 1, fieldPhoto: 1, fieldCasualty: 1 };

/* =====================================================================
 * 第一次使用：在編輯器選 setup 按「執行」。會建立工作表、根資料夾與管理權杖。
 * ===================================================================== */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  props.setProperty('MASTER_ID', ss.getId());
  Object.keys(MASTER_SHEETS).forEach(function (n) { ensureSheet_(ss, n, MASTER_SHEETS[n]); });
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('工作表1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  if (!props.getProperty('ROOT_FOLDER_ID')) {
    var root = DriveApp.createFolder('案件管制系統');
    props.setProperty('ROOT_FOLDER_ID', root.getId());
  }
  if (!props.getProperty('API_TOKEN')) props.setProperty('API_TOKEN', newToken_());
  Logger.log('設定完成。\n管理權杖（API_TOKEN）：' + props.getProperty('API_TOKEN') +
    '\n根資料夾：https://drive.google.com/drive/folders/' + props.getProperty('ROOT_FOLDER_ID') +
    '\n下一步：部署 → 新增部署作業 → 網頁應用程式。');
}
/** 忘記權杖時執行，記錄檔會顯示目前的權杖 */
function showToken() { Logger.log('API_TOKEN = ' + PropertiesService.getScriptProperties().getProperty('API_TOKEN')); }
/** 懷疑權杖外流時執行：換新權杖（舊的立刻失效，前端要重新貼新權杖） */
function resetToken() {
  var t = newToken_();
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', t);
  Logger.log('新的 API_TOKEN = ' + t);
}
function newToken_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); }

/* =====================================================================
 * 入口
 * ===================================================================== */
function doGet() {
  return json_({ ok: true, data: { service: '案件管制系統後端', version: BACKEND_VERSION, hint: '請以 POST 呼叫' } });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '請求格式錯誤' }); }
  var saved = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!saved) return json_({ ok: false, error: '後端尚未初始化，請先在編輯器執行 setup()' });
  if (!PUBLIC_ACTIONS[req.action] && !safeEqual_(String(req.token || ''), saved)) return json_({ ok: false, error: '權杖錯誤或未填寫，請到「設定」檢查' });

  var handlers = {
    ping: ping_, listCases: listCases_, getCase: getCase_, getVersion: getVersion_, getLog: getLog_,
    createCase: createCase_, updateCase: updateCase_, saveZone: saveZone_, saveZones: saveZones_, deleteZone: deleteZone_,
    getRoster: getRoster_, saveRoster: saveRoster_, saveUnit: saveUnit_, deleteUnit: deleteUnit_, addMember: addMember_,
    approveMember: approveMember_, setMemberGroup: setMemberGroup_, revokeMember: revokeMember_, regenJoinCode: regenJoinCode_,
    getJoinInfo: getJoinInfo_, joinCase: joinCase_, joinAsTemp: joinAsTemp_,
    saveTask: saveTask_, deleteTask: deleteTask_, updateTaskStatus: updateTaskStatus_, submitReport: submitReport_,
    getMyStatus: getMyStatus_, getFieldData: getFieldData_, fieldTaskStatus: fieldTaskStatus_, fieldReport: fieldReport_,
    fieldPhoto: fieldPhoto_, getPhoto: getPhoto_,
    saveCasualty: saveCasualty_, deleteCasualty: deleteCasualty_, splitCasualty: splitCasualty_, updateTransport: updateTransport_,
    fieldCasualty: fieldCasualty_, savePlan: savePlan_, deletePlan: deletePlan_
  };
  var fn = handlers[req.action];
  if (!fn) return json_({ ok: false, error: '不認得的動作：' + req.action });

  var lock = null;
  try {
    if (WRITE_ACTIONS[req.action]) { lock = LockService.getScriptLock(); lock.waitLock(25000); }
    return json_({ ok: true, data: fn(req) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function nowStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss'); }

/* =====================================================================
 * 試算表工具
 * ===================================================================== */
function master_() {
  var id = PropertiesService.getScriptProperties().getProperty('MASTER_ID');
  if (!id) throw new Error('後端尚未初始化，請先執行 setup()');
  return SpreadsheetApp.openById(id);
}

/** 取得或建立工作表；補齊缺少的欄位（舊案件升級不用手動改）；整張設為純文字格式避免日期被自動轉換 */
function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name), created = false;
  if (!sh) { sh = ss.insertSheet(name); created = true; }
  var lastCol = sh.getLastColumn();
  var existing = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    sh.getRange(1, 1, 1, existing.length + missing.length).setFontWeight('bold').setBackground('#eceff1');
    sh.setFrozenRows(1);
  }
  if (created || missing.length) {   // 只在新建或補欄時整張設純文字，平常讀寫不重做（很慢）
    var cols = Math.max(sh.getLastColumn(), 1);
    if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
    sh.getRange(1, 1, sh.getMaxRows(), cols).setNumberFormat('@');
  }
  return sh;
}

function headers_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }

/** 讀整張表成物件陣列（依標題列對照 fields：[[key, 標題], …]），並附上 _row（試算表列號） */
function readAll_(sh, fields) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var hs = headers_(sh);
  var vals = sh.getRange(2, 1, last - 1, hs.length).getValues();
  var idx = fields.map(function (f) { return hs.indexOf(f[1]); });
  return vals.map(function (row, i) {
    var o = { _row: i + 2 };
    fields.forEach(function (f, k) { o[f[0]] = idx[k] >= 0 ? String(row[idx[k]] == null ? '' : row[idx[k]]) : ''; });
    return o;
  });
}
function toRowArray_(sh, fields, obj) {
  var hs = headers_(sh);
  var row = hs.map(function () { return ''; });
  fields.forEach(function (f) {
    var i = hs.indexOf(f[1]);
    if (i >= 0) row[i] = obj[f[0]] == null ? '' : String(obj[f[0]]);
  });
  return row;
}
function writeRow_(sh, fields, rowNum, obj) {
  var row = toRowArray_(sh, fields, obj);
  sh.getRange(rowNum, 1, 1, row.length).setValues([row]);
}
function appendRows_(sh, fields, objs) {
  if (!objs.length) return;
  var rows = objs.map(function (o) { return toRowArray_(sh, fields, o); });
  var start = Math.max(sh.getLastRow(), 1) + 1;
  if (sh.getMaxRows() < start + rows.length) sh.insertRowsAfter(sh.getMaxRows(), start + rows.length - sh.getMaxRows());
  sh.getRange(start, 1, rows.length, rows[0].length).setNumberFormat('@').setValues(rows);
}

/* ---------- 案件索引 ---------- */
function indexSheet_() { return master_().getSheetByName('案件索引'); }
function findCase_(id) {
  var all = readAll_(indexSheet_(), CASE_FIELDS);
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  throw new Error('找不到案件 ' + id);
}
function caseOut_(c) {
  var o = {};
  CASE_FIELDS.forEach(function (f) { o[f[0]] = c[f[0]]; });
  o.version = Number(c.version) || 0;
  return o;
}
function caseSs_(c) { return SpreadsheetApp.openById(c.sheetId); }

/** 版本 +1 並寫回索引，同步更新快取；回傳新版本號 */
function bump_(c) {
  var sh = indexSheet_(), hs = headers_(sh);
  var v = (Number(c.version) || 0) + 1, t = nowStr_();
  sh.getRange(c._row, hs.indexOf('版本') + 1).setValue(String(v));
  sh.getRange(c._row, hs.indexOf('最後更新') + 1).setValue(t);
  c.version = String(v); c.updated = t;
  putVerCache_(c);
  return v;
}
function putVerCache_(c) {
  CacheService.getScriptCache().put('v_' + c.id, JSON.stringify({ version: Number(c.version) || 0, updated: c.updated, status: c.status }), 21600);
}

function logEvent_(ss, actor, action, target, content) {
  var sh = ss.getSheetByName('事件日誌');
  appendRows_(sh, LOG_FIELDS, [{ time: nowStr_(), actor: actor || '', action: action, target: target || '', content: content || '' }]);
}

/* =====================================================================
 * 動作：讀取
 * ===================================================================== */
function ping_() { return { mode: 'gas', version: BACKEND_VERSION, time: nowStr_() }; }

function listCases_() {
  var all = readAll_(indexSheet_(), CASE_FIELDS).map(caseOut_);
  all.sort(function (a, b) { return a.id < b.id ? 1 : -1; });
  return all;
}

function getCase_(req) {
  var c = findCase_(req.caseId);
  var ss = caseSs_(c);
  var strip = function (r) { delete r._row; return r; };
  ['區域', '案件人員', '單位部署', '任務', '回報', '傷患', '計畫'].forEach(function (n) { ensureSheet_(ss, n, CASE_SHEETS[n]); });   // 舊案件自動補表
  return {
    case: caseOut_(c),
    zones: readAll_(ss.getSheetByName('區域'), ZONE_FIELDS).map(strip),
    units: readAll_(ss.getSheetByName('單位部署'), UNIT_FIELDS).map(strip).map(unitOut_),
    members: readAll_(ss.getSheetByName('案件人員'), MEMBER_FIELDS).map(strip).map(function (m) { m.token = ''; return m; }),
    tasks: readAll_(ss.getSheetByName('任務'), TASK_FIELDS).map(strip),
    reports: readAll_(ss.getSheetByName('回報'), REPORT_FIELDS).map(strip),
    casualties: readAll_(ss.getSheetByName('傷患'), CAS_FIELDS).map(strip).map(casOut_),
    plans: readAll_(ss.getSheetByName('計畫'), PLAN_FIELDS).map(strip)
  };
}

/** 輪詢用：先看快取，快取沒有才讀索引表 */
function getVersion_(req) {
  var hit = CacheService.getScriptCache().get('v_' + req.caseId);
  if (hit) return JSON.parse(hit);
  var c = findCase_(req.caseId);
  putVerCache_(c);
  return { version: Number(c.version) || 0, updated: c.updated, status: c.status };
}

function getLog_(req) {
  var c = findCase_(req.caseId);
  return readAll_(caseSs_(c).getSheetByName('事件日誌'), LOG_FIELDS).map(function (r) { delete r._row; return r; });
}

/* =====================================================================
 * 動作：建案、改案
 * ===================================================================== */
function createCase_(req) {
  var f = req.fields || {};
  var name = String(f.name || '').trim();
  if (!name) throw new Error('請填寫案件名稱');
  var props = PropertiesService.getScriptProperties();
  var rootId = props.getProperty('ROOT_FOLDER_ID');
  if (!rootId) throw new Error('後端尚未初始化，請先執行 setup()');

  var idx = indexSheet_();
  var day = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  var max = 0;
  readAll_(idx, CASE_FIELDS).forEach(function (c) {
    if (c.id.indexOf(day + '-') === 0) max = Math.max(max, Number(c.id.slice(9)) || 0);
  });
  var id = day + '-' + ('00' + (max + 1)).slice(-3);

  var folder = DriveApp.getFolderById(rootId).createFolder(id + ' ' + name);
  var ss = SpreadsheetApp.create(id + ' ' + name);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  Object.keys(CASE_SHEETS).forEach(function (n) { ensureSheet_(ss, n, CASE_SHEETS[n]); });
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('工作表1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  var c = {
    id: id, name: name, type: f.type || '其他', place: f.place || '', lat: f.lat == null ? '' : f.lat, lng: f.lng == null ? '' : f.lng,
    commander: f.commander || '', status: '進行中', start: nowStr_(), end: '', note: f.note || '',
    sheetId: ss.getId(), folderId: folder.getId(), joinCode: String(100000 + Math.floor(Math.random() * 900000)),
    version: '1', updated: nowStr_()
  };
  appendRows_(idx, CASE_FIELDS, [c]);
  logEvent_(ss, req.actor, '建立案件', id, name);
  putVerCache_(c);
  return caseOut_(c);
}

function updateCase_(req) {
  var c = findCase_(req.caseId), f = req.fields || {};
  var ss = caseSs_(c), changed = [];
  ['name', 'type', 'place', 'lat', 'lng', 'commander', 'note'].forEach(function (k) {
    if (k in f) { c[k] = f[k] == null ? '' : String(f[k]); changed.push(k); }
  });
  if ('status' in f && f.status !== c.status) {
    if (f.status !== '進行中' && f.status !== '已結案') throw new Error('狀態只能是「進行中」或「已結案」');
    c.status = f.status;
    c.end = f.status === '已結案' ? nowStr_() : '';
    logEvent_(ss, req.actor, f.status === '已結案' ? '結案' : '重新開啟', c.id, '');
  } else {
    logEvent_(ss, req.actor, '修改案件資料', c.id, changed.join('、'));
  }
  writeRow_(indexSheet_(), CASE_FIELDS, c._row, c);
  bump_(c);
  return caseOut_(c);
}

/* =====================================================================
 * 動作：區域
 * ===================================================================== */
function openCaseForWrite_(caseId) {
  var c = findCase_(caseId);
  if (c.status === '已結案') throw new Error('案件已結案，請先重新開啟再修改');
  return c;
}
function checkZone_(z) {
  if (!z || !z.id) throw new Error('區域資料缺少 ID');
  if (String(z.geojson || '').length > GEOJSON_CELL_MAX) throw new Error('區域「' + (z.name || z.id) + '」幾何資料過大（超過 ' + GEOJSON_CELL_MAX + ' 字元）');
}
function zoneRows_(sh) {
  var map = {};
  readAll_(sh, ZONE_FIELDS).forEach(function (z) { map[z.id] = z; });
  return map;
}

function saveZone_(req) {
  var c = openCaseForWrite_(req.caseId), z = req.zone;
  checkZone_(z);
  var ss = caseSs_(c), sh = ss.getSheetByName('區域');
  var ex = zoneRows_(sh)[z.id];
  var rec = {};
  ZONE_FIELDS.forEach(function (f) { rec[f[0]] = z[f[0]] == null ? '' : z[f[0]]; });
  rec.updated = nowStr_();
  if (ex) { rec.created = ex.created || rec.created || nowStr_(); writeRow_(sh, ZONE_FIELDS, ex._row, rec); }
  else { rec.created = rec.created || nowStr_(); appendRows_(sh, ZONE_FIELDS, [rec]); }
  logEvent_(ss, req.actor, ex ? '修改區域' : '新增區域', rec.id, rec.category + '／' + rec.name);
  var v = bump_(c);
  return { zone: rec, version: v };
}

function saveZones_(req) {
  var c = openCaseForWrite_(req.caseId), zs = req.zones || [];
  zs.forEach(checkZone_);
  var ss = caseSs_(c), sh = ss.getSheetByName('區域');
  var map = zoneRows_(sh), news = [];
  zs.forEach(function (z) {
    var rec = {}; ZONE_FIELDS.forEach(function (f) { rec[f[0]] = z[f[0]] == null ? '' : z[f[0]]; });
    rec.updated = nowStr_();
    if (map[rec.id]) { rec.created = map[rec.id].created || nowStr_(); writeRow_(sh, ZONE_FIELDS, map[rec.id]._row, rec); }
    else { rec.created = rec.created || nowStr_(); news.push(rec); }
  });
  appendRows_(sh, ZONE_FIELDS, news);
  logEvent_(ss, req.actor, '批次新增區域', '', zs.length + ' 筆' + (req.note ? '（' + req.note + '）' : ''));
  return { count: zs.length, version: bump_(c) };
}

function deleteZone_(req) {
  var c = openCaseForWrite_(req.caseId);
  var ss = caseSs_(c), sh = ss.getSheetByName('區域');
  var z = zoneRows_(sh)[req.zoneId];
  if (!z) throw new Error('找不到要刪除的區域');
  sh.deleteRow(z._row);
  logEvent_(ss, req.actor, '刪除區域', z.id, z.category + '／' + z.name);
  return { version: bump_(c) };
}


/* =====================================================================
 * 第 2 階段：名冊、單位部署、人員、任務、回報
 * ===================================================================== */
function sheet_(ss, name) { return ss.getSheetByName(name) || ensureSheet_(ss, name, CASE_SHEETS[name]); }

/** 依 ID 覆蓋或新增一列；回傳是否原本就存在 */
function upsertById_(sh, fields, rec) {
  var ex = null;
  readAll_(sh, fields).forEach(function (r) { if (r.id === String(rec.id)) ex = r; });
  if (ex) writeRow_(sh, fields, ex._row, rec); else appendRows_(sh, fields, [rec]);
  return !!ex;
}
function findById_(sh, fields, id) {
  var all = readAll_(sh, fields);
  for (var i = 0; i < all.length; i++) if (all[i].id === String(id)) return all[i];
  return null;
}
function pick_(fields, src) {
  var o = {};
  fields.forEach(function (f) { o[f[0]] = src[f[0]] == null ? '' : src[f[0]]; });
  return o;
}

/* ---------- 名冊（總表） ---------- */
function getRoster_() {
  var ss = master_();
  var strip = function (r) { delete r._row; return r; };
  return {
    units: readAll_(ss.getSheetByName('單位名冊'), ROSTER_UNIT_FIELDS).map(strip),
    people: readAll_(ss.getSheetByName('人員名冊'), ROSTER_PEOPLE_FIELDS).map(strip)
  };
}
function replaceRows_(sh, fields, objs) {
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
  appendRows_(sh, fields, objs.map(function (o) { return pick_(fields, o); }));
}
function saveRoster_(req) {
  var ss = master_();
  replaceRows_(ss.getSheetByName('單位名冊'), ROSTER_UNIT_FIELDS, req.units || []);
  replaceRows_(ss.getSheetByName('人員名冊'), ROSTER_PEOPLE_FIELDS, req.people || []);
  return getRoster_();
}

/* ---------- 單位部署 ---------- */
function unitOut_(u) {
  var p = String(u.coord || '').split(',');
  u.lat = p.length === 2 && p[0] !== '' ? Number(p[0]) : '';
  u.lng = p.length === 2 && p[1] !== '' ? Number(p[1]) : '';
  delete u.coord;
  return u;
}
function saveUnit_(req) {
  var c = openCaseForWrite_(req.caseId), u = req.unit || {};
  if (!u.id) throw new Error('單位資料缺少 ID');
  var ss = caseSs_(c);
  var rec = pick_(UNIT_FIELDS, u);
  rec.coord = (u.lat !== '' && u.lat != null && u.lng !== '' && u.lng != null) ? u.lat + ',' + u.lng : '';
  rec.updated = nowStr_();
  var ex = upsertById_(sheet_(ss, '單位部署'), UNIT_FIELDS, rec);
  logEvent_(ss, req.actor, ex ? '修改單位部署' : '新增單位部署', rec.id, rec.name + '（' + rec.status + '）');
  return { version: bump_(c) };
}
function deleteUnit_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '單位部署');
  var u = findById_(sh, UNIT_FIELDS, req.unitId);
  if (!u) throw new Error('找不到單位');
  sh.deleteRow(u._row);
  logEvent_(ss, req.actor, '移除單位部署', u.id, u.name);
  return { version: bump_(c) };
}

/* ---------- 人員 ---------- */
function newMemberId_() { return 'M' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase(); }
function newToken_2() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); }
function addMember_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '案件人員'), m = req.member || {};
  var name = String(m.name || '').trim();
  if (!name) throw new Error('請填寫姓名');
  readAll_(sh, MEMBER_FIELDS).forEach(function (x) {
    if (x.name === name && x.unit === (m.unit || '') && x.status !== '已撤銷') throw new Error(name + '（' + (m.unit || '') + '）已經在人員名單中');
  });
  var rec = { id: newMemberId_(), name: name, unit: m.unit || '', identity: m.identity || '名冊', status: '有效',
    group: m.group || m.unit || '', phone: m.phone || '', joined: nowStr_(), device: '指揮所代登', token: '' };
  appendRows_(sh, MEMBER_FIELDS, [rec]);
  logEvent_(ss, req.actor, '代為加入人員', rec.id, name + '（' + rec.unit + '）');
  return { member: rec, version: bump_(c) };
}
function memberOp_(req, fn) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '案件人員');
  var m = findById_(sh, MEMBER_FIELDS, req.memberId);
  if (!m) throw new Error('找不到人員');
  fn(m, ss);
  writeRow_(sh, MEMBER_FIELDS, m._row, m);
  return { version: bump_(c) };
}
function approveMember_(req) {
  return memberOp_(req, function (m, ss) {
    var ok = req.approve !== false;
    m.status = ok ? '有效' : '已撤銷';
    if (ok) m.group = req.group || m.group || m.unit; else m.token = '';
    logEvent_(ss, req.actor, ok ? '確認臨時人員' : '拒絕臨時人員', m.id, m.name + '（' + m.unit + '）');
  });
}
function setMemberGroup_(req) {
  return memberOp_(req, function (m, ss) {
    m.group = req.group || '';
    logEvent_(ss, req.actor, '調整編組', m.id, m.name + ' → ' + (m.group || '（無）'));
  });
}
function revokeMember_(req) {
  return memberOp_(req, function (m, ss) {
    m.status = '已撤銷'; m.token = '';
    logEvent_(ss, req.actor, '撤銷人員', m.id, m.name + '（' + m.unit + '）');
  });
}
function regenJoinCode_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c);
  c.joinCode = String(100000 + Math.floor(Math.random() * 900000));
  writeRow_(indexSheet_(), CASE_FIELDS, c._row, c);
  logEvent_(ss, req.actor, '重新產生加入碼', c.id, '舊加入碼失效');
  return { joinCode: c.joinCode, version: bump_(c) };
}

/* 手機加入：以「案件編號＋加入碼」驗證（不需管理權杖）。加入碼每案不同，結案即失效 */
function checkJoin_(req) {
  var c;
  try { c = findCase_(req.caseId); } catch (e) { throw new Error('加入碼錯誤或已失效'); }
  if (String(req.code || '') !== c.joinCode) throw new Error('加入碼錯誤或已失效');
  if (c.status === '已結案') throw new Error('案件已結案，加入碼已失效');
  return c;
}
function getJoinInfo_(req) {
  var c = checkJoin_(req), r = getRoster_();
  return { caseId: c.id, name: c.name, type: c.type, units: r.units,
    people: r.people.filter(function (p) { return p.active !== '否'; }) };
}
function joinCase_(req) {
  var c = checkJoin_(req), ss = caseSs_(c), sh = sheet_(ss, '案件人員');
  var person = null;
  getRoster_().people.forEach(function (p) { if (p.id === String(req.personId)) person = p; });
  if (!person) throw new Error('名冊中找不到這位人員');
  var token = newToken_2();
  var m = null;
  readAll_(sh, MEMBER_FIELDS).forEach(function (x) { if (x.name === person.name && x.unit === person.unit) m = x; });
  if (m) {
    if (m.status === '已撤銷') throw new Error('您已被指揮所撤銷，請洽指揮所');
    if (m.device && m.device !== (req.device || '')) logEvent_(ss, req.actor, '重複加入（第二支裝置）', m.id, m.name + '（' + m.unit + '）');
    m.status = '有效'; m.token = token; m.device = req.device || ''; m.joined = nowStr_();
    writeRow_(sh, MEMBER_FIELDS, m._row, m);
  } else {
    m = { id: newMemberId_(), name: person.name, unit: person.unit, identity: '名冊', status: '有效', group: person.unit,
      phone: '', joined: nowStr_(), device: req.device || '', token: token };
    appendRows_(sh, MEMBER_FIELDS, [m]);
    logEvent_(ss, person.name, '加入案件', m.id, person.name + '（' + person.unit + '）');
  }
  bump_(c);
  return { member: { id: m.id, name: m.name, unit: m.unit, status: m.status }, token: token };
}
function joinAsTemp_(req) {
  var c = checkJoin_(req), ss = caseSs_(c), sh = sheet_(ss, '案件人員');
  var name = String(req.name || '').trim();
  if (!name) throw new Error('請填寫姓名');
  var m = { id: newMemberId_(), name: name, unit: req.unit || '', identity: '臨時', status: '待確認', group: '',
    phone: req.phone || '', joined: nowStr_(), device: req.device || '', token: newToken_2() };
  appendRows_(sh, MEMBER_FIELDS, [m]);
  logEvent_(ss, name, '臨時人員申請加入', m.id, name + '（' + m.unit + '）');
  bump_(c);
  return { member: { id: m.id, name: m.name, unit: m.unit, status: m.status }, token: m.token };
}

/* ---------- 任務與回報 ---------- */
function saveTask_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '任務'), t = req.task || {};
  if (!t.id) throw new Error('任務資料缺少 ID');
  if (!String(t.title || '').trim()) throw new Error('請填寫任務標題');
  var old = findById_(sh, TASK_FIELDS, t.id);
  var merged = {};
  Object.keys(old || {}).forEach(function (k) { merged[k] = old[k]; });
  Object.keys(t).forEach(function (k) { merged[k] = t[k]; });
  var rec = pick_(TASK_FIELDS, merged);
  if (!old) { rec.status = rec.status || '已派遣'; rec.tAssigned = rec.tAssigned || nowStr_(); }
  upsertById_(sh, TASK_FIELDS, rec);
  logEvent_(ss, req.actor, old ? '修改任務' : '派遣任務', rec.id, rec.title);
  return { task: rec, version: bump_(c) };
}
function deleteTask_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '任務');
  var t = findById_(sh, TASK_FIELDS, req.taskId);
  if (!t) throw new Error('找不到任務');
  sh.deleteRow(t._row);
  logEvent_(ss, req.actor, '刪除任務', t.id, t.title);
  return { version: bump_(c) };
}
function updateTaskStatus_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '任務');
  var t = findById_(sh, TASK_FIELDS, req.taskId);
  if (!t) throw new Error('找不到任務');
  var tf = TASK_STATUS_TIME[req.status];
  if (!tf) throw new Error('不認得的任務狀態：' + req.status);
  t.status = req.status; t[tf] = nowStr_();
  writeRow_(sh, TASK_FIELDS, t._row, t);
  logEvent_(ss, req.actor, '任務狀態', t.id, t.title + ' → ' + req.status);
  delete t._row;
  return { task: t, version: bump_(c) };
}
function submitReport_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), r = req.report || {};
  if (!String(r.content || '').trim()) throw new Error('請填寫回報內容');
  var rec = pick_(REPORT_FIELDS, r);
  rec.id = rec.id || ('R' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase());
  rec.source = rec.source || '指揮所代登'; rec.type = rec.type || '文字'; rec.time = rec.time || nowStr_();
  appendRows_(sheet_(ss, '回報'), REPORT_FIELDS, [rec]);
  logEvent_(ss, req.actor, '代登回報', rec.id, (rec.reporter ? rec.reporter + '：' : '') + String(rec.content).slice(0, 60));
  return { report: rec, version: bump_(c) };
}


/* =====================================================================
 * 第 3 階段：手機端（以個人權杖 memberToken 驗證；只能讀自己的案件、改自己任務的狀態、新增回報）
 * ===================================================================== */
function ids_(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

/** 驗證手機身分。needActive=true 時要求已確認（有效）且案件未結案 */
function authMember_(req, needActive) {
  var c;
  try { c = findCase_(req.caseId); } catch (e) { throw new Error('登入已失效，請重新掃描 QR Code 加入'); }
  var tk = String(req.memberToken || ''), ss = caseSs_(c), m = null;
  if (tk) readAll_(sheet_(ss, '案件人員'), MEMBER_FIELDS).forEach(function (x) { if (x.token && safeEqual_(x.token, tk)) m = x; });
  if (!m) throw new Error('登入已失效，請重新掃描 QR Code 加入');
  if (m.status === '已撤銷') throw new Error('您已被指揮所撤銷，請洽指揮所');
  if (Date.now() - new Date(String(m.joined).replace(/-/g, '/')).getTime() > 24 * 3600 * 1000) throw new Error('登入已超過 24 小時，請重新掃描 QR Code');
  if (needActive) {
    if (m.status !== '有效') throw new Error('尚待指揮所確認，目前還不能回報');
    if (c.status === '已結案') throw new Error('案件已結案，無法再修改');
  }
  return { c: c, m: m, ss: ss };
}
function myUnitIds_(units, m) {
  var name = m.group || m.unit;
  return units.filter(function (u) { return u.name === name; }).map(function (u) { return u.id; });
}
function visibleTasks_(tasks, m, myIds) {
  return tasks.filter(function (t) {
    return ids_(t.assignUnits).some(function (i) { return myIds.indexOf(i) >= 0; }) || ids_(t.assignPeople).indexOf(m.id) >= 0;
  });
}
function stripRow_(r) { delete r._row; return r; }

function getMyStatus_(req) {
  var a = authMember_(req, false);
  return { memberStatus: a.m.status, caseStatus: a.c.status, version: Number(a.c.version) || 0 };
}

function getFieldData_(req) {
  var a = authMember_(req, false), c = a.c, m = a.m, ss = a.ss;
  var active = m.status === '有效';
  var units = readAll_(sheet_(ss, '單位部署'), UNIT_FIELDS).map(stripRow_).map(unitOut_);
  var myIds = myUnitIds_(units, m);
  var tasks = active ? visibleTasks_(readAll_(sheet_(ss, '任務'), TASK_FIELDS).map(stripRow_), m, myIds) : [];
  var tids = tasks.map(function (t) { return t.id; });
  var uids = {};
  myIds.forEach(function (i) { uids[i] = 1; });
  tasks.forEach(function (t) { ids_(t.assignUnits).forEach(function (i) { uids[i] = 1; }); });
  var unitsOut = units.filter(function (u) { return uids[u.id]; }).map(function (u) { return { id: u.id, name: u.name, leader: u.leader, status: u.status }; });
  var names = unitsOut.map(function (u) { return u.name; });
  var members = active ? readAll_(sheet_(ss, '案件人員'), MEMBER_FIELDS).filter(function (x) {
    return x.status === '有效' && names.indexOf(x.group || x.unit) >= 0;
  }).map(function (x) { return { name: x.name, group: x.group || x.unit }; }) : [];
  return {
    case: { id: c.id, name: c.name, type: c.type, place: c.place, lat: c.lat, lng: c.lng, status: c.status, version: Number(c.version) || 0 },
    member: { id: m.id, name: m.name, unit: m.unit, group: m.group, status: m.status },
    zones: readAll_(ss.getSheetByName('區域'), ZONE_FIELDS).map(stripRow_),
    units: unitsOut, tasks: tasks,
    reports: active ? readAll_(sheet_(ss, '回報'), REPORT_FIELDS).map(stripRow_).filter(function (r) { return tids.indexOf(r.taskId) >= 0; }) : [],
    people: members, version: Number(c.version) || 0,
    casualties: active ? readAll_(sheet_(ss, '傷患'), CAS_FIELDS).map(stripRow_).filter(function (x) { return x.reporter === m.name + '（' + m.unit + '）'; }).map(casOut_) : []   // 手機只看得到自己回報的傷患
  };
}

function fieldTaskStatus_(req) {
  var a = authMember_(req, true), sh = sheet_(a.ss, '任務');
  var units = readAll_(sheet_(a.ss, '單位部署'), UNIT_FIELDS);
  var all = readAll_(sh, TASK_FIELDS);
  var mine = visibleTasks_(all, a.m, myUnitIds_(units, a.m));
  var t = null;
  mine.forEach(function (x) { if (x.id === String(req.taskId)) t = x; });
  if (!t) throw new Error('找不到這個任務，或不是指派給您的');
  var tf = TASK_STATUS_TIME[req.status];
  if (!tf || req.status === '已派遣') throw new Error('不能設定成這個狀態：' + req.status);
  t.status = req.status; t[tf] = nowStr_();
  writeRow_(sh, TASK_FIELDS, t._row, t);
  logEvent_(a.ss, a.m.name + '（' + a.m.unit + '）', '任務狀態（手機）', t.id, t.title + ' → ' + req.status);
  stripRow_(t);
  return { task: t, version: bump_(a.c) };
}

function fieldReport_(req) {
  var a = authMember_(req, true), r = req.report || {};
  var photos = Array.isArray(r.photos) ? r.photos : ids_(r.photos);
  if (!String(r.content || '').trim() && !photos.length) throw new Error('請填寫回報內容或附上照片');
  var rec = {
    id: 'R' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase(), taskId: r.taskId || '', zoneId: r.zoneId || '',
    reporter: a.m.name + '（' + a.m.unit + '）', source: '手機', type: r.type || '文字',
    content: String(r.content || '').trim() || '（僅照片）', photos: photos.slice(0, 3).join(','), coord: r.coord || '', time: nowStr_()
  };
  appendRows_(sheet_(a.ss, '回報'), REPORT_FIELDS, [rec]);
  logEvent_(a.ss, rec.reporter, '手機回報', rec.id, rec.content.slice(0, 60));
  return { report: rec, version: bump_(a.c) };
}

function photoFolder_(c) {
  var root = DriveApp.getFolderById(c.folderId), it = root.getFoldersByName('照片');
  return it.hasNext() ? it.next() : root.createFolder('照片');   // 不開公開連結
}
function fieldPhoto_(req) {
  var a = authMember_(req, true);
  var data = String(req.data || ''), mime = String(req.mime || 'image/jpeg');
  if (mime.indexOf('image/') !== 0) throw new Error('只能上傳圖片');
  if (data.length > 3000000) throw new Error('照片太大，請重拍');
  var name = a.c.id + '_' + a.m.name + '_' + Utilities.formatDate(new Date(), TZ, 'HHmmss') + '.jpg';
  var file = photoFolder_(a.c).createFile(Utilities.newBlob(Utilities.base64Decode(data), mime, name));
  return { photoId: file.getId() };
}
/** 指揮所讀取照片（回傳 base64）。只允許讀該案件「照片」資料夾內的檔案 */
function getPhoto_(req) {
  var c = findCase_(req.caseId), folder = photoFolder_(c), file = DriveApp.getFileById(req.photoId), ok = false;
  var ps = file.getParents();
  while (ps.hasNext()) if (ps.next().getId() === folder.getId()) ok = true;
  if (!ok) throw new Error('找不到照片');
  return { mime: file.getMimeType(), data: Utilities.base64Encode(file.getBlob().getBytes()) };
}


/* =====================================================================
 * 第 4 階段：傷患（手機回報 + 指揮所後送管制）
 * ===================================================================== */
var TRIAGE_ = [['紅', 'red'], ['黃', 'yellow'], ['綠', 'green'], ['黑', 'black']];
var TRANSPORT_TIME = { '發現': 'tFound', '處置': 'tTreated', '後送中': 'tTransporting', '已到院': 'tArrived' };

function casOut_(x) {
  TRIAGE_.forEach(function (t) { x[t[1]] = Number(x[t[1]]) || 0; });
  return x;
}
function casLabel_(x) {
  if (x.mode === '群體') return '多人 ' + TRIAGE_.filter(function (t) { return Number(x[t[1]]) > 0; }).map(function (t) { return t[0] + x[t[1]]; }).join(' ');
  return '單人 檢傷' + x.triage + (x.quick ? '（' + x.quick + '）' : '');
}
/** 整理並檢查一筆傷患資料（單人要有檢傷色；多人至少 1 人） */
function normCasualty_(x) {
  var r = {};
  Object.keys(x).forEach(function (k) { r[k] = x[k]; });
  var n = function (v) { return Math.max(0, Math.min(999, parseInt(v, 10) || 0)); };
  if (r.mode === '群體') {
    r.triage = ''; var total = 0;
    TRIAGE_.forEach(function (t) { r[t[1]] = n(r[t[1]]); total += r[t[1]]; });
    if (total < 1) throw new Error('多人回報至少要有 1 人');
  } else {
    r.mode = '單人';
    if (!TRIAGE_.some(function (t) { return t[0] === r.triage; })) throw new Error('請選擇檢傷等級（紅／黃／綠／黑）');
    TRIAGE_.forEach(function (t) { r[t[1]] = 0; });
  }
  r.photos = Array.isArray(r.photos) ? r.photos.slice(0, 3).join(',') : String(r.photos || '');
  return r;
}

function saveCasualty_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '傷患'), x = req.casualty || {};
  if (!x.id) throw new Error('傷患資料缺少 ID');
  var old = findById_(sh, CAS_FIELDS, x.id);
  var merged = {};
  Object.keys(old || {}).forEach(function (k) { merged[k] = old[k]; });
  Object.keys(x).forEach(function (k) { merged[k] = x[k]; });
  var rec = pick_(CAS_FIELDS, normCasualty_(merged));
  if (!old) { rec.status = rec.status || '發現'; rec.tFound = rec.tFound || nowStr_(); rec.time = rec.time || nowStr_(); }
  upsertById_(sh, CAS_FIELDS, rec);
  logEvent_(ss, req.actor, old ? '修改傷患' : '新增傷患', rec.id, casLabel_(rec));
  return { casualty: casOut_(rec), version: bump_(c) };
}
function deleteCasualty_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '傷患');
  var x = findById_(sh, CAS_FIELDS, req.casualtyId);
  if (!x) throw new Error('找不到傷患');
  // 刪群體時，拆出來的個別傷患保留，但解除與群體的關聯
  readAll_(sh, CAS_FIELDS).forEach(function (y) {
    if (y.parentId === x.id) { y.parentId = ''; writeRow_(sh, CAS_FIELDS, y._row, y); }
  });
  x = findById_(sh, CAS_FIELDS, req.casualtyId);
  sh.deleteRow(x._row);
  logEvent_(ss, req.actor, '刪除傷患', x.id, casLabel_(x));
  return { version: bump_(c) };
}
function splitCasualty_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '傷患');
  var all = readAll_(sh, CAS_FIELDS), g = null;
  all.forEach(function (y) { if (y.id === String(req.groupId)) g = y; });
  if (!g || g.mode !== '群體') throw new Error('找不到要拆分的群體');
  var made = [], counts = req.counts || {};
  TRIAGE_.forEach(function (t) {
    var want = parseInt(counts[t[0]], 10) || 0;
    if (want <= 0) return;
    var used = all.filter(function (y) { return y.parentId === g.id && y.triage === t[0]; }).length;
    var rem = (Number(g[t[1]]) || 0) - used;
    if (want > rem) throw new Error(t[0] + '色只剩 ' + Math.max(0, rem) + ' 人可拆分');
    for (var i = 0; i < want; i++) {
      made.push({
        id: 'C' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase(), mode: '單人', triage: t[0], red: 0, yellow: 0, green: 0, black: 0,
        parentId: g.id, quick: '', desc: '', photos: '', coord: g.coord, reporter: g.reporter, taskId: g.taskId, status: g.status,
        vehicle: g.vehicle, hospital: g.hospital, tFound: g.tFound, tTreated: g.tTreated, tTransporting: g.tTransporting,
        tArrived: g.tArrived, time: nowStr_()
      });
    }
  });
  if (!made.length) throw new Error('請輸入要拆分的人數');
  appendRows_(sh, CAS_FIELDS, made);
  logEvent_(ss, req.actor, '拆分傷患群體', g.id, '拆出 ' + made.length + ' 人');
  return { casualties: made.map(casOut_), version: bump_(c) };
}
function updateTransport_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '傷患');
  var x = findById_(sh, CAS_FIELDS, req.casualtyId);
  if (!x) throw new Error('找不到傷患');
  var tf = TRANSPORT_TIME[req.status];
  if (!tf) throw new Error('不認得的後送狀態：' + req.status);
  x.status = req.status; x[tf] = nowStr_();
  if (req.vehicle !== undefined) x.vehicle = req.vehicle;
  if (req.hospital !== undefined) x.hospital = req.hospital;
  writeRow_(sh, CAS_FIELDS, x._row, x);
  logEvent_(ss, req.actor, '後送狀態', x.id, casLabel_(x) + ' → ' + req.status + (x.vehicle ? '，車輛 ' + x.vehicle : '') + (x.hospital ? '，送往 ' + x.hospital : ''));
  delete x._row;
  return { casualty: casOut_(x), version: bump_(c) };
}
function fieldCasualty_(req) {
  var a = authMember_(req, true), x = req.casualty || {};
  var src = {};
  Object.keys(x).forEach(function (k) { src[k] = x[k]; });
  src.id = 'C' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
  src.parentId = ''; src.reporter = a.m.name + '（' + a.m.unit + '）'; src.status = '發現'; src.vehicle = ''; src.hospital = '';
  src.tFound = nowStr_(); src.time = nowStr_();
  var rec = pick_(CAS_FIELDS, normCasualty_(src));
  appendRows_(sheet_(a.ss, '傷患'), CAS_FIELDS, [rec]);
  logEvent_(a.ss, rec.reporter, '手機回報傷患', rec.id, casLabel_(rec));
  return { casualty: casOut_(rec), version: bump_(a.c) };
}


/* =====================================================================
 * 第 5 階段：山域模組（登山計畫／搜救計畫；內容以 JSON 存在「內容」欄）
 * ===================================================================== */
function savePlan_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '計畫'), x = req.plan || {};
  if (!x.id) throw new Error('計畫資料缺少 ID');
  if (x.type !== '登山計畫' && x.type !== '搜救計畫') throw new Error('計畫類型只能是「登山計畫」或「搜救計畫」');
  if (String(x.content || '').length > GEOJSON_CELL_MAX) throw new Error('計畫內容過大（超過 ' + GEOJSON_CELL_MAX + ' 字元）');
  var old = findById_(sh, PLAN_FIELDS, x.id);
  var merged = {};
  Object.keys(old || {}).forEach(function (k) { merged[k] = old[k]; });
  Object.keys(x).forEach(function (k) { merged[k] = x[k]; });
  var rec = pick_(PLAN_FIELDS, merged);
  rec.updatedBy = req.actor || ''; rec.updated = nowStr_();
  if (!old && !rec.version) {
    var n = 0;
    readAll_(sh, PLAN_FIELDS).forEach(function (r) { if (r.type === x.type) n++; });
    rec.version = String(n + 1);
  }
  upsertById_(sh, PLAN_FIELDS, rec);
  logEvent_(ss, req.actor, (old ? '修改' : '新增') + rec.type, rec.id, rec.type + ' v' + rec.version);
  return { plan: rec, version: bump_(c) };
}
function deletePlan_(req) {
  var c = openCaseForWrite_(req.caseId), ss = caseSs_(c), sh = sheet_(ss, '計畫');
  var x = findById_(sh, PLAN_FIELDS, req.planId);
  if (!x) throw new Error('找不到計畫');
  sh.deleteRow(x._row);
  logEvent_(ss, req.actor, '刪除' + x.type, x.id, x.type + ' v' + x.version);
  return { version: bump_(c) };
}
