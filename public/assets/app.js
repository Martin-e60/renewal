import {translateText} from './locales.js';
import {dateKey, validDate, addDays, dayDifference, nextRenewal, monthRenewals, annualAmount} from './dates.js';
const browserStore={getItem(key){try{return localStorage.getItem(key);}catch{return null;}},setItem(key,value){try{localStorage.setItem(key,value);}catch{}},removeItem(key){try{localStorage.removeItem(key);}catch{}}};
const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');

const SERVICE_PRESETS = [
  { id:'netflix', name:'Netflix', color:'#E50914', category:'Entertainment', price:13.99, cycle:'Monthly', day:10, logo:'N' },
  { id:'spotify', name:'Spotify', color:'#1ED760', category:'Entertainment', price:10.99, cycle:'Monthly', day:19, logo:'spotify' },
  { id:'adobe', name:'Adobe Creative Cloud', color:'#FA0F00', category:'Software & Tools', price:36.29, cycle:'Monthly', day:8, logo:'A' },
  { id:'google', name:'Google One', color:'#4285F4', category:'Cloud & Storage', price:1.99, cycle:'Monthly', day:24, logo:'G' },
  { id:'notion', name:'Notion', color:'#111111', category:'Software & Tools', price:4.00, cycle:'Monthly', day:28, logo:'N' },
  { id:'microsoft', name:'Microsoft 365', color:'#F25022', category:'Software & Tools', price:9.99, cycle:'Monthly', day:17, logo:'M' },
  { id:'prime', name:'Amazon Prime', color:'#00A8E1', category:'Entertainment', price:8.99, cycle:'Monthly', day:22, logo:'P' },
  { id:'youtube', name:'YouTube Premium', color:'#FF0000', category:'Entertainment', price:11.99, cycle:'Monthly', day:26, logo:'▶' },
  { id:'disney', name:'Disney+', color:'#113CCF', category:'Entertainment', price:9.99, cycle:'Monthly', day:30, logo:'D+' }
];

const DEFAULT_SUBSCRIPTIONS = SERVICE_PRESETS.slice(0,5).map((s, i)=>({
  ...s,
  uid:`demo-${i}`,
  customName:'',
  status:i===2?'due':'active',
  lastUsedDays:i===4?37:(i===1?5:(i===0?2:12)),
  previousPrice:i===2?31.49:s.price,
  renewalDate:nextDateForDay(s.day).toISOString()
}));

const i18n = {
  en:{
    home:'Home', subscriptions:'Subscriptions', calendar:'Calendar', insights:'Insights', priceChanges:'Price changes', unused:'Unused subscriptions', documents:'Documents', settings:'Settings',
    addSubscription:'Add your subscription', upgrade:'Upgrade to Pro', search:'Search subscriptions…', greeting:'Good morning', upcomingMonth:'Upcoming this month', renewalsMonth:'Remaining renewals this month', yearlyTotal:'Annualized cost', unusedCount:'Unused subscriptions', upcomingRenewals:'Upcoming renewals', spendingOverview:'Spending overview', renewalRadar:'Your Renewal Radar', radarDesc:'A visual view of upcoming payments.', dueSoon:'Due soon', thisMonth:'Next 30 days', later:'Later', proTip:'Pro tip', reviewTip:'Review tip', goPro:'Go Pro', locked:'Pro feature', current:'current', logout:'Log out', language:'Language', theme:'Theme', allClear:'All clear', save:'Save changes',
    pageSubscriptions:'All subscriptions', pageCalendar:'Renewal calendar', pageInsights:'Recurring cost insights', pagePrice:'Price changes', pageUnused:'Subscriptions worth reviewing', pageDocuments:'Documents', pageSettings:'Settings',
    proTitle:'Unlock deeper renewal intelligence', proCopy:'Insights and price-change tracking are available with RenewalRadar Pro.', previewPro:'Preview Pro offer',
  },
  de:{
    home:'Start', subscriptions:'Abos', calendar:'Kalender', insights:'Einblicke', priceChanges:'Preisänderungen', unused:'Ungenutzte Abos', documents:'Dokumente', settings:'Einstellungen',
    addSubscription:'Abo hinzufügen', upgrade:'Auf Pro upgraden', search:'Abos durchsuchen…', greeting:'Guten Morgen', upcomingMonth:'Diesen Monat fällig', renewalsMonth:'Verbleibende Verlängerungen', yearlyTotal:'Hochgerechnete Jahreskosten', unusedCount:'Ungenutzte Abos', upcomingRenewals:'Anstehende Verlängerungen', spendingOverview:'Ausgabenübersicht', renewalRadar:'Dein Renewal Radar', radarDesc:'Visuelle Übersicht deiner nächsten Zahlungen.', dueSoon:'Bald fällig', thisMonth:'Nächste 30 Tage', later:'Später', proTip:'Pro-Tipp', reviewTip:'Tipp ansehen', goPro:'Pro holen', locked:'Pro-Funktion', current:'aktuell', logout:'Abmelden', language:'Sprache', theme:'Darstellung', allClear:'Alles klar', save:'Änderungen speichern',
    pageSubscriptions:'Alle Abos', pageCalendar:'Verlängerungskalender', pageInsights:'Kosten-Einblicke', pagePrice:'Preisänderungen', pageUnused:'Abos zum Prüfen', pageDocuments:'Dokumente', pageSettings:'Einstellungen',
    proTitle:'Mehr Kontrolle über Verlängerungen', proCopy:'Einblicke und Preisänderungen sind mit RenewalRadar Pro verfügbar.', previewPro:'Pro-Angebot ansehen',
  },
  es:{
    home:'Inicio', subscriptions:'Suscripciones', calendar:'Calendario', insights:'Estadísticas', priceChanges:'Cambios de precio', unused:'Suscripciones sin uso', documents:'Documentos', settings:'Ajustes',
    addSubscription:'Añadir suscripción', upgrade:'Mejorar a Pro', search:'Buscar suscripciones…', greeting:'Buenos días', upcomingMonth:'Próximos este mes', renewalsMonth:'Renovaciones restantes este mes', yearlyTotal:'Coste anualizado', unusedCount:'Suscripciones sin uso', upcomingRenewals:'Próximas renovaciones', spendingOverview:'Resumen de gastos', renewalRadar:'Tu Renewal Radar', radarDesc:'Vista visual de tus próximos pagos.', dueSoon:'Próximo', thisMonth:'Próximos 30 días', later:'Más tarde', proTip:'Consejo Pro', reviewTip:'Revisar consejo', goPro:'Obtener Pro', locked:'Función Pro', current:'actual', logout:'Cerrar sesión', language:'Idioma', theme:'Tema', allClear:'Todo en orden', save:'Guardar cambios',
    pageSubscriptions:'Todas las suscripciones', pageCalendar:'Calendario de renovaciones', pageInsights:'Estadísticas de gastos', pagePrice:'Cambios de precio', pageUnused:'Suscripciones para revisar', pageDocuments:'Documentos', pageSettings:'Ajustes',
    proTitle:'Desbloquea información avanzada', proCopy:'Las estadísticas y cambios de precio están disponibles con RenewalRadar Pro.', previewPro:'Ver oferta Pro',
  }
};

const state = {
  user:null,
  meta:{contactEmail:'hello@renewalradar.example'},
  lang:browserStore.getItem('rr_lang') || 'en',
  theme:browserStore.getItem('rr_theme') || 'light',
  pro:false,
  billing:{},
  plans:[],
  subscriptions:[],
  documents:[],
  version:0,
  settings:{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,reminderDays:3,emailReminders:false,emailVerified:false},
  chartYear:new Date().getFullYear(),
  dataError:'',
  networkError:'',
  remotePending:false,
  syncing:false,
  mutations:0,
  calendarDate:new Date(),
  dashboardQuery:'',
  subscriptionFilter:'All',
};

const routes = new Set([
  '/', '/pricing', '/contact', '/privacy', '/terms', '/cookies',
  '/login', '/register', '/forgot-password', '/reset-password',
  '/dashboard','/dashboard/subscriptions','/dashboard/calendar','/dashboard/insights',
  '/dashboard/price-changes','/dashboard/unused','/dashboard/documents','/dashboard/settings'
]);

const pageMeta = {
  '/':['RenewalRadar — See what’s coming before you’re charged','Track subscriptions, renewals and recurring payments before they charge you.'],
  '/pricing':['Pricing — RenewalRadar','Simple plans for staying ahead of subscriptions and renewals.'],
  '/contact':['Contact — RenewalRadar','Contact the RenewalRadar team.'],
  '/privacy':['Privacy Policy — RenewalRadar','How RenewalRadar handles account and website data.'],
  '/terms':['Terms of Service — RenewalRadar','Terms governing use of RenewalRadar.'],
  '/cookies':['Cookie Policy — RenewalRadar','How RenewalRadar uses essential and optional cookies.'],
  '/login':['Log in — RenewalRadar','Log in to your RenewalRadar account.'],
  '/register':['Create account — RenewalRadar','Create your RenewalRadar account.'],
  '/forgot-password':['Forgot password — RenewalRadar','Request a password reset link.'],
  '/reset-password':['Reset password — RenewalRadar','Choose a new RenewalRadar password.'],
};

