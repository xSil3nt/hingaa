import {UserLocationMarker} from './location-marker.js';
import {enableGuidanceDevices} from './guidance-devices.js';
import {mapLibrary} from './google-map.js';
import {SESSION_KEY,LEASE_KEY,browserStore,isCurrentSession,loadSession,saveSession,confirmStep,previousStep,ProgressTracker} from './session-core.js';
const $=id=>document.getElementById(id),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const locationDot=new UserLocationMarker();
const owner=crypto.randomUUID();let session=loadSession(browserStore),watch=null,wake=null,registration=null,map=null,L=null,userLayer=null,routeLayer=null,follow=true,lastFix=null,tracker=new ProgressTracker(),polling=false,leaseTimer=null,remaining=null;
function alertText(text){$('alert').textContent=text;$('alert').hidden=!text;}
function lease(){try{return JSON.parse(browserStore.getItem(LEASE_KEY));}catch{return null;}}
function claim(){if(!session||!isCurrentSession(browserStore,session.id)){stopTracking();session=null;render();alertText('Your previous journey has ended. A new journey was started.');return false;}const l=lease();if(l&&l.owner!==owner&&l.until>Date.now()){alertText('This journey is active in another tab. Close that tab to continue here.');return false;}try{browserStore.setItem(LEASE_KEY,JSON.stringify({owner,session:session.id,until:Date.now()+15000}));return lease()?.owner===owner;}catch{alertText('Session storage is unavailable. Enable site storage to use guidance.');return false;}}
function release(){if(lease()?.owner===owner)browserStore.removeItem(LEASE_KEY);clearInterval(leaseTimer);leaseTimer=null;}
function persist(){if(!session||!isCurrentSession(browserStore,session.id)){stopTracking();return;}try{saveSession(browserStore,session);}catch(error){$('storage-warning').hidden=false;$('storage-warning').textContent=error.message+' Keep this page open.';}}
async function awake(){try{if(document.visibilityState==='visible'&&watch!==null&&navigator.wakeLock)wake=await navigator.wakeLock.request('screen');}catch{}}
function stopTracking(){locationDot.disableCompass();locationDot.clear();if(watch!==null)navigator.geolocation?.clearWatch(watch);watch=null;wake?.release().catch(()=>{});wake=null;release();}
function hideFinishedTools(){for(const selector of ['#step-controls','#feed-status','.session-panel>details'])document.querySelector(selector)?.setAttribute('hidden','');}
function render(){
  if(!session){hideFinishedTools();routeLayer?.clearLayers();userLayer?.clearLayers();$('instruction').innerHTML='<h1>No active journey</h1><p>Choose a route to start.</p><a class="primary" href="/">Find a journey</a>';$('session-status').textContent='Ready when you are';$('end').hidden=true;return;}
  if(session.status==='completed'){
    hideFinishedTools();
    $('instruction').innerHTML='<div class="session-finish">✓</div><h1>You’ve arrived</h1><p>'+escape(session.destination.name)+'</p><a href="/">Plan another journey</a>';$('session-status').textContent='Journey complete';$('step-controls').hidden=false;$('previous-step').disabled=false;$('next-step').disabled=true;stopTracking();return;
  }
  const leg=session.legs[session.index],riding=leg.type==='bus'&&session.phase!=='boarding';
  $('feed-status').hidden=false;document.querySelector('.session-panel>details').hidden=false;
  $('session-status').textContent='Step '+(session.index+1)+' of '+session.legs.length;
  const next=riding?leg.stopPoints[Math.min(session.stopIndex+1,leg.stopPoints.length-1)]:null;
  $('instruction').innerHTML=leg.type==='walk'?'<span class="session-kicker">Walk to</span><h1>'+escape(leg.to||session.destination.name)+'</h1><p>'+(remaining===null?leg.minutes+' min · '+Math.round(leg.distance)+' m':Math.round(remaining)+' m to go')+'</p>':
    '<span class="route-badge">'+escape(leg.number)+'</span><h1>'+escape(session.phase==='boarding'?'Board at '+leg.from:session.phase==='alight'?'Get off here':'Stay on the bus')+'</h1><p>'+escape(session.phase==='boarding'?leg.direction:session.phase==='alight'?leg.to:'Next: '+next.name)+'</p><div class="session-target"><small>Get off at</small><strong>'+escape(leg.to)+'</strong>'+(riding?Math.max(0,leg.stopPoints.length-1-session.stopIndex)+' stops remaining':'')+'</div>'+(riding?'<progress aria-label="Bus stops completed" max="'+(leg.stopPoints.length-1)+'" value="'+session.stopIndex+'"></progress>':'');
  $('step-controls').hidden=false;$('next-step').disabled=false;
  $('previous-step').disabled=session.index===0&&(leg.type!=='bus'||session.phase==='boarding');
  if(session.phase!=='boarding')$('feed-status').textContent='';
  $('steps').innerHTML=session.legs.map((l,i)=>'<li class="'+(i===session.index?'current':i<session.index?'done':'')+'">'+escape(l.type==='bus'?l.number+' · '+l.from+' → '+l.to:'Walk to '+(l.to||session.destination.name))+'</li>').join('');
}
function drawRoute(){if(!map||!session)return;routeLayer.clearLayers();const leg=session.legs[session.index];if(!leg)return;
  L.polyline(leg.coords.map(p=>[p[1],p[0]]),{color:leg.type==='walk'?'#62667c':'#585b9d',weight:6,opacity:.95,dashArray:leg.type==='walk'?'3 8':null}).addTo(routeLayer);
  for(const p of [leg.coords[0],leg.coords.at(-1)])L.circleMarker([p[1],p[0]],{radius:7,color:'#505b94',fillColor:'#fff',fillOpacity:1}).addTo(routeLayer);
  map.fitBounds(L.latLngBounds(leg.coords.map(p=>[p[1],p[0]])),{maxZoom:16});
}
async function notify(event){
  if(!session||!isCurrentSession(browserStore,session.id))return;
  alertText(event.title+' · '+event.body);
  navigator.vibrate?.([160,80,160]);
  if(registration&&globalThis.Notification?.permission==='granted')try{await registration.showNotification(event.title,{body:event.body,icon:'/icon.svg',tag:'hingaa:'+session.id+':'+event.key,data:{session:session.id}});}catch{alertText(event.title+' · '+event.body+' (Device notifications unavailable.)');}
}
function gotPosition(position){
  if(!session||lease()?.owner!==owner||!isCurrentSession(browserStore,session.id)){stopTracking();render();return;}
  const fix={coord:[position.coords.longitude,position.coords.latitude],accuracy:position.coords.accuracy,timestamp:position.timestamp};
  if(!session||session.expiresAt<Date.now()){stopTracking();if(isCurrentSession(browserStore,session.id))browserStore.removeItem(SESSION_KEY);session=null;render();return;}
  const before=session.index,result=tracker.update(session,fix);
  if(result.quality==='good'){lastFix=fix;remaining=result.remaining??null;}else{userLayer?.clearLayers();locationDot.clear();}
  if(result.quality==='good'&&map){userLayer.clearLayers();locationDot.update(position.coords,position.timestamp);if(follow)map.setView([fix.coord[1],fix.coord[0]],16);}
  persist();if(before!==session.index)remaining=null;render();if(before!==session.index)drawRoute();result.events.forEach(notify);
  if(session.status==='completed')stopTracking();
}
function startTracking(){
  if(!session||session.status==='completed'||watch!==null)return;
  if(!navigator.geolocation){alertText('Location is unavailable. Use Next and Previous to continue.');return;}
  if(!claim())return;
  locationDot.enableCompass(false);
  session.status='active';session.startedAt??=Date.now();tracker=new ProgressTracker();persist();
  watch=navigator.geolocation.watchPosition(gotPosition,error=>{
    alertText(error.code===1?'Allow location in your browser for automatic steps. Next and Previous still work.':'Waiting for GPS. Next and Previous still work.');
    if(error.code===1){stopTracking();session.status='paused';persist();}render();
  },{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
  leaseTimer=setInterval(()=>{if(lease()?.owner!==owner||!isCurrentSession(browserStore,session.id)){stopTracking();render();return;}browserStore.setItem(LEASE_KEY,JSON.stringify({owner,session:session.id,until:Date.now()+15000}));},5000);
  awake();render();
}
async function closeNotifications(id=session?.id){try{const r=registration||await navigator.serviceWorker?.getRegistration();const list=await r?.getNotifications();list?.filter(n=>n.data?.session===id).forEach(n=>n.close());}catch{}}
function changeStep(direction){if(!session||!claim())return;direction<0?previousStep(session):confirmStep(session);remaining=null;lastFix=null;tracker=new ProgressTracker();persist();alertText('');render();drawRoute();if(session.status!=='completed')startTracking();if(watch===null)release();refreshFeed();}
$('previous-step').onclick=()=>changeStep(-1);
$('next-step').onclick=()=>changeStep(1);
document.addEventListener('click',()=>{if(session&&session.status!=='completed')enableGuidanceDevices().then(()=>locationDot.enableCompass(false));},{once:true});
$('end').onclick=()=>$('end-dialog').showModal();$('keep-going').onclick=()=>$('end-dialog').close();
$('end-confirm').onclick=async()=>{stopTracking();await closeNotifications();if(session&&isCurrentSession(browserStore,session.id))browserStore.removeItem(SESSION_KEY);location.href='/';};
async function refreshFeed(){
  const leg=session?.legs[session.index];if(!leg||leg.type!=='bus'||session.status==='completed'||document.hidden||polling)return;
  polling=true;const index=session.index;
  try{const response=await fetch('/api/feed?code='+encodeURIComponent(leg.routeCode),{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error();const feed=await response.json();if(index!==session.index)return;
    const eta=feed.eta,rows=eta?.ok&&Date.now()-Date.parse(eta.fetchedAtUtc)<90000?['inboundStopsETAList','outboundStopsETAList'].flatMap(k=>eta.data?.[k]||[]).filter(r=>String(r.stopCode)===leg.fromCode&&String(r.routeCode)===leg.routeCode&&r.destination===leg.terminal):[];
    $('feed-status').textContent=session.phase==='boarding'?(rows.length?'At your stop: '+rows.map(r=>r.eta).slice(0,2).join(' · '):'No live bus arrival right now. Follow the route and check the stop.'):'';
  }catch{$('feed-status').textContent='Live bus updates unavailable. GPS guidance still works.';}finally{polling=false;}
}
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){tracker=new ProgressTracker();lastFix=null;startTracking();render();awake();refreshFeed();}
});
window.addEventListener('pagehide',()=>{stopTracking();});
window.addEventListener('storage',event=>{if(event.key===SESSION_KEY){const fresh=loadSession(browserStore);if(!fresh||fresh.id!==session?.id){stopTracking();closeNotifications();session=null;render();alertText(fresh?'Your previous journey has ended. A new journey was started.':'This journey has ended.');}else if(lease()?.owner!==owner){session=fresh;render();drawRoute();}}});
setInterval(()=>{if(session&&session.expiresAt<Date.now()){stopTracking();if(isCurrentSession(browserStore,session.id))browserStore.removeItem(SESSION_KEY);session=null;render();return;}if(watch!==null&&(!lastFix||Date.now()-lastFix.timestamp>30000)){userLayer?.clearLayers();locationDot.clear();}},5000);
setInterval(refreshFeed,30000);
if(session)session.status=session.status==='completed'?'completed':'paused';
render();
if(session)try{
  const config=await(await fetch('/api/config',{signal:AbortSignal.timeout(10000)})).json();const setup=await mapLibrary(config.browserKey);L=setup.library;map=L.map('map').setView([4.202,73.527],13);locationDot.attach(map,L);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(map);routeLayer=L.layerGroup().addTo(map);userLayer=L.layerGroup().addTo(map);map.on('dragstart',()=>{follow=false;});drawRoute();refreshFeed();
}catch{alertText('Map unavailable. Your journey instructions are still here.');}
if(session&&session.status!=='completed')startTracking();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').then(r=>{registration=r;}).catch(()=>{});
navigator.permissions?.query({name:'geolocation'}).then(p=>{p.onchange=()=>{if(p.state==='granted')startTracking();};}).catch(()=>{});
