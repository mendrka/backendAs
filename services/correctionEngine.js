const { analyzeEmotion } = require('./emotionAnalyzer')
const { getCorrectionFallback, getFeedbackFallback } = require('./offlineFallback')
const {
  buildConversationTranscript,
  safeJsonParse,
  stripCodeFences,
} = require('../utils/sprechenHelpers')

function buildCorrectionPrompt(userText, conversationHistory = [], level = 'A1', themeId = 'general') {
  return [
    'You are a German tutor. Return JSON only.',
    'Evaluate the learner answer in context.',
    `Learner level: ${level}.`,
    `Theme: ${themeId}.`,
    'Output keys: status, score, correctedVersion, explanation, grammarPoint, weaknessDetected, emotionalTone.',
    'status must be correct, acceptable, or incorrect.',
    'explanation must be in French.',
    'weaknessDetected must be null or an object with type and detail.',
    'Keep correctedVersion null when the sentence is already acceptable.',
    '',
    'Conversation history:',
    buildConversationTranscript(conversationHistory),
    '',
    `Learner answer: ${userText}`,
  ].join('\n')
}

function buildFeedbackPrompt({ transcript, scores, themeId, characterId, level, metrics }) {
  return [
    'You are a German speaking coach. Return JSON only.',
    'Output keys: characterMessage, globalScore, strengths, toImprove, tip, culturalNote, nextRecommendation, badges.',
    `Theme: ${themeId || 'general'}.`,
    `Character: ${characterId || 'thomas'}.`,
    `Level: ${level || 'A1'}.`,
    `Scores JSON: ${JSON.stringify(scores || {})}.`,
    `Metrics JSON: ${JSON.stringify(metrics || {})}.`,
    `Transcript JSON: ${JSON.stringify(transcript || [])}.`,
  ].join('\n')
}

function basicRuleCorrection(userText, level = 'A1') {
  const trimmed = String(userText || '').trim()
  const emotionalTone = analyzeEmotion(trimmed)

  if (!trimmed) {
    return {
      ...getCorrectionFallback(''),
      emotionalTone,
      explanation: 'Tu n as encore rien dit.',
      weaknessDetected: {
        type: 'fluency',
        detail: 'blocage de production',
      },
    }
  }

  let status = 'acceptable'
  let score = 72
  let correctedVersion = null
  let explanation = 'La reponse est globalement compréhensible.'
  let grammarPoint = null
  let weaknessDetected = null

  if (!/[.!?]$/.test(trimmed) && level !== 'A1') {
    score -= 4
  }

  if (/ich bin gut/i.test(trimmed)) {
    status = 'incorrect'
    score = 52
    correctedVersion = trimmed.replace(/ich bin gut/i, 'Mir geht es gut')
    explanation = 'Pour parler de ton etat, on dit plutot "Mir geht es gut".'
    grammarPoint = 'expression du ressenti'
    weaknessDetected = {
      type: 'grammar',
      detail: 'expression de l etat',
    }
  } else if (/ich habe \d+ jahre/i.test(trimmed)) {
    status = 'incorrect'
    score = 55
    correctedVersion = trimmed.replace(/ich habe (\d+) jahre/i, 'Ich bin $1 Jahre alt')
    explanation = 'En allemand, on utilise "sein" pour l age.'
    grammarPoint = 'age avec sein'
    weaknessDetected = {
      type: 'grammar',
      detail: 'age avec sein',
    }
  } else if (trimmed.split(/\s+/).length <= 2) {
    status = 'acceptable'
    score = 65
    explanation = 'La reponse est tres courte. Elle fonctionne, mais elle peut etre enrichie.'
    weaknessDetected = {
      type: 'fluency',
      detail: 'reponse trop courte',
    }
  }

  return {
    status,
    score,
    correctedVersion,
    explanation,
    grammarPoint,
    weaknessDetected,
    emotionalTone,
  }
}

function parseCorrectionResult(rawContent, fallbackUserText = '') {
  const parsed = safeJsonParse(stripCodeFences(rawContent), null)
  if (!parsed) return basicRuleCorrection(fallbackUserText)

  return {
    status: parsed.status || 'acceptable',
    score: Number(parsed.score) || 70,
    correctedVersion: parsed.correctedVersion || null,
    explanation: parsed.explanation || null,
    grammarPoint: parsed.grammarPoint || null,
    weaknessDetected: parsed.weaknessDetected || null,
    emotionalTone: parsed.emotionalTone || analyzeEmotion(fallbackUserText),
  }
}

function generateDefaultFeedback(scores = {}) {
  return getFeedbackFallback(scores)
}

module.exports = {
  basicRuleCorrection,
  buildCorrectionPrompt,
  buildFeedbackPrompt,
  generateDefaultFeedback,
  parseCorrectionResult,
}
