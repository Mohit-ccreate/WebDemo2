import { useEffect, useRef, useState, useCallback } from 'react'
const WS_URL = 'ws://localhost:8000/ws/prices'

export function useWebSocket() {
  const [prices, setPrices]       = useState({})
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const wsRef      = useRef(null)
  const retryRef   = useRef(null)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws
      ws.onopen    = () => { if (mountedRef.current) setConnected(true) }
      ws.onmessage = (e) => {
        if (!mountedRef.current) return
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'price_update' && msg.data) {
            const map = {}
            const arr = Array.isArray(msg.data) ? msg.data : Object.values(msg.data)
            arr.forEach(c => { if (c.ticker) map[c.ticker] = c })
            setPrices(prev => ({ ...prev, ...map }))
            setLastUpdate(new Date())
          }
        } catch (_) {}
      }
      ws.onclose = () => {
        if (!mountedRef.current) return
        setConnected(false)
        retryRef.current = setTimeout(connect, 3000)
      }
      ws.onerror = () => ws.close()
    } catch (_) {
      retryRef.current = setTimeout(connect, 3000)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { prices, connected, lastUpdate }
}