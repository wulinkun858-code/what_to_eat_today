const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')

function createClock() {
  let now = 0
  let nextId = 0
  const tasks = new Map()
  return {
    get size() { return tasks.size },
    setTimeout(callback, delay) {
      const id = ++nextId
      tasks.set(id, { callback, at: now + delay })
      return id
    },
    clearTimeout(id) { tasks.delete(id) },
    advance(duration) {
      const end = now + duration
      for (;;) {
        const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > end) break
        now = next[1].at
        tasks.delete(next[0])
        next[1].callback()
      }
      now = end
    }
  }
}

function createNavigation(routes = ['pages/list/list']) {
  const clock = createClock()
  const calls = []
  const toasts = []
  const errors = []
  let pages = routes.map((route) => ({ route }))
  const wx = { showToast: (options) => toasts.push(options) }
  for (const method of ['navigateTo', 'navigateBack', 'switchTab', 'redirectTo']) {
    wx[method] = (options) => calls.push({ method, options })
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/navigation.js'), 'utf8'), {
    module, wx,
    getCurrentPages: () => pages,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    console: { error: (...args) => errors.push(args) }
  }, { filename: 'utils/navigation.js' })
  return {
    navigation: module.exports, calls, toasts, errors, clock, wx,
    getPages: () => pages,
    setPages(routes) { pages = routes.map((route) => ({ route })) }
  }
}

function component(file, mocks, globals = {}) {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    Component(value) { definition = value },
    require(key) {
      assert.ok(Object.prototype.hasOwnProperty.call(mocks, key), `缺少模块替身 ${key}`)
      return mocks[key]
    },
    ...globals
  }, { filename: file })
  const instance = Object.assign({}, definition.methods, {
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch) }
  })
  return { definition, instance }
}

function protectedPage(harness, role, body = {}) {
  const module = { exports: {} }
  const mocks = {
    './theme': { sync() {} },
    './role': role,
    './navigation': harness.navigation
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/page.js'), 'utf8'), {
    module, wx: harness.wx, getCurrentPages: harness.getPages,
    require(key) { return mocks[key] }
  }, { filename: 'utils/page.js' })
  const definition = module.exports.definePage(body, 'admin')
  const instance = Object.assign({}, definition, {
    route: 'pages/admin-orders/admin-orders',
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch) }
  })
  instance.onLoad()
  return instance
}

test('导航在目标 onShow 先于原生 complete 时仍锁住，只调用 SDK 一次', () => {
  const { navigation, calls, clock } = createNavigation()
  assert.equal(navigation.navigateTo({ url: '/pages/detail/detail?id=a' }), true)
  navigation.ready('pages/detail/detail')
  assert.equal(navigation.navigateBack(), false)
  calls[0].options.success({ errMsg: 'navigateTo:ok' })
  assert.equal(navigation.redirectTo({ url: '/pages/edit/edit' }), false)
  assert.equal(calls.length, 1)
  calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  assert.equal(clock.size, 0)
  assert.equal(navigation.redirectTo({ url: '/pages/edit/edit' }), true)
})

test('原生 complete 先于目标 onShow 时，错误页面的 ready 不会提早解锁', () => {
  const { navigation, calls, clock } = createNavigation()
  navigation.navigateTo({ url: '/pages/detail/detail?id=a' })
  calls[0].options.success({ errMsg: 'navigateTo:ok' })
  calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  navigation.ready('pages/list/list')
  assert.equal(navigation.switchTab({ url: '/pages/my/my' }), false)
  navigation.ready('/pages/detail/detail')
  assert.equal(clock.size, 0)
  assert.equal(navigation.switchTab({ url: '/pages/my/my' }), true)
})

