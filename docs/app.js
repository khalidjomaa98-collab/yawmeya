'use strict';
const CFG = window.YAWMEYA_CONFIG;
const APP_VERSION = 45; // bump with version.json on every release so open apps refresh themselves
// Append the changes for each release before bumping APP_VERSION.
const RELEASE_NOTES = [
  {version:41, changes:[
    'اختيار درج الإكسسوارات في أخدت وأعطيت لما يكون متفعّل للمحل.',
    'رسائل خاصة من هشام لموظف محدد.',
    'حضور وانصراف فقط، وكشف مرتب فيه أوقات وساعات كل يوم.',
    'ثيم جلاس اختياري من «شكل البرنامج».'
  ]},
  {version:42, changes:[
    'الرسائل في الرئيسية، مع تنبيه واضح للموظف لما توصله رسالة.',
    'زر الرجوع يقفل النافذة أو يرجّعك داخل التطبيق.'
  ]},
  {version:43, changes:[
    'إخفاء الرسائل من صندوق الوارد وإرجاعها وقت ما تحتاج.',
    'معاينة الرسالة بتختفي من الرئيسية بعد القراءة.',
    'تحسين زر الرجوع وخيار إعادة المحاولة لو التحميل اتأخر.'
  ]},
  {version:44, changes:[
    'اختيار درج الإكسسوارات بيبقى واضح وثابت أثناء التسجيل.',
    'حسابات حضور وانصراف فقط، وعرض أوضح للأرقام الكبيرة.'
  ]},
  {version:45, changes:[
    'رصيد درج الإكسسوارات ظاهر بوضوح، وصافي الحركة ظاهر لو رصيد البداية مش متسجل.',
    'تأكيد التسجيل بيظهر فور رد السيرفر وبيختفي تلقائيًا.'
  ]}
];
const RECOVERY_EMAIL = 'k_elgindy@yahoo.com';
const RECOVERY_URL = 'https://khalidjomaa98-collab.github.io/yawmeya/?recover=1';
const RECOVERY_ENTRY = new URLSearchParams(location.search).has('recover') || new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
const DEMO = new URLSearchParams(location.search).get('demo'); // 'cashier' | 'admin' shows sample data, saves nothing
const sb = supabase.createClient(CFG.url, CFG.key, {auth:{persistSession:!DEMO, autoRefreshToken:!DEMO, storageKey:'yawmeya-auth'}});

// Same two actions as Konnash: أخدت = came in from the person, أعطيت = given to the person.
const TYPES = {took:{label:'أخدت', prep:'من', sign:'+'}, gave:{label:'أعطيت', prep:'لـ', sign:'−'}};
const PIN_LEN = {admin:6, cashier:4, staff:4};
const KONNASH_OPEN = `intent://#Intent;package=${CFG.konnashPackage};S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=' + CFG.konnashPackage)};end`;
const AV_COLORS = ['#2f6fd6', '#0f8f7e', '#8a4fd1', '#d0741c', '#c2416b', '#4b6b8a', '#2d8a3e', '#b8832a'];

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const latin = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const nf = n => (Math.round(n * 100) / 100).toLocaleString('en-US');
const money = n => `<span class="num">${nf(n)}</span> <span class="cur">ج.م</span>`;
const z = n => String(n).padStart(2, '0');
const cairoFmt = new Intl.DateTimeFormat('en-CA', {timeZone:'Africa/Cairo', year:'numeric', month:'2-digit', day:'2-digit'});
const today = () => cairoFmt.format(new Date());
function addDays(ds, n){ const [Y, M, D] = ds.split('-').map(Number); const d = new Date(Date.UTC(Y, M - 1, D + n)); return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`; }
const dayOf = ts => cairoFmt.format(new Date(ts));
function dayLabel(ds){
  const t = today();
  if (ds === t) return 'النهارده';
  if (ds === addDays(t, -1)) return 'امبارح';
  const [Y, M, D] = ds.split('-'); return `${+D}/${+M}/${Y}`;
}
function tm(ts){ const d = new Date(ts); let h = d.getHours(); const ap = h < 12 ? 'ص' : 'م'; h = h % 12 || 12; return `${h}:${z(d.getMinutes())} ${ap}`; }
const lsGet = k => { try { return localStorage.getItem(k); } catch(e){ return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch(e){} };
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const norm = s => String(s || '').trim().replace(/\s+/g, ' ').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
function avatar(name){
  const n = String(name || '؟').trim(); let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="av" style="background:${AV_COLORS[h % AV_COLORS.length]}" aria-hidden="true">${esc(n[0] || '؟')}</span>`;
}
const icon = {
  took:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  gave:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  out:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor"/></svg>',
  kenash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
  txs:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  notes:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  set:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  dev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>'
};
icon.auto = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>';
icon.light = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>';
icon.dark = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';

icon.glass = '<span class="glass-icon" aria-hidden="true"></span>';

// Only the automatic theme follows the phone. The preference is local to this device.
const THEMES = {auto:['تلقائي', 'زي الموبايل'], light:['نهاري', 'فاتح'], dark:['ليلي', 'غامق'], glass:['جلاس', 'زجاجي فاتح']};
const themePref = () => {
  const stored = lsGet('yawmeya-theme');
  return Object.hasOwn(THEMES, stored) ? stored : 'auto';
};
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(t){
  const r = document.documentElement;
  if (t === 'auto') r.removeAttribute('data-theme'); else r.dataset.theme = t;
  lsSet('yawmeya-theme', t);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'glass' ? '#12484d' : '#102a35');
}
const themeBtn = () => `<button class="ibtn thbtn" data-a="themeSheet" aria-label="شكل البرنامج: ${THEMES[themePref()][0]}">${icon[themePref()]}</button>`;
const TAB_ORDER = ['kenash', 'dev', 'txs', 'notes', 'set'];

// Where the money from a device sale went.
// Hesham can rename them and hide the accessory drawer / H Cash from الإعدادات.
// Each shop has its own drawers (one shop can have the accessory drawer or H Cash and the other not).
const DRAWER_KEYS = ['cashier', 'acc', 'hcash'];
const DRAWER_DEF = {cashier:'درج الكاشير', acc:'درج الإكسسوار', hcash:'اتش كاش'};
let DRW = {}; // shopId -> key -> {name, active}
const drw = (sid, k) => DRW[sid]?.[k] || {name:DRAWER_DEF[k], active:true};
const payName = (k, sid) => drw(sid, k).name;
const dn = (k, sid) => esc(payName(k, sid));
const isOn = (sid, k) => k === 'cashier' || !!drw(sid, k).active;
const onKeys = sid => DRAWER_KEYS.filter(k => isOn(sid, k));
function txDrawerField(sid, selected){
  if(DRW[sid]?.acc?.active!==true)return `<p class="muted small">الدرج: ${dn('cashier',sid)}</p>`;
  return `<fieldset class="field tx-drawers"><legend>سجّل الحركة في</legend><div>${['cashier','acc'].map(key=>`<label><input type="radio" name="drawer" value="${key}" ${key===selected?'checked':''} required><span>${dn(key,sid)}</span></label>`).join('')}</div></fieldset>`;
}
function setDrawers(rows){ (rows || []).forEach(r => { if (DRAWER_DEF[r.key]) (DRW[r.shop_id] ||= {})[r.key] = {name:r.name, active:r.key === 'cashier' || !!r.active}; }); }

/* ---------- state ---------- */
let S = {shops:[], users:[], parties:[], txs:[], notes:[], days:[], devices:[], sales:[]};
let me = null;
const ui = {booting:true, loginUsers:[], needsSetup:false, pinUser:null, pin:'', pinErr:'', pinBusy:false, busy:false,
  shopId:lsGet('yawmeya-shop'), tab:'kenash', kshop:'all', dshop:'all', f:{shop:'all'}, openDays:new Set([today()]), wipeOk:false,
  modal:null, toast:null, dirty:false, offline:!navigator.onLine, installEvt:null};

const user = id => S.users.find(u => u.id === id);
const shop = id => S.shops.find(s => s.id === id);
const party = id => S.parties.find(p => p.id === id);
const live = t => !t.deleted;
const pname = t => party(t.partyId)?.name || '—';
const pendingList = () => S.txs.filter(t => live(t) && !t.transferred && (ui.kshop === 'all' || t.shopId === ui.kshop)).sort((a, b) => a.ts - b.ts);
const openDay = shopId => S.days.find(d => d.shopId === shopId && !d.closedAt);
const dayTxs = d => S.txs.filter(t => t.dayId === d.id);
function totals(list){ const r = {took:0, gave:0, count:0}; list.filter(live).forEach(t => { r[t.type] += t.amount; r.count++; }); return r; }
const device = id => S.devices.find(d => d.id === id);
const daySales = d => S.sales.filter(s => s.dayId === d.id && !s.deleted);
// Sales split by where the money went, plus the profit.
function saleTot(list){ const r = {cashier:0, acc:0, hcash:0, total:0, profit:0, count:0};
  list.filter(s => !s.deleted).forEach(s => { const v = s.qty * s.price; r[s.pay] += v; r.total += v; r.profit += s.qty * (s.price - s.buy); r.count += s.qty; }); return r; }
const upsert = (arr, row) => { const i = arr.findIndex(x => x.id === row.id); if (i >= 0) arr[i] = row; else arr.push(row); };

/* ---------- data ---------- */
const mapTx = r => ({id:r.id, ts:Date.parse(r.ts), date:r.day, shopId:r.shop_id, userId:r.user_id, type:r.type, partyId:r.party_id,
  amount:Number(r.amount), drawer:r.drawer||'cashier', note:r.note || '', afterClose:r.after_close, deleteAck:r.delete_ack,
  deleted:r.deleted_at ? {by:r.deleted_by, ts:Date.parse(r.deleted_at), reason:r.delete_reason} : null,
  transferred:!!r.transferred_at, transferredAt:r.transferred_at ? Date.parse(r.transferred_at) : null, dayId:r.day_id});
const mapDay = r => ({id:r.id, shopId:r.shop_id, openedAt:Date.parse(r.opened_at), openedBy:r.opened_by, closedAt:r.closed_at ? Date.parse(r.closed_at) : null, closedBy:r.closed_by, opening:r.opening_balance == null ? null : Number(r.opening_balance), accOpening:r.acc_opening == null ? null : Number(r.acc_opening)});
const mapDev = r => ({id:r.id, shopId:r.shop_id, name:r.name, buy:r.buy_price==null?null:Number(r.buy_price), minPrice:r.min_price==null?null:Number(r.min_price), sell:Number(r.sell_price), qty:r.qty, archived:!!r.archived});
const mapSale = r => ({id:r.id, ts:Date.parse(r.ts), shopId:r.shop_id, dayId:r.day_id, deviceId:r.device_id, name:r.device_name, qty:r.qty,
  cancelReason:r.cancel_reason, deletedAt:r.deleted_at?Date.parse(r.deleted_at):null, deletedBy:r.deleted_by, buy:r.buy_price==null?null:Number(r.buy_price), price:Number(r.sell_price), pay:r.pay, voucher:r.voucher || '', userId:r.user_id, deleted:!!r.deleted_at});
const mapNote = n => ({recipient:n.recipient_id,shiftId:n.attendance_shift, id:n.id, ts:Date.parse(n.ts), text:n.text, kind:n.kind, read:n.read});
const personalMessages = () => S.notes.filter(n=>me && n.kind==='personal' && n.recipient===me.id);
const messagePreferenceKey = kind => `hcash-message-${kind}:${DEMO?'demo:':''}${me.id}`;
function messagePreference(kind){
  if(!me)return new Set();
  try{
    const ids=JSON.parse(lsGet(messagePreferenceKey(kind))||'[]');
    return new Set(Array.isArray(ids)?ids:[]);
  }catch(_){return new Set();}
}
function saveMessagePreference(kind, ids){
  lsSet(messagePreferenceKey(kind),JSON.stringify([...ids]));
}
function visibleMessages(){
  const hidden=messagePreference('hidden');
  return personalMessages().filter(n=>!hidden.has(n.id));
}
function receivePersonalMessages(rows){
  for(const row of rows){
    if(!me||row.kind!=='personal'||row.recipient_id!==me.id)continue;
    const note=mapNote(row);
    if(S.notes.some(previous=>previous.id===note.id&&previous.read))note.read=true;
    upsert(S.notes,note);
  }
  S.notes.sort((a,b)=>b.ts-a.ts);
  syncMessageAlert();
}
function syncMessageAlert(){
  const el=document.getElementById('personal-message-alert');
  if(!el)return;
  const dismissed=messagePreference('dismissed');
  const unread=visibleMessages().filter(n=>!n.read&&!dismissed.has(n.id));
  const latest=unread[0];
  el.hidden=!latest||ui.initialLoading||ui.booting||!!ui.recovery||['personalInbox','releaseNotes'].includes(ui.modal?.kind);
  if(el.hidden){el.replaceChildren();delete el.dataset.message;return;}
  const key=latest.id+':'+unread.length;
  if(el.dataset.message===key)return;
  el.dataset.message=key;
  el.innerHTML=`<div><strong>رسالة جديدة من الإدارة</strong><small>${unread.length>1?`${unread.length} رسائل غير مقروءة`:'عندك رسالة في صندوق الوارد'}</small></div><button class="btn primary sm" data-a="inbox">اقرأ</button><button class="btn sm" data-a="dismissMessageAlert" aria-label="إخفاء التنبيه">×</button>`;
}
async function fetchPersonalMessages(actor, id){
  let query=sb.from('notes').select('*').eq('recipient_id',actor).eq('kind','personal');
  if(id)query=query.eq('id',id);
  const rows=must(await query.order('ts',{ascending:false}).limit(80))||[];
  if(me?.id!==actor)return [];
  receivePersonalMessages(rows);
  return rows;
}
const extraDays = new Set();
function must(res){ if (res.error) throw res.error; return res.data; }

async function readPages(make){
  const all=[];for(let offset=0;;offset+=500){const batch=must(await make().range(offset,offset+499));all.push(...batch);if(batch.length<500)return {data:all,error:null};}
}
async function refresh(shouldApply=()=>true){
  if (DEMO) return;
  const refreshActor=me?.id;if(!refreshActor)return;
  if (me?.role === 'staff'){
    const [attendance, messages] = await Promise.all([
      Attendance.load({silent:true}),
      sb.from('notes').select('*').eq('recipient_id',refreshActor).order('ts',{ascending:false}).limit(80)
    ]);
    if(me?.id===refreshActor&&!messages.error)receivePersonalMessages(messages.data||[]);
    return attendance;
  }
  // HR is independent of the ledger. Its completion updates the widget silently.
  void Attendance.load({silent:true}).then(()=>{if(me?.id===refreshActor)softRender();}).catch(()=>{});
  const snapshot=must(await sb.rpc('hcash_ledger_snapshot'));
  if(me?.id!==refreshActor||!shouldApply())return;
  const keys=['shops','users','parties','txs','notes','days','devices','sales','drawers','returns','preferences'];
  if(!snapshot||keys.some(k=>!Array.isArray(snapshot[k])))throw Error('Invalid ledger snapshot');
  HCashCommerce.applySnapshot(snapshot);
  const [shops,users,parties,txs,notes,days,devices,sales,drawers]=['shops','users','parties','txs','notes','days','devices','sales','drawers'].map(k=>({data:snapshot[k]}));
  setDrawers(must(drawers));
  S.devices = must(devices).map(mapDev);
  const pendS = S.sales.filter(s => s.pending);
  S.sales = must(sales).map(mapSale);
  pendS.forEach(p => { if (!S.sales.some(s => s.id === p.id)) S.sales.push(p); });
  S.shops = must(shops);
  S.users = must(users);
  S.parties = must(parties);
  const pend = S.txs.filter(t => t.pending);
  S.txs = must(txs).map(mapTx);
  pend.forEach(p => { if (!S.txs.some(t => t.id === p.id)) S.txs.push(p); });
  if(me.role==='admin')S.notes=must(notes).map(mapNote);
  else receivePersonalMessages(must(notes));
  S.days = must(days).map(mapDay);
  for (const d of extraDays) await fetchDay(d, false);
  if(me?.id!==refreshActor)return;
  if (me.role === 'admin'){ if (!shop(ui.shopId)) ui.shopId = S.shops[0]?.id || null; }
  else { me.shop_id = user(me.id)?.shop_id ?? me.shop_id; ui.shopId = me.shop_id; }
  if(me?.id===refreshActor&&me.role==='admin'&&ui.tab==='txs'&&ui.f.from)await loadHistoryRange(ui.f);
}
async function fetchDay(d, rerender = true){
  if (DEMO) return;const actor=me?.id;
  extraDays.add(d);
  const list = must(await sb.from('txs').select('*').eq('day', d)).map(mapTx);
  if(me?.id!==actor)return;list.forEach(t => upsert(S.txs, t));
  const ids = [...new Set(list.map(t => t.dayId).filter(Boolean))];
  if (ids.length) must(await sb.from('shop_days').select('*').in('id', ids)).map(mapDay).forEach(x => upsert(S.days, x));
  if (rerender) render();
}

