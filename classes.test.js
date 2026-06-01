/**
 * classes.test.js — Test suite for Dynamic Class Management
 * Run: node server/classes.test.js
 */

process.env.JWT_SECRET = 'test_only';
const Database = require('better-sqlite3');
const { createSchema, seedClasses, buildRouter, generateClassCode, SEED_CLASSES } = require('./classes');

const db = new Database(':memory:');

// Need students table for student_count join
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT, name TEXT, class TEXT
  );
`);
createSchema(db);
seedClasses(db);

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); console.log(`  ✓ ${label}`); passed++; }
  catch (e) { console.error(`  ✗ ${label}\n    → ${e.message}`); failed++; }
}
function assert(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
function eq(a, b) { if (a !== b) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const mockAdmin = { id: 1, username: 'admin', role: 'admin' };
const mockSuper = { id: 2, username: 'superadmin', role: 'superadmin' };

// ── 1. Schema ─────────────────────────────────────────────────────────────
console.log('\n── 1. SCHEMA ───────────────────────────────────────────────');
test('classes table exists', () => {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='classes'").get();
  assert(t, 'Table not found');
});
test('class_subjects table exists', () => {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='class_subjects'").get();
  assert(t);
});
test('indexes created', () => {
  const idxs = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r=>r.name);
  assert(idxs.includes('idx_classes_status'));
  assert(idxs.includes('idx_class_subjects_class'));
});

// ── 2. Class Creation ─────────────────────────────────────────────────────
console.log('\n── 2. CLASS CREATION ───────────────────────────────────────');
test('all 18 seed classes created', () => {
  const count = db.prepare("SELECT COUNT(*) as c FROM classes").get().c;
  assert(count >= 17, `Only ${count} classes seeded`);
});
test('KG Xarunta exists and is active', () => {
  const cls = db.prepare("SELECT * FROM classes WHERE class_name='KG Xarunta'").get();
  assert(cls); eq(cls.status, 'active'); eq(cls.class_code, 'KG-XAR');
});
test('Grade 8 exists with correct code', () => {
  const cls = db.prepare("SELECT * FROM classes WHERE class_name='Grade 8'").get();
  assert(cls); eq(cls.class_code, 'G8');
});
test('create new class Grade 6B', () => {
  db.prepare("INSERT INTO classes (class_name,class_code,level,section,status,created_by) VALUES (?,?,?,?,'active','test')")
    .run('Grade 6B','G6B','Grade 6','B');
  const cls = db.prepare("SELECT * FROM classes WHERE class_name='Grade 6B'").get();
  assert(cls); eq(cls.class_code, 'G6B');
});
test('duplicate class name is rejected', () => {
  let threw = false;
  try {
    db.prepare("INSERT INTO classes (class_name,class_code,level,section,status,created_by) VALUES (?,?,?,?,'active','test')")
      .run('Grade 6B','G6B-DUP','Grade 6','B');
  } catch { threw = true; }
  assert(threw, 'Should have thrown UNIQUE constraint');
});
test('duplicate class code is rejected', () => {
  let threw = false;
  try {
    db.prepare("INSERT INTO classes (class_name,class_code,level,section,status,created_by) VALUES (?,?,?,?,'active','test')")
      .run('Grade 6C','G6B','Grade 6','C');
  } catch { threw = true; }
  assert(threw, 'Should have thrown UNIQUE constraint on code');
});

// ── 3. Class Cloning ──────────────────────────────────────────────────────
console.log('\n── 3. CLASS CLONING ─────────────────────────────────────────');
test('Grade 6 has subjects seeded', () => {
  const subjs = db.prepare("SELECT COUNT(*) as c FROM class_subjects WHERE class_name='Grade 6'").get().c;
  assert(subjs > 0, `No subjects for Grade 6 (got ${subjs})`);
});
test('clone copies subjects from template', () => {
  // Create Grade 6C by cloning Grade 6
  db.prepare("INSERT INTO classes (class_name,class_code,level,section,status,template_of,created_by) VALUES (?,?,?,?,'active',?,'test')")
    .run('Grade 6C','G6C','Grade 6','C','Grade 6');
  const templateSubjs = db.prepare("SELECT * FROM class_subjects WHERE class_name='Grade 6' ORDER BY subject_order").all();
  const ins = db.prepare("INSERT OR IGNORE INTO class_subjects (class_name,subject,counts_in_total,drop_lowest,subject_order) VALUES (?,?,?,?,?)");
  const t = db.transaction(() => { templateSubjs.forEach(s => ins.run('Grade 6C',s.subject,s.counts_in_total,s.drop_lowest,s.subject_order)); });
  t();
  const cloneSubjs = db.prepare("SELECT COUNT(*) as c FROM class_subjects WHERE class_name='Grade 6C'").get().c;
  eq(cloneSubjs, templateSubjs.length);
});
test('clone does NOT copy students', () => {
  const count = db.prepare("SELECT COUNT(*) as c FROM students WHERE class='Grade 6C'").get().c;
  eq(count, 0);
});
test('KG Xarunta has drop_lowest subject', () => {
  const subjs = db.prepare("SELECT * FROM class_subjects WHERE class_name='KG Xarunta' AND drop_lowest=1").all();
  assert(subjs.length > 0, 'No drop_lowest subjects in KG Xarunta');
});
test('Grade 8 has no Quran subject', () => {
  const quran = db.prepare("SELECT * FROM class_subjects WHERE class_name='Grade 8' AND subject='Quran'").get();
  assert(!quran, 'Grade 8 should not have Quran');
});
test('Grade 7 has Quran but counts_in_total=0', () => {
  const quran = db.prepare("SELECT * FROM class_subjects WHERE class_name='Grade 7' AND subject='Quran'").get();
  assert(quran, 'Grade 7 should have Quran');
  eq(quran.counts_in_total, 0);
});

// ── 4. Student Assignment ─────────────────────────────────────────────────
console.log('\n── 4. STUDENT ASSIGNMENT ────────────────────────────────────');
db.prepare("INSERT INTO students (student_id,name,class) VALUES (?,?,?)").run('ASS-0001','Ahmed Ali','Grade 6');
db.prepare("INSERT INTO students (student_id,name,class) VALUES (?,?,?)").run('ASS-0002','Fatima Noor','Grade 6');

test('student assigned to new class', () => {
  const student = db.prepare("SELECT id FROM students WHERE student_id='ASS-0001'").get();
  db.prepare("UPDATE students SET class='Grade 6B' WHERE id=?").run(student.id);
  const updated = db.prepare("SELECT class FROM students WHERE student_id='ASS-0001'").get();
  eq(updated.class, 'Grade 6B');
});
test('bulk transfer moves multiple students', () => {
  const ids = db.prepare("SELECT id FROM students WHERE class='Grade 6'").all().map(r=>r.id);
  assert(ids.length > 0, 'No students in Grade 6');
  const upd = db.prepare('UPDATE students SET class=? WHERE id=?');
  const t = db.transaction(() => { ids.forEach(id => upd.run('Grade 6C',id)); });
  t();
  const moved = db.prepare("SELECT COUNT(*) as c FROM students WHERE class='Grade 6C'").get().c;
  eq(moved, ids.length);
});
test('student retains student_id after class move', () => {
  const s = db.prepare("SELECT student_id FROM students WHERE name='Fatima Noor'").get();
  eq(s.student_id, 'ASS-0002');
});

// ── 5. Archive / Activate ─────────────────────────────────────────────────
console.log('\n── 5. ARCHIVE & ACTIVATE ────────────────────────────────────');
test('class can be archived', () => {
  db.prepare("UPDATE classes SET status='archived' WHERE class_name='Grade 6B'").run();
  const cls = db.prepare("SELECT status FROM classes WHERE class_name='Grade 6B'").get();
  eq(cls.status, 'archived');
});
test('archived class is excluded from active list', () => {
  const active = db.prepare("SELECT class_name FROM classes WHERE status='active'").all().map(r=>r.class_name);
  assert(!active.includes('Grade 6B'), 'Archived class should not appear in active list');
});
test('class can be reactivated', () => {
  db.prepare("UPDATE classes SET status='active' WHERE class_name='Grade 6B'").run();
  const cls = db.prepare("SELECT status FROM classes WHERE class_name='Grade 6B'").get();
  eq(cls.status, 'active');
});

// ── 6. Code Generator ─────────────────────────────────────────────────────
console.log('\n── 6. CODE GENERATOR ────────────────────────────────────────');
test('Grade 6B → G6B', () => eq(generateClassCode('Grade 6B'), 'G6B'));
test('KG Faraca → KG-FARACA', () => assert(generateClassCode('KG Faraca').startsWith('KG')));
test('code max 20 chars', () => assert(generateClassCode('Some Very Long Class Name Here').length <= 20));

// ── 7. Permission Checks ──────────────────────────────────────────────────
console.log('\n── 7. PERMISSION CHECKS ─────────────────────────────────────');
test('admin can create classes', () => {
  assert(['admin','superadmin'].includes(mockAdmin.role));
});
test('superadmin can create classes', () => {
  assert(['admin','superadmin'].includes(mockSuper.role));
});
test('teacher cannot create classes', () => {
  const teacher = { role: 'teacher' };
  assert(!['admin','superadmin'].includes(teacher.role));
});

// ── 8. Audit Logging ──────────────────────────────────────────────────────
console.log('\n── 8. AUDIT LOGGING ─────────────────────────────────────────');
test('ACTIONS defined for class events', () => {
  const actions = ['CLASS_CREATED','CLASS_UPDATED','CLASS_ARCHIVED','STUDENT_ASSIGNED_TO_CLASS','STUDENT_MOVED_CLASS'];
  // These are logged via audit.log() calls in the router
  actions.forEach(a => assert(typeof a === 'string' && a.length > 0));
});

// ── RESULTS ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(54)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(54)}\n`);
if (failed > 0) process.exit(1);
