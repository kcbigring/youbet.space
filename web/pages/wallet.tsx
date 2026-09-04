import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { api, usd, setToken } from "../lib/api";
import { useSession } from "../lib/useSession";
import type { Reputation, Standing as StandingType } from "../lib/types";
import { Layout, Banner } from "../components/Layout";
import { VerifyPhone } from "../components/VerifyPhone";
import { ConnectWallet } from "../components/ConnectWallet";
import { TestMoney } from "../components/TestMoney";
import { FoundingSlots } from "../components/FoundingSlots";
import { Standing } from "../components/Standing";

interface Me {
  id: string;
  displayName: string | null;
  phoneVerified?: boolean;
}

interface WalletInfo {
  wallet: { address: string; chainId: number; balanceUnits: string; balanceCents: number | null } | null;
  limits: {
    monthlyLimitCents: number;
    committedCents: number;
    remainingCents: number;
    maxStakeCents: number;
    maxPotCents: number;
  };
}

const CHAINS: Record<number, string> = { 8453: "Base", 84532: "Base Sepolia" };

export default function Wallet() {
  const router = useRouter();
  const { user, loading } = useSession();
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [rep, setRep] = useState<Reputation | null>(null);
  const [standing, setStanding] = useState<StandingType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      api.get<WalletInfo>("/users/me/wallet"),
      api.get<{ reputation: Reputation; standing: StandingType }>("/users/me/reputation"),
    ])
      .then(([w, r]) => {
        setInfo(w);
        setRep(r.reputation);
        setStanding(r.standing);
      })
      .catch((err) => setError(err.message));
  }, [user]);

  if (loading || !user) {
    return (
      <Layout>
        <div className="skeleton" />
      </Layout>
    );
  }

  const usedPct = info ? Math.min(100, Math.round((info.limits.committedCents / info.limits.monthlyLimitCents) * 100)) : 0;

  return (
    <Layout title="Wallet">
      <h1>Wallet</h1>
      <Banner>{error}</Banner>

      {info && !info.wallet && (
        <>
          <p className="muted small">You do not have a wallet yet.</p>
          <ConnectWallet onReady={() => router.reload()} />
        </>
      )}

      {info?.wallet && (
        <>
          <div className="card">
            <div className="small muted">Balance</div>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", margin: "4px 0" }}>
              {usd(info.wallet!.balanceCents ?? 0)}
            </div>
            <div className="small muted">
              {CHAINS[info.wallet!.chainId] || `Chain ${info.wallet!.chainId}`} · gas is sponsored
            </div>

            <div style={{ marginTop: 14 }}>
              <FoundingSlots />
              <div style={{ marginTop: 12 }}>
                <TestMoney onFunded={() => router.reload()} />
              </div>
            </div>

            <div className="divider" style={{ margin: "14px 0" }} />

            <div className="small muted">Your address</div>
            <div className="row" style={{ marginTop: 4 }}>
              <span className="mono break grow">{info.wallet!.address}</span>
              <button
                className="small subtle"
                onClick={() => {
                  navigator.clipboard?.writeText(info.wallet!.address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Created for you automatically. No seed phrase to write down.
            </p>
          </div>

          <h2>Monthly limit</h2>
          <div className="card">
            <div className="between">
              <span>{usd(info.limits.committedCents)} committed</span>
              <span className="muted">{usd(info.limits.monthlyLimitCents)} cap</span>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 999,
                background: "var(--surface-2)",
                overflow: "hidden",
                margin: "10px 0 8px",
              }}
            >
              <div style={{ width: `${usedPct}%`, height: "100%", background: "var(--accent)" }} />
            </div>
            <div className="small muted">
              {usd(info.limits.remainingCents)} left this month · max {usd(info.limits.maxStakeCents)} per wager
            </div>
          </div>
        </>
      )}

      {standing && (
        <>
          <h2>Standing</h2>
          <Standing standing={standing} />
        </>
      )}

      {rep && (
        <>
          <h2>Your record</h2>
          <div className="card">
            <div className="stats">
              <div className="stat">
                <b>{rep.challenges}</b>
                <span>Challenges</span>
              </div>
              <div className="stat">
                <b>
                  {rep.wins}-{rep.losses}
                </b>
                <span>Record</span>
              </div>
              <div className="stat">
                <b className={rep.netCents >= 0 ? "pos" : "neg"}>
                  {rep.netCents >= 0 ? "+" : ""}
                  {usd(rep.netCents)}
                </b>
                <span>Net</span>
              </div>
              <div className="stat">
                <b>{rep.attestationRate == null ? "—" : `${rep.attestationRate}%`}</b>
                <span>Attestation</span>
              </div>
            </div>
            {rep.pendingAttestations > 0 && (
              <p className="small warn" style={{ color: "var(--warn)", marginBottom: 0 }}>
                {rep.pendingAttestations} wager{rep.pendingAttestations === 1 ? "" : "s"} waiting on your call.
              </p>
            )}
          </div>
        </>
      )}

      {user && !(user as Me).phoneVerified && (
        <>
          <h2>Verify your phone</h2>
          <div className="card">
            <p className="small muted" style={{ marginTop: 0 }}>
              Not needed while the alpha runs on test funds. Verify now and you are
              ready the day real money turns on.
            </p>
            <VerifyPhone onVerified={() => router.reload()} />
          </div>
        </>
      )}

      <div className="divider" />
      <button
        className="ghost block"
        onClick={async () => {
          try {
            await api.post("/auth/logout");
          } finally {
            setToken(null);
            router.replace("/signin");
          }
        }}
      >
        Sign out
      </button>
    </Layout>
  );
}
