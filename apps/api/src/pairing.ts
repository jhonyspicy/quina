import { DurableObject } from "cloudflare:workers";
import type { PairingServerMessage } from "@quina/protocol";

export const PIN_HEADER = "X-Quina-Pin";

/**
 * 六桁PIN1つにつき1インスタンス。未接続のサイネージがPINを表示している間だけWebSocketを保持し、
 * リモコンからPINが入力されたら接続先の大会を伝えて切断する。切断後のPINは使えない。
 */
export class PairingDurableObject extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const pin = request.headers.get(PIN_HEADER);
    if (pin === null) return new Response("missing pin", { status: 400 });
    if (this.openSockets().length > 0) return new Response("pin in use", { status: 409 });

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    send(server, { type: "pin", pin });
    return new Response(null, { status: 101, webSocket: client });
  }

  /** PINを表示中のサイネージを大会へ接続する。表示中のサイネージがなければ `false` */
  async claim(tournamentId: string): Promise<boolean> {
    const sockets = this.openSockets();
    for (const ws of sockets) {
      send(ws, { type: "paired", tournamentId });
      ws.close(1000, "paired");
    }
    return sockets.length > 0;
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    closeQuietly(ws, code, reason);
  }

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }
}

function send(ws: WebSocket, message: PairingServerMessage): void {
  ws.send(JSON.stringify(message));
}

export function closeQuietly(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code === 1005 ? 1000 : code, reason);
  } catch {
    // すでに閉じている
  }
}
