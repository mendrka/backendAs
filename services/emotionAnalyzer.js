function analyzeEmotion(text = '') {
  const normalized = String(text).trim().toLowerCase()
  if (!normalized) return 'neutral'

  const hesitantMarkers = ['...', 'hmm', 'euh', 'uh', 'ich weiss nicht', 'vielleicht', '?']
  const confidentMarkers = ['!', 'natuerlich', 'klar', 'sicher', 'bestimmt', 'gern']

  const hesitantScore = hesitantMarkers.reduce(
    (score, marker) => score + (normalized.includes(marker) ? 1 : 0),
    0
  )
  const confidentScore = confidentMarkers.reduce(
    (score, marker) => score + (normalized.includes(marker) ? 1 : 0),
    0
  )

  if (hesitantScore > confidentScore) return 'hesitant'
  if (confidentScore > hesitantScore) return 'confident'
  return 'neutral'
}

module.exports = {
  analyzeEmotion,
}
