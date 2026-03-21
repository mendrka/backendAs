const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

function setMock(modulePath, exports) {
  const previous = require.cache[modulePath]
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  }
  return previous
}

function restoreMock(modulePath, previous) {
  delete require.cache[modulePath]
  if (previous) {
    require.cache[modulePath] = previous
  }
}

async function withRouter(basePath, router, run) {
  const app = express()
  app.use(express.json())
  app.use(basePath, router)

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })

  try {
    const { port } = server.address()
    await run(`http://127.0.0.1:${port}${basePath}`)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-token',
      ...(options.headers || {}),
    },
  })

  return {
    status: response.status,
    body: await response.json(),
  }
}

test('adaptive session routes expose lesson mode contract end-to-end', async () => {
  const authPath = require.resolve('../middleware/auth.middleware')
  const servicePath = require.resolve('../services/adaptiveCours.service')
  const routePath = require.resolve('../routes/adaptive-cours.routes')

  const previousAuth = setMock(authPath, (req, res, next) => {
    req.userId = 'user-lesson'
    next()
  })

  const calls = []
  const previousService = setMock(servicePath, {
    isAdaptiveEnabled: () => true,
    startAdaptiveSession: async ({ userId, payload }) => {
      calls.push({ type: 'start', userId, payload })
      return {
        sessionId: 'session-lesson-1',
        lesson: { id: payload.lessonId, exercices: [{ id: 'exo-1' }] },
        lessonState: { lessonId: payload.lessonId, xpEarned: 0, xpRequired: 100 },
        activeErrors: [{ conceptTag: 'article_usage', errorTag: 'article_omission' }],
        unlockStatus: { unlocked: false, reasons: ['xp 0/100'] },
      }
    },
    submitAdaptiveAttempt: async ({ userId, sessionId, payload }) => {
      calls.push({ type: 'attempt', userId, sessionId, payload })
      return {
        ok: true,
        xpGained: 17,
        lessonXpTotal: 17,
        lessonMasteryScore: 75,
        lessonErrorRate: 25,
        frequentErrorsChanged: ['article_omission'],
        unlockStatus: { unlocked: false, reasons: ['xp 17/100'] },
      }
    },
    finishAdaptiveSession: async ({ userId, sessionId }) => {
      calls.push({ type: 'finish', userId, sessionId })
      return {
        ok: true,
        lessonState: { lessonId: 'a1-1', xpEarned: 102, masteryScore: 74, errorRate: 20 },
        nextRecommendation: { type: 'next_lesson', lessonId: 'a1-2' },
        unlockStatus: { unlocked: true, reasons: [] },
      }
    },
    getAdaptiveRecommendation: async () => ({ ok: true }),
  })

  delete require.cache[routePath]

  try {
    const router = require('../routes/adaptive-cours.routes')
    await withRouter('/api/adaptive-cours', router, async (baseUrl) => {
      const start = await requestJson(`${baseUrl}/session/start`, {
        method: 'POST',
        body: JSON.stringify({
          niveau: 'A1',
          lessonId: 'a1-1',
          mode: 'lesson',
          objectif: 'LIRE',
        }),
      })
      assert.equal(start.status, 200)
      assert.equal(start.body.sessionId, 'session-lesson-1')
      assert.equal(start.body.lessonState.lessonId, 'a1-1')
      assert.equal(start.body.activeErrors[0].errorTag, 'article_omission')
      assert.equal(start.body.unlockStatus.unlocked, false)

      const attempt = await requestJson(`${baseUrl}/session/session-lesson-1/attempt`, {
        method: 'POST',
        body: JSON.stringify({
          exerciseId: 'exo-1',
          answer: 'der',
          responseTimeMs: 42000,
        }),
      })
      assert.equal(attempt.status, 200)
      assert.equal(attempt.body.xpGained, 17)
      assert.equal(attempt.body.lessonXpTotal, 17)
      assert.equal(attempt.body.lessonMasteryScore, 75)
      assert.equal(attempt.body.lessonErrorRate, 25)
      assert.deepEqual(attempt.body.frequentErrorsChanged, ['article_omission'])

      const finish = await requestJson(`${baseUrl}/session/session-lesson-1/finish`, {
        method: 'POST',
      })
      assert.equal(finish.status, 200)
      assert.equal(finish.body.lessonState.xpEarned, 102)
      assert.equal(finish.body.nextRecommendation.lessonId, 'a1-2')
      assert.equal(finish.body.unlockStatus.unlocked, true)
    })

    assert.deepEqual(calls, [
      {
        type: 'start',
        userId: 'user-lesson',
        payload: {
          niveau: 'A1',
          lessonId: 'a1-1',
          mode: 'lesson',
          objectif: 'LIRE',
        },
      },
      {
        type: 'attempt',
        userId: 'user-lesson',
        sessionId: 'session-lesson-1',
        payload: {
          exerciseId: 'exo-1',
          answer: 'der',
          responseTimeMs: 42000,
        },
      },
      {
        type: 'finish',
        userId: 'user-lesson',
        sessionId: 'session-lesson-1',
      },
    ])
  } finally {
    restoreMock(authPath, previousAuth)
    restoreMock(servicePath, previousService)
    delete require.cache[routePath]
  }
})

