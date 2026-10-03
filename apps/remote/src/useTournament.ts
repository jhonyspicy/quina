import { useEffect, useRef, useState } from "react";
import type { ClockState, Structure } from "@quina/clock";
import type { RemoteAction, TournamentServerMessage } from "@quina/protocol";
import {
  connectTournament,
  createServerClock,
  randomId,
  type Connection,
  type ConnectionStatus,
} from "@quina/realtime";
import { API_ORIGIN } from "./api.ts";
import { loadDeviceId } from "./device.ts";

export type PairResult = { pin: string; ok: boolean };

export function useTournament(tournamentId: string) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [snapshot, setSnapshot] = useState<{ clock: ClockState; structure: Structure } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pairResult, setPairResult] = useState<PairResult | null>(null);
  const [remoteNumber, setRemoteNumber] = useState<number | null>(null);
  const [deviceId] = useState(loadDeviceId);
  const [serverClock] = useState(createServerClock);
  const connection = useRef<Connection | null>(null);

  useEffect(() => {
    const conn = connectTournament({
      apiOrigin: API_ORIGIN,
      tournamentId,
      deviceId,
      onStatus: setStatus,
      onNotFound: () => setNotFound(true),
      onMessage: (message: TournamentServerMessage) => {
        if (message.type === "state") {
          serverClock.sync(message.serverNow);
          setSnapshot({ clock: message.clock, structure: message.structure });
        } else if (message.type === "welcome") {
          setRemoteNumber(message.remoteNumber);
        } else {
          setPairResult({ pin: message.pin, ok: message.ok });
        }
      },
    });
    connection.current = conn;
    return () => conn.close();
  }, [tournamentId, deviceId, serverClock]);

  /** 操作IDを付けて送る。切断中は送らずに `false` を返す */
  const send = (action: RemoteAction) =>
    connection.current?.send({ ...action, opId: randomId() }) ?? false;

  return { status, snapshot, notFound, pairResult, remoteNumber, serverClock, send };
}
