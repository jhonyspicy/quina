import { describe, expect, it } from "vitest";
import { parseRemoteCommand } from "./index.ts";

describe("parseRemoteCommand", () => {
  it("正しい操作を解釈する", () => {
    expect(parseRemoteCommand('{"type":"start"}')).toEqual({ type: "start" });
    expect(parseRemoteCommand('{"type":"pause","extra":1}')).toEqual({ type: "pause" });
    expect(parseRemoteCommand('{"type":"setRemaining","remainingMs":60000}')).toEqual({
      type: "setRemaining",
      remainingMs: 60000,
    });
    expect(parseRemoteCommand('{"type":"pairSignage","pin":"012345"}')).toEqual({
      type: "pairSignage",
      pin: "012345",
    });
  });

  it("不正な内容は null を返す", () => {
    expect(parseRemoteCommand("not json")).toBeNull();
    expect(parseRemoteCommand("null")).toBeNull();
    expect(parseRemoteCommand('{"type":"unknown"}')).toBeNull();
    expect(parseRemoteCommand('{"type":"setRemaining","remainingMs":-1}')).toBeNull();
    expect(parseRemoteCommand('{"type":"setRemaining","remainingMs":"60000"}')).toBeNull();
    expect(parseRemoteCommand('{"type":"pairSignage","pin":"12345"}')).toBeNull();
    expect(parseRemoteCommand('{"type":"pairSignage","pin":"abcdef"}')).toBeNull();
  });
});
