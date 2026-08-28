import { normalizePhone, hashOtp, generateOtp } from "../src/lib/auth";

describe("phone normalisation", () => {
  it("accepts the shapes people actually type", () => {
    expect(normalizePhone("5125551234")).toBe("+15125551234");
    expect(normalizePhone("(512) 555-1234")).toBe("+15125551234");
    expect(normalizePhone("+1 512 555 1234")).toBe("+15125551234");
    expect(normalizePhone("15125551234")).toBe("+15125551234");
    expect(normalizePhone("+447700900123")).toBe("+447700900123");
  });

  it("rejects anything that is not a usable number", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("one-time codes", () => {
  it("generates six digits, zero-padded", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("hashes per phone number so a code cannot be replayed elsewhere", () => {
    expect(hashOtp("+15125551234", "123456")).toBe(hashOtp("+15125551234", "123456"));
    expect(hashOtp("+15125551234", "123456")).not.toBe(hashOtp("+15125559999", "123456"));
    expect(hashOtp("+15125551234", "123456")).not.toBe(hashOtp("+15125551234", "654321"));
  });
});
