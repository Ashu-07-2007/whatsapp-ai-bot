const { default: makeWASocket } = require('@whiskeysockets/baileys');
const axios = require('axios');

async function start() {
    const authInfo = process.env.AUTH_INFO ? JSON.parse(process.env.AUTH_INFO) : null;
    const sock = makeWASocket({
        auth: authInfo ? { creds: authInfo.creds, keys: authInfo.keys } : undefined,
        printQRInTerminal: !authInfo,
    });

    sock.ev.on('connection.update', (update) => {
        if (update.connection === 'close') {
            console.log('Reconnecting...');
            start();
        } else if (update.connection === 'open') {
            console.log('Connected');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.key.remoteJid === 'your-group-id@g.us') {
            const text = msg.message?.conversation || '';
            if (text.startsWith('@ai ')) {
                const prompt = text.slice(4).trim();
                try {
                    const response = await axios.post('your-n8n-webhook-url', { prompt });
                    const answer = response.data.response;
                    await sock.sendMessage(msg.key.remoteJid, { text: answer });
                } catch (error) {
                    console.error('Error:', error);
                }
            }
        }
    });
}

start();