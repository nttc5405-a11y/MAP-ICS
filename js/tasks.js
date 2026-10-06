/* 任務：派遣、狀態更新、代登回報 */
const Tasks = {
  filter: 'active',   // active | done | all

  byId(id) { return App.state.tasks.find(t => t.id === id); },
  hm(s) { return s ? String(s).slice(5, 16) : ''; },   // 'yyyy/MM/dd HH:mm:ss' → 'MM/dd HH:mm'

  bind() {
    U.$('#btn-new-task').addEventListener('click', () => Tasks.openForm(null));
    U.$('#btn-new-report').addEventListener('click', () => Tasks.reportDialog(null));
    U.$('#task-filter').addEventListener('change', e => { Tasks.filter = e.target.value; Tasks.renderAll(); });
    U.$('#task-list').addEventListener('click', Tasks.onClick);
    ['#task-list', '#report-list'].forEach(sel => U.$(sel).addEventListener('click', Tasks.onRepClick, true));
  },

  /* 任務編成：指派單位、單位內的有效人員、個別指派的人員 */
  crew(t) {
    const units = splitIds(t.assignUnits).map(id => Deploy.byId(id)).filter(Boolean);
    const names = units.map(u => u.name);
    const ms = App.state.members.filter(m => m.status === '有效');
    const fromUnits = ms.filter(m => names.indexOf(m.group || m.unit) >= 0);
    const direct = splitIds(t.assignPeople).map(id => Deploy.memberById(id)).filter(m => m && m.status === '有效');
    const all = fromUnits.concat(direct.filter(m => fromUnits.indexOf(m) < 0));
    return { units: units, unitNames: names, members: all };
  },
  /* 已被其他「未完成」任務佔用的單位與人員（排除正在編輯的那個任務）。回傳 { units: {id: 任務標題}, people: {id: 任務標題} } */
  busy(excludeId) {
    const units = {}, people = {};
    App.state.tasks.filter(t => t.id !== excludeId && t.status !== '完成').forEach(t => {
      splitIds(t.assignUnits).forEach(i => { units[i] = t.title; });
      splitIds(t.assignPeople).forEach(i => { people[i] = t.title; });
    });
    // 整隊被派出去 → 隊上有效成員也算任務中
    App.state.members.filter(m => m.status === '有效').forEach(m => {
      const u = App.state.units.find(x => x.name === (m.group || m.unit));
      if (u && units[u.id] && !people[m.id]) people[m.id] = units[u.id];
    });
    // 隊上有人被個別派出去 → 整隊不能再整隊派遣
    App.state.members.filter(m => m.status === '有效' && people[m.id]).forEach(m => {
      const u = App.state.units.find(x => x.name === (m.group || m.unit));
      if (u && !units[u.id]) units[u.id] = m.name + ' 在「' + people[m.id] + '」';
    });
    return { units: units, people: people };
  },
  unitNames(t) {
    return splitIds(t.assignUnits).map(id => { const u = Deploy.byId(id); return u ? u.name : '（已移除單位）'; });
  },
  peopleNames(t) {
    return splitIds(t.assignPeople).map(id => { const m = Deploy.memberById(id); return m ? m.name : '（已移除人員）'; });
  },

  hydrate() { const f = id => Api.call('getPhoto', { caseId: App.state.cur.id, photoId: id }); ['#task-list', '#report-list'].forEach(s => { const b = U.$(s); if (b) U.hydrateThumbs(b, f); }); },

  renderAll() {
    Tasks.renderList(); Tasks.renderReports(); Tasks.hydrate(); MapView.renderReports(); MapView.renderLabels();
    const open = App.state.tasks.filter(t => t.status !== '完成').length;
    const b = U.$('#badge-tasks'); if (b) { b.textContent = open; b.hidden = !open; }
  },

  renderList() {
    const box = U.$('#task-list'); if (!box) return;
    const ro = App.state.readonly, order = ['需支援', '已派遣', '已接收', '已抵達', '執行中', '完成'];
    const rows = App.state.tasks.filter(t => Tasks.filter === 'all' || (Tasks.filter === 'done') === (t.status === '完成'))
      .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (a.tAssigned < b.tAssigned ? 1 : -1));
    if (!rows.length) {
      box.innerHTML = '<div class="empty">' + (App.state.tasks.length ? '沒有符合條件的任務' : '還沒有任何任務。<br>按「＋ 派遣任務」開始。') + '</div>'; return;
    }
    box.innerHTML = rows.map(t => {
      const z = t.zoneId && Zones.byId(t.zoneId), col = CFG.taskColor(t.status);
      const units = Tasks.unitNames(t), people = Tasks.peopleNames(t);
      const reps = App.state.reports.filter(r => r.taskId === t.id).sort((a, b) => (a.time < b.time ? 1 : -1));
      const times = CFG.TASK_STATUS.filter(s => t[s.time]).map(s => '<span class="tl"><i style="background:' + s.color + '"></i>' + s.id + ' ' + Tasks.hm(t[s.time]) + '</span>').join('');
      const btns = CFG.TASK_STATUS.map(s => '<button class="st-btn' + (s.id === t.status ? ' on' : '') + '" style="--c:' + s.color + '" data-act="status" data-s="' + s.id + '"' + (ro ? ' disabled' : '') + '>' + s.id + '</button>').join('');
      return '<div class="task-item" data-id="' + U.esc(t.id) + '" style="border-left-color:' + col + '">' +
        '<div class="ui-top"><b class="t-title" style="color:' + col + '">' + U.esc(t.title) + '</b><span class="pill" style="background:' + col + '">' + U.esc(t.status) + '</span></div>' +
        (t.content ? '<div class="t-content">' + U.esc(t.content) + '</div>' : '') +
        '<div class="ui-sub">指派：' + (units.concat(people).map(U.esc).join('、') || '<i>未指派</i>') + '</div>' +
        (z ? '<div class="ui-sub">區域：<a href="#" data-act="zone">' + U.esc(Zones.pathName(z)) + '</a></div>' : '') +
        (t.hazard ? '<div class="zi-haz">⚠ ' + U.esc(t.hazard) + '</div>' : '') +
        '<div class="t-times">' + times + '</div>' +
        '<div class="st-row">' + btns + '</div>' +
        '<div class="ui-btns">' + (ro ? '' : '<button class="btn small" data-act="report">代登回報</button><button class="btn small" data-act="edit">編輯</button><button class="btn small danger" data-act="del">刪除</button>') + '</div>' +
        (reps.length ? '<details class="t-reps"><summary>回報（' + reps.length + '）</summary>' + reps.map(r =>
          '<div class="rep"><span class="hint">' + Tasks.hm(r.time) + '・' + U.esc(r.reporter || r.source) + '</span><br>' + U.esc(r.content) + Tasks.repBtns(r) + '</div>').join('') + '</details>' : '') +
        '</div>';
    }).join('');
  },

  renderReports() {
    const box = U.$('#report-list'); if (!box) return;
    const rows = App.state.reports.slice().sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, 15);
    box.innerHTML = rows.length ? rows.map(r => {
      const t = r.taskId && Tasks.byId(r.taskId);
      return '<div class="rep-item"><div class="hint">' + Tasks.hm(r.time) + '・' + U.esc(r.reporter || r.source) + '・' + U.esc(r.type) +
        (t ? '・' + U.esc(t.title) : '') + '</div><div>' + U.esc(r.content) + Tasks.repBtns(r) + '</div></div>';
    }).join('') : '<div class="empty small">尚無回報</div>';
  },

  /* 回報附帶的照片與位置按鈕 */
  repBtns(r) {
    const n = splitIds(r.photos).length;
    return (n ? '<div>' + U.thumbs(splitIds(r.photos)) + '</div>' : '') +
      (r.coord ? ' <button class="btn small" data-rp="loc" data-id="' + U.esc(r.id) + '">📍 位置</button>' : '');
  },
  onRepClick(e) {
    const b = e.target.closest('[data-rp]'); if (!b) return;
    e.stopPropagation();
    const r = App.state.reports.find(x => x.id === b.dataset.id); if (!r) return;
    if (b.dataset.rp === 'photo') Tasks.viewPhotos(r);
    else MapView.focusReport(r.id);
  },
  async viewPhotos(r) {
    const ids = splitIds(r.photos);
    U.modal({ title: '回報照片（' + ids.length + '）', html: '<div id="ph-box" class="ph-box"><div class="hint">載入中…</div></div>', wide: true, buttons: [{ text: '關閉', value: true }],
      onOpen: async el => {
        const box = U.$('#ph-box', el); box.innerHTML = '';
        for (const id of ids) {
          try {
            const p = await Api.call('getPhoto', { caseId: App.state.cur.id, photoId: id });
            const img = document.createElement('img');
            img.src = 'data:' + p.mime + ';base64,' + p.data; box.appendChild(img);
          } catch (err) { const d = document.createElement('div'); d.className = 'warn'; d.textContent = '照片讀取失敗：' + err.message; box.appendChild(d); }
        }
      } });
  },
  onClick(e) {
    const it = e.target.closest('.task-item'), btn = e.target.closest('[data-act]');
    if (!it || !btn) return;
    e.preventDefault();
    const id = it.dataset.id, a = btn.dataset.act;
    if (a === 'status') Tasks.setStatus(id, btn.dataset.s);
    else if (a === 'edit') Tasks.openForm(Tasks.byId(id));
    else if (a === 'del') Tasks.remove(id);
    else if (a === 'report') Tasks.reportDialog(id);
    else if (a === 'zone') { const t = Tasks.byId(id); if (t && t.zoneId) MapView.focusZone(t.zoneId); }
  },

  /* ---------- 狀態、刪除 ---------- */
  async setStatus(id, status) {
    const t = Tasks.byId(id); if (!t || t.status === status) return;
    const st = CFG.TASK_STATUS.find(s => s.id === status);
    const r = await Deploy.w('updateTaskStatus', { taskId: id, status: status }, () => { t.status = status; t[st.time] = U.now(); });
    if (r) Tasks.renderAll();
  },
  async remove(id) {
    const t = Tasks.byId(id); if (!t) return;
    if (!await U.confirm('確定刪除任務「' + t.title + '」嗎？\n（事件日誌會留下紀錄，相關回報會保留。）', '刪除', true)) return;
    await Deploy.w('deleteTask', { taskId: id }, () => { App.state.tasks = App.state.tasks.filter(x => x.id !== id); });
    Tasks.renderAll();
  },

  /* 讀取表單勾選：單位全員都勾 → 記為整單位派遣；只勾一部分 → 只記個別人員；無人員的單位 → 勾單位本身 */
  pick(el) {
    const units = [], people = [];
    U.$$('.tu', el).forEach(b => {
      const uid = b.dataset.uid, h = U.$('.uh', b), all = U.$$('input[name=ap]', b), on = all.filter(x => x.checked);
      if (!all.length) { if (h && h.checked) units.push(uid); return; }
      if (uid && on.length === all.length) units.push(uid); else on.forEach(x => people.push(x.value));
    });
    return { units: units, people: people };
  },

  /* ---------- 派遣／編輯表單 ---------- */
  async openForm(task) {
    if (!App.needCase(true)) return;
    const isNew = !task, t = task || {};
    const selU = splitIds(t.assignUnits), selP = splitIds(t.assignPeople);
    const zones = App.state.zones.map(z => '<option value="' + U.esc(z.id) + '"' + (z.id === t.zoneId ? ' selected' : '') + '>' + U.esc(Zones.pathName(z) + '（' + z.category + '）') + '</option>').join('');
    const busy = Tasks.busy(t.id);   // 已在其他未完成任務中的單位／人員不能再選
    // 只列出已加入案件的單位；每個單位底下列出其有效人員。勾單位 = 預設勾選全部可派人員，之後可個別取消
    const ms = App.state.members.filter(m => m.status === '有效');
    const unitOf = m => App.state.units.find(x => x.name === (m.group || m.unit));
    const mLabel = m => {
      const b = busy.people[m.id];
      return '<label class="chk tu-m' + (b ? ' dis' : '') + '"><input type="checkbox" name="ap" value="' + U.esc(m.id) + '"' + (b ? ' disabled' : '') + '> ' +
        U.esc(m.name) + (b ? ' <span class="hint">任務中：' + U.esc(b) + '</span>' : '') + '</label>';
    };
    const unitBlocks = App.state.units.map(u => {
      const mem = ms.filter(m => { const x = unitOf(m); return x && x.id === u.id; });
      const ub = !mem.length && busy.units[u.id];
      return '<div class="tu" data-uid="' + U.esc(u.id) + '"><label class="chk tu-h' + (ub ? ' dis' : '') + '"><input type="checkbox" class="uh" value="' + U.esc(u.id) + '"' + (ub ? ' disabled' : '') + '> <b>' + U.esc(u.name) + '</b> <span class="hint">' +
        (mem.length ? mem.length + ' 人' : '無人員，整單位派遣') + (ub ? '・任務中：' + U.esc(ub) : '') + '</span></label>' +
        (mem.length ? '<div class="tu-ms">' + mem.map(mLabel).join('') + '</div>' : '') + '</div>';
    }).join('');
    const others = ms.filter(m => !unitOf(m));
    const otherBlock = others.length ? '<div class="tu"><div class="hint" style="padding:4px 0">未編入已加入單位的人員</div><div class="tu-ms">' + others.map(mLabel).join('') + '</div></div>' : '';
    const sel = unitBlocks + otherBlock;
    const html = '<div class="form">' +
      '<label>任務標題<input id="tk-title" type="text" maxlength="60" value="' + U.esc(t.title) + '" placeholder="例：搜索 A 區"></label>' +
      '<label>任務內容<textarea id="tk-content" rows="3" maxlength="500">' + U.esc(t.content) + '</textarea></label>' +
      '<label>目標區域<select id="tk-zone"><option value="">（不指定）</option>' + zones + '</select></label>' +
      '<label>危險因子<input id="tk-hazard" type="text" maxlength="200" value="' + U.esc(t.hazard) + '" placeholder="選區域會自動帶入該區的危險因子"></label>' +
      '<div class="lbl">指派單位與人員' + (sel ? '　<span class="hint">勾單位＝全員出動，可再取消不派的人</span>' : '　<span class="hint">（先到「部署」加入單位）</span>') + '</div><div class="check-list tu-list">' + sel + '</div></div>';
    const v = await U.modal({
      title: isNew ? '派遣任務' : '編輯任務', html: html, wide: true,
      onOpen: el => {
        const blocks = U.$$('.tu', el);
        const mems = b => U.$$('input[name=ap]:not(:disabled)', b);
        const syncHead = b => {
          const h = U.$('.uh', b); if (!h || h.disabled) return;
          const m = mems(b), n = m.filter(x => x.checked).length;
          if (m.length) { h.checked = n === m.length; h.indeterminate = n > 0 && n < m.length; }
        };
        blocks.forEach(b => {
          const h = U.$('.uh', b);
          if (h) h.addEventListener('change', () => { h.indeterminate = false; mems(b).forEach(x => { x.checked = h.checked; }); });
          U.$$('input[name=ap]', b).forEach(x => x.addEventListener('change', () => syncHead(b)));
        });
        // 編輯既有任務：整單位派遣 → 該單位全員勾選；個別人員 → 照勾
        blocks.forEach(b => {
          const uid = b.dataset.uid, h = U.$('.uh', b);
          if (uid && selU.indexOf(uid) >= 0 && h && !h.disabled) { h.checked = true; mems(b).forEach(x => { x.checked = true; }); }
          U.$$('input[name=ap]', b).forEach(x => { if (selP.indexOf(x.value) >= 0 && !x.disabled) x.checked = true; });
          syncHead(b);
        });
        let auto = !t.hazard || (t.zoneId && Zones.byId(t.zoneId) && Zones.hazardOf(Zones.byId(t.zoneId)) === t.hazard);
        U.$('#tk-hazard', el).addEventListener('input', () => { auto = false; });
        U.$('#tk-zone', el).addEventListener('change', e => {
          const z = Zones.byId(e.target.value);
          if (z && Zones.hazardOf(z) && (auto || !U.$('#tk-hazard', el).value.trim())) { U.$('#tk-hazard', el).value = Zones.hazardOf(z); auto = true; }
        });
      },
      buttons: [{ text: '取消', value: false }, {
        text: isNew ? '派遣' : '儲存', cls: 'primary',
        validate: el => {
          if (!U.$('#tk-title', el).value.trim()) { U.toast('請填寫任務標題', 'err'); return false; }
          const c = Tasks.pick(el);
          if (!c.units.length && !c.people.length) { U.toast('請至少指派一個單位或人員', 'err'); return false; }
        },
        value: el => ({
          title: U.$('#tk-title', el).value.trim(), content: U.$('#tk-content', el).value.trim(),
          zoneId: U.$('#tk-zone', el).value, hazard: U.$('#tk-hazard', el).value.trim(),
          assignUnits: Tasks.pick(el).units.join(','),
          assignPeople: Tasks.pick(el).people.join(',')
        })
      }]
    });
    if (!v || typeof v !== 'object') return;
    const rec = Object.assign({}, t, v, { id: t.id || U.uid('T') });
    if (isNew) { rec.status = '已派遣'; rec.tAssigned = U.now(); }
    const r = await Deploy.w('saveTask', { task: rec }, () => {
      const i = App.state.tasks.findIndex(x => x.id === rec.id);
      if (i >= 0) App.state.tasks[i] = rec; else App.state.tasks.push(rec);
    });
    if (r) { Tasks.renderAll(); U.toast(isNew ? '已派遣：' + rec.title : '任務已更新', 'ok'); }
  },

  /* ---------- 代登回報（依無線電內容輸入） ---------- */
  async reportDialog(taskId) {
    if (!App.needCase(true)) return;
    const tasks = App.state.tasks.filter(t => t.status !== '完成' || t.id === taskId).map(t => '<option value="' + U.esc(t.id) + '"' + (t.id === taskId ? ' selected' : '') + '>' + U.esc(t.title + '（' + t.status + '）') + '</option>').join('');
    // 回報者：選了任務就只能選該任務編組內的人（含單位本身）；沒選任務則可選全部有效人員
    const whoOptions = tid => {
      const task = tid && Tasks.byId(tid);
      let opts;
      if (task) {
        const c = Tasks.crew(task);
        opts = c.unitNames.map(n => ({ v: n, t: n + '（單位）' })).concat(c.members.map(m => ({ v: m.name + '（' + m.unit + '）', t: m.name + '（' + (m.group || m.unit) + '）' })));
      } else {
        opts = App.state.units.map(u => ({ v: u.name, t: u.name + '（單位）' })).concat(App.state.members.filter(m => m.status === '有效').map(m => ({ v: m.name + '（' + m.unit + '）', t: m.name + '（' + (m.group || m.unit) + '）' })));
      }
      return opts.length ? '<option value="">請選擇回報者</option>' + opts.map(o => '<option value="' + U.esc(o.v) + '">' + U.esc(o.t) + '</option>').join('') : '<option value="">（此任務尚無可選的人員）</option>';
    };
    const sts = CFG.TASK_STATUS.map(s => '<option>' + s.id + '</option>').join('');
    const pb = U.photoBox(3);
    const html = '<div class="form">' +
      '<label>對應任務<select id="rp-task"><option value="">（不屬於任何任務）</option>' + tasks + '</select></label>' +
      '<div class="row2"><label>回報者（限該任務的編組）<select id="rp-who">' + whoOptions(taskId) + '</select></label>' +
      '<label>同時更新任務狀態<select id="rp-status"><option value="">不變更</option>' + sts + '</select></label></div>' +
      '<label>回報內容<textarea id="rp-content" rows="4" maxlength="500" placeholder="例：A 區北側發現足跡，往稜線方向"></textarea></label>' +
      pb.html('照片（選填）') + '<div class="hint">此為指揮所代登（來源記為「指揮所代登」）。</div></div>';
    const v = await U.modalWithPhotos({
      title: '代登回報', html: html, pb: pb, submitText: '送出',
      onOpen: el => { U.$('#rp-task', el).addEventListener('change', e => { U.$('#rp-who', el).innerHTML = whoOptions(e.target.value); }); },
      validate: el => {
        if (!U.$('#rp-who', el).value) { U.toast('請選擇回報者', 'err'); return false; }
        if (!U.$('#rp-content', el).value.trim() && !U.$('#rp-status', el).value && !pb.photos.length) { U.toast('請填寫回報內容、選擇狀態或附上照片', 'err'); return false; }
      },
      collect: el => ({ taskId: U.$('#rp-task', el).value, who: U.$('#rp-who', el).value.trim(), status: U.$('#rp-status', el).value, content: U.$('#rp-content', el).value.trim() })
    });
    if (!v || typeof v !== 'object') return;
    const t = v.taskId && Tasks.byId(v.taskId);
    const report = {
      id: U.uid('R'), taskId: v.taskId, zoneId: t ? t.zoneId : '', reporter: v.who, source: '指揮所代登',
      type: v.status ? '狀態' : '文字', content: v.content || (v.status ? '回報狀態：' + v.status : '（僅照片）'), photos: v.newPhotos.join(','), coord: '', time: U.now()
    };
    const r = await Deploy.w('submitReport', { report: report }, () => App.state.reports.push(report));
    if (r && v.status && t) await Tasks.setStatus(t.id, v.status);
    Tasks.renderAll();
    if (r) U.toast('回報已記錄', 'ok');
  }
};
