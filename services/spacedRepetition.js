function calculateSM2(quality, easeFactor = 2.5, interval = 1, repetitions = 0) {
  const boundedQuality = Math.max(0, Math.min(5, Number(quality) || 0))

  let newEaseFactor = easeFactor + (
    0.1 - (5 - boundedQuality) * (0.08 + (5 - boundedQuality) * 0.02)
  )

  if (newEaseFactor < 1.3) {
    newEaseFactor = 1.3
  }

  let newInterval
  if (boundedQuality < 3) {
    newInterval = 1
  } else if (repetitions === 0) {
    newInterval = 1
  } else if (repetitions === 1) {
    newInterval = 6
  } else {
    newInterval = Math.round(interval * newEaseFactor)
  }

  return {
    quality: boundedQuality,
    newEaseFactor,
    newInterval,
  }
}

module.exports = {
  calculateSM2,
}
