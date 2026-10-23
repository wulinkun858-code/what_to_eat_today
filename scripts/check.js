// 零依赖静态检查，兼容 Windows/macOS/Linux。
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const excluded = new Set(['node_modules', '.git', '.claude', '.workbuddy', 'preview'])

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name)) return []
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? files(file) : [file]
  })
}

let failed = 0
for (const file of files(root)) {
  if (file.endsWith('.json')) {
    try { JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) { console.error(file, error.message); failed += 1 }
  }
  if (!file.endsWith('.js')) continue
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) { console.error(result.stderr); failed += 1 }
  const source = fs.readFileSync(file, 'utf8')
  const template = file.replace(/\.js$/, '.wxml')
  if (fs.existsSync(template)) {
    const markup = fs.readFileSync(template, 'utf8')
    for (const binding of markup.matchAll(/(?:bind|catch):?[\w]+=["'](\w+)["']/g)) {
      if (!new RegExp('\\b' + binding[1] + '\\s*\\(').test(source)) {
        console.error('Missing event handler:', template, binding[1]); failed += 1
      }
    }
  }
  for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
    const target = path.resolve(path.dirname(file), match[1])
    if (![target + '.js', path.join(target, 'index.js'), target].some((candidate) => fs.existsSync(candidate))) {
      console.error('Missing module:', file, match[1]); failed += 1
    }
  }
}
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
for (const page of app.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    if (!fs.existsSync(path.join(root, page + '.' + extension))) { console.error('Missing page:', page, extension); failed += 1 }
  }
}
if (fs.readFileSync(path.join(root, 'utils/tokenizer.js'), 'utf8').replace(/\r\n/g, '\n') !==
    fs.readFileSync(path.join(root, 'cloudfunctions/biz/lib/tokenizer.js'), 'utf8').replace(/\r\n/g, '\n')) {
  console.error('Client and cloud search tokenizers differ'); failed += 1
}
console.log('Static checks:', failed === 0 ? 'passed' : failed + ' failed')
process.exitCode = failed ? 1 : 0
