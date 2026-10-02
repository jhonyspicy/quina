# quina

ポーカー店舗とプレイヤーをつなぐプラットフォームを目指すサービスです。
まずは、スマホから操作でき、大会の雰囲気を演出するトーナメントクロックの提供に取り組みます。

目的、初回リリースの範囲、収益化の方針、将来構想は[プロダクト方針](docs/product-vision.md)にまとめています。

## ディレクトリ構成

```text
apps/
  web/       # メインサイト
  api/       # バックエンドAPI
  remote/    # スマホ用リモコン
  signage/   # 店内モニター向けクロック・演出表示
packages/    # アプリ間で共有するコード
  clock/     # トーナメントクロックの時計計算
docs/        # プロダクト方針・設計資料
openspec/    # これから実装する変更仕様
```

各アプリは独立してビルド・デプロイする方針です。アプリ間でソースを直接参照せず、共通化が必要なコードを `packages/` に配置します。
現在は `packages/clock` のみ実装しており、各アプリ本体やビルド・デプロイ設定は未実装です。

構成と技術選定は[アーキテクチャ概要](docs/architecture/overview.md)と[技術構成のADR](docs/adr/0004-cloudflare-durable-objects-and-initial-stack.md)を参照してください。

## 開発環境のセットアップ

Node.jsのバージョンは `.tool-versions`、pnpmのバージョンは `package.json` の `packageManager` で固定しています。asdf（またはmise）を使う場合の手順です。

```bash
asdf install
```

```bash
corepack enable && asdf reshim nodejs
```

```bash
pnpm install
```

型チェックとテストは次のコマンドで全パッケージに対して実行します。CI（GitHub Actions）でも同じコマンドを実行します。

```bash
pnpm typecheck
```

```bash
pnpm test
```
