import type { Structure } from "@quina/clock";

const MINUTE = 60_000;

/** ストラクチャー設定の実装までの間、開発用の大会に使う固定のストラクチャー */
export const SAMPLE_STRUCTURE: Structure = {
  levels: Array.from({ length: 10 }, () => ({ durationMs: 20 * MINUTE })),
};
