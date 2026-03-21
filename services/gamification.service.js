const prisma = require('../prisma/client')

const BADGES = [
  {
    id: 'first_xp',
    icon: '⚡',
    nameDe: 'Erste XP',
    nameFr: 'Première XP',
    descriptionDe: 'Verdiene deine ersten XP.',
    descriptionFr: 'Gagne tes premiers XP.',
    isUnlocked: ({ stats }) => stats.xp > 0,
  },
  {
    id: 'streak_3',
    icon: '🔥',
    nameDe: '3 Tage Serie',
    nameFr: 'Série de 3 jours',
    descriptionDe: 'Lerne 3 Tage hintereinander.',
    descriptionFr: 'Étudie 3 jours de suite.',
    isUnlocked: ({ stats }) => stats.streakCurrent >= 3 || stats.streakBest >= 3,
  },
  {
    id: 'streak_7',
    icon: '🚀',
    nameDe: '7 Tage Serie',
    nameFr: 'Série de 7 jours',
    descriptionDe: 'Lerne 7 Tage hintereinander.',
    descriptionFr: 'Étudie 7 jours de suite.',
    isUnlocked: ({ stats }) => stats.streakCurrent >= 7 || stats.streakBest >= 7,
  },
  {
    id: 'lessons_10',
    icon: '📚',
    nameDe: '10 Lektionen',
    nameFr: '10 leçons',
    descriptionDe: 'Schließe 10 Lektionen ab.',
    descriptionFr: 'Termine 10 leçons.',
    isUnlocked: ({ lessonsCompleted }) => lessonsCompleted >= 10,
  },
  {
    id: 'sprecher_5',
    icon: '🎤',
    nameDe: '5 Sprecheinheiten',
    nameFr: '5 sessions orales',
    descriptionDe: 'Beende 5 Sprechen-Sitzungen.',
    descriptionFr: 'Termine 5 sessions de sprechen.',
    isUnlocked: ({ sprechenSessions }) => sprechenSessions >= 5,
  },
]

function getTodayIsoDay() {
  return new Date().toISOString().slice(0, 10)
}

