const express = require('express')

const prisma = require('../prisma/client')
const authMiddleware = require('../middleware/auth.middleware')

const { requireAdmin } = authMiddleware

const router = express.Router()
const CACHE_TTL_MS = 60 * 1000
const cache = new Map()
const SPEAKING_LEVELS = ['A1', 'A2', 'B1', 'B2']

router.use(authMiddleware, requireAdmin)

function parseDays(value, fallback = 30) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(90, Math.max(7, parsed))
}

function parseLimit(value, fallback = 10, max = 50) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(1, parsed))
}

function isoDay(value) {
  if (!value) return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function startOfUtcDay(value = new Date()) {
  const day = isoDay(value) || isoDay(new Date())
  return new Date(`${day}T00:00:00.000Z`)
}

function addUtcDays(value, amount) {
  const date = startOfUtcDay(value)
  date.setUTCDate(date.getUTCDate() + amount)
  return date
}

function listIsoDays(days) {
  const today = startOfUtcDay()
  return Array.from({ length: days }, (_, index) => isoDay(addUtcDays(today, index - (days - 1))))
}

function diffDays(fromDay, toDay) {
  const from = startOfUtcDay(fromDay)
  const to = startOfUtcDay(toDay)
  return Math.round((to - from) / (24 * 60 * 60 * 1000))
}

function round(value, digits = 1) {
  const safe = Number(value) || 0
  return Number(safe.toFixed(digits))
}

function safeSessionScore(session) {
  const jsonScore = session?.scores && typeof session.scores === 'object'
    ? Number(session.scores.global)
    : Number.NaN
  const raw = Number.isFinite(jsonScore) ? jsonScore : Number(session?.score)
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(100, raw))
}

function safeDurationMinutes(session) {
  const durationMs = Number(session?.durationMs)
  if (Number.isFinite(durationMs) && durationMs > 0) {
    return durationMs / 60000
  }

  const durationSeconds = Number(session?.duree)
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return durationSeconds / 60
  }

  const started = session?.startedAt ? new Date(session.startedAt) : null
  const ended = session?.endedAt ? new Date(session.endedAt) : null
  if (started && ended && !Number.isNaN(started.getTime()) && !Number.isNaN(ended.getTime()) && ended >= started) {
    return (ended - started) / 60000
  }

  return 0
}

function sessionDay(session) {
  return isoDay(session?.startedAt || session?.createdAt || session?.endedAt)
}

function isCompletedSession(session) {
  return Boolean(session?.endedAt) || safeDurationMinutes(session) > 0 || safeSessionScore(session) > 0
}

async function readCached(key, loader) {
  const now = Date.now()
  const current = cache.get(key)

  if (current?.data && (now - current.at) < CACHE_TTL_MS) {
    return current.data
  }

  if (current?.promise) {
    return current.promise
  }

  const promise = Promise.resolve()
    .then(loader)
    .then((data) => {
      cache.set(key, { data, at: Date.now() })
      return data
    })
    .catch((error) => {
      cache.delete(key)
      throw error
    })

  cache.set(key, { promise, at: now })
  return promise
}

async function loadUsers() {
  return readCached('admin-users', () => prisma.user.findMany({
    select: {
      id: true,
      prenom: true,
      nom: true,
      email: true,
      niveau: true,
      role: true,
      createdAt: true,
    },
  }))
}

async function loadUserStats() {
  return readCached('admin-user-stats', () => prisma.userStats.findMany({
    select: {
      userId: true,
      lastActivityDay: true,
    },
  }))
}

async function loadProgressions() {
  return readCached('admin-progressions', () => prisma.progression.findMany({
    select: {
      userId: true,
      updatedAt: true,
    },
  }))
}

async function loadChatMessages() {
  return readCached('admin-chat', () => prisma.chatMessage.findMany({
    select: {
      userId: true,
      createdAt: true,
    },
  }))
}

async function loadDirectMessages() {
  return readCached('admin-direct', () => prisma.directMessage.findMany({
    select: {
      senderId: true,
      createdAt: true,
    },
  }))
}

async function loadSprechenSessions() {
  return readCached('admin-sessions', () => prisma.sprechenSession.findMany({
    select: {
      id: true,
      userId: true,
      niveau: true,
      level: true,
      themeId: true,
      score: true,
      scores: true,
      duree: true,
      durationMs: true,
      createdAt: true,
      startedAt: true,
      endedAt: true,
    },
  }))
}

async function loadActivityIndex() {
  const [userStats, progressions, chatMessages, directMessages, sessions] = await Promise.all([
    loadUserStats(),
    loadProgressions(),
    loadChatMessages(),
    loadDirectMessages(),
    loadSprechenSessions(),
  ])

  const activityByUser = new Map()

  function add(userId, value) {
    const day = isoDay(value)
    if (!userId || !day) return
    if (!activityByUser.has(userId)) {
      activityByUser.set(userId, new Set())
    }
    activityByUser.get(userId).add(day)
  }

  userStats.forEach((item) => add(item.userId, item.lastActivityDay))
  progressions.forEach((item) => add(item.userId, item.updatedAt))
  chatMessages.forEach((item) => add(item.userId, item.createdAt))
  directMessages.forEach((item) => add(item.senderId, item.createdAt))
  sessions.forEach((item) => add(item.userId, sessionDay(item)))

  return activityByUser
}