test('快速重复和跨方法请求返回 false，并完成拒绝请求的 fail/complete', () => {
  const { navigation, calls, toasts } = createNavigation()
  const callbacks = []
  const options = {
    url: '/pages/order-confirm/order-confirm',
    success: () => callbacks.push('success'),
    fail: (result) => callbacks.push(result.errMsg),
    complete: () => callbacks.push('complete')
  }
  assert.equal(navigation.navigateTo(options), true)
  assert.equal(navigation.navigateTo(options), false)
  assert.equal(navigation.redirectTo(options), false)
  assert.equal(calls.length, 1)
  assert.deepEqual(callbacks, [
    'navigateTo:fail navigation in progress', 'complete',
    'redirectTo:fail navigation in progress', 'complete'
  ])
  assert.equal(toasts.length, 0)
})

test('当前路由忽略前导斜杠与参数，重复 navigateTo/switchTab 不创建新页面', () => {
  const { navigation, calls, clock } = createNavigation(['pages/detail/detail'])
  const errors = []
  assert.equal(navigation.navigateTo({ url: '/pages/detail/detail?id=another', fail: (result) => errors.push(result.errMsg) }), false)
  assert.equal(navigation.switchTab({ url: 'pages/detail/detail#same' }), false)
  assert.equal(calls.length, 0)
  assert.equal(clock.size, 0)
  assert.match(errors[0], /already on target page/)
  // redirectTo 是替换页面，保留调用者主动替换同一路由的能力。
  assert.equal(navigation.redirectTo({ url: '/pages/detail/detail?id=new' }), true)
})

test('原生 fail 立即解锁，失败回调可以再次导航，旧 complete 不解开新锁', () => {
  const { navigation, calls, toasts, clock } = createNavigation()
  const callbacks = []
  navigation.navigateTo({
    url: '/pages/detail/detail',
    fail(result) {
      callbacks.push(result.errMsg)
      assert.equal(navigation.switchTab({ url: '/pages/my/my' }), true)
    },
    complete: () => callbacks.push('complete')
  })
  const old = calls[0].options
  old.fail({ errMsg: 'navigateTo:fail not found' })
  old.complete({ errMsg: 'navigateTo:fail not found' })
  assert.equal(toasts.length, 1)
  assert.equal(calls.length, 2)
  assert.equal(clock.size, 1)
  assert.equal(navigation.navigateTo({ url: '/pages/edit/edit' }), false)
  assert.deepEqual(callbacks, ['navigateTo:fail not found', 'complete'])
  navigation.ready('pages/my/my')
  calls[1].options.complete({ errMsg: 'switchTab:ok' })
  assert.equal(clock.size, 0)
})

test('SDK 同步抛错合成一次 fail/complete，并解除锁和有限计时器', () => {
  const harness = createNavigation()
  const { navigation, calls, toasts, clock, wx } = harness
  const seen = []
  wx.navigateTo = () => { throw new Error('native unavailable') }
  assert.equal(navigation.navigateTo({
    url: '/pages/detail/detail',
    fail: (result) => seen.push(result.errMsg),
    complete: (result) => seen.push(result.errMsg)
  }), true)
  assert.deepEqual(seen, [
    'navigateTo:fail native unavailable', 'navigateTo:fail native unavailable'
  ])
  assert.equal(toasts.length, 1)
  assert.equal(clock.size, 0)
  assert.equal(navigation.switchTab({ url: '/pages/my/my' }), true)
  assert.equal(calls.length, 1)
})

test('回调异常不会阻断 complete、遮断后续导航或修改原 SDK options', () => {
  const { navigation, calls, errors, clock } = createNavigation()
  let completed = 0
  const success = () => { throw new Error('page success failed') }
  const options = {
    url: '/pages/detail/detail?id=a',
    events: { updated() {} },
    success,
    complete() { completed += 1; throw new Error('page complete failed') }
  }
  navigation.navigateTo(options)
  assert.equal(options.success, success)
  assert.equal(calls[0].options.events, options.events)
  assert.doesNotThrow(() => calls[0].options.success({ errMsg: 'navigateTo:ok' }))
  navigation.ready('pages/detail/detail')
  assert.doesNotThrow(() => calls[0].options.complete({ errMsg: 'navigateTo:ok' }))
  calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  assert.equal(completed, 1)
  assert.equal(errors.length, 2)
  assert.equal(clock.size, 0)
  assert.equal(navigation.switchTab({ url: '/pages/my/my' }), true)
})

