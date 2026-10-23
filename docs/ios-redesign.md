# 坤坤菜单 · iOS 风格界面与动效改造说明（v1，已被 v2 取代）

> ⚠️ 本文记录的是第一版改造。当前实现已整体重构为「主题系统 + 编辑式排版」，
> 请看 [design-system-v2.md](./design-system-v2.md)。

> 设计依据：Apple Human Interface Guidelines（motion / color / typography / materials）
> 交互模式：`Advanced Interaction Design`（见 `C:\Users\21022\Desktop\SkillPlay\advanced-interaction-design.md`）
> 技能仓库：`C:\Users\21022\Desktop\SkillPlay\skills-apple-human-interface-guidelines`

## 一、设计令牌（已写入 `app.wxss`）

| 类别 | 值 | 说明 |
|---|---|---|
| 主文字 `ink` | `#1D1A16` | 暖黑，替代 `#333333`，长时间阅读更柔 |
| 次级 `ink-2` | `#6B6459` | 说明、副标题 |
| 三级 `ink-3` | `#A8A199` | 占位、时间、计数 |
| 主色 `brand` | `#E8862E` | 保留品牌暖橙（≈ iOS orange） |
| 按压 `brand-deep` | `#D4761F` | 按下态 |
| 页面底 `bg` | `#FAF7F2` | 暖化的 systemGroupedBackground |
| 分隔线 | `rgba(29,26,22,.07)` | 1rpx + `scaleY(.5)` 的 hairline |

- 间距走 8pt 网格（16/24/32/40/48/64/80/96rpx）
- 圆角：卡片 28rpx、大卡 32rpx、胶囊 999rpx
- 字号：大标题 60rpx / 标题 36rpx / 正文 28rpx / 说明 24rpx / 脚注 22rpx

## 二、动效规范

| 名称 | 曲线 | 用途 |
|---|---|---|
| `ease-ios` | `cubic-bezier(.32,.72,0,1)` | 转场、指示器位移 |
| `ease-out` | `cubic-bezier(.2,.8,.2,1)` | 淡入、通用缓出 |
| `spring` | `cubic-bezier(.34,1.56,.64,1)` | 按压回弹、按钮 |
| `spring-2` | `cubic-bezier(.22,1.2,.36,1)` | 入场位移、展开 |

原则：只动 `transform` / `opacity`；反馈 150–250ms；入场 ≤ 500ms；动效不阻塞输入。

## 三、页面改动

### 全局
- `app.wxss`：设计令牌 + `rise-in` / `pop-in` / `skeleton` / `hairline` 基元
- `.page-enter` 改为**只做透明度**：根节点一旦带 `transform`，内部 `position: fixed` 元素会以它为包含块而错位
- `utils/haptic.js`：`light / medium / heavy` 触觉封装，统一 `try/catch` 降级
- `utils/ui.js`：`getNavMetrics()` 读取状态栏、胶囊按钮，推算导航高度

### 自定义 tabBar（Morphing Tab Selection）
- 从贴底通栏改为**浮动玻璃胶囊**（左右 24rpx、底部安全区上方 12rpx）
- 选中态由一块 1/3 宽的「药丸」用 `translate3d(selected*100%)` 连续位移，配合图标弹跳 + 文字变色
- 点击给 `light` 触觉；点当前 tab 也回一次轻反馈，避免「点了没反应」

### 首页 `pages/list`
- **自定义导航**（`navigationStyle: custom`）：状态栏 + 标题行 + 常驻搜索行，高度由 `getNavMetrics()` 计算
- **iOS 大标题**：内容区大标题随页面滚出，滚动超过 44px 时导航内的小标题淡入（16px 滞回，避免边界抖动）
- **轮播卡片叠层**（Curved Card Deck）：`previous/next-margin 44rpx` 露出邻卡，非当前卡 `scale(.9)` + `opacity(.55)`
- **品类胶囊形变**：选中项颜色反转 + 轻微放大 + 弹一下，并 `scroll-into-view` 自动滚到可视区
- **菜品卡错峰入场**（Staggered）：前 8 项按 45ms 递增延迟；`animation-fill-mode: backwards` 保证 `hover-class` 按压不被覆盖
- **想吃飞入点菜单**：从手指位置生成粒子，飞向点菜单图标（`translate3d + scale + opacity`），同时角标回弹 + 轻触觉
- **点菜单条**弹性上滑入场，FAB 随之上移；FAB 加号改用两条线绘制，避免字体基线偏移
- **骨架屏**：首次加载占位，避免空白闪跳

### 详情页 `pages/detail`
- 图片轮播改为叠层卡片（`previous/next-margin 56rpx`，当前卡放大 + 投影）
- 菜名 / 标签 / 简介 / 食材 / 做法 / 评论按 40–60ms 错峰入场
- 分区标题加橙色小竖条作为视觉锚点
- 评论发送键在有内容时点亮并轻微放大；发送 / 删除给触觉
- 底部操作栏改为磨砂玻璃 + 上滑入场

### 评论页 `pages/comments`
- 新增分组标题（烹饪心得 + 条数），卡片流 45ms 错峰入场

### 我的页 `pages/my`
- 统计数字用 easeOutCubic 在 600ms 内从旧值滚到新值（32ms 节流一次 `setData`）
- 资料卡 / 统计 / 菜单块分层入场；按压改用回弹曲线

### 点菜页 `pages/order-confirm`
- 菜品行 45ms 错峰入场；移除按钮按压时旋转 90° 并变红
- 提交栏磨砂 + 上滑入场；提交成功给 `medium` 触觉

## 四、交互模式 → 落地位置

| 模式 | 落地 |
|---|---|
| Morphing Tab Selection | 自定义 tabBar 药丸指示器、品类胶囊 |
| Curved Card Deck | 首页轮播、详情页图片 |
| Staggered Multi-Selection | 菜品卡、评论卡、点菜行、详情分区 |
| Spring Stepper Progress | 提交按钮 / 加载态的回弹与状态切换 |
| Haptic Feedback Toggles | tab 切换、加入点菜单、发送评论、提交订单 |
| Radial Theme Transition | 空态呼吸光晕（降级实现，小程序无 clip-path 动画） |
| Drag-to-Reorder | 暂未启用（需要长按排序的业务场景） |

## 五、取舍与注意事项

1. **下拉刷新指示器**：自定义导航后，系统刷新指示器会被常驻底色的导航遮住。刷新逻辑仍然生效
   （`onPullDownRefresh` 正常触发），只是看不到转圈。若要可见，可关闭 `enablePullDownRefresh` 后自绘。
2. **磨砂玻璃**：`backdrop-filter` 在 iOS 稳定可用，Android 部分机型会退化为半透明白底，已保留兜底底色。
3. **动效降级**：当前未读取系统「减弱动态效果」开关；如需支持，可在 `onLoad` 里读
   `wx.getSystemInfoSync().enableReduceMotion`（部分基础库）后给根节点加 `reduce-motion` 类，把位移动画降级为淡入。
4. **回滚**：本次改动集中在 `app.wxss`、`custom-tab-bar/*`、`pages/{list,detail,comments,my,order-confirm}/*`，
   其余页面的 wxss 只做了色值统一（`#333333 → #1D1A16` 等），可单独还原。
