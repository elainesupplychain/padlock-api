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


// ============================================================
// GET /admin — 管理后台页面
// ============================================================
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PadLock Admin Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f9fa;color:#333;line-height:1.6;min-height:100vh}
/* 顶部导航 */
.navbar{background:#fff;border-bottom:1px solid #e9ecef;padding:0 24px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
.navbar .brand{font-size:1.25rem;font-weight:800;color:#1a1a2e}
.navbar .brand span{color:#00d4aa}
.navbar .refresh-info{font-size:.78rem;color:#999}
.container{max-width:1280px;margin:0 auto;padding:24px 20px}
/* 页面标题 */
.page-title{font-size:1.4rem;font-weight:700;color:#1a1a2e;margin-bottom:20px}
/* 统计卡片 */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#fff;border-radius:10px;padding:20px 24px;box-shadow:0 1px 6px rgba(0,0,0,.05);display:flex;align-items:center;gap:16px}
.stat-icon{width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0}
.stat-icon.orders{background:#e0f7f0;color:#00d4aa}
.stat-icon.revenue{background:#fff0e8;color:#ff6b35}
.stat-info .stat-label{font-size:.78rem;color:#888;text-transform:uppercase;letter-spacing:.5px}
.stat-info .stat-value{font-size:1.5rem;font-weight:700;color:#1a1a2e;line-height:1.2}
/* 刷新按钮 */
.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px}
.btn-refresh{padding:9px 22px;background:linear-gradient(135deg,#ff6b35,#f97316);color:#fff;border:none;border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer;transition:opacity .2s;display:inline-flex;align-items:center;gap:6px}
.btn-refresh:hover{opacity:.9}
.btn-refresh:disabled{opacity:.5;cursor:not-allowed}
/* Loading */
.loading{display:none;text-align:center;padding:48px 0}
.loading.show{display:block}
.spinner{width:32px;height:32px;border:3px solid #e0e0e0;border-top-color:#ff6b35;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 12px}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-text{font-size:.88rem;color:#999}
/* 错误提示 */
.error-banner{display:none;background:#fff0f0;color:#d32f2f;padding:14px 18px;border-radius:8px;font-size:.88rem;margin-bottom:16px;border-left:4px solid #d32f2f}
.error-banner.show{display:block}
.error-banner .retry-link{color:#ff6b35;cursor:pointer;font-weight:600;margin-left:8px;text-decoration:underline}
/* 表格容器 */
.table-wrap{background:#fff;border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.05);overflow:hidden}
.table-scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:900px}
thead{background:#fafbfc}
th{padding:12px 16px;text-align:left;font-size:.78rem;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e9ecef;white-space:nowrap}
td{padding:12px 16px;font-size:.88rem;border-bottom:1px solid #f0f0f0;white-space:nowrap}
tbody tr:nth-child(even){background:#fafbfc}
tbody tr:hover{background:#f0f7ff}
/* 状态标签 */
.status-badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:.72rem;font-weight:700;text-transform:uppercase}
.st-pending{background:#fff3e0;color:#e65100}
.st-completed{background:#e8f5e9;color:#2e7d32}
.st-cancelled{background:#fce4ec;color:#c62828}
/* 空状态 */
.empty-state{display:none;text-align:center;padding:48px 0;color:#999}
.empty-state.show{display:block}
.empty-state .empty-icon{font-size:2.5rem;margin-bottom:8px}
/* 页脚 */
.footer{text-align:center;padding:20px;font-size:.75rem;color:#bbb;margin-top:8px}
.footer .dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;animation:pulse 2s infinite}
.dot.live{background:#00d4aa}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
/* 响应式 */
@media(max-width:768px){
  .navbar{padding:0 16px}
  .container{padding:16px 12px}
  .stats{grid-template-columns:1fr 1fr;gap:10px}
  .stat-card{padding:14px 16px}
  .stat-value{font-size:1.2rem}
  th,td{padding:10px 12px;font-size:.8rem}
}
@media(max-width:480px){
  .stats{grid-template-columns:1fr}
}
</style>
</head>
<body>

<!-- 顶部导航 -->
<nav class="navbar">
  <div class="brand">Pad<span>Lock</span></div>
  <div class="refresh-info" id="refreshInfo">Auto-refresh: 30s</div>
</nav>

<div class="container">

  <h1 class="page-title">Admin Dashboard</h1>

  <!-- 统计卡片 -->
  <div class="stats">
    <div class="stat-card">
      <div class="stat-icon orders">&#128230;</div>
      <div class="stat-info">
        <div class="stat-label">Total Orders</div>
        <div class="stat-value" id="statOrders">-</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon revenue">&#36;</div>
      <div class="stat-info">
        <div class="stat-label">Total Revenue</div>
        <div class="stat-value" id="statRevenue">-</div>
      </div>
    </div>
  </div>

  <!-- 工具栏 -->
  <div class="toolbar">
    <button class="btn-refresh" id="refreshBtn" onclick="fetchOrders()">
      &#8635; Refresh Now
    </button>
  </div>

  <!-- 加载状态 -->
  <div class="loading" id="loading">
    <div class="spinner"></div>
    <div class="loading-text">Loading orders...</div>
  </div>

  <!-- 错误提示 -->
  <div class="error-banner" id="errorBanner">
    <span id="errorText"></span>
    <span class="retry-link" onclick="fetchOrders()">Retry</span>
  </div>

  <!-- 订单表格 -->
  <div class="table-wrap" id="tableWrap" style="display:none">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Email</th>
            <th>Product</th>
            <th>Quantity</th>
            <th>Unit Price</th>
            <th>Total</th>
            <th>Status</th>
            <th>Created At</th>
          </tr>
        </thead>
        <tbody id="tableBody"></tbody>
      </table>
    </div>
    <!-- 空状态 -->
    <div class="empty-state" id="emptyState">
      <div class="empty-icon">&#128203;</div>
      <div>No orders yet</div>
    </div>
  </div>

</div>

<div class="footer">
  <span class="dot live"></span> PadLock Admin &copy; 2026
</div>

<script>
// ============ API 配置 ============
var API_URL = 'https://padlock-api-production.up.railway.app/api/orders/admin';
var REFRESH_INTERVAL = 30000; // 30 秒
var refreshTimer = null;

// ============ 页面加载时自动获取 ============
fetchOrders();

// ============ 获取订单数据 ============
function fetchOrders() {
  var loading = document.getElementById('loading');
  var tableWrap = document.getElementById('tableWrap');
  var errorBanner = document.getElementById('errorBanner');
  var refreshBtn = document.getElementById('refreshBtn');

  // 显示加载状态
  loading.classList.add('show');
  tableWrap.style.display = 'none';
  errorBanner.classList.remove('show');
  refreshBtn.disabled = true;

  fetch(API_URL)
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText);
      return res.json();
    })
    .then(function(data) {
      loading.classList.remove('show');
      refreshBtn.disabled = false;

      if (!data.success) {
        showError(data.error || 'Unknown error');
        return;
      }

      renderDashboard(data);
      scheduleRefresh();
    })
    .catch(function(err) {
      loading.classList.remove('show');
      refreshBtn.disabled = false;
      showError('Failed to load orders. ' + err.message);
      scheduleRefresh(); // 继续定时重试
    });
}

// ============ 渲染仪表盘 ============
function renderDashboard(data) {
  var orders = data.orders || [];
  var tableWrap = document.getElementById('tableWrap');
  var tableBody = document.getElementById('tableBody');
  var emptyState = document.getElementById('emptyState');

  tableWrap.style.display = 'block';

  // 统计
  var totalRevenue = orders.reduce(function(sum, o) {
    return sum + (parseFloat(o.total_amount) || 0);
  }, 0);

  document.getElementById('statOrders').textContent = orders.length;
  document.getElementById('statRevenue').textContent = '\$' + totalRevenue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  // 空状态
  if (orders.length === 0) {
    tableBody.innerHTML = '';
    emptyState.classList.add('show');
    return;
  }
  emptyState.classList.remove('show');

  // 渲染表格行
  tableBody.innerHTML = orders.map(function(order) {
    var statusClass = 'st-' + order.status;
    var statusLabel = order.status.charAt(0).toUpperCase() + order.status.slice(1);
    return '<tr>' +
      '<td><strong>' + esc(order.order_no) + '</strong></td>' +
      '<td>' + esc(order.email) + '</td>' +
      '<td>' + esc(order.product_model) + '</td>' +
      '<td>' + order.quantity + '</td>' +
      '<td>\$' + parseFloat(order.product_price).toFixed(2) + '</td>' +
      '<td><strong>\$' + parseFloat(order.total_amount).toFixed(2) + '</strong></td>' +
      '<td><span class="status-badge ' + statusClass + '">' + esc(statusLabel) + '</span></td>' +
      '<td>' + esc(order.created_at) + '</td>' +
      '</tr>';
  }).join('');
}

// ============ 错误显示 ============
function showError(msg) {
  var banner = document.getElementById('errorBanner');
  document.getElementById('errorText').textContent = msg;
  banner.classList.add('show');
}

// ============ 定时刷新 ============
function scheduleRefresh() {
  // 清除旧定时器
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(function() {
    fetch(API_URL)
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) {
          renderDashboard(data);
          document.getElementById('errorBanner').classList.remove('show');
          blinkDot();
        }
      })
      .catch(function() { /* 静默失败，等待下次刷新 */ });
  }, REFRESH_INTERVAL);
}

// ============ 刷新指示器闪烁 ============
function blinkDot() {
  var dot = document.querySelector('.dot');
  dot.style.transform = 'scale(1.5)';
  setTimeout(function() { dot.style.transform = 'scale(1)'; }, 300);
}

// ============ HTML 转义（XSS 防护） ============
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ 页面卸载时清除定时器 ============
window.addEventListener('beforeunload', function() {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

</body>
</html>
`);
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
