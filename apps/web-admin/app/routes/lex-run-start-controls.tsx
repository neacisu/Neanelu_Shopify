import { useState } from 'react';
import type { LexRunSummary } from '@app/types';
import { Button } from '../components/ui/button';
import {
  LEX_UI_START_RUN_TYPES,
  lexRunTypeUiLabel,
  type LexUiStartRunType,
} from './lex-run-start-ui';

export function LexRunStartControls(props: {
  canManageSettings: boolean;
  startingRun: boolean;
  onStart: (runType: LexRunSummary['runType']) => Promise<void>;
  /** `sm` for tab toolbar, default for hero card */
  density?: 'sm' | 'default';
}) {
  const { canManageSettings, startingRun, onStart, density = 'default' } = props;
  const [runType, setRunType] = useState<LexUiStartRunType>('delta_rebuild');
  const disabled = startingRun || !canManageSettings;
  const selectCls =
    density === 'sm'
      ? 'min-w-[14rem] rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground'
      : 'min-w-[16rem] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="lex-run-type-select">
        Tip run lexical
      </label>
      <select
        id="lex-run-type-select"
        className={selectCls}
        value={runType}
        disabled={disabled}
        aria-label="Tip run lexical"
        onChange={(e) => setRunType(e.target.value as LexUiStartRunType)}
      >
        {LEX_UI_START_RUN_TYPES.map((t) => (
          <option key={t} value={t}>
            {lexRunTypeUiLabel(t)}
          </option>
        ))}
      </select>
      <Button
        size={density === 'sm' ? 'sm' : 'md'}
        disabled={disabled}
        title={
          !canManageSettings
            ? 'Pornire run necesită permisiune de scriere setări / operare pipeline.'
            : undefined
        }
        onClick={() => void onStart(runType)}
      >
        {startingRun ? 'Pornesc…' : 'Start run'}
      </Button>
    </div>
  );
}
