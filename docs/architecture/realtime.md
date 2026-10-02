# 大会の接続と同期（`apps/api`・`apps/remote`・`apps/signage`）

1大会に対してリモコンとサイネージを接続し、時計の操作を同期する最小構成の現在の実装。技術構成の判断は[ADR 0004](../adr/0004-cloudflare-durable-objects-and-initial-stack.md)、要件は[大会単位のリモコン・サイネージ接続と進行操作](../../openspec/changes/tournament-remote-signage/spec.md)を参照する。時計の計算は[時計ロジック](clock.md)に記す。

ログイン、店舗、ストラクチャー設定、QRによる接続、リモコンの識別番号、操作履歴、エントリー、同時実行数の制限、操作の重複計上の防止は未実装。

## 構成

```text
apps/remote (React + Vite) ──WebSocket──┐
                                         ├─ apps/api (Worker) ─┬─ TournamentDurableObject（大会ごと）
apps/signage (React + Vite) ─WebSocket──┘                      └─ PairingDurableObject（PINごと）
```

| 部品 | 責務 |
| --- | --- |
| `apps/api` の Worker（`src/index.ts`） | 入口。パスに応じて該当するDurable Objectへ接続を渡す |
| `TournamentDurableObject`（`src/tournament.ts`） | 大会1件につき1インスタンス。大会の状態の唯一の正。リモコンの操作を順に処理し、接続中の全端末へ状態を配信する |
| `PairingDurableObject`（`src/pairing.ts`） | 六桁PIN1つにつき1インスタンス。PINを表示中の未接続サイネージのWebSocketを保持する |
| `packages/protocol` | 端末とDurable Objectの間のメッセージの型と、受信した操作の検証 |
| `packages/realtime` | ブラウザ側のWebSocket接続・自動再接続と、サーバー時刻の推定 |
| `apps/remote` | スマホ用リモコン |
| `apps/signage` | 表示端末用のクロック表示 |

## API

| パス | 内容 |
| --- | --- |
| `POST /dev/tournaments` | 開発用。ログインなしで、固定ストラクチャー（20分×10レベル、`src/sample-structure.ts`）の大会を準備し、`{ tournamentId }` を返す。環境変数 `ALLOW_DEV_ENDPOINTS` が `"true"` のときだけ有効。`wrangler.jsonc` の既定値は `"false"` で、`pnpm dev` の起動時だけ `true` にする |
| `GET /tournaments/:tournamentId/ws?role=remote\|signage` | 大会のDurable ObjectへのWebSocket接続。`tournamentId` はUUID |
| `GET /pairing/ws` | 未接続サイネージのPIN待ち受け用WebSocket接続 |

大会IDを知っていればリモコンとして接続できる。大会IDはUUIDで推測されにくいことに依存しており、QRの有効期間や失効などの接続管理は未実装。

## 大会の状態

`TournamentDurableObject` は、大会ID・ストラクチャー・時計の状態（`ClockState`）を1つの値としてDurable Objectのストレージ（キー `tournament`）に保存する。操作を処理するたびに保存してから配信する。準備されていない大会への接続は、WebSocketを受け入れた直後にクローズコード `4404` で閉じる（ブラウザはHTTPのステータスを読めないため）。

WebSocketはHibernation API（`ctx.acceptWebSocket`）で受け入れ、接続時のタグで役割（`remote`／`signage`）を区別する。操作はタグが `remote` の接続からのものだけを受け付け、サイネージからのメッセージは無視する。

## メッセージ

すべてJSON文字列。型は `packages/protocol/src/messages.ts` にある。

リモコン → 大会:

| `type` | 内容 |
| --- | --- |
| `start` | 時計を開始する。待機中以外では何もしない |
| `pause`／`resume` | 一時停止／再開 |
| `setRemaining` | 現在レベルの残り時間（`remainingMs`、0以上の整数ミリ秒）を変更する |
| `pairSignage` | 六桁の `pin` を表示中のサイネージを、この大会へ接続する |

