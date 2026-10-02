# アーキテクチャ概要

現在の実装に基づく構成を記す。採用した技術構成と理由は[ADR 0004](../adr/0004-cloudflare-durable-objects-and-initial-stack.md)を参照する。ADRで採用済みでも未実装の部分（Durable Objects、D1、各アプリ）は、実装時に本資料へ追記する。

## リポジトリ構成

pnpm workspacesによるモノレポ。`pnpm-workspace.yaml` で `apps/*` と `packages/*` をワークスペースとする。

| パス | 状態 | 責務 |
| --- | --- | --- |
| `packages/clock` | 実装済み | トーナメントクロックの状態と時計計算。詳細は[時計ロジック](clock.md) |
| `apps/web`、`apps/api`、`apps/remote`、`apps/signage` | 未実装 | ディレクトリのみ |

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
- ルートの `pnpm typecheck` と `pnpm test` は、各ワークスペースの同名スクリプトを再帰的に実行する。
- テストはVitestで書く。
- CIはGitHub Actions（`.github/workflows/ci.yml`）で、`main` へのpushとプルリクエストごとに型チェックとテストを実行する。
- Docker・Dev Containerは用意していない。
