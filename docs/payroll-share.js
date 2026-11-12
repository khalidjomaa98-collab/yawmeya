/* Generate the report on this device. No uploads or external rendering service. */
window.PayrollShare = {
  async create(payroll, employee, payments) {
    if(document.fonts)await document.fonts.ready;
    const n=v=>Number(v||0).toLocaleString('en-US',{maximumFractionDigits:2});
    const paid=payments.reduce((sum,p)=>sum+Math.round(Number(p.amount)*100),0)/100;
    const lines=[['H-Cash · كشف مرتب',true],[employee.name,true],
      [`الفترة: ${payroll.period_start} إلى ${payroll.period_end}`],
      [payroll.status==='approved'?'معتمد':'مسودة للمراجعة · ليست إثبات صرف'],
      [`وقت العمل: ${n(Number(payroll.work_minutes)/60)} ساعة`],
      [`أجر الساعات: ${n(payroll.gross)} ج.م`]];
    for(const a of payroll.adjustments||[])lines.push([`${({bonus:'مكافأة',deduction:'خصم',advance:'سلفة'})[a.kind]||a.kind}: ${n(a.amount)} ج.م · ${a.reason}`]);
    lines.push([`صافي المرتب: ${n(payroll.net)} ج.م`,true]);
    const days=window.Attendance?.dailyRows(payroll)||[];
    if(days.length)lines.push(['الحضور والانصراف حسب اليوم',true]);
    for(const day of days){
      lines.push([`${day.day} · ${n(day.minutes/60)} ساعة`,true]);
      for(const interval of day.intervals)lines.push([`الحضور ${interval.start} · الانصراف ${interval.end}`]);
    }
    if(payroll.snapshot?.open_shifts)lines.push(['في وردية مفتوحة. وقتها محسوب حتى عرض الكشف.']);
    if(payroll.snapshot?.pending_corrections)lines.push(['في طلب تعديل انصراف تحت المراجعة.']);
    if(payroll.status==='approved'){
      lines.push([`المدفوع: ${n(paid)} ج.م`,true],[`المتبقي: ${n(Number(payroll.net)-paid)} ج.م`,true],['الدفعات المسجلة']);
      for(const p of payments)lines.push([`${p.paid_on} · ${n(p.amount)} ج.م · ${p.note||'دفعة مرتب'}`]);
    }
    lines.push(['التسجيل للتوثيق، وليس تحويلًا ماليًا.']);
    const probe=document.createElement('canvas').getContext('2d');probe.font='30px "IBM Plex Sans Arabic", Tahoma, sans-serif';
    const wrapped=[];
    for(const [text,bold] of lines){
      let row='';for(const word of String(text).split(/\s+/)){if(row&&probe.measureText(row+' '+word).width>880){wrapped.push([row,bold]);row=word;}else row+=(row?' ':'')+word;}wrapped.push([row,bold]);
    }
    const files=[];
    for(let offset=0;offset<wrapped.length;offset+=32){
      const rows=wrapped.slice(offset,offset+32),canvas=document.createElement('canvas');canvas.width=1000;canvas.height=180+rows.length*60;
      const c=canvas.getContext('2d');c.fillStyle='#f1f3f7';c.fillRect(0,0,1000,canvas.height);c.fillStyle='#ffffff';c.fillRect(24,24,952,canvas.height-48);
      c.direction='rtl';c.textAlign='right';c.textBaseline='middle';
      rows.forEach(([text,bold],i)=>{c.fillStyle=bold?'#102a35':'#303b4b';c.font=`${bold?'700':'400'} ${bold?36:30}px "IBM Plex Sans Arabic", Tahoma, sans-serif`;c.fillText(text,940,85+i*60,880);});
      c.font='22px Tahoma';c.fillStyle='#657184';c.fillText(`صفحة ${files.length+1} · ${new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',dateStyle:'medium',timeStyle:'short'}).format(new Date())}`,940,canvas.height-65);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('تعذر تجهيز صورة الكشف');
      files.push(new File([blob],`payroll-${payroll.period_start}-${files.length+1}.png`,{type:'image/png'}));
    }
    return files;
  },
  async share(payroll,employee,payments){
    const files=await this.create(payroll,employee,payments);
    const cap=window.Capacitor;
    if(cap?.isNativePlatform?.()){
      if(!cap.isPluginAvailable?.('Share')||!cap.isPluginAvailable?.('Filesystem'))throw new Error('المشاركة المباشرة محتاجة APK الجديد. تقدر تستخدم معاينة الصورة حاليًا.');
      const uris=[];
      for(let i=0;i<files.length;i++){
        const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(files[i]);});
        const result=await cap.Plugins.Filesystem.writeFile({path:`payroll-${Date.now()}-${i}.png`,data,directory:'CACHE'});uris.push(result.uri);
      }
      await cap.Plugins.Share.share({title:'كشف مرتب · '+employee.name,files:uris,dialogTitle:'مشاركة كشف المرتب'});
      return 'تم فتح مشاركة الكشف';
    }
    if(navigator.share&&navigator.canShare?.({files})){
      try{await navigator.share({files,title:'كشف مرتب · '+employee.name});return 'تم فتح مشاركة الكشف';}
      catch(error){if(error.name==='AbortError')return 'تم إلغاء المشاركة';if(error.name!=='NotAllowedError')throw error;}
    }
    for(const file of files){const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
    return 'تم تنزيل صورة الكشف؛ تقدر تشاركها من الصور أو التنزيلات';
  }
};