test('失败回调抛错仍执行 complete；合成拒绝回调抛错也不影响共享锁', () => {
  const { navigation, calls, errors, clock } = createNavigation()
  let completed = 0
  const options = {
    url: '/pages/detail/detail',
    fail() { throw new Error('page fail failed') },
    complete() { completed += 1 }
  }
  navigation.navigateTo(options)
  assert.equal(navigation.navigateTo(options), false)
  assert.equal(completed, 1)
  calls[0].options.fail({ errMsg: 'navigateTo:fail unavailable' })
  calls[0].options.complete({ errMsg: 'navigateTo:fail unavailable' })
  assert.equal(completed, 2)
  assert.equal(errors.length, 2)
  assert.equal(clock.size, 0)
  assert.equal(navigation.switchTab({ url: '/pages/my/my' }), true)
})

test('有限看门狗只解锁，不自发再次跳转；迟到回调不能解开新的请求', () => {
  const { navigation, calls, clock } = createNavigation()
  navigation.navigateTo({ url: '/pages/detail/detail' })
  clock.advance(1499)
  assert.equal(navigation.switchTab({ url: '/pages/my/my' }), false)
  clock.advance(1)
  assert.equal(calls.length, 1)
  assert.equal(clock.size, 0)
  assert.equal(navigation.switchTab({ url: '/pages/my/my' }), true)
  const old = calls[0].options
  old.success({ errMsg: 'navigateTo:ok' })
  old.complete({ errMsg: 'navigateTo:ok' })
  navigation.ready('pages/detail/detail')
  assert.equal(navigation.redirectTo({ url: '/pages/edit/edit' }), false)
  assert.equal(calls.length, 2)
  navigation.ready('pages/my/my')
  calls[1].options.complete({ errMsg: 'switchTab:ok' })
  assert.equal(clock.size, 0)
})

test('后退依据实际栈和 delta 等待正确目标，单页入口回首页', () => {
  const { navigation, calls, clock } = createNavigation([
    'pages/list/list', 'pages/detail/detail', 'pages/edit/edit'
  ])
  navigation.navigateBack({ delta: 99 })
  assert.equal(calls[0].method, 'navigateBack')
  assert.equal(calls[0].options.delta, 2)
  calls[0].options.complete({ errMsg: 'navigateBack:ok' })
  navigation.ready('pages/detail/detail')
  assert.equal(clock.size, 1)
  navigation.ready('pages/list/list')
  assert.equal(clock.size, 0)

  const single = createNavigation(['pages/detail/detail'])
  assert.equal(single.navigation.navigateBack(), true)
  assert.equal(single.calls[0].method, 'switchTab')
  assert.equal(single.calls[0].options.url, '/pages/list/list')
  single.navigation.ready('pages/list/list')
  single.calls[0].options.complete({ errMsg: 'switchTab:ok' })
  assert.equal(single.clock.size, 0)
  const home = createNavigation()
  assert.equal(home.navigation.navigateBack(), false)
  assert.equal(home.calls.length, 0)
})

test('成功 complete 中的后续导航在双阶段完成后可以继续', () => {
  const { navigation, calls } = createNavigation()
  let accepted
  navigation.navigateTo({
    url: '/pages/detail/detail',
    complete() { accepted = navigation.redirectTo({ url: '/pages/edit/edit' }) }
  })
  navigation.ready('pages/detail/detail')
  calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  assert.equal(accepted, true)
  assert.deepEqual(calls.map((call) => call.method), ['navigateTo', 'redirectTo'])
})

