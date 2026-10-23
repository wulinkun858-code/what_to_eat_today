# 坤坤菜单 · 微信小程序（KunKun-CaiDan）

仓库：<https://github.com/wulinkun858-code/what_to_eat_today>（main 分支）

多角色点餐小程序：**超级管理员 / 厨师 / 食客（普通用户）**。
食客浏览菜单点菜（无价格无数量，意向报餐）→ 厨师收到消息 → 加入制作列表 → 订单状态流转 → 管理员全局管理与授权。
角色体系与订单设计详见 [docs/multirole-design.md](docs/multirole-design.md)。

> 2026-10-01 起运行在腾讯云开发 CloudBase 上，并从个人菜谱升级为多角色点餐系统。
>
> **计划迁移到自建后端？** 完整技术方案（依赖盘点、认证改造、API 映射、数据与文件迁移、部署与路线图）见
> **[docs/backend-migration.md](docs/backend-migration.md)**。

## 代码重构（2026-10-24）

保留原生小程序、现有页面和样式体系。代码按业务域拆分，所有 12 个页面接入公共生命周期，5 个分页页共用请求竞态与分页状态管理。

- `utils/db.js` 是兼容门面；实际数据访问位于 `utils/services/`。
- `utils/page.js` 统一主题同步、权限刷新和卸载后异步结果隔离；`utils/pagination.js` 统一分页。
- `cloudfunctions/biz/index.js` 只初始化与装配；`services/` 实现业务，`lib/` 提供校验、事务辅助和路由。
- 新订单通过 `requestId` 去重；建单与厨师消息、订单状态与消息状态在同一事务提交。旧调用不传 `requestId` 仍兼容，但不具备跨请求去重。
- 搜索词、分类名称、厨师署名、图片封面由服务端生成。订单结束后不能回退或重新开启。
- 编辑器草稿移除旧图不会立即删除云文件；表单加载失败禁止覆盖保存；网络响应不明时保留可能已被保存的文件。

本地检查无需安装运行时依赖（Node.js 18+、Python 3）：

```sh
npm test
npm run check
npm run validate:ui
```

测试使用独立内存数据库与微信 API 替身，不连接真实云环境。完整变更、兼容性和联调清单见 [重构记录](docs/code-refactor.md)。

**部署顺序：先重新上传并部署整个 `cloudfunctions/biz` 目录（云端安装依赖），再编译小程序。** 新增的 `messageRead` 路由需要新云函数配合。现有集合和文档继续使用，无需清库或重建数据；生产环境尚未由本次本地重构部署或验证。

## 角色与权限

| 角色 | 能力 |
|---|---|
| 食客（默认） | 浏览/搜索菜单、点菜、我的订单（待处理可取消）、评论自己的心得 |
| 厨师 | 食客能力 + 创建/编辑自己的菜品 + 厨师工作台（报餐消息→加入制作列表→完成，订单自动流转） |
| 超级管理员 | 全部能力 + 用户管理（查看所有用户、授权角色）+ 菜品分类管理（定义品类）+ 全部订单（强制推进/取消）+ 可见所有页面 |

- 角色存储于 `profile.role`（diner/chef/admin），文档 `_id` = openid
- 管理员已用现有菜品的归属 openid 播种；**角色变更只能经云函数 `roleSet`**（不能改自己，防自锁）
- 每个用户首次打开小程序自动登记（`ensureProfile`），管理员借此看到所有使用者与最近活跃时间

## 技术栈

- 原生微信小程序（无框架、无 npm 依赖）
- 云开发 CloudBase：云数据库（文档型）+ 云存储
- 免登录：小程序端自动注入 `_openid`，安全规则按归属隔离数据

## 设计系统 v4（2026-10-23）

