const express = require('express')

const authMiddleware = require('../middleware/auth.middleware')
const {
  isAdaptiveEnabled,
  startAdaptiveSession,
  submitAdaptiveAttempt,
  finishAdaptiveSession,
  getAdaptiveRecommendation,
} = require('../services/adaptiveCours.service')

const router = express.Router()

router.use(authMiddleware)

router.use((req, res, next) => {
  if (!isAdaptiveEnabled()) {
    return res.status(503).json({
      error: 'Adaptive cours desactive',
      featureFlag: 'ADAPTIVE_COURS_ENABLED',
    })
  }
  return next()
})

// POST /api/adaptive-cours/session/start
router.post('/session/start', async (req, res) => {
  try {
    const payload = await startAdaptiveSession({
      userId: req.userId,
      payload: req.body || {},
    })
    res.json(payload)
  } catch (err) {
    console.error('[AdaptiveCours] session/start erreur:', err)
    res.status(400).json({ error: err.message || 'Erreur serveur' })
  }
})

// POST /api/adaptive-cours/session/:sessionId/attempt
router.post('/session/:sessionId/attempt', async (req, res) => {
  const sessionId = String(req.params.sessionId || '')
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId manquant' })
  }

  try {
    const payload = await submitAdaptiveAttempt({
      userId: req.userId,
      sessionId,
      payload: req.body || {},
    })
    res.json(payload)
  } catch (err) {
    console.error('[AdaptiveCours] session/attempt erreur:', err)
    res.status(400).json({ error: err.message || 'Erreur serveur' })
  }
})

// POST /api/adaptive-cours/session/:sessionId/finish
router.post('/session/:sessionId/finish', async (req, res) => {
  const sessionId = String(req.params.sessionId || '')
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId manquant' })
  }

  try {
    const payload = await finishAdaptiveSession({
      userId: req.userId,
      sessionId,
    })
    res.json(payload)
  } catch (err) {
    console.error('[AdaptiveCours] session/finish erreur:', err)
    res.status(400).json({ error: err.message || 'Erreur serveur' })
  }
})

// GET /api/adaptive-cours/recommendation
router.get('/recommendation', async (req, res) => {
  try {
    const payload = await getAdaptiveRecommendation({ userId: req.userId })
    res.json(payload)
  } catch (err) {
    console.error('[AdaptiveCours] recommendation erreur:', err)
    res.status(400).json({ error: err.message || 'Erreur serveur' })
  }
})

module.exports = router
