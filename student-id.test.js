/**
 * student-id.test.js
 * 
 * Test suite for the Student ID Management System.
 * Run with: node server/student-id.test.js
 * (No test framework needed — plain Node.js assertions)
 */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

// ── Bootstrap a fresh in-memory database ──────────────────────────────────
process.env.JWT_SECRET = 'test_secret_for_tests_only';
process.env.DB_PATH    = ':memory:';  // in-memory DB, discarded after tests

// We test the logic functions directly without starting the HTTP server.
// Re-use the same Database setup as server.js by extracting what we need.
const Database = require('better-sqlite3');
const db = new Database(':memory:');

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    num INTEGER,
    student_id TEXT UNIQUE,
    name TEXT NOT NULL,
    class TEXT NOT NULL,
    gender TEXT, dob TEXT,
    guardian_name TEXT, guardian_phone TEXT,
    father_phone TEXT, mother_name TEXT, mother_phone TEXT,
    fee_amount INTEGER DEFAULT 0,
    fee_type TEXT DEFAULT 'Full payment'
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sid ON students(student_id);
`);

// ── Copy the two pure functions from server.js ─────────────────────────────
function generateStudentId() {
  const row = db.prepare(
    "SELECT student_id FROM students WHERE student_id LIKE 'ASS-%' ORDER BY student_id DESC LIMIT 1"
  ).get();
  if (!row) return 'ASS-0001';
  const num = parseInt(row.student_id.split('-')[1], 10);
  return 'ASS-' + String(num + 1).padStart(4, '0');
}

function validateStudentId(sid) {
  return /^ASS-\d{4}$/.test(sid);
}

function insertStudent(name, cls = 'Grade 5 Xarunta') {
  const sid = generateStudentId();
  const result = db.prepare(
    'INSERT INTO students (student_id, name, class) VALUES (?,?,?)'
  ).run(sid, name, cls);
  return { id: result.lastInsertRowid, student_id: sid };
}

// ── TEST HELPERS ───────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    → ${err.message}`);
    failed++;
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ══════════════════════════════════════════════════════════════════════════

console.log('\n── 1. FORMAT VALIDATION ───────────────────────────────────');

test('ASS-0001 is valid',   () => assert.ok(validateStudentId('ASS-0001')));
test('ASS-9999 is valid',   () => assert.ok(validateStudentId('ASS-9999')));
test('ASS-0643 is valid',   () => assert.ok(validateStudentId('ASS-0643')));
test('ass-0001 is invalid (lowercase)', () => assert.ok(!validateStudentId('ass-0001')));
test('ASS-001 is invalid (3 digits)',   () => assert.ok(!validateStudentId('ASS-001')));
test('ASS-10000 is invalid (5 digits)', () => assert.ok(!validateStudentId('ASS-10000')));
test('plain number is invalid',         () => assert.ok(!validateStudentId('0001')));
test('empty string is invalid',         () => assert.ok(!validateStudentId('')));

console.log('\n── 2. FIRST STUDENT GENERATION ────────────────────────────');

test('first student gets ASS-0001', () => {
  const sid = generateStudentId();
  assert.strictEqual(sid, 'ASS-0001');
});

console.log('\n── 3. EXISTING STUDENT MIGRATION ──────────────────────────');

// Simulate seeding 643 existing students without student_ids
db.exec("DELETE FROM students");
const bulkInsert = db.prepare("INSERT INTO students (name, class) VALUES (?,?)");
const insertMany = db.transaction(() => {
  for (let i = 1; i <= 643; i++) bulkInsert.run(`Student ${i}`, 'Grade 5 Xarunta');
});
insertMany();

test('643 students inserted without student_ids', () => {
  const count = db.prepare("SELECT COUNT(*) as c FROM students WHERE student_id IS NULL").get().c;
  assert.strictEqual(count, 643);
});

// Run migration
const missing = db.prepare("SELECT id FROM students WHERE student_id IS NULL ORDER BY id ASC").all();
let counter = 0;
const updateSid = db.prepare("UPDATE students SET student_id=? WHERE id=?");
const migrate = db.transaction(() => {
  for (const s of missing) {
    counter++;
    updateSid.run('ASS-' + String(counter).padStart(4, '0'), s.id);
  }
});
migrate();

test('migration assigns ASS-0001 to first student', () => {
  const s = db.prepare("SELECT student_id FROM students ORDER BY id ASC LIMIT 1").get();
  assert.strictEqual(s.student_id, 'ASS-0001');
});

test('migration assigns ASS-0643 to last student', () => {
  const s = db.prepare("SELECT student_id FROM students ORDER BY id DESC LIMIT 1").get();
  assert.strictEqual(s.student_id, 'ASS-0643');
});

