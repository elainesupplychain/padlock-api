// 数据库初始化模块 - SQLite（基于 sql.js）
// 负责创建连接、建表

const path = require('path');
const { createDatabase } = require('./sqljs-adapter');

// 数据库文件路径（项目根目录下）
const DB_PATH = path.join(__dirname, 'padlock.db');

let db = null;
let initPromise = null;

// 获取数据库实例（确保只初始化一次）
async function getDb() {
  if (db) return db;

  if (!initPromise) {
    initPromise = (async () => {
      db = await createDatabase(DB_PATH);

      // 启用 WAL 模式（sql.js 在内存中运行，持久化后生效）
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');

      // 创建订单表
      db.exec(`
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_no TEXT NOT NULL UNIQUE,
          customer_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT DEFAULT '',
          country TEXT NOT NULL,
          city TEXT NOT NULL,
          address TEXT NOT NULL,
          notes TEXT DEFAULT '',
          product_model TEXT NOT NULL,
          product_price REAL NOT NULL,
          quantity INTEGER NOT NULL,
          total_amount REAL NOT NULL,
          paypal_txn_id TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
      `);

      // 为常用查询字段建索引
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_orders_order_no ON orders(order_no);
        CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
      `);

      console.log('[DB] 数据库初始化完成:', DB_PATH);
      return db;
    })();
  }

  return initPromise;
}

module.exports = { getDb };
