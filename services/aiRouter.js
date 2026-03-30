const groqService = require('./groqService')
const geminiService = require('./geminiService')
const openRouterService = require('./openRouterService')
const azureTTSService = require('./azureTTSService')
const voiceRSSService = require('./voiceRSSService')
const offlineFallback = require('./offlineFallback')
const { basicRuleCorrection } = require('./correctionEngine')

class AIRouter {
  constructor() {
    this.quotas = {
      groq_fast: { used: 0, limit: 14000, resetDate: null },
      groq_smart: { used: 0, limit: 950, resetDate: null },
      groq_whisper: { used: 0, limit: 14000, resetDate: null },
      gemini: { used: 0, limit: 1400, resetDate: null },
      openrouter: { used: 0, limit: 99999, resetDate: null },
      azure_tts: { used: 0, limit: 480000, resetDate: null },
      voicerss: { used: 0, limit: 330, resetDate: null },
    }

    this.health = {
      groq: { ok: true, lastError: null, failCount: 0 },
      gemini: { ok: true, lastError: null, failCount: 0 },
      openrouter: { ok: true, lastError: null, failCount: 0 },
      azure: { ok: true, lastError: null, failCount: 0 },
      voicerss: { ok: true, lastError: null, failCount: 0 },
    }
  }

  checkQuota(service) {
    const quota = this.quotas[service]
    if (!quota) return true

    const today = new Date().toDateString()
    if (quota.resetDate !== today) {
      quota.used = 0
      quota.resetDate = today
    }

    return quota.used < quota.limit
  }

  consumeQuota(service, amount = 1) {
    if (this.quotas[service]) {
      this.quotas[service].used += amount
    }
  }

  markServiceError(service, error = null) {
    const status = this.health[service]
    if (!status) return

    status.failCount += 1
    status.lastError = {
      at: new Date().toISOString(),
      message: error ? String(error.message || error) : null,
    }
    if (status.failCount >= 3) {
      status.ok = false
      setTimeout(() => {
        status.ok = true
        status.failCount = 0
      }, 5 * 60 * 1000).unref?.()
    }
  }

  markServiceOk(service) {
    if (!this.health[service]) return
    this.health[service].ok = true
    this.health[service].failCount = 0
    this.health[service].lastError = null
  }

  isServiceHealthy(service) {
    return this.health[service]?.ok !== false
  }

  async getConversationResponse(messages, systemPrompt, context = {}) {
    if (this.checkQuota('groq_fast') && this.isServiceHealthy('groq')) {
      try {
        const content = await groqService.chat(messages, systemPrompt, 'fast')
        this.consumeQuota('groq_fast')
        this.markServiceOk('groq')
        return { content, service: 'groq_fast', servicesUsed: ['groq_fast'] }
      } catch (error) {
        this.markServiceError('groq', error)
      }
    }

    if (this.checkQuota('openrouter') && this.isServiceHealthy('openrouter')) {
      try {
        const content = await openRouterService.chat(messages, systemPrompt, 'fast')
        this.consumeQuota('openrouter')
        this.markServiceOk('openrouter')
        return { content, service: 'openrouter_fast', servicesUsed: ['openrouter_fast'] }
      } catch (error) {
        this.markServiceError('openrouter', error)
      }
    }

    if (this.checkQuota('gemini') && this.isServiceHealthy('gemini')) {
      try {
        const content = await geminiService.chat(messages, systemPrompt)
        this.consumeQuota('gemini')
        this.markServiceOk('gemini')
        return { content, service: 'gemini', servicesUsed: ['gemini'] }
      } catch (error) {
        this.markServiceError('gemini', error)
      }
    }

    return {
      content: offlineFallback.getConversationFallback(context.themeId, context.turn || 0),
      service: 'offline',
      servicesUsed: ['offline'],
    }
  }

