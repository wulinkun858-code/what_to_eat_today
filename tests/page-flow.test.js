const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, page, deferred } = require('./helpers/client')

// 只验证页面状态机与导航调用；不把模拟时钟当作微信渲染或帧率验证。
function createClock() {
  let now = 0
  let nextId = 0
  const tasks = new Map()

  function schedule(callback, delay, interval) {
    const id = ++nextId
    tasks.set(id, { callback, at: now + (Number(delay) || 0), interval })
    return id
  }

  function advance(duration) {
    const end = now + duration
    let runs = 0
    for (;;) {
      const next = [...tasks].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!next || next[1].at > end) break
      assert.ok(runs++ < 1000, '计时任务应在有限步数内结束')
      const [id, task] = next
      now = task.at
      if (task.interval) task.at += task.interval
      else tasks.delete(id)
      task.callback()
    }
    now = end
  }

  return {
    get now() { return now },
    get size() { return tasks.size },
    setTimeout: (callback, delay) => schedule(callback, delay, 0),
    clearTimeout: (id) => tasks.delete(id),
    setInterval: (callback, delay) => schedule(callback, delay, Math.max(1, Number(delay) || 0)),
    clearInterval: (id) => tasks.delete(id),
    advance,
    finish() {
      let rounds = 0
      while (tasks.size) {
        assert.ok(rounds++ < 1000, '页面不能遗留无限计时任务')
        const nextAt = Math.min(...[...tasks.values()].map((task) => task.at))
        advance(nextAt - now)
      }
    }
  }
}

async function flushPromises() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function createHarness(file, options = {}) {
  const clock = createClock()
  const navigations = []
  const modals = []
  const toasts = []
  const stack = []
  let reduce = !!options.reduce
  const navigation = { ready() {} }
  for (const method of ['navigateTo', 'navigateBack', 'redirectTo', 'switchTab']) {
    navigation[method] = (...args) => {
      navigations.push({ method, args })
      return true
    }
  }
  const role = Object.assign({
    ensureProfile: async () => {}, getProfile: () => ({}),
    isAdmin: () => false, isChef: () => false, isOpenid: () => false,
    roleLabel: () => '食客'
  }, options.role)
  const theme = {
    sync(target) { target.setData({ theme: 'paper', reduce }) },
    getTheme: () => ({ accent: '#2E6558' }),
    setReduceMotion(value) {
      reduce = !!value
      stack.forEach((target) => target.setData({ reduce }))
    }
  }
  const globals = {
    wx: {
      setNavigationBarTitle() {}, showToast: (value) => toasts.push(value),
      showModal: (value) => modals.push(value)
    },
    getCurrentPages: () => stack,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    Date: class extends Date {
      constructor(...args) {
        if (args.length) super(...args)
        else super(clock.now)
      }
      static now() { return clock.now }
    }
  }
  const lifecycle = load('utils/page.js', {
    './theme': theme, './role': role, './navigation': navigation
  }, globals)
  const db = Object.assign({
    COMMENT_MAX_LENGTH: 200,
    getCategories: async () => [], getDish: async () => ({ _id: 'dish', name: '一道菜' }),
    getDishComments: async () => ({ list: [], total: 0 }), deleteCloudFile: async () => {},
    getStats: async () => ({ dishCount: 0, tagCount: 0 })
  }, options.db)
  const target = page(file, {
    '../../utils/page': lifecycle,
    '../../utils/db': db,
    '../../utils/role': role,
    '../../utils/theme': theme,
    '../../utils/navigation': navigation,
    '../../utils/haptic': { light() {}, medium() {} },
    '../../utils/ui': { getNavMetrics: () => ({ statusBarHeight: 20 }) },
    '../../utils/cart': options.cart || { has: () => false },
    '../../utils/biz': options.biz || {}
  }, globals)
  stack.push(target)
  return {
    target, clock, navigations, modals, toasts,
    async start(args = {}) {
      await target.onLoad(args)
      await target.onShow()
      await flushPromises()
    },
    hide() { if (target.onHide) target.onHide() },
    async show() { await target.onShow(); await flushPromises() },
    unload() { target.onUnload(); stack.splice(stack.indexOf(target), 1) }
  }
}

