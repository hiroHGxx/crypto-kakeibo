import fs from "fs/promises";
import path from "path";
import {
  EtherscanTransaction,
  EtherscanTokenTransfer,
  EtherscanNFTTransfer,
} from "@/types";

/**
 * BscScan が出力する CSV (4種) を読み込み、Etherscan v2 互換の JSON 形式
 * (EtherscanTransaction[] 等) に変換して既存パイプラインに流す。
 *
 * 4種CSV（ファイル名は自由）:
 *   - 通常TX     : "Value_IN(BNB)" / "Value_OUT(BNB)" / "TxnFee(BNB)" / "Method" 等
 *   - 内部TX     : "ParentTxFrom" / "TxTo" / "Value_IN(BNB)" / "Value_OUT(BNB)" 等
 *   - BEP-20     : "TokenValue" / "TokenName" / "TokenSymbol" / "ContractAddress"
 *   - NFT(721/1155): "Type" カラムが "721" or "1155"
 *
 * 設計判断:
 *   - 手数料: gasPrice=1, gasUsed=fee*1e18 として後段の計算式
 *     (gasUsed * gasPrice / 1e18) で fee を復元できるよう詰め直す。
 *   - トークン量: BscScan CSV の TokenValue は人間可読の数値（カンマ区切り）。
 *     tokenDecimal="0", value=人間可読数（カンマ除去）として詰めることで
 *     既存の value/10^decimal 変換でそのまま正しい値になる。
 *   - Receipt logs は CSV に含まれないため、WETH wrap/unwrap や DEX log 解析
 *     に依存する判定は機能しない（既存パイプラインのフォールバックで処理）。
 */

export interface BscCsvData {
  transactions: EtherscanTransaction[];
  internalTxs: EtherscanTransaction[];
  tokenTransfers: EtherscanTokenTransfer[];
  nftTransfers: EtherscanNFTTransfer[];
  erc1155Transfers: EtherscanNFTTransfer[];
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

function stripNumberCommas(v: string): string {
  return v.replace(/,/g, "").trim();
}

function feeBnbToGasUsedWei(feeBnb: string): string {
  const f = parseFloat(stripNumberCommas(feeBnb || "0"));
  if (!isFinite(f) || f <= 0) return "0";
  // gasPrice=1 wei, gasUsed=feeBnb*1e18 → 計算式で復元可能
  return Math.round(f * 1e18).toString();
}

function bnbToWei(bnb: string): string {
  const f = parseFloat(stripNumberCommas(bnb || "0"));
  if (!isFinite(f) || f <= 0) return "0";
  return Math.round(f * 1e18).toString();
}

function inYearJST(unixSec: string, year?: number): boolean {
  if (!year) return true;
  const ms = parseInt(unixSec) * 1000;
  // formatJSTDate と同じ計算でJST年を判定
  const d = new Date(ms);
  const jstYear = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours() + 9,
      d.getUTCMinutes(),
      d.getUTCSeconds()
    )
  ).getUTCFullYear();
  return jstYear === year;
}

/**
 * 通常TX CSV → EtherscanTransaction[]
 */
function mapNormalTx(
  rows: Record<string, string>[],
  year?: number
): EtherscanTransaction[] {
  return rows
    .filter((r) => inYearJST(r["UnixTimestamp"], year))
    .map((r) => {
      const valueIn = parseFloat(stripNumberCommas(r["Value_IN(BNB)"] || "0"));
      const valueOut = parseFloat(stripNumberCommas(r["Value_OUT(BNB)"] || "0"));
      const valueBnb = valueIn > 0 ? valueIn : valueOut;
      const status = (r["Status"] || "").trim();
      // BscScan: 正常時は空, エラー時は "Error" or similar
      const isError = status && status !== "0" ? "1" : "0";
      return {
        blockNumber: r["Blockno"] || "0",
        timeStamp: r["UnixTimestamp"] || "0",
        hash: (r["Transaction Hash"] || "").toLowerCase(),
        from: (r["From"] || "").toLowerCase(),
        to: (r["To"] || "").toLowerCase(),
        value: Math.round(valueBnb * 1e18).toString(),
        gas: "0",
        gasPrice: "1",
        gasUsed: feeBnbToGasUsedWei(r["TxnFee(BNB)"]),
        isError,
        methodId: r["Method"] || "",
        contractAddress: (r["ContractAddress"] || "").toLowerCase(),
      };
    });
}

/**
 * Internal TX CSV → EtherscanTransaction[]
 *
 * 内部TXは gas を消費しない（親TXのgasに含まれる）ため gas関連は 0。
 */
function mapInternalTx(
  rows: Record<string, string>[],
  year?: number
): EtherscanTransaction[] {
  return rows
    .filter((r) => inYearJST(r["UnixTimestamp"], year))
    .map((r) => {
      const valueIn = parseFloat(stripNumberCommas(r["Value_IN(BNB)"] || "0"));
      const valueOut = parseFloat(stripNumberCommas(r["Value_OUT(BNB)"] || "0"));
      const valueBnb = valueIn > 0 ? valueIn : valueOut;
      return {
        blockNumber: r["Blockno"] || "0",
        timeStamp: r["UnixTimestamp"] || "0",
        hash: (r["Transaction Hash"] || "").toLowerCase(),
        from: (r["From"] || "").toLowerCase(),
        to: (r["TxTo"] || "").toLowerCase(),
        value: Math.round(valueBnb * 1e18).toString(),
        gas: "0",
        gasPrice: "0",
        gasUsed: "0",
        isError: (r["Status"] || "0") === "0" ? "0" : "1",
        methodId: "",
        contractAddress: (r["ContractAddress"] || "").toLowerCase(),
      };
    });
}