// Live updates apply the changed row directly instead of reloading everything.
let chan = null, rtTimer = null, hrTimer = null;
function subscribe(){
  if (DEMO) return;
  if (chan) sb.removeChannel(chan);
  const subscriber=me?.id;chan = sb.channel('yawmeya-live');
  for (const table of ['hcash_signals','txs', 'notes', 'parties', 'shop_days', 'devices', 'device_sales', 'shop_drawers', 'hr_shifts', 'hr_breaks', 'hr_rates', 'hr_requests', 'hr_payrolls', 'hr_payments', 'hr_alerts', 'hr_settings']) chan.on('postgres_changes', {event:'*', schema:'public', table}, p => {if(me?.id===subscriber)onChange(table,p);});
  chan.subscribe();
}
function onChange(table, p){
  if(table==='hcash_signals'){HCashCommerce.signal();return;}
  if (table.startsWith('hr_')){ clearTimeout(hrTimer); hrTimer=setTimeout(()=>Attendance.load({silent:true}).then(()=>{if(ui.hr||me?.role!=='admin')softRender();}).catch(()=>{}),250); return; }
  const del = p.eventType === 'DELETE', row = p.new, old = p.old;
  if (table === 'txs'){ if (del) S.txs = S.txs.filter(t => t.id !== old.id); else upsert(S.txs, mapTx(row)); }
  else if (table === 'shop_days'){ if (!del) upsert(S.days, mapDay(row)); }
  else if (table === 'devices'){ if (del || row.archived) S.devices = S.devices.filter(d => d.id !== (row?.id || old.id)); else upsert(S.devices, mapDev(row)); }
  else if (table === 'shop_drawers'){ if (!del) setDrawers([row]); }
  else if (table === 'device_sales'){ if (del) S.sales = S.sales.filter(s => s.id !== old.id); else upsert(S.sales, mapSale(row)); }
  else if (table === 'parties'){ if (!del) upsert(S.parties, {id:row.id, name:row.name, phone:row.phone}); }
  else if (table === 'notes' && (me?.role === 'admin'||row?.recipient_id===me?.id)){
    if(del)S.notes=S.notes.filter(n=>n.id!==old.id);
    else if(row.recipient_id===me.id)receivePersonalMessages([row]);
    else {upsert(S.notes,mapNote(row));S.notes.sort((a,b)=>b.ts-a.ts);}
    if(p.eventType==='INSERT'&&(!row.recipient_id||row.recipient_id===me.id))notifyDevice(mapNote(row));
    if(ui.modal?.kind==='personalInbox'){render();return;}
  }
  clearTimeout(rtTimer); rtTimer = setTimeout(()=>{if(table==='notes'||(!ui.hr&&me?.role!=='staff'))softRender();}, 120);
}
function notifyDevice(n){
  if (!document.hidden||isNative()) return;
  try {
    if(!('Notification' in window)||Notification.permission!=='granted')return;
    const notice=new Notification(n.recipient?'رسالة من الإدارة':'H-Cash',{
      body:n.recipient?'افتح H-Cash لقراءة رسالتك':n.text,tag:n.id,icon:'icons/icon-192.png'
    });
    if(n.recipient)notice.onclick=()=>{window.focus();notice.close();if(me?.id===n.recipient){A.inbox();render();}};
  }catch(e){}
}
function softRender(){
  const a = document.activeElement;
  const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  if (typing || (ui.modal && ui.modal.kind !== 'send')){ ui.dirty = true; return; }
  render();
}

// Each signed-in Android user registers for their own permitted notifications.
let pushReady = false, pushToken = null, pushListenersReady = false;
async function registerPush(){
  const P = window.Capacitor?.Plugins?.PushNotifications;
  if (pushReady || !CFG.push || DEMO || !isNative() || !P || !me) return;
  pushReady = true;
  try {
    let perm = await P.checkPermissions();
    if (perm.receive !== 'granted') perm = await P.requestPermissions();
    if (perm.receive !== 'granted'){pushReady=false;return;}
    if(me.role!=='admin'&&P.createChannel){
      await P.createChannel({id:'hcash-messages',name:'رسائل الإدارة',importance:4,visibility:0,vibration:true}).catch(()=>{});
    }
    if (!pushListenersReady){
      await P.addListener('registration', t => { pushToken = t.value; if (me) sb.from('push_tokens').upsert({token:t.value, user_id:me.id}).then(() => {}); });
      await P.addListener('pushNotificationReceived', ({data}) => {
        if(!me||me.role==='admin'||data?.kind!=='personal'||!data.id)return;
        void fetchPersonalMessages(me.id,data.id).then(()=>{
          if(ui.modal?.kind==='personalInbox')render();else softRender();
        }).catch(()=>{});
      });
      await P.addListener('pushNotificationActionPerformed', e => { if (!me) return; if(e.notification?.data?.kind==='personal'){A.inbox();render();return;} if (e.notification?.data?.module === 'attendance' || e.notification?.data?.kind === 'attendance' || me.role === 'staff'){ui.hr=true;Attendance.openAlert(e.notification?.data?.alert_id,e.notification?.data?.shift_id);}  else if (me.role === 'admin'){ ui.hr = false; ui.tab = 'notes'; } render(); });
      pushListenersReady = true;
    }
    await P.register();
  } catch(e){ pushReady = false; }
}
async function loadLogin(){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
    const [u, n] = await Promise.all([
      sb.rpc('login_users').abortSignal(controller.signal),
      sb.rpc('needs_setup').abortSignal(controller.signal)
    ]);
    ui.loginError=!!(u.error||n.error);
    if(!u.error)ui.loginUsers=u.data||[];
    if(!n.error)ui.needsSetup=!!n.data;
  }finally{clearTimeout(timer);}
}
let initialLoadGeneration=0;
async function hydrateInitialData(){
  const actor=me?.id;if(!actor)return;
  const generation=++initialLoadGeneration;ui.initialLoading=true;ui.initialPending=true;ui.initialError='';
  try{await refresh();if(me?.id===actor&&generation===initialLoadGeneration){ui.initialLoading=false;ui.initialPending=false;render();}}
  catch(_){if(me?.id===actor&&generation===initialLoadGeneration){ui.initialPending=false;ui.initialError='تعذر تحميل بياناتك. راجع الاتصال وجرّب تاني.';render();}}
}
async function loadMe(uid,profile=null){
  const r=profile?.id===uid?{data:profile}:await sb.from('profiles').select('*').eq('id',uid).maybeSingle();
  if(r.error)throw r.error;
  if(r.data?.active&&['admin','cashier','staff'].includes(r.data.role)){
    me=r.data;ui.approvingSale=false;ui.saving=false;ui.saveState='';
    try{ui.f=JSON.parse(lsGet('history-filters:'+me.id)||'null')||{shop:'all'};}catch(_){}
    if(me.role!=='admin')ui.shopId=me.shop_id;
    subscribe();void registerPush();void hydrateInitialData();
  }else{me=null;await sb.auth.signOut();throw Error('forbidden');}
}

async function fnCall(body){
  if (DEMO) return {};
  const {data, error} = await sb.functions.invoke('auth', {body});
  if (error){
    let code = 'server';
    try { code = (await error.context.json()).error || code; } catch(e){}
    throw Object.assign(new Error(code), {code});
  }
  return data;
}
function errText(e){
  const m = String(e?.code || e?.message || '');
  if (m.includes('NO_SHOP') || m === 'no_shop') return 'هشام لسه ما حددلكش أنهي محل.';
  if (String(e?.message||'').includes('CANCEL_REASON_REQUIRED')) return 'اكتب سبب واضح من ٣ إلى ٥٠٠ حرف.';
  if (m.includes('PARTY_REQUIRED')) return 'اكتب الاسم الأول.';
  if (m === 'wrong') return 'الرقم غلط، جرّب تاني.';
  if (m === 'locked') return 'اتكتب رقم غلط كتير. استنى 10 دقايق وجرّب تاني.';
  if (m === 'admin_pin') return 'رقم المدير لازم يكون 6 أرقام.';
  if (m === 'pin') return 'الرقم السري لازم يكون 4 أرقام.';
  if(m==='backup_failed')return 'تعذرت النسخة الاحتياطية، المسح متوقف. جرّب تحديث قائمة النسخ.';
  if (m === 'forbidden') return 'الحركة دي لهشام بس.';
  if(m.includes('MIN_PRICE_APPROVAL'))return 'السعر محتاج موافقة هشام من جديد. افتح البيع وأكد الموافقة.';
  if(m.includes('RETURN_LIMIT'))return 'كمية المرتجع أو قيمته أكبر من المتاح في البيعة.';
  if(m.includes('HAS_RETURN'))return 'البيعة عليها مرتجع؛ إلغاء التسجيل مش متاح.';
  if (m.includes('NO_STOCK')) return 'الكمية دي مش موجودة في المخزن.';
  if (m.includes('VOUCHER')) return 'اكتب رقم البون.';
  if (String(e?.message||'').includes('MESSAGE_RECIPIENT')) return 'الموظف ده مش نشط دلوقتي.';
  if (String(e?.message||'').includes('BAD_DRAWER')) return 'درج الإكسسوارات اتقفل. اختار درج الكاشير.';
  if (m.includes('BAD_PAY')) return 'الدرج ده اتقفل. اختار درج تاني.';
  if (m.includes('NO_DEVICE')) return 'الجهاز ده اتشال من المخزن.';
  if (m === 'unknown_action') return 'البرنامج محتاج يتحدّث. اقفله وافتحه تاني.';
  if (/fetch|network|Failed/i.test(m) || !navigator.onLine) return 'مفيش نت. اتأكد من الاتصال وجرّب تاني.';
  return 'حصلت مشكلة، جرّب تاني.';
}

// Change the screen right away, save in the background, and undo with a message if saving fails.
async function op(local, remote, failMsg){
  if(ui.saving){toast('استنى تأكيد الحفظ الأول');return false;}
  const beforeTx=new Set(typeof S==='undefined'?[]:S.txs.map(x=>x.id));
  const beforeSales=new Set(typeof S==='undefined'?[]:S.sales.map(x=>x.id));
  ui.saving=true;ui.saveState='saving';
  try {
    local();render();
    if(DEMO){ui.saving=false;ui.saveState='';render();return true;}
    await remote();ui.saving=false;ui.saveState='';
    if(!ui.toast)toast('اتحفظ على السيرفر');
    document.querySelector('.save-indicator')?.replaceChildren();
    softRender();return true;
  } catch(e){
    // Do not carry failed optimistic inserts into refresh() as pending forever.
    // If the response was lost after a commit, refresh reads the confirmed row.
    if(typeof S!=='undefined'){
      S.txs=S.txs.filter(x=>!x.pending||beforeTx.has(x.id));
      S.sales=S.sales.filter(x=>!x.pending||beforeSales.has(x.id));
      S.days=S.days.filter(x=>!String(x.id).startsWith('local-')||S.txs.some(t=>t.dayId===x.id)||S.sales.some(t=>t.dayId===x.id));
    }
    ui.saving=false;ui.saveState='uncertain';
    const uncertain=!e?.code||/fetch|network|timeout|abort/i.test(String(e?.message||''));
    toast(uncertain?'الحفظ لم يتأكد. راجع السجل قبل تكرار الحركة.':(failMsg?failMsg+' ':'')+errText(e));
    try {await refresh();}catch(_){}
    render();return false;
  }
}

/* ---------- pieces ---------- */
function band(inner, tall){
  const where = me.role === 'admin' ? 'المدير' : me.role === 'staff' ? 'موظف' : esc(shop(me.shop_id)?.name || 'كاشير');
  return `${DEMO ? '<div class="demo">وضع تجربة: البيانات أمثلة ومش بيتسجل حاجة</div>' : ''}
    <header class="band${tall ? ' tall' : ''}"><div class="in gut">
      <div class="bar"><img class="brand-mark" src="icons/icon-192.png?v=35" alt="H-Cash"><div class="who"><b>${esc(me.name)}</b><small>H-Cash · ${where} <span class="version-tag">إصدار ${APP_VERSION}</span></small></div>
        ${ui.installEvt ? `<button class="ibtn" data-a="install">سطّب</button>` : ''}
        ${me.role === 'admin' && !ui.hr ? '<button class="ibtn" data-a="hrOpen">الحضور</button>' : ''}
        ${me.role!=='staff'?'<button class="ibtn" data-a="globalSearch" aria-label="بحث موحّد">بحث</button>':''}${me.role!=='admin'?'<button class="ibtn" data-a="inbox" aria-label="رسائلي">رسائلي'+(visibleMessages().some(n=>!n.read)?' •':'')+'</button>':''}${themeBtn()}
        <button class="ibtn" data-a="logout" aria-label="خروج">${icon.out}</button></div>
      ${inner}
    </div></header>
    ${ui.offline ? `<div class="offline">مفيش نت. اللي هتسجله مش هيتحفظ لحد ما النت يرجع.</div>` : ''}`;
}
// Cash in the drawer: what the owner started the day with, plus أخدت, minus أعطيت.
// Device sales paid into the cashier drawer add to it too; the accessory drawer has its own start balance.
const cashOf = d => { if (!d || d.opening == null) return null; const r = drawerTxTotals(d,'cashier'); return d.opening + r.took - r.gave + HCashCommerce.dayNet(d).cashier; };
const drawerTxTotals = (d,drawer) => totals(d ? dayTxs(d).filter(t=>(t.drawer||'cashier')===drawer) : []);
const accessoryNet = d => {
  const {took,gave}=drawerTxTotals(d,'acc');
  return took-gave+(d?HCashCommerce.dayNet(d).acc:0);
};
const accOf = d => d?.accOpening==null?null:d.accOpening+accessoryNet(d);
const lastClosed = (shopId, key, fn) => { const d = S.days.filter(x => x.shopId === shopId && x.closedAt && x[key] != null).sort((a, b) => b.closedAt - a.closedAt)[0]; return d ? fn(d) : null; };
const lastClosedCash = (shopId, drawer = 'cashier') => drawer === 'acc' ? lastClosed(shopId, 'accOpening', accOf) : lastClosed(shopId, 'opening', cashOf);
const sumBox = (r,drawer) => `<div class="sum"><div><small>أخدت</small><b class="num in-t" data-count="${drawer}-took" data-val="${r.took}">${nf(r.took)}</b></div><div><small>أعطيت</small><b class="num out-t" data-count="${drawer}-gave" data-val="${r.gave}">${nf(r.gave)}</b></div></div>`;
const shopPills = (cur, action, all) => (S.shops.length < 2 && !all) ? '' :
  `<div class="shops">${[...(all ? [['all', 'المحلين']] : []), ...S.shops.map(s => [s.id, s.name])].map(([id, n]) => `<button class="${cur === id ? 'on' : ''}" data-a="${action}" data-v="${id}">${esc(n)}</button>`).join('')}</div>`;

function item(x, o = {}){
  const T = TYPES[x.type], sub = [];
  if (o.date) sub.push(dayLabel(x.date));
  sub.push(tm(x.ts));
  if(x.drawer==='acc')sub.push(dn('acc',x.shopId));
  if (o.shop) sub.push(esc(shop(x.shopId)?.name));
  if (o.who) sub.push(esc(user(x.userId)?.name));
  let end = o.end || '';
  if (o.mine && x.userId === me.id && !x.deleted && !x.pending) end = `<button class="btn link" data-a="del" data-v="${x.id}">إلغاء الحركة</button>`;
  if (x.pending) end = `<small class="muted">بيتحفظ...</small>`;
  const flag = x.deleted ? `<small class="flag">ملغاة · ألغاها ${esc(user(x.deleted.by)?.name||'—')}${x.deleted.reason ? ': ' + esc(x.deleted.reason) : ''}</small>` : '';
  return `<li class="item ${x.deleted ? 'del' : ''} ${x.pending ? 'pending' : ''} ${o.tap ? 'tap' : ''}" data-id="${x.id}" data-a="detail" data-v="tx:${x.id}">
    ${avatar(pname(x))}
    <div class="mid"><button class="detail-title" data-a="detail" data-v="tx:${x.id}">${esc(pname(x))}</button><small><span class="tag ${x.type}">${T.label}</span> ${sub.join(' · ')}</small>${x.note ? `<small class="note">${esc(x.note)}</small>` : ''}${flag}</div>
    <div class="end"><span class="amt ${x.type}-t">${money(x.amount)}</span>${end}</div></li>`;
}
// A device sale row: what was sold, where the money went, and the profit.
function saleItem(x, o = {}){
  const sub = [];
  if (o.date) sub.push(dayLabel(dayOf(x.ts)));
  sub.push(tm(x.ts));
  if (o.shop) sub.push(esc(shop(x.shopId)?.name));
  if (o.who) sub.push(esc(user(x.userId)?.name));
  let end = o.end || '';
  if (o.mine && x.userId === me.id && !x.deleted && !x.pending && HCashCommerce.remaining(x)===x.qty) end = `<button class="btn link" data-a="delSale" data-v="${x.id}">إلغاء خطأ</button>`;
  if (x.pending) end = `<small class="muted">بيتحفظ...</small>`;
  const profit = x.qty * (x.price - x.buy);
  return `<li class="item sale ${x.deleted ? 'del' : ''} ${x.pending ? 'pending' : ''}" data-id="${x.id}" data-a="detail" data-v="sale:${x.id}">
    <span class="av devav" aria-hidden="true">${icon.dev}</span>
    <div class="mid"><button class="detail-title" data-a="detail" data-v="sale:${x.id}">${esc(x.name)}${x.qty > 1 ? ` <span class="num muted">× ${x.qty}</span>` : ''}</button>
      <small><span class="tag pay-${x.pay}">${dn(x.pay, x.shopId)}</span>${x.voucher ? ` بون <span class="num">${esc(x.voucher)}</span> ·` : ''} ${sub.join(' · ')}</small>
      ${HCashCommerce.canCost()&&x.buy!=null?`<small class="note">مكسب <span class="num ${profit<0?'gave-t':'took-t'}">${nf(profit)}</span></small>`:''}${HCashCommerce.remaining(x)<x.qty?`<small class="gave-t">عليه مرتجع · ${x.qty-HCashCommerce.remaining(x)} جهاز</small>`:''}
      ${x.deleted ? '<small class="flag">تسجيل ملغي، والجهاز رجع المخزن</small>' : ''}</div>
    <div class="end"><span class="amt">${money(x.qty * x.price)}</span>${end}</div></li>`;
}
// Txs and sales of one list, newest first.
const mixed = (txs, sales, o) => [...txs.map(x => ({ts:x.ts, h:() => item(x, o)})), ...sales.map(x => ({ts:x.ts, h:() => saleItem(x, o)}))].sort((a, b) => b.ts - a.ts).map(r => r.h()).join('');
const drawersLine = (d, sid) => { const acc = accOf(d), h = d ? HCashCommerce.dayNet(d).hcash : 0;
  const parts = [isOn(sid, 'acc') && `<span><small>${acc==null?'صافي حركة الإكسسوارات':'رصيد '+dn('acc',sid)}</small><b class="num">${nf(acc??accessoryNet(d))}</b>${acc==null?'<small>رصيد البداية مش متسجل</small>':''}</span>`, isOn(sid, 'hcash') && `<span><small>${dn('hcash', sid)}</small><b class="num">${nf(h)}</b></span>`].filter(Boolean);
  return parts.length ? `<div class="drawers" style="--n:${parts.length}">${parts.join('')}</div>` : ''; };
const xBtn = `<button type="button" class="x" data-a="closeModal" aria-label="إغلاق">×</button>`;

/* ---------- screens ---------- */
function renderLoadingData(){return `${band('')}<main class="wrap gut initial-data" aria-busy="${!!ui.initialPending}"><div class="card"><h1>${ui.initialError?'البيانات مش جاهزة':'جاري تجهيز حسابك'}</h1><p class="muted" role="status">${ui.initialError||'اتأكد الدخول. بنحمّل بيانات الشغل…'}</p>${ui.initialError?'<button class="btn primary" data-a="retryData">إعادة تحميل البيانات</button>':'<div class="data-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>'}</div></main>`;}

