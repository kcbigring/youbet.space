/// Normalises to E.164, defaulting bare 10-digit input to +1. Anything else
/// must already carry a country code.
///
/// A deliberate mirror of `normalizePhone` in `api/src/lib/auth.ts`. The two
/// have to agree — the phone is the account identity, so a number normalised
/// one way here and another way there is a different person. The client cannot
/// simply defer to the server, because Firebase needs E.164 before any request
/// of ours is made. `api/tests/auth.test.ts` pins the shared table.
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
