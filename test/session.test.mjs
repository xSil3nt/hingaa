import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,validSession,loadSession,saveSession,confirmStep,ProgressTracker,SESSION_KEY,LEASE_KEY,replaceSession,isCurrentSession,TTL} from '../public/session-core.js';
const a=[73.51,4.17],b=[73.512,4.17],c=[73.514,4.17],now=Date.now();
const bus={type:'bus',number:'R1',from:'Start',to:'Finish',coords:[a,b,c],stopPoints:[{name:'Start',coord:a},{name:'Middle',coord:b},{name:'Finish',coord:c}],distance:444,minutes:5};
const walk={type:'walk',to:'Start',coords:[[73.509,4.17],a],distance:111,minutes:2};
const make=legs=>createSession({legs},{name:'Home',coord:a},{name:'Finish',coord:c},now);
const fix=(coord,t,accuracy=10)=>({coord,accuracy,timestamp:now+t});
const send=(tracker,s,coord,t,accuracy=10)=>tracker.update(s,fix(coord,t,accuracy),now+t);
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('session lifecycle handles walking, explicit boarding, alighting, transfers and completion',()=>{
  const s=make([walk,bus,{...walk,to:'Next stop'},bus]);
  assert.equal(s.status,'paused');assert.equal(s.phase,'walking');
  confirmStep(s);assert.equal(s.phase,'boarding');confirmStep(s);assert.equal(s.phase,'riding');assert.equal(s.index,1);
  confirmStep(s);assert.equal(s.index,2);confirmStep(s);assert.equal(s.phase,'boarding');confirmStep(s);confirmStep(s);
  assert.equal(s.status,'completed');assert.equal(s.index,s.legs.length);assert.ok(validSession(s,now));
});
test('session restore preserves phase, progress and deduplicated alerts; expired and malformed data is discarded',()=>{
  const storage=memory(),s=make([bus]);s.phase='riding';s.stopIndex=1;s.progress=222;s.alerts=['0:prepare'];saveSession(storage,s);
  assert.deepEqual(loadSession(storage,now),s);
  assert.equal(loadSession(storage,now+TTL+1),null);assert.equal(storage.getItem(SESSION_KEY),null);
  storage.setItem(SESSION_KEY,'broken');assert.equal(loadSession(storage,now),null);
  storage.setItem(SESSION_KEY,JSON.stringify({...s,index:999}));assert.equal(loadSession(storage,now),null);
});
test('GPS cannot infer boarding, and paused or inaccurate or stale fixes cannot advance steps',()=>{
  const s=make([bus]),t=new ProgressTracker();
  assert.equal(send(t,s,a,0).events.length,0);s.status='active';
  send(t,s,a,0);send(t,s,a,2000);assert.equal(s.phase,'boarding');assert.equal(s.index,0);
  const w=make([walk]);w.status='active';const tracker=new ProgressTracker();
  assert.equal(send(tracker,w,a,0,150).quality,'weak');assert.equal(w.index,0);
  assert.equal(tracker.update(w,fix(a,0),now+30000).quality,'weak');assert.equal(w.index,0);
});
test('bus progress emits middle-stop and prepare alerts once, then requires explicit alighting',()=>{
  const s=make([bus]);s.status='active';confirmStep(s);const t=new ProgressTracker();
  send(t,s,a,0);send(t,s,b,12000);const middle=send(t,s,b,14000);
  assert.equal(s.stopIndex,1);assert.ok(middle.events.some(e=>e.title==='Middle'));
  assert.ok(s.alerts.includes('0:prepare'));
  assert.equal(send(t,s,b,16000).events.length,0);
  send(t,s,c,28000);const end=send(t,s,c,30000);
  assert.equal(s.phase,'alight');assert.equal(s.status,'active');assert.ok(end.events.some(e=>e.title==='Get off here'));
  const restored=new ProgressTracker();assert.equal(send(restored,s,c,32000).events.length,0);
  confirmStep(s);assert.equal(s.status,'completed');
});
test('walking arrival needs two distinct accurate fixes and alerts are not replayed',()=>{
  const s=make([walk,bus]);s.status='active';const t=new ProgressTracker();
  send(t,s,a,0);assert.equal(s.index,0);send(t,s,a,0);assert.equal(s.index,0);
  const result=send(t,s,a,2000);assert.equal(s.index,1);assert.equal(s.phase,'boarding');assert.equal(result.events.length,1);
});
test('sudden GPS jumps and off-route points do not invent stop progress',()=>{
  const s=make([bus]);s.status='active';confirmStep(s);const t=new ProgressTracker();
  send(t,s,a,0);assert.equal(send(t,s,c,1000).quality,'jump');assert.equal(s.stopIndex,0);
  assert.equal(send(t,s,[73.51,4.174],15000).quality,'off-route');assert.equal(s.stopIndex,0);
});


test('starting a new journey replaces saved or active progress and releases the old tracking owner',()=>{
  for(const status of ['paused','active']){
    const storage=memory(),old=make([bus]);old.status=status;old.alerts=['0:prepare'];saveSession(storage,old);
    storage.setItem(LEASE_KEY,JSON.stringify({owner:'old-tab',session:old.id,until:now+15000}));
    const next=make([walk,bus]);replaceSession(storage,next);
    assert.equal(loadSession(storage,now).id,next.id);assert.equal(storage.getItem(LEASE_KEY),null);
    assert.equal(isCurrentSession(storage,old.id),false);assert.equal(isCurrentSession(storage,next.id),true);
    assert.equal(loadSession(storage,now).index,0);assert.deepEqual(loadSession(storage,now).alerts,[]);
  }
});

test('an invalid replacement preserves the existing journey and its tracking lease',()=>{
  const storage=memory(),old=make([bus]);saveSession(storage,old);storage.setItem(LEASE_KEY,'old-owner');
  assert.throws(()=>replaceSession(storage,{...old,expiresAt:0}));
  assert.equal(loadSession(storage,now).id,old.id);assert.equal(storage.getItem(LEASE_KEY),'old-owner');
});
