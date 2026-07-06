const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

let sock = null;
let qrCodeData = null;
let isReady = false;
let statusText = 'Не подключён';
let onStatusChange = null;
let reconnectTimer = null;
let saveCredsRef = null;

// Папка сессии — на Railway Volume, локально — в папке проекта
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH)
    : path.join(__dirname, 'data');

const SESSION_DIR = path.join(DATA_DIR, 'wa-session');

function getStatus() {
    return { ready: isReady, status: statusText, qr: qrCodeData };
}

function notify() {
    if (onStatusChange) onStatusChange(getStatus());
}

async function loadBaileys() {
    const mod = await import('@whiskeysockets/baileys');

    const merged = {
        ...mod,
        ...(mod.default && typeof mod.default === 'object' ? mod.default : {})
    };

    const makeWASocket =
        typeof mod.default === 'function'
            ? mod.default
            : (typeof merged.makeWASocket === 'function' ? merged.makeWASocket : null);

    const useMultiFileAuthState = merged.useMultiFileAuthState;
    const DisconnectReason = merged.DisconnectReason;
    const fetchLatestBaileysVersion = merged.fetchLatestBaileysVersion;
    const makeCacheableSignalKeyStore = merged.makeCacheableSignalKeyStore;

    if (!makeWASocket || !useMultiFileAuthState || !DisconnectReason) {
        throw new Error('Не удалось загрузить baileys');
    }

    return {
        makeWASocket,
        useMultiFileAuthState,
        DisconnectReason,
        fetchLatestBaileysVersion,
        makeCacheableSignalKeyStore
    };
}

async function initialize(statusCallback) {
    onStatusChange = statusCallback;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    isReady = false;
    qrCodeData = null;
    statusText = 'Запуск...';
    notify();

    await connect();
}

async function connect() {
    try {
        const {
            makeWASocket,
            useMultiFileAuthState,
            DisconnectReason,
            fetchLatestBaileysVersion,
            makeCacheableSignalKeyStore
        } = await loadBaileys();

        // Создаём папки
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (!fs.existsSync(SESSION_DIR)) {
            fs.mkdirSync(SESSION_DIR, { recursive: true });
        }

        console.log('Сессия хранится в:', SESSION_DIR);

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        saveCredsRef = saveCreds;

        const { version } = await fetchLatestBaileysVersion();
        console.log('WA version:', version.join('.'));

        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true,
            browser: ['WA Sender', 'Chrome', '1.0.0'],
            connectTimeoutMs: 60000,
            syncFullHistory: false,
            generateHighQualityLinkPreview: false
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('QR получен — сканируйте!');
                statusText = 'Сканируйте QR-код';
                isReady = false;
                try {
                    qrCodeData = await QRCode.toDataURL(qr);
                } catch (e) {
                    console.error('QR error:', e.message);
                }
                notify();
            }

            if (connection === 'connecting') {
                statusText = 'Подключение...';
                notify();
            }

            if (connection === 'open') {
                console.log('✅ WhatsApp подключён!');
                isReady = true;
                qrCodeData = null;
                statusText = 'Подключён ✓';
                notify();
            }

            if (connection === 'close') {
                isReady = false;
                qrCodeData = null;

                const code = lastDisconnect?.error?.output?.statusCode;
                console.log('Соединение закрыто, код:', code);

                if (code === DisconnectReason.loggedOut) {
                    statusText = 'Выход — нужен новый QR';
                    clearSession();
                    notify();
                } else {
                    statusText = 'Переподключение...';
                    notify();
                    reconnectTimer = setTimeout(() => connect(), 5000);
                }
            }
        });

        sock.ev.on('creds.update', async () => {
            try {
                if (saveCredsRef) await saveCredsRef();
            } catch (e) {
                console.error('Ошибка сохранения сессии:', e.message);
            }
        });

    } catch (err) {
        console.error('Ошибка connect():', err.message);
        statusText = 'Ошибка: ' + err.message;
        isReady = false;
        notify();
    }
}

async function sendMessage(phone, message) {
    if (!sock || !isReady) {
        throw new Error('WhatsApp не подключён');
    }

    let number = phone.replace(/[^\d]/g, '');
    if (number.startsWith('00')) number = number.substring(2);

    try {
        const result = await sock.onWhatsApp(number);
        const found = Array.isArray(result) ? result[0] : null;

        if (!found || !found.exists) {
            throw new Error('Номер ' + phone + ' не найден в WhatsApp');
        }

        await sock.sendMessage(found.jid, { text: message });
        console.log('✓ Отправлено:', phone);
        return true;
    } catch (e) {
        throw new Error('Ошибка отправки ' + phone + ': ' + e.message);
    }
}

async function logout() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    try {
        if (sock) await sock.logout();
    } catch (e) {}

    sock = null;
    isReady = false;
    qrCodeData = null;
    statusText = 'Не подключён';
    clearSession();
    notify();
}

function clearSession() {
    try {
        if (fs.existsSync(SESSION_DIR)) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            console.log('Сессия удалена');
        }
    } catch (e) {
        console.error('Ошибка удаления сессии:', e.message);
    }
}

module.exports = { initialize, sendMessage, getStatus, logout };
