import { resolveApiBaseUrl } from "@quina/realtime";

export const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

/** 開発用: ログインなしで固定ストラクチャーの大会を準備する */
export async function createDevTournament(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/dev/tournaments`, { method: "POST" });
  if (!response.ok) throw new Error(`大会を作成できませんでした（${response.status}）`);
  const { tournamentId } = (await response.json()) as { tournamentId: string };
  return tournamentId;
}
