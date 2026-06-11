const express = require('express')
const client = require('prom-client')

const app = express()
const PORT = process.env.PORT || 8080

// ─── MÉTRICAS PROMETHEUS ───────────────────────────────────────────
const register = new client.Registry()
client.collectDefaultMetrics({ register })

// Contador de requests totales
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de requests HTTP',
  labelNames: ['method', 'route', 'status'],
  registers: [register]
})

// Histograma de latencia
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duración de requests HTTP en ms',
  labelNames: ['method', 'route', 'status'],
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
  registers: [register]
})

// Gauge de requests concurrentes activos
const activeRequests = new client.Gauge({
  name: 'http_active_requests',
  help: 'Requests activos en este momento',
  registers: [register]
})

// ─── MIDDLEWARE DE MÉTRICAS ────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now()
  activeRequests.inc()

  res.on('finish', () => {
    const duration = Date.now() - start
    const route = req.route?.path || req.path
    const labels = { method: req.method, route, status: res.statusCode }

    httpRequestsTotal.inc(labels)
    httpRequestDuration.observe(labels, duration)
    activeRequests.dec()
  })

  next()
})

// ─── ENDPOINTS ─────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'cicdtraining',
    version: process.env.K_REVISION || 'local',
    timestamp: new Date().toISOString()
  })
})

// Simula trabajo con delay configurable
app.get('/api/work', async (req, res) => {
  const ms = Math.min(parseInt(req.query.ms) || 100, 10000)
  const fail = req.query.fail === 'true'

  await new Promise(resolve => setTimeout(resolve, ms))

  if (fail) {
    return res.status(500).json({ error: 'Error simulado', ms })
  }

  res.json({ ok: true, worked_ms: ms, timestamp: new Date().toISOString() })
})

// Prueba de concurrencia — dispara N requests internos en paralelo
app.get('/api/stress', async (req, res) => {
  const connections = Math.min(parseInt(req.query.connections) || 10, 100)
  const ms = Math.min(parseInt(req.query.ms) || 100, 5000)

  const start = Date.now()

  const results = await Promise.allSettled(
    Array.from({ length: connections }, () =>
      new Promise(resolve => setTimeout(() => resolve('ok'), ms))
    )
  )

  const fulfilled = results.filter(r => r.status === 'fulfilled').length
  const rejected  = results.filter(r => r.status === 'rejected').length
  const elapsed   = Date.now() - start

  res.json({
    connections,
    fulfilled,
    rejected,
    elapsed_ms: elapsed,
    throughput_rps: Math.round((fulfilled / elapsed) * 1000),
    timestamp: new Date().toISOString()
  })
})

// Endpoint de métricas para Prometheus / Cloud Monitoring
app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', register.contentType)
  res.send(await register.metrics())
})

// ─── ARRANQUE ──────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT}`)
})
