/**
 * classes.js — Dynamic Class Management Module
 *
 * Responsibilities:
 *   - createSchema(db)     : add classes + class_subjects tables
 *   - seedClasses(db)      : seed all existing hard-coded classes
 *   - buildRouter(...)     : Express router for /api/classes endpoints
 *
 * Design decisions:
 *   - Classes are stored in DB but frontend CLASSES array is built dynamically
 *   - class_subjects stores subject config per class (what counts, dropLowest)
 *   - Template copy duplicates subjects config only — no student/mark/attendance data
 *   - class_code is auto-generated from class_name if not provided
 *   - Archived classes are hidden from active lists but data is preserved
 */

const express = require('express');

// ── SCHEMA ──────────────────────────────────────────────────────────────────
function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS classes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      class_name  TEXT UNIQUE NOT NULL,
      class_code  TEXT UNIQUE NOT NULL,
      level       TEXT,
      section     TEXT,
      status      TEXT NOT NULL DEFAULT 'active',
      template_of TEXT,
      created_by  TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_classes_status     ON classes(status);
    CREATE INDEX IF NOT EXISTS idx_classes_level      ON classes(level);

    CREATE TABLE IF NOT EXISTS class_subjects (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      class_name    TEXT NOT NULL,
      subject       TEXT NOT NULL,
      counts_in_total INTEGER DEFAULT 1,
      drop_lowest   INTEGER DEFAULT 0,
      subject_order INTEGER DEFAULT 0,
      UNIQUE(class_name, subject)
    );

    CREATE INDEX IF NOT EXISTS idx_class_subjects_class ON class_subjects(class_name);
  `);
}

// ── SEED EXISTING CLASSES ───────────────────────────────────────────────────
const SEED_CLASSES = [
  // KG
  { name: 'KG Xarunta',     code: 'KG-XAR', level: 'KG',      section: 'Xarunta' },
  { name: 'KG Faraca',      code: 'KG-FAR', level: 'KG',      section: 'Faraca'  },
  { name: 'KG Galbeedka',   code: 'KG-GAL', level: 'KG',      section: 'Galbeedka' },
  // Grade 1
  { name: 'Grade 1 Xarunta',  code: 'G1-XAR', level: 'Grade 1', section: 'Xarunta' },
  { name: 'Grade 1 Faraca',   code: 'G1-FAR', level: 'Grade 1', section: 'Faraca'  },
  { name: 'Grade 1 Galbeedka',code: 'G1-GAL', level: 'Grade 1', section: 'Galbeedka' },
  // Grade 2-5 split
  { name: 'Grade 2 Xarunta', code: 'G2-XAR', level: 'Grade 2', section: 'Xarunta' },
  { name: 'Grade 2 Faraca',  code: 'G2-FAR', level: 'Grade 2', section: 'Faraca'  },
  { name: 'Grade 3 Xarunta', code: 'G3-XAR', level: 'Grade 3', section: 'Xarunta' },
  { name: 'Grade 3 Faraca',  code: 'G3-FAR', level: 'Grade 3', section: 'Faraca'  },
  { name: 'Grade 4 Xarunta', code: 'G4-XAR', level: 'Grade 4', section: 'Xarunta' },
  { name: 'Grade 4 Faraca',  code: 'G4-FAR', level: 'Grade 4', section: 'Faraca'  },
  { name: 'Grade 5 Xarunta', code: 'G5-XAR', level: 'Grade 5', section: 'Xarunta' },
  { name: 'Grade 5 Faraca',  code: 'G5-FAR', level: 'Grade 5', section: 'Faraca'  },
  // Single classes
  { name: 'Grade 6',  code: 'G6',  level: 'Grade 6',  section: '' },
  { name: 'Grade 7',  code: 'G7',  level: 'Grade 7',  section: '' },
  { name: 'Grade 8',  code: 'G8',  level: 'Grade 8',  section: '' },
  { name: 'Graduated',code: 'GRAD',level: 'Graduated', section: '' },
];

// Subject config: [subject, countsInTotal, order]
const SEED_SUBJECTS = {
  'KG Xarunta': [
    ["Quran",1,0],["Kitaaba",1,1],["Qiraa'a",1,2],["Yeeris",1,3],["Xisaab",1,4],
  ],
  'KG Faraca': [
    ["Quran",0,0],["Kitaaba",1,1],["Qiraa'a",1,2],["Yeeris",1,3],["Xisaab",1,4],
  ],
  'KG Galbeedka': [
    ["Qur'an",0,0],["Akhris",1,1],["Kitaaba",1,2],["Yeeris",1,3],["Xisaab",1,4],
  ],
  'Grade 1 Xarunta': [
    ["Quran",0,0],["Kitaaba",1,1],["Qiraa'a",1,2],["Yeeris",1,3],["Xisaab",1,4],["Soomaali",1,5],["Ingiriisi",1,6],
  ],
  'Grade 1 Faraca': [
    ["Quran",0,0],["Kitaaba",1,1],["Qiraa'a",1,2],["Yeeris",1,3],["Xisaab",1,4],["Soomaali",1,5],["Ingiriisi",1,6],
  ],
  'Grade 1 Galbeedka': [
    ["Quran",0,0],["Kitaaba",1,1],["Qiraa'a",1,2],["Yeeris",1,3],["Xisaab",1,4],["Soomaali",1,5],["Ingiriisi",1,6],
  ],
  'Grade 2 Xarunta': [
    ["Quran",0,0],["Tarabiyo",1,1],["Carabi",1,2],["Xisaab",1,3],["Soomaali",1,4],["Social",1,5],["Ingiriisi",1,6],["Saynaska",1,7],
  ],
  'Grade 2 Faraca': [
    ["Quran",0,0],["Tarabiyo",1,1],["Carabi",1,2],["Xisaab",1,3],["Soomaali",1,4],["Social",1,5],["Ingiriisi",1,6],["Saynaska",1,7],
  ],
  'Grade 3 Xarunta': [
    ["Quran",0,0],["Tarabiyo",1,1],["Saynaska",1,2],["Social",1,3],["Soomaali",1,4],["Ingiriisi",1,5],["Xisaab",1,6],["Carabi",1,7],
  ],
  'Grade 3 Faraca': [
    ["Quran",0,0],["Tarabiyo",1,1],["Saynaska",1,2],["Social",1,3],["Soomaali",1,4],["Ingiriisi",1,5],["Xisaab",1,6],["Carabi",1,7],
  ],
  'Grade 4 Xarunta': [
    ["Quran",0,0],["Social",1,1],["Soomaali",1,2],["Tarabiyo",1,3],["Saynaska",1,4],["Ingiriisi",1,5],["Xisaab",1,6],["Carabi",1,7],
  ],
  'Grade 4 Faraca': [
    ["Quran",0,0],["Social",1,1],["Soomaali",1,2],["Tarabiyo",1,3],["Saynaska",1,4],["Ingiriisi",1,5],["Xisaab",1,6],["Carabi",1,7],
  ],
  'Grade 5 Xarunta': [
    ["Quran",0,0],["Carabi",1,1],["Tarabiyo",1,2],["Soomaali",1,3],["Ingiriisi",1,4],["Xisaab",1,5],["Social",1,6],["Saynaska",1,7],
  ],
  'Grade 5 Faraca': [
    ["Quran",0,0],["Carabi",1,1],["Tarabiyo",1,2],["Soomaali",1,3],["Ingiriisi",1,4],["Xisaab",1,5],["Social",1,6],["Saynaska",1,7],
  ],
  'Grade 6': [
    ["Quran",0,0],["Carabi",1,1],["Tarabiyo",1,2],["Ingiriisi",1,3],["Soomaali",1,4],["Xisaab",1,5],["Social",1,6],["Saynaska",1,7],
  ],
  'Grade 7': [
    ["Quran",0,0],["Carabi",1,1],["Tarabiyo",1,2],["Xisaab",1,3],["ICT",1,4],["Ingiriisi",1,5],["Social",1,6],["Soomaali",1,7],["Saynaska",1,8],
  ],
  'Grade 8': [
    ["Carabi",1,0],["Xisaab",1,1],["Ingiriisi",1,2],["Soomaali",1,3],["Cilm.Bulsho",1,4],["Tarabiyo",1,5],["ICT",1,6],["Saynaska",1,7],
  ],
};

function seedClasses(db) {
  const insertClass   = db.prepare(`INSERT OR IGNORE INTO classes (class_name,class_code,level,section,status,created_by) VALUES (?,?,?,?,'active','system')`);
  const insertSubject = db.prepare(`INSERT OR IGNORE INTO class_subjects (class_name,subject,counts_in_total,drop_lowest,subject_order) VALUES (?,?,?,?,?)`);

  const seedAll = db.transaction(() => {
    // KG Xarunta: dropLowest=1
    for (const cls of SEED_CLASSES) {
      insertClass.run(cls.name, cls.code, cls.level, cls.section);
    }
    for (const [className, subjects] of Object.entries(SEED_SUBJECTS)) {
      const isKGXar = className === 'KG Xarunta';
      for (const [subj, counts, order] of subjects) {
        insertSubject.run(className, subj, counts, isKGXar ? 1 : 0, order);
      }
    }
  });
  seedAll();
}

// ── CODE GENERATOR ──────────────────────────────────────────────────────────
function generateClassCode(className) {
  // "Grade 6B" → "G6B", "KG Faraca 2" → "KG-FAR-2"
  return className
    .replace(/Grade\s*/i, 'G')
    .replace(/\s+/g, '-')
    .toUpperCase()
    .substring(0, 20);
}

// ── ROUTER ──────────────────────────────────────────────────────────────────
function buildRouter(db, authMiddleware, requireRole, auditModule) {
  const router = express.Router();

  // ── GET /api/classes — list all active classes ──
  router.get('/', authMiddleware, (req, res) => {
    try {
      const { status, search } = req.query;
      let q = `SELECT c.*, COUNT(s.id) as student_count
               FROM classes c
               LEFT JOIN students s ON s.class = c.class_name
               WHERE 1=1`;
      const params = [];
      if (status) { q += ' AND c.status=?'; params.push(status); }
      else         { q += " AND c.status != 'archived'"; }
      if (search)  { q += ' AND (c.class_name LIKE ? OR c.class_code LIKE ? OR c.level LIKE ?)'; params.push('%'+search+'%','%'+search+'%','%'+search+'%'); }
      q += ' GROUP BY c.id ORDER BY c.level, c.section';
      res.json(db.prepare(q).all(...params));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/classes/:name/subjects — subjects for a class ──
  router.get('/:name/subjects', authMiddleware, (req, res) => {
    try {
      const subjects = db.prepare(
        'SELECT * FROM class_subjects WHERE class_name=? ORDER BY subject_order, subject'
      ).all(req.params.name);
      res.json(subjects);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/classes — create new class ──
  router.post('/', authMiddleware, requireRole('superadmin','admin'), (req, res) => {
    try {
      const { class_name, class_code, level, section, template_class } = req.body;
      if (!class_name) return res.status(400).json({ error: 'class_name is required' });

      const code = class_code || generateClassCode(class_name);

      // Check duplicates
      if (db.prepare('SELECT 1 FROM classes WHERE class_name=?').get(class_name))
        return res.status(400).json({ error: `Class "${class_name}" already exists` });
      if (db.prepare('SELECT 1 FROM classes WHERE class_code=?').get(code))
        return res.status(400).json({ error: `Class code "${code}" already taken` });

      const createAndCopy = db.transaction(() => {
        db.prepare(`INSERT INTO classes (class_name,class_code,level,section,status,template_of,created_by)
          VALUES (?,?,?,?,'active',?,?)`).run(class_name, code, level||'', section||'', template_class||null, req.user.username);

        // Copy subject config from template if provided
        if (template_class) {
          const templateSubjects = db.prepare(
            'SELECT * FROM class_subjects WHERE class_name=? ORDER BY subject_order'
          ).all(template_class);
          const insertSubj = db.prepare(`INSERT OR IGNORE INTO class_subjects
            (class_name,subject,counts_in_total,drop_lowest,subject_order) VALUES (?,?,?,?,?)`);
          for (const s of templateSubjects) {
            insertSubj.run(class_name, s.subject, s.counts_in_total, s.drop_lowest, s.subject_order);
          }
        }
      });
      createAndCopy();

      if (auditModule) auditModule.log(db, {
        user: req.user, action: 'CLASS_CREATED',
        targetType: 'Class', targetId: class_name,
        details: template_class ? `Cloned from ${template_class}` : 'New class',
        ip: auditModule.getIp(req),
      });

      res.json({ success: true, class_name, class_code: code });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/classes/:name — edit class ──
  router.put('/:name', authMiddleware, requireRole('superadmin','admin'), (req, res) => {
    try {
      const { class_code, level, section } = req.body;
      const existing = db.prepare('SELECT * FROM classes WHERE class_name=?').get(req.params.name);
      if (!existing) return res.status(404).json({ error: 'Class not found' });

      db.prepare(`UPDATE classes SET class_code=?,level=?,section=?,updated_at=CURRENT_TIMESTAMP WHERE class_name=?`)
        .run(class_code||existing.class_code, level||existing.level, section||existing.section, req.params.name);

      if (auditModule) auditModule.log(db, {
        user: req.user, action: 'CLASS_UPDATED',
        targetType: 'Class', targetId: req.params.name,
        details: `Updated: code=${class_code}, level=${level}, section=${section}`,
        ip: auditModule.getIp(req),
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/classes/:name/status — archive or activate ──
  router.patch('/:name/status', authMiddleware, requireRole('superadmin','admin'), (req, res) => {
    try {
      const { status } = req.body;
      if (!['active','archived'].includes(status))
        return res.status(400).json({ error: 'status must be active or archived' });
      db.prepare("UPDATE classes SET status=?,updated_at=CURRENT_TIMESTAMP WHERE class_name=?").run(status, req.params.name);

      if (auditModule) auditModule.log(db, {
        user: req.user, action: status === 'archived' ? 'CLASS_ARCHIVED' : 'CLASS_UPDATED',
        targetType: 'Class', targetId: req.params.name,
        details: `Status changed to ${status}`,
        ip: auditModule.getIp(req),
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/classes/:name/subjects — update subject list ──
  router.put('/:name/subjects', authMiddleware, requireRole('superadmin','admin'), (req, res) => {
    try {
      const { subjects } = req.body; // [{subject, counts_in_total, drop_lowest, subject_order}]
      if (!Array.isArray(subjects)) return res.status(400).json({ error: 'subjects must be an array' });
      const updateSubjects = db.transaction(() => {
        db.prepare('DELETE FROM class_subjects WHERE class_name=?').run(req.params.name);
        const ins = db.prepare(`INSERT INTO class_subjects (class_name,subject,counts_in_total,drop_lowest,subject_order) VALUES (?,?,?,?,?)`);
        subjects.forEach((s, i) => ins.run(req.params.name, s.subject, s.counts_in_total?1:0, s.drop_lowest?1:0, s.subject_order||i));
      });
      updateSubjects();

      if (auditModule) auditModule.log(db, {
        user: req.user, action: 'CLASS_UPDATED',
        targetType: 'Class', targetId: req.params.name,
        details: `Subjects updated: ${subjects.map(s=>s.subject).join(', ')}`,
        ip: auditModule.getIp(req),
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/classes/assign-student — assign or move a student ──
  router.post('/assign-student', authMiddleware, requireRole('superadmin','admin'), (req, res) => {
    try {
      const { student_id, target_class } = req.body;
      if (!student_id || !target_class) return res.status(400).json({ error: 'student_id and target_class required' });

      const student = db.prepare('SELECT * FROM students WHERE id=?').get(student_id);
      if (!student) return res.status(404).json({ error: 'Student not found' });

      const targetExists = db.prepare("SELECT 1 FROM classes WHERE class_name=? AND status='active'").get(target_class);
      if (!targetExists) return res.status(400).json({ error: `Class "${target_class}" not found or archived` });

      const fromClass = student.class;
      db.prepare('UPDATE students SET class=? WHERE id=?').run(target_class, student_id);

      if (auditModule) {
        const action = fromClass === target_class ? 'STUDENT_ASSIGNED_TO_CLASS' : 'STUDENT_MOVED_CLASS';
        auditModule.log(db, {
          user: req.user, action,
          targetType: 'Student', targetId: student.student_id,
          details: `${student.name}: ${fromClass} → ${target_class}`,
          ip: auditModule.getIp(req),
        });
      }
      res.json({ success: true, from: fromClass, to: target_class });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/classes/bulk-assign — move multiple students ──
  router.post('/bulk-assign', authMiddleware, requireRole('superadmin','admin'), (req, res) => {
    try {
      const { student_ids, target_class } = req.body;
      if (!Array.isArray(student_ids) || !student_ids.length || !target_class)
        return res.status(400).json({ error: 'student_ids array and target_class required' });

      const targetExists = db.prepare("SELECT 1 FROM classes WHERE class_name=? AND status='active'").get(target_class);
      if (!targetExists) return res.status(400).json({ error: `Class "${target_class}" not found or archived` });

      const updateMany = db.transaction(() => {
        for (const sid of student_ids) {
          const student = db.prepare('SELECT * FROM students WHERE id=?').get(sid);
          if (!student) continue;
          db.prepare('UPDATE students SET class=? WHERE id=?').run(target_class, sid);
          if (auditModule) auditModule.log(db, {
            user: req.user, action: 'STUDENT_MOVED_CLASS',
            targetType: 'Student', targetId: student.student_id,
            details: `${student.name}: ${student.class} → ${target_class}`,
            ip: auditModule.getIp(req),
          });
        }
      });
      updateMany();
      res.json({ success: true, moved: student_ids.length, to: target_class });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createSchema, seedClasses, buildRouter, generateClassCode, SEED_CLASSES };
