# 📊 Crypto-kakeibo

仮想通貨（Ethereum）の取引履歴を自動取得し、確定申告用のExcelファイルを生成するWebアプリケーションです。

Etherscan APIからウォレットの取引データを取得し、日本の確定申告に必要な **Gtax共通フォーマット** に準拠したExcelファイルを出力します。手作業で行っていた仮想通貨の確定申告資料作成を自動化するツールです。

---

## ✨ 主な機能

| # | 機能 | 説明 |
|---|------|------|
| 1 | **取引履歴の自動取得** | Etherscan APIから通常TX、Internal TX、ERC20、ERC721、ERC1155を一括取得 |
| 2 | **取引種別の自動判定** | 送付 / 受取 / 売買 / 手数料 / 減少 / ボーナス を自動分類 |
| 3 | **NFT売買の自動検出・グループ化** | 同一TX内のETH/WETH転送とNFT転送をマッチングし売買として統合 |
| 4 | **スパムトークンの自動フィルタリング** | URL誘導系NFT等を自動除外 |
| 5 | **確定申告用Excel出力** | Gtax共通フォーマット準拠のExcelファイルを生成 |

---

## 🛠 技術スタック

| 項目 | 技術 |
|------|------|
| フレームワーク | Next.js 15 + React 19 + TypeScript |
| スタイリング | Tailwind CSS 4.1 |
| Excel生成 | ExcelJS |
| 日付処理 | date-fns |
| 外部API | Etherscan API（無料プラン） |
| ビルドツール | Turbopack（`next dev --turbopack`） |

---

## 🚀 セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.local` ファイルをプロジェクトルートに作成し、Etherscan APIキーを設定します。

```env
NEXT_PUBLIC_ETHERSCAN_API_KEY=your-api-key-here
```