function nextDateForDay(day){
  const now=new Date(),last=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  let key=dateKey(new Date(now.getFullYear(),now.getMonth(),Math.min(day,last)));
  if(key<dateKey(now))key=dateKey(new Date(now.getFullYear(),now.getMonth()+1,Math.min(day,new Date(now.getFullYear(),now.getMonth()+2,0).getDate())));
  return new Date(key+'T12:00:00');
}
function today(){return dateKey(new Date(),state.settings.timeZone);}
function localDate(key){return new Date(key+'T12:00:00');}
function userStorageKey(base){return `${base}:${state.user?.id || 'guest'}`;}
function storageJson(key,fallback=[]){try{return JSON.parse(browserStore.getItem(userStorageKey(key)))??fallback;}catch{return fallback;}}
function acceptAccount(data){if(data.accountId!==undefined&&data.accountId!==state.user?.id){clearIdentity();throw Error('Your session changed. Sign in again.');}state.version=data.version;state.subscriptions=data.subscriptions;state.settings=data.settings;state.pro=!!data.pro;state.billing=data.billing||{};state.dataError='';state.networkError='';state.remotePending=false;}
async function loadUserLocalState(){
  state.dashboardQuery='';state.subscriptionFilter='All';state.tipDismissed=0;
  if(!state.user){state.subscriptions=[];state.documents=[];state.pro=false;return;}
  const accountId=state.user.id;
  try{const [data,docs]=await Promise.all([api('/api/data'),api('/api/documents')]);if(state.user?.id!==accountId)return;acceptAccount(data);state.documents=docs.documents;}
  catch(e){if(state.user?.id===accountId){state.dataError=e.message;state.subscriptions=[];state.documents=[];}}
}
async function saveAccount(subscriptions=state.subscriptions,settings=state.settings,proPreview=state.pro){
  if(state.dataError)throw Error('Reload your account before saving.');
  const data=await api('/api/data',{method:'PUT',body:JSON.stringify({version:state.version,subscriptions,settings,proPreview})});acceptAccount(data);
}
function t(key){return i18n[state.lang]?.[key]||i18n.en[key]||key;}
function esc(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function locale(){return state.lang==='de'?'de-DE':state.lang==='es'?'es-ES':'en-GB';}
function money(v){return new Intl.NumberFormat(locale(),{style:'currency',currency:'EUR'}).format(Number(v)||0);}
function cycleLabel(cycle){return translateText(cycle,state.lang);}
function savePreference(key,value){if(browserStore.getItem('rr_cookie_choice')==='accept')browserStore.setItem(key,value);}
function cycleMultiplier(cycle='Monthly'){return cycle==='Yearly'?1:cycle==='Weekly'?52:12;}
function nextOccurrenceDate(s,from=today()){return localDate(nextRenewal(s,typeof from==='string'?from:dateKey(from,state.settings.timeZone)));}
function daysUntilSubscription(s){return dayDifference(nextRenewal(s,today()),today());}
function occurrencesInMonth(s,year,month){return monthRenewals(s,year,month).map(localDate);}
function annualValue(s){return annualAmount(s);}
function totalAnnual(){return state.subscriptions.reduce((n,s)=>n+Math.round(annualValue(s)*100),0)/100;}
function renewalOccurrencesThisMonth(){const now=localDate(today());return state.subscriptions.flatMap(s=>monthRenewals(s,now.getFullYear(),now.getMonth()).filter(d=>d>=today()).map(date=>({s,date})));}
function renewalCountThisMonth(){return renewalOccurrencesThisMonth().length;}
function totalThisMonth(){return renewalOccurrencesThisMonth().reduce((n,{s})=>n+Math.round(s.price*100),0)/100;}
function initials(){return (state.user?.name||'M').split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();}
function lastUsedDays(s){return s.lastUsedDate?Math.max(0,dayDifference(today(),s.lastUsedDate)):null;}
function needsReview(s){return lastUsedDays(s)!==null&&lastUsedDays(s)>=30&&(!s.lastReviewedDate||dayDifference(today(),s.lastReviewedDate)>=30);}
function displayName(s){return s.name+(s.customName?' · '+s.customName:'');}
function relativeDay(key){const days=dayDifference(key,today());return new Intl.RelativeTimeFormat(locale(),{numeric:'auto'}).format(days,'day');}
function monthlyProjection(year,month){return state.subscriptions.reduce((sum,s)=>sum+monthRenewals(s,year,month).length*Math.round(s.price*100),0)/100;}

function applyTheme(){document.documentElement.dataset.theme=state.theme;document.documentElement.lang=state.lang;}

function svgIcon(name, size=20){
  const paths={
    home:'<path d="M3 10.8 10 4l7 6.8v7.2a1 1 0 0 1-1 1h-4.2v-5.5H8.2V19H4a1 1 0 0 1-1-1z"/>',
    subscriptions:'<rect x="3" y="5" width="14" height="12" rx="2"/><path d="M6 9h8M6 13h5"/>',
    calendar:'<rect x="3" y="4" width="14" height="14" rx="2"/><path d="M6 2v4M14 2v4M3 8h14"/>',
    insights:'<path d="M4 17V9M10 17V4M16 17v-6"/>',
    price:'<path d="M11 2 5 11h5l-1 7 6-9h-5z"/>',
    unused:'<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',
    docs:'<path d="M5 2h7l4 4v12H5z"/><path d="M12 2v5h5M8 11h5M8 14h5"/>',
    settings:'<circle cx="10" cy="10" r="3"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4"/>',
    bell:'<path d="M5 14h10l-1.3-2V8a3.7 3.7 0 0 0-7.4 0v4zM8.5 16a1.6 1.6 0 0 0 3 0"/>',
    moon:'<path d="M15.5 13.8A6.8 6.8 0 0 1 6.2 4.5 7 7 0 1 0 15.5 13.8z"/>',
    sun:'<circle cx="10" cy="10" r="3"/><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.6 3.6l1.4 1.4M15 15l1.4 1.4M16.4 3.6 15 5M5 15l-1.4 1.4"/>',
    globe:'<circle cx="10" cy="10" r="8"/><path d="M2 10h16M10 2a13 13 0 0 1 0 16M10 2a13 13 0 0 0 0 16"/>',
    plus:'<path d="M10 4v12M4 10h12"/>',
    arrow:'<path d="M4 10h12M12 6l4 4-4 4"/>',
    lock:'<rect x="4" y="8" width="12" height="9" rx="2"/><path d="M7 8V6a3 3 0 0 1 6 0v2"/>',
    close:'<path d="m5 5 10 10M15 5 5 15"/>',
    chevron:'<path d="m7 5 5 5-5 5"/>',
    menu:'<path d="M3 5h14M3 10h14M3 15h14"/>',
    search:'<circle cx="9" cy="9" r="5"/><path d="m13 13 4 4"/>',
    upload:'<path d="M10 14V3M6 7l4-4 4 4M4 13v4h12v-4"/>',
    check:'<path d="m4 10 4 4 8-8"/>',
    trash:'<path d="M4 6h12M8 6V4h4v2M6 6l1 12h6l1-12"/>',
    edit:'<path d="m4 14-.7 3.7L7 17l9-9-3-3z"/><path d="m11 7 3 3"/>',
  };
  return `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.home}</svg>`;
}

function logo(){return `<a class="brand no-text-caret" href="/" data-link aria-label="RenewalRadar home"><img src="/assets/logo-mark.svg" alt=""><span>Renewal<b>Radar</b></span></a>`;}

function themeButton(){return `<button class="icon-btn no-text-caret" type="button" data-theme-toggle aria-label="Toggle theme">${svgIcon(state.theme==='dark'?'sun':'moon')}</button>`;}
function languageButton(){return `<div class="lang-wrap"><button class="icon-btn no-text-caret" type="button" data-lang-toggle aria-label="${t('language')}">${svgIcon('globe')}</button><div class="lang-menu" data-lang-menu><button data-lang="en">EN <span>English</span></button><button data-lang="de">DE <span>Deutsch</span></button><button data-lang="es">ES <span>Español</span></button></div></div>`;}

function publicHeader(active=''){
  return `<header class="site-header"><div class="container header-inner">${logo()}<nav class="nav" aria-label="Main navigation"><a href="/#features" data-link>Features</a><a href="/pricing" data-link class="${active==='pricing'?'active':''}">Pricing</a><a href="/contact" data-link class="${active==='contact'?'active':''}">Contact</a></nav><div class="header-actions">${themeButton()}${languageButton()}${state.user?`<a class="btn btn-ghost" href="/dashboard" data-link>Dashboard</a>`:`<a class="btn btn-ghost" href="/login" data-link>Log in</a>`}<a class="btn btn-primary desktop-cta" href="${state.user?'/dashboard':'/register'}" data-link>${state.user?'Open app':'Start for free'} ${svgIcon('arrow',17)}</a><button class="burger no-text-caret" type="button" aria-label="Open menu" data-mobile-menu>${svgIcon('menu',24)}</button></div></div><nav class="mobile-menu" data-mobile-panel><a href="/#features" data-link>Features</a><a href="/pricing" data-link>Pricing</a><a href="/contact" data-link>Contact</a><a href="${state.user?'/dashboard':'/login'}" data-link>${state.user?'Dashboard':'Log in'}</a>${state.user?'':'<a href="/register" data-link>Start for free</a>'}</nav></header>`;
}

function footer(){return `<footer class="footer"><div class="container footer-inner"><div class="footer-grid"><div>${logo()}<p>See what’s coming before you’re charged. Keep subscriptions and renewals visible, calm and under control.</p></div><div class="footer-col"><strong>Product</strong><a href="/#features" data-link>Features</a><a href="/pricing" data-link>Pricing</a><a href="/login" data-link>Log in</a></div><div class="footer-col"><strong>Company</strong><a href="/contact" data-link>Contact</a>${state.meta.contactEmail.endsWith('.example')?'':`<a href="mailto:${esc(state.meta.contactEmail)}">${esc(state.meta.contactEmail)}</a>`}</div><div class="footer-col"><strong>Legal</strong><a href="/privacy" data-link>Privacy</a><a href="/terms" data-link>Terms</a><a href="/cookies" data-link>Cookies</a></div></div><div class="footer-bottom"><span>© ${new Date().getFullYear()} RenewalRadar. ${state.lang==='de'?'Alle Rechte vorbehalten.':state.lang==='es'?'Todos los derechos reservados.':'All rights reserved.'}</span><span>Built to help you stay ahead of recurring costs.</span></div></div></footer>`;}

function landingPage(){return `${publicHeader()}<main><section class="hero"><div class="container hero-grid"><div><div class="eyebrow">Subscriptions • Renewals • A calmer you</div><h1>Your money, <span>on radar.</span></h1><p>RenewalRadar keeps your subscriptions, renewals and recurring payments in one clear place, so surprises stop being part of the billing cycle.</p><div class="hero-actions"><a class="btn btn-primary" href="/register" data-link>Start for free ${svgIcon('arrow',17)}</a><a class="btn btn-secondary" href="#features">See how it works</a></div><div class="hero-note">No bank connection required for the starter experience.</div></div><div class="hero-art"><div class="marketing-radar">${radarVisual(true)}</div><div class="float-card float-one"><strong>Netflix · €13.99</strong><small class="soon">${new Intl.RelativeTimeFormat(locale(),{numeric:'always'}).format(3,'day')}</small></div><div class="float-card float-two"><strong>Spotify · €10.99</strong><small>${new Intl.RelativeTimeFormat(locale(),{numeric:'always'}).format(12,'day')}</small></div></div></div></section><section class="section" id="features"><div class="container"><div class="section-title"><div class="eyebrow">Made for clarity</div><h2>Know what’s next, not what already happened.</h2><p>RenewalRadar is designed around upcoming costs and renewal decisions instead of another noisy expense dashboard.</p></div><div class="feature-grid"><article class="feature-card"><div class="feature-icon">◎</div><h3>Monthly Radar</h3><p>Upcoming renewals move closer to the center as their billing date approaches.</p></article><article class="feature-card"><div class="feature-icon">${svgIcon('calendar')}</div><h3>Renewal timeline</h3><p>Monthly, yearly and weekly renewal dates live in one understandable timeline.</p></article><article class="feature-card"><div class="feature-icon">${svgIcon('price')}</div><h3>Price awareness</h3><p>Record price changes and see their annual impact.</p></article><article class="feature-card"><div class="feature-icon">${svgIcon('unused')}</div><h3>Unused signals</h3><p>Review subscriptions that stopped earning their keep.</p></article><article class="feature-card"><div class="feature-icon">${svgIcon('lock')}</div><h3>Privacy-first start</h3><p>Start without granting access to your inbox or bank account.</p></article><article class="feature-card"><div class="feature-icon">${svgIcon('insights')}</div><h3>Clear spending</h3><p>Understand your recurring commitments without spreadsheet archaeology.</p></article></div></div></section><section class="section"><div class="container"><div class="dark-cta card"><div><div class="eyebrow">Less surprises. More freedom.</div><h2>See it. Control it. Keep more.</h2><p>Start with the account and dashboard today. Add integrations only when they genuinely earn their place.</p></div><a class="btn btn-primary" href="/register" data-link>Create your account ${svgIcon('arrow',17)}</a></div></div></section></main>${footer()}`;}

function planButtons(){return state.plans.length?state.plans.map(p=>`<button class="btn btn-primary btn-block" data-checkout="${esc(p.id)}">Pro · ${money(p.amount/100)} / ${p.intervalCount} ${esc(p.interval)}</button>`).join(''):'<p>Payments are not configured yet.</p>';}
function pricingPage(){return `${publicHeader('pricing')}<main class="section container"><h1>Choose your plan</h1><div class="pricing-grid"><article class="card price-card"><h2>Starter</h2><div class="price">€0</div><p>Subscription tracking, calendar, documents and email reminders.</p><a class="btn btn-secondary" href="/register" data-link>Start free</a></article><article class="card price-card"><h2>Pro</h2><p>Recurring cost insights and recorded price changes.</p>${planButtons()}<p>Recurring billing. Manage or cancel in Settings. Taxes, if applicable, are shown at checkout.</p>${state.meta.testMode?'<p>Test mode — no real payment is taken.</p>':''}</article></div></main>${footer()}`;}

function contactPage(){const available=!state.meta.contactEmail.endsWith('.example');return `${publicHeader('contact')}<main class="section"><div class="container contact-grid"><div><div class="eyebrow">Contact</div><h1>Questions, feedback, or a stubborn renewal?</h1><p class="muted">${available?'Send us an email. Your email app will open.':'Support contact is not configured yet. Please check back later.'}</p>${available?`<a class="btn btn-primary" href="mailto:${esc(state.meta.contactEmail)}">${esc(state.meta.contactEmail)}</a>`:''}</div></div></main>${footer()}`;}

function legalPage(type){
  const data={privacy:['Privacy Policy','We collect the account information required to provide login and security. Subscription records and uploaded documents are stored on our server. Stripe processes Pro payments; your card details are not stored here. Our email provider delivers account messages and reminders. RenewalRadar does not read your bank account or inbox.'],terms:['Terms of Service','RenewalRadar tracks the recurring services you enter. Manually entered subscription records are estimates, not confirmation that a payment has occurred. Pro is a recurring paid subscription. The price, billing interval and applicable taxes are displayed at checkout. Manage billing and cancellation in Settings. Contact support for billing disputes or refund requests.'],cookies:['Cookie Policy','An essential session cookie keeps you signed in. Local storage saves your interface preferences. Subscription records and document contents are stored in your account on the server. This starter has no advertising cookies.']}[type];
  return `${publicHeader()}<main class="section legal-page"><div class="container"><article class="card legal-card"><div class="eyebrow">Legal</div><h1>${data[0]}</h1><p class="muted">Last updated: September 7, 2026</p><h2>Plain-language summary</h2><p>${data[1]}</p><h2>Your choices</h2><p>You can sign out at any time. Local interface preferences can be cleared from your browser storage. Download your account data or permanently delete your account in Settings. Deletion cancels RenewalRadar Pro; provider financial records may remain under their retention policies.</p><h2>Contact</h2><p><a href="/contact" data-link>See the Contact page for support availability.</a></p></article></div></main>${footer()}`;
}

function authLayout(kind){
  const cfg={login:['Welcome back.','Log in to see what is coming next.','Log in'],register:['Create your account.','Start with a calm view of your recurring commitments.','Create account'],forgot:['Reset your password.','Enter your email and we’ll prepare a secure reset link.','Send reset link'],reset:['Choose a new password.','Reset links expire automatically and can only be used once.','Update password']}[kind];
  return `<div class="auth-shell"><aside class="auth-side">${logo()}<div class="auth-side-copy"><span class="badge">RenewalRadar</span><h2>See what’s coming before you’re charged.</h2><p>Your recurring payments should be visible before they become surprises.</p><div class="auth-radar">${radarVisual(true)}</div></div></aside><main class="auth-main"><div class="auth-card"><div class="auth-controls">${themeButton()}${languageButton()}</div><div class="auth-mobile-brand">${logo()}</div><h1>${cfg[0]}</h1><p class="muted">${cfg[1]}</p>${authForm(kind,cfg[2])}</div></main></div>`;
}
function authForm(kind,submit){
  if(kind==='login') return `<form class="form" data-auth-form="login"><div data-form-message></div><div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="email" required></div><div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="current-password" required></div><div class="form-meta"><span></span><a href="/forgot-password" data-link>Forgot password?</a></div><button class="btn btn-primary btn-block" type="submit">${submit}</button><p class="auth-switch">New here? <a href="/register" data-link>Create an account</a></p></form>`;
  if(kind==='register') return `<form class="form" data-auth-form="register"><div data-form-message></div><div class="field"><label>Name</label><input class="input" name="name" autocomplete="name" required></div><div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="email" required></div><div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required><small class="muted">At least 8 characters.</small></div><button class="btn btn-primary btn-block" type="submit">${submit}</button><p class="auth-switch">Already have an account? <a href="/login" data-link>Log in</a></p></form>`;
  if(kind==='forgot') return `<form class="form" data-auth-form="forgot"><div data-form-message></div><div class="field"><label>Email</label><input class="input" name="email" type="email" required></div><button class="btn btn-primary btn-block" type="submit">${submit}</button><p class="auth-switch"><a href="/login" data-link>Back to login</a></p></form>`;
  const token=new URLSearchParams(location.search).get('token')||'';
  return `<form class="form" data-auth-form="reset"><div data-form-message></div><input type="hidden" name="token" value="${esc(token)}"><div class="field"><label>New password</label><input class="input" name="password" type="password" minlength="8" required></div><button class="btn btn-primary btn-block" type="submit">${submit}</button><p class="auth-switch"><a href="/login" data-link>Back to login</a></p></form>`;
}

const dashLinks=[
  ['/dashboard','home','home'],['/dashboard/subscriptions','subscriptions','subscriptions'],['/dashboard/calendar','calendar','calendar'],['/dashboard/insights','insights','insights'],['/dashboard/price-changes','price','priceChanges'],['/dashboard/unused','unused','unused'],['/dashboard/documents','docs','documents'],['/dashboard/settings','settings','settings']
];
function dashboardShell(content, path){
  return `<div class="dashboard"><aside class="sidebar" data-sidebar><button class="icon-btn sidebar-close" data-close-sidebar aria-label="Close navigation">${svgIcon('close')}</button>${logo()}<nav class="side-nav">${dashLinks.map(([href,ic,key])=>`<a class="side-link ${path===href?'active':''} ${(!state.pro&&(href.includes('insights')||href.includes('price-changes')))?'locked':''}" href="${href}" data-link>${svgIcon(ic)}<span>${t(key)}</span>${(!state.pro&&(href.includes('insights')||href.includes('price-changes')))?`<span class="mini-lock">${svgIcon('lock',13)}</span>`:''}</a>`).join('')}</nav><div class="upgrade-card"><strong>♛ ${state.pro?translateText('Pro active',state.lang):t('upgrade')}</strong><p>Advanced alerts, insights and price-change tracking.</p>${state.pro?'<a class="btn btn-primary btn-block" href="/dashboard/insights" data-link>'+t('insights')+'</a>':'<button class="btn btn-primary btn-block" data-open-pro>'+t('goPro')+'</button>'}</div></aside><main class="dash-main"><header class="dash-topbar"><button class="icon-btn sidebar-toggle" data-sidebar-toggle aria-label="Menu">${svgIcon('menu')}</button><div class="dash-search"><span>${svgIcon('search',18)}</span><input type="search" placeholder="${t('search')}" value="${esc(state.dashboardQuery)}" data-global-search></div><div class="dash-actions">${themeButton()}${languageButton()}<button class="icon-btn notification-btn" data-notifications aria-label="Notifications">${svgIcon('bell')}${state.subscriptions.some(s=>daysUntilSubscription(s)<=7)?'<i></i>':''}</button><div class="profile-menu-wrap"><button class="profile-button" data-profile-menu><span class="avatar">${esc(initials())}</span><strong>${esc(state.user?.name||'Michael')}</strong><span class="profile-chevron">⌄</span></button><div class="profile-menu" data-profile-panel><a href="/dashboard/settings" data-link>${svgIcon('settings',17)} ${t('settings')}</a><button data-logout>${svgIcon('arrow',17)} ${t('logout')}</button></div></div></div></header><div class="mobile-section-title"><span>${pageTitle(path)}</span>${['/dashboard/documents','/dashboard/settings'].includes(path)?'':'<button class="btn btn-primary btn-small" data-add-sub>'+svgIcon('plus',16)+' Add</button>'}</div>${state.dataError?`<div class="form-message error" role="alert">${esc(state.dataError)} <button class="btn btn-secondary" data-reload-account>Reload account</button></div>`:''}${content}</main></div>${floatingTip()}`;
}
function pageTitle(path){const found=dashLinks.find(x=>x[0]===path);return found?t(found[2]):'Dashboard';}

function dashboardHome(){
  const upcoming=[...state.subscriptions].sort((a,b)=>nextRenewal(a,today()).localeCompare(nextRenewal(b,today()))).slice(0,5);
  const unused=state.subscriptions.filter(needsReview).length;
  return dashboardShell(`<div class="dash-content"><div class="dash-heading"><div><h1>${t('greeting')}, ${esc((state.user?.name||'Michael').split(' ')[0])}.</h1><p class="muted">Here’s what’s coming up.</p></div><button class="btn btn-primary" data-add-sub>${svgIcon('plus',18)} ${t('addSubscription')}</button></div><section class="stats-grid"><div class="stat-card"><strong>${money(totalThisMonth())}</strong><span>${t('upcomingMonth')}</span></div><div class="stat-card"><strong>${renewalCountThisMonth()}</strong><span>${t('renewalsMonth')}</span>${svgIcon('calendar',25)}</div><div class="stat-card"><strong>${money(totalAnnual())}</strong><span>${t('yearlyTotal')}</span><div class="mini-ring"></div></div><div class="stat-card"><strong>${unused}</strong><span>${t('unusedCount')}</span></div></section><section class="dashboard-grid"><article class="card upcoming-card"><div class="card-head"><h2>${t('upcomingRenewals')}</h2><a href="/dashboard/subscriptions" data-link>See all</a></div><div class="renewal-list">${upcoming.map(s=>subscriptionRow(s)).join('')||'<p class="empty-state">Add your first subscription to see upcoming payments.</p>'}</div></article><article class="card spending-card"><div class="card-head"><h2>${t('spendingOverview')}</h2><select class="tiny-select" aria-label="Period" data-chart-year>${[new Date().getFullYear(),new Date().getFullYear()-1].map(y=>`<option value="${y}" ${state.chartYear===y?'selected':''}>${y}</option>`).join('')}</select></div>${spendingGraph()}<p class="muted chart-note">Scheduled amounts at current prices, not payment history.</p><div class="category-list">${categoryBreakdown()}</div></article><div class="radar-column"><article class="card radar-card"><div class="card-head vertical"><h2>${t('renewalRadar')}</h2><p>${t('radarDesc')}</p></div>${radarVisual(false)}<p class="muted chart-note">${Math.min(7,state.subscriptions.length)} / ${state.subscriptions.length} · ${translateText('Nearest renewals',state.lang)}</p><div class="radar-legend"><span><i class="dot danger"></i>${t('dueSoon')}</span><span><i class="dot primary"></i>${t('thisMonth')}</span><span><i class="dot later"></i>${t('later')}</span></div></article><article class="card all-clear"><span class="success-icon">✓</span><div><strong>Manual tracking</strong><p>Dates and prices come from your records. Review changes with your provider.</p></div></article></div></section></div>`, '/dashboard');
}

function subscriptionLogo(s, cls=''){const content=s.logo==='spotify'?`<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="20" fill="#1ED760"/><path d="M10 15.2c7.8-2.1 14.7-1.6 21 1.5" fill="none" stroke="#07150d" stroke-width="3.2" stroke-linecap="round"/><path d="M11.5 20.7c6.8-1.6 12.9-1.2 18.2 1.2" fill="none" stroke="#07150d" stroke-width="2.7" stroke-linecap="round"/><path d="M13 25.7c5.6-1.1 10.5-.8 15 1" fill="none" stroke="#07150d" stroke-width="2.4" stroke-linecap="round"/></svg>`:`<span>${esc(s.logo||s.name[0])}</span>`;return `<span class="service-logo ${cls}" style="--service:${esc(s.color)}" title="${esc(s.name)}">${content}</span>`;}
function subscriptionRow(s,occurrence=null){const key=occurrence||nextRenewal(s,today()),d=dayDifference(key,today());return `<button class="renewal-row" data-sub-detail="${s.uid}">${subscriptionLogo(s)}<span class="renewal-name"><strong data-user-content>${esc(displayName(s))}</strong><small>${localDate(key).toLocaleDateString(locale(),{month:'short',day:'numeric',year:'numeric'})}</small></span><span class="renewal-price"><strong>${money(s.price)}</strong><small class="${d>=0&&d<=3?'danger-text':''}">${relativeDay(key)}</small></span>${svgIcon('chevron',16)}</button>`;}

function spendingGraph(){const vals=Array.from({length:12},(_,m)=>monthlyProjection(state.chartYear,m)),max=Math.max(1,...vals);return `<div class="spending-chart" aria-label="Scheduled recurring spending">${vals.map((v,i)=>{const label=new Date(state.chartYear,i,1).toLocaleDateString(locale(),{month:'short'});return `<button class="spending-bar-wrap" data-chart-month="${i}" aria-label="${label} ${money(v)}"><i class="spending-bar ${i===new Date().getMonth()&&state.chartYear===new Date().getFullYear()?'active':''}" style="height:${v/max*80}%"></i><small>${label}</small></button>`}).join('')}</div>`;}

function categoryBreakdown(){const sums={};state.subscriptions.forEach(s=>sums[s.category]=(sums[s.category]||0)+annualValue(s));const total=Math.max(1,Object.values(sums).reduce((a,b)=>a+b,0));return Object.entries(sums).map(([name,v],i)=>`<div class="category-row"><span class="cat-icon c${i%4}"></span><strong>${esc(name)}</strong><div class="cat-track"><i style="width:${Math.round(v/total*100)}%"></i></div><span>${Math.round(v/total*100)}%</span><b>${money(v)}</b></div>`).join('');}

function radarVisual(marketing=false){
  const subs=marketing?DEFAULT_SUBSCRIPTIONS.slice(0,4):[...state.subscriptions].sort((a,b)=>nextRenewal(a,today()).localeCompare(nextRenewal(b,today()))).slice(0,7);
  const points=subs.map((s,i)=>{
    const d=Math.min(45,Math.max(0,daysUntilSubscription(s)));
    const radius=marketing?(27+i*9):(20+(d/45)*27);
    const angle=(i*137+35)%360;
    const x=50+Math.cos(angle*Math.PI/180)*radius;
    const y=50+Math.sin(angle*Math.PI/180)*radius;
    return `<button class="radar-node" style="--x:${x}%;--y:${y}%;--service:${esc(s.color)};--urgency:${d<=3?'var(--danger)':d<=30?'var(--primary)':'#409BF5'};--delay:${i*.45}s" data-radar-sub="${marketing?'':esc(s.uid||'')}" ${marketing?'tabindex="-1" aria-hidden="true" disabled':''} aria-label="${esc(displayName(s))} ${money(s.price)}">${subscriptionLogo(s,'radar-service')}<span class="node-pulse"></span></button>`;
  }).join('');
  return `<div class="radar-visual ${marketing?'marketing':''}" data-radar><div class="radar-ring r1"></div><div class="radar-ring r2"></div><div class="radar-ring r3"></div><div class="radar-ring r4"></div><div class="radar-sweep"></div><div class="radar-center"><img src="/assets/logo-mark.svg" alt=""></div>${points}<div class="radar-tooltip" data-radar-tooltip></div></div>`;
}

function subscriptionsPage(){
  return dashboardShell(`<div class="dash-content"><div class="dash-heading"><div><h1>${t('pageSubscriptions')}</h1><p class="muted">Manage recurring services, renewal dates and plans.</p></div><button class="btn btn-primary" data-add-sub>${svgIcon('plus',18)} ${t('addSubscription')}</button></div><div class="toolbar card"><div class="filter-pills">${['All','Monthly','Yearly','Weekly'].map(f=>`<button aria-pressed="${state.subscriptionFilter===f}" class="${state.subscriptionFilter===f?'active':''}" data-sub-filter="${f}">${f}</button>`).join('')}</div><span data-results-count aria-live="polite" aria-label="Matching subscriptions"></span></div><div class="subscription-grid">${state.subscriptions.map(s=>`<article class="card subscription-card" data-filter-text="${esc((displayName(s)+' '+s.category).toLowerCase())}" data-cycle="${s.cycle}" style="--service:${s.color}"><div class="sub-card-top">${subscriptionLogo(s)}<button class="icon-btn compact" data-edit-sub="${s.uid}" aria-label="${translateText('Edit subscription',state.lang)}: ${esc(displayName(s))}">${svgIcon('edit',16)}</button></div><h3 data-user-content>${esc(s.name)}</h3>${s.customName?`<p class="plan-name" data-user-content>${esc(s.customName)}</p>`:''}<p data-user-content>${esc(s.category)}</p><div class="sub-price">${money(s.price)} <small>/ ${cycleLabel(s.cycle)}</small></div><div class="sub-meta"><span>Renews</span><strong>${nextOccurrenceDate(s).toLocaleDateString(locale(),{month:'short',day:'numeric',year:'numeric'})}</strong></div><button class="btn btn-secondary btn-block" data-sub-detail="${s.uid}">View details</button></article>`).join('')}<div class="empty-state card subscription-empty" data-search-empty hidden>No subscriptions match these filters.</div></div></div>`,'/dashboard/subscriptions');
}
function applySubscriptionFilters(){
 const q=state.dashboardQuery.trim().toLowerCase();let count=0;
 document.querySelectorAll('[data-filter-text]').forEach(card=>{card.hidden=!!q&&!card.dataset.filterText.includes(q)||state.subscriptionFilter!=='All'&&card.dataset.cycle!==state.subscriptionFilter;if(!card.hidden)count++;});
 const counter=document.querySelector('[data-results-count]');if(counter)counter.textContent=String(count);
 const empty=document.querySelector('[data-search-empty]');if(empty)empty.hidden=count>0;
}

function calendarPage(){
  const d=state.calendarDate;const year=d.getFullYear(),month=d.getMonth();const first=new Date(year,month,1);const start=(first.getDay()+6)%7;const days=new Date(year,month+1,0).getDate();const cells=[];
  for(let i=0;i<start;i++)cells.push('<div class="calendar-cell muted-cell"></div>');
  for(let day=1;day<=days;day++){
    const subs=state.subscriptions.filter(s=>occurrencesInMonth(s,year,month).some(rd=>rd.getDate()===day));
    cells.push(`<button class="calendar-cell ${subs.length?'has-renewal':''} ${dateKey(new Date(year,month,day))===today()?'is-today':''}" aria-label="${esc(new Date(year,month,day).toLocaleDateString(locale(),{dateStyle:'full'}))}: ${subs.length}" ${subs.length?'':'disabled'} data-calendar-day="${day}" ${subs.length?`data-calendar-subs="${subs.map(s=>s.uid).join(',')}"`:''}><strong>${day}</strong>${subs.slice(0,3).map(s=>`<span style="--service:${esc(s.color)}" data-user-content>${esc(s.name)}</span>`).join('')}${subs.length>3?`<small>+${subs.length-3}</small>`:''}</button>`);
  }
  return dashboardShell(`<div class="dash-content"><div class="dash-heading"><div><h1>${t('pageCalendar')}</h1><p class="muted">See exactly when recurring commitments hit.</p></div><button class="btn btn-primary" data-add-sub>${svgIcon('plus',18)} ${t('addSubscription')}</button></div><article class="card calendar-card"><div class="calendar-head"><button class="icon-btn" data-cal-nav="-1" aria-label="Previous month">‹</button><h2>${d.toLocaleDateString(locale(),{month:'long',year:'numeric'})}</h2><button class="icon-btn" data-cal-nav="1" aria-label="Next month">›</button></div><div class="calendar-week">${Array.from({length:7},(_,i)=>`<span>${new Date(2026,0,5+i).toLocaleDateString(locale(),{weekday:'short'})}</span>`).join('')}</div><div class="calendar-grid">${cells.join('')}</div></article></div>`,'/dashboard/calendar');
}

async function paywallPage(kind){const path=kind==='insights'?'/dashboard/insights':'/dashboard/price-changes';if(state.pro){try{const result=await api(kind==='insights'?'/api/pro/insights?year='+state.chartYear:'/api/pro/price-changes');return kind==='insights'?insightsUnlocked(result):priceUnlocked(result.changes);}catch(e){if(e.status===403)state.pro=false;else return dashboardShell(`<div class="dash-content"><h1>${t('pageInsights')}</h1><p role="alert">${esc(e.message)}</p><button class="btn btn-secondary" data-reload-account>Reload latest records</button></div>`,path);}}return dashboardShell(`<div class="dash-content"><div class="pro-gate card"><div class="pro-gate-art">${svgIcon(kind==='insights'?'insights':'price',50)}</div><span class="badge">${t('locked')}</span><h1>${t('proTitle')}</h1><p>${t('proCopy')}</p><ul class="check-list"><li>${kind==='insights'?'Recurring-cost trends and category intelligence':'Price increase history and impact estimates'}</li><li>Actionable alerts before your next renewal</li><li>Clear annual impact, not vague percentages</li></ul><button class="btn btn-primary" data-open-pro>${t('previewPro')}</button></div></div>`,path);}
function insightsUnlocked(stats){
 const categories={};state.subscriptions.forEach(s=>categories[s.category]=(categories[s.category]||0)+annualValue(s));const top=stats?stats.top:Object.entries(categories).sort((a,b)=>b[1]-a[1])[0];
 const savings=stats?stats.monthlySavings:state.subscriptions.filter(needsReview).reduce((a,s)=>a+annualValue(s)/12,0);
 return dashboardShell(`<div class="dash-content"><div class="dash-heading"><div><h1>${t('pageInsights')}</h1><p class="muted">Estimates based on your current records.</p></div></div><section class="insight-grid"><article class="card insight-big"><span>Annual recurring cost</span><strong>${money(stats?stats.annual:totalAnnual())}</strong>${spendingGraph()}<p class="muted chart-note">Scheduled amounts at current prices, not payment history.</p></article><article class="card insight-stat"><span>Most expensive category</span><strong>${top?esc(top[0]):'—'}</strong><p>${top&&totalAnnual()?Math.round(top[1]/totalAnnual()*100):0}%</p></article><article class="card insight-stat"><span>Potential monthly savings</span><strong>${money(savings)}</strong><p>Annualized cost of subscriptions marked for review, divided by 12.</p></article></section></div>`,'/dashboard/insights');
}

function priceUnlocked(provided){const changes=provided||state.subscriptions.flatMap(s=>(s.priceHistory||[]).map(h=>({s,h}))).sort((a,b)=>b.h.date.localeCompare(a.h.date));return dashboardShell(`<div class="dash-content"><div class="dash-heading"><div><h1>${t('pagePrice')}</h1><p class="muted">Price and billing-cycle changes you recorded.</p></div></div><div class="change-list">${changes.map(({s,h})=>{const delta=annualValue({price:h.to,cycle:h.toCycle})-annualValue({price:h.from,cycle:h.fromCycle});return `<article class="card change-row">${subscriptionLogo(s)}<div><strong data-user-content>${esc(displayName(s))}</strong><small>${localDate(h.date).toLocaleDateString(locale())}</small></div><span>${money(h.from)} / ${cycleLabel(h.fromCycle)} → <b>${money(h.to)} / ${cycleLabel(h.toCycle)}</b></span><em class="${delta<0?'saving':''}">${delta>0?'+':''}${money(delta)} / year</em></article>`}).join('')||'<div class="empty-state card">No price changes recorded yet. Edit a subscription to record a change.</div>'}</div></div>`,'/dashboard/price-changes');}

function unusedPage(){const list=state.subscriptions.filter(needsReview);return dashboardShell(`<div class="dash-content"><div class="dash-heading"><div><h1>${t('pageUnused')}</h1><p class="muted">Review services that may no longer justify the next charge.</p></div></div><div class="unused-list">${list.length?list.map(s=>`<article class="card unused-row">${subscriptionLogo(s)}<div><strong data-user-content>${esc(s.name)}</strong><p>${translateText('Last used',state.lang)} ${lastUsedDays(s)===null?'Not recorded':relativeDay(s.lastUsedDate)} · ${money(s.price)}/${cycleLabel(s.cycle)}</p></div><div class="unused-actions"><button class="btn btn-secondary" data-keep-sub="${esc(s.uid)}">Review again in 30 days</button><button class="btn btn-danger" data-remove-sub="${esc(s.uid)}">Remove from radar</button></div></article>`).join(''):'<div class="empty-state card">Nothing to review right now. Nice.</div>'}</div></div>`,'/dashboard/unused');}

function documentsPage(){return dashboardShell(`<div class="dash-content"><div class="dash-heading"><div><h1>${t('pageDocuments')}</h1><p class="muted">Private account files. Up to 5 MB per file and 50 MB total.</p></div><label class="btn btn-primary file-button">${svgIcon('upload',18)} Add document<input type="file" data-doc-upload class="sr-only" aria-label="Add document"></label></div><div class="docs-grid">${state.documents.map(d=>`<article class="card doc-card">${svgIcon('docs',30)}<div><strong data-user-content>${esc(d.name)}</strong><small>${(d.bytes/1024).toFixed(1)} KB · ${new Date(d.createdAt).toLocaleDateString(locale())}</small><a class="document-download" href="/api/documents/${d.id}" download>Download</a></div><button class="icon-btn compact" data-delete-doc="${d.id}" aria-label="${translateText('Delete document',state.lang)}: ${esc(d.name)}">${svgIcon('trash',16)}</button></article>`).join('')||'<div class="empty-state card"><h3>No documents yet</h3><p>Add a receipt, invoice or cancellation confirmation.</p></div>'}</div></div>`,'/dashboard/documents');}

function settingsPage(){return dashboardShell(`<div class="dash-content"><div class="dash-heading"><div><h1>${t('pageSettings')}</h1><p class="muted">Account and interface preferences.</p></div></div><div class="settings-grid"><form class="card settings-card" data-profile-form><h2>Profile</h2><div class="field"><label>Name</label><input class="input" name="name" minlength="2" maxlength="80" value="${esc(state.user?.name||'')}" required></div><div class="field"><label>Email</label><input class="input" value="${esc(state.user?.email||'')}" disabled></div><button class="btn btn-primary" type="submit">${t('save')}</button></form><article class="card settings-card"><h2>Appearance</h2><div class="setting-row"><strong>${t('theme')}</strong><button class="switch ${state.theme==='dark'?'on':''}" data-theme-toggle role="switch" aria-label="Toggle theme" aria-checked="${state.theme==='dark'}"><i></i></button></div><div class="setting-row"><label for="settings-lang">${t('language')}</label><select id="settings-lang" class="input compact-select" data-settings-lang><option value="en" ${state.lang==='en'?'selected':''}>English</option><option value="de" ${state.lang==='de'?'selected':''}>Deutsch</option><option value="es" ${state.lang==='es'?'selected':''}>Español</option></select></div></article><form class="card settings-card form" data-password-form><h2>Change password</h2><div data-form-message></div><div class="field"><label>Current password</label><input class="input" type="password" name="currentPassword" autocomplete="current-password" minlength="8" maxlength="128" required></div><div class="field"><label>New password</label><input class="input" type="password" name="password" autocomplete="new-password" minlength="8" maxlength="128" required></div><button class="btn btn-primary">Update password</button></form><form class="card settings-card form" data-reminder-form><h2>Email reminders</h2><p class="muted">${state.meta.mailReady?'Reminders run while the server is online, even when this page is closed.':'Email delivery is not configured. You can still export calendar reminders.'}</p><div class="field"><label>Time zone</label><select class="input" name="timeZone">${[...new Set([state.settings.timeZone,...Intl.supportedValuesOf('timeZone')])].map(z=>`<option value="${esc(z)}" ${z===state.settings.timeZone?'selected':''}>${esc(z)}</option>`).join('')}</select></div><div class="field"><label>Days before renewal</label><input class="input" type="number" min="0" max="30" name="reminderDays" value="${state.settings.reminderDays}" required></div>${state.meta.mailReady&&!state.settings.emailVerified?'<button type="button" class="btn btn-secondary" data-verify-email>Verify email</button>':''}<label class="checkbox-row"><input type="checkbox" name="emailReminders" ${state.settings.emailReminders?'checked':''} ${!state.meta.mailReady||!state.settings.emailVerified?'disabled':''}> Enable email reminders</label><button class="btn btn-primary">${t('save')}</button><button type="button" class="btn btn-secondary" data-export-calendar>Export calendar reminders</button><small class="muted">Calendar export contains the next 12 months. Re-export after changing your records.</small></form><article class="card settings-card"><h2>Your data</h2><p class="muted">Subscriptions and files are saved to your account.</p><button class="btn btn-secondary" data-import-local>Import previous browser records</button><p class="muted">Old document entries contain no file contents. Upload those files again.</p><button class="btn btn-secondary" data-export-data>Export subscriptions</button></article>${billingCard()}${accountSettingsExtras()}</div></div>`,'/dashboard/settings');}

function floatingTip(){const unusedCount=state.subscriptions.filter(needsReview).length;if(!unusedCount)return '';const dismissed=state.tipDismissed||Number(browserStore.getItem(userStorageKey('rr_tip_dismissed'))||0);if(Date.now()-dismissed<7*86400000)return '';return `<aside class="floating-tip" data-floating-tip><button class="tip-close" data-close-tip aria-label="Close">${svgIcon('close',16)}</button><strong>💡 ${t('proTip')}</strong><p>${unusedCount} ${state.lang==='de'?'Abos sind zur Nutzungsprüfung bereit.':state.lang==='es'?'suscripciones están listas para revisar su uso.':'subscriptions are ready for a usage review.'}</p><a href="/dashboard/unused" data-link>${t('reviewTip')} ${svgIcon('arrow',15)}</a></aside>`;}

function addSubscriptionModal(){const cards=SERVICE_PRESETS.map(s=>`<button class="preset-card" data-service-preset="${s.id}">${subscriptionLogo(s)}<span data-user-content>${esc(s.name)}</span></button>`).join('');showModal(`<div class="modal-head"><div><h2>${t('addSubscription')}</h2><p>Choose a popular service or add it manually.</p></div><button class="close" data-close-modal>${svgIcon('close')}</button></div><div class="modal-search">${svgIcon('search',17)}<input placeholder="Search for a service" data-service-search></div><div class="modal-label"><strong>Popular services</strong></div><div class="preset-grid" data-preset-grid>${cards}</div><button class="manual-add" data-service-preset="custom">${svgIcon('plus')}<span><strong>Add manually</strong><small>Enter the details yourself</small></span></button>`);}
function subscriptionFormModal(serviceId,uid=null){
 const existing=state.subscriptions.find(s=>s.uid===uid),preset=SERVICE_PRESETS.find(s=>s.id===serviceId),s=existing||preset||{name:'',price:'',cycle:'Monthly',category:'Other'},editing=!!existing;
 const due=existing?nextRenewal(s,today()):dateKey(nextDateForDay(s.day||localDate(today()).getDate()));
 showModal(`<div class="modal-head"><div><h2>${editing?'Edit subscription':t('addSubscription')}</h2><p>Enter the details from your provider.</p></div><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><form class="form" data-sub-form><div data-form-message></div><input type="hidden" name="uid" value="${esc(uid||'')}"><input type="hidden" name="preset" value="${esc(s.id||'custom')}"><input type="hidden" name="originalDisplayedDate" value="${due}"><div class="form-row"><div class="field"><label>Plan name (optional)</label><input class="input" name="customName" maxlength="120" value="${esc(s.customName||'')}" placeholder="e.g. Family plan"></div><div class="field"><label>Service name</label><input class="input" name="service" maxlength="120" value="${esc(s.name)}" required></div></div><div class="field"><label>Category</label><input class="input" name="category" maxlength="60" value="${esc(s.category)}" required></div><div class="form-row"><div class="field"><label>Billing cycle</label><select class="input" name="cycle">${['Monthly','Yearly','Weekly'].map(c=>`<option value="${c}" ${s.cycle===c?'selected':''}>${c}</option>`).join('')}</select></div><div class="field"><label>Price (EUR)</label><input class="input" name="price" type="number" min="0" max="1000000" step="0.01" value="${s.price??''}" required></div></div><div class="field"><label>Next renewal date</label><input class="input" name="renewalDate" type="date" min="1900-01-01" max="9998-12-31" value="${due}" required></div><div class="field"><label>Last used (optional)</label><input class="input" name="lastUsedDate" type="date" min="1900-01-01" max="${today()}" value="${s.lastUsedDate||''}"></div><button class="btn btn-primary btn-block" type="submit">${editing?t('save'):'Add subscription'}</button></form>`);
}


function subscriptionDetailModal(uid){const s=state.subscriptions.find(x=>x.uid===uid);if(!s)return;showModal(`<div class="modal-head"><div class="modal-service-title">${subscriptionLogo(s)}<div><h2 data-user-content>${esc(displayName(s))}</h2><p data-user-content>${esc(s.category)}</p></div></div><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><div class="detail-price">${money(s.price)} <small>/ ${cycleLabel(s.cycle)}</small></div><div class="detail-grid"><div><span>Next renewal</span><strong>${nextOccurrenceDate(s).toLocaleDateString(locale())}</strong></div><div><span>Annual value</span><strong>${money(annualValue(s))}</strong></div><div><span>Last used</span><strong>${s.lastUsedDate?relativeDay(s.lastUsedDate):'Not recorded'}</strong></div><div><span>Status</span><strong>Manual tracking</strong></div></div><div class="modal-actions"><button class="btn btn-danger" data-remove-sub="${s.uid}">Remove</button><button class="btn btn-secondary" data-mark-used="${s.uid}">Used today</button><button class="btn btn-primary" data-edit-sub="${s.uid}">Edit subscription</button></div>`);}

function proModal(){showModal(`<div class="modal-head"><h2>RenewalRadar Pro</h2><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><p>Recurring cost insights and recorded price changes.</p>${state.pro?'<p>Pro active</p><button class="btn btn-secondary" data-billing-portal>Manage billing</button>':planButtons()}<p>Recurring billing. Manage or cancel in Settings. Taxes, if applicable, are shown at checkout.</p>${state.meta.testMode?'<p>Test mode — no real payment is taken.</p>':''}`);bindBilling(modalRoot);}
function billingCard(){const b=state.billing||{};return `<article class="card settings-card"><h2>Billing</h2><p>${state.pro?'Pro active':'Starter'} · <span data-user-content>${esc(b.status||'free')}</span></p>${b.periodEnd?`<p>${b.cancelAtPeriodEnd?'Access ends':'Current period ends'}: ${new Date(b.periodEnd*1000).toLocaleDateString(locale())}</p>`:''}${b.hasCustomer?'<button class="btn btn-secondary" data-billing-portal>Manage billing</button>':'<button class="btn btn-primary" data-open-pro>Upgrade to Pro</button>'}${b.ready?'<button class="btn btn-secondary" data-billing-refresh>Refresh billing status</button>':''}<p>Manage invoices, payment methods and cancellation in the billing portal.</p></article>`;}
function bindBilling(root){root.querySelectorAll('[data-checkout]').forEach(b=>b.addEventListener('click',()=>{if(!state.user){navigate('/register');return;}runAction(b,async()=>{const result=await api('/api/billing/checkout',{method:'POST',body:JSON.stringify({priceId:b.dataset.checkout,lang:state.lang})});location.assign(result.url);});}));root.querySelectorAll('[data-billing-portal]').forEach(b=>b.addEventListener('click',()=>runAction(b,async()=>{const result=await api('/api/billing/portal',{method:'POST',body:JSON.stringify({lang:state.lang})});location.assign(result.url);})));root.querySelectorAll('[data-billing-refresh]').forEach(b=>b.addEventListener('click',()=>runAction(b,async()=>{await api('/api/billing/refresh',{method:'POST',body:'{}'});await refreshAccount();})));}

function notificationsModal(){const upcoming=[...state.subscriptions].sort((a,b)=>nextOccurrenceDate(a)-nextOccurrenceDate(b)).slice(0,5);showModal(`<div class="modal-head"><div><h2>Upcoming renewals</h2><p>Your nearest recurring charges at a glance.</p></div><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><div class="renewal-list">${upcoming.map(s=>subscriptionRow(s)).join('')||'<div class="empty-state">No upcoming renewals.</div>'}</div><a class="btn btn-secondary btn-block" href="/dashboard/calendar" data-link data-close-on-nav>Open calendar</a>`);}
let lastFocusedElement=null,modalDismiss=null;
function showModal(html,wide=false){if(!modalRoot.firstChild)lastFocusedElement=document.activeElement;modalRoot.innerHTML=`<div class="modal-backdrop" data-modal-backdrop><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">${html}</section></div>`;modalRoot.querySelector('h2')?.setAttribute('id','modal-title');document.body.classList.add('no-scroll');app.inert=true;bindModal();enhanceForms(modalRoot);translateSurface(modalRoot);requestAnimationFrame(()=>modalRoot.querySelector('input:not([type="hidden"]),select,button,a')?.focus());}

function closeModal(){if(modalDismiss){const dismiss=modalDismiss;modalDismiss=null;dismiss();return;}modalRoot.innerHTML='';document.body.classList.remove('no-scroll');app.inert=false;if(lastFocusedElement?.isConnected)lastFocusedElement.focus();lastFocusedElement=null;}

function bindModal(){
 modalRoot.querySelectorAll('[data-close-modal]').forEach(b=>b.addEventListener('click',closeModal));
 modalRoot.querySelectorAll('[data-link]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const href=a.getAttribute('href');closeModal();navigate(href);}));
 modalRoot.querySelector('[data-modal-backdrop]')?.addEventListener('mousedown',e=>{if(e.target===e.currentTarget)closeModal();});
 modalRoot.querySelectorAll('[data-service-preset]').forEach(b=>b.addEventListener('click',()=>subscriptionFormModal(b.dataset.servicePreset)));
 modalRoot.querySelectorAll('[data-sub-detail]').forEach(b=>b.addEventListener('click',()=>subscriptionDetailModal(b.dataset.subDetail)));
 modalRoot.querySelector('[data-service-search]')?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();modalRoot.querySelectorAll('.preset-card').forEach(c=>c.hidden=!c.textContent.toLowerCase().includes(q));});
 modalRoot.querySelector('[data-sub-form]')?.addEventListener('submit',e=>saveSubscriptionForm(e));
 bindSubscriptionActions(modalRoot);
}
async function saveSubscriptionForm(e){e.preventDefault();const form=e.currentTarget,fd=new FormData(form);await runAction(form.querySelector('[type="submit"]'),async()=>{
 const existing=state.subscriptions.find(s=>s.uid===fd.get('uid')),preset=SERVICE_PRESETS.find(s=>s.id===fd.get('preset'));
 const service=String(fd.get('service')||'').trim(),price=Number(fd.get('price')),cycle=String(fd.get('cycle')),selected=String(fd.get('renewalDate'));
 if(!service)throw Error('Enter a service name.');
 if(!validDate(selected)||fd.get('lastUsedDate')&&(!validDate(fd.get('lastUsedDate'))||fd.get('lastUsedDate')>today()))throw Error('Enter a valid date.');
 const history=[...(existing?.priceHistory||[])];if(existing&&(existing.price!==price||existing.cycle!==cycle))history.push({date:today(),from:existing.price,to:price,fromCycle:existing.cycle,toCycle:cycle});
 const item={uid:existing?.uid||crypto.randomUUID(),id:preset?.id||existing?.id||'custom',name:service,customName:String(fd.get('customName')||'').trim(),category:String(fd.get('category')||'Other').trim(),price,cycle,color:existing?.color||preset?.color||'#6956E8',logo:existing?.logo||preset?.logo||service[0].toUpperCase(),renewalDate:existing&&selected===fd.get('originalDisplayedDate')&&cycle===existing.cycle?existing.renewalDate:selected,lastUsedDate:fd.get('lastUsedDate')||null,lastReviewedDate:existing?.lastReviewedDate||null,priceHistory:history};
 const items=existing?state.subscriptions.map(s=>s.uid===existing.uid?item:s):[...state.subscriptions,item];await saveAccount(items);closeModal();toast('Subscription saved.','success');render();
 },form);}
