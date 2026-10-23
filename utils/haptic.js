// utils/haptic.js
// 触觉反馈：对齐 iOS UIImpactFeedbackGenerator（light / medium / heavy）
// 说明：
//   1. 触觉只是「增强」，不能成为传达信息的唯一方式（HIG Motion 原则）；
//   2. 部分机型、静音模式或系统设置下不可用，统一 try/catch 静默降级；
//   3. 高频交互（滚动、输入）不要调用，只用于「有结果」的动作。
function vibrate(type) {
  try {
    if (typeof wx.vibrateShort !== 'function') return
    wx.vibrateShort({
      type,
      fail: () => {}
    })
  } catch (e) {
    // 忽略：不支持触觉的设备
  }
}

module.exports = {
  // 轻：点选、切换 tab、加入点菜单
  light() {
    vibrate('light')
  },
  // 中：提交成功、删除等有明确结果的确认
  medium() {
    vibrate('medium')
  },
  // 重：错误 / 危险操作
  heavy() {
    vibrate('heavy')
  }
}
