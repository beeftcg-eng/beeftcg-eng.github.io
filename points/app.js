// Riftbound Points: a two-player point counter that works on its own, and can link one player's
// score to a Riftcast stream with a code from the tournament organiser.
//
// Linking: the app and Riftcast meet on a Supabase Realtime broadcast channel named after the code.
//   app -> stream:  hello {}, ping {}, points { points, kind: 'conquer' | 'hold' | 'minus' }
//   stream -> app:  state { me, them, winPoints, event, round }, expired {}
import { Relay, channelName } from './relay.js'

const $ = (s) => document.querySelector(s)
const STORE = 'riftbound-points-v1'
const CODE_RE = /^[A-HJ-NP-Z2-9]{4,8}$/ // the alphabet Riftcast uses: no 0/O/1/I/L

const defaults = { me: 0, them: 0, meName: '', themName: '', win: 8, flip: true, buzz: true, awake: true, code: null, log: [] }
let s = { ...defaults, ...load() }
if (!Array.isArray(s.log)) s.log = []
let stream = null // last scoreboard from the stream while linked
let relay = null
let ch = null
let linkStatus = 'off' // off | joining | joined | offline | error
let lastHeard = 0
let pending = false // a tap made while the link was down still needs sending
let localTapAt = 0
let pingTimer = null
let booted = false

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) ?? {}
  } catch {
    return {}
  }
}
const save = () => localStorage.setItem(STORE, JSON.stringify(s))
const clampPts = (n) => Math.max(0, Math.min(99, n))
const linked = () => !!s.code

// ---- Rendering ----

function pips(el, n, win) {
  const want = Math.min(win, 30)
  if (el.children.length !== want) el.innerHTML = '<i class="pip"></i>'.repeat(want)
  ;[...el.children].forEach((p, i) => p.classList.toggle('on', i < n))
}

function render() {
  const win = (linked() && stream?.winPoints) || s.win
  const meName = (linked() && stream?.me?.name) || s.meName || 'You'
  const themName = (linked() && stream?.them?.name) || s.themName || 'Opponent'
  const them = linked() && stream ? stream.them.points : s.them
  $('#meName').textContent = meName
  $('#themName').textContent = themName
  $('#mePts').textContent = s.me
  $('#themPts').textContent = them
  pips($('#mePips'), s.me, win)
  pips($('#themPips'), them, win)
  animateChange('me', s.me)
  animateChange('them', them)
  setWon('me', s.me >= win)
  setWon('them', them >= win)
  renderAlerts({ me: s.me, them }, { me: meName, them: themName }, win)
  // While linked the stream keeps the opponent's score (from their own phone or the organiser).
  for (const b of document.querySelectorAll('.zone[data-who="them"]')) b.disabled = linked()
  $('#resetBtn').disabled = linked()
  document.body.classList.toggle('flip', s.flip && !linked())

  const btn = $('#linkBtn')
  btn.classList.toggle('on', linked() && linkStatus === 'joined' && !!stream)
  btn.classList.toggle('warn', linked() && !(linkStatus === 'joined' && stream))
  btn.textContent = !linked() ? '📡 Link to stream' : linkStatus === 'joined' && stream ? `📡 Live · ${s.code}` : `📡 Connecting… ${s.code}`

  let meNote = '', themNote = ''
  if (linked()) {
    if (linkStatus !== 'joined') meNote = navigator.onLine === false ? 'No internet: taps will send when you are back online' : 'Connecting to the stream…'
    else if (!stream) meNote = 'Waiting for the stream to answer…'
    else if (Date.now() - lastHeard > 60_000) meNote = 'The stream has gone quiet: is Riftcast still running?'
    else meNote = [stream.event, stream.round].filter(Boolean).join(' · ')
    themNote = stream ? 'Kept by the stream' : ''
  }
  $('#meNote').textContent = meNote
  $('#themNote').textContent = themNote
}

