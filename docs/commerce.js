/* Commerce presentation and server-confirmed workflows. No credentials are persisted. */
window.HCashCommerce=(()=>{
 let returns=[],prefs=[],signalTimer;
 const canCost=()=>me?.role==='admin'||me?.view_cost===true;
 const mapReturn=r=>({id:r.id,ts:Date.parse(r.created_at),saleId:r.sale_id,shopId:r.shop_id,dayId:r.day_id,deviceId:r.device_id,name:r.device_name,qty:r.qty,amount:Number(r.amount),buy:r.buy_price==null?null:Number(r.buy_price),restock:r.restock,pay:r.pay,reason:r.reason,userId:r.actor_id});
 async function pages(name){const data=[];for(let offset=0;;offset+=500){const part=must(await sb.rpc(name,{p_offset:offset,p_limit:500}));data.push(...part);if(part.length<500)return {data};}}
 async function load(){
  if(DEMO){if(me)me.view_cost=me.role==='admin';return;}
  const actor=me?.id;if(!actor||me.role==='staff')return;
  const [r,p,c]=await Promise.all([pages('hcash_returns_page'),sb.from('hcash_staff_preferences').select('*'),sb.rpc('hcash_can_cost')]);
  if(me?.id!==actor)return;returns=must(r).map(mapReturn);prefs=must(p);me.view_cost=must(c);
 }
 function applySnapshot(data){returns=data.returns.map(mapReturn);prefs=data.preferences;me.view_cost=data.view_cost===true;}
 const dayReturns=d=>d?returns.filter(r=>r.dayId===d.id):[];
 const saleReturns=id=>returns.filter(r=>r.saleId===id);
 const remaining=s=>Math.max(0,s.qty-saleReturns(s.id).reduce((n,r)=>n+r.qty,0));
 function net(base,rs){const result={...base,returned:0,refunded:0};for(const r of rs){result[r.pay]-=r.amount;result.total-=r.amount;result.profit-=r.amount-(r.restock?r.qty*(r.buy||0):0);result.returned+=r.qty;result.refunded+=r.amount;}return result;}
 const dayNet=d=>net(saleTot(daySales(d)),dayReturns(d));
 function returnItem(r){return `<li class="item tap return-row" data-a="detail" data-v="return:${r.id}"><span class="av return-av" aria-hidden="true">↩</span><div class="mid"><button class="detail-title" data-a="detail" data-v="return:${r.id}">${esc(r.name)}</button><small>مرتجع × ${r.qty} · ${dn(r.pay,r.shopId)} · ${tm(r.ts)}</small><small>${r.restock?'رجع للمخزن':'لم يرجع للمخزن'}</small></div><div class="end"><span class="amt gave-t">−${money(r.amount)}</span></div></li>`;}
 function returnList(d){const rs=dayReturns(d);return rs.length?`<section><h2>مرتجعات اليوم</h2><ul class="list">${rs.slice().sort((a,b)=>b.ts-a.ts).map(returnItem).join('')}</ul></section>`:'';}
 function infoRow(label,value){return `<div><dt>${label}</dt><dd>${value}</dd></div>`;}
 function modal(m){
  if(m.kind==='detail'){
   const [kind,id]=m.ref.split(':'),x=kind==='tx'?S.txs.find(r=>r.id===id):kind==='sale'?S.sales.find(r=>r.id===id):returns.find(r=>r.id===id);if(!x)return sheet('<h2>تفاصيل الحركة</h2>','<p>الحركة غير متاحة للحساب الحالي.</p>');
   const title=kind==='tx'?pname(x):x.name,amount=kind==='tx'?x.amount:kind==='sale'?x.price*x.qty:x.amount;
   const status=kind==='tx'?(x.deleted?'ملغاة':x.transferred?'اتنقلت لكناش':'بانتظار النقل لكناش'):kind==='sale'?(x.deleted?'تسجيل بيع ملغي':remaining(x)<x.qty?'بيع عليه مرتجع':'بيع مؤكد'):'مرتجع مؤكد';
   const rows=[infoRow('الموظف',esc(user(x.userId)?.name||'—')),infoRow('المحل',esc(shop(x.shopId)?.name||'—')),infoRow('التاريخ',esc(dayLabel(dayOf(x.ts)))+' · '+tm(x.ts)),infoRow('الحالة',status)];
   if(kind==='tx'){rows.push(infoRow('الدرج',dn('cashier',x.shopId)),infoRow('نوع الحركة',TYPES[x.type].label),infoRow('الملاحظة',esc(x.note||'—')));if(x.transferredAt)rows.push(infoRow('اتنقلت لكناش',esc(dayLabel(dayOf(x.transferredAt)))+' · '+tm(x.transferredAt)));if(x.deleted)rows.push(infoRow('سبب الإلغاء',esc(x.deleted.reason||'—')),infoRow('ألغاها',esc(user(x.deleted.by)?.name||'—')));}
   else {rows.push(infoRow('الكمية',nf(x.qty)),infoRow('الدرج',dn(x.pay,x.shopId)));if(kind==='sale'){rows.push(infoRow('سعر الواحد',money(x.price)));if(canCost()&&x.buy!=null)rows.push(infoRow('سعر الشراء',money(x.buy)),infoRow('مكسب البيع الأصلي',money(x.qty*(x.price-x.buy))));if(x.voucher)rows.push(infoRow('رقم البون',esc(x.voucher)));if(x.deletedAt)rows.push(infoRow('ألغى التسجيل',esc(user(x.deletedBy)?.name||'—')+' · '+tm(x.deletedAt)));if(x.cancelReason)rows.push(infoRow('سبب إلغاء التسجيل',esc(x.cancelReason)));}else rows.push(infoRow('حالة الجهاز',x.restock?'صالح للبيع ورجع المخزن':'لم يُضف للمخزون'),infoRow('سبب المرتجع',esc(x.reason)),infoRow('مرجع البيع',`<button class="btn sm" data-a="detail" data-v="sale:${x.saleId}">افتح البيعة الأصلية</button>`));}
   const actions=kind==='tx'&&me.role==='admin'&&!x.deleted?`<button class="btn primary" data-a="${x.transferred?'untransfer':'send'}" data-v="${x.id}">${x.transferred?'إلغاء علامة النقل':'انقل لكناش'}</button>`:kind==='sale'&&!x.deleted?`${me.role==='admin'&&remaining(x)>0?`<button class="btn primary" data-a="returnSale" data-v="${x.id}">تسجيل مرتجع عميل</button>`:''}${!saleReturns(x.id).length&&(me.role==='admin'||x.userId===me.id)?`<button class="btn" data-a="delSale" data-v="${x.id}">إلغاء تسجيل غلط</button>`:''}`:'';
   const history=kind==='sale'&&saleReturns(x.id).length?`<section><h3>المرتجعات المرتبطة</h3><ul class="list">${saleReturns(x.id).map(returnItem).join('')}</ul></section>`:'';
   return sheet(`<h2>تفاصيل ${kind==='tx'?'الحركة':kind==='sale'?'البيع':'المرتجع'}</h2>`,`<div class="movement-hero"><small>${esc(title)}</small><strong>${money(amount)}</strong><span class="status-pill">${status}</span></div><dl class="movement-info">${rows.join('')}</dl>${history}<div class="detail-actions">${actions}</div>`);
  }
  if(m.kind==='return'){
   const s=S.sales.find(x=>x.id===m.id);if(!s||me.role!=='admin')return '';const max=remaining(s);
   return sheet('<h2>مرتجع عميل</h2>',`<p class="muted">${esc(s.name)} · المتاح للمرتجع ${max} · سعر الواحد ${nf(s.price)}</p><form id="returnf"><label class="field">الكمية<input name="qty" type="number" min="1" max="${max}" step="1" value="1" required></label><label class="field">إجمالي المبلغ المردود<input name="amount" type="number" min="0" step=".01" value="${s.price}" required><small>الإجمالي بيتحسب حسب الكمية، وتقدر تعدله بحد أقصى قيمة البيع الأصلية.</small></label><label class="field">حالة الجهاز<select name="restock"><option value="true">صالح للبيع · يرجع المخزن</option><option value="false">تالف / خارج المخزن · لا يضاف للبيع</option></select></label><label class="field">رد الفلوس من<select name="pay">${onKeys(s.shopId).map(k=>`<option value="${k}" ${k===s.pay?'selected':''}>${dn(k,s.shopId)}</option>`).join('')}</select><small>اختيار اتش كاش يسجّل عكس قيمة القسط؛ مش تحويل أو إلغاء لدى شركة التقسيط.</small></label><label class="field">سبب المرتجع<textarea name="reason" minlength="3" required placeholder="اكتب سبب رجوع الجهاز"></textarea></label><p class="banner small">المرتجع بيتسجل في اليوم المفتوح حاليًا، والبيعة الأصلية بتفضل محفوظة. تأكد من رد الفلوس فعليًا؛ البرنامج بيوثّق فقط.</p><p id="ferr" class="err" role="alert"></p><button class="btn primary wide">أكد تسجيل المرتجع</button></form>`);
  }
  if(m.kind==='delSale'){const s=S.sales.find(x=>x.id===m.id);if(!s)return '';return sheet('<h2>إلغاء تسجيل بيع غلط</h2>',`<p>${esc(s.name)} · ${money(s.price*s.qty)}</p><p class="muted">ده لتصحيح التسجيل بس. هيرجع ${s.qty} للمخزن ويُلغي قيمة البيع من يومه الأصلي. لو العميل رجّع جهاز استخدم «مرتجع عميل».</p><form id="cancelsalef"><label class="field">سبب إلغاء التسجيل<textarea name="reason" minlength="3" required></textarea></label><p id="ferr" class="err" role="alert"></p><button class="btn danger wide">أكد إلغاء التسجيل</button></form>`);}
  return null;
 }
 function pricePolicy(m,d){return me.role!=='admin'&&d.minPrice!=null&&Number(m.amt)<d.minPrice?`<div class="approval-box"><b>السعر أقل من الحد المسموح (${nf(d.minPrice)})</b><p class="small">هشام يأكد بنفسه رقمه السري للموافقة على البيعة دي.</p><label class="field">رقم هشام السري<input id="sale-owner-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label></div>`:'';}
 async function saveSale(){
  if(ui.saving||ui.approvingSale)return;const m=ui.modal,d=device(m?.deviceId);if(!d)return;const price=Number(m.amt),voucher=String(m.voucher||'').trim();
  if(!(price>0)||!Number.isInteger(m.qty)||m.qty<1||m.qty>d.qty)return formErr('راجع السعر والكمية المتاحة.');
  if(!m.pay)return formErr('اختار الفلوس راحت فين.');if(m.pay==='hcash'&&!voucher)return formErr('اكتب رقم البون.');
  m.saleRequest ||= uuid();const actor=me.id;const button=document.querySelector('[data-a="saveSale"]');
  try{
   if(me.role!=='admin'&&d.minPrice!=null&&price<d.minPrice){
    const pin=latin(document.getElementById('sale-owner-pin')?.value||'');if(!/^\d{6}$/.test(pin))return formErr('موافقة هشام محتاجة رقمه السري: ٦ أرقام.');
    const owner=S.users.find(u=>u.role==='admin'&&u.active);if(!owner)return formErr('حساب المدير غير متاح.');
    ui.approvingSale=true;if(button){button.disabled=true;button.textContent='جاري تأكيد موافقة هشام…';}
    if(!DEMO)await fnCall({action:'approve_sale',owner_id:owner.id,sale_id:m.saleRequest,device_id:d.id,qty:m.qty,price,pin});
    if(me?.id!==actor||ui.modal!==m)return;
    const field=document.getElementById('sale-owner-pin');if(field)field.value='';
   }
   if(DEMO){toast('دي تجربة؛ البيع الفعلي من الحساب الحقيقي.');return;}
   await HCashReceipts.submit('sale',{p_id:m.saleRequest,p_device:d.id,p_qty:m.qty,p_price:price,p_pay:m.pay,p_voucher:m.pay==='hcash'?voucher:null},`بيع ${d.name} × ${m.qty} · ${nf(price*m.qty)} · ${payName(m.pay,d.shopId)}`);
  }catch(error){if(me?.id===actor&&ui.modal===m)formErr(errText(error));}finally{if(me?.id===actor)ui.approvingSale=false;if(button?.isConnected){button.disabled=false;button.textContent='سجّل البيع';}}
 }
 function install(A,F){
  A.detail=ref=>{ui.modal={kind:'detail',ref};const [kind,id]=ref.split(':');if(kind==='sale'&&!S.sales.some(x=>x.id===id)&&me.role==='admin'&&!DEMO){const actor=me.id;void sb.from('device_sales').select('*').eq('id',id).maybeSingle().then(result=>{if(me?.id!==actor)return;if(result.data)upsert(S.sales,mapSale(result.data));if(ui.modal?.ref===ref)render();}).catch(()=>{if(me?.id===actor){toast('تعذر تحميل البيعة الأصلية. راجع الاتصال.');render();}});}};
  A.returnSale=id=>{const s=S.sales.find(x=>x.id===id);if(me.role!=='admin'||!s||remaining(s)<1)return false;ui.modal={kind:'return',id,requestId:uuid()};};
  A.toggleCost=id=>{if(me.role!=='admin')return false;const value=!prefs.find(p=>p.user_id===id)?.view_cost;if(DEMO){toast('وضع تجربة؛ الصلاحيات لم تتغير.');return false;}void act(async()=>{must(await sb.from('hcash_staff_preferences').upsert({user_id:id,view_cost:value}));},{done:()=>toast(value?'التكلفة ظاهرة للحساب':'التكلفة مخفية عن الحساب')});return false;};
  const oldSave=A.saveSale;A.saveSale=()=>{if(DEMO&&!(device(ui.modal?.deviceId)?.minPrice!=null&&me.role!=='admin'&&Number(ui.modal.amt)<device(ui.modal.deviceId).minPrice))return oldSave();void saveSale();return false;};
  F.returnf=fd=>{const m=ui.modal,s=S.sales.find(x=>x.id===m.id),qty=Number(latin(fd.get('qty'))),amount=Number(latin(fd.get('amount'))),reason=String(fd.get('reason')||'').trim();if(!Number.isInteger(qty)||qty<1||qty>remaining(s)||!Number.isFinite(amount)||amount<0||amount>Math.round(s.price*qty*100)/100||reason.length<3)return formErr('راجع الكمية والمبلغ واكتب السبب.');if(DEMO){toast('دي تجربة؛ مفيش مرتجع اتسجل.');render();return;}void HCashReceipts.submit('return',{p_id:m.requestId,p_sale:s.id,p_qty:qty,p_amount:amount,p_restock:fd.get('restock')==='true',p_pay:fd.get('pay'),p_reason:reason},`مرتجع ${s.name} × ${qty} · ${nf(amount)}`);};
  F.cancelsalef=fd=>{const id=ui.modal.id,reason=String(fd.get('reason')||'').trim();if(reason.length<3)return formErr('اكتب سبب الإلغاء.');if(DEMO){toast('دي تجربة؛ مفيش بيعة اتلغت.');render();return;}void act(async()=>must(await sb.rpc('hcash_cancel_sale',{p_id:id,p_reason:reason})),{done:()=>{ui.modal=null;toast('اتلغى تسجيل البيع والجهاز رجع المخزن.');}});};
 }
 const costButton=u=>u.role==='cashier'?`<button class="btn sm" data-a="toggleCost" data-v="${u.id}">التكلفة: ${prefs.find(p=>p.user_id===u.id)?.view_cost?'ظاهرة':'مخفية'}</button>`:'';
 function signal(){if(!me||me.role==='staff')return;clearTimeout(signalTimer);signalTimer=setTimeout(()=>refresh().then(softRender).catch(()=>{}),350);}
 document.addEventListener('input',event=>{if(ui.modal?.kind!=='return'||event.target.form?.id!=='returnf')return;const m=ui.modal,s=S.sales.find(x=>x.id===m.id);if(event.target.name==='amount')m.refundCustom=true;if(event.target.name==='qty'&&!m.refundCustom&&s){const amount=event.target.form.elements.namedItem('amount');if(amount)amount.value=String(Math.round(Number(event.target.value)*s.price*100)/100);}});
 function quickActions(){return `<details class="ledger-fold light owner-shortcuts"><summary>تسجيل سريع</summary><div class="quick-actions"><button class="btn" data-a="type" data-v="took">أخدت</button><button class="btn" data-a="type" data-v="gave">أعطيت</button><button class="btn" data-a="sell">بيع جهاز</button><button class="btn" data-a="hrOpen">الحضور</button></div></details>`;}
 return {applySnapshot,quickActions,load,pages,canCost,dayReturns,dayNet,net,returnItem,returnList,modal,pricePolicy,install,costButton,remaining,signal,get returns(){return returns;},reset(){returns=[];prefs=[];clearTimeout(signalTimer);}};
})();

