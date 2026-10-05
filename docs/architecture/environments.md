# 環境とデプロイ

現在用意している環境と、デプロイの仕組み・初回の準備手順を記す。構成を選んだ理由は[ADR 0005](../adr/0005-staging-environment-and-same-origin-api.md)を参照する。本番環境は未構築。

## 環境

| 環境 | リモコン | サイネージ | API | 利用者の制限 |
| --- | --- | --- | --- | --- |
| ローカル | `http://localhost:5173` | `http://localhost:5174` | 各画面の `/api` をViteがwrangler dev（8787番）へ振り分ける | なし |
| Staging | `https://remote-staging.quina.poker` | `https://signage-staging.quina.poker` | 各画面の `/api/*` をRouteでAPIのWorkerへ振り分ける | Cloudflare Access |
| 本番 | 未構築 | 未構築 | 未構築 | 未決定 |

どの環境でも、画面は自分と同じオリジンの `/api` をAPIとして呼ぶ（`packages/realtime` の `resolveApiBaseUrl`）。ビルド時に環境変数 `VITE_API_BASE_URL` を指定すると、別のAPIのベースURLを使える。

## Cloudflare上の構成（Staging）

| Worker | 設定ファイル | 公開のしかた |
| --- | --- | --- |
| `quina-remote-staging` | `apps/remote/wrangler.jsonc` の `env.staging` | Custom Domain `remote-staging.quina.poker`。`dist/` の静的ファイルだけを配信し、見つからないパスは `index.html` を返す |
| `quina-signage-staging` | `apps/signage/wrangler.jsonc` の `env.staging` | Custom Domain `signage-staging.quina.poker`。同上 |
| `quina-api-staging` | `apps/api/wrangler.jsonc` の `env.staging` | Route `remote-staging.quina.poker/api/*` と `signage-staging.quina.poker/api/*`。専用の公開URLはない |

- Custom DomainはDNSレコードとHTTPS証明書をCloudflareが自動で作る。同じホスト名ではRouteがCustom Domainより優先されるため、`/api/*` だけがAPIのWorkerへ届く。
- `workers_dev` と `preview_urls` は無効にし、`workers.dev` のURLでは公開しない。
- APIのWorkerの環境変数・Durable Objectのバインディング・マイグレーションは、wranglerの仕様で環境ごとに書く必要があるため、`env.staging` にも同じ内容を書く。StagingのDurable Objectsのデータは、他の環境と分かれる。
- Stagingでは `ALLOW_DEV_ENDPOINTS` を `"true"` にし、開発用の大会準備を使えるようにする。Cloudflare Accessで利用者を制限していることが前提。
- 各 `wrangler.jsonc` の最上位の設定はローカル開発用で、デプロイ先のURLを持たない。

## デプロイ

`.github/workflows/ci.yml` の `deploy-staging` ジョブが、`main` へのpushで型チェックとテスト（`check` ジョブ）が通った後に、次の順でデプロイする。

1. `pnpm --filter @quina/remote deploy:staging`（ビルドしてデプロイ）
2. `pnpm --filter @quina/signage deploy:staging`
3. `pnpm --filter @quina/api deploy:staging`

画面のCustom Domainが作るDNSレコードにAPIのRouteが乗るため、画面を先にデプロイする。デプロイは同時に1つだけ実行する。

ジョブは、GitHubのリポジトリ変数 `STAGING_DEPLOY_ENABLED` が `true` のときだけ動く。デプロイには、リポジトリのSecrets `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を使う。きっかけを `staging` ブランチなどへ変える場合は、ジョブの `if` の条件を変える。

手元からデプロイする場合は、`wrangler login` などでCloudflareにログインしたうえで、上と同じ順に各コマンドを実行する。

## 初回の準備（管理画面での作業）

次の作業はコードでは管理せず、管理画面で行う。

### 1. `quina.poker` のDNSをCloudflareへ移す

ドメインの登録はAWS Route53のまま、DNSの管理だけをCloudflareへ移す。

1. Cloudflareの管理画面で `quina.poker` をドメインとして追加する（Freeプラン）。
2. Cloudflareが読み込んだ既存のDNSレコードを確認する。メール（MXレコード）など `quina.poker` を他の用途で使っている場合は、Cloudflare側にも同じレコードがあることを確かめる。
3. Route53でDNSSECを有効にしている場合は、先に無効にする。
4. Route53の「登録済みドメイン」で `quina.poker` のネームサーバーを、Cloudflareが指定する2つに変更する。
5. Cloudflareの管理画面で `quina.poker` が有効（Active）になるのを待つ。

切り替え後、Route53のホストゾーンは不要になる。

### 2. デプロイ用のAPIトークンを登録する

1. Cloudflareの管理画面のAPIトークンの作成画面で、テンプレート「Edit Cloudflare Workers」を選ぶ。
2. 対象のアカウントを自分のアカウントだけに、対象のゾーンを `quina.poker` だけに絞って作成する。
3. 作成したトークンを、GitHubのリポジトリのSecrets `CLOUDFLARE_API_TOKEN` に登録する。トークンはリポジトリのファイルに書かない。
4. CloudflareのアカウントIDを、Secrets `CLOUDFLARE_ACCOUNT_ID` に登録する。

Custom Domainの作成で権限が足りないと表示された場合は、ゾーン `quina.poker` に対する権限（DNSの編集など）をトークンに追加する。

### 3. Cloudflare Accessで利用者を制限する

1. CloudflareのZero Trustの管理画面で、セルフホスト型のアプリケーションを作り、`remote-staging.quina.poker` と `signage-staging.quina.poker` を対象にする（パスは指定せず、`/api/*` を含むホスト名全体）。
2. 認証方法にワンタイムPIN（メールで届くコード）を使う。
3. 許可するポリシーに、利用者のメールアドレスを登録する。
4. サイネージの端末が頻繁に再認証を求められないよう、認証の有効期間を長め（1か月程度）にする。

利用者は、初回に許可されたメールアドレスを入力し、届いたコードで認証する。Cloudflareのアカウントは不要。

### 4. 自動デプロイを有効にする

1〜3が済んだら、GitHubのリポジトリ変数 `STAGING_DEPLOY_ENABLED` を `true` にする。以降、`main` へのpushでStagingへデプロイされる。
