const test = require('node:test')
const assert = require('node:assert/strict')
const prisma = require('../prisma/client')

const {
  __testables: progressTestables,
  LESSON_XP_REQUIRED,
  LESSON_MASTERY_THRESHOLD,
  LESSON_ERROR_BLOCK_THRESHOLD,
  upsertErrorProfileFromAttempt,
  getActiveErrorProfiles,
  getDueReviewProfiles,
} = require('../services/lessonProgress.service')
const { __testables: adaptiveTestables } = require('../services/adaptiveCours.service')

test('XP breakdown follows correction, speed, improvement and completion tiers', () => {
  const fastCorrect = progressTestables.computeAttemptXpBreakdown({
    correct: true,
    responseTimeMs: 45000,
    previousAttempt: { correct: false, attemptScore: 0 },
    attemptScore: 100,
  })
  const slowWrong = progressTestables.computeAttemptXpBreakdown({
    correct: false,
    responseTimeMs: 220000,
    previousAttempt: { correct: false, attemptScore: 0 },
    attemptScore: 0,
  })

  assert.equal(fastCorrect.correctionXp, 5)
  assert.equal(fastCorrect.speedXp, 10)
  assert.equal(fastCorrect.improvementXp, 10)
  assert.equal(fastCorrect.completionXp, 2)
  assert.equal(fastCorrect.total, 27)

  assert.equal(slowWrong.correctionXp, 0)
  assert.equal(slowWrong.speedXp, 0)
  assert.equal(slowWrong.completionXp, 2)
  assert.equal(slowWrong.total, 2)
})

test('lesson stats compute mastery and block next lesson when error rate is above threshold', () => {
  const stats = progressTestables.computeLessonStatsFromAttempts([
    { correct: true, attemptScore: 100 },
    { correct: false, attemptScore: 0 },
    { correct: false, attemptScore: 0 },
    { correct: false, attemptScore: 0 },
  ])
  const gate = progressTestables.getUnlockGate({
    xpEarned: LESSON_XP_REQUIRED,
    xpRequired: LESSON_XP_REQUIRED,
    masteryScore: LESSON_MASTERY_THRESHOLD,
    errorRate: stats.errorRate,
    revisionRequired: stats.revisionRequired,
  })

  assert.equal(stats.masteryScore, 25)
  assert.equal(stats.errorRate, 75)
  assert.equal(stats.revisionRequired, true)
  assert.equal(gate.eligible, false)
  assert.ok(gate.reasons.includes(`erreurs ${LESSON_ERROR_BLOCK_THRESHOLD + 25}%`))
})

test('error profile becomes frequent after 3 errors and resolves after 3 successes', () => {
  const now = new Date('2026-03-20T10:00:00.000Z')
  let state = progressTestables.computeNextErrorProfileState(null, { correct: false, now })
  state = progressTestables.computeNextErrorProfileState(state, { correct: false, now })
  state = progressTestables.computeNextErrorProfileState(state, { correct: false, now })
  assert.equal(state.isFrequent, true)
  assert.equal(state.count, 3)
  assert.equal(state.successStreak, 0)

  state = progressTestables.computeNextErrorProfileState(state, { correct: true, now })
  state = progressTestables.computeNextErrorProfileState(state, { correct: true, now })
  state = progressTestables.computeNextErrorProfileState(state, { correct: true, now })
  assert.equal(state.isFrequent, false)
  assert.equal(state.successStreak, 3)
  assert.ok(state.resolvedAt instanceof Date)
  assert.ok(state.nextReviewAt instanceof Date)
})

test('first correct attempt does not create an error profile placeholder', async () => {
  const originalFindUnique = prisma.userErrorProfile.findUnique
  const originalUpsert = prisma.userErrorProfile.upsert

  let upsertCalled = false
  prisma.userErrorProfile.findUnique = async () => null
  prisma.userErrorProfile.upsert = async () => {
    upsertCalled = true
    return {}
  }

  try {
    const result = await upsertErrorProfileFromAttempt({
      userId: 'user-1',
      lessonId: 'a1-1',
      conceptTag: 'article_usage',
      errorTag: 'article_omission',
      correct: true,
      userAnswer: 'der',
      expectedAnswer: 'der',
    })

    assert.equal(result, null)
    assert.equal(upsertCalled, false)
  } finally {
    prisma.userErrorProfile.findUnique = originalFindUnique
    prisma.userErrorProfile.upsert = originalUpsert
  }
})

test('active and due review queries ignore zero-count placeholder profiles', async () => {
  const originalFindMany = prisma.userErrorProfile.findMany
  const calls = []

  prisma.userErrorProfile.findMany = async (args) => {
    calls.push(args)

    if (calls.length === 1) {
      return [
        {
          count: 0,
          isFrequent: false,
          lastSeenAt: new Date(),
          resolvedAt: null,
        },
        {
          count: 3,
          isFrequent: true,
          lastSeenAt: new Date(),
          resolvedAt: null,
        },
      ]
    }

    return []
  }

  try {
    const active = await getActiveErrorProfiles({ userId: 'user-1', niveau: 'A1' })
    const due = await getDueReviewProfiles({ userId: 'user-1', niveau: 'A1' })

    assert.equal(active.length, 1)
    assert.equal(active[0].count, 3)
    assert.equal(calls[1].where.count.gt, 0)
    assert.equal(calls[1].where.resolvedAt.not, null)
    assert.equal(calls[1].where.nextReviewAt.not, null)
    assert.ok(calls[1].where.nextReviewAt.lte instanceof Date)
  } finally {
    prisma.userErrorProfile.findMany = originalFindMany
  }
})

