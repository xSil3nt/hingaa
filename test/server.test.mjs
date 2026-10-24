import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('HTTP app validates requests and works with unavailable upstream feeds',async()=>{
  const child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:'0',RTL_OFFLINE:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  try{
    const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Server did not start')),10000);child.stdout.on('data',d=>{out+=d;const m=out.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});child.on('error',reject);});
    const bootstrap=await(await fetch(url+'/api/bootstrap')).json();assert.equal(bootstrap.routes.length,15);
    assert.ok(bootstrap.places.some(p=>p.aliases.includes('airport')));
    assert.equal((await fetch(url+'/')).status,200);
    assert.equal((await fetch(url+'/api/plan',{method:'POST',body:JSON.stringify({origin:{coord:[0,0]},destination:{coord:[0,0]}})})).status,400);
    const origin=bootstrap.places.find(p=>p.id==='103'),destination=bootstrap.places.find(p=>p.id==='306');
    const res=await fetch(url+'/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin,destination})});
    assert.equal(res.status,200);const plan=await res.json();assert.ok(plan.journeys.length);
    for(const f of Object.values(plan.feeds)){assert.equal(f.eta.ok,false);assert.equal(f.live.ok,false);assert.equal(f.live.data,undefined);}
    const noRoute=await(await fetch(url+'/api/plan',{method:'POST',body:JSON.stringify({origin,destination:bootstrap.places.find(p=>p.id==='1301')})})).json();
    assert.equal(noRoute.journeys.length,0);
    assert.equal((await fetch(url+'/api/feed?code=17')).status,400);
  }finally{child.kill();}
});
