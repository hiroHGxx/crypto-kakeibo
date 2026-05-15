# Crypto-kakeibo プロジェクト記録

## プロジェクト概要

仮想通貨（Ethereum + Polygon）の取引履歴を取得し、確定申告用のExcelファイルを自動生成するWebアプリケーション。

### 技術スタック
- **フレームワーク**: Next.js 15 + React 19 + TypeScript
- **スタイリング**: Tailwind CSS 4.1
- **主要ライブラリ**: ExcelJS, date-fns
- **API**: Etherscan v2 API（無料プラン、`chainid`パラメータでマルチチェーン対応）

### 主な機能
1. Ethereum + Polygonウォレットアドレスから取引履歴を取得
2. 取引種別の自動判定（送金/受取/売買/手数料/ボーナス）
3. NFT売買の自動検出・グループ化（マーケットプレイス売却含む）
4. DEXスワップ検出（Bridge+DEXパターン含む）
5. スパムトークンの自動フィルタリング
6. エアドロップ/報酬の自動「ボーナス」分類
7. 確定申告用Excel形式での出力（全チェーン統合・タイムスタンプソート）

### 現在のブランチ
- `main` — Polygon対応・分類改善・BSC手動Excelインポート統合まで全て統合済み
- `feature/bsc-csv-import` — **作業中** BSC BscScan CSV自動取り込み＋CLIスクリプト化（2026-05-16 第3セッション）
- `feature/bsc-support` — マージ済み（残置）
- `feature/polygon-support` — マージ済み（残置）
- `feature/classification-refinements` — マージ済み（残置）

## 最新作業記録（2026-05-16 第3セッション）BSC CSV自動取り込み + CLIスクリプト化【完了】

### 作業概要
BscScan からダウンロードした4種CSV（Normal/Internal/BEP-20/NFT）を自動取り込みして既存パイプラインに合流させる仕組みを実装。さらに dev server 起動不要の CLIスクリプト `npm run export` を新設してワークフローを大幅効率化。

### 実装したファイル
- **新規** `lib/bscscan-csv-importer.ts` — BscScan CSV → Etherscan v2互換JSON変換器
  - fee復元: `gasPrice=1, gasUsed=fee*1e18` の工夫で既存計算式 `gasUsed*gasPrice/1e18` をそのまま使える
  - 4種CSVを txハッシュベースでマージ
  - 年フィルタ対応
- **新規** `lib/export-pipeline.ts` — エクスポート処理の共通関数 `buildExportEntries`
  - API route と CLI 両方から呼び出す共通ロジック化（DRY確保）
- **新規** `scripts/export-tax.ts` — CLI スクリプト
  - `npm run export -- --year 2025` 1コマンドで Excel 生成
  - `--addresses`/`--import-excel`/`--bsc-csv-dir`/`--out` オプション対応
  - 出力ファイル番号は自動採番
- **拡張** `app/api/export/route.ts` — pipeline 利用版にリファクタ（130行 → 80行）
- **微修正** `app/page.tsx` — タイトル「ETH + Polygon + BSC」に変更
- **依存追加** `tsx`, `dotenv` (devDependencies)

### 動作確認結果（v13）

| 項目 | 期待 | 実測 | 判定 |
|---|---|---|---|
| ETH | 37 | 37 | ✅ |
| POL | 31 | 31 | ✅ |
| BSC (CSV) | — | **76** | ✅ |
| 合計 | — | **144行** | ✅ |
| タイムスタンプ昇順 | 0 reversals | 0 reversals | ✅ |
| API版(v12) vs CLI版(v13) | 完全一致 | 完全一致 | ✅ |

- 出力ファイル: `自動生成_ETHPOL/確定申告2025仮想通貨_13.xlsx`
- BSC: 通常TX 54件、Internal 8件、Token 99件、NFT-721 5件、NFT-1155 2件 → 76エントリ生成

### 参考BNB(50行・手作業)との照合
- **取りこぼし0件**: 手作業の34分単位TXは全て自動側にも検出
- **新規検出+17分単位**: 手作業見落とし or 分類解釈違いのもの
- 主な解釈違い（要確認列でフラグ済み）:
  - Aave Supply: 手作業「減少」 vs 自動「売買」(USDT→aBnbUSDT)
  - PancakeSwap LP NFT: 手作業「減少+ボーナス」 vs 自動「売買」(NFT trade)
  - スパム系: BEP-20 TOKEN*, WBNB 1e-7 等

### CLIスクリプト使い方

```bash
npm run export                                      # 当年・既定ウォレット
npm run export -- --year 2025                       # 年指定
npm run export -- --year 2025 --addresses 0xa,0xb   # ウォレット指定
npm run export -- --import-excel 参考/foo.xlsx      # 手作業Excelマージ
npm run export -- --out ./custom-name.xlsx          # 出力ファイル指定
npm run export -- --bsc-csv-dir ./other-csvs        # BSC CSVディレクトリ変更
```

### 既知の制約
- CSVには receipt logs が含まれないため、WBNB wrap/unwrap や DEX log解析依存の判定は機能しない（既存Bridge+DEX検出等はETH/POLのみ有効）
- BSC CSV ディレクトリは既定 `./BSC取引データ` を参照、`*.csv` は `.gitignore` で除外済み（個人データ保護）
- BSC CSVは35/76件に `要確認` フラグ立ち → Excel上で手動再分類想定

### 運用方針の変更
- **従来**: 別ターミナルで `npm run dev` 起動 → ブラウザでUI操作
- **新**: `npm run export` 一発で完結（dev server 不要・最速・CLAUDE.md準拠）
- ブラウザUIは引き続き利用可能（カスタムアドレスのアドホック操作向け）

---

## 過去の作業記録（2026-05-16 後半セッション）BSC手動Excelインポート【完了・main統合済み】

### 作業概要
前半セッションで未コミット状態だったBSC手動Excelインポート機能の動作確認を実施 → 想定通り動作 → main にマージ・push まで完了。
さらに次のステップとして「BscScan CSV手動ダウンロード方式」の方向性を決定（実CSV取得待ちで中断）。

### 動作確認結果（v11）

| 項目 | 期待値 | 実測値 | 判定 |
|---|---|---|---|
| 総行数 | 118 | **118** | ✅ |
| ETH | 37 | 37 | ✅ |
| POL | 31 | 31 | ✅ |
| BSC(手動Excel) | 50 | 50 | ✅ |
| 時刻ソート | 昇順 | 逆転0件 | ✅ |

