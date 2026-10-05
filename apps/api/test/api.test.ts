import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { PairingServerMessage, TournamentServerMessage } from "@quina/protocol";
import worker from "../src/index.ts";

const ORIGIN = "https://api.example.com";

type Message = { type: string };

type Socket<T extends Message> = {
  ws: WebSocket;
  /** 指定した種類の次のメッセージを待つ。他の種類のメッセージはそれぞれの順番で保持する */
  next<K extends T["type"]>(type: K): Promise<Extract<T, { type: K }>>;
  closed: Promise<CloseEvent>;
  send(message: unknown): void;
};

async function openSocket<T extends Message>(path: string): Promise<Socket<T>> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, { headers: { Upgrade: "websocket" } });
  const ws = response.webSocket;
  if (!ws) throw new Error(`expected websocket: ${response.status}`);
  const queues = new Map<string, T[]>();
  const waiters = new Map<string, ((message: T) => void)[]>();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string) as T;
    const waiter = waiters.get(message.type)?.shift();
    if (waiter) waiter(message);
    else queues.set(message.type, [...(queues.get(message.type) ?? []), message]);
  });
  const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve));
  ws.accept();
  return {
    ws,
    closed,
    next: (type) => {
      const queued = queues.get(type)?.shift();
      if (queued) return Promise.resolve(queued as never);
      return new Promise((resolve) =>
        waiters.set(type, [...(waiters.get(type) ?? []), resolve as (message: T) => void]),
      );
    },
    send: (message) => ws.send(JSON.stringify(message)),
  };
}

