function requireApiKey() {
  if (!process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY === 'COMING_SOON') {
    throw new Error('OpenRouter API key missing')
  }
}

function buildMessages(messages = [], systemPrompt = '') {
  const result = []
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }

  messages.forEach((message) => {
    result.push({
      role: message.role === 'ai' ? 'assistant' : message.role,
      content: message.content,
    })
  })

  return result
}

function parseModelList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getCandidateModels(tier) {
  const configuredPrimary = tier === 'smart' ? process.env.OPENROUTER_MODEL_SMART : process.env.OPENROUTER_MODEL_FAST
  const configuredFallbacks = tier === 'smart'
    ? process.env.OPENROUTER_MODEL_SMART_FALLBACKS
    : process.env.OPENROUTER_MODEL_FAST_FALLBACKS

  const defaults = tier === 'smart'
    ? [
        'meta-llama/llama-3.1-70b-instruct',
        'meta-llama/llama-3.3-70b-instruct',
        'openai/gpt-4o-mini',
      ]
    : [
        'meta-llama/llama-3.1-8b-instruct',
        'openai/gpt-4o-mini',
        'mistralai/mistral-7b-instruct',
      ]

  return [
    ...parseModelList(configuredPrimary),
    ...parseModelList(configuredFallbacks),
    ...defaults,
  ].filter((model, index, models) => models.indexOf(model) === index)
}

function isMissingModelError(payloadText) {
  try {
    const payload = JSON.parse(payloadText)
    const code = payload?.error?.code
    const message = payload?.error?.message || ''
    return code === 404 || /no endpoints found/i.test(message)
  } catch {
    return /no endpoints found/i.test(payloadText)
  }
}

async function chat(messages, systemPrompt = '', tier = 'fast') {
  requireApiKey()

  const candidateModels = getCandidateModels(tier)

  let lastError = null

  for (const model of candidateModels) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://eam.local',
        'X-Title': 'EAM Sprechen',
      },
      body: JSON.stringify({
        model,
        temperature: tier === 'smart' ? 0.4 : 0.65,
        messages: buildMessages(messages, systemPrompt),
      }),
    })

    if (!response.ok) {
      const payload = await response.text()
      lastError = new Error(`OpenRouter failed (${response.status}) with model "${model}": ${payload}`)

      if (response.status === 404 || isMissingModelError(payload)) {
        continue
      }

      throw lastError
    }

    const data = await response.json()
    return data?.choices?.[0]?.message?.content?.trim() || ''
  }

  throw lastError || new Error('OpenRouter failed: no model succeeded')
}

module.exports = {
  chat,
}
