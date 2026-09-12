import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {parseHTML} from 'linkedom';import crypto from 'node:crypto';import * as dates from '../public/assets/dates.js';import {translateText} from '../public/assets/locales.js';import * as transactions from '../public/assets/transactions.js';
const source=(await readFile(new URL('../public/assets/app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').split('await loadSession();')[0];
export function harness(){
 const {document,window}=parseHTML('<html><head><meta name="description"></head><body><div id="app"></div><div id="modal-root"></div><div id="toast-root"></div></body></html>');
 const stored=new Map(),calls=[],txImports=[],tx={accounts:[],transactions:[],series:[],imports:[]};let data={version:0,subscriptions:[],settings:{timeZone:'Europe/Sofia',reminderDays:3,emailVerified:false,emailReminders:false},proPreview:false};
 class FormData {constructor(form){this.values=new Map([...form.querySelectorAll('input,select,textarea')].filter(el=>el.name&&!el.disabled&&(el.type!=='checkbox'||el.checked)).map(el=>[el.name,el.value]));}get(k){return this.values.get(k)??null;}has(k){return this.values.has(k);}[Symbol.iterator](){return this.values.entries();}}
 const context={...dates,...transactions,translateText,document,window:{addEventListener:window.addEventListener.bind(window),scrollTo:()=>{}},NodeFilter:{SHOW_TEXT:4},localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},console,Intl,Date,URL,URLSearchParams,crypto,FormData,TextEncoder,Blob,setTimeout:()=>0,setInterval:()=>0,requestAnimationFrame:cb=>cb(),location:new URL('http://localhost:3000/dashboard'),fetch:async(url,options={})=>{
  calls.push({url,...options});const body=options.body?JSON.parse(options.body):null;let status=200,result={};
  if(url==='/api/data'&&options.method==='PUT'){if(body.version!==data.version){status=409;result={error:'Your account changed in another tab or device. Reload the latest data before saving.'};}else{data={...body,version:data.version+1};result=data;}}
  else if(url.startsWith('/api/pro/insights')){const items=vm.runInContext('state.subscriptions',context),today=dates.dateKey(new Date(),'Europe/Sofia'),categories={};items.forEach(s=>categories[s.category]=(categories[s.category]||0)+dates.annualAmount(s));result={annual:Object.values(categories).reduce((a,b)=>a+b,0),top:Object.entries(categories).sort((a,b)=>b[1]-a[1])[0]||null,monthlySavings:items.filter(s=>s.lastUsedDate&&dates.dayDifference(today,s.lastUsedDate)>=30).reduce((a,s)=>a+dates.annualAmount(s)/12,0)};}else if(url==='/api/pro/price-changes')result={changes:[]};else if(url==='/api/data')result=data;else if(url==='/api/documents')result={documents:[]};else if(url==='/api/transactions')result=tx;else if(url==='/api/transactions/preview')result={account:{id:null,name:body.accountName},rows:body.rows.map(r=>({...r,...transactions.analyzeTransaction(r),fingerprint:'f',duplicate:null,include:true,seriesKey:null})),series:[],previousImport:null};else if(url==='/api/transactions/import'){txImports.push(body);result={imported:body.rows.filter(r=>r.include).length,skipped:0,account:data};}else if(url==='/api/auth/forgot-password')result={message:'If an account exists for that email, a reset link has been sent.'};
  return {ok:status<400,status,json:async()=>result};
 }};
 context.history={pushState:(_,__,p)=>context.location=new URL(p,context.location),replaceState:(_,__,p)=>context.location=new URL(p,context.location)};
 vm.createContext(context);vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);
 run("state.user={id:1,name:'UI Tester',email:'ui@example.test'}");
 const sample=(uid,name,cycle='Monthly',date='2026-01-15')=>({uid,id:'custom',name,customName:'Family',category:'Other',price:10,cycle,renewalDate:date,color:'#6956E8',logo:'S',lastUsedDate:'2026-01-01',lastReviewedDate:null,priceHistory:[]});
 const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 return {document,context,run,calls,tick,sample,stored,Event:window.Event,data:()=>data,txImports};
}
test('all routes render in EN, DE and ES with associated form labels',async()=>{
 const h=harness();
 for(const lang of ['en','de','es'])for(const route of ['/','/pricing','/contact','/privacy','/terms','/cookies','/dashboard','/dashboard/transactions','/dashboard/subscriptions','/dashboard/calendar','/dashboard/unused','/dashboard/documents','/dashboard/settings','/dashboard/insights','/dashboard/price-changes']){
  h.context.location=new URL(route,'http://localhost:3000');h.run(`state.lang='${lang}';state.pro=true;state.subscriptions=${JSON.stringify([h.sample('a','A very long service name'),h.sample('b','Weekly','Weekly')])}`);await h.run('render()');
  assert.ok(h.document.querySelector('main'),route);assert.doesNotMatch(h.document.body.innerHTML,/undefined|NaN/,route);
  for(const field of h.document.querySelectorAll('.field')){const input=field.querySelector('input,select,textarea'),label=field.querySelector('label');assert.equal(label.getAttribute('for'),input.id);}
 }
});
test('search clears after cycle rerender and restores records; plan names are searchable',async()=>{
 const h=harness();h.context.location=new URL('http://localhost:3000/dashboard/subscriptions');h.run(`state.subscriptions=${JSON.stringify([h.sample('a','Netflix'),h.sample('b','Spotify')])};state.dashboardQuery='Netflix'`);await h.run('render()');
 h.document.querySelector('[data-sub-filter="Monthly"]').click();await h.tick();const search=h.document.querySelector('[data-global-search]');search.value='';search.dispatchEvent(new h.Event('input'));
 assert.equal([...h.document.querySelectorAll('[data-filter-text]')].filter(el=>!el.hidden).length,2);
 assert.equal(h.document.querySelector('[data-results-count]').textContent,'2');search.value='Family';search.dispatchEvent(new h.Event('input'));assert.equal(h.document.querySelector('[data-results-count]').textContent,'2');
 search.value='not found';search.dispatchEvent(new h.Event('input'));assert.equal(h.document.querySelector('[data-search-empty]').hidden,false);
});
test('translated subscription form preserves API cycle values and saves entered plan',async()=>{
 const h=harness();h.run("state.lang='de';subscriptionFormModal('custom')");const form=h.document.querySelector('[data-sub-form]');
 assert.equal(form.querySelector('select[name="cycle"]').value,'Monthly');
 for(const [name,value] of Object.entries({service:'My Service',customName:'Home',price:'12.50',category:'Other',renewalDate:'2026-12-20'}))form.querySelector(`[name="${name}"]`).value=value;
 form.dispatchEvent(new h.Event('submit',{cancelable:true}));await h.tick();
 const saved=h.data().subscriptions[0];assert.ok(saved);assert.equal(saved.cycle,'Monthly');assert.equal(saved.customName,'Home');assert.equal(saved.renewalDate,'2026-12-20');assert.equal(saved.price,12.5);
});
test('editing records price history and preserves recurrence anchor',async()=>{
 const h=harness();h.run(`state.subscriptions=${JSON.stringify([h.sample('a','Netflix')])};subscriptionFormModal(null,'a')`);const form=h.document.querySelector('[data-sub-form]');
 form.querySelector('[name="price"]').value='20';form.dispatchEvent(new h.Event('submit',{cancelable:true}));await h.tick();
 const saved=h.data().subscriptions[0];assert.equal(saved.price,20);assert.equal(saved.renewalDate,'2026-01-15');assert.equal(saved.priceHistory[0].from,10);assert.equal(saved.priceHistory[0].to,20);
});
test('forgot-password binding is idempotent and repeat submit sends one request',async()=>{
 const h=harness();h.run("state.user=null");h.context.location=new URL('http://localhost:3000/forgot-password');await h.run('render()');h.run("bindAuthForm(document.querySelector('[data-auth-form]'))");const form=h.document.querySelector('form');form.querySelector('[name="email"]').value='ui@example.test';
 for(let i=0;i<2;i++){form.dispatchEvent(new h.Event('submit',{cancelable:true}));await h.tick();}
 assert.equal(h.calls.filter(c=>c.url==='/api/auth/forgot-password').length,2);
});
test('registration password can be shown and hidden without changing its value',async()=>{
 const h=harness();h.run('state.user=null');h.context.location=new URL('http://localhost:3000/register');await h.run('render()');
 const input=h.document.querySelector('[data-auth-form="register"] [name="password"]'),toggle=h.document.querySelector('[data-password-toggle]');input.value='TestPassword123!';
 assert.equal(input.type,'password');assert.equal(toggle.getAttribute('aria-controls'),input.id);assert.equal(toggle.getAttribute('aria-label'),'Show password');
 toggle.click();assert.equal(input.type,'text');assert.equal(input.value,'TestPassword123!');assert.equal(toggle.getAttribute('aria-label'),'Hide password');assert.equal(toggle.getAttribute('aria-pressed'),'true');
 toggle.click();assert.equal(input.type,'password');assert.equal(toggle.getAttribute('aria-label'),'Show password');assert.equal(toggle.getAttribute('aria-pressed'),'false');
});
test('modal background is inert and editing controls and labels exist',()=>{
 const h=harness();h.run("subscriptionFormModal('custom')");assert.equal(h.document.querySelector('#app').inert,true);assert.equal(h.document.querySelector('[role="dialog"]').getAttribute('aria-labelledby'),'modal-title');
 for(const field of h.document.querySelectorAll('.field'))assert.ok(field.querySelector('label').getAttribute('for'));
 h.run('closeModal()');assert.equal(h.document.querySelector('#app').inert,false);
});
test('empty insights do not invent a leading category or savings',async()=>{
 const h=harness();h.context.location=new URL('http://localhost:3000/dashboard/insights');h.run('state.pro=true');await h.run('render()');assert.doesNotMatch(h.document.querySelector('.insight-grid').textContent,/Entertainment|38%|8%/);
});

