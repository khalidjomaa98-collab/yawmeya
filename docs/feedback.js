/* Visual acknowledgement only. Never triggers a control or changes financial state. */
window.HCashFeedback=(()=>{
 const selector='button,a.btn,summary,[role="button"]';
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 let press=null;
 function target(node){const b=node?.closest?.(selector);return b&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'?b:null;}
 function clear(){if(press)press.el.classList.remove('is-pressed');press=null;}
 function echo(el){
  if(reduced()||!el.isConnected)return;
  const box=el.getBoundingClientRect(),style=getComputedStyle(el);if(!box.width||!box.height)return;
  // Lives outside #app so synchronous redraws cannot swallow the acknowledgement.
  const mark=document.createElement('span');mark.className='tap-echo';mark.setAttribute('aria-hidden','true');
  Object.assign(mark.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px',borderRadius:style.borderRadius,color:style.color});
  document.body.append(mark);setTimeout(()=>mark.remove(),280);
 }
 document.addEventListener('pointerdown',event=>{
  clear();if(event.isPrimary===false||event.button!==0)return;const el=target(event.target);if(!el)return;
  press={el,id:event.pointerId,x:event.clientX,y:event.clientY};el.classList.add('is-pressed');
 },{passive:true,capture:true});
 document.addEventListener('pointermove',event=>{if(press&&event.pointerId===press.id&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>10)clear();},{passive:true,capture:true});
 document.addEventListener('pointerup',event=>{
  if(!press||event.pointerId!==press.id)return;const el=press.el;
  const box=el.getBoundingClientRect();const inside=event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom;
  clear();if(inside)echo(el);
 },{passive:true,capture:true});
 document.addEventListener('pointercancel',clear,{passive:true,capture:true});
 document.addEventListener('scroll',clear,{passive:true,capture:true});
 window.addEventListener('blur',clear);document.addEventListener('visibilitychange',clear);
 document.addEventListener('click',event=>{if(event.detail===0){const el=target(event.target);if(el)echo(el);}},{capture:true,passive:true});
 return {confirmed(){try{if(!reduced())navigator.vibrate?.(12);}catch(_){}}};
})();
