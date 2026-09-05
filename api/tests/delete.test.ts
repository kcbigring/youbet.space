// Deleting is only ever safe on a draft: it has reached nobody and holds no
// money. Once a wager is on-chain the escrow is the record, and no row in our
// database can retract it — so these pin what the endpoint refuses.

const findUnique = jest.fn();
const findUniqueOrThrow = jest.fn();
const del = jest.fn();

jest.mock("../src/prisma", () => ({
  __esModule: true,
  default: {
    wager: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      delete: (...a: unknown[]) => del(...a),
    },
    user: { findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrow(...a) },
    groupMember: { findUnique: jest.fn().mockResolvedValue(null) },
    comment: { findMany: jest.fn().mockResolvedValue([]) },
    session: { findUnique: jest.fn() },
  },
}));

const getWagersByCreator = jest.fn().mockResolvedValue([]);
jest.mock("../src/lib/chain", () => ({
  ...jest.requireActual("../src/lib/chain"),
  getBook: () => ({ getWagersByCreator, getWager: jest.fn() }),
}));

import request from "supertest";
import { createApp } from "../src/app";
import prisma from "../src/prisma";

const ME = "user_kevin";
const app = createApp();

const draft = (over: Record<string, unknown> = {}) => ({
  id: "w1",
  status: "DRAFT",
  creatorId: ME,
  onchainId: null,
  termsHash: "0xabc",
  participants: [{ userId: ME, state: "INVITED", user: { id: ME, phone: "+17202443415" } }],
  ...over,
});

const remove = () => request(app).delete("/wagers/w1").set("Authorization", "Bearer t");

beforeEach(() => {
  jest.clearAllMocks();
  // `clearMocks` wipes these between tests, so the session the auth middleware
  // accepts has to be re-armed each time.
  (prisma as unknown as { session: { findUnique: jest.Mock } }).session.findUnique.mockResolvedValue({
    id: "s1",
    token: "t",
    userId: ME,
    expiresAt: new Date(Date.now() + 86_400_000),
    user: { id: ME },
  });
  getWagersByCreator.mockResolvedValue([]);
  findUniqueOrThrow.mockResolvedValue({ id: ME, walletAddress: null });
});

describe("deleting a wager", () => {
  it("throws away the creator's own draft", async () => {
    findUnique.mockResolvedValue(draft());
    const res = await remove();
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith({ where: { id: "w1" } });
  });

  it("refuses one that is already on-chain, where the escrow is the record", async () => {
    findUnique.mockResolvedValue(draft({ status: "OPEN", onchainId: 1 }));
    const res = await remove();
    expect(res.status).toBe(409);
    expect(del).not.toHaveBeenCalled();
  });

  // Status alone is not enough: a create that landed while its link call was
  // lost leaves a draft pointing at real escrow.
  it("refuses a draft that somehow carries an on-chain id", async () => {
    findUnique.mockResolvedValue(draft({ onchainId: 4 }));
    expect((await remove()).status).toBe(409);
    expect(del).not.toHaveBeenCalled();
  });

  it("refuses someone else's draft", async () => {
    findUnique.mockResolvedValue(
      draft({ creatorId: "user_fred" })
    );
    expect((await remove()).status).toBe(403);
    expect(del).not.toHaveBeenCalled();
  });
});
