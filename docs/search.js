/* Unified, server-scoped search. Results are kept in memory, never local storage. */
window.HCashSearch=(()=>{
 const labels={party:'الأسماء',device:'الأجهزة',employee:'الموظفين',tx:'حركات اليومية',sale:'مبيعات الأجهزة',return:'المرتجعات'};
 let state,serial=0,timer;
 function reset(){clearTimeout(timer);serial++;state={actor:null,q:'',kind:'all',offset:0,scope:null,entity:null,rows:[],totals:{},busy:false,error:'',searched:false};}
 reset();
 const text=v=>String(v??'');
 const normalized=v=>norm(latin(v)).toLowerCase().replace(/[ً-ٟـ]/g,'');
 function sync(){if(state.actor!==me?.id){reset();state.actor=me?.id;}}
 function sample(){
  const data=[];const add=(kind,id,title,subtitle,record,at)=>data.push({kind,id,title,subtitle,record,at});
  S.parties.forEach(p=>add('party',p.id,p.name,p.phone||'',p));
  S.devices.forEach(d=>add('device',d.id,d.name,shop(d.shopId)?.name||'',{id:d.id,name:d.name,shop_id:d.shopId,sell_price:d.sell,qty:d.qty,archived:d.archived}));
  if(me.role==='admin')S.users.filter(u=>u.role!=='admin').forEach(u=>add('employee',u.id,u.name,u.role==='cashier'?'كاشير':'موظف',u));
  S.txs.filter(t=>me.role==='admin'||(t.shopId===me.shop_id&&t.dayId===openDay(me.shop_id)?.id&&(!t.deleted||t.userId===me.id))).forEach(t=>add('tx',t.id,pname(t),shop(t.shopId)?.name||'',t,t.ts));
  S.sales.filter(s=>me.role==='admin'||s.shopId===me.shop_id&&s.dayId===openDay(me.shop_id)?.id).forEach(s=>add('sale',s.id,s.name,shop(s.shopId)?.name||'',s,s.ts));
  HCashCommerce.returns.forEach(r=>add('return',r.id,r.name,shop(r.shopId)?.name||'',r,r.ts));
  const list=data.filter(x=>state.kind==='all'||state.kind===x.kind).filter(x=>state.scope?state.scope==='party'?x.kind==='tx'&&x.record.partyId===state.entity:state.scope==='device'?['sale','return'].includes(x.kind)&&x.record.deviceId===state.entity:['tx','sale','return'].includes(x.kind)&&x.record.userId===state.entity:normalized([x.title,x.subtitle,x.record.note,x.record.voucher,x.record.amount,user(x.record.userId)?.name].join(' ')).includes(normalized(state.q)));
  const totals={};for(const r of list)totals[r.kind]=(totals[r.kind]||0)+1;
  const rows=[];for(const kind of Object.keys(labels))rows.push(...list.filter(x=>x.kind===kind).sort((a,b)=>(b.at||0)-(a.at||0)||a.title.localeCompare(b.title,'ar')).slice(state.offset,state.offset+15));
  return {rows,totals,page_size:15};
 }
 function summary(x){
  const r=x.record;if(x.kind==='device')return `${r.qty} متاح · ${nf(r.sell_price)} ج.م${r.archived?' · مؤرشف':''}`;
  if(x.kind==='employee')return `${x.subtitle} · ${r.active?'نشط':'متوقف'}`;
  if(x.kind==='party')return r.phone||'افتح سجل الحركات';
  const cancelled=!!(r.deleted_at||r.deleted),amount=x.kind==='tx'?r.amount:x.kind==='sale'?(r.sell_price??r.price)*r.qty:r.amount;
  return `${nf(amount)} ج.م · ${x.subtitle||''}${cancelled?' · ملغاة':''}${x.at?' · '+dayLabel(dayOf(x.at)):''}`;
 }
 function results(){
  if(state.busy)return '<p class="search-message" role="status">جاري البحث…</p>';
  if(state.error)return `<p class="err" role="alert">${esc(state.error)}</p><button class="btn" data-a="searchRetry">إعادة المحاولة</button>`;
  if(!state.searched)return '<p class="search-message">اكتب اسم، ملاحظة، مبلغ أو رقم بون. حرفين على الأقل.</p>';
  if(!state.rows.length)return '<p class="search-message">مفيش نتائج مطابقة في نطاق صلاحيات حسابك.</p>';
  return Object.keys(labels).map(kind=>{
   const rows=state.rows.filter(x=>x.kind===kind);if(!rows.length)return '';
   return `<section class="search-group"><div class="head"><h3>${labels[kind]}</h3><span class="muted small">${state.totals[kind]||rows.length} نتيجة</span></div><div class="search-list">${rows.map(x=>`<button type="button" class="search-result" data-a="searchOpen" data-v="${x.kind}:${x.id}"><span><b>${esc(x.title)}</b><small>${esc(summary(x))}</small></span><span aria-hidden="true">‹</span></button>`).join('')}</div>${state.kind==='all'&&(state.totals[kind]||0)>rows.length?`<button class="btn sm" data-a="searchKind" data-v="${kind}">كل نتائج ${labels[kind]}</button>`:''}</section>`;
  }).join('')+(state.kind!=='all'?`<div class="search-pages">${state.offset?'<button class="btn" data-a="searchPrevious">السابق</button>':''}${state.offset+state.rows.length<(state.totals[state.kind]||0)?'<button class="btn" data-a="searchNext">التالي</button>':''}</div>`:'');
 }
 function paint(){if(ui.modal?.kind!=='globalSearch')return;const box=document.getElementById('unified-results');if(box){box.innerHTML=results();box.setAttribute('aria-busy',String(state.busy));}}
 async function run(){
  sync();clearTimeout(timer);const token=++serial,actor=me?.id;
  if(!actor||me.role==='staff')return;
  if(state.q.trim().length<2){state.busy=false;state.rows=[];state.searched=false;paint();return;}
  state.busy=true;state.error='';paint();
  try{
   const result=DEMO?sample():must(await sb.rpc('hcash_search',{p_query:state.q.trim(),p_kind:state.kind,p_offset:state.offset,p_scope:state.scope,p_entity:state.entity}));
   if(token!==serial||me?.id!==actor)return;
   if(!Array.isArray(result?.rows)||!result.totals)throw Error('Invalid search response');
   state.rows=result.rows;state.totals=result.totals;state.searched=true;
  }catch(_){if(token===serial&&me?.id===actor){state.rows=[];state.totals={};state.error='تعذر البحث. اتأكد من الاتصال وجرّب تاني.';}}
  finally{if(token===serial&&me?.id===actor){state.busy=false;paint();}}
 }
 function modal(m){
  if(m?.kind==='globalSearch'){
   sync();return sheet('<h2>بحث موحّد</h2>',`<form id="unifiedsearchf" class="unified-search-form"><label class="field" for="unified-query">اسم / ملاحظة / مبلغ / رقم بون<input id="unified-query" name="q" type="search" maxlength="80" value="${esc(state.q)}" autocomplete="off" placeholder="دوّر في البرنامج" data-autofocus></label><button class="btn primary" type="submit">ابحث</button></form>${state.scope?`<div class="search-scope"><span>سجل: ${esc(state.q)}</span><button class="btn sm" data-a="searchClearScope">بحث عام</button></div>`:''}<nav class="search-filters" aria-label="نوع نتائج البحث">${[['all','الكل'],...Object.entries(labels).filter(([k])=>me.role==='admin'||k!=='employee')].map(([k,v])=>`<button type="button" class="btn sm ${state.kind===k?'primary':''}" data-a="searchKind" data-v="${k}" aria-pressed="${state.kind===k}">${v}</button>`).join('')}</nav><p class="muted small">${me.role==='admin'?'يشمل السجل القديم، والحركات الملغاة.':'حركات المحل في اليوم المفتوح، ضمن صلاحياتك.'}</p><div id="unified-results" aria-busy="${state.busy}" aria-live="polite">${results()}</div>`,'unified-search');
  }
  if(m?.kind==='searchEntity'){
   const x=m.result,r=x.record;return sheet(`<h2>${esc(x.title)}</h2>`,`<p class="muted">${esc(x.subtitle||'')}</p><dl class="movement-info">${x.kind==='device'?`<div><dt>الكمية المتاحة</dt><dd>${r.qty}</dd></div><div><dt>سعر البيع</dt><dd>${money(r.sell_price)}</dd></div><div><dt>الحالة</dt><dd>${r.archived?'مؤرشف':'في المخزون'}</dd></div>`:`<div><dt>رقم التليفون</dt><dd dir="ltr">${esc(r.phone||'—')}</dd></div>`}</dl><button class="btn primary wide" data-a="searchScope" data-v="${x.kind}:${x.id}">${x.kind==='device'?'المبيعات والمرتجعات المرتبطة':'حركات الاسم ده'}</button><button class="btn wide" data-a="globalSearch">رجوع للبحث</button>`);
  }
  return null;
 }
 function install(A,F){
  A.globalSearch=()=>{sync();if(me.role==='staff')return false;ui.modal={kind:'globalSearch'};if(state.q.trim().length>=2)void run();};
  A.searchKind=kind=>{if(!['all',...Object.keys(labels)].includes(kind))return false;state.kind=kind;state.offset=0;ui.modal={kind:'globalSearch'};void run();};
  A.searchRetry=()=>{void run();return false;};
  A.searchNext=()=>{state.offset+=15;void run();return false;};
  A.searchPrevious=()=>{state.offset=Math.max(0,state.offset-15);void run();return false;};
  A.searchClearScope=()=>{state.scope=null;state.entity=null;state.offset=0;state.kind='all';void run();};
  A.searchScope=ref=>{const x=state.rows.find(x=>`${x.kind}:${x.id}`===ref);if(!x)return false;state.scope=x.kind;state.entity=x.id;state.q=x.title.length>=2?x.title:'سجل '+x.title;state.q=state.q.slice(0,80);state.kind='all';state.offset=0;ui.modal={kind:'globalSearch'};void run();};
  A.searchOpen=ref=>{
   const x=state.rows.find(x=>`${x.kind}:${x.id}`===ref);if(!x)return false;
   if(x.kind==='employee'){if(me.role!=='admin')return false;ui.modal=null;ui.hr=true;void Attendance.openEmployee(x.id);return;}
   if(['party','device'].includes(x.kind)){ui.modal={kind:'searchEntity',result:x};return;}
   if(!DEMO){if(x.kind==='tx')upsert(S.txs,mapTx(x.record));else if(x.kind==='sale')upsert(S.sales,mapSale(x.record));else HCashCommerce.acceptSearchReturn(x.record);}
   ui.modal={kind:'detail',ref};
  };
  F.unifiedsearchf=fd=>{state.q=String(fd.get('q')||'').slice(0,80);state.offset=0;return run();};
 }
 document.addEventListener('input',event=>{
  if(event.target.id!=='unified-query')return;
  sync();state.q=event.target.value.slice(0,80);state.scope=null;state.entity=null;document.querySelector('.search-scope')?.remove();state.offset=0;serial++;clearTimeout(timer);
  state.busy=false;state.rows=[];state.totals={};state.searched=false;paint();timer=setTimeout(run,350);
 });
 return {modal,install,reset};
})();
