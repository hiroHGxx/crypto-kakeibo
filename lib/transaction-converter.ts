import {
  EtherscanTransaction,
  EtherscanTokenTransfer,
  EtherscanNFTTransfer,
  AccountingEntry,
} from "@/types";

// Unix timestamp を JST の日時文字列に変換
function formatJSTDate(timestamp: string): string {
  // UNIXタイムスタンプ（秒）をミリ秒に変換
  const ms = parseInt(timestamp) * 1000;

  // UTC時刻として取得し、9時間加算してJSTに変換
  const date = new Date(ms);
  const utcYear = date.getUTCFullYear();
  const utcMonth = date.getUTCMonth();
  const utcDate = date.getUTCDate();
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();
  const utcSeconds = date.getUTCSeconds();

  // UTC時刻に9時間加算してJSTに変換
  const jstDate = new Date(Date.UTC(utcYear, utcMonth, utcDate, utcHours + 9, utcMinutes, utcSeconds));

  const year = jstDate.getUTCFullYear();
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jstDate.getUTCDate()).padStart(2, "0");
  const hours = String(jstDate.getUTCHours()).padStart(2, "0");
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, "0");
  const seconds = String(jstDate.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Wei を ETH に変換
function weiToEth(wei: string): number {
  return parseFloat(wei) / 1e18;
}

function pickPaymentBreakdown(
  candidates: number[],
  count: number,
  targetTotal: number
): number[] | null {
  if (count <= 0 || candidates.length < count) {
    return null;
  }

  const tolerance = 1e-9;
  let bestDiff = Number.POSITIVE_INFINITY;
  let bestValues: number[] | null = null;

  const sorted = [...candidates].sort((a, b) => b - a);
  const maxSearch = Math.min(sorted.length, 14);
  const trimmed = sorted.slice(0, maxSearch);

  function dfs(start: number, left: number, acc: number, chosen: number[]) {
    if (left === 0) {
      const diff = Math.abs(targetTotal - acc);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestValues = [...chosen];
      }
      return;
    }

    for (let i = start; i <= trimmed.length - left; i++) {
      chosen.push(trimmed[i]);
      dfs(i + 1, left - 1, acc + trimmed[i], chosen);
      chosen.pop();
    }
  }

  dfs(0, count, 0, []);

  if (bestValues && bestDiff <= tolerance) {
    return bestValues;
  }

  return null;
}

function reviewFields(reason: string, suggestedType: string): Pick<AccountingEntry, "要確認" | "推奨取引種別" | "確認理由"> {
  return {
    要確認: "要確認",
    推奨取引種別: suggestedType,
    確認理由: reason,
  };
}

// スパムNFTかどうかを判定（主に無差別エアドロップ）
function isSpamNFT(transfer: EtherscanNFTTransfer, userAddress: string): boolean {
  const normalizedUserAddress = userAddress.toLowerCase();
  const isIncoming = transfer.to.toLowerCase() === normalizedUserAddress;

  // 送信NFTはスパム判定しない
  if (!isIncoming) {
    return false;
  }

  const name = (transfer.tokenName || "").toLowerCase();
  const symbol = (transfer.tokenSymbol || "").toLowerCase();
  const combined = `${name} ${symbol}`;

  // URL誘導系のNFTはスパムとして扱う
  const suspiciousPatterns = [
    "http://",
    "https://",
    "www.",
    ".com",
    ".io",
    ".xyz",
    "claim",
    "visit",
  ];

  if (suspiciousPatterns.some((pattern) => combined.includes(pattern))) {
    return true;
  }

  return false;
}

