module.exports = function createServices(context) {
  return Object.assign({},
    require('./profile')(context),
    require('./dishes')(context),
    require('./orders')(context),
    require('./kitchen')(context),
    require('./content')(context),
    require('./categories')(context),
    require('./admin')(context)
  )
}
