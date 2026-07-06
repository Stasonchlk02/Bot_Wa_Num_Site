const express = require('express');
const path = require('path');
const { initDB, all, getOne, run } = require('./database');
const whatsapp = require('./whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ WHATSAPP API ============

// Статус подключения
app.get('/api/whatsapp/status', (req, res) => {
    res.json({ success: true, data: whatsapp.getStatus() });
});

// Подключить WhatsApp
app.post('/api/whatsapp/connect', async (req, res) => {
    try {
        res.json({ success: true, message: 'Подключение начато...' });
        // Инициализация в фоне
        whatsapp.initialize((status) => {
            console.log('WhatsApp статус:', status.status);
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Отключить WhatsApp
app.post('/api/whatsapp/logout', async (req, res) => {
    try {
        await whatsapp.logout();
        res.json({ success: true, message: 'Отключён' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Отправить одному
app.post('/api/whatsapp/send', async (req, res) => {
    try {
        const { phone, message, contact_id } = req.body;

        if (!phone || !message) {
            return res.status(400).json({ success: false, message: 'Нужен номер и сообщение' });
        }

        await whatsapp.sendMessage(phone, message);

        // Записываем в историю
        if (contact_id) {
            run('INSERT INTO history (contact_id, message, status) VALUES (?, ?, ?)',
                [contact_id, message, 'sent']);
        }

        res.json({ success: true, message: 'Отправлено!' });
    } catch (err) {
        // Записываем ошибку
        if (req.body.contact_id) {
            run('INSERT INTO history (contact_id, message, status) VALUES (?, ?, ?)',
                [req.body.contact_id, req.body.message, 'failed']);
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// Массовая отправка
app.post('/api/whatsapp/send-bulk', async (req, res) => {
    try {
        const { recipients, message, delay } = req.body;

        if (!recipients || !message) {
            return res.status(400).json({ success: false, message: 'Нужны получатели и сообщение' });
        }

        const status = whatsapp.getStatus();
        if (!status.ready) {
            return res.status(400).json({ success: false, message: 'WhatsApp не подключён!' });
        }

        // Отправляем асинхронно, возвращаем ответ сразу
        res.json({ success: true, message: 'Рассылка запущена', total: recipients.length });

        // Фоновая отправка
        const sendDelay = (delay || 3) * 1000;

        for (let i = 0; i < recipients.length; i++) {
            const r = recipients[i];
            const personalMsg = message.replace(/{name}/g, r.name);

            try {
                await whatsapp.sendMessage(r.phone, personalMsg);
                run('INSERT INTO history (contact_id, message, status) VALUES (?, ?, ?)',
                    [r.id, personalMsg, 'sent']);
                console.log('✅ Отправлено:', r.name, r.phone);
            } catch (err) {
                run('INSERT INTO history (contact_id, message, status) VALUES (?, ?, ?)',
                    [r.id, personalMsg, 'failed']);
                console.log('❌ Ошибка:', r.name, r.phone, err.message);
            }

            if (i < recipients.length - 1) {
                await sleep(sendDelay);
            }
        }

        console.log('📨 Рассылка завершена!');
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Проверить статус массовой отправки (через историю)
app.get('/api/whatsapp/send-status', (req, res) => {
    try {
        const recent = all(`
            SELECT h.*, c.name as contact_name, c.phone as contact_phone
            FROM history h LEFT JOIN contacts c ON h.contact_id = c.id
            ORDER BY h.sent_at DESC LIMIT 50
        `);
        res.json({ success: true, data: recent });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============ КОНТАКТЫ ============

app.get('/api/contacts', (req, res) => {
    try {
        const { group, search } = req.query;
        let sql = 'SELECT * FROM contacts';
        const params = [];
        const where = [];

        if (group && group !== 'all') {
            where.push('group_name = ?');
            params.push(group);
        }
        if (search) {
            where.push("(name LIKE ? OR phone LIKE ?)");
            params.push('%' + search + '%', '%' + search + '%');
        }
        if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
        sql += ' ORDER BY id DESC';

        res.json({ success: true, data: all(sql, params) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/contacts/:id', (req, res) => {
    try {
        const contact = getOne('SELECT * FROM contacts WHERE id = ?', [+req.params.id]);
        if (!contact) return res.status(404).json({ success: false, message: 'Не найден' });
        res.json({ success: true, data: contact });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/contacts', (req, res) => {
    try {
        const { name, phone, group_name } = req.body;
        if (!name || !phone) return res.status(400).json({ success: false, message: 'Имя и телефон обязательны' });

        const result = run('INSERT INTO contacts (name, phone, group_name) VALUES (?, ?, ?)',
            [name.trim(), normalizePhone(phone), group_name || 'Общая']);

        const newContact = getOne('SELECT * FROM contacts WHERE id = ?', [result.lastInsertRowid]);
        res.json({ success: true, data: newContact, message: 'Добавлен' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/contacts/bulk', (req, res) => {
    try {
        const { contacts } = req.body;
        let added = 0;
        for (const c of contacts) {
            if (c.name && c.phone) {
                try {
                    run('INSERT INTO contacts (name, phone, group_name) VALUES (?, ?, ?)',
                        [c.name.trim(), normalizePhone(c.phone), c.group_name || 'Общая']);
                    added++;
                } catch (e) {}
            }
        }
        res.json({ success: true, message: 'Добавлено: ' + added });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.put('/api/contacts/:id', (req, res) => {
    try {
        const { name, phone, group_name } = req.body;
        const old = getOne('SELECT * FROM contacts WHERE id = ?', [+req.params.id]);
        if (!old) return res.status(404).json({ success: false, message: 'Не найден' });

        run('UPDATE contacts SET name=?, phone=?, group_name=? WHERE id=?', [
            name || old.name,
            phone ? normalizePhone(phone) : old.phone,
            group_name || old.group_name,
            +req.params.id
        ]);
        const updated = getOne('SELECT * FROM contacts WHERE id = ?', [+req.params.id]);
        res.json({ success: true, data: updated });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/contacts/:id', (req, res) => {
    try {
        const r = run('DELETE FROM contacts WHERE id = ?', [+req.params.id]);
        if (r.changes === 0) return res.status(404).json({ success: false, message: 'Не найден' });
        res.json({ success: true, message: 'Удалён' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/contacts/delete-bulk', (req, res) => {
    try {
        const { ids } = req.body;
        let deleted = 0;
        for (const id of ids) {
            const r = run('DELETE FROM contacts WHERE id = ?', [id]);
            deleted += r.changes;
        }
        res.json({ success: true, message: 'Удалено: ' + deleted });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============ ГРУППЫ ============

app.get('/api/groups', (req, res) => {
    try {
        const groups = all(`
            SELECT g.*, COUNT(c.id) as contact_count
            FROM groups g LEFT JOIN contacts c ON c.group_name = g.name
            GROUP BY g.id ORDER BY g.name
        `);
        res.json({ success: true, data: groups });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/groups', (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Нужно название' });
        run('INSERT INTO groups (name, color) VALUES (?, ?)', [name.trim(), color || '#3498db']);
        res.json({ success: true, message: 'Создана' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/groups/:id', (req, res) => {
    try {
        const group = getOne('SELECT * FROM groups WHERE id = ?', [+req.params.id]);
        if (!group) return res.status(404).json({ success: false, message: 'Не найдена' });
        if (group.name === 'Общая') return res.status(400).json({ success: false, message: 'Нельзя' });
        run('UPDATE contacts SET group_name = ? WHERE group_name = ?', ['Общая', group.name]);
        run('DELETE FROM groups WHERE id = ?', [+req.params.id]);
        res.json({ success: true, message: 'Удалена' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============ ШАБЛОНЫ ============

app.get('/api/templates', (req, res) => {
    try {
        res.json({ success: true, data: all('SELECT * FROM templates ORDER BY id DESC') });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/templates', (req, res) => {
    try {
        const { title, body } = req.body;
        if (!title || !body) return res.status(400).json({ success: false, message: 'Заполните' });
        run('INSERT INTO templates (title, body) VALUES (?, ?)', [title.trim(), body.trim()]);
        res.json({ success: true, message: 'Создан' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/templates/:id', (req, res) => {
    try {
        run('DELETE FROM templates WHERE id = ?', [+req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============ ИСТОРИЯ ============

app.get('/api/history', (req, res) => {
    try {
        const rows = all(`
            SELECT h.*, c.name as contact_name, c.phone as contact_phone
            FROM history h LEFT JOIN contacts c ON h.contact_id = c.id
            ORDER BY h.sent_at DESC LIMIT 200
        `);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============ СТАТИСТИКА ============

app.get('/api/stats', (req, res) => {
    try {
        const totalContacts = getOne('SELECT COUNT(*) as c FROM contacts').c;
        const totalGroups = getOne('SELECT COUNT(*) as c FROM groups').c;
        const totalSent = getOne('SELECT COUNT(*) as c FROM history').c;
        const todaySent = getOne("SELECT COUNT(*) as c FROM history WHERE date(sent_at) = date('now')").c;
        res.json({ success: true, data: { totalContacts, totalGroups, totalSent, todaySent } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============ УТИЛИТЫ ============

function normalizePhone(phone) {
    let c = phone.replace(/[^\d+]/g, '');
    if (c.startsWith('8') && c.length === 11) c = '7' + c.substring(1);
    if (!c.startsWith('+')) c = '+' + c;
    return c;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ============ ЗАПУСК ============

initDB().then(() => {
    app.listen(PORT, () => {
        console.log('');
        console.log('╔═══════════════════════════════════╗');
        console.log('║   WhatsApp Sender запущен!        ║');
        console.log('║   http://localhost:' + PORT + '            ║');
        console.log('╚═══════════════════════════════════╝');
        console.log('');
    });
});