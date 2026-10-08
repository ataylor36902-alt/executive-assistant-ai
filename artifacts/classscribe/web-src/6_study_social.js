/* ---------- STUDY: flashcards & practice tests ---------- */
let STUDY={key:null};
const COURSE_STUDY_ID='__course_study__';
function scopeLecs(v){return (v.lectureIds&&v.lectureIds.length?v.lectureIds.map(lecture).filter(Boolean):lecturesOf(v.courseId).filter(l=>!v.before||l.date<=v.before))}
function sourceNotesMaterial(cid,max=18000){
  const notes=sourceNotesOf(cid);
  if(!notes.length)return{text:'',totalCount:0,fullCount:0,excerptedCount:0,omittedCount:0,includedChars:0,omittedChars:0};
  const heads=notes.map(n=>`SOURCE NOTE — title: ${n.title||'Untitled source'}; type: ${n.sourceType}${n.sourceName?`; file name: ${n.sourceName}`:''}\n`);
  const marker='\n[Excerpted for AI context; full text remains in your private note.]';
  const separators=Math.max(0,notes.length-1)*2;
  const fixed=heads.reduce((sum,h)=>sum+h.length,0)+separators;
  const overhead=fixed+marker.length*notes.length;
  if(max<=overhead)return{text:'',totalCount:notes.length,fullCount:0,excerptedCount:0,omittedCount:notes.length,includedChars:0,omittedChars:notes.reduce((sum,n)=>sum+n.body.length,0)};
  let budget=max-overhead;
  const allocations=notes.map(()=>0),active=notes.map((_,i)=>i).filter(i=>notes[i].body.length>0);
  while(budget>0&&active.length){
    const share=Math.ceil(budget/active.length);let spent=0;
    for(const i of active){
      const add=Math.min(share,notes[i].body.length-allocations[i]);
      if(add>0){allocations[i]+=add;budget-=add;spent+=add}
    }
    const remaining=active.filter(i=>allocations[i]<notes[i].body.length);
    active.splice(0,active.length,...remaining);
    if(!spent)break;
  }
  let fullCount=0,excerptedCount=0,omittedCount=0,includedChars=0,omittedChars=0;
  const blocks=notes.map((n,i)=>{
    const allowance=allocations[i],body=n.body;
    if(!allowance){omittedCount++;omittedChars+=body.length;return heads[i]+'[No source text fit in this AI context.]'}
    if(allowance>=body.length){fullCount++;includedChars+=body.length;return heads[i]+body}
    excerptedCount++;const usable=Math.max(0,allowance-marker.length),separator=' … ';
    let excerpt=body.slice(0,usable);
    if(usable>separator.length+1){
      const start=Math.ceil((usable-separator.length)/2),end=usable-separator.length-start;
      excerpt=body.slice(0,start)+separator+body.slice(-end);
    }
    includedChars+=excerpt.length;omittedChars+=Math.max(0,body.length-excerpt.length);return heads[i]+excerpt+marker;
  });
  return{text:blocks.join('\n\n'),totalCount:notes.length,fullCount,excerptedCount,omittedCount,includedChars,omittedChars};
}
function sourceCoveragePrompt(info){
  if(!info.totalCount)return'';
  return`\n\nSOURCE COVERAGE NOTICE: ${info.totalCount} private source notes are available; ${info.fullCount} were included in full, ${info.excerptedCount} were excerpted, and ${info.omittedCount} had no text fit in this context. Treat excerpted or omitted sources as partial; do not imply complete coverage.`;
}
function sourceCoverageBlurb(cid){
  const count=cid==='all'||String(cid).startsWith('semester:')?askCourseIdsForScope(cid).reduce((n,id)=>n+sourceNotesOf(id).length,0):sourceNotesOf(cid).length;
  return count?`<p class="small muted source-coverage" role="note">AI source coverage: ${plural(count,'private source')} available. When combined course materials exceed the AI context limit, each source receives a fair excerpt; long sources or sources with no room may be partial or omitted. Check results against the full private notes.</p>`:'';
}
function studyMaterial(v,max=26000){
  const lecs=scopeLecs(v),lectureText=lecs.length?material(lecs,Math.max(1000,max-12000)):'';
  const docs=sourceNotesMaterial(v.courseId,Math.max(0,max-lectureText.length-300));
  return [lectureText,docs.text,sourceCoveragePrompt(docs)].filter(Boolean).join('\n\n')||'(No course material is available yet.)';
}
function defaultExamStudyId(exams){return exams.length?exams[0].id:COURSE_STUDY_ID}
function studyKey(v){return v.mode+'|'+(v.courseId||'')+'|'+(v.lectureIds||[]).join(',')+'|'+(v.before||'')+'|'+(v.weak?'w':'')+'|'+sourceNotesOf(v.courseId).map(n=>n.id+':'+n.updated).join(',')}
function studyLectureId(id,v){const allowed=new Set(scopeLecs(v).map(l=>l.id));return allowed.has(id)?id:null}
function practiceMisses(){
  return STUDY.qs.flatMap((q,i)=>{
    const a=STUDY.ans[i];if(a==null)return[];
    const missed=q.type==='mc'?a!==Number(q.answer):q.type==='short'&&a.graded===true&&!a.correct;
    return missed?[{concept:String(q.concept||q.q||'Practice question'),lectureId:q.lectureId,q:q.q}]:[];
  });
}
function practiceMissMarkup(){
  const misses=practiceMisses();if(!misses.length)return'';
  const grouped=new Map();misses.forEach(m=>{const key=m.concept.toLowerCase(),entry=grouped.get(key)||{...m,count:0};entry.count++;grouped.set(key,entry)});
  return `<section class="panel" aria-live="polite"><h3>Practice review · concepts to revisit</h3><p class="small muted">A learning summary from this practice set—not an official grade or an exam prediction.</p><div class="stack" style="gap:8px">${[...grouped.values()].map(m=>{const candidates=m.lectureId?[lecture(m.lectureId)].filter(Boolean):scopeLecs(S.view);const ref=conceptLectureRef(S.view.courseId,m.concept,candidates);return`<div><b>${esc(m.concept)}</b> <span class="small muted">· missed ${m.count} ${m.count===1?'question':'questions'}</span><p class="small" style="margin:3px 0">Try a fresh example using this idea, then explain why each step works.</p>${ref?citeChip(ref.id,ref.t):''}</div>`}).join('')}</div></section>`;
}
function conceptLectureRef(cid,concept,lecs){
  const toks=tokens(concept);let best=null,bestScore=0;
  (lecs||[]).filter(l=>l&&S.lectures[l.id]&&!l.ex&&l.courseId===cid).forEach(l=>{
    const a=l.analysis||{},related=[...(a.concepts||[]),...(a.emphasized||[]).map(x=>x.concept),...(a.quiz||[]).map(x=>x.concept),...(a.terms||[]).map(x=>x.term)].filter(Boolean);
    const direct=related.find(x=>String(x).toLowerCase().includes(String(concept).toLowerCase())||String(concept).toLowerCase().includes(String(x).toLowerCase()));
    const text=[l.title,a.summary||'',...(a.keyPoints||[]),...(a.terms||[]).map(x=>x.term+' '+x.def),...(a.emphasized||[]).map(x=>x.concept+' '+x.why),...(a.quiz||[]).map(x=>(x.concept||'')+' '+x.q)].join(' ');
    const analysisScore=scoreText(text,toks),seg=(l.segs||[]).map(g=>({t:g.t,score:scoreText(g.x,toks)})).sort((x,y)=>y.score-x.score)[0],score=(direct?10:0)+analysisScore+(seg?seg.score:0);
    if(score>bestScore){bestScore=score;let t=direct?findT(l,concept):seg&&seg.score?seg.t:findT(l,concept);if(direct){const item=[...(a.emphasized||[]),...(a.quiz||[]),...(a.terms||[])].find(x=>String(x.concept||x.term||'').toLowerCase().includes(String(concept).toLowerCase())||String(concept).toLowerCase().includes(String(x.concept||x.term||'').toLowerCase()));if(item&&Number.isFinite(+item.t))t=item.t}best={id:l.id,t:Math.max(0,Math.round(+t||0))}}
  });
  return bestScore?best:null;
}
function weakStudyRecommendations(cid,lecs){
  return weakList(cid).slice(0,6).map(w=>{
    const ref=conceptLectureRef(cid,w.concept,lecs);
    return`- **${w.concept}** — Missed ${w.w} of ${w.w+w.r} recorded practice checks. Rework one new example and explain each step aloud.${ref?` [[${ref.id}@${ref.t}]]`:''}`;
  });
}
function ensureStudy(v){
  const k=studyKey(v);if(STUDY.key===k)return;
  const lecs=scopeLecs(v);
  const cards=[];lecs.forEach(l=>((l.analysis&&l.analysis.terms)||[]).forEach(t=>cards.push({front:t.term,back:t.def,concept:t.term,lid:l.id,t:t.t})));
  let qs=[];lecs.forEach(l=>((l.analysis&&l.analysis.quiz)||[]).forEach(q=>qs.push({type:'mc',...q,lectureId:l.id,_practiceRecordId:uid()})));
  if(v.weak){const w=new Set(weakList(v.courseId).map(x=>x.concept.toLowerCase()));const f=cards.filter(c=>w.has(c.concept.toLowerCase()));if(f.length)cards.splice(0,cards.length,...f)}
  STUDY={key:k,cards,i:0,flip:false,got:0,miss:0,qs,ans:{},gen:false};
}
VIEWS.study=v=>{
  if(examFeatureState('studyTools')!=='allowed')return`<div class="page-h"><div><p class="eyebrow">Study tools</p><h1>${v.mode==='cards'?'Flashcards':'Practice test'}</h1><p class="sub">Generated exam tools are available with a verified Student or Pro plan.</p></div></div>${examAccessNotice('studyTools')}`;
  ensureStudy(v);const c=course(v.courseId)||{};const lecs=scopeLecs(v);
  const sources=sourceNotesOf(v.courseId);
  const scopeLbl=v.lectureIds&&v.lectureIds.length===1?`“${(lecture(v.lectureIds[0])||{}).title}”`:`${c.code||''} · ${plural(lecs.length,'lecture')}${sources.length?` · ${plural(sources.length,'private source')}`:''}`;
  const back=v.lectureIds&&v.lectureIds.length===1?goAttr({name:'lecture',id:v.lectureIds[0],tab:'study'}):goAttr({name:'exam',courseId:v.courseId,examId:v.examId});
   const head=`<button class="btn ghost sm" ${back} style="margin-bottom:10px">${ic('back')}Back</button>
    <div class="page-h"><div><p class="eyebrow">${v.mode==='cards'?'Flashcards':'Practice test'} · ${esc(scopeLbl)}</p><h1>${v.mode==='cards'?'Flashcards':'Practice test'}</h1>${v.mode==='cards'?'':`<p class="sub">Answer first; your study companion shows whether you were right and reveals the correct answer.</p>`}</div>
     <div class="row"><button class="btn" data-act="${v.mode==='cards'?'genCards':'genTest'}" ${STUDY.gen?'disabled':''}>${STUDY.gen?thinking+' Generating':ic('spark')+(v.mode==='cards'?(STUDY.cards.length?'Generate more cards':'Generate cards from material'):'Generate a new practice exam')}</button></div></div>${sourceCoverageBlurb(v.courseId)}`;
  if(v.mode==='cards'){
    const d=STUDY.cards;if(!d.length)return head+`<div class="empty">${lecs.length||sources.length?'No cards yet. Generate cards from this course’s material.':'No course material yet. Import a private source in Notes or analyze a lecture first.'}</div>`;
    if(STUDY.i>=d.length)return head+`<div class="panel" style="text-align:center;max-width:560px;margin-inline:auto"><h2>Deck complete</h2><p class="muted" style="margin:8px 0 16px">You knew ${STUDY.got} of ${d.length}. ${STUDY.miss?`${plural(STUDY.miss,'card')} went to your weak areas.`:''}</p><div class="row" style="justify-content:center"><button class="btn primary" data-act="cardsRestart">Study again</button>${STUDY.miss?`<button class="btn" data-act="cardsMissed">Review missed only</button>`:''}</div></div>`;
    const cd=d[STUDY.i];
    return head+`<div class="stack" style="align-items:center"><div class="row small muted" style="width:100%;max-width:560px;justify-content:space-between"><span>Card ${STUDY.i+1} of ${d.length}</span><span>✓ ${STUDY.got} · ✗ ${STUDY.miss}</span></div>
    <div class="bar" style="width:100%;max-width:560px"><i style="width:${Math.round(STUDY.i/d.length*100)}%"></i></div>
    <div class="fc-wrap"><button class="fc ${STUDY.flip?'flip':''}" data-act="cardFlip" aria-label="Flip card"><div class="face"><span class="eyebrow">Term</span><b>${esc(cd.front)}</b><span class="small muted">Tap to reveal</span></div><div class="face back"><span class="eyebrow">Definition</span><p style="font-size:1.1rem">${esc(cd.back)}</p>${cd.lid&&cd.t!=null?citeChip(cd.lid,cd.t):''}</div></button></div>
    <div class="row" style="justify-content:center"><button class="btn" data-act="cardAns" data-ok="0" style="color:var(--rec)">${ic('x')}Missed it</button><button class="btn primary" data-act="cardAns" data-ok="1">${ic('check')}Got it</button><button class="btn ghost" data-act="cardShuffle">Shuffle</button></div></div>`;
  }
  const qs=STUDY.qs;
  if(!qs.length)return head+`<div class="empty">${lecs.length||sources.length?`No practice questions yet. Generate a practice exam from ${esc(scopeLbl)}.`:'No course material yet. Import a private source in Notes or analyze a lecture first.'}</div>`;
  const mc=qs.filter(q=>q.type==='mc');const done=mc.filter((q,i)=>STUDY.ans[qs.indexOf(q)]!=null);const right=done.filter(q=>STUDY.ans[qs.indexOf(q)]===Number(q.answer)).length;
  return head+`<div class="stat-row" style="margin-bottom:16px"><div class="stat"><b>${right}/${done.length}</b><span>Correct so far</span></div><div class="stat"><b>${qs.length}</b><span>Questions</span></div><div class="stat"><b>${mc.length?Math.round(done.length/mc.length*100):0}%</b><span>Multiple choice done</span></div></div>
  <div class="stack">${practiceMissMarkup()}${qs.map((q,i)=>qHTML(q,i)).join('')}</div>`;
};
function qHTML(q,i){
  const a=STUDY.ans[i];const cite=q.lectureId&&q.t!=null?citeChip(q.lectureId,q.t):'';
    if(q.type==='mc')return `<div class="q"><div class="spread"><b>${i+1}. ${esc(q.q)}</b><span class="chip">${esc(q.concept||'')}</span></div><div class="stack" style="gap:6px">${(q.choices||[]).map((c,j)=>`<button class="choice ${a!=null?(j===Number(q.answer)?'right':j===a?'wrong':''):''}" data-act="mcAns" data-q="${i}" data-c="${j}" ${a!=null?'disabled':''}><span class="k">${'ABCD'[j]}</span><span>${esc(c)}</span></button>`).join('')}</div>${a!=null?`<div class="practice-feedback">${tutorPortrait()}<div><span class="ask-answer-source">ClassScribe study companion</span><p class="small">${a===Number(q.answer)?'<b style="color:var(--good)">Correct.</b>':'<b style="color:var(--rec)">Incorrect.</b>'} ${esc(q.explain||'')}</p><p class="small"><b>Correct answer:</b> ${esc((q.choices||[])[Number(q.answer)]||'')} ${cite}</p></div></div>`:''}</div>`;
    if(q.type==='short')return `<div class="q"><div class="spread"><b>${i+1}. ${esc(q.q)}</b><span class="chip">Short answer</span></div><textarea class="in" id="sa-${i}" rows="3" placeholder="Your answer" ${a&&a.graded?'readonly':''}>${esc((a&&a.text)||'')}</textarea><div class="row"><button class="btn sm primary" data-act="saCheck" data-q="${i}" ${a&&(a.busy||a.graded)?'disabled':''}>${a&&a.busy?thinking:a&&a.graded?'Checked':'Check answer'}</button></div>${a&&a.feedback?`<div class="practice-feedback">${tutorPortrait()}<div><span class="ask-answer-source">ClassScribe study companion</span><p class="small">${!a.graded?'<b>Not graded.</b>':a.correct?'<b style="color:var(--good)">Correct.</b>':'<b style="color:var(--rec)">Incorrect.</b>'} ${esc(a.feedback)}</p>${a.graded?`<p class="small"><b>Correct answer:</b> ${esc(q.answer)} ${cite}</p>`:''}</div></div>`:''}</div>`;
  return `<div class="q"><div class="spread"><b>${i+1}. ${esc(q.q)}</b><span class="chip">Essay</span></div>${a?`<div class="small"><b>Strong answers would cover:</b><ul>${(q.outline||[]).map(o=>`<li>${esc(o)}</li>`).join('')}</ul></div>`:`<button class="btn sm" data-act="essayShow" data-q="${i}" style="align-self:flex-start">Show what a strong answer covers</button>`}</div>`;
}
ACT.cardFlip=()=>{STUDY.flip=!STUDY.flip;$('.fc').classList.toggle('flip',STUDY.flip)};
ACT.cardAns=el=>{const v=S.view;const cd=STUDY.cards[STUDY.i];const ok=el.dataset.ok==='1';ok?STUDY.got++:STUDY.miss++;cd.missed=!ok;record(v.courseId||(lecture(cd.lid)||{}).courseId,cd.concept,ok);STUDY.i++;STUDY.flip=false;if(STUDY.i>=STUDY.cards.length)markReviewed(scopeLecs(v).map(l=>l.id));render()};
ACT.cardsRestart=()=>{Object.assign(STUDY,{i:0,got:0,miss:0,flip:false});render()};
ACT.cardsMissed=()=>{STUDY.cards=STUDY.cards.filter(c=>c.missed);Object.assign(STUDY,{i:0,got:0,miss:0,flip:false});render()};
ACT.cardShuffle=()=>{const d=STUDY.cards.slice(STUDY.i);for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]]}STUDY.cards.splice(STUDY.i,d.length,...d);STUDY.flip=false;render()};
ACT.mcAns=el=>{const i=+el.dataset.q,j=+el.dataset.c;const q=STUDY.qs[i];if(STUDY.ans[i]!=null)return;const answer=Number(q.answer),choices=q.choices||[];if(!Number.isInteger(answer)||answer<0||answer>=choices.length){toast('This practice question has an invalid answer key and can’t be scored. Generate a new practice exam.');return}STUDY.ans[i]=j;const cid=S.view.courseId||(lecture(q.lectureId)||{}).courseId,correct=j===answer;record(cid,q.concept||q.q,correct,q._practiceRecordId,{kind:'practice test',question:q.q,result:correct?'correct':'missed'});if(q.lectureId)markReviewed([q.lectureId]);render()};
ACT.essayShow=el=>{STUDY.ans[+el.dataset.q]=true;render()};
ACT.saCheck=async el=>{
  const i=+el.dataset.q;const q=STUDY.qs[i];if(STUDY.ans[i]&&(STUDY.ans[i].busy||STUDY.ans[i].graded))return;const text=$('#sa-'+i).value.trim();if(!text){toast('Write an answer first.');return}
  const cid=S.view.courseId||(lecture(q.lectureId)||{}).courseId,recordId=q._practiceRecordId,studyKey=STUDY.key;
  const isCurrentQuestion=()=>STUDY.key===studyKey&&STUDY.qs[i]===q&&q._practiceRecordId===recordId;
  const isCurrentAnswer=()=>isCurrentQuestion()&&STUDY.ans[i]&&STUDY.ans[i].busy&&STUDY.ans[i].text===text;
  STUDY.ans[i]={text,busy:true};render();
  try{const r=await CS_STUDY('grade',{question:q.q,answer:q.answer,response:text});if(typeof r.correct!=='boolean')throw new Error('The answer grader returned an invalid result. Try again.');if(!isCurrentAnswer())return;const correct=r.correct;record(cid,q.concept||q.q,correct,recordId,{kind:'practice test',question:q.q,result:correct?'correct':'missed'});STUDY.ans[i]={text,correct,graded:true,feedback:r.feedback||''}}
  catch(e){if(!isCurrentAnswer())return;STUDY.ans[i]={text,feedback:'Could not grade this response. Compare it with the cited course material, then try again.'};aiErr(e)}
  if(isCurrentQuestion()&&S.view.name==='study')render();
};
ACT.genCards=async()=>{
  const v=S.view;STUDY.gen=true;render();
  try{const r=await CS_STUDY('cards',{material:studyMaterial(v),focus:v.weak?weakList(v.courseId).map(w=>w.concept).join(', ').slice(0,1000):'',avoid:STUDY.cards.map(c=>c.front).join('; ').slice(0,2000)});
     const add=(r.cards||[]).filter(c=>c.front&&c.back).map(c=>({front:c.front,back:c.back,concept:c.concept||c.front,lid:studyLectureId(c.lectureId,v),t:c.t}));
    STUDY.cards.splice(STUDY.i,0,...add);toast(`Added ${plural(add.length,'card')}`);
  }catch(e){aiErr(e)}
  STUDY.gen=false;render();
};
ACT.genTest=async()=>{
  const v=S.view;STUDY.gen=true;render();const weak=weakList(v.courseId).slice(0,6).map(w=>w.concept);
  try{const r=await CS_STUDY('quiz',{material:studyMaterial(v),focus:weak.join(', ').slice(0,1000)});
     STUDY.qs=(r.questions||[]).filter(q=>q&&q.q).map(q=>({...q,lectureId:studyLectureId(q.lectureId,v),_practiceRecordId:uid()}));STUDY.ans={};
  }catch(e){aiErr(e)}
  STUDY.gen=false;render();
};

