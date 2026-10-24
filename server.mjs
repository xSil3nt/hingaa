import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Planner } from './engine.mjs';
import { GoogleServices,googleWalkContext } from './google.mjs';
import { randomUUID } from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
if(process.env.RTL_OFFLINE!=='1'&&fs.existsSync(path.join(root,'.env.local')))process.loadEnvFile(path.join(root,'.env.local'));
const google=new GoogleServices(process.env.GOOGLE_MAPS_API_KEY);
const walkingSessions=new Map();
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const source=read('data/routes.json'),walk=read('data/walk.json'),planner=new Planner(source,walk);
const base='https://bo.rtl.mv:4455/maldives/api',cache=new Map(),pending=new Map();
export async function upstream(key,endpoint,code,ttl=30000) {
  const old=cache.get(key);if(old&&Date.now()-old.checked<ttl)return old.value;
  if(pending.has(key))return pending.get(key);
  const job=(async()=>{
    let value;try {
      if(process.env.RTL_OFFLINE==='1')throw new Error('Offline test mode');
      const response=await fetch(base+endpoint,{method:code?'POST':'GET',headers:code?{'Content-Type':'application/json'}:{},body:code?JSON.stringify({routeCode:code}):undefined,signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error(`RTL HTTP ${response.status}`);
      const data=await response.json();value={ok:true,data,fetchedAtUtc:new Date().toISOString()};
    } catch {value={ok:false,error:'RTL feed unavailable. Try again shortly.',checkedAt:new Date().toISOString()};}
    cache.set(key,{checked:Date.now(),value});return value;
  })();pending.set(key,job);try{return await job;}finally{pending.delete(key);}
}
const schedule=()=>upstream('schedule','/booking/v2/bus/routedetails',null,300000);
async function feed(code,withSchedule=true) {
  if(!planner.routes.some(r=>r.code===code))throw new Error('Unknown route code');
  const [eta,live,s]=await Promise.all([upstream(`eta:${code}`,'/gps-engine/eta/all-stops-of-route',code),upstream(`live:${code}`,'/booking/v1/bus/livecoordinates',code),withSchedule?schedule():Promise.resolve(null)]);
  return {code,eta,live,schedule:s};
}
const aliases={'306':['airport','Velana International Airport','VIA'],'103':['West Park'],'1007':['Republic Square'],'120':['IGMH','Indira Gandhi Memorial Hospital']};
const places=planner.stops.map(s=>({id:s.code,name:s.name,coord:s.coord,kind:'RTL stop',aliases:aliases[s.code]||[],routes:planner.routes.filter(r=>r.stops.some(x=>x.code===s.code)).map(r=>r.routeNumber)}));
const presets=['103','401','306','606','602','1007','114','120'].map(id=>places.find(p=>p.id===id)).filter(Boolean);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function endpoint(p){return p&&typeof p.name==='string'&&p.name.length<200&&Array.isArray(p.coord)&&p.coord.length===2&&p.coord.every(Number.isFinite)&&p.coord[0]>73.47&&p.coord[0]<73.57&&p.coord[1]>4.145&&p.coord[1]<4.265;}
export const handler=async(req,res)=>{
  try {
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/api/config')return json(res,200,{browserKey:process.env.GOOGLE_MAPS_BROWSER_KEY||null,googleConfigured:!!process.env.GOOGLE_MAPS_API_KEY});
    if(u.pathname==='/api/places'){
      const q=(u.searchParams.get('q')||'').trim(),session=u.searchParams.get('session')||'';
      if(q.length<2||q.length>150||session.length>80)return json(res,400,{error:'Enter a place name.'});
      try{return json(res,200,{places:await google.autocomplete(q,session)});}catch{return json(res,200,{places:[],error:'Google place search is unavailable. Local RTL stops are still searchable.'});}
    }
    if(u.pathname==='/api/place')return json(res,200,await google.place(u.searchParams.get('id')||'',u.searchParams.get('session')||''));
    if(u.pathname==='/api/bootstrap')return json(res,200,{places,presets,snapshotAt:source.fetchedAtUtc,walkingAt:walk.fetchedAtUtc,routes:planner.routes.map(r=>({code:r.code,number:r.routeNumber,name:r.name,alignmentMax:Math.max(...r.geometry.errors)})),streets:walk.edges.map(([a,b])=>[walk.nodes[a],walk.nodes[b]])});
    if(u.pathname==='/api/feed')return json(res,200,await feed(u.searchParams.get('code')));
    if(u.pathname==='/api/plan'&&req.method==='POST'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>10000)return json(res,413,{error:'Request too large'});}
      const {origin,destination,mapProvider,walkingSession}=JSON.parse(body);if(!endpoint(origin)||!endpoint(destination))return json(res,400,{error:'Choose two places in Greater Malé.'});
      let context=null,sessionId=null,walkingNotice=null;
      const signature=JSON.stringify([origin.coord,destination.coord]);
      if(mapProvider==='google'&&google.key){
        const existing=walkingSessions.get(walkingSession);
        if(existing&&existing.signature===signature&&Date.now()-existing.created<300000){context=existing.context;sessionId=walkingSession;}
        else try{
          context=await googleWalkContext(planner,google,origin,destination);
          const shortlist=planner.plan(origin,destination,{},Date.now(),{walking:context});
          const pairs=new Map();
          for(const j of shortlist.journeys){const buses=j.legs.filter(l=>l.type==='bus');if(buses.length===2)pairs.set(buses[0].toCode+'>'+buses[1].fromCode,[buses[0].toCode,buses[1].fromCode]);}
          for(const [key,[a,b]]of pairs){try{context.transfers.set(key,await google.walk(planner.stops.find(s=>s.code===a).coord,planner.stops.find(s=>s.code===b).coord,300));}catch{context.transfers.set(key,null);}}
          context.strictTransfers=true;sessionId=randomUUID();
          for(const [id,s]of walkingSessions)if(Date.now()-s.created>300000)walkingSessions.delete(id);
          if(walkingSessions.size>=16)walkingSessions.delete(walkingSessions.keys().next().value);
          walkingSessions.set(sessionId,{signature,context,created:Date.now()});
          setTimeout(()=>walkingSessions.delete(sessionId),300000).unref();
        }catch{context=null;walkingNotice='Google walking directions are unavailable. Using local OpenStreetMap paths.';}
      }
      const options=context?{walking:context}:{};
      const preliminary=planner.plan(origin,destination,{},Date.now(),options);
      const codes=[...new Set(preliminary.journeys.flatMap(j=>j.legs.filter(l=>l.type==='bus').map(l=>l.routeCode)))].slice(0,6);
      const feeds=Object.fromEntries(await Promise.all(codes.map(async c=>[c,await feed(c)])));
      return json(res,200,{...planner.plan(origin,destination,feeds,Date.now(),options),feeds,walkingSession:sessionId,walkingProvider:context?'google':'osm',walkingNotice});
    }
    if(u.pathname.startsWith('/api/'))return json(res,404,{error:'Not found'});
    const name=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname.slice(1));
    const file=path.resolve(root,'public',name);if(!file.startsWith(path.join(root,'public')+path.sep))return json(res,403,{error:'Forbidden'});
    if(!fs.existsSync(file)||fs.statSync(file).isDirectory())return json(res,404,{error:'Not found'});
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(file).pipe(res);
  } catch(error) {console.error(error.message);json(res,400,{error:'Unable to complete this request. Please try again.'});}
};
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=http.createServer(handler);
  const port=Number(process.env.PORT||4173);server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Journey planner ready: http://localhost:${server.address().port}`));
}
