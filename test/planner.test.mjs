import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Planner,Walker,parseEta,arrivalsFor,chooseDeparture,BUFFER} from '../engine.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../data/routes.json',import.meta.url)));
const walk=JSON.parse(fs.readFileSync(new URL('../data/walk.json',import.meta.url)));
const planner=new Planner(data,walk),stop=c=>planner.stops.find(s=>s.code===c);
const now=Date.parse('2026-10-24T06:00:00Z');
const route=planner.routes.find(r=>r.code==='133');
const mock=(rows,extra={})=>({eta:{ok:true,fetchedAtUtc:new Date(now).toISOString(),data:{inboundStopsETAList:rows,outboundStopsETAList:null}},...extra});
const row=(s,eta,extra={})=>({routeCode:'133',stopCode:s.code,stopOrder:s.order,eta,vehicleCode:'TEST1',direction:'I',destination:route.endStationName,...extra});
test('all 15 routes align to road shapes in strictly published order',()=>{
  assert.equal(planner.routes.length,15);
  for(const r of planner.routes){assert.equal(r.geometry.indices.length,r.stops.length,r.routeNumber);assert.ok(r.geometry.errors.every(d=>d<55),r.routeNumber);assert.ok(r.geometry.indices.every((v,i,a)=>!i||v>a[i-1]),r.routeNumber);}
});
test('ETA parser accepts known server forms and rejects ambiguous text',()=>{
  assert.equal(parseEta('6 Minutes '),6);assert.equal(parseEta('Send in 5 minutes'),5);assert.equal(parseEta('Entering the station'),0);
  for(const text of ['Due soon','-5 Minutes','1 hour 6 minutes','~5','',null])assert.equal(parseEta(text),null);
});
test('catchability includes walk and explicit buffer, rejects bus already approaching too soon',()=>{
  assert.equal(BUFFER,2);const s=route.stops[1];
  const r={...route,stops:route.stops.map(x=>({...x,timings:[]}))};
  const f=mock([row(s,'3 Minutes'),row(s,'12 Minutes',{vehicleCode:'TEST2'})]);
  const chosen=chooseDeparture(r,{...s,timings:[]},now+(6+BUFFER)*60000,f,now,'2026-10-23T04:00:00Z');
  assert.equal(chosen.vehicleCode,'TEST2');assert.equal(chosen.missed,1);assert.equal(chosen.source,'live');
});
test('null, stale, wrong-route, wrong-destination, reverse and ambiguous duplicate ETAs cannot board',()=>{
  const s=route.stops[2];
  assert.deepEqual(arrivalsFor(route,s,{eta:{ok:true,fetchedAtUtc:new Date(now).toISOString(),data:{inboundStopsETAList:null,outboundStopsETAList:null}}},now),[]);
  for(const extra of [{routeCode:'17'},{destination:'Opposite terminal'},{direction:'?'}])assert.deepEqual(arrivalsFor(route,s,mock([row(s,'8 Minutes',extra)]),now),[]);
  assert.deepEqual(arrivalsFor(route,s,mock([row(s,'8 Minutes')]),now+91000),[]);
  assert.deepEqual(arrivalsFor(route,s,mock([row(s,'8 Minutes'),row(route.stops[1],'9 Minutes',{stopOrder:99})]),now),[]);
  assert.deepEqual(arrivalsFor({...route,stops:[...route.stops,s]},s,mock([row(s,'8 Minutes')]),now),[]);
});
test('stop order prevents backwards travel and boarding at a drop-off-only stop',()=>{
  assert.equal(planner.bus(route,8,2,now,{},now),null);
  const r=planner.routes.find(r=>r.routeNumber==='R7'),i=r.stops.findIndex(s=>s.code==='32000');
  assert.equal(r.stops[i].board,false);assert.equal(planner.bus(r,i,i+1,now,{},now),null);assert.ok(planner.bus(r,i-1,i,now,{},now));
});
test('representative local direct journeys and reverse loop journeys are usable',()=>{
  for(const [a,b,number] of [['103','306','R3'],['306','103','R3'],['602','103','R7'],['401','103','R1']]){
    const r=planner.plan(stop(a),stop(b),{},now);assert.ok(r.journeys.some(j=>j.legs.filter(l=>l.type==='bus').length===1&&j.legs.some(l=>l.number===number)),`${a} → ${b}`);
    for(const j of r.journeys)for(const l of j.legs)if(l.type==='bus'){assert.ok(l.toOrder>l.fromOrder);assert.ok(l.departure.departure>=now+BUFFER*60000);}
  }
});
test('one transfer has a real pedestrian path and sufficient connection time',()=>{
  const r=planner.plan(stop('1007'),stop('401'),{},now);assert.ok(r.journeys.length);
  assert.ok(r.journeys.every(j=>j.transfers===1));
  for(const j of r.journeys){const b=j.legs.filter(l=>l.type==='bus'),w=j.legs.find(l=>l.transfer);assert.equal(b.length,2);assert.ok(w.distance<=300);assert.ok(b[1].departure.departure>=b[0].arrival+(w.minutes+BUFFER)*60000);}
});
test('no invented walk or bus journey across water to Villimalé',()=>{
  assert.equal(planner.walker.path(planner.walker.tree(stop('103').coord,10000),stop('1301').coord,10000),null);
  const r=planner.plan(stop('103'),stop('1301'),{},now);assert.equal(r.journeys.length,0);assert.match(r.reason,/Ferry/);
});
test('coastline check rejects a sea pin beside shore before snapping to a street',()=>{
  assert.ok(walk.land.length>=4);
  assert.equal(planner.walker.onLand([73.504676,4.168]),false);
  assert.equal(planner.walker.snap([73.504676,4.168]),null);
  assert.equal(planner.walker.onLand(stop('103').coord),true);
});
test('disconnected graph, one-way foot paths, geolocation outside network and no-route state',()=>{
  const w=new Walker({nodes:[[73.51,4.17],[73.5101,4.17],[73.52,4.18]],edges:[[0,1,'Footway',1]]});
  assert.ok(w.path(w.tree([73.51,4.17]),[73.5101,4.17]));assert.equal(w.path(w.tree([73.5101,4.17]),[73.51,4.17]),null);
  const r=planner.plan({coord:[73.50,4.21],name:'Sea'},stop('103'),{},now);assert.equal(r.journeys.length,0);assert.match(r.reason,/public walking path/);
});
test('outage uses dated same-day snapshot; next day does not recycle old departures',()=>{
  const same=planner.plan(stop('103'),stop('306'),{'123':{eta:{ok:false},live:{ok:false}}},now);
  assert.ok(same.journeys.some(j=>j.legs.some(l=>l.type==='bus'&&l.departure.source==='saved')));
  const next=planner.plan(stop('103'),stop('306'),{},now+86400000);assert.ok(next.journeys.length);
  for(const j of next.journeys){assert.equal(j.arrival,null);assert.equal(j.timing,'incomplete');assert.ok(j.legs.filter(l=>l.type==='bus').every(l=>l.departure.source==='unknown'));}
});
test('an empty successful schedule cannot relabel saved timings as freshly published',()=>{
  const s=route.stops[0],empty={schedule:{ok:true,fetchedAtUtc:new Date(now+86400000).toISOString(),data:{routeResponse:[]}}};
  const next=chooseDeparture(route,s,now+86400000+120000,empty,now+86400000,data.fetchedAtUtc);
  assert.equal(next.source,'unknown');
});
test('missing departures retain finite travel estimates without inventing arrival clocks or waits',()=>{
  const next=planner.plan(stop('1007'),stop('401'),{},now+86400000);
  assert.ok(next.journeys.length);
  for(const j of next.journeys){
    const buses=j.legs.filter(l=>l.type==='bus');
    assert.equal(j.timing,'incomplete');assert.equal(j.arrival,null);
    assert.ok(Number.isFinite(j.minutes)&&j.minutes>0);
    assert.equal(j.minutes,j.legs.reduce((sum,l)=>sum+l.minutes,0)+buses.length*BUFFER);
    assert.equal(j.unknownWaits,buses.length);
  }
});
test('flat fares sum per boarding and distance fare cannot be calculated from base amount',()=>{
  const r=planner.plan(stop('1007'),stop('401'),{},now);for(const j of r.journeys)assert.equal(j.fare,j.legs.filter(l=>l.type==='bus').reduce((a,b)=>a+b.fare,0));
  const leg=planner.bus({...route,isDistanceFareType:1},0,1,now,{},now);assert.equal(leg.fare,null);
});
