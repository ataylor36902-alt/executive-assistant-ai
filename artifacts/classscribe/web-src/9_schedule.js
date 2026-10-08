/* ---------- CLASS SCHEDULE ---------- */
// course.meetings = [{ days:['Mon','Wed'], start:'09:00', end:'09:50', location:'Science Hall 101', type:'Lecture' }]
const WEEK=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WEEK_LONG=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MEET_TYPES=['Lecture','Lab','Discussion','Seminar','Recitation','Office hours'];
(function seedExampleTimes(){
  if(EX.courses['ex-bio']&&!EX.courses['ex-bio'].meetings)EX.courses['ex-bio'].meetings=[{days:['Mon','Wed','Fri'],start:'09:00',end:'09:50',location:'Science Hall 101',type:'Lecture'},{days:['Tue'],start:'14:00',end:'15:50',location:'Bio Lab 3',type:'Lab'}];
  if(EX.courses['ex-chem']&&!EX.courses['ex-chem'].meetings)EX.courses['ex-chem'].meetings=[{days:['Tue','Thu'],start:'11:00',end:'12:15',location:'Chemistry 204',type:'Lecture'}];
})();
const toMin=hm=>{const m=String(hm||'').match(/^(\d{1,2}):(\d{2})/);return m?(+m[1])*60+(+m[2]):null};
function fmtClock(hm){const m=toMin(hm);if(m==null)return'';const d=new Date(2000,0,1,Math.floor(m/60),m%60);return d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}
function fmtRange(a,b){return b?`${fmtClock(a)}–${fmtClock(b)}`:fmtClock(a)}
function daysText(days){const order=WEEK.filter(d=>(days||[]).includes(d));if(order.join()==='Mon,Wed,Fri')return'Mon, Wed, Fri';if(order.join()==='Tue,Thu')return'Tue & Thu';return order.join(', ')}
function meetingsText(c){return (c.meetings||[]).map(m=>`${daysText(m.days)} · ${fmtRange(m.start,m.end)}${m.location?' · '+m.location:''}${m.type&&m.type!=='Lecture'?' ('+m.type+')':''}`)}
// All class sessions on a given date, sorted by start time
function classesOn(date){
  const dn=WEEK[date.getDay()];const out=[];
  coursesSorted().forEach(c=>(c.meetings||[]).forEach(m=>{if((m.days||[]).includes(dn)&&toMin(m.start)!=null)out.push({c,m,start:toMin(m.start),end:toMin(m.end)??toMin(m.start)+50})}));
  return out.sort((a,b)=>a.start-b.start);
}
// The class happening now (15 minutes early counts), or null
function currentClass(now=new Date()){const mins=now.getHours()*60+now.getMinutes();return classesOn(now).find(x=>mins>=x.start-15&&mins<=x.end)||null}
// Minutes from now until the course's next session (Infinity if it has no times)
function nextMeetingIn(c,now=new Date()){
  let best=Infinity;const mins=now.getHours()*60+now.getMinutes();
  (c.meetings||[]).forEach(m=>(m.days||[]).forEach(d=>{const di=WEEK.indexOf(d);if(di<0||toMin(m.start)==null)return;let delta=((di-now.getDay()+7)%7)*1440+toMin(m.start)-mins;if(delta<-((toMin(m.end)??toMin(m.start)+50)-toMin(m.start)))delta+=7*1440;best=Math.min(best,delta)}));
  return best;
}
function nextMeetingLabel(c){
  const d=nextMeetingIn(c);if(d===Infinity)return'';if(d<=0)return'In class now';
  const now=new Date();const at=new Date(now.getTime()+d*60000);
  const day=at.toDateString()===now.toDateString()?'Today':(new Date(now.getTime()+86400000)).toDateString()===at.toDateString()?'Tomorrow':WEEK_LONG[at.getDay()];
  return `${day} ${at.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`;
}
function todayCardHTML(){
  const now=new Date();const mins=now.getHours()*60+now.getMinutes();const list=classesOn(now);
  const anyTimes=coursesSorted().some(c=>(c.meetings||[]).length);
  if(!anyTimes)return `<section class="panel" style="margin-top:18px"><div class="spread"><div><h3>Today’s classes</h3><p class="small muted" style="margin-top:4px">Add your class times to see your day in order and record with one tap.</p></div><button class="btn sm primary" data-act="schedImport">${ic('upload')}Upload schedule</button></div></section>`;
  const nextIdx=list.findIndex(x=>x.end>=mins);
  let nextOther='';if(!list.length){const up=coursesSorted().map(c=>({c,d:nextMeetingIn(c)})).filter(x=>x.d<Infinity).sort((a,b)=>a.d-b.d)[0];if(up)nextOther=`Next: ${esc(up.c.code)} ${esc(nextMeetingLabel(up.c))}`}
  return `<section class="panel" style="margin-top:18px"><div class="spread"><h3>Today · ${WEEK_LONG[now.getDay()]}</h3><button class="btn sm ghost" ${goAttr({name:'schedule'})}>${ic('cal')}Full schedule</button></div>
  <div class="list" style="margin-top:6px">${list.map((x,i)=>{const nowOn=mins>=x.start-15&&mins<=x.end;const past=x.end<mins;
    return `<div class="li" style="${past?'opacity:.55':''}"><span class="mono" style="width:112px;flex:none">${fmtRange(x.m.start,x.m.end)}</span><div class="grow"><div class="row" style="gap:6px">${codeChip(x.c)}<b>${esc(x.c.name)}</b>${nowOn?'<span class="chip rec">Now</span>':i===nextIdx?'<span class="chip ok">Next</span>':''}</div><div class="small muted">${esc([x.m.type,x.m.location].filter(Boolean).join(' · '))}</div></div>${past?'':`<button class="btn sm ${nowOn?'rec':''}" ${goAttr({name:'capture',courseId:x.c.id})}>${ic('mic')}Record</button>`}</div>`}).join('')||`<p class="small muted" style="padding:10px 0">No classes today.${nextOther?' '+nextOther+'.':''}</p>`}</div></section>`;
}
VIEWS.schedule=v=>{
  const cs=coursesSorted();const today=new Date();const di=v.day!=null?+v.day:today.getDay();
  const d=new Date();d.setDate(d.getDate()+((di-today.getDay()+7)%7));
  const list=classesOn(d);const isToday=di===today.getDay();const mins=today.getHours()*60+today.getMinutes();
  const noTimes=cs.filter(c=>!(c.meetings||[]).length&&!c.ex);
  const dayChips=[1,2,3,4,5,6,0].map(i=>{const n=(()=>{const x=new Date();x.setDate(x.getDate()+((i-today.getDay()+7)%7));return classesOn(x).length})();
    return `<button class="btn sm ${i===di?'primary':''}" ${goAttr({name:'schedule',day:i})} aria-pressed="${i===di}">${WEEK[i]}${i===today.getDay()?' · Today':''}${n?` <span class="small" style="opacity:.75">${n}</span>`:''}</button>`}).join('');
  return `<div class="page-h"><div><p class="eyebrow">${esc((S.profile&&S.profile.term)||curSemester())}</p><h1>${isToday?'Today':WEEK_LONG[di]}</h1><p class="sub">${esc(d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}))} · ${plural(list.length,'class','classes')}</p></div><button class="btn primary" data-act="schedImport">${ic('upload')}Upload schedule</button></div>
  <div class="row" style="gap:6px;margin-bottom:16px" role="group" aria-label="Pick a day">${dayChips}</div>
  <section class="panel"><div class="list">${list.map(x=>{const nowOn=isToday&&mins>=x.start-15&&mins<=x.end;const past=isToday&&x.end<mins;
     return `<div class="li" style="${past?'opacity:.55':''}"><span class="mono" style="width:112px;flex:none">${fmtRange(x.m.start,x.m.end)}</span><button class="grow" ${goAttr({name:'course',id:x.c.id})} style="all:unset;cursor:pointer;flex:1;min-width:0"><span class="row" style="gap:6px">${codeChip(x.c)}<b>${esc(x.c.name)}</b>${nowOn?'<span class="chip rec">Now</span>':''}</span><span class="small muted" style="display:block">${esc([x.m.type,x.m.location,x.c.professor].filter(Boolean).join(' · '))}</span></button>${past||x.c.ex?'':`<button class="btn sm ${nowOn?'rec':''}" ${goAttr({name:'capture',courseId:x.c.id})}>${ic('mic')}Record</button>`}</div>`}).join('')||`<p class="muted" style="padding:14px 0">No classes on ${WEEK_LONG[di]}.</p>`}</div></section>
  ${noTimes.length?`<section class="panel" style="margin-top:14px"><h3>Courses without class times</h3><div class="list" style="margin-top:4px">${noTimes.map(c=>`<div class="li">${codeChip(c)}<span class="grow">${esc(c.name)}</span><button class="btn sm" data-act="editTimes" data-id="${esc(c.id)}">Add times</button></div>`).join('')}</div></section>`:''}`;
};

