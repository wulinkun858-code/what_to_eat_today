const { fail } = require('../lib/context')

module.exports = function createCategoriesService(context) {
  const { db, read, requireRole } = context
  const categoriesCol = db.collection('categories')
  const dishesCol = db.collection('dishes')

  async function categoryAdd(payload, openid) {
    await requireRole(openid, ['admin'])
    if (typeof payload.name !== 'string') fail('分类名称格式无效')
    const name = String(payload.name || '').trim()
    if (!name || name.length > 10) fail('分类名需为 1-10 个字')
    const dup = await categoriesCol.where({ name }).count()
    if (dup.total > 0) fail('已存在同名分类')
    const maxRes = await categoriesCol.orderBy('order', 'desc').limit(1).get()
    const order = (maxRes.data[0] && maxRes.data[0].order) || 0
    const added = await categoriesCol.add({
      data: { name, order: order + 1, createdAt: new Date() }
    })
    return { categoryId: added._id, name }
  }

  async function categoryUpdate(payload, openid) {
    await requireRole(openid, ['admin'])
    if (typeof payload.name !== 'string') fail('分类名称格式无效')
    const name = String(payload.name || '').trim()
    if (!name || name.length > 10) fail('分类名需为 1-10 个字')
    const ref = categoriesCol.doc(payload.categoryId)
    const category = await read('categories', payload.categoryId)
    if (!category) fail('分类不存在')
    if (category.name === name) return true
    const dup = await categoriesCol.where({ name }).count()
    if (dup.total > 0) fail('已存在同名分类')
    await ref.update({ data: { name } })
    await dishesCol.where({ categoryId: payload.categoryId })
      .update({ data: { categoryName: name } })
    return true
  }

  async function categoryDelete(payload, openid) {
    await requireRole(openid, ['admin'])
    const ref = categoriesCol.doc(payload.categoryId)
    const category = await read('categories', payload.categoryId)
    if (!category) fail('分类不存在')
    await ref.remove()
    await dishesCol.where({ categoryId: payload.categoryId })
      .update({ data: { categoryId: '', categoryName: '' } })
    return true
  }

  return { categoryAdd, categoryUpdate, categoryDelete }
}
