/* ---------- shell ---------- */
const VIEWS={},AFTER={},ACT={};
ACT.creditActionCancel=()=>settleCreditActionConfirmation(false);
ACT.creditActionApprove=()=>settleCreditActionConfirmation(true);
const NAV=[['home','home','Home'],['schedule','cal','Schedule'],['grades','cap','Grades'],['capture','mic','Record'],['notes','pencil','Notes'],['ask','chat','Ask ClassScribe'],['exam','cap','Exam Center'],['credits','wave','Credits'],['groups','users','Classmates'],['contact','mail','Urgent contact'],['plans','tag','Plans & privacy']];
function askPortrait(className='ask-nav-portrait'){return `<img class="${className}" src="/katherine-johnson-avatar.png" alt="" aria-hidden="true">`}
function navCur(n){const v=S.view.name;return v===n||(n==='home'&&['course','lecture','catchup','search','study','tutor'].includes(v)&&false)}
function renderSide(){
  syncProfilePhotoScope();
  const cs=coursesSorted();const sems={};cs.forEach(c=>(sems[c.semester||'Courses']=sems[c.semester||'Courses']||[]).push(c));
  const live=SES&&SES.step==='live';
  $('#side').innerHTML=`
  <div class="brand"><span class="brand-mark">${ic('wave')}</span><div><b>ClassScribe</b><small>Your academic memory</small></div></div>
  <nav class="nav" aria-label="Main">${NAV.map(([n,i,l])=>`<button ${goAttr({name:n})} aria-current="${S.view.name===n}">${n==='ask'?askPortrait():ic(i)}${l}${n==='capture'&&live?' <span class="chip rec" style="margin-left:auto">● REC</span>':''}</button>`).join('')}<a href="/instructor/" class="edu-nav-link" style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;color:var(--accent);font-weight:700;text-decoration:none" data-testid="link-instructor-edu">${ic('cap')} Instructor / EDU</a></nav>
  <div class="tree">${Object.entries(sems).map(([s,list])=>`<div class="sem">${esc(s)}</div>${list.map(c=>`<button style="${ccVar(c)}" ${goAttr({name:'course',id:c.id})} aria-current="${S.view.id===c.id&&S.view.name==='course'}"><span class="dot"></span><span><b>${esc(c.code)}</b> <span class="muted">${esc(c.name)}</span></span></button>`).join('')}`).join('')}
    <button data-act="addCourse" style="color:var(--accent);font-weight:700">${ic('plus').replace('<svg','<svg width="16" height="16"')} Add course</button></div>
  <button class="acct" ${goAttr({name:'account'})} aria-current="${S.view.name==='account'}">${profilePhotoMarkup('avatar')}<span><b>${esc(displayName(S.profile)||'Account')}</b><small>${esc((S.profile&&S.profile.school)||'Account settings')}</small></span></button>
  <div class="side-foot">${S.mode==='db'?'Synced to your claude.ai account':'Saved in this browser'}${S.showEx?' · Example courses shown':' · <a href="#" data-act="showEx">Show example courses</a>'}</div>`;
}
function renderTabbar(){
  const live=SES&&SES.step==='live';
  const items=[['home','home','Home'],['notes','pencil','Notes'],['capture','mic',live?'REC':'Record'],['grades','cap','Grades'],['ask','chat','Ask'],['groups','users','Class']];
  $('#tabbar').innerHTML=items.map(([n,i,l])=>`<button class="${n==='capture'?'recbtn':''}${n==='capture'&&live?' live':''}" ${goAttr({name:n})} aria-current="${S.view.name===n||(n==='home'&&S.view.name==='exam')}"${n==='capture'?' aria-label="Record a lecture"':''}>${n==='capture'?`<span class="recdisc">${ic(i)}</span>`:n==='ask'?askPortrait():ic(i)}${l}</button>`).join('');
}
VIEWS.contact=()=>`<div class="page-h"><div><h1>Support</h1><p class="sub">For help with ClassScribe when the chatbot cannot answer.</p></div></div>
  <section class="panel stack" style="max-width:640px;gap:14px">
    <h2>Email urgent support</h2>
    <a href="mailto:edmitainvestmentllc@edmitainvest.com?subject=URGENT%3A%20ClassScribe%20support" style="color:var(--accent);overflow-wrap:anywhere;font-weight:700">edmitainvestmentllc@edmitainvest.com</a>
    <p class="small muted">Opening this link starts a draft in your mail app. Check it and press Send yourself.</p>
    <div><a class="btn primary" href="mailto:edmitainvestmentllc@edmitainvest.com?subject=URGENT%3A%20ClassScribe%20support">${ic('mail')} Email urgent support</a></div>
  </section>`;
function topbar(){
  const search=['home','schedule'].includes(S.view.name)?'':`<label class="search">${ic('search')}<input id="gsearch" type="search" placeholder="Search every lecture, note and assignment" value="${esc(S.q)}" aria-label="Search everything"></label>`;
  const record=S.view.name==='plans'?'':`<button class="btn rec" ${goAttr({name:'capture'})} aria-label="Record a lecture">${ic('mic')} Record</button>`;
  return `<div class="topbar">${search}${record}</div>`;
}
function shouldGateOnboarding(profile,search=location.search){
  if(profile===undefined)return true;
  return !profile&&new URLSearchParams(search).get('cs_account')!=='1';
}
function render(){
  pending=false;
  $('.app').dataset.view=S.view.name;
  const gate=shouldGateOnboarding(S.profile);$('.app').classList.toggle('onboarding',gate);$('#tabbar').hidden=gate;
  if(S.profile===undefined){$('#main').innerHTML=`<div class="welcome" style="text-align:center;padding-top:18vh"><span class="brand-mark" style="margin:0 auto 14px;width:44px;height:44px">${ic('wave')}</span><p class="muted">Opening ClassScribe…</p></div>`;return}
  if(gate){
    // Keep the mounted form (including unsaved age/consent fields) through
    // background refreshes and keyboard blur. Never carry it to another library.
    const main=$('#main'),scope=JSON.stringify([S.mode,S.uid||null]);
    const form=main.querySelector('[data-form="welcome"]');
    if(!form||form.dataset.libraryScope!==scope){
      main.innerHTML=VIEWS.welcome();
      main.querySelector('[data-form="welcome"]').dataset.libraryScope=scope;
    }
    return;
  }
  renderSide();renderTabbar();
  const v=S.view;const f=VIEWS[v.name]||VIEWS.home;
   $('#main').innerHTML=`<div class="mobile-contact"><a href="mailto:edmitainvestmentllc@edmitainvest.com?subject=URGENT%3A%20ClassScribe%20support">${ic('mail')} Urgent contact</a></div>`+(v.name==='capture'?'':topbar())+f(v);
  AFTER[v.name]&&AFTER[v.name](v);
}
let LEAVE=null;
function go(v){
  if(SES&&SES.step==='live'&&S.view.name==='capture'&&v.name!=='capture'){
    clearInterval(TICK);clearInterval(DEMO);DEMO=null;micStop().catch(()=>{});void releaseRecordingReservation(SES,true);SES=null;
    toast('Recording stopped and discarded because you left Capture.');
  }
  if(LEAVE){try{LEAVE()}catch(e){}LEAVE=null}
  if((v.name==='grades'||v.name==='course'&&v.tab==='grades')&&typeof GRADES!=='undefined'&&GRADES.state==='ready')GRADES.state='idle';
  S.view=v;render();window.scrollTo(0,0)
}