// One point from winning: warn the other player, and remind the player on the brink how the
// final point works (Riftbound: a Conquer only scores it if you scored every battlefield this turn).
function renderAlerts(pts, names, win) {
  const over = pts.me >= win || pts.them >= win
  for (const who of ['me', 'them']) {
    const other = who === 'me' ? 'them' : 'me'
    const lines = []
    if (!over && win > 1 && pts[other] === win - 1) lines.push(`<div class="alert danger">⚠ ${names[other] === 'You' ? 'You are' : `${esc(names[other])} is`} at ${pts[other]}: one point from winning</div>`)
    if (!over && win > 1 && pts[who] === win - 1) lines.push(`<div class="alert legend">Final point: 🛡 Hold, or ⚔ Conquer only with every battlefield scored this turn</div>`)
    const html = lines.join('')
    const el = $(`#${who}Alerts`)
    if (el.innerHTML !== html) el.innerHTML = html
    $(`#${who}`).classList.toggle('threat', !over && pts[other] === win - 1)
  }
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// ---- Log ----

const KIND = {
  conquer: { ico: '⚔', text: 'Conquer' },
  hold: { ico: '🛡', text: 'Hold' },
  minus: { ico: '−', text: 'Correction' },
  card: { ico: '🃏', text: 'Conquer at the final point: drew a card instead' },
  stream: { ico: '📡', text: 'Updated from the stream' },
  undo: { ico: '↶', text: 'Undo' },
}
const nameOf = (who) => (who === 'me' ? (linked() && stream?.me?.name) || s.meName || 'You' : (linked() && stream?.them?.name) || s.themName || 'Opponent')

function addLog(who, kind, from, to) {
  s.log.push({ t: Date.now(), who, kind, from, to, name: nameOf(who) })
  if (s.log.length > 300) s.log = s.log.slice(-300)
}

function renderLog() {
  const tally = { me: { conquer: 0, hold: 0, minus: 0 }, them: { conquer: 0, hold: 0, minus: 0 } }
  // Totals for the current game: everything since the last reset.
  const lastReset = s.log.findLastIndex((e) => e.kind === 'reset')
  for (const e of s.log.slice(lastReset + 1)) {
    if (['conquer', 'hold', 'minus'].includes(e.kind)) tally[e.who][e.kind] += Math.abs(e.to - e.from)
  }
  const them = linked() && stream ? stream.them.points : s.them
  $('#tally').innerHTML = ['me', 'them'].map((who) => `<div class="${who}">
    <h3>${esc(nameOf(who))}</h3>
    <div class="big">${who === 'me' ? s.me : them}</div>
    <div class="split">⚔ ${tally[who].conquer} conquer · 🛡 ${tally[who].hold} hold${tally[who].minus ? ` · −${tally[who].minus} corrected` : ''}</div>
  </div>`).join('')
  const time = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  $('#logList').innerHTML = s.log.length
    ? [...s.log].reverse().map((e) => e.kind === 'reset'
      ? `<li class="divider">New game · ${time(e.t)}</li>`
      : `<li><span class="t">${time(e.t)}</span><span>${KIND[e.kind]?.ico ?? '•'}</span><span><span class="who-${e.who}">${esc(e.name)}</span> ${esc(KIND[e.kind]?.text ?? e.kind)}</span><span class="score">${e.from} → ${e.to}</span></li>`).join('')
    : '<li class="empty">No points yet this session.</li>'
  $('#undoBtn').disabled = !undoable()
}

function undoable() {
  for (let i = s.log.length - 1; i >= 0; i--) {
    const e = s.log[i]
    if (e.kind === 'reset') return null
    if (['conquer', 'hold', 'minus'].includes(e.kind) && !(linked() && e.who === 'them')) return i
  }
  return null
}

$('#logBtn').addEventListener('click', () => {
  renderLog()
  $('#logDlg').showModal()
})
$('#undoBtn').addEventListener('click', () => {
  const i = undoable()
  if (i === null) return
  const e = s.log[i]
  s.log.splice(i, 1)
  setScore(e.who, e.from, 'undo', false)
  renderLog()
})
$('#clearLogBtn').addEventListener('click', (ev) => {
  const b = ev.currentTarget
  if (!b.dataset.armed) {
    b.dataset.armed = '1'
    b.textContent = 'Tap again to clear'
    setTimeout(() => {
      delete b.dataset.armed
      b.textContent = 'Clear'
    }, 2500)
    return
  }
  delete b.dataset.armed
  b.textContent = 'Clear'
  s.log = []
  save()
  renderLog()
})

// ---- Flair ----

const shown = { me: null, them: null }
const won = { me: false, them: false }
const calm = matchMedia('(prefers-reduced-motion: reduce)')

function animateChange(who, n) {
  const before = shown[who]
  shown[who] = n
  if (before === null || before === n || calm.matches) return
  const el = $(`#${who}Pts`)
  el.classList.remove('bump', 'dip')
  void el.offsetWidth // restart the animation on fast taps
  el.classList.add(n > before ? 'bump' : 'dip')
  const f = document.createElement('div')
  f.className = 'float'
  f.textContent = `${n > before ? '+' : '−'}${Math.abs(n - before)}`
  $(`#${who}`).appendChild(f)
  f.addEventListener('animationend', () => f.remove())
}

function setWon(who, isWon) {
  const side = $(`#${who}`)
  side.classList.toggle('won', isWon)
  let banner = side.querySelector('.victory')
  if (isWon && !banner) {
    banner = document.createElement('div')
    banner.className = 'victory'
    banner.textContent = '🏆 Victory 🏆'
    side.prepend(banner)
  } else if (!isWon) banner?.remove()
  if (isWon && !won[who] && shown[who] !== null && booted) confetti(side)
  won[who] = isWon
}

function confetti(side) {
  if (calm.matches) return
  const r = side.getBoundingClientRect()
  const colors = ['#f4d58d', '#ffe9a8', '#8cc2ff', '#ffab88', '#c39bff', '#7ee787']
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i')
    c.className = 'confetti'
    c.style.background = colors[i % colors.length]
    document.body.appendChild(c)
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2
    const ang = Math.random() * Math.PI * 2, speed = 120 + Math.random() * 260
    const dx = Math.cos(ang) * speed, dy = Math.sin(ang) * speed - 160
    c.animate(
      [
        { transform: `translate(${x0}px, ${y0}px) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${x0 + dx}px, ${y0 + dy + 420}px) rotate(${Math.random() * 900 - 450}deg)`, opacity: 0 },
      ],
      { duration: 1400 + Math.random() * 900, easing: 'cubic-bezier(.2,.6,.4,1)' },
    ).onfinish = () => c.remove()
  }
  if (s.buzz) navigator.vibrate?.([40, 60, 40, 60, 120])
}

