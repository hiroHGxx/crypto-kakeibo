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

function toOwnAddressSet(userAddresses: string | string[]): Set<string> {
  const addresses = Array.isArray(userAddresses) ? userAddresses : [userAddresses];
  return new Set(
    addresses
      .filter((address): address is string => Boolean(address))
      .map((address) => address.toLowerCase())
  );
}

function isOwnAddress(address: string, ownAddressSet: Set<string>): boolean {
  return ownAddressSet.has(address.toLowerCase());
}

// スパムNFTかどうかを判定（主に無差別エアドロップ）
function isSpamNFT(
  transfer: EtherscanNFTTransfer,
  userAddresses: string | string[]
): boolean {
  const ownAddressSet = toOwnAddressSet(userAddresses);
  const isIncoming = isOwnAddress(transfer.to, ownAddressSet);

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
  userAddresses: string | string[]
): AccountingEntry | null {
  const ownAddressSet = toOwnAddressSet(userAddresses);
  const isOutgoing = isOwnAddress(tx.from, ownAddressSet);
  const isIncoming = isOwnAddress(tx.to, ownAddressSet);

  const fee = (parseFloat(tx.gasUsed) * parseFloat(tx.gasPrice)) / 1e18;
  const value = weiToEth(tx.value);

  // 自己ウォレット間移動は送受信を計上せず、ガス代のみ扱う
  if (isOutgoing && isIncoming) {
    if (fee > 0) {
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
        取引詳細: tx.methodId || "",
      };
    }
    return null;
  }

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
      取引詳細: tx.methodId || "",
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
      取引詳細: tx.methodId || "",
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
      取引詳細: tx.methodId || "",
      ...reviewFields(
        "受取理由がオンチェーン情報だけでは確定できません",
        "ボーナス / 預入 / 受取"
      ),
    };
  }
}

// スパムトークンかどうかを判定
function isSpamToken(
  transfer: EtherscanTokenTransfer,
  userAddresses: string | string[]
): boolean {
  const ownAddressSet = toOwnAddressSet(userAddresses);
  const isIncoming = isOwnAddress(transfer.to, ownAddressSet);

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
  if (value > 0 && value <= 10 && !isOwnAddress(transfer.from, ownAddressSet)) {
    return true;
  }

  return false;
}

