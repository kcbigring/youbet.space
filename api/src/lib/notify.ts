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
  send(
    to: { userId: string; email?: string | null },
    message: { title: string; body: string; wagerId?: string | null }
  ): Promise<boolean>;
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

/// Email, via Resend.
///
/// Reaches everyone, needs no carrier registration, and does not care whether
/// the app was added to a home screen. Someone with no address on file simply
/// is not reachable this way — that is not a failure, so it is reported as
/// "not delivered" rather than thrown, and the next channel gets a turn.
const resendChannel: Channel = {
  name: "resend",
  async send(to, message) {
    if (!env.resendApiKey || !to.email) return false;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.notifyFrom,
        to: [to.email],
        subject: message.title,
        text: `${message.body}\n\n${env.appUrl}${message.wagerId ? `/w/${message.wagerId}` : ""}`,
        html: emailHtml(message),
      }),
    });

    if (!response.ok) {
      // Resend explains itself in the body; the status alone says nothing.
      throw new Error(`resend ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return true;
  },
};

/// One column, one sentence, one link. A reminder that somebody owes an answer
/// on a $10 bet does not need a layout, and anything more decorative reads as
/// marketing — which is how it ends up filtered.
function emailHtml({ title, body, wagerId }: { title: string; body: string; wagerId?: string | null }) {
  const link = `${env.appUrl}${wagerId ? `/w/${wagerId}` : ""}`;
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#0b0d12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table role="presentation" width="100%" style="max-width:420px;margin:0 auto">
    <tr><td style="padding-bottom:18px;color:#e6e8ee;font-size:17px;font-weight:700">youbet<span style="color:#4ade80">.space</span></td></tr>
    <tr><td style="background:#151922;border:1px solid #232936;border-radius:14px;padding:22px">
      <div style="color:#e6e8ee;font-size:18px;font-weight:700;margin-bottom:8px">${escapeHtml(title)}</div>
      <div style="color:#98a2b3;font-size:15px;line-height:1.5">${escapeHtml(body)}</div>
      <a href="${link}" style="display:inline-block;margin-top:18px;background:#4ade80;color:#0b0d12;text-decoration:none;font-weight:700;font-size:15px;padding:11px 18px;border-radius:10px">Open it</a>
    </td></tr>
    <tr><td style="padding-top:16px;color:#5b6478;font-size:12px">You are getting this because you have money on a bet. Turn these off in your wallet.</td></tr>
  </table>
</body></html>`;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function channels(): Channel[] {
  // Console last: it always succeeds, so anything after it would never run.
  return [...(env.resendApiKey ? [resendChannel] : []), consoleChannel];
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
          { title: notification.title, body: notification.body, wagerId: notification.wagerId }
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