/* ---------- EXAM CENTER ---------- */
function findT(l,concept){const a=l.analysis||{};const e=(a.emphasized||[]).find(x=>x.concept.toLowerCase().includes(concept.toLowerCase().split(' ')[0]));if(e)return e.t;const w=concept.toLowerCase().split(/\s+/).find(x=>x.length>3)||concept.toLowerCase();const g=(l.segs||[]).find(s=>s.x.toLowerCase().includes(w.slice(0,Math.max(4,w.length-2))));return g?g.t:0}
function topicCounts(lecs){const m={};lecs.forEach(l=>{const a=l.analysis;if(!a)return;const seen=new Set();(a.concepts||[]).forEach(cn=>{const k=cn.trim().toLowerCase();if(!k||seen.has(k))return;seen.add(k);(m[k]=m[k]||{name:cn.trim(),refs:[]}).refs.push({id:l.id,t:findT(l,cn)})})});return Object.values(m).sort((a,b)=>b.refs.length-a.refs.length)}
VIEWS.exam=v=>{
  if(v.examId==='finals'&&examFeatureState('finals')!=='allowed')return`<div class="page-h"><div><p class="eyebrow">Exam Center</p><h1>Finals Mode</h1><p class="sub">Whole-semester review is a Pro feature.</p></div></div>${examAccessNotice('finals')}<button class="btn ghost sm" ${goAttr({name:'exam',courseId:v.courseId,examId:undefined})}>${ic('back')}Back to exam review</button>`;
  const cs=coursesSorted();if(!cs.length)return `<div class="page-h"><div><p class="eyebrow">Study tools</p><h1>Exam Center</h1><p class="sub">Study guides, flashcards, and quizzes use your course material.</p></div></div><section class="panel stack" style="max-width:640px"><p>Add a course, then import a private source in its Notes tab or analyze a lecture. Hidden example courses do not count as your own course.</p><div><button class="btn primary" data-act="addCourse">Add a course</button></div></section>`;
  let cid=v.courseId;if(!cid||!course(cid)){const nx=upcoming(60,new Set(cs.map(c=>c.id))).find(a=>a.type==='exam'||a.type==='quiz');cid=nx?nx.courseId:cs[0].id;v.courseId=cid;if(!v.examId&&nx)v.examId=nx.id}
  const c=course(cid);const exams=assignOf(cid).filter(a=>(a.type==='exam'||a.type==='quiz')&&a.due&&daysUntil(a.due)>=0);
   if(v.examId===undefined)v.examId=defaultExamStudyId(exams);
  const ex=allA()[v.examId];const before=ex?ex.due:null;
  const lecs=lecturesOf(cid).filter(l=>!before||l.date<=before);const an=lecs.filter(l=>l.analysis);
  const mins=Math.round(lecs.reduce((s,l)=>s+(l.duration||0),0)/60);
  const terms=an.reduce((s,l)=>s+(l.analysis.terms||[]).length,0);const emph=an.reduce((s,l)=>s+(l.analysis.emphasized||[]).length,0);
  const forms=an.reduce((s,l)=>s+(l.analysis.examples||[]).filter(x=>/formula|process/.test(x.kind)).length,0);
  const topics=topicCounts(an);const weak=weakList(cid);const maxT=Math.max(1,...topics.map(t=>t.refs.length));const sourceNotes=sourceNotesOf(cid);
   const courseStudy=v.examId===COURSE_STUDY_ID;const studyTitle=courseStudy?'Course study':ex?ex.title:'Finals Mode';
    const gKey=v.examId||'finals';const premiumState=examFeatureState('studyTools');const canStudy=premiumState==='allowed';const billing=currentBillingStatus();const canGuide=canStudy||!!(billing&&String(billing.plan||'').toLowerCase()==='free');const guide=canGuide?(c.guides||{})[gKey]:null;
   const guideCard=`<button class="course-card" style="--cc:var(--accent)" data-act="genGuide" data-key="${esc(gKey)}" ${S.busy.guide?'disabled':''}><span style="width:24px;color:var(--accent)">${ic('book')}</span><h3>${guide?'Regenerate study guide':'Generate study guide'}</h3><p class="small muted">${canStudy?'A private guide with citations to lectures and imported sources.':'Available on Free after you review and confirm the one-time credit quote.'}</p></button>`;
  const scope={courseId:cid,before:before||undefined,examId:v.examId};
   return `<div class="page-h"><div><p class="eyebrow">${courseStudy?'Course study':'Exam Center'}</p><h1>${esc(c.code)} — ${esc(studyTitle)}</h1><p class="sub">${ex?`${fmtLong(ex.due)} · ${relDue(ex.due)}`:courseStudy?'Study all available material for this course.':'Everything from the whole semester, combined into one review.'}</p>${sourceCoverageBlurb(cid)}</div>
    <div class="row">${cs.length>1?`<select class="in" id="exam-course" style="width:auto" aria-label="Course">${cs.map(x=>`<option value="${esc(x.id)}" ${x.id===cid?'selected':''}>${esc(x.code)}</option>`).join('')}</select>`:''}</div></div>
   <div class="row" style="margin-bottom:18px"><button class="btn sm ${courseStudy?'primary':''}" ${goAttr({name:'exam',courseId:cid,examId:COURSE_STUDY_ID})}>Course study · all material</button>${exams.map(a=>`<button class="btn sm ${a.id===v.examId?'primary':''}" ${goAttr({name:'exam',courseId:cid,examId:a.id})}>${esc(a.title)} · ${fmtD(a.due)}</button>`).join('')}${examFeatureState('finals')==='allowed'?`<button class="btn sm ${v.examId==='finals'?'primary':''}" ${goAttr({name:'exam',courseId:cid,examId:'finals'})}>Finals Mode · whole semester</button>`:`<button class="btn sm" ${goAttr({name:'plans'})}>Finals Mode · Pro</button>`}</div>
  <div class="stat-row"><div class="stat"><b>${an.length}<span style="font-size:1rem;color:var(--muted)">/${lecs.length}</span></b><span>Lectures analyzed</span></div><div class="stat"><b>${mins}</b><span>Minutes of lecture</span></div><div class="stat"><b>${topics.length}</b><span>Core concepts</span></div><div class="stat"><b>${terms}</b><span>Definitions</span></div><div class="stat"><b>${forms}</b><span>Formulas & processes</span></div><div class="stat"><b>${emph}</b><span>Professor-emphasized points</span></div></div>
   <p class="small muted" style="margin:10px 0 22px">${courseStudy?'Review your course material without selecting a specific exam.':'ClassScribe can’t know what will be on your exam. These are the topics that got the most attention in your course materials.'} ${sourceNotes.length?`${plural(sourceNotes.length,'private source')} are available to generated study tools.`:''}</p>
   ${canStudy?`<div class="grid3" style="margin-bottom:22px">
     ${guideCard}
    <button class="course-card" style="--cc:var(--c2)" ${goAttr({name:'study',mode:'cards',...scope})}><span style="width:24px;color:var(--c2)">${ic('cards')}</span><h3>Flashcards</h3><p class="small muted">${plural(terms,'card')} ready from lectures${sourceNotes.length?` · ${plural(sourceNotes.length,'private source')} available to generate from`:''}.</p></button>
    <button class="course-card" style="--cc:var(--c3)" ${goAttr({name:'study',mode:'test',...scope})}><span style="width:24px;color:var(--c3)">${ic('file')}</span><h3>Take a practice exam</h3><p class="small muted">Multiple choice, short answer and essay.</p></button>
     <button class="course-card" style="--cc:var(--c4)" ${goAttr({name:'tutor',courseId:cid,before:before||null,mode:weak.length&&examFeatureState('advancedTutor')==='allowed'?'weak':'quiz'})}><img class="companion-card-avatar" src="/terence-tao-avatar.png" alt=""><h3>Study companion · ${weak.length&&examFeatureState('advancedTutor')==='allowed'?'Quiz weak areas':'Quiz me'}</h3><p class="small muted">Answer one question at a time. See whether you’re right and learn the correct answer.</p><small class="muted">Illustrated tribute to Dr. Terence Tao · ClassScribe AI, not Dr. Tao.</small></button>
   </div>`:`${canGuide?`<div class="grid3" style="margin-bottom:22px">${guideCard}</div>`:''}${examAccessNotice('studyTools')}`}
  <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));align-items:start">
    <section class="panel"><h3>Frequently emphasized topics</h3><p class="small muted" style="margin:2px 0 10px">How many lectures each topic came up in. Tap a lecture to jump to that moment.</p>
      <div class="stack" style="gap:12px">${topics.slice(0,8).map(t=>`<div><div class="row" style="gap:10px;flex-wrap:nowrap"><b style="flex:1;min-width:0">${esc(t.name)}</b><div class="bar ${t.refs.length===maxT?'hi':''}" style="max-width:140px"><i style="width:${t.refs.length/maxT*100}%"></i></div><span class="small muted mono" style="width:92px;text-align:right;white-space:nowrap">${plural(t.refs.length,'lecture')}</span></div><div class="row" style="gap:4px;margin-top:4px">${t.refs.map(r=>citeChip(r.id,r.t)).join('')}<button class="btn ghost sm" data-act="explainTopic" data-topic="${esc(t.name)}" data-cid="${esc(cid)}">${ic('bulb')}Explain</button></div></div>`).join('')||'<p class="muted small">Analyze lectures to see topics.</p>'}</div></section>
    <section class="panel"><h3>Weak areas</h3><p class="small muted" style="margin:2px 0 10px">Concepts you’ve missed in flashcards, quizzes and practice tests.</p>
      <div class="stack" style="gap:10px">${weak.slice(0,8).map(w=>`<div class="row" style="gap:10px;flex-wrap:nowrap"><span style="flex:1;min-width:0">${esc(w.concept)}</span><div class="bar bad" style="max-width:120px"><i style="width:${Math.round(w.w/(w.w+w.r)*100)}%"></i></div><span class="small muted" style="width:108px;text-align:right;white-space:nowrap">missed ${w.w} of ${w.w+w.r}</span></div>`).join('')||'<p class="muted small">No weak spots yet. Take a practice exam or flashcards to find them.</p>'}</div>
      ${weak.length?`<button class="btn sm" style="margin-top:14px" ${goAttr({name:'study',mode:'cards',...scope,weak:true})}>${ic('cards')}Flashcards for weak areas</button>`:''}</section>
  </div>
   ${canGuide?`<section class="panel" style="margin-top:14px" id="guide"><div class="spread"><h3>Private study guide</h3>${guide?`<div class="row"><span class="small muted">${guide.ai===false?'Built from your course notes':'Written with AI'} · ${new Date(guide.at).toLocaleDateString()}</span><button class="btn sm" data-act="guideExport" data-key="${esc(gKey)}">${ic('download')}Export</button><button class="btn sm" data-act="guideCopy" data-key="${esc(gKey)}">Copy</button></div>`:''}</div><p class="small muted">Saved only in your private library; not shared with classmates.</p>
    <div class="md" id="guide-out" style="margin-top:10px">${S.busy.guide?'<p class="small muted">Writing your study guide… this can take up to a minute.</p>'+thinking:guide?md(guide.text):`<div class="row"><p class="muted small" style="flex:1">No study guide yet for this exam.</p><button class="btn primary sm" data-act="genGuide" data-key="${esc(gKey)}">${ic('book')}Generate study guide</button></div>`}</div></section>`:''}`;
};
ACT.examBillingRetry=async()=>{await loadBillingStatus(true,billingUserCode());render()};
ACT.explainTopic=el=>{const cid=el.dataset.cid,t=el.dataset.topic;const lecs=lecturesOf(cid).filter(l=>l.analysis&&(l.analysis.concepts||[]).some(x=>x.toLowerCase()===t.toLowerCase()));openExplain(t,'',material(lecs,9000),cid)};
function localGuide(c,ex,lecs,courseStudy=false){
  const an=lecs.filter(l=>l.analysis);const A=l=>l.analysis;
  const sources=sourceNotesOf(c.id);
  const topics=topicCounts(an);const days=ex?Math.max(1,daysUntil(ex.due)):14;
  let t=`## Big picture\n`;
  an.forEach(l=>{t+=`- **${fmtD(l.date)} · ${l.title}:** ${A(l).summary} [[${l.id}@0]]\n`});
  if(!an.length&&sources.length)t+=`- Review the ${plural(sources.length,'private source')} imported for this course.\n`;
  t+=`\n## Core concepts\n`;
  topics.slice(0,10).forEach(tp=>{t+=`- **${tp.name}** — came up in ${plural(tp.refs.length,'lecture')} ${tp.refs.map(r=>`[[${r.id}@${r.t}]]`).join(' ')}\n`});
  t+=`\n## Must-know definitions\n`;
  an.forEach(l=>(A(l).terms||[]).forEach(x=>{t+=`- **${x.term}:** ${x.def} [[${l.id}@${x.t||0}]]\n`}));
  const fx=[];an.forEach(l=>(A(l).examples||[]).filter(x=>/formula|process/.test(x.kind)).forEach(x=>fx.push(`- ${x.text} [[${l.id}@${x.t||0}]]`)));
  if(fx.length)t+=`\n## Formulas & processes\n${fx.join('\n')}\n`;
  const em=[];an.forEach(l=>(A(l).emphasized||[]).forEach(x=>em.push(`- **${x.concept}** — ${x.why} [[${l.id}@${x.t||0}]]`)));
  if(em.length)t+=`\n## What the professor emphasized\n${em.join('\n')}\n`;
  if(sources.length)t+=`\n## Imported course sources\n${sources.map(n=>`### ${n.title||'Untitled source'} · ${n.sourceType}${n.sourceName?' · '+n.sourceName:''}\n[Source: ${n.title||'Untitled source'}]\n${n.body}`).join('\n\n')}\n`;
  const weak=weakList(c.id);if(weak.length)t+=`\n## Your weak areas\n${weak.slice(0,6).map(w=>`- ${w.concept} (missed ${w.w} of ${w.w+w.r})`).join('\n')}\n`;
  const recs=weakStudyRecommendations(c.id,lecs);if(recs.length)t+=`\n## Practice review & application\nThese are learning signals from your practice history, not official grades or exam predictions. For each concept, work through a fresh example and explain why each step applies.\n${recs.join('\n')}\n`;
  const qs=[];an.forEach(l=>(A(l).quiz||[]).forEach(q=>qs.push(q.q)));an.forEach(l=>(A(l).emphasized||[]).forEach(x=>qs.push(`Explain: ${x.concept}.`)));
  if(qs.length)t+=`\n## Practice prompts\n${qs.slice(0,6).map((q,i)=>`${i+1}. ${q}`).join('\n')}\n`;
  t+=`\n## Review plan (${plural(days,'day')})\n`;
  const per=Math.max(1,Math.ceil(an.length/Math.max(1,days-2)));let d=1;
  for(let i=0;i<an.length;i+=per){t+=`- **Day ${d++}:** review ${an.slice(i,i+per).map(l=>l.title).join(' + ')}, then its flashcards\n`;if(d>days-1)break}
  t+=courseStudy?`- **Day ${Math.max(d,days)}:** revisit your private course sources, flashcards and weak areas\n`:`- **Day ${Math.max(d,days)}:** take a practice exam, then quiz yourself on weak areas\n`;
  const notAn=lecs.length-an.length;if(notAn)t+=`\n*${plural(notAn,'lecture')} not analyzed yet, so ${notAn===1?'it isn’t':'they aren’t'} included. Analyze ${notAn===1?'it':'them'} to add ${notAn===1?'it':'them'} here.*\n`;
  return t;
}
ACT.genGuide=async el=>{
  const v=S.view;const cid=v.courseId;const c=course(cid);const ex=allA()[v.examId];const lecs=lecturesOf(cid).filter(l=>!ex||l.date<=ex.due);
  const courseStudy=v.examId===COURSE_STUDY_ID,guideContext=ex?`${ex.title} on ${ex.due}`:courseStudy?'the whole course':'the final exam, whole semester';
  const guideType=courseStudy?'private course study guide':'private exam study guide';
  const sourceNotes=sourceNotesOf(cid);
  if(!lecs.length&&!sourceNotes.length){toast('Import a private source in Notes or record a lecture first.');return}
  if(lecs.length&&!lecs.some(l=>l.analysis)&&!sourceNotes.length){toast('Analyze at least one lecture or import a private source first.');return}
  const key=el.dataset.key;const save=(text,ai)=>put('courses',{...(course(cid)||c),guides:{...((course(cid)||c).guides||{}),[key]:{text,at:Date.now(),ai}}});
  const show=()=>{const g=$('#guide');if(g)g.scrollIntoView({block:'start',behavior:'smooth'})};
  S.busy.guide=true;render();show();
  const s=S.ai!==undefined?S.ai:await AI();
  if(!s){save(localGuide(c,ex,lecs,courseStudy),false);S.busy.guide=false;render();show();toast('Study guide ready');return}
  let text='';
  try{
      const payload={material:studyMaterial({courseId:cid,before:ex?ex.due:undefined},40000)+(()=>{const ns=notesOf(cid).filter(n=>!n.lectureId&&!n.sourceType&&n.body);return ns.length?'\n\nSTUDENT NOTES:\n'+ns.map(n=>`## ${n.title}\n${n.body}`).join('\n').slice(0,8000):''})(),focus:`${c.code} ${c.name}: ${guideContext}`.slice(0,1000),days:ex?Math.min(60,Math.max(1,daysUntil(ex.due))):14};
      const r=await creditActionPost('/api/ai/study/guide',payload,'generate this study guide');
     const recs=weakStudyRecommendations(cid,lecs),guideText=r.text.trim()+(recs.length?`\n\n## Practice review & application\nThese recommendations use your saved practice history as a learning signal, not as an official grade or an exam prediction. Work through a fresh example and explain why each step applies.\n${recs.join('\n')}\n`:'' );save(guideText,true);toast('Study guide ready');
   }catch(e){
      if(e&&(e.code==='paid_required'||e.code==='not_granted')){aiErr(e);S.busy.guide=false;render();return}
      if(e&&(e.code==='credits_cancelled'||e.code==='insufficient_credits')){S.busy.guide=false;render();return}
     if(e&&e.code==='rate_limited')aiErr(e);
      save(localGuide(c,ex,lecs,courseStudy),false);toast('AI wasn’t available, so ClassScribe built the guide from your course notes.');
  }
  S.busy.guide=false;render();show();
};
ACT.guideExport=el=>{const c=course(S.view.courseId);const g=c.guides[el.dataset.key];const name=`${c.code} study guide`;download(name+'.doc',asDoc(name,g.text.replace(/\[\[[\w-]+@[\d.]+\]\]/g,'')))};
ACT.guideCopy=el=>{const c=course(S.view.courseId);copyText(c.guides[el.dataset.key].text.replace(/\[\[[\w-]+@[\d.]+\]\]/g,''))};

