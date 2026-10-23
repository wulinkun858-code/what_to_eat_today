// 延迟获取数据库：模块加载时 App.onLaunch 可能尚未执行 cloud.init。
const PAGE_SIZE = 20
const MAX_LIMIT = 100

function database() {
  return wx.cloud.database()
}

function collection(name) {
  return database().collection(name)
}

function pageNumber(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 1
}

async function queryPage(query, page, fields) {
  let rows = fields ? query.field(fields) : query
  rows = rows.skip((pageNumber(page) - 1) * PAGE_SIZE).limit(PAGE_SIZE)
  const [count, result] = await Promise.all([query.count(), rows.get()])
  return { list: result.data, total: count.total }
}

module.exports = { database, collection, pageNumber, queryPage, PAGE_SIZE, MAX_LIMIT }
