const { fail, id } = require('./context')

const TERMINAL = ['done', 'canceled']
const TRANSITIONS = { pending: ['cooking', 'done', 'canceled'], cooking: ['done', 'canceled'], done: [], canceled: [] }

function assertTransition(from, to) {
  if (from === to) return
  if (!TRANSITIONS[from] || !TRANSITIONS[from].includes(to)) fail('订单状态不能回退或重新开启')
}

module.exports = function createOrderState({ db, readTx }) {
  async function messageIds(orderId) {
    const result = await db.collection('messages').where({ orderId: id(orderId, '订单') }).limit(100).get()
    return result.data.map((message) => message._id)
  }

  async function load(tx, orderId) {
    const order = await readTx(tx, 'orders', orderId)
    if (!order) fail('订单不存在')
    return order
  }

  async function transition(tx, order, status, messages, patch = {}) {
    assertTransition(order.status, status)
    const now = new Date()
    const history = order.statusHistory || []
    await tx.collection('orders').doc(order._id).update({ data: Object.assign({}, patch, {
      status,
      updatedAt: now,
      statusHistory: order.status === status ? history : history.concat({ status, time: now })
    }) })
    for (const messageId of messages) {
      await tx.collection('messages').doc(messageId).update({ data: { orderStatus: status } })
    }
  }

  return { messageIds, load, transition, isTerminal: (status) => TERMINAL.includes(status) }
}

module.exports.assertTransition = assertTransition
