/** @deprecated use flashOwnedOutputFirewall.ts */
export {
  buildPrimaryModelFlashFirewallBlock as buildOpenRouterServerUiDelegationBlock,
  PRIMARY_MODEL_FLASH_OWNED_BLOCK,
} from "@/lib/flashOwnedOutputFirewall";

export type OpenRouterServerUiDelegationOpts = {
  htmlFlashEnabled: boolean;
  statusWindowEveryTurn: boolean;
};

export function openRouterServerUiDelegationActive(_opts?: OpenRouterServerUiDelegationOpts): boolean {
  return true;
}
