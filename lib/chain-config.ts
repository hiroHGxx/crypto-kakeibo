/**
 * マルチチェーン対応の設定モジュール
 *
 * チェーン固有の値（ネイティブトークン名、Wrappedトークンアドレス等）を集約し、
 * 既存のETHロジックをパラメータ化する。
 */

export interface ChainConfig {
  chainId: string;
  name: string; // "Ethereum" | "Polygon" | "BSC"
  nativeToken: string; // "ETH" | "POL" | "BNB"
  wrappedNativeToken: string; // "WETH" | "WMATIC" | "WBNB"
  wrappedNativeAddress: string; // コントラクトアドレス
  exchangeName: string; // "metamask" | "metamask(polygon)" | "metamask(bsc)"
  apiBaseUrl: string; // API エンドポイント
  apiKeyEnv: string; // APIキーの環境変数名
  useChainIdParam: boolean; // Etherscan v2形式(chainidパラメータ付き)か、レガシーAPI形式か
}

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  "1": {
    chainId: "1",
    name: "Ethereum",
    nativeToken: "ETH",
    wrappedNativeToken: "WETH",
    wrappedNativeAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    exchangeName: "metamask",
    apiBaseUrl: "https://api.etherscan.io/v2/api",
    apiKeyEnv: "NEXT_PUBLIC_ETHERSCAN_API_KEY",
    useChainIdParam: true,
  },
  "137": {
    chainId: "137",
    name: "Polygon",
    nativeToken: "POL",
    wrappedNativeToken: "WMATIC",
    wrappedNativeAddress: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    exchangeName: "metamask(polygon)",
    apiBaseUrl: "https://api.etherscan.io/v2/api",
    apiKeyEnv: "NEXT_PUBLIC_ETHERSCAN_API_KEY",
    useChainIdParam: true,
  },
  "56": {
    chainId: "56",
    name: "BSC",
    nativeToken: "BNB",
    wrappedNativeToken: "WBNB",
    wrappedNativeAddress: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    exchangeName: "metamask(bsc)",
    // BscScan独自API（Etherscan v2無料プランはBSC非対応のため）
    apiBaseUrl: "https://api.bscscan.com/api",
    apiKeyEnv: "NEXT_PUBLIC_BSCSCAN_API_KEY",
    useChainIdParam: false,
  },
};

// API取得対象のチェーン。BSCはEtherscan v2無料プラン非対応のため、
// 別途Excelインポートでデータを取り込む（lib/excel-importer.ts）。
export const SUPPORTED_CHAIN_IDS = ["1", "137"];

// 共通イベントトピック定数
export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const WETH_DEPOSIT_TOPIC =
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";
export const WETH_WITHDRAWAL_TOPIC =
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";

export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

export function getChainConfig(chainId: string): ChainConfig {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return config;
}
