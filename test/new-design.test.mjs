import test from 'node:test';
import assert from 'node:assert/strict';
import {boardingInfo} from '../public/new-design.js';
const now=Date.UTC(2026,9,24,10),helpers={escape:s=>String(s).replaceAll('<','&lt;'),time:()=> '15:02'};
const leg={from:'STELCO',departure:{source:'live',departure:now+180000,checkedAt:new Date(now-10000).toISOString(),vehicleCode:'C1219'}};
test('live boarding arrival counts down in its bus step and includes the matched vehicle',()=>{
  assert.match(boardingInfo(leg,helpers,now),/Live · ~3 min · C1219/);
  assert.match(boardingInfo(leg,helpers,now+60000),/Live · ~2 min/);
});
test('expired and future-dated feeds cannot keep a live badge or a stale arrival clock',()=>{
  const expired=boardingInfo(leg,helpers,now+90000);assert.doesNotMatch(expired,/Live|15:02/);assert.match(expired,/unavailable/);
  assert.doesNotMatch(boardingInfo({...leg,departure:{...leg.departure,checkedAt:new Date(now+60000).toISOString()}},helpers,now),/Live/);
});
test('published and unknown departures are not presented as live arrivals',()=>{
  assert.doesNotMatch(boardingInfo({...leg,departure:{...leg.departure,source:'published'}},helpers,now),/Live/);
  assert.match(boardingInfo({...leg,departure:{source:'unknown'}},helpers,now),/wait for next bus/);
});
