const crypto = require('crypto')

class BusinessError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BusinessError'
  }
}

function fail(message) {
  throw new BusinessError(message)
}

function id(value, label = '记录') {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) fail(label + ' ID 无效')
  return value
}

function pageOptions(payload, defaultSize = 20) {
  const page = Number(payload.page === undefined ? 1 : payload.page)
  const pageSize = Number(payload.pageSize === undefined ? defaultSize : payload.pageSize)
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) fail('分页参数无效')
  return { page, pageSize }
}

function stableId(...parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)
}

function createContext(cloud) {
  const db = cloud.database({ throwOnNotFound: false })
  // 普通查询用 where 得到空数组，避免把网络错误误当成文档不存在。
  async function read(name, key) {
    const result = await db.collection(name).where({ _id: id(key) }).limit(1).get()
    return result.data[0] || null
  }

  // SDK 的事务 doc.get 在缺失时返回 data: null，不捕获其他数据库错误。
  async function readTx(tx, name, key) {
    const result = await tx.collection(name).doc(id(key)).get()
    return result.data || null
  }

  async function getRole(openid) {
    const profile = await read('profile', openid)
    return profile && profile.role || 'diner'
  }

  async function requireRole(openid, roles) {
    const role = await getRole(openid)
    if (!roles.includes(role)) fail('无权限执行该操作')
    return role
  }

  async function deleteFiles(files) {
    const unique = Array.from(new Set(files.filter((file) => typeof file === 'string' && file.startsWith('cloud://'))))
    for (let start = 0; start < unique.length; start += 50) {
      try {
        const result = await cloud.deleteFile({ fileList: unique.slice(start, start + 50) })
        const failed = (result.fileList || []).filter((file) => file.status !== 0)
        if (failed.length) console.error('[storage] cleanup incomplete', failed)
      } catch (error) {
        console.error('[storage] cleanup failed', error)
      }
    }
  }

  async function removeMatching(name, where, filesOf = () => []) {
    let removed = 0
    for (;;) {
      const result = await db.collection(name).where(where).limit(100).get()
      if (!result.data.length) return removed
      for (const row of result.data) {
        await db.collection(name).doc(row._id).remove()
        await deleteFiles(filesOf(row))
        removed += 1
      }
    }
  }

  return { cloud, db, read, readTx, getRole, requireRole, deleteFiles, removeMatching }
}

module.exports = { BusinessError, fail, id, pageOptions, stableId, createContext }