/* ---------- HOME ---------- */
function semesterKey(value){return String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase()}
function homeTermCourses(){const term=semesterKey((S.profile&&S.profile.term)||curSemester());return coursesSorted().filter(c=>semesterKey(c.semester)===term)}
function upcoming(days,courseIds){return Object.values(allA()).filter(a=>courseIds.has(a.courseId)&&!a.done&&a.due&&daysUntil(a.due)>=0&&daysUntil(a.due)<=days).sort((a,b)=>a.due<b.due?-1:1)}
function lecturesLeft(a){return lecturesOf(a.courseId).filter(l=>!l.reviewed&&l.date<=a.due).length}
const HOME_LAYOUTS=[['class-first','Class-first (default)','Your next class and today’s timeline'],['study-first','Study-first','Exams and review at a glance'],['simple','Simple','Six clear ways into your library']];
function homeSection(title,action='',body=''){return `<section class="home-section"><div class="home-section-head"><h2>${title}</h2>${action}</div>${body}</section>`}
function homeCourses(cs){
  return homeSection('Courses',`<span class="row" style="gap:14px"><button class="home-link" ${goAttr({name:'courses'})}>All courses</button><button class="home-link" data-act="addCourse" aria-label="Add a course">${ic('plus')} Add course</button></span>`,
    cs.length?`<div class="home-courses">${cs.map(c=>`<button class="home-course" style="${ccVar(c)}" ${goAttr({name:'course',id:c.id})} aria-label="Open ${esc(c.code)} ${esc(c.name)}"><span class="course-code">${esc(c.code)}${c.ex?' · Example':''}</span><b>${esc(c.name)}</b><small>${nextMeetingLabel(c)?esc(nextMeetingLabel(c))+' · ':''}${plural(lecturesOf(c.id).length,'lecture')}</small></button>`).join('')}<button class="home-course home-add" data-act="addCourse" aria-label="Add a course">${ic('plus')} Add course</button></div>`:
    `<div class="home-empty">Your courses will live here. Add one or import a syllabus to get started.<div class="row"><button class="btn primary" data-act="addCourse">Add course</button><button class="btn" data-act="syllabus">Import syllabus</button>${!S.showEx?'<button class="btn" data-act="showEx">Show example courses</button>':''}</div></div>`);
}
function homeToday(cs){
  const now=new Date(),mins=now.getHours()*60+now.getMinutes(),courseIds=new Set(cs.map(c=>c.id)),list=classesOn(now).filter(x=>courseIds.has(x.c.id));
  const anyTimes=cs.some(c=>(c.meetings||[]).length);
  if(!anyTimes)return homeSection('Today',`<button class="home-link" ${goAttr({name:'schedule'})}>Schedule</button>`,`<div class="home-empty">Your day will appear here once your class times are in place.<br><button class="btn primary" data-act="schedImport">${ic('upload')} Import schedule</button></div>`);
  const nextIndex=list.findIndex(x=>x.start>mins+15&&!lecturesOf(x.c.id).some(l=>String(l.date||'').slice(0,10)===todayISO()));
  const body=list.length?`<div class="home-today">${list.map((x,i)=>{
    const recorded=lecturesOf(x.c.id).some(l=>String(l.date||'').slice(0,10)===todayISO());
    const state=recorded?'Recorded':mins>=x.start-15&&mins<=x.end?'Now':x.end<mins?'Past':i===nextIndex?'Next':'Later';
    return `<div class="home-class"><span class="home-class-time">${esc(fmtClock(x.m.start))}<br>${esc(fmtClock(x.m.end))}</span><span class="home-class-main"><b>${esc(x.c.code)} · ${esc(x.c.name)}</b><small>${esc([x.m.type,x.m.location].filter(Boolean).join(' · '))}</small></span><span class="home-class-actions"><span class="home-status ${state.toLowerCase()}">${state}</span>${state==='Now'||state==='Next'||state==='Later'?x.c.ex?`<button class="btn sm" ${goAttr({name:'course',id:x.c.id})} aria-label="Open ${esc(x.c.code)}">${ic('book')} Course</button>`:`<button class="btn sm ${state==='Now'?'rec':''}" ${goAttr({name:'capture',courseId:x.c.id})} aria-label="Record ${esc(x.c.code)}">${ic('mic')} Record</button>`:''}</span></div>`;
  }).join('')}</div>`:`<div class="home-empty">No classes today.${(()=>{const next=cs.map(c=>({c,n:nextMeetingIn(c)})).filter(x=>x.n<Infinity).sort((a,b)=>a.n-b.n)[0];return next?' Next: '+esc(next.c.code)+' · '+esc(nextMeetingLabel(next.c))+'.':''})()}</div>`;
  return homeSection('Today',`<button class="home-link" ${goAttr({name:'schedule'})}>Full schedule</button>`,body);
}
function homeDue(due){return due.length?`<section class="home-utility"><div class="home-section-head"><h3>Due soon</h3><button class="home-link" data-act="icsAll">Add to calendar</button></div><div class="list">${due.map(a=>assignRow(a,true)).join('')}</div></section>`:''}
function homeDueSection(due){return due.length?`<div class="home-section home-utilities">${homeDue(due)}</div>`:''}
function assignmentDateConfirmed(a){return a.dateConfirmed===true||a.dueConfirmed===true||a.dueSource==='manual'}
function confirmedDeadline(a){return !a.ex&&!a.done&&a.due&&assignmentDateConfirmed(a)}
function homeDeadlineAlerts(cs){
  const status=currentBillingStatus(),paid=status&&['student','pro'].includes(String(status.plan||'').toLowerCase())&&billingSubscriptionActive(status);
  if(!paid)return'';
  const ids=new Set(cs.map(c=>c.id)),items=Object.values(S.assignments).filter(a=>ids.has(a.courseId)&&confirmedDeadline(a)&&daysUntil(a.due)>=0&&daysUntil(a.due)<=7).sort((a,b)=>a.due.localeCompare(b.due));
  return items.length?`<section class="deadline-alerts" aria-label="Upcoming confirmed deadlines"><div class="home-section-head"><h2>${ic('cal')} Deadline alerts</h2><button class="home-link" ${goAttr({name:'schedule'})}>Open schedule</button></div><p class="small muted">Confirmed dates from your assignments · shown here in your library</p><div class="deadline-alert-list">${items.slice(0,5).map(a=>`<button class="deadline-alert" ${goAttr({name:'course',id:a.courseId,tab:'assign'})}><span class="deadline-alert-date">${esc(relDue(a.due))}</span><span><b>${esc(a.title)}</b><small>${esc((course(a.courseId)||{}).code||'Course')} · ${esc(fmtD(a.due))}</small></span>${ic('back')}</button>`).join('')}</div></section>`:'';
}
function homeQuick(){
  return homeSection('Quick actions','',`<div class="home-actions">${[['capture','mic','Record'],['schedule','cal','Schedule'],['notes','pencil','Notes'],['ask','chat','Ask'],['exam','cap','Exam Center']].map(([name,icon,label])=>`<button class="home-action ${name==='capture'?'record':''}" ${goAttr({name})} aria-label="${label}"><span class="home-action-icon">${ic(icon)}</span>${label}</button>`).join('')}</div>`);
}
function homeHero(cs){
  const now=new Date(),courseIds=new Set(cs.map(c=>c.id)),live=classesOn(now).filter(x=>courseIds.has(x.c.id)).find(x=>now.getHours()*60+now.getMinutes()>=x.start-15&&now.getHours()*60+now.getMinutes()<=x.end)||null,next=cs.map(c=>({c,n:nextMeetingIn(c)})).filter(x=>x.n<Infinity).sort((a,b)=>a.n-b.n)[0];
  const target=live?live.c:next&&next.c;
  if(!target)return `<section class="home-hero empty-schedule"><div><span class="kicker">Make room for your day</span><h2>Put your classes on the map.</h2><p>Import a schedule to see what’s next and start recording in one tap.</p></div><button class="hero-record" data-act="schedImport" aria-label="Import class schedule">${ic('upload')} Import schedule</button></section>`;
  const meeting=live?live.m:null;
  return `<section class="home-hero"><div><span class="kicker">${live?'Class happening now':'Up next · '+esc(nextMeetingLabel(target))}</span><h2>${esc(target.code)} · ${esc(target.name)}</h2><p>${meeting?esc([fmtRange(meeting.start,meeting.end),meeting.location].filter(Boolean).join(' · ')):esc(nextMeetingLabel(target))}</p></div>${target.ex?`<button class="hero-record" ${goAttr({name:'course',id:target.id})} aria-label="Open ${esc(target.code)} course">${ic('book')} View course</button>`:`<button class="hero-record" ${goAttr({name:'capture',courseId:target.id})} aria-label="Record ${esc(target.code)}">${ic('mic')} Record class</button>`}</section>`;
}
VIEWS.home=()=>{
  const cs=homeTermCourses().slice().sort((a,b)=>nextMeetingIn(a)-nextMeetingIn(b)),courseIds=new Set(cs.map(c=>c.id));
  const h=new Date().getHours(),name=(S.profile&&S.profile.firstName)||'';
  const layout=homeLayoutValue();
  const exams=upcoming(21,courseIds).filter(a=>a.type==='exam'||a.type==='quiz');
  const due=upcoming(10,courseIds).filter(a=>a.type!=='exam'&&a.type!=='quiz').slice(0,5);
  const examChips=exams.length?homeSection('Exams within 21 days',`<button class="home-link" ${goAttr({name:'exam'})}>Exam Center</button>`,`<div class="home-exams">${exams.map(a=>`<button class="home-exam-chip" ${goAttr({name:'exam',courseId:a.courseId,examId:a.id})} aria-label="Open ${esc(a.title)} in Exam Center">${esc((course(a.courseId)||{}).code||'')} · ${esc(a.title)} <span>· ${daysUntil(a.due)===0?'Today':plural(daysUntil(a.due),'day')}</span></button>`).join('')}</div>`):'';
  let content='';
  if(layout==='study-first'){
    content=`${exams.length?homeSection('Coming up',`<button class="home-link" ${goAttr({name:'exam'})}>All exams</button>`,`<div class="home-study-exams">${exams.map(a=>{const ls=lecturesOf(a.courseId).filter(l=>String(l.date||'').slice(0,10)<=a.due),done=ls.filter(l=>l.reviewed).length;return `<button class="home-study-exam" ${goAttr({name:'exam',courseId:a.courseId,examId:a.id})} aria-label="Study for ${esc(a.title)}"><span class="count">${daysUntil(a.due)}<small>${daysUntil(a.due)===1?'day':'days'} left</small></span><span class="study-label">${esc((course(a.courseId)||{}).code||'')} · ${esc(a.title)}</span><span class="progress-track" aria-hidden="true"><i style="width:${ls.length?Math.round(done/ls.length*100):0}%"></i></span><span class="detail">${done} of ${ls.length} lectures reviewed</span></button>`}).join('')}</div>`):homeSection('Coming up','',`<div class="home-empty">No exams in the next 21 days. Your study plan is clear for now.</div>`)}
      ${exams.length?`<div class="home-study-feature"><div><h3>Continue studying</h3><p>${esc(exams[0].title)} · ${esc((course(exams[0].courseId)||{}).code||'')} is coming up first.</p></div><button class="btn primary" ${goAttr({name:'exam',courseId:exams[0].courseId,examId:exams[0].id})}>Open exam</button></div>`:''}
      ${homeToday(cs)}${homeCourses(cs)}${homeDueSection(due)}`;
  }else if(layout==='simple'){
    content=`<div class="home-tiles">${[['capture','mic','Record'],['schedule','cal','Today'],['schedule','cal','Schedule'],['exam','cap','Exams'],['notes','pencil','Notes'],['ask','chat','Ask']].map(([name,icon,label])=>`<button class="home-tile ${name==='capture'?'record':''}" ${goAttr({name})} aria-label="${label}"><span class="home-tile-icon">${ic(icon)}</span>${label}</button>`).join('')}</div>${homeCourses(cs)}${homeDueSection(due)}`;
  }else{
    content=`${homeHero(cs)}${homeToday(cs)}${examChips}${homeQuick()}${homeCourses(cs)}${homeDueSection(due)}`;
  }
   return `<div class="home"><header class="home-mast"><span class="brand-mark" aria-hidden="true">${ic('wave')}</span><span class="home-wordmark">ClassScribe</span><div class="home-mast-actions"><a href="/instructor/" class="home-view" style="text-decoration:none" data-testid="link-instructor-edu-home">Instructor / EDU</a><button class="home-view" data-act="homeView" aria-haspopup="dialog" aria-label="Choose Home view">View: ${esc((HOME_LAYOUTS.find(x=>x[0]===layout)||HOME_LAYOUTS[0])[1])} ▾</button><button class="credits-chip" ${goAttr({name:'credits'})} aria-label="${S.credits.state==='ready'&&S.credits.data?`${creditNumber(S.credits.data.balance)} credits available`:'View credits balance'}">${ic('wave')}<span>${S.credits.state==='ready'&&S.credits.data?`${creditNumber(S.credits.data.balance)} credits`:S.credits.state==='error'?'Credits unavailable':'Credits'}</span></button><button class="home-avatar" ${goAttr({name:'account'})} aria-label="Open account">${esc((name||'?')[0].toUpperCase())}</button></div></header>
    <div class="home-intro"><p class="eyebrow">${esc(fmtLong(todayISO()))} · ${esc((S.profile&&S.profile.term)||curSemester())}</p><h1>${h<12?'Good morning':h<18?'Good afternoon':'Good evening'}${name?', '+esc(name):''}</h1><p>${layout==='study-first'?'A little progress, every day.':layout==='simple'?'Where would you like to begin?':'Here’s what your day looks like.'}</p></div>
     ${homeDeadlineAlerts(cs)}
     ${content}
    ${!S.showEx?'<footer class="home-section home-muted"><button class="home-link" data-act="showEx">Show example courses</button></footer>':''}</div>`;
};
AFTER.home=()=>loadCreditsStatus();
AFTER.credits=()=>loadCreditsStatus();
function creditCostLabel(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?`${creditNumber(n)} credits`:'Cost unavailable';
}
VIEWS.credits=()=>{
  const state=S.credits,data=state.data;
  const message=state.state==='loading'?'Checking your credits balance…':state.state==='error'?state.error:'Your balance has not been verified yet. No balance is shown until the server responds.';
   const balancePanel=state.state==='ready'&&data?`<section class="credits-hero panel"><div class="credits-coin" aria-hidden="true">${ic('wave')}</div><div><p class="eyebrow">Your balance</p><h2>${creditNumber(data.balance)} <span>${esc(data.currency?.name||data.currencyCode||data.currency?.code||'Credits')}</span></h2><p class="small muted">Credits are linked to this library.</p></div></section>`:`<section class="panel credits-unavailable" role="${state.state==='error'?'alert':'status'}"><span class="credits-coin" aria-hidden="true">${ic('wave')}</span><div><h2>Balance unavailable</h2><p>${esc(message)}</p><button class="btn sm" data-act="creditsRetry">${state.state==='loading'?'Check again':'Retry'}</button></div></section>`;
  const packs=state.state==='ready'&&data?data.packs.map(pack=>`<article class="credits-pack panel"><div><span class="credits-pack-count">${creditNumber(pack.credits)}</span><span class="small muted"> credits</span></div><h3>${esc(pack.name)}</h3>${pack.label?`<span class="chip">${esc(pack.label)}</span>`:''}<p class="small muted">${creditsCurrency(data,pack.priceCents)}</p><button class="btn primary" data-act="creditsBuy" data-pack-id="${esc(pack.id)}" ${state.action?'disabled':''}>${state.action===pack.id?'Opening secure checkout…':`Buy ${esc(pack.name)}`}</button></article>`).join('')||'<p class="small muted">No credit packs are available right now.</p>':'<p class="small muted">Credit packs will appear after the credits service responds.</p>';
  const cost=data?`<div class="grid2 credits-costs">${[['transcription10Minutes','10 minutes of transcription'],['savedRecording','Save a recording'],['studyGuide','Generate a study guide'],['askQuestion','Ask a question']].map(([key,label])=>`<div class="credits-cost-row"><span>${label}</span><b>${creditCostLabel(data.costs[key])}</b></div>`).join('')}</div>`:'<p class="small muted">Usage costs will appear when the server status is available.</p>';
   const history=data&&data.history.length?`<div class="list">${data.history.map(item=>{const amount=Number(item.amount),currencyMigration=amount===0&&/migrat/i.test(`${item.reason} ${item.source}`),date=item.date?new Date(item.date):null;const dateLabel=date&&!Number.isNaN(date.getTime())?date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Date unavailable';return`<div class="li credits-history-row"><div class="grow"><b>${currencyMigration?'Currency migration':esc(item.reason||'Credit activity')}</b><small class="small muted">${esc(dateLabel)}${item.source?` · ${esc(item.source)}`:''}</small></div><b class="${currencyMigration?'':amount<0?'credits-negative':'credits-positive'}">${currencyMigration?'No balance change':Number.isFinite(amount)?`${amount>0?'+':''}${creditNumber(Math.abs(amount))} credits`:'—'}</b></div>`}).join('')}</div>`:'<p class="small muted">No credit activity yet.</p>';
  return `<div class="page-h"><div><p class="eyebrow">Credits</p><h1>Keep learning, on your terms.</h1><p class="sub">A clear balance for the ClassScribe tools you choose to use.</p></div></div>
    ${balancePanel}${state.notice?`<p class="credits-notice" role="status" aria-live="polite">${esc(state.notice)}</p>`:''}
    <section class="credits-section"><div class="page-h"><div><h2>Choose a credit pack</h2><p class="small muted">Secure checkout is handled by Stripe. Your balance changes only after payment is confirmed.</p></div></div><div class="grid3 credits-packs">${packs}</div></section>
     <section class="panel credits-section"><h2>How credits work</h2><p class="small muted" style="margin:6px 0 14px">Credits are used only when a linked ClassScribe action completes. No credits are spent just by opening a screen or viewing a pack. Credits accumulate and do not expire.</p>${cost}<p class="small muted" style="margin-top:12px">A feature that may use more credits than your balance must identify the specific action and ask for your explicit, one-time consent before any server-side overage. This page does not enable or trigger overages.</p></section>
    <section class="panel credits-section"><div class="spread" style="align-items:center"><div><h2>Monthly plan bonuses</h2><p class="small muted" style="margin-top:5px">Bonuses reported by the credits service.</p></div><button class="btn sm" ${goAttr({name:'plans'})}>Compare plans</button></div>${data?`<div class="grid2 credits-bonuses"><div><b>Student</b><span>${creditNumber(data.monthlyBonus.student)} credits / month</span></div><div><b>Pro</b><span>${creditNumber(data.monthlyBonus.pro)} credits / month</span></div></div>`:'<p class="small muted" style="margin-top:12px">Plan bonuses are unavailable until the server status is verified.</p>'}</section>
    <section class="panel credits-section"><h2>Credit history</h2><p class="small muted" style="margin:5px 0 10px">Purchases, bonuses and linked actions from this library.</p>${history}</section>`;
};
ACT.creditsRetry=async()=>{await loadCreditsStatus(true);if(S.view.name!=='credits')render()};
ACT.creditsBuy=el=>{
  if(!S.credits.data||S.credits.state!=='ready')return;
  const pack=S.credits.data.packs.find(item=>item.id===el.dataset.packId);
  if(!pack)return;
  let checkoutWindow=null;
  if(window.self!==window.top){
    checkoutWindow=window.open('about:blank','_blank');
    if(!checkoutWindow){S.credits={...S.credits,notice:'Allow pop-ups to open secure Stripe checkout in a new tab, then try again.'};render();return}
  }
  void openCreditsCheckout(pack.id,checkoutWindow);
};
ACT.creditsConsentCancel=()=>settleCreditConsent(false);
ACT.creditsConsentConfirm=el=>{
  const pending=pendingCreditConsent,checkbox=$('#credits-overspend-optin');
  if(!pending||el.dataset.actionId!==pending.action.id)return;
  if(!checkbox||!checkbox.checked){const error=$('#credits-consent-error');if(error){error.hidden=false;error.textContent='Check the box to approve a server-side overage for this action.'}return}
  settleCreditConsent(true);
};
document.addEventListener('change',event=>{
  if(event.target&&event.target.id==='credits-overspend-optin'){
    const approve=$('[data-act="creditsConsentConfirm"]');
    if(approve)approve.disabled=!event.target.checked;
  }
});
ACT.homeView=()=>openModal(`<div class="spread"><div><p class="eyebrow">Personalize Home</p><h2>Choose your view</h2></div><button class="btn ghost sm" data-act="close" aria-label="Close View chooser">${ic('x')} Close</button></div><p class="home-muted">Your choices stay with your library on web and phone.</p><div class="stack" role="radiogroup" aria-label="Home layout">${HOME_LAYOUTS.map(([id,label,description])=>`<button class="home-view-option" role="radio" aria-checked="${homeLayoutValue()===id}" data-act="homeLayoutPick" data-layout="${id}" aria-label="${label}: ${description}"><span><strong>${label}</strong><small>${description}</small></span><span class="home-view-check" aria-hidden="true">${homeLayoutValue()===id?'✓':''}</span></button>`).join('')}</div>${appearanceQuickChoices()}`);
ACT.homeLayoutPick=async el=>{await setHomeLayoutChoice(el.dataset.layout);closeModal();render()};
VIEWS.courses=()=>{
  const groups={};coursesSorted().forEach(c=>(groups[c.semester||'Courses']=groups[c.semester||'Courses']||[]).push(c));
  const content=Object.entries(groups).map(([semester,list])=>`<section class="home-section"><div class="home-section-head"><h2>${esc(semester)}</h2></div><div class="home-courses">${list.map(c=>`<button class="home-course" style="${ccVar(c)}" ${goAttr({name:'course',id:c.id})} aria-label="Open ${esc(c.code)} ${esc(c.name)}"><span class="course-code">${esc(c.code)}${c.ex?' · Example':''}</span><b>${esc(c.name)}</b><small>${nextMeetingLabel(c)?esc(nextMeetingLabel(c))+' · ':''}${plural(lecturesOf(c.id).length,'lecture')}</small></button>`).join('')}</div></section>`).join('');
  const count=coursesSorted().length;
  return `<div class="page-h"><div><p class="eyebrow">Your library</p><h1>All courses</h1><p class="sub">${plural(count,'course')} across all semesters</p></div><button class="btn primary" data-act="addCourse">${ic('plus')}Add course</button></div>${content||'<div class="empty">No courses yet. Add a course to get started.</div>'}`;
};
function assignRow(a,showCourse){
  const c=course(a.courseId);const n=a.due?daysUntil(a.due):null;
  const tone=a.done?'':n!==null&&n<0?'rec':n!==null&&n<=3?'warn':'';
  return `<div class="li" id="assignment-${esc(a.id)}">${a.ex||c&&c.ex?'<span style="width:18px;flex:none" aria-hidden="true"></span>':`<input type="checkbox" data-toggle-a="${esc(a.id)}" ${a.done?'checked':''} aria-label="Mark ${esc(a.title)} done" style="width:18px;height:18px;accent-color:var(--accent)">`}<div class="grow"><div class="t" style="${a.done?'text-decoration:line-through;opacity:.6':''}">${esc(a.title)}</div><div class="row small muted" style="gap:6px">${showCourse&&c?codeChip(c):''}<span class="chip">${esc(a.type||'task')}</span>${a.lectureId&&lecture(a.lectureId)?`<span>mentioned ${citeChip(a.lectureId,a.t||0)}</span>`:''}${a.due&&!assignmentDateConfirmed(a)&&!a.done&&!a.ex&&!(c&&c.ex)?`<button class="btn sm" data-act="confirmAssignmentDate" data-id="${esc(a.id)}" aria-label="Confirm ${esc(a.title)} due date ${esc(fmtD(a.due))}">Confirm date</button>`:''}${!a.ex&&c&&!c.ex&&['assignment','homework','project','quiz','test','exam'].includes(String(a.type||'').toLowerCase())?`<button class="btn sm ghost" data-act="gradeFromAssignment" data-id="${esc(a.id)}" aria-label="Record grade for ${esc(a.title)}">Record grade</button>`:''}</div></div><span class="chip ${tone}">${a.due?fmtD(a.due)+' · '+relDue(a.due):'No date'}</span></div>`;
}

