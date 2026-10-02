import { SAMPLE_STRUCTURE } from "./sample-structure.ts";
import { PIN_HEADER } from "./pairing.ts";

export { PairingDurableObject } from "./pairing.ts";
export { TournamentDurableObject } from "./tournament.ts";

const TOURNAMENT_WS_PATH = /^\/tournaments\/([0-9a-f-]{36})\/ws$/;
const PIN_ATTEMPTS = 10;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/dev/tournaments") {
      return handleDevCreateTournament(request, env);
    }

    const tournamentMatch = TOURNAMENT_WS_PATH.exec(url.pathname);
    if (tournamentMatch) {
      if (!isWebSocketUpgrade(request)) return new Response("expected websocket", { status: 426 });
      return env.TOURNAMENT.getByName(tournamentMatch[1]!).fetch(request);
    }

    if (url.pathname === "/pairing/ws") {
      if (!isWebSocketUpgrade(request)) return new Response("expected websocket", { status: 426 });
      return connectPairing(request, env);
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/** 開発用: ログインなしで固定ストラクチャーの大会を準備する */
async function handleDevCreateTournament(request: Request, env: Env): Promise<Response> {
  if (env.ALLOW_DEV_ENDPOINTS !== "true") return new Response("not found", { status: 404 });
  const cors = { "Access-Control-Allow-Origin": "*" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: cors });

  const tournamentId = crypto.randomUUID();
  await env.TOURNAMENT.getByName(tournamentId).prepare(tournamentId, SAMPLE_STRUCTURE);
  return Response.json({ tournamentId }, { status: 201, headers: cors });
}

/** 使用中でないPINを選び、そのPINのDurable ObjectへWebSocket接続を渡す */
async function connectPairing(request: Request, env: Env): Promise<Response> {
  for (let i = 0; i < PIN_ATTEMPTS; i++) {
    const pin = randomPin();
    const headers = new Headers(request.headers);
    headers.set(PIN_HEADER, pin);
    const response = await env.PAIRING.getByName(pin).fetch(new Request(request, { headers }));
    if (response.status !== 409) return response;
  }
  return new Response("no pin available", { status: 503 });
}

function randomPin(): string {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return String(value! % 1_000_000).padStart(6, "0");
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}