function bindSubscriptionActions(root){
 root.querySelectorAll('[data-edit-sub]').forEach(b=>b.addEventListener('click',()=>subscriptionFormModal(null,b.dataset.editSub)));
 root.querySelectorAll('[data-remove-sub]').forEach(b=>b.addEventListener('click',()=>confirmRemoval(b.dataset.removeSub)));
 root.querySelectorAll('[data-mark-used]').forEach(b=>b.addEventListener('click',()=>runAction(b,async()=>{await saveAccount(state.subscriptions.map(s=>s.uid===b.dataset.markUsed?{...s,lastUsedDate:today(),lastReviewedDate:null}:s));subscriptionDetailModal(b.dataset.markUsed);toast('Usage updated.','success');})));
}
function confirmRemoval(uid){const s=state.subscriptions.find(s=>s.uid===uid);if(!s)return;showModal(`<div class="modal-head"><h2>Remove subscription?</h2><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><p data-user-content>${esc(displayName(s))}</p><p>This removes your record. It does not cancel your subscription with the provider.</p><div class="modal-actions"><button class="btn btn-secondary" data-close-modal>Keep record</button><button class="btn btn-danger" data-confirm-remove>Remove record</button></div>`);modalRoot.querySelector('[data-confirm-remove]').addEventListener('click',e=>runAction(e.currentTarget,async()=>{await saveAccount(state.subscriptions.filter(s=>s.uid!==uid));closeModal();render();toast('Record removed.','success');}));}
async function runAction(button,action,form){if(button?.disabled)return;if(button)button.disabled=true;try{await action();}catch(e){if(e.status===409){state.dataError=e.message;if(!form&&!modalRoot.firstChild)render();}if(form)setFormMessage(form,e.message);else toast(e.message,'error');if(e.status===409){const host=form||modalRoot.querySelector('.modal');if(host&&!host.querySelector('[data-recover-save]')){host.insertAdjacentHTML('beforeend','<button type="button" class="btn btn-secondary" data-recover-save>Reload latest records</button>');host.querySelector('[data-recover-save]').addEventListener('click',confirmRefresh);translateSurface(host);}updateSyncBanner();}}finally{if(button)button.disabled=false;}}

