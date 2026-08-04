const Database = require('better-sqlite3');

// Create or connect to database file
const db = new Database('db/reservations.db');

// Create table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    time TEXT NOT NULL,
    date TEXT NOT NULL,
    party_size INTEGER NOT NULL,
    notes TEXT
  )
`).run();

module.exports = db;