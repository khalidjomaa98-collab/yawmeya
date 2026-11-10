import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../docs/receipts.js',import.meta.url),'utf8');
const payload={p_id:'10000000-0000-4000-8000-000000000001',p_shop:'shop',p_party:'party',p_name:null,p_type:'took',p_amount:50,p_note:'test'};
function setup(store=new Map(),reply={data:{id:payload.p_id,_receipt_replayed:false}}){
 const calls=[];const context={window:{},me:{id:'worker'},DEMO:false,ui:{},S:{txs:[],sales:[]},Intl,Date,JSON,Promise,AbortController,setTimeout:()=>1,clearTimeout(){},render(){},toast(){},errText:()=>'',refresh:async()=>{},mapTx:x=>x,mapSale:x=>x,upsert:(rows,x)=>{const i=rows.findIndex(r=>r.id===x.id);if(i<0)rows.push(x);else rows[i]=x;},document:{addEventListener(){}},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},sb:{rpc(name,args){calls.push({name,args});return {abortSignal:async()=>reply};}}};
 vm.runInNewContext(source,context);return {api:context.window.HCashReceipts,context,calls,store};
}
{
 const first=setup(new Map(),{error:{message:'network'}});
 assert.equal(await first.api.submit('tx',payload,'test'),false);assert.ok(first.api.read());assert.equal(first.context.ui.saving,false);
 const reopened=setup(first.store,{data:{id:payload.p_id,_receipt_replayed:true}});
 assert.equal(await reopened.api.retry(),true);assert.equal(reopened.calls[0].args.p_id,payload.p_id,'app reopening retries the original ID');assert.equal(reopened.api.read(),null);assert.equal(reopened.context.S.txs.length,0,'replayed receipts are not inserted optimistically again');
}
{
 const t=setup(new Map(),{error:{code:'22023',message:'invalid'}});await t.api.submit('tx',payload,'test');assert.equal(t.api.read(),null,'definitive first-attempt rejection releases the failed receipt');
}
{
 const t=setup();t.context.localStorage.setItem=()=>{throw Error('quota');};assert.equal(await t.api.submit('tx',payload,'test'),false);assert.equal(t.calls.length,0,'never send without preserving the original command first');
}
{
 const t=setup(new Map(),{error:{message:'network'}});await t.api.submit('sale',payload,'test');t.context.me={id:'another-worker'};assert.equal(t.api.read(),null,'a different signed-in user does not see the pending receipt');
}
const app=fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8');
const pageCode=app.slice(app.indexOf('async function readPages('),app.indexOf('async function refresh('));
const context={must:r=>{if(r.error)throw r.error;return r.data;}};vm.createContext(context);vm.runInContext(pageCode,context);
const rows=Array.from({length:1236},(_,id)=>({id})),offsets=[];
const result=await context.readPages(()=>({range:async(start,end)=>{offsets.push(start);return {data:rows.slice(start,end+1)};}}));
assert.equal(result.data.length,1236);assert.deepEqual(offsets,[0,500,1000]);
console.log('PASS: persisted receipt retry, replay safety, rejection, storage failure, user isolation and batched reads');

{
 const uncertain=setup(new Map(),{error:{message:'network'}});await uncertain.api.submit('sale',payload,'approval test');
 const rejected=setup(uncertain.store,{error:{code:'42501',message:'MIN_PRICE_APPROVAL'}});await rejected.api.retry();assert.equal(rejected.api.read(),null,'an expired approval rejects a new insert atomically, so it cannot strand a pending command');
}
