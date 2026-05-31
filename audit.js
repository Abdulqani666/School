/**
 * audit.js — Audit Log Module
 *
 * Responsibilities:
 *   - createSchema(db)    : add activity_logs table + indexes to the database
 *   - log(db, params)     : insert one audit record (synchronous, never throws)
 *   - getIp(req)          : safely extract client IP from request
 *   - buildRouter(...)    : Express router for /api/audit endpoints
 *
 * Design decisions:
 *   - log() is synchronous (better-sqlite3 is sync) so it never delays responses
 *   - log() wraps everything in try/catch — a logging failure must NEVER crash the server
 *   - Logs are INSERT-only; no UPDATE or DELETE routes are exposed
 *   - Only superadmin can read or export logs
 *   - IP is extracted from X-Forwarded-For (Render/proxy) then socket.remoteAddress
 */

const express = require('express');

// ── ACTION CONSTANTS ────────────────────────────────────────────────────────
// Centralised so every caller uses the exact same string.
const ACTIONS = {
  // Auth
  LOGIN_SUCCESS:      'LOGIN_SUCCESS',
  LOGIN_FAILED:       'LOGIN_FAILED',
  LOGOUT:             'LOGOUT',
  PASSWORD_CHANGED:   'PASSWORD_CHANGED',
  // Users
  USER_CREATED:       'USER_CREATED',
  USER_DELETED:       'USER_DELETED',
  // Students
  STUDENT_CREATED:    'STUDENT_CREATED',
  STUDENT_UPDATED:    'STUDENT_UPDATED',
  STUDENT_DELETED:    'STUDENT_DELETED',
  // Attendance
  ATTENDANCE_SAVED:   'ATTENDANCE_SAVED',
  ATTENDANCE_LOCKED:  'ATTENDANCE_LOCKED',
  ATTENDANCE_UNLOCKED:'ATTENDANCE_UNLOCKED',
  // Exams
  MARKS_SAVED:        'MARKS_SAVED',
  // Payments
  PAYMENT_SAVED:      'PAYMENT_SAVED',
  // Backups
  BACKUP_CREATED:     'BACKUP_CREATED',
  BACKUP_RESTORED:    'BACKUP_RESTORED',
  BACKUP_DELETED:     'BACKUP_DELETED',
};

// ── SCHEMA ──────────────────────────────────────────────────────────────────
function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER,
      username    TEXT NOT NULL,
      role        TEXT NOT NULL,
      action      TEXT NOT NULL,
      target_type TEXT,
      target_id   TEXT,
      details     TEXT,
      ip_address  TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_audit_username   ON activity_logs(username);
    CREATE INDEX IF NOT EXISTS idx_audit_action     ON activity_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON activity_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_target_id  ON activity_logs(target_id);
  `);
}

// ── IP HELPER ───────────────────────────────────────────────────────────────
function getIp(req) {
  // X-Forwarded-For is set by Render's proxy; take the first (original client) IP
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// ── CORE LOG FUNCTION ────────────────────────────────────────────────────────
/**
 * log(db, { user, action, targetType, targetId, details, ip })
 *
 * @param {Database} db
 * @param {object}   params
 *   user        — req.user object (id, username, role) OR null for failed logins
 *   action      — one of ACTIONS.*
 *   targetType  — 'Student' | 'User' | 'Attendance' | 'Exam' | 'Payment' | 'Backup'
 *   targetId    — string identifier (student_id, username, etc.)
 *   details     — human-readable description of what changed
 *   ip          — IP address string
 */
function log(db, { user, action, targetType = null, targetId = null, details = null, ip = 'unknown' }) {
  try {
    db.prepare(`
      INSERT INTO activity_logs (user_id, username, role, action, target_type, target_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user?.id     || null,
      user?.username || 'anonymous',
      user?.role   || 'unknown',
      action,
      targetType,
      targetId     ? String(targetId) : null,
      details      ? String(details)  : null,
      ip
    );
  } catch (err) {
    // Logging must never crash the server
    console.error('[audit] Failed to write log:', err.message);
  }
}

// ── EXPRESS ROUTER ───────────────────────────────────────────────────────────
/**
 * buildRouter(db, authMiddleware, requireRole)
 *
 * Endpoints (superadmin only):
 *   GET  /api/audit         — paginated list with filters
 *   GET  /api/audit/export  — CSV or PDF export
 */
