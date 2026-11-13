/* 案件：列表、建案、編輯、結案／重新開啟 */
const Cases = {
  statusFilter: CFG.STATUS_OPEN,
  keyword: '',

  async load() {
    try {
      App.state.cases = await App.run(() => Api.call('listCases'));
      Cases.renderList();
    } catch (e) { U.toast('讀取案件列表失敗：' + e.message, 'err'); }
  },

  renderList() {
    const box = U.$('#case-list'); if (!box) return;
    const kw = Cases.keyword.trim().toLowerCase();
    const rows = App.state.cases.filter(c =>
      (!Cases.statusFilter || c.status === Cases.statusFilter) &&
      (!kw || [c.id, c.name, c.place].join(' ').toLowerCase().indexOf(kw) >= 0));
    if (!rows.length) {
      box.innerHTML = '<div class="empty">' + (App.state.cases.length ? '沒有符合條件的案件' : '還沒有任何案件。<br>按上方「＋新建案件」開始。') + '</div>';
      return;
    }
    const curId = App.state.cur && App.state.cur.id;
    box.innerHTML = rows.map(c =>
      '<div class="case-item' + (c.id === curId ? ' cur' : '') + '" data-id="' + U.esc(c.id) + '" style="border-left-color:' + CFG.typeColor(c.type) + '">' +
      '<div class="ci-top"><span class="tag" style="background:' + CFG.typeColor(c.type) + '">' + U.esc(c.type) + '</span>' +
      '<span class="ci-id">' + U.esc(c.id) + '</span>' +
      '<span class="ci-st ' + (c.status === CFG.STATUS_OPEN ? 'open' : 'closed') + '">' + U.esc(c.status) + '</span></div>' +
      '<div class="ci-name">' + U.esc(c.name) + '</div>' +
      '<div class="ci-sub">' + U.esc(c.place || '（未填地點）') + (c.commander ? '・指揮官 ' + U.esc(c.commander) : '') + '</div></div>').join('');
  },

  bindList() { /* 案件清單與建案已移到登入頁（js/login.js） */ },

  /* 目前案件資訊卡（案件分頁最上方） */
  renderCurrent() {
    const box = U.$('#case-current'); const c = App.state.cur;
    if (!c) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML =
      '<div class="cc-head" style="background:' + CFG.typeColor(c.type) + '">' + U.esc(c.type) + '案件・' + U.esc(c.status) + '</div>' +
      '<div class="cc-body"><div class="cc-name">' + U.esc(c.name) + '</div>' +
      '<div class="cc-sub">編號 ' + U.esc(c.id) + '</div>' +
      (c.place ? '<div class="cc-sub">地點：' + U.esc(c.place) + '</div>' : '') +
      (c.commander ? '<div class="cc-sub">指揮官：' + U.esc(c.commander) + '</div>' : '') +
      '<div class="cc-sub">開始：' + U.esc(c.start || '') + (c.end ? '　結束：' + U.esc(c.end) : '') + '</div>' +
      (c.note ? '<div class="cc-note">' + U.esc(c.note) + '</div>' : '') +
      '<div class="cc-btns"><button class="btn small" id="cc-edit">編輯資料</button>' +
      (c.status === CFG.STATUS_OPEN
        ? '<button class="btn small danger" id="cc-close">結案</button>'
        : '<button class="btn small primary" id="cc-reopen">重新開啟</button>') +
      '<button class="btn small" id="cc-leave">離開案件（登出）</button>' +
      (Cases.canDelete() ? '<button class="btn small danger" id="cc-del">刪除此案件</button>' : '') + '</div></div>';
    U.$('#cc-edit').onclick = () => Cases.openForm(c);
    U.$('#cc-leave').onclick = () => App.leaveCase();
    const dl = U.$('#cc-del'); if (dl) dl.onclick = () => Cases.deleteDialog([c.id]);
    const cl = U.$('#cc-close'), ro = U.$('#cc-reopen');
    if (cl) cl.onclick = () => Cases.setStatus(CFG.STATUS_CLOSED);
    if (ro) ro.onclick = () => Cases.setStatus(CFG.STATUS_OPEN);
  },

  /* 批次刪除案件：只給管理員（此瀏覽器有管理權杖）或本機練習模式。preset＝預先勾選的案件編號陣列 */
  canDelete() { return Api.isLocal() || !!Api.token(); },
  async deleteDialog(preset) {
    if (!Cases.canDelete()) { U.toast('只有管理員能刪除案件', 'err'); return; }
    let list;
    try { list = await Api.call('listCases'); } catch (e) { U.toast(e.message, 'err'); return; }
    if (!list.length) { U.toast('目前沒有案件', 'ok'); return; }
    preset = preset || [];
    list = list.slice().sort((x, y) => (x.status === CFG.STATUS_OPEN) - (y.status === CFG.STATUS_OPEN) || (x.id < y.id ? 1 : -1));   // 已結案排前面
    const rows = list.map(k => '<label class="chk"><input type="checkbox" name="dc" value="' + U.esc(k.id) + '"' + (preset.indexOf(k.id) >= 0 ? ' checked' : '') + '> ' +
      (k.status !== CFG.STATUS_OPEN ? '<span class="hint">【已結案】</span>' : '<b style="color:#c62828">【進行中】</b>') + U.esc(k.id + '　' + k.name) + '</label>').join('');
    const html = '<div class="form"><div class="hint">勾選要刪除的案件。會一併刪除該案的<b>試算表、事件日誌、人員、任務、回報、傷患與所有照片</b>（整個案件資料夾）。<br>資料夾會先移到 Google Drive 垃圾桶，約 30 天內可在 Drive 還原；之後無法救回。</div>' +
      '<div><button class="btn small" type="button" id="dc-closed">全選已結案</button> <button class="btn small" type="button" id="dc-none">全部取消</button></div>' +
      '<div class="check-list" style="max-height:280px">' + rows + '</div>' +
      '<label>請輸入「刪除」兩個字確認<input id="dc-confirm" type="text" autocomplete="off" placeholder="刪除"></label></div>';
    const ids = await U.modal({
      title: '批次刪除案件', html: html, wide: true,
      onOpen: el => {
        U.$('#dc-closed', el).onclick = () => U.$$('input[name=dc]', el).forEach(x => { x.checked = /【已結案】/.test(x.closest('label').textContent); });
        U.$('#dc-none', el).onclick = () => U.$$('input[name=dc]', el).forEach(x => { x.checked = false; });
      },
      buttons: [{ text: '取消', value: false }, {
        text: '刪除所選案件', cls: 'danger',
        validate: el => {
          if (!U.$$('input[name=dc]:checked', el).length) { U.toast('請至少勾選一個案件', 'err'); return false; }
          if (U.$('#dc-confirm', el).value.trim() !== '刪除') { U.toast('請在確認欄輸入「刪除」', 'err'); return false; }
        },
        value: el => U.$$('input[name=dc]:checked', el).map(x => x.value)
      }]
    });
    if (!Array.isArray(ids) || !ids.length) return;
    const running = ids.filter(id => { const k = list.find(x => x.id === id); return k && k.status === CFG.STATUS_OPEN; });
    if (running.length && !await U.confirm('其中 ' + running.length + ' 個案件還在「進行中」（' + running.join('、') + '）。\n確定也要刪除嗎？', '確定刪除', true)) return;
    try {
      const r = await Api.call('deleteCases', { caseIds: ids });
      const bad = (r.failed || []).map(f => f.id + '：' + f.error);
      U.toast('已刪除 ' + r.deleted.length + ' 個案件' + (bad.length ? '；失敗 ' + bad.length + ' 個（' + bad.join('；') + '）' : ''), bad.length ? 'err' : 'ok');
      if (App.state.cur && r.deleted.indexOf(App.state.cur.id) >= 0) App.leaveCase();
      else if (!document.getElementById('login').hidden) Login.load();
    } catch (e) { U.toast(e.message, 'err'); }
  },

  async setStatus(status) {
    const closing = status === CFG.STATUS_CLOSED;
    const ok = await U.confirm(closing
      ? '確定要結案嗎？\n結案後地圖改為唯讀（可隨時重新開啟）。'
      : '確定要重新開啟這個案件嗎？', closing ? '結案' : '重新開啟', closing);
    if (!ok) return;
    try {
      const c = await App.run(() => Api.call('updateCase', { caseId: App.state.cur.id, fields: { status: status } }));
      App.applyCase(c);
      await Cases.load();
      U.toast(closing ? '案件已結案' : '案件已重新開啟', 'ok');
    } catch (e) { U.toast('操作失敗：' + e.message, 'err'); }
  },

  /* 建案／編輯共用表單；c 為 null 表示新建 */
  async openForm(c) {
    const isNew = !c; c = c || {};
    const typeOpts = CFG.CASE_TYPES.map(t => '<option' + (t.id === (c.type || '山域') ? ' selected' : '') + '>' + U.esc(t.id) + '</option>').join('');
    const coordVal = (c.lat !== undefined && c.lat !== '' && c.lng !== '') ? (Number(c.lat).toFixed(6) + ', ' + Number(c.lng).toFixed(6)) : '';
    const html = '<div class="form">' +
      '<label>案件名稱<input id="cf-name" type="text" maxlength="60" value="' + U.esc(c.name) + '" placeholder="例：0925 隆昌山難搜救"></label>' +
      '<div class="row2"><label>類型<select id="cf-type">' + typeOpts + '</select></label>' +
      '<label>指揮官<input id="cf-cmd" type="text" maxlength="30" value="' + U.esc(c.commander) + '"></label></div>' +
      '<label>地點<input id="cf-place" type="text" maxlength="80" value="' + U.esc(c.place) + '" placeholder="例：成功鎮隆昌山區"></label>' +
      '<label>座標（選填）<input id="cf-coord" type="text" value="' + U.esc(coordVal) + '" placeholder="WGS84「緯度, 經度」或 TWD97「東, 北」"></label>' +
      '<div class="hint" id="cf-coord-hint">兩個數字都大於 1000 會當作 TWD97，否則當作 WGS84。</div>' +
      '<label>案件驗證碼（進入案件用，至少 4 個字元）<input id="cf-pass" type="text" maxlength="30" value="' + U.esc(c.passcode) + '" placeholder="' + (isNew ? '' : '舊案件請在這裡設定') + '"></label>' +
      '<label>備註<textarea id="cf-note" rows="3" maxlength="500">' + U.esc(c.note) + '</textarea></label></div>';
    const v = await U.modal({
      title: isNew ? '新建案件' : '編輯案件資料', html: html,
      buttons: [{ text: '取消', value: false }, {
        text: isNew ? '建立案件' : '儲存', cls: 'primary',
        value: el => {
          const r = U.parseCoord(U.$('#cf-coord', el).value);
          return {
            name: U.$('#cf-name', el).value.trim(), type: U.$('#cf-type', el).value,
            commander: U.$('#cf-cmd', el).value.trim(), place: U.$('#cf-place', el).value.trim(),
            note: U.$('#cf-note', el).value.trim(),
            passcode: U.$('#cf-pass', el).value.trim(),
            lat: r ? +r.lat.toFixed(6) : '', lng: r ? +r.lng.toFixed(6) : ''
          };
        },
        validate: el => {
          if (!U.$('#cf-name', el).value.trim()) { U.toast('請填寫案件名稱', 'err'); return false; }
          const cs = U.$('#cf-coord', el).value.trim();
          if (cs && !U.parseCoord(cs)) { U.toast('座標格式看不懂，請檢查', 'err'); return false; }
          const ps = U.$('#cf-pass', el).value.trim();
          if (ps && ps.length < 4) { U.toast('案件驗證碼至少 4 個字元', 'err'); return false; }
        }
      }],
      onOpen: el => {
        const inp = U.$('#cf-coord', el), hint = U.$('#cf-coord-hint', el);
        inp.addEventListener('input', () => {
          const r = U.parseCoord(inp.value);
          hint.textContent = !inp.value.trim() ? '兩個數字都大於 1000 會當作 TWD97，否則當作 WGS84。'
            : r ? '✓ 辨識為 ' + r.src + '　→ WGS84 ' + U.fmtWgs(r.lat, r.lng) + '　TWD97 ' + U.fmtTwd(r.lat, r.lng) : '✗ 格式看不懂';
        });
      }
    });
    if (!v || typeof v !== 'object') return;
    try {
      if (isNew) {
        const nc = await App.run(() => Api.call('createCase', { fields: v }));
        await Cases.load();
        U.toast('已建立案件 ' + nc.id, 'ok');
        await App.openCase(nc.id);
      } else {
        if (!v.passcode) delete v.passcode;
        const uc = await App.run(() => Api.call('updateCase', { caseId: c.id, fields: v }));
        if (v.passcode) Login.save(c.id, v.passcode);   // 自己改了驗證碼，登入狀態跟著更新
        App.applyCase(uc);
        await Cases.load();
        U.toast('案件資料已更新', 'ok');
      }
    } catch (e) { U.toast((isNew ? '建立' : '更新') + '失敗：' + e.message, 'err'); }
  }
};
