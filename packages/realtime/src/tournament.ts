import { CLOSE_TOURNAMENT_NOT_FOUND, type TournamentServerMessage } from "@quina/protocol";
import { connect, type Connection, type ConnectionStatus } from "./connection.ts";

type Options = {
  apiOrigin: string;
  tournamentId: string;
  /** リモコンとして接続する場合は端末ID、サイネージなら `null` */
  deviceId: string | null;
  onMessage(message: TournamentServerMessage): void;
  onStatus(status: ConnectionStatus): void;
  /** 大会が見つからないとき。再接続はしない */
  onNotFound(): void;
};

export function connectTournament(options: Options): Connection {
  const params = new URLSearchParams(
    options.deviceId === null ? { role: "signage" } : { role: "remote", device: options.deviceId },
  );
  const path = `/tournaments/${encodeURIComponent(options.tournamentId)}/ws?${params}`;
  return connect({
    url: toWebSocketUrl(options.apiOrigin, path),
    onMessage: (data) => options.onMessage(data as TournamentServerMessage),
    onStatus: options.onStatus,
    onClose: (event) => {
      if (event.code !== CLOSE_TOURNAMENT_NOT_FOUND) return true;
      options.onNotFound();
      return false;
    },
  });
}

/**
 * APIのオリジン。指定がなければ、画面を開いたホストの8787番ポート（wrangler dev）とする。
 * 同じLANのスマホから開いた場合も、そのPCのAPIへつながる。
 */
export function resolveApiOrigin(configured: string | undefined): string {
  if (configured) return configured.replace(/\/$/, "");
  return `${location.protocol}//${location.hostname}:8787`;
}

export function toWebSocketUrl(apiOrigin: string, path: string): string {
  return apiOrigin.replace(/^http/, "ws") + path;
}
