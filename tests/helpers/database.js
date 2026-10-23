// 独立内存数据库，事务回滚/串行执行；不接触任何真实云资源。
function createCloud(seed = {}) {
  let data = structuredClone(seed)
  let sequence = 0
  let queue = Promise.resolve()
  const deletedFiles = []
  let failWrite = null
  let failRead = false
  function database(state, transactional = false) {
    return {
      collection(name) {
        const table = () => state()[name] || (state()[name] = {})
        const write = (key) => { if (failWrite && failWrite(name, key)) throw new Error('injected write failure') }
        function query(where = {}, offset = 0, limit = 100, sort = null) {
          const rows = () => {
            if (failRead) throw new Error('injected read failure')
            let list = Object.entries(table()).map(([key, row]) => Object.assign({ _id: key }, structuredClone(row)))
              .filter((row) => Object.entries(where).every(([key, value]) => row[key] === value))
            if (sort) list.sort((a, b) => (a[sort[0]] > b[sort[0]] ? 1 : a[sort[0]] < b[sort[0]] ? -1 : 0) * (sort[1] === 'desc' ? -1 : 1))
            return list
          }
          return {
            where: (next) => query(next, offset, limit, sort),
            skip: (next) => query(where, next, limit, sort),
            limit: (next) => query(where, offset, next, sort),
            field: () => query(where, offset, limit, sort),
            orderBy: (field, direction) => query(where, offset, limit, [field, direction]),
            get: async () => ({ data: rows().slice(offset, offset + limit) }),
            count: async () => ({ total: rows().length }),
            update: async ({ data: patch }) => {
              const list = rows()
              list.forEach((row) => { write(row._id); Object.assign(table()[row._id], patch) })
              return { stats: { updated: list.length } }
            }
          }
        }
        return Object.assign(transactional ? {} : query(), {
          doc(key) {
            if (typeof key !== 'string' || !key) throw new Error('Invalid document ID')
            return {
              async get() {
                if (failRead) throw new Error('injected read failure')
                return { data: table()[key] ? Object.assign({ _id: key }, structuredClone(table()[key])) : null }
              },
              async set({ data: value }) { write(key); table()[key] = structuredClone(value); return { _id: key } },
              async update({ data: patch }) {
                write(key)
                if (!table()[key]) throw new Error('Missing document')
                Object.assign(table()[key], structuredClone(patch))
                return { stats: { updated: 1 } }
              },
              async remove() { write(key); delete table()[key]; return { stats: { removed: 1 } } }
            }
          },
          async add({ data: value }) {
            const key = 'auto-' + (++sequence)
            write(key); table()[key] = structuredClone(value)
            return { _id: key }
          }
        })
      }
    }
  }
  const db = database(() => data)
  db.runTransaction = (work) => {
    const operation = queue.then(async () => {
      const snapshot = structuredClone(data)
      const result = await work(database(() => snapshot, true))
      data = snapshot
      return result
    })
    queue = operation.catch(() => undefined)
    return operation
  }
  return {
    database: () => db,
    getWXContext: () => ({ OPENID: 'diner' }),
    deleteFile: async ({ fileList }) => { deletedFiles.push(...fileList); return { fileList: fileList.map((fileID) => ({ fileID, status: 0 })) } },
    snapshot: () => structuredClone(data),
    deletedFiles,
    failWrites: (predicate) => { failWrite = predicate },
    failReads: (value) => { failRead = value }
  }
}

module.exports = { createCloud }
