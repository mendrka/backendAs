const express = require('express')
const { findOrCreateProfile, updatePreferences } = require('../../models/SprechenProfile')
const { listOpenWeaknesses } = require('../../models/SprechenWeakness')
const { createAsyncHandler } = require('../../utils/sprechenHelpers')

const router = express.Router()

router.get('/', createAsyncHandler(async (req, res) => {
  const userId = req.user?._id || req.userId
  const [profile, weaknesses] = await Promise.all([
    findOrCreateProfile(userId),
    listOpenWeaknesses(userId, 10),
  ])

  res.json({ profile, weaknesses })
}))

router.patch('/preferences', createAsyncHandler(async (req, res) => {
  const profile = await updatePreferences(req.user?._id || req.userId, req.body || {})
  res.json({ profile })
}))

module.exports = router