// ---- Install ----

let installEvent = null
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installEvent = e
  $('#installBtn').hidden = false
})
window.addEventListener('appinstalled', () => {
  installEvent = null
  $('#installBtn').hidden = true
  toast('Installed! Find Riftbound Points on your home screen.')
})

async function install() {
  if (installEvent) {
    installEvent.prompt()
    await installEvent.userChoice.catch(() => {})
    installEvent = null
    $('#installBtn').hidden = true
    return
  }
  const steps = isIOS
    ? ['Open this page in <b>Safari</b>.', 'Tap the <b>Share</b> button (the square with an arrow).', 'Choose <b>Add to Home Screen</b>, then <b>Add</b>.']
    : ['Open the browser menu (<b>⋮</b>).', 'Tap <b>Install app</b> or <b>Add to Home screen</b>.', 'Confirm, and it appears with your other apps.']
  $('#installIntro').textContent = standalone() ? 'You are already using the installed app.' : 'Put it on your home screen so it opens like an app and works with no signal.'
  $('#installSteps').innerHTML = standalone() ? '' : steps.map((x) => `<li>${x}</li>`).join('')
  $('#installDlg').showModal()
}
$('#installBtn').addEventListener('click', install)
$('#installHelpBtn').addEventListener('click', () => {
  $('#menuDlg').close()
  install()
})
// iPhones never offer a prompt: show the button anyway, it explains the Share menu steps.
if (isIOS && !standalone()) $('#installBtn').hidden = false

function toast(msg, ms = 3500) {
  const t = $('#toast')
  t.textContent = msg
  t.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => (t.hidden = true), ms)
}

// ---- Points ----

const scoreOf = (who) => (who === 'me' ? s.me : linked() && stream ? stream.them.points : s.them)
const winTarget = () => (linked() && stream?.winPoints) || s.win

/** Set a player's score, log it (unless log=false) and tell the stream about our own changes. */
function setScore(who, to, kind, log = true) {
  if (who === 'them' && linked()) return
  const from = scoreOf(who)
  to = clampPts(to)
  if (to === from) return
  if (log) addLog(who, kind, from, to)
  if (who === 'them') s.them = to
  else {
    s.me = to
    if (linked()) {
      localTapAt = Date.now()
      pending = !ch?.send('points', { points: s.me, kind })
    }
  }
  if (s.buzz) navigator.vibrate?.(to > from ? 25 : [15, 40, 15])
  save()
  render()
}

