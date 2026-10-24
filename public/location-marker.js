export const normalizeHeading=n=>Number.isFinite(n)?((n%360)+360)%360:null;
export function compassHeading(event,screenAngle=0){
  if(Number.isFinite(event.webkitCompassHeading)){
    if(Number.isFinite(event.webkitCompassAccuracy)&&(event.webkitCompassAccuracy<0||event.webkitCompassAccuracy>45))return null;
    return normalizeHeading(event.webkitCompassHeading+screenAngle);
  }
  return event.absolute===true&&Number.isFinite(event.alpha)?normalizeHeading(360-event.alpha+screenAngle):null;
}
export function travelHeading(coords){return coords.speed>=.5&&Number.isFinite(coords.heading)?normalizeHeading(coords.heading):null;}
export function locationSvg(heading=null){
  const cone=heading===null?'':`<g transform="rotate(${normalizeHeading(heading)} 28 28)"><path d="M28 4 12 24Q28 17 44 24Z" fill="#2874d3" fill-opacity=".24"/><path d="m28 9-6 12 6-3 6 3Z" fill="#2874d3" stroke="white" stroke-width="1.5"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">${cone}<circle cx="28" cy="28" r="12" fill="#2874d3" fill-opacity=".15"/><circle cx="28" cy="28" r="7" fill="#2874d3" stroke="white" stroke-width="3"/></svg>`;
}
export class UserLocationMarker{
  constructor(){this.map=null;this.L=null;this.fix=null;this.heading=null;this.headingAt=0;this.shapes=[];this.marker=null;this.accuracyShape=null;this.lastDraw=0;this.listening=false;this.onOrientation=e=>{
    const heading=compassHeading(e,globalThis.screen?.orientation?.angle||0);
    if(heading!==null){this.headingAt=Date.now();if(this.heading!==null&&Math.abs(((heading-this.heading+540)%360)-180)<3)return;if(Date.now()-this.lastDraw>=80){this.heading=heading;this.lastDraw=Date.now();this.draw();}} 
  };}
  attach(map,L){this.map=map;this.L=L;this.draw();return this;}
  async enableCompass(requestPermission=true){
    try{
      if(requestPermission&&typeof globalThis.DeviceOrientationEvent?.requestPermission==='function'&&await DeviceOrientationEvent.requestPermission(true)!=='granted')return false;
      if(!this.listening){window.addEventListener('deviceorientation',this.onOrientation);window.addEventListener('deviceorientationabsolute',this.onOrientation);this.listening=true;}
      return true;
    }catch{return false;}
  }
  disableCompass(){window.removeEventListener('deviceorientation',this.onOrientation);window.removeEventListener('deviceorientationabsolute',this.onOrientation);this.listening=false;this.heading=null;this.headingAt=0;}
  update(coords,timestamp=Date.now()){
    if(!Number.isFinite(coords.latitude)||!Number.isFinite(coords.longitude)||!Number.isFinite(coords.accuracy)||Date.now()-timestamp>30000)return;
    this.fix={...coords,latitude:coords.latitude,longitude:coords.longitude,accuracy:coords.accuracy,heading:coords.heading,speed:coords.speed,timestamp};this.draw();
  }
  clearShapes(){for(const shape of this.shapes){if(shape.setMap)shape.setMap(null);else shape.remove();}this.shapes=[];this.marker=null;this.accuracyShape=null;}
  clear(){this.clearShapes();this.fix=null;}
  draw(){
    if(!this.map||!this.fix||Date.now()-this.fix.timestamp>30000)return;
    const f=this.fix,compass=this.listening?this.heading:null,heading=compass??travelHeading(f),svg=locationSvg(heading);
    const title=heading===null?'Your location':compass!==null?'Your location · phone direction (approximate)':'Your location · direction of travel';
    if(this.map.native){
      const g=google.maps,position={lat:f.latitude,lng:f.longitude};
      if(!this.accuracyShape){this.accuracyShape=new g.Circle({map:this.map.native,center:position,radius:Math.min(1000,Math.max(0,f.accuracy)),fillColor:'#2874d3',fillOpacity:.08,strokeColor:'#2874d3',strokeOpacity:.2,strokeWeight:1,clickable:false,zIndex:15});this.shapes.push(this.accuracyShape);}else{this.accuracyShape.setCenter(position);this.accuracyShape.setRadius(Math.min(1000,Math.max(0,f.accuracy)));}
      const icon={url:'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg),scaledSize:new g.Size(56,56),anchor:new g.Point(28,28)};
      if(!this.marker){this.marker=new g.Marker({map:this.map.native,position,title,icon,zIndex:100,clickable:false});this.shapes.push(this.marker);}else{this.marker.setPosition(position);this.marker.setIcon(icon);this.marker.setTitle(title);}
    }else{
      const L=this.L,point=[f.latitude,f.longitude];
      if(!this.accuracyShape){this.accuracyShape=L.circle(point,{radius:Math.min(1000,f.accuracy),color:'#2874d3',weight:1,opacity:.2,fillOpacity:.08,interactive:false}).addTo(this.map);this.shapes.push(this.accuracyShape);}else this.accuracyShape.setLatLng(point).setRadius(Math.min(1000,f.accuracy));
      const icon=L.divIcon({className:'user-location-icon',html:svg,iconSize:[56,56],iconAnchor:[28,28]});
      if(!this.marker){this.marker=L.marker(point,{icon,title,interactive:false,zIndexOffset:1000}).addTo(this.map);this.shapes.push(this.marker);}else this.marker.setLatLng(point).setIcon(icon);
    }
  }
}
