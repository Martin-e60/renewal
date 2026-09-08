import Stripe from 'stripe';
import crypto from 'node:crypto';
import {annualAmount,monthRenewals,dateKey,dayDifference} from '../public/assets/dates.js';

export function createBilling({db,appOrigin,json,getCurrentUser,readBody,rateLimited}){
 const env=process.env,priceIds=[...new Set([env.STRIPE_PRICE_MONTHLY,env.STRIPE_PRICE_YEARLY,env.STRIPE_PRICE_ID].filter(Boolean))];
 const ready=!!(env.STRIPE_SECRET_KEY&&env.STRIPE_WEBHOOK_SECRET&&priceIds.length);
 const options={maxNetworkRetries:1,timeout:12000};
 // Only local test fixtures may replace the Stripe API host.
 if(env.STRIPE_TEST_API_BASE){const u=new URL(env.STRIPE_TEST_API_BASE);if(env.NODE_ENV!=='test'||!['127.0.0.1','localhost'].includes(u.hostname))throw Error('Stripe test API override is restricted to local tests.');Object.assign(options,{host:u.hostname,port:Number(u.port)||80,protocol:u.protocol.slice(0,-1),maxNetworkRetries:0});}
 const stripe=env.STRIPE_SECRET_KEY?new Stripe(env.STRIPE_SECRET_KEY,options):null;
 db.exec(`CREATE TABLE IF NOT EXISTS billing_accounts(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,customer_id TEXT UNIQUE NOT NULL,subscription_id TEXT,status TEXT NOT NULL DEFAULT 'none',period_end INTEGER NOT NULL DEFAULT 0,cancel_at_end INTEGER NOT NULL DEFAULT 0,synced_at INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS billing_checkouts(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,session_id TEXT NOT NULL,url TEXT,price_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS billing_events(event_id TEXT PRIMARY KEY,processed_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS billing_locks(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,owner TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
 db.exec('CREATE TABLE IF NOT EXISTS installation(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 db.prepare('INSERT OR IGNORE INTO installation VALUES(?,?)').run('billing_id',crypto.randomUUID());
 const installationId=db.prepare('SELECT value FROM installation WHERE key=?').get('billing_id').value;
 const row=id=>db.prepare('SELECT * FROM billing_accounts WHERE user_id=?').get(id);
 function summary(id){const b=row(id),pro=!!b&&['active','trialing'].includes(b.status)&&b.period_end>Date.now()/1000;return {ready,pro,status:b?.status||'free',periodEnd:b?.period_end||null,cancelAtPeriodEnd:!!b?.cancel_at_end,hasCustomer:!!b,testMode:!!env.STRIPE_SECRET_KEY?.startsWith('sk_test_')};}
 async function lock(id,fn){const owner=crypto.randomUUID(),now=Date.now();db.prepare('DELETE FROM billing_locks WHERE expires_at<?').run(now);try{db.prepare('INSERT INTO billing_locks(user_id,owner,expires_at) VALUES(?,?,?)').run(id,owner,now+180000);}catch{const e=Error('Another billing action is in progress. Try again shortly.');e.status=409;throw e;}
  try{return await fn();}finally{db.prepare('DELETE FROM billing_locks WHERE user_id=? AND owner=?').run(id,owner);}}
 let priceCache=null;
 async function plans(){if(!ready)return {ready:false,plans:[]};if(priceCache&&priceCache.expires>Date.now())return priceCache.value;
  const prices=await Promise.all(priceIds.map(id=>stripe.prices.retrieve(id)));
  const plans=prices.filter(p=>p.active&&p.type==='recurring'&&p.recurring?.usage_type!=='metered'&&p.billing_scheme==='per_unit'&&p.currency==='eur'&&p.unit_amount!==null).map(p=>({id:p.id,amount:p.unit_amount,currency:p.currency,interval:p.recurring.interval,intervalCount:p.recurring.interval_count,taxBehavior:p.tax_behavior}));
  const value={ready:plans.length>0,plans,testMode:env.STRIPE_SECRET_KEY.startsWith('sk_test_')};priceCache={value,expires:Date.now()+60000};return value;
 }
 async function allSubscriptions(customer){return stripe.subscriptions.list({customer,status:'all',limit:100}).autoPagingToArray({limit:1000});}
 async function synchronize(id){const b=row(id);if(!b||!stripe)return summary(id);
  const all=await allSubscriptions(b.customer_id);
  const relevant=all.filter(s=>s.items?.data?.some(i=>priceIds.includes(i.price?.id)));
  const rank=s=>['active','trialing'].includes(s.status)?3:!['canceled','incomplete_expired'].includes(s.status)?2:1;
  const sub=relevant.sort((a,b)=>rank(b)-rank(a)||b.created-a.created)[0];
  const period=sub?Math.max(sub.current_period_end||0,...(sub.items?.data||[]).map(i=>i.current_period_end||0),sub.trial_end||0):0;
  db.prepare('UPDATE billing_accounts SET subscription_id=?,status=?,period_end=?,cancel_at_end=?,synced_at=? WHERE user_id=?').run(sub?.id||null,sub?.status||'none',period,sub?.cancel_at_period_end?1:0,Date.now(),id);
  return summary(id);
 }
 async function ensureCustomer(user){let b=row(user.id);if(b)return b.customer_id;
  const customer=await stripe.customers.create({email:user.email,name:user.name,metadata:{renewalradar_user_id:String(user.id)}},{idempotencyKey:`rr-customer-${installationId}-${user.id}`});
  db.prepare('INSERT INTO billing_accounts(user_id,customer_id) VALUES(?,?)').run(user.id,customer.id);return customer.id;
 }
 async function checkout(user,body){return lock(user.id,async()=>{
  if(!ready){const e=Error('Payments are not configured yet.');e.status=503;throw e;}
  const available=await plans();if(!available.plans.some(p=>p.id===body.priceId))throw Error('Choose an available plan.');
  const customer=await ensureCustomer(user);
  const subs=await allSubscriptions(customer);
  if(subs.some(s=>!['canceled','incomplete_expired'].includes(s.status))){await synchronize(user.id);const e=Error('You already have a subscription. Use Manage billing.');e.status=409;throw e;}
  const pending=db.prepare('SELECT * FROM billing_checkouts WHERE user_id=?').get(user.id);
  if(pending&&pending.expires_at>Date.now()/1000){const existing=await stripe.checkout.sessions.retrieve(pending.session_id);
   if(existing.status==='open'&&pending.price_id===body.priceId)return {url:existing.url};
   if(existing.status==='open')await stripe.checkout.sessions.expire(existing.id);
   if(existing.status==='complete'){await synchronize(user.id);const e=Error('Your payment is being confirmed. Refresh billing status.');e.status=409;throw e;}
  }
  await stripe.customers.update(customer,{email:user.email,name:user.name});
  const session=await stripe.checkout.sessions.create({mode:'subscription',customer,client_reference_id:String(user.id),line_items:[{price:body.priceId,quantity:1}],success_url:`${appOrigin}/dashboard/settings?checkout=success`,cancel_url:`${appOrigin}/dashboard/settings?checkout=canceled`,subscription_data:{metadata:{renewalradar_user_id:String(user.id)}},metadata:{renewalradar_user_id:String(user.id)},locale:['en','de','es'].includes(body.lang)?body.lang:'auto',billing_address_collection:'required',automatic_tax:{enabled:env.STRIPE_AUTOMATIC_TAX==='true'},tax_id_collection:{enabled:true},expires_at:Math.floor(Date.now()/1000)+1800},{idempotencyKey:`rr-checkout-${installationId}-${user.id}-${body.priceId}-${pending?.session_id||'initial'}-${Math.floor(Date.now()/1800000)}`});
  db.prepare('INSERT INTO billing_checkouts(user_id,session_id,url,price_id,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id,url=excluded.url,price_id=excluded.price_id,expires_at=excluded.expires_at').run(user.id,session.id,session.url,body.priceId,session.expires_at);
  return {url:session.url};
 });}
 async function webhook(req,res){if(req.method!=='POST'){json(res,405,{error:'Method not allowed.'});return;}if(!ready){json(res,503,{error:'Payments are not configured yet.'});return;}
  let event;try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1000000)throw Error('Webhook too large');chunks.push(chunk);}event=stripe.webhooks.constructEvent(Buffer.concat(chunks),req.headers['stripe-signature'],env.STRIPE_WEBHOOK_SECRET,300);}catch{json(res,400,{error:'Invalid webhook signature or body.'});return;}
  if(event.livemode!==env.STRIPE_SECRET_KEY.startsWith('sk_live_')){json(res,400,{error:'Webhook mode does not match this installation.'});return;}
  if(db.prepare('SELECT 1 FROM billing_events WHERE event_id=?').get(event.id)){json(res,200,{received:true});return;}
  try{
   if(event.type.startsWith('customer.subscription.')||event.type.startsWith('checkout.session.')||['invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.voided'].includes(event.type)){
    const customer=typeof event.data.object.customer==='string'?event.data.object.customer:event.data.object.customer?.id;
    const b=db.prepare('SELECT user_id FROM billing_accounts WHERE customer_id=?').get(customer||'');
    if(b)await lock(b.user_id,()=>synchronize(b.user_id));
   }
   db.prepare('INSERT OR IGNORE INTO billing_events(event_id,processed_at) VALUES(?,?)').run(event.id,Date.now());json(res,200,{received:true});
  }catch{json(res,503,{error:'Billing update will be retried.'});}
 }
 async function deleteAccount(id,removeLocal){return lock(id,async()=>{
  const b=row(id);if(b){if(!stripe)throw Error('Billing is unavailable. Account deletion cannot continue until subscriptions can be canceled.');
   const sessions=await stripe.checkout.sessions.list({customer:b.customer_id,status:'open',limit:100}).autoPagingToArray({limit:1000});
   for(const s of sessions)await stripe.checkout.sessions.expire(s.id);
   const subscriptions=await allSubscriptions(b.customer_id);for(const s of subscriptions)if(!['canceled','incomplete_expired'].includes(s.status))await stripe.subscriptions.cancel(s.id,{invoice_now:false,prorate:false});
  }
  removeLocal();
 });}
 async function updateEmail(id,email,name){const b=row(id);if(!b)return;if(!stripe)throw Error('Billing is temporarily unavailable. Try again later.');await stripe.customers.update(b.customer_id,{email,name});}
 async function handle(req,res,url){if(!url.pathname.startsWith('/api/billing/')&&!url.pathname.startsWith('/api/pro/'))return false;
  try{
   if(url.pathname==='/api/billing/plans'&&req.method==='GET'){json(res,200,await plans());return true;}
   const user=getCurrentUser(req);if(!user){json(res,401,{error:'You need to be signed in.'});return true;}
   if(url.pathname==='/api/billing/status'&&req.method==='GET'){json(res,200,summary(user.id));return true;}
   if(url.pathname.startsWith('/api/pro/')&&req.method==='GET'){
    if(!summary(user.id).pro){json(res,403,{error:'An active Pro subscription is required.'});return true;}
    const stored=db.prepare('SELECT payload FROM account_data WHERE user_id=?').get(user.id),data=stored?JSON.parse(stored.payload):{subscriptions:[],settings:{timeZone:'Europe/Sofia'}};
    const today=dateKey(new Date(),data.settings.timeZone),items=data.subscriptions;
    if(url.pathname==='/api/pro/price-changes'){json(res,200,{changes:items.flatMap(s=>(s.priceHistory||[]).map(h=>({s,h}))).sort((a,b)=>b.h.date.localeCompare(a.h.date))});return true;}
    if(url.pathname==='/api/pro/insights'){
     const year=Number(url.searchParams.get('year')||today.slice(0,4));if(!Number.isInteger(year)||year<1900||year>9998)throw Error('Invalid year.');
     const categories={};items.forEach(s=>categories[s.category]=(categories[s.category]||0)+annualAmount(s));
     const annual=Object.values(categories).reduce((a,b)=>a+b,0),top=Object.entries(categories).sort((a,b)=>b[1]-a[1])[0]||null;
     const monthlySavings=items.filter(s=>s.lastUsedDate&&dayDifference(today,s.lastUsedDate)>=30&&(!s.lastReviewedDate||dayDifference(today,s.lastReviewedDate)>=30)).reduce((sum,s)=>sum+annualAmount(s)/12,0);
     const monthly=Array.from({length:12},(_,month)=>items.reduce((sum,s)=>sum+monthRenewals(s,year,month).length*Math.round(s.price*100),0)/100);
     json(res,200,{annual,top,monthlySavings,monthly,year});return true;
    }
   }
   if(req.method!=='POST'){json(res,404,{error:'Not found.'});return true;}
   if(rateLimited(`billing:${user.id}`,30)){json(res,429,{error:'Too many requests. Try again later.'});return true;}
   const body=await readBody(req,user.id);
   if(url.pathname==='/api/billing/checkout'){json(res,200,await checkout(user,body));return true;}
   if(url.pathname==='/api/billing/refresh'){if(!ready)throw Error('Payments are not configured yet.');json(res,200,await lock(user.id,()=>synchronize(user.id)));return true;}
   if(url.pathname==='/api/billing/portal'){
    const b=row(user.id);if(!stripe||!b)throw Error('There is no billing account to manage.');
    const portal=await stripe.billingPortal.sessions.create({customer:b.customer_id,return_url:`${appOrigin}/dashboard/settings?billing=returned`,locale:['en','de','es'].includes(body.lang)?body.lang:'auto',...(env.STRIPE_PORTAL_CONFIGURATION?{configuration:env.STRIPE_PORTAL_CONFIGURATION}:{})});json(res,200,{url:portal.url});return true;
   }
   json(res,404,{error:'Not found.'});return true;
  }catch(e){const provider=String(e.type||'').startsWith('Stripe');json(res,e.status|| (provider?502:400),{error:provider?'Billing is temporarily unavailable. Try again later.':e.message});return true;}
 }
 // Reconcile even if a webhook was missed. Access also expires at period_end locally.
 let reconciling=false;
 const interval=setInterval(async()=>{if(!ready||reconciling)return;reconciling=true;try{for(const b of db.prepare('SELECT user_id FROM billing_accounts').all()){try{await lock(b.user_id,()=>synchronize(b.user_id));}catch{}}}finally{reconciling=false;}},300000);interval.unref();
 return {ready,summary,handle,webhook,deleteAccount,updateEmail};
}
