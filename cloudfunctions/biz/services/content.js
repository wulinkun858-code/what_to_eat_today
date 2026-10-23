const { fail } = require('../lib/context')

module.exports = function createContentService({ db, read, getRole, deleteFiles, removeMatching }) {
  async function commentRemove(payload, openid) {
    const role = await getRole(openid)
    const comment = await read('comments', payload.commentId)
    if (!comment) fail('评论不存在')
    if (comment._openid !== openid && role !== 'admin') fail('只能删除自己的评论')
    await db.collection('comments').doc(payload.commentId).remove()
    return true
  }

  async function bannerRemove(payload, openid) {
    const banner = await read('banners', payload.bannerId)
    if (!banner) fail('轮播图不存在')
    if (banner._openid !== openid) fail('只能删除自己的轮播图')
    await db.collection('banners').doc(payload.bannerId).remove()
    await deleteFiles([banner.fileID])
    return true
  }

  async function bannerClear(_payload, openid) {
    const removed = await removeMatching('banners', { _openid: openid }, (row) => [row.fileID])
    return { removed }
  }

  async function messageRead(payload, openid) {
    const message = await read('messages', payload.messageId)
    if (!message) fail('消息不存在')
    if (message._openid !== openid) fail('只能操作自己的消息')
    await db.collection('messages').doc(payload.messageId).update({ data: { read: true } })
    return true
  }

  return { commentRemove, bannerRemove, bannerClear, messageRead }
}
