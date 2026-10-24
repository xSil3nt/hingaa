import {mapPalette,mapStyles} from './map-theme.js';
export async function mapLibrary(key){
  if(!key)return {library:window.L,provider:'osm'};
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Google map timed out')),12000);
      window.journeyGoogleReady=()=>{clearTimeout(timer);resolve();};
      window.gm_authFailure=()=>{clearTimeout(timer);reject(Error('Google map access blocked'));};
      const script=document.createElement('script');script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&loading=async&callback=journeyGoogleReady';script.onerror=()=>{clearTimeout(timer);reject(Error('Google map unavailable'));};document.head.append(script);
    });
    const g=google.maps,noop={addTo(){return this;}},latlng=p=>({lat:p[0],lng:p[1]});
    const native=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Google map could not initialize')),12000);
      window.gm_authFailure=()=>{clearTimeout(timer);reject(Error('Google map access blocked'));};
      const instance=new g.Map(document.getElementById('map'),{center:{lat:4.202,lng:73.527},zoom:13,styles:mapStyles(13),backgroundColor:mapPalette.water,zoomControl:false,cameraControl:false,rotateControl:false,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,gestureHandling:'greedy',clickableIcons:false});
      g.event.addListenerOnce(instance,'idle',()=>{clearTimeout(timer);resolve(instance);});
    });
    let streetNames=native.getZoom()>=16;
    native.addListener('zoom_changed',()=>{const next=native.getZoom()>=16;if(next!==streetNames){streetNames=next;native.setOptions({styles:mapStyles(native.getZoom())});}});
    const controls=document.createElement('div');controls.className='map-zoom';controls.setAttribute('role','group');controls.setAttribute('aria-label','Map zoom');
    for(const [label,text,delta] of [['Zoom in','+',1],['Zoom out','−',-1]]){const button=document.createElement('button');button.type='button';button.textContent=text;button.setAttribute('aria-label',label);button.onclick=()=>native.setZoom(native.getZoom()+delta);controls.append(button);}
    document.getElementById('map').parentElement.append(controls);
    class Group {
      items=[];native=null;
      addTo(map){this.native=map.native;return this;}
      add(item){this.items.push(item);item.setMap(this.native);}
      clearLayers(){this.items.forEach(i=>i.setMap(null));this.items=[];}
    }
    const wrap=item=>({addTo(group){group.add(item);return this;},bindTooltip(text){item.setTitle?.(text);return this;},bindPopup(html){const popup=new g.InfoWindow({content:html});item.addListener('click',()=>popup.open({map:item.getMap(),anchor:item}));return this;}});
    const library={
      map(id){return {native,setView(p,z){this.native.setCenter(latlng(p));this.native.setZoom(z);return this;},on(name,callback){this.native.addListener(name,e=>callback(e?.latLng?{latlng:{lat:e.latLng.lat(),lng:e.latLng.lng()}}:e));return this;},fitBounds(bounds,options){this.native.fitBounds(bounds,{top:45,bottom:55,left:45,right:45});g.event.addListenerOnce(this.native,'idle',()=>{if(this.native.getZoom()>(options?.maxZoom||18))this.native.setZoom(options.maxZoom);});}};},
      control:{zoom:()=>noop},tileLayer:()=>noop,layerGroup:()=>new Group(),divIcon:options=>options,
      latLngBounds(points){const b=new g.LatLngBounds();points.forEach(p=>b.extend(latlng(p)));return b;},
      marker(p,options){const el=document.createElement('div');el.innerHTML=options?.icon?.html||'';const isBus=!!el.querySelector('.bus-marker'),dest=!!el.querySelector('.destination');
        return wrap(new g.Marker({position:latlng(p),label:{text:el.textContent||'',color:isBus?'#513c11':'white',fontSize:isBus?'10px':'12px',fontWeight:'700'},icon:{path:isBus?'M -14,-10 L 14,-10 Q 17,-10 17,-7 L 17,7 Q 17,10 14,10 L -14,10 Q -17,10 -17,7 L -17,-7 Q -17,-10 -14,-10 Z':g.SymbolPath.CIRCLE,scale:isBus?1:15,fillColor:isBus?mapPalette.vehicle:dest?mapPalette.transfer:mapPalette.bus,fillOpacity:1,strokeColor:isBus?'#8c681b':'white',strokeWeight:isBus?1.5:3},zIndex:isBus?5:10}));},
      circleMarker(p,options){return wrap(new g.Marker({position:latlng(p),icon:{path:g.SymbolPath.CIRCLE,scale:options.radius,fillColor:options.fillColor,fillOpacity:1,strokeColor:options.color,strokeWeight:2}}));},
      polyline(coords,options){if(options.interactive===false)return noop;const path=coords.map(latlng);return wrap(new g.Polyline({path,strokeColor:options.color,strokeWeight:options.weight,strokeOpacity:options.dashArray?0:options.opacity,icons:options.dashArray?[{icon:{path:'M 0,-1 0,1',strokeOpacity:1,scale:2},offset:'0',repeat:'10px'}]:[]}));}
    };
    return {library,provider:'google'};
  }catch{document.getElementById('map').replaceChildren();return {library:window.L,provider:'osm',error:'Google map could not load. Showing the local map instead.'};}
}
