import { checkBudget, type ApiProvider, type UnifiedBudgetStatus } from './cost-tracker.js';

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export type BudgetGuardHooks = Readonly<{
  onWarning?: (status: UnifiedBudgetStatus & { shopId: string }) => Promise<void> | void;
  onExceeded?: (status: UnifiedBudgetStatus & { shopId: string }) => Promise<void> | void;
}>;

let globalHooks: BudgetGuardHooks = {};

export function registerBudgetGuardHooks(hooks: BudgetGuardHooks): void {
  globalHooks = hooks;
}

export async function enforceBudget(params: {
  provider: ApiProvider;
  shopId: string;
  hooks?: BudgetGuardHooks;
}): Promise<UnifiedBudgetStatus> {
  const status = await checkBudget(params.provider, params.shopId);
  const statusWithShop = { ...status, shopId: params.shopId } as const;
  const mergedHooks: BudgetGuardHooks = {
    ...globalHooks,
    ...(params.hooks ?? {}),
  };

  if (status.alertTriggered) {
    await mergedHooks.onWarning?.(statusWithShop);
  }

  if (status.exceeded) {
    await mergedHooks.onExceeded?.(statusWithShop);
    throw new BudgetExceededError(
      `${params.provider} budget exceeded: ${status.primary.used}/${status.primary.limit} ${status.primary.unit}`
    );
  }

  return status;
}
