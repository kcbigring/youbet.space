import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./env";
import { ApiError } from "./lib/errors";
import authRoutes from "./routes/auth";
import groupRoutes from "./routes/groups";
import wagerRoutes from "./routes/wagers";
import userRoutes from "./routes/users";
import systemRoutes from "./routes/system";

export function createApp() {
  if (env.isProduction && !process.env.OTP_PEPPER) {
    console.warn("OTP_PEPPER is not set — login codes are hashed with the default pepper.");
  }

  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins.includes("*") ? true : env.corsOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "100kb" }));

  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      // Health checks and scrapes should never be throttled, and tests should
      // not inherit a request budget from whatever ran before them.
      skip: (req) => req.path === "/health" || req.path === "/metrics" || env.nodeEnv === "test",
    })
  );

  app.use("/", systemRoutes);
  app.use("/auth", authRoutes);
  app.use("/groups", groupRoutes);
  app.use("/wagers", wagerRoutes);
  app.use("/users", userRoutes);

  app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      return res.status(error.status).json({ ok: false, error: error.message, details: error.details });
    }

    // Prisma's "record not found" surfaces as a 404 rather than a server error.
    const code = (error as { code?: string }).code;
    if (code === "P2025") return res.status(404).json({ ok: false, error: "Not found" });
    if (code === "P2002") return res.status(409).json({ ok: false, error: "Already exists" });

    console.error("Unhandled error", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({
      ok: false,
      error: env.isProduction ? "Internal server error" : message,
    });
  });

  return app;
}
