function requireApiKey() {
  if (!process.env.AZURE_TTS_KEY || process.env.AZURE_TTS_KEY === 'COMING_SOON') {
    throw new Error('Azure TTS key missing')
  }
}

function buildSsml(text, voiceConfig = {}) {
  const voiceId = voiceConfig.voiceId || 'de-DE-KillianNeural'
  const style = voiceConfig.style || 'default'
  const rate = voiceConfig.rate || '1.0'
  const escapedText = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return [
    `<speak version="1.0" xml:lang="${voiceConfig.lang || 'de-DE'}" xmlns:mstts="https://www.w3.org/2001/mstts">`,
    `  <voice name="${voiceId}">`,
    style && style !== 'default'
      ? `    <mstts:express-as style="${style}"><prosody rate="${rate}">${escapedText}</prosody></mstts:express-as>`
      : `    <prosody rate="${rate}">${escapedText}</prosody>`,
    '  </voice>',
    '</speak>',
  ].join('')
}

async function synthesize(text, voiceConfig = {}) {
  requireApiKey()

  const endpoint = (process.env.AZURE_TTS_ENDPOINT || `https://${process.env.AZURE_TTS_REGION}.tts.speech.microsoft.com`).replace(/\/$/, '')
  const response = await fetch(`${endpoint}/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': process.env.AZURE_TTS_KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3',
      'User-Agent': 'EAM-Sprechen',
    },
    body: buildSsml(text, voiceConfig),
  })

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(`Azure TTS failed (${response.status}): ${payload}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

module.exports = {
  synthesize,
}
