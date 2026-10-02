/**
 * サーバー時刻の推定。受信したメッセージの送信時刻と端末の受信時刻の差を、端末の時刻のずれとみなす。
 * 通信の遅延分は補正しない。
 */
export type ServerClock = {
  /** サーバーが送った時刻を受け取り、ずれを更新する */
  sync(serverNow: number, receivedAt?: number): void;
  /** 推定したサーバーの現在時刻 */
  now(): number;
};

export function createServerClock(localNow: () => number = Date.now): ServerClock {
  let offset = 0;
  return {
    sync(serverNow, receivedAt = localNow()) {
      offset = serverNow - receivedAt;
    },
    now() {
      return localNow() + offset;
    },
  };
}