- 出力ファイル: `自動生成_ETHPOL/確定申告2025仮想通貨_11.xlsx`
- BSCインポート行は `取引詳細="手動入力（BNB等のExcelインポート）"` で全件識別可能
- 3チェーンがタイムスタンプ順に正しく混在配置

### コミット履歴

```
b0604ac Merge branch 'feature/bsc-support'           ← main HEAD
e77c83e docs: BSCインポート方式の実装記録（2026-05-16）
2448cd1 feat: BSC等を手動Excelインポートで統合する仕組みを追加
d7a2815 docs: セッション記録 2026-05-15（FNCT/10YETH 改善とmain統合）
```

## 過去の作業記録（2026-05-16 前半セッション）BSC対応 → Excelインポート方式に方針転換

### 作業概要
BSC対応に着手。Etherscan v2無料プランがBSC非対応と判明し、方針を「Excel手動入力データのインポート統合」に変更。コードは完成・ビルドOKだが動作確認前に中断（→ 後半セッションで完了）。

### 経緯と判明事項

#### 1. BSC自動取得の試行 → 失敗
- `feature/bsc-support` ブランチ作成
- `lib/chain-config.ts` に BSC (chainId=56, BNB/WBNB) を追加
- `SUPPORTED_CHAIN_IDS` に "56" を追加
- 関連トークンリスト（trustedTokens, paymentTokenSymbols, excludeSymbols, WELL_KNOWN_TOKENS）にBNB/WBNB/Cake/mCake/BSC-USDT/BSC-USDC/BSC-ETH等を追加
- **API実行で `NOTOK: Free API access is not supported for this chain` エラー**

#### 2. 原因調査・確定
- `curl https://api.etherscan.io/v2/chainlist` で各チェーンの状況確認
- **Etherscan v2無料プランで使えるチェーン**:
  - ✅ chainid=1 (Ethereum)
  - ✅ chainid=137 (Polygon)
  - ✅ chainid=42161 (Arbitrum)
  - ❌ chainid=56 (BSC) → 有料Proプラン($199/月)が必要
  - ❌ chainid=8453 (Base), 10 (Optimism), 43114 (Avalanche) → 同上
- BscScan の「同じAPIキーでBSCも使える」案内は事実だが、"full chain coverage" にはProプラン必要

#### 3. 方針転換: Excel手動入力データのインポート統合
- ユーザー判断: 「ではExcelファイルを別で準備する形にします」
- 手作業BNB Excel(`参考/確定申告2025BNB.xlsx` 50行)をUIアップロード → ETH+POL自動生成と統合
- 年1回の確定申告用途として現実的・無料・確実

### 完了した実装（未コミット）

#### 新規ファイル
- `lib/excel-importer.ts` — 既存形式 Excel を AccountingEntry[] に変換
  - 列1-10構造（取引所名/日時/取引種別/通貨+/-/手数料）対応
  - 日時セル(Date object, UTC基準) → JST文字列に変換
  - 年フィルタ対応
  - **動作確認済み**: 参考BNB 50行を正しく読み込み（手数料18/減少10/売買16/ボーナス6）

#### 変更ファイル
- `lib/chain-config.ts`
  - ChainConfig に `apiBaseUrl`, `apiKeyEnv`, `useChainIdParam` 追加（将来の代替API対応の基盤）
  - BSC設定追加（参考用に保持、ただし `SUPPORTED_CHAIN_IDS` からは除外）
  - **`SUPPORTED_CHAIN_IDS = ["1", "137"]` のままmainと同じ**（BSCはAPI取得しない）
- `lib/etherscan.ts`
  - `EtherscanAPI` コンストラクタが `ChainConfig` も受け取れるように拡張
  - `apiBaseUrl` / `useChainIdParam` ベースでURL構築
  - エラーメッセージに `result` 詳細を含めるよう改善
- `lib/transaction-converter.ts`
  - trustedTokens に BNB/WBNB/CAKE/MCAKE/BUSD/ETH 追加
  - paymentTokenSymbols, groupSelfTokenMovementPairs の excludeSymbols に BNB/WBNB 追加
  - WELL_KNOWN_TOKENS に BSC主要トークン7種追加
- `app/api/export/route.ts`
  - **multipart/form-data 対応**: `importExcel` フィールドでExcelアップロード受付
  - インポートExcel エントリを `allEntries` に追加（タイムスタンプソート対象）
  - 1チェーン失敗で全停止しないエラーハンドリング（`skippedChains` 記録）
  - チェーン別 `apiKeyEnv` から API キー取得
- `app/api/transactions/route.ts`
  - 同様の skip 対応・チェーン別キー取得
- `app/page.tsx`
  - タイトル「ETH + Polygon + BSC手動」に変更
  - BNB Excel ファイルアップロード input 追加（任意）
  - `handleExport` を `FormData` 経由送信に対応（ファイル選択時のみ）

### ビルド状況
- ✅ `npm run build` 成功（TypeScriptエラーなし、7ルート生成）

### 中断時の状態（2026-05-16）

```
ブランチ: feature/bsc-support
コミット: なし（main から進んでいない）
変更ファイル（未コミット）:
  modified:   app/api/export/route.ts          +82/-12
  modified:   app/api/transactions/route.ts    +21/-20
  modified:   app/page.tsx                     +52/-13
  modified:   lib/chain-config.ts              +27/-4
  modified:   lib/etherscan.ts                 +30/-7
  modified:   lib/transaction-converter.ts     +10/-3
  untracked:  lib/excel-importer.ts            +新規118行
```

### 次回再開時の作業手順

#### 1. 動作確認（最優先）
```bash
# 別ターミナルで dev サーバー起動
cd /Users/gotohiro/Documents/user/Products/Crypto-kakeibo
npm run dev
```

ブラウザ http://localhost:3000:
- メイン: `0x01b27ec780c534ba0fab15509354c3798321273c`
- サブ: `0x581087E117A68537b624e0352833dB96654c0481`
- 対象年: `2025`
- **BNB等 手動入力Excel**: `参考/確定申告2025BNB.xlsx` を選択
- Excelダウンロード

**期待**: ETH 37行 + POL 31行 + BSC 50行 = **118行**統合Excel（タイムスタンプ順）

