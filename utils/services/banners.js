// 按业务域组织的数据访问；通过 utils/db.js 保持页面接口兼容。
const { database, collection } = require('../collection')
const { reportError } = require('../errors')
const biz = require('../biz')
const BANNER_MAX = 5

function getBanners() {
  return collection('banners').where({ _openid: '{openid}' })
    .field({ fileID: true })
    .orderBy('createdAt', 'desc')
    .limit(BANNER_MAX)
    .get()
    .then((res) => res.data)
    .catch((err) => reportError(err, '轮播图加载失败'))
}

function addBanners(fileIDs) {
  const tasks = (fileIDs || []).map((fileID) => collection('banners').add({
    data: { fileID, createdAt: database().serverDate() }
  }))
  return Promise.all(tasks)
    .catch((err) => reportError(err, '轮播图保存失败'))
}

function removeAllBanners() {
  return biz.call('bannerClear', {}).then((res) => res.removed)
}

function removeBanner(id) {
  return biz.call('bannerRemove', { bannerId: id })
}

module.exports = { BANNER_MAX, getBanners, addBanners, removeAllBanners, removeBanner }
