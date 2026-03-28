const authMiddleware = require('./auth.middleware')

function sprechenAuth(req, res, next) {
  authMiddleware(req, res, () => {
    req.user = {
      _id: req.userId,
      prenom: req.userPrenom,
      nom: req.userNom,
      email: req.userEmail,
    }

    next()
  })
}

module.exports = {
  sprechenAuth,
}
