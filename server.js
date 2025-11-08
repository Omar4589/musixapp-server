import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import hpp from "hpp";
import { connectMongo } from "./config/connection.js";
import routes from "./controllers/index.js";
import { corsOptions } from "./config/cors.js";

const app = express();
app.use(helmet());
app.use(cors(corsOptions));
app.use(hpp());
app.use(express.json({ limit: "512kb" }));

app.get("/healthz", (_req, res) =>
  res.status(200).json({ ok: true, ts: Date.now() })
);
app.use("/api", routes);

// after app.use("/api", routes);
app.use((_req, res) => res.status(404).json({ message: "Not found" }));

// replace your error handler with a version that logs:
app.use((err, _req, res, _next) => {
  console.error("[ERR]", err.status || 500, err.code || "", err.message);
  res
    .status(err.status || 500)
    .json({ message: err.message || "Something went wrong" });
});

const PORT = process.env.PORT || 3001;
connectMongo().then(() =>
  app.listen(PORT, () => console.log(`API on :${PORT}`))
);
