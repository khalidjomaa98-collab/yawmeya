/* Freeze the page and its nested ledger scroller while a sheet is visible. */
window.HCashModalScroll=(()=>{
 let saved=null;
 const styleKeys=['position','top','left','right','width','overflow'];
 function sync(open){
  if(open&&!saved){
   const body=document.body;const inline={};for(const key of styleKeys)inline[key]=body.style[key];
   saved={x:window.scrollX,y:window.scrollY,inline,rootOverflow:document.documentElement.style.overflow};
   document.documentElement.style.overflow='hidden';
   Object.assign(body.style,{position:'fixed',top:-saved.y+'px',left:'0',right:'0',width:'100%',overflow:'hidden'});
   body.classList.add('modal-open');
  }else if(!open&&saved){
   const old=saved;saved=null;const body=document.body;body.classList.remove('modal-open');
   for(const key of styleKeys)body.style[key]=old.inline[key];
   document.documentElement.style.overflow=old.rootOverflow;
   window.scrollTo(old.x,old.y);
  }
 }
 function guard(event){
  if(!saved||event.ctrlKey||event.touches?.length>1)return;
  if(!event.target.closest?.('.sheet,.receipt-card'))event.preventDefault();
 }
 document.addEventListener('touchmove',guard,{passive:false});
 document.addEventListener('wheel',guard,{passive:false});
 return {sync};
})();

