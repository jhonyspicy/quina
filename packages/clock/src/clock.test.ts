import { describe, expect, it } from "vitest";
import {
  createClock,
  getClockView,
  pause,
  resume,
  setRemaining,
  start,
  type Structure,
} from "./index.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 2, 19, 0, 0);
const structure: Structure = {
  levels: [{ durationMs: 20 * MIN }, { durationMs: 20 * MIN }, { durationMs: 30 * MIN }],
};

describe("待機と開始", () => {
  it("開始するまでは待機を続ける", () => {
    const view = getClockView(createClock(), structure, T0 + 60 * MIN);
    expect(view).toEqual({ status: "waiting", levelIndex: null, remainingMs: null, finished: false });
  });

  it("開始すると最初のレベルの時間から進む", () => {
    const clock = start(createClock(), structure, T0);
    expect(getClockView(clock, structure, T0 + 5 * MIN)).toMatchObject({
      status: "running",
      levelIndex: 0,
      remainingMs: 15 * MIN,
    });
  });

  it("開始済みの時計に後から開始が届いても時計をリセットしない", () => {
    const clock = start(createClock(), structure, T0);
    expect(start(clock, structure, T0 + 5 * MIN)).toBe(clock);
  });
});

describe("レベルの進行", () => {
  it("レベルの時間を使い切ると次のレベルへ進む", () => {
    const clock = start(createClock(), structure, T0);
    expect(getClockView(clock, structure, T0 + 20 * MIN)).toMatchObject({
      levelIndex: 1,
      remainingMs: 20 * MIN,
    });
    expect(getClockView(clock, structure, T0 + 45 * MIN)).toMatchObject({
      levelIndex: 2,
      remainingMs: 25 * MIN,
    });
  });

  it("最終レベルを使い切ると残り0のまま終了状態になる", () => {
    const clock = start(createClock(), structure, T0);
    expect(getClockView(clock, structure, T0 + 999 * MIN)).toEqual({
      status: "running",
      levelIndex: 2,
      remainingMs: 0,
      finished: true,
    });
  });
});

describe("一時停止と再開", () => {
  it("一時停止中は時間が進まず、再開するとそこから進む", () => {
    let clock = start(createClock(), structure, T0);
    clock = pause(clock, structure, T0 + 5 * MIN);
    expect(getClockView(clock, structure, T0 + 30 * MIN)).toMatchObject({
      status: "paused",
      levelIndex: 0,
      remainingMs: 15 * MIN,
    });

    clock = resume(clock, T0 + 30 * MIN);
    expect(getClockView(clock, structure, T0 + 32 * MIN)).toMatchObject({
      status: "running",
      levelIndex: 0,
      remainingMs: 13 * MIN,
    });
  });

  it("レベルをまたいだ後に一時停止すると、その時点のレベルを保持する", () => {
    const clock = pause(start(createClock(), structure, T0), structure, T0 + 25 * MIN);
    expect(clock).toEqual({ status: "paused", levelIndex: 1, remainingMs: 15 * MIN });
  });

  it("待機中・停止中の一時停止、待機中・進行中の再開は状態を変えない", () => {
    const waiting = createClock();
    const running = start(waiting, structure, T0);
    const paused = pause(running, structure, T0 + MIN);
    expect(pause(waiting, structure, T0)).toBe(waiting);
    expect(pause(paused, structure, T0 + 2 * MIN)).toBe(paused);
    expect(resume(waiting, T0)).toBe(waiting);
    expect(resume(running, T0 + MIN)).toBe(running);
  });
});

describe("現在の残り時間の変更", () => {
  it("進行中に残り10分を1分にすると、1分からそのまま進む", () => {
    let clock = start(createClock(), structure, T0);
    clock = setRemaining(clock, structure, 1 * MIN, T0 + 10 * MIN);
    expect(getClockView(clock, structure, T0 + 10 * MIN)).toMatchObject({
      status: "running",
      levelIndex: 0,
      remainingMs: 1 * MIN,
    });
    expect(getClockView(clock, structure, T0 + 11 * MIN)).toMatchObject({
      levelIndex: 1,
      remainingMs: 20 * MIN,
    });
  });

  it("一時停止中に変更すると、停止を保ったまま残り時間が変わる", () => {
    let clock = pause(start(createClock(), structure, T0), structure, T0 + 10 * MIN);
    clock = setRemaining(clock, structure, 1 * MIN, T0 + 12 * MIN);
    expect(getClockView(clock, structure, T0 + 20 * MIN)).toMatchObject({
      status: "paused",
      levelIndex: 0,
      remainingMs: 1 * MIN,
    });
  });

  it("ストラクチャーのレベル時間は変えない", () => {
    let clock = start(createClock(), structure, T0);
    clock = setRemaining(clock, structure, 1 * MIN, T0);
    expect(structure.levels[0]!.durationMs).toBe(20 * MIN);
    expect(getClockView(clock, structure, T0 + 1 * MIN)).toMatchObject({
      levelIndex: 1,
      remainingMs: 20 * MIN,
    });
  });

  it("待機中は変更しない", () => {
    const waiting = createClock();
    expect(setRemaining(waiting, structure, MIN, T0)).toBe(waiting);
  });

  it("負の値や整数でない値は受け付けない", () => {
    const clock = start(createClock(), structure, T0);
    expect(() => setRemaining(clock, structure, -1, T0)).toThrow(RangeError);
    expect(() => setRemaining(clock, structure, 1.5, T0)).toThrow(RangeError);
  });
});

describe("ストラクチャーの検証", () => {
  it("レベルが空、または長さが正の整数でないストラクチャーは受け付けない", () => {
    expect(() => start(createClock(), { levels: [] }, T0)).toThrow(RangeError);
    expect(() => start(createClock(), { levels: [{ durationMs: 0 }] }, T0)).toThrow(RangeError);
  });
});
