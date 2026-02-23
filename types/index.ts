// Etherscan API レスポンス型定義
export interface EtherscanTransaction {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  isError: string;
  methodId: string;
  contractAddress?: string;
}

export interface EtherscanTokenTransfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  contractAddress: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
}

export interface EtherscanNFTTransfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  tokenID: string;
  tokenName: string;
  tokenSymbol: string;
  contractAddress: string;
  tokenValue?: string; // ERC-1155のみ（数量）
  gas?: string;
  gasPrice?: string;
  gasUsed?: string;
}

// 会計ソフト用フォーマット
export interface AccountingEntry {
  取引所名: string;
  "日時（JST）": string;
  取引種別: string;
  "取引通貨名(+)": string;
  "取引量(+)": number | string;
  "取引通貨名(-)": string;
  "取引量(-)": number | string;
  取引額時価: string;
  手数料通貨名: string;
  手数料数量: number | string;
  取引詳細?: string;
  要確認?: string;
  推奨取引種別?: string;
  確認理由?: string;
}

export interface ProcessedTransaction {
  hash: string;
  timestamp: number;
  from: string;
  to: string;
  value: string;
  fee: string;
  type: 'transaction' | 'token' | 'nft';
  tokenName?: string;
  tokenSymbol?: string;
  isNFT?: boolean;
}
