import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('docs/app.js','utf8');
const alert={hidden:true,dataset:{},innerHTML:'',replaceChildren(){this.innerHTML='';}};
const storage=new Map();
const context={
  APP_VERSION:42,DEMO:false,me:{id:'worker',role:'cashier'},S:{notes:[]},ui:{tab:'kenash'},
  document:{getElementById:()=>alert},lsGet:key=>storage.get(key),lsSet:(key,value)=>storage.set(key,value),
  upsert(rows,value){const index=rows.findIndex(n=>n.id===value.id);if(index<0)rows.push(value);else rows[index]=value;},
  isNative:()=>true,render(){},Attendance:{backToToday(){}},
};
context.A={closeModal(){context.ui.modal=null;},hrBack(){context.ui.hr=false;}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const mapNote ='),source.indexOf('const extraDays =')),context);
vm.runInContext(source.slice(source.indexOf('const shownReleases ='),source.indexOf('const replay =')),context);

const note=(id,recipient_id,read=false)=>({id,recipient_id,kind:'personal',read,text:'sample',ts:'2026-11-12T10:00Z'});
context.receivePersonalMessages([note('other','another-worker')]);
assert.equal(context.S.notes.length,0);
assert.equal(alert.hidden,true);
context.receivePersonalMessages([note('mine','worker'),note('mine','worker')]);
assert.equal(context.S.notes.length,1);
assert.match(alert.innerHTML,/رسالة جديدة من الإدارة/);
context.receivePersonalMessages([note('mine','worker',true),note('mine','worker')]);
assert.equal(alert.hidden,true,'stale push data must not reopen a read notification');

storage.set('hcash-seen-release:worker','41');
context.offerReleaseNotes();
assert.equal(context.ui.modal.kind,'releaseNotes');
assert.equal(context.ui.modal.lastSeen,41);
context.goBackInApp();
context.offerReleaseNotes();
assert.equal(context.ui.modal,null,'the same release opens only once');
context.me={id:'manager',role:'admin'};
context.offerReleaseNotes();
assert.equal(context.ui.modal.lastSeen,0,'release history is scoped to each account');
context.goBackInApp();
context.ui.hr=true;
context.goBackInApp();
assert.equal(context.ui.hr,false);
context.ui.tab='notes';
vm.runInContext("previousTabs.push('dev')",context);
context.goBackInApp();
assert.equal(context.ui.tab,'dev');
context.goBackInApp();
assert.equal(context.ui.tab,'kenash');
console.log('PASS: private alerts, deduplication, per-account release notes and app Back navigation');
