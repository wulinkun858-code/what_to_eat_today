# 云开发 → 自建后端迁移技术方案

> 目标读者：接手本项目的开发者。本文假设你已了解小程序基础（`wx.request` / `wx.login`）与 Docker 基本用法。
> 结论先行：**推荐 Node.js(Express) + MongoDB + 对象存储 + Docker Compose 单机部署**，业务逻辑约 80% 可直接复用，总工作量约 12~15 人日；先读 §1 盘点和 §9 路线图。

---

## 1. 现状盘点：项目到底用了云开发的什么

迁移前先划清边界。下表是对代码的全量盘点结果（`grep wx.cloud` / 逐文件审阅 `utils/services/` 得出）：

| # | 云开发能力 | 代码位置 | 具体用法 | 自建后端替代 |
|---|---|---|---|---|
| 1 | 云函数调用 | `utils/biz.js` | 全站唯一写入口，`{ action, payload }` 共 **20 个 action**（§4.3 清单） | HTTP API（`POST /biz/:action` 直通或 REST 化） |
| 2 | 数据库客户端直查 | `utils/collection.js` + `utils/services/*.js` | 8 个集合的读：dishes / comments / banners / categories / orders / messages / cooklist（§5.2 清单） | 服务端只读接口 |
| 3 | 数据库客户端直写 | `utils/services/comments.js:27`、`utils/services/banners.js:18` | `comments.add`（发评论）、`banners.add`（批量建轮播） | 收口到服务端接口（重要，见 §5.3） |
| 4 | 查询端身份替换 | `utils/services/*.js` | `where({ _openid: '{openid}' })` 魔法值，由云开发按当前登录用户替换 | 服务端从 JWT 取 openid 自行过滤（§3） |
| 5 | 文件存储 | `utils/services/storage.js` | `wx.cloud.uploadFile` / `wx.cloud.deleteFile`；`cloud://` fileID 直接入库、`<image>` 原生渲染 | 对象存储 + 预签名直传，库里改存 https URL（§6） |
| 6 | 服务端身份 | `cloudfunctions/biz/lib/router.js:6` | `cloud.getWXContext().OPENID` 自动可信 | `wx.login` → `code2Session` → JWT（§3） |
| 7 | 数据库事务 | `orders.js` / `profile.js` / `kitchen.js` | `db.runTransaction`（下单+消息原子写、状态流转、建档） | MongoDB 副本集多文档事务，代码结构不变（§7.4） |
| 8 | 服务端时间 | `utils/services/comments.js:33` | 客户端 `database().serverDate()` | 服务端 `new Date()` |

**好消息——以下云开发能力本项目没有用到**，迁移面比想象小：

- 数据库实时推送（`watch`）：厨房/消息页均为 `onShow` 拉取，无长连接依赖；
- `getTempFileURL` 临时链接：图片全部以 fileID 形式交给 `<image>` 渲染；
- 定时触发器、云调用（订阅消息/客服）、CMS、云托管。

**架构红利**：云函数侧 `services/*.js` 是"纯函数 + `context` 依赖注入"的写法（见 `cloudfunctions/biz/index.js` 的装配方式），不依赖 `wx-server-sdk` 之外任何云 API。自建后端只需实现一个新的 `context`（MongoDB 驱动版），业务逻辑可整体搬运——这是当初按业务域拆分换来的最大回报。

---

## 2. 目标架构与技术选型

```
┌──────────┐  HTTPS(备案域名)   ┌─────────────────────────────┐
│ 微信小程序 │ ───────────────▶ │ Caddy/Nginx (TLS 终止)       │
└──────────┘                   │   ├─ Node/Express API        │
      │  预签名直传             │   │    ├─ MongoDB (副本集)     │
      └───────────────────────▶│   │    └─ S3 SDK ──┐         │
                               │   └─ MinIO/COS/OSS ◀┘        │
                               └─────────────────────────────┘
```