function buildRouter(db, authMiddleware, requireRole) {
  const router = express.Router();

  // All audit routes require superadmin
  router.use(authMiddleware, requireRole('superadmin'));

  /**
   * GET /api/audit
   * Query params:
   *   username    — filter by username (partial match)
   *   action      — exact action name
   *   target_id   — Student ID or other target (partial match)
   *   date_from   — ISO date string (inclusive)
   *   date_to     — ISO date string (inclusive)
   *   preset      — 'today' | '7days' | '30days'
   *   page        — page number (default 1)
   *   per_page    — results per page (default 50, max 200)
   */
  router.get('/', (req, res) => {
    try {
      let { username, action, target_id, date_from, date_to, preset, page, per_page } = req.query;

      // Validate and sanitise pagination
      page     = Math.max(1, parseInt(page)     || 1);
      per_page = Math.min(200, Math.max(1, parseInt(per_page) || 50));
      const offset = (page - 1) * per_page;

      // Resolve preset into date range
      if (preset) {
        const now  = new Date();
        date_to    = now.toISOString().split('T')[0];
        if      (preset === 'today')  date_from = date_to;
        else if (preset === '7days')  date_from = new Date(now - 7  * 86400000).toISOString().split('T')[0];
        else if (preset === '30days') date_from = new Date(now - 30 * 86400000).toISOString().split('T')[0];
      }

      // Validate date format to prevent injection (YYYY-MM-DD)
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      if (date_from && !dateRe.test(date_from)) return res.status(400).json({ error: 'Invalid date_from format' });
      if (date_to   && !dateRe.test(date_to))   return res.status(400).json({ error: 'Invalid date_to format' });

      // Build parameterised query (no string interpolation of user input)
      let where = '1=1';
      const params = [];

      if (username)  { where += ' AND username LIKE ?';              params.push('%' + username  + '%'); }
      if (action)    { where += ' AND action = ?';                   params.push(action); }
      if (target_id) { where += ' AND target_id LIKE ?';             params.push('%' + target_id + '%'); }
      if (date_from) { where += ' AND DATE(created_at) >= ?';        params.push(date_from); }
      if (date_to)   { where += ' AND DATE(created_at) <= ?';        params.push(date_to); }

      const total = db.prepare(`SELECT COUNT(*) as c FROM activity_logs WHERE ${where}`).get(...params).c;
      const rows  = db.prepare(
        `SELECT * FROM activity_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      ).all(...params, per_page, offset);

      res.json({
        total,
        page,
        per_page,
        total_pages: Math.ceil(total / per_page),
        logs: rows,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch logs: ' + err.message });
    }
  });

  /**
   * GET /api/audit/export
   * Query params: same filters as GET /api/audit, plus format=csv|pdf
   * Returns CSV (default) or a basic HTML-based PDF-ready page
   */
  router.get('/export', (req, res) => {
    // Allow token via query param for window.open export (can't set headers)
    if (!req.headers.authorization && req.query.token) {
      req.headers.authorization = 'Bearer ' + req.query.token;
    }
    try {
      let { username, action, target_id, date_from, date_to, preset, format } = req.query;
      format = (format || 'csv').toLowerCase();

      if (preset) {
        const now = new Date();
        date_to   = now.toISOString().split('T')[0];
        if      (preset === 'today')  date_from = date_to;
        else if (preset === '7days')  date_from = new Date(now - 7  * 86400000).toISOString().split('T')[0];
        else if (preset === '30days') date_from = new Date(now - 30 * 86400000).toISOString().split('T')[0];
      }

      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      if (date_from && !dateRe.test(date_from)) return res.status(400).json({ error: 'Invalid date_from' });
      if (date_to   && !dateRe.test(date_to))   return res.status(400).json({ error: 'Invalid date_to' });

      let where = '1=1';
      const params = [];
      if (username)  { where += ' AND username LIKE ?'; params.push('%' + username + '%'); }
      if (action)    { where += ' AND action = ?';      params.push(action); }
      if (target_id) { where += ' AND target_id LIKE ?'; params.push('%' + target_id + '%'); }
      if (date_from) { where += ' AND DATE(created_at) >= ?'; params.push(date_from); }
      if (date_to)   { where += ' AND DATE(created_at) <= ?'; params.push(date_to); }

      // Cap export at 10,000 rows
      const rows = db.prepare(
        `SELECT * FROM activity_logs WHERE ${where} ORDER BY created_at DESC LIMIT 10000`
      ).all(...params);

      if (format === 'csv') {
        const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const header = ['id','created_at','username','role','action','target_type','target_id','details','ip_address']
          .map(escape).join(',');
        const lines  = rows.map(r =>
          [r.id, r.created_at, r.username, r.role, r.action, r.target_type, r.target_id, r.details, r.ip_address]
            .map(escape).join(',')
        );
        const csv = [header, ...lines].join('\r\n');
        const filename = `audit_log_${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csv);
      }

      if (format === 'pdf') {
        // Return a print-ready HTML page — the browser's print dialog produces a PDF
        const rows_html = rows.map(r => `
          <tr>
            <td>${r.created_at}</td>
            <td>${r.username}</td>
            <td>${r.role}</td>
            <td><strong>${r.action}</strong></td>
            <td>${r.target_type || ''}</td>
            <td>${r.target_id || ''}</td>
            <td>${r.details || ''}</td>
            <td>${r.ip_address || ''}</td>
          </tr>`).join('');

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
          <title>Audit Log Export</title>
          <style>
            body{font-family:Arial,sans-serif;font-size:11px;margin:20px}
            h1{font-size:16px;margin-bottom:4px}
            p{color:#666;margin-bottom:12px}
            table{width:100%;border-collapse:collapse}
            th{background:#1e293b;color:#fff;padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase}
            td{padding:5px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top;word-break:break-word}
            tr:nth-child(even) td{background:#f8fafc}
            @media print{@page{size:A4 landscape;margin:15mm}}
          </style>
        </head><body>
          <h1>Abubakar Sadiiq School — Audit Log</h1>
          <p>Exported: ${new Date().toLocaleString()} · ${rows.length} records</p>
          <table>
            <thead><tr><th>Date</th><th>Username</th><th>Role</th><th>Action</th><th>Target Type</th><th>Target ID</th><th>Details</th><th>IP</th></tr></thead>
            <tbody>${rows_html}</tbody>
          </table>
          <script>window.onload=()=>window.print()</script>
        </body></html>`;

        res.setHeader('Content-Type', 'text/html');
        return res.send(html);
      }

      res.status(400).json({ error: 'format must be csv or pdf' });
    } catch (err) {
      res.status(500).json({ error: 'Export failed: ' + err.message });
    }
  });

  // GET /api/audit/actions — return list of distinct action names for filter dropdown
  router.get('/actions', (req, res) => {
    try {
      const rows = db.prepare('SELECT DISTINCT action FROM activity_logs ORDER BY action').all();
      res.json(rows.map(r => r.action));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createSchema, log, getIp, buildRouter, ACTIONS };
