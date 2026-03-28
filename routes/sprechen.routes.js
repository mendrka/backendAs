const express = require('express')
const router  = express.Router()
const prisma  = require('../prisma/client')
const authMiddleware = require('../middleware/auth.middleware')
const modularSprechenRouter = require('./sprechen')

// Toutes les routes Sprechen nécessitent d'être connecté
router.use(authMiddleware)

// ── GET /api/sprechen/historique ───────────────────────────
// Récupère l'historique des sessions Sprechen de l'utilisateur
router.get('/historique', async (req, res) => {
  try {
    const sessions = await prisma.sprechenSession.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        partner: {
          select: { prenom: true, nom: true }
        }
      }
    })
    res.json({ sessions })
  } catch (err) {
    console.error('[Sprechen] Erreur historique:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// ── GET /api/sprechen/session/:id ──────────────────────────
// Détail d'une session
router.get('/session/:id', async (req, res) => {
  try {
    const session = await prisma.sprechenSession.findFirst({
      where: {
        id:     req.params.id,
        userId: req.userId,
      },
      include: {
        partner: { select: { prenom: true } }
      }
    })
    if (!session) return res.status(404).json({ error: 'Session introuvable' })
    res.json({ session })
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// ── POST /api/sprechen/session ─────────────────────────────
// Sauvegarder une session terminée
router.post('/session', async (req, res) => {
  const { partnerId, niveau, score, duree, exercices } = req.body

  if (!niveau || score === undefined) {
    return res.status(400).json({ error: 'Données manquantes' })
  }

  try {
    const session = await prisma.sprechenSession.create({
      data: {
        userId:    req.userId,
        partnerId: partnerId || null,
        niveau,
        level:     niveau,
        mode:      'training',
        score:     Math.min(100, Math.max(0, score)),
        duree:     duree || 0,
        exercices: exercices ? JSON.stringify(exercices) : null,
        startedAt: new Date(),
        transcript: [],
        metrics: {},
        servicesUsed: { llm: [], tts: [], stt: [] },
        badgesEarned: [],
      }
    })
    res.status(201).json({ session })
  } catch (err) {
    console.error('[Sprechen] Erreur save session:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// ── GET /api/sprechen/stats ────────────────────────────────
// Statistiques Sprechen de l'utilisateur
router.get('/stats', async (req, res) => {
  try {
    const [total, moyenne, derniere] = await Promise.all([
      prisma.sprechenSession.count({ where: { userId: req.userId } }),
      prisma.sprechenSession.aggregate({
        where:   { userId: req.userId },
        _avg:    { score: true },
      }),
      prisma.sprechenSession.findFirst({
        where:   { userId: req.userId },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    res.json({
      stats: {
        sessionsTotal: total,
        scoreMoyen:    Math.round(moyenne._avg.score || 0),
        dernierScore:  derniere?.score || 0,
        derniereDate:  derniere?.createdAt || null,
      }
    })
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.use('/', modularSprechenRouter)

module.exports = router
