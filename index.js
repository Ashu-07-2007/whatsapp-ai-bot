const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

async function start() {
    const authDir = path.join(__dirname, 'auth_info');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
        auth: state,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('QR Code Generated. Scan it with WhatsApp:');
            console.log(qr);
            await fs.writeFile(path.join(__dirname, 'qr.txt'), qr);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                start();
            } else {
                console.log('Logged out. Please scan QR again.');
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
        console.log('Message received from JID:', msg.key.remoteJid); // Log JID for all messages
        if (!msg.key.fromMe && msg.key.remoteJid === 'your-group-id@g.us') {
            const text = msg.message?.conversation || '';
            if (text.startsWith('@ai ')) {
                const prompt = text.slice(4).trim();
                try {
                    const response = await axios.post('your-n8n-webhook-url', { prompt });
                    const answer = response.data.response;
                    await sock.sendMessage(msg.key.remoteJid, { text: answer });
                } catch (error) {
                    console.error('Error sending to n8n:', error);
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