const renderBoot = () => `<main class="login gut"><div class="in"><div class="logo"><img class="brand-mark" src="icons/icon-192.png?v=35" alt=""><span dir="ltr" class="brand-word">H-Cash</span></div><p class="muted boot-status">بيحمّل...</p></div></main>`;

function renderSetup(){
  return `<main class="login gut"><div class="in"><div class="logo"><img class="brand-mark" src="icons/icon-192.png?v=35" alt=""><span dir="ltr" class="brand-word">H-Cash</span></div>
    <h1>أول تشغيل: حساب المدير</h1>
    <p class="muted">الحساب ده لهشام. منه هيضيف الكاشيرية ويتابع الحركات.</p>
    <form id="setupf" class="card">
      <div class="field"><label for="su-name">الاسم</label><input id="su-name" name="name" value="هشام" autocomplete="off"></div>
      <div class="field"><label for="su-pin">رقم سري من 6 أرقام</label><input id="su-pin" name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <div class="field"><label for="su-pin2">اكتبه تاني</label><input id="su-pin2" name="pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <p id="ferr" class="err" role="alert"></p>
      <button class="btn primary wide" ${ui.busy ? 'disabled' : ''}>اعمل الحساب وادخل</button></form></div></main>`;
}
function renderRecovery(){
  const reset = ui.recovery === 'reset';
  const title = reset ? 'رقم سري جديد لهشام' : 'نسيت الرقم السري';
  const intro = reset ? 'اكتب 6 أرقام جديدة وأكدها. الحركات والحسابات هتفضل محفوظة.' : 'اكتب إيميل الاستعادة المسجل لحساب هشام. هنرسل عليه رابط لتعيين رقم جديد.';
  return `<main class="login gut"><div class="in"><div class="logo"><img class="brand-mark" src="icons/icon-192.png?v=35" alt=""><span dir="ltr" class="brand-word">H-Cash</span></div>
    <h1>${title}</h1><p class="muted">${intro}</p>
    ${ui.recovery === 'sent' ? '<div class="card"><p role="status">لو الإيميل مسجل، هتوصلك رسالة فيها رابط الاستعادة. راجع البريد المزعج كمان. افتح الرابط في المتصفح على نفس الموبايل أو الكمبيوتر.</p><p class="muted small">لو الرابط انتهت صلاحيته، اطلب رسالة جديدة.</p></div>' : `<form id="${reset ? 'recoverfinishf' : 'recoverrequestf'}" class="card">
      ${reset ? '<div class="field"><label for="rp1">الرقم الجديد</label><input id="rp1" name="pin" type="password" inputmode="numeric" pattern="[0-9٠-٩]{6}" maxlength="6" autocomplete="new-password" required></div><div class="field"><label for="rp2">اكتبه تاني</label><input id="rp2" name="pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" required></div>' : '<div class="field"><label for="recoveremail">إيميل هشام</label><input id="recoveremail" name="email" type="email" dir="ltr" autocomplete="email" required></div>'}
      <p id="ferr" class="err" role="alert"></p><button class="btn primary wide" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'لحظة...' : reset ? 'احفظ الرقم الجديد' : 'ابعت رابط الاستعادة'}</button></form>`}
    ${ui.recoveryError ? `<p class="err" role="alert">${esc(ui.recoveryError)}</p>` : ''}
    <button class="back" data-a="recoveryBack">→ رجوع للدخول</button></div></main>`;
}
const authHeader = () => `<header class="auth-header"><div class="auth-brand"><img src="icons/icon-192.png?v=35" alt=""><span dir="ltr">H-Cash</span></div>${themeBtn()}</header>`;
const loginRole = u => u.role === 'admin' ? 'المدير' : u.role === 'staff' ? 'موظف' : 'كاشير';
function renderLogin(){
  if (ui.needsSetup) return renderSetup();
  if (!ui.pinUser){
    const users=ui.loginUsers.slice().sort((a,b)=>(b.role==='admin')-(a.role==='admin'));
    return `<main class="login auth-screen gut"><div class="in">${authHeader()}
      <section class="auth-intro"><span class="auth-eyebrow">إدارة شغلك، بكل بساطة</span><h1>أهلًا بيك</h1><p>اختار حسابك عشان تدخل البرنامج.</p></section>
      <section class="auth-panel" aria-label="الحسابات"><div class="auth-section-title"><h2>حسابات الفريق</h2><span>${users.length} حسابات</span></div>
      ${users.length ? `<div class="auth-users">${users.map(u => `<button class="ubtn auth-user ${u.role==='admin'?'is-owner':''}" data-a="pickUser" data-v="${u.id}">${avatar(u.name)}<span class="auth-user-info"><b>${esc(u.name)}</b><small>${loginRole(u)}</small></span><span class="auth-user-arrow" aria-hidden="true">‹</span></button>`).join('')}</div>`
        : `<p class="empty">${ui.offline ? 'مفيش نت. اتأكد من الاتصال.' : ui.loginError ? 'تعذّر تحميل الحسابات.' : 'مفيش حسابات لسه.'}</p>${ui.offline||ui.loginError?'<button class="btn wide" data-a="applyUpdate">إعادة المحاولة</button>':''}`}</section>
      ${ui.installEvt ? `<button class="btn" data-a="install">سطّب البرنامج على الموبايل</button>` : ''}
      <footer class="auth-footer"><span>H-Cash</span><span>إصدار ${APP_VERSION}</span></footer></div></main>`;
  }
  const u = ui.loginUsers.find(x => x.id === ui.pinUser), len = PIN_LEN[u.role];
  return `<main class="login auth-screen auth-pin gut"><div class="in">${authHeader()}
    <button class="auth-back" data-a="loginBack">→ اختار حساب تاني</button>
    <section class="auth-panel pin-panel"><div class="pin-person">${avatar(u.name)}<div><h1>${esc(u.name)}</h1><p>${loginRole(u)}</p></div></div>
    <div class="pin-prompt"><h2>اكتب الرقم السري</h2><p>${len} أرقام للدخول لحسابك</p></div>
    <div class="dots ${ui.pinErr ? 'bad' : ''}" aria-label="${ui.pin.length} من ${len}">${Array.from({length:len}, (_, i) => `<span class="${i < ui.pin.length ? 'f' : ''}"></span>`).join('')}</div>
    <p class="err pin-status" role="alert">${ui.pinBusy ? 'جاري تسجيل الدخول…' : esc(ui.pinErr)}</p>
    <div class="pad">${[1,2,3,4,5,6,7,8,9].map(n => `<button data-a="pin" data-v="${n}" ${ui.pinBusy ? 'disabled' : ''}>${n}</button>`).join('')}
      <button class="pin-delete" data-a="pinBack" aria-label="امسح رقم" ${ui.pinBusy ? 'disabled' : ''}>⌫</button><button data-a="pin" data-v="0" ${ui.pinBusy ? 'disabled' : ''}>0</button><span></span></div>
    ${u.role === 'admin' ? '<button class="auth-forgot" data-a="forgotPin">نسيت الرقم السري؟</button>' : ''}
    </section><footer class="auth-footer"><span>H-Cash</span><span>إصدار ${APP_VERSION}</span></footer></div></main>`;
}

function messageRows(notes, mode='inbox'){
  const sent=mode==='sent';
  return notes.map(n=>`<li class="item"><div class="mid message-text">
    ${sent?`<b>إلى ${esc(user(n.recipient)?.name||'الموظف')}</b>`:n.read?'':'<strong class="message-unread">جديدة</strong>'}
    <p>${esc(n.text)}</p><small>${dayLabel(dayOf(n.ts))} · ${tm(n.ts)}${sent?` · ${n.read?'اتقرت':'لسه ما اتقرتش'}`:''}</small>
  </div>${sent?'':`<button class="btn sm" data-a="${mode==='hidden'?'restoreMessage':'hideMessage'}" data-v="${esc(n.id)}">${mode==='hidden'?'إرجاع':'إخفاء'}</button>`}</li>`).join('');
}
function dashboardMessages(){
  const manager=me.role==='admin';
  const notes=manager?S.notes.filter(n=>n.kind==='personal'&&n.recipient):visibleMessages();
  const unread=manager?0:notes.filter(n=>!n.read).length;
  const latest=manager?notes[0]:notes.find(n=>!n.read);
  return `<section class="card dashboard-messages${unread?' has-unread':''}">
    <div class="head"><h2>${manager?'رسائل الفريق':'رسائلي'}</h2>${unread?`<strong class="message-unread">${unread===1?'رسالة جديدة':`${unread} رسائل جديدة`}</strong>`:''}</div>
    ${latest?`<p class="message-preview">${manager?`<b>إلى ${esc(user(latest.recipient)?.name||'الموظف')} · </b>`:''}${esc(latest.text)}</p>`:`<p class="muted small">${manager?'ابعت رسالة خاصة لموظف بالاسم.':'مفيش رسائل جديدة.'}</p>`}
    <div class="message-actions">${manager?'<button class="btn primary sm" data-a="composeMessage">إرسال لموظف</button><button class="btn sm" data-a="sentMessages">الرسائل المرسلة</button>':`<button class="btn ${unread?'primary ':''}sm" data-a="inbox">${unread?'اقرأ الرسائل':'افتح رسائلي'}</button>`}</div>
  </section>`;
}
function renderCashier(){
  const s = shop(me.shop_id);
  if (!s) return `${band('')}<main class="wrap gut">${dashboardMessages()}<p class="empty">هشام لسه ما حددلكش أنهي محل. كلّمه يحددهولك من الإعدادات.</p></main>`;
  const od = openDay(s.id);
  const list = S.txs.filter(t => live(t) && t.shopId === s.id && (od ? t.dayId === od.id : false || (t.pending && !t.dayId)) ).sort((a, b) => b.ts - a.ts);
  const sales = S.sales.filter(x => !x.deleted && x.shopId === s.id && (od ? x.dayId === od.id : (x.pending && !x.dayId)));
  const cancelled=S.txs.filter(t=>t.deleted&&t.userId===me.id&&t.dayId===od?.id);
  const cash = cashOf(od);
  return `${band(`<div class="cash compact-cash"><small>${dn('cashier', s.id)}</small>${cash == null ? `<b class="none">هشام لسه ما كتبش رصيد البداية</b>` : `<b class="num" data-count="cash" data-val="${cash}">${nf(cash)}</b>`}</div>` + `<details class="ledger-fold" data-keep="cashier-summary"><summary>تفاصيل اليوم والأدراج</summary>` + drawersLine(od, s.id) + sumBox(drawerTxTotals(od,'cashier'),'cashier') + (isOn(s.id,'acc')?'<small class="dayinfo">'+dn('acc',s.id)+'</small>'+sumBox(drawerTxTotals(od,'acc'),'acc'):'') + `<small class="dayinfo">${od ? `اليوم بدأ ${dayLabel(dayOf(od.openedAt))} ${tm(od.openedAt)}${od.opening != null ? ` برصيد ${nf(od.opening)}` : ''}` : 'يوم جديد، هيبدأ مع أول حركة'}</small></details>`, false)}
  <main class="wrap cashier-work gut">
    ${dashboardMessages()}
    <div class="acts">
      <button class="act took" data-a="type" data-v="took"><span class="ic">${icon.took}</span>أخدت</button>
      <button class="act gave" data-a="type" data-v="gave"><span class="ic">${icon.gave}</span>أعطيت</button>
      <button class="act sell" data-a="sell"><span class="ic">${icon.dev}</span>بيع جهاز</button>
    </div>
    ${Attendance.renderWidget()}
    ${HCashCommerce.returnList(od)}${cancelled.length?`<details class="ledger-fold light"><summary>حركات ملغاة اليوم · ${cancelled.length}</summary><ul class="list">${cancelled.map(t=>item(t,{date:true})).join('')}</ul></details>`:''}
    <section><div class="head"><h2>حركات اليوم</h2><span class="muted small num">${list.length + sales.length}</span></div>
      ${list.length + sales.length ? `<ul class="list">${mixed(list, sales, {mine:true})}</ul>` : `<p class="empty">لسه مفيش حركات. اضغط أخدت أو أعطيت أو بيع جهاز.</p>`}
    </section>
  </main>`;
}