/* ---- edit one course's times ---- */
let TIMES=null;
ACT.editTimes=el=>{const c=course(el.dataset.id);if(!c||isExampleRecord('courses',c))return;TIMES={id:c.id,rows:clone(c.meetings||[])};if(!TIMES.rows.length)TIMES.rows.push({days:[],start:'',end:'',location:'',type:'Lecture'});renderTimes()};
function renderTimes(){
  const c=course(TIMES.id);
  openModal(`<div class="spread"><h2>${esc(c.code)} class times</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
  <div class="stack" id="times-rows">${TIMES.rows.map((m,i)=>`<div class="panel stack" style="gap:10px;background:var(--surface-2);border:0">
    <div class="row" style="gap:4px" role="group" aria-label="Days">${WEEK.slice(1).concat('Sun').map(d=>`<button class="btn sm ${m.days.includes(d)?'primary':''}" data-act="tmDay" data-i="${i}" data-d="${d}" aria-pressed="${m.days.includes(d)}">${d}</button>`).join('')}</div>
    <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,130px),1fr))"><label class="f">Starts<input class="in" type="time" data-tm="start" data-i="${i}" value="${esc(m.start)}"></label><label class="f">Ends<input class="in" type="time" data-tm="end" data-i="${i}" value="${esc(m.end)}"></label><label class="f">Type<select class="in" data-tm="type" data-i="${i}">${MEET_TYPES.map(t=>`<option ${t===m.type?'selected':''}>${t}</option>`).join('')}</select></label></div>
    <div class="row"><label class="f" style="flex:1">Room<input class="in" data-tm="location" data-i="${i}" value="${esc(m.location||'')}" placeholder="Science Hall 101"></label><button class="btn sm ghost" data-act="tmDel" data-i="${i}" style="align-self:flex-end">${ic('x')}Remove</button></div></div>`).join('')}</div>
  <div class="row"><button class="btn" data-act="tmAdd">${ic('plus')}Add another time</button><span style="flex:1"></span><button class="btn primary" data-act="tmSave">Save times</button></div>`,{wide:true});
}
function readTimes(){$$('[data-tm]').forEach(e=>{TIMES.rows[+e.dataset.i][e.dataset.tm]=e.value})}
ACT.tmDay=el=>{if(!TIMES||isExampleRecord('courses',course(TIMES.id)))return;readTimes();const m=TIMES.rows[+el.dataset.i];const d=el.dataset.d;m.days=m.days.includes(d)?m.days.filter(x=>x!==d):[...m.days,d];renderTimes()};
ACT.tmAdd=()=>{if(!TIMES||isExampleRecord('courses',course(TIMES.id)))return;readTimes();TIMES.rows.push({days:[],start:'',end:'',location:'',type:'Lecture'});renderTimes()};
ACT.tmDel=el=>{if(!TIMES||isExampleRecord('courses',course(TIMES.id)))return;readTimes();TIMES.rows.splice(+el.dataset.i,1);renderTimes()};
ACT.tmSave=()=>{if(!TIMES||isExampleRecord('courses',course(TIMES.id)))return;readTimes();const rows=TIMES.rows.filter(m=>m.days.length&&m.start);const c=course(TIMES.id);put('courses',{...c,meetings:rows});closeModal();toast(rows.length?'Class times saved':'Class times cleared')};

