import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import http from 'node:http';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {dateKey} from '../public/assets/dates.js';
const serverFile=new URL('../server/server.js',import.meta.url).pathname;
async function launch(env){const child=spawn(process.execPath,[serverFile],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server exited: '+logs);})]);return {child,logs:()=>logs,stop:async()=>{child.kill();await once(child,'exit');}};}
async function freePort(){const s=http.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port;}
test('account persistence, conflicts, document isolation and password security',{timeout:20000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rr-test-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let run;
 const req=async(p,method='GET',body,cookie,extra={})=>{const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});const text=await r.text();return {status:r.status,data:r.headers.get('content-type')?.includes('json')?JSON.parse(text):text,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
 run=await launch({DATA_DIR:dir,PORT:String(port),APP_ORIGIN:base,MAIL_WEBHOOK_URL:'',MAIL_WEBHOOK_TOKEN:''});
 let a=await req('/api/auth/register','POST',{name:'Test One',email:'one@example.test',password:'TestPassword123!'});assert.equal(a.status,201);const cookie=a.cookie;
 const b=await req('/api/auth/register','POST',{name:'Test Two',email:'two@example.test',password:'TestPassword123!'});
 assert.equal((await req('/api/data')).status,401);
 const initial=(await req('/api/data','GET',undefined,cookie)).data;assert.deepEqual(initial.subscriptions,[]);
 const item={uid:'sample',name:'Family service',customName:'Family plan',category:'Other',price:120,cycle:'Yearly',renewalDate:'2027-12-20',lastUsedDate:'2026-01-01'};
 const saved=await req('/api/data','PUT',{...initial,subscriptions:[item]},cookie);assert.equal(saved.status,200);assert.equal(saved.data.version,1);
 assert.equal((await req('/api/data','PUT',{...initial,subscriptions:[]},cookie)).status,409);
 assert.deepEqual((await req('/api/data','GET',undefined,b.cookie)).data.subscriptions,[]);
 assert.equal((await req('/api/data','PUT',{...saved.data,subscriptions:[{...item,renewalDate:'2026-02-30'}]},cookie)).status,400);
 assert.equal((await req('/api/data','PUT',null,cookie)).status,400);
 const file=await req('/api/documents','POST',{name:'receipt.txt',base64:Buffer.from('Private receipt').toString('base64')},cookie);assert.equal(file.status,201);
 assert.equal((await req('/api/documents/'+file.data.id,'GET',undefined,cookie)).data,'Private receipt');
 assert.equal((await req('/api/documents/'+file.data.id,'GET',undefined,b.cookie)).status,404);
 assert.equal((await req('/api/documents/'+file.data.id,'DELETE',undefined,b.cookie)).status,404);
 const forgot=await req('/api/auth/forgot-password','POST',{email:'one@example.test'});assert.equal(forgot.status,503);assert.equal('developmentResetUrl' in forgot.data,false);assert.doesNotMatch(run.logs(),/reset-password\?token=/);
 assert.equal((await req('/api/auth/login','POST',{email:'one@example.test',password:'TestPassword123!'},undefined,{Origin:'https://evil.example'})).status,403);
 assert.equal((await req('/api/auth/me','GET',undefined,'rr_session=%E0%A4%A')).status,200);
 const secondSession=(await req('/api/auth/login','POST',{email:'one@example.test',password:'TestPassword123!'})).cookie;
 const password=await req('/api/account/password','POST',{currentPassword:'TestPassword123!',password:'NewPassword123!'},cookie);assert.equal(password.status,200);
 assert.equal((await req('/api/auth/me','GET',undefined,secondSession)).data.user,null);
 assert.equal((await req('/api/auth/me','GET',undefined,password.cookie)).data.user.email,'one@example.test');
 await run.stop();run=await launch({DATA_DIR:dir,PORT:String(port),APP_ORIGIN:base,MAIL_WEBHOOK_URL:'',MAIL_WEBHOOK_TOKEN:''});
 const login=await req('/api/auth/login','POST',{email:'one@example.test',password:'NewPassword123!'});
 assert.equal((await req('/api/data','GET',undefined,login.cookie)).data.subscriptions[0].customName,'Family plan');
 assert.equal((await req('/api/documents/'+file.data.id,'GET',undefined,login.cookie)).data,'Private receipt');
 assert.equal((await req('/api/documents/'+file.data.id,'DELETE',undefined,login.cookie)).status,200);
 }finally{if(run)await run.stop();await rm(dir,{recursive:true,force:true});}
});

test('mail relay receives resets, verification and deduplicated closed-page reminders',{timeout:15000},async()=>{
 const mails=[],mailServer=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;mails.push({headers:req.headers,...JSON.parse(raw)});res.writeHead(200);res.end('{}');});mailServer.listen(0,'127.0.0.1');await once(mailServer,'listening');
 const dir=await mkdtemp(path.join(os.tmpdir(),'rr-mail-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let run,cookie;
 const req=async(p,body)=>{const r=await fetch(base+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const c=r.headers.get('set-cookie');return {status:r.status,data:await r.json(),cookie:c?.split(';')[0]};};
 try{
 run=await launch({DATA_DIR:dir,PORT:String(port),APP_ORIGIN:base,MAIL_WEBHOOK_URL:`http://127.0.0.1:${mailServer.address().port}`,MAIL_WEBHOOK_TOKEN:'local-test-only',REMINDER_INTERVAL_MS:'1000'});
 cookie=(await req('/api/auth/register',{name:'Email Test',email:'email@example.test',password:'TestPassword123!'})).cookie;
 assert.equal((await req('/api/reminders/verify',{})).status,200);const verify=new URL(mails.at(-1).text.match(/http:\/\/\S+/)[0].replace(/\.$/,'' )).searchParams.get('verify');
 assert.equal((await req('/api/reminders/confirm',{token:verify})).status,200);
 const d=(await req('/api/data')).data;const response=await fetch(base+'/api/data',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({...d,subscriptions:[{uid:'due-today',name:'Test reminder',price:10,cycle:'Monthly',renewalDate:dateKey(new Date(),'Europe/Sofia')}],settings:{...d.settings,emailReminders:true}})});assert.equal(response.status,200);
 await new Promise(resolve=>setTimeout(resolve,2400));assert.equal(mails.filter(m=>m.subject==='Renewal reminder: Test reminder').length,1);
 assert.ok(mails.every(m=>m.headers.authorization==='Bearer local-test-only'));
 assert.equal((await req('/api/account/email',{email:'changed@example.test',password:'TestPassword123!'})).status,200);
 const emailToken=new URL(mails.at(-1).text.match(/http:\/\/\S+/)[0].replace(/\.$/,'' )).searchParams.get('emailToken');
 const changed=await req('/api/account/email/confirm',{token:emailToken});assert.equal(changed.status,200);cookie=changed.cookie;assert.equal(changed.data.user.email,'changed@example.test');assert.equal((await req('/api/data')).data.settings.emailReminders,false);
 assert.equal((await req('/api/account/email/confirm',{token:emailToken})).status,400);
 const f=await req('/api/auth/forgot-password',{email:'changed@example.test'});assert.equal(f.status,200);assert.equal('developmentResetUrl' in f.data,false);
 const resetToken=new URL(mails.at(-1).text.match(/http:\/\/\S+/)[0]).searchParams.get('token');
 assert.equal((await req('/api/auth/reset-password',{token:resetToken,password:'UpdatedPassword123!'})).status,200);
 assert.equal((await req('/api/auth/me')).data.user,null);
 assert.equal((await req('/api/auth/reset-password',{token:resetToken,password:'UpdatedPassword123!'})).status,400);
 assert.doesNotMatch(run.logs(),/reset-password\?token=/);
 }finally{if(run)await run.stop();await new Promise(r=>mailServer.close(r));await rm(dir,{recursive:true,force:true});}
});

test('full backups merge atomically, sessions revoke, paid flags cannot be imported, deletion cascades',{timeout:15000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rr-lifecycle-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let run,cookie;
 const req=async(p,body,method=body?'POST':'GET',c=cookie)=>{const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',...(c?{Cookie:c}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{run=await launch({DATA_DIR:dir,PORT:String(port),APP_ORIGIN:base,MAIL_WEBHOOK_URL:'',MAIL_WEBHOOK_TOKEN:''});cookie=(await req('/api/auth/register',{name:'Backup Test',email:'backup@example.test',password:'TestPassword123!'})).cookie;
 const other=(await req('/api/auth/login',{email:'backup@example.test',password:'TestPassword123!'})).cookie;
 const sessions=await req('/api/account/sessions');assert.equal(sessions.data.sessions.length,2);assert.equal(JSON.stringify(sessions).includes('token_hash'),false);
 assert.equal((await req('/api/account/sessions/revoke-others',{password:'wrongpass'})).status,400);
 assert.equal((await req('/api/account/sessions/revoke-others',{password:'TestPassword123!'})).status,200);assert.equal((await req('/api/auth/me',null,'GET',other)).data.user,null);
 const d=(await req('/api/data')).data;const saved=await req('/api/data',{...d,proPreview:true,pro:true,subscriptions:[{uid:'backup-sub',name:'Test',price:9,cycle:'Monthly',renewalDate:'2026-09-20'}]},'PUT');assert.equal(saved.data.pro,false);
 await req('/api/documents',{name:'invoice.txt',base64:Buffer.from('Invoice').toString('base64')});
 const backup=(await req('/api/account/export')).data;assert.equal(backup.documents.length,1);assert.equal(JSON.stringify(backup).includes('password_hash'),false);
 const merged=await req('/api/account/import',{version:saved.data.version,backup});assert.equal(merged.status,200);assert.equal(merged.data.addedDocuments,0);assert.equal(merged.data.addedSubscriptions,0);
 let current=(await req('/api/data')).data;const broken=structuredClone(backup);broken.data.subscriptions[0].uid='new';broken.documents[0].base64='bad!';assert.equal((await req('/api/account/import',{version:current.version,backup:broken})).status,400);assert.equal((await req('/api/data')).data.version,current.version);
 assert.equal((await req('/api/account/delete',{password:'TestPassword123!',confirmEmail:'wrong@example.test'})).status,400);
 assert.equal((await req('/api/account/delete',{password:'TestPassword123!',confirmEmail:'backup@example.test'})).status,200);assert.equal((await req('/api/auth/me')).data.user,null);assert.equal((await req('/api/data')).status,401);
 }finally{if(run)await run.stop();await rm(dir,{recursive:true,force:true});}
});
