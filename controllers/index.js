// server/controllers/index.js
import express from "express";
import authRoutes from "./authRoutes.js";
import adminRoutes from "./adminRoutes.js";

const router = express.Router();

// mount feature routers (paths inside each start with /auth, /admin, etc.)
router.use(authRoutes);
router.use(adminRoutes);

export default router;
