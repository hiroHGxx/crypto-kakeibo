import { NextRequest, NextResponse } from "next/server";
import { EtherscanAPI } from "@/lib/etherscan";
import { convertAllTransactions } from "@/lib/transaction-converter";
import { generateExcel } from "@/lib/excel-generator";
import { importEntriesFromExcel } from "@/lib/excel-importer";
import { SUPPORTED_CHAIN_IDS, CHAIN_CONFIGS } from "@/lib/chain-config";
import { AccountingEntry } from "@/types";

export async function POST(request: NextRequest) {
  try {
    // multipart/form-data か JSON か判定
    const contentType = request.headers.get("content-type") || "";
    let address: string | undefined;
    let secondaryAddress: string | undefined;
    let addresses: string[] | undefined;
    let year: number | undefined;
    let importedFileBuffer: Buffer | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const addressesField = form.get("addresses");
      if (typeof addressesField === "string") {
        try {
          const parsed = JSON.parse(addressesField);
          if (Array.isArray(parsed)) addresses = parsed;
        } catch {
          // 単一文字列として扱う
          addresses = [addressesField];
        }
      }
      const yearField = form.get("year");
      if (yearField) year = parseInt(String(yearField));
      address = (form.get("address") as string) || undefined;
      secondaryAddress = (form.get("secondaryAddress") as string) || undefined;

      const file = form.get("importExcel");
      if (file && file instanceof File && file.size > 0) {
        const arrayBuf = await file.arrayBuffer();
        importedFileBuffer = Buffer.from(arrayBuf);
      }
    } else {
      const body = await request.json();
      address = body.address;
      secondaryAddress = body.secondaryAddress;
      addresses = body.addresses;
      year = body.year;
    }

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

    const isInYear = (timestamp: string): boolean => {
      if (!year) return true;
      const date = new Date(parseInt(timestamp) * 1000);
      return date.getFullYear() === year;
    };
    const ownSet = new Set(targetAddresses.map((a) => a.toLowerCase()));

    const allEntries: AccountingEntry[] = [];
    const skippedChains: { name: string; reason: string }[] = [];

    // 各チェーンのデータを取得・変換
    for (const chainId of SUPPORTED_CHAIN_IDS) {
      const config = CHAIN_CONFIGS[chainId];
      const apiKey = process.env[config.apiKeyEnv];
      if (!apiKey) {
        console.warn(`⚠️ ${config.name}: ${config.apiKeyEnv} が未設定のためスキップ`);
        skippedChains.push({ name: config.name, reason: `${config.apiKeyEnv} 未設定` });
        continue;
      }
      console.log(`\n📦 ${config.name} (chainId=${chainId}) データ取得開始...`);

      const etherscan = new EtherscanAPI(apiKey, config);
      let data;
      try {
        data = await etherscan.getAllTransactionsForAddresses(targetAddresses, year);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️ ${config.name} データ取得失敗（このチェーンをスキップ）: ${msg}`);
        skippedChains.push({ name: config.name, reason: msg });
        continue;
      }

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

    // インポートExcel (BNB等) の取り込み
    if (importedFileBuffer) {
      try {
        const importedEntries = await importEntriesFromExcel(importedFileBuffer, { year });
        console.log(`\n📥 インポートExcel: ${importedEntries.length}件のエントリを取り込み`);
        allEntries.push(...importedEntries);
      } catch (err) {
        console.error("Excelインポートエラー:", err);
        return NextResponse.json(
          { error: `インポートExcel読み込み失敗: ${err instanceof Error ? err.message : String(err)}` },
          { status: 400 }
        );
      }
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
