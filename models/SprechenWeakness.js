const prisma = require('../prisma/client')
const { safeArray } = require('../utils/sprechenHelpers')

function normalizeWeakness(item) {
  if (!item) return null

  return {
    ...item,
    errorExamples: safeArray(item.errorExamples),
  }
}

async function upsertWeakness(userId, weakness) {
  if (!weakness?.type || !weakness?.detail) return null

  const existing = await prisma.sprechenWeakness.findFirst({
    where: {
      userId,
      type: weakness.type,
      detail: weakness.detail,
    },
  })

  if (existing) {
    const updated = await prisma.sprechenWeakness.update({
      where: { id: existing.id },
      data: {
        frequency: { increment: 1 },
        lastSeen: new Date(),
        improving: Boolean(weakness.improving),
        resolved: Boolean(weakness.resolved),
        errorExamples: weakness.errorExample
          ? [...safeArray(existing.errorExamples), weakness.errorExample].slice(-10)
          : existing.errorExamples,
      },
    })

    return normalizeWeakness(updated)
  }

  const created = await prisma.sprechenWeakness.create({
    data: {
      userId,
      type: weakness.type,
      detail: weakness.detail,
      errorExamples: weakness.errorExample ? [weakness.errorExample] : [],
    },
  })

  return normalizeWeakness(created)
}

async function listOpenWeaknesses(userId, limit = 5) {
  const weaknesses = await prisma.sprechenWeakness.findMany({
    where: {
      userId,
      resolved: false,
    },
    orderBy: [{ frequency: 'desc' }, { lastSeen: 'desc' }],
    take: limit,
  })

  return weaknesses.map(normalizeWeakness)
}

module.exports = {
  listOpenWeaknesses,
  normalizeWeakness,
  upsertWeakness,
}
