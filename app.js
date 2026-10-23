// app.js
// 坤坤菜单：App 入口，初始化云开发、主题与用户身份（管理员借此看到所有使用者）
const config = require('./utils/config')
const role = require('./utils/role')
const theme = require('./utils/theme')

App({
  onLaunch() {
    wx.cloud.init({
      env: config.env,
      traceUser: true
    })
    // 主题要在首帧之前就位：读本地缓存 + 同步原生导航栏/窗口底色
    theme.init()
    role.ensureProfile()
  },
  onShow() {
    // 回到前台时刷新身份/最近活跃
    role.ensureProfile()
  },
  globalData: {}
})
