const { PrismaClient } = require('@prisma/client')
const bcrypt           = require('bcrypt')

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding EAM database...')

  // ── Utilisateurs de test ───────────────────────────────
  const password = await bcrypt.hash('password123', 12)

  const users = await Promise.all([
    prisma.user.upsert({
      where:  { email: 'ravo@eam.mg' },
      update: {},
      create: {
        prenom:   'Ravo',
        nom:      'Rakoto',
        email:    'ravo@eam.mg',
        password,
        niveau:   'A2',
        objectif: 'ausbildung',
      }
    }),
    prisma.user.upsert({
      where:  { email: 'miora@eam.mg' },
      update: {},
      create: {
        prenom:   'Miora',
        nom:      'Randria',
        email:    'miora@eam.mg',
        password,
        niveau:   'B1',
        objectif: 'aupair',
      }
    }),
    prisma.user.upsert({
      where:  { email: 'haja@eam.mg' },
      update: {},
      create: {
        prenom:   'Haja',
        nom:      'Rasolofo',
        email:    'haja@eam.mg',
        password,
        niveau:   'A1',
        objectif: 'fsj',
      }
    }),
  ])

  console.log(`✅ ${users.length} utilisateurs créés`)

  await Promise.all(
    users.map((user, index) =>
      prisma.userStats.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          xp: 120 + index * 80,
          level: 2 + index,
          streakCurrent: 2 + index,
          streakBest: 4 + index,
          badgesCount: 0,
          lastActivityDay: new Date().toISOString().slice(0, 10),
        },
      })
    )
  )
  console.log('✅ statistiques gamification créées')

  // ── Progressions de test (pour Ravo) ──────────────────
  const ravo = users[0]
  const progressions = []
  for (let i = 1; i <= 18; i++) {
    progressions.push(
      prisma.progression.upsert({
        where:  { userId_leconId: { userId: ravo.id, leconId: `a1-${i}` } },
        update: {},
        create: {
          userId:   ravo.id,
          leconId:  `a1-${i}`,
          complete: true,
          score:    75 + Math.floor(Math.random() * 25),
        }
      })
    )
  }
  // 5 leçons A2
  for (let i = 1; i <= 5; i++) {
    progressions.push(
      prisma.progression.upsert({
        where:  { userId_leconId: { userId: ravo.id, leconId: `a2-${i}` } },
        update: {},
        create: {
          userId:   ravo.id,
          leconId:  `a2-${i}`,
          complete: true,
          score:    70 + Math.floor(Math.random() * 20),
        }
      })
    )
  }
  await Promise.all(progressions)
  console.log(`✅ ${progressions.length} progressions créées`)

  // ── Messages chat de test ──────────────────────────────
  const chatMessages = [
    { canalId: 'general',    userId: users[0].id, texte: 'Salama! Manao ahoana ianareo? 👋' },
    { canalId: 'general',    userId: users[1].id, texte: 'Tsara misaotra! Vao vita ny lesona A1-5 🎉' },
    { canalId: 'general',    userId: users[2].id, texte: 'Nahomby! Aho koa manomana ny FSJ 🤝' },
    { canalId: 'ausbildung', userId: users[0].id, texte: 'Iza no efa nahavita ny Ausbildung Bewerbung?' },
    { canalId: 'ausbildung', userId: users[1].id, texte: 'Aho! Mila B2 ny orinasa maro. Mianara mafy! 💪' },
  ]

  for (const msg of chatMessages) {
    const existing = await prisma.chatMessage.findFirst({
      where: { canalId: msg.canalId, userId: msg.userId, texte: msg.texte },
      select: { id: true },
    })

    if (!existing) {
      await prisma.chatMessage.create({ data: msg })
    }
  }
  console.log(`✅ ${chatMessages.length} messages chat créés`)

  console.log(`
╔══════════════════════════════════════╗
║        EAM Seed terminé! ✅          ║
╠══════════════════════════════════════╣
║  Comptes de test :                   ║
║  ravo@eam.mg  / password123          ║
║  miora@eam.mg / password123          ║
║  haja@eam.mg  / password123          ║
╚══════════════════════════════════════╝
  `)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
