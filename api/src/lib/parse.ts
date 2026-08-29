import { env } from "../env";

/// Structured wager terms extracted from a natural-language challenge.
/// This is a proposal shown to the user for review — never auto-committed
/// (execution plan §12).
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
  confidence: number;
}

const ORACLE_HINTS: Array<[RegExp, string, string]> = [
  [/\b(nfl|nba|mlb|nhl|ncaa|college football|super bowl|world cup|premier league|game|match|beats?|wins? by|covers?|spread|final score)\b/i, "sports", "sports-data-feed"],
  [/\b(bitcoin|btc|ethereum|eth|solana|stock|price of|market cap|closes above|closes below|s&p|nasdaq)\b/i, "markets", "price-feed"],
  [/\b(election|primary|senate|president|vote|poll)\b/i, "politics", "public-results"],
  [/\b(weather|rain|snow|temperature|degrees|hurricane)\b/i, "weather", "weather-service"],
];

const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/\b(golf|round|handicap|birdie|par)\b/i, "golf"],
  [/\b(gym|run|miles|workout|weight|pushups|steps|marathon)\b/i, "fitness"],
  [/\b(fantasy|waiver|draft|lineup)\b/i, "fantasy"],
  [/\b(revenue|launch|ship|hire|funding|raise|close the deal)\b/i, "business"],
];

const STOPWORDS = new Set(["I", "The", "A", "An", "It", "We", "They", "He", "She", "That", "This"]);

function parseStakeCents(text: string): number | null {
  // "$25", "$12.50", "25 bucks", "50 dollars"
  const dollar = text.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollar) return Math.round(parseFloat(dollar[1]) * 100);

  const spelled = text.match(/\b(\d+(?:\.\d{1,2})?)\s*(?:bucks?|dollars?|usd)\b/i);
  if (spelled) return Math.round(parseFloat(spelled[1]) * 100);

  return null;
}

function parseParticipants(text: string): string[] {
  // "bet Fred and Mike $50", "challenge Sarah", "me and Dave"
  const match = text.match(
    /\b(?:bet|challenge|wager|versus|vs\.?|against|with)\s+((?:[A-Z][a-z]+)(?:(?:,\s*|\s+and\s+|\s+&\s+)[A-Z][a-z]+)*)/
  );
  if (!match) return [];
  return match[1]
    .split(/,\s*|\s+and\s+|\s+&\s+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 1 && !STOPWORDS.has(name));
}

function parseDeadline(text: string, now: Date): string | null {
  const days = text.match(/\bin\s+(\d+)\s+days?\b/i);
  if (days) return new Date(now.getTime() + Number(days[1]) * 86_400_000).toISOString();

  const weeks = text.match(/\bin\s+(\d+)\s+weeks?\b/i);
  if (weeks) return new Date(now.getTime() + Number(weeks[1]) * 7 * 86_400_000).toISOString();

  if (/\btomorrow\b/i.test(text)) return new Date(now.getTime() + 86_400_000).toISOString();
  if (/\btonight\b|\btoday\b/i.test(text)) return new Date(now.getTime() + 12 * 3_600_000).toISOString();
  if (/\bthis weekend\b|\bsunday\b|\bsaturday\b/i.test(text)) {
    return new Date(now.getTime() + 5 * 86_400_000).toISOString();
  }
  if (/\bnext week\b/i.test(text)) return new Date(now.getTime() + 7 * 86_400_000).toISOString();
  if (/\bend of (the )?(month|season|year)\b/i.test(text)) {
    return new Date(now.getTime() + 30 * 86_400_000).toISOString();
  }
  return null;
}

function extractProposition(text: string): string {
  const that = text.match(/\bthat\s+(.+)$/i);
  if (that) return that[1].replace(/[.!?]+$/, "").trim();
  return text.replace(/[.!?]+$/, "").trim();
}

/// Side labels sit directly under the proposition in the UI, so repeating it
/// there reads as a bug. "Yes" and "No" are unambiguous against a stated claim
/// and short enough to scan — the old fallback produced labels like
/// "Not: will i use the peloton in the next hour".
const SIDES: [string, string] = ["Yes", "No"];

