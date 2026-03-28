const express = require('express')
const aiRouter = require('../../services/aiRouter')
const { listOpenWeaknesses } = require('../../models/SprechenWeakness')
const { pushService } = require('../../models/SprechenSession')
const {
  buildSystemPrompt,
  createAsyncHandler,
  detectNewWords,
  safeArray,
} = require('../../utils/sprechenHelpers')

const router = express.Router()

router.post('/', createAsyncHandler(async (req, res) => {
  const { sessionId, messages = [], systemContext = {} } = req.body
  const userId = req.user?._id || req.userId

  const weaknesses = await listOpenWeaknesses(userId, 5)
  const systemPrompt = buildSystemPrompt(
    systemContext.characterId,
    systemContext.themeId,
    systemContext.level,
    weaknesses,
    Boolean(systemContext.isTwistTurn)
  )

  const result = await aiRouter.getConversationResponse(messages, systemPrompt, systemContext)
  const newWords = detectNewWords(result.content, messages, systemContext.level)

  if (sessionId) {
    await pushService(sessionId, userId, 'llm', result.service)
  }

  res.json({
    content: result.content,
    service: result.service,
    newWordsDetected: safeArray(newWords),
  })
}))

module.exports = router