/* ---------- COURSE ---------- */
VIEWS.course=v=>{
  const c=course(v.id);if(!c)return `<div class="empty">This course isn’t in your library anymore. <button class="btn sm" ${goAttr({name:'home'})}>Go home</button></div>`;
  const tab=v.tab||'lectures';const ls=lecturesOf(c.id);const as=assignOf(c.id);
  const mods={};ls.forEach(l=>(mods[l.module||'Lectures']=mods[l.module||'Lectures']||[]).push(l));
  const marks=ls.flatMap(l=>(l.marks||[]).map(t=>({l,t,seg:(l.segs||[]).filter(s=>s.t<=t+2).pop()}))).sort((a,b)=>String(b.l.date).localeCompare(String(a.l.date))||b.t-a.t);
  const shared=Object.values({...S.shared,...(c.ex?EX_SHARED:{})}).filter(l=>codeKey(l.code)===codeKey(c.code)&&l.by!==S.uid);
  let body='';
  if(tab==='lectures')body=(ls.length?Object.entries(mods).map(([m,list])=>`<section style="margin-bottom:20px"><p class="eyebrow" style="margin-bottom:4px">${esc(m)}</p><div class="panel" style="padding:4px 12px"><div class="list">${list.map(l=>lectureRow(l)).join('')}</div></div></section>`).join('')
    :`<div class="empty"><p>No lectures recorded for ${esc(c.code)} yet.</p>${c.ex?'':`<button class="btn rec" style="margin-top:12px" ${goAttr({name:'capture',courseId:c.id})}>${ic('mic')}Record first lecture</button>`}</div>`)
    +(marks.length?`<section class="panel" style="margin-top:18px"><h3>Bookmarked moments</h3><div class="list" style="margin-top:6px">${marks.map(({l,t,seg})=>`<button class="li" ${goAttr({name:'lecture',id:l.id,tab:'transcript',t})} aria-label="Open bookmark in ${esc(l.title)} at ${esc(fmtT(t))}"><span style="color:var(--hi-ink)">${ic('star')}</span><span class="grow"><span class="small muted">${esc(l.title)} · ${fmtD(l.date)} · ${fmtT(t)}</span><br><span class="small">${esc(seg?seg.x:'Bookmarked moment')}</span></span></button>`).join('')}</div></section>`:'');
    if(tab==='assign')body=`<div class="panel"><p class="small muted" style="margin-bottom:10px">Dates suggested from a lecture or imported syllabus need your confirmation before they appear in deadline alerts.</p><div class="list">${as.map(a=>assignRow(a)).join('')||'<p class="muted small">No assignments yet. ClassScribe adds them when your professor mentions homework, readings or exams.</p>'}</div>
     ${c.ex?'':`<hr class="hr" style="margin:14px 0"><form class="row" data-form="addA" style="align-items:flex-end"><label class="f" style="flex:2;min-width:180px">Title<input class="in" id="na-title" required placeholder="Lab report 2"></label><label class="f" style="flex:1;min-width:120px">Type<select class="in" id="na-type"><option>homework</option><option>reading</option><option>quiz</option><option>exam</option><option>project</option></select></label><label class="f" style="flex:1;min-width:140px">Due<input class="in" id="na-due" type="date"></label><button class="btn primary">${ic('plus')}Add</button></form>`}</div>`;
    if(tab==='assign'&&(c.syllabusDates||[]).length)body+=`<section class="panel" style="margin-top:14px"><h3>Confirmed syllabus dates</h3><p class="small muted">Tracked syllabus dates are separate from coursework due dates. Only unique title matches set a coursework due date.</p><div class="list">${c.syllabusDates.map(d=>`<div class="li"><div class="grow"><b>${esc(d.title)}</b><div class="small muted">${d.linkStatus==='linked'?'Linked to coursework':'Standalone syllabus date'}</div>${d.linkStatus==='ambiguous'?'<p class="small" role="status">Title matched more than one date or coursework item. This date was not attached to coursework; no due date was set from it.</p>':''}</div><span class="chip">${esc(fmtD(d.due))}</span></div>`).join('')}</div></section>`;
  if(tab==='notes'){const ns=notesOf(c.id);body=`<div class="panel" style="padding:4px 12px"><div class="list">${ns.map(n=>`<button class="li" ${goAttr({name:'notes',courseId:c.id,id:n.id})}><span style="width:18px;color:var(--muted)">${ic('pencil')}</span><span class="grow"><span class="t">${n.pinned?'Pinned · ':''}${esc(n.title||'Untitled note')}</span><br><span class="small muted">${esc(snippet(n.body,120))}${n.sourceType?` · Private ${esc(n.sourceType)}`:''}</span></span><span class="small muted">${whenStr(n.updated)}</span></button>`).join('')||'<p class="muted small" style="padding:10px 0">No notes for this course yet.</p>'}</div></div>${c.ex?'':`<div class="row" style="margin-top:12px"><button class="btn" data-act="importSource" data-cid="${esc(c.id)}">${ic('upload')}Import private source</button><button class="btn primary" data-act="newNote" data-cid="${esc(c.id)}">${ic('plus')}New note for ${esc(c.code)}</button></div>`}`}
   if(tab==='grades')body=gradesCourseMarkup(c.id);
  if(tab==='missed')body=`<div class="stack"><p class="muted" style="max-width:62ch">Missed class? When a classmate shares a lecture with your ${esc(c.code)} group, ClassScribe builds a catch-up: what happened, what you need to know, assignments, announcements and what to review before next class.</p>
    <div class="panel"><h3>Shared by classmates</h3><div class="list" style="margin-top:6px">${shared.map(l=>`<button class="li" ${goAttr({name:'catchup',id:l.id})}><div class="date-tile"><span>${dObj(l.date).toLocaleDateString(undefined,{month:'short'})}</span><b>${dObj(l.date).getDate()}</b></div><div class="grow"><div class="t">${esc(l.title)}</div><div class="small muted">Shared by <span data-uid="${esc(l.by||'')}">${l.ex?'a classmate (example)':'a classmate'}</span></div></div><span class="chip ok">Catch me up</span></button>`).join('')||`<p class="muted small" style="padding:8px 0">Nothing shared yet. ${S.mode==='db'?'Ask a classmate to open ClassScribe, open a lecture, and choose Share.':'Sharing works when you’re signed in to claude.ai.'}</p>`}</div></div>
    ${ls.length?`<div class="panel"><h3>Catch up on your own lectures</h3><div class="list" style="margin-top:6px">${ls.slice().reverse().map(l=>`<button class="li" ${goAttr({name:'catchup',id:l.id})}><span class="grow"><span class="t">${esc(l.title)}</span> <span class="small muted">${fmtD(l.date)}</span></span><span class="chip">Catch-up</span></button>`).join('')}</div></div>`:''}</div>`;
  return `<button class="btn ghost sm" ${goAttr({name:'home'})} style="margin-bottom:10px">${ic('back')}Home</button>
  <div class="page-h"><div><div class="row" style="gap:6px;margin-bottom:8px">${codeChip(c)}<span class="chip">${esc(c.semester||'')}</span>${c.ex?'<span class="chip ex">Example course</span>':''}</div><h1>${esc(c.name)}</h1><p class="sub">${esc(c.professor||'')} · ${plural(ls.length,'lecture')} · ${Math.round(ls.reduce((s,l)=>s+(l.duration||0),0)/60)} minutes captured</p><div class="row small" style="margin-top:8px;gap:8px">${ic('cal').replace('<svg','<svg width="15" height="15"')}${(c.meetings||[]).length?meetingsText(c).map(t=>`<span>${esc(t)}</span>`).join('<span class="muted">·</span>'):'<span class="muted">No class times yet</span>'}${c.ex?'':`<button class="btn sm ghost" data-act="editTimes" data-id="${esc(c.id)}">${(c.meetings||[]).length?'Edit times':'Add class times'}</button>`}</div></div>
  <div class="row">${c.ex?'':`<button class="btn rec" ${goAttr({name:'capture',courseId:c.id})}>${ic('mic')}Record</button>`}<button class="btn primary" ${goAttr({name:'exam',courseId:c.id})}>${ic('cap')}Exam Center</button><button class="btn" ${goAttr({name:'ask',scope:c.id})}>${ic('chat')}Ask</button><button class="btn" ${goAttr({name:'groups',code:c.code})}>${ic('users')}Classmates</button></div></div>
   <div class="tabs" role="tablist">${[['lectures','Lectures'],['notes',`Notes (${notesOf(c.id).length})`],['assign',`Assignments (${as.filter(a=>!a.done).length})`],['grades','Grades'],['missed','I Missed Class']].map(([k,l])=>`<button role="tab" aria-selected="${tab===k}" ${goAttr({name:'course',id:c.id,tab:k})}>${l}</button>`).join('')}</div>
  ${body}
  <div class="row" style="margin-top:26px"><button class="btn sm ghost" data-act="icsCourse" data-id="${esc(c.id)}">${ic('cal')}Export assignments to calendar</button>${c.ex?'':`<button class="btn sm ghost" data-act="syllabus" data-id="${esc(c.id)}">${ic('upload')}Import syllabus</button><button class="btn sm ghost" data-act="delCourse" data-id="${esc(c.id)}">${ic('x')}Remove course</button>`}</div>`;
};
function lectureRow(l){
  const d=dObj(l.date);
  return `<button class="li" ${goAttr({name:'lecture',id:l.id})}><div class="date-tile"><span>${d.toLocaleDateString(undefined,{month:'short'})}</span><b>${d.getDate()}</b></div><div class="grow"><div class="t">${esc(l.title)}</div><div class="small muted row" style="gap:10px"><span>${Math.round((l.duration||0)/60)} min</span>${(l.marks||[]).length?`<span>⭐ ${l.marks.length}</span>`:''}${l.analysis?'<span>Analyzed</span>':'<span class="chip warn">Not analyzed</span>'}</div></div>${l.reviewed?`<span class="chip ok">${ic('check').replace('<svg','<svg width="12" height="12"')}Reviewed</span>`:''}</button>`;
}

