import { NextRequest, NextResponse } from "next/server";
import { EtherscanAPI } from "@/lib/etherscan";

export async function POST(request: NextRequest) {
  try {
    const { address, year } = await request.json();
    console.log("Request:", { address, year });

    if (!address) {
      return NextResponse.json(
        { error: "ウォレットアドレスが必要です" },
        { status: 400 }
      );
    }

    const apiKey = process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY;
    console.log("API Key exists:", !!apiKey);

    if (!apiKey) {
      return NextResponse.json(
        { error: "Etherscan APIキーが設定されていません" },
        { status: 500 }
      );
    }

    console.log("Fetching data from Etherscan...");
    const etherscan = new EtherscanAPI(apiKey);
    const data = await etherscan.getAllTransactions(address, year);
    console.log("Data fetched successfully");

    return NextResponse.json(data);
  } catch (error) {
    console.error("API Error:", error);
    const errorMessage = error instanceof Error ? error.message : "データ取得に失敗しました";
    console.error("Error message:", errorMessage);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
