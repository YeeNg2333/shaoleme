// 「烧了么」Host half (pkg-44)
// This file is the exact `code.host` body passed to cordis_define: a plain
// JavaScript function body that `return`s a Cordis Plugin. It runs in the DSH
// Node process and owns the token/cost folding, the per-session snapshot, and
// the editable price table.
return {
  apply(ctx) {
    // Official DeepSeek rate card, CNY per 1M tokens, OFF-PEAK prices (peak = idle * 2).
    // Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing (v4 family).
    const OFFICIAL_IDLE = {
      'deepseek-v4-flash': { miss: 1.5, hit: 0.05, out: 4.5 },
      'deepseek-v4-flash-vision-exp': { miss: 1.5, hit: 0.05, out: 4.5 },
      'deepseek-v4-pro': { miss: 4.5, hit: 0.15, out: 13.5 },
    }
    // In-memory overrides set from the widget (model -> idle prices). '__default__' covers unknown models.
    const overrides = new Map()
    function rateFor(model) {
      const direct = overrides.get(model)
      if (direct !== undefined) return direct
      if (model !== '__default__' && OFFICIAL_IDLE[model] === undefined && overrides.has('__default__')) {
        return overrides.get('__default__')
      }
      const base = OFFICIAL_IDLE[model]
      return base === undefined ? null : { miss: base.miss, hit: base.hit, out: base.out }
    }
    // Beijing time (UTC+8) peak windows: Mon-Fri 09:00-12:00 and 14:00-18:00.
    function priceFactorAt(ts) {
      const d = new Date(ts + 8 * 3600 * 1000)
      const day = d.getUTCDay()
      if (day === 0 || day === 6) return 1
      const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
      return (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080) ? 2 : 1
    }
    function count(value) {
      return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
    }
    // TokenUsage counts are DISJOINT: inputTokens = uncached input, cacheReadTokens = cached input.
    function fold(events, now) {
      const totals = { input: 0, cacheRead: 0, output: 0, reasoning: 0, cacheWrite: 0, calls: 0 }
      const byModel = new Map()
      const unpricedModels = new Set()
      let yuan = 0
      for (const ev of events) {
        if (ev.type !== 'assistant/message') continue
        const data = ev.data
        if (!data || !data.usage || typeof data.usage !== 'object') continue
        const usage = data.usage
        const input = count(usage.inputTokens)
        const cacheRead = count(usage.cacheReadTokens)
        const output = count(usage.outputTokens)
        const reasoning = count(usage.reasoningTokens)
        const cacheWrite = count(usage.cacheWriteTokens)
        if (input + output + cacheRead + cacheWrite === 0) continue
        totals.input += input
        totals.cacheRead += cacheRead
        totals.output += output
        totals.reasoning += reasoning
        totals.cacheWrite += cacheWrite
        totals.calls += 1
        const source = data.message && data.message.source
        const provider = source && typeof source.provider === 'string' ? source.provider : ''
        const model = source && typeof source.model === 'string' ? source.model : ''
        const key = provider + '\u0000' + model
        let row = byModel.get(key)
        if (row === undefined) {
          row = { provider, model, input: 0, cacheRead: 0, output: 0, cost: 0, priced: true }
          byModel.set(key, row)
        }
        row.input += input
        row.cacheRead += cacheRead
        row.output += output
        const rate = rateFor(model)
        if (rate === null) {
          row.priced = false
          unpricedModels.add(model || '?')
          continue
        }
        const factor = priceFactorAt(ev.time || now)
        const cost = (input * rate.miss + cacheRead * rate.hit + output * rate.out) * factor / 1e6
        row.cost += cost
        yuan += cost
      }
      const models = []
      let unpriced = false
      for (const row of byModel.values()) {
        if (!row.priced) unpriced = true
        models.push({ provider: row.provider, model: row.model, input: row.input, cacheRead: row.cacheRead, output: row.output, cost: row.cost, priced: row.priced })
      }
      const rates = []
      const seen = new Set()
      const pushRate = (model) => {
        if (seen.has(model)) return
        seen.add(model)
        const rate = rateFor(model)
        rates.push({ model, miss: rate ? rate.miss : 0, hit: rate ? rate.hit : 0, out: rate ? rate.out : 0, known: rate !== null })
      }
      for (const row of byModel.values()) pushRate(row.model || '?')
      pushRate('__default__')
      return { totals, models, rates, yuan, unpricedModels: Array.from(unpricedModels), unpriced }
    }

    const sessionCache = new Map()
    harness.handle('snapshot', (argsJson) => {
      const sessionsService = ctx.get('sessions')
      if (sessionsService === undefined) return { ok: false, reason: 'no sessions service' }
      const args = argsJson && typeof argsJson === 'object' ? argsJson : {}
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : ''
      if (sessionId === '') return { ok: false, reason: 'missing sessionId' }
      const session = sessionsService.get(sessionId)
      if (session === undefined) return { ok: true, available: false, sessionId }
      const seq = session.seq
      const hit = sessionCache.get(sessionId)
      if (hit !== undefined && hit.seq === seq) {
        return { ok: true, available: true, sessionId, view: hit.view }
      }
      const folded = fold(session.snapshotEvents(), Date.now())
      const view = {
        sessionId,
        seq,
        tokens: {
          input: folded.totals.input,
          cacheRead: folded.totals.cacheRead,
          output: folded.totals.output,
          reasoning: folded.totals.reasoning,
          cacheWrite: folded.totals.cacheWrite,
          total: folded.totals.input + folded.totals.cacheRead + folded.totals.output,
        },
        calls: folded.totals.calls,
        models: folded.models,
        rates: folded.rates,
        yuan: folded.yuan,
        unpriced: folded.unpriced,
        unpricedModels: folded.unpricedModels,
      }
      sessionCache.set(sessionId, { seq, view })
      return { ok: true, available: true, sessionId, view }
    })

    harness.handle('setRate', (argsJson) => {
      const args = argsJson && typeof argsJson === 'object' ? argsJson : {}
      const model = typeof args.model === 'string' ? args.model : ''
      if (model === '') return { ok: false, reason: 'missing model' }
      const num = (v, fallback) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
      overrides.set(model, {
        miss: num(args.miss, 0),
        hit: num(args.hit, 0),
        out: num(args.out, 0),
      })
      sessionCache.clear()
      return { ok: true }
    })
  },
}
