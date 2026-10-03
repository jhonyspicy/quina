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
  isId,
  type Entry,
  parseRemoteCommand,
  type RemoteAction,
  type RemoteCommand,
  type TournamentServerMessage,
} from "@quina/protocol";
import { closeQuietly } from "./pairing.ts";

type Tournament = {
  id: string;
  structure: Structure;
  clock: ClockState;
};

/** 接続ごとにWebSocketへ添付する情報。休止（hibernation）から復帰しても残る */
type Attachment = { role: "remote"; deviceId: string; remoteNumber: number } | { role: "signage" };

const STORAGE_KEY = "tournament";

/**
 * 大会1件につき1インスタンス。大会の状態の唯一の正として、リモコンからの操作を順に処理し、
 * 接続中のリモコン・サイネージへ最新の状態を配信する。
 *
 * ストレージ:
 * - KVの `tournament`: 大会ID・ストラクチャー・時計の状態
 * - `remotes` テーブル: 端末IDごとのリモコン識別番号
 * - `operations` テーブル: 受け付けた操作。同じ操作IDを二度処理しないために使う
 * - `entries` テーブル: エントリー。取り消しても行は残し、取り消した端末と時刻を記録する
 */
export class TournamentDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS remotes (
          device_id TEXT PRIMARY KEY,
          number INTEGER NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS operations (
          op_id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          action TEXT NOT NULL,
          received_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          added_at INTEGER NOT NULL,
          added_by TEXT NOT NULL,
          cancelled_at INTEGER,
          cancelled_by TEXT
        );
      `);
    });
  }

  /** 大会を準備する。時計は開始しない。準備済みなら何もしない。 */
  async prepare(id: string, structure: Structure): Promise<void> {
    if (this.load()) return;
    this.ctx.storage.kv.put<Tournament>(STORAGE_KEY, { id, structure, clock: createClock() });
  }

  override async fetch(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const role = params.get("role");
    const deviceId = params.get("device");
    if (role !== "remote" && role !== "signage") return new Response("invalid role", { status: 400 });
    if (role === "remote" && !isId(deviceId)) return new Response("invalid device", { status: 400 });

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const tournament = this.load();
    if (!tournament) {
      // ブラウザはHTTPのステータスを読めないため、接続後にクローズコードで伝える
      server.accept();
      server.close(CLOSE_TOURNAMENT_NOT_FOUND, "tournament not found");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server, [role]);
    if (role === "remote") {
      const remoteNumber = this.remoteNumberFor(deviceId!);
      server.serializeAttachment({ role, deviceId: deviceId!, remoteNumber } satisfies Attachment);
      send(server, { type: "welcome", remoteNumber });
      send(server, this.stateMessage(tournament));
      send(server, this.entriesMessage());
    } else {
      server.serializeAttachment({ role } satisfies Attachment);
      send(server, this.stateMessage(tournament));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (attachment?.role !== "remote" || typeof message !== "string") return;
    const command = parseRemoteCommand(message);
    if (!command) return;

    const tournament = this.load();
    if (!tournament) return;
    if (!this.recordOperation(command, attachment.deviceId)) return;

    if (command.type === "pairSignage") {
      const ok = await this.env.PAIRING.getByName(command.pin).claim(tournament.id);
      send(ws, { type: "pairSignageResult", pin: command.pin, ok });
      return;
    }

    if (command.type === "addEntry" || command.type === "cancelEntry") {
      const changed =
        command.type === "addEntry"
          ? this.addEntry(attachment.deviceId)
          : this.cancelEntry(command.entryId, attachment.deviceId);
      if (!changed) return;
      this.broadcast(this.stateMessage(tournament));
      this.broadcast(this.entriesMessage(), "remote");
      return;
    }

    const clock = applyClockAction(tournament, command, Date.now());
    if (clock === tournament.clock) return;
    const next = { ...tournament, clock };
    this.ctx.storage.kv.put<Tournament>(STORAGE_KEY, next);
    this.broadcast(this.stateMessage(next));
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    closeQuietly(ws, code, reason);
  }

  private load(): Tournament | undefined {
    return this.ctx.storage.kv.get<Tournament>(STORAGE_KEY);
  }

  /** 端末IDに対応する識別番号を返す。初めての端末には、この大会で次の番号を割り当てる。 */
  private remoteNumberFor(deviceId: string): number {
    const sql = this.ctx.storage.sql;
    const existing = sql
      .exec<{ number: number }>("SELECT number FROM remotes WHERE device_id = ?", deviceId)
      .toArray()[0];
    if (existing) return existing.number;
    return sql
      .exec<{ number: number }>(
        "INSERT INTO remotes (device_id, number) SELECT ?, COALESCE(MAX(number), 0) + 1 FROM remotes RETURNING number",
        deviceId,
      )
      .one().number;
  }

  /** 操作を記録する。同じ操作IDをすでに受け付けていれば記録せず `false` を返す。 */
  private recordOperation({ opId, ...action }: RemoteCommand, deviceId: string): boolean {
    const inserted = this.ctx.storage.sql.exec(
      "INSERT INTO operations (op_id, device_id, action, received_at) VALUES (?, ?, ?, ?) ON CONFLICT (op_id) DO NOTHING",
      opId,
      deviceId,
      JSON.stringify(action),
      Date.now(),
    );
    return inserted.rowsWritten > 0;
  }

  private addEntry(deviceId: string): boolean {
    this.ctx.storage.sql.exec(
      "INSERT INTO entries (added_at, added_by) VALUES (?, ?)",
      Date.now(),
      deviceId,
    );
    return true;
  }

  /** 取り消されていないエントリーを取り消す。存在しない・取り消し済みなら `false` */
  private cancelEntry(entryId: number, deviceId: string): boolean {
    const updated = this.ctx.storage.sql.exec(
      "UPDATE entries SET cancelled_at = ?, cancelled_by = ? WHERE id = ? AND cancelled_at IS NULL",
      Date.now(),
      deviceId,
      entryId,
    );
    return updated.rowsWritten > 0;
  }

  private entryCount(): number {
    return this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM entries WHERE cancelled_at IS NULL")
      .one().count;
  }

  private stateMessage({ clock, structure }: Tournament): TournamentServerMessage {
    return { type: "state", clock, structure, entryCount: this.entryCount(), serverNow: Date.now() };
  }

  private entriesMessage(): TournamentServerMessage {
    const entries = this.ctx.storage.sql
      .exec<Entry>(
        `SELECT e.id, e.added_at AS addedAt, a.number AS addedBy,
                e.cancelled_at AS cancelledAt, c.number AS cancelledBy
         FROM entries e
         JOIN remotes a ON a.device_id = e.added_by
         LEFT JOIN remotes c ON c.device_id = e.cancelled_by
         ORDER BY e.id`,
      )
      .toArray();
    return { type: "entries", entries };
  }

  /** 接続中の端末へ送る。`role` を指定すると、その役割の端末にだけ送る */
  private broadcast(message: TournamentServerMessage, role?: Attachment["role"]): void {
    for (const ws of this.ctx.getWebSockets(role)) {
      try {
        send(ws, message);
      } catch {
        // 切断済みの端末は再接続時に最新状態を受け取る
      }
    }
  }
}

function applyClockAction(
  { clock, structure }: Tournament,
  action: Extract<RemoteAction, { type: "start" | "pause" | "resume" | "setRemaining" }>,
  now: number,
): ClockState {
  switch (action.type) {
    case "start":
      return start(clock, structure, now);
    case "pause":
      return pause(clock, structure, now);
    case "resume":
      return resume(clock, now);
    case "setRemaining":
      return setRemaining(clock, structure, action.remainingMs, now);
  }
}

function send(ws: WebSocket, message: TournamentServerMessage): void {
  ws.send(JSON.stringify(message));
}
