import { useCallback, useEffect, useState } from "react";
import { formatRemaining, getClockView, type ClockState, type Structure } from "@quina/clock";
import type { PairingServerMessage, TournamentServerMessage } from "@quina/protocol";
import {
  connect,
  connectTournament,
  createServerClock,
  resolveApiBaseUrl,
  toWebSocketUrl,
  type ConnectionStatus,
} from "@quina/realtime";
import { loadTournamentId, saveTournamentId } from "./storage.ts";
import { useNow } from "./useNow.ts";

const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

export function App() {
  const [tournamentId, setTournamentId] = useState(loadTournamentId);

  const change = useCallback((id: string | null) => {
    saveTournamentId(id);
    setTournamentId(id);
  }, []);
  const reset = useCallback(() => change(null), [change]);

  if (!tournamentId) return <Pairing onPaired={change} />;
  return <Tournament key={tournamentId} tournamentId={tournamentId} onNotFound={reset} />;
}

/** 未接続の間、PINを表示してリモコンからの入力を待つ */
function Pairing({ onPaired }: { onPaired(tournamentId: string): void }) {
  const [pin, setPin] = useState<string | null>(null);

  useEffect(() => {
    const conn = connect({
      url: toWebSocketUrl(API_BASE_URL, "/pairing/ws"),
      onStatus: (status) => {
        if (status !== "open") setPin(null);
      },
      onMessage: (data) => {
        const message = data as PairingServerMessage;
        if (message.type === "pin") setPin(message.pin);
        else onPaired(message.tournamentId);
      },
    });
    return () => conn.close();
  }, [onPaired]);

  return (
    <main className="signage pairing">
      <p className="pairing-title">サイネージに接続</p>
      <p className="pin">{pin ?? "------"}</p>
      <p className="pairing-note">リモコンの「サイネージに接続」から、このPINを入力してください</p>
    </main>
  );
}

function Tournament({ tournamentId, onNotFound }: { tournamentId: string; onNotFound(): void }) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [snapshot, setSnapshot] = useState<{
    clock: ClockState;
    structure: Structure;
    entryCount: number;
  } | null>(null);
  const [serverClock] = useState(createServerClock);
  const now = useNow(serverClock.now);

  useEffect(() => {
    const conn = connectTournament({
      apiBaseUrl: API_BASE_URL,
      tournamentId,
      deviceId: null,
      onStatus: setStatus,
      onNotFound,
      onMessage: (message: TournamentServerMessage) => {
        if (message.type !== "state") return;
        serverClock.sync(message.serverNow);
        setSnapshot({
          clock: message.clock,
          structure: message.structure,
          entryCount: message.entryCount,
        });
      },
    });
    return () => conn.close();
  }, [tournamentId, onNotFound, serverClock]);

  // 切断中も受信済みの状態から時計を進める
  const view = snapshot && getClockView(snapshot.clock, snapshot.structure, now);
  const disconnected = status !== "open" && snapshot !== null;

  return (
    <main className="signage">
      {disconnected && <p className="disconnected">接続切れ</p>}
      {!view ? null : view.status === "waiting" ? (
        <div className="waiting">
          <p className="waiting-title">まもなく開始</p>
          <p className="waiting-entries">
            エントリー <span>{snapshot.entryCount}</span>
          </p>
          <p className="waiting-note">スタッフの開始操作をお待ちください</p>
        </div>
      ) : (
        <div className="timer">
          <p className="level">LEVEL {view.levelIndex! + 1}</p>
          <p className="entries">ENTRIES {snapshot.entryCount}</p>
          <p className={`time${view.status === "paused" ? " paused" : ""}`}>
            {formatRemaining(view.remainingMs!)}
          </p>
          <p className="timer-status">
            {view.finished ? "最終レベル終了" : view.status === "paused" ? "一時停止中" : ""}
          </p>
        </div>
      )}
    </main>
  );
}
