/*
 * Build a dependency-free browser preview from the real WXML and WXSS.
 * Run from any directory: node scripts/build_ink_preview.js
 * The generated page uses in-memory fixtures only; it never loads app business
 * methods, wx, credentials, or cloud SDKs. This is not a WeChat runtime emulator.
 */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'preview', 'ink-preview.html')
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const labels = {
  list: '寻味 · 首页', detail: '一味 · 菜品详情', my: '小院 · 我的',
  comments: '食话 · 留言', edit: '撰味 · 编辑菜品',
  'order-confirm': '落单 · 点菜单', 'my-orders': '食单 · 我的订单',
  kitchen: '灶间 · 工作台', 'banner-manage': '陈列 · 海报墙',
  'category-manage': '品类 · 分类管理', 'user-manage': '名册 · 用户管理',
  'admin-orders': '账房 · 全部订单'
}

// Quote-aware scanner: expressions may contain >, <, quoted strings and arrays.
function parseWxml(source) {
  const tree = { tag: 'root', attrs: {}, children: [] }
  const stack = [tree]
  let cursor = 0
  while (cursor < source.length) {
    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4)
      cursor = end < 0 ? source.length : end + 3
      continue
    }
    if (source[cursor] !== '<' || !/^<\/?[A-Za-z][\w-]*(?=[\s/>])/.test(source.slice(cursor))) {
      const markup = /<(?:!--|\/?[A-Za-z][\w-]*(?=[\s/>]))/g
      markup.lastIndex = cursor + 1
      const next = markup.exec(source)
      const end = next ? next.index : -1
      stack[stack.length - 1].children.push({ text: source.slice(cursor, end < 0 ? source.length : end) })
      cursor = end < 0 ? source.length : end
      continue
    }
    let end = cursor + 1
    let quote = ''
    while (end < source.length) {
      const char = source[end]
      if (quote) {
        if (char === quote) quote = ''
      } else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
      end += 1
    }
    const raw = source.slice(cursor + 1, end)
    cursor = end + 1
    if (raw.startsWith('/')) {
      const closing = raw.slice(1).trim()
      if (stack.length < 2 || stack[stack.length - 1].tag !== closing) {
        throw new Error('Unbalanced WXML tag: ' + closing)
      }
      stack.pop()
      continue
    }
    if (raw.startsWith('!') || raw.startsWith('?')) continue
    const match = raw.match(/^([\w-]+)([\s\S]*)$/)
    if (!match) throw new Error('Cannot parse WXML: ' + raw)
    const node = { tag: match[1], attrs: {}, children: [] }
    const body = match[2].replace(/\/\s*$/, '')
    const attrPattern = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g
    let attr
    while ((attr = attrPattern.exec(body))) node.attrs[attr[1]] = attr[2] ?? attr[3] ?? attr[4] ?? true
    stack[stack.length - 1].children.push(node)
    if (!/\/\s*$/.test(raw) && !['input', 'image', 'switch', 'slider', 'checkbox', 'radio'].includes(node.tag)) stack.push(node)
  }
  if (stack.length !== 1) throw new Error('Unclosed WXML tag: ' + stack[stack.length - 1].tag)
  return tree.children
}

// Only capture static Page/Component defaults. Lifecycle and method bodies are
// never invoked, and require is a stub with no filesystem or network access.
function captureDefaults(relative, component = false) {
  let definition = {}
  const noop = () => undefined
  const dependency = new Proxy(noop, { get: () => noop })
  const sandbox = {
    Page: (value) => { definition = value },
    Component: (value) => { definition = value },
    require: (name) => name.endsWith('/page')
      ? { definePage: (value) => value }
      : name.endsWith('/db') ? { COMMENT_MAX_LENGTH: 500 } : dependency,
    console: { log: noop, warn: noop, error: noop }
  }
  vm.runInNewContext(read(relative), sandbox, { filename: relative, timeout: 1000 })
  const data = JSON.parse(JSON.stringify(definition.data || {}))
  if (component) {
    Object.entries(definition.properties || {}).forEach(([key, value]) => {
      data[key] = value && typeof value === 'object' ? value.value : undefined
    })
  }
  return data
}

// Expand imports once, including tokens imported again by isolated components.
const imported = new Set()
function expandWxss(relative) {
  const absolute = path.resolve(root, relative)
  if (!absolute.startsWith(root + path.sep)) throw new Error('WXSS import outside project: ' + relative)
  if (imported.has(absolute)) return ''
  imported.add(absolute)
  return fs.readFileSync(absolute, 'utf8').replace(/@import\s+["']([^"']+)["']\s*;/g, (_, target) => {
    return expandWxss(path.relative(root, path.resolve(path.dirname(absolute), target)))
  })
}

