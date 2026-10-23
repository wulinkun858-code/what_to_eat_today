const theme = require('./theme')
const role = require('./role')
const navigation = require('./navigation')

function cancelAccessNavigation(page) {
  if (page._cancelAccessNavigation) page._cancelAccessNavigation()
  page._cancelAccessNavigation = null
}

// 页面公共生命周期：主题同步、权限刷新，以及卸载后的异步结果隔离。
function definePage(options, access) {
  const { onLoad, onShow, onHide, onUnload } = options
  return Object.assign({}, options, {
    data: Object.assign({ pageVisible: true, motionSettled: false }, options.data),
    onLoad(...args) {
      this._disposed = false
      this._visible = true
      const setData = this.setData.bind(this)
      this.setData = (data, callback) => {
        if (!this._disposed) setData(data, callback)
      }
      theme.sync(this)
      if (onLoad) return onLoad.apply(this, args)
    },
    async onShow(...args) {
      cancelAccessNavigation(this)
      this._visible = true
      const token = this._showToken = (this._showToken || 0) + 1
      this.setData({ pageVisible: true })
      theme.sync(this)
      navigation.ready(this.route)
      if (access) {
        await role.ensureProfile()
        if (this._disposed || !this._visible || token !== this._showToken) return
        const allowed = access === 'admin' ? role.isAdmin() : role.isChef()
        if (!allowed) {
          wx.showToast({ title: access === 'admin' ? '仅管理员可访问' : '仅厨师可访问', icon: 'none' })
          // 缓存权限可能在入场 complete 之前返回，必要的回退不能被导航锁丢弃。
          this._cancelAccessNavigation = navigation.whenIdle(() => {
            this._cancelAccessNavigation = null
            if (this._disposed || !this._visible || token !== this._showToken) return
            if (getCurrentPages().length > 1) navigation.navigateBack()
            else navigation.switchTab({ url: '/pages/list/list' })
          })
          return
        }
      }
      if (!this._disposed && this._visible && token === this._showToken && onShow) return onShow.apply(this, args)
    },
    onHide(...args) {
      cancelAccessNavigation(this)
      this._visible = false
      this._showToken = (this._showToken || 0) + 1
      this.setData({ pageVisible: false, motionSettled: true })
      if (onHide) return onHide.apply(this, args)
    },
    onUnload(...args) {
      cancelAccessNavigation(this)
      this._disposed = true
      this._visible = false
      this._showToken = (this._showToken || 0) + 1
      this._fetchToken = (this._fetchToken || 0) + 1
      if (onUnload) return onUnload.apply(this, args)
    }
  })
}

module.exports = { definePage }
