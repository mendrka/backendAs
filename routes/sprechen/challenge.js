const express = require('express')
const { findOrCreateProfile, saveProfile } = require('../../models/SprechenProfile')
const {
  generateDailyChallenge,
  resolveLevelFromXP,
} = require('../../services/progressionEngine')
const { createAsyncHandler, safeArray } = require('../../utils/sprechenHelpers')

const router = express.Router()

router.get('/daily', createAsyncHandler(async (req, res) => {
  const profile = await findOrCreateProfile(req.user?._id || req.userId)
  const today = new Date().toDateString()
  const alreadyDone = profile.dailyChallengeCompleted
    && new Date(profile.dailyChallengeCompleted).toDateString() === today
  const challenge = generateDailyChallenge(profile, new Date())

  res.json({
    challenge,
    alreadyDone,
    xpReward: challenge.xpReward,
  })
}))

router.post('/complete', createAsyncHandler(async (req, res) => {
  const userId = req.user?._id || req.userId
  const profile = await findOrCreateProfile(userId)
  const today = new Date()
  const alreadyDone = profile.dailyChallengeCompleted
    && new Date(profile.dailyChallengeCompleted).toDateString() === today.toDateString()

  if (alreadyDone) {
    return res.json({
      alreadyDone: true,
      profile,
    })
  }

  const challenge = generateDailyChallenge(profile, today)
  const xpReward = Number(req.body?.xpReward || challenge.xpReward || 0)
  const globalXP = profile.globalXP + xpReward

  const updated = await saveProfile(userId, {
    dailyChallengeCompleted: today,
    weeklyChallengesCompleted: safeArray(profile.weeklyChallengesCompleted).concat(today).slice(-7),
    globalXP,
    globalLevel: resolveLevelFromXP(globalXP, profile.levelXPThresholds),
  })

  res.json({
    alreadyDone: false,
    challenge,
    xpReward,
    profile: updated,
  })
}))

module.exports = router
