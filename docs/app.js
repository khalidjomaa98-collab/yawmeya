'use strict';
const CFG = window.YAWMEYA_CONFIG;
const sb = supabase.createClient(CFG.url, CFG.key, {auth:{persistSession:true, autoRefreshToken:true, storageKey:'yawmeya-auth'}});

const TYPES = {
  credit:   {label:'زبون أخد على الحساب', short:'على الحساب', party:'customer', drawer:0,  dir:'add', hint:'مفيش فلوس دخلت، والمبلغ بيتسجل دين على الزبون.'},
  payment:  {label:'زبون سدّد من دينه',   short:'سداد زبون',   party:'customer', drawer:1,  dir:'add', hint:'فلوس دخلت الدرج، ودين الزبون بيقل.'},
  income:   {label:'فلوس دخلت الدرج',     short:'إيراد',       party:null,       drawer:1,  dir:'add', hint:'مبيعات أو أي فلوس داخلة مالهاش علاقة بدين.'},
  expense:  {label:'مصروفات',             short:'مصروف',       party:null,       drawer:-1, dir:'out', hint:'شاي، مواصلات، كهربا، أكياس...'},
  advance:  {label:'سلفة لعامل',          short:'سلفة',        party:'worker',   drawer:-1, dir:'out', hint:'فلوس طلعت من الدرج وبتتسجل على العامل.'},
  owner:    {label:'سحب صاحب المحل',      short:'سحب هشام',    party:null,       drawer:-1, dir:'out', hint:'فلوس خدها هشام من الدرج.'},
  supplier: {label:'دفع لمورد',           short:'دفع مورد',    party:'supplier', drawer:-1, dir:'out', hint:'فلوس طلعت للمورد، واللي علينا ليه بيقل.'}
};
const METHODS = {cash:'كاش', wallet:'فودافون كاش / محفظة', instapay:'إنستاباي', card:'فيزا'};
const KINDS = {customer:{one:'زبون', many:'الزباين'}, worker:{one:'عامل', many:'العمال'}, supplier:{one:'مورد', many:'الموردين'}};
const PIN_LEN = {admin:6, cashier:4};
const KONNASH_OPEN = `intent://#Intent;package=${CFG.konnashPackage};S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=' + CFG.konnashPackage)};end`;

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const latin = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const nf = n => (Math.round(n * 100) / 100).toLocaleString('en-US');
const money = n => `${nf(n)} <span class="cur">ج.م</span>`;
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

/* ---------- state ---------- */
let S = {shops:[], users:[], parties:[], txs:[], closures:[], notes:[]};
let me = null;
const ui = {booting:true, busy:false, loginUsers:[], needsSetup:false, pinUser:null, pin:'', pinErr:'',
  shopId:lsGet('yawmeya-shop'), tab:'kenash', kshop:'all', f:{shop:'all', date:today(), type:'all', del:false},
  sel:new Set(), modal:null, toast:null, dirty:false, offline:!navigator.onLine, installEvt:null};

const user = id => S.users.find(u => u.id === id);
const shop = id => S.shops.find(s => s.id === id);
const party = id => S.parties.find(p => p.id === id);
const closureOf = (shopId, date) => S.closures.find(c => c.shopId === shopId && c.date === date);
const live = t => !t.deleted;
const tone = T => T.drawer > 0 ? 'in' : T.drawer < 0 ? 'out' : 'credit';
const kDesc = t => [TYPES[t.type].label, t.partyId && party(t.partyId)?.name, t.note, t.method && METHODS[t.method]].filter(Boolean).join(' - ');
const pendingList = () => S.txs.filter(t => live(t) && !t.transferred && (ui.kshop === 'all' || t.shopId === ui.kshop)).sort((a, b) => a.ts - b.ts);

function summary(shopId, date){
  const r = {by:{}, in:0, out:0, credit:0, count:0};
  for (const k in METHODS) r.by[k] = {in:0, out:0};
  S.txs.filter(t => live(t) && t.shopId === shopId && t.date === date).forEach(t => {
    const T = TYPES[t.type]; r.count++;
    if (T.drawer > 0){ r.in += t.amount; r.by[t.method || 'cash'].in += t.amount; }
    else if (T.drawer < 0){ r.out += t.amount; r.by[t.method || 'cash'].out += t.amount; }
    else r.credit += t.amount;
  });
  return r;
}

