const prisma = require('../prisma/client')

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase()

  if (!email) {
    console.error('Usage: npm run admin:promote -- user@example.com')
    process.exit(1)
  }

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    console.error(`Utilisateur introuvable: ${email}`)
    process.exit(1)
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { role: 'ADMIN' },
  })

  console.log(`Role ADMIN attribue a ${email}`)
}

main()
  .catch((error) => {
    console.error('Promotion admin impossible:', error.message)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
