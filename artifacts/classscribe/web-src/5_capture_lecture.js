/* ---------- example shared lecture (for I Missed Class) ---------- */
EX_SHARED['exs-bio-4']={id:'exs-bio-4',ex:true,sharedCopy:true,by:'example',allowCopy:false,courseId:'ex-bio',code:'BIO 101',courseName:'Introduction to Biology',professor:'Prof. Williams',
  title:'Meiosis and Genetic Variation',date:isoOffset(-2),module:'Unit 2 · Genetics',duration:2900,speakers:{P:'Prof. Williams',S:'Student'},marks:[],slides:[],
  segs:DEMO_LECTURE.map(s=>({...s,t:s.t*12})),
  analysis:{summary:'Prof. Williams introduced meiosis and contrasted it with mitosis: four genetically different haploid cells instead of two identical diploid cells, with crossing over in prophase I as the main source of variation.',
    keyPoints:['Meiosis produces four haploid cells, each with half the chromosome number.','Crossing over in prophase I swaps segments between homologous chromosomes.','Meiosis I separates homologous pairs; meiosis II separates sister chromatids.','Mitosis → 2 identical diploid cells; meiosis → 4 different haploid cells.'],
    emphasized:[{concept:'Crossing over in prophase I',why:'“It will be on the midterm”',t:744},{concept:'Mitosis vs. meiosis outcomes',why:'“I will repeat that because it matters”',t:2112}],
    terms:[{term:'Haploid',def:'Having one set of chromosomes (n).',t:372},{term:'Crossing over',def:'Exchange of segments between homologous chromosomes in prophase I.',t:744},{term:'Homologous chromosomes',def:'A matched pair of chromosomes, one from each parent.',t:744}],
    examples:[],assignments:[{title:'Read chapter 13',type:'reading',due:isoOffset(1)},{title:'Problem set 3',type:'homework',due:isoOffset(1)}],
    announcements:['Problem set 3 is due Friday at midnight.'],studentQuestions:[{q:'Does crossing over happen in mitosis too?',t:1140}],
    concepts:['Meiosis','Cell division','Crossing over'],notes:'## Meiosis\n- 4 haploid cells\n- Crossing over in prophase I\n- Meiosis I: homologs split; meiosis II: sister chromatids split'}};

