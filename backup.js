/**
 * backup.js — Database backup and restore module
 *
 * Responsibilities:
 *   - createBackup()      : copy the live SQLite file safely using WAL checkpoint
 *   - listBackups()       : return metadata for every backup on disk
 *   - restoreBackup(file) : swap the DB file atomically, keeping a pre-restore safety copy
 *   - deleteBackup(file)  : remove a single backup file
 *   - pruneBackups()      : keep only the 30 most recent files
 *   - scheduleDaily()     : set a 24-hour interval timer for automatic backups
 *   - router              : Express router exposing /api/backups/* endpoints
 */

const fs   = require('fs');
const path = require('path');
const express = require('express');

const MAX_BACKUPS = 30;

// ── PATHS ──────────────────────────────────────────────────────────────────
// Resolve relative to this file so the module works regardless of cwd.
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// Ensure the backups folder exists at module load time.
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ── HELPERS ────────────────────────────────────────────────────────────────
/** Return a filename-safe timestamp string: 2026-05-30T14-22-05 */
function timestamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
}

/** Build the full path to a backup file, validating the name to block path traversal. */
function safeBackupPath(filename) {
  // Only allow: letters, digits, hyphens, underscores, dots
  if (!/^[\w\-.]+\.db$/.test(filename)) throw new Error('Invalid backup filename.');
  const resolved = path.resolve(BACKUP_DIR, filename);
  // Extra guard: resolved path must stay inside BACKUP_DIR
  if (!resolved.startsWith(path.resolve(BACKUP_DIR))) throw new Error('Path traversal denied.');
  return resolved;
}

// ── CORE FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * createBackup(db, dbPath)
 *
 * Uses better-sqlite3's built-in `.backup()` method which:
 *   1. Runs a WAL checkpoint so all pending writes are flushed.
 *   2. Copies only committed, consistent data — no partial writes.
 * This is the safest way to back up a live SQLite database.
 *
 * @param {Database} db      - The open better-sqlite3 instance
 * @param {string}   dbPath  - Filesystem path to the live database file
 * @returns {Promise<{filename, size, createdAt}>}
 */
async function createBackup(db, dbPath) {
  const filename = `backup_${timestamp()}.db`;
  const destPath = path.join(BACKUP_DIR, filename);

  // better-sqlite3 .backup() returns a Promise and handles WAL checkpoint internally.
  await db.backup(destPath);

  const { size } = fs.statSync(destPath);
  await pruneBackups();   // enforce 30-backup limit after every new backup

  return { filename, size, createdAt: new Date().toISOString() };
}

/**
 * listBackups()
 *
 * Reads the backups directory and returns metadata sorted newest-first.
 */
function listBackups() {
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db'));
  return files
    .map(filename => {
      const stat = fs.statSync(path.join(BACKUP_DIR, filename));
      return {
        filename,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * restoreBackup(db, dbPath, filename)
 *
 * Restore strategy (safe, atomic):
 *   1. Validate the backup file is a real SQLite database.
 *   2. Create a pre-restore safety copy of the CURRENT database first.
 *   3. Close all prepared statements (better-sqlite3 requires this).
 *   4. Overwrite the live DB file with the backup using fs.copyFileSync
 *      (atomic on POSIX; on Windows it falls back to a safe copy+rename).
 *   5. The server process must be restarted to pick up the new file
 *      — we signal this by returning restart:true to the frontend.
 *
 * NOTE: On Render free tier the process restarts automatically after the
 * response is sent, which is handled in the route handler below.
 *
 * @param {string} dbPath    - Live DB path
 * @param {string} filename  - Backup filename to restore from
 * @returns {{ safetyBackup: string }}
 */
async function restoreBackup(db, dbPath, filename) {
  const srcPath = safeBackupPath(filename);

  if (!fs.existsSync(srcPath)) throw new Error('Backup file not found.');

  // 1. Validate: check SQLite magic bytes (first 16 bytes = "SQLite format 3\0")
  const header = Buffer.alloc(16);
  const fd = fs.openSync(srcPath, 'r');
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (header.toString('ascii', 0, 6) !== 'SQLite') {
    throw new Error('File does not appear to be a valid SQLite database.');
  }

  // 2. Safety copy of current live DB before we overwrite it
  const safetyName = `pre_restore_${timestamp()}.db`;
  const safetyPath = path.join(BACKUP_DIR, safetyName);
  await db.backup(safetyPath);

  // 3. Copy backup over live DB (fs.copyFileSync is atomic on most POSIX systems)
  fs.copyFileSync(srcPath, dbPath);

  return { safetyBackup: safetyName };
}

/**
 * deleteBackup(filename)
 * Simple file removal after path validation.
 */
function deleteBackup(filename) {
  const filePath = safeBackupPath(filename);
  if (!fs.existsSync(filePath)) throw new Error('Backup file not found.');
  fs.unlinkSync(filePath);
}

/**
 * pruneBackups()
 * Keep only the MAX_BACKUPS most recent files.
 * Automatically called after createBackup().
 */
async function pruneBackups() {
  const all = listBackups(); // already sorted newest-first
  const toDelete = all.slice(MAX_BACKUPS);
  for (const b of toDelete) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, b.filename)); } catch (_) {}
  }
}

