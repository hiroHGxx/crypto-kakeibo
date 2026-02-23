import { NextRequest, NextResponse } from "next/server";
import { EtherscanAPI } from "@/lib/etherscan";
import { convertAllTransactions } from "@/lib/transaction-converter";
import { generateExcel } from "@/lib/excel-generator";

export async function POST(request: NextRequest) {
  try {
    const { address, year } = await request.json();

    if (!address) {
      return NextResponse.json(
        { error: "ウォレットアドレスが必要です" },
        { status: 400 }
      );
    }

    const apiKey = process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Etherscan APIキーが設定されていません" },
        { status: 500 }
      );
    }

    // データ取得
    const etherscan = new EtherscanAPI(apiKey);
    const data = await etherscan.getAllTransactions(address, year);

    // 会計エントリに変換（年指定でフィルタリング）
    const entries = convertAllTransactions(
      data.transactions,
      data.internalTxs,
      data.tokenTransfers,
      data.nftTransfers,
      address,
      year,
      data.erc1155Transfers
    );

    // Excel生成
    const buffer = await generateExcel(entries, year || new Date().getFullYear());

    // ファイル名生成
    const fileName = `確定申告${year || new Date().getFullYear()}ETH.xlsx`;

    // レスポンス
    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    console.error("Export Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Excel出力に失敗しました" },
      { status: 500 }
    );
  }
}
