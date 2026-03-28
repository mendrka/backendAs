const prisma = require('../prisma/client')
const {
  DEFAULT_DNA,
  DEFAULT_LEVEL_THRESHOLDS,
  DEFAULT_PREFERENCES,
  safeArray,
  safeObject,
} = require('../utils/sprechenHelpers')

function defaultProfileData(userId) {
  return {
    userId,
    globalLevel: 'A1',
    globalXP: 0,
    currentStreak: 0,
    longestStreak: 0,
    totalSessions: 0,
    totalMinutes: 0,
    levelXPThresholds: { ...DEFAULT_LEVEL_THRESHOLDS },
    dna: { ...DEFAULT_DNA },
    badges: [],
    preferences: { ...DEFAULT_PREFERENCES },
    dnaHistory: [],
    weeklyChallengesCompleted: [],
  }
}

function normalizeProfile(profile, userId = null) {
  const fallback = defaultProfileData(userId || profile?.userId)

  if (!profile) {
    return {
      id: null,
      ...fallback,
    }
  }

  return {
    ...profile,
    levelXPThresholds: { ...DEFAULT_LEVEL_THRESHOLDS, ...safeObject(profile.levelXPThresholds) },
    dna: { ...DEFAULT_DNA, ...safeObject(profile.dna) },
    badges: safeArray(profile.badges),
    preferences: { ...DEFAULT_PREFERENCES, ...safeObject(profile.preferences) },
    dnaHistory: safeArray(profile.dnaHistory),
    weeklyChallengesCompleted: safeArray(profile.weeklyChallengesCompleted),
  }
}

async function findOrCreateProfile(userId) {
  const existing = await prisma.sprechenProfile.findUnique({ where: { userId } })
  if (existing) return normalizeProfile(existing)

  const created = await prisma.sprechenProfile.create({
    data: defaultProfileData(userId),
  })

  return normalizeProfile(created)
}

async function saveProfile(userId, data) {
  await findOrCreateProfile(userId)

  const updated = await prisma.sprechenProfile.update({
    where: { userId },
    data,
  })

  return normalizeProfile(updated)
}

async function updatePreferences(userId, partialPreferences) {
  const profile = await findOrCreateProfile(userId)

  return saveProfile(userId, {
    preferences: {
      ...profile.preferences,
      ...safeObject(partialPreferences),
      preferredCharacters: safeArray(partialPreferences?.preferredCharacters, profile.preferences.preferredCharacters),
      difficultThemes: safeArray(partialPreferences?.difficultThemes, profile.preferences.difficultThemes),
      strongThemes: safeArray(partialPreferences?.strongThemes, profile.preferences.strongThemes),
    },
  })
}

module.exports = {
  defaultProfileData,
  findOrCreateProfile,
  normalizeProfile,
  saveProfile,
  updatePreferences,
}
