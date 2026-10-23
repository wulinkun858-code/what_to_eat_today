const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

function load(file, mocks = {}, globals = {}) {
  const absolute = path.resolve(__dirname, '../..', file)
  const localRequire = createRequire(absolute)
  const module = { exports: {} }
  const context = vm.createContext(Object.assign({
    module, exports: module.exports, console, setTimeout, clearTimeout, setInterval, clearInterval,
    require: (key) => Object.prototype.hasOwnProperty.call(mocks, key) ? mocks[key] : localRequire(key)
  }, globals))
  vm.runInContext(fs.readFileSync(absolute, 'utf8'), context, { filename: absolute })
  return module.exports
}

function page(file, mocks = {}, globals = {}) {
  let options
  load(file, Object.assign({ '../../utils/page': { definePage: (value) => value } }, mocks),
    Object.assign({ Page: (value) => { options = value } }, globals))
  return Object.assign({}, options, {
    data: structuredClone(options.data),
    setData(patch) { Object.assign(this.data, patch) }
  })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

module.exports = { load, page, deferred }
