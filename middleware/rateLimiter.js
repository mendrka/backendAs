const { ipKeyGenerator, rateLimit } = require('express-rate-limit')

const sprechenRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id || req.userId || ipKeyGenerator(req.ip),
  message: { error: 'Trop de requetes. Attends 1 minute.' },
})

module.exports = {
  sprechenRateLimit,
}
