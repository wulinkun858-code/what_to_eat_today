// 按业务域组织的数据访问；通过 utils/db.js 保持页面接口兼容。
const { database, collection, queryPage, MAX_LIMIT } = require('../collection')
const { reportError } = require('../errors')
const biz = require('../biz')
const tokenizer = require('../tokenizer')
const { BANNER_MAX } = require('./banners')

function buildWhere(tokens, category) {
  const conds = []
  if (category) conds.push({ categoryId: category })
  if (tokens && tokens.length) {
    // 词元等值 AND：命中文档必须包含关键词的全部词元
    conds.push(database().command.and(tokens.map((token) => ({ searchTokens: token }))))
  }
  if (!conds.length) return {}
  return conds.length === 1 ? conds[0] : database().command.and(conds)
}

function getDishes({ keyword, category, page } = {}) {
  // 分词一次复用（buildWhere 与判空共用）；纯符号关键词直接返回空
  const tokens = keyword ? tokenizer.buildSearchTokens([keyword]) : []
  if (keyword && !tokens.length) {
    return Promise.resolve({ list: [], total: 0 })
  }
  const where = buildWhere(tokens, category || '')
  return queryPage(collection('dishes').where(where).orderBy('updatedAt', 'desc'), page, { name: true, description: true, tags: true, image: true, chefNickname: true, _openid: true, categoryName: true })
    .catch((err) => reportError(err, '加载失败，请稍后重试'))
}

function getDishDoc(id) {
  return collection('dishes').where({ _id: id })
    .limit(1)
    .get()
    .then((res) => res.data[0] || null)
}

function getDish(id) {
  return getDishDoc(id).then((doc) => {
    if (!doc) throw new Error('菜品不存在或无权查看')
    return doc
  }).catch((err) => reportError(err, '加载失败，请稍后重试'))
}

function addDish(data) {
  return biz.call('dishSave', { dish: data }).then((res) => res.dishId)
}

function updateDish(id, data) {
  return biz.call('dishSave', { dishId: id, dish: data }).then((res) => res.dishId)
}

function removeDish(id) {
  return biz.call('dishDelete', { dishId: id })
}

function getAllTags() {
  const counts = Object.create(null)
  function loop(skip) {
    return collection('dishes').field({ tags: true })
      .skip(skip)
      .limit(MAX_LIMIT)
      .get()
      .then((res) => {
        res.data.forEach((doc) => {
          (doc.tags || []).forEach((tag) => {
            counts[tag] = (counts[tag] || 0) + 1
          })
        })
        if (res.data.length < MAX_LIMIT) {
          return Object.keys(counts).sort((a, b) => counts[b] - counts[a])
        }
        return loop(skip + MAX_LIMIT)
      })
  }
  return loop(0).catch((err) => reportError(err, '标签加载失败'))
}

function getRecentDishesWithImage(limit) {
  return collection('dishes').where({ image: database().command.neq(null) })
    .field({ name: true, image: true, chefNickname: true })
    .orderBy('updatedAt', 'desc')
    .limit(limit || BANNER_MAX)
    .get()
    .then((res) => res.data)
}

function getStats() {
  return Promise.all([
    collection('dishes').count().catch(() => ({ total: 0 })),
    getAllTags().catch(() => [])
  ]).then(([countRes, tags]) => ({
    dishCount: countRes.total,
    tagCount: tags.length
  }))
}

module.exports = { getDishes, getDish, addDish, updateDish, removeDish, getAllTags, getRecentDishesWithImage, getStats }
