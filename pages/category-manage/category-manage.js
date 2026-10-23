const { definePage } = require('../../utils/page')
// pages/category-manage/category-manage.js
// 菜品分类管理（管理员）：新增 / 重命名 / 删除菜品品类
// 删除时引用该分类的菜品自动回到「未分类」（云函数处理）
const dbService = require('../../utils/db')
const biz = require('../../utils/biz')
const role = require('../../utils/role')

Page(definePage({
  data: {
    list: [], // [{ _id, name }]
    loading: true
  },


  onShow() {
    if (role.isAdmin()) this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  refresh() {
    return dbService.getCategories().then((list) => {
      this.setData({ list, loading: false })
    }).catch(() => {
      this.setData({ loading: false })
    })
  },

  // 新增分类（弹窗输入）
  onAddTap() {
    wx.showModal({
      title: '新增分类',
      editable: true,
      placeholderText: '输入分类名（最多 10 个字）',
      success: (res) => {
        if (!res.confirm) return
        const name = (res.content || '').trim()
        if (!name) {
          wx.showToast({ title: '分类名不能为空', icon: 'none' })
          return
        }
        biz.call('categoryAdd', { name }).then(() => {
          wx.showToast({ title: '已添加', icon: 'success' })
          this.refresh()
        }).catch(() => {
          // 错误提示由 biz 层统一 toast
        })
      }
    })
  },

  // 点击分类：重命名 / 删除
  onItemTap(e) {
    const index = e.currentTarget.dataset.index
    const item = this.data.list[index]
    if (!item) return
    wx.showActionSheet({
      itemList: ['重命名', '删除分类'],
      success: (res) => {
        if (res.tapIndex === 0) this.rename(item)
        else this.remove(item)
      },
      fail: () => {
        // 用户取消
      }
    })
  },

  rename(item) {
    wx.showModal({
      title: '重命名分类',
      editable: true,
      content: item.name,
      success: (res) => {
        if (!res.confirm) return
        const name = (res.content || '').trim()
        if (!name || name === item.name) return
        biz.call('categoryUpdate', { categoryId: item._id, name }).then(() => {
          wx.showToast({ title: '已保存', icon: 'success' })
          this.refresh()
        }).catch(() => {
          // 错误提示由 biz 层统一 toast
        })
      }
    })
  },

  remove(item) {
    wx.showModal({
      title: '删除分类',
      content: `确定删除「${item.name}」吗？该分类下的菜品将变为未分类（菜品本身保留）。`,
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm) return
        biz.call('categoryDelete', { categoryId: item._id }).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' })
          this.refresh()
        }).catch(() => {
          // 错误提示由 biz 层统一 toast
        })
      }
    })
  }
}, 'admin'))
