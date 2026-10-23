// 页面分页状态机：刷新覆盖旧请求，追加去重，失败保留数据，卸载后禁止回写。
async function loadPage(page, number, request, decorate = (row) => row, afterLoad) {
  if (page._disposed || (number > 1 && (page.data.loading || page.data.noMore))) return
  const token = page._fetchToken = (page._fetchToken || 0) + 1
  const current = () => !page._disposed && token === page._fetchToken
  page.setData({ loading: true })
  try {
    const result = await request(number)
    if (!current()) return
    const rows = result.list.map(decorate)
    const combined = number === 1 ? rows : page.data.list.concat(rows)
    const seen = new Set()
    const list = combined.filter((row) => {
      const key = row._id || row.openid
      if (!key) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    page.setData({ list, total: result.total, page: number, noMore: !rows.length || list.length >= result.total })
    if (afterLoad) afterLoad(list)
    return result
  } catch (error) {
    // 服务层已经提示；这里保留旧页与页码，允许用户重试。
    return undefined
  } finally {
    if (current()) page.setData({ loading: false })
  }
}

function dispose(page) {
  page._disposed = true
  page._fetchToken = (page._fetchToken || 0) + 1
}

module.exports = { loadPage, dispose }
