/**
 * jsonStore.js — Persistent JSON file storage for users, groups, tasks, submissions.
 * Survives restarts. Stores in ./data/ directory.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

const DEFAULTS = {
  groups:          {},
  users:           {},
  tasks:           {},
  submissions:     {},
  userSubmissions: {},
  taskCounter:     0,
  submissionCounter: 0,
};

let _cache = null;

function load() {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    _cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    _cache = { ...DEFAULTS };
  }
  return _cache;
}

function save() {
  if (!_cache) return;
  const tmp = STORE_PATH + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(_cache), 'utf8');
    fs.renameSync(tmp, STORE_PATH);
  } catch (e) {
    console.error('[jsonStore] save failed:', e.message);
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// Debounce saves to avoid hammering disk on every operation
let _saveTimer = null;
function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { save(); _saveTimer = null; }, 300);
}

function getData() {
  return load();
}

function mutate(fn) {
  const d = load();
  fn(d);
  scheduleSave();
  return d;
}

module.exports = { getData, mutate, save };
