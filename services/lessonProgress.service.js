const prisma = require('../prisma/client')
const { addXp } = require('./gamification.service')
const { getLessonIds } = require('./courseCatalog.service')

const LESSON_XP_REQUIRED = 100
const LESSON_MASTERY_THRESHOLD = 70
const LESSON_ERROR_BLOCK_THRESHOLD = 50
const ERROR_FREQUENT_THRESHOLD = 3
const ERROR_CLEAR_SUCCESS_THRESHOLD = 3
const ERROR_REVIEW_DELAY_DAYS = 3
const RECENT_ERROR_WINDOW_DAYS = 7

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function getSpeedXp(responseTimeMs = 0) {
  const safeTime = Math.max(0, Number(responseTimeMs) || 0)
  if (safeTime < 60000) return 10
  if (safeTime < 120000) return 5
  if (safeTime < 180000) return 3
  return 0
}

function getImprovementXp({ previousAttempt, correct, attemptScore }) {
  if (!previousAttempt) return correct ? 3 : 0

  const previousScore = Number(previousAttempt.attemptScore) || 0
  const currentScore = Number(attemptScore) || 0
  const delta = currentScore - previousScore

  if (!previousAttempt.correct && correct) return 10
  if (delta >= 20) return 10
  if (delta >= 10) return 5
  if (delta >= 1) return 3
  return 0
}

function computeAttemptXpBreakdown({ correct, responseTimeMs, previousAttempt, attemptScore }) {
  const correctionXp = correct ? 5 : 0
  const speedXp = getSpeedXp(responseTimeMs)
  const improvementXp = getImprovementXp({ previousAttempt, correct, attemptScore })
  const completionXp = 2

  return {
    correctionXp,
    speedXp,
    improvementXp,
    completionXp,
    total: correctionXp + speedXp + improvementXp + completionXp,
  }
}

function computeLessonStatsFromAttempts(attempts) {
  const items = Array.isArray(attempts) ? attempts : []
  if (items.length === 0) {
    return {
      masteryScore: 0,
      errorRate: 0,
      score: 0,
      revisionRequired: false,
    }
  }

  const attemptsCount = items.length
  const wrongCount = items.filter((attempt) => !attempt.correct).length
  const masteryScore = clamp(
    Math.round(items.reduce((sum, attempt) => sum + (Number(attempt.attemptScore) || 0), 0) / attemptsCount),
    0,
    100
  )
  const errorRate = clamp(Math.round((wrongCount / attemptsCount) * 100), 0, 100)

  return {
    masteryScore,
    errorRate,
    score: masteryScore,
    revisionRequired: errorRate > LESSON_ERROR_BLOCK_THRESHOLD,
  }
}

function getLessonProgressionDefaults(overrides = {}) {
  return {
    score: 0,
    complete: false,
    xpEarned: 0,
    xpRequired: LESSON_XP_REQUIRED,
    masteryScore: 0,
    errorRate: 0,
    revisionRequired: false,
    unlockedAt: null,
    lastAttemptAt: null,
    ...overrides,
  }
}

function computeNextErrorProfileState(existing, { correct, now = new Date() }) {
  const count = correct
    ? Number(existing?.count || 0)
    : Number(existing?.count || 0) + 1
  const successStreak = correct
    ? Number(existing?.successStreak || 0) + 1
    : 0

  let isFrequent = Boolean(existing?.isFrequent)
  let resolvedAt = existing?.resolvedAt || null
  let nextReviewAt = existing?.nextReviewAt || null

  if (!correct && count >= ERROR_FREQUENT_THRESHOLD) {
    isFrequent = true
    resolvedAt = null
    nextReviewAt = null
  }

  if (correct && isFrequent && successStreak >= ERROR_CLEAR_SUCCESS_THRESHOLD) {
    isFrequent = false
    resolvedAt = now
    nextReviewAt = new Date(now.getTime() + (ERROR_REVIEW_DELAY_DAYS * 24 * 60 * 60 * 1000))
  }

  return {
    count,
    successStreak,
    isFrequent,
    resolvedAt,
    nextReviewAt,
  }
}