function cookieBanner(){if(browserStore.getItem('rr_cookie_choice'))return '';return `<div class="cookie-banner" data-cookie-banner><p><strong>Cookies, kept simple.</strong> We use an essential session cookie and local preferences. <a href="/cookies" data-link>Learn more</a>.</p><div><button class="btn btn-secondary" data-cookie="essential">Essential only</button><button class="btn btn-primary" data-cookie="accept">Accept preferences</button></div></div>`;}
function setMeta(path){const data=pageMeta[path]||[`${pageTitle(path)} — RenewalRadar`,'RenewalRadar application.'];document.title=data[0];const d=document.querySelector('meta[name="description"]');if(d)d.content=data[1];}
function toast(message,type=''){const n=document.createElement('div');n.className=`toast ${type}`;n.textContent=translateText(message,state.lang);toastRoot.append(n);setTimeout(()=>n.remove(),3900);}
async function api(path,options={}){
 const accountId=state.user?.id,mutating=options.method&&options.method!=='GET';if(mutating)state.mutations++;
 try{
  const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})},credentials:'same-origin',signal:typeof AbortSignal!=='undefined'?AbortSignal.timeout(20000):undefined});
  if(accountId!==state.user?.id)throw Error('Your session changed. Sign in again.');
  let data;try{data=await res.json();}catch{throw Error('The server returned an invalid response. Try again.');}
  if(!res.ok){if(res.status===401&&!path.includes('/auth/')){clearIdentity();navigate('/login');}const error=new Error(data.error||'Something went wrong.');error.status=res.status;throw error;}return data;
 }catch(e){if(e.name==='TimeoutError'||e.name==='AbortError'||e instanceof TypeError)throw Error('Could not connect to the server. Reload to try again.');throw e;}
 finally{if(mutating)state.mutations=Math.max(0,state.mutations-1);}
}
function clearIdentity(){state.user=null;state.subscriptions=[];state.documents=[];state.pro=false;state.billing={};state.version=0;state.dataError='';state.remotePending=false;closeModal();}

