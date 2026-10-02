import { useEffect, useRef, useState } from "react";
import type { ClockState, Structure } from "@quina/clock";
import type { RemoteCommand, TournamentServerMessage } from "@quina/protocol";
import {
  connectTournament,
  createServerClock,
  type Connection,
  type ConnectionStatus,
} from "@quina/realtime";
import { API_ORIGIN } from "./api.ts";

export type PairResult = { pin: string; ok: boolean };

export function useTournament(tournamentId: string) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [snapshot, setSnapshot] = useState<{ clock: ClockState; structure: Structure } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pairResult, setPairResult] = useState<PairResult | null>(null);
  const [serverClock] = useState(createServerClock);
  const connection = useRef<Connection | null>(null);

  useEffect(() => {
    const conn = connectTournament({
      apiOrigin: API_ORIGIN,
      tournamentId,
      role: "remote",
      onStatus: setStatus,
      onNotFound: () => setNotFound(true),
      onMessage: (message: TournamentServerMessage) => {
        if (message.type === "state") {
          serverClock.sync(message.serverNow);
          setSnapshot({ clock: message.clock, structure: message.structure });
        } else {
          setPairResult({ pin: message.pin, ok: message.ok });
        }
      },
    });
    connection.current = conn;
    return () => conn.close();
  }, [tournamentId, serverClock]);

  const send = (command: RemoteCommand) => connection.current?.send(command) ?? false;

  return { status, snapshot, notFound, pairResult, serverClock, send };
}
