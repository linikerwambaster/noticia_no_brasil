'use strict';

/**
 * /api/news — agrega manchetes dos feeds RSS oficiais dos veículos.
 *
 * - Sem dependências (só Node 18+ com fetch global).
 * - Devolve apenas título, resumo curto, link, imagem e veículo de origem.
 *   O clique sempre leva para o site do veículo.
 * - "Em alta" = quantos veículos diferentes cobrem o mesmo assunto,
 *   combinado com destaque no feed e recência.
 */

const FEEDS = [
  { id: 'g1-politica',   name: 'g1',               section: 'brasil', topic: 'Política', url: 'https://g1.globo.com/rss/g1/politica/' },
  { id: 'g1-economia',   name: 'g1',               section: 'brasil', topic: 'Economia', url: 'https://g1.globo.com/rss/g1/economia/' },
  { id: 'g1-mundo',      name: 'g1',               section: 'mundo',  topic: 'Mundo',    url: 'https://g1.globo.com/rss/g1/mundo/' },
  { id: 'g1',            name: 'g1',               section: null,     topic: null,       url: 'https://g1.globo.com/rss/g1/' },
  { id: 'folha-poder',   name: 'Folha de S.Paulo', section: 'brasil', topic: 'Política', url: 'https://feeds.folha.uol.com.br/poder/rss091.xml' },
  { id: 'folha-mercado', name: 'Folha de S.Paulo', section: 'brasil', topic: 'Economia', url: 'https://feeds.folha.uol.com.br/mercado/rss091.xml' },
  { id: 'folha-mundo',   name: 'Folha de S.Paulo', section: 'mundo',  topic: 'Mundo',    url: 'https://feeds.folha.uol.com.br/mundo/rss091.xml' },
  { id: 'abr-politica',  name: 'Agência Brasil',   section: 'brasil', topic: 'Política', url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml' },
  { id: 'abr-economia',  name: 'Agência Brasil',   section: 'brasil', topic: 'Economia', url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml' },
  { id: 'abr-intl',      name: 'Agência Brasil',   section: 'mundo',  topic: 'Mundo',    url: 'https://agenciabrasil.ebc.com.br/rss/internacional/feed.xml' },
  { id: 'abr',           name: 'Agência Brasil',   section: null,     topic: null,       url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml' },
  { id: 'cnn',           name: 'CNN Brasil',       section: null,     topic: null,       url: 'https://www.cnnbrasil.com.br/feed/' },
  // Poder360 mistura assuntos (Brasil e mundo): conta só como "voto" de cobertura.
  { id: 'poder360',      name: 'Poder360',         section: null,     topic: null,       url: 'https://www.poder360.com.br/feed/' },
  { id: 'bbc',           name: 'BBC News Brasil',  section: null,     topic: null,       url: 'https://feeds.bbci.co.uk/portuguese/rss.xml' },
];

const TRENDS_URL = 'https://trends.google.com/trending/rss?geo=BR';

const MAX_AGE_HOURS = 48;
const FETCH_TIMEOUT_MS = 7000;
const CACHE_TTL_MS = 10 * 60 * 1000;

// ---------- utilidades de texto ----------

const NAMED = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&(quot|amp|lt|gt|apos|nbsp);/g, (_, e) => NAMED[e]);
}

function safeCodePoint(n) {
  try { return String.fromCodePoint(n); } catch (e) { return ''; }
}

function cdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function clean(raw) {
  if (!raw) return '';
  let s = cdata(raw);
  s = decode(s);              // desfaz &lt;p&gt; (Agência Brasil)
  s = s.replace(/<[^>]*>/g, ' ');
  s = decode(s);
  return s.replace(/\s+/g, ' ').trim();
}

function tag(xml, name) {
  const re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

function attr(xml, tagName, attrName) {
  const re = new RegExp('<' + tagName + '\\b[^>]*\\b' + attrName + '\\s*=\\s*["\']([^"\']+)["\']', 'i');
  const m = xml.match(re);
  return m ? decode(m[1]) : '';
}

function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, '') + '…';
}

function safeUrl(u) {
  if (!u) return '';
  u = decode(u.trim());
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^https?:\/\//i.test(u)) return '';
  return u.replace(/^http:\/\//i, 'https://');
}

function canonical(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    x.search = '';
    return x.toString().replace(/\/$/, '');
  } catch (e) { return u; }
}

// ---------- parser RSS ----------