#### 2. 結果検証
- 出力先候補: `自動生成_ETHPOL/確定申告2025仮想通貨_BSC統合_1.xlsx` 等
- 行数確認、BSCエントリが `取引詳細="手動入力（BNB等のExcelインポート）"` で識別可能
- タイムスタンプソートが正しく機能しているか確認

#### 3. 問題なければコミット → main マージ
```bash
git add lib/excel-importer.ts lib/chain-config.ts lib/etherscan.ts \
        lib/transaction-converter.ts app/api/export/route.ts \
        app/api/transactions/route.ts app/page.tsx
git commit -m "feat: BSC等を手動Excelインポートで統合する仕組みを追加"
git checkout main
git merge --no-ff feature/bsc-support
git push origin main
```

### 設計判断の記録

- **なぜAPI自動取得を諦めたか**: Etherscan Pro $199/月は個人の確定申告には過剰、年1回手動準備で十分
- **なぜchain-config.tsにBSCを残したか**: 将来Etherscanが無料BSC対応した時に `SUPPORTED_CHAIN_IDS` に "56" を追加するだけで即座に切り替え可能
- **`apiBaseUrl`/`apiKeyEnv`/`useChainIdParam` を追加した理由**: 将来 BscScan独自APIキー入手や別チェーン対応で代替APIを使う場合のための基盤
- **インポートExcelの取引詳細**: `"手動入力（BNB等のExcelインポート）"` で識別可能 → 後で監査・再生成判定に活用可能

### 既知の制約
- インポートExcelは「列1-10、1行目ヘッダー」形式のみ対応
- ファイル形式バリデーションは最小限（壊れたファイルは400エラー）
- 1ファイルのみアップロード可能（複数ブロックチェーン分を1ファイルにまとめる必要あり、または将来複数対応）

---

## 過去の作業記録（2026-05-15）FNCT手数料グループ化・10YETH無料mintボーナス化・main統合

### 作業概要
前回(2026-05-14)で実装した Polygon 対応(v8)を main にマージし、中優先度の分類改善2点を実装。
v10 出力で動作確認、ETH/POL ともに悪影響なしを確認の上で main に統合 → push。

### 完了した作業

#### 1. リポジトリ整理（高優先度）
- `feature/polygon-support` を `--no-ff` で main にマージ（CLAUDE.md コンフリクトは feature 側採用）
- `origin/main` に push（4コミット先行 → 同期）
- デバッグ・検証スクリプト(`debug-*.js`, `verify-*.js`, `compare-*.js`)を `.gitignore` 化（ローカル保持）

#### 2. 同一トークン短時間ペアの内部移動判定（中優先度）
- 新規関数 `groupSelfTokenMovementPairs` (`lib/transaction-converter.ts`)
- 同一トークンが「受取↔送付」を30分以内に発生したら両方を「手数料」に変更
- 金額表示は残す（手作業版スタイル準拠）、取引詳細に `(内部移動の可能性)` を追加
- 対象外: ネイティブ通貨(ETH/POL/MATIC/WETH/WMATIC)、ボーナス分類
- 効果: FNCT 7/28 16:29受取/16:31送付ペア(625/640)が両方「手数料」化 → 手作業版POLと一致

#### 3. NFT無料mintのボーナス判定（中優先度）
- `ownPaymentTxHashes` セットを追加（tx.value>0 or ERC20送出ありの自分発信TXハッシュ）
- `isNftBonusReceipt(hash)` = `!(ownInitiated && ownPayment)`
- NFT受取エントリで以下に該当すれば「ボーナス」化:
  - 他人発信（既存）
  - 自分発信＋同TXで支払いなし（新規・無料mint）
- groupNFTTrades 経由（paymentValue=0 で受取になるケース）にも適用
  - 当初は通常NFT loop のみ対応 → 10YETH が変わらず → trade ループにも適用する修正(`f80ac6b`)
- 効果: 10YETH (Ten Years Of Ethereum) 等の無料mintが「受取」→「ボーナス」に正しく分類

### 出力結果（v10）

| 項目 | v8 | v10 | 差分 |
|---|---|---|---|
| 合計 | 68行 | 68行 | ±0 |
| ETH | 37行 | 37行 | 受取-1/ボーナス+1（10YETH のみ移動） |
| POL | 31行 | 31行 | 受取-1/送付-1/手数料+2（FNCT ペアのみ移動） |
| 手作業POL(28行)との差分 | 3行 | 3行 | 変化なし（残3行は低優先度・実害なし） |

### コミット履歴

```
22e7752 Merge 'feature/classification-refinements' (main)
├── f80ac6b fix: NFT trade経由でも無料mintをボーナス判定
└── 9dda611 feat: 同一トークン短時間ペアの内部移動判定とNFT無料mintのボーナス判定
77ee89b Merge 'feature/polygon-support'
├── c281c44 feat: Polygon対応・DEXスワップ検出・ボーナス自動分類
└── 11bb01c docs: Polygon対応の次回作業予定
```

### 次回作業時の残タスク（低優先度のみ）

- [ ] **JPYC/USDC 余分行の除外判断**（手作業版POLとの差分3行、実害なし）
  - 行52: USDC 5.058 送付（スワップ後の送付）
  - 行62: JPYC 3000 ボーナス（手作業版の記載漏れの可能性）
- [ ] **ETH側「受取」2件のボーナス判定**
  - 2025-08-01 09:56 ETH 0.24826
  - 2025-12-30 20:56 ETH 0.0584413
  - 判断保留が適切な可能性あり（オンチェーン情報だけで判別困難）
- [ ] FNCT手数料グループ化のwindow調整（現状30分、必要なら設定化）
- [ ] BSC等の他チェーン対応（`参考/確定申告2025BNB.xlsx` あり）

### 検証手順（次回再現用）

1. dev サーバー起動（別ターミナル）: `npm run dev`
2. ブラウザ http://localhost:3000
3. ウォレット入力:
   - メイン: `0x01b27ec780c534ba0fab15509354c3798321273c`
   - サブ: `0x581087E117A68537b624e0352833dB96654c0481`
4. 対象年: 2025、ETH + Polygon 両方
5. Excel ダウンロード → `自動生成_ETHPOL/確定申告{year}仮想通貨_N.xlsx` 形式で保存
6. ロジック単体検証: `node verify-self-movement.js`（ローカル保持・10ケース）

---

## 過去の作業記録（2026-05-14）Polygon対応・DEXスワップ・ボーナス自動分類

