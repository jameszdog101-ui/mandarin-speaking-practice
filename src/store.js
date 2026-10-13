const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class Store {
  constructor(root) {
    this.root = root;
    this.dbFile = path.join(root, 'db.json');
    this.audioRoot = path.join(root, 'audio');
    fs.mkdirSync(this.audioRoot, { recursive: true });
    this.db = fs.existsSync(this.dbFile)
      ? JSON.parse(fs.readFileSync(this.dbFile, 'utf8'))
      : { assignments: [], sessions: [] };
  }

  id(prefix) { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
  save() {
    fs.mkdirSync(this.root, { recursive: true });
    const tmp = `${this.dbFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.dbFile);
  }
  assignmentByCode(code) {
    return this.db.assignments.find((a) => a.code === String(code).toUpperCase());
  }
  publicAssignment(a) {
    return { id: a.id, code: a.code, title: a.title, instructions: a.instructions,
      anonymous: a.anonymous, maxAttempts: a.maxAttempts,
      sentences: a.sentences.map(({ id, text, pinyin }) => ({ id, text, pinyin })) };
  }
}

module.exports = { Store };
