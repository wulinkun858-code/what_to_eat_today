const { definePage } = require('../../utils/page')
// pages/banner-manage/banner-manage.js
// 轮播图管理：查看/添加/删除/清空自定义轮播图（首页长按轮播图也会跳转到这里）
const dbService = require('../../utils/db')

Page(definePage({
  data: {
    banners: [], // [{ _id, fileID }]
    max: 0, // 轮播上限（BANNER_MAX）
    loading: true,
    uploading: false
  },

  onLoad() {
    this.setData({ max: dbService.BANNER_MAX })
  },

  onShow() {
    this.fetchBanners()
  },

  // 拉取当前自定义轮播图
  fetchBanners() {
    const token = this._bannerToken = (this._bannerToken || 0) + 1
    return dbService.getBanners().then((docs) => {
      if (token !== this._bannerToken) return
      this.setData({
        banners: docs.map((doc) => ({ _id: doc._id, fileID: doc.fileID })),
        loading: false
      })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  // 添加图片：按剩余张数选择，逐张上传
  onAddTap() {
    if (this.data.loading || this.data.uploading) return
    const remain = this.data.max - this.data.banners.length
    if (remain <= 0) {
      wx.showToast({ title: `最多 ${this.data.max} 张，请先删除`, icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      success: (res) => {
        const temps = (res.tempFiles || []).map((file) => file.tempFilePath)
        if (!temps.length) return
        this.setData({ uploading: true })
        wx.showLoading({ title: '上传中', mask: true })
        let failed = 0
        temps.reduce((chain, temp) => chain.then(() =>
          dbService.uploadImage(temp, 'banners')
            .then((fileID) => dbService.addBanners([fileID]))
            .catch(() => {
              failed += 1
            })
        ), Promise.resolve()).then(() => {
          wx.hideLoading()
          if (failed) {
            wx.showToast({ title: `${failed} 张上传失败`, icon: 'none' })
          }
          return this.fetchBanners()
        }).finally(() => {
          this.setData({ uploading: false })
        })
      }
    })
  },

  // 点击图片：全屏预览
  onPreviewTap(e) {
    const index = e.currentTarget.dataset.index
    if (!this.data.banners[index]) return
    wx.previewImage({
      urls: this.data.banners.map((item) => item.fileID),
      current: this.data.banners[index].fileID
    })
  },

  // 删除单张（二次确认，含文件清理）
  onDeleteTap(e) {
    if (this.data.uploading) return
    const index = e.currentTarget.dataset.index
    const target = this.data.banners[index]
    if (!target) return
    wx.showModal({
      title: '删除轮播图',
      content: '确定删除这张自定义轮播图吗？',
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm) return
        dbService.removeBanner(target._id).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' })
          this.fetchBanners()
        }).catch(() => {})
      }
    })
  },

  // 清空全部（二次确认，含文件清理）
  onClearAllTap() {
    if (!this.data.banners.length || this.data.uploading) return
    wx.showModal({
      title: '清空轮播图',
      content: '确定删除全部自定义轮播图吗？删除后不可恢复。',
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        dbService.removeAllBanners().then(() => {
          wx.hideLoading()
          wx.showToast({ title: '已清空', icon: 'success' })
          this.fetchBanners()
        }).catch(() => {
          wx.hideLoading()
        })
      }
    })
  }
}))
