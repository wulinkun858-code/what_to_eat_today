// 双幅合卷遮挡主题提交，再开卷露出新的山色。
// CSS 位移复用 --d-short；时间线共 460ms，不触碰页面滚动位置。
const themeUtil = require('../../utils/theme')

const FRAME_MS = 20
const PANEL_MS = 200 // 对应 tokens.wxss 的 --d-short
const COVER_HOLD_MS = 40
const COVER_MS = FRAME_MS + PANEL_MS
const OPEN_MS = COVER_MS + COVER_HOLD_MS
const FINISH_MS = OPEN_MS + PANEL_MS

Component({
  data: {
    show: false,
    phase: 'idle',
    key: 'paper',
    paper: '',
    wash: '',
    ink: '',
    label: ''
  },

  lifetimes: {
    created() {
      this._serial = 0
      this._timers = []
      this._busy = false
      this._detached = false
      this._hidden = false
    },

    detached() {
      // 卸载后只完成业务终态，不再更新视图或访问页面回调。
      this._detached = true
      this._finishRun(false)
    }
  },

  pageLifetimes: {
    show() {
      this._hidden = false
    },

    hide() {
      this._hidden = true
      this._finishRun(true)
    }
  },

  methods: {
    /** 保持 play({ x, y, key, onCover, done }) 调用兼容；本转场无需触点坐标。 */
    play(opts) {
      if (this._busy || this._detached || this._hidden) return
      const options = opts || {}
      const next = themeUtil.getThemes().find((item) => item.key === options.key) || themeUtil.getTheme()
      const run = {
        id: ++this._serial,
        key: next.key,
        onCover: options.onCover,
        done: options.done,
        committed: false,
        completed: false
      }
      this._run = run
      this._busy = true

      // 减少动效不创建定时器；提交与回调仍然完整执行。
      if (themeUtil.isReduceMotion()) {
        this._finishRun(true)
        return
      }

      this.setData({
        show: true,
        phase: 'ready',
        key: next.key,
        paper: next.bg,
        wash: next.bg2,
        ink: next.ink,
        label: next.name
      }, () => {
        if (!this._isCurrent(run)) return
        this._schedule(run, () => this.setData({ phase: 'closed' }), FRAME_MS)
        this._schedule(run, () => this._commit(run, true), COVER_MS)
        this._schedule(run, () => this.setData({ phase: 'open' }), OPEN_MS)
        this._schedule(run, () => this._finishRun(true), FINISH_MS)
      })
    },

    _isCurrent(run) {
      return !this._detached && !this._hidden && this._run === run && this._serial === run.id
    },

    _schedule(run, callback, delay) {
      this._timers.push(setTimeout(() => {
        if (this._isCurrent(run)) callback()
      }, delay))
    },

    _notify(run, name) {
      if (!this._detached && typeof run[name] === 'function') run[name]()
    },

    _commit(run, notify) {
      if (!run || run.committed) return
      // 先标记，防止主题广播或页面回调重入时重复提交。
      run.committed = true
      themeUtil.apply(run.key)
      if (notify) this._notify(run, 'onCover')
    },

    _finishRun(notify) {
      const run = this._run
      this._serial += 1
      this._timers.forEach((timer) => clearTimeout(timer))
      this._timers = []
      this._run = null
      this._busy = false
      if (!this._detached) this.setData({ show: false, phase: 'idle' })
      if (!run || run.completed) return
      run.completed = true
      // 隐藏或卸载中断时也到达目标主题；回调异常不会遗留遮罩或计时器。
      try {
        this._commit(run, notify)
      } finally {
        if (notify) this._notify(run, 'done')
      }
    },

    blockTouch() {}
  }
})
