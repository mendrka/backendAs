const express = require('express')
const aiRouter = require('../../services/aiRouter')
const {
  buildFeedbackPrompt,
  generateDefaultFeedback,
} = require('../../services/correctionEngine')
const {
  calculateSessionScores,
  calculateXP,
  updateProfile,
} = require('../../services/progressionEngine')
const {
  appendTurn,
  createSession,
  findByIdForUser,
  listRecentForUser,
  updateSession,
} = require('../../models/SprechenSession')
const { findOrCreateProfile } = require('../../models/SprechenProfile')
const {
  createAsyncHandler,
  safeArray,
  safeJsonParse,
} = require('../../utils/sprechenHelpers')

const router = express.Router()

router.post('/start', createAsyncHandler(async (req, res) => {
  const { mode, level, themeId, characterId, partnerId, wasWarmup } = req.body
  const session = await createSession({
    userId: req.user?._id || req.userId,
    mode,
    level,
    themeId,
    characterId,
    partnerId,
    wasWarmup,
  })

  res.json({ sessionId: session.id, session })
}))

router.patch('/:id/turn', createAsyncHandler(async (req, res) => {
  const updated = await appendTurn(req.params.id, req.user?._id || req.userId, req.body.turn || {})
  if (!updated) {
    return res.status(404).json({ error: 'Session introuvable' })
  }

  res.json({ ok: true, session: updated })
}))

router.post('/:id/end', createAsyncHandler(async (req, res) => {
  const userId = req.user?._id || req.userId
  const session = await findByIdForUser(req.params.id, userId)

  if (!session) {
    return res.status(404).json({ error: 'Session introuvable' })
  }

  const endTime = new Date()
  const durationMs = endTime.getTime() - new Date(session.startedAt || session.createdAt).getTime()
  const scores = calculateSessionScores(session.transcript)
  const feedbackPrompt = buildFeedbackPrompt({
    transcript: session.transcript,
    scores,
    themeId: session.themeId,
    characterId: session.characterId,
    level: session.level,
    metrics: session.metrics,
  })

  const feedbackResult = await aiRouter.getCorrectionAnalysis(feedbackPrompt, {
    userText: '',
    level: session.level,
  })

  const feedback = {
    ...generateDefaultFeedback(scores),
    ...safeJsonParse(feedbackResult.content, {}),
    globalScore: scores.global,
  }

  const profile = await findOrCreateProfile(userId)
  const xpBreakdown = calculateXP(scores, session.metrics, session, profile)
  const badges = safeArray(feedback.badges)

  const updatedSession = await updateSession(req.params.id, userId, {
    endedAt: endTime,
    durationMs,
    duree: Math.round(durationMs / 1000),
    score: scores.global || 0,
    scores,
    feedback,
    xpEarned: xpBreakdown.total,
    xpBreakdown,
    badgesEarned: badges,
  })

  const updatedProfile = await updateProfile(userId, {
    scores,
    xp: xpBreakdown.total,
    badges,
    durationMs,
  })

  res.json({
    session: updatedSession,
    feedback,
    xpBreakdown,
    profile: updatedProfile,
    service: feedbackResult.service,
  })
}))

router.get('/history', createAsyncHandler(async (req, res) => {
  const sessions = await listRecentForUser(req.user?._id || req.userId, 20)
  res.json({ sessions })
}))

module.exports = router
