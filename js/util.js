/* 共用工具：TWD97 座標、量測、線面簡化、介面輔助 */
const U = {};

/* ---------- 基本 ---------- */
U.esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};
U.pad = n => (n < 10 ? '0' : '') + n;
U.now = function (d) {
  d = d || new Date();
  return d.getFullYear() + '/' + U.pad(d.getMonth() + 1) + '/' + U.pad(d.getDate()) + ' ' +
    U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()) + ':' + U.pad(d.getSeconds());
};
U.uid = function (prefix) {
  return (prefix || 'Z') + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).slice(2, 6).toUpperCase();
};
U.debounce = function (fn, ms) {
  let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); };
};
U.store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } }
};

/* ---------- TWD97 TM2（中央經線 121°、GRS80、k0 0.9999、東偏 250,000） ---------- */
U.TWD = { a: 6378137.0, f: 1 / 298.257222101, lng0: 121, k0: 0.9999, dx: 250000 };

U.wgs84ToTwd97 = function (lat, lng) {
  const T = U.TWD, a = T.a, b = a * (1 - T.f);
  const e2 = 1 - (b * b) / (a * a), ep2 = (a * a - b * b) / (b * b);
  const n = (a - b) / (a + b);
  const phi = lat * Math.PI / 180, p = (lng - T.lng0) * Math.PI / 180;
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const nu = a / Math.sqrt(1 - e2 * sin * sin);
  const A = a * (1 - n + (5 / 4) * (n * n - n * n * n) + (81 / 64) * (Math.pow(n, 4) - Math.pow(n, 5)));
  const B = (3 * a * n / 2) * (1 - n + (7 / 8) * (n * n - n * n * n) + (55 / 64) * (Math.pow(n, 4) - Math.pow(n, 5)));
  const C = (15 * a * n * n / 16) * (1 - n + (3 / 4) * (n * n - n * n * n));
  const D = (35 * a * Math.pow(n, 3) / 48) * (1 - n + (11 / 16) * (n * n - n * n * n));
  const E = (315 * a * Math.pow(n, 4) / 512) * (1 - n);
  const S = A * phi - B * Math.sin(2 * phi) + C * Math.sin(4 * phi) - D * Math.sin(6 * phi) + E * Math.sin(8 * phi);
  const K1 = S * T.k0;
  const K2 = T.k0 * nu * sin * cos / 2;
  const K3 = (T.k0 * nu * sin * Math.pow(cos, 3) / 24) *
    (5 - tan * tan + 9 * ep2 * cos * cos + 4 * ep2 * ep2 * Math.pow(cos, 4));
  const N = K1 + K2 * p * p + K3 * Math.pow(p, 4);
  const K4 = T.k0 * nu * cos;
  const K5 = (T.k0 * nu * Math.pow(cos, 3) / 6) * (1 - tan * tan + ep2 * cos * cos);
  const E_ = K4 * p + K5 * Math.pow(p, 3) + T.dx;
  return { e: E_, n: N };
};

/* 反算：用牛頓法逼近，約 5 次內收斂到公釐等級 */
U.twd97ToWgs84 = function (e, n) {
  let lat = n / 110574, lng = U.TWD.lng0 + (e - U.TWD.dx) / (111320 * Math.cos(lat * Math.PI / 180));
  for (let i = 0; i < 12; i++) {
    const c = U.wgs84ToTwd97(lat, lng);
    const dE = e - c.e, dN = n - c.n;
    if (Math.abs(dE) < 0.001 && Math.abs(dN) < 0.001) break;
    const h = 1e-6;
    const a = U.wgs84ToTwd97(lat + h, lng), b = U.wgs84ToTwd97(lat, lng + h);
    const j11 = (a.e - c.e) / h, j12 = (b.e - c.e) / h, j21 = (a.n - c.n) / h, j22 = (b.n - c.n) / h;
    const det = j11 * j22 - j12 * j21;
    lat += (dE * j22 - dN * j12) / det;
    lng += (-dE * j21 + dN * j11) / det;
  }
  return { lat: lat, lng: lng };
};

U.fmtWgs = (lat, lng) => lat.toFixed(6) + ', ' + lng.toFixed(6);
U.fmtTwd = function (lat, lng) {
  const t = U.wgs84ToTwd97(lat, lng);
  return Math.round(t.e) + ', ' + Math.round(t.n);
};

