const prisma = require('../prisma/client')
const { safeArray } = require('../utils/sprechenHelpers')

function normalizeVocabularyWord(word) {
  if (!word) return null

  return {
    ...word,
    qualityHistory: safeArray(word.qualityHistory),
  }
}

async function captureWord(userId, payload) {
  const existing = await prisma.sprechenVocabulary.findFirst({
    where: {
      userId,
      word: payload.word,
    },
  })

  if (existing) {
    return normalizeVocabularyWord(await prisma.sprechenVocabulary.update({
      where: { id: existing.id },
      data: {
        translation: payload.translation || existing.translation,
        example: payload.example || existing.example,
        themeId: payload.themeId || existing.themeId,
        level: payload.level || existing.level,
        timesSeenInSession: { increment: 1 },
        capturedInSession: payload.sessionId || existing.capturedInSession,
      },
    }))
  }

  return normalizeVocabularyWord(await prisma.sprechenVocabulary.create({
    data: {
      userId,
      word: payload.word,
      translation: payload.translation || null,
      example: payload.example || null,
      themeId: payload.themeId || null,
      level: payload.level || null,
      capturedInSession: payload.sessionId || null,
      qualityHistory: [],
    },
  }))
}

async function findByIdForUser(id, userId) {
  return normalizeVocabularyWord(await prisma.sprechenVocabulary.findFirst({ where: { id, userId } }))
}

async function getDueReviewWords(userId, limit = 10) {
  const words = await prisma.sprechenVocabulary.findMany({
    where: {
      userId,
      nextReview: { lte: new Date() },
    },
    orderBy: { nextReview: 'asc' },
    take: limit,
  })

  return words.map(normalizeVocabularyWord)
}

async function countAll(userId) {
  return prisma.sprechenVocabulary.count({ where: { userId } })
}

async function countDue(userId) {
  return prisma.sprechenVocabulary.count({
    where: {
      userId,
      nextReview: { lte: new Date() },
    },
  })
}

module.exports = {
  captureWord,
  countAll,
  countDue,
  findByIdForUser,
  getDueReviewWords,
  normalizeVocabularyWord,
}