function getYesterdayIsoDay(fromIsoDay = getTodayIsoDay()) {
  const date = new Date(`${fromIsoDay}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function getLevelFromXp(xp) {
  return Math.max(1, Math.floor((xp || 0) / 100) + 1)
}

function getXpWindow(xp) {
  const safeXp = Math.max(0, xp || 0)
  return {
    currentLevel: getLevelFromXp(safeXp),
    current: safeXp % 100,
    next: 100,
  }
}

async function ensureUserStats(userId) {
  try {
    return await prisma.userStats.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        xp: 0,
        level: 1,
        streakCurrent: 0,
        streakBest: 0,
        badgesCount: 0,
      },
    })
  } catch (error) {
    if (error?.code === 'P2002') {
      const stats = await prisma.userStats.findUnique({ where: { userId } })
      if (stats) return stats
    }
    throw error
  }
}

async function getUserProgressSnapshot(userId) {
  const [lessonsCompleted, sprechenSessions] = await Promise.all([
    prisma.progression.count({ where: { userId, complete: true } }),
    prisma.sprechenSession.count({ where: { userId } }),
  ])

  return { lessonsCompleted, sprechenSessions }
}

async function syncBadges(userId, stats) {
  const progress = await getUserProgressSnapshot(userId)
  const userBadges = await prisma.userBadge.findMany({ where: { userId } })
  const badgeMap = new Map(userBadges.map((badge) => [badge.badgeId, badge]))
  const newlyUnlocked = []

  for (const badge of BADGES) {
    const unlocked = badge.isUnlocked({ stats, ...progress })
    const existing = badgeMap.get(badge.id)

    if (unlocked && (!existing || !existing.debloque)) {
      const saved = await prisma.userBadge.upsert({
        where: { userId_badgeId: { userId, badgeId: badge.id } },
        update: { debloque: true, debloqueAt: new Date(), vu: false },
        create: {
          userId,
          badgeId: badge.id,
          debloque: true,
          debloqueAt: new Date(),
          vu: false,
        },
      })
      newlyUnlocked.push(saved.badgeId)
    } else if (!existing) {
      await prisma.userBadge.upsert({
        where: { userId_badgeId: { userId, badgeId: badge.id } },
        update: {},
        create: {
          userId,
          badgeId: badge.id,
          debloque: false,
          vu: false,
        },
      })
    }
  }

  const unlockedCount = await prisma.userBadge.count({
    where: { userId, debloque: true },
  })

  const updatedStats = await prisma.userStats.update({
    where: { userId },
    data: { badgesCount: unlockedCount },
  })

  return { updatedStats, newlyUnlocked, progress }
}

async function addXp(userId, amount, action = 'manual') {
  const xpAmount = Math.max(0, Math.round(Number(amount) || 0))
  const baseStats = await ensureUserStats(userId)
  const nextXp = baseStats.xp + xpAmount
  const nextLevel = getLevelFromXp(nextXp)

  const stats = await prisma.userStats.update({
    where: { userId },
    data: {
      xp: nextXp,
      level: nextLevel,
    },
  })

  const { updatedStats, newlyUnlocked } = await syncBadges(userId, stats)

  return {
    action,
    gained: xpAmount,
    stats: updatedStats,
    xpWindow: getXpWindow(updatedStats.xp),
    newlyUnlocked,
  }
}

async function checkDailyStreak(userId) {
  const stats = await ensureUserStats(userId)
  const today = getTodayIsoDay()
  const yesterday = getYesterdayIsoDay(today)

  let streakCurrent = stats.streakCurrent

  if (stats.lastActivityDay === today) {
    return {
      alreadyChecked: true,
      stats,
      xpWindow: getXpWindow(stats.xp),
    }
  }

  if (stats.lastActivityDay === yesterday) {
    streakCurrent += 1
  } else {
    streakCurrent = 1
  }

  const nextStats = await prisma.userStats.update({
    where: { userId },
    data: {
      streakCurrent,
      streakBest: Math.max(stats.streakBest, streakCurrent),
      lastActivityDay: today,
    },
  })

  const { updatedStats, newlyUnlocked } = await syncBadges(userId, nextStats)

  return {
    alreadyChecked: false,
    stats: updatedStats,
    xpWindow: getXpWindow(updatedStats.xp),
    newlyUnlocked,
  }
}

async function getGamificationStats(userId) {
  const stats = await ensureUserStats(userId)
  const { updatedStats, progress } = await syncBadges(userId, stats)

  return {
    stats: updatedStats,
    xpWindow: getXpWindow(updatedStats.xp),
    lessonsCompleted: progress.lessonsCompleted,
    sprechenSessions: progress.sprechenSessions,
  }
}

async function getBadges(userId) {
  await ensureUserStats(userId)
  const userBadges = await prisma.userBadge.findMany({ where: { userId } })
  const state = new Map(userBadges.map((item) => [item.badgeId, item]))

  return BADGES.map((badge) => ({
    id: badge.id,
    icon: badge.icon,
    nameDe: badge.nameDe,
    nameFr: badge.nameFr,
    descriptionDe: badge.descriptionDe,
    descriptionFr: badge.descriptionFr,
    debloque: Boolean(state.get(badge.id)?.debloque),
    debloqueAt: state.get(badge.id)?.debloqueAt || null,
    vu: Boolean(state.get(badge.id)?.vu),
  }))
}

async function markBadgeViewed(userId, badgeId) {
  return prisma.userBadge.upsert({
    where: { userId_badgeId: { userId, badgeId } },
    update: { vu: true },
    create: { userId, badgeId, debloque: false, vu: true },
  })
}

async function getLeaderboard(limit = 10) {
  const top = await prisma.userStats.findMany({
    orderBy: [{ xp: 'desc' }, { streakBest: 'desc' }, { updatedAt: 'asc' }],
    take: Math.min(20, Math.max(1, Number(limit) || 10)),
    include: {
      user: {
        select: {
          prenom: true,
          nom: true,
          niveau: true,
          objectif: true,
        },
      },
    },
  })

  return top.map((row, index) => ({
    rank: index + 1,
    xp: row.xp,
    level: row.level,
    streakBest: row.streakBest,
    badgesCount: row.badgesCount,
    user: row.user,
  }))
}

module.exports = {
  BADGES,
  ensureUserStats,
  getGamificationStats,
  addXp,
  checkDailyStreak,
  getBadges,
  markBadgeViewed,
  getLeaderboard,
}