| 层 | 选型 | 理由 | 备选 |
|---|---|---|---|
| 语言/框架 | Node.js 18+，Express（或 Fastify） | 与现有小程序/云函数同为 JS；云函数 `lib/router.js` 的 action 分发模式可 1:1 映射成 Express 路由，`services/*.js` 直接复用 | NestJS（结构更大，团队大了再上） |
| 数据库 | **MongoDB 6+（副本集）** | 8 个集合文档模型 1:1 平移，零表结构改造；`searchTokens`、`statusHistory`、`items` 等数组/嵌套字段原样保留；副本集支持多文档事务 | PostgreSQL + JSONB（约束更强但要重写全部查询与事务，见 §7.5） |
| 文件存储 | 腾讯云 COS 或阿里云 OSS | 免运维、自带 CDN、预签名直传成熟；本项目图片量小，费用可忽略 | 纯自建 MinIO（注意自己兜底备份） |
| 部署 | 1 台 2C4G VPS + Docker Compose | 当前量级单机足够；`docker compose up -d` 即完整环境 | k8s 等过重，不推荐 |
| 反代/TLS | Caddy | 自动签发续期 HTTPS 证书，配置两行 | Nginx + certbot |

**合规硬门槛（务必最先启动）**：小程序 `request`/`uploadFile` 合法域名要求 **HTTPS + 已 ICP 备案域名**。国内服务器备案周期约 2~4 周；选香港/海外服务器可免备案，但延迟与稳定性略差。这是整个迁移里时间最长的前置项。

---

## 3. 身份认证改造（与云开发差异最大的一块）

### 3.1 现状 vs 目标

现状：云函数里 `cloud.getWXContext().OPENID` 由平台自动注入，客户端**没有登录态概念**。
目标：标准微信登录换 JWT：

```
小程序                     自建后端                      微信服务器
  │ wx.login() 得 code       │                             │
  │ ── POST /auth/login ───▶ │ ── code2Session ──────────▶ │
  │                          │ ◀── openid + session_key ── │
  │                          │ upsert profile 表            │
  │ ◀── { token } ────────── │ 签发 JWT(sub=openid)         │
  │ 之后每个请求带             │                             │
  │ Authorization: Bearer …  │                             │
```

### 3.2 服务端实现（Express）

```js
// server/src/auth.js
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { ensureProfileTx } = require('./services/profile') // 从云函数平移

async function login(req, res, next) {
  try {
    const { code } = req.body
    if (!code || typeof code !== 'string') return res.status(400).json({ ok: false, message: '缺少登录凭证' })
    const url = 'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${process.env.WECHAT_APPID}&secret=${process.env.WECHAT_SECRET}` +
      `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
    const session = await fetch(url).then((r) => r.json())
    if (!session.openid) return res.status(401).json({ ok: false, message: '微信登录失败' })
    const profile = await ensureProfileTx(session.openid) // 建档/刷新 lastActiveAt，逻辑同云函数
    const token = jwt.sign({ sub: session.openid }, process.env.JWT_SECRET, { expiresIn: '7d' })
    res.json({ ok: true, data: { token, profile } })
  } catch (e) { next(e) }
}

// 鉴权中间件：替代 getWXContext()
function authRequired(req, res, next) {
  const header = req.get('Authorization') || ''
  try {
    const payload = jwt.verify(header.replace(/^Bearer\s+/i, ''), process.env.JWT_SECRET)
    req.openid = payload.sub           // 下游一律用 req.openid，等价于原来的 getWXContext().OPENID
    next()
  } catch { res.status(401).json({ ok: false, message: '请重新登录' }) }
}
```

要点：

- **`session_key` 绝不下发**给客户端，`code` 一次性使用；
- **role 不写进 JWT**（每次查库或进程内缓存 30s），保证管理员改角色后即时生效——与现有云函数"每次 `requireRole` 查库"语义一致；
- token 过期策略从简：7 天过期 + 401 时静默重登（小程序端无感，见下）。

### 3.3 小程序端：改 `utils/biz.js`，其余不动

```js
// utils/biz.js（自建后端版）
const { reportError } = require('./errors')

let loginPromise = null

function rawCall(action, payload) {
  const token = wx.getStorageSync('token') || ''
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${require('./config').apiBase}/biz/${action}`, // 见 config 开关（§9 阶段0）
      method: 'POST',
      header: { Authorization: token ? `Bearer ${token}` : '' },
      data: payload || {},
      success: (res) => (res.statusCode === 401 ? reject(Object.assign(new Error('未登录'), { relogin: true })) : resolve(res)),
      fail: reject
    })
  })
}