/* ---------- CAPTURE ---------- */
let SES=null,TICK=null,DEMO=null;
let capturePrivacyLoading=false,capturePrivacyError='';
function captureConsentDraftKey(code){return'cs_recording_consent_draft_v1_'+encodeURIComponent(code||'local')}
function currentCaptureConsentRecord(form,courseId,recordingId){
  const code=privacyLibraryCode();
  let sessionId=form.dataset.privacySessionId||'',consentId=form.dataset.privacyConsentId||'',lectureId=recordingId;
  if(!sessionId||!lectureId){
    try{
      const previous=JSON.parse(localStorage.getItem(captureConsentDraftKey(code))||'null');
      if(previous&&previous.sessionId===recordingId&&previous.courseId===courseId&&previous.lectureId===recordingId&&previous.version===PRIVACY_CONFIG.consent.version&&JSON.stringify(previous.statements)===JSON.stringify(PRIVACY_CONFIG.consent.statements)){
        sessionId=previous.sessionId;consentId=previous.consentId||'';lectureId=previous.lectureId;
      }
    }catch(e){}
  }
  sessionId=recordingId;
  consentId=consentId||'consent-'+uid();
  form.dataset.privacySessionId=sessionId;form.dataset.privacyConsentId=consentId;form.dataset.privacyLectureId=lectureId;
  return {consentId,sessionId,lectureId,courseId,version:PRIVACY_CONFIG.consent.version,statements:[...PRIVACY_CONFIG.consent.statements],platform:'web',appVersion:window.CS_APP_VERSION||'web-0.0.0',accommodation:!!$('#consent-accommodation')?.checked};
}
const nowT=()=>SES?(SES.acc+(SES.running?Date.now()-SES.resumeAt:0))/1000:0;
function reserveRetryKey(code){return`cs_recording_reserve_retry_v1_${encodeURIComponent(code)}`}
function reserveRetryId(code){try{return localStorage.getItem(reserveRetryKey(code))||''}catch(e){return''}}
function saveReserveRetryId(code,id){try{localStorage.setItem(reserveRetryKey(code),id)}catch(e){}}
function clearReserveRetryId(code){try{localStorage.removeItem(reserveRetryKey(code))}catch(e){}}
function reusableReserveRetryId(code,courseId){
  const id=reserveRetryId(code);if(!id)return'';
  try{
    const draft=JSON.parse(localStorage.getItem(captureConsentDraftKey(privacyLibraryCode()))||'null');
    if(draft&&draft.sessionId===id&&draft.lectureId===id&&draft.courseId===courseId&&draft.consentId&&draft.version===PRIVACY_CONFIG.consent.version&&JSON.stringify(draft.statements)===JSON.stringify(PRIVACY_CONFIG.consent.statements))return id;
    localStorage.removeItem(reserveRetryKey(code));
    localStorage.removeItem(captureConsentDraftKey(privacyLibraryCode()));
  }catch(e){clearReserveRetryId(code)}
  return'';
}
function pendingRecordingActionsKey(code){return`cs_pending_recording_actions_v1_${encodeURIComponent(code)}`}
function readPendingRecordingActions(code){try{return JSON.parse(localStorage.getItem(pendingRecordingActionsKey(code))||'[]')}catch(e){return[]}}
function writePendingRecordingActions(code,actions){try{localStorage.setItem(pendingRecordingActionsKey(code),JSON.stringify(actions));return true}catch(e){return false}}
function queueRecordingAction(action,recordingId,code){
  const actions=readPendingRecordingActions(code).filter(x=>x.recordingId!==recordingId);
  actions.push({action,recordingId:String(recordingId)});
  return writePendingRecordingActions(code,actions);
}
function clearQueuedRecordingAction(recordingId,code){
  return writePendingRecordingActions(code,readPendingRecordingActions(code).filter(x=>x.recordingId!==recordingId));
}
async function applyRecordingActionToLecture(recordingId,action){
  const l=Object.values(S.lectures).find(item=>item.recordingReservationId===recordingId);
  if(!l)return;
  l.recordingReservationState=action==='finish'?'finished':'released';delete l.recordingReservationError;
  await put('lectures',l);
}
async function retryPendingRecordingActions(code=billingUserCode()){
  if(!code)return;
  const actions=readPendingRecordingActions(code);let changed=false;
  for(const pendingAction of actions){
    try{
      await billingRecordingAction(pendingAction.action,pendingAction.recordingId,code);
      await applyRecordingActionToLecture(pendingAction.recordingId,pendingAction.action);
      clearQueuedRecordingAction(pendingAction.recordingId,code);changed=true;
    }catch(e){}
  }
  if(changed)void loadBillingStatus(true,code);
}
async function releaseRecordingReservation(session,quiet=false){
  if(!session||!session.recordingId||!['reserved','release-pending'].includes(session.reservationState))return true;
  const code=session.billingCode||billingUserCode();session.reservationState='releasing';
  try{
    await billingRecordingAction('release',session.recordingId,code);
    clearQueuedRecordingAction(session.recordingId,code);
    session.reservationState='released';session.reservationError='';
    void loadBillingStatus(true,code);return true;
  }catch(error){
    session.reservationState='release-pending';session.reservationError=error.message||'Could not release the recording reservation.';
    queueRecordingAction('release',session.recordingId,code);
    if(!quiet)toast('The reservation could not be released. Retry it before leaving this recording.');
    if(S.view.name==='capture')render();return false;
  }
}
async function finishRecordingReservation(lecture,session){
  lecture.recordingReservationId=session.recordingId;
  lecture.recordingReservationState='finish-pending';
  try{
    await billingRecordingAction('finish',session.recordingId,session.billingCode||billingUserCode());
    clearQueuedRecordingAction(session.recordingId,session.billingCode||billingUserCode());
    lecture.recordingReservationState='finished';
    await put('lectures',lecture);
    void loadBillingStatus(true,session.billingCode||billingUserCode());
  }catch(error){
    lecture.recordingReservationError=error.message||'Could not confirm the saved recording.';
    queueRecordingAction('finish',session.recordingId,session.billingCode||billingUserCode());
    await put('lectures',lecture);
    void loadBillingStatus(true,session.billingCode||billingUserCode());
    toast('The recording is saved, but its monthly count could not be confirmed. Retry confirmation from this lecture.');
  }
}
VIEWS.capture=v=>SES&&SES.step==='live'?captureLive():captureSetup(v);
function captureSetup(v){
  if(!currentBillingStatus()&&S.billing.state==='idle')void loadBillingStatus(true,billingUserCode());
  const cs=coursesSorted().filter(c=>!c.ex);const nowC=currentClass();const requested=v.courseId&&course(v.courseId);const pre=requested&&!requested.ex?requested.id:(nowC&&!nowC.c.ex&&nowC.c.id)||(cs[0]&&cs[0].id)||'__new';
  const courseLimitHit=courseLimitReached();
  const recordingCountHit=recordingCountLimitReached();
  return `<div class="page-h"><div><p class="eyebrow">Capture</p><h1>Record a lecture</h1><p class="sub">Confirm permission, then capture. ClassScribe timestamps everything so you can jump back to any moment.</p></div></div>
  <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));align-items:start">
  <form class="panel stack" data-form="startRec">
    <label class="f">Course<select class="in" id="cap-course">${cs.map(c=>`<option value="${esc(c.id)}" ${c.id===pre?'selected':''}>${esc(c.code)} · ${esc(c.name)}${c.ex?' (example)':''}</option>`).join('')}<option value="__new" ${pre==='__new'?'selected':''} ${courseLimitHit?'disabled':''}>${courseLimitHit?'Course limit reached':'+'} ${courseLimitHit?'':'New course…'}</option></select></label>
    <div class="grid2" id="cap-newc" ${pre==='__new'?'':'hidden'}><label class="f">Code<input class="in" id="cap-code" placeholder="HIST 150"></label><label class="f">Course name<input class="in" id="cap-cname" placeholder="World History"></label></div>
    <p id="capture-course-error" class="small" role="alert" aria-live="polite" style="color:var(--warn)">${courseLimitHit?esc(courseLimitNotice()):''}</p>
    ${courseLimitHit?`<button type="button" class="btn sm" ${goAttr({name:'plans'})}>Review plans</button>`:''}
    <label class="f">Lecture title<input class="in" id="cap-title" placeholder="e.g. Meiosis and genetic variation" required></label>
    <div class="grid2"><label class="f">Module or unit<input class="in" id="cap-module" placeholder="Unit 2 · Genetics"></label><label class="f">Date<input class="in" id="cap-date" type="date" value="${todayISO()}"></label></div>
    <hr class="hr">
     <label class="f">Audio source<select class="in" id="cap-audio-source"><option value="microphone">In-person lecture · microphone</option><option value="online">Online lecture · browser-tab audio</option></select></label>
     <div id="cap-online-details" class="stack" hidden>
       <p class="small">Use desktop Chrome or Edge. Open the lecture in another browser tab. Choose that tab and enable <b>Share tab audio</b> in the sharing dialog. Headphones are fine; your microphone is not recorded. Desktop meeting apps are not supported by this option.</p>
       <p class="small muted">Tab sharing is requested to access audio. Video is never recorded or uploaded. Captions and study tools are generated after you stop and save, subject to your plan.</p>
       <label class="check"><input type="checkbox" id="cap-online-consent"><span>I have permission to record this online lecture and any participants whose voices will be captured.</span></label>
     </div>
     <p id="cap-audio-help" class="small muted" role="status" aria-live="polite">Microphone recording is selected. It does not directly capture audio playing through headphones.</p>
     <p class="eyebrow">Recording consent</p>
     ${PRIVACY_CONFIG?`<label class="check"><input type="checkbox" id="consent1"><span>${esc(PRIVACY_CONFIG.consent.statements[0])}</span></label><label class="check"><input type="checkbox" id="consent2"><span>${esc(PRIVACY_CONFIG.consent.statements[1])}</span></label><label class="check"><input type="checkbox" id="consent-accommodation"><span>I have an accessibility accommodation relevant to this recording (optional).</span></label><p class="small muted">Consent version ${esc(PRIVACY_CONFIG.consent.version)} · Permission and privacy statements are saved with this recording’s consent record.</p>`:capturePrivacyLoading?'<p class="small muted" role="status">Loading the current permission and privacy statements…</p>':`<p class="small" role="alert" style="color:var(--warn)">${esc(capturePrivacyError||'Current recording consent statements are unavailable. Recording is disabled until they load.')}</p><button type="button" class="btn sm" data-act="capturePrivacyRetry">Retry loading consent statements</button>`}
       ${recordingCountHit?recordingCountGateMarkup():''}<button class="btn rec" id="cap-start" style="justify-content:center;padding:12px"${PRIVACY_CONFIG?' disabled':''}>${ic('mic')}Start recording</button>
  </form>
  <aside class="stack">
    <div class="panel stack" style="gap:8px"><h3>While you record</h3>
      <p class="small">${ic('star').replace('<svg','<svg width="15" height="15" style="vertical-align:-2px;color:var(--hi)"')} <b>Bookmark</b> anything important with one tap. No typing needed.</p>
      <p class="small">${ic('camera').replace('<svg','<svg width="15" height="15" style="vertical-align:-2px"')} <b>Snap the slide or board</b> and ClassScribe pins it to that moment and reads its text.</p>
      <p class="small">${ic('spark').replace('<svg','<svg width="15" height="15" style="vertical-align:-2px"')} When you stop, you get key points, smart notes, terms, detected assignments and a study set.</p></div>
    <div class="banner" style="font-size:.85rem"><span><b>Audio:</b> ClassScribe records from your microphone and shows live captions when your browser supports them (Chrome, Edge and Safari). If the microphone is blocked here, you can still dictate with your keyboard, type, paste or import a transcript. Try <b>Demo</b> to see it in action.</span></div>
  </aside></div>`;
}
function captureLive(){
  const c=course(SES.courseId)||{};const src=SES.src;
  return `<div class="recbar ${SES.running?'recording':'paused'}" id="recbar"><span class="recdot" aria-hidden="true"></span><b style="color:${SES.running?'var(--rec)':'var(--muted)'}">${SES.running?'REC':'PAUSED'}</b><span class="timer" id="tm">${fmtT(nowT())}</span><span class="consent-pill">Consent confirmed · recording is visible</span>
    <span style="flex:1"></span>
    <button class="btn" data-act="recPause">${ic(SES.running?'pause':'play')}${SES.running?'Pause':'Resume'}</button>
    <button class="btn" data-act="recMark" style="color:var(--hi-ink);background:var(--hi-soft);border-color:transparent">${ic('star')}Bookmark</button>
    <label class="btn">${ic('camera')}Slide / board<input type="file" id="slidefile" accept="image/*" capture="environment" hidden></label>
    <button class="btn primary" data-act="recStop">${ic('stop')}Stop & save</button>
    <button class="btn ghost sm" data-act="recDiscard">Discard</button></div>
  <p class="small" id="micnote" style="margin:12px 2px 0">${micNoteHTML()}</p>
  ${SES.reservationState==='release-pending'?`<section class="panel exam-access" role="alert"><b>Recording reservation still pending.</b><p class="small muted">${esc(SES.reservationError||'Release it before leaving this recording.')}</p><button class="btn sm" data-act="recordingReservationRetry">Retry release</button></section>`:''}
  <div class="row" style="margin:12px 0 12px;gap:8px">${codeChip(c)}<h2 style="font-size:1.15rem">${esc(SES.title)}</h2><span class="muted small" id="capcount">${plural(SES.segs.length,'line')} · ${plural(SES.marks.length,'bookmark')} · ${plural(SES.slides.length,'slide')}</span></div>
  <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));align-items:start">
   <section class="panel">
    <div class="tabs" role="tablist" style="margin-bottom:12px">${[['type','Dictate / type'],['notes','My notes'],['paste','Paste'],['import','Import file'],['demo','Demo']].map(([k,l])=>`<button role="tab" aria-selected="${src===k}" data-act="recSrc" data-src="${k}">${l}</button>`).join('')}</div>
    ${src==='type'?`<div class="stack" style="gap:10px"><div class="row"><label class="f" style="flex-direction:row;align-items:center;gap:8px">Speaker<select class="in" id="spk" style="width:auto">${[['P','Professor'],['S','Student'],['G','Guest']].map(([k,l])=>`<option value="${k}" ${SES.spk===k?'selected':''}>${l}</option>`).join('')}</select></label></div>
      <textarea class="in" id="typebox" rows="4" placeholder="Dictate or type what’s being said. Press Enter to add the line.">${esc(SES.draft||'')}</textarea>
      <div class="row"><button class="btn primary sm" data-act="recAdd">Add line</button><span class="small muted">${MIC.captions?'Live captions go straight into the transcript; use this box only to add your own lines.':'On a phone, tap the keyboard’s 🎤 to dictate. Each line gets the timestamp of when you started it.'}</span></div></div>`:''}
    ${src==='notes'?`<div class="stack" style="gap:10px"><textarea class="in" id="capnotes" rows="9" placeholder="Your own notes for this lecture. They’re saved to Notes, linked to this recording.">${esc(SES.notes||'')}</textarea><div class="row"><button class="btn sm" data-act="capStamp">⏱ Insert timestamp</button><span class="small muted">Saved with the lecture when you stop.</span></div></div>`:''}
    ${src==='paste'?`<div class="stack" style="gap:10px"><textarea class="in" id="pastebox" rows="7" placeholder="[00:12:30] Prof. Lee: Today we cover…&#10;Student: Is that on the exam?">${esc(SES.paste||'')}</textarea><div class="row"><button class="btn primary sm" data-act="recPaste">Add to transcript</button><span class="small muted">Timestamps and “Name:” prefixes are detected.</span></div></div>`:''}
    ${src==='import'?`<div class="stack" style="gap:10px"><p class="small muted">Import a transcript exported from Zoom, Teams, Otter, your phone’s recorder or captioning service.</p><label class="btn" style="align-self:flex-start">${ic('upload')}Choose .txt, .vtt or .srt<input type="file" id="importfile" accept=".txt,.vtt,.srt,text/plain,text/vtt" hidden></label></div>`:''}
    ${src==='demo'?`<div class="stack" style="gap:10px"><p class="small">Play a short sample lecture on <b>meiosis</b> to watch live transcription, speaker labels and timestamps. Try bookmarking the line about the midterm.</p><button class="btn primary" data-act="recDemo" style="align-self:flex-start">${ic(DEMO?'pause':'play')}${DEMO?'Stop demo':'Play demo lecture'}</button></div>`:''}
   </section>
   <section class="panel"><div class="spread" style="margin-bottom:6px"><h3>Live transcript</h3><span class="small muted">Tap ⭐ on a line to bookmark it</span></div><div class="tx" id="livetx" style="max-height:60vh;overflow:auto">${txHTML({...SES,speakers:{P:(course(SES.courseId)||{}).professor||'Professor',S:'Student',G:'Guest'}},'live')}</div><p class="small muted" id="interim" style="margin:6px 8px 0;min-height:1.2em;font-style:italic"></p></section>
  </div>`;
}
function txHTML(l,mode){
   const items=[...(l.segs||[]).map((g,i)=>({k:'s',t:g.t,g,i})),...(l.marks||[]).map(t=>({k:'m',t:t+0.01})),...(l.slides||[]).map((s,i)=>({k:'sl',t:s.t+0.02,s,i}))].sort((a,b)=>a.t-b.t);
   if(!items.length&&mode==='live'&&SES?.audioSource==='online')return '<p class="muted small" style="padding:10px">The tab-audio transcript is generated after Stop &amp; save, subject to your plan. You can add your own notes or import permitted captions while recording.</p>';
  if(!items.length)return `<p class="muted small" style="padding:10px">${mode==='live'?'Listening… captions appear here as the professor speaks. You can also type, paste, import a file, or play the demo.':'No transcript.'}</p>`;
  const col={P:'var(--accent)',S:'var(--c2)',G:'var(--c3)'};const mine=mode==='live'||isMine(l)&&!isExampleRecord('lectures',l);
  const day=l.date?stampDate(l.date):'';
  const datedTime=t=>day?`${esc(day)} · ${fmtT(t)}`:fmtT(t);
  return items.map(it=>{
    if(it.k==='m')return `<div class="mark">${ic('star').replace('<svg','<svg width="14" height="14"')} Bookmarked · <span class="mono">${datedTime(it.t)}</span></div>`;
    if(it.k==='sl')return `<div class="slide">${it.s.thumb?`<img src="${esc(it.s.thumb)}" alt="Captured slide at ${datedTime(it.s.t)}">`:''}<div><p class="small muted"><span class="mono">${datedTime(it.s.t)}</span> · Slide / board</p><p>${esc(it.s.text||'')}</p></div></div>`;
    const g=it.g;const timed=typeof g.t==='number'&&Number.isFinite(g.t)&&g.t>=0;
    const marked=timed&&(l.marks||[]).some(t=>Math.abs(t-g.t)<2);
    const dayHTML=day?`<span class="ts-day">${esc(day)}</span>`:'';
    return `<div class="seg" ${timed?`data-t="${g.t}"`:''}>${timed?`<button class="ts mono" ${mode==='live'?'':goAttr({name:'lecture',id:l.id,tab:'transcript',t:g.t})} aria-label="Lecture timestamp ${datedTime(g.t)}">${dayHTML}<span>${fmtT(g.t)}</span></button>`:`<span class="ts mono muted" aria-label="${day?`Lecture date ${esc(day)}; `:''}audio timestamp unavailable">${dayHTML}<span>—:—</span></span>`}<div><span class="who" style="--sc:${col[g.s]||'var(--muted)'}">${esc(spkName(l,g.s))}</span>${esc(g.x)}</div>
    <div class="x row" style="gap:2px">${mine&&timed?`<button class="btn ghost sm" data-act="${mode==='live'?'recMarkSeg':'markSeg'}" data-i="${it.i}" data-id="${esc(l.id||'')}" aria-label="Bookmark" title="Bookmark" style="${marked?'color:var(--hi)':''}">${ic('star')}</button>`:''}${mode==='live'?'':`<button class="btn ghost sm" data-act="explainSeg" data-i="${it.i}" data-id="${esc(l.id)}" title="Explain this">${ic('bulb')}Explain</button>`}</div></div>`;
  }).join('');
}
function refreshLive(){const el=$('#livetx');if(!el)return;el.innerHTML=txHTML({...SES,speakers:{P:(course(SES.courseId)||{}).professor||'Professor',S:'Student',G:'Guest'}},'live');el.scrollTop=el.scrollHeight}
function addSeg(x,s,t,source){x=String(x||'').trim();if(!x)return;SES.segs.push({t:Math.round(t*10)/10,s:s||'P',x,...(source?{source}:{})});SES.segs.sort((a,b)=>a.t-b.t);refreshLive();const m=$('#capcount');if(m)m.textContent=`${plural(SES.segs.length,'line')} · ${plural(SES.marks.length,'bookmark')} · ${plural(SES.slides.length,'slide')}`}
function startTick(){clearInterval(TICK);TICK=setInterval(()=>{const e=$('#tm');if(e)e.textContent=fmtT(nowT())},250)}
ACT.recPause=()=>{if(MIC.state==='ended'){toast('Tab sharing ended. Stop and save this lecture, then start a new recording to choose a tab again.');return}if(SES.running){SES.acc+=Date.now()-SES.resumeAt;SES.running=false;micPause()}else{SES.resumeAt=Date.now();SES.running=true;micResume()}render()};
ACT.recMark=()=>{SES.marks.push(Math.round(nowT()));refreshLive();toast('Bookmarked at '+fmtT(nowT()))};
ACT.recMarkSeg=el=>{const g=SES.segs[+el.dataset.i];if(!g)return;const k=SES.marks.findIndex(t=>Math.abs(t-g.t)<2);k>=0?SES.marks.splice(k,1):SES.marks.push(g.t);refreshLive()};
ACT.recSrc=el=>{SES.src=el.dataset.src;render()};
ACT.recAdd=()=>{const b=$('#typebox');addSeg(b.value,$('#spk').value,SES.lineStart??nowT());b.value='';SES.draft='';SES.lineStart=null;b.focus()};
ACT.recPaste=()=>{const lines=parseTranscript($('#pastebox').value,nowT());lines.forEach(l=>addSeg(l.x,l.s,l.t));$('#pastebox').value='';SES.paste='';toast(`Added ${plural(lines.length,'line')}`)};
ACT.recDemo=()=>{
  if(DEMO){clearInterval(DEMO);DEMO=null;render();return}
  if(!SES.running)ACT.recPause();
  let i=0;const base=SES.segs.length?Math.ceil(nowT()):0;
  const step=()=>{if(!SES||SES.step!=='live'){clearInterval(DEMO);DEMO=null;return}if(!SES.running)return;const d=DEMO_LECTURE[i++];if(!d){clearInterval(DEMO);DEMO=null;if(S.view.name==='capture')render();return}
    SES.acc=(base+d.t)*1000;SES.resumeAt=Date.now();addSeg(d.x,d.s,base+d.t)};
  step();DEMO=setInterval(step,3200);render();
};
ACT.recStop=async el=>{
  if(!SES||SES.saving)return;SES.saving=true;
  const session=SES;
  if(el){el.disabled=true;el.innerHTML=thinking+' Saving'}
  clearInterval(DEMO);DEMO=null;clearInterval(TICK);
  const secs=nowT();
  let blob=null;try{blob=await micStop()}catch(e){blob=null}
  if(SES!==session)return;
  const c=course(session.courseId)||{};const last=session.segs[session.segs.length-1];
  const dur=Math.max(Math.round(secs),last?Math.round(last.t+20):0,1);
  const l={id:session.recordingId||uid(),courseId:session.courseId,title:session.title,date:session.date,module:session.module,duration:dur,speakers:{P:c.professor||'Professor',S:'Student',G:'Guest'},segs:session.segs,marks:session.marks,slides:session.slides,analysis:null,reviewed:false,created:Date.now(),ex:false,hasAudio:false,consentId:session.consentId,sessionId:session.sessionId};
  const nb=(session.notes||'').trim();
  let audioFailed=false;
  let audioSaved=false;
  if(blob){
    try{await audioSave(l.id,blob);AUDIO_URLS[l.id]=URL.createObjectURL(blob);l.hasAudio=true;audioSaved=true}
    catch(e){audioFailed=true}
  }
  SES=null;
  if(audioSaved){l.recordingReservationId=session.recordingId;l.recordingReservationState='finish-pending'}
  else{
    await releaseRecordingReservation(session,true);
    if(session.reservationState==='release-pending'){l.recordingReservationId=session.recordingId;l.recordingReservationState='release-pending';l.recordingReservationError=session.reservationError}
  }
  await put('lectures',l);
  if(audioSaved)await finishRecordingReservation(l,session);
  else void loadBillingStatus(true,billingUserCode());
  if(nb)await put('notes',{id:uid(),courseId:l.courseId,lectureId:l.id,title:l.title+' — my notes',body:stampsToLinks(nb,l.id),pinned:false,created:Date.now(),updated:Date.now(),ex:false});
  go({name:'lecture',id:l.id,tab:'transcript'});
  const empty=!l.segs.length&&!l.slides.length&&!nb&&!l.hasAudio;
  toast(audioFailed?'Lecture saved, but audio could not be saved in this browser. The recording will not be available after you leave this page.':empty?'Saved. Nothing was captured, so this lecture is empty.':'Lecture saved');
  processLecture(l.id,blob,session.consentId);
};
async function processLecture(id,blob,consentId){
  let l=lecture(id);if(!l)return;
  if(blob&&window.CS_TRANSCRIBE){
    if(transcriptionCountLimitReached()){toast(transcriptionCountNotice());}
    else{
    S.busy[id]='Transcribing the recording…';render();
    try{const recordingId=l.consentRecordingId||l.id;const segments=await window.CS_TRANSCRIBE(blob,{timed:true,consentId:consentId||l.consentId,recordingId,sessionId:l.sessionId,lectureId:id,courseId:l.courseId});if(segments&&segments.length){l=lecture(id)||l;await put('lectures',{...l,segs:[...(l.segs||[]).filter(g=>g.source!=='caption'&&g.source!=='transcription'),...segments.map(g=>({t:g.t,s:'P',x:g.x,source:'transcription'}))].sort((a,b)=>a.t-b.t)});void loadBillingStatus(true,billingUserCode())}else if(!l.segs.length)toast('No speech was found in that recording.')}
    catch(e){if(e&&e.code==='plan_limit'){void loadBillingStatus(true,billingUserCode());toast('This library has reached its monthly transcription limit. Review Plans & privacy or try again next month.')}else toast('Recording saved, but transcription didn’t finish: '+((e&&e.message)||'try again'))}
    delete S.busy[id];render();
    }
  }
  l=lecture(id);if(l&&(l.segs.length||l.slides.length||lectureNotesText(l).trim())){const s=await AI();if(s)analyze(id)}
}
ACT.recDiscard=async el=>{if(!SES||SES.saving)return;if(el.dataset.armed){const session=SES;clearInterval(DEMO);DEMO=null;clearInterval(TICK);session.running=false;micStop().catch(()=>{});if(!await releaseRecordingReservation(session,true)){toast('Recording cancelled, but the reservation is still pending. Retry release before leaving.');return}SES=null;go({name:'home'});toast('Recording discarded');return}el.dataset.armed='1';el.textContent='Tap again to discard';el.style.color='var(--rec)';setTimeout(()=>{if(el.isConnected){delete el.dataset.armed;el.textContent='Discard';el.style.color=''}},3000)};
ACT.recordingReservationRetry=async el=>{
  if(SES&&SES.reservationState==='release-pending'){
    if(await releaseRecordingReservation(SES,true)){toast('Recording reservation released.');render()}
    else toast('Could not release the reservation: '+SES.reservationError);
    return;
  }
  const l=lecture(el&&el.dataset.id);if(!l||isExampleRecord('lectures',l)||!l.recordingReservationId)return;
  const action=l.recordingReservationState==='finish-pending'?'finish':l.recordingReservationState==='release-pending'?'release':null;
  if(!action)return;
  const code=billingUserCode();
  try{
    await billingRecordingAction(action,l.recordingReservationId,code);
    clearQueuedRecordingAction(l.recordingReservationId,code);
    l.recordingReservationState=action==='finish'?'finished':'released';delete l.recordingReservationError;
    await put('lectures',l);void loadBillingStatus(true,code);render();toast(action==='finish'?'Recording count confirmed.':'Reservation released.');
  }catch(error){
    l.recordingReservationError=error.message||'Could not update the recording reservation.';
    queueRecordingAction(action,l.recordingReservationId,code);await put('lectures',l);render();toast('Could not update the recording reservation: '+l.recordingReservationError);
  }
};
function hms(s){const p=String(s).trim().replace(',','.').split(':').map(Number);return p.reduce((a,b)=>a*60+b,0)}
function spkCode(n){n=n.toLowerCase();if(/prof|dr\.?|instructor|teacher|lecturer/.test(n))return'P';if(/student|q\b|question/.test(n))return'S';return'G'}
function parseTranscript(text,baseT){
  const out=[];let t=baseT;
  if(/-->/.test(text)){
    text.replace(/\r/g,'').split(/\n\s*\n/).forEach(b=>{const ls=b.split('\n').filter(Boolean);const i=ls.findIndex(x=>x.includes('-->'));if(i<0)return;const st=hms(ls[i].split('-->')[0]);let body=ls.slice(i+1).join(' ');let s='P';const v=body.match(/<v\s+([^>]+)>/);if(v){s=spkCode(v[1])}body=body.replace(/<[^>]+>/g,'').trim();const m=body.match(/^([A-Z][\w .'’-]{0,30}):\s+(.*)/);if(m){s=spkCode(m[1]);body=m[2]}if(body)out.push({t:st,s,x:body})});
    return out;
  }
  text.split('\n').forEach(raw=>{let x=raw.trim();if(!x)return;let s='P';const m=x.match(/^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*[-–]?\s*/);if(m){t=hms(m[1]);x=x.slice(m[0].length)}else{t+=out.length?8:0}
    const n=x.match(/^([A-Z][\w .'’-]{0,30}):\s+(.*)/);if(n){s=spkCode(n[1]);x=n[2]}out.push({t,s,x})});
  return out;
}
async function makeThumb(file){
  const url=URL.createObjectURL(file);
  try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url});const w=360,h=Math.round(img.height*w/img.width);const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(img,0,0,w,h);return cv.toDataURL('image/jpeg',.7)}catch(e){return''}finally{URL.revokeObjectURL(url)}
}
async function onSlide(file){
  if(!file||!SES)return;const t=Math.round(nowT());const sl={t,thumb:await makeThumb(file),text:'Reading the slide…'};SES.slides.push(sl);refreshLive();
  try{const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read slide.'));reader.readAsDataURL(file)});
    const r=await CS_STUDY('slide',{material:'Lecture slide',image:{mediaType:file.type,data:String(encoded).split(',')[1]}});sl.text=r.text.trim()}
  catch(e){sl.text='Photo pinned at '+fmtT(t)+'.'}
  if(SES)refreshLive();
}
async function onImport(file){
  const text=await file.text();const lines=parseTranscript(text,nowT());if(!lines.length){toast('No transcript lines found in that file.');return}
  lines.forEach(l=>SES.segs.push({t:l.t,s:l.s,x:l.x}));SES.segs.sort((a,b)=>a.t-b.t);
  const last=SES.segs[SES.segs.length-1].t;if(last>nowT()){SES.acc=last*1000;SES.resumeAt=Date.now()}
  refreshLive();toast(`Imported ${plural(lines.length,'line')}`);
}

/* ---------- LECTURE ---------- */
VIEWS.lecture=v=>{
  const l=lecture(v.id);if(!l)return `<div class="empty">This lecture isn’t available. <button class="btn sm" ${goAttr({name:'home'})}>Go home</button></div>`;
  const c=course(l.courseId)||{code:l.code,name:l.courseName};const a=l.analysis;const example=isExampleRecord('lectures',l);const mine=isMine(l)&&!example;
  const txLimited=transcriptionCountLimitReached();
  const tab=v.tab||(a?'notes':'transcript');const busy=S.busy[l.id];
  const reservationNotice=!example&&(l.recordingReservationState==='finish-pending'||l.recordingReservationState==='release-pending')?`<section class="panel exam-access" role="status"><b>${l.recordingReservationState==='finish-pending'?'Recording saved; count confirmation is pending.':'Recording reservation release is pending.'}</b><p class="small muted">${esc(l.recordingReservationError||'Retry the server confirmation for this recording.')}</p><button class="btn sm" data-act="recordingReservationRetry" data-id="${esc(l.id)}">${l.recordingReservationState==='finish-pending'?'Retry count confirmation':'Retry reservation release'}</button></section>`:'';
  const T=[['notes','Smart notes'],['points','Key points'],['transcript','Transcript'],['terms','Terms & examples'],['study','Study']];
  let body='';
  const need=`<div class="empty"><p>${busy?(typeof busy==='string'?busy:'Analyzing the lecture… this takes about a minute.'):'Run AI analysis to get key points, smart notes, terms, examples and detected assignments.'}</p>${busy?'<p style="margin-top:10px">'+thinking+'</p>':mine?`<button class="btn primary" style="margin-top:12px" data-act="analyze" data-id="${esc(l.id)}">${ic('spark')}Analyze lecture</button>`:''}</div>`;
  if(tab==='notes')body=a?`<div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));align-items:start"><article class="panel md">${md(a.notes)}</article><section class="panel stack" style="gap:8px"><h3>My notes</h3><textarea class="in" id="mynotes" data-lec="${esc(l.id)}" rows="12" ${mine?'':'readonly'} placeholder="Add your own notes. They’re searchable and included in study guides.">${esc(l.myNotes||'')}</textarea>${mine?'<p class="small muted">Saves when you click away.</p>':''}${(()=>{const ns=Object.values(allN()).filter(n=>n.lectureId===l.id);return (ns.length?`<p class="eyebrow" style="margin-top:6px">Linked notes</p>${ns.map(n=>`<button class="btn sm" style="justify-content:flex-start" ${goAttr({name:'notes',id:n.id})}>${ic('pencil')}${esc(n.title||'Untitled note')}</button>`).join('')}`:'')+(mine&&course(l.courseId)?`<button class="btn sm ghost" style="justify-content:flex-start" data-act="newNote" data-cid="${esc(l.courseId)}" data-lid="${esc(l.id)}" data-title="${esc(l.title)} — notes">${ic('plus')}New note linked to this lecture</button>`:'')})()}</section></div>`:need;
  if(tab==='points')body=a?`<div class="stack">
    <section class="panel"><h3>Summary</h3><p style="margin-top:6px;max-width:72ch">${esc(a.summary)}</p></section>
    <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));align-items:start">
    <section class="panel"><h3 style="margin-bottom:12px">Key points</h3><ol class="kp">${(a.keyPoints||[]).map(k=>`<li><span>${esc(k)}</span></li>`).join('')}</ol></section>
    <section class="panel stack" style="gap:10px"><h3>Professor emphasized</h3>${(a.emphasized||[]).map(e=>`<div class="emph"><span style="color:var(--hi);flex:none;width:18px">${ic('star')}</span><div style="flex:1"><b>${esc(e.concept)}</b><span class="why">${esc(e.why)}</span></div>${citeChip(l.id,e.t)}</div>`).join('')||'<p class="muted small">Nothing flagged.</p>'}</section></div>
    <div class="grid3">
    <section class="panel"><h3>Assignments detected</h3><ul style="padding-left:1.1em;margin:8px 0 0">${(a.assignments||[]).map(x=>`<li>${esc(x.title)}${x.due?` · <span class="muted">${fmtD(x.due)}</span>`:''}</li>`).join('')||'<li class="muted">None mentioned</li>'}</ul>${(a.assignments||[]).length&&mine?`<p class="small muted" style="margin-top:8px">Added to ${esc(c.code||'the course')} assignments.</p>`:''}</section>
    <section class="panel"><h3>Announcements</h3><ul style="padding-left:1.1em;margin:8px 0 0">${(a.announcements||[]).map(x=>`<li>${esc(x)}</li>`).join('')||'<li class="muted">None</li>'}</ul></section>
    <section class="panel"><h3>Questions students asked</h3><ul style="padding-left:1.1em;margin:8px 0 0">${(a.studentQuestions||[]).map(q=>`<li>${esc(q.q)} ${citeChip(l.id,q.t)}</li>`).join('')||'<li class="muted">None</li>'}</ul></section></div></div>`:need;
  if(tab==='transcript')body=(l.segs||[]).length||!mine?`<section class="panel" style="padding:10px"><div class="tx">${txHTML(l,'view')}</div></section>${mine?`<div class="row" style="margin-top:10px"><button class="btn sm ghost" data-act="addTx" data-id="${esc(l.id)}">${ic('plus')}Add more transcript</button></div>`:''}`
      :`<div class="empty" style="text-align:left"><p><b>No transcript for this lecture.</b></p><p class="small" style="margin-top:6px">${l.hasAudio?(window.CS_TRANSCRIBE?(txLimited?'The audio is saved, but this library has reached its monthly transcription limit.':'The audio is saved. Tap below to transcribe it.'):'The audio is saved in this browser, but transcription isn’t available here.'):'No audio was recorded, so there was nothing to transcribe. The ClassScribe page on claude.ai can’t use your microphone; record in the ClassScribe phone app or the Replit web app, or add a transcript below.'}</p>
        ${mine?`<div class="row" style="margin-top:12px">${l.hasAudio&&window.CS_TRANSCRIBE?`<button class="btn primary" data-act="txAudioSaved" data-id="${esc(l.id)}" ${txLimited?'disabled':''}>${ic('spark')}${txLimited?'Transcription limit reached':'Transcribe the recording'}</button>`:''}<button class="btn ${l.hasAudio&&window.CS_TRANSCRIBE?'':'primary'}" data-act="addTx" data-id="${esc(l.id)}">${ic('plus')}Add a transcript</button></div>${l.hasAudio&&txLimited?transcriptionLimitGateMarkup():''}`:''}</div>
      ${(l.marks||[]).length||(l.slides||[]).length?`<section class="panel" style="padding:10px;margin-top:12px"><div class="tx">${txHTML(l,'view')}</div></section>`:''}`;
  if(tab==='terms')body=a?`<div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));align-items:start"><section class="panel"><h3>Terms defined</h3><div style="margin-top:6px">${(a.terms||[]).map(t=>`<div class="term"><b>${esc(t.term)}</b><div>${esc(t.def)} ${t.t!=null?citeChip(l.id,t.t):''}</div></div>`).join('')}</div></section>
    <section class="panel"><h3>Examples, formulas, people & dates</h3><div class="list" style="margin-top:6px">${(a.examples||[]).map(x=>`<div class="li"><span class="chip">${esc(x.kind)}</span><span class="grow">${esc(x.text)}</span>${x.t!=null?citeChip(l.id,x.t):''}</div>`).join('')||'<p class="muted small">None found.</p>'}</div></section></div>`:need;
  if(tab==='study')body=`<div class="grid3">
    <button class="course-card" style="--cc:var(--accent)" ${goAttr({name:'study',mode:'cards',courseId:l.courseId,lectureIds:[l.id]})}><span style="width:24px;color:var(--accent)">${ic('cards')}</span><h3>Flashcards</h3><p class="small muted">${plural(((a&&a.terms)||[]).length,'card')} from this lecture’s terms, plus more on request.</p></button>
    <button class="course-card" style="--cc:var(--c2)" ${goAttr({name:'study',mode:'test',courseId:l.courseId,lectureIds:[l.id]})}><span style="width:24px;color:var(--c2)">${ic('file')}</span><h3>Practice test</h3><p class="small muted">Multiple choice, short answer and essay questions.</p></button>
    <button class="course-card" style="--cc:var(--c3)" ${goAttr({name:'tutor',courseId:l.courseId,lectureIds:[l.id],mode:'quiz'})}><span style="width:24px;color:var(--c3)">${ic('chat')}</span><h3>Quiz me</h3><p class="small muted">A tutor that asks one question at a time, using only this lecture.</p></button>
    <button class="course-card" style="--cc:var(--c4)" ${goAttr({name:'catchup',id:l.id})}><span style="width:24px;color:var(--c4)">${ic('book')}</span><h3>Catch-up view</h3><p class="small muted">The “I missed class” summary of this lecture.</p></button></div>
    ${mine?`<div class="row" style="margin-top:16px"><label class="check" style="flex:1"><input type="checkbox" data-reviewed="${esc(l.id)}" ${l.reviewed?'checked':''}><span>I’ve reviewed this lecture</span></label></div>`:''}`;
  return `<button class="btn ghost sm" ${course(l.courseId)?goAttr({name:'course',id:l.courseId}):goAttr({name:'home'})} style="margin-bottom:10px">${ic('back')}${esc(c.code||'Back')}</button>
  <div class="lec-h"><div class="row" style="gap:6px">${codeChip(course(l.courseId))}<span class="chip">${esc(fmtLong(l.date))}</span>${l.module?`<span class="chip">${esc(l.module)}</span>`:''}<span class="chip">${Math.round((l.duration||0)/60)} min</span>${l.sharedCopy?'<span class="chip ok">Shared by a classmate</span>':''}${l.ex?'<span class="chip ex">Example</span>':''}</div>
    <h1>${esc(l.title)}</h1>
    <p class="muted small">Speakers: ${Object.values(l.speakers||{}).map(esc).join(', ')} · ${plural((l.segs||[]).length,'transcript line')} · ${plural((l.marks||[]).length,'bookmark')}</p>
     <div class="row">${mine?`<button class="btn ${a?'':'primary'}" data-act="analyze" data-id="${esc(l.id)}" ${busy?'disabled':''}>${busy?thinking+(typeof busy==='string'?' Transcribing':' Analyzing'):ic('spark')+(a?'Re-analyze':'Analyze with AI')}</button>`:''}
      <button class="btn" data-act="email" data-id="${esc(l.id)}">${ic('mail')}Email</button><button class="btn" data-act="export" data-id="${esc(l.id)}">${ic('download')}Export</button>${mine&&!l.ex&&!(S.profile&&S.profile.ageBand==='13-17')?`<button class="btn" data-act="share" data-id="${esc(l.id)}">${ic('share')}Share</button>`:''}${mine?`<button class="btn ghost" data-act="delLecture" data-id="${esc(l.id)}">${ic('x')}Delete</button>`:''}</div></div>
    ${reservationNotice}
   ${l.hasAudio?`<div class="panel" style="padding:10px 12px;margin-bottom:14px"><audio id="lecaudio" controls preload="metadata" style="width:100%"></audio><p class="small muted" id="audionote" style="margin-top:4px">Recording saved in this browser. Tap a timestamp in the transcript to jump there.</p>${mine&&(l.segs||[]).length&&window.CS_TRANSCRIBE?`<div class="row" style="margin-top:8px"><button class="btn sm" data-act="txAudioSaved" data-id="${esc(l.id)}" ${busy||txLimited?'disabled':''}>${ic('spark')}${txLimited?'Transcription limit reached':'Transcribe saved audio again'}</button><span class="small muted">Existing transcript lines are kept.</span></div>${txLimited?transcriptionLimitGateMarkup():''}`:''}</div>`:''}
  <div class="tabs" role="tablist">${T.map(([k,t])=>`<button role="tab" aria-selected="${tab===k}" ${goAttr({name:'lecture',id:l.id,tab:k})}>${t}</button>`).join('')}</div>
  ${body}`;
};
AFTER.lecture=v=>{
  const au=$('#lecaudio');const want=typeof v.t==='number'&&Number.isFinite(v.t)&&v.t>=0?v.t:null;
  if(au){audioLoad(v.id).then(u=>{if(!u){const n=$('#audionote');if(n)n.textContent='The recording is saved in the browser it was made in.';au.hidden=true;return}if(au.src!==u)au.src=u;if(want!=null){const seek=()=>{au.currentTime=want;au.play().catch(()=>{})};au.readyState>=1?seek():au.addEventListener('loadedmetadata',seek,{once:true})}})}
  if(want==null)return;const target=want;v.t=null;
  const segs=$$('.seg[data-t]');let best=null;segs.forEach(s=>{if(+s.dataset.t<=target+1)best=s});best=best||segs[0];
  if(best){best.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});best.classList.add('flash');setTimeout(()=>best.classList.remove('flash'),1800)}
};
ACT.markSeg=el=>{const l=lecture(el.dataset.id);if(!l||isExampleRecord('lectures',l))return;const g=l.segs[+el.dataset.i];const marks=[...(l.marks||[])];const k=marks.findIndex(t=>Math.abs(t-g.t)<2);k>=0?marks.splice(k,1):marks.push(g.t);put('lectures',{...l,marks})};
ACT.explainSeg=el=>{const l=lecture(el.dataset.id);const i=+el.dataset.i;const g=l.segs[i];const ctx=l.segs.slice(Math.max(0,i-4),i+4).map(s=>`${spkName(l,s.s)}: ${s.x}`).join('\n');openExplain('From '+fmtD(l.date)+' at '+fmtT(g.t),g.x,ctx+(l.analysis?'\n\nLecture summary: '+l.analysis.summary:''),l.courseId)};
ACT.delLecture=el=>{const l=lecture(el.dataset.id);if(!l||isExampleRecord('lectures',l))return;if(el.dataset.armed){del('lectures',l.id);go({name:'course',id:l.courseId});toast('Lecture deleted');return}el.dataset.armed='1';el.innerHTML='Tap again to delete';el.style.color='var(--rec)'};
ACT.analyze=el=>{const l=lecture(el.dataset.id);if(l&&!isExampleRecord('lectures',l))analyze(el.dataset.id)};
function lectureNotesText(l){return Object.values(allN()).filter(n=>n.lectureId===l.id&&(n.body||'').trim()).map(n=>`${n.title}:\n${n.body}`).join('\n\n')+(l.myNotes?'\n\n'+l.myNotes:'')}
async function analyze(id){
  const l=lecture(id);if(!l||isExampleRecord('lectures',l)||S.busy[id])return;
  const notesTxt=lectureNotesText(l).trim();
  if(!(l.segs||[]).length&&!(l.slides||[]).length&&!notesTxt){toast('There’s nothing to analyze yet: this lecture has no transcript, slides or notes. Add a transcript first.');go({name:'lecture',id,tab:'transcript'});return}
  S.busy[id]=true;render();
  const tx=(l.segs||[]).map(g=>`[${Math.round(g.t)}] ${spkName(l,g.s)}: ${g.x}`).join('\n')+((l.slides||[]).length?'\n\nSLIDES / BOARD:\n'+l.slides.map(s=>`[${s.t}] ${s.text}`).join('\n'):'')+((l.marks||[]).length?'\n\nBookmarked moments: '+l.marks.join(', '):'')+(notesTxt?'\n\nStudent notes:\n'+notesTxt:'');
  try{
    const a=await window.CS_BASIC_ANALYZE(tx.slice(0,80000),/^\d{4}-\d\d-\d\d$/.test(l.date||'')?l.date:undefined,'intermediate');
    const fresh=lecture(id)||l;const an={
      summary:a.summary||'',keyPoints:a.keyPoints||[],
      terms:(a.definitions||[]).map(x=>({term:x.term,def:x.definition,t:0})),
      assignments:(a.dates||[]).map(x=>({title:x.label,type:'homework',due:/^\d{4}-\d\d-\d\d$/.test(x.date||'')?x.date:'',t:0})),
      notes:a.notes||'',emphasized:[],examples:[],announcements:[],studentQuestions:[],concepts:[]
    };
    if(!isMine(fresh)){fresh.analysis=an;toast('Catch-up ready');return}
    await put('lectures',{...fresh,analysis:an});
    for(const [i,x] of an.assignments.entries()){const aid=id+'-a'+i;if(!allA()[aid]&&x.title)await put('assignments',{id:aid,courseId:l.courseId,title:x.title,type:x.type||'homework',due:/^\d{4}-\d\d-\d\d$/.test(x.due||'')?x.due:'',lectureId:id,t:x.t||0,done:false,dateConfirmed:false,ex:!!l.ex})}
    toast('Analysis ready'+(an.assignments.length?` · ${plural(an.assignments.length,'assignment')} added`:''));
  }catch(e){aiErr(e)}
  finally{delete S.busy[id];render()}
}

AFTER.capture=()=>{
  if(SES&&SES.step==='live'){const el=$('#livetx');if(el)el.scrollTop=el.scrollHeight;startTick();return}
  if(privacyLibraryCode())void flushPrivacyConsentQueue(privacyLibraryCode());
  updateCaptureAudioSource();
  if(!PRIVACY_CONFIG&&!capturePrivacyLoading){
    capturePrivacyLoading=true;capturePrivacyError='';
    const view=S.view;
    void loadPrivacyConfig(true).then(()=>{if(S.view===view&&S.view.name==='capture')render()}).catch(error=>{capturePrivacyError=error.message||'Could not load current consent statements.';if(S.view===view&&S.view.name==='capture')render()}).finally(()=>{capturePrivacyLoading=false});
  }
};
ACT.capturePrivacyRetry=()=>{capturePrivacyError='';PRIVACY_CONFIG=null;capturePrivacyLoading=false;render()};

ACT.capStamp=()=>{const b=$('#capnotes');if(!b)return;const tok=`[${stampDate(SES.date)} · ${fmtT(nowT())}] `;const p=b.selectionStart??b.value.length;b.value=b.value.slice(0,p)+(p&&b.value[p-1]!=='\n'?'\n':'')+tok+b.value.slice(p);SES.notes=b.value;b.focus()};

/* ---------- microphone: real audio + live captions ---------- */
const MIC={stream:null,sharedStream:null,rec:null,chunks:[],mime:'',sr:null,state:'off',captions:false,wantCaptions:false,generation:0,audioSource:'microphone'};
function onlineCaptureSupported(){
  const ua=navigator.userAgent||'';
  return window.isSecureContext!==false&&!!navigator.mediaDevices?.getDisplayMedia&&typeof MediaRecorder!=='undefined'&&!/Android|iPhone|iPad|iPod|Mobile/i.test(ua)&&!(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)&&(!ua||/Chrome|Chromium|Edg\//.test(ua));
}
function stopCaptureTracks(...streams){for(const stream of streams)if(stream)for(const track of stream.getTracks())try{track.stop()}catch(e){}}
function updateCaptureAudioSource(){
  const select=$('#cap-audio-source');if(!select)return;
  const online=select.value==='online',details=$('#cap-online-details'),help=$('#cap-audio-help'),button=$('#cap-start');
  if(details)details.hidden=!online;
  if(help)help.textContent=online?(onlineCaptureSupported()?'Choose the lecture’s browser tab and turn on Share tab audio. Recording starts only after audio and your saved consent are verified.':'Tab-audio capture is unavailable here. Open ClassScribe in a separate desktop Chrome or Edge tab, or import a permitted audio recording or transcript instead.'):'Microphone recording is selected. It does not directly capture audio playing through headphones.';
  if(button){button.disabled=!!button.closest('form')?.dataset.starting||!PRIVACY_CONFIG||!$('#consent1')?.checked||!$('#consent2')?.checked||(online&&(!onlineCaptureSupported()||!$('#cap-online-consent')?.checked));button.textContent=online?'Choose lecture tab & record':'Start recording'}
}
async function prepareOnlineCapture(){
  if(!onlineCaptureSupported())throw new Error('Use desktop Chrome or Edge in a separate browser tab, or import a permitted audio recording or transcript.');
  let stream;
  try{
    // Called directly from the consent-confirmed submit gesture, before network awaits.
    stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true,selfBrowserSurface:'exclude',surfaceSwitching:'exclude',systemAudio:'exclude'});
    const video=stream.getVideoTracks()[0],audio=stream.getAudioTracks();
    if(video?.getSettings?.().displaySurface!=='browser')throw new Error('Choose a browser tab, not a window or entire screen. Open your meeting in a browser tab, or import its recording.');
    if(!audio.length||audio.every(track=>track.readyState==='ended'))throw new Error('No tab audio was shared. Try again, choose the lecture tab, and enable Share tab audio. No microphone fallback was started.');
    return stream;
  }catch(error){
    stopCaptureTracks(stream);
    if(error.name==='NotAllowedError'||error.name==='AbortError')throw new Error('Tab sharing was cancelled or blocked. Nothing was recorded. Open ClassScribe in its own browser tab and retry, or import a permitted recording.');
    throw error;
  }
}
function micNoteHTML(){
  if(MIC.audioSource==='online'){
    if(MIC.state==='on')return `<b style="color:var(--rec)">${SES?.running?'Recording shared-tab audio':'Tab-audio recording paused'}</b> <span class="muted">· microphone and video are not recorded. ${window.CS_TRANSCRIBE?'The transcript is generated after you stop and save, subject to your plan.':'Transcription is unavailable here; save the audio and import a transcript.'}</span>`;
    if(MIC.state==='ended')return '<span role="alert"><b>Tab sharing ended.</b> Recording is paused. Audio already captured is retained; choose Stop &amp; save. Start a new recording to select a tab again.</span>';
    if(MIC.state==='unsupported'||MIC.state==='blocked')return '<span role="alert">Tab audio could not be recorded. No microphone fallback was started. Stop this session and retry in desktop Chrome or Edge, or import a permitted recording or transcript.</span>';
  }
  if(MIC.state==='on')return `<span style="color:var(--rec);font-weight:700">● Recording audio</span> <span class="muted">· ${MIC.captions?'live captions on':window.CS_TRANSCRIBE?(transcriptionCountLimitReached()?'monthly transcription count reached; audio will be saved':'the transcript is made when you save'):'live captions aren’t available in this browser; type key lines below'}</span>`;
  if(MIC.state==='starting')return '<span class="muted">Starting the microphone…</span>';
  if(MIC.state==='blocked')return '<span class="muted"><b>Microphone is blocked here</b>, so audio isn’t being recorded. Open ClassScribe in a browser tab and allow microphone access, or save the lecture and upload audio using Add a transcript. Typed or pasted lines are still saved.</span>';
  if(MIC.state==='unsupported')return '<span class="muted">This browser can’t record audio. Dictate with your keyboard, type, paste or import a transcript.</span>';
  return '';
}
function updMicNote(){const n=$('#micnote');if(n)n.innerHTML=micNoteHTML()}
function setInterim(t){const e=$('#interim');if(e)e.textContent=t?'… '+t:''}
async function micStart(session){
  const generation=++MIC.generation;
  const online=session.audioSource==='online';
  MIC.audioSource=online?'online':'microphone';
  MIC.chunks=[];MIC.captions=false;
  const chunks=MIC.chunks;
  if(!navigator.mediaDevices||(!online&&!navigator.mediaDevices.getUserMedia)||typeof MediaRecorder==='undefined'){stopCaptureTracks(session.sharedTabStream);session.sharedTabStream=null;MIC.state='unsupported';updMicNote();void releaseRecordingReservation(session,true);return}
  MIC.state='starting';updMicNote();
  let stream,sharedStream;
  try{
    if(online){sharedStream=session.sharedTabStream;session.sharedTabStream=null;if(!sharedStream||!sharedStream.getAudioTracks().some(track=>track.readyState!=='ended'))throw new Error('Tab audio ended before recording started');stream=new MediaStream(sharedStream.getAudioTracks())}
    else stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
  }
  catch(e){stopCaptureTracks(stream,sharedStream);if(MIC.generation===generation){MIC.state='blocked';updMicNote()}void releaseRecordingReservation(session,true);return}
  if(MIC.generation!==generation||SES!==session||session.step!=='live'||session.saving||S.view.name!=='capture'){
    stopCaptureTracks(stream,sharedStream);return;
  }
  const types=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'];
  MIC.mime=types.find(t=>MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(t))||'';
  let recorder;
  try{recorder=new MediaRecorder(stream,MIC.mime?{mimeType:MIC.mime,audioBitsPerSecond:32000}:undefined)}
  catch(e){try{recorder=new MediaRecorder(stream)}catch(err){stopCaptureTracks(stream,sharedStream);MIC.state='unsupported';updMicNote();void releaseRecordingReservation(session,true);return}}
  MIC.stream=stream;MIC.sharedStream=sharedStream||null;MIC.rec=recorder;MIC.mime=recorder.mimeType||MIC.mime;
  recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  try{recorder.start(1000);if(!session.running)recorder.pause()}
  catch(e){stopCaptureTracks(stream,sharedStream);MIC.stream=null;MIC.sharedStream=null;MIC.rec=null;MIC.state='unsupported';updMicNote();void releaseRecordingReservation(session,true);return}
  MIC.state='on';MIC.wantCaptions=!online;if(session.running&&!online)captionsStart();updMicNote();
  if(sharedStream)for(const track of sharedStream.getTracks())track.addEventListener('ended',()=>{
    if(MIC.generation!==generation||SES!==session||session.saving||MIC.state==='ended')return;
    if(session.running){session.acc+=Date.now()-session.resumeAt;session.running=false}
    micPause();MIC.state='ended';stopCaptureTracks(stream,sharedStream);updMicNote();render();
  },{once:true});
}
function captionsStart(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR||!MIC.wantCaptions)return;
  try{
    const r=new SR();r.continuous=true;r.interimResults=true;r.lang=navigator.language||'en-US';let startAt=null;
    r.onresult=ev=>{for(let i=ev.resultIndex;i<ev.results.length;i++){const res=ev.results[i];if(startAt==null)startAt=Math.max(0,nowT()-1);
        if(res.isFinal){const x=res[0].transcript.trim();if(x&&SES)addSeg(x.charAt(0).toUpperCase()+x.slice(1),SES.spk||'P',startAt,'caption');startAt=null;setInterim('')}else setInterim(res[0].transcript)}};
    r.onerror=e=>{if(e.error==='not-allowed'||e.error==='service-not-allowed'||e.error==='audio-capture'){MIC.wantCaptions=false;MIC.captions=false;MIC.sr=null;updMicNote()}};
    r.onend=()=>{if(MIC.sr===r&&SES&&SES.running&&MIC.wantCaptions){try{r.start()}catch(e){}}};
    r.start();MIC.sr=r;MIC.captions=true;
  }catch(e){MIC.captions=false}
}
function captionsStop(){if(MIC.sr){const r=MIC.sr;MIC.sr=null;try{r.stop()}catch(e){}}setInterim('')}
function micPause(){if(MIC.rec&&MIC.rec.state==='recording'){try{MIC.rec.pause()}catch(e){}}captionsStop()}
function micResume(){if(MIC.rec&&MIC.rec.state==='paused'){try{MIC.rec.resume()}catch(e){}}if(MIC.state==='on')captionsStart()}
function micStop(){
  return new Promise(res=>{
    ++MIC.generation;
    MIC.wantCaptions=false;captionsStop();
    const recorder=MIC.rec,stream=MIC.stream,sharedStream=MIC.sharedStream,chunks=MIC.chunks,mime=MIC.mime;
    MIC.rec=null;MIC.stream=null;MIC.sharedStream=null;MIC.state='off';MIC.captions=false;
    const finish=()=>{const b=chunks.length?new Blob(chunks,{type:(mime||'audio/webm').split(';')[0]}):null;
      stopCaptureTracks(stream,sharedStream);res(b)};
    if(!recorder||recorder.state==='inactive')return finish();
    let done=false;const once=()=>{if(!done){done=true;finish()}};
    recorder.onstop=once;try{recorder.stop()}catch(e){once()}setTimeout(once,3000);
  });
}
window.addEventListener('pagehide',()=>{if(SES&&SES.step==='live'){const session=SES;micStop().catch(()=>{});void releaseRecordingReservation(session,true);SES=null}});

/* ---------- recorded audio kept in this browser for playback ---------- */
const AUDIO_URLS={};
function audioDB(){return new Promise((res,rej)=>{try{const r=indexedDB.open('classscribe-audio',1);r.onupgradeneeded=()=>r.result.createObjectStore('audio');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}})}
async function audioSave(id,blob){
  const db=await audioDB();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('audio','readwrite');
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('Audio write failed'));
      tx.onabort=()=>reject(tx.error||new Error('Audio write aborted'));
      tx.objectStore('audio').put(blob,id);
    });
  }finally{db.close()}
}
async function audioLoad(id){if(AUDIO_URLS[id])return AUDIO_URLS[id];try{const d=await audioDB();const b=await new Promise((res,rej)=>{const q=d.transaction('audio').objectStore('audio').get(id);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});if(b){AUDIO_URLS[id]=URL.createObjectURL(b);return AUDIO_URLS[id]}}catch(e){}return null}

