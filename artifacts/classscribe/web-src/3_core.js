/* ---------- utilities ---------- */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-5);
const todayISO=()=>isoOffset(0);
const fmtT=s=>{s=Math.max(0,Math.round(+s||0));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0')};
const dObj=iso=>new Date((iso||todayISO())+'T12:00:00');
const fmtD=iso=>dObj(iso).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const fmtLong=iso=>dObj(iso).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
const daysUntil=iso=>Math.round((dObj(iso)-dObj(todayISO()))/864e5);
const relDue=iso=>{if(!iso)return'No date';const n=daysUntil(iso);return n===0?'Today':n===1?'Tomorrow':n===-1?'Yesterday':n>0?`in ${n} days`:`${-n} days ago`};
const plural=(n,w,p)=>`${n} ${n===1?w:(p||w+'s')}`;
const goAttr=o=>`data-go="${esc(JSON.stringify(o))}"`;
const use=n=>(window.claude&&typeof window.claude.use==='function')?Promise.resolve(window.claude.use(n)).catch(()=>null):Promise.resolve(null);
const clone=o=>JSON.parse(JSON.stringify(o));
const codeKey=c=>String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function curSemester(){const d=new Date(),m=d.getMonth();return (m>=7?'Fall':m<=4?'Spring':'Summer')+' '+d.getFullYear()}
function toast(msg){const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),3200)}

