const fs = require('fs')
const path = require('path')

const prisma = require('../prisma/client')
const { pickLessonVisual } = require('../data/cours/lessonVisuals')
const {
  LEVELS,
  findLecon,
  getLessonIds,
} = require('./courseCatalog.service')
const {
  OBJECTIVE_SKILL_WEIGHTS,
  clamp,
  computeAttemptScore,
  computeErrorPressure,
  computeOverallMastery,
  computeGlobalVolatility,
  computeObjectiveMastery,
  computeUserPowerScore,
  computeAdaptiveComplexityIndex200,
} = require('./adaptiveMath.service')
const {
  ensureProgressionRecord,
  getPreviousAttemptForConcept,
  awardAttemptXp,
  syncLessonProgression,
  upsertErrorProfileFromAttempt,
  buildLevelUnlockMap,
  getLessonUnlockStatus,
  getActiveErrorProfiles,
  getDueReviewProfiles,
  formatLessonState,
} = require('./lessonProgress.service')

const OBJECTIVES = ['PARLER', 'ECRIRE', 'LIRE', 'ECOUTER', 'MIXTE']
const DURATIONS = [15, 30, 45, 60, 90]

const OBJECTIVE_EXERCISE_WEIGHTS = {
  PARLER: { sprechen: 40, horen: 25, build: 20, qcm: 15 },
  ECRIRE: { traduction: 35, fill: 25, build: 25, qcm: 15 },
  LIRE: { qcm: 30, match: 30, traduction: 20, fill: 20 },
  ECOUTER: { horen: 45, qcm: 20, sprechen: 20, fill: 15 },
  MIXTE: { qcm: 14, fill: 14, traduction: 14, match: 14, build: 14, horen: 15, sprechen: 15 },
}

const LEVEL_FOUNDATIONS = {
  A1: ['article_usage', 'noun_gender', 'word_order_v2', 'umlaut_pronunciation'],
  A2: ['article_usage', 'noun_gender', 'word_order_v2', 'cases_motion', 'separable_verbs'],
  B1: ['word_order_v2', 'cases_motion', 'separable_verbs', 'relative_clauses', 'konjunktiv_ii'],
  B2: ['cases_motion', 'separable_verbs', 'relative_clauses', 'konjunktiv_ii', 'passive_voice'],
  C1: ['relative_clauses', 'konjunktiv_ii', 'passive_voice', 'nominalization'],
  C2: ['passive_voice', 'nominalization', 'style_register'],
}

const LEVEL_ONBOARDING_GUIDE = {
  A1: [
    {
      titleDe: 'Start A1: Sehr klare Grundlagen',
      titleFr: 'Demarrage A1: bases tres claires',
      de: 'Wir arbeiten mit sehr kurzen Saetzen, langsamem Rhythmus und vielen Wiederholungen.',
      fr: 'On travaille avec des phrases tres courtes, un rythme lent et beaucoup de repetitions.',
    },
    {
      titleDe: 'Artikel und Aussprache zuerst',
      titleFr: 'Articles et prononciation en premier',
      de: 'Jedes Nomen kommt mit Artikel. Umlaute werden mit hoerbaren Beispielen trainiert.',
      fr: 'Chaque nom est vu avec son article. Les umlauts sont pratiques avec des exemples audios.',
    },
    {
      titleDe: 'Fehler sind Teil der Methode',
      titleFr: 'Les erreurs font partie de la methode',
      de: 'Bei zwei gleichen Fehlern folgt sofort eine Mini-Remediation mit Erklaerung.',
      fr: 'Apres deux erreurs identiques, une mini-remediation est declenchee directement.',
    },
  ],
  A2: [
    {
      titleDe: 'Start A2: Konsolidierung',
      titleFr: 'Demarrage A2: consolidation',
      de: 'Wir stabilisieren Artikel, V2 und Bewegung/Position mit Akkusativ-Dativ.',
      fr: 'On consolide articles, V2 et mouvement/position avec accusatif-datif.',
    },
  ],
}

const TYPE_TARGET_MS = {
  qcm: 30000,
  fill: 35000,
  traduction: 45000,
  match: 50000,
  build: 55000,
  horen: 45000,
  sprechen: 50000,
}

const USER_OBJECTIF_TO_MAIN = {
  ausbildung: 'ECRIRE',
  aupair: 'PARLER',
  fsj: 'PARLER',
  bfd: 'MIXTE',
  etudes: 'LIRE',
  autre: 'MIXTE',
}

const BANK_FILE = path.join(__dirname, '..', 'data', 'adaptive', 'bank.v1.json')
let bankCache = null

function readAdaptiveBank() {
  if (bankCache) return bankCache
  const raw = fs.readFileSync(BANK_FILE, 'utf8')
  bankCache = JSON.parse(raw)
  return bankCache
}

function isAdaptiveEnabled() {
  const raw = String(process.env.ADAPTIVE_COURS_ENABLED ?? 'true').toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

function normalizeLevel(niveau) {
  const value = String(niveau || '').toUpperCase()
  return LEVELS.includes(value) ? value : 'A1'
}

function normalizeObjective(objective, fallback = 'MIXTE') {
  const value = String(objective || '').toUpperCase()
  return OBJECTIVES.includes(value) ? value : fallback
}

function normalizeDuration(minutes) {
  const parsed = Number(minutes)
  return DURATIONS.includes(parsed) ? parsed : 45
}

function mapUserObjective(userObjectif) {
  return USER_OBJECTIF_TO_MAIN[String(userObjectif || '').toLowerCase()] || 'MIXTE'
}

function hashString(value) {
  let h = 2166136261
  const str = String(value || '')
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
  }
  return h >>> 0
}

