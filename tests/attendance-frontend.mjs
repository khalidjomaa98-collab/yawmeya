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
    if(name==='hr_preview_payroll')return {data:structuredClone(data.payrolls.find(p=>p.id===args.p_id)),error:null};
    calls.push(args);
    if(uncertain){uncertain=false;return {error:{message:'Network timeout'}};}
    const row={id:'saved-row',...args.p_data};
    if(args.p_action==='convert_staff')data.employees.find(x=>x.id===args.p_data.employee_id).role='staff';
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
{
 const t=setup('admin');let creations=0;
 t.context.fnCall=async()=>{creations++;t.data.employees.push({id:'new-worker',name:'Test',role:'cashier',active:true});return {id:'new-worker'};};
 await t.api.load();const fd=new FormData();fd.set('name','Test');fd.set('pin','1234');fd.set('hourly_rate','40');fd.set('effective_on','2001-01-01');
 t.failOnce();await t.api.handleForm('hr_new_staff',fd);await t.api.handleAction('hr_retry');await t.api.handleForm('hr_new_staff',fd);
 assert.equal(creations,1,'interrupted staff setup never creates a second account');
 assert.deepEqual(t.calls.map(x=>x.p_action),['convert_staff','convert_staff','set_rate'],'resuming after conversion retry skips a second conversion');
}
{
 const t=setup();let paints=0;t.context.render=()=>paints++;
 await t.api.load({silent:true});assert.equal(paints,0,'background fetch must not repaint the page');
 const signature=t.api.signature();t.data.server_now=new Date(Date.now()+5000).toISOString();
 await t.api.load({silent:true});assert.equal(t.api.signature(),signature,'server clock alone is not a data change');
 await t.api.load();assert.equal(paints,1,'explicit refresh repaints once');
}
{
 const t=setup('admin');t.data.payrolls=[{id:'draft',employee_id:'employee-1',period_start:'2001-01-01',period_end:'2001-01-02',status:'draft',work_minutes:60,gross:60,net:60,adjustments:[],snapshot:{segments:[],missing_rates:false,open_shifts:false,pending_corrections:false}}];
 await t.api.load();await t.api.handleAction('hr_review_payroll','draft');
 assert.equal(t.calls.length,0,'review never approves or writes a payment');assert.match(t.api.renderAdmin(),/راجع قبل الاعتماد/);
 await t.api.handleAction('hr_confirm_payroll','draft');
 assert.equal(t.calls[0].p_action,'approve_payroll');assert.equal(t.calls[0].p_data.expected_snapshot.missing_rates,false,'approval carries the reviewed snapshot');
}
{
 const t=setup();t.data.payrolls=[{id:'approved',employee_id:'employee-1',status:'approved',net:300,period_start:'2001-01-01',period_end:'2001-01-02',adjustments:[]},{id:'draft',employee_id:'employee-1',status:'draft',net:999999,period_start:'2001-01-03',period_end:'2001-01-04',adjustments:[]}];
 t.data.payments=[{id:'payment',payroll_id:'approved',amount:100}];await t.api.load();
 assert.match(t.api.renderStaff(),/200.00/,'balance uses approved payroll minus confirmed payments');
 assert.doesNotMatch(t.api.renderStaff(),/id="hr_logs"|999999/,'current shift keeps logs and drafts out of the main screen');
 await t.api.handleAction('hr_staff_tab','hours');assert.match(t.api.renderStaff(),/id="hr_logs"/);assert.doesNotMatch(t.api.renderStaff(),/ورديتك دلوقتي/);
 await t.api.handleAction('hr_staff_tab','pay');assert.match(t.api.renderStaff(),/999999/,'draft remains accessible in payroll details');
 assert.doesNotMatch(t.api.renderStaff(),/شوف تفاصيل مستحقاتك/,'no self-navigation on the pay screen');
 await t.api.handleAction('hr_staff_tab','today');assert.match(t.api.renderStaff(),/ورديتك دلوقتي/);assert.equal(t.calls.length,0,'presentation navigation never writes attendance or payroll');
}
{
 const t=setup('admin');t.data.shifts=[{id:'long',employee_id:'other',start_at:new Date(Date.now()-13*3600000).toISOString(),end_at:null}];
 t.data.requests=[{id:'request',employee_id:'other',shift_id:'long',status:'pending'}];await t.api.load();
 assert.match(t.api.renderAdmin(),/محتاج مراجعتك/);assert.match(t.api.renderAdmin(),/1 طلب تعديل · 1 وردية/);
 await t.api.handleAction('hr_tab','team');assert.match(t.api.renderAdmin(),/الموظفين وأسعار الساعة/);
 await t.api.handleAction('hr_tab','requests');assert.match(t.api.renderAdmin(),/طلبات تعديل الانصراف/);assert.equal(t.calls.length,0);
}
{
 const t=setup('admin');await t.api.load();await t.api.handleAction('hr_new_shift');assert.match(t.api.renderAdmin(),/إضافة وردية يدوي/);
 const fd=new FormData();fd.set('employee_id','other');fd.set('start_at','2001-01-01T22:00:30');fd.set('end_at','2001-01-02T06:00:30');fd.set('break_start_0','2001-01-02T01:00:00');fd.set('break_end_0','2001-01-02T01:30:00');fd.set('reason','تسجيل فترة قديمة');
 await t.api.handleForm('hr_admin_shift',fd);assert.equal(t.calls[0].p_action,'admin_add_shift');assert.equal(t.calls[0].p_data.start_at,'2001-01-01T20:00:30.000Z');assert.equal(t.calls[0].p_data.breaks[0].end_at,'2001-01-01T23:30:00.000Z');
 assert.equal(t.calls[0].p_data.reason,'تسجيل فترة قديمة');
}
{
 const t=setup('admin');t.data.shifts=[{id:'old',employee_id:'other',start_at:'2001-01-01T06:00:45.123Z',end_at:'2001-01-01T14:00:45.456Z',change_reason:null,recorded_by:null}];await t.api.load();await t.api.handleAction('hr_edit_shift','old');
 assert.match(t.api.renderAdmin(),/تعديل الوردية/);const fd=new FormData();fd.set('shift_id','old');fd.set('start_at','2001-01-01T08:00:45');fd.set('end_at','2001-01-01T16:00:45');fd.set('reason','تأكيد التسجيل');
 await t.api.handleForm('hr_admin_shift',fd);assert.equal(t.calls[0].p_action,'admin_update_shift');assert.equal(t.calls[0].p_data.start_at,t.data.shifts[0].start_at,'unchanged input preserves subsecond server time');assert.equal(t.calls[0].p_data.end_at,t.data.shifts[0].end_at);assert.equal(t.calls[0].p_data.expected_snapshot.shift.id,'old');
}
{
 const t=setup();await t.api.load();await t.api.handleAction('hr_new_shift');assert.doesNotMatch(t.api.renderStaff(),/إضافة وردية يدوي/);
 await t.api.handleForm('hr_admin_shift',new FormData());assert.equal(t.calls.length,0,'staff cannot submit manual shifts');
}
console.log('PASS: attendance, payroll, retries, isolation, Cairo time, employee setup, silent updates, payroll review, navigation, balances, manager manual entry, shift editing and precise timestamps');
