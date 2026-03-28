const DEFAULT_LEVEL_THRESHOLDS = Object.freeze({
  A1: 0,
  A2: 300,
  B1: 700,
  B2: 1500,
  C1: 3000,
})

const DEFAULT_DNA = Object.freeze({
  phonology: 0,
  fluency: 0,
  vocabulary: 0,
  grammar: 0,
  reactivity: 0,
  confidence: 0,
  intonation: 0,
  naturalness: 0,
})

const DEFAULT_PREFERENCES = Object.freeze({
  preferredCharacters: [],
  difficultThemes: [],
  strongThemes: [],
  learningStyle: 'balanced',
  hintSensitivity: 3,
})

const DEFAULT_SESSION_METRICS = Object.freeze({
  totalTurns: 0,
  correctTurns: 0,
  acceptableTurns: 0,
  incorrectTurns: 0,
  avgResponseTimeMs: 0,
  hintsUsed: 0,
  hintsLevel: [],
  twistTriggered: false,
  twistHandledWell: false,
  vocabularyTargetUsed: 0,
  completedObjectives: [],
  speedRoundScore: 0,
})

const DEFAULT_SERVICES_USED = Object.freeze({
  llm: [],
  tts: [],
  stt: [],
})

const CHARACTER_VOICES = Object.freeze({
  thomas: { voiceId: 'de-DE-KillianNeural', style: 'cheerful', rate: '0.9', lang: 'de-DE' },
  anna: { voiceId: 'de-DE-KatjaNeural', style: 'friendly', rate: '0.85', lang: 'de-DE' },
  klaus: { voiceId: 'de-DE-ConradNeural', style: 'serious', rate: '1.0', lang: 'de-DE' },
  marie: { voiceId: 'de-AT-JonasNeural', style: 'default', rate: '1.0', lang: 'de-AT' },
  erik: { voiceId: 'de-DE-BerndNeural', style: 'default', rate: '0.95', lang: 'de-DE' },
})

function clamp(value, min, max) {
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return min
  return Math.max(min, Math.min(max, numeric))
}

function safeArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback.slice()
}

function safeObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : { ...fallback }
}

function stripCodeFences(value = '') {
  return String(value).replace(/```json|```/gi, '').trim()
}

function safeJsonParse(value, fallback = {}) {
  if (value == null) return fallback
  if (typeof value === 'object') return value

  try {
    return JSON.parse(stripCodeFences(value))
  } catch {
    return fallback
  }
}

function dedupeStrings(values) {
  return [...new Set(safeArray(values).filter(Boolean))]
}

function buildSystemPrompt(characterId, themeId, level, weaknesses = [], isTwistTurn = false) {
  const weaknessText = safeArray(weaknesses)
    .slice(0, 5)
    .map((item) => `${item.type || 'general'}:${item.detail || 'unknown'}`)
    .join(', ')

  return [
    'You are a German conversation partner inside EAM speaking practice.',
    `Character: ${characterId || 'thomas'}.`,
    `Theme: ${themeId || 'general'}.`,
    `Learner level: ${level || 'A1'}.`,
    'Reply in natural German only unless explicitly asked otherwise.',
    'Keep answers short, encouraging, and adapted to the learner level.',
    weaknessText ? `Avoid overloading the learner. Watch these weaknesses: ${weaknessText}.` : '',
    isTwistTurn ? 'Introduce a natural small twist to make the conversation less predictable.' : '',
    'Do not break character unless you are asked for a coaching hint.',
  ].filter(Boolean).join(' ')
}

function detectNewWords(aiText, previousMessages = [], level = 'A1') {
  const minLength = { A1: 4, A2: 4, B1: 3, B2: 3, C1: 3 }[level] || 4
  const stopwords = new Set([
    'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'und', 'oder', 'aber', 'ist', 'bin',
    'sind', 'hat', 'haben', 'ein', 'eine', 'der', 'die', 'das', 'nicht', 'ja', 'nein',
  ])

  const previous = new Set(
    safeArray(previousMessages)
      .map((message) => String(message.content || '').toLowerCase())
      .join(' ')
      .split(/\s+/)
      .map((word) => word.replace(/[.,!?;:()"']/g, ''))
      .filter(Boolean)
  )

  return String(aiText || '')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[.,!?;:()"']/g, ''))
    .filter((word) => word.length >= minLength && !previous.has(word) && !stopwords.has(word))
    .filter((word, index, words) => words.indexOf(word) === index)
    .slice(0, 3)
}

function buildConversationTranscript(messages = []) {
  return safeArray(messages)
    .map((message) => `${message.role === 'assistant' || message.role === 'ai' ? 'AI' : 'USER'}: ${message.content || ''}`)
    .join('\n')
}

function getCharacterVoice(characterId) {
  return CHARACTER_VOICES[characterId] || CHARACTER_VOICES.thomas
}

function createAsyncHandler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next)
    } catch (error) {
      next(error)
    }
  }
}

module.exports = {
  CHARACTER_VOICES,
  DEFAULT_DNA,
  DEFAULT_LEVEL_THRESHOLDS,
  DEFAULT_PREFERENCES,
  DEFAULT_SERVICES_USED,
  DEFAULT_SESSION_METRICS,
  buildConversationTranscript,
  buildSystemPrompt,
  clamp,
  createAsyncHandler,
  dedupeStrings,
  detectNewWords,
  getCharacterVoice,
  safeArray,
  safeJsonParse,
  safeObject,
  stripCodeFences,
}