/**
 * BEP-20 TX CSV → EtherscanTokenTransfer[]
 *
 * tokenDecimal="0", value=人間可読の数値 とすることで
 * 後段の value/10^decimal がそのまま正しい量になる。
 */
function mapTokenTx(
  rows: Record<string, string>[],
  feeByHash: Map<string, { gasUsed: string; gasPrice: string }>,
  year?: number
): EtherscanTokenTransfer[] {
  return rows
    .filter((r) => inYearJST(r["UnixTimestamp"], year))
    .map((r) => {
      const hash = (r["Transaction Hash"] || "").toLowerCase();
      const fee = feeByHash.get(hash);
      // TokenValue: "1,999.8354" のようにカンマ含む可能性あり
      const rawValue = stripNumberCommas(r["TokenValue"] || "0");
      return {
        blockNumber: r["Blockno"] || "0",
        timeStamp: r["UnixTimestamp"] || "0",
        hash,
        from: (r["From"] || "").toLowerCase(),
        to: (r["To"] || "").toLowerCase(),
        value: rawValue,
        tokenName: r["TokenName"] || "",
        tokenSymbol: r["TokenSymbol"] || "",
        tokenDecimal: "0", // value をそのまま採用するための工夫
        contractAddress: (r["ContractAddress"] || "").toLowerCase(),
        gas: "0",
        gasPrice: fee?.gasPrice ?? "0",
        gasUsed: fee?.gasUsed ?? "0",
      };
    });
}

/**
 * NFT CSV → ERC721 / ERC1155 に振り分け
 */
function mapNftTx(
  rows: Record<string, string>[],
  feeByHash: Map<string, { gasUsed: string; gasPrice: string }>,
  year?: number
): { nft721: EtherscanNFTTransfer[]; nft1155: EtherscanNFTTransfer[] } {
  const nft721: EtherscanNFTTransfer[] = [];
  const nft1155: EtherscanNFTTransfer[] = [];
  rows
    .filter((r) => inYearJST(r["UnixTimestamp"], year))
    .forEach((r) => {
      const hash = (r["Transaction Hash"] || "").toLowerCase();
      const fee = feeByHash.get(hash);
      const entry: EtherscanNFTTransfer = {
        blockNumber: r["Blockno"] || "0",
        timeStamp: r["UnixTimestamp"] || "0",
        hash,
        from: (r["From"] || "").toLowerCase(),
        to: (r["To"] || "").toLowerCase(),
        tokenID: r["Token ID"] || "",
        tokenName: r["TokenName"] || "",
        tokenSymbol: r["TokenSymbol"] || "",
        contractAddress: (r["ContractAddress"] || "").toLowerCase(),
        tokenValue: r["Quantity"] || "1",
        gas: "0",
        gasPrice: fee?.gasPrice ?? "0",
        gasUsed: fee?.gasUsed ?? "0",
      };
      const type = (r["Type"] || "").trim();
      if (type === "1155") nft1155.push(entry);
      else nft721.push(entry);
    });
  return { nft721, nft1155 };
}

/**
 * 指定ディレクトリ内のCSVを自動検出して読み込む。
 * ファイル名規則は緩く判定:
 *   - "internal" 含む → 内部TX
 *   - "token" 含む（"nft" を含まない）→ BEP-20
 *   - "nft" 含む → NFT
 *   - 上記以外 → 通常TX
 */
export async function importBscscanCsvs(
  dirPath: string,
  options: { year?: number } = {}
): Promise<BscCsvData> {
  const stats = await fs.stat(dirPath);
  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${dirPath}`);
  }
  const files = await fs.readdir(dirPath);
  const csvFiles = files.filter((f) => f.toLowerCase().endsWith(".csv"));

  let normalRows: Record<string, string>[] = [];
  let internalRows: Record<string, string>[] = [];
  let tokenRows: Record<string, string>[] = [];
  let nftRows: Record<string, string>[] = [];

  for (const file of csvFiles) {
    const lower = file.toLowerCase();
    const full = path.join(dirPath, file);
    const rows = await readCsv(full);
    if (lower.includes("internal")) {
      internalRows = internalRows.concat(rows);
    } else if (lower.includes("nft")) {
      nftRows = nftRows.concat(rows);
    } else if (lower.includes("token")) {
      tokenRows = tokenRows.concat(rows);
    } else {
      normalRows = normalRows.concat(rows);
    }
  }

  const { year } = options;
  const transactions = mapNormalTx(normalRows, year);
  const internalTxs = mapInternalTx(internalRows, year);

  // hash → fee マップを作る（token/NFT に fee を継承させるため）
  const feeByHash = new Map<string, { gasUsed: string; gasPrice: string }>();
  transactions.forEach((tx) => {
    feeByHash.set(tx.hash, { gasUsed: tx.gasUsed, gasPrice: tx.gasPrice });
  });

  const tokenTransfers = mapTokenTx(tokenRows, feeByHash, year);
  const { nft721, nft1155 } = mapNftTx(nftRows, feeByHash, year);

  return {
    transactions,
    internalTxs,
    tokenTransfers,
    nftTransfers: nft721,
    erc1155Transfers: nft1155,
  };
}
