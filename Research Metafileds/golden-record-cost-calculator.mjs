/**
 * Golden Record Cost Calculator & Real-Time Tracker
 *
 * Sistem PRECIS de tracking al costurilor pentru 900,000+ produse pe neanelu.ro
 *
 * TRACKING REAL-TIME:
 * - Fiecare API call este măsurat individual
 * - Tokenii sunt extrași din response.usage când disponibil
 * - Fallback la estimare când usage nu e disponibil
 *
 * PREȚURI VERIFICATE (Ianuarie 2026):
 * - DeepSeek Chat: $0.14/1M input, $0.28/1M output
 * - DeepSeek Cache: $0.014/1M input (10x mai ieftin)
 * - xAI Grok-3: $3.00/1M input, $15.00/1M output
 * - Serper.dev: $1.00/1000 queries = $0.001/query
 * - Shopify Admin: FREE (rate limited)
 * - HTTP Fetch: FREE (bandwidth only)
 */

// === PRICING CONSTANTS (USD) - VERIFIED 2026-01-21 ===
export const PRICING = {
  deepseek: {
    name: 'DeepSeek Chat',
    model: 'deepseek-chat',
    // Standard pricing
    input_per_million: 0.14, // $0.14 per 1M input tokens
    output_per_million: 0.28, // $0.28 per 1M output tokens
    // Cached pricing (prompt caching enabled)
    cached_input_per_million: 0.014, // $0.014 per 1M cached input (10x cheaper)
  },

  xai: {
    name: 'xAI Grok-3',
    model: 'grok-3',
    input_per_million: 3.0, // $3.00 per 1M input tokens
    output_per_million: 15.0, // $15.00 per 1M output tokens
  },

  serper: {
    name: 'Serper.dev (Google Search)',
    // Volume pricing tiers
    tiers: [
      { maxQueries: 2500, perQuery: 0 }, // FREE tier
      { maxQueries: 50000, perQuery: 0.001 }, // $1/1000
      { maxQueries: 500000, perQuery: 0.00075 }, // $0.75/1000
      { maxQueries: 2500000, perQuery: 0.0005 }, // $0.50/1000
      { maxQueries: Infinity, perQuery: 0.0003 }, // $0.30/1000
    ],
  },

  shopify: {
    name: 'Shopify Admin GraphQL',
    per_request: 0, // FREE (doar rate limited)
    rate_limit: {
      bucket_size: 1000,
      restore_rate: 50, // per second
    },
  },

  fetch: {
    name: 'HTTP Fetch (Scraping)',
    per_request: 0, // FREE
  },
};

// === EXCHANGE RATE ===
export const USD_TO_RON = 4.97; // Actualizat 2026-01-21

// === TOKEN ESTIMATION (PRECISE) ===

/**
 * Estimează tokenii dintr-un text - metodă precisă
 * OpenAI/DeepSeek folosesc BPE (Byte Pair Encoding)
 * Aproximare: ~4 caractere/token pentru engleză, ~3.5 pentru română
 */
