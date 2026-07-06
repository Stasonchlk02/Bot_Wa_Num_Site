const express = require('express');
const router = express.Router();
const db = require('./database');

// ==================== КОНТАКТЫ ====================

// Получить все контакты
router.get('/contacts', (req, res) => {
    try {
        const { group, search } = req.query;
        let query = 'SELECT * FROM contacts';
        const params = [];
        const conditions = [];

        if (group && group !== 'all') {
            conditions.push('group_name = ?');
            params.push(group);
        }

        if (search) {
            conditions.push('(name LIKE ? OR phone LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY created_at DESC';

        const contacts = db.prepare(query).all(...params);
        res.json({ success: true, data: contacts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Получить один контакт
router.get('/contacts/:id', (req, res) => {
    try {
        const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
        if (!contact) {
            return res.status(404).json({ success: false, message: 'Контакт не найден' });
        }
        res.json({ success: true, data: contact });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Добавить контакт
router.post('/contacts', (req, res) => {
    try {
        const { name, phone, group_name } = req.body;

        if (!name || !phone) {
            return res.status(400).json({
                success: false,
                message: 'Имя и телефон обязательны'
            });
        }

        // Нормализуем номер телефона
        const normalizedPhone = normalizePhone(phone);

        const stmt = db.prepare(
            'INSERT INTO contacts (name, phone, group_name) VALUES (?, ?, ?)'
        );

        const result = stmt.run(name.trim(), normalizedPhone, group_name || 'Общая');

        const newContact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);

        res.status(201).json({
            success: true,
            message: 'Контакт добавлен',
            data: newContact
        });
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            return res.status(400).json({
                success: false,
                message: 'Контакт с таким номером уже существует'
            });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// Массовое добавление контактов
router.post('/contacts/bulk', (req, res) => {
    try {
        const { contacts } = req.body;

        if (!contacts || !Array.isArray(contacts)) {
            return res.status(400).json({
                success: false,
                message: 'Передайте массив контактов'
            });
        }

        const stmt = db.prepare(
            'INSERT OR IGNORE INTO contacts (name, phone, group_name) VALUES (?, ?, ?)'
        );

        const insertMany = db.transaction((contactsList) => {
            let added = 0;
            let skipped = 0;
            for (const c of contactsList) {
                if (c.name && c.phone) {
                    const result = stmt.run(
                        c.name.trim(),
                        normalizePhone(c.phone),
                        c.group_name || 'Общая'
                    );
                    if (result.changes > 0) added++;
                    else skipped++;
                }
            }
            return { added, skipped };
        });

        const result = insertMany(contacts);

        res.status(201).json({
            success: true,
            message: `Добавлено: ${result.added}, пропущено (дубликаты): ${result.skipped}`,
            data: result
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Обновить контакт
router.put('/contacts/:id', (req, res) => {
    try {
        const { name, phone, group_name } = req.body;
        const { id } = req.params;

        const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Контакт не найден' });
        }

        const stmt = db.prepare(
            'UPDATE contacts SET name = ?, phone = ?, group_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        );

        stmt.run(
            name || existing.name,
            phone ? normalizePhone(phone) : existing.phone,
            group_name || existing.group_name,
            id
        );

        const updated = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
        res.json({ success: true, message: 'Контакт обновлён', data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Удалить контакт
router.delete('/contacts/:id', (req, res) => {
    try {
        const result = db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: 'Контакт не найден' });
        }
        res.json({ success: true, message: 'Контакт удалён' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Удалить несколько контактов
router.post('/contacts/delete-bulk', (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) {
            return res.status(400).json({ success: false, message: 'Передайте массив id' });
        }

        const placeholders = ids.map(() => '?').join(',');
        const result = db.prepare(`DELETE FROM contacts WHERE id IN (${placeholders})`).run(...ids);

        res.json({
            success: true,
            message: `Удалено контактов: ${result.changes}`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== ГРУППЫ ====================

// Получить все группы
router.get('/groups', (req, res) => {
    try {
        const groups = db.prepare(`
            SELECT g.*, COUNT(c.id) as contact_count 
            FROM groups g 
            LEFT JOIN contacts c ON c.group_name = g.name 
            GROUP BY g.id 
            ORDER BY g.name
        `).all();
        res.json({ success: true, data: groups });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Добавить группу
router.post('/groups', (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: 'Название группы обязательно' });
        }

        const stmt = db.prepare('INSERT INTO groups (name, color) VALUES (?, ?)');
        const result = stmt.run(name.trim(), color || '#3498db');

        const newGroup = db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json({ success: true, data: newGroup });
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            return res.status(400).json({ success: false, message: 'Группа с таким именем уже существует' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// Удалить группу
router.delete('/groups/:id', (req, res) => {
    try {
        const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
        if (!group) {
            return res.status(404).json({ success: false, message: 'Группа не найдена' });
        }
        if (group.name === 'Общая') {
            return res.status(400).json({ success: false, message: 'Нельзя удалить группу по умолчанию' });
        }

        // Переносим контакты в "Общая"
        db.prepare('UPDATE contacts SET group_name = ? WHERE group_name = ?').run('Общая', group.name);
        db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);

        res.json({ success: true, message: 'Группа удалена, контакты перенесены в "Общая"' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== ШАБЛОНЫ СООБЩЕНИЙ ====================

// Получить все шаблоны
router.get('/templates', (req, res) => {
    try {
        const templates = db.prepare('SELECT * FROM message_templates ORDER BY created_at DESC').all();
        res.json({ success: true, data: templates });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Добавить шаблон
router.post('/templates', (req, res) => {
    try {
        const { title, body } = req.body;
        if (!title || !body) {
            return res.status(400).json({ success: false, message: 'Заголовок и текст обязательны' });
        }

        const stmt = db.prepare('INSERT INTO message_templates (title, body) VALUES (?, ?)');
        const result = stmt.run(title.trim(), body.trim());

        const template = db.prepare('SELECT * FROM message_templates WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json({ success: true, data: template });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Удалить шаблон
router.delete('/templates/:id', (req, res) => {
    try {
        const result = db.prepare('DELETE FROM message_templates WHERE id = ?').run(req.params.id);
        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: 'Шаблон не найден' });
        }
        res.json({ success: true, message: 'Шаблон удалён' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== ИСТОРИЯ ====================

// Получить историю отправок
router.get('/history', (req, res) => {
    try {
        const history = db.prepare(`
            SELECT h.*, c.name as contact_name, c.phone as contact_phone 
            FROM send_history h 
            LEFT JOIN contacts c ON h.contact_id = c.id 
            ORDER BY h.sent_at DESC 
            LIMIT 100
        `).all();
        res.json({ success: true, data: history });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Записать в историю
router.post('/history', (req, res) => {
    try {
        const { contact_id, message, status } = req.body;

        const stmt = db.prepare(
            'INSERT INTO send_history (contact_id, message, status) VALUES (?, ?, ?)'
        );
        stmt.run(contact_id, message, status || 'sent');

        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Массовая запись в историю
router.post('/history/bulk', (req, res) => {
    try {
        const { entries } = req.body;

        const stmt = db.prepare(
            'INSERT INTO send_history (contact_id, message, status) VALUES (?, ?, ?)'
        );

        const insertMany = db.transaction((items) => {
            for (const item of items) {
                stmt.run(item.contact_id, item.message, item.status || 'sent');
            }
        });

        insertMany(entries);

        res.status(201).json({ success: true, message: `Записано ${entries.length} записей` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== СТАТИСТИКА ====================

router.get('/stats', (req, res) => {
    try {
        const totalContacts = db.prepare('SELECT COUNT(*) as count FROM contacts').get().count;
        const totalGroups = db.prepare('SELECT COUNT(*) as count FROM groups').get().count;
        const totalSent = db.prepare('SELECT COUNT(*) as count FROM send_history').get().count;
        const todaySent = db.prepare(
            "SELECT COUNT(*) as count FROM send_history WHERE date(sent_at) = date('now')"
        ).get().count;

        res.json({
            success: true,
            data: {
                totalContacts,
                totalGroups,
                totalSent,
                todaySent
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== УТИЛИТЫ ====================

function normalizePhone(phone) {
    // Убираем всё, кроме цифр и +
    let cleaned = phone.replace(/[^\d+]/g, '');

    // Если начинается с 8 и длина 11 (российский номер)
    if (cleaned.startsWith('8') && cleaned.length === 11) {
        cleaned = '7' + cleaned.substring(1);
    }

    // Добавляем + если нет
    if (!cleaned.startsWith('+')) {
        cleaned = '+' + cleaned;
    }

    return cleaned;
}

module.exports = router;