import { describe, expect, it } from "vitest";
import { isId, parseRemoteCommand } from "./index.ts";

const OP = "0b9c1f8e-6a52-4e7d-9a1f-3c2b5d7e8f90";
const cmd = (body: Record<string, unknown>) => JSON.stringify({ opId: OP, ...body });

describe("parseRemoteCommand", () => {
  it("正しい操作を解釈する", () => {
    expect(parseRemoteCommand(cmd({ type: "start" }))).toEqual({ type: "start", opId: OP });
    expect(parseRemoteCommand(cmd({ type: "pause", extra: 1 }))).toEqual({ type: "pause", opId: OP });
    expect(parseRemoteCommand(cmd({ type: "setRemaining", remainingMs: 60000 }))).toEqual({
      type: "setRemaining",
      remainingMs: 60000,
      opId: OP,
    });
    expect(parseRemoteCommand(cmd({ type: "pairSignage", pin: "012345" }))).toEqual({
      type: "pairSignage",
      pin: "012345",
      opId: OP,
    });
    expect(parseRemoteCommand(cmd({ type: "addEntry" }))).toEqual({ type: "addEntry", opId: OP });
    expect(parseRemoteCommand(cmd({ type: "cancelEntry", entryId: 3 }))).toEqual({
      type: "cancelEntry",
      entryId: 3,
      opId: OP,
    });
  });

  it("不正な内容は null を返す", () => {
    expect(parseRemoteCommand("not json")).toBeNull();
    expect(parseRemoteCommand("null")).toBeNull();
    expect(parseRemoteCommand(cmd({ type: "unknown" }))).toBeNull();
    expect(parseRemoteCommand(cmd({ type: "setRemaining", remainingMs: -1 }))).toBeNull();
    expect(parseRemoteCommand(cmd({ type: "setRemaining", remainingMs: "60000" }))).toBeNull();
    expect(parseRemoteCommand(cmd({ type: "pairSignage", pin: "12345" }))).toBeNull();
    expect(parseRemoteCommand(cmd({ type: "pairSignage", pin: "abcdef" }))).toBeNull();
    expect(parseRemoteCommand(cmd({ type: "cancelEntry" }))).toBeNull();
    expect(parseRemoteCommand(cmd({ type: "cancelEntry", entryId: 0 }))).toBeNull();
    expect(parseRemoteCommand(cmd({ type: "cancelEntry", entryId: 1.5 }))).toBeNull();
  });

  it("操作IDがない・形式が違う操作は null を返す", () => {
    expect(parseRemoteCommand('{"type":"start"}')).toBeNull();
    expect(parseRemoteCommand('{"type":"start","opId":"abc"}')).toBeNull();
  });
});

describe("isId", () => {
  it("小文字のUUIDだけを受け付ける", () => {
    expect(isId(OP)).toBe(true);
    expect(isId(OP.toUpperCase())).toBe(false);
    expect(isId("")).toBe(false);
    expect(isId(1)).toBe(false);
  });
});