function createRng(seed) {
  let state = hashString(seed) || 123456789
  return () => {
    state = (1664525 * state + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function pickOne(list, rng) {
  if (!Array.isArray(list) || list.length === 0) return null
  const index = Math.floor(rng() * list.length)
  return list[index]
}

function shuffle(list, rng) {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function uniqueBy(items, key) {
  const seen = new Set()
  const output = []
  for (const item of items) {
    const value = item?.[key]
    if (!value || seen.has(value)) continue
    seen.add(value)
    output.push(item)
  }
  return output
}

function typeToSkill(type) {
  switch (type) {
    case 'sprechen':
      return 'PARLER'
    case 'horen':
      return 'ECOUTER'
    case 'match':
    case 'qcm':
      return 'LIRE'
    case 'fill':
    case 'build':
    case 'traduction':
    default:
      return 'ECRIRE'
  }
}

function computeTargetDistribution(totalCount) {
  const safeTotal = Math.max(1, totalCount)
  const weakCount = Math.max(1, Math.round(safeTotal * 0.6))
  const objectiveCount = Math.max(1, Math.round(safeTotal * 0.25))
  let reviewCount = safeTotal - weakCount - objectiveCount
  if (reviewCount < 0) reviewCount = 0

  const adjustedObjective = safeTotal - weakCount - reviewCount
  return {
    weakCount,
    objectiveCount: Math.max(0, adjustedObjective),
    reviewCount,
  }
}

function exerciseCountByDuration(durationMinutes) {
  return clamp(Math.round((durationMinutes || 45) / 3), 8, 24)
}

function selectConceptPools({
  level,
  levelConcepts,
  conceptStates,
  recentAttempts,
  activeErrorProfiles = [],
  dueReviewProfiles = [],
  objective,
  userPowerScore,
  isFirstSessionForLevel,
}) {
  const byTag = new Map(levelConcepts.map((concept) => [concept.conceptTag, concept]))
  const levelFoundations = (LEVEL_FOUNDATIONS[level] || [])
    .map((tag) => byTag.get(tag))
    .filter(Boolean)

  if (isFirstSessionForLevel) {
    const onboardingFoundations = levelFoundations.length > 0
      ? levelFoundations
      : levelConcepts
        .slice()
        .sort((a, b) => (Number(a.difficultyBase) || 50) - (Number(b.difficultyBase) || 50))
        .slice(0, 4)
    return {
      weakConcepts: uniqueBy(onboardingFoundations, 'conceptTag'),
      objectiveConcepts: uniqueBy(onboardingFoundations, 'conceptTag'),
      reviewConcepts: uniqueBy(onboardingFoundations, 'conceptTag'),
    }
  }

  const activeErrorConcepts = activeErrorProfiles
    .map((profile) => byTag.get(profile.conceptTag))
    .filter(Boolean)

  const weakStateTags = conceptStates
    .filter((state) => (state.masteryScore ?? 50) < 60 || (state.wrongStreak ?? 0) >= 2)
    .map((state) => state.conceptTag)
  let weakConcepts = weakStateTags.map((tag) => byTag.get(tag)).filter(Boolean)

  // Tant que les bases du niveau ne sont pas maitrisees, on les garde prioritaires.
  const weakFoundation = levelFoundations.filter((concept) => {
    const states = conceptStates.filter((state) => state.conceptTag === concept.conceptTag)
    if (states.length === 0) return true
    const bestMastery = Math.max(...states.map((state) => Number(state.masteryScore) || 0))
    return bestMastery < 70
  })
  weakConcepts = [...activeErrorConcepts, ...weakFoundation, ...weakConcepts]

  if (weakConcepts.length === 0) {
    const errorCounts = new Map()
    for (const attempt of recentAttempts) {
      if (!attempt.errorTag) continue
      const current = errorCounts.get(attempt.errorTag) || 0
      errorCounts.set(attempt.errorTag, current + 1)
    }
    const sortedErrorTags = [...errorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag)
    weakConcepts = sortedErrorTags
      .map((errorTag) => levelConcepts.find((concept) => concept.errorTag === errorTag))
      .filter(Boolean)
  }
  if (weakConcepts.length === 0) weakConcepts = (levelFoundations.length > 0 ? levelFoundations : levelConcepts).slice(0, 4)
  weakConcepts = uniqueBy(weakConcepts, 'conceptTag')

  const objectiveWeights = OBJECTIVE_SKILL_WEIGHTS[objective] || OBJECTIVE_SKILL_WEIGHTS.MIXTE
  const targetSkills = Object.entries(objectiveWeights)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([skill]) => skill)

  let objectiveConcepts = levelConcepts.filter((concept) => {
    const conceptSkills = Array.isArray(concept.skills) ? concept.skills : []
    return conceptSkills.some((skill) => targetSkills.includes(skill))
  })
  if (objectiveConcepts.length === 0) objectiveConcepts = levelConcepts

  // Progression: on deverrouille progressivement les concepts plus difficiles.
  const upperDifficulty = clamp((Number(userPowerScore) || 50) + 8, 1, 100)
  objectiveConcepts = objectiveConcepts.filter((concept) => (Number(concept.difficultyBase) || 50) <= upperDifficulty)
  if (objectiveConcepts.length === 0) {
    objectiveConcepts = levelConcepts
      .slice()
      .sort((a, b) => (Number(a.difficultyBase) || 50) - (Number(b.difficultyBase) || 50))
      .slice(0, 4)
  }
  objectiveConcepts = uniqueBy(objectiveConcepts, 'conceptTag')

  const dueReviewConcepts = dueReviewProfiles
    .map((profile) => byTag.get(profile.conceptTag))
    .filter(Boolean)

  const reviewCandidates = conceptStates
    .filter((state) => (state.masteryScore ?? 0) >= 60 && (state.masteryScore ?? 0) <= 85)
    .sort((a, b) => {
      const da = new Date(a.lastSeenAt || 0).getTime()
      const db = new Date(b.lastSeenAt || 0).getTime()
      return da - db
    })
    .map((state) => byTag.get(state.conceptTag))
    .filter(Boolean)

  let reviewConcepts = uniqueBy([...dueReviewConcepts, ...reviewCandidates], 'conceptTag')
  if (reviewConcepts.length === 0) {
    reviewConcepts = levelConcepts.filter((concept) => !weakConcepts.some((weak) => weak.conceptTag === concept.conceptTag))
  }
  if (reviewConcepts.length === 0) reviewConcepts = levelConcepts

  return {
    weakConcepts,
    objectiveConcepts,
    reviewConcepts: uniqueBy(reviewConcepts, 'conceptTag'),
  }
}

function pickExerciseTypeForConcept({ objective, concept, rng }) {
  const weights = OBJECTIVE_EXERCISE_WEIGHTS[objective] || OBJECTIVE_EXERCISE_WEIGHTS.MIXTE
  const conceptSkills = new Set(Array.isArray(concept.skills) ? concept.skills : [])

  const weighted = Object.entries(weights)
    .filter(([type, weight]) => {
      if (weight <= 0) return false
      const skill = typeToSkill(type)
      return conceptSkills.size === 0 || conceptSkills.has(skill)
    })
    .map(([type, weight]) => ({ type, weight }))

  const source = weighted.length > 0
    ? weighted
    : Object.entries(weights).filter(([, weight]) => weight > 0).map(([type, weight]) => ({ type, weight }))

  const totalWeight = source.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 0) return 'qcm'
  const pivot = rng() * totalWeight
  let acc = 0
  for (const item of source) {
    acc += item.weight
    if (pivot <= acc) return item.type
  }
  return source[source.length - 1]?.type || 'qcm'
}

function sentenceTokens(sentence) {
  return String(sentence || '')
    .replace(/[.,!?;:]/g, '')
    .split(/\s+/)
    .filter(Boolean)
}

function sentenceForConcept(concept, rng) {
  return pickOne(concept.sentences || [], rng) || { de: 'Ich lerne Deutsch.', fr: "J'apprends l allemand." }
}

function keywordForConcept(concept, rng) {
  return pickOne(concept.keywords || [], rng) || { de: 'Deutsch', fr: 'allemand' }
}

function splitArticleAndNoun(keywordDe) {
  const parts = String(keywordDe || '').trim().split(/\s+/)
  if (parts.length < 2) return { article: null, noun: String(keywordDe || '').trim() }
  const [article, ...rest] = parts
  const normalized = article.toLowerCase()
  if (!['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem'].includes(normalized)) {
    return { article: null, noun: String(keywordDe || '').trim() }
  }
  return { article: normalized, noun: rest.join(' ') }
}

function fallbackMeaning(keyword, fallbackSentence) {
  if (keyword?.fr) return keyword.fr
  if (fallbackSentence?.fr) return fallbackSentence.fr
  return '...'
}

function makeQcmExercise({ exerciseId, concept, rng, targetDifficulty }) {
  const correctKeyword = keywordForConcept(concept, rng)
  const sampleSentence = sentenceForConcept(concept, rng)

  let questionDe = `Welche Uebersetzung passt zu "${correctKeyword.de}"?`
  let questionFr = `Quelle traduction correspond a "${correctKeyword.de}" ?`
  let options = []
  let answerIndex = 0
  let deLabel = correctKeyword.de
  let meaning = { de: correctKeyword.de, fr: fallbackMeaning(correctKeyword, sampleSentence) }

  if (concept.errorTag === 'article_omission' || concept.errorTag === 'gender_mismatch') {
    const { article, noun } = splitArticleAndNoun(correctKeyword.de)
    const answerArticle = article || 'der'
    const articleOptions = shuffle(['der', 'die', 'das', 'ein'], rng).slice(0, 4)
    if (!articleOptions.includes(answerArticle)) articleOptions[0] = answerArticle
    options = shuffle(articleOptions, rng).map((value) => ({ de: value, fr: value }))
    answerIndex = options.findIndex((item) => item.de === answerArticle)
    questionDe = `Ergaenze den Artikel: ___ ${noun || 'Markt'}`
    questionFr = `Complete avec le bon article : ___ ${noun || 'Markt'}`
    deLabel = noun || correctKeyword.de
    meaning = { de: `${answerArticle} ${noun || ''}`.trim(), fr: fallbackMeaning(correctKeyword, sampleSentence) }
  } else if (concept.errorTag === 'case_akk_dativ') {
    const correctCase = 'den'
    options = shuffle(['den', 'dem', 'der', 'das'], rng).map((value) => ({ de: value, fr: value }))
    answerIndex = options.findIndex((item) => item.de === correctCase)
    questionDe = 'Ich gehe in ___ Park.'
    questionFr = 'Ich gehe in ___ Park. (mouvement vers le parc)'
    deLabel = 'in ___ Park'
    meaning = { de: 'Mouvement -> Akkusativ', fr: 'Mouvement -> accusatif' }
  } else if (concept.errorTag === 'word_order_v2') {
    const variants = shuffle([
      sampleSentence.de,
      sampleSentence.de.replace(/^(\S+)\s+(\S+)/, '$2 $1'),
      sampleSentence.de.replace(/^(\S+)\s+(\S+)\s+(\S+)/, '$1 $3 $2'),
      `Heute ${sampleSentence.de}`,
    ], rng).slice(0, 4)
    const normalizedCorrect = sampleSentence.de
    options = variants.map((value) => ({ de: value, fr: value }))
    if (!options.some((item) => item.de === normalizedCorrect)) options[0] = { de: normalizedCorrect, fr: normalizedCorrect }
    answerIndex = options.findIndex((item) => item.de === normalizedCorrect)
    questionDe = 'Welche Satzstellung ist korrekt (Verb auf Position 2)?'
    questionFr = 'Quel ordre des mots est correct (verbe en 2e position) ?'
    deLabel = 'V2'
    meaning = { de: normalizedCorrect, fr: sampleSentence.fr }
  } else {
    const pool = shuffle(concept.keywords || [], rng).filter((item) => item.de !== correctKeyword.de).slice(0, 3)
    options = shuffle([correctKeyword, ...pool], rng).map((item) => ({ de: item.fr, fr: item.fr }))
    answerIndex = options.findIndex((option) => option.fr === correctKeyword.fr)
  }

  return {
    id: exerciseId,
    type: 'qcm',
    questionDe,
    questionFr,
    options,
    reponse: Math.max(0, answerIndex),
    de: deLabel,
    meaning,
    conceptTag: concept.conceptTag,
    errorTag: concept.errorTag,
    skill: 'LIRE',
    targetMs: TYPE_TARGET_MS.qcm,
    difficulty: targetDifficulty,
  }
}

function makeFillExercise({ exerciseId, concept, rng, targetDifficulty }) {
  const sentence = sentenceForConcept(concept, rng)
  const keyword = keywordForConcept(concept, rng)
  let answer = ''
  let before = ''
  let after = ''

  if (concept.errorTag === 'article_omission' || concept.errorTag === 'gender_mismatch') {
    const { article, noun } = splitArticleAndNoun(keyword.de)
    answer = article || 'der'
    before = 'Ich sehe'
    after = noun || 'Markt'
  } else if (concept.errorTag === 'case_akk_dativ') {
    answer = 'den'
    before = 'Ich gehe in'
    after = 'Park.'
  } else if (concept.errorTag === 'umlaut_omission') {
    answer = 'schoen'
    before = 'Das Wetter ist'
    after = 'heute.'
  } else {
    const tokens = sentenceTokens(sentence.de)
    answer = tokens.find((token) => token.length > 3) || tokens[0] || 'ich'
    const answerIndex = tokens.findIndex((token) => token === answer)
    before = tokens.slice(0, Math.max(0, answerIndex)).join(' ')
    after = tokens.slice(answerIndex + 1).join(' ')
  }

  return {
    id: exerciseId,
    type: 'fill',
    avant: before || '...',
    apres: after || '...',
    reponse: answer,
    indice: answer.slice(0, 2) + '...',
    phraseDe: sentence.de,
    meaning: { de: sentence.de, fr: sentence.fr },
    conceptTag: concept.conceptTag,
    errorTag: concept.errorTag,
    skill: 'ECRIRE',
    targetMs: TYPE_TARGET_MS.fill,
    difficulty: targetDifficulty,
  }
}

function makeTraductionExercise({ exerciseId, concept, rng, targetDifficulty }) {
  const sentence = sentenceForConcept(concept, rng)
  return {
    id: exerciseId,
    type: 'traduction',
    sourceDe: sentence.de,
    sourceFr: sentence.fr,
    reponse: sentence.de,
    accepte: [sentence.de, sentence.de.toLowerCase()],
    meaning: { de: sentence.de, fr: sentence.fr },
    conceptTag: concept.conceptTag,
    errorTag: concept.errorTag,
    skill: 'ECRIRE',
    targetMs: TYPE_TARGET_MS.traduction,
    difficulty: targetDifficulty,
  }
}

function makeMatchExercise({ exerciseId, concept, rng, targetDifficulty }) {
  const pairs = shuffle(concept.keywords || [], rng).slice(0, 4).map((item) => ({
    de: item.de,
    fr: item.fr,
  }))
  return {
    id: exerciseId,
    type: 'match',
    promptDe: 'Verbinde Wort und Uebersetzung.',
    promptFr: 'Relie le mot et sa traduction.',
    pairs,
    conceptTag: concept.conceptTag,
    errorTag: concept.errorTag,
    skill: 'LIRE',
    targetMs: TYPE_TARGET_MS.match,
    difficulty: targetDifficulty,
  }
}

function makeBuildExercise({ exerciseId, concept, rng, targetDifficulty }) {
  const sentence = sentenceForConcept(concept, rng)
  const words = shuffle(sentenceTokens(sentence.de), rng)
  return {
    id: exerciseId,
    type: 'build',
    promptDe: 'Bilde den korrekten Satz.',
    promptFr: 'Construis la phrase correcte.',
    words,
    answer: sentence.de,
    meaning: { de: sentence.de, fr: sentence.fr },
    conceptTag: concept.conceptTag,
    errorTag: concept.errorTag,
    skill: 'ECRIRE',
    targetMs: TYPE_TARGET_MS.build,
    difficulty: targetDifficulty,
  }
}

function makeHorenExercise({ exerciseId, concept, rng, targetDifficulty }) {
  const sentence = sentenceForConcept(concept, rng)
  const distractors = shuffle(concept.sentences || [], rng)
    .filter((item) => item.de !== sentence.de)
    .slice(0, 3)
    .map((item) => ({ de: item.de, fr: item.fr }))
  const options = shuffle([{ de: sentence.de, fr: sentence.fr }, ...distractors], rng)
  const correctIndex = options.findIndex((item) => item.de === sentence.de)
  return {
    id: exerciseId,
    type: 'horen',
    promptDe: 'Hoere zu und waehle die passende Antwort.',
    promptFr: 'Ecoute puis choisis la bonne reponse.',
    audioText: sentence.de,
    options,
    correct: Math.max(0, correctIndex),
    meaning: { de: sentence.de, fr: sentence.fr },
    conceptTag: concept.conceptTag,
    errorTag: concept.errorTag,
    skill: 'ECOUTER',
    targetMs: TYPE_TARGET_MS.horen,
    difficulty: targetDifficulty,
  }
}

function makeSprechenExercise({ exerciseId, concept, rng, targetDifficulty }) {
  const sentence = sentenceForConcept(concept, rng)
  return {
    id: exerciseId,
    type: 'sprechen',
    promptDe: 'Sprich den Satz laut aus.',
    promptFr: 'Dis la phrase a voix haute.',
    texteAttendu: sentence.de,
    meaning: { de: sentence.de, fr: sentence.fr },
    conceptTag: concept.conceptTag,
    errorTag: concept.errorTag,
    skill: 'PARLER',
    targetMs: TYPE_TARGET_MS.sprechen,
    difficulty: targetDifficulty,
  }
}

function buildExercise({ type, exerciseId, concept, rng, userPowerScore }) {
  const difficulty = clamp(
    Math.round((Number(userPowerScore) || 50) + (rng() * 18 - 10)),
    1,
    100
  )
  switch (type) {
    case 'fill':
      return makeFillExercise({ exerciseId, concept, rng, targetDifficulty: difficulty })
    case 'traduction':
      return makeTraductionExercise({ exerciseId, concept, rng, targetDifficulty: difficulty })
    case 'match':
      return makeMatchExercise({ exerciseId, concept, rng, targetDifficulty: difficulty })
    case 'build':
      return makeBuildExercise({ exerciseId, concept, rng, targetDifficulty: difficulty })
    case 'horen':
      return makeHorenExercise({ exerciseId, concept, rng, targetDifficulty: difficulty })
    case 'sprechen':
      return makeSprechenExercise({ exerciseId, concept, rng, targetDifficulty: difficulty })
    case 'qcm':
    default:
      return makeQcmExercise({ exerciseId, concept, rng, targetDifficulty: difficulty })
  }
}

function makeLessonPhrases(levelProfile, concepts, rng, maxCount = 10) {
  const phrasePool = [
    ...(Array.isArray(levelProfile.phraseBank) ? levelProfile.phraseBank : []),
    ...concepts.flatMap((concept) => concept.sentences || []),
  ]
  const selected = shuffle(uniqueBy(phrasePool, 'de'), rng).slice(0, Math.max(3, maxCount))
  return selected.map((phrase, index) => ({
    id: index + 1,
    alemana: phrase.de,
    traductionDe: phrase.de,
    frantsay: phrase.fr,
    audio: phrase.de,
  }))
}

function extractExpectedAnswer(exercise) {
  if (!exercise) return null
  switch (exercise.type) {
    case 'qcm':
      return String(exercise.reponse)
    case 'horen':
      return String(exercise.correct)
    case 'fill':
      return exercise.reponse || null
    case 'traduction':
      return exercise.reponse || null
    case 'build':
      return exercise.answer || null
    case 'sprechen':
      return exercise.texteAttendu || null
    case 'match':
      return JSON.stringify(exercise.pairs || [])
    default:
      return null
  }
}

function normalizeTemplateExercise({
  exercise,
  lessonId,
  imageUrl,
  imageTheme,
  bucket = 'objective',
  index = 0,
}) {
  const id = String(exercise?.id || `${lessonId}-tmpl-${index + 1}`)
  return {
    ...exercise,
    id,
    type: exercise?.type || 'qcm',
    conceptTag: exercise?.conceptTag || `lesson_core_${lessonId}`,
    errorTag: exercise?.errorTag || null,
    skill: exercise?.skill || typeToSkill(exercise?.type),
    targetMs: Number(exercise?.targetMs || TYPE_TARGET_MS[exercise?.type] || 30000),
    difficulty: Number(exercise?.difficulty || 50),
    bucket,
    imageUrl: exercise?.imageUrl || imageUrl,
    imageTheme: exercise?.imageTheme || imageTheme,
  }
}

function pickTemplateExercises({
  lessonId,
  baseExercises,
  count,
  rng,
  imageUrl,
  imageTheme,
}) {
  const normalizedBase = (Array.isArray(baseExercises) ? baseExercises : []).map((exercise, index) =>
    normalizeTemplateExercise({
      exercise,
      lessonId,
      imageUrl,
      imageTheme,
      index,
    })
  )
  if (normalizedBase.length === 0 || count <= 0) return []

  const output = []
  for (let i = 0; i < count; i += 1) {
    const source = normalizedBase[i % normalizedBase.length]
    output.push({
      ...source,
      id: `${source.id}-seq-${i + 1}`,
      bucket: 'objective',
    })
  }
  return shuffle(output, rng)
}

async function buildUnlockStatusPayload({ userId, niveau, lessonId }) {
  const lessonIds = getLessonIds(niveau)
  const unlockMap = await buildLevelUnlockMap({ userId, niveau })
  const current = unlockMap.get(lessonId) || null
  const currentIndex = lessonIds.findIndex((id) => id === lessonId)
  const nextLessonId = currentIndex >= 0 ? lessonIds[currentIndex + 1] || null : null
  const next = nextLessonId ? unlockMap.get(nextLessonId) || null : null

  return {
    unlocked: Boolean(current?.unlocked),
    lockedReason: current?.lockedReason || null,
    eligibleToUnlockNext: Boolean(current?.gate?.eligible),
    currentLessonId: lessonId,
    nextLessonId,
    nextLessonUnlocked: Boolean(next?.unlocked),
    nextLockedReason: next?.lockedReason || null,
    gate: current?.gate || null,
  }
}

async function getUserMetrics({ userId, objective }) {
  const [states, attempts] = await Promise.all([
    prisma.userConceptState.findMany({ where: { userId } }),
    prisma.exerciseAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  const overallMastery = computeOverallMastery(states)
  const objectiveMastery = computeObjectiveMastery(states, objective)
  const errorPressure = computeErrorPressure(attempts)
  const volatility = computeGlobalVolatility(states)
  const userPowerScore = computeUserPowerScore({ objectiveMastery, overallMastery, errorPressure })
  const complexityIndex200 = computeAdaptiveComplexityIndex200({ userPowerScore, volatility, errorPressure })

  return {
    states,
    attempts,
    overallMastery,
    objectiveMastery,
    errorPressure,
    volatility,
    userPowerScore,
    complexityIndex200,
  }
}

async function getPriorLevelSessionsCount({ userId, niveau }) {
  return prisma.adaptiveSession.count({
    where: {
      userId,
      niveau,
    },
  })
}

function createSessionLesson({
  niveau,
  objectif,
  dureeMinutes,
  theme,
  levelProfile,
  levelConcepts,
  conceptPools,
  userPowerScore,
  complexityIndex200,
  isFirstSessionForLevel,
  priorLevelSessionsCount,
  seed,
  mode = 'free',
  baseLesson = null,
  hasAdaptivePressure = false,
  activeErrorProfiles = [],
  dueReviewProfiles = [],
}) {
  const rng = createRng(seed)
  const lessonVisualNumber = Number(baseLesson?.numero) || (Number(priorLevelSessionsCount) || 0) + 1
  const visual = pickLessonVisual(niveau, lessonVisualNumber)
  const imageUrl = baseLesson?.imageUrl || visual?.url || null
  const imageTheme = baseLesson?.imageTheme || visual?.themeFr || null
  const totalExercises = mode === 'lesson'
    ? Math.max(3, Array.isArray(baseLesson?.exercices) ? baseLesson.exercices.length : 0)
    : exerciseCountByDuration(dureeMinutes)
  const distribution = computeTargetDistribution(totalExercises)

  let exerciseCursor = 0
  const buildGeneratedExercises = (bucketName, concepts, count) => {
    const output = []
    if (!Array.isArray(concepts) || concepts.length === 0 || count <= 0) return output

    for (let i = 0; i < count; i += 1) {
      const concept = concepts[i % concepts.length]
      const exerciseType = pickExerciseTypeForConcept({ objective: objectif, concept, rng })
      const exerciseId = `adp-ex-${String(exerciseCursor + 1).padStart(3, '0')}`
      const powerForExercise = isFirstSessionForLevel && mode === 'free'
        ? Math.min(Number(userPowerScore) || 50, 40)
        : userPowerScore
      const built = buildExercise({
        type: exerciseType,
        exerciseId,
        concept,
        rng,
        userPowerScore: powerForExercise,
      })
      output.push({
        ...built,
        bucket: bucketName,
        conceptLabelFr: concept.conceptTag,
        imageUrl: built.imageUrl || imageUrl,
        imageTheme: built.imageTheme || imageTheme,
      })
      exerciseCursor += 1
    }
    return output
  }

  const baseExercises = Array.isArray(baseLesson?.exercices) ? baseLesson.exercices : []
  let exercises = []

  if (mode === 'lesson') {
    if (!hasAdaptivePressure && baseExercises.length > 0) {
      exercises = baseExercises.map((exercise, index) =>
        normalizeTemplateExercise({
          exercise,
          lessonId: baseLesson.id,
          imageUrl,
          imageTheme,
          bucket: 'objective',
          index,
        })
      )
    } else {
      const weakExercises = buildGeneratedExercises('weak', conceptPools.weakConcepts, distribution.weakCount)
      const reviewExercises = buildGeneratedExercises('review', conceptPools.reviewConcepts, distribution.reviewCount)
      const objectiveExercises = baseExercises.length > 0
        ? pickTemplateExercises({
            lessonId: baseLesson.id,
            baseExercises,
            count: distribution.objectiveCount,
            rng,
            imageUrl,
            imageTheme,
          })
        : buildGeneratedExercises('objective', conceptPools.objectiveConcepts, distribution.objectiveCount)

      exercises = shuffle([...weakExercises, ...objectiveExercises, ...reviewExercises], rng)
      if (exercises.length === 0 && baseExercises.length > 0) {
        exercises = baseExercises.map((exercise, index) =>
          normalizeTemplateExercise({
            exercise,
            lessonId: baseLesson.id,
            imageUrl,
            imageTheme,
            bucket: 'objective',
            index,
          })
        )
      }
    }
  } else {
    const sequence = []
    const pushBucket = (bucketName, concepts, count) => {
      if (!Array.isArray(concepts) || concepts.length === 0) return
      for (let i = 0; i < count; i += 1) {
        sequence.push({
          bucket: bucketName,
          concept: concepts[i % concepts.length],
        })
      }
    }

    pushBucket('weak', conceptPools.weakConcepts, distribution.weakCount)
    pushBucket('objective', conceptPools.objectiveConcepts, distribution.objectiveCount)
    pushBucket('review', conceptPools.reviewConcepts, distribution.reviewCount)
    if (sequence.length < totalExercises) {
      pushBucket('weak', conceptPools.weakConcepts, totalExercises - sequence.length)
    }

    const mixedSequence = shuffle(sequence, rng)
    exercises = mixedSequence.map((item) => {
      const generated = buildGeneratedExercises(item.bucket, [item.concept], 1)
      return generated[0]
    }).filter(Boolean)
  }

  const phraseCount = isFirstSessionForLevel && mode === 'free' ? 12 : 10
  const phrasesSource = Array.isArray(baseLesson?.phrases) && baseLesson.phrases.length > 0
    ? baseLesson.phrases
    : makeLessonPhrases(levelProfile, levelConcepts, rng, phraseCount)
  const phrases = phrasesSource.map((phrase, index) => ({
    id: phrase?.id || index + 1,
    ...phrase,
    imageUrl: phrase?.imageUrl || imageUrl,
    imageTheme: phrase?.imageTheme || imageTheme,
  }))

  const levelCode = String(niveau || 'A1').toLowerCase()
  const randomSuffix = Math.floor(rng() * 1e6).toString().padStart(6, '0')
  const leconId = baseLesson?.id || `${levelCode}-adaptive-${Date.now().toString(36)}-${randomSuffix}`
  const onboardingGuide = isFirstSessionForLevel ? (LEVEL_ONBOARDING_GUIDE[niveau] || []) : []
  const progressionStage = isFirstSessionForLevel
    ? 'onboarding'
    : (Number(userPowerScore) >= 75 ? 'advanced' : Number(userPowerScore) >= 55 ? 'intermediate' : 'reinforcement')

  return {
    id: leconId,
    numero: baseLesson?.numero || 1,
    niveau,
    titre: baseLesson?.titre || {
      de: isFirstSessionForLevel ? `Basisstart ${niveau}` : `Adaptive Lektion ${niveau}`,
      fr: isFirstSessionForLevel ? `Demarrage bases ${niveau}` : `Lecon adaptative ${niveau}`,
    },
    description: baseLesson?.description || {
      de: isFirstSessionForLevel
        ? `Erste Sitzung auf ${niveau}: stark gefuehrte Grundlagen mit klaren Erklaerungen.`
        : `Personalisierte Sitzung mit Fokus auf ${objectif}.`,
      fr: isFirstSessionForLevel
        ? `Premiere session en ${niveau}: bases guidees avec explications claires.`
        : `Session personnalisee avec focus ${objectif}.`,
    },
    duree: dureeMinutes,
    theme: theme || baseLesson?.theme || levelProfile.defaultTheme || 'vie quotidienne',
    phrasesCount: phrases.length,
    exercicesCount: exercises.length,
    imageUrl,
    imageTheme,
    illustration: visual,
    phrases,
    exercices: exercises,
    explications: Array.isArray(baseLesson?.explications) && baseLesson.explications.length > 0
      ? baseLesson.explications
      : onboardingGuide,
    adaptiveMeta: {
      mode,
      baseLessonId: baseLesson?.id || null,
      objective: objectif,
      userPowerScore,
      complexityIndex200,
      distribution,
      firstSessionForLevel: isFirstSessionForLevel,
      priorLevelSessionsCount,
      progressionStage,
      hasAdaptivePressure,
      weakConceptTags: conceptPools.weakConcepts.map((item) => item.conceptTag),
      activeErrorTags: activeErrorProfiles.map((profile) => profile.errorTag),
      dueReviewTags: dueReviewProfiles.map((profile) => profile.errorTag),
      templateFallback: mode === 'lesson' && !hasAdaptivePressure,
      generatedAt: new Date().toISOString(),
    },
  }
}

function getLevelConcepts(level, bank) {
  const profile = bank.levelProfiles?.[level] || bank.levelProfiles?.A1 || {}
  const shift = Number(profile.difficultyShift) || 0
  const concepts = (bank.concepts || [])
    .filter((concept) => (concept.supportedLevels || []).includes(level))
    .map((concept) => ({
      ...concept,
      difficultyBase: clamp((Number(concept.difficultyBase) || 50) + shift, 1, 100),
    }))
  return { profile, concepts }
}

function chooseRemediationTypes(errorTag) {
  if (errorTag === 'umlaut_omission') return ['horen', 'sprechen']
  if (errorTag === 'separable_verb') return ['build', 'fill']
  return ['qcm', 'fill']
}

function buildRemediationBlock({ concept, seed, userPowerScore, index }) {
  const rng = createRng(`${seed}-remed-${concept.errorTag}-${index}`)
  const types = chooseRemediationTypes(concept.errorTag)
  const exercises = types.map((type, localIndex) =>
    buildExercise({
      type,
      exerciseId: `adp-rem-${index}-${localIndex + 1}`,
      concept,
      rng,
      userPowerScore: clamp((userPowerScore || 50) - 15, 1, 100),
    })
  )

  return {
    id: `remediation-${index}-${concept.errorTag}`,
    conceptTag: concept.conceptTag,
    errorTag: concept.errorTag,
    explanation: {
      fr: concept.remediationTipFr || 'Revois cette regle puis applique-la avec deux exercices guides.',
      de: concept.remediationTipDe || 'Wiederhole die Regel und uebe sie mit zwei gefuehrten Aufgaben.',
    },
    exercises,
  }
}

async function startAdaptiveSession({ userId, payload = {} }) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('Utilisateur introuvable')

  const mode = String(payload.mode || (payload.lessonId ? 'lesson' : 'free')).toLowerCase() === 'lesson'
    ? 'lesson'
    : 'free'
  const baseLesson = mode === 'lesson'
    ? findLecon(String(payload.lessonId || ''))
    : null
  if (mode === 'lesson' && !baseLesson) throw new Error('Lecon introuvable')

  const niveau = normalizeLevel(baseLesson?.niveau || payload.niveau || user.niveau)
  const objectiveFallback = mapUserObjective(user.objectif)
  const objectif = normalizeObjective(payload.objectif || payload.objective || objectiveFallback)
  const dureeMinutes = normalizeDuration(payload.dureeMinutes || payload.duree_estimee_minutes)
  const theme = String(payload.theme || baseLesson?.theme || '').trim() || null

  if (mode === 'lesson') {
    const canOpen = await getLessonUnlockStatus({
      userId,
      niveau,
      lessonId: baseLesson.id,
    })
    if (!canOpen.unlocked) {
      throw new Error(canOpen.lockedReason || 'Lecon verrouillee')
    }
    await ensureProgressionRecord({
      userId,
      lessonId: baseLesson.id,
      unlockedAt: new Date(),
    })
  }

  const [metrics, priorLevelSessionsCount, activeErrorProfiles, dueReviewProfiles] = await Promise.all([
    getUserMetrics({ userId, objective: objectif }),
    getPriorLevelSessionsCount({ userId, niveau }),
    getActiveErrorProfiles({ userId }),
    getDueReviewProfiles({ userId }),
  ])
  const isFirstSessionForLevel = priorLevelSessionsCount === 0
  const bank = readAdaptiveBank()
  const { profile, concepts: levelConcepts } = getLevelConcepts(niveau, bank)

  if (levelConcepts.length === 0) throw new Error('Aucune banque de concepts disponible pour ce niveau')

  const conceptPools = selectConceptPools({
    level: niveau,
    levelConcepts,
    conceptStates: metrics.states,
    recentAttempts: metrics.attempts,
    activeErrorProfiles,
    dueReviewProfiles,
    objective: objectif,
    userPowerScore: metrics.userPowerScore,
    isFirstSessionForLevel,
  })

  const seed = `${userId}:${niveau}:${objectif}:${Date.now()}`
  const lesson = createSessionLesson({
    niveau,
    objectif,
    dureeMinutes,
    theme,
    levelProfile: profile,
    levelConcepts,
    conceptPools,
    userPowerScore: metrics.userPowerScore,
    complexityIndex200: metrics.complexityIndex200,
    isFirstSessionForLevel,
    priorLevelSessionsCount,
    seed,
    mode,
    baseLesson,
    hasAdaptivePressure: activeErrorProfiles.length > 0 || dueReviewProfiles.length > 0,
    activeErrorProfiles,
    dueReviewProfiles,
  })

  const progression = await ensureProgressionRecord({
    userId,
    lessonId: lesson.id,
    unlockedAt: new Date(),
  })

  const session = await prisma.adaptiveSession.create({
    data: {
      userId,
      niveau,
      objectif,
      mode,
      baseLessonId: baseLesson?.id || null,
      status: 'ACTIVE',
      lessonPayload: lesson,
      nextIndex: 0,
      startedAt: new Date(),
    },
  })

  const unlockStatus = mode === 'lesson'
    ? await buildUnlockStatusPayload({ userId, niveau, lessonId: lesson.id })
    : null

  return {
    sessionId: session.id,
    lesson,
    lessonState: formatLessonState(progression, unlockStatus),
    activeErrors: activeErrorProfiles.map((profile) => ({
      lessonId: profile.leconId,
      conceptTag: profile.conceptTag,
      errorTag: profile.errorTag,
      count: profile.count,
      successStreak: profile.successStreak,
      isFrequent: profile.isFrequent,
      nextReviewAt: profile.nextReviewAt,
    })),
    unlockStatus,
    userPowerScore: metrics.userPowerScore,
    complexityIndex200: metrics.complexityIndex200,
  }
}

async function upsertConceptState({
  userId,
  conceptTag,
  skill,
  attemptScore,
  correct,
}) {
  if (!conceptTag || !skill) return null
  const now = new Date()

  const existing = await prisma.userConceptState.findUnique({
    where: {
      userId_conceptTag_skill: {
        userId,
        conceptTag,
        skill,
      },
    },
  })

  const oldMastery = Number(existing?.masteryScore ?? 50)
  const oldVolatility = Number(existing?.volatility ?? 0)
  const delta = Math.abs((Number(attemptScore) || 0) - oldMastery)
  const masteryNew = clamp(Math.round((0.75 * oldMastery) + (0.25 * (Number(attemptScore) || 0))), 0, 100)
  const volatilityNew = clamp(Math.round((0.85 * oldVolatility) + (0.15 * delta)), 0, 100)

  const rightStreak = correct ? (Number(existing?.rightStreak || 0) + 1) : 0
  const wrongStreak = correct ? 0 : (Number(existing?.wrongStreak || 0) + 1)

  return prisma.userConceptState.upsert({
    where: {
      userId_conceptTag_skill: {
        userId,
        conceptTag,
        skill,
      },
    },
    update: {
      masteryScore: masteryNew,
      volatility: volatilityNew,
      lastSeenAt: now,
      rightStreak,
      wrongStreak,
      updatedAt: now,
    },
    create: {
      userId,
      conceptTag,
      skill,
      masteryScore: masteryNew,
      volatility: volatilityNew,
      lastSeenAt: now,
      rightStreak,
      wrongStreak,
    },
  })
}

async function registerExerciseAttempt({ userId, session, payload = {} }) {
  const lesson = session.lessonPayload || {}
  const exercises = Array.isArray(lesson.exercices) ? lesson.exercices : []
  const exerciceId = String(payload.exerciceId || '')
  const exercise = exercises.find((item) => String(item.id) === exerciceId)
  if (!exercise) throw new Error('Exercice introuvable dans la session')

  const correct = Boolean(payload.correct)
  const responseTimeMs = clamp(Number(payload.responseTimeMs) || 0, 0, 600000)
  const hintsUsed = clamp(Number(payload.hintsUsed) || 0, 0, 10)
  const confidenceRaw = payload.confidence == null ? null : clamp(Number(payload.confidence) || 0, 0, 100)
  const targetMs = Number(exercise.targetMs || TYPE_TARGET_MS[exercise.type] || 30000)
  const attemptScore = computeAttemptScore({ correct, responseTimeMs, targetMs, hintsUsed })
  const conceptTag = String(exercise.conceptTag || '')
  const skill = String(exercise.skill || typeToSkill(exercise.type) || 'ECRIRE')
  const previousAttempt = await getPreviousAttemptForConcept({
    userId,
    conceptTag,
  })
  const userAnswer = payload.userAnswer != null ? String(payload.userAnswer) : null
  const expectedAnswer = payload.expectedAnswer != null
    ? String(payload.expectedAnswer)
    : (extractExpectedAnswer(exercise) != null ? String(extractExpectedAnswer(exercise)) : null)

  const attempt = await prisma.exerciseAttempt.create({
    data: {
      userId,
      sessionId: session.id,
      leconId: String(lesson.id || ''),
      exerciceId,
      type: String(exercise.type || payload.type || 'qcm'),
      conceptTag,
      errorTag: exercise.errorTag || null,
      skill,
      correct,
      userAnswer,
      expectedAnswer,
      responseTimeMs,
      hintsUsed,
      confidence: confidenceRaw,
      attemptScore,
    },
  })

  await upsertConceptState({
    userId,
    conceptTag: attempt.conceptTag,
    skill: attempt.skill,
    attemptScore,
    correct,
  })

  const { breakdown, progression } = await awardAttemptXp({
    userId,
    lessonId: attempt.leconId,
    correct,
    responseTimeMs,
    attemptScore,
    previousAttempt,
  })

  const updatedAttempt = await prisma.exerciseAttempt.update({
    where: { id: attempt.id },
    data: {
      xpAwarded: breakdown.total,
      correctionXp: breakdown.correctionXp,
      speedXp: breakdown.speedXp,
      improvementXp: breakdown.improvementXp,
      completionXp: breakdown.completionXp,
    },
  })

  const errorProfile = await upsertErrorProfileFromAttempt({
    userId,
    lessonId: attempt.leconId,
    conceptTag: attempt.conceptTag,
    errorTag: attempt.errorTag,
    correct,
    userAnswer,
    expectedAnswer,
  })

  const exerciseIndex = exercises.findIndex((item) => String(item.id) === exerciceId)
  return {
    attempt: updatedAttempt,
    exercise,
    exerciseIndex,
    progression,
    xpBreakdown: breakdown,
    errorProfile,
  }
}

async function shouldTriggerRemediation({ sessionId }) {
  const latest = await prisma.exerciseAttempt.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: 2,
  })
  return shouldTriggerRemediationFromAttempts(latest)
}

function shouldTriggerRemediationFromAttempts(latestAttempts) {
  const latest = Array.isArray(latestAttempts) ? latestAttempts : []
  if (latest.length < 2) return false
  const [current, previous] = latest
  if (current.correct || previous.correct) return false
  if (!current.errorTag || !previous.errorTag) return false
  return current.errorTag === previous.errorTag
}

async function computeSessionProgress({ sessionId, exerciseCount, nextIndex }) {
  const attemptsCount = await prisma.exerciseAttempt.count({ where: { sessionId } })
  const safeTotal = Math.max(1, Number(exerciseCount) || 1)
  return {
    currentIndex: clamp(Number(nextIndex) || 0, 0, safeTotal),
    totalExercises: safeTotal,
    completedAttempts: attemptsCount,
    completionRate: clamp(Math.round((attemptsCount / safeTotal) * 100), 0, 100),
  }
}

async function submitAdaptiveAttempt({ userId, sessionId, payload = {} }) {
  const session = await prisma.adaptiveSession.findFirst({
    where: { id: sessionId, userId },
  })
  if (!session) throw new Error('Session introuvable')
  if (session.status !== 'ACTIVE') throw new Error('Session non active')

  const lesson = session.lessonPayload || {}
  const exercises = Array.isArray(lesson.exercices) ? lesson.exercices : []
  const {
    attempt,
    exerciseIndex,
    progression,
    xpBreakdown,
    errorProfile,
  } = await registerExerciseAttempt({ userId, session, payload })

  let updatedExercises = [...exercises]
  let remediation = null

  const remediationNeeded = await shouldTriggerRemediation({ sessionId: session.id })
  if (remediationNeeded) {
    const bank = readAdaptiveBank()
    const concept = (bank.concepts || []).find((item) => item.conceptTag === attempt.conceptTag)
    if (concept) {
      remediation = buildRemediationBlock({
        concept,
        seed: `${session.id}:${attempt.id}`,
        userPowerScore: Number((lesson.adaptiveMeta || {}).userPowerScore) || 50,
        index: exerciseIndex + 1,
      })
      updatedExercises = [
        ...updatedExercises.slice(0, exerciseIndex + 1),
        ...remediation.exercises,
        ...updatedExercises.slice(exerciseIndex + 1),
      ]
    }
  }

  const nextIndex = clamp(Math.max(session.nextIndex, exerciseIndex + 1), 0, Math.max(1, updatedExercises.length))
  const updatedLesson = {
    ...lesson,
    exercices: updatedExercises,
    exercicesCount: updatedExercises.length,
  }

  await prisma.adaptiveSession.update({
    where: { id: session.id },
    data: {
      lessonPayload: updatedLesson,
      nextIndex,
      updatedAt: new Date(),
    },
  })

  const metrics = await getUserMetrics({ userId, objective: session.objectif || 'MIXTE' })
  const progress = await computeSessionProgress({
    sessionId: session.id,
    exerciseCount: updatedExercises.length,
    nextIndex,
  })
  const nextExercice = updatedExercises[nextIndex] || null
  const unlockStatus = session.mode === 'lesson'
    ? await buildUnlockStatusPayload({
        userId,
        niveau: session.niveau,
        lessonId: lesson.id,
      })
    : null
  const activeErrors = await getActiveErrorProfiles({ userId })

  return {
    nextExercice,
    remediation,
    xpGained: xpBreakdown.total,
    xpBreakdown,
    lessonXpTotal: Number(progression?.xpEarned) || 0,
    lessonMasteryScore: Number(progression?.masteryScore) || 0,
    lessonErrorRate: Number(progression?.errorRate) || 0,
    frequentErrorsChanged: errorProfile
      ? [{
          conceptTag: errorProfile.conceptTag,
          errorTag: errorProfile.errorTag,
          count: errorProfile.count,
          successStreak: errorProfile.successStreak,
          isFrequent: errorProfile.isFrequent,
          resolvedAt: errorProfile.resolvedAt,
          nextReviewAt: errorProfile.nextReviewAt,
        }]
      : [],
    lessonState: formatLessonState(progression, unlockStatus),
    activeErrors: activeErrors.map((profile) => ({
      lessonId: profile.leconId,
      conceptTag: profile.conceptTag,
      errorTag: profile.errorTag,
      count: profile.count,
      successStreak: profile.successStreak,
      isFrequent: profile.isFrequent,
      nextReviewAt: profile.nextReviewAt,
    })),
    unlockStatus,
    userPowerScore: metrics.userPowerScore,
    complexityIndex200: metrics.complexityIndex200,
    sessionProgress: progress,
  }
}

function buildRecommendation({ states, objective, niveau, dueReviewProfiles = [] }) {
  const sortedWeak = [...states]
    .sort((a, b) => (Number(a.masteryScore) || 0) - (Number(b.masteryScore) || 0))
    .slice(0, 3)
    .map((state) => ({
      conceptTag: state.conceptTag,
      skill: state.skill,
      masteryScore: Math.round(Number(state.masteryScore) || 0),
      wrongStreak: Number(state.wrongStreak) || 0,
    }))

  const skillWeights = OBJECTIVE_SKILL_WEIGHTS[objective] || OBJECTIVE_SKILL_WEIGHTS.MIXTE
  const targetSkills = Object.entries(skillWeights)
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([skill]) => skill)

  return {
    weakConcepts: sortedWeak,
    targetSkills,
    dueReviews: dueReviewProfiles.map((profile) => ({
      lessonId: profile.leconId,
      conceptTag: profile.conceptTag,
      errorTag: profile.errorTag,
      nextReviewAt: profile.nextReviewAt,
    })),
    suggestedSession: {
      niveau,
      objectif: objective,
      dureeMinutes: 30,
      focusConcepts: sortedWeak.map((item) => item.conceptTag),
    },
  }
}