function ensureLogin() { // app.js onLaunch 时预登录；401 时再调，自动重试一次
  if (loginPromise) return loginPromise
  loginPromise = new Promise((resolve, reject) => {
    wx.login({
      success: ({ code }) => wx.request({
        url: `${require('./config').apiBase}/auth/login`, method: 'POST',
        data: { code },
        success: (res) => {
          const r = res.data || {}
          if (!r.ok) return reject(new Error(r.message || '登录失败'))
          wx.setStorageSync('token', r.data.token)
          resolve(r.data)
        },
        fail: reject
      }),
      fail: reject
    })
  }).catch((e) => { loginPromise = null; throw e })
  return loginPromise
}

function call(action, payload = {}) {
  return rawCall(action, payload)
    .catch((err) => err && err.relogin ? ensureLogin().then(() => rawCall(action, payload)) : Promise.reject(err))
    .then((res) => {
      const result = res.data || {}
      if (result.ok) return result.data
      const error = new Error(result.message || '操作失败')
      error.biz = true
      throw error
    })
    .catch((err) => {
      const message = err && err.biz ? err.message : '服务暂不可用，请稍后重试'
      return reportError(err, message)
    })
}

module.exports = { call, ensureLogin }
```

`utils/role.js`、所有页面的调用方式**完全不变**——这就是当初把云调用收敛到 `biz.js` 一个文件的好处。

---

## 4. API 层迁移

### 4.1 策略：两步走

- **第一步（必做）：动作直通。** `POST /biz/:action`，body 即 payload，响应保持 `{ ok, data | message }`。服务端路由几乎照搬云函数版：

```js
// server/src/routes/biz.js —— 对比 cloudfunctions/biz/lib/router.js，只改了两处（标 ★）
router.post('/biz/:action', authRequired, async (req, res, next) => {
  try {
    const handlers = services
    const openid = req.openid                                  // ★ 原 cloud.getWXContext().OPENID
    const action = req.params.action
    if (!Object.prototype.hasOwnProperty.call(handlers, action)) fail('未知操作')
    const data = await handlers[action](req.body || {}, openid)
    res.json({ ok: true, data })
  } catch (error) {
    if (!(error instanceof BusinessError)) console.error('[biz]', req.params.action, error)
    res.status(error instanceof BusinessError ? 400 : 500)     // ★ HTTP 语义化
       .json({ ok: false, message: error instanceof BusinessError ? error.message : '服务异常，请稍后重试' })
  }
})
```

- **第二步（可选、渐进）**：按 §4.3 映射表 RESTful 化。不必一次做完，直通形态已可上线。

### 4.2 服务端 context 的 MongoDB 实现

业务代码（`services/*.js`）期待的接口见 `cloudfunctions/biz/lib/context.js`：`db, read, readTx, getRole, requireRole, deleteFiles, removeMatching`。自建版用 `mongodb` 驱动实现同名接口即可：

```js
// server/src/context.js（骨架：read/readTx 的等价实现）
const { MongoClient } = require('mongodb')
const client = new MongoClient(process.env.MONGO_URL)

async function read(name, key) {
  const row = await client.db().collection(name).findOne({ _id: id(key) })
  return row || null
}
// readTx(tx, name, key)：云开发事务里 doc.get 缺失返回 null 的行为，
// MongoDB 对应为 session 事务里 findOne(...) ?? null —— 语义一致，注意保持。
// runTransaction 对应 client.withSession(s => s.withTransaction(fn))，事务必须跑在副本集上。
```

`db.collection(...).where(...).get()` 这类链式调用只出现在客户端代码里（§5 处理），云函数侧用的 API 面很小，逐一等价替换即可。

### 4.3 全部 20 个 action 清单与建议 REST 映射

| 域 | action | 权限（云函数现值） | 建议 REST |
|---|---|---|---|
| profile | `ensureProfile` | 任意登录用户 | `GET /me`（登录接口已覆盖，可删） |
| profile | `setProfile` | 本人 | `PATCH /me` |
| dishes | `dishSave` | chef/admin | `POST /dishes` / `PUT /dishes/:id` |
| dishes | `dishDelete` | chef 本人/admin | `DELETE /dishes/:id` |
| orders | `orderCreate` | diner 起 | `POST /orders` |
| orders | `orderCancel` | 本人 pending/admin | `POST /orders/:id/cancel` |
| orders | `orderStatus` | admin | `PATCH /orders/:id/status` |
| kitchen | `cooklistAdd` / `cooklistDone` / `cooklistRemove` | chef 相关 | `POST /cooklist` / `POST /cooklist/:id/done` / `DELETE /cooklist/:id` |
| content | `commentRemove` | 本人/admin | `DELETE /comments/:id` |
| content | `bannerRemove` / `bannerClear` | admin | `DELETE /banners/:id` / `DELETE /banners` |
| content | `messageRead` | 本人 | `POST /messages/:id/read` |
| categories | `categoryAdd` / `categoryUpdate` / `categoryDelete` | admin | `POST/PATCH/DELETE /categories...` |
| admin | `userList` | admin | `GET /admin/users` |
| admin | `roleSet` | admin（禁改自己） | `PUT /admin/users/:openid/role` |
| admin | `adminOrders` | admin | `GET /admin/orders` |

> `commentRemove` 等同时校验"本人或 admin"的语义、`roleSet` 禁止改自己角色等规则，全部在 `services/*.js` 里，平移时**不要重写**，直接复用原文件。

---

## 5. 客户端直连数据库 → 服务端接口（工作量最大的一块）

### 5.1 原则

- 所有 `utils/collection.js` 的调用（`wx.cloud.database()`）**整体下线**，`utils/services/*.js` 每个函数改为 `api.get/post(...)`；
- **身份一律来自 JWT**：删除所有 `{ openid: '{openid}' }` 魔法值。云开发里这个写法靠数据库安全规则"仅创建者可读写"自动替换为当前用户；自建后端后由服务端 `where({ _openid: req.openid })` 显式实现——**每个集合都要核对到**，漏一个就是越权漏洞；
- 响应统一 `{ list, total, page? }`，与现有 `queryPage()` 返回结构一致，页面层零改动。

### 5.2 需要新建的只读接口（按集合逐一对照现有查询）

| 集合 | 现有查询（代码位置） | 新接口 | 服务端要点 |
|---|---|---|---|
| dishes | `searchTokens` 等值 AND + `categoryId` + `updatedAt desc` 分页（`utils/services/dishes.js:11`） | `GET /dishes?keyword=&category=&page=` | 分词逻辑移到服务端（`lib/tokenizer.js` 云函数侧本就有一份同源实现）；MongoDB 查询 `$and: tokens.map(t => ({ searchTokens: t }))` 与现在等价 |
| dishes | `where({_id}).limit(1)` 详情（`dishes.js:29`） | `GET /dishes/:id` | |
| comments | `dishId` + 本人 + `createdAt desc`（`comments.js:6`） | `GET /dishes/:id/comments` | |
| comments | 本人最近（`comments.js:35`） | `GET /me/comments?page=` | |
| banners | 全量列表 | `GET /banners` | 公开读 |
| categories | 全量列表 | `GET /categories` | 公开读 |
| orders | 本人 + `createdAt desc` 分页（`orders.js:6`） | `GET /me/orders?page=` | `_openid` 来自 JWT |
| messages | 本人最近 50 / 未读数（`orders.js:17,29`） | `GET /me/messages` / `GET /me/messages/unread-count` | 未读数接口给 tabBar 角标用，注意轻量 |
| cooklist | 本人制作列表（`orders.js:36`） | `GET /me/cooklist` | |

分页语义：统一 `page`（默认 1）+ `pageSize`（沿用 20，上限 50，同 `lib/context.js` 的 `pageOptions` 校验）。

### 5.3 客户端直写收口（两处，必须迁到服务端）

| 现状 | 位置 | 迁移后 |
|---|---|---|
| `collection('comments').add({ dishId, dishName, content, createdAt: serverDate() })` | `utils/services/comments.js:27` | `POST /dishes/:id/comments`，服务端补 `_openid`（JWT）、`createdAt: new Date()`，长度校验沿用现有 200 字上限 |
| `collection('banners').add(...)` 批量 | `utils/services/banners.js:18` | `POST /banners`（admin，服务端循环写） |

云开发时代这两处能直写是因为数据库安全规则挡住了越权；自建后端后**客户端一律无数据库地址**，不存在"规则"这一层，所有写必须走服务端校验。

### 5.4 改造示例（改造前后对比）

```js
// 改造前（utils/services/orders.js）
function getMyOrders(page) {
  const where = { _openid: '{openid}' }
  return queryPage(collection('orders').where(where).orderBy('createdAt', 'desc'), page, { items: true, status: true, createdAt: true })
}

// 改造后：身份隐含在 JWT里，客户端不再拼任何归属条件
function getMyOrders(page) {
  return api.get('/me/orders', { page }).catch((err) => reportError(err, '订单加载失败'))
}
```

---

## 6. 文件存储迁移

### 6.1 差异

现状链路：`wx.cloud.uploadFile(cloudPath)` → 得到 `cloud://` fileID → **fileID 直接入库**（`dishes.image` / `profile.avatarFileID` / `banners.image`）→ `<image src="{{...}}">` 原生识别 `cloud://` → 删除走 `cloud.deleteFile`（服务端 `context.deleteFiles` + 客户端 `deleteCloudFile` 兜底）。

目标链路：**预签名直传 + 库里存完整 https URL**。`<image>` 对 https 地址天然支持，组件层零改动。

### 6.2 上传：预签名直传（推荐）

```
小程序 ── POST /uploads/presign {folder} ──▶ 后端校验角色 → 用 S3 SDK 生成 PUT 预签名
      ◀── { uploadUrl, publicUrl } ──
      ── wx.uploadFile(url=uploadUrl) ──▶ COS/OSS/MinIO
      之后 publicUrl 作为 image 字段随 dishSave/bannerSave 入库
```

服务端（以 COS 为例，MinIO/OSS 同理走 S3 兼容 API）：

```js
router.post('/uploads/presign', authRequired, requireRoleIn(['chef', 'admin']), (req, res) => {
  const folder = ['dishes', 'avatars', 'banners'].includes(req.body.folder) ? req.body.folder : 'misc'
  const ext = ... // 同 utils/services/storage.js 的扩展名逻辑
  const key = `${folder}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`
  const uploadUrl = cos.getObjectUrl({ Bucket, Region, Key: key, Method: 'PUT', Sign: true, Expires: 600 }).Url
  res.json({ ok: true, data: { uploadUrl, publicUrl: `${process.env.CDN_BASE}/${key}` } })
})
```

备选：后端中转上传（`wx.uploadFile` → 后端 → 转存对象存储）。实现简单但双倍带宽、大图慢，图片量小也可以接受。

### 6.3 删除

服务端 `context.deleteFiles` 改为对象存储 SDK 的 `deleteObjects`（注意 COS 删除上限与现有 50 个一批的分组逻辑对齐）；客户端 `utils/services/storage.js` 的 `deleteCloudFile` 兜底调用可整体删除（存量云函数侧已保证业务删除时同步清理文件）。

### 6.4 存量 `cloud://` fileID 迁移

一次性脚本（放 `server/scripts/migrate-files.js`）：

1. 用 `@cloudbase/node-sdk` 分页遍历 `dishes` / `profile` / `banners`；
2. 收集所有 `cloud://` fileID → 批量 `getTempFileURL`（临时链接，注意分批与时效，下载前失效就重新取）；
3. 下载文件 → 按原 `cloudPath` 目录结构上传到新存储；
4. 回写数据库字段为最终 https URL（先写新字段验证、再覆盖原字段，脚本支持断点重跑：已迁移的按 URL 前缀跳过）。

---

## 7. 数据库数据迁移

### 7.1 导出

项目量级小（个人应用），推荐**自写迁移脚本**而不是控制台手工导出，可控且可重跑：

```js
// server/scripts/migrate-data.js（骨架）
const CloudBase = require('@cloudbase/node-sdk')
const { MongoClient } = require('mongodb')
const app = CloudBase.init({ env: 'cloud1-d1gs4xp8j13bad753', secretId, secretKey }) // 管理密钥从环境变量注入
const collections = ['profile', 'dishes', 'categories', 'banners', 'orders', 'messages', 'cooklist', 'comments']

for (const name of collections) {
  let offset = 0
  for (;;) {
    const { data } = await app.database().collection(name).skip(offset).limit(100).get() // MAX_LIMIT 同客户端
    if (!data.length) break
    await mongo.collection(name).insertMany(data, { ordered: false })                    // _id 保留原值，天然幂等重跑(重复键忽略)
    offset += data.length
  }
}
```

> 环境密钥在 [CloudBase 控制台-权限管理] 创建，只给数据库读权限即可，用完销毁。

### 7.2 集合映射与索引

选 MongoDB 则 8 个集合**名称、文档结构、`_id` 全部原样保留**，包括 `_openid` 字段（继续当"归属者"列用）。按现有查询建索引：

```
db.orders.createIndex({ _openid: 1, createdAt: -1 })
db.orders.createIndex({ status: 1, createdAt: -1 })        // adminOrders 过滤
db.messages.createIndex({ _openid: 1, createdAt: -1 })
db.messages.createIndex({ orderId: 1 })                     // order-state.messageIds
db.dishes.createIndex({ searchTokens: 1 })                  // 等值 AND 查询
db.dishes.createIndex({ categoryId: 1, updatedAt: -1 })
db.cooklist.createIndex({ _openid: 1, createdAt: -1 })
db.comments.createIndex({ dishId: 1, createdAt: -1 })
db.comments.createIndex({ _openid: 1, createdAt: -1 })
```

### 7.3 时间与字段细节

- 云开发导出的 `createdAt` 等已是 ISODate/ISO 字符串，`MongoClient` 写入时保持 `Date` 类型；客户端展示层（`utils/format.js`）不改；
- `serverDate()`（客户端直写用）不再存在，一律服务端 `new Date()`（§5.3）；
- `stableId`（sha256 截断 32 位）生成的确定性 `_id` 语义不变，幂等逻辑继续有效。

### 7.4 事务

`orderCreate`（订单 + N 条厨师消息）、`orderCancel/orderStatus`（订单 + 消息状态）、`setProfile`、`ensureProfile` 用到 `runTransaction`。MongoDB **必须以副本集（replica set）运行**才支持多文档事务——Docker Compose 里起单节点副本集即可（§8 配置已含）。代码映射：`db.runTransaction(fn)` → `client.withSession((s) => s.withTransaction(fn))`，`tx.collection(...)` → 传入 session 的 `collection(...).updateOne/insertOne`。

### 7.5 若选 PostgreSQL（备选路径）

需要为 8 个集合定义表（`orders.items`、`statusHistory` 拆 JSONB 列），查询全部改写为 SQL，`searchTokens` 等值 AND 用 `jsonb @> '["tok1","tok2"]'` 或 GIN 索引，事务改 Sequelize/Prisma。约束和外键更强，但**重写量大、收益在当前量级体现不出来**，除非你明确想借迁移练习关系型建模，否则不推荐首选。

---

## 8. 部署

### 8.1 Docker Compose（单机全套）

```yaml
# server/docker-compose.yml
services:
  app:
    build: .
    environment:
      - MONGO_URL=mongodb://mongo:27017/kunkun?replicaSet=rs0
      - JWT_SECRET=${JWT_SECRET}
      - WECHAT_APPID=${WECHAT_APPID}
      - WECHAT_SECRET=${WECHAT_SECRET}
      - S3_ENDPOINT=${S3_ENDPOINT}      # MinIO 用 http://minio:9000；COS/OSS 填对应值
      - S3_KEY=${S3_KEY}
      - S3_SECRET=${S3_SECRET}
      - S3_BUCKET=${S3_BUCKET}
      - CDN_BASE=${CDN_BASE}
    depends_on: [mongo]
    restart: unless-stopped
  mongo:
    image: mongo:6
    command: ["--replSet", "rs0", "--bind_ip_all"]   # 单节点副本集：支持多文档事务
    volumes: [mongo-data:/data/db]
    restart: unless-stopped
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile", "caddy-data:/data"]
    restart: unless-stopped
volumes: { mongo-data: {}, caddy-data: {} }
```

```text
# Caddyfile —— 自动 HTTPS
api.yourdomain.com {
  reverse_proxy app:3000
}
```

> 首次启动后需进 mongo 容器执行一次 `rs.initiate()` 初始化副本集。

### 8.2 密钥与环境变量清单

`WECHAT_APPID` / `WECHAT_SECRET`（小程序后台-开发设置）、`JWT_SECRET`（≥32 字节随机串）、`MONGO_URL`、S3 四件套 + `CDN_BASE`。一律走服务器 `.env`（不进 git）或密钥管理服务，**AppSecret 与 JWT secret 永不出现在小程序代码里**——小程序包可被解包审查。

### 8.3 上线检查

- [ ] 小程序后台配置 request / uploadFile 合法域名（HTTPS + 备案）
- [ ] `GET /healthz` 健康检查（供监控与 Caddy 探活）
- [ ] mongodump 每日备份 cron + 异地（对象存储）归档，恢复演练一次
- [ ] GitHub Actions：push 时跑 `npm test`（把现有 72 个测试搬进 CI，服务端逻辑平移后同一套测试可继续用——`tests/server.test.js` 本来就是内存库替身，不依赖真实云环境）
- [ ] 服务器防火墙仅放行 80/443，Mongo/MinIO 不对公网暴露

---

## 9. 迁移路线图（分阶段、可回退）

在 `utils/config.js` 加双模式开关，任何阶段失败都能一键回退到云开发：

```js
// utils/config.js
module.exports = {
  env: 'cloud1-d1gs4xp8j13bad753',          // 云开发环境（保留，回退用）
  mode: process.env.API_MODE || 'cloudbase', // 'cloudbase' | 'self'
  apiBase: 'https://api.yourdomain.com'      // mode=self 时生效
}
```

| 阶段 | 内容 | 产出 / 验收 | 估时 |
|---|---|---|---|
| 0 | 域名/备案/服务器/COS 开通；仓库加 CI | 备案提交（**最长前置，立即启动**） | 0.5 天（周期 2~4 周并行等待） |
| 1 | 后端骨架：Express + MongoDB context + `/auth/login` + `/biz/:action` 直通 | 服务端跑通 `tests/server.test.js` 同款用例 | 2~3 天 |
| 2 | §5.2 的 10 个只读接口 + `utils/services/*.js` 改造 | 小程序切 `mode=self` 能浏览全部页面 | 3~4 天 |
| 3 | 存储链路：presign + 上传改造 + §6.4 存量文件脚本 | 新老图片都能显示 | 2~3 天 |
| 4 | 数据迁移 §7 脚本 + 校验（逐集合 count + 抽查） | 双端数据一致 | 1~2 天 |
| 5 | 真机联调 → 全量切 `mode=self` → 观察 1~2 周 → 云开发环境降配/下线 | 迁移完成 | 1~2 天 + 观察 |

量级小，不做双写灰度，**一次性切换 + 保留云开发只读两周作回退**即可。合计 **12~15 人日**；若只要"能点菜的最小闭环"（阶段 1+2 的核心路径），约 5~6 人日。

## 10. 风险清单

| 风险 | 说明 | 对策 |
|---|---|---|
| ICP 备案超期 | 唯一可能卡住时间表的项 | 阶段 0 立即启动；或先海外服务器过渡 |
| `{openid}` 语义漏实现 | §5.2 表中带"本人"的接口，漏一个即越权 | 按表逐集合核对；服务端统一从 JWT 注入，禁止客户端传归属参数 |
| MongoDB 单机数据丢失 | 自托管无云开发托管备份 | 副本集 + 每日 dump 异地归档 |
| AppSecret 泄露 | 可冒充服务端调微信接口 | 只存服务器环境变量；泄露后小程序后台一键重置 |
| 事务踩坑 | standalone 模式 Mongo 不支持多文档事务，`orderCreate` 会直接报错 | Compose 里固定 `--replSet`，上线前跑并发下单用例（已有现成测试） |
| 存量图片临时链接失效 | `getTempFileURL` 链接有时效 | 脚本按批取链接、批内即时下载，失效重取 |
| 双账号身份 | 云开发 openid 与自建后端 code2Session 的 openid 一致（同一 appid 下），数据可直接续用 | 无需 unionid 处理；未来多端（公众号/APP）才引入 unionid |

---

## 附：目录建议（服务端新增部分）

```
server/
  src/
    index.js          # Express 装配（对应 cloudfunctions/biz/index.js）
    auth.js           # §3 login + authRequired
    context.js        # §4.2 MongoDB 版 context
    routes/biz.js     # §4.1 直通路由
    services/         # ← 从 cloudfunctions/biz/services/ 平移，基本不改
    lib/              # ← 从 cloudfunctions/biz/lib/ 平移（order-state/tokenizer 原样）
  scripts/
    migrate-data.js   # §7.1
    migrate-files.js  # §6.4
  docker-compose.yml
  Dockerfile
```
