import { NextRequest, NextResponse } from "next/server";
import { EtherscanAPI } from "@/lib/etherscan";

export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json();

    const apiKey = process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "APIキーが設定されていません" },
        { status: 500 }
      );
    }

    const etherscan = new EtherscanAPI(apiKey);
    const data = await etherscan.getAllTransactions(address);

    // 2026年のトークン転送のみフィルタリング
    const tokens2026 = data.tokenTransfers.filter((transfer) => {
      const date = new Date(parseInt(transfer.timeStamp) * 1000);
      return date.getFullYear() === 2026;
    });

    return NextResponse.json({
      count: tokens2026.length,
      transfers: tokens2026,
    });
  } catch (error) {
    console.error("Debug Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "エラー" },
      { status: 500 }
    );
  }
}
