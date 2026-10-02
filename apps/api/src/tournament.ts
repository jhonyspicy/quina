import { DurableObject } from "cloudflare:workers";
import {
  createClock,
  pause,
  resume,
  setRemaining,
  start,
  type ClockState,
  type Structure,
} from "@quina/clock";
import {
  CLOSE_TOURNAMENT_NOT_FOUND,
  parseRemoteCommand,
  type RemoteCommand,
  type TournamentServerMessage,
} from "@quina/protocol";
import { closeQuietly } from "./pairing.ts";

export type Role = "remote" | "signage";

type Tournament = {
  id: string;
  structure: Structure;
  clock: ClockState;
};

const STORAGE_KEY = "tournament";

/**
 * 大会1件につき1インスタンス。大会の状態の唯一の正として、リモコンからの操作を順に処理し、
 * 接続中のリモコン・サイネージへ最新の状態を配信する。
 */
export class TournamentDurableObject extends DurableObject<Env> {
  /** 大会を準備する。時計は開始しない。準備済みなら何もしない。 */
  async prepare(id: string, structure: Structure): Promise<void> {
    if (await this.load()) return;
    await this.ctx.storage.put<Tournament>(STORAGE_KEY, { id, structure, clock: createClock() });
  }

  override async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get("role");
    if (role !== "remote" && role !== "signage") return new Response("invalid role", { status: 400 });

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const tournament = await this.load();
    if (!tournament) {
      // ブラウザはHTTPのステータスを読めないため、接続後にクローズコードで伝える
      server.accept();
      server.close(CLOSE_TOURNAMENT_NOT_FOUND, "tournament not found");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server, [role]);
    send(server, stateMessage(tournament));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.ctx.getTags(ws).includes("remote") || typeof message !== "string") return;
    const command = parseRemoteCommand(message);
    if (!command) return;

    const tournament = await this.load();
    if (!tournament) return;

    if (command.type === "pairSignage") {
      const ok = await this.env.PAIRING.getByName(command.pin).claim(tournament.id);
      send(ws, { type: "pairSignageResult", pin: command.pin, ok });
      return;
    }

    const clock = applyClockCommand(tournament, command, Date.now());
    if (clock === tournament.clock) return;
    const next = { ...tournament, clock };
    await this.ctx.storage.put<Tournament>(STORAGE_KEY, next);
    this.broadcast(stateMessage(next));
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    closeQuietly(ws, code, reason);
  }

  private async load(): Promise<Tournament | undefined> {
    return this.ctx.storage.get<Tournament>(STORAGE_KEY);
  }

  private broadcast(message: TournamentServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        send(ws, message);
      } catch {
        // 切断済みの端末は再接続時に最新状態を受け取る
      }
    }
  }
}

function applyClockCommand(
  { clock, structure }: Tournament,
  command: Exclude<RemoteCommand, { type: "pairSignage" }>,
  now: number,
): ClockState {
  switch (command.type) {
    case "start":
      return start(clock, structure, now);
    case "pause":
      return pause(clock, structure, now);
    case "resume":
      return resume(clock, now);
    case "setRemaining":
      return setRemaining(clock, structure, command.remainingMs, now);
  }
}

function stateMessage({ clock, structure }: Tournament): TournamentServerMessage {
  return { type: "state", clock, structure, serverNow: Date.now() };
}

function send(ws: WebSocket, message: TournamentServerMessage): void {
  ws.send(JSON.stringify(message));
}
