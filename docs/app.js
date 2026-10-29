'use strict';
const CFG = window.YAWMEYA_CONFIG;
const DEMO = new URLSearchParams(location.search).get('demo'); // 'cashier' | 'admin' shows sample data, saves nothing
const sb = supabase.createClient(CFG.url, CFG.key, {auth:{persistSession:!DEMO, autoRefreshToken:!DEMO, storageKey:'yawmeya-auth'}});

// Same two actions as Konnash: أخدت = came in from the person, أعطيت = given to the person.
const TYPES = {took:{label:'أخدت', prep:'من', sign:'+'}, gave:{label:'أعطيت', prep:'لـ', sign:'−'}};
const PIN_LEN = {admin:6, cashier:4};
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
  kenash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
  txs:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  notes:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  set:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>'
};

/* ---------- state ---------- */
let S = {shops:[], users:[], parties:[], txs:[], notes:[]};
let me = null;
const ui = {booting:true, loginUsers:[], needsSetup:false, pinUser:null, pin:'', pinErr:'', pinBusy:false, busy:false,
  shopId:lsGet('yawmeya-shop'), tab:'kenash', kshop:'all', f:{shop:'all', date:today()},
  modal:null, toast:null, dirty:false, offline:!navigator.onLine, installEvt:null};

const user = id => S.users.find(u => u.id === id);
const shop = id => S.shops.find(s => s.id === id);
const party = id => S.parties.find(p => p.id === id);
const live = t => !t.deleted;
const pname = t => party(t.partyId)?.name || '—';
const pendingList = () => S.txs.filter(t => live(t) && !t.transferred && (ui.kshop === 'all' || t.shopId === ui.kshop)).sort((a, b) => a.ts - b.ts);
const dayList = (shopId, date) => S.txs.filter(t => t.shopId === shopId && t.date === date);
function totals(list){ const r = {took:0, gave:0, count:0}; list.filter(live).forEach(t => { r[t.type] += t.amount; r.count++; }); return r; }
const upsert = (arr, row) => { const i = arr.findIndex(x => x.id === row.id); if (i >= 0) arr[i] = row; else arr.push(row); };

/* ---------- data ---------- */
const mapTx = r => ({id:r.id, ts:Date.parse(r.ts), date:r.day, shopId:r.shop_id, userId:r.user_id, type:r.type, partyId:r.party_id,
  amount:Number(r.amount), note:r.note || '', afterClose:r.after_close, deleteAck:r.delete_ack,
  deleted:r.deleted_at ? {by:r.deleted_by, ts:Date.parse(r.deleted_at), reason:r.delete_reason} : null,
  transferred:!!r.transferred_at, transferredAt:r.transferred_at ? Date.parse(r.transferred_at) : null});
const mapNote = n => ({id:n.id, ts:Date.parse(n.ts), text:n.text, kind:n.kind, read:n.read});
const extraDays = new Set();
function must(res){ if (res.error) throw res.error; return res.data; }

async function refresh(){
  if (DEMO) return;
  const admin = me.role === 'admin', t = today(), from = addDays(t, -45);
  const txq = sb.from('txs').select('*').order('ts', {ascending:false}).limit(5000);
  const [shops, users, parties, txs, notes] = await Promise.all([
    sb.from('shops').select('*').order('sort'),
    sb.from('profiles').select('id,name,role,active,created_at,shop_id').order('created_at'),
    sb.from('parties').select('id,name,phone').order('name'),
    admin ? txq.or(`day.gte.${from},and(transferred_at.is.null,deleted_at.is.null),and(deleted_at.not.is.null,transferred_at.not.is.null,delete_ack.is.false)`) : txq.eq('day', t),
    admin ? sb.from('notes').select('*').order('ts', {ascending:false}).limit(80) : Promise.resolve({data:[]})
  ]);
  S.shops = must(shops);
  S.users = must(users);
  S.parties = must(parties);
  const pend = S.txs.filter(t => t.pending);
  S.txs = must(txs).map(mapTx);
  pend.forEach(p => { if (!S.txs.some(t => t.id === p.id)) S.txs.push(p); });
  S.notes = must(notes).map(mapNote);
  for (const d of extraDays) await fetchDay(d, false);
  if (me.role === 'admin'){ if (!shop(ui.shopId)) ui.shopId = S.shops[0]?.id || null; }
  else { me.shop_id = user(me.id)?.shop_id ?? me.shop_id; ui.shopId = me.shop_id; }
}
async function fetchDay(d, rerender = true){
  if (DEMO) return;
  extraDays.add(d);
  const txs = await sb.from('txs').select('*').eq('day', d);
  must(txs).map(mapTx).forEach(t => upsert(S.txs, t));
  if (rerender) render();
}