export const estimateTokens = (text) => {
  if (!text) return 0;
  const str = String(text);

  // Componente pentru estimare mai precisă
  const chars = str.length;
  const words = str.split(/\s+/).filter((w) => w.length > 0).length;
  const numbers = (str.match(/\d+/g) || []).length;
  const punctuation = (str.match(/[.,!?;:'"()\[\]{}]/g) || []).length;
  const newlines = (str.match(/\n/g) || []).length;
  const isJson = str.trim().startsWith('{') || str.trim().startsWith('[');

  // Formula empirică pentru BPE tokenization
  // JSON/code are mai mulți tokeni per caracter
  const charMultiplier = isJson ? 0.35 : 0.28;
  const baseTokens = chars * charMultiplier;
  const wordAdjustment = words * 0.15;
  const numberAdjustment = numbers * 0.5;
  const punctAdjustment = punctuation * 0.1;
  const newlineAdjustment = newlines * 0.2;

  const estimated = Math.ceil(
    baseTokens + wordAdjustment + numberAdjustment + punctAdjustment + newlineAdjustment
  );

  return Math.max(estimated, 1);
};

/**
 * Estimează tokenii pentru mesaje OpenAI-style [{role, content}]
 */
export const estimateMessagesTokens = (messages) => {
  if (!Array.isArray(messages)) return 0;

  let total = 0;
  for (const msg of messages) {
    // Overhead per mesaj: ~4 tokeni pentru <|role|> markers
    total += 4;
    total += estimateTokens(msg.content || '');
    if (msg.name) total += estimateTokens(msg.name);
  }
  // Overhead general pentru conversation formatting
  return total + 3;
};

// === REAL-TIME COST TRACKER CLASS ===

/**
 * CostTracker - Tracking precis în timp real al tuturor costurilor
 *
 * Folosire:
 *   const tracker = new CostTracker();
 *   tracker.startStage('BRONZE');
 *   // ... API calls cu tracker.trackDeepSeek(), tracker.trackSerper() etc.
 *   tracker.endStage('BRONZE');
 *   const report = tracker.generateReport();
 */
export class CostTracker {
  constructor(productHandle = 'unknown') {
    this.productHandle = productHandle;
    this.reset();
  }

  reset() {
    this.startTime = Date.now();
    this.endTime = null;

    // Stage-level tracking
    this.stages = {};
    this.currentStage = null;

    // Provider-level totals
    this.totals = {
      deepseek: {
        requests: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        cost_usd: 0,
        calls: [],
      },
      xai: {
        requests: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        web_searches: 0,
        calls: [],
      },
      serper: {
        queries: 0,
        organic_queries: 0,
        shopping_queries: 0,
        cost_usd: 0,
        calls: [],
      },
      shopify: {
        requests: 0,
        cost_usd: 0,
        calls: [],
      },
      fetch: {
        requests: 0,
        total_bytes: 0,
        cost_usd: 0,
        calls: [],
      },
    };

    // Timeline pentru debugging
    this.timeline = [];

    // Errors
    this.errors = [];
  }

  // === STAGE MANAGEMENT ===

  startStage(stageName) {
    this.currentStage = stageName;
    this.stages[stageName] = {
      name: stageName,
      start_time: Date.now(),
      end_time: null,
      duration_ms: null,
      costs: {
        deepseek: 0,
        xai: 0,
        serper: 0,
        total: 0,
      },
      tokens: {
        input: 0,
        output: 0,
        total: 0,
      },
      api_calls: 0,
    };

    this._log('stage_start', { stage: stageName });
  }

  endStage(stageName) {
    const stage = this.stages[stageName];
    if (stage) {
      stage.end_time = Date.now();
      stage.duration_ms = stage.end_time - stage.start_time;
      this._log('stage_end', {
        stage: stageName,
        duration_ms: stage.duration_ms,
        cost_usd: stage.costs.total,
      });
    }
    if (this.currentStage === stageName) {
      this.currentStage = null;
    }
  }

  // === DEEPSEEK TRACKING ===

  /**
   * Track un API call DeepSeek
   * @param {Object} params
   * @param {number} params.inputTokens - Tokeni estimați sau din request
   * @param {number} params.outputTokens - Tokeni estimați sau din request
   * @param {Object} params.usage - response.usage din API (mai precis)
   * @param {string} params.purpose - Ce face acest call (pentru logging)
   */
  trackDeepSeek({ inputTokens, outputTokens, usage = null, purpose = '' }) {
    // Preferă usage real din response dacă disponibil
    const actualInput = usage?.prompt_tokens ?? inputTokens;
    const actualOutput = usage?.completion_tokens ?? outputTokens;
    const cachedTokens = usage?.prompt_cache_hit_tokens ?? 0;

    // Calculează cost precis
    const uncachedInput = actualInput - cachedTokens;
    const inputCost = (uncachedInput / 1_000_000) * PRICING.deepseek.input_per_million;
    const cachedCost = (cachedTokens / 1_000_000) * PRICING.deepseek.cached_input_per_million;
    const outputCost = (actualOutput / 1_000_000) * PRICING.deepseek.output_per_million;
    const totalCost = inputCost + cachedCost + outputCost;

    const call = {
      timestamp: Date.now(),
      stage: this.currentStage,
      purpose,
      input_tokens: actualInput,
      output_tokens: actualOutput,
      cached_tokens: cachedTokens,
      cost_breakdown: {
        input_cost: inputCost,
        cached_cost: cachedCost,
        output_cost: outputCost,
      },
      cost_usd: totalCost,
      usage_source: usage ? 'api_response' : 'estimated',
    };

    // Update totals
    this.totals.deepseek.requests++;
    this.totals.deepseek.input_tokens += actualInput;
    this.totals.deepseek.output_tokens += actualOutput;
    this.totals.deepseek.cached_tokens += cachedTokens;
    this.totals.deepseek.cost_usd += totalCost;
    this.totals.deepseek.calls.push(call);

    // Update stage
    if (this.currentStage && this.stages[this.currentStage]) {
      this.stages[this.currentStage].costs.deepseek += totalCost;
      this.stages[this.currentStage].costs.total += totalCost;
      this.stages[this.currentStage].tokens.input += actualInput;
      this.stages[this.currentStage].tokens.output += actualOutput;
      this.stages[this.currentStage].tokens.total += actualInput + actualOutput;
      this.stages[this.currentStage].api_calls++;
    }

    this._log('deepseek_call', {
      purpose,
      tokens: { input: actualInput, output: actualOutput, cached: cachedTokens },
      cost_usd: totalCost,
    });

    return call;
  }

  // === XAI TRACKING ===

  trackXai({ inputTokens, outputTokens, usage = null, webSearch = false, purpose = '' }) {
    const actualInput = usage?.prompt_tokens ?? inputTokens;
    const actualOutput = usage?.completion_tokens ?? outputTokens;

    const inputCost = (actualInput / 1_000_000) * PRICING.xai.input_per_million;
    const outputCost = (actualOutput / 1_000_000) * PRICING.xai.output_per_million;
    const totalCost = inputCost + outputCost;

    const call = {
      timestamp: Date.now(),
      stage: this.currentStage,
      purpose,
      input_tokens: actualInput,
      output_tokens: actualOutput,
      web_search: webSearch,
      cost_breakdown: {
        input_cost: inputCost,
        output_cost: outputCost,
      },
      cost_usd: totalCost,
      usage_source: usage ? 'api_response' : 'estimated',
    };

    this.totals.xai.requests++;
    this.totals.xai.input_tokens += actualInput;
    this.totals.xai.output_tokens += actualOutput;
    this.totals.xai.cost_usd += totalCost;
    if (webSearch) this.totals.xai.web_searches++;
    this.totals.xai.calls.push(call);

    if (this.currentStage && this.stages[this.currentStage]) {
      this.stages[this.currentStage].costs.xai += totalCost;
      this.stages[this.currentStage].costs.total += totalCost;
      this.stages[this.currentStage].tokens.input += actualInput;
      this.stages[this.currentStage].tokens.output += actualOutput;
      this.stages[this.currentStage].tokens.total += actualInput + actualOutput;
      this.stages[this.currentStage].api_calls++;
    }

    this._log('xai_call', {
      purpose,
      tokens: { input: actualInput, output: actualOutput },
      web_search: webSearch,
      cost_usd: totalCost,
    });

    return call;
  }

  // === SERPER TRACKING ===

  trackSerper({ queryCount = 1, queryType = 'organic', query = '' }) {
    // Calculează costul bazat pe tier-uri
    // Pentru simplitate, folosim pricing-ul mediu $0.001/query
    // În producție, ar trebui să trackuim queries totale pentru a aplica tier-ul corect
    const costPerQuery = this._getSerperPricePerQuery();
    const totalCost = queryCount * costPerQuery;

    const call = {
      timestamp: Date.now(),
      stage: this.currentStage,
      query_type: queryType,
      query_count: queryCount,
      query_sample: query.substring(0, 100),
      cost_per_query: costPerQuery,
      cost_usd: totalCost,
    };

    this.totals.serper.queries += queryCount;
    if (queryType === 'organic' || queryType === 'search') {
      this.totals.serper.organic_queries += queryCount;
    } else if (queryType === 'shopping') {
      this.totals.serper.shopping_queries += queryCount;
    }
    this.totals.serper.cost_usd += totalCost;
    this.totals.serper.calls.push(call);

    if (this.currentStage && this.stages[this.currentStage]) {
      this.stages[this.currentStage].costs.serper += totalCost;
      this.stages[this.currentStage].costs.total += totalCost;
      this.stages[this.currentStage].api_calls++;
    }

    this._log('serper_call', {
      type: queryType,
      count: queryCount,
      cost_usd: totalCost,
    });

    return call;
  }

  _getSerperPricePerQuery() {
    // Determină tier-ul bazat pe queries totale
    const totalQueries = this.totals.serper.queries;
    const tiers = PRICING.serper.tiers;

    for (const tier of tiers) {
      if (totalQueries < tier.maxQueries) {
        return tier.perQuery;
      }
    }
    return tiers[tiers.length - 1].perQuery;
  }

  // === SHOPIFY TRACKING ===

  trackShopify({ queryType = 'graphql', cost_points = 1 }) {
    const call = {
      timestamp: Date.now(),
      stage: this.currentStage,
      query_type: queryType,
      cost_points,
      cost_usd: 0, // Shopify is free
    };

    this.totals.shopify.requests++;
    this.totals.shopify.calls.push(call);

    if (this.currentStage && this.stages[this.currentStage]) {
      this.stages[this.currentStage].api_calls++;
    }

    this._log('shopify_call', { type: queryType });

    return call;
  }

  // === FETCH TRACKING ===

  trackFetch({ url, bytes = 0, success = true }) {
    const call = {
      timestamp: Date.now(),
      stage: this.currentStage,
      url: url?.substring(0, 100),
      bytes,
      success,
      cost_usd: 0,
    };

    this.totals.fetch.requests++;
    this.totals.fetch.total_bytes += bytes;
    this.totals.fetch.calls.push(call);

    if (this.currentStage && this.stages[this.currentStage]) {
      this.stages[this.currentStage].api_calls++;
    }

    this._log('fetch_call', { bytes, success });

    return call;
  }

  // === ERROR TRACKING ===

  trackError(provider, error, context = {}) {
    const errorEntry = {
      timestamp: Date.now(),
      stage: this.currentStage,
      provider,
      message: error?.message || String(error),
      context,
    };

    this.errors.push(errorEntry);
    this._log('error', errorEntry);

    return errorEntry;
  }

  // === INTERNAL LOGGING ===

  _log(event, data = {}) {
    this.timeline.push({
      timestamp: Date.now(),
      relative_ms: Date.now() - this.startTime,
      event,
      stage: this.currentStage,
      ...data,
    });
  }

  // === REPORT GENERATION ===

  finalize() {
    this.endTime = Date.now();
  }

  /**
   * Calculează totalurile finale
   */
  calculateTotals() {
    const totalCost =
      this.totals.deepseek.cost_usd + this.totals.xai.cost_usd + this.totals.serper.cost_usd;

    const totalTokens =
      this.totals.deepseek.input_tokens +
      this.totals.deepseek.output_tokens +
      this.totals.xai.input_tokens +
      this.totals.xai.output_tokens;

    const totalApiCalls =
      this.totals.deepseek.requests +
      this.totals.xai.requests +
      this.totals.serper.queries +
      this.totals.shopify.requests +
      this.totals.fetch.requests;

    const duration = (this.endTime || Date.now()) - this.startTime;

    return {
      cost_usd: totalCost,
      cost_ron: totalCost * USD_TO_RON,
      total_tokens: totalTokens,
      total_api_calls: totalApiCalls,
      duration_ms: duration,
      duration_s: duration / 1000,
    };
  }

  /**
   * Generează raport complet
   */
  generateReport() {
    this.finalize();
    const totals = this.calculateTotals();

    // Cost distribution by provider
    const costByProvider = {};
    for (const [provider, data] of Object.entries(this.totals)) {
      if (data.cost_usd !== undefined) {
        costByProvider[provider] = {
          cost_usd: data.cost_usd,
          percentage: totals.cost_usd > 0 ? (data.cost_usd / totals.cost_usd) * 100 : 0,
          requests: data.requests || data.queries || 0,
        };
        if (data.input_tokens !== undefined) {
          costByProvider[provider].input_tokens = data.input_tokens;
          costByProvider[provider].output_tokens = data.output_tokens;
        }
      }
    }

    // Cost distribution by stage
    const costByStage = {};
    for (const [stageName, stage] of Object.entries(this.stages)) {
      costByStage[stageName] = {
        cost_usd: stage.costs.total,
        percentage: totals.cost_usd > 0 ? (stage.costs.total / totals.cost_usd) * 100 : 0,
        duration_ms: stage.duration_ms,
        duration_s: stage.duration_ms ? stage.duration_ms / 1000 : null,
        api_calls: stage.api_calls,
        tokens: stage.tokens,
      };
    }

    return {
      product_handle: this.productHandle,
      generated_at: new Date().toISOString(),

      summary: {
        total_cost_usd: totals.cost_usd,
        total_cost_ron: totals.cost_ron,
        total_tokens: totals.total_tokens,
        total_api_calls: totals.total_api_calls,
        duration_s: totals.duration_s,
        errors_count: this.errors.length,
      },

      cost_by_provider: costByProvider,
      cost_by_stage: costByStage,

      provider_details: {
        deepseek: {
          requests: this.totals.deepseek.requests,
          input_tokens: this.totals.deepseek.input_tokens,
          output_tokens: this.totals.deepseek.output_tokens,
          cached_tokens: this.totals.deepseek.cached_tokens,
          cost_usd: this.totals.deepseek.cost_usd,
        },
        xai: {
          requests: this.totals.xai.requests,
          input_tokens: this.totals.xai.input_tokens,
          output_tokens: this.totals.xai.output_tokens,
          web_searches: this.totals.xai.web_searches,
          cost_usd: this.totals.xai.cost_usd,
        },
        serper: {
          total_queries: this.totals.serper.queries,
          organic_queries: this.totals.serper.organic_queries,
          shopping_queries: this.totals.serper.shopping_queries,
          cost_usd: this.totals.serper.cost_usd,
        },
        shopify: {
          requests: this.totals.shopify.requests,
        },
        fetch: {
          requests: this.totals.fetch.requests,
          total_bytes: this.totals.fetch.total_bytes,
          total_kb: Math.round((this.totals.fetch.total_bytes / 1024) * 100) / 100,
        },
      },

      stages: this.stages,
      errors: this.errors,
      timeline: this.timeline,

      pricing_used: PRICING,
    };
  }

  /**
   * Generează estimare pentru N produse bazată pe costul real al acestui produs
   */
  generateScaleEstimate(productCount = 900000) {
    const totals = this.calculateTotals();
    const costPerProduct = totals.cost_usd;
    const timePerProduct = totals.duration_s;

    return {
      basis: {
        single_product_cost_usd: costPerProduct,
        single_product_cost_ron: costPerProduct * USD_TO_RON,
        single_product_duration_s: timePerProduct,
        single_product_tokens: totals.total_tokens,
        single_product_api_calls: totals.total_api_calls,
      },

      estimates: {
        // Small batches
        batch_10: this._estimateBatch(10, costPerProduct, timePerProduct),
        batch_100: this._estimateBatch(100, costPerProduct, timePerProduct),
        batch_1000: this._estimateBatch(1000, costPerProduct, timePerProduct),
        batch_10000: this._estimateBatch(10000, costPerProduct, timePerProduct),
        batch_100000: this._estimateBatch(100000, costPerProduct, timePerProduct),

        // Full catalog
        full_catalog: this._estimateBatch(productCount, costPerProduct, timePerProduct),
      },

      api_totals_for_catalog: {
        deepseek_requests: this.totals.deepseek.requests * productCount,
        deepseek_tokens:
          (this.totals.deepseek.input_tokens + this.totals.deepseek.output_tokens) * productCount,
        xai_requests: this.totals.xai.requests * productCount,
        serper_queries: this.totals.serper.queries * productCount,
        shopify_requests: this.totals.shopify.requests * productCount,
      },

      monthly_budget_products: this._calculateMonthlyBudgetProducts(costPerProduct),
    };
  }

  _estimateBatch(count, costPerProduct, timePerProduct) {
    const totalCost = costPerProduct * count;
    const totalTime = timePerProduct * count;

    return {
      products: count,
      cost_usd: Math.round(totalCost * 100) / 100,
      cost_ron: Math.round(totalCost * USD_TO_RON * 100) / 100,
      time_sequential: {
        seconds: Math.round(totalTime),
        hours: Math.round((totalTime / 3600) * 10) / 10,
        days: Math.round((totalTime / 86400) * 10) / 10,
      },
      time_parallel_5x: {
        hours: Math.round((totalTime / 5 / 3600) * 10) / 10,
        days: Math.round((totalTime / 5 / 86400) * 10) / 10,
      },
      time_parallel_10x: {
        hours: Math.round((totalTime / 10 / 3600) * 10) / 10,
        days: Math.round((totalTime / 10 / 86400) * 10) / 10,
      },
      time_parallel_50x: {
        hours: Math.round((totalTime / 50 / 3600) * 10) / 10,
        days: Math.round((totalTime / 50 / 86400) * 10) / 10,
      },
    };
  }

  _calculateMonthlyBudgetProducts(costPerProduct) {
    const budgets = [50, 100, 200, 500, 1000];
    const result = {};

    for (const budget of budgets) {
      result[`$${budget}`] = Math.floor(budget / costPerProduct);
    }

    return result;
  }

  /**
   * Print formatted report to console
   */
  printReport() {
    const report = this.generateReport();
    const estimate = this.generateScaleEstimate();

    console.log('\n' + '═'.repeat(70));
    console.log('              💰 COST TRACKING REPORT - REAL DATA');
    console.log('═'.repeat(70));
    console.log(`Product: ${report.product_handle}`);
    console.log(`Generated: ${report.generated_at}`);

    console.log('\n📊 SUMMARY (ACTUAL COSTS):');
    console.log(`   Total Cost:      $${report.summary.total_cost_usd.toFixed(6)} USD`);
    console.log(`                    ${report.summary.total_cost_ron.toFixed(4)} RON`);
    console.log(`   Total Tokens:    ${report.summary.total_tokens.toLocaleString()}`);
    console.log(`   Total API Calls: ${report.summary.total_api_calls}`);
    console.log(`   Duration:        ${report.summary.duration_s.toFixed(2)}s`);

    if (report.summary.errors_count > 0) {
      console.log(`   ⚠ Errors:        ${report.summary.errors_count}`);
    }

    console.log('\n📦 COST BY PROVIDER:');
    for (const [provider, data] of Object.entries(report.cost_by_provider)) {
      if (data.cost_usd > 0 || data.requests > 0) {
        console.log(
          `   ${provider.toUpperCase().padEnd(10)} $${data.cost_usd.toFixed(6).padStart(12)} (${data.percentage.toFixed(1).padStart(5)}%)`
        );
        if (data.input_tokens) {
          console.log(
            `              Tokens: ${(data.input_tokens + data.output_tokens).toLocaleString()} (in: ${data.input_tokens.toLocaleString()}, out: ${data.output_tokens.toLocaleString()})`
          );
        }
        if (data.requests > 0 && provider !== 'serper') {
          console.log(`              Requests: ${data.requests}`);
        }
      }
    }

    console.log('\n🔄 COST BY STAGE:');
    for (const [stage, data] of Object.entries(report.cost_by_stage)) {
      const duration = data.duration_s ? `${data.duration_s.toFixed(1)}s` : 'N/A';
      console.log(
        `   ${stage.padEnd(12)} $${data.cost_usd.toFixed(6).padStart(12)} (${data.percentage.toFixed(1).padStart(5)}%) | ${duration} | ${data.api_calls} calls`
      );
    }

    console.log('\n' + '═'.repeat(70));
    console.log('              📈 SCALE ESTIMATES (based on real cost)');
    console.log('═'.repeat(70));

    console.log('\n💵 COST PER PRODUCT (ACTUAL):');
    console.log(`   $${estimate.basis.single_product_cost_usd.toFixed(6)} USD`);
    console.log(`   ${(estimate.basis.single_product_cost_usd * USD_TO_RON).toFixed(4)} RON`);
    console.log(`   ${estimate.basis.single_product_tokens.toLocaleString()} tokens`);
    console.log(`   ${estimate.basis.single_product_api_calls} API calls`);
    console.log(`   ${estimate.basis.single_product_duration_s.toFixed(1)}s duration`);

    console.log('\n📊 BATCH ESTIMATES:');
    const batches = ['batch_100', 'batch_1000', 'batch_10000', 'batch_100000'];
    for (const batchKey of batches) {
      const b = estimate.estimates[batchKey];
      console.log(
        `   ${b.products.toLocaleString().padStart(7)} products: $${b.cost_usd.toFixed(2).padStart(10)} | ${b.time_parallel_10x.days.toFixed(1)} days (10x parallel)`
      );
    }

    console.log('\n🏭 FULL CATALOG (900,000 products):');
    const fc = estimate.estimates.full_catalog;
    console.log(`   Total Cost:      $${fc.cost_usd.toFixed(2)} USD`);
    console.log(`                    ${fc.cost_ron.toFixed(2)} RON`);
    console.log(`   Time (1x):       ${fc.time_sequential.days.toFixed(1)} days`);
    console.log(`   Time (10x):      ${fc.time_parallel_10x.days.toFixed(1)} days`);
    console.log(`   Time (50x):      ${fc.time_parallel_50x.days.toFixed(1)} days`);

    console.log('\n💰 MONTHLY BUDGET → PRODUCTS:');
    for (const [budget, products] of Object.entries(estimate.monthly_budget_products)) {
      console.log(`   ${budget.padStart(6)}/month → ${products.toLocaleString()} products`);
    }

    console.log('\n' + '═'.repeat(70));

    return report;
  }
}

// === EXPORTS ===
// PRICING, USD_TO_RON, estimateTokens sunt deja exportate inline
export default CostTracker;
