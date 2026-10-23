// 所有客户端服务共用错误出口；嵌套服务只提示一次。
function reportError(error, message) {
  const err = error instanceof Error ? error : new Error(error && (error.message || error.errMsg) || message)
  if (!err.reported) {
    console.error('[service]', err)
    wx.showToast({ title: message || err.message, icon: 'none' })
    err.reported = true
  }
  throw err
}

module.exports = { reportError }
