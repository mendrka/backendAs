const express = require('express')

const prisma = require('../prisma/client')
const authMiddleware = require('../middleware/auth.middleware')

const router = express.Router()

const PUBLIC_CANAUX = [
  { id: 'general', emoji: '💬', nom: 'General', description: 'Discussions generales' },
  { id: 'a1-a2', emoji: '🌱', nom: 'A1 & A2', description: 'Debutants' },
  { id: 'b1-b2', emoji: '🌳', nom: 'B1 & B2', description: 'Intermediaires' },
  { id: 'c1-c2', emoji: '🏆', nom: 'C1 & C2', description: 'Avances' },
  { id: 'ausbildung', emoji: '🎓', nom: 'Ausbildung', description: 'Formation professionnelle' },
  { id: 'aupair', emoji: '👶', nom: 'Au Pair', description: 'Sejour famille' },
  { id: 'fsj-bfd', emoji: '🤝', nom: 'FSJ & BFD', description: 'Service volontaire' },
  { id: 'visa', emoji: '✈️', nom: 'Visa & Demarches', description: 'Procedures administratives' },
  { id: 'temoignages', emoji: '⭐', nom: 'Temoignages', description: 'Experiences en Allemagne' },
]

const USER_SELECT = {
  id: true,
  prenom: true,
  nom: true,
  niveau: true,
  objectif: true,
  createdAt: true,
}

router.use(authMiddleware)

function normalizeText(value, maxLength = 1000) {
  return String(value || '').trim().slice(0, maxLength)
}

function formatPublicMessage(message) {
  return {
    id: message.id,
    texte: message.texte,
    userId: message.userId,
    prenom: message.user?.prenom || '',
    nom: message.user?.nom || '',
    createdAt: message.createdAt.toISOString(),
    type: 'message',
    scope: 'public',
  }
}

function formatDirectMessage(message) {
  return {
    id: message.id,
    texte: message.texte,
    userId: message.senderId,
    recipientId: message.recipientId,
    prenom: message.sender?.prenom || '',
    nom: message.sender?.nom || '',
    createdAt: message.createdAt.toISOString(),
    type: 'message',
    scope: 'direct',
  }
}

