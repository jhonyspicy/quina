# 大会の接続と同期（`apps/api`・`apps/remote`・`apps/signage`）

1大会に対してリモコンとサイネージを接続し、時計の操作を同期する最小構成の現在の実装。技術構成の判断は[ADR 0004](../adr/0004-cloudflare-durable-objects-and-initial-stack.md)、要件は[大会単位のリモコン・サイネージ接続と進行操作](../../openspec/changes/tournament-remote-signage/spec.md)を参照する。時計の計算は[時計ロジック](clock.md)に記す。

ログイン、店舗、管理画面、ストラクチャー設定、同時実行数の制限は未実装。

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
| `GET /tournaments/:tournamentId/ws?role=signage` | サイネージとして大会のDurable ObjectへWebSocket接続する。`tournamentId` はUUID |
| `GET /tournaments/:tournamentId/ws?role=remote&device=:deviceId` | リモコンとして接続する。`deviceId` は端末IDのUUID（小文字）で、ない・形式が違う場合は `400` |
| `GET /pairing/ws` | 未接続サイネージのPIN待ち受け用WebSocket接続 |

大会IDを知っていればリモコンとして接続できる。大会IDはUUIDで推測されにくいことに依存しており、QRの有効期間や失効などの接続管理は未実装。

## 大会の状態

`TournamentDurableObject` は、Durable Objectのストレージ（SQLite）に次を保存する。

| 保存先 | 内容 |
| --- | --- |
| KVのキー `tournament` | 大会ID・ストラクチャー・時計の状態（`ClockState`）を1つの値として保存する |
| `remotes` テーブル | 端末ID（`device_id`）ごとのリモコン識別番号（`number`） |
| `operations` テーブル | 受け付けた操作の操作ID（`op_id`）、端末ID、操作の内容（JSON）、受信時刻。状態を変えた操作は `history` 列に操作履歴の内容（JSON）を持つ |
| `entries` テーブル | エントリー1件ごとの番号（`id`、追加順に1から）、追加した端末IDと時刻、取り消した端末IDと時刻 |

操作を処理するたびに、操作の記録と時計の状態を同期APIで書き込んでから配信する。両者の書き込みの間に `await` をはさまないため、まとめて保存される。サイネージ接続（`pairSignage`）だけは、PIN用のDurable Objectの呼び出しを待つ間をはさむ。

テーブルの作成・変更は、`src/tournament.ts` の `MIGRATIONS` に順に並べ、Durable Objectの起動時に未適用のものだけを適用する。適用済みの数はKVの `schemaVersion` に保存する。既存のテーブルを変える場合は、既存の要素を書き換えず、末尾に変更を追加する。準備されていない大会への接続は、WebSocketを受け入れた直後にクローズコード `4404` で閉じる（ブラウザはHTTPのステータスを読めないため）。

WebSocketはHibernation API（`ctx.acceptWebSocket`）で受け入れ、役割（`remote`／`signage`）と、リモコンなら端末IDと識別番号を接続に添付する（`serializeAttachment`）。操作はリモコンの接続からのものだけを受け付け、サイネージからのメッセージは無視する。

## リモコンの識別番号

- リモコンはブラウザの `localStorage`（キー `quina.remote.deviceId`）に端末IDを保存し、接続時に送る。端末IDは無作為なUUIDで、人の本人確認には使わない。保存できない環境では読み込みのたびに新しい端末IDになる。端末IDに有効期限はない。
- 大会のDurable Objectは、初めて接続した端末IDに、その大会で次の番号（1, 2, 3…）を割り当てて `remotes` テーブルに保存する。同じ端末IDの再接続・再読み込みには同じ番号を返す。番号は大会ごとに振るため、同じ端末でも大会が違えば番号は異なる。
- 同じブラウザで複数のタブを開いた場合は、同じ端末IDとなり同じ番号になる。
- 接続したリモコンには、最初に `welcome` で番号を送り、続けて `state`、`entries`、`history` を送る。リモコンは画面上部に「リモコン 1」のように表示する。

## エントリー

- エントリーは人数だけでなく1件ずつ記録する。取り消しても記録は消さず、取り消した端末と時刻を書き込む。
- 大会の開始前・開始後を問わず追加できる。レイトレジストの締切は未実装で、締切を理由に追加を拒否しない。
- どのリモコンからでも、他のリモコンが追加したエントリーを取り消せる。取り消し済み・存在しないエントリーへの取り消しは無視し、配信もしない。取り消しを元に戻す操作はない。
- 追加・取り消しのたびに、取り消されていないエントリーの数（`entryCount`）を含む `state` を全端末へ、エントリーの一覧（`entries`）をリモコンへ送る。一覧では端末IDではなくリモコンの識別番号で、追加・取り消しをしたリモコンを示す。
- 2台のリモコンがそれぞれ追加すれば2件となる。同じ操作IDの追加は一件だけ計上する。

## 操作履歴

