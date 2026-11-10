import {createClient} from 'npm:@supabase/supabase-js@2.45.4';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-push-secret'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
const must=(r:any)=>{if(r.error)throw Error('database');return r.data;};
async function owner(req:Request){
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return false;
 const {data,error}=await db.auth.getUser(token);if(error||!data.user)return false;
 const profile=await db.from('profiles').select('role,active').eq('id',data.user.id).maybeSingle();return profile.data?.role==='admin'&&profile.data.active===true;
}
async function digest(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function readBackup(id:string){
 const row=must(await db.from('hcash_backups').select('*').eq('id',id).single());if(row.status!=='ready'||!row.path)throw Error('not_ready');
 const blob=must(await db.storage.from('hcash-backups').download(row.path));const raw=await blob.text();if(await digest(raw)!==row.sha256)throw Error('checksum');
 return {row,doc:JSON.parse(raw)};
}
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply({error:'method'},405);
 let jobId:string|null=null;
 try{
  const body=await req.json();let scheduled=false;
  if(body.action==='scheduled'){
   const secret=req.headers.get('x-push-secret');if(!secret)return reply({error:'forbidden'},403);
   const check=await db.rpc('push_secret_ok',{p_secret:secret});if(check.error||check.data!==true)return reply({error:'forbidden'},403);scheduled=true;
  }
  if(!scheduled&&!await owner(req))return reply({error:'forbidden'},403);
  if(body.action==='create'||body.action==='pre_wipe'||scheduled){
   const row=must(await db.from('hcash_backups').insert({status:'working'}).select('id').single());jobId=row.id;
   const doc=must(await db.rpc('hcash_backup_snapshot'));
   // Rebuild in temporary tables first. A partial/unrestorable export never
   // appears as a ready backup and never mutates live business records.
   const validation=must(await db.rpc('hcash_check_backup',{p_doc:doc}));
   const raw=JSON.stringify(doc),sha256=await digest(raw),path=`daily/${new Date().toISOString().slice(0,10)}/${jobId}.json`;
   must(await db.storage.from('hcash-backups').upload(path,new Blob([raw],{type:'application/json'}),{contentType:'application/json',upsert:false}));
   must(await db.from('hcash_backups').update({status:'ready',path,sha256,bytes:new TextEncoder().encode(raw).length,row_counts:validation.reconstructed_rows,checked_at:new Date().toISOString()}).eq('id',jobId));
   return reply({id:jobId,status:'ready',checked:true,counts:validation.reconstructed_rows,...(body.action==='pre_wipe'?{snapshot:doc}:{})});
  }
  if(body.action==='list')return reply({backups:must(await db.from('hcash_backups').select('id,created_at,status,bytes,checked_at,row_counts').order('created_at',{ascending:false}).limit(30))});
  if(body.action==='check'||body.action==='download'){
   if(typeof body.id!=='string'||!/^[-a-f0-9]{36}$/i.test(body.id))return reply({error:'id'},400);
   const {row,doc}=await readBackup(body.id);
   if(body.action==='check'){const validation=must(await db.rpc('hcash_check_backup',{p_doc:doc}));must(await db.from('hcash_backups').update({checked_at:new Date().toISOString()}).eq('id',body.id));return reply(validation);}
   const signed=must(await db.storage.from('hcash-backups').createSignedUrl(row.path,60,{download:'H-Cash-backup.json'}));return reply({url:signed.signedUrl,expires_in:60});
  }
  return reply({error:'action'},400);
 }catch(_){
  if(jobId)await db.from('hcash_backups').update({status:'failed',error:'backup_failed'}).eq('id',jobId);
  return reply({error:'backup_failed'},500);
 }
});
