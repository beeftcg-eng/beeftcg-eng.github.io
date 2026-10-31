// Tiny Supabase Realtime client (broadcast channels only), shared by Riftcast and the points app.
// It speaks the Phoenix channel protocol Supabase Realtime uses, over the standard WebSocket that
// both browsers and Node 22+ have, so neither side needs supabase-js.
//
//   const relay = new Relay({ url, key })
//   const ch = relay.channel('riftcast-ABC123', (event, payload) => { ... }, (status) => { ... })
//   ch.send('points', { points: 3 })
//   ch.leave()

export const RELAY_DEFAULTS = {
  // The Pairings project's public (anon) settings: safe to ship in a web page.
  url: 'https://rkoftnavclopwvewnook.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrb2Z0bmF2Y2xvcHd2ZXdub29rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMjgwMjksImV4cCI6MjEwMzYwNDAyOX0.oq47ygufpxv7-prk50wQl28VN4D5ilJ6mMRsv7RGNQQ',
}

export const channelName = (code) => `riftcast-${String(code).toUpperCase()}`

export class Relay {
  constructor({ url = RELAY_DEFAULTS.url, key = RELAY_DEFAULTS.key } = {}) {
    this.wsUrl = `${url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`
    this.key = key
    this.ws = null
    this.ref = 0
    this.channels = new Map() // topic -> channel
    this.open = false
    this.retry = 0
    this.closed = false
  }

  nextRef() {
    return String(++this.ref)
  }

  connect() {
    if (this.ws || this.closed) return
    let ws
    try {
      ws = new WebSocket(this.wsUrl)
    } catch {
      return this.scheduleReconnect()
    }
    this.ws = ws
    ws.onopen = () => {
      this.open = true
      this.retry = 0
      for (const ch of this.channels.values()) ch.join()
      clearInterval(this.beat)
      this.beat = setInterval(() => this.raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this.nextRef() }), 25_000)
    }
    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data))
      } catch {
        return
      }
      this.channels.get(msg.topic)?.receive(msg)
    }
    ws.onclose = () => {
      this.open = false
      this.ws = null
      clearInterval(this.beat)
      for (const ch of this.channels.values()) ch.setStatus('offline')
      this.scheduleReconnect()
    }
    ws.onerror = () => {}
  }

  scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return
    const delay = Math.min(15_000, 500 * 2 ** this.retry++)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  raw(msg) {
    if (this.open && this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(msg))
      return true
    }
    return false
  }

  /** Join a broadcast channel. onMessage(event, payload); onStatus('joining'|'joined'|'offline'|'error'). */
  channel(name, onMessage, onStatus = () => {}) {
    const topic = `realtime:${name}`
    const relay = this
    const ch = {
      topic,
      status: 'joining',
      joinRef: null,
      setStatus(s) {
        if (ch.status !== s) {
          ch.status = s
          onStatus(s)
        }
      },
      join() {
        ch.joinRef = relay.nextRef()
        ch.setStatus('joining')
        relay.raw({
          topic,
          event: 'phx_join',
          payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [], private: false }, access_token: relay.key },
          ref: ch.joinRef,
          join_ref: ch.joinRef,
        })
      },
      receive(msg) {
        if (msg.event === 'phx_reply' && msg.ref === ch.joinRef) ch.setStatus(msg.payload?.status === 'ok' ? 'joined' : 'error')
        else if (msg.event === 'broadcast' && msg.payload?.type === 'broadcast') onMessage(msg.payload.event, msg.payload.payload ?? {})
        else if (msg.event === 'phx_error' || msg.event === 'phx_close') {
          ch.setStatus('offline')
          if (relay.channels.has(topic)) setTimeout(() => relay.open && relay.channels.has(topic) && ch.join(), 1000)
        }
      },
      send(event, payload) {
        if (ch.status !== 'joined') return false
        return relay.raw({ topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: relay.nextRef(), join_ref: ch.joinRef })
      },
      leave() {
        relay.raw({ topic, event: 'phx_leave', payload: {}, ref: relay.nextRef(), join_ref: ch.joinRef })
        relay.channels.delete(topic)
      },
    }
    this.channels.set(topic, ch)
    if (this.open) ch.join()
    else this.connect()
    return ch
  }

  close() {
    this.closed = true
    clearInterval(this.beat)
    clearTimeout(this.reconnectTimer)
    try {
      this.ws?.close()
    } catch {}
  }
}
