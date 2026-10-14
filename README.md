# WEARHACK2 Web Control

CIO WEARHACK2 の非公式 Web Bluetooth コントローラー（個人開発・検証用）です。

## 開発スコープ

- **Step 1:** Android Chrome から BLE 接続し、現在温度・残り時間・電源状態を表示
- **Step 2:** 電源 ON/OFF・目標温度・タイマー制御、エラー処理
- 対象外: PWA 化、バックグラウンド制御、マイ設定保存機能

## 動作環境

- Web Bluetooth に対応した Android Chrome
- HTTPS（GitHub Pages 等）またはローカル開発時の `localhost`
- WEARHACK2 実機

## 通信仕様（独自の実機観測に基づく）

- BLE GATT Service: `0000fff0-0000-1000-8000-00805f9b34fb`
- Command: `0000fff2-0000-1000-8000-00805f9b34fb` (Write Without Response)
- Notification: `0000fff1-0000-1000-8000-00805f9b34fb` (Notify)
- 状態取得要求: `AA 01 02 FD`
- 状態応答: `AA 07 02 HH MM SS TT PP XX CC`（HH/MM/SS = 残時間、TT = 現在温度、PP = 電源状態。XX の意味は未確定）
- チェックサム: 先頭 `AA` を除く全バイトの下位 8bit 合計がゼロ

これらはメーカー非公開仕様のリバースエンジニアリング結果であり、機種・ファームウェアによって異なる場合があります。

## 安全上の注意

本製品は発熱機器です。実験時は身体や可燃物から離し、本体側の停止操作と給電停止手段を確保してください。アプリ上の表示のみを安全判定に使用しないでください。

このリポジトリは CIO の公式プロジェクトではありません。
