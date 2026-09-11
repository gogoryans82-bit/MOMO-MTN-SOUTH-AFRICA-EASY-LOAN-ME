// ============================================================
// db.js – PostgreSQL connection + schema + helpers
// ============================================================
'use strict';

const { Pool } = require('pg');

// Detect whether SSL is needed based on the connection string.
// Render INTERNAL URLs (dpg-xxx-a) don't use SSL.
// Render EXTERNAL URLs (*.render.com) require SSL.
function needsSSL(url) {
    if (!url) return false;
    if (url.includes('.render.com')) return true;
    if (url.includes('sslmode=require')) return true;
    if (process.env.PGSSLMODE === 'require') return true;
    return false;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('❌ DATABASE_URL is not set. Set it in your environment.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: connectionString,
    ssl: needsSSL(connectionString) ? { rejectUnauthorized: false } : false,
    max: 5,                        // Render free tier has limited connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
    console.error('❌ Unexpected PG pool error:', err.message);
});

// ─── Schema ───
async function initSchema() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS applications (
                application_id      TEXT PRIMARY KEY,
                registration_status TEXT,
                account_type        TEXT,
                phone               TEXT,
                updated_at          TIMESTAMPTZ DEFAULT NOW(),
                created_at          TIMESTAMPTZ DEFAULT NOW(),
                data                JSONB NOT NULL
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_app_status   ON applications(registration_status);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_app_updated  ON applications(updated_at DESC);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_app_phone    ON applications(phone);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_app_type     ON applications(account_type);`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id      BIGSERIAL PRIMARY KEY,
                ts      TIMESTAMPTZ DEFAULT NOW(),
                event   TEXT NOT NULL,
                data    JSONB
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS registrations (
                reg_id      TEXT PRIMARY KEY,
                data        JSONB NOT NULL,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        console.log('✅ PostgreSQL schema ready');
    } finally {
        client.release();
    }
}

// ─── Load all applications into memory (called at startup) ───
async function loadAllApplications() {
    const { rows } = await pool.query('SELECT application_id, data FROM applications');
    const out = {};
    rows.forEach(r => { out[r.application_id] = r.data; });
    return out;
}

// ─── Upsert one application ───
async function saveApplication(app) {
    const id = app.applicationId;
    if (!id) return;
    const dataJson = JSON.stringify(app);
    await pool.query(
        `INSERT INTO applications (application_id, registration_status, account_type, phone, updated_at, data)
         VALUES ($1, $2, $3, $4, NOW(), $5::jsonb)
         ON CONFLICT (application_id) DO UPDATE SET
             registration_status = EXCLUDED.registration_status,
             account_type        = EXCLUDED.account_type,
             phone               = EXCLUDED.phone,
             updated_at          = NOW(),
             data                = EXCLUDED.data`,
        [
            id,
            app.registrationStatus || 'idle',
            app.accountType || null,
            app.phone || null,
            dataJson
        ]
    );
}

// ─── Append an audit event ───
async function saveAudit(event, data) {
    try {
        await pool.query(
            'INSERT INTO audit_log (event, data) VALUES ($1, $2::jsonb)',
            [event, JSON.stringify(data || {})]
        );
    } catch (e) {
        console.error('Audit insert failed:', e.message);
    }
}

// ─── Load all registrations (legacy) ───
async function loadAllRegistrations() {
    const { rows } = await pool.query('SELECT reg_id, data FROM registrations');
    const out = {};
    rows.forEach(r => { out[r.reg_id] = r.data; });
    return out;
}

// ─── Upsert one registration (legacy) ───
async function saveRegistration(regId, data) {
    await pool.query(
        `INSERT INTO registrations (reg_id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (reg_id) DO UPDATE SET data = EXCLUDED.data`,
        [regId, JSON.stringify(data)]
    );
}

// ─── Optional: prune old data ───
async function pruneOldApplications(daysOld) {
    daysOld = daysOld || 90;
    const res = await pool.query(
        `DELETE FROM applications WHERE updated_at < NOW() - ($1 || ' days')::INTERVAL`,
        [String(daysOld)]
    );
    return res.rowCount;
}

module.exports = {
    pool,
    initSchema,
    loadAllApplications,
    saveApplication,
    saveAudit,
    loadAllRegistrations,
    saveRegistration,
    pruneOldApplications
};
