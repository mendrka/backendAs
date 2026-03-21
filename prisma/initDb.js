let dbStatus = {
  checkedAt: null,
  ok: false,
  requiredOnStartup: true,
  error: null,
}

function parseBoolean(raw, fallback) {
  if (raw == null || raw === '') return fallback
  const value = String(raw).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  return fallback
}

function shouldRequireDbOnStartup() {
  // Dev: demarrage tolerant par defaut. Production: strict par defaut.
  const strictDefault = process.env.NODE_ENV === 'production'
  return parseBoolean(process.env.DB_REQUIRED_ON_STARTUP, strictDefault)
}

function summarizeConnectionError(err) {
  const raw = String(err?.message || err || '')
  const lower = raw.toLowerCase()

  if (lower.includes('dns') || lower.includes('name resolution')) {
    return [
      'Impossible de resoudre le host MongoDB Atlas (DNS).',
      'Verifie internet/DNS ou utilise une URL locale (mongodb://127.0.0.1:27017/eam).',
    ].join(' ')
  }

  if (lower.includes('authentication failed')) {
    return 'Echec d authentification MongoDB: verifie user/password dans DATABASE_URL.'
  }

  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'Timeout de connexion MongoDB: verifie reseau, firewall et whitelist IP Atlas.'
  }

  return raw || 'Erreur de connexion MongoDB.'
}

function getDbStatus() {
  return { ...dbStatus }
}

async function initDb() {
  const requiredOnStartup = shouldRequireDbOnStartup()
  dbStatus = {
    checkedAt: new Date().toISOString(),
    ok: false,
    requiredOnStartup,
    error: null,
  }

  // Lazy require pour eviter de crasher au demarrage si Prisma Client n'a pas encore ete genere.
  let PrismaClient
  try {
    ({ PrismaClient } = require('@prisma/client'))
  } catch (err) {
    if (String(err?.message || '').includes('did not initialize yet')) {
      const msg = '@prisma/client n est pas initialise. Lance "npm --prefix backend run db:generate" puis relance le serveur.'
      dbStatus.error = msg
      throw new Error(msg)
    }
    dbStatus.error = String(err?.message || err)
    throw err
  }

  const prisma = new PrismaClient()
  let connected = false
  try {
    await prisma.$connect()
    connected = true
    dbStatus.ok = true
    dbStatus.error = null
    console.log('[Prisma] Connexion MongoDB OK')
    return true
  } catch (err) {
    const summary = summarizeConnectionError(err)
    dbStatus.ok = false
    dbStatus.error = summary
    const message = `[Prisma] Connexion MongoDB impossible: ${summary}`

    if (requiredOnStartup) {
      throw new Error(message)
    }

    console.warn(`${message}\n[Prisma] Demarrage en mode degrade (DB_REQUIRED_ON_STARTUP=false).`)
    return false
  } finally {
    if (connected) {
      await prisma.$disconnect()
    }
  }
}

module.exports = { initDb, getDbStatus }
