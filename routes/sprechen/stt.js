const express = require('express')
const multer = require('multer')
const aiRouter = require('../../services/aiRouter')
const { pushService } = require('../../models/SprechenSession')
const { createAsyncHandler } = require('../../utils/sprechenHelpers')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

router.post('/', upload.single('audio'), createAsyncHandler(async (req, res) => {
  const userId = req.user?._id || req.userId
  const sessionId = req.body?.sessionId

  if (!req.file?.buffer) {
    return res.status(400).json({ error: 'No audio file provided' })
  }

  const result = await aiRouter.getSTT(req.file.buffer, 'de')

  if (sessionId) {
    await pushService(sessionId, userId, 'stt', result.service)
  }

  if (result.service === 'webspeech') {
    return res.json({
      transcript: null,
      fallback: true,
      service: 'webspeech',
      confidence: result.confidence,
    })
  }

  res.json({
    transcript: result.transcript,
    service: result.service,
    confidence: result.confidence,
    fallback: false,
  })
}))

module.exports = router
