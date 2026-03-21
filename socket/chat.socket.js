const jwt = require('jsonwebtoken')

const onlineUsers = {}
const connectedUsers = new Map()

const JWT_SECRET = process.env.JWT_SECRET || 'eam_dev_secret'

function getUserRoom(userId) {
  return `user:${userId}`
}

function formatDirectMessageRecord(record, socket) {
  return {
    id: record.id,
    texte: record.texte,
    userId: record.senderId,
    recipientId: record.recipientId,
    prenom: socket.prenom,
    nom: socket.nom,
    createdAt: record.createdAt.toISOString(),
    type: 'message',
    scope: 'direct',
  }
}

function chatSocket(io) {
  const ns = io.of('/chat')

  ns.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Non authentifie'))

    try {
      const payload = jwt.verify(token, JWT_SECRET)
      socket.userId = payload.userId
      socket.prenom = payload.prenom || 'Apprenant'
      socket.nom = payload.nom || ''
      return next()
    } catch {
      return next(new Error('Token invalide'))
    }
  })

  ns.on('connection', (socket) => {
    const personalRoom = getUserRoom(socket.userId)
    socket.join(personalRoom)

    if (!connectedUsers.has(socket.userId)) {
      connectedUsers.set(socket.userId, new Set())
    }
    connectedUsers.get(socket.userId).add(socket.id)

    console.log(`[Chat] ${socket.prenom} connecte`)

    socket.on('chat:join', ({ canalId }) => {
      if (!canalId) return

      socket.join(canalId)
      if (!onlineUsers[canalId]) onlineUsers[canalId] = new Set()
      onlineUsers[canalId].add(socket.userId)

      socket.to(canalId).emit('chat:user_joined', {
        canalId,
        userId: socket.userId,
        prenom: socket.prenom,
      })

      const usersInCanal = Array.from(ns.adapter.rooms.get(canalId) || [])
        .map((socketId) => ns.sockets.get(socketId))
        .filter(Boolean)
        .map((roomSocket) => ({
          userId: roomSocket.userId,
          prenom: roomSocket.prenom,
        }))

      socket.emit('chat:online_users', {
        canalId,
        users: usersInCanal,
        count: onlineUsers[canalId].size,
      })
    })

    socket.on('chat:leave', ({ canalId }) => {
      if (!canalId) return

      socket.leave(canalId)
      removeFromCanal(socket, canalId)
      socket.to(canalId).emit('chat:user_left', {
        canalId,
        userId: socket.userId,
        prenom: socket.prenom,
      })
    })

    socket.on('chat:message', async ({ canalId, texte }) => {
      const safeText = String(texte || '').trim().slice(0, 1000)
      if (!canalId || !safeText) return

      const message = {
        id: `${Date.now()}_${socket.userId}`,
        canalId,
        texte: safeText,
        userId: socket.userId,
        prenom: socket.prenom,
        nom: socket.nom,
        createdAt: new Date().toISOString(),
        type: 'message',
        scope: 'public',
      }

      socket.to(canalId).emit('chat:message', message)

      try {
        const prisma = require('../prisma/client')
        await prisma.chatMessage.create({
          data: {
            canalId,
            texte: message.texte,
            userId: socket.userId,
            createdAt: new Date(message.createdAt),
          },
        })
      } catch (err) {
        console.error('[Chat] Erreur sauvegarde canal:', err.message)
      }
    })

    socket.on('chat:direct_message', async ({ recipientId, texte }) => {
      const safeRecipientId = String(recipientId || '').trim()
      const safeText = String(texte || '').trim().slice(0, 1000)
      if (!safeRecipientId || !safeText || safeRecipientId === socket.userId) return

      try {
        const prisma = require('../prisma/client')
        const recipient = await prisma.user.findUnique({
          where: { id: safeRecipientId },
          select: { id: true },
        })
        if (!recipient) return

        const record = await prisma.directMessage.create({
          data: {
            senderId: socket.userId,
            recipientId: safeRecipientId,
            texte: safeText,
          },
        })

        const payload = formatDirectMessageRecord(record, socket)
        ns.to(getUserRoom(safeRecipientId)).emit('chat:direct_message', payload)
        socket.to(getUserRoom(socket.userId)).emit('chat:direct_message', payload)
      } catch (err) {
        console.error('[Chat] Erreur message direct:', err.message)
      }
    })

    socket.on('chat:typing', ({ canalId }) => {
      if (!canalId) return
      socket.to(canalId).emit('chat:typing', {
        userId: socket.userId,
        prenom: socket.prenom,
      })
    })

    socket.on('chat:direct_typing', ({ recipientId }) => {
      const safeRecipientId = String(recipientId || '').trim()
      if (!safeRecipientId || safeRecipientId === socket.userId) return

      ns.to(getUserRoom(safeRecipientId)).emit('chat:direct_typing', {
        userId: socket.userId,
        prenom: socket.prenom,
        recipientId: safeRecipientId,
      })
    })

    socket.on('disconnect', () => {
      console.log(`[Chat] ${socket.prenom} deconnecte`)

      Object.keys(onlineUsers).forEach((canalId) => {
        if (onlineUsers[canalId]?.has(socket.userId)) {
          removeFromCanal(socket, canalId)
          ns.to(canalId).emit('chat:user_left', {
            canalId,
            userId: socket.userId,
            prenom: socket.prenom,
          })
        }
      })

      const userSockets = connectedUsers.get(socket.userId)
      if (userSockets) {
        userSockets.delete(socket.id)
        if (userSockets.size === 0) {
          connectedUsers.delete(socket.userId)
        }
      }
    })
  })

  function removeFromCanal(socket, canalId) {
    if (onlineUsers[canalId]) {
      onlineUsers[canalId].delete(socket.userId)
      if (onlineUsers[canalId].size === 0) delete onlineUsers[canalId]
    }
  }
}

module.exports = chatSocket
