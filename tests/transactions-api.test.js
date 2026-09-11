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

test('manual entries and merchant rules persist, respect ownership and do not rewrite unrelated transactions',{timeout:30000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rr-tx-tools-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let run,cookie;
 const req=async(p,body,method=body?'POST':'GET',c=cookie)=>{const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',...(c?{Cookie:c}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
  run=await launch({DATA_DIR:dir,PORT:String(port),APP_ORIGIN:base,MAIL_WEBHOOK_URL:'',MAIL_WEBHOOK_TOKEN:''});
  cookie=(await req('/api/auth/register',{name:'Tools Test',email:'tools@example.test',password:'TestPassword123!'})).cookie;
  const other=(await req('/api/auth/register',{name:'Other',email:'tools-other@example.test',password:'TestPassword123!'},'POST',null)).cookie;
  const manual={requestId:'10000000-0000-4000-8000-000000000001',accountName:'Cash',date:'2026-09-11',description:'Corner Cafe',amount:-8.5,currency:'EUR',kind:'expense',category:'Other'};
  const added=await req('/api/transactions/manual',manual);assert.equal(added.status,200);assert.equal(added.data.created,true);
  const accountId=added.data.bankAccountId,id=added.data.id;
  assert.equal((await req('/api/transactions/manual',manual)).data.created,false,'retry is idempotent');
  assert.equal((await req('/api/transactions/manual',{...manual,accountId},'POST',other)).status,400,'cannot write to another user account');
  for(const change of [{amount:8.5},{date:'2026-02-30'},{kind:'invalid'},{currency:'EU'},{category:'invalid'}]) assert.equal((await req('/api/transactions/manual',{...manual,...change})).status,400);
  const salary=await req('/api/transactions/manual',{...manual,requestId:'10000000-0000-4000-8000-000000000002',description:'Salary',amount:1000,kind:'income'});assert.equal(salary.status,200);
  const rows=[{date:'2026-08-10',description:'Corner Cafe',amount:-10,currency:'EUR'},{date:'2026-08-11',description:'Corner Cafe',amount:-12,currency:'EUR'},{date:'2026-08-12',description:'Bookshop',amount:-30,currency:'USD'}];
  await req('/api/transactions/import',{accountName:'Bank',fileName:'bank.csv',rows});
  let data=(await req('/api/transactions')).data;
  const cafe=data.transactions.filter(t=>t.description==='Corner Cafe'),bankId=data.accounts.find(a=>a.name==='Bank').id,unselected=cafe.find(t=>t.amount===-12);
  const ids=[id,cafe.find(t=>t.amount===-10).id];
  assert.equal((await req('/api/transactions/bulk-category',{ids,category:'Food & groceries',rememberRule:true},'POST',other)).status,404);
  assert.equal((await req('/api/transactions/bulk-category',{ids:[id,'not-found'],category:'Health',rememberRule:true})).status,404);
  assert.equal((await req('/api/transactions/bulk-category',{ids:[id,salary.data.id],category:'Health',rememberRule:true})).status,400,'mixed kinds roll back entirely');
  assert.equal((await req('/api/transactions')).data.rules.length,0);
  assert.deepEqual((await req('/api/transactions/bulk-category',{ids,category:'Health',rememberRule:true})).data,{updated:2,rulesSaved:1});
  data=(await req('/api/transactions')).data;
  assert.equal(data.transactions.find(t=>t.id===unselected.id).category,unselected.category,'unselected history is unchanged');
  assert.ok(ids.every(id=>data.transactions.find(t=>t.id===id).category==='Health'));
  assert.equal(data.rules.length,1);assert.equal((await req('/api/transactions',null,'GET',other)).data.rules.length,0);
  assert.equal(data.freshness.find(a=>a.accountId===accountId).lastImportAt,null,'manual entries are not imports');
  assert.equal(data.freshness.find(a=>a.accountId===bankId).lastImportedTransactionDate,'2026-08-12');
  const future=[{date:'2026-09-12',description:'Corner Cafe CARD 1234',amount:-7,currency:'EUR'},{date:'2026-09-13',description:'Corner Cafe refund',amount:2,currency:'EUR'}];
  let preview=await req('/api/transactions/preview',{accountId:bankId,rows:future});
  assert.ok(preview.data.rows.every(t=>t.category==='Health'),'rules apply to future matching merchants, including refunds');
  assert.equal((await req('/api/transactions/preview',{accountName:'Other Bank',rows:future},'POST',other)).data.rows[0].category,'Food & groceries','another user gets only the built-in category');
  await req('/api/transactions/import',{accountId:bankId,fileName:'next.csv',rows:preview.data.rows.map(t=>({...t,category:'Entertainment'}))});
  assert.ok((await req('/api/transactions')).data.transactions.filter(t=>t.date>='2026-09-12').every(t=>t.category==='Entertainment'),'explicit review edits override remembered rules');
  // Rule survives a server restart, then can be replaced and removed without rewriting history.
  await run.stop();run=null;run=await launch({DATA_DIR:dir,PORT:String(port),APP_ORIGIN:base,MAIL_WEBHOOK_URL:'',MAIL_WEBHOOK_TOKEN:''});
  data=(await req('/api/transactions')).data;assert.equal(data.rules.length,1);
  await req('/api/transactions/bulk-category',{ids:[id],category:'Transport',rememberRule:true});
  data=(await req('/api/transactions')).data;assert.equal(data.rules.length,1);assert.equal(data.rules[0].category,'Transport');
  assert.equal((await req('/api/transactions/rules/'+data.rules[0].id,null,'DELETE',other)).status,404);
  assert.equal((await req('/api/transactions/rules/'+data.rules[0].id,null,'DELETE')).status,200);
  assert.equal((await req('/api/transactions/preview',{accountId:bankId,rows:future})).data.rows[0].category,'Food & groceries');
  const bankImport=data.imports.find(i=>i.fileName==='bank.csv');await req('/api/transactions/imports/'+bankImport.id,null,'DELETE');
  assert.ok((await req('/api/transactions')).data.transactions.some(t=>t.id===id),'removing an import keeps manual records');
 }finally{if(run)await run.stop();await rm(dir,{recursive:true,force:true});}
});