// 通常トランザクションを会計エントリに変換
export function convertTransactionToEntry(
  tx: EtherscanTransaction,
  userAddress: string
): AccountingEntry | null {
  const normalizedUserAddress = userAddress.toLowerCase();
  const isOutgoing = tx.from.toLowerCase() === normalizedUserAddress;

  const fee = (parseFloat(tx.gasUsed) * parseFloat(tx.gasPrice)) / 1e18;
  const value = weiToEth(tx.value);

  // 手数料のみのトランザクション（valueが0）
  if (value === 0 && fee > 0) {
    return {
      取引所名: "metamask",
      "日時（JST）": formatJSTDate(tx.timeStamp),
      取引種別: "手数料",
      "取引通貨名(+)": "",
      "取引量(+)": "",
      "取引通貨名(-)": "",
      "取引量(-)": "",
      取引額時価: "",
      手数料通貨名: "ETH",
      手数料数量: fee,
      取引詳細: tx.functionName || tx.methodId || "",
    };
  }

  // 送金トランザクション
  if (isOutgoing) {
    return {
      取引所名: "metamask",
      "日時（JST）": formatJSTDate(tx.timeStamp),
      取引種別: "送付",
      "取引通貨名(+)": "",
      "取引量(+)": "",
      "取引通貨名(-)": "ETH",
      "取引量(-)": value,
      取引額時価: "",
      手数料通貨名: "ETH",
      手数料数量: fee,
      取引詳細: tx.functionName || tx.methodId || "",
      ...reviewFields(
        "送信先の用途がオンチェーン情報だけでは確定できません",
        "送付 / 支払 / 減少 / 経費"
      ),
    };
  } else {
    return {
      取引所名: "metamask",
      "日時（JST）": formatJSTDate(tx.timeStamp),
      取引種別: "受取",
      "取引通貨名(+)": "ETH",
      "取引量(+)": value,
      "取引通貨名(-)": "",
      "取引量(-)": "",
      取引額時価: "",
      手数料通貨名: "",
      手数料数量: "",
      取引詳細: tx.functionName || tx.methodId || "",
      ...reviewFields(
        "受取理由がオンチェーン情報だけでは確定できません",
        "ボーナス / 預入 / 受取"
      ),
    };
  }
}

// スパムトークンかどうかを判定
function isSpamToken(transfer: EtherscanTokenTransfer, userAddress: string): boolean {
  const normalizedUserAddress = userAddress.toLowerCase();
  const isIncoming = transfer.to.toLowerCase() === normalizedUserAddress;

  // 送信トランザクションはスパムではない
  if (!isIncoming) {
    return false;
  }

  // 信頼できるトークンのホワイトリスト
  const trustedTokens = [
    'WETH', 'USDT', 'USDC', 'DAI', 'WBTC', 'LINK', 'UNI', 'AAVE',
    'MATIC', 'SHIB', 'APE', 'LDO', 'CRV', 'MKR', 'SNX', 'COMP'
  ];

  if (trustedTokens.includes(transfer.tokenSymbol.toUpperCase())) {
    return false;
  }

  const value = parseFloat(transfer.value) / Math.pow(10, parseInt(transfer.tokenDecimal));
  const fee = (parseFloat(transfer.gasUsed) * parseFloat(transfer.gasPrice)) / 1e18;

  // 受信トランザクションでガス代が0（エアドロップスパム）
  if (fee === 0) {
    return true;
  }

  // 受信トランザクションで少額（1-10トークン）のエアドロップ
  // かつ、自分がガス代を払っていない場合はスパム
  if (value > 0 && value <= 10 && transfer.from.toLowerCase() !== normalizedUserAddress) {
    return true;
  }

  return false;
}

// トークン転送を会計エントリに変換
export function convertTokenTransferToEntry(
  transfer: EtherscanTokenTransfer,
  userAddress: string
): AccountingEntry | null {
  // スパムトークンをフィルタリング
  if (isSpamToken(transfer, userAddress)) {
    return null;
  }

  const normalizedUserAddress = userAddress.toLowerCase();
  const isOutgoing = transfer.from.toLowerCase() === normalizedUserAddress;

  const value = parseFloat(transfer.value) / Math.pow(10, parseInt(transfer.tokenDecimal));
  const fee = (parseFloat(transfer.gasUsed) * parseFloat(transfer.gasPrice)) / 1e18;

  if (isOutgoing) {
    return {
      取引所名: "metamask",
      "日時（JST）": formatJSTDate(transfer.timeStamp),
      取引種別: "送付",
      "取引通貨名(+)": "",
      "取引量(+)": "",
      "取引通貨名(-)": transfer.tokenSymbol,
      "取引量(-)": value,
      取引額時価: "",
      手数料通貨名: "ETH",
      手数料数量: fee,
      取引詳細: transfer.tokenName,
      ...reviewFields(
        "送付の目的（支払・経費・減少など）がオンチェーン情報だけでは確定できません",
        "送付 / 支払 / 経費 / 減少"
      ),
    };
  } else {
    return {
      取引所名: "metamask",
      "日時（JST）": formatJSTDate(transfer.timeStamp),
      取引種別: "受取",
      "取引通貨名(+)": transfer.tokenSymbol,
      "取引量(+)": value,
      "取引通貨名(-)": "",
      "取引量(-)": "",
      取引額時価: "",
      手数料通貨名: "",
      手数料数量: "",
      取引詳細: transfer.tokenName,
      ...reviewFields(
        "受取理由がオンチェーン情報だけでは確定できません",
        "ボーナス / 預入 / 受取"
      ),
    };
  }
}

