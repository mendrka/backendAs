const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'eam_dev_secret'

// ── Middleware vérification JWT ────────────────────────────
// Utilisé par : auth.routes, cours.routes, sprechen.routes,
//               chat.routes, user.routes
// Injecte req.userId et req.userPrenom dans la requête

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization

  // Vérifier présence du header
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Token manquant · Token requis pour accéder à cette ressource'
    })
  }

  const token = authHeader.split(' ')[1]

  try {
    const payload = jwt.verify(token, JWT_SECRET)

    // Injecter les infos user dans la requête
    req.userId    = payload.userId
    req.userPrenom = payload.prenom
    req.userNom   = payload.nom
    req.userEmail = payload.email

    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expiré · Reconnectez-vous',
        code:  'TOKEN_EXPIRED',
      })
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Token invalide',
        code:  'TOKEN_INVALID',
      })
    }
    return res.status(401).json({ error: 'Non authentifié' })
  }
}

module.exports = authMiddleware
