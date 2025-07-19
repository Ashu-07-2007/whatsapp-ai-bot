const http = require('http');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const QRCode = require('qrcode');

// Variable to store the QR code URL
let qrUrl = '';

// Create HTTP server once for QR code and health check
const server = http.createServer((req, res) => {
    if (req.url === '/qr' && qrUrl) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<img src="${qrUrl}" alt="QR Code"><p>Scan within 2 minutes</p>`);
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('WhatsApp bot is running');
    }
});

// Start server on Render's port or 10000
const port = process.env.PORT || 10000;
server.listen(port, () => {
    console.log(`HTTP server running on port ${port}`);
});

// Function to manage WhatsApp connection
async function startWhatsApp() {
    const authDir = path.join(__dirname, 'auth_info');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const sock = makeWASocket({
        auth: state,
        qrTimeout: 180000, // 3 minutes for QR scanning
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 20000,
        logger: require('pino')({ level: 'debug' }) // Debug logging
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            try {
                qrUrl = await QRCode.toDataURL(qr);
                console.log(`Scan QR: https://whatsapp-ai-bot-02k2.onrender.com/qr`);
                await fs.writeFile(path.join(__dirname, 'qr.txt'), qr);
            } catch (err) {
                console.error('QR code generation error:', err);
            }
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startWhatsApp(); // Restart connection
            } else {
                console.log('Logged out. Rescan QR code.');
                await fs.rm(authDir, { recursive: true, force: true });
                startWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Connected successfully');
            qrUrl = '';
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.key.remoteJid.endsWith('@g.us')) {
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            if (text.startsWith('@ai ')) {
                const prompt = text.slice(4).trim();
                try {
                    const response = await axios.post(process.env.N8N_WEBHOOK_URL, { prompt });
                    const answer = response.data.response || 'No response from AI.';
                    await sock.sendMessage(msg.key.remoteJid, { text: answer });
                } catch (error) {
                    console.error('Error sending to n8n:', error.message);
                    await sock.sendMessage(msg.key.remoteJid, { text: 'Error processing request.' });
                }
            }
        }
    });
}

// Start WhatsApp connection
startWhatsApp().catch((err) => {
    console.error('Startup error:', err);
    process.exit(1);
});