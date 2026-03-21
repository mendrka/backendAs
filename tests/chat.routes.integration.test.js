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

test('chat direct routes expose users, messages and private send contract', async () => {
  const authPath = require.resolve('../middleware/auth.middleware')
  const prismaPath = require.resolve('../prisma/client')
  const routePath = require.resolve('../routes/chat.routes')

  const previousAuth = setMock(authPath, (req, res, next) => {
    req.userId = 'user-self'
    next()
  })

  const sentPayloads = []
  const previousPrisma = setMock(prismaPath, {
    user: {
      findMany: async () => ([
        {
          id: 'user-b',
          prenom: 'Miora',
          nom: 'R',
          email: 'miora@example.com',
          niveau: 'A2',
          objectif: 'etudes',
          createdAt: new Date('2026-03-20T09:00:00.000Z'),
        },
        {
          id: 'user-c',
          prenom: 'Haja',
          nom: 'R',
          email: 'haja@example.com',
          niveau: 'B1',
          objectif: 'ausbildung',
          createdAt: new Date('2026-03-20T08:00:00.000Z'),
        },
      ]),
      findUnique: async ({ where }) => {
        if (where.id === 'user-b') {
          return {
            id: 'user-b',
            prenom: 'Miora',
            nom: 'R',
            niveau: 'A2',
            objectif: 'etudes',
            createdAt: new Date('2026-03-20T09:00:00.000Z'),
          }
        }
        return null
      },
    },
    directMessage: {
      findMany: async ({ where }) => {
        const serialized = JSON.stringify(where)
        if (serialized.includes('"user-b"')) {
          return [
            {
              id: 'dm-2',
              senderId: 'user-b',
              recipientId: 'user-self',
              texte: 'Bonjour Codex',
              createdAt: new Date('2026-03-20T10:02:00.000Z'),
              sender: { prenom: 'Miora', nom: 'R' },
            },
            {
              id: 'dm-1',
              senderId: 'user-self',
              recipientId: 'user-b',
              texte: 'Salut Miora',
              createdAt: new Date('2026-03-20T10:00:00.000Z'),
              sender: { prenom: 'Codex', nom: 'T' },
            },
          ]
        }

        return [
          {
            id: 'dm-2',
            senderId: 'user-b',
            recipientId: 'user-self',
            texte: 'Bonjour Codex',
            createdAt: new Date('2026-03-20T10:02:00.000Z'),
            sender: {
              id: 'user-b',
              prenom: 'Miora',
              nom: 'R',
              niveau: 'A2',
              objectif: 'etudes',
              createdAt: new Date('2026-03-20T09:00:00.000Z'),
            },
            recipient: {
              id: 'user-self',
              prenom: 'Codex',
              nom: 'T',
              niveau: 'A1',
              objectif: 'autre',
              createdAt: new Date('2026-03-20T07:00:00.000Z'),
            },
          },
        ]
      },
      create: async ({ data }) => {
        sentPayloads.push(data)
        return {
          id: 'dm-created',
          senderId: data.senderId,
          recipientId: data.recipientId,
          texte: data.texte,
          createdAt: new Date('2026-03-20T10:05:00.000Z'),
          sender: { prenom: 'Codex', nom: 'T' },
        }
      },
    },
    chatMessage: {
      findMany: async () => [],
      create: async () => null,
    },
  })

  delete require.cache[routePath]

  try {
    const router = require('../routes/chat.routes')
    await withRouter('/api/chat', router, async (baseUrl) => {
      const users = await requestJson(`${baseUrl}/direct/users`, { method: 'GET' })
      assert.equal(users.status, 200)
      assert.equal(users.body.users.length, 2)
      assert.equal(users.body.users[0].id, 'user-b')
      assert.equal(users.body.users[0].hasConversation, true)
      assert.equal(users.body.conversations[0].user.id, 'user-b')

      const messages = await requestJson(`${baseUrl}/direct/user-b/messages`, { method: 'GET' })
      assert.equal(messages.status, 200)
      assert.equal(messages.body.partner.id, 'user-b')
      assert.equal(messages.body.messages.length, 2)
      assert.equal(messages.body.messages[0].scope, 'direct')
      assert.equal(messages.body.messages[1].userId, 'user-b')

      const send = await requestJson(`${baseUrl}/direct/user-b/messages`, {
        method: 'POST',
        body: JSON.stringify({ texte: 'Message prive test' }),
      })
      assert.equal(send.status, 201)
      assert.equal(send.body.message.id, 'dm-created')
      assert.equal(send.body.message.recipientId, 'user-b')
    })

    assert.deepEqual(sentPayloads, [{
      senderId: 'user-self',
      recipientId: 'user-b',
      texte: 'Message prive test',
    }])
  } finally {
    restoreMock(authPath, previousAuth)
    restoreMock(prismaPath, previousPrisma)
    delete require.cache[routePath]
  }
})
