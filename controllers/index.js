// server/controllers/index.js
import express from "express";
import authRoutes from "./authRoutes.js";
import adminRoutes from "./adminRoutes.js";
import providerRoutes from "./providerRoutes.js";
import meRoutes from "./meRoutes.js";
import discoveryRoutes from "./discoveryRoutes.js";

const router = express.Router();

// mount feature routers (paths inside each start with /auth, /admin, etc.)
router.use(authRoutes);
router.use(adminRoutes);
router.use(providerRoutes);
router.use(meRoutes);
router.use(discoveryRoutes);

export default router;
