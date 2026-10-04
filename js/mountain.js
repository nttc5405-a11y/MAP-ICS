/* 山域模組：搜索分區進度、登山計畫、搜救計畫（作業期版本）、搜索軌跡與覆蓋範圍 */
const Mountain = {
  sub: 'seg',
  coverOn: false,
  cov: {},            // zoneId → { pct }

  isMt() { return !!(App.state.cur && App.state.cur.type === '山域'); },
  syncTab() {
    const b = U.$('#tab-mt'); if (!b) return;
    b.hidden = !Mountain.isMt();
    if (b.hidden && b.classList.contains('active')) App.switchTab('zones');
  },
  segs() {
    return App.state.zones.filter(z => z.category === '搜索區')
      .sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99) || String(a.name).localeCompare(String(b.name)));
  },
  tracks(cat) {
    return App.state.zones.filter(z => z.geomType === 'LineString' && (cat ? z.category === cat : CFG.TRACK_CATS.indexOf(z.category) >= 0));
  },
  plans(type) {
    return App.state.plans.filter(p => p.type === type).sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0));
  },
  content(p) { try { return JSON.parse(p.content) || {}; } catch (e) { return {}; } },
  unitName(id) { const u = Deploy.byId(id); return u ? u.name : '（已移除）'; },
  // datetime-local（YYYY-MM-DDTHH:mm）⇄ 'yyyy/MM/dd HH:mm'
  toInput(s) { return s ? String(s).slice(0, 16).replace(/\//g, '-').replace(' ', 'T') : ''; },
  fromInput(s) { return s ? s.replace('T', ' ').replace(/-/g, '/') : ''; },

  /* ---------- 版面 ---------- */
  bind() {
    U.$$('.seg-btn[data-mt]').forEach(b => b.addEventListener('click', () => Mountain.setSub(b.dataset.mt)));
    U.$('#mt-seg').addEventListener('click', Mountain.onSegClick);
    U.$('#mt-seg').addEventListener('change', Mountain.onSegChange);
    U.$('#mt-plan').addEventListener('click', Mountain.onPlanClick);
    U.$('#mt-trk').addEventListener('click', Mountain.onTrkClick);
    U.$('#mt-cover').addEventListener('change', e => { Mountain.coverOn = e.target.checked; Mountain.drawCoverage(); });
    U.$('#btn-mt-import').addEventListener('click', () => {
      if (!App.needCase(true)) return;
      App.importCat = '搜索軌跡'; U.$('#file-import').click();
    });
  },
  setSub(name) {
    Mountain.sub = name;
    U.$$('.seg-btn[data-mt]').forEach(b => b.classList.toggle('active', b.dataset.mt === name));
    ['seg', 'plan', 'trk'].forEach(n => { U.$('#mt-' + n).hidden = n !== name; });
  },
  renderAll() {
    Mountain.syncTab();
    if (!Mountain.isMt()) { Mountain.drawCoverage(); return; }
    Mountain.renderSeg(); Mountain.renderPlans(); Mountain.renderTracks(); Mountain.drawCoverage();
  },

  /* ---------- 搜索分區 ---------- */
  renderSeg() {
    const box = U.$('#mt-seg'); if (!box) return;
    const segs = Mountain.segs(), ro = App.state.readonly;
    const cnt = s => segs.filter(z => (z.status || '未搜') === s).length;
    const latest = Mountain.plans('搜救計畫')[0], asg = latest ? (Mountain.content(latest).assignments || []) : [];
    const cols = { 未搜: '#757575', 搜索中: '#7b1fa2', 已搜: '#2e7d32' };
    let html = '<div class="seg-sum">' + CFG.SEARCH_STATUS.map(s => '<div style="border-color:' + cols[s] + ';color:' + cols[s] + '"><b>' + cnt(s) + '</b>' + s + '</div>').join('') + '</div>';
    if (!segs.length) {
      box.innerHTML = html + '<div class="empty">還沒有搜索分區。<br>用地圖左側工具畫多邊形，類別選「搜索區」。</div>'; return;
    }
    html += '<div class="list">' + segs.map(z => {
      const st = z.status || '未搜', a = asg.find(x => x.zoneId === z.id);
      const opts = CFG.SEARCH_STATUS.map(s => '<option' + (s === st ? ' selected' : '') + '>' + s + '</option>').join('');
      const cv = Mountain.cov[z.id];
      return '<div class="seg-item" data-id="' + U.esc(z.id) + '" style="border-left-color:' + cols[st] + '">' +
        '<div class="ui-top"><b>' + (z.priority ? '<span class="pri">' + U.esc(z.priority) + '</span>' : '') + U.esc(z.name || z.id) + '</b>' +
        '<select data-f="status"' + (ro ? ' disabled' : '') + '>' + opts + '</select></div>' +
        '<div class="ui-sub">' + U.esc(z.measure || '') + '</div>' +
        (z.terrain ? '<div class="ui-sub">地形：' + U.esc(z.terrain) + '</div>' : '') +
        (z.quality ? '<div class="ui-sub">搜索品質：' + U.esc(z.quality) + '</div>' : '') +
        (z.hazard ? '<div class="zi-haz">⚠ ' + U.esc(z.hazard) + '</div>' : '') +
        '<div class="ui-sub">' + (a && a.units && a.units.length ? '指派：' + U.esc(a.units.map(Mountain.unitName).join('、')) + (a.method ? '（' + U.esc(a.method) + '）' : '') : '<i>尚未指派隊伍（搜救計畫）</i>') + '</div>' +
        (cv ? '<div class="cov-bar"><i style="width:' + cv.pct + '%"></i><span>覆蓋率約 ' + cv.pct + '%（估算，依 ' + cv.n + ' 條搜索軌跡）</span></div>' : '') +
        '<div class="ui-btns"><button class="btn small" data-act="focus">定位</button><button class="btn small" data-act="cov">估算覆蓋率</button>' +
        (ro ? '' : '<button class="btn small" data-act="edit">編輯</button>') + '</div></div>';
    }).join('') + '</div>';
    box.innerHTML = html;
  },
  onSegClick(e) {
    const it = e.target.closest('.seg-item'), b = e.target.closest('[data-act]'); if (!it || !b) return;
    const id = it.dataset.id;
    if (b.dataset.act === 'focus') MapView.focusZone(id);
    else if (b.dataset.act === 'edit') Zones.edit(id);
    else if (b.dataset.act === 'cov') {
      const r = Mountain.estimate(id);
      if (r.error) { U.toast(r.error, 'err'); return; }
      Mountain.cov[id] = { pct: r.pct, n: r.tracks }; Mountain.renderSeg();
    }
  },
  onSegChange(e) {
    const it = e.target.closest('.seg-item'); if (!it || e.target.dataset.f !== 'status') return;
    const z = Zones.byId(it.dataset.id); if (!z || App.state.readonly) return;
    Zones.persist(Object.assign({}, z, { status: e.target.value }), true);
  },

  /* 覆蓋率估算：在分區內以格點取樣，距任一搜索軌跡 ≤ 50 m 的比例（TWD97 平面計算） */
  estimate(zoneId) {
    const z = Zones.byId(zoneId); let g = z && Zones.geometryOf(z);
    if (!g) return { error: '找不到這個分區的圖形' };
    if (z.geomType === 'Circle') g = U.circleToPolygon(g.coordinates[0], g.coordinates[1], Number(z.radius) || 1);   // 圓形分區轉成多邊形計算
    if (g.type !== 'Polygon') return { error: '這個區域是點或線，不是「面」，無法估算覆蓋率。請把搜索區畫成多邊形、矩形或圓形。' };
    const tr = Mountain.tracks('搜索軌跡');
    if (!tr.length) return { error: '還沒有任何「搜索軌跡」可以計算。請到「軌跡」分頁按「匯入軌跡」，匯入隊伍的 GPX，並在「匯入為」選「搜索軌跡」。' };
    const toXY = c => { const t = U.wgs84ToTwd97(c[1], c[0]); return [t.e, t.n]; };
    const ring = g.coordinates[0].map(toXY);
    const holes = g.coordinates.slice(1).map(r => r.map(toXY));
    const lines = tr.map(t => Zones.geometryOf(t)).filter(Boolean).map(l => l.coordinates.map(toXY));
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const step = Math.max(10, Math.sqrt((x1 - x0) * (y1 - y0) / 20000));
    const R = CFG.COVER_BUFFER_M, segs = [];
    lines.forEach(l => { for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i];
      if (Math.max(a[0], b[0]) < x0 - R || Math.min(a[0], b[0]) > x1 + R || Math.max(a[1], b[1]) < y0 - R || Math.min(a[1], b[1]) > y1 + R) continue;
      segs.push([a[0], a[1], b[0], b[1]]);
    } });
    const inRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
    const near = (x, y) => { for (let k = 0; k < segs.length; k++) {
      const s = segs[k], dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy;
      let t = L2 ? ((x - s[0]) * dx + (y - s[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const ex = x - (s[0] + t * dx), ey = y - (s[1] + t * dy);
      if (ex * ex + ey * ey <= R * R) return true; } return false; };
    let total = 0, hit = 0;
    for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
      const p = [x, y];
      if (!inRing(p, ring) || holes.some(h => inRing(p, h))) continue;
      total++; if (segs.length && near(x, y)) hit++;
    }
    return { pct: total ? Math.round(hit / total * 1000) / 10 : 0, tracks: tr.length };
  },

  /* ---------- 軌跡 ---------- */
  renderTracks() {
    const box = U.$('#mt-tracks'); if (!box) return;
    const rows = Mountain.tracks().sort((a, b) => CFG.TRACK_CATS.indexOf(a.category) - CFG.TRACK_CATS.indexOf(b.category));
    box.innerHTML = rows.length ? rows.map(z => {
      const seg = z.segmentId && Zones.byId(z.segmentId);
      return '<div class="zone-item" data-id="' + U.esc(z.id) + '"><span class="swatch" style="background:' + U.esc(z.color || CFG.catColor(z.category)) + '"></span>' +
        '<div class="zi-main"><div class="zi-name">' + U.esc(z.name) + '</div><div class="zi-sub">' + U.esc(z.category) + '・' + U.esc(z.measure || '') +
        (z.teamId ? '・' + U.esc(Mountain.unitName(z.teamId)) : '') + (seg ? '・分區 ' + U.esc(seg.name) : '') + '</div></div>' +
        '<div class="zi-btns"><button class="icon-btn" data-act="focus" title="定位">◎</button>' +
        (App.state.readonly ? '' : '<button class="icon-btn" data-act="edit" title="編輯">✎</button>') + '</div></div>';
    }).join('') : '<div class="empty">還沒有軌跡。<br>隊員回來後把 GPX／KML 交給指揮所，按上方「匯入軌跡」。</div>';
  },
  onTrkClick(e) {
    const it = e.target.closest('.zone-item'), b = e.target.closest('[data-act]'); if (!it || !b) return;
    if (b.dataset.act === 'focus') MapView.focusZone(it.dataset.id); else Zones.edit(it.dataset.id);
  },
  /* 搜索軌跡兩側各 50 m 的「已搜索覆蓋範圍」：以粗線畫出，寬度隨縮放換算成公尺 */
  coverWeight() {
    const m = MapView.map, lat = m.getCenter().lat;
    const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, m.getZoom());
    return Math.max(2, 2 * CFG.COVER_BUFFER_M / mpp);
  },
  drawCoverage() {
    const m = MapView.map; if (!m) return;
    if (!Mountain.coverGroup) {
      m.createPane('cover');
      const p = m.getPane('cover'); p.style.zIndex = 350; p.style.opacity = 0.4; p.style.pointerEvents = 'none';
      Mountain.coverGroup = L.layerGroup().addTo(m);
      m.on('zoomend', () => { if (Mountain.coverOn) Mountain.coverGroup.eachLayer(l => l.setStyle({ weight: Mountain.coverWeight() })); });
    }
    Mountain.coverGroup.clearLayers();
    if (!Mountain.coverOn || !Mountain.isMt()) return;
    const w = Mountain.coverWeight();
    Mountain.tracks('搜索軌跡').forEach(z => {
      const g = Zones.geometryOf(z); if (!g) return;
      L.polyline(g.coordinates.map(c => [c[1], c[0]]), { pane: 'cover', color: '#2e7d32', weight: w, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(Mountain.coverGroup);
    });
  },

  /* ---------- 計畫 ---------- */
  async savePlan(rec, quiet) {
    const r = await Deploy.w('savePlan', { plan: rec }, () => {
      const i = App.state.plans.findIndex(x => x.id === rec.id);
      if (i >= 0) App.state.plans[i] = rec; else App.state.plans.push(rec);
    });
    if (r) {
      if (r.plan) { const i = App.state.plans.findIndex(x => x.id === rec.id); if (i >= 0) App.state.plans[i] = r.plan; }
      Mountain.renderAll(); if (!quiet) U.toast('計畫已儲存', 'ok');
    }
    return r;
  },
  async delPlan(id) {
    const p = App.state.plans.find(x => x.id === id); if (!p) return;
    if (!await U.confirm('確定刪除「' + p.type + ' v' + p.version + '」嗎？', '刪除', true)) return;
    await Deploy.w('deletePlan', { planId: id }, () => { App.state.plans = App.state.plans.filter(x => x.id !== id); });
    Mountain.renderAll();
  },

  renderPlans() {
    const box = U.$('#mt-plan'); if (!box) return;
    const ro = App.state.readonly;
    const hikes = Mountain.plans('登山計畫'), ops = Mountain.plans('搜救計畫');
    const f = (k, v) => v ? '<div class="ui-sub"><b>' + k + '</b>：' + U.esc(v) + '</div>' : '';
    let html = '<div class="sec-title">登山計畫（失蹤隊伍原定計畫）</div><div class="pane-bar">' +
      (ro ? '' : '<button class="btn" id="btn-hike-new">＋ 新增登山計畫</button>') + '</div><div class="list">';
    html += hikes.length ? hikes.map(p => {
      const c = Mountain.content(p), route = c.routeZoneId && Zones.byId(c.routeZoneId);
      return '<div class="plan-item" data-id="' + U.esc(p.id) + '"><div class="ui-top"><b>' + U.esc(c.team || '（未命名隊伍）') + '</b><span class="hint">領隊 ' + U.esc(c.leader || '—') + '</span></div>' +
        '<div class="ui-sub">成員 ' + (c.members || []).length + ' 人・預計下山 ' + U.esc(c.expectedDown || '未填') + '</div>' +
        '<details><summary>詳細資料</summary>' +
        (c.members && c.members.length ? '<div class="ui-sub"><b>成員</b>：' + c.members.map(m => U.esc([m.name, m.age ? m.age + '歲' : '', m.exp, m.phone].filter(Boolean).join(' '))).join('；') + '</div>' : '') +
        f('緊急聯絡人', c.emergency && [c.emergency.name, c.emergency.phone].filter(Boolean).join(' ')) +
        f('路線', c.routeText) + (route ? '<div class="ui-sub"><b>計畫路線軌跡</b>：<a href="#" data-act="route" data-z="' + U.esc(route.id) + '">' + U.esc(route.name) + '</a></div>' : '') +
        (c.days && c.days.length ? '<div class="ui-sub"><b>日程</b>：' + c.days.map(d => U.esc(d.date + ' ' + d.camp)).join('；') + '</div>' : '') +
        f('無線電', c.radio) + f('衛星通訊', c.satellite) + f('手機門號', c.phones) +
        f('裝備', [c.tent && '帳篷：' + c.tent, c.sleeping && '睡袋：' + c.sleeping, c.foodDays && '糧食 ' + c.foodDays + ' 天'].filter(Boolean).join('、')) +
        f('衣著顏色（辨識用）', c.clothing) + '</details>' +
        '<div class="ui-btns"><button class="btn small" data-act="hike-copy">複製文字</button>' +
        (ro ? '' : '<button class="btn small" data-act="hike-edit">編輯</button><button class="btn small danger" data-act="plan-del">刪除</button>') + '</div></div>';
    }).join('') : '<div class="empty small">尚無登山計畫</div>';
    html += '</div><div class="sec-title">搜救計畫（依作業期分版）</div><div class="pane-bar">' +
      (ro ? '' : '<button class="btn primary" id="btn-op-new">＋ 新作業期</button>') + '</div><div class="list">';
    html += ops.length ? ops.map(p => {
      const c = Mountain.content(p), asg = c.assignments || [];
      return '<div class="plan-item" data-id="' + U.esc(p.id) + '"><div class="ui-top"><b>第 ' + U.esc(p.version) + ' 作業期</b><span class="hint">' + U.esc(p.updated ? String(p.updated).slice(5, 16) : '') + ' 更新</span></div>' +
        '<div class="ui-sub">' + U.esc(p.periodStart || '？') + ' ～ ' + U.esc(p.periodEnd || '？') + '</div>' +
        (c.note ? '<div class="t-content">' + U.esc(c.note) + '</div>' : '') +
        (asg.length ? asg.map(a => {
          const z = Zones.byId(a.zoneId);
          return '<div class="asg"><b>' + U.esc(z ? z.name : '（分區已刪除）') + '</b> → ' + (a.units && a.units.length ? U.esc(a.units.map(Mountain.unitName).join('、')) : '<i>未指派</i>') +
            '<div class="hint">' + [a.method && '方式：' + a.method, a.muster && '集合 ' + a.muster, a.withdraw && '撤離 ' + a.withdraw].filter(Boolean).map(U.esc).join('　') + '</div></div>';
        }).join('') : '<div class="ui-sub"><i>尚未指派分區</i></div>') +
        '<div class="ui-btns"><button class="btn small" data-act="op-copy">複製文字</button>' +
        (ro ? '' : '<button class="btn small" data-act="op-edit">編輯指派</button><button class="btn small danger" data-act="plan-del">刪除</button>') + '</div></div>';
    }).join('') : '<div class="empty small">尚無搜救計畫。<br>每個作業期（例如一天）建一版，可回顧每日部署。</div>';
    box.innerHTML = html + '</div>';
    const hn = U.$('#btn-hike-new'), on = U.$('#btn-op-new');
    if (hn) hn.onclick = () => Mountain.hikeForm(null);
    if (on) on.onclick = () => Mountain.opForm(null);
  },
  onPlanClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    e.preventDefault();
    const it = b.closest('.plan-item'), p = it && App.state.plans.find(x => x.id === it.dataset.id), a = b.dataset.act;
    if (a === 'route') MapView.focusZone(b.dataset.z);
    else if (!p) return;
    else if (a === 'hike-edit') Mountain.hikeForm(p);
    else if (a === 'op-edit') Mountain.opForm(p);
    else if (a === 'plan-del') Mountain.delPlan(p.id);
    else if (a === 'hike-copy') U.copy(Mountain.hikeText(p));
    else if (a === 'op-copy') U.copy(Mountain.opText(p));
  },
  hikeText(p) {
    const c = Mountain.content(p);
    return ['【登山計畫】' + (c.team || ''), '領隊：' + (c.leader || ''), '成員：' + (c.members || []).map(m => [m.name, m.age && m.age + '歲', m.exp, m.phone].filter(Boolean).join(' ')).join('；'),
      '緊急聯絡人：' + (c.emergency ? [c.emergency.name, c.emergency.phone].filter(Boolean).join(' ') : ''), '路線：' + (c.routeText || ''),
      '日程：' + (c.days || []).map(d => d.date + ' ' + d.camp).join('；'), '預計下山：' + (c.expectedDown || ''),
      '無線電：' + (c.radio || '') + '　衛星：' + (c.satellite || '') + '　門號：' + (c.phones || ''),
      '裝備：帳篷 ' + (c.tent || '') + '／睡袋 ' + (c.sleeping || '') + '／糧食 ' + (c.foodDays || '') + ' 天', '衣著顏色：' + (c.clothing || '')].join('\n');
  },
  opText(p) {
    const c = Mountain.content(p);
    return ['【搜救計畫 第' + p.version + '作業期】' + (p.periodStart || '') + ' ～ ' + (p.periodEnd || ''), c.note || ''].concat((c.assignments || []).map(a => {
      const z = Zones.byId(a.zoneId);
      return (z ? z.name : '（分區已刪除）') + '：' + ((a.units || []).map(Mountain.unitName).join('、') || '未指派') + (a.method ? '（' + a.method + '）' : '') +
        (a.muster ? ' 集合 ' + a.muster : '') + (a.withdraw ? ' 撤離 ' + a.withdraw : '');
    })).filter(Boolean).join('\n');
  },

  /* 登山計畫表單 */
  async hikeForm(p) {
    if (!App.needCase(true)) return;
    const c = p ? Mountain.content(p) : {};
    const routes = Mountain.tracks('計畫路線').map(z => '<option value="' + U.esc(z.id) + '"' + (z.id === c.routeZoneId ? ' selected' : '') + '>' + U.esc(z.name) + '</option>').join('');
    const val = v => U.esc(v == null ? '' : v);
    const html = '<div class="form">' +
      '<div class="row2"><label>隊伍名稱<input id="hk-team" type="text" maxlength="40" value="' + val(c.team) + '"></label><label>領隊<input id="hk-leader" type="text" maxlength="30" value="' + val(c.leader) + '"></label></div>' +
      '<label>成員（一行一人：姓名, 年齡, 電話, 經驗）<textarea id="hk-members" rows="4" spellcheck="false">' + U.esc((c.members || []).map(m => [m.name, m.age, m.phone, m.exp].join(',')).join('\n')) + '</textarea></label>' +
      '<div class="row2"><label>緊急聯絡人<input id="hk-em" type="text" maxlength="30" value="' + val(c.emergency && c.emergency.name) + '"></label><label>聯絡電話<input id="hk-emp" type="text" maxlength="30" value="' + val(c.emergency && c.emergency.phone) + '"></label></div>' +
      '<label>路線描述<textarea id="hk-route" rows="2">' + val(c.routeText) + '</textarea></label>' +
      '<label>對應計畫路線軌跡（先匯入 GPX 並選「計畫路線」）<select id="hk-rz"><option value="">（不指定）</option>' + routes + '</select></label>' +
      '<label>日程（一行一天：日期, 預定營地）<textarea id="hk-days" rows="3" spellcheck="false">' + U.esc((c.days || []).map(d => d.date + ',' + d.camp).join('\n')) + '</textarea></label>' +
      '<label>預計下山時間<input id="hk-down" type="text" maxlength="40" value="' + val(c.expectedDown) + '" placeholder="例：10/05 16:00"></label>' +
      '<div class="row2"><label>無線電頻率<input id="hk-radio" type="text" value="' + val(c.radio) + '"></label><label>衛星通訊器材<input id="hk-sat" type="text" value="' + val(c.satellite) + '"></label></div>' +
      '<label>手機門號<input id="hk-ph" type="text" value="' + val(c.phones) + '"></label>' +
      '<div class="row2"><label>帳篷<input id="hk-tent" type="text" value="' + val(c.tent) + '"></label><label>睡袋<input id="hk-bag" type="text" value="' + val(c.sleeping) + '"></label></div>' +
      '<div class="row2"><label>糧食天數<input id="hk-food" type="text" value="' + val(c.foodDays) + '"></label><label>衣著顏色（搜索辨識用）<input id="hk-cloth" type="text" value="' + val(c.clothing) + '"></label></div>' +
      '<div class="hint">含個人資料（姓名、電話），僅指揮所可見，手機現場版不會收到。</div></div>';
    const v = await U.modal({
      title: p ? '編輯登山計畫' : '新增登山計畫', html: html, wide: true,
      buttons: [{ text: '取消', value: false }, { text: '儲存', cls: 'primary',
        validate: el => { if (!U.$('#hk-team', el).value.trim()) { U.toast('請填寫隊伍名稱', 'err'); return false; } },
        value: el => {
          const lines = id => U.$(id, el).value.split(/\r?\n/).map(l => l.split(/[\t,，]/).map(x => x.trim())).filter(r => r[0]);
          const days = lines('#hk-days').map(r => ({ date: r[0], camp: r[1] || '' }));
          return {
            team: U.$('#hk-team', el).value.trim(), leader: U.$('#hk-leader', el).value.trim(),
            members: lines('#hk-members').map(r => ({ name: r[0], age: r[1] || '', phone: r[2] || '', exp: r[3] || '' })),
            emergency: { name: U.$('#hk-em', el).value.trim(), phone: U.$('#hk-emp', el).value.trim() },
            routeText: U.$('#hk-route', el).value.trim(), routeZoneId: U.$('#hk-rz', el).value, days: days,
            expectedDown: U.$('#hk-down', el).value.trim(), radio: U.$('#hk-radio', el).value.trim(), satellite: U.$('#hk-sat', el).value.trim(),
            phones: U.$('#hk-ph', el).value.trim(), tent: U.$('#hk-tent', el).value.trim(), sleeping: U.$('#hk-bag', el).value.trim(),
            foodDays: U.$('#hk-food', el).value.trim(), clothing: U.$('#hk-cloth', el).value.trim()
          };
        } }]
    });
    if (!v || typeof v !== 'object') return;
    const rec = Object.assign({}, p || {}, {
      id: p ? p.id : U.uid('PL'), type: '登山計畫', content: JSON.stringify(v),
      periodStart: v.days[0] ? v.days[0].date : '', periodEnd: v.expectedDown
    });
    await Mountain.savePlan(rec);
  },

  /* 搜救計畫（作業期）表單：每個搜索分區指派隊伍、搜索方式、集合與撤離時間 */
  async opForm(p) {
    if (!App.needCase(true)) return;
    const prev = p ? Mountain.content(p) : (Mountain.plans('搜救計畫')[0] ? Mountain.content(Mountain.plans('搜救計畫')[0]) : {});
    const segs = Mountain.segs();
    if (!segs.length) { U.toast('請先在地圖畫出「搜索區」分區', 'err'); return; }
    if (!App.state.units.length) { U.toast('請先到「部署」加入單位（隊伍）', 'err'); return; }
    const rows = segs.map(z => {
      const a = (prev.assignments || []).find(x => x.zoneId === z.id) || {};
      return '<div class="asg-row" data-z="' + U.esc(z.id) + '"><div class="asg-name">' + (z.priority ? '<span class="pri">' + U.esc(z.priority) + '</span>' : '') + '<b>' + U.esc(z.name || z.id) + '</b>' +
        '<span class="hint">　' + U.esc(z.status || '未搜') + '</span></div>' +
        '<div class="asg-units">' + App.state.units.map(u => '<label class="chk"><input type="checkbox" value="' + U.esc(u.id) + '"' + ((a.units || []).indexOf(u.id) >= 0 ? ' checked' : '') + '> ' + U.esc(u.name) + '</label>').join('') + '</div>' +
        '<div class="row3"><input type="text" data-f="method" placeholder="搜索方式" value="' + U.esc(a.method || '') + '"><input type="text" data-f="muster" placeholder="集合 HH:mm" value="' + U.esc(a.muster || '') + '"><input type="text" data-f="withdraw" placeholder="撤離 HH:mm" value="' + U.esc(a.withdraw || '') + '"></div></div>';
    }).join('');
    const now = U.now().slice(0, 16);
    const html = '<div class="form"><div class="row2">' +
      '<label>作業期開始<input id="op-s" type="datetime-local" value="' + Mountain.toInput(p ? p.periodStart : now) + '"></label>' +
      '<label>作業期結束<input id="op-e" type="datetime-local" value="' + Mountain.toInput(p ? p.periodEnd : '') + '"></label></div>' +
      '<label>本期重點／備註<textarea id="op-note" rows="2">' + U.esc(p ? (prev.note || '') : '') + '</textarea></label>' +
      '<div class="asg-list">' + rows + '</div>' + (p ? '' : '<div class="hint">已帶入上一期的指派，請依本期調整。</div>') + '</div>';
    const v = await U.modal({
      title: p ? '編輯第 ' + p.version + ' 作業期' : '新作業期', html: html, wide: true,
      buttons: [{ text: '取消', value: false }, { text: '儲存', cls: 'primary',
        value: el => ({
          start: Mountain.fromInput(U.$('#op-s', el).value), end: Mountain.fromInput(U.$('#op-e', el).value), note: U.$('#op-note', el).value.trim(),
          assignments: U.$$('.asg-row', el).map(r => ({
            zoneId: r.dataset.z, units: U.$$('input[type=checkbox]:checked', r).map(x => x.value),
            method: U.$('[data-f=method]', r).value.trim(), muster: U.$('[data-f=muster]', r).value.trim(), withdraw: U.$('[data-f=withdraw]', r).value.trim()
          })).filter(a => a.units.length || a.method)
        }) }]
    });
    if (!v || typeof v !== 'object') return;
    const rec = Object.assign({}, p || {}, {
      id: p ? p.id : U.uid('PL'), type: '搜救計畫', periodStart: v.start, periodEnd: v.end,
      content: JSON.stringify({ note: v.note, assignments: v.assignments })
    });
    if (!p) rec.version = String(Mountain.plans('搜救計畫').reduce((m, x) => Math.max(m, Number(x.version) || 0), 0) + 1);
    await Mountain.savePlan(rec);
  }
};
