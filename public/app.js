import {createSession,loadSession,saveSession,LEASE_KEY,browserStore} from './session-core.js';
import {mapLibrary} from './google-map.js';
const $=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=ms=>new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Maldives',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ms));
const date=ms=>new Intl.DateTimeFormat('en-GB',{timeZone:'Indian/Maldives',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(ms));
const distance=m=>m>=1000?(m/1000).toFixed(1)+' km':m+' m';
let data,selected={origin:null,destination:null},result=null,activeId=null,pinField=null,sort='arrival',loading=false;
let searchGeneration=0,feedGeneration=0,pendingPlaces=0;
const config=await fetch('/api/config').then(r=>r.json()).catch(()=>({}));
const mapSetup=await mapLibrary(config.browserKey),L=mapSetup.library;
const map=L.map('map',{zoomControl:false}).setView([4.202,73.527],13);
L.control.zoom({position:'topright'}).addTo(map);
const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
const streetLayer=L.layerGroup().addTo(map),journeyLayer=L.layerGroup().addTo(map),vehicleLayer=L.layerGroup().addTo(map),pointLayer=L.layerGroup().addTo(map);
let bounds=null,refreshTimer=null;
function message(text){$('message').textContent=text;$('message').hidden=!text;}
function resetPlan(){
  if(!result&&!loading)return;
  searchGeneration++;feedGeneration++;clearInterval(refreshTimer);result=null;activeId=null;bounds=null;journeyLayer.clearLayers();vehicleLayer.clearLayers();
  $('results').replaceChildren();
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
  pinField=b.dataset.field;$('pin-banner').hidden=false;$('pin-banner').firstChild.textContent=`Tap a public street to set your ${pinField}. `;message('Choose a point on the map.');
  if(innerWidth<761)$('map').scrollIntoView({behavior:'smooth',block:'center'});
});
$('cancel-pin').onclick=()=>{pinField=null;$('pin-banner').hidden=true;message('');};
map.on('click',e=>{if(!pinField)return;const c=e.latlng;setPlace(pinField,{name:`Map pin (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})`,coord:[c.lng,c.lat],kind:'Map pin'});pinField=null;$('pin-banner').hidden=true;message('Pin set. Find journeys when both places are ready.');});
$('locate').onclick=()=>{
  if(!navigator.geolocation){message('Location is unavailable. Search a stop or choose a map pin.');return;}
  message('Finding your location…');navigator.geolocation.getCurrentPosition(p=>{
    const coord=[p.coords.longitude,p.coords.latitude];if(coord[0]<73.47||coord[0]>73.57||coord[1]<4.145||coord[1]>4.265){message('Your location is outside Greater Malé. Choose a local place or map pin.');return;}
    setPlace('origin',{name:'Current location',coord});map.setView([coord[1],coord[0]],16);message(`Location found (accuracy about ${Math.round(p.coords.accuracy)} m). Adjust the pin if needed.`);
  },()=>message('Location wasn’t available. Search a place or use ⌖ to choose an origin on the map.'),{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
};
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
    if(generation!==searchGeneration)return;result=next;activeId=result.journeys[0]?.id;render();drawJourney();if(result.walkingNotice)message(result.walkingNotice);
    const url=new URL(location.href);for(const field of ['origin','destination'])url.searchParams.set(field,JSON.stringify({name:selected[field].name,coord:selected[field].coord}));history.replaceState(null,'',url);
    if(innerWidth<761)$('results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
    refreshTimer=setInterval(()=>{if(!document.hidden)refreshFeeds();},30000);
  }catch(error){if(generation===searchGeneration)$('results').innerHTML=`<div class="welcome"><h2>Couldn’t load journeys</h2><p>${escape(error.message)}. Please try again.</p></div>`;}
  finally{loading=false;$('search-button').disabled=false;$('search-button').innerHTML='Find journeys <span aria-hidden="true">→</span>';}
};
function timingLabel(dep){return dep.source==='live'?'Live stop estimate':dep.source==='published'?'Published upcoming time':dep.source==='saved'?'Saved upcoming time':'Wait time not included';}
function legHtml(leg,index){
  if(leg.type==='walk'&&leg.distance===0)return '';
  if(leg.type==='walk')return `<div class="leg walk-leg"><div class="leg-icon">↗</div><div><span class="step-kind">${leg.transfer?'Change buses':'Walk'}</span><h3>${escape(leg.to||result.destination.name)}</h3><span class="walk-time">${leg.minutes} min walk</span><span class="step-distance"> · ${distance(leg.distance)}</span><details class="step-more"><summary>Walking directions</summary>${leg.instructions?.length?'<ol>'+leg.instructions.map(i=>'<li>'+escape(i)+'</li>').join('')+'</ol>':''}<p>${leg.provider==='google'?'Google Maps':'OpenStreetMap'} · estimated walk</p>${leg.streets.length?'<p>'+escape(leg.streets.join(' → '))+'</p>':''}${leg.warnings?.length?'<p>'+escape(leg.warnings.join(' '))+'</p>':''}${leg.accessMetres>15?'<p>Includes ~'+leg.accessMetres+' m of approximate map access.</p>':''}</details></div></div>`;
  const dep=leg.departure,unknown=dep.source==='unknown',second=index>2;
  return `<div class="leg bus-leg ${second?'connection-leg':''}"><div class="leg-icon">▣</div><div><span class="step-kind">Take bus <span class="route-badge ${second?'second':''}">${escape(leg.number)}</span></span><h3>${escape(leg.from)}</h3><p class="bus-direction">${escape(leg.direction)}</p><div class="boarding-time ${unknown?'wait-extra':''}">${unknown?'<span>Check the next bus</span><strong>Wait time extra</strong>':'<span>Be at the stop by</span><strong>'+time(dep.departure-120000)+'</strong>'}</div><div class="get-off"><span>Get off at</span><h3>${escape(leg.to)}</h3><p>${leg.minutes} min ride · ${leg.stops} ${leg.stops===1?'stop':'stops'}</p></div><details class="step-more"><summary>Stops & timing details</summary><ol>${leg.stopNames.map(n=>'<li>'+escape(n)+'</li>').join('')}</ol><p>${escape(timingLabel(dep))}${unknown?'':' · '+time(dep.departure)}</p>${dep.checkedAt?'<p>Checked '+date(dep.checkedAt)+' Maldives time</p>':''}${dep.vehicleCode?'<p>Vehicle '+escape(dep.vehicleCode)+'</p>':''}<p>Ride time is estimated. Includes 2 minutes to board.${unknown?' Bus waiting is not included.':''}</p></details></div></div>`;
}
function routeChain(j){
  let bus=0;
  return j.legs.filter(l=>l.type==='bus'||l.minutes>0).map(l=>l.type==='bus'?'<span class="route-badge '+(bus++?'second':'')+'">'+escape(l.number)+'</span>':'<span>↗ '+l.minutes+' min</span>').join('<span aria-hidden="true">→</span>')||'<span>Walk · 0 min</span>';
}
function render(){
  const liveOpen=document.querySelector('details.live-panel')?.open||false;
  const selectedButton=document.querySelector('.journey.selected [data-journey]');
  const openDisclosures=selectedButton?.dataset.journey===activeId?[...document.querySelectorAll('.journey.selected details')].map(d=>d.open):[];
  if(!result?.journeys.length){$('results').innerHTML=`<div class="welcome"><h2>No journey found</h2><p>${escape(result?.reason)}</p><p class="small">Try a named stop or move the pin to a nearby public street.</p></div>`;journeyLayer.clearLayers();drawPoints();return;}
  const ordered=[...result.journeys].sort((a,b)=>sort==='walk'?a.walkMetres-b.walkMetres:sort==='changes'?a.transfers-b.transfers||a.minutes-b.minutes:(a.timing==='incomplete')-(b.timing==='incomplete')||a.minutes-b.minutes);
  $('results').innerHTML=`<div class="results-heading"><h2>${result.journeys.length} journey options</h2><button class="share-button" id="share-journey" aria-label="Copy journey link">Share</button></div><p class="timing-note">Approximate times · Maldives time</p><div class="sorts"><button data-sort="arrival" class="${sort==='arrival'?'selected':''}">Fastest</button><button data-sort="changes" class="${sort==='changes'?'selected':''}">Fewer changes</button><button data-sort="walk" class="${sort==='walk'?'selected':''}">Less walking</button></div>${ordered.map(j=>{
    const active=j.id===activeId,buses=j.legs.filter(l=>l.type==='bus');
    return `<article class="journey ${active?'selected':''}"><button class="journey-head" data-journey="${escape(j.id)}" aria-expanded="${active}"><span class="journey-label">${escape(j.timing==='incomplete'?'Waiting time extra':(j.labels[0]==='Earliest estimate'?'Fastest':j.labels[0]))}</span><span class="journey-top"><span class="duration">${j.minutes}<small>${j.timing==='incomplete'?'min + wait':'min approx.'}</small></span><span class="arrival">${j.arrival?'Arrive ~'+time(j.arrival):'Bus wait extra'}</span></span><span class="route-chain">${routeChain(j)}</span><span class="meta"><span>${buses.length?(j.transfers?j.transfers+' change':'Direct bus'):'Walk only'}${j.walkMetres?' · '+distance(j.walkMetres)+' walking':''}</span><span>${j.fare===null?'Confirm fare':'MVR '+j.fare}</span></span></button>${active?`<div class="details">${j.legs.map(legHtml).join('')}<button class="primary start-journey" data-start="${escape(j.id)}">Start this journey →</button></div>`:''}</article>`;
  }).join('')}<details class="live-panel"><summary>Live bus updates</summary><div class="live-title"><h2>Stop arrivals & vehicles</h2><button id="refresh-feed">Refresh</button></div><p class="feed-summary">Refreshes every 30 seconds. Retrieval time is not the vehicle’s GPS-fix time.</p><div id="feed-content"></div><p class="small">Bus dots show fetched positions, not confirmed direction. Use the stop arrival and route instructions to choose a bus.</p></details>`;
  document.querySelectorAll('[data-journey]').forEach(b=>b.onclick=()=>{activeId=b.dataset.journey;feedGeneration++;render();drawJourney();refreshFeeds();});
  document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{sort=b.dataset.sort;render();});
  document.querySelectorAll('[data-start]').forEach(button=>button.onclick=()=>{
    try{
      const lease=JSON.parse(browserStore.getItem(LEASE_KEY)||'null');
      if(lease&&lease.until>Date.now()){message('Pause or end your current journey before starting another.');return;}
      const old=loadSession(browserStore);
      if(old&&old.status!=='completed'){message('You have a saved journey. Resume or end it before starting another.');return;}
      const chosen=result.journeys.find(j=>j.id===button.dataset.start);
      saveSession(browserStore,createSession(chosen,result.origin,result.destination));location.href='/journey.html';
    }catch(error){message(error.message||'Couldn’t save this journey. Enable site storage and try again.');}
  });
  $('refresh-feed').onclick=refreshFeeds;renderFeeds();
  document.querySelector('details.live-panel').open=liveOpen;
  $('share-journey').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);$('share-journey').textContent='Copied';setTimeout(()=>{if($('share-journey'))$('share-journey').textContent='Share';},2000);}catch{message('Copy the address from your browser to share this journey.');}};
  document.querySelectorAll('.journey.selected details').forEach((d,i)=>{d.open=!!openDisclosures[i];});
}
function current(){return result?.journeys.find(j=>j.id===activeId);}
function drawJourney(){
  journeyLayer.clearLayers();vehicleLayer.clearLayers();drawPoints();const journey=current();if(!journey)return;
  let busIndex=0,points=[];
  for(const leg of journey.legs){const coords=leg.coords.map(p=>[p[1],p[0]]);points.push(...coords);
    L.polyline(coords,{color:leg.type==='walk'?'#687585':busIndex++?'#337e79':'#585b9d',weight:leg.type==='walk'?4:6,opacity:.95,dashArray:leg.type==='walk'?'3 8':null}).addTo(journeyLayer);
    if(leg.type==='bus')for(const c of [coords[0],coords.at(-1)])L.circleMarker(c,{radius:5,color:'#585b9d',fillColor:'white',fillOpacity:1,weight:2}).addTo(journeyLayer);
  }
  if(points.length){bounds=L.latLngBounds(points);map.fitBounds(bounds,{padding:[45,55],maxZoom:16});}renderFeeds();
}
$('fit').onclick=()=>{if(bounds)map.fitBounds(bounds,{padding:[45,55],maxZoom:16});else map.setView([4.202,73.527],13);};
function renderFeeds(){
  if(!$('feed-content'))return;vehicleLayer.clearLayers();
  const buses=current()?.legs.filter(l=>l.type==='bus')||[];
  const now=Date.now();
  $('feed-content').innerHTML=buses.length?buses.map(leg=>{
    const f=result.feeds?.[leg.routeCode];if(!f)return `<div class="feed-route"><b>${escape(leg.number)}</b><p class="feed-empty">No feed checked for this option yet. Tap Refresh.</p></div>`;
    const fresh=e=>e?.ok&&now-Date.parse(e.fetchedAtUtc)<90000;
    const liveFresh=fresh(f.live),etaFresh=fresh(f.eta);
    if(liveFresh)for(const bus of f.live.data?.busList||[]){const lat=+bus.latitude,lng=+bus.longitude;if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<4.14||lat>4.27||lng<73.47||lng>73.57)continue;
      const marker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:`<div class="bus-marker">${escape(leg.number)}</div>`,iconSize:[34,21],iconAnchor:[17,10]})}).addTo(vehicleLayer);
      marker.bindTooltip(escape(leg.number+' · '+bus.busCode));
      marker.bindPopup(`${escape(bus.plateNumber||bus.busCode)}<br>Retrieved ${time(f.live.fetchedAtUtc)}<br>GPS-fix age and direction unknown.`);
    }
    const rows=etaFresh?['inboundStopsETAList','outboundStopsETAList'].flatMap(k=>f.eta.data?.[k]||[]).filter(r=>String(r.stopCode)===leg.fromCode):[];
    return `<div class="feed-route"><b>${escape(leg.number)} · ${escape(leg.from)}</b>${rows.length?rows.slice(0,5).map(r=>`<div class="feed-row"><span><span class="live-dot"></span>${escape(r.eta)}<br><small>${escape(r.vehicleCode)} · direction ${escape(r.direction)} · ${escape(r.destination||'Destination unknown')}${liveFresh&&f.live.data?.busList?.some(b=>String(b.busCode)===String(r.vehicleCode))?' · position on map':''}</small></span></div>`).join(''):`<p class="feed-empty">${etaFresh?(leg.departure.source==='unknown'?'Waiting time is not included in the travel estimate.':'Using the departure time shown above.'):f.eta?.ok?'Arrival check is out of date. Refresh to check again.':'Arrival feed unavailable.'}</p>`}<p class="small">${etaFresh?'Arrivals checked '+time(f.eta.fetchedAtUtc)+'. ':''}${liveFresh?(f.live.data?.busList||[]).length+' vehicle positions checked '+time(f.live.fetchedAtUtc)+'.':f.live?.ok?'Vehicle check expired.':'Vehicle feed unavailable.'}</p>${!etaFresh?'<p class="small">Published / saved timing may still appear above, with its own label.</p>':''}</div>`;
  }).join(''):'<p class="small">No bus needed for this walking option.</p>';
}
async function refreshFeeds(){
  const journey=current();if(!journey||loading)return;const generation=++feedGeneration;
  if($('refresh-feed')){$('refresh-feed').disabled=true;$('refresh-feed').textContent='Checking…';}
  try{
    const updated=await request('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:result.origin,destination:result.destination,mapProvider:mapSetup.provider,walkingSession:result.walkingSession})});
    if(generation!==feedGeneration)return;
    const oldId=activeId;result=updated;if(!result.journeys.some(j=>j.id===activeId))activeId=result.journeys[0]?.id;
    render();if(oldId!==activeId)drawJourney();
  }catch{if(generation===feedGeneration)message('Couldn’t refresh. The shown options are from the last successful check. Find journeys to retry.');}
  if($('refresh-feed')){$('refresh-feed').disabled=false;$('refresh-feed').textContent='Refresh';}
}
setInterval(()=>{if(result){renderFeeds();if(Date.now()-Date.parse(result.computedAt)>90000)message('These journeys need a fresh departure check. Tap Refresh or Find journeys.');}},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&result)refreshFeeds();});
try {
  const saved=loadSession(browserStore);
  if(saved&&saved.status!=='completed'){
    const link=document.createElement('a');link.href='/journey.html';link.className='resume-journey';link.textContent='Resume your journey →';document.querySelector('.planner').prepend(link);
  }
  data=await request('/api/bootstrap');
  // Local street context remains visible when online map tiles are unavailable.
  L.polyline(data.streets.map(edge=>edge.map(p=>[p[1],p[0]])),{color:'#adc1b8',weight:1,opacity:.35,interactive:false}).addTo(streetLayer);
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
