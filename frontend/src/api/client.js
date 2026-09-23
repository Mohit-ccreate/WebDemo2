import axios from 'axios'
const api = axios.create({ baseURL: '/api', timeout: 15000 })
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