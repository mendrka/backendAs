const test = require('node:test')
const assert = require('node:assert/strict')

const {
  computeAttemptScore,
  computeUserPowerScore,
  computeAdaptiveComplexityIndex200,
} = require('../services/adaptiveMath.service')
const { __testables } = require('../services/adaptiveCours.service')

test('computeAttemptScore stays in [0,100] and penalizes time/hints', () => {
  const perfect = computeAttemptScore({
    correct: true,
    responseTimeMs: 10000,
    targetMs: 30000,
    hintsUsed: 0,
  })
  const slower = computeAttemptScore({
    correct: true,
    responseTimeMs: 60000,
    targetMs: 30000,
    hintsUsed: 0,
  })
  const withHints = computeAttemptScore({
    correct: true,
    responseTimeMs: 60000,
    targetMs: 30000,
    hintsUsed: 2,
  })
  const wrong = computeAttemptScore({
    correct: false,
    responseTimeMs: 10000,
    targetMs: 30000,
    hintsUsed: 0,
  })

  assert.equal(perfect, 100)
  assert.ok(slower < perfect)
  assert.ok(withHints <= slower)
  assert.equal(wrong, 0)
})

test('power score and complexity index are clamped and monotonic', () => {
  const low = computeUserPowerScore({
    objectiveMastery: 10,
    overallMastery: 10,
    errorPressure: 90,
  })
  const high = computeUserPowerScore({
    objectiveMastery: 90,
    overallMastery: 85,
    errorPressure: 10,
  })

  assert.ok(low >= 1 && low <= 100)
  assert.ok(high >= 1 && high <= 100)
  assert.ok(high > low)

  const cLow = computeAdaptiveComplexityIndex200({
    userPowerScore: low,
    volatility: 5,
    errorPressure: 20,
  })
  const cHigh = computeAdaptiveComplexityIndex200({
    userPowerScore: high,
    volatility: 60,
    errorPressure: 70,
  })

  assert.ok(cLow >= 0 && cLow <= 200)
  assert.ok(cHigh >= 0 && cHigh <= 200)
  assert.ok(cHigh > cLow)
})

test('target distribution follows 60/25/15 split', () => {
  const { weakCount, objectiveCount, reviewCount } = __testables.computeTargetDistribution(20)
  assert.equal(weakCount, 12)
  assert.equal(objectiveCount, 5)
  assert.equal(reviewCount, 3)
  assert.equal(weakCount + objectiveCount + reviewCount, 20)
})

test('remediation triggers only for two consecutive same-tag errors', () => {
  const yes = __testables.shouldTriggerRemediationFromAttempts([
    { correct: false, errorTag: 'article_omission' },
    { correct: false, errorTag: 'article_omission' },
  ])
  const noDifferentTag = __testables.shouldTriggerRemediationFromAttempts([
    { correct: false, errorTag: 'article_omission' },
    { correct: false, errorTag: 'gender_mismatch' },
  ])
  const noWithSuccess = __testables.shouldTriggerRemediationFromAttempts([
    { correct: true, errorTag: 'article_omission' },
    { correct: false, errorTag: 'article_omission' },
  ])

  assert.equal(yes, true)
  assert.equal(noDifferentTag, false)
  assert.equal(noWithSuccess, false)
})

test('first session of a level prioritizes level foundations', () => {
  const levelConcepts = [
    { conceptTag: 'article_usage', skills: ['ECRIRE'], difficultyBase: 20 },
    { conceptTag: 'noun_gender', skills: ['ECRIRE'], difficultyBase: 25 },
    { conceptTag: 'word_order_v2', skills: ['ECRIRE'], difficultyBase: 30 },
    { conceptTag: 'umlaut_pronunciation', skills: ['PARLER'], difficultyBase: 35 },
    { conceptTag: 'extra_tag', skills: ['LIRE'], difficultyBase: 80 },
  ]

  const pools = __testables.selectConceptPools({
    level: 'A1',
    levelConcepts,
    conceptStates: [],
    recentAttempts: [],
    objective: 'MIXTE',
    userPowerScore: 30,
    isFirstSessionForLevel: true,
  })

  const weakTags = pools.weakConcepts.map((item) => item.conceptTag)
  const objectiveTags = pools.objectiveConcepts.map((item) => item.conceptTag)
  const reviewTags = pools.reviewConcepts.map((item) => item.conceptTag)

  assert.ok(weakTags.includes('article_usage'))
  assert.ok(weakTags.includes('noun_gender'))
  assert.ok(weakTags.includes('word_order_v2'))
  assert.ok(!weakTags.includes('extra_tag'))
  assert.deepEqual(new Set(objectiveTags), new Set(weakTags))
  assert.deepEqual(new Set(reviewTags), new Set(weakTags))
})
