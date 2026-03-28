function requireApiKey() {
  if (!process.env.VOICERSS_API_KEY || process.env.VOICERSS_API_KEY === 'COMING_SOON') {
    throw new Error('VoiceRSS API key missing')
  }
}

async function synthesize(text, language = 'de-de') {
  requireApiKey()

  const query = new URLSearchParams({
    key: process.env.VOICERSS_API_KEY,
    hl: language.toLowerCase(),
    src: text,
    c: 'MP3',
    f: '44khz_16bit_stereo',
  })

  const response = await fetch(`https://api.voicerss.org/?${query.toString()}`)

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(`VoiceRSS failed (${response.status}): ${payload}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

module.exports = {
  synthesize,
}
