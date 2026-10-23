// 按业务域组织的数据访问；通过 utils/db.js 保持页面接口兼容。
const { collection } = require('../collection')
const { reportError } = require('../errors')

function getCategories() {
  return collection('categories').orderBy('order', 'asc')
    .limit(50)
    .get()
    .then((res) => res.data)
    .catch((err) => reportError(err, '分类加载失败'))
}

module.exports = { getCategories }
