import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Link} from 'wouter';
import type {EduInstructor,EduSchool,EduExpiryWarning} from './api';
import {InstructorHistory} from './instructor-history';

type Api = <T>(path:string,method?:string,body?:unknown)=>Promise<T>;

export function SchoolPanel({api}:{api:Api}){
  const [school,setSchool]=useState<EduSchool|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [userId,setUserId]=useState('');
  const [historyRevision,setHistoryRevision]=useState(0);
  const readVersion=useRef(0);
  const savingWarning=useRef(false);
  const load=useCallback(async()=>{
    if(savingWarning.current)return;
    const version=++readVersion.current;
    setLoading(true);setError('');
    try{const latest=await api<EduSchool>('/school');if(version===readVersion.current)setSchool(latest)}
    catch(e){if(version===readVersion.current){setSchool(null);setError(e instanceof Error?e.message:'Could not load school instructors.')}}
    finally{if(version===readVersion.current)setLoading(false)}
  },[api]);
  useEffect(()=>{
    void load();
    // Refresh server-owned dates and preferences across tabs, including at the warning boundary.
    let active=true;
    async function refresh(){
      if(document.visibilityState==='hidden'||savingWarning.current)return;
      const version=++readVersion.current;
      try{
        const latest=await api<EduSchool>('/school');
        if(active&&version===readVersion.current){setSchool(latest);setError('');setLoading(false)}
      }catch(e){
        if(active&&version===readVersion.current){setSchool(null);setError(e instanceof Error?e.message:'Could not refresh school access.');setLoading(false)}
      }
    }
    const timer=window.setInterval(()=>void refresh(),60_000);
    const onFocus=()=>void refresh();
    window.addEventListener('focus',onFocus);
    return()=>{active=false;++readVersion.current;window.clearInterval(timer);window.removeEventListener('focus',onFocus)};
  },[api,load]);
  async function toggleExpiryWarning(){
    if(!school)return;
    const version=++readVersion.current;
    savingWarning.current=true;
    setBusy(true);setError('');setMessage('');
    try{
      const expiryWarning=await api<EduExpiryWarning>('/school/expiry-warning','PATCH',{enabled:!school.expiryWarning.enabled});
      if(version!==readVersion.current)return;
      setSchool(current=>current?{...current,expiryWarning}:current);
      setMessage(expiryWarning.enabled?'In-app expiry warning enabled. No email will be sent.':'In-app expiry warning disabled.');
    }catch(e){if(version===readVersion.current)setError(e instanceof Error?e.message:'Could not save expiry warning.')}
    finally{savingWarning.current=false;setBusy(false)}
  }
  async function approve(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError('');setMessage('');
    try{
      const instructor=await api<EduInstructor>('/school/instructors','POST',{userId:userId.trim()});
      setSchool(current=>current?{...current,instructors:[...current.instructors.filter(i=>i.userId!==instructor.userId),instructor]}:current);
      setUserId('');setMessage('Instructor approved. Share the school license number and PIN securely; the instructor must verify them in their own session.');
      setHistoryRevision(value=>value+1);
    }catch(e){setError(e instanceof Error?e.message:'Could not approve instructor.')}
    finally{setBusy(false)}
  }
  async function revoke(instructor:EduInstructor){
    if(!window.confirm(`Revoke teaching access for ${instructor.userId}? Their courses will become unavailable immediately, but records will be kept.`))return;
    setBusy(true);setError('');setMessage('');
    try{
      await api(`/school/instructors/${encodeURIComponent(instructor.userId)}`,'DELETE');
      setSchool(current=>current?{...current,instructors:current.instructors.map(i=>i.userId===instructor.userId?{...i,revokedAt:new Date().toISOString()}:i)}:current);
      setMessage('Teaching access revoked. Course records remain stored.');
      setHistoryRevision(value=>value+1);
    }catch(e){setError(e instanceof Error?e.message:'Could not revoke instructor.')}
    finally{setBusy(false)}
  }
  return <div className="stack">
    <Link href="/" className="button subtle small">← All classrooms</Link>
    <div className="section-head"><div><p className="eyebrow">School administration</p><h1>Instructors</h1><p>Approve existing ClassScribe accounts under your verified school agreement only.</p></div><button className="button small" onClick={()=>void load()}>Refresh</button></div>
    {error&&<div className="notice" role="alert">{error}</div>}
    {message&&<div className="notice" role="status">{message}</div>}
    {loading?<div role="status">Loading school access…</div>:school&&<>
      <div className="card"><strong>Agreement {school.signedAgreementRef}</strong><p className="small-muted">Verified {new Date(school.verifiedAt).toLocaleDateString()} · Expires {new Date(school.expiresAt).toLocaleString()}</p><p className="small-muted">Only your school’s designated administrator can approve instructors. No email domain, plan, or student account grants teaching access. The license PIN is not displayed or stored here.</p></div>
      <ExpiryWarningCard school={school} busy={busy} onToggle={()=>void toggleExpiryWarning()}/>
      <form className="card fields" onSubmit={approve}><h2>Approve an instructor</h2><p>Ask the instructor to sign up first and provide their exact Clerk user ID. Confirm their identity and employment under your agreement before approving. They still need the school’s license number and PIN for each signed-in session.</p><label>Instructor Clerk user ID<input value={userId} onChange={e=>setUserId(e.target.value)} required pattern="user_[A-Za-z0-9]{10,64}" placeholder="user_…" autoComplete="off" data-testid="input-instructor-user-id"/></label><div className="form-actions"><button className="button primary" type="submit" disabled={busy} data-testid="button-approve-instructor">{busy?'Working…':'Approve instructor'}</button></div></form>
      <div className="card"><h2>Approved accounts</h2>{school.instructors.length?school.instructors.map(i=><div className="roster-row" key={i.userId} data-testid={`row-instructor-${i.userId}`}><div style={{flex:1,overflowWrap:'anywhere'}}><strong>{i.userId}</strong><p className="small-muted">Approved {new Date(i.approvedAt).toLocaleString()} · Expires {new Date(i.expiresAt).toLocaleString()}{i.revokedAt?` · Revoked ${new Date(i.revokedAt).toLocaleString()}`:''}</p></div>{!i.revokedAt&&<button className="button small danger" disabled={busy} onClick={()=>void revoke(i)} data-testid={`button-revoke-instructor-${i.userId}`}>Revoke</button>}</div>):<p>No instructors approved yet.</p>}</div>
      <InstructorHistory key={school.signedAgreementRef} api={api} agreementRef={school.signedAgreementRef} revision={historyRevision}/>
    </>}
  </div>;
}

