const { fail } = require('../lib/context')

module.exports = function createProfileService({ db, readTx, deleteFiles }) {
  function defaults(now) {
    return { role: 'diner', nickname: '', avatarFileID: '', createdAt: now, lastActiveAt: now }
  }

  async function ensureProfile(_payload, openid) {
    return db.runTransaction(async (tx) => {
      const ref = tx.collection('profile').doc(openid)
      const existing = await readTx(tx, 'profile', openid)
      const now = new Date()
      if (existing) {
        await ref.update({ data: { lastActiveAt: now } })
        return Object.assign({}, existing, { openid, lastActiveAt: now })
      }
      const profile = defaults(now)
      await ref.set({ data: profile })
      return Object.assign({ openid }, profile)
    })
  }

  async function setProfile(payload, openid) {
    const patch = {}
    if (payload.nickname !== undefined) {
      if (typeof payload.nickname !== 'string') fail('昵称格式无效')
      const nickname = payload.nickname.trim()
      if (!nickname || nickname.length > 20) fail('昵称需为 1-20 个字')
      patch.nickname = nickname
    }
    if (payload.avatarFileID !== undefined) {
      if (typeof payload.avatarFileID !== 'string' ||
          (payload.avatarFileID && !payload.avatarFileID.startsWith('cloud://'))) fail('头像格式无效')
      patch.avatarFileID = payload.avatarFileID
    }
    if (!Object.keys(patch).length) fail('没有需要保存的变更')
    const oldFile = await db.runTransaction(async (tx) => {
      const old = await readTx(tx, 'profile', openid)
      const ref = tx.collection('profile').doc(openid)
      const data = Object.assign({}, patch, { updatedAt: new Date() })
      if (old) await ref.update({ data })
      else await ref.set({ data: Object.assign(defaults(new Date()), data) })
      return old && old.avatarFileID
    })
    // 读取旧值必须在更新之前；等待清理结束，避免云函数提前退出。
    if (patch.avatarFileID !== undefined && oldFile && oldFile !== patch.avatarFileID) await deleteFiles([oldFile])
    return true
  }

  return { ensureProfile, setProfile }
}
