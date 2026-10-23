const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const componentFile = path.resolve(__dirname, '../components/theme-reveal/index.js')
const componentSource = fs.readFileSync(componentFile, 'utf8')
const themes = [
  { key: 'paper', name: '青瓷', bg: '#F3F5EE', bg2: '#E7EEE5', ink: '#203D35' },
  { key: 'ink', name: '墨黑', bg: '#181818', bg2: '#1E1E1E', ink: '#F0EDE6' }
]

// 不等待真实时间，也不载入微信或云服务；每个组件实例使用独立调度队列。
function createClock() {
  let now = 0
  let nextId = 0
  const pending = new Map()

  function nextTask() {
    return [...pending].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
  }

  function advance(duration) {
    const end = now + duration
    let count = 0
    for (;;) {
      const task = nextTask()
      if (!task || task[1].at > end) break
      assert.ok(count++ < 100, '计时任务没有在有限步数内结束')
      now = task[1].at
      pending.delete(task[0])
      task[1].callback()
    }
    now = end
  }

  return {
    get now() { return now },
    get size() { return pending.size },
    get scheduled() { return nextId },
    setTimeout(callback, delay) {
      const id = ++nextId
      pending.set(id, { at: now + delay, callback })
      return id
    },
    clearTimeout(id) { pending.delete(id) },
    advance,
    step() {
      const task = nextTask()
      assert.ok(task, '没有可推进的计时任务')
      advance(task[1].at - now)
    },
    runAll() {
      let count = 0
      while (pending.size) {
        assert.ok(count++ < 100, '动画创建了无限计时任务')
        this.step()
      }
    }
  }
}

function createReveal({ reduce = false, deferRender = false } = {}) {
  const clock = createClock()
  const commits = []
  const writes = []
  const renderCallbacks = []
  let definition
  let instance
  let currentTheme = themes[0]
  const theme = {
    getThemes: () => themes,
    getTheme: () => currentTheme,
    isReduceMotion: () => reduce,
    apply(key) {
      currentTheme = themes.find((item) => item.key === key) || themes[0]
      commits.push({ key, at: clock.now, phase: instance.data.phase, show: instance.data.show })
      return currentTheme
    }
  }

  vm.runInNewContext(componentSource, {
    require(key) {
      assert.equal(key, '../../utils/theme', '组件不应加载真实平台或云服务')
      return theme
    },
    Component(value) { definition = value },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  }, { filename: componentFile })

  instance = Object.assign({}, definition.methods, {
    data: structuredClone(definition.data),
    setData(patch, callback) {
      assert.equal(this._detached, false, '组件卸载后不应更新视图')
      Object.assign(this.data, patch)
      writes.push({ ...patch })
      if (!callback) return
      if (deferRender) renderCallbacks.push(callback)
      else callback()
    }
  })
  definition.lifetimes.created.call(instance)

  return {
    instance, clock, commits, writes,
    hide: () => definition.pageLifetimes.hide.call(instance),
    show: () => definition.pageLifetimes.show.call(instance),
    detach: () => definition.lifetimes.detached.call(instance),
    flushRender() {
      while (renderCallbacks.length) renderCallbacks.shift()()
    }
  }
}

function assertIdle(reveal) {
  assert.equal(reveal.instance._busy, false)
  assert.equal(reveal.instance._run, null)
  assert.equal(reveal.clock.size, 0)
  assert.equal(reveal.instance._timers.length, 0)
  if (!reveal.instance._detached) {
    assert.equal(reveal.instance.data.show, false)
    assert.equal(reveal.instance.data.phase, 'idle')
  }
}

function reachCommit(reveal) {
  let count = 0
  while (!reveal.commits.length) {
    assert.ok(count++ < 10, '转场没有提交目标主题')
    reveal.clock.step()
  }
}

test('减少动效同步提交目标和完成回调，不创建计时器', () => {
  const reveal = createReveal({ reduce: true })
  const callbacks = []
  reveal.instance.play({
    x: 12, y: 24, key: 'ink',
    onCover: () => callbacks.push('cover'),
    done: () => callbacks.push('done')
  })
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink'])
  assert.deepEqual(callbacks, ['cover', 'done'])
  assert.equal(reveal.clock.scheduled, 0)
  assertIdle(reveal)
})

test('正常转场在合卷遮挡时只提交一次，440–520ms 内收尾', () => {
  const reveal = createReveal()
  const callbacks = []
  reveal.instance.play({
    key: 'ink',
    onCover: () => callbacks.push('cover'),
    done: () => callbacks.push('done')
  })
  assert.equal(reveal.commits.length, 0)
  assert.equal(reveal.instance.data.paper, themes[1].bg)
  assert.equal(reveal.instance.data.wash, themes[1].bg2)
  assert.equal(reveal.instance.data.ink, themes[1].ink)
  reveal.clock.runAll()
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink'])
  assert.equal(reveal.commits[0].phase, 'closed')
  assert.equal(reveal.commits[0].show, true)
  assert.deepEqual(callbacks, ['cover', 'done'])
  assert.ok(reveal.clock.now >= 440 && reveal.clock.now <= 520)
  assertIdle(reveal)
})

