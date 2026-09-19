import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import journeyRouter from "./routes/journey.js";
import trainRouter from "./routes/train.js";
import geocodeRouter from "./routes/geocode.js";
import multimodalRouter from "./routes/multimodal.js";
import bicycleRouter from "./routes/bicycle.js";
import busRouter from "./routes/bus.js";

// Reads .env from the repository root (where .env.example lives) and, if present, from app/backend/.env.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: [path.resolve(here, "../../.env"), path.resolve(here, ".env")], quiet: true });

const app = express();

// In dev, CORS_ORIGIN is unset so all origins are allowed (fine for local testing).
// In production, set CORS_ORIGIN to your deployed frontend's URL (comma-separated
// for multiple), so only your own app can call this API.
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : true;
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// All train-related endpoints (alerts, crowd density, door density) live here
app.use("/api/train", trainRouter);
app.use("/api/journey", journeyRouter);
app.use("/api/geocode", geocodeRouter);
app.use("/api/journey", multimodalRouter);
app.use("/api/bicycle", bicycleRouter);
app.use("/api/bus", busRouter);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// In production one service serves the built frontend as well as the API (see mrt-app/Dockerfile), so the browser
// talks to a single origin and no CORS or separate hosting is needed. In local development the Vite dev server
// serves the frontend, so this only switches on when a build exists at ../frontend/dist.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../frontend/dist");
if (existsSync(path.join(distDir, "index.html"))) {
  app.use(
    express.static(distDir, {
      setHeaders(res, filePath) {
        // Vite fingerprints everything under /assets, so it can be cached for a year; the HTML must always be re-checked.
        res.setHeader(
          "Cache-Control",
          filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache"
        );
      },
    })
  );
  // Single-page app: every non-API path that isn't a file returns index.html so client-side routes (/train, /saved...) work on refresh.
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(distDir, "index.html")));
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
  if (!process.env.LTA_ACCOUNT_KEY || process.env.LTA_ACCOUNT_KEY === "your_lta_datamall_key_here") {
    console.warn("⚠️  LTA_ACCOUNT_KEY is not set in .env — /api/train/alerts will fail until you add it.");
  }
  if (
    !process.env.ONEMAP_EMAIL ||
    process.env.ONEMAP_EMAIL === "paste_your_onemap_login_email_here" ||
    !process.env.ONEMAP_PASSWORD ||
    process.env.ONEMAP_PASSWORD === "paste_your_onemap_login_password_here"
  ) {
    console.warn("ONEMAP_EMAIL/ONEMAP_PASSWORD are not set in .env — /api/geocode/search will fail until you add them.");
  }
});