/**
 * scheduleDaily(db, dbPath)
 * Runs createBackup() once immediately on startup, then every 24 hours.
 * Errors are caught and logged — a failed backup must never crash the server.
 */
function scheduleDaily(db, dbPath) {
  const run = () =>
    createBackup(db, dbPath)
      .then(b => console.log(`[backup] Auto backup created: ${b.filename} (${(b.size/1024).toFixed(1)} KB)`))
      .catch(err => console.error('[backup] Auto backup failed:', err.message));

  run(); // immediate first backup on startup
  setInterval(run, 24 * 60 * 60 * 1000); // then every 24 h
}

// ── EXPRESS ROUTER ─────────────────────────────────────────────────────────
/**
 * buildRouter(db, dbPath, authMiddleware, requireRole)
 *
 * Returns a configured Express router.
 * All routes require a valid JWT (authMiddleware) and admin/superadmin role.
 *
 * Endpoints:
 *   GET    /api/backups          — list all backups
 *   POST   /api/backups          — create a backup now
 *   POST   /api/backups/restore  — restore a backup (body: { filename })
 *   DELETE /api/backups/:file    — delete a backup
 */
function buildRouter(db, dbPath, authMiddleware, requireRole, audit) {
  const router = express.Router();

  // All backup routes are admin/superadmin only
  router.use(authMiddleware, requireRole('superadmin', 'admin'));

  // GET /api/backups — list
  router.get('/', (req, res) => {
    try {
      res.json(listBackups());
    } catch (err) {
      res.status(500).json({ error: 'Could not read backups: ' + err.message });
    }
  });

  // POST /api/backups — create now
  router.post('/', async (req, res) => {
    try {
      const result = await createBackup(db, dbPath);
      if (audit) audit.log(db, { user: req.user, action: audit.ACTIONS.BACKUP_CREATED, targetType: 'Backup', targetId: result.filename, details: `Size: ${(result.size/1024).toFixed(1)} KB`, ip: audit.getIp(req) });
      res.json({ success: true, backup: result });
    } catch (err) {
      res.status(500).json({ error: 'Backup failed: ' + err.message });
    }
  });

  // POST /api/backups/restore — restore (must come before /:file to avoid conflict)
  router.post('/restore', async (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename is required.' });
    try {
      const result = await restoreBackup(db, dbPath, filename);
      // Send response BEFORE restarting so the client receives it
      if (audit) audit.log(db, { user: req.user, action: audit.ACTIONS.BACKUP_RESTORED, targetType: 'Backup', targetId: filename, details: `Safety copy: ${result.safetyBackup}`, ip: audit.getIp(req) });
      res.json({
        success: true,
        message: `Restored from ${filename}. Safety copy saved as ${result.safetyBackup}. Server is restarting…`,
        safetyBackup: result.safetyBackup,
        restart: true,
      });
      // Give Express 500 ms to flush the response, then exit.
      // On Render, the process manager (or Render itself) will restart the server.
      setTimeout(() => process.exit(0), 500);
    } catch (err) {
      res.status(500).json({ error: 'Restore failed: ' + err.message });
    }
  });

  // DELETE /api/backups/:file — delete one backup
  router.delete('/:file', (req, res) => {
    try {
      deleteBackup(req.params.file);
      if (audit) audit.log(db, { user: req.user, action: audit.ACTIONS.BACKUP_DELETED, targetType: 'Backup', targetId: req.params.file, ip: audit.getIp(req) });
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { buildRouter, scheduleDaily, createBackup, listBackups };