/* 解析使用者輸入的座標。兩個數字都 >1000 視為 TWD97（東, 北），否則為 WGS84。
   WGS84 預設「緯度, 經度」；若第一個數字 >90 則視為「經度, 緯度」 */
U.parseCoord = function (s) {
  const m = String(s || '').replace(/[，、；;]/g, ' ').match(/-?\d+(?:\.\d+)?/g);
  if (!m || m.length < 2) return null;
  const a = parseFloat(m[0]), b = parseFloat(m[1]);
  if (Math.abs(a) > 1000 && Math.abs(b) > 1000) {
    const r = U.twd97ToWgs84(a, b);
    return U.validLatLng(r.lat, r.lng) ? { lat: r.lat, lng: r.lng, src: 'TWD97' } : null;
  }
  let lat = a, lng = b;
  if (Math.abs(a) > 90) { lat = b; lng = a; }
  return U.validLatLng(lat, lng) ? { lat: lat, lng: lng, src: 'WGS84' } : null;
};
U.validLatLng = (lat, lng) => isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/* ---------- 量測 ---------- */
U.haversine = function (a, b) {   // a, b: [lng, lat]，回傳公尺
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
U.lineLength = function (coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += U.haversine(coords[i - 1], coords[i]);
  return d;
};
/* 面積／周長：轉成 TWD97 平面座標後計算（本島誤差約萬分之一） */
U.ringArea = function (ring) {
  const p = ring.map(c => { const t = U.wgs84ToTwd97(c[1], c[0]); return [t.e, t.n]; });
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] * p[i][1]) - (p[i][0] * p[j][1]);
  return Math.abs(s) / 2;
};
U.fmtDist = m => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
U.fmtArea = function (m2) {
  if (m2 >= 1e6) return (m2 / 1e6).toFixed(3) + ' km²（' + (m2 / 10000).toFixed(1) + ' 公頃）';
  if (m2 >= 10000) return (m2 / 10000).toFixed(2) + ' 公頃（' + Math.round(m2).toLocaleString() + ' m²）';
  return Math.round(m2).toLocaleString() + ' m²';
};

/* 依幾何類型產生量測文字，存進「量測」欄 */
U.measure = function (geomType, geom, radius) {
  if (!geom) return '';
  try {
    if (geomType === 'Point') {
      const c = geom.coordinates;
      return 'TWD97 ' + U.fmtTwd(c[1], c[0]);
    }
    if (geomType === 'Circle') {
      const r = Number(radius) || 0;
      return '半徑 ' + U.fmtDist(r) + '，面積 ' + U.fmtArea(Math.PI * r * r);
    }
    if (geomType === 'LineString') return '長度 ' + U.fmtDist(U.lineLength(geom.coordinates));
    if (geomType === 'Polygon') {
      const ring = geom.coordinates[0];
      let area = U.ringArea(ring);
      for (let i = 1; i < geom.coordinates.length; i++) area -= U.ringArea(geom.coordinates[i]);
      return '面積 ' + U.fmtArea(area) + '，周長 ' + U.fmtDist(U.lineLength(ring));
    }
  } catch (e) { /* 量測失敗不影響存檔 */ }
  return '';
};

/* ---------- 圓形 → 多邊形 ---------- */
U.circleToPolygon = function (lng, lat, radius, n) {
  n = n || CFG.CIRCLE_POINTS;
  const pts = [], dLat = radius / 111320, dLng = radius / (111320 * Math.cos(lat * Math.PI / 180));
  for (let i = 0; i < n; i++) {
    const t = 2 * Math.PI * i / n;
    pts.push([+(lng + dLng * Math.cos(t)).toFixed(6), +(lat + dLat * Math.sin(t)).toFixed(6)]);
  }
  pts.push(pts[0]);
  return { type: 'Polygon', coordinates: [pts] };
};

