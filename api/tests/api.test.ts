import request from "supertest";

// The API surface is exercised without a database; Prisma is stubbed so these
// stay fast and runnable in CI.
jest.mock("../src/prisma", () => ({
  __esModule: true,
  default: {
    $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
    user: { count: jest.fn().mockResolvedValue(3) },
    group: { count: jest.fn().mockResolvedValue(1) },
    wager: { count: jest.fn().mockResolvedValue(2) },
    invite: { create: jest.fn().mockResolvedValue({ id: "inv_1" }) },
    session: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}));

import { createApp } from "../src/app";

const app = createApp();

describe("system endpoints", () => {
  it("reports liveness without touching the database", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.uptimeSeconds).toBe("number");
  });

  it("exposes the limits the client needs to render", async () => {
    const res = await request(app).get("/config");
    expect(res.status).toBe(200);
    expect(res.body.limits).toMatchObject({
      maxStakeCents: 10_000, // $100 per person
      maxPotCents: 50_000, // $500 pot
      monthlyLimitCents: 100_000, // $1,000 per month
      feeBps: 100, // 1%
    });
  });

  it("serves Prometheus metrics", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("youbet_wagers_total 2");
    expect(res.text).toContain("youbet_users_total 3");
  });
});

describe("authentication", () => {
  it("refuses protected routes without a session", async () => {
    for (const path of ["/groups", "/wagers", "/users/me/wallet"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    }
  });

  it("rejects an unknown session token", async () => {
    const res = await request(app).get("/groups").set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
  });

  it("rejects input too short to be a phone number", async () => {
    const res = await request(app).post("/auth/request-code").send({ phone: "12345" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid request body/i);
  });

  it("rejects a number that cannot be resolved to E.164", async () => {
    const res = await request(app).post("/auth/request-code").send({ phone: "0000000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid phone number/i);
  });

  it("issues a code for a well-formed number", async () => {
    const res = await request(app).post("/auth/request-code").send({ phone: "512-555-1234" });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe("+15125551234");
    // Development returns the code so the flow is testable without Twilio.
    expect(res.body.devCode).toMatch(/^\d{6}$/);
  });

  it("rejects a malformed verification code", async () => {
    const res = await request(app).post("/auth/verify").send({ phone: "5125551234", code: "abc" });
    expect(res.status).toBe(400);
  });
});

describe("unknown routes", () => {
  it("returns a JSON 404", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: "Not found" });
  });
});
