import { DurableObject } from "cloudflare:workers";
import {
  createClock,
  getClockView,
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
  type HistoryAction,
  type HistoryItem,
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
 * - `operations` テーブル: 受け付けた操作。同じ操作IDを二度処理しないために使い、状態を変えた操作は
 *   `history` 列に操作履歴の内容を持つ
 * - `entries` テーブル: エントリー。取り消しても行は残し、取り消した端末と時刻を記録する
 */
export class TournamentDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => migrate(ctx.storage));
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
      send(server, { type: "history", items: this.historyItems() });
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

    const history = await this.apply(command, tournament, attachment.deviceId, ws);
    if (history) this.appendHistory(command.opId, history);
  }

  /** 操作を処理する。状態を変えた場合は操作履歴に残す内容を、変えなかった場合は `null` を返す。 */
  private async apply(
    command: RemoteCommand,
    tournament: Tournament,
    deviceId: string,
    ws: WebSocket,
  ): Promise<HistoryAction | null> {
    switch (command.type) {
      case "pairSignage": {
        const ok = await this.env.PAIRING.getByName(command.pin).claim(tournament.id);
        send(ws, { type: "pairSignageResult", pin: command.pin, ok });
        return ok ? { type: "pairSignage", pin: command.pin } : null;
      }
      case "addEntry": {
        const entryId = this.addEntry(deviceId);
        this.broadcastEntries(tournament);
        return { type: "addEntry", entryId };
      }
      case "cancelEntry": {
        if (!this.cancelEntry(command.entryId, deviceId)) return null;
        this.broadcastEntries(tournament);
        return { type: "cancelEntry", entryId: command.entryId };
      }
      default: {
        const now = Date.now();
        const clock = applyClockAction(tournament, command, now);
        if (clock === tournament.clock) return null;
        const next = { ...tournament, clock };
        this.ctx.storage.kv.put<Tournament>(STORAGE_KEY, next);
        this.broadcast(this.stateMessage(next));
        if (command.type !== "setRemaining") return { type: command.type };
        const previous = getClockView(tournament.clock, tournament.structure, now).remainingMs ?? 0;
        return { type: "setRemaining", remainingMs: command.remainingMs, previousRemainingMs: previous };
      }
    }
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

  /** 状態を変えた操作の履歴を保存し、リモコンへ送る */
  private appendHistory(opId: string, action: HistoryAction): void {
    const item = this.ctx.storage.sql
      .exec<HistoryRow>(
        `UPDATE operations SET history = ? WHERE op_id = ?
         RETURNING rowid AS seq, received_at AS at, device_id AS deviceId, history`,
        JSON.stringify(action),
        opId,
      )
      .toArray()
      .map((row) => this.toHistoryItem(row))[0];
    if (item) this.broadcast({ type: "historyAppended", item }, "remote");
  }

  private historyItems(): HistoryItem[] {
    return this.ctx.storage.sql
      .exec<HistoryRow>(
        `SELECT rowid AS seq, received_at AS at, device_id AS deviceId, history
         FROM operations WHERE history IS NOT NULL ORDER BY rowid`,
      )
      .toArray()
      .map((row) => this.toHistoryItem(row));
  }

  private toHistoryItem(row: HistoryRow): HistoryItem {
    return {
      seq: row.seq,
      at: row.at,
      remoteNumber: this.remoteNumberFor(row.deviceId),
      action: JSON.parse(row.history) as HistoryAction,
    };
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

  /** エントリーを追加し、その番号を返す */
  private addEntry(deviceId: string): number {
    return this.ctx.storage.sql
      .exec<{ id: number }>(
        "INSERT INTO entries (added_at, added_by) VALUES (?, ?) RETURNING id",
        Date.now(),
        deviceId,
      )
      .one().id;
  }

  private broadcastEntries(tournament: Tournament): void {
    this.broadcast(this.stateMessage(tournament));
    this.broadcast(this.entriesMessage(), "remote");
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

type HistoryRow = { seq: number; at: number; deviceId: string; history: string };

/**
 * ストレージのテーブルの変更。適用済みの数をKVの `schemaVersion` に保存し、未適用の変更だけを順に適用する。
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS remotes (
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
   );`,
  `ALTER TABLE operations ADD COLUMN history TEXT;`,
];

async function migrate(storage: DurableObjectStorage): Promise<void> {
  const applied = storage.kv.get<number>("schemaVersion") ?? 0;
  for (const migration of MIGRATIONS.slice(applied)) storage.sql.exec(migration);
  storage.kv.put("schemaVersion", MIGRATIONS.length);
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
