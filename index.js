const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const QRCode = require('qrcode');

async function start() {
    const authDir = path.join(__dirname, 'auth_info');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const sock = makeWASocket({
        auth: state,
        qrTimeout: 120000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 20000,
        logger: require('pino')({ level: 'debug' }) // Add debug logging
    });

    let qrUrl = '';
    const server = http.createServer((req, res) => {
        if (req.url === '/qr' && qrUrl) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<img src="${qrUrl}" alt="QR Code"><p>Scan within 2 mins</p>`);
        } else {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Bot running');
        }
    });
    server.listen(process.env.PORT || 10000);

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            qrUrl = await QRCode.toDataURL(qr);
            console.log('Scan QR: https://whatsapp-ai-bot-02k2.onrender.com/qr');
            await fs.writeFile('qr.txt', qr);
        }
        if (connection === 'close') {
            const reconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (reconnect) start();
            else {
                await fs.rm(authDir, { recursive: true, force: true });
                start();
            }
        } else if (connection === 'open') qrUrl = '';
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.key.remoteJid.endsWith('@g.us')) {
            const text = msg.message?.conversation || '';
            if (text.startsWith('@ai ')) {
                const prompt = text.slice(4).trim();
                const { data } = await axios.post(process.env.N8N_WEBHOOK_URL, { prompt });
                await sock.sendMessage(msg.key.remoteJid, { text: data.response || 'Error' });
            }
        }
    });
}

start().catch(console.error);