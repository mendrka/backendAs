const fs = require('fs')
const path = require('path')

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const DATA_DIR = path.join(__dirname, '..', 'data', 'cours')
const cache = new Map()

function normalizeLevel(niveau) {
  const normalized = String(niveau || '').toUpperCase()
  if (!LEVELS.includes(normalized)) throw new Error('Niveau invalide')
  return normalized
}

function loadNiveau(niveau) {
  const normalized = normalizeLevel(niveau)
  if (cache.has(normalized)) return cache.get(normalized)

  const file = path.join(DATA_DIR, `${normalized}.json`)
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw)
  cache.set(normalized, parsed)
  return parsed
}

function listLevelLessons(niveau) {
  const data = loadNiveau(niveau)
  return Array.isArray(data?.lecons) ? data.lecons : []
}

function findLecon(leconId) {
  const id = String(leconId || '')
  const niveau = id.split('-')[0]?.toUpperCase()
  if (!LEVELS.includes(niveau)) return null
  return listLevelLessons(niveau).find((lesson) => lesson.id === id) || null
}

function getLeconMeta(lecon) {
  const phrases = lecon?.phrasesCount ?? (Array.isArray(lecon?.phrases) ? lecon.phrases.length : 0)
  const exercices = lecon?.exercicesCount ?? (Array.isArray(lecon?.exercices) ? lecon.exercices.length : 0)
  const duree = typeof lecon?.duree === 'number' ? lecon.duree : 0
  const mots = Array.isArray(lecon?.mots) ? lecon.mots.length : 0
  return { phrases, exercices, duree, mots }
}

function getLessonIndex(niveau, leconId) {
  const lessons = listLevelLessons(niveau)
  return lessons.findIndex((lesson) => lesson.id === leconId)
}

function getLessonIds(niveau) {
  return listLevelLessons(niveau).map((lesson) => lesson.id)
}

module.exports = {
  LEVELS,
  loadNiveau,
  listLevelLessons,
  findLecon,
  getLeconMeta,
  getLessonIndex,
  getLessonIds,
}
