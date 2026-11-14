import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const app=fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8');
const code=app.slice(app.indexOf('async function op('),app.indexOf('/* ---------- pieces'));
const ctx={ui:{},DEMO:false,render(){},softRender(){},toast(){},errText:()=>'',async refresh(){},document:{querySelector(){return null;}}};
vm.createContext(ctx);vm.runInContext(code,ctx);
let release,local=0,remote=0;
const pending=ctx.op(()=>local++,()=>new Promise(r=>release=r));
assert.equal(ctx.ui.saveState,'saving');
assert.equal(await ctx.op(()=>local++,async()=>remote++),false);
assert.equal(local,1);assert.equal(remote,0,'second write is blocked while first awaits confirmation');
release();assert.equal(await pending,true);assert.equal(ctx.ui.saveState,'');
assert.equal(await ctx.op(()=>{},async()=>{throw Error('network');}),false);
assert.equal(ctx.ui.saveState,'uncertain');assert.equal(ctx.ui.saving,false);
ctx.S={txs:[],sales:[],days:[]};
ctx.refresh=async()=>{
  assert.equal(ctx.S.txs.length,0,'failed temporary insert must be removed before fetching confirmed data');
  assert.equal(ctx.S.days.length,0,'temporary empty shop day must be removed');
  ctx.S.txs=[{id:'lost-response',pending:false}];
};
await ctx.op(()=>{ctx.S.txs.push({id:'lost-response',dayId:'local-test',pending:true});ctx.S.days.push({id:'local-test'});},async()=>{throw Error('network');});
assert.equal(ctx.S.txs.length,1);assert.equal(ctx.S.txs[0].pending,false,'a committed row recovered after a lost response is confirmed once');
ctx.refresh=async()=>{};
await ctx.op(()=>{throw Error('local failure');},async()=>{});
assert.equal(ctx.ui.saving,false,'local rendering failures must release the save lock');
const drawerContext={
  totals:rows=>({took:rows.filter(t=>t.type==='took'&&!t.deleted).reduce((sum,t)=>sum+t.amount,0),gave:rows.filter(t=>t.type==='gave').reduce((sum,t)=>sum+t.amount,0)}),
  dayTxs:()=>[{drawer:'acc',type:'took',amount:5000},{drawer:'acc',type:'gave',amount:500},{drawer:'cashier',type:'took',amount:100000}],
  HCashCommerce:{dayNet:()=>({acc:200})},
};
vm.createContext(drawerContext);
vm.runInContext(app.slice(app.indexOf('const drawerTxTotals ='),app.indexOf('const lastClosed =')),drawerContext);
assert.equal(vm.runInContext('accessoryNet({accOpening:null})',drawerContext),4700);
assert.equal(vm.runInContext('accOf({accOpening:null})',drawerContext),null);
assert.equal(vm.runInContext('accOf({accOpening:0})',drawerContext),4700);
assert.equal(vm.runInContext('accOf({accOpening:3000})',drawerContext),7700);
console.log('PASS: duplicate-submit guard, failed optimistic cleanup, lost response reconciliation, local-error recovery');
