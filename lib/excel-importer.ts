import ExcelJS from "exceljs";
import { AccountingEntry } from "@/types";

/**
 * 既存形式の手作業 Excel ファイルを AccountingEntry[] に変換する。
 *
 * 想定フォーマット（1 行目ヘッダー、2 行目以降データ）:
 *   col 1: 取引所名
 *   col 2: 日時（JST） — Excel 日時セル（Date object）
 *   col 3: 取引種別
 *   col 4: 取引通貨名(+)
 *   col 5: 取引量(+)
 *   col 6: 取引通貨名(-)
 *   col 7: 取引量(-)
 *   col 8: 取引額時価
 *   col 9: 手数料通貨名
 *   col 10: 手数料数量
 *
 * 日時の扱い: ExcelJS は日時セルを Date オブジェクトとして返す。
 * このとき内部表現は UTC 基準（JST 09:13:17 → 2025-02-22T00:13:17.000Z）になるため、
 * UTC + 9h を JST 文字列として再構築する。
 * （既存 transaction-converter.ts の formatJSTDate と同じロジック）
 */
export async function importEntriesFromExcel(
  buffer: ArrayBuffer | Buffer,
  options: { year?: number } = {}
): Promise<AccountingEntry[]> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS は ArrayBuffer / Buffer のいずれも受け取れる
  const ab =
    buffer instanceof ArrayBuffer
      ? buffer
      : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  await wb.xlsx.load(ab as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const entries: AccountingEntry[] = [];

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);

    const exchange = toStr(row.getCell(1).value);
    const dateCell = row.getCell(2).value;
    const type = toStr(row.getCell(3).value);

    // 完全に空行はスキップ
    if (!exchange && !dateCell && !type) continue;

    const dateStr = normalizeDate(dateCell);
    if (!dateStr) continue;

    // 年フィルタ
    if (options.year) {
      const y = parseInt(dateStr.slice(0, 4));
      if (y !== options.year) continue;
    }

    const tokenIn = toStr(row.getCell(4).value);
    const amountIn = toNumOrEmpty(row.getCell(5).value);
    const tokenOut = toStr(row.getCell(6).value);
    const amountOut = toNumOrEmpty(row.getCell(7).value);
    const priceVal = toStr(row.getCell(8).value);
    const feeToken = toStr(row.getCell(9).value);
    const feeAmount = toNumOrEmpty(row.getCell(10).value);

    entries.push({
      取引所名: exchange,
      "日時（JST）": dateStr,
      取引種別: type as AccountingEntry["取引種別"],
      "取引通貨名(+)": tokenIn,
      "取引量(+)": amountIn,
      "取引通貨名(-)": tokenOut,
      "取引量(-)": amountOut,
      取引額時価: priceVal,
      手数料通貨名: feeToken,
      手数料数量: feeAmount,
      取引詳細: "手動入力（BNB等のExcelインポート）",
    });
  }

  return entries;
}

function toStr(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "text" in v) return String((v as any).text || "");
  return String(v).trim();
}

function toNumOrEmpty(v: any): number | string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return v;
  const n = parseFloat(String(v));
  return isNaN(n) ? "" : n;
}

/**
 * Excel の日時セルを "YYYY-MM-DD HH:mm:ss" 形式（JST）に変換。
 *
 * ExcelJS が返す Date は UTC 表現で内部保持される（タイムゾーン情報なし）。
 * JST で記録された日時が "2025-02-22T00:13:17.000Z" として読まれるため、
 * UTC 値に +9h して JST 文字列を組み立てる。
 */
function normalizeDate(v: any): string {
  if (!v) return "";

  // Date オブジェクト（Excel 日時セル）
  if (v instanceof Date) {
    const utcMs = v.getTime();
    const jst = new Date(utcMs + 9 * 60 * 60 * 1000);
    return formatJST(jst);
  }

  // 文字列（"Sat Feb 22 2025 09:13:17 GMT+0900 (Japan Standard Time)" 等）
  if (typeof v === "string") {
    const parsed = new Date(v);
    if (isNaN(parsed.getTime())) return "";
    // タイムゾーン付き文字列はそのまま正しく解釈されるので、ローカルJSTで取得
    return formatJSTLocal(parsed);
  }

  return "";
}

function formatJST(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const seconds = String(d.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatJSTLocal(d: Date): string {
  // タイムゾーン付き文字列の場合、+9hシフトして UTC ベースで読み出し
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return formatJST(jst);
}
