import prisma from "../prisma";
import { env } from "../env";

/// Delivery for notifications already recorded in the database.
///
/// Channels, in the order they are tried:
///   - Web push (FCM). Free, GCP-native, and the right fit for a PWA — but on
///     iOS it only works once the app is added to the home screen, so it cannot
///     be the only channel.
///   - Email. Reaches everyone, needs no carrier registration, and is the
///     fallback for anyone without a push subscription.
///
/// SMS is deliberately absent: it is the same A2P 10DLC queue that pushed
/// invites onto share links. Reminders to opted-in users are a far easier
/// registration case than cold invites, so it is worth adding later.

export interface Channel {
  name: string;
  send(to: { userId: string; email?: string | null }, message: { title: string; body: string }): Promise<boolean>;
}

/// Development channel: prints instead of sending, so the job is testable with
/// nothing configured.
const consoleChannel: Channel = {
  name: "console",
  async send(to, message) {
    console.log(`[notify:${to.userId}] ${message.title} — ${message.body}`);
    return true;
  },
};

function channels(): Channel[] {
  // Real channels slot in here as they are configured; the job does not change.
  return [consoleChannel];
}

/// Sends everything recorded but not yet delivered. Marks `sentAt` only when a
/// channel accepted it, so a failed send is retried on the next run rather than
/// being silently dropped.
export async function dispatchPending(limit = 200) {
  const pending = await prisma.notification.findMany({
    where: { sentAt: null },
    include: { user: { select: { id: true, email: true } } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let sent = 0;
  let failed = 0;

  for (const notification of pending) {
    let delivered = false;
    for (const channel of channels()) {
      try {
        delivered = await channel.send(
          { userId: notification.userId, email: notification.user.email },
          { title: notification.title, body: notification.body }
        );
        if (delivered) break;
      } catch (error) {
        console.error(`notify: ${channel.name} failed for ${notification.id}`, error);
      }
    }

    if (delivered) {
      await prisma.notification.update({ where: { id: notification.id }, data: { sentAt: new Date() } });
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return { sent, failed, pending: pending.length };
}

export const notifyConfigured = () => channels().length > 1 || !env.isProduction;