function buildDailyCountSeries(days, values, resolver) {
  const series = listIsoDays(days).map((date) => ({ date, count: 0 }))
  const counts = new Map(series.map((item) => [item.date, 0]))

  values.forEach((value) => {
    const day = resolver(value)
    if (!day || !counts.has(day)) return
    counts.set(day, (counts.get(day) || 0) + 1)
  })

  return series.map((item) => ({
    date: item.date,
    count: counts.get(item.date) || 0,
  }))
}

function buildActiveSeries(days, activityByUser) {
  const series = listIsoDays(days).map((date) => ({ date, count: 0 }))
  const counts = new Map(series.map((item) => [item.date, 0]))

  for (const daySet of activityByUser.values()) {
    for (const day of daySet.values()) {
      if (counts.has(day)) {
        counts.set(day, (counts.get(day) || 0) + 1)
      }
    }
  }

  return series.map((item) => ({
    date: item.date,
    count: counts.get(item.date) || 0,
  }))
}

function hasActivityWithin(daysSet, days) {
  if (!daysSet?.size) return false
  const threshold = isoDay(addUtcDays(new Date(), -(days - 1)))
  return Array.from(daysSet).some((day) => day >= threshold)
}

function retentionRate(users, activityByUser, minimumDays) {
  const eligibleUsers = users.filter((user) => diffDays(isoDay(user.createdAt), isoDay(new Date())) >= minimumDays)
  if (!eligibleUsers.length) return 0

  const retained = eligibleUsers.filter((user) => {
    const signupDay = isoDay(user.createdAt)
    const daysSet = activityByUser.get(user.id)
    if (!daysSet?.size) return false

    return Array.from(daysSet).some((day) => diffDays(signupDay, day) >= minimumDays)
  })

  return round((retained.length / eligibleUsers.length) * 100)
}

