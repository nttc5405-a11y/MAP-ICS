/* KML 匯出、KML／KMZ／GPX 匯入 */
const Kml = {
  /* #rrggbb → aabbggrr（KML 的顏色順序） */
  color(hex, alpha) {
    const h = String(hex || '#757575').replace('#', '').padEnd(6, '0');
    const a = ('0' + Math.round((alpha == null ? 1 : alpha) * 255).toString(16)).slice(-2);
    return a + h.substr(4, 2) + h.substr(2, 2) + h.substr(0, 2);
  },
  x(s) { return U.esc(s); },

  /* 把一個區域轉成 KML Placemark 字串 */
  placemark(z) {
    const g = Zones.geometryOf(z);
    if (!g) return '';
    const col = z.color || CFG.catColor(z.category);
    const desc = [z.category ? '類別：' + z.category : '', z.hazard ? '危險因子：' + z.hazard : '',
      z.measure ? '量測：' + z.measure : '', z.note ? '備註：' + z.note : ''].filter(Boolean).join('\n');
    let geom = '';
    const coordStr = arr => arr.map(c => c[0] + ',' + c[1] + ',0').join(' ');
    if (z.geomType === 'Circle') {
      const poly = U.circleToPolygon(g.coordinates[0], g.coordinates[1], Number(z.radius) || 0);
      geom = '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + coordStr(poly.coordinates[0]) +
        '</coordinates></LinearRing></outerBoundaryIs></Polygon>';
    } else if (g.type === 'Point') {
      geom = '<Point><coordinates>' + g.coordinates[0] + ',' + g.coordinates[1] + ',0</coordinates></Point>';
    } else if (g.type === 'LineString') {
      geom = '<LineString><tessellate>1</tessellate><coordinates>' + coordStr(g.coordinates) + '</coordinates></LineString>';
    } else if (g.type === 'Polygon') {
      geom = '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + coordStr(g.coordinates[0]) +
        '</coordinates></LinearRing></outerBoundaryIs>' +
        g.coordinates.slice(1).map(r => '<innerBoundaryIs><LinearRing><coordinates>' + coordStr(r) +
          '</coordinates></LinearRing></innerBoundaryIs>').join('') + '</Polygon>';
    }
    return '<Placemark><name>' + Kml.x(z.name || z.category) + '</name>' +
      '<description>' + Kml.x(desc) + '</description>' +
      '<Style><LineStyle><color>' + Kml.color(col, 1) + '</color><width>3</width></LineStyle>' +
      '<PolyStyle><color>' + Kml.color(col, 0.35) + '</color></PolyStyle>' +
      '<IconStyle><color>' + Kml.color(col, 1) + '</color></IconStyle></Style>' + geom + '</Placemark>';
  },

  /* 整案（依類別分資料夾）或單一區域 */
  build(caseObj, zones) {
    const byCat = {};
    zones.forEach(z => { (byCat[z.category || '其他'] = byCat[z.category || '其他'] || []).push(z); });
    const folders = Object.keys(byCat).map(cat =>
      '<Folder><name>' + Kml.x(cat) + '</name>' + byCat[cat].map(Kml.placemark).join('') + '</Folder>').join('');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
      '<name>' + Kml.x((caseObj.id || '') + ' ' + (caseObj.name || '')) + '</name>' + folders + '</Document></kml>';
  },

  exportCase(caseObj, zones) {
    if (!zones.length) { U.toast('這個案件還沒有任何區域可匯出', 'err'); return; }
    U.download(U.safeFile(caseObj.id + '_' + caseObj.name) + '.kml', Kml.build(caseObj, zones), 'application/vnd.google-earth.kml+xml');
  },
  exportZone(caseObj, z) {
    U.download(U.safeFile(caseObj.id + '_' + (z.name || z.category)) + '.kml', Kml.build(caseObj, [z]), 'application/vnd.google-earth.kml+xml');
  },

  /* ---------- 匯入 ---------- */
  /* 讀檔 → 回傳 { zones:[zone...], skipped:[文字...], simplified:數量 }（尚未存檔） */
  async importFile(file) {
    const name = file.name.toLowerCase();
    if (typeof toGeoJSON === 'undefined') throw new Error('匯入元件沒載入成功，請檢查網路');
    let geojson;
    if (name.endsWith('.kmz')) {
      if (typeof JSZip === 'undefined') throw new Error('KMZ 解壓縮元件沒載入成功，請檢查網路');
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entry = zip.file(/\.kml$/i)[0];
      if (!entry) throw new Error('這個 KMZ 裡面找不到 KML 檔');
      geojson = toGeoJSON.kml(new DOMParser().parseFromString(await entry.async('string'), 'text/xml'));
    } else if (name.endsWith('.kml')) {
      geojson = toGeoJSON.kml(new DOMParser().parseFromString(await file.text(), 'text/xml'));
    } else if (name.endsWith('.gpx')) {
      geojson = toGeoJSON.gpx(new DOMParser().parseFromString(await file.text(), 'text/xml'));
    } else throw new Error('只支援 .kml、.kmz、.gpx 檔案');

    const out = { zones: [], skipped: [], simplified: 0 };
    const base = file.name.replace(/\.[^.]+$/, '');
    let seq = 0;
    const add = (geom, props) => {
      seq++;
      const label = (props && (props.name || props.desc)) || (base + ' ' + seq);
      let gt = geom.type;
      if (gt !== 'Point' && gt !== 'LineString' && gt !== 'Polygon') { out.skipped.push(label + '（不支援的圖形 ' + gt + '）'); return; }
      const fit = U.fitGeometry(geom, CFG.GEOJSON_LIMIT);
      if (!fit) { out.skipped.push(label + '（太複雜，簡化後仍超過儲存上限）'); return; }
      if (fit.simplified) out.simplified++;
      const z = Zones.newZone({ name: String(label).slice(0, 60), category: '匯入資料', geomType: gt, geometry: fit.geom, radius: '' });
      z.note = '匯入自 ' + file.name + (fit.simplified ? '（已簡化節點）' : '');
      out.zones.push(z);
    };
    const walk = g => {
      if (!g) return;
      if (g.type === 'GeometryCollection') g.geometries.forEach(walk);
      else if (g.type === 'MultiPoint') g.coordinates.forEach(c => add({ type: 'Point', coordinates: c }, {}));
      else if (g.type === 'MultiLineString') g.coordinates.forEach(c => add({ type: 'LineString', coordinates: c }, {}));
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(c => add({ type: 'Polygon', coordinates: c }, {}));
    };
    (geojson.features || []).forEach(f => {
      const g = f.geometry;
      if (!g) return;
      if (g.type === 'Point' || g.type === 'LineString' || g.type === 'Polygon') add(g, f.properties);
      else {
        // 複合圖形：每一塊獨立一個區域，名稱沿用原名加序號
        const before = out.zones.length;
        walk(g);
        const nm = f.properties && f.properties.name;
        if (nm) out.zones.slice(before).forEach((z, i, a) => { z.name = a.length > 1 ? nm + ' ' + (i + 1) : nm; });
      }
    });
    return out;
  }
};
