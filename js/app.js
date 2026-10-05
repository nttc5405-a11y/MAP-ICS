/* 主程式：狀態、同步、設定、工具分頁 */
const App = {
  state: { cases: [], cur: null, zones: [], units: [], members: [], tasks: [], reports: [], casualties: [], plans: [], roster: null, version: 0, readonly: false },
  busy: 0,
  pollTimer: null,

  /* ---------- 啟動 ---------- */
  init() {
    App.loginFromHash();
    MapView.init('map');
    Zones.bindList();
    Cases.bindList();
    Deploy.bind();
    Tasks.bind();
    Casualties.bind();
    Mountain.bind();
    App.bindUi();
    App.updateModeBadge();
    Zones.renderList();
    Cases.renderCurrent();
    App.switchTab('cases');
    Login.bind();
    // 有登入紀錄就直接回到上次的案件；驗證碼失效或案件不存在就回登入頁
    const s = Login.session();
    if (s) App.openCase(s.caseId).then(ok => { if (!ok) Login.show('登入已失效，請重新登入'); });
    else Login.show();
    App.pollTimer = setInterval(App.poll, CFG.POLL_MS);
    App.loadMarquee(); setInterval(App.loadMarquee, 5 * 60 * 1000);   // 公告每 5 分鐘更新一次
    window.addEventListener('resize', U.debounce(() => MapView.invalidate(), 200));
  },

  bindUi() {
    U.$$('.tab-btn').forEach(b => b.addEventListener('click', () => App.switchTab(b.dataset.tab)));
    U.$('#btn-settings').addEventListener('click', App.openSettings);
    U.$('#btn-logout').addEventListener('click', async () => { if (await U.confirm('確定要登出嗎？\n登出後會回到登入頁。', '登出')) App.leaveCase(); });
    U.$('#btn-sidebar').addEventListener('click', () => {
      document.body.classList.toggle('side-hidden'); setTimeout(() => MapView.invalidate(), 250);
    });
    // 工具分頁
    U.$('#btn-import').addEventListener('click', () => {
      if (!App.needCase(true)) return; U.$('#file-import').click();
    });
    U.$('#file-import').addEventListener('change', App.onImportFile);
    U.$('#btn-export').addEventListener('click', () => { if (App.needCase()) Kml.exportCase(App.state.cur, App.state.zones); });
    U.$('#btn-fit').addEventListener('click', () => MapView.fitAll());
    U.$('#btn-log').addEventListener('click', App.openLog);
    U.$('#btn-board').addEventListener('click', App.boardDialog);
    U.$('#btn-goto').addEventListener('click', () => App.gotoFromInput(false));
    U.$('#btn-goto-save').addEventListener('click', () => { if (App.needCase(true)) App.gotoFromInput(true); });
    U.$('#goto-input').addEventListener('keydown', e => { if (e.key === 'Enter') App.gotoFromInput(false); });
  },

  switchTab(name) {
    U.$$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    U.$$('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
  },

  /* 需要先進入案件；forWrite=true 時案件不能是結案狀態 */
  needCase(forWrite) {
    if (!App.state.cur) { U.toast('請先登入並進入案件', 'err'); return false; }
    if (forWrite && App.state.readonly) { U.toast('案件已結案，請先重新開啟再修改', 'err'); return false; }
    return true;
  },

  /* 包住所有後端呼叫：記錄忙碌狀態（輪詢會避開）、更新同步指示 */
  async run(fn) {
    App.busy++; App.setSync('同步中…', 'busy');
    try { const r = await fn(); App.setSync('已同步 ' + U.now().slice(11), 'ok'); return r; }
    catch (e) { App.setSync('同步失敗', 'err'); throw e; }
    finally { App.busy--; }
  },
  setSync(text, cls) {
    const el = U.$('#sync'); if (!el) return;
    el.textContent = text; el.className = 'sync ' + (cls || '');
  },
  updateModeBadge() {
    const el = U.$('#mode-badge');
    el.textContent = Api.modeName();
    el.className = 'mode-badge ' + (Api.isLocal() ? 'local' : 'gas');
    el.title = Api.isLocal() ? '資料只存在這台電腦的瀏覽器，不會上傳。到「設定」填入 GAS 網址即可連線。' : '資料存於 Google 試算表與 Drive';
  },

  /* ---------- 案件進出 ---------- */
  async openCase(id) {
    try {
      const r = await App.run(() => Api.call('getCase', { caseId: id }));
      MapView.clearAll();
      App.setData(r);
      App.state.version = r.case.version;
      App.applyCase(r.case);
      MapView.showCase(r.case);
      MapView.renderZones();
      Zones.renderList();
      Deploy.renderAll();
      Deploy.ensureRoster().then(() => Deploy.renderAll());   // 載入名冊後，臨時人員的「已在名冊」才會正確顯示
      MapView.fitAll();
      U.store.set('ccs_last_case', id);
      App.switchTab('zones');
      return true;
    } catch (e) { U.toast('開啟案件失敗：' + e.message, 'err'); return false; }
  },
  /* 把 getCase 的回傳放進狀態 */
  setData(r) {
    App.state.cur = r.case;
    App.state.zones = r.zones || [];
    App.state.units = r.units || [];
    App.state.members = r.members || [];
    App.state.tasks = r.tasks || [];
    App.state.reports = r.reports || [];
    App.state.plans = r.plans || [];
    App.state.casualties = (r.casualties || []).map(c => Object.assign(c, { red: +c.red || 0, yellow: +c.yellow || 0, green: +c.green || 0, black: +c.black || 0 }));
  },
  /* 案件資料有變（結案、改名…）時更新畫面 */
  applyCase(c) {
    App.state.cur = c;
    App.state.version = Number(c.version) || App.state.version;
    App.state.readonly = c.status === CFG.STATUS_CLOSED;
    MapView.setReadonly(App.state.readonly);
    MapView.showCase(c);
    Zones.renderList();
    Deploy.renderAll();
    Cases.renderCurrent();
    const rb = U.$('#case-ribbon');
    rb.style.background = CFG.typeColor(c.type);
    rb.innerHTML = '<b>' + U.esc(c.type) + '</b> ' + U.esc(c.id) + '　' + U.esc(c.name) +
      (App.state.readonly ? '　<span class="ro">【已結案・唯讀】</span>' : '');
    rb.hidden = false;
    document.body.classList.toggle('readonly', App.state.readonly);
    Mountain.syncTab();
  },
  leaveCase() {
    App.state.cur = null; App.state.zones = []; App.state.units = []; App.state.members = []; App.state.tasks = []; App.state.reports = []; App.state.casualties = []; App.state.plans = [];
    App.state.roster = null; App.state.readonly = false; App.state.version = 0;
    MapView.clearAll(); MapView.setReadonly(false);
    U.store.del('ccs_last_case');
    Login.clear();
    U.$('#case-ribbon').hidden = true;
    document.body.classList.remove('readonly');
    Zones.renderList(); Deploy.renderAll(); Cases.renderCurrent();
    App.switchTab('cases');
    Login.show();
  },
  async reloadCase(force) {
    const c = App.state.cur; if (!c) return;
    if (!force && (MapView.isEditing() || U.$('.modal-back'))) return;
    try {
      const r = await Api.call('getCase', { caseId: c.id });
      App.setData(r);
      App.applyCase(r.case);
      MapView.renderZones();
      Zones.renderList();
      Deploy.renderAll();
    } catch (e) { U.toast('重新讀取失敗：' + e.message, 'err'); }
  },

  /* ---------- 同步輪詢：先問版本號，有變才讀全案 ---------- */
  async poll() {
    const c = App.state.cur;
    if (!c || App.busy > 0 || MapView.isEditing() || U.$('.modal-back') || document.hidden) return;
    try {
      const v = await Api.call('getVersion', { caseId: c.id });
      App.setSync('已同步 ' + U.now().slice(11), 'ok');
      if (Number(v.version) !== Number(App.state.version) || v.status !== c.status) {
        await App.reloadCase(false);
        U.toast('案件資料已由其他人更新', 'ok');
      }
    } catch (e) { App.setSync('同步失敗', 'err'); }
  },

  /* ---------- 工具：座標定位 ---------- */
  gotoFromInput(save) {
    const r = U.parseCoord(U.$('#goto-input').value);
    if (!r) { U.toast('座標格式看不懂。範例：22.75, 121.15 或 TWD97：280000, 2517000', 'err'); return; }
    MapView.gotoCoord(r.lat, r.lng, save);
  },

  /* ---------- 工具：匯入 ---------- */
  async onImportFile(ev) {
    const input = ev.target, file = input.files[0];
    input.value = '';
    if (!file) return;
    let res;
    try { res = await Kml.importFile(file); }
    catch (e) { U.toast('匯入失敗：' + e.message, 'err'); return; }
    if (!res.zones.length) {
      await U.modal({ title: '匯入結果', html: '<p>這個檔案裡沒有可匯入的圖形。</p>' + (res.skipped.length ? '<p class="hint">略過：' + res.skipped.map(U.esc).join('、') + '</p>' : ''), buttons: [{ text: '關閉', value: true }] });
      return;
    }
    const names = res.zones.slice(0, 12).map(z => '<li>' + U.esc(z.name) + '　<span class="hint">' + U.esc(CFG.GEOM_NAMES[z.geomType]) + (z.measure ? '・' + U.esc(z.measure) : '') + '</span></li>').join('');
    const html = '<p>共 <b>' + res.zones.length + '</b> 個圖形，類別將設為「匯入資料」（匯入後可逐一改類別）。</p>' +
      (res.simplified ? '<p class="hint">其中 ' + res.simplified + ' 個因節點過多已自動簡化。</p>' : '') +
      '<ul class="plain">' + names + (res.zones.length > 12 ? '<li>…還有 ' + (res.zones.length - 12) + ' 個</li>' : '') + '</ul>' +
      (res.skipped.length ? '<p class="warn">以下 ' + res.skipped.length + ' 項無法匯入：<br>' + res.skipped.slice(0, 8).map(U.esc).join('<br>') + '</p>' : '') +
      '<div class="form"><div class="row2"><label>匯入為<select id="im-cat">' +
      ['匯入資料'].concat(CFG.TRACK_CATS).map(c => '<option' + (c === (App.importCat || '匯入資料') ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></label>' +
      '<label>隊伍（搜索軌跡用）<select id="im-team"><option value="">（不指定）</option>' + App.state.units.map(u => '<option value="' + U.esc(u.id) + '">' + U.esc(u.name) + '</option>').join('') + '</select></label></div>' +
      '<div class="hint">計畫路線＝失蹤者原定行程；搜索軌跡＝隊伍實際走過（會算入搜索覆蓋範圍）；參考軌跡＝網路上的登山紀錄。</div></div>';
    const ok = await U.modal({ title: '匯入 ' + file.name, html: html, buttons: [{ text: '取消', value: false }, { text: '全部匯入', cls: 'primary',
      value: el => ({ cat: U.$('#im-cat', el).value, team: U.$('#im-team', el).value }) }] });
    App.importCat = '';
    if (!ok || typeof ok !== 'object') return;
    res.zones.forEach(z => {
      z.category = ok.cat; z.color = CFG.catColor(ok.cat);
      if (ok.cat === '搜索軌跡') z.teamId = ok.team;
    });
    try {
      const r = await App.run(() => Api.call('saveZones', {
        caseId: App.state.cur.id, zones: res.zones.map(Zones.clean), note: file.name
      }));
      App.state.version = r.version;
      await App.reloadCase(true);
      MapView.fitAll();
      U.toast('已匯入 ' + r.count + ' 個圖形', 'ok');
    } catch (e) { U.toast('匯入失敗：' + e.message, 'err'); }
  },

  /* ---------- 工具：事件日誌 ---------- */
  async openLog() {
    if (!App.needCase()) return;
    let rows;
    try { rows = await App.run(() => Api.call('getLog', { caseId: App.state.cur.id })); }
    catch (e) { U.toast('讀取日誌失敗：' + e.message, 'err'); return; }
    rows = rows.slice().sort((a, b) => (a.time < b.time ? -1 : 1));
    const body = rows.length ? '<div class="log-wrap"><table class="log"><thead><tr><th>時間</th><th>操作者</th><th>動作</th><th>內容</th></tr></thead><tbody>' +
      rows.map(r => '<tr><td>' + U.esc(r.time) + '</td><td>' + U.esc(r.actor) + '</td><td>' + U.esc(r.action) + '</td><td>' + U.esc(r.content) + '</td></tr>').join('') +
      '</tbody></table></div>' : '<p class="empty">還沒有任何紀錄</p>';
    const v = await U.modal({
      title: '事件日誌（' + rows.length + ' 筆）', html: body, wide: true,
      buttons: [{ text: '關閉', value: false }, { text: '匯出時序表 CSV', cls: 'primary', value: true }]
    });
    if (v === true) {
      const csv = ['時間,操作者,動作,對象ID,內容'].concat(rows.map(r =>
        [r.time, r.actor, r.action, r.target, r.content].map(x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"').join(','))).join('\r\n');
      U.download(U.safeFile(App.state.cur.id + '_時序表') + '.csv', '﻿' + csv, 'text/csv');   // BOM 讓 Excel 正確顯示中文
    }
  },

  /* 跑馬燈公告（文字與速度存在總表「設定」分頁） */
  async loadMarquee() {
    try {
      const s = await Api.call('getSettings');
      U.marquee(U.$('#mq-login'), s.marqueeText, s.marqueeSeconds);
      U.marquee(U.$('#mq-main'), s.marqueeText, s.marqueeSeconds);
    } catch (e) { /* 公告抓不到就不顯示，不影響使用 */ }
  },

  /* 指揮所登入連結：網址後面帶 #token=權杖，開啟時存進這個瀏覽器並立刻從網址列移除。
     井號後面的內容不會送到伺服器；把連結加入書籤，換裝置或換網址也不用再手動輸入。 */
  loginFromHash() {
    const m = /[#&]token=([^&]+)/.exec(location.hash || '');
    if (!m) return;
    try {
      U.store.set(Api.KEY_TOKEN, decodeURIComponent(m[1]));
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(() => U.toast('已記住管理權杖，這個瀏覽器之後不用再輸入', 'ok'), 800);
    } catch (e) { /* 網址格式不對就忽略 */ }
  },
  loginLink() {
    return new URL(location.pathname, location.origin).toString() + '#token=' + encodeURIComponent(Api.token());
  },

  /* ---------- 唯讀看板連結 ---------- */
  boardUrl(c) {
    const u = new URL('board.html', CFG.PUBLIC_URL || location.href);
    u.searchParams.set('case', c.id); u.searchParams.set('view', c.viewCode);
    return u.toString();
  },
  async boardDialog() {
    if (!App.needCase()) return;
    const render = el => {
      const c = App.state.cur, on = !!c.viewCode, ro = App.state.readonly;
      let svg = '';
      if (on && typeof qrcode === 'function') { const qr = qrcode(0, 'M'); qr.addData(App.boardUrl(c)); qr.make(); svg = qr.createSvgTag(5, 4); }
      U.$('#bd-body', el).innerHTML = on
        ? '<div class="qr-wrap"><div class="qr-box">' + svg + '</div><div class="qr-info"><div class="hint" style="word-break:break-all">' + U.esc(App.boardUrl(c)) + '</div>' +
          '<div class="btn-row"><button class="btn small" id="bd-copy">複製連結</button><button class="btn small" id="bd-open">開啟看板</button></div>' +
          (ro ? '' : '<div class="btn-row"><button class="btn small" id="bd-regen">重新產生（舊連結失效）</button><button class="btn small danger" id="bd-off">關閉連結</button></div>') +
          '<div class="hint">看板每 10 秒自動更新。按 F 鍵可縮放到全部內容。拿到連結的人都能看，請只給需要的人。</div></div></div>'
        : '<p>尚未啟用唯讀看板連結。</p>' + (ro ? '<div class="hint">案件已結案，無法新增連結。</div>' : '<button class="btn primary" id="bd-on">啟用並產生連結</button>');
      const q = id => U.$(id, el);
      if (q('#bd-copy')) q('#bd-copy').onclick = () => U.copy(App.boardUrl(c));
      if (q('#bd-open')) q('#bd-open').onclick = () => window.open(App.boardUrl(c), '_blank');
      const set = async disable => {
        const r = await Deploy.w('regenViewCode', { disable: disable });
        if (r) { App.state.cur.viewCode = r.viewCode; render(el); U.toast(disable ? '已關閉看板連結' : '已產生看板連結', 'ok'); }
      };
      if (q('#bd-on')) q('#bd-on').onclick = () => set(false);
      if (q('#bd-regen')) q('#bd-regen').onclick = async () => { if (await U.confirm('重新產生後，舊的看板連結會立刻失效。確定嗎？', '重新產生', true)) set(false); };
      if (q('#bd-off')) q('#bd-off').onclick = async () => { if (await U.confirm('關閉後，所有人都看不到看板。確定嗎？', '關閉', true)) set(true); };
    };
    await U.modal({ title: '唯讀看板（投電視）', html: '<div id="bd-body"></div>', buttons: [{ text: '關閉', value: true }], onOpen: render });
  },

  /* ---------- 設定 ---------- */
  async openSettings() {
    // 連線網址與管理權杖只給管理員（此瀏覽器已存權杖）、練習模式、或網址帶 ?settings=1 的人看；一般同仁只看得到姓名
    const admin = !!Api.token() || Api.isLocal() || /[?&]settings=1/.test(location.search);
    const html = '<div class="form">' +
      '<div class="hint">目前模式：<b>' + U.esc(Api.modeName()) + '</b>　版本 ' + CFG.VERSION + '</div>' +
      '<label>操作者姓名（寫入事件日誌）<input id="st-actor" type="text" maxlength="20" value="' + U.esc(U.store.get(Api.KEY_ACTOR, '')) + '" placeholder="例：王小明"></label>' +
      (admin ? '<label>GAS 網址（留空＝本機試用模式）<input id="st-url" type="text" value="' + U.esc(Api.gasUrl()) + '" placeholder="https://script.google.com/macros/s/…/exec"></label>' +
      '<label>管理權杖（API_TOKEN）<input id="st-token" type="password" autocomplete="off" value="' + U.esc(Api.token()) + '"></label>' +
      '<div><button class="btn small" id="st-test" type="button">測試連線</button> <span id="st-result" class="hint"></span></div>' +
      '<div><button class="btn small" id="st-link" type="button">複製「指揮所登入連結」</button> <span class="hint">加入書籤後，開啟就自動登入（連結內含權杖，請勿分享給別人）</span></div>' : '') +
      (Api.isLocal() ? '<hr><div><button class="btn small danger" id="st-clear" type="button">清空本機試用資料</button> <span class="hint">會刪除這台電腦上所有試用案件</span></div>' : '') +
      '</div>';
    const v = await U.modal({
      title: '設定', html: html,
      buttons: [{ text: '取消', value: false }, {
        text: '儲存', cls: 'primary',
        value: el => ({ actor: U.$('#st-actor', el).value.trim(), url: U.$('#st-url', el) ? U.$('#st-url', el).value.trim() : null, token: U.$('#st-token', el) ? U.$('#st-token', el).value.trim() : null })
      }],
      onOpen: el => {
        const stTest = U.$('#st-test', el);
        if (stTest) stTest.addEventListener('click', async () => {
          const out = U.$('#st-result', el), url = U.$('#st-url', el).value.trim(), tk = U.$('#st-token', el).value.trim();
          if (!url) { out.textContent = '本機試用模式不需要測試'; return; }
          out.textContent = '測試中…';
          const old = [Api.gasUrl(), Api.token()];
          U.store.set(Api.KEY_URL, url); U.store.set(Api.KEY_TOKEN, tk);
          try { const r = await Api.call('ping'); out.textContent = '✓ 連線成功（後端版本 ' + (r.version || '?') + '）'; out.style.color = '#2e7d32'; }
          catch (e) { out.textContent = '✗ ' + e.message; out.style.color = '#c62828'; }
          U.store.set(Api.KEY_URL, old[0]); U.store.set(Api.KEY_TOKEN, old[1]);   // 測試不改正式設定，按「儲存」才生效
        });
        const stLink = U.$('#st-link', el);
        if (stLink) stLink.addEventListener('click', () => {
          const tk = U.$('#st-token', el).value.trim();
          if (!tk) { U.toast('請先填入管理權杖', 'err'); return; }
          const old = U.store.get(Api.KEY_TOKEN, ''); U.store.set(Api.KEY_TOKEN, tk);
          const link = App.loginLink(); U.store.set(Api.KEY_TOKEN, old);
          U.copy(link);
        });
        const clr = U.$('#st-clear', el);
        if (clr) clr.addEventListener('click', async () => {
          if (await U.confirm('確定清空本機試用資料？\n所有試用案件與區域都會消失。', '清空', true)) {
            Api.clearLocal(); U.toast('已清空', 'ok'); location.reload();
          }
        });
      }
    });
    if (!v || typeof v !== 'object') return;
    const changed = v.url !== null && (v.url !== Api.gasUrl() || v.token !== Api.token());
    U.store.set(Api.KEY_ACTOR, v.actor);
    if (v.url !== null) { U.store.set(Api.KEY_URL, v.url); U.store.set(Api.KEY_TOKEN, v.token); }
    App.updateModeBadge();
    if (changed) { App.leaveCase(); U.toast('已切換為' + Api.modeName(), 'ok'); }
    else U.toast('設定已儲存', 'ok');
  }
};

document.addEventListener('DOMContentLoaded', App.init);
