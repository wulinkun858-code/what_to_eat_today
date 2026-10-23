// utils/biz.js
// 云函数调用封装：统一 toast 错误、解包 { ok, data }
const { reportError } = require('./errors')

function call(action, payload = {}) {
  return Promise.resolve().then(() => wx.cloud.callFunction({ name: 'biz', data: { action, payload } })).then((res) => {
    const result = (res && res.result) || {}
    if (result.ok) return result.data
    const error = new Error(result.message || '操作失败')
    error.biz = true
    throw error
  }).catch((err) => {
    const message = err && err.biz ? err.message : '服务暂不可用，请稍后重试'
    return reportError(err, message)
  })
}

module.exports = { call }
