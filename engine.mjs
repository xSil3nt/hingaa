export const BUFFER = 2;
export const metres = (a,b) => {
  const rad = Math.PI/180, dlat=(a[1]-b[1])*rad, dlon=(a[0]-b[0])*rad;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dlon/2)**2)));
};
export const localDate = ms => new Date(ms+5*3600000).toISOString().slice(0,10);
export function parseEta(text) {
  const s = String(text || '').trim();
  if (/^Entering the station$/i.test(s)) return 0;
  const m = s.match(/^(?:Send in\s+)?(\d+)\s*Minutes?$/i);
  return m ? +m[1] : null;
}
class Heap {
  a=[];
  push(v) { let i=this.a.push(v)-1; while(i){const p=(i-1)>>1;if(this.a[p][0]<=v[0])break;this.a[i]=this.a[p];i=p;}this.a[i]=v; }
  pop() {const top=this.a[0],v=this.a.pop();if(this.a.length){let i=0;while(2*i+1<this.a.length){let c=2*i+1;if(c+1<this.a.length&&this.a[c+1][0]<this.a[c][0])c++;if(this.a[c][0]>=v[0])break;this.a[i]=this.a[c];i=c;}this.a[i]=v;}return top;}
}
export class Walker {
  constructor(data) {
    this.nodes=data.nodes; this.land=data.land||[];this.adj=this.nodes.map(()=>[]); this.reverse=this.nodes.map(()=>[]);
    for(const [a,b,name,oneway] of data.edges){const d=metres(this.nodes[a],this.nodes[b]);if(d>350)continue;
      if(oneway!==-1){this.adj[a].push([b,d,name]);this.reverse[b].push([a,d,name]);}
      if(oneway!==1){this.adj[b].push([a,d,name]);this.reverse[a].push([b,d,name]);}}
  }
  onLand(p) {
    if(!this.land.length)return true;
    return this.land.some(poly=>{let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }return inside;});
  }
  snap(coord) {if(!this.onLand(coord))return null;let best=null,d=55;this.nodes.forEach((p,i)=>{
    if(!this.adj[i].length&&!this.reverse[i].length)return;const n=metres(p,coord);
    if(n<d&&[.25,.5,.75,1].every(t=>this.onLand([coord[0]+(p[0]-coord[0])*t,coord[1]+(p[1]-coord[1])*t]))){d=n;best=i;}
  });return best===null?null:{id:best,d};}
  tree(coord,limit=1100,reverse=false) {
    const start=this.snap(coord);if(!start)return null;
    const dist=new Map([[start.id,start.d]]),prev=new Map(),names=new Map(),heap=new Heap();heap.push([start.d,start.id]);
    while(heap.a.length){const [d,id]=heap.pop();if(d!==dist.get(id))continue;for(const [to,w,name] of (reverse?this.reverse:this.adj)[id]){const nd=d+w;if(nd>limit||nd>=(dist.get(to)??Infinity))continue;dist.set(to,nd);prev.set(to,id);names.set(to,name);heap.push([nd,to]);}}
    return {coord,start,dist,prev,names,reverse};
  }
  path(tree,to,max=1000) {
    if(!tree)return null;
    if(metres(tree.coord,to)<1)return {type:'walk',distance:0,minutes:0,coords:[tree.coord,to],streets:[],accessMetres:0};
    const end=this.snap(to);if(!end)return null;
    const d=(tree.dist.get(end.id)??Infinity)+end.d;if(d>max)return null;
    let id=end.id;const ids=[id],names=[];while(tree.prev.has(id)){names.push(tree.names.get(id));id=tree.prev.get(id);ids.push(id);}ids.reverse();names.reverse();
    let coords=[tree.coord,...ids.map(i=>this.nodes[i]),to];if(tree.reverse){coords.reverse();names.reverse();}
    // Access connectors are short snaps, not surveyed entrance paths; expose their length.
    return {type:'walk',distance:Math.round(d),minutes:Math.max(1,Math.ceil(d/75)),coords,
      streets:[...new Set(names.filter(n=>!['residential','service','footway','pedestrian','path','steps','unclassified'].includes(n)))].slice(0,3),
      accessMetres:Math.round(tree.start.d+end.d)};
  }
}
function alignShape(route) {
  const lines=route.shape.features.flatMap(f=>f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.type==='MultiLineString'?f.geometry.coordinates:[]).filter(x=>x.length>1);
  let line=lines.sort((a,b)=>b.length-a.length)[0]||[];
  if(!line.length)return {line,indices:[],errors:[]};
  if(metres(line[0],line.at(-1))<15){
    const start=line.reduce((best,p,i)=>metres(p,route.stops[0].coord)<metres(line[best],route.stops[0].coord)?i:best,0);
    line=[...line.slice(start),...line.slice(1,start+1)];
  }
  // Global monotone alignment preserves each occurrence on a loop. Never reverse or wrap stops.
  let layers=[];
  for(const [sidx,s] of route.stops.entries()){
    let candidates=line.map((p,i)=>({i,d:metres(p,s.coord)})).sort((a,b)=>a.d-b.d).slice(0,36);
    if(sidx===0)candidates=candidates.filter(c=>c.i<line.length*.5);
    const layer=candidates.map(c=>({...c,cost:Infinity,parent:-1}));
    if(sidx===0)for(const c of layer)c.cost=c.d*c.d;
    else for(const c of layer)for(let p=0;p<layers.at(-1).length;p++){const last=layers.at(-1)[p];if(last.i<c.i&&last.cost+c.d*c.d<c.cost){c.cost=last.cost+c.d*c.d;c.parent=p;}}
    layers.push(layer);
  }
  let p=layers.at(-1)?.reduce((best,c,i,a)=>c.cost<(a[best]?.cost??Infinity)?i:best,0),indices=[],errors=[];
  for(let l=layers.length-1;l>=0;l--){const c=layers[l][p];if(!c||!Number.isFinite(c.cost))return {line,indices:[],errors:[]};indices.unshift(c.i);errors.unshift(Math.round(c.d));p=c.parent;}
  const cumulative=[0];for(let i=1;i<line.length;i++)cumulative.push(cumulative.at(-1)+metres(line[i-1],line[i]));
  return {line,indices,errors,cumulative};
}
export function normalizeRoutes(data) {
  return data.routes.map(r=>{const route={...r,code:String(r.code),stops:[...r.busRouteStopList].sort((a,b)=>a.order-b.order).map(s=>({...s,code:String(s.code),name:s.name.trim(),coord:[+s.longitude,+s.latitude],board:!/(drop[ -]?off only|alighting only)/i.test(s.name),alight:!/(pick[ -]?up only|boarding only)/i.test(s.name)}))};
    route.geometry=alignShape(route);return route;});
}
const clean = s => String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function arrivalsFor(route,stop,feed,now) {
  const result=[];if(!feed?.eta?.ok||now-Date.parse(feed.eta.fetchedAtUtc)>90000)return result;
  for(const key of ['inboundStopsETAList','outboundStopsETAList']){
    const rows=feed.eta.data?.[key]||[];
    for(const row of rows){
      if(String(row.stopCode)!==stop.code||String(row.routeCode)!==route.code||clean(row.destination)!==clean(route.endStationName)||!['I','O'].includes(row.direction))continue;
      if(route.stops.filter(s=>s.code===stop.code).length!==1)continue;
      const context=rows.filter(x=>x.direction===row.direction&&x.destination===row.destination).sort((a,b)=>a.stopOrder-b.stopOrder);
      const mapped=context.map(x=>route.stops.findIndex(s=>s.code===String(x.stopCode))).filter(i=>i>=0);
      if(mapped.some((v,i)=>i&&v<mapped[i-1]))continue;
      const minutes=parseEta(row.eta);if(minutes===null)continue;
      const departure=Date.parse(feed.eta.fetchedAtUtc)+minutes*60000;
      result.push({departure,source:'live',text:row.eta.trim(),vehicleCode:row.vehicleCode,direction:row.direction,checkedAt:feed.eta.fetchedAtUtc});
    }
  }
  return result;
}
export function chooseDeparture(route,stop,ready,feed,now,snapshotAt) {
  const live=arrivalsFor(route,stop,feed,now),possible=live.filter(x=>x.departure>=ready);
  const missed=live.filter(x=>x.departure<ready).length;
  const freshStop=feed?.schedule?.ok?feed.schedule.data?.routeResponse?.find(r=>String(r.code)===route.code)?.busRouteStopList?.find(s=>String(s.code)===stop.code&&+s.order===+stop.order&&Array.isArray(s.timings)):null;
  const snapshot=freshStop?feed.schedule.fetchedAtUtc:snapshotAt;
  const sourceStop=freshStop||stop;
  if(localDate(now)===localDate(Date.parse(snapshot))){
    const date=localDate(now);
    for(const t of sourceStop.timings||[]){if(!/^\d{2}:\d{2}:\d{2}$/.test(t.timing))continue;
      const departure=Date.parse(`${date}T${t.timing}+05:00`);if(departure>=ready&&departure<=now+3*3600000)possible.push({departure,source:freshStop?'published':'saved',checkedAt:snapshot,text:t.timing});}
  }
  possible.sort((a,b)=>a.departure-b.departure||(a.source==='live'?-1:1));
  // Prefer a catchable live observation close to a published timing; keep its uncertainty visible.
  const first=possible[0],observed=possible.find(p=>p.source==='live'&&p.departure<=(first?.departure??0)+3*60000);
  return {...(observed||first||{departure:ready,source:'unknown',text:'Next departure unknown'}),missed};
}
export class Planner {
  constructor(data,walkData) {
    this.routes=normalizeRoutes(data);this.snapshotAt=data.fetchedAtUtc;this.walker=new Walker(walkData);
    this.stops=[...new Map(this.routes.flatMap(r=>r.stops).map(s=>[s.code,s])).values()];this.transferCache=new Map();
  }
  walkBetween(a,b,max=300) {
    const key=a.code+'>'+b.code;if(!this.transferCache.has(key))this.transferCache.set(key,this.walker.path(this.walker.tree(a.coord,400),b.coord,max));return this.transferCache.get(key);
  }
  bus(route,i,j,ready,feed,now) {
    const from=route.stops[i],to=route.stops[j],g=route.geometry;
    if(j<=i||!from.board||!to.alight||!g.indices.length||Math.max(...g.errors.slice(i,j+1))>220)return null;
    const d=g.cumulative[g.indices[j]]-g.cumulative[g.indices[i]];
    const rideMinutes=Math.max(2,Math.ceil(d/400+(j-i)*.55));
    const dep=chooseDeparture(route,from,ready,feed,now,this.snapshotAt);
    return {type:'bus',routeCode:route.code,number:route.routeNumber,routeName:route.name,from:from.name,to:to.name,fromCode:from.code,toCode:to.code,
      fromOrder:from.order,toOrder:to.order,direction:`via ${route.stops[i+1].name}`,terminal:route.endStationName,stops:j-i,
      stopNames:route.stops.slice(i+1,j+1).map(s=>s.name),stopPoints:route.stops.slice(i,j+1).map(s=>({code:s.code,name:s.name,coord:s.coord})),coords:g.line.slice(g.indices[i],g.indices[j]+1),distance:Math.round(d),minutes:rideMinutes,
      departure:dep,arrival:dep.departure+rideMinutes*60000,fare:route.isDistanceFareType?null:+route.fare};
  }
  plan(origin,destination,feeds={},now=Date.now(),options={}) {
    const startTree=this.walker.tree(origin.coord,1050),endTree=this.walker.tree(destination.coord,1050,true);
    const external=options.walking;
    const access=external?.access||new Map(),egress=external?.egress||new Map();
    if(!external)for(const s of this.stops){const a=this.walker.path(startTree,s.coord,850),b=this.walker.path(endTree,s.coord,850);if(a)access.set(s.code,a);if(b)egress.set(s.code,b);}
    if(!external&&(!startTree||!endTree))return {journeys:[],reason:'This pin is too far from a mapped public walking path. Choose a nearby street or a named bus stop.'};
    const raw=[];
    const add=legs=>{
      const buses=legs.filter(l=>l.type==='bus'),last=buses.at(-1),walk=legs.filter(l=>l.type==='walk').reduce((a,l)=>a+l.distance,0);
      const known=buses.every(l=>l.departure.source!=='unknown');
      const finish=(last?last.arrival:now)+(legs.at(-1).type==='walk'?legs.at(-1).minutes*60000:0);
      const travelMinutes=legs.reduce((sum,l)=>sum+l.minutes,0)+buses.length*BUFFER;
      raw.push({legs,transfers:Math.max(0,buses.length-1),walkMetres:walk,travelMinutes,unknownWaits:buses.filter(l=>l.departure.source==='unknown').length,minutes:known?Math.ceil((finish-now)/60000):travelMinutes,arrival:known?finish:null,
        timing:known?'estimated':'incomplete',fare:buses.every(b=>b.fare!==null)?buses.reduce((a,b)=>a+b.fare,0):null,
        missed:buses.reduce((a,b)=>a+b.departure.missed,0),id:legs.filter(l=>l.type==='bus').map(l=>l.routeCode+':'+l.fromOrder+'-'+l.toOrder).join('/')||'walk'});
    };
    const walking=external?external.walking:this.walker.path(this.walker.tree(origin.coord,2200),destination.coord,2000);
    if(walking)add([walking]);
    const starts=[],ends=[];
    for(const r of this.routes)for(let i=0;i<r.stops.length;i++){
      const s=r.stops[i];if(access.has(s.code)&&s.board)starts.push({r,i,walk:access.get(s.code)});
      if(egress.has(s.code)&&s.alight)ends.push({r,j:i,walk:egress.get(s.code)});
    }
    for(const a of starts)for(const b of ends)if(a.r===b.r&&a.i<b.j){
      const bus=this.bus(a.r,a.i,b.j,now+(a.walk.minutes+BUFFER)*60000,feeds[a.r.code],now);if(bus)add([{...a.walk,to:bus.from},bus,{...b.walk,to:destination.name}]);
    }
    // Enumerate one transfer only, with a routed pedestrian connection between occurrences.
    for(const a of starts)for(const b of ends){
      if(a.r===b.r)continue;
      for(let x=a.i+1;x<a.r.stops.length;x++){
        const s=a.r.stops[x];if(!s.alight)continue;
        for(let y=0;y<b.j;y++){
          const t=b.r.stops[y];if(!t.board||metres(s.coord,t.coord)>240)continue;
          const transfer=external?.transfers?.has(s.code+'>'+t.code)?external.transfers.get(s.code+'>'+t.code):external?.strictTransfers?null:this.walkBetween(s,t);if(!transfer)continue;
          const first=this.bus(a.r,a.i,x,now+(a.walk.minutes+BUFFER)*60000,feeds[a.r.code],now);if(!first)continue;
          const second=this.bus(b.r,y,b.j,first.arrival+(transfer.minutes+BUFFER)*60000,feeds[b.r.code],now);if(!second)continue;
          if(first.departure.source==='unknown')second.departure={...second.departure,source:'unknown',checkedAt:null,vehicleCode:null,dependent:true};
          add([{...a.walk,to:first.from},first,{...transfer,to:second.from,transfer:true},second,{...b.walk,to:destination.name}]);
        }
      }
    }
    const distinct=new Map();for(const j of raw.sort((a,b)=>(a.timing==='incomplete')-(b.timing==='incomplete')||a.minutes-b.minutes))if(!distinct.has(j.id))distinct.set(j.id,j);
    const unique=[...distinct.values()];
    const fastest=[...unique].sort((a,b)=>(a.timing==='incomplete')-(b.timing==='incomplete')||a.minutes-b.minutes)[0];
    const simple=[...unique].sort((a,b)=>(a.timing==='incomplete')-(b.timing==='incomplete')||a.transfers-b.transfers||a.minutes-b.minutes)[0];
    const lessWalk=[...unique].sort((a,b)=>(a.timing==='incomplete')-(b.timing==='incomplete')||a.walkMetres-b.walkMetres||a.minutes-b.minutes)[0];
    const selected=[];for(const [j,label] of [[fastest,'Earliest estimate'],[simple,'Fewer changes'],[lessWalk,'Less walking']])if(j){const old=selected.find(x=>x.id===j.id);if(old)old.labels.push(label);else selected.push({...j,labels:[label]});}
    for(const j of unique)if(selected.length<5&&!selected.some(s=>s.id===j.id))selected.push({...j,labels:['Alternative']});
    return {journeys:selected,computedAt:new Date(now).toISOString(),origin,destination,snapshotAt:this.snapshotAt,reason:selected.length?null:'No connected journey found within an 850 m walk at either end and one transfer. Try a nearby stop. Ferry journeys are not included.'};
  }
}
