// utils/icons.js
// 图标资源统一出口：assets/icons 下的 PNG（由 SVG 源统一生成，96px @2x+）
// 小程序 image 组件对 URL 编码的 SVG data URI 渲染不可靠，生产做法是落地 PNG 资源
module.exports = {
  homeGray: '/assets/icons/home-gray.png',
  homeOrange: '/assets/icons/home-orange.png',
  userGray: '/assets/icons/user-gray.png',
  userOrange: '/assets/icons/user-orange.png',
  commentGray: '/assets/icons/comment-gray.png',
  commentOrange: '/assets/icons/comment-orange.png',
  plus: '/assets/icons/plus-orange.png',
  photo: '/assets/icons/photo-orange.png',
  tag: '/assets/icons/tag-orange.png',
  pencilWhite: '/assets/icons/pencil-white.png',
  trashGray: '/assets/icons/trash-gray.png',
  chevronLight: '/assets/icons/chevron-light.png',
  cameraWhite: '/assets/icons/camera-white.png'
}