/* ---------- Douglas–Peucker 簡化（座標單位：度） ---------- */
U.simplifyLine = function (pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = U.perpDist(pts[i], pts[s], pts[e]);
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
};
U.perpDist = function (p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};
U.simplifyGeometry = function (g, tol) {
  if (g.type === 'LineString') return { type: 'LineString', coordinates: U.simplifyLine(g.coordinates, tol) };
  if (g.type === 'Polygon') {
    return {
      type: 'Polygon', coordinates: g.coordinates.map(r => {
        const s = U.simplifyLine(r, tol);
        return s.length >= 4 ? s : r;   // 環至少 4 點（含閉合點）
      })
    };
  }
  return g;
};
U.roundGeometry = function (g, digits) {
  const f = Math.pow(10, digits || 6);
  const rc = c => [Math.round(c[0] * f) / f, Math.round(c[1] * f) / f];   // 順便丟掉高程
  if (g.type === 'Point') return { type: 'Point', coordinates: rc(g.coordinates) };
  if (g.type === 'LineString') return { type: 'LineString', coordinates: g.coordinates.map(rc) };
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: g.coordinates.map(r => r.map(rc)) };
  return g;
};
/* 讓幾何序列化後 ≤ limit。成功回傳字串，仍過大回傳 null */
U.fitGeometry = function (g, limit) {
  limit = limit || CFG.GEOJSON_LIMIT;
  g = U.roundGeometry(g, 6);
  let s = JSON.stringify(g);
  if (s.length <= limit) return { json: s, geom: g, simplified: false };
  if (g.type === 'Point') return null;
  for (let tol = 0.00001; tol <= 0.02; tol *= 1.6) {
    const sg = U.simplifyGeometry(g, tol);
    s = JSON.stringify(sg);
    if (s.length <= limit) return { json: s, geom: sg, simplified: true };
  }
  return null;
};

/* 分色圓餅圖（SVG 字串）。counts: { 紅, 黃, 綠, 黑 }，中央顯示總人數 */
U.triagePie = function (counts, size) {
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
};

/* 照片：長邊 1600px、JPEG 品質 0.7（約 300～500KB），回傳 { preview, b64 } */
U.compressPhoto = function (file) {
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
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('無法讀取這張照片（' + file.name + '）')); };
    img.src = url;
  });
};
/* 對話框裡的「照片」選取元件（網頁版）：st.html() 放進表單、st.bind(對話框) 啟用、st.upload(案件ID) 送出前上傳 */
U.photoBox = function (max) {
  const st = { max: max, existing: 0, photos: [] };
  st.room = () => st.max - st.existing - st.photos.length;
  st.html = label => '<div class="pbox"><div class="lbl">' + U.esc(label || '照片') + '（最多 ' + max + ' 張' + (st.existing ? '，已有 ' + st.existing + ' 張' : '') + '）</div>' +
    '<div class="pb-grid"></div><input class="pb-file" type="file" accept="image/*" multiple hidden></div>';
  st.bind = root => {
    st.grid = U.$('.pb-grid', root); st.inp = U.$('.pb-file', root);
    st.inp.addEventListener('change', async () => {
      const files = Array.from(st.inp.files); st.inp.value = '';
      if (files.length > st.room()) U.toast('最多 ' + st.max + ' 張，只取前 ' + Math.max(0, st.room()) + ' 張', 'err');
      for (const f of files.slice(0, Math.max(0, st.room()))) {
        try { const c = await U.compressPhoto(f); st.photos.push({ preview: c.preview, b64: c.b64, id: null }); } catch (e) { U.toast(e.message, 'err'); }
      }
      st.draw();
    });
    st.draw();
  };
  st.draw = () => {
    st.grid.innerHTML = st.photos.map((p, i) => '<div class="pb-ph"><img src="' + p.preview + '" alt=""><button type="button" class="pb-rm" data-i="' + i + '">✕</button>' + (p.id ? '<span class="pb-ok">已上傳</span>' : '') + '</div>').join('') +
      (st.room() > 0 ? '<button type="button" class="pb-add">＋ 加照片</button>' : '');
    const add = U.$('.pb-add', st.grid); if (add) add.onclick = () => st.inp.click();
    U.$$('.pb-rm', st.grid).forEach(b => b.onclick = () => { st.photos.splice(+b.dataset.i, 1); st.draw(); });
  };
  /* 把還沒上傳的照片依序上傳，回傳新增照片的 ID 陣列（失敗會丟出錯誤，已上傳的不會重複傳） */
  st.upload = async caseId => {
    const ids = [];
    for (const p of st.photos) {
      if (!p.id) { const r = await Api.call('uploadPhoto', { caseId: caseId, mime: 'image/jpeg', data: p.b64 }); p.id = r.photoId; st.draw(); }
      ids.push(p.id);
    }
    return ids;
  };
  return st;
};
/* 附照片的對話框：「確定」鈕先上傳照片再關閉；上傳失敗時對話框與已填內容都保留，可再按一次 */
U.modalWithPhotos = function (o) {
  let closeFn;
  return U.modal({
    title: o.title, html: o.html, wide: o.wide,
    onOpen: (el, close) => { closeFn = close; o.pb.bind(el); if (o.onOpen) o.onOpen(el); },
    buttons: [{ text: '取消', value: false }, {
      text: o.submitText || '儲存', cls: 'primary', keepOpen: true, validate: o.validate,
      onClick: async el => {
        const btn = U.$('[data-i="1"]', el), old = btn.textContent;
        btn.disabled = true; btn.textContent = o.pb.photos.length ? '上傳照片中…' : '處理中…';
        try { const ids = await o.pb.upload(App.state.cur.id); const vals = o.collect(el); vals.newPhotos = ids; closeFn(vals); }
        catch (e) { U.toast('照片上傳失敗：' + e.message + '（內容還在，可再按一次）', 'err'); btn.disabled = false; btn.textContent = old; }
      }
    }]
  });
};

