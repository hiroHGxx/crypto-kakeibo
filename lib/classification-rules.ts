/**
 * 取引分類ルールモジュール
 *
 * 新しい分類ルールを追加する場合は、classificationRules配列に追加してください。
 * 優先度（priority）が低いほど先に評価されます。
 */

import {
  EtherscanTransaction,
  EtherscanTokenTransfer,
  EtherscanNFTTransfer,
} from "@/types";
import { type ChainConfig, NULL_ADDRESS } from "./chain-config";

export interface RuleContext {
  tx: EtherscanTransaction;
  nftTransfers: EtherscanNFTTransfer[];
  tokenTransfers: EtherscanTokenTransfer[];
  internalTxs: EtherscanTransaction[];
  ownAddresses: Set<string>;
  txHash: string;
  chainConfig?: ChainConfig;
}

export interface ClassificationResult {
  type: "減少" | "送付" | "受取" | "売買" | "手数料" | "ボーナス" | null;
  reason?: string;
  skipDefault?: boolean; // trueの場合、既存ロジックをスキップ
}

interface ClassificationRule {
  id: string;
  description: string;
  priority: number; // 低いほど優先（0が最優先）
  check: (context: RuleContext) => boolean;
  action: (context: RuleContext) => ClassificationResult;
}

/**
 * 分類ルール定義
 *
 * 優先度順に評価され、最初にマッチしたルールが適用されます。
 */
export const classificationRules: ClassificationRule[] = [
  // ルール1: NFT焼却（Nullアドレスへの送付）
  {
    id: "nft-burn-to-null",
    description: "NFTをNullアドレスに送付（焼却）→ 減少",
    priority: 10,
    check: (ctx) => {
      // NFT転送がある
      if (ctx.nftTransfers.length === 0) return false;

      // 自分が送信元で、送信先がNullアドレス
      return ctx.nftTransfers.some((transfer) => {
        const from = (transfer.from || "").toLowerCase();
        const to = (transfer.to || "").toLowerCase();
        return (
          ctx.ownAddresses.has(from) &&
          to === NULL_ADDRESS
        );
      });
    },
    action: (ctx) => {
      const burnedNfts = ctx.nftTransfers.filter((transfer) => {
        const from = (transfer.from || "").toLowerCase();
        const to = (transfer.to || "").toLowerCase();
        return ctx.ownAddresses.has(from) && to === NULL_ADDRESS;
      });

      const nftNames = burnedNfts
        .map((nft) => `${nft.tokenName || "NFT"}#${nft.tokenID}`)
        .join(", ");

      return {
        type: "減少",
        reason: `NFT焼却（${nftNames} → Nullアドレス）`,
        skipDefault: true,
      };
    },
  },

  // ルール2: 自己ウォレット間のETH送金
  {
    id: "self-wallet-eth-transfer",
    description: "自己ウォレット間のETH送金 → 手数料（ガス代のみ）",
    priority: 20,
    check: (ctx) => {
      const from = (ctx.tx.from || "").toLowerCase();
      const to = (ctx.tx.to || "").toLowerCase();
      const value = parseFloat(ctx.tx.value || "0");

      // ETHの送付があり、送信元・送信先ともに自己ウォレット
      return (
        value > 0 &&
        ctx.ownAddresses.has(from) &&
        ctx.ownAddresses.has(to) &&
        ctx.nftTransfers.length === 0 && // NFT送付ではない
        ctx.tokenTransfers.length === 0 // トークン送付ではない
      );
    },
    action: (ctx) => ({
      type: "手数料",
      reason: "自己ウォレット間送金（送金履歴不要・ガス代のみ）",
      skipDefault: true,
    }),
  },

  // ルール3: 自己ウォレット間のNFT送金
  {
    id: "self-wallet-nft-transfer",
    description: "自己ウォレット間のNFT送金 → 手数料（ガス代のみ）",
    priority: 21,
    check: (ctx) => {
      if (ctx.nftTransfers.length === 0) return false;

      // すべてのNFT転送が自己ウォレット間
      return ctx.nftTransfers.every((transfer) => {
        const from = (transfer.from || "").toLowerCase();
        const to = (transfer.to || "").toLowerCase();
        return ctx.ownAddresses.has(from) && ctx.ownAddresses.has(to);
      });
    },
    action: (ctx) => {
      const nftNames = ctx.nftTransfers
        .map((nft) => `${nft.tokenName || "NFT"}#${nft.tokenID}`)
        .join(", ");

      return {
        type: "手数料",
        reason: `自己ウォレット間NFT送金（${nftNames}）`,
        skipDefault: true,
      };
    },
  },

  // 今後追加予定のルール例（コメントアウト）:
  /*
  {
    id: "staking-deposit",
    description: "Staking contract への入金 → 預入",
    priority: 30,
    check: (ctx) => {
      // Staking contractアドレスのリスト
      const stakingContracts = [
        "0x...", // 例: Lido
        "0x...", // 例: Rocket Pool
      ];
      return stakingContracts.includes(ctx.tx.to?.toLowerCase() || "");
    },
    action: () => ({ type: "預入", reason: "Staking入金" }),
  },
  */
];

/**
 * ルール評価エンジン
 *
 * @param context ルール評価に必要なコンテキスト
 * @returns マッチしたルールの結果、またはnull
 */
export function evaluateClassificationRules(
  context: RuleContext
): ClassificationResult {
  // 優先度順にソート
  const sortedRules = [...classificationRules].sort(
    (a, b) => a.priority - b.priority
  );

  // 最初にマッチしたルールを適用
  for (const rule of sortedRules) {
    try {
      if (rule.check(context)) {
        const result = rule.action(context);
        console.log(
          `✅ ルール適用 [${rule.id}]: ${rule.description}`,
          `→ ${result.type}`,
          result.reason ? `(${result.reason})` : ""
        );
        return result;
      }
    } catch (error) {
      console.error(`❌ ルール評価エラー [${rule.id}]:`, error);
    }
  }

  // ルールにマッチしない場合
  return { type: null };
}

/**
 * ルール一覧を取得（デバッグ・ドキュメント用）
 */
export function listRules(): Array<{
  id: string;
  description: string;
  priority: number;
}> {
  return classificationRules
    .sort((a, b) => a.priority - b.priority)
    .map((rule) => ({
      id: rule.id,
      description: rule.description,
      priority: rule.priority,
    }));
}
