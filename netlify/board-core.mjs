// Light Dash leaderboard: request handling and checks.
// Kept apart from the Netlify function so it can be tested with any blob store.

const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'nigg', 'fag', 'whore', 'slut', 'хуй', 'хуе', 'пизд', 'бля', 'ебат', 'ебан', 'сука', 'мудак', 'пидор', 'шлюх', 'жоп'];
export function nickOk(n) {
  if (typeof n !== 'string' || !/^[A-Za-z0-9 _.-]{2,16}$/.test(n) || !/[A-Za-z0-9]/.test(n)) return false;
  const low = n.toLowerCase().replace(/[^a-zа-яё]/g, '');
  return !BAD.some(w => low.includes(w));
}

const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const LEVELS = 12;
// Nicknames that belong to the game's admins. Only one player can hold each, and that player
// can open the admin panel. Set ADMIN_NAMES in Netlify (comma separated) to change the list.
const nameKey = n => String(n || '').toLowerCase().replace(/[^a-zа-яё0-9]/g, '');
const adminNames = () => String((typeof process !== 'undefined' && process.env && process.env.ADMIN_NAMES) || 'dev mode,enthropy').split(',').map(nameKey).filter(Boolean);
const pub = r => ({ id: r.id, name: r.name, skin: r.skin, score: r.score, bestM: r.bestM, levels: r.levels, facts: r.facts, quests: r.quests || 0 });

export async function handle(req, store) {
  try {
    return await route(req, store);
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
}

async function route(req, store) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const want = url.searchParams.get('sort') || 'score';
    const me = url.searchParams.get('me') || '';
    const { blobs } = await store.list();
    let rows = (await Promise.all(blobs.slice(0, 3000).map(b => store.get(b.key, { type: 'json' })))).filter(r => r && r.id && !r.blocked);
    const lvl = /^t[0-9]{1,2}$/.test(want) ? Number(want.slice(1)) : -1;
    let sort = 'score', view = pub;
    if (lvl >= 0 && lvl < LEVELS) {
      // Fastest finish on one level: lower time is better, players without a time are left out.
      sort = want;
      rows = rows.filter(r => Array.isArray(r.times) && r.times[lvl] > 0);
      rows.sort((a, b) => (a.times[lvl] - b.times[lvl]) || (a.updated - b.updated));
      view = r => ({ ...pub(r), time: r.times[lvl] });
    } else {
      sort = ['bestM', 'quests'].includes(want) ? want : 'score';
      rows.sort((a, b) => ((b[sort] || 0) - (a[sort] || 0)) || (a.updated - b.updated));
    }
    const rank = rows.findIndex(r => r.id === me);
    return json({ sort, total: rows.length, top: rows.slice(0, 20).map(view), me: rank >= 0 ? { rank: rank + 1, ...view(rows[rank]), admin: !!rows[rank].admin } : null });
  }

  if (req.method === 'POST') {
    if (Number(req.headers.get('content-length') || 0) > 2000) return json({ error: 'too_big' }, 413);
    let b;
    try { b = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
    if (!b || typeof b.id !== 'string' || !/^[a-f0-9-]{16,64}$/.test(b.id) || typeof b.key !== 'string' || b.key.length < 16 || b.key.length > 128) return json({ error: 'bad_id' }, 400);
    const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
    if (!nickOk(name)) return json({ error: 'bad_name' }, 400);
    const quests = b.quests === undefined ? 0 : b.quests;
    const times = b.times === undefined ? [] : b.times;
    if (!int(b.levels, 0, LEVELS) || !int(b.facts, 0, LEVELS * 3) || !int(b.ach, 0, 50) || !int(b.bestM, 0, 100000) || !int(b.homes, 0, 1000000) || !int(quests, 0, 100000)) return json({ error: 'bad_stats' }, 400);
    if (!Array.isArray(times) || times.length > LEVELS || !times.every(v => v === 0 || int(v, 3000, 900000))) return json({ error: 'bad_times' }, 400);
    const skin = typeof b.skin === 'string' ? b.skin.slice(0, 12).replace(/[^a-z0-9]/g, '') : 'anya';
    const keyHash = await sha256(b.key);
    const old = await store.get(b.id, { type: 'json' });
    if (old && old.keyHash !== keyHash) return json({ error: 'not_yours' }, 403);
    if (old && old.blocked) return json({ error: 'blocked' }, 403);
    // The name changes only when the player renames on purpose (or on the first save).
    // Automatic saves keep the current name, so a name the admin corrected stays.
    let finalName = old && !b.rename ? old.name : name;
    let admin = !!(old && old.admin);
    if (finalName !== (old && old.name) && adminNames().includes(nameKey(finalName))) {
      const { blobs } = await store.list();
      const others = (await Promise.all(blobs.map(x => x.key === b.id ? null : store.get(x.key, { type: 'json' })))).filter(r => r && nameKey(r.name) === nameKey(finalName));
      if (others.length) return json({ error: 'name_taken' }, 409);
      admin = true;
    } else if (!admin && old && adminNames().includes(nameKey(old.name))) {
      // the player already used an admin nickname before admins existed: they keep it if nobody else has it
      const { blobs } = await store.list();
      const others = (await Promise.all(blobs.map(x => x.key === b.id ? null : store.get(x.key, { type: 'json' })))).filter(r => r && nameKey(r.name) === nameKey(old.name));
      if (!others.length) admin = true;
    }
    const row = {
      id: b.id, keyHash, name: finalName, admin, skin, levels: b.levels, facts: b.facts, ach: b.ach, bestM: b.bestM, homes: b.homes, quests, times,
      score: b.levels * 1000 + b.facts * 200 + b.ach * 50 + Math.min(quests, 200) * 20 + Math.min(b.bestM, 5000), updated: Date.now(),
    };
    await store.setJSON(b.id, row);
    return json({ ok: true, score: row.score, name: row.name });
  }

  return json({ error: 'method' }, 405);
}