test('Dock 初次显示与重新显示按当前路由选中，失败时不提前移动指示器', () => {
  const harness = createNavigation(['pages/comments/comments'])
  const { navigation, calls, getPages, setPages } = harness
  const { definition, instance } = component('custom-tab-bar/index.js', {
    '../utils/navigation': navigation,
    '../utils/theme': { getTheme: () => ({ key: 'ink' }), isReduceMotion: () => false, subscribe: () => () => {} },
    '../utils/haptic': { light() {} },
    '../utils/cart': { count: () => 1, subscribe: () => () => {} }
  }, { getCurrentPages: getPages })
  definition.attached.call(instance)
  assert.equal(instance.data.selected, 1)
  const tap = { currentTarget: { dataset: { path: '/pages/my/my', index: 2 } } }
  assert.equal(instance.switchTab(tap), true)
  assert.equal(instance.data.selected, 1)
  calls[0].options.fail({ errMsg: 'switchTab:fail unavailable' })
  calls[0].options.complete({ errMsg: 'switchTab:fail unavailable' })
  assert.equal(instance.data.selected, 1)
  setPages(['pages/my/my'])
  definition.pageLifetimes.show.call(instance)
  assert.equal(instance.data.selected, 2)
  definition.detached.call(instance)
})

test('Dock 点菜单和自定义返回共用进行中锁，空点菜单保留原行为', () => {
  const harness = createNavigation(['pages/list/list', 'pages/detail/detail'])
  const { navigation, calls, getPages } = harness
  const dock = component('custom-tab-bar/index.js', {
    '../utils/navigation': navigation,
    '../utils/theme': {}, '../utils/haptic': { light() {} }, '../utils/cart': {}
  }, { getCurrentPages: getPages }).instance
  assert.equal(dock.goCart(), undefined)
  assert.equal(calls.length, 0)
  dock.data.cartCount = 1
  assert.equal(dock.goCart(), true)
  assert.equal(dock.goCart(), false)
  const bar = component('components/nav-bar/index.js', {
    '../../utils/navigation': navigation, '../../utils/theme': {}, '../../utils/ui': {}
  }).instance
  assert.equal(bar.onBack(), false)
  assert.equal(calls.length, 1)
  calls[0].options.fail({ errMsg: 'navigateTo:fail unavailable' })
  calls[0].options.complete({ errMsg: 'navigateTo:fail unavailable' })
  assert.equal(bar.onBack(), true)
  assert.equal(bar.onBack(), false)
  assert.deepEqual(calls.map((call) => call.method), ['navigateTo', 'navigateBack'])
})

test('whenIdle 在空闲时立即执行、忙时只执行一次，取消函数可重复调用', () => {
  const { navigation, calls } = createNavigation()
  let immediate = 0
  const cancelImmediate = navigation.whenIdle(() => immediate++)
  assert.equal(immediate, 1)
  cancelImmediate()
  cancelImmediate()
  navigation.navigateTo({ url: '/pages/detail/detail' })
  let deferred = 0
  let cancelled = 0
  navigation.whenIdle(() => deferred++)
  const cancel = navigation.whenIdle(() => cancelled++)
  cancel()
  cancel()
  navigation.ready('pages/detail/detail')
  assert.equal(deferred, 0)
  calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  assert.equal(deferred, 1)
  assert.equal(cancelled, 0)
})

test('whenIdle 某个任务开始新导航后保留其他任务，旧 complete 不提前触发', () => {
  const { navigation, calls } = createNavigation()
  const seen = []
  navigation.navigateTo({ url: '/pages/detail/detail' })
  navigation.whenIdle(() => {
    seen.push('first')
    navigation.redirectTo({ url: '/pages/edit/edit' })
  })
  navigation.whenIdle(() => seen.push('second'))
  navigation.ready('pages/detail/detail')
  calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  assert.deepEqual(seen, ['first'])
  calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  navigation.ready('pages/detail/detail')
  assert.deepEqual(seen, ['first'])
  navigation.ready('pages/edit/edit')
  calls[1].options.complete({ errMsg: 'redirectTo:ok' })
  assert.deepEqual(seen, ['first', 'second'])
})

