import {
  EtherscanTransaction,
  EtherscanTokenTransfer,
  EtherscanNFTTransfer,
  AccountingEntry,
} from "@/types";
import {
  evaluateClassificationRules,
  type RuleContext,
} from "./classification-rules";
import {
  type ChainConfig,
  CHAIN_CONFIGS,
  ERC20_TRANSFER_TOPIC,
  WETH_DEPOSIT_TOPIC,
  WETH_WITHDRAWAL_TOPIC,
  NULL_ADDRESS,
} from "./chain-config";

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

  // キリル文字偽装NFTはスパム
  if (containsHomoglyph(transfer.tokenName || "") || containsHomoglyph(transfer.tokenSymbol || "")) {
    return true;
  }

  // URL誘導系・詐欺系のNFTはスパムとして扱う
  const suspiciousPatterns = [
    "http://",
    "https://",
    "www.",
    ".com",
    ".io",
    ".xyz",
    ".lat",
    ".org",
    "claim",
    "visit",
    "reward",
    "gift",
    "redeem",
    "t.me/",
    "t.ly/",
  ];

  if (suspiciousPatterns.some((pattern) => combined.includes(pattern))) {
    return true;
  }

  // 無名NFT（tokenName が "1" や空文字、数字のみ）は常にスパム
  // 正規のNFTは必ず名前がつけられている
  const trimmedName = (transfer.tokenName || "").trim();
  if (trimmedName === "" || /^\d+$/.test(trimmedName)) {
    return true;
  }

  // tokenSymbol も同様にチェック（ERC1155でtokenNameが正常でもsymbolが数字のみの場合）
  const trimmedSymbol = (transfer.tokenSymbol || "").trim();
  if (trimmedSymbol === "" || /^\d+$/.test(trimmedSymbol)) {
    return true;
  }

  return false;
}