// Live updates apply the changed row directly instead of reloading everything.
let chan = null, rtTimer = null;
function subscribe(){
  if (DEMO) return;
  if (chan) sb.removeChannel(chan);
  chan = sb.channel('yawmeya-live');
  for (const table of ['txs', 'notes', 'parties']) chan.on('postgres_changes', {event:'*', schema:'public', table}, p => onChange(table, p));
  chan.subscribe();
}
function onChange(table, p){
  const del = p.eventType === 'DELETE', row = p.new, old = p.old;
  if (table === 'txs'){ if (del) S.txs = S.txs.filter(t => t.id !== old.id); else upsert(S.txs, mapTx(row)); }
  else if (table === 'parties'){ if (!del) upsert(S.parties, {id:row.id, name:row.name, phone:row.phone}); }
  else if (table === 'notes' && me?.role === 'admin'){
    if (p.eventType === 'INSERT'){ const n = mapNote(row); S.notes.unshift(n); notifyDevice(n); }
    else if (!del) upsert(S.notes, mapNote(row));
  }
  clearTimeout(rtTimer); rtTimer = setTimeout(softRender, 120);
}
function notifyDevice(n){
  if (!document.hidden) return;
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification('اليومية', {body:n.text, tag:n.id, icon:'icons/icon-192.png'}); } catch(e){}
}
function softRender(){
  const a = document.activeElement;
  const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  if (typing || (ui.modal && ui.modal.kind !== 'send')){ ui.dirty = true; return; }
  render();
}

async function loadLogin(){
  const [u, n] = await Promise.all([sb.rpc('login_users'), sb.rpc('needs_setup')]);
  ui.loginUsers = u.data || []; ui.needsSetup = !!n.data;
}
async function loadMe(uid){
  const r = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (r.data && r.data.active){ me = r.data; if (me.role !== 'admin') ui.shopId = me.shop_id; await refresh(); subscribe(); }
  else { me = null; await sb.auth.signOut(); }
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
  if (m.includes('NO_SHOP')) return 'هشام لسه ما حددلكش أنهي محل.';
  if (m.includes('PARTY_REQUIRED')) return 'اكتب الاسم الأول.';
  if (m === 'wrong') return 'الرقم غلط، جرّب تاني.';
  if (m === 'locked') return 'اتكتب رقم غلط كتير. استنى 10 دقايق وجرّب تاني.';
  if (m === 'admin_pin') return 'رقم المدير لازم يكون 6 أرقام.';
  if (m === 'pin') return 'الرقم السري لازم يكون 4 أرقام.';
  if (m === 'forbidden') return 'الحركة دي لهشام بس.';
  if (/fetch|network|Failed/i.test(m) || !navigator.onLine) return 'مفيش نت. اتأكد من الاتصال وجرّب تاني.';
  return 'حصلت مشكلة، جرّب تاني.';
}

// Change the screen right away, save in the background, and undo with a message if saving fails.
async function op(local, remote, failMsg){
  local(); render();
  if (DEMO) return true;
  try { await remote(); return true; }
  catch(e){
    toast(failMsg ? `${failMsg} ${errText(e)}` : errText(e));
    try { await refresh(); } catch(_){}
    render(); return false;
  }
}

/* ---------- pieces ---------- */
function band(inner){
  const where = me.role === 'admin' ? 'المدير' : esc(shop(me.shop_id)?.name || 'كاشير');
  return `${DEMO ? '<div class="demo">وضع تجربة: البيانات أمثلة ومش بيتسجل حاجة</div>' : ''}
    <header class="band"><div class="in gut">
      <div class="bar"><div class="who"><b>${esc(me.name)}</b><small>${where}</small></div>
        ${ui.installEvt ? `<button class="ibtn" data-a="install">سطّب</button>` : ''}
        <button class="ibtn" data-a="logout" aria-label="خروج">${icon.out}</button></div>
      ${inner}
    </div></header>
    ${ui.offline ? `<div class="offline">مفيش نت. اللي هتسجله مش هيتحفظ لحد ما النت يرجع.</div>` : ''}`;
}
const sumBox = r => `<div class="sum"><div><small>أخدت</small><b class="num in-t" data-count="took" data-val="${r.took}">${nf(r.took)}</b></div><div><small>أعطيت</small><b class="num out-t" data-count="gave" data-val="${r.gave}">${nf(r.gave)}</b></div></div>`;
const shopPills = (cur, action, all) => (S.shops.length < 2 && !all) ? '' :
  `<div class="shops">${[...(all ? [['all', 'المحلين']] : []), ...S.shops.map(s => [s.id, s.name])].map(([id, n]) => `<button class="${cur === id ? 'on' : ''}" data-a="${action}" data-v="${id}">${esc(n)}</button>`).join('')}</div>`;

