import { describe, expect, it } from "vitest";
import { createServerClock } from "./index.ts";

describe("createServerClock", () => {
  it("同期前は端末の時刻をそのまま返す", () => {
    expect(createServerClock(() => 1000).now()).toBe(1000);
  });

  it("受信時のずれを端末の時刻に足してサーバー時刻を推定する", () => {
    let local = 1000;
    const clock = createServerClock(() => local);
    clock.sync(6000);
    local = 2000;
    expect(clock.now()).toBe(7000);
  });
});