async function loadSession(){try{const [me,meta]=await Promise.all([api('/api/auth/me'),api('/api/meta')]);state.user=me.user;state.meta=meta;try{const pricing=await api('/api/billing/plans');state.plans=pricing.plans;state.meta.testMode=pricing.testMode;}catch{}}catch{state.dataError='Could not connect to the server. Reload to try again.';}}
function navigate(href){closeSidebar();const url=new URL(href,location.origin);if(url.origin!==location.origin){location.href=href;return;}history.pushState({},'',url.pathname+url.search+url.hash);render();}

let renderRevision=0;
async function render(){const revision=++renderRevision;closeSidebar();applyTheme();let path=location.pathname.replace(/\/$/,'')||'/';if(!routes.has(path)){closeModal();app.innerHTML=publicHeader()+'<main class="section container"><h1>Page not found</h1><a class="btn btn-primary" href="/" data-link>Home</a></main>'+footer();bindInteractions();enhanceForms(app);translateSurface(app);return;}if(path.startsWith('/dashboard')&&!state.user){history.replaceState({},'', '/login?next='+encodeURIComponent(location.pathname+location.search));path='/login';}if((path==='/login'||path==='/register')&&state.user){history.replaceState({},'', '/dashboard');path='/dashboard';}setMeta(path);let html='';if(path==='/')html=landingPage();else if(path==='/pricing')html=pricingPage();else if(path==='/contact')html=contactPage();else if(path==='/privacy')html=legalPage('privacy');else if(path==='/terms')html=legalPage('terms');else if(path==='/cookies')html=legalPage('cookies');else if(path==='/login')html=authLayout('login');else if(path==='/register')html=authLayout('register');else if(path==='/forgot-password')html=authLayout('forgot');else if(path==='/reset-password')html=authLayout('reset');else if(path==='/dashboard')html=dashboardHome();else if(path==='/dashboard/subscriptions')html=subscriptionsPage();else if(path==='/dashboard/calendar')html=calendarPage();else if(path==='/dashboard/insights')html=await paywallPage('insights');else if(path==='/dashboard/price-changes')html=await paywallPage('price');else if(path==='/dashboard/unused')html=unusedPage();else if(path==='/dashboard/documents')html=documentsPage();else if(path==='/dashboard/settings')html=settingsPage();if(revision!==renderRevision)return;app.innerHTML=html;if(!document.querySelector('[data-cookie-banner]'))app.insertAdjacentHTML('beforeend',cookieBanner());closeModal();bindInteractions();enhanceForms(app);translateSurface(app);applySubscriptionFilters();updateSyncBanner();if(location.hash)requestAnimationFrame(()=>document.getElementById(safeHash(location.hash))?.scrollIntoView({behavior:'smooth'}));else window.scrollTo({top:0,behavior:'auto'});}

