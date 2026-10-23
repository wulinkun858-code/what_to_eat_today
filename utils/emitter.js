// 快照遍历允许订阅者在回调内退订，而不会漏掉后续回调。
function createEmitter() {
  const listeners = new Set()
  return {
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    emit(...args) {
      Array.from(listeners).forEach((fn) => {
        try {
          fn(...args)
        } catch (error) {
          console.error('[subscription]', error)
        }
      })
    }
  }
}

module.exports = { createEmitter }