// ---------------------------------------------------------------------------
// Admin: list, correct, block or delete players. Needs the ADMIN_PASSWORD
// environment variable set in Netlify; without it the admin API stays off.
// ---------------------------------------------------------------------------
const score = r => r.levels * 1000 + r.facts * 200 + r.ach * 50 + Math.min(r.quests || 0, 200) * 20 + Math.min(r.bestM, 5000);
const adminView = r => ({ id: r.id, name: r.name, skin: r.skin, score: r.score, levels: r.levels, facts: r.facts, ach: r.ach, quests: r.quests || 0,
  bestM: r.bestM, homes: r.homes, times: r.times || [], updated: r.updated, blocked: !!r.blocked, admin: !!r.admin });
const wait = ms => new Promise(res => setTimeout(res, ms));

export async function handleAdmin(req, store, password, levelStore) {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let b;
    try { b = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
    if (!b) return json({ error: 'bad_json' }, 400);
    // Two ways in: an admin player's own secret key (the game's admin accounts), or ADMIN_PASSWORD.
    let ok = false;
    if (typeof b.playerId === 'string' && /^[a-f0-9-]{16,64}$/.test(b.playerId) && typeof b.playerKey === 'string') {
      const me = await store.get(b.playerId, { type: 'json' });
      ok = !!(me && me.admin && !me.blocked && me.keyHash === (await sha256(b.playerKey)));
    } else if (password && password.length >= 8 && typeof b.password === 'string') {
      // compare hashes so the check takes the same time for every guess
      ok = (await sha256(b.password)) === (await sha256(password));
    }
    if (!ok) { await wait(1200); return json({ error: b.playerId ? 'not_admin' : (password && password.length >= 8 ? 'wrong_password' : 'admin_off') }, 401); }
    if (b.action === 'whoami') return json({ ok: true });

    if (b.action === 'levels') {
      if (!levelStore) return json({ levels: [] });
      return json({ levels: (await allLevels(levelStore)).map(levelSummary) });
    }
    if (b.action === 'deleteLevel') {
      if (!levelStore || typeof b.levelId !== 'string' || !/^[a-f0-9]{8,40}$/.test(b.levelId)) return json({ error: 'bad_id' }, 400);
      await levelStore.delete(b.levelId); return json({ ok: true });
    }
    if (b.action === 'list') {
      const { blobs } = await store.list();
      const rows = (await Promise.all(blobs.slice(0, 5000).map(x => store.get(x.key, { type: 'json' })))).filter(r => r && r.id);
      rows.sort((x, y) => (y.score || 0) - (x.score || 0));
      return json({ players: rows.map(adminView) });
    }
    if (typeof b.id !== 'string' || !/^[a-f0-9-]{16,64}$/.test(b.id)) return json({ error: 'bad_id' }, 400);
    const row = await store.get(b.id, { type: 'json' });
    if (!row) return json({ error: 'not_found' }, 404);

    if (b.action === 'delete') { await store.delete(b.id); return json({ ok: true }); }
    if (b.action === 'block' || b.action === 'unblock') {
      row.blocked = b.action === 'block'; await store.setJSON(b.id, row); return json({ ok: true, player: adminView(row) });
    }
    if (b.action === 'update') {
      const f = b.fields || {};
      if (f.name !== undefined) {
        const name = typeof f.name === 'string' ? f.name.trim().replace(/\s+/g, ' ') : '';
        if (!nickOk(name)) return json({ error: 'bad_name' }, 400);
        row.name = name;
      }
      if (typeof f.admin === 'boolean') row.admin = f.admin;
      const lim = { levels: [0, LEVELS], facts: [0, LEVELS * 3], ach: [0, 50], quests: [0, 100000], bestM: [0, 100000], homes: [0, 1000000] };
      for (const [k, [lo, hi]] of Object.entries(lim)) {
        if (f[k] === undefined) continue;
        if (!int(f[k], lo, hi)) return json({ error: 'bad_' + k }, 400);
        row[k] = f[k];
      }
      if (f.clearTimes) row.times = [];
      row.score = score(row);
      await store.setJSON(b.id, row);
      return json({ ok: true, player: adminView(row) });
    }
    return json({ error: 'bad_action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
}

// ---------------------------------------------------------------------------
// Community levels: players publish levels made in the editor, everyone can
// browse, play and like them. Authors and admins can delete them.
// ---------------------------------------------------------------------------
const LEVEL_TOOLS = ['spike', 'spike2', 'spike3', 'pit', 'pitW', 'gust', 'block', 'blockH', 'cloud', 'wall', 'pad', 'energy', 'house', 'fast', 'normal', 'slow', 'check'];
const LEVEL_SPEEDS = [300, 340, 380, 420];
const MAX_PER_AUTHOR = 10;
export function levelNameOk(n) {
  if (typeof n !== 'string' || !/^[A-Za-z0-9 _.,!?'-]{2,24}$/.test(n) || !/[A-Za-z0-9]/.test(n)) return false;
  const low = n.toLowerCase().replace(/[^a-z]/g, '');
  return !BAD.some(w => low.includes(w));
}
const levelSummary = L => ({ id: L.id, name: L.name, authorName: L.authorName, theme: L.theme, speed: L.speed, items: L.items.length,
  plays: L.plays || 0, likes: (L.likedBy || []).length, created: L.created, author: L.author });
async function allLevels(levelStore) {
  const { blobs } = await levelStore.list();
  return (await Promise.all(blobs.slice(0, 3000).map(x => levelStore.get(x.key, { type: 'json' })))).filter(L => L && L.id);
}
async function playerAuth(store, id, key) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{16,64}$/.test(id) || typeof key !== 'string') return null;
  const me = await store.get(id, { type: 'json' });
  if (!me || me.blocked || me.keyHash !== (await sha256(key))) return null;
  return me;
}
const randomId = () => [...crypto.getRandomValues(new Uint8Array(10))].map(v => v.toString(16).padStart(2, '0')).join('');

export async function handleLevels(req, store, levelStore) {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const one = url.searchParams.get('id');
      if (one) {
        if (!/^[a-f0-9]{8,40}$/.test(one)) return json({ error: 'bad_id' }, 400);
        const L = await levelStore.get(one, { type: 'json' });
        if (!L) return json({ error: 'not_found' }, 404);
        return json({ level: { ...levelSummary(L), author: undefined, items: L.items } });
      }
      const sort = url.searchParams.get('sort') || 'new', me = url.searchParams.get('me') || '';
      const list = await allLevels(levelStore);
      if (sort === 'top') list.sort((a, b) => ((b.likedBy || []).length - (a.likedBy || []).length) || (b.created - a.created));
      else if (sort === 'plays') list.sort((a, b) => ((b.plays || 0) - (a.plays || 0)) || (b.created - a.created));
      else list.sort((a, b) => b.created - a.created);
      return json({ total: list.length, levels: list.slice(0, 60).map(L => ({ ...levelSummary(L), author: undefined, mine: !!me && L.author === me, liked: !!me && (L.likedBy || []).includes(me) })) });
    }
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    if (Number(req.headers.get('content-length') || 0) > 20000) return json({ error: 'too_big' }, 413);
    let b;
    try { b = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
    if (!b) return json({ error: 'bad_json' }, 400);

    if (b.action === 'play') {
      if (typeof b.levelId !== 'string' || !/^[a-f0-9]{8,40}$/.test(b.levelId)) return json({ error: 'bad_id' }, 400);
      const L = await levelStore.get(b.levelId, { type: 'json' });
      if (!L) return json({ error: 'not_found' }, 404);
      L.plays = (L.plays || 0) + 1; await levelStore.setJSON(L.id, L);
      return json({ ok: true, plays: L.plays });
    }

    const me = await playerAuth(store, b.id, b.key);
    if (!me) return json({ error: 'not_player' }, 403);

    if (b.action === 'publish') {
      const lv = b.level || {};
      const name = typeof lv.name === 'string' ? lv.name.trim().replace(/\s+/g, ' ') : '';
      if (!levelNameOk(name)) return json({ error: 'bad_level_name' }, 400);
      if (!Number.isInteger(lv.theme) || lv.theme < 0 || lv.theme >= 12 || !LEVEL_SPEEDS.includes(lv.speed)) return json({ error: 'bad_level' }, 400);
      if (!Array.isArray(lv.items) || !lv.items.length || lv.items.length > 250
        || !lv.items.every(it => Array.isArray(it) && it.length === 2 && LEVEL_TOOLS.includes(it[0]) && int(it[1], 400, 60000))) return json({ error: 'bad_level' }, 400);
      const list = await allLevels(levelStore);
      const mine = list.filter(L => L.author === me.id);
      if (mine.length >= MAX_PER_AUTHOR) return json({ error: 'too_many' }, 409);
      if (mine.some(L => Date.now() - L.created < 30000)) return json({ error: 'too_fast' }, 429);
      const L = { id: randomId(), author: me.id, authorName: me.name, name, theme: lv.theme, speed: lv.speed, items: lv.items.map(it => [it[0], it[1]]), created: Date.now(), plays: 0, likedBy: [] };
      await levelStore.setJSON(L.id, L);
      return json({ ok: true, levelId: L.id });
    }
    if (typeof b.levelId !== 'string' || !/^[a-f0-9]{8,40}$/.test(b.levelId)) return json({ error: 'bad_id' }, 400);
    const L = await levelStore.get(b.levelId, { type: 'json' });
    if (!L) return json({ error: 'not_found' }, 404);
    if (b.action === 'like') {
      const set = new Set(L.likedBy || []);
      if (set.has(me.id)) set.delete(me.id); else if (L.author !== me.id) set.add(me.id);
      L.likedBy = [...set].slice(0, 20000); await levelStore.setJSON(L.id, L);
      return json({ ok: true, likes: L.likedBy.length, liked: set.has(me.id) });
    }
    if (b.action === 'delete') {
      if (L.author !== me.id && !me.admin) return json({ error: 'not_yours' }, 403);
      await levelStore.delete(L.id); return json({ ok: true });
    }
    return json({ error: 'bad_action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
}
