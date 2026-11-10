/* Persist the original financial command before sending; never mint a new ID
 * on retry. The server keeps its own immutable receipt even after a ledger wipe. */
window.HCashReceipts=(()=>{
 const key=id=>'hcash-pending:'+id;
 const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function read(){if(!me||DEMO)return null;try{const r=JSON.parse(localStorage.getItem(key(me.id))||'null');return r?.actor===me.id&&['tx','sale','return'].includes(r.kind)?r:null;}catch(_){return null;}}
 function write(r){localStorage.setItem(key(r.actor),JSON.stringify(r));if(JSON.parse(localStorage.getItem(key(r.actor))||'null')?.payload?.p_id!==r.payload.p_id)throw Error('تعذر حفظ المحاولة بأمان على الجهاز.');}
 function renderCard(){const r=read();return r?`<details class="receipt-card" open><summary>${ui.saving?'جاري تأكيد التسجيل…':'محاولة تسجيل محفوظة وتحتاج تأكيد'}</summary><p>${e(r.summary)}</p><small>${e(new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',dateStyle:'short',timeStyle:'short'}).format(new Date(r.created_at)))}</small><p class="muted small">إعادة التأكيد تستخدم نفس المحاولة، ومش بتسجّل حركة تانية. تقدر تقفل البرنامج وترجع لها بنفس الحساب.</p><button class="btn primary" data-a="receipt_retry" ${ui.saving?'disabled':''}>${ui.saving?'جاري الحفظ…':'أكّد نفس المحاولة'}</button></details>`:'';}
 async function send(r){
  if(ui.saving)return false;const actor=r.actor;ui.saving=true;ui.saveState='saving';ui.modal=null;
  r.attempts=(r.attempts||0)+1;
  try{
   write(r);render();
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
   let response;try{response=await sb.rpc(r.kind==='tx'?'hcash_post_tx':r.kind==='return'?'hcash_return_sale':'hcash_post_sale',r.payload).abortSignal(controller.signal);}finally{clearTimeout(timer);}
   if(response.error)throw response.error;if(!response.data?.id)throw Error('Unconfirmed response');
   localStorage.removeItem(key(actor));
   if(me?.id!==actor)return true;
   if(!response.data._receipt_replayed){if(r.kind==='tx')upsert(S.txs,mapTx(response.data));else if(r.kind==='sale')upsert(S.sales,mapSale(response.data));}
   ui.saveState='saved';ui.saving=false;window.HCashFeedback?.confirmed();toast(response.data._receipt_replayed?'المحاولة كانت متسجلة قبل كده؛ اتأكدت بدون تكرار.':'اتسجلت واتأكدت من السيرفر.');
   try{await refresh();}catch(_){toast('التسجيل اتأكد، لكن تحديث الأرصدة محتاج اتصال.');}render();return true;
  }catch(error){
   if(me?.id!==actor)return false;
   const definite=error.code&&!/^(08|5|PGRST00)/.test(String(error.code));
   if(definite&&(r.attempts===1||/MIN_PRICE_APPROVAL/.test(String(error.message))))localStorage.removeItem(key(actor));
   ui.saveState='uncertain';toast(definite?errText(error):'التسجيل لم يتأكد. المحاولة محفوظة؛ أعد تأكيدها بدل تسجيلها من جديد.');
   return false;
  }finally{if(me?.id===actor){ui.saving=false;render();}}
 }
 async function submit(kind,payload,summary){
  if(!me||ui.saving)return false;
  if(read()){toast('أكد المحاولة السابقة المحفوظة الأول.');render();return false;}
  const r={actor:me.id,kind,payload,summary,created_at:new Date().toISOString(),attempts:0};
  try{write(r);}catch(_){toast('تعذر حفظ المحاولة بأمان على الجهاز. التسجيل لم يُرسل.');render();return false;}
  return send(r);
 }
 document.addEventListener('click',event=>{const b=event.target.closest?.('[data-a="receipt_retry"]');if(!b)return;event.preventDefault();event.stopPropagation();const r=read();if(r)void send(r);},true);
 return {read,submit,retry:()=>{const r=read();return r?send(r):Promise.resolve(false);},render:renderCard};
})();
