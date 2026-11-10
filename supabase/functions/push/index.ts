// Sends each new owner notification to the owner's phones through Firebase Cloud Messaging.
// Called only by the database trigger, which proves itself with a shared secret.
// Needs the FCM_SERVICE_ACCOUNT secret (the Firebase service account JSON); without it, it does nothing.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

let cached: { token: string; exp: number } | null = null;
async function accessToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp > now + 60) return cached.token;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
  });
  const t = await r.json();
  if (!t.access_token) throw new Error("oauth: " + JSON.stringify(t));
  cached = { token: t.access_token, exp: now + (t.expires_in ?? 3600) };
  return cached.token;
}

const TITLES: Record<string, string> = { tx: "حركة جديدة", del: "حركة اتمسحت", close: "يوم اتقفل" };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const ok = await admin.rpc("push_secret_ok", { p_secret: req.headers.get("x-push-secret") ?? "" });
  if (ok.error || ok.data !== true) return json({ error: "forbidden" }, 403);
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) return json({ skipped: "no FCM_SERVICE_ACCOUNT" });
  const sa = JSON.parse(raw);
  const { text, kind, id } = await req.json();
  let shiftId = "";
  if(kind === "attendance" && typeof id === "string"){
    const target = await admin.from("notes").select("attendance_shift").eq("id",id).maybeSingle();
    shiftId = target.data?.attendance_shift ?? "";
  }

  const owners = await admin.from("profiles").select("id").eq("role", "admin").eq("active", true);
  const ids = (owners.data ?? []).map((o) => o.id);
  if (!ids.length) return json({ sent: 0 });
  const toks = await admin.from("push_tokens").select("token").in("user_id", ids);
  const tokens = (toks.data ?? []).map((t) => t.token);
  if (!tokens.length) return json({ sent: 0 });

  const at = await accessToken(sa);
  let sent = 0;
  for (const token of tokens) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: {
        token,
        notification: { title: TITLES[kind] ?? "اليومية", body: text },
        data: { kind: String(kind ?? ""), id: String(id ?? ""), ...(shiftId ? {module:"attendance",shift_id:shiftId} : {}) },
        android: { priority: "high", notification: { sound: "default", tag: String(id ?? "") } },
      } }),
    });
    if (r.ok) sent++;
    else if (r.status === 404 || r.status === 400) {
      const e = await r.text();
      if (/UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(e)) await admin.from("push_tokens").delete().eq("token", token);
    }
  }
  return json({ sent });
});
