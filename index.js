const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');

async function start() {
    const authDir = path.join(__dirname, 'auth_info');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
        auth: state,
        qrTimeout: 120000, // Set QR code timeout to 2 minutes (120,000 ms)
        connectTimeoutMs: 60000, // Connection timeout (optional, for stability)
    });

    // HTTP server for Render health check
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('WhatsApp bot is running');
    });
    const port = process.env.PORT || 10000;
    server.listen(port, () => {
        console.log(`HTTP server running on port ${port} for Render health check`);
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('Scan this QR with WhatsApp (valid for 2 minutes):\n', qr);
            await fs.writeFile(path.join(__dirname, 'qr.txt'), qr);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                start();
            } else {
                console.log('Logged out. Delete auth_info and scan QR again.');
                await fs.rm(authDir, { recursive: true, force: true });
                start();
            }
        } else if (connection === 'open') {
            console.log('Connected successfully');
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

start().catch((err) => {
    console.error('Startup error:', err);
    process.exit(1);
});