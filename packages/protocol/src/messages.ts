/**
 * リモコン・サイネージとサーバー（Durable Object）の間でWebSocketにより送受信するメッセージ。
 * すべてJSON文字列として送る。
 */
import type { ClockState, Structure } from "@quina/clock";

/** 準備されていない大会に接続したとき、サーバーがWebSocketを閉じるコード */
export const CLOSE_TOURNAMENT_NOT_FOUND = 4404;

/** リモコンの操作の内容 */
export type RemoteAction =
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "setRemaining"; remainingMs: number }
  | { type: "pairSignage"; pin: string }
  | { type: "addEntry" }
  | { type: "cancelEntry"; entryId: number };

/**
 * リモコンから大会のDurable Objectへ送る操作。
 * `opId` は操作ごとに一意なID。同じ `opId` の操作が再び届いても一度しか処理しない。
 */
export type RemoteCommand = RemoteAction & { opId: string };

/** エントリー1件。リモコンは識別番号で表す */
export type Entry = {
  /** 大会内で追加順に1から振る番号 */
  id: number;
  addedAt: number;
  addedBy: number;
  /** 取り消されていなければ `null` */
  cancelledAt: number | null;
  cancelledBy: number | null;
};

/**
 * 操作履歴に残す操作。状態を変えた操作だけを残し、表示に必要な内容を加える。
 */
export type HistoryAction =
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "setRemaining"; remainingMs: number; previousRemainingMs: number }
  | { type: "pairSignage"; pin: string }
  | { type: "addEntry"; entryId: number }
  | { type: "cancelEntry"; entryId: number };

/** 操作履歴の1件。リモコンは識別番号で表す */
export type HistoryItem = {
  /** 大会内で操作を受け付けた順の番号 */
  seq: number;
  at: number;
  remoteNumber: number;
  action: HistoryAction;
};

/** 大会のDurable Objectからリモコン・サイネージへ送るメッセージ */
export type TournamentServerMessage =
  | {
      type: "state";
      clock: ClockState;
      structure: Structure;
      /** 取り消されていないエントリーの数 */
      entryCount: number;
      /** 送信時点のサーバー時刻（ミリ秒）。端末の時刻とのずれの推定に使う */
      serverNow: number;
    }
  /** 接続したリモコンにだけ送る。大会内でのリモコンの識別番号 */
  | { type: "welcome"; remoteNumber: number }
  /** リモコンにだけ送る。エントリーの一覧（取り消し済みを含む、追加順） */
  | { type: "entries"; entries: Entry[] }
  /** リモコンにだけ送る。接続直後に操作履歴の全件を古い順に送る */
  | { type: "history"; items: HistoryItem[] }
  /** リモコンにだけ送る。操作履歴に加わった1件 */
  | { type: "historyAppended"; item: HistoryItem }
  | { type: "pairSignageResult"; pin: string; ok: boolean };

/** PIN接続用のDurable Objectから未接続のサイネージへ送るメッセージ */
export type PairingServerMessage =
  | { type: "pin"; pin: string }
  | { type: "paired"; tournamentId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 操作ID・端末IDとして受け付ける形式（小文字のUUID）か */
export function isId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** 受信した文字列をリモコンの操作として解釈する。不正な内容なら `null` */
export function parseRemoteCommand(raw: string): RemoteCommand | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || !("type" in data) || !("opId" in data)) {
    return null;
  }
  if (!isId(data.opId)) return null;
  const opId = data.opId;
  switch (data.type) {
    case "start":
    case "pause":
    case "resume":
      return { type: data.type, opId };
    case "setRemaining":
      return "remainingMs" in data &&
        typeof data.remainingMs === "number" &&
        Number.isInteger(data.remainingMs) &&
        data.remainingMs >= 0
        ? { type: "setRemaining", remainingMs: data.remainingMs, opId }
        : null;
    case "pairSignage":
      return "pin" in data && typeof data.pin === "string" && /^\d{6}$/.test(data.pin)
        ? { type: "pairSignage", pin: data.pin, opId }
        : null;
    case "addEntry":
      return { type: "addEntry", opId };
    case "cancelEntry":
      return "entryId" in data &&
        typeof data.entryId === "number" &&
        Number.isInteger(data.entryId) &&
        data.entryId > 0
        ? { type: "cancelEntry", entryId: data.entryId, opId }
        : null;
    default:
      return null;
  }
}
