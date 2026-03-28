function serviceMonitor(req, res, next) {
  const originalJson = res.json.bind(res)

  res.json = (payload) => {
    if (process.env.NODE_ENV === 'development' && payload?.service) {
      payload._debug = {
        service: payload.service,
        timestamp: Date.now(),
      }
    }

    return originalJson(payload)
  }

  next()
}

module.exports = {
  serviceMonitor,
}
