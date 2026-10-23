const { definePage } = require('../../utils/page')
const pagination = require('../../utils/pagination')
// pages/user-manage/user-manage.js
// 用户管理（管理员）：查看所有使用小程序的人，点用户行授权角色（食客/厨师/管理员）
const biz = require('../../utils/biz')
const role = require('../../utils/role')
const { formatRelative } = require('../../utils/format')


const ROLE_ACTIONS = [
  { role: 'diner', label: '设为食客' },
  { role: 'chef', label: '设为厨师' },
  { role: 'admin', label: '设为管理员' }
]

Page(definePage({
  onUnload() {
    pagination.dispose(this)
    clearTimeout(this._highlightTimer)
  },
  data: {
    list: [], // [{ openid, nickname, avatarFileID, roleLabel, roleCls, activeText }]
    total: 0,
    page: 1,
    loading: false,
    noMore: false
  },


  onShow() {
    if (role.isAdmin()) this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.loading || this.data.noMore) return
    this.fetchPage(this.data.page + 1)
  },

  refresh() {
    return this.fetchPage(1)
  },

  fetchPage(page) {
    return pagination.loadPage(this, page, (number) => biz.call('userList', { page: number, pageSize: 20 }), (user) => ({
        openid: user.openid,
        nickname: user.nickname || '未设置昵称',
        avatarFileID: user.avatarFileID,
        role: user.role,
        roleLabel: role.roleLabel(user.role),
        roleCls: `role-${user.role || 'diner'}`,
        activeText: formatRelative(user.lastActiveAt || user.createdAt),
        self: user.openid === role.getOpenid()
    }))
  },

  // 点击用户：ActionSheet 授权角色（自己不可改，云函数兜底）
  onUserTap(e) {
    const index = e.currentTarget.dataset.index
    const user = this.data.list[index]
    if (!user) return
    if (user.self) {
      wx.showToast({ title: '不能修改自己的角色', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: ROLE_ACTIONS.map((a) => a.label),
      success: (res) => {
        const action = ROLE_ACTIONS[res.tapIndex]
        if (!action || action.role === user.role) return
        biz.call('roleSet', { targetOpenid: user.openid, role: action.role }).then(() => {
          wx.showToast({ title: '已更新为' + role.roleLabel(action.role), icon: 'success' })
          this.refresh()
        }).catch(() => {
          // 错误提示由 biz 层统一 toast
        })
      },
      fail: () => {
        // 用户取消
      }
    })
  }
}, 'admin'))