- 状態を変えた操作だけを、どのリモコンがいつ行ったかとともに履歴に残す。開始済みの大会への開始、取り消し済みのエントリーの取り消し、見つからないPINへの接続、同じ操作IDの再送のように、状態を変えなかった操作は残さない（重複防止のための記録には残る）。
- 履歴の各項目は、受け付けた順の番号（`seq`）、受信時刻、リモコンの識別番号、操作の内容を持つ。エントリーの追加は追加されたエントリーの番号、残り時間の変更は変更前と変更後の残り時間、サイネージ接続はPINを含める。
- 他のリモコンが追加したエントリーを取り消した場合、追加と取り消しがそれぞれの操作として、それぞれのリモコンの番号で残る。
- リモコンには、接続直後に全件（`history`）を、その後は追加された1件（`historyAppended`）を送る。同じ大会の全リモコンが同じ履歴を見る。
- 履歴は大会のDurable Objectが存在する限り保持する。保存期間は決めていない。
- リモコン画面の「操作履歴」は折りたたんで表示し、開くと新しい順に時刻（秒まで）・リモコン番号・操作を並べる。

## 操作の重複防止

- リモコンは操作ごとに新しい操作ID（UUID）を付けて送る。
- 大会のDurable Objectは、操作を処理する前に `operations` テーブルへ操作IDを記録する。同じ操作IDがすでにあれば、その操作を処理せず配信もしない。別の操作IDで届いた操作は、内容が同じでも別の操作として処理する。
- 処理しても状態が変わらない操作（開始済みの大会への開始など）も、操作IDとして記録する。
- リモコンは、切断中の操作をためて再送することはしない。重複防止は、通信の再送などで同じ操作が二度届いた場合への備え。
- 操作IDはブラウザの `crypto.getRandomValues` から作る（`packages/realtime/src/random-id.ts`）。LAN内のIPアドレスで開いた開発中の画面のようにHTTPSでない環境では `crypto.randomUUID` を使えないため。

## メッセージ

すべてJSON文字列。型は `packages/protocol/src/messages.ts` にある。

リモコン → 大会（すべての操作に、操作ごとに一意な `opId` を付ける）:

| `type` | 内容 |
| --- | --- |
| `start` | 時計を開始する。待機中以外では何もしない |
| `pause`／`resume` | 一時停止／再開 |
| `setRemaining` | 現在レベルの残り時間（`remainingMs`、0以上の整数ミリ秒）を変更する |
| `pairSignage` | 六桁の `pin` を表示中のサイネージを、この大会へ接続する |
| `addEntry` | エントリーを1件追加する |
| `cancelEntry` | 番号 `entryId` のエントリーを取り消す |

大会 → 端末:

| `type` | 内容 |
| --- | --- |
| `state` | 時計の状態・ストラクチャー・取り消されていないエントリーの数（`entryCount`）・送信時のサーバー時刻（`serverNow`）。接続直後と、状態が変わるたびに全端末へ送る。状態が変わらない操作（開始済みへの開始など）では送らない |
| `entries` | リモコンにだけ、取り消し済みを含むエントリーの一覧を追加順に送る。接続直後と、エントリーが変わるたびに送る |
| `history` | リモコンにだけ、接続直後に操作履歴の全件を古い順に送る |
| `historyAppended` | リモコンにだけ、操作履歴に加わった1件を送る |
| `welcome` | 接続したリモコンにだけ、大会内での識別番号（`remoteNumber`）を送る |
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

- リモコンアプリはURLのクエリで画面を切り替える。
  - クエリなし: 開発用の大会準備ボタン。押すと `POST /dev/tournaments` で大会を準備し、`?setup=` に移る。
  - `?setup=:tournamentId`: 開発用の準備画面。管理画面の代わりに、リモコンのURL（`?t=:tournamentId`）を表すQRコードとURLを表示する。QRは `uqr` でSVGとして作る。再表示しても大会は準備し直さない。`localhost` などで開いている場合は、QRのURLを他の端末から開けないことを表示する。
  - `?t=:tournamentId`: リモコン。QRの有効期限・失効・再発行は未実装で、URLを知っていれば誰でもリモコンとして接続できる。開始は「スライドして開始」で、つまみを端の90%以上まで動かすと開始を送る（タップだけでは開始しない。キーボードでは右矢印キーで動かせる）。一時停止・再開は通常のボタン。残り時間は分と秒で入力する。エントリーは人数と追加ボタン、新しい順の一覧（初期表示は5件）を表示し、各エントリーの取消ボタンは確認ダイアログを経て取り消す。
- サイネージは開始前に待機画面とエントリー数、開始後にレベル・残り時間・エントリー数を表示する。最終レベルが終わると「最終レベル終了」と表示する。

## ローカル開発

- `pnpm dev` で、API（`wrangler dev`、8787番）、リモコン（5173番）、サイネージ（5174番）を同時に起動する。
- 画面は、開いたホスト名の8787番ポートをAPIとみなす。同じLANのスマホからPCのIPアドレスで画面を開くと、そのPCのAPIへ接続する。別のAPIを使う場合は環境変数 `VITE_API_ORIGIN` で指定する。
- `wrangler dev` のDurable Objectのデータは `apps/api/.wrangler/` に保存され、APIを再起動しても残る。

## テスト

`apps/api/test/` に、Workersのランタイム上で動く結合テストがある（`@cloudflare/vitest-plugin`、Vitest 4）。他のパッケージはVitest 5を使う。デプロイの設定は未実装。
