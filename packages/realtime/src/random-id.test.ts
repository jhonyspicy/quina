import { describe, expect, it } from "vitest";
import { isId } from "@quina/protocol";
import { randomId } from "./index.ts";

describe("randomId", () => {
  it("サーバーが受け付ける形式のUUID v4を作り、毎回異なる", () => {
    const ids = Array.from({ length: 100 }, randomId);
    for (const id of ids) {
      expect(isId(id)).toBe(true);
      expect(id[14]).toBe("4");
    }
    expect(new Set(ids).size).toBe(100);
  });
});