/* 跑馬燈：el 內要有一個 <span>；text 空白就整條隱藏；seconds＝文字從右跑到左一趟的秒數 */
U.marquee = function (el, text, seconds) {
  if (!el) return;
  const s = el.querySelector('span');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  s.textContent = text;
  s.style.animation = 'none'; void s.offsetWidth;   // 重新開始動畫
  s.style.animation = ''; s.style.animationDuration = Math.max(3, Math.min(120, Number(seconds) || 18)) + 's';
};

/* ---------- 介面輔助 ---------- */
U.$ = (sel, root) => (root || document).querySelector(sel);
U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

U.toast = function (msg, kind) {
  let box = U.$('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 5000 : 2500);
};

/* 對話框。opts: {title, html, buttons:[{text, cls, value, keepOpen}], onOpen(el)} → Promise(按鈕 value 或 null) */
U.modal = function (opts) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const btns = (opts.buttons || [{ text: '確定', cls: 'primary', value: true }]);
    back.innerHTML = '<div class="modal ' + (opts.wide ? 'wide' : '') + '" role="dialog">' +
      '<div class="modal-head">' + U.esc(opts.title || '') + '</div>' +
      '<div class="modal-body">' + (opts.html || '') + '</div>' +
      '<div class="modal-foot">' + btns.map((b, i) =>
        '<button class="btn ' + (b.cls || '') + '" data-i="' + i + '">' + U.esc(b.text) + '</button>').join('') +
      '</div></div>';
    document.body.appendChild(back);
    const close = v => { back.remove(); resolve(v); };
    btns.forEach((b, i) => {
      U.$('[data-i="' + i + '"]', back).addEventListener('click', () => {
        if (b.validate && b.validate(back) === false) return;
        if (b.onClick) b.onClick(back);
        if (!b.keepOpen) close(b.value === undefined ? null : (typeof b.value === 'function' ? b.value(back) : b.value));
      });
    });
    back.addEventListener('mousedown', e => { if (e.target === back && !opts.modalOnly) close(null); });
    if (opts.onOpen) opts.onOpen(back, close);
    const first = U.$('input,textarea,select', back);
    if (first && !opts.noFocus) first.focus();
  });
};
U.confirm = function (msg, okText, danger) {
  return U.modal({
    title: '請確認', html: '<p class="confirm-msg">' + U.esc(msg).replace(/\n/g, '<br>') + '</p>',
    buttons: [{ text: '取消', value: false }, { text: okText || '確定', cls: danger ? 'danger' : 'primary', value: true }]
  }).then(v => v === true);
};

U.download = function (filename, text, mime) {
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
};
U.copy = function (text) {
  const done = () => U.toast('已複製：' + text);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, () => U.copyFallback(text, done));
  } else U.copyFallback(text, done);
};
U.copyFallback = function (text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { U.toast('複製失敗，請手動選取', 'err'); }
  ta.remove();
};
U.safeFile = s => String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'export';
