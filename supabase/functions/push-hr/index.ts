import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const enc=(o:unknown)=>b64(new TextEncoder().encode(JSON.stringify(o)));
let cached:{token:string,until:number}|null=null;
async function googleToken(sa:{client_email:string;private_key:string}){
 const now=Math.floor(Date.now()/1000);
 if(cached&&cached.until>now+60)return cached.token;
 const der=Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g,"").replace(/\s/g,"")),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey("pkcs8",der,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
 const body=enc({alg:"RS256",typ:"JWT"})+"."+enc({iss:sa.client_email,scope:"https://www.googleapis.com/auth/firebase.messaging",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600});
 const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(body));
 const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:body+"."+b64(new Uint8Array(sig))})});
 const j=await r.json();if(!r.ok||!j.access_token)throw Error("FCM_AUTH");
 cached={token:j.access_token,until:now+Number(j.expires_in||3600)};return cached.token;
}
Deno.serve(async(req)=>{
 try{
  if(req.method!=="POST")return reply({error:"method"},405);
  const supplied=req.headers.get("x-push-secret")||"";
  if(!supplied)return reply({error:"forbidden"},403);
  const check=await db.rpc("push_secret_ok",{p_secret:supplied});
  if(check.error||check.data!==true)return reply({error:"forbidden"},403);
  const {id}=await req.json();if(typeof id!=="string"||!/^[a-f0-9-]{36}$/i.test(id))return reply({error:"id"},400);
  const {data:alert,error}=await db.from("hr_alerts").select("id,employee_id,text").eq("id",id).maybeSingle();
  if(error)throw Error("ALERT_QUERY");if(!alert)return reply({sent:0});
  const {data:employee}=await db.from("profiles").select("active").eq("id",alert.employee_id).maybeSingle();
  if(!employee?.active)return reply({sent:0});
  const {data:phones,error:phoneError}=await db.from("push_tokens").select("token").eq("user_id",alert.employee_id);
  if(phoneError)throw Error("PHONE_QUERY");if(!phones?.length)return reply({sent:0});
  const raw=Deno.env.get("FCM_SERVICE_ACCOUNT");if(!raw)return reply({error:"not_configured"},503);
  const sa=JSON.parse(raw),token=await googleToken(sa);let sent=0,failed=0;
  for(const phone of phones){
   const r=await fetch("https://fcm.googleapis.com/v1/projects/"+encodeURIComponent(sa.project_id)+"/messages:send",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({message:{token:phone.token,notification:{title:"اليومية · الحضور",body:alert.text},data:{module:"attendance",alert_id:alert.id},android:{priority:"high",notification:{sound:"default",tag:"hr-"+alert.id}}}})});
   if(r.ok){sent++;continue;}
   failed++;const e=await r.json().catch(()=>({}));
   if(e.error?.details?.some((x:{errorCode?:string})=>x.errorCode==="UNREGISTERED"))await db.from("push_tokens").delete().eq("token",phone.token);
  }
  return reply({sent,failed});
 }catch(_){return reply({error:"push_failed"},500);}
});