test('theme switch preserves unsaved profile fields',async()=>{
 const h=harness();h.context.location=new URL('http://localhost:3000/dashboard/settings');await h.run('render()');const name=h.document.querySelector('[data-profile-form] [name="name"]');name.value='Unsaved draft';h.document.querySelector('[data-theme-toggle]').click();assert.equal(h.document.querySelector('[data-profile-form] [name="name"]').value,'Unsaved draft');
});
test('settings groups actions into compact sections and keeps the danger zone full width',async()=>{
 const h=harness();h.context.location=new URL('http://localhost:3000/dashboard/settings');h.run("state.meta={...(state.meta||{}),mailReady:true};state.settings={...state.settings,emailVerified:false}");await h.run('render()');
 assert.equal(h.document.querySelectorAll('.settings-section').length,3);
 assert.ok(h.document.querySelector('.reminder-card .reminder-verification [data-verify-email]'));
 assert.ok(h.document.querySelector('[data-profile-form] .settings-actions .btn-primary'));
 assert.ok(h.document.querySelector('.settings-card-wide.danger-zone [data-delete-account]'));
});
test('language switch preserves drafts and never translates a user plan named Home',async()=>{
 const h=harness();h.context.location=new URL('http://localhost:3000/dashboard/settings');await h.run('render()');h.document.querySelector('[data-profile-form] [name="name"]').value='Unsaved draft';h.run("changeLanguage('de')");assert.equal(h.document.querySelector('[data-profile-form] [name="name"]').value,'Unsaved draft');
 h.context.location=new URL('http://localhost:3000/dashboard/subscriptions');h.run(`state.subscriptions=${JSON.stringify([{...h.sample('a','Home'),customName:'Home'}])}`);await h.run('render()');assert.equal(h.document.querySelector('.plan-name').textContent,'Home');assert.equal(h.document.querySelector('.subscription-card h3').textContent,'Home');
});
test('removal needs confirmation and the notice does not imply cancelling with provider',()=>{
 const h=harness();h.run(`state.subscriptions=${JSON.stringify([h.sample('a','Netflix')])};confirmRemoval('a')`);assert.match(h.document.querySelector('[role="dialog"]').textContent,/does not cancel/);assert.equal(h.calls.filter(c=>c.method==='PUT').length,0);h.document.querySelector('[data-close-modal]').click();assert.equal(h.run('state.subscriptions.length'),1);
});
test('outside-click dismissal works more than once',async()=>{
 const h=harness();await h.run('render()');
 for(let i=0;i<3;i++){h.document.querySelector('[data-lang-toggle]').click();assert.ok(h.document.querySelector('[data-lang-menu]').classList.contains('open'));h.document.querySelector('main').dispatchEvent(new h.Event('click',{bubbles:true}));assert.equal(h.document.querySelector('[data-lang-menu]').classList.contains('open'),false);}
});
test('calendar dialog uses the selected historical occurrence instead of the next renewal',async()=>{
 const h=harness();h.context.location=new URL('http://localhost:3000/dashboard/calendar');h.run(`state.subscriptions=${JSON.stringify([h.sample('a','Netflix')])};state.calendarDate=new Date(2026,1,1)`);await h.run('render()');h.document.querySelector('[data-calendar-day="15"]').click();assert.match(h.document.querySelector('[role="dialog"]').textContent,/15 Feb 2026/);
});
test('annual and weekly review savings are normalized to monthly',async()=>{
 const h=harness();h.context.location=new URL('http://localhost:3000/dashboard/insights');h.run(`state.pro=true;state.subscriptions=${JSON.stringify([{...h.sample('a','Yearly service','Yearly'),price:120},{...h.sample('b','Weekly service','Weekly'),price:3}])}`);await h.run('render()');assert.equal(h.document.querySelectorAll('.insight-stat strong')[1].textContent,'€23.00');
});