/* ---- upload a schedule: paste, file (.txt/.csv/.ics), or a photo/screenshot ---- */
let SCHED_IMG=null,SCHED_IMG_URL=null,SCHED_IMG_CHECK=0;
const SCHED_IMG_MAX=8*1024*1024;
function clearScheduleImage(){
  SCHED_IMG_CHECK++;
  if(SCHED_IMG_URL)URL.revokeObjectURL(SCHED_IMG_URL);
  SCHED_IMG=null;SCHED_IMG_URL=null;
  const input=$('#sch-img');if(input)input.value='';
  const preview=$('#sch-img-preview');if(preview)preview.innerHTML='';
}
function scheduleStatus(message,error=false){
  const el=$('#sch-status');if(el){el.textContent=message;el.style.color=error?'var(--rec)':'';el.setAttribute('role',error?'alert':'status')}
}
ACT.schedImport=()=>{clearScheduleImage();openModal(`<div class="spread"><h2>Upload your class schedule</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
  <p class="muted small">Paste it, upload your school’s calendar file (.ics) or a text/CSV export, or add a screenshot or photo of your schedule. ClassScribe adds the days, times and rooms to your courses and creates any courses you don’t have yet.</p>
  <textarea class="in" id="sch-text" rows="7" placeholder="BIO 101  Intro to Biology  MWF 9:00–9:50 AM  Science Hall 101&#10;CHEM 110  General Chemistry  TTh 11:00–12:15  Chemistry 204"></textarea>
  <div class="row"><label class="btn sm">${ic('upload')}Upload file<input type="file" id="sch-file" accept=".ics,.txt,.csv,text/calendar,text/plain,text/csv" hidden></label><label class="btn sm" style="cursor:pointer">${ic('camera')}Upload screenshot or photo<input type="file" id="sch-img" accept="image/jpeg,image/png,image/webp,image/gif" hidden></label></div>
  <p class="small muted" style="margin-top:7px">Screenshot formats: JPEG, PNG, WebP or GIF · up to 8 MB. The image is read by the existing AI schedule importer.</p>
  <div id="sch-img-preview" style="margin-top:8px"></div><p class="small muted" id="sch-status" role="status" aria-live="polite"></p>
  <div class="row"><button class="btn primary" data-act="schedRun" id="sch-go">${ic('spark')}Add to my courses</button></div><div id="sch-out"></div>`)};
