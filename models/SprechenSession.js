const prisma = require('../prisma/client')
const {
  DEFAULT_SERVICES_USED,
  DEFAULT_SESSION_METRICS,
  safeArray,
  safeObject,
} = require('../utils/sprechenHelpers')

function normalizeSession(session) {
  if (!session) return null

  const metrics = {
    ...DEFAULT_SESSION_METRICS,
    ...safeObject(session.metrics),
    hintsLevel: safeArray(safeObject(session.metrics).hintsLevel),
    completedObjectives: safeArray(safeObject(session.metrics).completedObjectives),
  }

  const servicesUsed = {
    ...DEFAULT_SERVICES_USED,
    ...safeObject(session.servicesUsed),
    llm: safeArray(safeObject(session.servicesUsed).llm),
    tts: safeArray(safeObject(session.servicesUsed).tts),
    stt: safeArray(safeObject(session.servicesUsed).stt),
  }

  const scores = safeObject(session.scores)
  if (scores.global == null && typeof session.score === 'number') {
    scores.global = session.score
  }

  return {
    ...session,
    level: session.level || session.niveau,
    mode: session.mode || 'training',
    transcript: safeArray(session.transcript),
    metrics,
    scores,
    feedback: safeObject(session.feedback),
    xpBreakdown: safeObject(session.xpBreakdown),
    badgesEarned: safeArray(session.badgesEarned),
    servicesUsed,
    durationMs: session.durationMs ?? (typeof session.duree === 'number' ? session.duree * 1000 : null),
  }
}

function buildMetricsFromTranscript(transcript, existingMetrics = {}) {
  const metrics = {
    ...DEFAULT_SESSION_METRICS,
    ...safeObject(existingMetrics),
    hintsLevel: safeArray(safeObject(existingMetrics).hintsLevel),
    completedObjectives: safeArray(safeObject(existingMetrics).completedObjectives),
  }

  const userTurns = safeArray(transcript).filter((turn) => turn.role === 'user')
  metrics.totalTurns = safeArray(transcript).length
  metrics.correctTurns = userTurns.filter((turn) => turn.correction?.status === 'correct').length
  metrics.acceptableTurns = userTurns.filter((turn) => turn.correction?.status === 'acceptable').length
  metrics.incorrectTurns = userTurns.filter((turn) => turn.correction?.status === 'incorrect').length

  if (userTurns.length) {
    const responseTimes = userTurns
      .map((turn) => Number(turn.metrics?.responseTimeMs || 0))
      .filter((value) => value > 0)

    metrics.avgResponseTimeMs = responseTimes.length
      ? Math.round(responseTimes.reduce((total, value) => total + value, 0) / responseTimes.length)
      : metrics.avgResponseTimeMs
  }

  return metrics
}

async function createSession(payload) {
  const created = await prisma.sprechenSession.create({
    data: {
      userId: payload.userId,
      partnerId: payload.partnerId || null,
      niveau: payload.level || payload.niveau || 'A1',
      level: payload.level || payload.niveau || 'A1',
      mode: payload.mode || 'training',
      themeId: payload.themeId || 'general',
      characterId: payload.characterId || null,
      wasWarmup: Boolean(payload.wasWarmup),
      startedAt: payload.startedAt || new Date(),
      score: 0,
      duree: 0,
      exercices: payload.exercices ? JSON.stringify(payload.exercices) : null,
      transcript: [],
      metrics: { ...DEFAULT_SESSION_METRICS },
      servicesUsed: { ...DEFAULT_SERVICES_USED },
      badgesEarned: [],
      xpEarned: 0,
    },
  })

  return normalizeSession(created)
}

async function findByIdForUser(id, userId) {
  return normalizeSession(await prisma.sprechenSession.findFirst({ where: { id, userId } }))
}

async function listRecentForUser(userId, limit = 20) {
  const sessions = await prisma.sprechenSession.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return sessions.map(normalizeSession)
}

async function appendTurn(id, userId, turn) {
  const current = await findByIdForUser(id, userId)
  if (!current) return null

  const transcript = [
    ...safeArray(current.transcript),
    {
      ...turn,
      timestamp: turn.timestamp || new Date().toISOString(),
    },
  ]

  const metrics = buildMetricsFromTranscript(transcript, current.metrics)

  const updated = await prisma.sprechenSession.update({
    where: { id },
    data: {
      transcript,
      metrics,
    },
  })

  return normalizeSession(updated)
}

async function pushService(id, userId, kind, serviceName) {
  const current = await findByIdForUser(id, userId)
  if (!current || !serviceName) return current

  const servicesUsed = {
    ...current.servicesUsed,
    [kind]: [...new Set([...(current.servicesUsed[kind] || []), serviceName])],
  }

  const updated = await prisma.sprechenSession.update({
    where: { id },
    data: { servicesUsed },
  })

  return normalizeSession(updated)
}

async function updateSession(id, userId, data) {
  const current = await findByIdForUser(id, userId)
  if (!current) return null

  const updated = await prisma.sprechenSession.update({
    where: { id },
    data,
  })

  return normalizeSession(updated)
}

module.exports = {
  appendTurn,
  buildMetricsFromTranscript,
  createSession,
  findByIdForUser,
  listRecentForUser,
  normalizeSession,
  pushService,
  updateSession,
}
