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

  /* 由幾何建立一筆新區域（尚未送後端）。shape: {name, category, geomType, geometry, radius} */
  newZone(shape) {
    const cat = shape.category || '其他';
    const z = {
      id: U.uid('Z'), name: shape.name || '', category: cat, color: CFG.catColor(cat),
      geomType: shape.geomType, radius: shape.radius || '', geojson: JSON.stringify(shape.geometry),
      measure: '', hazard: '', note: '', created: U.now(), updated: U.now()
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
    const ok = await U.confirm('確定要刪除區域「' + (z.name || z.category) + '」嗎？\n刪除後無法復原（事件日誌會留下紀錄）。', '刪除', true);
    if (!ok) { MapView.renderZones(); return; }
    await Zones.removeConfirmed(id);
  },

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
    if (await U.confirm('確定要刪除區域「' + (z.name || z.category) + '」嗎？\n刪除後無法復原（事件日誌會留下紀錄）。', '刪除', true)) {
      await Zones.removeConfirmed(id);
    }
  },

  /* ---------- 屬性對話框 ---------- */
  /* 回傳 Promise<boolean>：true 表示使用者按了儲存（z 已被就地更新） */
  openEditor(z, isNew) {
    const catOpts = CFG.ZONE_CATS.map(c =>
      '<option value="' + U.esc(c.id) + '"' + (c.id === z.category ? ' selected' : '') + '>' + U.esc(c.id) + '</option>').join('');
    const chips = CFG.HAZARDS.map(h => '<button type="button" class="chip" data-h="' + U.esc(h) + '">' + U.esc(h) + '</button>').join('');
    const geomName = CFG.GEOM_NAMES[z.geomType] || z.geomType;
    const html =
      '<div class="form">' +
      '<label>名稱<input id="ze-name" type="text" maxlength="60" value="' + U.esc(z.name) + '"></label>' +
      '<div class="row2"><label>類別<select id="ze-cat">' + catOpts + '</select></label>' +
      '<label>顏色<input id="ze-color" type="color" value="' + U.esc(z.color || '#757575') + '"></label></div>' +
      '<label>危險因子<input id="ze-hazard" type="text" maxlength="200" value="' + U.esc(z.hazard) + '" placeholder="例：落石、濕滑（可點下方快選）"></label>' +
      '<div class="chips">' + chips + '</div>' +
      '<label>備註<textarea id="ze-note" rows="3" maxlength="500">' + U.esc(z.note) + '</textarea></label>' +
      '<div class="hint">圖形：' + U.esc(geomName) + (z.measure ? '　' + U.esc(z.measure) : '') + '</div></div>';
    return U.modal({
      title: isNew ? '新增區域' : '區域屬性', html: html,
      buttons: [{ text: '取消', value: false }, {
        text: '儲存', cls: 'primary', value: true,
        validate: el => { if (!U.$('#ze-name', el).value.trim()) { U.toast('請填寫名稱', 'err'); return false; } },
        onClick: el => {
          z.name = U.$('#ze-name', el).value.trim();
          z.category = U.$('#ze-cat', el).value;
          z.color = U.$('#ze-color', el).value;
          z.hazard = U.$('#ze-hazard', el).value.trim();
          z.note = U.$('#ze-note', el).value.trim();
        }
      }],
      onOpen: el => {
        U.$('#ze-cat', el).addEventListener('change', e => { U.$('#ze-color', el).value = CFG.catColor(e.target.value); });
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
    const rows = App.state.zones.filter(z => !Zones.filter || z.category === Zones.filter);
    if (!rows.length) {
      box.innerHTML = '<div class="empty">' + (App.state.zones.length ? '這個類別沒有區域' :
        '還沒有任何區域。<br>用地圖左側的繪圖工具畫出標記點、線或面，或到「工具」分頁匯入 KML／GPX。') + '</div>';
      return;
    }
    box.innerHTML = rows.map(z =>
      '<div class="zone-item" data-id="' + U.esc(z.id) + '">' +
      '<span class="swatch" style="background:' + U.esc(z.color || CFG.catColor(z.category)) + '"></span>' +
      '<div class="zi-main"><div class="zi-name">' + U.esc(z.name || z.category) + '</div>' +
      '<div class="zi-sub">' + U.esc(z.category) + '・' + U.esc(CFG.GEOM_NAMES[z.geomType] || z.geomType) +
      (z.measure ? '・' + U.esc(z.measure) : '') + '</div>' +
      (z.hazard ? '<div class="zi-haz">⚠ ' + U.esc(z.hazard) + '</div>' : '') + '</div>' +
      '<div class="zi-btns"><button class="icon-btn" data-act="kml" title="匯出此區域 KML">⭳</button>' +
      (ro ? '' : '<button class="icon-btn" data-act="edit" title="編輯屬性">✎</button><button class="icon-btn danger" data-act="del" title="刪除">🗑</button>') +
      '</div></div>').join('');
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
