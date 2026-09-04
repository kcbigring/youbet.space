// The phone number is the account identity, so the client and the server have
// to normalise it identically — a number that becomes "+17202443415" on one
// side and "+117202443415" on the other is two different people, and the second
// one owns no wallet and none of your wagers.
//
// The client cannot defer to the server here: Firebase needs E.164 before any
// request of ours is made. So the logic is mirrored, and this makes the mirror
// break loudly rather than silently.

import { normalizePhone as server } from "../src/lib/auth";
import { normalizePhone as client } from "../../web/lib/phone";

const CASES = [
  ["5125551234", "+15125551234"], // bare 10 digits, assume US
  ["15125551234", "+15125551234"], // 11 with the country code, do not prefix again
  ["1 (720) 244-3415", "+17202443415"],
  ["(512) 555-1234", "+15125551234"],
  ["+1 512 555 1234", "+15125551234"],
  ["+447700900123", "+447700900123"],
  ["12345", null],
  ["not a phone", null],
  ["", null],
] as const;

describe.each(CASES)("normalizePhone(%j)", (input, expected) => {
  it(`is ${expected}`, () => {
    expect(server(input)).toBe(expected);
    expect(client(input)).toBe(expected);
  });
});
