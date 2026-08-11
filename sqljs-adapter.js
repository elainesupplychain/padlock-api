// sql.js 适配层 - 模拟 better-sqlite3 API
// 使现有 server.js 无需修改即可切换为 sql.js（纯 JavaScript，无需编译）

const initSqlJs = require('sql.js');
const fs = require('fs');

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this._db = null;
    this._ready = false;
    this._changes = 0;
    this._lastInsertRowid = 0;
  }

  // 异步初始化（加载 WASM + 读取/创建数据库文件）
  async ready() {
    const SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this._db = new SQL.Database(buffer);
    } else {
      this._db = new SQL.Database();
    }
    this._ready = true;
    this._persist();
  }

  // 持久化到磁盘
  _persist() {
    if (!this._db) return;
    const data = this._db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  // 执行原始 SQL（用于建表等 DDL）
  exec(sql) {
    this._ensureReady();
    this._db.exec(sql);
    this._persist();
  }

  // 模拟 better-sqlite3 的 pragma
  pragma(pragmaStr) {
    this._ensureReady();
    const parts = pragmaStr.split('=');
    const key = parts[0].trim();
    if (parts.length > 1) {
      const value = parts[1].trim();
      this._db.run(`PRAGMA ${key} = ${value}`);
    }
    this._persist();
  }

  // 创建预编译语句
  prepare(sql) {
    this._ensureReady();
    return new Statement(this, sql);
  }

  _ensureReady() {
    if (!this._ready) {
      throw new Error('Database not ready. Call await db.ready() first.');
    }
  }

  // 关闭数据库
  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}

class Statement {
  constructor(database, sql) {
    this._database = database;
    this._sql = sql;
  }

  // 执行查询，返回所有行
  all(...params) {
    const stmt = this._database._db.prepare(this._sql);
    if (params.length > 0) stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  // 执行查询，返回第一行
  get(...params) {
    const stmt = this._database._db.prepare(this._sql);
    if (params.length > 0) stmt.bind(params);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result || undefined;
  }

  // 执行写操作，返回 { changes, lastInsertRowid }
  run(...params) {
    const db = this._database._db;
    db.run(this._sql, params);
    const changes = db.getRowsModified();
    // 获取 last_insert_rowid
    let lastInsertRowid = 0;
    const rowStmt = db.prepare('SELECT last_insert_rowid() as id');
    if (rowStmt.step()) {
      lastInsertRowid = rowStmt.getAsObject().id;
    }
    rowStmt.free();
    this._database._persist();
    return { changes, lastInsertRowid };
  }
}

// 创建数据库实例并自动初始化，返回 Promise<Database>
async function createDatabase(dbPath) {
  const db = new Database(dbPath);
  await db.ready();
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'then') return undefined; // 防止被当作 Promise
      if (typeof target[prop] === 'function') {
        return function (...args) {
          if (!target._ready) {
            throw new Error(
              'Database not initialized. Please await db.ready() before use.\n' +
              'Usage: const db = await createDatabase(path);'
            );
          }
          return target[prop].apply(target, args);
        };
      }
      return target[prop];
    }
  });
}

module.exports = { Database, createDatabase };
