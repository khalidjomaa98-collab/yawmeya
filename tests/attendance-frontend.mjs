// Contract tests against the real browser module with an isolated RPC stub.
// No network, real users, PINs or persisted attendance/payroll are involved.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../docs/attendance.js',import.meta.url),'utf8');
function setup(role='staff'){
  const id='employee-1', store=new Map(), calls=[];
  const data={server_now:new Date().toISOString(),settings:{reminder_hours:12},employees:[{id,name:'موظف',role,active:true},{id:'other',name:'آخر',role:'staff',active:true}],rates:[],shifts:[],breaks:[],requests:[],payrolls:[],payments:[],alerts:[]};
  let uncertain=false;
  const context={console,Intl,Date,URLSearchParams,FormData,crypto:webcrypto,navigator:{onLine:true},me:{id,name:'موظف',role},DEMO:false,ui:{},render(){},setInterval(){return 1;},clearInterval(){},document:{addEventListener(){},querySelectorAll(){return [];}},sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},window:{location:{search:''}},sb:{async rpc(name,args){
    if(name==='hr_snapshot')return {data:structuredClone(data),error:null};
    calls.push(args);
    if(uncertain){uncertain=false;return {error:{message:'Network timeout'}};}
    const row={id:'saved-row',...args.p_data};
    if(args.p_action==='clock_in'){row.employee_id=id;row.start_at=new Date().toISOString();row.end_at=null;data.shifts=[row];}
    if(args.p_action==='pause')data.breaks=[{id:'pause',shift_id:'saved-row',start_at:new Date().toISOString(),end_at:null}];
    if(args.p_action==='resume')data.breaks[0].end_at=new Date().toISOString();
    if(args.p_action==='clock_out')data.shifts[0].end_at=new Date().toISOString();
    return {data:row,error:null};
  }}};
  vm.runInNewContext(source,context);
  return {api:context.window.Attendance,context,data,calls,store,failOnce(){uncertain=true;}};
}
{
 const t=setup();await t.api.load();
 await t.api.handleAction('hr_clock_in');
 assert.equal(t.calls.length,1);assert.match(t.api.renderStaff(),/شغال دلوقتي/);
 assert.doesNotMatch(t.api.renderStaff(),/في طلب لسه محتاج تأكيد/,'raw RPC row is confirmed');
 await t.api.handleAction('hr_pause');assert.match(t.api.renderStaff(),/رجعت للشغل/);
 await t.api.handleAction('hr_resume');await t.api.handleAction('hr_clock_out');
 assert.match(t.api.renderStaff(),/سجّل حضور/);assert.equal(t.calls.length,4);
}
{
 const t=setup();await t.api.load();t.failOnce();
 await t.api.handleAction('hr_clock_in');
 assert.match(t.api.renderStaff(),/إعادة تأكيد الطلب/);
 await t.api.handleAction('hr_retry');
 assert.equal(t.calls.length,2);assert.equal(t.calls[0].p_request_id,t.calls[1].p_request_id,'uncertain retry reuses idempotency key');
 assert.doesNotMatch(t.api.renderStaff(),/في طلب لسه محتاج تأكيد/);
}
{
 const t=setup();t.data.payrolls=[{id:'other-pay',employee_id:'other',period_start:'2001-01-01',period_end:'2001-01-02',net:999999,work_minutes:60,gross:999999,adjustments:[],snapshot:{},status:'approved'}];
 await t.api.load();assert.doesNotMatch(t.api.renderStaff(),/999999/,'staff snapshot defense excludes another employee payroll');
 await t.api.handleForm('hr_rate',new FormData());assert.equal(t.calls.length,0,'staff cannot submit admin commands');
 t.api.reset();t.context.me=null;assert.equal(await t.api.load(),false);
}
{
 const t=setup('admin');await t.api.load();
 const fd=new FormData();fd.set('employee_id','employee-1');fd.set('period_start','2001-01-01');fd.set('period_end','2001-01-02');fd.set('kind_0','bonus');fd.set('amount_0','25');fd.set('reason_0','مكافأة');
 await t.api.handleForm('hr_payroll',fd);
 assert.equal(t.calls[0].p_action,'create_payroll');assert.equal(t.calls[0].p_data.adjustments[0].amount,25);
 assert.doesNotMatch(t.api.renderAdmin(),/في طلب لسه محتاج تأكيد/);
}
{
 const t=setup('admin');t.data.payrolls=[{id:'pay-1',employee_id:'employee-1',status:'approved',net:1000}];await t.api.load();
 const fd=new FormData();fd.set('payroll_id','pay-1');fd.set('amount','50');fd.set('paid_on','2001-01-02');fd.set('note','دفعة اختبار');
 t.failOnce();await t.api.handleForm('hr_payment',fd);await t.api.handleAction('hr_retry');
 assert.equal(t.calls[0].p_action,'record_payment');assert.equal(t.calls[0].p_request_id,t.calls[1].p_request_id,'payment retry preserves UUID');
 assert.doesNotMatch(t.api.renderAdmin(),/في طلب لسه محتاج تأكيد/);
}
{
 const t=setup();t.data.shifts=[{id:'old',employee_id:'employee-1',start_at:'2001-01-01T06:00:00Z',end_at:null}];await t.api.load();
 const fd=new FormData();fd.set('shift_id','old');fd.set('end_at','2001-01-02T16:30');fd.set('reason','نسيت الانصراف');
 await t.api.handleForm('hr_correct',fd);
 assert.equal(t.calls[0].p_data.end_at,'2001-01-02T14:30:00.000Z','Cairo wall time resolves independently of phone time zone');
}
console.log('PASS: raw RPC contract, attendance flow, uncertain/payment retries, staff isolation, payroll submission, Cairo correction time');
