import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import http from 'node:http';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const serverFile=fileURLToPath(new URL('../server/server.js',import.meta.url));
async function launch(env){const child=spawn(process.execPath,[serverFile],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server exited: '+logs);})]);return {child,logs:()=>logs,stop:async()=>{child.kill();await once(child,'exit');}};}
async function freePort(){const s=http.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port;}

test('statement import previews, deduplicates re-uploads, links confirmed subscriptions and stays per account',{timeout:20000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rr-tx-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let run,cookie;
 const req=async(p,body,method=body?'POST':'GET',c=cookie)=>{const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',...(c?{Cookie:c}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
  run=await launch({DATA_DIR:dir,PORT:String(port),APP_ORIGIN:base,MAIL_WEBHOOK_URL:'',MAIL_WEBHOOK_TOKEN:''});
  cookie=(await req('/api/auth/register',{name:'Import Test',email:'import@example.test',password:'TestPassword123!'})).cookie;
  const other=(await req('/api/auth/register',{name:'Other User',email:'other@example.test',password:'TestPassword123!'},'POST',null)).cookie;
  assert.equal((await req('/api/transactions',null,'GET',null)).status,401);
  const rows=[['2026-06-10','NETFLIX.COM · Абонамент',-13.99],['2026-07-10','NETFLIX.COM · Абонамент',-13.99],['2026-08-09','NETFLIX.COM · Абонамент',-13.99],['2026-06-12','KAUFLAND BG 1234',-45.2],['2026-06-12','KAUFLAND BG 1234',-45.2],['2026-06-15','ACME OOD · Заплата',2500]]
   .map(([date,description,amount],i)=>({line:i+2,date,description,amount,currency:'EUR'}));
  assert.equal((await req('/api/transactions/preview',{accountName:'Main account',rows:[{...rows[0],date:'2026-02-30'}]})).status,400);
  const preview=await req('/api/transactions/preview',{accountName:'Main account',rows});assert.equal(preview.status,200);
  assert.equal(preview.data.rows[4].duplicate,'file');assert.deepEqual(preview.data.rows.map(r=>r.kind),['expense','expense','expense','expense','expense','income']);
  const series=preview.data.series.find(s=>s.merchant==='Netflix');assert.equal(series.cycle,'Monthly');assert.equal(series.status,'possible');
  assert.equal((await req('/api/transactions')).data.transactions.length,0,'preview saves nothing');
  const imported=await req('/api/transactions/import',{accountName:'Main account',fileName:'june.csv',rows:preview.data.rows.map(r=>({...r,include:true})),decisions:{[series.seriesKey]:{status:'confirmed',category:'Entertainment'}}});
  assert.equal(imported.status,200);assert.equal(imported.data.imported,6);assert.equal(imported.data.subscriptionsAdded,1);
  const tracked=imported.data.account.subscriptions.find(s=>s.name==='Netflix');assert.equal(tracked.cycle,'Monthly');assert.equal(tracked.price,13.99);assert.equal(tracked.renewalDate,'2026-08-09');
  const again=await req('/api/transactions/import',{accountId:imported.data.bankAccountId,fileName:'june.csv',rows});assert.equal(again.data.imported,0);assert.equal(again.data.skipped,6);
  const repeat=await req('/api/transactions/preview',{accountId:imported.data.bankAccountId,rows});assert.ok(repeat.data.rows.every(r=>r.duplicate==='imported'&&!r.include));
  const list=(await req('/api/transactions')).data;assert.equal(list.transactions.length,6);assert.equal(list.imports.length,1);assert.equal(list.accounts[0].name,'Main account');
  assert.equal(list.series.find(s=>s.merchant==='Netflix').status,'confirmed');
  const salary=list.transactions.find(t=>t.kind==='income'),grocery=list.transactions.find(t=>t.merchant==='Kaufland');
  assert.deepEqual((await req('/api/transactions/'+salary.id,{kind:'transfer'},'PATCH')).data,{id:salary.id,kind:'transfer',category:null});
  assert.equal((await req('/api/transactions/'+grocery.id,{category:'Nope'},'PATCH')).status,400);
  assert.deepEqual((await req('/api/transactions',null,'GET',other)).data.transactions,[]);
  assert.equal((await req('/api/transactions/'+salary.id,{kind:'expense'},'PATCH',other)).status,404);
  assert.equal((await req('/api/transactions/import',{accountId:imported.data.bankAccountId,rows},'POST',other)).status,400);
  assert.equal((await req('/api/transactions/imports/'+list.imports[0].id,null,'DELETE',other)).status,404);
  assert.equal((await req('/api/transactions/imports/'+list.imports[0].id,null,'DELETE')).data.removed,6);
  assert.equal((await req('/api/transactions')).data.transactions.length,0);
  assert.ok((await req('/api/data')).data.subscriptions.some(s=>s.name==='Netflix'),'removing an import keeps tracked subscriptions');
 }finally{if(run)await run.stop();await rm(dir,{recursive:true,force:true});}
});
