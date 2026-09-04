import { artifact } from "../src/lib/chain";

/// Contracts are looked up by string, so renaming one compiles cleanly and then
/// throws at runtime. Renaming TestUSD to PlayDollar did exactly that: the
/// wallet balance silently read as nothing and joining a wager would have
/// failed, with no type error anywhere.
describe("bundled contract ABIs", () => {
  const USED_BY_THE_APP = ["WagerBook", "PlayDollar", "GroupRegistry", "ResolverRegistry", "Treasury"];

  it.each(USED_BY_THE_APP)("has an ABI registered for %s", (name) => {
    expect(() => artifact(name)).not.toThrow();
    expect(artifact(name).abi.length).toBeGreaterThan(0);
  });

  it("exposes the functions the app actually calls", () => {
    const has = (name: string, fn: string) =>
      (artifact(name).abi as { name?: string }[]).some((e) => e.name === fn);

    for (const fn of ["createWager", "join", "attest", "concede", "withdraw", "summary"]) {
      expect(has("WagerBook", fn)).toBe(true);
    }
    for (const fn of ["drip", "approve", "balanceOf", "previewDrip"]) {
      expect(has("PlayDollar", fn)).toBe(true);
    }
  });

  it("fails loudly on a name that is not registered", () => {
    expect(() => artifact("TestUSD")).toThrow();
  });
});
