const express = require('express')
const { findOrCreateProfile } = require('../../models/SprechenProfile')
const { listRecentForUser } = require('../../models/SprechenSession')
const { listOpenWeaknesses } = require('../../models/SprechenWeakness')
const { countAll, countDue } = require('../../models/SprechenVocabulary')
const { createAsyncHandler } = require('../../utils/sprechenHelpers')

const router = express.Router()

router.get('/overview', createAsyncHandler(async (req, res) => {
  const userId = req.user?._id || req.userId
  const [profile, recentSessions, weaknesses, vocabularyCount, reviewDueCount] = await Promise.all([
    findOrCreateProfile(userId),
    listRecentForUser(userId, 10),
    listOpenWeaknesses(userId, 5),
    countAll(userId),
    countDue(userId),
  ])

  res.json({
    profile,
    recentSessions: recentSessions.map((session) => ({
      id: session.id,
      date: session.startedAt || session.createdAt,
      theme: session.themeId,
      level: session.level,
      score: session.scores?.global || session.score,
      xp: session.xpEarned,
      duration: session.durationMs,
    })),
    topWeaknesses: weaknesses,
    vocabularyCount,
    reviewDueCount,
  })
}))

router.get('/dna-history', createAsyncHandler(async (req, res) => {
  const profile = await findOrCreateProfile(req.user?._id || req.userId)
  res.json({ dnaHistory: profile.dnaHistory.slice(-30) })
}))

module.exports = router
