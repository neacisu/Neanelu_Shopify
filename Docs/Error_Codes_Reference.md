# Error Codes Reference - NEANELU Shopify Manager

> **Versiune:** 1.0 | **Data:** 2025-12-26

---

## Prefix Convention

| Prefix   | Domain                 | Range     |
| -------- | ---------------------- | --------- |
| `AUTH_`  | Authentication & OAuth | 1000-1999 |
| `DB_`    | Database Operations    | 2000-2999 |
| `SHOP_`  | Shopify API            | 3000-3999 |
| `QUEUE_` | BullMQ & Jobs          | 4000-4999 |
| `BULK_`  | Bulk Operations        | 5000-5999 |
| `AI_`    | AI & Embeddings        | 6000-6999 |
| `VAL_`   | Validation             | 7000-7999 |
| `SYS_`   | System/Internal        | 9000-9999 |

---

## AUTH - Authentication Errors (1000-1999)

| Code          | Name                    | Message                         | Cause                         | Resolution                     |
| ------------- | ----------------------- | ------------------------------- | ----------------------------- | ------------------------------ |
| AUTH_1001     | INVALID_SESSION         | Session expired or invalid      | Token expired sau invalid     | Re-authenticate via OAuth      |
| AUTH_1002     | MISSING_TOKEN           | Authorization header missing    | No Bearer token provided      | Include Authorization header   |
| AUTH_1003     | HMAC_MISMATCH           | Webhook signature invalid       | HMAC verification failed      | Check Shopify webhook secret   |
| AUTH_1004     | OAUTH_STATE_MISMATCH    | OAuth state parameter mismatch  | CSRF protection triggered     | Restart OAuth flow             |
| AUTH_1005     | SHOP_NOT_INSTALLED      | App not installed for this shop | Shop not in database          | Install app first              |
| AUTH_1006     | INSUFFICIENT_SCOPES     | Missing required API scopes     | App needs more permissions    | Re-install with correct scopes |
| AUTH_1007     | TOKEN_DECRYPTION_FAILED | Cannot decrypt stored token     | Key rotation issue            | Re-authenticate shop           |

---

## DB - Database Errors (2000-2999)

| Code          | Name                    | Message                         | Cause                         | Resolution                         |
| ------------- | ----------------------- | ------------------------------- | ----------------------------- | ---------------------------------- |
| DB_2001       | CONNECTION_FAILED       | Database connection failed      | PostgreSQL unreachable        | Check DB health, connection string |
| DB_2002       | RLS_CONTEXT_MISSING     | Tenant context not set          | app.current_shop_id not set   | Ensure middleware sets context     |
| DB_2003       | MIGRATION_FAILED        | Database migration failed       | SQL error in migration        | Check migration logs               |
| DB_2004       | CONSTRAINT_VIOLATION    | Unique constraint violated      | Duplicate key                 | Check for existing record          |
| DB_2005       | FOREIGN_KEY_VIOLATION   | Foreign key reference failed    | Referenced record not found   | Ensure parent exists               |
| DB_2006       | TRANSACTION_ABORTED     | Transaction rolled back         | Error during transaction      | Retry operation                    |
| DB_2007       | DEADLOCK_DETECTED       | Deadlock detected               | Concurrent modifications      | Automatic retry with backoff       |

---

## SHOP - Shopify API Errors (3000-3999)

| Code          | Name                    | Message                         | Cause                         | Resolution                       |
| ------------- | ----------------------- | ------------------------------- | ----------------------------- | -------------------------------- |
| SHOP_3001     | RATE_LIMITED            | Shopify API rate limit hit      | Too many requests             | Wait for bucket refill           |
| SHOP_3002     | INVALID_API_VERSION     | API version not supported       | Deprecated or future version  | Use 2025-10                      |
| SHOP_3003     | GRAPHQL_ERROR           | GraphQL query failed            | Invalid query or data         | Check query structure            |
| SHOP_3004     | BULK_OP_FAILED          | Bulk operation failed           | Shopify-side failure          | Check bulk operation status      |
| SHOP_3005     | WEBHOOK_DELIVERY_FAILED | Webhook redelivery failed       | Delivery issues               | Check webhook configuration      |
| SHOP_3006     | RESOURCE_NOT_FOUND      | Shopify resource not found      | Deleted or inaccessible       | Refresh from Shopify             |
| SHOP_3007     | SCOPE_DENIED            | Access denied for scope         | Missing API scope             | Request additional scope         |

---

## QUEUE - Job Queue Errors (4000-4999)

| Code          | Name                    | Message                         | Cause                         | Resolution                       |
| ------------- | ----------------------- | ------------------------------- | ----------------------------- | -------------------------------- |
| QUEUE_4001    | REDIS_CONNECTION_FAILED | Redis connection failed         | Redis unreachable             | Check Redis health               |
| QUEUE_4002    | JOB_TIMEOUT             | Job exceeded timeout            | Processing too slow           | Increase timeout or optimize     |
| QUEUE_4003    | JOB_STALLED             | Job stalled and will retry      | Worker crashed mid-job        | Automatic retry                  |
| QUEUE_4004    | MAX_RETRIES_EXCEEDED    | Job failed after all retries    | Persistent failure            | Manual intervention needed       |
| QUEUE_4005    | QUEUE_PAUSED            | Queue is paused                 | Admin action                  | Resume queue                     |
| QUEUE_4006    | GROUP_RATE_LIMITED      | Fairness rate limit for shop    | Shop quota exceeded           | Wait for window reset            |
| QUEUE_4007    | INVALID_JOB_DATA        | Job data validation failed      | Malformed job payload         | Fix job producer                 |

