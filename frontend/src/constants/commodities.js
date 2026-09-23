/** Tickers kept in sync with backend COMMODITIES (reliable live sources). */
export const CORE_COMMODITIES = [
  { ticker: 'GC=F', name: 'Gold', category: 'metals' },
  { ticker: 'SI=F', name: 'Silver', category: 'metals' },
  { ticker: 'PL=F', name: 'Platinum', category: 'metals' },
  { ticker: 'HG=F', name: 'Copper', category: 'metals' },
  { ticker: 'CL=F', name: 'Crude Oil WTI', category: 'energy' },
  { ticker: 'BZ=F', name: 'Brent Oil', category: 'energy' },
]

export const TICKER_ICONS = {
  'GC=F': '🥇',
  'SI=F': '🪙',
  'PL=F': '🔵',
  'HG=F': '🔶',
  'CL=F': '🛢️',
  'BZ=F': '🛢️',
}

export function displayPrice(c) {
  if (!c) return null
  return c.display_price != null ? c.display_price : c.price_inr
}

export function displayUnit(c) {
  if (!c) return ''
  return c.display_unit || c.unit || ''
}