test('conflict dismissal preserves the actual edit form and its listeners',async()=>{const h=harness();h.run("subscriptionFormModal('custom')");const field=h.document.querySelector('#modal-root input[name="name"]')||h.document.querySelector('#modal-root input');field.value='Unsaved draft';h.run('confirmRefresh()');h.document.querySelector('[data-keep-editing]').click();assert.equal(field.isConnected,true);assert.equal(field.value,'Unsaved draft');h.run('confirmRefresh();closeModal()');assert.equal(field.isConnected,true);});

test('paid offer uses configured price IDs and has no free entitlement toggle',async()=>{const h=harness();h.run("state.plans=[{id:'price_month',amount:499,interval:'month',intervalCount:1}];proModal()");assert.equal(h.document.querySelector('[data-checkout]').dataset.checkout,'price_month');assert.equal(h.document.querySelector('[data-demo-pro]'),null);h.run("acceptAccount({version:1,subscriptions:[],settings:state.settings,proPreview:true,pro:false})");assert.equal(h.run('state.pro'),false);});

test('compact form never invents a price or next charge; search carries custom names',async()=>{const h=harness();h.run("subscriptionFormModal('netflix')");assert.equal(h.document.querySelector('[name="price"]').value,'');assert.equal(h.document.querySelector('[name="renewalDate"]').value,'');assert.ok(h.document.querySelector('details input[name="customName"]'));assert.equal(h.document.querySelector('[name="category"]').hasAttribute('required'),false);h.run('closeModal();addSubscriptionModal()');const search=h.document.querySelector('[data-service-search]');search.value='My new service';search.dispatchEvent(new h.Event('input'));h.document.querySelector('[data-service-preset="custom"]').click();assert.equal(h.document.querySelector('[name="service"]').value,'My new service');});
test('incomplete drafts survive modal dismissal and stay isolated by account',async()=>{const h=harness();h.run("subscriptionFormModal('custom')");const name=h.document.querySelector('[name="service"]');name.value='Draft service';name.dispatchEvent(new h.Event('input',{bubbles:true}));h.run('closeModal()');await h.run('render()');h.document.querySelector('[data-resume-draft]').click();assert.equal(h.document.querySelector('[name="service"]').value,'Draft service');assert.equal(h.document.querySelector('[name="renewalDate"]').value,'');assert.equal(h.calls.filter(c=>c.url==='/api/data'&&c.method==='PUT').length,0);h.run('closeModal();state.user.id=2');await h.run('render()');assert.equal(h.document.querySelector('[data-resume-draft]'),null);});
test('first-run dashboard gives one clear task instead of empty charts',async()=>{const h=harness();await h.run('render()');assert.equal(h.document.querySelector('.spending-chart'),null);assert.ok(h.document.querySelector('[data-add-sub]'));assert.equal(h.document.querySelector('progress').getAttribute('value'),'0');});
test('exact subscription link opens record and survives authentication redirect',async()=>{const h=harness();h.run(`state.subscriptions=${JSON.stringify([h.sample('abc','Linked service')])}`);h.context.location=new URL('http://localhost:3000/dashboard/subscriptions?subscription=abc');await h.run('render()');assert.match(h.document.querySelector('[role="dialog"]').textContent,/Linked service/);h.run('state.user=null');h.context.location=new URL('http://localhost:3000/dashboard/subscriptions?subscription=abc');await h.run('render()');assert.equal(h.context.location.searchParams.get('next'),'/dashboard/subscriptions?subscription=abc');});
test('confirmed archive stops tracking, persists record and permits restore',async()=>{const h=harness();h.run(`state.subscriptions=${JSON.stringify([h.sample('archive-me','Archived service')])};reviewNext()`);h.document.querySelector('[data-review-cancel]').click();assert.equal(h.calls.filter(c=>c.method==='PUT').length,0);h.document.querySelector('[data-confirm-archive]').click();await h.tick();await h.tick();assert.equal(h.data().subscriptions.length,0);assert.equal(h.data().archived[0].uid,'archive-me');h.run('archiveModal()');h.document.querySelector('[data-restore]').click();await h.tick();await h.tick();assert.equal(h.data().subscriptions[0].uid,'archive-me');assert.equal(h.data().archived.length,0);});
const choose=(select,value)=>{for(const o of select.options)o.toggleAttribute('selected',o.value===value);};
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
const txSample=()=>({loaded:true,error:'',accounts:[{id:'acc1',name:'Main'},{id:'acc2',name:'Card'}],imports:[],
 series:[{seriesKey:'netflix|EUR',merchant:'Netflix',currency:'EUR',cycle:'Monthly',amount:13.99,count:3,lastDate:'2026-08-09',nextDate:'2026-09-09',category:'Entertainment',status:'possible'}],
 transactions:[{id:'t1',accountId:'acc1',date:'2026-08-01',description:'LIDL SOFIA',merchant:'Lidl',merchantKey:'lidl',amount:-20,currency:'EUR',kind:'expense',category:'Food & groceries'},
  {id:'t2',accountId:'acc1',date:'2026-08-09',description:'NETFLIX.COM',merchant:'Netflix',merchantKey:'netflix',amount:-13.99,currency:'EUR',kind:'expense',category:'Entertainment'},
  {id:'t3',accountId:'acc1',date:'2026-08-10',description:'LIDL refund',merchant:'Lidl',merchantKey:'lidl',amount:5,currency:'EUR',kind:'refund',category:'Food & groceries'},
  {id:'t4',accountId:'acc1',date:'2026-08-15',description:'Salary',merchant:'Salary',merchantKey:'salary',amount:1000,currency:'EUR',kind:'income',category:null},
  {id:'t5',accountId:'acc1',date:'2026-08-16',description:'To savings',merchant:'Savings',merchantKey:'savings',amount:-200,currency:'EUR',kind:'transfer',category:null},
  {id:'t6',accountId:'acc2',date:'2026-08-20',description:'Amazon US',merchant:'Amazon',merchantKey:'amazon',amount:-30,currency:'USD',kind:'expense',category:'Shopping'}]});
