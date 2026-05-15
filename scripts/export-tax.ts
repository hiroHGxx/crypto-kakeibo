#!/usr/bin/env tsx
/**
 * 確定申告用Excel生成CLIスクリプト。
 *
 * Next.js dev server を起動せずに、ETH+POL の Etherscan API 取得・
 * BSC CSV取り込み・手作業Excelマージ・Excel生成を一発で行う。
 *
 * 使い方:
 *   npm run export                                # 当年・既定ウォレット
 *   npm run export -- --year 2025                 # 年指定
 *   npm run export -- --year 2025 --addresses 0xabc,0xdef
 *   npm run export -- --import-excel 参考/foo.xlsx
 *   npm run export -- --out 自動生成_ETHPOL/test.xlsx
 *
 * 環境変数:
 *   NEXT_PUBLIC_ETHERSCAN_API_KEY  Etherscan v2 APIキー（必須）
 *   BSC_CSV_DIR                    BSC CSV配置ディレクトリ（既定: ./BSC取引データ）
 */
import fs from "fs/promises";
import path from "path";
import { config as dotenvConfig } from "dotenv";
import { buildExportEntries } from "../lib/export-pipeline";
import { generateExcel } from "../lib/excel-generator";

// .env.local を明示的に読み込む（Next.jsと挙動を揃える）
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" }); // .envもフォールバックで読み込み

// 既定ウォレット（必要なら --addresses で上書き）
const DEFAULT_ADDRESSES = [
  "0x01b27ec780c534ba0fab15509354c3798321273c",
  "0x581087E117A68537b624e0352833dB96654c0481",
];
const DEFAULT_OUT_DIR = "自動生成_ETHPOL";

interface CliArgs {
  year: number;
  addresses: string[];
  importExcel?: string;
  out?: string;
  bscCsvDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    year: new Date().getFullYear(),
    addresses: DEFAULT_ADDRESSES,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--year":
        args.year = parseInt(next);
        i++;
        break;
      case "--addresses":
        args.addresses = next.split(",").map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      case "--import-excel":
        args.importExcel = next;
        i++;
        break;
      case "--out":
        args.out = next;
        i++;
        break;
      case "--bsc-csv-dir":
        args.bscCsvDir = next;
        i++;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        if (a.startsWith("--")) {
          console.error(`Unknown option: ${a}`);
          printHelp();
          process.exit(2);
        }
    }
  }
  if (!Number.isFinite(args.year)) {
    console.error("Invalid --year");
    process.exit(2);
  }
  return args;
}

function printHelp() {
  console.log(`
Usage: npm run export -- [options]

Options:
  --year YYYY              対象年（既定: 当年）
  --addresses 0xA,0xB      対象ウォレット（カンマ区切り、既定: 内蔵デフォルト）
  --import-excel PATH      手作業Excelをマージ
  --bsc-csv-dir PATH       BSC CSVディレクトリ（既定: ./BSC取引データ）
  --out PATH               出力ファイルパス（既定: ${DEFAULT_OUT_DIR}/確定申告{year}仮想通貨_{N}.xlsx）
  -h, --help               このヘルプを表示
`);
}

/**
 * 既定の出力ファイル名を解決。
 * <out_dir>/確定申告{year}仮想通貨_{N}.xlsx の最大Nを探し、+1 を返す。
 */
async function resolveDefaultOutPath(year: number): Promise<string> {
  const dir = DEFAULT_OUT_DIR;
  await fs.mkdir(dir, { recursive: true });
  const files = await fs.readdir(dir);
  const pattern = new RegExp(`^確定申告${year}仮想通貨_(\\d+)\\.xlsx$`);
  let maxN = 0;
  for (const f of files) {
    const m = pattern.exec(f);
    if (m) maxN = Math.max(maxN, parseInt(m[1]));
  }
  return path.join(dir, `確定申告${year}仮想通貨_${maxN + 1}.xlsx`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`🏁 Export start (year=${args.year}, addresses=${args.addresses.length}件)`);

  let importExcelBuffer: Buffer | undefined;
  if (args.importExcel) {
    importExcelBuffer = await fs.readFile(args.importExcel);
    console.log(`📥 手作業Excel: ${args.importExcel}`);
  }

  const { entries, skippedChains } = await buildExportEntries({
    targetAddresses: args.addresses,
    year: args.year,
    importExcelBuffer,
    bscCsvDir: args.bscCsvDir,
  });

  if (skippedChains.length > 0) {
    console.log("\n⚠️ スキップされたチェーン:");
    skippedChains.forEach((s) => console.log(`  - ${s.name}: ${s.reason}`));
  }

  const buffer = await generateExcel(entries, args.year);
  const outPath = args.out || (await resolveDefaultOutPath(args.year));
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, buffer);

  console.log(`\n✅ 出力完了: ${outPath} (${entries.length}行)`);
}

main().catch((err) => {
  console.error("❌ 失敗:", err);
  process.exit(1);
});