const tagMap = { view: 'div', text: 'span', image: 'img', 'scroll-view': 'div', swiper: 'div', 'swiper-item': 'div', block: 'div' }
function convertSelector(selector) {
  return selector.replace(/(^|[\s>+~,(])([a-z][\w-]*)(?=$|[\s>+~,.#:[)])/g, (all, before, tag) => {
    return before + (tag === 'page' ? '.mobile-root' : tagMap[tag] || tag)
  })
}

// Recursive CSS block traversal scopes normal selectors while preserving
// keyframe step selectors. Media/supports blocks recurse with the same scope.
function convertCss(source, scope = '') {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(-?(?:\d*\.)?\d+)rpx\b/g, (_, value) => Number(value) / 2 + 'px')
    .replace(/url\((["']?)\/assets\//g, 'url($1assets/')
  function blocks(input, keyframes = false) {
    let cursor = 0
    let result = ''
    while (cursor < input.length) {
      const open = input.indexOf('{', cursor)
      if (open < 0) return result + input.slice(cursor)
      const selector = input.slice(cursor, open).trim()
      let depth = 1
      let end = open + 1
      let quote = ''
      while (end < input.length && depth) {
        const char = input[end]
        if (quote) {
          if (char === quote && input[end - 1] !== '\\') quote = ''
        } else if (char === '"' || char === "'") quote = char
        else if (char === '{') depth += 1
        else if (char === '}') depth -= 1
        end += 1
      }
      const body = input.slice(open + 1, end - 1)
      if (/^@(?:-webkit-)?keyframes\b/.test(selector)) result += selector + '{' + blocks(body, true) + '}\n'
      else if (/^@(media|supports|layer|container)\b/.test(selector)) result += selector + '{' + blocks(body) + '}\n'
      else if (selector.startsWith('@') || keyframes) result += selector + '{' + body + '}\n'
      else {
        const mapped = selector.split(',').map((part) => {
          const converted = convertSelector(part.trim())
          if (!scope) return converted
          return converted.startsWith('.mobile-root')
            ? converted.replace('.mobile-root', '.mobile-root' + scope)
            : '.mobile-root' + scope + ' ' + converted
        }).join(',')
        result += mapped + '{' + body + '}\n'
      }
      cursor = end
    }
    return result
  }
  return blocks(css)
}

let css = convertCss(expandWxss('app.wxss'))
const components = {}
for (const name of ['nav-bar', 'theme-reveal']) {
  const base = 'components/' + name + '/index'
  components[name] = { tree: parseWxml(read(base + '.wxml')), defaults: captureDefaults(base + '.js', true) }
  css += convertCss(expandWxss(base + '.wxss'))
}
const tabbar = {
  tree: parseWxml(read('custom-tab-bar/index.wxml')),
  defaults: captureDefaults('custom-tab-bar/index.js', true)
}
css += convertCss(expandWxss('custom-tab-bar/index.wxss'))
const pages = {}
for (const route of app.pages) {
  const key = route.split('/')[1]
  pages[key] = { key, route, label: labels[key] || key, tree: parseWxml(read(route + '.wxml')), defaults: captureDefaults(route + '.js') }
  css += convertCss(expandWxss(route + '.wxss'), '[data-page="' + key + '"]')
}

const art = 'assets/art/celadon-landscape.jpg'
const food = (name) => fs.existsSync(path.join(root, 'preview', name)) ? 'preview/' + name : art
const dishes = [
  { _id: 'dish-2', name: '荷塘小炒', description: '藕片清脆，青豆鲜甜。一箸青绿，收下半日清欢。', image: food('food-lotus.jpg'), categoryId: 'c-veg', categoryName: '田园清供', chefNickname: '小青', tags: ['清淡', '时令'], ingredients: ['莲藕 1 节', '荷兰豆 100g', '木耳 少许'], steps: ['莲藕切片，配菜洗净。', '热锅快炒，加少许盐调味即可。'] },
  { _id: 'dish-1', name: '慢火红烧肉', description: '糖色温润，慢火收汁。把寻常日子，炖成一口绵长。', image: food('food-braise.jpg'), categoryId: 'c-meat', categoryName: '家常荤味', chefNickname: '阿坤', tags: ['家常', '慢炖'], ingredients: ['五花肉 500g', '冰糖 20g', '黄酒 2 勺', '生抽 2 勺'], steps: ['五花肉切块，冷水下锅焯净血沫。', '少许油融化冰糖，倒入肉块翻匀。', '加入黄酒和生抽，小火慢炖至软糯，收汁上桌。'] },
  { _id: 'dish-3', name: '莲藕排骨汤', description: '一盅清汤，几片莲藕。最寻常的温暖，都在这一席。', image: food('food-soup.jpg'), categoryId: 'c-soup', categoryName: '一盅清汤', chefNickname: '阿坤', tags: ['汤羹', '暖胃'], ingredients: ['莲藕 1 节', '排骨 300g', '生姜 3 片'], steps: ['排骨焯水，莲藕洗净切段。', '加姜片和清水，小火煲煮一小时。'] },
  { _id: 'dish-4', name: '葱油拌面', description: '葱香入油，细面挂汁，三餐四季皆是好味。', image: food('food-noodles.jpg'), categoryId: 'c-rice', categoryName: '饭面主食', chefNickname: '小青', tags: ['主食', '葱香'], ingredients: ['细面 1 人份', '小葱 1 把', '生抽 1 勺'], steps: ['小葱切段，慢火煎出葱香。', '煮熟细面，拌入葱油和酱油。'] }
]
const categories = [{ _id: '', name: '全部' }, { _id: 'c-meat', name: '家常荤味' }, { _id: 'c-veg', name: '田园清供' }, { _id: 'c-soup', name: '一盅清汤' }, { _id: 'c-rice', name: '饭面主食' }]
const comments = [
  { _id: 'comment-1', dishId: 'dish-1', dishName: '慢火红烧肉', content: '收汁那一刻，整间屋子都是家的味道。今天也认真吃饭了。', timeText: '刚刚', nickname: '林间客' },
  { _id: 'comment-2', dishId: 'dish-2', dishName: '荷塘小炒', content: '原来清淡也有自己的丰盛。一箸青绿，便是一整个春天。', timeText: '2 小时前', nickname: '小满' },
  { _id: 'comment-3', dishId: 'dish-3', dishName: '莲藕排骨汤', content: '这一盅汤，暖了胃，也暖了归家的人。', timeText: '昨天', nickname: '阿坤' }
]
const orderItems = dishes.slice(0, 2).map((dish) => ({ dishId: dish._id, dishName: dish.name, dishImage: dish.image, chefNickname: dish.chefNickname }))
const orders = [
  { _id: 'order-1', dinerNickname: '林间客', status: 'cooking', statusText: '制作中', statusCls: 's-cooking', statusChar: '灶', step: 1, timeText: '今日 12:08', cancellable: false, items: orderItems, chefs: 2 },
  { _id: 'order-2', dinerNickname: '小满', status: 'pending', statusText: '待接单', statusCls: 's-pending', statusChar: '待', step: 0, timeText: '今日 12:16', cancellable: true, items: orderItems.slice(0, 1), chefs: 1 },
  { _id: 'order-3', dinerNickname: '小青', status: 'done', statusText: '已完成', statusCls: 's-done', statusChar: '成', step: 2, timeText: '昨天 18:40', cancellable: false, items: orderItems, chefs: 2 }
]
const fixtures = {
  list: { categories, list: dishes, total: dishes.length, postNo: 297, canManage: true, noMore: true, activeCategoryName: '全部菜品', banners: [{ _id: dishes[0]._id, title: '一餐有味，四季清欢', image: dishes[0].image, type: 'dish' }], navHeight: 118 },
  detail: { id: dishes[0]._id, dish: dishes[0], dishImages: [dishes[0].image], canManage: true, commentList: comments.slice(0, 2), commentTotal: 2, commentMaxLength: 500 },
  my: { nickname: '林间客', roleLabel: '管理员', dishCount: 12, tagCount: 8, unreadCount: 2, canManage: true, isAdmin: true, menu: [{ key: 'orders', text: '我的食单', desc: '每一餐，皆有回响' }, { key: 'kitchen', text: '灶间清事', desc: '飞帖与制作清单', badge: 2 }, { key: 'categories', text: '菜牌分类', desc: '将四季滋味各归其位' }, { key: 'users', text: '伙计名册', desc: '一席之间，都是自己人' }, { key: 'adminOrders', text: '食单账房', desc: '照看每一份用餐期待' }, { key: 'banner', text: '食帖陈列', desc: '为今日好味留一幅影像' }] },
  comments: { list: comments, total: comments.length, noMore: true },
  edit: { loading: false, id: dishes[0]._id, name: dishes[0].name, description: dishes[0].description, imagePreviews: [dishes[0].image], categories: categories.slice(1), categoryNames: categories.slice(1).map((c) => c.name), categoryIndex: 1, ingredientsText: dishes[0].ingredients.join('\n'), stepsText: dishes[0].steps.join('\n'), tagsText: dishes[0].tags.join(' '), imagesMax: 9 },
  'order-confirm': {},
  'my-orders': { list: orders, total: orders.length, noMore: true },
  'admin-orders': { list: orders.map((order) => ({ ...order, items: order.items.map((item) => item.dishName).join('、') })), total: orders.length, noMore: true },
  kitchen: { messages: [{ _id: 'msg-1', orderId: 'order-2', dinerNickname: '小满', items: '慢火红烧肉、春山时蔬', timeText: '12:16', read: false, actionable: true, statusText: '待接单' }, { _id: 'msg-2', orderId: 'order-1', dinerNickname: '林间客', items: '莲藕排骨汤', timeText: '12:08', read: true, actionable: false, statusText: '制作中' }], unreadCount: 1, cooklist: [{ _id: 'cook-1', dishName: '莲藕排骨汤', dinerNickname: '林间客', timeText: '12:08', done: false }, { _id: 'cook-2', dishName: '葱油拌面', dinerNickname: '小满', timeText: '12:05', done: true }] },
  'category-manage': { list: categories.slice(1) },
  'banner-manage': { banners: [{ _id: 'banner-1', fileID: dishes[0].image }, { _id: 'banner-2', fileID: dishes[1].image }], max: 5 },
  'user-manage': { total: 3, noMore: true, list: [{ openid: 'u-1', nickname: '林间客', roleLabel: '管理员', roleCls: 'role-admin', activeText: '刚刚', self: true }, { openid: 'u-2', nickname: '阿坤', roleLabel: '厨师', roleCls: 'role-chef', activeText: '10 分钟前', self: false }, { openid: 'u-3', nickname: '小满', roleLabel: '食客', roleCls: 'role-diner', activeText: '今天', self: false }] }
}
const extraPath = path.join(root, 'preview', 'ink-fixtures.json')
if (fs.existsSync(extraPath)) {
  const extra = JSON.parse(fs.readFileSync(extraPath, 'utf8'))
  Object.entries(extra).forEach(([key, value]) => { fixtures[key] = { ...fixtures[key], ...value } })
}

function previewRuntime(bundle) {
  const parameters = new URLSearchParams(location.search)
  if (parameters.get('mode') === 'gallery') {
    document.body.classList.add('gallery-mode')
    const gallery = document.getElementById('gallery')
    gallery.hidden = false
    const views = [
      ['list', 'paper', '寻味 · 青瓷'], ['list', 'ink', '寻味 · 墨黑'],
      ['detail', 'paper', '一味 · 菜品详情'], ['my', 'paper', '小院 · 我的']
    ]
    gallery.innerHTML = '<header class="gallery-head"><span>坤坤食帖 · 青瓷山水</span><small>真实项目模板转译 / 示例数据仅演示</small></header><div class="gallery-grid">' + views.map(([page, theme, label]) => '<section><iframe title="' + label + '" src="?embed=1&page=' + page + '&theme=' + theme + '&reduce=1"></iframe><p>' + label + '</p></section>').join('') + '</div>'
    return
  }
  if (parameters.get('embed')) document.body.classList.add('embed-mode')
  const frame = document.getElementById('phone')
  const chooser = document.getElementById('page-choice')
  const themeControl = document.getElementById('theme-choice')
  const reduceControl = document.getElementById('reduce-choice')
  const rootURL = new URL('../', location.href).href
  const clone = (value) => JSON.parse(JSON.stringify(value))
  const states = {}
  let current = bundle.pages[parameters.get('page')] ? parameters.get('page') : 'list'
  let previous = 'list'
  let theme = parameters.get('theme') === 'ink' ? 'ink' : 'paper'
  let reduce = parameters.get('reduce') === '1'
  let cart = []
  let pendingScroll = 0
  const cache = new Map()
  const diagnostics = new Set()
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
  const asset = (value) => {
    const text = String(value || '')
    if (text.startsWith('cloud://')) return bundle.art
    return text.startsWith('/assets/') ? text.slice(1) : text
  }
  const evaluate = (expression, data) => {
    try {
      if (!cache.has(expression)) cache.set(expression, new Function('scope', 'with (scope) { return (' + expression + ') }'))
      return cache.get(expression)(data)
    } catch (error) {
      diagnostics.add(expression + ': ' + error.message)
      return undefined
    }
  }
  const value = (source, data) => {
    if (source === true) return true
    const raw = String(source)
    const full = raw.match(/^\s*{{([\s\S]*?)}}\s*$/)
    if (full && !full[1].includes('}}')) return evaluate(full[1], data)
    return raw.replace(/{{([\s\S]*?)}}/g, (_, expression) => evaluate(expression, data) ?? '')
  }
  const getState = (key) => {
    if (!states[key]) states[key] = { ...clone(bundle.pages[key].defaults), ...clone(bundle.fixtures[key] || {}) }
    return states[key]
  }
  const common = () => ({ theme, reduce, pageVisible: true, motionSettled: false, statusBarHeight: 20, navBarHeight: 44, total: 64, loading: false, noMore: true })

  function renderNodes(nodes, data) {
    let result = ''
    let branchActive = false
    let branchTaken = false
    nodes.forEach((node) => {
      if (Object.hasOwn(node, 'text')) {
        result += escape(value(node.text, data))
        return
      }
      const attrs = node.attrs
      if (Object.hasOwn(attrs, 'wx:if')) {
        branchActive = true
        branchTaken = !!value(attrs['wx:if'], data)
        if (!branchTaken) return
      } else if (Object.hasOwn(attrs, 'wx:elif')) {
        if (!branchActive || branchTaken || !value(attrs['wx:elif'], data)) return
        branchTaken = true
      } else if (Object.hasOwn(attrs, 'wx:else')) {
        if (!branchActive || branchTaken) return
        branchTaken = true
      } else {
        branchActive = false
        branchTaken = false
      }
      if (Object.hasOwn(attrs, 'wx:for')) {
        const items = value(attrs['wx:for'], data) || []
        const itemName = attrs['wx:for-item'] || 'item'
        const indexName = attrs['wx:for-index'] || 'index'
        Object.keys(items).forEach((key) => {
          const index = Array.isArray(items) ? Number(key) : key
          result += renderNode(node, { ...data, [itemName]: items[key], [indexName]: index })
        })
      } else result += renderNode(node, data)
    })
    return result
  }

  function renderNode(node, data) {
    const attrs = node.attrs
    if (node.tag === 'block') return renderNodes(node.children, data)
    if (bundle.components[node.tag]) {
      const component = bundle.components[node.tag]
      const properties = {}
      Object.entries(attrs).forEach(([key, raw]) => { if (!key.startsWith('wx:')) properties[key] = value(raw, data) })
      return '<wx-component data-component="' + node.tag + '">' + renderNodes(component.tree, { ...component.defaults, ...common(), ...properties }) + '</wx-component>'
    }
    const htmlTags = { view: 'div', text: 'span', image: 'img', 'scroll-view': 'div', swiper: 'div', 'swiper-item': 'div', picker: 'div', 'rich-text': 'div', navigator: 'a' }
    const tag = htmlTags[node.tag] || node.tag
    let attributes = ' data-wx-tag="' + escape(node.tag) + '"'
    Object.entries(attrs).forEach(([name, raw]) => {
      if (name.startsWith('wx:')) return
      const evaluated = value(raw, data)
      const binding = name.match(/^(?:bind|catch):?(tap|input|confirm|change|focus|blur|longpress)$/)
      if (binding) {
        attributes += ' data-preview-' + binding[1] + '="' + escape(evaluated) + '"'
        return
      }
      if (name.startsWith('bind') || name.startsWith('catch')) return
      if (name === 'style') {
        attributes += ' style="' + escape(String(evaluated || '').replace(/(-?(?:\d*\.)?\d+)rpx\b/g, (_, number) => Number(number) / 2 + 'px')) + '"'
      } else if (name === 'src') attributes += ' src="' + escape(asset(evaluated)) + '"'
      else if (name === 'mode' && node.tag === 'image') attributes += ' data-image-mode="' + escape(evaluated) + '"'
      else if (name === 'disabled' || name === 'checked' || name === 'readonly') {
        if (evaluated) attributes += ' ' + name
      } else if (name === 'hidden') {
        if (evaluated) attributes += ' hidden'
      } else if (['class', 'id', 'value', 'placeholder', 'maxlength', 'type', 'title', 'href', 'aria-label', 'role', 'tabindex'].includes(name) || name.startsWith('data-')) {
        if (!(tag === 'textarea' && name === 'value')) attributes += ' ' + name + '="' + escape(evaluated) + '"'
      }
      if (name === 'hover-class' && evaluated) attributes += ' data-hover-class="' + escape(evaluated) + '"'
    })
    if (node.tag === 'scroll-view') attributes += ' data-scroll-x="' + Boolean(value(attrs['scroll-x'], data)) + '"'
    if (node.tag === 'image') attributes += ' alt="" decoding="async"'
    if (node.tag === 'navigator') attributes += ' data-preview-route="' + escape(value(attrs.url || '', data)) + '"'
    if (['img', 'input', 'hr', 'br'].includes(tag)) return '<' + tag + attributes + '>'
    let children = node.tag === 'textarea' ? escape(value(attrs.value || '', data)) : renderNodes(node.children, data)
    if (node.tag === 'picker') {
      const range = value(attrs.range, data) || []
      children += '<select aria-label="选择品类" data-preview-change="' + escape(value(attrs.bindchange || '', data)) + '">' + range.map((item, index) => '<option value="' + index + '"' + (index === Number(value(attrs.value, data)) ? ' selected' : '') + '>' + escape(item) + '</option>').join('') + '</select>'
    }
    return '<' + tag + attributes + '>' + children + '</' + tag + '>'
  }

  function render(preserveScroll = false) {
    diagnostics.clear()
    const scrollTop = preserveScroll && frame.contentWindow ? frame.contentWindow.scrollY : 0
    const state = { ...common(), ...getState(current), theme, reduce }
    if (current === 'list') {
      state.list = bundle.dishes.filter((dish) => (!state.activeCategory || dish.categoryId === state.activeCategory) && (!state.keyword || (dish.name + dish.description + dish.tags.join('')).includes(state.keyword)))
      state.total = state.list.length
      state.cartCount = cart.length
    }
    if (current === 'order-confirm') {
      state.total = cart.length
      state.groups = []
      cart.forEach((dish) => {
        let group = state.groups.find((item) => item.chefNickname === dish.chefNickname)
        if (!group) { group = { chefNickname: dish.chefNickname, items: [] }; state.groups.push(group) }
        group.items.push(dish)
      })
    }
    const pageHtml = renderNodes(bundle.pages[current].tree, state)
    const tabIndex = bundle.tabs.findIndex((tab) => tab.pagePath.includes('/' + current + '/'))
    const dockHtml = tabIndex < 0 ? '' : renderNodes(bundle.tabbar.tree, { ...bundle.tabbar.defaults, theme, reduce, selected: tabIndex, cartCount: cart.length, list: bundle.tabs.map((tab) => ({ ...tab, pagePath: '/' + tab.pagePath })) })
    const browserCss = 'html{margin:0;min-height:100%;scrollbar-width:none}html::-webkit-scrollbar{display:none}body{margin:0;width:375px;min-height:812px}*{box-sizing:border-box}wx-component{display:contents}img{object-fit:cover;vertical-align:middle}img[data-image-mode="aspectFit"]{object-fit:contain}input,textarea,button,select{font:inherit;color:inherit}input,textarea{background:transparent;border:0;outline:none;min-width:0}button{cursor:pointer}input::placeholder,textarea::placeholder{color:var(--ink-3)}[data-wx-tag="swiper"]{display:flex;overflow:auto;scroll-snap-type:x mandatory;scrollbar-width:none}[data-wx-tag="swiper-item"]{display:block;min-width:100%;flex:0 0 100%;scroll-snap-align:start}[data-wx-tag="scroll-view"]{display:block}[data-scroll-x="true"]{overflow-x:auto;scrollbar-width:none}[data-wx-tag="picker"]{position:relative}[data-wx-tag="picker"] select{position:absolute;inset:0;width:100%;height:100%;opacity:0}[data-preview-tap],[data-preview-route]{cursor:pointer;-webkit-tap-highlight-color:transparent}[hidden]{display:none!important}.preview-notification{position:fixed;left:26px;right:26px;top:80px;z-index:100001;padding:12px 16px;background:var(--ink);color:var(--bg);border-radius:12px;text-align:center;font-size:13px;box-shadow:0 12px 30px #0002}.reduce-motion *{animation:none!important;transition:none!important;scroll-behavior:auto!important}';
    pendingScroll = scrollTop
    frame.srcdoc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=375, initial-scale=1"><base href="' + escape(rootURL) + '"><style>' + bundle.css + browserCss + '</style></head><body class="mobile-root theme-' + theme + (reduce ? ' reduce-motion' : '') + '" data-page="' + current + '">' + pageHtml + dockHtml + '</body></html>'
    document.body.dataset.theme = theme
    chooser.value = current
    themeControl.value = theme
    reduceControl.checked = reduce
    document.getElementById('current-name').textContent = bundle.pages[current].label
    document.getElementById('source-path').textContent = bundle.pages[current].route + '.wxml / .wxss'
    document.getElementById('cart-count').textContent = cart.length
    document.getElementById('diagnostics').textContent = diagnostics.size ? [...diagnostics].join('\n') : '模板插值检查通过。'
    window.__inkPreview = { page: current, theme, reduce, cartCount: cart.length, diagnostics: [...diagnostics], sourcePageCount: Object.keys(bundle.pages).length }
  }

  function navigate(key, id) {
    if (!bundle.pages[key]) return
    previous = current
    current = key
    if (key === 'detail') {
      const dish = bundle.dishes.find((entry) => entry._id === id) || bundle.dishes[0]
      Object.assign(getState('detail'), { id: dish._id, dish, dishImages: dish.image ? [dish.image] : [] })
    }
    render()
  }
  function notify(message) {
    const doc = frame.contentDocument
    doc.querySelector('.preview-notification')?.remove()
    const toast = doc.createElement('div')
    toast.className = 'preview-notification'
    toast.setAttribute('role', 'status')
    toast.textContent = message
    doc.body.append(toast)
    setTimeout(() => toast.remove(), 1800)
  }
  function route(url) {
    const match = String(url).match(/pages\/([^/]+)\//)
    if (match) navigate(match[1])
  }
  function handle(handler, element) {
    const data = element.dataset
    const state = getState(current)
    const id = data.id || data.dishId || state.id
    if (handler === 'switchTab') return route(data.path)
    if (handler === 'onBack') return navigate(previous === current ? 'list' : previous)
    if (['onDishTap', 'onCardTap'].includes(handler)) return navigate('detail', id)
    if (handler === 'onBannerTap') return navigate('detail', id)
    if (handler === 'onCategoryTap') {
      state.activeCategory = data.id || ''
      state.activeCategoryName = bundle.categories.find((category) => category._id === state.activeCategory)?.name || '全部菜品'
      return render(true)
    }
    if (['onThemeToggle', 'toggleTheme'].includes(handler)) { theme = theme === 'ink' ? 'paper' : 'ink'; return render(true) }
    if (handler === 'onReduceToggle') { reduce = !reduce; return render(true) }
    if (handler === 'onWantTap' || handler === 'onWantDishTap' || handler === 'onAddCart') {
      const dish = bundle.dishes.find((entry) => entry._id === id) || bundle.dishes[0]
      if (!cart.some((entry) => entry._id === dish._id)) cart.push(dish)
      render(true)
      frame.addEventListener('load', () => notify('已加入演示点菜单 · ' + cart.length + ' 道'), { once: true })
      return
    }
    if (handler === 'goCart' || handler === 'onCartTap') return navigate('order-confirm')
    if (handler === 'onRemoveTap' && current === 'order-confirm') { cart = cart.filter((dish) => dish._id !== id); return render(true) }
    if (handler === 'onClearKeyword') { state.keyword = ''; return render(true) }
    if (handler === 'onSearchConfirm') return render(true)
    if (handler === 'onMenuTap') {
      const routes = { orders: 'my-orders', kitchen: 'kitchen', categories: 'category-manage', users: 'user-manage', adminOrders: 'admin-orders', banner: 'banner-manage' }
      return navigate(routes[data.key] || 'my')
    }
    if (handler === 'onStatDishTap') return navigate('list')
    if (handler === 'onAddTap' && current === 'list') return navigate('edit')
    if (handler === 'onEditTap') return navigate('edit')
    if (handler === 'onCmtSend') {
      if (!state.commentDraft?.trim()) return notify('请先写下一句话')
      state.commentList.unshift({ _id: 'local-' + Date.now(), content: state.commentDraft, timeText: '刚刚 · 仅本地演示' })
      state.commentTotal = state.commentList.length
      state.commentDraft = ''
      return render(true)
    }
    if (handler === 'onSubmit') return notify(current === 'order-confirm' ? '仅演示：此预览不会提交云端订单' : '仅演示：此预览不会保存云端数据')
    if (handler === 'onDoneTap') {
      const item = state.cooklist.find((entry) => entry._id === id)
      if (item) item.done = !item.done
      return render(true)
    }
    if (handler === 'onMessageTap') {
      const item = state.messages.find((entry) => entry._id === id)
      if (item) item.read = true
      state.unreadCount = state.messages.filter((entry) => !entry.read).length
      return render(true)
    }
    if (handler === 'onProfileTap') return notify('演示身份：林间客 · 管理员')
    notify('仅演示：' + handler + ' 不会写入云端')
  }

  frame.addEventListener('load', () => {
    const doc = frame.contentDocument
    frame.contentWindow.scrollTo(0, pendingScroll)
    doc.addEventListener('click', (event) => {
      const action = event.target.closest('[data-preview-tap], [data-preview-route]')
      if (!action) return
      event.preventDefault()
      if (action.dataset.previewRoute) route(action.dataset.previewRoute)
      else handle(action.dataset.previewTap, action)
    })
    doc.addEventListener('input', (event) => {
      const element = event.target
      const handler = element.dataset.previewInput
      const state = getState(current)
      const fields = { onSearchInput: 'keyword', onCmtInput: 'commentDraft', onNameInput: 'name', onDescriptionInput: 'description', onIngredientsInput: 'ingredientsText', onStepsInput: 'stepsText', onTagsInput: 'tagsText' }
      if (fields[handler]) state[fields[handler]] = element.value
    })
    doc.addEventListener('change', (event) => {
      if (event.target.dataset.previewChange === 'onCategoryChange') {
        getState(current).categoryIndex = Number(event.target.value)
        render(true)
      }
    })
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.dataset.previewConfirm) {
        event.preventDefault()
        handle(event.target.dataset.previewConfirm, event.target)
      }
    })
    doc.addEventListener('pointerdown', (event) => {
      const element = event.target.closest('[data-hover-class]')
      if (!element) return
      const names = element.dataset.hoverClass.trim().split(/\s+/)
      element.classList.add(...names)
      const clear = () => element.classList.remove(...names)
      doc.addEventListener('pointerup', clear, { once: true })
      doc.addEventListener('pointercancel', clear, { once: true })
    })
    frame.contentWindow.addEventListener('scroll', () => {
      if (current !== 'list') return
      const nav = doc.querySelector('.nav')
      if (!nav) return
      const old = nav.classList.contains('nav--scrolled')
      const next = old ? frame.contentWindow.scrollY > 16 : frame.contentWindow.scrollY > 44
      if (old !== next) nav.classList.toggle('nav--scrolled', next)
    }, { passive: true })
    doc.addEventListener('error', (event) => {
      if (event.target.tagName === 'IMG' && !event.target.dataset.previewFallback) {
        event.target.dataset.previewFallback = 'true'
        event.target.src = new URL(bundle.art, rootURL).href
      }
    }, true)
  })
  chooser.innerHTML = Object.values(bundle.pages).map((page) => '<option value="' + page.key + '">' + escape(page.label) + '</option>').join('')
  chooser.addEventListener('change', () => navigate(chooser.value))
  themeControl.addEventListener('change', () => { theme = themeControl.value; render(true) })
  reduceControl.addEventListener('change', () => { reduce = reduceControl.checked; render(true) })
  document.getElementById('preview-cart').addEventListener('click', () => navigate('order-confirm'))
  document.getElementById('reset-preview').addEventListener('click', () => { cart = []; Object.keys(states).forEach((key) => delete states[key]); navigate('list') })
  document.querySelectorAll('[data-shortcut]').forEach((element) => element.addEventListener('click', () => navigate(element.dataset.shortcut)))
  render()
}

const bundle = { pages, components, tabbar, tabs: app.tabBar.list, css, fixtures, dishes, categories, art }
const serialized = JSON.stringify(bundle).replace(/</g, '\\u003c')
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>坤坤食帖 · 青瓷山水设计预览</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#e7ece3;color:#213f36;font-family:"PingFang SC","Microsoft YaHei",sans-serif}button,select{font:inherit}button,select,input{accent-color:#2e6558}button{cursor:pointer}main{max-width:1120px;margin:auto;padding:42px 34px;display:grid;grid-template-columns:minmax(260px,1fr) 399px;gap:72px;align-items:start}.intro{padding-top:22px;position:sticky;top:32px}.kicker{font-size:11px;letter-spacing:4px;color:#637a6d}.title{font-family:"Songti SC","SimSun",serif;font-size:44px;font-weight:400;line-height:1.25;letter-spacing:5px;margin:22px 0 18px}.description{font-size:14px;line-height:1.9;color:#53695e;max-width:380px}.rule{height:1px;background:#c5d2c6;margin:28px 0}.controls{display:grid;gap:17px}.control{display:flex;align-items:center;justify-content:space-between;gap:20px;font-size:13px}.control select{border:1px solid #b6c8bb;border-radius:8px;background:#f6f8f0;color:#244c3d;padding:10px;max-width:220px}.control input{width:18px;height:18px}.shortcuts{display:flex;gap:8px;flex-wrap:wrap;margin-top:24px}.shortcuts button,.actions button{border:1px solid #bccbbd;border-radius:999px;padding:9px 15px;background:transparent;color:#385c4c;font-size:12px}.shortcuts button:hover,.actions button:hover{background:#f3f6ec}.actions{display:flex;gap:9px;margin:16px 0}.note{font-size:12px;line-height:1.8;color:#627569;margin-top:22px;max-width:390px}.note strong{color:#315747}.source{font-size:11px;line-height:1.8;color:#627569;word-break:break-all}details{margin-top:20px;font-size:11px;color:#627569}pre{white-space:pre-wrap;line-height:1.6;font-size:11px}.device{width:399px;padding:11px;background:#152b22;border-radius:47px;box-shadow:0 30px 80px #233b2425,0 0 0 1px #ffffff70;overflow:hidden}.device iframe{display:block;border:0;background:#f3f5ee;width:375px;height:812px;border-radius:36px}.device-caption{font-size:11px;letter-spacing:2px;text-align:center;margin:17px;color:#53695e}.build-meta{margin-top:24px;font-size:10px;color:#718477}@media(max-width:850px){main{display:flex;flex-direction:column;align-items:center;padding:20px 14px;gap:24px}.intro{position:static;width:min(100%,399px);padding-top:0}.title{font-size:32px}.description,.rule{display:none}.controls{gap:10px}.note{margin-top:14px}.device{max-width:100%}.device iframe{max-width:100%}}
.embed-mode{background:transparent}.embed-mode main{display:block;padding:0;width:399px;margin:0}.embed-mode .intro,.embed-mode .device-caption{display:none}.gallery-mode{background:#e7ece3}.gallery-mode main{display:none}#gallery{width:1760px;max-width:none;margin:0 auto;padding:30px 24px 20px}.gallery-head{display:flex;align-items:baseline;justify-content:space-between;padding:0 8px 24px;font-family:"Songti SC","SimSun",serif;font-size:27px;letter-spacing:5px}.gallery-head small{font-family:"PingFang SC",sans-serif;font-size:11px;letter-spacing:2px;color:#63796b}.gallery-grid{display:grid;grid-template-columns:repeat(4,399px);gap:34px;justify-content:center}.gallery-grid iframe{display:block;border:0;width:399px;height:836px;border-radius:47px;box-shadow:0 25px 65px #233b2420}.gallery-grid p{text-align:center;font-size:12px;color:#4f6a59;letter-spacing:3px;margin:20px 0 0}
body[data-theme="ink"] .device{background:#0c0c0c;box-shadow:0 30px 80px #0004,0 0 0 1px #ffffff16}body[data-theme="ink"] .device iframe{background:#181818}
</style></head><body><section id="gallery" hidden></section><main>
<section class="intro"><div class="kicker">KUNKUN · A TABLE IN CELADON</div><h1 class="title">一席山水<br>四时清欢</h1><p class="description">浅青如瓷，留白如纸。以山水长卷的疏密，重新安排一餐的阅读与相逢。</p><div class="rule"></div>
<div class="controls"><label class="control"><span>翻阅页面</span><select id="page-choice" aria-label="选择预览页面"></select></label><label class="control"><span>纸上山色</span><select id="theme-choice"><option value="paper">青瓷 · 日间</option><option value="ink">墨黑 · 暗色</option></select></label><label class="control"><span>减少动效</span><input type="checkbox" id="reduce-choice"></label></div>
<div class="shortcuts"><button data-shortcut="list">寻味</button><button data-shortcut="detail">一味</button><button data-shortcut="comments">食话</button><button data-shortcut="my">小院</button></div><div class="actions"><button id="preview-cart">演示点菜单 · <span id="cart-count">0</span> 道</button><button id="reset-preview">重置演示</button></div>
<p class="note"><strong>真实模板 · 隔离演示</strong><br>页面直接由项目 WXML / WXSS 转译。可点分类、菜品、想吃、底部导航及个人菜单；点菜单可增删，主题与减少动效可切换。示例姓名、菜谱、留言与订单仅用于布局演示，全部交互只在内存中进行，不写入云端。</p><p class="note">原小程序点菜单按菜品去重，没有份数模型。浏览器预览用于排版和交互检查；微信原生 API、上传、授权与云端操作需在开发者工具验证。</p><div class="source" id="source-path"></div><details><summary>模板插值检查</summary><pre id="diagnostics"></pre></details><div class="build-meta">由 scripts/build_ink_preview.js 生成 · 375 × 812 · ${Object.keys(pages).length} 个真实页面</div></section>
<section><div class="device"><iframe id="phone" title="坤坤食帖手机预览" sandbox="allow-same-origin"></iframe></div><div class="device-caption" id="current-name"></div></section>
</main><script>(${previewRuntime.toString()})(${serialized});</script></body></html>`
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, html, 'utf8')
// Check that the generated inline script is syntactically valid independently.
new vm.Script('(' + previewRuntime.toString() + ')(' + serialized + ')', { filename: 'ink-preview-inline.js' })
console.log('Built preview/ink-preview.html from ' + Object.keys(pages).length + ' WXML pages and ' + imported.size + ' WXSS sources (' + Buffer.byteLength(html) + ' bytes).')
