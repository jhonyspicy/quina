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
  protocol/  # 端末とサーバーの間のメッセージ
  realtime/  # ブラウザ側の接続・再接続
docs/        # プロダクト方針・設計資料
openspec/    # これから実装する変更仕様
```

各アプリは独立してビルド・デプロイする方針です。アプリ間でソースを直接参照せず、共通化が必要なコードを `packages/` に配置します。
現在は、大会にリモコンとサイネージを接続し、時計の操作・エントリー・操作履歴を同期する最小構成を、ローカルとStaging環境で動かせます。ログイン、ストラクチャー設定、`apps/web`、本番環境は未実装です。環境とデプロイは[環境とデプロイ](docs/architecture/environments.md)を参照してください。

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

## ローカルで動かす

API・リモコン・サイネージを同時に起動します。

```bash
pnpm dev
```

1. サイネージ <http://localhost:5174> を開くと、6桁のPINが表示されます。
2. <http://localhost:5173> を開き、「開発用の大会を準備」を押すと、スタッフ接続用のQRが表示されます。「この端末でリモコンを開く」か、スマホでQRを読み取るとリモコンになります。
3. リモコンの「サイネージに接続」にPINを入力すると、サイネージが待機画面になります。
4. リモコンで「スライドして開始」すると時計が始まります。

同じLANのスマホからは、`localhost` の代わりにPCのIPアドレスで開けます。QRをスマホで読み取る場合は、準備の画面をPCのIPアドレスで開いてください。詳しくは[大会の接続と同期](docs/architecture/realtime.md)を参照してください。
