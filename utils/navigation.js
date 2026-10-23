// 路由请求共用一把锁；目标页 onShow 与原生 complete 都到达后才接收下一次操作。
// 原生生命周期次序因平台而异，看门狗只恢复可操作性，不自行重试跳转。
const HOME_ROUTE = 'pages/list/list'
const WATCHDOG_MS = 1500
let pending = null
const idleCallbacks = new Set()

function normalizeRoute(url) {
  return typeof url === 'string' ? url.split(/[?#]/)[0].replace(/^\/+/, '') : ''
}

function pageStack() {
  try {
    return getCurrentPages() || []
  } catch (error) {
    return []
  }
}

function topRoute() {
  const pages = pageStack()
  return pages.length ? normalizeRoute(pages[pages.length - 1].route) : ''
}

function notify(options, name, result) {
  if (typeof options[name] !== 'function') return
  try {
    options[name](result)
  } catch (error) {
    // 页面回调异常不能中断 SDK 后续 complete 或遗留导航锁。
    console.error('[navigation callback]', error)
  }
}

function refuse(method, options, reason) {
  const result = { errMsg: `${method}:fail ${reason}` }
  notify(options, 'fail', result)
  notify(options, 'complete', result)
  return false
}

function release(run) {
  if (run.timer) clearTimeout(run.timer)
  run.timer = null
  if (pending !== run) return
  pending = null
  // 回调可能发起新的导航；其余单次任务等待该请求完成，不丢弃也不轮询。
  for (const callback of Array.from(idleCallbacks)) {
    if (pending) break
    callback()
  }
}

function finishIfReady(run) {
  if (run.arrived && run.completed) release(run)
}

function showFailure(method) {
  try {
    wx.showToast({
      title: method === 'navigateBack' ? '暂时无法返回，请重试' : '暂时无法打开页面，请重试',
      icon: 'none'
    })
  } catch (error) {}
}

function start(method, options, target, checkDuplicate) {
  const opts = options || {}
  if (pending) return refuse(method, opts, 'navigation in progress')
  if (checkDuplicate && target && target === topRoute()) {
    return refuse(method, opts, 'already on target page')
  }

  const run = { target, arrived: false, completed: false, failed: false, timer: null }
  pending = run
  run.timer = setTimeout(() => release(run), WATCHDOG_MS)

  const callbacks = {
    success(result) {
      notify(opts, 'success', result)
    },
    fail(result) {
      if (run.failed) return
      run.failed = true
      release(run)
      showFailure(method)
      notify(opts, 'fail', result)
    },
    complete(result) {
      if (run.completed) return
      run.completed = true
      // 在业务 complete 中发起后续导航时，已有 ready 的锁应先释放。
      finishIfReady(run)
      notify(opts, 'complete', result)
    }
  }

  try {
    wx[method](Object.assign({}, opts, callbacks))
  } catch (error) {
    const result = { errMsg: `${method}:fail ${error && error.message ? error.message : 'native navigation error'}` }
    callbacks.fail(result)
    callbacks.complete(result)
  }
  return true
}

function navigateTo(options) {
  return start('navigateTo', options, normalizeRoute(options && options.url), true)
}

function switchTab(options) {
  return start('switchTab', options, normalizeRoute(options && options.url), true)
}

function redirectTo(options) {
  return start('redirectTo', options, normalizeRoute(options && options.url), false)
}

function navigateBack(options) {
  const opts = options || {}
  const pages = pageStack()
  if (pages.length < 2) {
    return switchTab(Object.assign({}, opts, { url: `/${HOME_ROUTE}` }))
  }
  const requested = Number(opts.delta)
  const delta = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) || 1 : 1
  const steps = Math.min(delta, pages.length - 1)
  const target = normalizeRoute(pages[pages.length - 1 - steps].route)
  return start('navigateBack', Object.assign({}, opts, { delta: steps }), target, false)
}

// 页面公共 onShow 必须在任何异步请求前调用；忽略其他页面的迟到生命周期。
function ready(route) {
  const run = pending
  if (!run || !run.target || normalizeRoute(route) !== run.target) return
  run.arrived = true
  finishIfReady(run)
}

// 权限拒绝等必要后续动作可等待入场完成；离页时调用返回的取消函数。
function whenIdle(callback) {
  let active = true
  const run = () => {
    if (!active) return
    active = false
    idleCallbacks.delete(run)
    try {
      callback()
    } catch (error) {
      console.error('[navigation idle callback]', error)
    }
  }
  if (pending) idleCallbacks.add(run)
  else run()
  return () => {
    active = false
    idleCallbacks.delete(run)
  }
}

module.exports = { navigateTo, navigateBack, switchTab, redirectTo, ready, whenIdle }