// NFT転送を会計エントリに変換
export function convertNFTTransferToEntry(
  transfer: EtherscanNFTTransfer,
  userAddress: string
): AccountingEntry {
  if (isSpamNFT(transfer, userAddress)) {
    throw new Error("Spam NFT should be filtered before conversion");
  }

  const normalizedUserAddress = userAddress.toLowerCase();
  const isOutgoing = transfer.from.toLowerCase() === normalizedUserAddress;

  // ERC-1155: tokenValueがある場合は数量、tokenIDは表示しない
  // ERC-721: tokenValueがない場合は1個、tokenIDを表示
  const isERC1155 = !!transfer.tokenValue;
  const nftQuantity = isERC1155 ? parseInt(transfer.tokenValue!) : 1;
  const nftName = isERC1155
    ? `NFT資産${transfer.tokenName}`
    : `NFT資産${transfer.tokenName}#${transfer.tokenID}`;
  const detailName = isERC1155
    ? transfer.tokenSymbol
    : `${transfer.tokenSymbol} #${transfer.tokenID}`;

  const fee = transfer.gasUsed && transfer.gasPrice
    ? (parseFloat(transfer.gasUsed) * parseFloat(transfer.gasPrice)) / 1e18
    : 0;

  if (isOutgoing) {
    return {
      取引所名: "metamask",
      "日時（JST）": formatJSTDate(transfer.timeStamp),
      取引種別: "送付",
      "取引通貨名(+)": "",
      "取引量(+)": "",
      "取引通貨名(-)": nftName,
      "取引量(-)": nftQuantity,
      取引額時価: "",
      手数料通貨名: fee > 0 ? "ETH" : "",
      手数料数量: fee > 0 ? fee : "",
      取引詳細: detailName,
      ...reviewFields(
        "NFT送付の意図（自己移動・Giveaway・経費処理）がオンチェーン情報だけでは確定できません",
        "送付 / 減少 / 経費 / 売買"
      ),
    };
  } else {
    return {
      取引所名: "metamask",
      "日時（JST）": formatJSTDate(transfer.timeStamp),
      取引種別: "受取",
      "取引通貨名(+)": nftName,
      "取引量(+)": nftQuantity,
      "取引通貨名(-)": "",
      "取引量(-)": "",
      取引額時価: "",
      手数料通貨名: "",
      手数料数量: "",
      取引詳細: detailName,
      ...reviewFields(
        "NFT受取の性質（ボーナス/無償取得/預入）がオンチェーン情報だけでは確定できません",
        "ボーナス / 無償取得 / 預入 / 受取"
      ),
    };
  }
}

// NFT売買取引を検出してグループ化（ERC721/ERC1155両対応）
function groupNFTTrades(
  transactions: EtherscanTransaction[],
  internalTxs: EtherscanTransaction[],
  tokenTransfers: EtherscanTokenTransfer[],
  nftTransfers: EtherscanNFTTransfer[],
  erc1155Transfers: EtherscanNFTTransfer[],
  userAddress: string
): Map<
  string,
  Array<{
    transaction?: EtherscanTransaction;
    token?: EtherscanTokenTransfer;
    nft: EtherscanNFTTransfer;
    paymentValueOverride?: number;
    feeOverride?: number;
    reviewReason?: string;
    suggestedType?: string;
  }>
