/* 傷患管制：地圖標記（單人色點／群體圓餅）、清單、群體拆分、後送流程、匯出 */
const Casualties = {
  filter: 'open',   // open（尚未到院）| done | all

  byId(id) { return App.state.casualties.find(c => c.id === id); },
  num(v) { return parseInt(v, 10) || 0; },
  ll(c) {
    const p = String(c.coord || '').split(','), lat = parseFloat(p[0]), lng = parseFloat(p[1]);
    return U.validLatLng(lat, lng) && p.length === 2 ? { lat: lat, lng: lng } : null;
  },
  /* 群體尚未拆分的剩餘人數（各色） */
  remaining(g) {
    const kids = App.state.casualties.filter(x => x.parentId === g.id);
    const r = {}; let total = 0;
    CFG.TRIAGE.forEach(t => {
      r[t.id] = Math.max(0, Casualties.num(g[t.field]) - kids.filter(k => k.triage === t.id).length);
      total += r[t.id];
    });
    r.total = total; return r;
  },
  /* 這筆代表的各色人數 { 紅, 黃, 綠, 黑, total } */
  persons(c) {
    if (c.mode === '群體') return Casualties.remaining(c);
    const r = { 紅: 0, 黃: 0, 綠: 0, 黑: 0, total: 1 }; r[c.triage] = 1; return r;
  },
  label(c) {
    if (c.mode === '群體') {
      const rem = Casualties.remaining(c);
      return '多人：' + CFG.TRIAGE.filter(t => Casualties.num(c[t.field]) > 0).map(t => t.id + c[t.field]).join(' ') +
        (rem.total < CFG.TRIAGE.reduce((s, t) => s + Casualties.num(c[t.field]), 0) ? '（未拆分剩 ' + rem.total + ' 人）' : '');
    }
    return '單人：檢傷' + c.triage;
  },
  tally() {
    const t = { 紅: 0, 黃: 0, 綠: 0, 黑: 0, total: 0, arrived: 0, moving: 0 };
    App.state.casualties.forEach(c => {
      const p = Casualties.persons(c);
      CFG.TRIAGE.forEach(x => { t[x.id] += p[x.id]; });
      t.total += p.total;
      if (c.status === '已到院') t.arrived += p.total; else if (c.status === '後送中') t.moving += p.total;
    });
    return t;
  },

  bind() {
    U.$('#btn-new-cas').addEventListener('click', () => Casualties.openForm(null));
    U.$('#btn-cas-csv').addEventListener('click', Casualties.exportCsv);
    U.$('#cas-filter').addEventListener('change', e => { Casualties.filter = e.target.value; Casualties.renderList(); });
    U.$('#cas-list').addEventListener('click', Casualties.onClick);
  },

  renderAll() { Casualties.renderSummary(); Casualties.renderList(); Casualties.drawMap(); },

  renderSummary() {
    const t = Casualties.tally(), box = U.$('#cas-summary'); if (!box) return;
    box.innerHTML = '<div class="tri-row">' + CFG.TRIAGE.map(x =>
      '<div class="tri-box" style="background:' + x.color + '"><b>' + t[x.id] + '</b><span>' + x.id + '</span></div>').join('') + '</div>' +
      '<div class="hint">共 ' + t.total + ' 人・後送中 ' + t.moving + ' 人・已到院 ' + t.arrived + ' 人</div>';
    const b = U.$('#badge-cas'); if (b) { const open = t.total - t.arrived; b.textContent = open; b.hidden = !open; }
  },

  renderList() {
    const box = U.$('#cas-list'); if (!box) return;
    const ro = App.state.readonly, sev = ['紅', '黃', '綠', '黑'];
    const rows = App.state.casualties.filter(c => {
      if (c.mode === '群體' && Casualties.remaining(c).total === 0) return Casualties.filter === 'all';   // 已全部拆分的群體只在「全部」顯示
      return Casualties.filter === 'all' || (Casualties.filter === 'done') === (c.status === '已到院');
    }).sort((a, b) => ((a.status === '已到院') - (b.status === '已到院')) || (sev.indexOf(a.triage || '紅') - sev.indexOf(b.triage || '紅')) || (a.time < b.time ? 1 : -1));
    if (!rows.length) { box.innerHTML = '<div class="empty">' + (App.state.casualties.length ? '沒有符合條件的傷患' : '沒有傷患紀錄。<br>現場人員用手機回報，或按「＋ 新增傷患」。') + '</div>'; return; }
    box.innerHTML = rows.map(c => {
      const grp = c.mode === '群體', rem = grp ? Casualties.remaining(c) : null;
      const chip = grp ? '<span class="cas-chip pie">' + Casualties.pieSvg(rem, 34) + '</span>'
        : '<span class="cas-chip" style="background:' + CFG.triageColor(c.triage) + '">' + U.esc(c.triage) + '</span>';
      const tr = CFG.TRANSPORT.map(s => '<button class="st-btn' + (c.status === s.id ? ' on' : '') + '" style="--c:#455a64" data-act="tr" data-s="' + s.id + '"' + (ro ? ' disabled' : '') + '>' + s.id + '</button>').join('');
      const times = CFG.TRANSPORT.filter(s => c[s.time]).map(s => '<span class="tl"><i style="background:#455a64"></i>' + s.id + ' ' + Tasks.hm(c[s.time]) + '</span>').join('');
      const task = c.taskId && Tasks.byId(c.taskId);
      return '<div class="cas-item' + (c.status === '已到院' ? ' done' : '') + '" data-id="' + U.esc(c.id) + '">' +
        '<div class="cas-top">' + chip + '<div class="cas-main"><b>' + U.esc(Casualties.label(c)) + '</b>' +
        (c.parentId ? '<span class="tag tmp">自群體拆出</span>' : '') +
        '<div class="ui-sub">' + (c.quick ? U.esc(c.quick) + '・' : '') + U.esc(c.reporter || '指揮所') + '・' + Tasks.hm(c.time) + (task ? '・' + U.esc(task.title) : '') + '</div></div></div>' +
        (c.desc ? '<div class="t-content">' + U.esc(c.desc) + '</div>' : '') +
        (c.vehicle || c.hospital ? '<div class="ui-sub">' + (c.vehicle ? '🚑 ' + U.esc(c.vehicle) : '') + (c.hospital ? '　🏥 ' + U.esc(c.hospital) : '') + '</div>' : '') +
        '<div class="t-times">' + times + '</div>' +
        '<div class="st-row">' + tr + '</div>' +
        '<div class="ui-btns">' +
        (Casualties.ll(c) ? '<button class="btn small" data-act="focus">📍 定位</button>' : '<span class="hint">尚無位置</span>') +
        (splitIds(c.photos).length ? '<button class="btn small" data-act="photo">📷 ' + splitIds(c.photos).length + '</button>' : '') +
        (ro ? '' : '<button class="btn small" data-act="place">' + (Casualties.ll(c) ? '改位置' : '設位置') + '</button>' +
          (grp && rem.total > 0 ? '<button class="btn small primary" data-act="split">拆分</button>' : '') +
          '<button class="btn small" data-act="edit">編輯</button><button class="btn small danger" data-act="del">刪除</button>') +
        '</div></div>';
    }).join('');
  },

  onClick(e) {
    const it = e.target.closest('.cas-item'), btn = e.target.closest('[data-act]');
    if (!it) return;
    const id = it.dataset.id;
    if (!btn) { Casualties.highlight(id, true); return; }
    const a = btn.dataset.act;
    if (a === 'tr') Casualties.setTransport(id, btn.dataset.s);
    else if (a === 'focus') MapView.focusCasualty(id);
    else if (a === 'photo') Tasks.viewPhotos(Casualties.byId(id));
    else if (a === 'place') Casualties.place(id);
    else if (a === 'split') Casualties.splitDialog(id);
    else if (a === 'edit') Casualties.openForm(Casualties.byId(id));
    else if (a === 'del') Casualties.remove(id);
  },
  highlight(id, fromList) {
    if (!fromList) { App.switchTab('cas'); }
    U.$$('.cas-item').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
    if (!fromList) { const el = U.$('.cas-item[data-id="' + id + '"]'); if (el) el.scrollIntoView({ block: 'nearest' }); }
  },

  /* ---------- 圓餅圖與地圖標記 ---------- */
  pieSvg(counts, size) {
    const total = CFG.TRIAGE.reduce((s, t) => s + (counts[t.id] || 0), 0);
    if (!total) return '';
    const r = size / 2 - 2, cx = size / 2, cy = size / 2;
    const parts = CFG.TRIAGE.filter(t => counts[t.id] > 0);
    let body = '';
    if (parts.length === 1) body = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + parts[0].color + '"/>';
    else {
      let a0 = -Math.PI / 2;
      parts.forEach(t => {
        const a1 = a0 + 2 * Math.PI * counts[t.id] / total;
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        body += '<path d="M' + cx + ' ' + cy + ' L' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + ((a1 - a0) > Math.PI ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' Z" fill="' + t.color + '"/>';
        a0 = a1;
      });
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + body +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.5).toFixed(1) + '" fill="#fff"/>' +
      '<text x="' + cx + '" y="' + (cy + size * 0.12) + '" text-anchor="middle" font-size="' + (size * 0.36).toFixed(0) + '" font-weight="700" fill="#222">' + total + '</text></svg>';
  },
  drawMap() {
    const g = MapView.casGroup; if (!g) return;
    g.clearLayers(); MapView.casMarkers = {};
    App.state.casualties.forEach(c => {
      const ll = Casualties.ll(c); if (!ll) return;
      let icon;
      if (c.mode === '群體') {
        const rem = Casualties.remaining(c); if (!rem.total) return;
        icon = L.divIcon({ className: 'cas-wrap', html: '<div class="cas-pie' + (c.status === '已到院' ? ' done' : '') + '">' + Casualties.pieSvg(rem, 46) + '</div>', iconSize: [46, 46], iconAnchor: [23, 23] });
      } else {
        const glyph = c.status === '已到院' ? '✓' : c.status === '後送中' ? '➜' : '';
        icon = L.divIcon({ className: 'cas-wrap', html: '<div class="cas-dot' + (c.status === '已到院' ? ' done' : '') + '" style="background:' + CFG.triageColor(c.triage) + '">' + glyph + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] });
      }
      const mk = L.marker([ll.lat, ll.lng], { icon: icon, draggable: !App.state.readonly, zIndexOffset: 900 });
      mk.bindTooltip('<b>' + U.esc(Casualties.label(c)) + '</b><br>' + U.esc(c.status) + (c.quick ? '・' + U.esc(c.quick) : '') + (c.hospital ? '<br>送往 ' + U.esc(c.hospital) : ''), { direction: 'top', offset: [0, -12] });
      mk.on('click', ev => { L.DomEvent.stopPropagation(ev); if (MapView._pickCb) MapView.firePick(ev.latlng); else Casualties.highlight(c.id); });
      mk.on('dragend', () => { const p = mk.getLatLng(); Casualties.save(Object.assign({}, c, { coord: p.lat.toFixed(6) + ',' + p.lng.toFixed(6) }), true); });
      g.addLayer(mk); MapView.casMarkers[c.id] = mk;
    });
  },

  /* ---------- 存檔 ---------- */
  async save(c, quiet) {
    const r = await Deploy.w('saveCasualty', { casualty: c }, () => {
      const i = App.state.casualties.findIndex(x => x.id === c.id);
      if (i >= 0) App.state.casualties[i] = c; else App.state.casualties.push(c);
    });
    if (r) {
      if (r.casualty) { const i = App.state.casualties.findIndex(x => x.id === c.id); if (i >= 0) App.state.casualties[i] = r.casualty; }
      Casualties.renderAll(); if (!quiet) U.toast('傷患資料已儲存', 'ok');
    }
    return r;
  },

  place(id) {
    const c = Casualties.byId(id); if (!c) return;
    MapView.pick(ll => Casualties.save(Object.assign({}, c, { coord: ll.lat.toFixed(6) + ',' + ll.lng.toFixed(6) }), true), '請在地圖上點選傷患位置（按 Esc 取消）');
  },

  async remove(id) {
    const c = Casualties.byId(id); if (!c) return;
    if (!await U.confirm('確定刪除這筆傷患紀錄嗎？\n' + Casualties.label(c) + '\n（事件日誌會留下紀錄）', '刪除', true)) return;
    await Deploy.w('deleteCasualty', { casualtyId: id }, () => {
      App.state.casualties = App.state.casualties.filter(x => x.id !== id);
      App.state.casualties.forEach(x => { if (x.parentId === id) x.parentId = ''; });
    });
    Casualties.renderAll();
  },

  /* ---------- 新增／編輯 ---------- */
  async openForm(c) {
    if (!App.needCase(true)) return;
    const isNew = !c, x = c || { mode: '單人', triage: '', red: 0, yellow: 0, green: 0, black: 0, quick: '', desc: '', taskId: '' };
    const tasks = App.state.tasks.map(t => '<option value="' + U.esc(t.id) + '"' + (t.id === x.taskId ? ' selected' : '') + '>' + U.esc(t.title) + '</option>').join('');
    const quicks = CFG.CASUALTY_QUICKS.map(q => '<button type="button" class="chip" data-q="' + U.esc(q) + '">' + U.esc(q) + '</button>').join('');
    const tri = CFG.TRIAGE.map(t => '<label class="tri-pick" style="--c:' + t.color + '"><input type="radio" name="cf-tri" value="' + t.id + '"' + (x.triage === t.id ? ' checked' : '') + '><span>' + t.id + '<small>' + t.text + '</small></span></label>').join('');
    const cnt = CFG.TRIAGE.map(t => '<label class="cnt" style="--c:' + t.color + '">' + t.id + '<input type="number" min="0" max="999" data-f="' + t.field + '" value="' + Casualties.num(x[t.field]) + '"></label>').join('');
    const html = '<div class="form">' +
      '<div class="seg" style="margin:0"><label class="seg-btn' + (x.mode !== '群體' ? ' active' : '') + '"><input type="radio" name="cf-mode" value="單人" hidden' + (x.mode !== '群體' ? ' checked' : '') + '>單人</label>' +
      '<label class="seg-btn' + (x.mode === '群體' ? ' active' : '') + '"><input type="radio" name="cf-mode" value="群體" hidden' + (x.mode === '群體' ? ' checked' : '') + '>多人（依檢傷填人數）</label></div>' +
      '<div id="cf-single"><div class="lbl">檢傷等級</div><div class="tri-picks">' + tri + '</div>' +
      '<div class="lbl" style="margin-top:8px">狀況快選</div><div class="chips">' + quicks + '</div>' +
      '<label>已選狀況<input id="cf-quick" type="text" maxlength="60" value="' + U.esc(x.quick) + '"></label></div>' +
      '<div id="cf-group" hidden><div class="lbl">各檢傷等級人數</div><div class="cnt-row">' + cnt + '</div></div>' +
      '<label>簡述<textarea id="cf-desc" rows="3" maxlength="300">' + U.esc(x.desc) + '</textarea></label>' +
      '<label>對應任務（選填）<select id="cf-task"><option value="">（無）</option>' + tasks + '</select></label>' +
      (isNew ? '<label class="chk"><input id="cf-pick" type="checkbox" checked> 儲存後在地圖上點選傷患位置</label>' : '') + '</div>';
    const v = await U.modal({
      title: isNew ? '新增傷患' : '編輯傷患', html: html,
      onOpen: el => {
        const sync = () => {
          const g = U.$('input[name=cf-mode]:checked', el).value === '群體';
          U.$('#cf-single', el).hidden = g; U.$('#cf-group', el).hidden = !g;
          U.$$('.seg-btn', el).forEach(b => b.classList.toggle('active', U.$('input', b).checked));
        };
        U.$$('input[name=cf-mode]', el).forEach(r => r.addEventListener('change', sync)); sync();
        U.$$('.chip[data-q]', el).forEach(b => b.addEventListener('click', () => {
          const inp = U.$('#cf-quick', el), cur = inp.value.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
          if (cur.indexOf(b.dataset.q) < 0) cur.push(b.dataset.q);
          inp.value = cur.join('、');
        }));
      },
      buttons: [{ text: '取消', value: false }, {
        text: '儲存', cls: 'primary',
        validate: el => {
          const g = U.$('input[name=cf-mode]:checked', el).value === '群體';
          if (!g && !U.$('input[name=cf-tri]:checked', el)) { U.toast('請選擇檢傷等級', 'err'); return false; }
          if (g && !U.$$('input[data-f]', el).some(i => Casualties.num(i.value) > 0)) { U.toast('請至少填 1 人', 'err'); return false; }
        },
        value: el => {
          const g = U.$('input[name=cf-mode]:checked', el).value === '群體', r = { mode: g ? '群體' : '單人' };
          if (g) U.$$('input[data-f]', el).forEach(i => { r[i.dataset.f] = Casualties.num(i.value); });
          else { r.triage = U.$('input[name=cf-tri]:checked', el).value; r.quick = U.$('#cf-quick', el).value.trim(); }
          r.desc = U.$('#cf-desc', el).value.trim(); r.taskId = U.$('#cf-task', el).value;
          r.pick = !!(U.$('#cf-pick', el) && U.$('#cf-pick', el).checked);
          return r;
        }
      }]
    });
    if (!v || typeof v !== 'object') return;
    const pick = v.pick; delete v.pick;
    if (v.mode === '群體' && !isNew && c.mode === '群體') {
      // 縮減人數時不能少於已拆出的人數
      const bad = CFG.TRIAGE.find(t => Casualties.num(v[t.field]) < App.state.casualties.filter(k => k.parentId === c.id && k.triage === t.id).length);
      if (bad) { U.toast(bad.id + '色人數不能少於已拆出的人數', 'err'); return; }
    }
    const rec = Object.assign({}, c || {}, v, {
      id: c ? c.id : U.uid('C'), reporter: c ? c.reporter : '指揮所', status: c ? c.status : '發現',
      coord: c ? c.coord : '', photos: c ? c.photos : '', parentId: c ? c.parentId : '', vehicle: c ? c.vehicle : '', hospital: c ? c.hospital : ''
    });
    if (v.mode === '單人') CFG.TRIAGE.forEach(t => { rec[t.field] = 0; }); else rec.triage = '';
    if (isNew) { rec.tFound = U.now(); rec.time = U.now(); }
    const r = await Casualties.save(rec);
    if (r && isNew && pick) Casualties.place(rec.id);
  },

  /* ---------- 後送流程：發現 → 處置 → 後送中 → 已到院 ---------- */
  async setTransport(id, status) {
    const c = Casualties.byId(id); if (!c || c.status === status || !App.needCase(true)) return;
    let extra = {};
    if (status === '後送中' || status === '已到院') {
      const veh = [];
      App.state.units.forEach(u => String(u.vehicles || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean).forEach(v => { const n = u.name + ' ' + v; if (veh.indexOf(n) < 0) veh.push(n); }));
      const hos = []; App.state.casualties.forEach(x => { if (x.hospital && hos.indexOf(x.hospital) < 0) hos.push(x.hospital); });
      const html = '<div class="form"><div class="hint">' + U.esc(Casualties.label(c)) + ' → <b>' + status + '</b></div>' +
        '<label>後送車輛<input id="tr-veh" type="text" list="tr-vl" maxlength="40" value="' + U.esc(c.vehicle) + '" placeholder="例：成功分隊 救護車"><datalist id="tr-vl">' + veh.map(v => '<option value="' + U.esc(v) + '">').join('') + '</datalist></label>' +
        '<label>送往醫院<input id="tr-hos" type="text" list="tr-hl" maxlength="40" value="' + U.esc(c.hospital) + '"><datalist id="tr-hl">' + hos.map(v => '<option value="' + U.esc(v) + '">').join('') + '</datalist></label></div>';
      const v = await U.modal({ title: '後送資訊', html: html, buttons: [{ text: '取消', value: false }, { text: '確定', cls: 'primary', value: el => ({ vehicle: U.$('#tr-veh', el).value.trim(), hospital: U.$('#tr-hos', el).value.trim() }) }] });
      if (!v || typeof v !== 'object') return;
      extra = v;
    }
    const tf = CFG.TRANSPORT.find(s => s.id === status).time;
    await Deploy.w('updateTransport', Object.assign({ casualtyId: id, status: status }, extra), () => { c.status = status; c[tf] = U.now(); Object.assign(c, extra); });
    Casualties.renderAll();
  },

  /* ---------- 群體拆分（自動核對人數） ---------- */
  async splitDialog(id) {
    const g = Casualties.byId(id); if (!g) return;
    const rem = Casualties.remaining(g);
    const html = '<div class="form"><div class="hint">群體共 ' + CFG.TRIAGE.map(t => t.id + g[t.field]).join(' ') + '。填入要拆出成個別傷患的人數（不可超過剩餘）。</div>' +
      '<div class="cnt-row">' + CFG.TRIAGE.map(t => '<label class="cnt" style="--c:' + t.color + '">' + t.id + '（剩 ' + rem[t.id] + '）<input type="number" min="0" max="' + rem[t.id] + '" data-t="' + t.id + '" value="0"' + (rem[t.id] ? '' : ' disabled') + '></label>').join('') + '</div>' +
      '<div class="hint">拆出的個別傷患會繼承位置與後送狀態，之後可各自編輯與後送。</div></div>';
    const v = await U.modal({
      title: '拆分群體', html: html,
      buttons: [{ text: '取消', value: false }, {
        text: '拆分', cls: 'primary',
        validate: el => {
          const inputs = U.$$('input[data-t]', el);
          if (!inputs.some(i => Casualties.num(i.value) > 0)) { U.toast('請輸入要拆出的人數', 'err'); return false; }
          if (inputs.some(i => Casualties.num(i.value) > Casualties.num(i.max))) { U.toast('超過剩餘人數', 'err'); return false; }
        },
        value: el => { const o = {}; U.$$('input[data-t]', el).forEach(i => { o[i.dataset.t] = Casualties.num(i.value); }); return o; }
      }]
    });
    if (!v || typeof v !== 'object') return;
    const r = await Deploy.w('splitCasualty', { groupId: id, counts: v });
    if (r && r.casualties) {
      r.casualties.forEach(k => App.state.casualties.push(k));
      Casualties.renderAll();
      const left = Casualties.remaining(g).total;
      U.toast('已拆出 ' + r.casualties.length + ' 人' + (left ? '，群體剩 ' + left + ' 人未拆分' : '，人數核對完成'), 'ok');
    }
  },

  /* ---------- 匯出傷患表 ---------- */
  exportCsv() {
    if (!App.needCase()) return;
    if (!App.state.casualties.length) { U.toast('沒有傷患資料可匯出', 'err'); return; }
    const head = ['編號', '模式', '檢傷', '紅', '黃', '綠', '黑', '自群體拆出', '狀況', '描述', '回報者', '位置', '後送狀態', '後送車輛', '送往醫院', '發現時間', '處置時間', '後送時間', '到院時間'];
    const rows = App.state.casualties.map(c => [c.id, c.mode, c.triage, c.red, c.yellow, c.green, c.black, c.parentId, c.quick, c.desc, c.reporter, c.coord, c.status, c.vehicle, c.hospital, c.tFound, c.tTreated, c.tTransporting, c.tArrived]);
    const csv = [head].concat(rows).map(r => r.map(x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    U.download(U.safeFile(App.state.cur.id + '_傷患表') + '.csv', '﻿' + csv, 'text/csv');
  }
};
