import dotenv from 'dotenv';
import Twilio from 'twilio';

dotenv.config();

const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_FROM;

let client: Twilio.Twilio | null = null;
if (sid && token) {
  client = Twilio(sid, token);
}

export async function sendSms(phone: string, body: string) {
  if (!client || !from) {
    console.log(`Simulated SMS to ${phone}: ${body}`);
    return { ok: true, simulated: true };
  }

  const msg = await client.messages.create({ body, from, to: phone });
  return { ok: true, sid: msg.sid };
}

export default { sendSms };