/* ---------- time stamps with the date ---------- */
function stampDate(iso){return dObj(iso).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}
function stampsToLinks(text,lecId){return text.replace(/\[(?:([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}) · )?(\d+:\d{2}(?::\d{2})?)\]/g,(m,day,ts)=>`${day?day+' ':''}[[${lecId}@${hms(ts)}]]`)}

/* ---------- add a transcript to a saved lecture ---------- */
ACT.addTx=el=>{const l=lecture(el.dataset.id);if(!l||isExampleRecord('lectures',l))return;const txLimited=transcriptionCountLimitReached();
  openModal(`<div class="spread"><h2>Add a transcript</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
  <p class="small muted">Paste the transcript or upload it from Zoom, Teams, Otter, your phone’s recorder or a captioning service (.txt, .vtt, .srt).${window.CS_TRANSCRIBE&&!txLimited?' You can also upload an audio recording and ClassScribe will transcribe it.':''}</p>
  ${txLimited?transcriptionLimitGateMarkup():''}
  <textarea class="in" id="tx-text" rows="9" placeholder="[00:00] Prof. Lee: Today we start meiosis…"></textarea>
  <div class="row"><label class="btn sm">${ic('upload')}Transcript file<input type="file" id="tx-file" accept=".txt,.vtt,.srt,text/plain,text/vtt" hidden></label>${window.CS_TRANSCRIBE&&!txLimited?`<label class="btn sm">${ic('mic')}Audio recording<input type="file" id="tx-audio" accept="audio/*,.m4a,.mp3,.wav,.webm" hidden></label>`:''}<span class="small muted" id="tx-status"></span></div>
  <div class="row"><button class="btn primary" data-act="addTxGo" data-id="${esc(l.id)}">${ic('check')}Add and analyze</button></div>`,{wide:true})};
