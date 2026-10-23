// 按业务域组织的数据访问；通过 utils/db.js 保持页面接口兼容。
const { database, collection, queryPage, MAX_LIMIT } = require('../collection')
const { reportError } = require('../errors')
const biz = require('../biz')
const COMMENT_MAX_LENGTH = 200

function getDishComments(dishId) {
  const where = { _openid: '{openid}', dishId }
  return Promise.all([
    collection('comments').where(where).count(),
    collection('comments').where(where)
      .orderBy('createdAt', 'desc')
      .limit(MAX_LIMIT)
      .get()
  ]).then(([countRes, dataRes]) => ({
    list: dataRes.data,
    total: countRes.total
  })).catch((err) => reportError(err, '评论加载失败'))
}

function addComment(dishId, dishName, content) {
  const text = (content || '').trim()
  if (!text) return Promise.reject(new Error('评论不能为空'))
  if (text.length > COMMENT_MAX_LENGTH) {
    return Promise.reject(new Error(`评论最多 ${COMMENT_MAX_LENGTH} 个字`))
  }
  return collection('comments').add({
    data: {
      dishId,
      dishName: dishName || '',
      content: text,
      createdAt: database().serverDate()
    }
  }).then((res) => res._id)
    .catch((err) => reportError(err, '发送失败，请稍后重试'))
}

function removeComment(id) {
  return biz.call('commentRemove', { commentId: id })
}

function getRecentComments(page) {
  const where = { _openid: '{openid}' }
  return queryPage(collection('comments').where(where).orderBy('createdAt', 'desc'), page, { content: true, dishId: true, dishName: true, createdAt: true })
    .catch((err) => reportError(err, '评论加载失败'))
}

module.exports = { COMMENT_MAX_LENGTH, getDishComments, addComment, removeComment, getRecentComments }