function parseICS(text){
  const evs=text.replace(/\r?\n[ \t]/g,'').split('BEGIN:VEVENT').slice(1).map(b=>{const get=k=>{const m=b.match(new RegExp('^'+k+'(?:;[^:\\n]*)?:(.*)$','m'));return m?m[1].trim():''};return{sum:get('SUMMARY'),loc:get('LOCATION').replace(/\\,/g,','),start:get('DTSTART'),end:get('DTEND'),rrule:get('RRULE')}});
  const map={MO:'Mon',TU:'Tue',WE:'Wed',TH:'Thu',FR:'Fri',SA:'Sat',SU:'Sun'};const byCode={};
  evs.forEach(e=>{const tm=s=>{const m=s.match(/T(\d{2})(\d{2})/);return m?m[1]+':'+m[2]:''};let days=[];const bd=(e.rrule.match(/BYDAY=([A-Z,]+)/)||[])[1];
    if(bd)days=bd.split(',').map(x=>map[x.slice(-2)]).filter(Boolean);else{const m=e.start.match(/^(\d{4})(\d{2})(\d{2})/);if(m)days=[WEEK[new Date(+m[1],+m[2]-1,+m[3]).getDay()]]}
    const code=((e.sum.match(/\b[A-Z]{2,5}\s?-?\d{3}[A-Z]?\b/)||[])[0]||e.sum.slice(0,24)).replace('-',' ').replace(/([A-Z])(\d)/,'$1 $2');
    const type=/lab/i.test(e.sum)?'Lab':/disc|recit/i.test(e.sum)?'Discussion':'Lecture';
    const c=byCode[code]=byCode[code]||{code,name:e.sum.replace(code,'').replace(/^[\s\-–:]+/,'').trim()||code,meetings:[]};
    const key=[tm(e.start),tm(e.end),e.loc,type].join('|');const ex=c.meetings.find(x=>[x.start,x.end,x.location,x.type].join('|')===key);
    if(ex)ex.days=[...new Set([...ex.days,...days])];else if(tm(e.start))c.meetings.push({days,start:tm(e.start),end:tm(e.end),location:e.loc,type});});
  return Object.values(byCode);
}
document.addEventListener('change',e=>{const t=e.target;
  if(t.id==='sch-file'&&t.files[0]){t.files[0].text().then(x=>{$('#sch-text').value=x;$('#sch-status').textContent=t.files[0].name})}
  if(t.id==='sch-img'&&t.files[0]){
    const file=t.files[0],supported=['image/jpeg','image/png','image/webp','image/gif'];
    clearScheduleImage();const check=SCHED_IMG_CHECK;
    const run=$('#sch-go');if(run)run.disabled=true;
    if(file.size>SCHED_IMG_MAX){t.value='';scheduleStatus('This image is larger than 8 MB. Choose a smaller screenshot or paste the schedule text.',true);if(run)run.disabled=false;return}
    if(!supported.includes(file.type)){t.value='';scheduleStatus('Unsupported image type. Choose a JPEG, PNG, WebP or GIF screenshot, or paste the schedule text.',true);if(run)run.disabled=false;return}
    file.slice(0,12).arrayBuffer().then(buffer=>{
      if(check!==SCHED_IMG_CHECK)return;
      const b=new Uint8Array(buffer);let actual='';
      if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)actual='image/jpeg';
      else if([137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n))actual='image/png';
      else if(/^GIF8[79]a$/.test(String.fromCharCode(...b.slice(0,6))))actual='image/gif';
      else if(String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')actual='image/webp';
      if(!actual||actual!==file.type){t.value='';scheduleStatus('The selected file does not match a supported image format. Save or export it as JPEG, PNG, WebP or GIF and try again.',true);if(run)run.disabled=false;return}
      SCHED_IMG=file;SCHED_IMG_URL=URL.createObjectURL(file);
      const preview=$('#sch-img-preview');if(preview)preview.innerHTML=`<div class="row" style="align-items:flex-start"><img src="${SCHED_IMG_URL}" alt="Preview of ${esc(file.name)}" style="display:block;max-width:min(100%,420px);max-height:220px;object-fit:contain;border:1px solid var(--line);border-radius:10px"><div class="stack" style="gap:7px"><span class="small">${esc(file.name)} · ${(file.size/1024/1024).toFixed(1)} MB</span><button class="btn sm ghost" data-act="schedRemoveImage" type="button">${ic('x')}Remove screenshot</button></div></div>`;
      scheduleStatus('Screenshot ready to send to the AI schedule importer.');
      if(run)run.disabled=false;
    }).catch(()=>{if(check!==SCHED_IMG_CHECK)return;t.value='';scheduleStatus('Could not read this image. Choose another screenshot or paste the schedule text.',true);if(run)run.disabled=false});
  }
});
ACT.schedRemoveImage=()=>{clearScheduleImage();scheduleStatus('Screenshot removed.');const run=$('#sch-go');if(run)run.disabled=false};
async function applySchedule(list){
  let added=0,updated=0;const semester=(S.profile&&S.profile.term)||curSemester(),semesterKey=value=>String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase(),targetSemester=semesterKey(semester);
  for(const x of list){
    if(!x||!x.code)continue;const code=String(x.code).trim().toUpperCase().replace(/\s+/g,' ');
    const meetings=(x.meetings||[]).map(m=>({days:(m.days||[]).map(d=>WEEK.find(w=>w.toLowerCase()===String(d).slice(0,3).toLowerCase())).filter(Boolean),start:/^\d{1,2}:\d{2}$/.test(m.start||'')?m.start.padStart(5,'0'):'',end:/^\d{1,2}:\d{2}$/.test(m.end||'')?m.end.padStart(5,'0'):'',location:m.location||'',type:MEET_TYPES.includes(m.type)?m.type:'Lecture'})).filter(m=>m.days.length&&m.start);
    const existing=Object.values(S.courses).find(c=>!c.ex&&codeKey(c.code)===codeKey(code)&&semesterKey(c.semester)===targetSemester);
    if(existing){await put('courses',{...existing,meetings,professor:existing.professor||x.professor||''});updated++}
    else{if(courseLimitReached())throw{code:'plan_limit',message:courseLimitNotice()};await put('courses',{id:uid(),code,name:x.name||code,professor:x.professor||'',semester,color:Object.keys(allC()).length%6,created:Date.now(),meetings},{requireAck:true});added++}
  }
  return {added,updated};
}
ACT.schedRun=async el=>{
  const text=$('#sch-text').value.trim();
  if(!text&&!SCHED_IMG){scheduleStatus('Paste your schedule, upload a file, or add a screenshot first.',true);return}
  el.disabled=true;el.innerHTML=thinking+' Reading your schedule…';
  scheduleStatus(SCHED_IMG?'Sending the screenshot to the AI schedule importer…':'Reading the schedule…');
  try{
    let list=null;
    if(!SCHED_IMG&&/BEGIN:VCALENDAR/.test(text))list=parseICS(text);
    if(!list||!list.length){
      let image;
      if(SCHED_IMG){const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the screenshot.'));reader.readAsDataURL(SCHED_IMG)});image={mediaType:SCHED_IMG.type,data:String(encoded).split(',')[1]}}
      const r=await CS_STUDY('schedule',{material:text.slice(0,20000),...(image?{image}:{})});list=r.courses||[];
    }
    const {added,updated}=await applySchedule(list);
    const usedImage=!!SCHED_IMG;clearScheduleImage();closeModal();toast(added+updated?`Schedule added: ${plural(updated,'course')} updated, ${added} new`:usedImage?'No class times found. Try a sharper, straight-on screenshot or paste the schedule text.':'No class times found in that schedule.');go({name:'schedule'});
  }catch(e){
    const reason=e&&e.code==='plan_limit'?courseSaveErrorMessage(e):e&&e.message||({unavailable:'AI schedule reading is unavailable. Paste schedule text or try again later.',not_granted:'AI access was not granted. Reload the page to retry, or paste schedule text.',rate_limited:'AI is busy. Wait a minute and try again.',cancelled:'Schedule reading stopped.'}[e&&e.code]||'The AI could not read this schedule.');
    if(e&&e.code==='plan_limit')void loadBillingStatus(true,billingUserCode());
    scheduleStatus(reason,true);toast(reason);el.disabled=false;el.innerHTML=ic('spark')+'Add to my courses'
  }
};
