const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'eam_dev_secret'

function getConfiguredAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function resolveUserRole(user = {}) {
  const storedRole = String(user.role || '').trim().toUpperCase()
  if (storedRole) return storedRole

  const email = String(user.email || '').trim().toLowerCase()
  if (email && getConfiguredAdminEmails().includes(email)) {
    return 'ADMIN'
  }

  return 'USER'
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Token manquant · Token requis pour acceder a cette ressource',
    })
  }

  const token = authHeader.split(' ')[1]

  try {
    const payload = jwt.verify(token, JWT_SECRET)

    req.userId = payload.userId
    req.userPrenom = payload.prenom
    req.userNom = payload.nom
    req.userEmail = payload.email
    req.userRole = resolveUserRole(payload)
    req.user = {
      _id: req.userId,
      prenom: req.userPrenom,
      nom: req.userNom,
      email: req.userEmail,
      role: req.userRole,
    }

    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expire · Reconnectez-vous',
        code: 'TOKEN_EXPIRED',
      })
    }

    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Token invalide',
        code: 'TOKEN_INVALID',
      })
    }

    return res.status(401).json({ error: 'Non authentifie' })
  }
}

function requireAdmin(req, res, next) {
  if (resolveUserRole(req.user || { email: req.userEmail, role: req.userRole }) !== 'ADMIN') {
    return res.status(403).json({ error: 'Acces reserve aux administrateurs' })
  }

  next()
}

module.exports = authMiddleware
module.exports.requireAdmin = requireAdmin
module.exports.resolveUserRole = resolveUserRole
