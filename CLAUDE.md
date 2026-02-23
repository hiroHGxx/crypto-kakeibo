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

## 最新作業記録（2026-02-23）

### 解決した技術課題：タイムスタンプのタイムゾーン問題

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

### NFT売買の検出ロジック
- 同一トランザクションハッシュでETH/WETH転送とNFT転送をマッチング
- ERC721（個別NFT）とERC1155（数量あり）の両対応
- 売買取引として統合して1行で表示

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

---

**最終更新**: 2026-02-23
**ステータス**: タイムスタンプ修正完了・動作確認済み