// トークン転送を会計エントリに変換
export function convertTokenTransferToEntry(
  transfer: EtherscanTokenTransfer,
  userAddresses: string | string[]
): AccountingEntry | null {
  // スパムトークンをフィルタリング
  if (isSpamToken(transfer, userAddresses)) {
    return null;
  }

  const ownAddressSet = toOwnAddressSet(userAddresses);
  const isOutgoing = isOwnAddress(transfer.from, ownAddressSet);
  const isIncoming = isOwnAddress(transfer.to, ownAddressSet);

  // 自己ウォレット間移動は別途トランザクション側で手数料処理する
  if (isOutgoing && isIncoming) {
    return null;
  }

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
  userAddresses: string | string[]
): AccountingEntry | null {
  if (isSpamNFT(transfer, userAddresses)) {
    throw new Error("Spam NFT should be filtered before conversion");
  }

  const ownAddressSet = toOwnAddressSet(userAddresses);
  const isOutgoing = isOwnAddress(transfer.from, ownAddressSet);
  const isIncoming = isOwnAddress(transfer.to, ownAddressSet);

  // 自己ウォレット間移動は送受信本体を記録しない
  if (isOutgoing && isIncoming) {
    return null;
  }

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
  userAddresses: string | string[]
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
  const ownAddressSet = toOwnAddressSet(userAddresses);

  // スパム除外後の全NFT転送（ERC721 + ERC1155）をハッシュでマッピング
  const nftByHash = new Map<string, EtherscanNFTTransfer[]>();
  [...nftTransfers, ...erc1155Transfers]
    .filter((nft) => !isSpamNFT(nft, userAddresses))
    .filter((nft) => !(isOwnAddress(nft.from, ownAddressSet) && isOwnAddress(nft.to, ownAddressSet)))
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
  userAddresses: string | string[]
): AccountingEntry {
  const ownAddressSet = toOwnAddressSet(userAddresses);
  const isNFTIncoming = isOwnAddress(trade.nft.to, ownAddressSet);

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

function convertEthWethSwapToEntry(
  hash: string,
  direction: "ETH_TO_WETH" | "WETH_TO_ETH",
  timestamp: string,
  ethAmount: number,
  wethAmount: number,
  fee: number
): AccountingEntry {
  const isEthToWeth = direction === "ETH_TO_WETH";
  return {
    取引所名: "metamask",
    "日時（JST）": formatJSTDate(timestamp),
    取引種別: "売買",
    "取引通貨名(+)": isEthToWeth ? "WETH" : "ETH",
    "取引量(+)": isEthToWeth ? wethAmount : ethAmount,
    "取引通貨名(-)": isEthToWeth ? "ETH" : "WETH",
    "取引量(-)": isEthToWeth ? ethAmount : wethAmount,
    取引額時価: "",
    手数料通貨名: fee > 0 ? "ETH" : "",
    手数料数量: fee > 0 ? fee : "",
    取引詳細: `ETH-WETH swap (${hash.slice(0, 10)}...)`,
  };
}

const WETH_CONTRACT_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c4a6e811865b0a1f5b4f27e8d018e0c4f1ae2f9e7e5c2fb4f0b2";
const WETH_DEPOSIT_TOPIC =
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";
const WETH_WITHDRAWAL_TOPIC =
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";
const METAMASK_BRIDGE_PREFIXES = ["0x9a47f328"];

function isMetaMaskBridgeAddress(address: string): boolean {
  const normalized = (address || "").toLowerCase();
  return METAMASK_BRIDGE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function hexToAddress(topicValue: string): string {
  const hex = (topicValue || "").toLowerCase().replace(/^0x/, "");
  return `0x${hex.slice(-40)}`;
}

function hexToEthAmount(hexValue: string): number {
  const raw = BigInt(hexValue || "0x0");
  return Number(raw) / 1e18;
}

// 全トランザクションを会計エントリに変換
export function convertAllTransactions(
  transactions: EtherscanTransaction[],
  internalTxs: EtherscanTransaction[],
  tokenTransfers: EtherscanTokenTransfer[],
  nftTransfers: EtherscanNFTTransfer[],
  userAddresses: string | string[],
  year?: number,
  erc1155Transfers?: EtherscanNFTTransfer[],
  receiptsByHash?: Record<string, any>
): AccountingEntry[] {
  const entries: AccountingEntry[] = [];
  const erc1155 = erc1155Transfers || [];
  const ownAddressSet = toOwnAddressSet(userAddresses);
  const normalizeHash = (hash: string) => (hash || "").toLowerCase();

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
    userAddresses
  );
  const processedHashes = new Set<string>();
  const isProcessed = (hash: string) => processedHashes.has(normalizeHash(hash));
  const markProcessed = (hash: string) => {
    processedHashes.add(normalizeHash(hash));
  };

  // NFT売買取引を先に処理
  nftTrades.forEach((trades, hash) => {
    let hasEntryInYear = false;
    trades.forEach((trade) => {
      const timestamp =
        trade.token?.timeStamp || trade.transaction?.timeStamp || "";
      if (isInYear(timestamp)) {
        entries.push(convertNFTTradeToEntry(trade, userAddresses));
        hasEntryInYear = true;
      }
    });
    if (hasEntryInYear) {
      markProcessed(hash);
    }
  });

  // ETH/WETHスワップを処理（通常の送付/受取より優先）
  const txByHash = new Map<string, EtherscanTransaction[]>();
  transactions.forEach((tx) => {
    const list = txByHash.get(tx.hash) || [];
    list.push(tx);
    txByHash.set(tx.hash, list);
  });
  const internalByHash = new Map<string, EtherscanTransaction[]>();
  internalTxs.forEach((tx) => {
    const list = internalByHash.get(tx.hash) || [];
    list.push(tx);
    internalByHash.set(tx.hash, list);
  });
  const nftTransferHashSet = new Set<string>([
    ...nftTransfers.map((transfer) => transfer.hash),
    ...erc1155.map((transfer) => transfer.hash),
  ]);
  const wethByHash = new Map<string, EtherscanTokenTransfer[]>();
  tokenTransfers.forEach((transfer) => {
    if (transfer.tokenSymbol !== "WETH") return;
    const list = wethByHash.get(transfer.hash) || [];
    list.push(transfer);
    wethByHash.set(transfer.hash, list);
  });

  const swapCandidateHashes = new Set<string>(wethByHash.keys());
  txByHash.forEach((txs, hash) => {
    const hasMetamaskBridgeCall = txs.some(
      (tx) =>
        isOwnAddress(tx.from, ownAddressSet) &&
        isMetaMaskBridgeAddress(tx.to || "")
    );
    if (hasMetamaskBridgeCall) {
      swapCandidateHashes.add(hash);
    }

    const hasWethContractCall = txs.some((tx) => {
      const to = (tx.to || "").toLowerCase();
      const method = (tx.methodId || "").toLowerCase();
      const from = (tx.from || "").toLowerCase();
      const isOwnTx = isOwnAddress(from, ownAddressSet);
      return (
        to === WETH_CONTRACT_ADDRESS &&
        isOwnTx &&
        (method === "0xd0e30db0" || method === "0x2e1a7d4d" || weiToEth(tx.value) > 0)
      );
    });
    if (hasWethContractCall) {
      swapCandidateHashes.add(hash);
    }

    // MetaMask Bridge系: ETH送信 + 同一hashで内部ETH受取（返金）がある取引も候補化
    const ethOut = txs
      .filter((tx) => isOwnAddress(tx.from, ownAddressSet))
      .reduce((sum, tx) => sum + weiToEth(tx.value), 0);
    const internal = internalByHash.get(hash) || [];
    const ethRefund = internal
      .filter((tx) => isOwnAddress(tx.to, ownAddressSet))
      .reduce((sum, tx) => sum + weiToEth(tx.value), 0);
    if (ethOut > 0 && ethRefund > 0) {
      swapCandidateHashes.add(hash);
    }
  });
  internalByHash.forEach((txs, hash) => {
    const hasToWeth = txs.some(
      (tx) => (tx.to || "").toLowerCase() === WETH_CONTRACT_ADDRESS && weiToEth(tx.value) > 0
    );
    const hasFromWeth = txs.some(
      (tx) => (tx.from || "").toLowerCase() === WETH_CONTRACT_ADDRESS && weiToEth(tx.value) > 0
    );
    if (hasToWeth || hasFromWeth) {
      swapCandidateHashes.add(hash);
    }
  });

  swapCandidateHashes.forEach((hash) => {
    if (isProcessed(hash)) return;
    const wethTransfers = wethByHash.get(hash) || [];
    const txs = txByHash.get(hash) || [];
    const internal = internalByHash.get(hash) || [];

    const wethInFromTransfers = wethTransfers
      .filter((transfer) => isOwnAddress(transfer.to, ownAddressSet))
      .reduce(
        (sum, transfer) =>
          sum + parseFloat(transfer.value) / Math.pow(10, parseInt(transfer.tokenDecimal)),
        0
      );
    const wethOutFromTransfers = wethTransfers
      .filter((transfer) => isOwnAddress(transfer.from, ownAddressSet))
      .reduce(
        (sum, transfer) =>
          sum + parseFloat(transfer.value) / Math.pow(10, parseInt(transfer.tokenDecimal)),
        0
      );
    const receipt = receiptsByHash?.[hash.toLowerCase()];
    let wethInFromReceipt = 0;
    let wethOutFromReceipt = 0;
    let wethDepositAmount = 0;
    let wethWithdrawalAmount = 0;
    if (receipt && Array.isArray(receipt.logs)) {
      receipt.logs.forEach((log: any) => {
        const address = (log.address || "").toLowerCase();
        const topics: string[] = log.topics || [];

        // WETH Transfer event検出
        if (
          address === WETH_CONTRACT_ADDRESS &&
          topics.length >= 3 &&
          (topics[0] || "").toLowerCase() === ERC20_TRANSFER_TOPIC.toLowerCase()
        ) {
          const from = hexToAddress(topics[1]);
          const to = hexToAddress(topics[2]);
          const amount = hexToEthAmount(log.data);
          if (isOwnAddress(to, ownAddressSet)) {
            wethInFromReceipt += amount;
          }
          if (isOwnAddress(from, ownAddressSet)) {
            wethOutFromReceipt += amount;
          }
        }

        // WETH Deposit event検出（Transfer eventが無い場合の補完）
        if (
          address === WETH_CONTRACT_ADDRESS &&
          topics.length >= 1 &&
          (topics[0] || "").toLowerCase() === WETH_DEPOSIT_TOPIC.toLowerCase()
        ) {
          const amount = hexToEthAmount(log.data);
          wethDepositAmount += amount;
        }

        // WETH Withdrawal event検出（WETH→ETH）
        if (
          address === WETH_CONTRACT_ADDRESS &&
          topics.length >= 1 &&
          (topics[0] || "").toLowerCase() === WETH_WITHDRAWAL_TOPIC.toLowerCase()
        ) {
          const amount = hexToEthAmount(log.data);
          wethWithdrawalAmount += amount;
        }
      });
    }
    const wethIn = Math.max(wethInFromTransfers, wethInFromReceipt, wethDepositAmount);
    const wethOut = Math.max(wethOutFromTransfers, wethOutFromReceipt, wethWithdrawalAmount);

    const ethOut = txs
      .filter((tx) => isOwnAddress(tx.from, ownAddressSet))
      .reduce((sum, tx) => sum + weiToEth(tx.value), 0);
    const ethInTx = txs
      .filter((tx) => isOwnAddress(tx.to, ownAddressSet))
      .reduce((sum, tx) => sum + weiToEth(tx.value), 0);
    const ethInInternal = internal
      .filter((tx) => isOwnAddress(tx.to, ownAddressSet))
      .reduce((sum, tx) => sum + weiToEth(tx.value), 0);
    const ethIn = ethInTx + ethInInternal;
    const ethRefund = ethInInternal;
    const ethToWethContract = internal
      .filter((tx) => (tx.to || "").toLowerCase() === WETH_CONTRACT_ADDRESS)
      .reduce((sum, tx) => sum + weiToEth(tx.value), 0);

    const feeTx =
      txs.find((tx) => isOwnAddress(tx.from, ownAddressSet)) || txs[0];
    const fee = feeTx
      ? (parseFloat(feeTx.gasUsed) * parseFloat(feeTx.gasPrice)) / 1e18
      : 0;
    const timestamp =
      wethTransfers[0]?.timeStamp || feeTx?.timeStamp || internal[0]?.timeStamp || "";
    if (!timestamp || !isInYear(timestamp)) return;

    // MetaMask Bridge経由: 出たETHと同量のWETHが入る前提で売買扱い
    const isMetamaskBridgeTx = txs.some(
      (tx) =>
        isOwnAddress(tx.from, ownAddressSet) &&
        isMetaMaskBridgeAddress(tx.to || "")
    );
    if (
      isMetamaskBridgeTx &&
      !nftTransferHashSet.has(hash) &&
      ethOut > 0 &&
      wethIn === 0 &&
      wethOut === 0
    ) {
      const effectiveEthOut =
        ethRefund > 0 && ethOut > ethRefund ? ethOut - ethRefund : ethOut;
      entries.push(
        convertEthWethSwapToEntry(
          hash,
          "ETH_TO_WETH",
          timestamp,
          effectiveEthOut,
          effectiveEthOut,
          fee
        )
      );
      markProcessed(hash);
      return;
    }

    // Bridge経由フォールバック:
    // WETH transfer が見えず、同一hashで内部返金がある場合は
    // 受取WETHを (送信ETH - 返金ETH) とみなして売買扱いにする
    if (
      !nftTransferHashSet.has(hash) &&
      wethIn === 0 &&
      wethOut === 0 &&
      ethOut > 0 &&
      ethRefund > 0 &&
      ethOut > ethRefund
    ) {
      const effectiveEthOut = ethOut - ethRefund;
      entries.push(
        convertEthWethSwapToEntry(
          hash,
          "ETH_TO_WETH",
          timestamp,
          effectiveEthOut,
          effectiveEthOut,
          fee
        )
      );
      markProcessed(hash);
      return;
    }

    // Bridge経由などでWETHのERC20受取が見えないケースを補完
    if (
      !nftTransferHashSet.has(hash) &&
      wethIn === 0 &&
      wethOut === 0 &&
      ethOut > 0 &&
      ethToWethContract > 0
    ) {
      entries.push(
        convertEthWethSwapToEntry(
          hash,
          "ETH_TO_WETH",
          timestamp,
          ethOut,
          ethToWethContract,
          fee
        )
      );
      markProcessed(hash);
      return;
    }

    // WETH deposit（ETH -> WETH）はtransferが欠けるケースがあるためmethodIdでも補完
    const hasWrapCall = txs.some((tx) => {
      const to = (tx.to || "").toLowerCase();
      const method = (tx.methodId || "").toLowerCase();
      return (
        to === WETH_CONTRACT_ADDRESS &&
        (method === "0xd0e30db0" || weiToEth(tx.value) > 0)
      );
    });
    if (hasWrapCall && ethOut > 0) {
      const wethInOrEstimated = wethIn > 0 ? wethIn : ethOut;
      entries.push(
        convertEthWethSwapToEntry(
          hash,
          "ETH_TO_WETH",
          timestamp,
          ethOut,
          wethInOrEstimated,
          fee
        )
      );
      markProcessed(hash);
      return;
    }

    if (ethOut > 0 && wethIn > 0) {
      entries.push(
        convertEthWethSwapToEntry(hash, "ETH_TO_WETH", timestamp, ethOut, wethIn, fee)
      );
      markProcessed(hash);
      return;
    }

    if (wethOut > 0 && ethIn > 0) {
      entries.push(
        convertEthWethSwapToEntry(hash, "WETH_TO_ETH", timestamp, ethIn, wethOut, fee)
      );
      markProcessed(hash);
    }
  });

  // 通常トランザクション
  transactions.forEach((tx) => {
    if (isInYear(tx.timeStamp) && !isProcessed(tx.hash)) {
      const txHash = tx.hash;
      const isOutgoing = isOwnAddress(tx.from, ownAddressSet);
      const txValue = weiToEth(tx.value);
      const hasNftOnHash = nftTransferHashSet.has(txHash);
      const hashInternal = internalByHash.get(txHash) || [];
      const ethRefund = hashInternal
        .filter((internalTx) => isOwnAddress(internalTx.to, ownAddressSet))
        .reduce((sum, internalTx) => sum + weiToEth(internalTx.value), 0);
      const hashWethTransfers = wethByHash.get(txHash) || [];
      const receipt = receiptsByHash?.[txHash.toLowerCase()];
      let hasOwnWethMoveInReceipt = false;
      let hasWethDepositInReceipt = false;
      let wethDepositAmountInReceipt = 0;
      if (receipt && Array.isArray(receipt.logs)) {
        hasOwnWethMoveInReceipt = receipt.logs.some((log: any) => {
          const address = (log.address || "").toLowerCase();
          const topics: string[] = log.topics || [];

          // Transfer event
          if (
            address === WETH_CONTRACT_ADDRESS &&
            topics.length >= 3 &&
            (topics[0] || "").toLowerCase() === ERC20_TRANSFER_TOPIC.toLowerCase()
          ) {
            const from = hexToAddress(topics[1]);
            const to = hexToAddress(topics[2]);
            return isOwnAddress(from, ownAddressSet) || isOwnAddress(to, ownAddressSet);
          }

          return false;
        });

        // Deposit event検出
        receipt.logs.forEach((log: any) => {
          const address = (log.address || "").toLowerCase();
          const topics: string[] = log.topics || [];
          if (
            address === WETH_CONTRACT_ADDRESS &&
            topics.length >= 1 &&
            (topics[0] || "").toLowerCase() === WETH_DEPOSIT_TOPIC.toLowerCase()
          ) {
            hasWethDepositInReceipt = true;
            wethDepositAmountInReceipt += hexToEthAmount(log.data);
          }
        });
      }

      // WETH Deposit event検出による売買判定（最優先）
      if (
        isOutgoing &&
        txValue > 0 &&
        !hasNftOnHash &&
        hasWethDepositInReceipt &&
        wethDepositAmountInReceipt > 0
      ) {
        const fee = (parseFloat(tx.gasUsed) * parseFloat(tx.gasPrice)) / 1e18;
        // 返金を考慮して実質的な交換量を計算（deposit量と一致させる）
        const effectiveEthAmount = wethDepositAmountInReceipt;
        entries.push(
          convertEthWethSwapToEntry(
            txHash,
            "ETH_TO_WETH",
            tx.timeStamp,
            effectiveEthAmount,
            wethDepositAmountInReceipt,
            fee
          )
        );
        markProcessed(txHash);
        return;
      }

      // Bridge経由フォールバック（通常TX側で直接判定）
      if (
        isOutgoing &&
        txValue > 0 &&
        !hasNftOnHash &&
        !hashWethTransfers.some(
          (transfer) =>
            isOwnAddress(transfer.from, ownAddressSet) ||
            isOwnAddress(transfer.to, ownAddressSet)
        ) &&
        !hasOwnWethMoveInReceipt &&
        !hasWethDepositInReceipt &&
        ethRefund > 0 &&
        txValue > ethRefund
      ) {
        const fee =
          (parseFloat(tx.gasUsed) * parseFloat(tx.gasPrice)) / 1e18;
        entries.push(
          convertEthWethSwapToEntry(
            txHash,
            "ETH_TO_WETH",
            tx.timeStamp,
            txValue,
            txValue - ethRefund,
            fee
          )
        );
        markProcessed(txHash);
        return;
      }

      const entry = convertTransactionToEntry(tx, userAddresses);
      if (entry) {
        entries.push(entry);
      }
    }
  });

  // トークン転送（NFT売買以外）
  tokenTransfers.forEach((transfer) => {
    if (isInYear(transfer.timeStamp) && !isProcessed(transfer.hash)) {
      const entry = convertTokenTransferToEntry(transfer, userAddresses);
      if (entry) {
        entries.push(entry);
      }
    }
  });

  // NFT転送（NFT売買以外）
  nftTransfers.forEach((transfer) => {
    if (
      isInYear(transfer.timeStamp) &&
      !isProcessed(transfer.hash) &&
      !isSpamNFT(transfer, userAddresses)
    ) {
      const entry = convertNFTTransferToEntry(transfer, userAddresses);
      if (entry) {
        entries.push(entry);
      }
    }
  });

  // ERC1155転送（NFT売買以外）
  erc1155.forEach((transfer) => {
    if (
      isInYear(transfer.timeStamp) &&
      !isProcessed(transfer.hash) &&
      !isSpamNFT(transfer, userAddresses)
    ) {
      const entry = convertNFTTransferToEntry(transfer, userAddresses);
      if (entry) {
        entries.push(entry);
      }
    }
  });

  // 日時でソート
  entries.sort((a, b) => {
    return new Date(a["日時（JST）"]).getTime() - new Date(b["日時（JST）"]).getTime();
  });

  return entries;
}