test('lesson mode falls back to base template when there is no active adaptive pressure', () => {
  const lesson = adaptiveTestables.createSessionLesson({
    niveau: 'B1',
    objectif: 'ECRIRE',
    dureeMinutes: 30,
    theme: 'Arbeit',
    levelProfile: { defaultTheme: 'Arbeit', phraseBank: [] },
    levelConcepts: [
      { conceptTag: 'article_usage', errorTag: 'article_omission', skills: ['ECRIRE'], difficultyBase: 25, keywords: [], sentences: [] },
    ],
    conceptPools: {
      weakConcepts: [],
      objectiveConcepts: [],
      reviewConcepts: [],
    },
    userPowerScore: 68,
    complexityIndex200: 120,
    isFirstSessionForLevel: false,
    priorLevelSessionsCount: 3,
    seed: 'lesson-template-seed',
    mode: 'lesson',
    baseLesson: {
      id: 'b1-4',
      numero: 4,
      niveau: 'B1',
      titre: 'Arbeit und Kommunikation',
      description: 'Lecon B1 sur le travail',
      duree: 30,
      phrases: [{ id: 1, alemana: 'Ich arbeite im Buero.', traductionDe: 'Ich arbeite im Buero.', frantsay: 'Je travaille au bureau.', audio: 'Ich arbeite im Buero.' }],
      exercices: [
        { id: 'b1-4-qcm', type: 'qcm', questionDe: 'Test', options: [{ de: 'A', fr: 'A' }], reponse: 0 },
        { id: 'b1-4-fill', type: 'fill', avant: 'Ich', apres: 'im Buero.', reponse: 'arbeite' },
      ],
    },
    hasAdaptivePressure: false,
    activeErrorProfiles: [],
    dueReviewProfiles: [],
  })

  assert.equal(lesson.id, 'b1-4')
  assert.equal(lesson.niveau, 'B1')
  assert.equal(lesson.adaptiveMeta.templateFallback, true)
  assert.equal(lesson.exercices.length, 2)
  assert.ok(lesson.exercices.every((item) => item.bucket === 'objective'))
})

test('lesson mode mixes weak concepts with base lesson objective exercises when adaptive pressure exists', () => {
  const lesson = adaptiveTestables.createSessionLesson({
    niveau: 'B1',
    objectif: 'ECRIRE',
    dureeMinutes: 30,
    theme: 'Arbeit',
    levelProfile: { defaultTheme: 'Arbeit', phraseBank: [] },
    levelConcepts: [
      {
        conceptTag: 'article_usage',
        errorTag: 'article_omission',
        skills: ['ECRIRE', 'LIRE'],
        difficultyBase: 25,
        keywords: [{ de: 'der Beruf', fr: 'le metier' }],
        sentences: [{ de: 'Der Beruf ist wichtig.', fr: 'Le metier est important.' }],
      },
    ],
    conceptPools: {
      weakConcepts: [{
        conceptTag: 'article_usage',
        errorTag: 'article_omission',
        skills: ['ECRIRE', 'LIRE'],
        difficultyBase: 25,
        keywords: [{ de: 'der Beruf', fr: 'le metier' }],
        sentences: [{ de: 'Der Beruf ist wichtig.', fr: 'Le metier est important.' }],
      }],
      objectiveConcepts: [],
      reviewConcepts: [],
    },
    userPowerScore: 68,
    complexityIndex200: 120,
    isFirstSessionForLevel: false,
    priorLevelSessionsCount: 3,
    seed: 'lesson-pressure-seed',
    mode: 'lesson',
    baseLesson: {
      id: 'b1-5',
      numero: 5,
      niveau: 'B1',
      titre: 'Arbeit und Kommunikation',
      description: 'Lecon B1 sur le travail',
      duree: 30,
      phrases: [],
      exercices: [
        { id: 'b1-5-qcm', type: 'qcm', questionDe: 'Test', options: [{ de: 'A', fr: 'A' }], reponse: 0 },
      ],
    },
    hasAdaptivePressure: true,
    activeErrorProfiles: [{ errorTag: 'article_omission', conceptTag: 'article_usage' }],
    dueReviewProfiles: [],
  })

  assert.equal(lesson.niveau, 'B1')
  assert.ok(lesson.exercices.some((item) => item.bucket === 'weak'))
  assert.ok(lesson.exercices.some((item) => item.bucket === 'objective'))
  assert.ok(lesson.adaptiveMeta.activeErrorTags.includes('article_omission'))
})
