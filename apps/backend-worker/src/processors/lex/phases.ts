import {
  LEX_AGGREGATE_STATS_QUEUE_NAME,
  LEX_BUILD_CONTEXTS_QUEUE_NAME,
  LEX_CLUSTER_SENSES_QUEUE_NAME,
  LEX_COMPOSE_LOCALIZATIONS_QUEUE_NAME,
  LEX_EMBED_CONTEXTS_QUEUE_NAME,
  LEX_EXTRACT_ENTITIES_QUEUE_NAME,
  LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
  LEX_MINE_TERMS_QUEUE_NAME,
  LEX_PUBLISH_QUEUE_NAME,
  LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME,
  LEX_REVIEW_ENQUEUE_QUEUE_NAME,
  LEX_TRANSLATE_CANDIDATES_QUEUE_NAME,
} from '../../queue/lex-queues.js';

export const LEX_PHASE_ORDER = [
  'extract.fragments',
  'extract.entities',
  'mine.terms',
  'aggregate.stats',
  'build.contexts',
  'embed.contexts',
  'cluster.senses',
  'resolve.attributes',
  'translate.candidates',
  'compose.localizations',
  'review.enqueue',
  'publish',
] as const;

export type LexPhaseName = (typeof LEX_PHASE_ORDER)[number];

export const LEX_PHASE_TO_QUEUE: Readonly<Record<LexPhaseName, string>> = {
  'extract.fragments': LEX_EXTRACT_FRAGMENTS_QUEUE_NAME,
  'extract.entities': LEX_EXTRACT_ENTITIES_QUEUE_NAME,
  'mine.terms': LEX_MINE_TERMS_QUEUE_NAME,
  'aggregate.stats': LEX_AGGREGATE_STATS_QUEUE_NAME,
  'build.contexts': LEX_BUILD_CONTEXTS_QUEUE_NAME,
  'embed.contexts': LEX_EMBED_CONTEXTS_QUEUE_NAME,
  'cluster.senses': LEX_CLUSTER_SENSES_QUEUE_NAME,
  'resolve.attributes': LEX_RESOLVE_ATTRIBUTES_QUEUE_NAME,
  'translate.candidates': LEX_TRANSLATE_CANDIDATES_QUEUE_NAME,
  'compose.localizations': LEX_COMPOSE_LOCALIZATIONS_QUEUE_NAME,
  'review.enqueue': LEX_REVIEW_ENQUEUE_QUEUE_NAME,
  publish: LEX_PUBLISH_QUEUE_NAME,
};

export function nextLexPhase(currentPhase: LexPhaseName): LexPhaseName | null {
  const currentIndex = LEX_PHASE_ORDER.indexOf(currentPhase);
  if (currentIndex < 0 || currentIndex >= LEX_PHASE_ORDER.length - 1) {
    return null;
  }

  return LEX_PHASE_ORDER[currentIndex + 1] ?? null;
}

export function isLexPhaseName(value: string): value is LexPhaseName {
  return (LEX_PHASE_ORDER as readonly string[]).includes(value);
}