router.get('/stats/users/overview', async (req, res) => {
  try {
    const [users, activityByUser] = await Promise.all([
      loadUsers(),
      loadActivityIndex(),
    ])

    const today = isoDay(new Date())
    const totalUsers = users.length
    const newToday = users.filter((user) => isoDay(user.createdAt) === today).length
    const activeToday = Array.from(activityByUser.values()).filter((daysSet) => daysSet.has(today)).length
    const activeThisWeek = Array.from(activityByUser.values()).filter((daysSet) => hasActivityWithin(daysSet, 7)).length
    const activeThisMonth = Array.from(activityByUser.values()).filter((daysSet) => hasActivityWithin(daysSet, 30)).length
    const usersOlderThanMonth = users.filter((user) => diffDays(isoDay(user.createdAt), today) >= 30)
    const churnedCount = usersOlderThanMonth.filter((user) => !hasActivityWithin(activityByUser.get(user.id), 30)).length

    res.json({
      totalUsers,
      newToday,
      activeToday,
      activeThisWeek,
      activeThisMonth,
      churnRate: usersOlderThanMonth.length ? round((churnedCount / usersOlderThanMonth.length) * 100) : 0,
    })
  } catch (error) {
    console.error('[Admin] users overview error:', error.message)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/stats/users/registrations', async (req, res) => {
  const days = parseDays(req.query.days, 30)

  try {
    const users = await loadUsers()
    res.json(buildDailyCountSeries(days, users, (user) => isoDay(user.createdAt)))
  } catch (error) {
    console.error('[Admin] users registrations error:', error.message)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/stats/users/active', async (req, res) => {
  const days = parseDays(req.query.days, 30)

  try {
    const activityByUser = await loadActivityIndex()
    res.json(buildActiveSeries(days, activityByUser))
  } catch (error) {
    console.error('[Admin] users active error:', error.message)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/stats/users/retention', async (req, res) => {
  try {
    const [users, activityByUser] = await Promise.all([
      loadUsers(),
      loadActivityIndex(),
    ])

    res.json({
      day1: retentionRate(users, activityByUser, 1),
      day7: retentionRate(users, activityByUser, 7),
      day30: retentionRate(users, activityByUser, 30),
    })
  } catch (error) {
    console.error('[Admin] users retention error:', error.message)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/stats/users/recent', async (req, res) => {
  const limit = parseLimit(req.query.limit, 10, 25)

  try {
    const [users, sessions, activityByUser] = await Promise.all([
      loadUsers(),
      loadSprechenSessions(),
      loadActivityIndex(),
    ])

    const sessionsByUser = sessions.reduce((map, session) => {
      map.set(session.userId, (map.get(session.userId) || 0) + 1)
      return map
    }, new Map())

    const recentUsers = [...users]
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, limit)
      .map((user) => ({
        id: user.id,
        name: `${user.prenom} ${user.nom}`.trim(),
        email: user.email,
        createdAt: user.createdAt,
        level: user.niveau || 'A1',
        sprechenSessions: sessionsByUser.get(user.id) || 0,
        isActive: hasActivityWithin(activityByUser.get(user.id), 7),
      }))

    res.json(recentUsers)
  } catch (error) {
    console.error('[Admin] users recent error:', error.message)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/stats/sprechen/overview', async (req, res) => {
  try {
    const sessions = await loadSprechenSessions()
    const sessionsToday = sessions.filter((session) => sessionDay(session) === isoDay(new Date())).length
    const completedSessions = sessions.filter(isCompletedSession)
    const scoreSum = sessions.reduce((sum, session) => sum + safeSessionScore(session), 0)
    const durationSum = sessions.reduce((sum, session) => sum + safeDurationMinutes(session), 0)
    const sceneCounts = sessions.reduce((map, session) => {
      const scene = String(session.themeId || 'general').trim() || 'general'
      map.set(scene, (map.get(scene) || 0) + 1)
      return map
    }, new Map())

    const topScene = Array.from(sceneCounts.entries())
      .sort((left, right) => right[1] - left[1])[0]?.[0] || 'general'

    res.json({
      totalSessions: sessions.length,
      sessionsToday,
      avgScoreGlobal: sessions.length ? round(scoreSum / sessions.length) : 0,
      avgDurationMinutes: sessions.length ? round(durationSum / sessions.length) : 0,
      topScene,
      completionRate: sessions.length ? round((completedSessions.length / sessions.length) * 100) : 0,
    })
  } catch (error) {
    console.error('[Admin] sprechen overview error:', error.message)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/stats/sprechen/sessions', async (req, res) => {
  const days = parseDays(req.query.days, 30)

  try {
    const sessions = await loadSprechenSessions()
    res.json(buildDailyCountSeries(days, sessions, sessionDay))
  } catch (error) {
    console.error('[Admin] sprechen sessions error:', error.message)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/stats/sprechen/scores', async (req, res) => {
  try {
    const sessions = await loadSprechenSessions()
    const ranges = Array.from({ length: 10 }, (_, index) => {
      const min = index === 0 ? 0 : (index * 10) + 1
      const max = index === 9 ? 100 : (index + 1) * 10
      return { range: `${min}-${max}`, count: 0 }
    })

    sessions.forEach((session) => {
      const score = safeSessionScore(session)
      const bucket = score >= 100 ? 9 : Math.max(0, Math.floor(score / 10))
      ranges[bucket].count += 1
    })

    res.json(ranges)
  } catch (error) {
    console.error('[Admin] sprechen scores error:', error.message)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/stats/sprechen/duration-by-level', async (req, res) => {
  try {
    const sessions = await loadSprechenSessions()
    const aggregates = new Map(SPEAKING_LEVELS.map((level) => [level, { total: 0, count: 0 }]))

    sessions.forEach((session) => {
      const level = String(session.level || session.niveau || '').toUpperCase()
      if (!aggregates.has(level)) return

      aggregates.get(level).total += safeDurationMinutes(session)
      aggregates.get(level).count += 1
    })

    res.json(SPEAKING_LEVELS.map((level) => {
      const entry = aggregates.get(level)
      return {
        level,
        avgMinutes: entry.count ? round(entry.total / entry.count) : 0,
      }
    }))
  } catch (error) {
    console.error('[Admin] sprechen duration error:', error.message)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/stats/sprechen/top-users', async (req, res) => {
  const limit = parseLimit(req.query.limit, 5, 20)

  try {
    const [users, sessions] = await Promise.all([
      loadUsers(),
      loadSprechenSessions(),
    ])

    const usersById = new Map(users.map((user) => [user.id, user]))
    const aggregates = new Map()

    sessions.forEach((session) => {
      if (!aggregates.has(session.userId)) {
        aggregates.set(session.userId, {
          sessions: 0,
          scoreSum: 0,
          totalMinutes: 0,
        })
      }

      const current = aggregates.get(session.userId)
      current.sessions += 1
      current.scoreSum += safeSessionScore(session)
      current.totalMinutes += safeDurationMinutes(session)
    })

    const ranking = Array.from(aggregates.entries())
      .map(([userId, data]) => {
        const user = usersById.get(userId)
        if (!user) return null

        return {
          name: `${user.prenom} ${user.nom}`.trim(),
          sessions: data.sessions,
          avgScore: data.sessions ? round(data.scoreSum / data.sessions) : 0,
          totalMinutes: round(data.totalMinutes),
          level: user.niveau || 'A1',
        }
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.sessions !== left.sessions) return right.sessions - left.sessions
        return right.avgScore - left.avgScore
      })
      .slice(0, limit)

    res.json(ranking)
  } catch (error) {
    console.error('[Admin] sprechen top users error:', error.message)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

module.exports = router
