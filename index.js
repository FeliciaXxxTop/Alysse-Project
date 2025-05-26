const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidDecode,
    downloadContentFromMessage
} = require("@whiskeysockets/baileys");

const readline = require("readline");
const pino = require("pino");
const fs = require("fs");
const cfonts = require("cfonts");
const chalk = require("chalk");

// === Setup UI & Logging ===
console.clear();
cfonts.say('Alysse', {
    font: 'block',
    align: 'left',
    colors: ['#ff00ff', 'white'],
    background: 'transparent'
});

// === Helper Function ===
const question = (text) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(text, ans => {
        rl.close();
        resolve(ans);
    }));
};

// === Start Bot ===
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("session");

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        browser: ["Amelia", "Chrome", "120.0.0.0"],
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // === Pairing Code Flow ===
    if (!sock.authState.creds.registered) {
        const phoneNumber = await question(chalk.magentaBright.bold('\nEnter Your WhatsApp Number (e.g. 628xxxxxx): '));
        const code = await sock.requestPairingCode(phoneNumber.trim());
        console.log(chalk.greenBright.bold(`\nYour Pairing Code: ${code}`));
        console.log(chalk.yellow('\nGo to WhatsApp > Linked Devices > Link a Device\nEnter the code above on your phone.'));
    }

    // === Connection Status ===
    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(chalk.red("Disconnected."), shouldReconnect ? "Reconnecting..." : "Session logged out.");
            if (shouldReconnect) startBot();
        } else if (connection === "open") {
            console.log(chalk.green("BOT ONLINE! Ready to receive messages."));
        }
    });

    // === Basic Message Handler ===
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        if (text.toLowerCase() === "hi") {
            await sock.sendMessage(sender, {
                text: "Hello! Amelia bot is online!",
                quoted: msg
            });
        } else if (text.startsWith("!echo ")) {
            await sock.sendMessage(sender, { text: text.slice(6) });
        }
    });

    // === Utility: Decode JID ===
    sock.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            const decode = jidDecode(jid) || {};
            return (decode.user && decode.server) ? `${decode.user}@${decode.server}` : jid;
        }
        return jid;
    };

    // === Download Media Helper (optional) ===
    sock.downloadMediaMessage = async (message) => {
        const type = message.mimetype?.split('/')[0] || 'application';
        const stream = await downloadContentFromMessage(message, type);
        const buffer = [];
        for await (const chunk of stream) buffer.push(chunk);
        return Buffer.concat(buffer);
    };
}

startBot();