function score(who, kind) {
  if (who === 'them' && linked()) return
  if (kind === 'minus') return setScore(who, scoreOf(who) - 1, 'minus')
  const now = scoreOf(who), win = winTarget()
  if (now >= win) return toast(`${nameOf(who)} has already won. Reset for a new game.`)
  // Riftbound's final point rule: conquering only scores it if you scored every battlefield this turn.
  if (kind === 'conquer' && now === win - 1) return askFinalPoint(who)
  setScore(who, now + 1, kind)
}

let finalFor = null
function askFinalPoint(who) {
  finalFor = who
  $('#finalText').textContent = `${nameOf(who)} is on ${scoreOf(who)}. The final point only comes from a conquer if every battlefield was scored this turn. Otherwise that player draws a card instead.`
  $('#finalDlg').showModal()
}
document.querySelectorAll('[data-final]').forEach((btn) => btn.addEventListener('click', () => {
  const who = finalFor, v = btn.dataset.final
  finalFor = null
  $('#finalDlg').close()
  if (!who) return
  if (v === 'yes') setScore(who, scoreOf(who) + 1, 'conquer')
  else if (v === 'no') {
    addLog(who, 'card', scoreOf(who), scoreOf(who))
    save()
    toast(`${nameOf(who)} draws a card instead of scoring.`)
  }
}))
$('#finalDlg').addEventListener('close', () => (finalFor = null))

// Tap a zone to score. Holding the minus half keeps counting down (handy for fixing a score).
document.querySelectorAll('.zone').forEach((z) => {
  let holdTimer = null, repeatTimer = null, repeated = false
  const stop = () => {
    clearTimeout(holdTimer)
    clearInterval(repeatTimer)
    holdTimer = repeatTimer = null
  }
  const step = () => score(z.dataset.who, z.dataset.kind)
  const repeats = z.dataset.kind === 'minus'
  z.addEventListener('pointerdown', (e) => {
    if (z.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
    const r = z.getBoundingClientRect()
    z.style.setProperty('--x', `${((e.clientX - r.left) / r.width) * 100}%`)
    z.style.setProperty('--y', `${((e.clientY - r.top) / r.height) * 100}%`)
    z.classList.add('flash')
    repeated = false
    stop()
    if (repeats) holdTimer = setTimeout(() => {
      repeated = true
      step()
      repeatTimer = setInterval(step, 160)
    }, 500)
  })
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) z.addEventListener(ev, () => {
    stop()
    z.classList.remove('flash')
  })
  z.addEventListener('click', () => {
    if (repeated) repeated = false
    else step()
  })
  z.addEventListener('contextmenu', (e) => e.preventDefault())
})

$('#resetBtn').addEventListener('click', (e) => {
  const b = e.currentTarget
  if (!b.dataset.armed) {
    b.dataset.armed = '1'
    b.textContent = 'Tap again'
    setTimeout(() => {
      delete b.dataset.armed
      b.textContent = '↺ Reset'
    }, 2500)
    return
  }
  delete b.dataset.armed
  b.textContent = '↺ Reset'
  if (s.me || s.them) s.log.push({ t: Date.now(), kind: 'reset' })
  s.me = 0
  s.them = 0
  save()
  render()
})

// ---- Linking ----

function link(code) {
  unlink(false)
  s.code = code
  stream = null
  save()
  relay = new Relay()
  linkStatus = 'joining'
  ch = relay.channel(channelName(code), onMessage, (st) => {
    linkStatus = st
    if (st === 'joined') {
      if (pending) pending = !ch.send('points', { points: s.me, kind: 'sync' })
      else ch.send('hello', {})
    }
    render()
  })
  clearInterval(pingTimer)
  pingTimer = setInterval(() => {
    if (linkStatus === 'joined') ch.send('ping', {})
    render()
  }, 20_000)
  // No answer at all after a while: most likely a mistyped code or Riftcast isn't running.
  setTimeout(() => {
    if (s.code === code && !stream) toast(`No answer for code ${code}. Check the code with the organiser.`, 6000)
  }, 10_000)
  render()
}