function pickImage(itemXml) {
  const candidates = [
    attr(itemXml, 'media:content', 'url'),
    attr(itemXml, 'media:thumbnail', 'url'),
    tag(itemXml, 'imagem-destaque').trim(),
  ];
  const enc = itemXml.match(/<enclosure\b[^>]*>/i);
  if (enc && /type\s*=\s*["']image/i.test(enc[0])) {
    const u = enc[0].match(/url\s*=\s*["']([^"']+)["']/i);
    if (u) candidates.push(u[1]);
  }
  const body = decode(cdata(tag(itemXml, 'description') + ' ' + tag(itemXml, 'content:encoded')));
  const imgRe = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = imgRe.exec(body))) candidates.push(m[1]);

  for (const c of candidates) {
    const u = safeUrl(c);
    if (!u) continue;
    if (/\.svg(\?|$)/i.test(u) || /logo|pixel|ebc\.png|1x1|avatar|emoji/i.test(u)) continue;
    return u;
  }
  return '';
}

function parseFeed(xml, feed) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const out = [];
  items.forEach((it, idx) => {
    const title = clean(tag(it, 'title'));
    const link = safeUrl(clean(tag(it, 'link')) || attr(it, 'link', 'href'));
    if (!title || !link) return;

    const dateRaw = clean(tag(it, 'pubDate')) || clean(tag(it, 'dc:date')) || clean(tag(it, 'published'));
    const ts = Date.parse(dateRaw);
    if (!Number.isFinite(ts)) return;
    const ageH = (Date.now() - ts) / 36e5;
    if (ageH > MAX_AGE_HOURS || ageH < -2) return;

    let summary = clean(tag(it, 'atom:subtitle')) || clean(tag(it, 'description'));
    summary = summary.replace(/📱.*$/s, '').replace(/\b(Leia também|Leia mais|Veja também)\b.*$/is, '').trim();
    // arruma espaços deixados pela remoção de tags: "Durigan , afirmou" / "( USP )"
    summary = summary.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+([,.;:!?])/g, '$1');
    if (summary.toLowerCase().startsWith(title.toLowerCase().slice(0, 40))) summary = '';
    summary = truncate(summary, 170);

    out.push({
      title,
      summary,
      url: link,
      image: pickImage(it),
      source: feed.name,
      section: feed.section,
      topic: feed.topic,
      publishedAt: new Date(ts).toISOString(),
      ts,
      pos: idx,
      feedSize: items.length,
    });
  });
  return out;
}

