// ── sprechen.socket.js — Logique Socket.io Sprechen ────────
// Namespace : /sprechen
// Gère : file d'attente, matching, sessions duo

// ── File d'attente par niveau ──────────────────────────────
// { 'A1': [{ socketId, userId, prenom, niveau, joinedAt }], ... }
const queues = {}

// ── Sessions actives ───────────────────────────────────────
// { sessionId: { user1, user2, niveau, startedAt } }
const sessions = {}

// ── Utilitaire : créer un ID de session ───────────────────
const makeSessionId = () => `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// ── Handler principal Sprechen ────────────────────────────
function sprechenSocket(io) {
  const ns = io.of('/sprechen')

  // ── Middleware auth JWT ──
  ns.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Non authentifié'))

    try {
      const jwt     = require('jsonwebtoken')
      const payload = jwt.verify(token, process.env.JWT_SECRET)
      socket.userId = payload.userId
      socket.prenom = payload.prenom || 'Mpianatra'
      next()
    } catch {
      next(new Error('Token invalide'))
    }
  })

  ns.on('connection', (socket) => {
    console.log(`[Sprechen] ${socket.prenom} (${socket.id}) connecté`)

    // ── Rejoindre la file ──
    socket.on('sprechen:join_queue', ({ niveau }) => {
      if (!niveau) return
      socket.niveau = niveau

      // Retirer de toute file existante
      _removeFromAllQueues(socket.id)

      // Initialiser la file du niveau si besoin
      if (!queues[niveau]) queues[niveau] = []

      // Ajouter à la file
      queues[niveau].push({
        socketId: socket.id,
        userId:   socket.userId,
        prenom:   socket.prenom,
        niveau,
        joinedAt: Date.now(),
      })

      console.log(`[Sprechen] File ${niveau}: ${queues[niveau].length} en attente`)

      // Informer tout le monde du nb en attente
      ns.emit('sprechen:queue_update', queues[niveau].length)

      // Tenter le matching
      _tryMatch(ns, niveau)
    })

    // ── Quitter la file ──
    socket.on('sprechen:leave_queue', () => {
      _removeFromAllQueues(socket.id)
      const niveau = socket.niveau
      if (niveau) {
        ns.emit('sprechen:queue_update', (queues[niveau] || []).length)
      }
    })

    // ── Message dans une session ──
    socket.on('sprechen:message', (data) => {
      const sessionId = socket.sessionId
      if (!sessionId || !sessions[sessionId]) return

      const session = sessions[sessionId]
      const partnerId = session.user1.socketId === socket.id
        ? session.user2.socketId
        : session.user1.socketId

      // Transmettre au partenaire
      ns.to(partnerId).emit('sprechen:message', {
        ...data,
        from:    socket.prenom,
        fromId:  socket.userId,
        sentAt:  Date.now(),
      })
    })

    // ── Activité (typing indicator) ──
    socket.on('sprechen:activity', () => {
      const sessionId = socket.sessionId
      if (!sessionId || !sessions[sessionId]) return

      const session = sessions[sessionId]
      const partnerId = session.user1.socketId === socket.id
        ? session.user2.socketId
        : session.user1.socketId

      ns.to(partnerId).emit('sprechen:partner_activity')
    })

    // ── Déconnexion ──
    socket.on('disconnect', () => {
      console.log(`[Sprechen] ${socket.prenom} déconnecté`)
      _removeFromAllQueues(socket.id)

      // Notifier le partenaire si session en cours
      const sessionId = socket.sessionId
      if (sessionId && sessions[sessionId]) {
        const session = sessions[sessionId]
        const partnerId = session.user1.socketId === socket.id
          ? session.user2.socketId
          : session.user1.socketId
        ns.to(partnerId).emit('sprechen:partner_left', { prenom: socket.prenom })
        delete sessions[sessionId]
      }
    })
  })

  // ── Helpers internes ──────────────────────────────────────

  function _removeFromAllQueues(socketId) {
    Object.keys(queues).forEach(niveau => {
      queues[niveau] = queues[niveau].filter(u => u.socketId !== socketId)
    })
  }

  function _tryMatch(ns, niveau) {
    if (!queues[niveau] || queues[niveau].length < 2) return

    // Prendre les 2 premiers en file (FIFO)
    const [user1, user2] = queues[niveau].splice(0, 2)
    const sessionId      = makeSessionId()

    // Enregistrer la session
    sessions[sessionId] = { user1, user2, niveau, startedAt: Date.now() }

    // Marquer les sockets
    const socket1 = ns.sockets.get(user1.socketId)
    const socket2 = ns.sockets.get(user2.socketId)
    if (socket1) socket1.sessionId = sessionId
    if (socket2) socket2.sessionId = sessionId

    console.log(`[Sprechen] Match! ${user1.prenom} ↔ ${user2.prenom} (${niveau})`)

    // Notifier les deux utilisateurs
    ns.to(user1.socketId).emit('sprechen:matched', {
      partner:    { prenom: user2.prenom, userId: user2.userId },
      sessionId,
      niveau,
    })
    ns.to(user2.socketId).emit('sprechen:matched', {
      partner:    { prenom: user1.prenom, userId: user1.userId },
      sessionId,
      niveau,
    })

    // Mettre à jour le compteur de file
    ns.emit('sprechen:queue_update', (queues[niveau] || []).length)
  }
}

module.exports = sprechenSocket
