// 部署入口只负责初始化与装配，业务服务通过 context 注入数据库依赖。
const cloud = require('wx-server-sdk')
const { createContext } = require('./lib/context')
const { createRouter } = require('./lib/router')
const createServices = require('./services')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
exports.main = createRouter(cloud, createServices(createContext(cloud)))