// ---------- rede ----------

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; PanoramaBot/1.0)', accept: 'application/rss+xml, application/xml, text/xml, */*' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    // Alguns feeds (ex.: Folha) usam ISO-8859-1: respeita o charset declarado.
    const buf = Buffer.from(await res.arrayBuffer());
    let m = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i);
    if (!m) m = buf.subarray(0, 200).toString('latin1').match(/encoding=["']([\w-]+)["']/i);
    try { return new TextDecoder(m ? m[1].toLowerCase() : 'utf-8').decode(buf); }
    catch (e) { return buf.toString('utf8'); }
  } finally {
    clearTimeout(timer);
  }
}

// ---------- agrupamento por assunto ----------

const STOP = new Set(('a o as os de do da dos das em no na nos nas um uma uns umas e ou que com por para pra ao aos ' +
  'se sua seu suas seus como mais mas ja foi sao ser tem ha apos sobre entre ate contra diz dizem afirma ' +
  'anuncia veja saiba entenda quem quando onde hoje ontem apos sera pode podem deve vai vao esta estao ' +
  'nova novo novas novos ano anos dia dias semana mes meses brasil brasileiro brasileira').split(' '));

function normTokens(title) {
  const base = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const set = new Set();
  base.split(/\s+/).forEach((w) => { if (w.length >= 3 && !STOP.has(w)) set.add(w); });
  return set;
}

function similar(a, b) {
  let inter = 0;
  a.tk.forEach((t) => { if (b.tk.has(t)) inter++; });
  if (inter < 3) return false;
  const min = Math.min(a.tk.size, b.tk.size);
  const uni = a.tk.size + b.tk.size - inter;
  return inter / min >= 0.55 || inter / uni >= 0.4;
}

function cluster(items) {
  const clusters = [];
  items.forEach((it) => {
    it.tk = normTokens(it.title);
    let home = null;
    for (const c of clusters) {
      if (c.members.some((m) => similar(it, m))) { home = c; break; }
    }
    if (home) home.members.push(it); else clusters.push({ members: [it] });
  });
  return clusters;
}

function scoreCluster(c) {
  const outlets = new Set(c.members.map((m) => m.source));
  const newest = Math.max(...c.members.map((m) => m.ts));
  const ageH = Math.max(0, (Date.now() - newest) / 36e5);
  const recency = 30 * Math.exp(-ageH / 10);
  const prominence = Math.max(...c.members.map((m) => Math.max(0, 1 - m.pos / Math.max(m.feedSize, 1) * 3)));
  c.outlets = [...outlets];
  c.score = 14 * (outlets.size - 1) + recency + 6 * prominence;
  return c;
}

function representative(c) {
  const sectioned = c.members.filter((m) => m.section);
  if (!sectioned.length) return null;
  sectioned.sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || b.ts - a.ts);
  const rep = sectioned[0];
  const image = rep.image || (c.members.find((m) => m.image) || {}).image || '';
  return {
    title: rep.title,
    summary: rep.summary || (c.members.find((m) => m.summary) || {}).summary || '',
    url: rep.url,
    image,
    source: rep.source,
    section: rep.section,
    topic: rep.topic,
    publishedAt: new Date(Math.max(...c.members.map((m) => m.ts))).toISOString(),
    coverage: c.outlets.length,
    outlets: c.outlets,
    score: Math.round(c.score * 10) / 10,
  };
}

function pickDiverse(list, n, perSource) {
  const used = {};
  const out = [];
  for (const it of list) {
    used[it.source] = used[it.source] || 0;
    if (used[it.source] >= perSource) continue;
    used[it.source]++;
    out.push(it);
    if (out.length >= n) break;
  }
  return out;
}

// ---------- trends ----------

function parseTrends(xml) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  return items.slice(0, 14).map((it) => ({
    term: clean(tag(it, 'title')),
    traffic: clean(tag(it, 'ht:approx_traffic')),
  })).filter((t) => t.term);
}

// ---------- montagem ----------

async function buildNews() {
  const feedResults = await Promise.allSettled(FEEDS.map(async (f) => parseFeed(await fetchText(f.url), f)));
  const trendsResult = await Promise.allSettled([fetchText(TRENDS_URL).then(parseTrends)]);

  const byUrl = new Map();
  const status = {};
  feedResults.forEach((r, i) => {
    const f = FEEDS[i];
    if (r.status !== 'fulfilled') { status[f.id] = 'erro'; return; }
    status[f.id] = r.value.length;
    r.value.forEach((it) => {
      const key = canonical(it.url);
      const prev = byUrl.get(key);
      if (!prev) { byUrl.set(key, it); return; }
      if (!prev.section && it.section) { prev.section = it.section; prev.topic = it.topic; }
      if (!prev.image && it.image) prev.image = it.image;
      prev.pos = Math.min(prev.pos, it.pos);
    });
  });

  const all = [...byUrl.values()].sort((a, b) => b.ts - a.ts);
  const clusters = cluster(all).map(scoreCluster);
  const reps = clusters.map(representative).filter(Boolean).sort((a, b) => b.score - a.score);

  const hot = pickDiverse(reps, 8, 3);
  const heroPool = reps.filter((r) => r.image);
  const hero = heroPool.length ? heroPool[0] : hot[0] || null;
  const hotUrls = new Set([hero && hero.url].filter(Boolean));
  const hotList = hot.filter((h) => !hotUrls.has(h.url)).slice(0, 6);
  const shown = new Set([hero && hero.url, ...hotList.map((h) => h.url)].filter(Boolean));

  const brasil = pickDiverse(reps.filter((r) => r.section === 'brasil' && !shown.has(r.url)), 9, 3);
  const mundo = pickDiverse(reps.filter((r) => r.section === 'mundo' && !shown.has(r.url)), 9, 3);

  const bbc = all.filter((i) => i.source === 'BBC News Brasil').slice(0, 6).map((i) => ({
    title: i.title, summary: i.summary, url: i.url, image: i.image, publishedAt: i.publishedAt, source: i.source,
  }));

  const trends = trendsResult[0].status === 'fulfilled' ? trendsResult[0].value : [];

  return {
    updatedAt: new Date().toISOString(),
    hero,
    hot: hotList,
    brasil,
    mundo,
    bbc,
    trends,
    meta: {
      outlets: [...new Set(FEEDS.map((f) => f.name))],
      itemsAnalyzed: all.length,
      feedStatus: status,
    },
  };
}

// ---------- handler (Vercel) ----------

let cache = null;

async function handler(req, res) {
  try {
    if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
      const data = await buildNews();
      if (!data.hero && cache) {
        // todos os feeds falharam: mantém o último resultado bom
      } else {
        cache = { at: Date.now(), data };
      }
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    res.statusCode = cache ? 200 : 502;
    res.end(JSON.stringify(cache ? cache.data : { error: 'sem dados' }));
  } catch (err) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'falha ao montar notícias' }));
  }
}

module.exports = handler;
module.exports.buildNews = buildNews;