let TX_AUDIO=null;
document.addEventListener('change',e=>{const t=e.target;
  if(t.id==='tx-file'&&t.files[0])t.files[0].text().then(x=>{$('#tx-text').value=x;$('#tx-status').textContent=t.files[0].name});
  if(t.id==='tx-audio'&&t.files[0]){TX_AUDIO=t.files[0];$('#tx-status').textContent='Audio: '+t.files[0].name}});
function mergeAudioTranscript(existing,segs,source){
  const kept=source==='imported'?existing:existing.filter(g=>g.source!=='caption'&&g.source!=='transcription');
  return [...kept,...segs.map(g=>({t:g.t,s:'P',x:g.x,source}))].sort((a,b)=>(a.t??Infinity)-(b.t??Infinity));
}
let pendingLectureTranscriptionConsent=null;
function settleLectureTranscriptionConsent(approval){
  const pending=pendingLectureTranscriptionConsent;if(!pending)return;
  pendingLectureTranscriptionConsent=null;closeModal();pending.resolve(approval||null);
}
function requestLectureTranscriptionConsent(lecture,statements,accommodation=false){
  if(pendingLectureTranscriptionConsent)pendingLectureTranscriptionConsent.resolve(null);
  return new Promise(resolve=>{
    pendingLectureTranscriptionConsent={resolve};
    openModal(`<div class="spread"><div><p class="eyebrow">Permission for saved audio</p><h2 id="lecture-transcription-consent-heading">Confirm before transcribing</h2></div></div><p>This audio is already saved for <b>${esc(lecture.title||'this lecture')}</b>. Read and confirm both current statements before sending it for transcription.</p><label class="check"><input type="checkbox" id="lecture-transcription-consent-1"><span>${esc(statements[0])}</span></label><label class="check"><input type="checkbox" id="lecture-transcription-consent-2"><span>${esc(statements[1])}</span></label><label class="check"><input type="checkbox" id="lecture-transcription-accommodation" ${accommodation?'checked':''}><span>I have an accessibility accommodation relevant to this recording (optional).</span></label><p id="lecture-transcription-consent-error" class="small" role="alert" style="color:var(--warn)" hidden></p><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="lectureTranscriptionConsentCancel">Cancel</button><button type="button" class="btn primary" data-act="lectureTranscriptionConsentConfirm">Confirm permission and transcribe</button></div>`);
    const dialog=$('#modal-root .modal');if(dialog)dialog.setAttribute('aria-labelledby','lecture-transcription-consent-heading');
  });
}
function transcriptionConsentDraftKey(code,lectureId){return`cs_transcription_consent_draft_v1_${encodeURIComponent(code||'local')}_${encodeURIComponent(lectureId)}`}
async function ensureLectureTranscriptionConsent(savedLecture){
  const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id);
  const existingRecordingId=String(savedLecture.consentRecordingId||savedLecture.id);
  if(validId(savedLecture.consentId)&&savedLecture.sessionId===existingRecordingId)return{consentId:savedLecture.consentId,recordingId:existingRecordingId,sessionId:savedLecture.sessionId,lectureId:savedLecture.id,courseId:savedLecture.courseId};
  if(!savedLecture.id||!savedLecture.courseId)throw new Error('This saved audio is missing its lecture or course identity.');
  const config=PRIVACY_CONFIG||await loadPrivacyConfig();
  const code=privacyLibraryCode(),key=transcriptionConsentDraftKey(code,savedLecture.id);
  let previous=null;
  try{
    previous=JSON.parse(localStorage.getItem(key)||'null');
    if(!previous||previous.lectureId!==savedLecture.id||previous.courseId!==savedLecture.courseId||previous.version!==config.consent.version||JSON.stringify(previous.statements)!==JSON.stringify(config.consent.statements)){previous=null;localStorage.removeItem(key)}
  }catch(e){previous=null}
  const recordingId=previous&&previous.sessionId||uid();
  const approval=await requestLectureTranscriptionConsent(savedLecture,config.consent.statements,!!(previous&&previous.accommodation));
  if(!approval)return null;
  const record={
    consentId:previous&&previous.consentId||'consent-'+uid(),
    sessionId:recordingId,lectureId:String(savedLecture.id),courseId:String(savedLecture.courseId),
    version:config.consent.version,statements:[...config.consent.statements],platform:'web',
    appVersion:window.CS_APP_VERSION||'web-0.0.0',accommodation:!!approval.accommodation
  };
  try{localStorage.setItem(key,JSON.stringify(record))}
  catch(e){throw new Error('Could not save the permission record in this browser. Audio was not sent.')}
  const persisted=await persistRecordingConsent(record,code);
  if(persisted.queued)throw new Error('Permission is saved on this device. Connect to the internet so it can be uploaded before transcription.');
  record.consentId=persisted.consentId;
  try{localStorage.setItem(key,JSON.stringify(record))}
  catch(e){throw new Error('Permission was saved, but its receipt could not be retained on this device. Audio was not sent.')}
  const current=lecture(savedLecture.id)||savedLecture;
  await put('lectures',{...current,consentId:record.consentId,sessionId:record.sessionId,consentRecordingId:record.sessionId});
  try{localStorage.removeItem(key)}catch(e){}
  return{consentId:record.consentId,recordingId:record.sessionId,sessionId:record.sessionId,lectureId:record.lectureId,courseId:record.courseId};
}
ACT.lectureTranscriptionConsentCancel=()=>settleLectureTranscriptionConsent(null);
ACT.lectureTranscriptionConsentConfirm=()=>{
  const first=$('#lecture-transcription-consent-1'),second=$('#lecture-transcription-consent-2'),error=$('#lecture-transcription-consent-error');
  if(!first?.checked||!second?.checked){if(error){error.hidden=false;error.textContent='Confirm both current permission and privacy statements before continuing.'}return}
  settleLectureTranscriptionConsent({accommodation:!!$('#lecture-transcription-accommodation')?.checked});
};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&pendingLectureTranscriptionConsent)settleLectureTranscriptionConsent(null)},true);
document.addEventListener('click',event=>{if(pendingLectureTranscriptionConsent&&event.target&&event.target.dataset&&event.target.dataset.act==='scrim')settleLectureTranscriptionConsent(null)},true);
async function transcribeInto(id,blob,btn,source='transcription'){
  const original=lecture(id);if(!original||isExampleRecord('lectures',original)){toast('Example content is read-only.');return false}
  if(transcriptionCountLimitReached()){toast(transcriptionCountNotice());return false}
  let consent;
  try{consent=await ensureLectureTranscriptionConsent(original)}
  catch(error){toast(error.message||'Permission could not be saved. Audio was not sent.');return false}
  if(!consent)return false;
  if(btn){btn.disabled=true;btn.innerHTML=thinking+' Transcribing…'}
  S.busy[id]='Transcribing the recording…';render();
    try{const segs=await window.CS_TRANSCRIBE(blob,{timed:true,...consent});const l=lecture(id);if(!segs||!segs.length){toast('No speech was found in that recording.');delete S.busy[id];render();return false}
     await put('lectures',{...l,segs:mergeAudioTranscript(l.segs||[],segs,source)});delete S.busy[id];render();void loadBillingStatus(true,billingUserCode());return true}
   catch(e){delete S.busy[id];render();if(e&&e.code==='plan_limit'){void loadBillingStatus(true,billingUserCode());toast('This library has reached its monthly transcription limit. Review Plans & privacy or try again next month.')}else toast('Transcription didn’t finish: '+((e&&e.message)||'try again'));return false}
}
ACT.addTxGo=async el=>{
  const id=el.dataset.id;const l=lecture(id);if(!l||isExampleRecord('lectures',l))return;const text=$('#tx-text').value.trim();
  if(!text&&!TX_AUDIO){toast('Paste a transcript or choose a file first.');return}
  if(TX_AUDIO&&transcriptionCountLimitReached()){const status=$('#tx-status');if(status)status.textContent=transcriptionCountNotice();return}
  if(TX_AUDIO){const a=TX_AUDIO;if(!await transcribeInto(id,a,null,'imported'))return;TX_AUDIO=null;closeModal()}
  else{const lines=parseTranscript(text,0);if(!lines.length){toast('No transcript lines found.');return}
    await put('lectures',{...l,segs:[...(l.segs||[]),...lines].sort((a,b)=>a.t-b.t),duration:Math.max(l.duration||0,Math.round(lines[lines.length-1].t+20))});closeModal()}
  toast('Transcript added');go({name:'lecture',id,tab:'transcript'});const s=await AI();if(s)analyze(id);
};
ACT.txAudioSaved=async el=>{const id=el.dataset.id;const l=lecture(id);if(!l||isExampleRecord('lectures',l))return;const u=await audioLoad(id);if(!u){toast('The recording isn’t in this browser.');return}const blob=await (await fetch(u)).blob();if(await transcribeInto(id,blob,el)){toast('Transcript added');const s=await AI();if(s)analyze(id)}};
