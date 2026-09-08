// Date-only arithmetic. UTC is used only as a stable calendar, never a billing time.
export function dateKey(value = new Date(), timeZone) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) throw new Error('Invalid date');
  if (timeZone) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(d).map(p=>[p.type,p.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function validDate(s) {
  return typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && s>='1900-01-01' && s<='9998-12-31' && !Number.isNaN(Date.parse(s)) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
}
const stamp = s => Date.parse(s+'T00:00:00Z');
export const dayDifference = (a,b) => Math.round((stamp(a)-stamp(b))/86400000);
export function addDays(s,n) { return new Date(stamp(s)+n*86400000).toISOString().slice(0,10); }
function monthDate(y,m,day) {return new Date(Date.UTC(y,m,Math.min(day,new Date(Date.UTC(y,m+1,0)).getUTCDate()))).toISOString().slice(0,10);}
export function nextRenewal(s,from=dateKey()) {
  const anchor=dateKey(s.renewalDate);
  if(!validDate(anchor)||!validDate(from)) throw new Error('Invalid renewal date');
  if(from<=anchor)return anchor;
  const [ay,am,ad]=anchor.split('-').map(Number),[fy,fm]=from.split('-').map(Number);
  if(s.cycle==='Weekly')return addDays(anchor,Math.ceil(dayDifference(from,anchor)/7)*7);
  if(s.cycle==='Yearly'){let result=monthDate(fy,am-1,ad);return result>=from?result:monthDate(fy+1,am-1,ad);}
  let result=monthDate(fy,fm-1,ad);return result>=from?result:monthDate(fy,fm,ad);
}
export function monthRenewals(s,year,month) {
  const start=monthDate(year,month,1),end=monthDate(year,month+1,1),out=[];
  let d=nextRenewal(s,start);
  while(d<end){out.push(d);d=nextRenewal(s,addDays(d,1));}
  return out;
}
export const annualAmount = s => Math.round(Number(s.price)*100)*(s.cycle==='Yearly'?1:s.cycle==='Weekly'?52:12)/100;