test('快速重复 play 忽略忙时请求，结束后仍能再次切换', () => {
  const reveal = createReveal()
  let ignoredCallbacks = 0
  reveal.instance.play({ key: 'ink' })
  reveal.instance.play({ key: 'paper', done: () => ignoredCallbacks++ })
  reveal.clock.runAll()
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink'])
  assert.equal(ignoredCallbacks, 0)
  reveal.instance.play({ key: 'paper' })
  reveal.clock.runAll()
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink', 'paper'])
  assertIdle(reveal)
})

test('提交前 hide 立即完成目标、清理遮罩与计时器，show 后可用', () => {
  const reveal = createReveal()
  const callbacks = []
  reveal.instance.play({
    key: 'ink',
    onCover: () => callbacks.push('cover'),
    done: () => callbacks.push('done')
  })
  reveal.clock.advance(50)
  assert.equal(reveal.commits.length, 0)
  reveal.hide()
  reveal.hide()
  reveal.clock.advance(1000)
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink'])
  assert.deepEqual(callbacks, ['cover', 'done'])
  assertIdle(reveal)
  reveal.show()
  reveal.instance.play({ key: 'paper' })
  reveal.clock.runAll()
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink', 'paper'])
})

test('提交后 hide 不重复提交主题或遮挡回调', () => {
  const reveal = createReveal()
  const callbacks = []
  reveal.instance.play({
    key: 'ink',
    onCover: () => callbacks.push('cover'),
    done: () => callbacks.push('done')
  })
  reachCommit(reveal)
  reveal.hide()
  reveal.clock.advance(1000)
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink'])
  assert.deepEqual(callbacks, ['cover', 'done'])
  assertIdle(reveal)
})

test('提交前 detached 完成目标，卸载后不更新视图或调用页面回调', () => {
  const reveal = createReveal()
  let callbackCount = 0
  reveal.instance.play({ key: 'ink', onCover: () => callbackCount++, done: () => callbackCount++ })
  reveal.clock.advance(50)
  const writesBeforeDetach = reveal.writes.length
  reveal.detach()
  reveal.detach()
  reveal.clock.advance(1000)
  reveal.instance.play({ key: 'paper', done: () => callbackCount++ })
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink'])
  assert.equal(callbackCount, 0)
  assert.equal(reveal.writes.length, writesBeforeDetach)
  assertIdle(reveal)
})

test('提交后 detached 只清理资源，不重复提交或调用 done', () => {
  const reveal = createReveal()
  const callbacks = []
  reveal.instance.play({
    key: 'ink',
    onCover: () => callbacks.push('cover'),
    done: () => callbacks.push('done')
  })
  reachCommit(reveal)
  const writesBeforeDetach = reveal.writes.length
  reveal.detach()
  reveal.clock.advance(1000)
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink'])
  assert.deepEqual(callbacks, ['cover'])
  assert.equal(reveal.writes.length, writesBeforeDetach)
  assertIdle(reveal)
})

test('首帧 setData 回调延后至卸载后，不会复活计时器或页面回调', () => {
  const reveal = createReveal({ deferRender: true })
  let callbackCount = 0
  reveal.instance.play({ key: 'ink', onCover: () => callbackCount++, done: () => callbackCount++ })
  const writesBeforeDetach = reveal.writes.length
  reveal.detach()
  reveal.flushRender()
  reveal.clock.advance(1000)
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink'])
  assert.equal(callbackCount, 0)
  assert.equal(reveal.writes.length, writesBeforeDetach)
  assert.equal(reveal.clock.scheduled, 0)
  assertIdle(reveal)
})

test('hide 收尾时遮挡回调抛错，仍调用 done 并清理忙碌态与遮罩', () => {
  const reveal = createReveal()
  let doneCount = 0
  reveal.instance.play({
    key: 'ink',
    onCover() { throw new Error('page callback failed') },
    done: () => doneCount++
  })
  assert.throws(() => reveal.hide(), /page callback failed/)
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink'])
  assert.equal(doneCount, 1)
  assertIdle(reveal)
})

test('正常结束的 done 回调抛错，也不会遗留遮罩或计时器', () => {
  const reveal = createReveal()
  reveal.instance.play({ key: 'ink', done() { throw new Error('done callback failed') } })
  assert.throws(() => reveal.clock.runAll(), /done callback failed/)
  assert.deepEqual(reveal.commits.map((item) => item.key), ['ink'])
  assertIdle(reveal)
})