function setFormMessage(form,message,type='error',html=false){const slot=form.querySelector('[data-form-message]');if(slot)slot.innerHTML=message?`<div class="form-message ${type}">${html?message:esc(translateText(message,state.lang))}</div>`:'';}
function bindAuthForm(form){if(form.dataset.bound)return;form.dataset.bound='true';form.addEventListener('submit',async e=>{e.preventDefault();if(form.querySelector('button[type="submit"]').disabled)return;setFormMessage(form,'');const fd=new FormData(form);const kind=form.dataset.authForm;const button=form.querySelector('button[type="submit"]');const old=button.textContent;button.disabled=true;button.textContent=translateText('Working…',state.lang);try{if(kind==='login'){const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:fd.get('email'),password:fd.get('password')})});state.user=data.user;await loadUserLocalState();toast('Welcome back.','success');navigate(new URLSearchParams(location.search).get('next')?.startsWith('/dashboard')?new URLSearchParams(location.search).get('next'):'/dashboard');}else if(kind==='register'){const data=await api('/api/auth/register',{method:'POST',body:JSON.stringify({name:fd.get('name'),email:fd.get('email'),password:fd.get('password')})});state.user=data.user;await loadUserLocalState();toast('Account created.','success');navigate('/dashboard');}else if(kind==='forgot'){const data=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:fd.get('email')})});setFormMessage(form,data.message,'success');}else{await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token:fd.get('token'),password:fd.get('password')})});state.user=null;state.subscriptions=[];state.documents=[];state.pro=false;setFormMessage(form,'Password updated. You can now log in.','success');setTimeout(()=>navigate('/login'),1000);}}catch(err){setFormMessage(form,err.message);}finally{button.disabled=false;button.textContent=old;}});}

function bindInteractions(){bindBilling(app);
  document.querySelectorAll('[data-link]').forEach(a=>a.addEventListener('click',e=>{const href=a.getAttribute('href');if(href?.startsWith('mailto:'))return;if(href?.startsWith('#'))return;if(href?.includes('#')&&new URL(href,location.origin).pathname===location.pathname)return;e.preventDefault();navigate(href);}));
  document.querySelector('[data-mobile-menu]')?.addEventListener('click',()=>document.querySelector('[data-mobile-panel]')?.classList.toggle('open'));
  document.querySelector('[data-close-sidebar]')?.addEventListener('click',()=>{closeSidebar();document.querySelector('[data-sidebar-toggle]')?.focus();});
  document.querySelector('[data-sidebar-toggle]')?.addEventListener('click',()=>toggleSidebar());
  document.querySelectorAll('[data-add-sub]').forEach(b=>b.addEventListener('click',addSubscriptionModal));
  document.querySelectorAll('[data-open-pro]').forEach(b=>b.addEventListener('click',proModal));
  document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';savePreference('rr_theme',state.theme);applyTheme();document.querySelectorAll('[data-theme-toggle]').forEach(btn=>{if(btn.classList.contains('switch')){btn.classList.toggle('on',state.theme==='dark');btn.setAttribute('aria-checked',String(state.theme==='dark'));}else btn.innerHTML=svgIcon(state.theme==='dark'?'sun':'moon');});}));
  document.querySelectorAll('[data-lang-toggle]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();const menu=b.parentElement.querySelector('[data-lang-menu]');document.querySelectorAll('.lang-menu.open').forEach(x=>{if(x!==menu)x.classList.remove('open')});menu?.classList.toggle('open');}));
  document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click',()=>changeLanguage(b.dataset.lang)));
  document.querySelector('[data-settings-lang]')?.addEventListener('change',e=>changeLanguage(e.target.value));
  document.querySelector('[data-profile-menu]')?.addEventListener('click',()=>document.querySelector('[data-profile-panel]')?.classList.toggle('open'));
  document.querySelector('[data-logout]')?.addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST',body:'{}'});state.user=null;state.subscriptions=[];state.documents=[];state.pro=false;toast('You’re signed out.','success');navigate('/');}catch(e){toast(e.message,'error');}});
  document.querySelectorAll('[data-auth-form]').forEach(bindAuthForm);
  document.querySelector('[data-global-search]')?.addEventListener('input',e=>{state.dashboardQuery=e.target.value;if(location.pathname!=='/dashboard/subscriptions'&&state.dashboardQuery.trim()){state.subscriptionFilter='All';navigate('/dashboard/subscriptions');const input=document.querySelector('[data-global-search]');input?.focus();}else applySubscriptionFilters();});
  document.querySelector('[data-global-search]')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(location.pathname!=='/dashboard/subscriptions')navigate('/dashboard/subscriptions');}});
  document.querySelector('[data-notifications]')?.addEventListener('click',notificationsModal);
  document.querySelectorAll('[data-sub-detail]').forEach(b=>b.addEventListener('click',()=>subscriptionDetailModal(b.dataset.subDetail)));
  document.querySelectorAll('[data-sub-filter]').forEach(b=>b.addEventListener('click',()=>{state.subscriptionFilter=b.dataset.subFilter;render();}));
  document.querySelectorAll('[data-radar-sub]').forEach(b=>{b.addEventListener('mouseenter',()=>showRadarTooltip(b));b.addEventListener('focus',()=>showRadarTooltip(b));b.addEventListener('mouseleave',hideRadarTooltip);b.addEventListener('blur',hideRadarTooltip);b.addEventListener('click',()=>{if(b.dataset.radarSub)subscriptionDetailModal(b.dataset.radarSub);});});
  document.querySelectorAll('[data-chart-month]').forEach(b=>b.addEventListener('click',()=>toast(new Date(state.chartYear,Number(b.dataset.chartMonth),1).toLocaleDateString(locale(),{month:'long',year:'numeric'})+': '+money(monthlyProjection(state.chartYear,Number(b.dataset.chartMonth))))));
  document.querySelector('[data-chart-year]')?.addEventListener('change',e=>{state.chartYear=Number(e.target.value);render();});
  document.querySelectorAll('[data-cal-nav]').forEach(b=>b.addEventListener('click',()=>{state.calendarDate=new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth()+Number(b.dataset.calNav),1);render();}));
  document.querySelectorAll('[data-calendar-day]').forEach(b=>b.addEventListener('click',()=>{const ids=(b.dataset.calendarSubs||'').split(',').filter(Boolean);if(!ids.length)return;const subs=ids.map(id=>state.subscriptions.find(s=>s.uid===id)).filter(Boolean);showModal(`<div class="modal-head"><div><h2>${b.dataset.calendarDay} ${state.calendarDate.toLocaleDateString(locale(),{month:'long',year:'numeric'})}</h2><p>${subs.length} ${state.lang==='de'?'Verlängerungen geplant.':state.lang==='es'?'renovaciones programadas.':'renewals scheduled.'}</p></div><button class="close" data-close-modal>${svgIcon('close')}</button></div><div class="renewal-list">${subs.map(s=>subscriptionRow(s,dateKey(new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth(),Number(b.dataset.calendarDay))))).join('')}</div>`);}));
  document.querySelectorAll('[data-keep-sub]').forEach(b=>b.addEventListener('click',()=>runAction(b,async()=>{await saveAccount(state.subscriptions.map(s=>s.uid===b.dataset.keepSub?{...s,lastReviewedDate:today()}:s));render();})));
  bindSubscriptionActions(app);
  document.querySelector('[data-doc-upload]')?.addEventListener('change',uploadDocument);
  document.querySelectorAll('[data-delete-doc]').forEach(b=>b.addEventListener('click',()=>deleteDocumentModal(b.dataset.deleteDoc)));
  document.querySelector('[data-profile-form]')?.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form);runAction(form.querySelector('button'),async()=>{const data=await api('/api/account/profile',{method:'POST',body:JSON.stringify({name:fd.get('name')})});state.user=data.user;form.dataset.dirty='false';toast('Profile updated.','success');},form);});
  bindAccountActions();
  document.querySelector('[data-close-tip]')?.addEventListener('click',()=>{state.tipDismissed=Date.now();savePreference(userStorageKey('rr_tip_dismissed'),String(state.tipDismissed));document.querySelector('[data-floating-tip]')?.classList.add('hiding');setTimeout(()=>document.querySelector('[data-floating-tip]')?.remove(),220);});
  document.querySelectorAll('[data-cookie]').forEach(b=>b.addEventListener('click',()=>{browserStore.setItem('rr_cookie_choice',b.dataset.cookie);if(b.dataset.cookie==='essential'){browserStore.removeItem('rr_theme');browserStore.removeItem('rr_lang');}else{savePreference('rr_theme',state.theme);savePreference('rr_lang',state.lang);}document.querySelector('[data-cookie-banner]')?.remove();toast('Cookie preference saved.','success');}));


}
function globalOutsideClick(e){if(!e.target.closest('.lang-wrap'))document.querySelectorAll('.lang-menu').forEach(x=>x.classList.remove('open'));if(!e.target.closest('.profile-menu-wrap'))document.querySelectorAll('.profile-menu').forEach(x=>x.classList.remove('open'));}
function showRadarTooltip(btn){const uid=btn.dataset.radarSub;const s=state.subscriptions.find(x=>x.uid===uid);if(!s)return;const radar=btn.closest('[data-radar]');const tip=radar?.querySelector('[data-radar-tooltip]');if(!tip)return;tip.innerHTML=`<strong data-user-content>${esc(s.name)}</strong><span>${money(s.price)} · ${relativeDay(nextRenewal(s,today()))}</span>`;tip.style.left=btn.style.getPropertyValue('--x');tip.style.top=btn.style.getPropertyValue('--y');tip.classList.add('show');}
function hideRadarTooltip(e){e.currentTarget.closest('[data-radar]')?.querySelector('[data-radar-tooltip]')?.classList.remove('show');}

