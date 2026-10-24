import {UserLocationMarker} from './location-marker.js';
import {enableGuidanceDevices} from './guidance-devices.js';
import {createSession,loadSession,replaceSession,browserStore} from './session-core.js';
import {mapLibrary} from './google-map.js';
import {leafletRegionOptions} from './map-region.js';
import {renderResults,boardingInfo} from './planner-view.js';
const journeyUrl='/journey.html';
const $=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=ms=>new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Maldives',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ms));
let data,selected={origin:null,destination:null},result=null,activeId=null,pinField=null,sort='arrival',loading=false;
let searchGeneration=0,feedGeneration=0,pendingPlaces=0;
const config=await fetch('/api/config').then(r=>r.json()).catch(()=>({}));
const mapSetup=await mapLibrary(config.browserKey),L=mapSetup.library;
const map=L.map('map',{zoomControl:false,...leafletRegionOptions}).setView([4.202,73.527],13);
L.control.zoom({position:'topright'}).addTo(map);
const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
const streetLayer=L.layerGroup().addTo(map),journeyLayer=L.layerGroup().addTo(map),vehicleLayer=L.layerGroup().addTo(map),pointLayer=L.layerGroup().addTo(map);
let bounds=null,refreshTimer=null,locationWatch=null,lastLocationAt=0;
const userLocation=new UserLocationMarker().attach(map,L);
function message(text){$('message').textContent=text;$('message').hidden=!text;}
function resetPlan(){
  if(!result&&!loading)return;
  searchGeneration++;feedGeneration++;clearInterval(refreshTimer);result=null;activeId=null;bounds=null;journeyLayer.clearLayers();vehicleLayer.clearLayers();
  $('results').replaceChildren();
  $('trip-title').textContent='Where to?';
}
function setPlace(field,place){if(JSON.stringify(selected[field]?.coord)!==JSON.stringify(place?.coord))resetPlan();selected[field]=place;$(field).value=place?.name||'';closeOptions(field);drawPoints();
  const box=$('place-attribution');if(box)box.innerHTML=Object.values(selected).flatMap(p=>p?.attributions||[]).map(a=>{let url='';try{const u=new URL(a.providerUri);if(['http:','https:'].includes(u.protocol))url=u.href;}catch{}return url?`<a href="${escape(url)}" target="_blank" rel="noreferrer">${escape(a.provider||'Place attribution')}</a>`:escape(a.provider||'');}).join(' · ');
}
function closeOptions(field){clearTimeout(searchState[field].timer);searchState[field].version++;$(field+'-options').hidden=true;$(field).setAttribute('aria-expanded','false');$(field).removeAttribute('aria-activedescendant');}
const searchState=Object.fromEntries(['origin','destination'].map(f=>[f,{timer:null,version:0,session:crypto.randomUUID()}]));
function showSuggestions(field,candidates,note=''){
  const box=$(field+'-options');box.innerHTML=candidates.map((p,i)=>`<button type="button" class="suggestion" role="option" id="${field}-option-${i}" data-index="${i}">${escape(p.name)}<small>${escape(p.provider==='google'?p.address+' · Google Maps':p.routes.join(' · ')+' · RTL stop')}</small></button>`).join('')+(note?`<div class="no-match">${escape(note)}</div>`:'');
  if(!candidates.length&&!note)box.innerHTML='<div class="no-match">No matching place. Use ⌖ to choose a point on the map.</div>';
  box.hidden=false;$(field).setAttribute('aria-expanded','true');
  box.querySelectorAll('button').forEach(b=>b.onclick=async()=>{
    const p=candidates[+b.dataset.index],state=searchState[field],version=++state.version;clearTimeout(state.timer);
    pendingPlaces++;$('search-button').disabled=true;
    try{
      const place=p.provider==='google'?await request('/api/place?id='+encodeURIComponent(p.id)+'&session='+state.session):p;
      if(version!==state.version)return;
      setPlace(field,place);state.session=crypto.randomUUID();$(field).focus();closeOptions(field);message('');
    }catch(error){message(error.message);}finally{pendingPlaces--;$('search-button').disabled=loading||pendingPlaces>0;}
  });
}
function suggestions(field){
  const q=$(field).value.trim(),state=searchState[field],version=++state.version;clearTimeout(state.timer);
  const local=(q?data.places.filter(p=>(p.name+' '+p.routes.join(' ')+' '+(p.aliases||[]).join(' ')).toLowerCase().includes(q.toLowerCase())):data.presets).slice(0,6);
  const useGoogle=mapSetup.provider==='google'&&q.length>=2;
  showSuggestions(field,local,useGoogle?'Searching Google Maps…':'');
  if(useGoogle)state.timer=setTimeout(async()=>{
    try{const response=await request('/api/places?q='+encodeURIComponent(q)+'&session='+state.session);if(version!==state.version||$(field).value.trim()!==q)return;
      showSuggestions(field,[...response.places,...local.slice(0,4)].slice(0,10),response.error||'');
    }catch{if(version===state.version)showSuggestions(field,local,'Google search is unavailable. Try an RTL stop or map pin.');}
  },450);
}
for(const field of ['origin','destination']){
  $(field).addEventListener('input',()=>{resetPlan();selected[field]=null;drawPoints();suggestions(field);});
  $(field).addEventListener('focus',()=>{if(data&&!selected[field])suggestions(field);});
  $(field).addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeOptions(field);return;}
    const buttons=[...$(field+'-options').querySelectorAll('button')];if(!buttons.length||$(field+'-options').hidden)return;
    let index=buttons.findIndex(b=>b.classList.contains('active'));
    if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();index=(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons.forEach((b,i)=>b.classList.toggle('active',i===index));$(field).setAttribute('aria-activedescendant',buttons[index].id);buttons[index].scrollIntoView({block:'nearest'});}
    if(e.key==='Enter'&&index>=0){e.preventDefault();buttons[index].click();}
  });
}
document.addEventListener('click',e=>{for(const field of ['origin','destination'])if(!$(field).parentElement.contains(e.target))closeOptions(field);});
function drawPoints(){pointLayer.clearLayers();for(const [field,p] of Object.entries(selected))if(p){L.marker([p.coord[1],p.coord[0]],{icon:L.divIcon({className:'',html:`<div class="endpoint-marker ${field}">${field==='origin'?'A':'B'}</div>`,iconSize:[30,30],iconAnchor:[15,15]})}).addTo(pointLayer).bindTooltip(escape(p.name));}}
$('swap').onclick=()=>{const o=selected.origin;setPlace('origin',selected.destination);setPlace('destination',o);message('Places swapped. Find journeys to update the route.');};
document.querySelectorAll('.pin').forEach(b=>b.onclick=()=>{
  pinField=b.dataset.field;$('pin-banner').hidden=false;$('pin-banner').firstChild.textContent=`Tap a location on the map to select it. `;message('Choose a point on the map.');
  if(innerWidth<761)$('map').scrollIntoView({behavior:'smooth',block:'center'});
});
$('cancel-pin').onclick=()=>{pinField=null;$('pin-banner').hidden=true;message('');};
map.on('click',e=>{if(!pinField)return;const c=e.latlng;setPlace(pinField,{name:`Map pin (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})`,coord:[c.lng,c.lat],kind:'Map pin'});pinField=null;$('pin-banner').hidden=true;message('Pin set. Find journeys when both places are ready.');});
function locateUser(updateOrigin=true){
  if(!navigator.geolocation){message('Location is unavailable. Search a stop or choose a map pin.');return;}
  if(updateOrigin||typeof globalThis.DeviceOrientationEvent?.requestPermission!=='function')userLocation.enableCompass();
  if(locationWatch!==null)navigator.geolocation.clearWatch(locationWatch);
  let first=true;if(updateOrigin)message('Finding your location…');
  locationWatch=navigator.geolocation.watchPosition(p=>{
    const coord=[p.coords.longitude,p.coords.latitude];
    if(coord[0]<73.47||coord[0]>73.57||coord[1]<4.145||coord[1]>4.265){if(updateOrigin)message('Your location is outside Greater Malé. Choose a local place or map pin.');userLocation.clear();navigator.geolocation.clearWatch(locationWatch);locationWatch=null;return;}
    lastLocationAt=p.timestamp;userLocation.update(p.coords,p.timestamp);
    if(first&&updateOrigin){first=false;setPlace('origin',{name:'Current location',coord});map.setView([coord[1],coord[0]],17);if(innerWidth<761)$('map').scrollIntoView({block:'center',behavior:'auto'});message('');}
  },error=>{userLocation.clear();if(updateOrigin)message(error.code===1?'Enable location access to see yourself on the map.':'Waiting for GPS. You can still search a stop.');if(error.code===1){navigator.geolocation.clearWatch(locationWatch);locationWatch=null;userLocation.disableCompass();}},{enableHighAccuracy:true,timeout:15000,maximumAge:3000});
};
$('locate').onclick=()=>locateUser(true);
window.addEventListener('pagehide',()=>{if(locationWatch!==null)navigator.geolocation.clearWatch(locationWatch);userLocation.disableCompass();});
setInterval(()=>{if(lastLocationAt&&Date.now()-lastLocationAt>30000)userLocation.clear();},5000);
async function request(url,options={}){
  try{
    const res=await fetch(url,{...options,signal:options.signal||AbortSignal.timeout(55000)});
    if(!res.headers.get('content-type')?.includes('application/json'))throw Error('The service is busy. Please try again.');
    const body=await res.json();if(!res.ok)throw Error(body.error||'Please try again.');return body;
  }catch(error){if(error.name==='TimeoutError'||error.name==='AbortError')throw Error('The request took too long. Please try again.');if(error instanceof TypeError)throw Error('Check your connection and try again.');throw error;}
}
$('search-form').onsubmit=async e=>{
  e.preventDefault();if(loading)return;
  if(!selected.origin||!selected.destination){message('Select a matching place for both fields, or choose each one on the map.');return;}
  const generation=++searchGeneration;feedGeneration++;clearInterval(refreshTimer);vehicleLayer.clearLayers();
  loading=true;$('search-button').disabled=true;$('search-button').textContent='Finding journeys…';message('');
  $('results').innerHTML='<div class="skeleton"><b>Finding journeys…</b><p>Checking walks and bus arrivals.</p><div></div><div></div></div>';
  try {
    const next=await request('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...selected,mapProvider:mapSetup.provider})});
    if(generation!==searchGeneration)return;result=next;activeId=orderedJourneys()[0]?.id;render();drawJourney();if(result.journeys.length)$('new-search').open=false;if(result.walkingNotice)message(result.walkingNotice);
    const url=new URL(location.href);for(const field of ['origin','destination'])url.searchParams.set(field,JSON.stringify({name:selected[field].name,coord:selected[field].coord}));history.replaceState(null,'',url);
    if(innerWidth<761)window.scrollTo({top:0,behavior:'auto'});
    refreshTimer=setInterval(()=>{if(!document.hidden)refreshFeeds();},30000);
  }catch(error){if(generation===searchGeneration)$('results').innerHTML=`<div class="welcome"><h2>Couldn’t load journeys</h2><p>${escape(error.message)}. Please try again.</p></div>`;}
  finally{loading=false;$('search-button').disabled=false;$('search-button').innerHTML='Hingaa <span aria-hidden="true">→</span>';}
};
function routeChain(j){
  let bus=0;
  return j.legs.filter(l=>l.type==='bus'||l.minutes>0).map(l=>l.type==='bus'?'<span class="route-badge '+(bus++?'second':'')+'">'+escape(l.number)+'</span>':'<span>↗ '+l.minutes+' min</span>').join('<span aria-hidden="true">→</span>')||'<span>Walk · 0 min</span>';
}
function orderedJourneys(){return [...result.journeys].sort((a,b)=>sort==='walk'?a.walkMetres-b.walkMetres||a.minutes-b.minutes:sort==='changes'?a.transfers-b.transfers||a.minutes-b.minutes:(a.timing==='incomplete')-(b.timing==='incomplete')||a.minutes-b.minutes);}
function render(){
  const alternativesOpen=document.querySelector('.new-alternatives')?.open||false;
  $('trip-title').textContent=result?.destination?.name?'To '+result.destination.name:'Where to?';
  if(!result?.journeys.length){$('results').innerHTML=`<div class="welcome"><h2>No journey found</h2><p>${escape(result?.reason)}</p><p class="small">Try a named stop or move the pin to a nearby public street.</p></div>`;journeyLayer.clearLayers();drawPoints();return;}
  const ordered=orderedJourneys();
  $('results').innerHTML=renderResults(ordered,activeId,sort,{escape,time,routeChain});
  document.querySelectorAll('[data-journey]').forEach(b=>b.onclick=()=>{activeId=b.dataset.journey;feedGeneration++;render();drawJourney();refreshFeeds();});
  document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{sort=b.dataset.sort;activeId=orderedJourneys()[0]?.id;render();drawJourney();});
  document.querySelectorAll('[data-start]').forEach(button=>button.onclick=async()=>{
    try{
      const old=loadSession(browserStore);
      const chosen=result.journeys.find(j=>j.id===button.dataset.start);
      replaceSession(browserStore,createSession(chosen,result.origin,result.destination));
      button.disabled=true;
      await enableGuidanceDevices();
      try{const registration=await navigator.serviceWorker?.getRegistration();const notifications=await registration?.getNotifications();notifications?.filter(n=>n.data?.session===old?.id).forEach(n=>n.close());}catch{}
      location.href=journeyUrl;
    }catch(error){message(error.message||'Couldn’t save this journey. Enable site storage and try again.');}
  });
  renderFeeds();
  const alternatives=document.querySelector('.new-alternatives');if(alternatives)alternatives.open=alternativesOpen;
  $('share-journey').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);$('share-journey').textContent='Copied';setTimeout(()=>{if($('share-journey'))$('share-journey').textContent='Share';},2000);}catch{message('Copy the address from your browser to share this journey.');}};
}
function current(){return result?.journeys.find(j=>j.id===activeId);}
function drawJourney(){
  journeyLayer.clearLayers();vehicleLayer.clearLayers();drawPoints();const journey=current();if(!journey)return;
  let busIndex=0,points=[];
  for(const leg of journey.legs){const coords=leg.coords.map(p=>[p[1],p[0]]);points.push(...coords);
    L.polyline(coords,{color:leg.type==='walk'?'#e1a345':busIndex++?'#e1a345':'#38c3df',weight:leg.type==='walk'?4:6,opacity:.95,dashArray:leg.type==='walk'?'3 8':null}).addTo(journeyLayer);
    if(leg.type==='bus')for(const c of [coords[0],coords.at(-1)])L.circleMarker(c,{radius:5,color:'#38c3df',fillColor:'#172730',fillOpacity:1,weight:2}).addTo(journeyLayer);
  }
  if(points.length){bounds=L.latLngBounds(points);map.fitBounds(bounds,{padding:[45,55],maxZoom:16});}renderFeeds();
}
function renderFeeds(){
  vehicleLayer.clearLayers();
  document.querySelectorAll('[data-boarding-index]').forEach(el=>{const leg=current()?.legs[+el.dataset.boardingIndex];if(leg)el.innerHTML=boardingInfo(leg,{escape,time});});
  for(const leg of current()?.legs.filter(l=>l.type==='bus')||[]){
    const live=result.feeds?.[leg.routeCode]?.live;
    const age=Date.now()-Date.parse(live?.fetchedAtUtc);
    if(!live?.ok||!Number.isFinite(age)||age< -5000||age>=90000)continue;
    for(const bus of live.data?.busList||[]){
      const lat=+bus.latitude,lng=+bus.longitude;
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<4.14||lat>4.27||lng<73.47||lng>73.57)continue;
      const marker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:'<div class="bus-marker">'+escape(leg.number)+'</div>',iconSize:[34,21],iconAnchor:[17,10]})}).addTo(vehicleLayer);
      marker.bindTooltip(escape(leg.number+' · '+bus.busCode));
      marker.bindPopup(escape(bus.plateNumber||bus.busCode)+'<br>Retrieved '+time(live.fetchedAtUtc)+'<br>GPS-fix age and direction unknown.');
    }
  }
}
async function refreshFeeds(){
  const journey=current();if(!journey||loading)return;const generation=++feedGeneration;
  try{
    const updated=await request('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:result.origin,destination:result.destination,mapProvider:mapSetup.provider,walkingSession:result.walkingSession})});
    if(generation!==feedGeneration)return;
    const oldId=activeId;result=updated;if(!result.journeys.some(j=>j.id===activeId))activeId=orderedJourneys()[0]?.id;
    render();if(oldId!==activeId)drawJourney();
  }catch{if(generation===feedGeneration)message('Couldn’t refresh. The shown options are from the last successful check. Find journeys to retry.');}
}
setInterval(()=>{if(result){renderFeeds();if(Date.now()-Date.parse(result.computedAt)>90000)message('These journeys need a fresh departure check. Edit the trip and find journeys again.');}},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&result)refreshFeeds();});
try {
  data=await request('/api/bootstrap');
  locateUser(false);
  // Local street context remains visible when online map tiles are unavailable.
  L.polyline(data.streets.map(edge=>edge.map(p=>[p[1],p[0]])),{color:'#46535c',weight:1,opacity:.35,interactive:false}).addTo(streetLayer);
  const query=new URL(location.href).searchParams;let shared=0;
  for(const [field,id] of [['origin','103'],['destination','401']]){
    let place=data.places.find(p=>p.id===id);
    try{const p=JSON.parse(query.get(field));if(p&&typeof p.name==='string'&&p.name.length<200&&Array.isArray(p.coord)&&p.coord.length===2&&p.coord.every(Number.isFinite)&&p.coord[0]>73.47&&p.coord[0]<73.57&&p.coord[1]>4.145&&p.coord[1]<4.265){place=p;shared++;}}catch{}
    setPlace(field,place);
  }
  map.fitBounds(L.latLngBounds(Object.values(selected).map(p=>[p.coord[1],p.coord[0]])),{maxZoom:14});
  if(shared===2)$('search-form').requestSubmit();
  if(mapSetup.error)message(mapSetup.error);
}catch{message('Couldn’t load the bus network. Check your connection and reload.');$('search-button').disabled=true;}
