const express = require('express')
const fs = require('fs')
const path = require('path')

const prisma = require('../prisma/client')

const router = express.Router()

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const DATA_DIR = path.join(__dirname, '..', 'data', 'cours')

// Cache memo for JSON course files and computed totals.
const coursCache = new Map()
let overviewCache = null
let overviewCacheAt = 0
const OVERVIEW_TTL_MS = 30_000

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

function countLessonMeta(lecon) {
  const phrases = lecon.phrasesCount ?? (Array.isArray(lecon.phrases) ? lecon.phrases.length : 0)
  const exercices = lecon.exercicesCount ?? (Array.isArray(lecon.exercices) ? lecon.exercices.length : 0)
  const duree = typeof lecon.duree === 'number' ? lecon.duree : 0
  return { phrases, exercices, duree }
}

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
      const m = countLessonMeta(l)
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