function createCart(initial) {
  let items = initial.slice()
  return {
    getItems: () => items.slice(),
    add: (item) => { if (!items.some((entry) => entry._id === item._id)) items.push(item) },
    remove: (id) => { items = items.filter((item) => item._id !== id) },
    removeMany: (ids) => {
      const removed = new Set(ids)
      items = items.filter((item) => !removed.has(item._id))
    },
    clear: () => { items = [] },
    submissionId: () => 'submission-request'
  }
}

test('保存成功等待返回期间再次点击不会重复新建或遗留第二个返回任务', async () => {
  let writes = 0
  const harness = createHarness('pages/edit/edit.js', {
    db: { addDish: async () => { writes += 1; return 'new-dish' } }
  })
  await harness.start()
  harness.target.setData({ name: '清蒸鱼' })
  await harness.target.onSubmit()
  await harness.target.onSubmit()
  assert.equal(writes, 1)
  harness.clock.finish()
  assert.equal(harness.navigations.length, 1)
  assert.equal(harness.navigations[0].method, 'navigateBack')
  harness.unload()
  assert.equal(harness.clock.size, 0)
})

test('保存成功后隐藏会取消延迟返回，再次显示才恢复返回', async () => {
  const harness = createHarness('pages/edit/edit.js', { db: { addDish: async () => 'new-dish' } })
  await harness.start()
  harness.target.setData({ name: '清蒸鱼' })
  await harness.target.onSubmit()
  harness.hide()
  assert.equal(harness.clock.size, 0)
  harness.clock.advance(1000)
  assert.equal(harness.navigations.length, 0)
  await harness.show()
  harness.clock.finish()
  assert.equal(harness.navigations.length, 1)
  harness.unload()
})

test('后台收到保存成功不导航，返回前台后完成返回', async () => {
  const saved = deferred()
  const harness = createHarness('pages/edit/edit.js', { db: { addDish: () => saved.promise } })
  await harness.start()
  harness.target.setData({ name: '清蒸鱼' })
  const task = harness.target.onSubmit()
  harness.hide()
  saved.resolve('new-dish')
  await task
  assert.equal(harness.clock.size, 0)
  assert.equal(harness.navigations.length, 0)
  await harness.show()
  harness.clock.finish()
  assert.equal(harness.navigations.length, 1)
  harness.unload()
})

test('减少动效保存成功直接返回，不保留展示等待', async () => {
  const harness = createHarness('pages/edit/edit.js', {
    reduce: true, db: { addDish: async () => 'new-dish' }
  })
  await harness.start()
  harness.target.setData({ name: '清蒸鱼' })
  await harness.target.onSubmit()
  harness.clock.advance(0)
  assert.equal(harness.navigations.length, 1)
  assert.equal(harness.clock.size, 0)
  harness.unload()
})

test('详情卸载后删除请求才成功，不创建返回任务也不影响其他页面', async () => {
  const removed = deferred()
  const harness = createHarness('pages/detail/detail.js', { db: { removeDish: () => removed.promise } })
  await harness.start({ id: 'dish' })
  harness.target.onDeleteTap()
  harness.modals[0].success({ confirm: true })
  harness.unload()
  removed.resolve()
  await flushPromises()
  assert.equal(harness.clock.size, 0)
  harness.clock.finish()
  assert.equal(harness.navigations.length, 0)
})

test('后台收到详情删除成功，重新显示后再返回', async () => {
  const removed = deferred()
  const harness = createHarness('pages/detail/detail.js', { db: { removeDish: () => removed.promise } })
  await harness.start({ id: 'dish' })
  harness.target.onDeleteTap()
  harness.modals[0].success({ confirm: true })
  harness.hide()
  removed.resolve()
  await flushPromises()
  assert.equal(harness.clock.size, 0)
  assert.equal(harness.navigations.length, 0)
  await harness.show()
  harness.clock.finish()
  assert.equal(harness.navigations.length, 1)
  harness.unload()
})

test('详情已删除但尚未返回时隐藏，旧返回任务取消且重新显示可收尾', async () => {
  const harness = createHarness('pages/detail/detail.js', { db: { removeDish: async () => {} } })
  await harness.start({ id: 'dish' })
  harness.target.onDeleteTap()
  harness.modals[0].success({ confirm: true })
  await flushPromises()
  harness.hide()
  assert.equal(harness.clock.size, 0)
  harness.clock.advance(1000)
  assert.equal(harness.navigations.length, 0)
  await harness.show()
  harness.clock.finish()
  assert.equal(harness.navigations.length, 1)
  harness.unload()
})