export function ExpiryWarningCard({school,busy,onToggle}:{school:EduSchool;busy:boolean;onToggle:()=>void}){
  return <>
      <div className="card stack">
        <h2>Agreement expiry warning</h2>
        <p id="expiry-warning-description">Opt in to a warning on this school page during the 30 days before your verified agreement expires. Check this page for the warning; no email or push notification is sent.</p>
        <label><input type="checkbox" checked={school.expiryWarning.enabled} disabled={busy} onChange={onToggle} aria-describedby="expiry-warning-description" data-testid="toggle-expiry-warning"/> Warn me before this agreement expires</label>
        {school.expiryWarning.enabled&&!school.expiryWarning.due&&<p className="small-muted">Warning starts {new Date(school.expiryWarning.startsAt).toLocaleString()}.</p>}
        <p className="small-muted">This does not renew your agreement or extend access. Courses become unavailable when access expires; stored records are kept. Contact your ClassScribe agreement representative before expiry to discuss a separately verified renewal.</p>
      </div>
      {school.expiryWarning.due&&<div className="notice" style={{display:'block'}} role="alert" data-testid="notice-agreement-expiry"><strong>Your EDU agreement expires soon.</strong><p>Agreement {school.signedAgreementRef} expires {new Date(school.expiresAt).toLocaleString()}. Arrange any renewal with your ClassScribe agreement representative before that date. Enabling this warning does not renew or extend access.</p></div>}
    </>;
}