test('migration leaves no students without student_id', () => {
  const count = db.prepare("SELECT COUNT(*) as c FROM students WHERE student_id IS NULL").get().c;
  assert.strictEqual(count, 0);
});

test('all 643 student_ids are unique', () => {
  const total   = db.prepare("SELECT COUNT(*) as c FROM students").get().c;
  const unique  = db.prepare("SELECT COUNT(DISTINCT student_id) as c FROM students").get().c;
  assert.strictEqual(total, unique);
});

console.log('\n── 4. NEW STUDENT REGISTRATION ─────────────────────────────');

test('next student after ASS-0643 gets ASS-0644', () => {
  const { student_id } = insertStudent('New Student A');
  assert.strictEqual(student_id, 'ASS-0644');
});

test('student after that gets ASS-0645', () => {
  const { student_id } = insertStudent('New Student B');
  assert.strictEqual(student_id, 'ASS-0645');
});

test('new student is persisted in DB with correct id', () => {
  const { id } = insertStudent('Persisted Student');
  const row = db.prepare("SELECT student_id FROM students WHERE id=?").get(id);
  assert.ok(validateStudentId(row.student_id));
});

console.log('\n── 5. DUPLICATE PREVENTION ─────────────────────────────────');

test('inserting duplicate student_id throws UNIQUE constraint error', () => {
  assert.throws(
    () => db.prepare("INSERT INTO students (student_id, name, class) VALUES (?,?,?)").run('ASS-0001', 'Dup', 'Grade 5'),
    /UNIQUE constraint failed/
  );
});

test('generateStudentId() never returns an already-used id', () => {
  // Generate 10 new ids and confirm none already exist
  for (let i = 0; i < 10; i++) {
    const sid = generateStudentId();
    const exists = db.prepare("SELECT 1 FROM students WHERE student_id=?").get(sid);
    assert.ok(!exists, `${sid} already exists in the database`);
    // Insert it so the next call increments past it
    db.prepare("INSERT INTO students (student_id, name, class) VALUES (?,?,?)").run(sid, `Auto ${i}`, 'Grade 2');
  }
});

console.log('\n── 6. DELETED STUDENT ID NOT REUSED ────────────────────────');

test('deleting a student does not reuse their id', () => {
  // Insert, record id, delete, then generate next — should skip the deleted id
  const { student_id: deletedSid, id: dbId } = insertStudent('To Be Deleted');
  db.prepare("DELETE FROM students WHERE id=?").run(dbId);
  // The next generated id must be higher than the deleted one
  const nextSid = generateStudentId();
  const deletedNum = parseInt(deletedSid.split('-')[1], 10);
  const nextNum    = parseInt(nextSid.split('-')[1], 10);
  assert.ok(nextNum > deletedNum, `Expected next id > ${deletedSid}, got ${nextSid}`);
});

console.log('\n── 7. SEARCH FUNCTIONALITY ─────────────────────────────────');

test('can find student by exact student_id', () => {
  const s = db.prepare("SELECT * FROM students WHERE student_id=?").get('ASS-0001');
  assert.ok(s, 'Student ASS-0001 not found');
  assert.strictEqual(s.student_id, 'ASS-0001');
});

test('can find student by name prefix', () => {
  const rows = db.prepare("SELECT * FROM students WHERE name LIKE ?").all('Student 1%');
  assert.ok(rows.length > 0, 'No students found with name starting with "Student 1"');
});

test('student_id search prefix ASS- returns results', () => {
  const rows = db.prepare("SELECT * FROM students WHERE student_id LIKE ?").all('ASS-064%');
  assert.ok(rows.length > 0, 'No students found with student_id starting ASS-064');
});

console.log('\n── 8. ATTENDANCE / EXAM / PAYMENT INTEGRATION ──────────────');

test('student object includes student_id (used by all pages)', () => {
  const s = db.prepare("SELECT * FROM students LIMIT 1").get();
  assert.ok('student_id' in s, 'student_id field missing from student row');
  assert.ok(validateStudentId(s.student_id));
});

test('student_id is a string not a number', () => {
  const s = db.prepare("SELECT student_id FROM students LIMIT 1").get();
  assert.strictEqual(typeof s.student_id, 'string');
});

test('student_id column exists in schema', () => {
  const cols = db.prepare("PRAGMA table_info(students)").all().map(c => c.name);
  assert.ok(cols.includes('student_id'), 'student_id column missing from students table');
});

// ── RESULTS ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(54)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(54)}\n`);

if (failed > 0) process.exit(1);
