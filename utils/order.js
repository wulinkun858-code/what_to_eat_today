const STATUS_META = {
  pending: { text: '待处理', cls: 'st-pending', char: '候', step: 0 },
  cooking: { text: '制作中', cls: 'st-cooking', char: '炊', step: 1 },
  done: { text: '已完成', cls: 'st-done', char: '膳', step: 2 },
  canceled: { text: '已取消', cls: 'st-canceled', char: '罢', step: -1 }
}

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.pending
}

function groupByChef(items) {
  const groups = new Map()
  items.forEach((item) => {
    const key = item.chefOpenid || item.chefNickname || '厨师'
    if (!groups.has(key)) groups.set(key, { chefNickname: item.chefNickname || '厨师', items: [] })
    groups.get(key).items.push(item)
  })
  return Array.from(groups.values())
}

module.exports = { STATUS_META, statusMeta, groupByChef }
