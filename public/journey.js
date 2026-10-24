import {mapLibrary} from './google-map.js';
import {SESSION_KEY,LEASE_KEY,browserStore,loadSession,saveSession,confirmStep,ProgressTracker,distance} from './session-core.js';
const $=id=>document.getElementById(id),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const owner=crypto.randomUUID();let session=loadSession(browserStore),watch=null,wake=null,registration=null,map=null,L=null,userLayer=null,routeLayer=null,follow=true,lastFix=null,tracker=new ProgressTracker(),polling=false,leaseTimer=null,remaining=null;
let trackingMessage='Location stays on this device.';
function alertText(text){$('alert').textContent=text;$('alert').hidden=!text;}
function lease(){try{return JSON.parse(browserStore.getItem(LEASE_KEY));}catch{return null;}}
function claim(){const l=lease();if(l&&l.owner!==owner&&l.until>Date.now()){alertText('This journey is active in another tab. Pause it there, or close that tab and try again in 15 seconds.');return false;}try{browserStore.setItem(LEASE_KEY,JSON.stringify({owner,session:session.id,until:Date.now()+15000}));return lease()?.owner===owner;}catch{alertText('Session storage is unavailable. Enable site storage to use live guidance.');return false;}}
function release(){if(lease()?.owner===owner)browserStore.removeItem(LEASE_KEY);clearInterval(leaseTimer);leaseTimer=null;}
function persist(){try{saveSession(browserStore,session);}catch(error){$('storage-warning').hidden=false;$('storage-warning').textContent=error.message+' Keep this page open.';}}
async function awake(){try{if(document.visibilityState==='visible'&&watch!==null&&navigator.wakeLock)wake=await navigator.wakeLock.request('screen');}catch{}}
function stopTracking(){if(watch!==null)navigator.geolocation?.clearWatch(watch);watch=null;wake?.release().catch(()=>{});wake=null;release();}
function hideFinishedTools(){for(const selector of ['.session-tools','.tracking-note','#location-status','#feed-status','.session-panel>details'])document.querySelector(selector)?.setAttribute('hidden','');}
function render(){
  if(!session){hideFinishedTools();routeLayer?.clearLayers();userLayer?.clearLayers();$('instruction').innerHTML='<h1>No active journey</h1><p>Choose a route to start.</p><a class="primary" href="/">Find a journey</a>';$('session-status').textContent='Ready when you are';$('tracking').hidden=true;$('confirm').hidden=true;$('end').hidden=true;return;}
  if(session.status==='completed'){
    hideFinishedTools();
    $('instruction').innerHTML='<div class="session-finish">✓</div><h1>You’ve arrived</h1><p>'+escape(session.destination.name)+'</p><a href="/">Plan another journey</a>';$('session-status').textContent='Journey complete';$('tracking').hidden=true;$('confirm').hidden=true;stopTracking();return;
  }
  const leg=session.legs[session.index],riding=leg.type==='bus'&&session.phase!=='boarding';
  $('session-status').textContent=(session.status==='paused'?'Paused · ':'')+'Step '+(session.index+1)+' of '+session.legs.length;
  const next=riding?leg.stopPoints[Math.min(session.stopIndex+1,leg.stopPoints.length-1)]:null;
  $('instruction').innerHTML=leg.type==='walk'?'<span class="session-kicker">Walk to</span><h1>'+escape(leg.to||session.destination.name)+'</h1><p>'+(remaining===null?leg.minutes+' min · '+Math.round(leg.distance)+' m':Math.round(remaining)+' m to go')+'</p>'+(leg.instructions?.length?'<details><summary>Walking directions</summary><ol>'+leg.instructions.map(i=>'<li>'+escape(i)+'</li>').join('')+'</ol></details>':''):
    '<span class="route-badge">'+escape(leg.number)+'</span><h1>'+escape(session.phase==='boarding'?'Board at '+leg.from:session.phase==='alight'?'Get off here':'Stay on the bus')+'</h1><p>'+escape(session.phase==='boarding'?leg.direction:session.phase==='alight'?leg.to:'Next: '+next.name)+'</p><div class="session-target"><small>Get off at</small><strong>'+escape(leg.to)+'</strong>'+(riding?Math.max(0,leg.stopPoints.length-1-session.stopIndex)+' stops remaining':'')+'</div>'+(riding?'<progress aria-label="Bus stops completed" max="'+(leg.stopPoints.length-1)+'" value="'+session.stopIndex+'"></progress>':'');
  $('confirm').hidden=false;$('confirm').textContent=leg.type==='walk'?'I’m here':session.phase==='boarding'?'I’m on the bus':'I’ve got off';
  $('tracking').textContent=watch!==null?'Pause guidance':session.startedAt?'Resume live guidance':'Start live guidance';
  if(session.phase!=='boarding')$('feed-status').textContent='';
  $('steps').innerHTML=session.legs.map((l,i)=>'<li class="'+(i===session.index?'current':i<session.index?'done':'')+'">'+escape(l.type==='bus'?l.number+' · '+l.from+' → '+l.to:'Walk to '+(l.to||session.destination.name))+'</li>').join('');
  $('location-status').textContent=trackingMessage;
}
function drawRoute(){if(!map||!session)return;routeLayer.clearLayers();const leg=session.legs[session.index];if(!leg)return;
  L.polyline(leg.coords.map(p=>[p[1],p[0]]),{color:leg.type==='walk'?'#62667c':'#48599f',weight:6,opacity:.95,dashArray:leg.type==='walk'?'3 8':null}).addTo(routeLayer);
  for(const p of [leg.coords[0],leg.coords.at(-1)])L.circleMarker([p[1],p[0]],{radius:7,color:'#505b94',fillColor:'#fff',fillOpacity:1}).addTo(routeLayer);
  map.fitBounds(L.latLngBounds(leg.coords.map(p=>[p[1],p[0]])),{maxZoom:16});
}
async function notify(event){
  alertText(event.title+' · '+event.body);
  navigator.vibrate?.([160,80,160]);
  if(registration&&globalThis.Notification?.permission==='granted')try{await registration.showNotification(event.title,{body:event.body,icon:'/icon.svg',tag:'hingaa:'+session.id+':'+event.key,data:{session:session.id}});}catch{alertText(event.title+' · '+event.body+' (Device notifications unavailable.)');}
}
function gotPosition(position){
  if(lease()?.owner!==owner){stopTracking();trackingMessage='Guidance moved to another tab.';render();return;}
  const fix={coord:[position.coords.longitude,position.coords.latitude],accuracy:position.coords.accuracy,timestamp:position.timestamp};
  if(!session||session.expiresAt<Date.now()){stopTracking();browserStore.removeItem(SESSION_KEY);session=null;render();return;}
  const before=session.index,result=tracker.update(session,fix);
  if(result.quality==='good'){lastFix=fix;remaining=result.remaining??null;}else userLayer?.clearLayers();
  trackingMessage=result.quality==='good'?'Location live · ±'+Math.round(fix.accuracy)+' m':result.quality==='off-route'?'You seem away from this route. Check the map or confirm your step.':result.quality==='jump'?'Location jumped. Waiting for a reliable fix.':'GPS is weak. Steps won’t advance until it improves.';
  if(result.quality==='good'&&map){userLayer.clearLayers();L.circleMarker([fix.coord[1],fix.coord[0]],{radius:9,color:'#fff',fillColor:'#356ed2',fillOpacity:1}).addTo(userLayer);if(follow)map.setView([fix.coord[1],fix.coord[0]],16);}
  persist();if(before!==session.index)remaining=null;render();if(before!==session.index)drawRoute();result.events.forEach(notify);
  if(session.status==='completed')stopTracking();
}
function startTracking(){
  if(!session||session.status==='completed')return;
  if(!navigator.geolocation){alertText('Location is unavailable. Use the step buttons to guide yourself.');return;}
  if(!claim())return;
  session.status='active';session.startedAt=Date.now();tracker=new ProgressTracker();trackingMessage='Finding your location…';persist();
  watch=navigator.geolocation.watchPosition(gotPosition,error=>{
    trackingMessage=error.code===1?'Location access is off. Use manual steps or enable location in your browser.':'Location is unavailable. Waiting for GPS; manual steps still work.';
    if(error.code===1){stopTracking();session.status='paused';persist();}render();
  },{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
  leaseTimer=setInterval(()=>{if(lease()?.owner!==owner){stopTracking();render();return;}browserStore.setItem(LEASE_KEY,JSON.stringify({owner,session:session.id,until:Date.now()+15000}));},5000);
  awake();render();
}
async function closeNotifications(){try{const r=registration||await navigator.serviceWorker?.getRegistration();const list=await r?.getNotifications();list?.filter(n=>n.data?.session===session?.id).forEach(n=>n.close());}catch{}}
$('tracking').onclick=()=>{if(watch!==null){stopTracking();session.status='paused';persist();trackingMessage='Guidance paused. Resume when you’re ready.';render();}else startTracking();};
$('confirm').onclick=()=>{if(!session)return;if(!claim())return;const previous=session.index;confirmStep(session);remaining=null;tracker=new ProgressTracker();persist();alertText('');render();if(previous!==session.index)drawRoute();if(watch===null)release();};
$('follow').onclick=()=>{follow=true;if(lastFix&&map)map.setView([lastFix.coord[1],lastFix.coord[0]],16);};
$('notifications').onclick=async()=>{
  if(!('Notification' in window)||!('serviceWorker' in navigator)){alertText('Device notifications aren’t available here. In-app stop alerts still work. On iPhone, try adding hingaa to your Home Screen.');return;}
  try{const permission=await Notification.requestPermission();if(permission!=='granted'){alertText('Device notifications are off. In-app alerts still work.');return;}registration=await navigator.serviceWorker.register('/sw.js');registration=await navigator.serviceWorker.ready;$('notifications').textContent='Notifications enabled';}catch{alertText('Notifications couldn’t be enabled. In-app alerts still work.');}
};
$('end').onclick=()=>$('end-dialog').showModal();$('keep-going').onclick=()=>$('end-dialog').close();
$('end-confirm').onclick=async()=>{stopTracking();await closeNotifications();browserStore.removeItem(SESSION_KEY);location.href='/';};
async function refreshFeed(){
  const leg=session?.legs[session.index];if(!leg||leg.type!=='bus'||session.status==='completed'||document.hidden||polling)return;
  polling=true;const index=session.index;
  try{const response=await fetch('/api/feed?code='+encodeURIComponent(leg.routeCode),{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error();const feed=await response.json();if(index!==session.index)return;
    const eta=feed.eta,rows=eta?.ok&&Date.now()-Date.parse(eta.fetchedAtUtc)<90000?['inboundStopsETAList','outboundStopsETAList'].flatMap(k=>eta.data?.[k]||[]).filter(r=>String(r.stopCode)===leg.fromCode&&String(r.routeCode)===leg.routeCode&&r.destination===leg.terminal):[];
    $('feed-status').textContent=session.phase==='boarding'?(rows.length?'At your stop: '+rows.map(r=>r.eta).slice(0,2).join(' · '):'No live bus arrival right now. Follow the route and check the stop.'):'';
  }catch{$('feed-status').textContent='Live bus updates unavailable. GPS guidance still works.';}finally{polling=false;}
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){trackingMessage='Keep this screen open for live stop alerts.';render();}
  else{tracker=new ProgressTracker();lastFix=null;trackingMessage=watch!==null?'Waiting for a fresh location…':'Resume guidance to update your location.';render();awake();refreshFeed();}
});
window.addEventListener('pagehide',()=>{stopTracking();});
window.addEventListener('storage',event=>{if(event.key===SESSION_KEY){const fresh=loadSession(browserStore);if(!fresh||fresh.id!==session?.id){stopTracking();session=fresh;render();}else if(lease()?.owner!==owner){session=fresh;render();drawRoute();}}});
setInterval(()=>{if(session&&session.expiresAt<Date.now()){stopTracking();browserStore.removeItem(SESSION_KEY);session=null;render();return;}if(watch!==null&&(!lastFix||Date.now()-lastFix.timestamp>30000)){userLayer?.clearLayers();trackingMessage=document.hidden?'Tracking may be suspended. Reopen hingaa for alerts.':'Waiting for GPS · use manual steps if needed.';$('location-status').textContent=trackingMessage;}},5000);
setInterval(refreshFeed,30000);
if(session)session.status=session.status==='completed'?'completed':'paused';
render();
if(session)try{
  const config=await(await fetch('/api/config',{signal:AbortSignal.timeout(10000)})).json();const setup=await mapLibrary(config.browserKey);L=setup.library;map=L.map('map').setView([4.202,73.527],13);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(map);routeLayer=L.layerGroup().addTo(map);userLayer=L.layerGroup().addTo(map);map.on('dragstart',()=>{follow=false;});drawRoute();refreshFeed();
}catch{alertText('Map unavailable. Your journey instructions are still here.');}
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').then(r=>{registration=r;if(globalThis.Notification?.permission==='granted')$('notifications').textContent='Notifications enabled';}).catch(()=>{});
