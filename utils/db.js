// 兼容门面：页面继续使用原接口，具体职责由 services 中的业务模块承担。
module.exports = Object.assign({},
  require('./services/dishes'),
  require('./services/comments'),
  require('./services/banners'),
  require('./services/storage'),
  require('./services/orders'),
  require('./services/categories')
)