- **令牌唯一真源**：`styles/tokens.wxss`（颜色 / 字号 / 间距 / 圆角 / 动效 / 层级），两套主题只改变量值。
- **样式分层**：`styles/base.wxss`（reset、排版、动效基元）+ `styles/components.wxss`（书眉 / 印章 / 小票 / 卡片 / 按钮），`app.wxss` 只做装配。
- **导航统一**：`components/nav-bar`；tab 页用书眉页头，二级页用「返回条 + 书眉」，不再依赖原生导航栏。
- **底部 Dock**：`custom-tab-bar` 合并书签导航与点菜单入口，取代原先 tab / 点菜单条 / FAB 三层叠压。
- **硬约束**：只动 `transform` / `opacity`；禁止过渡 `padding`/`width`/`height`/`top`/`left`；禁止 `transition: all` 与 `backdrop-filter`；页面禁止裸 `ms` / 裸 `cubic-bezier` / 裸 `hex`。
- **校验与预览**：`scripts/validate.py`（JSON / WXML / WXSS / 令牌残留 / 组件注册）、`preview/v4-preview.html`。
- 评审与实施记录：[docs/ui-review-v4.md](docs/ui-review-v4.md)、[docs/ui-refactor-v4.md](docs/ui-refactor-v4.md)。

## 云开发资源

| 资源 | 值 | 说明 |
|---|---|---|
| 环境 ID | `cloud1-d1gs4xp8j13bad753` | 上海区，配置在 `utils/config.js` |
| 集合 | `dishes` | 菜品（菜单，**对全体登录用户公开**）：`_openid` = 制作厨师、`images[]`、`image`（封面）、`chefNickname`、`searchTokens`（倒排词元）等 |
| 集合 | `orders` | 报餐单：`_openid` = 食客、`items[]`（菜品快照+chefOpenid）、`chefOpenids`、`status`（pending/cooking/done/canceled）、`statusHistory[]` |
| 集合 | `messages` | 厨师报餐消息：`_openid` = 收件厨师、`orderId`、`dinerNickname`、`items[]`、`read` |
| 集合 | `cooklist` | 厨师制作列表：`_openid` = 厨师、`dishId/dishName`、`orderId`、`done` |
| 集合 | `profile` | 用户身份：`_id` = openid、`role`、`nickname`、`avatarFileID`、`lastActiveAt`；**客户端禁写，全部经云函数** |
| 集合 | `categories` | 菜品品类（管理员定义）：`name`（≤10字，唯一）、`order`（排序）；菜单公开读，增删改经云函数 |
| 集合 | `banners` / `comments` | 自定义轮播图 / 烹饪心得（各自归属人可见） |
| 云函数 | `biz`（cloudfunctions/biz） | action 路由：ensureProfile / setProfile / orderCreate / orderCancel / orderStatus / cooklistAdd / cooklistDone / userList / roleSet / adminOrders；所有跨角色操作的服务端角色校验入口 |
| 安全规则 | 见 docs/multirole-design.md | dishes 公开读 + 角色感知写（get('database.profile.'+auth.openid).role）；orders/messages/cooklist 按归属或管理员；profile 禁客户端写 |
| 索引 | 各集合 `(_openid, 时间/状态)` 复合索引、dishes `searchTokens` / `tags` | 查询全部走索引 |
| 云存储 | `dishes/`、`banners/`、`avatar/` | 图片直传，fileID 直接作 image src |

## 点单业务流转

```
食客：首页「+ 想吃」→ 底部点菜单条 → 确认点菜页（按厨师分组）→ 提交报餐单
  ↓ 云函数 orderCreate：建单(pending) + 按厨师扇出消息
厨师：我的 → 厨师工作台 → 报餐消息「加入制作」→ 制作列表打勾完成
  ↓ 云函数 cooklistAdd/cooklistDone：pending→cooking→(全部完成)done
食客：我的订单看到状态流转（待处理可取消；管理员可强制推进/取消任意单）
```

## 目录结构

