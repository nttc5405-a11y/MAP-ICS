/* 登入首頁：進入既有案件（案件驗證碼）、建立新案件（管理員密碼）、只看看板（檢視碼） */
const Login = {
  KEY: 'ccs_session',
  cases: [],
  needCreatePass: false,

  /* ---------- 登入狀態（存在這個瀏覽器） ---------- */
  session() { try { const s = JSON.parse(U.store.get(Login.KEY, '')); return s && s.caseId ? s : null; } catch (e) { return null; } },
  save(caseId, pass) { U.store.set(Login.KEY, JSON.stringify({ caseId: caseId, pass: pass || '' })); },
  clear() { U.store.del(Login.KEY); },

  bind() {
    U.$('#lg-enter').addEventListener('click', Login.enter);
    U.$('#lg-create').addEventListener('click', Login.create);
    U.$('#lg-board').addEventListener('click', Login.board);
    U.$('#lg-closed').addEventListener('change', Login.fillCases);
    U.$('#lg-settings').addEventListener('click', () => App.openSettings());
    U.$('#lg-forget').addEventListener('click', async () => {
      if (!await U.confirm('清除後，這個瀏覽器就不再有管理員權限（不能建案，也不能免驗證碼進入案件）。\n之後要再用，需重新輸入管理員密碼。', '清除', true)) return;
      U.store.del(Api.KEY_TOKEN); U.toast('已清除此瀏覽器的管理員密碼', 'ok'); Login.show();
    });
    ['lg-pass', 'lg-bpass'].forEach(id => U.$('#' + id).addEventListener('keydown', e => {
      if (e.key === 'Enter') (id === 'lg-pass' ? Login.enter : Login.board)();
    }));
  },

  async show(msg) {
    document.body.classList.add('logged-out');
    U.$('#login').hidden = false;
    U.$('#lg-name').value = U.store.get(Api.KEY_ACTOR, '');
    U.$('#lg-mode').textContent = Api.modeName();
    U.$('#lg-mode').className = 'mode-badge ' + (Api.isLocal() ? 'local' : 'gas');
    const isAdmin = !!(Api.token() && !Api.isLocal());
    U.$('#lg-admin-hint').hidden = !isAdmin;
    // 管理員密碼欄不預先填入（避免被旁人看到或複製）；此瀏覽器已存密碼時可留空
    U.$('#lg-adminpw').value = '';
    U.$('#lg-adminpw').placeholder = isAdmin ? '管理員密碼（此瀏覽器已儲存，可留空）' : '管理員密碼（管理權杖）';
    // 「連線設定」只給管理員／練習模式／網址帶 ?settings=1 的人看；一般同仁用不到
    U.$('#lg-settings').hidden = !(isAdmin || Api.isLocal() || /[?&]settings=1/.test(location.search));
    U.$('#lg-forget').hidden = !isAdmin;
    const m = U.$('#lg-msg'); m.hidden = !msg; m.textContent = msg || '';
    ['lg-pass', 'lg-newname', 'lg-newplace', 'lg-newpass', 'lg-bpass'].forEach(id => { U.$('#' + id).value = ''; });   // 登出後不殘留上一次輸入
    App.loadMarquee();
    await Login.load();
  },
  /* 依後端設定顯示建案密碼欄：設定分頁「建案密碼」有填 → 一般人要輸入；空白 → 任何人都能建案（管理員瀏覽器可留空） */
  applySettings(s) {
    Login.needCreatePass = !!s.createRequiresPassword;
    const isAdmin = !!(Api.token() && !Api.isLocal()), f = U.$('#lg-adminpw'), hint = U.$('#lg-create-hint');
    f.hidden = Api.isLocal() || !(isAdmin || Login.needCreatePass);
    f.placeholder = isAdmin ? '管理員密碼（此瀏覽器已儲存，可留空）' : '建案密碼（向管理員索取）';
    hint.textContent = Api.isLocal() ? '' : isAdmin ? (Login.needCreatePass ? '目前建案需要密碼；此瀏覽器是管理員，可直接建立。' : '目前開放任何人建立案件。')
      : Login.needCreatePass ? '建立案件需要建案密碼，請向管理員索取。' : '目前開放任何人建立案件。';
  },
  hide() { U.$('#login').hidden = true; document.body.classList.remove('logged-out'); },

  async load() {
    const sel = U.$('#lg-case');
    sel.innerHTML = '<option>載入中…</option>';
    try {
      Login.cases = await Api.call('listCases');
      Login.fillCases();
    } catch (e) {
      sel.innerHTML = '<option value="">讀取案件清單失敗</option>';
      U.$('#lg-bcase').innerHTML = '<option value="">讀取案件清單失敗</option>';
      const m = U.$('#lg-msg'); m.hidden = false; m.textContent = '讀取案件清單失敗：' + e.message + '（請檢查網路，或按左下「連線設定」）';
    }
  },
  fillCases() {
    const showClosed = U.$('#lg-closed').checked;
    const open = Login.cases.filter(c => c.status === CFG.STATUS_OPEN), closed = Login.cases.filter(c => c.status !== CFG.STATUS_OPEN);
    const opt = c => '<option value="' + U.esc(c.id) + '">' + (c.status === CFG.STATUS_CLOSED ? '【已結案】' : '') + U.esc(c.id + '　' + c.name) + '</option>';
    const list = open.concat(showClosed ? closed : []);
    U.$('#lg-case').innerHTML = list.length ? list.map(opt).join('') : '<option value="">目前沒有進行中的案件，請在下方建立新案件</option>';
    U.$('#lg-bcase').innerHTML = Login.cases.length ? open.concat(closed).map(opt).join('') : '<option value="">目前沒有案件</option>';
  },

  /* 姓名：三個入口共用，寫入事件日誌的「操作者」 */
  name(required) {
    const n = U.$('#lg-name').value.trim();
    if (required && !n) { U.toast('請先填寫您的姓名', 'err'); U.$('#lg-name').focus(); return null; }
    if (n) U.store.set(Api.KEY_ACTOR, n);
    return n;
  },

  async enter() {
    if (Login.name(true) == null) return;
    const id = U.$('#lg-case').value, pass = U.$('#lg-pass').value.trim();
    if (!id) { U.toast('請先選擇案件', 'err'); return; }
    if (!pass && !(Api.token() && !Api.isLocal())) { U.toast('請輸入案件驗證碼', 'err'); U.$('#lg-pass').focus(); return; }
    await Login.busy(U.$('#lg-enter'), async () => {
      try {
        await Api.call('enterCase', { caseId: id, passcode: pass });
        Login.save(id, pass);
        Login.hide();
        if (!await App.openCase(id)) Login.show('開啟案件失敗，請重新登入');
      } catch (e) { U.toast(e.message, 'err'); }
    });
  },

  async create() {
    if (Login.name(true) == null) return;
    const v = id => U.$('#' + id).value.trim();
    const f = { name: v('lg-newname'), type: U.$('#lg-newtype').value, place: v('lg-newplace'), passcode: v('lg-newpass'), commander: Login.name() };
    if (!f.name) { U.toast('請填寫案件名稱', 'err'); return; }
    if (f.passcode.length < 4) { U.toast('請設定案件驗證碼（至少 4 個字元），並告知要進入的人', 'err'); return; }
    const adminpw = U.$('#lg-adminpw').value.trim();
    if (!Api.isLocal() && !adminpw && !Api.token() && Login.needCreatePass) { U.toast('建立案件需要建案密碼，請向管理員索取', 'err'); return; }
    await Login.busy(U.$('#lg-create'), async () => {
      try {
        const c = await Api.call('createCase', { fields: f, _token: adminpw, createPass: adminpw });
        if (adminpw && !Api.isLocal() && c.viaAdmin) U.store.set(Api.KEY_TOKEN, adminpw);   // 輸入的是管理員密碼才記住；建案密碼不記
        Login.save(c.id, f.passcode);
        Login.hide();
        U.toast('已建立案件 ' + c.id + '，驗證碼：' + f.passcode + '（請告知同仁）', 'ok');
        if (!await App.openCase(c.id)) Login.show('開啟案件失敗，請重新登入');
      } catch (e) { U.toast(e.message, 'err'); }
    });
  },

  /* 只看看板：先驗證檢視碼，再開啟看板頁（board.html） */
  async board() {
    const id = U.$('#lg-bcase').value, code = U.$('#lg-bpass').value.trim();
    if (!id) { U.toast('請先選擇案件', 'err'); return; }
    if (!code) { U.toast('請輸入看板檢視碼', 'err'); return; }
    await Login.busy(U.$('#lg-board'), async () => {
      try {
        await Api.call('getBoardVersion', { caseId: id, viewCode: code });
        const u = new URL('board.html', CFG.PUBLIC_URL || location.href);
        u.searchParams.set('case', id); u.searchParams.set('view', code);
        location.href = u.toString();
      } catch (e) { U.toast(e.message, 'err'); }
    });
  },

  /* 送出期間鎖住按鈕，避免連點重複送出 */
  async busy(btn, fn) {
    if (btn.disabled) return;
    const old = btn.textContent; btn.disabled = true; btn.textContent = '處理中…';
    try { await fn(); } finally { btn.disabled = false; btn.textContent = old; }
  }
};
