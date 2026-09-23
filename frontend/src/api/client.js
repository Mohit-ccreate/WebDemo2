import axios from 'axios'

// Resolve API base URL: environment variable (Vite or CRA) or production Render default
function resolveApiBaseUrl() {
  const envUrl =
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ||
    (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL) ||
    'https://webdemo2-1.onrender.com'

  const trimmed = envUrl.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
}

export const API_BASE_URL = resolveApiBaseUrl()

// Rate limiting (429) cooldown tracking
let rateLimitResetTime = 0

export function isApiRateLimited() {
  return Date.now() < rateLimitResetTime
}

export function getRateLimitRemainingSeconds() {
  return Math.max(0, Math.ceil((rateLimitResetTime - Date.now()) / 1000))
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
})

// Response interceptor to catch 429 Too Many Requests and enforce backoff
let last429LogTime = 0
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 429) {
      const retryAfterHeader = error.response.headers?.['retry-after']
      const retryAfterSeconds = parseInt(retryAfterHeader, 10) || 60
      rateLimitResetTime = Date.now() + retryAfterSeconds * 1000

      const now = Date.now()
      if (now - last429LogTime > 10000) {
        last429LogTime = now
        console.warn(
          `[API 429] Server rate limit reached. Backing off requests for ${retryAfterSeconds}s.`
        )
      }
    }
    return Promise.reject(error)
  }
)

export const fetchAllPrices     = ()         => api.get('/prices/')
export const fetchHistory       = (t, p)     => api.get(`/prices/${t}/history?period=${p}`)
export const fetchPrediction    = (t, d)     => api.get(`/predictions/${encodeURIComponent(t)}?days=${d}`)
export const fetchTodayPrediction = (t)      => api.get(`/predictions/${encodeURIComponent(t)}/today`, { timeout: 120000 })
export const fetchAllTodayPredictions = (refresh = false) =>
  api.get('/predictions/today', { params: { refresh }, timeout: 300000 })
export const trainModel         = (t)        => api.post(`/predictions/${encodeURIComponent(t)}/train`)
export const fetchModelReady    = (t)        => api.get(`/predictions/${encodeURIComponent(t)}/ready`)
export const fetchAlerts        = ()         => api.get('/alerts/')
export const createAlert        = (data)     => api.post('/alerts/', data)
export const deleteAlert        = (id)       => api.delete(`/alerts/${id}`)
export const disableAlert       = (id)       => api.patch(`/alerts/${id}/disable`)
export const fetchNotifications = ()         => api.get('/alerts/notifications')

// Stocks + ML + sentiment (backend /api/stocks, /api/sentiment)
export const fetchStockQuote = (symbol) =>
  api.get(`/stocks/${encodeURIComponent(symbol)}/quote`)
export const fetchStockIndicators = (symbol, period = '1y') =>
  api.get(`/stocks/${encodeURIComponent(symbol)}/indicators`, { params: { period }, timeout: 60000 })
export const fetchStockNews = (symbol) =>
  api.get(`/stocks/${encodeURIComponent(symbol)}/news`, { timeout: 60000 })
export const fetchStockPipeline = (symbol) =>
  api.get(`/stocks/${encodeURIComponent(symbol)}/pipeline`, { params: { period: '1y' }, timeout: 120000 })
export const fetchFusionPredictionHistory = (symbol, limit = 30) =>
  api.get(`/stocks/${encodeURIComponent(symbol)}/predictions/history`, { params: { limit } })
export const fetchStockFusion = (symbol, period = '1y') =>
  api.get(`/stocks/${encodeURIComponent(symbol)}/fusion`, { params: { period }, timeout: 120000 })
export const postStockBacktest = (symbol, body) =>
  api.post(`/stocks/${encodeURIComponent(symbol)}/backtest`, body, { timeout: 120000 })
export const postSentimentAnalyze = (texts, fast = false) =>
  api.post('/sentiment/analyze', { texts }, { params: { fast }, timeout: 120000 })
export const fetchSentimentHealth = () => api.get('/sentiment/health', { timeout: 180000 })

export default api