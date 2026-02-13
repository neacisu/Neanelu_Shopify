export type QualityEventType =
  | 'quality_promoted'
  | 'quality_demoted'
  | 'review_requested'
  | 'milestone_reached';

export interface QualityEventPayload {
  event_type: QualityEventType;
  event_id: string;
  product_id: string;
  sku: string;
  previous_level: string | null;
  new_level: string;
  quality_score: number;
  trigger_reason: string;
  timestamp: string;
  shop_id: string;
}

export interface QualityWebhookConfig {
  url: string;
  secret: string;
  enabled: boolean;
  subscribedEvents: QualityEventType[];
}

export interface QualityWebhookJobData {
  eventId: string;
  shopId: string;
}
