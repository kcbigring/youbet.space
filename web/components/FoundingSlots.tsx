import { useReadContract } from "wagmi";
import { hasStakeToken, stakeTokenAddress, playDollarAbi } from "../lib/contracts";
import { activeChain } from "../lib/wagmi";

const usd = (v?: bigint) => (v == null ? null : Number(v) / 1e6);
const money = (n: number) => "$" + n.toLocaleString();

/// How much play money is on the table right now, and for whom. Read straight
/// from the token contract with no wallet connected, so a stranger who follows
/// a link sees the offer before deciding whether to sign up.
export function FoundingSlots({ compact = false }: { compact?: boolean }) {
  const { data } = useReadContract({
    address: hasStakeToken ? stakeTokenAddress : undefined,
    abi: playDollarAbi,
    chainId: activeChain.id,
    functionName: "claimed",
    query: { enabled: hasStakeToken, refetchInterval: 30_000 },
  });

  const { data: founder } = useReadContract({
    address: hasStakeToken ? stakeTokenAddress : undefined,
    abi: playDollarAbi,
    chainId: activeChain.id,
    functionName: "founderBonus",
    query: { enabled: hasStakeToken },
  });

  const { data: early } = useReadContract({
    address: hasStakeToken ? stakeTokenAddress : undefined,
    abi: playDollarAbi,
    chainId: activeChain.id,
    functionName: "earlyBonus",
    query: { enabled: hasStakeToken },
  });

  if (!hasStakeToken || data == null) return null;

  const claimed = Number(data as bigint);
  const founderUsd = usd(founder as bigint) ?? 10_000;
  const earlyUsd = usd(early as bigint) ?? 1_000;

  const next = claimed + 1;
  const founderLeft = Math.max(0, 10 - claimed);
  const earlyLeft = Math.max(0, 100 - claimed);

  const nextBonus = claimed < 10 ? founderUsd : claimed < 100 ? earlyUsd : 0;

  if (compact) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        {earlyLeft > 0 ? (
          <>
            <b style={{ color: "var(--accent)" }}>
              {founderLeft > 0 ? `${founderLeft} founder spots` : `${earlyLeft} early spots`}
            </b>{" "}
            left &mdash; next person in is number {next} and gets {money(nextBonus)}.
          </>
        ) : (
          <>All 100 founding spots are taken.</>
        )}
      </p>
    );
  }

  return (
    <div className="slots">
      <div className="slots-row">
        <span className={claimed < 10 ? "slots-tier open" : "slots-tier gone"}>
          <b>1&ndash;10</b>
          <span>{money(founderUsd)}</span>
        </span>
        <span className={claimed >= 10 && claimed < 100 ? "slots-tier open" : claimed < 10 ? "slots-tier" : "slots-tier gone"}>
          <b>11&ndash;100</b>
          <span>{money(earlyUsd)}</span>
        </span>
        <span className={claimed >= 100 ? "slots-tier open" : "slots-tier"}>
          <b>After</b>
          <span>Daily top-up</span>
        </span>
      </div>
      <p className="small muted" style={{ margin: "10px 0 0" }}>
        {earlyLeft > 0 ? (
          <>
            <b style={{ color: "var(--accent)" }}>{claimed} of 100</b> founding spots claimed. The next
            person in is number {next} and gets {money(nextBonus)} on top of the daily top-up.
          </>
        ) : (
          <>All 100 founding spots have been claimed. Everyone now gets the daily top-up.</>
        )}
      </p>
    </div>
  );
}
