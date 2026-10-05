# Staging環境を用意し、画面と同じURLの `/api/` でAPIを公開する

日付: 2026年10月5日

状態: 採用済み

## 背景

リモコン・サイネージの接続と時計の同期を、ローカル（同じLAN）では確認できるようになった。一方、店舗のWi-Fi、スマホのモバイル回線、HTTPS、実際のCloudflare上でのDurable Objectsの動作は、ローカルでは確かめられない。試作版を利用している店舗のスタッフに早めに試してもらうためにも、インターネットから使えるStaging環境が必要になった。

本番（Production）には、ログイン・管理画面・店舗とプランの管理・課金が必要で、いずれも未実装のため、Stagingだけを先に用意する。

ローカル開発では、画面（Vite、5173番・5174番）とAPI（wrangler dev、8787番）が別々のURLだった。Staging・本番でも画面とAPIを別のURLにすると、次の問題がある。

- アクセス制限にCloudflare Accessを使う場合、ログイン状態（Cookie）はホスト名ごとに管理されるため、画面で認証してもAPIへの通信（WebSocketを含む）が認証されない。
- 別のURLへの通信を許可する設定（CORS）が必要になる。

ドメインは `quina.poker` を取得済み（AWS Route53で登録）。Cloudflareのアカウントは保有している。

## 検討した選択肢

### URL

- Cloudflareの `workers.dev` のサブドメインを使う。
- 取得済みの `quina.poker` を使う。

### 画面とAPIの関係

- A: APIにも公開URL（例: `api-staging.quina.poker`）を付け、画面からそのURLへ接続する。
- B: 画面のWorkerのコードが、`/api/` で始まるアクセスをService BindingでAPIのWorkerへ取り次ぐ。
- C: 画面のWorkerはCustom Domainで静的ファイルだけを配信し、同じホスト名の `/api/*` をRouteでAPIのWorkerへ振り分ける（AWS CloudFrontのビヘイビアに相当する）。

### アクセス制限

- Cloudflare Access（許可したメールアドレスの人だけが、メールで届くコードで認証する）。
- 共通の合言葉。
- 開発用の大会準備だけを合言葉で守る。

### デプロイのきっかけ

- `main` へのpushでCIが通ったら自動でデプロイする。
- GitHub Actionsから手動で実行する。

## 判断と理由

### `quina.poker` のサブドメインを使う

本番も `quina.poker` で提供する想定のため、HTTPS証明書・Cookie・Cloudflare Accessを本番と同じ形で事前に確かめられる。`workers.dev` のURLにはCloudflareのアカウント名が含まれ、店舗に試してもらう際のURLとしても適さない。DNSの管理はCloudflareへ移す（ドメインの登録はRoute53のまま）。

| 環境 | リモコン | サイネージ |
| --- | --- | --- |
| Staging | `remote-staging.quina.poker` | `signage-staging.quina.poker` |
| 本番（未構築） | `remote.quina.poker` を想定 | `signage.quina.poker` を想定 |

`remote.staging.quina.poker` のような2段のサブドメインは、Cloudflareの無料の証明書（Universal SSL）の対象外となるため使わない。

### 画面と同じホスト名の `/api/*` をRouteでAPIへ振り分ける（C）

- ブラウザから見たURLが画面ごとに1つにまとまり、Cloudflare Accessの認証が1回で済み、WebSocketも同じホスト名で通る。CORSも不要になる。
- APIのWorkerには専用の公開URLを付けない。外から届くのは、アクセス制限のかかった画面のホスト名の `/api/` 経由だけになる。
- 画面のWorkerは静的ファイルだけを配信し、振り分けのコードを持たない（Bとの違い）。振り分けは各Workerの `wrangler.jsonc` に書き、コードと一緒に管理する。
- Custom Domainは、DNSレコードとHTTPS証明書をCloudflareが自動で作る。Routeは自分ではDNSレコードを作らないが、同じホスト名にCustom DomainとRouteがある場合はRouteが優先されるため、Custom Domainが作ったDNSレコードに乗って `/api/*` だけをAPIへ振り分けられる。
- 画面・APIを別々のWorkerとして独立してデプロイする方針（[README](../../README.md)、[ADR 0004](0004-cloudflare-durable-objects-and-initial-stack.md)）を保てる。

ローカル開発でも、Viteの `server.proxy` で `/api` をwrangler devへ振り分け、画面とAPIを同じURLにそろえる。

### Stagingのアクセス制限はCloudflare Accessで行う

利用者はCloudflareのアカウントを必要とせず、許可リストのメールアドレスに届くコードで認証できる。店舗のスタッフを個別に追加・削除でき、合言葉のように広まる心配がない。開発用の大会準備（`POST /api/dev/tournaments`）を含め、ログインのない機能をStagingで使えるのは、この制限があることを前提とする。

サイネージの端末（PC・テレビ）も初回に認証が必要になるため、Stagingでは認証の有効期間を長め（1か月程度）にする。Accessの設定はCloudflareの管理画面で行い、コードでは管理しない。

### `main` へのpushで自動デプロイする

CIの型チェックとテストが通った後に、Stagingへ自動でデプロイする。将来 `staging` ブランチへのpushをきっかけにする場合は、GitHub Actionsの設定で切り替える。DNSの切り替えとAPIトークンの登録が済むまでデプロイが失敗し続けないよう、リポジトリ変数でデプロイの有効・無効を切り替えられるようにする。

## 影響

- APIのパスはすべて `/api/` で始まる。画面は自分と同じオリジンの `/api` を呼ぶ。
- 各Workerの `wrangler.jsonc` に `staging` 環境を設け、Worker名・Route・Custom Domain・環境変数・Durable Objectのバインディングを環境ごとに書く。StagingのDurable Objectsのデータは本番と分かれる。
- `quina.poker` のDNSをCloudflareへ移す作業、デプロイ用APIトークンのGitHubへの登録、Cloudflare Accessの設定は、利用者が管理画面で行う。手順は[環境とデプロイ](../architecture/environments.md)に記す。
- 本番環境の構築、本番のホスト名の確定、本番のアクセス制限（ログイン）は、本判断では行わない。
- 開発用エンドポイント（`ALLOW_DEV_ENDPOINTS`）は、ローカルとStagingでだけ有効にする。
