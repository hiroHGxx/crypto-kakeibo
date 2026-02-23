import {
  EtherscanTransaction,
  EtherscanTokenTransfer,
  EtherscanNFTTransfer,
} from "@/types";

const ETHERSCAN_API_BASE = "https://api.etherscan.io/v2/api";

export class EtherscanAPI {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    items.forEach((item) => {
      const key = keyFn(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    });
    return result;
  }

  private async fetchAPI(params: Record<string, string>) {
    const url = new URL(ETHERSCAN_API_BASE);
    url.searchParams.append("chainid", "1"); // Ethereum Mainnet
    url.searchParams.append("apikey", this.apiKey);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    console.log("Fetching:", url.toString());
    const response = await fetch(url.toString());
    const data = await response.json();
    console.log("Response:", JSON.stringify(data, null, 2));

    if (data.status !== "1") {
      throw new Error(data.message || data.result || "Etherscan API error");
    }

    return data.result;
  }

  private async fetchProxy(params: Record<string, string>) {
    const url = new URL(ETHERSCAN_API_BASE);
    url.searchParams.append("chainid", "1"); // Ethereum Mainnet
    url.searchParams.append("apikey", this.apiKey);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    const response = await fetch(url.toString());
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || "Etherscan proxy API error");
    }
    return data.result || null;
  }

  // 通常のトランザクション取得
  async getTransactions(
    address: string,
    startblock = "0",
    endblock = "99999999"
  ): Promise<EtherscanTransaction[]> {
    return this.fetchAPI({
      module: "account",
      action: "txlist",
      address,
      startblock,
      endblock,
      sort: "asc",
    });
  }

  // Internal Transaction取得
  async getInternalTransactions(
    address: string,
    startblock = "0",
    endblock = "99999999"
  ): Promise<EtherscanTransaction[]> {
    return this.fetchAPI({
      module: "account",
      action: "txlistinternal",
      address,
      startblock,
      endblock,
      sort: "asc",
    });
  }

  // ERC20トークン転送取得
  async getTokenTransfers(
    address: string,
    startblock = "0",
    endblock = "99999999"
  ): Promise<EtherscanTokenTransfer[]> {
    return this.fetchAPI({
      module: "account",
      action: "tokentx",
      address,
      startblock,
      endblock,
      sort: "asc",
    });
  }

  // ERC721 NFT転送取得
  async getNFTTransfers(
    address: string,
    startblock = "0",
    endblock = "99999999"
  ): Promise<EtherscanNFTTransfer[]> {
    return this.fetchAPI({
      module: "account",
      action: "tokennfttx",
      address,
      startblock,
      endblock,
      sort: "asc",
    });
  }

  // ERC1155 NFT転送取得
  async getERC1155Transfers(
    address: string,
    startblock = "0",
    endblock = "99999999"
  ): Promise<EtherscanNFTTransfer[]> {
    return this.fetchAPI({
      module: "account",
      action: "token1155tx",
      address,
      startblock,
      endblock,
      sort: "asc",
    });
  }

  // 全データ取得（レート制限対策で順次実行）
  // 注：年指定は無視して全データ取得し、後でフィルタリングする
  async getAllTransactions(address: string, year?: number) {
    const startblock = "0";
    const endblock = "99999999";

    // レート制限対策：順次実行（3req/secの制限に対応）
    const transactions = await this.getTransactions(address, startblock, endblock);
    await new Promise(resolve => setTimeout(resolve, 400)); // 0.4秒待機

    const internalTxs = await this.getInternalTransactions(address, startblock, endblock);
    await new Promise(resolve => setTimeout(resolve, 400));

    const tokenTransfers = await this.getTokenTransfers(address, startblock, endblock);
    await new Promise(resolve => setTimeout(resolve, 400));

    const nftTransfers = await this.getNFTTransfers(address, startblock, endblock);
    await new Promise(resolve => setTimeout(resolve, 400));

    const erc1155Transfers = await this.getERC1155Transfers(address, startblock, endblock);

    return {
      transactions,
      internalTxs,
      tokenTransfers,
      nftTransfers,
      erc1155Transfers,
    };
  }

  // 複数アドレスの全データ取得（自己ウォレット間移動判定用）
  async getAllTransactionsForAddresses(addresses: string[], year?: number) {
    const normalized = [...new Set(addresses.map((address) => address.toLowerCase()))];
    const all = {
      transactions: [] as EtherscanTransaction[],
      internalTxs: [] as EtherscanTransaction[],
      tokenTransfers: [] as EtherscanTokenTransfer[],
      nftTransfers: [] as EtherscanNFTTransfer[],
      erc1155Transfers: [] as EtherscanNFTTransfer[],
    };

    for (const address of normalized) {
      const data = await this.getAllTransactions(address, year);
      all.transactions.push(...data.transactions);
      all.internalTxs.push(...data.internalTxs);
      all.tokenTransfers.push(...data.tokenTransfers);
      all.nftTransfers.push(...data.nftTransfers);
      all.erc1155Transfers.push(...data.erc1155Transfers);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const transactions = this.uniqueBy(
      all.transactions,
      (tx) => `${tx.hash}:${tx.from}:${tx.to}:${tx.value}:${tx.timeStamp}`
    ).sort((a, b) => parseInt(a.timeStamp) - parseInt(b.timeStamp));

    const internalTxs = this.uniqueBy(
      all.internalTxs,
      (tx) => `${tx.hash}:${tx.from}:${tx.to}:${tx.value}:${tx.timeStamp}`
    ).sort((a, b) => parseInt(a.timeStamp) - parseInt(b.timeStamp));

    const tokenTransfers = this.uniqueBy(
      all.tokenTransfers,
      (tx) =>
        `${tx.hash}:${tx.from}:${tx.to}:${tx.contractAddress}:${tx.value}:${tx.tokenSymbol}:${tx.timeStamp}`
    ).sort((a, b) => parseInt(a.timeStamp) - parseInt(b.timeStamp));

    const nftTransfers = this.uniqueBy(
      all.nftTransfers,
      (tx) =>
        `${tx.hash}:${tx.from}:${tx.to}:${tx.contractAddress}:${tx.tokenID}:${tx.timeStamp}`
    ).sort((a, b) => parseInt(a.timeStamp) - parseInt(b.timeStamp));

    const erc1155Transfers = this.uniqueBy(
      all.erc1155Transfers,
      (tx) =>
        `${tx.hash}:${tx.from}:${tx.to}:${tx.contractAddress}:${tx.tokenID}:${tx.tokenValue || ""}:${tx.timeStamp}`
    ).sort((a, b) => parseInt(a.timeStamp) - parseInt(b.timeStamp));

    return {
      transactions,
      internalTxs,
      tokenTransfers,
      nftTransfers,
      erc1155Transfers,
    };
  }

  async getTransactionReceipt(txHash: string) {
    return this.fetchProxy({
      module: "proxy",
      action: "eth_getTransactionReceipt",
      txhash: txHash,
    });
  }

  async getTransactionReceipts(txHashes: string[]) {
    const receipts: Record<string, any> = {};
    for (const txHash of txHashes) {
      const normalized = txHash.toLowerCase();
      try {
        const receipt = await this.getTransactionReceipt(normalized);
        if (receipt) {
          receipts[normalized] = receipt;
        }
      } catch (error) {
        console.warn(`Failed to fetch receipt for ${normalized}`, error);
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return receipts;
  }
}
