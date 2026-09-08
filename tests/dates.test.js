import test from 'node:test';
import assert from 'node:assert/strict';
import {dateKey,validDate,nextRenewal,monthRenewals,dayDifference,annualAmount} from '../public/assets/dates.js';
const sub=(renewalDate,cycle='Monthly')=>({renewalDate,cycle});
test('never invent renewals before the anchor date',()=>{
 assert.equal(nextRenewal(sub('2026-12-20'),'2026-09-08'),'2026-12-20');
 assert.equal(nextRenewal(sub('2027-10-20','Yearly'),'2026-09-08'),'2027-10-20');
 assert.deepEqual(monthRenewals(sub('2026-12-20'),2026,8),[]);
 assert.deepEqual(monthRenewals(sub('2026-12-20','Weekly'),2026,8),[]);
});
test('today remains today, including after noon in Sofia',()=>{
 const s=sub('2026-09-08');
 for(const time of ['2026-09-08T06:00:00Z','2026-09-08T20:59:00Z']){
  const today=dateKey(new Date(time),'Europe/Sofia');assert.equal(nextRenewal(s,today),'2026-09-08');assert.equal(dayDifference(nextRenewal(s,today),today),0);
 }
 assert.equal(nextRenewal(s,'2026-09-09'),'2026-10-08');
});
test('clamps month end without drifting and preserves leap-day anchor',()=>{
 const s=sub('2024-01-31');assert.equal(nextRenewal(s,'2024-02-01'),'2024-02-29');assert.equal(nextRenewal(s,'2024-03-01'),'2024-03-31');
 assert.equal(nextRenewal(sub('2024-02-29','Yearly'),'2025-01-01'),'2025-02-28');assert.equal(nextRenewal(sub('2024-02-29','Yearly'),'2028-01-01'),'2028-02-29');
});
test('weekly arithmetic spans daylight-saving changes and counts every occurrence',()=>{
 assert.deepEqual(monthRenewals(sub('2026-03-01','Weekly'),2026,2),['2026-03-01','2026-03-08','2026-03-15','2026-03-22','2026-03-29']);
 assert.equal(nextRenewal(sub('2026-03-22','Weekly'),'2026-03-30'),'2026-04-05');
});
test('date validation and currency normalization',()=>{
 assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2024-02-29'),true);assert.equal(validDate('x'),false);
 assert.equal(annualAmount({price:120,cycle:'Yearly'})/12,10);assert.equal(annualAmount({price:3,cycle:'Weekly'})/12,13);
});