/* ---------- I MISSED CLASS ---------- */
VIEWS.catchup=v=>{
  const l=lecture(v.id);if(!l)return '<div class="empty">That lecture is no longer shared.</div>';
  const c=course(l.courseId)||{code:l.code,name:l.courseName,professor:l.professor};const a=l.analysis;
  const sec=(t,items,fn)=>items&&items.length?`<section class="panel"><h3>${t}</h3><ul style="margin:8px 0 0;padding-left:1.2em;display:flex;flex-direction:column;gap:6px">${items.map(fn).join('')}</ul></section>`:'';
  return `<button class="btn ghost sm" ${l.courseId&&course(l.courseId)?goAttr({name:'course',id:l.courseId,tab:'missed'}):goAttr({name:'home'})} style="margin-bottom:10px">${ic('back')}Back</button>
  <div class="page-h"><div><p class="eyebrow">I missed class · ${esc(c.code||'')}</p><h1>${esc(l.title)}</h1><p class="sub">${esc(fmtLong(l.date))}${c.professor?' · '+esc(c.professor):''}${l.sharedCopy||l.ex&&EX_SHARED[l.id]?' · shared by a classmate':''}</p></div>
  <div class="row"><button class="btn primary" ${goAttr({name:'tutor',lectureIds:[l.id],courseId:l.courseId||null,mode:'teach'})}>${ic('bulb')}Teach me today’s lecture</button><button class="btn" ${goAttr({name:'lecture',id:l.id,tab:'transcript'})}>${ic('file')}Open transcript</button>${l.sharedCopy&&l.allowCopy?`<button class="btn" data-act="saveShared" data-id="${esc(l.id)}">${ic('download')}Save to my library</button>`:''}</div></div>
  ${a?`<div class="stack">
    <section class="panel"><h3>What happened today</h3><p style="margin-top:6px;max-width:70ch">${esc(a.summary)}</p></section>
    <div class="grid2">
    ${sec('What you need to know',a.keyPoints,k=>`<li>${esc(k)}</li>`)}
    ${sec('What to review before next class',a.emphasized,e=>`<li><b>${esc(e.concept)}</b> ${citeChip(l.id,e.t)}<br><span class="small muted">${esc(e.why)}</span></li>`)}
    ${sec('Assignments mentioned',a.assignments,x=>`<li>${esc(x.title)}${x.due?` · <span class="muted">due ${fmtD(x.due)}</span>`:''}</li>`)}
    ${sec('Important announcements',a.announcements,x=>`<li>${esc(x)}</li>`)}
    ${sec('Concepts introduced',(a.terms||[]).slice(0,8),t=>`<li><b>${esc(t.term)}</b> — ${esc(t.def)}</li>`)}
    ${sec('Questions students asked',a.studentQuestions,q=>`<li>${esc(q.q)} ${citeChip(l.id,q.t)}</li>`)}
    </div></div>`
  :`<div class="empty"><p>This lecture hasn’t been analyzed yet.</p><button class="btn primary" style="margin-top:12px" data-act="analyze" data-id="${esc(l.id)}">${S.busy[l.id]?thinking:ic('spark')+'Build catch-up with AI'}</button></div>`}`;
};

