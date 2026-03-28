const FAST_MODEL = process.env.GROQ_MODEL_FAST || 'llama-3.1-8b-instant'
const SMART_MODEL = process.env.GROQ_MODEL_SMART || 'llama-3.3-70b-versatile'
const STT_MODEL = 'whisper-large-v3-turbo'
const BASE_URL = 'https://api.groq.com/openai/v1'

function requireApiKey() {
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'COMING_SOON') {
    throw new Error('Groq API key missing')
  }
}

function buildMessages(messages = [], systemPrompt = '') {
  const normalized = []
  if (systemPrompt) {
    normalized.push({ role: 'system', content: systemPrompt })
  }

  messages.forEach((message) => {
    normalized.push({
      role: message.role === 'ai' ? 'assistant' : message.role,
      content: message.content,
    })
  })

  return normalized
}

async function chat(messages, systemPrompt = '', tier = 'fast') {
  requireApiKey()

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: tier === 'smart' ? SMART_MODEL : FAST_MODEL,
      temperature: tier === 'smart' ? 0.35 : 0.7,
      max_tokens: tier === 'smart' ? 700 : 220,
      messages: buildMessages(messages, systemPrompt),
    }),
  })

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(`Groq chat failed (${response.status}): ${payload}`)
  }

  const data = await response.json()
  return data?.choices?.[0]?.message?.content?.trim() || ''
}

async function transcribe(audioBuffer, language = 'de') {
  requireApiKey()

  const formData = new FormData()
  formData.append('model', STT_MODEL)
  formData.append('language', language)
  formData.append('response_format', 'json')
  formData.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm')

  const response = await fetch(`${BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(`Groq STT failed (${response.status}): ${payload}`)
  }

  const data = await response.json()
  return data?.text?.trim() || ''
}

module.exports = {
  chat,
  transcribe,
}
