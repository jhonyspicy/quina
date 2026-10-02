import { describe, expect, it } from "vitest";
import { formatRemaining } from "./index.ts";

describe("formatRemaining", () => {
  it("分:秒で表し、秒未満は切り上げる", () => {
    expect(formatRemaining(20 * 60_000)).toBe("20:00");
    expect(formatRemaining(61_000)).toBe("1:01");
    expect(formatRemaining(200)).toBe("0:01");
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-500)).toBe("0:00");
  });

  it("1時間以上は時:分:秒で表す", () => {
    expect(formatRemaining(3_600_000 + 5_000)).toBe("1:00:05");
  });
});
