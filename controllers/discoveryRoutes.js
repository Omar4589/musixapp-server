// controllers/discoveryRoutes.js
import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";
import { buildHome } from "../services/discovery/home.js";

const router = express.Router();

const QuerySchema = z.object({
  storefront: z.string().min(2).max(5).optional(),
  locale: z.string().optional(),
  provider: z.string().optional(), // e.g., 'spotify' or 'apple'
});

router.get("/discovery/home", requireAuth, async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query || {});
  const storefront = parsed.success ? parsed.data.storefront || "us" : "us";
  const locale = parsed.success ? parsed.data.locale || null : null;
  const providerQuery = parsed.success ? parsed.data.provider || null : null;

  const provider =
    providerQuery ||
    req.user?.activeProvider ||
    (req.user?.providers?.apple?.musicUserToken
      ? "apple"
      : req.user?.providers?.spotify?.refreshToken
      ? "spotify"
      : null);

  if (!provider) {
    return res.status(400).json({
      message: "No music provider linked. Link a provider to continue.",
      rows: [],
    });
  }

  console.log("[discovery] building home", {
    userId: req.user._id,
    storefront,
    locale,
    provider,
  });

  const result = await buildHome({
    user: req.user,
    storefront,
    locale,
    provider,
  });

  return res.json(result); // { rows: [...] }
});

export default router;
