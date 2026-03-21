const fs = require('fs')
const path = require('path')
const sqlite3 = require('sqlite3')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

function openSqliteDatabase(filename) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filename, sqlite3.OPEN_READONLY, (err) => {
      if (err) reject(err)
      else resolve(db)
    })
  })
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function toDate(value) {
  if (!value) return undefined
  if (value instanceof Date) return value
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(' ', 'T') + 'Z')
  }
  return new Date(value)
}

async function migrateUsers(rows) {
  const userIdMap = new Map()

  for (const row of rows) {
    const user = await prisma.user.upsert({
      where: { email: row.email },
      update: {
        prenom: row.prenom,
        nom: row.nom,
        password: row.password,
        niveau: row.niveau || 'A1',
        objectif: row.objectif || 'autre',
        createdAt: toDate(row.createdAt),
        updatedAt: toDate(row.updatedAt),
      },
      create: {
        prenom: row.prenom,
        nom: row.nom,
        email: row.email,
        password: row.password,
        niveau: row.niveau || 'A1',
        objectif: row.objectif || 'autre',
        createdAt: toDate(row.createdAt),
        updatedAt: toDate(row.updatedAt),
      },
    })

    userIdMap.set(row.id, user.id)
  }

  return userIdMap
}

async function migrateProgressions(rows, userIdMap) {
  let imported = 0
  let skipped = 0

  for (const row of rows) {
    const userId = userIdMap.get(row.userId)
    if (!userId) {
      skipped += 1
      continue
    }

    await prisma.progression.upsert({
      where: { userId_leconId: { userId, leconId: row.leconId } },
      update: {
        score: row.score ?? 0,
        complete: Boolean(row.complete),
        createdAt: toDate(row.createdAt),
        updatedAt: toDate(row.updatedAt),
      },
      create: {
        userId,
        leconId: row.leconId,
        score: row.score ?? 0,
        complete: Boolean(row.complete),
        createdAt: toDate(row.createdAt),
        updatedAt: toDate(row.updatedAt),
      },
    })

    imported += 1
  }

  return { imported, skipped }
}

async function migrateSessions(rows, userIdMap) {
  let imported = 0
  let skipped = 0

  for (const row of rows) {
    const userId = userIdMap.get(row.userId)
    const partnerId = row.partnerId ? userIdMap.get(row.partnerId) : null

    if (!userId || (row.partnerId && !partnerId)) {
      skipped += 1
      continue
    }

    const createdAt = toDate(row.createdAt)
    const existing = await prisma.sprechenSession.findFirst({
      where: {
        userId,
        partnerId: partnerId || null,
        niveau: row.niveau,
        score: row.score ?? 0,
        duree: row.duree ?? 0,
        exercices: row.exercices,
        createdAt,
      },
      select: { id: true },
    })

    if (!existing) {
      await prisma.sprechenSession.create({
        data: {
          userId,
          partnerId: partnerId || null,
          niveau: row.niveau,
          score: row.score ?? 0,
          duree: row.duree ?? 0,
          exercices: row.exercices,
          createdAt,
        },
      })
    }

    imported += 1
  }

  return { imported, skipped }
}

async function migrateMessages(rows, userIdMap) {
  let imported = 0
  let skipped = 0

  for (const row of rows) {
    const userId = userIdMap.get(row.userId)
    if (!userId) {
      skipped += 1
      continue
    }

    const createdAt = toDate(row.createdAt)
    const existing = await prisma.chatMessage.findFirst({
      where: {
        canalId: row.canalId,
        userId,
        texte: row.texte,
        createdAt,
      },
      select: { id: true },
    })

    if (!existing) {
      await prisma.chatMessage.create({
        data: {
          canalId: row.canalId,
          userId,
          texte: row.texte,
          createdAt,
        },
      })
    }

    imported += 1
  }

  return { imported, skipped }
}

async function main() {
  const sqlitePathArg = process.argv.find((arg) => arg.endsWith('.db'))
  const sqlitePath = path.resolve(sqlitePathArg || path.join(__dirname, 'dev.db'))
  const shouldReset = process.argv.includes('--reset')

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`Base SQLite introuvable: ${sqlitePath}`)
  }

  console.log(`[Migration] Source SQLite: ${sqlitePath}`)
  if (shouldReset) {
    console.log('[Migration] Mode reset active: suppression des données MongoDB avant import')
  }

  const db = await openSqliteDatabase(sqlitePath)

  try {
    const [users, progressions, sessions, messages] = await Promise.all([
      all(db, 'SELECT * FROM users ORDER BY createdAt ASC'),
      all(db, 'SELECT * FROM progressions ORDER BY createdAt ASC'),
      all(db, 'SELECT * FROM sprechen_sessions ORDER BY createdAt ASC'),
      all(db, 'SELECT * FROM chat_messages ORDER BY createdAt ASC'),
    ])

    console.log(`[Migration] SQLite -> users=${users.length}, progressions=${progressions.length}, sessions=${sessions.length}, messages=${messages.length}`)

    if (shouldReset) {
      await prisma.chatMessage.deleteMany()
      await prisma.sprechenSession.deleteMany()
      await prisma.progression.deleteMany()
      await prisma.user.deleteMany()
    }

    const userIdMap = await migrateUsers(users)
    const progressionStats = await migrateProgressions(progressions, userIdMap)
    const sessionStats = await migrateSessions(sessions, userIdMap)
    const messageStats = await migrateMessages(messages, userIdMap)

    console.log('[Migration] Import terminé')
    console.log(`[Migration] Users importés: ${userIdMap.size}`)
    console.log(`[Migration] Progressions importées: ${progressionStats.imported}, ignorées: ${progressionStats.skipped}`)
    console.log(`[Migration] Sessions importées: ${sessionStats.imported}, ignorées: ${sessionStats.skipped}`)
    console.log(`[Migration] Messages importés: ${messageStats.imported}, ignorés: ${messageStats.skipped}`)
  } finally {
    await close(db)
    await prisma.$disconnect()
  }
}

main().catch(async (err) => {
  console.error('[Migration] Échec:', err)
  await prisma.$disconnect()
  process.exit(1)
})
