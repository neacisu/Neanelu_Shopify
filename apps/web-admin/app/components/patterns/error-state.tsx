import { PolarisBanner, PolarisButton } from '../../../components/polaris/index.js';

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <PolarisBanner status="critical">
      <div className="flex flex-col gap-3">
        <div className="text-body text-foreground/90">{message}</div>
        {onRetry ? (
          <div>
            <PolarisButton onClick={onRetry}>Retry</PolarisButton>
          </div>
        ) : null}
      </div>
    </PolarisBanner>
  );
}
