const navigation = require('../../utils/navigation')
const { definePage } = require('../../utils/page')
// pages/edit/edit.js
// 编辑页：添加与编辑共用。有 id 时回填详情并走更新，否则新增（数据源：云开发）
// 图片支持多张（最多 9 张），第一张作为封面同步到 image 字段，供列表与首页轮播使用
const dbService = require('../../utils/db')

const NAME_MAX_LENGTH = 50 // 菜名最大长度
const IMAGES_MAX = 9 // 图片上限

Page(definePage({
  data: {
    id: '', // 菜品文档 _id（编辑模式非空）
    name: '', // 菜名（必填）
    nameError: '', // 菜名校验错误提示
    imagePreviews: [], // 图片预览列表（cloud:// fileID 或上传中的本地临时路径）
    categories: [], // 管理员定义的品类 [{ _id, name }]
    categoryNames: [], // picker 用的名称数组
    categoryIndex: -1, // 当前选中品类（-1 = 未分类）
    description: '', // 描述
    ingredientsText: '', // 食材（每行一个）
    stepsText: '', // 步骤（每行一步）
    tagsText: '', // 标签（逗号或空格分隔）
    submitting: false, // 提交中防重复点击
    saved: false,
    uploading: false, // 图片上传中（禁止提交与继续加图）
    loading: true,
    loadFailed: false,
    imagesMax: IMAGES_MAX,
    // 多行占位文案放 data 里用真实换行符（WXML 属性里写 &#10; 不会被解析）
    ingredientsPlaceholder: '每行一个食材，例如：\n鸡腿 2 个\n生抽 2 勺',
    stepsPlaceholder: '每行一步，例如：\n鸡腿洗净切块\n冷水下锅焯水'
  },

  onLoad(options) {
    this._uploadedFiles = new Set()
    const id = options.id || ''
    this.setData({ id })
    // 动态设置导航栏标题
    wx.setNavigationBarTitle({ title: id ? '编辑菜品' : '添加菜品' })
    // 品类选择器数据源（管理员定义）
    const categoriesReady = dbService.getCategories().then((list) => {
      this.setData({
        categories: list,
        categoryNames: list.map((c) => c.name)
      })
    })
    return categoriesReady.then(() => id ? this.fetchDetail(id) : null)
      .catch(() => this.setData({ loadFailed: true }))
      .finally(() => this.setData({ loading: false }))
  },

  onShow() {
    if (this.data.saved) this.scheduleReturn()
  },

  onHide() {
    clearTimeout(this._backTimer)
  },

  scheduleReturn() {
    clearTimeout(this._backTimer)
    if (this._disposed || this._visible === false) return
    this._backTimer = setTimeout(() => {
      if (!this._disposed && this._visible !== false) navigation.navigateBack()
    }, this.data.reduce ? 0 : 320)
  },

  /**
   * 编辑模式：拉取详情并回填表单
   * @param {string} id 文档 _id
   */
  fetchDetail(id) {
    return dbService.getDish(id).then((dish) => {
      // 兼容旧数据：只有单图 image 字段时视为一张图
      const images = (dish.images && dish.images.length)
        ? dish.images
        : (dish.image ? [dish.image] : [])
      this.setData({
        name: dish.name || '',
        imagePreviews: images.slice(0, IMAGES_MAX),
        categoryIndex: this.indexOfCategory(dish.categoryId),
        description: dish.description || '',
        ingredientsText: (dish.ingredients || []).join('\n'),
        stepsText: (dish.steps || []).join('\n'),
        tagsText: (dish.tags || []).join('，')
      })
    })
  },

  // 品类选择
  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) })
  },

  /**
   * 按品类 _id 找索引；找不到或未设置返回 -1（未分类）
   * @param {string} categoryId
   */
  indexOfCategory(categoryId) {
    if (!categoryId) return -1
    return this.data.categories.findIndex((c) => c._id === categoryId)
  },

  // 菜名输入
  onNameInput(e) {
    this.setData({ name: e.detail.value, nameError: '' })
  },

  // 菜名失焦校验
  onNameBlur() {
    this.validateName()
  },

  /**
   * 校验菜名：必填且不超过最大长度
   * @returns {boolean} 是否通过
   */
  validateName() {
    const name = this.data.name.trim()
    let nameError = ''
    if (!name) {
      nameError = '菜名不能为空'
    } else if (name.length > NAME_MAX_LENGTH) {
      nameError = `菜名最多 ${NAME_MAX_LENGTH} 个字`
    }
    this.setData({ nameError })
    return !nameError
  },

  // 添加图片：按剩余张数选择，逐张上传（单张失败不影响其余，失败占位会被移除）
  onChooseImage() {
    if (this.data.uploading || this.data.submitting || this.data.loading || this.data.loadFailed) return
    const remain = IMAGES_MAX - this.data.imagePreviews.length
    if (remain <= 0) return
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      success: (res) => {
        const temps = (res.tempFiles || []).map((file) => file.tempFilePath)
        if (!temps.length) return
        const startLen = this.data.imagePreviews.length
        this.setData({
          imagePreviews: this.data.imagePreviews.concat(temps),
          uploading: true
        })
        temps.reduce((chain, temp, k) => chain.then(() =>
          dbService.uploadImage(temp, 'dishes').then((fileID) => {
            if (this._disposed) return dbService.deleteCloudFile(fileID)
            this._uploadedFiles.add(fileID)
            // 上传成功：占位临时路径替换为 fileID（两种地址 image 组件都能显示）
            this.setData({ ['imagePreviews[' + (startLen + k) + ']']: fileID })
          }).catch(() => null)
        ), Promise.resolve()).then(() => {
          // 仍是临时路径的占位即上传失败项，统一移除
          const kept = this.data.imagePreviews.filter((p) => p.indexOf('cloud://') === 0)
          this.setData({ imagePreviews: kept, uploading: false })
        })
      }
    })
  },

  // 点缩略图：全屏预览
  onPreviewImage(e) {
    const index = e.currentTarget.dataset.index
    wx.previewImage({
      urls: this.data.imagePreviews,
      current: this.data.imagePreviews[index]
    })
  },

  // 已保存图片仅从草稿移除；保存成功后由服务端清理，放弃编辑不会破坏原菜品。
  onRemoveImage(e) {
    if (this.data.uploading || this.data.submitting) return
    const index = e.currentTarget.dataset.index
    const target = this.data.imagePreviews[index]
    if (this._uploadedFiles.has(target) && !this._saveUncertain) {
      dbService.deleteCloudFile(target)
      this._uploadedFiles.delete(target)
    }
    this.setData({
      imagePreviews: this.data.imagePreviews.filter((p, i) => i !== index)
    })
  },

  // 描述输入
  onDescriptionInput(e) {
    this.setData({ description: e.detail.value })
  },

  // 食材输入
  onIngredientsInput(e) {
    this.setData({ ingredientsText: e.detail.value })
  },

  // 步骤输入
  onStepsInput(e) {
    this.setData({ stepsText: e.detail.value })
  },

  // 标签输入
  onTagsInput(e) {
    this.setData({ tagsText: e.detail.value })
  },

  /**
   * 将多行文本拆成数组（去空行）
   * @param {string} text 原始文本
   * @returns {string[]} 拆分数组
   */
  splitLines(text) {
    return (text || '').split('\n').map((line) => line.trim()).filter(Boolean)
  },

  /**
   * 将标签文本拆成数组（逗号或空格分隔，去重）
   * @param {string} text 原始文本
   * @returns {string[]} 标签数组
   */
  splitTags(text) {
    const tags = (text || '')
      .split(/[,，、\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    return Array.from(new Set(tags))
  },

  // 提交表单
  onSubmit() {
    if (this.data.saved) return this.scheduleReturn()
    if (this.data.submitting || this.data.uploading || this.data.loading) return
    if (this.data.loadFailed) {
      wx.showToast({ title: '表单加载失败，请返回后重试', icon: 'none' })
      return
    }
    if (!this.validateName()) return

    // 提交被禁止时有上传中占位的可能，这里只保留已上传成功的
    const images = this.data.imagePreviews.filter((p) => p.indexOf('cloud://') === 0)
    const body = {
      name: this.data.name.trim(),
      description: this.data.description.trim(),
      ingredients: this.splitLines(this.data.ingredientsText),
      steps: this.splitLines(this.data.stepsText),
      tags: this.splitTags(this.data.tagsText),
      images,
      image: images[0] || null // 封面 = 第一张，供列表与首页轮播使用
    }
    // 品类（管理员定义；未选择则为未分类）
    const category = this.data.categories[this.data.categoryIndex]
    body.categoryId = category ? category._id : ''

    this.setData({ submitting: true })
    this._saveUncertain = true
    const req = this.data.id
      ? dbService.updateDish(this.data.id, body)
      : dbService.addDish(body)

    return req.then(() => {
      this._saveUncertain = false
      this._uploadedFiles.clear()
      if (this._disposed) return
      this.setData({ saved: true })
      // 通知上一页（列表或详情）刷新
      const pages = getCurrentPages()
      const prevPage = pages[pages.length - 2]
      if (prevPage && typeof prevPage.markNeedRefresh === 'function') {
        prevPage.markNeedRefresh()
      }
      if (this._visible !== false) wx.showToast({ title: '已保存', icon: 'success' })
      this.scheduleReturn()
    }).catch((error) => {
      // 网络失败可能发生在服务端保存之后，不能按“保存失败”直接删图。
      this._saveUncertain = !error.biz
      // 保存失败保留草稿供重试；已离开页面则清理尚未引用的新图片。
      if (this._disposed) this.cleanupUploads()
    }).finally(() => {
      this.setData({ submitting: false })
    })
  },

  cleanupUploads() {
    if (this._saveUncertain) return Promise.resolve()
    const files = Array.from(this._uploadedFiles || [])
    if (this._uploadedFiles) this._uploadedFiles.clear()
    return dbService.deleteCloudFile(files)
  },

  onUnload() {
    clearTimeout(this._backTimer)
    // 保存请求在途时等待结果，避免删除刚被保存的图片。
    if (!this.data.submitting) this.cleanupUploads()
  }
}))