const IC={
home:'<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
chat:'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
cap:'<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>',
users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
tag:'<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
camera:'<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
download:'<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
share:'<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
pause:'<path d="M9 5v14M15 5v14"/>',
play:'<path d="M7 4l13 8-13 8z"/>',
stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
back:'<path d="M15 5l-7 7 7 7"/>',
book:'<path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
file:'<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
bulb:'<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
check:'<path d="m5 12 5 5 9-10"/>',
x:'<path d="M6 6l12 12M18 6 6 18"/>',
shield:'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
upload:'<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
spark:'<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
cards:'<rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>',
pencil:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
wave:'<path d="M4 12h1.5M8 8v8M12 5v14M16 9v6M20 11v2"/>'
};
const ic=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]||''}</svg>`;

/* markdown-lite with lecture citations [[lectureId@seconds]] */
function inl(s){
  s=esc(s);
  s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g,'$1<em>$2</em>').replace(/`([^`]+)`/g,'<code>$1</code>');
  s=s.replace(/\[\[([\w-]+)@(\d+(?:\.\d+)?)\]\]/g,(_,id,t,offset,whole)=>{
    const before=whole.slice(Math.max(0,offset-100),offset).replace(/<[^>]*>/g,'').replace(/\[\[.*?\]\]/g,'');
    const focus=(before.split(/[.!?]\s+/).filter(Boolean).pop()||before).replace(/[*#]/g,'').replace(/[.!?]\s*$/,'').trim().slice(-100);
    return citeChip(id,+t,focus)
  });
  s=s.replace(/\[\[NOTE:([\w-]+)\]\]/g,(_,id)=>noteCitationChip(id));
  s=s.replace(/\[\[ASSIGNMENT:([\w-]+)\]\]/g,(_,id)=>assignmentCitationChip(id));
  return s;
}
function md(src){
  if(!src)return'';
  const lines=String(src).replace(/\r/g,'').split('\n');let out='',list=null;
  const close=()=>{if(list){out+=`</${list}>`;list=null}};
  for(const raw of lines){
    const line=raw.trimEnd();let m;
    if(!line.trim()){close();continue}
    if((m=line.match(/^(#{1,4})\s+(.*)/))){close();const n=Math.min(4,m[1].length+1);out+=`<h${n}>${inl(m[2])}</h${n}>`;continue}
    if((m=line.match(/^\s*[-*•]\s+(.*)/))){if(list!=='ul'){close();out+='<ul>';list='ul'}const cb=m[1].match(/^\[( |x|X)\]\s+(.*)/);out+=cb?`<li class="todo">${cb[1]===' '?'☐':'☑'} ${inl(cb[2])}</li>`:`<li>${inl(m[1])}</li>`;continue}
    if((m=line.match(/^\s*\d+[.)]\s+(.*)/))){if(list!=='ol'){close();out+='<ol>';list='ol'}out+=`<li>${inl(m[1])}</li>`;continue}
    close();out+=`<p>${inl(line)}</p>`;
  }
  close();return out;
}
function citeChip(id,t,focus=''){
  const l=lecture(id);if(!l)return'';const c=course(l.courseId);
  if(typeof t!=='number'||!Number.isFinite(t)||t<0)return `<span class="cite">${esc((c?c.code+' · ':'')+fmtD(l.date)+' · timestamp unavailable')}</span>`;
  const review=S.view.name==='ask'&&focus?` <button type="button" class="btn sm" ${goAttr({name:'tutor',lectureIds:[id],courseId:l.courseId,mode:'teach',focus})}>Review this concept</button>`:'';
  return `<span class="cite-wrap"><button type="button" class="cite" ${goAttr({name:'lecture',id,tab:'transcript',t})}>▶ ${esc((c?c.code+' · ':'')+fmtD(l.date)+' · '+fmtT(t))}</button>${review}</span>`;
}
function noteCitationChip(id){
  const n=S.notes[id],c=n&&course(n.courseId);if(!n||n.ex||!c||c.ex||!n.body)return'';
  return `<button type="button" class="cite" ${goAttr({name:'notes',courseId:n.courseId,id:n.id})}>Private note · ${esc(n.title||'Untitled note')} · ${esc(c.code)}</button>`;
}
function assignmentCitationChip(id){
  const a=S.assignments[id],c=a&&course(a.courseId);if(!a||a.ex||!c||c.ex)return'';
  return `<button type="button" class="cite" ${goAttr({name:'course',id:a.courseId,tab:'assign',assignmentId:a.id})}>Assignment · ${esc(a.title)} · ${esc(c.code)}</button>`;
}

/* ---------- state & storage ---------- */
const EX=buildExamples();EX.stats={};
const EX_SHARED={};
const COLS=['courses','lectures','assignments','stats','notes'];
const S={courses:{},lectures:{},assignments:{},stats:{},notes:{},shared:{},view:{name:'home'},mode:'local',uid:null,showEx:false,showExReady:false,me:null,ai:undefined,busy:{},q:'',billing:{state:'idle',plan:'free'},billingNotice:'',billingAction:null,credits:{state:'idle',data:null,error:'',notice:'',action:null}};
let DB=null,USER=null,pending=false,rq=0;
function withGroupCodeDocumentReads(db){
  if(!db||typeof db.doc!=='function')return db;
  const originalDoc=db.doc.bind(db);
  db.doc=path=>{
    const ref=originalDoc(path),originalGet=ref.get.bind(ref);
    ref.get=groupCode=>{
      if(groupCode===undefined)return originalGet();
      if(typeof groupCode!=='string'||!/^g_[0-9a-f]{32}$/.test(groupCode))return Promise.reject(new Error('A valid class-group invite code is required for this document read.'));
      return fetch('/api/db/get',{method:'POST',headers:{'Content-Type':'application/json','X-CS-User':S.uid},body:JSON.stringify({path,groupCode})}).then(async response=>{
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result.error||'Could not read this class-group document.');
        const data=result.data==null?null:result.data;
        return{id:ref.id,exists:data!==null,data:()=>data};
      });
    };
    return ref;
  };
  return db;
}
try{if(localStorage.getItem('cs_hideEx_v2')==='1')S.showEx=false}catch(e){}
let billingUid=null,billingRequest=null,billingActionCode=null;
function billingUserCode(){return String(window.CS_SYNC&&window.CS_SYNC.code||S.uid||'')}
function currentBillingStatus(){
  return S.billing&&S.billing.state==='ready'&&S.billing._userCode===billingUserCode()?S.billing:null;
}
function billingSubscriptionActive(status){
  const state=String(status&&status.status||'').toLowerCase();
  if(['active','trialing'].includes(state))return true;
  const end=status&&status.periodEnd?new Date(status.periodEnd).getTime():NaN;
  return !!(status&&['canceled','cancelled'].includes(state)&&status.cancelAtPeriodEnd===true&&Number.isFinite(end)&&end>Date.now());
}
function billingCheckoutBlockReason(status=currentBillingStatus()){
  if(!status)return'Verify your current subscription status before starting checkout.';
  if(status.billingConflict)return'A second subscription may also be active. Review both billing paths before starting another checkout.';
  if(['student','pro'].includes(String(status.plan||'').toLowerCase())&&billingSubscriptionActive(status)){
    const source=String(status.billingSource||'web');
    if(source==='app_store')return'Your plan is billed through the App Store. Manage it in the original store on the device used to subscribe.';
    if(source==='play_store')return'Your plan is billed through Google Play. Manage it in the original store on the device used to subscribe.';
    if(source==='test_store')return'Your plan is billed through the RevenueCat Test Store. Manage it in the original test store and device.';
    return'Your web subscription is active. Use its Stripe billing portal to change or cancel your plan.';
  }
  return'';
}
function examFeatureState(feature){
  const billing=currentBillingStatus();
  if(!billing){
    if(S.billing&&S.billing.state==='loading'&&S.billing._userCode===billingUserCode())return'loading';
    if(S.billing&&S.billing.state==='error'&&S.billing._userCode===billingUserCode())return'error';
    void loadBillingStatus(true,billingUserCode());
    return'loading';
  }
  const plan=String(billing.plan||'').toLowerCase();
  const active=plan==='free'||billingSubscriptionActive(billing);
  if(!active)return'upgrade';
  if(feature==='studyTools')return['student','pro'].includes(plan)?'allowed':'upgrade';
  if(feature==='finals'||feature==='advancedTutor')return plan==='pro'?'allowed':'upgrade';
  return'upgrade';
}
function examAccessNotice(feature){
  const state=examFeatureState(feature);
  if(state==='allowed')return'';
  const title=feature==='finals'?'Finals Mode is included with Pro.':feature==='advancedTutor'?'The advanced lecture tutor is included with Pro.':'Flashcards and practice quizzes are included with Student and Pro; Free users can generate a study guide after confirming its credit cost.';
  if(state==='loading')return`<section class="panel exam-access" role="status"><b>Checking your library’s plan…</b><p class="small muted">Premium study tools stay locked until your subscription is verified.</p></section>`;
  if(state==='error')return`<section class="panel exam-access" role="status"><b>Couldn’t verify your plan.</b><p class="small muted">${esc(S.billing.error||'Billing status is temporarily unavailable.')}</p><div class="row"><button class="btn sm" data-act="examBillingRetry">Retry verification</button><button class="btn sm" ${goAttr({name:'plans'})}>Review plans</button></div></section>`;
  return`<section class="panel exam-access"><b>${title}</b><p class="small muted">Upgrade to unlock these exam tools. Basic notes and recording remain available on every plan.</p><button class="btn sm primary" ${goAttr({name:'plans'})}>Compare plans</button></section>`;
}
function monthlyCountLimit(kind,status=currentBillingStatus()){
  const field=kind==='recording'?'recordingCountLimit':'transcriptionCountLimit';
  const reported=Number(status&&status[field]);
  if(Number.isFinite(reported)&&reported>=0)return reported;
  const plan=String(status&&status.plan||'').toLowerCase();
  if(['student','pro'].includes(plan)&&!billingSubscriptionActive(status))return 5;
  return plan==='student'?20:plan==='pro'?60:plan==='free'?5:0;
}
function monthlyCountUsed(kind){
  const status=currentBillingStatus(),field=kind==='recording'?'recordingCountUsed':'transcriptionCountUsed';
  const used=Number(status&&status[field]);
  return status&&Number.isFinite(used)&&used>=0?used:null;
}
function recordingCountUsed(){return monthlyCountUsed('recording')}
function transcriptionCountUsed(){return monthlyCountUsed('transcription')}
function recordingCountLimitReached(){
  const limit=monthlyCountLimit('recording'),used=recordingCountUsed();
  return limit>0&&used!==null&&used>=limit;
}
function transcriptionCountLimitReached(){
  const limit=monthlyCountLimit('transcription'),used=transcriptionCountUsed();
  // This is a client-side hard-block check. Paid plans keep their included count cap,
  // but must reach the server's explicit credit quote instead of being blocked.
  const status=currentBillingStatus();
  if(['student','pro'].includes(String(status&&status.plan||'').toLowerCase()))return false;
  return limit>0&&used!==null&&used>=limit;
}
function recordingCountNotice(){
  const limit=monthlyCountLimit('recording');
  return`You’ve used all ${limit} included saved recordings this month. Extra recordings require a one-time credit confirmation.`;
}
function transcriptionCountNotice(){
  const limit=monthlyCountLimit('transcription');
  return`You’ve used all ${limit} successful transcriptions allowed this month on your verified plan. Review plans or try again next month.`;
}
function courseLimitReached(){
  const status=currentBillingStatus(),limit=Number(status&&status.courseLimit);
  return !!(status&&Number.isFinite(limit)&&limit>0&&Object.values(S.courses).filter(c=>!c.ex).length>=limit);
}
function transcriptionLimitReached(){
  const status=currentBillingStatus(),used=Number(status&&status.recordingHoursUsed),limit=Number(status&&status.recordingHoursLimit);
  return !!(status&&Number.isFinite(used)&&Number.isFinite(limit)&&limit>0&&used>=limit)||transcriptionCountLimitReached();
}
function courseLimitNotice(){
  const status=currentBillingStatus(),limit=Number(status&&status.courseLimit);
  return limit>0?`Your verified plan includes up to ${limit} courses. Upgrade your plan to add another course.`:'Your verified plan has reached its course limit. Review plans to continue.';
}
function transcriptionLimitNotice(){
  if(transcriptionCountLimitReached())return transcriptionCountNotice();
  const status=currentBillingStatus(),limit=Number(status&&status.recordingHoursLimit);
  if(status&&['student','pro'].includes(status.plan))return`You’ve used your ${limit} included monthly transcription hours. Extra transcription requires a one-time credit confirmation.`;
  return limit>0?`You’ve used your ${limit} monthly transcription hours. Review plans or try again next month.`:'Your verified plan has reached its transcription limit. Review plans to continue.';
}
function transcriptionLimitGateMarkup(){
  return transcriptionCountLimitReached()?`<p class="small" role="status" aria-live="polite" style="color:var(--warn)">${esc(transcriptionCountNotice())} <button type="button" class="btn sm" ${goAttr({name:'plans'})}>Review plans</button></p>`:'';
}
function recordingCountGateMarkup(){
  return recordingCountLimitReached()?`<p class="small" role="status" aria-live="polite" style="color:var(--warn)">${esc(recordingCountNotice())} You can try to start recording; if the server offers a credit quote, you’ll be asked before any credits are used. <button type="button" class="btn sm" ${goAttr({name:'plans'})}>Review plans</button></p>`:'';
}
function courseSaveErrorMessage(error){
  const message=error&&error.message;
  if(error&&error.code==='plan_limit')return`${message||'The Free plan includes up to 3 courses.'} Your course details are still here.`;
  return`Couldn’t save this course: ${message||'Please check your connection and try again.'} Your course details are still here.`;
}
async function requestApi(base,path,method,body,code=billingUserCode()){
  const headers={'X-CS-User':code};
  const options={method,headers,cache:'no-store'};
  if(body!==undefined){headers['Content-Type']='application/json';options.body=JSON.stringify(body)}
  let response;
  try{response=await fetch(base+path,options)}
  catch(error){throw new Error(path==='syllabus/confirm'?'Syllabus confirmation is unavailable. Check your connection and try again.':base==='/api/credits/'?'Credits service is unavailable. Check your connection and try again.':'Billing service is unavailable. Check your connection and try again.')}
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=Object.assign(new Error(data.error||data.message||'This service is temporarily unavailable. Please try again.'),data,{status:response.status});
    throw error;
  }
  return data;
}
async function billingRequestApi(path,method,body,code=billingUserCode()){
  try{return await requestApi('/api/billing/',path,method,body,code)}
  catch(error){throw new Error(error.message||'Billing is temporarily unavailable. Please try again.')}
}
let creditsRequestCode=null,creditsRequest=null,creditsCheckoutRequest=null,creditsCheckoutCode=null;
function creditsUserCode(){return billingUserCode()}
function creditsMaintenanceMessage(status){
  return Number(status)===409
    ?'Credits are temporarily paused for maintenance. Top-ups and credit use are unavailable right now.'
    :'Credits are temporarily unavailable during maintenance. Top-ups and credit use are unavailable right now.';
}
function setCreditsMaintenance(status){
  const error=creditsMaintenanceMessage(status);
  S.credits={state:'error',data:null,_userCode:creditsUserCode(),error,notice:S.credits.notice||'',action:null};
  if(['home','credits','plans','account'].includes(S.view.name))render();
  return error;
}
function validCreditsStatus(data){
  const currencyCode=data&&(data.currencyCode||data.currency&&data.currency.code);
  if(!data||data.balance==null||!Number.isFinite(Number(data.balance))||Number(data.balance)<0||typeof currencyCode!=='string'||!currencyCode.trim()||data.currency&&typeof data.currency.name!=='string'||!Array.isArray(data.packs)||!data.costs||!data.monthlyBonus||!Array.isArray(data.history))return false;
  const nonnegative=value=>value!=null&&Number.isFinite(Number(value))&&Number(value)>=0;
  return data.packs.every(pack=>pack&&typeof pack.id==='string'&&pack.id&&typeof pack.name==='string'&&pack.name.trim().length>0&&nonnegative(pack.credits)&&nonnegative(pack.priceCents)&&(pack.label===undefined||typeof pack.label==='string'))
    &&['transcription10Minutes','savedRecording','studyGuide','askQuestion'].every(key=>nonnegative(data.costs[key]))
    &&nonnegative(data.monthlyBonus.student)&&nonnegative(data.monthlyBonus.pro)
    &&data.history.every(item=>item&&typeof item.id==='string'&&typeof item.date==='string'&&item.amount!=null&&Number.isFinite(Number(item.amount))&&typeof item.reason==='string'&&typeof item.source==='string');
}
async function creditsRequestApi(path,method,body,code=creditsUserCode()){
  return requestApi('/api/credits/',path,method,body,code);
}
async function loadCreditsStatus(force=false,expectedCode){
  const code=expectedCode===undefined?creditsUserCode():String(expectedCode||'');
  if(code!==creditsUserCode())return S.credits;
  if(creditsCheckoutCode&&creditsCheckoutCode!==code){creditsCheckoutCode=null;creditsCheckoutRequest=null}
  if(!code){
    creditsRequestCode=null;creditsRequest=null;
    S.credits={state:'error',data:null,error:'Your library sync code is unavailable. Reopen your library and try again.',notice:'',action:null};
    return S.credits;
  }
  if(!force&&creditsRequestCode===code&&S.credits.state!=='idle')return creditsRequest||S.credits;
  creditsRequestCode=code;
  S.credits={state:'loading',data:S.credits.data&&S.credits._userCode===code?S.credits.data:null,error:'',notice:S.credits.notice||'',action:null,_userCode:code};
  const request=creditsRequestApi('status','GET',undefined,code).then(data=>{
    if(creditsRequestCode!==code||creditsRequest!==request||creditsUserCode()!==code)return S.credits;
    if(!validCreditsStatus(data))throw new Error('The credits service returned an incomplete status. Please try again.');
    S.credits={state:'ready',data,_userCode:code,error:'',notice:S.credits.notice||'',action:null};
    if(['home','credits','plans','account'].includes(S.view.name))render();
    return S.credits;
  }).catch(error=>{
    if(creditsRequestCode!==code||creditsRequest!==request||creditsUserCode()!==code)return S.credits;
    S.credits={state:'error',data:null,_userCode:code,error:error.status===409||error.status===503?creditsMaintenanceMessage(error.status):error.message||'Credits are temporarily unavailable. Please try again.',notice:S.credits.notice||'',action:null};
    if(['home','credits','plans','account'].includes(S.view.name))render();
    return S.credits;
  });
  creditsRequest=request;
  return request;
}
function creditNumber(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?new Intl.NumberFormat(undefined,{maximumFractionDigits:0}).format(n):'—';
}
function refreshVisibleCredits(){
  if(document.visibilityState==='hidden'||!['home','plans','credits','account'].includes(S.view.name)||!creditsUserCode()||S.credits.state==='loading'||S.credits.action)return;
  loadCreditsStatus(true);
}
window.setInterval(refreshVisibleCredits,30_000);
window.addEventListener('focus',refreshVisibleCredits);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden')refreshVisibleCredits()});
function creditsCurrency(data,cents){
  const amount=Number(cents)/100;
  if(!Number.isFinite(amount)||amount<0)return'Price unavailable';
  try{return new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(amount)}
  catch(e){return`$${amount.toFixed(2)}`}
}
function baseUsageAllowanceMarkup(status){
  if(!status)return'';
  const remaining=(used,limit)=>typeof used==='number'&&Number.isFinite(used)&&typeof limit==='number'&&Number.isFinite(limit)?Math.max(0,limit-used):null;
  const hours=remaining(status.recordingHoursUsed,status.recordingHoursLimit),recordings=remaining(status.recordingCountUsed,status.recordingCountLimit),transcriptions=remaining(status.transcriptionCountUsed,status.transcriptionCountLimit);
  const exhausted=[hours===0?'transcription hours':'',recordings===0?'saved recordings':'',transcriptions===0?'transcriptions':''].filter(Boolean);
  const paid=['student','pro'].includes(status.plan);
  return`<div class="stack" aria-live="polite"><p class="small"><b>Remaining included usage:</b> ${hours===null?'Hours unavailable':hours.toFixed(1)+' transcription hours'} · ${recordings===null?'Recordings unavailable':recordings+' saved recordings'}</p><p class="small muted">Included usage resets monthly (UTC). Unspent Scribe Credits do not expire.</p>${exhausted.length?`<p class="small" style="color:var(--warn)">Included ${esc(exhausted.join(', '))} exhausted. ${paid?'Continue with a one-time credit confirmation. Other plan limits still apply.':'Your transcription-count limit still applies on Free.'}</p><button class="btn sm" ${goAttr({name:'credits'})}>View balance and buy credits</button>`:''}</div>`;
}
function creditsSummaryMarkup(){
  const c=S.credits;
  if(c.state==='ready'&&c.data)return`<section class="panel credits-summary" aria-live="polite"><div><p class="eyebrow">Remaining Scribe Credits</p><h2>${creditNumber(c.data.balance)} <span class="credits-unit">${esc(c.data.currency?.name||c.data.currencyCode||c.data.currency?.code||'Credits')}</span></h2><p class="small muted">Included usage is used first. Student and Pro can confirm credits for extra transcription hours, transcriptions, and saved recordings. Credits accumulate and do not expire.</p><p class="small muted">${creditNumber(c.data.costs.transcription10Minutes)} credit per 10 extra transcription minutes (rounded up) · ${creditNumber(c.data.costs.savedRecording)} credits per extra saved recording. Each action needs confirmation; other plan limits still apply.</p><p class="small muted">Credit packs are available on every plan, including Free. Monthly bonus · Student ${creditNumber(c.data.monthlyBonus.student)} · Pro ${creditNumber(c.data.monthlyBonus.pro)}</p></div><button class="btn" ${goAttr({name:'credits'})}>View balance and buy credits</button></section>`;
  const message=c.state==='error'?c.error:c.state==='loading'?'Checking your credits balance…':'Credits balance has not been checked yet.';
  return`<section class="panel credits-summary" role="${c.state==='error'?'alert':'status'}"><div><p class="eyebrow">Credits balance</p><p>${esc(message)}</p></div><div class="row"><button class="btn" ${goAttr({name:'credits'})}>Credits</button>${c.state==='error'?'<button class="btn" data-act="creditsRetry">Try again</button>':''}</div></section>`;
}
let pendingCreditConsent=null;
function requestCreditOverspendConsent(action,onConsent){
  if(!action||typeof action.id!=='string'||!action.id.trim()||typeof action.label!=='string'||!action.label.trim())return Promise.reject(new Error('Credit overage consent requires a specific linked action.'));
  if(pendingCreditConsent)pendingCreditConsent.resolve(false);
  return new Promise(resolve=>{
    pendingCreditConsent={resolve,onConsent,action:{id:action.id,label:action.label}};
    openModal(`<div class="spread"><div><p class="eyebrow">Optional credit overage</p><h2 id="credits-consent-heading">Approve this action only?</h2></div><button class="btn ghost sm" data-act="creditsConsentCancel" aria-label="Close consent">${ic('x')}Close</button></div><p>This linked action may use credits beyond your available balance: <b>${esc(action.label)}</b>.</p><p class="small muted">No overage is authorized unless you check the box and approve below. Approval applies only to this action; it does not enable future overages.</p><label class="check"><input type="checkbox" id="credits-overspend-optin"><span>I explicitly approve a server-side credit overage for this action.</span></label><p id="credits-consent-error" class="small" role="alert" hidden></p><div class="row" style="justify-content:flex-end"><button class="btn" data-act="creditsConsentCancel">Not now</button><button class="btn primary" data-act="creditsConsentConfirm" data-action-id="${esc(action.id)}" disabled>Approve this action</button></div>`);
    const dialog=$('#modal-root .modal');if(dialog)dialog.setAttribute('aria-labelledby','credits-consent-heading');
  });
}
function settleCreditConsent(approved){
  const pending=pendingCreditConsent;
  if(!pending)return;
  pendingCreditConsent=null;
  closeModal();
  pending.resolve(!!approved);
  if(approved&&typeof pending.onConsent==='function')pending.onConsent(pending.action);
}
window.CS_REQUEST_CREDIT_OVERSPEND_CONSENT=requestCreditOverspendConsent;
let pendingCreditActionConfirmation=null;
function requestCreditActionConfirmation(details,label){
  if(pendingCreditActionConfirmation)pendingCreditActionConfirmation.resolve(false);
  return new Promise(resolve=>{
    pendingCreditActionConfirmation={resolve};
    const cost=creditNumber(details.cost),balance=creditNumber(details.balance);
    openModal(`<div class="spread"><div><p class="eyebrow">One-time credit confirmation</p><h2 id="credit-action-heading">Continue with ${esc(label)}?</h2></div><button class="btn ghost sm" data-act="creditActionCancel" aria-label="Close confirmation">${ic('x')}Close</button></div><p>${esc(details.error||`This action costs ${cost} credits.`)}</p><p><b>Cost:</b> ${cost} credits · <b>Current balance:</b> ${balance} credits</p><p class="small muted">Approval applies only to this action. ClassScribe will retry the original request with this quote; it will not authorize future actions.</p><div class="row" style="justify-content:flex-end"><button class="btn" data-act="creditActionCancel">Not now</button><button class="btn primary" data-act="creditActionApprove">Use ${cost} credits and continue</button></div>`);
    const dialog=$('#modal-root .modal');if(dialog)dialog.setAttribute('aria-labelledby','credit-action-heading');
  });
}
function settleCreditActionConfirmation(approved){
  const pending=pendingCreditActionConfirmation;
  if(!pending)return;
  pendingCreditActionConfirmation=null;closeModal();pending.resolve(!!approved);
}
function showInsufficientCredits(error,label){
  openModal(`<div class="spread"><div><p class="eyebrow">Credits needed</p><h2 id="insufficient-credits-heading">Not enough credits</h2></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}Close</button></div><p>${esc(error.message||`There are not enough credits to continue with ${label}.`)}</p>${error.cost!=null||error.balance!=null?`<p><b>Cost:</b> ${creditNumber(error.cost)} credits · <b>Current balance:</b> ${creditNumber(error.balance)} credits</p>`:''}<p class="small muted">No credits were spent on this attempt. You can add a credit pack or return to this action later.</p><div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">Not now</button><button class="btn primary" ${goAttr({name:'credits'})}>View credits</button></div>`);
  const dialog=$('#modal-root .modal');if(dialog)dialog.setAttribute('aria-labelledby','insufficient-credits-heading');
}
async function creditActionPost(path,body,label,options={}){
  if(S.credits.state==='error'&&/Credits are temporarily (?:paused|unavailable) for maintenance|Credits are temporarily unavailable during maintenance/.test(S.credits.error)){
    throw Object.assign(new Error(S.credits.error),{code:'credits_maintenance'});
  }
  const code=String(options.userCode===undefined?billingUserCode():options.userCode||'');
  const state=options.confirmation||{};
  const assertCurrent=()=>{if(options.isCurrent&&!options.isCurrent())throw{code:'cancelled',message:'Stopped'}};
  const refresh=async()=>{
    await Promise.all([
      loadCreditsStatus(true,code).catch(()=>{}),
      loadBillingStatus(true,code).catch(()=>{})
    ]);
  };
  const send=async payload=>{
    const response=await fetch(path,{
      method:'POST',headers:{'Content-Type':'application/json','X-CS-User':code},
      cache:'no-store',...(options.signal?{signal:options.signal}:{}),body:JSON.stringify(payload)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=response.status===409||response.status===503?setCreditsMaintenance(response.status):data.error||data.message||response.statusText||'This action could not be completed.';
      const error=Object.assign(new Error(message),data,{status:response.status});
      throw error;
    }
    return data;
  };
  const confirmedPayload=(quote)=>{
    const requestId=state.requestId||quote.requestId;
    const payload={...body,useCredits:true,requestId};
    if(options.askId)payload.askId=options.askId;
    if(options.includeQuotedCost)payload.cost=quote.cost;
    return payload;
  };
  try{
    assertCurrent();
    const initial={...body,...(state.useCredits?{useCredits:true,requestId:state.requestId}:{}),...(options.askId?{askId:options.askId}:{})};
    return await send(initial);
  }catch(error){
    if(error&&error.status===402&&error.code==='credits_required'){
      let quote=error,lastError=error;
      for(let attempt=0;attempt<3;attempt++){
        const changedQuote=state.useCredits&&(quote.confirmationRequired===true||
          state.quoteCost!=null&&quote.cost!=null&&Number(state.quoteCost)!==Number(quote.cost));
        if(!state.useCredits||changedQuote){
          const approved=await requestCreditActionConfirmation(quote,label);
          if(!approved){if(state.useCredits)await refresh();throw Object.assign(new Error('You chose not to use credits for this action.'),{code:'credits_cancelled'})}
        }
        assertCurrent();
        if(!quote.requestId&&!state.requestId){if(state.useCredits)await refresh();throw Object.assign(new Error('The server did not provide a credit confirmation ID. Please try again.'),{code:'invalid_confirmation'})}
        if(state.requestId&&quote.requestId&&state.requestId!==quote.requestId){if(state.useCredits)await refresh();throw Object.assign(new Error('The credit quote changed. Retry this action to request a new confirmation.'),{code:'confirmation_changed'})}
        state.useCredits=true;state.requestId=state.requestId||quote.requestId;state.quoteCost=quote.cost;
        try{
          const result=await send(confirmedPayload(quote));
          await refresh();return result;
        }catch(retryError){
          lastError=retryError;
          if(retryError&&retryError.status===402&&retryError.code==='credits_required'){quote=retryError;continue}
          await refresh();
          if(retryError&&retryError.status===422&&retryError.code==='insufficient_credits')showInsufficientCredits(retryError,label);
          throw retryError;
        }
      }
      await refresh();throw lastError;
    }
    if(state.useCredits)await refresh();
    if(error&&error.status===422&&error.code==='insufficient_credits')showInsufficientCredits(error,label);
    throw error;
  }
}
function installCreditAwareTranscription(){
  if(typeof window.CS_TRANSCRIBE!=='function')return;
  window.CS_TRANSCRIBE=async(blob,{timed=true,consentId,recordingId,sessionId,lectureId,courseId}={})=>{
    const code=String(billingUserCode()||'');
    if(blob.size>25*1024*1024)throw{code:'too_large',message:'Recording is over the 25 MB transcription limit.'};
    const audio=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);
    });
    const mime=blob.type||'audio/webm';
    const ext=mime.includes('mp4')||mime.includes('aac')?'m4a':mime.includes('mpeg')?'mp3':mime.includes('wav')?'wav':mime.includes('ogg')?'ogg':'webm';
    if(timed&&(!consentId||!recordingId||!sessionId||!lectureId||!courseId))throw new Error('A saved recording consent, session, lecture, and course are required before transcription.');
    if(consentId||recordingId||sessionId||lectureId||courseId){
      if(!consentId||!recordingId||!sessionId||!lectureId||!courseId)throw new Error('The recorded lecture consent tuple is incomplete.');
      if(String(recordingId)!==String(sessionId))throw new Error('The recording and consent session IDs do not match.');
    }
    const result=await creditActionPost('/api/transcribe',{
      audio,filename:(timed?'lecture.':'question.')+ext,mime,timed,
      ...(consentId?{recordingId:String(recordingId),sessionId:String(sessionId),lectureId:String(lectureId),courseId:String(courseId),consentId:String(consentId)}:{})
    },'transcribe this recording',{userCode:code,includeQuotedCost:true,isCurrent:()=>billingUserCode()===code});
    return result.segments||[];
  };
}
installCreditAwareTranscription();
async function billingRecordingAction(action,recordingId,code=billingUserCode(),consent={}){
  if(!['reserve','finish','release'].includes(action))throw new Error('Invalid recording reservation action.');
  if(!recordingId)throw new Error('A recording ID is required.');
  if(action==='reserve'){
    if(!consent.consentId||!consent.sessionId||!consent.lectureId||!consent.courseId)throw new Error('The current recording consent is missing its stable session, lecture, course, or consent ID.');
    return creditActionPost('/api/billing/recordings/reserve',{
      recordingId:String(recordingId),consentId:String(consent.consentId),sessionId:String(consent.sessionId),
      lectureId:String(consent.lectureId),courseId:String(consent.courseId)
    },'save this recording',{userCode:code,isCurrent:()=>billingUserCode()===code});
  }
  return billingRequestApi('recordings/'+action,'POST',{recordingId:String(recordingId)},code);
}
function billingStatusText(status,showTranscriptionCount=true){
  if(!status)return'';
  const plan=String(status.plan||'free').toLowerCase();
  const planLabel=plan==='student'?'Student':plan==='pro'?'Pro':'Free';
  const state=String(status.status||'inactive').toLowerCase();
  const usage=Number.isFinite(Number(status.recordingHoursUsed))&&Number.isFinite(Number(status.recordingHoursLimit))
    ?` · ${Number(status.recordingHoursUsed).toFixed(1)} of ${Number(status.recordingHoursLimit)} transcription hours used`: '';
  const recordingLimit=monthlyCountLimit('recording',status),recordingCount=Number(status.recordingCountUsed);
  const transcriptionLimit=monthlyCountLimit('transcription',status),transcriptionCount=Number(status.transcriptionCountUsed);
  const countUsage=Number.isFinite(recordingCount)&&(!showTranscriptionCount||Number.isFinite(transcriptionCount))
    ?` · ${recordingCount} of ${recordingLimit} saved recordings${showTranscriptionCount?` · ${transcriptionCount} of ${transcriptionLimit} successful transcriptions`:''}`: '';
  const nativeRenewal=['app_store','play_store','test_store'].includes(String(status.billingSource||''));
  const renewalStatus=String(status.renewalStatus||'').toLowerCase();
  const renewalDate=status.periodEnd?new Date(status.periodEnd).toLocaleDateString():'';
  const nativeRenewalCopy=nativeRenewal?({
    will_not_renew:` · cancels ${renewalDate||'at period end'}`,
    will_change_product:` · plan changes${renewalDate?' on '+renewalDate:''}`,
    will_pause:` · subscription pauses${renewalDate?' on '+renewalDate:''}`,
    requires_price_increase_consent:` · renewal requires your consent${renewalDate?' by '+renewalDate:''}`
  })[renewalStatus]:'';
  const period=nativeRenewalCopy|| (status.periodEnd?` · ${status.cancelAtPeriodEnd?'cancels':'renews'} ${renewalDate}`:status.cancelAtPeriodEnd?' · cancels at period end':'');
  if(plan==='free'||!billingSubscriptionActive(status))return`ClassScribe ${planLabel} · ${state==='inactive'?'no active subscription':state}${usage}${countUsage}`;
  return`ClassScribe ${planLabel} · Active${usage}${countUsage}${period}`;
}
async function loadBillingStatus(force,expectedCode,refreshStripe=false){
  const code=expectedCode===undefined?billingUserCode():String(expectedCode||'');
  if(code!==billingUserCode())return S.billing;
  if(!code){
    billingUid=null;billingRequest=null;billingActionCode=null;
    S.billing={state:'error',plan:'free',_userCode:'',error:'Your library sync code is unavailable. Reopen your library and try again.'};
    return S.billing;
  }
  if(!force&&billingUid===code&&S.billing.state!=='idle')return billingRequest||S.billing;
  if(billingUid&&billingUid!==code){S.billingAction=null;billingActionCode=null;S.billingNotice=''}
  billingUid=code;S.billing={state:'loading',plan:'free',_userCode:code};
  const request=billingRequestApi('status'+(refreshStripe?'?refresh=1':''),'GET',undefined,code).then(status=>{
    if(billingUid!==code||billingRequest!==request||billingUserCode()!==code)return S.billing;
    S.billing={...status,state:'ready',plan:status.plan||'free',_userCode:code};
    if(typeof retryPendingRecordingActions==='function')void retryPendingRecordingActions(code);
    if(S.view.name==='plans'||S.view.name==='account'||S.view.name==='home'||S.view.name==='grades'||S.view.name==='ask'||S.view.name==='course'&&S.view.tab==='grades'||['exam','study','tutor','capture'].includes(S.view.name))render();
    return S.billing;
  }).catch(error=>{
    if(billingUid!==code||billingRequest!==request||billingUserCode()!==code)return S.billing;
    S.billing={state:'error',plan:'free',_userCode:code,error:error.message||'Could not load your plan.'};
    if(S.view.name==='plans'||S.view.name==='account'||S.view.name==='home'||S.view.name==='grades'||S.view.name==='ask'||S.view.name==='course'&&S.view.tab==='grades'||['exam','study','tutor','capture'].includes(S.view.name))render();
    return S.billing;
  });
  billingRequest=request;
  return request;
}
function billingReturnNotice(){
  const params=new URLSearchParams(location.search);
  const result=params.get('billing');
  if(!result)return;
  S.view={name:'plans'};
  if(result==='success'){
    const code=billingUserCode();
    S.billingNotice='Payment submitted. Checking Stripe for your updated plan…';
    loadBillingStatus(true,code).then(async status=>{
      for(let attempt=0;attempt<5&&status&&status.plan==='free';attempt++){
        await new Promise(resolve=>setTimeout(resolve,900));
      if(billingUserCode()!==code){if(S.billingNotice==='Payment submitted. Checking Stripe for your updated plan…')S.billingNotice='';return}
        status=await loadBillingStatus(true,code);
      }
      if(billingUserCode()!==code){if(S.billingNotice==='Payment submitted. Checking Stripe for your updated plan…')S.billingNotice='';return}
      S.billingNotice=status&&['active','trialing'].includes(String(status.status||'').toLowerCase())
        ?'Your subscription is active on this library.'
        :'Payment confirmation is still syncing. Your plan will update as soon as Stripe confirms it; refresh this page in a moment.';
      if(S.view.name==='plans'||S.view.name==='account')render();
    });
  }else if(result==='cancel'||result==='cancelled')S.billingNotice='Checkout was cancelled. No subscription was started.';
  else if(result==='portal'){
    const code=billingUserCode();
    S.billingNotice='Billing settings closed. Refreshing your subscription status…';
    loadBillingStatus(true,code,true).then(status=>{
      if(billingUserCode()!==code)return;
      S.billingNotice=status&&status.state==='ready'
        ?'Subscription status refreshed: '+billingStatusText(status,false)
        :'Could not refresh subscription status: '+(status&&status.error||'Please retry from Plans.');
      if(S.view.name==='plans'||S.view.name==='account')render();
    });
  }
  params.delete('billing');
  const next=location.pathname+(params.toString()?'?'+params.toString():'')+location.hash;
  history.replaceState(history.state,'',next);
}
async function openBillingCheckout(plan,checkoutWindow){
  if(S.billingAction){if(checkoutWindow)checkoutWindow.close();S.billingNotice='A billing request is already in progress. Wait a moment and try again.';return}
  const code=billingUserCode();
  if(!code||!currentBillingStatus()){if(checkoutWindow)checkoutWindow.close();const notice='Verify your current subscription status before starting checkout.';S.billingNotice=notice;await loadBillingStatus(true,code);if(billingUserCode()===code){if(S.view.name==='plans'||S.view.name==='account')render()}else if(S.billingNotice===notice)S.billingNotice='';return}
  const blockReason=billingCheckoutBlockReason(currentBillingStatus());
  if(blockReason){if(checkoutWindow)checkoutWindow.close();S.billingNotice=blockReason;if(S.view.name==='plans'||S.view.name==='account')render();return}
  S.billingAction=plan;billingActionCode=code;S.billingNotice='Opening secure Stripe checkout…';render();
  try{
    const success=new URL(location.href);success.searchParams.set('billing','success');
    const {url}=await billingRequestApi('checkout','POST',{plan,returnUrl:success.toString()},code);
    if(billingUserCode()!==code){if(checkoutWindow)checkoutWindow.close();if(billingActionCode===code){S.billingAction=null;billingActionCode=null;S.billingNotice=''}if(S.view.name==='plans'||S.view.name==='account')render();return}
    const destination=new URL(url);
    if(destination.protocol!=='https:'||destination.hostname!=='checkout.stripe.com')throw new Error('Stripe returned an unexpected checkout address. Please try again.');
    if(checkoutWindow){checkoutWindow.opener=null;checkoutWindow.location.href=destination.toString()}
    else location.assign(destination.toString());
    return true;
  }catch(error){
    if(checkoutWindow)checkoutWindow.close();
    if(billingUserCode()!==code){if(billingActionCode===code){S.billingAction=null;billingActionCode=null;S.billingNotice=''}if(S.view.name==='plans'||S.view.name==='account')render();return}
    S.billingNotice=error.message||'Could not open Stripe checkout. Please try again.';
    S.billingAction=null;billingActionCode=null;if(S.view.name==='plans'||S.view.name==='account')render();
  }
}
async function openCreditsCheckout(packId,checkoutWindow){
  const code=creditsUserCode(),status=S.credits;
  if(creditsCheckoutRequest){if(checkoutWindow)checkoutWindow.close();return}
  const pack=status&&status.data&&status.data.packs.find(item=>item.id===String(packId));
  if(!code||status.state!=='ready'||!pack){
    if(checkoutWindow)checkoutWindow.close();
    S.credits.notice='Verify your credits balance and available packs before starting checkout.';
    await loadCreditsStatus(true,code);
    if(creditsUserCode()===code&&['credits','home','plans','account'].includes(S.view.name))render();
    return;
  }
  creditsCheckoutRequest=String(packId);creditsCheckoutCode=code;
  S.credits={...S.credits,action:String(packId),notice:`Opening secure checkout for ${pack.name}…`};
  if(['credits','home','plans','account'].includes(S.view.name))render();
  try{
    const returnUrl=new URL(location.href);returnUrl.searchParams.set('credits','success');
    const result=await creditsRequestApi('checkout','POST',{packId:String(packId),returnUrl:returnUrl.toString()},code);
    if(creditsUserCode()!==code){if(checkoutWindow)checkoutWindow.close();if(creditsCheckoutCode===code){creditsCheckoutCode=null;creditsCheckoutRequest=null;if(S.credits._userCode===code)S.credits={...S.credits,action:null,notice:''}}return}
    let destination;
    try{destination=new URL(result.url)}catch(e){throw new Error('Stripe returned an invalid checkout address. Please try again.')}
    if(destination.protocol!=='https:'||destination.hostname!=='checkout.stripe.com')throw new Error('Stripe returned an unexpected checkout address. Please try again.');
    if(checkoutWindow){checkoutWindow.opener=null;checkoutWindow.location.href=destination.toString();creditsCheckoutRequest=null;creditsCheckoutCode=null;S.credits={...S.credits,action:null,notice:`Secure Stripe checkout for ${pack.name} opened in a new tab.`};if(['credits','home','plans','account'].includes(S.view.name))render()}
    else location.assign(destination.toString());
  }catch(error){
    if(checkoutWindow)checkoutWindow.close();
    if(creditsUserCode()!==code)return;
    S.credits={...S.credits,action:null,notice:error.message||'Could not open secure Stripe checkout. Please try again.'};
    creditsCheckoutRequest=null;creditsCheckoutCode=null;
    if(['credits','home','plans','account'].includes(S.view.name))render();
    return;
  }
}
function creditsReturnNotice(){
  const params=new URLSearchParams(location.search),result=params.get('credits');
  if(!result)return;
  if(result==='success'){
    const code=creditsUserCode();
    S.credits={...S.credits,notice:'Payment submitted. Checking for your updated credits balance…'};
    loadCreditsStatus(true,code).then(async status=>{
      for(let attempt=0;attempt<4&&status&&status.state==='ready'&&status.data&&S.credits.notice==='Payment submitted. Checking for your updated credits balance…';attempt++){
        await new Promise(resolve=>setTimeout(resolve,900));
        if(creditsUserCode()!==code)return;
        status=await loadCreditsStatus(true,code);
      }
      if(creditsUserCode()!==code)return;
      S.credits={...S.credits,notice:status&&status.state==='ready'?'Credits balance refreshed.':'Payment confirmation is still syncing. Your balance will update after Stripe confirms it; refresh shortly.'};
      if(['credits','home','plans','account'].includes(S.view.name))render();
    });
  }else if(result==='cancel'||result==='cancelled'){
    S.credits={...S.credits,notice:'Checkout was cancelled. No credits were purchased.'};
  }
  params.delete('credits');
  history.replaceState(history.state,'',location.pathname+(params.toString()?'?'+params.toString():'')+location.hash);
}
async function openBillingPortal(){
  let portalWindow=null;
  if(window.self!==window.top){
    portalWindow=window.open('about:blank','_blank');
    if(!portalWindow){S.billingNotice='Allow pop-ups to open secure billing settings in a new tab, then try again.';render();return}
  }
  if(S.billingAction){if(portalWindow)portalWindow.close();return}
  const code=billingUserCode();
  if(!code||!currentBillingStatus()){if(portalWindow)portalWindow.close();const notice='Verify your current subscription status before opening billing settings.';S.billingNotice=notice;await loadBillingStatus(true,code);if(billingUserCode()===code){if(S.view.name==='plans'||S.view.name==='account')render()}else if(S.billingNotice===notice)S.billingNotice='';return}
  const billing=currentBillingStatus(),source=String(billing.billingSource||'web');
  if(['app_store','play_store','test_store'].includes(source)&&!billing.billingConflict){if(portalWindow)portalWindow.close();S.billingNotice=billingCheckoutBlockReason(billing);if(S.view.name==='plans'||S.view.name==='account')render();return}
  S.billingAction='portal';billingActionCode=code;S.billingNotice='Opening secure billing settings…';render();
  try{
    const returnUrl=new URL(location.href);returnUrl.searchParams.set('billing','portal');
    const {url}=await billingRequestApi('portal','POST',{returnUrl:returnUrl.toString()},code);
    if(billingUserCode()!==code){if(portalWindow)portalWindow.close();if(billingActionCode===code){S.billingAction=null;billingActionCode=null;S.billingNotice=''}if(S.view.name==='plans'||S.view.name==='account')render();return}
    const destination=new URL(url);
    if(destination.protocol!=='https:'||destination.hostname!=='billing.stripe.com')throw new Error('Stripe returned an unexpected billing address. Please try again.');
    if(portalWindow){portalWindow.opener=null;portalWindow.location.href=destination.toString()}
    else location.assign(destination.toString());
  }catch(error){
    if(portalWindow)portalWindow.close();
    if(billingUserCode()!==code){if(billingActionCode===code){S.billingAction=null;billingActionCode=null;S.billingNotice=''}if(S.view.name==='plans'||S.view.name==='account')render();return}
    S.billingNotice=error.message||'Could not open billing settings. Please try again.';
    S.billingAction=null;billingActionCode=null;if(S.view.name==='plans'||S.view.name==='account')render();
  }
}
function localLoad(){try{const j=JSON.parse(localStorage.getItem('cs_lib')||'{}');COLS.forEach(c=>S[c]=j[c]||{})}catch(e){}}
function localSave(){try{localStorage.setItem('cs_lib',JSON.stringify(Object.fromEntries(COLS.map(c=>[c,S[c]]))))}catch(e){}}
function colRef(c){return DB.doc('data/users/'+S.uid+'/lib').collection(c)}
function isExampleRecord(c,obj){
  if(!obj)return false;
  if(obj.ex||((EX[c]||{})[obj.id]||{}).ex||((S[c]||{})[obj.id]||{}).ex)return true;
  const courseId=obj.courseId||(c==='courses'?obj.id:'');
  const parentCourse=courseId&&(((EX.courses||{})[courseId])||((S.courses||{})[courseId]));
  if(parentCourse&&parentCourse.ex)return true;
  const lectureId=obj.lectureId||(c==='lectures'?obj.id:'');
  const parentLecture=lectureId&&(((EX.lectures||{})[lectureId])||((S.lectures||{})[lectureId]));
  return !!(parentLecture&&parentLecture.ex);
}
async function put(c,obj,options={}){
  if(isExampleRecord(c,obj)){toast('Example content is read-only.');return}
  if(S.mode==='db'&&options.requireAck){
    await colRef(c).doc(obj.id).set(clone(obj));
    S[c][obj.id]=obj;schedule();return
  }
  S[c][obj.id]=obj;schedule();
  if(S.mode==='db'){try{await colRef(c).doc(obj.id).set(clone(obj))}catch(e){toast('Couldn’t save to your library: '+(e&&e.message||'try again'))}}
  else localSave();
}
async function del(c,id){
  if(isExampleRecord(c,{id})){toast('Example content is read-only.');return}
  delete S[c][id];schedule();
  if(S.mode==='db'){try{await colRef(c).doc(id).delete()}catch(e){}}else localSave();
}
function schedule(){if(rq)return;rq=requestAnimationFrame(()=>{rq=0;softRender()})}
function softRender(){
  const a=document.activeElement;
  if(S.view.name==='capture'&&SES&&SES.step==='live'){renderSide();return}
  if(a&&$('#main').contains(a)&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)){pending=true;renderSide();return}
  render();
}
document.addEventListener('focusout',()=>setTimeout(()=>{if(pending){const a=document.activeElement;if(!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)))render()}},120));

