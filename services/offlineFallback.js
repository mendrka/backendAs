const offlineHints = {
  general: {
    1: 'Alles gut?',
    2: 'Was moechten Sie sagen?',
    3: 'Tu peux dire: Ich moechte das bitte. Cela veut dire: Je voudrais cela.',
  },
  cafe: {
    1: 'Ja bitte?',
    2: 'Moechten Sie etwas trinken?',
    3: 'Tu peux dire: Ich nehme einen Kaffee, bitte. Cela veut dire: Je prends un cafe, s il vous plait.',
  },
}

const conversationFallbacks = {
  general: [
    'Guten Tag. Erzaehlen Sie mir bitte ein bisschen mehr.',
    'Verstehe. Und was ist fuer Sie wichtig?',
    'Interessant. Koennen Sie ein Beispiel geben?',
  ],
  cafe: [
    'Guten Morgen. Was darf es fuer Sie sein?',
    'Moechten Sie noch etwas dazu?',
    'Sehr gern. Sonst noch etwas?',
  ],
}

function getConversationFallback(themeId = 'general', turn = 0) {
  const key = conversationFallbacks[themeId] ? themeId : 'general'
  const options = conversationFallbacks[key]
  return options[turn % options.length]
}

function getCorrectionFallback(userText = '') {
  return {
    status: userText ? 'acceptable' : 'incorrect',
    score: userText ? 70 : 20,
    correctedVersion: userText || null,
    explanation: userText
      ? 'Reponse comprise, mais une verification plus fine demande un modele externe.'
      : 'Aucune reponse detectee.',
    grammarPoint: null,
    weaknessDetected: null,
    emotionalTone: 'neutral',
  }
}

function getFeedbackFallback(scores = {}) {
  return {
    characterMessage: 'Gute Arbeit. Wir machen naechstes Mal weiter.',
    globalScore: scores.global || 0,
    strengths: ['Participation'],
    toImprove: ['Precision grammaticale'],
    tip: 'Fais des reponses plus courtes mais plus sures.',
    culturalNote: 'En allemand, la formule de politesse change selon le contexte.',
    nextRecommendation: {
      themeId: 'general',
      reason: 'Continuer a automatiser les reponses simples.',
    },
    badges: [],
  }
}

module.exports = {
  conversationFallbacks,
  getConversationFallback,
  getCorrectionFallback,
  getFeedbackFallback,
  offlineHints,
}
