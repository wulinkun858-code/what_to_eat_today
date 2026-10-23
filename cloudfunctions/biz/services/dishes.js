const { fail, id } = require('../lib/context')
const { buildSearchTokens } = require('../lib/tokenizer')

function strings(value, label, maxItems, maxLength) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems ||
      value.some((item) => typeof item !== 'string' || item.length > maxLength)) fail(label + '格式或长度无效')
  return value.map((item) => item.trim()).filter(Boolean)
}

function filesOf(dish) {
  return [dish.image].concat(Array.isArray(dish.images) ? dish.images : []).filter(Boolean)
}

module.exports = function createDishService({ db, read, getRole, deleteFiles, removeMatching }) {
  async function dishSave(payload, openid) {
    const role = await getRole(openid)
    const data = payload.dish
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('菜品格式无效')
    const name = typeof data.name === 'string' ? data.name.trim() : ''
    if (!name || name.length > 50) fail('菜名需为 1-50 个字')
    let old = null
    if (payload.dishId) {
      old = await read('dishes', payload.dishId)
      if (!old) fail('菜品不存在')
      if (old._openid !== openid && role !== 'admin') fail('只能修改自己的菜品')
    } else if (!['chef', 'admin'].includes(role)) fail('仅厨师或管理员可以创建菜品')
    if (data.description !== undefined && (typeof data.description !== 'string' || data.description.length > 5000)) fail('描述格式或长度无效')
    const images = Array.from(new Set(strings(data.images, '图片', 9, 2048)))
    if (images.some((file) => !file.startsWith('cloud://'))) fail('请先完成图片上传')
    const categoryId = data.categoryId || ''
    const category = categoryId ? await read('categories', categoryId) : null
    if (categoryId && !category) fail('分类不存在，请重新选择')
    const owner = await read('profile', old ? old._openid : openid)
    const doc = {
      name,
      description: (data.description || '').trim(),
      ingredients: strings(data.ingredients, '食材', 100, 500),
      steps: strings(data.steps, '步骤', 100, 2000),
      tags: Array.from(new Set(strings(data.tags, '标签', 50, 50))),
      images,
      image: images[0] || null,
      categoryId,
      categoryName: category ? category.name : '',
      chefNickname: owner && owner.nickname || old && old.chefNickname || '厨师',
      updatedAt: new Date()
    }
    doc.searchTokens = buildSearchTokens([doc.name, doc.description, doc.ingredients, doc.tags])
    if (old) {
      await db.collection('dishes').doc(id(payload.dishId)).update({ data: doc })
      await deleteFiles(filesOf(old).filter((file) => !images.includes(file)))
      return { dishId: payload.dishId }
    }
    const added = await db.collection('dishes').add({ data: Object.assign(doc, { _openid: openid, createdAt: new Date() }) })
    return { dishId: added._id }
  }

  async function dishDelete(payload, openid) {
    const role = await getRole(openid)
    const dish = await read('dishes', payload.dishId)
    if (!dish) fail('菜品不存在')
    if (dish._openid !== openid && role !== 'admin') fail('只能删除自己的菜品')
    await removeMatching('comments', { dishId: payload.dishId })
    await db.collection('dishes').doc(payload.dishId).remove()
    await deleteFiles(filesOf(dish))
    return true
  }

  return { dishSave, dishDelete }
}