```
KunKun-CaiDan/
  app.js                # wx.cloud.init（环境 ID 见 utils/config.js）
  app.json / app.wxss   # 含自定义书签栏（首页 / 留言 / 档案）；app.wxss 为食帖设计系统
  custom-tab-bar/       # 自定义底部书签栏：墨底纸字 + 朱砂书签
  utils/
    config.js           # 云开发环境 ID 配置
    db.js               # 数据服务兼容门面：委托 utils/services 中的业务模块
    icons.js            # 图标资源统一出口（assets/icons 下 PNG，由 SVG 源统一生成）
  assets/
    icons/              # 全套 UI 图标（tabBar/菜单/操作栏，96px PNG，共 ~12KB）
  pages/
    list/               # 首页：搜索行、标签筛选、轮播图（长按进管理页）、分页列表
    detail/             # 详情：多图卡片式轮播、食材、步骤、评论区（发送/长按删除）、图标化操作栏
    edit/               # 编辑：添加/编辑共用，九宫格多图直传云存储（≤9张，首张为封面）
    my/                 # 我的：可点击换头像、统计、图标菜单
    banner-manage/      # 轮播图管理：添加/单删/清空/预览自定义轮播图
    comments/           # 评论 tab：全部评论聚合流（下拉刷新/触底加载，点击回菜品）
  cloudfunctions/
    biz/                # 唯一云函数：lib/ 路由与校验 + services/ 按业务域（依赖注入 context）
  tests/                # node:test 测试（内存数据库与微信 API 替身，npm test）
  docs/                 # 设计与方案文档；backend-migration.md 为自建后端迁移方案
```

## 轮播图说明（首页）

- 数据来源：`banners` 集合的自定义图优先；没有自定义图时自动展示**最近 5 道有图片的菜品**
- 点击菜品轮播 → 进菜品详情；点击自定义轮播 → 全屏图片预览
- **长按轮播图**弹出操作菜单：添加自定义图（一次最多 3 张）/ 清空自定义图（含云存储文件清理）
- 动画：`swiper` autoplay + circular，`easing-function="easeInOutCubic"`，自定义指示点用 CSS width/color 过渡

## 数据层约定（utils/db.js）

- **搜索（倒排索引方案）**：菜品文档带 `searchTokens` 词元数组（`utils/tokenizer.js` 统一分词：
  CJK 一元+二元 bigram、西文/数字整词、小写去重，覆盖 菜名/描述/食材/标签），
  服务端保存时计算，查询时对关键词分词后做**词元等值 AND**（multikey 索引 `search_tokens_idx` 命中），
  替代无法走索引的正则全表扫描；纯符号关键词切不出词元直接返回空
- **保存/删除菜品走云函数**：`dishSave`（创建限厨师/管理员，更新限归属者或管理员，服务端级联清理被替换图片）、`dishDelete`（级联清理图片与评论）——客户端 doc-id 写入在自定义规则下不可靠
- 列表查询：`count` 与数据页并行请求；`field` 投影只取渲染所需字段；每页 20 条；分页页统一带竞态令牌，快速连续搜索/切分类丢弃过期响应
- 标签栏：`field({ tags: true })` 投影分页拉全量后按使用频次排序（小程序端单次上限 100 条）
- 私有集合（评论、轮播、个人订单、厨师消息、制作列表）查询必须带 `_openid: '{openid}'`（安全规则要求客户端条件是其子集，占位符由服务端替换）
- **私有集合按 id 读取使用 `where({ _id, _openid: '{openid}' })` 而非 `doc(id).get()`**：
  自定义安全规则下 doc-id 读不携带查询条件，会被规则引擎以权限拒绝（写入不受此限制，
  `doc(id).update()/remove()` 可用，但必须检查返回的 `updated`/`deleted` 计数）
- 删除菜品时会顺带删除其云存储图片
- 错误统一在本层 toast 提示并 rethrow，页面 catch 只做收尾

## 本地调试

1. 微信开发者工具导入本目录（appid：`wx29ebd81309ac2db7`）
2. 确认工具右上角「云开发」中能看到环境 `cloud1-d1gs4xp8j13bad753`
   （若提示环境不存在/无权限，需在开发者工具中用该 appid 开通/关联云开发环境）
3. 编译预览即可，本地联调无需配置任何合法域名

## 后续上线（发布体验版/正式版）

- 云开发的数据库与存储请求走微信通道，**无需**在小程序后台配置 request/uploadFile 合法域名
- 上线前按 `docs/multirole-design.md` 核对安全规则：`dishes` 向登录用户公开读，写入受角色/归属约束；`profile` 禁止客户端写入。不要恢复旧的「仅创建者可读」规则。
- 若换用新的云开发环境，只需改 `utils/config.js` 的 `env`