> {
  const trades = new Map<
    string,
    Array<{
      transaction?: EtherscanTransaction;
      token?: EtherscanTokenTransfer;
      nft: EtherscanNFTTransfer;
      paymentValueOverride?: number;
      feeOverride?: number;
      reviewReason?: string;
      suggestedType?: string;
    }>
  >();

  // スパム除外後の全NFT転送（ERC721 + ERC1155）をハッシュでマッピング
  const nftByHash = new Map<string, EtherscanNFTTransfer[]>();
  [...nftTransfers, ...erc1155Transfers]
    .filter((nft) => !isSpamNFT(nft, userAddress))
    .forEach((nft) => {
      const list = nftByHash.get(nft.hash) || [];
      list.push(nft);
      nftByHash.set(nft.hash, list);
    });

  // 支払いに使われるトークン転送（ETH/WETHのみ）をハッシュでマッピング
  const paymentTokensByHash = new Map<string, EtherscanTokenTransfer[]>();
  tokenTransfers.forEach((token) => {
    if (token.tokenSymbol !== "WETH" && token.tokenSymbol !== "ETH") {
      return;
    }
    const list = paymentTokensByHash.get(token.hash) || [];
    list.push(token);
    paymentTokensByHash.set(token.hash, list);
  });

  const txByHash = new Map<string, EtherscanTransaction>();
  transactions.forEach((tx) => {
    txByHash.set(tx.hash, tx);
  });

  const internalPaymentsByHash = new Map<string, number[]>();
  internalTxs.forEach((tx) => {
    const value = weiToEth(tx.value);
    if (value <= 0) {
      return;
    }
    const list = internalPaymentsByHash.get(tx.hash) || [];
    list.push(value);
    internalPaymentsByHash.set(tx.hash, list);
  });

  nftByHash.forEach((nfts, hash) => {
    const paymentTokens = paymentTokensByHash.get(hash) || [];
    const tx = txByHash.get(hash);
    const groupedTrades: Array<{
      transaction?: EtherscanTransaction;
      token?: EtherscanTokenTransfer;
      nft: EtherscanNFTTransfer;
      paymentValueOverride?: number;
      feeOverride?: number;
      reviewReason?: string;
      suggestedType?: string;
    }> = [];

    if (paymentTokens.length >= nfts.length) {
      // NFT数と同数以上の支払い明細がある場合は1:1で対応
      nfts.forEach((nft, index) => {
        groupedTrades.push({ nft, token: paymentTokens[index] });
      });
      trades.set(hash, groupedTrades);
      return;
    }

    if (paymentTokens.length === 1 && nfts.length > 1) {
      // 内部トランザクションに個別支払いがあれば、按分せずそのまま使う
      const internalPayments = internalPaymentsByHash.get(hash) || [];
      const token = paymentTokens[0];
      const totalValue =
        parseFloat(token.value) / Math.pow(10, parseInt(token.tokenDecimal));
      const totalFee =
        (parseFloat(token.gasUsed) * parseFloat(token.gasPrice)) / 1e18;
      const perNFTFee = totalFee / nfts.length;
      const exactByCount =
        internalPayments.length === nfts.length
          ? internalPayments
          : pickPaymentBreakdown(internalPayments, nfts.length, totalValue);

      if (exactByCount) {
        const values = [...exactByCount].sort((a, b) => b - a);
        nfts.forEach((nft, index) => {
          groupedTrades.push({
            nft,
            token,
            paymentValueOverride: values[index],
            feeOverride: perNFTFee,
          });
        });
        trades.set(hash, groupedTrades);
        return;
      }

      // 内部送金から元値を特定できない場合のみ均等按分
      const perNFTValue = totalValue / nfts.length;
      nfts.forEach((nft) => {
        groupedTrades.push({
          nft,
          token,
          paymentValueOverride: perNFTValue,
          feeOverride: perNFTFee,
          reviewReason: "同一取引で複数NFTのため、個別価格を均等按分（要手動確認）",
          suggestedType: "売買",
        });
      });
      trades.set(hash, groupedTrades);
      return;
    }

    if (paymentTokens.length > 0 && paymentTokens.length < nfts.length) {
      // 支払い件数がNFT件数より少ない場合は不足分を最後の支払い情報で補完
      nfts.forEach((nft, index) => {
        groupedTrades.push({
          nft,
          token: paymentTokens[Math.min(index, paymentTokens.length - 1)],
          reviewReason: "支払い明細がNFT件数より少ないため、価格割当が推定（要手動確認）",
        });
      });
      trades.set(hash, groupedTrades);
      return;
    }

    if (tx) {
      const totalValue = weiToEth(tx.value);
      const totalFee = (parseFloat(tx.gasUsed) * parseFloat(tx.gasPrice)) / 1e18;
      const shouldSplit = nfts.length > 1;
      const perNFTValue = shouldSplit ? totalValue / nfts.length : totalValue;
      const perNFTFee = shouldSplit ? totalFee / nfts.length : totalFee;
      const internalPayments = internalPaymentsByHash.get(hash) || [];
      const exactByCount =
        internalPayments.length === nfts.length
          ? internalPayments
          : pickPaymentBreakdown(internalPayments, nfts.length, totalValue);

      if (exactByCount) {
        const values = [...exactByCount].sort((a, b) => b - a);
        nfts.forEach((nft, index) => {
          groupedTrades.push({
            nft,
            transaction: tx,
            paymentValueOverride: values[index],
            feeOverride: perNFTFee,
          });
        });
        trades.set(hash, groupedTrades);
        return;
      }

      nfts.forEach((nft) => {
        groupedTrades.push({
          nft,
          transaction: tx,
          paymentValueOverride: shouldSplit ? perNFTValue : undefined,
          feeOverride: shouldSplit ? perNFTFee : undefined,
          reviewReason: shouldSplit
            ? "同一取引で複数NFTのため、個別価格を均等按分（要手動確認）"
            : undefined,
          suggestedType: shouldSplit ? "売買" : undefined,
        });
      });
      trades.set(hash, groupedTrades);
      return;
    }
  });

  return trades;
}

