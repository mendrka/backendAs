const express = require('express')
const bcrypt = require('bcrypt')
const fs = require('fs')
const path = require('path')

const prisma = require('../prisma/client')
const authMiddleware = require('../middleware/auth.middleware')
const { getActiveErrorProfiles, getDueReviewProfiles } = require('../services/lessonProgress.service')
const { getAdaptiveRecommendation } = require('../services/adaptiveCours.service')

const router = express.Router()
router.use(authMiddleware)

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const DATA_DIR = path.join(__dirname, '..', 'data', 'cours')

// Cache JSON cours pour eviter de relire les fichiers a chaque requete.
const coursCache = new Map()

function loadNiveau(niveau) {
  const n = String(niveau || '').toUpperCase()
  if (!LEVELS.includes(n)) throw new Error('Niveau invalide')
  if (coursCache.has(n)) return coursCache.get(n)
  const file = path.join(DATA_DIR, `${n}.json`)
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw)
  coursCache.set(n, parsed)
  return parsed
}

function findLecon(leconId) {
  const id = String(leconId || '')
  const niveau = id.split('-')[0]?.toUpperCase()
  if (!LEVELS.includes(niveau)) return null
  const lecons = loadNiveau(niveau)?.lecons || []
  return lecons.find((l) => l.id === id) || null
}

function getLeconMeta(lecon) {
  const phrases = lecon.phrasesCount ?? (Array.isArray(lecon.phrases) ? lecon.phrases.length : 0)
  const exercices = lecon.exercicesCount ?? (Array.isArray(lecon.exercices) ? lecon.exercices.length : 0)
  const duree = typeof lecon.duree === 'number' ? lecon.duree : 0
  const mots = Array.isArray(lecon.mots) ? lecon.mots.length : 0
  return { phrases, exercices, duree, mots }
}

function computeStreakFromIsoDays(isoDays) {
  const uniq = Array.from(new Set(isoDays)).filter(Boolean).sort().reverse()
  if (uniq.length === 0) return 0

  let streak = 1
  let prev = new Date(uniq[0] + 'T00:00:00Z')
  for (let i = 1; i < uniq.length; i++) {
    const cur = new Date(uniq[i] + 'T00:00:00Z')
    const diffDays = Math.round((prev - cur) / (24 * 60 * 60 * 1000))
    if (diffDays === 1) {
      streak++
      prev = cur
    } else if (diffDays > 1) {
      break
    }
  }
  return streak
}

// GET /api/user/profil
router.get('/profil', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' })
    const { password, ...safe } = user
    res.json({ user: safe })
  } catch {
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// PUT /api/user/profil
router.put('/profil', async (req, res) => {
  const { prenom, nom, niveau, objectif } = req.body
  try {
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { prenom, nom, niveau, objectif },
    })
    const { password, ...safe } = user
    res.json({ user: safe })
  } catch {
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// PUT /api/user/password
router.put('/password', async (req, res) => {
  const { ancien, nouveau } = req.body
  if (!ancien || !nouveau || nouveau.length < 6) {
    return res.status(400).json({ error: 'Donnees invalides' })
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    const valid = await bcrypt.compare(ancien, user.password)
    if (!valid) return res.status(401).json({ error: 'Ancien mot de passe incorrect' })

    const hashed = await bcrypt.hash(nouveau, 12)
    await prisma.user.update({ where: { id: req.userId }, data: { password: hashed } })
    res.json({ message: 'Mot de passe mis a jour' })
  } catch {
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// GET /api/user/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const [progressions, activeErrors, dueReviewProfiles, adaptiveRecommendation] = await Promise.all([
      prisma.progression.findMany({
        where: { userId: req.userId },
        orderBy: { updatedAt: 'desc' },
      }),
      getActiveErrorProfiles({ userId: req.userId }),
      getDueReviewProfiles({ userId: req.userId }),
      getAdaptiveRecommendation({ userId: req.userId }),
    ])

    const completes = progressions.filter((p) => p.complete)

    // Progression par niveau, avec total exact depuis les JSON.
    const progression = LEVELS.map((n) => {
      const lecons = loadNiveau(n)?.lecons || []
      const completed = completes.filter((p) => p.leconId.startsWith(n.toLowerCase()))
      return {
        niveau: n,
        leconsFaites: completed.length,
        leconsTotal: lecons.length,
        score: completed.length
          ? Math.round(completed.reduce((s, x) => s + (x.score || 0), 0) / completed.length)
          : 0,
      }
    })

    let exercicesTotales = 0
    let minutesTotal = 0
    let motsAppris = 0
    const activityDays = []

    for (const p of completes) {
      const lecon = findLecon(p.leconId)
      if (!lecon) continue
      const meta = getLeconMeta(lecon)
      exercicesTotales += meta.exercices
      minutesTotal += meta.duree
      motsAppris += meta.mots
      activityDays.push(new Date(p.updatedAt).toISOString().slice(0, 10))
    }

    const joursSuite = computeStreakFromIsoDays(activityDays)

    const derniereProg = completes[0] || null
    const derniereLeconData = derniereProg ? findLecon(derniereProg.leconId) : null
    const dernierNiveau = derniereProg ? derniereProg.leconId.split('-')[0].toUpperCase() : null
    const dernierNumero = derniereProg ? parseInt(derniereProg.leconId.split('-')[1], 10) || 1 : null

    const next = progression.find((p) => p.leconsFaites < p.leconsTotal) || progression[0]

    res.json({
      progression,
      stats: {
        joursSuite,
        leconsTotales: completes.length,
        exercicesTotales,
        motsAppris,
        minutesTotal,
      },
      derniereLecon: derniereProg
        ? {
          id: derniereProg.leconId,
          niveau: dernierNiveau,
          numero: dernierNumero,
          titre: derniereLeconData?.titre || `Lecon ${derniereProg.leconId}`,
        }
        : null,
      prochainObjectif: {
        label: `Finir ${next?.niveau || 'A1'}`,
        progression: next?.leconsFaites || 0,
        total: next?.leconsTotal || 0,
      },
      adaptiveRecommendation,
      activeErrors: activeErrors.slice(0, 5).map((profile) => ({
        lessonId: profile.leconId,
        conceptTag: profile.conceptTag,
        errorTag: profile.errorTag,
        count: profile.count,
        successStreak: profile.successStreak,
        isFrequent: profile.isFrequent,
        nextReviewAt: profile.nextReviewAt,
      })),
      reviewSummary: {
        activeCount: activeErrors.length,
        dueCount: dueReviewProfiles.length,
      },
    })
  } catch (err) {
    console.error('[User] Dashboard erreur:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

module.exports = router

