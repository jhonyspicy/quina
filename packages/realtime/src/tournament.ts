import { CLOSE_TOURNAMENT_NOT_FOUND, type TournamentServerMessage } from "@quina/protocol";
import { connect, type Connection, type ConnectionStatus } from "./connection.ts";

type Options = {
  /** APIのベースURL（例: `https://remote-staging.quina.poker/api`） */
  apiBaseUrl: string;
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
    url: toWebSocketUrl(options.apiBaseUrl, path),
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
 * APIのベースURL。指定がなければ、画面と同じオリジンの `/api` とする。
 * Staging・本番では同じホスト名の `/api/*` がAPIのWorkerへ、ローカルではViteがwrangler devへ振り分ける。
 */
export function resolveApiBaseUrl(configured: string | undefined): string {
  if (configured) return configured.replace(/\/$/, "");
  return `${location.origin}/api`;
}

export function toWebSocketUrl(apiBaseUrl: string, path: string): string {
  return apiBaseUrl.replace(/^http/, "ws") + path;
}