// NFT売買取引を会計エントリに変換
function convertNFTTradeToEntry(
  trade: {
    transaction?: EtherscanTransaction;
    token?: EtherscanTokenTransfer;
    nft: EtherscanNFTTransfer;
    paymentValueOverride?: number;
    feeOverride?: number;
    reviewReason?: string;
    suggestedType?: string;
  },
  userAddress: string
): AccountingEntry {
  const normalizedUserAddress = userAddress.toLowerCase();
  const isNFTIncoming = trade.nft.to.toLowerCase() === normalizedUserAddress;

  let paymentValue: number;
  let paymentSymbol: string;
  let fee: number;
  let timestamp: string;
  let isTrade = true; // 売買取引かどうか

  if (trade.token) {
    // トークン転送（WETH/ERC20）での支払い
    paymentValue =
      trade.paymentValueOverride ??
      (parseFloat(trade.token.value) /
        Math.pow(10, parseInt(trade.token.tokenDecimal)));
    paymentSymbol = trade.token.tokenSymbol;
    fee =
      trade.feeOverride ??
      ((parseFloat(trade.token.gasUsed) * parseFloat(trade.token.gasPrice)) / 1e18);
    timestamp = trade.token.timeStamp;
  } else if (trade.transaction) {
    // 通常トランザクション（ETH）での支払い
    paymentValue = trade.paymentValueOverride ?? weiToEth(trade.transaction.value);
    paymentSymbol = "ETH";
    fee =
      trade.feeOverride ??
      ((parseFloat(trade.transaction.gasUsed) * parseFloat(trade.transaction.gasPrice)) / 1e18);
    timestamp = trade.transaction.timeStamp;

    // valueが0の場合は売買ではなく送金/受取
    if (paymentValue === 0) {
      isTrade = false;
    }
  } else {
    throw new Error("Invalid trade: no payment method found");
  }

  // ERC-1155: tokenValueがある場合は数量、tokenIDは表示しない
  // ERC-721: tokenValueがない場合は1個、tokenIDを表示
  const isERC1155 = !!trade.nft.tokenValue;
  const nftQuantity = isERC1155 ? parseInt(trade.nft.tokenValue!) : 1;
  const nftName = isERC1155
    ? `NFT資産${trade.nft.tokenName}`
    : `NFT資産${trade.nft.tokenName}#${trade.nft.tokenID}`;
  const detailName = isERC1155
    ? trade.nft.tokenSymbol
    : `${trade.nft.tokenSymbol} #${trade.nft.tokenID}`;
  const tradeReviewFields = trade.reviewReason
    ? {
        要確認: "要確認",
        推奨取引種別: trade.suggestedType || "売買",
        確認理由: trade.reviewReason,
      }
    : {};

  // 売買ではない場合（valueが0）は送金/受取として扱う
  if (!isTrade) {
    if (isNFTIncoming) {
      // NFT受取
      return {
        取引所名: "metamask",
        "日時（JST）": formatJSTDate(timestamp),
        取引種別: "受取",
        "取引通貨名(+)": nftName,
        "取引量(+)": nftQuantity,
        "取引通貨名(-)": "",
        "取引量(-)": "",
        取引額時価: "",
        手数料通貨名: "ETH",
        手数料数量: fee,
        取引詳細: detailName,
        ...tradeReviewFields,
        ...reviewFields(
          "価値判定（市場価値あり/なし）は手動確認が必要です",
          "ボーナス / 無償取得 / 受取"
        ),
      };
    } else {
      // NFT送付
      return {
        取引所名: "metamask",
        "日時（JST）": formatJSTDate(timestamp),
        取引種別: "送付",
        "取引通貨名(+)": "",
        "取引量(+)": "",
        "取引通貨名(-)": nftName,
        "取引量(-)": nftQuantity,
        取引額時価: "",
        手数料通貨名: "ETH",
        手数料数量: fee,
        取引詳細: detailName,
        ...tradeReviewFields,
        ...reviewFields(
          "NFT送付の目的（自己移動・Giveaway・経費処理）は手動確認が必要です",
          "送付 / 減少 / 経費"
        ),
      };
    }
  }

  // 売買取引の場合
  if (isNFTIncoming) {
    // NFT購入: NFTを受取、トークン/ETHを支払い
    return {
      取引所名: "metamask",
      "日時（JST）": formatJSTDate(timestamp),
      取引種別: "売買",
      "取引通貨名(+)": nftName,
      "取引量(+)": nftQuantity,
      "取引通貨名(-)": paymentSymbol,
      "取引量(-)": paymentValue,
      取引額時価: "",
      手数料通貨名: "ETH",
      手数料数量: fee,
      取引詳細: detailName,
      ...tradeReviewFields,
    };
  } else {
    // NFT売却: トークン/ETHを受取、NFTを支払い
    return {
      取引所名: "metamask",
      "日時（JST）": formatJSTDate(timestamp),
      取引種別: "売買",
      "取引通貨名(+)": paymentSymbol,
      "取引量(+)": paymentValue,
      "取引通貨名(-)": nftName,
      "取引量(-)": nftQuantity,
      取引額時価: "",
      手数料通貨名: "ETH",
      手数料数量: fee,
      取引詳細: detailName,
      ...tradeReviewFields,
    };
  }
}

