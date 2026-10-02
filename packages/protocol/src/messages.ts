/**
 * リモコン・サイネージとサーバー（Durable Object）の間でWebSocketにより送受信するメッセージ。
 * すべてJSON文字列として送る。
 */
import type { ClockState, Structure } from "@quina/clock";

/** 準備されていない大会に接続したとき、サーバーがWebSocketを閉じるコード */
export const CLOSE_TOURNAMENT_NOT_FOUND = 4404;

/** リモコンから大会のDurable Objectへ送る操作 */
export type RemoteCommand =
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "setRemaining"; remainingMs: number }
  | { type: "pairSignage"; pin: string };

/** 大会のDurable Objectからリモコン・サイネージへ送るメッセージ */
export type TournamentServerMessage =
  | {
      type: "state";
      clock: ClockState;
      structure: Structure;
      /** 送信時点のサーバー時刻（ミリ秒）。端末の時刻とのずれの推定に使う */
      serverNow: number;
    }
  | { type: "pairSignageResult"; pin: string; ok: boolean };

/** PIN接続用のDurable Objectから未接続のサイネージへ送るメッセージ */
export type PairingServerMessage =
  | { type: "pin"; pin: string }
  | { type: "paired"; tournamentId: string };

/** 受信した文字列をリモコンの操作として解釈する。不正な内容なら `null` */
export function parseRemoteCommand(raw: string): RemoteCommand | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || !("type" in data)) return null;
  switch (data.type) {
    case "start":
    case "pause":
    case "resume":
      return { type: data.type };
    case "setRemaining":
      return "remainingMs" in data &&
        typeof data.remainingMs === "number" &&
        Number.isInteger(data.remainingMs) &&
        data.remainingMs >= 0
        ? { type: "setRemaining", remainingMs: data.remainingMs }
        : null;
    case "pairSignage":
      return "pin" in data && typeof data.pin === "string" && /^\d{6}$/.test(data.pin)
        ? { type: "pairSignage", pin: data.pin }
        : null;
    default:
      return null;
  }
}
