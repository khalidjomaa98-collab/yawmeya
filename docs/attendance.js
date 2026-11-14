/* Attendance frontend contract (classic script; may load BEFORE app.js).
 * Parent: await Attendance.load(); Attendance.renderStaff()/renderAdmin() return
 * complete screens; renderWidget() returns an entry card. A.hrOpen/A.hrBack own
 * ui.hr navigation. Call reset() on logout. No ledger or shop-day dependencies.
 * Reads: public.hr_snapshot() -> {server_now,settings,employees,rates,shifts,
 * breaks,requests,payrolls,payments,alerts}. Commands: public.hr_command({
 * p_action,p_data,p_request_id}). See command calls below for exact data.
 * Server owns authorization, event time, Cairo date boundaries, wage timelines,
 * correction audit, payroll calculation/freeze/overlap checks and payment limits.
 * Only server-confirmed snapshots are displayed as money. Local storage contains
 * retry IDs/command arguments and partially created user IDs, NEVER login PINs.
 * Local read-only samples: ?hr_demo=admin|staff|away|empty|error (or parent DEMO).
 */
(function () {
  'use strict';
  const TZ = 'Africa/Cairo';
  const arrays = ['employees','rates','shifts','breaks','requests','payrolls','payments','alerts'];
  const dateFmt = new Intl.DateTimeFormat('en-CA', {timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'});
  const timeFmt = new Intl.DateTimeFormat('ar-EG', {timeZone:TZ,hour:'numeric',minute:'2-digit'});
  let state, generation = 0, loading = null, clock = null;
  const handledEvents = new WeakSet();
  function blank() { return {actor:'',ready:false,busy:false,error:'',notice:'',stale:false,data:{},tab:'live',staffTab:'today',from:'',to:'',employee:'',payroll:null,created:null,pending:null,offset:0,drafts:{}}; }
  state = blank();
  function actor() { return typeof me !== 'undefined' && me ? me : null; }
  function admin() { return actor()?.role === 'admin'; }
  function demo() { return new URLSearchParams(window.location.search).get('hr_demo') || (typeof DEMO !== 'undefined' && DEMO ? String(DEMO) : ''); }
  function online() { return navigator.onLine !== false && !(typeof ui !== 'undefined' && ui.offline); }
  function date(ts) { const p = dateFmt.formatToParts(new Date(ts)); return ['year','month','day'].map(k=>p.find(v=>v.type===k).value).join('-'); }
  function shiftDate(ds,n) { const d=new Date(ds+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
  function now() { return Date.now()+state.offset; }
  function fmt(ts) { return ts && Number.isFinite(Date.parse(ts)) ? `${date(ts)} · ${timeFmt.format(new Date(ts))}` : '—'; }
  function wall(ts) {if(!ts)return '';const f=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});return date(ts)+'T'+f.format(new Date(ts));}
  function e(s) { return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function number(v) { return String(v??'').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)); }
  function cash(v) { return typeof money==='function' ? money(Number(v)||0) : `${e(Number(v||0).toFixed(2))} ج.م`; }
  function minutes(v) { const n=Math.max(0,Math.floor(Number(v)||0)); return `${Math.floor(n/60)} س ${n%60} د`; }
  function rows(k) { return state.data[k] || []; }
  function employee(id) { return rows('employees').find(x=>x.id===id); }
  function ownId() { return actor()?.id; }
  function roster() { return rows('employees').filter(x=>x.role!=='admin'); }
  function ownRows(k) { return rows(k).filter(x=>admin()||x.employee_id===ownId()); }
  function storageKey(suffix) { return `yawmeya-hr:${state.actor}:${suffix}`; }
  function stored(suffix,value) { try { if(arguments.length===1) return JSON.parse(sessionStorage.getItem(storageKey(suffix))||'null'); if(value===null)sessionStorage.removeItem(storageKey(suffix));else sessionStorage.setItem(storageKey(suffix),JSON.stringify(value)); } catch (_) {} return null; }
  function uuid() { if (crypto.randomUUID) return crypto.randomUUID(); const bytes=crypto.getRandomValues(new Uint8Array(16)); bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;return [...bytes].map((v,i)=>([4,6,8,10].includes(i)?'-':'')+v.toString(16).padStart(2,'0')).join(''); }
  function synchronizeActor() {
    const a=actor(), key=a ? `${a.id}:${a.role}:${demo()}` : '';
    if(state.actor===key) return;
    reset(); state.actor=key;
    const t=date(Date.now()); state.from=t.slice(0,8)+'01'; state.to=shiftDate(t,-1); if(state.from>state.to)state.from=state.to.slice(0,8)+'01';
    state.pending=stored('pending'); state.created=stored('created');
    try{const f=JSON.parse(localStorage.getItem('hr-filters:'+a.id)||'{}');Object.assign(state,f);}catch(_){}
  }
  function reset() { if(state?.reportImages)state.reportImages.forEach(u=>URL.revokeObjectURL(u));generation++;state=blank();loading=null;if(clock)clearInterval(clock);clock=null; }
  function redraw() { if(typeof render==='function'&&actor())render(); }
  function errText(err) {
    const s=String(err?.message||err?.code||err||'').toLowerCase();
    if(/shift changed/.test(s))return 'الوردية اتغيرت من وقت ما فتحتها. حدّث البيانات وافتح التعديل من جديد.';
    if(/personal.*pause|break.*invalid|break.*overlap/.test(s))return 'راجع الخروج الشخصي: لازم يكون داخل الوردية ومن غير تداخل.';
    if(/manual.*time/.test(s))return 'راجع وقت الحضور والانصراف: الانصراف بعد الحضور، ومفيش وقت في المستقبل.';
    if(/approved payroll/.test(s))return 'التعديل بيمس فترة دخلت في كشف مرتب معتمد وثابت؛ مش متاح تغيير ساعاتها.';
    if(/shift overlap/.test(s))return 'الوقت ده بيتداخل مع وردية تانية لنفس الموظف. راجع السجل الأول.';
    if(/offline|fetch|network|load failed/.test(s)||!online())return 'مفيش اتصال مؤكد. اتصل بالنت واضغط إعادة المحاولة بنفس الطلب.';
    if(/payroll changed/.test(s))return 'الحساب اتغير بعد المراجعة. افتح مراجعة الكشف من جديد قبل الاعتماد.';
    if(/rate/.test(s))return 'في ساعات من غير أجر محدد. حدّد سعر الساعة من تاريخ بداية الشغل.';
    if(/overlap|already.*approved|double/.test(s))return 'الفترة دي فيها ساعات معتمدة قبل كده. اختار فترة تانية.';
    if(/today|future|period.*end|ended|complete.*day/.test(s))return 'اعتماد الكشف بعد انتهاء آخر يوم في الفترة؛ اليوم الحالي يفضل مسودة.';
    if(/pending|correction/.test(s))return 'راجع طلبات تعديل الانصراف الأول، وبعدها جرّب تاني.';
    if(/open|incomplete|checkout|clock.out/.test(s))return 'في وردية لسه مفتوحة أو ناقصة. راجع الانصراف الأول.';
    if(/balance|exceed|overpay|remaining/.test(s))return 'المبلغ أكبر من المتبقي في الكشف. حدّث البيانات وراجعه.';
    if(/permission|forbidden|admin|unauthorized/.test(s))return 'العملية دي مش متاحة لحسابك.';
    if(/approved|frozen/.test(s))return 'الكشف المعتمد ثابت؛ راجع بياناته قبل تسجيل دفعة.';
    if(/active|disabled/.test(s))return 'الحساب متوقف. راجع المدير.';
    if(/duplicate|exists|already/.test(s))return 'الحركة موجودة بالفعل أو حالة الوردية اتغيرت. حدّث البيانات.';
    if(/function.*not.*exist|schema|pgrst202/.test(s))return 'خدمة الحضور لسه مش متاحة. جرّب تحديث البيانات.';
    return 'ما قدرناش نأكد العملية. جرّب تاني بنفس الطلب أو حدّث البيانات.';
  }
  function sample(mode) {
    const t=Date.now(), id=ownId(), emp=admin()?'demo-staff':id;
    const d={server_now:new Date(t).toISOString(),settings:{reminder_hours:12},employees:[{id:emp,name:admin()?'أحمد محمد':actor().name,role:'staff',active:true}],rates:[{id:'demo-rate',employee_id:emp,effective_on:'2020-01-01',hourly_rate:35}],shifts:[],breaks:[],requests:[],payrolls:[],payments:[],alerts:[]};
    if(mode==='empty')return d;
    d.shifts=[{id:'demo-open',employee_id:emp,start_at:new Date(t-3*3600000).toISOString(),end_at:null},{id:'demo-closed',employee_id:emp,start_at:new Date(t-32*3600000).toISOString(),end_at:new Date(t-24*3600000).toISOString()}];
    if(mode==='away')d.breaks=[{id:'demo-break',shift_id:'demo-open',start_at:new Date(t-30*60000).toISOString(),end_at:null}];
    d.requests=[{id:'demo-request',employee_id:emp,shift_id:'demo-closed',requested_end:new Date(t-23*3600000).toISOString(),reason:'نسيت أسجل الانصراف',status:'pending',review_note:null}];
    d.payrolls=[{id:'demo-payroll',employee_id:emp,period_start:shiftDate(date(t),-7),period_end:shiftDate(date(t),-1),status:'approved',work_minutes:480,gross:280,adjustments:[{kind:'bonus',amount:20,reason:'مكافأة'}],net:300,snapshot:{segments:[{day:date(d.shifts[1].start_at),start_at:d.shifts[1].start_at,end_at:d.shifts[1].end_at,work_minutes:480}]},approved_at:new Date(t-3600000).toISOString()}];
    d.payments=[{id:'demo-payment',payroll_id:'demo-payroll',amount:100,paid_on:date(t),note:'دفعة أولى'}]; return d;
  }
  async function load({silent=false}={}) {
    synchronizeActor();if(!actor())return false;if(loading)return loading;
    const token=generation, identity=state.actor;
    const job=(async()=>{
      try {
        const start=Date.now();let data;
        if(demo()){if(demo()==='error')throw new Error('network');data=sample(demo());}
        else {const res=await sb.rpc('hr_snapshot');if(res.error)throw res.error;data=res.data;}
        if(token!==generation||identity!==state.actor||`${actor()?.id}:${actor()?.role}:${demo()}`!==identity)return false;
        if(!data||arrays.some(k=>!Array.isArray(data[k])))throw new Error('Invalid HR snapshot');
        // Defense in depth for stale/mis-scoped snapshots; database RLS is mandatory.
        if(!admin()){
          data={...data,employees:data.employees.filter(x=>x.id===ownId()),rates:data.rates.filter(x=>x.employee_id===ownId()),shifts:data.shifts.filter(x=>x.employee_id===ownId()),requests:data.requests.filter(x=>x.employee_id===ownId()),payrolls:data.payrolls.filter(x=>x.employee_id===ownId()),alerts:data.alerts.filter(x=>x.employee_id===ownId())};
          const shifts=new Set(data.shifts.map(x=>x.id)), pays=new Set(data.payrolls.map(x=>x.id));data.breaks=data.breaks.filter(x=>shifts.has(x.shift_id));data.payments=data.payments.filter(x=>pays.has(x.payroll_id));
        }
        state.data=data;state.ready=true;state.stale=false;state.error='';
        if(data.server_now&&Number.isFinite(Date.parse(data.server_now)))state.offset=Date.parse(data.server_now)-(start+Date.now())/2;
        if(!state.employee)state.employee=roster().find(x=>x.active)?.id||roster()[0]?.id||'';
        if(!clock)clock=setInterval(updateClocks,1000);
        return true;
      } catch(err){if(token===generation&&identity===state.actor){state.error=errText(err);state.stale=true;}return false;}
      finally {if(token===generation){loading=null;if(!silent){if(!state.busy&&typeof softRender==='function')softRender();else redraw();}}}
    })();loading=job; // Promise may resolve synchronously in demo mode; clear on settlement too.
    job.finally(()=>{if(loading===job)loading=null;});return job;
  }
  function ready() { synchronizeActor();if(!state.ready&&!state.error&&!loading)Promise.resolve().then(load);return state.ready; }
  function disabled() { return state.busy||state.stale||!state.ready||!online()||!!demo(); }
  function btn(name,label,value='',primary=false,off=false) { return `<button type="button" class="att-btn${primary?' att-primary':''}" data-a="hr_${name}" data-v="${e(value)}" ${off||state.busy?'disabled':''}>${e(label)}</button>`; }
  function submit(label,off=false,local=false) {return `<button class="att-btn att-primary" type="submit" ${off||(local?state.busy:disabled())?'disabled':''}>${state.busy?'جاري التأكيد…':e(label)}</button>`;}
  function form(id,body) { return `<form id="hr_${id}" class="att-form" data-hr-form>${body}</form>`; }
  function dateText(value) {
    if(!value)return 'اختار التاريخ';
    const [day,time]=String(value).split('T'),[y,m,d]=day.split('-');
    return `${d} / ${m} / ${y}${time?' · '+time:''}`;
  }
  function field(label,name,type='text',value='',extra='') {
    const input=`<input aria-label="${e(label)}" name="${name}" type="${type}" value="${e(value)}" ${extra}>`;
    const content=['date','datetime-local'].includes(type)?`<span class="att-date"><span data-hr-date-label aria-hidden="true">${e(dateText(value))}</span><span aria-hidden="true">▾</span>${input}</span>`:input;
    return `<label class="att-field"><span>${e(label)}</span>${content}</label>`;
  }
  function syncDates() {
    document.querySelectorAll('.att-date').forEach(w=>{w.querySelector('[data-hr-date-label]').textContent=dateText(w.querySelector('input').value);});
  }
  function decorateDates(){
    document.querySelectorAll('input[type="date"],input[type="datetime-local"]').forEach(input=>{
      if(input.closest('.att-date'))return;const wrapper=document.createElement('span');wrapper.className='att-date';
      const label=document.createElement('span');label.dataset.hrDateLabel='';label.setAttribute('aria-hidden','true');label.textContent=dateText(input.value);
      const arrow=document.createElement('span');arrow.setAttribute('aria-hidden','true');arrow.textContent='▾';
      input.parentNode.insertBefore(wrapper,input);wrapper.append(label,arrow,input);
    });
  }
  function reason(name='reason',label='السبب') {return `<label class="att-field"><span>${e(label)}</span><textarea name="${name}" required maxlength="500" rows="2"></textarea></label>`;}
  function employeeSelect(name='employee_id',selected=state.employee) {return `<label class="att-field"><span>الموظف</span><select name="${name}" required>${roster().map(x=>`<option value="${e(x.id)}" ${x.id===selected?'selected':''}>${e(x.name)}${x.active?'':' (متوقف)'}</option>`).join('')}</select></label>`;}
  function notices() {
    return `${state.busy?'<p class="att-notice" role="status">جاري تأكيد الحفظ على السيرفر…</p>':''}${demo()?'<p class="att-notice">تجربة محلية · بيانات مثال · مفيش عمليات بتتسجل</p>':''}${!online()?'<p class="att-error">مفيش نت. الحضور والمرتبات محتاجين تأكيد مباشر، ومش بيتحفظوا أوفلاين.</p>':''}${state.error?`<div class="att-error" role="alert">${e(state.error)} ${btn('refresh','حدّث البيانات')}</div>`:''}${state.notice?`<p class="att-notice" role="status">${e(state.notice)}</p>`:''}${state.pending?`<div class="att-error">في طلب لسه محتاج تأكيد. إعادة المحاولة بنفس رقم الطلب بتمنع التكرار. ${btn('retry','إعادة تأكيد الطلب','',true,disabled())}</div>`:''}`;
  }
  function shell(title,body) {
    const back=actor()?.role==='staff'?'':'<button class="ibtn" type="button" data-a="hrBack">→ رجوع لليومية</button>';
    const alerts=rows('alerts').filter(a=>rows('shifts').some(s=>s.id===a.shift_id&&!s.end_at));
    const header=typeof band==='function'?band(`<div class="att-heading"><h1>${e(title)}</h1>${back}</div>`):`<header class="att-header"><h1>${e(title)}</h1>${back}</header>`;
    return `<div class="att-root" dir="rtl">${header}<main class="att-content">${notices()}${alerts.map(a=>`<p class="att-error" role="status">${e(a.text)}</p>`).join('')}${body}</main></div>`;
  }
  function waiting() {return `<div class="att-card" role="status">${state.error?'بيانات الحضور مش متاحة دلوقتي. اليومية تقدر تكمل عادي.':'جاري تحميل الحضور…'}</div>`;}
  function activeShift(id) {return rows('shifts').find(s=>s.employee_id===id&&!s.end_at);}
  function away(s) {return s&&rows('breaks').some(b=>b.shift_id===s.id&&!b.end_at);}
  function status(s) {return !s?'مش في وردية':away(s)?'خارج شخصي':'شغال دلوقتي';}
  function duration(s) {
    let ms=Math.max(0,(s.end_at?Date.parse(s.end_at):now())-Date.parse(s.start_at));
    rows('breaks').filter(b=>b.shift_id===s.id).forEach(b=>{ms-=Math.max(0,Math.min(b.end_at?Date.parse(b.end_at):now(),s.end_at?Date.parse(s.end_at):now())-Math.max(Date.parse(b.start_at),Date.parse(s.start_at)));});
    return minutes(Math.max(0,ms)/60000);
  }
  function updateClocks() {
    if(!actor()||!state.ready)return;
    document.querySelectorAll('[data-hr-clock]').forEach(el=>{const s=rows('shifts').find(x=>x.id===el.dataset.hrClock);if(s)el.textContent=duration(s);});
  }
  function currentCard() {
    const shift=activeShift(ownId()),enabled=!disabled()&&!state.pending;
    return `<section class="att-card att-shift"><div class="att-row"><h2>ورديتك دلوقتي</h2><span class="att-pill ${shift?'att-working':''}">${shift?'شغال دلوقتي':'مش في وردية'}</span></div><div class="att-timer"><span class="att-muted">${shift?'وقت العمل':'جاهز تبدأ يومك؟'}</span>${shift?`<strong class="att-clock" data-hr-clock="${e(shift.id)}">${duration(shift)}</strong><p class="att-muted">بدأت ${e(fmt(shift.start_at))}</p>`:'<strong class="att-clock">—</strong>'}</div><div class="att-shift-actions">${shift?btn('clock_out','سجّل انصراف','',true,!enabled):btn('clock_in','سجّل حضور','',true,!enabled)}</div></section>`;
  }
  function manualBreakRow(i,b={}) {
    return `<fieldset class="att-manual-break" data-break-index="${i}"><legend>خروج شخصي غير محسوب</legend><input type="hidden" name="break_id_${i}" value="${e(b.id||'')}"><div class="att-grid">${field('بداية الخروج','break_start_'+i,'datetime-local',wall(b.start_at),'required step="1"')}${field('الرجوع · اختياري لو لسه خارج','break_end_'+i,'datetime-local',wall(b.end_at),'step="1"')}</div>${btn('remove_break','إزالة فترة الخروج')}</fieldset>`;
  }
  function showManual() {redraw();document.querySelector?.('#hr_admin_shift')?.closest('.att-card')?.scrollIntoView({block:'start',behavior:'auto'});}
  function manualShiftForm() {
    const m=state.manual,s=m.expected?.shift,breaks=m.breakRows||[];
    return `<section class="att-card att-review"><h2>${s?'تعديل الوردية':'إضافة وردية يدوي'}</h2><p class="att-muted">كل المواعيد بتوقيت مصر، بما فيها أيام ما قبل استخدام البرنامج.</p>${form('admin_shift',`<input name="shift_id" type="hidden" value="${e(s?.id||'')}">${s?`<p><b>${e(employee(s.employee_id)?.name||'الموظف')}</b></p><p class="att-muted">المسجل: ${e(fmt(s.start_at))} ← ${e(fmt(s.end_at))}</p>`:employeeSelect()}<div class="att-grid">${field('الحضور','start_at','datetime-local',wall(s?.start_at),'required step="1"')}${field('الانصراف · اتركه فاضي لو لسه شغال','end_at','datetime-local',wall(s?.end_at),'step="1"')}</div><p class="att-muted">حدد تاريخ الانصراف الصحيح لو الوردية كملت بعد نص الليل. ترك الانصراف فاضي يجعل الوردية مفتوحة.</p><div class="att-manual-breaks">${breaks.map(b=>manualBreakRow(b.index,b)).join('')}</div>${reason('reason','سبب الإضافة أو التعديل')}<p class="att-notice">الحفظ يؤثر على ساعات الموظف والكشوف غير المعتمدة عند مراجعتها. التسجيل القديم وسبب التعديل محفوظين في السجل.</p>${submit(s?'احفظ تعديل الوردية':'سجّل الوردية',!!state.pending)}${btn('cancel_manual','إلغاء')}`)}</section>`;
  }
  function shiftLogs() {
    const from=state.logFrom||date(now()).slice(0,8)+'01',to=state.logTo||date(now());
    const list=ownRows('shifts').filter(s=>(!state.logEmployee||s.employee_id===state.logEmployee)&&(!state.logQuery||(employee(s.employee_id)?.name||'').includes(state.logQuery))).filter(s=>!s.end_at||(date(s.start_at)<=to&&date(s.end_at)>=from)).slice().sort((a,b)=>Date.parse(b.start_at)-Date.parse(a.start_at));
    return `<section class="att-card"><h2>سجل الحضور</h2>${form('logs',`${admin()?`<label class="att-field"><span>الموظف</span><select name="employee"><option value="">كل الموظفين</option>${roster().map(x=>`<option value="${e(x.id)}" ${x.id===state.logEmployee?'selected':''}>${e(x.name)}</option>`).join('')}</select></label>`:''}<div class="att-grid">${field('من','from','date',from,'required')}${field('لحد','to','date',to,'required')}</div>${submit('اعرض السجل',false,true)}`)}<p class="att-muted">بتوقيت مصر · الوردية مستمرة لحد الانصراف.</p>${list.length?list.map(s=>`<details class="att-entry" data-hr-shift="${e(s.id)}" ${state.focusShift===s.id?'open':''}><summary><span>${admin()?`<b>${e(employee(s.employee_id)?.name||'الموظف')}</b><br>`:''}${e(fmt(s.start_at))}</span><span class="att-pill">${s.end_at?'مقفولة':e(status(s))}</span></summary><p>الحضور: ${e(fmt(s.start_at))}</p><p>الانصراف: ${e(fmt(s.end_at))}</p><p>وقت الشغل: ${duration(s)}</p>${rows('breaks').filter(b=>b.shift_id===s.id).map(b=>`<p class="att-muted">خروج شخصي: ${e(fmt(b.start_at))} ← ${e(fmt(b.end_at))}</p>`).join('')}${!admin()?correctionForm(s):btn('edit_shift','تعديل الوردية',s.id)}${s.change_reason?`<p class="att-muted">آخر تسجيل إداري: ${e(s.change_reason)}</p>`:''}</details>`).join(''):'<p class="att-empty">مفيش ورديات في الفترة دي.</p>'}</section>`;
  }
  function correctionForm(s) {
    const pending=rows('requests').some(r=>r.shift_id===s.id&&r.status==='pending');
    return pending?'<p class="att-notice">طلب تعديل الانصراف قيد المراجعة.</p>':`<details class="att-sub"><summary>نسيت تسجل الانصراف؟</summary>${form('correct',`<input type="hidden" name="shift_id" value="${e(s.id)}">${field('الانصراف الصحيح بتوقيت مصر','end_at','datetime-local','','required')}${reason()}<p class="att-muted">المدير هيراجع الطلب، والتسجيل الأصلي بيفضل محفوظ.</p>${submit('ابعت طلب التعديل')}`)}</details>`;
  }
  function requestList(review=false) {
    const list=ownRows('requests').slice().reverse().sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending'));
    return `<section class="att-card"><h2>طلبات تعديل الانصراف</h2>${list.length?list.map(r=>{const s=rows('shifts').find(x=>x.id===r.shift_id);return `<article class="att-entry att-request" data-hr-request-shift="${e(r.shift_id)}"><div class="att-row"><b>${e(employee(r.employee_id)?.name||'الموظف')}</b><span class="att-pill">${e(({pending:'قيد المراجعة',approved:'مقبول',rejected:'مرفوض'})[r.status]||r.status)}</span></div><p class="att-muted">الحضور: ${e(fmt(s?.start_at))}</p><dl class="att-request-times"><div><dt>الانصراف المسجل</dt><dd>${e(fmt(s?.end_at))}</dd></div><div><dt>الانصراف المطلوب</dt><dd>${e(fmt(r.requested_end))}</dd></div></dl><p class="att-request-reason"><span class="att-muted">السبب</span><br>${e(r.reason)}</p>${r.review_note?`<p class="att-muted">رد المدير: ${e(r.review_note)}</p>`:''}${review&&r.status==='pending'?form('review',`<input type="hidden" name="request_id" value="${e(r.id)}">${reason('reason','سبب القرار')}<label class="att-field"><span>القرار</span><select name="approve"><option value="true">قبول التعديل</option><option value="false">رفض الطلب</option></select></label>${submit('تأكيد القرار')}`):''}</article>`;}).join(''):'<p class="att-empty">مفيش طلبات تعديل.</p>'}</section>`;
  }
  function rememberFilters(){try{localStorage.setItem('hr-filters:'+ownId(),JSON.stringify({logFrom:state.logFrom,logTo:state.logTo,logEmployee:state.logEmployee,logQuery:state.logQuery,auditQuery:state.auditQuery}));}catch(_){}}
  async function loadAudit(reset=false){
    if(!admin()||state.auditBusy)return;const activeState=state,ownerId=ownId();state.auditBusy=true;
    try{if(demo()){state.auditRows=state.data.audit||[];state.auditCursor=null;return;}
      const cursor=reset?null:state.auditCursor;const r=await sb.rpc('hcash_audit_page',{p_before:cursor?.time||null,p_id:cursor?.id||null,p_limit:100});if(r.error)throw r.error;
      if(state!==activeState||ownId()!==ownerId)return;
      state.auditRows=reset?r.data.rows:[...(state.auditRows||[]),...r.data.rows];state.auditCursor=r.data.next;state.auditLoaded=true;
    }catch(error){if(state===activeState&&ownId()===ownerId)state.notice=errText(error);}finally{if(state===activeState&&ownId()===ownerId){state.auditBusy=false;redraw();}}
  }
  function auditView(){
    const labels={device_returns:'مرتجع جهاز',hcash_staff_preferences:'صلاحيات التكلفة',sale_approval:'موافقة سعر',hr_rates:'سعر الساعة',hr_shifts:'الحضور والانصراف',hr_breaks:'الخروج الشخصي',hr_requests:'تصحيح الانصراف',hr_payrolls:'كشف مرتب',hr_payments:'دفعة مرتب',hr_settings:'إعدادات الحضور',hr_alerts:'تذكير',profiles:'حساب موظف',txs:'حركة يومية',devices:'مخزون الأجهزة',device_sales:'بيع جهاز',shop_days:'يوم المحل',shops:'محل',shop_drawers:'درج',parties:'عميل'};
    const fields={view_cost:'إظهار التكلفة',min_price:'أقل سعر بيع',cancel_reason:'سبب إلغاء البيع',restock:'إعادة للمخزون',user_id:'الحساب',device_name:'الجهاز',sale_id:'البيعة الأصلية',name:'الاسم',shop_id:'المحل',active:'نشط',role:'الصلاحية',change_reason:'سبب التسجيل الإداري',recorded_by:'سجّلها المدير',start_at:'الحضور / بداية الخروج',end_at:'الانصراف / الرجوع',hourly_rate:'سعر الساعة',effective_on:'ساري من',amount:'المبلغ',reason:'السبب',review_note:'قرار المدير',requested_end:'الانصراف المطلوب',status:'الحالة',gross:'أجر الساعات',net:'الصافي',work_minutes:'دقائق العمل',adjustments:'البنود',paid_on:'تاريخ الدفعة',note:'الملاحظة',qty:'الكمية',buy_price:'سعر الشراء',sell_price:'سعر البيع',type:'نوع الحركة',pay:'الدرج',voucher:'البون',deleted_at:'المسح',transferred_at:'التسجيل في كناش',opening_balance:'رصيد البداية',closed_at:'قفل اليوم',reminder_hours:'مدة التذكير'};
    const words={admin:'مدير',cashier:'كاشير',staff:'موظف',draft:'مسودة',approved:'معتمد',pending:'قيد المراجعة',rejected:'مرفوض',took:'أخدت',gave:'أعطيت',bonus:'مكافأة',deduction:'خصم',advance:'سلفة'};
    const value=v=>v==null?'—':Array.isArray(v)?v.map(x=>`${words[x.kind]||x.kind}: ${x.amount} ج.م · ${x.reason||''}`).join(' / '):typeof v==='object'?JSON.stringify(v):typeof v==='boolean'?(v?'نعم':'لا'):employee(v)?.name||(typeof shop==='function'?shop(v)?.name:null)||words[v]||(/^\d{4}-\d{2}-\d{2}T/.test(String(v))?fmt(v):String(v));
    const list=(state.auditRows||state.data.audit||[]).slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id))).filter(a=>{const x=a.after_data||a.before_data||{};return !state.auditQuery||JSON.stringify([labels[a.entity],employee(a.actor_id)?.name,employee(x.employee_id)?.name,x.name]).includes(state.auditQuery);});
    return `<section class="att-card"><h2>سجل التعديلات</h2><p class="att-muted">النتائج من الصفحات المحمّلة · كل دفعة ١٠٠ سجل. السجل لهشام فقط. تعديلات اليومية والمخزون من تاريخ تفعيل السجل.</p>${form('audit_filter',`${field('بحث بالموظف أو نوع السجل','query','search',state.auditQuery||'')}${submit('ابحث',false,true)}`)}${list.map(a=>{const before=a.before_data||{},after=a.after_data||{};const keys=Object.keys(fields).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));return `<details class="att-entry"><summary><span><b>${e(labels[a.entity]||a.entity)}${employee(after.employee_id||before.employee_id)?' · '+e(employee(after.employee_id||before.employee_id).name):''}${after.name||before.name?' · '+e(after.name||before.name):''}</b><small>${e(employee(a.actor_id)?.name||'النظام / إدارة الحساب')} · ${e(fmt(a.created_at))}</small></span><span>${a.before_data?(a.after_data?'تعديل':'مسح'):'إضافة'}</span></summary>${keys.map(k=>`<p><b>${e(fields[k])}</b><br><del>${e(value(before[k]))}</del> ← <strong>${e(value(after[k]))}</strong></p>`).join('')||'<p>تم تحديث بيانات السجل.</p>'}</details>`;}).join('')||'<p>مفيش نتائج في الصفحات المحملة.</p>'}${state.auditCursor?btn('audit_more','نتائج أقدم','',false,state.auditBusy):''}</section>`;
  }
  function reviewCard(){
    const p=state.review;if(!p)return '';const x=p.snapshot||{},errors=[];
    if(x.missing_rates)errors.push('سعر الساعة ناقص لبعض ساعات العمل');if(x.open_shifts)errors.push('في وردية لسه مفتوحة');if(x.pending_corrections)errors.push('في طلب تعديل انصراف منتظر');if(p.period_end>=date(now()))errors.push('آخر يوم في الفترة لسه ما انتهيش');
    return `<section class="att-card att-review"><h2>راجع قبل الاعتماد</h2><b>${e(employee(p.employee_id)?.name||'الموظف')}</b><p>${e(p.period_start)} ← ${e(p.period_end)}</p><div class="att-net"><small>الصافي بعد كل البنود</small><strong>${cash(p.net)}</strong></div><p>العمل: ${minutes(p.work_minutes)} · أجر الساعات: ${cash(p.gross)}</p>${dailyTable(p)}${adjustmentList(p.adjustments)}${errors.map(t=>`<p class="att-error">${e(t)}</p>`).join('')}<p class="att-muted">الاعتماد يثبّت الكشف، ولا يصرف فلوس. لو الحساب اتغيّر هتحتاج تراجعه تاني.</p>${btn('confirm_payroll','اعتمد بالمبلغ المعروض',p.id,true,!!errors.length||disabled())}${btn('cancel_review','رجوع للمراجعة')}</section>`;
  }
  async function openAlert(id,shiftId){
    await load({silent:true});const a=rows('alerts').find(x=>x.id===id);state.tab='live';state.staffTab='hours';state.focusShift=a?.shift_id||(rows('shifts').some(x=>x.id===shiftId)?shiftId:null);const target=rows('shifts').find(x=>x.id===state.focusShift);if(target){state.logFrom=date(target.start_at);state.logTo=date(target.end_at||now());state.logEmployee=target.employee_id;state.logQuery='';if(admin()&&rows('requests').some(r=>r.shift_id===target.id&&r.status==='pending'))state.tab='requests';}state.notice=state.focusShift?'راجع الوردية والتنبيه الموضح أدناه.':'التنبيه غير متاح لحسابك أو تم حذفه.';redraw();
    if(state.focusShift){const el=document.querySelector(state.tab==='requests'?`[data-hr-request-shift="${state.focusShift}"]`:`[data-hr-shift="${state.focusShift}"]`);if(el){el.open=true;el.scrollIntoView({block:'center',behavior:'smooth'});}}
  }
  function dailyRows(report){
    const days=new Map();
    for(const segment of report.snapshot?.segments||[]){
      if(!segment.day)continue;
      const row=days.get(segment.day)||{day:segment.day,minutes:0,intervals:[]};
      const start=segment.attendance_start||segment.start_at;
      const end=Object.hasOwn(segment,'attendance_end')?segment.attendance_end:segment.end_at;
      row.minutes+=Number(segment.work_minutes)||0;
      const display=stamp=>!stamp?'لسه مفتوحة':date(stamp)===segment.day?timeFmt.format(new Date(stamp)):fmt(stamp);
      row.intervals.push({start:display(start),end:display(end)});
      days.set(segment.day,row);
    }
    return [...days.values()].sort((a,b)=>a.day.localeCompare(b.day));
  }
  function dailyTable(report){
    const days=dailyRows(report);
    if(!days.length)return '<p class="att-empty">مفيش ورديات مسجلة في الفترة دي.</p>';
    const lines=days.map(row=>`<tr><th scope="row"><bdi>${e(row.day)}</bdi></th><td>${row.intervals.map(i=>`<span>${e(i.start)}</span>`).join('')}</td><td>${row.intervals.map(i=>`<span>${e(i.end)}</span>`).join('')}</td><td>${minutes(row.minutes)}</td></tr>`).join('');
    return `<div class="att-report-table"><table><thead><tr><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th></tr></thead><tbody>${lines}</tbody></table></div>`;
  }
  function periodReport(){
    const report=state.periodReport;
    if(!report)return '';
    const {snapshot}=report;
    const amount=snapshot.missing_rates?'حدّد سعر الساعة':cash(report.net);
    const warning=snapshot.missing_rates||snapshot.open_shifts||snapshot.pending_corrections;
    return `<section class="att-card att-review" id="period-report"><h2>كشف ${e(employee(report.employee_id)?.name||'الموظف')}</h2><p class="att-muted">${e(report.period_start)} إلى ${e(report.period_end)} · بتوقيت مصر</p><dl class="att-totals"><div><dt>إجمالي الساعات</dt><dd>${minutes(report.work_minutes)}</dd></div><div><dt>${warning?'المرتب المبدئي':'المرتب'}</dt><dd>${amount}</dd></div></dl>${dailyTable(report)}${adjustmentList(report.adjustments)}${snapshot.open_shifts?'<p class="att-notice">في وردية مفتوحة. ساعاتها محسوبة حتى وقت عرض الكشف.</p>':''}${snapshot.pending_corrections?'<p class="att-notice">في طلب تعديل انصراف لسه تحت المراجعة.</p>':''}<div class="att-actions">${btn('save_period_report','احفظ الكشف للمراجعة','',true,disabled()||!!state.pending||snapshot.missing_rates)}${btn('share_payroll','مشاركة صورة الكشف','period-preview',false,snapshot.missing_rates)}</div></section>`;
  }
  function paymentsFor(id) {return rows('payments').filter(p=>p.payroll_id===id);}
  function paid(p) {return paymentsFor(p.id).reduce((n,v)=>n+Math.round(Number(v.amount)*100),0)/100;}
  function adjustmentList(list) {return (list||[]).map(a=>`<p>${e(({bonus:'مكافأة',deduction:'خصم',advance:'سلفة'})[a.kind]||a.kind)}: ${cash(a.amount)} · ${e(a.reason)}</p>`).join('');}
  function payrollDetails(p) {
    const approved=p.status==='approved', paidAmount=paid(p),remaining=Math.round((Number(p.net)-paidAmount)*100)/100;
    const canApprove=p.period_end<date(now());
    return `<article class="att-card"><div class="att-row"><h2>${e(employee(p.employee_id)?.name||'كشف المرتب')}</h2><span class="att-pill ${approved?'att-working':''}">${approved?'معتمد وثابت':'مسودة'}</span></div><p class="att-muted">${e(p.period_start)} ← ${e(p.period_end)} · بتوقيت مصر</p><div class="att-net"><small>صافي المرتب</small><strong>${cash(p.net)}</strong><span>${approved?'كشف معتمد':'مسودة للمراجعة'}</span></div><dl class="att-totals"><div><dt>وقت الشغل</dt><dd>${minutes(p.work_minutes)}</dd></div><div><dt>أجر الساعات</dt><dd>${cash(p.gross)}</dd></div>${approved?`<div><dt>اتصرف</dt><dd>${cash(paidAmount)}</dd></div><div><dt>المتبقي للموظف</dt><dd>${cash(remaining)}</dd></div>`:''}</dl>${adjustmentList(p.adjustments)}${dailyTable(p)}${!approved?`<p class="att-notice">المسودة قابلة للمراجعة. الاعتماد بعد انتهاء الفترة واستكمال الانصراف والتعديلات.</p>${admin()?btn('review_payroll','راجع واعتمد الكشف',p.id,true,disabled()||!canApprove||!!state.pending):''}`:`<p class="att-muted">اعتمد ${e(fmt(p.approved_at))} · تفاصيل الساعات والأجر ثابتة وقت الاعتماد.</p>`}<div class="att-actions">${btn('preview_image','معاينة صورة الكشف',p.id)}${btn('share_payroll','مشاركة صورة الكشف',p.id)}</div>${state.reportId===p.id?(state.reportImages||[]).map(u=>`<img class="payroll-report" src="${e(u)}" alt="معاينة كشف المرتب">`).join(''):''}<h3>الدفعات</h3>${paymentsFor(p.id).map(x=>`<div class="att-entry"><b>${cash(x.amount)}</b><p>${e(x.paid_on)} · ${e(x.note)}</p></div>`).join('')||'<p class="att-muted">مفيش دفعات مسجلة.</p>'}${approved&&admin()&&remaining>0?form('payment',`<input type="hidden" name="payroll_id" value="${e(p.id)}">${field('مبلغ الدفعة','amount','text','','required inputmode="decimal"')}${field('تاريخ الصرف بتوقيت مصر','paid_on','date',date(now()),'required')}${reason('note','سبب / ملاحظة الصرف')}<p class="att-muted">ده تسجيل لدفعة صرفتها بالفعل، مش تحويل فلوس أو حركة في درج المحل.</p>${submit('سجّل الدفعة',!!state.pending)}`):''}</article>`;
  }
  function payrollList() {
    const list=ownRows('payrolls').slice().sort((a,b)=>String(b.period_end).localeCompare(String(a.period_end)));
    return `<section class="att-card"><h2>كشوف المرتبات</h2>${list.length?list.map(p=>`<details class="att-payroll" ${state.payroll===p.id?'open':''}><summary><span><b>${e(employee(p.employee_id)?.name||'المرتب')}</b><small>${e(p.period_start)} ← ${e(p.period_end)}</small></span><span>${cash(p.net)}<small>${p.status==='approved'?'معتمد':'مسودة'}</small></span></summary>${payrollDetails(p)}</details>`).join(''):'<p class="att-empty">مفيش كشوف مرتبات لسه.</p>'}</section>`;
  }
  function liveDashboard() {
    const open=rows('shifts').filter(s=>!s.end_at&&employee(s.employee_id)?.role!=='admin'),hours=Number(state.data.settings?.reminder_hours)||12;
    const pending=rows('requests').filter(r=>r.status==='pending'),long=open.filter(s=>now()-Date.parse(s.start_at)>=hours*3600000);
    return `${pending.length||long.length?`<section class="att-attention"><div><h2>محتاج مراجعتك</h2><p>${pending.length} طلب تعديل · ${long.length} وردية عدّت ${hours} ساعة</p></div>${pending.length?btn('tab','راجع الطلبات','requests'):''}</section>`:'<p class="att-all-clear">مفيش طلبات تعديل معلّقة أو ورديات عدّت مدة التذكير.</p>'}<section class="att-card att-team-live"><div class="att-row"><h2>الفريق دلوقتي</h2><span class="att-muted">${roster().filter(x=>x.active).length} موظف نشط</span></div><div class="att-kpis"><div><strong>${open.length}</strong><small>ورديات مفتوحة</small></div></div>${open.length?open.slice().sort((a,b)=>Date.parse(a.start_at)-Date.parse(b.start_at)).map(s=>`<div class="att-person"><div class="att-avatar" aria-hidden="true">${e((employee(s.employee_id)?.name||'؟').slice(0,1))}</div><div class="att-person-info"><div class="att-row"><b>${e(employee(s.employee_id)?.name||'الموظف')}</b><span class="att-pill ${away(s)?'att-away':'att-working'}">${e(status(s))}</span></div><p class="att-muted">بدأ ${e(fmt(s.start_at))}</p>${long.some(x=>x.id===s.id)?'<p class="att-warning-text">عدّت مدة التذكير · راجع وقت الانصراف</p>':''}</div><strong class="att-person-time" data-hr-clock="${e(s.id)}">${duration(s)}</strong></div>`).join(''):'<p class="att-empty">مفيش ورديات مفتوحة دلوقتي.</p>'}<p class="att-muted">وقت الشغل الصافي تقريبي لحين المراجعة.</p></section><details class="att-card att-section"><summary><h2>التذكيرات والإعدادات</h2></summary>${form('settings',`${field('التذكير بعد كام ساعة؟','reminder_hours','number',hours,'min="1" max="168" step="1" required')}${submit('احفظ مدة التذكير')}`)}<p class="att-muted">التذكير بيتبعت من السيرفر حتى لو البرنامج مقفول. مش بيقفل الوردية تلقائي.</p>${rows('alerts').map(x=>`<div class="att-entry"><p>${e(x.text)}</p><small>${e(fmt(x.created_at))}</small></div>`).join('')}</details>`;
  }
  function team() {
    return `<details class="att-card att-section" ${state.created||!roster().length?'open':''}><summary><h2>+ إضافة موظف حضور فقط</h2></summary><p class="att-muted">حساب للحضور والانصراف برقم سري من ٤ أرقام. ممكن تحدد أجر الساعة دلوقتي أو بعدين.</p>${state.created?`<p class="att-notice">${state.created.id?'الحساب اتعمل: '+e(state.created.name)+'. كمّل تجهيزه من غير إنشاء حساب تاني.':'إنشاء حساب '+e(state.created.name)+' لسه محتاج تأكيد. حدّث البيانات واختار الحساب الموجود بدل ما تعيد الإنشاء.'}</p>`:''}${state.created&&!state.created.id?form('recover_user',`<label class="att-field"><span>الحساب اللي اتعمل</span><select name="employee_id" required><option value="">اختار الحساب بعد التأكد من الاسم</option>${rows('employees').filter(x=>x.name===state.created.name&&(state.created.staffOnly?x.role==='staff':x.role!=='admin')).map(x=>`<option value="${e(x.id)}">${e(x.name)} (${e(x.role)})</option>`).join('')}</select></label>${submit('كمّل تجهيز الحساب الموجود')}`):form('new_staff',`${field('اسم الموظف','name','text',state.created?.name||'','required maxlength="80" '+(state.created?'readonly':''))}${!state.created?field('الرقم السري · ٤ أرقام','pin','password','','required inputmode="numeric" autocomplete="new-password" maxlength="4"'):''}${field('أجر الساعة بالجنيه · اختياري','hourly_rate','text',state.created?.hourly_rate??'','inputmode="decimal"')}${field('الأجر ساري من','effective_on','date',state.created?.effective_on||date(now()),'required')}${submit(state.created?'كمّل تجهيز الموظف':'ضيف الموظف',!!state.pending)}`)}</details><section class="att-card"><h2>الموظفين وأسعار الساعة</h2>${roster().map(x=>{
      const rates=rows('rates').filter(r=>r.employee_id===x.id).slice().sort((a,b)=>b.effective_on.localeCompare(a.effective_on));
      return `<details class="att-entry" data-hr-employee="${e(x.id)}" ${state.focusEmployee===x.id?'open':''}><summary><span><b>${e(x.name)}</b><small>${x.role==='staff'?'حضور فقط':'كاشير'} · ${x.active?'نشط':'متوقف'}</small></span><span>${rates.some(r=>r.effective_on<=date(now()))?cash(rates.find(r=>r.effective_on<=date(now())).hourly_rate):'الأجر مش محدد'}</span></summary><h3>تاريخ أسعار الساعة</h3>${rates.map(r=>`<p>${e(r.effective_on)}: ${cash(r.hourly_rate)} / ساعة</p>`).join('')||'<p class="att-error">حدّد الأجر من أول يوم شغل.</p>'}${form('rate',`<input name="employee_id" type="hidden" value="${e(x.id)}">${field('سعر الساعة الجديد','hourly_rate','text','','required inputmode="decimal"')}${field('ساري من','effective_on','date',date(now()),'required')}${submit('احفظ سعر الساعة')}`)}${x.role==='staff'?`${form('active',`<input type="hidden" name="employee_id" value="${e(x.id)}"><input type="hidden" name="active" value="${x.active?'false':'true'}"><p class="att-muted">${x.active?'وقف الحساب يمنع الدخول؛ السجلات القديمة بتفضل محفوظة.':'تشغيل الحساب يسمح بالدخول تاني.'}</p>${submit(x.active?'وقّف حساب الموظف':'شغّل حساب الموظف')}`)}${form('pin',`<input type="hidden" name="employee_id" value="${e(x.id)}">${field('رقم سري جديد · ٤ أرقام','pin','password','','required inputmode="numeric" autocomplete="new-password" maxlength="4"')}${submit('غيّر الرقم السري')}`)}`:''}</details>`;
    }).join('')||'<p class="att-empty">مفيش موظفين لسه.</p>'}</section>`;
  }
  function adjustmentRow(i) {return `<div class="att-adjustment"><label class="att-field"><span>نوع البند ${i+1}</span><select name="kind_${i}"><option value="bonus">مكافأة</option><option value="deduction">خصم</option><option value="advance">سلفة</option></select></label>${field('المبلغ','amount_'+i,'text','','inputmode="decimal"')}${field('السبب','reason_'+i,'text','','maxlength="500"')}</div>`;}
  function payrollBuilder() {
    const open=rows('shifts').filter(s=>!s.end_at), pending=rows('requests').filter(r=>r.status==='pending');
    return `<section class="att-card"><h2>جهّز كشف مرتب</h2><p class="att-muted">اختار الموظف والفترة، وراجع الحساب قبل الاعتماد.</p>${open.length||pending.length?`<p class="att-error">تنبيه: ${open.length} وردية مفتوحة و${pending.length} طلب تعديل معلق. راجعهم قبل اعتماد الكشوف.</p>`:''}${form('period_report',`${employeeSelect()}<div class="att-grid">${field('من','period_start','date',state.from,'required')}${field('لحد · شامل اليوم ده','period_end','date',state.to,'required')}</div><details class="att-extras"><summary>+ مكافأة، خصم أو سلفة <small>اختياري</small></summary><fieldset class="att-adjustments"><legend>بنود المرتب</legend>${Array.from({length:state.adjustments||1},(_,i)=>adjustmentRow(i)).join('')}${btn('add_adjustment','+ ضيف بند تاني')}</fieldset></details><p class="att-muted">اختار الفترة لعرض أوقات الحضور والانصراف وإجمالي المرتب.</p>${submit('اعرض الكشف')}`)}</section>${periodReport()}${payrollList()}`;
  }
  function staffSummary() {
    const approved=ownRows('payrolls').filter(p=>p.status==='approved'),net=approved.reduce((n,p)=>n+Math.round(Number(p.net)*100),0)/100,paidAmount=approved.reduce((n,p)=>n+Math.round(paid(p)*100),0)/100;
    return `<section class="att-card att-balance"><span class="att-muted">المتبقي من الكشوف المعتمدة</span><strong>${cash(Math.round((net-paidAmount)*100)/100)}</strong><p class="att-muted">بعد الدفعات المسجلة · المسودات والوردية الحالية مش داخلين في المبلغ.</p>${state.staffTab!=='pay'?btn('staff_tab','شوف تفاصيل مستحقاتك','pay'):''}</section>`;
  }
  function sectionTabs(list,selected,action,label) {
    return `<nav class="att-tabs att-tabs-three" aria-label="${label}">${list.map(([k,v])=>`<button type="button" data-a="hr_${action}" data-v="${k}" class="${selected===k?'on':''}" ${selected===k?'aria-current="page"':''}>${v}</button>`).join('')}</nav>`;
  }
  function renderStaff() {
    const ok=ready(),tab=state.staffTab;
    const messages=tab==='today'&&actor()?.role==='staff'&&typeof dashboardMessages==='function'?dashboardMessages():'';
    return shell('حضوري ومرتبي',!ok?waiting():`${messages}${sectionTabs([['today','ورديتي'],['hours','ساعاتي'],['pay','مستحقاتي']],tab,'staff_tab','أقسام حضوري')}<div class="att-view-heading"><div><h2>${tab==='today'?'أهلًا يا '+e(actor()?.name||''):tab==='hours'?'ساعاتك وطلباتك':'مستحقاتك'}</h2><p class="att-muted">${tab==='today'?'وردية واضحة، وخطوة واحدة للتسجيل':tab==='hours'?'راجع تسجيلاتك وتابع طلبات التصحيح':'الكشوف المعتمدة والدفعات في مكان واحد'}</p></div>${btn('refresh','تحديث')}</div>${tab==='hours'?shiftLogs()+requestList():tab==='pay'?staffSummary()+payrollList():currentCard()+staffSummary()+btn('staff_tab','سجل الحضور وطلبات تعديل الانصراف','hours')}`);
  }
  function renderAdmin() {
    const ok=ready();if(!admin())return renderStaff();
    const pending=rows('requests').filter(r=>r.status==='pending').length;
    return shell('الحضور والمرتبات',`${ok?`${sectionTabs([['live','المتابعة'],['requests','المراجعة'+(pending?' · '+pending:'')],['payroll','المرتبات']],state.tab,'tab','أقسام الحضور')}<div class="att-toolbar att-tools"><div>${btn('tab','الموظفين','team',state.tab==='team')}${btn('tab','سجل التعديلات','audit',state.tab==='audit')}</div>${btn('new_shift','+ وردية يدوي')}${btn('refresh','تحديث')}</div>${state.manual?manualShiftForm():({live:()=>liveDashboard()+`<details class="att-history" ${state.focusShift?'open':''}><summary>سجل الحضور بالتفصيل</summary>${shiftLogs()}</details>`,team,requests:()=>requestList(true),payroll:()=>reviewCard()+payrollBuilder(),audit:auditView}[state.tab]||liveDashboard)()}`:waiting()}`);
  }
  function renderWidget() {
    const ok=ready(), s=ok?activeShift(ownId()):null;
    return `<section class="att-root att-widget" dir="rtl"><div><b>${admin()?'الحضور والمرتبات':'حضوري ومرتبي'}</b><small>${state.error?'تعذّر تحديث الحضور':ok?e(admin()?`${roster().filter(x=>activeShift(x.id)).length} في وردية دلوقتي`:status(s)):'جاري التحميل…'}</small></div><button class="att-btn" type="button" data-a="hrOpen">${admin()?'افتح المتابعة':'افتح الحضور'}</button></section>`;
  }
  function requireAdmin() {if(!admin())throw new Error('forbidden');}
  function required(fd,key) {const s=String(fd.get(key)||'').trim();if(!s)throw new Error('اكتب البيانات المطلوبة الأول.');return s;}
  function amount(fd,key,zero=false) {const s=number(required(fd,key));if(!/^\d+(\.\d{1,2})?$/.test(s))throw new Error('اكتب مبلغ صحيح بحد أقصى رقمين بعد العلامة.');const n=Number(s);if(!Number.isFinite(n)||n<0||(!zero&&n===0)||n>1e9)throw new Error('اكتب مبلغ موجب وصحيح.');return n;}
  function validDate(s) {return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
  function getDate(fd,key) {const s=required(fd,key);if(!validDate(s))throw new Error('اختار تاريخ صحيح.');return s;}
  function draftKey(id,fd) {return id+['employee_id','payroll_id','request_id','shift_id'].map(k=>':'+String(fd.get(k)||'')).join('');}
  function keepDraft(event) {
    if(event.target.matches?.('.att-date input'))syncDates();
    const el=event.target,f=el.form;
    if(!f?.matches('form[data-hr-form]')||!el.name||el.type==='password'||el.type==='hidden')return;
    const key=draftKey(f.id,new FormData(f));
    (state.drafts[key]??={})[el.name]=el.value;
  }
  function restoreForms() {
    document.querySelectorAll('form[data-hr-form]').forEach(f=>{
      const values=state.drafts[draftKey(f.id,new FormData(f))];if(!values)return;
      for(const [name,value] of Object.entries(values)){const el=f.elements.namedItem(name);if(el&&el.type!=='password')el.value=value;}
    });
    syncDates();
  }
  // Resolve a wall time in Cairo, irrespective of the phone's time zone. Reject
  // DST gaps/folds rather than silently changing the employee's requested time.
  function cairoToUTC(value) {
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)||!validDate(value.slice(0,10)))throw new Error('اختار تاريخ ووقت صحيح بتوقيت مصر.');
    value=value.length===16?value+':00':value;
    const wall=Date.parse(value+'Z');if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,19)!==value)throw new Error('وقت غير صحيح.');
    const f=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    const key=t=>{const p=f.formatToParts(new Date(t)),g=k=>p.find(x=>x.type===k).value;return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`;};
    const offsets=new Set([-36,0,36].map(h=>{const t=wall+h*3600000;return Date.parse(key(t)+'Z')-t;}));
    const candidates=[...offsets].map(o=>wall-o).filter(t=>key(t)===value);
    if(candidates.length!==1)throw new Error('الوقت ده متكرر أو مش موجود بسبب تغيير الساعة في مصر. راجع وقت الانصراف.');
    return new Date(candidates[0]).toISOString();
  }
  function isUncertain(err) {const code=String(err?.code||'');return !code||/^5|^08|PGRST00|TIMEOUT|NETWORK/.test(code)||/fetch|network|timeout/i.test(err?.message||'');}
  async function command(action,data) {
    if(demo())throw new Error('دي تجربة محلية؛ مفيش حاجة بتتسجل.');
    if(!online())throw new Error('offline');
    const signature=JSON.stringify({action,data});
    if(state.pending&&state.pending.signature!==signature)throw new Error('في طلب سابق محتاج تأكيد. اضغط إعادة تأكيد الطلب الأول.');
    const p=state.pending||{action,data,signature,id:uuid()};state.pending=p;stored('pending',p);
    const token=generation;
    try {
      const res=await sb.rpc('hr_command',{p_action:action,p_data:data,p_request_id:p.id});
      if(token!==generation)return null;
      if(res.error)throw res.error;
      // hr_command returns the saved row directly; errors use PostgREST's
      // error channel. Keep the request ID until the row is confirmed.
      if(!res.data||typeof res.data!=='object'||Array.isArray(res.data))throw new Error('Unconfirmed HR response');
      state.pending=null;stored('pending',null);state.stale=true;
      return res.data;
    } catch(err){if(token===generation&&!isUncertain(err)){state.pending=null;stored('pending',null);}throw err;}
  }
  async function run(task,success) {
    synchronizeActor();if(state.busy)return true;
    if(disabled()){state.notice=demo()?'دي تجربة محلية؛ مفيش حاجة بتتسجل.':'حدّث بيانات الحضور واتأكد من النت الأول.';redraw();return true;}
    state.busy=true;state.notice='';state.error='';const token=generation;setBusy(true);
    try {await task();if(token!==generation)return true;window.HCashFeedback?.confirmed();state.notice=success||'تم التأكيد من السيرفر.';await load();}
    catch(err){if(token===generation)state.notice=/[\u0600-\u06ff]/.test(String(err?.message||''))?err.message:errText(err);}
    finally {if(token===generation){state.busy=false;redraw();}}return true;
  }
  function setBusy(value) {document.querySelectorAll('.att-root button,.att-root input,.att-root select,.att-root textarea').forEach(el=>{el.disabled=value;});}
  async function finishCreated(fd) {
    requireAdmin();let c=state.created;
    if(!c){
      const name=required(fd,'name'),pin=number(required(fd,'pin'));if(!/^\d{4}$/.test(pin))throw new Error('الرقم السري لازم يكون ٤ أرقام.');
      const hourlyRate=String(fd.get('hourly_rate')||'').trim()?amount(fd,'hourly_rate',true):null;
      c={name,hourly_rate:hourlyRate,effective_on:hourlyRate===null?null:getDate(fd,'effective_on'),id:null,converted:false,staffOnly:true};state.created=c;stored('created',c);
      // Account creation has no idempotency contract. Persist intent before the call;
      // an ambiguous response must be reconciled by selecting the existing user.
      let result;
      try {result=await fnCall({action:'create_staff',name,pin});}
      catch(err){if(['name','pin','forbidden','wrong','locked'].includes(err?.code)){state.created=null;stored('created',null);}throw err;}
      if(!result?.id)throw new Error('إنشاء الحساب محتاج تأكيد. حدّث البيانات واختار الحساب الموجود.');
      c.id=result.id;c.converted=true;stored('created',c);
    } else {
      if(!c.id)throw new Error('حدّث البيانات واختار الحساب الموجود قبل أي إنشاء جديد.');
      c.hourly_rate=String(fd.get('hourly_rate')||'').trim()?amount(fd,'hourly_rate',true):null;
      c.effective_on=c.hourly_rate===null?null:getDate(fd,'effective_on');
      stored('created',c);
    }
    // A retried conversion may already have succeeded on the server. Reconcile
    // the refreshed profile before attempting another cashier-to-staff change.
    if(employee(c.id)?.role==='staff')c.converted=true;
    if(!c.converted){await command('convert_staff',{employee_id:c.id});c.converted=true;stored('created',c);}
    if(c.hourly_rate!==null)await command('set_rate',{employee_id:c.id,effective_on:c.effective_on,hourly_rate:c.hourly_rate});
    state.created=null;stored('created',null);
  }
  async function handleAction(name,value,event) {
    if(!String(name).startsWith('hr_'))return false;
    if(event){if(handledEvents.has(event))return true;handledEvents.add(event);event.preventDefault();}
    synchronizeActor();const action=name.slice(3);if(!actor())return true;
    if(['new_shift','edit_shift','cancel_manual','remove_break'].includes(action)){
      if(!admin())return true;
      if(action==='cancel_manual'){state.manual=null;redraw();return true;}
      if(action==='new_shift'){Object.keys(state.drafts).filter(k=>k.startsWith('hr_admin_shift:')).forEach(k=>delete state.drafts[k]);state.manual={expected:null,breakRows:[]};showManual();return true;}
      if(action==='edit_shift'){
        const s=rows('shifts').find(x=>x.id===value);if(!s)return true;
        const breaks=rows('breaks').filter(b=>b.shift_id===s.id).slice().sort((a,b)=>a.id.localeCompare(b.id));
        Object.keys(state.drafts).filter(k=>k.startsWith('hr_admin_shift:')).forEach(k=>delete state.drafts[k]);state.manual={expected:{shift:s,breaks},breakRows:breaks.map((b,index)=>({...b,index}))};showManual();return true;
      }
      if(action==='remove_break'){const row=event?.target.closest('.att-manual-break');if(row&&state.manual){state.manual.breakRows=state.manual.breakRows.filter(b=>b.index!==Number(row.dataset.breakIndex));row.remove();}return true;}
      return true;
    }
    if(action==='add_adjustment'){const button=event?.target.closest('button');if(button){const i=state.adjustments||1;button.insertAdjacentHTML('beforebegin',adjustmentRow(i));state.adjustments=i+1;}return true;}
    if(action==='refresh'){await load();if(state.tab==='audit')await loadAudit(true);return true;}
    if(action==='audit_more'){await loadAudit(false);return true;}
    if(action==='staff_tab'){if(!admin()&&['today','hours','pay'].includes(value)){state.staffTab=value;redraw();}return true;}
    if(action==='tab'){if(admin()&&['live','team','requests','payroll','audit'].includes(value)){state.tab=value;state.manual=null;if(value==='audit'&&!state.auditLoaded)await loadAudit(true);else redraw();}return true;}
    if(action==='retry')return run(async()=>{if(state.pending){const p=state.pending;await command(p.action,p.data);}},'الطلب اتأكد؛ راجع البيانات المحدثة.');
    if(['clock_in','clock_out'].includes(action))return run(()=>command(action,{}),'الحركة اتسجلت بوقت السيرفر.');
    if(action==='cancel_review'){state.review=null;redraw();return true;}
    if(action==='save_period_report')return run(async()=>{
      requireAdmin();
      const p=state.periodReport;
      if(!p)throw new Error('اعرض الكشف الأول.');
      const result=await command('create_payroll',{employee_id:p.employee_id,period_start:p.period_start,period_end:p.period_end,adjustments:p.adjustments});
      state.payroll=result?.id||null;
      state.periodReport=null;
    },'الكشف اتسجل للمراجعة.');
    if(action==='preview_image'){try{const p=rows('payrolls').find(x=>x.id===value);if(!p)throw Error('الكشف غير متاح');if(state.reportImages)state.reportImages.forEach(u=>URL.revokeObjectURL(u));state.reportImages=(await window.PayrollShare.create(p,employee(p.employee_id)||{name:actor().name},paymentsFor(p.id))).map(f=>URL.createObjectURL(f));state.reportId=p.id;state.payroll=p.id;redraw();}catch(err){state.notice=err.message;redraw();}return true;}
    if(action==='share_payroll'){try{const p=value==='period-preview'&&admin()?state.periodReport:rows('payrolls').find(x=>x.id===value);if(!p)throw Error('الكشف غير متاح');state.notice=await window.PayrollShare.share(p,employee(p.employee_id)||{name:actor().name},paymentsFor(p.id));}catch(err){state.notice=err.message||'تعذر تجهيز الكشف';}redraw();return true;}
    if(action==='review_payroll'){
      requireAdmin();return run(async()=>{const res=await sb.rpc('hr_preview_payroll',{p_id:value});if(res.error)throw res.error;state.review=res.data;state.periodReport=null;state.tab='payroll';},'الحساب الحالي جاهز للمراجعة.');
    }
    if(action==='confirm_payroll')return run(async()=>{requireAdmin();const p=state.review;if(!p||p.id!==value)throw Error('راجع الكشف الأول');await command('approve_payroll',{payroll_id:p.id,expected_snapshot:p.snapshot});state.review=null;state.payroll=p.id;},'الكشف اتعمد واتثبت.');
    return false;
  }
  async function handleForm(id,fd) {
    if(!String(id).startsWith('hr_'))return false;
    synchronizeActor();if(!actor())return true;
    if(id==='hr_audit_filter'){state.auditQuery=String(fd.get('query')||'').trim();rememberFilters();redraw();return true;}
    if(id==='hr_logs'){
      try{const from=getDate(fd,'from'),to=getDate(fd,'to');if(from>to)throw new Error('تاريخ البداية لازم يكون قبل النهاية.');state.logFrom=from;state.logTo=to;state.logEmployee=String(fd.get('employee')||'');state.logQuery=String(fd.get('query')||'').trim();rememberFilters();redraw();}catch(err){state.notice=err.message;redraw();}return true;
    }
    if(id==='hr_period_report'){
      state.periodReport=null;
      await run(async()=>{
        requireAdmin();
        const period_start=getDate(fd,'period_start'),period_end=getDate(fd,'period_end');
        if(period_start>period_end)throw new Error('تاريخ البداية لازم يكون قبل النهاية.');
        if((Date.parse(period_end)-Date.parse(period_start))/86400000>365)throw new Error('اختار فترة سنة أو أقل.');
        const adjustments=[];
        for(let i=0;i<(state.adjustments||1);i++){
          if(!String(fd.get('amount_'+i)||'').trim()&&!String(fd.get('reason_'+i)||'').trim())continue;
          const kind=fd.get('kind_'+i);
          if(!['bonus','deduction','advance'].includes(kind))throw new Error('اختار نوع البند.');
          adjustments.push({kind,amount:amount(fd,'amount_'+i),reason:required(fd,'reason_'+i)});
        }
        const employeeId=required(fd,'employee_id');
        const res=await sb.rpc('hr_period_report',{p_employee:employeeId,p_start:period_start,p_end:period_end,p_adjustments:adjustments});
        if(res.error)throw res.error;
        state.from=period_start;state.to=period_end;state.employee=employeeId;
        state.review=null;state.periodReport=res.data;
      },'الكشف جاهز.');
      document.querySelector?.('#period-report')?.scrollIntoView({block:'start',behavior:'auto'});
      return true;
    }
    return run(async()=>{
      if(id==='hr_admin_shift'){
        requireAdmin();const m=state.manual;if(!m)throw new Error('افتح إضافة أو تعديل الوردية الأول.');
        const unchanged=(value,original)=>original&&(value.length===16?value+':00':value)===wall(original)?original:cairoToUTC(value);const start_at=unchanged(required(fd,'start_at'),m.expected?.shift.start_at),endValue=String(fd.get('end_at')||'').trim(),end_at=endValue?unchanged(endValue,m.expected?.shift.end_at):null;
        if(Date.parse(start_at)>now()||(end_at&&(Date.parse(end_at)<=Date.parse(start_at)||Date.parse(end_at)>now())))throw new Error('راجع المواعيد: الانصراف بعد الحضور، ومفيش تسجيل في المستقبل.');
        const breaks=[];
        for(const [name,val] of fd.entries()){if(!name.startsWith('break_start_'))continue;const i=name.slice(12),old=m.expected?.breaks.find(x=>x.id===fd.get('break_id_'+i)),a=unchanged(String(val),old?.start_at),b=String(fd.get('break_end_'+i)||'').trim();breaks.push({id:String(fd.get('break_id_'+i)||'')||null,start_at:a,end_at:b?unchanged(b,old?.end_at):null});}
        const data={start_at,end_at,breaks,reason:required(fd,'reason')};
        if(m.expected){data.shift_id=m.expected.shift.id;data.expected_snapshot=m.expected;}else data.employee_id=required(fd,'employee_id');
        const result=await command(m.expected?'admin_update_shift':'admin_add_shift',data);state.manual=null;state.tab='live';state.focusShift=result?.id;state.logEmployee=result?.employee_id||data.employee_id;state.logFrom=date(start_at);state.logTo=date(end_at||now());
      } else if(id==='hr_correct'){
        const shift_id=required(fd,'shift_id'),s=rows('shifts').find(x=>x.id===shift_id&&x.employee_id===ownId());if(!s)throw new Error('الوردية دي مش لحسابك.');
        const end_at=cairoToUTC(required(fd,'end_at'));if(Date.parse(end_at)<=Date.parse(s.start_at)||Date.parse(end_at)>now())throw new Error('الانصراف لازم يكون بعد الحضور، ومش في المستقبل.');
        await command('correct',{shift_id,end_at,reason:required(fd,'reason')});
      } else {
        requireAdmin();
        if(id==='hr_review')await command('approve_correction',{request_id:required(fd,'request_id'),approve:fd.get('approve')==='true',reason:required(fd,'reason')});
        else if(id==='hr_rate')await command('set_rate',{employee_id:required(fd,'employee_id'),effective_on:getDate(fd,'effective_on'),hourly_rate:amount(fd,'hourly_rate',true)});
        else if(id==='hr_settings'){const n=Number(number(required(fd,'reminder_hours')));if(!Number.isInteger(n)||n<1||n>168)throw new Error('اكتب مدة تذكير من ١ لحد ١٦٨ ساعة.');await command('set_settings',{reminder_hours:n});}
        else if(id==='hr_new_staff')await finishCreated(fd);
        else if(id==='hr_recover_user'){
          if(!state.created||state.created.id)throw new Error('مفيش حساب محتاج استكمال.');const x=employee(required(fd,'employee_id'));if(!x||x.name!==state.created.name||x.role==='admin'||(state.created.staffOnly&&x.role!=='staff'))throw new Error('راجع الحساب المختار.');state.created.id=x.id;state.created.converted=x.role==='staff';stored('created',state.created);state.tab='team';
        } else if(id==='hr_active'||id==='hr_pin'){
          const x=employee(required(fd,'employee_id'));if(!x||x.role!=='staff')throw new Error('إدارة الحساب هنا للموظفين بس.');
          if(id==='hr_active')await fnCall({action:'set_active',user_id:x.id,active:fd.get('active')==='true'});
          else {const pin=number(required(fd,'pin'));if(!/^\d{4}$/.test(pin))throw new Error('الرقم السري لازم يكون ٤ أرقام.');await fnCall({action:'set_pin',user_id:x.id,pin});}
          state.stale=true;
        } else if(id==='hr_payroll'){
          const period_start=getDate(fd,'period_start'),period_end=getDate(fd,'period_end');if(period_start>period_end)throw new Error('تاريخ البداية لازم يكون قبل النهاية.');
          const adjustments=[];for(let i=0;i<(state.adjustments||1);i++){if(String(fd.get('amount_'+i)||'').trim()||String(fd.get('reason_'+i)||'').trim()){const kind=fd.get('kind_'+i);if(!['bonus','deduction','advance'].includes(kind))throw new Error('اختار نوع البند.');adjustments.push({kind,amount:amount(fd,'amount_'+i),reason:required(fd,'reason_'+i)});}}
          state.from=period_start;state.to=period_end;state.employee=required(fd,'employee_id');
          const result=await command('create_payroll',{employee_id:state.employee,period_start,period_end,adjustments});state.payroll=result?.id||result?.payroll_id||null;
        } else if(id==='hr_payment'){
          const payroll_id=required(fd,'payroll_id'),p=rows('payrolls').find(x=>x.id===payroll_id);if(!p||p.status!=='approved')throw new Error('الدفعات للكشف المعتمد بس.');
          await command('record_payment',{payroll_id,amount:amount(fd,'amount'),paid_on:getDate(fd,'paid_on'),note:required(fd,'note')});state.payroll=payroll_id;
        } else throw new Error('العملية دي مش متاحة.');
      }
      delete state.drafts[draftKey(id,fd)];
    },'تم الحفظ والتأكيد من السيرفر.');
  }
  // Capture only our namespace, so parent delegation cannot submit twice. Theme,
  // logout and hrOpen/hrBack continue through the parent's existing handlers.
  document.addEventListener('click',event=>{
    const el=event.target.closest?.('[data-a^="hr_"]');if(!el||el.disabled)return;
    event.preventDefault();event.stopPropagation();void handleAction(el.dataset.a,el.dataset.v,event);
  },true);
  document.addEventListener('submit',event=>{
    const f=event.target;if(!f.matches?.('form[data-hr-form]'))return;
    event.preventDefault();event.stopPropagation();if(!f.checkValidity()){f.reportValidity();return;}void handleForm(f.id,new FormData(f));
  },true);
  document.addEventListener('click',event=>{const el=event.target;if(el.matches?.('.att-date input')&&typeof el.showPicker==='function'){try{el.showPicker();}catch(_){}}});
  document.addEventListener('input',keepDraft);
  document.addEventListener('change',keepDraft);
  window.Attendance={dailyRows,hasStaffBack:()=>state.staffTab!=='today',backToToday:()=>{state.staffTab='today';state.focusShift=null;},openEmployee:async id=>{if(!admin())return;await load({silent:true});if(!admin())return;state.tab='team';state.focusEmployee=id;redraw();document.querySelector?.('[data-hr-employee="'+id+'"]')?.scrollIntoView({block:'center',behavior:'auto'});},signature:()=>JSON.stringify([state.data.settings,...arrays.map(k=>state.data[k])]),load,renderStaff,renderAdmin,renderWidget,handleAction,handleForm,restoreForms,decorateDates,openAlert,openAudit:async()=>{await load({silent:true});state.tab='audit';await loadAudit(true);redraw();},reset};
})();
