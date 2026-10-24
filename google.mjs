import {metres} from './engine.mjs';
export class GoogleError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
export function decodePolyline(encoded){
  let index=0,lat=0,lng=0,coords=[];
  while(index<encoded.length){let parts=[];for(let n=0;n<2;n++){let result=0,shift=0,b;do{if(index>=encoded.length)throw Error('Invalid route geometry');b=encoded.charCodeAt(index++)-63;result|=(b&31)<<shift;shift+=5;if(shift>35)throw Error('Invalid route geometry');}while(b>=32);parts.push(result&1?~(result>>1):result>>1);}lat+=parts[0];lng+=parts[1];coords.push([lng/1e5,lat/1e5]);}
  return coords;
}
export class GoogleServices {
  constructor(key,{fetcher=fetch}={}){this.key=key;this.fetcher=fetcher;}
  async call(url,body,mask,signal){
    if(!this.key)throw new GoogleError(503,'Google Maps is not configured.');
    const res=await this.fetcher(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Goog-Api-Key':this.key,'X-Goog-FieldMask':mask},body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
    const data=await res.json();if(!res.ok){const code=data.error?.status||String(res.status);throw new GoogleError(res.status,code==='PERMISSION_DENIED'?'Google Maps access is blocked. Check enabled APIs, key restrictions and billing.':code==='RESOURCE_EXHAUSTED'?'Google Maps quota is reached. Try again later.':'Google Maps could not complete this request.');}return data;
  }
  async autocomplete(input,sessionToken){
    const data=await this.call('https://places.googleapis.com/v1/places:autocomplete',{input,sessionToken,languageCode:'en',includedRegionCodes:['mv'],locationRestriction:{rectangle:{low:{latitude:4.145,longitude:73.47},high:{latitude:4.265,longitude:73.57}}}},'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat');
    return (data.suggestions||[]).filter(s=>s.placePrediction).map(({placePrediction:p})=>({id:p.placeId,name:p.structuredFormat?.mainText?.text||p.text?.text,address:p.structuredFormat?.secondaryText?.text||'',kind:'Google Maps place',provider:'google'}));
  }
  async place(id,sessionToken){
    if(!/^[A-Za-z0-9_-]{10,200}$/.test(id))throw new GoogleError(400,'Invalid place.');
    const u=new URL('https://places.googleapis.com/v1/places/'+id);if(sessionToken)u.searchParams.set('sessionToken',sessionToken);
    const p=await this.call(u,null,'id,displayName,formattedAddress,location,attributions');
    const coord=[p.location?.longitude,p.location?.latitude];
    if(!coord.every(Number.isFinite)||coord[0]<73.47||coord[0]>73.57||coord[1]<4.145||coord[1]>4.265)throw new GoogleError(400,'Choose a place in Greater Malé.');
    return {id:p.id,name:p.displayName?.text||p.formattedAddress,coord,address:p.formattedAddress,kind:'Google Maps place',provider:'google',attributions:p.attributions||[]};
  }
  async walk(a,b,max=1000,signal){
    if(metres(a,b)<1)return {type:'walk',distance:0,minutes:0,coords:[a,b],streets:[],accessMetres:0,provider:'google',instructions:[],warnings:[]};
    const data=await this.call('https://routes.googleapis.com/directions/v2:computeRoutes',{
      origin:{location:{latLng:{latitude:a[1],longitude:a[0]}}},destination:{location:{latLng:{latitude:b[1],longitude:b[0]}}},travelMode:'WALK',languageCode:'en-US',units:'METRIC',computeAlternativeRoutes:false
    },'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.warnings,routes.legs.steps.navigationInstruction,routes.legs.steps.travelMode,routes.legs.steps.distanceMeters',signal);
    const r=data.routes?.[0];if(!r||r.distanceMeters>max)return null;
    if(!Number.isFinite(r.distanceMeters)||!Number.isFinite(parseFloat(r.duration)))return null;
    const steps=(r.legs||[]).flatMap(l=>l.steps||[]),instructions=steps.map(s=>s.navigationInstruction?.instructions).filter(Boolean);
    if(steps.some(s=>s.travelMode&&s.travelMode!=='WALK')||instructions.some(s=>/\bferry\b/i.test(s)))return null;
    const coords=decodePolyline(r.polyline?.encodedPolyline||'');if(coords.length<2)return null;
    return {type:'walk',distance:r.distanceMeters,minutes:Math.max(1,Math.ceil(parseFloat(r.duration)/60)),coords,streets:[],accessMetres:0,provider:'google',instructions,warnings:[...(r.warnings||[]),'Walking directions may be missing sidewalks or pedestrian paths. Use caution.'],checkedAt:new Date().toISOString()};
  }
}
// One active request context: Google walk times feed departure/catchability selection, never replace bus legs.
export async function googleWalkContext(planner,google,origin,destination){
  // Keep nearest stops, then include access to route patterns those stops miss.
  const nearby=(coord,boarding)=>{
    const sorted=planner.stops.filter(s=>metres(coord,s.coord)<=850).sort((a,b)=>metres(coord,a.coord)-metres(coord,b.coord));
    const chosen=sorted.slice(0,5),covered=new Set();
    const routesAt=s=>(planner.routes||[]).filter(r=>r.stops.some(t=>t.code===s.code&&(boarding?t.board:t.alight))).map(r=>r.code);
    chosen.forEach(s=>routesAt(s).forEach(r=>covered.add(r)));
    for(const s of sorted.slice(5)){
      const routes=routesAt(s);if(routes.some(r=>!covered.has(r))){chosen.push(s);routes.forEach(r=>covered.add(r));}
      if(chosen.length>=10)break;
    }
    return chosen;
  };
  const access=new Map(),egress=new Map();
  const start=nearby(origin.coord,true),end=nearby(destination.coord,false);
  let errors=0;
  const signal=AbortSignal.timeout(25000);
  const jobs=[...start.map(s=>async()=>{const w=await google.walk(origin.coord,s.coord,850,signal);if(w)access.set(s.code,w);}),...end.map(s=>async()=>{const w=await google.walk(s.coord,destination.coord,850,signal);if(w)egress.set(s.code,w);})];
  if(metres(origin.coord,destination.coord)<1700)jobs.push(async()=>{walking=await google.walk(origin.coord,destination.coord,2000,signal);});
  let walking=null;
  // Keep upstream concurrency bounded.
  for(let i=0;i<jobs.length;i+=4)await Promise.all(jobs.slice(i,i+4).map(async job=>{try{await job();}catch{errors++;}}));
  if(errors&&(!access.size||!egress.size))throw new GoogleError(503,'Google walking directions are unavailable. Local walking paths can still be used.');
  return {access,egress,walking,provider:'google',transfers:new Map(),partial:errors>0};
}