  async getCorrectionAnalysis(prompt, context = {}) {
    if (this.checkQuota('groq_smart') && this.isServiceHealthy('groq')) {
      try {
        const content = await groqService.chat([{ role: 'user', content: prompt }], '', 'smart')
        this.consumeQuota('groq_smart')
        this.markServiceOk('groq')
        return { content, service: 'groq_smart' }
      } catch (error) {
        this.markServiceError('groq', error)
      }
    }

    if (this.checkQuota('openrouter') && this.isServiceHealthy('openrouter')) {
      try {
        const content = await openRouterService.chat([{ role: 'user', content: prompt }], '', 'smart')
        this.consumeQuota('openrouter')
        this.markServiceOk('openrouter')
        return { content, service: 'openrouter_smart' }
      } catch (error) {
        this.markServiceError('openrouter', error)
      }
    }

    if (this.checkQuota('gemini') && this.isServiceHealthy('gemini')) {
      try {
        const content = await geminiService.chat([{ role: 'user', content: prompt }], '')
        this.consumeQuota('gemini')
        this.markServiceOk('gemini')
        return { content, service: 'gemini' }
      } catch (error) {
        this.markServiceError('gemini', error)
      }
    }

    return {
      content: JSON.stringify(basicRuleCorrection(context.userText, context.level)),
      service: 'rules',
    }
  }

  async getHint(messages, hintLevel, themeContext = {}) {
    const promptMap = {
      1: `You are ${themeContext.characterId || themeContext.character || 'a German character'}. Keep the user speaking naturally in character. Maximum 8 words.`,
      2: `Rephrase the previous question simply in German. Include one helpful vocabulary item. Vocabulary: ${(themeContext.vocabularyHints || []).join(', ')}`,
      3: 'You are a German coach. Give one model sentence in German, then one short French explanation.',
    }

    const prompt = promptMap[hintLevel] || promptMap[1]

    if (this.checkQuota('groq_fast') && this.isServiceHealthy('groq')) {
      try {
        const content = await groqService.chat(messages, prompt, 'fast')
        this.consumeQuota('groq_fast')
        this.markServiceOk('groq')
        return { content, service: 'groq_fast', level: hintLevel }
      } catch (error) {
        this.markServiceError('groq', error)
      }
    }

    if (this.checkQuota('openrouter') && this.isServiceHealthy('openrouter')) {
      try {
        const content = await openRouterService.chat(messages, prompt, 'fast')
        this.consumeQuota('openrouter')
        this.markServiceOk('openrouter')
        return { content, service: 'openrouter_fast', level: hintLevel }
      } catch (error) {
        this.markServiceError('openrouter', error)
      }
    }

    return {
      content: offlineFallback.offlineHints[themeContext.themeId]?.[hintLevel]
        || offlineFallback.offlineHints.general[hintLevel],
      service: 'offline',
      level: hintLevel,
    }
  }

  async getTTS(text, voiceConfig) {
    if (this.checkQuota('azure_tts') && this.isServiceHealthy('azure')) {
      try {
        const audio = await azureTTSService.synthesize(text, voiceConfig)
        this.consumeQuota('azure_tts', String(text).length)
        this.markServiceOk('azure')
        return { audio, service: 'azure', format: 'mp3' }
      } catch (error) {
        this.markServiceError('azure', error)
      }
    }

    if (this.checkQuota('voicerss') && this.isServiceHealthy('voicerss')) {
      try {
        const audio = await voiceRSSService.synthesize(text, voiceConfig.lang || 'de-de')
        this.consumeQuota('voicerss')
        this.markServiceOk('voicerss')
        return { audio, service: 'voicerss', format: 'mp3' }
      } catch (error) {
        this.markServiceError('voicerss', error)
      }
    }

    return { audio: null, service: 'webspeech', format: 'webspeech', text }
  }

  async getSTT(audioBuffer, language = 'de') {
    if (this.checkQuota('groq_whisper') && this.isServiceHealthy('groq')) {
      try {
        const transcript = await groqService.transcribe(audioBuffer, language)
        this.consumeQuota('groq_whisper')
        this.markServiceOk('groq')
        return { transcript, service: 'groq_whisper', confidence: 'high' }
      } catch (error) {
        this.markServiceError('groq', error)
      }
    }

    return { transcript: null, service: 'webspeech', confidence: 'low' }
  }

  getStatus() {
    return {
      quotas: Object.entries(this.quotas).map(([service, data]) => ({
        service,
        used: data.used,
        limit: data.limit,
        remaining: data.limit - data.used,
        percentUsed: data.limit ? Math.round((data.used / data.limit) * 100) : 0,
        resetDate: data.resetDate,
      })),
      health: this.health,
      timestamp: new Date().toISOString(),
    }
  }
}

module.exports = new AIRouter()
