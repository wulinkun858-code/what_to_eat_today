// utils/ui.js
// 界面度量：自定义导航栏需要与系统状态栏 / 胶囊按钮对齐
// 统一用 px（导航区域尺寸与状态栏同为 px，避免 rpx 在 calc 中的兼容问题）

/**
 * 获取导航栏度量信息
 * @returns {{statusBarHeight:number, navBarHeight:number, searchRowHeight:number,
 *            navHeight:number, windowWidth:number, windowHeight:number, safeBottom:number}}
 */
function getNavMetrics() {
  let info = {}
  try {
    info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
  } catch (e) {
    info = {}
  }

  const statusBarHeight = info.statusBarHeight || 20
  const windowWidth = info.windowWidth || 375
  const windowHeight = info.windowHeight || 667
  const safeBottom = info.safeArea ? Math.max(0, windowHeight - info.safeArea.bottom) : 0

  // 标题行高度：优先按胶囊按钮上下留白对称推算（iOS 标准 44pt）
  let navBarHeight = 44
  try {
    const rect = wx.getMenuButtonBoundingClientRect()
    if (rect && rect.height && rect.top >= statusBarHeight) {
      navBarHeight = (rect.top - statusBarHeight) * 2 + rect.height
    }
  } catch (e) {
    navBarHeight = 44
  }

  // 搜索行固定 54px（约 108rpx），与下方的 rpx 样式对齐
  const searchRowHeight = 54

  return {
    statusBarHeight,
    navBarHeight,
    searchRowHeight,
    navHeight: statusBarHeight + navBarHeight + searchRowHeight,
    windowWidth,
    windowHeight,
    safeBottom
  }
}

module.exports = { getNavMetrics }
