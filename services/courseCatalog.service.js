const fs = require('fs')
const path = require('path')

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const SOURCE_DIR = path.join(__dirname, '..', '..', 'front', 'src', 'data', 'lecon')
const SUPPORTED_EXTENSIONS = new Set(['.json', '.txt'])
const cache = new Map()

const KEYWORD_STOPWORDS = new Set([
  'der', 'die', 'das', 'und', 'oder', 'mit', 'von', 'des', 'dem', 'den', 'ein', 'eine', 'einer', 'einem',
  'ich', 'du', 'er', 'sie', 'wir', 'ihr', 'ist', 'sind', 'war', 'were', 'sein', 'haben', 'nicht', 'noch',
  'pour', 'avec', 'dans', 'sans', 'plus', 'tres', 'tout', 'toute', 'toutes', 'quelque', 'comme', 'cela',
  'cette', 'cet', 'ces', 'des', 'les', 'une', 'un', 'est', 'sont', 'sur', 'par', 'que', 'qui', 'quoi',
  'your', 'vous', 'nous', 'ils', 'elles', 'their', 'from', 'into', 'dans', 'vers', 'pour', 'chez',
])

function normalizeLevel(niveau) {
  const normalized = String(niveau || '').toUpperCase()
  if (!LEVELS.includes(normalized)) throw new Error('Niveau invalide')
  return normalized
}

