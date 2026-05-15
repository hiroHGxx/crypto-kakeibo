import { NextRequest, NextResponse } from "next/server";
import { EtherscanAPI } from "@/lib/etherscan";
import { convertAllTransactions } from "@/lib/transaction-converter";
import { generateExcel } from "@/lib/excel-generator";
import { SUPPORTED_CHAIN_IDS, CHAIN_CONFIGS } from "@/lib/chain-config";
import { AccountingEntry } from "@/types";

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

    const isInYear = (timestamp: string): boolean => {
      if (!year) return true;
      const date = new Date(parseInt(timestamp) * 1000);
      return date.getFullYear() === year;
    };
    const ownSet = new Set(targetAddresses.map((a) => a.toLowerCase()));

    const allEntries: AccountingEntry[] = [];

    // 各チェーンのデータを取得・変換
    for (const chainId of SUPPORTED_CHAIN_IDS) {
      const config = CHAIN_CONFIGS[chainId];
      console.log(`\n📦 ${config.name} (chainId=${chainId}) データ取得開始...`);

      const etherscan = new EtherscanAPI(apiKey, chainId);
      const data = await etherscan.getAllTransactionsForAddresses(targetAddresses, year);

      console.log(`  通常TX: ${data.transactions.length}件, Internal: ${data.internalTxs.length}件, Token: ${data.tokenTransfers.length}件, NFT: ${data.nftTransfers.length}件, ERC1155: ${data.erc1155Transfers.length}件`);

      // Receipt取得候補を収集
      const receiptHashCandidates = new Set<string>();
      const wrappedContract = config.wrappedNativeAddress;

      // DEXスワップ検出用: 自分がトークンを送出しているTXのハッシュを収集
      const ownTokenOutHashes = new Set<string>();
      data.tokenTransfers.forEach((transfer) => {
        if (!isInYear(transfer.timeStamp)) return;
        if (ownSet.has((transfer.from || "").toLowerCase())) {
          ownTokenOutHashes.add(transfer.hash.toLowerCase());
        }
      });

      data.transactions.forEach((tx) => {
        if (!isInYear(tx.timeStamp)) return;
        const isOwnTx = ownSet.has((tx.from || "").toLowerCase());
        const hasValue = parseFloat(tx.value || "0") > 0;
        const isWrappedCall = (tx.to || "").toLowerCase() === wrappedContract;

        if (isOwnTx && (hasValue || isWrappedCall)) {
          receiptHashCandidates.add(tx.hash.toLowerCase());
        }
        // トークン送出を含むTXのreceiptも取得（DEXスワップ検出用: value=0でも対象）
        if (isOwnTx && ownTokenOutHashes.has(tx.hash.toLowerCase())) {
          receiptHashCandidates.add(tx.hash.toLowerCase());
        }
      });
      data.tokenTransfers.forEach((transfer) => {
        if (!isInYear(transfer.timeStamp)) return;
        if ((transfer.tokenSymbol || "").toUpperCase() === config.wrappedNativeToken) {
          receiptHashCandidates.add(transfer.hash.toLowerCase());
        }
      });

      const receiptHashes = Array.from(receiptHashCandidates).slice(0, 200);
      const receiptsByHash = await etherscan.getTransactionReceipts(receiptHashes);

      // 会計エントリに変換（チェーン設定を渡す）
      const entries = convertAllTransactions(
        data.transactions,
        data.internalTxs,
        data.tokenTransfers,
        data.nftTransfers,
        targetAddresses,
        year,
        data.erc1155Transfers,
        receiptsByHash,
        config
      );

      console.log(`  ✅ ${config.name}: ${entries.length}件のエントリ生成`);
      allEntries.push(...entries);
    }

    // 全チェーンのエントリをタイムスタンプでソート
    allEntries.sort((a, b) => {
      return new Date(a["日時（JST）"]).getTime() - new Date(b["日時（JST）"]).getTime();
    });

    console.log(`\n📊 全チェーン合計: ${allEntries.length}件のエントリ`);

    // Excel生成
    const buffer = await generateExcel(allEntries, year || new Date().getFullYear());

    // ファイル名生成
    const fileName = `確定申告${year || new Date().getFullYear()}仮想通貨.xlsx`;

    // レスポンス
    return new NextResponse(buffer as unknown as BodyInit, {
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
