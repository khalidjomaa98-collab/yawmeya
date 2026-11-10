import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const app=fs.readFileSync('docs/app.js','utf8');
const refreshCode=app.slice(app.indexOf('async function refresh(){'),app.indexOf('async function fetchDay('));
const loginCode=app.slice(app.indexOf('let initialLoadGeneration='),app.indexOf('async function fnCall('));
const empty=()=>({shops:[{id:'shop'}],users:[{id:'worker',shop_id:'shop'}],parties:[],txs:[],sales:[],days:[],devices:[],notes:[],drawers:[],returns:[],preferences:[],view_cost:false});
{
 let resolveSnapshot,hrStarted=0,calls=0,applied=0;
 const ctx={DEMO:false,me:{id:'worker',role:'cashier'},ui:{},S:{sales:[],txs:[]},extraDays:[],must:r=>r.data,Attendance:{load(){hrStarted++;return new Promise(()=>{});}},softRender(){},HCashCommerce:{applySnapshot(){applied++;}},sb:{rpc(name){assert.equal(name,'hcash_ledger_snapshot');calls++;return new Promise(r=>resolveSnapshot=r);}},setDrawers(){},mapDev:x=>x,mapSale:x=>x,mapTx:x=>x,mapDay:x=>x,mapNote:x=>x,user:()=>({shop_id:'shop'}),shop:()=>null};
 vm.createContext(ctx);vm.runInContext(refreshCode,ctx);
 const work=ctx.refresh();assert.equal(calls,1,'ledger must start immediately, without awaiting HR');assert.equal(hrStarted,1);
 resolveSnapshot({data:empty()});await work;assert.equal(applied,1,'ledger completes even while HR is still pending');
 assert.equal(ctx.ui.shopId,'shop');
 const second=ctx.refresh();ctx.me={id:'other',role:'cashier'};resolveSnapshot({data:empty()});await second;assert.equal(applied,1,'late snapshots cannot cross account boundaries');
}
function loginContext(refresh){
 const ctx={ui:{},me:null,refresh,render(){ctx.renderCount++;},renderCount:0,subscribe(){},registerPush:async()=>{},lsGet:()=>null,sb:{from(){throw Error('unnecessary profile network request');},auth:{signOut:async()=>{}}}};
 vm.createContext(ctx);vm.runInContext(loginCode,ctx);return ctx;
}
{
 let finish;const ctx=loginContext(()=>new Promise(r=>finish=r));
 await ctx.loadMe('worker',{id:'worker',active:true,role:'cashier',shop_id:'shop'});
 assert.equal(ctx.me.id,'worker');assert.equal(ctx.ui.initialLoading,true);assert.equal(ctx.ui.initialPending,true,'authenticated account can render its loading state before data completes');
 finish();await new Promise(r=>setImmediate(r));assert.equal(ctx.ui.initialLoading,false);assert(ctx.renderCount>0);
}
{
 const ctx=loginContext(async()=>{throw Error('offline');});
 await ctx.loadMe('worker',{id:'worker',active:true,role:'cashier',shop_id:'shop'});await new Promise(r=>setImmediate(r));
 assert.equal(ctx.me.id,'worker','data fetch failure does not turn a correct PIN into a failed login');assert.equal(ctx.ui.initialLoading,true);assert.equal(ctx.ui.initialPending,false);assert(ctx.ui.initialError);
 ctx.refresh=async()=>{};await ctx.hydrateInitialData();assert.equal(ctx.ui.initialLoading,false,'retry can recover without another PIN');
}
{
 let finish;const ctx=loginContext(()=>new Promise(r=>finish=r));
 await ctx.loadMe('worker',{id:'worker',active:true,role:'cashier',shop_id:'shop'});
 ctx.me=null;ctx.ui.initialLoading=false;ctx.ui.initialPending=false;finish();await new Promise(r=>setImmediate(r));assert.equal(ctx.renderCount,0,'background completion after logout cannot reopen an account');
}
console.log('PASS: single ledger request, HR independence, immediate authenticated loading, retry recovery and account isolation');