async function initStore(){
  if(new URLSearchParams(location.search).get('cs_account')==='1')S.view={name:'account'};
  localLoad();S.profile=loadProfileLocal()||undefined;render();
  AI();
  const [db,user]=await Promise.all([use('db'),use('user')]);
  USER=user;
  if(db&&user){
    let id=null;try{id=await user.id()}catch(e){}
    if(id){
      S.uid=id;DB=withGroupCodeDocumentReads(db);S.mode='db';
      const local=Object.fromEntries(COLS.map(c=>[c,S[c]]));
      COLS.forEach(c=>{S[c]={};colRef(c).onSnapshot(snap=>{const m={};snap.docs.forEach(d=>{m[d.id]={...d.data(),id:d.id}});S[c]=m;schedule()},e=>console.warn('db',c,e))});
      let moved=0;
      for(const c of COLS)for(const o of Object.values(local[c]||{})){try{await colRef(c).doc(o.id).set(clone(o));moved++}catch(e){}}
      if(moved){try{localStorage.removeItem('cs_lib')}catch(e){}}
      await loadProfile();
      DB.collection('shared').onSnapshot(snap=>{const m={};snap.docs.forEach(d=>{m[d.id]={...d.data(),id:d.id,sharedCopy:true}});S.shared=m;schedule()},()=>{});
    }
  }
  if(S.mode!=='db')await loadProfile();
  if(!S.profile)S.profile=null;
  render();
  if(S.uid)void loadBillingStatus();
}