function item(x, o = {}){
  const T = TYPES[x.type], sub = [];
  if (o.date) sub.push(dayLabel(x.date));
  sub.push(tm(x.ts));
  if (o.shop) sub.push(esc(shop(x.shopId)?.name));
  if (o.who) sub.push(esc(user(x.userId)?.name));
  if (x.note) sub.push(esc(x.note));
  let end = o.end || '';
  if (o.mine && x.userId === me.id && !x.deleted && !x.pending) end = `<button class="btn link" data-a="del" data-v="${x.id}">امسح</button>`;
  if (x.pending) end = `<small class="muted">بيتحفظ...</small>`;
  const flag = x.deleted ? `<small class="flag">مسحها ${esc(user(x.deleted.by)?.name)}${x.deleted.reason ? ': ' + esc(x.deleted.reason) : ''}</small>` : '';
  return `<li class="item ${x.deleted ? 'del' : ''} ${x.pending ? 'pending' : ''} ${o.tap ? 'tap' : ''}" data-id="${x.id}" ${o.tap ? `data-a="${o.tap}" data-v="${x.id}"` : ''}>
    ${avatar(pname(x))}
    <div class="mid"><b>${esc(pname(x))}</b><small><span class="tag ${x.type}">${T.label}</span> ${sub.join(' · ')}</small>${flag}</div>
    <div class="end"><span class="amt ${x.type}-t">${money(x.amount)}</span>${end}</div></li>`;
}
const xBtn = `<button type="button" class="x" data-a="closeModal" aria-label="إغلاق">×</button>`;

/* ---------- screens ---------- */
const renderBoot = () => `<main class="login gut"><div class="in"><div class="logo"><i>ي</i>اليومية</div><p class="muted">بيحمّل...</p></div></main>`;

function renderSetup(){
  return `<main class="login gut"><div class="in"><div class="logo"><i>ي</i>اليومية</div>
    <h1>أول تشغيل: حساب المدير</h1>
    <p class="muted">الحساب ده لهشام. منه هيضيف الكاشيرية ويتابع الحركات.</p>
    <form id="setupf" class="card">
      <div class="field"><label for="su-name">الاسم</label><input id="su-name" name="name" value="هشام" autocomplete="off"></div>
      <div class="field"><label for="su-pin">رقم سري من 6 أرقام</label><input id="su-pin" name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <div class="field"><label for="su-pin2">اكتبه تاني</label><input id="su-pin2" name="pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <p id="ferr" class="err" role="alert"></p>
      <button class="btn primary wide" ${ui.busy ? 'disabled' : ''}>اعمل الحساب وادخل</button></form></div></main>`;
}
function renderLogin(){
  if (ui.needsSetup) return renderSetup();
  if (!ui.pinUser){
    return `<main class="login gut"><div class="in"><div class="logo"><i>ي</i>اليومية</div>
      <h1>مين بيسجل دلوقتي؟</h1>
      ${ui.loginUsers.length ? `<div class="ugrid">${ui.loginUsers.map(u => `<button class="ubtn" data-a="pickUser" data-v="${u.id}">${avatar(u.name)}${esc(u.name)}<small>${u.role === 'admin' ? 'المدير' : 'كاشير'}</small></button>`).join('')}</div>`
        : `<p class="muted">${ui.offline ? 'مفيش نت. اتأكد من الاتصال.' : 'مفيش حسابات لسه.'}</p>`}
      ${ui.installEvt ? `<button class="btn" data-a="install">سطّب البرنامج على الموبايل</button>` : ''}</div></main>`;
  }
  const u = ui.loginUsers.find(x => x.id === ui.pinUser), len = PIN_LEN[u.role];
  return `<main class="login gut"><div class="in">
    <button class="back" data-a="loginBack">→ رجوع</button>
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px">${avatar(u.name)}<h1>${esc(u.name)}</h1><p class="muted">اكتب الرقم السري</p></div>
    <div class="dots ${ui.pinErr ? 'bad' : ''}" aria-label="${ui.pin.length} من ${len}">${Array.from({length:len}, (_, i) => `<span class="${i < ui.pin.length ? 'f' : ''}"></span>`).join('')}</div>
    <p class="err" role="alert">${ui.pinBusy ? 'بيدخل...' : esc(ui.pinErr)}</p>
    <div class="pad">${[1,2,3,4,5,6,7,8,9].map(n => `<button data-a="pin" data-v="${n}" ${ui.pinBusy ? 'disabled' : ''}>${n}</button>`).join('')}
      <button data-a="pinBack" aria-label="امسح رقم">⌫</button><button data-a="pin" data-v="0" ${ui.pinBusy ? 'disabled' : ''}>0</button><span></span></div></div></main>`;
}