function renderAdmin(){
  const pend = pendingList();
  const alerts = S.txs.filter(t => t.deleted && t.transferred && !t.deleteAck).length;
  const unread = S.notes.filter(n => !n.recipient&&!n.read).length;
  const tabs = [['kenash','كناش', S.txs.filter(t => live(t) && !t.transferred).length + alerts],['dev','الأجهزة',0],['txs','الحركات',0],['notes','الإشعارات',unread],['set','الإعدادات',0]];
  const ds = S.devices.filter(d => ui.dshop === 'all' || d.shopId === ui.dshop);
  const top = ui.tab === 'kenash' ? `${shopPills(ui.kshop, 'kshop', true)}
      <div class="sum compact-summary pending-summary"><div><small>لسه ما اتنقلش</small><b class="num">${pend.length}</b></div><div><small>أخدت</small><b class="num in-t">${nf(totals(pend).took)}</b></div><div><small>أعطيت</small><b class="num out-t">${nf(totals(pend).gave)}</b></div></div>`
    : ui.tab === 'dev' ? `${shopPills(ui.dshop, 'dshop', true)}
      <div class="sum compact-summary"><div><small>أجهزة في المخزن</small><b class="num">${ds.reduce((a, d) => a + d.qty, 0)}</b></div><div><small>قيمتها بسعر الشراء</small><b class="num">${nf(ds.reduce((a, d) => a + d.qty * d.buy, 0))}</b></div></div>`
    : ui.tab === 'txs' ? `<h1>سجل الحركات</h1>`
    : `<h1>${ui.tab === 'notes' ? 'الإشعارات' : 'الإعدادات'}</h1>`;
  const body = {kenash:tabKenash, dev:tabDev, txs:tabTxs, notes:tabNotes, set:tabSet}[ui.tab]();
  // The bar is part of the layout (not floating), and only the part above it scrolls, so it never slides away.
  return `<div class="shell"><div class="scroller" id="scroller">${band(top)}<main class="wrap admin gut">${body}</main></div>
    <nav class="nav" aria-label="الأقسام"><div class="in"><span class="navpill${ui.navFrom != null ? ' move' : ''}" style="--to:${TAB_ORDER.indexOf(ui.tab)};--from:${ui.navFrom ?? TAB_ORDER.indexOf(ui.tab)}" aria-hidden="true"></span>${tabs.map(([k, l, n]) => `<button class="${ui.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}" ${ui.tab === k ? 'aria-current="page"' : ''}>${icon[k]}${l}${n ? `<span class="badge">${n}</span>` : ''}</button>`).join('')}</div></nav></div>`;
}
// Shops whose day is still open: closing one clears the cashier's screen and starts a fresh day.
// Each shop: its drawer right now, the start balance the owner typed, and closing the day.
function openDaysCard(){
  const rows = S.shops.filter(sh => ui.kshop === 'all' || sh.id === ui.kshop).map(sh => ({sh, d:openDay(sh.id)}));
  if (!rows.length) return '';
  return `<section><h2>الخزنة</h2><ul class="list">${rows.map(({sh, d}) => {
    if (!d) return `<li class="item"><span class="lockic sm off" aria-hidden="true">${icon.lock}</span>
      <div class="mid"><b>${esc(sh.name)}</b><small>مفيش يوم مفتوح</small></div>
      <div class="end"><button class="btn sm" data-a="opening" data-v="${sh.id}">ابدأ برصيد</button>${isOn(sh.id,'acc')?`<button class="btn sm" data-a="openingAcc" data-v="${sh.id}">حدّد بداية الإكسسوارات</button>`:''}</div></li>`;
    const r = totals(dayTxs(d)), cash = cashOf(d), acc = accOf(d), st = HCashCommerce.dayNet(d);
    return `<li class="item openday"><span class="lockic sm" aria-hidden="true">${icon.lock}</span>
      <div class="mid"><b>${esc(sh.name)}</b>
        <div class="owner-cash"><small>${dn('cashier',sh.id)}</small><strong class="num">${cash==null?'اكتب رصيد البداية':nf(cash)}</strong></div><details class="ledger-fold light" data-keep="drawer-${sh.id}"><summary>تفاصيل الخزنة</summary><div class="mini3" style="--n:${onKeys(sh.id).length}"><span><small>${dn('cashier', sh.id)}</small><i class="num ${cash == null ? 'gave-t' : ''}">${cash == null ? 'مفيش بداية' : nf(cash)}</i></span>${isOn(sh.id, 'acc') ? `<span><small>${acc==null?'صافي حركة الإكسسوارات':'رصيد '+dn('acc',sh.id)}</small><i class="num">${nf(acc??accessoryNet(d))}</i></span>` : ''}${isOn(sh.id, 'hcash') ? `<span><small>${dn('hcash', sh.id)}</small><i class="num">${nf(st.hcash)}</i></span>` : ''}</div>
        <small>من ${dayLabel(dayOf(d.openedAt))} ${tm(d.openedAt)}${d.opening != null ? ` · بداية ${nf(d.opening)}` : ''} · <span class="took-t num">+${nf(r.took)}</span> <span class="gave-t num">−${nf(r.gave)}</span></small>
        ${st.count||st.returned ? `<small>${st.count} جهاز اتباع${st.returned?` · مرتجع ${st.returned}`:''} · صافي مكسب <span class="num took-t">${nf(st.profit)}</span></small>` : ''}
        </details><div class="odbtns"><button class="btn sm" data-a="opening" data-v="${sh.id}">رصيد البداية</button>${isOn(sh.id,'acc')?`<button class="btn sm" data-a="openingAcc" data-v="${sh.id}">${acc==null?'حدّد بداية الإكسسوارات':'رصيد بداية الإكسسوارات'}</button>`:''}<button class="btn sm dark" data-a="closeDay" data-v="${sh.id}">قفل اليوم</button></div></div></li>`;
  }).join('')}</ul></section>`;
}
function tabKenash(){
  const pend = pendingList();
  const alerts = S.txs.filter(t => t.deleted && t.transferred && !t.deleteAck);
  const recent = S.txs.filter(t => live(t) && t.transferred && t.transferredAt).sort((a, b) => b.transferredAt - a.transferredAt).slice(0, 6);
  const days = [...new Set(pend.map(t => t.date))];
  return `${dashboardMessages()}${HCashCommerce.quickActions()}${openDaysCard()}${S.days.filter(d=>!d.closedAt&&(ui.kshop==='all'||d.shopId===ui.kshop)).map(d=>HCashCommerce.returnList(d)).join('')}
    ${pend.length ? `<button class="btn primary wide" data-a="send" data-v="${pend[0].id}" style="box-shadow:var(--shadow)">ابدأ النقل لكناش</button>` : ''}
    ${alerts.length ? `<section><h2 class="gave-t">امسح دول من كناش</h2>
      <ul class="list">${alerts.map(x => item(x, {shop:true, date:true, end:`<button class="btn sm" data-a="ack" data-v="${x.id}">مسحتها</button>`})).join('')}</ul></section>` : ''}
    ${pend.length ? days.map(d => `<section><div class="dayhead">${dayLabel(d)}</div><ul class="list">${pend.filter(t => t.date === d).map(x => item(x, {tap:'send', shop:ui.kshop === 'all', who:true})).join('')}</ul></section>`).join('')
      : `<p class="empty">كل الحركات اتنقلت لكناش 👌</p>`}
    ${recent.length ? `<section><h2>آخر اللي اتنقل</h2>
      <ul class="list">${recent.map(x => item(x, {date:true, end:`<button class="btn link" data-a="untransfer" data-v="${x.id}">رجّعها</button>`})).join('')}</ul></section>` : ''}`;
}
// Stock per shop: Hesham adds devices and quantities; sales take them out.
function tabDev(){
  const ds = S.devices.filter(d => ui.dshop === 'all' || d.shopId === ui.dshop).sort((a, b) => (b.qty > 0) - (a.qty > 0) || a.name.localeCompare(b.name, 'ar'));
  const sl = S.sales.filter(s => !s.deleted && (ui.dshop === 'all' || s.shopId === ui.dshop)), st = HCashCommerce.net(saleTot(sl.filter(s => dayOf(s.ts) === today())),HCashCommerce.returns.filter(r=>dayOf(r.ts)===today()&&(ui.dshop==='all'||r.shopId===ui.dshop)));
  const recent = [...sl].sort((a, b) => b.ts - a.ts).slice(0, 15);
  return `<button class="btn primary wide" data-a="devNew" style="box-shadow:var(--shadow)">+ ضيف جهاز للمخزن</button>
    ${ds.length ? `<section><h2>المخزن</h2><ul class="list">${ds.map(d => `<li class="item tap" data-a="devEdit" data-v="${d.id}">
      <span class="av devav" aria-hidden="true">${icon.dev}</span>
      <div class="mid"><b>${esc(d.name)}</b><small>${ui.dshop==='all'?esc(shop(d.shopId)?.name):'سعر البيع'}</small><div class="device-sale-price">${money(d.sell)}</div>${d.minPrice!=null?`<small>الحد الأدنى ${nf(d.minPrice)}</small>`:''}</div>
      <div class="end"><span class="stock ${d.qty ? '' : 'out'}"><b class="num">${d.qty}</b><small>${d.qty ? 'متاح' : 'خلص'}</small></span></div></li>`).join('')}</ul></section>`
      : `<p class="empty">المخزن فاضي. ضيف أول جهاز.</p>`}
    ${st.count||st.returned ? `<section><h2>صافي مبيعات النهارده</h2><div class="kpis3 card"><div><small>اتباع</small><b class="num">${st.count}</b></div><div><small>بفلوس</small><b class="num">${nf(st.total)}</b></div><div><small>مكسب</small><b class="num took-t">${nf(st.profit)}</b></div></div></section>` : ''}
    ${recent.length ? `<section><h2>آخر المبيعات</h2><ul class="list">${recent.map(x => saleItem(x, {date:true, shop:ui.dshop === 'all', who:true})).join('')}</ul></section>` : ''}`;
}
async function loadHistoryRange(f){
  const actor=me?.id;
  if(DEMO||!f?.from||!f?.to)return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(f.from)||!/^\d{4}-\d{2}-\d{2}$/.test(f.to)||f.from>f.to||(Date.parse(f.to)-Date.parse(f.from))/86400000>90)return;
  async function pages(query){const all=[];for(let offset=0;offset<10000;offset+=1000){const batch=must(await query().order('id').range(offset,offset+999));all.push(...batch);if(batch.length<1000)break;}return all;}
  const [rawTx,rawSales]=await Promise.all([pages(()=>sb.from('txs').select('*').gte('day',f.from).lte('day',f.to)),pages(()=>sb.from('device_sales').select('*').gte('ts',addDays(f.from,-1)+'T00:00:00Z').lt('ts',addDays(f.to,2)+'T00:00:00Z'))]);
  if(me?.id!==actor)return;
  const txs=rawTx.map(mapTx),sales=rawSales.map(mapSale);ui.historyLimit=txs.length>=10000||sales.length>=10000;txs.forEach(x=>upsert(S.txs,x));sales.forEach(x=>upsert(S.sales,x));const ids=[...new Set([...txs,...sales,...HCashCommerce.returns.filter(r=>dayOf(r.ts)>=f.from&&dayOf(r.ts)<=f.to)].map(x=>x.dayId).filter(Boolean))];
  for(let i=0;i<ids.length;i+=100)must(await sb.from('shop_days').select('*').in('id',ids.slice(i,i+100))).map(mapDay).forEach(x=>upsert(S.days,x));
}
function tabTxs(){
  const f = ui.f;
  const matches=(x,sale=false)=> (!f.from||dayOf(x.ts)>=f.from)&&(!f.to||dayOf(x.ts)<=f.to)&&(!f.employee||x.userId===f.employee)&&(!f.type||(sale?(x.saleId?f.type==='return':f.type==='sale'):f.type===x.type))&&(!f.q||norm([sale?x.name:party(x.partyId)?.name,x.note,x.voucher,user(x.userId)?.name].join(' ')).includes(norm(f.q)));
  const days = S.days.filter(d => f.shop === 'all' || d.shopId === f.shop).sort((a, b) => (a.closedAt ? 1 : 0) - (b.closedAt ? 1 : 0) || b.openedAt - a.openedAt);
  const filtering=!!(f.q||f.type||f.employee||f.from||f.to);
  const visibleDays=days.filter(d=>!filtering||dayTxs(d).some(x=>matches(x))||(S.sales.some(x=>x.dayId===d.id&&matches(x,true))||HCashCommerce.dayReturns(d).some(x=>matches(x,true))));
  return `<form id="historyf" class="card history-filters"><h2>بحث في السجل</h2><label class="field">اسم / ملاحظة / رقم بون<input name="q" type="search" value="${esc(f.q||'')}"></label><div class="row2"><label class="field">من<input name="from" type="date" value="${esc(f.from||'')}"></label><label class="field">لحد<input name="to" type="date" value="${esc(f.to||'')}"></label></div><label class="field">الموظف<select name="employee"><option value="">الكل</option>${S.users.filter(u=>u.role!=='staff').map(u=>`<option value="${u.id}" ${f.employee===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label><label class="field">نوع الحركة<select name="type">${[['','الكل'],['took','أخدت'],['gave','أعطيت'],['sale','بيع جهاز'],['return','مرتجع جهاز']].map(([k,n])=>`<option value="${k}" ${f.type===k?'selected':''}>${n}</option>`).join('')}</select></label><small class="muted">من غير فترة: البحث في الأيام المحملة. اختار فترة لعرض سجل أقدم (حتى ٩٠ يوم).</small><button class="btn primary">اعرض النتائج</button><button type="button" class="btn" data-a="clearHistory">مسح الفلاتر</button></form>${ui.historyLimit?'<p class="err">النتائج كتير؛ ضيّق الفترة عشان تظهر كاملة.</p>':''}${shopPills(f.shop, 'fshop', true).replace('class="shops"', 'class="shops light"')}
    ${visibleDays.length ? visibleDays.map(d => {
      const list = dayTxs(d).filter(x=>matches(x)), r = totals(list), rs=HCashCommerce.dayReturns(d).filter(x=>matches(x,true)), sl = S.sales.filter(s => s.dayId === d.id&&matches(s,true)), st = HCashCommerce.net(saleTot(sl),rs), open = ui.openDays.has(d.id) || (!d.closedAt && !ui.openDays.has('x' + d.id));
      if((f.q||f.type||f.employee||f.from||f.to)&&!list.length&&!sl.length&&!rs.length)return '';
      const o = {who:true, admin:true};
      return `<section class="day ${open ? 'open' : ''}">
        <button class="dayrow" data-a="toggleDay" data-v="${d.id}" aria-expanded="${open}">
          <span class="dname"><b>${dayLabel(dayOf(d.openedAt))}${f.shop === 'all' ? ' · ' + esc(shop(d.shopId)?.name) : ''}</b>
            <small>${tm(d.openedAt)} ← ${d.closedAt ? tm(d.closedAt) + (user(d.closedBy) ? ' · قفله ' + esc(user(d.closedBy).name) : '') : '<span class="live">مفتوح دلوقتي</span>'} · ${r.count} حركة${st.count ? ` · ${st.count} جهاز` : ''}${rs.length?` · ${rs.length} مرتجع`:''}</small></span>
          <span class="dtot">${!filtering&&d.opening != null ? `<span class="num">${nf(cashOf(d))}</span>` : ''}<span class="took-t num">+${nf(r.took)}</span><span class="gave-t num">−${nf(r.gave)}</span></span>
          <span class="chev" aria-hidden="true">‹</span></button>
        ${open ? (st.count ? `<div class="daysales">أجهزة: <b class="num">${nf(st.total)}</b> · مكسب <b class="num took-t">${nf(st.profit)}</b>${DRAWER_KEYS.filter(k => isOn(d.shopId, k) || st[k]).map(k => ` · ${dn(k, d.shopId)} <span class="num">${nf(st[k])}</span>`).join('')}${!filtering&&d.accOpening != null && isOn(d.shopId, 'acc') ? ` · رصيد ${dn('acc', d.shopId)} <b class="num">${nf(accOf(d))}</b>` : ''}</div>` : '')
          + (list.length + sl.length + rs.length ? `<ul class="list">${[...list.map(x => ({ts:x.ts, h:() => item(x, {...o,
            end:x.deleted ? `<button class="btn link" data-a="restore" data-v="${x.id}">رجّعها</button>` : `<button class="btn link" data-a="del" data-v="${x.id}">إلغاء الحركة</button>`})})),
            ...rs.map(x=>({ts:x.ts,h:()=>HCashCommerce.returnItem(x)})),...sl.map(x => ({ts:x.ts, h:() => saleItem(x, {...o, end:x.deleted ? '' : `<button class="btn link" data-a="delSale" data-v="${x.id}">إلغاء خطأ</button>`})}))].sort((a, b) => b.ts - a.ts).map(z => z.h()).join('')}</ul>`
          : `<p class="empty">مفيش حركات.</p>`) + (d.closedAt ? '' : `<button class="btn dark" data-a="closeDay" data-v="${d.shopId}">قفل اليوم ده</button>`) : ''}</section>`;
    }).join('') : `<p class="empty">مفيش حركات مطابقة للاختيارات.</p>`}
    <div class="card"><label for="fdate" class="muted small">عايز يوم أقدم؟</label><input type="date" id="fdate" data-c="fdate" max="${today()}"></div>`;
}
function tabNotes(){
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `${perm === 'default' ? `<div class="card"><p>فعّل الإشعارات علشان توصلك والبرنامج في الخلفية.</p><button class="btn primary" data-a="askNotify">فعّل الإشعارات</button></div>` : ''}
    <button class="btn primary" data-a="composeMessage">إرسال لموظف</button> <button class="btn" data-a="auditOpen">سجل التعديلات</button>${S.notes.length ? `<ul class="list">${S.notes.map(n => `<li class="item"><div class="mid"><b style="white-space:normal;font-weight:${n.read ? 500 : 700}">${esc(n.text)}</b>${n.shiftId?`<button class="btn sm" data-a="attendanceAlert" data-v="${n.shiftId}">راجع الوردية</button>`:''}<small>${n.recipient?'إلى '+esc(user(n.recipient)?.name||'الموظف')+' · ':''}${dayLabel(dayOf(n.ts))} · ${tm(n.ts)}</small></div></li>`).join('')}</ul>` : `<p class="empty">مفيش إشعارات لسه.</p>`}`;
}
function tabSet(){
  return `${HCashBackups.render()}<div class="release-card"><div><b dir="ltr">H-Cash</b><small>إدارة المحلات والحضور والمرتبات</small></div><span class="version-tag">إصدار ${APP_VERSION}</span></div><details class="settings-section"><summary><h2>المحلات</h2></summary><form id="shopsf" class="card">${S.shops.map(s => `<div class="field"><label for="s_${s.id}">اسم المحل</label><input id="s_${s.id}" name="${s.id}" value="${esc(s.name)}"></div>`).join('')}<button class="btn">احفظ الأسامي</button></form></details>
    <details class="settings-section"><summary><h2>الأدراج</h2></summary><form id="drawersf" class="card">
      <p class="muted small">اختار أسماء الأدراج المتاحة لكل محل. السجل القديم محفوظ.</p>
      ${S.shops.map(sh => `<fieldset class="dshop"><legend>${esc(sh.name)}</legend>${DRAWER_KEYS.map(k => `<div class="drow"><div class="field"><label for="dr_${sh.id}_${k}">${k === 'cashier' ? 'الدرج الأساسي (أخدت وأعطيت)' : k === 'acc' ? 'الدرج التاني' : 'القسط (برقم بون)'}</label><input id="dr_${sh.id}_${k}" name="n|${sh.id}|${k}" value="${dn(k, sh.id)}" maxlength="40" autocomplete="off"></div>
        ${k === 'cashier' ? '<span class="dfix">دايمًا شغال</span>' : `<label class="switch"><input type="checkbox" name="on|${sh.id}|${k}" ${isOn(sh.id, k) ? 'checked' : ''} aria-label="${dn(k, sh.id)} شغال في ${esc(sh.name)}"><span></span><small>شغال</small></label>`}</div>`).join('')}</fieldset>`).join('')}
      <p id="derr" class="err" role="alert"></p><button class="btn">احفظ الأدراج</button></form></details>
    <details class="settings-section"><summary><h2>الكاشيرية</h2></summary><ul class="list">${S.users.filter(u => u.role !== 'staff').map(u => `<li class="item">${avatar(u.name)}<div class="mid"><b>${esc(u.name)}</b><small>${u.role === 'admin' ? 'المدير' : (u.active ? 'كاشير' : 'موقوف')}</small>${u.role === 'admin' ? '' : `<div style="margin-top:6px"><select data-c="ushop" data-u="${u.id}" aria-label="محل ${esc(u.name)}" style="min-height:40px;padding:6px 10px"><option value="">اختار المحل</option>${S.shops.map(s => `<option value="${s.id}" ${u.shop_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>`}</div>
      <div class="end" style="flex-direction:row;gap:6px"><button class="btn sm" data-a="chPin" data-v="${u.id}">الرقم</button>
        ${HCashCommerce.costButton(u)}${u.role !== 'admin' ? `<button class="btn sm" data-a="toggleUser" data-v="${u.id}">${u.active ? 'وقّف' : 'شغّل'}</button>` : ''}</div></li>`).join('')}</ul>
      <form id="userf" class="card"><h3>ضيف كاشير</h3><div class="row2">
        <div class="field"><label for="nu-name">الاسم</label><input id="nu-name" name="name" autocomplete="off"></div>
        <div class="field"><label for="nu-pin">رقم سري 4 أرقام</label><input id="nu-pin" name="pin" inputmode="numeric" maxlength="4" autocomplete="off"></div></div>
        <div class="field"><label for="nu-shop">المحل</label><select id="nu-shop" name="shop"><option value="">اختار المحل</option>${S.shops.map(s => `<option value="${s.id}" ${'' === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <p class="err" id="uerr" role="alert"></p><button class="btn primary" ${ui.busy ? 'disabled' : ''}>ضيف</button></form></details>
    <details class="settings-section"><summary><h2 class="gave-t">مسح كل الحركات</h2></summary><div class="card"><p class="muted small">بيمسح كل الحركات ومبيعات الأجهزة والإشعارات نهائي من المحلين. المرتجعات وبيوعها الأصلية بتفضل محفوظة للمراجعة. المخزن بيفضل زي ما هو. الأسامي والكاشيرية بيفضلوا زي ما هم.</p>
      <button class="btn danger" data-a="wipe">امسح كل الحركات</button></div></details>`;
}

/* ---------- sheets ---------- */
// Most-used names first, so the usual people are one tap away.
function nameOptions(q, sel){
  const nq = norm(q), uses = {};
  S.txs.forEach(t => { uses[t.partyId] = (uses[t.partyId] || 0) + 1; });
  const ps = S.parties.filter(p => !nq || norm(p.name).includes(nq) || (p.phone || '').includes(latin(q).trim()))
    .sort((a, b) => (uses[b.id] || 0) - (uses[a.id] || 0) || a.name.localeCompare(b.name, 'ar')).slice(0, nq ? 30 : 12);
  const exact = nq && S.parties.some(p => norm(p.name) === nq);
  let h = ps.map(p => `<label class="pick"><input type="radio" name="party" value="${p.id}" ${sel === p.id ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('');
  if (nq && !exact) h += `<label class="pick new"><input type="radio" name="party" value="__new" ${sel === '__new' ? 'checked' : ''}><span>+ ${esc(q.trim())} (جديد)</span></label>`;
  return h || `<p>اكتب الاسم فوق.</p>`;
}
function devOptions(shopId, q){
  const nq = norm(q);
  const list = S.devices.filter(d => d.shopId === shopId && d.qty > 0 && (!nq || norm(d.name).includes(nq))).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return list.length ? list.map(d => `<li class="item tap" data-a="pickDev" data-v="${d.id}"><span class="av devav" aria-hidden="true">${icon.dev}</span>
    <div class="mid"><b>${esc(d.name)}</b><small>متاح <span class="num">${d.qty}</span>${HCashCommerce.canCost()?` · شراء <span class="num">${nf(d.buy)}</span>`:''}</small></div>
    <div class="end"><span class="amt">${money(d.sell)}</span></div></li>`).join('')
    : `<li class="empty">${nq ? 'مفيش جهاز بالاسم ده في المخزن.' : 'مفيش أجهزة في مخزن المحل. هشام بيضيفها من قسم الأجهزة.'}</li>`;
}
const sellTot = (m, d) => { const p = Number(m.amt || 0), pr = m.qty * (p - d.buy);
  return `الإجمالي <b class="num">${nf(m.qty*p)}</b>${HCashCommerce.canCost()?` · مكسب <b class="num ${pr<0?'gave-t':'took-t'}">${nf(pr)}</b>`:''}`; };
function sheet(head, body, cls = ''){
  return `<div class="overlay" data-a="closeModal"><div class="sheet" data-a="noop" role="dialog" aria-modal="true">
    <div class="sh ${cls}">${head}${xBtn}</div><div class="sb">${body}</div></div></div>`;
}
function renderModal(){
  const searchModal=HCashSearch.modal(ui.modal);if(searchModal!==null)return searchModal;
  const m = ui.modal; if (!m) return '';
  const commerce=HCashCommerce.modal(m);if(commerce!==null)return commerce;
  if(m.kind==='personalInbox'){
    const messages=visibleMessages();
    const hidden=messagePreference('hidden');
    const archived=personalMessages().filter(n=>hidden.has(n.id));
    const permission=!isNative()&&'Notification' in window&&Notification.permission==='default';
    const list=messages.length?`<ul class="list">${messageRows(messages)}</ul>`:'<p class="empty">مفيش رسائل ليك دلوقتي.</p>';
    return sheet('<h2>رسائلي</h2>',`${permission?'<button class="btn sm" data-a="askNotify">فعّل إشعارات الرسائل</button>':''}${list}${archived.length?`<details class="hidden-messages"><summary>الرسائل المخفية (${archived.length})</summary><ul class="list">${messageRows(archived,'hidden')}</ul></details>`:''}`);
  }
  if(m.kind==='sentMessages'&&me.role==='admin'){
    const messages=S.notes.filter(n=>n.kind==='personal'&&n.recipient);
    return sheet('<h2>الرسائل المرسلة</h2>',messages.length?`<ul class="list">${messageRows(messages,'sent')}</ul>`:'<p class="empty">مفيش رسائل مرسلة لسه.</p>');
  }
  if(m.kind==='releaseNotes'){
    const updates=RELEASE_NOTES.filter(r=>r.version>m.lastSeen&&r.version<=APP_VERSION);
    return sheet(`<h2>إيه الجديد في إصدار ${APP_VERSION}؟</h2>`,`${updates.map(r=>`<section class="release-notes"><h3>إصدار ${r.version}</h3><ul>${r.changes.map(change=>`<li>${esc(change)}</li>`).join('')}</ul></section>`).join('')}<button class="btn primary wide" data-a="closeModal">تمام</button>`);
  }
  if(m.kind==='composeMessage'&&me.role==='admin'){
    const recipients=S.users.filter(u=>u.active&&['cashier','staff'].includes(u.role));
    return sheet('<h2>إرسال لموظف</h2>',recipients.length?
      '<form id="messagef"><label class="field">الموظف<select name="recipient" required><option value="">اختار موظف</option>'+recipients.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.name)+(shop(u.shop_id)?' · '+esc(shop(u.shop_id).name):'')+'</option>').join('')+'</select></label><label class="field">الرسالة<textarea name="text" maxlength="500" rows="4" required></textarea></label><p id="ferr" class="err" role="alert"></p><button class="btn primary wide">ابعت الرسالة</button></form>':'<p class="empty">مفيش موظفين نشطين.</p>');
  }
  if (m.kind === 'theme'){
    const cur = themePref();
    return sheet(`<h2>شكل البرنامج</h2>`, `<div class="themes" role="radiogroup">${Object.entries(THEMES).map(([k, [l, sub]]) =>
      `<button type="button" role="radio" aria-checked="${cur === k}" class="th ${cur === k ? 'on' : ''}" data-a="setTheme" data-v="${k}">
        <span class="prev p-${k}" aria-hidden="true"><i></i><b></b><b></b></span><span class="thl">${icon[k]}${l}</span><small>${sub}</small></button>`).join('')}</div>
      <p class="muted small" style="text-align:center">الاختيار بيتحفظ على الموبايل ده بس.</p>`);
  }
  if (m.kind === 'tx'){
    const T = TYPES[m.type];
    return sheet(`<h2 class="sht"><span class="ic-s">${icon[m.type]}</span>${T.label} ${T.prep}...</h2>`, `<form id="txf" novalidate>
      ${me.role === 'admin' ? `<div class="field"><label for="f-shop">المحل</label><select id="f-shop" name="shop">${S.shops.map(s => `<option value="${s.id}" ${s.id===m.shopId?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>` : ''}
      <div id="tx-drawer-field">${txDrawerField(m.shopId,m.drawer)}</div>
      <div class="field"><label for="pq">الاسم</label><input id="pq" type="search" placeholder="اكتب الاسم أو اختار" autocomplete="off" value="${esc(m.query)}">
        <div id="plist" class="names" role="radiogroup" style="margin-top:4px">${nameOptions(m.query,m.party)}</div></div>
      <div class="amtbox ${m.type}-t" id="amt" aria-live="polite"><span class="num">${m.amt ? Number(m.amt).toLocaleString('en-US') : '0'}</span> <small>ج.م</small></div>
      <div class="kp">${['1','2','3','4','5','6','7','8','9','00','0','⌫'].map(k => `<button type="button" data-a="kp" data-v="${k}" ${k === '⌫' ? 'aria-label="امسح رقم"' : ''}>${k}</button>`).join('')}</div>
      <details ${m.note?'open':''}><summary class="muted small">+ ملاحظة</summary><input id="f-note" name="note" autocomplete="off" placeholder="مثلًا: شاحن سامسونج" style="margin-top:8px" value="${esc(m.note)}"></details>
      <p id="ferr" class="err" role="alert"></p>
      <button class="btn ${m.type} wide">سجّل</button></form>`, m.type);
  }
  if (m.kind === 'send'){
    const x = S.txs.find(t => t.id === m.id);
    if (!x){ ui.modal = null; return ''; }
    const T = TYPES[x.type], left = pendingList().length;
    return sheet(`<h3>نقل لكناش${left ? ` · فاضل <span class="num">${left}</span>` : ''}</h3>`, `
      <div class="kstep">
        ${avatar(pname(x))}
        <div class="name">${esc(pname(x))}</div>
        <div class="press">اضغط <b class="${x.type}">${T.label}</b> واكتب</div>
        <div class="bignum num ${x.type}-t">${nf(x.amount)}</div>
        ${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}
        <div class="muted small">${dayLabel(x.date)} ${tm(x.ts)} · ${esc(shop(x.shopId)?.name)} · ${esc(user(x.userId)?.name)}</div>
      </div>
      <a class="btn primary wide" href="${KONNASH_OPEN}" data-a="sendOpen">افتح كناش</a>
      <button class="btn took wide" data-a="sendDone">✓ اتسجلت${left > 1 ? '، اللي بعدها' : ''}</button>`);
  }
  if(m.kind==='restoreTx'){
    const t=S.txs.find(x=>x.id===m.id);if(!t||me.role!=='admin')return '';
    return sheet('<h2>إعادة تفعيل الحركة</h2>',`<p>${esc(pname(t))} · ${money(t.amount)}</p><p class="muted small">هترجع تدخل في الرصيد المحسوب، والإلغاء السابق هيفضل محفوظ في سجل التعديلات.</p><form id="restoretxf"><label class="field">سبب إعادة التفعيل<textarea name="reason" required minlength="3" maxlength="500"></textarea></label><p id="ferr" class="err" role="alert"></p><button class="btn primary wide">أكد إعادة التفعيل</button></form>`);
  }
  if (m.kind === 'del'){
    const x = S.txs.find(t => t.id === m.id), admin = me.role === 'admin';
    if (!x){ ui.modal = null; return ''; }
    return sheet(`<h2>إلغاء الحركة مع السبب</h2>`, `<form id="delf">
      <ul class="list" style="box-shadow:none;border:1px solid var(--line)">${item(x, {})}</ul>
      <p class="muted small">الحركة هتفضل محفوظة كملغاة، وتأثيرها هيتشال من الرصيد المحسوب. ده تصحيح تسجيل، مش رد فلوس فعلي.${x.transferred?' هشام محتاج يشيلها من كناش يدويًا.':''}</p>
      <div class="field"><label for="d-reason">السبب</label><input id="d-reason" name="reason" required minlength="3" maxlength="500" placeholder="مثلًا: اتسجلت مرتين" autocomplete="off"></div>
      <p id="ferr" class="err" role="alert"></p><button class="btn danger wide">أكد إلغاء الحركة</button></form>`);
  }
  if (m.kind === 'sell'){
    const sid = m.shopId;
    if (!m.deviceId) return sheet(`<h2 class="sht"><span class="ic-s">${icon.dev}</span>بيع جهاز</h2>`, `
      <input id="dq" type="search" placeholder="دوّر على الجهاز" autocomplete="off" value="${esc(m.q || '')}">
      <ul class="list devpick" id="dlist">${devOptions(sid, m.q || '')}</ul>`, 'sell');
    const d = device(m.deviceId); if (!d){ ui.modal = null; return ''; }
    return sheet(`<h2 class="sht"><span class="ic-s">${icon.dev}</span>${esc(d.name)}</h2>`, `
      ${m.fixed ? '' : `<button type="button" class="back" data-a="sellBack">→ جهاز تاني</button>`}
      <p class="muted small" style="text-align:center">متاح <span class="num">${d.qty}</span>${HCashCommerce.canCost()?` · سعر الشراء <span class="num">${nf(d.buy)}</span>`:''}</p>
      <p class="pinlbl">سعر البيع${m.qty > 1 ? ' للواحد' : ''}</p>
      <div class="amtbox" id="amt"><span class="num">${m.amt ? Number(m.amt).toLocaleString('en-US') : '0'}</span> <small>ج.م</small></div>
      <div class="kp">${['1','2','3','4','5','6','7','8','9','000','0','⌫'].map(k => `<button type="button" data-a="kp" data-v="${k}" ${k === '⌫' ? 'aria-label="امسح رقم"' : ''}>${k}</button>`).join('')}</div>
      <div class="qty"><span>الكمية</span><button type="button" data-a="qty" data-v="-1" aria-label="أقل" ${m.qty <= 1 ? 'disabled' : ''}>−</button><b class="num">${m.qty}</b><button type="button" data-a="qty" data-v="1" aria-label="أكتر" ${m.qty >= d.qty ? 'disabled' : ''}>+</button></div>
      <div class="saletot" id="stot">${sellTot(m, d)}</div>
      <p class="pinlbl">الفلوس راحت فين؟</p>
      <div class="paygrid" role="radiogroup" style="--n:${onKeys(sid).length}">${onKeys(sid).map(k => [k, dn(k, sid)]).map(([k, l]) => `<button type="button" role="radio" aria-checked="${m.pay === k}" class="${m.pay === k ? 'on' : ''} p-${k}" data-a="pay" data-v="${k}">${l}${k === 'hcash' ? '<small>قسط</small>' : ''}</button>`).join('')}</div>
      ${m.pay === 'hcash' ? `<div class="field"><label for="sv">رقم البون</label><input id="sv" inputmode="numeric" autocomplete="off" value="${esc(m.voucher || '')}" placeholder="اكتب رقم البون"></div>` : ''}
      <div id="sale-policy">${HCashCommerce.pricePolicy(m,d)}</div><p id="ferr" class="err" role="alert"></p>
      <button class="btn primary wide" data-a="saveSale">سجّل البيع</button>`, 'sell');
  }
  if (m.kind === 'dev'){
    const d = m.id ? device(m.id) : null;
    return sheet(`<h2>${d ? esc(d.name) : 'جهاز جديد'}</h2>`, `<form id="devf" novalidate>
      <div class="field"><label for="dv-shop">المحل</label><select id="dv-shop" name="shop">${S.shops.map(s => `<option value="${s.id}" ${(d ? d.shopId : (ui.dshop !== 'all' ? ui.dshop : '')) === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="dv-name">اسم الجهاز</label><input id="dv-name" name="name" value="${esc(d?.name || '')}" placeholder="مثلًا: سامسونج A15 128 جيجا" autocomplete="off"></div>
      <div class="row2"><div class="field"><label for="dv-buy">سعر الشراء</label><input id="dv-buy" name="buy" inputmode="decimal" value="${d ? d.buy : ''}" autocomplete="off"></div>
        <div class="field"><label for="dv-sell">سعر البيع</label><input id="dv-sell" name="sell" inputmode="decimal" value="${d ? d.sell : ''}" autocomplete="off"></div></div>
      <div class="field"><label for="dv-min">أقل سعر بيع للكاشير · اختياري</label><input id="dv-min" name="min" inputmode="decimal" value="${d?.minPrice??''}" placeholder="أقل منه يحتاج موافقة هشام"><small>سيبه فاضي لو مفيش حد أدنى.</small></div><div class="field"><label for="dv-qty">${d ? 'الكمية في المخزن دلوقتي' : 'الكمية'}</label><input id="dv-qty" name="qty" inputmode="numeric" value="${d ? d.qty : '1'}" autocomplete="off"></div>
      <p id="ferr" class="err" role="alert"></p>
      <button class="btn primary wide">${d ? 'احفظ' : 'ضيف للمخزن'}</button>
      ${d ? `<div class="row2" style="margin-top:4px">${d.qty ? `<button type="button" class="btn" data-a="devSell" data-v="${d.id}">بيع من هنا</button>` : '<span></span>'}<button type="button" class="btn danger" data-a="devDel" data-v="${d.id}">شيله من المخزن</button></div>` : ''}</form>`);
  }
  if (m.kind === 'delSale'){
    const x = S.sales.find(s => s.id === m.id); if (!x){ ui.modal = null; return ''; }
    return sheet(`<h2>تمسح البيعة دي؟</h2>`, `
      <ul class="list" style="box-shadow:none;border:1px solid var(--line)">${saleItem(x, {})}</ul>
      <p class="muted small">الجهاز هيرجع المخزن${x.qty > 1 ? ` (${x.qty})` : ''} والفلوس هتتشال من ${dn(x.pay, x.shopId)}.${me.role !== 'admin' ? ' هشام هيوصله إشعار.' : ''}</p>
      <button class="btn danger wide" data-a="delSaleOk">إلغاء الحركة</button>`);
  }
  if (m.kind === 'opening'){
    const sh = shop(m.shopId), od = openDay(m.shopId), last = lastClosedCash(m.shopId, m.drawer);
    return sheet(`<h2>رصيد بداية ${esc(sh.name)}</h2>`, `
      ${isOn(m.shopId, 'acc') ? '' : '<!--'}<div class="seg" role="tablist">${[['cashier', payName('cashier', m.shopId)], ['acc', payName('acc', m.shopId)]].map(([k, l]) => [k, esc(l)]).map(([k, l]) => `<button type="button" role="tab" aria-selected="${m.drawer === k}" class="${m.drawer === k ? 'on' : ''}" data-a="drawer" data-v="${k}">${l}</button>`).join('')}</div>${isOn(m.shopId, 'acc') ? '' : '-->'}
      <p class="muted small" style="text-align:center">${od ? 'اكتب الفلوس اللي كانت في الدرج قبل أول حركة في اليوم.' : 'هيبدأ يوم جديد بالرصيد ده.'} حركات الدرج والمبيعات والمرتجعات بتتحسب تلقائيًا.</p>
      ${last != null ? `<button class="btn sm" data-a="useLast" style="align-self:center">آخر يوم قفل على ${nf(last)}، استخدمه</button>` : ''}
      <div class="amtbox" id="amt"><span class="num">${m.amt ? Number(m.amt).toLocaleString('en-US') : '0'}</span> <small>ج.م</small></div>
      <div class="kp">${['1','2','3','4','5','6','7','8','9','000','0','⌫'].map(k => `<button type="button" data-a="kp" data-v="${k}">${k}</button>`).join('')}</div>
      <p id="ferr" class="err" role="alert"></p>
      <button class="btn primary wide" data-a="saveOpening">احفظ رصيد ${dn(m.drawer, m.shopId)}</button>`);
  }
  if (m.kind === 'closeDay'){
    const sh = shop(m.shopId), od = openDay(m.shopId); if (!sh || !od){ ui.modal = null; return ''; }
    const list = dayTxs(od), r = totals(list), waiting = list.filter(t => live(t) && !t.transferred).length, st = saleTot(daySales(od));
    return sheet(`<h2>قفل يوم ${esc(sh.name)}</h2>`, `
      <div class="lockhero"><span class="lockic">${icon.lock}</span>
        <p>الحركات هتختفي من عند الكاشير ويبدأ يوم جديد. هتفضل عندك في السجل وفي قسم كناش.</p></div>
      ${od.opening != null ? `<div class="kpis3"><div><small>بداية ${dn('cashier', m.shopId)}</small><b class="num">${nf(od.opening)}</b></div><div><small>${dn('cashier', m.shopId)} دلوقتي</small><b class="num">${nf(cashOf(od))}</b></div>${isOn(m.shopId, 'acc') ? `<div><small>${dn('acc', m.shopId)}</small><b class="num">${accOf(od) == null ? '—' : nf(accOf(od))}</b></div>` : ''}</div>` : ''}
      ${st.count||st.returned ? `<div class="kpis3"><div><small>أجهزة اتباعت</small><b class="num">${st.count}</b></div><div><small>مكسب</small><b class="num took-t">${nf(st.profit)}</b></div>${isOn(m.shopId, 'hcash') ? `<div><small>${dn('hcash', m.shopId)}</small><b class="num">${nf(st.hcash)}</b></div>` : ''}</div>` : ''}
      <div class="kpis3"><div><small>حركة</small><b class="num">${r.count}</b></div>
        <div><small>أخدت</small><b class="num took-t">${nf(r.took)}</b></div><div><small>أعطيت</small><b class="num gave-t">${nf(r.gave)}</b></div></div>
      <p class="muted small" style="text-align:center">من ${dayLabel(dayOf(od.openedAt))} ${tm(od.openedAt)} لحد دلوقتي${waiting ? ` · ${waiting} لسه ما اتنقلوش لكناش` : ''}</p>
      <p class="pinlbl">اكتب رقمك السري</p>
      <div class="dots dark ${m.err ? 'bad' : ''}">${Array.from({length:6}, (_, i) => `<span class="${i < m.pin.length ? 'f' : ''}"></span>`).join('')}</div>
      <p class="err" role="alert" style="text-align:center">${m.busy ? '<span class="muted">بيقفل...</span>' : esc(m.err || '')}</p>
      <div class="kp">${['1','2','3','4','5','6','7','8','9','','0','⌫'].map(k => k ? `<button type="button" data-a="cpin" data-v="${k}" ${m.busy ? 'disabled' : ''}>${k}</button>` : '<span></span>').join('')}</div>`);
  }
  if (m.kind === 'wipe'){
    const n = S.txs.length;
    return sheet(`<h2>تمسح كل الحركات؟</h2>`, `<form id="wipef">
      <div class="banner">كل حركات المحلين ومبيعات الأجهزة والإشعارات هتتمسح من السجل الحالي. هتتعمل نسخة احتياطية قبل التنفيذ، والاسترجاع يحتاج مراجعتها.</div>
      <div class="field"><label for="w-ok">علشان تأكد، اكتب كلمة <b>امسح</b></label><input id="w-ok" name="ok" autocomplete="off" data-autofocus></div>
      <div class="field"><label for="wipe-pin">رقم هشام السري · ٦ أرقام</label><input id="wipe-pin" name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" required></div><p class="muted small">هتتعمل نسخة احتياطية وتتراجع قبل المسح. الحضور والمرتبات مش هتتمسح.</p><p id="ferr" class="err" role="alert"></p>
      <button class="btn danger wide">أكد النسخة وامسح الحركات</button></form>`);
  }
  if (m.kind === 'pin'){
    const u = user(m.id), len = PIN_LEN[u.role];
    return sheet(`<h2>رقم سري جديد لـ${esc(u.name)}</h2>`, `<form id="pinf">
      <div class="field"><label for="pn-pin">${len} أرقام</label><input id="pn-pin" name="pin" type="password" inputmode="numeric" maxlength="${len}" autocomplete="new-password" data-autofocus></div>
      <p id="ferr" class="err" role="alert"></p><button class="btn primary wide" ${ui.busy ? 'disabled' : ''}>احفظ</button></form>`);
  }
  return '';
}

/* ---------- motion ---------- */
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(el, from, to){
  if (calm()) return;
  const t0 = performance.now(), dur = 650;
  const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = nf(Math.round(from + (to - from) * e)); if (p < 1) requestAnimationFrame(step); else el.textContent = nf(to); };
  requestAnimationFrame(step);
}
function confetti(){
  if (calm()) return;
  const box = document.createElement('div'); box.className = 'confetti';
  const colors = ['#0b8a4a', '#d33a2f', '#f5c542', '#2f6fd6', '#8a4fd1'];
  for (let i = 0; i < 40; i++){
    const p = document.createElement('i');
    p.style.cssText = `--x:${(Math.random() * 2 - 1) * 46}vw;--y:${-30 - Math.random() * 50}vh;--r:${Math.random() * 720 - 360}deg;background:${colors[i % colors.length]};animation-delay:${Math.random() * 120}ms`;
    box.appendChild(p);
  }
  document.body.appendChild(box); setTimeout(() => box.remove(), 1800);
}
// Touch/keyboard feedback is delegated to feedback.js and survives screen redraws.

/* ---------- render ---------- */
let toastTimer;
function toast(t, undoId){
  ui.toast = {t, undoId}; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = null; document.querySelector('[data-app-toast]')?.remove(); }, undoId ? 5000 : 2600);
}
let lastView = '', lastSendId = null;
const seen = new Set(), counts = {};
const shownReleases = new Set(), previousTabs = [];
function offerReleaseNotes(){
  if(!me||ui.booting||ui.initialLoading||ui.recovery||ui.modal)return;
  const key=`hcash-seen-release:${DEMO?'demo:':''}${me.id}`;
  const lastSeen=Number(lsGet(key))||0;
  if(lastSeen>=APP_VERSION||shownReleases.has(key))return;
  ui.modal={kind:'releaseNotes',lastSeen};
  shownReleases.add(key);
  lsSet(key,String(APP_VERSION));
}
function syncBrowserBack(){
  if(isNative()||history.state?.hcashBack||navigator.userActivation?.hasBeenActive===false)return;
  const inside=me?.role==='staff'?Attendance.hasStaffBack():me&&(ui.hr||ui.tab!=='kenash');
  if(ui.modal||ui.pinUser||ui.recovery||inside){
    history.pushState({hcashBack:true},'');
  }
}
function goBackInApp(){
  if(ui.busy||ui.saving||ui.pinBusy){syncBrowserBack();return;}
  if(ui.modal)A.closeModal();
  else if(ui.recovery){if(A.recoveryBack()===false)return;}
  else if(!me&&ui.pinUser)A.loginBack();
  else if(me?.role==='staff')Attendance.backToToday();
  else if(me&&ui.hr)A.hrBack();
  else if(me?.role==='admin'&&ui.tab!=='kenash'){
    ui.tab=previousTabs.pop()||'kenash';
    ui.scrollTop=0;
  }
  render();
}
const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
function render(){
  ui.dirty = false;
  offerReleaseNotes();
  const app = document.getElementById('app');
  const view = me&&ui.initialLoading?'initial:'+me.role:me && (ui.hr || me.role === 'staff') ? 'attendance:' + me.role : ui.recovery ? 'recovery:' + ui.recovery : ui.booting ? 'boot' : !me ? (ui.pinUser ? 'pin' : 'login') : me.role + ':' + (me.role === 'admin' ? ui.tab : 'home');
  const oldOv = app.querySelector('.overlay:not(.out)'), hadModal = !!oldOv;
  // the owner screen scrolls inside #scroller: keep its place across redraws (a tab change sets ui.scrollTop = 0)
  const oldSc = document.getElementById('scroller'), keepTop = ui.scrollTop ?? (oldSc ? oldSc.scrollTop : 0); ui.scrollTop = null;
  const prevTab = lastView.startsWith('admin:') && view.startsWith('admin:') ? TAB_ORDER.indexOf(lastView.slice(6)) : -1;
  let h = ui.recovery ? renderRecovery() : ui.booting ? renderBoot() : !me ? renderLogin() : ui.initialLoading ? renderLoadingData() : (ui.hr || me.role === 'staff') ? (me.role === 'admin' ? Attendance.renderAdmin() : Attendance.renderStaff()) : (me.role === 'admin' ? renderAdmin() : renderCashier());
  h += (me || ui.modal?.kind === 'theme') ? renderModal() : '';
  if (ui.toast) h += `<div class="toast" data-app-toast role="status">${esc(ui.toast.t)}${ui.toast.undoId ? ` <button class="tbtn" data-a="undo" data-v="${ui.toast.undoId}">تراجع</button>` : ''}</div>`;
  const settingsOpen=view===lastView?[...app.querySelectorAll('.settings-section[open],.ledger-fold[open]')].map(d=>d.dataset.keep||d.querySelector('summary')?.textContent):[];
  const hrSame=view===lastView&&view.startsWith('attendance:');
  const hrTop=hrSame?window.scrollY:0;
  const hrOpen=hrSame?[...app.querySelectorAll('.att-root details[open]')].map(d=>d.querySelector('summary')?.textContent):[];
  if(me)h+=HCashReceipts.render();
  if(me)h+=`<div class="save-indicator ${ui.saveState||''}" role="status">${ui.offline?'غير متصل · اتأكد من النت قبل التسجيل':ui.saveState==='saving'?'جاري الحفظ…':ui.saveState==='uncertain'?'لم يتم تأكيد الحفظ · حدّث وراجع السجل قبل تكرار الحركة':''}</div>`;
  app.innerHTML = h;
  if(!ui.booting)window.HCashOpening?.ready();
  Attendance.decorateDates();
  Attendance.restoreForms();
  app.querySelectorAll('.settings-section,.ledger-fold').forEach(d=>{if(settingsOpen.includes(d.dataset.keep||d.querySelector('summary')?.textContent))d.open=true;});
  if(hrSame){app.querySelectorAll('.att-root details').forEach(d=>{if(hrOpen.includes(d.querySelector('summary')?.textContent))d.open=true;});window.scrollTo(0,hrTop);}
  const sc = document.getElementById('scroller'); if (sc && keepTop) sc.scrollTop = keepTop;
  // whole screen slides in when you move to a different screen
  const entering = view !== lastView; lastView = view;
  if (entering) app.querySelectorAll('.band, .wrap, .login .in').forEach(el => el.classList.add('enter'));
  // switching tabs slides the page in from the side of the tab you came from
  if (entering && prevTab >= 0){ const now = TAB_ORDER.indexOf(ui.tab); app.querySelector('.wrap')?.classList.add(now > prevTab ? 'tab-next' : 'tab-prev'); }
  ui.navFrom = null;
  // a closing sheet slides down instead of vanishing
  if (oldOv && !ui.modal && !calm()){
    oldOv.classList.add('out'); oldOv.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
    oldOv.querySelectorAll('[data-a]').forEach(e => e.removeAttribute('data-a'));
    app.appendChild(oldOv); setTimeout(() => {oldOv.remove();HCashModalScroll.sync(!!document.querySelector('.overlay'));}, 240);
  }
  // list rows: stagger on a new screen, otherwise only rows that just arrived
  let i = 0;
  app.querySelectorAll('.item[data-id]').forEach(el => {
    const id = el.dataset.id;
    if (entering || !seen.has(id)){ el.classList.add(entering ? 'rise' : 'pop'); el.style.animationDelay = (entering ? Math.min(i++, 10) * 40 : 0) + 'ms'; }
    seen.add(id);
  });
  // totals count up to their new value
  app.querySelectorAll('[data-count]').forEach(el => {
    const k = el.dataset.count, to = Number(el.dataset.val), from = counts[k] ?? (entering ? 0 : to);
    counts[k] = to;
    if (from !== to){ countUp(el, from, to); if (!entering && !calm()) el.classList.add(to > from ? 'flash-up' : 'flash-down'); }
  });
  const ov = app.querySelector('.overlay');
  if (ov && hadModal) ov.classList.add('still');
  if (ui.modal?.kind === 'send'){ const k = app.querySelector('.kstep'); if (k && lastSendId && lastSendId !== ui.modal.id) k.classList.add('swap'); lastSendId = ui.modal.id; }
  else lastSendId = null;
  HCashModalScroll.sync(!!app.querySelector('.overlay'));
  syncMessageAlert();
  syncBrowserBack();
  document.querySelector('[data-autofocus]')?.focus({preventScroll:true});
  if (me?.role === 'admin' && !ui.hr && ui.tab === 'notes' && S.notes.some(n => !n.recipient&&!n.read)){
    const ids = S.notes.filter(n => !n.recipient&&!n.read).map(n => n.id);
    S.notes.filter(n=>!n.recipient).forEach(n => n.read = true);
    if (!DEMO) sb.from('notes').update({read:true}).in('id', ids).then(() => {});
  }
}
function formErr(msg, id = 'ferr'){ const e = document.getElementById(id); if (e) e.textContent = msg; }
// For account changes that must be confirmed by the server before showing them.
async function act(fn, opts = {}){
  if(ui.busy||ui.saving)return;
  ui.saveState='saving';const status=document.querySelector('.save-indicator');if(status)status.textContent='جاري الحفظ…';
  if (ui.busy) return;
  ui.busy = true;
  const btns = [...document.querySelectorAll('form button')]; btns.forEach(b => b.disabled = true);
  try {
    await fn(); ui.busy = false;ui.saveState='';
    if (me) await refresh().catch(() => {});
    if (opts.done) opts.done();
    else toast('اتحفظ على السيرفر');
    render();
  } catch(e){
    ui.busy = false;ui.saveState='uncertain'; btns.forEach(b => b.disabled = false);
    if(status)status.textContent='لم يتم تأكيد الحفظ';
    if (document.getElementById(opts.errId || 'ferr')) formErr(errText(e), opts.errId); else { toast(errText(e)); render(); }
  }
}

/* ---------- actions ---------- */
async function doLogin(userId, pin){
  ui.pinBusy = true; render();
  try {
    const tokens = await fnCall({action:'login', user_id:userId, pin});
    const s = must(await sb.auth.setSession({access_token:tokens.access_token,refresh_token:tokens.refresh_token}));
    await loadMe(s.user.id,tokens.profile);
    ui.pinUser = null; ui.pin = ''; ui.pinErr = ''; ui.tab = 'kenash';
  } catch(e){ ui.pin = ''; ui.pinErr = errText(e); }
  ui.pinBusy = false; render();
  if (ui.pinErr){ const d = document.querySelector('.dots'); if (d) replay(d, 'shake'); try { navigator.vibrate?.([40, 40, 40]); } catch(_){} }
}
const nowIso = () => new Date().toISOString();
const A = {
  retryData(){if(!ui.initialPending)void hydrateInitialData();return false;},
  clearHistory(){ui.f={shop:'all'};ui.historyLimit=false;lsSet('history-filters:'+me.id,JSON.stringify(ui.f));},
  auditOpen(){ui.hr=true;Attendance.openAudit();return false;},
  attendanceAlert(v){ui.hr=true;Attendance.openAlert(null,v);return false;},
  applyUpdate(){ location.reload(); return false; },
  hrOpen(){ ui.hr = true; ui.modal = null; Attendance.load({silent:true}).then(render).catch(() => {}); },
  composeMessage(){if(me.role!=='admin')return false;ui.modal={kind:'composeMessage'};},
  sentMessages(){if(me.role!=='admin')return false;ui.modal={kind:'sentMessages'};},
  dismissMessageAlert(){
    if(!me)return false;
    const dismissed=messagePreference('dismissed');
    visibleMessages().filter(n=>!n.read).forEach(n=>dismissed.add(n.id));
    saveMessagePreference('dismissed',dismissed);
    syncMessageAlert();
    return false;
  },
  hideMessage(id){
    if(!personalMessages().some(n=>n.id===id))return false;
    const hidden=messagePreference('hidden');
    hidden.add(id);
    saveMessagePreference('hidden',hidden);
  },
  restoreMessage(id){
    if(!personalMessages().some(n=>n.id===id))return false;
    const hidden=messagePreference('hidden');
    hidden.delete(id);
    saveMessagePreference('hidden',hidden);
  },
  inbox(){
    if(me.role==='admin')return false;
    const actor=me.id;
    ui.modal={kind:'personalInbox'};
    if(DEMO){visibleMessages().forEach(n=>n.read=true);return;}
    void fetchPersonalMessages(actor).then(async rows=>{
      if(me?.id!==actor||ui.modal?.kind!=='personalInbox')return;
      render();
      const hidden=messagePreference('hidden');
      const ids=rows.filter(n=>!n.read&&!hidden.has(n.id)).map(n=>n.id);
      if(!ids.length)return;
      const read=await sb.rpc('hcash_read_messages',{p_ids:ids});
      if(me?.id===actor&&!read.error){
        personalMessages().filter(n=>ids.includes(n.id)).forEach(n=>n.read=true);
        syncMessageAlert();
        if(ui.modal?.kind==='personalInbox')render();else softRender();
      }
    }).catch(()=>{});
  },
  hrBack(){ ui.hr = false; ui.modal = null; },
  forgotPin(){ ui.pinUser = null; ui.pin = ''; ui.recovery = 'request'; ui.recoveryError = ''; },
  recoveryBack(){
    ui.recovery = null; ui.recoveryError = ''; ui.pinUser = null;
    if (RECOVERY_ENTRY){ location.replace(location.origin + location.pathname); return false; }
  },
  noop(){ return false; },
  closeModal(){ ui.modal = null; },
  install(){ const e = ui.installEvt; ui.installEvt = null; if (e) e.prompt(); },
  pickUser(v){ ui.pinUser = v; ui.pin = ''; ui.pinErr = ''; },
  loginBack(){ ui.pinUser = null; ui.pinErr = ''; },
  pinBack(){ ui.pin = ui.pin.slice(0, -1); ui.pinErr = ''; },
  pin(v){
    if (ui.pinBusy) return false;
    const u = ui.loginUsers.find(x => x.id === ui.pinUser), len = PIN_LEN[u.role];
    ui.pinErr = ''; ui.pin += v;
    if (ui.pin.length >= len){ doLogin(u.id, ui.pin); return false; }
    render(); const d = document.querySelectorAll('.dots span.f'); if (d.length) replay(d[d.length - 1], 'pop'); return false;
  },
  logout(){
    if (DEMO){ location.href = location.pathname; return false; }
    if (chan){ sb.removeChannel(chan); chan = null; }
    const removePush = pushToken && me ? sb.from('push_tokens').delete().eq('user_id',me.id).eq('token',pushToken) : Promise.resolve();
    initialLoadGeneration++;extraDays.clear();ui.initialLoading=false;ui.initialPending=false;ui.initialError='';HCashCommerce.reset();HCashBackups.reset();HCashSearch.reset();Attendance.reset(); pushReady = false; ui.hr = false;
    me = null; ui.modal = null; ui.tab='kenash';previousTabs.length=0;
    S = {shops:[], users:[], parties:[], txs:[], notes:[], days:[], devices:[], sales:[]};
    Promise.resolve(removePush).catch(() => {}).finally(() => sb.auth.signOut().finally(() => loadLogin().then(render)));
  },
  shop(v){ ui.shopId = v; lsSet('yawmeya-shop', v); },
  type(v){
    if(!me||!['admin','cashier'].includes(me.role)||!Object.hasOwn(TYPES,v))return false;
    const shopId=me.role==='admin'?(shop(ui.kshop)?.id||S.shops[0]?.id):me.shop_id;
    ui.modal={kind:'tx',type:v,amt:'',shopId,drawer:DRW[shopId]?.acc?.active===true?null:'cashier',query:'',party:null,note:''};
  },
  kp(v){
    const m = ui.modal; let a = m.amt || '';
    // a pre-filled number (the device's price, the current balance) is replaced by the first digit typed
    if (m.fresh && v !== '⌫') a = '';
    m.fresh = false;
    if (v === '⌫') a = a.slice(0, -1); else if ((a + v).length <= 9) a = (a + v).replace(/^0+/, '');
    m.amt = a;
    const el = document.querySelector('#amt .num'); if (el){ el.textContent = a ? Number(a).toLocaleString('en-US') : '0'; replay(el.parentNode, 'bump'); }
    const stot = document.getElementById('stot'), d = m.kind === 'sell' && device(m.deviceId); if (stot && d) stot.innerHTML = sellTot(m, d);const policy=document.getElementById('sale-policy');if(policy&&d)policy.innerHTML=HCashCommerce.pricePolicy(m,d);
    try { navigator.vibrate?.(8); } catch(e){}
    return false;
  },
  undo(v){ const t=S.txs.find(x=>x.id===v);if(!t||t.deleted||t.pending)return false;ui.toast=null;ui.modal={kind:'del',id:v}; },
  del(v){ const t=S.txs.find(x=>x.id===v);if(!t||t.deleted||t.pending)return false;ui.modal={kind:'del',id:v}; },
  restore(v){if(me.role!=='admin')return false;ui.modal={kind:'restoreTx',id:v};},
  themeSheet(){ ui.modal = {kind:'theme'}; },
  setTheme(v, e){
    ui.modal = null;
    const go = () => { applyTheme(v); render(); };
    if (v === themePref() || !document.startViewTransition || calm()){ go(); return false; }
    // the new look spreads out in a circle from where you tapped
    const x = e?.clientX || innerWidth / 2, y = e?.clientY || 60, rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    try {
      document.startViewTransition(go).ready.then(() => document.documentElement.animate(
        {clipPath:[`circle(0px at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`]},
        {duration:620, easing:'cubic-bezier(.4,0,.2,1)', pseudoElement:'::view-transition-new(root)'})).catch(() => {});
    } catch(_){ go(); }
    return false;
  },
  tab(v){
    if(v!==ui.tab){
      ui.navFrom=TAB_ORDER.indexOf(ui.tab);
      if(v==='kenash')previousTabs.length=0;
      else {previousTabs.push(ui.tab);if(previousTabs.length>20)previousTabs.shift();}
    }
    ui.tab = v; ui.scrollTop = 0;
    if(v==='txs'&&ui.f.from&&!DEMO)void loadHistoryRange(ui.f).then(softRender).catch(()=>{toast('تعذر تحميل الفترة المطلوبة. جرّب البحث تاني.');render();});
    if (v === 'notes'){ const ids = S.notes.filter(n => !n.recipient&&!n.read).map(n => n.id); S.notes.filter(n=>!n.recipient).forEach(n => n.read = true); if (ids.length && !DEMO) sb.from('notes').update({read:true}).in('id', ids).then(() => {}); }
  },
  kshop(v){ ui.kshop = v; },
  fshop(v){ ui.f.shop = v;lsSet('history-filters:'+me.id,JSON.stringify(ui.f)); },
  toggleDay(v){ const d = S.days.find(x => x.id === v), wasOpen = ui.openDays.has(v) || (d && !d.closedAt && !ui.openDays.has('x' + v));
    ui.openDays.delete(v); ui.openDays.delete('x' + v); if (!wasOpen) ui.openDays.add(v); else if (d && !d.closedAt) ui.openDays.add('x' + v); },
  send(v){ ui.modal = {kind:'send', id:v}; },
  sendOpen(v, e){
    const L = window.Capacitor?.Plugins?.AppLauncher;
    if (isNative() && L){
      e.preventDefault();
      L.openUrl({url:CFG.konnashPackage}).then(r => { if (!r?.completed){ toast('كناش مش متسطب على الموبايل ده'); render(); } }).catch(() => { toast('ما قدرتش أفتح كناش'); render(); });
    }
    return false;
  },
  sendDone(){
    const t = S.txs.find(x => x.id === ui.modal.id);
    op(() => {
      t.transferred = true; t.transferredAt = Date.now();
      const next = pendingList()[0];
      ui.modal = next ? {kind:'send', id:next.id} : null;
      if (!next){ toast('كل الحركات اتنقلت لكناش 🎉'); setTimeout(confetti, 60); }
    }, async () => must(await sb.from('txs').update({transferred_at:nowIso()}).eq('id', t.id)), 'ما اتعلّمتش.');
    return false;
  },
  untransfer(v){ const t = S.txs.find(x => x.id === v); op(() => { t.transferred = false; t.transferredAt = null; }, async () => must(await sb.from('txs').update({transferred_at:null}).eq('id', v))); return false; },
  ack(v){ const t = S.txs.find(x => x.id === v); op(() => { t.deleteAck = true; }, async () => must(await sb.from('txs').update({delete_ack:true}).eq('id', v))); return false; },
  toggleUser(v){
    const u = user(v);
    act(async () => { await fnCall({action:'set_active', user_id:v, active:!u.active}); if (DEMO) u.active = !u.active; }, {done:() => toast(u.active ? `حساب ${u.name} اتشغّل` : `حساب ${u.name} اتوقف`)});
    return false;
  },
  chPin(v){ ui.modal = {kind:'pin', id:v}; },
  wipe(){if(HCashReceipts.read()){toast('أكد محاولة الحفظ المعلّقة قبل المسح.');return false;}ui.modal = {kind:'wipe'}; },
  opening(v){ ui.modal = {kind:'opening', shopId:v}; A.drawer('cashier'); },
  openingAcc(v){ if(me?.role!=='admin'||!isOn(v,'acc'))return false;ui.modal={kind:'opening',shopId:v};A.drawer('acc'); },
  drawer(v){ const m = ui.modal, d = openDay(m.shopId), cur = d && (v === 'acc' ? d.accOpening : d.opening); m.drawer = v; m.amt = cur != null ? String(cur) : ''; m.fresh = true; },
  useLast(){ const last = lastClosedCash(ui.modal.shopId, ui.modal.drawer); ui.modal.amt = String(Math.max(0, Math.round(last))); },
  saveOpening(){
    const m = ui.modal, amount = parseFloat(m.amt || '');
    if (!(amount >= 0) || m.amt === '') { formErr('اكتب الرقم اللي في الدرج.'); return false; }
    const sid = m.shopId, od = openDay(sid), key = m.drawer === 'acc' ? 'accOpening' : 'opening';
    op(() => {
      if (od) od[key] = amount;
      else S.days.push({id:'local-' + uuid(), shopId:sid, openedAt:Date.now(), openedBy:me.id, closedAt:null, opening:null, accOpening:null, [key]:amount});
      ui.modal = null; toast(`رصيد ${payName(m.drawer, sid)}: ${nf(amount)} ✓`);
    }, async () => { must(await sb.rpc('set_opening_balance', {p_shop:sid, p_amount:amount, p_drawer:m.drawer})); await refresh(); }, 'ما اتحفظش.');
    return false;
  },
  /* device sales */
  sell(){ ui.modal = {kind:'sell', shopId:me.role === 'admin' ? (ui.dshop !== 'all' ? ui.dshop : S.shops[0]?.id) : me.shop_id, deviceId:null, q:''}; },
  pickDev(v){ const d = device(v); Object.assign(ui.modal, {deviceId:v, amt:String(d.sell || ''), fresh:true, qty:1, pay:null, voucher:''}); },
  sellBack(){ ui.modal.deviceId = null; },
  qty(v){ const m = ui.modal, d = device(m.deviceId); m.qty = Math.max(1, Math.min(d.qty, m.qty + Number(v))); },
  pay(v){ ui.modal.pay = v; },
  saveSale(){
    const m = ui.modal, d = device(m.deviceId), price = parseFloat(m.amt || '');
    if (!(price > 0)) { formErr('اكتب سعر البيع.'); return false; }
    if (m.qty > d.qty) { formErr(`المتاح ${d.qty} بس.`); return false; }
    if (!m.pay) { formErr('اختار الفلوس راحت فين.'); return false; }
    const voucher = String(m.voucher || '').trim();
    if (m.pay === 'hcash' && !voucher) { formErr('اكتب رقم البون.'); document.getElementById('sv')?.focus(); return false; }
    if(!DEMO){void HCashReceipts.submit('sale',{p_id:uuid(),p_device:d.id,p_qty:m.qty,p_price:price,p_pay:m.pay,p_voucher:m.pay==='hcash'?voucher:null},`بيع ${d.name} × ${m.qty} · ${nf(price*m.qty)} · ${payName(m.pay,d.shopId)}`);return false;}
    const sid = d.shopId, od = openDay(sid), day = od || {id:'local-' + uuid(), shopId:sid, openedAt:Date.now(), openedBy:me.id, closedAt:null, opening:null, accOpening:null};
    const s = {id:uuid(), ts:Date.now(), shopId:sid, dayId:day.id, deviceId:d.id, name:d.name, qty:m.qty, buy:d.buy, price, pay:m.pay, voucher:m.pay === 'hcash' ? voucher : '', userId:me.id, deleted:false, pending:!DEMO};
    op(() => { if (!od) S.days.push(day); S.sales.push(s); d.qty -= s.qty; ui.modal = null; toast(`اتباع ${d.name} بـ ${nf(s.qty * price)} ✓`); try { navigator.vibrate?.(20); } catch(e){} },
      async () => {
        must(await sb.rpc('sell_device', {p_id:s.id, p_device:d.id, p_qty:s.qty, p_price:price, p_pay:s.pay, p_voucher:s.voucher || null}));
        if (!od) await refresh().catch(() => {});
        s.pending = false; softRender();
      }, 'البيعة ما اتسجلتش.');
    return false;
  },
  delSale(v){ ui.modal = {kind:'delSale', id:v}; },
  delSaleOk(){
    const s = S.sales.find(x => x.id === ui.modal.id), d = device(s.deviceId);
    op(() => { s.deleted = true; if (d) d.qty += s.qty; ui.modal = null; toast('البيعة اتمسحت والجهاز رجع المخزن'); },
       async () => must(await sb.rpc('delete_sale', {p_id:s.id})), 'ما اتمسحتش.');
    return false;
  },
  dshop(v){ ui.dshop = v; },
  devNew(){ ui.modal = {kind:'dev', id:null}; },
  devEdit(v){ ui.modal = {kind:'dev', id:v}; },
  devSell(v){ const d = device(v); ui.modal = {kind:'sell', shopId:d.shopId, deviceId:v, amt:String(d.sell || ''), fresh:true, qty:1, pay:null, voucher:'', fixed:true}; },
  devDel(v){
    const d = device(v);
    if (!confirm(`تشيل ${d.name} من المخزن؟ المبيعات القديمة بتاعته هتفضل.`)) return false;
    op(() => { S.devices = S.devices.filter(x => x.id !== v); ui.modal = null; toast('اتشال من المخزن'); },
       async () => must(await sb.from('devices').update({archived:true}).eq('id', v)), 'ما اتشالش.');
    return false;
  },
  closeDay(v){ ui.modal = {kind:'closeDay', shopId:v, pin:''}; },
  cpin(v){
    const m = ui.modal; if (m.busy) return false;
    m.err = ''; m.pin = v === '⌫' ? m.pin.slice(0, -1) : (m.pin + v).slice(0, 6);
    if (m.pin.length < 6) return;
    m.busy = true; render();
    (async () => {
      try {
        if (!DEMO) await fnCall({action:'close_day', shop_id:m.shopId, pin:m.pin});
        const od = openDay(m.shopId); if (od){ od.closedAt = Date.now(); od.closedBy = me.id; }
        ui.modal = null; toast(`يوم ${shop(m.shopId)?.name} اتقفل ✓`); setTimeout(confetti, 60);
        if (!DEMO) refresh().then(render).catch(() => {});
      } catch(e){
        m.busy = false; m.pin = ''; m.err = errText(e); render();
        const d = document.querySelector('.dots'); if (d) replay(d, 'shake');
        return;
      }
      render();
    })();
    return false;
  },
  askNotify(){ try { Notification.requestPermission().then(() => render()); } catch(e){} return false; }
};

const F = {
  async historyf(fd){
    const f={...ui.f,q:String(fd.get('q')||'').trim(),employee:String(fd.get('employee')||''),type:String(fd.get('type')||''),from:String(fd.get('from')||''),to:String(fd.get('to')||'')};
    if((f.from||f.to)&&(!/^\d{4}-\d{2}-\d{2}$/.test(f.from)||!/^\d{4}-\d{2}-\d{2}$/.test(f.to)||f.from>f.to||(Date.parse(f.to)-Date.parse(f.from))/86400000>90)){toast('اختار بداية ونهاية صحيحة، بحد أقصى ٩٠ يوم');render();return;}
    try{await loadHistoryRange(f);ui.f=f;lsSet('history-filters:'+me.id,JSON.stringify(f));S.days.forEach(d=>ui.openDays.add(d.id));render();}catch(e){toast(errText(e));render();}
  },
  async recoverrequestf(fd){
    if (ui.busy) return;
    const email = String(fd.get('email') || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return formErr('اكتب إيميل صحيح.');
    ui.busy = true;
    const button = document.querySelector('#recoverrequestf button'); if(button){button.disabled=true;button.textContent='لحظة...';}
    try {
      if (!DEMO && email === RECOVERY_EMAIL){
        const r = await sb.auth.resetPasswordForEmail(email, {redirectTo:RECOVERY_URL}); must(r);
      }
      ui.recovery = 'sent'; ui.recoveryError = '';
    } catch(e){
      ui.recoveryError = /rate|429|too many/i.test(e.message || '') ? 'اتطلبت رسايل كتير. استنى شوية وجرّب تاني.' : 'ما قدرناش نبعت الرسالة. جرّب بعد شوية.';
    } finally { ui.busy = false; render(); }
  },
  async recoverfinishf(fd){
    if (ui.busy) return;
    const pin = latin(fd.get('pin')).trim(), pin2 = latin(fd.get('pin2')).trim();
    if (!/^[0-9]{6}$/.test(pin)) return formErr('الرقم الجديد لازم يكون 6 أرقام.');
    if (pin !== pin2) return formErr('الرقمين مش زي بعض.');
    ui.busy = true;
    document.querySelectorAll('#recoverfinishf button').forEach(b=>b.disabled=true);
    try {
      if (!DEMO) {
        must(await sb.rpc('finish_pin_recovery', {p_pin:pin}));
        await sb.auth.signOut();
      }
      // Remove the recovery URL and any in-memory PIN; go back to normal PIN sign-in.
      me = null; ui.pin = ''; ui.pinUser = null; ui.recovery = null; ui.recoveryError = '';
      history.replaceState(null, '', location.pathname);
      if (!DEMO) await loadLogin();
      toast('الرقم الجديد اتحفظ. ادخل بيه دلوقتي.');
    } catch(e){
      ui.recoveryError = 'الرابط غير صالح أو انتهت صلاحيته. اطلب رابط جديد من نسيت الرقم السري.';
    } finally { ui.busy = false; render(); }
  },
  async setupf(fd){
    const name = String(fd.get('name') || '').trim(), pin = latin(fd.get('pin')).trim(), pin2 = latin(fd.get('pin2')).trim();
    if (!name) return formErr('اكتب الاسم.');
    if (!/^\d{6}$/.test(pin)) return formErr('الرقم السري لازم يكون 6 أرقام.');
    if (pin !== pin2) return formErr('الرقمين مش زي بعض.');
    ui.busy = true; render();
    try {
      const tokens = await fnCall({action:'setup', name, pin});
      const s = must(await sb.auth.setSession(tokens));
      ui.needsSetup = false;
      await loadMe(s.user.id);
      ui.tab = 'set'; toast('الحساب اتعمل. ضيف الكاشيرية من هنا.');
    } catch(e){ ui.busy = false; render(); return formErr(errText(e)); }
    ui.busy = false; render();
  },
  txf(fd){
    const m = ui.modal;
    if(m?.kind!=='tx'||!me||!['admin','cashier'].includes(me.role))return;
    const amount = parseFloat(m.amt || '0');
    const v = fd.get('party'), typed = String(document.getElementById('pq').value || '').trim().replace(/\s+/g, ' ');
    let partyId = v && v !== '__new' ? v : null, newParty = null;
    if (!partyId){
      const hit = typed && S.parties.find(p => norm(p.name) === norm(typed));
      if (hit) partyId = hit.id;
      else if (typed){ newParty = {id:uuid(), name:typed, phone:null}; partyId = newParty.id; }
      else return formErr('اكتب الاسم أو اختار من الأسامي.');
    }
    if (!(amount > 0)) return formErr('اكتب المبلغ بالأرقام.');
    const shopId=me.role==='admin'?m.shopId:me.shop_id;
    if(!shopId||shopId!==m.shopId)return formErr('اختار محل الحركة.');
    const drawer=m.drawer;
    if(!drawer)return formErr('اختار درج الحركة.');
    if(drawer!=='cashier'&&(drawer!=='acc'||DRW[shopId]?.acc?.active!==true))return formErr('الدرج مش متاح للمحل ده.');
    const note = String(fd.get('note') || '').trim();
    if(!DEMO){void HCashReceipts.submit('tx',{p_id:uuid(),p_shop:shopId,p_party:partyId,p_name:newParty?.name||null,p_type:m.type,p_amount:amount,p_note:note,...(drawer==='acc'?{p_drawer:drawer}:{})},`${TYPES[m.type].label} ${nf(amount)} · ${newParty?.name||party(partyId)?.name||typed} · ${payName(drawer,shopId)}`);return;}
    // no open day yet: start one on screen now; the server opens the real one with this entry
    const od = openDay(shopId), day = od || {id:'local-' + uuid(), shopId, openedAt:Date.now(), openedBy:me.id, closedAt:null};
    const tx = {id:uuid(), ts:Date.now(), date:dayOf(day.openedAt), dayId:day.id, shopId, userId:me.id, type:m.type, partyId, amount, note, drawer,
      afterClose:false, deleteAck:false, deleted:null, transferred:false, transferredAt:null, pending:!DEMO};
    void op(() => { if (newParty) S.parties.push(newParty); if (!od) S.days.push(day); S.txs.push(tx); ui.modal = null; toast(`${TYPES[m.type].label} ${nf(amount)} · ${payName(drawer,shopId)} ✓`, tx.id); }, null);
  },
  messagef(fd){
    if(me.role!=='admin'||ui.modal?.kind!=='composeMessage')return;
    const recipient=String(fd.get('recipient')||''), message=String(fd.get('text')||'').trim();
    if(!S.users.some(u=>u.id===recipient&&u.active&&['cashier','staff'].includes(u.role))||!message||message.length>500)
      return formErr('اختار موظف واكتب رسالة من ١ إلى ٥٠٠ حرف.');
    const key=JSON.stringify([recipient,message]);
    if(ui.modal.messageKey!==key){ui.modal.messageKey=key;ui.modal.messageId=uuid();}
    const id=ui.modal.messageId;
    if(DEMO){ui.modal=null;toast('معاينة الرسالة تمت.');render();return;}
    void act(async()=>must(await sb.rpc('hcash_send_message',{p_id:id,p_recipient:recipient,p_text:message})),
      {done:()=>{ui.modal=null;toast('الرسالة اتحفظت في صندوق الموظف.');}});
  },
  delf(fd){
    const t=S.txs.find(x=>x.id===ui.modal.id),reason=String(fd.get('reason')||'').trim();if(!t||reason.length<3||reason.length>500)return formErr('اكتب سبب واضح من ٣ إلى ٥٠٠ حرف.');
    if(DEMO){t.deleted={by:me.id,ts:Date.now(),reason};ui.modal=null;toast('تمت تجربة الإلغاء؛ البيانات الحقيقية متغيرتش.');render();return;}
    void act(async()=>must(await sb.rpc('delete_tx',{p_id:t.id,p_reason:reason})),{done:()=>{ui.modal=null;toast('الحركة اتلغت، وأصل التسجيل محفوظ في السجل.');}});
  },
  restoretxf(fd){
    const t=S.txs.find(x=>x.id===ui.modal.id),reason=String(fd.get('reason')||'').trim();if(me.role!=='admin'||!t)return;if(reason.length<3||reason.length>500)return formErr('اكتب سبب واضح من ٣ إلى ٥٠٠ حرف.');
    if(DEMO){t.deleted=null;ui.modal=null;toast('تمت تجربة إعادة التفعيل.');render();return;}
    void act(async()=>must(await sb.rpc('hcash_restore_tx',{p_id:t.id,p_reason:reason})),{done:()=>{ui.modal=null;toast('الحركة اتفعّلت، والتغيير محفوظ في السجل.');}});
  },
  wipef(fd){
    if(norm(fd.get('ok'))!==norm('امسح'))return formErr('اكتب كلمة امسح بالظبط.');
    const pin=latin(fd.get('pin')).trim();if(!/^\d{6}$/.test(pin))return formErr('اكتب رقم هشام السري: ٦ أرقام.');
    act(async()=>{if(!DEMO){const result=await fnCall({action:'wipe',pin});ui.wipeRemaining=result.deleted?.remaining||0;}else {S.txs=[];S.sales=[];S.notes=[];}}, {done:()=>{ui.modal=null;toast(ui.wipeRemaining?'اتمسحت الحركات المحفوظة في النسخة. الحركات الجديدة أو المعدلة بعدها فضلت محفوظة.':'اتعملت نسخة احتياطية واتمسحت الحركات.');}});
  },
  pinf(fd){
    const u = user(ui.modal.id), len = PIN_LEN[u.role], pin = latin(fd.get('pin')).trim();
    if (!new RegExp(`^\\d{${len}}$`).test(pin)) return formErr(`الرقم السري لازم يكون ${len} أرقام.`);
    act(async () => fnCall({action:'set_pin', user_id:u.id, pin}), {done:() => { ui.modal = null; toast('الرقم السري اتغيّر'); }});
  },
  userf(fd){
    const name = String(fd.get('name') || '').trim(), pin = latin(fd.get('pin')).trim();
    if (!name) return formErr('اكتب اسم الكاشير.', 'uerr');
    if (!/^\d{4}$/.test(pin)) return formErr('الرقم السري لازم يكون 4 أرقام.', 'uerr');
    const shopId = fd.get('shop');
    if (!shopId) return formErr('اختار المحل اللي هيشتغل فيه.', 'uerr');
    act(async () => {
      if (DEMO){ S.users.push({id:uuid(), name, role:'cashier', active:true, shop_id:shopId}); return; }
      const r = await fnCall({action:'create_user', name, pin});
      must(await sb.from('profiles').update({shop_id:shopId}).eq('id', r.id));
    }, {errId:'uerr', done:() => toast(`${name} اتضاف`)});
  },
  devf(fd){
    const d = ui.modal.id ? device(ui.modal.id) : null;
    const name = String(fd.get('name') || '').trim().replace(/\s+/g, ' '), shopId = fd.get('shop');
    const buy = parseFloat(latin(fd.get('buy')).replace(/,/g, '')), sell = parseFloat(latin(fd.get('sell')).replace(/,/g, '')), qty = Number(latin(fd.get('qty')).trim());
    if (!name) return formErr('اكتب اسم الجهاز.');
    if (!(buy >= 0)) return formErr('اكتب سعر الشراء.');
    if (!(sell >= 0)) return formErr('اكتب سعر البيع.');
    if (!Number.isInteger(qty) || qty < 0) return formErr('الكمية لازم تكون رقم صحيح.');
    const minimum=String(fd.get('min')||'').trim(),minPrice=minimum===''?null:Number(latin(minimum));
    if(minPrice!==null&&(!Number.isFinite(minPrice)||minPrice<0||minPrice>sell))return formErr('الحد الأدنى لازم يكون من صفر لسعر البيع المقترح.');
    const row = {shop_id:shopId, name, buy_price:buy, sell_price:sell, min_price:minPrice, qty};
    if (d) op(() => { Object.assign(d, {shopId, name, buy, sell, minPrice, qty}); ui.modal = null; toast(`${name} اتحفظ`); },
      async () => must(await sb.from('devices').update(row).eq('id', d.id)), 'ما اتحفظش.');
    else { const id = uuid();
      op(() => { S.devices.push({id, shopId, name, buy, sell, minPrice, qty, archived:false}); ui.modal = null; toast(`${name} اتضاف للمخزن (${qty})`); },
        async () => must(await sb.from('devices').insert({id, ...row})), 'ما اتضافش.'); }
  },
  drawersf(fd){
    const rows = S.shops.flatMap(sh => DRAWER_KEYS.map(k => ({shop_id:sh.id, key:k, name:String(fd.get(`n|${sh.id}|${k}`) || '').trim().replace(/\s+/g, ' '), active:k === 'cashier' || fd.get(`on|${sh.id}|${k}`) === 'on'})));
    if (rows.some(r => !r.name)) return formErr('كل درج لازم يكون ليه اسم.', 'derr');
    const changed = rows.filter(r => { const o = DRW[r.shop_id]?.[r.key]; return !o || o.name !== r.name || isOn(r.shop_id, r.key) !== r.active; });
    if (!changed.length){ toast('مفيش تغيير'); render(); return; }
    const before=structuredClone(DRW);
    op(() => { setDrawers(changed); toast('الأدراج اتحفظت'); },
       async () => must(await sb.from('shop_drawers').upsert(changed,{onConflict:'shop_id,key'})), 'ما اتحفظتش.')
      .then(ok => { if (!ok){ DRW=before; void refresh().then(softRender).catch(()=>{}); render(); } });
  },
  shopsf(fd){
    const changes = S.shops.map(s => [s, String(fd.get(s.id) || '').trim()]).filter(([s, n]) => n && n !== s.name);
    op(() => { changes.forEach(([s, n]) => s.name = n); toast('الأسامي اتحفظت'); },
       async () => { for (const [s, n] of changes) must(await sb.from('shops').update({name:n}).eq('id', s.id)); });
  }
};

HCashCommerce.install(A,F);
HCashSearch.install(A,F);

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el || el.disabled) return;
  const name = el.dataset.a, fn = A[name]; if (!fn) return;
  if (name !== 'sendOpen' && el.tagName === 'A') e.preventDefault();
  const before = ui.modal;
  if (fn(el.dataset.v, e) !== false){ if (ui.modal && ui.modal !== before && ui.modal.kind !== 'send') ui.toast = null; render(); }
});
document.addEventListener('change', e => {
  const el = e.target, c = el.dataset.c;
  if(el.id==='f-shop'&&ui.modal?.kind==='tx'){
    ui.modal.shopId=el.value;
    ui.modal.drawer=DRW[el.value]?.acc?.active===true?null:'cashier';
    document.getElementById('tx-drawer-field').innerHTML=txDrawerField(el.value,ui.modal.drawer);
  }else if(el.name==='drawer'&&ui.modal?.kind==='tx'){
    ui.modal.drawer=el.value;
  }else if (c === 'ushop'){
    const u = user(el.dataset.u), v = el.value || null;
    op(() => { u.shop_id = v; toast(`${u.name}: ${v ? shop(v).name : 'من غير محل'}`); }, async () => must(await sb.from('profiles').update({shop_id:v}).eq('id', u.id)));
  }
  else if (c === 'fdate'){
    const d = el.value; if (!d) return;
    fetchDay(d).then(() => { S.days.filter(x => dayOf(x.openedAt) === d).forEach(x => ui.openDays.add(x.id)); render(); }).catch(() => toast('ما قدرتش أجيب اليوم ده'));
  }
  else if (el.name === 'party'){
    const p = el.value === '__new' ? null : party(el.value), pq = document.getElementById('pq');
    if (p && pq) pq.value = p.name;
    if(ui.modal?.kind==='tx'){ui.modal.party=el.value;ui.modal.query=pq?.value||'';}
    document.activeElement?.blur?.();
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'pq'){
    const pl = document.getElementById('plist'), sel = pl.querySelector('input:checked')?.value || null;
    pl.innerHTML = nameOptions(e.target.value, sel === '__new' ? null : sel);
    ui.modal.query=e.target.value;
    ui.modal.party=pl.querySelector('input:checked')?.value||null;
  }
  else if(e.target.id==='f-note'&&ui.modal?.kind==='tx')ui.modal.note=e.target.value;
  else if (e.target.id === 'dq' && ui.modal?.kind === 'sell'){ ui.modal.q = e.target.value; document.getElementById('dlist').innerHTML = devOptions(ui.modal.shopId, e.target.value); }
  else if (e.target.id === 'sv' && ui.modal?.kind === 'sell') ui.modal.voucher = latin(e.target.value);
});
document.addEventListener('submit', e => { e.preventDefault(); const fn = F[e.target.id]; if (fn&&!ui.saving&&!ui.busy) fn(new FormData(e.target)); });
window.addEventListener('hcashback',goBackInApp);
window.addEventListener('popstate',goBackInApp);
document.addEventListener('pointerup',syncBrowserBack,true);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.modal)goBackInApp();
  if (!ui.recovery && !me && ui.pinUser && /^\d$/.test(e.key)){ if (A.pin(e.key) !== false) render(); }
});
document.addEventListener('focusout', () => setTimeout(() => { if (ui.dirty && !ui.modal) softRender(); }, 50));
// The bottom bar stays put: hide it while the keyboard is open so it doesn't ride up over the field being typed in.
const isField = el => el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit)$/.test(el.type)));
document.addEventListener('focusin', e => { if (isField(e.target)) document.body.classList.add('typing'); });
document.addEventListener('focusout', () => setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('typing'); }, 80));
window.addEventListener('online', () => { ui.offline = false; if (me) refresh().then(render).catch(() => {}); else loadLogin().then(render); });
window.addEventListener('offline', () => { ui.offline = true; render(); });
// Catch up on anything missed while the phone was asleep.
let catchingUp=false,lastCatchUp=0;
document.addEventListener('visibilitychange',async()=>{
  if(document.hidden||!me||DEMO||catchingUp||Date.now()-lastCatchUp<5000)return;
  catchingUp=true;lastCatchUp=Date.now();const before=JSON.stringify(S)+Attendance.signature();
  try{await refresh();if(before!==JSON.stringify(S)+Attendance.signature())softRender();}catch(_){}finally{catchingUp=false;}
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); ui.installEvt = e; render(); });
sb.auth.onAuthStateChange(evt => { if (evt === 'SIGNED_OUT' && me && !DEMO){ me = null; loadLogin().then(render); } });