/* accessors */
const examplesVisible=()=>S.showExReady&&S.showEx;
const allC=()=>({...(examplesVisible()?EX.courses:{}),...S.courses});
const course=id=>S.courses[id]||EX.courses[id];
const byDate=(a,b)=>a.date<b.date?-1:a.date>b.date?1:(a.created||0)-(b.created||0);
const allL=()=>({...(examplesVisible()?EX.lectures:{}),...S.lectures});
const lecturesOf=cid=>Object.values(allL()).filter(l=>!cid||l.courseId===cid).sort(byDate);
const lecture=id=>S.lectures[id]||EX.lectures[id]||S.shared[id]||EX_SHARED[id];
const allA=()=>({...(examplesVisible()?EX.assignments:{}),...S.assignments});
const assignOf=cid=>Object.values(allA()).filter(a=>!cid||a.courseId===cid).sort((a,b)=>(a.due||'9')<(b.due||'9')?-1:1);
const statsOf=cid=>S.stats[cid]||EX.stats[cid]||{id:cid,ex:!!(course(cid)||{}).ex,concepts:{}};
const ccVar=c=>`--cc:var(--c${((c&&c.color)||0)%6+1})`;
const codeChip=c=>c?`<span class="chip code" style="${ccVar(c)}">${esc(c.code)}</span>`:'';
const isMine=l=>!!(l&&(S.lectures[l.id]||EX.lectures[l.id]));
function spkName(l,s){return (l.speakers&&l.speakers[s])||({P:'Professor',S:'Student',G:'Guest'}[s]||s)}
function coursesSorted(){return Object.values(allC()).sort((a,b)=>(a.created||0)-(b.created||0))}