大会 → 端末:

| `type` | 内容 |
| --- | --- |
| `state` | 時計の状態・ストラクチャー・送信時のサーバー時刻（`serverNow`）。接続直後と、状態が変わるたびに全端末へ送る。状態が変わらない操作（開始済みへの開始など）では送らない |
| `pairSignageResult` | `pairSignage` を送ったリモコンにだけ、接続できたか（`ok`）を返す |

PIN → 未接続サイネージ: `pin`（表示するPIN）、`paired`（接続先の `tournamentId`）。

## サイネージのPIN接続

1. 大会に未接続のサイネージは `/pairing/ws` に接続する。Workerは六桁のPINを無作為に選び、そのPINの `PairingDurableObject` へ接続を渡す。そのPINがすでに使用中なら別のPINで最大10回まで選び直す。
2. `PairingDurableObject` はPINをサイネージへ送り、WebSocketを保持する。
3. リモコンが `pairSignage` を送ると、`TournamentDurableObject` がPINの `PairingDurableObject` の `claim(tournamentId)` を呼ぶ。PINを表示中のサイネージがあれば大会IDを送って切断し、`true` を返す。
4. サイネージは受け取った大会IDをブラウザの `localStorage` に保存し、大会のWebSocketへ接続し直す。

接続に使ったPINのWebSocketは閉じるため、同じPINを再び入力しても接続できない。PIN画面のサイネージの通信が切れて再接続すると、新しいPINになる。PINに有効期限はなく、未使用のPINは画面を閉じるまで有効。

再読み込みしたサイネージは、`localStorage` の大会IDで同じ大会へ再接続し、最新の状態を受け取る。保存した大会IDがない、または大会が見つからない（`4404`）場合はPIN画面に戻る。接続解除の操作は未実装。

## 時刻と通信切断

- 端末は `state` を受け取るたびに、`serverNow` と受信時の端末時刻の差をサーバーとの時刻のずれとみなし、推定したサーバー時刻で時計を計算する（`packages/realtime/src/server-clock.ts`）。通信の遅延は補正しない。
- 時計は200ミリ秒ごとに再計算して表示する。
- 接続が切れると、待ち時間を0.5秒から倍々に最大10秒まで延ばしながら自動で再接続する。再接続すると最新の状態を受け取る。
- 切断中のリモコンは操作ボタンを無効にし、操作をためて後から送ることはしない。
- 切断中のサイネージは受信済みの状態から時計を進め続け、「接続切れ」を表示する。受信済みの状態が一時停止なら進めない。

## 画面

- リモコンはURLのクエリ `t` に大会IDを持つ。`t` がなければ開発用の大会作成ボタンを表示する。開始は「スライドして開始」で、つまみを端の90%以上まで動かすと開始を送る（タップだけでは開始しない。キーボードでは右矢印キーで動かせる）。一時停止・再開は通常のボタン。残り時間は分と秒で入力する。
- サイネージは開始前に待機画面、開始後にレベルと残り時間を表示する。最終レベルが終わると「最終レベル終了」と表示する。

## ローカル開発

- `pnpm dev` で、API（`wrangler dev`、8787番）、リモコン（5173番）、サイネージ（5174番）を同時に起動する。
- 画面は、開いたホスト名の8787番ポートをAPIとみなす。同じLANのスマホからPCのIPアドレスで画面を開くと、そのPCのAPIへ接続する。別のAPIを使う場合は環境変数 `VITE_API_ORIGIN` で指定する。
- `wrangler dev` のDurable Objectのデータは `apps/api/.wrangler/` に保存され、APIを再起動しても残る。

## テスト

`apps/api/test/` に、Workersのランタイム上で動く結合テストがある（`@cloudflare/vitest-plugin`、Vitest 4）。他のパッケージはVitest 5を使う。デプロイの設定は未実装。
