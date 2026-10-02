/**
 * サーバーへのWebSocket接続を保ち、切断されたら待ち時間を延ばしながら再接続する。
 * 切断中に送ろうとした操作はためずに捨てる（オフライン操作を後送しない仕様）。
 */

export type ConnectionStatus = "connecting" | "open" | "closed";

export type Connection = {
  /** 接続中なら送信して `true`、切断中なら送らずに `false` */
  send(message: unknown): boolean;
  close(): void;
};

type Options = {
  url: string;
  onMessage(data: unknown): void;
  onStatus(status: ConnectionStatus): void;
  /** 切断時に呼ばれる。`false` を返すと再接続しない */
  onClose?(event: CloseEvent): boolean | void;
};

const MIN_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;

export function connect({ url, onMessage, onStatus, onClose }: Options): Connection {
  let socket: WebSocket | null = null;
  let retryMs = MIN_RETRY_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const open = () => {
    onStatus("connecting");
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener("open", () => {
      retryMs = MIN_RETRY_MS;
      onStatus("open");
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        // 解釈できないメッセージは無視する
      }
    });
    ws.addEventListener("close", (event) => {
      if (socket !== ws) return;
      socket = null;
      onStatus("closed");
      if (stopped || onClose?.(event) === false) return;
      retryTimer = setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    });
  };

  open();

  return {
    send(message) {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    close() {
      stopped = true;
      clearTimeout(retryTimer);
      const ws = socket;
      socket = null;
      ws?.close();
    },
  };
}