function matchesQuery(user, query) {
  if (!query) return true
  const haystack = [
    user?.prenom,
    user?.nom,
    user?.email,
    user?.niveau,
    user?.objectif,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes(query)
}

function pickOtherParticipant(message, userId) {
  if (message.senderId === userId) return message.recipient
  return message.sender
}

function buildConversationSummaries(messages, userId) {
  const items = Array.isArray(messages) ? messages : []
  const map = new Map()

  for (const message of items) {
    const otherUser = pickOtherParticipant(message, userId)
    if (!otherUser?.id || map.has(otherUser.id)) continue

    map.set(otherUser.id, {
      user: {
        id: otherUser.id,
        prenom: otherUser.prenom,
        nom: otherUser.nom,
        niveau: otherUser.niveau,
        objectif: otherUser.objectif,
        createdAt: otherUser.createdAt,
      },
      lastMessagePreview: message.texte,
      lastMessageAt: message.createdAt.toISOString(),
      lastMessageFromSelf: message.senderId === userId,
    })
  }

  return Array.from(map.values()).sort((left, right) => (
    new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime()
  ))
}

async function findTargetUser(targetUserId, currentUserId) {
  const safeId = String(targetUserId || '').trim()
  if (!safeId) throw new Error('Utilisateur cible manquant')
  if (safeId === currentUserId) throw new Error('Impossible de discuter avec soi-meme')

  const partner = await prisma.user.findUnique({
    where: { id: safeId },
    select: USER_SELECT,
  })

  if (!partner) throw new Error('Utilisateur introuvable')
  return partner
}

router.get('/canaux', async (req, res) => {
  res.json({ canaux: PUBLIC_CANAUX })
})

router.get('/canaux/:canalId/messages', async (req, res) => {
  const { canalId } = req.params
  const page = parseInt(req.query.page, 10) || 1
  const limit = 20
  const skip = (page - 1) * limit

  try {
    const messages = await prisma.chatMessage.findMany({
      where: { canalId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        user: { select: { prenom: true, nom: true } },
      },
    })

    res.json({
      messages: messages.reverse().map(formatPublicMessage),
      page,
      hasMore: messages.length === limit,
    })
  } catch (err) {
    console.error('[Chat] Erreur messages canal:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.post('/canaux/:canalId/messages', async (req, res) => {
  const { canalId } = req.params
  const texte = normalizeText(req.body?.texte)

  if (!texte) {
    return res.status(400).json({ error: 'Message vide' })
  }

  try {
    const message = await prisma.chatMessage.create({
      data: {
        canalId,
        texte,
        userId: req.userId,
      },
      include: {
        user: { select: { prenom: true, nom: true } },
      },
    })

    res.status(201).json({ message: formatPublicMessage(message) })
  } catch (err) {
    console.error('[Chat] Erreur envoi canal:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/direct/conversations', async (req, res) => {
  try {
    const messages = await prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: req.userId },
          { recipientId: req.userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        sender: { select: USER_SELECT },
        recipient: { select: USER_SELECT },
      },
    })

    res.json({
      conversations: buildConversationSummaries(messages, req.userId),
    })
  } catch (err) {
    console.error('[Chat] Erreur conversations directes:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/direct/users', async (req, res) => {
  const query = normalizeText(req.query.q, 120).toLowerCase()

  try {
    const [users, messages] = await Promise.all([
      prisma.user.findMany({
        where: { id: { not: req.userId } },
        select: {
          ...USER_SELECT,
          email: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 120,
      }),
      prisma.directMessage.findMany({
        where: {
          OR: [
            { senderId: req.userId },
            { recipientId: req.userId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          sender: { select: USER_SELECT },
          recipient: { select: USER_SELECT },
        },
      }),
    ])

    const conversationList = buildConversationSummaries(messages, req.userId)
    const conversationByUserId = new Map(conversationList.map((item) => [item.user.id, item]))
    const matchedUsers = users
      .filter((user) => matchesQuery(user, query))
      .map((user) => {
        const conversation = conversationByUserId.get(user.id)
        return {
          id: user.id,
          prenom: user.prenom,
          nom: user.nom,
          niveau: user.niveau,
          objectif: user.objectif,
          hasConversation: Boolean(conversation),
          lastMessagePreview: conversation?.lastMessagePreview || null,
          lastMessageAt: conversation?.lastMessageAt || null,
          lastMessageFromSelf: conversation?.lastMessageFromSelf || false,
        }
      })
      .sort((left, right) => {
        const leftTs = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0
        const rightTs = right.lastMessageAt ? new Date(right.lastMessageAt).getTime() : 0
        if (leftTs !== rightTs) return rightTs - leftTs
        return `${left.prenom} ${left.nom}`.localeCompare(`${right.prenom} ${right.nom}`)
      })

    res.json({
      users: matchedUsers,
      conversations: conversationList,
    })
  } catch (err) {
    console.error('[Chat] Erreur annuaire direct:', err)
    res.status(500).json({ error: 'Erreur serveur' })
  }
})

router.get('/direct/:targetUserId/messages', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1
  const limit = 20
  const skip = (page - 1) * limit

  try {
    const partner = await findTargetUser(req.params.targetUserId, req.userId)
    const messages = await prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: req.userId, recipientId: partner.id },
          { senderId: partner.id, recipientId: req.userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        sender: { select: { prenom: true, nom: true } },
      },
    })

    res.json({
      partner: {
        id: partner.id,
        prenom: partner.prenom,
        nom: partner.nom,
        niveau: partner.niveau,
        objectif: partner.objectif,
      },
      messages: messages.reverse().map(formatDirectMessage),
      page,
      hasMore: messages.length === limit,
    })
  } catch (err) {
    const status = err.message === 'Utilisateur introuvable' || err.message === 'Impossible de discuter avec soi-meme'
      ? 400
      : 500

    console.error('[Chat] Erreur messages directs:', err)
    res.status(status).json({ error: err.message || 'Erreur serveur' })
  }
})

router.post('/direct/:targetUserId/messages', async (req, res) => {
  const texte = normalizeText(req.body?.texte)
  if (!texte) {
    return res.status(400).json({ error: 'Message vide' })
  }

  try {
    const partner = await findTargetUser(req.params.targetUserId, req.userId)
    const message = await prisma.directMessage.create({
      data: {
        senderId: req.userId,
        recipientId: partner.id,
        texte,
      },
      include: {
        sender: { select: { prenom: true, nom: true } },
      },
    })

    res.status(201).json({
      partner: {
        id: partner.id,
        prenom: partner.prenom,
        nom: partner.nom,
        niveau: partner.niveau,
        objectif: partner.objectif,
      },
      message: formatDirectMessage(message),
    })
  } catch (err) {
    const status = err.message === 'Utilisateur introuvable' || err.message === 'Impossible de discuter avec soi-meme'
      ? 400
      : 500

    console.error('[Chat] Erreur envoi direct:', err)
    res.status(status).json({ error: err.message || 'Erreur serveur' })
  }
})

module.exports = router