function unlink(announce = true) {
  clearInterval(pingTimer)
  ch?.leave()
  relay?.close()
  relay = ch = null
  linkStatus = 'off'
  pending = false
  if (s.code && announce) toast('Unlinked from the stream')
  // Keep counting from where the stream was.
  if (stream) {
    s.them = stream.them.points
    s.themName = stream.them.name || s.themName
  }
  stream = null
  s.code = null
  save()
  render()
}

function onMessage(event, p) {
  lastHeard = Date.now()
  if (event === 'expired') {
    toast('That match is over. Ask the organiser for the new code if you are playing on stream again.', 6000)
    unlink(false)
    return
  }
  if (event !== 'state' || !p?.me || !p?.them) return
  const first = !stream
  const prevThem = stream?.them?.points
  stream = p
  if (!first && Number.isFinite(p.them.points) && p.them.points !== prevThem) addLog('them', 'stream', prevThem, p.them.points)
  // The stream is the record (the organiser can fix scores too), except right after our own tap.
  if (Date.now() - localTapAt > 1500 && Number.isFinite(p.me.points) && clampPts(p.me.points) !== s.me) {
    if (!first) addLog('me', 'stream', s.me, clampPts(p.me.points))
    s.me = clampPts(p.me.points)
  }
  if (first) toast(`Linked: you are ${p.me.name || 'on stream'}`)
  save()
  render()
}

$('#linkBtn').addEventListener('click', () => {
  if (linked()) {
    $('#linkedInfo').textContent = stream
      ? `Code ${s.code}: you are ${stream.me.name} vs ${stream.them.name}. Your points show on the stream as you tap.`
      : `Code ${s.code}: waiting for the stream to answer. Check the code if this doesn't change.`
    $('#linkedDlg').showModal()
  } else {
    $('#codeIn').value = ''
    $('#linkErr').textContent = ''
    $('#linkDlg').showModal()
    $('#codeIn').focus()
  }
})

$('#codeIn').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  $('#linkErr').textContent = ''
})

$('#linkForm').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'go') return
  const code = $('#codeIn').value.trim().toUpperCase()
  if (!CODE_RE.test(code)) {
    e.preventDefault()
    $('#linkErr').textContent = 'Codes are 6 letters and numbers, like ABC234.'
    return
  }
  link(code)
})

$('#unlinkBtn').addEventListener('click', () => unlink())

// ---- Settings ----

$('#menuBtn').addEventListener('click', () => {
  $('#nameIn').value = s.meName
  $('#oppIn').value = s.themName
  $('#winIn').value = s.win
  $('#flipIn').checked = s.flip
  $('#buzzIn').checked = s.buzz
  $('#awakeIn').checked = s.awake
  $('#menuDlg').showModal()
})
$('#menuDlg').addEventListener('close', () => {
  s.meName = $('#nameIn').value.trim()
  s.themName = $('#oppIn').value.trim()
  s.win = Math.max(1, Math.min(30, Math.round(Number($('#winIn').value)) || 8))
  s.flip = $('#flipIn').checked
  s.buzz = $('#buzzIn').checked
  s.awake = $('#awakeIn').checked
  save()
  keepAwake()
  render()
})

// Keep the screen on during a game (the browser drops the lock when the app is hidden).
let wakeLock = null
async function keepAwake() {
  if (!s.awake) {
    wakeLock?.release().catch(() => {})
    wakeLock = null
    return
  }
  if (wakeLock || document.visibilityState !== 'visible' || !navigator.wakeLock) return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => (wakeLock = null))
  } catch {}
}
document.addEventListener('visibilitychange', keepAwake)
// Some browsers only grant the lock after a tap.
document.addEventListener('pointerdown', keepAwake, { once: true })

// ---- Start ----

// A QR code from the organiser opens .../points/#ABC234: link straight away.
function codeFromHash() {
  const code = decodeURIComponent(location.hash.slice(1)).trim().toUpperCase()
  if (!code) return
  history.replaceState(null, '', location.pathname + location.search)
  if (CODE_RE.test(code) && code !== s.code) link(code)
}
window.addEventListener('hashchange', codeFromHash)
window.addEventListener('online', render)
window.addEventListener('offline', render)

if (s.code) link(s.code)
codeFromHash()
render()
booted = true
keepAwake()

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {})
