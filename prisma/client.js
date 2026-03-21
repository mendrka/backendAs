const { PrismaClient } = require('@prisma/client')

// Singleton PrismaClient - evite de recreer une instance a chaque import (utile avec nodemon)
const globalForPrisma = globalThis

const prisma = globalForPrisma.__eamPrisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error'] : ['error'],
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__eamPrisma = prisma
}

module.exports = prisma