test('最后一道菜移除出场时不提交空订单，隐藏后列表恢复终态', async () => {
  let submissions = 0
  const cart = createCart([{ _id: 'dish', chefNickname: '掌勺人' }])
  const harness = createHarness('pages/order-confirm/order-confirm.js', {
    cart, biz: { call: async () => { submissions += 1; return { orderId: 'order' } } }
  })
  await harness.start()
  harness.target.onRemoveTap({ currentTarget: { dataset: { id: 'dish' } } })
  await harness.target.onSubmit()
  assert.equal(cart.getItems().length, 0)
  assert.equal(submissions, 0)
  harness.hide()
  assert.equal(harness.clock.size, 0)
  await harness.show()
  assert.equal(harness.target.data.total, 0)
  assert.equal(harness.target.data.removingId, '')
  harness.unload()
})

test('确认页显示数量过期时，仍以真实购物车阻止空订单', async () => {
  let submissions = 0
  const harness = createHarness('pages/order-confirm/order-confirm.js', {
    cart: createCart([]),
    biz: { call: async () => { submissions += 1; return { orderId: 'order' } } }
  })
  await harness.start()
  harness.target.setData({ total: 1 })
  await harness.target.onSubmit()
  assert.equal(submissions, 0)
  harness.unload()
})

test('后台收到下单成功不发起跳转，返回前台只跳转一次', async () => {
  const submitted = deferred()
  const cart = createCart([{ _id: 'dish', chefNickname: '掌勺人' }])
  const harness = createHarness('pages/order-confirm/order-confirm.js', {
    cart, biz: { call: () => submitted.promise }
  })
  await harness.start()
  const task = harness.target.onSubmit()
  harness.hide()
  submitted.resolve({ orderId: 'created-order' })
  await task
  assert.equal(cart.getItems().length, 0)
  assert.equal(harness.clock.size, 0)
  assert.equal(harness.navigations.length, 0)
  await harness.show()
  harness.clock.finish()
  assert.equal(harness.navigations.length, 1)
  assert.equal(harness.navigations[0].method, 'redirectTo')
  assert.match(JSON.stringify(harness.navigations[0].args), /created-order/)
  harness.unload()
})

test('离开确认页后旧订单才成功，保留此后新选的菜品', async () => {
  const submitted = deferred()
  const cart = createCart([{ _id: 'submitted-dish', chefNickname: '掌勺人' }])
  const harness = createHarness('pages/order-confirm/order-confirm.js', {
    cart, biz: { call: () => submitted.promise }
  })
  await harness.start()
  const task = harness.target.onSubmit()
  harness.unload()
  cart.add({ _id: 'new-dish', chefNickname: '掌勺人' })
  submitted.resolve({ orderId: 'created-order' })
  await task
  assert.deepEqual(cart.getItems().map((item) => item._id), ['new-dish'])
  assert.equal(harness.clock.size, 0)
  assert.equal(harness.navigations.length, 0)
})

test('落单印章展示时隐藏会清理跳转等待，重新显示后可完成跳转', async () => {
  const harness = createHarness('pages/order-confirm/order-confirm.js', {
    cart: createCart([{ _id: 'dish', chefNickname: '掌勺人' }]),
    biz: { call: async () => ({ orderId: 'created-order' }) }
  })
  await harness.start()
  await harness.target.onSubmit()
  harness.hide()
  assert.equal(harness.clock.size, 0)
  harness.clock.advance(1000)
  assert.equal(harness.navigations.length, 0)
  await harness.show()
  harness.clock.finish()
  assert.equal(harness.navigations.length, 1)
  harness.unload()
})

test('减少动效下单成功立即打开食单，不等待印章动画', async () => {
  const harness = createHarness('pages/order-confirm/order-confirm.js', {
    reduce: true,
    cart: createCart([{ _id: 'dish', chefNickname: '掌勺人' }]),
    biz: { call: async () => ({ orderId: 'created-order' }) }
  })
  await harness.start()
  await harness.target.onSubmit()
  harness.clock.advance(0)
  assert.equal(harness.navigations.length, 1)
  assert.equal(harness.clock.size, 0)
  harness.unload()
})