function demoData(role){
  const t = today(), y = addDays(t, -1), at = (ds, h, m) => { const [Y, M, D] = ds.split('-').map(Number); return new Date(Y, M - 1, D, h, m).getTime(); };
  const users = [{id:'u0', name:'هشام', role:'admin', active:true}, {id:'u1', name:'أحمد', role:'cashier', active:true, shop_id:'s1'}, {id:'u2', name:'محمود', role:'cashier', active:true, shop_id:'s2'}];
  const shops = [{id:'s1', name:'المحل الأول'}, {id:'s2', name:'المحل التاني'}];
  const parties = ['محمد عبد الله', 'سيد حسن', 'أم كريم', 'مصطفى الميكانيكي', 'عمر', 'مخزن النور'].map((name, i) => ({id:'p' + i, name, phone:null}));
  const tx = (id, date, h, m, shopId, userId, type, p, amount, note = '', extra = {}) => ({id, ts:at(date, h, m), date, shopId, userId, type, partyId:'p' + p, amount, note, afterClose:false, deleteAck:false, deleted:null, transferred:false, transferredAt:null, ...extra});
  const txs = [
    tx('t1', y, 18, 5, 's1', 'u1', 'gave', 2, 350, 'جراب + سكرينة', {transferred:true, transferredAt:at(y, 22, 0)}),
    tx('t2', t, 10, 15, 's1', 'u1', 'gave', 0, 500, 'شاحن سامسونج'),
    tx('t3', t, 10, 50, 's1', 'u1', 'took', 1, 200),
    tx('t4', t, 11, 30, 's2', 'u2', 'took', 3, 1750, 'دفعة من الحساب'),
    tx('t5', t, 12, 40, 's1', 'u1', 'gave', 5, 2000, 'دفعة لحساب أكتوبر'),
    tx('t6', t, 13, 10, 's2', 'u2', 'gave', 4, 950, 'سماعة بلوتوث'),
    tx('t7', t, 14, 0, 's1', 'u1', 'took', 0, 150)];
  const notes = [{id:'n1', ts:at(t, 14, 0), read:false, text:'أحمد: أخدت من محمد عبد الله 150 ج.م (المحل الأول)'}, {id:'n2', ts:at(t, 13, 10), read:false, text:'محمود: أعطيت لـ مصطفى الميكانيكي 950 ج.م (المحل التاني)'}];
  notes.unshift({id:'demo-personal',kind:'personal',recipient:'u1',ts:at(t,14,5),read:false,text:'راجع درج الإكسسوارات قبل قفل اليوم.'});
  const days = [{id:'d0', shopId:'s1', openedAt:at(y, 9, 0), openedBy:'u1', closedAt:at(y, 23, 40), closedBy:'u1', opening:98000},
    {id:'d1', shopId:'s1', openedAt:at(t, 10, 0), openedBy:'u1', closedAt:null, opening:100000, accOpening:5000}, {id:'d2', shopId:'s2', openedAt:at(t, 10, 30), openedBy:'u2', closedAt:null}];
  txs.forEach(x => x.dayId = x.date === y ? 'd0' : (x.shopId === 's1' ? 'd1' : 'd2'));
  const dv = (id, shopId, name, buy, sell, qty) => ({id, shopId, name, buy, sell, minPrice:Math.max(0,sell-300), qty, archived:false});
  const devices = [dv('v1', 's1', 'سامسونج A15 128 جيجا', 7800, 8500, 4), dv('v2', 's1', 'ريلمي C53', 6900, 7400, 2), dv('v3', 's1', 'آيفون 13 128 جيجا', 24500, 26500, 1),
    dv('v4', 's1', 'شاومي ريدمي 13C', 5600, 6100, 0), dv('v5', 's2', 'أوبو A18', 5200, 5650, 3)];
  const sl = (id, h, m, deviceId, qty, price, pay, voucher = '') => { const d = devices.find(x => x.id === deviceId);
    return {id, ts:at(t, h, m), shopId:d.shopId, dayId:d.shopId === 's1' ? 'd1' : 'd2', deviceId, name:d.name, qty, buy:d.buy, price, pay, voucher, userId:d.shopId === 's1' ? 'u1' : 'u2', deleted:false}; };
  const sales = [sl('x1', 11, 5, 'v1', 1, 8400, 'cashier'), sl('x2', 12, 20, 'v2', 1, 7400, 'acc'), sl('x3', 13, 45, 'v3', 1, 26500, 'hcash', '55821'), sl('x4', 12, 0, 'v5', 1, 5650, 'cashier')];
  setDrawers([
    {shop_id:'s1',key:'acc',name:'درج الإكسسوارات',active:true},
    {shop_id:'s2',key:'acc',name:'درج الإكسسوارات',active:false}
  ]);
  S = {shops, users, parties, txs, notes, days, devices, sales};
  me = users.find(u => u.role === (role === 'admin' ? 'admin' : 'cashier'));
  ui.shopId = 's1';
}

