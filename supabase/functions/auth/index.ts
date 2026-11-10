// Login with name + PIN, first-time setup of the owner account, owner day closing (PIN-confirmed),
// and owner-only user management. Runs with the service role; every action checks its own rules.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, SRK, { auth: { persistSession: false, autoRefreshToken: false } });

const PIN_RE = /^\d{4,8}$/;
const emailFor = (id: string) => `u${id.replace(/-/g, "")}@yawmeya.app`;

async function createAccount(name: string, role: "admin" | "cashier", pin: string) {
  const password = crypto.randomUUID() + crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email: emailFor(crypto.randomUUID()), password, email_confirm: true, user_metadata: { name },
  });
  if (error) throw error;
  const id = data.user.id;
  const p = await admin.from("profiles").insert({ id, name, role });
  if (p.error) { await admin.auth.admin.deleteUser(id); throw p.error; }
  const s = await admin.rpc("set_secret", { p_uid: id, p_pin: pin, p_pass: password });
  if (s.error) { await admin.auth.admin.deleteUser(id); throw s.error; }
  return { id, password };
}

async function session(id: string, password: string) {
  const u = await admin.auth.admin.getUserById(id);
  if (u.error || !u.data.user?.email) throw u.error ?? new Error("no user");
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: u.data.user.email, password });
  if (error || !data.session) throw error ?? new Error("no session");
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

async function caller(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data.user) return null;
  const p = await admin.from("profiles").select("id, role, active").eq("id", data.user.id).maybeSingle();
  return p.data?.active ? p.data : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const action = String(body.action ?? "");
  const pin = String(body.pin ?? "");
  const name = String(body.name ?? "").trim();

  try {
    if (action === "login") {
      const userId = String(body.user_id ?? "");
      if (!PIN_RE.test(pin) || !userId) return json({ error: "wrong" }, 401);
      const r = await admin.rpc("auth_check_pin", { p_uid: userId, p_pin: pin });
      if (r.error) return json({ error: "server" }, 500);
      if (r.data === "LOCKED") return json({ error: "locked" }, 429);
      if (!r.data) return json({ error: "wrong" }, 401);
      const [tokens,profile]=await Promise.all([session(userId,r.data as string),admin.from('profiles').select('id,name,role,active,created_at,shop_id').eq('id',userId).maybeSingle()]);
      if(profile.error)return json({error:'server'},500);
      if(!profile.data?.active)return json({error:'forbidden'},403);
      return json({...tokens,profile:profile.data});
    }

    if (action === "setup") {
      const need = await admin.rpc("needs_setup");
      if (need.error) return json({ error: "server" }, 500);
      if (!need.data) return json({ error: "already_setup" }, 409);
      if (!name) return json({ error: "name" }, 400);
      if (!/^\d{6,8}$/.test(pin)) return json({ error: "admin_pin" }, 400);
      const acc = await createAccount(name, "admin", pin);
      return json(await session(acc.id, acc.password));
    }

    const me = await caller(req);
    if(action==='approve_sale'){
      if(!me||me.role!=='cashier'||!/^\d{6}$/.test(pin))return json({error:'forbidden'},403);
      const ownerId=String(body.owner_id??'');
      const owner=await admin.from('profiles').select('id').eq('id',ownerId).eq('role','admin').eq('active',true).maybeSingle();
      if(!owner.data)return json({error:'forbidden'},403);
      const qty=Number(body.qty),price=Number(body.price);
      if(!Number.isInteger(qty)||qty<1||!Number.isFinite(price)||price<=0)return json({error:'bad_request'},400);
      const checked=await admin.rpc('auth_check_pin',{p_uid:ownerId,p_pin:pin});
      if(checked.error)return json({error:'server'},500);
      if(checked.data==='LOCKED')return json({error:'locked'},429);
      if(!checked.data)return json({error:'wrong'},401);
      const approved=await admin.rpc('hcash_approve_sale',{p_owner:ownerId,p_actor:me.id,p_sale:String(body.sale_id??''),p_device:String(body.device_id??''),p_qty:qty,p_price:price});
      if(approved.error)return json({error:'server'},500);
      return json({approved:true});
    }
    // owner-only actions below
    if (!me || me.role !== "admin") return json({ error: "forbidden" }, 403);

    if(action==="wipe"){
      if(!/^\d{6}$/.test(pin))return json({error:"wrong"},401);
      const checked=await admin.rpc("auth_check_pin",{p_uid:me.id,p_pin:pin});
      if(checked.error)return json({error:"server"},500);
      if(checked.data==="LOCKED")return json({error:"locked"},429);
      if(!checked.data)return json({error:"wrong"},401);
      const backup=await fetch(URL_+"/functions/v1/hcash-backup",{method:"POST",headers:{"Content-Type":"application/json","Authorization":req.headers.get("Authorization")??"","apikey":ANON},body:JSON.stringify({action:"pre_wipe"})});
      const saved=await backup.json();
      if(!backup.ok||saved.status!=="ready")return json({error:"backup_failed"},503);
      const wiped=await admin.rpc("hcash_owner_wipe",{p_owner:me.id,p_snapshot:saved.snapshot});
      if(wiped.error)return json({error:"server"},500);
      return json({deleted:wiped.data,backup_id:saved.id});
    }

    // owner closes a shop's day after re-entering his own PIN
    if (action === "close_day") {
      const shopId = String(body.shop_id ?? "");
      if (!PIN_RE.test(pin) || !shopId) return json({ error: "wrong" }, 401);
      const r = await admin.rpc("auth_check_pin", { p_uid: me.id, p_pin: pin });
      if (r.error) return json({ error: "server" }, 500);
      if (r.data === "LOCKED") return json({ error: "locked" }, 429);
      if (!r.data) return json({ error: "wrong" }, 401);
      const c = await admin.rpc("owner_close_day", { p_shop: shopId, p_owner: me.id });
      if (c.error) return json({ error: "server" }, 500);
      return json({ closed: c.data === true });
    }

    if (action === "create_user") {
      if (!name) return json({ error: "name" }, 400);
      if (!PIN_RE.test(pin)) return json({ error: "pin" }, 400);
      const acc = await createAccount(name, "cashier", pin);
      return json({ id: acc.id });
    }
    if (action === "set_pin") {
      const userId = String(body.user_id ?? "");
      if (!PIN_RE.test(pin)) return json({ error: "pin" }, 400);
      const p = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      if (!p.data) return json({ error: "not_found" }, 404);
      if (p.data.role === "admin" && !/^\d{6,8}$/.test(pin)) return json({ error: "admin_pin" }, 400);
      const s = await admin.rpc("set_secret", { p_uid: userId, p_pin: pin, p_pass: null });
      if (s.error) return json({ error: "server" }, 500);
      return json({ ok: true });
    }
    if (action === "set_active") {
      const userId = String(body.user_id ?? "");
      const active = body.active === true;
      const p = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      if (!p.data) return json({ error: "not_found" }, 404);
      if (p.data.role === "admin") return json({ error: "forbidden" }, 403);
      const u = await admin.from("profiles").update({ active }).eq("id", userId);
      if (u.error) return json({ error: "server" }, 500);
      // end any open session of a stopped account
      await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
      return json({ ok: true });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "server" }, 500);
  }
});
