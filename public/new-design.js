const icons={walk:'<circle cx="13" cy="4" r="2"/><path d="m10 9 3-2 3 5 4 1M13 7l-2 7-4 6m4-6 5 6M10 9l-4 4"/>',bus:'<rect x="5" y="3" width="14" height="17" rx="3"/><path d="M5 12h14M8 20v2m8-2v2M9 6h6"/><path d="M8 16h1m6 0h1"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>'};
export const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[name]+'</svg>';
export function boardingInfo(leg,{escape,time},now=Date.now()){
  const dep=leg.departure,age=now-Date.parse(dep?.checkedAt);
  const live=dep?.source==='live'&&age>=-5000&&age<90000&&Number.isFinite(dep.departure)&&dep.departure>=now-60000;
  const clock=dep?.source!=='unknown'&&Number.isFinite(dep?.departure)?' · '+time(dep.departure-120000):' · wait for next bus';
  if(dep?.source==='live'&&!live)return 'Board at '+escape(leg.from)+' · arrival estimate unavailable';
  const minutes=live?Math.max(0,Math.ceil((dep.departure-now)/60000)):0;
  return 'Board at '+escape(leg.from)+clock+(live?'<span class="new-live-arrival"><span aria-hidden="true"></span>Live · '+(minutes?'~'+minutes+' min':'arriving')+(dep.vehicleCode?' · '+escape(dep.vehicleCode):'')+'</span>':'');
}
export function newResults(ordered,activeId,sort,{escape,time,routeChain}){
  const j=ordered.find(j=>j.id===activeId)||ordered[0];
  const steps=j.legs.filter(l=>l.type==='bus'||l.distance>0);
  return `<div class="new-preferences" aria-label="Route preference"><button data-sort="walk" aria-pressed="${sort==='walk'}" class="${sort==='walk'?'selected':''}">${icon('walk')}Less walking</button><button data-sort="changes" aria-pressed="${sort==='changes'}" class="${sort==='changes'?'selected':''}">${icon('bus')}Fewer transfers</button></div>
  <article class="journey selected new-itinerary"><div class="new-trip-heading"><h2>~${j.minutes}<span> min${j.timing==='incomplete'?' + wait':''}</span></h2><div class="new-trip-meta">${j.arrival?'Arrive ~'+time(j.arrival):'Bus wait extra'}<span>${j.fare===null?'Confirm fare':'MVR '+j.fare}</span></div></div>
  <ol class="new-route-steps">${steps.map(l=>`<li><span class="new-step-icon">${icon(l.type==='walk'?'walk':'bus')}</span><div>${l.type==='walk'?'Walk to <strong>'+escape(l.to||'your destination')+'</strong>':'Take <span class="new-route-number">'+escape(l.number)+'</span> to <strong>'+escape(l.to)+'</strong>'}${l.type==='bus'?'<small data-boarding-index="'+j.legs.indexOf(l)+'">'+boardingInfo(l,{escape,time})+'</small>':''}</div><span class="new-step-time">${l.minutes}<small>min</small></span></li>`).join('')}</ol>
  <button class="primary start-journey" data-start="${escape(j.id)}">Start journey ${icon('arrow')}</button></article>
  <div class="new-route-tools"><span>Approximate times · Maldives time</span><button id="share-journey" class="share-button" aria-label="Copy journey link">Share</button></div>
  <div class="new-secondary">${ordered.length>1?`<details class="new-alternatives"><summary>${ordered.length-1} other ${ordered.length===2?'route':'routes'}</summary>${ordered.filter(a=>a.id!==j.id).map(a=>`<button class="new-alternative" data-journey="${escape(a.id)}"><span>${routeChain(a)}<small>${a.transfers?a.transfers+' transfer'+(a.transfers===1?'':'s'):'No transfers'} · ${Math.round(a.walkMetres)} m walking</small></span><b>${a.minutes}<small>min${a.timing==='incomplete'?' + wait':''}</small></b></button>`).join('')}</details>`:''}
  </div>`;
}
