alter table public.notes add column attendance_shift uuid references public.hr_shifts(id);
do $patch$ declare definition text; needle text; begin
 select pg_get_functiondef('public.hr_reminders()'::regprocedure) into definition;
 needle:='insert into public.notes(text,kind) values(s.name||'': الوردية ما زالت مفتوحة (تذكير الحضور)'',''attendance'');';
 if position(needle in definition)=0 then raise exception 'Reminder insert not found';end if;
 execute replace(definition,needle,'insert into public.notes(text,kind,attendance_shift) values(s.name||'': الوردية ما زالت مفتوحة (تذكير الحضور)'',''attendance'',s.id);');
end $patch$;
