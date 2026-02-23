import ExcelJS from "exceljs";
import { AccountingEntry } from "@/types";

export async function generateExcel(
  entries: AccountingEntry[],
  year: number
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("本番用");

  // ヘッダー行
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
    "要確認",
    "推奨取引種別",
    "確認理由",
  ];

  worksheet.addRow(headers);

  // ヘッダー行のスタイル
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD3D3D3" },
  };

  // データ行を追加
  entries.forEach((entry) => {
    const row = worksheet.addRow([
      entry.取引所名,
      entry["日時（JST）"],
      entry.取引種別,
      entry["取引通貨名(+)"],
      entry["取引量(+)"],
      entry["取引通貨名(-)"],
      entry["取引量(-)"],
      entry.取引額時価,
      entry.手数料通貨名,
      entry.手数料数量,
      entry.要確認 || "",
      entry.推奨取引種別 || "",
      entry.確認理由 || "",
    ]);

    // 数値列を文字列形式で保存（指数表記を防ぐ）
    const feeCell = row.getCell(10); // 手数料数量
    if (typeof entry.手数料数量 === 'number' && entry.手数料数量 > 0) {
      feeCell.value = entry.手数料数量;
      feeCell.numFmt = '0.##################'; // 末尾の0を省略しつつ最大18桁
    }

    const plusAmountCell = row.getCell(5); // 取引量(+)
    if (typeof entry["取引量(+)"] === 'number' && entry["取引量(+)"] > 0) {
      plusAmountCell.value = entry["取引量(+)"];
      // NFT資産の場合は整数表示、それ以外は小数点18桁
      const isNFT = typeof entry["取引通貨名(+)"] === 'string' && entry["取引通貨名(+)"].startsWith('NFT資産');
      plusAmountCell.numFmt = isNFT ? '0' : '0.##################';
    }

    const minusAmountCell = row.getCell(7); // 取引量(-)
    if (typeof entry["取引量(-)"] === 'number' && entry["取引量(-)"] > 0) {
      minusAmountCell.value = entry["取引量(-)"];
      // NFT資産の場合は整数表示、それ以外は小数点18桁
      const isNFT = typeof entry["取引通貨名(-)"] === 'string' && entry["取引通貨名(-)"].startsWith('NFT資産');
      minusAmountCell.numFmt = isNFT ? '0' : '0.##################';
    }

    if (entry.要確認) {
      row.getCell(11).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFE699" },
      };
      row.getCell(12).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF2CC" },
      };
    }
  });

  // 列幅を自動調整
  worksheet.columns.forEach((column) => {
    if (column) {
      column.width = 20;
    }
  });

  // Bufferに書き出し
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
