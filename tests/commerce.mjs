import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync('docs/commerce.js','utf8');
const ret={id:'r1',created_at:'2026-11-10T12:00:00Z',sale_id:'s1',shop_id:'shop',day_id:'new',device_id:'d',device_name:'Phone',qty:1,amount:130,buy_price:100,restock:true,pay:'cashier',reason:'return reason',actor_id:'owner'};
let pending=[];
const ctx={window:{},DEMO:false,me:{id:'owner',role:'admin'},ui:{modal:null},S:{sales:[{id:'s1',qty:2,price:130,buy:100,shopId:'shop',name:'Phone'}],users:[]},must:r=>{if(r.error)throw r.error;return r.data;},sb:{rpc:async name=>({data:name==='hcash_returns_page'?[ret]:name==='hcash_can_cost'?true:[]}),from:()=>({select:async()=>({data:[]})})},latin:String,esc:String,nf:String,money:String,sheet:(head,body)=>head+body,user:()=>({name:'Owner'}),shop:()=>({name:'Shop'}),tm:()=>'',dayLabel:x=>x,dayOf:()=>'',dn:x=>x,onKeys:()=>['cashier','acc'],saleTot:()=>({cashier:260,acc:0,hcash:0,total:260,profit:60,count:2}),daySales:()=>[],uuid:()=> 'request-id',formErr:()=> 'invalid',HCashReceipts:{submit:(...args)=>pending.push(args)},document:{querySelector:()=>null,addEventListener(){}},setTimeout:()=>1,clearTimeout(){}};
vm.runInNewContext(source,ctx);const api=ctx.window.HCashCommerce;await api.load();
assert.equal(api.remaining(ctx.S.sales[0]),1);
const net=api.dayNet({id:'new'});assert.equal(net.cashier,130);assert.equal(net.profit,30);assert.equal(net.returned,1);
const damaged=api.net({cashier:0,acc:0,hcash:0,total:0,profit:0,count:0},[{pay:'acc',amount:130,qty:1,buy:100,restock:false}]);assert.equal(damaged.profit,-130);assert.equal(damaged.acc,-130);
ctx.me={id:'worker',role:'cashier',view_cost:false};assert.equal(api.canCost(),false);assert(!api.modal({kind:'detail',ref:'sale:s1'}).includes('سعر الشراء'),'hidden cost must not appear in sale details');
ctx.me={id:'owner',role:'admin'};const A={saveSale(){}},F={};api.install(A,F);ctx.ui.modal={kind:'return',id:'s1',requestId:'same-id'};
const fd=new FormData();for(const [k,v] of Object.entries({qty:'1',amount:'130',reason:'valid reason',restock:'true',pay:'cashier'}))fd.set(k,v);
F.returnf(fd);assert.equal(pending.length,1);assert.equal(pending[0][0],'return');assert.equal(pending[0][1].p_id,'same-id');assert.equal(pending[0][1].p_restock,true);
fd.set('qty','2');F.returnf(fd);assert.equal(pending.length,1,'cannot return more than the remaining quantity');
console.log('PASS: net drawer/profit accounting, damaged returns, details privacy and validated durable refund commands');

