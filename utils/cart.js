// utils/cart.js
// 点菜单（报餐购物车）：无价格无数量，菜品集合去重，本地持久化
// v4：增加订阅能力，底部 Dock 无需页面传值即可实时反映数量
const KEY = 'order_cart'
const SUBMISSION_KEY = 'order_cart_submission'

const { createEmitter } = require('./emitter')
const events = createEmitter()

function getItems() {
  const items = wx.getStorageSync(KEY)
  if (!Array.isArray(items)) return []
  const seen = new Set()
  return items.filter((item) => {
    if (!item || typeof item._id !== 'string' || !item._id || seen.has(item._id)) return false
    seen.add(item._id)
    return true
  }).map((item) => Object.assign({}, item))
}

function save(items) {
  const before = getItems().map((item) => item._id).sort().join('\n')
  const after = items.map((item) => item._id).sort().join('\n')
  wx.setStorageSync(KEY, items)
  if (before !== after) wx.removeStorageSync(SUBMISSION_KEY)
  events.emit(items.length)
  return items
}

/**
 * 加入点菜单（按 _id 去重）
 * @param {Object} dish 菜品文档（含 _id/name/image/chefNickname）
 * @returns {{added: boolean, count: number}}
 */
function add(dish) {
  if (!dish || !dish._id) return { added: false, count: getItems().length }
  const items = getItems()
  if (items.some((item) => item._id === dish._id)) {
    return { added: false, count: items.length }
  }
  items.push({
    _id: dish._id,
    name: dish.name,
    image: dish.image || '',
    chefNickname: dish.chefNickname || '',
    chefOpenid: dish._openid || dish.chefOpenid || ''
  })
  return { added: true, count: save(items).length }
}

/**
 * 移除单道菜
 * @param {string} dishId
 */
function remove(dishId) {
  return save(getItems().filter((item) => item._id !== dishId))
}

// 一次提交只清掉这次已报餐的菜；页面离开后新加入的菜保留，并只通知一次。
function removeMany(dishIds) {
  const submitted = new Set(dishIds)
  return save(getItems().filter((item) => !submitted.has(item._id)))
}

function clear() {
  return save([])
}

function count() {
  return getItems().length
}

function has(dishId) {
  return getItems().some((item) => item._id === dishId)
}

// 同一份点菜单在网络失败、返回页面后重试仍使用同一个提交标识。
function submissionId() {
  const signature = getItems().map((item) => item._id).sort().join('\n')
  const saved = wx.getStorageSync(SUBMISSION_KEY)
  if (saved && saved.signature === signature && typeof saved.id === 'string') return saved.id
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  wx.setStorageSync(SUBMISSION_KEY, { signature, id })
  return id
}

/**
 * 订阅数量变化（底部 Dock 用）
 * @param {function(number):void} fn
 * @returns {function} 取消订阅
 */
function subscribe(fn) {
  return events.subscribe(fn)
}

module.exports = { getItems, add, remove, removeMany, clear, count, has, subscribe, submissionId }
