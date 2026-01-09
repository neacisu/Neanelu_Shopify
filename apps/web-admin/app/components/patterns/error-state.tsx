import { PolarisBanner } from '../../../components/polaris/index.js';
import { Button } from '../ui/button';

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <PolarisBanner status="critical">
      <div className="flex flex-col gap-3">
        <div className="text-body text-foreground/90">{message}</div>
        {onRetry ? (
          <div>
            <Button variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    </PolarisBanner>
  );
}
