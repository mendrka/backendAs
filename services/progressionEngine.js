const { findOrCreateProfile, saveProfile } = require('../models/SprechenProfile')
const {
  DEFAULT_DNA,
  DEFAULT_LEVEL_THRESHOLDS,
  clamp,
  dedupeStrings,
  safeArray,
} = require('../utils/sprechenHelpers')

function resolveLevelFromXP(globalXP, thresholds = DEFAULT_LEVEL_THRESHOLDS) {
  const orderedLevels = Object.entries(thresholds).sort((a, b) => a[1] - b[1])
  let level = orderedLevels[0][0]

  orderedLevels.forEach(([key, minXp]) => {
    if (globalXP >= minXp) {
      level = key
    }
  })

  return level
}

function calculateSessionScores(transcript = []) {
  const userTurns = safeArray(transcript).filter((turn) => turn.role === 'user' && turn.correction)
  if (!userTurns.length) {
    return {
      global: 0,
      phonology: 0,
      fluency: 0,
      vocabulary: 0,
      grammar: 0,
      reactivity: 0,
      confidence: 0,
      intonation: 0,
      naturalness: 0,
    }
  }

  const averageScore = userTurns.reduce((sum, turn) => sum + Number(turn.correction?.score || 0), 0) / userTurns.length
  const averageResponseTime = userTurns.reduce(
    (sum, turn) => sum + Number(turn.metrics?.responseTimeMs || 5000),
    0
  ) / userTurns.length
  const averageHesitations = userTurns.reduce(
    (sum, turn) => sum + Number(turn.metrics?.hesitationCount || 0),
    0
  ) / userTurns.length

  const fluencyScore = averageResponseTime < 3000 ? 90 : averageResponseTime < 6000 ? 72 : 52
  const confidenceScore = averageHesitations < 1 ? 86 : averageHesitations < 3 ? 67 : 46
  const reactivity = clamp(100 - Math.round(averageResponseTime / 100), 20, 95)
  const intonation = clamp(Math.round(averageScore * 0.82), 0, 100)
  const naturalness = clamp(Math.round((averageScore + fluencyScore) / 2), 0, 100)

  return {
    global: Math.round(averageScore),
    phonology: clamp(Math.round(averageScore * 0.9), 0, 100),
    fluency: Math.round(fluencyScore),
    vocabulary: clamp(Math.round(averageScore), 0, 100),
    grammar: clamp(Math.round(averageScore), 0, 100),
    reactivity,
    confidence: Math.round(confidenceScore),
    intonation,
    naturalness,
  }
}

function calculateXP(scores = {}, metrics = {}, session = {}, profile = null) {
  const base = Math.round((scores.global || 0) * 0.5)
  const fluencyBonus = scores.fluency > 80 ? 15 : scores.fluency > 60 ? 8 : 0
  const speedBonus = metrics.avgResponseTimeMs > 0 && metrics.avgResponseTimeMs < 3000
    ? 20
    : metrics.avgResponseTimeMs < 6000
      ? 10
      : 0
  const noHintsBonus = Number(metrics.hintsUsed || 0) === 0 ? 25 : 0
  const perfectBonus = (scores.global || 0) >= 90 ? 30 : 0
  const vocabularyBonus = Math.min(10, Math.round((Number(metrics.vocabularyTargetUsed || 0) / 5) * 10))
  const streakBonus = profile?.currentStreak ? Math.min(20, profile.currentStreak * 2) : 0

  const total = Math.min(
    150,
    base + fluencyBonus + speedBonus + noHintsBonus + perfectBonus + vocabularyBonus + streakBonus
  )

  return {
    base,
    fluencyBonus,
    speedBonus,
    noHintsBonus,
    perfectBonus,
    vocabularyBonus,
    streakBonus,
    total,
    sessionMode: session.mode || 'training',
  }
}

async function updateProfile(userId, { scores, xp, badges = [], durationMs = 0 }) {
  const profile = await findOrCreateProfile(userId)
  const weight = 0.25
  const nextDna = { ...DEFAULT_DNA, ...profile.dna }

  Object.keys(DEFAULT_DNA).forEach((key) => {
    const current = Number(profile.dna[key] || 0)
    const incoming = Number(scores[key] ?? current)
    nextDna[key] = clamp(Math.round(current * (1 - weight) + incoming * weight), 0, 100)
  })

  const today = new Date()
  const todayLabel = today.toDateString()
  const yesterdayLabel = new Date(Date.now() - 86400000).toDateString()
  const lastSessionLabel = profile.lastSessionDate ? new Date(profile.lastSessionDate).toDateString() : null
  const currentStreak = lastSessionLabel === yesterdayLabel
    ? profile.currentStreak + 1
    : lastSessionLabel === todayLabel
      ? profile.currentStreak
      : 1

  const globalXP = profile.globalXP + Number(xp || 0)
  const globalLevel = resolveLevelFromXP(globalXP, profile.levelXPThresholds || DEFAULT_LEVEL_THRESHOLDS)
  const badgeEntries = safeArray(profile.badges).concat(
    safeArray(badges).map((badgeId) => ({
      badgeId,
      earnedAt: new Date().toISOString(),
      context: 'Sprechen session',
    }))
  )

  const updated = await saveProfile(userId, {
    globalXP,
    globalLevel,
    currentStreak,
    longestStreak: Math.max(currentStreak, profile.longestStreak),
    lastSessionDate: today,
    totalSessions: profile.totalSessions + 1,
    totalMinutes: profile.totalMinutes + Math.max(1, Math.round(Number(durationMs || 0) / 60000)),
    dna: nextDna,
    dnaHistory: safeArray(profile.dnaHistory).concat({
      date: today.toISOString(),
      dna: nextDna,
    }).slice(-30),
    badges: badgeEntries,
  })

  return {
    ...updated,
    newBadges: dedupeStrings(badges),
  }
}

function generateDailyChallenge(profile, currentDate = new Date()) {
  const dayIndex = currentDate.getDay()
  const level = profile?.globalLevel || 'A1'
  const hintChallenge = {
    id: `daily-no-hints-${currentDate.toISOString().slice(0, 10)}`,
    type: 'noHints',
    title: 'Sans filet',
    description: 'Termine une session sans hint.',
    xpReward: 45,
  }

  const challengePool = [
    {
      id: `daily-speed-${currentDate.toISOString().slice(0, 10)}`,
      type: 'speed',
      title: 'Tempo',
      description: 'Reponds en moins de 3 secondes a 5 tours.',
      xpReward: 40,
      target: 5,
    },
    hintChallenge,
    {
      id: `daily-theme-${currentDate.toISOString().slice(0, 10)}`,
      type: 'theme',
      title: 'Theme du jour',
      description: `Fais une session ${level} sur le theme prioritaire.`,
      xpReward: 35,
      themeId: safeArray(profile?.preferences?.difficultThemes)[0] || 'general',
    },
    {
      id: `daily-vocab-${currentDate.toISOString().slice(0, 10)}`,
      type: 'vocab',
      title: 'Mot juste',
      description: 'Utilise 5 mots cibles dans une session.',
      xpReward: 50,
      target: 5,
    },
  ]

  return challengePool[dayIndex % challengePool.length]
}

module.exports = {
  calculateSessionScores,
  calculateXP,
  generateDailyChallenge,
  resolveLevelFromXP,
  updateProfile,
}
