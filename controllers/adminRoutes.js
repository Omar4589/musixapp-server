import express from "express";
import { User } from "../models/User.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { rateLimit } from "../middlewares/ratelimit.js";

const router = express.Router();

// 60s window, 10 calls, keyed by admin user id
const rlLogout = rateLimit({
  windowSec: 60,
  max: 10,
  keyer: (req) => req.user?._id || req.ip,
});

// POST /api/admin/users/:id/logout-all — admin forced sign-out everywhere
router.post(
  "/admin/users/:id/logout-all",
  requireAuth,
  requireAdmin,
  rlLogout,
  async (req, res) => {
    try {
      const { id } = req.params;
      const updated = await User.findByIdAndUpdate(
        id,
        { $inc: { tokenVersion: 1 } },
        { new: false }
      );
      if (!updated) return res.status(404).json({ message: "User not found" });
      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ message: "Admin logout-all failed" });
    }
  }
);

export default router;
