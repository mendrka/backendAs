const express = require('express')
const fs = require('fs')
const path = require('path')

const router = express.Router()
const prisma = require('../prisma/client')
const authMiddleware = require('../middleware/auth.middleware')
const { pickLessonVisual } = require('../data/cours/lessonVisuals')
const {
  buildLevelUnlockMap,
  syncLessonProgression,
  ensureProgressionRecord,
  normalizeProgression,
} = require('../services/lessonProgress.service')

// Toutes les routes cours necessitent d'etre connecte
router.use(authMiddleware)

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const DATA_DIR = path.join(__dirname, '..', 'data', 'cours')

// Cache en memoire pour eviter de relire les JSON a chaque requete.
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

function listLecons(niveau) {
  const data = loadNiveau(niveau)
  const lecons = Array.isArray(data?.lecons) ? data.lecons : []

  // Pour la liste: on renvoie les metadonnees + compteurs, pas les tableaux lourds.
  return lecons.map((l) => {
    const visual = pickLessonVisual(l.niveau || niveau, l.numero)
    return {
      id: l.id,
      numero: l.numero,
      niveau: l.niveau,
      titre: l.titre,
      description: l.description,
      duree: l.duree,
      phrases: l.phrasesCount ?? (Array.isArray(l.phrases) ? l.phrases.length : 0),
      exercices: l.exercicesCount ?? (Array.isArray(l.exercices) ? l.exercices.length : 0),
      imageUrl: l.imageUrl || visual?.url || null,
      imageTheme: l.imageTheme || visual?.themeFr || null,
      illustration: visual,
    }
  })
}

function enrichLessonForDetails(lecon) {
  const visual = pickLessonVisual(lecon?.niveau, lecon?.numero)
  const imageUrl = lecon?.imageUrl || visual?.url || null
  const imageTheme = lecon?.imageTheme || visual?.themeFr || null

  const attachImage = (item) => ({
    ...item,
    imageUrl: item?.imageUrl || imageUrl,
    imageTheme: item?.imageTheme || imageTheme,
  })

  return {
    ...lecon,
    imageUrl,
    imageTheme,
    illustration: visual,
    phrases: Array.isArray(lecon?.phrases) ? lecon.phrases.map(attachImage) : lecon?.phrases,
    exercices: Array.isArray(lecon?.exercices) ? lecon.exercices.map(attachImage) : lecon?.exercices,
  }
}

// GET /api/cours
// Liste tous les niveaux avec progression
router.get('/', async (req, res) => {
  const { niveau } = req.query
  try {
    const niveaux = niveau ? [String(niveau).toUpperCase()] : LEVELS
    const result = await Promise.all(niveaux.map(async (n) => {
      if (!LEVELS.includes(n)) {
        return { niveau: n, leconsTotal: 0, leconsFaites: 0, scoreMoyen: 0 }
      }

      const lecons = listLecons(n)
      const progressions = await prisma.progression.findMany({
        where: { userId: req.userId, leconId: { startsWith: n.toLowerCase() } },
      })

      return {
        niveau: n,
        leconsTotal: lecons.length,
        leconsFaites: progressions.filter(p => p.complete).length,
        scoreMoyen: progressions.length
          ? Math.round(progressions.reduce((s, p) => s + (p.score || 0), 0) / progressions.length)
          : 0,
      }
    }))

    res.json({ niveaux: result })
  } catch (err) {
    console.error('[Cours] Erreur:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// GET /api/cours/:niveau/lecons
router.get('/:niveau/lecons', async (req, res) => {
  const niveau = String(req.params.niveau || '').toUpperCase()

  if (!LEVELS.includes(niveau)) {
    return res.status(400).json({ error: 'Niveau invalide' })
  }

  try {
    const lecons = listLecons(niveau)
    const progressions = await prisma.progression.findMany({
      where: { userId: req.userId, leconId: { startsWith: niveau.toLowerCase() } },
    })
    const unlockMap = await buildLevelUnlockMap({ userId: req.userId, niveau })

    const progMap = progressions.reduce((acc, p) => {
      acc[p.leconId] = normalizeProgression(p)
      return acc
    }, {})

    const result = lecons.map((l) => ({
      ...l,
      complete: progMap[l.id]?.complete || false,
      score: progMap[l.id]?.score ?? null,
      xpEarned: progMap[l.id]?.xpEarned ?? 0,
      xpRequired: progMap[l.id]?.xpRequired ?? 100,
      masteryScore: progMap[l.id]?.masteryScore ?? 0,
      errorRate: progMap[l.id]?.errorRate ?? 0,
      revisionRequired: progMap[l.id]?.revisionRequired ?? false,
      unlockedAt: progMap[l.id]?.unlockedAt ?? null,
      lastAttemptAt: progMap[l.id]?.lastAttemptAt ?? null,
      unlocked: unlockMap.get(l.id)?.unlocked ?? false,
      lockedReason: unlockMap.get(l.id)?.lockedReason ?? null,
    }))

    // Compat: le front attend un tableau
    res.json(result)
  } catch (err) {
    console.error('[Cours] Erreur lecons:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// GET /api/cours/lecon/:leconId
router.get('/lecon/:leconId', async (req, res) => {
  const leconId = String(req.params.leconId || '')
  const niveauCode = leconId.split('-')[0]?.toUpperCase()

  if (!LEVELS.includes(niveauCode)) {
    return res.status(400).json({ error: 'Niveau invalide' })
  }

  try {
    const lecons = loadNiveau(niveauCode)?.lecons || []
    const lecon = lecons.find(l => l.id === leconId)
    if (!lecon) return res.status(404).json({ error: 'Lecon introuvable' })
    res.json({ lecon: enrichLessonForDetails(lecon) })
  } catch (err) {
    console.error('[Cours] Erreur lecon:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// GET /api/cours/progression
router.get('/progression', async (req, res) => {
  try {
    const progressions = await prisma.progression.findMany({
      where: { userId: req.userId },
      orderBy: { updatedAt: 'desc' },
    })
    res.json({ progressions })
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// POST /api/cours/progression/lecon/:leconId/complete
router.post('/progression/lecon/:leconId/complete', async (req, res) => {
  const { leconId } = req.params
  const { score = 100 } = req.body

  try {
    await ensureProgressionRecord({
      userId: req.userId,
      lessonId: leconId,
      unlockedAt: new Date(),
    })
    const progression = await syncLessonProgression({
      userId: req.userId,
      lessonId: leconId,
      markComplete: true,
      unlockedAt: new Date(),
    })
    const safeScore = Math.min(100, Math.max(0, Number(score) || 0))
    const updated = await prisma.progression.update({
      where: { userId_leconId: { userId: req.userId, leconId } },
      data: {
        score: safeScore,
        masteryScore: safeScore,
        updatedAt: new Date(),
      },
    })
    res.json({ progression: updated || progression })
  } catch (err) {
    console.error('[Cours] Erreur progression:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// GET /api/cours/progression/stats
router.get('/progression/stats', async (req, res) => {
  try {
    const [total, completed, avg] = await Promise.all([
      prisma.progression.count({ where: { userId: req.userId } }),
      prisma.progression.count({ where: { userId: req.userId, complete: true } }),
      prisma.progression.aggregate({
        where: { userId: req.userId, complete: true },
        _avg: { score: true },
      }),
    ])

    res.json({
      stats: {
        leconsTotales: total,
        leconsCompletes: completed,
        scoreMoyen: Math.round(avg._avg.score || 0),
      },
    })
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

module.exports = router

