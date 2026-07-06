const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

let sock = null;
let qrCodeData = null;
let isReady = false;
let statusText = 'Не подключён';
let onStatusChange = null;
let reconnectTimer = null;
let saveCreds = null;

const SESSION_DIR = path.join(__dirname, 'wa-session');

function getStatus() {
    return { ready: isReady, status: statusText, qr: qrCodeData };
}

function notify() {
    if (onStatusChange) onStatusChange(getStatus());
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
        // Динамический import для ESM модуля
        const baileys = await import('@whiskeysockets/baileys');

        const makeWASocket = baileys.default;
        const {
            useMultiFileAuthState,
            DisconnectReason,
            fetchLatestBaileysVersion,
            makeCacheableSignalKeyStore
        } = baileys;

        const pino = require('pino');

        if (!fs.existsSync(SESSION_DIR)) {
            fs.mkdirSync(SESSION_DIR, { recursive: true });
        }

        const { state, saveCreds: sc } = await useMultiFileAuthState(SESSION_DIR);
        saveCreds = sc;

        const { version } = await fetchLatestBaileysVersion();
        console.log('WA версия:', version.join('.'));

        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: 'silent' })
                ),
            },
            printQRInTerminal: true,
            logger: pino({ level: 'silent' }),
            browser: ['WA Sender', 'Chrome', '1.0.0'],
            connectTimeoutMs: 60000,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('QR получен — сканируйте в WhatsApp!');
                statusText = 'Сканируйте QR-код';
                isReady = false;
                try {
                    qrCodeData = await QRCode.toDataURL(qr);
                } catch (e) {
                    console.error('QR ошибка:', e.message);
                }
                notify();
            }

            if (connection === 'open') {
                console.log('✅ WhatsApp подключён!');
                isReady = true;
                qrCodeData = null;
                statusText = 'Подключён ✓';
                notify();
            }

            if (connection === 'connecting') {
                statusText = 'Подключение...';
                notify();
            }

            if (connection === 'close') {
                isReady = false;
                qrCodeData = null;

                const code = lastDisconnect?.error?.output?.statusCode;
                console.log('Соединение закрыто, код:', code);

                if (code === DisconnectReason.loggedOut) {
                    statusText = 'Вышли из аккаунта — нужен новый QR';
                    clearSession();
                    notify();
                } else {
                    statusText = 'Переподключение...';
                    notify();
                    reconnectTimer = setTimeout(() => connect(), 5000);
                }
            }
        });

        sock.ev.on('creds.update', () => {
            if (saveCreds) saveCreds();
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

    // Убираем ведущие нули
    if (number.startsWith('00')) {
        number = number.substring(2);
    }

    try {
        const [result] = await sock.onWhatsApp(number);

        if (!result || !result.exists) {
            throw new Error('Номер ' + phone + ' не найден в WhatsApp');
        }

        await sock.sendMessage(result.jid, { text: message });
        console.log('✓ Отправлено:', phone);
        return true;

    } catch (e) {
        throw new Error('Ошибка отправки на ' + phone + ': ' + e.message);
    }
}

async function logout() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (sock) {
        try { await sock.logout(); } catch (e) {}
        try { sock.end(); } catch (e) {}
        sock = null;
    }

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