// 全トランザクションを会計エントリに変換
export function convertAllTransactions(
  transactions: EtherscanTransaction[],
  internalTxs: EtherscanTransaction[],
  tokenTransfers: EtherscanTokenTransfer[],
  nftTransfers: EtherscanNFTTransfer[],
  userAddress: string,
  year?: number,
  erc1155Transfers?: EtherscanNFTTransfer[]
): AccountingEntry[] {
  const entries: AccountingEntry[] = [];
  const erc1155 = erc1155Transfers || [];

  // 年指定がある場合のフィルター関数
  const isInYear = (timestamp: string): boolean => {
    if (!year) return true;
    const date = new Date(parseInt(timestamp) * 1000);
    return date.getFullYear() === year;
  };

  // NFT売買取引を検出（ERC721 + ERC1155）
  const nftTrades = groupNFTTrades(
    transactions,
    internalTxs,
    tokenTransfers,
    nftTransfers,
    erc1155,
    userAddress
  );
  const processedHashes = new Set<string>();

  // NFT売買取引を先に処理
  nftTrades.forEach((trades, hash) => {
    let hasEntryInYear = false;
    trades.forEach((trade) => {
      const timestamp =
        trade.token?.timeStamp || trade.transaction?.timeStamp || "";
      if (isInYear(timestamp)) {
        entries.push(convertNFTTradeToEntry(trade, userAddress));
        hasEntryInYear = true;
      }
    });
    if (hasEntryInYear) {
      processedHashes.add(hash);
    }
  });

  // 通常トランザクション
  transactions.forEach((tx) => {
    if (isInYear(tx.timeStamp) && !processedHashes.has(tx.hash)) {
      const entry = convertTransactionToEntry(tx, userAddress);
      if (entry) {
        entries.push(entry);
      }
    }
  });

  // トークン転送（NFT売買以外）
  tokenTransfers.forEach((transfer) => {
    if (isInYear(transfer.timeStamp) && !processedHashes.has(transfer.hash)) {
      const entry = convertTokenTransferToEntry(transfer, userAddress);
      if (entry) {
        entries.push(entry);
      }
    }
  });

  // NFT転送（NFT売買以外）
  nftTransfers.forEach((transfer) => {
    if (
      isInYear(transfer.timeStamp) &&
      !processedHashes.has(transfer.hash) &&
      !isSpamNFT(transfer, userAddress)
    ) {
      entries.push(convertNFTTransferToEntry(transfer, userAddress));
    }
  });

  // ERC1155転送（NFT売買以外）
  erc1155.forEach((transfer) => {
    if (
      isInYear(transfer.timeStamp) &&
      !processedHashes.has(transfer.hash) &&
      !isSpamNFT(transfer, userAddress)
    ) {
      entries.push(convertNFTTransferToEntry(transfer, userAddress));
    }
  });

  // 日時でソート
  entries.sort((a, b) => {
    return new Date(a["日時（JST）"]).getTime() - new Date(b["日時（JST）"]).getTime();
  });

  return entries;
}