function renderCashier(){
  const t = today(), s = shop(me.shop_id);
  if (!s) return `${band('')}<main class="wrap gut"><p class="empty">هشام لسه ما حددلكش أنهي محل. كلّمه يحددهولك من الإعدادات.</p></main>`;
  const list = dayList(s.id, t).filter(live).sort((a, b) => b.ts - a.ts);
  return `${band(sumBox(totals(list)))}
  <main class="wrap gut">
    <div class="acts">
      <button class="act took" data-a="type" data-v="took"><span class="ic">${icon.took}</span>أخدت</button>
      <button class="act gave" data-a="type" data-v="gave"><span class="ic">${icon.gave}</span>أعطيت</button>
    </div>
    <section><div class="head"><h2>حركات النهارده</h2><span class="muted small num">${list.length}</span></div>
      ${list.length ? `<ul class="list">${list.map(x => item(x, {mine:true})).join('')}</ul>` : `<p class="empty">لسه مفيش حركات. اضغط أخدت أو أعطيت.</p>`}
    </section>
  </main>`;
}

function renderAdmin(){
  const pend = pendingList();
  const alerts = S.txs.filter(t => t.deleted && t.transferred && !t.deleteAck).length;
  const unread = S.notes.filter(n => !n.read).length;
  const tabs = [['kenash','كناش', S.txs.filter(t => live(t) && !t.transferred).length + alerts],['txs','الحركات',0],['notes','الإشعارات',unread],['set','الإعدادات',0]];
  const top = ui.tab === 'kenash' ? `${shopPills(ui.kshop, 'kshop', true)}
      <div class="sum"><div><small>لسه ما اتنقلش</small><b class="num">${pend.length}</b></div><div><small>أخدت / أعطيت</small><b class="num" style="font-size:1.05rem"><span class="in-t">${nf(totals(pend).took)}</span> / <span class="out-t">${nf(totals(pend).gave)}</span></b></div></div>`
    : ui.tab === 'txs' ? sumBox(totals(S.txs.filter(t => (ui.f.shop === 'all' || t.shopId === ui.f.shop) && t.date === ui.f.date)))
    : `<h1>${ui.tab === 'notes' ? 'الإشعارات' : 'الإعدادات'}</h1>`;
  const body = {kenash:tabKenash, txs:tabTxs, notes:tabNotes, set:tabSet}[ui.tab]();
  return `${band(top)}<main class="wrap admin gut">${body}</main>
    <nav class="nav" aria-label="الأقسام"><div class="in">${tabs.map(([k, l, n]) => `<button class="${ui.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}" ${ui.tab === k ? 'aria-current="page"' : ''}>${icon[k]}${l}${n ? `<span class="badge">${n}</span>` : ''}</button>`).join('')}</div></nav>`;
}
function tabKenash(){
  const pend = pendingList();
  const alerts = S.txs.filter(t => t.deleted && t.transferred && !t.deleteAck);
  const recent = S.txs.filter(t => live(t) && t.transferred && t.transferredAt).sort((a, b) => b.transferredAt - a.transferredAt).slice(0, 6);
  const days = [...new Set(pend.map(t => t.date))];
  return `${pend.length ? `<button class="btn primary wide" data-a="send" data-v="${pend[0].id}" style="box-shadow:var(--shadow)">ابدأ النقل لكناش</button>` : ''}
    ${alerts.length ? `<section><h2 class="gave-t">امسح دول من كناش</h2>
      <ul class="list">${alerts.map(x => item(x, {shop:true, date:true, end:`<button class="btn sm" data-a="ack" data-v="${x.id}">مسحتها</button>`})).join('')}</ul></section>` : ''}
    ${pend.length ? days.map(d => `<section><div class="dayhead">${dayLabel(d)}</div><ul class="list">${pend.filter(t => t.date === d).map(x => item(x, {tap:'send', shop:ui.kshop === 'all', who:true})).join('')}</ul></section>`).join('')
      : `<p class="empty">كل الحركات اتنقلت لكناش 👌</p>`}
    ${recent.length ? `<section><h2>آخر اللي اتنقل</h2>
      <ul class="list">${recent.map(x => item(x, {date:true, end:`<button class="btn link" data-a="untransfer" data-v="${x.id}">رجّعها</button>`})).join('')}</ul></section>` : ''}`;
}
function tabTxs(){
  const f = ui.f;
  const list = S.txs.filter(t => (f.shop === 'all' || t.shopId === f.shop) && t.date === f.date).sort((a, b) => b.ts - a.ts);
  return `<div class="card"><div class="row2">
      <div class="field"><label for="fdate">اليوم</label><input type="date" id="fdate" data-c="fdate" value="${f.date}" max="${today()}"></div>
      <div class="field"><label for="fshop">المحل</label><select id="fshop" data-c="fshop"><option value="all">المحلين</option>${S.shops.map(s => `<option value="${s.id}" ${f.shop === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div></div>
      ${(f.shop === 'all' ? S.shops : [shop(f.shop)]).map(s => { const r = totals(dayList(s.id, f.date));
        return `<div class="head small"><span><b>${esc(s.name)}</b> · <span class="took-t num">${nf(r.took)}</span> / <span class="gave-t num">${nf(r.gave)}</span></span></div>`; }).join('')}</div>
    ${list.length ? `<ul class="list">${list.map(x => item(x, {shop:f.shop === 'all', who:true, admin:true,
        end:x.deleted ? `<button class="btn link" data-a="restore" data-v="${x.id}">رجّعها</button>` : `<button class="btn link" data-a="del" data-v="${x.id}">امسح</button>`})).join('')}</ul>`
      : `<p class="empty">مفيش حركات في اليوم ده.</p>`}`;
}
function tabNotes(){
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `${perm === 'default' ? `<div class="card"><p>فعّل الإشعارات علشان توصلك والبرنامج في الخلفية.</p><button class="btn primary" data-a="askNotify">فعّل الإشعارات</button></div>` : ''}
    ${S.notes.length ? `<ul class="list">${S.notes.map(n => `<li class="item"><div class="mid"><b style="white-space:normal;font-weight:${n.read ? 500 : 700}">${esc(n.text)}</b><small>${dayLabel(dayOf(n.ts))} · ${tm(n.ts)}</small></div></li>`).join('')}</ul>` : `<p class="empty">مفيش إشعارات لسه.</p>`}`;
}
function tabSet(){
  return `<section><h2>المحلات</h2><form id="shopsf" class="card">${S.shops.map(s => `<div class="field"><label for="s_${s.id}">اسم المحل</label><input id="s_${s.id}" name="${s.id}" value="${esc(s.name)}"></div>`).join('')}<button class="btn">احفظ الأسامي</button></form></section>
    <section><h2>الكاشيرية</h2><ul class="list">${S.users.map(u => `<li class="item">${avatar(u.name)}<div class="mid"><b>${esc(u.name)}</b><small>${u.role === 'admin' ? 'المدير' : (u.active ? 'كاشير' : 'موقوف')}</small>${u.role === 'admin' ? '' : `<div style="margin-top:6px"><select data-c="ushop" data-u="${u.id}" aria-label="محل ${esc(u.name)}" style="min-height:40px;padding:6px 10px"><option value="">اختار المحل</option>${S.shops.map(s => `<option value="${s.id}" ${u.shop_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>`}</div>
      <div class="end" style="flex-direction:row;gap:6px"><button class="btn sm" data-a="chPin" data-v="${u.id}">الرقم</button>
        ${u.role !== 'admin' ? `<button class="btn sm" data-a="toggleUser" data-v="${u.id}">${u.active ? 'وقّف' : 'شغّل'}</button>` : ''}</div></li>`).join('')}</ul>
      <form id="userf" class="card"><h3>ضيف كاشير</h3><div class="row2">
        <div class="field"><label for="nu-name">الاسم</label><input id="nu-name" name="name" autocomplete="off"></div>
        <div class="field"><label for="nu-pin">رقم سري 4 أرقام</label><input id="nu-pin" name="pin" inputmode="numeric" maxlength="4" autocomplete="off"></div></div>
        <div class="field"><label for="nu-shop">المحل</label><select id="nu-shop" name="shop"><option value="">اختار المحل</option>${S.shops.map(s => `<option value="${s.id}" ${'' === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <p class="err" id="uerr" role="alert"></p><button class="btn primary" ${ui.busy ? 'disabled' : ''}>ضيف</button></form></section>`;
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
function sheet(head, body, cls = ''){
  return `<div class="overlay" data-a="closeModal"><div class="sheet" data-a="noop" role="dialog" aria-modal="true">
    <div class="sh ${cls}">${head}${xBtn}</div><div class="sb">${body}</div></div></div>`;
}
function renderModal(){
  const m = ui.modal; if (!m) return '';
  if (m.kind === 'tx'){
    const T = TYPES[m.type];
    return sheet(`<h2 class="sht"><span class="ic-s">${icon[m.type]}</span>${T.label} ${T.prep}...</h2>`, `<form id="txf" novalidate>
      ${me.role === 'admin' ? `<div class="field"><label for="f-shop">المحل</label><select id="f-shop" name="shop">${S.shops.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label for="pq">الاسم</label><input id="pq" type="search" placeholder="اكتب الاسم أو اختار" autocomplete="off">
        <div id="plist" class="names" role="radiogroup" style="margin-top:4px">${nameOptions('', null)}</div></div>
      <div class="amtbox ${m.type}-t" id="amt" aria-live="polite"><span class="num">${m.amt ? Number(m.amt).toLocaleString('en-US') : '0'}</span> <small>ج.م</small></div>
      <div class="kp">${['1','2','3','4','5','6','7','8','9','00','0','⌫'].map(k => `<button type="button" data-a="kp" data-v="${k}" ${k === '⌫' ? 'aria-label="امسح رقم"' : ''}>${k}</button>`).join('')}</div>
      <details><summary class="muted small">+ ملاحظة</summary><input id="f-note" name="note" autocomplete="off" placeholder="مثلًا: شاحن سامسونج" style="margin-top:8px"></details>
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
  if (m.kind === 'del'){
    const x = S.txs.find(t => t.id === m.id), admin = me.role === 'admin';
    if (!x){ ui.modal = null; return ''; }
    return sheet(`<h2>تمسح الحركة دي؟</h2>`, `<form id="delf">
      <ul class="list" style="box-shadow:none;border:1px solid var(--line)">${item(x, {})}</ul>
      <p class="muted small">${admin ? 'هتتعلّم إنها ممسوحة، وتقدر ترجّعها بعدين.' : 'هتختفي من عندك، بس هشام هيشوف إنك مسحتها.'}</p>
      <div class="field"><label for="d-reason">السبب</label><input id="d-reason" name="reason" placeholder="مثلًا: اتسجلت مرتين" autocomplete="off"></div>
      <button class="btn danger wide">امسح</button></form>`);
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
// touch ripple on buttons
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.act, .btn, .kp button, .pad button, .ubtn, .pick span'); if (!b || calm()) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 1.2, sp = document.createElement('span');
  sp.className = 'ripple'; sp.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.appendChild(sp); setTimeout(() => sp.remove(), 600);
});

/* ---------- render ---------- */
let toastTimer;
function toast(t, undoId){
  ui.toast = {t, undoId}; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = null; document.querySelector('.toast')?.remove(); }, undoId ? 5000 : 2600);
}
let lastView = '', lastSendId = null;
const seen = new Set(), counts = {};
const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
function render(){
  ui.dirty = false;
  const app = document.getElementById('app');
  const view = ui.booting ? 'boot' : !me ? (ui.pinUser ? 'pin' : 'login') : me.role + ':' + (me.role === 'admin' ? ui.tab : 'home');
  const hadModal = !!app.querySelector('.overlay');
  let h = ui.booting ? renderBoot() : !me ? renderLogin() : (me.role === 'admin' ? renderAdmin() : renderCashier());
  h += me ? renderModal() : '';
  if (ui.toast) h += `<div class="toast" role="status">${esc(ui.toast.t)}${ui.toast.undoId ? ` <button class="tbtn" data-a="undo" data-v="${ui.toast.undoId}">تراجع</button>` : ''}</div>`;
  app.innerHTML = h;
  // whole screen slides in when you move to a different screen
  const entering = view !== lastView; lastView = view;
  if (entering) app.querySelectorAll('.band, .wrap, .login .in').forEach(el => el.classList.add('enter'));
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
    if (from !== to) countUp(el, from, to);
  });
  const ov = app.querySelector('.overlay');
  if (ov && hadModal) ov.classList.add('still');
  if (ui.modal?.kind === 'send'){ const k = app.querySelector('.kstep'); if (k && lastSendId && lastSendId !== ui.modal.id) k.classList.add('swap'); lastSendId = ui.modal.id; }
  else lastSendId = null;
  document.querySelector('[data-autofocus]')?.focus({preventScroll:true});
  if (me?.role === 'admin' && ui.tab === 'notes' && S.notes.some(n => !n.read)){
    const ids = S.notes.filter(n => !n.read).map(n => n.id);
    S.notes.forEach(n => n.read = true);
    if (!DEMO) sb.from('notes').update({read:true}).in('id', ids).then(() => {});
  }
}
function formErr(msg, id = 'ferr'){ const e = document.getElementById(id); if (e) e.textContent = msg; }
// For account changes that must be confirmed by the server before showing them.
async function act(fn, opts = {}){
  if (ui.busy) return;
  ui.busy = true;
  const btns = [...document.querySelectorAll('form button')]; btns.forEach(b => b.disabled = true);
  try {
    await fn(); ui.busy = false;
    if (me) await refresh().catch(() => {});
    if (opts.done) opts.done();
    render();
  } catch(e){
    ui.busy = false; btns.forEach(b => b.disabled = false);
    if (document.getElementById(opts.errId || 'ferr')) formErr(errText(e), opts.errId); else { toast(errText(e)); render(); }
  }
}

/* ---------- actions ---------- */
async function doLogin(userId, pin){
  ui.pinBusy = true; render();
  try {
    const tokens = await fnCall({action:'login', user_id:userId, pin});
    const s = must(await sb.auth.setSession(tokens));
    await loadMe(s.user.id);
    ui.pinUser = null; ui.pin = ''; ui.pinErr = ''; ui.tab = 'kenash';
  } catch(e){ ui.pin = ''; ui.pinErr = errText(e); }
  ui.pinBusy = false; render();
  if (ui.pinErr){ const d = document.querySelector('.dots'); if (d) replay(d, 'shake'); try { navigator.vibrate?.([40, 40, 40]); } catch(_){} }
}
const nowIso = () => new Date().toISOString();
const A = {
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
    me = null; ui.modal = null; S = {shops:[], users:[], parties:[], txs:[], notes:[]};
    sb.auth.signOut().finally(() => loadLogin().then(render));
  },
  shop(v){ ui.shopId = v; lsSet('yawmeya-shop', v); },
  type(v){ ui.modal = {kind:'tx', type:v, amt:''}; },
  kp(v){
    const m = ui.modal; let a = m.amt || '';
    if (v === '⌫') a = a.slice(0, -1); else if (a.length < 9) a = (a + v).replace(/^0+/, '');
    m.amt = a;
    const el = document.querySelector('#amt .num'); if (el){ el.textContent = a ? Number(a).toLocaleString('en-US') : '0'; replay(el.parentNode, 'bump'); }
    try { navigator.vibrate?.(8); } catch(e){}
    return false;
  },
  undo(v){
    const t = S.txs.find(x => x.id === v); if (!t || t.deleted) return false;
    ui.toast = null;
    op(() => { t.deleted = {by:me.id, ts:Date.now(), reason:'اتلغت على طول'}; toast('اتلغت'); },
       async () => { while (t.pending) await new Promise(r => setTimeout(r, 150)); must(await sb.rpc('delete_tx', {p_id:t.id, p_reason:'اتلغت على طول'})); });
    return false;
  },
  del(v){ ui.modal = {kind:'del', id:v}; },
  restore(v){ const t = S.txs.find(x => x.id === v), was = t.deleted;
    op(() => { t.deleted = null; t.deleteAck = false; }, async () => must(await sb.from('txs').update({deleted_at:null, deleted_by:null, delete_reason:null, delete_ack:false}).eq('id', v))); return false; },
  tab(v){ ui.tab = v; window.scrollTo(0, 0); },
  kshop(v){ ui.kshop = v; },
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
  askNotify(){ try { Notification.requestPermission().then(() => render()); } catch(e){} return false; }
};

const F = {
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
    const shopId = me.role === 'admin' ? (fd.get('shop') || S.shops[0].id) : ui.shopId;
    const note = String(fd.get('note') || '').trim();
    const tx = {id:uuid(), ts:Date.now(), date:today(), shopId, userId:me.id, type:m.type, partyId, amount, note,
      afterClose:false, deleteAck:false, deleted:null, transferred:false, transferredAt:null, pending:!DEMO};
    op(() => { if (newParty) S.parties.push(newParty); S.txs.push(tx); ui.modal = null; toast(`${TYPES[m.type].label} ${nf(amount)} ✓`, tx.id); try { navigator.vibrate?.(20); } catch(e){} },
      async () => {
        if (newParty) must(await sb.from('parties').insert({id:newParty.id, kind:'customer', name:newParty.name}));
        must(await sb.from('txs').insert({id:tx.id, shop_id:shopId, type:m.type, party_id:partyId, amount, note}));
        tx.pending = false; softRender();
      }, 'الحركة ما اتسجلتش.');
  },
  delf(fd){
    const t = S.txs.find(x => x.id === ui.modal.id), reason = String(fd.get('reason') || '').trim();
    op(() => { t.deleted = {by:me.id, ts:Date.now(), reason}; ui.modal = null; toast('اتمسحت'); },
       async () => must(await sb.rpc('delete_tx', {p_id:t.id, p_reason:reason})), 'ما اتمسحتش.');
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
  shopsf(fd){
    const changes = S.shops.map(s => [s, String(fd.get(s.id) || '').trim()]).filter(([s, n]) => n && n !== s.name);
    op(() => { changes.forEach(([s, n]) => s.name = n); toast('الأسامي اتحفظت'); },
       async () => { for (const [s, n] of changes) must(await sb.from('shops').update({name:n}).eq('id', s.id)); });
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el || el.disabled) return;
  const name = el.dataset.a, fn = A[name]; if (!fn) return;
  if (name !== 'sendOpen' && el.tagName === 'A') e.preventDefault();
  if (fn(el.dataset.v, e) !== false) render();
});
document.addEventListener('change', e => {
  const el = e.target, c = el.dataset.c;
  if (c === 'fshop'){ ui.f.shop = el.value; render(); }
  else if (c === 'ushop'){
    const u = user(el.dataset.u), v = el.value || null;
    op(() => { u.shop_id = v; toast(`${u.name}: ${v ? shop(v).name : 'من غير محل'}`); }, async () => must(await sb.from('profiles').update({shop_id:v}).eq('id', u.id)));
  }
  else if (c === 'fdate'){
    ui.f.date = el.value || today(); render();
    if (ui.f.date < addDays(today(), -45) && !extraDays.has(ui.f.date)) fetchDay(ui.f.date).catch(() => toast('ما قدرتش أجيب اليوم ده'));
  }
  else if (el.name === 'party'){
    const p = el.value === '__new' ? null : party(el.value), pq = document.getElementById('pq');
    if (p && pq) pq.value = p.name;
    document.activeElement?.blur?.();
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'pq'){
    const pl = document.getElementById('plist'), sel = pl.querySelector('input:checked')?.value || null;
    pl.innerHTML = nameOptions(e.target.value, sel === '__new' ? null : sel);
  }
});
document.addEventListener('submit', e => { e.preventDefault(); const fn = F[e.target.id]; if (fn) fn(new FormData(e.target)); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.modal){ ui.modal = null; render(); }
  if (!me && ui.pinUser && /^\d$/.test(e.key)){ if (A.pin(e.key) !== false) render(); }
});
document.addEventListener('focusout', () => setTimeout(() => { if (ui.dirty && !ui.modal) softRender(); }, 50));
window.addEventListener('online', () => { ui.offline = false; if (me) refresh().then(render).catch(() => {}); else loadLogin().then(render); });
window.addEventListener('offline', () => { ui.offline = true; render(); });
// Catch up on anything missed while the phone was asleep.
document.addEventListener('visibilitychange', () => { if (!document.hidden && me && !DEMO) refresh().then(softRender).catch(() => {}); });
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
  S = {shops, users, parties, txs, notes};
  me = users.find(u => u.role === (role === 'admin' ? 'admin' : 'cashier'));
  ui.shopId = 's1';
}

(async function boot(){
  if (DEMO){ demoData(DEMO); ui.booting = false; render(); return; }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  try {
    const {data:{session}} = await sb.auth.getSession();
    if (session) await loadMe(session.user.id);
    if (!me) await loadLogin();
  } catch(e){ ui.offline = !navigator.onLine; }
  ui.booting = false; render();
})();
