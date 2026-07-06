const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'contacts.db');
let db = null;

async function initDB() {
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
        console.log('БД загружена из файла');
    } else {
        db = new SQL.Database();
        console.log('БД создана заново');
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS contacts (
                                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                name TEXT NOT NULL,
                                                phone TEXT NOT NULL,
                                                group_name TEXT DEFAULT 'Общая',
                                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT DEFAULT '#3498db'
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_id INTEGER,
            message TEXT,
            status TEXT DEFAULT 'sent',
            sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const check = db.exec("SELECT id FROM groups WHERE name = 'Общая'");
    if (!check.length || !check[0].values.length) {
        db.run("INSERT INTO groups (name, color) VALUES ('Общая', '#25D366')");
    }

    save();
    console.log('БД готова');
    return db;
}

function save() {
    try {
        const data = db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
        console.error('Ошибка сохранения:', e.message);
    }
}

function all(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
    } catch (e) {
        console.error('all() error:', e.message);
        return [];
    }
}

function getOne(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        let result = null;
        if (stmt.step()) result = stmt.getAsObject();
        stmt.free();
        return result;
    } catch (e) {
        console.error('getOne() error:', e.message);
        return null;
    }
}

function run(sql, params = []) {
    try {
        db.run(sql, params);
        save();
        const r = db.exec('SELECT last_insert_rowid() as id');
        const lastId = r.length ? r[0].values[0][0] : 0;
        const changes = db.getRowsModified();
        return { lastInsertRowid: lastId, changes };
    } catch (e) {
        console.error('run() error:', e.message);
        throw e;
    }
}

module.exports = { initDB, all, getOne, run, save };