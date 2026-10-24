import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.VERIFY_URL||'http://localhost:4173';
const get=async(p,options)=>{const r=await fetch(base+p,options);assert.ok(r.ok,`${p}: ${r.status}`);return r.json();};
const data=await get('/api/bootstrap'),place=code=>data.places.find(p=>p.id===code);
const report={checkedAtUtc:new Date().toISOString(),app:base,checks:[],live:{},browser:null};
for(const [from,to] of [['103','401'],['103','306'],['306','103'],['1007','401'],['103','1301']]){
  const r=await get('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:place(from),destination:place(to)})});
  if(to==='1301')assert.equal(r.journeys.length,0);else assert.ok(r.journeys.length);
  report.checks.push({from:place(from).name,to:place(to).name,computedAt:r.computedAt||null,options:r.journeys.map(j=>({id:j.id,transfers:j.transfers,walkMetres:j.walkMetres,timing:j.timing,boardingSources:j.legs.filter(l=>l.type==='bus').map(l=>l.departure.source)})),noRouteReason:r.reason});
}
const feed=await get('/api/feed?code=133'),etas=['inboundStopsETAList','outboundStopsETAList'].flatMap(k=>feed.eta.data?.[k]||[]);
report.live={route:'R1',code:'133',positionsOk:feed.live.ok,positionsChecked:feed.live.fetchedAtUtc||null,positionCount:feed.live.data?.busList?.length||0,
  etaOk:feed.eta.ok,etaChecked:feed.eta.fetchedAtUtc||null,etaCount:etas.length,inboundCount:feed.eta.data?.inboundStopsETAList?.length??null,outboundCount:feed.eta.data?.outboundStopsETAList?.length??null,
  joinedVehicleCodes:[...new Set(etas.filter(e=>feed.live.data?.busList?.some(b=>b.busCode===e.vehicleCode)).map(e=>e.vehicleCode))],
  note:'Current response observations only. Vehicle fix age and operational reliability unknown. Journey durations remain modelled.'};
const file=new URL('../verification.json',import.meta.url);
if(fs.existsSync(file)){const previous=JSON.parse(fs.readFileSync(file));report.browser=previous.browser||null;}
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.checks.length,live:report.live},null,2));
