const express = require('express')
const prisma = require('../../prisma/client')
const {
  captureWord,
  countAll,
  findByIdForUser,
  getDueReviewWords,
} = require('../../models/SprechenVocabulary')
const { calculateSM2 } = require('../../services/spacedRepetition')
const { createAsyncHandler, safeArray } = require('../../utils/sprechenHelpers')

const router = express.Router()

router.post('/capture', createAsyncHandler(async (req, res) => {
  const { word, translation, example, themeId, level, sessionId } = req.body

  if (!word) {
    return res.status(400).json({ error: 'word est requis' })
  }

  const entry = await captureWord(req.user?._id || req.userId, {
    word,
    translation,
    example,
    themeId,
    level,
    sessionId,
  })

  res.json({ ok: true, word: entry })
}))

router.get('/review', createAsyncHandler(async (req, res) => {
  const words = await getDueReviewWords(req.user?._id || req.userId, 10)
  res.json({ words, count: words.length })
}))

router.post('/:id/review', createAsyncHandler(async (req, res) => {
  const quality = Number(req.body.quality)
  const userId = req.user?._id || req.userId
  const word = await findByIdForUser(req.params.id, userId)

  if (!word) {
    return res.status(404).json({ error: 'Mot introuvable' })
  }

  const { newEaseFactor, newInterval } = calculateSM2(
    quality,
    word.easeFactor,
    word.interval,
    word.repetitions
  )

  const nextReview = new Date()
  nextReview.setDate(nextReview.getDate() + newInterval)

  const updated = await prisma.sprechenVocabulary.update({
    where: { id: word.id },
    data: {
      easeFactor: newEaseFactor,
      interval: newInterval,
      repetitions: quality >= 3 ? word.repetitions + 1 : 0,
      nextReview,
      lastReview: new Date(),
      qualityHistory: [...safeArray(word.qualityHistory), quality].slice(-20),
    },
  })

  res.json({ nextReview, newInterval, word: updated })
}))

router.get('/', createAsyncHandler(async (req, res) => {
  const userId = req.user?._id || req.userId
  const [count, due] = await Promise.all([
    countAll(userId),
    getDueReviewWords(userId, 50),
  ])

  res.json({
    count,
    dueCount: due.length,
    dueWords: due,
  })
}))

module.exports = router
