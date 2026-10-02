import { useEffect, useState } from "react";

/** `now` を一定間隔で呼び直し、その値で再描画する */
export function useNow(now: () => number, intervalMs = 200): number {
  const [value, setValue] = useState(now);
  useEffect(() => {
    const timer = setInterval(() => setValue(now()), intervalMs);
    return () => clearInterval(timer);
  }, [now, intervalMs]);
  return value;
}