// 通常トランザクションを会計エントリに変換
export function convertTransactionToEntry(
  tx: EtherscanTransaction,
  userAddresses: string | string[],
  chainConfig?: ChainConfig
): AccountingEntry | null {
  const config = chainConfig || CHAIN_CONFIGS["1"];
  const ownAddressSet = toOwnAddressSet(userAddresses);
  const isOutgoing = isOwnAddress(tx.from, ownAddressSet);
  const isIncoming = isOwnAddress(tx.to, ownAddressSet);

  const fee = (parseFloat(tx.gasUsed) * parseFloat(tx.gasPrice)) / 1e18;
  const value = weiToEth(tx.value);

  // 自己ウォレット間移動は送受信を計上せず、ガス代のみ扱う
  if (isOutgoing && isIncoming) {
    if (fee > 0) {
      return {
        取引所名: config.exchangeName,
        "日時（JST）": formatJSTDate(tx.timeStamp),
        取引種別: "手数料",
        "取引通貨名(+)": "",
        "取引量(+)": "",
        "取引通貨名(-)": "",
        "取引量(-)": "",
        取引額時価: "",
        手数料通貨名: config.nativeToken,
        手数料数量: fee,
        取引詳細: tx.methodId || "",
      };
    }
    return null;
  }

  // 手数料のみのトランザクション（valueが0）
  if (value === 0 && fee > 0) {
    return {
      取引所名: config.exchangeName,
      "日時（JST）": formatJSTDate(tx.timeStamp),
      取引種別: "手数料",
      "取引通貨名(+)": "",
      "取引量(+)": "",
      "取引通貨名(-)": "",
      "取引量(-)": "",
      取引額時価: "",
      手数料通貨名: config.nativeToken,
      手数料数量: fee,
      取引詳細: tx.methodId || "",
    };
  }

  // 送金トランザクション
  if (isOutgoing) {
    return {
      取引所名: config.exchangeName,
      "日時（JST）": formatJSTDate(tx.timeStamp),
      取引種別: "送付",
      "取引通貨名(+)": "",
      "取引量(+)": "",
      "取引通貨名(-)": config.nativeToken,
      "取引量(-)": value,
      取引額時価: "",
      手数料通貨名: config.nativeToken,
      手数料数量: fee,
      取引詳細: tx.methodId || "",
      ...reviewFields(
        "送信先の用途がオンチェーン情報だけでは確定できません",
        "送付 / 支払 / 減少 / 経費"
      ),
    };
  } else {
    return {
      取引所名: config.exchangeName,
      "日時（JST）": formatJSTDate(tx.timeStamp),
      取引種別: "受取",
      "取引通貨名(+)": config.nativeToken,
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

// キリル文字等のホモグリフ（偽装文字）が含まれているか判定
function containsHomoglyph(text: string): boolean {
  // キリル文字範囲（ラテン文字の偽装に使われる）
  return /[\u0400-\u04FF\u0500-\u052F]/.test(text);
}

// スパムトークンかどうかを判定
function isSpamToken(
  transfer: EtherscanTokenTransfer,
  userAddresses: string | string[]
): boolean {
  const ownAddressSet = toOwnAddressSet(userAddresses);
  const isIncoming = isOwnAddress(transfer.to, ownAddressSet);

  const symbol = (transfer.tokenSymbol || "").toUpperCase();
  const name = (transfer.tokenName || "").toLowerCase();
  const combined = `${name} ${symbol}`.toLowerCase();

  // キリル文字偽装トークン（EТH, UЅDС等）は送信・受信問わずスパム
  if (containsHomoglyph(transfer.tokenSymbol || "") || containsHomoglyph(transfer.tokenName || "")) {
    return true;
  }

  // 送信トランザクションはキリル文字以外のスパム判定はスキップ
  if (!isIncoming) {
    return false;
  }

  // URL・詐欺誘導パターン
  const spamPatterns = [
    "http://", "https://", "www.", ".com", ".io", ".xyz", ".lat", ".org",
    "claim", "visit", "reward", "gift", "redeem", "airdrop",
    "t.me/", "t.ly/",
  ];
  if (spamPatterns.some((pattern) => combined.includes(pattern))) {
    return true;
  }

  // 既知のスパムトークンシンボル
  const knownSpamSymbols = [
    "AM00R", "SEB",
  ];
  if (knownSpamSymbols.includes(symbol)) {
    return true;
  }

  // 信頼できるトークンのホワイトリスト
  const trustedTokens = [
    'WETH', 'USDT', 'USDC', 'DAI', 'WBTC', 'LINK', 'UNI', 'AAVE',
    'MATIC', 'SHIB', 'APE', 'LDO', 'CRV', 'MKR', 'SNX', 'COMP',
    'WMATIC', 'POL', 'WPOL', 'SAND', 'FNCT', 'CNGT', 'JPYC',
  ];

  if (trustedTokens.includes(symbol)) {
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
  userAddresses: string | string[],
  chainConfig?: ChainConfig
): AccountingEntry | null {
  const config = chainConfig || CHAIN_CONFIGS["1"];

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

  // value=0のトークン転送はスキップ（意味のない転送）
  if (value === 0) {
    return null;
  }

  if (isOutgoing) {
    return {
      取引所名: config.exchangeName,
      "日時（JST）": formatJSTDate(transfer.timeStamp),
      取引種別: "送付",
      "取引通貨名(+)": "",
      "取引量(+)": "",
      "取引通貨名(-)": transfer.tokenSymbol,
      "取引量(-)": value,
      取引額時価: "",
      手数料通貨名: config.nativeToken,
      手数料数量: fee,
      取引詳細: transfer.tokenName,
      ...reviewFields(
        "送付の目的（支払・経費・減少など）がオンチェーン情報だけでは確定できません",
        "送付 / 支払 / 経費 / 減少"
      ),
    };
  } else {
    return {
      取引所名: config.exchangeName,
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
  userAddresses: string | string[],
  chainConfig?: ChainConfig
): AccountingEntry | null {
  const config = chainConfig || CHAIN_CONFIGS["1"];

  if (isSpamNFT(transfer, userAddresses)) {
    return null;
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
      取引所名: config.exchangeName,
      "日時（JST）": formatJSTDate(transfer.timeStamp),
      取引種別: "送付",
      "取引通貨名(+)": "",
      "取引量(+)": "",
      "取引通貨名(-)": nftName,
      "取引量(-)": nftQuantity,
      取引額時価: "",
      手数料通貨名: fee > 0 ? config.nativeToken : "",
      手数料数量: fee > 0 ? fee : "",
      取引詳細: detailName,
      ...reviewFields(
        "NFT送付の意図（自己移動・Giveaway・経費処理）がオンチェーン情報だけでは確定できません",
        "送付 / 減少 / 経費 / 売買"
      ),
    };
  } else {
    return {
      取引所名: config.exchangeName,
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
  userAddresses: string | string[],
  chainConfig?: ChainConfig
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

  const config = chainConfig || CHAIN_CONFIGS["1"];
  // スパム除外後の全NFT転送（ERC721 + ERC1155）をハッシュでマッピング
  const nftByHash = new Map<string, EtherscanNFTTransfer[]>();
  [...nftTransfers, ...erc1155Transfers]
    .filter((nft) => !isSpamNFT(nft, userAddresses))
    .filter((nft) => !(isOwnAddress(nft.from, ownAddressSet) && isOwnAddress(nft.to, ownAddressSet)))
    .filter((nft) => (nft.to || "").toLowerCase() !== NULL_ADDRESS) // Nullアドレスへの焼却を除外
    .forEach((nft) => {
      const list = nftByHash.get(nft.hash) || [];
      list.push(nft);
      nftByHash.set(nft.hash, list);
    });

  // 支払いに使われるトークン転送（ネイティブトークン/Wrappedトークン）をハッシュでマッピング
  const paymentTokenSymbols = new Set([
    config.nativeToken, config.wrappedNativeToken,
    "ETH", "WETH", "MATIC", "WMATIC", "POL",
  ]);
  const paymentTokensByHash = new Map<string, EtherscanTokenTransfer[]>();
  tokenTransfers.forEach((token) => {
    if (!paymentTokenSymbols.has(token.tokenSymbol)) {
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
  // ユーザー宛のInternal TX受取額（マーケットプレイスNFT売却検出用）
  const internalReceivedByHash = new Map<string, number[]>();
  internalTxs.forEach((tx) => {
    const value = weiToEth(tx.value);
    if (value <= 0) {
      return;
    }
    const list = internalPaymentsByHash.get(tx.hash) || [];
    list.push(value);
    internalPaymentsByHash.set(tx.hash, list);
    if (isOwnAddress(tx.to, ownAddressSet)) {
      const rList = internalReceivedByHash.get(tx.hash) || [];
      rList.push(value);
      internalReceivedByHash.set(tx.hash, rList);
    }
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

    // マーケットプレイス経由NFT売却検出:
    // 通常TXが存在しない（買い手が発信者）が、自分のNFT OUT + Internal TXでPOL受取がある
    const nftOuts = nfts.filter((nft) => isOwnAddress(nft.from, ownAddressSet));
    const received = internalReceivedByHash.get(hash) || [];
    if (nftOuts.length > 0 && received.length > 0) {
      const totalReceived = received.reduce((sum, v) => sum + v, 0);
      nftOuts.forEach((nft) => {
        const perNFTValue = totalReceived / nftOuts.length;
        groupedTrades.push({
          nft,
          paymentValueOverride: perNFTValue,
          feeOverride: 0, // 買い手がガス代を負担
          reviewReason: nftOuts.length > 1
            ? "マーケットプレイスNFT売却（複数NFT按分・要確認）"
            : undefined,
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
  userAddresses: string | string[],
  chainConfig?: ChainConfig
): AccountingEntry | null {
  const config = chainConfig || CHAIN_CONFIGS["1"];

  // スパムNFTは変換しない
  if (isSpamNFT(trade.nft, userAddresses)) {
    return null;
  }

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
    // 通常トランザクション（ネイティブトークン）での支払い
    paymentValue = trade.paymentValueOverride ?? weiToEth(trade.transaction.value);
    paymentSymbol = config.nativeToken;
    fee =
      trade.feeOverride ??
      ((parseFloat(trade.transaction.gasUsed) * parseFloat(trade.transaction.gasPrice)) / 1e18);
    timestamp = trade.transaction.timeStamp;

    // valueが0の場合は売買ではなく送金/受取
    if (paymentValue === 0) {
      isTrade = false;
    }
  } else if (trade.paymentValueOverride !== undefined) {
    // マーケットプレイス売却等: TXは買い手発行だがInternal TXで代金受取
    paymentValue = trade.paymentValueOverride;
    paymentSymbol = config.nativeToken;
    fee = trade.feeOverride ?? 0;
    timestamp = trade.nft.timeStamp;
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
        取引所名: config.exchangeName,
        "日時（JST）": formatJSTDate(timestamp),
        取引種別: "受取",
        "取引通貨名(+)": nftName,
        "取引量(+)": nftQuantity,
        "取引通貨名(-)": "",
        "取引量(-)": "",
        取引額時価: "",
        手数料通貨名: config.nativeToken,
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
        取引所名: config.exchangeName,
        "日時（JST）": formatJSTDate(timestamp),
        取引種別: "送付",
        "取引通貨名(+)": "",
        "取引量(+)": "",
        "取引通貨名(-)": nftName,
        "取引量(-)": nftQuantity,
        取引額時価: "",
        手数料通貨名: config.nativeToken,
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
      取引所名: config.exchangeName,
      "日時（JST）": formatJSTDate(timestamp),
      取引種別: "売買",
      "取引通貨名(+)": nftName,
      "取引量(+)": nftQuantity,
      "取引通貨名(-)": paymentSymbol,
      "取引量(-)": paymentValue,
      取引額時価: "",
      手数料通貨名: config.nativeToken,
      手数料数量: fee,
      取引詳細: detailName,
      ...tradeReviewFields,
    };
  } else {
    // NFT売却: トークン/ETHを受取、NFTを支払い
    return {
      取引所名: config.exchangeName,
      "日時（JST）": formatJSTDate(timestamp),
      取引種別: "売買",
      "取引通貨名(+)": paymentSymbol,
      "取引量(+)": paymentValue,
      "取引通貨名(-)": nftName,
      "取引量(-)": nftQuantity,
      取引額時価: "",
      手数料通貨名: config.nativeToken,
      手数料数量: fee,
      取引詳細: detailName,
      ...tradeReviewFields,
    };
  }
}

function convertNativeWrappedSwapToEntry(
  hash: string,
  direction: "NATIVE_TO_WRAPPED" | "WRAPPED_TO_NATIVE",
  timestamp: string,
  nativeAmount: number,
  wrappedAmount: number,
  fee: number,
  chainConfig?: ChainConfig
): AccountingEntry {
  const config = chainConfig || CHAIN_CONFIGS["1"];
  const isNativeToWrapped = direction === "NATIVE_TO_WRAPPED";
  return {
    取引所名: config.exchangeName,
    "日時（JST）": formatJSTDate(timestamp),
    取引種別: "売買",
    "取引通貨名(+)": isNativeToWrapped ? config.wrappedNativeToken : config.nativeToken,
    "取引量(+)": isNativeToWrapped ? wrappedAmount : nativeAmount,
    "取引通貨名(-)": isNativeToWrapped ? config.nativeToken : config.wrappedNativeToken,
    "取引量(-)": isNativeToWrapped ? nativeAmount : wrappedAmount,
    取引額時価: "",
    手数料通貨名: fee > 0 ? config.nativeToken : "",
    手数料数量: fee > 0 ? fee : "",
    取引詳細: `${config.nativeToken}-${config.wrappedNativeToken} swap (${hash.slice(0, 10)}...)`,
  };
}

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
  receiptsByHash?: Record<string, any>,
  chainConfig?: ChainConfig
): AccountingEntry[] {
  const config = chainConfig || CHAIN_CONFIGS["1"];
  const WRAPPED_CONTRACT_ADDRESS = config.wrappedNativeAddress;
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
    userAddresses,
    config
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
        trade.token?.timeStamp || trade.transaction?.timeStamp || trade.nft.timeStamp || "";
      if (isInYear(timestamp)) {
        const entry = convertNFTTradeToEntry(trade, userAddresses, config);
        if (entry) {
          entries.push(entry);
          hasEntryInYear = true;
        }
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

  // 自分が発信者（gas代負担）のTXハッシュセット（ボーナス判定用）
  const ownInitiatedTxHashes = new Set<string>();
  transactions.forEach((tx) => {
    if (isOwnAddress(tx.from, ownAddressSet)) {
      ownInitiatedTxHashes.add(tx.hash);
    }
  });

  const nftTransferHashSet = new Set<string>([
    ...nftTransfers.map((transfer) => transfer.hash),
    ...erc1155.map((transfer) => transfer.hash),
  ]);
  const wethByHash = new Map<string, EtherscanTokenTransfer[]>();
  tokenTransfers.forEach((transfer) => {
    if (transfer.tokenSymbol !== config.wrappedNativeToken) return;
    const list = wethByHash.get(transfer.hash) || [];
    list.push(transfer);
    wethByHash.set(transfer.hash, list);
  });

  const swapCandidateHashes = new Set<string>(wethByHash.keys());
  txByHash.forEach((txs, hash) => {
    // MetaMask Bridge検出はEthereum(chainId="1")のみ
    if (config.chainId === "1") {
      const hasMetamaskBridgeCall = txs.some(
        (tx) =>
          isOwnAddress(tx.from, ownAddressSet) &&
          isMetaMaskBridgeAddress(tx.to || "")
      );
      if (hasMetamaskBridgeCall) {
        swapCandidateHashes.add(hash);
      }
    }

    const hasWethContractCall = txs.some((tx) => {
      const to = (tx.to || "").toLowerCase();
      const method = (tx.methodId || "").toLowerCase();
      const from = (tx.from || "").toLowerCase();
      const isOwnTx = isOwnAddress(from, ownAddressSet);
      return (
        to === WRAPPED_CONTRACT_ADDRESS &&
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
      (tx) => (tx.to || "").toLowerCase() === WRAPPED_CONTRACT_ADDRESS && weiToEth(tx.value) > 0
    );
    const hasFromWeth = txs.some(
      (tx) => (tx.from || "").toLowerCase() === WRAPPED_CONTRACT_ADDRESS && weiToEth(tx.value) > 0
    );
    if (hasToWeth || hasFromWeth) {
      swapCandidateHashes.add(hash);
    }
  });

  // 自分がトークンを送出しているTXでreceiptがある場合もswap候補に追加
  // （Bridge+DEX: SAND→WETH等、value=0でWMATIC経由しないケース）
  tokenTransfers.forEach((t) => {
    if (!isInYear(t.timeStamp)) return;
    if (isOwnAddress(t.from, ownAddressSet) && !isSpamToken(t, userAddresses)) {
      const hash = t.hash;
      if (receiptsByHash?.[hash.toLowerCase()] && !swapCandidateHashes.has(hash)) {
        swapCandidateHashes.add(hash);
      }
    }
  });

  // DEX Token-to-Token swap検出（swap候補外のトークン間交換）
  // 同一ハッシュで自分がトークンを送出＋受取している場合はDEXスワップ
  const tokenTransfersByHash = new Map<string, EtherscanTokenTransfer[]>();
  tokenTransfers.forEach((t) => {
    if (!isInYear(t.timeStamp)) return;
    const list = tokenTransfersByHash.get(t.hash) || [];
    list.push(t);
    tokenTransfersByHash.set(t.hash, list);
  });

  // receipt logsからDEX出力トークンを検出するためのアドレス→トークン情報マップ
  const tokenInfoByAddress = new Map<string, { symbol: string; decimals: number }>();
  tokenTransfers.forEach((t) => {
    const addr = (t.contractAddress || "").toLowerCase();
    if (addr && !tokenInfoByAddress.has(addr)) {
      tokenInfoByAddress.set(addr, {
        symbol: t.tokenSymbol,
        decimals: parseInt(t.tokenDecimal),
      });
    }
  });
  // Polygon well-known tokens（receipt logsにのみ出現する場合のフォールバック）
  const WELL_KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
    // Polygon well-known tokens
    "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": { symbol: "WETH", decimals: 18 },
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": { symbol: "USDC", decimals: 6 },
    "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": { symbol: "USDC.e", decimals: 6 },
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": { symbol: "USDT", decimals: 6 },
    "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063": { symbol: "DAI", decimals: 18 },
    "0xbbba073c31bf03b8acf7c28ef0738decf3695683": { symbol: "SAND", decimals: 18 },
    "0xc6d54d2f624bc83815b49d9c2203b1330b841ca0": { symbol: "FNCT", decimals: 18 },
    "0x236eec6359fb44cce8f97e99387aa7f8cd5cde1f": { symbol: "JPYC", decimals: 18 },
    // Ethereum well-known tokens
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { symbol: "WETH", decimals: 18 },
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
    "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 },
  };
  Object.entries(WELL_KNOWN_TOKENS).forEach(([addr, info]) => {
    if (!tokenInfoByAddress.has(addr)) {
      tokenInfoByAddress.set(addr, info);
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
          address === WRAPPED_CONTRACT_ADDRESS &&
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
          address === WRAPPED_CONTRACT_ADDRESS &&
          topics.length >= 1 &&
          (topics[0] || "").toLowerCase() === WETH_DEPOSIT_TOPIC.toLowerCase()
        ) {
          const amount = hexToEthAmount(log.data);
          wethDepositAmount += amount;
        }

        // WETH Withdrawal event検出（WETH→ETH）
        if (
          address === WRAPPED_CONTRACT_ADDRESS &&
          topics.length >= 1 &&
          (topics[0] || "").toLowerCase() === WETH_WITHDRAWAL_TOPIC.toLowerCase()
        ) {
          const amount = hexToEthAmount(log.data);
          wethWithdrawalAmount += amount;
        }
      });
    }
    // Receipt logsからDEX出力トークン検出（WMATIC以外のERC20トークンがユーザーに転送されている場合）
    const receiptDexOutputTokens: Array<{ symbol: string; amount: number }> = [];
    // Bridge+DEX: ユーザーには直接届かず、ブリッジコントラクトに最終トークンが送られるケース
    let bridgeDexOutput: { symbol: string; amount: number } | null = null;
    if (receipt && Array.isArray(receipt.logs)) {
      // 最後に見つかった非WMATIC/非ネイティブのERC20 Transfer（非ユーザー宛）を追跡
      let lastBridgeSymbol = "";
      let lastBridgeAmount = 0;

      receipt.logs.forEach((log: any) => {
        const address = (log.address || "").toLowerCase();
        const topics: string[] = log.topics || [];
        if (address === WRAPPED_CONTRACT_ADDRESS) return; // WMATIC/WETHは既存処理で対応済み
        if (
          topics.length >= 3 &&
          (topics[0] || "").toLowerCase() === ERC20_TRANSFER_TOPIC.toLowerCase()
        ) {
          const to = hexToAddress(topics[2]);
          const tokenInfo = tokenInfoByAddress.get(address);
          if (!tokenInfo) return;
          const rawAmount = BigInt(log.data || "0x0");
          const amount = Number(rawAmount) / Math.pow(10, tokenInfo.decimals);
          if (amount <= 0) return;

          if (isOwnAddress(to, ownAddressSet)) {
            receiptDexOutputTokens.push({ symbol: tokenInfo.symbol, amount });
          } else {
            // Bridge+DEX: 最終トークンがブリッジコントラクトへ送られるケース
            // 同一金額が連鎖するので最後のものが最終出力
            lastBridgeSymbol = tokenInfo.symbol;
            lastBridgeAmount = amount;
          }
        }
      });

      // Bridge DEX output: ユーザーに直接届かないが、ブリッジ経由で受取るトークン
      if (lastBridgeSymbol && lastBridgeAmount > 0 && receiptDexOutputTokens.length === 0) {
        bridgeDexOutput = { symbol: lastBridgeSymbol, amount: lastBridgeAmount };
      }
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
      .filter((tx) => (tx.to || "").toLowerCase() === WRAPPED_CONTRACT_ADDRESS)
      .reduce((sum, tx) => sum + weiToEth(tx.value), 0);

    const feeTx =
      txs.find((tx) => isOwnAddress(tx.from, ownAddressSet)) || txs[0];
    const fee = feeTx
      ? (parseFloat(feeTx.gasUsed) * parseFloat(feeTx.gasPrice)) / 1e18
      : 0;
    const timestamp =
      wethTransfers[0]?.timeStamp || feeTx?.timeStamp || internal[0]?.timeStamp || "";
    if (!timestamp || !isInYear(timestamp)) return;

    // DEXスワップ検出: ネイティブトークンを送出し、別のERC20トークンを受取っている場合
    // WMATICのDeposit eventがあっても最終的に別トークン（WETH, USDC等）を受取っていればDEXスワップ
    const hashAllTokenTransfers = tokenTransfersByHash.get(hash) || [];
    const dexOutputTokens = hashAllTokenTransfers.filter((t) => {
      const sym = (t.tokenSymbol || "").toUpperCase();
      return (
        isOwnAddress(t.to, ownAddressSet) &&
        sym !== config.wrappedNativeToken.toUpperCase() &&
        sym !== config.nativeToken.toUpperCase() &&
        !isSpamToken(t, userAddresses)
      );
    });
    const dexInputTokens = hashAllTokenTransfers.filter((t) => {
      const sym = (t.tokenSymbol || "").toUpperCase();
      return (
        isOwnAddress(t.from, ownAddressSet) &&
        sym !== config.wrappedNativeToken.toUpperCase() &&
        sym !== config.nativeToken.toUpperCase() &&
        !isSpamToken(t, userAddresses)
      );
    });

    // Case A: ネイティブトークン → 他のERC20トークンへのDEXスワップ
    if (ethOut > 0 && !nftTransferHashSet.has(hash)) {
      // 1) tokenTransfersから検出
      if (dexOutputTokens.length > 0) {
        const receivedToken = dexOutputTokens[0];
        const receivedAmount =
          parseFloat(receivedToken.value) / Math.pow(10, parseInt(receivedToken.tokenDecimal));
        entries.push({
          取引所名: config.exchangeName,
          "日時（JST）": formatJSTDate(timestamp),
          取引種別: "売買",
          "取引通貨名(+)": receivedToken.tokenSymbol,
          "取引量(+)": receivedAmount,
          "取引通貨名(-)": config.nativeToken,
          "取引量(-)": ethOut,
          取引額時価: "",
          手数料通貨名: fee > 0 ? config.nativeToken : "",
          手数料数量: fee > 0 ? fee : "",
          取引詳細: `DEX swap ${config.nativeToken}→${receivedToken.tokenSymbol} (${hash.slice(0, 10)}...)`,
        });
        markProcessed(hash);
        return;
      }
      // 2) receipt logsから検出（EtherscanのtokentxAPIに含まれないトークン用）
      if (receiptDexOutputTokens.length > 0) {
        const received = receiptDexOutputTokens[0];
        entries.push({
          取引所名: config.exchangeName,
          "日時（JST）": formatJSTDate(timestamp),
          取引種別: "売買",
          "取引通貨名(+)": received.symbol,
          "取引量(+)": received.amount,
          "取引通貨名(-)": config.nativeToken,
          "取引量(-)": ethOut,
          取引額時価: "",
          手数料通貨名: fee > 0 ? config.nativeToken : "",
          手数料数量: fee > 0 ? fee : "",
          取引詳細: `DEX swap ${config.nativeToken}→${received.symbol} (${hash.slice(0, 10)}...)`,
        });
        markProcessed(hash);
        return;
      }
      // 3) Bridge+DEX: ブリッジ経由で別チェーンに最終トークンが送られる場合
      if (bridgeDexOutput) {
        entries.push({
          取引所名: config.exchangeName,
          "日時（JST）": formatJSTDate(timestamp),
          取引種別: "売買",
          "取引通貨名(+)": bridgeDexOutput.symbol,
          "取引量(+)": bridgeDexOutput.amount,
          "取引通貨名(-)": config.nativeToken,
          "取引量(-)": ethOut,
          取引額時価: "",
          手数料通貨名: fee > 0 ? config.nativeToken : "",
          手数料数量: fee > 0 ? fee : "",
          取引詳細: `DEX+Bridge swap ${config.nativeToken}→${bridgeDexOutput.symbol} (${hash.slice(0, 10)}...)`,
        });
        markProcessed(hash);
        return;
      }
    }

    // Case B: ERC20トークン → 他のトークンの売却（例: SAND→WETH）
    if (dexInputTokens.length > 0 && !nftTransferHashSet.has(hash)) {
      // B-1: 受取がtokentx上のDEX出力トークン（Wrapped/Native以外）の場合
      //      例: Polygon上 SAND→WETH（WETHはWrappedNativeTokenではない）
      if (dexOutputTokens.length > 0) {
        const sentToken = dexInputTokens[0];
        const sentAmount =
          parseFloat(sentToken.value) / Math.pow(10, parseInt(sentToken.tokenDecimal));
        const receivedToken = dexOutputTokens[0];
        const receivedAmount =
          parseFloat(receivedToken.value) / Math.pow(10, parseInt(receivedToken.tokenDecimal));
        entries.push({
          取引所名: config.exchangeName,
          "日時（JST）": formatJSTDate(timestamp),
          取引種別: "売買",
          "取引通貨名(+)": receivedToken.tokenSymbol,
          "取引量(+)": receivedAmount,
          "取引通貨名(-)": sentToken.tokenSymbol,
          "取引量(-)": sentAmount,
          取引額時価: "",
          手数料通貨名: fee > 0 ? config.nativeToken : "",
          手数料数量: fee > 0 ? fee : "",
          取引詳細: `DEX swap ${sentToken.tokenSymbol}→${receivedToken.tokenSymbol} (${hash.slice(0, 10)}...)`,
        });
        markProcessed(hash);
        return;
      }
      // B-2: ネイティブ/Wrappedトークンで受取
      if (ethIn > 0 || wethIn > 0) {
        const sentToken = dexInputTokens[0];
        const sentAmount =
          parseFloat(sentToken.value) / Math.pow(10, parseInt(sentToken.tokenDecimal));
        const receivedAmount = ethIn > 0 ? ethIn : wethIn;
        const receivedSymbol = ethIn > 0 ? config.nativeToken : config.wrappedNativeToken;
        entries.push({
          取引所名: config.exchangeName,
          "日時（JST）": formatJSTDate(timestamp),
          取引種別: "売買",
          "取引通貨名(+)": receivedSymbol,
          "取引量(+)": receivedAmount,
          "取引通貨名(-)": sentToken.tokenSymbol,
          "取引量(-)": sentAmount,
          取引額時価: "",
          手数料通貨名: fee > 0 ? config.nativeToken : "",
          手数料数量: fee > 0 ? fee : "",
          取引詳細: `DEX swap ${sentToken.tokenSymbol}→${receivedSymbol} (${hash.slice(0, 10)}...)`,
        });
        markProcessed(hash);
        return;
      }
      // B-3: receipt logsから受取トークン検出（tokentxに含まれない場合）
      if (receiptDexOutputTokens.length > 0) {
        const sentToken = dexInputTokens[0];
        const sentAmount =
          parseFloat(sentToken.value) / Math.pow(10, parseInt(sentToken.tokenDecimal));
        const received = receiptDexOutputTokens[0];
        entries.push({
          取引所名: config.exchangeName,
          "日時（JST）": formatJSTDate(timestamp),
          取引種別: "売買",
          "取引通貨名(+)": received.symbol,
          "取引量(+)": received.amount,
          "取引通貨名(-)": sentToken.tokenSymbol,
          "取引量(-)": sentAmount,
          取引額時価: "",
          手数料通貨名: fee > 0 ? config.nativeToken : "",
          手数料数量: fee > 0 ? fee : "",
          取引詳細: `DEX swap ${sentToken.tokenSymbol}→${received.symbol} (${hash.slice(0, 10)}...)`,
        });
        markProcessed(hash);
        return;
      }
      // B-4: Bridge+DEX: ブリッジ経由で別チェーンに最終トークンが送られる場合
      // ただし入力と出力が同一トークンの場合は単純送付なのでスキップ
      if (bridgeDexOutput && bridgeDexOutput.symbol.toUpperCase() !== dexInputTokens[0].tokenSymbol.toUpperCase()) {
        const sentToken = dexInputTokens[0];
        const sentAmount =
          parseFloat(sentToken.value) / Math.pow(10, parseInt(sentToken.tokenDecimal));
        entries.push({
          取引所名: config.exchangeName,
          "日時（JST）": formatJSTDate(timestamp),
          取引種別: "売買",
          "取引通貨名(+)": bridgeDexOutput.symbol,
          "取引量(+)": bridgeDexOutput.amount,
          "取引通貨名(-)": sentToken.tokenSymbol,
          "取引量(-)": sentAmount,
          取引額時価: "",
          手数料通貨名: fee > 0 ? config.nativeToken : "",
          手数料数量: fee > 0 ? fee : "",
          取引詳細: `DEX+Bridge swap ${sentToken.tokenSymbol}→${bridgeDexOutput.symbol} (${hash.slice(0, 10)}...)`,
        });
        markProcessed(hash);
        return;
      }
    }

    // DEX最終出力トークンが検出されている場合は、wrap/bridge処理にフォールバックしない
    // （Case A/Bで処理されるべき取引がwrap扱いされるのを防止）
    const hasDexFinalOutput = dexOutputTokens.length > 0 || receiptDexOutputTokens.length > 0 || bridgeDexOutput !== null;

    // MetaMask Bridge経由: 出たETHと同量のWETHが入る前提で売買扱い
    const isMetamaskBridgeTx = txs.some(
      (tx) =>
        isOwnAddress(tx.from, ownAddressSet) &&
        isMetaMaskBridgeAddress(tx.to || "")
    );
    if (
      isMetamaskBridgeTx &&
      !nftTransferHashSet.has(hash) &&
      !hasDexFinalOutput &&
      ethOut > 0 &&
      wethIn === 0 &&
      wethOut === 0
    ) {
      const effectiveEthOut =
        ethRefund > 0 && ethOut > ethRefund ? ethOut - ethRefund : ethOut;
      entries.push(
        convertNativeWrappedSwapToEntry(
          hash,
          "NATIVE_TO_WRAPPED",
          timestamp,
          effectiveEthOut,
          effectiveEthOut,
          fee,
          config
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
      !hasDexFinalOutput &&
      wethIn === 0 &&
      wethOut === 0 &&
      ethOut > 0 &&
      ethRefund > 0 &&
      ethOut > ethRefund
    ) {
      const effectiveEthOut = ethOut - ethRefund;
      entries.push(
        convertNativeWrappedSwapToEntry(
          hash,
          "NATIVE_TO_WRAPPED",
          timestamp,
          effectiveEthOut,
          effectiveEthOut,
          fee,
          config
        )
      );
      markProcessed(hash);
      return;
    }

    // Bridge経由などでWETHのERC20受取が見えないケースを補完
    if (
      !nftTransferHashSet.has(hash) &&
      !hasDexFinalOutput &&
      wethIn === 0 &&
      wethOut === 0 &&
      ethOut > 0 &&
      ethToWethContract > 0
    ) {
      entries.push(
        convertNativeWrappedSwapToEntry(
          hash,
          "NATIVE_TO_WRAPPED",
          timestamp,
          ethOut,
          ethToWethContract,
          fee,
          config
        )
      );
      markProcessed(hash);
      return;
    }

    // Wrapped deposit（native -> wrapped）はtransferが欠けるケースがあるためmethodIdでも補完
    const hasWrapCall = txs.some((tx) => {
      const to = (tx.to || "").toLowerCase();
      const method = (tx.methodId || "").toLowerCase();
      return (
        to === WRAPPED_CONTRACT_ADDRESS &&
        (method === "0xd0e30db0" || weiToEth(tx.value) > 0)
      );
    });
    if (hasWrapCall && ethOut > 0 && !hasDexFinalOutput) {
      const wethInOrEstimated = wethIn > 0 ? wethIn : ethOut;
      entries.push(
        convertNativeWrappedSwapToEntry(
          hash,
          "NATIVE_TO_WRAPPED",
          timestamp,
          ethOut,
          wethInOrEstimated,
          fee,
          config
        )
      );
      markProcessed(hash);
      return;
    }

    if (ethOut > 0 && wethIn > 0) {
      entries.push(
        convertNativeWrappedSwapToEntry(hash, "NATIVE_TO_WRAPPED", timestamp, ethOut, wethIn, fee, config)
      );
      markProcessed(hash);
      return;
    }

    if (wethOut > 0 && ethIn > 0) {
      entries.push(
        convertNativeWrappedSwapToEntry(hash, "WRAPPED_TO_NATIVE", timestamp, ethIn, wethOut, fee, config)
      );
      markProcessed(hash);
    }
  });

  // DEX Token-to-Token swap検出（swap候補外のトークン間交換）
  // 同一ハッシュで自分がトークンAを送出＋トークンBを受取している場合はDEXスワップ
  tokenTransfersByHash.forEach((transfers, hash) => {
    if (isProcessed(hash)) return;
    if (nftTransferHashSet.has(hash)) return; // NFT売買は別処理

    const outgoing = transfers.filter(
      (t) => isOwnAddress(t.from, ownAddressSet) && !isSpamToken(t, userAddresses)
    );
    const incoming = transfers.filter(
      (t) => isOwnAddress(t.to, ownAddressSet) && !isSpamToken(t, userAddresses)
    );

    if (outgoing.length === 0 || incoming.length === 0) return;

    // Wrappedトークン同士の自己交換は除外（wrap/unwrap処理済み）
    if (
      outgoing.every((t) => t.tokenSymbol === config.wrappedNativeToken) &&
      incoming.every((t) => t.tokenSymbol === config.wrappedNativeToken)
    ) return;

    // 同一トークンの送受信は除外
    const sentToken = outgoing[0];
    const receivedToken = incoming.find((t) => t.tokenSymbol !== sentToken.tokenSymbol) || incoming[0];
    if (sentToken.tokenSymbol === receivedToken.tokenSymbol) return;

    const sentAmount =
      parseFloat(sentToken.value) / Math.pow(10, parseInt(sentToken.tokenDecimal));
    const receivedAmount =
      parseFloat(receivedToken.value) / Math.pow(10, parseInt(receivedToken.tokenDecimal));
    const fee =
      (parseFloat(sentToken.gasUsed) * parseFloat(sentToken.gasPrice)) / 1e18;

    entries.push({
      取引所名: config.exchangeName,
      "日時（JST）": formatJSTDate(sentToken.timeStamp),
      取引種別: "売買",
      "取引通貨名(+)": receivedToken.tokenSymbol,
      "取引量(+)": receivedAmount,
      "取引通貨名(-)": sentToken.tokenSymbol,
      "取引量(-)": sentAmount,
      取引額時価: "",
      手数料通貨名: fee > 0 ? config.nativeToken : "",
      手数料数量: fee > 0 ? fee : "",
      取引詳細: `DEX swap ${sentToken.tokenSymbol}→${receivedToken.tokenSymbol} (${hash.slice(0, 10)}...)`,
    });
    markProcessed(hash);
  });

  // Receipt-based DEX swap検出: tokentxに受取トークンが含まれないケース
  // 自分がトークンを送出しているが、受取トークンがtokentxに無い場合、receipt logsで補完
  tokenTransfersByHash.forEach((transfers, hash) => {
    if (isProcessed(hash)) return;
    if (nftTransferHashSet.has(hash)) return;

    const outgoing = transfers.filter(
      (t) => isOwnAddress(t.from, ownAddressSet) && !isSpamToken(t, userAddresses)
    );
    if (outgoing.length === 0) return;

    // tokentxに受取トークンがある場合はtoken-to-token検出で処理済み
    const incoming = transfers.filter(
      (t) => isOwnAddress(t.to, ownAddressSet) && !isSpamToken(t, userAddresses)
    );
    if (incoming.length > 0) return;

    // receipt logsから受取トークンを検出
    const receipt = receiptsByHash?.[hash.toLowerCase()];
    if (!receipt || !Array.isArray(receipt.logs)) return;

    const receivedFromReceipt: Array<{ symbol: string; amount: number }> = [];
    receipt.logs.forEach((log: any) => {
      const address = (log.address || "").toLowerCase();
      const topics: string[] = log.topics || [];
      if (address === WRAPPED_CONTRACT_ADDRESS) return;
      if (
        topics.length >= 3 &&
        (topics[0] || "").toLowerCase() === ERC20_TRANSFER_TOPIC.toLowerCase()
      ) {
        const to = hexToAddress(topics[2]);
        if (isOwnAddress(to, ownAddressSet)) {
          const tokenInfo = tokenInfoByAddress.get(address);
          if (tokenInfo) {
            const rawAmount = BigInt(log.data || "0x0");
            const amount = Number(rawAmount) / Math.pow(10, tokenInfo.decimals);
            if (amount > 0) {
              receivedFromReceipt.push({ symbol: tokenInfo.symbol, amount });
            }
          }
        }
      }
    });

    if (receivedFromReceipt.length === 0) return;

    const sentToken = outgoing[0];
    if (!isInYear(sentToken.timeStamp)) return;
    const sentAmount =
      parseFloat(sentToken.value) / Math.pow(10, parseInt(sentToken.tokenDecimal));
    const received = receivedFromReceipt[0];
    const fee =
      (parseFloat(sentToken.gasUsed) * parseFloat(sentToken.gasPrice)) / 1e18;

    entries.push({
      取引所名: config.exchangeName,
      "日時（JST）": formatJSTDate(sentToken.timeStamp),
      取引種別: "売買",
      "取引通貨名(+)": received.symbol,
      "取引量(+)": received.amount,
      "取引通貨名(-)": sentToken.tokenSymbol,
      "取引量(-)": sentAmount,
      取引額時価: "",
      手数料通貨名: fee > 0 ? config.nativeToken : "",
      手数料数量: fee > 0 ? fee : "",
      取引詳細: `DEX swap ${sentToken.tokenSymbol}→${received.symbol} (${hash.slice(0, 10)}...)`,
    });
    markProcessed(hash);
  });

  // 通常トランザクション
  transactions.forEach((tx) => {
    const txHash = tx.hash;

    // デバッグ用: 特定のBurnトランザクションをログ出力
    const isBurnHash =
      txHash.toLowerCase() === "0xc41e335893334906fbc4e6d94454cceb0f18f72955b30a219ecacee6210f8e18" ||
      txHash.toLowerCase() === "0x7be15b654ca8ec92bf55650f985626d0f87b31e8d044fab452c1a25a1529a4d2";

    if (isBurnHash) {
      console.log(`\n🔥 Burn候補検出: ${txHash}`);
      console.log(`  isInYear: ${isInYear(tx.timeStamp)}`);
      console.log(`  isProcessed: ${isProcessed(txHash)}`);
    }

    if (isInYear(tx.timeStamp) && !isProcessed(tx.hash)) {
      // ルールモジュールによる分類評価
      const hashNftTransfers = nftTransfers.filter((nft) => nft.hash === txHash);
      const hashErc1155Transfers = erc1155.filter((nft) => nft.hash === txHash);
      const allHashNftTransfers = [...hashNftTransfers, ...hashErc1155Transfers];
      const hashTokenTransfers = tokenTransfers.filter((token) => token.hash === txHash);
      const hashInternalTxs = internalByHash.get(txHash) || [];

      if (isBurnHash) {
        console.log(`  NFT transfers found: ${allHashNftTransfers.length}`);
        allHashNftTransfers.forEach((nft, i) => {
          console.log(`    [${i}] ${nft.tokenName}#${nft.tokenID}`);
          console.log(`        from: ${nft.from}`);
          console.log(`        to: ${nft.to}`);
        });
      }

      const ruleContext: RuleContext = {
        tx,
        nftTransfers: allHashNftTransfers,
        tokenTransfers: hashTokenTransfers,
        internalTxs: hashInternalTxs,
        ownAddresses: ownAddressSet,
        txHash,
      };

      const ruleResult = evaluateClassificationRules(ruleContext);

      if (isBurnHash) {
        console.log(`  ルール評価結果: ${ruleResult.type || 'null'}`);
        if (ruleResult.reason) {
          console.log(`  理由: ${ruleResult.reason}`);
        }
      }

      if (ruleResult.type) {
        // ルールにマッチした場合
        const fee = (parseFloat(tx.gasUsed) * parseFloat(tx.gasPrice)) / 1e18;

        if (ruleResult.type === "減少" && allHashNftTransfers.length > 0) {
          // NFT焼却の場合: NFT資産を減少させる
          allHashNftTransfers.forEach((nft) => {
            const nftName = `${nft.tokenName || "NFT"}#${nft.tokenID}`;
            entries.push({
              取引所名: config.exchangeName,
              "日時（JST）": formatJSTDate(tx.timeStamp),
              取引種別: "減少",
              "取引通貨名(+)": "",
              "取引量(+)": "",
              "取引通貨名(-)": `NFT資産${nftName}`,
              "取引量(-)": parseFloat(nft.tokenValue || "1"),
              取引額時価: "",
              手数料通貨名: config.nativeToken,
              手数料数量: fee / allHashNftTransfers.length, // ガス代を均等分割
              取引詳細: ruleResult.reason || "",
            });
          });
        } else {
          // その他のルール（手数料等）
          entries.push({
            取引所名: config.exchangeName,
            "日時（JST）": formatJSTDate(tx.timeStamp),
            取引種別: ruleResult.type,
            "取引通貨名(+)": "",
            "取引量(+)": "",
            "取引通貨名(-)": "",
            "取引量(-)": "",
            取引額時価: "",
            手数料通貨名: config.nativeToken,
            手数料数量: fee,
            取引詳細: ruleResult.reason || "",
          });
        }

        markProcessed(txHash);

        if (ruleResult.skipDefault) {
          return; // 既存ロジックをスキップ
        }
      }

      // 既存ロジック継続
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
            address === WRAPPED_CONTRACT_ADDRESS &&
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
            address === WRAPPED_CONTRACT_ADDRESS &&
            topics.length >= 1 &&
            (topics[0] || "").toLowerCase() === WETH_DEPOSIT_TOPIC.toLowerCase()
          ) {
            hasWethDepositInReceipt = true;
            wethDepositAmountInReceipt += hexToEthAmount(log.data);
          }
        });
      }

      // WETH Deposit event検出による売買判定
      // ただし、receipt logsにWrappedNativeToken以外の最終出力トークンがある場合は
      // DEXスワップの中間ステップとしてのwrapなので、ここではスキップ
      {
        const txReceiptDexOutput: Array<{ symbol: string; amount: number }> = [];
        let txBridgeDexOutput: { symbol: string; amount: number } | null = null;
        if (receipt && Array.isArray(receipt.logs)) {
          let lastBridgeSymbol = "";
          let lastBridgeAmount = 0;
          receipt.logs.forEach((log: any) => {
            const addr = (log.address || "").toLowerCase();
            const topics: string[] = log.topics || [];
            if (addr === WRAPPED_CONTRACT_ADDRESS) return;
            if (
              topics.length >= 3 &&
              (topics[0] || "").toLowerCase() === ERC20_TRANSFER_TOPIC.toLowerCase()
            ) {
              const to = hexToAddress(topics[2]);
              const tokenInfo = tokenInfoByAddress.get(addr);
              if (!tokenInfo) return;
              const rawAmount = BigInt(log.data || "0x0");
              const amount = Number(rawAmount) / Math.pow(10, tokenInfo.decimals);
              if (amount <= 0) return;

              if (isOwnAddress(to, ownAddressSet)) {
                txReceiptDexOutput.push({ symbol: tokenInfo.symbol, amount });
              } else {
                lastBridgeSymbol = tokenInfo.symbol;
                lastBridgeAmount = amount;
              }
            }
          });
          if (lastBridgeSymbol && lastBridgeAmount > 0 && txReceiptDexOutput.length === 0) {
            txBridgeDexOutput = { symbol: lastBridgeSymbol, amount: lastBridgeAmount };
          }
        }

        if (txReceiptDexOutput.length > 0 && isOutgoing && txValue > 0 && !hasNftOnHash) {
          // DEXスワップ: ネイティブトークン→最終出力トークン（wrapは中間ステップ）
          const received = txReceiptDexOutput[0];
          const fee = (parseFloat(tx.gasUsed) * parseFloat(tx.gasPrice)) / 1e18;
          entries.push({
            取引所名: config.exchangeName,
            "日時（JST）": formatJSTDate(tx.timeStamp),
            取引種別: "売買",
            "取引通貨名(+)": received.symbol,
            "取引量(+)": received.amount,
            "取引通貨名(-)": config.nativeToken,
            "取引量(-)": txValue,
            取引額時価: "",
            手数料通貨名: fee > 0 ? config.nativeToken : "",
            手数料数量: fee > 0 ? fee : "",
            取引詳細: `DEX swap ${config.nativeToken}→${received.symbol} (${txHash.slice(0, 10)}...)`,
          });
          markProcessed(txHash);
          return;
        }

        // Bridge+DEX: ネイティブトークン→ブリッジ経由で別チェーンにトークン送付
        if (txBridgeDexOutput && isOutgoing && txValue > 0 && !hasNftOnHash) {
          const fee = (parseFloat(tx.gasUsed) * parseFloat(tx.gasPrice)) / 1e18;
          entries.push({
            取引所名: config.exchangeName,
            "日時（JST）": formatJSTDate(tx.timeStamp),
            取引種別: "売買",
            "取引通貨名(+)": txBridgeDexOutput.symbol,
            "取引量(+)": txBridgeDexOutput.amount,
            "取引通貨名(-)": config.nativeToken,
            "取引量(-)": txValue,
            取引額時価: "",
            手数料通貨名: fee > 0 ? config.nativeToken : "",
            手数料数量: fee > 0 ? fee : "",
            取引詳細: `DEX+Bridge swap ${config.nativeToken}→${txBridgeDexOutput.symbol} (${txHash.slice(0, 10)}...)`,
          });
          markProcessed(txHash);
          return;
        }

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
            convertNativeWrappedSwapToEntry(
              txHash,
              "NATIVE_TO_WRAPPED",
              tx.timeStamp,
              effectiveEthAmount,
              wethDepositAmountInReceipt,
              fee,
              config
            )
          );
          markProcessed(txHash);
          return;
        }
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
          convertNativeWrappedSwapToEntry(
            txHash,
            "NATIVE_TO_WRAPPED",
            tx.timeStamp,
            txValue,
            txValue - ethRefund,
            fee,
            config
          )
        );
        markProcessed(txHash);
        return;
      }

      // value=0の手数料のみTXで、同一hashにトークン送出がある場合は
      // DEXスワップの一部（approve/swap call）の可能性が高いためスキップ
      // （tokenTransfer側でDEXスワップとして処理させる）
      if (txValue === 0) {
        const hashHasTokenOut = tokenTransfers.some(
          (t) => t.hash === txHash && isOwnAddress(t.from, ownAddressSet) && !isSpamToken(t, userAddresses)
        );
        if (hashHasTokenOut) {
          // DEXスワップの手数料はtokenTransfer側で計上されるためスキップ
          return;
        }
      }

      const entry = convertTransactionToEntry(tx, userAddresses, config);
      if (entry) {
        entries.push(entry);
      }
    }
  });

  // トークン転送（NFT売買以外）
  // ボーナス判定: 自分がTXを発信していない受取はボーナス（エアドロップ/報酬）
  tokenTransfers.forEach((transfer) => {
    if (isInYear(transfer.timeStamp) && !isProcessed(transfer.hash)) {
      const entry = convertTokenTransferToEntry(transfer, userAddresses, config);
      if (entry) {
        if (entry.取引種別 === "受取" && !ownInitiatedTxHashes.has(transfer.hash)) {
          entry.取引種別 = "ボーナス";
        }
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
      const entry = convertNFTTransferToEntry(transfer, userAddresses, config);
      if (entry) {
        if (entry.取引種別 === "受取" && !ownInitiatedTxHashes.has(transfer.hash)) {
          entry.取引種別 = "ボーナス";
        }
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
      const entry = convertNFTTransferToEntry(transfer, userAddresses, config);
      if (entry) {
        if (entry.取引種別 === "受取" && !ownInitiatedTxHashes.has(transfer.hash)) {
          entry.取引種別 = "ボーナス";
        }
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