function uniqueStrings(values) {
  const seen = new Set()
  const output = []
  for (const item of Array.isArray(values) ? values : []) {
    const value = String(item || '').trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function scalarToText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function pickFirstText(source, keys) {
  for (const key of keys) {
    const value = scalarToText(source?.[key])
    if (value) return value
  }
  return ''
}

function numericSuffix(value, fallback = 0) {
  const match = String(value || '').match(/(\d+)(?!.*\d)/)
  if (!match) return fallback
  return parseInt(match[1], 10)
}

function levelDirectory(niveau) {
  return path.join(SOURCE_DIR, normalizeLevel(niveau))
}

function listSourceFiles(niveau) {
  const dir = levelDirectory(niveau)
  if (!fs.existsSync(dir)) return []

  return fs.readdirSync(dir)
    .filter((fileName) => SUPPORTED_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    .map((fileName) => ({
      fileName,
      fullPath: path.join(dir, fileName),
    }))
}

function readLessonFile(file) {
  const raw = fs.readFileSync(file.fullPath, 'utf8')
  return {
    fileName: file.fileName,
    source: JSON.parse(raw),
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function compactObject(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value != null && value !== '' && !(Array.isArray(value) && value.length === 0)))
}

function buildObjectSummary(value) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''

  const preferredPairs = [
    ['structure', 'sens'],
    ['Structure', 'Sens'],
    ['mot', 'usage'],
    ['mot', 'sens'],
    ['mot', 'traduction'],
    ['mot', 'explication'],
    ['type', 'phrase'],
    ['type', 'exemple'],
    ['temps', 'usage'],
    ['Verbe', 'Exemple'],
    ['usage', 'exemple'],
    ['usage', 'explication'],
    ['expression', 'usage'],
    ['exemple', 'explication'],
  ]

  for (const [leftKey, rightKey] of preferredPairs) {
    const left = scalarToText(value[leftKey])
    const right = scalarToText(value[rightKey])
    if (left && right) return `${left}: ${right}`
  }

  const parts = Object.values(value)
    .map((item) => scalarToText(item))
    .filter(Boolean)
    .slice(0, 3)
  return parts.join(' - ')
}

function normalizeGrammarSection(section, index) {
  if (!section || typeof section !== 'object') return null

  const bullets = uniqueStrings([
    ...toArray(section.liste).map(buildObjectSummary),
    ...toArray(section.tableau).map(buildObjectSummary),
    ...toArray(section.points).map(buildObjectSummary),
    ...toArray(section.exemples).map(buildObjectSummary),
    ...toArray(section.formes).map(buildObjectSummary),
  ])

  return compactObject({
    id: `${index + 1}`,
    title: pickFirstText(section, ['titre', 'title']) || `Point ${index + 1}`,
    body: pickFirstText(section, ['explication', 'note', 'contraction', 'regle']),
    bullets,
  })
}

function normalizeVocabularyItem(item, index) {
  if (!item || typeof item !== 'object') return null
  const de = pickFirstText(item, ['de', 'mot', 'expression'])
  const fr = pickFirstText(item, ['fr', 'traduction', 'sens'])
  if (!de && !fr) return null

  return compactObject({
    id: `${index + 1}`,
    de: de || fr,
    fr: fr || de,
    type: pickFirstText(item, ['type']),
    note: pickFirstText(item, ['usage', 'note', 'pluriel', 'frequence', 'antonyme']),
  })
}

function normalizeInfoCard(item, index, fallbackTitle = 'Repere') {
  if (typeof item === 'string') {
    return { id: `${index + 1}`, title: `${fallbackTitle} ${index + 1}`, body: item }
  }
  if (!item || typeof item !== 'object') return null

  return compactObject({
    id: `${index + 1}`,
    title: pickFirstText(item, ['titre', 'title', 'sujet', 'type']) || `${fallbackTitle} ${index + 1}`,
    body: pickFirstText(item, ['explication', 'astuce', 'phrase', 'description', 'sens', 'example']),
  })
}

function normalizePhrase(entry, index) {
  if (!entry || typeof entry !== 'object') return null
  const de = pickFirstText(entry, ['de', 'allemand', 'texte'])
  const fr = pickFirstText(entry, ['fr', 'traduction'])
  if (!de && !fr) return null

  const analysisNotes = uniqueStrings(
    toArray(entry.analyse_mot_par_mot).map((item) => {
      if (!item || typeof item !== 'object') return ''
      const head = pickFirstText(item, ['mot', 'lemme', 'expression']) || 'Repere'
      const body = pickFirstText(item, ['traduction_directe', 'traduction', 'usage', 'regle', 'explication', 'note'])
      return body ? `${head}: ${body}` : head
    })
  )

  return compactObject({
    id: String(entry.id || index + 1),
    alemana: de || fr,
    traductionDe: de || fr,
    frantsay: fr || de,
    audio: de || fr,
    phonetique: pickFirstText(entry, ['phonetique']),
    registre: pickFirstText(entry, ['registre']),
    intonation: pickFirstText(entry, ['intonation']),
    notes: analysisNotes.slice(0, 4),
  })
}

function cleanAcceptedAnswer(answer) {
  return String(answer || '')
    .replace(/\((?:ou|oder)\s*:\s*[^)]+\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitAnswerVariants(answer) {
  const text = String(answer || '').trim()
  if (!text) return []

  const variants = [text]
  const cleaned = cleanAcceptedAnswer(text)
  if (cleaned && cleaned !== text) variants.push(cleaned)

  const slashParts = text
    .split(/\s*\/\s*/)
    .map((item) => cleanAcceptedAnswer(item))
    .filter(Boolean)
  variants.push(...slashParts)

  const parentheticalAlt = text.match(/\((?:ou|oder)\s*:\s*([^)]+)\)/i)
  if (parentheticalAlt?.[1]) variants.push(cleanAcceptedAnswer(parentheticalAlt[1]))

  return uniqueStrings(variants)
}

function tokenizeForKeywords(text) {
  return uniqueStrings(
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !KEYWORD_STOPWORDS.has(token))
  )
}

function buildKeywords(exercise, acceptedAnswers, modelAnswer) {
  const keywords = [
    ...acceptedAnswers.flatMap((value) => tokenizeForKeywords(value)),
    ...toArray(exercise?.criteres_evaluation).flatMap((value) => tokenizeForKeywords(value)),
    ...toArray(exercise?.expressions_bonus).flatMap((value) => tokenizeForKeywords(value)),
    ...tokenizeForKeywords(modelAnswer),
  ]

  return uniqueStrings(keywords).slice(0, 10)
}

function difficultyToScore(value) {
  const difficulty = Math.max(1, Math.min(5, Number(value) || 2))
  return Math.round(15 + difficulty * 17)
}

function normalizeOpenExercise(exercise, lessonId, index) {
  const acceptedAnswers = uniqueStrings([
    ...splitAnswerVariants(exercise.reponse_attendue),
    ...toArray(exercise.reponses_acceptees).flatMap(splitAnswerVariants),
  ])

  const modelAnswer = acceptedAnswers[0]
    || uniqueStrings(toArray(exercise.modele_reponse)).join(' ')
    || ''

  const sourceType = String(exercise.type || 'reponse_libre')
  const longFormTypes = new Set(['situation', 'oral_simulation'])
  const forceKeywords = longFormTypes.has(sourceType) && acceptedAnswers.length <= 1
  const keywords = buildKeywords(exercise, acceptedAnswers, modelAnswer)

  return compactObject({
    id: String(exercise.id || `${lessonId}-open-${index + 1}`),
    type: 'open',
    sourceType,
    questionFr: pickFirstText(exercise, ['question']),
    questionDe: pickFirstText(exercise, ['question']),
    reponse: acceptedAnswers[0] || modelAnswer,
    accepte: acceptedAnswers,
    modelAnswerFr: modelAnswer || null,
    explication: pickFirstText(exercise, ['explication']),
    criteria: uniqueStrings(toArray(exercise.criteres_evaluation)),
    bonusExpressions: uniqueStrings(toArray(exercise.expressions_bonus)),
    textarea: forceKeywords,
    evaluationMode: forceKeywords ? 'keywords' : 'exact',
    keywords,
    keywordThreshold: forceKeywords ? 0.6 : null,
    conceptTag: `${lessonId}_${sourceType}`,
    skill: sourceType === 'oral_simulation' ? 'PARLER' : 'ECRIRE',
    difficulty: difficultyToScore(exercise.difficulte),
    targetMs: forceKeywords ? 90000 : 45000,
  })
}

function normalizeExercise(exercise, lessonId, index) {
  const sourceType = String(exercise?.type || '').toLowerCase()

  if (sourceType === 'choix_multiple' || sourceType === 'expression' || sourceType === 'ponctuation') {
    return compactObject({
      id: String(exercise.id || `${lessonId}-qcm-${index + 1}`),
      type: 'qcm',
      questionFr: pickFirstText(exercise, ['question']),
      questionDe: pickFirstText(exercise, ['question']),
      options: toArray(exercise.options).map((option) => ({ de: scalarToText(option), fr: scalarToText(option) })),
      reponse: Number(exercise.reponse_correcte) || 0,
      explication: pickFirstText(exercise, ['explication']),
      conceptTag: `${lessonId}_${sourceType}`,
      skill: 'LIRE',
      difficulty: difficultyToScore(exercise.difficulte),
      targetMs: 35000,
    })
  }

  if (sourceType === 'vrai_faux') {
    return compactObject({
      id: String(exercise.id || `${lessonId}-vf-${index + 1}`),
      type: 'qcm',
      questionFr: pickFirstText(exercise, ['question']),
      questionDe: pickFirstText(exercise, ['question']),
      options: [
        { de: 'Richtig', fr: 'Vrai' },
        { de: 'Falsch', fr: 'Faux' },
      ],
      reponse: exercise.reponse ? 0 : 1,
      explication: pickFirstText(exercise, ['explication']),
      conceptTag: `${lessonId}_${sourceType}`,
      skill: 'LIRE',
      difficulty: difficultyToScore(exercise.difficulte),
      targetMs: 25000,
    })
  }

  if (sourceType === 'association') {
    return compactObject({
      id: String(exercise.id || `${lessonId}-match-${index + 1}`),
      type: 'match',
      promptFr: pickFirstText(exercise, ['question']),
      promptDe: pickFirstText(exercise, ['question']),
      pairs: toArray(exercise.paires).map((pair) => ({
        de: pickFirstText(pair, ['gauche']),
        fr: pickFirstText(pair, ['droite']),
      })).filter((pair) => pair.de && pair.fr),
      explication: pickFirstText(exercise, ['explication']),
      conceptTag: `${lessonId}_${sourceType}`,
      skill: 'LIRE',
      difficulty: difficultyToScore(exercise.difficulte),
      targetMs: 50000,
    })
  }

  if (sourceType === 'reconstruction') {
    const words = uniqueStrings(toArray(exercise.mots))
    const answer = uniqueStrings(toArray(exercise.solution)).join(' ') || words.join(' ')
    return compactObject({
      id: String(exercise.id || `${lessonId}-build-${index + 1}`),
      type: 'build',
      promptFr: pickFirstText(exercise, ['question']),
      promptDe: pickFirstText(exercise, ['question']),
      words,
      answer,
      explication: pickFirstText(exercise, ['explication']),
      conceptTag: `${lessonId}_${sourceType}`,
      skill: 'ECRIRE',
      difficulty: difficultyToScore(exercise.difficulte),
      targetMs: 60000,
    })
  }

  return normalizeOpenExercise(exercise, lessonId, index)
}

function pickDialogueEntries(source) {
  if (Array.isArray(source?.dialogue)) return source.dialogue
  if (Array.isArray(source?.dialogue_modele)) return source.dialogue_modele
  if (Array.isArray(source?.dialogue_audio)) return source.dialogue_audio
  if (Array.isArray(source?.presentation_model)) return source.presentation_model
  return []
}

function normalizeLearningGoals(source) {
  const objectifs = source?.objectifs || {}
  return uniqueStrings([
    objectifs.communicatif ? `Objectif communicatif: ${objectifs.communicatif}` : '',
    objectifs.linguistique ? `Point linguistique: ${objectifs.linguistique}` : '',
    objectifs.culturel ? `Repere culturel: ${objectifs.culturel}` : '',
    objectifs.cognitif ? `Competence cognitive: ${objectifs.cognitif}` : '',
  ]).map((body, index) => ({
    id: `${index + 1}`,
    title: body.split(':')[0],
    body: body.slice(body.indexOf(':') + 1).trim(),
  }))
}

function normalizeCulture(source) {
  if (!source?.culture) return []
  if (typeof source.culture === 'string') {
    return [{ id: '1', title: 'Culture', body: source.culture }]
  }
  return [compactObject({
    id: '1',
    title: pickFirstText(source.culture, ['titre']) || 'Culture',
    body: pickFirstText(source.culture, ['explication']),
  })].filter((item) => item.title || item.body)
}

function normalizeLesson(source, niveau, index) {
  const lessonId = String(source?.id || `${niveau.toLowerCase()}-${String(index + 1).padStart(3, '0')}`).toLowerCase()
  const numero = numericSuffix(source?.id || '', index + 1)
  const phrases = pickDialogueEntries(source).map(normalizePhrase).filter(Boolean)
  const exercices = toArray(source?.exercices).map((exercise, exIndex) => normalizeExercise(exercise, lessonId, exIndex)).filter(Boolean)
  const grammarSections = toArray(source?.grammaire).map(normalizeGrammarSection).filter(Boolean)
  const vocabulary = [
    ...toArray(source?.vocabulaire_complet),
    ...toArray(source?.vocabulaire_cles),
    ...toArray(source?.vocabulaire_professionnel),
  ].map(normalizeVocabularyItem).filter(Boolean)
  const cultureNotes = normalizeCulture(source)
  const comprehensionChecks = toArray(source?.comprehension).map((item, itemIndex) => normalizeInfoCard(item, itemIndex, 'Comprehension')).filter(Boolean)
  const tipCards = toArray(source?.astuces_pedagogiques).map((item, itemIndex) => normalizeInfoCard(item, itemIndex, 'Astuce')).filter(Boolean)
  const learningGoals = normalizeLearningGoals(source)

  const description = pickFirstText(source, ['description'])
    || pickFirstText(source?.objectifs, ['communicatif'])
    || pickFirstText(source?.situation, ['contexte'])
    || 'Contenu pedagogique charge depuis la bibliotheque locale.'

  const explications = [
    ...learningGoals,
    source?.situation ? {
      id: 'situation',
      title: 'Situation',
      body: uniqueStrings([
        pickFirstText(source.situation, ['contexte']),
        pickFirstText(source.situation, ['lieu']),
        pickFirstText(source.situation, ['registre']),
      ]).join(' - '),
    } : null,
    ...grammarSections.slice(0, 2).map((item) => ({
      id: `grammar-${item.id}`,
      title: item.title,
      body: item.body || item.bullets?.[0] || '',
    })),
    ...cultureNotes,
    ...tipCards.slice(0, 1),
  ].filter((item) => item?.body)
    .slice(0, 8)
    .map((item) => ({
      titleDe: item.title,
      titleFr: item.title,
      de: item.body,
      fr: item.body,
    }))

  return compactObject({
    id: lessonId,
    numero,
    niveau,
    module: pickFirstText(source, ['module']),
    titre: pickFirstText(source, ['titre']) || `Lecon ${numero}`,
    description,
    duree: Number(source?.metadonnees?.duree_estimee_minutes) || 0,
    phrasesCount: phrases.length,
    exercicesCount: exercices.length,
    mots: vocabulary,
    phrases,
    exercices,
    explications,
    learningGoals,
    prerequisites: uniqueStrings(toArray(source?.metadonnees?.prerequis)),
    skills: uniqueStrings(toArray(source?.metadonnees?.competences_visees)),
    crossThemes: uniqueStrings(toArray(source?.metadonnees?.themes_croises)),
    grammarSections,
    vocabulary,
    cultureNotes,
    comprehensionChecks,
    tipCards,
    difficultyLabel: pickFirstText(source?.metadonnees, ['difficulte_cognitive']),
    registerLabel: pickFirstText(source?.situation, ['registre']),
    situationLabel: pickFirstText(source?.situation, ['type']),
  })
}

function loadNiveau(niveau) {
  const normalized = normalizeLevel(niveau)
  if (cache.has(normalized)) return cache.get(normalized)

  const lessons = listSourceFiles(normalized)
    .map(readLessonFile)
    .sort((left, right) => {
      const leftOrder = numericSuffix(left.source?.id || left.fileName, 0)
      const rightOrder = numericSuffix(right.source?.id || right.fileName, 0)
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return left.fileName.localeCompare(right.fileName)
    })
    .map((item, index) => normalizeLesson(item.source, normalized, index))

  const payload = {
    niveau: normalized,
    lecons: lessons,
  }
  cache.set(normalized, payload)
  return payload
}

function listLevelLessons(niveau) {
  const data = loadNiveau(niveau)
  return toArray(data?.lecons).map((lesson) => ({
    id: lesson.id,
    numero: lesson.numero,
    niveau: lesson.niveau,
    titre: lesson.titre,
    description: lesson.description,
    duree: lesson.duree,
    phrases: lesson.phrasesCount,
    exercices: lesson.exercicesCount,
    mots: Array.isArray(lesson.mots) ? lesson.mots.length : 0,
    module: lesson.module,
    prerequisites: lesson.prerequisites,
    skills: lesson.skills,
    crossThemes: lesson.crossThemes,
    available: true,
  }))
}

function findLecon(leconId) {
  const id = String(leconId || '').toLowerCase()
  const niveau = id.split('-')[0]?.toUpperCase()
  if (!LEVELS.includes(niveau)) return null
  return toArray(loadNiveau(niveau)?.lecons).find((lesson) => lesson.id === id) || null
}

function getLeconMeta(lecon) {
  const phrases = Number(lecon?.phrasesCount ?? lecon?.phrases ?? 0) || 0
  const exercices = Number(lecon?.exercicesCount ?? lecon?.exercices ?? 0) || 0
  const duree = Number(lecon?.duree) || 0
  const mots = Array.isArray(lecon?.mots) ? lecon.mots.length : Number(lecon?.mots) || 0
  return { phrases, exercices, duree, mots }
}

function getLessonIndex(niveau, leconId) {
  return listLevelLessons(niveau).findIndex((lesson) => lesson.id === String(leconId || '').toLowerCase())
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
