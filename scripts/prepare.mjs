import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, '../rtlapp/data');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const snapshot = read(path.join(source, 'routes-response.json'));
const routes = snapshot.data.routeResponse.map(r => ({ ...r,
  shape: read(path.join(source, `shape-${r.code}.geojson`))
}));
fs.writeFileSync(path.join(root, 'data/routes.json'), JSON.stringify({ fetchedAtUtc: snapshot.fetchedAtUtc, routes }));
const nodes = new Map(), ways = new Map();
const attrs = text => Object.fromEntries([...text.matchAll(/([\w:]+)="([^"]*)"/g)].map(m => [m[1], m[2].replaceAll('&amp;', '&').replaceAll('&quot;', '"')]));
for (const file of fs.readdirSync(path.join(root, 'data')).filter(f => /^osm-.*\.xml$/.test(f))) {
  const xml = fs.readFileSync(path.join(root, 'data', file), 'utf8');
  for (const m of xml.matchAll(/<node\b([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)) {
    const a = attrs(m[1]); const tags = Object.fromEntries([...((m[2] || '').matchAll(/<tag\b([^>]+)\/>/g))].map(t => {const a = attrs(t[1]); return [a.k, a.v];}));
    nodes.set(a.id, {coord: [+a.lon, +a.lat], tags});
  }
  for (const m of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const a = attrs(m[1]); const tags = Object.fromEntries([...m[2].matchAll(/<tag\b([^>]+)\/>/g)].map(t => { const a = attrs(t[1]); return [a.k, a.v]; }));
    const ids = [...m[2].matchAll(/<nd ref="(\d+)"\s*\/>/g)].map(n => n[1]);
    ways.set(a.id, { ids, tags });
  }
}
const coastlines=[...ways.values()].filter(w=>w.tags.natural==='coastline').map(w=>[...w.ids]);
const land=[];
while(coastlines.length){
  let line=coastlines.pop(),changed=true;
  while(changed&&line[0]!==line.at(-1)){
    changed=false;
    const next=coastlines.findIndex(w=>w[0]===line.at(-1));
    if(next>=0){line.push(...coastlines.splice(next,1)[0].slice(1));changed=true;}
    else{const previous=coastlines.findIndex(w=>w.at(-1)===line[0]);if(previous>=0){line=[...coastlines.splice(previous,1)[0].slice(0,-1),...line];changed=true;}}
  }
  if(line[0]===line.at(-1)&&line.length>3&&line.every(id=>nodes.has(id)))land.push(line.map(id=>nodes.get(id).coord));
  else console.log('Open coastline',line.length,nodes.get(line[0])?.coord,nodes.get(line.at(-1))?.coord);
}
const used = new Map(), edges = [], streets = [];
function index(id) { if (!used.has(id)) used.set(id, used.size); return used.get(id); }
const excluded = new Set(['motorway','motorway_link','trunk','trunk_link','construction','proposed','raceway','busway']);
for (const {ids, tags: t} of ways.values()) {
  if (!t.highway || excluded.has(t.highway) || ['no','private','customers','delivery','permit'].includes(t.access) && !['yes','designated','permissive'].includes(t.foot) || ['no','private'].includes(t.foot)) continue;
  for (let i = 1; i < ids.length; i++) {
    const a = nodes.get(ids[i-1]), b = nodes.get(ids[i]);
    if (!a || !b) continue;
    const blocked = n => ['no','private'].includes(n.tags.foot) || ['no','private'].includes(n.tags.access) || ['wall','fence'].includes(n.tags.barrier);
    if (blocked(a) || blocked(b)) continue;
    edges.push([index(ids[i-1]), index(ids[i]), t.name || t.highway, t['oneway:foot'] === 'yes' ? 1 : t['oneway:foot'] === '-1' ? -1 : 0]);
  }
  if (t.name) streets.push({ name: t.name, coord: nodes.get(ids[Math.floor(ids.length/2)])?.coord });
}
const graph = { fetchedAtUtc: new Date().toISOString(), source: 'OpenStreetMap API 0.6 map extracts, 24 October 2026',
  nodes: [...used.keys()].map(id => nodes.get(id).coord), edges, streets, land };
fs.writeFileSync(path.join(root, 'data/walk.json'), JSON.stringify(graph));
console.log(`Prepared ${routes.length} RTL routes, ${graph.nodes.length} walking nodes, ${edges.length} edges, ${land.length} closed coastline rings.`);
