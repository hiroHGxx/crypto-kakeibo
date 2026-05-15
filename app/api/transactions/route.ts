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

    const chains: Record<string, any> = {};
    const skipped: { name: string; reason: string }[] = [];

    for (const chainId of SUPPORTED_CHAIN_IDS) {
      const config = CHAIN_CONFIGS[chainId];
      const apiKey = process.env[config.apiKeyEnv];
      if (!apiKey) {
        console.warn(`⚠️ ${config.name}: ${config.apiKeyEnv} 未設定のためスキップ`);
        skipped.push({ name: config.name, reason: `${config.apiKeyEnv} 未設定` });
        continue;
      }
      console.log(`Fetching data from Etherscan for ${config.name}...`);

      try {
        const etherscan = new EtherscanAPI(apiKey, config);
        const data = await etherscan.getAllTransactionsForAddresses(targetAddresses, year);
        chains[config.name] = {
          chainId,
          ...data,
        };
        console.log(`${config.name} data fetched successfully`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️ ${config.name} データ取得失敗（このチェーンをスキップ）: ${msg}`);
        skipped.push({ name: config.name, reason: msg });
      }
    }

    return NextResponse.json({ chains, targetAddresses, skipped });
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
