/* 部署：單位上圖、人員面板（確認／編組／撤銷）、案件 QR、名冊管理 */
const Deploy = {
  sub: 'units',

  /* ---------- 共用 ---------- */
  byId(id) { return App.state.units.find(u => u.id === id); },
  memberById(id) { return App.state.members.find(m => m.id === id); },

  /* 先改本機畫面（mutate），再寫後端；失敗就以後端資料為準重新讀取 */
  async w(action, params, mutate) {
    if (!App.needCase(true)) return null;
    try {
      if (mutate) { mutate(); Deploy.renderAll(); }
      const r = await App.run(() => Api.call(action, Object.assign({ caseId: App.state.cur.id }, params)));
      if (r && r.version) App.state.version = r.version;
      return r || {};
    } catch (e) {
      U.toast('操作失敗：' + e.message, 'err');
      await App.reloadCase(true);
      return null;
    }
  },

  async ensureRoster(force) {
    if (App.state.roster && !force) return App.state.roster;
    try { App.state.roster = await App.run(() => Api.call('getRoster', { caseId: App.state.cur ? App.state.cur.id : '' })); }
    catch (e) { U.toast('讀取名冊失敗：' + e.message, 'err'); App.state.roster = { units: [], people: [] }; return App.state.roster; }
    return App.state.roster;
  },

  /* 目前案件啟動的編組方案下，某人所屬的組別（沒啟動方案就是基本單位） */
  groupOf(p) { const sc = App.state.cur && App.state.cur.scheme; return (sc && p.schemes && p.schemes[sc]) || p.unit || ''; },
  activeGroups(roster) {
    const g = [];
    roster.people.filter(p => p.active !== '否').forEach(p => { const k = Deploy.groupOf(p); if (k && g.indexOf(k) < 0) g.push(k); });
    return g;
  },
  groupChoices(extra) {
    const set = [];
    const add = n => { if (n && set.indexOf(n) < 0) set.push(n); };
    App.state.units.forEach(u => add(u.name));
    if (App.state.roster) Deploy.activeGroups(App.state.roster).forEach(add);
    add(extra);
    return set;
  },

  bind() {
    U.$$('.seg-btn[data-sub]').forEach(b => b.addEventListener('click', () => Deploy.setSub(b.dataset.sub)));
    U.$('#btn-add-unit').addEventListener('click', Deploy.addUnitsDialog);
    U.$('#btn-add-member').addEventListener('click', Deploy.addMemberDialog);
    U.$('#btn-qr').addEventListener('click', Deploy.qrDialog);
    U.$('#btn-roster').addEventListener('click', Deploy.rosterDialog);
    U.$('#btn-scheme').addEventListener('click', Deploy.schemeDialog);
    U.$('#unit-list').addEventListener('click', Deploy.onUnitClick);
    U.$('#unit-list').addEventListener('change', Deploy.onUnitChange);
    U.$('#member-list').addEventListener('click', Deploy.onMemberClick);
    U.$('#member-list').addEventListener('change', Deploy.onMemberChange);
  },
  setSub(name) {
    Deploy.sub = name;
    U.$$('.seg-btn[data-sub]').forEach(b => b.classList.toggle('active', b.dataset.sub === name));
    U.$('#sub-units').hidden = name !== 'units';
    U.$('#sub-people').hidden = name !== 'people';
  },

  renderAll() {
    Deploy.renderUnits(); Deploy.renderMembers(); MapView.renderUnits();
    const pend = App.state.members.filter(m => m.status === '待確認').length;
    const badge = U.$('#badge-people');
    if (badge) { badge.textContent = pend; badge.hidden = !pend; }
    Tasks.renderAll(); Casualties.renderAll(); Mountain.renderAll();   // 單位／人員變動會影響任務顯示名稱
  },

  /* ---------- 單位 ---------- */
  renderUnits() {
    const box = U.$('#unit-list'); if (!box) return;
    const ro = App.state.readonly;
    if (!App.state.units.length) {
      box.innerHTML = '<div class="empty">還沒有部署任何單位。<br>按上方「＋ 加入單位」從名冊挑選。</div>'; return;
    }
    box.innerHTML = App.state.units.map(u => {
      const placed = u.lat !== '' && u.lng !== '' && u.lat != null && u.lng != null;
      const opts = CFG.UNIT_STATUS.map(s => '<option' + (s.id === u.status ? ' selected' : '') + '>' + s.id + '</option>').join('');
      const mcount = App.state.members.filter(m => m.status === '有效' && m.group === u.name).length;
      return '<div class="unit-item" data-id="' + U.esc(u.id) + '" style="border-left-color:' + CFG.unitColor(u.status) + '">' +
        '<div class="ui-top"><b>' + U.esc(u.name) + '</b>' +
        '<select data-f="status"' + (ro ? ' disabled' : '') + '>' + opts + '</select></div>' +
        '<div class="ui-sub">帶隊官：' + (u.leader ? U.esc(u.leader) : '<i>未設定</i>') + '　編組人數：' + mcount + '</div>' +
        (u.vehicles ? '<div class="ui-sub">車輛：' + U.esc(u.vehicles) + '</div>' : '') +
        '<div class="ui-btns">' +
        (placed ? '<button class="btn small" data-act="focus">定位</button>' : '<span class="hint">尚未上圖</span>') +
        (ro ? '' : '<button class="btn small" data-act="place">' + (placed ? '改位置' : '上圖') + '</button>' +
          '<button class="btn small" data-act="edit">編輯</button><button class="btn small danger" data-act="del">移除</button>') +
        '</div></div>';
    }).join('');
  },
  onUnitClick(e) {
    const it = e.target.closest('.unit-item'), btn = e.target.closest('[data-act]');
    if (!it || !btn) return;
    const id = it.dataset.id;
    ({ focus: () => MapView.focusUnit(id), place: () => Deploy.placeUnit(id), edit: () => Deploy.editUnit(id), del: () => Deploy.removeUnit(id) })[btn.dataset.act]();
  },
  onUnitChange(e) {
    const it = e.target.closest('.unit-item'); if (!it || e.target.dataset.f !== 'status') return;
    const u = Deploy.byId(it.dataset.id);
    Deploy.w('saveUnit', { unit: Object.assign({}, u, { status: e.target.value }) }, () => { u.status = e.target.value; });
  },
  highlight(id) {
    Deploy.setSub('units'); App.switchTab('deploy');
    U.$$('.unit-item').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
    const el = U.$('.unit-item[data-id="' + id + '"]'); if (el) el.scrollIntoView({ block: 'nearest' });
  },

  async addUnitsDialog() {
    if (!App.needCase(true)) return;
    const roster = await Deploy.ensureRoster();
    const have = App.state.units.map(u => u.name), sc = App.state.cur.scheme;
    const groups = Deploy.activeGroups(roster), avail = groups.filter(g => have.indexOf(g) < 0);
    const count = g => roster.people.filter(p => p.active !== '否' && Deploy.groupOf(p) === g).length;
    const html = '<div class="form">' +
      (roster.sample ? '<div class="warn">目前是範例名冊，請先到「名冊管理」改成實際人員。</div>' : '') +
      '<div class="hint">目前編組方案：<b>' + U.esc(sc || '依單位（預設）') + '</b>。下面是這個方案的組別；想改用別的編組，請先到「人員 → 啟動編組」。</div>' +
      (avail.length ? '<div class="check-list">' + avail.map(g =>
        '<label class="chk"><input type="checkbox" value="' + U.esc(g) + '"> ' + U.esc(g) + ' <span class="hint">名冊 ' + count(g) + ' 人</span></label>').join('') + '</div>'
        : '<div class="hint">這個方案的組別都已部署。</div>') +
      '<label>或輸入名冊外的單位（例：他縣市支援）<input id="au-custom" type="text" maxlength="40" placeholder="單位名稱"></label></div>';
    const v = await U.modal({
      title: '加入單位', html: html,
      buttons: [{ text: '取消', value: false }, {
        text: '加入', cls: 'primary',
        validate: el => { if (!U.$$('input[type=checkbox]:checked', el).length && !U.$('#au-custom', el).value.trim()) { U.toast('請勾選組別或輸入名稱', 'err'); return false; } },
        value: el => ({ names: U.$$('input[type=checkbox]:checked', el).map(x => x.value), custom: U.$('#au-custom', el).value.trim() })
      }]
    });
    if (!v || typeof v !== 'object') return;
    const names = v.names.concat(v.custom ? [v.custom] : []);
    const list = names.map(n => ({ id: U.uid('G'), name: n, vehicles: '', leader: '', lat: '', lng: '', status: '待命', updated: U.now() }));
    for (const u of list) {
      await Deploy.w('saveUnit', { unit: u }, () => App.state.units.push(u));
    }
    U.toast('已加入 ' + list.length + ' 個單位，可按「上圖」放到地圖上', 'ok');
  },

  placeUnit(id) {
    const u = Deploy.byId(id); if (!u) return;
    MapView.pick(ll => {
      Deploy.w('saveUnit', { unit: Object.assign({}, u, { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) }) },
        () => { u.lat = +ll.lat.toFixed(6); u.lng = +ll.lng.toFixed(6); });
    }, '請在地圖上點選「' + u.name + '」的位置（按 Esc 取消）');
  },
  onMoved(id, lat, lng) {
    const u = Deploy.byId(id); if (!u) return;
    Deploy.w('saveUnit', { unit: Object.assign({}, u, { lat: +lat.toFixed(6), lng: +lng.toFixed(6) }) },
      () => { u.lat = +lat.toFixed(6); u.lng = +lng.toFixed(6); });
  },
  async editUnit(id) {
    const u = Deploy.byId(id); if (!u) return;
    const names = App.state.members.filter(m => m.status === '有效' && (m.group === u.name || m.unit === u.name)).map(m => m.name);
    const html = '<div class="form"><div><b>' + U.esc(u.name) + '</b></div>' +
      '<label>帶隊官<input id="eu-leader" type="text" list="eu-names" maxlength="30" value="' + U.esc(u.leader) + '">' +
      '<datalist id="eu-names">' + names.map(n => '<option value="' + U.esc(n) + '">').join('') + '</datalist></label>' +
      '<label>車輛<input id="eu-veh" type="text" maxlength="80" value="' + U.esc(u.vehicles) + '" placeholder="例：水箱車、救護車"></label></div>';
    const v = await U.modal({
      title: '編輯單位', html: html,
      buttons: [{ text: '取消', value: false }, { text: '儲存', cls: 'primary', value: el => ({ leader: U.$('#eu-leader', el).value.trim(), vehicles: U.$('#eu-veh', el).value.trim() }) }]
    });
    if (!v || typeof v !== 'object') return;
    Deploy.w('saveUnit', { unit: Object.assign({}, u, v) }, () => Object.assign(u, v));
  },
  async removeUnit(id) {
    const u = Deploy.byId(id); if (!u) return;
    const used = App.state.tasks.filter(t => splitIds(t.assignUnits).indexOf(id) >= 0 && t.status !== '完成').length;
    if (!await U.confirm('確定移除單位「' + u.name + '」嗎？' + (used ? '\n它還被 ' + used + ' 個未完成任務指派。' : ''), '移除', true)) return;
    Deploy.w('deleteUnit', { unitId: id }, () => { App.state.units = App.state.units.filter(x => x.id !== id); });
  },

  /* ---------- 人員 ---------- */
  renderMembers() {
    const box = U.$('#member-list'); if (!box) return;
    const si = U.$('#scheme-info'); if (si) si.textContent = '目前編組方案：' + ((App.state.cur && App.state.cur.scheme) || '依單位（預設）');
    const ro = App.state.readonly, ms = App.state.members;
    const pending = ms.filter(m => m.status === '待確認'), active = ms.filter(m => m.status === '有效'), revoked = ms.filter(m => m.status === '已撤銷');
    const info = m => U.esc(m.unit || '（未填單位）') + '・' + U.esc(m.identity) + (m.phone ? '・' + U.esc(m.phone) : '');
    const sub = m => '<div class="ui-sub">加入 ' + U.esc((m.joined || '').slice(5, 16)) + (m.device ? '・' + U.esc(m.device) : '') + '</div>';
    let html = '';
    if (pending.length) {
      html += '<div class="sec-title warnbg">待確認的臨時人員（' + pending.length + '）</div>' + pending.map(m =>
        '<div class="member-item pend" data-id="' + U.esc(m.id) + '"><div class="ui-top"><b>' + U.esc(m.name) + '</b></div>' +
        '<div class="ui-sub">' + info(m) + '</div>' + sub(m) +
        (ro ? '' : '<div class="ui-btns"><button class="btn small primary" data-act="approve">確認並編組</button><button class="btn small danger" data-act="reject">拒絕</button></div>') + '</div>').join('');
    }
    html += '<div class="sec-title">已加入人員（' + active.length + '）</div>';
    html += active.length ? active.map(m => {
      const opts = ['<option value="">（未編組）</option>'].concat(Deploy.groupChoices(m.group).map(g => '<option' + (g === m.group ? ' selected' : '') + '>' + U.esc(g) + '</option>')).join('');
      return '<div class="member-item" data-id="' + U.esc(m.id) + '"><div class="ui-top"><b>' + U.esc(m.name) + '</b>' +
        (m.identity === '臨時' ? '<span class="tag tmp">臨時</span>' : '') + '</div>' +
        '<div class="ui-sub">' + info(m) + '</div>' + sub(m) +
        '<div class="ui-btns"><label class="inl">編組 <select data-f="group"' + (ro ? ' disabled' : '') + '>' + opts + '</select></label>' +
        (m.identity === '臨時' ? (Deploy.inRoster(m) ? '<span class="hint">✓ 已在名冊</span>' : '<button class="btn small" data-act="toroster">加入名冊</button>') : '') +
        (ro ? '' : '<button class="btn small danger" data-act="revoke">撤銷</button>') + '</div></div>';
    }).join('') : '<div class="empty">還沒有人員加入。<br>可用「案件 QR Code」讓現場人員掃描，或按「＋ 代為加入」。</div>';
    if (revoked.length) {
      html += '<details class="revoked"><summary>已撤銷／拒絕（' + revoked.length + '）</summary>' +
        revoked.map(m => '<div class="ui-sub pad4">' + U.esc(m.name) + '・' + info(m) + '</div>').join('') + '</details>';
    }
    box.innerHTML = html;
  },
  onMemberClick(e) {
    const it = e.target.closest('.member-item'), btn = e.target.closest('[data-act]');
    if (!it || !btn) return;
    const id = it.dataset.id, a = btn.dataset.act;
    if (a === 'approve') Deploy.approve(id); else if (a === 'reject') Deploy.reject(id); else if (a === 'revoke') Deploy.revoke(id);
    else if (a === 'toroster') Deploy.toRoster(id);
  },
  rosterErr(prefix, e) {
    return /管理員密碼/.test(e.message) ? prefix + '：修改總表名冊需要管理員登入（目前是用案件驗證碼登入）' : prefix + '：' + e.message;
  },
  /* 這位臨時人員是否已在總表名冊（名冊尚未載入時視為不在） */
  inRoster(m) {
    const r = App.state.roster;
    return !!(r && r.people.some(p => p.name === m.name && p.unit === (m.unit || '')));
  },
  /* 臨時人員一鍵加入總表名冊（之後掃 QR 可直接從名冊選自己；結案後也能做，因為名冊是跨案件共用的） */
  async toRoster(id) {
    const m = Deploy.memberById(id); if (!m) return;
    try {
      const roster = await Deploy.ensureRoster(true);   // 先讀最新名冊，避免蓋掉別人剛改的
      let unit = m.unit || '';
      if (!unit) {
        const v = await U.modal({
          title: '加入名冊：請指定單位', html: '<div class="form"><div><b>' + U.esc(m.name) + '</b> 沒有填單位。</div>' +
            '<label>單位<input id="tr-unit" type="text" list="tr-ul" maxlength="30" placeholder="選擇或輸入單位名稱"><datalist id="tr-ul">' +
            roster.units.map(u => '<option value="' + U.esc(u.name) + '">').join('') + '</datalist></label></div>',
          buttons: [{ text: '取消', value: false }, { text: '加入名冊', cls: 'primary', validate: el => { if (!U.$('#tr-unit', el).value.trim()) { U.toast('請填單位', 'err'); return false; } }, value: el => U.$('#tr-unit', el).value.trim() }]
        });
        if (!v || typeof v !== 'string') return;
        unit = v;
      }
      if (roster.people.some(p => p.name === m.name && p.unit === unit)) { U.toast(m.name + '（' + unit + '）已經在名冊中'); Deploy.renderAll(); return; }
      const people = roster.people.concat([{ id: U.uid('P'), unit: unit, name: m.name, title: '', order: roster.people.length + 1, active: '是' }]);
      const rbase = roster.baseName || '單位';
      App.state.roster = await App.run(() => Api.call('saveRoster', { people: people, baseName: rbase, schemeNames: (roster.schemeNames || []).filter(n => n !== rbase) }));
      U.toast('已將 ' + m.name + '（' + unit + '）加入名冊', 'ok');
      Deploy.renderAll();
    } catch (e) { U.toast(Deploy.rosterErr('加入名冊失敗', e), 'err'); }
  },
  onMemberChange(e) {
    const it = e.target.closest('.member-item'); if (!it || e.target.dataset.f !== 'group') return;
    const m = Deploy.memberById(it.dataset.id), g = e.target.value;
    Deploy.w('setMemberGroup', { memberId: m.id, group: g }, () => { m.group = g; });
  },
  async approve(id) {
    const m = Deploy.memberById(id); if (!m) return;
    await Deploy.ensureRoster();
    const opts = Deploy.groupChoices(m.unit).map(g => '<option' + (g === m.unit ? ' selected' : '') + '>' + U.esc(g) + '</option>').join('');
    const v = await U.modal({
      title: '確認臨時人員', html: '<div class="form"><p><b>' + U.esc(m.name) + '</b>（' + U.esc(m.unit || '未填單位') + '）' + (m.phone ? '<br>電話 ' + U.esc(m.phone) : '') +
        '</p><label>編組單位<select id="ap-group"><option value="">（暫不編組）</option>' + opts + '</select></label>' +
        '<div class="hint">確認後，對方手機下次更新時會自動解鎖，可以看任務與回報。</div></div>',
      buttons: [{ text: '取消', value: false }, { text: '確認加入', cls: 'primary', value: el => ({ group: U.$('#ap-group', el).value }) }]
    });
    if (!v || typeof v !== 'object') return;
    Deploy.w('approveMember', { memberId: id, approve: true, group: v.group }, () => { m.status = '有效'; m.group = v.group; });
  },
  async reject(id) {
    const m = Deploy.memberById(id); if (!m) return;
    if (!await U.confirm('確定拒絕「' + m.name + '」加入嗎？', '拒絕', true)) return;
    Deploy.w('approveMember', { memberId: id, approve: false }, () => { m.status = '已撤銷'; });
  },
  async revoke(id) {
    const m = Deploy.memberById(id); if (!m) return;
    const used = App.state.tasks.filter(t => splitIds(t.assignPeople).indexOf(id) >= 0 && t.status !== '完成').length;
    if (!await U.confirm('確定撤銷「' + m.name + '」嗎？\n對方手機會立即失去存取權。' + (used ? '\n他還被 ' + used + ' 個未完成任務指派。' : ''), '撤銷', true)) return;
    Deploy.w('revokeMember', { memberId: id }, () => { m.status = '已撤銷'; });
  },

  async addMemberDialog() {
    if (!App.needCase(true)) return;
    const roster = await Deploy.ensureRoster();
    const taken = App.state.members.filter(m => m.status !== '已撤銷').map(m => m.name + '|' + m.unit);
    const sc = App.state.cur.scheme;
    const gOpts = '<option value="">全部' + (sc ? '組別' : '單位') + '</option>' + Deploy.activeGroups(roster).map(g => '<option>' + U.esc(g) + '</option>').join('');
    const html = '<div class="form">' + (roster.sample ? '<div class="warn">目前是範例名冊，請先到「名冊管理」改成實際人員。</div>' : '') +
      '<div class="hint">目前編組方案：<b>' + U.esc(sc || '依單位（預設）') + '</b>，加入的人會歸入他在這個方案下的組別。</div>' +
      '<label>篩選' + (sc ? '組別' : '單位') + '<select id="am-unit">' + gOpts + '</select></label>' +
      '<div class="check-list" id="am-people"></div><hr>' +
      '<div class="hint">名冊找不到的人（臨時人員），直接填寫：</div>' +
      '<div class="row2"><label>姓名<input id="am-name" type="text" maxlength="20"></label><label>單位<input id="am-tunit" type="text" maxlength="30"></label></div>' +
      '<label>電話（選填）<input id="am-phone" type="text" maxlength="20"></label></div>';
    const v = await U.modal({
      title: '代為加入人員', html: html, wide: true,
      onOpen: el => {
        const draw = () => {
          const uf = U.$('#am-unit', el).value;
          U.$('#am-people', el).innerHTML = roster.people.filter(p => p.active !== '否' && (!uf || Deploy.groupOf(p) === uf)).map(p => {
            const dis = taken.indexOf(p.name + '|' + p.unit) >= 0, g = Deploy.groupOf(p);
            return '<label class="chk' + (dis ? ' dis' : '') + '"><input type="checkbox" value="' + U.esc(p.id) + '"' + (dis ? ' disabled' : '') + '> ' +
              U.esc(p.name) + ' <span class="hint">' + U.esc(g) + (g !== p.unit ? '（' + U.esc(p.unit) + '）' : '') + (p.title ? '・' + U.esc(p.title) : '') + (dis ? '（已在名單）' : '') + '</span></label>';
          }).join('') || '<div class="hint">沒有人員</div>';
        };
        U.$('#am-unit', el).addEventListener('change', draw); draw();
      },
      buttons: [{ text: '取消', value: false }, {
        text: '加入', cls: 'primary',
        validate: el => { if (!U.$$('#am-people input:checked', el).length && !U.$('#am-name', el).value.trim()) { U.toast('請勾選人員或填寫臨時人員姓名', 'err'); return false; } },
        value: el => ({
          ids: U.$$('#am-people input:checked', el).map(x => x.value),
          tmp: { name: U.$('#am-name', el).value.trim(), unit: U.$('#am-tunit', el).value.trim(), phone: U.$('#am-phone', el).value.trim() }
        })
      }]
    });
    if (!v || typeof v !== 'object') return;
    const adds = v.ids.map(id => roster.people.find(p => p.id === id)).filter(Boolean).map(p => ({ name: p.name, unit: p.unit, identity: '名冊' }));
    if (v.tmp.name) adds.push({ name: v.tmp.name, unit: v.tmp.unit, phone: v.tmp.phone, identity: '臨時' });
    let n = 0;
    for (const m of adds) {
      const r = await Deploy.w('addMember', { member: m });
      if (r && r.member) { App.state.members.push(r.member); n++; Deploy.renderAll(); }
    }
    if (n) { await App.reloadCase(true); U.toast('已加入 ' + n + ' 人', 'ok'); }
  },

  /* ---------- 案件 QR Code ---------- */
  joinUrl(c) {
    const u = new URL('field.html', CFG.PUBLIC_URL || location.href);
    u.searchParams.set('case', c.id); u.searchParams.set('code', c.joinCode);
    return u.toString();
  },
  async qrDialog() {
    if (!App.needCase()) return;
    const render = el => {
      const c = App.state.cur, url = Deploy.joinUrl(c);
      let svg = '<div class="warn">QR 元件沒載入成功，請檢查網路</div>';
      if (typeof qrcode === 'function') { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); svg = qr.createSvgTag(6, 6); }
      U.$('#qr-box', el).innerHTML = svg;
      U.$('#qr-url', el).textContent = url;
      U.$('#qr-code', el).textContent = c.joinCode;
    };
    const ro = App.state.readonly;
    await U.modal({
      title: '案件 QR Code（現場人員掃描加入）',
      html: '<div class="qr-wrap"><div id="qr-box" class="qr-box"></div>' +
        '<div class="qr-info"><div>加入碼　<b id="qr-code" class="big"></b></div><div class="hint" id="qr-url" style="word-break:break-all"></div>' +
        '<div class="btn-row"><button class="btn small" id="qr-copy">複製連結</button>' + (ro ? '' : '<button class="btn small danger" id="qr-regen">重新產生加入碼</button>') + '</div>' +
        '<div class="hint">加入碼每案不同，結案即失效。重新產生後，舊 QR 立刻失效，已加入的人不受影響。</div>' +
        '<div class="warn">手機版頁面（field.html）屬於第 3 階段，目前掃描還打不開。</div></div></div>',
      buttons: [{ text: '關閉', value: true }],
      onOpen: el => {
        render(el);
        U.$('#qr-copy', el).onclick = () => U.copy(Deploy.joinUrl(App.state.cur));
        const rg = U.$('#qr-regen', el);
        if (rg) rg.onclick = async () => {
          if (!await U.confirm('重新產生後，舊的 QR Code 會立刻失效。確定嗎？', '重新產生', true)) return;
          const r = await Deploy.w('regenJoinCode', {});
          if (r && r.joinCode) { App.state.cur.joinCode = r.joinCode; render(el); U.toast('已產生新的加入碼', 'ok'); }
        };
      }
    });
  },

  /* ---------- 啟動編組：把名冊的某個編組方案套用到這個案件 ---------- */
  async schemeDialog() {
    if (!App.needCase(true)) return;
    const roster = await Deploy.ensureRoster(true), cur = App.state.cur.scheme || '';
    const names = roster.schemeNames || [];
    const info = n => {
      const g = {}; roster.people.forEach(p => { const k = (p.schemes || {})[n]; if (k) g[k] = (g[k] || 0) + 1; });
      return g;
    };
    if (!names.length) { U.toast('名冊裡還沒有任何編組方案。請到「名冊管理」或直接在試算表人員名冊多加一欄。', 'err'); return; }
    const html = '<div class="form"><div class="hint">目前：<b>' + U.esc(cur || '依單位（預設）') + '</b></div>' +
      '<label>要啟動的編組方案<select id="sc-name">' + names.map(n => '<option value="' + U.esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + U.esc(n) + (n === roster.baseName ? '（基本單位）' : '') + '</option>').join('') + '</select></label>' +
      '<div id="sc-preview" class="sc-preview"></div>' +
      '<div class="hint">按下後：①該方案的每個組別會建立成可派遣的單位（待命）；②已在這個案件裡的人員，改歸入他在該方案下的組別；③之後加入的名冊人員也會自動歸組。之後名冊新增人員或組別，只要在試算表該方案欄位填好，有人加入時就會自動建立，不必重新啟動；也可以再按一次「啟動」重新套用。切換方案前請確認沒有進行中的任務用到舊組別。</div></div>';
    const v = await U.modal({
      title: '啟動編組', html: html, wide: true,
      onOpen: el => {
        const draw = () => {
          const g = info(U.$('#sc-name', el).value), keys = Object.keys(g);
          U.$('#sc-preview', el).innerHTML = keys.length ? keys.map(k => '<span class="chip">' + U.esc(k) + '（' + g[k] + ' 人）</span>').join('') : '<span class="warn">這個方案下沒有任何人有組別</span>';
        };
        U.$('#sc-name', el).addEventListener('change', draw); draw();
      },
      buttons: [{ text: '取消', value: false }, { text: '啟動', cls: 'primary', value: el => ({ scheme: U.$('#sc-name', el).value }) }]
    });
    if (!v || typeof v !== 'object') return;
    const r = await Deploy.w('applyScheme', { scheme: v.scheme });
    if (r) {
      await App.reloadCase(true);
      U.toast('已啟動「' + v.scheme + '」：新增 ' + r.added + ' 個單位，調整 ' + r.changed + ' 人', 'ok');
    }
  },

  /* ---------- 名冊管理 ---------- */
  async rosterDialog() {
    const roster = await Deploy.ensureRoster(true);
    const base = roster.baseName || '單位', extras = (roster.schemeNames || []).filter(n => n !== base);
    const pText = [[base, '姓名', '職務'].concat(extras).join(',')].concat(roster.people.map(p => [p.unit, p.name, p.title].concat(extras.map(n => (p.schemes || {})[n] || '')).join(','))).join('\n');
    const html = '<div class="form">' +
      (roster.sample ? '<div class="warn">目前是範例名冊（虛構姓名）。請貼上實際資料後儲存。</div>' : '') +
      '<div class="hint">一行一人，欄位用逗號或 Tab 分隔（可直接從 Excel 複製貼上）。第一行是標題列：<b>第 1 欄＝基本單位、姓名、職務，第 4 欄起每一欄是一種編組方案</b>（欄名＝方案名，例：人道編組），格內填他在該方案下的組別（管理組、UCC、搜救1組…）。<br>' +
      '不需要另外維護「單位名冊」：單位與組別由這張表自動產生。人員ID 由系統自動產生。</div>' +
      '<label>人員名冊<textarea id="ro-people" rows="14" spellcheck="false">' + U.esc(pText) + '</textarea></label>' +
      '<div class="file-row">或從檔案載入（CSV／TXT）：<input type="file" accept=".csv,.txt,.tsv" data-fill="ro-people"></div>' +
      '<div class="hint">儲存會取代整份名冊，不影響已建立案件中的人員與部署。要調整欄位順序或美化，可在試算表直接改，或請管理員執行 rearrangeRoster。</div></div>';
    const v = await U.modal({
      title: '名冊管理', html: html, wide: true,
      onOpen: el => {
        U.$$('input[data-fill]', el).forEach(inp => inp.addEventListener('change', async () => {
          const f = inp.files[0]; if (!f) return;
          const buf = await f.arrayBuffer();
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
          catch (e) { text = new TextDecoder('big5').decode(buf); }   // Excel 另存的 CSV 若是 ANSI（Big5）也能讀
          U.$('#' + inp.dataset.fill, el).value = text.replace(/^\uFEFF/, '').trim();
          U.toast('已載入 ' + f.name + '，確認內容後按「儲存名冊」', 'ok');
        }));
      },
      buttons: [{ text: '取消', value: false }, { text: '儲存名冊', cls: 'primary', value: el => ({ p: U.$('#ro-people', el).value }) }]
    });
    if (!v || typeof v !== 'object') return;
    const oldP = roster.people;
    // 第一行若是標題列（第二欄＝姓名），第 4 欄起的欄名就是「編組方案」
    const praw = v.p.replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.split(/[\t,，]/).map(x => x.trim().replace(/^"|"$/g, ''))).filter(r => r.some(x => x));
    const header = praw.length && praw[0][1] === '姓名' ? praw[0] : null;
    const baseName = (header && header[0]) ? header[0] : (roster.baseName || '單位');
    const schemeNames = header ? header.slice(3).filter(Boolean) : (roster.schemeNames || []).filter(n => n !== baseName);
    const people = praw.filter(r => r !== header && r[1]).map((r, i) => {
      const ex = oldP.find(x => x.unit === r[0] && x.name === r[1]);
      const schemes = {};
      schemeNames.forEach((n, k) => { schemes[n] = header ? (r[3 + k] || '') : ((ex && ex.schemes && ex.schemes[n]) || ''); });
      return { id: ex ? ex.id : U.uid('P'), unit: r[0], name: r[1], title: r[2] || '', order: i + 1, active: '是', schemes: schemes };
    });
    try {
      App.state.roster = await App.run(() => Api.call('saveRoster', { people: people, baseName: baseName, schemeNames: schemeNames }));
      U.toast('名冊已儲存：' + people.length + ' 人', 'ok');
      Deploy.renderAll();
    } catch (e) { U.toast(Deploy.rosterErr('儲存名冊失敗', e), 'err'); }
  }
};

/* 任務上存的 ID 清單（逗號分隔字串）→ 陣列 */
function splitIds(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); }
