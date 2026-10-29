// Light Dash leaderboard: request handling and checks.
// Kept apart from the Netlify function so it can be tested with any blob store.

const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'nigg', 'fag', 'whore', 'slut', 'хуй', 'хуе', 'пизд', 'бля', 'ебат', 'ебан', 'сука', 'мудак', 'пидор', 'шлюх', 'жоп'];
export function nickOk(n) {
  if (typeof n !== 'string' || !/^[A-Za-zА-Яа-яЁё0-9 _.-]{2,16}$/.test(n) || !/[A-Za-zА-Яа-яЁё0-9]/.test(n)) return false;
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
const LEVELS = 9;
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
    let rows = (await Promise.all(blobs.slice(0, 3000).map(b => store.get(b.key, { type: 'json' })))).filter(r => r && r.id);
    const lvl = /^t[0-9]$/.test(want) ? Number(want.slice(1)) : -1;
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
    return json({ sort, total: rows.length, top: rows.slice(0, 20).map(view), me: rank >= 0 ? { rank: rank + 1, ...view(rows[rank]) } : null });
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
    const row = {
      id: b.id, keyHash, name, skin, levels: b.levels, facts: b.facts, ach: b.ach, bestM: b.bestM, homes: b.homes, quests, times,
      score: b.levels * 1000 + b.facts * 200 + b.ach * 50 + Math.min(quests, 200) * 20 + Math.min(b.bestM, 5000), updated: Date.now(),
    };
    await store.setJSON(b.id, row);
    return json({ ok: true, score: row.score });
  }

  return json({ error: 'method' }, 405);
}
