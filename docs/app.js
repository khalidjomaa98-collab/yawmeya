'use strict';
const CFG = window.YAWMEYA_CONFIG;
const sb = supabase.createClient(CFG.url, CFG.key, {auth:{persistSession:true, autoRefreshToken:true, storageKey:'yawmeya-auth'}});

// Same two actions as Konnash: أخدت = money came in from the person, أعطيت = given to the person.
const TYPES = {
  took:{label:'أخدت', prep:'من', sign:'+'},
  gave:{label:'أعطيت', prep:'لـ', sign:'−'}
};
const PIN_LEN = {admin:6, cashier:4};
const KONNASH_OPEN = `intent://#Intent;package=${CFG.konnashPackage};S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=' + CFG.konnashPackage)};end`;

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const latin = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const nf = n => (Math.round(n * 100) / 100).toLocaleString('en-US');
const money = n => `<span class="num">${nf(n)}</span> ج.م`;
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
function tm(ts){
  const d = new Date(ts); let h = d.getHours(); const ap = h < 12 ? 'ص' : 'م'; h = h % 12 || 12;
  return `${h}:${z(d.getMinutes())} ${ap}`;
}
const lsGet = k => { try { return localStorage.getItem(k); } catch(e){ return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch(e){} };
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const norm = s => String(s || '').trim().replace(/\s+/g, ' ').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

/* ---------- state ---------- */
let S = {shops:[], users:[], parties:[], txs:[], closures:[], notes:[]};
let me = null;
const ui = {booting:true, busy:false, loginUsers:[], needsSetup:false, pinUser:null, pin:'', pinErr:'',
  shopId:lsGet('yawmeya-shop'), tab:'kenash', kshop:'all', f:{shop:'all', date:today()},
  modal:null, toast:null, dirty:false, offline:!navigator.onLine, installEvt:null};

const user = id => S.users.find(u => u.id === id);
const shop = id => S.shops.find(s => s.id === id);
const party = id => S.parties.find(p => p.id === id);
const closureOf = (shopId, date) => S.closures.find(c => c.shopId === shopId && c.date === date);
const live = t => !t.deleted;
const pname = t => party(t.partyId)?.name || '—';
const pendingList = () => S.txs.filter(t => live(t) && !t.transferred && (ui.kshop === 'all' || t.shopId === ui.kshop)).sort((a, b) => a.ts - b.ts);

function totals(list){
  const r = {took:0, gave:0, count:0};
  list.filter(live).forEach(t => { r[t.type] += t.amount; r.count++; });
  return r;
}
const dayList = (shopId, date) => S.txs.filter(t => t.shopId === shopId && t.date === date);

/* ---------- data ---------- */
const mapTx = r => ({id:r.id, ts:Date.parse(r.ts), date:r.day, shopId:r.shop_id, userId:r.user_id, type:r.type, partyId:r.party_id,
  amount:Number(r.amount), note:r.note || '', afterClose:r.after_close, deleteAck:r.delete_ack,
  deleted:r.deleted_at ? {by:r.deleted_by, ts:Date.parse(r.deleted_at), reason:r.delete_reason} : null,
  transferred:!!r.transferred_at, transferredAt:r.transferred_at ? Date.parse(r.transferred_at) : null});
const mapClosure = r => ({id:r.id, shopId:r.shop_id, date:r.day, userId:r.user_id, ts:Date.parse(r.ts)});
const extraDays = new Set();
function must(res){ if (res.error) throw res.error; return res.data; }

async function refresh(){
  const admin = me.role === 'admin', t = today(), from = addDays(t, -45);
  const txq = sb.from('txs').select('*').order('ts', {ascending:false}).limit(5000);
  const [shops, users, parties, closures, txs, notes] = await Promise.all([
    sb.from('shops').select('*').order('sort'),
    sb.from('profiles').select('id,name,role,active,created_at').order('created_at'),
    sb.from('parties').select('id,name,phone').order('name'),
    sb.from('closures').select('*').gte('day', admin ? from : t),
    admin ? txq.or(`day.gte.${from},and(transferred_at.is.null,deleted_at.is.null),and(deleted_at.not.is.null,transferred_at.not.is.null,delete_ack.is.false)`) : txq.eq('day', t),
    admin ? sb.from('notes').select('*').order('ts', {ascending:false}).limit(80) : Promise.resolve({data:[]})
  ]);
  S.shops = must(shops);
  S.users = must(users);
  S.parties = must(parties);
  S.closures = must(closures).map(mapClosure);
  S.txs = must(txs).map(mapTx);
  S.notes = must(notes).map(n => ({id:n.id, ts:Date.parse(n.ts), text:n.text, kind:n.kind, read:n.read}));
  for (const d of extraDays) await fetchDay(d, false);
  if (!shop(ui.shopId)) ui.shopId = S.shops[0]?.id || null;
}
async function fetchDay(d, rerender = true){
  extraDays.add(d);
  const [txs, cl] = await Promise.all([sb.from('txs').select('*').eq('day', d), sb.from('closures').select('*').eq('day', d)]);
  const have = new Set(S.txs.map(t => t.id));
  must(txs).map(mapTx).forEach(t => { if (!have.has(t.id)) S.txs.push(t); });
  const hc = new Set(S.closures.map(c => c.id));
  must(cl).map(mapClosure).forEach(c => { if (!hc.has(c.id)) S.closures.push(c); });
  if (rerender) render();
}

let chan = null, rtTimer = null, lastNoteTs = 0;
function subscribe(){
  if (chan) sb.removeChannel(chan);
  chan = sb.channel('yawmeya-live');
  for (const table of ['txs', 'notes', 'closures', 'parties']) chan.on('postgres_changes', {event:'*', schema:'public', table}, scheduleRefresh);
  chan.subscribe();
}
function scheduleRefresh(){
  clearTimeout(rtTimer);
  rtTimer = setTimeout(async () => {
    if (!me) return;
    try { await refresh(); } catch(e){ return; }
    notifyDevice();
    softRender();
  }, 350);
}
function notifyDevice(){
  if (me?.role !== 'admin') return;
  const fresh = S.notes.filter(n => !n.read && n.ts > lastNoteTs);
  if (S.notes[0]) lastNoteTs = Math.max(lastNoteTs, S.notes[0].ts);
  if (!fresh.length || !document.hidden) return;
  try {
    if ('Notification' in window && Notification.permission === 'granted')
      fresh.slice(0, 3).forEach(n => new Notification('اليومية', {body:n.text, tag:n.id, icon:'icons/icon-192.png'}));
  } catch(e){}
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
  if (r.data && r.data.active){
    me = r.data;
    await refresh();
    lastNoteTs = S.notes[0]?.ts || 0;
    subscribe();
  } else {
    me = null; await sb.auth.signOut();
  }
}
async function fnCall(body){
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
  if (m.includes('DAY_CLOSED')) return 'يومية المحل ده اتقفلت. كلّم هشام يفتحها.';
  if (m.includes('PARTY_REQUIRED')) return 'اكتب الاسم الأول.';
  if (m === 'wrong') return 'الرقم غلط، جرّب تاني.';
  if (m === 'locked') return 'اتكتب رقم غلط كتير. استنى 10 دقايق وجرّب تاني.';
  if (m === 'admin_pin') return 'رقم المدير لازم يكون 6 أرقام.';
  if (m === 'pin') return 'الرقم السري لازم يكون 4 أرقام.';
  if (m === 'forbidden') return 'الحركة دي لهشام بس.';
  if (/fetch|network|Failed/i.test(m) || !navigator.onLine) return 'مفيش نت. اتأكد من الاتصال وجرّب تاني.';
  return 'حصلت مشكلة، جرّب تاني.';
}

/* ---------- pieces ---------- */
function topbar(){
  const where = me.role === 'admin' ? 'المدير' : esc(shop(ui.shopId)?.name || '');
  return `<header class="top"><div class="in">
    <div class="me">${esc(me.name)} <small>· ${where}</small></div>
    ${ui.installEvt ? `<button class="btn sm" data-a="install">سطّب</button>` : ''}
    <button class="btn sm" data-a="logout">خروج</button></div></header>
    ${ui.offline ? `<div class="offline">مفيش نت دلوقتي. الحركات مش هتتسجل لحد ما النت يرجع.</div>` : ''}`;
}
// One line per entry: name and amount on top, time/note/who underneath.
function item(x, o = {}){
  const T = TYPES[x.type];
  const sub = [];
  if (o.date) sub.push(dayLabel(x.date));
  sub.push(tm(x.ts));
  if (o.shop) sub.push(esc(shop(x.shopId)?.name));
  if (o.who) sub.push(esc(user(x.userId)?.name));
  if (x.note) sub.push(esc(x.note));
  let side = o.side || '';
  if (o.mine && x.userId === me.id && !x.deleted) side = `<button class="btn link small" data-a="del" data-v="${x.id}">امسح</button>`;
  const flags = [];
  if (x.deleted) flags.push(`اتمسحت بواسطة ${esc(user(x.deleted.by)?.name)}${x.deleted.reason ? ': ' + esc(x.deleted.reason) : ''}`);
  if (o.admin && x.afterClose) flags.push('اتسجلت بعد الإقفال');
  return `<li class="item ${x.deleted ? 'del' : ''} ${o.tap ? 'tap' : ''}" ${o.tap ? `data-a="${o.tap}" data-v="${x.id}"` : ''}>
    <div class="who"><span class="chip ${x.type}">${T.label}</span>${esc(pname(x))}</div>
    <div class="amt ${x.type}-t">${money(x.amount)}</div>
    <div class="sub">${sub.join(' · ')}${flags.length ? `<div class="flag">${flags.join(' · ')}</div>` : ''}</div>
    ${side ? `<div class="side">${side}</div>` : ''}</li>`;
}
function totalsBox(r){
  return `<div class="totals"><div><small>أخدت</small><b class="took-t">${money(r.took)}</b></div><div><small>أعطيت</small><b class="gave-t">${money(r.gave)}</b></div></div>`;
}
function navIcon(n){
  const p = {
    kenash:'<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
    txs:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    notes:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    set:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>'
  }[n];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
const xBtn = `<button type="button" class="x" data-a="closeModal" aria-label="إغلاق">×</button>`;
const shopSeg = (cur, action, all) => S.shops.length < 2 && !all ? '' :
  `<div class="seg">${[...(all ? [['all', 'المحلين']] : []), ...S.shops.map(s => [s.id, s.name])].map(([id, n]) => `<button class="${cur === id ? 'on' : ''}" data-a="${action}" data-v="${id}">${esc(n)}</button>`).join('')}</div>`;

/* ---------- screens ---------- */
const renderBoot = () => `<main class="login"><h1>اليومية</h1><p class="muted">بيحمّل...</p></main>`;

function renderSetup(){
  return `<main class="login"><h1>أول تشغيل: حساب المدير</h1>
    <p class="muted">الحساب ده لهشام. منه هيضيف الكاشيرية ويتابع الحركات. رقم المدير 6 أرقام.</p>
    <form id="setupf" class="card">
      <div class="field"><label for="su-name">الاسم</label><input id="su-name" name="name" value="هشام" autocomplete="off"></div>
      <div class="field"><label for="su-pin">رقم سري من 6 أرقام</label><input id="su-pin" name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <div class="field"><label for="su-pin2">اكتبه تاني</label><input id="su-pin2" name="pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <p id="ferr" class="err" role="alert"></p>
      <button class="btn primary wide" ${ui.busy ? 'disabled' : ''}>اعمل الحساب وادخل</button></form></main>`;
}
function renderLogin(){
  if (ui.needsSetup) return renderSetup();
  if (!ui.pinUser){
    return `<main class="login"><h1>مين بيسجل دلوقتي؟</h1>
      ${ui.loginUsers.length ? `<div class="ugrid">${ui.loginUsers.map(u => `<button class="ubtn" data-a="pickUser" data-v="${u.id}">${esc(u.name)}</button>`).join('')}</div>`
        : `<p class="empty">${ui.offline ? 'مفيش نت. اتأكد من الاتصال.' : 'مفيش حسابات لسه.'}</p>`}
      ${ui.installEvt ? `<button class="btn" data-a="install">سطّب البرنامج على الموبايل</button>` : ''}</main>`;
  }
  const u = ui.loginUsers.find(x => x.id === ui.pinUser), len = PIN_LEN[u.role];
  return `<main class="login">
    <button class="btn link" data-a="loginBack" style="align-self:flex-start">→ رجوع</button>
    <h1>${esc(u.name)}، اكتب الرقم السري</h1>
    <div class="dots ${ui.pinErr ? 'bad' : ''}" aria-label="${ui.pin.length} من ${len}">${Array.from({length:len}, (_, i) => `<span class="${i < ui.pin.length ? 'f' : ''}"></span>`).join('')}</div>
    <p class="err" role="alert" style="text-align:center">${ui.busy ? '<span class="muted">بيتأكد...</span>' : esc(ui.pinErr)}</p>
    <div class="pad">${[1,2,3,4,5,6,7,8,9].map(n => `<button data-a="pin" data-v="${n}" ${ui.busy ? 'disabled' : ''}>${n}</button>`).join('')}
      <button data-a="pinBack" aria-label="امسح رقم">⌫</button><button data-a="pin" data-v="0" ${ui.busy ? 'disabled' : ''}>0</button><span></span></div></main>`;
}

function renderCashier(){
  const t = today(), s = shop(ui.shopId);
  if (!s) return `${topbar()}<main class="wrap"><p class="empty">مفيش محلات متسجلة.</p></main>`;
  const cl = closureOf(s.id, t);
  const list = dayList(s.id, t).filter(live).sort((a, b) => b.ts - a.ts);
  return `${topbar()}<main class="wrap">
    ${shopSeg(ui.shopId, 'shop')}
    ${cl ? `<div class="banner warn">اليومية اتقفلت الساعة ${tm(cl.ts)}. لو محتاج تسجل حاجة، كلّم هشام يفتحها.</div>` : ''}
    <div class="big2">
      <button class="bigbtn took" data-a="type" data-v="took" ${cl ? 'disabled' : ''}>أخدت<small>فلوس دخلت من حد</small></button>
      <button class="bigbtn gave" data-a="type" data-v="gave" ${cl ? 'disabled' : ''}>أعطيت<small>فلوس أو بضاعة لحد</small></button>
    </div>
    ${totalsBox(totals(list))}
    <section><div class="head"><h2>النهارده</h2><span class="muted small">${list.length} حركة</span></div>
      ${list.length ? `<ul class="list">${list.map(x => item(x, {mine:true})).join('')}</ul>` : `<p class="empty">لسه مفيش حركات النهارده.</p>`}
    </section>
    ${cl ? '' : `<button class="btn wide" data-a="closeDay" ${list.length ? '' : 'disabled'}>اقفل يومية النهارده</button>`}
  </main>`;
}

function renderAdmin(){
  const pending = S.txs.filter(t => live(t) && !t.transferred).length + S.txs.filter(t => t.deleted && t.transferred && !t.deleteAck).length;
  const unread = S.notes.filter(n => !n.read).length;
  const tabs = [['kenash','كناش',pending],['txs','الحركات',0],['notes','الإشعارات',unread],['set','الإعدادات',0]];
  const body = {kenash:tabKenash, txs:tabTxs, notes:tabNotes, set:tabSet}[ui.tab]();
  return `${topbar()}<main class="wrap admin">${body}</main>
    <nav class="nav" aria-label="الأقسام"><div class="in">${tabs.map(([k, l, n]) => `<button class="${ui.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}" ${ui.tab === k ? 'aria-current="page"' : ''}>${navIcon(k)}${l}${n ? `<span class="badge">${n}</span>` : ''}</button>`).join('')}</div></nav>`;
}
function tabKenash(){
  const pend = pendingList();
  const alerts = S.txs.filter(t => t.deleted && t.transferred && !t.deleteAck);
  const recent = S.txs.filter(t => live(t) && t.transferred && t.transferredAt).sort((a, b) => b.transferredAt - a.transferredAt).slice(0, 6);
  const days = [...new Set(pend.map(t => t.date))];
  return `<section><div class="head"><h2>لسه ما اتنقلش لكناش</h2><span class="muted small">${pend.length} حركة</span></div>
    ${shopSeg(ui.kshop, 'kshop', true)}
    ${pend.length ? `<button class="btn primary wide" data-a="send" data-v="${pend[0].id}">ابدأ النقل (${pend.length})</button>` : ''}</section>
    ${alerts.length ? `<section><h2 class="gave-t">امسحها من كناش</h2>
      <p class="muted small">الحركات دي اتنقلت لكناش وبعدين اتمسحت هنا.</p>
      <ul class="list">${alerts.map(x => item(x, {shop:true, date:true, who:true, side:`<button class="btn sm" data-a="ack" data-v="${x.id}">مسحتها</button>`})).join('')}</ul></section>` : ''}
    <section>${pend.length ? days.map(d => `<div class="dayhead">${dayLabel(d)}</div><ul class="list">${pend.filter(t => t.date === d).map(x => item(x, {tap:'send', shop:ui.kshop === 'all', who:true})).join('')}</ul>`).join('')
      : `<p class="empty">كل الحركات اتنقلت لكناش.</p>`}</section>
    ${recent.length ? `<section><h2>آخر اللي اتنقل</h2>
      <ul class="list">${recent.map(x => item(x, {date:true, side:`<button class="btn link small" data-a="untransfer" data-v="${x.id}">رجّعها</button>`})).join('')}</ul></section>` : ''}`;
}
function tabTxs(){
  const f = ui.f;
  const list = S.txs.filter(t => (f.shop === 'all' || t.shopId === f.shop) && t.date === f.date).sort((a, b) => b.ts - a.ts);
  const shops = f.shop === 'all' ? S.shops : [shop(f.shop)];
  return `<section><div class="head"><h2>الحركات</h2><button class="btn sm" data-a="copyTxs" ${list.length ? '' : 'disabled'}>نسخ للإكسل</button></div>
    <div class="row2">
      <div class="field"><label for="fdate">اليوم</label><input type="date" id="fdate" data-c="fdate" value="${f.date}" max="${today()}"></div>
      <div class="field"><label for="fshop">المحل</label><select id="fshop" data-c="fshop"><option value="all">المحلين</option>${S.shops.map(s => `<option value="${s.id}" ${f.shop === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
    </div></section>
    ${shops.map(s => {
      const cl = closureOf(s.id, f.date);
      return `<section><div class="head"><h3>${esc(s.name)}</h3>
        ${cl ? `<span class="muted small">اتقفلت ${tm(cl.ts)} · <button class="btn link small" data-a="reopen" data-v="${cl.id}">افتحها</button></span>` : `<span class="muted small">مفتوحة</span>`}</div>
        ${totalsBox(totals(dayList(s.id, f.date)))}</section>`;
    }).join('')}
    <section>${list.length ? `<ul class="list">${list.map(x => item(x, {shop:f.shop === 'all', who:true, admin:true,
        side:x.deleted ? `<button class="btn link small" data-a="restore" data-v="${x.id}">رجّعها</button>` : `<button class="btn link small" data-a="del" data-v="${x.id}">امسح</button>`})).join('')}</ul>`
      : `<p class="empty">مفيش حركات في اليوم ده.</p>`}</section>`;
}
function tabNotes(){
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `<section><h2>الإشعارات</h2>
    ${perm === 'default' ? `<div class="banner"><p style="margin-bottom:8px">فعّل الإشعارات علشان توصلك والبرنامج في الخلفية.</p><button class="btn sm primary" data-a="askNotify">فعّل</button></div>` : ''}
    ${S.notes.length ? `<ul class="list">${S.notes.map(n => `<li class="item"><div class="who" style="font-weight:${n.read ? 400 : 700}">${esc(n.text)}</div><div class="sub">${dayLabel(dayOf(n.ts))} · ${tm(n.ts)}</div></li>`).join('')}</ul>` : `<p class="empty">مفيش إشعارات لسه.</p>`}</section>`;
}
function tabSet(){
  return `<section><h2>المحلات</h2><form id="shopsf" class="card">${S.shops.map(s => `<div class="field"><label for="s_${s.id}">اسم المحل</label><input id="s_${s.id}" name="${s.id}" value="${esc(s.name)}"></div>`).join('')}<button class="btn">احفظ الأسامي</button></form></section>
    <section><h2>الكاشيرية</h2><ul class="list">${S.users.map(u => `<li class="item"><div class="who">${esc(u.name)}</div>
      <div class="sub">${u.role === 'admin' ? 'المدير' : 'كاشير'}${u.active ? '' : ' · موقوف'}</div>
      <div class="side" style="grid-row:1/3;grid-column:2;gap:6px;flex-wrap:wrap">
        <button class="btn sm" data-a="chPin" data-v="${u.id}">الرقم السري</button>
        ${u.role !== 'admin' ? `<button class="btn sm" data-a="toggleUser" data-v="${u.id}">${u.active ? 'وقّف' : 'شغّل'}</button>` : ''}</div></li>`).join('')}</ul>
      <form id="userf" class="card"><h3>ضيف كاشير</h3><div class="row2">
        <div class="field"><label for="nu-name">الاسم</label><input id="nu-name" name="name" autocomplete="off"></div>
        <div class="field"><label for="nu-pin">رقم سري 4 أرقام</label><input id="nu-pin" name="pin" inputmode="numeric" maxlength="4" autocomplete="off"></div></div>
        <p class="err" id="uerr" role="alert"></p><button class="btn primary" ${ui.busy ? 'disabled' : ''}>ضيف</button></form></section>
    <section><h2>الأسماء</h2><p class="muted small">الكاشير بيضيف الأسماء الجديدة وهو بيسجل. ${S.parties.length} اسم متسجل.</p></section>`;
}

/* ---------- modals ---------- */
function nameOptions(q, sel){
  const nq = norm(q);
  const ps = S.parties.filter(p => !nq || norm(p.name).includes(nq) || (p.phone || '').includes(latin(q).trim())).slice(0, 40);
  const exact = nq && S.parties.some(p => norm(p.name) === nq);
  let h = ps.map(p => `<label class="opt"><input type="radio" name="party" value="${p.id}" ${sel === p.id ? 'checked' : ''}>${esc(p.name)}</label>`).join('');
  if (nq && !exact) h += `<label class="opt new"><input type="radio" name="party" value="__new" ${sel === '__new' ? 'checked' : ''}>+ ضيف "${esc(q.trim())}"</label>`;
  if (!h) h = `<p class="muted small">اكتب الاسم فوق.</p>`;
  return h;
}
function renderModal(){
  const m = ui.modal; if (!m) return '';
  let b = '';
  if (m.kind === 'tx'){
    const T = TYPES[m.type];
    b = `<form id="txf" novalidate>
      <div class="shead ${m.type}"><h2>${T.label} ${T.prep === 'لـ' ? 'لـ...' : 'من...'}</h2>${xBtn}</div>
      ${me.role === 'admin' ? `<div class="field"><label for="f-shop">المحل</label><select id="f-shop" name="shop">${S.shops.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label for="pq">الاسم</label>
        <input id="pq" type="search" placeholder="اكتب الاسم" autocomplete="off" data-autofocus>
        <div id="plist" class="names" role="radiogroup">${nameOptions('', null)}</div></div>
      <div class="field"><label for="f-amount">المبلغ</label><input id="f-amount" name="amount" class="amount" inputmode="decimal" autocomplete="off" placeholder="0"></div>
      <div class="field"><label for="f-note">ملاحظة (اختياري)</label><input id="f-note" name="note" autocomplete="off"></div>
      <p id="ferr" class="err" role="alert"></p>
      <button class="btn ${m.type} wide">سجّل</button></form>`;
  }
  else if (m.kind === 'send'){
    const x = S.txs.find(t => t.id === m.id);
    if (!x){ ui.modal = null; return ''; }
    const T = TYPES[x.type], left = pendingList().length;
    b = `<div class="shead"><h3 class="muted">نقل لكناش${left ? ` · فاضل ${left}` : ''}</h3>${xBtn}</div>
      <div class="kstep">
        <div class="muted small">1. في كناش افتح</div>
        <div class="name">${esc(pname(x))}</div>
        <div class="press muted small">2. اضغط <b class="${x.type}">${T.label}</b> واكتب</div>
        <div class="bignum num ${x.type}-t">${nf(x.amount)}</div>
        ${x.note ? `<div class="note">ملاحظة: ${esc(x.note)}</div>` : ''}
        <div class="muted small">${dayLabel(x.date)} ${tm(x.ts)} · ${esc(shop(x.shopId)?.name)} · ${esc(user(x.userId)?.name)}</div>
      </div>
      <a class="btn primary wide" href="${KONNASH_OPEN}" data-a="sendOpen">افتح كناش</a>
      <button class="btn took wide" data-a="sendDone">اتسجلت${left > 1 ? '، اللي بعدها' : ''}</button>`;
  }
  else if (m.kind === 'del'){
    const x = S.txs.find(t => t.id === m.id), admin = me.role === 'admin';
    if (!x){ ui.modal = null; return ''; }
    b = `<form id="delf"><div class="shead"><h2>تمسح الحركة دي؟</h2>${xBtn}</div>
      <ul class="list">${item(x, {})}</ul>
      <p class="muted small">${admin ? 'هتتعلّم إنها ممسوحة، وتقدر ترجّعها بعدين.' : 'هتختفي من عندك، بس هشام هيشوف إنك مسحتها.'}</p>
      <div class="field"><label for="d-reason">السبب</label><input id="d-reason" name="reason" placeholder="مثلًا: اتسجلت مرتين" autocomplete="off" data-autofocus></div>
      <p id="ferr" class="err" role="alert"></p>
      <button class="btn danger wide" ${ui.busy ? 'disabled' : ''}>امسح</button></form>`;
  }
  else if (m.kind === 'closeDay'){
    b = `<div class="shead"><h2>اقفل يومية ${esc(shop(ui.shopId).name)}</h2>${xBtn}</div>
      ${totalsBox(totals(dayList(ui.shopId, today())))}
      <p class="muted small">بعد الإقفال مش هتقدر تسجل تاني النهارده في المحل ده إلا لو هشام فتحها.</p>
      <button class="btn primary wide" data-a="confirmClose" ${ui.busy ? 'disabled' : ''}>اقفل</button>`;
  }
  else if (m.kind === 'pin'){
    const u = user(m.id), len = PIN_LEN[u.role];
    b = `<form id="pinf"><div class="shead"><h2>رقم سري جديد لـ${esc(u.name)}</h2>${xBtn}</div>
      <div class="field"><label for="pn-pin">${len} أرقام</label><input id="pn-pin" name="pin" type="password" inputmode="numeric" maxlength="${len}" autocomplete="new-password" data-autofocus></div>
      <p id="ferr" class="err" role="alert"></p><button class="btn primary wide" ${ui.busy ? 'disabled' : ''}>احفظ</button></form>`;
  }
  else if (m.kind === 'copy'){
    b = `<div class="shead"><h2>انسخ النص</h2>${xBtn}</div>
      <p class="muted small">النص متعلّم. اضغط مطوّل واختار نسخ.</p>
      <textarea id="copybox" rows="8" readonly dir="auto">${esc(m.text)}</textarea>`;
  }
  return `<div class="overlay" data-a="closeModal"><div class="sheet" data-a="noop" role="dialog" aria-modal="true">${b}</div></div>`;
}

/* ---------- render ---------- */
let toastTimer;
function toast(t){
  ui.toast = t; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = null; document.querySelector('.toast')?.remove(); }, 2600);
}
function render(){
  ui.dirty = false;
  const app = document.getElementById('app');
  let h = ui.booting ? renderBoot() : !me ? renderLogin() : (me.role === 'admin' ? renderAdmin() : renderCashier());
  h += me ? renderModal() : '';
  if (ui.toast) h += `<div class="toast" role="status">${esc(ui.toast)}</div>`;
  app.innerHTML = h;
  document.querySelector('[data-autofocus]')?.focus({preventScroll:true});
  const cb = document.getElementById('copybox'); if (cb){ cb.focus(); cb.select(); }
  if (me?.role === 'admin' && ui.tab === 'notes' && S.notes.some(n => !n.read)){
    const ids = S.notes.filter(n => !n.read).map(n => n.id);
    S.notes.forEach(n => n.read = true);
    sb.from('notes').update({read:true}).in('id', ids).then(() => {});
  }
}
function copyText(text){
  try {
    navigator.clipboard.writeText(text).then(() => { toast('اتنسخ'); render(); }, () => { ui.modal = {kind:'copy', text}; render(); });
  } catch(e){ ui.modal = {kind:'copy', text}; render(); }
}
function tsv(list){
  const head = ['التاريخ','الوقت','المحل','النوع','الاسم','المبلغ','ملاحظة','سجّلها'];
  const rows = list.map(t => [t.date, tm(t.ts), shop(t.shopId)?.name, TYPES[t.type].label, pname(t), t.amount, t.note, user(t.userId)?.name]
    .map(v => String(v ?? '').replace(/[\t\n]/g, ' ')).join('\t'));
  return [head.join('\t'), ...rows].join('\n');
}
function formErr(msg, id = 'ferr'){ const e = document.getElementById(id); if (e) e.textContent = msg; }

// Forms pass rerender:false so a failed save keeps what was typed.
async function act(fn, opts = {}){
  if (ui.busy) return;
  ui.busy = true;
  const keep = opts.rerender === false, btns = keep ? [...document.querySelectorAll('form button')] : [];
  if (keep) btns.forEach(b => b.disabled = true); else render();
  try {
    await fn();
    ui.busy = false;
    if (me) await refresh().catch(() => {});
    if (opts.done) opts.done();
    render();
  } catch(e){
    ui.busy = false;
    const msg = errText(e);
    if (keep && document.getElementById(opts.errId || 'ferr')){ btns.forEach(b => b.disabled = false); formErr(msg, opts.errId); }
    else { toast(msg); render(); }
  }
}

/* ---------- actions ---------- */
async function doLogin(userId, pin){
  ui.busy = true; render();
  try {
    const tokens = await fnCall({action:'login', user_id:userId, pin});
    must(await sb.auth.setSession(tokens));
    const {data:{user:u}} = await sb.auth.getUser();
    await loadMe(u.id);
    ui.pinUser = null; ui.pin = ''; ui.pinErr = ''; ui.tab = 'kenash';
  } catch(e){
    ui.pin = ''; ui.pinErr = errText(e);
  }
  ui.busy = false; render();
}

const A = {
  noop(){ return false; },
  closeModal(){ ui.modal = null; },
  install(){ const e = ui.installEvt; ui.installEvt = null; if (e) e.prompt(); },
  pickUser(v){ ui.pinUser = v; ui.pin = ''; ui.pinErr = ''; },
  loginBack(){ ui.pinUser = null; ui.pinErr = ''; },
  pinBack(){ ui.pin = ui.pin.slice(0, -1); ui.pinErr = ''; },
  pin(v){
    if (ui.busy) return false;
    const u = ui.loginUsers.find(x => x.id === ui.pinUser), len = PIN_LEN[u.role];
    ui.pinErr = ''; ui.pin += v;
    if (ui.pin.length >= len){ doLogin(u.id, ui.pin); return false; }
  },
  logout(){
    act(async () => {
      if (chan){ sb.removeChannel(chan); chan = null; }
      await sb.auth.signOut();
      me = null; ui.modal = null; S = {shops:[], users:[], parties:[], txs:[], closures:[], notes:[]};
      await loadLogin();
    });
    return false;
  },
  shop(v){ ui.shopId = v; lsSet('yawmeya-shop', v); },
  type(v){ ui.modal = {kind:'tx', type:v}; },
  del(v){ ui.modal = {kind:'del', id:v}; },
  restore(v){ act(async () => must(await sb.from('txs').update({deleted_at:null, deleted_by:null, delete_reason:null, delete_ack:false}).eq('id', v)), {done:() => toast('رجعت الحركة')}); return false; },
  closeDay(){ ui.modal = {kind:'closeDay'}; },
  confirmClose(){ act(async () => must(await sb.rpc('close_day', {p_shop:ui.shopId})), {done:() => { ui.modal = null; toast('اليومية اتقفلت'); }}); return false; },
  reopen(v){ act(async () => must(await sb.from('closures').delete().eq('id', v)), {done:() => toast('اليومية اتفتحت تاني')}); return false; },
  tab(v){ ui.tab = v; window.scrollTo(0, 0); },
  kshop(v){ ui.kshop = v; },
  copyTxs(){ copyText(tsv(S.txs.filter(t => (ui.f.shop === 'all' || t.shopId === ui.f.shop) && t.date === ui.f.date && live(t)).sort((a, b) => a.ts - b.ts))); return false; },
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
    const id = ui.modal.id;
    act(async () => must(await sb.from('txs').update({transferred_at:new Date().toISOString()}).eq('id', id)), {done:() => {
      const next = pendingList()[0];
      ui.modal = next ? {kind:'send', id:next.id} : null;
      toast(next ? 'تمام، دي اللي بعدها' : 'كل الحركات اتنقلت لكناش');
    }});
    return false;
  },
  untransfer(v){ act(async () => must(await sb.from('txs').update({transferred_at:null}).eq('id', v)), {done:() => toast('رجعت لقايمة كناش')}); return false; },
  ack(v){ act(async () => must(await sb.from('txs').update({delete_ack:true}).eq('id', v))); return false; },
  toggleUser(v){
    const u = user(v);
    act(async () => fnCall({action:'set_active', user_id:v, active:!u.active}), {done:() => toast(u.active ? `حساب ${u.name} اتوقف` : `حساب ${u.name} اتشغّل`)});
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
      must(await sb.auth.setSession(tokens));
      const {data:{user:u}} = await sb.auth.getUser();
      ui.needsSetup = false;
      await loadMe(u.id);
      ui.tab = 'set'; toast('الحساب اتعمل. ضيف الكاشيرية من هنا.');
    } catch(e){ ui.busy = false; render(); return formErr(errText(e)); }
    ui.busy = false; render();
  },
  txf(fd){
    const m = ui.modal;
    const amount = parseFloat(latin(fd.get('amount')).replace(/[,٬\s]/g, '').replace('٫', '.'));
    const v = fd.get('party'), typed = String(document.getElementById('pq').value || '').trim().replace(/\s+/g, ' ');
    let partyId = v && v !== '__new' ? v : null, newName = null;
    if (!partyId){
      // typed a name without tapping it: use the existing one if it matches, otherwise add it
      const hit = typed && S.parties.find(p => norm(p.name) === norm(typed));
      if (hit) partyId = hit.id; else if (typed) newName = typed;
      else return formErr('اكتب الاسم.');
    }
    if (!(amount > 0)) return formErr('اكتب المبلغ بالأرقام.');
    const shopId = me.role === 'admin' ? (fd.get('shop') || S.shops[0].id) : ui.shopId;
    const row = {shop_id:shopId, type:m.type, amount, note:String(fd.get('note') || '').trim()};
    act(async () => {
      if (newName){
        const id = crypto.randomUUID();
        must(await sb.from('parties').insert({id, kind:'customer', name:newName}));
        partyId = id;
      }
      must(await sb.from('txs').insert({...row, party_id:partyId}));
    }, {rerender:false, done:() => { ui.modal = null; toast('اتسجلت'); }});
  },
  delf(fd){
    const id = ui.modal.id, reason = String(fd.get('reason') || '').trim();
    act(async () => must(await sb.rpc('delete_tx', {p_id:id, p_reason:reason})), {rerender:false, done:() => { ui.modal = null; toast('اتمسحت'); }});
  },
  pinf(fd){
    const u = user(ui.modal.id), len = PIN_LEN[u.role], pin = latin(fd.get('pin')).trim();
    if (!new RegExp(`^\\d{${len}}$`).test(pin)) return formErr(`الرقم السري لازم يكون ${len} أرقام.`);
    act(async () => fnCall({action:'set_pin', user_id:u.id, pin}), {rerender:false, done:() => { ui.modal = null; toast('الرقم السري اتغيّر'); }});
  },
  userf(fd){
    const name = String(fd.get('name') || '').trim(), pin = latin(fd.get('pin')).trim();
    if (!name) return formErr('اكتب اسم الكاشير.', 'uerr');
    if (!/^\d{4}$/.test(pin)) return formErr('الرقم السري لازم يكون 4 أرقام.', 'uerr');
    act(async () => fnCall({action:'create_user', name, pin}), {rerender:false, errId:'uerr', done:() => toast(`${name} اتضاف`)});
  },
  shopsf(fd){
    act(async () => {
      for (const s of S.shops){ const n = String(fd.get(s.id) || '').trim(); if (n && n !== s.name) must(await sb.from('shops').update({name:n}).eq('id', s.id)); }
    }, {rerender:false, done:() => toast('الأسامي اتحفظت')});
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
  else if (c === 'fdate'){
    ui.f.date = el.value || today(); render();
    if (ui.f.date < addDays(today(), -45) && !extraDays.has(ui.f.date)) fetchDay(ui.f.date).catch(() => toast('ما قدرتش أجيب اليوم ده'));
  }
  else if (el.name === 'party'){ document.getElementById('f-amount')?.focus(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'pq'){
    const pl = document.getElementById('plist'), sel = pl.querySelector('input:checked')?.value || null;
    pl.innerHTML = nameOptions(e.target.value, sel === '__new' ? null : sel);
  }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const fn = F[e.target.id]; if (fn) fn(new FormData(e.target));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.modal){ ui.modal = null; render(); }
  if (!me && ui.pinUser && /^\d$/.test(e.key)){ if (A.pin(e.key) !== false) render(); }
});
document.addEventListener('focusout', () => setTimeout(() => { if (ui.dirty && !ui.modal) softRender(); }, 50));
window.addEventListener('online', () => { ui.offline = false; if (me) scheduleRefresh(); else loadLogin().then(render); });
window.addEventListener('offline', () => { ui.offline = true; render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && me) scheduleRefresh(); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); ui.installEvt = e; render(); });
sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT' && me){ me = null; loadLogin().then(render); } });

(async function boot(){
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  try {
    const {data:{session}} = await sb.auth.getSession();
    if (session) await loadMe(session.user.id);
    if (!me) await loadLogin();
  } catch(e){ ui.offline = !navigator.onLine; }
  ui.booting = false; render();
})();
