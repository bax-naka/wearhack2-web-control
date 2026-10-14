# WEARHACK2 Web Control

CIO WEARHACK2 の非公式 Web Bluetooth コントローラー（個人開発・検証用）です。CIO 公式アプリではありません。

## 開発スコープ

- **Step 1（今回の PR）:** Android Chrome で BLE 接続、現在温度・残り時間・電源状態の表示、手動更新・切断
- **Step 2（実機で Step 1 検証後）:** 電源 ON/OFF、目標温度・タイマーの設定、通信エラー処理
- **対象外:** PWA 化、バックグラウンド制御、マイ設定の本体保存

Step 1 では **設定変更コマンドを送信しません**。本体への書き込みは、状態取得要求 `AA 01 02 FD` のみです。

## Android での動作確認

1. GitHub Pages に `main` ブランチのルート `/` を公開する（下記参照）。
2. Android の **Chrome** で公開 URL を開く（HTTPS 必須）。
3. WEARHACK2 を給電して Bluetooth 接続できる状態にする。純正アプリ、nRF Connect は切断しておく。
4. **機器を選択して接続**を押し、デバイス選択画面で `Wearhack2` を選ぶ。
5. 現在温度・残り時間・電源 ON/OFF が表示されることを確認する。
6. 本体ボタンで ON/OFF を変更し、**今すぐ更新**で値が変化するか確認する。
7. **切断**を押し、古い値が画面から消えることを確認する。

通信取得は約5秒ごと、ページ表示中のみ行います。切断後の自動再接続、画面消灯中の継続通信は未実装です。ブラウザーの権限・接続状態によって、再接続時に機器選択が必要になる場合があります。

### GitHub Pages 公開

リポジトリの **Settings → Pages → Build and deployment → Deploy from a branch** で Branch を `main`、Folder を `/(root)` にして保存します。デフォルトのサイト URL は次の形式です。

`https://bax-naka.github.io/wearhack2-web-control/`

**注意:** このリポジトリは現在 Private です。GitHub Free の場合、Pages を利用するには Public への変更が必要です。プランによって Private リポジトリから公開できる場合も、公開サイトにコードが配信される点に注意してください。解析に使った bugreport や実機の Bluetooth アドレスはリポジトリに保存しません。

PR の確認中は `main` に実装コードは入っていないため、マージ後に Pages を公開してください。

## 開発・テスト

静的 HTML/CSS/JavaScript のみで構成し、ビルド不要です。ローカル実行は `localhost` から開いてください。

```bash
python -m http.server 8000
# http://localhost:8000/
npm test
```

※ ローカル PC から `localhost` で動作しても、Bluetooth 接続は BLE に対応した端末とブラウザーで確認してください。

## 通信仕様（独自の実機観測に基づく）

- BLE GATT Service: `0000fff0-0000-1000-8000-00805f9b34fb`
- Command: `0000fff2-0000-1000-8000-00805f9b34fb` (Write Without Response)
- Notification: `0000fff1-0000-1000-8000-00805f9b34fb` (Notify)
- 状態取得要求: `AA 01 02 FD`
- 状態応答: `AA 07 02 HH MM SS TT PP XX CC`（HH/MM/SS = 残時間、TT = **現在温度**、PP = 電源状態。XX の意味は未確定）
- チェックサム: 先頭 `AA` を除く全バイトの下位 8bit 合計がゼロ

これらはメーカー非公開仕様の実機解析結果です。機種・ファームウェアによって異なる場合があります。

## 安全上の注意

本製品は発熱機器です。実験時は身体や可燃物から離し、本体側の停止操作と給電停止手段を確保してください。Webアプリの表示だけを安全判定に使用しないでください。
