const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, page, deferred } = require('./helpers/client')
const { loadPage, dispose } = require('../utils/pagination')
const { formatRelative } = require('../utils/format')
const { groupByChef } = require('../utils/order')
const { createEmitter } = require('../utils/emitter')

test('分页丢弃过期响应、追加去重、失败保留旧页、卸载后不更新', async () => {
  const target = { data: { list: [], page: 1 }, setData(patch) { Object.assign(this.data, patch) } }
  const old = deferred()
  const first = loadPage(target, 1, () => old.promise)
  await loadPage(target, 1, async () => ({ list: [{ _id: 'new' }], total: 3 }))
  old.resolve({ list: [{ _id: 'old' }], total: 1 })
  await first
  assert.equal(target.data.list[0]._id, 'new')
  await loadPage(target, 2, async () => ({ list: [{ _id: 'new' }, { _id: 'next' }], total: 3 }))
  assert.equal(target.data.list.length, 2)
  await loadPage(target, 3, async () => { throw new Error('failure') })
  assert.equal(target.data.page, 2)
  const pending = deferred()
  const task = loadPage(target, 1, () => pending.promise)
  dispose(target)
  pending.resolve({ list: [], total: 0 })
  await task
  assert.equal(target.data.list.length, 2)
})

test('购物车过滤损坏缓存，按 ID 去重，提交标识跨重试复用，改菜后更新', () => {
  const storage = new Map([['order_cart', 'invalid']])
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key) => storage.delete(key)
  }
  const cart = load('utils/cart.js', {}, { wx })
  assert.equal(cart.count(), 0)
  cart.add({ _id: 'a', _openid: 'chef' })
  assert.equal(cart.add({ _id: 'a' }).added, false)
  const id = cart.submissionId()
  assert.equal(cart.submissionId(), id)
  cart.getItems()[0]._id = 'changed'
  assert.equal(cart.getItems()[0]._id, 'a')
  cart.add({ _id: 'b' })
  assert.notEqual(cart.submissionId(), id)
  assert.equal(cart.getItems()[0].chefOpenid, 'chef')
})

test('同名厨师按身份分组，特殊昵称不会碰撞对象原型', () => {
  const groups = groupByChef([
    { chefOpenid: '1', chefNickname: '同名' }, { chefOpenid: '2', chefNickname: '同名' },
    { chefNickname: '__proto__' }
  ])
  assert.equal(groups.length, 3)
})

test('订阅回调中退订不会跳过下一个订阅者', () => {
  const events = createEmitter()
  const seen = []
  const off = events.subscribe(() => { seen.push(1); off() })
  events.subscribe(() => seen.push(2))
  events.emit()
  assert.deepEqual(seen, [1, 2])
})

test('相对时间同时识别云函数 ISO 字符串与数据库 Date', () => {
  const now = Date.parse('2026-10-23T08:00:00Z')
  const date = new Date(now - 60000)
  assert.equal(formatRelative(date, now), '1 分钟前')
  assert.equal(formatRelative(date.toISOString(), now), '1 分钟前')
  assert.equal(formatRelative('invalid', now), '')
})

test('编辑页等分类加载后回填，移除旧图片只改草稿，未保存新图离开时清理', async () => {
  const categories = deferred()
  const removed = []
  let dishReads = 0
  const target = page('pages/edit/edit.js', {
    '../../utils/db': {
      getCategories: () => categories.promise,
      getDish: async () => { dishReads += 1; return { name: '菜', categoryId: 'rice', images: ['cloud://old'] } },
      deleteCloudFile: async (files) => removed.push(files)
    }
  }, { wx: { setNavigationBarTitle() {} } })
  const ready = target.onLoad({ id: 'a' })
  assert.equal(dishReads, 0)
  categories.resolve([{ _id: 'rice', name: '主食' }])
  await ready
  assert.equal(target.data.categoryIndex, 0)
  target.onRemoveImage({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(removed.length, 0)
  target._uploadedFiles.add('cloud://new')
  target.onUnload()
  assert.deepEqual(Array.from(removed[0]), ['cloud://new'])
})

test('编辑详情读取失败禁止保存，保存请求在途离开不删除上传文件', async () => {
  let writes = 0
  let deletes = 0
  const request = deferred()
  const target = page('pages/edit/edit.js', {
    '../../utils/db': {
      getCategories: async () => [], getDish: async () => { throw new Error('load failed') },
      updateDish: () => { writes += 1; return request.promise }, deleteCloudFile: async () => { deletes += 1 }
    }
  }, { wx: { setNavigationBarTitle() {}, showToast() {} } })
  await target.onLoad({ id: 'a' })
  target.data.name = '菜'
  target.onSubmit()
  assert.equal(writes, 0)
  target.data.loadFailed = false
  target.data.imagePreviews = ['cloud://new']
  target._uploadedFiles.add('cloud://new')
  const saved = target.onSubmit()
  target._disposed = true
  target.onUnload()
  assert.equal(deletes, 0)
  request.resolve('a')
  await saved
  assert.equal(target._uploadedFiles.size, 0)
  assert.equal(deletes, 0)
})

test('页面权限等待身份刷新，销毁后 setData 不再触发视图更新', async () => {
  const profile = deferred()
  let shown = 0
  let updates = 0
  const { definePage } = load('utils/page.js', {
    './theme': { sync() {} }, './role': { ensureProfile: () => profile.promise, isAdmin: () => true }
  })
  const target = Object.assign({ setData() { updates += 1 } }, definePage({ onShow() { shown += 1 } }, 'admin'))
  target.onLoad()
  const task = target.onShow()
  assert.equal(shown, 0)
  profile.resolve()
  await task
  assert.equal(shown, 1)
  const beforeUnload = updates
  target.onUnload()
  target.setData({ value: 1 })
  assert.equal(updates, beforeUnload)
})

test('客户端服务可以在 cloud.init 之前加载，不在模块顶层访问数据库', () => {
  assert.doesNotThrow(() => require('../utils/db'))
})

test('保存结果因网络中断而未知时，离开页面不能删除可能已保存的图片', async () => {
  let deletes = 0
  const target = page('pages/edit/edit.js', {
    '../../utils/db': {
      getCategories: async () => [],
      addDish: async () => { throw new Error('network disconnected after server write') },
      deleteCloudFile: async () => { deletes += 1 }
    }
  }, { wx: { setNavigationBarTitle() {} } })
  await target.onLoad({})
  target.data.name = '菜'
  target.data.imagePreviews = ['cloud://new']
  target._uploadedFiles.add('cloud://new')
  await target.onSubmit()
  target.onUnload()
  assert.equal(deletes, 0)
})

test('发送评论防重复，并保留发送期间新输入的草稿', async () => {
  const request = deferred()
  let sends = 0
  const target = page('pages/detail/detail.js', {
    '../../utils/db': { COMMENT_MAX_LENGTH: 200, addComment: () => { sends += 1; return request.promise } },
    '../../utils/haptic': { light() {} }
  })
  target.data.commentDraft = '第一条'
  const task = target.onCmtSend()
  target.onCmtSend()
  target.data.commentDraft = '第二条草稿'
  request.resolve('new-comment')
  await task
  assert.equal(sends, 1)
  assert.equal(target.data.commentDraft, '第二条草稿')
  assert.equal(target.data.commentList.length, 1)
  assert.equal(target.data.commentSending, false)
})