APIキーは [Etherscan](https://etherscan.io/myapikey) から取得できます。

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:3000 にアクセスしてください。

---

## 📋 使い方

1. ブラウザで `http://localhost:3000` にアクセス
2. **ウォレットアドレス** と **対象年度** を入力
3. 「Excel出力」ボタンをクリック
4. 自動生成された `確定申告{year}ETH.xlsx` をダウンロード
5. `要確認` フラグのついた行を手動で確認・修正
6. 補助列（要確認 / 推奨取引種別 / 確認理由）を削除して Gtax に取り込み

---

## 📁 プロジェクト構成

```
Crypto-kakeibo/
├── app/
│   ├── page.tsx                     # メインUI（アドレス入力、年度選択、Excel出力）
│   ├── layout.tsx                   # レイアウト
│   ├── globals.css                  # グローバルCSS
│   └── api/
│       ├── transactions/route.ts    # Etherscan APIからデータ取得
│       ├── export/route.ts          # Excel生成・ダウンロード
│       └── debug-tokens/route.ts    # デバッグ用
├── lib/
│   ├── etherscan.ts                 # Etherscan APIクライアント
│   ├── transaction-converter.ts     # 取引データ → 会計エントリ変換（コアロジック）
│   ├── classification-rules.ts      # 取引分類ルールモジュール（拡張可能設計）
│   └── excel-generator.ts           # Excel生成ロジック
├── types/
│   └── index.ts                     # TypeScript型定義
├── 参考/                             # 手作業版Excel（ETH / BNB / POL）
├── 参考_自動生成/                     # 自動生成版のバージョン履歴
├── 参考ドキュメント/                   # キタドロマニュアル（Gtaxフォーマット参考資料）
├── .env.local                       # Etherscan APIキー（要作成）
├── CLAUDE.md                        # Claude Code用プロジェクト記録
└── AGENTS.md                        # Codex用プロジェクト記録
```

---

## 🏗 アーキテクチャ

### データフロー

```
[Etherscan API]
      │
      ▼
[app/api/transactions/route.ts]  ← 通常TX / Internal TX / ERC20 / ERC721 / ERC1155 を取得
      │
      ▼
[app/api/export/route.ts]        ← Receipt取得（WETH取引検出用）
      │
      ▼
[lib/transaction-converter.ts]   ← 取引データを会計エントリに変換
      │  ├── ルールモジュール評価（classification-rules.ts）
      │  ├── WETH取引検出（Deposit / Withdrawal event）
      │  ├── NFT売買グループ化
      │  ├── スパムフィルタリング
      │  └── 自己ウォレット間送金の処理
      │
      ▼
[lib/excel-generator.ts]         ← Gtax共通フォーマットのExcelを生成
      │
      ▼
[確定申告{year}ETH.xlsx]         ← ダウンロード
```

### ルールモジュールシステム

取引分類には、拡張可能な **ルールモジュールシステム** を採用しています。

各ルールは優先度（`priority`）を持ち、優先度の低い数値から順に評価されます。最初にマッチしたルールの結果が採用されます。

| ルールID | 説明 | 分類結果 | 優先度 |
|----------|------|----------|--------|
| `nft-burn-to-null` | NFTをNullアドレスに送付（焼却） | 減少 | 10 |
| `self-wallet-eth-transfer` | 自己ウォレット間のETH送金 | 手数料（ガス代のみ） | 20 |
| `self-wallet-nft-transfer` | 自己ウォレット間のNFT送金 | 手数料（ガス代のみ） | 21 |

新しいルールを追加する場合は、`lib/classification-rules.ts` にルールオブジェクトを追加するだけで対応できます。

### WETH取引の検出

| イベント | 用途 | Topic Hash |
|----------|------|------------|
| Deposit | ETH → WETH（wrapping） | `0xe1fffcc4...` |
| Withdrawal | WETH → ETH（unwrapping） | `0x7fcf532c...` |

MetaMask Bridge経由などTransfer eventが存在しないケースでも、Receipt logsからDeposit/Withdrawal eventを検出して正しく分類します。

---

## 📑 Excel出力フォーマット

出力されるExcelファイルには以下の列が含まれます。

### メイン列（Gtax取り込み対象）

| 列名 | 説明 |
|------|------|
| 取引所名 | `metamask` 固定 |
| 日時（JST） | UTC → JST変換済みのタイムスタンプ |
| 取引種別 | 売買 / 送付 / 受取 / 手数料 / 減少 / ボーナス |
| 取引通貨名(+) | 受け取った通貨名 |
| 取引量(+) | 受け取った数量 |
| 取引通貨名(-) | 支払った通貨名 |
| 取引量(-) | 支払った数量 |
| 取引額時価 | 取引時の時価（該当する場合） |
| 手数料通貨名 | ガス代の通貨名（ETH） |
| 手数料数量 | ガス代の数量 |
| 取引詳細 | ルールモジュールによる分類理由 |

### 補助列（Gtax取り込み前に削除）

| 列名 | 説明 |
|------|------|
| 要確認 | 自動判定に確信が持てない場合に `⚠️` を表示 |
| 推奨取引種別 | 推奨される取引種別 |
| 確認理由 | 要確認の理由 |

---

## 📌 確定申告ルールの参考資料

本プロジェクトの取引分類は、以下のルールに準拠しています。

- **キタドロマニュアル** — `参考ドキュメント/キタドロ.md`
  - Gtax共通フォーマットの入力方法
  - NFT・エアドロップ対応の確定申告ノウハウ
  - 取引種別の分類基準

### 主な分類ルール

- **自己ウォレット間送金**: 送金履歴の記入は不要、ガス代のみ「手数料」として記入
- **NFT焼却（Burn）**: 「減少」として記入
- **ETH⇔WETH交換**: 「売買」として記入
- **判定不能なケース**: `要確認`フラグ＋推奨種別を提示し、手動判断に委ねる

---

## ⚠️ 注意事項

- Etherscan APIの無料プランは **3リクエスト/秒** のレート制限があります
- タイムスタンプはすべて **JST（UTC+9）** で出力されます
- 取引所名は `metamask` 固定です
- オンチェーン情報だけでは意図が確定できない取引は `要確認` として出力されるため、手動確認が必要です
- NFTバンドル取引（1TXで複数NFT購入）は均等按分されます

---

## 🔮 今後の改善案

- [ ] 他のブロックチェーン対応（BSC、Polygon等）
- [ ] 複数年度のバッチ処理
- [ ] 取引履歴のローカル保存・再利用
- [ ] より詳細な取引種別の自動判定
- [ ] UI/UXの改善（進捗表示、エラーハンドリング）
- [ ] Staking入金/出金の検出ルール追加
- [ ] DEX Swap自動分類ルール追加
- [ ] Airdrop受取検出ルール追加
- [ ] Bridge取引検出ルール追加

---

## 📜 ライセンス

ISC
