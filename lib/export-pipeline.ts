import path from "path";
import fs from "fs/promises";
import { EtherscanAPI } from "./etherscan";
import { convertAllTransactions } from "./transaction-converter";
import { importEntriesFromExcel } from "./excel-importer";
import { importBscscanCsvs } from "./bscscan-csv-importer";
import { SUPPORTED_CHAIN_IDS, CHAIN_CONFIGS } from "./chain-config";
import { AccountingEntry } from "@/types";

export interface BuildEntriesInput {
  targetAddresses: string[];
  year?: number;
  /** BSC等の手作業Excelをマージしたい場合のバッファ */
  importExcelBuffer?: Buffer | ArrayBuffer | null;
  /** BSC CSV ディレクトリ。省略時は <cwd>/BSC取引データ を使用、存在しない場合はスキップ */
  bscCsvDir?: string;
}

export interface BuildEntriesResult {
  entries: AccountingEntry[];
  skippedChains: { name: string; reason: string }[];
}

/**
 * ETH+POL を Etherscan v2 API から取得し、BSC は CSV から、
 * 任意の手作業Excelもマージして、全エントリをタイムスタンプ昇順で返す。
 *
 * API route とCLIスクリプト両方から呼び出される共通ロジック。
 */
export async function buildExportEntries(
  input: BuildEntriesInput
): Promise<BuildEntriesResult> {
  const { targetAddresses, year, importExcelBuffer, bscCsvDir } = input;
  const ownSet = new Set(targetAddresses.map((a) => a.toLowerCase()));
  const isInYear = (timestamp: string): boolean => {
    if (!year) return true;
    const date = new Date(parseInt(timestamp) * 1000);
    return date.getFullYear() === year;
  };

  const allEntries: AccountingEntry[] = [];
  const skippedChains: { name: string; reason: string }[] = [];

  // ETH / POL: Etherscan v2 から取得
  for (const chainId of SUPPORTED_CHAIN_IDS) {
    const config = CHAIN_CONFIGS[chainId];
    const apiKey = process.env[config.apiKeyEnv];
    if (!apiKey) {
      console.warn(
        `⚠️ ${config.name}: ${config.apiKeyEnv} が未設定のためスキップ`
      );
      skippedChains.push({
        name: config.name,
        reason: `${config.apiKeyEnv} 未設定`,
      });
      continue;
    }
    console.log(`\n📦 ${config.name} (chainId=${chainId}) データ取得開始...`);

    const etherscan = new EtherscanAPI(apiKey, config);
    let data;
    try {
      data = await etherscan.getAllTransactionsForAddresses(targetAddresses, year);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `⚠️ ${config.name} データ取得失敗（このチェーンをスキップ）: ${msg}`
      );
      skippedChains.push({ name: config.name, reason: msg });
      continue;
    }

    console.log(
      `  通常TX: ${data.transactions.length}件, Internal: ${data.internalTxs.length}件, Token: ${data.tokenTransfers.length}件, NFT: ${data.nftTransfers.length}件, ERC1155: ${data.erc1155Transfers.length}件`
    );

    // Receipt取得候補を収集
    const receiptHashCandidates = new Set<string>();
    const wrappedContract = config.wrappedNativeAddress;
    const ownTokenOutHashes = new Set<string>();
    data.tokenTransfers.forEach((transfer) => {
      if (!isInYear(transfer.timeStamp)) return;
      if (ownSet.has((transfer.from || "").toLowerCase())) {
        ownTokenOutHashes.add(transfer.hash.toLowerCase());
      }
    });
    data.transactions.forEach((tx) => {
      if (!isInYear(tx.timeStamp)) return;
      const isOwnTx = ownSet.has((tx.from || "").toLowerCase());
      const hasValue = parseFloat(tx.value || "0") > 0;
      const isWrappedCall = (tx.to || "").toLowerCase() === wrappedContract;
      if (isOwnTx && (hasValue || isWrappedCall)) {
        receiptHashCandidates.add(tx.hash.toLowerCase());
      }
      if (isOwnTx && ownTokenOutHashes.has(tx.hash.toLowerCase())) {
        receiptHashCandidates.add(tx.hash.toLowerCase());
      }
    });
    data.tokenTransfers.forEach((transfer) => {
      if (!isInYear(transfer.timeStamp)) return;
      if (
        (transfer.tokenSymbol || "").toUpperCase() === config.wrappedNativeToken
      ) {
        receiptHashCandidates.add(transfer.hash.toLowerCase());
      }
    });

    const receiptHashes = Array.from(receiptHashCandidates).slice(0, 200);
    const receiptsByHash = await etherscan.getTransactionReceipts(receiptHashes);

    const entries = convertAllTransactions(
      data.transactions,
      data.internalTxs,
      data.tokenTransfers,
      data.nftTransfers,
      targetAddresses,
      year,
      data.erc1155Transfers,
      receiptsByHash,
      config
    );

    console.log(`  ✅ ${config.name}: ${entries.length}件のエントリ生成`);
    allEntries.push(...entries);
  }

  // BSC: CSV から取り込み
  const bscDir = bscCsvDir || path.join(process.cwd(), "BSC取引データ");
  try {
    const dirExists = await fs.stat(bscDir).then(
      (s) => s.isDirectory(),
      () => false
    );
    if (dirExists) {
      const bscConfig = CHAIN_CONFIGS["56"];
      console.log(`\n📦 ${bscConfig.name} CSV読み込み開始: ${bscDir}`);
      const bscData = await importBscscanCsvs(bscDir, { year });
      console.log(
        `  通常TX: ${bscData.transactions.length}件, Internal: ${bscData.internalTxs.length}件, Token: ${bscData.tokenTransfers.length}件, NFT: ${bscData.nftTransfers.length}件, ERC1155: ${bscData.erc1155Transfers.length}件`
      );
      const bscEntries = convertAllTransactions(
        bscData.transactions,
        bscData.internalTxs,
        bscData.tokenTransfers,
        bscData.nftTransfers,
        targetAddresses,
        year,
        bscData.erc1155Transfers,
        undefined, // CSVにreceipt logsは含まれない
        bscConfig
      );
      console.log(`  ✅ ${bscConfig.name}: ${bscEntries.length}件のエントリ生成`);
      allEntries.push(...bscEntries);
    } else {
      console.log(`ℹ️  BSC CSVディレクトリ未配置（${bscDir}）— スキップ`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ BSC CSV読み込み失敗（スキップ）: ${msg}`);
    skippedChains.push({ name: "BSC", reason: msg });
  }

  // 手作業Excel取り込み（任意）
  if (importExcelBuffer) {
    const importedEntries = await importEntriesFromExcel(
      importExcelBuffer as Buffer,
      { year }
    );
    console.log(
      `\n📥 インポートExcel: ${importedEntries.length}件のエントリを取り込み`
    );
    allEntries.push(...importedEntries);
  }

  // タイムスタンプ昇順ソート
  allEntries.sort((a, b) => {
    return (
      new Date(a["日時（JST）"]).getTime() -
      new Date(b["日時（JST）"]).getTime()
    );
  });

  console.log(`\n📊 全チェーン合計: ${allEntries.length}件のエントリ`);

  return { entries: allEntries, skippedChains };
}