/* ---------- SEARCH ---------- */
function tokens(q){const stop=new Set('the a an and or of to in on for is was what did does do say said about this that with from how why when who which are be it as at by me my i you professor prof'.split(' '));return String(q).toLowerCase().replace(/[^a-z0-9′'\s-]/g,' ').split(/\s+/).filter(w=>w.length>1&&!stop.has(w))}
function scoreText(text,toks){const t=text.toLowerCase();let s=0;toks.forEach(w=>{const stem=w.length>5?w.slice(0,Math.max(5,w.length-2)):w;if(t.includes(stem))s+=1+(t.includes(w)?.5:0)});return s}
function searchSegs(q,cid,limit=8){
  const toks=tokens(q);if(!toks.length)return[];const hits=[];
  Object.values({...allL(),...S.shared}).forEach(l=>{if(cid&&l.courseId!==cid)return;(l.segs||[]).forEach((g,i)=>{const sc=scoreText(g.x,toks);if(sc>0)hits.push({l,i,g,sc})});(l.slides||[]).forEach(sl=>{const sc=scoreText(sl.text||'',toks);if(sc>0)hits.push({l,i:-1,g:{t:sl.t,s:'slide',x:sl.text},sc})})});
  return hits.sort((a,b)=>b.sc-a.sc||(b.l.date>a.l.date?1:-1)).slice(0,limit);
}
VIEWS.search=v=>{
  const q=v.q||'';const toks=tokens(q);
  const segs=searchSegs(q,null,30);
  const notes=[];Object.values(allL()).forEach(l=>{const a=l.analysis;if(!a)return;(a.terms||[]).forEach(t=>{if(scoreText(t.term+' '+t.def,toks))notes.push({l,t:t.t,title:t.term,x:t.def,kind:'Term'})});(a.keyPoints||[]).forEach(k=>{if(scoreText(k,toks))notes.push({l,t:0,title:l.title,x:k,kind:'Key point'})});if(l.myNotes&&scoreText(l.myNotes,toks))notes.push({l,t:0,title:l.title,x:l.myNotes.slice(0,140),kind:'My notes'})});
  const as=Object.values(allA()).filter(a=>scoreText(a.title,toks));
  const myn=Object.values(allN()).filter(n=>scoreText(n.title+' '+n.body,toks));
  const hl=s=>{let h=esc(s);toks.forEach(w=>{const stem=w.length>5?w.slice(0,Math.max(5,w.length-2)):w;h=h.replace(new RegExp('('+stem.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[a-z]*)','gi'),'<mark style="background:var(--hi-soft);color:inherit;border-radius:3px">$1</mark>')});return h};
  return `<div class="page-h"><div><p class="eyebrow">Universal search</p><h1>“${esc(q)}”</h1><p class="sub">${segs.length+notes.length+as.length+myn.length} results across ${plural(Object.keys(allL()).length,'lecture')}</p></div><button class="btn primary" ${goAttr({name:'ask',prefill:q})}>${ic('chat')}Ask ClassScribe instead</button></div>
  <div class="stack">
  ${segs.length?`<section class="panel"><h3>In lectures</h3><div class="list" style="margin-top:6px">${segs.map(h=>`<button class="li" ${goAttr({name:'lecture',id:h.l.id,tab:'transcript',t:h.g.t})}><span class="mono muted" style="width:52px">${fmtT(h.g.t)}</span><span class="grow"><span class="small muted">${esc((course(h.l.courseId)||{}).code||h.l.code||'')} · ${fmtD(h.l.date)} · ${esc(h.l.title)}${h.g.s==='slide'?' · slide':''}</span><br>${hl(h.g.x)}</span></button>`).join('')}</div></section>`:''}
  ${notes.length?`<section class="panel"><h3>In notes and definitions</h3><div class="list" style="margin-top:6px">${notes.slice(0,20).map(n=>`<button class="li" ${goAttr({name:'lecture',id:n.l.id,tab:n.kind==='Term'?'terms':'notes'})}><span class="chip">${n.kind}</span><span class="grow"><b>${esc(n.title)}</b><br><span class="small">${hl(n.x)}</span></span></button>`).join('')}</div></section>`:''}
  ${myn.length?`<section class="panel"><h3>Your notes</h3><div class="list" style="margin-top:6px">${myn.map(n=>`<button class="li" ${goAttr({name:'notes',id:n.id})}><span class="chip">Note</span><span class="grow"><b>${esc(n.title||'Untitled note')}</b><br><span class="small">${hl(snippet(n.body,160))}</span></span></button>`).join('')}</div></section>`:''}
  ${as.length?`<section class="panel"><h3>Assignments</h3><div class="list">${as.map(a=>assignRow(a,true)).join('')}</div></section>`:''}
  ${!segs.length&&!notes.length&&!as.length&&!myn.length?'<div class="empty">No matches. Try a different word, or ask ClassScribe a question in your own words.</div>':''}
  </div>`;
};

/* ---------- PLANS & PRIVACY ---------- */
function billingSourceLabel(source){
  return({app_store:'App Store',play_store:'Google Play',test_store:'RevenueCat Test Store (testing)'})[String(source||'')]||'Stripe';
}
function billingManagementMarkup(billing,active){
  if(!active||!['student','pro'].includes(String(billing.plan||'').toLowerCase()))return'';
  const source=String(billing.billingSource||'web'),native=['app_store','play_store','test_store'].includes(source);
  const portalButton=`<button class="btn sm" data-act="billingPortal" ${S.billingAction?'disabled':''}>${S.billingAction==='portal'?'Opening…':'Manage web subscription in Stripe'}</button>`;
  if(billing.billingConflict){
    const nativePath=native&&source==='test_store'
      ?'The RevenueCat Test Store subscription must be managed in the installed ClassScribe debug app or by the Test Store owner; this web page cannot authenticate to open its customer page.'
      :native
        ?`Manage the ${esc(billingSourceLabel(source))} subscription in the original store on the device used to subscribe.`
        :'Check the original App Store or Google Play account and device for the other subscription.';
    return `<div class="stack" style="gap:8px"><p class="small" role="status"><b>Second subscription detected — new checkout is blocked to prevent a double charge.</b> Cross-store subscriptions do not replace or cancel one another. ${nativePath}</p><div class="row"><span class="small muted">Stripe web subscription:</span>${portalButton}</div></div>`;
  }
  if(source==='test_store')return `<div class="stack" style="gap:6px"><p class="small"><b>Billed through RevenueCat Test Store (testing).</b></p><p class="small muted">Test Store subscriptions are for testing and are not managed in Stripe. This web page cannot open RevenueCat’s customer page without the authenticated app session. Manage it in the installed ClassScribe debug app, or use the RevenueCat Test Store owner controls.</p></div>`;
  if(native)return `<div class="stack" style="gap:6px"><p class="small"><b>Billed through ${esc(billingSourceLabel(source))}.</b></p><p class="small muted">To manage or cancel, use the original store on the device used to subscribe. This library can’t open that store’s subscription settings.</p></div>`;
  return `<div class="stack" style="gap:8px">${portalButton}<p class="small muted">This portal can manage your existing subscription. Student–Pro switching is not yet enabled in the Stripe portal; do not start a second checkout for the same library.</p></div>`;
}
function billingStatusPanel(){
  const billing=currentBillingStatus()||S.billing||{state:'idle',plan:'free'};
  const verified=billing.state==='ready'&&billing._userCode===billingUserCode();
  const upgradesReady=verified&&billing.billingReadiness&&billing.billingReadiness.ready===true;
  const noUserCode=!billingUserCode();
  const plan=String(billing.plan||'free').toLowerCase();
  const planLabel=plan==='student'?'Student':plan==='pro'?'Pro':'Free';
  const activeSubscription=billingSubscriptionActive(billing);
  const paidActive=verified&&activeSubscription&&['student','pro'].includes(plan);
  const readinessDetail=billing.billingReadiness&&billing.billingReadiness.message?` ${billing.billingReadiness.message}`:'';
  const readinessMessage=verified&&!upgradesReady
    ?`${paidActive?'Your existing paid plan remains active. ':''}Paid web checkout is not ready because billing setup is incomplete.${readinessDetail} Free remains available. Retry the billing setup check after configuration is corrected.`
    :'';
  let detail='Checking your plan with ClassScribe…';
  if(noUserCode)detail='Your library sync code is unavailable. Reopen your library and try again.';
  else if(billing.state==='error'&&billing._userCode===billingUserCode())detail=billing.error||'Your subscription status could not be verified.';
  else if(verified){
    detail=billingStatusText(billing,false);
    if(Number.isFinite(Number(billing.courseLimit))&&Number(billing.courseLimit)>0)detail+=` · ${Number(billing.courseLimit)} course limit`;
  }
  const management=verified?billingManagementMarkup(billing,billingSubscriptionActive(billing)):'';
  const source=String(billing.billingSource||'web');
  const sourceMarkup=verified?`<p class="small"><b>Billing source:</b> ${esc(source==='test_store'?'RevenueCat Test Store (testing)':billingSourceLabel(source))}</p>`:'';
  const heading=noUserCode||billing.state==='error'&&billing._userCode===billingUserCode()?'Plan status unavailable':paidActive?`Active plan: ClassScribe ${esc(planLabel)}`:verified?`Current plan: ${esc(planLabel)}`:'Checking your plan…';
  return `<section class="panel stack" style="margin:0 0 18px;gap:10px" aria-labelledby="billing-current-heading">
     <div class="spread" style="align-items:center"><div><p class="eyebrow">Library subscription</p><h2 id="billing-current-heading">${heading}</h2></div></div>
    <p class="small muted" role="status" aria-live="polite">${esc(detail)}</p>
    ${verified?baseUsageAllowanceMarkup(billing):''}
      ${sourceMarkup}
     ${management}
    ${readinessMessage?`<p class="small" role="status" aria-live="polite">${esc(readinessMessage)}</p>`:''}
    ${S.billingNotice?`<p class="small" role="status" aria-live="polite">${esc(S.billingNotice)}</p>`:''}
    ${billing.state==='error'&&billing._userCode===billingUserCode()?'<button class="btn sm" data-act="billingRefresh">Try again</button>':''}
     ${verified&&!upgradesReady?'<button class="btn sm" data-act="billingReadinessRetry">Retry billing setup check</button>':''}
  </section>`;
}
ACT.billingCheckout=el=>{
  const plan=String(el.dataset.plan||'').toLowerCase();
  if(!['student','pro'].includes(plan))return;
  const blockReason=billingCheckoutBlockReason();
  if(blockReason){S.billingNotice=blockReason;render();return}
  if(!currentBillingStatus()?.billingReadiness?.ready){S.billingNotice="Upgrades aren't set up yet";render();return}
  const label=plan==='student'?'Student':'Pro',price=plan==='student'?'$7.99':'$12.99';
  openModal(`<div class="spread"><div><p class="eyebrow">Confirm your plan</p><h2 id="billing-confirm-heading">Upgrade to ClassScribe ${label}?</h2></div><button class="btn ghost sm" data-act="billingCancel" aria-label="Close confirmation">${ic('x')}</button></div>
    <p class="muted">You’re choosing ClassScribe ${label} for <b>${price} per month</b>. Stripe will securely collect payment details and show the final checkout total before you pay.</p>
    <p class="small muted">Your plan changes after Stripe confirms payment. You can manage or cancel your subscription from Plans.</p>
    <p id="billing-checkout-status" class="small" role="status" aria-live="polite"></p>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-act="billingCancel">Not now</button><button class="btn primary" data-act="billingConfirm" data-plan="${plan}">Continue to secure checkout · ${price}/month</button></div>`);
};
ACT.billingConfirm=async el=>{
  if(el.disabled)return;
  const showStatus=message=>{const status=document.getElementById('billing-checkout-status');if(status)status.textContent=message};
  const plan=String(el.dataset.plan||'').toLowerCase();
  const blockReason=billingCheckoutBlockReason();
  if(blockReason){showStatus(blockReason);return}
  if(!['student','pro'].includes(plan)||!currentBillingStatus()?.billingReadiness?.ready){showStatus('Secure checkout is not ready. Close this confirmation and refresh the billing setup check.');return}
  let checkoutWindow=null;
  if(window.self!==window.top){
    checkoutWindow=window.open('about:blank','_blank');
    if(!checkoutWindow){showStatus('Your browser blocked the checkout tab. Allow pop-ups for this preview and try again.');return}
  }
  el.disabled=true;showStatus('Opening secure checkout…');
  try{if(await openBillingCheckout(plan,checkoutWindow))closeModal();else showStatus(S.billingNotice||'Checkout could not open. Please try again.')}
  catch(error){checkoutWindow?.close();showStatus(error.message||'Checkout could not open. Please try again.')}
  finally{el.disabled=false}
};
ACT.billingCancel=()=>closeModal();
ACT.billingFree=()=>{
  const billing=currentBillingStatus();
  if(!billing){void loadBillingStatus(true);return}
  go({name:'home'});
};
ACT.billingPortal=()=>openBillingPortal();
ACT.billingRefresh=async()=>{await loadBillingStatus(true);render()};
ACT.billingReadinessRetry=async()=>{await loadBillingStatus(true,billingUserCode(),true);render()};
AFTER.plans=()=>{loadBillingStatus();loadCreditsStatus()};
VIEWS.plans=v=>`
  <div class="page-h"><div><p class="eyebrow">ClassScribe plans</p><h1>Pick what fits your semester</h1><p class="sub">Compare monthly transcription hours, course limits and exam study tools.</p></div></div>
  ${v.onboarding?`<div class="panel" style="margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap"><div><h2>Your library is ready</h2><p class="small muted" style="margin-top:5px">Choose a plan or continue with Free. You won’t be charged unless you explicitly start Stripe checkout.</p></div><button class="btn primary" ${goAttr({name:'home'})}>Continue to your library</button></div>`:''}
  ${billingStatusPanel()}
  ${creditsSummaryMarkup()}
  <div class="grid3" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))">
   ${[['Free','$0','',['5 transcription hours / month','5 saved recordings / month','Up to 3 courses','Notes and recording','Ask: 1 question / month for 1 Scribe Credit','No generated exam tools'],''],
       ['Student','$7.99','/month',['40 transcription hours / month','20 saved recordings / month','Unlimited courses','25 Ask questions / month','Generated study guides, flashcards and practice quizzes'],'feature'],
         ['Pro','$12.99','/month',['120 transcription hours / month','60 saved recordings / month','No course-count cap','Ask questions included (no monthly question cap)','Extra recording and transcription usage requires credits','Generated study guides, flashcards and practice quizzes','Grades: track your scores and averages','Finals Mode and advanced lecture tutor'],'']]
           .map(([n,p,u,f,cl])=>{const billing=currentBillingStatus()||{},billingExists=billing.state==='ready'&&['student','pro'].includes(String(billing.plan||'').toLowerCase())&&billingSubscriptionActive(billing);const readiness=billing.billingReadiness||{},upgradesReady=billing.state==='ready'&&readiness.ready===true,readinessFailed=billing.state==='ready'&&!upgradesReady;const selected=String(billing.plan||'free').toLowerCase()===n.toLowerCase();const source=String(billing.billingSource||'web'),native=['app_store','play_store','test_store'].includes(source),conflict=billing.billingConflict===true,webPaid=billingExists&&!native;const paidAction=webPaid?'billingPortal':'billingCheckout';const paidDisabled=!billing.state||billing.state!=='ready'||S.billingAction||conflict||billingExists&&native||!billingExists&&!upgradesReady;const paidLabel=conflict?'Checkout blocked — resolve billing conflict':billingExists&&native?'Billed through '+billingSourceLabel(source):S.billingAction==='portal'?'Opening billing settings…':webPaid?'Manage or switch plan in Stripe':S.billingAction===n.toLowerCase()?'Opening secure checkout…':readinessFailed?'Paid checkout setup incomplete':'Upgrade to '+n+' — '+p+'/month';return `<div class="panel plan ${cl}"><div class="spread"><h3>ClassScribe ${n}</h3></div><div class="price">${p}<small>${u}</small></div><ul>${f.map(x=>`<li>${x}</li>`).join('')}</ul>${n==='Free'?`<button class="btn" style="width:100%;justify-content:center;margin-top:12px" data-act="billingFree" ${billing.state!=='ready'||S.billingAction?'disabled':''}>${billingExists?'Continue to library':selected?'Continue with Free':'Choose Free'}</button><p class="small muted">Buy Scribe Credits without a subscription.</p><button class="btn" style="width:100%;justify-content:center" ${goAttr({name:'credits'})}>Buy Scribe Credits</button>`:`<button class="btn ${cl?'primary':''}" style="width:100%;justify-content:center;margin-top:12px" data-act="${paidAction}" data-plan="${n.toLowerCase()}" ${paidDisabled?'disabled':''}>${paidLabel}</button>`}</div>`}).join('')}
  </div>
  <p class="small muted" style="margin-top:10px">Monthly saved-recording limits are 5 (Free), 20 (Student) and 60 (Pro), in addition to the transcription-hour limits of 5, 40 and 120 hours. Pro is not unlimited recording or transcription: additional usage beyond its included allowances requires Scribe Credits and your confirmation. Use your available credits or purchase more if needed. Paid study tools unlock only after the server verifies an active subscription.</p>
  <section class="panel" style="margin-top:28px"><div class="row" style="gap:12px;align-items:flex-start"><span style="color:var(--accent);width:28px;flex:none">${ic('shield')}</span><div class="stack" style="gap:10px;max-width:72ch">
    <h2>Recording consent and privacy</h2>
    <p>Universities and instructors set different recording policies, and recording laws vary by state and country. ClassScribe keeps consent visible instead of recording quietly in the background.</p>
    <ul style="margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:6px">
      <li><b>Consent before every session.</b> You confirm you have permission to record that class before capture starts.</li>
      <li><b>Always-visible recording indicator</b> with pause and discard controls.</li>
      <li><b>Private by default.</b> Your library is visible only to you. Sharing a lecture is a deliberate action, limited to your course group, and you can unshare it.</li>
      <li><b>No exam predictions.</b> Exam Center shows what got the most attention in your course materials; it never claims to know what will be on a test.</li>
      <li><b>Accessibility first.</b> Students with a recording accommodation can note it in their consent step.</li>
    </ul></div></div></section>
  <section class="panel" style="margin-top:14px"><h3>Where ClassScribe is headed</h3><div class="row" style="margin-top:10px;gap:8px">${LEVELS.map(x=>`<span class="chip ${x===(S.profile&&S.profile.level)?'ok':''}">ClassScribe ${x}</span>`).join('')}</div><p class="small muted" style="margin-top:8px">${LEVELS.includes(S.profile&&S.profile.level)?`You’re using ClassScribe ${esc(S.profile.level)}. Change it`:'Choose your level'} in your <a href="#" ${goAttr({name:'account'})}>account</a>.</p></section>
  <section class="panel" style="margin-top:14px" aria-labelledby="coming-soon-heading"><h3 id="coming-soon-heading">Coming soon</h3><p class="small muted" style="margin-top:8px">These editions are planned, not available to subscribe to yet.</p><div class="row" style="margin-top:10px;gap:8px"><span class="chip">ClassScribe EDU</span><span class="chip">ClassScribe Law</span><span class="chip">ClassScribe Medicine</span></div><button class="btn" style="margin-top:14px" data-act="eduInquiry" data-testid="button-edu-contact">Ask about future school access</button></section>`;

/* ---------- school inquiries and privacy-safe analytics ---------- */
function trackEvent(name){
  if(typeof window==='undefined')return;
  try{void Promise.resolve(window.umami?.track(name)).catch(()=>{})}catch{}
}
ACT.eduInquiry=()=>{
  openModal(`<div class="spread"><h2>Bring ClassScribe to your school</h2><button class="btn ghost sm" data-act="close">Close</button></div>
    <p class="small muted" id="edu-inquiry-privacy">Share your contact and school details so the ClassScribe EDU team can respond. We use them only for this inquiry. Please don’t include student records, grades, or other sensitive information. Sending a request does not start a subscription or billing.</p>
    <form class="stack" data-form="eduInquiry" aria-describedby="edu-inquiry-privacy">
      <label class="f">Your name<input class="in" name="name" autocomplete="name" required maxlength="120"></label>
      <label class="f">Work or school email<input class="in" name="email" type="email" autocomplete="email" required maxlength="254"></label>
      <label class="f">School or institution<input class="in" name="school" autocomplete="organization" required maxlength="160"></label>
      <label class="f">Your role<input class="in" name="role" autocomplete="organization-title" required maxlength="120"></label>
      <label class="f">What would you like us to know? (optional)<textarea class="in" name="message" rows="3" maxlength="1200"></textarea></label>
      <p role="status" aria-live="polite" data-edu-status></p>
      <div class="row"><button type="submit" class="btn primary">Send inquiry</button><button type="button" class="btn" data-act="close">Cancel</button></div>
    </form>`);
};
async function submitEduInquiry(form){
  if(form.dataset.pending==='1'||form.dataset.submitted==='1')return;
  const button=form.querySelector('[type="submit"]'),status=form.querySelector('[data-edu-status]');
  const inquiry=Object.fromEntries(['name','email','school','role','message'].map(key=>[key,form.elements.namedItem(key).value.trim()]));
  form.dataset.pending='1';button.disabled=true;status.textContent='Sending…';
  try{
    const response=await fetch('/api/edu-inquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(inquiry)});
    const result=await response.json();
    if(!response.ok||result.accepted!==true)throw new Error('Inquiry was not accepted');
    form.dataset.submitted='1';
    // Count only provider-accepted inquiries, with no contact details or message.
    trackEvent('edu_inquiry_sent');
    // Update only the original form, never a newer dialog opened during delivery.
    if(form.isConnected)form.innerHTML='<div role="status" aria-live="polite"><p><b>Your inquiry was sent.</b></p><p>The ClassScribe EDU team will follow up at the email address you provided.</p></div><button type="button" class="btn primary" data-act="close">Done</button>';
  }catch{
    if(form.isConnected)status.textContent='We couldn’t send your inquiry right now. Please try again.';
  }finally{
    form.dataset.pending='0';
    if(form.dataset.submitted!=='1')button.disabled=false;
  }
}
document.addEventListener('submit',event=>{
  const form=event.target.closest('[data-form="eduInquiry"]');if(!form)return;
  event.preventDefault();void submitEduInquiry(form);
});

/* ---------- modals: course, syllabus ---------- */
ACT.addCourse=()=>{
  const limited=courseLimitReached();
  openModal(`<div class="spread"><h2>Add a course</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
  <form class="stack" data-form="addCourse"><div class="grid2"><label class="f">Course code<input class="in" id="nc-code" required placeholder="PSYC 210" autofocus></label><label class="f">Semester<input class="in" id="nc-sem" value="${esc((S.profile&&S.profile.term)||curSemester())}"></label></div>
  <label class="f">Course name<input class="in" id="nc-name" required placeholder="Cognitive Psychology"></label><label class="f">Professor<input class="in" id="nc-prof" placeholder="Prof. Rivera"></label>
  <p id="course-save-error" class="small" role="status" aria-live="polite" style="color:var(--warn)">${limited?esc(courseLimitNotice()):''}</p>
  ${limited?`<button type="button" class="btn sm" ${goAttr({name:'plans'})}>Review plans</button>`:''}
  <div class="row"><button type="submit" class="btn primary" ${limited?'disabled':''}>${ic('plus')}${limited?'Course limit reached':'Add course'}</button><button type="button" class="btn ghost" data-act="syllabus" ${limited?'disabled':''}>Import a syllabus instead</button></div></form>`);
};
ACT.syllabus=el=>{const existing=el&&el.dataset.id&&course(el.dataset.id);if(existing&&isExampleRecord('courses',existing)){toast('Example content is read-only.');return}SYLLABUS_REVIEW=null;openModal(`<div class="spread"><h2>Import a syllabus</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
  <p class="muted small">Paste your syllabus or upload it as a text file. Review the extracted coursework and select the dates you want to confirm before saving to your library.</p>
  <textarea class="in" id="syl-text" rows="10" placeholder="BIO 201 · Cell Biology · Dr. Chen · Fall 2026&#10;Week 1: Membranes…&#10;Midterm: October 14…"></textarea>
  <div class="row"><label class="btn sm">${ic('upload')}Upload .txt<input type="file" id="syl-file" accept=".txt,.md,.csv,text/plain" hidden></label><span class="small muted">PDF or Word? Open it, select all, and paste the text here.</span></div>
  <div class="row"><button class="btn primary" data-act="runSyllabus" data-id="${esc(el&&el.dataset.id||'')}" id="syl-go">${ic('spark')}Build my semester</button></div><div id="syl-out"></div>`)};
let SYLLABUS_REVIEW=null;
const syllabusTitleKey=title=>title.trim().replace(/\s+/g,' ').toLowerCase();
ACT.runSyllabus=async el=>{
  const target=el.dataset.id&&course(el.dataset.id);if(target&&isExampleRecord('courses',target)){toast('Example content is read-only.');return}
  if(S.mode!=='db'){toast('Connect your library before importing a syllabus.');return}
  const textInput=$('#syl-text'),libraryId=S.uid,existingId=el.dataset.id||'';
  const text=textInput.value.trim();if(text.length<40){toast('Paste a bit more of the syllabus first.');return}
  el.disabled=true;el.innerHTML=thinking+' Reading syllabus…';
  try{
    const r=await CS_STUDY('syllabus',{material:text.slice(0,30000)});
    if(S.uid!==libraryId||S.mode!=='db'||!textInput.isConnected)return;
    SYLLABUS_REVIEW={course:r.course||{},modules:r.modules||[],assignments:(r.assignments||[]).filter(a=>a&&typeof a.title==='string'&&a.title.trim()),existingId,libraryId,importId:uid(),courseId:existingId||uid()};
    const dated=SYLLABUS_REVIEW.assignments.map((a,i)=>({...a,i}));
    openModal(`<div class="spread"><h2>Review syllabus dates</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
      <p class="small muted">Check and correct the dates, then select those to confirm. Unselected dates will not set coursework due dates or deadline alerts. A selected date only becomes a coursework due date when its title uniquely matches one coursework item. Repeated matches stay as standalone confirmed syllabus dates.</p>
      <div class="list">${dated.map(a=>`<div class="li"><input type="checkbox" data-syl-date="${a.i}" aria-label="Confirm date for ${esc(a.title)}"><span class="grow">${esc(a.title)}</span><input class="in" style="width:150px" type="date" data-syl-due="${a.i}" value="${esc(/^\d{4}-\d\d-\d\d$/.test(a.due||'')?a.due:'')}" aria-label="Date for ${esc(a.title)}"></div>`).join('')||'<p class="small muted">No coursework found. You can still import the course.</p>'}</div>
      <p id="syl-review-error" class="small" role="status" aria-live="polite"></p><div class="row"><button class="btn primary" data-act="saveSyllabus">Confirm &amp; save</button></div>`);
  }catch(e){if(S.uid!==libraryId||!textInput.isConnected)return;if(e&&e.code==='plan_limit'){const out=$('#syl-out');if(out){out.textContent=courseSaveErrorMessage(e);out.setAttribute('role','status');out.setAttribute('aria-live','polite')}}else aiErr(e);el.disabled=false;el.innerHTML=ic('spark')+'Build my semester'}
};
ACT.saveSyllabus=async el=>{
  const review=SYLLABUS_REVIEW;if(!review)return;
  if(S.uid!==review.libraryId||S.mode!=='db'){toast('Your library changed. Import the syllabus again.');return}
  const existing=review.existingId&&course(review.existingId);
  if(review.existingId&&!existing){toast('Course not found. Import the syllabus again.');return}
  el.disabled=true;
  try{
    if(!review.payload){
      const selectedDates=$$('[data-syl-date]:checked').map(input=>Number(input.dataset.sylDate));
      const assignments=review.assignments.map((a,i)=>({title:a.title.trim(),type:['homework','reading','quiz','exam','project'].includes(a.type)?a.type:'homework',due:$(`[data-syl-due="${i}"]`).value}));
      if(selectedDates.some(i=>!assignments[i].due)){throw new Error('Enter a date for every selected item.')}
      review.payload={importId:review.importId,courseId:review.courseId,existing:!!review.existingId,
        course:{code:review.course.code||'NEW 100',name:review.course.name||'New course',professor:review.course.professor||'',semester:review.course.semester||curSemester()},
        modules:review.modules,assignments,selectedDates};
      // Keep the same selection and import identity if a saved response is lost.
      $$('[data-syl-date], [data-syl-due]').forEach(input=>input.disabled=true);
    }
    const result=await requestApi('/api/','syllabus/confirm','POST',review.payload,review.libraryId);
    if(S.uid!==review.libraryId||S.mode!=='db'||SYLLABUS_REVIEW!==review||!el.isConnected)return;
    const c=result.course,list=result.assignments;
    S.courses[c.id]=c;for(const a of list)S.assignments[a.id]=a;
    const ambiguous=(c.syllabusDates||[]).filter(d=>d.linkStatus==='ambiguous').length;
    schedule();
    SYLLABUS_REVIEW=null;closeModal();go({name:'course',id:c.id,tab:'assign'});
    toast(ambiguous?`${ambiguous} confirmed ${ambiguous===1?'date was':'dates were'} saved separately because the title match was ambiguous. No coursework due date was set from those dates.`:`Added ${c.code} with ${plural(list.length,'assignment')}`);
  }catch(e){if(S.uid!==review.libraryId||SYLLABUS_REVIEW!==review||!el.isConnected)return;if(e&&e.status===400){review.payload=null;$$('[data-syl-date], [data-syl-due]').forEach(input=>input.disabled=false)}const error=$('#syl-review-error');if(error)error.textContent=(e&&e.message||'Could not confirm the syllabus.')+(review.payload?' Retry to save the same selections.':'');el.disabled=false}
};

/* ---------- modals: email / export / share ---------- */
function contentOptions(l){return [['summary','Summary & key points'],['notes','Smart notes'],['transcript','Full transcript'],['all','Everything']].map(([k,t])=>`<option value="${k}">${t}</option>`).join('')}
ACT.email=el=>{
  const l=lecture(el.dataset.id);const c=course(l.courseId)||{};
  openModal(`<div class="spread"><h2>Email this lecture</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
  <div class="grid2"><label class="f">Send<select class="in" id="em-what" data-lec="${esc(l.id)}">${contentOptions(l)}</select></label><label class="f">To<input class="in" id="em-to" type="email" placeholder="classmate@university.edu"></label></div>
  <label class="f">Subject<input class="in" id="em-subj" value="${esc((c.code?c.code+' — ':'')+l.title+' ('+fmtD(l.date)+')')}"></label>
  <label class="f">Message<textarea class="in" id="emailbody" rows="12">${esc(lectureText(l,'summary'))}</textarea></label>
  <p class="small muted">ClassScribe doesn’t send email from the web version yet. Open it in your mail app, or copy the text.</p>
  <div class="row"><a class="btn primary" id="em-open" href="#" target="_blank" rel="noopener">${ic('mail')}Open in mail app</a><button class="btn" data-act="copyEmail">Copy text</button><button class="btn" data-act="emailTxt" data-id="${esc(l.id)}">${ic('download')}Save as .txt</button></div>`,{wide:true});
  updMailto();
};
function updMailto(){const a=$('#em-open');if(!a)return;const b=$('#emailbody').value;a.href=`mailto:${encodeURIComponent($('#em-to').value)}?subject=${encodeURIComponent($('#em-subj').value)}&body=${encodeURIComponent(b.length>1800?b.slice(0,1800)+'\n…(truncated; full text attached separately)':b)}`}
ACT.copyEmail=()=>copyText($('#emailbody').value);
ACT.emailTxt=el=>{const l=lecture(el.dataset.id);download(`${l.title.replace(/[^\w -]/g,'')}.txt`,$('#emailbody').value)};
ACT.export=el=>{
  const l=lecture(el.dataset.id);
  openModal(`<div class="spread"><h2>Export</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
  <div class="grid2"><label class="f">Content<select class="in" id="ex-what">${contentOptions(l).replace('value="all"','value="all" selected')}</select></label><label class="f">Format<select class="in" id="ex-fmt"><option value="doc">Word (.doc)</option><option value="md">Markdown (.md)</option><option value="txt">Plain text (.txt)</option></select></label></div>
  <p class="small muted">For Google Docs, export as Word and upload the file to Google Drive; it opens as a Google Doc.</p>
  <div class="row"><button class="btn primary" data-act="runExport" data-id="${esc(l.id)}">${ic('download')}Export</button></div>`);
};
ACT.runExport=el=>{
  const l=lecture(el.dataset.id);const what=$('#ex-what').value,fmt=$('#ex-fmt').value;const text=lectureText(l,what);
  const base=((course(l.courseId)||{}).code||'Lecture')+' '+l.title;const fname=base.replace(/[^\w -]/g,'').slice(0,80);
  closeModal();
  if(fmt==='doc')download(fname+'.doc',asDoc(base,text));else download(fname+'.'+fmt,text);
};
ACT.share=el=>{
  const l=lecture(el.dataset.id);const c=course(l.courseId)||{};
  if(S.profile&&S.profile.ageBand==='13-17'){toast('Lecture sharing is turned off for teen libraries.');return}
  if(S.mode!=='db'){toast('Sharing with classmates works when you’re signed in to claude.ai.');return}
  if(!l.analysis){toast('Analyze the lecture first so classmates get notes and a catch-up.')}
  const sid=l.id+'-'+String(S.uid).slice(-6);const already=S.shared[sid];
  openModal(`<div class="spread"><h2>Share with ${esc(c.code||'classmates')}</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
  <p class="muted small">Classmates who open ClassScribe and join the ${esc(c.code)} group will see this lecture in <b>I Missed Class</b>. Only share recordings your instructor allows to be shared.</p>
  <label class="check"><input type="checkbox" id="sh-notes" checked disabled> <span>Summary, key points, notes and assignments</span></label>
  <label class="check"><input type="checkbox" id="sh-tx" checked> <span>Full transcript</span></label>
  <label class="check"><input type="checkbox" id="sh-copy"> <span>Let classmates save a copy to their own library</span></label>
  <div class="row"><button class="btn primary" data-act="runShare" data-id="${esc(l.id)}">${ic('share')}${already?'Update shared copy':'Share lecture'}</button>${already?`<button class="btn" data-act="unshare" data-id="${esc(sid)}">Stop sharing</button>`:''}</div>`);
};
ACT.runShare=async el=>{
  if(S.profile&&S.profile.ageBand==='13-17'){closeModal();toast('Lecture sharing is turned off for teen libraries.');return}
  const l=lecture(el.dataset.id);const c=course(l.courseId)||{};const sid=l.id+'-'+String(S.uid).slice(-6);
  const doc={code:c.code||'',courseName:c.name||'',professor:c.professor||'',title:l.title,date:l.date,module:l.module||'',duration:l.duration||0,speakers:l.speakers||{},analysis:l.analysis||null,segs:$('#sh-tx').checked?(l.segs||[]):[],marks:[],slides:[],allowCopy:$('#sh-copy').checked,by:S.uid,at:Date.now()};
  try{await DB.collection('shared').doc(sid).set(clone(doc));closeModal();toast('Shared with '+(c.code||'your class'))}catch(e){toast('Couldn’t share: '+(e.message||e.code))}
};
ACT.unshare=async el=>{try{await DB.collection('shared').doc(el.dataset.id).delete();closeModal();toast('Stopped sharing')}catch(e){toast('Couldn’t unshare')}};
ACT.saveShared=async el=>{
  const l=lecture(el.dataset.id);let c=Object.values(allC()).find(x=>codeKey(x.code)===codeKey(l.code)&&!x.ex);
  if(!c){c={id:uid(),code:l.code||'SHARED',name:l.courseName||'Shared course',professor:l.professor||'',semester:curSemester(),color:Object.keys(allC()).length%6,created:Date.now()};await put('courses',c)}
  const copy={...clone(l),id:uid(),courseId:c.id,created:Date.now(),reviewed:false};['sharedCopy','by','at','allowCopy','code','courseName','professor'].forEach(k=>delete copy[k]);
  await put('lectures',copy);toast('Saved to '+c.code);go({name:'lecture',id:copy.id});
};

/* ---------- Explain This ---------- */
function openExplain(title,passage,context,cid){
  const lv=['Beginner','Intermediate','Advanced'];
  openModal(`<div class="spread"><div><p class="eyebrow">Explain this</p><h2>${esc(title)}</h2></div><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
  ${passage?`<blockquote style="margin:0;padding:10px 14px;border-left:3px solid var(--hi);background:var(--hi-soft);border-radius:0 8px 8px 0">${esc(passage)}</blockquote>`:''}
  <div class="row" role="radiogroup" aria-label="Level">${lv.map((x,i)=>`<button class="btn sm ${i===1?'primary':''}" data-act="explainLvl" data-lvl="${x}">${x}</button>`).join('')}</div>
  <div class="md" id="explain-out"></div>`,{wide:true});
  EXPLAIN={title,passage,context,cid};runExplain('Intermediate');
}
let EXPLAIN=null;
ACT.explainLvl=el=>{$$('[data-act="explainLvl"]').forEach(b=>b.classList.toggle('primary',b===el));runExplain(el.dataset.lvl)};
async function runExplain(level){
  const out=$('#explain-out');if(!out)return;MODAL_ABORT&&MODAL_ABORT.abort();const ab=new AbortController();MODAL_ABORT=ab;
  out.innerHTML=thinking;const c=course(EXPLAIN.cid)||{};
  const guide={Beginner:'Use plain language, an everyday analogy, and no jargon without defining it.',Intermediate:'Explain like a good TA: clear, with one concrete example.',Advanced:'Be precise and technical; connect to underlying mechanisms and edge cases.'}[level];
  try{
    const r=await CS_STUDY('explain',{material:`${c.name||'Course'}\n${EXPLAIN.passage||''}\n${(EXPLAIN.context||'').slice(0,8000)}`,topic:EXPLAIN.title.slice(0,250),level:level.toLowerCase()});
    if(MODAL_ABORT===ab&&$('#explain-out'))$('#explain-out').innerHTML=md(r.text);
  }catch(e){if(e&&e.code==='cancelled')return;if($('#explain-out'))$('#explain-out').innerHTML=`<p class="muted">${e&&e.code==='unavailable'?'Explanations use Claude and need you signed in to claude.ai.':'The explanation didn’t finish. Try again.'}</p>`;if(e&&e.code!=='unavailable')aiErr(e)}
}
