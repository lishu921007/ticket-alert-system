const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'tickets.db');
const fs = require('fs');

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

// 初始化数据库
db.serialize(() => {
  // 工单表
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT UNIQUE,
    title TEXT,
    owner TEXT,
    manager TEXT,
    deadline TEXT,
    status TEXT DEFAULT '进行中',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 预警记录表
  db.run(`CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    warning_type TEXT,
    remaining_days INTEGER,
    notified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
  )`);

  // 逾期工单标记表
  db.run(`CREATE TABLE IF NOT EXISTS overdue_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    overdue_days INTEGER,
    level INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
  )`);

  // 原因分析表
  db.run(`CREATE TABLE IF NOT EXISTS analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    reason TEXT,
    solution TEXT,
    analyzed_by TEXT,
    analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
  )`);

  // 跟进记录表
  db.run(`CREATE TABLE IF NOT EXISTS follow_ups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    content TEXT,
    followed_by TEXT,
    is_important BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
  )`);
});

module.exports = db;
