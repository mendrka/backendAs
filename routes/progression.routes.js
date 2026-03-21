const express = require("express");
const router = express.Router();
const prisma = require("../prisma/client");
const authMiddleware = require("../middleware/auth.middleware");

// Routes "progression" (compat front ancien)
router.use(authMiddleware);

router.get("/", async (req, res) => {
  try {
    const progressions = await prisma.progression.findMany({
      where: { userId: req.userId },
      orderBy: { updatedAt: "desc" },
    });
    res.json({ progressions });
  } catch (err) {
    console.error("[Progression] Erreur:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const [total, completed, avg] = await Promise.all([
      prisma.progression.count({ where: { userId: req.userId } }),
      prisma.progression.count({ where: { userId: req.userId, complete: true } }),
      prisma.progression.aggregate({
        where: { userId: req.userId, complete: true },
        _avg: { score: true },
      }),
    ]);
    res.json({
      stats: {
        leconsTotales: total,
        leconsCompletes: completed,
        scoreMoyen: Math.round(avg._avg.score || 0),
      },
    });
  } catch (err) {
    console.error("[Progression] Erreur stats:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/cours/:coursId", async (req, res) => {
  const coursId = String(req.params.coursId || "").toUpperCase();
  try {
    const progressions = await prisma.progression.findMany({
      where: {
        userId: req.userId,
        leconId: { startsWith: coursId.toLowerCase() },
      },
    });
    res.json({ coursId, progressions });
  } catch (err) {
    console.error("[Progression] Erreur cours:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/lecon/:leconId/complete", async (req, res) => {
  const { leconId } = req.params;
  const score = Math.min(100, Math.max(0, Number(req.body?.score ?? 100)));
  try {
    const progression = await prisma.progression.upsert({
      where: { userId_leconId: { userId: req.userId, leconId } },
      update: { complete: true, score, updatedAt: new Date() },
      create: { userId: req.userId, leconId, complete: true, score },
    });
    res.json({ progression });
  } catch (err) {
    console.error("[Progression] Erreur complete:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Endpoint optionnel pour compat (pas utilise dans la v1)
router.post("/exercice/:exerciceId", async (req, res) => {
  res.status(204).end();
});

module.exports = router;