test('transactions tab keeps currencies apart, excludes income and transfers, and filters',async()=>{
 const h=harness();h.context.location=new URL('http://localhost:3000/dashboard/transactions');h.run(`state.tx=${JSON.stringify(txSample())}`);await h.run('render()');
 const spending=c=>h.document.querySelector(`[data-tx-currency="${c}"] [data-tx-spending]`)?.textContent;
 assert.equal(spending('EUR'),'€28.99');assert.ok(spending('USD'));assert.equal(h.document.querySelectorAll('[data-tx]').length,6);
 assert.match(h.document.querySelector('[data-tx="t2"]').textContent,/Possible subscription/);
 const filters=()=>h.document.querySelector('[data-tx-filters]'),set=(name,value)=>{const el=filters().querySelector(`[name="${name}"]`);if(el.tagName==='SELECT')choose(el,value);else el.value=value;el.dispatchEvent(new h.Event('change',{bubbles:true}));};
 set('category','Food & groceries');assert.equal(spending('EUR'),'€15.00');assert.equal(h.document.querySelectorAll('[data-tx]').length,2);
 set('category','');set('account','acc2');assert.equal(spending('EUR'),undefined);assert.equal(h.document.querySelectorAll('[data-tx]').length,1);
 set('account','');set('from','2026-08-10');assert.equal(h.document.querySelectorAll('[data-tx]').length,4);assert.equal(h.run('state.txFilters.period'),'custom');
 h.document.querySelector('[data-tx-view="review"]').click();await h.tick();assert.match(h.document.querySelector('.tx-review').textContent,/Netflix/);
 h.context.location=new URL('http://localhost:3000/dashboard/subscriptions');await h.run('render()');assert.equal(h.context.location.pathname,'/dashboard/transactions');assert.ok(h.document.querySelector('[data-sub-filter]'));
});
test('import wizard reads the CSV, explains invalid rows and sends reviewed choices',async()=>{
 const h=harness();h.run(`state.tx=${JSON.stringify({...txSample(),accounts:[]})};importStatementModal()`);
 h.document.querySelector('[data-import-form] [name="accountName"]').value='Main';
 h.context.csvBytes=new TextEncoder().encode('Date,Description,Amount,Currency\n2026-06-01,NETFLIX.COM,-13.99,EUR\n2026-06-02,Coffee,abc,EUR\n2026-06-03,Salary ACME,1500,EUR');
 await h.run(`handleStatementFile(document.querySelector('[data-import-form]'),{name:'june.csv',size:csvBytes.length,arrayBuffer:async()=>csvBytes.buffer})`);await settle();
 const dialog=h.document.querySelector('[role="dialog"]');assert.match(dialog.textContent,/Review import/);assert.match(dialog.querySelector('[data-invalid-row]').textContent,/Invalid amount/);
 const kind=dialog.querySelector('[data-row-kind="1"]');choose(kind,'transfer');kind.dispatchEvent(new h.Event('change'));
 const include=dialog.querySelector('[data-row-include="0"]');include.checked=false;include.dispatchEvent(new h.Event('change'));
 dialog.querySelector('[data-confirm-import]').click();await settle();
 const sent=h.txImports[0];assert.equal(sent.accountName,'Main');assert.deepEqual(sent.rows.map(r=>[r.include,r.kind,r.category]),[[false,'expense','Entertainment'],[true,'transfer',null]]);
});