test('数字滚动中启用减少动效立即显示目标并清理后续计时', async () => {
  const harness = createHarness('pages/my/my.js', {
    db: { getStats: async () => ({ dishCount: 100, tagCount: 20 }) }
  })
  await harness.start()
  assert.ok(harness.clock.size > 0)
  harness.clock.advance(64)
  assert.ok(harness.target.data.dishCount > 0 && harness.target.data.dishCount < 100)
  harness.target.onReduceToggle()
  assert.equal(harness.target.data.reduce, true)
  assert.equal(harness.target.data.dishCount, 100)
  assert.equal(harness.target.data.tagCount, 20)
  assert.equal(harness.clock.size, 0)
  harness.unload()
})

function highlightedOrders() {
  return { list: [{ _id: 'new-order', status: 'pending', items: [] }], total: 1 }
}

test('食单高亮中隐藏会结束动画，返回页面不重复高亮', async () => {
  const harness = createHarness('pages/my-orders/my-orders.js', {
    db: { getMyOrders: async () => highlightedOrders() }
  })
  await harness.start({ highlight: 'new-order' })
  assert.equal(harness.target.data.highlightId, 'new-order')
  assert.equal(harness.clock.size, 1)
  harness.hide()
  assert.equal(harness.clock.size, 0)
  assert.equal(harness.target.data.highlightId, '')
  harness.clock.advance(3000)
  await harness.show()
  assert.equal(harness.clock.size, 0)
  assert.equal(harness.target.data.highlightId, '')
  harness.unload()
})

test('隐藏时食单响应到达不创建高亮等待，重新显示后只呈现一次', async () => {
  const orders = deferred()
  const harness = createHarness('pages/my-orders/my-orders.js', {
    db: { getMyOrders: () => orders.promise }
  })
  await harness.start({ highlight: 'new-order' })
  harness.hide()
  orders.resolve(highlightedOrders())
  await flushPromises()
  assert.equal(harness.clock.size, 0)
  assert.equal(harness.target.data.highlightId, '')
  await harness.show()
  assert.equal(harness.target.data.highlightId, 'new-order')
  assert.equal(harness.clock.size, 1)
  harness.clock.finish()
  assert.equal(harness.target.data.highlightId, '')
  await harness.show()
  assert.equal(harness.clock.size, 0)
  harness.unload()
})

test('食单卸载清理已有高亮等待，并隔离晚到响应', async () => {
  const active = createHarness('pages/my-orders/my-orders.js', {
    db: { getMyOrders: async () => highlightedOrders() }
  })
  await active.start({ highlight: 'new-order' })
  assert.equal(active.clock.size, 1)
  active.unload()
  assert.equal(active.clock.size, 0)

  const orders = deferred()
  const pending = createHarness('pages/my-orders/my-orders.js', {
    db: { getMyOrders: () => orders.promise }
  })
  await pending.start({ highlight: 'new-order' })
  pending.unload()
  orders.resolve(highlightedOrders())
  await flushPromises()
  assert.equal(pending.clock.size, 0)
  assert.equal(pending.target.data.highlightId, '')
  assert.equal(pending.target.data.list.length, 0)
})

test('减少动效食单保留静态订单标记，不创建高亮计时器', async () => {
  const harness = createHarness('pages/my-orders/my-orders.js', {
    reduce: true, db: { getMyOrders: async () => highlightedOrders() }
  })
  await harness.start({ highlight: 'new-order' })
  assert.equal(harness.target.data.highlightId, 'new-order')
  assert.equal(harness.clock.size, 0)
  harness.clock.advance(10000)
  assert.equal(harness.target.data.highlightId, 'new-order')
  harness.unload()
})

test('页面等待权限期间隐藏，迟到结果不执行页面展示或导航', async () => {
  for (const allowed of [true, false]) {
    const profile = deferred()
    let shown = 0
    let hidden = 0
    const navigations = []
    const { definePage } = load('utils/page.js', {
      './theme': { sync() {} },
      './role': { ensureProfile: () => profile.promise, isAdmin: () => allowed },
      './navigation': {
        ready() {},
        navigateBack: () => navigations.push('back'),
        switchTab: () => navigations.push('tab')
      }
    }, { wx: { showToast: () => navigations.push('toast') }, getCurrentPages: () => [] })
    const target = Object.assign({ data: {}, setData(patch) { Object.assign(this.data, patch) } }, definePage({
      onShow() { shown += 1 }, onHide() { hidden += 1 }
    }, 'admin'))
    target.onLoad()
    const task = target.onShow()
    target.onHide()
    profile.resolve()
    await task
    assert.equal(hidden, 1)
    assert.equal(shown, 0)
    assert.equal(navigations.length, 0)
    target.onUnload()
  }
})
