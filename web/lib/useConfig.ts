import { useEffect, useState } from "react";
import { api } from "./api";

export interface Config {
  /// Whether funding a wager needs a proven phone number. Off while the alpha
  /// runs on play money, and the copy around verification changes with it —
  /// telling someone it is optional when it is not would be worse than silence.
  requireVerifiedPhone: boolean;
  limits: {
    maxStakeCents: number;
    maxPotCents: number;
    monthlyLimitCents: number;
    feeBps: number;
  };
}

/// What the server is configured to require. Fetched rather than compiled in,
/// so turning verification on does not need a front-end deploy.
export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    api
      .get<Config>("/config")
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  return config;
}
