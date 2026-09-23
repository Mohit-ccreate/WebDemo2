import { useEffect, useRef, useState, useCallback } from 'react'
import { API_BASE_URL, fetchAllPrices, isApiRateLimited } from '../api/client'

// Dynamically determine WebSocket URL from env or backend API URL
function getWebSocketUrl() {
  const envWs =
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_WS_URL) || ''
  if (envWs) return envWs.trim()

  const apiBase = API_BASE_URL || 'https://webdemo2-1.onrender.com/api'

  if (apiBase.startsWith('http://localhost') || apiBase.startsWith('http://127.0.0.1')) {
    return apiBase.replace(/^http/, 'ws').replace(/\/api\/?$/, '') + '/ws/prices'
  }

  if (apiBase.startsWith('/')) {
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${proto}//${window.location.host}/ws/prices`
    }
    return 'ws://localhost:8000/ws/prices'
  }

  return (
    apiBase
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
      .replace(/\/api\/?$/, '') + '/ws/prices'
  )
}

const INITIAL_RETRY_MS = 3000
const MAX_RETRY_MS = 30000
const REST_POLL_INTERVAL_MS = 45000

export function useWebSocket() {
  const [prices, setPrices] = useState({})
  const [connected, setConnected] = useState(false)
  const [isRestFallback, setIsRestFallback] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)

  const wsRef = useRef(null)
  const retryRef = useRef(null)
  const pollRef = useRef(null)
  const mountedRef = useRef(true)
  const retryDelayRef = useRef(INITIAL_RETRY_MS)

  // Safe fallback REST polling when WebSocket is disconnected
  const fetchFallbackPrices = useCallback(async () => {
    if (!mountedRef.current) return
    if (isApiRateLimited()) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

    try {
      const res = await fetchAllPrices()
      if (!mountedRef.current) return
      const list = res.data?.data || []
      if (list.length > 0) {
        const map = {}
        list.forEach((c) => {
          if (c.ticker) map[c.ticker] = c
        })
        setPrices((prev) => ({ ...prev, ...map }))
        setLastUpdate(new Date())
        setIsRestFallback(true)
      }
    } catch (e) {
      // Handled silently by interceptor or rate-limiter cooldown
    }
  }, [])

  const connect = useCallback(() => {
    if (!mountedRef.current) return

    // Clean up any existing connection
    if (wsRef.current) {
      try {
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        wsRef.current.close()
      } catch (_) {}
      wsRef.current = null
    }

    try {
      const wsUrl = getWebSocketUrl()
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        setConnected(true)
        setIsRestFallback(false)
        retryDelayRef.current = INITIAL_RETRY_MS
      }

      ws.onmessage = (e) => {
        if (!mountedRef.current) return
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'price_update' && msg.data) {
            const map = {}
            const arr = Array.isArray(msg.data) ? msg.data : Object.values(msg.data)
            arr.forEach((c) => {
              if (c.ticker) map[c.ticker] = c
            })
            setPrices((prev) => ({ ...prev, ...map }))
            setLastUpdate(new Date())
          }
        } catch (_) {}
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setConnected(false)

        // Schedule reconnect with exponential backoff
        clearTimeout(retryRef.current)
        const delay = retryDelayRef.current
        retryDelayRef.current = Math.min(delay * 2, MAX_RETRY_MS)
        retryRef.current = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        try {
          ws.close()
        } catch (_) {}
      }
    } catch (_) {
      if (!mountedRef.current) return
      setConnected(false)
      clearTimeout(retryRef.current)
      const delay = retryDelayRef.current
      retryDelayRef.current = Math.min(delay * 2, MAX_RETRY_MS)
      retryRef.current = setTimeout(connect, delay)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()

    // When WebSocket is disconnected, periodically poll prices via REST
    pollRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        fetchFallbackPrices()
      }
    }, REST_POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      clearTimeout(retryRef.current)
      clearInterval(pollRef.current)
      if (wsRef.current) {
        try {
          wsRef.current.onclose = null
          wsRef.current.onerror = null
          wsRef.current.close()
        } catch (_) {}
        wsRef.current = null
      }
    }
  }, [connect, fetchFallbackPrices])

  return { prices, connected, isRestFallback, lastUpdate }
}