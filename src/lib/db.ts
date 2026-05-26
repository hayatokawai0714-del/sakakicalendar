import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data.db");
export const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  contact_name TEXT,
  email TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS unit_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  shipment_type TEXT NOT NULL,
  destination_id INTEGER NOT NULL,
  spec TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  memo TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(destination_id) REFERENCES destinations(id)
);
CREATE TABLE IF NOT EXISTS recurring_shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  destination_id INTEGER NOT NULL,
  recurrence_type TEXT NOT NULL,
  weekday INTEGER,
  day_of_month INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT,
  spec TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  memo TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(destination_id) REFERENCES destinations(id)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT,
  title TEXT NOT NULL,
  memo TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  content TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 2,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const recurringColumns = db.prepare("PRAGMA table_info(recurring_shipments)").all() as Array<{ name: string }>;
if (!recurringColumns.some((c) => c.name === "day_of_months")) {
  db.exec("ALTER TABLE recurring_shipments ADD COLUMN day_of_months TEXT");
}

const specs = ["40cm", "45cm", "作り榊"];
const units = ["kg", "束", "ケース", "箱", "本", "袋", "個"];
const count = db.prepare("SELECT COUNT(*) c FROM unit_settings").get() as { c: number };
if (count.c === 0) {
  const insert = db.prepare("INSERT INTO unit_settings (category, name, sort_order, is_visible) VALUES (?, ?, ?, 1)");
  specs.forEach((name, i) => insert.run("spec", name, i));
  units.forEach((name, i) => insert.run("unit", name, i));
}
