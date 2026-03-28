const express = require('express')
const aiRouter = require('../../services/aiRouter')
const {
  generateDefaultFeedback,
  parseCorrectionResult,
} = require('../../services/correctionEngine')
const { safeArray, safeJsonParse } = require('../../utils/sprechenHelpers')

const router = express.Router()

function splitSystemPrompt(messages = []) {
  const normalized = safeArray(messages)
  const firstSystemIndex = normalized.findIndex((message) => message?.role === 'system')
  if (firstSystemIndex === -1) {
    return { systemPrompt: '', messages: normalized }
  }

  const systemPrompt = String(normalized[firstSystemIndex]?.content || '')
  const remaining = normalized.filter((_, index) => index !== firstSystemIndex)
  return { systemPrompt, messages: remaining }
}

router.post('/', async (req, res, next) => {
  try {
    const { task } = req.body || {}

    if (!task) {
      return res.status(400).json({ error: 'Missing task' })
    }

    if (task === 'conversation') {
      const { messages = [], themeId = null, level = null, turn = null } = req.body || {}
      const { systemPrompt, messages: payloadMessages } = splitSystemPrompt(messages)

      const result = await aiRouter.getConversationResponse(payloadMessages, systemPrompt, {
        themeId,
        level,
        turn,
      })

      return res.json({
        content: result.content,
        service: result.service,
      })
    }

    if (task === 'correction') {
      const { prompt = '', level = null, userText = '' } = req.body || {}

      const analysis = await aiRouter.getCorrectionAnalysis(prompt, { userText, level })
      const correction = parseCorrectionResult(analysis.content, userText)

      return res.json({
        ...correction,
        service: analysis.service,
      })
    }

    if (task === 'feedback') {
      const { prompt = '', sessionData = {} } = req.body || {}

      const analysis = await aiRouter.getCorrectionAnalysis(prompt, {
        userText: '',
        level: sessionData?.level,
      })

      const parsed = safeJsonParse(analysis.content, {})
      const fallback = generateDefaultFeedback(sessionData?.scores || {})

      const feedback = {
        ...fallback,
        ...parsed,
        xpEarned: Number(parsed.xpEarned ?? fallback.xpEarned ?? 0),
        badges: safeArray(parsed.badges ?? fallback.badges),
      }

      return res.json({
        ...feedback,
        service: analysis.service,
      })
    }

    return res.status(400).json({ error: `Unsupported task: ${task}` })
  } catch (error) {
    next(error)
  }
})

module.exports = router
