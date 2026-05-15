import { NextRequest, NextResponse } from "next/server";
import { EtherscanAPI } from "@/lib/etherscan";
import { SUPPORTED_CHAIN_IDS, CHAIN_CONFIGS } from "@/lib/chain-config";

export async function POST(request: NextRequest) {
  try {
    const { address, secondaryAddress, addresses, year } = await request.json();
    const targetAddresses = (
      Array.isArray(addresses) ? addresses : [address, secondaryAddress]
    )
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
    console.log("Request:", { targetAddresses, year });

    if (targetAddresses.length === 0) {
      return NextResponse.json(
        { error: "ウォレットアドレスが必要です（1件以上）" },
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

    const chains: Record<string, any> = {};

    for (const chainId of SUPPORTED_CHAIN_IDS) {
      const config = CHAIN_CONFIGS[chainId];
      console.log(`Fetching data from Etherscan for ${config.name}...`);

      const etherscan = new EtherscanAPI(apiKey, chainId);
      const data = await etherscan.getAllTransactionsForAddresses(targetAddresses, year);

      chains[config.name] = {
        chainId,
        ...data,
      };

      console.log(`${config.name} data fetched successfully`);
    }

    return NextResponse.json({ chains, targetAddresses });
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