### 作業概要
約3ヶ月ぶりに再開。`feature/polygon-support`ブランチでPolygon対応を実装中。

### 完了した作業

#### 1. Polygon DEXスワップ検出（3件）
- **SAND→WETH**: Bridge+DEX経由。ERC20 Transfer topicの修正（`chain-config.ts`の誤ったハッシュ値を修正）で解決
- **POL→WETH**: Bridge+DEX経由。同上
- **POL→USDC**: DEXスワップ。receipt内のERC20 Transfer検出で対応

#### 2. マーケットプレイスNFT売却検出
- **SnpitCameraNFT → 153.9 POL**: 買い手がTX発信、売り手はInternal TXでPOL受取
- `groupNFTTrades`内に`internalReceivedByHash`による検出ロジック追加
- `convertNFTTradeToEntry`に`paymentValueOverride`サポート追加

#### 3. ボーナス自動分類
- トークン/NFT受取で、自分がTXを発信していない場合 → 自動的に「ボーナス」に分類
- `ownInitiatedTxHashes`セットで判定
- ネイティブトークン（ETH/POL）の受取は対象外

#### 4. value=0トークン転送のフィルタリング
- USDC 0送付のような無意味な行を除去

#### 5. ERC20 Transfer Topic修正（重大バグ修正）
- `chain-config.ts`の`ERC20_TRANSFER_TOPIC`が誤ったハッシュだった
- 正: `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`
- これがreceipt内トークン検出全般の失敗原因だった

#### 6. Wafuku NFT分類の確認
- v7で「送付」→「売買」に変わったが、手作業版でも「売買 ETH 0.039」と記録されているため**正しい改善**
- Internal TXでETH受取を検出してマーケットプレイス売却と判定

### 現在の出力結果（v8）

#### 比較ファイル
- 自動生成: `自動生成_ETHPOL/確定申告2025仮想通貨_8.xlsx`
- POL手作業版: `参考/確定申告2025POL.xlsx`（28行）
- ETH参考: `自動生成_ETH/確定申告2025ETH_20.xlsx`（37行）
- ETH手作業版: `参考/確定申告2025ETH.xlsx`（21行）

#### v8結果
```
ETH: 37行 { 売買: 19, 手数料: 6, ボーナス: 4, 受取: 3, 送付: 5 }
POL: 31行 { 手数料: 3, 売買: 4, ボーナス: 21, 受取: 1, 送付: 2 }
合計: 68行
```

#### POL手作業版（28行）との残る差分（3行分）
1. **行37: FNCT 625受取が「受取」のまま** — 自分がTXを発信してFNCT受取しているため。手作業版では「手数料」扱い（手動判断の違い）
2. **行62: JPYC 3000 ボーナス** — 手作業版になし（手作業版の記載漏れの可能性）
3. **行52: USDC 5.058 送付** — 手作業版になし（スワップ後の送付。手作業版では省略）

### 次回作業時の残タスク（優先度順）

#### 高優先度
- [ ] `feature/polygon-support`ブランチをmainにマージするかの判断
- [ ] デバッグスクリプト群の整理（`debug-*.js`, `verify-*.js`, `compare-*.js`）

#### 中優先度
- [ ] FNCT手数料の3行→2行統合（手作業版のように受取+approve+送付を「手数料」グループ化）
- [ ] 10YETH NFTのボーナス判定改善（無料mint = 自分TX発信だがボーナス扱いが正しい可能性）

#### 低優先度
- [ ] JPYC/USDC余分行の除外判断（手作業版との差分。実害なし）
- [ ] ETH側「受取」3件のボーナス判定改善（ETH受取2件は判断保留が適切）

### 主要変更ファイル（今回のセッション）
- `lib/chain-config.ts`: ERC20_TRANSFER_TOPIC修正、マルチチェーン設定
- `lib/transaction-converter.ts`: DEXスワップ検出、Bridge+DEX、マーケットプレイスNFT売却、ボーナス自動分類、value=0フィルタ
- `app/api/export/route.ts`: receipt候補収集ロジック（トークン送出TXも対象化）

---

## 過去の作業記録（2026-02-24）

### 解決した技術課題3: NFT Burn取引の自動検出（ルールモジュールシステム）

#### 背景
- ユーザーからNFT焼却（Burn）取引の自動検出要望
- 2つのBurn取引が「減少」として分類されるべき
  - Hash 1: `0xc41e335893334906fbc4e6d94454cceb0f18f72955b30a219ecacee6210f8e18`
  - Hash 2: `0x7be15b654ca8ec92bf55650f985626d0f87b31e8d044fab452c1a25a1529a4d2`
- NFTをNullアドレス（`0x0000000000000000000000000000000000000000`）に送付
- 今後も同様のルールを追加していく必要性

#### 実装方針：ルールモジュールシステムの構築

**選択した方式**: ロジック条件分岐ではなく、拡張可能なルールモジュール方式

**理由**:
- 将来的なルール追加が容易
- 各ルールの独立性確保
- 優先度による柔軟な評価順序制御
- デバッグ・メンテナンス性の向上

#### 実装内容

**1. ルールモジュールの作成** (`lib/classification-rules.ts`):

```typescript
const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface RuleContext {
  tx: EtherscanTransaction;
  nftTransfers: EtherscanNFTTransfer[];
  tokenTransfers: EtherscanTokenTransfer[];
  internalTxs: EtherscanTransaction[];
  ownAddresses: Set<string>;
  txHash: string;
}

export interface ClassificationResult {
  type: "減少" | "送付" | "受取" | "売買" | "手数料" | "ボーナス" | null;
  reason?: string;
  skipDefault?: boolean;
}

interface ClassificationRule {
  id: string;
  description: string;
  priority: number;
  check: (context: RuleContext) => boolean;
  action: (context: RuleContext) => ClassificationResult;
}

export const classificationRules: ClassificationRule[] = [
  // ルール1: NFT焼却（Nullアドレスへの送付）
  {
    id: "nft-burn-to-null",
    description: "NFTをNullアドレスに送付（焼却）→ 減少",
    priority: 10,
    check: (ctx) => {
      if (ctx.nftTransfers.length === 0) return false;
      return ctx.nftTransfers.some((transfer) => {
        const from = (transfer.from || "").toLowerCase();
        const to = (transfer.to || "").toLowerCase();
        return (
          ctx.ownAddresses.has(from) &&
          to === NULL_ADDRESS
        );
      });
    },
    action: (ctx) => {
      const burnedNfts = ctx.nftTransfers.filter((transfer) => {
        const from = (transfer.from || "").toLowerCase();
        const to = (transfer.to || "").toLowerCase();
        return ctx.ownAddresses.has(from) && to === NULL_ADDRESS;
      });

      const nftNames = burnedNfts
        .map((nft) => `${nft.tokenName || "NFT"}#${nft.tokenID}`)
        .join(", ");

      return {
        type: "減少",
        reason: `NFT焼却（${nftNames} → Nullアドレス）`,
        skipDefault: true,
      };
    },
  },

  // ルール2: 自己ウォレット間のETH送金
  {
    id: "self-wallet-eth-transfer",
    description: "自己ウォレット間のETH送金 → 手数料（ガス代のみ）",
    priority: 20,
    // ... 実装済み
  },

  // ルール3: 自己ウォレット間のNFT送金
  {
    id: "self-wallet-nft-transfer",
    description: "自己ウォレット間のNFT送金 → 手数料（ガス代のみ）",
    priority: 21,
    // ... 実装済み
  },
];