function enhanceForms(root){root.querySelectorAll('form').forEach(form=>{if(!form.dataset.dirtyBound){form.dataset.dirtyBound='true';form.addEventListener('input',()=>form.dataset.dirty='true');form.addEventListener('change',()=>form.dataset.dirty='true');}});
 root.querySelectorAll('.field').forEach((field,i)=>{const input=field.querySelector('input:not([type="hidden"]),select,textarea'),label=field.querySelector('label');if(input&&label){if(!input.id)input.id=`${root.id}-field-${i}`;label.setAttribute('for',input.id);}});
 root.querySelectorAll('[data-form-message]').forEach(el=>{el.setAttribute('role','alert');el.setAttribute('aria-live','polite');});
 root.querySelectorAll('input[name="name"]').forEach(el=>{el.minLength=2;el.maxLength=80;});
 root.querySelectorAll('input[type="password"]').forEach(el=>el.maxLength=128);
 root.querySelectorAll('.close:not([aria-label])').forEach(el=>el.setAttribute('aria-label','Close'));
}
function downloadText(name,text,type='application/json'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportCalendar(){
 const start=today(),end=addDays(start,366),lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//RenewalRadar//Renewal reminders//EN','CALSCALE:GREGORIAN'];
 const escapeICS=value=>String(value).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/[,;]/g,c=>'\\'+c);
 for(const s of state.subscriptions){let d=nextRenewal(s,start);while(d<end){lines.push('BEGIN:VEVENT',`UID:${s.uid}-${d}@renewalradar`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${d.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${addDays(d,1).replace(/-/g,'')}`,`SUMMARY:${escapeICS(displayName(s)+' — '+money(s.price))}`,'DESCRIPTION:Scheduled renewal. Check the provider before cancelling.','BEGIN:VALARM',`TRIGGER:-P${state.settings.reminderDays}D`,'ACTION:DISPLAY','DESCRIPTION:Upcoming renewal','END:VALARM','END:VEVENT');d=nextRenewal(s,addDays(d,1));}}
 lines.push('END:VCALENDAR');
 // Fold at <= 75 UTF-8 octets, including the continuation space.
 const folded=lines.map(line=>{let out='',part='',bytes=0;for(const c of line){const n=new TextEncoder().encode(c).length;if(bytes+n>74){out+=part+'\r\n ';part='';bytes=1;}part+=c;bytes+=n;}return out+part;}).join('\r\n')+'\r\n';
 downloadText('renewalradar-reminders.ics',folded,'text/calendar;charset=utf-8');
}
async function uploadDocument(e){const input=e.currentTarget,file=input.files?.[0];if(!file)return;if(file.size===0||file.size>5*1024*1024){toast('Choose a non-empty file up to 5 MB.','error');input.value='';return;}input.disabled=true;try{
 const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read the file.'));reader.readAsDataURL(file);});
 await api('/api/documents',{method:'POST',body:JSON.stringify({name:file.name,base64})});state.documents=(await api('/api/documents')).documents;toast('Document saved.','success');render();
 }catch(e){toast(e.message,'error');}finally{input.disabled=false;input.value='';}}
function deleteDocumentModal(id){const doc=state.documents.find(d=>d.id===id);if(!doc)return;showModal(`<div class="modal-head"><h2>Delete document?</h2><button class="close" aria-label="Close" data-close-modal>${svgIcon('close')}</button></div><p data-user-content>${esc(doc.name)}</p><div class="modal-actions"><button class="btn btn-secondary" data-close-modal>Keep file</button><button class="btn btn-danger" data-confirm-doc>Delete document</button></div>`);modalRoot.querySelector('[data-confirm-doc]').addEventListener('click',e=>runAction(e.currentTarget,async()=>{await api('/api/documents/'+id,{method:'DELETE'});state.documents=state.documents.filter(d=>d.id!==id);closeModal();render();}));}
function bindAccountActions(){bindLifecycleActions();
 document.querySelector('[data-reload-account]')?.addEventListener('click',confirmRefresh);
 document.querySelector('[data-password-form]')?.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form);runAction(form.querySelector('button'),async()=>{await api('/api/account/password',{method:'POST',body:JSON.stringify(Object.fromEntries(fd))});form.reset();form.dataset.dirty='false';setFormMessage(form,'Password updated. Other sessions have been signed out.','success');},form);});
 document.querySelector('[data-reminder-form]')?.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form);runAction(form.querySelector('button:not([type="button"])'),async()=>{await saveAccount(state.subscriptions,{...state.settings,timeZone:fd.get('timeZone'),reminderDays:Number(fd.get('reminderDays')),emailReminders:fd.has('emailReminders')});form.dataset.dirty='false';toast('Reminder preferences saved.','success');});});
 document.querySelector('[data-verify-email]')?.addEventListener('click',e=>runAction(e.currentTarget,async()=>{await api('/api/reminders/verify',{method:'POST',body:'{}'});toast('Check your email for a verification link.','success');}));
 document.querySelector('[data-export-calendar]')?.addEventListener('click',exportCalendar);
 document.querySelector('[data-export-data]')?.addEventListener('click',()=>downloadText('renewalradar-subscriptions.json',JSON.stringify({subscriptions:state.subscriptions,settings:state.settings},null,2)));
 document.querySelector('[data-import-local]')?.addEventListener('click',importLocalModal);
 const emailToken=new URLSearchParams(location.search).get('emailToken');if(emailToken&&location.pathname==='/dashboard/settings')confirmEmailChange(emailToken);
 const token=new URLSearchParams(location.search).get('verify');
 if(token&&location.pathname==='/dashboard/settings'){
  history.replaceState({},'',location.pathname);
  showModal(`<div class="modal-head"><h2>Verify email</h2><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><p>Confirm this address before enabling reminders.</p><button class="btn btn-primary" data-confirm-email>Confirm email</button>`);
  modalRoot.querySelector('[data-confirm-email]').addEventListener('click',e=>runAction(e.currentTarget,async()=>{acceptAccount(await api('/api/reminders/confirm',{method:'POST',body:JSON.stringify({token})}));closeModal();render();toast('Email verified. You can enable reminders now.','success');}));
 }
}
function importLocalModal(){
 const items=storageJson('rr_subscriptions',[]);if(!Array.isArray(items)||!items.length){toast('No previous records were found for this account on this browser.');return;}
 showModal(`<div class="modal-head"><h2>Import previous records?</h2><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><p>Check these records belong to you before importing. Existing IDs will be skipped.</p><p>Old usage counts have no timestamp. Record the last-used date again after importing.</p><ul>${items.map(s=>`<li>${esc(s.name)} — ${money(s.price)}</li>`).join('')}</ul><button class="btn btn-primary" data-confirm-import>Import records</button>`);
 modalRoot.querySelector('[data-confirm-import]').addEventListener('click',e=>runAction(e.currentTarget,async()=>{
  const imported=items.filter(s=>!state.subscriptions.some(x=>x.uid===s.uid)).map(s=>({...s,renewalDate:dateKey(s.renewalDate),lastUsedDate:s.lastUsedDate||null,lastReviewedDate:null,priceHistory:[]}));
  await saveAccount([...state.subscriptions,...imported]);closeModal();render();toast('Records imported.','success');
 }));
}
function accountSettingsExtras(){return `<article class="card settings-card"><h2>Account backup</h2><p class="muted">Download your records and actual document files in one private backup.</p><a class="btn btn-secondary" href="/api/account/export" download>Download full backup</a><label class="btn btn-secondary file-button">Import backup<input type="file" accept=".json,application/json" class="sr-only" data-import-backup aria-label="Import backup"></label><small class="muted">Imports merge with your account. Existing subscription IDs and identical files are skipped.</small></article><article class="card settings-card"><h2>Active sessions</h2><p class="muted">Review sign-ins and sign out your other sessions.</p><button class="btn btn-secondary" data-sessions>Manage sessions</button><button class="btn btn-secondary" data-change-email ${state.meta.mailReady?'':'disabled'}>Change email</button>${state.meta.mailReady?'':'<small class="muted">Email delivery must be configured to change your address.</small>'}</article><article class="card settings-card danger-zone"><h2>Delete account</h2><p class="muted">Permanently remove your account, subscriptions and uploaded files from this server. Download a backup first. Your paid Pro subscription will be canceled immediately. This does not issue a refund.</p><button class="btn btn-danger" data-delete-account>Delete account</button></article>`;}
function bindLifecycleActions(){
 document.querySelector('[data-import-backup]')?.addEventListener('change',previewBackup);
 document.querySelector('[data-sessions]')?.addEventListener('click',sessionsModal);
 document.querySelector('[data-change-email]')?.addEventListener('click',changeEmailModal);
 document.querySelector('[data-delete-account]')?.addEventListener('click',deleteAccountModal);
}
function hasDraft(){return !!app.querySelector('form[data-dirty="true"]')||!!modalRoot.firstChild;}
function updateSyncBanner(){
 const content=app.querySelector('.dash-content');if(!content)return;
 let banner=content.querySelector('[data-sync-banner]');
 const message=state.remotePending?'New changes are available. Reload when you finish editing.':state.networkError;
 if(!message){banner?.remove();return;}
 if(!banner){content.insertAdjacentHTML('afterbegin','<div class="sync-banner" data-sync-banner role="status"><span></span><button class="btn btn-secondary btn-small" data-refresh-records>Reload latest records</button></div>');banner=content.querySelector('[data-sync-banner]');banner.querySelector('button').addEventListener('click',confirmRefresh);}
 banner.querySelector('span').textContent=translateText(message,state.lang);translateSurface(banner);
}
async function refreshAccount(background=false){
 if(!state.user||state.syncing||state.mutations)return;
 if(background&&typeof document.visibilityState==='string'&&document.visibilityState==='hidden')return;
 const accountId=state.user.id;state.syncing=true;
 try{
  const me=await api('/api/auth/me');
  if(!me.user||me.user.id!==accountId){clearIdentity();navigate('/login');toast('Your session changed. Sign in again.','error');return;}
  const [data,docs]=await Promise.all([api('/api/data'),api('/api/documents')]);
  if(state.user?.id!==accountId||state.mutations||data.version<state.version)return;
  const changed=JSON.stringify(data.billing)!==JSON.stringify(state.billing)||data.version!==state.version||JSON.stringify(docs.documents)!==JSON.stringify(state.documents)||me.user.name!==state.user.name||me.user.email!==state.user.email;
  if(background&&(hasDraft()||document.activeElement?.matches?.('input,select,textarea'))){state.remotePending=state.remotePending||changed;state.networkError='';updateSyncBanner();return;}
  const previousScroll=window.scrollY||0;acceptAccount(data);state.documents=docs.documents;state.user=me.user;
  if(changed||!background){render();window.scrollTo({top:previousScroll,behavior:'auto'});}else updateSyncBanner();
 }catch(e){if(state.user?.id===accountId){state.networkError=e.message;updateSyncBanner();}}
 finally{state.syncing=false;}
}
function confirmRefresh(){
 if(!hasDraft()){refreshAccount();return;}
 const previous=[...modalRoot.childNodes];previous.forEach(n=>n.remove());
 showModal(`<div class="modal-head"><h2>Reload latest records?</h2></div><p>Unsaved changes in open forms will be discarded. Saved records stay on the server.</p><div class="modal-actions"><button class="btn btn-secondary" data-keep-editing>Keep editing</button><button class="btn btn-primary" data-confirm-refresh>Reload latest records</button></div>`);
 const restore=()=>{modalDismiss=null;closeModal();previous.forEach(n=>modalRoot.append(n));if(previous.length){app.inert=true;document.body.classList.add('no-scroll');}};
 modalDismiss=restore;
 modalRoot.querySelector('[data-keep-editing]').addEventListener('click',restore);
 modalRoot.querySelector('[data-confirm-refresh]').addEventListener('click',e=>runAction(e.currentTarget,async()=>{modalDismiss=null;closeModal();await refreshAccount();}));
}

async function previewBackup(e){
 const input=e.currentTarget,file=input.files?.[0];if(!file)return;input.value='';
 try{
  if(file.size>78*1024*1024)throw Error('Backup files must be smaller than 78 MB.');
  const backup=JSON.parse(await file.text()),source=backup.format?backup.data:backup;
  if(!Array.isArray(source?.subscriptions))throw Error('Invalid backup file.');
  const docs=backup.format&&Array.isArray(backup.documents)?backup.documents:[];
  showModal(`<div class="modal-head"><h2>Import backup?</h2><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><p>${translateText('Subscriptions',state.lang)}: ${source.subscriptions.length} · ${translateText('Documents',state.lang)}: ${docs.length}</p><p>Imports merge with your account. Existing subscription IDs and identical files are skipped.</p><p>Email, passwords and reminder preferences will not be changed.</p><div data-form-message></div><button class="btn btn-primary" data-confirm-backup>Import backup</button>`);
  modalRoot.querySelector('[data-confirm-backup]').addEventListener('click',event=>runAction(event.currentTarget,async()=>{await api('/api/account/import',{method:'POST',body:JSON.stringify({version:state.version,backup})});closeModal();await refreshAccount();toast('Backup imported.','success');},modalRoot.querySelector('.modal')));
 }catch(e){toast(e instanceof SyntaxError?'Invalid backup file.':e.message,'error');}
}
async function sessionsModal(){
 showModal(`<div class="modal-head"><h2>Active sessions</h2><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><p data-session-loading>Loading sessions…</p>`);
 const host=modalRoot.querySelector('.modal');
 try{const {sessions}=await api('/api/account/sessions');if(!host.isConnected)return;
 host.querySelector('[data-session-loading]').remove();host.insertAdjacentHTML('beforeend',`<ul class="session-list">${sessions.map(s=>`<li><strong>${translateText(s.current?'This session':'Other session',state.lang)}</strong><span>${new Date(s.createdAt).toLocaleString(locale())}</span><small>${translateText('Expires',state.lang)}: ${new Date(s.expiresAt).toLocaleDateString(locale())}</small></li>`).join('')}</ul><form class="form" data-revoke-sessions><div data-form-message></div><div class="field"><label>Current password</label><input class="input" type="password" name="password" minlength="8" maxlength="128" autocomplete="current-password" required></div><button class="btn btn-primary" ${sessions.filter(s=>!s.current).length?'':'disabled'}>Sign out other sessions</button></form>`);enhanceForms(modalRoot);translateSurface(modalRoot);
 host.querySelector('form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;runAction(form.querySelector('button'),async()=>{await api('/api/account/sessions/revoke-others',{method:'POST',body:JSON.stringify({password:new FormData(form).get('password')})});sessionsModal();},form);});
 }catch(e){if(host.isConnected){host.querySelector('[data-session-loading]').textContent=translateText(e.message,state.lang);}}
}
function changeEmailModal(){showModal(`<div class="modal-head"><h2>Change email</h2><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><p>We will send a confirmation to your new address. Your current email stays active until you confirm.</p><form class="form" data-email-form><div data-form-message></div><div class="field"><label>New email</label><input class="input" name="email" type="email" autocomplete="email" maxlength="254" required></div><div class="field"><label>Current password</label><input class="input" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required></div><button class="btn btn-primary">Send confirmation</button></form>`);modalRoot.querySelector('form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;runAction(form.querySelector('button'),async()=>{await api('/api/account/email',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.reset();setFormMessage(form,'Check your new email for the confirmation link.','success');},form);});}
function confirmEmailChange(token){
 showModal(`<div class="modal-head"><h2>Confirm email change</h2><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><p>Your other sessions will be signed out. Email reminders will be turned off until you enable them again.</p><button class="btn btn-primary" data-confirm-email-change>Confirm email change</button>`);
 modalRoot.querySelector('[data-confirm-email-change]').addEventListener('click',e=>runAction(e.currentTarget,async()=>{const data=await api('/api/account/email/confirm',{method:'POST',body:JSON.stringify({token})});state.user=data.user;history.replaceState({},'',location.pathname);closeModal();await refreshAccount();toast('Email updated.','success');}));
}
function deleteAccountModal(){showModal(`<div class="modal-head"><h2>Delete account</h2><button class="close" data-close-modal aria-label="Close">${svgIcon('close')}</button></div><p>Permanently remove your account, subscriptions and uploaded files from this server. Download a backup first. Your paid Pro subscription will be canceled immediately. This does not issue a refund.</p><form class="form" data-delete-account-form><div data-form-message></div><div class="field"><label>Type your account email</label><input class="input" name="confirmEmail" type="email" autocomplete="off" required></div><div class="field"><label>Current password</label><input class="input" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required></div><button class="btn btn-danger">Permanently delete account</button></form>`);modalRoot.querySelector('form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;runAction(form.querySelector('button'),async()=>{const oldId=state.user.id;await api('/api/account/delete',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});for(const key of ['rr_subscriptions','rr_docs','rr_tip_dismissed','rr_demo_pro','rr_pro_offer_start'])browserStore.removeItem(`${key}:${oldId}`);clearIdentity();navigate('/');toast('Account deleted.','success');},form);});}

function changeLanguage(lang){
 const drafts=[...app.querySelectorAll('form')].map(form=>({selector:form.hasAttribute('data-profile-form')?'[data-profile-form]':form.hasAttribute('data-reminder-form')?'[data-reminder-form]':form.hasAttribute('data-password-form')?'[data-password-form]':form.hasAttribute('data-auth-form')?'[data-auth-form]':null,dirty:form.dataset.dirty,fields:[...form.querySelectorAll('input[name],select[name],textarea[name]')].map(el=>({name:el.name,value:el.value,checked:el.checked}))}));
 state.lang=lang;savePreference('rr_lang',lang);render();
 for(const draft of drafts){if(!draft.selector)continue;const form=app.querySelector(draft.selector);if(!form)continue;form.dataset.dirty=draft.dirty||'false';for(const v of draft.fields){const el=[...form.querySelectorAll('[name]')].find(el=>el.name===v.name);if(el){if(el.tagName==='SELECT'){for(const option of el.options)option.selected=option.value===v.value;}else el.value=v.value;if(el.type==='checkbox')el.checked=v.checked;}}}
}
function translateSurface(root){
 if(state.lang==='en')return;
 root.querySelectorAll('option').forEach(option=>{if(!option.hasAttribute('value'))option.value=option.textContent;});
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
 while(node=walker.nextNode())if(!node.parentElement.closest('[data-user-content],script,style,textarea'))node.textContent=translateText(node.textContent,state.lang);
 root.querySelectorAll('[aria-label],[placeholder],[title]').forEach(el=>{for(const attr of ['aria-label','placeholder','title'])if(el.hasAttribute(attr))el.setAttribute(attr,translateText(el.getAttribute(attr),state.lang));});
}
document.addEventListener('click',globalOutsideClick);
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){document.querySelectorAll('.lang-menu.open,.profile-menu.open,.mobile-menu.open').forEach(el=>el.classList.remove('open'));closeSidebar();}
 if(e.key==='Tab'&&modalRoot.firstChild){const els=[...modalRoot.querySelectorAll('button:not(:disabled),a[href],input:not([type="hidden"]):not(:disabled),select:not(:disabled),textarea')].filter(el=>!el.hidden);if(!els.length){e.preventDefault();return;}const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
});
function closeSidebar(){document.querySelector('.dash-main')?.removeAttribute('inert');document.querySelector('[data-sidebar]')?.classList.remove('open');document.querySelector('[data-sidebar-backdrop]')?.remove();document.querySelector('[data-sidebar-toggle]')?.setAttribute('aria-expanded','false');document.body.classList.remove('sidebar-open');}
function toggleSidebar(){const sidebar=document.querySelector('[data-sidebar]');if(sidebar?.classList.contains('open')){closeSidebar();return;}sidebar?.classList.add('open');document.querySelector('.dash-main')?.setAttribute('inert','');sidebar?.querySelector('a')?.focus();document.body.classList.add('sidebar-open');document.querySelector('[data-sidebar-toggle]')?.setAttribute('aria-expanded','true');const backdrop=document.createElement('button');backdrop.className='sidebar-backdrop';backdrop.dataset.sidebarBackdrop='';backdrop.setAttribute('aria-label','Close navigation');backdrop.addEventListener('click',closeSidebar);app.append(backdrop);}

function safeHash(hash){try{return decodeURIComponent(hash.slice(1));}catch{return '';}}
setInterval(()=>refreshAccount(true),15000);
window.addEventListener('focus',()=>refreshAccount(true));
window.addEventListener('online',()=>refreshAccount(true));
let lastRenderedDay=today();
setInterval(()=>{const day=today();if(day!==lastRenderedDay&&!modalRoot.firstChild&&!app.querySelector('form')){lastRenderedDay=day;render();}},60000);
window.addEventListener('popstate',render);
window.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();document.querySelector('[data-sidebar]')?.classList.remove('open');}});
await loadSession();
await loadUserLocalState();
applyTheme();
render();
const billingReturn=new URLSearchParams(location.search);if(state.user&&(billingReturn.has('checkout')||billingReturn.has('billing'))){history.replaceState({},'',location.pathname);if(billingReturn.get('checkout')==='canceled')toast('Checkout canceled.');else{try{await api('/api/billing/refresh',{method:'POST',body:'{}'});await refreshAccount();toast(state.pro?'Pro active':'Payment is still being confirmed. Refresh billing status shortly.');}catch(e){toast(e.message,'error');}}}
