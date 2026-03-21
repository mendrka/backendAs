function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

const OBJECTIVE_SKILL_WEIGHTS = {
  PARLER: { PARLER: 40, ECOUTER: 25, ECRIRE: 20, LIRE: 15 },
  ECRIRE: { ECRIRE: 85, LIRE: 15, PARLER: 0, ECOUTER: 0 },
  LIRE: { LIRE: 60, ECRIRE: 40, PARLER: 0, ECOUTER: 0 },
  ECOUTER: { ECOUTER: 45, LIRE: 20, PARLER: 20, ECRIRE: 15 },
  MIXTE: { PARLER: 25, ECOUTER: 25, ECRIRE: 25, LIRE: 25 },
}

function average(values, fallback = 0) {
  if (!Array.isArray(values) || values.length === 0) return fallback
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function computeAttemptScore({ correct, responseTimeMs = 0, targetMs = 30000, hintsUsed = 0 }) {
  const raw = correct ? 100 : 0
  const safeTarget = Math.max(1, Number(targetMs) || 30000)
  const safeResponse = Math.max(0, Number(responseTimeMs) || 0)
  const safeHints = Math.max(0, Number(hintsUsed) || 0)

  const timePenalty = clamp(((safeResponse - safeTarget) / safeTarget) * 20, 0, 20)
  const hintPenalty = clamp(safeHints * 8, 0, 20)
  return clamp(Math.round(raw - timePenalty - hintPenalty), 0, 100)
}

function computeErrorPressure(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return 0
  const errors = attempts.filter((attempt) => !attempt.correct).length
  return clamp(Math.round((errors / attempts.length) * 100), 0, 100)
}

function computeOverallMastery(states) {
  if (!Array.isArray(states) || states.length === 0) return 50
  return clamp(Math.round(average(states.map((state) => Number(state.masteryScore) || 0), 50)), 0, 100)
}

function computeGlobalVolatility(states) {
  if (!Array.isArray(states) || states.length === 0) return 0
  return clamp(Math.round(average(states.map((state) => Number(state.volatility) || 0), 0)), 0, 100)
}

function computeObjectiveMastery(states, objective = 'MIXTE') {
  const normalizedObjective = OBJECTIVE_SKILL_WEIGHTS[objective] ? objective : 'MIXTE'
  const weights = OBJECTIVE_SKILL_WEIGHTS[normalizedObjective]
  if (!Array.isArray(states) || states.length === 0) return 50

  const skillBuckets = {
    PARLER: [],
    ECOUTER: [],
    ECRIRE: [],
    LIRE: [],
  }

  for (const state of states) {
    const skill = String(state.skill || '').toUpperCase()
    if (skillBuckets[skill]) skillBuckets[skill].push(Number(state.masteryScore) || 0)
  }

  let weightedSum = 0
  let weightTotal = 0
  for (const [skill, weight] of Object.entries(weights)) {
    if (weight <= 0) continue
    const skillAverage = average(skillBuckets[skill], 50)
    weightedSum += skillAverage * weight
    weightTotal += weight
  }

  if (weightTotal === 0) return 50
  return clamp(Math.round(weightedSum / weightTotal), 0, 100)
}

function computeUserPowerScore({ objectiveMastery, overallMastery, errorPressure }) {
  const score = Math.round(
    (0.45 * (Number(objectiveMastery) || 0))
      + (0.35 * (Number(overallMastery) || 0))
      + (0.20 * (100 - (Number(errorPressure) || 0)))
  )
  return clamp(score, 1, 100)
}

function computeAdaptiveComplexityIndex200({ userPowerScore, volatility, errorPressure }) {
  const complexity = Math.round(
    ((Number(userPowerScore) || 0) * 1.6)
      + ((Number(volatility) || 0) * 0.6)
      + ((Number(errorPressure) || 0) * 0.4)
  )
  return clamp(complexity, 0, 200)
}

module.exports = {
  OBJECTIVE_SKILL_WEIGHTS,
  clamp,
  computeAttemptScore,
  computeErrorPressure,
  computeOverallMastery,
  computeGlobalVolatility,
  computeObjectiveMastery,
  computeUserPowerScore,
  computeAdaptiveComplexityIndex200,
}