test('adaptive session start keeps free mode available', async () => {
  const authPath = require.resolve('../middleware/auth.middleware')
  const servicePath = require.resolve('../services/adaptiveCours.service')
  const routePath = require.resolve('../routes/adaptive-cours.routes')

  const previousAuth = setMock(authPath, (req, res, next) => {
    req.userId = 'user-free'
    next()
  })

  const previousService = setMock(servicePath, {
    isAdaptiveEnabled: () => true,
    startAdaptiveSession: async ({ userId, payload }) => ({
      sessionId: 'session-free-1',
      userId,
      mode: payload.mode,
      lessonState: null,
      activeErrors: [],
      unlockStatus: null,
    }),
    submitAdaptiveAttempt: async () => ({ ok: true }),
    finishAdaptiveSession: async () => ({ ok: true }),
    getAdaptiveRecommendation: async () => ({ ok: true }),
  })

  delete require.cache[routePath]

  try {
    const router = require('../routes/adaptive-cours.routes')
    await withRouter('/api/adaptive-cours', router, async (baseUrl) => {
      const start = await requestJson(`${baseUrl}/session/start`, {
        method: 'POST',
        body: JSON.stringify({
          niveau: 'B1',
          mode: 'free',
          objectif: 'PARLER',
        }),
      })

      assert.equal(start.status, 200)
      assert.equal(start.body.sessionId, 'session-free-1')
      assert.equal(start.body.userId, 'user-free')
      assert.equal(start.body.mode, 'free')
      assert.equal(start.body.lessonState, null)
    })
  } finally {
    restoreMock(authPath, previousAuth)
    restoreMock(servicePath, previousService)
    delete require.cache[routePath]
  }
})

test('GET /api/cours/:niveau/lecons returns unlock and pedagogic progression fields', async () => {
  const authPath = require.resolve('../middleware/auth.middleware')
  const prismaPath = require.resolve('../prisma/client')
  const progressPath = require.resolve('../services/lessonProgress.service')
  const routePath = require.resolve('../routes/cours.routes')

  const previousAuth = setMock(authPath, (req, res, next) => {
    req.userId = 'user-cours'
    next()
  })

  const previousPrisma = setMock(prismaPath, {
    progression: {
      findMany: async () => ([
        {
          leconId: 'a1-1',
          complete: true,
          score: 88,
          xpEarned: 112,
          xpRequired: 100,
          masteryScore: 88,
          errorRate: 12,
          revisionRequired: false,
          unlockedAt: new Date('2026-03-20T09:00:00.000Z'),
          lastAttemptAt: new Date('2026-03-20T09:30:00.000Z'),
        },
      ]),
    },
  })

  const previousProgress = setMock(progressPath, {
    buildLevelUnlockMap: async () => new Map([
      ['a1-1', { unlocked: true, lockedReason: null }],
      ['a1-2', { unlocked: false, lockedReason: 'terminez la lecon precedente' }],
    ]),
    syncLessonProgression: async () => null,
    ensureProgressionRecord: async () => null,
    normalizeProgression: (progression) => ({ ...progression }),
  })

  delete require.cache[routePath]

  try {
    const router = require('../routes/cours.routes')
    await withRouter('/api/cours', router, async (baseUrl) => {
      const response = await requestJson(`${baseUrl}/A1/lecons`, { method: 'GET' })
      assert.equal(response.status, 200)
      assert.ok(Array.isArray(response.body))
      assert.ok(response.body.length > 1)

      const firstLesson = response.body.find((lesson) => lesson.id === 'a1-1')
      const secondLesson = response.body.find((lesson) => lesson.id === 'a1-2')

      assert.equal(firstLesson.unlocked, true)
      assert.equal(firstLesson.complete, true)
      assert.equal(firstLesson.xpEarned, 112)
      assert.equal(firstLesson.xpRequired, 100)
      assert.equal(firstLesson.masteryScore, 88)
      assert.equal(firstLesson.errorRate, 12)
      assert.equal(firstLesson.revisionRequired, false)

      assert.equal(secondLesson.unlocked, false)
      assert.equal(secondLesson.lockedReason, 'terminez la lecon precedente')
      assert.equal(secondLesson.xpEarned, 0)
      assert.equal(secondLesson.masteryScore, 0)
      assert.equal(secondLesson.errorRate, 0)
    })
  } finally {
    restoreMock(authPath, previousAuth)
    restoreMock(prismaPath, previousPrisma)
    restoreMock(progressPath, previousProgress)
    delete require.cache[routePath]
  }
})