function getUnlockGate(progression) {
  const xpRequired = Number(progression?.xpRequired) || LESSON_XP_REQUIRED
  const xpEarned = Number(progression?.xpEarned) || 0
  const masteryScore = Number(progression?.masteryScore) || 0
  const errorRate = Number(progression?.errorRate) || 0
  const revisionRequired = Boolean(progression?.revisionRequired)

  const reasons = []
  if (xpEarned < xpRequired) reasons.push(`XP ${xpEarned}/${xpRequired}`)
  if (masteryScore < LESSON_MASTERY_THRESHOLD) reasons.push(`maitrise ${masteryScore}/${LESSON_MASTERY_THRESHOLD}`)
  if (revisionRequired || errorRate > LESSON_ERROR_BLOCK_THRESHOLD) reasons.push(`erreurs ${errorRate}%`)

  return {
    eligible: reasons.length === 0,
    reasons,
    xpEarned,
    xpRequired,
    masteryScore,
    errorRate,
    revisionRequired,
  }
}

function lockedReasonFromPrevious(previousProgression) {
  if (!previousProgression || !previousProgression.complete) {
    return 'Termine la lecon precedente'
  }

  const gate = getUnlockGate(previousProgression)
  if (gate.eligible) return null
  return `Bloquee: ${gate.reasons.join(', ')}`
}

async function ensureProgressionRecord({ userId, lessonId, unlockedAt = null }) {
  const existing = await prisma.progression.findUnique({
    where: {
      userId_leconId: {
        userId,
        leconId: lessonId,
      },
    },
  })

  if (existing) {
    if (unlockedAt && !existing.unlockedAt) {
      return prisma.progression.update({
        where: {
          userId_leconId: {
            userId,
            leconId: lessonId,
          },
        },
        data: { unlockedAt },
      })
    }
    return existing
  }

  return prisma.progression.create({
    data: {
      userId,
      leconId: lessonId,
      ...getLessonProgressionDefaults({ unlockedAt }),
    },
  })
}

async function getPreviousAttemptForConcept({ userId, conceptTag }) {
  if (!conceptTag) return null
  return prisma.exerciseAttempt.findFirst({
    where: { userId, conceptTag },
    orderBy: { createdAt: 'desc' },
  })
}

