const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createCloud } = require('./helpers/database')
const { createContext } = require('../cloudfunctions/biz/lib/context')
const createServices = require('../cloudfunctions/biz/services')
const { createRouter } = require('../cloudfunctions/biz/lib/router')
const { buildSearchTokens } = require('../utils/tokenizer')

function setup(extra = {}) {
  const cloud = createCloud(Object.assign({
    profile: { diner: { role: 'diner', nickname: '食客甲' }, chef: { role: 'chef', nickname: '厨师甲' }, chef2: { role: 'chef' }, admin: { role: 'admin' } },
    dishes: { a: { name: '炒饭', _openid: 'chef' }, b: { name: '汤', _openid: 'chef2' }, c: { name: '面', _openid: 'chef' } }
  }, extra))
  const service = createServices(createContext(cloud))
  return { cloud, service }
}

test('下单原子写入订单与所有厨师消息，相同请求重试只返回原订单', async () => {
  const { cloud, service } = setup()
  const request = { dishIds: ['a', 'b', 'a'], requestId: 'retry-1' }
  const [one, two] = await Promise.all([service.orderCreate(request, 'diner'), service.orderCreate(request, 'diner')])
  assert.equal(one.orderId, two.orderId)
  assert.equal(Object.keys(cloud.snapshot().orders).length, 1)
  const messages = Object.values(cloud.snapshot().messages)
  assert.equal(messages.length, 2)
  assert.ok(messages.every((row) => row.items.length === 1))
  await assert.rejects(service.orderCreate({ dishIds: ['c'], requestId: 'retry-1' }, 'diner'), /内容已变化/)
})

test('厨师消息写入失败时订单也回滚', async () => {
  const { cloud, service } = setup()
  cloud.failWrites((name) => name === 'messages')
  await assert.rejects(service.orderCreate({ dishIds: ['a'] }, 'diner'), /injected/)
  assert.equal(Object.keys(cloud.snapshot().orders || {}).length, 0)
})

test('多厨师并发接单和完成，重复点击不会重复制作，全部完成才完结', async () => {
  const { cloud, service } = setup()
  const { orderId } = await service.orderCreate({ dishIds: ['a', 'b'] }, 'diner')
  await Promise.all([service.cooklistAdd({ orderId }, 'chef'), service.cooklistAdd({ orderId }, 'chef'), service.cooklistAdd({ orderId }, 'chef2')])
  const items = Object.entries(cloud.snapshot().cooklist)
  assert.equal(items.length, 2)
  assert.equal(cloud.snapshot().orders[orderId].status, 'cooking')
  await Promise.all(items.map(([cookId, item]) => service.cooklistDone({ cookId }, item._openid)))
  const order = cloud.snapshot().orders[orderId]
  assert.equal(order.status, 'done')
  assert.deepEqual(order.statusHistory.map((item) => item.status), ['pending', 'cooking', 'done'])
  assert.ok(Object.values(cloud.snapshot().messages).every((row) => row.orderStatus === 'done'))
  await assert.rejects(service.orderStatus({ orderId, status: 'pending' }, 'admin'), /不能回退/)
})

test('取消后同步消息，拒绝越权取消、取消后制作和无关菜品挂单', async () => {
  const { cloud, service } = setup()
  const { orderId } = await service.orderCreate({ dishIds: ['a'] }, 'diner')
  await assert.rejects(service.orderCancel({ orderId }, 'chef'), /自己的订单/)
  await assert.rejects(service.cooklistAdd({ orderId, dishId: 'c' }, 'chef'), /没有你选择/)
  await service.orderCancel({ orderId }, 'diner')
  assert.ok(Object.values(cloud.snapshot().messages).every((row) => row.orderStatus === 'canceled'))
  await assert.rejects(service.cooklistAdd({ orderId }, 'chef'), /已结束/)
})

test('已下架菜品仍按订单快照制作，完成记录移除后不丢完成凭据', async () => {
  const { cloud, service } = setup()
  const { orderId } = await service.orderCreate({ dishIds: ['a', 'c'] }, 'diner')
  await service.dishDelete({ dishId: 'a' }, 'chef')
  await service.cooklistAdd({ orderId }, 'chef')
  const items = Object.entries(cloud.snapshot().cooklist)
  await service.cooklistDone({ cookId: items[0][0] }, 'chef')
  assert.equal(cloud.snapshot().orders[orderId].status, 'cooking')
  await service.cooklistRemove({ cookId: items[0][0] }, 'chef')
  assert.equal((await service.cooklistAdd({ orderId }, 'chef')).added, 0)
  await service.cooklistDone({ cookId: items[1][0] }, 'chef')
  assert.equal(cloud.snapshot().orders[orderId].status, 'done')
})

test('资料并发建档不重置角色，读失败不得覆盖已有资料，换头像清理旧文件', async () => {
  const { cloud, service } = setup({ profile: { admin: { role: 'admin', avatarFileID: 'cloud://old' } } })
  await Promise.all([service.ensureProfile({}, 'admin'), service.setProfile({ nickname: '新昵称' }, 'admin')])
  assert.equal(cloud.snapshot().profile.admin.role, 'admin')
  await service.setProfile({ avatarFileID: 'cloud://new' }, 'admin')
  assert.deepEqual(cloud.deletedFiles, ['cloud://old'])
  cloud.failReads(true)
  await assert.rejects(service.ensureProfile({}, 'admin'), /injected/)
  assert.equal(cloud.snapshot().profile.admin.role, 'admin')
})

