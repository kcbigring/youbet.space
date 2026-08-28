import Twilio from "twilio";
import { env } from "./env";

const client =
  env.twilioAccountSid && env.twilioAuthToken ? Twilio(env.twilioAccountSid, env.twilioAuthToken) : null;

export const smsEnabled = Boolean(client && env.twilioFrom);

/// Sends an SMS, or logs it in development so the invite flow is testable
/// without Twilio credentials.
export async function sendSms(to: string, body: string) {
  if (!client || !env.twilioFrom) {
    if (env.isProduction) {
      console.error(`SMS to ${to} dropped: Twilio is not configured`);
      return { ok: false as const, simulated: true };
    }
    console.log(`[sms:simulated] ${to} :: ${body}`);
    return { ok: true as const, simulated: true };
  }

  try {
    const message = await client.messages.create({ body, from: env.twilioFrom, to });
    return { ok: true as const, simulated: false, sid: message.sid };
  } catch (error) {
    console.error(`SMS to ${to} failed`, error);
    return { ok: false as const, simulated: false };
  }
}

export default { sendSms, smsEnabled };
