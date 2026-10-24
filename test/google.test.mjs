import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GoogleServices,decodePolyline,googleWalkContext} from '../google.mjs';
import {Planner} from '../engine.mjs';
const ok=data=>({ok:true,status:200,json:async()=>data});
const encoded='_p~iF~ps|U_ulLnnqC_mqNvxq`@';
test('Google polyline decoder returns longitude-latitude coordinates',()=>{
  assert.deepEqual(decodePolyline(encoded),[[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]]);
  assert.throws(()=>decodePolyline('_'));
});
test('Google place autocomplete is restricted to Greater Malé and uses headers for the server credential',async()=>{
  const g=new GoogleServices('fixture-key',{fetcher:async(url,options)=>{
    assert.equal(url,'https://places.googleapis.com/v1/places:autocomplete');assert.ok(!url.includes('fixture-key'));
    assert.equal(options.headers['X-Goog-Api-Key'],'fixture-key');const b=JSON.parse(options.body);assert.deepEqual(b.includedRegionCodes,['mv']);assert.ok(b.locationRestriction.rectangle);assert.equal(b.sessionToken,'session');
    return ok({suggestions:[{placePrediction:{placeId:'ChIJfixture123',structuredFormat:{mainText:{text:'Hiyaa Tower H16'},secondaryText:{text:'Maldives'}}}}]});
  }});
  const places=await g.autocomplete('H16','session');assert.equal(places[0].name,'Hiyaa Tower H16');assert.equal(places[0].provider,'google');
});
test('Google Place Details yields an actual endpoint and rejects out-of-area results',async()=>{
  const g=new GoogleServices('fixture-key',{fetcher:async()=>ok({id:'ChIJfixture123',displayName:{text:'H16'},location:{latitude:4.23,longitude:73.55}})});
  assert.deepEqual((await g.place('ChIJfixture123')).coord,[73.55,4.23]);
  const outside=new GoogleServices('fixture-key',{fetcher:async()=>ok({location:{latitude:5,longitude:74}})});
  await assert.rejects(outside.place('ChIJfixture123'),/Greater Malé/);
});
test('Google walking uses returned duration, geometry and plain-text instructions',async()=>{
  const g=new GoogleServices('fixture-key',{fetcher:async(url,options)=>{
    assert.equal(JSON.parse(options.body).travelMode,'WALK');
    return ok({routes:[{distanceMeters:160,duration:'181s',polyline:{encodedPolyline:encoded},warnings:['Use caution'],legs:[{steps:[{travelMode:'WALK',navigationInstruction:{instructions:'Turn left'}}]}]}]});
  }});
  const w=await g.walk([73.54,4.22],[73.541,4.22]);assert.equal(w.minutes,4);assert.equal(w.distance,160);assert.equal(w.provider,'google');assert.deepEqual(w.instructions,['Turn left']);assert.equal(w.coords.length,3);
});
test('Google walking rejects unavailable, excessive and ferry connections',async()=>{
  for(const response of [{routes:[]},{routes:[{distanceMeters:5000}]},{routes:[{distanceMeters:100,duration:'120s',polyline:{encodedPolyline:encoded},legs:[{steps:[{travelMode:'WALK',navigationInstruction:{instructions:'Take the ferry'}}]}]}]}]){
    const g=new GoogleServices('fixture-key',{fetcher:async()=>ok(response)});assert.equal(await g.walk([73.54,4.22],[73.541,4.22]),null);
  }
});
test('Google access errors expose a useful message without credentials',async()=>{
  const g=new GoogleServices('private-fixture',{fetcher:async()=>({ok:false,status:403,json:async()=>({error:{status:'PERMISSION_DENIED',message:'private-fixture'}})})});
  await assert.rejects(g.autocomplete('H16','session'),e=>e.status===403&&!e.message.includes('private-fixture')&&e.message.includes('blocked'));
});
test('Google walking candidate requests have bounded concurrency and candidate count',async()=>{
  let active=0,max=0,count=0;const stops=Array.from({length:20},(_,i)=>({code:String(i),coord:[73.54+i*.0001,4.22]}));
  const google={walk:async(a,b)=>{count++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;return {type:'walk',minutes:1,distance:20,coords:[a,b],streets:[]};}};
  const c=await googleWalkContext({stops},google,{coord:[73.54,4.22]},{coord:[73.541,4.22]});assert.equal(c.access.size,5);assert.equal(c.egress.size,5);assert.ok(count<=11);assert.ok(max<=4);
});
test('Google walking time controls catchability before bus selection',()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../data/routes.json',import.meta.url))),walk=JSON.parse(fs.readFileSync(new URL('../data/walk.json',import.meta.url)));
  const route=source.routes.find(r=>r.code==='133');const p=new Planner({...source,routes:[route]},walk);const now=Date.parse('2026-10-24T06:00:00Z');
  p.routes[0].stops.forEach(s=>s.timings=[]);
  const origin={name:'Flat',coord:[73.50,4.21]},destination={name:'Amin Avenue',coord:p.routes[0].stops[12].coord};
  const leg=(a,b,minutes)=>({type:'walk',minutes,distance:200,coords:[a,b],streets:[],accessMetres:0,provider:'google'});
  const context={access:new Map([['103',leg(origin.coord,p.routes[0].stops[0].coord,8)]]),egress:new Map([['114',leg(destination.coord,destination.coord,0)]]),walking:null,transfers:new Map(),strictTransfers:true};
  const rows=[{eta:'5 Minutes',vehicleCode:'TOO_SOON'},{eta:'12 Minutes',vehicleCode:'CATCHABLE'}].map(r=>({...r,routeCode:'133',stopCode:'103',stopOrder:1,destination:route.endStationName,direction:'I'}));
  const feeds={'133':{eta:{ok:true,fetchedAtUtc:new Date(now).toISOString(),data:{inboundStopsETAList:rows,outboundStopsETAList:null}}}};
  const result=p.plan(origin,destination,feeds,now,{walking:context});assert.equal(result.journeys[0].legs.find(l=>l.type==='bus').departure.vehicleCode,'CATCHABLE');assert.equal(result.journeys[0].legs[0].provider,'google');
});
test('a route missed by the five nearest stops is included without unbounded walking calls',async()=>{
  const stops=Array.from({length:14},(_,i)=>({code:String(i),coord:[73.54+i*.0001,4.22]}));
  const routes=[{code:'A',stops:stops.slice(0,5).map(s=>({...s,board:true,alight:true}))},{code:'B',stops:[{...stops[7],board:true,alight:true}]}];
  const google={walk:async(a,b)=>({type:'walk',minutes:2,distance:100,coords:[a,b],streets:[]})};
  const context=await googleWalkContext({stops,routes},google,{coord:stops[0].coord},{coord:stops[0].coord});
  assert.ok(context.access.has('7'));assert.ok(context.egress.has('7'));
  assert.ok(context.access.size<=10&&context.egress.size<=10);
});
