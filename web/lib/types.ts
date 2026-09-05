export interface User {
  id: string;
  displayName: string | null;
  /// Phone proven via Identity Platform. Required to fund a wager once real
  /// money is on; irrelevant while playing with test funds.
  phoneVerified?: boolean;
  /// Where reminders go. Absent means nothing reaches this person.
  email?: string | null;
  handle?: string | null;
  phone?: string;
  walletAddress?: string | null;
  groups?: Array<{ id: string; name: string; role: string }>;
}

export interface Participant {
  id: string;
  userId: string;
  side: number | null;
  state: "INVITED" | "JOINED" | "DECLINED";
  attestedAt: string | null;
  attestedChoice: number | null;
  conceded: boolean;
  netCents: number | null;
  user: User;
}

export interface Wager {
  id: string;
  proposition: string;
  sideLabels: string[];
  category: string | null;
  stakeCents: number;
  bondCents: number;
  status: "DRAFT" | "OPEN" | "LOCKED" | "SETTLED" | "REFUNDED" | "CANCELLED";
  winningSide: number | null;
  resolutionMethod: "ATTESTATION" | "ORACLE";
  thresholdBps: number;
  fundingDeadline: string;
  eventDeadline: string;
  resolutionDeadline: string;
  /// Id inside the WagerBook contract, once the escrow exists.
  onchainId: number | null;
  creatorId: string;
  creator: User;
  group: { id: string; name: string } | null;
  participants: Participant[];
}

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  maxStakeCents: number;
  maxPotCents: number;
  defaultBondCents: number;
  defaultThresholdBps: number;
  resolutionWindowHours: number;
  _count?: { members: number; wagers: number };
}

export interface Reputation {
  challenges: number;
  wins: number;
  losses: number;
  netCents: number;
  attestationRate: number | null;
  pendingAttestations: number;
}

export interface Tier {
  key: string;
  name: string;
  blurb: string;
  maxStakeCents: number;
  openWagers: number;
  invitesPerDay: number;
  canCreateGroups: boolean;
}

export interface Standing {
  tier: Tier;
  next: Tier | null;
  toNext: { settled: number; attestation: number | null } | null;
  limits: {
    maxStakeCents: number;
    openWagers: number;
    invitesPerDay: number;
    canCreateGroups: boolean;
  };
}

export interface ParsedWager {
  proposition: string;
  sideLabels: [string, string];
  stakeCents: number | null;
  participants: string[];
  resolution: "ORACLE" | "ATTESTATION";
  oracleSource: string | null;
  category: string | null;
  eventDeadline: string | null;
  source: "ai" | "heuristic";
}
