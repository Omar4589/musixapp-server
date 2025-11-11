import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";
import { buildHome } from "../services/discovery/home.js";

const router = express.Router();

const PrefsSchema = z.object({
  storefront: z.string().min(2).max(5).optional(), // e.g., 'us', 'mx', 'jp'
  locale: z.string().optional(), // 'en-US', etc (optional signal)
});

router.get("/discovery/home", requireAuth, async (req, res) => {
  console.log("[discovery] hit route", {
    userId: req.user?._id,
    storefront: req.query.storefront,
    locale: req.query.locale,
  });

  const parsed = PrefsSchema.safeParse(req.query || {});
  const storefront = parsed.success ? parsed.data.storefront || "us" : "us";
  const locale = parsed.success ? parsed.data.locale || null : null;

  const result = await buildHome({
    user: req.user,
    storefront,
    locale,
  });

  return res.json(result); // { rows: [...] }
});

export default router;
