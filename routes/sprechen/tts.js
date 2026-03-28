const express = require('express')
const aiRouter = require('../../services/aiRouter')
const { pushService } = require('../../models/SprechenSession')
const { createAsyncHandler, getCharacterVoice } = require('../../utils/sprechenHelpers')

const router = express.Router()

router.post('/', createAsyncHandler(async (req, res) => {
  const { text, characterId, sessionId } = req.body
  const userId = req.user?._id || req.userId

  if (!text) {
    return res.status(400).json({ error: 'text est requis' })
  }

  const voiceConfig = getCharacterVoice(characterId)
  const result = await aiRouter.getTTS(text, voiceConfig)

  if (sessionId) {
    await pushService(sessionId, userId, 'tts', result.service)
  }

  if (result.service === 'webspeech') {
    return res.json({
      fallback: true,
      text,
      voiceConfig: {
        lang: voiceConfig.lang,
        rate: Number.parseFloat(voiceConfig.rate),
      },
      service: result.service,
    })
  }

  res.set('Content-Type', 'audio/mpeg')
  res.set('X-TTS-Service', result.service)
  return res.send(result.audio)
}))

module.exports = router
