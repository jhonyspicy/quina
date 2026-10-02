import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { PairingServerMessage, TournamentServerMessage } from "@quina/protocol";
import worker from "../src/index.ts";

const ORIGIN = "https://api.example.com";

type Socket<T> = {
  ws: WebSocket;
  next(): Promise<T>;
  closed: Promise<CloseEvent>;
  send(message: unknown): void;
};

async function openSocket<T>(path: string): Promise<Socket<T>> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, { headers: { Upgrade: "websocket" } });
  const ws = response.webSocket;
  if (!ws) throw new Error(`expected websocket: ${response.status}`);
  const queue: T[] = [];
  const waiters: ((message: T) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string) as T;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve));
  ws.accept();
  return {
    ws,
    closed,
    next: () => {
      const queued = queue.shift();
      return queued ? Promise.resolve(queued) : new Promise((resolve) => waiters.push(resolve));
    },
    send: (message) => ws.send(JSON.stringify(message)),
  };
}

async function createTournament(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/dev/tournaments`, { method: "POST" });
  expect(response.status).toBe(201);
  const { tournamentId } = await response.json<{ tournamentId: string }>();
  return tournamentId;
}

const connectTournament = (id: string, role: "remote" | "signage") =>
  openSocket<TournamentServerMessage>(`/tournaments/${id}/ws?role=${role}`);

describe("開発用の大会作成", () => {
  it("ALLOW_DEV_ENDPOINTS が true でなければ使えない", async () => {
    const request = new Request<unknown, IncomingRequestCfProperties>(`${ORIGIN}/dev/tournaments`, {
      method: "POST",
    });
    const response = await worker.fetch(request, { ...env, ALLOW_DEV_ENDPOINTS: "false" });
    expect(response.status).toBe(404);
  });
});

describe("大会への接続と時計の操作", () => {
  it("接続すると待機中の状態を受け取り、リモコンの開始が全端末に配信される", async () => {
    const id = await createTournament();
    const remote = await connectTournament(id, "remote");
    const signage = await connectTournament(id, "signage");

    expect(await remote.next()).toMatchObject({ type: "state", clock: { status: "waiting" } });
    expect(await signage.next()).toMatchObject({ type: "state", clock: { status: "waiting" } });

    remote.send({ type: "start" });
    expect(await remote.next()).toMatchObject({ clock: { status: "running", levelIndex: 0 } });
    expect(await signage.next()).toMatchObject({ clock: { status: "running", levelIndex: 0 } });
  });

  it("開始済みの大会への開始は無視し、続く操作だけを配信する", async () => {
    const id = await createTournament();
    const remote = await connectTournament(id, "remote");
    await remote.next();

    remote.send({ type: "start" });
    await remote.next();
    remote.send({ type: "start" });
    remote.send({ type: "setRemaining", remainingMs: 60_000 });
    expect(await remote.next()).toMatchObject({
      clock: { status: "running", remainingMs: 60_000 },
    });
  });

  it("一時停止・再開・残り時間の変更を配信する", async () => {
    const id = await createTournament();
    const remote = await connectTournament(id, "remote");
    await remote.next();
    remote.send({ type: "start" });
    await remote.next();

    remote.send({ type: "pause" });
    expect(await remote.next()).toMatchObject({ clock: { status: "paused" } });
    remote.send({ type: "setRemaining", remainingMs: 60_000 });
    expect(await remote.next()).toMatchObject({ clock: { status: "paused", remainingMs: 60_000 } });
    remote.send({ type: "resume" });
    expect(await remote.next()).toMatchObject({ clock: { status: "running", remainingMs: 60_000 } });
  });

  it("サイネージからの操作は受け付けない", async () => {
    const id = await createTournament();
    const remote = await connectTournament(id, "remote");
    const signage = await connectTournament(id, "signage");
    await remote.next();
    await signage.next();

    remote.send({ type: "start" });
    await remote.next();
    signage.send({ type: "pause" });
    remote.send({ type: "setRemaining", remainingMs: 1000 });
    expect(await remote.next()).toMatchObject({ clock: { status: "running", remainingMs: 1000 } });
  });

  it("再接続すると最新の状態を受け取る", async () => {
    const id = await createTournament();
    const remote = await connectTournament(id, "remote");
    await remote.next();
    remote.send({ type: "start" });
    await remote.next();

    const signage = await connectTournament(id, "signage");
    expect(await signage.next()).toMatchObject({ clock: { status: "running" } });
  });

  it("準備されていない大会への接続はクローズコード4404で切断する", async () => {
    const socket = await connectTournament(crypto.randomUUID(), "signage");
    expect((await socket.closed).code).toBe(4404);
  });
});

describe("PINによるサイネージの接続", () => {
  it("リモコンが入力したPINのサイネージに大会を伝え、使用済みのPINは無効にする", async () => {
    const id = await createTournament();
    const remote = await connectTournament(id, "remote");
    await remote.next();

    const signage = await openSocket<PairingServerMessage>("/pairing/ws");
    const pinMessage = await signage.next();
    if (pinMessage.type !== "pin") throw new Error("expected pin");
    expect(pinMessage.pin).toMatch(/^\d{6}$/);

    remote.send({ type: "pairSignage", pin: pinMessage.pin });
    expect(await signage.next()).toEqual({ type: "paired", tournamentId: id });
    expect(await remote.next()).toEqual({ type: "pairSignageResult", pin: pinMessage.pin, ok: true });

    remote.send({ type: "pairSignage", pin: pinMessage.pin });
    expect(await remote.next()).toEqual({ type: "pairSignageResult", pin: pinMessage.pin, ok: false });
  });
});
