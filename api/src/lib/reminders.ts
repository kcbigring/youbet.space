import prisma from "../prisma";
import { formatUsd } from "./money";

/// Nudges for people who still owe a call on a wager whose outcome is known.
///
/// The deadlines are enforced on-chain regardless. These are what keep a
/// forfeited bond from feeling like a trap: the bond exists to create mild
/// social pressure, not to punish someone who never heard.
///
/// Timing is a fraction of the window rather than a fixed number of hours.
/// Those hours were 24, 48 and 72, which assumed every wager gave three days —
/// and since the creator started choosing anything from six hours to a week, a
/// six-hour window closed and forfeited a bond before the first reminder was
/// even due. A fraction works at either end of that range.

export interface ReminderStage {
  kind: string;
  /// When this is due, as a share of the voting window. 0 is the moment the
  /// outcome is known; 1 is the moment the window shuts.
  at: number;
  title: () => string;
  body: (args: { proposition: string; bondCents: number; closesAt: Date }) => string;
}

export const STAGES: ReminderStage[] = [
  {
    kind: "RESOLVE_REMINDER",
    at: 0,
    title: () => "How did it go?",
    body: ({ proposition }) => `Time to settle up: "${proposition}". Say how it went.`,
  },
  {
    kind: "RESOLVE_LAST_CALL",
    // Late enough to be urgent, early enough to still be actionable on the
    // shortest window anyone can pick.
    at: 0.75,
    title: () => "Your bond is on the line",
    body: ({ proposition, bondCents, closesAt }) =>
      `"${proposition}" still needs your call. Say how it went by ${closesAt.toLocaleString()} or your ${formatUsd(bondCents)} bond goes to whoever did.`,
  },
  {
    kind: "RESOLVE_WINDOW_CLOSED",
    at: 1,
    title: () => "Voting closed",
    body: ({ proposition }) =>
      `"${proposition}" closed without your call. Your bond went to the people who did answer.`,
  },
];

/// When a stage falls due for a particular wager's window.
export function dueAt(stage: ReminderStage, eventDeadline: Date, resolutionDeadline: Date): Date {
  const window = resolutionDeadline.getTime() - eventDeadline.getTime();
  return new Date(eventDeadline.getTime() + window * stage.at);
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
    where: { status: "LOCKED", eventDeadline: { lte: now } },
    include: {
      participants: { where: { state: "JOINED", attestedAt: null } },
    },
  });

  const due: PendingReminder[] = [];

  for (const wager of wagers) {
    // Only the latest applicable stage is worth sending; if the job has been
    // down for a day we should nudge once, not three times.
    const stage = [...STAGES]
      .reverse()
      .find((s) => now >= dueAt(s, wager.eventDeadline, wager.resolutionDeadline));
    if (!stage) continue;

    for (const participant of wager.participants) {
      due.push({
        userId: participant.userId,
        wagerId: wager.id,
        kind: stage.kind,
        title: stage.title(),
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