test('whenIdle 在失败和看门狗解锁时可继续，任务抛错不会阻断后续任务', () => {
  const { navigation, calls, errors, clock } = createNavigation()
  let continued = 0
  navigation.navigateTo({ url: '/pages/detail/detail' })
  navigation.whenIdle(() => { throw new Error('idle task failed') })
  navigation.whenIdle(() => continued++)
  calls[0].options.fail({ errMsg: 'navigateTo:fail unavailable' })
  assert.equal(continued, 1)
  assert.equal(errors.length, 1)
  navigation.navigateTo({ url: '/pages/edit/edit' })
  navigation.whenIdle(() => continued++)
  clock.advance(1500)
  assert.equal(continued, 2)
  assert.equal(calls.length, 2)
})

test('权限拒绝早于 native complete 时，等入场结束只返回一次', async () => {
  const harness = createNavigation()
  const { navigation, calls, setPages } = harness
  let shown = 0
  navigation.navigateTo({ url: '/pages/admin-orders/admin-orders' })
  setPages(['pages/list/list', 'pages/admin-orders/admin-orders'])
  const target = protectedPage(harness, {
    ensureProfile: () => Promise.resolve(), isAdmin: () => false
  }, { onShow() { shown++ } })
  await target.onShow()
  assert.equal(shown, 0)
  assert.equal(calls.length, 1)
  calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].method, 'navigateBack')
  calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  assert.equal(calls.length, 2)
})

test('权限拒绝在 native complete 之后返回时立即回退，分享单页回首页', async () => {
  const harness = createNavigation()
  let resolveProfile
  const profile = new Promise((resolve) => { resolveProfile = resolve })
  harness.navigation.navigateTo({ url: '/pages/admin-orders/admin-orders' })
  harness.setPages(['pages/list/list', 'pages/admin-orders/admin-orders'])
  const target = protectedPage(harness, {
    ensureProfile: () => profile, isAdmin: () => false
  })
  const showing = target.onShow()
  harness.calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  assert.equal(harness.calls.length, 1)
  resolveProfile()
  await showing
  assert.equal(harness.calls[1].method, 'navigateBack')

  const shared = createNavigation(['pages/admin-orders/admin-orders'])
  const direct = protectedPage(shared, {
    ensureProfile: () => Promise.resolve(), isAdmin: () => false
  })
  await direct.onShow()
  assert.equal(shared.calls.length, 1)
  assert.equal(shared.calls[0].method, 'switchTab')
  assert.equal(shared.calls[0].options.url, '/pages/list/list')
})

test('权限回退等待期间隐藏或卸载，迟到 complete 不再导航', async () => {
  for (const event of ['onHide', 'onUnload']) {
    const harness = createNavigation()
    harness.navigation.navigateTo({ url: '/pages/admin-orders/admin-orders' })
    harness.setPages(['pages/list/list', 'pages/admin-orders/admin-orders'])
    const target = protectedPage(harness, {
      ensureProfile: () => Promise.resolve(), isAdmin: () => false
    })
    await target.onShow()
    target[event]()
    harness.calls[0].options.complete({ errMsg: 'navigateTo:ok' })
    harness.clock.advance(1500)
    assert.equal(harness.calls.length, 1, event)
  }
})

test('同页新的 onShow 撤销上次权限拒绝的回退，不使用旧的权限结果', async () => {
  const harness = createNavigation()
  let allowed = false
  let shown = 0
  harness.navigation.navigateTo({ url: '/pages/admin-orders/admin-orders' })
  harness.setPages(['pages/list/list', 'pages/admin-orders/admin-orders'])
  const target = protectedPage(harness, {
    ensureProfile: () => Promise.resolve(), isAdmin: () => allowed
  }, { onShow() { shown++ } })
  await target.onShow()
  allowed = true
  await target.onShow()
  harness.calls[0].options.complete({ errMsg: 'navigateTo:ok' })
  assert.equal(shown, 1)
  assert.equal(harness.calls.length, 1)
})
