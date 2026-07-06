const API = '/api';
let contacts = [];
let groups = [];
let templates = [];
let selected = new Set();
let waReady = false;
let sendingInProgress = false;

// ====== INIT ======
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            goTo(item.dataset.page);
        });
    });

    goTo('dashboard');
    checkWhatsAppStatus();

    // Проверяем статус каждые 3 секунды
    setInterval(checkWhatsAppStatus, 3000);
});

function goTo(page) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const nav = document.querySelector('[data-page="' + page + '"]');
    if (nav) nav.classList.add('active');

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');

    if (page === 'dashboard') loadStats();
    if (page === 'contacts') loadContacts();
    if (page === 'send') loadSendPage();
    if (page === 'templates') loadTemplates();
    if (page === 'groups') loadGroups();
    if (page === 'history') loadHistory();
    if (page === 'whatsapp') checkWhatsAppStatus();
}

// ====== FETCH ======
async function get(url) {
    const r = await fetch(API + url);
    return r.json();
}

async function post(url, data) {
    const r = await fetch(API + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return r.json();
}

async function put(url, data) {
    const r = await fetch(API + url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return r.json();
}

async function del(url) {
    const r = await fetch(API + url, { method: 'DELETE' });
    return r.json();
}

// ====== WHATSAPP STATUS ======
async function checkWhatsAppStatus() {
    try {
        const res = await get('/whatsapp/status');
        if (res.success) {
            const { ready, status, qr } = res.data;
            waReady = ready;

            // Sidebar dot
            const dot = document.getElementById('wa-dot');
            const text = document.getElementById('wa-status-text');
            dot.className = 'wa-status-dot ' + (ready ? 'green' : (qr ? 'orange' : 'red'));
            text.textContent = status;

            // Big status on WA page
            const dotBig = document.getElementById('wa-dot-big');
            const textBig = document.getElementById('wa-status-text-big');
            if (dotBig) {
                dotBig.className = 'wa-status-dot-big ' + (ready ? 'green' : (qr ? 'orange' : 'red'));
                textBig.textContent = status;
            }

            // QR code
            const qrContainer = document.getElementById('qr-container');
            const connectedInfo = document.getElementById('wa-connected-info');
            const btnConnect = document.getElementById('btn-connect');
            const btnLogout = document.getElementById('btn-logout');

            if (ready) {
                if (qrContainer) qrContainer.style.display = 'none';
                if (connectedInfo) connectedInfo.style.display = 'block';
                if (btnConnect) btnConnect.style.display = 'none';
                if (btnLogout) btnLogout.style.display = 'inline-flex';
            } else if (qr) {
                if (qrContainer) {
                    qrContainer.style.display = 'block';
                    document.getElementById('qr-image').src = qr;
                }
                if (connectedInfo) connectedInfo.style.display = 'none';
                if (btnConnect) btnConnect.style.display = 'none';
                if (btnLogout) btnLogout.style.display = 'none';
            } else {
                if (qrContainer) qrContainer.style.display = 'none';
                if (connectedInfo) connectedInfo.style.display = 'none';
                if (btnConnect) btnConnect.style.display = 'inline-flex';
                if (btnLogout) btnLogout.style.display = 'none';
            }

            // Warning on send page
            const warn = document.getElementById('send-not-connected');
            if (warn) warn.style.display = ready ? 'none' : 'flex';
        }
    } catch (e) {
        // Сервер недоступен
    }
}

async function connectWhatsApp() {
    const btn = document.getElementById('btn-connect');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Подключение...';
    btn.classList.add('sending');

    const res = await post('/whatsapp/connect', {});
    if (res.success) {
        toast('Подключение начато. Ждите QR-код...', 'info');
    } else {
        toast(res.message || 'Ошибка', 'error');
        btn.innerHTML = '<i class="fas fa-plug"></i> Подключить';
        btn.classList.remove('sending');
    }
}

async function logoutWhatsApp() {
    if (!confirm('Отключить WhatsApp?')) return;
    const res = await post('/whatsapp/logout', {});
    if (res.success) {
        toast('WhatsApp отключён', 'info');
        checkWhatsAppStatus();
    }
}

// ====== STATS ======
async function loadStats() {
    const res = await get('/stats');
    if (res.success) {
        document.getElementById('stat-contacts').textContent = res.data.totalContacts;
        document.getElementById('stat-groups').textContent = res.data.totalGroups;
        document.getElementById('stat-sent').textContent = res.data.totalSent;
        document.getElementById('stat-today').textContent = res.data.todaySent;
    }
}

// ====== CONTACTS ======
async function loadContacts() {
    const search = document.getElementById('inp-search')?.value || '';
    const group = document.getElementById('sel-filter-group')?.value || 'all';

    let url = '/contacts?';
    if (search) url += 'search=' + encodeURIComponent(search) + '&';
    if (group !== 'all') url += 'group=' + encodeURIComponent(group) + '&';

    const res = await get(url);
    if (res.success) {
        contacts = res.data;
        renderContacts();
    }
    await loadGroupFilter();
}

function renderContacts() {
    const tbody = document.getElementById('contacts-body');
    const empty = document.getElementById('empty-contacts');
    selected.clear();
    updateDelBtn();

    if (contacts.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = contacts.map(c => `
        <tr>
            <td><input type="checkbox" class="row-chk" data-id="${c.id}" onchange="toggleRow(${c.id})"></td>
            <td><strong>${esc(c.name)}</strong></td>
            <td>${esc(c.phone)}</td>
            <td><span class="badge">${esc(c.group_name)}</span></td>
            <td>
                <div class="action-btns">
                    <button class="btn green small" onclick="openSendOne(${c.id},'${esc(c.phone)}','${esc(c.name)}')" title="Отправить"><i class="fab fa-whatsapp"></i></button>
                    <button class="btn blue small" onclick="editContact(${c.id})" title="Ред."><i class="fas fa-edit"></i></button>
                    <button class="btn red small" onclick="delContact(${c.id})" title="Удалить"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadGroupFilter() {
    const res = await get('/groups');
    if (res.success) {
        groups = res.data;
        const sel = document.getElementById('sel-filter-group');
        const cur = sel.value;
        sel.innerHTML = '<option value="all">Все группы</option>' +
            groups.map(g => `<option value="${esc(g.name)}" ${cur===g.name?'selected':''}>${esc(g.name)} (${g.contact_count})</option>`).join('');

        const inpGrp = document.getElementById('inp-group');
        if (inpGrp) inpGrp.innerHTML = groups.map(g => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join('');
    }
}

function toggleAll() {
    const checked = document.getElementById('chk-all').checked;
    document.querySelectorAll('.row-chk').forEach(cb => {
        cb.checked = checked;
        checked ? selected.add(+cb.dataset.id) : selected.delete(+cb.dataset.id);
    });
    updateDelBtn();
}

function toggleRow(id) {
    selected.has(id) ? selected.delete(id) : selected.add(id);
    updateDelBtn();
}

function updateDelBtn() {
    const btn = document.getElementById('btn-del-selected');
    if (selected.size > 0) {
        btn.style.display = 'inline-flex';
        btn.innerHTML = '<i class="fas fa-trash"></i> Удалить (' + selected.size + ')';
    } else btn.style.display = 'none';
}

async function saveContact() {
    const id = document.getElementById('edit-id').value;
    const name = document.getElementById('inp-name').value.trim();
    const phone = document.getElementById('inp-phone').value.trim();
    const group_name = document.getElementById('inp-group').value;

    if (!name || !phone) { toast('Заполните имя и телефон', 'warning'); return; }

    let res;
    if (id) res = await put('/contacts/' + id, { name, phone, group_name });
    else res = await post('/contacts', { name, phone, group_name });

    if (res.success) {
        toast(id ? 'Обновлён' : 'Добавлен', 'success');
        closeModal();
        loadContacts();
    } else toast(res.message || 'Ошибка', 'error');
}

async function editContact(id) {
    const res = await get('/contacts/' + id);
    if (res.success) {
        const c = res.data;
        document.getElementById('contact-modal-title').textContent = 'Редактировать';
        document.getElementById('edit-id').value = c.id;
        document.getElementById('inp-name').value = c.name;
        document.getElementById('inp-phone').value = c.phone;
        await loadGroupFilter();
        document.getElementById('inp-group').value = c.group_name;
        openModal('modal-add-contact');
    }
}

async function delContact(id) {
    if (!confirm('Удалить?')) return;
    await del('/contacts/' + id);
    toast('Удалён', 'success');
    loadContacts();
}

async function deleteSelected() {
    if (!confirm('Удалить ' + selected.size + '?')) return;
    const res = await post('/contacts/delete-bulk', { ids: [...selected] });
    if (res.success) { toast(res.message, 'success'); selected.clear(); loadContacts(); }
}

async function doImport() {
    const raw = document.getElementById('inp-import').value.trim();
    if (!raw) { toast('Вставьте данные', 'warning'); return; }
    const list = raw.split('\n').filter(l => l.trim()).map(l => {
        const p = l.split(';').map(s => s.trim());
        return { name: p[0], phone: p[1], group_name: p[2] || 'Общая' };
    }).filter(c => c.name && c.phone);

    if (!list.length) { toast('Не распознано', 'error'); return; }
    const res = await post('/contacts/bulk', { contacts: list });
    if (res.success) { toast(res.message, 'success'); closeModal(); loadContacts(); }
}

// ====== SEND ONE (через реальный WhatsApp) ======
function openSendOne(id, phone, name) {
    if (!waReady) {
        toast('Сначала подключите WhatsApp!', 'warning');
        goTo('whatsapp');
        return;
    }

    document.getElementById('send-one-id').value = id;
    document.getElementById('send-one-phone').value = phone;
    document.getElementById('send-one-name').value = name;
    document.getElementById('send-one-title').textContent = 'Отправить: ' + name;
    document.getElementById('send-one-info').textContent = name + ' (' + phone + ')';
    document.getElementById('send-one-msg').value = '';
    openModal('modal-send-one');
}

async function doSendOne() {
    const phone = document.getElementById('send-one-phone').value;
    const name = document.getElementById('send-one-name').value;
    const contactId = document.getElementById('send-one-id').value;
    const message = document.getElementById('send-one-msg').value.trim();

    if (!message) { toast('Введите сообщение', 'warning'); return; }

    const btn = document.getElementById('btn-send-one');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Отправка...';
    btn.classList.add('sending');

    const personalMsg = message.replace(/{name}/g, name);

    const res = await post('/whatsapp/send', {
        phone: phone,
        message: personalMsg,
        contact_id: +contactId
    });

    btn.innerHTML = '<i class="fab fa-whatsapp"></i> Отправить';
    btn.classList.remove('sending');

    if (res.success) {
        toast('Сообщение отправлено ' + name + '!', 'success');
        closeModal();
    } else {
        toast('Ошибка: ' + (res.message || 'неизвестная'), 'error');
    }
}

// ====== MASS SEND ======
async function loadSendPage() {
    const cr = await get('/contacts');
    if (cr.success) contacts = cr.data;

    const gr = await get('/groups');
    if (gr.success) {
        groups = gr.data;
        document.getElementById('send-group-sel').innerHTML = '<option value="">-- группа --</option>' +
            groups.map(g => `<option value="${esc(g.name)}">${esc(g.name)} (${g.contact_count})</option>`).join('');
    }

    const tr = await get('/templates');
    if (tr.success) {
        templates = tr.data;
        document.getElementById('tpl-select').innerHTML = '<option value="">-- шаблон --</option>' +
            templates.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('');
    }

    updateRecipients();
    checkWhatsAppStatus();
}

function updateRecipients() {
    const type = document.querySelector('[name="rtype"]:checked').value;
    document.getElementById('send-group-wrap').style.display = type === 'group' ? 'block' : 'none';
    document.getElementById('send-pick-wrap').style.display = type === 'pick' ? 'block' : 'none';

    if (type === 'pick') {
        document.getElementById('pick-list').innerHTML = contacts.map(c => `
            <label class="pick-item">
                <input type="checkbox" class="pick-chk" data-id="${c.id}" onchange="updateRecipients()">
                ${esc(c.name)} (${esc(c.phone)})
            </label>
        `).join('');
    }

    let count = 0;
    if (type === 'all') count = contacts.length;
    else if (type === 'group') {
        const g = document.getElementById('send-group-sel').value;
        count = g ? contacts.filter(c => c.group_name === g).length : 0;
    } else if (type === 'pick') count = document.querySelectorAll('.pick-chk:checked').length;

    document.getElementById('rcpt-count').textContent = count;
}

function applyTemplate() {
    const id = +document.getElementById('tpl-select').value;
    const t = templates.find(t => t.id === id);
    if (t) document.getElementById('msg-text').value = t.body;
}

async function startSending() {
    if (sendingInProgress) { toast('Рассылка уже идёт!', 'warning'); return; }
    if (!waReady) { toast('WhatsApp не подключён!', 'warning'); goTo('whatsapp'); return; }

    const msg = document.getElementById('msg-text').value.trim();
    if (!msg) { toast('Введите сообщение', 'warning'); return; }

    const recipients = getRecipients();
    if (!recipients.length) { toast('Нет получателей', 'warning'); return; }

    const delay = +(document.getElementById('send-delay').value) || 5;

    if (!confirm('Отправить ' + recipients.length + ' контактам?\nЗадержка: ' + delay + ' сек.')) return;

    sendingInProgress = true;
    const btn = document.getElementById('btn-start-send');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Отправка...';
    btn.classList.add('sending');

    const wrap = document.getElementById('progress-wrap');
    const fill = document.getElementById('progress-fill');
    const txt = document.getElementById('progress-text');
    const log = document.getElementById('progress-log');

    wrap.style.display = 'block';
    fill.style.width = '0%';
    log.innerHTML = '';

    let sent = 0, failed = 0;

    for (let i = 0; i < recipients.length; i++) {
        const c = recipients[i];
        const personal = msg.replace(/{name}/g, c.name);

        try {
            const res = await post('/whatsapp/send', {
                phone: c.phone,
                message: personal,
                contact_id: c.id
            });

            if (res.success) {
                sent++;
                log.innerHTML += '<div><span class="log-ok">✓</span> ' + esc(c.name) + ' (' + c.phone + ') — отправлено</div>';
            } else {
                failed++;
                log.innerHTML += '<div><span class="log-err">✗</span> ' + esc(c.name) + ' — ' + (res.message || 'ошибка') + '</div>';
            }
        } catch (e) {
            failed++;
            log.innerHTML += '<div><span class="log-err">✗</span> ' + esc(c.name) + ' — ошибка сети</div>';
        }

        const pct = Math.round(((i + 1) / recipients.length) * 100);
        fill.style.width = pct + '%';
        txt.textContent = (i + 1) + ' / ' + recipients.length + ' (✓ ' + sent + ' / ✗ ' + failed + ')';
        log.scrollTop = log.scrollHeight;

        // Задержка между сообщениями
        if (i < recipients.length - 1) {
            await sleep(delay * 1000);
        }
    }

    sendingInProgress = false;
    btn.innerHTML = '<i class="fab fa-whatsapp"></i> Начать рассылку';
    btn.classList.remove('sending');

    toast('Готово! Отправлено: ' + sent + ', ошибок: ' + failed, sent > 0 ? 'success' : 'error');
}

function getRecipients() {
    const type = document.querySelector('[name="rtype"]:checked').value;
    if (type === 'all') return [...contacts];
    if (type === 'group') {
        const g = document.getElementById('send-group-sel').value;
        return contacts.filter(c => c.group_name === g);
    }
    if (type === 'pick') {
        const ids = new Set();
        document.querySelectorAll('.pick-chk:checked').forEach(cb => ids.add(+cb.dataset.id));
        return contacts.filter(c => ids.has(c.id));
    }
    return [];
}

// ====== TEMPLATES ======
async function loadTemplates() {
    const res = await get('/templates');
    if (res.success) {
        templates = res.data;
        const grid = document.getElementById('templates-grid');
        const empty = document.getElementById('empty-templates');
        if (!templates.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
        empty.style.display = 'none';
        grid.innerHTML = templates.map(t => `
            <div class="tpl-card">
                <h4>${esc(t.title)}</h4>
                <div class="tpl-body">${esc(t.body)}</div>
                <div class="tpl-btns">
                    <button class="btn green small" onclick="useTpl(${t.id})"><i class="fas fa-paper-plane"></i> Исп.</button>
                    <button class="btn red small" onclick="delTpl(${t.id})"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
    }
}

async function saveTpl() {
    const title = document.getElementById('inp-tpl-title').value.trim();
    const body = document.getElementById('inp-tpl-body').value.trim();
    if (!title || !body) { toast('Заполните', 'warning'); return; }
    const res = await post('/templates', { title, body });
    if (res.success) { toast('Создан', 'success'); closeModal(); loadTemplates(); }
}

async function delTpl(id) {
    if (!confirm('Удалить?')) return;
    await del('/templates/' + id);
    toast('Удалён', 'success');
    loadTemplates();
}

function useTpl(id) {
    const t = templates.find(t => t.id === id);
    if (t) { goTo('send'); setTimeout(() => { document.getElementById('msg-text').value = t.body; }, 150); }
}

// ====== GROUPS ======
async function loadGroups() {
    const res = await get('/groups');
    if (res.success) {
        groups = res.data;
        document.getElementById('groups-grid').innerHTML = groups.map(g => `
            <div class="grp-card">
                <div class="grp-dot" style="background:${g.color}">${g.name.charAt(0).toUpperCase()}</div>
                <div class="grp-info"><h4>${esc(g.name)}</h4><small>${g.contact_count||0} контактов</small></div>
                ${g.name!=='Общая'?'<button class="btn red small" onclick="delGroup('+g.id+')"><i class="fas fa-trash"></i></button>':''}
            </div>
        `).join('');
    }
}

async function saveGroup() {
    const name = document.getElementById('inp-grp-name').value.trim();
    const color = document.getElementById('inp-grp-color').value;
    if (!name) { toast('Название', 'warning'); return; }
    const res = await post('/groups', { name, color });
    if (res.success) { toast('Создана', 'success'); closeModal(); loadGroups(); }
    else toast(res.message, 'error');
}

async function delGroup(id) {
    if (!confirm('Удалить?')) return;
    await del('/groups/' + id);
    toast('Удалена', 'success');
    loadGroups();
}

// ====== HISTORY ======
async function loadHistory() {
    const res = await get('/history');
    const tbody = document.getElementById('history-body');
    const empty = document.getElementById('empty-history');
    if (!res.success || !res.data.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = res.data.map(h => `
        <tr>
            <td>${new Date(h.sent_at).toLocaleString('ru-RU')}</td>
            <td>${esc(h.contact_name||'Удалён')}</td>
            <td>${esc(h.contact_phone||'-')}</td>
            <td title="${esc(h.message||'')}">${esc((h.message||'').substring(0,40))}</td>
            <td><span class="badge ${h.status}">${h.status==='sent'?'✓ Отправлено':'✗ Ошибка'}</span></td>
        </tr>
    `).join('');
}

// ====== MODAL ======
function openModal(id) {
    if (id === 'modal-add-contact') {
        const editId = document.getElementById('edit-id');
        if (!editId.value) {
            document.getElementById('contact-modal-title').textContent = 'Добавить контакт';
            document.getElementById('inp-name').value = '';
            document.getElementById('inp-phone').value = '';
            loadGroupFilter();
        }
    }
    if (id === 'modal-add-tpl') {
        document.getElementById('inp-tpl-title').value = '';
        document.getElementById('inp-tpl-body').value = '';
    }
    if (id === 'modal-add-group') {
        document.getElementById('inp-grp-name').value = '';
        document.getElementById('inp-grp-color').value = '#3498db';
    }
    document.getElementById('overlay').classList.add('show');
    document.getElementById(id).classList.add('show');
}

function closeModal() {
    document.getElementById('overlay').classList.remove('show');
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
    document.getElementById('edit-id').value = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ====== TOAST ======
function toast(msg, type) {
    type = type || 'info';
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    const icons = { success:'check-circle', error:'exclamation-circle', warning:'exclamation-triangle', info:'info-circle' };
    el.innerHTML = '<i class="fas fa-' + icons[type] + '"></i> ' + msg;
    document.getElementById('toasts').appendChild(el);
    el.onclick = () => el.remove();
    setTimeout(() => { if (el.parentNode) el.remove(); }, 4000);
}

// ====== UTILS ======
function esc(s) { if(!s) return ''; const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }