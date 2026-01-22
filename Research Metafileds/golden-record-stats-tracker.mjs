/**
 * Golden Record Processing Statistics & Metrics
 *
 * Tracking precis pentru procesarea produselor:
 * - Success/failure rates
 * - Cost tracking în timp real
 * - Token usage per stage
 * - API call statistics
 * - Performance metrics
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  calculateSerperCost,
  calculateDeepSeekCost,
  calculateXaiCost,
  estimateTokens,
} from './golden-record-cost-calculator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === STATISTICS SCHEMA ===

/**
 * Structura completă a statisticilor pentru o sesiune de procesare
 */
export const createSessionStats = (sessionId = null) => ({
  session: {
    id: sessionId || `session_${Date.now()}`,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    status: 'running', // running, paused, completed, failed
  },

  products: {
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    successRate: 0,
  },

  stages: {
    bronze: { processed: 0, successful: 0, failed: 0, avgTimeMs: 0, totalTimeMs: 0 },
    silver: { processed: 0, successful: 0, failed: 0, avgTimeMs: 0, totalTimeMs: 0 },
    webSearch: { processed: 0, successful: 0, failed: 0, avgTimeMs: 0, totalTimeMs: 0 },
    golden: { processed: 0, successful: 0, failed: 0, avgTimeMs: 0, totalTimeMs: 0 },
  },

  api: {
    shopify: {
      calls: 0,
      errors: 0,
      rateLimitHits: 0,
      avgLatencyMs: 0,
      totalLatencyMs: 0,
    },
    serper: {
      queries: 0,
      errors: 0,
      rateLimitHits: 0,
      avgLatencyMs: 0,
      totalLatencyMs: 0,
      queriesRemaining: 2500, // free tier
    },
    deepseek: {
      calls: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheHits: 0,
      avgLatencyMs: 0,
      totalLatencyMs: 0,
    },
    xai: {
      calls: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      webSearchCalls: 0,
      avgLatencyMs: 0,
      totalLatencyMs: 0,
    },
  },

  costs: {
    serper: { queries: 0, costUSD: 0 },
    deepseek: { inputTokens: 0, outputTokens: 0, costUSD: 0 },
    xai: { inputTokens: 0, outputTokens: 0, costUSD: 0 },
    total: { costUSD: 0, costRON: 0 },
    perProduct: { avgCostUSD: 0, avgCostRON: 0 },
  },

  quality: {
    avgCompletenessScore: 0,
    goldenReady: 0, // produse gata pentru Golden
    silverOnly: 0, // produse rămase la Silver
    bronzeOnly: 0, // produse rămase la Bronze
    completenessDistribution: {
      '0-20': 0,
      '21-40': 0,
      '41-60': 0,
      '61-80': 0,
      '81-100': 0,
    },
  },

  errors: {
    total: 0,
    byType: {}, // { "SHOPIFY_NOT_FOUND": 5, "DEEPSEEK_TIMEOUT": 2, ... }
    byStage: {}, // { "bronze": 2, "silver": 3, ... }
    lastErrors: [], // Ultimele 100 erori pentru debugging
  },

  performance: {
    avgProcessingTimeMs: 0,
    totalProcessingTimeMs: 0,
    productsPerMinute: 0,
    estimatedTimeRemainingMs: 0,
    peakMemoryMB: 0,
  },
});

// === STATISTICS TRACKER ===

export class StatsTracker {
  constructor(options = {}) {
    const {
      sessionId = null,
      persistPath = null,
      autoSaveInterval = 60000, // 1 minute
      maxErrorsStored = 100,
    } = options;

    this.stats = createSessionStats(sessionId);
    this.persistPath =
      persistPath || path.join(__dirname, 'stats', `${this.stats.session.id}.json`);
    this.maxErrorsStored = maxErrorsStored;
    this.timers = new Map(); // Pentru tracking timp per produs

    // Auto-save
    if (autoSaveInterval > 0) {
      this.autoSaveTimer = setInterval(() => this.save(), autoSaveInterval);
    }
  }

  // === PRODUCT TRACKING ===

  setTotalProducts(total) {
    this.stats.products.total = total;
    this.stats.products.pending = total - this.stats.products.processed;
    this._updateMetrics();
  }

  startProduct(productId) {
    this.timers.set(productId, {
      startTime: Date.now(),
      stages: {},
    });
  }

  endProduct(productId, result) {
    const timer = this.timers.get(productId);
    if (!timer) return;

    const duration = Date.now() - timer.startTime;

    this.stats.products.processed++;
    this.stats.products.pending = this.stats.products.total - this.stats.products.processed;

    if (result.success) {
      this.stats.products.successful++;
    } else if (result.skipped) {
      this.stats.products.skipped++;
    } else {
      this.stats.products.failed++;
    }

    // Update quality
    if (result.completenessScore !== undefined) {
      this._updateCompletenessStats(result.completenessScore, result.level);
    }

    // Update performance
    this.stats.performance.totalProcessingTimeMs += duration;
    this.stats.performance.avgProcessingTimeMs =
      this.stats.performance.totalProcessingTimeMs / this.stats.products.processed;

    this._updateMetrics();
    this.timers.delete(productId);
  }

  skipProduct(productId, reason) {
    this.stats.products.processed++;
    this.stats.products.skipped++;
    this.stats.products.pending = this.stats.products.total - this.stats.products.processed;
    this._updateMetrics();
  }

  // === STAGE TRACKING ===

  startStage(productId, stageName) {
    const timer = this.timers.get(productId);
    if (!timer) return;
    timer.stages[stageName] = { startTime: Date.now() };
  }

  endStage(productId, stageName, success, error = null) {
    const timer = this.timers.get(productId);
    if (!timer || !timer.stages[stageName]) return;

    const stage = timer.stages[stageName];
    const duration = Date.now() - stage.startTime;

    const stageStats = this.stats.stages[stageName];
    if (stageStats) {
      stageStats.processed++;
      if (success) {
        stageStats.successful++;
      } else {
        stageStats.failed++;
        this._recordError(error, stageName, productId);
      }
      stageStats.totalTimeMs += duration;
      stageStats.avgTimeMs = stageStats.totalTimeMs / stageStats.processed;
    }
  }

  // === API CALL TRACKING ===

  recordApiCall(provider, options = {}) {
    const {
      latencyMs = 0,
      error = null,
      rateLimitHit = false,
      inputTokens = 0,
      outputTokens = 0,
      cacheHit = false,
      webSearch = false,
      queries = 1,
    } = options;

    const apiStats = this.stats.api[provider];
    if (!apiStats) return;

    apiStats.calls++;
    apiStats.totalLatencyMs += latencyMs;
    apiStats.avgLatencyMs = apiStats.totalLatencyMs / apiStats.calls;

    if (error) {
      apiStats.errors++;
      this._recordError(error, `api_${provider}`);
    }

    if (rateLimitHit) {
      apiStats.rateLimitHits++;
    }

    // Provider-specific tracking
    switch (provider) {
      case 'serper':
        apiStats.queries += queries;
        this._updateSerperCosts(queries);
        break;

      case 'deepseek':
        apiStats.inputTokens += inputTokens;
        apiStats.outputTokens += outputTokens;
        if (cacheHit) apiStats.cacheHits++;
        this._updateDeepseekCosts(inputTokens, outputTokens);
        break;

      case 'xai':
        apiStats.inputTokens += inputTokens;
        apiStats.outputTokens += outputTokens;
        if (webSearch) apiStats.webSearchCalls++;
        this._updateXaiCosts(inputTokens, outputTokens);
        break;
    }
  }

  // === COST TRACKING ===

  _updateSerperCosts(queries) {
    this.stats.costs.serper.queries += queries;
    const cost = calculateSerperCost(this.stats.costs.serper.queries);
    this.stats.costs.serper.costUSD = cost.cost;
    this._updateTotalCosts();
  }

  _updateDeepseekCosts(inputTokens, outputTokens) {
    this.stats.costs.deepseek.inputTokens += inputTokens;
    this.stats.costs.deepseek.outputTokens += outputTokens;
    const cost = calculateDeepSeekCost(
      this.stats.costs.deepseek.inputTokens,
      this.stats.costs.deepseek.outputTokens
    );
    this.stats.costs.deepseek.costUSD = cost.totalCost;
    this._updateTotalCosts();
  }

  _updateXaiCosts(inputTokens, outputTokens) {
    this.stats.costs.xai.inputTokens += inputTokens;
    this.stats.costs.xai.outputTokens += outputTokens;
    const cost = calculateXaiCost(
      this.stats.costs.xai.inputTokens,
      this.stats.costs.xai.outputTokens,
      true
    );
    this.stats.costs.xai.costUSD = cost.totalCost;
    this._updateTotalCosts();
  }

  _updateTotalCosts() {
    const total =
      this.stats.costs.serper.costUSD +
      this.stats.costs.deepseek.costUSD +
      this.stats.costs.xai.costUSD;

    this.stats.costs.total.costUSD = Math.round(total * 10000) / 10000;
    this.stats.costs.total.costRON = Math.round(total * 4.95 * 10000) / 10000;

    if (this.stats.products.processed > 0) {
      this.stats.costs.perProduct.avgCostUSD =
        Math.round((total / this.stats.products.processed) * 100000) / 100000;
      this.stats.costs.perProduct.avgCostRON =
        Math.round(((total * 4.95) / this.stats.products.processed) * 100000) / 100000;
    }
  }

  // === QUALITY TRACKING ===

  _updateCompletenessStats(score, level) {
    // Update average
    const prev = this.stats.quality.avgCompletenessScore;
    const count = this.stats.products.successful;
    this.stats.quality.avgCompletenessScore =
      Math.round(((prev * (count - 1) + score) / count) * 100) / 100;

    // Update level counts
    if (level === 'golden' && score >= 70) {
      this.stats.quality.goldenReady++;
    } else if (level === 'silver' || (level === 'golden' && score >= 40)) {
      this.stats.quality.silverOnly++;
    } else {
      this.stats.quality.bronzeOnly++;
    }

    // Update distribution
    const bucket =
      score <= 20
        ? '0-20'
        : score <= 40
          ? '21-40'
          : score <= 60
            ? '41-60'
            : score <= 80
              ? '61-80'
              : '81-100';
    this.stats.quality.completenessDistribution[bucket]++;
  }

  // === ERROR TRACKING ===

  _recordError(error, stage = null, productId = null) {
    this.stats.errors.total++;

    // Error type
    const errorType = error?.code || error?.name || 'UNKNOWN_ERROR';
    this.stats.errors.byType[errorType] = (this.stats.errors.byType[errorType] || 0) + 1;

    // Error by stage
    if (stage) {
      this.stats.errors.byStage[stage] = (this.stats.errors.byStage[stage] || 0) + 1;
    }

    // Store last errors
    const errorRecord = {
      timestamp: new Date().toISOString(),
      type: errorType,
      message: error?.message || String(error),
      stage,
      productId,
    };

    this.stats.errors.lastErrors.unshift(errorRecord);
    if (this.stats.errors.lastErrors.length > this.maxErrorsStored) {
      this.stats.errors.lastErrors.pop();
    }
  }

  // === METRICS UPDATE ===

  _updateMetrics() {
    const stats = this.stats;

    // Success rate
    if (stats.products.processed > 0) {
      stats.products.successRate =
        Math.round((stats.products.successful / stats.products.processed) * 10000) / 100;
    }

    // Processing rate
    const elapsedMs = Date.now() - new Date(stats.session.startedAt).getTime();
    const elapsedMinutes = elapsedMs / 60000;
    if (elapsedMinutes > 0) {
      stats.performance.productsPerMinute =
        Math.round((stats.products.processed / elapsedMinutes) * 100) / 100;
    }

    // ETA
    if (stats.performance.productsPerMinute > 0 && stats.products.pending > 0) {
      const remainingMinutes = stats.products.pending / stats.performance.productsPerMinute;
      stats.performance.estimatedTimeRemainingMs = Math.round(remainingMinutes * 60000);
    }

    // Memory (if available)
    if (process.memoryUsage) {
      const mem = process.memoryUsage();
      stats.performance.peakMemoryMB = Math.max(
        stats.performance.peakMemoryMB,
        Math.round(mem.heapUsed / 1024 / 1024)
      );
    }

    stats.session.lastUpdatedAt = new Date().toISOString();
  }

  // === PERSISTENCE ===

  save() {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.persistPath, JSON.stringify(this.stats, null, 2));
    } catch (err) {
      console.error('Failed to save stats:', err.message);
    }
  }

  static load(sessionId) {
    const persistPath = path.join(__dirname, 'stats', `${sessionId}.json`);
    if (!fs.existsSync(persistPath)) {
      return null;
    }
    try {
      const data = JSON.parse(fs.readFileSync(persistPath, 'utf-8'));
      const tracker = new StatsTracker({ sessionId, persistPath });
      tracker.stats = data;
      return tracker;
    } catch (err) {
      return null;
    }
  }

  // === REPORTING ===

  getProgress() {
    const s = this.stats;
    return {
      processed: s.products.processed,
      total: s.products.total,
      percentage:
        s.products.total > 0
          ? Math.round((s.products.processed / s.products.total) * 10000) / 100
          : 0,
      successRate: s.products.successRate,
      eta: this._formatDuration(s.performance.estimatedTimeRemainingMs),
      cost: `$${s.costs.total.costUSD.toFixed(2)}`,
    };
  }

  _formatDuration(ms) {
    if (!ms) return 'calculating...';
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  }

  printSummary() {
    const s = this.stats;
    const progress = this.getProgress();

    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                 GOLDEN RECORD PROCESSING STATUS                  ║
╠═══════════════════════════════════════════════════════════════════╣
║ Session: ${s.session.id.padEnd(52)}║
║ Status: ${s.session.status.padEnd(53)}║
╠═══════════════════════════════════════════════════════════════════╣
║ PROGRESS                                                         ║
║   Processed: ${String(s.products.processed.toLocaleString() + ' / ' + s.products.total.toLocaleString()).padEnd(49)}║
║   Percentage: ${String(progress.percentage + '%').padEnd(48)}║
║   Success Rate: ${String(s.products.successRate + '%').padEnd(45)}║
║   ETA: ${progress.eta.padEnd(54)}║
╠═══════════════════════════════════════════════════════════════════╣
║ COSTS (REAL-TIME)                                                ║
║   Serper: ${String('$' + s.costs.serper.costUSD.toFixed(4) + ' (' + s.costs.serper.queries + ' queries)').padEnd(51)}║
║   DeepSeek: ${String('$' + s.costs.deepseek.costUSD.toFixed(4) + ' (' + (s.costs.deepseek.inputTokens + s.costs.deepseek.outputTokens).toLocaleString() + ' tokens)').padEnd(49)}║
║   xAI: ${String('$' + s.costs.xai.costUSD.toFixed(4)).padEnd(54)}║
║   TOTAL: ${String('$' + s.costs.total.costUSD.toFixed(2) + ' / ' + s.costs.total.costRON.toFixed(2) + ' RON').padEnd(52)}║
║   Per Product: ${String('$' + s.costs.perProduct.avgCostUSD.toFixed(5)).padEnd(46)}║
╠═══════════════════════════════════════════════════════════════════╣
║ QUALITY                                                          ║
║   Avg Completeness: ${String(s.quality.avgCompletenessScore + '%').padEnd(41)}║
║   Golden Ready: ${String(s.quality.goldenReady.toLocaleString()).padEnd(45)}║
║   Silver Only: ${String(s.quality.silverOnly.toLocaleString()).padEnd(46)}║
║   Bronze Only: ${String(s.quality.bronzeOnly.toLocaleString()).padEnd(46)}║
╠═══════════════════════════════════════════════════════════════════╣
║ PERFORMANCE                                                      ║
║   Products/min: ${String(s.performance.productsPerMinute.toFixed(2)).padEnd(45)}║
║   Avg Time/product: ${String((s.performance.avgProcessingTimeMs / 1000).toFixed(2) + 's').padEnd(41)}║
║   Memory Peak: ${String(s.performance.peakMemoryMB + ' MB').padEnd(46)}║
╠═══════════════════════════════════════════════════════════════════╣
║ ERRORS                                                           ║
║   Total: ${String(s.errors.total).padEnd(52)}║
║   By Type: ${
      Object.entries(s.errors.byType)
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
        .padEnd(50) || 'none'.padEnd(50)
    }║
╚═══════════════════════════════════════════════════════════════════╝
`);
  }

  // === CLEANUP ===

  stop() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    this.stats.session.status = 'completed';
    this.save();
  }

  pause() {
    this.stats.session.status = 'paused';
    this.save();
  }

  resume() {
    this.stats.session.status = 'running';
  }
}

// === SINGLETON FOR GLOBAL ACCESS ===

let globalTracker = null;

export const getGlobalTracker = () => globalTracker;

export const initGlobalTracker = (options = {}) => {
  globalTracker = new StatsTracker(options);
  return globalTracker;
};

export default StatsTracker;
