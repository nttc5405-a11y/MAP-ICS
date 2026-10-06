/* 資料層：同一組 API 動作，兩種後端
   - 本機試用模式（沒填 GAS 網址）：資料存在這台電腦的瀏覽器 localStorage
   - GAS 模式：POST 到 Google Apps Script，資料存 Google 試算表與 Drive
   每個動作回傳 Promise，成功得到資料，失敗丟出 Error（message 是可直接顯示的中文） */
const Api = {
  KEY_URL: 'ccs_gas_url',
  KEY_TOKEN: 'ccs_token',
  KEY_ACTOR: 'ccs_actor',
  KEY_DB: 'ccs_local_db',

  // 優先用「設定」裡自己填的網址，沒有就用 config.js 內建的 GAS_URL
  // 網址後面加 ?local=1 可強制進入本機試用模式（練習用，不會碰到真實資料）
  gasUrl() {
    if (/[?&]local=1/.test(location.search)) return '';
    return (U.store.get(Api.KEY_URL, '') || '').trim() || (CFG.GAS_URL || '').trim();
  },
  token() { return (U.store.get(Api.KEY_TOKEN, '') || '').trim(); },
  actor() { return (U.store.get(Api.KEY_ACTOR, '') || '').trim() || '指揮所'; },
  isLocal() { return !Api.gasUrl(); },
  modeName() { return Api.isLocal() ? '本機試用模式' : 'GAS 連線模式'; },

  call(action, params) {
    params = Object.assign({ actor: Api.actor() }, params || {});
    return Api.isLocal() ? Api.local(action, params) : Api.remote(action, params);
  },

  /* ---------- GAS ---------- */
  casePass() { try { const s = JSON.parse(U.store.get('ccs_session', '')); return (s && s.pass) || ''; } catch (e) { return ''; } },
  remote(action, params) {
    // 管理員密碼（權杖）與案件驗證碼各自帶上；伺服器任一個通過即可（建立案件／改名冊只認管理員密碼）
    const tk = params._token || Api.token();
    params = Object.assign({}, params); delete params._token;
    const body = JSON.stringify(Object.assign({ action: action, token: tk, casePass: Api.casePass() }, params));
    return fetch(Api.gasUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 避開 CORS preflight
      body: body
    }).then(r => {
      if (!r.ok) throw new Error('連線失敗（HTTP ' + r.status + '）');
      return r.text();
    }).then(t => {
      let j;
      try { j = JSON.parse(t); } catch (e) { throw new Error('後端回應格式不對，請確認 GAS 網址是「網頁應用程式」的 /exec 網址'); }
      if (!j.ok) throw new Error(j.error || '後端回報錯誤');
      return j.data;
    }, e => {
      if (e instanceof TypeError) throw new Error('連不上 GAS，請檢查網路或網址設定');
      throw e;
    });
  },

  /* ---------- 本機試用 ---------- */
  db() {
    let d = null;
    try { d = JSON.parse(U.store.get(Api.KEY_DB, '')); } catch (e) { /* 重建 */ }
    if (!d || !d.cases) d = { cases: [], zones: {}, logs: {} };
    ['units', 'members', 'tasks', 'reports', 'casualties', 'plans'].forEach(k => { d[k] = d[k] || {}; });
    if (!d.roster) d.roster = Api.sampleRoster();
    const R = d.roster;   // 舊資料補齊「編組方案」欄位
    R.baseName = R.baseName || '單位'; R.schemeNames = R.schemeNames || [R.baseName];
    R.people.forEach(p => { p.schemes = p.schemes || {}; if (!(R.baseName in p.schemes)) p.schemes[R.baseName] = p.unit; });
    R.units = Api.deriveUnits(R.people);
    return d;
  },
  /* 本機試用的範例名冊（人名為虛構，請到「名冊管理」改成實際資料） */
  sampleRoster() {
    const units = [['台東分隊', '分隊', '水箱車、雲梯車'], ['成功分隊', '分隊', '水箱車、救護車'], ['東河分隊', '分隊', '水箱車、救護車'],
      ['長濱分隊', '分隊', '水箱車、救護車'], ['義消成功分隊', '義消', '水箱車'], ['空勤總隊', '外部支援', '直升機']]
      .map((u, i) => ({ id: 'U' + (i + 1), name: u[0], category: u[1], vehicles: u[2], order: i + 1 }));
    const names = [['台東分隊', '範例甲', '分隊長'], ['台東分隊', '範例乙', '隊員'], ['成功分隊', '王小明', '分隊長'],
      ['成功分隊', '李大華', '隊員'], ['成功分隊', '陳志強', '隊員'], ['東河分隊', '林小美', '隊員'],
      ['東河分隊', '張大雄', '分隊長'], ['長濱分隊', '黃建國', '隊員'], ['義消成功分隊', '吳俊傑', '分隊長'],
      ['空勤總隊', '周機長', '機長']];
    const people = names.map((n, i) => ({ id: 'P' + (i + 1), unit: n[0], name: n[1], title: n[2], order: i + 1, active: '是' }));
    const grp = ['管理組', 'UCC', '搜救1組', '搜救2組', '醫療組', '場控組', '搜救1組', '搜救2組', '醫療組', '場控組'];
    people.forEach((p, i) => { p.schemes = { 單位: p.unit, 人道救援: grp[i] }; });
    return { units: units, people: people, sample: true, baseName: '單位', schemeNames: ['單位', '人道救援'] };
  },
  saveDb(d) {
    if (!U.store.set(Api.KEY_DB, JSON.stringify(d))) throw new Error('瀏覽器儲存空間已滿或被禁用，無法存檔');
  },

  local(action, p) {
    return new Promise((resolve, reject) => {
      try { resolve(Api.localSync(action, p)); } catch (e) { reject(e); }
    });
  },

  localSync(action, p) {
    const d = Api.db();
    const findCase = id => {
      const c = d.cases.find(x => x.id === id);
      if (!c) throw new Error('找不到案件 ' + id);
      return c;
    };
    const touch = c => { c.version = (Number(c.version) || 0) + 1; c.updated = U.now(); };
    const log = (cid, actor, act, target, content) => {
      (d.logs[cid] = d.logs[cid] || []).push({ time: U.now(), actor: actor, action: act, target: target || '', content: content || '' });
    };
    const needOpen = c => { if (c.status === CFG.STATUS_CLOSED) throw new Error('案件已結案，請先重新開啟再修改'); };
    const checkZone = z => {
      if (!z || !z.id) throw new Error('區域資料缺少 ID');
      if (String(z.geojson || '').length > CFG.CELL_MAX) throw new Error('區域「' + (z.name || z.id) + '」幾何資料過大（超過 ' + CFG.CELL_MAX + ' 字元）');
    };
    const lst = (key, cid) => (d[key][cid] = d[key][cid] || []);
    const ensureGroupUnit = (cid, scheme, g) => {   // 啟動編組後，新組別有人加入時自動建立成可派遣單位
      if (scheme && g && !lst('units', cid).some(u => u.name === g)) lst('units', cid).push({ id: 'G' + Api.hash(g), name: g, vehicles: '', leader: '', lat: '', lng: '', status: '待命', updated: U.now() });
    };
    const ids = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
    /* 手機權杖驗證：權杖對得上、未撤銷、加入未滿 24 小時。needActive=true 時還要求已確認（有效）且案件未結案 */
    const authMember = (q, needActive) => {
      const c = findCase(q.caseId);
      const m = lst('members', c.id).find(x => x.token && x.token === q.memberToken);
      if (!m) throw new Error('登入已失效，請重新掃描 QR Code 加入');
      if (m.status === '已撤銷') throw new Error('您已被指揮所撤銷，請洽指揮所');
      if (Date.now() - new Date(String(m.joined).replace(/-/g, '/')).getTime() > 24 * 3600 * 1000) throw new Error('登入已超過 24 小時，請重新掃描 QR Code');
      if (needActive) {
        if (m.status !== '有效') throw new Error('尚待指揮所確認，目前還不能回報');
        needOpen(c);
      }
      return { c: c, m: m };
    };
    /* 任務可見規則：指派給我所屬（編組）單位，或直接指派給我 */
    const visibleTasks = (tasks, m, myUnitIds) => tasks.filter(t =>
      ids(t.assignUnits).some(i => myUnitIds.indexOf(i) >= 0) || ids(t.assignPeople).indexOf(m.id) >= 0);
    const upsertList = (list, obj) => {   // 有就覆蓋、沒有就新增；回傳是否原本就存在
      const i = list.findIndex(x => x.id === obj.id);
      if (i >= 0) { list[i] = obj; return true; }
      list.push(obj); return false;
    };
    const upsert = (cid, z) => {
      const list = d.zones[cid] = d.zones[cid] || [];
      const i = list.findIndex(x => x.id === z.id);
      const rec = Object.assign({}, z, { updated: U.now() });
      if (i >= 0) { rec.created = list[i].created || rec.created || U.now(); list[i] = rec; return 'update'; }
      rec.created = rec.created || U.now(); list.push(rec); return 'add';
    };

    switch (action) {
      case 'ping':
        return { mode: 'local', version: CFG.VERSION, time: U.now() };

      case 'getSettings':   // 本機試用：固定顯示一段示範公告，讓你看到跑馬燈的效果
        return { marqueeText: '【示範公告】正式使用時，請在 Google 試算表「設定」分頁修改跑馬燈文字與速度。', marqueeSeconds: 18 };
      case 'enterCase': {   // 本機試用也模擬驗證碼檢查
        const c = findCase(p.caseId);
        if (c.passcode && String(p.passcode || '') !== c.passcode) throw new Error('案件驗證碼錯誤');
        return { case: c };
      }
      case 'listCases':
        return d.cases.slice().sort((a, b) => (a.id < b.id ? 1 : -1));

      case 'createCase': {
        const f = p.fields || {};
        if (!String(f.name || '').trim()) throw new Error('請填寫案件名稱');
        const ymd = new Date(); const day = ymd.getFullYear() + U.pad(ymd.getMonth() + 1) + U.pad(ymd.getDate());
        const n = d.cases.filter(c => c.id.indexOf(day) === 0).length + 1;
        const c = {
          id: day + '-' + ('00' + n).slice(-3), name: f.name.trim(), type: f.type || '其他', place: f.place || '',
          lat: f.lat == null ? '' : f.lat, lng: f.lng == null ? '' : f.lng, commander: f.commander || '',
          status: CFG.STATUS_OPEN, start: U.now(), end: '', note: f.note || '',
          sheetId: 'local', folderId: 'local', joinCode: String(Math.floor(100000 + Math.random() * 900000)), viewCode: '', passcode: String(f.passcode || ''),
          version: 1, updated: U.now()
        };
        d.cases.push(c); d.zones[c.id] = []; log(c.id, p.actor, '建立案件', c.id, c.name);
        Api.saveDb(d); return c;
      }

      case 'updateCase': {
        const c = findCase(p.caseId); const f = p.fields || {};
        ['name', 'type', 'place', 'lat', 'lng', 'commander', 'note', 'passcode'].forEach(k => { if (k in f) c[k] = f[k]; });
        if ('status' in f && f.status !== c.status) {
          c.status = f.status;
          if (f.status === CFG.STATUS_CLOSED) c.end = U.now();
          else { c.end = ''; }
          log(c.id, p.actor, f.status === CFG.STATUS_CLOSED ? '結案' : '重新開啟', c.id, '');
        } else log(c.id, p.actor, '修改案件資料', c.id, Object.keys(f).join('、'));
        touch(c); Api.saveDb(d); return c;
      }

      case 'getCase': {
        const c = findCase(p.caseId);
        return {
          case: c, zones: d.zones[c.id] || [], units: d.units[c.id] || [], members: d.members[c.id] || [],
          tasks: d.tasks[c.id] || [], reports: d.reports[c.id] || [], casualties: d.casualties[c.id] || [], plans: d.plans[c.id] || []
        };
      }
      case 'getVersion': {
        const c = findCase(p.caseId);
        return { version: c.version, updated: c.updated, status: c.status };
      }
      case 'getLog': {
        findCase(p.caseId);
        return d.logs[p.caseId] || [];
      }

      case 'saveZone': {
        const c = findCase(p.caseId); needOpen(c); checkZone(p.zone);
        const how = upsert(c.id, p.zone);
        log(c.id, p.actor, how === 'add' ? '新增區域' : '修改區域', p.zone.id, (p.zone.category || '') + '／' + (p.zone.name || ''));
        touch(c); Api.saveDb(d); return { zone: (d.zones[c.id].find(x => x.id === p.zone.id)), version: c.version };
      }
      case 'saveZones': {
        const c = findCase(p.caseId); needOpen(c);
        (p.zones || []).forEach(checkZone);
        (p.zones || []).forEach(z => upsert(c.id, z));
        log(c.id, p.actor, '批次新增區域', '', (p.zones || []).length + ' 筆' + (p.note ? '（' + p.note + '）' : ''));
        touch(c); Api.saveDb(d); return { count: (p.zones || []).length, version: c.version };
      }
      case 'deleteZone': {
        const c = findCase(p.caseId); needOpen(c);
        const list = d.zones[c.id] || [];
        const i = list.findIndex(x => x.id === p.zoneId);
        if (i < 0) throw new Error('找不到要刪除的區域');
        const z = list.splice(i, 1)[0];
        log(c.id, p.actor, '刪除區域', z.id, (z.category || '') + '／' + (z.name || ''));
        touch(c); Api.saveDb(d); return { version: c.version };
      }
      /* ---------- 第 2 階段：名冊、部署、人員、任務、回報 ---------- */
      case 'getRoster': return d.roster;
      case 'applyScheme': {   // 啟動編組（本機試用版）
        const c = findCase(p.caseId); needOpen(c);
        const scheme = String(p.scheme || '').trim(), R = d.roster;
        if (scheme && R.schemeNames.indexOf(scheme) < 0) throw new Error('名冊裡沒有「' + scheme + '」這個編組方案');
        const gmap = {}, groups = [];
        R.people.forEach(x => { const g = scheme && x.schemes[scheme]; if (g) { gmap[x.name + '|' + x.unit] = g; if (groups.indexOf(g) < 0) groups.push(g); } });
        const units = lst('units', c.id), have = {}; units.forEach(u => { have[u.name] = 1; });
        const added = groups.filter(g => !have[g]).map(g => ({ id: 'G' + Api.hash(g), name: g, vehicles: '', leader: '', lat: '', lng: '', status: '待命', updated: U.now() }));
        added.forEach(u => units.push(u));
        let changed = 0;
        lst('members', c.id).forEach(m => { if (m.status === '已撤銷') return; const g = gmap[m.name + '|' + m.unit]; if (g && m.group !== g) { m.group = g; changed++; } });
        c.scheme = scheme;
        log(c.id, p.actor, '啟動編組', c.id, (scheme || '依單位') + '：新增 ' + added.length + ' 個單位，調整 ' + changed + ' 人');
        touch(c); Api.saveDb(d); return { version: c.version, scheme: scheme, added: added.length, changed: changed };
      }
      case 'saveRoster':
        d.roster = { units: Api.deriveUnits(p.people || []), people: p.people || [], baseName: p.baseName || '單位', schemeNames: [p.baseName || '單位'].concat((p.schemeNames || []).filter(n => n !== (p.baseName || '單位'))) };
        Api.saveDb(d); return d.roster;

      case 'saveUnit': {
        const c = findCase(p.caseId); needOpen(c);
        if (!p.unit || !p.unit.id) throw new Error('單位資料缺少 ID');
        const ex = upsertList(lst('units', c.id), p.unit);
        log(c.id, p.actor, ex ? '修改單位部署' : '新增單位部署', p.unit.id, p.unit.name + '（' + (p.unit.status || '') + '）');
        touch(c); Api.saveDb(d); return { version: c.version };
      }
      case 'deleteUnit': {
        const c = findCase(p.caseId); needOpen(c);
        const list = lst('units', c.id), i = list.findIndex(x => x.id === p.unitId);
        if (i < 0) throw new Error('找不到單位');
        const u = list.splice(i, 1)[0];
        log(c.id, p.actor, '移除單位部署', u.id, u.name);
        touch(c); Api.saveDb(d); return { version: c.version };
      }

      case 'addMember': {   // 指揮所代為加入（名冊人員或臨時人員），直接生效
        const c = findCase(p.caseId); needOpen(c);
        const m = p.member || {};
        if (!String(m.name || '').trim()) throw new Error('請填寫姓名');
        const dup = lst('members', c.id).find(x => x.name === m.name && x.unit === m.unit && x.status !== '已撤銷');
        if (dup) throw new Error(m.name + '（' + m.unit + '）已經在人員名單中');
        const rec = {
          id: U.uid('M'), name: m.name.trim(), unit: m.unit || '', identity: m.identity || '名冊', status: '有效',
          group: m.group || Api.schemeGroup(d.roster.people.find(x => x.name === m.name.trim() && x.unit === (m.unit || '')), c.scheme) || m.unit || '', phone: m.phone || '', joined: U.now(), device: '指揮所代登', token: ''
        };
        lst('members', c.id).push(rec);
        ensureGroupUnit(c.id, c.scheme, rec.group);
        log(c.id, p.actor, '代為加入人員', rec.id, rec.name + '（' + rec.unit + '）');
        touch(c); Api.saveDb(d); return { member: rec, version: c.version };
      }
      case 'approveMember': {
        const c = findCase(p.caseId); needOpen(c);
        const m = lst('members', c.id).find(x => x.id === p.memberId);
        if (!m) throw new Error('找不到人員');
        m.status = p.approve === false ? '已撤銷' : '有效';
        if (p.approve !== false) m.group = p.group || m.group || m.unit;
        log(c.id, p.actor, p.approve === false ? '拒絕臨時人員' : '確認臨時人員', m.id, m.name + '（' + m.unit + '）');
        touch(c); Api.saveDb(d); return { version: c.version };
      }
      case 'setMemberGroup': {
        const c = findCase(p.caseId); needOpen(c);
        const m = lst('members', c.id).find(x => x.id === p.memberId);
        if (!m) throw new Error('找不到人員');
        m.group = p.group || '';
        log(c.id, p.actor, '調整編組', m.id, m.name + ' → ' + (m.group || '（無）'));
        touch(c); Api.saveDb(d); return { version: c.version };
      }
      case 'revokeMember': {
        const c = findCase(p.caseId); needOpen(c);
        const m = lst('members', c.id).find(x => x.id === p.memberId);
        if (!m) throw new Error('找不到人員');
        m.status = '已撤銷'; m.token = '';
        log(c.id, p.actor, '撤銷人員', m.id, m.name + '（' + m.unit + '）');
        touch(c); Api.saveDb(d); return { version: c.version };
      }
      case 'regenJoinCode': {
        const c = findCase(p.caseId); needOpen(c);
        c.joinCode = String(Math.floor(100000 + Math.random() * 900000));
        log(c.id, p.actor, '重新產生加入碼', c.id, '舊加入碼失效');
        touch(c); Api.saveDb(d); return { joinCode: c.joinCode, version: c.version };
      }
      /* 手機加入用（第 3 階段的手機頁會呼叫；先備好） */
      case 'getJoinInfo': {
        const c = findCase(p.caseId);
        if (String(p.code) !== String(c.joinCode)) throw new Error('加入碼錯誤或已失效');
        needOpen(c);
        const groups = [];
        const people = d.roster.people.filter(x => x.active !== '否').map(x => {
          const g = Api.schemeGroup(x, c.scheme);
          if (g && groups.indexOf(g) < 0) groups.push(g);
          return { id: x.id, name: x.name, unit: x.unit, title: x.title, group: g };
        });
        return { caseId: c.id, name: c.name, type: c.type, scheme: c.scheme || '', units: groups.map(g => ({ name: g })), people: people };
      }
      case 'joinCase': {
        const c = findCase(p.caseId);
        if (String(p.code) !== String(c.joinCode)) throw new Error('加入碼錯誤或已失效');
        needOpen(c);
        const person = d.roster.people.find(x => x.id === p.personId);
        if (!person) throw new Error('名冊中找不到這位人員');
        let m = lst('members', c.id).find(x => x.name === person.name && x.unit === person.unit);
        const token = U.uid('T') + U.uid('K');
        if (m) {
          if (m.status === '已撤銷') throw new Error('您已被指揮所撤銷，請洽指揮所');
          if (m.device && m.device !== (p.device || '') && m.status !== '已撤銷') log(c.id, p.actor, '重複加入（第二支裝置）', m.id, m.name + '（' + m.unit + '）');
          m.status = '有效'; m.token = token; m.device = p.device || ''; m.joined = U.now();
        } else {
          m = { id: U.uid('M'), name: person.name, unit: person.unit, identity: '名冊', status: '有效', group: Api.schemeGroup(person, c.scheme), phone: '', joined: U.now(), device: p.device || '', token: token };
          lst('members', c.id).push(m);
          ensureGroupUnit(c.id, c.scheme, m.group);
          log(c.id, person.name, '加入案件', m.id, person.name + '（' + person.unit + '）');
        }
        touch(c); Api.saveDb(d); return { member: m, token: token };
      }
      case 'joinAsTemp': {
        const c = findCase(p.caseId);
        if (String(p.code) !== String(c.joinCode)) throw new Error('加入碼錯誤或已失效');
        needOpen(c);
        if (!String(p.name || '').trim()) throw new Error('請填寫姓名');
        const m = { id: U.uid('M'), name: p.name.trim(), unit: p.unit || '', identity: '臨時', status: '待確認', group: '', phone: p.phone || '', joined: U.now(), device: p.device || '', token: U.uid('T') + U.uid('K') };
        lst('members', c.id).push(m);
        log(c.id, m.name, '臨時人員申請加入', m.id, m.name + '（' + m.unit + '）');
        touch(c); Api.saveDb(d); return { member: m, token: m.token };
      }

      case 'saveTask': {
        const c = findCase(p.caseId); needOpen(c);
        const t = p.task;
        if (!t || !t.id) throw new Error('任務資料缺少 ID');
        if (!String(t.title || '').trim()) throw new Error('請填寫任務標題');
        const list = lst('tasks', c.id), old = list.find(x => x.id === t.id);
        const rec = Object.assign({}, old || {}, t);
        if (!old) { rec.status = rec.status || '已派遣'; rec.tAssigned = rec.tAssigned || U.now(); }
        upsertList(list, rec);
        log(c.id, p.actor, old ? '修改任務' : '派遣任務', rec.id, rec.title);
        touch(c); Api.saveDb(d); return { task: rec, version: c.version };
      }
      case 'deleteTask': {
        const c = findCase(p.caseId); needOpen(c);
        const list = lst('tasks', c.id), i = list.findIndex(x => x.id === p.taskId);
        if (i < 0) throw new Error('找不到任務');
        const t = list.splice(i, 1)[0];
        log(c.id, p.actor, '刪除任務', t.id, t.title);
        touch(c); Api.saveDb(d); return { version: c.version };
      }
      case 'updateTaskStatus': {
        const c = findCase(p.caseId); needOpen(c);
        const t = lst('tasks', c.id).find(x => x.id === p.taskId);
        if (!t) throw new Error('找不到任務');
        const st = CFG.TASK_STATUS.find(x => x.id === p.status);
        if (!st) throw new Error('不認得的任務狀態：' + p.status);
        t.status = st.id; t[st.time] = U.now();
        log(c.id, p.actor, '任務狀態', t.id, t.title + ' → ' + st.id);
        touch(c); Api.saveDb(d); return { task: t, version: c.version };
      }
      case 'submitReport': {
        const c = findCase(p.caseId); needOpen(c);
        const r = Object.assign({ time: U.now(), source: '指揮所代登', type: '文字' }, p.report);
        if (!String(r.content || '').trim()) throw new Error('請填寫回報內容');
        r.id = r.id || U.uid('R');
        lst('reports', c.id).push(r);
        log(c.id, p.actor, '代登回報', r.id, (r.reporter ? r.reporter + '：' : '') + r.content.slice(0, 60));
        touch(c); Api.saveDb(d); return { report: r, version: c.version };
      }

      /* ---------- 第 3 階段：手機端（以個人權杖 memberToken 驗證） ---------- */
      case 'getMyStatus': {
        const a = authMember(p);
        return { memberStatus: a.m.status, caseStatus: a.c.status, version: a.c.version };
      }
      case 'getFieldData': {
        const a = authMember(p), c = a.c, m = a.m;
        const active = m.status === '有效';
        const units = lst('units', c.id), myName = m.group || m.unit;
        const myUnitIds = units.filter(u => u.name === myName).map(u => u.id);
        const tasks = active ? visibleTasks(lst('tasks', c.id), m, myUnitIds) : [];
        const tids = tasks.map(t => t.id);
        const uids = {}; myUnitIds.forEach(i => { uids[i] = 1; });
        tasks.forEach(t => ids(t.assignUnits).forEach(i => { uids[i] = 1; }));
        const unitsOut = units.filter(u => uids[u.id]).map(u => ({ id: u.id, name: u.name, leader: u.leader, status: u.status }));
        const names = unitsOut.map(u => u.name);
        return {
          case: { id: c.id, name: c.name, type: c.type, place: c.place, lat: c.lat, lng: c.lng, status: c.status, version: c.version },
          member: { id: m.id, name: m.name, unit: m.unit, group: m.group, status: m.status },
          zones: d.zones[c.id] || [], units: unitsOut, tasks: tasks,
          reports: active ? lst('reports', c.id).filter(r => tids.indexOf(r.taskId) >= 0) : [],
          people: active ? lst('members', c.id).filter(x => x.status === '有效' && names.indexOf(x.group || x.unit) >= 0).map(x => ({ name: x.name, group: x.group || x.unit })) : [],
          casualties: active ? lst('casualties', c.id).filter(x => x.reporter === m.name + '（' + m.unit + '）') : [],   // 手機只看得到自己回報的傷患
          version: c.version
        };
      }
      case 'fieldTaskStatus': {
        const a = authMember(p, true);
        const units = lst('units', a.c.id), myName = a.m.group || a.m.unit;
        const myUnitIds = units.filter(u => u.name === myName).map(u => u.id);
        const t = visibleTasks(lst('tasks', a.c.id), a.m, myUnitIds).find(x => x.id === p.taskId);
        if (!t) throw new Error('找不到這個任務，或不是指派給您的');
        const st = CFG.TASK_STATUS.find(x => x.id === p.status && x.id !== '已派遣');
        if (!st) throw new Error('不能設定成這個狀態：' + p.status);
        t.status = st.id; t[st.time] = U.now();
        log(a.c.id, a.m.name + '（' + a.m.unit + '）', '任務狀態（手機）', t.id, t.title + ' → ' + st.id);
        touch(a.c); Api.saveDb(d); return { task: t, version: a.c.version };
      }
      case 'fieldReport': {
        const a = authMember(p, true), r = p.report || {};
        const photos = Array.isArray(r.photos) ? r.photos : ids(r.photos);
        if (!String(r.content || '').trim() && !photos.length) throw new Error('請填寫回報內容或附上照片');
        const rec = {
          id: U.uid('R'), taskId: r.taskId || '', zoneId: r.zoneId || '', reporter: a.m.name + '（' + a.m.unit + '）',
          source: '手機', type: r.type || '文字', content: String(r.content || '').trim() || '（僅照片）',
          photos: photos.slice(0, 3).join(','), coord: r.coord || '', time: U.now()
        };
        lst('reports', a.c.id).push(rec);
        log(a.c.id, rec.reporter, '手機回報', rec.id, rec.content.slice(0, 60));
        touch(a.c); Api.saveDb(d); return { report: rec, version: a.c.version };
      }
      case 'fieldPhoto': {
        const a = authMember(p, true);
        if (String(p.data || '').length > 3000000) throw new Error('照片太大，請重拍');
        const pid = U.uid('P');
        if (!U.store.set('ccs_photo_' + pid, JSON.stringify({ mime: p.mime || 'image/jpeg', data: p.data, case: a.c.id }))) throw new Error('本機試用的儲存空間不足，無法存照片');
        return { photoId: pid };
      }
      case 'uploadPhoto': {   // 指揮所（網頁版）上傳照片
        const c = findCase(p.caseId); needOpen(c);
        if (String(p.data || '').length > 3000000) throw new Error('照片太大，請換較小的檔案');
        const pid = U.uid('P');
        if (!U.store.set('ccs_photo_' + pid, JSON.stringify({ mime: p.mime || 'image/jpeg', data: p.data, case: c.id }))) throw new Error('本機試用的儲存空間不足，無法存照片');
        return { photoId: pid };
      }
      case 'getPhoto': {
        findCase(p.caseId);
        try { const o = JSON.parse(U.store.get('ccs_photo_' + p.photoId, '')); if (o && o.case === p.caseId) return o; } catch (e) { /* 找不到 */ }
        throw new Error('找不到照片');
      }

      /* ---------- 第 4 階段：傷患 ---------- */
      case 'saveCasualty': {
        const c = findCase(p.caseId); needOpen(c);
        const x = p.casualty;
        if (!x || !x.id) throw new Error('傷患資料缺少 ID');
        const list = lst('casualties', c.id), old = list.find(y => y.id === x.id);
        const rec = Api.normCasualty(Object.assign({}, old || {}, x));
        if (!old) { rec.status = rec.status || '發現'; rec.tFound = rec.tFound || U.now(); rec.time = rec.time || U.now(); }
        upsertList(list, rec);
        log(c.id, p.actor, old ? '修改傷患' : '新增傷患', rec.id, Api.casLabel(rec));
        touch(c); Api.saveDb(d); return { casualty: rec, version: c.version };
      }
      case 'deleteCasualty': {
        const c = findCase(p.caseId); needOpen(c);
        const list = lst('casualties', c.id), i = list.findIndex(y => y.id === p.casualtyId);
        if (i < 0) throw new Error('找不到傷患');
        const x = list.splice(i, 1)[0];
        // 刪群體時，拆出來的個別傷患保留，但解除與群體的關聯
        list.forEach(y => { if (y.parentId === x.id) y.parentId = ''; });
        log(c.id, p.actor, '刪除傷患', x.id, Api.casLabel(x));
        touch(c); Api.saveDb(d); return { version: c.version };
      }
      case 'splitCasualty': {
        const c = findCase(p.caseId); needOpen(c);
        const list = lst('casualties', c.id), g = list.find(y => y.id === p.groupId);
        if (!g || g.mode !== '群體') throw new Error('找不到要拆分的群體');
        const made = [];
        CFG.TRIAGE.forEach(t => {
          const want = parseInt((p.counts || {})[t.id], 10) || 0;
          if (want <= 0) return;
          const rem = g[t.field] - list.filter(y => y.parentId === g.id && y.triage === t.id).length - made.filter(y => y.triage === t.id).length;
          if (want > rem) throw new Error(t.id + '色只剩 ' + Math.max(0, rem) + ' 人可拆分');
          for (let i = 0; i < want; i++) {
            made.push({
              id: U.uid('C'), mode: '單人', triage: t.id, red: 0, yellow: 0, green: 0, black: 0, parentId: g.id, quick: '', desc: '',
              photos: '', coord: g.coord, reporter: g.reporter, taskId: g.taskId, status: g.status, vehicle: g.vehicle, hospital: g.hospital,
              tFound: g.tFound, tTreated: g.tTreated, tTransporting: g.tTransporting, tArrived: g.tArrived, time: U.now()
            });
          }
        });
        if (!made.length) throw new Error('請輸入要拆分的人數');
        made.forEach(y => list.push(y));
        log(c.id, p.actor, '拆分傷患群體', g.id, '拆出 ' + made.length + ' 人');
        touch(c); Api.saveDb(d); return { casualties: made, version: c.version };
      }
      case 'updateTransport': {
        const c = findCase(p.caseId); needOpen(c);
        const x = lst('casualties', c.id).find(y => y.id === p.casualtyId);
        if (!x) throw new Error('找不到傷患');
        const st = CFG.TRANSPORT.find(s => s.id === p.status);
        if (!st) throw new Error('不認得的後送狀態：' + p.status);
        x.status = st.id; x[st.time] = U.now();
        if (p.vehicle !== undefined) x.vehicle = p.vehicle;
        if (p.hospital !== undefined) x.hospital = p.hospital;
        log(c.id, p.actor, '後送狀態', x.id, Api.casLabel(x) + ' → ' + st.id + (x.vehicle ? '，車輛 ' + x.vehicle : '') + (x.hospital ? '，送往 ' + x.hospital : ''));
        touch(c); Api.saveDb(d); return { casualty: x, version: c.version };
      }
      case 'fieldCasualty': {
        const a = authMember(p, true);
        const rec = Api.normCasualty(Object.assign({}, p.casualty, {
          id: U.uid('C'), parentId: '', reporter: a.m.name + '（' + a.m.unit + '）', status: '發現', vehicle: '', hospital: '',
          tFound: U.now(), time: U.now()
        }));
        lst('casualties', a.c.id).push(rec);
        log(a.c.id, rec.reporter, '手機回報傷患', rec.id, Api.casLabel(rec));
        touch(a.c); Api.saveDb(d); return { casualty: rec, version: a.c.version };
      }

      /* ---------- 第 5 階段：登山計畫／搜救計畫 ---------- */
      case 'savePlan': {
        const c = findCase(p.caseId); needOpen(c);
        const x = p.plan;
        if (!x || !x.id) throw new Error('計畫資料缺少 ID');
        if (x.type !== '登山計畫' && x.type !== '搜救計畫') throw new Error('計畫類型只能是「登山計畫」或「搜救計畫」');
        if (String(x.content || '').length > CFG.CELL_MAX) throw new Error('計畫內容過大（超過 ' + CFG.CELL_MAX + ' 字元）');
        const list = lst('plans', c.id), old = list.find(y => y.id === x.id);
        const rec = Object.assign({}, old || {}, x, { updatedBy: p.actor, updated: U.now() });
        if (!old && !rec.version) rec.version = String(list.filter(y => y.type === x.type).length + 1);
        upsertList(list, rec);
        log(c.id, p.actor, old ? '修改' + rec.type : '新增' + rec.type, rec.id, rec.type + ' v' + rec.version);
        touch(c); Api.saveDb(d); return { plan: rec, version: c.version };
      }
      case 'deletePlan': {
        const c = findCase(p.caseId); needOpen(c);
        const list = lst('plans', c.id), i = list.findIndex(y => y.id === p.planId);
        if (i < 0) throw new Error('找不到計畫');
        const x = list.splice(i, 1)[0];
        log(c.id, p.actor, '刪除' + x.type, x.id, x.type + ' v' + x.version);
        touch(c); Api.saveDb(d); return { version: c.version };
      }

      /* ---------- 第 6 階段：唯讀看板（以檢視碼 viewCode 驗證，只回傳不含個資的資料） ---------- */
      case 'regenViewCode': {
        const c = findCase(p.caseId);
        c.viewCode = p.disable ? '' : Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, 'X');   // 8 碼短碼，方便在登入頁輸入
        log(c.id, p.actor, p.disable ? '關閉唯讀看板連結' : '產生唯讀看板連結', c.id, '');
        touch(c); Api.saveDb(d); return { viewCode: c.viewCode, version: c.version };
      }
      case 'getBoardVersion': {
        const c = findCase(p.caseId);
        if (!c.viewCode || String(p.viewCode) !== c.viewCode) throw new Error('看板連結無效或已關閉');
        return { version: c.version, status: c.status };
      }
      case 'getBoardPhoto': {
        const c = findCase(p.caseId);
        if (!c.viewCode || String(p.viewCode) !== c.viewCode) throw new Error('看板連結無效或已關閉');
        try { const o = JSON.parse(U.store.get('ccs_photo_' + p.photoId, '')); if (o && o.case === c.id) return o; } catch (e) { /* 找不到 */ }
        throw new Error('找不到照片');
      }
      case 'getBoardData': {
        const c = findCase(p.caseId);
        if (!c.viewCode || String(p.viewCode) !== c.viewCode) throw new Error('看板連結無效或已關閉');
        const units = lst('units', c.id), members = lst('members', c.id);
        const uname = id => { const u = units.find(x => x.id === id); return u ? u.name : ''; };
        return {
          case: { id: c.id, name: c.name, type: c.type, place: c.place, status: c.status, lat: c.lat, lng: c.lng, start: c.start, end: c.end, version: c.version },
          zones: d.zones[c.id] || [],
          units: units.map(u => ({ id: u.id, name: u.name, status: u.status, lat: u.lat, lng: u.lng, leader: u.leader, vehicles: u.vehicles })),
          memberStats: { active: members.filter(m => m.status === '有效').length, pending: members.filter(m => m.status === '待確認').length },
          tasks: lst('tasks', c.id).map(t => ({
            id: t.id, title: t.title, status: t.status, zoneId: t.zoneId, hazard: t.hazard, tAssigned: t.tAssigned,
            units: ids(t.assignUnits).map(uname).filter(Boolean),
            crew: members.filter(m => m.status === '有效' && (ids(t.assignUnits).map(uname).indexOf(m.group || m.unit) >= 0 || ids(t.assignPeople).indexOf(m.id) >= 0)).map(m => m.name)   // 只給姓名，不含電話
          })),
          casualties: lst('casualties', c.id).map(x => ({   // 傷患不含描述、回報者、照片
            id: x.id, mode: x.mode, triage: x.triage, red: x.red, yellow: x.yellow, green: x.green, black: x.black,
            parentId: x.parentId, status: x.status, coord: x.coord, photos: x.photos
          })),
          reports: lst('reports', c.id).slice(-30).map(r => ({
            id: r.id, time: r.time, unit: String(r.reporter || '').replace(/^.*（(.*)）$/, '$1'), content: r.content, coord: r.coord, taskId: r.taskId, photos: r.photos
          })),
          version: c.version
        };
      }

      default:
        throw new Error('本機試用模式尚未支援動作：' + action);
    }
  },

  /* 傷患資料整理與檢查（本機模式用；GAS 端有同樣規則） */
  normCasualty(x) {
    const r = Object.assign({}, x);
    const n = v => Math.max(0, Math.min(999, parseInt(v, 10) || 0));
    if (r.mode === '群體') {
      r.triage = '';
      CFG.TRIAGE.forEach(t => { r[t.field] = n(r[t.field]); });
      if (CFG.TRIAGE.reduce((s, t) => s + r[t.field], 0) < 1) throw new Error('多人回報至少要有 1 人');
    } else {
      r.mode = '單人';
      if (!CFG.TRIAGE.some(t => t.id === r.triage)) throw new Error('請選擇檢傷等級（紅／黃／綠／黑）');
      CFG.TRIAGE.forEach(t => { r[t.field] = 0; });
    }
    r.photos = Array.isArray(r.photos) ? r.photos.slice(0, 3).join(',') : String(r.photos || '');
    return r;
  },

  /* 單位清單由名冊人員的「基本單位」推導（不再有單位名冊） */
  deriveUnits(people) {
    const seen = {}, out = [];
    people.forEach(p => {
      if (p.unit && !seen[p.unit]) {
        seen[p.unit] = 1;
        const n = p.unit;
        out.push({ id: 'U' + Api.hash(n), name: n, category: /義消|義勇/.test(n) ? '義消' : /空勤|民間|支援|搜救隊|協會|山協/.test(n) ? '外部支援' : '分隊', vehicles: '', order: out.length + 1 });
      }
    });
    return out;
  },
  schemeGroup(person, scheme) { return !person ? '' : (scheme && person.schemes && person.schemes[scheme]) || person.unit; },
  hash(s) { let h = 5381; for (const ch of String(s)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return h.toString(16).toUpperCase(); },
  casLabel(x) {
    if (x.mode === '群體') return '多人 ' + CFG.TRIAGE.filter(t => x[t.field] > 0).map(t => t.id + x[t.field]).join(' ');
    return '單人 檢傷' + x.triage + (x.quick ? '（' + x.quick + '）' : '');
  },

  /* 清空本機試用資料（設定頁使用） */
  clearLocal() { U.store.del(Api.KEY_DB); }
};