/* ---------- AI (sample capability) ---------- */
let aiPromise=null;
function AI(){if(!aiPromise)aiPromise=use('sample').then(s=>{S.ai=s;return s});return aiPromise}
async function aiText(input,opts){const s=await AI();if(!s)throw{code:'unavailable'};return s(input,opts)}
async function aiJSON(input,opts){const s=await AI();if(!s)throw{code:'unavailable'};return s.json(input,opts)}
function aiErr(e){const m={unavailable:'AI features need you signed in to claude.ai.',not_granted:'AI access wasn’t allowed for this page. Reload the page to be asked again.',rate_limited:'Too many AI requests at once. Wait a minute and try again.',paid_required:'This AI tool requires a verified Student or Pro plan. Open Plans to upgrade.',cancelled:'Stopped.'};toast(m[e&&e.code]||('The AI request didn’t finish: '+((e&&e.message)||'unknown error')))}
const thinking='<span class="thinking" aria-label="Thinking"><i></i><i></i><i></i></span>';

/* stats: weak areas */
function record(cid,concept,ok,recordId,metadata){
  if(!cid||!concept)return false;
  const st=clone(statsOf(cid));st.id=cid;st.ex=!!(course(cid)||{}).ex;st.concepts=st.concepts||{};
  if(recordId){
    st.recorded=st.recorded||{};
    if(st.recorded[recordId])return false;
    st.recorded[recordId]=Date.now();
    const ids=Object.keys(st.recorded).sort((a,b)=>st.recorded[a]-st.recorded[b]);
    ids.slice(0,Math.max(0,ids.length-200)).forEach(id=>delete st.recorded[id]);
  }
  const k=String(concept).trim();if(!k)return false;
  const c=st.concepts[k]||{r:0,w:0};ok?c.r++:c.w++;c.last=Date.now();st.concepts[k]=c;
  if(metadata){st.attempts=st.attempts||[];st.attempts.push({at:Date.now(),concept:k,...metadata});if(st.attempts.length>80)st.attempts.splice(0,st.attempts.length-80)}
  put('stats',st);return true;
}
function markReviewed(ids){ids.forEach(id=>{const l=S.lectures[id]||EX.lectures[id];if(l&&!l.reviewed){put('lectures',{...l,reviewed:true})}})}
function weakList(cid){return Object.entries(statsOf(cid).concepts||{}).map(([k,v])=>({concept:k,...v})).filter(x=>x.w>0).sort((a,b)=>(b.w-b.r)-(a.w-a.r)||b.w-a.w)}