---

## BULK - Bulk Operations Errors (5000-5999)

| Code          | Name                    | Message                         | Cause                         | Resolution                       |
| ------------- | ----------------------- | ------------------------------- | ----------------------------- | -------------------------------- |
| BULK_5001     | OPERATION_IN_PROGRESS   | Bulk operation already running  | Concurrent bulk op            | Wait for completion              |
| BULK_5002     | DOWNLOAD_FAILED         | JSONL download failed           | Network or URL issue          | Retry download                   |
| BULK_5003     | PARSE_FAILED            | JSONL parsing failed            | Malformed data                | Check Shopify response           |
| BULK_5004     | STREAM_ERROR            | Streaming pipeline error        | Memory or I/O issue           | Check system resources           |
| BULK_5005     | COPY_FAILED             | Database COPY failed            | Data format issue             | Check transformed data           |
| BULK_5006     | OPERATION_CANCELED      | Operation was canceled          | User or system cancel         | Re-initiate if needed            |
| BULK_5007     | STITCHING_FAILED        | Parent-child stitching failed   | Orphan variants               | Check data integrity             |

---

## AI - AI & Embeddings Errors (6000-6999)

| Code          | Name                      | Message                         | Cause                         | Resolution                       |
| ------------- | ------------------------- | ------------------------------- | ----------------------------- | -------------------------------- |
| AI_6001       | OPENAI_RATE_LIMITED       | OpenAI rate limit exceeded      | Too many requests             | Implement backoff                |
| AI_6002       | OPENAI_QUOTA_EXCEEDED     | OpenAI quota exceeded           | Billing limit reached         | Add credits to account           |
| AI_6003       | EMBEDDING_FAILED          | Embedding generation failed     | API error                     | Check input text                 |
| AI_6004       | BATCH_TIMEOUT             | AI batch job timed out          | Large batch size              | Reduce batch size                |
| AI_6005       | VECTOR_DIMENSION_MISMATCH | Vector dimensions don't match   | Wrong model used              | Ensure consistent model          |
| AI_6006       | SEARCH_FAILED             | Vector search failed            | pgvector error                | Check index health               |
| AI_6007       | MODEL_UNAVAILABLE         | AI model unavailable            | OpenAI outage                 | Use fallback or wait             |

---

## VAL - Validation Errors (7000-7999)

| Code          | Name                      | Message                         | Cause                         | Resolution                       |
| ------------- | ------------------------- | ------------------------------- | ----------------------------- | -------------------------------- |
| VAL_7001      | REQUIRED_FIELD_MISSING    | Required field missing          | Field not provided            | Include required field           |
| VAL_7002      | INVALID_FORMAT            | Invalid data format             | Type mismatch                 | Check expected format            |
| VAL_7003      | OUT_OF_RANGE              | Value out of acceptable range   | Boundary exceeded             | Provide valid value              |
| VAL_7004      | INVALID_UUID              | Invalid UUID format             | Malformed UUID                | Use valid UUID                   |
| VAL_7005      | INVALID_JSON              | Invalid JSON structure          | Parse error                   | Fix JSON syntax                  |
| VAL_7006      | PAGINATION_LIMIT_EXCEEDED | Pagination limit exceeded       | Limit too high                | Max 250 per page                 |

---

## SYS - System Errors (9000-9999)

| Code          | Name                      | Message                         | Cause                         | Resolution                       |
| ------------- | ------------------------- | ------------------------------- | ----------------------------- | -------------------------------- |
| SYS_9001      | INTERNAL_ERROR            | Internal server error           | Unhandled exception           | Check logs, report bug           |
| SYS_9002      | SERVICE_UNAVAILABLE       | Service temporarily unavailable | Maintenance/overload          | Retry later                      |
| SYS_9003      | DEPENDENCY_FAILED         | External dependency failed      | Third-party outage            | Wait for recovery                |
| SYS_9004      | CONFIGURATION_ERROR       | Configuration error             | Missing env variable          | Check configuration              |
| SYS_9999      | UNKNOWN_ERROR             | Unknown error occurred          | Unexpected condition          | Check logs                       |

---

## Error Response Example

```json
{
  "success": false,
  "error": {
    "code": "SHOP_3001",
    "message": "Shopify API rate limit hit",
    "details": {
      "retry_after": 2000,
      "bucket": "products",
      "shop_domain": "store.myshopify.com"
    }
  },
  "meta": {
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2025-12-26T10:30:00Z"
  }
}
```

---

## Logging Convention

All errors are logged with:

- Error code
- Request ID (for tracing)
- Shop ID (if available)
- Stack trace (in development)
- OpenTelemetry trace context
