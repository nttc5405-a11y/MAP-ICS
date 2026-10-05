/* 唯讀看板：只讀、自動更新、不含個資（姓名電話、傷患描述／照片都不會出現） */
const B = {
  caseId: '', view: '', data: null, version: -1, map: null, fitted: false,

  async init() {
    const p = new URLSearchParams(location.search);
    B.caseId = p.get('case') || ''; B.view = p.get('view') || '';
    if (!B.caseId || !B.view) { B.msg('這不是有效的看板連結。<br>請向指揮所索取。'); return; }
    B.initMap();
    setInterval(B.tick, 1000); B.tick();
    document.addEventListener('keydown', e => { if (e.key === 'f' || e.key === 'F') B.fit(); });
    await B.load();
    setInterval(B.poll, 10000);
    B.loadMarquee(); setInterval(B.loadMarquee, 60000);
  },
  async loadMarquee() {
    try { const s = await B.call('getSettings'); U.marquee(document.getElementById('mq-board'), s.marqueeText, s.marqueeSeconds); } catch (e) { /* 不顯示 */ }
  },
  msg(html) { const m = document.getElementById('bmsg'); m.innerHTML = html; m.hidden = false; },
  tick() { document.getElementById('clock').textContent = U.now().slice(11); },

  call(action) { return Api.call(action, { caseId: B.caseId, viewCode: B.view }); },
  async load() {
    try {
      B.data = await B.call('getBoardData');
      B.version = B.data.version; document.getElementById('bmsg').hidden = true;
      document.getElementById('b-upd').textContent = '資料更新 ' + U.now().slice(11, 19);
      B.render();
    } catch (e) { if (!B.data) B.msg(U.esc(e.message) + '<br><small>請向指揮所確認看板連結是否仍有效。</small>'); else B.warn(e.message); }
  },
  warn(m) { document.getElementById('b-upd').textContent = '⚠ 連線異常：' + m; },
  async poll() {
    try {
      const v = await B.call('getBoardVersion');
      if (Number(v.version) !== Number(B.version) || v.status !== B.data.case.status) await B.load();
      else document.getElementById('b-upd').textContent = '資料更新 ' + U.now().slice(11, 19);
    } catch (e) {
      if (/無效|關閉/.test(e.message)) { B.data = null; B.msg('看板連結已關閉。<br>請向指揮所索取新的連結。'); } else B.warn(e.message);
    }
  },

  /* ---------- 計算 ---------- */
  ll(coord) {
    const p = String(coord || '').split(','), lat = parseFloat(p[0]), lng = parseFloat(p[1]);
    return p.length === 2 && U.validLatLng(lat, lng) ? { lat: lat, lng: lng } : null;
  },
  num(v) { return parseInt(v, 10) || 0; },
  remaining(g) {
    const r = {}; let total = 0;
    CFG.TRIAGE.forEach(t => {
      r[t.id] = Math.max(0, B.num(g[t.field]) - B.data.casualties.filter(k => k.parentId === g.id && k.triage === t.id).length);
      total += r[t.id];
    });
    r.total = total; return r;
  },
  persons(c) {
    if (c.mode === '群體') return B.remaining(c);
    const r = { 紅: 0, 黃: 0, 綠: 0, 黑: 0, total: 1 }; r[c.triage] = 1; return r;
  },

  /* ---------- 畫面 ---------- */
  render() {
    const d = B.data, c = d.case;
    document.title = c.name + '・唯讀看板';
    document.getElementById('b-name').textContent = c.name;
    const tg = document.getElementById('b-type'); tg.textContent = c.type; tg.style.background = CFG.typeColor(c.type);
    document.getElementById('b-place').textContent = c.place ? '📍 ' + c.place : '';
    document.getElementById('b-closed').hidden = c.status !== '已結案';
    B.renderStats(); B.renderMap(); B.renderLabels();
    if (!B.fitted) { B.fit(); B.fitted = true; }
  },
  renderStats() {
    const d = B.data;
    const running = d.units.filter(u => u.status === '執行中').length;
    const open = d.tasks.filter(t => t.status !== '完成'), done = d.tasks.length - open.length;
    document.getElementById('st-top').innerHTML =
      '<div class="stat"><b>' + d.memberStats.active + '</b><span>在場人員' + (d.memberStats.pending ? '（待確認 ' + d.memberStats.pending + '）' : '') + '</span></div>' +
      '<div class="stat"><b>' + d.units.length + '</b><span>部署單位（執行中 ' + running + '）</span></div>' +
      '<div class="stat"><b>' + open.length + '</b><span>進行中任務（完成 ' + done + '）</span></div>';
    // 傷患
    const t = { 紅: 0, 黃: 0, 綠: 0, 黑: 0, total: 0, arrived: 0, moving: 0 };
    d.casualties.forEach(c => { const p = B.persons(c); CFG.TRIAGE.forEach(x => { t[x.id] += p[x.id]; }); t.total += p.total; if (c.status === '已到院') t.arrived += p.total; else if (c.status === '後送中') t.moving += p.total; });
    document.getElementById('st-cas').innerHTML = '<div class="tri">' + CFG.TRIAGE.map(x => '<div style="background:' + x.color + '"><b>' + t[x.id] + '</b><span>' + x.id + '</span></div>').join('') + '</div>' +
      '<div class="cas-line">共 ' + t.total + ' 人・後送中 ' + t.moving + ' 人・已到院 ' + t.arrived + ' 人</div>';
    // 任務
    const order = ['需支援', '已派遣', '已接收', '已抵達', '執行中', '完成'];
    const tasks = d.tasks.slice().sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (a.tAssigned < b.tAssigned ? 1 : -1));
    document.getElementById('st-tasks').innerHTML = tasks.length ? tasks.map(k => {
      const col = CFG.taskColor(k.status), z = d.zones.find(x => x.id === k.zoneId);
      return '<div class="task"><span class="dot" style="background:' + col + '"></span><div class="tt">' + U.esc(k.title) +
        '<small>' + U.esc(k.units.join('、')) + (z ? '・' + U.esc(B.path(z)) : '') + '</small></div><span class="pill" style="background:' + col + '">' + U.esc(k.status) + '</span></div>';
    }).join('') : '<div class="empty">尚無任務</div>';
    // 回報
    const reps = d.reports.slice().sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, 5);
    document.getElementById('st-reps').innerHTML = reps.length ? reps.map(r =>
      '<div class="rep"><small>' + U.esc(String(r.time).slice(11, 16)) + (r.unit ? '・' + U.esc(r.unit) : '') + '</small>' + U.esc(r.content) + '</div>').join('') : '<div class="empty">尚無回報</div>';
  },

  /* ---------- 地圖 ---------- */
  initMap() {
    const b = CFG.BASEMAPS[0];
    B.map = L.map('bmap', { zoomControl: true, attributionControl: true }).setView(CFG.DEFAULT_CENTER, 12);
    L.tileLayer(b.url, { attribution: b.attr, maxZoom: b.maxZoom, maxNativeZoom: b.maxNativeZoom }).addTo(B.map);
    B.zoneG = L.featureGroup().addTo(B.map); B.unitG = L.featureGroup().addTo(B.map);
    B.casG = L.featureGroup().addTo(B.map); B.repG = L.featureGroup().addTo(B.map); B.labelG = L.layerGroup().addTo(B.map);
  },
  renderMap() {
    const d = B.data;
    [B.zoneG, B.unitG, B.casG, B.repG, B.labelG].forEach(g => g.clearLayers());
    B.zl = {};
    d.zones.slice().sort((a, b) => B.chain(a).length - B.chain(b).length).forEach(z => {   // 上層先畫、子區域在上面
      let g; try { g = JSON.parse(z.geojson); } catch (e) { return; }
      const col = z.color || CFG.catColor(z.category);
      const st = { color: col, weight: 3, opacity: 1, fillColor: col, fillOpacity: 0.22, interactive: true };
      if (z.category === '搜索區') { if (z.status === '已搜') { st.fillOpacity = 0.06; st.dashArray = '8 6'; } else if (z.status === '搜索中') { st.fillOpacity = 0.38; st.weight = 5; } }
      let l = null;
      if (z.geomType === 'Point') l = L.circleMarker([g.coordinates[1], g.coordinates[0]], { radius: 9, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 });
      else if (z.geomType === 'Circle') l = L.circle([g.coordinates[1], g.coordinates[0]], Object.assign({ radius: Number(z.radius) || 1 }, st));
      else if (z.geomType === 'LineString') l = L.polyline(g.coordinates.map(c => [c[1], c[0]]), Object.assign({}, st, { fill: false }));
      else if (z.geomType === 'Polygon') l = L.polygon(g.coordinates.map(r => r.map(c => [c[1], c[0]])), st);
      if (l) { l.bindTooltip(() => B.zoneTip(z), { sticky: true }); B.zoneG.addLayer(l); B.zl[z.id] = l; }
    });
    d.units.forEach(u => {
      const lat = parseFloat(u.lat), lng = parseFloat(u.lng);
      if (u.lat === '' || u.lng === '' || !U.validLatLng(lat, lng)) return;
      const col = CFG.unitColor(u.status);
      B.unitG.addLayer(L.marker([lat, lng], { zIndexOffset: 800, icon: L.divIcon({ className: 'unit-wrap', html: '<div class="unit-badge" style="border-color:' + col + '"><i style="background:' + col + '"></i>' + U.esc(u.name) + '</div>', iconAnchor: [0, 14] }) }));
    });
    d.casualties.forEach(c => {
      const p = B.ll(c.coord); if (!p) return;
      let icon;
      if (c.mode === '群體') {
        const rem = B.remaining(c); if (!rem.total) return;
        icon = L.divIcon({ className: 'cas-wrap', html: '<div class="cas-pie' + (c.status === '已到院' ? ' done' : '') + '">' + U.triagePie(rem, 50) + '</div>', iconSize: [54, 54], iconAnchor: [27, 27] });
      } else {
        const glyph = c.status === '已到院' ? '✓' : c.status === '後送中' ? '➜' : '';
        icon = L.divIcon({ className: 'cas-wrap', html: '<div class="cas-dot' + (c.status === '已到院' ? ' done' : '') + '" style="background:' + CFG.triageColor(c.triage) + '">' + glyph + '</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
      }
      B.casG.addLayer(L.marker([p.lat, p.lng], { icon: icon, zIndexOffset: 900 }));
    });
    d.reports.forEach(r => {
      const p = B.ll(r.coord); if (!p) return;
      B.repG.addLayer(L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'rp-wrap', html: '<div class="rp-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).bindTooltip(U.esc(r.content)));
    });
  },
  /* 區域的游標提示：區域資訊 + 該區未完成任務、單位與人員姓名 */
  openTasks(zid) { return B.data.tasks.filter(t => t.zoneId === zid && t.status !== '完成'); },
  chain(z) { const a = []; let p = z, n = 0; while (p && n++ < 10) { a.push(p); p = p.parentId ? B.data.zones.find(x => x.id === p.parentId) : null; } return a; },   // 自己→上層
  path(z) { return B.chain(z).reverse().map(x => x.name || x.category).join(' › '); },
  hazards(z) { const o = []; B.chain(z).forEach(x => String(x.hazard || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean).forEach(h => { if (o.indexOf(h) < 0) o.push(h); })); return o.join('、'); },
  zoneTip(z) {
    const hz = B.hazards(z);
    let h = '<b>' + U.esc(B.path(z)) + '</b><br>' + U.esc(z.category) + (z.measure ? '<br>' + U.esc(z.measure) : '') + (hz ? '<br>⚠ ' + U.esc(hz) : '');
    B.openTasks(z.id).forEach(t => {
      h += '<hr class="tip-hr"><span style="color:' + CFG.taskColor(t.status) + ';font-weight:700">● ' + U.esc(t.title) + '</span>（' + U.esc(t.status) + '）' +
        (t.units.length ? '<br>單位：' + U.esc(t.units.join('、')) : '') +
        (t.crew && t.crew.length ? '<br>人員（' + t.crew.length + '）：' + U.esc(t.crew.slice(0, 16).join('、')) + (t.crew.length > 16 ? '…' : '') : '') +
        (t.hazard ? '<br>⚠ ' + U.esc(t.hazard) : '');
    });
    return h;
  },
  /* 有未完成任務的區域，在中央標出任務標題 */
  renderLabels() {
    B.labelG.clearLayers();
    Object.keys(B.zl).forEach(zid => {
      const ts = B.openTasks(zid); if (!ts.length) return;
      const l = B.zl[zid], ll = l.getBounds ? l.getBounds().getCenter() : l.getLatLng();
      const html = ts.map(t => '<div class="tl-row" style="border-left-color:' + CFG.taskColor(t.status) + '">' + U.esc(t.title) + '<small>' + U.esc(t.status) + '</small></div>').join('');
      B.labelG.addLayer(L.marker(ll, { interactive: false, zIndexOffset: 700, icon: L.divIcon({ className: 'task-label-wrap', html: '<div class="task-label">' + html + '</div>', iconSize: [0, 0] }) }));
    });
  },
  fit() {
    B.map.invalidateSize();
    const g = L.featureGroup([B.zoneG, B.unitG, B.casG]);
    const b = g.getBounds();
    if (b.isValid()) B.map.fitBounds(b, { padding: [60, 60], maxZoom: 16 });
    else if (B.data && parseFloat(B.data.case.lat)) B.map.setView([parseFloat(B.data.case.lat), parseFloat(B.data.case.lng)], 14);
  }
};
document.addEventListener('DOMContentLoaded', B.init);
