function requireApiKey() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'COMING_SOON') {
    throw new Error('Gemini API key missing')
  }
}

function buildPrompt(messages = [], systemPrompt = '') {
  return [
    systemPrompt ? `SYSTEM:\n${systemPrompt}` : '',
    ...messages.map((message) => `${message.role === 'assistant' || message.role === 'ai' ? 'ASSISTANT' : 'USER'}: ${message.content}`),
  ].filter(Boolean).join('\n\n')
}

async function chat(messages, systemPrompt = '') {
  requireApiKey()

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildPrompt(messages, systemPrompt) }],
          },
        ],
        generationConfig: {
          temperature: 0.5,
        },
      }),
    }
  )

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(`Gemini failed (${response.status}): ${payload}`)
  }

  const data = await response.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
}

module.exports = {
  chat,
}
