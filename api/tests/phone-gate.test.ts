// Funding a wager can be gated on a proven phone number. The gate itself is one
// line; what matters is that it is the *server* that decides, so a client
// cannot skip it, and that the client is told before it prompts a wallet.

jest.mock("../src/prisma", () => ({ __esModule: true, default: {} }));

import { normalizePhone as server } from "../src/lib/auth";
import { normalizePhone as client } from "../../web/lib/phone";

describe("the number that gets verified", () => {
  // Both sign-in and the verification screen used to prefix "+1" to whatever
  // was typed, so a number entered with its leading 1 became "+1 1720…" — a
  // number nobody holds, verified against nothing.
  it("is the same one whichever screen asked for it", () => {
    for (const input of ["7205149702", "17205149702", "1 (720) 514-9702", "+1 720 514 9702"]) {
      expect(client(input)).toBe("+17205149702");
      expect(server(input)).toBe(client(input));
    }
  });

  it("refuses what cannot be dialled rather than guessing", () => {
    for (const input of ["123", "", "not a phone"]) expect(client(input)).toBeNull();
  });
});