test('菜品以服务端数据生成分类、作者、封面和搜索词，管理员编辑保留原厨师', async () => {
  const { cloud, service } = setup({ categories: { rice: { name: '主食', order: 1 } } })
  await service.dishSave({ dishId: 'a', dish: { name: '鸡蛋饭', categoryId: 'rice', categoryName: '伪造', chefNickname: '伪造', images: ['cloud://one'], image: 'cloud://fake', searchTokens: ['fake'] } }, 'admin')
  const dish = cloud.snapshot().dishes.a
  assert.equal(dish.chefNickname, '厨师甲')
  assert.equal(dish.categoryName, '主食')
  assert.equal(dish.image, 'cloud://one')
  assert.deepEqual(dish.searchTokens, buildSearchTokens(['鸡蛋饭']))
  await assert.rejects(service.dishSave({ dishId: 'a', dish: { name: '伪造' } }, 'diner'), /自己的菜品/)
})

test('级联删除和清空突破单次 100 条上限，且只处理本人轮播图', async () => {
  const comments = Object.fromEntries(Array.from({ length: 105 }, (_, i) => ['comment' + i, { dishId: 'a' }]))
  const banners = Object.fromEntries(Array.from({ length: 103 }, (_, i) => ['banner' + i, { _openid: 'diner', fileID: 'cloud://' + i }]))
  banners.other = { _openid: 'chef', fileID: 'cloud://keep' }
  const { cloud, service } = setup({ comments, banners })
  await service.dishDelete({ dishId: 'a' }, 'chef')
  assert.equal(Object.keys(cloud.snapshot().comments).length, 0)
  assert.deepEqual(await service.bannerClear({}, 'diner'), { removed: 103 })
  assert.deepEqual(Object.keys(cloud.snapshot().banners), ['other'])
})

test('路由拒绝原型方法和畸形参数，分页、身份及权限校验生效', async () => {
  const { cloud, service } = setup()
  const router = createRouter(cloud, service)
  assert.equal((await router({ action: 'toString' })).ok, false)
  assert.equal((await router({ action: 'ensureProfile', payload: [] })).ok, false)
  await assert.rejects(service.userList({ pageSize: -1 }, 'admin'), /分页/)
  await assert.rejects(service.roleSet({ targetOpenid: 'admin', role: 'diner' }, 'admin'), /自己的角色/)
  await assert.rejects(service.adminOrders({}, 'diner'), /无权限/)
  await assert.rejects(service.orderCreate({ dishIds: 'abc' }, 'diner'), /选择/)
})

test('状态同步写入失败时完成记录与订单状态同时回滚', async () => {
  const { cloud, service } = setup()
  const { orderId } = await service.orderCreate({ dishIds: ['a'] }, 'diner')
  await service.cooklistAdd({ orderId }, 'chef')
  const cookId = Object.keys(cloud.snapshot().cooklist)[0]
  cloud.failWrites((name) => name === 'messages')
  await assert.rejects(service.cooklistDone({ cookId }, 'chef'), /injected/)
  assert.equal(cloud.snapshot().cooklist[cookId].done, false)
  assert.equal(cloud.snapshot().orders[orderId].status, 'cooking')
})

test('旧订单随机 ID 制作记录兼容去重与完成，制作中的订单不能被食客取消', async () => {
  const { cloud, service } = setup({
    orders: { legacy: { _openid: 'diner', status: 'cooking', items: [{ dishId: 'a', chefOpenid: 'chef' }, { dishId: 'b', chefOpenid: 'chef2' }] } },
    cooklist: { old1: { _openid: 'chef', dishId: 'a', orderId: 'legacy', done: true }, old2: { _openid: 'chef2', dishId: 'b', orderId: 'legacy', done: false } }
  })
  assert.equal((await service.cooklistAdd({ orderId: 'legacy' }, 'chef')).added, 0)
  await assert.rejects(service.orderCancel({ orderId: 'legacy' }, 'diner'), /已开始制作/)
  await service.cooklistDone({ cookId: 'old2' }, 'chef2')
  assert.equal(cloud.snapshot().orders.legacy.status, 'done')
})

test('分类重命名和删除同步菜品；消息、评论和轮播图校验归属', async () => {
  const { cloud, service } = setup({
    categories: { rice: { name: '米饭', order: 1 } },
    dishes: { a: { name: '炒饭', _openid: 'chef', categoryId: 'rice', categoryName: '米饭' } },
    messages: { m: { _openid: 'chef', read: false } },
    comments: { c: { _openid: 'diner' } }, banners: { b: { _openid: 'chef' } }
  })
  await service.categoryUpdate({ categoryId: 'rice', name: '主食' }, 'admin')
  assert.equal(cloud.snapshot().dishes.a.categoryName, '主食')
  await assert.rejects(service.categoryAdd({ name: '主食' }, 'admin'), /同名/)
  await service.categoryDelete({ categoryId: 'rice' }, 'admin')
  assert.equal(cloud.snapshot().dishes.a.categoryId, '')
  await assert.rejects(service.messageRead({ messageId: 'm' }, 'diner'), /自己的消息/)
  await assert.rejects(service.commentRemove({ commentId: 'c' }, 'chef'), /自己的评论/)
  await assert.rejects(service.bannerRemove({ bannerId: 'b' }, 'diner'), /自己的轮播图/)
  await service.messageRead({ messageId: 'm' }, 'chef')
  assert.equal(cloud.snapshot().messages.m.read, true)
})
