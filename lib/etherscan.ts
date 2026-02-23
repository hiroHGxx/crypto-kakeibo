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
}
