/* 地圖：底圖、繪圖（Leaflet-Geoman）、區域圖層、座標工具 */
const MapView = {
  map: null,
  zoneGroup: null,
  layers: {},                 // zoneId → Leaflet 圖層
  modes: { edit: false, drag: false, removal: false, draw: false },
  readonly: false,
  caseMarker: null,
  tempLayer: null,
  selectedId: null,
  _editTimers: {},

  init(elId) {
    const m = this.map = L.map(elId, { zoomControl: true, attributionControl: true, doubleClickZoom: false })
      .setView(CFG.DEFAULT_CENTER, CFG.DEFAULT_ZOOM);

    // 底圖與疊加圖層
    const base = {}, over = {};
    const mk = d => L.tileLayer(d.url, { attribution: d.attr, maxZoom: d.maxZoom, maxNativeZoom: d.maxNativeZoom, opacity: d.opacity || 1 });
    CFG.BASEMAPS.forEach(d => { base[d.name] = mk(d); });
    CFG.OVERLAYS.forEach(d => { over[d.name] = mk(d); });
    const savedBase = U.store.get('ccs_basemap', '');
    const def = CFG.BASEMAPS.find(d => d.name === savedBase) || CFG.BASEMAPS.find(d => d.id === CFG.DEFAULT_BASEMAP);
    base[def.name].addTo(m);
    try { JSON.parse(U.store.get('ccs_overlays', '[]')).forEach(n => over[n] && over[n].addTo(m)); } catch (e) { /* 略過 */ }
    L.control.layers(base, over, { position: 'topright' }).addTo(m);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m);
    m.on('baselayerchange', e => U.store.set('ccs_basemap', e.name));
    const saveOver = () => U.store.set('ccs_overlays', JSON.stringify(CFG.OVERLAYS.filter(d => m.hasLayer(over[d.name])).map(d => d.name)));
    m.on('overlayadd', saveOver); m.on('overlayremove', saveOver);

    this.zoneGroup = L.featureGroup().addTo(m);
    this.tempLayer = L.layerGroup().addTo(m);

    // 底圖載入失敗提示（網址失效時使用者才知道要換）
    m.eachLayer(l => { if (l instanceof L.TileLayer) l.on('tileerror', U.debounce(() => U.toast('部分地圖圖磚載入失敗，可換其他底圖', 'err'), 3000)); });

    // 繪圖
    m.pm.setLang('zh_tw');
    this.controlsOn = false;
    this.addControls();
    m.on('pm:create', e => this.onCreate(e));
    m.on('pm:globaleditmodetoggled', e => { this.modes.edit = e.enabled; });
    m.on('pm:globaldragmodetoggled', e => { this.modes.drag = e.enabled; });
    m.on('pm:globalremovalmodetoggled', e => { this.modes.removal = e.enabled; });
    m.on('pm:globaldrawmodetoggled', e => { this.modes.draw = e.enabled; });

    // 座標顯示與右鍵選單
    m.on('mousemove', e => this.showCursor(e.latlng));
    m.on('contextmenu', e => this.contextMenu(e.latlng));
    m.on('click', e => { if (this._pickCb) this.firePick(e.latlng); else this.select(null); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this._pickCb) { this.cancelPick(); U.toast('已取消選取位置'); } });
    this.unitGroup = L.layerGroup().addTo(m);
    this.reportGroup = L.layerGroup().addTo(m);
    this.casGroup = L.layerGroup().addTo(m);
    return m;
  },

  addControls() {
    if (this.controlsOn) return;
    this.map.pm.addControls({
      position: 'topleft', drawMarker: true, drawCircleMarker: false, drawPolyline: true,
      drawRectangle: true, drawPolygon: true, drawCircle: true, drawText: false,
      editMode: true, dragMode: true, cutPolygon: false, removalMode: true, rotateMode: false
    });
    this.controlsOn = true;
  },
  removeControls() {
    const pm = this.map.pm;
    pm.disableDraw(); pm.disableGlobalEditMode(); pm.disableGlobalDragMode(); pm.disableGlobalRemovalMode();
    pm.removeControls(); this.controlsOn = false;
    this.modes = { edit: false, drag: false, removal: false, draw: false };
  },
  setReadonly(ro) {
    this.readonly = !!ro;
    if (ro) this.removeControls(); else this.addControls();
  },
  isEditing() { const m = this.modes; return m.edit || m.drag || m.removal || m.draw; },

  /* ---------- 繪製完成 ---------- */
  onCreate(e) {
    const layer = e.layer, shape = e.shape;
    let s = null;
    if (shape === 'Marker') {
      const ll = layer.getLatLng();
      s = { geomType: 'Point', geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } };
    } else if (shape === 'Line') {
      s = { geomType: 'LineString', geometry: layer.toGeoJSON().geometry };
    } else if (shape === 'Polygon' || shape === 'Rectangle') {
      s = { geomType: 'Polygon', geometry: layer.toGeoJSON().geometry };
    } else if (shape === 'Circle') {
      const ll = layer.getLatLng();
      s = { geomType: 'Circle', geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] }, radius: Math.round(layer.getRadius() * 10) / 10 };
    }
    this.map.removeLayer(layer);   // 之後由 renderZones 以正式樣式重畫
    if (s) Zones.onDrawn(s);
  },

  shapeOfLayer(layer, z) {
    if (z.geomType === 'Point') {
      const ll = layer.getLatLng();
      return { geomType: 'Point', geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } };
    }
    if (z.geomType === 'Circle') {
      const ll = layer.getLatLng();
      return { geomType: 'Circle', geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] }, radius: Math.round(layer.getRadius() * 10) / 10 };
    }
    return { geomType: z.geomType, geometry: layer.toGeoJSON().geometry };
  },

  /* ---------- 區域圖層 ---------- */
  pinIcon(color, label, selected) {
    return L.divIcon({
      className: 'zone-pin-wrap',
      html: '<div class="zone-pin' + (selected ? ' sel' : '') + '" style="background:' + U.esc(color) + '"><span>' + U.esc(label) + '</span></div>',
      iconSize: [28, 28], iconAnchor: [14, 28], tooltipAnchor: [0, -26]
    });
  },
  layerFor(z) {
    const g = Zones.geometryOf(z);
    if (!g) return null;
    const color = z.color || CFG.catColor(z.category);
    const sel = z.id === this.selectedId;
    const style = { color: color, weight: sel ? 6 : 3, opacity: 1, fillColor: color, fillOpacity: 0.22 };
    if (z.category === '搜索區') {
      if (z.status === '已搜') { style.fillOpacity = 0.06; style.dashArray = '8 6'; }
      else if (z.status === '搜索中') { style.fillOpacity = 0.38; style.weight = sel ? 7 : 5; }
    }
    if (z.geomType === 'Point') {
      return L.marker([g.coordinates[1], g.coordinates[0]], { icon: this.pinIcon(color, (z.category || '?').charAt(0), sel) });
    }
    if (z.geomType === 'Circle') {
      return L.circle([g.coordinates[1], g.coordinates[0]], Object.assign({ radius: Number(z.radius) || 1 }, style));
    }
    if (z.geomType === 'LineString') {
      return L.polyline(g.coordinates.map(c => [c[1], c[0]]), Object.assign({}, style, { fill: false }));
    }
    if (z.geomType === 'Polygon') {
      return L.polygon(g.coordinates.map(r => r.map(c => [c[1], c[0]])), style);
    }
    return null;
  },

  renderZones() {
    const wasModes = Object.assign({}, this.modes);
    this.zoneGroup.clearLayers();
    this.layers = {};
    Zones.list().forEach(z => {
      const layer = this.layerFor(z);
      if (!layer) return;
      layer.zoneId = z.id;
      layer.bindTooltip('<b>' + U.esc(z.name || z.category) + '</b><br>' + U.esc(z.category) +
        (z.measure ? '<br>' + U.esc(z.measure) : '') + (z.hazard ? '<br>⚠ ' + U.esc(z.hazard) : ''), { sticky: true });
      layer.on('click', ev => {
        L.DomEvent.stopPropagation(ev);
        if (this._pickCb) this.firePick(ev.latlng); else this.select(z.id);
      });
      layer.on('dblclick', ev => { L.DomEvent.stopPropagation(ev); if (!this.readonly && !this.isEditing()) Zones.edit(z.id); });
      const changed = () => this.queueEdit(z.id, layer);
      layer.on('pm:edit', changed);
      layer.on('pm:dragend', changed);
      layer.on('pm:remove', () => Zones.onRemovedOnMap(z.id));
      this.zoneGroup.addLayer(layer);
      this.layers[z.id] = layer;
    });
    // 重畫會讓 Geoman 的編輯狀態消失，這裡恢復原本開著的模式
    if (!this.readonly) {
      if (wasModes.edit) this.map.pm.enableGlobalEditMode();
      if (wasModes.drag) this.map.pm.enableGlobalDragMode();
      if (wasModes.removal) this.map.pm.enableGlobalRemovalMode();
    }
  },

  /* 拖曳或改頂點會連續觸發，合併成一次存檔 */
  queueEdit(id, layer) {
    clearTimeout(this._editTimers[id]);
    this._editTimers[id] = setTimeout(() => {
      const z = Zones.byId(id); if (!z) return;
      Zones.onGeometryEdited(id, this.shapeOfLayer(layer, z));
    }, 400);
  },

  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    U.$$('.zone-item').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
    if (!this.isEditing()) this.renderZones();
    if (id) { const el = U.$('.zone-item[data-id="' + id + '"]'); if (el) el.scrollIntoView({ block: 'nearest' }); }
  },
  focusZone(id) {
    const l = this.layers[id]; if (!l) return;
    this.select(id);
    const l2 = this.layers[id];
    if (l2.getBounds) this.map.fitBounds(l2.getBounds(), { padding: [60, 60], maxZoom: 17 });
    else this.map.setView(l2.getLatLng(), Math.max(this.map.getZoom(), 15));
    l2.openTooltip && l2.openTooltip();
  },
  fitAll() {
    const b = this.zoneGroup.getBounds();
    if (b.isValid()) this.map.fitBounds(b, { padding: [50, 50], maxZoom: 16 });
    else if (this.caseMarker) this.map.setView(this.caseMarker.getLatLng(), 14);
  },

  /* 案件位置標記 */
  showCase(c) {
    if (this.caseMarker) { this.map.removeLayer(this.caseMarker); this.caseMarker = null; }
    const lat = parseFloat(c && c.lat), lng = parseFloat(c && c.lng);
    if (!U.validLatLng(lat, lng) || (lat === 0 && lng === 0)) return;
    this.caseMarker = L.marker([lat, lng], {
      interactive: true, zIndexOffset: -500,
      icon: L.divIcon({ className: 'case-pin-wrap', html: '<div class="case-pin" style="border-color:' + CFG.typeColor(c.type) + '">★</div>', iconSize: [26, 26], iconAnchor: [13, 13] })
    }).bindTooltip('案件位置：' + U.esc(c.place || c.name)).addTo(this.map);
  },

  /* ---------- 座標工具 ---------- */
  showCursor(ll) {
    const w = U.$('#cur-wgs'), t = U.$('#cur-twd');
    if (w) w.textContent = U.fmtWgs(ll.lat, ll.lng);
    if (t) t.textContent = U.fmtTwd(ll.lat, ll.lng);
  },
  contextMenu(ll) {
    const wgs = U.fmtWgs(ll.lat, ll.lng), twd = U.fmtTwd(ll.lat, ll.lng);
    const html = '<div class="ctx"><div class="ctx-h">WGS84　' + wgs + '<br>TWD97　' + twd + '</div>' +
      '<button data-c="w">複製 WGS84</button><button data-c="t">複製 TWD97</button>' +
      '<button data-c="v">以此為觀察點做視域分析</button>' +
      (this.readonly ? '' : '<button data-c="m">在此新增標記點</button>') + '</div>';
    const pop = L.popup({ closeButton: false, className: 'ctx-pop' }).setLatLng(ll).setContent(html).openOn(this.map);
    const el = pop.getElement();
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      if (b.dataset.c === 'w') U.copy(wgs);
      else if (b.dataset.c === 't') U.copy(twd);
      else if (b.dataset.c === 'v') Viewshed.dialog({ lat: ll.lat, lng: ll.lng });
      else if (b.dataset.c === 'm') Zones.onDrawn({ geomType: 'Point', geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } });
      this.map.closePopup();
    });
  },
  /* 輸入座標定位；save=true 時直接建標記點 */
  gotoCoord(lat, lng, save) {
    this.tempLayer.clearLayers();
    this.map.setView([lat, lng], Math.max(this.map.getZoom(), 15));
    if (save && !this.readonly) { Zones.onDrawn({ geomType: 'Point', geometry: { type: 'Point', coordinates: [lng, lat] } }); return; }
    L.circleMarker([lat, lng], { radius: 9, color: '#e91e63', weight: 3, fillOpacity: 0.15 }).addTo(this.tempLayer)
      .bindTooltip(U.fmtWgs(lat, lng), { permanent: true, direction: 'top' }).openTooltip();
    setTimeout(() => this.tempLayer.clearLayers(), 15000);
  },

  /* ---------- 單位標記與「點地圖選位置」 ---------- */
  unitIcon(u) {
    const col = CFG.unitColor(u.status);
    return L.divIcon({
      className: 'unit-wrap',
      html: '<div class="unit-badge" style="border-color:' + col + '"><i style="background:' + col + '"></i>' + U.esc(u.name) + '</div>',
      iconSize: null, iconAnchor: [0, 12]
    });
  },
  renderUnits() {
    this.unitGroup.clearLayers();
    this.unitMarkers = {};
    App.state.units.forEach(u => {
      const lat = parseFloat(u.lat), lng = parseFloat(u.lng);
      if (!U.validLatLng(lat, lng) || u.lat === '' || u.lng === '') return;
      const mk = L.marker([lat, lng], { icon: this.unitIcon(u), draggable: !this.readonly, zIndexOffset: 800 });
      mk.bindTooltip(U.esc(u.name) + '<br>' + U.esc(u.status) + (u.leader ? '・帶隊官 ' + U.esc(u.leader) : '') +
        (u.vehicles ? '<br>車輛：' + U.esc(u.vehicles) : ''), { direction: 'top', offset: [0, -8] });
      mk.on('dragend', () => { const ll = mk.getLatLng(); Deploy.onMoved(u.id, ll.lat, ll.lng); });
      mk.on('click', ev => { L.DomEvent.stopPropagation(ev); if (this._pickCb) this.firePick(ev.latlng); else Deploy.highlight(u.id); });
      this.unitGroup.addLayer(mk);
      this.unitMarkers[u.id] = mk;
    });
  },
  /* 有位置的回報（手機回報會自動帶入） */
  renderReports() {
    if (!this.reportGroup) return;
    this.reportGroup.clearLayers(); this.reportMarkers = {};
    App.state.reports.forEach(r => {
      const p = String(r.coord || '').split(',');
      const lat = parseFloat(p[0]), lng = parseFloat(p[1]);
      if (!U.validLatLng(lat, lng)) return;
      const mk = L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#e65100', fillOpacity: 1 });
      mk.bindTooltip('<b>' + U.esc(r.reporter || r.source) + '</b><br>' + U.esc(String(r.time || '').slice(5, 16)) + '<br>' + U.esc(r.content) + (r.photos ? '<br>📷' : ''), { direction: 'top' });
      this.reportGroup.addLayer(mk); this.reportMarkers[r.id] = mk;
    });
  },
  focusReport(id) {
    const mk = this.reportMarkers && this.reportMarkers[id];
    if (mk) { this.map.setView(mk.getLatLng(), Math.max(this.map.getZoom(), 16)); mk.openTooltip(); }
  },
  focusCasualty(id) {
    const mk = this.casMarkers && this.casMarkers[id];
    if (mk) { this.map.setView(mk.getLatLng(), Math.max(this.map.getZoom(), 16)); mk.openTooltip(); }
  },
  focusUnit(id) {
    const mk = this.unitMarkers && this.unitMarkers[id];
    if (mk) { this.map.setView(mk.getLatLng(), Math.max(this.map.getZoom(), 15)); mk.openTooltip(); }
  },
  pick(cb, msg) {
    this.cancelPick();
    this._pickCb = cb;
    this.map.getContainer().style.cursor = 'crosshair';
    U.toast(msg || '請在地圖上點選位置（按 Esc 取消）');
  },
  cancelPick() { this._pickCb = null; if (this.map) this.map.getContainer().style.cursor = ''; },
  firePick(ll) { const cb = this._pickCb; this.cancelPick(); if (cb) cb(ll); },

  clearAll() {
    this.cancelPick();
    if (this.unitGroup) this.unitGroup.clearLayers();
    if (this.reportGroup) this.reportGroup.clearLayers();
    if (this.casGroup) this.casGroup.clearLayers();
    this.zoneGroup.clearLayers(); this.layers = {}; this.selectedId = null;
    if (this.caseMarker) { this.map.removeLayer(this.caseMarker); this.caseMarker = null; }
    this.tempLayer.clearLayers();
  },
  invalidate() { if (this.map) this.map.invalidateSize(); }
};
