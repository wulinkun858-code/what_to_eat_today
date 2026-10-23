// 按业务域组织的数据访问；通过 utils/db.js 保持页面接口兼容。

function uploadImage(filePath, folder) {
  const matched = filePath.match(/\.[a-zA-Z0-9]+$/)
  const ext = matched ? matched[0].toLowerCase() : '.jpg'
  const cloudPath = (folder || 'dishes') + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 10) + ext
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => resolve(res.fileID),
      fail: (err) => {
        wx.showToast({ title: '上传失败，请重试', icon: 'none' })
        reject(err)
      }
    })
  })
}

function deleteCloudFile(fileID) {
  const fileList = Array.from(new Set((Array.isArray(fileID) ? fileID : [fileID])
    .filter((file) => typeof file === 'string' && file.indexOf('cloud://') === 0)))
  if (!fileList.length) return Promise.resolve()
  return new Promise((resolve) => {
    wx.cloud.deleteFile({
      fileList,
      success: resolve,
      fail: (err) => {
        console.error('[db] deleteFile', err)
        resolve()
      }
    })
  })
}

module.exports = { uploadImage, deleteCloudFile }