/* ---------- data ---------- */
const mapTx = r => ({id:r.id, ts:Date.parse(r.ts), date:r.day, shopId:r.shop_id, userId:r.user_id, type:r.type, partyId:r.party_id,
  amount:Number(r.amount), method:r.method, note:r.note || '', afterClose:r.after_close, deleteAck:r.delete_ack,
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
    sb.from('parties').select('id,kind,name,phone').order('name'),
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
  const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox';
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
  if (m.includes('PARTY_REQUIRED')) return 'اختار الشخص الأول.';
  if (m.includes('parties_phone_uniq') || m === '23505') return 'الرقم ده متسجل قبل كده باسم تاني. دوّر عليه واختاره.';
  if (m === 'wrong') return 'الرقم غلط، جرّب تاني.';
  if (m === 'locked') return 'اتكتب رقم غلط كتير. استنى 10 دقايق وجرّب تاني.';
  if (m === 'admin_pin') return 'رقم المدير لازم يكون 6 أرقام.';
  if (m === 'pin') return 'الـPIN لازم يكون 4 أرقام.';
  if (m === 'forbidden') return 'الحركة دي لهشام بس.';
  if (/fetch|network|Failed/i.test(m) || !navigator.onLine) return 'مفيش نت. اتأكد من الاتصال وجرّب تاني.';
  return 'حصلت مشكلة، جرّب تاني.';
}

/* ---------- pieces ---------- */
function topbar(u){
  return `<header class="top"><div class="in">
    <div class="brand"><i aria-hidden="true">ي</i>اليومية</div>
    <div class="who">${ui.installEvt ? `<button class="btn sm" data-a="install">سطّب البرنامج</button>` : ''}
    <span><b>${esc(u.name)}</b> · ${u.role === 'admin' ? 'المدير' : 'كاشير'}</span>
    <button class="btn sm" data-a="logout">خروج</button></div></div></header>
    ${ui.offline ? `<div class="offline">مفيش نت دلوقتي. الحركات مش هتتسجل لحد ما النت يرجع.</div>` : ''}`;
}
function txRow(x, o = {}){
  const T = TYPES[x.type], p = x.partyId ? party(x.partyId) : null, c = tone(T);
  const sign = T.drawer > 0 ? '+' : T.drawer < 0 ? '−' : '';
  const meta = [];
  if (o.date) meta.push(dayLabel(x.date));
  meta.push(tm(x.ts));
  if (o.shop) meta.push(esc(shop(x.shopId)?.name));
  meta.push(esc(user(x.userId)?.name));
  if (x.method) meta.push(METHODS[x.method]);
  const tags = [];
  if (x.deleted) tags.push(`<span class="tag del">مسحها ${esc(user(x.deleted.by)?.name)} ${tm(x.deleted.ts)}${x.deleted.reason ? '، ' + esc(x.deleted.reason) : ''}</span>`);
  if (o.admin && x.transferred) tags.push(`<span class="tag ok">اتنقلت لكناش</span>`);
  if (o.admin && x.afterClose) tags.push(`<span class="tag warn">اتسجلت بعد الإقفال</span>`);
  let act = o.extra || '';
  if (o.mode === 'cashier' && x.userId === me.id && !x.deleted) act = `<button class="btn sm" data-a="del" data-v="${x.id}">امسح</button>`;
  if (o.check) act = `<button class="btn sm" data-a="send" data-v="${x.id}">ابعت لكناش</button>`;
  if (o.mode === 'admin') act = x.deleted ? `<button class="btn sm" data-a="restore" data-v="${x.id}">رجّعها</button>` : `<button class="btn sm" data-a="del" data-v="${x.id}">امسح</button>`;
  return `<li class="row ${x.deleted ? 'is-del' : ''}">
    ${o.check ? `<label class="chk"><input type="checkbox" data-c="sel" value="${x.id}" ${ui.sel.has(x.id) ? 'checked' : ''} aria-label="اختار الحركة"></label>` : ''}
    <div class="rmain"><div class="rtop"><span class="pill ${c}">${T.short}</span>${p ? `<b>${esc(p.name)}</b>` : ''}</div>
      ${x.note ? `<div class="rnote">${esc(x.note)}</div>` : ''}
      <div class="rmeta">${meta.join(' · ')}</div>
      ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}${o.below || ''}</div>
    <div class="rside"><div class="amt ${c}">${sign}${money(x.amount)}</div>${act}</div></li>`;
}
function summaryHTML(r){
  const rows = Object.entries(METHODS).filter(([k]) => r.by[k].in || r.by[k].out)
    .map(([k, v]) => `<tr><td>${v}</td><td class="amt in">${nf(r.by[k].in)}</td><td class="amt out">${nf(r.by[k].out)}</td><td class="amt">${nf(r.by[k].in - r.by[k].out)}</td></tr>`).join('');
  return `<div class="kpis">
      <div class="kpi"><small>داخل</small><div class="amt in">${money(r.in)}</div></div>
      <div class="kpi"><small>خارج</small><div class="amt out">${money(r.out)}</div></div>
      <div class="kpi"><small>على الحساب</small><div class="amt credit">${money(r.credit)}</div></div></div>
    ${rows ? `<table class="sum"><thead><tr><th>طريقة الدفع</th><th>داخل</th><th>خارج</th><th>الصافي</th></tr></thead><tbody>${rows}
      <tr class="total"><td>الصافي</td><td></td><td></td><td class="amt">${money(r.in - r.out)}</td></tr></tbody></table>` : ''}`;
}
function typeBtn(k, disabled){
  const T = TYPES[k];
  return `<button class="tbtn ${T.drawer === 0 ? 'credit' : T.dir}" data-a="type" data-v="${k}" ${disabled ? 'disabled' : ''}><b>${T.label}</b><small>${T.hint}</small></button>`;
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

/* ---------- screens ---------- */
function renderBoot(){ return `<main class="login"><div class="brand" style="font-size:1.4rem"><i aria-hidden="true">ي</i>اليومية</div><p class="muted">بيحمّل...</p></main>`; }

function renderSetup(){
  return `<main class="login"><div class="brand" style="font-size:1.4rem"><i aria-hidden="true">ي</i>اليومية</div>
    <h1>أول تشغيل: حساب المدير</h1>
    <p class="muted" style="margin:0">الحساب ده لهشام. منه هيضيف الكاشيرية ويتابع الحركات. رقم المدير 6 أرقام علشان يبقى أصعب في التخمين.</p>
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
    return `<main class="login"><div class="brand" style="font-size:1.4rem"><i aria-hidden="true">ي</i>اليومية</div>
      <h1>مين بيسجل دلوقتي؟</h1>
      ${ui.loginUsers.length ? `<div class="ugrid">${ui.loginUsers.map(u => `<button class="ubtn" data-a="pickUser" data-v="${u.id}"><b>${esc(u.name)}</b><small>${u.role === 'admin' ? 'المدير' : 'كاشير'}</small></button>`).join('')}</div>`
        : `<p class="empty">${ui.offline ? 'مفيش نت. اتأكد من الاتصال.' : 'مفيش حسابات لسه.'}</p>`}
      ${ui.installEvt ? `<button class="btn" data-a="install">سطّب البرنامج على الموبايل</button>` : ''}</main>`;
  }
  const u = ui.loginUsers.find(x => x.id === ui.pinUser), len = PIN_LEN[u.role];
  return `<main class="login">
    <button class="btn ghost" data-a="loginBack" style="align-self:flex-start">→ رجوع</button>
    <h1>أهلًا ${esc(u.name)}، اكتب الرقم السري</h1>
    <div class="dots ${ui.pinErr ? 'bad' : ''}" aria-label="${ui.pin.length} من ${len}">${Array.from({length:len}, (_, i) => `<span class="${i < ui.pin.length ? 'f' : ''}"></span>`).join('')}</div>
    <p class="err" role="alert" style="text-align:center">${ui.busy ? '<span class="muted">بيتأكد...</span>' : esc(ui.pinErr)}</p>
    <div class="pad">${[1,2,3,4,5,6,7,8,9].map(n => `<button data-a="pin" data-v="${n}" ${ui.busy ? 'disabled' : ''}>${n}</button>`).join('')}
      <button data-a="pinBack" aria-label="امسح رقم">⌫</button><button data-a="pin" data-v="0" ${ui.busy ? 'disabled' : ''}>0</button><span></span></div></main>`;
}

function renderCashier(){
  const t = today(), cl = closureOf(ui.shopId, t);
  const list = S.txs.filter(x => x.shopId === ui.shopId && x.date === t && live(x)).sort((a, b) => b.ts - a.ts);
  const sum = summary(ui.shopId, t), s = shop(ui.shopId);
  const keys = Object.keys(TYPES);
  if (!s) return `${topbar(me)}<main class="wrap"><p class="empty">مفيش محلات متسجلة.</p></main>`;
  return `${topbar(me)}<main class="wrap">
    <div class="seg">${S.shops.map(x => `<button class="${x.id === ui.shopId ? 'on' : ''}" data-a="shop" data-v="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    ${cl ? `<div class="banner warn">يومية ${esc(s.name)} اتقفلت الساعة ${tm(cl.ts)}. لو محتاج تسجل حاجة، كلّم هشام يفتحها.</div>` : ''}
    <section><h2>سجّل حركة</h2>
      <div class="tgroup"><h3 class="lbl in">داخل الدرج أو على الحساب</h3><div class="types">${keys.filter(k => TYPES[k].dir === 'add').map(k => typeBtn(k, cl)).join('')}</div></div>
      <div class="tgroup"><h3 class="lbl out">خارج من الدرج</h3><div class="types">${keys.filter(k => TYPES[k].dir === 'out').map(k => typeBtn(k, cl)).join('')}</div></div>
    </section>
    <section><div class="sechead"><h2>حركات النهارده</h2><span class="muted small">${list.length} حركة في ${esc(s.name)}</span></div>
      ${list.length ? `<ul class="rows">${list.map(x => txRow(x, {mode:'cashier'})).join('')}</ul>` : `<p class="empty">لسه مفيش حركات النهارده في المحل ده.</p>`}
    </section>
    <section><h2>إقفال اليومية</h2><div class="card">${summaryHTML(sum)}
      ${cl ? `<p class="muted small" style="margin:0">اتقفلت بواسطة ${esc(user(cl.userId)?.name)} الساعة ${tm(cl.ts)}.</p>` : `<button class="btn primary wide" data-a="closeDay" ${sum.count ? '' : 'disabled'}>اقفل يومية النهارده</button>`}</div></section>
  </main>`;
}

function renderAdmin(){
  const pending = S.txs.filter(t => live(t) && !t.transferred).length + S.txs.filter(t => t.deleted && t.transferred && !t.deleteAck).length;
  const unread = S.notes.filter(n => !n.read).length;
  const tabs = [['kenash','كناش',pending],['txs','الحركات',0],['notes','الإشعارات',unread],['set','الإعدادات',0]];
  const body = {kenash:tabKenash, txs:tabTxs, notes:tabNotes, set:tabSet}[ui.tab]();
  return `${topbar(me)}<main class="wrap admin">${body}</main>
    <nav class="nav" aria-label="الأقسام"><div class="in">${tabs.map(([k, l, n]) => `<button class="${ui.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}" ${ui.tab === k ? 'aria-current="page"' : ''}>${navIcon(k)}${l}${n ? `<span class="badge">${n}</span>` : ''}</button>`).join('')}</div></nav>`;
}
function shopSeg(cur, action){
  return `<div class="seg">${[['all','المحلين'], ...S.shops.map(s => [s.id, s.name])].map(([id, n]) => `<button class="${cur === id ? 'on' : ''}" data-a="${action}" data-v="${id}">${esc(n)}</button>`).join('')}</div>`;
}
function tabKenash(){
  const sf = ui.kshop, pend = pendingList();
  for (const id of [...ui.sel]) if (!pend.some(t => t.id === id)) ui.sel.delete(id);
  const alerts = S.txs.filter(t => t.deleted && t.transferred && !t.deleteAck);
  const recent = S.txs.filter(t => live(t) && t.transferred && t.transferredAt).sort((a, b) => b.transferredAt - a.transferredAt).slice(0, 8);
  const days = [...new Set(pend.map(t => t.date))], n = ui.sel.size;
  return `<section><div class="sechead"><h2>لسه ما اتنقلش لكناش</h2><span class="muted small">${pend.length} حركة</span></div>
    <p class="muted small" style="margin:0">اضغط "ابعت لكناش" على الحركة، أو اختار كذا حركة وعلّم إنها اتسجلت. الأقدم فوق.</p>
    ${shopSeg(sf, 'kshop')}</section>
    ${alerts.length ? `<section><h2>اتمسحت بعد ما اتنقلت</h2>
      <div class="banner alert small">الحركات دي كانت اتنقلت لكناش وبعدين اتمسحت هنا. امسحها من كناش كمان علشان الحساب يفضل مظبوط.</div>
      <ul class="rows">${alerts.map(x => txRow(x, {admin:true, shop:true, date:true, below:`<div style="margin-top:8px"><button class="btn sm" data-a="ack" data-v="${x.id}">تمام، مسحتها من كناش</button></div>`})).join('')}</ul></section>` : ''}
    <section>${pend.length ? days.map(d => `<div class="dayhead">${dayLabel(d)}</div><ul class="rows">${pend.filter(t => t.date === d).map(x => txRow(x, {admin:true, check:true, shop:sf === 'all'})).join('')}</ul>`).join('')
      : `<p class="empty">كل الحركات اتنقلت لكناش. أي حركة جديدة هتظهر هنا.</p>`}
    ${pend.length ? `<div class="actbar"><button class="btn sm" data-a="selAll">${n === pend.length ? 'شيل التحديد' : 'اختار الكل'}</button>
      <button class="btn sm" data-a="copySel" ${n ? '' : 'disabled'}>نسخ للإكسل</button>
      <button class="btn primary grow" data-a="markDone" ${n ? '' : 'disabled'}>${n ? `اتسجلت في كناش (${n})` : 'اختار الحركات الأول'}</button></div>` : ''}
    </section>
    ${recent.length ? `<section><h2>آخر اللي اتنقل</h2><p class="muted small" style="margin:0">لو علّمت على حاجة بالغلط رجّعها من هنا.</p>
      <ul class="rows">${recent.map(x => txRow(x, {admin:true, shop:true, date:true, extra:`<button class="btn sm" data-a="untransfer" data-v="${x.id}">رجّعها</button>`})).join('')}</ul></section>` : ''}`;
}
const txFilter = f => t => (f.shop === 'all' || t.shopId === f.shop) && (!f.date || t.date === f.date) && (f.type === 'all' || t.type === f.type);
function tabTxs(){
  const f = ui.f;
  const list = S.txs.filter(t => txFilter(f)(t) && (f.del || live(t))).sort((a, b) => b.ts - a.ts);
  const shops = f.shop === 'all' ? S.shops : [shop(f.shop)];
  const cards = f.date ? `<div class="cards">${shops.map(s => {
      const cl = closureOf(s.id, f.date);
      return `<div class="card"><div class="sechead"><h3>${esc(s.name)} · ${dayLabel(f.date)}</h3>
        ${cl ? `<span class="tag ok">اتقفلت ${tm(cl.ts)}</span>` : `<span class="tag">لسه مفتوحة</span>`}</div>
        ${summaryHTML(summary(s.id, f.date))}
        ${cl ? `<button class="btn sm" data-a="reopen" data-v="${cl.id}" style="align-self:flex-start">افتح اليومية تاني</button>` : ''}</div>`;
    }).join('')}</div>` : '';
  return `<section><div class="sechead"><h2>كل الحركات</h2><button class="btn primary sm" data-a="addTx">+ حركة</button></div>
    <div class="filters">
      <div class="field"><label for="fshop">المحل</label><select id="fshop" data-c="fshop"><option value="all">المحلين</option>${S.shops.map(s => `<option value="${s.id}" ${f.shop === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="fdate">اليوم</label><input type="date" id="fdate" data-c="fdate" value="${f.date}" max="${today()}"></div>
      <div class="field"><label for="ftype">النوع</label><select id="ftype" data-c="ftype"><option value="all">كل الأنواع</option>${Object.entries(TYPES).map(([k, T]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${T.label}</option>`).join('')}</select></div>
      <label class="field" style="flex-direction:row;align-items:center;gap:8px;align-self:end;padding-bottom:10px"><input type="checkbox" id="fdel" data-c="fdel" ${f.del ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)"> <span>اعرض الممسوح</span></label>
    </div>
    ${f.date ? '' : `<p class="muted small" style="margin:0">من غير يوم معيّن بتشوف آخر 45 يوم. اختار يوم علشان تشوف ملخصه.</p>`}
    </section>
    ${cards}
    <section><div class="sechead"><h2>${list.length} حركة</h2><button class="btn sm" data-a="copyTxs" ${list.length ? '' : 'disabled'}>نسخ للإكسل</button></div>
      ${list.length ? `<ul class="rows">${list.map(x => txRow(x, {mode:'admin', admin:true, shop:f.shop === 'all', date:!f.date})).join('')}</ul>` : `<p class="empty">مفيش حركات بالفلتر ده.</p>`}</section>`;
}
function tabNotes(){
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `<section><div class="sechead"><h2>الإشعارات</h2><span class="muted small">مع كل حركة، ولما حد يمسح، ومع إقفال اليومية</span></div>
    ${perm === 'default' ? `<div class="banner demo small" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1 1 200px">فعّل الإشعارات علشان توصلك على الموبايل والبرنامج مفتوح في الخلفية.</span><button class="btn sm primary" data-a="askNotify">فعّل</button></div>` : ''}
    ${S.notes.length ? `<ul class="rows">${S.notes.map(n => `<li class="note ${n.read ? '' : 'unread'}"><span class="dot"></span><div class="rmain"><div>${esc(n.text)}</div><div class="rmeta">${dayLabel(dayOf(n.ts))} · ${tm(n.ts)}</div></div></li>`).join('')}</ul>` : `<p class="empty">مفيش إشعارات لسه. أول ما كاشير يسجل حركة هتظهر هنا.</p>`}</section>`;
}
function tabSet(){
  const people = k => S.parties.filter(p => p.kind === k);
  return `<section><h2>المحلات</h2><form id="shopsf" class="card">${S.shops.map(s => `<div class="field"><label for="s_${s.id}">اسم المحل</label><input id="s_${s.id}" name="${s.id}" value="${esc(s.name)}"></div>`).join('')}<button class="btn" style="align-self:flex-start">احفظ الأسامي</button></form></section>
    <section><h2>المستخدمين</h2><ul class="rows">${S.users.map(u => `<li class="urow"><span class="pn"><b>${esc(u.name)}</b><small>${u.role === 'admin' ? 'المدير' : 'كاشير'} · ${u.active ? 'شغّال' : 'موقوف'}</small></span>
      <button class="btn sm" data-a="chPin" data-v="${u.id}">غيّر الرقم السري</button>
      ${u.role !== 'admin' ? `<button class="btn sm" data-a="toggleUser" data-v="${u.id}">${u.active ? 'وقّف الحساب' : 'شغّله تاني'}</button>` : ''}</li>`).join('')}</ul>
      <form id="userf" class="card"><h3>ضيف كاشير</h3><div class="np">
        <div class="field"><label for="nu-name">الاسم</label><input id="nu-name" name="name" autocomplete="off"></div>
        <div class="field"><label for="nu-pin">رقم سري من 4 أرقام</label><input id="nu-pin" name="pin" inputmode="numeric" maxlength="4" autocomplete="off"></div></div>
        <p class="err" id="uerr" role="alert"></p><button class="btn primary" style="align-self:flex-start" ${ui.busy ? 'disabled' : ''}>ضيف</button></form></section>
    ${['worker', 'supplier'].map(k => `<section><div class="sechead"><h2>${KINDS[k].many}</h2><button class="btn sm" data-a="newParty" data-v="${k}">+ ${KINDS[k].one} جديد</button></div>
      <p class="muted small" style="margin:0">${k === 'worker' ? 'بيظهروا للكاشير لما يسجل سلفة.' : 'بيظهروا للكاشير لما يسجل دفع لمورد.'}</p>
      ${people(k).length ? `<ul class="rows">${people(k).map(p => `<li class="urow"><span class="pn"><b>${esc(p.name)}</b>${p.phone ? `<small dir="ltr" style="text-align:right">${esc(p.phone)}</small>` : ''}</span></li>`).join('')}</ul>` : `<p class="empty">مفيش ${KINDS[k].many} لسه.</p>`}</section>`).join('')}`;
}

/* ---------- modals ---------- */
function partyOptions(kind, q, sel, canNew){
  q = latin(q || '').trim();
  const ps = S.parties.filter(p => p.kind === kind && (!q || p.name.includes(q) || (p.phone || '').includes(q))).slice(0, 30);
  let h = ps.map(p => `<label class="opt"><input type="radio" name="party" value="${p.id}" ${sel === p.id ? 'checked' : ''}><span>${esc(p.name)}</span><small>${esc(p.phone || '')}</small></label>`).join('');
  if (!ps.length) h = `<p class="muted small">مفيش نتيجة${canNew ? '، ضيفه جديد من تحت' : ''}.</p>`;
  if (canNew) h += `<label class="opt new"><input type="radio" name="party" value="__new" ${sel === '__new' ? 'checked' : ''}><span>+ ${KINDS[kind].one} جديد</span></label>`;
  return h;
}
function modalTx(m){
  const T = TYPES[m.type], admin = me.role === 'admin', kind = T.party;
  const canNew = kind === 'customer' || (kind && admin);
  return `<form id="txf" novalidate>
    <div class="shead"><h2>${T.label}</h2>${xBtn}</div>
    <p class="muted small" style="margin:-8px 0 0">${T.hint}</p>
    ${admin ? `<div class="field"><label for="f-shop">المحل</label><select id="f-shop" name="shop">${S.shops.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>`
            : `<p class="ctx">المحل: <b>${esc(shop(ui.shopId).name)}</b></p>`}
    ${kind ? `<div class="field"><label for="pq">اختار ال${KINDS[kind].one}</label>
        <input id="pq" type="search" placeholder="دوّر بالاسم أو الرقم" autocomplete="off">
        <div id="plist" class="plist" data-kind="${kind}" data-new="${canNew ? 1 : ''}" role="radiogroup">${partyOptions(kind, '', null, canNew)}</div>
        ${canNew ? `<div id="np" class="np" hidden>
          <div class="field"><label for="np-name">اسم ال${KINDS[kind].one}</label><input id="np-name" name="npname" autocomplete="off"></div>
          <div class="field"><label for="np-phone">رقم الموبايل${kind === 'customer' ? '' : ' (اختياري)'}</label><input id="np-phone" name="npphone" type="tel" inputmode="tel" dir="ltr" placeholder="01xxxxxxxxx" autocomplete="off"></div></div>` : ''}
      </div>` : ''}
    <div class="field"><label for="f-amount">المبلغ (ج.م)</label><input id="f-amount" name="amount" class="big" inputmode="decimal" autocomplete="off" placeholder="0" ${kind ? '' : 'data-autofocus'}></div>
    ${T.drawer ? `<fieldset class="field"><legend>طريقة الدفع</legend><div class="chips">${Object.entries(METHODS).map(([k, v], i) => `<label class="chip"><input type="radio" name="method" value="${k}" ${i ? '' : 'checked'}><span>${v}</span></label>`).join('')}</div></fieldset>` : ''}
    <div class="field"><label for="f-note">ملاحظة (اختياري)</label><input id="f-note" name="note" autocomplete="off" placeholder="${m.type === 'credit' ? 'أخد إيه؟ مثلًا: جراب + سكرينة' : ''}"></div>
    <p id="ferr" class="err" role="alert"></p>
    <button class="btn primary wide" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'بيسجل...' : 'سجّل الحركة'}</button></form>`;
}
function renderModal(){
  const m = ui.modal; if (!m) return '';
  let b = '';
  if (m.kind === 'tx') b = modalTx(m);
  else if (m.kind === 'send'){
    const x = S.txs.find(t => t.id === m.id);
    if (!x){ ui.modal = null; return ''; }
    const left = pendingList().length;
    b = `<div class="shead"><h2>ابعت لكناش</h2>${xBtn}</div>
      <ul class="rows">${txRow(x, {admin:true, shop:true, date:true})}</ul>
      <div class="card" style="background:var(--sunk)">
        <div class="sechead"><span class="muted small">المبلغ</span><button class="btn sm" data-a="sendCopy" data-v="amount">انسخ</button></div>
        <div class="amt" style="font-size:1.4rem">${nf(x.amount)}</div>
        <div class="sechead"><span class="muted small">الوصف</span><button class="btn sm" data-a="sendCopy" data-v="desc">انسخ</button></div>
        <div>${esc(kDesc(x))}</div></div>
      <a class="btn primary wide" style="text-decoration:none" href="${KONNASH_OPEN}" data-a="sendOpen">انسخ المبلغ وافتح كناش</a>
      <p class="muted small" style="margin:0">في كناش اختار ${x.partyId ? esc(party(x.partyId)?.name) : 'الحساب المناسب'} والزق المبلغ. بعدها ارجع هنا واضغط "اتسجلت".</p>
      <button class="btn wide" data-a="sendDone" style="border-color:var(--in);color:var(--in)">اتسجلت في كناش${left > 1 ? '، هات اللي بعدها' : ''}</button>`;
  }
  else if (m.kind === 'pickType') b = `<div class="shead"><h2>حركة جديدة</h2>${xBtn}</div>
      <div class="types">${Object.keys(TYPES).map(k => typeBtn(k, false)).join('')}</div>`;
  else if (m.kind === 'del'){
    const x = S.txs.find(t => t.id === m.id), admin = me.role === 'admin';
    if (!x){ ui.modal = null; return ''; }
    b = `<form id="delf"><div class="shead"><h2>تمسح الحركة دي؟</h2>${xBtn}</div>
      <ul class="rows">${txRow(x, {})}</ul>
      <p class="muted small" style="margin:0">${admin ? 'هتتعلّم إنها ممسوحة ومش هتدخل في الحساب، وتقدر ترجّعها بعدين.' : 'هتختفي من عندك، بس هشام هيفضل شايفها ومكتوب عليها إنك مسحتها.'}</p>
      <div class="field"><label for="d-reason">السبب</label><input id="d-reason" name="reason" placeholder="مثلًا: اتسجلت مرتين" autocomplete="off" data-autofocus></div>
      <p id="ferr" class="err" role="alert"></p>
      <button class="btn danger wide" ${ui.busy ? 'disabled' : ''}>امسح الحركة</button></form>`;
  }
  else if (m.kind === 'closeDay'){
    b = `<div class="shead"><h2>إقفال يومية ${esc(shop(ui.shopId).name)}</h2>${xBtn}</div>
      ${summaryHTML(summary(ui.shopId, today()))}
      <p class="muted small" style="margin:0">بعد الإقفال مش هتقدر تسجل حركات تانية النهارده في المحل ده إلا لو هشام فتح اليومية. وهشام هيوصله الملخص ده.</p>
      <p id="ferr" class="err" role="alert"></p>
      <button class="btn primary wide" data-a="confirmClose" ${ui.busy ? 'disabled' : ''}>اقفل اليومية</button>`;
  }
  else if (m.kind === 'party'){
    b = `<form id="partyf"><div class="shead"><h2>${KINDS[m.pkind].one} جديد</h2>${xBtn}</div>
      <div class="field"><label for="pa-name">الاسم</label><input id="pa-name" name="name" autocomplete="off" data-autofocus></div>
      <div class="field"><label for="pa-phone">رقم الموبايل (اختياري)</label><input id="pa-phone" name="phone" type="tel" dir="ltr" placeholder="01xxxxxxxxx" autocomplete="off"></div>
      <p id="ferr" class="err" role="alert"></p><button class="btn primary wide" ${ui.busy ? 'disabled' : ''}>ضيف</button></form>`;
  }
  else if (m.kind === 'pin'){
    const u = user(m.id), len = PIN_LEN[u.role];
    b = `<form id="pinf"><div class="shead"><h2>رقم سري جديد لـ${esc(u.name)}</h2>${xBtn}</div>
      <div class="field"><label for="pn-pin">${len} أرقام</label><input id="pn-pin" name="pin" class="big" type="password" inputmode="numeric" maxlength="${len}" autocomplete="new-password" data-autofocus></div>
      <p id="ferr" class="err" role="alert"></p><button class="btn primary wide" ${ui.busy ? 'disabled' : ''}>احفظ</button></form>`;
  }
  else if (m.kind === 'copy'){
    b = `<div class="shead"><h2>انسخ النص</h2>${xBtn}</div>
      <p class="muted small" style="margin:0">الجهاز مش سامح بالنسخ التلقائي. النص متعلّم، اضغط مطوّل واختار نسخ.</p>
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
  const head = ['التاريخ','الوقت','المحل','النوع','الاسم','المبلغ','طريقة الدفع','ملاحظة','سجّلها'];
  const rows = list.map(t => [t.date, tm(t.ts), shop(t.shopId)?.name, TYPES[t.type].label, t.partyId ? party(t.partyId)?.name : '', t.amount, t.method ? METHODS[t.method] : '', t.note, user(t.userId)?.name]
    .map(v => String(v ?? '').replace(/[\t\n]/g, ' ')).join('\t'));
  return [head.join('\t'), ...rows].join('\n');
}
function formErr(msg, id = 'ferr'){ const e = document.getElementById(id); if (e) e.textContent = msg; }

// Runs a write, keeps the screen in sync, and reports errors in the open form (or as a toast).
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
  install(){ const e = ui.installEvt; ui.installEvt = null; if (e){ e.prompt(); } },
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
      me = null; ui.modal = null; ui.sel.clear(); S = {shops:[], users:[], parties:[], txs:[], closures:[], notes:[]};
      await loadLogin();
    });
    return false;
  },
  shop(v){ ui.shopId = v; lsSet('yawmeya-shop', v); },
  type(v){ ui.modal = {kind:'tx', type:v}; },
  addTx(){ ui.modal = {kind:'pickType'}; },
  del(v){ ui.modal = {kind:'del', id:v}; },
  restore(v){ act(async () => must(await sb.from('txs').update({deleted_at:null, deleted_by:null, delete_reason:null, delete_ack:false}).eq('id', v)), {done:() => toast('رجعت الحركة')}); return false; },
  closeDay(){ ui.modal = {kind:'closeDay'}; },
  confirmClose(){ act(async () => must(await sb.rpc('close_day', {p_shop:ui.shopId})), {done:() => { ui.modal = null; toast('اليومية اتقفلت'); }}); return false; },
  reopen(v){ act(async () => must(await sb.from('closures').delete().eq('id', v)), {done:() => toast('اليومية اتفتحت تاني')}); return false; },
  tab(v){ ui.tab = v; ui.sel.clear(); window.scrollTo(0, 0); },
  kshop(v){ ui.kshop = v; ui.sel.clear(); },
  selAll(){ const ids = pendingList().map(t => t.id); if (ui.sel.size === ids.length) ui.sel.clear(); else ids.forEach(id => ui.sel.add(id)); },
  markDone(){
    const ids = [...ui.sel], n = ids.length;
    act(async () => must(await sb.from('txs').update({transferred_at:new Date().toISOString()}).in('id', ids)), {done:() => { ui.sel.clear(); toast(`${n} حركة اتعلّمت إنها في كناش`); }});
    return false;
  },
  copySel(){ copyText(tsv(S.txs.filter(t => ui.sel.has(t.id)).sort((a, b) => a.ts - b.ts))); return false; },
  copyTxs(){ copyText(tsv(S.txs.filter(t => txFilter(ui.f)(t) && live(t)).sort((a, b) => a.ts - b.ts))); return false; },
  send(v){ ui.modal = {kind:'send', id:v}; },
  sendCopy(v){ const x = S.txs.find(t => t.id === ui.modal.id); copyText(v === 'amount' ? String(x.amount) : kDesc(x)); return false; },
  sendOpen(v, e){
    const x = S.txs.find(t => t.id === ui.modal.id);
    try { navigator.clipboard.writeText(String(x.amount)).catch(() => {}); } catch(err){}
    const L = window.Capacitor?.Plugins?.AppLauncher;
    if (isNative() && L){
      e.preventDefault();
      L.openUrl({url:CFG.konnashPackage}).then(r => { if (!r?.completed) toast('كناش مش متسطب على الموبايل ده'); }).catch(() => toast('ما قدرتش أفتح كناش'));
    }
    return false;
  },
  sendDone(){
    const id = ui.modal.id;
    act(async () => must(await sb.from('txs').update({transferred_at:new Date().toISOString()}).eq('id', id)), {done:() => {
      ui.sel.delete(id);
      const next = pendingList()[0];
      ui.modal = next ? {kind:'send', id:next.id} : null;
      toast(next ? 'اتسجلت، ودي اللي بعدها' : 'كل الحركات اتنقلت لكناش');
    }});
    return false;
  },
  untransfer(v){ act(async () => must(await sb.from('txs').update({transferred_at:null}).eq('id', v)), {done:() => toast('رجعت لقايمة كناش')}); return false; },
  ack(v){ act(async () => must(await sb.from('txs').update({delete_ack:true}).eq('id', v))); return false; },
  newParty(v){ ui.modal = {kind:'party', pkind:v || 'worker'}; },
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
    const m = ui.modal, T = TYPES[m.type], admin = me.role === 'admin';
    const amount = parseFloat(latin(fd.get('amount')).replace(/[,٬\s]/g, '').replace('٫', '.'));
    let partyId = null, created = null;
    if (T.party){
      const v = fd.get('party');
      if (!v) return formErr(`اختار ال${KINDS[T.party].one} الأول.`);
      if (v === '__new'){
        const name = String(fd.get('npname') || '').trim(), phone = latin(fd.get('npphone')).replace(/\D/g, '');
        if (!name) return formErr(`اكتب اسم ال${KINDS[T.party].one} الجديد.`);
        if (T.party === 'customer' && !phone) return formErr('اكتب رقم موبايل الزبون علشان الأسامي ما تتلخبطش.');
        if (phone && !/^01\d{9}$/.test(phone)) return formErr('رقم الموبايل لازم يكون 11 رقم ويبدأ بـ 01.');
        const dup = phone && S.parties.find(p => p.phone === phone);
        if (dup) return formErr(`الرقم ده متسجل باسم "${dup.name}". دوّر عليه فوق واختاره.`);
        created = {kind:T.party, name, phone:phone || null};
      } else partyId = v;
    }
    if (!(amount > 0)) return formErr('اكتب المبلغ بالأرقام، ولازم يكون أكبر من صفر.');
    const shopId = admin ? (fd.get('shop') || S.shops[0].id) : ui.shopId;
    const row = {shop_id:shopId, type:m.type, amount, method:T.drawer ? (fd.get('method') || 'cash') : null, note:String(fd.get('note') || '').trim()};
    act(async () => {
      if (created){
        const id = crypto.randomUUID();
        must(await sb.from('parties').insert({id, ...created}));
        partyId = id;
      }
      must(await sb.from('txs').insert({...row, party_id:partyId}));
    }, {rerender:false, done:() => { ui.modal = null; toast('اتسجلت الحركة'); }});
  },
  delf(fd){
    const id = ui.modal.id, reason = String(fd.get('reason') || '').trim();
    act(async () => must(await sb.rpc('delete_tx', {p_id:id, p_reason:reason})), {rerender:false, done:() => { ui.modal = null; toast('الحركة اتمسحت'); }});
  },
  partyf(fd){
    const name = String(fd.get('name') || '').trim(), phone = latin(fd.get('phone')).replace(/\D/g, ''), kind = ui.modal.pkind;
    if (!name) return formErr('اكتب الاسم.');
    if (phone && !/^01\d{9}$/.test(phone)) return formErr('رقم الموبايل لازم يكون 11 رقم ويبدأ بـ 01.');
    act(async () => must(await sb.from('parties').insert({kind, name, phone:phone || null})), {rerender:false, done:() => { ui.modal = null; toast('اتضاف'); }});
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
  if (c === 'sel'){ el.checked ? ui.sel.add(el.value) : ui.sel.delete(el.value); render(); }
  else if (c === 'fshop'){ ui.f.shop = el.value; render(); }
  else if (c === 'fdate'){
    ui.f.date = el.value; render();
    if (el.value && el.value < addDays(today(), -45) && !extraDays.has(el.value)) fetchDay(el.value).catch(() => toast('ما قدرتش أجيب اليوم ده'));
  }
  else if (c === 'ftype'){ ui.f.type = el.value; render(); }
  else if (c === 'fdel'){ ui.f.del = el.checked; render(); }
  else if (el.name === 'party'){
    const np = document.getElementById('np'); if (!np) return;
    np.hidden = el.value !== '__new';
    if (el.value === '__new'){
      const q = document.getElementById('pq').value.trim(), nm = document.getElementById('np-name'), ph = document.getElementById('np-phone');
      if (q && !nm.value && !ph.value){ if (/^[\d٠-٩]+$/.test(q)) ph.value = latin(q); else nm.value = q; }
      (nm.value ? ph : nm).focus();
    }
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'pq'){
    const pl = document.getElementById('plist'), sel = pl.querySelector('input:checked')?.value || null;
    pl.innerHTML = partyOptions(pl.dataset.kind, e.target.value, sel, !!pl.dataset.new);
  }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const fn = F[e.target.id]; if (fn) fn(new FormData(e.target));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.modal){ ui.modal = null; render(); }
  if (!me && ui.pinUser && /^\d$/.test(e.key)) A.pin(e.key);
});
// When a modal closes or typing stops, show what arrived meanwhile.
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