async function finishAdaptiveSession({ userId, sessionId }) {
  const session = await prisma.adaptiveSession.findFirst({
    where: { id: sessionId, userId },
  })
  if (!session) throw new Error('Session introuvable')

  const attempts = await prisma.exerciseAttempt.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' },
  })
  const finalScore100 = clamp(
    Math.round(
      attempts.length > 0
        ? attempts.reduce((sum, item) => sum + (Number(item.attemptScore) || 0), 0) / attempts.length
        : 0
    ),
    0,
    100
  )

  const lessonId = String(session.lessonPayload?.id || `${String(session.niveau).toLowerCase()}-adaptive-${session.id.slice(0, 8)}`)
  const progressionUpdated = await syncLessonProgression({
    userId,
    lessonId,
    markComplete: true,
    unlockedAt: new Date(),
  })

  await prisma.adaptiveSession.update({
    where: { id: session.id },
    data: {
      status: 'COMPLETED',
      endedAt: new Date(),
      updatedAt: new Date(),
    },
  })

  const [states, dueReviewProfiles] = await Promise.all([
    prisma.userConceptState.findMany({ where: { userId } }),
    getDueReviewProfiles({ userId }),
  ])
  const nextRecommendation = buildRecommendation({
    states,
    objective: session.objectif || 'MIXTE',
    niveau: session.niveau || 'A1',
    dueReviewProfiles,
  })
  const unlockStatus = session.mode === 'lesson'
    ? await buildUnlockStatusPayload({
        userId,
        niveau: session.niveau,
        lessonId,
      })
    : null

  return {
    finalScore100,
    progressionUpdated,
    lessonState: formatLessonState(progressionUpdated, unlockStatus),
    unlockStatus,
    nextRecommendation,
  }
}

async function getAdaptiveRecommendation({ userId }) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('Utilisateur introuvable')
  const objective = mapUserObjective(user.objectif)
  const [states, dueReviewProfiles] = await Promise.all([
    prisma.userConceptState.findMany({ where: { userId } }),
    getDueReviewProfiles({ userId }),
  ])
  return buildRecommendation({
    states,
    objective,
    niveau: normalizeLevel(user.niveau),
    dueReviewProfiles,
  })
}

module.exports = {
  isAdaptiveEnabled,
  startAdaptiveSession,
  submitAdaptiveAttempt,
  finishAdaptiveSession,
  getAdaptiveRecommendation,
  __testables: {
    computeTargetDistribution,
    shouldTriggerRemediationFromAttempts,
    selectConceptPools,
    createSessionLesson,
  },
}