/* material for prompts */
function material(lecs,max=26000){
  let out='';
  for(const l of lecs){
    const a=l.analysis;const c=course(l.courseId)||{};
    let s=`\n### Lecture id=${l.id} · ${c.code||''} · ${l.date} · "${l.title}"\n`;
    if(a){
      s+=`Summary: ${a.summary||''}\nKey points:\n${(a.keyPoints||[]).map(k=>'- '+k).join('\n')}\n`;
      if(a.emphasized&&a.emphasized.length)s+=`Professor emphasized:\n${a.emphasized.map(e=>`- ${e.concept} (${e.why}) @${e.t}`).join('\n')}\n`;
      if(a.terms&&a.terms.length)s+=`Terms:\n${a.terms.map(t=>`- ${t.term}: ${t.def} @${t.t}`).join('\n')}\n`;
      if(a.examples&&a.examples.length)s+=`Examples/formulas:\n${a.examples.map(t=>`- [${t.kind}] ${t.text} @${t.t}`).join('\n')}\n`;
    }else{
      s+='Transcript:\n'+(l.segs||[]).map(g=>`[${Math.round(g.t)}] ${spkName(l,g.s)}: ${g.x}`).join('\n').slice(0,6000)+'\n';
    }
    if(l.myNotes)s+=`Student's own notes: ${l.myNotes.slice(0,1500)}\n`;
    Object.values(typeof allN==='function'?allN():{}).filter(n=>n.lectureId===l.id&&n.body).forEach(n=>{s+=`Student note "${n.title}": ${n.body.slice(0,1500)}\n`});
    if(out.length+s.length>max){out+='\n(Additional lectures omitted for length.)';break}
    out+=s;
  }
  return out;
}