export function parseHeuristically(text: string, now = new Date()): ParsedWager {
  const proposition = extractProposition(text);

  let resolution: ParsedWager["resolution"] = "ATTESTATION";
  let oracleSource: string | null = null;
  let category: string | null = null;

  for (const [pattern, cat, source] of ORACLE_HINTS) {
    if (pattern.test(text)) {
      resolution = "ORACLE";
      category = cat;
      oracleSource = source;
      break;
    }
  }
  if (!category) {
    for (const [pattern, cat] of CATEGORY_HINTS) {
      if (pattern.test(text)) {
        category = cat;
        break;
      }
    }
  }

  return {
    proposition,
    sideLabels: [...SIDES],
    stakeCents: parseStakeCents(text),
    participants: parseParticipants(text),
    resolution,
    oracleSource,
    category,
    eventDeadline: parseDeadline(text, now),
    source: "heuristic",
    confidence: 0.4,
  };
}

const SYSTEM_PROMPT = `You convert casual bets between friends into structured wager terms.
Return ONLY a JSON object with these keys:
  proposition   - the claim being bet on, as a short neutral statement
  sideLabels    - array of exactly 2 short strings naming the outcomes, at most
                  4 words each. Use "Yes" and "No" for a claim or a question.
                  Never repeat the proposition back and never prefix with "Not:".
  stakeCents    - integer cents staked per person, or null if unstated
  participants  - array of names the speaker wants to challenge (exclude the speaker)
  resolution    - "ORACLE" if an objective public data source settles it (sports scores,
                  market prices, election results, weather), otherwise "ATTESTATION"
  oracleSource  - short slug for that source, or null
  category      - one of: sports, markets, politics, weather, golf, fitness, fantasy,
                  business, other
  eventDeadline - ISO 8601 timestamp the outcome is known by, or null
Never invent a stake that was not stated. Keep sideLabels mutually exclusive.`;

async function parseWithAi(text: string, now: Date): Promise<ParsedWager | null> {
  if (!env.openaiApiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: env.openaiModel,
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 500,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Today is ${now.toISOString()}.\n\nBet: ${text}` },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`NL parse: model returned ${response.status}`);
      return null;
    }

    const data = (await response.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);
    const sides = Array.isArray(parsed.sideLabels) ? parsed.sideLabels.slice(0, 2) : [];
    if (sides.length !== 2) return null;

    return {
      proposition: String(parsed.proposition || extractProposition(text)),
      sideLabels: [String(sides[0]), String(sides[1])],
      stakeCents: Number.isFinite(parsed.stakeCents) ? Math.round(parsed.stakeCents) : null,
      participants: Array.isArray(parsed.participants) ? parsed.participants.map(String) : [],
      resolution: parsed.resolution === "ORACLE" ? "ORACLE" : "ATTESTATION",
      oracleSource: parsed.oracleSource ? String(parsed.oracleSource) : null,
      category: parsed.category ? String(parsed.category) : null,
      eventDeadline: parsed.eventDeadline ? String(parsed.eventDeadline) : null,
      source: "ai",
      confidence: 0.85,
    };
  } catch (error) {
    console.warn("NL parse: falling back to heuristics", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/// Natural language is the primary creation interface, so this always returns
/// usable terms — the model when it is available, deterministic rules otherwise.
export async function parseWager(text: string, now = new Date()): Promise<ParsedWager> {
  const ai = await parseWithAi(text, now);
  if (!ai) return parseHeuristically(text, now);

  // Fill any gap the model left with the deterministic parse.
  const fallback = parseHeuristically(text, now);
  return {
    ...ai,
    stakeCents: ai.stakeCents ?? fallback.stakeCents,
    participants: ai.participants.length ? ai.participants : fallback.participants,
    eventDeadline: ai.eventDeadline ?? fallback.eventDeadline,
    category: ai.category ?? fallback.category,
  };
}
