/* 手機現場版：QR 加入、地圖／清單兩種檢視、一鍵狀態、文字＋照片＋位置回報 */
const F = {
  s: { caseId: '', code: '', token: '', member: null, data: null, mode: 'list', detail: null, ftab: 'tasks', gps: null, seen: null, unread: false, busy: false, version: -1, fitted: false, info: null },
  r: null,           // 回報表單狀態（開著時不為 null）
  map: null,
  j: { q: '', unit: '' },

  hm(s) { return s ? String(s).slice(5, 16) : ''; },
  sessionKey() { return 'ccs_f_' + F.s.caseId; },
  ids(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); },
  device() {
    const ua = navigator.userAgent, m = /Android|iPhone|iPad/.exec(ua);
    return (m ? m[0] : '手機') + ' ' + screen.width + 'x' + screen.height;
  },
  vib(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* iOS 不支援 */ } },

  /* ---------- 啟動 ---------- */
  async init() {
    const p = new URLSearchParams(location.search);
    F.s.caseId = p.get('case') || ''; F.s.code = p.get('code') || '';
    F.s.mode = U.store.get('ccs_f_mode', 'list') === 'map' ? 'map' : 'list';
    F.bind();
    if (!F.s.caseId) { F.showJoinMsg('請用指揮所提供的案件 QR Code 開啟本頁'); return; }
    try {
      const ses = JSON.parse(U.store.get(F.sessionKey(), ''));
      if (ses && ses.token) { F.s.token = ses.token; F.s.member = ses.member; }
    } catch (e) { /* 沒有登入紀錄 */ }
    if (F.s.token) {
      try { await F.refresh(true); }
      catch (e) { if (F.s.token) { F.showJoinMsg('讀取失敗：' + e.message, true); } }
    } else await F.showJoin();
    const loop = () => setTimeout(async () => { await F.poll(); loop(); },
      F.s.data && F.s.data.member && F.s.data.member.status !== '有效' ? 6000 : 17000);   // 等待確認時每 6 秒檢查
    loop();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) F.poll(); });
    F.startGps();
  },

  bind() {
    U.$('#m-list').addEventListener('click', () => F.setMode('list'));
    U.$('#m-map').addEventListener('click', () => F.setMode('map'));
    U.$('#btn-report').addEventListener('click', () => F.openReport({ taskId: F.s.detail || '' }));
    U.$('#btn-cas').addEventListener('click', () => F.openReport({ kind: 'casualty', taskId: F.s.detail || '' }));
    U.$$('#ftabs button').forEach(b => b.addEventListener('click', () => { F.s.ftab = b.dataset.ft; F.s.detail = null; F.render(); }));
    U.$('#gps-btn').addEventListener('click', () => {
      if (F.s.gps && F.map) F.map.setView([F.s.gps.lat, F.s.gps.lng], Math.max(F.map.getZoom(), 16));
      else U.toast('還沒有取得定位，請確認已允許瀏覽器使用位置', 'err');
    });
    U.$('#base-btn').addEventListener('click', F.toggleBase);
    U.$('#zl-btn').addEventListener('click', F.openDrawer);
  },

  async call(action, params) {
    try { return await Api.call(action, Object.assign({ caseId: F.s.caseId, memberToken: F.s.token }, params)); }
    catch (e) {
      if (/重新掃描|撤銷/.test(e.message) && F.s.token) F.logout(e.message);
      throw e;
    }
  },
  logout(msg) {
    U.store.del(F.sessionKey());
    F.s.token = ''; F.s.member = null; F.s.data = null; F.r = null;
    F.showJoin(msg);
  },

  /* ---------- 資料更新 ---------- */
  async refresh(first) {
    const d = await F.call('getFieldData');
    F.s.data = d; F.s.version = d.version; F.s.member = d.member;
    const ids = d.tasks.map(t => t.id);
    if (!F.s.seen) F.s.seen = {};
    const fresh = d.tasks.filter(t => !F.s.seen[t.id]);
    fresh.forEach(t => { F.s.seen[t.id] = 1; });
    if (!first && fresh.length) {
      F.vib([250, 120, 250]);
      U.toast('新任務：' + fresh[0].title + (fresh.length > 1 ? ' 等 ' + fresh.length + ' 項' : ''), 'ok');
      if (F.s.mode !== 'list' || F.s.detail) F.s.unread = true;
    }
    if (F.s.detail && ids.indexOf(F.s.detail) < 0) F.s.detail = null;
    F.render();
  },
  async poll() {
    if (!F.s.token || document.hidden || F.s.busy || F.r || !F.s.data) return;
    try {
      const st = await F.call('getMyStatus');
      if (Number(st.version) !== Number(F.s.version) || st.memberStatus !== F.s.data.member.status) await F.refresh(false);
    } catch (e) { /* 網路不穩時靜默，下次再試 */ }
  },

  /* ---------- 版面 ---------- */
  setMode(m) {
    F.s.mode = m; U.store.set('ccs_f_mode', m);
    if (m === 'list') F.s.unread = false;
    if (m === 'map') F.s.detail = F.s.detail;   // 保留詳情，回清單時還在
    F.render();
  },
  render() {
    const d = F.s.data; if (!d) return;
    U.$('#v-join').hidden = true;
    U.$('#fhead').hidden = false; U.$('#ffoot').hidden = false;
    U.$('#fh-case').textContent = d.case.name;
    const tg = U.$('#fh-type'); tg.textContent = d.case.type; tg.style.background = CFG.typeColor(d.case.type);
    U.$('#fh-me').textContent = d.member.name + '・' + (d.member.group || d.member.unit || '');
    const active = d.member.status === '有效', closed = d.case.status === '已結案';
    const bn = U.$('#banner');
    if (!active) { bn.hidden = false; bn.className = 'banner'; bn.innerHTML = '⏳ 等待指揮所確認您的身分。目前可看地圖與區域，確認後才能收任務與回報。<button id="b-recheck" class="link-btn" style="padding:4px 8px">重新檢查</button>';
      U.$('#b-recheck').onclick = async () => { try { await F.refresh(false); U.toast(F.s.data.member.status === '有效' ? '已確認！' : '還在等待指揮所確認'); } catch (e) { U.toast('檢查失敗：' + e.message, 'err'); } }; }
    else if (closed) { bn.hidden = false; bn.className = 'banner info'; bn.textContent = '此案件已結案，僅供查看。'; }
    else bn.hidden = true;
    U.$('#btn-report').disabled = !active || closed;
    U.$('#btn-cas').disabled = !active || closed;
    U.$('#ftabs').hidden = F.s.mode !== 'list';
    U.$$('#ftabs button').forEach(b => b.classList.toggle('on', b.dataset.ft === F.s.ftab));
    const cn = U.$('#cas-n'); cn.textContent = (d.casualties || []).length; cn.hidden = !(d.casualties || []).length;
    U.$('#m-list').classList.toggle('on', F.s.mode === 'list');
    U.$('#m-map').classList.toggle('on', F.s.mode === 'map');
    U.$('#dot').hidden = !F.s.unread;
    U.$('#v-list').hidden = F.s.mode !== 'list';
    U.$('#v-map').hidden = F.s.mode !== 'map';
    if (F.s.mode === 'list') { if (F.s.ftab === 'cas') F.renderCas(); else F.s.detail ? F.renderDetail() : F.renderTasks(); }
    else F.renderMap();
  },
  stColor(s) { return CFG.taskColor(s); },
  zChain(z) { const a = []; let p = z, n = 0; while (p && n++ < 10) { a.push(p); p = p.parentId ? F.s.data.zones.find(x => x.id === p.parentId) : null; } return a; },
  zPath(z) { return F.zChain(z).reverse().map(x => x.name || x.category).join(' › '); },
  zHaz(z) { const o = []; F.zChain(z).forEach(x => String(x.hazard || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean).forEach(h => { if (o.indexOf(h) < 0) o.push(h); })); return o.join('、'); },
  zoneName(id) { const z = F.s.data.zones.find(x => x.id === id); return z ? F.zPath(z) : ''; },

  /* ---------- 清單：任務 ---------- */
  renderTasks() {
    U.$('#tasks').hidden = false; U.$('#detail').hidden = true; U.$('#cas-view').hidden = true;
    const d = F.s.data, box = U.$('#tasks');
    if (d.member.status !== '有效') { box.innerHTML = '<div class="empty">尚未確認身分，看不到任務。<br>請等指揮所確認。</div>'; return; }
    const rows = d.tasks.slice().sort((a, b) => ((a.status === '完成') - (b.status === '完成')) || (a.tAssigned < b.tAssigned ? 1 : -1));
    if (!rows.length) { box.innerHTML = '<div class="empty">目前沒有指派給您的任務。<br>有新任務會震動並提醒（Android）。</div>'; return; }
    box.innerHTML = rows.map(t => {
      const col = F.stColor(t.status);
      return '<div class="task-card" data-id="' + U.esc(t.id) + '" style="border-left-color:' + col + '">' +
        '<div class="tt" style="color:' + col + '">' + U.esc(t.title) + '<span class="pill" style="background:' + col + '">' + U.esc(t.status) + '</span></div>' +
        '<div class="tm">' + F.hm(t.tAssigned) + (t.zoneId ? '　📍 ' + U.esc(F.zoneName(t.zoneId)) : '') + '</div></div>';
    }).join('');
    U.$$('.task-card', box).forEach(el => el.addEventListener('click', () => { F.s.detail = el.dataset.id; F.render(); }));
  },

  renderDetail() {
    U.$('#tasks').hidden = true; U.$('#detail').hidden = false; U.$('#cas-view').hidden = true;
    const d = F.s.data, t = d.tasks.find(x => x.id === F.s.detail), box = U.$('#detail');
    if (!t) { F.s.detail = null; F.renderTasks(); return; }
    const col = F.stColor(t.status), closed = d.case.status === '已結案';
    const unitNames = F.ids(t.assignUnits).map(id => { const u = d.units.find(x => x.id === id); return u ? u.name : ''; }).filter(Boolean);
    const leaders = d.units.filter(u => F.ids(t.assignUnits).indexOf(u.id) >= 0 && u.leader).map(u => u.name + ' ' + u.leader);
    const people = d.people.filter(p => unitNames.indexOf(p.group) >= 0).map(p => p.name);
    const dis = closed || F.s.busy ? ' disabled' : '';
    const stBtn = (s, wide) => {
      const c = F.stColor(s);
      return '<button class="st-btn' + (wide ? ' wide' : '') + (t.status === s ? ' on' : '') + '" style="--c:' + c + '" data-s="' + s + '"' + dis + '>' + s + '</button>';
    };
    // 時間軸：各狀態時間 + 回報，依時間排序
    const ev = [];
    CFG.TASK_STATUS.forEach(s => { if (t[s.time]) ev.push({ time: t[s.time], text: '狀態：' + s.id, who: '' }); });
    d.reports.filter(r => r.taskId === t.id).forEach(r => ev.push({ time: r.time, text: r.content + (r.photos ? '　📷×' + F.ids(r.photos).length : ''), who: r.reporter }));
    ev.sort((a, b) => (a.time < b.time ? -1 : 1));
    box.innerHTML =
      '<button class="back" id="d-back">← 回任務清單</button>' +
      '<h1 class="d-title" style="color:' + col + '">' + U.esc(t.title) + '<span class="pill" style="background:' + col + '">' + U.esc(t.status) + '</span></h1>' +
      '<div class="d-row"><div class="k">區域</div>' + (t.zoneId ? U.esc(F.zoneName(t.zoneId)) + '<button class="loc-btn" id="d-loc">📍 看地圖</button>' : '（未指定）') + '</div>' +
      (t.content ? '<div class="d-row"><div class="k">任務內容</div>' + U.esc(t.content).replace(/\n/g, '<br>') + '</div>' : '') +
      (t.hazard ? '<div class="d-haz">⚠ 危險因子：' + U.esc(t.hazard) + '</div>' : '') +
      '<div class="d-row"><div class="k">帶隊官</div>' + (leaders.length ? U.esc(leaders.join('、')) : '（未指定）') + '</div>' +
      '<div class="d-row"><div class="k">成員</div>' + (people.length ? U.esc(people.join('、')) : '（無資料）') + '</div>' +
      '<div class="st-grid">' + ['已接收', '已抵達', '執行中', '完成'].map(s => stBtn(s)).join('') + stBtn('需支援', true) + '</div>' +
      '<details class="tl"><summary>時間軸（' + ev.length + '）</summary>' + ev.map(e =>
        '<div class="tl-item"><div class="t">' + F.hm(e.time) + (e.who ? '・' + U.esc(e.who) : '') + '</div>' + U.esc(e.text) + '</div>').join('') + '</details>';
    U.$('#d-back').onclick = () => { F.s.detail = null; F.render(); };
    const loc = U.$('#d-loc'); if (loc) loc.onclick = () => { F.s.mode = 'map'; F.s.focusZone = t.zoneId; U.store.set('ccs_f_mode', 'map'); F.render(); };
    U.$$('.st-btn', box).forEach(b => b.addEventListener('click', () => F.setStatus(t.id, b.dataset.s)));
  },

  /* 一鍵狀態：先改畫面，再送出；失敗就還原 */
  async setStatus(id, st) {
    const t = F.s.data.tasks.find(x => x.id === id); if (!t || F.s.busy || t.status === st) return;
    const tf = CFG.TASK_STATUS.find(s => s.id === st).time;
    const old = { status: t.status, time: t[tf] };
    t.status = st; t[tf] = U.now(); F.s.busy = true; F.renderDetail();
    try {
      await F.call('fieldTaskStatus', { taskId: id, status: st });
      F.vib(40); U.toast('已回報：' + st, 'ok');
    } catch (e) {
      t.status = old.status; t[tf] = old.time;
      U.toast('送出失敗：' + e.message + '（請再按一次）', 'err');
    } finally { F.s.busy = false; if (F.s.data) F.render(); }
  },

  /* ---------- 地圖模式 ---------- */
  initMap() {
    if (F.map) return;
    const mk = d => L.tileLayer(d.url, { attribution: d.attr, maxZoom: d.maxZoom, maxNativeZoom: d.maxNativeZoom });
    F.bases = [mk(CFG.BASEMAPS[0]), mk(CFG.BASEMAPS[1])];
    F.baseIdx = 0;
    F.map = L.map('fmap', { zoomControl: false, attributionControl: true, tap: true }).setView(CFG.DEFAULT_CENTER, 12);
    F.bases[0].addTo(F.map);
    F.zoneGroup = L.featureGroup().addTo(F.map);
    F.map.on('click', () => F.closeSheets());
  },
  toggleBase() {
    if (!F.map) return;
    F.map.removeLayer(F.bases[F.baseIdx]);
    F.baseIdx = 1 - F.baseIdx;
    F.bases[F.baseIdx].addTo(F.map);
    U.toast(F.baseIdx ? '衛星影像' : '電子地圖');
  },
  zoneLayer(z, bold) {
    let g; try { g = JSON.parse(z.geojson); } catch (e) { return null; }
    const col = z.color || CFG.catColor(z.category);
    const st = { color: col, weight: bold ? 8 : 3, opacity: 1, fillColor: col, fillOpacity: bold ? 0.35 : 0.2 };
    if (z.geomType === 'Point') return L.marker([g.coordinates[1], g.coordinates[0]], {
      icon: L.divIcon({ className: '', html: '<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:' + col + ';border:3px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.5)"></div>', iconSize: [30, 30], iconAnchor: [15, 30] })
    });
    if (z.geomType === 'Circle') return L.circle([g.coordinates[1], g.coordinates[0]], Object.assign({ radius: Number(z.radius) || 1 }, st));
    if (z.geomType === 'LineString') return L.polyline(g.coordinates.map(c => [c[1], c[0]]), Object.assign({}, st, { fill: false }));
    if (z.geomType === 'Polygon') return L.polygon(g.coordinates.map(r => r.map(c => [c[1], c[0]])), st);
    return null;
  },
  renderMap() {
    F.initMap();
    const d = F.s.data;
    setTimeout(() => F.map.invalidateSize(), 50);
    F.zoneGroup.clearLayers();
    const myZones = {};
    d.tasks.forEach(t => { if (t.zoneId && t.status !== '完成') myZones[t.zoneId] = 1; });
    d.zones.forEach(z => {
      const l = F.zoneLayer(z, !!myZones[z.id]); if (!l) return;
      l.on('click', e => { L.DomEvent.stopPropagation(e); F.openZone(z.id, e.latlng); });
      F.zoneGroup.addLayer(l);
    });
    if (F.s.focusZone) { F.focusZone(F.s.focusZone); F.s.focusZone = null; F.s.fitted = true; }
    else if (!F.s.fitted) {
      F.s.fitted = true;
      const b = F.zoneGroup.getBounds();
      if (b.isValid()) F.map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
      else if (parseFloat(d.case.lat)) F.map.setView([parseFloat(d.case.lat), parseFloat(d.case.lng)], 14);
    }
    F.drawMe();
  },
  focusZone(id) {
    const z = F.s.data.zones.find(x => x.id === id); if (!z) return;
    let g; try { g = JSON.parse(z.geojson); } catch (e) { return; }
    const l = F.zoneLayer(z, true);
    if (l && l.getBounds) F.map.fitBounds(l.getBounds(), { padding: [50, 50], maxZoom: 17 });
    else F.map.setView([g.coordinates[1], g.coordinates[0]], 17);
  },
  startGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(p => {
      F.s.gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      F.drawMe();
    }, () => { /* 沒授權或訊號差：地圖照常使用 */ }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  },
  drawMe() {
    if (!F.map || !F.s.gps) return;
    const ll = [F.s.gps.lat, F.s.gps.lng];
    if (!F.me) F.me = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, zIndexOffset: 1000 }).addTo(F.map);
    else F.me.setLatLng(ll);
  },
  closeSheets() { U.$('#zsheet').hidden = true; U.$('#zdrawer').hidden = true; },
  openZone(id, ll) {
    const d = F.s.data, z = d.zones.find(x => x.id === id); if (!z) return;
    F.closeSheets();
    const tasks = d.tasks.filter(t => t.zoneId === id && t.status !== '完成');
    const box = U.$('#zsheet');
    const canReport = d.member.status === '有效' && d.case.status !== '已結案';
    box.innerHTML = '<button class="x" id="zs-x">✕</button><h3><span class="sw" style="display:inline-block;background:' + U.esc(z.color || CFG.catColor(z.category)) + '"></span> ' + U.esc(F.zPath(z)) + '</h3>' +
      '<div class="hint">' + U.esc(z.category) + (z.measure ? '・' + U.esc(z.measure) : '') + '</div>' +
      (F.zHaz(z) ? '<div class="d-haz">⚠ 危險因子：' + U.esc(F.zHaz(z)) + '</div>' : '') +
      (z.note ? '<div class="d-row"><div class="k">備註</div>' + U.esc(z.note) + '</div>' : '') +
      (tasks.length ? '<div class="d-row"><div class="k">此區的任務</div>' + tasks.map(t =>
        '<button class="list-btn" data-t="' + U.esc(t.id) + '"><span style="color:' + F.stColor(t.status) + '">' + U.esc(t.title) + '</span><small>' + U.esc(t.status) + '</small></button>').join('') + '</div>' : '') +
      '<button class="btn52 primary" id="zs-rep"' + (canReport ? '' : ' disabled') + '>📝 在此回報</button>';
    box.hidden = false;
    U.$('#zs-x').onclick = () => { box.hidden = true; };
    U.$$('[data-t]', box).forEach(b => b.onclick = () => { F.s.detail = b.dataset.t; F.setMode('list'); });
    U.$('#zs-rep').onclick = () => F.openReport({ zoneId: id, taskId: tasks[0] ? tasks[0].id : '', pos: ll ? { lat: ll.lat, lng: ll.lng } : null });
  },
  openDrawer() {
    const d = F.s.data; if (!d) return;
    F.closeSheets();
    const box = U.$('#zdrawer');
    box.innerHTML = '<button class="x" id="zd-x">✕</button><h3>區域清單（' + d.zones.length + '）</h3>' +
      (d.zones.map(z => '<button class="zone-row" data-z="' + U.esc(z.id) + '"><span class="sw" style="background:' + U.esc(z.color || CFG.catColor(z.category)) + '"></span><span><b>' + U.esc(F.zPath(z)) + '</b><br><small class="hint">' + U.esc(z.category) + (F.zHaz(z) ? '・⚠ ' + U.esc(F.zHaz(z)) : '') + '</small></span></button>').join('') || '<div class="empty">指揮所還沒有劃區域</div>');
    box.hidden = false;
    U.$('#zd-x').onclick = () => { box.hidden = true; };
    U.$$('[data-z]', box).forEach(b => b.onclick = () => { box.hidden = true; F.focusZone(b.dataset.z); F.openZone(b.dataset.z, null); });
  },

  /* ---------- 回報表單 ---------- */
  openReport(opts) {
    const d = F.s.data;
    if (!d || d.member.status !== '有效') { U.toast('尚待指揮所確認，目前還不能回報', 'err'); return; }
    if (d.case.status === '已結案') { U.toast('案件已結案', 'err'); return; }
    opts = opts || {};
    const t = opts.taskId && d.tasks.find(x => x.id === opts.taskId);
    const zone = opts.zoneId || (t && t.zoneId) || '';
    let pos = opts.pos || (F.s.gps ? { lat: F.s.gps.lat, lng: F.s.gps.lng } : null), hasPos = !!pos;
    if (!pos) {
      const z = d.zones.find(x => x.id === zone);
      try { const g = z && JSON.parse(z.geojson); if (g && g.type === 'Point') pos = { lat: g.coordinates[1], lng: g.coordinates[0] }; } catch (e) { /* 略 */ }
      if (!pos && z && F.map) { const l = F.zoneLayer(z); if (l && l.getBounds) { const c = l.getBounds().getCenter(); pos = { lat: c.lat, lng: c.lng }; } }
      if (!pos && parseFloat(d.case.lat)) pos = { lat: parseFloat(d.case.lat), lng: parseFloat(d.case.lng) };
      if (!pos) pos = { lat: CFG.DEFAULT_CENTER[0], lng: CFG.DEFAULT_CENTER[1] };
    }
    F.r = { photos: [], pos: pos, hasPos: hasPos, zoneId: zone, sending: false, kind: opts.kind || 'report', mode: '單人', triage: '', counts: { 紅: 0, 黃: 0, 綠: 0, 黑: 0 }, quicks: [] };
    const isCas = F.r.kind === 'casualty';
    const taskOpts = d.tasks.filter(x => x.status !== '完成').map(x => '<option value="' + U.esc(x.id) + '"' + (x.id === opts.taskId ? ' selected' : '') + '>' + U.esc(x.title) + '</option>').join('');
    const ov = U.$('#rsheet');
    ov.innerHTML = '<div class="ov-head"><button id="r-close">✕ 取消</button><b>' + (isCas ? '回報傷患' : '回報狀況') + '</b><span style="width:70px"></span></div>' +
      '<div class="ov-body">' + (isCas ? F.casFieldsHtml() : '') +
      '<div class="field"><label>對應任務</label><select id="r-task"><option value="">（不屬於任何任務）</option>' + taskOpts + '</select></div>' +
      '<div class="field"><label>' + (isCas ? '簡述（選填）' : '狀況說明') + '</label><textarea id="r-text" maxlength="500" placeholder="' + (isCas ? '例：男性約 50 歲，左小腿變形' : '例：A 區北側發現足跡，往稜線方向') + '"></textarea></div>' +
      '<div class="field"><label>照片（最多 3 張）</label><div class="photos" id="r-photos"></div>' +
      '<input id="r-cam" type="file" accept="image/*" capture="environment" hidden>' +
      '<input id="r-pick" type="file" accept="image/*" multiple hidden></div>' +
      '<div class="field"><label>位置（可拖曳圖釘修正）</label><div id="rmap"></div><div class="hint" id="r-pos"></div>' +
      '<button class="link-btn" id="r-gps">◎ 用目前 GPS 位置</button></div>' +
      '<div class="hint">位置只在送出這份回報時才會傳給指揮所，不會持續回傳您的位置。</div></div>' +
      '<div class="send-bar"><div id="r-err" class="err-box" hidden></div><button class="big-btn" id="r-send">送出回報</button></div>';
    ov.hidden = false; document.body.style.overflow = 'hidden';
    if (isCas) F.bindCasFields();
    U.$('#r-close').onclick = F.closeReport;
    U.$('#r-send').onclick = F.sendReport;
    U.$('#r-cam').addEventListener('change', F.onPhoto);
    U.$('#r-pick').addEventListener('change', F.onPhoto);
    U.$('#r-gps').onclick = () => {
      if (!F.s.gps) { U.toast('還沒有取得定位', 'err'); return; }
      F.setReportPos(F.s.gps.lat, F.s.gps.lng, true, true);
    };
    F.drawPhotos();
    // 迷你地圖
    setTimeout(() => {
      F.rmap = L.map('rmap', { zoomControl: true, attributionControl: false }).setView([pos.lat, pos.lng], 16);
      L.tileLayer(CFG.BASEMAPS[0].url, { maxZoom: 19, maxNativeZoom: 19 }).addTo(F.rmap);
      F.rmark = L.marker([pos.lat, pos.lng], { draggable: true }).addTo(F.rmap);
      F.rmark.on('dragend', () => { const ll = F.rmark.getLatLng(); F.setReportPos(ll.lat, ll.lng, true, false); });
      F.rmap.on('click', e => { F.setReportPos(e.latlng.lat, e.latlng.lng, true, false); });
      F.setReportPos(pos.lat, pos.lng, hasPos, false);
    }, 60);
  },
  setReportPos(lat, lng, has, moveMap) {
    F.r.pos = { lat: lat, lng: lng }; F.r.hasPos = has;
    if (F.rmark) F.rmark.setLatLng([lat, lng]);
    if (moveMap && F.rmap) F.rmap.setView([lat, lng], Math.max(F.rmap.getZoom(), 16));
    const el = U.$('#r-pos'); if (el) el.textContent = (has ? '回報位置：' : '尚未定位（請拖曳圖釘；不拖曳則不附位置）：') + U.fmtWgs(lat, lng);
  },
  closeReport() {
    if (F.r && (U.$('#r-text').value.trim() || F.r.photos.length || F.r.triage || F.r.quicks.length || F.r.mode === '群體') && !confirm('放棄這份尚未送出的回報嗎？')) return;
    F.endReport();
  },
  endReport() {
    if (F.rmap) { F.rmap.remove(); F.rmap = null; }
    F.rmark = null; F.r = null;
    U.$('#rsheet').hidden = true; U.$('#rsheet').innerHTML = ''; document.body.style.overflow = '';
  },
  drawPhotos() {
    const box = U.$('#r-photos'); if (!box) return;
    box.innerHTML = F.r.photos.map((p, i) => '<div class="ph"><img src="' + p.preview + '" alt=""><button class="rm" data-i="' + i + '">✕</button>' + (p.id ? '<span class="ok">已上傳</span>' : '') + '</div>').join('') +
      (F.r.photos.length < 3 ? '<div class="ph add" id="r-add">📷</div>' : '');
    const add = U.$('#r-add'); if (add) add.onclick = F.choosePhoto;
    U.$$('.rm', box).forEach(b => b.onclick = () => { F.r.photos.splice(+b.dataset.i, 1); F.drawPhotos(); });
  },
  /* 點「加照片」：讓使用者選「拍照」或「從相簿／檔案選取」 */
  choosePhoto() {
    const left = 3 - F.r.photos.length;
    U.modal({
      title: '加入照片（還可加 ' + left + ' 張）', html: '<p class="hint">拍照：直接開啟相機。相簿／檔案：從手機裡已有的照片選取，可一次選多張。</p>',
      buttons: [
        { text: '取消', value: false },
        { text: '📷 拍照', cls: 'primary', onClick: () => U.$('#r-cam').click() },
        { text: '🖼 相簿／檔案', cls: 'primary', onClick: () => U.$('#r-pick').click() }
      ]
    });
  },
  async onPhoto(e) {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length || !F.r) return;
    const room = 3 - F.r.photos.length;
    if (files.length > room) U.toast('最多 3 張，只取前 ' + room + ' 張', 'err');
    for (const f of files.slice(0, room)) {
      try { const c = await F.compress(f); if (F.r) F.r.photos.push({ preview: c.preview, b64: c.b64, id: null }); }
      catch (err) { U.toast(err.message, 'err'); }
    }
    if (F.r) F.drawPhotos();
  },
  /* 長邊 1600px、JPEG 品質 0.7（約 300～500KB） */
  compress(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const sc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const du = cv.toDataURL('image/jpeg', 0.7);
        URL.revokeObjectURL(url); res({ preview: du, b64: du.split(',')[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('無法讀取這張照片')); };
      img.src = url;
    });
  },
  /* 送出：先上傳還沒上傳的照片，再送回報。失敗保留整份表單，按鈕變「重新送出」 */
  async sendReport() {
    const r = F.r; if (!r || r.sending) return;
    const text = U.$('#r-text').value.trim();
    const isCas = r.kind === 'casualty';
    if (isCas) {
      if (r.mode === '單人' && !r.triage) { U.toast('請先點選檢傷等級（紅／黃／綠／黑）', 'err'); return; }
      if (r.mode === '群體' && !CFG.TRIAGE.some(t => r.counts[t.id] > 0)) { U.toast('請至少填 1 人', 'err'); return; }
    } else if (!text && !r.photos.length) { U.toast('請填寫狀況說明或附上照片', 'err'); return; }
    const btn = U.$('#r-send'), err = U.$('#r-err');
    r.sending = true; btn.disabled = true; btn.textContent = '送出中…'; err.hidden = true;
    try {
      for (let i = 0; i < r.photos.length; i++) {
        const ph = r.photos[i]; if (ph.id) continue;
        btn.textContent = '上傳照片 ' + (i + 1) + '/' + r.photos.length + '…';
        const up = await F.call('fieldPhoto', { mime: 'image/jpeg', data: ph.b64 });
        ph.id = up.photoId; F.drawPhotos();
      }
      btn.textContent = '送出中…';
      const taskId = U.$('#r-task').value, t = taskId && F.s.data.tasks.find(x => x.id === taskId);
      const coord = r.hasPos ? r.pos.lat.toFixed(6) + ',' + r.pos.lng.toFixed(6) : '';
      if (isCas) {
        const cas = { mode: r.mode, taskId: taskId, desc: text, photos: r.photos.map(p => p.id), coord: coord };
        if (r.mode === '群體') CFG.TRIAGE.forEach(x => { cas[x.field] = r.counts[x.id]; });
        else { cas.triage = r.triage; cas.quick = r.quicks.join('、'); }
        await F.call('fieldCasualty', { casualty: cas });
      } else {
        await F.call('fieldReport', { report: {
          taskId: taskId, zoneId: (t && t.zoneId) || r.zoneId || '', type: '文字', content: text,
          photos: r.photos.map(p => p.id), coord: coord
        } });
      }
      F.vib(60); F.endReport(); U.toast(isCas ? '傷患回報已送出' : '回報已送出', 'ok');
      if (isCas) { F.s.ftab = 'cas'; F.s.mode = 'list'; F.s.detail = null; }
      try { await F.refresh(false); } catch (e) { /* 下次輪詢再更新 */ }
    } catch (e) {
      if (!F.r) return;
      r.sending = false; btn.disabled = false; btn.textContent = '重新送出';
      err.hidden = false; err.textContent = '送出失敗：' + e.message + '。內容與照片都還在，請按「重新送出」。';
    }
  },

  /* ---------- 傷患回報表單的欄位 ---------- */
  casFieldsHtml() {
    return '<div class="seg2"><button data-m="單人" class="on">單人</button><button data-m="群體">多人</button></div>' +
      '<div id="c-single"><div class="field"><label>檢傷等級（點一下選取）</label><div class="tri-grid">' +
      CFG.TRIAGE.map(t => '<button class="tri-blk" style="--c:' + t.color + '" data-t="' + t.id + '">' + t.id + '<small>' + t.text + '</small></button>').join('') + '</div></div>' +
      '<div class="field"><label>狀況快選（可複選）</label><div class="qchips">' +
      CFG.CASUALTY_QUICKS.map(q => '<button class="qchip" data-q="' + U.esc(q) + '">' + U.esc(q) + '</button>').join('') + '</div></div></div>' +
      '<div id="c-group" hidden><div class="field"><label>各檢傷等級人數</label>' +
      CFG.TRIAGE.map(t => '<div class="step-row" style="--c:' + t.color + '"><div class="lab">' + t.id + '<small>' + t.text + '</small></div>' +
        '<button data-d="-1" data-t="' + t.id + '">−</button><div class="n" id="n-' + t.id + '">0</div><button data-d="1" data-t="' + t.id + '">＋</button></div>').join('') + '</div></div>';
  },
  bindCasFields() {
    const ov = U.$('#rsheet');
    U.$$('.seg2 button', ov).forEach(b => b.onclick = () => {
      F.r.mode = b.dataset.m;
      U.$$('.seg2 button', ov).forEach(x => x.classList.toggle('on', x === b));
      U.$('#c-single').hidden = F.r.mode !== '單人'; U.$('#c-group').hidden = F.r.mode !== '群體';
    });
    U.$$('.tri-blk', ov).forEach(b => b.onclick = () => {
      F.r.triage = b.dataset.t; F.vib(20);
      U.$$('.tri-blk', ov).forEach(x => x.classList.toggle('on', x === b));
    });
    U.$$('.qchip', ov).forEach(b => b.onclick = () => {
      const i = F.r.quicks.indexOf(b.dataset.q);
      if (i >= 0) F.r.quicks.splice(i, 1); else F.r.quicks.push(b.dataset.q);
      b.classList.toggle('on', i < 0);
    });
    U.$$('.step-row button', ov).forEach(b => b.onclick = () => {
      const t = b.dataset.t, n = Math.max(0, Math.min(99, F.r.counts[t] + parseInt(b.dataset.d, 10)));
      F.r.counts[t] = n; U.$('#n-' + t, ov).textContent = n; F.vib(15);
    });
  },
  /* 我回報過的傷患（唯讀；後送由指揮所管制） */
  renderCas() {
    U.$('#tasks').hidden = true; U.$('#detail').hidden = true; U.$('#cas-view').hidden = false;
    const d = F.s.data, box = U.$('#cas-view');
    if (d.member.status !== '有效') { box.innerHTML = '<div class="empty">尚未確認身分，目前不能回報傷患。</div>'; return; }
    const rows = (d.casualties || []).slice().sort((a, b) => (a.time < b.time ? 1 : -1));
    if (!rows.length) { box.innerHTML = '<div class="empty">您還沒有回報過傷患。<br>發現傷患請按下方「回報傷患」。</div>'; return; }
    box.innerHTML = rows.map(c => {
      const grp = c.mode === '群體', col = grp ? '#455a64' : CFG.triageColor(c.triage);
      const title = grp ? '多人：' + CFG.TRIAGE.filter(t => (+c[t.field] || 0) > 0).map(t => t.id + c[t.field]).join('　') : '檢傷 ' + c.triage + (c.quick ? '・' + c.quick : '');
      const idx = CFG.TRANSPORT.findIndex(s => s.id === c.status);
      return '<div class="cas-card" style="border-left-color:' + col + '"><div class="tt" style="color:' + col + '">' + U.esc(title) + '</div>' +
        '<div class="tm hint">' + F.hm(c.time) + (c.desc ? '　' + U.esc(c.desc) : '') + '</div>' +
        '<div class="flow">' + CFG.TRANSPORT.map((s, i) => '<span class="' + (i === idx ? 'on' : i < idx ? 'past' : '') + '">' + s.id + '</span>').join('') + '</div>' +
        (c.vehicle || c.hospital ? '<div class="hint" style="margin-top:6px">' + (c.vehicle ? '🚑 ' + U.esc(c.vehicle) : '') + (c.hospital ? '　🏥 ' + U.esc(c.hospital) : '') + '</div>' : '') + '</div>';
    }).join('');
  },

  /* ---------- 加入案件 ---------- */
  showJoinMsg(msg, retry) {
    F.showView('join');
    U.$('#v-join').innerHTML = '<div class="card"><h2>案件管制・現場回報</h2><p>' + U.esc(msg) + '</p>' +
      (retry ? '<button class="btn52 primary" onclick="location.reload()">重新載入</button>' : '') + '</div>';
  },
  showView(v) {
    U.$('#v-join').hidden = v !== 'join';
    if (v === 'join') { U.$('#fhead').hidden = true; U.$('#ffoot').hidden = true; U.$('#banner').hidden = true; U.$('#v-list').hidden = true; U.$('#v-map').hidden = true; }
  },
  async showJoin(msg) {
    F.showView('join');
    const box = U.$('#v-join');
    box.innerHTML = '<div class="card"><p class="hint">載入中…</p></div>';
    try { F.s.info = await Api.call('getJoinInfo', { caseId: F.s.caseId, code: F.s.code }); }
    catch (e) { box.innerHTML = '<div class="card"><h2>無法加入</h2><p>' + U.esc(e.message) + '</p><p class="hint">請向指揮所確認 QR Code 是否為最新。</p></div>'; return; }
    F.j = { q: '', unit: '' };
    F.renderJoin(msg);
  },
  subseq(q, s) {   // 字依序出現即符合：「小明」「王明」→「王小明」
    let i = 0; q = q.replace(/\s/g, '');
    for (const ch of s) { if (ch === q[i]) i++; if (i >= q.length) return true; }
    return q.length === 0;
  },
  renderJoin(msg) {
    const info = F.s.info, box = U.$('#v-join');
    let me = null; try { me = JSON.parse(U.store.get('ccs_me', '')); } catch (e) { /* 無 */ }
    const meOk = me && info.people.find(p => p.id === me.personId);
    box.innerHTML = (msg ? '<div class="banner err" style="margin:-12px -12px 12px">' + U.esc(msg) + '</div>' : '') +
      '<div class="card"><div class="hint">加入案件</div><h2>' + U.esc(info.name) + '</h2><div class="hint">' + U.esc(info.type) + '案件・請選擇您是誰</div></div>' +
      (meOk ? '<button class="big-btn" id="j-me" style="margin-bottom:12px">以 ' + U.esc(me.name) + '（' + U.esc(me.unit) + '）加入</button>' : '') +
      '<div class="field"><input id="j-q" type="search" placeholder="🔍 輸入姓名或組別搜尋" autocomplete="off"></div>' +
      '<div id="j-res"></div>' +
      '<button class="link-btn" id="j-tmp">找不到我，以臨時人員加入</button>';
    if (meOk) U.$('#j-me').onclick = () => F.confirmJoin(meOk);
    U.$('#j-q').addEventListener('input', e => { F.j.q = e.target.value; F.j.unit = ''; F.drawJoinResults(); });
    U.$('#j-tmp').onclick = F.tempForm;
    F.drawJoinResults();
  },
  drawJoinResults() {
    const info = F.s.info, box = U.$('#j-res'), q = F.j.q.trim();
    const pbtn = p => '<button class="list-btn" data-p="' + U.esc(p.id) + '">' + U.esc(p.name) + '<small>' + U.esc(p.group || p.unit) + (p.title ? '・' + U.esc(p.title) : '') + '</small></button>';
    let html;
    if (q) {
      const res = info.people.filter(p => F.subseq(q, p.name) || (p.group || '').indexOf(q) >= 0 || p.unit.indexOf(q) >= 0 || F.subseq(q, (p.group || p.unit) + p.name));
      html = res.length ? res.map(pbtn).join('') : '<div class="empty">找不到符合的人員</div>';
    } else if (F.j.unit) {
      html = '<button class="back" id="j-back">← 回單位列表</button><div class="hint" style="margin-bottom:6px">' + U.esc(F.j.unit) + '</div>' +
        info.people.filter(p => (p.group || p.unit) === F.j.unit).map(pbtn).join('');
    } else {
      html = '<div class="hint" style="margin-bottom:6px">或先選' + (info.scheme ? '組別（' + U.esc(info.scheme) + '）' : '單位') + '：</div><div class="unit-grid">' +
        info.units.map(u => '<button class="list-btn" data-u="' + U.esc(u.name) + '">' + U.esc(u.name) + '</button>').join('') + '</div>';
    }
    box.innerHTML = html;
    U.$$('[data-p]', box).forEach(b => b.onclick = () => F.confirmJoin(info.people.find(p => p.id === b.dataset.p)));
    U.$$('[data-u]', box).forEach(b => b.onclick = () => { F.j.unit = b.dataset.u; F.drawJoinResults(); });
    const bk = U.$('#j-back'); if (bk) bk.onclick = () => { F.j.unit = ''; F.drawJoinResults(); };
  },
  async confirmJoin(p) {
    if (!p) return;
    const ok = await U.modal({
      title: '確認身分', html: '<p class="confirm-msg">我是 <b>' + U.esc(p.name) + '</b>（' + U.esc(p.group || p.unit) + '）</p>',
      buttons: [{ text: '不是我', value: false }, { text: '確認加入', cls: 'primary', value: true }]
    });
    if (ok !== true) return;
    try {
      const r = await Api.call('joinCase', { caseId: F.s.caseId, code: F.s.code, personId: p.id, device: F.device() });
      U.store.set('ccs_me', JSON.stringify({ personId: p.id, name: p.name, unit: p.unit }));
      await F.afterJoin(r);
    } catch (e) { U.toast('加入失敗：' + e.message, 'err'); }
  },
  tempForm() {
    const info = F.s.info, box = U.$('#v-join');
    box.innerHTML = '<button class="back" id="t-back">← 回上一頁</button><div class="card"><h2>臨時人員加入</h2>' +
      '<p class="hint">加入後需等指揮所確認；確認前可看地圖與區域，不能收任務與回報。</p>' +
      '<div class="field"><label>姓名（必填）</label><input id="t-name" type="text" maxlength="20" autocomplete="off"></div>' +
      '<div class="field"><label>單位（可選可自填）</label><input id="t-unit" type="text" list="t-units" maxlength="30"><datalist id="t-units">' + info.units.map(u => '<option value="' + U.esc(u.name) + '">').join('') + '</datalist></div>' +
      '<div class="field"><label>電話（選填）</label><input id="t-phone" type="tel" maxlength="20"></div>' +
      '<button class="btn52 primary" id="t-send">送出申請</button></div>';
    U.$('#t-back').onclick = () => F.renderJoin();
    U.$('#t-send').onclick = async () => {
      const name = U.$('#t-name').value.trim();
      if (!name) { U.toast('請填寫姓名', 'err'); return; }
      try {
        const r = await Api.call('joinAsTemp', { caseId: F.s.caseId, code: F.s.code, name: name, unit: U.$('#t-unit').value.trim(), phone: U.$('#t-phone').value.trim(), device: F.device() });
        await F.afterJoin(r);
      } catch (e) { U.toast('申請失敗：' + e.message, 'err'); }
    };
  },
  async afterJoin(r) {
    F.s.token = r.token; F.s.member = r.member; F.s.seen = null;
    U.store.set(F.sessionKey(), JSON.stringify({ token: r.token, member: r.member }));
    await F.refresh(true);
    U.toast(r.member.status === '有效' ? '已加入案件' : '已送出申請，等待指揮所確認', 'ok');
  }
};
document.addEventListener('DOMContentLoaded', F.init);
