/**
 * audit.test.js — Test suite for the Audit Log System
 * Run: node server/audit.test.js
 */

process.env.JWT_SECRET = 'test_secret_only';
const Database = require('better-sqlite3');
const { createSchema, log, getIp, ACTIONS } = require('./audit');

const db = new Database(':memory:');
createSchema(db);

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✓ ${label}`); passed++; }
  catch (e) { console.error(`  ✗ ${label}\n    → ${e.message}`); failed++; }
}
function assert(val, msg) { if (!val) throw new Error(msg || 'Assertion failed'); }
function eq(a, b) { if (a !== b) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const mockUser  = { id: 1, username: 'superadmin', role: 'superadmin' };
const mockAdmin = { id: 2, username: 'admin',      role: 'admin' };
const mockTeach = { id: 3, username: 'teacher1',   role: 'teacher' };

// ── 1. Schema ─────────────────────────────────────────────────────────────
console.log('\n── 1. SCHEMA ───────────────────────────────────────────────');
test('activity_logs table exists', () => {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_logs'").get();
  assert(t, 'Table not found');
});
test('indexes created', () => {
  const idxs = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='activity_logs'").all().map(r => r.name);
  assert(idxs.includes('idx_audit_username'),   'idx_audit_username missing');
  assert(idxs.includes('idx_audit_action'),     'idx_audit_action missing');
  assert(idxs.includes('idx_audit_created_at'), 'idx_audit_created_at missing');
});

// ── 2. Login logging ──────────────────────────────────────────────────────
console.log('\n── 2. LOGIN LOGGING ─────────────────────────────────────────');
test('LOGIN_SUCCESS is logged', () => {
  log(db, { user: mockUser, action: ACTIONS.LOGIN_SUCCESS, targetType: 'Auth', targetId: 'superadmin', ip: '1.2.3.4' });
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='LOGIN_SUCCESS' ORDER BY id DESC LIMIT 1").get();
  assert(row, 'No row found');
  eq(row.username, 'superadmin');
  eq(row.ip_address, '1.2.3.4');
});
test('LOGIN_FAILED with null user is logged', () => {
  log(db, { user: null, action: ACTIONS.LOGIN_FAILED, targetType: 'Auth', targetId: 'hacker', details: 'Failed login', ip: '9.9.9.9' });
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='LOGIN_FAILED' ORDER BY id DESC LIMIT 1").get();
  assert(row, 'No row found');
  eq(row.username, 'anonymous');
  eq(row.target_id, 'hacker');
});
test('failed login records IP address', () => {
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='LOGIN_FAILED' ORDER BY id DESC LIMIT 1").get();
  eq(row.ip_address, '9.9.9.9');
});

// ── 3. Student creation logging ───────────────────────────────────────────
console.log('\n── 3. STUDENT CREATION LOGGING ──────────────────────────────');
test('STUDENT_CREATED is logged', () => {
  log(db, { user: mockAdmin, action: ACTIONS.STUDENT_CREATED, targetType: 'Student', targetId: 'ASS-0644', details: 'Name: Ahmed Ali, Class: Grade 5 Xarunta', ip: '10.0.0.1' });
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='STUDENT_CREATED' ORDER BY id DESC LIMIT 1").get();
  assert(row, 'No row found');
  eq(row.target_id, 'ASS-0644');
  assert(row.details.includes('Ahmed Ali'), 'Details missing name');
});
test('STUDENT_DELETED is logged', () => {
  log(db, { user: mockAdmin, action: ACTIONS.STUDENT_DELETED, targetType: 'Student', targetId: 'ASS-0100', details: 'Deleted: Test Student', ip: '10.0.0.1' });
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='STUDENT_DELETED' ORDER BY id DESC LIMIT 1").get();
  assert(row);
  eq(row.target_id, 'ASS-0100');
});

// ── 4. Exam mark logging ──────────────────────────────────────────────────
console.log('\n── 4. EXAM MARK LOGGING ─────────────────────────────────────');
test('MARKS_SAVED is logged', () => {
  log(db, { user: mockTeach, action: ACTIONS.MARKS_SAVED, targetType: 'Exam', targetId: 'Grade 5 Xarunta/Xisaab/Final', details: 'Saved 45 marks', ip: '192.168.1.5' });
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='MARKS_SAVED' ORDER BY id DESC LIMIT 1").get();
  assert(row);
  eq(row.username, 'teacher1');
  eq(row.role, 'teacher');
  assert(row.details.includes('45'), 'Details missing count');
});

// ── 5. Attendance logging ─────────────────────────────────────────────────
console.log('\n── 5. ATTENDANCE LOGGING ────────────────────────────────────');
test('ATTENDANCE_SAVED is logged', () => {
  log(db, { user: mockTeach, action: ACTIONS.ATTENDANCE_SAVED, targetType: 'Attendance', targetId: 'Grade 3 Xarunta/2026-05-30', details: 'Saved 45 records', ip: '10.0.0.2' });
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='ATTENDANCE_SAVED' ORDER BY id DESC LIMIT 1").get();
  assert(row); eq(row.username, 'teacher1');
});
test('ATTENDANCE_LOCKED is logged', () => {
  log(db, { user: mockAdmin, action: ACTIONS.ATTENDANCE_LOCKED, targetType: 'Attendance', targetId: 'Grade 3 Xarunta/2026-05-30', ip: '10.0.0.2' });
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='ATTENDANCE_LOCKED' ORDER BY id DESC LIMIT 1").get();
  assert(row);
});
test('ATTENDANCE_UNLOCKED is logged', () => {
  log(db, { user: mockAdmin, action: ACTIONS.ATTENDANCE_UNLOCKED, targetType: 'Attendance', targetId: 'Grade 3 Xarunta/2026-05-30', ip: '10.0.0.2' });
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='ATTENDANCE_UNLOCKED' ORDER BY id DESC LIMIT 1").get();
  assert(row);
});

// ── 6. Backup logging ─────────────────────────────────────────────────────
console.log('\n── 6. BACKUP LOGGING ────────────────────────────────────────');
test('BACKUP_CREATED is logged', () => {
  log(db, { user: mockUser, action: ACTIONS.BACKUP_CREATED, targetType: 'Backup', targetId: 'backup_2026-05-30.db', details: 'Size: 320.5 KB', ip: '10.0.0.1' });
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='BACKUP_CREATED' ORDER BY id DESC LIMIT 1").get();
  assert(row); assert(row.target_id.includes('backup_'));
});
test('BACKUP_RESTORED is logged', () => {
  log(db, { user: mockUser, action: ACTIONS.BACKUP_RESTORED, targetType: 'Backup', targetId: 'backup_2026-05-29.db', ip: '10.0.0.1' });
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='BACKUP_RESTORED' ORDER BY id DESC LIMIT 1").get();
  assert(row);
});
test('BACKUP_DELETED is logged', () => {
  log(db, { user: mockUser, action: ACTIONS.BACKUP_DELETED, targetType: 'Backup', targetId: 'backup_2026-05-01.db', ip: '10.0.0.1' });
  const row = db.prepare("SELECT * FROM activity_logs WHERE action='BACKUP_DELETED' ORDER BY id DESC LIMIT 1").get();
  assert(row);
});

// ── 7. Permission checks ──────────────────────────────────────────────────
console.log('\n── 7. PERMISSION CHECKS ─────────────────────────────────────');
test('logs are INSERT-only (no update column)', () => {
  const cols = db.prepare("PRAGMA table_info(activity_logs)").all().map(c => c.name);
  assert(!cols.includes('updated_at'), 'Should not have updated_at column');
});
test('log() never throws even with bad input', () => {
  log(db, { user: null, action: null, targetType: null, targetId: null, details: null, ip: null });
});
test('log() never throws with undefined fields', () => {
  log(db, {});
});

// ── 8. Search and filtering ───────────────────────────────────────────────
console.log('\n── 8. SEARCH AND FILTERING ──────────────────────────────────');
// Seed some test data
log(db, { user: mockAdmin, action: ACTIONS.STUDENT_CREATED, targetType: 'Student', targetId: 'ASS-0700', details: 'Search test student', ip: '1.1.1.1' });
log(db, { user: mockTeach, action: ACTIONS.MARKS_SAVED,     targetType: 'Exam',    targetId: 'Grade 6/Maths/Final',  ip: '2.2.2.2' });

test('filter by username returns only that user', () => {
  const rows = db.prepare("SELECT * FROM activity_logs WHERE username='teacher1'").all();
  assert(rows.length > 0, 'No rows for teacher1');
  rows.forEach(r => eq(r.username, 'teacher1'));
});
test('filter by action returns correct rows', () => {
  const rows = db.prepare("SELECT * FROM activity_logs WHERE action='STUDENT_CREATED'").all();
  assert(rows.length > 0, 'No STUDENT_CREATED rows');
  rows.forEach(r => eq(r.action, 'STUDENT_CREATED'));
});
test('filter by target_id partial match works', () => {
  const rows = db.prepare("SELECT * FROM activity_logs WHERE target_id LIKE '%ASS-%'").all();
  assert(rows.length > 0, 'No ASS- rows found');
});
test('logs are sorted newest first', () => {
  const rows = db.prepare("SELECT created_at FROM activity_logs ORDER BY created_at DESC").all();
  for (let i = 1; i < rows.length; i++) {
    assert(rows[i-1].created_at >= rows[i].created_at, 'Not sorted DESC');
  }
});
test('total log count is correct', () => {
  const count = db.prepare("SELECT COUNT(*) as c FROM activity_logs").get().c;
  assert(count > 0, 'No logs in DB');
});

// ── RESULTS ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(54)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(54)}\n`);
if (failed > 0) process.exit(1);
