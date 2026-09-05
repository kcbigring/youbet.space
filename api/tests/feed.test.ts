// The home screen sorts wagers by what you have to do next, so a wager must
// appear in exactly one place. A locked wager waiting on your call is also an
// active one; matching both printed the same bet twice under two headings.

jest.mock("../src/prisma", () => ({ __esModule: true, default: {} }));

import { bucketWagers } from "../src/routes/wagers";

const ME = "user_kevin";
const NOW = new Date("2026-09-05T05:00:00.000Z");
const PAST = new Date("2026-09-05T04:47:00.000Z");
const FUTURE = new Date("2026-09-06T04:47:00.000Z");

const wager = (over: Partial<Parameters<typeof bucketWagers>[0][number]> = {}) => ({
  id: "w1",
  status: "LOCKED",
  creatorId: ME,
  eventDeadline: PAST,
  participants: [{ userId: ME, state: "JOINED", attestedAt: null }],
  ...over,
});

const buckets = (w: ReturnType<typeof wager>[]) => bucketWagers(w, ME, NOW);

const appearances = (result: ReturnType<typeof buckets>, id: string) =>
  Object.values(result)
    .flat()
    .filter((w) => (w as { id: string }).id === id).length;

describe("the home feed", () => {
  it("never shows the same wager under two headings", () => {
    expect(appearances(buckets([wager()]), "w1")).toBe(1);
  });

  it("files a locked wager past its deadline as needing your call, not as active", () => {
    const out = buckets([wager()]);
    expect(out.needsAttention).toHaveLength(1);
    expect(out.active).toHaveLength(0);
  });

  it("keeps a locked wager whose outcome is not due yet under active", () => {
    const out = buckets([wager({ eventDeadline: FUTURE })]);
    expect(out.active).toHaveLength(1);
    expect(out.needsAttention).toHaveLength(0);
  });

  it("stops calling for your attention once you have said how it went", () => {
    const out = buckets([
      wager({ participants: [{ userId: ME, state: "JOINED", attestedAt: NOW }] }),
    ]);
    expect(out.needsAttention).toHaveLength(0);
    expect(out.active).toHaveLength(1);
  });

  it("separates an invitation you have not funded from one you have", () => {
    const out = buckets([
      wager({ id: "invited", status: "OPEN", eventDeadline: FUTURE,
        participants: [{ userId: ME, state: "INVITED", attestedAt: null }] }),
      wager({ id: "funded", status: "OPEN", eventDeadline: FUTURE }),
    ]);
    expect(out.pending.map((w) => w.id)).toEqual(["invited"]);
    expect(out.active.map((w) => w.id)).toEqual(["funded"]);
    expect(appearances(out, "invited")).toBe(1);
    expect(appearances(out, "funded")).toBe(1);
  });

  it("puts a settled wager only in recent", () => {
    const out = buckets([wager({ status: "SETTLED" })]);
    expect(out.recent).toHaveLength(1);
    expect(appearances(out, "w1")).toBe(1);
  });
});
