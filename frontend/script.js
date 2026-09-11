/* ═══════════════════════════════════════════════════════════
   NEW COMPONENTS – v5.0
   ═══════════════════════════════════════════════════════════ */

/* Offline banner */
.offline-banner {
    position: fixed; top: 0; left: 0; right: 0;
    background: #DE350B; color: #fff;
    text-align: center; padding: 8px;
    font-size: 0.85rem; font-weight: 600;
    z-index: 9999;
    animation: slideDown 0.3s ease;
}
.offline-banner.hidden { display: none; }

/* Navbar account badge */
.nav-badge {
    background: var(--mtn-yellow);
    color: var(--mtn-black);
    font-size: 0.65rem; font-weight: 800;
    padding: 4px 10px;
    border-radius: 12px;
    white-space: nowrap;
}

/* Confirmation blocks */
.confirm-block {
    background: var(--mtn-light-gray);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 14px;
}
.confirm-block h3 {
    font-size: 0.82rem; font-weight: 800;
    color: var(--mtn-black);
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.confirm-row {
    display: flex; justify-content: space-between;
    padding: 7px 0;
    font-size: 0.82rem;
    border-bottom: 1px solid rgba(0,0,0,0.06);
}
.confirm-row:last-child { border-bottom: none; }
.confirm-row span { color: var(--text-light); }
.confirm-row strong { color: var(--mtn-black); font-weight: 700; }

.agreement-wrap {
    background: var(--mtn-yellow-soft);
    border-left: 4px solid var(--mtn-yellow);
    border-radius: 8px;
    padding: 14px 16px;
    margin: 16px 0;
}

/* Agreement / Schedule Modals */
.modal-bg {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.7);
    z-index: 10000;
    display: none;
    align-items: flex-start; justify-content: center;
    padding: 20px;
    overflow-y: auto;
}
.modal-bg.show { display: flex; }
.modal-doc {
    background: #fff;
    border-radius: 12px;
    max-width: 720px;
    width: 100%;
    margin: 30px auto;
    overflow: hidden;
    border-top: 6px solid var(--mtn-yellow);
    animation: fadeIn 0.2s ease;
}
.modal-doc-head {
    background: var(--mtn-black);
    color: #fff;
    padding: 16px 20px;
    display: flex; justify-content: space-between; align-items: center;
}
.modal-doc-head h2 { font-size: 1rem; font-weight: 800; }
.modal-close {
    background: transparent; border: none;
    color: #fff; font-size: 1.5rem; cursor: pointer;
}
.agreement-text {
    padding: 24px;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 0.75rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 70vh;
    overflow-y: auto;
    background: var(--mtn-light-gray);
}
.schedule-body { padding: 20px; max-height: 70vh; overflow-y: auto; }
.schedule-table {
    width: 100%; border-collapse: collapse;
    font-size: 0.78rem;
}
.schedule-table th {
    background: var(--mtn-black); color: #fff;
    padding: 10px 8px; text-align: left;
    font-weight: 700; font-size: 0.7rem;
    text-transform: uppercase;
}
.schedule-table td {
    padding: 8px; border-bottom: 1px solid #eee;
}
.schedule-table tr:last-child td { border-bottom: none; }
.schedule-table tr:nth-child(even) td { background: #FAFAFA; }

/* Progress bar with 8 segments */
.prog-row {
    display: flex; gap: 4px;
    margin: 14px 0 26px;
}
.prog-row .prog-seg { height: 6px; }

/* PIN / OTP auto-advance (no auto-submit) */
.pin-box, .otp-box { font-variant-numeric: tabular-nums; }

/* Buttons — cancel & retry */
.nav-left {
    color: rgba(255,255,255,0.85) !important;
    font-weight: 600;
}
.nav-left:hover { color: #ff6b6b !important; }

/* Wait icons — smaller for quick steps */
.wait-icon.sm {
    width: 64px; height: 64px;
    font-size: 1.6rem;
}

/* Responsive tweak for confirmation blocks */
@media (max-width: 600px) {
    .confirm-row {
        flex-direction: column; gap: 2px;
    }
    .confirm-row span { font-size: 0.7rem; }
    .modal-doc { margin: 10px auto; }
    .agreement-text { padding: 16px; font-size: 0.7rem; }
}
