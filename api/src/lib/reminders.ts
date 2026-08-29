import prisma from "../prisma";
import { formatUsd } from "./money";

/// The attestation window from the execution plan (§16):
///   T+0    event ends
///   T+24h  reminder
///   T+48h  reminder plus bond warning
///   T+72h  window closes; non-attesters forfeit their bond
///
/// The deadlines are enforced on-chain regardless. These are the nudges that
/// keep a forfeited bond from feeling like a trap — the bond exists to create
/// mild social pressure, not to punish someone who never heard about it.

const HOUR = 60 * 60 * 1000;

export interface ReminderStage {
  kind: string;
  /// Hours after the event deadline at which this becomes due.
  afterHours: number;
  title: (proposition: string) => string;
  body: (args: { proposition: string; bondCents: number; closesAt: Date }) => string;
}

export const STAGES: ReminderStage[] = [
  {
    kind: "RESOLVE_REMINDER_24H",
    afterHours: 24,
    title: () => "How did it go?",
    body: ({ proposition }) => `Time to settle up: "${proposition}". Tap to say who won.`,
  },
  {
    kind: "RESOLVE_REMINDER_48H",
    afterHours: 48,
    title: () => "Your bond is on the line",
    body: ({ proposition, bondCents, closesAt }) =>
      `"${proposition}" still needs your call. Attest by ${closesAt.toLocaleString()} or you forfeit your ${formatUsd(bondCents)} bond.`,
  },
  {
    kind: "RESOLVE_WINDOW_CLOSED",
    afterHours: 72,
    title: () => "Attestation window closed",
    body: ({ proposition }) =>
      `"${proposition}" closed without your attestation. Your bond went to the participants who did resolve.`,
  },
];

/// A stage is due once its hour mark has passed but the wager is still open for
/// resolution — except the closing notice, which is meant to fire after the end.
function isDue(stage: ReminderStage, eventDeadline: Date, now: Date) {
  return now.getTime() >= eventDeadline.getTime() + stage.afterHours * HOUR;
}

export interface PendingReminder {
  userId: string;
  wagerId: string;
  kind: string;
  title: string;
  body: string;
}

/// Finds everyone who still owes an attestation on a live wager and works out
/// which nudge, if any, is due for them.
export async function findDueReminders(now = new Date()): Promise<PendingReminder[]> {
  const wagers = await prisma.wager.findMany({
    where: {
      status: "LOCKED",
      eventDeadline: { lte: new Date(now.getTime() - STAGES[0].afterHours * HOUR) },
    },
    include: {
      participants: { where: { state: "JOINED", attestedAt: null } },
    },
  });

  const due: PendingReminder[] = [];

  for (const wager of wagers) {
    // Only the latest applicable stage is worth sending; if a job has been down
    // for a day we should nudge once, not three times.
    const stage = [...STAGES].reverse().find((s) => isDue(s, wager.eventDeadline, now));
    if (!stage) continue;

    for (const participant of wager.participants) {
      due.push({
        userId: participant.userId,
        wagerId: wager.id,
        kind: stage.kind,
        title: stage.title(wager.proposition),
        body: stage.body({
          proposition: wager.proposition,
          bondCents: wager.bondCents,
          closesAt: wager.resolutionDeadline,
        }),
      });
    }
  }

  return due;
}

/// Records reminders, skipping anyone who already has that kind for that wager.
/// The unique constraint is the dedup: writing first means a crashed or retried
/// run cannot notify the same person twice.
export async function recordReminders(reminders: PendingReminder[]) {
  if (!reminders.length) return { created: 0 };

  const result = await prisma.notification.createMany({
    data: reminders.map((r) => ({
      userId: r.userId,
      wagerId: r.wagerId,
      kind: r.kind,
      title: r.title,
      body: r.body,
    })),
    skipDuplicates: true,
  });

  return { created: result.count };
}
