// controllers/meRoutes.js
import express from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth.js";
import { User } from "../models/User.js";
import { rateLimit } from "../middlewares/ratelimit.js";

const router = express.Router();

const LangEnum = z.enum(["en", "es", "ja"]);
const GenreEnum = z.enum([
  "pop",
  "hiphop",
  "rock",
  "rnb",
  "latin",
  "jpop",
  "kpop",
  "edm",
  "indie",
]);

const PrefsSchema = z.object({
  preferredLanguages: z.array(LangEnum).max(3).optional(),
  genres: z.array(GenreEnum).max(10).optional(),
});

const rlPrefs = rateLimit({
  windowSec: 10,
  max: 10,
  keyer: (req) => String(req.user._id),
});

router.patch("/me/preferences", requireAuth, rlPrefs, async (req, res) => {
  const parsed = PrefsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  const desired = parsed.data;
  const next = {};
  if (desired.preferredLanguages) {
    const langs = [
      ...new Set(desired.preferredLanguages.map((s) => s.toLowerCase())),
    ];
    next["preferences.preferredLanguages"] = langs;
  }
  if (desired.genres) {
    const genres = [...new Set(desired.genres.map((s) => s.toLowerCase()))];
    next["preferences.genres"] = genres;
  }

  const updated = await User.findByIdAndUpdate(
    req.user._id,
    { $set: next },
    { new: true }
  ).lean();

  return res.json({
    ok: true,
    preferences: {
      preferredLanguages: updated?.preferences?.preferredLanguages ?? [],
      genres: updated?.preferences?.genres ?? [],
    },
  });
});

export default router;
