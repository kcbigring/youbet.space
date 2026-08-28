import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import prisma from "./prisma";
import { sendSms } from './twilio';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Simple API key auth for sensitive endpoints
function requireApiKey(req: any, res: any, next: any) {
  const key = process.env.API_KEY;
  if (!key) return res.status(500).json({ ok: false, error: 'Server misconfiguration: API_KEY not set' });
  const provided = req.headers['x-api-key'] || (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));
  if (!provided || provided !== key) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  return next();
}

app.get("/health", (req, res) => res.json({ ok: true }));

// Placeholder: create a wager (stores off-chain metadata, returns contract deploy intent)
app.post("/wagers", async (req, res) => {
  const { title, stake, bond, participants } = req.body;
  // TODO: validate, persist to Postgres, call factory deploy on-chain via signer
  return res.json({ ok: true, message: "wager accepted (placeholder)", data: { title, stake, bond, participants } });
});

// Simple natural-language parser (naive heuristics for MVP)
app.post('/parse', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ ok: false, error: 'Missing text' });

    // If an OpenAI key is configured, prefer AI parsing for better accuracy
    if (process.env.OPENAI_API_KEY) {
      try {
        const prompt = `Extract JSON with keys: proposition, stake (number or null), participants (array of names), resolution (oracle|attestation).\n\nText:\n${text}`;
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: 'You are a JSON extractor.' }, { role: 'user', content: prompt }],
            temperature: 0,
            max_tokens: 400,
          }),
        });
        const data = await r.json();
        const txt = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
        // attempt to extract JSON block
        const jsonMatch = txt.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return res.json({ ok: true, parsed, ai: true });
        }
      } catch (aiErr) {
        console.warn('AI parse failed, falling back to heuristic', aiErr);
      }
    }

    // Heuristic fallback (existing simple parser)
    const moneyMatches = text.match(/\$\s*\d+(?:\.\d+)?/g) || [];
    const stake = moneyMatches.length ? moneyMatches[0].replace(/[^0-9.]/g, '') : null;

    let participants: string[] = [];
    const participantsMatch = text.match(/bet\s+(?:[\w'\s]+?)\s+([A-Z][a-z]+(?:\s+and\s+[A-Z][a-z]+)*)/);
    if (participantsMatch && participantsMatch[1]) {
      participants = participantsMatch[1].split(/\s+and\s+/i).map(s => s.trim());
    }

    const thatIndex = text.toLowerCase().indexOf(' that ');
    const proposition = thatIndex >= 0 ? text.slice(thatIndex + 6).trim() : text.trim();

    const resolution = /score|scoreboard|final|final score|odds|market|price|election|weather/i.test(text) ? 'oracle' : 'attestation';

    return res.json({ ok: true, parsed: { proposition, stake, participants, resolution }, ai: false });
  } catch (err: any) {
    console.error('parse error', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// Deploy WagerFactory contract using Hardhat artifact
app.post('/deploy', requireApiKey, async (req, res) => {
  try {
    const { stake, bond } = req.body;
    const rpc = process.env.BASE_RPC || process.env.ROBINHOOD_RPC;
    const key = process.env.DEPLOYER_PRIVATE_KEY;
    const treasury = process.env.TREASURY_ADDRESS || null;
    if (!rpc || !key) return res.status(400).json({ ok: false, error: 'Missing BASE_RPC/ROBINHOOD_RPC or DEPLOYER_PRIVATE_KEY' });

    const provider = new ethers.providers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(key, provider);

    // locate artifact
    const artifactPath = path.resolve(__dirname, '../../contracts/artifacts/contracts/WagerFactory.sol/WagerFactory.json');
    if (!fs.existsSync(artifactPath)) return res.status(500).json({ ok: false, error: 'Artifact not found. Compile contracts first.' });
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const deployed = await factory.deploy(treasury || wallet.address);
    await deployed.deployed();

    // persist to DB if available
    if (process.env.DATABASE_URL) {
      await prisma.wagerFactory.create({ data: { address: deployed.address, deployer: wallet.address, stake: String(stake || ''), bond: String(bond || '') } });
    }

    return res.json({ ok: true, address: deployed.address });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// Call factory.createWager(factoryAddress) to deploy a Wager instance
app.post('/factory/:factoryAddress/create-wager', requireApiKey, async (req, res) => {
  try {
    const { factoryAddress } = req.params;
    const { stake, bond, ownerSplitBps } = req.body;
    const rpc = process.env.BASE_RPC || process.env.ROBINHOOD_RPC;
    const key = process.env.DEPLOYER_PRIVATE_KEY;
    if (!rpc || !key) return res.status(400).json({ ok: false, error: 'Missing BASE_RPC/ROBINHOOD_RPC or DEPLOYER_PRIVATE_KEY' });

    const provider = new ethers.providers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(key, provider);

    const artifactPath = path.resolve(__dirname, '../../contracts/artifacts/contracts/WagerFactory.sol/WagerFactory.json');
    if (!fs.existsSync(artifactPath)) return res.status(500).json({ ok: false, error: 'Artifact not found. Compile contracts first.' });
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    const factory = new ethers.Contract(factoryAddress, artifact.abi, wallet);
    const tx = await factory.createWager(ethers.utils.parseEther(String(stake || '0')), ethers.utils.parseEther(String(bond || '0')), ownerSplitBps || 0);
    const receipt = await tx.wait();

    // find WagerCreated event
    const event = receipt.events && receipt.events.find((e: any) => e.event === 'WagerCreated');
    let wagerAddress = null;
    if (event && event.args) wagerAddress = event.args[0];

    if (!wagerAddress) {
      // try parsing logs by topic
      wagerAddress = null;
    }

    if (wagerAddress && process.env.DATABASE_URL) {
      await prisma.wager.create({ data: { address: wagerAddress, factory: factoryAddress, stake: String(stake || ''), bond: String(bond || '') } });
    }

    return res.json({ ok: true, wagerAddress });
  } catch (err: any) {
    console.error('create-wager error', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// Invite endpoint: send OTP
app.post('/invite', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ ok: false, error: 'Missing phone' });

    // generate 6-digit code
    const code = String(100000 + Math.floor(Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    if (process.env.DATABASE_URL) {
      await prisma.invite.create({ data: { phone, code, expiresAt } as any });
    }

    await sendSms(phone, `Your YouBet verification code is: ${code}`);

    return res.json({ ok: true, message: 'OTP sent (might be simulated in dev)' });
  } catch (err: any) {
    console.error('invite error', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// Verify endpoint: confirm OTP
app.post('/verify', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ ok: false, error: 'Missing phone or code' });

    if (!process.env.DATABASE_URL) {
      return res.status(500).json({ ok: false, error: 'Database not configured' });
    }

    const invite = await prisma.invite.findFirst({ where: { phone, code, used: false } as any });
    if (!invite) return res.status(400).json({ ok: false, error: 'Invalid code' });

    if (new Date(invite.expiresAt) < new Date()) return res.status(400).json({ ok: false, error: 'Code expired' });

    // mark used and upsert user
    await prisma.invite.update({ where: { id: invite.id }, data: { used: true } as any });
    const user = await prisma.user.upsert({ where: { phone }, update: { verified: true } as any, create: { phone, verified: true } as any });

    return res.json({ ok: true, user: { id: user.id, phone: user.phone, verified: user.verified } });
  } catch (err: any) {
    console.error('verify error', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
