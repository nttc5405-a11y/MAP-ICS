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
    try { App.state.roster = await App.run(() => Api.call('getRoster')); }
    catch (e) { U.toast('讀取名冊失敗：' + e.message, 'err'); App.state.roster = { units: [], people: [] }; }
    return App.state.roster;
  },

  groupChoices(extra) {
    const set = [];
    const add = n => { if (n && set.indexOf(n) < 0) set.push(n); };
    App.state.units.forEach(u => add(u.name));
    ((App.state.roster && App.state.roster.units) || []).forEach(u => add(u.name));
    add(extra);
    return set;
  },

  bind() {
    U.$$('.seg-btn[data-sub]').forEach(b => b.addEventListener('click', () => Deploy.setSub(b.dataset.sub)));
    U.$('#btn-add-unit').addEventListener('click', Deploy.addUnitsDialog);
    U.$('#btn-add-member').addEventListener('click', Deploy.addMemberDialog);
    U.$('#btn-qr').addEventListener('click', Deploy.qrDialog);
    U.$('#btn-roster').addEventListener('click', Deploy.rosterDialog);
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
    const have = App.state.units.map(u => u.id);
    const avail = roster.units.filter(u => have.indexOf(u.id) < 0);
    const html = '<div class="form">' +
      (roster.sample ? '<div class="warn">目前是範例名冊，請先到「名冊管理」改成實際單位。</div>' : '') +
      (avail.length ? '<div class="check-list">' + avail.map(u =>
        '<label class="chk"><input type="checkbox" value="' + U.esc(u.id) + '"> ' + U.esc(u.name) +
        ' <span class="hint">' + U.esc(u.category || '') + (u.vehicles ? '・' + U.esc(u.vehicles) : '') + '</span></label>').join('') + '</div>'
        : '<div class="hint">名冊中的單位都已部署。</div>') +
      '<label>或輸入名冊外的單位（例：他縣市支援）<input id="au-custom" type="text" maxlength="40" placeholder="單位名稱"></label></div>';
    const v = await U.modal({
      title: '加入單位', html: html,
      buttons: [{ text: '取消', value: false }, {
        text: '加入', cls: 'primary',
        validate: el => { if (!U.$$('input[type=checkbox]:checked', el).length && !U.$('#au-custom', el).value.trim()) { U.toast('請勾選單位或輸入名稱', 'err'); return false; } },
        value: el => ({ ids: U.$$('input[type=checkbox]:checked', el).map(x => x.value), custom: U.$('#au-custom', el).value.trim() })
      }]
    });
    if (!v || typeof v !== 'object') return;
    const list = v.ids.map(id => roster.units.find(u => u.id === id)).filter(Boolean).map(r => ({
      id: r.id, name: r.name, vehicles: r.vehicles || '', leader: '', lat: '', lng: '', status: '待命', updated: U.now()
    }));
    if (v.custom) list.push({ id: U.uid('X'), name: v.custom, vehicles: '', leader: '', lat: '', lng: '', status: '待命', updated: U.now() });
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
      const units = roster.units.slice();
      if (!units.some(u => u.name === unit)) units.push({ id: U.uid('U'), name: unit, category: '外部支援', vehicles: '', order: units.length + 1 });
      const people = roster.people.concat([{ id: U.uid('P'), unit: unit, name: m.name, title: '', order: roster.people.length + 1, active: '是' }]);
      App.state.roster = await App.run(() => Api.call('saveRoster', { units: units, people: people }));
      U.toast('已將 ' + m.name + '（' + unit + '）加入名冊', 'ok');
      Deploy.renderAll();
    } catch (e) { U.toast('加入名冊失敗：' + e.message, 'err'); }
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
    const unitOpts = '<option value="">全部單位</option>' + roster.units.map(u => '<option>' + U.esc(u.name) + '</option>').join('');
    const html = '<div class="form">' + (roster.sample ? '<div class="warn">目前是範例名冊，請先到「名冊管理」改成實際人員。</div>' : '') +
      '<label>篩選單位<select id="am-unit">' + unitOpts + '</select></label>' +
      '<div class="check-list" id="am-people"></div><hr>' +
      '<div class="hint">名冊找不到的人（臨時人員），直接填寫：</div>' +
      '<div class="row2"><label>姓名<input id="am-name" type="text" maxlength="20"></label><label>單位<input id="am-tunit" type="text" maxlength="30"></label></div>' +
      '<label>電話（選填）<input id="am-phone" type="text" maxlength="20"></label></div>';
    const v = await U.modal({
      title: '代為加入人員', html: html, wide: true,
      onOpen: el => {
        const draw = () => {
          const uf = U.$('#am-unit', el).value;
          U.$('#am-people', el).innerHTML = roster.people.filter(p => p.active !== '否' && (!uf || p.unit === uf)).map(p => {
            const dis = taken.indexOf(p.name + '|' + p.unit) >= 0;
            return '<label class="chk' + (dis ? ' dis' : '') + '"><input type="checkbox" value="' + U.esc(p.id) + '"' + (dis ? ' disabled' : '') + '> ' +
              U.esc(p.name) + ' <span class="hint">' + U.esc(p.unit) + (p.title ? '・' + U.esc(p.title) : '') + (dis ? '（已在名單）' : '') + '</span></label>';
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
    if (n) U.toast('已加入 ' + n + ' 人', 'ok');
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

  /* ---------- 名冊管理 ---------- */
  async rosterDialog() {
    const roster = await Deploy.ensureRoster(true);
    const uText = roster.units.map(u => [u.name, u.category, u.vehicles].join(',')).join('\n');
    const pText = roster.people.map(p => [p.unit, p.name, p.title].join(',')).join('\n');
    const html = '<div class="form">' +
      (roster.sample ? '<div class="warn">目前是範例名冊（虛構姓名）。請貼上實際資料後儲存。</div>' : '') +
      '<div class="hint">一行一筆，欄位用逗號或 Tab 分隔（可直接從 Excel 複製貼上）。</div>' +
      '<label>單位：名稱, 類別（分隊／義消／外部支援）, 車輛<textarea id="ro-units" rows="7" spellcheck="false">' + U.esc(uText) + '</textarea></label>' +
      '<div class="file-row">或從檔案載入單位（CSV／TXT）：<input type="file" accept=".csv,.txt,.tsv" data-fill="ro-units"></div>' +
      '<label>人員：單位, 姓名, 職務<textarea id="ro-people" rows="10" spellcheck="false">' + U.esc(pText) + '</textarea></label>' +
      '<div class="file-row">或從檔案載入人員（CSV／TXT）：<input type="file" accept=".csv,.txt,.tsv" data-fill="ro-people"></div>' +
      '<div class="hint">儲存會取代整份名冊，不影響已建立案件中的人員與部署。</div></div>';
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
      buttons: [{ text: '取消', value: false }, { text: '儲存名冊', cls: 'primary', value: el => ({ u: U.$('#ro-units', el).value, p: U.$('#ro-people', el).value }) }]
    });
    if (!v || typeof v !== 'object') return;
    const rows = t => t.replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.split(/[\t,，]/).map(x => x.trim().replace(/^"|"$/g, ''))).filter(r => r[0] && !(r[0] === '單位名稱' || r[0] === '名稱' || (r[0] === '單位' && r[1] === '姓名')));
    const oldU = roster.units, oldP = roster.people;
    const units = rows(v.u).map((r, i) => {
      const ex = oldU.find(x => x.name === r[0]);
      return { id: ex ? ex.id : U.uid('U'), name: r[0], category: r[1] || '分隊', vehicles: r[2] || '', order: i + 1 };
    });
    const people = rows(v.p).filter(r => r[1]).map((r, i) => {
      const ex = oldP.find(x => x.unit === r[0] && x.name === r[1]);
      return { id: ex ? ex.id : U.uid('P'), unit: r[0], name: r[1], title: r[2] || '', order: i + 1, active: '是' };
    });
    try {
      App.state.roster = await App.run(() => Api.call('saveRoster', { units: units, people: people }));
      U.toast('名冊已儲存：' + units.length + ' 個單位、' + people.length + ' 人', 'ok');
      Deploy.renderAll();
    } catch (e) { U.toast('儲存名冊失敗：' + e.message, 'err'); }
  }
};

/* 任務上存的 ID 清單（逗號分隔字串）→ 陣列 */
function splitIds(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); }