async function createTournament(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/dev/tournaments`, { method: "POST" });
  expect(response.status).toBe(201);
  const { tournamentId } = await response.json<{ tournamentId: string }>();
  return tournamentId;
}

const connectSignage = (id: string) =>
  openSocket<TournamentServerMessage>(`/api/tournaments/${id}/ws?role=signage`);

/** リモコンとして接続し、最初に届く識別番号を受け取る */
async function connectRemote(id: string, deviceId: string = crypto.randomUUID()) {
  const socket = await openSocket<TournamentServerMessage>(
    `/api/tournaments/${id}/ws?role=remote&device=${deviceId}`,
  );
  const welcome = await socket.next("welcome");
  return {
    ...socket,
    remoteNumber: welcome.remoteNumber,
    /** 新しい操作IDを付けて送り、その操作IDを返す */
    command(action: Record<string, unknown>, opId: string = crypto.randomUUID()) {
      socket.send({ ...action, opId });
      return opId;
    },
  };
}

describe("開発用の大会作成", () => {
  it("ALLOW_DEV_ENDPOINTS が true でなければ使えない", async () => {
    const request = new Request<unknown, IncomingRequestCfProperties>(`${ORIGIN}/api/dev/tournaments`, {
      method: "POST",
    });
    const response = await worker.fetch(request, { ...env, ALLOW_DEV_ENDPOINTS: "false" });
    expect(response.status).toBe(404);
  });
});

describe("大会への接続と時計の操作", () => {
  it("接続すると待機中の状態を受け取り、リモコンの開始が全端末に配信される", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    const signage = await connectSignage(id);

    expect(await remote.next("state")).toMatchObject({ type: "state", clock: { status: "waiting" } });
    expect(await signage.next("state")).toMatchObject({ type: "state", clock: { status: "waiting" } });

    remote.command({ type: "start" });
    expect(await remote.next("state")).toMatchObject({ clock: { status: "running", levelIndex: 0 } });
    expect(await signage.next("state")).toMatchObject({ clock: { status: "running", levelIndex: 0 } });
  });

  it("開始済みの大会への開始は無視し、続く操作だけを配信する", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    await remote.next("state");

    remote.command({ type: "start" });
    await remote.next("state");
    remote.command({ type: "start" });
    remote.command({ type: "setRemaining", remainingMs: 60_000 });
    expect(await remote.next("state")).toMatchObject({
      clock: { status: "running", remainingMs: 60_000 },
    });
  });

  it("一時停止・再開・残り時間の変更を配信する", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    await remote.next("state");
    remote.command({ type: "start" });
    await remote.next("state");

    remote.command({ type: "pause" });
    expect(await remote.next("state")).toMatchObject({ clock: { status: "paused" } });
    remote.command({ type: "setRemaining", remainingMs: 60_000 });
    expect(await remote.next("state")).toMatchObject({ clock: { status: "paused", remainingMs: 60_000 } });
    remote.command({ type: "resume" });
    expect(await remote.next("state")).toMatchObject({ clock: { status: "running", remainingMs: 60_000 } });
  });

  it("サイネージからの操作は受け付けない", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    const signage = await connectSignage(id);
    await remote.next("state");
    await signage.next("state");

    remote.command({ type: "start" });
    await remote.next("state");
    signage.send({ type: "pause", opId: crypto.randomUUID() });
    remote.command({ type: "setRemaining", remainingMs: 1000 });
    expect(await remote.next("state")).toMatchObject({ clock: { status: "running", remainingMs: 1000 } });
  });

  it("再接続すると最新の状態を受け取る", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    await remote.next("state");
    remote.command({ type: "start" });
    await remote.next("state");

    const signage = await connectSignage(id);
    expect(await signage.next("state")).toMatchObject({ clock: { status: "running" } });
  });

  it("準備されていない大会への接続はクローズコード4404で切断する", async () => {
    const socket = await connectSignage(crypto.randomUUID());
    expect((await socket.closed).code).toBe(4404);
  });
});

describe("PINによるサイネージの接続", () => {
  it("リモコンが入力したPINのサイネージに大会を伝え、使用済みのPINは無効にする", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    await remote.next("state");

    const signage = await openSocket<PairingServerMessage>("/api/pairing/ws");
    const { pin } = await signage.next("pin");
    expect(pin).toMatch(/^\d{6}$/);

    remote.command({ type: "pairSignage", pin });
    expect(await signage.next("paired")).toEqual({ type: "paired", tournamentId: id });
    expect(await remote.next("pairSignageResult")).toEqual({ type: "pairSignageResult", pin, ok: true });

    remote.command({ type: "pairSignage", pin });
    expect(await remote.next("pairSignageResult")).toEqual({ type: "pairSignageResult", pin, ok: false });
  });
});

describe("リモコンの識別番号", () => {
  it("大会内で接続順に番号を割り当て、同じ端末には同じ番号を返す", async () => {
    const id = await createTournament();
    const deviceA = crypto.randomUUID();
    const deviceB = crypto.randomUUID();

    const a = await connectRemote(id, deviceA);
    const b = await connectRemote(id, deviceB);
    expect([a.remoteNumber, b.remoteNumber]).toEqual([1, 2]);

    a.ws.close();
    const reconnected = await connectRemote(id, deviceA);
    expect(reconnected.remoteNumber).toBe(1);
  });

  it("別の大会では番号を振り直す", async () => {
    const device = crypto.randomUUID();
    const first = await createTournament();
    await connectRemote(first);
    expect((await connectRemote(first, device)).remoteNumber).toBe(2);

    expect((await connectRemote(await createTournament(), device)).remoteNumber).toBe(1);
  });

  it("端末IDのないリモコン接続は受け付けない", async () => {
    const id = await createTournament();
    const response = await SELF.fetch(`${ORIGIN}/api/tournaments/${id}/ws?role=remote`, {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(400);
  });
});

describe("操作の重複防止", () => {
  it("同じ操作IDの操作が再び届いても一度しか処理しない", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    await remote.next("state");

    remote.command({ type: "start" });
    await remote.next("state");
    const pauseOp = remote.command({ type: "pause" });
    expect(await remote.next("state")).toMatchObject({ clock: { status: "paused" } });
    remote.command({ type: "resume" });
    expect(await remote.next("state")).toMatchObject({ clock: { status: "running" } });

    // 一時停止の再送は無視され、続く操作だけが配信される
    remote.command({ type: "pause" }, pauseOp);
    remote.command({ type: "setRemaining", remainingMs: 1000 });
    expect(await remote.next("state")).toMatchObject({ clock: { status: "running", remainingMs: 1000 } });
  });

  it("別の端末から同じ内容の操作が届いた場合は、それぞれ処理する", async () => {
    const id = await createTournament();
    const a = await connectRemote(id);
    const b = await connectRemote(id);
    await a.next("state");
    await b.next("state");

    a.command({ type: "start" });
    await a.next("state");
    await b.next("state");
    a.command({ type: "pause" });
    await a.next("state");
    await b.next("state");
    b.command({ type: "resume" });
    expect(await a.next("state")).toMatchObject({ clock: { status: "running" } });
  });
});

describe("エントリー", () => {
  it("リモコンが追加したエントリーの数を、サイネージを含む全端末へ配信する", async () => {
    const id = await createTournament();
    const a = await connectRemote(id);
    const b = await connectRemote(id);
    const signage = await connectSignage(id);
    expect(await signage.next("state")).toMatchObject({ entryCount: 0 });
    await a.next("state");
    await b.next("state");

    a.command({ type: "addEntry" });
    expect(await signage.next("state")).toMatchObject({ entryCount: 1, clock: { status: "waiting" } });
    b.command({ type: "addEntry" });
    expect(await signage.next("state")).toMatchObject({ entryCount: 2 });
  });

  it("リモコンにだけ、追加したリモコンの番号を含む一覧を送る", async () => {
    const id = await createTournament();
    const a = await connectRemote(id);
    const b = await connectRemote(id);
    expect(await a.next("entries")).toEqual({ type: "entries", entries: [] });
    await b.next("entries");

    b.command({ type: "addEntry" });
    const { entries } = await a.next("entries");
    expect(entries).toEqual([
      { id: 1, addedAt: expect.any(Number), addedBy: 2, cancelledAt: null, cancelledBy: null },
    ]);
  });

  it("同じ操作IDの追加は一件だけ計上する", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    await remote.next("state");

    const opId = remote.command({ type: "addEntry" });
    expect(await remote.next("state")).toMatchObject({ entryCount: 1 });
    remote.command({ type: "addEntry" }, opId);
    remote.command({ type: "addEntry" });
    expect(await remote.next("state")).toMatchObject({ entryCount: 2 });
  });

  it("開始後もエントリーを追加できる", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    await remote.next("state");
    remote.command({ type: "start" });
    await remote.next("state");

    remote.command({ type: "addEntry" });
    expect(await remote.next("state")).toMatchObject({ entryCount: 1, clock: { status: "running" } });
  });

  it("別のリモコンが追加したエントリーを取り消せ、追加と取り消しの両方のリモコンを残す", async () => {
    const id = await createTournament();
    const a = await connectRemote(id);
    const b = await connectRemote(id);
    await a.next("entries");
    await b.next("entries");

    a.command({ type: "addEntry" });
    await b.next("entries");
    b.command({ type: "cancelEntry", entryId: 1 });

    expect(await a.next("state")).toMatchObject({ entryCount: 0 });
    expect(await a.next("state")).toMatchObject({ entryCount: 1 });
    expect(await a.next("state")).toMatchObject({ entryCount: 0 });
    await a.next("entries");
    const { entries } = await a.next("entries");
    expect(entries).toEqual([
      { id: 1, addedAt: expect.any(Number), addedBy: 1, cancelledAt: expect.any(Number), cancelledBy: 2 },
    ]);
  });

  it("取り消し済み・存在しないエントリーの取り消しは無視する", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    await remote.next("state");
    remote.command({ type: "addEntry" });
    remote.command({ type: "addEntry" });
    await remote.next("state");
    await remote.next("state");

    remote.command({ type: "cancelEntry", entryId: 1 });
    expect(await remote.next("state")).toMatchObject({ entryCount: 1 });
    remote.command({ type: "cancelEntry", entryId: 1 });
    remote.command({ type: "cancelEntry", entryId: 99 });
    remote.command({ type: "cancelEntry", entryId: 2 });
    expect(await remote.next("state")).toMatchObject({ entryCount: 0 });
  });

  it("再接続したサイネージは現在のエントリー数を受け取る", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    await remote.next("state");
    remote.command({ type: "addEntry" });
    await remote.next("state");

    const signage = await connectSignage(id);
    expect(await signage.next("state")).toMatchObject({ entryCount: 1 });
  });
});

describe("操作履歴", () => {
  it("接続したリモコンに、それまでの履歴を古い順に送る", async () => {
    const id = await createTournament();
    const a = await connectRemote(id);
    expect(await a.next("history")).toEqual({ type: "history", items: [] });
    a.command({ type: "addEntry" });
    a.command({ type: "start" });
    await a.next("historyAppended");
    await a.next("historyAppended");

    const b = await connectRemote(id);
    const { items } = await b.next("history");
    expect(items.map((item) => [item.remoteNumber, item.action])).toEqual([
      [1, { type: "addEntry", entryId: 1 }],
      [1, { type: "start" }],
    ]);
    expect(items[0]!.seq).toBeLessThan(items[1]!.seq);
  });

  it("どのリモコンの操作かを、全リモコンへ1件ずつ送る", async () => {
    const id = await createTournament();
    const a = await connectRemote(id);
    const b = await connectRemote(id);
    await a.next("history");
    await b.next("history");

    b.command({ type: "start" });
    expect(await a.next("historyAppended")).toMatchObject({
      item: { remoteNumber: 2, action: { type: "start" }, at: expect.any(Number) },
    });
    expect(await b.next("historyAppended")).toMatchObject({ item: { remoteNumber: 2 } });
  });

  it("残り時間の変更は変更前と変更後の残り時間を残す", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    remote.command({ type: "start" });
    remote.command({ type: "pause" });
    await remote.next("historyAppended");
    await remote.next("historyAppended");

    remote.command({ type: "setRemaining", remainingMs: 60_000 });
    const { item } = await remote.next("historyAppended");
    expect(item.action).toMatchObject({ type: "setRemaining", remainingMs: 60_000 });
    if (item.action.type !== "setRemaining") throw new Error("expected setRemaining");
    expect(item.action.previousRemainingMs).toBeGreaterThan(19 * 60_000);
  });

  it("他のリモコンが追加したエントリーの取り消しは、追加と取り消しの両方を残す", async () => {
    const id = await createTournament();
    const a = await connectRemote(id);
    const b = await connectRemote(id);
    a.command({ type: "addEntry" });
    await b.next("historyAppended");
    b.command({ type: "cancelEntry", entryId: 1 });
    await b.next("historyAppended");

    const c = await connectRemote(id);
    const { items } = await c.next("history");
    expect(items.map((item) => [item.remoteNumber, item.action])).toEqual([
      [1, { type: "addEntry", entryId: 1 }],
      [2, { type: "cancelEntry", entryId: 1 }],
    ]);
  });

  it("状態を変えなかった操作は履歴に残さない", async () => {
    const id = await createTournament();
    const remote = await connectRemote(id);
    const opId = remote.command({ type: "start" });
    await remote.next("historyAppended");

    remote.command({ type: "start" });
    remote.command({ type: "start" }, opId);
    remote.command({ type: "resume" });
    remote.command({ type: "cancelEntry", entryId: 1 });
    remote.command({ type: "pairSignage", pin: "000000" });
    await remote.next("pairSignageResult");
    remote.command({ type: "pause" });
    expect(await remote.next("historyAppended")).toMatchObject({ item: { action: { type: "pause" } } });

    const other = await connectRemote(id);
    const { items } = await other.next("history");
    expect(items.map((item) => item.action.type)).toEqual(["start", "pause"]);
  });
});
