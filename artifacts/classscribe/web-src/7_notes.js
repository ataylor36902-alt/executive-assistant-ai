/* ---------- NOTES ---------- */
EX.notes={
  'ex-n1':{id:'ex-n1',ex:true,courseId:'ex-bio',lectureId:'ex-bio-2',pinned:true,title:'Mitosis — my shorthand',created:1,updated:Date.now()-86400000*13,
    body:'## Stages (PPMAT)\n- **Prophase**: chromatin → chromosomes, 2 sister chromatids\n- **Metaphase**: ONE line in the middle ← she said this twice!\n- **Anaphase**: chromatids pulled apart (kinetochore + spindle)\n- **Telophase**: nuclei re-form\n\n⭐ Mitosis does NOT copy DNA (that was S phase)\n\n## Animal vs plant\n- Animal: cleavage furrow\n- Plant: cell plate'},
  'ex-n2':{id:'ex-n2',ex:true,courseId:'ex-chem',lectureId:'',pinned:false,title:'Exam 1 formula sheet',created:2,updated:Date.now()-86400000*2,
    body:'## Must memorize\n- 1 mol = **6.022 × 10²³** particles\n- moles = grams ÷ molar mass\n- % yield = actual ÷ theoretical × 100\n\n## Limiting reagent steps\n1. Balance the equation\n2. Convert each reactant → moles of product\n3. Smaller amount = limiting\n\n⭐ Sig figs are graded. Bring a calculator, no phones.'},
  'ex-n3':{id:'ex-n3',ex:true,courseId:'ex-bio',lectureId:'',pinned:false,title:'Questions for office hours',created:3,updated:Date.now()-86400000*5,
    body:'- [x] Do we need the checkpoint proteins? (No, names only)\n- [ ] Difference between chromatin and chromosome?\n- [ ] Will micrographs on the midterm be color or B&W?'}
};
const allN=()=>({...(S.showEx?EX.notes:{}),...S.notes});
const noteById=id=>S.notes[id]||EX.notes[id];
const notesOf=cid=>Object.values(allN()).filter(n=>!cid||n.courseId===cid).sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||(b.updated||0)-(a.updated||0));
const SOURCE_NOTE_TYPES=['syllabus','reading','study-guide'];
const sourceNotesOf=cid=>Object.values(S.notes).filter(n=>n&&n.courseId===cid&&SOURCE_NOTE_TYPES.includes(n.sourceType)&&n.body&&!isExampleRecord('notes',n));
const NOTE_UI={mode:'write',q:'',ai:null,focus:null};
function snippet(t,n=110){const s=String(t||'').replace(/^#+\s*/gm,'').replace(/[*`>]|- \[[ x]\]/g,'').replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n)+'…':s}
function whenStr(ts){if(!ts)return'';const d=Date.now()-ts;if(d<6e4)return'just now';if(d<36e5)return Math.round(d/6e4)+' min ago';if(d<864e5)return Math.round(d/36e5)+' h ago';return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'})}
function noteListHTML(v){
  const cid=v.courseId||null;const q=NOTE_UI.q.toLowerCase();
  const list=notesOf(cid).filter(n=>!q||(n.title+' '+n.body).toLowerCase().includes(q));
  const lecs=lecturesOf(cid).filter(l=>(l.analysis&&l.analysis.notes)||l.myNotes).filter(l=>!q||(l.title+' '+((l.analysis&&l.analysis.notes)||'')+' '+(l.myNotes||'')).toLowerCase().includes(q)).reverse();
  return `<p class="eyebrow" style="padding:4px 4px 2px">My notes · ${list.length}</p>
  ${list.map(n=>{const c=course(n.courseId);return `<button class="li note-li" ${goAttr({name:'notes',courseId:v.courseId,id:n.id})} aria-current="${v.id===n.id}"><span class="grow"><span class="row" style="gap:6px;flex-wrap:nowrap"><span class="t" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.pinned?'📌 ':''}${esc(n.title||'Untitled note')}</span><span class="small muted" style="white-space:nowrap">${whenStr(n.updated)}</span></span><span class="small muted" style="display:block">${esc(snippet(n.body,90))||'Empty'}</span><span class="row" style="gap:4px;margin-top:4px">${c?codeChip(c):''}${n.sourceType?`<span class="chip">Private ${esc(n.sourceType)}</span>`:''}${n.lectureId&&lecture(n.lectureId)?`<span class="chip">${fmtD(lecture(n.lectureId).date)} lecture</span>`:''}</span></span></button>`}).join('')||`<p class="small muted" style="padding:8px 4px">${q?'No notes match.':'No notes yet.'}</p>`}
  ${lecs.length?`<p class="eyebrow" style="padding:14px 4px 2px">Smart notes from lectures</p>${lecs.slice(0,12).map(l=>`<button class="li note-li" ${goAttr({name:'lecture',id:l.id,tab:'notes'})}><span class="grow"><span class="t">${esc(l.title)}</span><span class="small muted" style="display:block">${esc((course(l.courseId)||{}).code||'')} · ${fmtD(l.date)} · ${l.myNotes?'smart notes + your notes':'smart notes'}</span></span></button>`).join('')}`:''}`;
}
VIEWS.notes=v=>{
  const cs=coursesSorted();const cid=v.courseId||'';const n=v.id?noteById(v.id):null;
  const selectedCourse=cid&&course(cid);
  return `<div class="page-h"><div><p class="eyebrow">Notes</p><h1>Notes</h1><p class="sub">Write your own notes by course or lecture. Import private syllabi, readings, or study guides as text sources.</p></div>
    ${selectedCourse&&selectedCourse.ex||n&&isExampleRecord('notes',n)?'':`<div class="row"><button class="btn" data-act="importSource" data-cid="${esc(cid)}">${ic('upload')}Import source</button><button class="btn primary" data-act="newNote" data-cid="${esc(cid)}">${ic('plus')}New note</button></div>`}</div>
  <div class="row" style="margin-bottom:14px;gap:6px"><button class="btn sm ${!cid?'primary':''}" ${goAttr({name:'notes'})}>All courses</button>${cs.map(c=>`<button class="btn sm ${cid===c.id?'primary':''}" ${goAttr({name:'notes',courseId:c.id})}>${esc(c.code)}</button>`).join('')}</div>
  <div class="notes-grid ${n?'has-sel':''}">
    <aside class="panel notes-list"><label class="search" style="max-width:none;margin-bottom:8px">${ic('search')}<input id="note-q" type="search" placeholder="Filter notes" value="${esc(NOTE_UI.q)}" aria-label="Filter notes"></label><div class="list" id="note-list">${noteListHTML(v)}</div></aside>
      <section>${n?noteEditor(n,v):`<div class="empty" style="padding:48px 20px"><p><b>Pick a note or start a new one.</b></p><p class="small" style="margin-top:6px">Tip: while recording, use the <b>My notes</b> tab to jot notes that are saved with that lecture.</p>${selectedCourse&&selectedCourse.ex?'':`<button class="btn primary" style="margin-top:14px" data-act="newNote" data-cid="${esc(cid)}">${ic('plus')}New note</button>`}</div>`}</section>
  </div>`;
};
function noteEditor(n,v){
  const cs=coursesSorted();const lecs=n.courseId?lecturesOf(n.courseId):[];const mode=NOTE_UI.mode;const ai=NOTE_UI.ai&&NOTE_UI.ai.id===n.id?NOTE_UI.ai:null;const readonly=isExampleRecord('notes',n);
  const F=[['h','H','Heading'],['b','<b>B</b>','Bold'],['li','•','Bullet list'],['todo','☐','Checklist item'],['star','⭐','Mark important'],['ts','⏱','Insert date &amp; time (or link a lecture moment)']];
  return `<div class="panel stack note-ed" style="gap:12px">
    <button class="btn ghost sm only-m" ${goAttr({name:'notes',courseId:v.courseId})} style="align-self:flex-start">${ic('back')}All notes</button>
    <input class="note-title" id="note-title" data-note="${esc(n.id)}" value="${esc(n.title)}" placeholder="Untitled note" aria-label="Note title" ${readonly?'readonly':''}>
    <div class="row small" style="gap:8px">
      <select class="in" id="note-course" data-note="${esc(n.id)}" style="width:auto" aria-label="Course" ${readonly?'disabled':''}><option value="">No course</option>${cs.map(c=>`<option value="${esc(c.id)}" ${c.id===n.courseId?'selected':''}>${esc(c.code)}</option>`).join('')}</select>
      <select class="in" id="note-lec" data-note="${esc(n.id)}" style="width:auto;max-width:100%" aria-label="Linked lecture" ${readonly||n.sourceType||!lecs.length?'disabled':''}><option value="">Not linked to a lecture</option>${lecs.map(l=>`<option value="${esc(l.id)}" ${l.id===n.lectureId?'selected':''}>${fmtD(l.date)} · ${esc(l.title)}</option>`).join('')}</select>
      <span class="muted" id="note-saved">${readonly?'Example note · read-only':n.sourceType?`Private source · ${esc(n.sourceType)} · saved in your library`:'Saved '+whenStr(n.updated)}</span>
    </div>
    <div class="note-tools">
      <div class="seg-toggle" role="tablist"><button role="tab" aria-selected="${mode==='write'}" data-act="noteMode" data-m="write">Write</button><button role="tab" aria-selected="${mode==='preview'}" data-act="noteMode" data-m="preview">Preview</button></div>
      ${mode==='write'&&!readonly?`<div class="row" style="gap:2px">${F.map(([k,l,t])=>`<button class="btn ghost sm fmt" data-act="fmt" data-f="${k}" title="${t}" aria-label="${t}">${l}</button>`).join('')}</div>`:''}
      <span style="flex:1"></span>
      ${readonly?'':`<button class="btn sm" data-act="noteAI" data-id="${esc(n.id)}" ${ai&&ai.busy?'disabled':''}>${ic('spark')}Organize with AI</button>
      <button class="btn ghost sm" data-act="notePin" data-id="${esc(n.id)}" title="${n.pinned?'Unpin':'Pin to top'}">${n.pinned?'📌 Pinned':'Pin'}</button>`}
      <button class="btn ghost sm" data-act="noteEmail" data-id="${esc(n.id)}" title="Email">${ic('mail')}</button>
      <button class="btn ghost sm" data-act="noteExport" data-id="${esc(n.id)}" title="Export">${ic('download')}</button>
      ${readonly?'':`<button class="btn ghost sm" data-act="noteDel" data-id="${esc(n.id)}" title="Delete note">${ic('x')}</button>`}
    </div>
    ${n.sourceType?`<p class="small muted">Private course source${n.sourceName?' · '+esc(n.sourceName):''}. The original file is not retained. ${S.mode==='db'?'Saved to this signed-in library.':'Saved in this browser.'} Analysis and study actions require AI-sharing permission.</p>`:''}
    ${n.sourceAnalysis?`<section class="panel"><h3>Document summary</h3><p>${esc(n.sourceAnalysis.summary)}</p><h3>Key points</h3><ul>${(n.sourceAnalysis.keyPoints||[]).map(p=>`<li>${esc(p)}</li>`).join('')}</ul><p class="small muted">AI analysis · check against the source below.</p></section>`:''}
    ${mode==='write'?`<textarea class="in note-body" id="note-body" data-note="${esc(n.id)}" maxlength="30000" placeholder="Start typing…  Use ## for headings, - for bullets, - [ ] for checklists." ${readonly?'readonly':''}>${esc(n.body)}</textarea>`
      :`<div class="md note-preview">${md(n.body)||'<p class="muted">Nothing written yet.</p>'}</div>`}
    ${n.prevBody&&!ai&&!readonly?`<div class="row small muted"><span>ClassScribe reorganized this note.</span><button class="btn ghost sm" data-act="noteRestore" data-id="${esc(n.id)}">Restore my original</button></div>`:''}
    ${ai&&!readonly?`<div class="panel" style="background:var(--surface-2)"><div class="spread"><h3>${ic('spark').replace('<svg','<svg width="16" height="16" style="vertical-align:-2px"')} Organized version</h3>${ai.busy?'':`<div class="row"><button class="btn primary sm" data-act="noteApply" data-id="${esc(n.id)}">Replace my note</button><button class="btn sm" data-act="noteAppend" data-id="${esc(n.id)}">Add below</button><button class="btn ghost sm" data-act="noteDiscard">Discard</button></div>`}</div><div class="md" id="note-ai-out" style="margin-top:8px">${ai.text?md(ai.text):thinking}</div></div>`:''}
  </div>`;
}
AFTER.notes=v=>{
  if(NOTE_UI.focus&&NOTE_UI.focus===v.id){const t=$('#note-title');if(t)t.focus();NOTE_UI.focus=null}
  const b=$('#note-body');if(b){b.style.height='auto';b.style.height=Math.max(360,b.scrollHeight+4)+'px'}
};
let NOTE_T=null;
function saveNoteSoon(id){clearTimeout(NOTE_T);const s=$('#note-saved');if(s&&!(noteById(id)||{}).ex)s.textContent='Saving…';NOTE_T=setTimeout(()=>saveNote(id),700)}
function saveNote(id){
  const n=noteById(id);if(!n||isExampleRecord('notes',n))return;const t=$('#note-title'),b=$('#note-body');
  const upd={...n,title:t?t.value:n.title,body:b?b.value.slice(0,30000):n.body,updated:Date.now()};
  if(upd.title===n.title&&upd.body===n.body)return;put('notes',upd);const s=$('#note-saved');if(s&&!n.ex)s.textContent='Saved just now';
  const li=$('#note-list');if(li)li.innerHTML=noteListHTML(S.view);
}
ACT.newNote=el=>{
  const now=Date.now();const cid=el.dataset.cid||'';const c=course(cid);const l=el.dataset.lid&&lecture(el.dataset.lid);
  if(c&&c.ex||l&&l.ex){toast('Example content is read-only.');return}
  const n={id:uid(),courseId:cid,lectureId:el.dataset.lid||'',title:el.dataset.title||'',body:'',pinned:false,created:now,updated:now,ex:false};
  put('notes',n);NOTE_UI.mode='write';NOTE_UI.focus=n.id;go({name:'notes',courseId:S.view.name==='notes'?S.view.courseId:undefined,id:n.id});
};
function capturePrivateSourceScope(courseId){return{uid:S.uid,mode:S.mode,courseId}}
function privateSourceScopeIsCurrent(scope){
  const c=scope&&course(scope.courseId);
  return !!scope&&S.uid===scope.uid&&S.mode===scope.mode&&!!c&&!c.ex;
}
function privateSourceImporterIsCurrent(scope,form){
  const select=form&&form.querySelector('#source-course');
  return privateSourceScopeIsCurrent(scope)&&!!form.isConnected&&!!select&&select.value===scope.courseId;
}
async function writePrivateSource(note,scope){
  if(!scope||note.courseId!==scope.courseId||!privateSourceScopeIsCurrent(scope))throw new Error('The active library or course changed. No source was saved; reopen the importer in the intended library.');
  if(isExampleRecord('notes',note))throw new Error('Example course sources are read-only.');
  if(scope.mode==='db'){
    if(!scope.uid||!DB||typeof DB.doc!=='function')throw new Error('The signed-in library is unavailable. No source was saved.');
    await DB.doc('data/users/'+scope.uid+'/lib').collection('notes').doc(note.id).set(clone(note));
    if(!privateSourceScopeIsCurrent(scope))return false;
    S.notes[note.id]=note;schedule();return true;
  }
  if(scope.mode==='local'){
    const notes={...S.notes,[note.id]:note};
    const library=Object.fromEntries(COLS.map(c=>[c,c==='notes'?notes:S[c]]));
    localStorage.setItem('cs_lib',JSON.stringify(library));
    S.notes=notes;schedule();return true;
  }
  throw new Error('This library cannot save private sources.');
}
ACT.importSource=el=>{
  const cs=coursesSorted().filter(c=>!c.ex),cid=el.dataset.cid||'';
  if(!cs.length){toast('Add a course before importing a source.');return}
  openModal(`<div class="spread"><h2>Import a private source</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
   <p class="small muted">Free, Student, and Pro can import PDF, TXT, or MD documents and get a summary and key points. Only extracted text and analysis are saved privately—not the original file. Student and Pro exam practice and quizzes use sources from the selected course. AI analysis requires your AI-sharing permission.</p>
  <form class="stack" data-form="importSource">
    <label class="f">Course<select class="in" id="source-course" required><option value="">Choose a course</option>${cs.map(c=>`<option value="${esc(c.id)}" ${c.id===cid?'selected':''}>${esc(c.code)} · ${esc(c.name)}</option>`).join('')}</select></label>
    <label class="f">Source type<select class="in" id="source-type" required><option value="syllabus">Syllabus</option><option value="reading">Reading</option><option value="study-guide">Study guide</option></select></label>
    <label class="f">Title<input class="in" id="source-title" maxlength="200" placeholder="e.g. Week 2 reading"></label>
    <label class="f">Paste text<textarea class="in" id="source-text" rows="9" maxlength="30000" placeholder="Paste source text here (up to 30,000 characters)"></textarea></label>
    <label class="f">Or choose a file (PDF, TXT, or MD; max 8 MB)<input class="in" id="source-file" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain"></label>
    <p class="small muted" id="source-import-status" role="status">The file is extracted for this import and is not stored as a raw file.</p>
     <label class="row small"><input type="checkbox" id="source-analyze" checked>Analyze this document and provide key points (all plans). Uncheck to save without AI.</label>
     <div class="row"><button class="btn primary" id="source-import-submit">${ic('upload')}Import document</button></div>
  </form>`,{wide:true});
};
document.addEventListener('submit',async e=>{
  const form=e.target.closest('[data-form="importSource"]');if(!form)return;e.preventDefault();
  const courseId=$('#source-course').value,type=$('#source-type').value,file=$('#source-file').files[0],paste=$('#source-text').value;
   const titleInput=$('#source-title'),status=$('#source-import-status'),submit=$('#source-import-submit'),analyze=$('#source-analyze')?.checked!==false;
   if(submit?.disabled)return;
  if(!courseId||!course(courseId)||course(courseId).ex){status.textContent='Choose one of your own courses.';return}
  if(!SOURCE_NOTE_TYPES.includes(type)){status.textContent='Choose a supported source type.';return}
  if(file&&paste.trim()){status.textContent='Choose either a file or pasted text, not both.';return}
  const scope=capturePrivateSourceScope(courseId);
  let body=paste,sourceName='',sourceTruncated=false;
  if(file){
    const ext=file.name.toLowerCase().split('.').pop();
    if(!['pdf','txt','md'].includes(ext)){status.textContent='Choose a PDF, TXT, or MD file.';return}
    if(file.size>8*1024*1024){status.textContent='Files must be 8 MB or smaller.';return}
    if(ext==='pdf'&&file.type&&file.type!=='application/pdf'){status.textContent='The selected PDF has an unexpected file type.';return}
    if(ext!=='pdf'&&file.type&&file.type!=='text/plain'&&file.type!=='application/octet-stream'){status.textContent='TXT and MD files must be plain text.';return}
    const code=billingUserCode();if(!code){status.textContent='Sign in to your library before importing a file.';return}
    if(submit)submit.disabled=true;status.textContent='Extracting text…';
    try{
      const response=await fetch('/api/materials/extract',{method:'POST',headers:{'X-CS-User':code,'Content-Type':ext==='pdf'?'application/pdf':'text/plain'},body:file});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data&&data.error||`Text extraction failed (${response.status}).`);
      if(!data||typeof data.text!=='string'||typeof data.truncated!=='boolean'||!Number.isFinite(data.originalLength))throw new Error('Text extraction returned an invalid response.');
       if(!privateSourceImporterIsCurrent(scope,form)){if(submit)submit.disabled=false;status.textContent='Your active library or course changed during extraction. Nothing was saved; reopen the importer in the intended library.';return}
      body=data.text;sourceName=file.name;sourceTruncated=data.truncated;
      if(data.truncated)status.textContent=`The extracted source was truncated (${data.originalLength.toLocaleString()} original characters). Review the saved text before using it.`;
    }catch(error){if(submit)submit.disabled=false;status.textContent=error.message||'Text extraction failed. Try again.';return}
  }
  if(!body.trim()){if(submit)submit.disabled=false;status.textContent='Paste text or choose a file with extractable text.';return}
  const wasLong=body.length>30000;body=body.slice(0,30000);
  const now=Date.now(),id=uid(),title=(titleInput.value.trim()||sourceName.replace(/\.[^.]+$/,'')||({syllabus:'Syllabus',reading:'Reading', 'study-guide':'Study guide'}[type])).slice(0,200);
  const note={id,courseId,lectureId:'',title,body,sourceType:type,...(sourceName?{sourceName}:{}),created:now,updated:now,pinned:false};
  let savedInActiveLibrary;
  if(!privateSourceImporterIsCurrent(scope,form)){if(submit)submit.disabled=false;status.textContent='Your active library or course changed before saving. Nothing was saved; reopen the importer in the intended library.';return}
   try{
     if(submit)submit.disabled=true;
     if(analyze){
       status.textContent='Analyzing document and extracting key points…';
       note.sourceAnalysis=await CS_STUDY('source-summary',{material:body});
       if(typeof note.sourceAnalysis?.summary!=='string'||!Array.isArray(note.sourceAnalysis?.keyPoints))throw new Error('Document analysis returned an invalid response. Please try again.');
       if(!privateSourceImporterIsCurrent(scope,form))throw new Error('Your library or course changed during analysis. Nothing was saved; reopen the importer.');
     }
     savedInActiveLibrary=await writePrivateSource(note,scope);
   }
  catch(error){if(submit)submit.disabled=false;status.textContent='Couldn’t save the private source: '+(error&&error.message||'please try again.');return}
  if(!savedInActiveLibrary||!privateSourceImporterIsCurrent(scope,form)){if(submit)submit.disabled=false;status.textContent='Source saved to the original private library, but the active library or course changed while saving. No other library was modified; switch back to view it.';return}
  closeModal();NOTE_UI.mode='write';go({name:'notes',courseId,id});
   toast((analyze?'Summary and key points ready. ':'')+(wasLong||sourceTruncated?'Source saved with truncated text; review it before using it.':scope.mode==='db'?'Private source saved and synced to this library.':'Private source saved in this browser.'));
});
ACT.noteMode=el=>{if(S.view.id)saveNote(S.view.id);NOTE_UI.mode=el.dataset.m;render()};
ACT.notePin=el=>{const n=noteById(el.dataset.id);if(!n||isExampleRecord('notes',n))return;put('notes',{...n,pinned:!n.pinned})};
ACT.noteDel=el=>{const n=noteById(el.dataset.id);if(!n||isExampleRecord('notes',n))return;if(el.dataset.armed){del('notes',n.id);go({name:'notes',courseId:S.view.courseId});toast('Note deleted');return}el.dataset.armed='1';el.innerHTML='Tap again to delete';el.style.color='var(--rec)'};
ACT.noteRestore=el=>{const n=noteById(el.dataset.id);if(!n||isExampleRecord('notes',n))return;put('notes',{...n,body:n.prevBody,prevBody:null,updated:Date.now()});toast('Original restored')};
ACT.fmt=el=>{
  const n=noteById(S.view.id);if(!n||isExampleRecord('notes',n))return;const b=$('#note-body');if(!b)return;const f=el.dataset.f;const s=b.selectionStart,e=b.selectionEnd,v=b.value;
  const ls=v.lastIndexOf('\n',s-1)+1;let ins,ns,ne;
  const pre=p=>{const block=v.slice(ls,e);const out=block.split('\n').map(x=>p+x.replace(/^(#+ |- \[[ x]\] |- |⭐ )/,'')).join('\n');b.value=v.slice(0,ls)+out+v.slice(e);ns=ls+out.length;ne=ns};
  if(f==='b'){const sel=v.slice(s,e)||'bold text';ins='**'+sel+'**';b.value=v.slice(0,s)+ins+v.slice(e);ns=s+2;ne=s+2+sel.length}
  else if(f==='h')pre('## ');else if(f==='li')pre('- ');else if(f==='todo')pre('- [ ] ');else if(f==='star')pre('⭐ ');
  else if(f==='ts'){const n=noteById(S.view.id);const l=n&&lecture(n.lectureId);if(!l){const d=new Date();const tok=`[${d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'})} · ${d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}] `;b.value=v.slice(0,s)+tok+v.slice(e);ns=ne=s+tok.length}else{pickMoment(l);return}}
  b.focus();b.setSelectionRange(ns,ne);saveNoteSoon(S.view.id);
};
function pickMoment(l){
  openModal(`<div class="spread"><h2>Link a moment</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div><p class="small muted">Pick a line from “${esc(l.title)}”. It’s added to your note as a link that jumps to that moment.</p>
  <div class="list" style="max-height:55vh;overflow:auto">${(l.segs||[]).map(g=>`<button class="li" data-act="insMoment" data-l="${esc(l.id)}" data-t="${g.t}"><span class="mono muted" style="width:52px">${fmtT(g.t)}</span><span class="grow small">${esc(g.x)}</span></button>`).join('')}</div>`,{wide:true});
}
ACT.insMoment=el=>{const id=S.view.id;const n=noteById(id);if(!n||isExampleRecord('notes',n))return;closeModal();const b=$('#note-body');if(!b)return;const tok=` [[${el.dataset.l}@${Math.round(+el.dataset.t)}]] `;const p=b.selectionStart||b.value.length;b.value=b.value.slice(0,p)+tok+b.value.slice(p);b.focus();saveNote(id);toast('Moment linked. Switch to Preview to see it.')};
ACT.noteAI=async el=>{
  const n=noteById(el.dataset.id);if(!n||isExampleRecord('notes',n))return;saveNote(n.id);const cur=noteById(n.id);if(!cur.body.trim()){toast('Write some notes first.');return}
  const l=cur.lectureId&&lecture(cur.lectureId);
  NOTE_UI.ai={id:n.id,text:'',busy:true};render();
  try{const text=await window.CS_CLEAN_NOTE((cur.body.slice(0,10000)+(l?'\n\nLECTURE MATERIAL:\n'+material([l],10000):'')).slice(0,20000));const r={text};NOTE_UI.ai.text=r.text;const o=$('#note-ai-out');if(o)o.innerHTML=md(r.text);
    NOTE_UI.ai={id:n.id,text:r.text.trim(),busy:false};
  }catch(e){aiErr(e);NOTE_UI.ai=null}
  render();
};
ACT.noteApply=el=>{const n=noteById(el.dataset.id);if(!n||isExampleRecord('notes',n))return;put('notes',{...n,prevBody:n.body,body:NOTE_UI.ai.text,updated:Date.now()});NOTE_UI.ai=null;NOTE_UI.mode='preview'};
ACT.noteAppend=el=>{const n=noteById(el.dataset.id);if(!n||isExampleRecord('notes',n))return;put('notes',{...n,body:n.body.trimEnd()+'\n\n---\n'+NOTE_UI.ai.text,updated:Date.now()});NOTE_UI.ai=null};
ACT.noteDiscard=()=>{NOTE_UI.ai=null;render()};
function noteText(n){const c=course(n.courseId);return `${n.title||'Untitled note'}\n${c?c.code+' — '+c.name+'\n':''}\n${n.body.replace(/\[\[([\w-]+)@(\d+)\]\]/g,(_,id,t)=>{const l=lecture(id);return l?`(${fmtD(l.date)} lecture, ${fmtT(t)})`:''})}\n`}
ACT.noteEmail=el=>{
  const n=noteById(el.dataset.id);if(!n)return;if(!isExampleRecord('notes',n))saveNote(el.dataset.id);const c=course(n.courseId);
  openModal(`<div class="spread"><h2>Email this note</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
  <label class="f">To<input class="in" id="em-to" type="email" placeholder="classmate@university.edu"></label>
  <label class="f">Subject<input class="in" id="em-subj" value="${esc((c?c.code+' — ':'')+(n.title||'Notes'))}"></label>
  <label class="f">Message<textarea class="in" id="emailbody" rows="12">${esc(noteText(n))}</textarea></label>
  <p class="small muted">ClassScribe doesn’t send email from the web version yet. Open it in your mail app, or copy the text.</p>
  <div class="row"><a class="btn primary" id="em-open" href="#" target="_blank" rel="noopener">${ic('mail')}Open in mail app</a><button class="btn" data-act="copyEmail">Copy text</button></div>`,{wide:true});updMailto();
};
ACT.noteExport=el=>{
  const n=noteById(el.dataset.id);if(!n)return;if(!isExampleRecord('notes',n))saveNote(el.dataset.id);
  openModal(`<div class="spread"><h2>Export note</h2><button class="btn ghost sm" data-act="close">${ic('x')}Close</button></div>
  <label class="f">Format<select class="in" id="nx-fmt"><option value="doc">Word (.doc)</option><option value="md">Markdown (.md)</option><option value="txt">Plain text (.txt)</option></select></label>
  <p class="small muted">For Google Docs, export as Word and upload it to Google Drive.</p>
  <div class="row"><button class="btn primary" data-act="noteExportGo" data-id="${esc(n.id)}">${ic('download')}Export</button></div>`);
};
ACT.noteExportGo=el=>{const n=noteById(el.dataset.id);const f=$('#nx-fmt').value;const name=((course(n.courseId)||{}).code?course(n.courseId).code+' ':'')+(n.title||'Note');const fname=name.replace(/[^\w -]/g,'').slice(0,80)||'Note';const txt=noteText(n);
  closeModal();
  if(f==='doc')download(fname+'.doc',asDoc(n.title||'Note',n.body.replace(/\[\[[\w-]+@[\d.]+\]\]/g,'')));else download(fname+'.'+f,f==='md'?n.body:txt)};