async function syncLessonProgression({ userId, lessonId, xpDelta = 0, markComplete = false, unlockedAt = null }) {
  const [existing, attempts] = await Promise.all([
    ensureProgressionRecord({ userId, lessonId, unlockedAt }),
    prisma.exerciseAttempt.findMany({
      where: { userId, leconId: lessonId },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const lessonStats = computeLessonStatsFromAttempts(attempts)
  const progression = await prisma.progression.update({
    where: {
      userId_leconId: {
        userId,
        leconId: lessonId,
      },
    },
    data: {
      xpEarned: Math.max(0, (Number(existing.xpEarned) || 0) + Math.max(0, Number(xpDelta) || 0)),
      xpRequired: Number(existing.xpRequired) || LESSON_XP_REQUIRED,
      masteryScore: lessonStats.masteryScore,
      errorRate: lessonStats.errorRate,
      revisionRequired: lessonStats.revisionRequired,
      score: lessonStats.score,
      complete: markComplete ? true : existing.complete,
      lastAttemptAt: attempts.length > 0 ? attempts[attempts.length - 1].createdAt : existing.lastAttemptAt,
      unlockedAt: existing.unlockedAt || unlockedAt,
      updatedAt: new Date(),
    },
  })

  return progression
}

async function upsertErrorProfileFromAttempt({
  userId,
  lessonId,
  conceptTag,
  errorTag,
  correct,
  userAnswer,
  expectedAnswer,
}) {
  if (!userId || !lessonId || !conceptTag) return null

  const now = new Date()
  const errorKey = String(errorTag || conceptTag)
  const existing = await prisma.userErrorProfile.findUnique({
    where: {
      userId_leconId_conceptTag_errorTag: {
        userId,
        leconId: lessonId,
        conceptTag,
        errorTag: errorKey,
      },
    },
  })

  // Do not create placeholder error rows for a first-time correct answer.
  if (!existing && correct) return null

  const nextState = computeNextErrorProfileState(existing, { correct, now })

  return prisma.userErrorProfile.upsert({
    where: {
      userId_leconId_conceptTag_errorTag: {
        userId,
        leconId: lessonId,
        conceptTag,
        errorTag: errorKey,
      },
    },
    update: {
      count: nextState.count,
      successStreak: nextState.successStreak,
      isFrequent: nextState.isFrequent,
      lastUserAnswer: userAnswer != null ? String(userAnswer) : null,
      lastExpectedAnswer: expectedAnswer != null ? String(expectedAnswer) : null,
      lastSeenAt: now,
      resolvedAt: nextState.resolvedAt,
      nextReviewAt: nextState.nextReviewAt,
      updatedAt: now,
    },
    create: {
      userId,
      leconId: lessonId,
      conceptTag,
      errorTag: errorKey,
      count: nextState.count,
      successStreak: nextState.successStreak,
      isFrequent: nextState.isFrequent,
      lastUserAnswer: userAnswer != null ? String(userAnswer) : null,
      lastExpectedAnswer: expectedAnswer != null ? String(expectedAnswer) : null,
      lastSeenAt: now,
      resolvedAt: nextState.resolvedAt,
      nextReviewAt: nextState.nextReviewAt,
    },
  })
}

async function awardAttemptXp({
  userId,
  lessonId,
  correct,
  responseTimeMs,
  attemptScore,
  previousAttempt,
}) {
  const breakdown = computeAttemptXpBreakdown({
    correct,
    responseTimeMs,
    previousAttempt,
    attemptScore,
  })

  if (breakdown.total > 0) {
    await addXp(userId, breakdown.total, 'adaptive_attempt')
  }

  const progression = await syncLessonProgression({
    userId,
    lessonId,
    xpDelta: breakdown.total,
  })

  return { breakdown, progression }
}

function normalizeProgression(progression, overrides = {}) {
  const defaults = getLessonProgressionDefaults()
  return {
    ...defaults,
    ...(progression || {}),
    xpEarned: Number(progression?.xpEarned) || 0,
    xpRequired: Number(progression?.xpRequired) || LESSON_XP_REQUIRED,
    masteryScore: Number(progression?.masteryScore) || 0,
    errorRate: Number(progression?.errorRate) || 0,
    revisionRequired: Boolean(progression?.revisionRequired),
    complete: Boolean(progression?.complete),
    score: Number(progression?.score) || 0,
    ...overrides,
  }
}

async function getActiveErrorProfiles({ userId, lessonId = null, niveau = null }) {
  const where = { userId }
  if (lessonId) {
    where.leconId = lessonId
  } else if (niveau) {
    where.leconId = { startsWith: `${String(niveau).toLowerCase()}-` }
  }

  const since = new Date(Date.now() - (RECENT_ERROR_WINDOW_DAYS * 24 * 60 * 60 * 1000))
  const profiles = await prisma.userErrorProfile.findMany({
    where,
    orderBy: [{ isFrequent: 'desc' }, { lastSeenAt: 'desc' }],
    take: 30,
  })

  return profiles.filter((profile) => {
    if ((Number(profile.count) || 0) <= 0) return false
    if (profile.isFrequent) return true
    if (!profile.lastSeenAt) return false
    return new Date(profile.lastSeenAt).getTime() >= since.getTime() && !profile.resolvedAt
  })
}

async function getDueReviewProfiles({ userId, niveau = null }) {
  const where = {
    userId,
    count: { gt: 0 },
    resolvedAt: { not: null },
    nextReviewAt: {
      not: null,
      lte: new Date(),
    },
  }
  if (niveau) {
    where.leconId = { startsWith: `${String(niveau).toLowerCase()}-` }
  }

  return prisma.userErrorProfile.findMany({
    where,
    orderBy: { nextReviewAt: 'asc' },
    take: 20,
  })
}

async function buildLevelUnlockMap({ userId, niveau }) {
  const lessonIds = getLessonIds(niveau)
  const progressions = await prisma.progression.findMany({
    where: {
      userId,
      leconId: { in: lessonIds },
    },
  })
  const progressionMap = new Map(progressions.map((item) => [item.leconId, item]))
  const unlockMap = new Map()

  lessonIds.forEach((lessonId, index) => {
    const progression = normalizeProgression(progressionMap.get(lessonId))
    if (index === 0) {
      unlockMap.set(lessonId, {
        unlocked: true,
        lockedReason: null,
        gate: getUnlockGate(progression),
        progression,
      })
      return
    }

    const previousId = lessonIds[index - 1]
    const previous = unlockMap.get(previousId)
    const persistedUnlocked = Boolean(progression?.unlockedAt)
    const unlocked = persistedUnlocked || Boolean(previous?.progression?.complete && previous?.gate?.eligible)
    unlockMap.set(lessonId, {
      unlocked,
      lockedReason: unlocked ? null : lockedReasonFromPrevious(previous?.progression),
      gate: getUnlockGate(progression),
      progression,
    })
  })

  return unlockMap
}

async function getLessonUnlockStatus({ userId, niveau, lessonId }) {
  const unlockMap = await buildLevelUnlockMap({ userId, niveau })
  return unlockMap.get(lessonId) || {
    unlocked: false,
    lockedReason: 'Lecon introuvable',
    gate: getUnlockGate(null),
    progression: normalizeProgression(null),
  }
}

function formatLessonState(progression, unlockStatus = null) {
  const normalized = normalizeProgression(progression)
  return {
    lessonId: normalized.leconId,
    xpEarned: normalized.xpEarned,
    xpRequired: normalized.xpRequired,
    masteryScore: normalized.masteryScore,
    errorRate: normalized.errorRate,
    revisionRequired: normalized.revisionRequired,
    complete: normalized.complete,
    score: normalized.score,
    unlockedAt: normalized.unlockedAt,
    lastAttemptAt: normalized.lastAttemptAt,
    unlockStatus: unlockStatus
      ? {
          unlocked: Boolean(unlockStatus.unlocked),
          lockedReason: unlockStatus.lockedReason || null,
          eligibleToUnlockNext: Boolean(unlockStatus.gate?.eligible),
          gate: unlockStatus.gate,
        }
      : undefined,
  }
}

module.exports = {
  LESSON_XP_REQUIRED,
  LESSON_MASTERY_THRESHOLD,
  LESSON_ERROR_BLOCK_THRESHOLD,
  ERROR_FREQUENT_THRESHOLD,
  ERROR_CLEAR_SUCCESS_THRESHOLD,
  ensureProgressionRecord,
  getPreviousAttemptForConcept,
  awardAttemptXp,
  syncLessonProgression,
  upsertErrorProfileFromAttempt,
  getUnlockGate,
  getLessonUnlockStatus,
  buildLevelUnlockMap,
  getActiveErrorProfiles,
  getDueReviewProfiles,
  formatLessonState,
  normalizeProgression,
  __testables: {
    clamp,
    getSpeedXp,
    getImprovementXp,
    computeAttemptXpBreakdown,
    computeLessonStatsFromAttempts,
    computeNextErrorProfileState,
    getUnlockGate,
  },
}
