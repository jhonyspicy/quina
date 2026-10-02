/**
 * トーナメントクロックの状態と計算。
 *
 * 状態は「基準」だけを持ち、毎秒の表示は `getClockView` で現在時刻から計算する。
 * 時刻はすべてUNIXエポックからのミリ秒で受け取り、関数内で現在時刻を読まない。
 */

export type Level = {
  /** レベルの長さ（ミリ秒）。正の整数。 */
  durationMs: number;
};

export type Structure = {
  levels: readonly Level[];
};

export type ClockState =
  | { status: "waiting" }
  | {
      status: "running";
      levelIndex: number;
      /** `anchoredAt` 時点での現在レベルの残り時間（ミリ秒） */
      remainingMs: number;
      anchoredAt: number;
    }
  | {
      status: "paused";
      levelIndex: number;
      remainingMs: number;
    };

export type ClockView = {
  status: ClockState["status"];
  /** 待機中は `null` */
  levelIndex: number | null;
  /** 待機中は `null`。最終レベルが終わった後は `0` */
  remainingMs: number | null;
  /** 最終レベルの時間を使い切ったか */
  finished: boolean;
};

export function createClock(): ClockState {
  return { status: "waiting" };
}

/** 待機中のときだけ最初のレベルから時計を開始する。それ以外の状態は変えない。 */
export function start(state: ClockState, structure: Structure, now: number): ClockState {
  assertValidStructure(structure);
  if (state.status !== "waiting") return state;
  return {
    status: "running",
    levelIndex: 0,
    remainingMs: structure.levels[0]!.durationMs,
    anchoredAt: now,
  };
}

/** 進行中のときだけ一時停止する。停止時点のレベルと残り時間を保持する。 */
export function pause(state: ClockState, structure: Structure, now: number): ClockState {
  if (state.status !== "running") return state;
  const { levelIndex, remainingMs } = advance(state, structure, now);
  return { status: "paused", levelIndex, remainingMs };
}

/** 一時停止中のときだけ再開する。 */
export function resume(state: ClockState, now: number): ClockState {
  if (state.status !== "paused") return state;
  return {
    status: "running",
    levelIndex: state.levelIndex,
    remainingMs: state.remainingMs,
    anchoredAt: now,
  };
}

/**
 * 現在レベルの残り時間を変更する。進行中ならそこから進み、一時停止中なら停止を保つ。
 * ストラクチャーに設定したレベル時間は変更しない。待機中は状態を変えない。
 */
export function setRemaining(
  state: ClockState,
  structure: Structure,
  remainingMs: number,
  now: number,
): ClockState {
  if (!Number.isInteger(remainingMs) || remainingMs < 0) {
    throw new RangeError(`remainingMs must be a non-negative integer: ${remainingMs}`);
  }
  switch (state.status) {
    case "waiting":
      return state;
    case "paused":
      return { ...state, remainingMs };
    case "running": {
      const { levelIndex } = advance(state, structure, now);
      return { status: "running", levelIndex, remainingMs, anchoredAt: now };
    }
  }
}

export function getClockView(state: ClockState, structure: Structure, now: number): ClockView {
  switch (state.status) {
    case "waiting":
      return { status: "waiting", levelIndex: null, remainingMs: null, finished: false };
    case "paused":
      return {
        status: "paused",
        levelIndex: state.levelIndex,
        remainingMs: state.remainingMs,
        finished: isFinished(state.levelIndex, state.remainingMs, structure),
      };
    case "running": {
      const { levelIndex, remainingMs } = advance(state, structure, now);
      return {
        status: "running",
        levelIndex,
        remainingMs,
        finished: isFinished(levelIndex, remainingMs, structure),
      };
    }
  }
}

/** 基準時刻からの経過を反映し、残り時間を使い切ったレベルを次へ進める。 */
function advance(
  state: Extract<ClockState, { status: "running" }>,
  structure: Structure,
  now: number,
): { levelIndex: number; remainingMs: number } {
  assertValidStructure(structure);
  const lastIndex = structure.levels.length - 1;
  let levelIndex = Math.min(state.levelIndex, lastIndex);
  let remainingMs = state.remainingMs - Math.max(0, now - state.anchoredAt);
  while (remainingMs <= 0 && levelIndex < lastIndex) {
    levelIndex += 1;
    remainingMs += structure.levels[levelIndex]!.durationMs;
  }
  return { levelIndex, remainingMs: Math.max(0, remainingMs) };
}

function isFinished(levelIndex: number, remainingMs: number, structure: Structure): boolean {
  return levelIndex >= structure.levels.length - 1 && remainingMs === 0;
}

function assertValidStructure(structure: Structure): void {
  if (structure.levels.length === 0) {
    throw new RangeError("structure must have at least one level");
  }
  for (const level of structure.levels) {
    if (!Number.isInteger(level.durationMs) || level.durationMs <= 0) {
      throw new RangeError(`level durationMs must be a positive integer: ${level.durationMs}`);
    }
  }
}
