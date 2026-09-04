// One component renders the invite panel for both groups and wagers, and it
// posts a bare `{}` — the link is the invitation, and nobody types a phone
// number to get one. The wager route had kept the earlier SMS-era shape, which
// required a non-empty `phones` array, so every share panel on a wager page
// answered "Invalid request". These pin the shape the client actually sends.

jest.mock("../src/prisma", () => ({ __esModule: true, default: {} }));

import { wagerInviteSchema } from "../src/routes/wagers";
import { inviteSchema as groupInviteSchema } from "../src/routes/groups";

const SCHEMAS = [
  ["wager", wagerInviteSchema],
  ["group", groupInviteSchema],
] as const;

describe.each(SCHEMAS)("%s invite payload", (_name, schema) => {
  it("accepts an empty body — an open link for the share sheet", () => {
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("accepts a phone, which additionally reserves that person a seat", () => {
    expect(schema.safeParse({ phone: "+15125551234" }).success).toBe(true);
  });

  it("rejects something too short to be a phone number", () => {
    expect(schema.safeParse({ phone: "123" }).success).toBe(false);
  });
});