export function evaluateClassificationRules(
  context: RuleContext
): ClassificationResult {
  const sortedRules = [...classificationRules].sort(
    (a, b) => a.priority - b.priority
  );

  for (const rule of sortedRules) {
    try {
      if (rule.check(context)) {
        const result = rule.action(context);
        console.log(
          `✅ ルール適用 [${rule.id}]: ${rule.description}`,
          `→ ${result.type}`,
          result.reason ? `(${result.reason})` : ""
        );
        return result;
      }
    } catch (error) {
      console.error(`❌ ルール評価エラー [${rule.id}]:`, error);
    }
  }

  return { type: null };
}
```

**2. トランザクション変換への統合** (`lib/transaction-converter.ts`):

```typescript
import {
  evaluateClassificationRules,
  type RuleContext,
} from "./classification-rules";

// 通常トランザクション処理の冒頭でルール評価
transactions.forEach((tx) => {
  if (isInYear(tx.timeStamp) && !isProcessed(tx.hash)) {
    const txHash = tx.hash;

    // ルールモジュールによる分類評価
    const hashNftTransfers = nftTransfers.filter((nft) => nft.hash === txHash);
    const hashErc1155Transfers = erc1155.filter((nft) => nft.hash === txHash);
    const allHashNftTransfers = [...hashNftTransfers, ...hashErc1155Transfers];
    const hashTokenTransfers = tokenTransfers.filter((token) => token.hash === txHash);
    const hashInternalTxs = internalByHash.get(txHash) || [];

    const ruleContext: RuleContext = {
      tx,
      nftTransfers: allHashNftTransfers,
      tokenTransfers: hashTokenTransfers,
      internalTxs: hashInternalTxs,
      ownAddresses: ownAddressSet,
      txHash,
    };

    const ruleResult = evaluateClassificationRules(ruleContext);

    if (ruleResult.type) {
      const fee = (parseFloat(tx.gasUsed) * parseFloat(tx.gasPrice)) / 1e18;

      if (ruleResult.type === "減少" && allHashNftTransfers.length > 0) {
        // NFT焼却の場合: NFT資産を減少させる
        allHashNftTransfers.forEach((nft) => {
          const nftName = `${nft.tokenName || "NFT"}#${nft.tokenID}`;
          entries.push({
            取引所名: "metamask",
            "日時（JST）": formatJSTDate(tx.timeStamp),
            取引種別: "減少",
            "取引通貨名(+)": "",
            "取引量(+)": 0,
            "取引通貨名(-)": `NFT資産${nftName}`,
            "取引量(-)": parseFloat(nft.tokenValue || "1"),
            取引額時価: "",
            手数料通貨名: "ETH",
            手数料数量: fee / allHashNftTransfers.length,
            取引詳細: ruleResult.reason || "",
          });
        });
      } else {
        // その他のルール（手数料等）
        entries.push({
          // ... 手数料エントリ生成
        });
      }

      markProcessed(txHash);

      if (ruleResult.skipDefault) {
        return;
      }
    }

    // 既存ロジック継続...
  }
});
```

**3. NFT売買グループ化からBurnを除外** (`lib/transaction-converter.ts`):

```typescript
function groupNFTTrades(/* ... */) {
  const nftByHash = new Map<string, EtherscanNFTTransfer[]>();
  [...nftTransfers, ...erc1155Transfers]
    .filter((nft) => !isSpamNFT(nft, userAddresses))
    .filter((nft) => !(isOwnAddress(nft.from, ownAddressSet) && isOwnAddress(nft.to, ownAddressSet)))
    .filter((nft) => (nft.to || "").toLowerCase() !== NULL_ADDRESS) // Burn除外
    .forEach((nft) => {
      const list = nftByHash.get(nft.hash) || [];
      list.push(nft);
      nftByHash.set(nft.hash, list);
    });
  // ...
}
```

**4. Excel出力への取引詳細列追加** (`lib/excel-generator.ts`):

```typescript
const headers = [
  "取引所名",
  "日時（JST）",
  "取引種別",
  "取引通貨名(+)",
  "取引量(+)",
  "取引通貨名(-)",
  "取引量(-)",
  "取引額時価",
  "手数料通貨名",
  "手数料数量",
  "取引詳細",  // 新規追加
  "要確認",
  "推奨取引種別",
  "確認理由",
];
```

#### デバッグと問題解決

**問題**: Burn取引が検出されない

**調査結果**:
- ログ出力: `isInYear: false` → 2025年で検索していたが、実際は2026年の取引
- Burn取引の実際の日時（JST）:
  - Hash 1: 2026-02-23 09:06:59
  - Hash 2: 2026-02-23 09:17:35

**解決**:
- 2026年で再検索 → ✅ 正しく検出

#### 検証結果

**Excel出力**（`test_burn_2026.xlsx`）:

```
行6:
  日時(JST): 2026-02-23 09:06:59
  取引種別: 減少
  取引通貨名(-): NFT資産Talisman Paper of Ema Taruto#1
  取引量(-): 1
  手数料通貨名: ETH
  手数料数量: 0.000223064363175588
  取引詳細: NFT焼却（Talisman Paper of Ema Taruto#1 → Nullアドレス）

