const { fail, pageOptions } = require('../lib/context')

module.exports = function createAdminService(context) {
  const { db, read, requireRole } = context
  const ROLES = ['diner', 'chef', 'admin']
  const profiles = db.collection('profile')
  const ordersCol = db.collection('orders')

  async function userList(payload, openid) {
    await requireRole(openid, ['admin'])
    const { page, pageSize } = pageOptions(payload, 50)
    const [countRes, dataRes] = await Promise.all([
      profiles.count(),
      profiles.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
    ])
    return {
      list: dataRes.data.map((d) => ({
        openid: d._id,
        nickname: d.nickname,
        avatarFileID: d.avatarFileID,
        role: d.role || 'diner',
        lastActiveAt: d.lastActiveAt,
        createdAt: d.createdAt
      })),
      total: countRes.total,
      page,
      pageSize
    }
  }

  async function roleSet(payload, openid) {
    await requireRole(openid, ['admin'])
    const { targetOpenid, role } = payload
    if (!ROLES.includes(role)) fail('非法角色')
    if (targetOpenid === openid) fail('不能修改自己的角色')
    const ref = profiles.doc(targetOpenid)
    const target = await read('profile', targetOpenid)
    if (!target) fail('该用户还未打开过小程序')
    await ref.update({ data: { role, updatedAt: new Date() } })
    return true
  }

  async function adminOrders(payload, openid) {
    await requireRole(openid, ['admin'])
    const { page, pageSize } = pageOptions(payload)
    if (payload.status && !['pending', 'cooking', 'done', 'canceled'].includes(payload.status)) fail('非法状态')
    const where = payload.status ? { status: payload.status } : {}
    const [countRes, dataRes] = await Promise.all([
      ordersCol.where(where).count(),
      ordersCol.where(where).orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get()
    ])
    return { list: dataRes.data, total: countRes.total, page, pageSize }
  }

  return { userList, roleSet, adminOrders }
}
