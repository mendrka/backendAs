const express = require('express')
const chatRoutes = require('./chat')
const correctionRoutes = require('./correction')
const ttsRoutes = require('./tts')
const sttRoutes = require('./stt')
const hintRoutes = require('./hint')
const sessionRoutes = require('./session')
const profileRoutes = require('./profile')
const vocabularyRoutes = require('./vocabulary')
const progressionRoutes = require('./progression')
const analyticsRoutes = require('./analytics')
const challengeRoutes = require('./challenge')
const aiCompatRoutes = require('./ai')
const { sprechenAuth } = require('../../middleware/sprechenAuth')
const { sprechenRateLimit } = require('../../middleware/rateLimiter')
const { serviceMonitor } = require('../../middleware/serviceMonitor')
const aiRouter = require('../../services/aiRouter')

const router = express.Router()

router.use(sprechenAuth)
router.use(sprechenRateLimit)
router.use(serviceMonitor)

router.use('/chat', chatRoutes)
router.use('/correct', correctionRoutes)
router.use('/tts', ttsRoutes)
router.use('/stt', sttRoutes)
router.use('/hint', hintRoutes)
router.use('/session', sessionRoutes)
router.use('/profile', profileRoutes)
router.use('/vocabulary', vocabularyRoutes)
router.use('/progression', progressionRoutes)
router.use('/analytics', analyticsRoutes)
router.use('/challenge', challengeRoutes)
router.use('/ai', aiCompatRoutes)

router.get('/status', (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'Forbidden' })
  }

  return res.json(aiRouter.getStatus())
})

module.exports = router