行9:
  日時(JST): 2026-02-23 09:17:35
  取引種別: 減少
  取引通貨名(-): NFT資産Talisman Paper of Ema Taruto#1
  取引量(-): 1
  手数料通貨名: ETH
  手数料数量: 0.000211032414675384
  取引詳細: NFT焼却（Talisman Paper of Ema Taruto#1 → Nullアドレス）
```

**ログ出力**:
```
🔥 Burn候補検出: 0xc41e335893334906fbc4e6d94454cceb0f18f72955b30a219ecacee6210f8e18
  isInYear: true
  isProcessed: false
  NFT transfers found: 1
    [0] Talisman Paper of Ema Taruto#1
        from: 0x01b27ec780c534ba0fab15509354c3798321273c
        to: 0x0000000000000000000000000000000000000000
✅ ルール適用 [nft-burn-to-null]: NFTをNullアドレスに送付（焼却）→ 減少 → 減少 (NFT焼却（Talisman Paper of Ema Taruto#1 → Nullアドレス）)
```

#### 結論

✅ **NFT Burn取引の自動検出が完璧に動作**
- Nullアドレスへの送付を検出
- 取引種別「減少」として正しく分類
- NFT資産名と理由を記録
- 手数料（ガス代）も正しく計算

✅ **ルールモジュールシステムの確立**
- 優先度ベースの柔軟な評価順序
- 新規ルールの追加が容易
- 各ルールの独立性確保
- デバッグログによる検証可能性

✅ **今後の拡張性確保**
- Staking入金/出金ルール
- DEX Swap検出ルール
- Airdrop受取ルール
- 等、追加が容易な設計

---

### その他の変更（2026-02-24）

#### UIデフォルト年の変更

**変更内容** (`app/page.tsx`):
```typescript
// Before
const [year, setYear] = useState("2024");

// After
const [year, setYear] = useState("2026");
```

**理由**: テスト・実運用での利便性向上

---

### 解決した技術課題2: WETH取引の検出と自己ウォレット間送金の処理

#### 背景
- 別AIが解決できなかった取引分類問題を引き継ぎ
- MetaMask Bridge経由のETH→WETH取引が「送金」として誤分類
- WETH→ETH unwrap取引が「手数料」として誤分類
- 自己ウォレット間のETH送金の処理方法が不明確

#### 問題1: ETH→WETH取引の検出失敗

**問題のトランザクション**: `0xfb68eaa19c2d4750dc28678ea672e006818c43d273d1694fe702f832f971dda8`

**症状**:
- MetaMask Bridge経由の取引でWETH Transfer eventが存在しない
- Deposit eventのみ存在（topic: `0xe1fffcc4...`）
- 既存ロジックはTransfer eventのみ検出していたため、「送金」として誤分類

**解決策** (`lib/transaction-converter.ts`):
```typescript
// WETH Deposit event検出用の定数追加
const WETH_DEPOSIT_TOPIC =
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";

// Receipt logsからDeposit event検出
let wethDepositAmount = 0;
if (receipt && Array.isArray(receipt.logs)) {
  receipt.logs.forEach((log: any) => {
    const address = (log.address || "").toLowerCase();
    const topics: string[] = log.topics || [];

    if (
      address === WETH_CONTRACT_ADDRESS &&
      topics.length >= 1 &&
      (topics[0] || "").toLowerCase() === WETH_DEPOSIT_TOPIC.toLowerCase()
    ) {
      const amount = hexToEthAmount(log.data);
      wethDepositAmount += amount;
    }
  });
}

// 返金を考慮して実質的な交換量で両側を一致させる
const effectiveEthAmount = wethDepositAmountInReceipt;
entries.push(
  convertEthWethSwapToEntry(
    txHash,
    "ETH_TO_WETH",
    tx.timeStamp,
    effectiveEthAmount,  // Both sides use deposit amount
    wethDepositAmountInReceipt,
    fee
  )
);
```

**結果**:
- ✅ 取引種別: 売買
- ✅ WETH(+): 0.01486875
- ✅ ETH(-): 0.01486875（返金考慮済み）

#### 問題2: WETH→ETH unwrap取引の検出失敗

**問題のトランザクション**: `0x31265e0e7b324f1f01fc4007778fc3d8027bc5940812835ea2e726842427aa79`

**症状**:
- Method: `0x2e1a7d4d` (withdraw)
- WETH Withdrawal eventのみ存在（Transfer eventなし）
- Transaction value=0のためreceipt取得対象外
- 「手数料」として誤分類

**解決策**:

1. **Withdrawal event検出** (`lib/transaction-converter.ts`):
```typescript
const WETH_WITHDRAWAL_TOPIC =
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";

// Receipt logsからWithdrawal event検出
let wethWithdrawalAmount = 0;
if (
  address === WETH_CONTRACT_ADDRESS &&
  topics.length >= 1 &&
  (topics[0] || "").toLowerCase() === WETH_WITHDRAWAL_TOPIC.toLowerCase()
) {
  const amount = hexToEthAmount(log.data);
  wethWithdrawalAmount += amount;
}
```

2. **Receipt取得条件の拡張** (`app/api/export/route.ts`):
```typescript
const WETH_CONTRACT = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

data.transactions.forEach((tx) => {
  if (!isInYear(tx.timeStamp)) return;
  const isOwnTx = ownSet.has((tx.from || "").toLowerCase());
  const hasValue = parseFloat(tx.value || "0") > 0;
  const isWethCall = (tx.to || "").toLowerCase() === WETH_CONTRACT;

  // ETH送信取引 または WETH contract呼び出し（value=0でも）
  if (isOwnTx && (hasValue || isWethCall)) {
    receiptHashCandidates.add(tx.hash.toLowerCase());
  }
});
```

3. **Swap候補検出の強化**:
```typescript
// WETH contract呼び出しの検出
const hasWethContractCall = txs.some((tx) => {
  const to = (tx.to || "").toLowerCase();
  const method = (tx.methodId || "").toLowerCase();
  const from = (tx.from || "").toLowerCase();
  const isOwnTx = isOwnAddress(from, ownAddressSet);
  return (
    to === WETH_CONTRACT_ADDRESS &&
    isOwnTx &&
    (method === "0xd0e30db0" || method === "0x2e1a7d4d" || weiToEth(tx.value) > 0)
  );
});

// Internal TXでのWETH contract検出
internalByHash.forEach((txs, hash) => {
  const hasFromWeth = txs.some(
    (tx) => (tx.from || "").toLowerCase() === WETH_CONTRACT_ADDRESS && weiToEth(tx.value) > 0
  );
  if (hasFromWeth) {
    swapCandidateHashes.add(hash);
  }
});
```

**結果**:
- ✅ 取引種別: 売買
- ✅ ETH(+): 0.033
- ✅ WETH(-): 0.033

#### 問題3: 自己ウォレット間送金の処理（キタドロマニュアル準拠）

**確認した取引**:
1. `0x9d5074abc41c8aec28f31837f6bbcd240e428414aae665b0289ec0099855197e`
   - 2025-12-30 21:23:23: サブ→メイン（0.0437 ETH）
2. `0x1760d99eebb1eb0f5ec9f5f99ce1bffba4eda74d29875f82d4cbe107ab2330f6`
   - 2025-01-31 13:55:23: メイン→サブ（0.005 ETH）

**キタドロマニュアルの規定**:
> ⑪ 自分のウォレット間で仮想通貨を移動させた
> - 送金履歴の記入は不要
> - ガス代のみ記入。取引種別「減少」または「手数料」

**処理結果**:
- ✅ 取引種別: 手数料
- ✅ 取引通貨名(+)/(-): （空白）
- ✅ 取引量(+)/(-): （空白）
- ✅ 手数料のみ記入

**中間版(_6)との比較**:
- ❌ 中間版: 取引種別「送金」、金額表示あり（誤り）
- ✅ 最新版: 取引種別「手数料」、金額表示なし（正しい）

#### 最終検証結果

**比較対象ファイル**:
- 手作業版: `参考/確定申告2025ETH.xlsx`（21行、UTC時刻）
- 中間版: `参考_自動生成/確定申告2025ETH_6.xlsx`（33行）
- 最新版: `参考_自動生成/確定申告2025ETH_20.xlsx`（37行）

**改善点**:
1. ✅ ETH→WETH取引（3件）が全て「売買」として正しく分類
2. ✅ WETH→ETH取引（1件）が「売買」として正しく分類
3. ✅ 自己ウォレット間送金（2件）が「手数料」として正しく処理
4. ✅ 「送金」カテゴリが0件に（全て適切に再分類）
5. ✅ 新たに4件の取引を検出（NFT送付2件、手数料2件）

**取引種別の分布**:
```
中間版(_6) → 最新版(_20)
売買: 14件 → 17件 (+3件) ✅
受取: 8件 → 7件 (-1件)
送付: 0件 → 7件 (+7件) ✅
手数料: 3件 → 6件 (+3件) ✅
送金: 8件 → 0件 (-8件) ✅
```

**結論**:
- ✅ WETH取引の検出・分類が完璧に動作
- ✅ 自己ウォレット間送金の処理がキタドロマニュアルに準拠
- ✅ 「出来なくなった事」はゼロ、すべて改善・正確化

---

### 過去の解決済み課題：タイムスタンプのタイムゾーン問題（2026-02-23）

#### 問題の発見
- 自動生成版Excelと手作業版Excelで時刻に9時間のずれが発生
- 手作業版: `2025-01-01 07:28:23`
- 自動生成版: `2025-01-01 16:28:23`

#### 調査結果
1. **Etherscan APIのタイムスタンプ仕様**
   - UNIXタイムスタンプ（秒単位）
   - UTC時刻ベース

2. **原因の特定**
   - 手作業版: UTCタイムスタンプをそのままコピー（列タイトルは「日時（JST）」だが実際はUTC）
   - 自動生成版: UTC + 9時間 = JST（**正しい変換**）

#### 実装した修正

**修正前のコード** (`lib/transaction-converter.ts`):
```typescript
function formatJSTDate(timestamp: string): string {
  const utcDate = new Date(parseInt(timestamp) * 1000);
  const jstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
  // ... ローカルタイムゾーンの影響を受ける実装
}
```

**問題点**: JavaScriptの`new Date()`はローカルタイムゾーンで解釈されるため、JST環境では二重に9時間加算される可能性があった。

**修正後のコード**:
```typescript
function formatJSTDate(timestamp: string): string {
  const ms = parseInt(timestamp) * 1000;

  // UTC時刻として明示的に取得
  const date = new Date(ms);
  const utcYear = date.getUTCFullYear();
  const utcMonth = date.getUTCMonth();
  const utcDate = date.getUTCDate();
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();
  const utcSeconds = date.getUTCSeconds();

  // UTC時刻に9時間加算してJSTに変換
  const jstDate = new Date(Date.UTC(utcYear, utcMonth, utcDate, utcHours + 9, utcMinutes, utcSeconds));

  const year = jstDate.getUTCFullYear();
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jstDate.getUTCDate()).padStart(2, '0');
  const hours = String(jstDate.getUTCHours()).padStart(2, '0');
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(jstDate.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
```

**改善点**:
- `Date.getUTC*()`メソッドを使用してUTC基準で時刻を取得
- ローカルタイムゾーンの影響を完全に排除
- 確実に9時間加算してJST時刻を生成

#### 検証結果

**テストケース**:
```
UNIXタイムスタンプ: 1663827167
UTC: 2022-09-22 06:12:47
期待値(JST): 2022-09-22 15:12:47
変換結果: 2022-09-22 15:12:47 ✓
```

**実ファイル比較**:
```
UTC時刻: 2025-01-01 07:28:23
正しいJST: 2025-01-01 16:28:23
```

#### 結論
- **自動生成版が正しい**（UTCをJSTに正しく変換）
- 手作業版は参考データとしてUTC時刻が入っていた（修正不要）
- タイムスタンプ変換ロジックの修正完了

## プロジェクト構成

```
Crypto-kakeibo/
├── app/
│   ├── page.tsx                    # メインUI（デフォルト年: 2026）
│   ├── api/
│   │   ├── transactions/route.ts   # Etherscan APIからデータ取得（プレビュー用）
│   │   ├── export/route.ts         # Excel生成・ダウンロード（全チェーン統合）
│   │   └── debug-tokens/route.ts   # デバッグ用
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── chain-config.ts             # マルチチェーン設定（ETH/POL/BSC）、イベントトピック定数
│   ├── etherscan.ts                # Etherscan v2 APIクライアント（chainid対応）
│   ├── transaction-converter.ts    # 取引データ→会計エントリ変換（~2000行、中核ロジック）
│   ├── classification-rules.ts     # 取引分類ルールモジュール（拡張可能設計）
│   ├── excel-importer.ts           # 手作業Excel → AccountingEntry 変換
│   ├── bscscan-csv-importer.ts     # BscScan CSV → Etherscan v2互換JSON 変換（BSC専用）
│   ├── export-pipeline.ts          # エクスポート共通関数（API/CLI両方から使用）
│   └── excel-generator.ts          # Excel生成ロジック
├── scripts/
│   └── export-tax.ts               # CLIスクリプト（npm run export）
├── types/
│   └── index.ts                    # TypeScript型定義
├── 参考/
│   ├── 確定申告2025ETH.xlsx        # ETH手作業版（21行、UTC時刻）
│   └── 確定申告2025POL.xlsx        # POL手作業版（28行）
├── 自動生成_ETH/
│   └── 確定申告2025ETH_20.xlsx     # ETH自動生成最終版（37行）
├── 自動生成_ETHPOL/
│   └── 確定申告2025仮想通貨_13.xlsx # v13（ETH+POL+BSC CSV統合・144行）★最新
├── BSC取引データ/                  # BscScan CSV配置先（.gitignore で *.csv 除外）
├── 参考ドキュメント/
│   └── キタドロ.md                 # Gtax共通フォーマット・確定申告ノウハウ
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
└── .env.local                      # Etherscan APIキー
```

## 次回作業時の注意事項

1. **タイムスタンプ検証**
   - 自動生成版のタイムスタンプは正しいJST時刻
   - 手作業版はUTC時刻なので参考程度に

2. **推奨ワークフロー: CLIスクリプト**（dev server不要）
   ```bash
   npm run export -- --year 2025
   ```
   → `自動生成_ETHPOL/確定申告{year}仮想通貨_{N}.xlsx` を自動採番で出力

3. **BSC CSV 更新時**
   - `BSC取引データ/` ディレクトリにBscScanからDLしたCSV 4種を配置
   - `npm run export` 実行で自動取り込み

4. **UIで操作したい場合**（任意ウォレット、視覚的確認）
   ```bash
   npm run dev
   ```
   別ターミナルで起動 → http://localhost:3000

5. **キャッシュクリア**（変更が反映されない場合）
   ```bash
   rm -rf .next
   ```

## 技術的な学び

### Etherscan API
- レート制限: 3 req/sec（無料プラン）
- レスポンス: UNIXタイムスタンプ（UTC基準）
- API種別: 通常TX、Internal TX、ERC20、ERC721、ERC1155

### タイムゾーン処理のベストプラクティス
- JavaScriptでのタイムゾーン処理は`Date.getUTC*()`を使用
- ローカルタイムゾーンに依存しない実装が重要
- UNIXタイムスタンプは常にUTC基準

### WETH取引の検出ロジック
- **Deposit event**: ETH→WETH（wrapping）を検出（topic: `0xe1fffcc4...`）
- **Withdrawal event**: WETH→ETH（unwrapping）を検出（topic: `0x7fcf532c...`）
- **Transfer event**: 通常のWETH転送を検出
- MetaMask Bridge等でTransfer eventが無い場合もDeposit/Withdrawalで検出
- Receipt取得条件: ETH送信 または WETH contract呼び出し（value=0でも）

### NFT売買の検出ロジック
- 同一トランザクションハッシュでETH/WETH転送とNFT転送をマッチング
- ERC721（個別NFT）とERC1155（数量あり）の両対応
- 売買取引として統合して1行で表示

### 自己ウォレット間送金の処理
- キタドロマニュアルに準拠：送金履歴は記入不要、ガス代のみ記入
- 取引種別「手数料」として処理（「減少」も可）
- 複数ウォレット（メイン・サブ）を`addresses`配列で指定
- 自己間送金を自動検出し、損益計上から除外

## 環境変数

`.env.local`:
```
NEXT_PUBLIC_ETHERSCAN_API_KEY=your-api-key-here
```

取得方法: https://etherscan.io/myapikey

## 今後の改善案

- [x] Polygon対応（2026-05-15 main統合完了・origin push済み）
- [x] FNCT手数料グループ化（同一トークン短時間ペア検出として汎用実装、2026-05-15）
- [x] 10YETH NFTのボーナス判定改善（無料mint対応、2026-05-15）
- [x] BSC対応（手動Excelインポート、2026-05-16 前半）
- [x] BSC対応（BscScan CSV自動取り込み + CLIスクリプト化、2026-05-16 第3セッション）
- [ ] Arbitrum等の他チェーン対応（既存パイプラインに `SUPPORTED_CHAIN_IDS` 追加で容易）
- [ ] 複数年度のバッチ処理
- [ ] 取引履歴のローカル保存・再利用（APIリクエスト削減）
- [ ] BSC側 Aave Supply/LP NFT の専用分類ルール追加（現状は要確認フラグ運用）
- [ ] UI/UXの改善（進捗表示、エラーハンドリング）

## 参考資料

- **キタドロマニュアル**: `参考ドキュメント/キタドロ.md`
  - Gtax共通フォーマットの入力方法
  - NFT・エアドロップ対応の確定申告ノウハウ
  - 取引種別の分類基準（売買/送付/手数料/ボーナス等）

## 重要な技術的決定事項

1. **タイムスタンプはJST表示**（UTC + 9時間）
2. **WETH/WMATIC取引はDeposit/Withdrawal eventで検出**
3. **自己ウォレット間送金は「手数料」処理**（キタドロマニュアル準拠）
4. **複数ウォレット対応**（`addresses`配列で指定）
5. **Receipt取得はWETH contract呼び出し + トークン送出TXも対象**
6. **Etherscan v2 API使用**（`chainid`パラメータで全チェーン統一エンドポイント）
7. **Bridge+DEXパターン**: 最終トークンがユーザーでなくブリッジコントラクトに送られるケースに対応
8. **ボーナス判定**: 自分がTX発信していないトークン/NFT受取 → 自動「ボーナス」分類
9. **マーケットプレイスNFT売却**: NFT OUT + Internal TX受取 → 売買として検出

---

**最終更新**: 2026-05-16
**ステータス**: BSC BscScan CSV自動取り込み + CLI スクリプト化完了。ETH+POL+BSC 3チェーン統合の確定申告Excel生成を `npm run export` 1コマンドで実現。v13 出力で動作確認済み（144行）

## テスト用ウォレットアドレス

- メイン: `0x01b27ec780c534ba0fab15509354c3798321273c`
- サブ: `0x581087E117A68537b624e0352833dB96654c0481`
