# Crypto-kakeibo プロジェクト記録

## プロジェクト概要

仮想通貨（Ethereum）の取引履歴を取得し、確定申告用のExcelファイルを自動生成するWebアプリケーション。

### 技術スタック
- **フレームワーク**: Next.js 15 + React 19 + TypeScript
- **スタイリング**: Tailwind CSS 4.1
- **主要ライブラリ**: ExcelJS, date-fns
- **API**: Etherscan API（無料プラン）

### 主な機能
1. Ethereumウォレットアドレスから取引履歴を取得
2. 取引種別の自動判定（送金/受取/売買/手数料）
3. NFT売買の自動検出・グループ化
4. スパムトークンの自動フィルタリング
5. 確定申告用Excel形式での出力

## 最新作業記録（2026-02-24）

### 解決した技術課題：WETH取引の検出と自己ウォレット間送金の処理

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
│   ├── page.tsx                    # メインUI
│   ├── api/
│   │   ├── transactions/route.ts   # Etherscan APIからデータ取得
│   │   ├── export/route.ts         # Excel生成・ダウンロード
│   │   └── debug-tokens/route.ts   # デバッグ用
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── etherscan.ts                # Etherscan APIクライアント
│   ├── transaction-converter.ts    # 取引データ→会計エントリ変換
│   └── excel-generator.ts          # Excel生成ロジック
├── types/
│   └── index.ts                    # TypeScript型定義
├── 参考/
│   └── 確定申告2025ETH.xlsx        # 手作業版（UTC時刻）
├── 参考_自動生成/
│   ├── 確定申告2025ETH_2.xlsx      # 旧版（修正前）
│   └── 確定申告2025ETH_3.xlsx      # 最新版（修正後）
├── 確定申告2026ETH.xlsx            # 2026年用テストファイル
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

2. **開発サーバー起動**
   ```bash
   npm run dev
   ```
   アクセス: http://localhost:3000

3. **Excel出力テスト**
   - ウォレットアドレス: `0x01b27ec780c534ba0fab15509354c3798321273c`
   - 対象年: 2025 または 2026
   - 出力ファイル名: `確定申告{year}ETH.xlsx`

4. **キャッシュクリア**（変更が反映されない場合）
   ```bash
   rm -rf .next
   npm run dev
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

- [ ] 他のブロックチェーン対応（BSC、Polygon等）
- [ ] 複数年度のバッチ処理
- [ ] 取引履歴のローカル保存・再利用
- [ ] より詳細な取引種別の自動判定
- [ ] UI/UXの改善（進捗表示、エラーハンドリング）

## 参考資料

- **キタドロマニュアル**: `参考ドキュメント/キタドロ.md`
  - Gtax共通フォーマットの入力方法
  - NFT・エアドロップ対応の確定申告ノウハウ
  - 取引種別の分類基準（売買/送付/手数料/ボーナス等）

## 重要な技術的決定事項

1. **タイムスタンプはJST表示**（UTC + 9時間）
2. **WETH取引はDeposit/Withdrawal eventで検出**
3. **自己ウォレット間送金は「手数料」処理**（キタドロマニュアル準拠）
4. **複数ウォレット対応**（`addresses`配列で指定）
5. **Receipt取得はWETH contract呼び出しも対象**

---

**最終更新**: 2026-02-24
**ステータス**: WETH取引検出・自己間送金処理完了・動作確認済み
