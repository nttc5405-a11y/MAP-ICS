/* 視域分析：在瀏覽器內用地形圖磚（Terrain-RGB）計算「從某點看得到哪裡」。
   方法：從觀察點向四周放射線，沿線取樣地形高度，逐點比較仰角（含地球曲率與大氣折射修正）。
   結果只是地形視線，不含樹木與建物遮蔽，供搜救規劃參考。 */
const Viewshed = {
  params: { obsH: 1.7, tgtH: 1.7, radiusKm: 3 },
  tiles: {},          // 圖磚快取 "z/x/y" → Float32Array(256*256)
  group: null,

  /* ---------- 圖磚與取樣 ---------- */
  decode(r, g, b) {
    return CFG.TERRAIN_FORMAT === 'mapbox' ? -10000 + (r * 65536 + g * 256 + b) * 0.1 : r * 256 + g + b / 256 - 32768;
  },
  loadTile(z, x, y) {
    const key = z + '/' + x + '/' + y;
    if (Viewshed.tiles[key]) return Promise.resolve(Viewshed.tiles[key]);
    return new Promise((res, rej) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const cv = document.createElement('canvas'); cv.width = cv.height = 256;
          const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
          const px = cx.getImageData(0, 0, 256, 256).data, h = new Float32Array(65536);
          for (let i = 0; i < 65536; i++) h[i] = Viewshed.decode(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
          Viewshed.tiles[key] = h; res(h);
        } catch (e) { rej(new Error('地形圖磚無法讀取像素（來源未開放跨網域）')); }
      };
      img.onerror = () => rej(new Error('地形圖磚載入失敗：' + key));
      img.src = CFG.TERRAIN_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    });
  },
  worldPx(lat, lng, z) {
    const n = 256 * Math.pow(2, z), s = Math.sin(lat * Math.PI / 180);
    return { x: (lng + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
  },
  /* 載入涵蓋圓形範圍的所有圖磚，回傳 (lat,lng) → 高度(m) 的雙線性取樣函式 */
  async buildSampler(lat, lng, R) {
    const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
    let z = R <= 5000 ? 13 : 12, rng;
    for (;;) {
      const a = Viewshed.worldPx(lat + R / mLat, lng - R / mLng, z), b = Viewshed.worldPx(lat - R / mLat, lng + R / mLng, z);
      rng = { x0: Math.floor(a.x / 256), x1: Math.floor(b.x / 256), y0: Math.floor(a.y / 256), y1: Math.floor(b.y / 256) };
      if ((rng.x1 - rng.x0 + 1) * (rng.y1 - rng.y0 + 1) <= 30 || z <= 9) break;
      z--;
    }
    const jobs = [];
    for (let x = rng.x0; x <= rng.x1; x++) for (let y = rng.y0; y <= rng.y1; y++) jobs.push(Viewshed.loadTile(z, x, y).then(h => [x + ',' + y, h]));
    const tiles = {}; (await Promise.all(jobs)).forEach(t => { tiles[t[0]] = t[1]; });
    const get = (gx, gy) => { const t = tiles[(gx >> 8) + ',' + (gy >> 8)]; return t ? t[(gy & 255) * 256 + (gx & 255)] : NaN; };
    return {
      zoom: z,
      sample(la, lo) {
        const p = Viewshed.worldPx(la, lo, z), x = p.x - 0.5, y = p.y - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        const a = get(x0, y0), b = get(x0 + 1, y0), c = get(x0, y0 + 1), d = get(x0 + 1, y0 + 1);
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      }
    };
  },

  /* ---------- 視線計算（純函式，可用假地形測試） ---------- */
  compute(sample, o) {
    const R = o.radiusM, cell = o.cell || 30, mLat = 111320, mLng = 111320 * Math.cos(o.lat * Math.PI / 180);
    const N = Math.ceil(2 * R / cell), vis = new Uint8Array(N * N);
    const e0 = sample(o.lat, o.lng);
    if (!isFinite(e0)) throw new Error('取不到觀察點的地形高度');
    const eye = e0 + o.obsH, k = 0.13, Re = 6371000;
    const rays = Math.ceil(2 * Math.PI * R / cell * 1.5), step = cell * 0.7;
    for (let r = 0; r < rays; r++) {
      const ang = 2 * Math.PI * r / rays, dx = Math.sin(ang), dy = Math.cos(ang);
      let maxA = -Infinity;
      for (let d = step; d <= R; d += step) {
        const x = dx * d, y = dy * d;
        let h = sample(o.lat + y / mLat, o.lng + x / mLng);
        if (!isFinite(h)) continue;
        h -= d * d * (1 - k) / (2 * Re);
        if ((h + o.tgtH - eye) / d >= maxA) {
          const ix = Math.floor((x + R) / cell), iy = Math.floor((R - y) / cell);
          if (ix >= 0 && ix < N && iy >= 0 && iy < N) vis[iy * N + ix] = 1;
        }
        const aG = (h - eye) / d; if (aG > maxA) maxA = aG;
      }
    }
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N);
    let inside = 0, seen = 0;
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
      const cx = (ix + 0.5) * cell - R, cy = R - (iy + 0.5) * cell;
      if (cx * cx + cy * cy > R * R) continue;
      inside++;
      if (vis[iy * N + ix]) { seen++; const i = (iy * N + ix) * 4; img.data[i] = 0; img.data[i + 1] = 200; img.data[i + 2] = 83; img.data[i + 3] = 150; }
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: cv, pct: inside ? Math.round(seen / inside * 1000) / 10 : 0, areaKm2: Math.round(seen * cell * cell / 1e4) / 100, eyeElev: Math.round(e0), vis: vis, N: N };
  },

  /* ---------- 介面 ---------- */
  bind() {
    U.$('#btn-vs').addEventListener('click', () => Viewshed.dialog(null));
    U.$('#btn-vs-clear').addEventListener('click', Viewshed.clear);
  },
  clear() {
    if (Viewshed.group) { MapView.map.removeLayer(Viewshed.group); Viewshed.group = null; }
    U.$('#vs-result').innerHTML = '';
  },
  async dialog(pt) {
    const p = Viewshed.params;
    const html = '<div class="form">' +
      '<div class="hint">' + (pt ? '觀察點：' + U.fmtWgs(pt.lat, pt.lng) : '按「開始」後，請在地圖上點選觀察點。') + '</div>' +
      '<div class="row2"><label>觀察者眼高（m）<input id="vs-obs" type="number" min="0" max="100" step="0.1" value="' + p.obsH + '"></label>' +
      '<label>目標高度（m）<input id="vs-tgt" type="number" min="0" max="100" step="0.1" value="' + p.tgtH + '"></label></div>' +
      '<label>分析半徑<select id="vs-rad">' + [1, 2, 3, 5, 10].map(r => '<option value="' + r + '"' + (r === p.radiusKm ? ' selected' : '') + '>' + r + ' km</option>').join('') + '</select></label>' +
      '<div class="hint">目標高度 1.7 ≈ 看得到站立的人；0 ≈ 看得到地面。地形資料解析度約 15～30 m，不含樹木與建物遮蔽，結果僅供規劃參考。</div></div>';
    const v = await U.modal({
      title: '視域分析', html: html,
      buttons: [{ text: '取消', value: false }, {
        text: pt ? '開始分析' : '開始（再點地圖）', cls: 'primary',
        value: el => ({ obsH: Math.max(0, parseFloat(U.$('#vs-obs', el).value) || 0), tgtH: Math.max(0, parseFloat(U.$('#vs-tgt', el).value) || 0), radiusKm: parseInt(U.$('#vs-rad', el).value, 10) || 3 })
      }]
    });
    if (!v || typeof v !== 'object') return;
    Viewshed.params = v;
    if (pt) Viewshed.run(pt.lat, pt.lng); else MapView.pick(ll => Viewshed.run(ll.lat, ll.lng), '請在地圖上點選觀察點（按 Esc 取消）');
  },
  async run(lat, lng) {
    const p = Viewshed.params, R = p.radiusKm * 1000;
    U.toast('視域計算中，首次需下載地形資料…');
    try {
      const sm = await Viewshed.buildSampler(lat, lng, R);
      const res = Viewshed.compute(sm.sample, { lat: lat, lng: lng, obsH: p.obsH, tgtH: p.tgtH, radiusM: R, cell: sm.zoom >= 13 ? 25 : 40 });
      Viewshed.clear();
      const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
      const bounds = [[lat - R / mLat, lng - R / mLng], [lat + R / mLat, lng + R / mLng]];
      Viewshed.group = L.layerGroup().addTo(MapView.map);
      L.imageOverlay(res.canvas.toDataURL(), bounds, { opacity: 1, interactive: false }).addTo(Viewshed.group);
      L.circle([lat, lng], { radius: R, color: '#00a152', weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(Viewshed.group);
      L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#d50000', fillOpacity: 1 }).addTo(Viewshed.group)
        .bindTooltip('觀察點 海拔約 ' + res.eyeElev + ' m');
      MapView.map.fitBounds(bounds, { padding: [20, 20] });
      U.$('#vs-result').innerHTML = '觀察點 ' + U.fmtWgs(lat, lng) + '（海拔約 ' + res.eyeElev + ' m）<br>半徑 ' + p.radiusKm + ' km 內可見約 <b>' + res.pct + '%</b>（約 ' + res.areaKm2 + ' km²）<br>眼高 ' + p.obsH + ' m・目標 ' + p.tgtH + ' m';
      U.toast('視域分析完成：可見約 ' + res.pct + '%', 'ok');
    } catch (e) { U.toast('視域分析失敗：' + e.message, 'err'); }
  }
};
