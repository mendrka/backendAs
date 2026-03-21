const express = require('express')

const authMiddleware = require('../middleware/auth.middleware')
const {
  getGamificationStats,
  addXp,
  checkDailyStreak,
  getBadges,
  markBadgeViewed,
  getLeaderboard,
} = require('../services/gamification.service')

const router = express.Router()

router.use(authMiddleware)

router.get('/stats', async (req, res) => {
  try {
    const payload = await getGamificationStats(req.userId)
    res.json(payload)
  } catch (err) {
    console.error('[Gamification] stats erreur:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.post('/xp', async (req, res) => {
  try {
    const payload = await addXp(req.userId, req.body?.amount, req.body?.action)
    res.json(payload)
  } catch (err) {
    console.error('[Gamification] xp erreur:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.post('/streak/check', async (req, res) => {
  try {
    const payload = await checkDailyStreak(req.userId)
    res.json(payload)
  } catch (err) {
    console.error('[Gamification] streak erreur:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/badges', async (req, res) => {
  try {
    const badges = await getBadges(req.userId)
    res.json({ badges })
  } catch (err) {
    console.error('[Gamification] badges erreur:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.post('/badge/:id/vu', async (req, res) => {
  try {
    const badge = await markBadgeViewed(req.userId, req.params.id)
    res.json({ badge })
  } catch (err) {
    console.error('[Gamification] badge vu erreur:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/leaderboard', async (req, res) => {
  try {
    const items = await getLeaderboard(req.query.limit)
    res.json({ leaderboard: items })
  } catch (err) {
    console.error('[Gamification] leaderboard erreur:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

module.exports = router
