// PadLock 订单管理后端 - Express 应用入口 (v2)
// 提供订单创建、免密查询、管理接口

const express = require('express');
const cors = require('cors');
const { getDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- 中间件 ----
app.use(cors());                    // 允许跨域（前端页面可能独立部署）
app.use(express.json());            // 解析 JSON 请求体
app.use(express.static(__dirname)); // 托管静态文件（order-track.html 等）

// ---- 工具函数 ----
// 生成唯一订单号：PL-年月日-4位序号随机码
function generateOrderNo() {
  const now = new Date();
  const dateStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const random = Math.floor(1000 + Math.random() * 9000); // 1000-9999
  return `PL-${dateStr}-${random}`;
}

// ============================================================
// GET /api/health — 健康检查（Railway 部署探测用）
// ============================================================
app.get('/api/health', async (req, res) => {
  try {
    const db = await getDb();
    const count = db.prepare('SELECT COUNT(*) as cnt FROM orders').get();
    res.json({ status: 'ok', db: 'connected', orders_count: count.cnt });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

// ============================================================
// POST /api/orders — 创建订单
// ============================================================
app.post('/api/orders', async (req, res) => {
  try {
    const {
      customer_name, email, phone, country, city, address, notes,
      product_model, product_price, quantity, total_amount, paypal_txn_id
    } = req.body;

    // 必填校验
    if (!customer_name || !email || !country || !city || !address) {
      return res.status(400).json({ error: '缺少必填字段：customer_name, email, country, city, address' });
    }
    if (!product_model || product_price == null || !quantity || total_amount == null) {
      return res.status(400).json({ error: '缺少商品信息：product_model, product_price, quantity, total_amount' });
    }

    const db = await getDb();
    const orderNo = generateOrderNo();

    const stmt = db.prepare(`
      INSERT INTO orders (order_no, customer_name, email, phone, country, city, address, notes,
        product_model, product_price, quantity, total_amount, paypal_txn_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    const result = stmt.run(
      orderNo, customer_name, email, phone || '', country, city, address, notes || '',
      product_model, product_price, quantity, total_amount, paypal_txn_id || ''
    );

    // 返回完整订单
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);

    console.log('[订单创建]', orderNo, '|', customer_name, '|', product_model);
    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error('[订单创建失败]', err.message);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ============================================================
// POST /api/orders/lookup — 免密查询（邮箱 或 订单号任一匹配）
// ============================================================
app.post('/api/orders/lookup', async (req, res) => {
  try {
    const { email, order_id } = req.body;

    // 至少提供一个查询条件
    if (!email && !order_id) {
      return res.status(400).json({ error: '请提供 email 或 order_id 至少一项' });
    }

    const db = await getDb();
    let orders = [];

    if (email && order_id) {
      // 两者都提供：必须同时匹配
      orders = db.prepare(
        'SELECT * FROM orders WHERE email = ? AND order_no = ? ORDER BY created_at DESC'
      ).all(email.trim(), order_id.trim());
    } else if (email) {
      // 仅邮箱
      orders = db.prepare(
        'SELECT * FROM orders WHERE email = ? ORDER BY created_at DESC'
      ).all(email.trim());
    } else {
      // 仅订单号
      orders = db.prepare(
        'SELECT * FROM orders WHERE order_no = ? ORDER BY created_at DESC'
      ).all(order_id.trim());
    }

    if (orders.length === 0) {
      return res.status(404).json({ error: '未找到匹配的订单，请检查邮箱或订单号' });
    }

    res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    console.error('[订单查询失败]', err.message);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ============================================================
// GET /api/orders/:orderId — 按订单号查询单个订单
// ============================================================
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const db = await getDb();
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderId);

    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }

    res.json({ success: true, order });
  } catch (err) {
    console.error('[单订单查询失败]', err.message);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ============================================================
// GET /api/orders/admin — 管理员查看所有订单
// ============================================================
app.get('/api/orders/admin', async (req, res) => {
  try {
    const db = await getDb();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const total = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const orders = db.prepare(
      'SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);

    res.json({
      success: true,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      orders
    });
  } catch (err) {
    console.error('[管理查询失败]', err.message);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---- 启动服务器 ----
async function start() {
  // 初始化数据库
  await getDb();

  app.listen(PORT, () => {
    console.log(`[服务器] PadLock Order Server 运行在 http://localhost:${PORT}`);
    console.log(`[接口] POST /api/orders          - 创建订单`);
    console.log(`[接口] POST /api/orders/lookup   - 免密查询订单`);
    console.log(`[接口] GET  /api/orders/:orderId - 按订单号查询`);
    console.log(`[接口] GET  /api/orders/admin    - 管理后台订单列表`);
  });
}

start().catch(err => {
  console.error('[启动失败]', err);
  process.exit(1);
});
