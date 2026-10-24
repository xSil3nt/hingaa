import test from 'node:test';
import assert from 'node:assert/strict';
import {compassHeading,travelHeading,normalizeHeading,locationSvg} from '../public/location-marker.js';
test('phone direction uses calibrated compass or absolute orientation, never relative alpha',()=>{
  assert.equal(compassHeading({webkitCompassHeading:90,webkitCompassAccuracy:8}),90);
  assert.equal(compassHeading({webkitCompassHeading:0,webkitCompassAccuracy:5}),0);
  assert.equal(compassHeading({webkitCompassHeading:90,webkitCompassAccuracy:-1}),null);
  assert.equal(compassHeading({webkitCompassHeading:90,webkitCompassAccuracy:80}),null);
  assert.equal(compassHeading({absolute:true,alpha:270}),90);
  assert.equal(compassHeading({absolute:false,alpha:270}),null);
  assert.equal(compassHeading({absolute:true,alpha:null}),null);
});
test('landscape orientation wraps compass headings correctly',()=>{
  assert.equal(compassHeading({absolute:true,alpha:0},90),90);
  assert.equal(compassHeading({webkitCompassHeading:300},90),30);
  assert.equal(normalizeHeading(-10),350);assert.equal(normalizeHeading(null),null);
});
test('stationary or missing GPS headings do not fabricate facing direction',()=>{
  assert.equal(travelHeading({speed:0,heading:90}),null);
  assert.equal(travelHeading({speed:2,heading:null}),null);
  assert.equal(travelHeading({speed:1,heading:0}),0);
  assert.equal(travelHeading({speed:1,heading:370}),10);
});
test('the location marker draws a heading cone only when direction is available',()=>{
  assert.ok(!locationSvg().includes('rotate('));
  assert.ok(locationSvg(90).includes('rotate(90 28 28)'));
  assert.ok(locationSvg(0).includes('rotate(0 28 28)'));
});