/* ---------- modal ---------- */
function openModal(html,opt={}){
  $('#modal-root').innerHTML=`<div class="scrim" data-act="scrim"><div class="modal ${opt.wide?'wide':''}" role="dialog" aria-modal="true">${html}</div></div>`;
  const f=$('#modal-root .modal [autofocus]')||$('#modal-root .modal button');f&&f.focus();
}
function closeModal(){const ab=MODAL_ABORT;MODAL_ABORT=null;ab&&ab.abort();$('#modal-root').innerHTML='';if(typeof pendingCreditConsent!=='undefined'&&pendingCreditConsent){const pending=pendingCreditConsent;pendingCreditConsent=null;pending.resolve(false)}if(typeof pendingCreditActionConfirmation!=='undefined'&&pendingCreditActionConfirmation){const pending=pendingCreditActionConfirmation;pendingCreditActionConfirmation=null;pending.resolve(false)}}
let MODAL_ABORT=null;
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#modal-root').innerHTML)closeModal()});

/* ---------- downloads / export ---------- */
async function download(filename,data){
  const d=await use('downloads');
  if(!d){openModal(`<div class="spread"><h2>Copy instead</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div><p class="muted small">File saving isn’t available in this view. Copy the text below.</p><textarea class="in" id="copybox" rows="14" readonly>${esc(typeof data==='string'?data:'')}</textarea><div class="row"><button class="btn primary" data-act="copybox">Copy text</button></div>`);return}
  try{await d.save({filename,data});toast('Saved '+filename)}catch(e){if(e&&e.code&&!/declin|cancel|dismiss/i.test(e.code))toast('Not saved: '+(e.message||e.code))}
}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast('Copied')}catch(e){const b=$('#copybox')||$('#emailbody');if(b){b.focus();b.select();toast('Press Ctrl/⌘+C to copy')}}}
function lectureText(l,what){
  const c=course(l.courseId)||{};const a=l.analysis||{};
  const head=`${c.code?c.code+' — ':''}${l.title}\n${fmtLong(l.date)}${c.professor?' · '+c.professor:''}\n\n`;
  const summary=()=>{
    let s='';
    if(a.summary)s+='SUMMARY\n'+a.summary+'\n\n';
    if(a.keyPoints&&a.keyPoints.length)s+='KEY POINTS\n'+a.keyPoints.map(k=>'• '+k).join('\n')+'\n\n';
    if(a.emphasized&&a.emphasized.length)s+='PROFESSOR EMPHASIZED\n'+a.emphasized.map(e=>`• ${e.concept} [${fmtT(e.t)}] — ${e.why}`).join('\n')+'\n\n';
    if(a.terms&&a.terms.length)s+='TERMS\n'+a.terms.map(t=>`• ${t.term}: ${t.def}`).join('\n')+'\n\n';
    if(a.assignments&&a.assignments.length)s+='ASSIGNMENTS MENTIONED\n'+a.assignments.map(x=>`• ${x.title}${x.due?' — due '+fmtD(x.due):''}`).join('\n')+'\n\n';
    if(a.announcements&&a.announcements.length)s+='ANNOUNCEMENTS\n'+a.announcements.map(x=>'• '+x).join('\n')+'\n\n';
    return s||'(No AI summary yet. Open the lecture and run Analyze.)\n\n';
  };
  const notes=()=>(a.notes?a.notes.replace(/\*\*/g,'')+'\n\n':'')+(l.myNotes?'MY NOTES\n'+l.myNotes+'\n\n':'');
  const tx=()=>'TRANSCRIPT\n'+(l.segs||[]).map(g=>`[${fmtT(g.t)}] ${spkName(l,g.s)}: ${g.x}`).join('\n')+'\n';
  if(what==='summary')return head+summary();
  if(what==='notes')return head+(notes()||'(No notes yet.)');
  if(what==='transcript')return head+tx();
  return head+summary()+notes()+tx();
}
function asDoc(title,text){
  const body=md(text.replace(/^([A-Z][A-Z &’']{3,})$/gm,'## $1').replace(/^• /gm,'- '));
  const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45}h2,h3{color:${esc(accent)}}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
}
function ics(items){
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
  const ev=items.filter(a=>a.due).map(a=>{const c=course(a.courseId)||{};const d=a.due.replace(/-/g,'');const n=dObj(a.due);n.setDate(n.getDate()+1);const e=n.toISOString().slice(0,10).replace(/-/g,'');
    return `BEGIN:VEVENT\r\nUID:${a.id}@classscribe\r\nDTSTAMP:${stamp}\r\nDTSTART;VALUE=DATE:${d}\r\nDTEND;VALUE=DATE:${e}\r\nSUMMARY:${(c.code?c.code+': ':'')+a.title.replace(/[,;]/g,' ')}\r\nDESCRIPTION:${a.type} · added by ClassScribe\r\nBEGIN:VALARM\r\nTRIGGER:-P1D\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT`}).join('\r\n');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ClassScribe//EN\r\n${ev}\r\nEND:VCALENDAR\r\n`;
}