/* ---------- ASK CLASSSCRIBE (Class Memory) ---------- */
const CHAT={turns:[],busy:false,scope:'all',ab:null,epoch:0,context:null,retrieval:'semantic',coverage:''};
let ASK_DRAFT='',ASK_ERROR='';
function askSemesterKey(value){return String(value||'Courses').trim().replace(/\s+/g,' ').toLocaleLowerCase()}
function askOwnedCourses(){return Object.values(S.courses).filter(c=>c&&!c.ex)}
function askCourseIdsForScope(scope,requested){
  const own=askOwnedCourses();
  let semester='';
  if(scope.startsWith('semester:')){try{semester=decodeURIComponent(scope.slice(9))}catch{return[]}}
  let scoped=scope==='all'?own:scope.startsWith('semester:')?own.filter(c=>askSemesterKey(c.semester)===askSemesterKey(semester)):own.filter(c=>c.id===scope);
  if(requested)scoped=scoped.filter(c=>c.id===requested);
  return scoped.map(c=>c.id);
}
function askCitationIsValid(token,scope){
  const ids=new Set(askCourseIdsForScope(scope));
  let m=String(token||'').match(/^([\w-]+)@(\d+(?:\.\d+)?)$/);
  if(m){
    const l=S.lectures[m[1]];if(!l||!ids.has(l.courseId)||l.ex)return false;
    const second=Math.round(+m[2]);return(l.segs||[]).some(g=>g.t!==null&&g.t!==undefined&&g.t!==''&&Number.isFinite(Number(g.t))&&Number(g.t)>=0&&Math.round(Number(g.t))===second)||(l.slides||[]).some(sl=>sl.t!==null&&sl.t!==undefined&&sl.t!==''&&Number.isFinite(Number(sl.t))&&Number(sl.t)>=0&&Math.round(Number(sl.t))===second)
  }
  m=String(token||'').match(/^NOTE:([\w-]+)$/);
  if(m){const n=S.notes[m[1]],c=n&&S.courses[n.courseId];return!!(n&&n.body&&!n.ex&&c&&!c.ex&&ids.has(n.courseId))}
  m=String(token||'').match(/^ASSIGNMENT:([\w-]+)$/);
  if(m){const a=S.assignments[m[1]],c=a&&S.courses[a.courseId];return!!(a&&!a.ex&&c&&!c.ex&&ids.has(a.courseId))}
  return false
}
function askVerifiedAnswer(text,scope){
  let rejected=false;
  const safe=String(text||'').replace(/\[\[([^\]]+)\]\]/g,(_,token)=>{
    if(askCitationIsValid(token,scope))return`[[${token}]]`;
    rejected=true;return'[source link not verified in your selected library]'
  });
  return rejected?safe+'\n\nA source link was omitted because it did not match a current source in your selected scope.':safe
}
function askAssignmentScore(a,toks,query){
  const score=scoreText(`${a.title} ${a.type||''} ${a.due||''}`,toks);
  if(score)return score;
  return a.due&&/\b(due|deadline|assignment|homework|quiz|exam)\b/i.test(query)?1:0
}
function askOfflineAnswer(query,scope){
  const ids=askCourseIdsForScope(scope);
  const toks=tokens(query);
  const notes=Object.values(S.notes).filter(n=>n&&n.body&&!n.ex&&ids.includes(n.courseId)).map(n=>({n,score:scoreText(n.title+' '+n.body,toks)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,4);
  const assignments=Object.values(S.assignments).filter(a=>a&&!a.ex&&ids.includes(a.courseId)).map(a=>({a,score:askAssignmentScore(a,toks,query)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,4);
  const hits=[];
  ids.flatMap(id=>Object.values(S.lectures).filter(l=>l.courseId===id&&!l.ex)).forEach(l=>(l.segs||[]).forEach(g=>{const score=scoreText(g.x,toks);if(score>0&&g.t!==null&&g.t!==undefined&&g.t!==''&&Number.isFinite(Number(g.t))&&Number(g.t)>=0)hits.push({l,g,score})}));
  hits.sort((a,b)=>b.score-a.score);
  const sources=[];
  if(notes.length)sources.push('Closest matches in your own notes:\n'+notes.map(({n})=>`- **${n.title}** (${(course(n.courseId)||{}).code||'your course'}): ${n.body.slice(0,320).replace(/\s+/g,' ')} [[NOTE:${n.id}]]`).join('\n'));
  if(hits.length)sources.push('Closest passages from your recorded lectures:\n'+hits.slice(0,5).map(h=>`- “${h.g.x.slice(0,450)}” [[${h.l.id}@${Math.round(h.g.t)}]]`).join('\n'));
  if(assignments.length)sources.push('Matching coursework recorded in your library:\n'+assignments.map(({a})=>`- **${a.title}** (${(course(a.courseId)||{}).code||'your course'}; ${a.type||'task'}${a.due?`; due ${a.due}`:''}) [[ASSIGNMENT:${a.id}]]`).join('\n'));
  return sources.length?'AI answers are unavailable right now. These are search matches from your own course material, not a synthesized answer:\n\n'+sources.join('\n\n'):'AI answers are unavailable right now, and no matches were found in your own notes, lectures, or assignments.';
}
const ASK_VOICE={rec:null,stream:null,chunks:[],timer:null,seq:0,state:'idle',message:'',limitErrorPending:false};
function askFeatureState(){
  return currentBillingStatus()?.plan==='free'?'allowed':examFeatureState('studyTools');
}
function askAllowanceExhausted(){
  const billing=currentBillingStatus();
  if(!billing||String(billing.plan||'').toLowerCase()==='pro')return false;
  const remaining=billing.askCountRemaining;
  return remaining!==null&&remaining!==undefined&&Number.isFinite(Number(remaining))&&Number(remaining)<=0;
}
function askAllowanceResetDate(){
  const value=currentBillingStatus()?.askResetAt;
  return value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleDateString():null;
}
function askAllowanceLimitNotice(){
  const reset=askAllowanceResetDate();
  if(currentBillingStatus()?.plan==='free')return`You’ve used your one monthly Free-plan Ask question${reset?`. Resets ${reset}`:''}. Wait for the reset or upgrade; extra credits do not bypass this monthly limit.`;
  return`You’ve used all your monthly Ask questions${reset?`. Your allowance resets ${reset}`:''}. You can still submit this question; if the server offers a one-credit quote, you’ll be asked before continuing.`;
}
function askVoiceUI(){
  const btn=$('#ask-voice'),status=$('#ask-voice-status');
  const txLimited=transcriptionCountLimitReached();
  const askLimited=askAllowanceExhausted();
  if(!txLimited&&!ASK_VOICE.limitErrorPending&&/monthly transcription limit/i.test(ASK_VOICE.message))ASK_VOICE.message='';
  if(btn){
    const recording=ASK_VOICE.state==='recording';
    btn.innerHTML=ic(recording?'stop':'mic')+(recording?'Stop & ask':'Speak');
    btn.setAttribute('aria-label',recording?'Stop recording and ask question':'Ask a spoken question');
    btn.disabled=CHAT.busy||['starting','transcribing'].includes(ASK_VOICE.state)||txLimited&&!recording;
  }
  if(status){const message=ASK_VOICE.message||(txLimited?transcriptionLimitNotice():askLimited?askAllowanceLimitNotice():'');const showPlans=txLimited||askLimited||/monthly transcription limit/i.test(message);status.innerHTML=message?`${esc(message)}${showPlans?` <button type="button" class="btn sm" ${goAttr({name:'plans'})}>Review plans</button>`:''}`:'';status.hidden=!message}
}
function releaseAskVoice(){
  clearTimeout(ASK_VOICE.timer);ASK_VOICE.timer=null;
  if(ASK_VOICE.stream)ASK_VOICE.stream.getTracks().forEach(t=>t.stop());
  ASK_VOICE.stream=null;ASK_VOICE.rec=null;ASK_VOICE.chunks=[];
}
function cancelAskVoice(){
  ASK_VOICE.seq++;
  if(ASK_VOICE.rec&&ASK_VOICE.rec.state!=='inactive'){
    ASK_VOICE.rec.onstop=null;
    try{ASK_VOICE.rec.stop()}catch(e){}
  }
  releaseAskVoice();ASK_VOICE.state='idle';ASK_VOICE.message='';askVoiceUI();
}
async function stopAndAskVoice(){
  if(ASK_VOICE.state!=='recording')return;
  const seq=ASK_VOICE.seq,rec=ASK_VOICE.rec,mime=(rec.mimeType||'audio/webm').split(';')[0];
  ASK_VOICE.state='transcribing';ASK_VOICE.message='Transcribing your question…';askVoiceUI();
  try{
    let stopped=false;
    await new Promise(resolve=>{
      rec.onstop=()=>{stopped=true;resolve()};
      try{rec.stop()}catch(e){resolve()}
      setTimeout(resolve,3000);
    });
    if(!stopped)throw new Error('Recording could not be finished.');
    const blob=new Blob(ASK_VOICE.chunks,{type:mime});
    releaseAskVoice();
    if(seq!==ASK_VOICE.seq||S.view.name!=='ask')return;
    if(!blob.size)throw new Error('No audio was captured.');
    const segments=await window.CS_TRANSCRIBE(blob,{timed:false});
    if(seq!==ASK_VOICE.seq||S.view.name!=='ask')return;
    const words=segments.map(s=>s.x).filter(Boolean).join(' ').trim();
    if(!words)throw new Error('No speech was detected.');
    ASK_VOICE.state='idle';ASK_VOICE.message='';askVoiceUI();
    const code=billingUserCode();void loadBillingStatus(true,code).then(()=>{if(S.view.name==='ask')askVoiceUI()});
    const input=$('#ask-in');
    if(input){input.value=[input.value.trim(),words].filter(Boolean).join(' ');sendAsk()}
  }catch(e){
    if(seq!==ASK_VOICE.seq)return;
    releaseAskVoice();ASK_VOICE.state='idle';
    if(e&&e.code==='plan_limit'){
      ASK_VOICE.message='Your library has reached its monthly transcription limit. You can type your question instead.';
      ASK_VOICE.limitErrorPending=true;
      const code=billingUserCode();void loadBillingStatus(true,code).then(()=>{ASK_VOICE.limitErrorPending=false;if(transcriptionCountLimitReached())ASK_VOICE.message=transcriptionCountNotice();if(S.view.name==='ask')askVoiceUI()});
    }else ASK_VOICE.message=`${e.message||'Transcription failed.'} You can try again or type your question.`;
    askVoiceUI();
  }
}
ACT.askVoice=async()=>{
  if(ASK_VOICE.state==='recording')return stopAndAskVoice();
  if(ASK_VOICE.state!=='idle'||CHAT.busy)return;
  if(transcriptionCountLimitReached()){ASK_VOICE.message=transcriptionCountNotice();askVoiceUI();return}
  if(!window.CS_TRANSCRIBE||!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
    ASK_VOICE.message='Voice questions are not available in this browser. You can type your question below.';
    askVoiceUI();return;
  }
  const seq=++ASK_VOICE.seq;
  ASK_VOICE.state='starting';ASK_VOICE.message='Opening microphone…';askVoiceUI();
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(seq!==ASK_VOICE.seq||S.view.name!=='ask'){stream.getTracks().forEach(t=>t.stop());return}
    const mime=typeof MediaRecorder.isTypeSupported==='function'
      ?['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t)):null;
    const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
    ASK_VOICE.stream=stream;ASK_VOICE.rec=rec;ASK_VOICE.chunks=[];
    rec.ondataavailable=e=>{if(seq===ASK_VOICE.seq&&e.data?.size)ASK_VOICE.chunks.push(e.data)};
    rec.onstop=()=>{
      if(seq!==ASK_VOICE.seq||ASK_VOICE.state!=='recording')return;
      releaseAskVoice();ASK_VOICE.state='idle';
      ASK_VOICE.message='Recording stopped before you asked. Try again or type your question.';
      askVoiceUI();
    };
    rec.start(1000);
    ASK_VOICE.state='recording';ASK_VOICE.message='Listening… tap Stop & ask when you finish.';
    ASK_VOICE.timer=setTimeout(stopAndAskVoice,60000);
  }catch(e){
    if(seq!==ASK_VOICE.seq||S.view.name!=='ask')return;
    releaseAskVoice();ASK_VOICE.state='idle';
    ASK_VOICE.message='Could not use the microphone. Allow access in your browser, or type your question.';
  }
  askVoiceUI();
};
window.addEventListener('pagehide',cancelAskVoice);
function askContextValid(context){
  const valid=!!context&&CHAT.context===context&&CHAT.epoch===context.epoch&&S.uid===context.uid&&billingUserCode()===context.billingCode;
  if(!valid&&context&&CHAT.context===context){
    clearInterval(ASK_LIBRARY_WATCH);ASK_LIBRARY_WATCH=null;CHAT.epoch++;CHAT.ab&&CHAT.ab.abort();CHAT.ab=null;CHAT.context=null;CHAT.busy=false;CHAT.turns=[];CHAT.coverage='';
    if(S.view.name==='ask')render();
  }
  return valid;
}
let ASK_LIBRARY_WATCH=null;
function startAskLibraryWatch(context){
  clearInterval(ASK_LIBRARY_WATCH);
  ASK_LIBRARY_WATCH=setInterval(()=>askContextValid(context),250);
}
function finishAsk(context){
  if(!askContextValid(context))return false;
  clearInterval(ASK_LIBRARY_WATCH);ASK_LIBRARY_WATCH=null;CHAT.context=null;CHAT.busy=false;CHAT.ab=null;render();return true;
}
function askTools(scope,context){
  const status=t=>{if(!askContextValid(context))return;const s=$('#ask-status');if(s)s.textContent=t};
  const blocked=()=>askContextValid(context)?null:{error:'The active library changed. This result was discarded.'};
  const ownCourses=askOwnedCourses;
  const askCourseIds=requested=>askCourseIdsForScope(scope,requested);
  const courseForLecture=l=>l&&ownCourses().find(c=>c.id===l.courseId);
  const notesFor=(ids)=>Object.values(S.notes).filter(n=>n&&n.body&&ids.includes(n.courseId)&&!n.ex);
  return [
    {name:'search_evidence',description:'Search this student’s private semester/course evidence index: their own lecture transcript passages and slides, private notes/imports, and assignment records. Never search shared-class private notes, other students’ work, or examples. Return the exact lectureId/time, noteId, or assignmentId for every match.',inputSchema:{type:'object',properties:{query:{type:'string'},courseId:{type:'string',description:'optional owned course id; cannot override selected course or semester scope'}},required:['query']},
      execute:async({query,courseId})=>{
        const denied=blocked();if(denied)return denied;
        if(CHAT.retrieval==='semantic'){
          const ids=askCourseIds(courseId);if(!ids.length)return{hits:[],notice:'No owned courses in this scope.'};
          status('Searching your private passages by meaning…');
          const response=await fetch('/api/ai/evidence',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-CS-User':context.billingCode},signal:CHAT.ab&&CHAT.ab.signal,body:JSON.stringify({query,courseIds:ids.slice(0,100),mode:'semantic'})});
          const result=await response.json().catch(()=>({}));
          const changed=blocked();if(changed)return changed;
          if(!response.ok){CHAT.coverage=result.error||'Semantic search is unavailable. Switch to keyword search or try again.';const el=$('#ask-coverage');if(el)el.textContent=CHAT.coverage;return{error:CHAT.coverage}}
          if(ids.length>100){result.notice=['Partial search: only the first 100 courses in this scope were searched. Narrow to one semester or course.',result.notice].filter(Boolean).join(' ');result.coverage.partial=true}
          CHAT.coverage=result.notice||'';const el=$('#ask-coverage');if(el)el.textContent=CHAT.coverage;
          return{...result,hits:(result.hits||[]).map(h=>({...h,citation:h.kind==='lecture'?`[[${h.id}@${h.seconds}]]`:h.kind==='note'?`[[NOTE:${h.id}]]`:`[[ASSIGNMENT:${h.id}]]`})).filter(h=>askCitationIsValid(h.citation.slice(2,-2),scope))};
        }
        const ids=askCourseIds(courseId),toks=tokens(query);status(`Searching your private course index for “${query}”…`);
        if(!ids.length||!toks.length)return[];
        const hits=[];
        ids.forEach(cid=>{
          Object.values(S.lectures).filter(l=>l&&l.courseId===cid&&!l.ex).forEach(l=>{
            (l.segs||[]).forEach(g=>{const score=scoreText(g.x,toks);if(score>0&&g.t!==null&&g.t!==undefined&&g.t!==''&&Number.isFinite(Number(g.t))&&Number(g.t)>=0)hits.push({score,kind:'lecture',courseId:cid,lectureId:l.id,t:Math.round(Number(g.t)),title:l.title,date:l.date,text:g.x.slice(0,600)})});
            (l.slides||[]).forEach(sl=>{const score=scoreText(sl.text||'',toks);if(score>0&&sl.t!==null&&sl.t!==undefined&&sl.t!==''&&Number.isFinite(Number(sl.t))&&Number(sl.t)>=0)hits.push({score,kind:'lecture',courseId:cid,lectureId:l.id,t:Math.round(Number(sl.t)),title:l.title,date:l.date,text:`[Slide] ${String(sl.text||'').slice(0,600)}`})});
          });
        });
        notesFor(ids).forEach(n=>{const score=scoreText((n.title||'')+' '+n.body,toks);if(score>0)hits.push({score,kind:'note',courseId:n.courseId,noteId:n.id,title:n.title||'Untitled note',sourceType:n.sourceType||'private note',text:n.body.slice(0,1200),excerpted:n.body.length>1200})});
        Object.values(S.assignments).filter(a=>a&&!a.ex&&ids.includes(a.courseId)).forEach(a=>{const score=askAssignmentScore(a,toks,query);if(score>0)hits.push({score,kind:'assignment',courseId:a.courseId,assignmentId:a.id,title:a.title,type:a.type||'task',due:a.due||null,done:!!a.done})});
        return hits.sort((a,b)=>b.score-a.score).slice(0,15).map(h=>({...h,course:(course(h.courseId)||{}).code||'',citation:h.kind==='lecture'?`[[${h.lectureId}@${h.t}]]`:h.kind==='note'?`[[NOTE:${h.noteId}]]`:`[[ASSIGNMENT:${h.assignmentId}]]`}));
      }},
    {name:'search_lectures',description:'Search only this student’s real recorded lectures in the selected course scope. Returns source citations. Never include example courses.',inputSchema:{type:'object',properties:{query:{type:'string'},courseId:{type:'string',description:'optional owned course id; cannot override selected scope'}},required:['query']},
      execute:({query,courseId})=>{const denied=blocked();if(denied)return denied;const ids=askCourseIds(courseId);status(`Searching lectures for “${query}”…`);const toks=tokens(query);if(!toks.length||!ids.length)return[];const hits=[];ids.flatMap(id=>Object.values(S.lectures).filter(l=>l.courseId===id&&!l.ex)).forEach(l=>{(l.segs||[]).forEach((g,i)=>{const sc=scoreText(g.x,toks);if(sc>0&&g.t!==null&&g.t!==undefined&&g.t!==''&&Number.isFinite(Number(g.t))&&Number(g.t)>=0)hits.push({l,i,g,sc})});(l.slides||[]).forEach(sl=>{const sc=scoreText(sl.text||'',toks);if(sc>0&&sl.t!==null&&sl.t!==undefined&&sl.t!==''&&Number.isFinite(Number(sl.t))&&Number(sl.t)>=0)hits.push({l,i:-1,g:{t:sl.t,s:'slide',x:sl.text},sc})})});return hits.sort((a,b)=>b.sc-a.sc).slice(0,10).map(h=>{const l=h.l,segs=l.segs||[],ctx=h.i>=0?[segs[h.i-1],segs[h.i],segs[h.i+1]].filter(Boolean).map(s=>`${spkName(l,s.s)}: ${s.x}`).join(' / '):'[slide] '+h.g.x;return{lectureId:l.id,course:(course(l.courseId)||{}).code,title:l.title,date:l.date,t:Math.round(h.g.t),passage:ctx.slice(0,700)}})}},
    {name:'emphasis_report',description:'Count topics and explicit professor emphasis in the student’s own analyzed lectures in the selected course scope.',inputSchema:{type:'object',properties:{courseId:{type:'string'}}},
      execute:({courseId})=>{const denied=blocked();if(denied)return denied;const ids=askCourseIds(courseId);status('Counting what the professor emphasized…');const lecs=ids.flatMap(id=>Object.values(S.lectures).filter(l=>l.courseId===id&&l.analysis));return{topics:topicCounts(lecs).slice(0,12).map(t=>({topic:t.name,lectureCount:t.refs.length,refs:t.refs})),emphasized:lecs.flatMap(l=>(l.analysis.emphasized||[]).map(e=>({lectureId:l.id,date:l.date,t:e.t,concept:e.concept,why:e.why})))}}},
    {name:'list_assignments',description:'List this student’s own assignments, readings, quizzes and exams with dates; limited to owned courses in the selected scope.',inputSchema:{type:'object',properties:{courseId:{type:'string'}}},
      execute:({courseId})=>{const denied=blocked();if(denied)return denied;const ids=askCourseIds(courseId);status('Checking assignments…');return Object.values(S.assignments).filter(a=>!a.ex&&ids.includes(a.courseId)).sort((a,b)=>(a.due||'9')<(b.due||'9')?-1:1).map(a=>({id:a.id,title:a.title,type:a.type,due:a.due,done:!!a.done,course:(course(a.courseId)||{}).code,citation:`[[ASSIGNMENT:${a.id}]]`,lectureId:a.lectureId&&S.lectures[a.lectureId]&&S.lectures[a.lectureId].courseId===a.courseId?a.lectureId:null,t:a.lectureId&&S.lectures[a.lectureId]&&S.lectures[a.lectureId].courseId===a.courseId?a.t||null:null}))}},
    {name:'search_notes',description:'Search only the student’s own private notes, including imported syllabi, readings, and study guides, in the selected course scope. Each result is limited to 1,500 characters and identifies whether it is an excerpt. Name the source note when using it; excerpts do not represent the complete note.',inputSchema:{type:'object',properties:{query:{type:'string'},courseId:{type:'string',description:'optional owned course id; cannot override selected scope'}},required:['query']},
      execute:({query,courseId})=>{const denied=blocked();if(denied)return denied;const ids=askCourseIds(courseId);status(`Searching your notes for “${query}”…`);const toks=tokens(query);return notesFor(ids).map(n=>({id:n.id,title:n.title,sourceType:n.sourceType||'private note',course:(course(n.courseId)||{}).code||'',citation:`[[NOTE:${n.id}]]`,linkedLectureId:n.lectureId&&S.lectures[n.lectureId]&&S.lectures[n.lectureId].courseId===n.courseId?n.lectureId:null,text:n.body.slice(0,1500),excerpted:n.body.length>1500,originalCharacters:n.body.length,score:scoreText(n.title+' '+n.body,toks)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,6)}},
    {name:'class_collaboration',description:'Read real class discussion posts, shared notebook text and shared lecture metadata for the selected course(s). Requires the signed-in live class-group connection; excludes sample/example content.',inputSchema:{type:'object',properties:{courseId:{type:'string',description:'optional owned course id; cannot override selected scope'}}},
      execute:async({courseId})=>{
        const denied=blocked();if(denied)return denied;
        const ids=askCourseIds(courseId);status('Checking class discussion and shared study material…');
        if(S.mode!=='db'||!DB)return{available:false,message:'Class collaboration is unavailable until connected to the live class group.'};
        const sources=[];
        for(const id of ids){
          if(!askContextValid(context))return{error:'The active library changed. This result was discarded.'};
          const c=S.courses[id];if(!c||c.ex)continue;
          const groupCode=String(c.groupCode||'');
          if(!/^g_[0-9a-f]{32}$/.test(groupCode)){sources.push({course:c.code,available:false,message:'This course has no valid class-group invite code. Join a group in Classmates first.'});continue}
          try{
            const [postSnap,bookSnap,sharedSnap]=await Promise.all([
              DB.collection('posts').where('code','==',groupCode).get(),
              DB.doc('notebooks/'+groupCode).get(groupCode),
              DB.collection('shared').where('code','==',groupCode).get()
            ]);
            if(!askContextValid(context))return{error:'The active library changed. This result was discarded.'};
            const posts=postSnap.docs.map(d=>d.data()).filter(p=>p&&p.code===groupCode&&typeof p.text==='string')
              .sort((a,b)=>(Number(b.at)||0)-(Number(a.at)||0)).slice(0,12)
              .map(p=>({author:p.bot?'ClassScribe study session':p.by===context.uid?'you':'classmate',date:Number.isFinite(Number(p.at))&&p.at?new Date(Number(p.at)).toISOString():null,text:p.text.slice(0,1200)}));
            const candidate=bookSnap&&bookSnap.exists?bookSnap.data():null;
            const book=candidate&&candidate.code===groupCode&&typeof candidate.text==='string'?candidate:null;
            const sharedLectures=sharedSnap.docs.map(d=>d.data()).filter(l=>l&&!l.ex&&l.code===groupCode).slice(0,12).map(l=>({
              lectureId:l.id,title:l.title,date:l.date,sharedBy:l.by===context.uid?'you':'classmate',
              summary:l.analysis&&l.analysis.summary||'',keyPoints:l.analysis&&l.analysis.keyPoints||[]
            }));
            sources.push({course:c.code,discussionPosts:posts,sharedNotebook:book?book.text.slice(0,6000):null,sharedLectures});
          }catch(e){
            if(!askContextValid(context))return{error:'The active library changed. This result was discarded.'};
            sources.push({course:c.code,error:e.message||'Could not read class collaboration data.'});
          }
        }
        return askContextValid(context)?sources:{error:'The active library changed. This result was discarded.'};
      }},
    {name:'student_gradebook_results',description:'Read the signed-in student’s server-verified gradebook entries, overall average and averages for assignments, projects, quizzes and tests in their own selected course(s). Entries are student-entered, not imported or official institutional grades.',inputSchema:{type:'object',properties:{courseId:{type:'string',description:'optional owned course id; cannot override selected scope'}}},
      execute:async({courseId})=>{
        const denied=blocked();if(denied)return denied;
        const ids=askCourseIds(courseId);status('Checking your verified gradebook…');if(!ids.length)return[];
        if(gradesAccess()!=='allowed'||!billingUserCode())return{available:false,message:'Gradebook results require a verified Student or Pro plan and signed-in library.'};
        try{
          const data=await gradesRequest('list',{});
          if(!askContextValid(context))return{error:'The active library changed. This result was discarded.'};
          return(data.courses||[]).filter(x=>ids.includes(x.courseId||x.gradebook&&x.gradebook.courseId)).map(x=>{
            const id=x.courseId||x.gradebook&&x.gradebook.courseId,c=S.courses[id],g=x.gradebook||{},analysis=x.analysis||{};
            const categories=['assignment','project','quiz','test'].map(type=>{
              const row=(analysis.byType||[]).find(r=>r.type===type);
              const items=(g.items||[]).filter(i=>i.type===type);
              return{category:GRADE_NAMES[type],label:'Student-entered category average',averagePercent:row&&row.averagePercent!=null?row.averagePercent:null,enteredCount:items.length,gradedCount:items.filter(i=>i.earned!==null).length};
            });
            return{
              course:c&&c.code,label:'Student-entered ClassScribe tracking; not an official school grade',
              estimatedAverage:analysis.averagePercent==null?null:analysis.averagePercent,estimatedLetter:analysis.letter||null,byCategory:categories,
              results:(g.items||[]).filter(i=>['assignment','project','quiz','test'].includes(i.type)).map(i=>({
                title:i.title,category:GRADE_NAMES[i.type],type:i.type,date:i.date||null,earned:i.earned,possible:i.possible,
                scoreStatus:i.earned===null?'student-entered item; not yet scored':'student-entered result'
              }))
            };
          });
        }catch(e){if(!askContextValid(context))return{error:'The active library changed. This result was discarded.'};return{error:e.message||'Could not read your verified gradebook.'}}
      }},
    {name:'practice_learning_results',description:'Summarize this student’s saved ClassScribe practice-check counts and weak concepts. These are learning analytics, not official grades or exam predictions.',inputSchema:{type:'object',properties:{courseId:{type:'string',description:'optional owned course id; cannot override selected scope'}}},
      execute:({courseId})=>{const denied=blocked();if(denied)return denied;const ids=askCourseIds(courseId);status('Reviewing saved practice learning signals…');return ids.map(id=>({course:S.courses[id].code,label:'ClassScribe practice learning analytics — not an official grade or exam prediction',concepts:Object.entries((S.stats[id]&&S.stats[id].concepts)||{}).filter(([,v])=>v.w>0||v.r>0).map(([concept,v])=>({concept,missed:v.w||0,correct:v.r||0,checks:(v.w||0)+(v.r||0)})).sort((a,b)=>b.missed-a.missed),practiceTests:(S.stats[id]&&S.stats[id].attempts||[]).filter(a=>a.kind==='practice test').slice(-30).map(a=>({date:new Date(a.at).toISOString(),concept:a.concept,question:a.question,result:a.result,label:'ClassScribe practice-test self-check; not an official grade'}))}))}},
    {name:'get_lecture',description:'Read one of the student’s own lectures, only if it belongs to the selected course scope. Material is limited to 8,000 characters and may be excerpted. Example and other-library lectures are unavailable.',inputSchema:{type:'object',properties:{lectureId:{type:'string'},courseId:{type:'string',description:'optional owned course id; cannot override selected scope'}},required:['lectureId']},
      execute:({lectureId,courseId})=>{const denied=blocked();if(denied)return denied;const ids=askCourseIds(courseId);const l=S.lectures[lectureId];if(!l||!ids.includes(l.courseId))return{error:'Lecture not found in the selected course scope.'};status(`Reading “${l.title}”…`);return{lectureId:l.id,course:(course(l.courseId)||{}).code,title:l.title,date:l.date,material:material([l],8000),materialLimit:8000,coverage:'Lecture material may be excerpted; check other relevant sources before treating it as complete.'};}}
  ].filter(tool=>CHAT.retrieval!=='semantic'||!['search_lectures','search_notes'].includes(tool.name));
}
VIEWS.ask=v=>{
  if(askFeatureState()!=='allowed')return`<div class="page-h"><div><p class="eyebrow">Class Memory</p><h1>Ask ClassScribe</h1><p class="sub">Free: one monthly Ask question for 1 Scribe Credit. Student and Pro include Ask questions.</p></div></div>${examAccessNotice('studyTools')}`;
  if(v.scope&&!v._init){CHAT.scope=v.scope;v._init=1}
  const cs=askOwnedCourses(),terms=[...new Map(cs.map(c=>[askSemesterKey(c.semester),c.semester||'Courses'])).values()];
  if(CHAT.scope!=='all'&&!askCourseIdsForScope(CHAT.scope).length)CHAT.scope='all';
  const prof=(course(CHAT.scope)||cs[0]||{}).professor||'my professor';const c0=course(CHAT.scope)||cs[0]||{};
  const sugg=[`What did ${prof} say about ${c0.code==='CHEM 110'?'limiting reagents':c0.ex?'mitosis':'the main topic'} this semester?`,`What has ${prof} repeated the most?`,'What’s due in the next two weeks?','Explain the hardest idea from my last lecture'];
   const billing=currentBillingStatus(),askLimit=billing&&billing.askCountLimit,askRemaining=billing&&billing.askCountRemaining,resetDate=askAllowanceResetDate();
   const hasAskLimit=askLimit!==null&&askLimit!==undefined&&Number.isFinite(Number(askLimit));
   const hasAskRemaining=askRemaining!==null&&askRemaining!==undefined&&Number.isFinite(Number(askRemaining));
   const allowance=billing?String(billing.plan||'').toLowerCase()==='free'?`${Number(askRemaining)||0} of 1 monthly Ask question remaining · 1 Scribe Credit per question · no upgrade required${resetDate?` · resets ${resetDate}`:''}.`:String(billing.plan||'').toLowerCase()==='pro'?'Unlimited Ask questions this month.':hasAskRemaining&&hasAskLimit?`${Number(askRemaining)} of ${Number(askLimit)} Ask questions remaining this month${resetDate?` · resets ${resetDate}`:''}.`:'Ask allowance is unavailable. Refresh your plan status to check.':'Checking your Ask allowance…';
   return `<div class="page-h"><div><p class="eyebrow">Class Memory</p><h1>Ask ClassScribe</h1><p class="sub">Search your private lecture passages, notes and coursework across courses in a semester. Every source link is checked against your current library and selected scope.</p><p class="small muted" role="status" aria-live="polite">${esc(allowance)} ${askAllowanceExhausted()?`<button type="button" class="btn sm" ${goAttr({name:'plans'})}>Review plans</button>`:''}</p>${sourceCoverageBlurb(CHAT.scope)}<div class="ask-persona"><img src="/katherine-johnson-cartoon.png" alt="Cartoon portrait of Dr. Katherine Johnson"><span><strong>Inspired by Dr. Katherine Johnson</strong><small>Answers are generated by ClassScribe AI, not Dr. Johnson.</small></span></div></div>
   <label class="f" style="flex-direction:row;align-items:center;gap:8px">Search in<select class="in" id="ask-scope" style="width:auto"><option value="all" ${CHAT.scope==='all'?'selected':''}>All my courses</option><optgroup label="By semester">${terms.map(term=>{const value='semester:'+encodeURIComponent(term);return`<option value="${esc(value)}" ${CHAT.scope===value?'selected':''}>${esc(term)}</option>`}).join('')}</optgroup><optgroup label="By course">${cs.map(c=>`<option value="${esc(c.id)}" ${CHAT.scope===c.id?'selected':''}>${esc(c.code)} · ${esc(c.semester||'Courses')}</option>`).join('')}</optgroup></select></label></div>
   <label class="f">Passage matching<select class="in" id="ask-retrieval" ${CHAT.busy?'disabled':''}><option value="semantic" ${CHAT.retrieval==='semantic'?'selected':''}>Meaning · synonyms and paraphrases</option><option value="keyword" ${CHAT.retrieval==='keyword'?'selected':''}>Exact keywords</option></select><span class="small muted">Meaning search uses permission-checked, saved private text. No separate content index or audio is stored.</span></label><p id="ask-coverage" class="small muted" role="status" aria-live="polite">${esc(CHAT.coverage)}</p>
   <div class="chat" id="chat">${CHAT.turns.length?CHAT.turns.map(t=>t.role==='user'?`<div class="msg me">${esc(t.content)}</div>`:`<div class="ask-reply">${askPortrait('ask-reply-avatar')}<div class="msg ai md"><span class="ask-answer-source">ClassScribe AI</span>${md(t.content)}</div></div>`).join(''):`<div class="panel stack" style="gap:10px"><p class="muted">Try asking:</p><div class="sugg">${sugg.map(s=>`<button data-act="askSugg">${esc(s)}</button>`).join('')}</div></div>`}
  ${CHAT.busy?`<div class="ask-reply">${askPortrait('ask-reply-avatar')}<div class="msg ai md" id="ask-live"><p class="small muted" id="ask-status">Thinking…</p>${thinking}</div></div>`:''}</div>
    <form class="composer" data-form="ask"><textarea id="ask-in" rows="1" placeholder="Ask about anything from your classes…" aria-label="Question">${esc(ASK_DRAFT||v.prefill||'')}</textarea><button type="button" id="ask-voice" class="btn" data-act="askVoice" aria-label="Ask a spoken question" ${transcriptionCountLimitReached()?'disabled':''}>${ic('mic')}Speak</button>${CHAT.busy?`<button type="button" class="btn" data-act="askStop">${ic('stop')}Stop</button>`:`<button class="btn primary">${askPortrait('ask-send-avatar')}Ask</button>`}</form>
    ${ASK_ERROR?`<p class="small" role="alert" aria-live="assertive" style="color:var(--warn)">${esc(ASK_ERROR)} ${ASK_ERROR.includes('monthly Ask')||askAllowanceExhausted()?`<button type="button" class="btn sm" ${goAttr({name:'plans'})}>Review plans</button>`:''}</p>`:''}
    <p id="ask-voice-status" class="small muted" role="status" style="margin-top:8px" ${ASK_VOICE.message||transcriptionCountLimitReached()?'':'hidden'}>${esc(ASK_VOICE.message|| (transcriptionCountLimitReached()?transcriptionCountNotice():''))}</p>
  ${CHAT.turns.length?`<div class="row" style="margin-top:8px"><button class="btn ghost sm" data-act="askClear">New conversation</button></div>`:''}`;
};
AFTER.ask=v=>{v.prefill='';LEAVE=cancelAskVoice;askVoiceUI();const c=$('#chat');if(c&&CHAT.turns.length)window.scrollTo(0,document.body.scrollHeight)};
ACT.askSugg=el=>{$('#ask-in').value=el.textContent;ASK_DRAFT=el.textContent;sendAsk()};
ACT.askClear=()=>{cancelAskVoice();clearInterval(ASK_LIBRARY_WATCH);ASK_LIBRARY_WATCH=null;CHAT.context=null;CHAT.epoch++;CHAT.ab&&CHAT.ab.abort();CHAT.ab=null;CHAT.busy=false;CHAT.turns=[];CHAT.coverage='';ASK_DRAFT='';ASK_ERROR='';render()};
ACT.askStop=()=>{CHAT.ab&&CHAT.ab.abort()};
async function callAskWithCredits(input,options,askId,aiCapability){
  if(typeof creditActionPost!=='function')return aiCapability(input,{...options,askId});
  const messages=typeof input==='string'?[{role:'user',content:input}]:input.map(message=>({role:message.role,content:message.content}));
  const tools=(options.tools||[]).map(tool=>({name:tool.name,description:tool.description,input_schema:tool.inputSchema||{type:'object',properties:{}}}));
  const confirmation={requestId:askId};
  for(let round=0;round<8;round++){
    if(options.signal&&options.signal.aborted)throw{code:'cancelled',message:'Stopped'};
    const result=await creditActionPost('/api/ai/ask',{
      messages,tools,tier:options.modelTier,askId,...(confirmation.useCredits?{useCredits:true,requestId:confirmation.requestId}:{})
    },'continue with this Ask question',{confirmation,askId,signal:options.signal,userCode:billingUserCode(),isCurrent:()=>askContextValid(options.context)});
    if(options.signal&&options.signal.aborted)throw{code:'cancelled',message:'Stopped'};
    const text=(result.content||[]).filter(block=>block.type==='text').map(block=>block.text).join('');
    const uses=(result.content||[]).filter(block=>block.type==='tool_use');
    if(!uses.length||result.stop_reason!=='tool_use'){
      if(options.onText)options.onText({text,delta:text});
      return{text,truncated:result.stop_reason==='max_tokens',modelTierApplied:options.modelTier||'default'};
    }
    messages.push({role:'assistant',content:result.content});
    const results=[];
    for(const use of uses){
      const tool=(options.tools||[]).find(item=>item.name===use.name);let output,isError=false;
      try{output=tool?await tool.execute(use.input||{},{signal:options.signal}):'Unknown tool'}
      catch(error){output=String(error&&error.message||error);isError=true}
      results.push({type:'tool_result',tool_use_id:use.id,content:typeof output==='string'?output:JSON.stringify(output),is_error:isError});
    }
    messages.push({role:'user',content:results});
  }
  throw{code:'unavailable',message:'The AI took too many steps.'};
}
async function sendAsk(){
  const draft=$('#ask-in').value,q=draft.trim();if(!q||CHAT.busy||ASK_VOICE.state!=='idle')return;
  ASK_DRAFT='';ASK_ERROR='';
  if(CHAT.scope!=='all'&&!askCourseIdsForScope(CHAT.scope).length)CHAT.scope='all';
  const scope=CHAT.scope,epoch=CHAT.epoch;
  const context={uid:S.uid,billingCode:billingUserCode(),epoch};
  CHAT.context=context;CHAT.turns.push({role:'user',content:q});CHAT.busy=true;startAskLibraryWatch(context);render();
  let s;
    try{s=await AI()}catch(e){if(askContextValid(context)){ASK_DRAFT=draft;ASK_ERROR='Ask could not reach the AI service. Your question is still here.';aiErr(e)}finishAsk(context);return}
  if(!askContextValid(context))return;
    if(!s){ASK_DRAFT=draft;ASK_ERROR='Ask is unavailable offline. Your question is still here; reconnect and try again.';CHAT.turns.pop();finishAsk(context);return}
  const cs=Object.values(S.courses).filter(c=>!c.ex);
  const pre=`You are ClassScribe, a study assistant with a private local evidence index: use search_evidence for the student's own lecture passages/slides, private notes and assignment records, and use other tools only when useful. Today is ${todayISO()}.
Courses (id · code · name · professor · lectures): ${cs.map(c=>`${c.id} · ${c.code} · ${c.name} · ${c.professor||'?'} · ${lecturesOf(c.id).length}`).join(' | ')}.
Scope: ${scope==='all'?'all of the student’s own courses':scope.startsWith('semester:')?'only the student’s own courses in semester '+decodeURIComponent(scope.slice(9)):'only course id '+scope}.
 Rules: use only tools for the selected scope; never treat example/sample or another library's data as real, and never use another student's private notes or work. Use exact returned source IDs/timestamps; cite lectures as [[LECTURE_ID@SECONDS]], private notes as [[NOTE:NOTE_ID]], and assignments as [[ASSIGNMENT:ASSIGNMENT_ID]]. Never invent a citation token. Tool results may be excerpted or limited; treat them as partial and do not imply complete source coverage. Answer only from returned sources, and plainly say when sources do not support an answer. Do not leak answer keys or give answers to practice prompts before the student attempts them. Gradebook entries and averages are student-entered tracking data, not official institutional grades; describe assignment, project, quiz and test titles, categories, dates, averages and recorded results exactly as supplied and do not infer exam performance. Practice counts are self-check learning analytics, not grades or exam predictions. Do not claim mastery or predict what will be on an exam. Be concise.\n\nQuestion: `;
  const turns=CHAT.turns.map((t,i)=>({role:t.role,content:i===0?pre+t.content:t.content}));
  const ab=new AbortController();CHAT.ab=ab;
  try{
       const askId=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
       const r=await callAskWithCredits(turns,{tools:askTools(scope,context),signal:ab.signal,context,onText:u=>{if(!askContextValid(context))return;const el=$('#ask-live');if(el)el.innerHTML=md(askVerifiedAnswer(u.text,scope))}},askId,s);
      if(askContextValid(context)){CHAT.turns.push({role:'assistant',content:askVerifiedAnswer(r.text,scope)});ASK_ERROR='';void loadBillingStatus(true,context.billingCode)}
    }catch(e){
      if(askContextValid(context)){
        if(e&&e.code==='ask_limit_reached'){ASK_ERROR=askAllowanceLimitNotice();ASK_DRAFT=draft;CHAT.turns.pop();void loadBillingStatus(true,context.billingCode)}
        else if(e&&e.code==='credits_cancelled'){ASK_ERROR='No credits were used. Your question is still here if you want to try again later.'}
        else if(e&&e.code==='insufficient_credits'){ASK_ERROR='There are not enough credits for this question. Add credits, then try again.'}
        else if(!(e&&e.code==='cancelled')){ASK_ERROR='Ask could not finish. Your question is still here; try again.';aiErr(e)}
        if(e&&e.code!=='cancelled'&&e.code!=='ask_limit_reached'){ASK_DRAFT=draft;CHAT.turns.pop()}
      }
    }
  finishAsk(context);
}

/* ---------- TUTOR (Quiz Me / Teach me) ---------- */
let TUT={key:null};
 function companionResult(text,submittedAnswer,courseMaterial=''){
   const raw=typeof text==='string'?text:'',tags=[...raw.matchAll(/<<result\b[^>]*>>/g)];
   const shown=raw.replace(/<<result\b[^>]*>>/g,'').trim();
   if(!submittedAnswer)return{shown:shown.replace(/^\s*Correct answer:\s*.*$/gim,'').trim(),grade:null};
   const verdict=/^\s*(Correct|Incorrect)\./i.exec(shown),answer=/^\s*Correct answer:\s*(\S.*)$/im.exec(shown);
   const marker=tags.length===1&&/^<<result concept="([^"]+)" correct="(yes|no)">>$/.exec(tags[0][0]);
   const claims=[...shown.matchAll(/\b(?:Incorrect|Correct)\.(?!\s*answer:)|\b(?:your (?:answer|response) is|you (?:are|were))\s+(?:in)?correct\b/gi)]
     .map(([claim])=>/\bincorrect\b/i.test(claim)?'no':'yes');
   const normalize=value=>String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/^(?:the|a|an) /,'');
   const expected=normalize(answer?.[1]||''),submitted=normalize(submittedAnswer);
   const supported=expected&&(` ${normalize(courseMaterial)} `).includes(` ${expected} `);
   if(!marker||!verdict||!answer||(verdict[1].toLowerCase()==='correct')!==(marker[2]==='yes')
     ||claims.some(claim=>claim!==marker[2])||!supported||!submitted||(marker[2]==='yes')!==(submitted===expected))
     return{shown:'Not graded. ClassScribe could not verify this result. Please try answering again.',grade:null};
   return{shown,grade:{concept:marker[1],correct:marker[2]==='yes'}};
 }
function tutorPortrait(className='ask-reply-avatar'){return `<img class="${className}" src="/terence-tao-avatar.png" alt="" aria-hidden="true">`}
VIEWS.tutor=v=>{
  const tutorFeature=v.mode==='teach'||v.mode==='weak'?'advancedTutor':'studyTools';
  if(examFeatureState(tutorFeature)!=='allowed')return`<div class="page-h"><div><p class="eyebrow">AI tutor</p><h1>${v.mode==='teach'?'Advanced lecture tutor':'Quiz me'}</h1></div></div>${examAccessNotice(tutorFeature)}`;
  const key=JSON.stringify([S.uid,billingUserCode(),v.courseId,v.lectureIds,v.mode,v.focus,v.before,sourceNotesOf(v.courseId).map(n=>n.id+':'+n.updated)]);if(TUT.key!==key)TUT={key,turns:[],busy:false,score:{r:0,w:0},lastGraded:-1};
  const lecs=v.lectureIds&&v.lectureIds.length?v.lectureIds.map(lecture).filter(Boolean):lecturesOf(v.courseId).filter(l=>!v.before||l.date<=v.before);
   const c=course(v.courseId)||{};const weak=weakList(v.courseId).map(w=>w.concept),sources=sourceNotesOf(v.courseId);
  const title=v.mode==='teach'?'Teach me this lecture':v.mode==='weak'?'Quiz me on weak areas':'Quiz me';
  const back=v.lectureIds&&v.lectureIds.length===1?goAttr({name:'lecture',id:v.lectureIds[0],tab:'study'}):goAttr({name:'exam',courseId:v.courseId});
  return `<button class="btn ghost sm" ${back} style="margin-bottom:10px">${ic('back')}Back</button>
   <div class="page-h"><div><p class="eyebrow">Study companion · ${esc(c.code||'')} · ${plural(lecs.length,'lecture')}${sources.length?` · ${plural(sources.length,'private source')}`:''}</p><h1>${title}</h1><p class="sub">Uses only your course material. Imported sources stay private to your library.${v.mode==='weak'&&weak.length?' Focus: '+esc(weak.slice(0,4).join(', '))+'.':''}</p>${sourceCoverageBlurb(v.courseId)}<div class="companion-persona"><img src="/terence-tao-cartoon.png" alt="Cartoon portrait inspired by Dr. Terence Tao"><span><strong>Inspired by Dr. Terence Tao</strong><small>An illustrated tribute. Questions and feedback come from ClassScribe AI, not Dr. Tao.</small></span></div></div>
  <div class="row"><span class="chip ok">✓ ${TUT.score.r}</span><span class="chip rec">✗ ${TUT.score.w}</span></div></div>
   <div class="chat">${TUT.turns.filter((t,i)=>i>0).map(t=>t.role==='user'?`<div class="msg me">${esc(t.content)}</div>`:`<div class="ask-reply">${tutorPortrait()}<div class="msg ai md"><span class="ask-answer-source">ClassScribe study companion</span>${md(t.shown||t.content)}</div></div>`).join('')}
   ${!TUT.turns.length?`<div class="panel stack" style="gap:10px;align-items:flex-start"><p>${v.mode==='teach'?'ClassScribe walks you through the lecture and checks your understanding.':'Your study companion asks one question at a time. After you answer, it marks your response correct or incorrect, gives the correct answer, and explains why.'}</p><button class="btn primary" data-act="tutStart">${tutorPortrait('ask-send-avatar')}Start questions</button></div>`:''}
   ${TUT.busy?`<div class="ask-reply">${tutorPortrait()}<div class="msg ai md" id="tut-live">${thinking}</div></div>`:''}</div>
  ${TUT.turns.length?`<form class="composer" data-form="tutor"><textarea id="tut-in" rows="1" placeholder="Your answer…" aria-label="Your answer"></textarea><button class="btn primary" ${TUT.busy?'disabled':''}>Send</button></form>`:''}`;
};
ACT.tutStart=()=>{
   const v=S.view;const lecs=v.lectureIds&&v.lectureIds.length?v.lectureIds.map(lecture).filter(Boolean):lecturesOf(v.courseId).filter(l=>!v.before||l.date<=v.before);
   const weak=weakList(v.courseId).map(w=>w.concept);
    const intro=v.mode==='teach'?`Teach the student this lecture they missed, in 4-6 short parts (under 120 words each). ${v.focus?'Focus narrowly on the cited concept or passage: '+String(v.focus).slice(0,160)+'. ':''}After each part, ask one check-for-understanding question and wait.`
     :`Quiz the student one question at a time (mix multiple choice, short answer and "explain why"). Wait for their answer.${v.mode==='weak'&&weak.length?' Focus on these weak areas: '+weak.join(', ')+'.':''}`;
    TUT.turns=[{role:'user',content:`You are ClassScribe's AI study companion. ${intro} Ask one question at a time and grade attempted answers with a result tag.\n\nMATERIAL:${studyMaterial({courseId:v.courseId,lectureIds:v.lectureIds,before:v.before},24000)}`}];
  tutSend();
};
async function tutSend(){
    if(TUT.busy||TUT.turns.length>1&&TUT.turns.at(-1).role!=='user')return;
   TUT.busy=true;render();const v=S.view,current=TUT,uid=S.uid,billingCode=billingUserCode(),answerIndex=TUT.turns.length-1;
    const courseMaterial=studyMaterial({courseId:v.courseId,lectureIds:v.lectureIds,before:v.before},24000);
    const active=()=>TUT===current&&S.uid===uid&&billingUserCode()===billingCode&&S.view.name==='tutor'
      &&S.view.courseId===v.courseId&&JSON.stringify([S.view.lectureIds,S.view.mode,S.view.focus,S.view.before])===JSON.stringify([v.lectureIds,v.mode,v.focus,v.before]);
  try{
      const r=v.mode==='teach'||v.mode==='weak'
        ? await aiText(TUT.turns.map(t=>({role:t.role,content:t.content})),{cache:false})
         : await CS_STUDY('companion',{material:courseMaterial,replies:TUT.turns.filter(t=>t.role==='assistant').map(t=>t.shown||t.content).slice(-20),answers:TUT.turns.filter((t,i)=>i>0&&t.role==='user').slice(0,-1).map(t=>t.content).slice(-20),answer:answerIndex>0?TUT.turns[answerIndex].content:''});
     if(!active()){if(TUT===current)TUT={key:null};return}
     const result=companionResult(r.text,answerIndex>0?TUT.turns[answerIndex].content:null,courseMaterial),grade=answerIndex>0&&TUT.lastGraded!==answerIndex?result.grade:null;
     if(grade){grade.correct?TUT.score.r++:TUT.score.w++;TUT.lastGraded=answerIndex;record(v.courseId||(lecture((v.lectureIds||[])[0])||{}).courseId,grade.concept,grade.correct)}
     TUT.turns.push({role:'assistant',content:r.text,shown:result.shown});
    if(v.lectureIds)markReviewed(v.lectureIds.filter(id=>isMine(lecture(id))));
   }catch(e){if(!active()){if(TUT===current)TUT={key:null};return}aiErr(e);if(TUT.turns.length===1)TUT.turns=[]}
  TUT.busy=false;render();window.scrollTo(0,document.body.scrollHeight);$('#tut-in')&&$('#tut-in').focus();
}

/* ---------- CLASSMATES (groups) ---------- */
const GRP={code:null,posts:[],nb:null,unsub:[],names:{}};
const EX_POSTS=[{id:'p1',by:'ex1',text:'Does anyone have the diagram from the cell cycle slide? I missed the end of class.',at:Date.now()-86400000*3},{id:'p2',by:'ex2',text:'I shared Monday’s meiosis lecture — check I Missed Class. Crossing over is going to be on the midterm.',at:Date.now()-86400000*2},{id:'p3',by:'bot',bot:true,text:'**Study session: 3 quick questions**\n1. What happens during S phase?\n2. How do you recognize metaphase in a micrograph?\n3. Why is the lagging strand built in fragments?',at:Date.now()-86400000}];
VIEWS.groups=v=>{
  const cs=coursesSorted();const code=v.code||(cs[0]&&cs[0].code);if(!code)return `<div class="empty">Add a course to join its class group.</div>`;
  v.code=code;const tab=v.tab||'discuss';const live=S.mode==='db';const key=codeKey(code);
  const shared=Object.values({...S.shared,...(live?{}:EX_SHARED)}).filter(l=>codeKey(l.code)===key);
  const posts=live?GRP.posts:(Object.values(EX.courses).some(c=>codeKey(c.code)===key)?EX_POSTS:[]);
  let body='';
  if(tab==='discuss')body=`<div class="stack"><form class="composer" data-form="post" style="position:static;margin:0"><textarea id="post-in" rows="2" placeholder="Ask your ${esc(code)} classmates something…" aria-label="Message"></textarea><button class="btn primary" ${live?'':'disabled'}>Post</button></form>
    <div class="row"><button class="btn sm" data-act="studySession" ${live&&!S.busy.sess?'':'disabled'}>${S.busy.sess?thinking:ic('spark')+'Start an AI study session'}</button><span class="small muted">Posts 5 review questions for everyone, drawn from the shared notebook and lectures.</span></div>
    <div class="panel" style="padding:6px 14px"><div class="list" id="posts">${postsHTML(posts)}</div></div></div>`;
  if(tab==='notebook')body=`<section class="panel stack" style="gap:10px"><div class="spread"><h3>Shared notebook · ${esc(code)}</h3><span class="small muted" id="nb-meta">${GRP.nb&&GRP.nb.at?`Last saved ${new Date(GRP.nb.at).toLocaleString()} by <span data-uid="${esc(GRP.nb.by)}">a classmate</span>`:'Empty so far'}</span></div>
    <textarea class="in" id="nb-text" rows="16" ${live?'':'readonly'} placeholder="One notebook for the whole class. Add outlines, formulas, and anything the lectures missed.">${esc(live?(GRP.nb&&GRP.nb.text)||'':'## Unit 1 key diagrams\n- Cell cycle: G1 → S → G2 → M\n- Mitosis stages: PPMAT\n\n(Example notebook)')}</textarea>
    <div class="row"><button class="btn primary" data-act="nbSave" ${live?'':'disabled'}>Save notebook</button><span class="small muted">Everyone in ${esc(code)} can edit. The last save wins, so save often.</span></div></section>`;
  if(tab==='shared')body=`<section class="panel"><div class="list">${shared.map(l=>`<button class="li" ${goAttr({name:'catchup',id:l.id})}><div class="date-tile"><span>${dObj(l.date).toLocaleDateString(undefined,{month:'short'})}</span><b>${dObj(l.date).getDate()}</b></div><div class="grow"><div class="t">${esc(l.title)}</div><div class="small muted">Shared by ${l.by===S.uid?'you':`<span data-uid="${esc(l.by)}">a classmate</span>`}${l.allowCopy?' · copy allowed':''}</div></div><span class="chip ok">I missed class</span></button>`).join('')||'<p class="muted small" style="padding:10px 0">No lectures shared yet. Open one of your lectures and choose Share.</p>'}</div></section>`;
  return `<div class="page-h"><div><p class="eyebrow">Class group</p><h1>${esc(code)} classmates</h1><p class="sub">A private space for everyone in ${esc(code)} who opens ClassScribe.</p></div>
    <div class="row" style="gap:6px">${cs.map(c=>`<button class="btn sm ${c.code===code?'primary':''}" ${goAttr({name:'groups',code:c.code,tab})}>${esc(c.code)}</button>`).join('')}</div></div>
  ${live?'':`<div class="banner" style="margin-bottom:14px"><span>Class groups sync through your claude.ai account. You’re seeing an example group; sign in to claude.ai to post, share and edit together.</span></div>`}
  <div class="tabs" role="tablist">${[['discuss','Discussion'],['notebook','Shared notebook'],['shared',`Shared lectures (${shared.length})`]].map(([k,l])=>`<button role="tab" aria-selected="${tab===k}" ${goAttr({name:'groups',code,tab:k})}>${l}</button>`).join('')}</div>${body}`;
};
function postsHTML(posts){
  const sorted=posts.slice().sort((a,b)=>b.at-a.at);
  const exName={ex1:'Jordan (example)',ex2:'Priya (example)'};
  return sorted.map(p=>`<div class="li" style="align-items:flex-start"><span class="brand-mark" style="width:30px;height:30px;border-radius:50%;flex:none;${p.bot?'':'background:var(--surface-2);color:var(--muted)'}">${p.bot?ic('spark').replace('<svg','<svg width="16" height="16"'):ic('users').replace('<svg','<svg width="15" height="15"')}</span><div class="grow"><div class="small"><b>${p.bot?'ClassScribe study session':p.by===S.uid?'You':exName[p.by]?esc(exName[p.by]):`<span data-uid="${esc(p.by)}">Classmate</span>`}</b> <span class="muted">· ${new Date(p.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span></div><div class="md small">${md(p.text)}</div></div></div>`).join('')||'<p class="muted small" style="padding:12px 0">No messages yet. Start the conversation.</p>';
}
async function fillNames(){
  if(!DB)return;const ids=[...new Set($$('[data-uid]').map(e=>e.dataset.uid).filter(x=>x&&!x.startsWith('ex')&&x!=='example'))];if(!ids.length)return;
  await Promise.all(ids.filter(id=>!(id in GRP.names)).map(async id=>{try{const s=await DB.doc('members/'+id).get();GRP.names[id]=s.exists?(s.data().name||''):''}catch(e){GRP.names[id]=''}}));
  $$('[data-uid]').forEach(e=>{const id=e.dataset.uid;if(id===S.uid)e.textContent='you';else if(GRP.names[id])e.textContent=GRP.names[id]})
}
AFTER.groups=v=>{
  fillNames();
  if(S.mode!=='db')return;const key=codeKey(v.code);if(GRP.code===key)return;
  GRP.unsub.forEach(u=>u());GRP.unsub=[];GRP.code=key;GRP.posts=[];GRP.nb=null;
  GRP.unsub.push(DB.collection('posts').where('code','==',key).onSnapshot(snap=>{GRP.posts=snap.docs.map(d=>({...d.data(),id:d.id}));const el=$('#posts');if(el){el.innerHTML=postsHTML(GRP.posts);fillNames()}},()=>{}));
  GRP.unsub.push(DB.doc('notebooks/'+key).onSnapshot(snap=>{GRP.nb=snap.exists?snap.data():null;const t=$('#nb-text');if(t&&document.activeElement!==t)t.value=(GRP.nb&&GRP.nb.text)||'';const m=$('#nb-meta');if(m&&GRP.nb&&GRP.nb.at){m.innerHTML=`Last saved ${new Date(GRP.nb.at).toLocaleString()} by <span data-uid="${esc(GRP.nb.by)}">a classmate</span>`;fillNames()}},()=>{}));
  LEAVE=null;
};
AFTER.course=v=>{fillNames();if(v.tab==='assign'&&v.assignmentId)setTimeout(()=>document.getElementById('assignment-'+v.assignmentId)?.scrollIntoView({block:'center',behavior:'smooth'}),0)};
ACT.nbSave=async()=>{try{await DB.doc('notebooks/'+codeKey(S.view.code)).set({text:$('#nb-text').value,by:S.uid,at:Date.now()});toast('Notebook saved')}catch(e){toast('Couldn’t save: '+(e.message||e.code))}};
ACT.studySession=async()=>{
  const code=S.view.code;const key=codeKey(code);S.busy.sess=true;render();
  const shared=Object.values(S.shared).filter(l=>codeKey(l.code)===key);const mine=lecturesOf().filter(l=>codeKey((course(l.courseId)||{}).code)===key);
  try{const r=await CS_STUDY('group',{material:`Course: ${code}\nSHARED NOTEBOOK:\n${((GRP.nb&&GRP.nb.text)||'').slice(0,6000)}\nLECTURES:${material([...shared,...mine],14000)}`});
    await DB.collection('posts').add({code:key,by:S.uid,bot:true,text:r.text.trim(),at:Date.now()});}
  catch(e){aiErr(e)}
  S.busy.sess=false;render();
};

/* ---------- global events ---------- */
document.addEventListener('click',e=>{
  if(e.target.classList&&e.target.classList.contains('scrim')){closeModal();return}
  const a=e.target.closest('[data-act]');
  if(a&&a.dataset.act==='close'){closeModal();return}
  if(a&&a.dataset.act==='copybox'){copyText($('#copybox').value);return}
  const g=e.target.closest('[data-go]');
  if(g){e.preventDefault();if($('#modal-root').innerHTML)closeModal();go(JSON.parse(g.dataset.go));return}
  if(a&&ACT[a.dataset.act]){e.preventDefault();ACT[a.dataset.act](a,e)}
});
ACT.hideEx=async()=>{S.showEx=false;S.showExReady=true;render();try{await setExamplePreference(false)}catch(e){toast('Your choice is saved on this device and will retry: '+((e&&e.message)||'offline'))}toast('Examples hidden. Bring them back from the Account page.')};
ACT.showEx=async()=>{S.showEx=true;S.showExReady=true;render();try{await setExamplePreference(true)}catch(e){toast('Your choice is saved on this device and will retry: '+((e&&e.message)||'offline'))}toast('Example courses are back')};
ACT.confirmAssignmentDate=async el=>{
  const a=S.assignments[el.dataset.id];if(!a||isExampleRecord('assignments',a)||!a.due||assignmentDateConfirmed(a))return;
  if(!confirm(`Confirm ${a.title} is due ${fmtLong(a.due)}? This date will then appear in your Home deadline alerts on Student or Pro.`))return;
  await put('assignments',{...a,dateConfirmed:true});toast('Date confirmed');
};
ACT.icsAll=()=>{const items=Object.values(allA()).filter(a=>a.due&&!a.done&&daysUntil(a.due)>=0);if(!items.length){toast('No upcoming dated assignments.');return}download('ClassScribe assignments.ics',ics(items))};
ACT.icsCourse=el=>{const c=course(el.dataset.id);const items=assignOf(c.id).filter(a=>a.due);if(!items.length){toast('No dated assignments in this course yet.');return}download(`${c.code} assignments.ics`,ics(items))};
ACT.delCourse=el=>{const c=course(el.dataset.id);if(!c||isExampleRecord('courses',c))return;if(el.dataset.armed){lecturesOf(c.id).forEach(l=>del('lectures',l.id));assignOf(c.id).forEach(a=>del('assignments',a.id));notesOf(c.id).forEach(n=>del('notes',n.id));del('courses',c.id);go({name:'home'});toast('Course removed');return}el.dataset.armed='1';el.innerHTML='Tap again to remove this course and its lectures';el.style.color='var(--rec)'};
document.addEventListener('submit',async e=>{
  const f=e.target.closest('[data-form]');if(!f)return;e.preventDefault();const k=f.dataset.form;
  if(k==='addCourse'){
    if(f.dataset.saving)return;
    if(courseLimitReached()){const message=$('#course-save-error');if(message)message.textContent=courseLimitNotice();void loadBillingStatus(true,billingUserCode());return}
    f.dataset.saving='1';
    const submit=f.querySelector('button[type="submit"]');
    if(submit){submit.disabled=true;submit.textContent='Saving course…'}
    const c={id:uid(),code:$('#nc-code').value.trim().toUpperCase(),name:$('#nc-name').value.trim(),professor:$('#nc-prof').value.trim(),semester:$('#nc-sem').value.trim()||curSemester(),color:Object.keys(allC()).length%6,created:Date.now()};
    try{await put('courses',c,{requireAck:true})}
    catch(error){
      delete f.dataset.saving;
      if(submit){submit.disabled=false;submit.innerHTML=ic('plus')+'Add course'}
      const message=$('#course-save-error');if(message)message.textContent=courseSaveErrorMessage(error);
      if(error&&error.code==='plan_limit')void loadBillingStatus(true,billingUserCode());
      return
    }
    closeModal();go({name:'course',id:c.id})
  }
  if(k==='addA'){const v=S.view;const c=course(v.id);if(!c||isExampleRecord('courses',c))return;const t=$('#na-title').value.trim();if(!t)return;const due=$('#na-due').value;await put('assignments',{id:uid(),courseId:v.id,title:t,type:$('#na-type').value,due,done:false,dateConfirmed:!!due,ex:!!c.ex});toast('Assignment added')}
  if(k==='startRec'){
    if(f.dataset.starting)return;
     if(!PRIVACY_CONFIG){const out=$('#capture-course-error');if(out)out.textContent='The current consent text could not be verified. Recording did not start.';return}
     if(!$('#consent1')?.checked||!$('#consent2')?.checked){const out=$('#capture-course-error');if(out)out.textContent='Confirm both permission and privacy statements before recording.';return}
    const audioSource=$('#cap-audio-source')?.value==='online'?'online':'microphone';
    if(audioSource==='online'&&!$('#cap-online-consent')?.checked){const out=$('#capture-course-error');if(out)out.textContent='Confirm permission to record the online lecture before choosing its tab.';return}
    const setupView=S.view,setupLibrary=billingUserCode();
    let sharedTabStream=null,handedOff=false;
    f.dataset.starting='1';updateCaptureAudioSource();
    try{
    if(audioSource==='online'){
      sharedTabStream=await prepareOnlineCapture();
      if(S.view!==setupView||billingUserCode()!==setupLibrary)return;
    }
    const submittedCourse=course($('#cap-course').value);if(submittedCourse&&isExampleRecord('courses',submittedCourse)){toast('Example courses are read-only. Choose or add a course before recording.');return}
    let cid=$('#cap-course').value;
    const form={title:$('#cap-title').value.trim(),module:$('#cap-module').value.trim(),date:$('#cap-date').value,code:($('#cap-code')||{}).value||'',cname:($('#cap-cname')||{}).value||''};
    try{
      if(cid==='__new'){if(courseLimitReached()){const message=$('#capture-course-error');if(message)message.textContent=courseLimitNotice();void loadBillingStatus(true,billingUserCode());return}const code=form.code.trim().toUpperCase(),name=form.cname.trim();if(!code||!name){toast('Enter a course code and name.');return}const c={id:uid(),code,name,professor:'',semester:curSemester(),color:Object.keys(allC()).length%6,created:Date.now()};await put('courses',c,{requireAck:true});cid=c.id}
     }catch(error){const message=$('#capture-course-error');if(message)message.textContent=courseSaveErrorMessage(error);else toast(courseSaveErrorMessage(error));if(error&&error.code==='plan_limit')void loadBillingStatus(true,billingUserCode());return}
     const billingCode=billingUserCode(),consentCode=privacyLibraryCode();
     const retryRecordingId=reusableReserveRetryId(billingCode,cid);
     if(!retryRecordingId){delete f.dataset.privacySessionId;delete f.dataset.privacyConsentId;delete f.dataset.privacyLectureId}
     const recordingId=retryRecordingId||uid();
     saveReserveRetryId(billingCode,recordingId);
     const consent=currentCaptureConsentRecord(f,cid,recordingId);
     try{
       localStorage.setItem(captureConsentDraftKey(consentCode),JSON.stringify(consent));
       const persisted=await persistRecordingConsent(consent,consentCode);
       if(persisted.queued){const message=$('#capture-course-error');if(message)message.textContent='Your consent is saved in this browser. Connect to the internet so it can be uploaded before recording starts.';return}
       consent.consentId=persisted.consentId||consent.consentId;
       localStorage.setItem(captureConsentDraftKey(consentCode),JSON.stringify(consent));
     }catch(error){const message=$('#capture-course-error');if(message)message.textContent=`Consent was not saved, so recording did not start: ${error.message||'try again'}`;return}
    try{await billingRecordingAction('reserve',recordingId,billingCode,consent);clearReserveRetryId(billingCode)}
    catch(error){
      if(error&&error.code==='credits_cancelled'){
        clearReserveRetryId(billingCode);
        try{localStorage.removeItem(captureConsentDraftKey(consentCode))}catch(e){}
        delete f.dataset.privacySessionId;delete f.dataset.privacyConsentId;delete f.dataset.privacyLectureId;
        const out=$('#capture-course-error');if(out)out.textContent='Recording was not started. No credits were used. Start again to create a fresh consent session.';return
      }
      const message=error&&error.message||'Could not reserve a recording on your plan. Check your connection and retry.';
      const out=$('#capture-course-error');if(out)out.textContent=`Recording could not start: ${message}`;else toast(`Recording could not start: ${message}`);
      void loadBillingStatus(true,billingCode);return;
    }
     if(S.view!==setupView||billingUserCode()!==setupLibrary){await releaseRecordingReservation({recordingId,billingCode,reservationState:'reserved'},true);return}
     SES={step:'live',audioSource,sharedTabStream,courseId:cid,title:form.title||'Lecture '+fmtD(todayISO()),module:form.module,date:form.date||todayISO(),acc:0,resumeAt:Date.now(),running:true,segs:[],marks:[],slides:[],spk:'P',src:'type',draft:'',lineStart:null,recordingId,billingCode,reservationState:'reserved',consentId:consent.consentId,sessionId:consent.sessionId,lectureId:consent.lectureId};
     handedOff=true;
     try{localStorage.removeItem(captureConsentDraftKey(consentCode))}catch(e){}
    const session=SES;
    render();startTick();window.scrollTo(0,0);void micStart(session);
    }catch(error){const out=$('#capture-course-error');if(out)out.textContent=error.message||'Could not start tab recording.';else toast(error.message||'Could not start recording.')}
    finally{if(!handedOff)stopCaptureTracks(sharedTabStream);delete f.dataset.starting;updateCaptureAudioSource()}
  }
  if(k==='welcome'||k==='account'){
    const previous=k==='account'?ACCOUNT_FORM_BASELINE||S.profile||{}:null,p=readProfileForm(previous);
    if(!p.firstName){toast('Enter your first name.');return}
    if(k==='welcome'){
      const band=p.ageBand;
      if(band==='under13'){updateWelcomeAgeGate();return}
      if(!['13-17','18+'].includes(band)){const message=$('#pf-age-gate-message');if(message){message.hidden=false;message.textContent='Choose your birth month and year to confirm whether you may create a library. Your birth date is not saved.'}return}
    }else if(p.ageBand&&!['13-17','18+'].includes(p.ageBand)){toast('Choose an age band, not a date of birth.');return}
    const patch=k==='welcome'?p:Object.fromEntries(['firstName','lastName','school','level','major','term','learningMode','ageBand'].filter(key=>p[key]!==previous[key]).map(key=>[key,p[key]]));
    try{await saveProfile(patch)}catch(err){toast('Couldn’t save your account: '+(err.message||err.code));return}
    if(S.mode==='db'&&S.uid&&p.ageBand==='13-17')try{await DB.doc('members/'+S.uid).set({name:p.firstName||'Student',school:p.school||'',at:Date.now()})}catch(e){}
    if((p.ageBand==='13-17'||p.ageBand==='18+')&&S.mode==='db'&&clerkClient&&clerkClient.user){
      try{await persistProfileAgeBand(p.ageBand)}catch(err){toast('Your age band is saved in this library but could not yet be verified on the server: '+(err.message||'try again'))}
    }
    GRP.names={};
    if(k==='welcome'){go({name:'plans',onboarding:true});toast('Welcome to ClassScribe, '+p.firstName)}else{render();toast('Account saved')}
  }
  if(k==='ask')sendAsk();
  if(k==='tutor'){const t=$('#tut-in').value.trim();if(!t||TUT.busy)return;TUT.turns.push({role:'user',content:t});tutSend()}
  if(k==='post'){const t=$('#post-in').value.trim();if(!t||!DB)return;try{await DB.collection('posts').add({code:codeKey(S.view.code),by:S.uid,text:t,at:Date.now()});$('#post-in').value=''}catch(err){toast('Couldn’t post: '+(err.message||err.code))}}
});
document.addEventListener('change',e=>{
  const t=e.target;
  if(['consent1','consent2','cap-audio-source','cap-online-consent'].includes(t.id))updateCaptureAudioSource();
  if(t.id==='cap-course'){$('#cap-newc').hidden=t.value!=='__new'}
  if(t.id==='mynotes'){const l=lecture(t.dataset.lec);if(l&&isMine(l)&&!isExampleRecord('lectures',l)&&t.value!==(l.myNotes||'')){put('lectures',{...l,myNotes:t.value});toast('Notes saved')}}
  if(t.dataset.toggleA){const a=allA()[t.dataset.toggleA];if(a&&!isExampleRecord('assignments',a))put('assignments',{...a,done:t.checked})}
  if(t.dataset.reviewed){const l=lecture(t.dataset.reviewed);if(l&&!isExampleRecord('lectures',l))put('lectures',{...l,reviewed:t.checked})}
  if(t.id==='slidefile'&&t.files[0]){onSlide(t.files[0]);t.value=''}
  if(t.id==='importfile'&&t.files[0]){onImport(t.files[0]);t.value=''}
  if(t.id==='syl-file'&&t.files[0]){t.files[0].text().then(x=>{$('#syl-text').value=x})}
  if(t.id==='spk'&&SES)SES.spk=t.value;
  if(t.id==='ask-retrieval'&&t.value!==CHAT.retrieval){CHAT.retrieval=t.value==='keyword'?'keyword':'semantic';CHAT.coverage='';CHAT.epoch++;CHAT.ab&&CHAT.ab.abort();CHAT.ab=null;CHAT.context=null;CHAT.busy=false;CHAT.turns=[];render()}
  if(t.id==='ask-scope'&&t.value!==CHAT.scope){clearInterval(ASK_LIBRARY_WATCH);ASK_LIBRARY_WATCH=null;CHAT.context=null;CHAT.scope=t.value;CHAT.coverage='';CHAT.epoch++;CHAT.ab&&CHAT.ab.abort();CHAT.ab=null;CHAT.busy=false;CHAT.turns=[];render()}
  if(t.id==='note-course'){const n=noteById(t.dataset.note);if(n&&!isExampleRecord('notes',n))put('notes',{...n,courseId:t.value,lectureId:'',updated:Date.now()})}
  if(t.id==='note-lec'){const n=noteById(t.dataset.note);if(n&&!isExampleRecord('notes',n))put('notes',{...n,lectureId:t.value,updated:Date.now()})}
  if(t.id==='exam-course'){go({name:'exam',courseId:t.value})}
  if(t.id==='em-what'){const l=lecture(t.dataset.lec);$('#emailbody').value=lectureText(l,t.value);updMailto()}
});
document.addEventListener('input',e=>{
  const t=e.target;
  if(t.id==='typebox'&&SES){if(SES.lineStart==null&&t.value.trim())SES.lineStart=nowT();if(!t.value.trim())SES.lineStart=null;SES.draft=t.value}
  if(t.id==='pastebox'&&SES)SES.paste=t.value;
  if(t.id==='capnotes'&&SES)SES.notes=t.value;
  if((t.id==='note-title'||t.id==='note-body')&&t.dataset.note)saveNoteSoon(t.dataset.note);
  if(t.id==='note-body'){t.style.height='auto';t.style.height=Math.max(360,t.scrollHeight+4)+'px'}
  if(t.id==='note-q'){NOTE_UI.q=t.value;const li=$('#note-list');if(li)li.innerHTML=noteListHTML(S.view)}
  if(t.id==='em-to'||t.id==='em-subj'||t.id==='emailbody')updMailto();
  if(t.tagName==='TEXTAREA'&&t.closest('.composer')){t.style.height='auto';t.style.height=Math.min(160,t.scrollHeight)+'px'}
});
document.addEventListener('mousedown',e=>{if(e.target.closest('.fmt'))e.preventDefault()});
document.addEventListener('keydown',e=>{
  const t=e.target;
  if(t.id==='note-body'&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='b'){e.preventDefault();ACT.fmt({dataset:{f:'b'}})}
  if(t.id==='gsearch'&&e.key==='Enter'){const q=t.value.trim();S.q=q;if(q)go({name:'search',q})}
  if(t.id==='typebox'&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();ACT.recAdd()}
  if((t.id==='ask-in'||t.id==='tut-in'||t.id==='post-in')&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();t.closest('form').requestSubmit()}
});
const _go=go;go=function(v){if(S.view.name==='groups'&&v.name!=='groups'){GRP.unsub.forEach(u=>u());GRP.unsub=[];GRP.code=null}_go(v)};
if(SES)startTick();
initStore().then(()=>{creditsReturnNotice();billingReturnNotice()});
