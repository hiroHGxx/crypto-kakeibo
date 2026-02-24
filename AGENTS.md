# Crypto-kakeibo Codex記録

## 概要
- 本プロジェクトは、Etherscanの取引履歴をGtax共通フォーマット向けExcelへ変換するNext.jsアプリ。
- Codex運用時の記録先として本ファイルを使用する。

## 最新記録（2026-02-24）

### NFT Burn取引検出ルールモジュールの実装（Claude Code担当）

#### 背景
- WETH取引検出完了後、ユーザーからNFT焼却（Burn）取引の自動検出要望
- 2つのBurn取引（Nullアドレスへの送付）を「減少」として自動分類したい
- 今後も同様のルールを追加していく拡張性が必要

#### 技術的課題と解決策

**課題1**: 取引分類ロジックが複雑化・保守困難化のリスク
- **解決**: ルールモジュールシステムの構築
  - 優先度ベースの評価順序
  - 各ルールの独立性確保
  - 新規ルール追加の容易性

**課題2**: NFT Burn取引の検出方法
- **解決**: Nullアドレス（`0x0000...0000`）への送付検出
  - ERC721/ERC1155両対応
  - NFT売買グループ化からBurnを除外
  - 取引詳細に理由を記録

**課題3**: デバッグと検証の効率化
- **解決**: 詳細ログ出力システム
  - 特定ハッシュの追跡
  - ルール評価結果の可視化
  - 年度フィルタリングの確認

#### 実装成果

**1. ルールモジュールシステム** (`lib/classification-rules.ts`)
```typescript
export interface ClassificationRule {
  id: string;
  description: string;
  priority: number;
  check: (context: RuleContext) => boolean;
  action: (context: RuleContext) => ClassificationResult;
}

export const classificationRules: ClassificationRule[] = [
  {
    id: "nft-burn-to-null",
    description: "NFTをNullアドレスに送付（焼却）→ 減少",
    priority: 10,
    check: (ctx) => /* Nullアドレス検出 */,
    action: (ctx) => ({
      type: "減少",
      reason: `NFT焼却（${nftNames} → Nullアドレス）`,
      skipDefault: true,
    }),
  },
  // 自己ウォレット間ETH/NFT送金ルールも統合
];
```

**2. 実装されたルール**
- ✅ NFT焼却（Nullアドレス送付） → 減少
- ✅ 自己ウォレット間ETH送金 → 手数料
- ✅ 自己ウォレット間NFT送金 → 手数料

**3. Excel出力強化**
- 取引詳細列を追加
- Burn理由の自動記録
- NFT資産名の明確化

#### 検証結果

**テスト取引**（2026年）:
- Hash 1: `0xc41e...` → ✅ 減少として検出
- Hash 2: `0x7be1...` → ✅ 減少として検出

**Excel出力**:
```
取引種別: 減少
取引通貨名(-): NFT資産Talisman Paper of Ema Taruto#1
取引量(-): 1
手数料通貨名: ETH
手数料数量: 0.000223...
取引詳細: NFT焼却（Talisman Paper of Ema Taruto#1 → Nullアドレス）
```

#### 技術的優位性

**拡張性**:
- 新規ルール追加が容易（1ファイル編集のみ）
- 優先度による柔軟な制御
- 既存ルールとの競合回避

**保守性**:
- ルール単位での独立テスト可能
- デバッグログによる問題切り分け
- コードの可読性向上

**将来の拡張例**:
- Staking入金/出金検出
- DEX Swap自動分類
- Airdrop受取検出
- Bridge取引検出

---

### WETH取引検出の実装（Claude Code担当）（完了）

#### 背景
- 別AIが解決できなかったWETH取引の分類問題を引き継ぎ
- MetaMask Bridge経由のETH→WETH取引でWETH Transfer eventが存在しないケースに対応
- WETH→ETH unwrap取引（method: `0x2e1a7d4d`）の検出失敗に対応

#### 実装内容
1. **WETH Deposit event検出**
   - Topic: `0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c`
   - ETH→WETH（wrapping）の検出
   - 返金を考慮した実質的な交換量計算

2. **WETH Withdrawal event検出**
   - Topic: `0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65`
   - WETH→ETH（unwrapping）の検出
   - Internal TXからの検出もサポート

3. **Receipt取得条件の拡張**
   - WETH contract呼び出し（value=0でも）を対象に追加
   - Swap候補検出の強化（method ID: `0xd0e30db0`, `0x2e1a7d4d`）

#### 自己ウォレット間送金の処理
- キタドロマニュアル準拠：送金履歴は記入不要、ガス代のみ記入
- 取引種別「手数料」として処理
- 複数ウォレット（メイン・サブ）を自動検出

#### 検証結果
- ✅ ETH→WETH取引（3件）: 「売買」として正しく分類
- ✅ WETH→ETH取引（1件）: 「売買」として正しく分類
- ✅ 自己ウォレット間送金（2件）: 「手数料」として正しく処理
- ✅ 中間版から最新版で「送金」カテゴリが0件に改善
- ✅ 37行（中間版33行から+4件検出）

---

## 過去の記録（2026-02-23 - Codex担当）

### 1. NFT複数購入時の扱い
- 同一Tx Hash内に複数NFTがある場合、1行に潰さず複数行で出力するよう修正済み。
- ただし、個別価格をオンチェーン取得データだけで復元できないケースがあり、そうした場合は均等按分を実施。
- 按分された行には `要確認` フラグを立て、手動修正対象として明示する運用にした。

### 2. NFTスパム除外
- URL誘導系などの受信NFT（例: `.com`, `https://`, `claim`, `visit` など）をスパムとして除外。

### 3. 取引種別の自動分類方針（Gtax準拠）
- 自動で確定できるものは確定分類。
- オンチェーン情報だけでは意図が確定できないものは、`要確認` を付与して人間判断に回す。
- Excel補助列として以下を追加済み。
  - `要確認`
  - `推奨取引種別`
  - `確認理由`
- 取り込み前に上記補助列を削除する運用。

### 4. 送金表記の統一
- `取引種別` の表記を `送付` に統一（`送金` は使用しない方針）。

### 5. Excel数値表示
- 不要な末尾ゼロを表示しない形式に変更。
  - 例: `0.010000000000000000` → `0.01`
  - 例: `0.248260610000000000` → `0.24826061`
- 形式: `0.##################`（最大18桁、小数末尾0省略）

## 現在の運用メモ
- 個別価格が復元できないNFTバンドル取引は、按分値を採用し `要確認` で手動判断する。
- 取引所名は `metamask` 固定で運用。
- 手作業版と完全一致を目標にせず、Gtaxルール適合を優先する。

## 既知の技術課題（今回未対応）
- `npx tsc --noEmit` は既存エラーで失敗する。
  - `app/api/export/route.ts`: `NextResponse` に `Buffer` を渡す型不一致
  - `lib/transaction-converter.ts`: `EtherscanTransaction` 型に `functionName` が未定義

