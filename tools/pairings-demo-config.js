// Served as /config.js when screenshotting a local copy of Pairings (see shot.js FAKE_CONFIG). The real
// supabase-js still loads; createClient is then swapped for an in-memory fake with example data, the
// same idea as Pairings' tests/harness.js. Nothing here talks to a real project.
window.PAIRINGS_CONFIG = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'k'.repeat(40), VAPID_PUBLIC_KEY: 'x', GOOGLE_CLIENT_ID: 'x', DONATION_URL: '' };
(function(){
  const pad = n => String(n).padStart(2, '0');
  const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
  const m = (opponent, outcome) => ({ opponent, outcome });
  const profile = { id: 'u1', email: 'demo@example.com', display_name: 'Beef', username: 'beef', onboarded: true, language: 'en', notification_prefs: {}, interested_games: [], share_stats_with_friends: true, is_admin: false, home_city: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const decks = [
    { id: 'd1', name: 'Jinx Aggro', game: 'Riftbound', legend: 'Jinx, Loose Cannon', colors: ['Fury', 'Chaos'], cardCount: 56, brewhouseDeckId: 'bh-1', brewhouseName: 'Jinx Aggro', brewhouseFormat: 'Constructed', active: true, notes: '', createdAt: 1 },
    { id: 'd2', name: 'Charizard ex', game: 'Pokémon TCG', active: true, notes: '', createdAt: 2 },
  ];
  const tournaments = [
    { id: 't1', name: 'Friday Night Rift', game: 'Riftbound', store: 'Game Haven', date: day(2), time: '6:30 PM', repeat: 'none', rsvp: 'going', format: 'Constructed', fee: '$10' },
    { id: 't2', name: 'League Cup', game: 'Pokémon TCG', store: 'Cards & Co', date: day(5), time: '11:00 AM', repeat: 'none', rsvp: 'going', format: 'Standard', fee: '$25' },
    { id: 't3', name: 'Riftbound Store Championship', game: 'Riftbound', store: 'Game Haven', date: day(9), time: '10:00 AM', repeat: 'none', rsvp: 'going', format: 'Constructed', fee: '$30' },
    { id: 't4', name: 'Tuesday Locals', game: 'Riftbound', store: 'Dragon’s Lair', date: day(-7), time: '7:00 PM', repeat: 'none', rsvp: 'going', format: 'Constructed', result: { record: '4-1', placement: '2nd', deckId: 'd1', matches: [m('Viktor', 'W'), m('Ahri', 'W'), m('Yasuo', 'L'), m('Viktor', 'W'), m('Lux', 'W')] } },
    { id: 't5', name: 'Weekly Rift', game: 'Riftbound', store: 'Game Haven', date: day(-14), time: '6:30 PM', repeat: 'none', rsvp: 'going', format: 'Constructed', result: { record: '3-2', placement: '5th', deckId: 'd1', matches: [] } },
  ];
  function client(){
    const builder = (table) => {
      const ctx = { op: 'select' };
      const run = (single) => {
        let data = single ? null : [];
        if (table === 'profiles' && ctx.op === 'select') data = single ? profile : [profile];
        if (table === 'user_data' && ctx.op === 'select') data = { tournaments, decks, version: 1, deleted: {} };
        return Promise.resolve({ data, error: null });
      };
      const b = {};
      ['select', 'eq', 'in', 'neq', 'gte', 'lte', 'lt', 'gt', 'ilike', 'like', 'or', 'order', 'limit', 'range', 'is', 'not', 'filter'].forEach(k => { b[k] = () => b; });
      ['insert', 'upsert', 'update', 'delete'].forEach(k => { b[k] = () => { ctx.op = k; return b; }; });
      b.maybeSingle = () => run(true); b.single = () => run(true); b.then = (res, rej) => run(false).then(res, rej);
      return b;
    };
    const chan = { on(){ return chan; }, subscribe(){ return chan; } };
    const session = { user: { id: 'u1', email: 'demo@example.com' }, access_token: 'x' };
    return {
      from: builder,
      rpc(name){
        const f = () => Promise.resolve(name === 'get_my_profile' ? { data: [profile], error: null } : name === 'save_user_data' ? { data: 2, error: null } : { data: null, error: null });
        return { then(res, rej){ return f().then(res, rej); }, maybeSingle(){ return f().then(r => Array.isArray(r.data) ? { ...r, data: r.data[0] || null } : r); } };
      },
      auth: { getSession: async () => ({ data: { session } }), onAuthStateChange(){ return { data: { subscription: { unsubscribe(){} } } }; }, signOut: async () => ({}) },
      channel(){ return chan; }, removeChannel: async () => {},
      storage: { from(){ return { upload: async () => ({}), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => ({}) }; } },
    };
  }
  window.supabase.createClient = () => client();
})();
