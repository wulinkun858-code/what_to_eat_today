const { BusinessError, fail } = require('./context')

function createRouter(cloud, handlers) {
  return async (event = {}) => {
    try {
      const openid = cloud.getWXContext().OPENID
      if (!openid) fail('身份获取失败')
      if (!event || typeof event !== 'object' || typeof event.action !== 'string' ||
          !Object.prototype.hasOwnProperty.call(handlers, event.action)) fail('未知操作')
      const payload = event.payload === undefined ? {} : event.payload
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('参数格式无效')
      const data = await handlers[event.action](payload, openid)
      return { ok: true, data }
    } catch (error) {
      if (!(error instanceof BusinessError)) console.error('[biz]', event && event.action, error)
      return { ok: false, message: error instanceof BusinessError ? error.message : '服务异常，请稍后重试' }
    }
  }
}

module.exports = { createRouter }
