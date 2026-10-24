export const SESSION_KEY='hingaa.journey.v1',LEASE_KEY='hingaa.journey.owner.v1',TTL=6*3600000;
export const browserStore={getItem(key){try{return window.localStorage.getItem(key);}catch{return null;}},setItem(key,value){window.localStorage.setItem(key,value);},removeItem(key){try{window.localStorage.removeItem(key);}catch{}}};
export const distance=(a,b)=>{
  const r=Math.PI/180,x=(b[0]-a[0])*r,y=(b[1]-a[1])*r;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.sin(y/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(x/2)**2)));
};
const coord=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>73.47&&p[0]<73.57&&p[1]>4.145&&p[1]<4.265;
export function validSession(s,now=Date.now()){
  return !!(s?.version===1&&typeof s.id==='string'&&s.id.length<100&&Number.isFinite(s.expiresAt)&&s.expiresAt>now&&s.createdAt<=now+60000&&s.expiresAt-s.createdAt<=TTL&&['active','paused','completed'].includes(s.status)&&['boarding','walking','riding','alight','done'].includes(s.phase)&&Number.isFinite(s.progress)&&s.progress>=0&&Number.isInteger(s.stopIndex)&&s.stopIndex>=0&&coord(s.origin?.coord)&&coord(s.destination?.coord)&&typeof s.destination.name==='string'&&Array.isArray(s.legs)&&s.legs.length>0&&s.legs.length<=8&&Number.isInteger(s.index)&&s.index>=0&&(s.status==='completed'?s.index===s.legs.length:s.index<s.legs.length)&&s.legs.every(l=>['bus','walk'].includes(l.type)&&Array.isArray(l.coords)&&l.coords.length>=2&&l.coords.length<30000&&l.coords.every(coord)&&(l.type!=='bus'||(Array.isArray(l.stopPoints)&&l.stopPoints.length>=2&&l.stopPoints.every(p=>coord(p.coord)&&typeof p.name==='string'))))&&Array.isArray(s.alerts)&&s.alerts.length<300&&s.alerts.every(k=>typeof k==='string'));
}
export function createSession(journey,origin,destination,now=Date.now()){
  const legs=structuredClone(journey.legs.filter(l=>l.type==='bus'||l.distance>0));
  if(!legs.length)legs.push(structuredClone(journey.legs[0]));
  const s={version:1,id:crypto.randomUUID(),createdAt:now,expiresAt:now+TTL,status:'paused',index:0,phase:legs[0].type==='bus'?'boarding':'walking',stopIndex:0,progress:0,alerts:[],legs,origin:{name:origin.name,coord:origin.coord},destination:{name:destination.name,coord:destination.coord}};
  if(!validSession(s,now))throw Error('Please find a fresh journey before starting.');
  return s;
}
export function loadSession(storage,now=Date.now()){
  try{const s=JSON.parse(storage.getItem(SESSION_KEY));if(validSession(s,now))return s;storage.removeItem(SESSION_KEY);}catch{}return null;
}
export function saveSession(storage,s){if(!validSession(s))throw Error('Journey session expired. Find a new journey.');storage.setItem(SESSION_KEY,JSON.stringify(s));}
export function replaceSession(storage,s){saveSession(storage,s);storage.removeItem(LEASE_KEY);}
export function isCurrentSession(storage,id){try{return JSON.parse(storage.getItem(SESSION_KEY))?.id===id;}catch{return false;}}
export function advance(s){
  s.index++;s.stopIndex=0;s.progress=0;
  if(s.index>=s.legs.length){s.status='completed';s.phase='done';}
  else s.phase=s.legs[s.index].type==='bus'?'boarding':'walking';
}
export function confirmStep(s){
  if(s.status==='completed')return;
  const l=s.legs[s.index];
  if(l.type==='bus'&&s.phase==='boarding'){s.phase='riding';s.stopIndex=0;s.progress=0;}
  else advance(s);
}
// Project onto the ordered route, restricting jumps and backward loop matches.
export function project(coords,p,min=0,max=Infinity){
  let along=0,best=null;const scale=Math.cos(p[1]*Math.PI/180);
  for(let i=1;i<coords.length;i++){
    const a=coords[i-1],b=coords[i],len=distance(a,b);
    const ax=(a[0]-p[0])*scale,ay=a[1]-p[1],dx=(b[0]-a[0])*scale,dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1))),at=along+t*len;
    const point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],away=distance(point,p);
    if(at>=min&&at<=max&&(!best||away<best.away))best={along:at,away};along+=len;
  }
  return best?{...best,total:along}:null;
}
export class ProgressTracker{
  constructor(){this.last=null;this.hit=null;}
  update(s,fix,now=Date.now()){
    const events=[];
    if(s.status!=='active'||!coord(fix.coord)||!Number.isFinite(fix.accuracy)||fix.accuracy<0||fix.accuracy>60||!Number.isFinite(fix.timestamp)||now-fix.timestamp>20000||fix.timestamp>now+5000)return {events,quality:'weak'};
    if(this.last&&fix.timestamp<=this.last.timestamp)return {events,quality:'stale'};
    if(this.last&&distance(this.last.coord,fix.coord)/((fix.timestamp-this.last.timestamp)/1000)>45)return {events,quality:'jump'};
    const elapsed=this.last?Math.min(60,(fix.timestamp-this.last.timestamp)/1000):0;this.last=fix;
    const leg=s.legs[s.index];if(!leg)return {events,quality:'good'};
    const emit=(key,title,body)=>{key=s.index+':'+key;if(!s.alerts.includes(key)){s.alerts.push(key);events.push({key,title,body});}};
    const close=(key,d,limit)=>{
      if(d>limit){this.hit=null;return false;}
      if(this.hit?.key===key&&fix.timestamp-this.hit.at>=1500){this.hit=null;return true;}
      if(this.hit?.key!==key)this.hit={key,at:fix.timestamp};return false;
    };
    if(leg.type==='walk'){
      const end=leg.coords.at(-1),d=distance(fix.coord,end);
      if(close('walk',d,40)){emit('walk',s.index===s.legs.length-1?'You’ve arrived':'You’re here',leg.to||s.destination.name);advance(s);}
      const p=project(leg.coords,fix.coord);
      return {events,quality:p&&p.away>100?'off-route':'good',remaining:p&&p.away<100?Math.max(0,p.total-p.along):d};
    }
    if(s.phase==='boarding'){
      if(close('board',distance(fix.coord,leg.coords[0]),50))emit('board','At your bus stop','Take '+leg.number+' from '+leg.from+'. Tap “I’m on the bus” once aboard.');
      return {events,quality:'good'};
    }
    const p=project(leg.coords,fix.coord,Math.max(0,s.progress-80),s.progress+Math.max(450,elapsed*35+100));
    if(!p||p.away>Math.max(100,fix.accuracy*2))return {events,quality:'off-route'};
    s.progress=Math.max(s.progress,p.along);
    const stops=leg.stopPoints,last=stops.length-1;
    const positions=[0];for(let i=1;i<stops.length;i++)positions.push(project(leg.coords,stops[i].coord,positions.at(-1)+1)?.along??Infinity);
    // Only ordered nearby stops can advance. Accuracy alone cannot confirm a stop.
    let candidate=null;
    for(let i=s.stopIndex+1;i<=Math.min(last,s.stopIndex+3);i++){
      const d=distance(fix.coord,stops[i].coord);if(d<60&&Math.abs(positions[i]-s.progress)<100&&(!candidate||d<candidate.d))candidate={i,d};
    }
    if(candidate&&close('stop:'+candidate.i,candidate.d,60)){
      s.stopIndex=candidate.i;
      if(candidate.i===last){s.phase='alight';emit('alight','Get off here',leg.to+'. Confirm once you’re off the bus.');}
      else emit('stop:'+candidate.i,stops[candidate.i].name,(last-candidate.i)+' '+(last-candidate.i===1?'stop':'stops')+' to '+leg.to);
    }else if(!candidate)this.hit=null;
    if(s.phase!=='alight'&&(last-s.stopIndex<=1||p.total-s.progress<=400))emit('prepare','Your stop is coming up','Get ready to get off at '+leg.to+'.');
    return {events,quality:'good',remaining:Math.max(0,p.total-s.progress)};
  }
}