// An app left open keeps old code; reload it when a newer version is published (never in the middle of a form).
async function checkUpdate(){
  if (DEMO || ui.recovery) return;
  try {
    const v = (await (await fetch('version.json?t=' + Date.now(), {cache:'no-store'})).json()).v;
    if (v > APP_VERSION){ ui.reloadPending = true; if(!document.getElementById('update-ready')){const b=document.createElement('div');b.id='update-ready';b.className='toast';b.innerHTML='تحديث جديد جاهز <button class="tbtn" data-a="applyUpdate">حدّث البرنامج</button>';document.body.appendChild(b);} }
  } catch(e){}
}
setInterval(checkUpdate, 3 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
// Reload only when the user explicitly chooses the update button.

// Size the owner screen to the part of the phone screen that is really visible (some Android WebViews report a taller one).
// The keyboard is spotted by the visible area getting much shorter (works even where focus events don't arrive):
// the bottom bar hides, sheets shrink to sit above the keyboard, and the field being typed in is scrolled into view.
let fullH = 0, lastW = 0, kbOn = false;
function setAppH(){
  const vv = window.visualViewport, h = Math.round(vv?.height || innerHeight), w = Math.round(vv?.width || innerWidth), r = document.documentElement.style;
  if (w !== lastW){ lastW = w; fullH = 0; }  // turned the phone: start over
  if (!kbOn) fullH = Math.max(fullH, h);
  const kb = fullH - h > 140;
  r.setProperty('--app-h', h + 'px');
  r.setProperty('--vv-top', Math.round(vv?.offsetTop || 0) + 'px');
  document.body.classList.toggle('kb', kb);
  if (kb && !kbOn){ const a = document.activeElement; if (isField(a)) setTimeout(() => a.scrollIntoView({block:'center', behavior:'smooth'}), 80); }
  kbOn = kb;
}
setAppH();
window.visualViewport?.addEventListener('resize', setAppH); window.visualViewport?.addEventListener('scroll', setAppH);
window.addEventListener('resize', setAppH);
window.addEventListener('orientationchange', () => setTimeout(setAppH, 300));
// a field tapped while the keyboard is already open also comes into view
document.addEventListener('focusin', e => { if (kbOn && isField(e.target)) setTimeout(() => e.target.scrollIntoView({block:'center', behavior:'smooth'}), 80); });
applyTheme(themePref());
darkMQ.addEventListener?.('change', () => { if (themePref() === 'auto') applyTheme('auto'); });
// Recovery is handled before normal session loading; URL alone never authorizes a PIN reset.
sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY'){
    ui.recovery = 'reset'; ui.booting = false;
    history.replaceState(null, '', location.pathname + '?recover=1');
    setTimeout(render, 0);
  }
});
(async function boot(){
  checkUpdate();
  if (DEMO){ demoData(DEMO === 'staff' ? 'cashier' : DEMO); if (DEMO === 'staff'){ me = {...me, role:'staff'}; ui.hr = true; } await Attendance.load({silent:true}); ui.booting = false; render(); return; }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  try {
    const {data:{session}} = await sb.auth.getSession();
    if (RECOVERY_ENTRY || ui.recovery === 'reset'){
      ui.recovery = session ? 'reset' : 'request';
      if (!session) ui.recoveryError = 'الرابط غير صالح أو انتهت صلاحيته. اطلب رسالة جديدة.';
      history.replaceState(null, '', location.pathname + '?recover=1');
      ui.booting = false; render(); return;
    }
    if (session) await loadMe(session.user.id);
    if (!me) await loadLogin();
  } catch(e){ ui.offline = !navigator.onLine; if(!me)ui.loginError=true; }
  ui.booting = false; render();
})();
