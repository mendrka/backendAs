// Toujours charger le .env du dossier backend, meme si on lance le serveur depuis la racine.
require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const express    = require('express')
const http       = require('http')
const { Server } = require('socket.io')
const cors       = require('cors')
const morgan     = require('morgan')
const path       = require('path')
const { initDb, getDbStatus } = require('./prisma/initDb')

// ── Routes ────────────────────────────────────────────────
const authRoutes     = require('./routes/auth.routes')
const coursRoutes    = require('./routes/cours.routes')
const adaptiveCoursRoutes = require('./routes/adaptive-cours.routes')
const sprechenRoutes = require('./routes/sprechen.routes')
const chatRoutes     = require('./routes/chat.routes')
const userRoutes     = require('./routes/user.routes')
const progressionRoutes = require('./routes/progression.routes')
const statsRoutes    = require('./routes/stats.routes')
const gamificationRoutes = require('./routes/gamification.routes')

// ── Sockets ───────────────────────────────────────────────
const sprechenSocket = require('./socket/sprechen.socket')
const chatSocket     = require('./socket/chat.socket')

// ── Init Express ──────────────────────────────────────────
const app    = express()
const server = http.createServer(app)

// ── Socket.io ─────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin:      process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
    methods:     ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})

// Monter les namespaces Socket.io
sprechenSocket(io)
chatSocket(io)

// ── Middleware globaux ─────────────────────────────────────
app.use(cors({
  origin:      process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
}))
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

// Logs HTTP (seulement en développement)
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'))
}

// ── Health check ──────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:  'OK',
    service: 'EAM Backend',
    version: '1.0.0',
    env:     process.env.NODE_ENV || 'development',
    uptime:  Math.round(process.uptime()),
    db:      getDbStatus(),
  })
})

// ── Routes API ────────────────────────────────────────────
app.use('/api/auth',     authRoutes)
app.use('/api/cours',    coursRoutes)
app.use('/api/adaptive-cours', adaptiveCoursRoutes)
app.use('/api/sprechen', sprechenRoutes)
app.use('/api/chat',     chatRoutes)
app.use('/api/user',     userRoutes)
app.use('/api/stats',    statsRoutes)
app.use('/api/gamification', gamificationRoutes)
// Compat: anciens appels front /api/progression/...
app.use('/api/progression', progressionRoutes)

// ── Gestion erreurs 404 ───────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Route introuvable',
    path:  req.path,
  })
})

// ── Gestion erreurs globale ───────────────────────────────
app.use((err, req, res, next) => {
  // Erreur JSON invalide (body-parser / express.json)
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'JSON invalide',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    })
  }

  console.error('[Server Error]', err.message)
  res.status(err.status || 500).json({
    error:   process.env.NODE_ENV === 'production' ? 'Erreur serveur' : err.message,
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  })
})

// ── Démarrage ─────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3001

// Log propre si le port est deja pris (nodemon peut laisser un process zombie)
server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`[Server] Port ${PORT} deja utilise. Ferme l'ancien process puis relance.`)
  } else {
    console.error('[Server] Erreur serveur:', err)
  }
  process.exit(1)
})

initDb()
  .then(() => {
    const dbStatus = getDbStatus()
    server.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════╗
║     EAM Backend — Serveur démarré   ║
╠══════════════════════════════════════╣
║  Port    : ${PORT}                       ║
║  Env     : ${(process.env.NODE_ENV || 'development').padEnd(12)}          ║
║  DB      : ${(dbStatus.ok ? 'Connectee' : 'Mode degrade').padEnd(12)}          ║
║  Socket  : /sprechen + /chat        ║
╚══════════════════════════════════════╝
  `)
    })
  })
  .catch((err) => {
    console.error('[Server] Demarrage impossible:', err)
    process.exit(1)
  })

module.exports = { app, server, io }
