import test from 'node:test';import assert from 'node:assert/strict';
import {readStatement,decodeStatement,detectColumns,applyMapping,parseAmount,parseDate,analyzeTransaction,detectRecurring,fingerprintBases,spendingSummary,merchantOf} from '../public/assets/transactions.js';

// Minimal Windows-1251 encoder for ASCII and А-я, enough for a Bulgarian bank export.
const cp1251=s=>Uint8Array.from([...s].map(c=>{const code=c.charCodeAt(0);return code>=0x410&&code<=0x44f?code-0x350:code;}));

test('amounts in European and English formats',()=>{
 for(const [input,value] of [['1 234,56',1234.56],['1.234,56',1234.56],['1,234.56',1234.56],['-12,50',-12.5],['12.50-',-12.5],['(9.99)',-9.99],['+1000',1000],['€12.00',12],['1 000,00 лв.',1000],['12.50 DR',-12.5],['0,125',0.125]])assert.equal(parseAmount(input)?.value,value,input);
 assert.equal(parseAmount('12.50 EUR').currency,'EUR');assert.equal(parseAmount('12,00 лв.').currency,'BGN');
 for(const bad of ['','abc','12.03.2026','1,2,3'])assert.equal(parseAmount(bad),null,bad);
});

test('dates use the chosen day/month order and reject impossible days',()=>{
 assert.equal(parseDate('31.12.2026'),'2026-12-31');assert.equal(parseDate('12/31/2026','MDY'),'2026-12-31');assert.equal(parseDate('2026-03-05 10:15:22'),'2026-03-05');
 assert.equal(parseDate('05.03.26 г.'),'2026-03-05');assert.equal(parseDate('5 Mar 2026'),'2026-03-05');assert.equal(parseDate('31.02.2026'),null);
});

test('Windows-1251 Bulgarian statement with preamble and debit/credit columns',()=>{
 const csv=['Извлечение по сметка','Период: 01.06.2026 - 31.08.2026','','Дата;Основание;Контрагент;Дебит;Кредит;Валута',
  '10.06.2026;Абонамент;NETFLIX.COM;13,99;;EUR','10.07.2026;Абонамент;NETFLIX.COM;13,99;;EUR','09.08.2026;Абонамент;NETFLIX.COM;13,99;;EUR',
  '12.06.2026;Покупка;KAUFLAND BG 1234;45,20;;EUR','15.06.2026;Заплата;ACME OOD;;2 500,00;EUR','16.06.2026;Сторно покупка;KAUFLAND BG 1234;;5,00;EUR',
  '17.06.2026;Превод между собствени сметки;;200,00;;EUR','32.06.2026;Грешен ред;X;1,00;;EUR','Крайно салдо;;;;;'].join('\r\n');
 const text=decodeStatement(cp1251(csv));assert.match(text,/Контрагент/);
 const {delimiter,rows}=readStatement(text);assert.equal(delimiter,';');
 const detected=detectColumns(rows);assert.equal(detected.confident,true);assert.equal(detected.headerIndex,2);
 assert.deepEqual(detected.mapping,['date','description','counterparty','debit','credit','currency']);
 const parsed=applyMapping(rows,{...detected,currency:'EUR'}),valid=parsed.filter(r=>!r.error),invalid=parsed.filter(r=>r.error);
 assert.equal(valid.length,7);assert.deepEqual(invalid.map(r=>r.error),['Invalid date','Invalid date']);
 const netflix=valid[0];assert.equal(netflix.amount,-13.99);assert.equal(netflix.description,'NETFLIX.COM · Абонамент');
 const kinds=valid.map(r=>({...r,...analyzeTransaction(r)}));
 assert.deepEqual(kinds.map(r=>r.kind),['expense','expense','expense','expense','income','refund','transfer']);
 assert.equal(kinds[0].category,'Entertainment');assert.equal(kinds[3].category,'Food & groceries');assert.equal(kinds[5].category,'Food & groceries');assert.equal(kinds[4].category,null);
 const series=detectRecurring(kinds);assert.equal(series.length,1);assert.equal(series[0].merchant,'Netflix');assert.equal(series[0].cycle,'Monthly');assert.equal(series[0].count,3);assert.equal(series[0].nextDate,'2026-09-09');
});

test('unrecognised headers produce a guessed mapping that the user must confirm',()=>{
 const {rows}=readStatement('a,b,c\n2026-01-05,Coffee shop,-3.50\n2026-01-06,Bakery,-2.10');const d=detectColumns(rows);
 assert.equal(d.confident,false);assert.equal(d.headerIndex,0);assert.deepEqual(d.mapping,['date','description','amount']);
 assert.equal(applyMapping(rows,d).filter(r=>!r.error).length,2);
 const usd=readStatement('A;B;C;D\n01.08.2026;Shop;-1,00;USD\n02.08.2026;Cafe;-2,00;USD').rows,du=detectColumns(usd);
 assert.deepEqual(du.mapping,['date','description','amount','currency']);assert.ok(applyMapping(usd,{...du,currency:'EUR'}).every(r=>r.currency==='USD'));
});

test('irregular grocery amounts are not subscriptions; identical rows keep distinct fingerprints',()=>{
 const groceries=[['2026-01-03',-45.2],['2026-01-10',-12.3],['2026-01-17',-80]].map(([date,amount])=>({date,amount,currency:'EUR',kind:'expense',merchant:'Lidl',merchantKey:'lidl',category:'Food & groceries'}));
 assert.equal(detectRecurring(groceries).length,0);
 const fp=fingerprintBases([{date:'2026-01-01',amount:-3,currency:'EUR',description:'Coffee'},{date:'2026-01-01',amount:-3,currency:'EUR',description:'Coffee'}]);
 assert.notEqual(fp[0].key,fp[1].key);assert.equal(fp[1].occurrence,1);
});

test('totals keep currencies apart and exclude income and own transfers',()=>{
 const t=(amount,kind,currency='EUR',category='Shopping')=>({amount,kind,currency,category});
 const s=spendingSummary([t(-100,'expense'),t(10,'refund'),t(500,'income','EUR',null),t(-50,'transfer','EUR',null),t(-20,'expense','USD')]);
 assert.deepEqual(s.EUR,{spending:9000,income:50000,transfers:5000,categories:{Shopping:9000}});assert.equal(s.USD.spending,2000);
});

test('merchant names ignore card and location noise',()=>{
 assert.equal(merchantOf('POS 12.03 KAUFLAND BG 1234 SOFIA').name,'Kaufland');
 assert.equal(merchantOf('CARD PAYMENT DM DROGERIE 4169').name,'DM Drogerie');
 assert.equal(merchantOf('Card transaction of 45.00 GBP issued by Tesco').name,'Tesco');
});
