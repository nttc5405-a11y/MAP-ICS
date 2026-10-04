/* 資料層：同一組 API 動作，兩種後端
   - 本機試用模式（沒填 GAS 網址）：資料存在這台電腦的瀏覽器 localStorage
   - GAS 模式：POST 到 Google Apps Script，資料存 Google 試算表與 Drive
   每個動作回傳 Promise，成功得到資料，失敗丟出 Error（message 是可直接顯示的中文） */
const Api = {
  KEY_URL: 'ccs_gas_url',
  KEY_TOKEN: 'ccs_token',
  KEY_ACTOR: 'ccs_actor',
  KEY_DB: 'ccs_local_db',

  gasUrl() { return (U.store.get(Api.KEY_URL, '') || '').trim(); },
  token() { return (U.store.get(Api.KEY_TOKEN, '') || '').trim(); },
  actor() { return (U.store.get(Api.KEY_ACTOR, '') || '').trim() || '指揮所'; },
  isLocal() { return !Api.gasUrl(); },
  modeName() { return Api.isLocal() ? '本機試用模式' : 'GAS 連線模式'; },

  call(action, params) {
    params = Object.assign({ actor: Api.actor() }, params || {});
    return Api.isLocal() ? Api.local(action, params) : Api.remote(action, params);
  },

  /* ---------- GAS ---------- */
  remote(action, params) {
    const body = JSON.stringify(Object.assign({ action: action, token: Api.token() }, params));
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
    ['units', 'members', 'tasks', 'reports'].forEach(k => { d[k] = d[k] || {}; });
    if (!d.roster) d.roster = Api.sampleRoster();
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
    return { units: units, people: people, sample: true };
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
          sheetId: 'local', folderId: 'local', joinCode: String(Math.floor(100000 + Math.random() * 900000)),
          version: 1, updated: U.now()
        };
        d.cases.push(c); d.zones[c.id] = []; log(c.id, p.actor, '建立案件', c.id, c.name);
        Api.saveDb(d); return c;
      }

      case 'updateCase': {
        const c = findCase(p.caseId); const f = p.fields || {};
        ['name', 'type', 'place', 'lat', 'lng', 'commander', 'note'].forEach(k => { if (k in f) c[k] = f[k]; });
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
          tasks: d.tasks[c.id] || [], reports: d.reports[c.id] || []
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
      case 'saveRoster':
        d.roster = { units: p.units || [], people: p.people || [] };
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
          group: m.group || m.unit || '', phone: m.phone || '', joined: U.now(), device: '指揮所代登', token: ''
        };
        lst('members', c.id).push(rec);
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
        return {
          caseId: c.id, name: c.name, type: c.type, units: d.roster.units,
          people: d.roster.people.filter(x => x.active !== '否')
        };
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
          m = { id: U.uid('M'), name: person.name, unit: person.unit, identity: '名冊', status: '有效', group: person.unit, phone: '', joined: U.now(), device: p.device || '', token: token };
          lst('members', c.id).push(m);
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
      case 'getPhoto': {
        findCase(p.caseId);
        try { const o = JSON.parse(U.store.get('ccs_photo_' + p.photoId, '')); if (o && o.case === p.caseId) return o; } catch (e) { /* 找不到 */ }
        throw new Error('找不到照片');
      }

      default:
        throw new Error('本機試用模式尚未支援動作：' + action);
    }
  },

  /* 清空本機試用資料（設定頁使用） */
  clearLocal() { U.store.del(Api.KEY_DB); }
};
