/** 接続済みの大会を覚えておき、再読み込み後も同じ大会へ復帰する */
const KEY = "quina.signage.tournamentId";

export function loadTournamentId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveTournamentId(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // 保存できない環境では、再読み込み時にPIN画面へ戻る
  }
}
