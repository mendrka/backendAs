const express = require('express')
const { findOrCreateProfile } = require('../../models/SprechenProfile')
const { countDue } = require('../../models/SprechenVocabulary')
const { generateDailyChallenge } = require('../../services/progressionEngine')
const { createAsyncHandler, safeArray } = require('../../utils/sprechenHelpers')

const router = express.Router()

router.get('/summary', createAsyncHandler(async (req, res) => {
  const userId = req.user?._id || req.userId
  const [profile, reviewDueCount] = await Promise.all([
    findOrCreateProfile(userId),
    countDue(userId),
  ])

  res.json({
    profile,
    reviewDueCount,
    challenge: generateDailyChallenge(profile, new Date()),
  })
}))

router.get('/badges', createAsyncHandler(async (req, res) => {
  const profile = await findOrCreateProfile(req.user?._id || req.userId)
  res.json({ badges: safeArray(profile.badges) })
}))

module.exports = router
