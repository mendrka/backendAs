const express = require('express')
const aiRouter = require('../../services/aiRouter')
const {
  buildCorrectionPrompt,
  parseCorrectionResult,
} = require('../../services/correctionEngine')
const { upsertWeakness } = require('../../models/SprechenWeakness')
const { createAsyncHandler } = require('../../utils/sprechenHelpers')

const router = express.Router()

router.post('/', createAsyncHandler(async (req, res) => {
  const { userText, conversationHistory = [], level, themeId } = req.body
  const userId = req.user?._id || req.userId

  if (!Object.prototype.hasOwnProperty.call(req.body, 'userText')) {
    return res.status(400).json({ error: 'userText est requis' })
  }

  const prompt = buildCorrectionPrompt(userText, conversationHistory, level, themeId)
  const result = await aiRouter.getCorrectionAnalysis(prompt, { userText, level })
  const correction = parseCorrectionResult(result.content, userText)

  if (correction.weaknessDetected) {
    await upsertWeakness(userId, {
      ...correction.weaknessDetected,
      errorExample: {
        userSaid: userText,
        shouldBe: correction.correctedVersion,
        date: new Date().toISOString(),
      },
    })
  }

  res.json({
    ...correction,
    service: result.service,
  })
}))

module.exports = router
