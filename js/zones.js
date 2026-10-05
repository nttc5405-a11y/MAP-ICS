/* 區域：資料建立、清單、屬性編輯、存檔 */
const Zones = {
  filter: '',

  /* ---------- 資料 ---------- */
  geometryOf(z) {
    if (z._g) return z._g;
    try { z._g = JSON.parse(z.geojson); } catch (e) { z._g = null; }
    return z._g;
  },
  list() { return App.state.zones; },
  byId(id) { return App.state.zones.find(z => z.id === id); },

  /* ---------- 階層（A區 › A1 作業區） ---------- */
  parentOf(z) { return z && z.parentId ? Zones.byId(z.parentId) : null; },
  ancestors(z) { const a = []; let p = Zones.parentOf(z), n = 0; while (p && n++ < 10) { a.push(p); p = Zones.parentOf(p); } return a; },   // 由近到遠
  childrenOf(id) { return App.state.zones.filter(x => x.parentId === id); },
  descendants(id) { const out = []; const walk = i => Zones.childrenOf(i).forEach(c => { if (out.indexOf(c) < 0) { out.push(c); walk(c.id); } }); walk(id); return out; },
  pathName(z) { return Zones.ancestors(z).reverse().concat([z]).map(x => x.name || x.category).join(' › '); },
  /* 自己加上所有上層區域的危險因子（去除重複） */
  hazardOf(z) {
    const out = [];
    [z].concat(Zones.ancestors(z)).forEach(x => String(x.hazard || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean).forEach(h => { if (out.indexOf(h) < 0) out.push(h); }));
    return out.join('、');
  },
  /* 樹狀排序：上層在前、子區域接在後面，附縮排層級 d */
  ordered(list) {
    const ids = {}; list.forEach(z => { ids[z.id] = 1; });
    const kids = {};
    list.forEach(z => { const k = (z.parentId && ids[z.parentId] && z.parentId !== z.id) ? z.parentId : ''; (kids[k] = kids[k] || []).push(z); });
    const out = [], seen = {};
    const walk = (k, d) => (kids[k] || []).forEach(z => { if (seen[z.id]) return; seen[z.id] = 1; out.push({ z: z, d: d }); walk(z.id, d + 1); });
    walk('', 0);
    list.forEach(z => { if (!seen[z.id]) out.push({ z: z, d: 0 }); });   // 保險：資料有循環時也不會漏掉
    return out;
  },
  areaOf(z) {
    const g = Zones.geometryOf(z); if (!g) return 0;
    if (z.geomType === 'Circle') { const r = Number(z.radius) || 0; return Math.PI * r * r; }
    return g.type === 'Polygon' ? U.ringArea(g.coordinates[0]) : 0;
  },
  contains(z, lng, lat) {
    const g = Zones.geometryOf(z); if (!g) return false;
    if (z.geomType === 'Circle') return U.haversine([lng, lat], g.coordinates) <= (Number(z.radius) || 0);
    if (g.type !== 'Polygon') return false;
    const r = g.coordinates[0]; let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > lat) !== (r[j][1] > lat) && lng < (r[j][0] - r[i][0]) * (lat - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    }
    return c;
  },
  /* 畫新區域時，找出「包住它、面積最小」的區域當作建議的上層 */
  suggestParent(shape, exceptId) {
    const g = shape.geometry; let pt = null, area = 0;
    if (g.type === 'Point') { pt = g.coordinates; area = shape.geomType === 'Circle' ? Math.PI * Math.pow(Number(shape.radius) || 0, 2) : 0; }
    else if (g.type === 'LineString') pt = g.coordinates[Math.floor(g.coordinates.length / 2)];
    else if (g.type === 'Polygon') {
      const r = g.coordinates[0].slice(0, -1);
      pt = [r.reduce((s, c) => s + c[0], 0) / r.length, r.reduce((s, c) => s + c[1], 0) / r.length];
      area = U.ringArea(g.coordinates[0]);
    }
    if (!pt) return '';
    const cands = App.state.zones.filter(z => z.id !== exceptId && (z.geomType === 'Polygon' || z.geomType === 'Circle') && Zones.areaOf(z) > area && Zones.contains(z, pt[0], pt[1]));
    cands.sort((a, b) => Zones.areaOf(a) - Zones.areaOf(b));
    return cands.length ? cands[0].id : '';
  },

  /* 由幾何建立一筆新區域（尚未送後端）。shape: {name, category, geomType, geometry, radius} */
  newZone(shape) {
    const cat = shape.category || '其他';
    const z = {
      id: U.uid('Z'), name: shape.name || '', category: cat, color: CFG.catColor(cat),
      geomType: shape.geomType, radius: shape.radius || '', geojson: JSON.stringify(shape.geometry),
      measure: '', hazard: '', note: '', created: U.now(), updated: U.now(),
      priority: '', status: '', terrain: '', quality: '', teamId: '', segmentId: '', parentId: ''
    };
    z.measure = U.measure(z.geomType, shape.geometry, z.radius);
    return z;
  },
  /* 只換幾何，其他屬性不動；回傳 false 表示太大存不下 */
  applyGeometry(z, shape) {
    const fit = U.fitGeometry(shape.geometry, CFG.GEOJSON_LIMIT);
    if (!fit) return false;
    z.geojson = fit.json; z._g = fit.geom;
    z.geomType = shape.geomType;
    z.radius = shape.radius || '';
    z.measure = U.measure(z.geomType, fit.geom, z.radius);
    return true;
  },
  clean(z) { const c = Object.assign({}, z); delete c._g; return c; },

  /* ---------- 地圖事件進入點 ---------- */
  /* 使用者在地圖畫完一個圖形 */
  async onDrawn(shape) {
    const fit = U.fitGeometry(shape.geometry, CFG.GEOJSON_LIMIT);
    if (!fit) { U.toast('這個圖形的節點太多，超過儲存上限，無法建立', 'err'); return; }
    shape.geometry = fit.geom;
    const z = Zones.newZone(shape);
    z.name = Zones.autoName(z);
    z.parentId = Zones.suggestParent(shape, z.id);   // 畫在某區域裡面，就預設放在該區域底下（可在對話框更改）
    const ok = await Zones.openEditor(z, true);
    if (!ok) return;
    await Zones.persist(z);
  },
  /* 使用者在地圖上拖曳或改頂點 */
  async onGeometryEdited(id, shape) {
    const z = Zones.byId(id);
    if (!z) return;
    if (!Zones.applyGeometry(z, shape)) {
      U.toast('修改後的節點太多，超過儲存上限，已還原', 'err');
      MapView.renderZones(); return;
    }
    await Zones.persist(z, true);
  },
  async onRemovedOnMap(id) {
    const z = Zones.byId(id);
    if (!z) return;
    const ok = await U.confirm('確定要刪除區域「' + (z.name || z.category) + '」嗎？' + Zones.kidNote(id) + '\n刪除後無法復原（事件日誌會留下紀錄）。', '刪除', true);
    if (!ok) { MapView.renderZones(); return; }
    await Zones.removeConfirmed(id);
  },

  kidNote(id) { const n = Zones.childrenOf(id).length; return n ? '\n它底下有 ' + n + ' 個子區域，會改掛到上一層（不會被刪除）。' : ''; },
  autoName(z) {
    const same = App.state.zones.filter(x => x.category === z.category).length + 1;
    return z.category + ' ' + same;
  },

  /* ---------- 存檔 ---------- */
  async persist(z, quiet) {
    try {
      const r = await App.run(() => Api.call('saveZone', { caseId: App.state.cur.id, zone: Zones.clean(z) }));
      const saved = Object.assign({}, z, r.zone || {});
      const i = App.state.zones.findIndex(x => x.id === z.id);
      delete saved._g;
      if (i >= 0) App.state.zones[i] = saved; else App.state.zones.push(saved);
      App.state.version = r.version;
      Zones.renderList(); MapView.renderZones();
      if (!quiet) U.toast('已儲存：' + (z.name || z.category), 'ok');
    } catch (e) {
      U.toast('儲存失敗：' + e.message, 'err');
      await App.reloadCase(true);   // 以後端為準，避免畫面與資料不一致
    }
  },
  async removeConfirmed(id) {
    try {
      const zone = Zones.byId(id), kids = Zones.childrenOf(id);
      if (kids.length) {   // 子區域不跟著刪，改掛到被刪區域的上一層
        const moved = kids.map(k => Object.assign(Zones.clean(k), { parentId: zone && zone.parentId ? zone.parentId : '' }));
        await App.run(() => Api.call('saveZones', { caseId: App.state.cur.id, zones: moved, note: '刪除上層區域，子區域改掛上一層' }));
        kids.forEach(k => { k.parentId = zone && zone.parentId ? zone.parentId : ''; });
      }
      const r = await App.run(() => Api.call('deleteZone', { caseId: App.state.cur.id, zoneId: id }));
      App.state.zones = App.state.zones.filter(z => z.id !== id);
      App.state.version = r.version;
      Zones.renderList(); MapView.renderZones();
      U.toast('已刪除區域', 'ok');
    } catch (e) {
      U.toast('刪除失敗：' + e.message, 'err');
      await App.reloadCase(true);
    }
  },
  async remove(id) {
    const z = Zones.byId(id);
    if (!z) return;
    if (await U.confirm('確定要刪除區域「' + (z.name || z.category) + '」嗎？' + Zones.kidNote(id) + '\n刪除後無法復原（事件日誌會留下紀錄）。', '刪除', true)) {
      await Zones.removeConfirmed(id);
    }
  },

  /* ---------- 屬性對話框 ---------- */
  /* 回傳 Promise<boolean>：true 表示使用者按了儲存（z 已被就地更新） */
  openEditor(z, isNew) {
    const catOpts = CFG.ZONE_CATS.map(c =>
      '<option value="' + U.esc(c.id) + '"' + (c.id === z.category ? ' selected' : '') + '>' + U.esc(c.id) + '</option>').join('');
    // 危險因子快選：該案件類型專屬的在前面，後面接通用清單（去除重複）
    const ctype = App.state.cur && App.state.cur.type, hz = [];
    ((CFG.HAZARDS_BY_TYPE && CFG.HAZARDS_BY_TYPE[ctype]) || []).concat(CFG.HAZARDS).forEach(h => { if (hz.indexOf(h) < 0) hz.push(h); });
    const chips = hz.map(h => '<button type="button" class="chip" data-h="' + U.esc(h) + '">' + U.esc(h) + '</button>').join('');
    const bad = {}; bad[z.id] = 1; Zones.descendants(z.id).forEach(x => { bad[x.id] = 1; });   // 不能選自己或自己的子孫當上層（會變成循環）
    const parentOpts = Zones.ordered(App.state.zones.filter(x => !bad[x.id])).map(o => '<option value="' + U.esc(o.z.id) + '"' + (o.z.id === z.parentId ? ' selected' : '') + '>' +
      U.esc('　'.repeat(o.d) + (o.d ? '└ ' : '') + (o.z.name || o.z.category)) + '</option>').join('');
    const geomName = CFG.GEOM_NAMES[z.geomType] || z.geomType;
    const html =
      '<div class="form">' +
      '<label>名稱<input id="ze-name" type="text" maxlength="60" value="' + U.esc(z.name) + '"></label>' +
      '<label>上層區域（例：A1 作業區的上層是 A 區）<select id="ze-parent"><option value="">（無，最上層）</option>' + parentOpts + '</select></label>' +
      '<div class="row2"><label>類別<select id="ze-cat">' + catOpts + '</select></label>' +
      '<label>顏色<input id="ze-color" type="color" value="' + U.esc(z.color || '#757575') + '"></label></div>' +
      '<label>危險因子<input id="ze-hazard" type="text" maxlength="200" value="' + U.esc(z.hazard) + '" placeholder="例：落石、濕滑（可點下方快選）"></label>' +
      '<div class="chips">' + chips + '</div>' +
      '<label>備註<textarea id="ze-note" rows="3" maxlength="500">' + U.esc(z.note) + '</textarea></label>' +
      '<div id="ze-seg" class="subform" hidden><div class="lbl">搜索分區</div>' +
      '<div class="row2"><label>優先序（1 最優先）<input id="ze-pri" type="number" min="1" max="99" value="' + U.esc(z.priority) + '"></label>' +
      '<label>搜索狀態<select id="ze-st">' + CFG.SEARCH_STATUS.map(s => '<option' + (s === (z.status || '未搜') ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label></div>' +
      '<label>地形說明<input id="ze-ter" type="text" maxlength="200" value="' + U.esc(z.terrain) + '" placeholder="例：陡坡、密林、溪溝"></label>' +
      '<label>搜索品質說明<input id="ze-qua" type="text" maxlength="200" value="' + U.esc(z.quality) + '" placeholder="例：已目視搜索，視線不佳"></label></div>' +
      '<div id="ze-trk" class="subform" hidden><div class="lbl">軌跡關聯</div>' +
      '<div class="row2"><label>隊伍（單位）<select id="ze-team"><option value="">（不指定）</option>' + App.state.units.map(u => '<option value="' + U.esc(u.id) + '"' + (u.id === z.teamId ? ' selected' : '') + '>' + U.esc(u.name) + '</option>').join('') + '</select></label>' +
      '<label>所屬分區<select id="ze-segid"><option value="">（不指定）</option>' + App.state.zones.filter(x => x.category === '搜索區').map(x => '<option value="' + U.esc(x.id) + '"' + (x.id === z.segmentId ? ' selected' : '') + '>' + U.esc(x.name || x.id) + '</option>').join('') + '</select></label></div></div>' +
      '<div class="hint">圖形：' + U.esc(geomName) + (z.measure ? '　' + U.esc(z.measure) : '') + '</div></div>';
    return U.modal({
      title: isNew ? '新增區域' : '區域屬性', html: html,
      buttons: [{ text: '取消', value: false }, {
        text: '儲存', cls: 'primary', value: true,
        validate: el => { if (!U.$('#ze-name', el).value.trim()) { U.toast('請填寫名稱', 'err'); return false; } },
        onClick: el => {
          z.name = U.$('#ze-name', el).value.trim();
          z.parentId = U.$('#ze-parent', el).value;
          z.category = U.$('#ze-cat', el).value;
          z.color = U.$('#ze-color', el).value;
          z.hazard = U.$('#ze-hazard', el).value.trim();
          z.note = U.$('#ze-note', el).value.trim();
          if (z.category === '搜索區') {
            z.priority = U.$('#ze-pri', el).value.trim(); z.status = U.$('#ze-st', el).value;
            z.terrain = U.$('#ze-ter', el).value.trim(); z.quality = U.$('#ze-qua', el).value.trim();
          }
          if (z.category === '搜索軌跡') { z.teamId = U.$('#ze-team', el).value; z.segmentId = U.$('#ze-segid', el).value; }
        }
      }],
      onOpen: el => {
        const showExtra = () => {
          const c = U.$('#ze-cat', el).value;
          U.$('#ze-seg', el).hidden = c !== '搜索區'; U.$('#ze-trk', el).hidden = c !== '搜索軌跡';
        };
        U.$('#ze-cat', el).addEventListener('change', e => { U.$('#ze-color', el).value = CFG.catColor(e.target.value); showExtra(); });
        showExtra();
        U.$$('.chip', el).forEach(b => b.addEventListener('click', () => {
          const inp = U.$('#ze-hazard', el), h = b.dataset.h;
          const cur = inp.value.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
          if (cur.indexOf(h) < 0) cur.push(h);
          inp.value = cur.join('、');
        }));
      }
    }).then(v => v === true);
  },
  async edit(id) {
    const z = Zones.byId(id);
    if (!z || App.state.readonly) return;
    const copy = Object.assign({}, z);
    if (await Zones.openEditor(copy, false)) { await Zones.persist(copy); }
  },

  /* ---------- 側欄清單 ---------- */
  renderList() {
    const box = U.$('#zone-list'); if (!box) return;
    const ro = App.state.readonly;
    const cats = Array.from(new Set(App.state.zones.map(z => z.category)));
    const sel = U.$('#zone-filter');
    if (sel) {
      sel.innerHTML = '<option value="">全部類別（' + App.state.zones.length + '）</option>' +
        cats.map(c => '<option value="' + U.esc(c) + '"' + (c === Zones.filter ? ' selected' : '') + '>' + U.esc(c) + '（' +
          App.state.zones.filter(z => z.category === c).length + '）</option>').join('');
    }
    // 沒有篩選類別時顯示成樹狀（子區域縮排在上層底下）；篩選時平面列出
    const tree = Zones.ordered(App.state.zones), rows = tree.filter(o => !Zones.filter || o.z.category === Zones.filter).map(o => ({ z: o.z, d: Zones.filter ? 0 : o.d }));
    if (!rows.length) {
      box.innerHTML = '<div class="empty">' + (App.state.zones.length ? '這個類別沒有區域' :
        '還沒有任何區域。<br>用地圖左側的繪圖工具畫出標記點、線或面，或到「工具」分頁匯入 KML／GPX。') + '</div>';
      return;
    }
    box.innerHTML = rows.map(o => { const z = o.z, nk = Zones.childrenOf(z.id).length; return '' +
      '<div class="zone-item' + (o.d ? ' child' : '') + '" data-id="' + U.esc(z.id) + '" style="margin-left:' + (o.d * 18) + 'px">' +
      '<span class="swatch" style="background:' + U.esc(z.color || CFG.catColor(z.category)) + '"></span>' +
      '<div class="zi-main"><div class="zi-name">' + (o.d ? '└ ' : '') + U.esc(z.name || z.category) + (nk ? ' <span class="kid-n">' + nk + ' 個子區域</span>' : '') + '</div>' +
      '<div class="zi-sub">' + U.esc(z.category) + (z.category === '搜索區' ? '・' + U.esc(z.status || '未搜') : '') + '・' + U.esc(CFG.GEOM_NAMES[z.geomType] || z.geomType) +
      (z.measure ? '・' + U.esc(z.measure) : '') + '</div>' +
      (z.hazard ? '<div class="zi-haz">⚠ ' + U.esc(z.hazard) + '</div>' : '') + '</div>' +
      '<div class="zi-btns"><button class="icon-btn" data-act="kml" title="匯出此區域 KML">⭳</button>' +
      (ro ? '' : '<button class="icon-btn" data-act="edit" title="編輯屬性">✎</button><button class="icon-btn danger" data-act="del" title="刪除">🗑</button>') +
      '</div></div>'; }).join('');
  },
  bindList() {
    const box = U.$('#zone-list');
    box.addEventListener('click', e => {
      const item = e.target.closest('.zone-item'); if (!item) return;
      const id = item.dataset.id, btn = e.target.closest('[data-act]');
      if (btn) {
        if (btn.dataset.act === 'kml') Kml.exportZone(App.state.cur, Zones.byId(id));
        else if (btn.dataset.act === 'edit') Zones.edit(id);
        else if (btn.dataset.act === 'del') Zones.remove(id);
      } else MapView.focusZone(id);
    });
    U.$('#zone-filter').addEventListener('change', e => { Zones.filter = e.target.value; Zones.renderList(); });
  }
};
