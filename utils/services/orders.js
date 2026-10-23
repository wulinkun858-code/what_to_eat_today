// 按业务域组织的数据访问；通过 utils/db.js 保持页面接口兼容。
const { collection, queryPage } = require('../collection')
const { reportError } = require('../errors')
const biz = require('../biz')

function getMyOrders(page) {
  const where = { _openid: '{openid}' }
  return queryPage(collection('orders').where(where).orderBy('createdAt', 'desc'), page, { items: true, status: true, createdAt: true })
    .catch((err) => reportError(err, '订单加载失败'))
}

function getMyMessages() {
  return collection('messages').where({ _openid: '{openid}' })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()
    .then((res) => res.data)
    .catch((err) => reportError(err, '消息加载失败'))
}

function markMessageRead(id) {
  return biz.call('messageRead', { messageId: id })
}

function getUnreadCount() {
  return collection('messages').where({ _openid: '{openid}', read: false })
    .count()
    .then((res) => res.total)
    .catch(() => 0)
}

function getMyCooklist() {
  return collection('cooklist').where({ _openid: '{openid}' })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
    .then((res) => res.data)
    .catch((err) => reportError(err, '制作列表加载失败'))
}

function removeCookItem(id) {
  return biz.call('cooklistRemove', { cookId: id })
}

module.exports = { getMyOrders, getMyMessages, markMessageRead, getUnreadCount, getMyCooklist, removeCookItem }
