// End-to-end check of the Transactions workflow: the real app.js UI code (in a DOM), the real
// HTTP API and a real SQLite database in a temporary directory. No mocked responses.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile,mkdtemp,rm} from 'node:fs/promises';import {spawn} from 'node:child_process';import {once} from 'node:events';import http from 'node:http';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath,pathToFileURL} from 'node:url';import {writeFileSync} from 'node:fs';import {parseHTML} from 'linkedom';
import * as dates from '../public/assets/dates.js';import * as transactions from '../public/assets/transactions.js';import {translateText} from '../public/assets/locales.js';

const source=(await readFile(new URL('../public/assets/app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').split('await loadSession();')[0];
const serverFile=fileURLToPath(new URL('../server/server.js',import.meta.url));
async function launch(env){const child=spawn(process.execPath,[serverFile],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server exited: '+logs);})]);return {stop:async()=>{child.kill();await once(child,'exit');}};}
async function freePort(){const s=http.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port;}
const settle=async(n=40)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const cp1251=s=>Uint8Array.from([...s].map(c=>{const code=c.charCodeAt(0);return code>=0x410&&code<=0x44f?code-0x350:code;}));
const choose=(select,value)=>{for(const o of select.options)o.toggleAttribute('selected',o.value===value);};
const pick=(picker,value)=>{const option=[...picker.querySelectorAll('[data-tx-picker-option]')].find(button=>button.getAttribute('data-tx-picker-option')===String(value));assert.ok(option,`Missing picker option ${value}`);picker.open=true;option.click();};

// One browser tab: a fresh DOM running app.js, signed in with the given session cookie.
function tab(base,who,route='/dashboard/transactions'){
 const {document,window}=parseHTML('<html><head><meta name="description"></head><body><div id="app"></div><div id="modal-root"></div><div id="toast-root"></div></body></html>');
 const stored=new Map();let inflight=0;
 // Waits until every real HTTP request started by the page has finished and the UI settled.
 const idle=async()=>{for(let i=0;i<500;i++){await new Promise(r=>setTimeout(r,10));if(!inflight){await settle(10);if(!inflight)return;}}throw Error('Requests did not finish');};
 class FormData{constructor(form){this.values=new Map([...form.querySelectorAll('input,select,textarea')].filter(el=>el.name&&!el.disabled&&(el.type!=='checkbox'||el.checked)).map(el=>[el.name,el.value]));}get(k){return this.values.get(k)??null;}has(k){return this.values.has(k);}[Symbol.iterator](){return this.values.entries();}}
 const context={...dates,...transactions,translateText,document,window:{addEventListener:()=>{},scrollTo:()=>{}},NodeFilter:{SHOW_TEXT:4},localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},console,Intl,Date,URL,URLSearchParams,crypto,FormData,TextEncoder,Blob,setTimeout:()=>0,setInterval:()=>0,requestAnimationFrame:cb=>cb(),location:new URL(route,base),
  fetch:async(url,options={})=>{inflight++;try{return await fetch(new URL(url,base),{...options,headers:{...options.headers,Cookie:who.cookie}});}finally{setImmediate(()=>inflight--);}}};
 context.history={pushState:(_,__,p)=>context.location=new URL(p,context.location),replaceState:(_,__,p)=>context.location=new URL(p,context.location)};
 vm.createContext(context);vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);
 run(`state.user=${JSON.stringify(who.user)}`);
 const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
 return {run,context,$,$$,Event:window.Event,
  idle,state:()=>run('JSON.stringify({loaded:state.tx.loaded,error:state.tx.error,view:state.txView})'),
  async open(){await run('loadUserLocalState()');await run('render()');await idle();},
  async upload(name,bytes){context.fileBytes=bytes;context.fileName=name;await run(`handleStatementFile(document.querySelector('[data-import-form]'),{name:fileName,size:fileBytes.length,arrayBuffer:async()=>fileBytes.buffer})`);await idle();},
  spending:c=>$(`[data-tx-currency="${c}"] [data-tx-spending]`)?.textContent,
  rows:()=>$$('[data-tx]').length,
  filter(name,value){const el=$(`[data-tx-filters] [name="${name}"]`);if(el.tagName==='SELECT')choose(el,value);else el.value=value;el.dispatchEvent(new window.Event('change',{bubbles:true}));},
  async click(selector){const el=$(selector);if(!el)throw Error('Missing element '+selector);el.click();await idle();},
  toasts:()=>$('#toast-root').textContent,
  // With TX_SNAPSHOTS=<dir>, saves the rendered screen as static HTML using the real stylesheets,
  // so the layout can be inspected in a browser at desktop and phone widths.
  snap(name){const dir=process.env.TX_SNAPSHOTS;if(!dir)return;
   writeFileSync(path.join(dir,name+'.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/transactions.css"></head><body class="${document.body.className}">${document.body.innerHTML}</body></html>`);}};
}

const mainCsv=['Извлечение по сметка BG00TEST','Период: 01.06.2026 - 31.08.2026','','Дата;Основание;Контрагент;Дебит;Кредит;Валута',
 '05.06.2026;Заплата юни;ACME OOD;;2 500,00;EUR','10.06.2026;Абонамент;NETFLIX.COM;13,99;;EUR','12.06.2026;Покупка;KAUFLAND BG 1234;45,20;;EUR','12.06.2026;Покупка;KAUFLAND BG 1234;45,20;;EUR',
 '15.06.2026;Абонамент;SPOTIFY P1A2B3;10,99;;EUR','16.06.2026;Сторно покупка;KAUFLAND BG 1234;;5,00;EUR','18.06.2026;Превод между собствени сметки;;200,00;;EUR','20.06.2026;Плащане;PAYMENT TO CARD 5678;150,00;;EUR',
 '22.06.2026;Покупка;AMAZON.COM;30,00;;USD','25.06.2026;Покупка;SOPHARMA TRADING;18,40;;EUR','10.07.2026;Абонамент;NETFLIX.COM;13,99;;EUR','15.07.2026;Абонамент;SPOTIFY P1A2B3;10,99;;EUR',
 '25.07.2026;Сметка ток;ЕВН БЪЛГАРИЯ;54,30;;EUR','09.08.2026;Абонамент;NETFLIX.COM;13,99;;EUR','15.08.2026;Абонамент;SPOTIFY P1A2B3;10,99;;EUR','19.08.2026;Кино;CINEMA CITY;24,00;;EUR',
 '32.08.2026;Грешен ред;TEST;1,00;;EUR','Крайно салдо;;;;;'].join('\r\n');
const cardCsv='A;B;C;D\n20.06.2026;Incoming payment;150,00;EUR\n01.08.2026;Kaufland Mladost;-32,40;EUR\n03.08.2026;Vivacom internet;-25,00;EUR\n10.08.2026;Kafe Sofia;-4,50;EUR\n';

test('manual entry, bulk rules, freshness and pagination work through the real interface',{timeout:90000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rr-tools-e2e-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let server;
 try{
  server=await launch({DATA_DIR:dir,PORT:String(port),APP_ORIGIN:base,MAIL_WEBHOOK_URL:'',MAIL_WEBHOOK_TOKEN:''});
  const response=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Tools Tester',email:'tools-e2e@example.test',password:'TestPassword123!'})});
  const who={cookie:response.headers.get('set-cookie').split(';')[0],user:(await response.json()).user};
  const api=async(p,body)=>{const r=await fetch(base+p,{method:body?'POST':'GET',headers:{Cookie:who.cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);return r.json();};
  let t=tab(base,who);await t.open();await t.click('[data-add-transaction]');
  const form=t.$('[data-manual-transaction-form]');
  form.querySelector('[name="accountName"]').value='Cash';form.querySelector('[name="date"]').value='2026-09-11';form.querySelector('[name="description"]').value='Corner Cafe';form.querySelector('[name="amount"]').value='18.50';choose(form.querySelector('[name="category"]'),'Other');
  form.dispatchEvent(new t.Event('submit',{cancelable:true}));await t.idle();
  assert.match(t.toasts(),/Transaction added/);assert.equal(t.rows(),1);assert.equal(t.spending('EUR'),'€18.50');assert.match(t.$('[data-tx-last-import]').textContent,/No imports yet/);
  // 503 imported rows ensure pagination reaches beyond the previous 500-row cap.
  const rows=Array.from({length:503},(_,i)=>({date:`2026-08-${String(i%28+1).padStart(2,'0')}`,description:'Corner Cafe '+i,amount:-(i+1)/100,currency:'EUR'}));
  rows.push({date:'2026-08-30',description:'USD purchase',amount:-3,currency:'USD'});
  const result=await api('/api/transactions/import',{accountName:'Bank',fileName:'many.csv',rows});
  t=tab(base,who);await t.open();const total=t.spending('EUR');
  assert.equal(t.$('[data-tx-count]').textContent,'505');assert.equal(t.rows(),25);assert.equal(t.spending('USD'),'US$3.00');
  assert.equal(total,'€1,286.06');
  await t.click('[data-tx-page="2"]');assert.equal(t.$('[data-tx-page-number]').textContent,'2');assert.equal(t.spending('EUR'),total);
  const size=t.$('[data-tx-page-size]');choose(size,'50');size.dispatchEvent(new t.Event('change'));
  assert.equal(t.rows(),50);assert.equal(t.$('[data-tx-page-number]').textContent,'1');
  // Check every page is reachable and no row is lost or repeated.
  const seen=new Set(t.$$('[data-tx]').map(r=>r.dataset.tx));
  for(let p=2;p<=11;p++){await t.click(`[data-tx-page="${p}"]`);for(const row of t.$$('[data-tx]')){assert.ok(!seen.has(row.dataset.tx));seen.add(row.dataset.tx);}assert.equal(t.spending('EUR'),total);}
  assert.equal(seen.size,505);assert.equal(t.rows(),5);
  const sort=t.$('[data-tx-sort]');choose(sort,'amount-asc');sort.dispatchEvent(new t.Event('change'));
  let saved=await api('/api/transactions');assert.equal(t.$$('[data-tx]')[0].dataset.tx,saved.transactions.find(x=>x.amount===-18.5).id);
  choose(t.$('[data-tx-sort]'),'amount-desc');t.$('[data-tx-sort]').dispatchEvent(new t.Event('change'));
  assert.equal(t.$$('[data-tx]')[0].dataset.tx,saved.transactions.find(x=>x.amount===-0.01).id);
  assert.match(t.$('[data-tx-last-bank-date]').textContent,/Aug 30|30 Aug/);
  t.filter('account',result.bankAccountId);assert.match(t.$('[data-tx-last-date]').textContent,/Aug 30|30 Aug/);
  const search=t.$('[data-global-search]');search.value='Corner Cafe';search.dispatchEvent(new t.Event('input'));
  const ids=t.$$('[data-tx-select]').slice(0,2).map(b=>b.dataset.txSelect);
  for(const id of ids){const box=t.$(`[data-tx-select="${id}"]`);box.checked=true;box.dispatchEvent(new t.Event('change'));}
  assert.equal(t.$('[data-tx-selected-count]').textContent,'2');await t.click('[data-tx-bulk]');
  const bulk=t.$('[data-bulk-category-form]');choose(bulk.querySelector('[name="category"]'),'Health');bulk.querySelector('[name="rememberRule"]').checked=true;
  bulk.dispatchEvent(new t.Event('submit',{cancelable:true}));await t.idle();assert.match(t.toasts(),/Categories updated/);
  saved=await api('/api/transactions');assert.equal(saved.rules.length,1);assert.equal(saved.transactions.filter(x=>x.category==='Health').length,2);
  const preview=await api('/api/transactions/preview',{accountId:result.bankAccountId,rows:[{date:'2026-09-20',description:'Corner Cafe',amount:-9,currency:'EUR'}]});assert.equal(preview.rows[0].category,'Health');
  t=tab(base,who);await t.open();assert.ok(t.$('.tx-rules'));assert.equal(t.$('[data-tx-selected-count]').textContent,'0');
  const box=t.$('[data-tx-select-page]');box.checked=true;box.dispatchEvent(new t.Event('change'));assert.equal(t.$('[data-tx-selected-count]').textContent,'25');
  t.filter('category','Transport');assert.equal(t.rows(),0);assert.equal(t.$('[data-tx-selected-count]').textContent,'0');assert.equal(t.$('[data-tx-bulk]').disabled,true);
  await t.click('[data-remove-category-rule]');await t.click('[data-confirm-remove-rule]');assert.equal((await api('/api/transactions')).rules.length,0);
  assert.equal((await api('/api/transactions')).transactions.filter(x=>x.category==='Health').length,2);
 }finally{if(server)await server.stop();await rm(dir,{recursive:true,force:true});}
});

test('transactions workflow end to end with the real UI code, API and database',{timeout:90000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rr-e2e-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let server;
 try{
  server=await launch({DATA_DIR:dir,PORT:String(port),APP_ORIGIN:base,MAIL_WEBHOOK_URL:'',MAIL_WEBHOOK_TOKEN:''});
  const register=async(name,email)=>{const r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password:'TestPassword123!'})});return {cookie:r.headers.get('set-cookie').split(';')[0],user:(await r.json()).user};};
  const a=await register('E2E Tester','e2e@example.test'),b=await register('Other Tester','other-e2e@example.test');
  const api=async(p,who=a)=>(await fetch(base+p,{headers:{Cookie:who.cookie}})).json();

  // 1. Upload and account choice (new account), empty state before any data.
  let t=tab(base,a);await t.open();
  assert.ok(t.$('.tx-empty'),'empty state is shown; state: '+t.state());t.snap('1-empty');
  await t.click('[data-import-statement]');
  t.$('[data-import-form] [name="accountName"]').value='Main account';t.snap('2-import-form');
  await t.upload('june-august.csv',cp1251(mainCsv));

  // 2–4. Recognised Windows-1251 layout goes straight to review; invalid rows are explained.
  let dialog=t.$('[role="dialog"]');assert.match(dialog.textContent,/Review import/);
  const invalid=t.$$('[data-invalid-row]');assert.equal(invalid.length,2);assert.ok(invalid.every(r=>/Invalid date/.test(r.textContent)));
  const reviewRows=t.$$('[data-review-row]:not([data-invalid-row])');assert.equal(reviewRows.length,16);assert.ok(dialog.querySelector('.tx-review-list'));assert.equal(dialog.querySelector('.tx-review-list .tx-table'),null);
  assert.match(reviewRows[3].textContent,/Same as another row in this file/);
  assert.deepEqual([0,5,6,7].map(i=>t.$(`[data-row-kind="${i}"]`).value),['income','refund','transfer','expense']);
  assert.equal(t.$('[data-row-category="12"]').value,'Bills & utilities','ЕВН is a utility bill');
  const exclude=t.$('[data-row-include="9"]');exclude.checked=false;exclude.dispatchEvent(new t.Event('change'));
  assert.equal(t.$('[data-selected-count]').textContent,'15');
  const cinema=t.$('[data-row-category="15"]');pick(cinema.closest('[data-tx-picker]'),'Other');
  const series=Object.fromEntries(t.$$('.tx-possible-row').map(el=>[el.querySelector('strong').textContent,el]));
  assert.deepEqual(Object.keys(series).sort(),['Netflix','Spotify']);
  const decide=(el,status)=>{const s=el.querySelector('[data-decision]');pick(s.closest('[data-tx-picker]'),status);};
  decide(series.Netflix,'confirmed');decide(series.Spotify,'rejected');t.snap('3-review');

  // 5. Confirm import: saved for this user and account.
  await t.click('[data-confirm-import]');
  assert.match(t.toasts(),/Transactions imported: 15\. Skipped: 1\./);
  let list=await api('/api/transactions');
  assert.equal(list.transactions.length,15);assert.equal(list.accounts.length,1);assert.equal(list.imports.length,1);
  assert.ok(!list.transactions.some(x=>x.merchant.startsWith('Sopharma')),'excluded row was not saved');
  assert.equal(list.transactions.find(x=>x.merchant==='Cinema City').category,'Other','category change was saved');
  assert.equal(list.series.find(s=>s.merchant==='Netflix').status,'confirmed');assert.equal(list.series.find(s=>s.merchant==='Spotify').status,'rejected');
  assert.ok((await api('/api/data')).subscriptions.some(s=>s.name==='Netflix'),'confirmed EUR subscription is tracked');
  // Income and own transfers are not spending; the refund reduces it; USD is separate.
  assert.equal(t.spending('EUR'),'€388.64');assert.equal(t.spending('USD'),'US$30.00');

  // 5. Re-importing the same file adds nothing already saved; only the row excluded before is new.
  await t.click('[data-import-statement]');
  await t.upload('june-august.csv',cp1251(mainCsv));
  dialog=t.$('[role="dialog"]');assert.match(dialog.textContent,/already imported/);
  assert.equal(t.$('[data-selected-count]').textContent,'1');
  assert.equal(t.$$('[data-review-row]').filter(r=>/Already imported/.test(r.textContent)).length,15);
  const onlyNew=t.$('[data-row-include="9"]');onlyNew.checked=false;onlyNew.dispatchEvent(new t.Event('change'));
  await t.click('[data-confirm-import]');
  assert.match(t.$('[role="dialog"] [data-form-message]').textContent,/Select at least one transaction/);
  onlyNew.checked=true;onlyNew.dispatchEvent(new t.Event('change'));
  const again=t.$('[data-row-include="1"]');again.checked=true;again.dispatchEvent(new t.Event('change'));
  await t.click('[data-confirm-import]');
  assert.match(t.toasts(),/Transactions imported: 1\. Skipped: 15\./);
  list=await api('/api/transactions');assert.equal(list.transactions.length,16);assert.equal(list.imports.length,2);

  // 2. Unknown format into a second account: manual column matching; the incoming 150 pairs
  // with the outgoing 150 in the main account, so both become transfers.
  await t.click('[data-import-statement]');
  const accountSelect=t.$('[data-import-form] [name="accountId"]');pick(accountSelect.closest('[data-tx-picker]'),'');
  assert.equal(t.$('[data-new-account]').hidden,false);
  t.$('[data-import-form] [name="accountName"]').value='Card';
  await t.upload('card.csv',new TextEncoder().encode(cardCsv));
  const mapping=t.$('[data-mapping-form]');assert.ok(mapping,'column matching is requested');assert.ok(mapping.querySelector('.tx-mapping-list'));assert.equal(mapping.querySelector('.tx-table-scroll'),null);assert.equal(mapping.querySelectorAll('select').length,0,'mapping stays inside the modal with custom pickers');assert.ok(mapping.querySelector('[data-picker-key="header-index"]'));assert.ok(mapping.querySelector('[data-picker-key="date-order"]'));t.snap('4-mapping');
  assert.deepEqual([0,1,2,3].map(i=>mapping.querySelector(`[name="column-${i}"]`).value),['date','description','amount','currency']);
  pick(mapping.querySelector('[name="column-1"]').closest('[data-tx-picker]'),'counterparty');
  mapping.dispatchEvent(new t.Event('submit',{cancelable:true}));await t.idle();
  assert.equal(t.$('[data-row-kind="0"]').value,'transfer');assert.match(t.$('[role="dialog"]').textContent,/Matches a transfer in/);
  await t.click('[data-confirm-import]');
  list=await api('/api/transactions');const cardId=list.accounts.find(x=>x.name==='Card').id;
  assert.equal(list.transactions.filter(x=>x.accountId===cardId).length,4);
  assert.equal(list.transactions.find(x=>x.description.includes('PAYMENT TO CARD')).kind,'transfer','counterpart in the main account is a transfer too');

  // 8. Reload: everything comes from the server.
  t=tab(base,a);await t.run('loadUserLocalState()');await t.run('render()');
  assert.ok(t.$('[data-tx-loading]'),'loading state is shown while the data is requested');t.snap('5-loading');await t.idle();
  assert.equal(t.rows(),20);assert.equal(t.spending('EUR'),'€318.94');t.snap('6-all');

  // 7. Filters, search and totals.
  t.filter('category','Food & groceries');assert.equal(t.rows(),4);assert.equal(t.spending('EUR'),'€117.80');
  t.filter('category','');t.filter('account',cardId);assert.equal(t.rows(),4);assert.equal(t.spending('EUR'),'€61.90');assert.equal(t.spending('USD'),undefined);
  t.filter('account','');t.filter('kind','income');assert.equal(t.rows(),1);assert.equal(t.spending('EUR'),'€0.00');
  t.filter('kind','');t.filter('from','2026-08-01');assert.equal(t.rows(),6);assert.equal(t.spending('EUR'),'€110.88');assert.equal(t.run('state.txFilters.period'),'custom');
  t.filter('period','all');assert.equal(t.rows(),20);
  const search=t.$('[data-global-search]');search.value='netflix';search.dispatchEvent(new t.Event('input'));
  assert.equal(t.rows(),3);assert.equal(t.spending('EUR'),'€41.97');
  search.value='';search.dispatchEvent(new t.Event('input'));assert.equal(t.rows(),20);

  // 8. A correction after the import persists after reload.
  const kafe=list.transactions.find(x=>x.description.includes('Kafe'));
  const kafeSelect=t.$(`[data-tx-category="${kafe.id}"]`);choose(kafeSelect,'Food & groceries');kafeSelect.dispatchEvent(new t.Event('change'));await settle();
  t=tab(base,a);await t.open();assert.equal(t.$(`[data-tx-category="${kafe.id}"]`).value,'Food & groceries');

  // 6. Views: Subscriptions shows the tracked Netflix; To review brings Spotify back and confirms it.
  await t.click('[data-tx-view="subscriptions"]');assert.ok(t.$$('.subscription-card h3').some(h=>h.textContent==='Netflix'));
  await t.click('[data-tx-view="review"]');assert.match(t.$('.tx-review').textContent,/Marked as not a subscription/);
  await t.click('[data-series-decision="possible"]');assert.ok(t.$('.tx-series'),'Spotify is back in review');t.snap('7-to-review');assert.equal(t.$('[data-review-count]').textContent,'1');
  await t.click('.tx-series [data-series-decision="confirmed"]');
  assert.ok((await api('/api/data')).subscriptions.some(s=>s.name==='Spotify'));assert.equal(t.$('[data-review-count]'),null);

  // 9. Remove import: cancel keeps everything; confirm removes only that import.
  await t.click('[data-tx-view="all"]');
  const cardImport=(await api('/api/transactions')).imports.find(i=>i.fileName==='card.csv');
  await t.click(`[data-remove-import="${cardImport.id}"]`);await t.click('[data-close-modal]');
  assert.equal((await api('/api/transactions')).transactions.length,20);
  await t.click(`[data-remove-import="${cardImport.id}"]`);t.snap('8-remove-confirm');await t.click('[data-confirm-remove-import]');
  list=await api('/api/transactions');
  assert.equal(list.transactions.length,16);assert.equal(list.transactions.filter(x=>x.accountId===cardId).length,0);assert.equal(list.imports.length,2);
  assert.ok((await api('/api/data')).subscriptions.some(s=>s.name==='Netflix'),'tracked subscriptions stay');
  assert.equal(t.rows(),16);

  // Other users see nothing.
  assert.deepEqual((await api('/api/transactions',b)).transactions,[]);
  const other=tab(base,b);await other.open();assert.ok(other.$('.tx-empty'));
 }finally{if(server)await server.stop();await rm(dir,{recursive:true,force:true});}
});
