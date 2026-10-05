# アーキテクチャ概要

現在の実装に基づく構成を記す。採用した技術構成と理由は[ADR 0004](../adr/0004-cloudflare-durable-objects-and-initial-stack.md)を参照する。ADRで採用済みでも未実装の部分（D1、`apps/web`、本番環境）は、実装時に本資料へ追記する。環境とデプロイは[環境とデプロイ](environments.md)に記す。

## リポジトリ構成

pnpm workspacesによるモノレポ。`pnpm-workspace.yaml` で `apps/*` と `packages/*` をワークスペースとする。

| パス | 状態 | 責務 |
| --- | --- | --- |
| `packages/clock` | 実装済み | トーナメントクロックの状態と時計計算。詳細は[時計ロジック](clock.md) |
| `packages/protocol` | 実装済み | 端末とDurable Objectの間のメッセージの型と検証 |
| `packages/realtime` | 実装済み | ブラウザ側のWebSocket接続・自動再接続とサーバー時刻の推定 |
| `apps/api` | 最小構成 | Cloudflare WorkerとDurable Objects。大会の状態管理とPIN接続 |
| `apps/remote` | 最小構成 | スマホ用リモコン（React + Vite） |
| `apps/signage` | 最小構成 | 表示端末用のクロック表示（React + Vite） |
| `apps/web` | 未実装 | ディレクトリのみ |

`apps/api`・`apps/remote`・`apps/signage` の現在の範囲と動作は[大会の接続と同期](realtime.md)に記す。

アプリ間でソースを直接参照せず、共有するコードは `packages/` のパッケージとして依存に追加する。ワークスペース内のパッケージは `@quina/` で始まる名前とし、`workspace:*` で参照する。

`packages/` のパッケージはビルドせず、`package.json` の `exports` でTypeScriptのソースを直接公開する。利用側のバンドラー（Vite、wrangler）がまとめて変換する前提。

## 言語とTypeScript設定

TypeScriptで統一する。共通設定は `tsconfig.base.json` にあり、各パッケージの `tsconfig.json` が継承する。

- `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` を有効にする。
- `moduleResolution: Bundler` とし、相対importには `.ts` 拡張子を付ける（`allowImportingTsExtensions`）。
- 型チェック専用で出力しない（`noEmit`）。

## 開発環境とCI

- Node.jsのバージョンは `.tool-versions`、pnpmのバージョンは `package.json` の `packageManager` で固定し、pnpmはCorepackで導入する。`engines.node` にも同じメジャー版を記す。
- `pnpm-lock.yaml` をコミットし、CIでは `pnpm install --frozen-lockfile` でlockfileどおりにインストールする。
- ルートの `pnpm dev`、`pnpm typecheck`、`pnpm test`、`pnpm build` は、各ワークスペースの同名スクリプトを再帰的に実行する（`dev` は並列）。
- テストはVitestで書く。`apps/api` だけは、Workersのランタイム上でテストする `@cloudflare/vitest-plugin` の対応範囲に合わせてVitest 4を使う。
- 依存パッケージのインストール時スクリプトは、`pnpm-workspace.yaml` の `allowBuilds` で許可したもの（esbuild、workerd）だけを実行する。公開から間もない版を避けるpnpmの既定の方針は緩めていない。
- `apps/api/worker-configuration.d.ts` は `pnpm --filter @quina/api cf-typegen`（`wrangler types`）で生成する。`wrangler.jsonc` を変えたら作り直す。
- CIはGitHub Actions（`.github/workflows/ci.yml`）で、`main` へのpushとプルリクエストごとに型チェックとテストを実行する。`main` へのpushでは、続けてStagingへデプロイする（[環境とデプロイ](environments.md)）。
- Docker・Dev Containerは用意していない。
