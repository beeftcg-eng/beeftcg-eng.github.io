// Free, offline rules search: the official Core Rules and Tournament Rules split into numbered
// entries, plus every card's text (rules-data.json, made by scripts/build-rules-data.mjs).
// Shared by the points app and Riftcast's control panel.
//
//   const rb = await loadRules('rules-data.json')
//   rb.search('does hunt give xp on a hold')  ->  { rules: [{ doc, ref, text, heading }], cards: [{ name, type, text }] }

const STOP = new Set('a an and are as at be but by can do does for from has have how i if in into is it its me my of on or so that the their them then there they this to was what when where which while who why will with you your yes no not get gets got any all after before during happen happens'.split(' '))
const stem = (w) => (w.length > 4 ? w.replace(/(ings?|ed|es|s)$/, '') : w)
const words = (t) => String(t).toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9'.]+/g, ' ').split(' ').map((w) => w.replace(/^'+|'+$|\.+$/g, '')).filter(Boolean)
const terms = (t) => [...new Set(words(t).filter((w) => !STOP.has(w)).map(stem))]

/** Card symbols as words: ":rb_might:" -> "[Might]". */
export const cardText = (t) => String(t ?? '')
  .replace(/:rb_energy_(\d+):/g, '[$1 Energy]')
  .replace(/:rb_might:/g, '[Might]')
  .replace(/:rb_power:/g, '[Power]')
  .replace(/:rb_rune_rainbow:/g, '[any rune]')
  .replace(/:rb_rune_(\w+):/g, (_, d) => `[${d[0].toUpperCase()}${d.slice(1)} rune]`)
  .replace(/:rb_(\w+):/g, '[$1]')

class RuleBook {
  constructor(data) {
    this.updated = data.coreUpdated
    const docs = [['core', data.core], ['tournament', data.tournament ?? []]]
    this.rules = docs.flatMap(([doc, list]) => list.map(([ref, text, heading]) => ({ doc, ref, text, heading, t: new Set(terms(text)), h: new Set(terms(heading)) })))
    this.cards = (data.cards ?? []).map(([name, type, text]) => ({ name, type, text, n: words(name).join(' '), nt: new Set(terms(name)), t: new Set(terms(text)) }))
    // Rarer words count for more ("xp" beats "unit").
    this.df = new Map()
    for (const r of this.rules) for (const w of r.t) this.df.set(w, (this.df.get(w) ?? 0) + 1)
  }

  weight(w) {
    return Math.log(1 + this.rules.length / (1 + (this.df.get(w) ?? 0)))
  }

  search(query, { rules: maxRules = 8, cards: maxCards = 4 } = {}) {
    const q = String(query).trim()
    // A rule number on its own ("730.1"): that rule and the ones under it.
    const ref = /^(\d{3}(?:\.(?:\d+|[a-z]))*)\.?$/i.exec(q)?.[1]?.toLowerCase()
    if (ref) return { rules: this.rules.filter((r) => r.ref === ref || r.ref.startsWith(`${ref}.`)).slice(0, 30), cards: [] }
    const qt = terms(q)
    if (!qt.length) return { rules: [], cards: [] }
    const phrase = words(q).join(' ')

    const scored = []
    for (const r of this.rules) {
      let s = 0, hits = 0
      for (const w of qt) {
        if (r.t.has(w)) (s += this.weight(w)), hits++
        else if (r.h.has(w)) (s += this.weight(w) * 0.5), hits++
      }
      if (!hits) continue
      s *= hits / qt.length // entries matching more of the question first
      if (r.text.length < 30) s *= 0.6 // bare section titles say little on their own
      scored.push([s, r])
    }
    scored.sort((a, b) => b[0] - a[0])

    const cards = []
    for (const c of this.cards) {
      let s = 0
      if (c.n.length >= 3 && ` ${phrase} `.includes(` ${c.n} `)) s += 100 // the full name is in the question
      const nameHits = qt.filter((w) => c.nt.has(w)).length
      // Part of a name counts only when it's most of it ("gustwalker", "master yi"), not one common word.
      if (nameHits && (nameHits === c.nt.size || nameHits >= 2)) s += 20 * (nameHits / c.nt.size) * nameHits
      if (s) cards.push([s, c])
    }
    cards.sort((a, b) => b[0] - a[0])

    return {
      rules: scored.slice(0, maxRules).map(([, r]) => r),
      cards: cards.slice(0, maxCards).map(([, c]) => c),
    }
  }
}

const loaded = new Map()
/** Loads (once) and returns the rule book. */
export function loadRules(url) {
  if (!loaded.has(url)) {
    loaded.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`rules data: ${r.status}`)
      return r.json()
    }).then((d) => new RuleBook(d)).catch((e) => {
      loaded.delete(url)
      throw e
    }))
  }
  return loaded.get(url)
}

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** Search results as HTML (.rb-* classes, styled by each page). */
export function searchHtml(result, query) {
  if (!result.rules.length && !result.cards.length) return query.trim() ? '<div class="rb-empty">Nothing in the rulebook matches that. Try other words, a card name, or a rule number like 730.</div>' : ''
  const marks = new Set(terms(query))
  const mark = (t) => esc(t).replace(/[A-Za-z0-9']+/g, (w) => (marks.has(stem(w.toLowerCase())) ? `<mark>${w}</mark>` : w))
  return `${result.cards.map((c) => `<div class="rb-card"><div class="rb-h">🃏 <b>${esc(c.name)}</b> · ${esc(c.type)}</div><div>${esc(cardText(c.text)) || '<i>No rules text</i>'}</div></div>`).join('')}
    ${result.rules.map((r) => `<div class="rb-rule"><div class="rb-h"><b>${r.doc === 'tournament' ? 'TR ' : ''}${esc(r.ref)}</b>${r.heading && !r.heading.startsWith(`${r.ref} `) ? ` · ${esc(r.heading.replace(/^\d+\s+/, ''))}` : ''}</div><div>${mark(r.text)}</div></div>`).join('')}`
}
