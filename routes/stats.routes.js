const express = require('express')

const prisma = require('../prisma/client')
const { LEVELS, loadNiveau, getLeconMeta } = require('../services/courseCatalog.service')

const router = express.Router()
let overviewCache = null
let overviewCacheAt = 0
const OVERVIEW_TTL_MS = 30_000

function computeContentOverview() {
  const niveaux = {}
  let leconsTotal = 0
  let exercicesTotal = 0
  let phrasesTotal = 0
  let minutesTotal = 0

  for (const n of LEVELS) {
    const data = loadNiveau(n)
    const lecons = Array.isArray(data?.lecons) ? data.lecons : []
    let ex = 0
    let ph = 0
    let min = 0
    for (const l of lecons) {
      const m = getLeconMeta(l)
      ex += m.exercices
      ph += m.phrases
      min += m.duree
    }
    niveaux[n] = {
      leconsTotal: lecons.length,
      exercicesTotal: ex,
      phrasesTotal: ph,
      minutesTotal: min,
    }
    leconsTotal += lecons.length
    exercicesTotal += ex
    phrasesTotal += ph
    minutesTotal += min
  }

  return { niveaux, leconsTotal, exercicesTotal, phrasesTotal, minutesTotal }
}

// GET /api/stats/overview (public)
router.get('/overview', async (req, res) => {
  try {
    const now = Date.now()
    if (overviewCache && (now - overviewCacheAt) < OVERVIEW_TTL_MS) {
      return res.json(overviewCache)
    }

    const content = computeContentOverview()
    const [usersCount, temoignagesCount] = await Promise.all([
      prisma.user.count(),
      prisma.chatMessage.count({ where: { canalId: 'temoignages' } }),
    ])

    const payload = {
      generatedAt: new Date().toISOString(),
      usersCount,
      temoignagesCount,
      ...content,
    }

    overviewCache = payload
    overviewCacheAt = now
    res.json(payload)
  } catch (err) {
    console.error('[Stats] overview erreur:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

// GET /api/stats/temoignages?limit=3 (public)
router.get('/temoignages', async (req, res) => {
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 3))
  try {
    const [countTotal, items] = await Promise.all([
      prisma.chatMessage.count({ where: { canalId: 'temoignages' } }),
      prisma.chatMessage.findMany({
        where: { canalId: 'temoignages' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          texte: true,
          createdAt: true,
          user: {
            select: {
              prenom: true,
              nom: true,
              niveau: true,
              objectif: true,
              createdAt: true,
            },
          },
        },
      }),
    ])

    res.json({ countTotal, temoignages: items })
  } catch (err) {
    console.error('[Stats] temoignages erreur:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

module.exports = router

