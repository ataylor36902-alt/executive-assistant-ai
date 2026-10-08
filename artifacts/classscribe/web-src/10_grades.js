/* Grades are server-owned. Never infer a score from a lecture or example course. */
const GRADE_TYPES=['assignment','project','quiz','test'];
const GRADE_NAMES={assignment:'Assignments',project:'Projects',quiz:'Quizzes',test:'Tests'};
const GRADE_SINGULAR={assignment:'Assignment',project:'Project',quiz:'Quiz',test:'Test'};
const GRADES={code:null,state:'idle',data:null,error:'',saving:false};
function gradesAccess(){return examFeatureState('studyTools')}
function gradesResetIfChanged(){
  const code=billingUserCode();
  if(GRADES.code!==code){GRADES.code=code;GRADES.state='idle';GRADES.data=null;GRADES.error='';GRADES.saving=false}
}
async function gradesRequest(path,body){
  const code=billingUserCode();
  const response=await fetch('/api/student/grades/'+path,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CS-User':code},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||data.message||'Could not reach your gradebook. Try again.');error.status=response.status;error.code=data.code;throw error}
  if(!data||!Array.isArray(data.courses)||!data.summary)throw new Error('The gradebook response was incomplete. Try again.');
  return data;
}
async function loadGrades(force=false){
  gradesResetIfChanged();
  if(gradesAccess()!=='allowed'||!billingUserCode())return;
  if(GRADES.state==='loading'||!force&&GRADES.state==='ready')return;
  const code=GRADES.code;
  GRADES.state='loading';GRADES.error='';render();
  try{const result=await gradesRequest('list',{});if(code!==billingUserCode())return;GRADES.data=result;GRADES.state='ready'}
  catch(error){if(code!==billingUserCode())return;GRADES.error=error.message;GRADES.state=error.status===403?'locked':'error';if(GRADES.state==='locked')void loadBillingStatus(true,code)}
  if(code===billingUserCode()&&(S.view.name==='grades'||S.view.name==='course'&&S.view.tab==='grades'))render();
}
function gradesEntry(cid){return (GRADES.data&&GRADES.data.courses||[]).find(x=>x.courseId===cid||x.gradebook&&x.gradebook.courseId===cid)}
function gradeNumber(n,suffix=''){return n===null||n===undefined||!Number.isFinite(Number(n))?'—':Number(n).toFixed(suffix?1:2).replace(/\.0+$/,'')+suffix}
function gradeCoach(x,courseLabel=''){
  const g=x&&x.gradebook||{},a=x&&x.analysis||{},items=g.items||[];
  const scored=items.filter(i=>i.earned!==null&&i.earned!==undefined&&Number.isFinite(Number(i.earned))&&Number(i.possible)>0);
  const pending=items.filter(i=>i.earned===null||i.earned===undefined);
  const categories=(a.byType||[]).filter(r=>r.averagePercent!==null&&r.averagePercent!==undefined&&Number.isFinite(Number(r.averagePercent))&&scored.some(i=>i.type===r.type)&&(!g.weights||Number(g.weights[r.type])>0)).sort((r,s)=>Number(r.averagePercent)-Number(s.averagePercent));
  const weak=categories[0],eligible=scored.filter(i=>!g.weights||Number(g.weights[i.type])>0),pool=weak?eligible.filter(i=>i.type===weak.type):eligible;
  const lowest=pool.slice().sort((i,j)=>Number(i.earned)/Number(i.possible)-Number(j.earned)/Number(j.possible))[0];
  const tips=[];
  if(!scored.length){
    tips.push('Enter a score from returned work to see which category needs attention.');
    tips.push('Check your syllabus for category weights, then ask your instructor what the next assessment will cover.');
  }else{
    if(weak&&Number(weak.averagePercent)<100)tips.push(`Start with ${GRADE_NAMES[weak.type]||weak.type}: your entered scores average ${gradeNumber(weak.averagePercent,'%')}${g.weights?' and this category counts for '+gradeNumber(g.weights[weak.type],'%')+' of your course':''}. Review the feedback before the next assessment.`);
    if(lowest&&Number(lowest.earned)<Number(lowest.possible))tips.push(`Rework ${lowest.title} (${gradeNumber(lowest.earned)} / ${gradeNumber(lowest.possible)}). Identify what you missed and practice those concepts with your notes or instructor.`);
    if(!tips.length)tips.push('Your recorded work is strong. Check the syllabus for the next assessment and review its topics early.');
    tips.push(pending.length?`${pending.length} saved ${pending.length===1?'item is':'items are'} still unscored. Add the result when it is returned, then revisit your priorities.`:weak&&Number(weak.averagePercent)<100?'Plan two short review sessions before your next graded task, focusing on feedback from the category above.':'Plan two short review sessions before your next graded task, focusing on its upcoming topics.');
  }
  return `<section class="grade-coach" aria-label="Grade improvement strategies"><div class="grade-coach-heading"><img src="/chief-joseph-tribute.png" alt="Illustrated tribute to Chief Hinmahtooyalatkekt (Chief Joseph)" width="76" height="76"><div><p class="eyebrow">ClassScribe study strategies</p><h2>Make your next score count</h2>${courseLabel?`<p class="small muted">For ${esc(courseLabel)}</p>`:''}</div></div><ol>${tips.map(t=>`<li>${esc(t)}</li>`).join('')}</ol><p class="grade-coach-note">Illustrated tribute to Chief Hinmahtooyalatkekt (Chief Joseph). Strategies are from ClassScribe, not his words or an endorsement. Based on scores you entered; confirm grading rules with your instructor.</p></section>`;
}
function gradesShell(cid){
  gradesResetIfChanged();
  const access=gradesAccess();
  if(access==='loading')return `<div class="panel grade-state" role="status"><span class="grade-skeleton"></span><span class="grade-skeleton short"></span><p class="small muted">Checking your plan…</p></div>`;
  if(access==='error')return `<div class="panel grade-state" role="alert"><h3>Plan verification unavailable</h3><p class="muted small">${esc(S.billing.error||'Try again to check your plan.')}</p><div class="row"><button class="btn sm" data-act="gradesBillingRetry">Retry verification</button><button class="btn sm" ${goAttr({name:'plans'})}>View plans</button></div></div>`;
  if(access!=='allowed'||GRADES.state==='locked')return `<div class="grade-gate panel"><span class="eyebrow">Student / Pro</span><h2>Know where you stand.</h2><p>Keep your scores, course averages and estimated GPA in one place. Grades are available with Student and Pro.</p><button class="btn primary" ${goAttr({name:'plans'})}>Explore plans</button></div>`;
  if(GRADES.state==='idle'||GRADES.state==='loading')return `<div class="panel grade-state" role="status"><span class="grade-skeleton"></span><span class="grade-skeleton short"></span><span class="grade-skeleton"></span><p class="small muted">Opening your gradebook…</p></div>`;
  if(GRADES.state==='error')return `<div class="panel grade-state" role="alert"><h3>Couldn’t load grades</h3><p class="muted small">${esc(GRADES.error)}</p><button class="btn" data-act="gradesRetry">Try again</button></div>`;
  return cid?gradesCourseContent(cid):gradesOverview();
}
function gradesCourseMarkup(cid){return `<div class="grades-area">${gradesShell(cid)}</div>`}
VIEWS.grades=()=>`<div class="page-h"><div><p class="eyebrow">Your academic picture</p><h1>Grades</h1><p class="sub">Scores you enter, clarity you can use.</p></div>${GRADES.state==='ready'&&gradesAccess()==='allowed'?`<button class="btn sm" data-act="gradesRetry">${ic('cal')} Refresh grades</button>`:''}</div><div class="grades-area">${gradesShell()}</div>`;
AFTER.grades=()=>{if(GRADES.state==='idle')void loadGrades()};
const GRADE_COURSE_AFTER=AFTER.course;
AFTER.course=v=>{if(GRADE_COURSE_AFTER)GRADE_COURSE_AFTER(v);if(v.tab==='grades'&&GRADES.state==='idle')void loadGrades()};
function gradesOverview(){
  const summary=GRADES.data.summary||{},cs=Object.values(S.courses).sort((a,b)=>(a.created||0)-(b.created||0));
  const real=cs.filter(c=>!c.ex);
  const target=real.map(c=>({c,x:gradesEntry(c.id)})).filter(({x})=>x&&x.gradebook&&x.gradebook.items&&x.gradebook.items.some(i=>i.earned!==null&&i.earned!==undefined)).sort((r,s)=>Number(r.x.analysis?.averagePercent??100)-Number(s.x.analysis?.averagePercent??100))[0];
  return `<div class="grade-summary"><div><span class="eyebrow">Across your courses</span><strong>${gradeNumber(summary.estimatedGpa)}</strong><span>Estimated GPA <span class="muted">/ 4.0</span></span></div><p>${gradeNumber(summary.countedCredits)} counted credits<br><small>Only graded courses with credits count. This is an estimate, not an official transcript.</small></p></div>
  ${gradeCoach(target&&target.x,target&&target.c.code)}
  <div class="grade-overview-head"><h2>Course gradebooks</h2><p class="muted small">Select a course to enter scores</p></div>
  ${cs.length?`<div class="grade-course-list">${cs.map(c=>{const x=gradesEntry(c.id),a=x&&x.analysis||{};return `<button class="grade-course-card" ${goAttr({name:'course',id:c.id,tab:'grades'})}><span class="grade-course-mark" style="${ccVar(c)}"></span><span class="grade-course-info"><span class="eyebrow">${esc(c.code)} · ${esc(c.semester||'Course')}</span><b>${esc(c.name)}</b><small>${x&&x.gradebook&&x.gradebook.items&&x.gradebook.items.length?plural(x.gradebook.items.length,'score')+' entered':'No scores yet'}</small></span><span class="grade-course-result"><strong>${gradeNumber(a.averagePercent,'%')}</strong><small>${esc(a.letter||'Not graded')}</small></span></button>`}).join('')}</div>`:`<div class="empty"><h3>Start with a course</h3><p>Add a course to begin tracking scores and an estimated GPA.</p><button class="btn primary" data-act="addCourse">Add course</button></div>`}
  <p class="grade-footnote">ClassScribe does not import grades from your school. Enter your own results; your instructor’s grading policy remains the source of truth.</p>`;
}
function gradesCourseContent(cid){
  const c=course(cid);if(!c)return '<div class="empty">Course not found.</div>';
  if(c.ex)return `<div class="empty"><h3>Example course</h3><p>Grades are for your own courses, not sample content.</p><button class="btn primary" data-act="addCourse">Add your course</button></div>`;
  const x=gradesEntry(cid),g=x&&x.gradebook||{courseId:cid,credits:0,weights:null,items:[],finalPercent:null,version:0},a=x&&x.analysis||{},items=g.items||[];
  return `<div class="grade-course-top"><div class="grade-big-number"><span class="eyebrow">Current course average</span><strong>${gradeNumber(a.averagePercent,'%')}</strong><span>${esc(a.letter||'Not graded')} ${a.isEstimate?'· Estimate':''}</span></div><div class="grade-meta"><span><b>${gradeNumber(g.credits)}</b> credits</span><span><b>${items.length}</b> recorded scores</span><span>${g.weights?'Weighted categories':'Points-based average'}</span></div></div>
  <p class="grade-footnote">This is an estimate from the scores you entered. Your instructor may calculate the final grade differently.</p>
  ${gradeCoach(x,c.code)}
  <div class="grade-actions"><h2>Scores</h2><div class="row"><button class="btn sm" data-act="gradeSettings" data-cid="${esc(cid)}">${ic('pencil')} Grading setup</button><button class="btn primary sm" data-act="gradeAdd" data-cid="${esc(cid)}">${ic('plus')} Add score</button></div></div>
   ${items.length?`<div class="grade-items">${items.map(item=>`<div class="grade-item"><span class="grade-type">${esc(GRADE_NAMES[item.type]||item.type)}</span><div class="grade-item-name"><b>${esc(item.title)}</b><small>${item.date?esc(fmtD(item.date)):'No date'} · ${item.earned===null?'Not scored yet':'Recorded score'}${item.assignmentId?` · ${S.assignments[item.assignmentId]?.courseId===cid?S.assignments[item.assignmentId].title!==item.title?'Course assignment now: '+esc(S.assignments[item.assignmentId].title):'Linked to course assignment':'Course assignment removed; score kept'}`:''}</small></div><strong>${item.earned===null?'—':gradeNumber(item.earned)+' / '+gradeNumber(item.possible)}</strong><div class="grade-item-actions"><button class="btn sm ghost" data-act="gradeEdit" data-cid="${esc(cid)}" data-id="${esc(item.id)}" aria-label="Edit ${esc(item.title)}">Edit</button><button class="btn sm ghost" data-act="gradeDelete" data-cid="${esc(cid)}" data-id="${esc(item.id)}" aria-label="Remove ${esc(item.title)}">Remove</button></div></div>`).join('')}</div>`:`<div class="grade-empty"><span class="grade-empty-icon">${ic('cap')}</span><h3>Your first score starts the picture.</h3><p>Add an assignment, project, quiz or test. You can leave the earned score blank until it is graded.</p><button class="btn primary" data-act="gradeAdd" data-cid="${esc(cid)}">Add a score</button></div>`}
  <div class="grade-analysis"><div><h3>By category</h3><p class="muted small">${g.weights?'Using your category weights':'Based on points earned out of points possible'}</p></div><div class="grade-analysis-grid">${GRADE_TYPES.map(t=>{const row=(a.byType||[]).find(r=>r.type===t);return `<div><span>${GRADE_NAMES[t]}</span><b>${gradeNumber(row&&row.averagePercent,'%')}</b></div>`}).join('')}</div></div>
  <div class="grade-final"><span><b>Final percentage</b><small>${g.finalPercent===null||g.finalPercent===undefined?'Not entered':'Manually entered final result'}</small></span><strong>${gradeNumber(g.finalPercent,'%')}</strong><button class="btn sm" data-act="gradeSettings" data-cid="${esc(cid)}">Edit</button></div>`;
}
function gradeBook(cid){const x=gradesEntry(cid);return x&&x.gradebook?clone(x.gradebook):{courseId:cid,credits:3,weights:null,items:[],finalPercent:null,version:0}}
async function saveGradeBook(g,form){
  if(GRADES.saving)return false;
  const code=billingUserCode();
  if(!code||GRADES.code!==code)return false;
  GRADES.saving=true;
  const button=form&&form.querySelector('[type="submit"]');if(button){button.disabled=true;button.textContent='Saving…'}
  try{
    const result=await gradesRequest('save',{gradebook:g});
    if(code!==billingUserCode()||GRADES.code!==code)return false;
    GRADES.data=result;GRADES.state='ready';closeModal();render();toast('Gradebook saved');return true;
  }catch(error){
    if(code!==billingUserCode()||GRADES.code!==code)return false;
    const conflict=error.status===409||error.code==='conflict'||error.code==='version_conflict';
    const detail=conflict?'This gradebook changed elsewhere. Refreshing the latest version; your entries remain in this form. Review them and save again.':error.message;
    const message=form&&form.querySelector('.grade-form-error');if(message){message.textContent=detail;message.hidden=false}else toast(detail);
    if(conflict)void loadGrades(true);
    if(error.status===403){GRADES.state='locked';void loadBillingStatus(true,billingUserCode());render()}
    return false;
  }finally{if(code===billingUserCode()&&GRADES.code===code)GRADES.saving=false;if(button&&button.isConnected){button.disabled=false;button.textContent='Save changes'}}
}
function gradeItemModal(cid,id,assignment){
  const g=gradeBook(cid),item=(g.items||[]).find(i=>i.id===id)||{title:assignment?.title||'',type:assignment?gradeAssignmentType(assignment.type):'assignment',earned:null,possible:assignment?'':100,date:assignment?.due||null};
  openModal(`<div class="spread"><div><p class="eyebrow">${esc((course(cid)||{}).code||'Course')}</p><h2>${id?'Edit score':'Add a score'}</h2></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
  <form data-form="gradeItem" data-cid="${esc(cid)}" data-id="${esc(id||'')}" data-assignment-id="${esc(item.assignmentId||assignment?.id||'')}" class="stack grade-form">
    <label class="f">Title<input class="in" name="title" required maxlength="160" value="${esc(item.title)}" placeholder="Essay 1" autofocus></label>
    <div class="grid2"><label class="f">Category<select class="in" name="type">${GRADE_TYPES.map(t=>`<option value="${t}" ${item.type===t?'selected':''}>${GRADE_SINGULAR[t]}</option>`).join('')}</select></label><label class="f">Date (optional)<input class="in" type="date" name="date" value="${esc(item.date||'')}"></label></div>
    <div class="grid2"><label class="f">Earned points (optional)<input class="in" name="earned" type="number" min="0" step="any" placeholder="Not graded yet" value="${item.earned===null?'':esc(item.earned)}"></label><label class="f">Possible points<input class="in" name="possible" type="number" min="0.01" step="any" required value="${esc(item.possible)}"></label></div>
    <p class="grade-form-error" role="alert" hidden></p><div class="row"><button class="btn primary" type="submit">Save changes</button><button class="btn" type="button" data-act="close">Cancel</button></div>
  </form>`);
}
function gradeAssignmentType(type){return ({homework:'assignment',exam:'test'})[String(type).toLowerCase()]||String(type).toLowerCase()}
ACT.gradeFromAssignment=async el=>{
  const assignment=S.assignments[el.dataset.id],c=assignment&&course(assignment.courseId);
  if(!assignment||!c||assignment.ex||c.ex||!GRADE_TYPES.includes(gradeAssignmentType(assignment.type)))return;
  if(gradesAccess()!=='allowed'){go({name:'course',id:c.id,tab:'grades'});return}
  // Refresh before resolving the link so a score saved on another device is edited, not duplicated.
  await loadGrades(true);
  if(GRADES.state!=='ready'||!S.assignments[assignment.id]||GRADES.code!==billingUserCode()){if(GRADES.error)toast(GRADES.error);return}
  const existing=gradeBook(c.id).items.find(i=>i.assignmentId===assignment.id);
  gradeItemModal(c.id,existing?.id,existing?null:assignment);
};
ACT.gradesRetry=()=>void loadGrades(true);
ACT.gradesBillingRetry=()=>void loadBillingStatus(true,billingUserCode());
ACT.gradeAdd=el=>gradeItemModal(el.dataset.cid);
ACT.gradeEdit=el=>gradeItemModal(el.dataset.cid,el.dataset.id);
ACT.gradeDelete=async el=>{
  if(!confirm('Remove this score from your gradebook?'))return;
  const g=gradeBook(el.dataset.cid);g.items=g.items.filter(i=>i.id!==el.dataset.id);
  await saveGradeBook(g);
};
ACT.gradeSettings=el=>{
  const cid=el.dataset.cid,g=gradeBook(cid);
  openModal(`<div class="spread"><div><p class="eyebrow">${esc((course(cid)||{}).code||'Course')}</p><h2>Grading setup</h2></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
  <form class="stack grade-form" data-form="gradeSettings" data-cid="${esc(cid)}"><p class="small muted">Use weights only if your syllabus specifies category percentages. Otherwise scores use total points.</p>
  <div class="grid2"><label class="f">Course credits<input class="in" name="credits" type="number" min="0.5" max="12" step="0.5" value="${esc(g.credits??3)}" required></label><label class="f">Final percentage (optional)<input class="in" name="finalPercent" type="number" min="0" max="100" step="any" placeholder="Not entered" value="${g.finalPercent===null?'':esc(g.finalPercent)}"></label></div>
  <label class="grade-weight-toggle"><input type="checkbox" name="useWeights" ${g.weights?'checked':''}> Use category weights</label>
  <div class="grade-weights" ${g.weights?'':'hidden'}><p class="small muted">Weights must total 100%.</p><div class="grid2">${GRADE_TYPES.map(t=>`<label class="f">${GRADE_NAMES[t]} %<input class="in" name="weight-${t}" type="number" min="0" max="100" step="any" value="${esc(g.weights&&g.weights[t]||0)}"></label>`).join('')}</div></div>
  <p class="grade-form-error" role="alert" hidden></p><div class="row"><button class="btn primary" type="submit">Save changes</button><button class="btn" type="button" data-act="close">Cancel</button></div></form>`);
};
document.addEventListener('change',e=>{
  if(e.target.name==='useWeights'){const wrapper=e.target.closest('form');wrapper.querySelector('.grade-weights').hidden=!e.target.checked}
});
document.addEventListener('submit',async e=>{
  const f=e.target.closest('[data-form="gradeItem"],[data-form="gradeSettings"]');if(!f)return;
  e.preventDefault();
  if(GRADES.saving)return;
  const data=new FormData(f),g=gradeBook(f.dataset.cid),err=f.querySelector('.grade-form-error');
  err.hidden=true;
  if(f.dataset.form==='gradeItem'){
    const title=String(data.get('title')||'').trim(),possible=Number(data.get('possible')),earnedRaw=String(data.get('earned')||'').trim(),earned=earnedRaw===''?null:Number(earnedRaw);
    if(!title||!Number.isFinite(possible)||possible<=0||earned!==null&&(!Number.isFinite(earned)||earned<0||earned>possible)){err.textContent='Enter a title, positive possible points and an earned score no higher than the possible points.';err.hidden=false;return}
    const id=f.dataset.id||uid(),items=g.items||[],item={id,title,type:String(data.get('type')),earned,possible,date:String(data.get('date')||'')||null};
    if(f.dataset.assignmentId)item.assignmentId=f.dataset.assignmentId;
    g.items=f.dataset.id?items.map(x=>x.id===id?item:x):[...items,item];
  }else{
    const credits=Number(data.get('credits')),finalRaw=String(data.get('finalPercent')||'').trim(),finalPercent=finalRaw===''?null:Number(finalRaw);
    if(!Number.isFinite(credits)||credits<=0||credits>12||finalPercent!==null&&(!Number.isFinite(finalPercent)||finalPercent<0||finalPercent>100)){err.textContent='Enter credits greater than zero and no more than 12, and a final percentage between 0 and 100.';err.hidden=false;return}
    let weights=null;
    if(data.get('useWeights')){
      weights=Object.fromEntries(GRADE_TYPES.map(t=>[t,Number(data.get('weight-'+t))]));
      if(Object.values(weights).some(n=>!Number.isFinite(n)||n<0||n>100)||Math.abs(Object.values(weights).reduce((a,b)=>a+b,0)-100)>0.001){err.textContent='Category weights must add up to exactly 100%.';err.hidden=false;return}
    }
    g.credits=credits;g.finalPercent=finalPercent;g.weights=weights;
  }
  await saveGradeBook(g,f);
});