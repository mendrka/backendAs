const express  = require('express')
const router   = express.Router()
const bcrypt   = require('bcrypt')
const jwt      = require('jsonwebtoken')
const { body, validationResult } = require('express-validator')
const prisma   = require('../prisma/client')
const authMiddleware = require('../middleware/auth.middleware')
const { resolveUserRole } = authMiddleware
const { ensureUserStats } = require('../services/gamification.service')

const SALT_ROUNDS = 12
const JWT_SECRET  = process.env.JWT_SECRET || 'eam_dev_secret'
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d'

// ── Helper : créer le JWT ──────────────────────────────────
function makeToken(user) {
  return jwt.sign(
    { userId: user.id, prenom: user.prenom, nom: user.nom, email: user.email, role: resolveUserRole(user) },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  )
}

// ── Helper : formater la réponse user (sans password) ──────
function formatUser(user) {
  const { password, ...safe } = user
  return {
    ...safe,
    role: resolveUserRole(user),
  }
}

// ── POST /api/auth/register ────────────────────────────────
router.post('/register', [
  body('prenom').trim().notEmpty().withMessage('Prénom requis'),
  body('nom').trim().notEmpty().withMessage('Nom requis'),
  body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
  body('password').isLength({ min: 6 }).withMessage('Mot de passe trop court'),
  body('niveau').optional().isIn(['A1','A2','B1','B2','C1','C2']),
  body('objectif').optional().isIn(['ausbildung','aupair','fsj','bfd','etudes','autre']),
], async (req, res) => {
  // Validation
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { prenom, nom, email, password, niveau, objectif } = req.body

  try {
    // Vérifier email unique
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return res.status(409).json({ error: 'Email déjà utilisé · Efa ampiasaina io email io' })
    }

    // Hasher le mot de passe
    const hashed = await bcrypt.hash(password, SALT_ROUNDS)

    // Créer l'utilisateur
    const user = await prisma.user.create({
      data: {
        prenom: prenom.trim(),
        nom:    nom.trim(),
        email,
        password: hashed,
        niveau:   niveau   || 'A1',
        objectif: objectif || 'autre',
      }
    })

    await ensureUserStats(user.id)

    const token = makeToken(user)

    res.status(201).json({
      message: 'Compte créé · Kaonty noforonina',
      token,
      user: formatUser(user),
    })
  } catch (err) {
    console.error('[Auth] Erreur register:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// ── POST /api/auth/login ───────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { email, password } = req.body

  try {
    // Trouver l'utilisateur
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return res.status(401).json({ error: 'Credentials invalides · Tsy mety ny email na tenimiafina' })
    }

    // Vérifier le mot de passe
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return res.status(401).json({ error: 'Credentials invalides · Tsy mety ny email na tenimiafina' })
    }

    const token = makeToken(user)

    res.json({
      message: 'Connexion réussie · Niditra soa aman-tsara',
      token,
      user: formatUser(user),
    })
  } catch (err) {
    console.error('[Auth] Erreur login:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// ── GET /api/auth/me ───────────────────────────────────────
// Vérifier le token et retourner l'utilisateur courant
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    })
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' })

    res.json({ user: formatUser(user) })
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// ── POST /api/auth/logout ──────────────────────────────────
// Stateless JWT — le logout se fait côté client (supprimer le token)
router.post('/logout', authMiddleware, (req, res) => {
  res.json({ message: 'Déconnecté · Niala soa aman-tsara' })
})

module.exports = router
