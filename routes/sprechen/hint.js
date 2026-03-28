const express = require('express')
const aiRouter = require('../../services/aiRouter')
const { findOrCreateProfile } = require('../../models/SprechenProfile')
const { findByIdForUser, updateSession } = require('../../models/SprechenSession')
const { createAsyncHandler, safeArray } = require('../../utils/sprechenHelpers')

const router = express.Router()

router.post('/', createAsyncHandler(async (req, res) => {
  const {
    sessionId,
    silenceDurationSeconds = 0,
    conversationHistory = [],
    themeContext = {},
  } = req.body

  const userId = req.user?._id || req.userId
  const profile = await findOrCreateProfile(userId)
  const sensitivity = profile.preferences?.hintSensitivity || 3
  const thresholds = {
    1: [3, 8, 12],
    2: [4, 9, 13],
    3: [5, 10, 15],
    4: [6, 12, 18],
    5: [8, 15, 25],
  }[sensitivity] || [5, 10, 15]

  let hintLevel = 1
  if (silenceDurationSeconds >= thresholds[2]) hintLevel = 3
  else if (silenceDurationSeconds >= thresholds[1]) hintLevel = 2

  const result = await aiRouter.getHint(conversationHistory, hintLevel, themeContext)

  if (sessionId) {
    const session = await findByIdForUser(sessionId, userId)
    if (session) {
      await updateSession(sessionId, userId, {
        metrics: {
          ...session.metrics,
          hintsUsed: Number(session.metrics.hintsUsed || 0) + 1,
          hintsLevel: [...safeArray(session.metrics.hintsLevel), hintLevel],
        },
      })
    }
  }

  res.json({
    hintLevel,
    content: result.content,
    type: hintLevel === 3 ? 'coach' : 'in_character',
    service: result.service,
  })
}))

module.exports = router
