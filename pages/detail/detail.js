const navigation = require('../../utils/navigation')
const { definePage } = require('../../utils/page')
// pages/detail/detail.js
// 详情页：多图卡片式轮播、厨师署名、食材与做法步骤、评论区
// 编辑/删除仅菜品归属厨师与管理员可见（数据源：云开发数据库）
const dbService = require('../../utils/db')
const role = require('../../utils/role')
const haptic = require('../../utils/haptic')
const cart = require('../../utils/cart')
const { formatRelative } = require('../../utils/format')

Page(definePage({
  data: {
    theme: 'paper',
    reduce: false,
    id: '', // 菜品文档 _id
    dish: null, // 菜品详情对象
    dishImages: [], // 菜品图片列表（fileID）
    heroCurrent: 0, // 当前轮播索引
    heroAutoplay: true, // 自动轮播（用户触摸后停止）
    loading: false, // 是否正在加载
    canManage: false, // 归属厨师或管理员
    inCart: false,
    deleted: false,
    commentList: [], // 评论列表（新→旧，附 timeText）
    commentTotal: 0, // 评论总数
    commentDraft: '', // 输入中的评论内容
    commentSending: false,
    commentMaxLength: dbService.COMMENT_MAX_LENGTH,
    removingCmtIndex: -1 // 正在定向飞出的评论
  },

  onLoad(options) {
    const id = options.id || ''
    this.setData({ id })
    // 身份先行加载，保证 canManage 判定可用
    role.ensureProfile().then(() => {
      if (this.data.dish) this.setData({ canManage: this.checkManage(this.data.dish) })
    })
    if (id) {
      this.fetchDetail(id)
    } else {
      wx.showToast({ title: '缺少菜品 id', icon: 'none' })
    }
  },

  // 归属厨师或管理员可管理
  checkManage(dish) {
    return role.isOpenid(dish._openid) || role.isAdmin()
  },

  onShow() {
    if (this.data.deleted) {
      this.scheduleReturn()
      return
    }
    this.setData({ inCart: cart.has(this.data.id) })
    // 从编辑页返回时重新拉取详情，保证修改即时可见
    if (this._needRefresh && this.data.id) {
      this._needRefresh = false
      this.fetchDetail(this.data.id)
    }
  },

  onHide() {
    clearTimeout(this._backTimer)
    clearTimeout(this._cmtTimer)
    if (this._removedCommentId) this.finishCommentRemoval(this._removedCommentId)
  },

  scheduleReturn() {
    clearTimeout(this._backTimer)
    if (this._disposed || this._visible === false) return
    this._backTimer = setTimeout(() => {
      if (!this._disposed && this._visible !== false) navigation.navigateBack()
    }, this.data.reduce ? 0 : 320)
  },

  finishCommentRemoval(id) {
    clearTimeout(this._cmtTimer)
    this._removedCommentId = ''
    if (this._disposed) return
    const list = this.data.commentList.filter((comment) => comment._id !== id)
    const removed = this.data.commentList.length - list.length
    this.setData({
      commentList: list,
      commentTotal: Math.max(0, this.data.commentTotal - removed),
      removingCmtIndex: -1
    })
  },

  /**
   * 拉取菜品详情
   * @param {string} id 文档 _id
   */
  fetchDetail(id) {
    this.setData({ loading: true })
    dbService.getDish(id).then((dish) => {
      // 兼容旧数据：只有单图 image 字段时视为一张图
      const dishImages = (dish.images && dish.images.length)
        ? dish.images
        : (dish.image ? [dish.image] : [])
      this.setData({
        dish,
        dishImages,
        heroCurrent: 0,
        heroAutoplay: true,
        canManage: this.checkManage(dish)
      })
    }).catch(() => {
      // 错误提示由数据层统一 toast
    }).finally(() => {
      this.setData({ loading: false })
    })
    // 评论独立加载，不阻塞正文
    this.fetchComments(id)
  },

  /**
   * 拉取菜品评论
   * @param {string} id 菜品 _id
   */
  fetchComments(id) {
    dbService.getDishComments(id).then(({ list, total }) => {
      this.setData({
        commentList: list.map((item) => ({
          _id: item._id,
          content: item.content,
          timeText: formatRelative(item.createdAt)
        })),
        commentTotal: total
      })
    }).catch(() => {
      // 错误提示由数据层统一 toast
    })
  },

  // 评论输入
  onCmtInput(e) {
    this.setData({ commentDraft: e.detail.value })
  },

  // 发送评论（键盘确认或点击发送）
  onCmtSend() {
    if (this.data.commentSending) return
    const content = this.data.commentDraft.trim()
    if (!content) {
      wx.showToast({ title: '写点什么再发送吧', icon: 'none' })
      return
    }
    if (content.length > this.data.commentMaxLength) {
      wx.showToast({ title: `评论最多 ${this.data.commentMaxLength} 个字`, icon: 'none' })
      return
    }
    this.setData({ commentSending: true })
    return dbService.addComment(this.data.id, this.data.dish ? this.data.dish.name : '', content)
      .then((_id) => {
        // 本地构造新评论置顶（createdAt 用当前时间，显示「刚刚」）
        const newItem = { _id, content, timeText: '刚刚' }
        haptic.light()
        this.setData({
          commentList: [newItem].concat(this.data.commentList),
          commentTotal: this.data.commentTotal + 1,
          commentDraft: this.data.commentDraft.trim() === content ? '' : this.data.commentDraft
        })
      }).catch(() => {
        // 错误提示由数据层统一 toast
      }).finally(() => {
        this.setData({ commentSending: false })
      })
  },

  // 长按评论删除（微信朋友圈同款交互，二次确认）
  onCmtRemove(e) {
    const index = e.currentTarget.dataset.index
    const target = this.data.commentList[index]
    if (!target || this.data.removingCmtIndex !== -1) return
    wx.showModal({
      title: '删除评论',
      content: '确定删除这条评论吗？',
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm) return
        this.setData({ removingCmtIndex: index })
        dbService.removeComment(target._id).then(() => {
          if (this._disposed) return
          this._removedCommentId = target._id
          if (this.data.reduce || this._visible === false) this.finishCommentRemoval(target._id)
          else this._cmtTimer = setTimeout(() => this.finishCommentRemoval(target._id), 280)
        }).catch(() => {
          this.setData({ removingCmtIndex: -1 })
        })
      }
    })
  },

  onUnload() {
    if (this._cmtTimer) clearTimeout(this._cmtTimer)
    clearTimeout(this._backTimer)
  },

  // 轮播切换：同步指示点
  onHeroChange(e) {
    this.setData({ heroCurrent: e.detail.current })
  },

  // 用户触摸轮播后停止自动播放（阅读内容时不被打扰）
  onHeroTouchStart() {
    if (this.data.heroAutoplay) this.setData({ heroAutoplay: false })
  },

  // 点击图片：从当前张开始全屏预览
  onHeroTap() {
    if (!this.data.dishImages.length) return
    wx.previewImage({
      urls: this.data.dishImages,
      current: this.data.dishImages[this.data.heroCurrent] || this.data.dishImages[0]
    })
  },

  // 点击编辑：跳转编辑页并携带 _id
  onAddToCart() {
    if (!this.data.dish) return
    if (cart.has(this.data.dish._id)) {
      navigation.navigateTo({ url: '/pages/order-confirm/order-confirm' })
      return
    }
    cart.add(this.data.dish)
    this.setData({ inCart: true })
    haptic.light()
    wx.showToast({ title: '已加入点菜单', icon: 'none' })
  },

  onEditTap() {
    navigation.navigateTo({ url: `/pages/edit/edit?id=${this.data.id}` })
  },

  // 点击删除：二次确认后删除文档（数据层会同时清理云端图片）
  onDeleteTap() {
    if (this._deleting || this.data.deleted) return
    wx.showModal({
      title: '删除菜品',
      content: `确定删除「${this.data.dish ? this.data.dish.name : ''}」吗？删除后不可恢复。`,
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm || this._disposed || this._deleting) return
        this._deleting = true
        const pages = getCurrentPages()
        const index = pages.indexOf(this)
        const prevPage = index > 0 ? pages[index - 1] : null
        dbService.removeDish(this.data.id).then(() => {
          if (prevPage && typeof prevPage.markNeedRefresh === 'function') {
            prevPage.markNeedRefresh()
          }
          if (this._disposed) return
          this.setData({ deleted: true })
          if (this._visible !== false) wx.showToast({ title: '已删除', icon: 'success' })
          this.scheduleReturn()
        }).catch(() => {
          // 错误提示由数据层统一 toast
        }).finally(() => {
          this._deleting = false
        })
      }
    })
  },

  // 返回前被编辑页调用：标记需要刷新详情，并向上冒泡标记上一页（列表页），
  // 避免「列表→详情→编辑→保存」后返回列表时数据陈旧。
  // 注意：必须按自身在栈中的位置取上一页（此时 edit 可能仍在栈顶，
  // 取 pages[len-2] 会拿到 detail 自己导致无限递归）
  markNeedRefresh() {
    this._needRefresh = true
    const pages = getCurrentPages()
    const idx = pages.indexOf(this) // 定位自己在栈中的位置
    const prevPage = idx > 0 ? pages[idx - 1] : null
    if (prevPage && prevPage !== this && typeof prevPage.markNeedRefresh === 'function') {
      prevPage.markNeedRefresh()
    }
  }
}))
