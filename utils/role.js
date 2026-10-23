// utils/role.js
// 角色服务：启动时经云函数 ensureProfile 登记/刷新身份，缓存到 globalData 与本地
// 页面在 onShow 调 ensureProfile() 拿最新角色（并发自动去重），再用 isChef/isAdmin 判定显隐
const biz = require('./biz')

let inflight = null
let lastEnsure = 0
const ENSURE_INTERVAL = 30 * 1000 // 限频：30 秒内复用缓存身份，减少云函数调用

/**
 * 登记/刷新当前用户身份（并发去重 + 30s 限频；失败回退本地缓存）
 * @param {boolean} force 跳过限频强制刷新（改完昵称/头像后用）
 * @returns {Promise<Object|null>} profile（含 openid / role / nickname / avatarFileID）
 */
function ensureProfile(force) {
  if (inflight) return inflight
  if (!force && Date.now() - lastEnsure < ENSURE_INTERVAL) {
    return Promise.resolve(getProfile())
  }
  inflight = biz.call('ensureProfile', {}).then((profile) => {
    lastEnsure = Date.now()
    const app = getApp()
    if (app) {
      app.globalData = app.globalData || {}
      app.globalData.profile = profile
    }
    try {
      wx.setStorageSync('profile', profile)
    } catch (error) {
      console.warn('[profile] cache write failed', error)
    }
    return profile
  }).catch(() => {
    lastEnsure = Date.now() // 失败同样限频，避免故障时反复打云函数
    return getProfile()
  }).finally(() => {
    inflight = null
  })
  return inflight
}

// 读取缓存的身份信息
function getProfile() {
  const app = getApp()
  if (app && app.globalData && app.globalData.profile) return app.globalData.profile
  try {
    const profile = wx.getStorageSync('profile')
    return profile && typeof profile === 'object' ? profile : null
  } catch (error) {
    console.warn('[profile] cache read failed', error)
    return null
  }
}

function getOpenid() {
  const profile = getProfile()
  return (profile && profile.openid) || ''
}

function getRole() {
  const profile = getProfile()
  return (profile && profile.role) || 'diner'
}

function getNickname() {
  const profile = getProfile()
  return (profile && profile.nickname) || ''
}

// 厨师或管理员（可管理菜品/使用工作台）
function isChef() {
  const role = getRole()
  return role === 'chef' || role === 'admin'
}

function isAdmin() {
  return getRole() === 'admin'
}

// 判断某文档是否本人（如菜品归属）
function isOpenid(id) {
  const openid = getOpenid()
  return !!openid && openid === id
}

const ROLE_LABELS = { diner: '食客', chef: '厨师', admin: '管理员' }
function roleLabel(role) {
  return ROLE_LABELS[role || getRole()] || '食客'
}

module.exports = { ensureProfile, getProfile, getOpenid, getRole, getNickname, isChef, isAdmin, isOpenid, roleLabel }
