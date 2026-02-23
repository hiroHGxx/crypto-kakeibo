import { NextRequest, NextResponse } from "next/server";
import { EtherscanAPI } from "@/lib/etherscan";
import { convertAllTransactions } from "@/lib/transaction-converter";
import { generateExcel } from "@/lib/excel-generator";

export async function POST(request: NextRequest) {
  try {
    const { address, secondaryAddress, addresses, year } = await request.json();
    const targetAddresses = (
      Array.isArray(addresses) ? addresses : [address, secondaryAddress]
    )
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());

    if (targetAddresses.length === 0) {
      return NextResponse.json(
        { error: "ウォレットアドレスが必要です（1件以上）" },
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
    const data = await etherscan.getAllTransactionsForAddresses(targetAddresses, year);
    const ownSet = new Set(targetAddresses.map((address) => address.toLowerCase()));
    const isInYear = (timestamp: string): boolean => {
      if (!year) return true;
      const date = new Date(parseInt(timestamp) * 1000);
      return date.getFullYear() === year;
    };
    const receiptHashCandidates = new Set<string>();
    const WETH_CONTRACT = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

    data.transactions.forEach((tx) => {
      if (!isInYear(tx.timeStamp)) return;
      const isOwnTx = ownSet.has((tx.from || "").toLowerCase());
      const hasValue = parseFloat(tx.value || "0") > 0;
      const isWethCall = (tx.to || "").toLowerCase() === WETH_CONTRACT;

      // ETH送信取引 または WETH contract呼び出し
      if (isOwnTx && (hasValue || isWethCall)) {
        receiptHashCandidates.add(tx.hash.toLowerCase());
      }
    });
    data.tokenTransfers.forEach((transfer) => {
      if (!isInYear(transfer.timeStamp)) return;
      if ((transfer.tokenSymbol || "").toUpperCase() === "WETH") {
        receiptHashCandidates.add(transfer.hash.toLowerCase());
      }
    });

    // レスポンス遅延を避けるため、receipt取得数に上限を設ける
    const receiptHashes = Array.from(receiptHashCandidates).slice(0, 200);
    const receiptsByHash = await etherscan.getTransactionReceipts(receiptHashes);

    // 会計エントリに変換（年指定でフィルタリング）
    const entries = convertAllTransactions(
      data.transactions,
      data.internalTxs,
      data.tokenTransfers,
      data.nftTransfers,
      targetAddresses,
      year,
      data.erc1155Transfers,
      receiptsByHash
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
