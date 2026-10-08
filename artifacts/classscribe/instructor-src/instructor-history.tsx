import {useCallback,useEffect,useRef,useState} from 'react';
import type {EduInstructorHistoryPage} from '@workspace/api-client-react';

type Api = <T>(path:string,method?:string,body?:unknown)=>Promise<T>;

export function InstructorHistory({api,agreementRef,revision}:{api:Api;agreementRef:string;revision:number}){
  const [page,setPage]=useState<EduInstructorHistoryPage|null>(null);
  const [cursors,setCursors]=useState<Array<string|undefined>>([undefined]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const requestId=useRef(0);
  const load=useCallback(async(cursor?:string)=>{
    const id=++requestId.current;
    setLoading(true);setError('');setPage(null);
    try{
      const result=await api<EduInstructorHistoryPage>(`/school/instructor-history?limit=20${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
      if(id!==requestId.current)return;
      if(result.signedAgreementRef!==agreementRef)throw new Error('School agreement changed. Refresh school access to continue.');
      setPage(result);
    }catch(e){
      if(id===requestId.current)setError(e instanceof Error?e.message:'Could not load instructor history.');
    }finally{if(id===requestId.current)setLoading(false)}
  },[api,agreementRef]);
  useEffect(()=>{
    setCursors([undefined]);void load();
    return ()=>{requestId.current++};
  },[load,revision,refresh]);
  function previous(){
    const next=cursors.slice(0,-1);
    setCursors(next);void load(next[next.length-1]);
  }
  function next(){
    if(!page?.nextCursor)return;
    setCursors(current=>[...current,page.nextCursor!]);void load(page.nextCursor);
  }
  return <section className="card stack" aria-labelledby="instructor-history-title" data-testid="section-instructor-history">
    <div className="section-head"><div><h2 id="instructor-history-title">Approval and revocation history</h2><p className="small-muted">Current agreement only · Newest first · Times shown in your local time zone. Account IDs identify who acted.</p></div><button className="button small" disabled={loading} onClick={()=>setRefresh(value=>value+1)} data-testid="button-refresh-instructor-history">Refresh history</button></div>
    {loading?<p role="status">Loading instructor history…</p>:error?<div role="alert"><p>{error}</p><button className="button small" onClick={()=>void load(cursors[cursors.length-1])} data-testid="button-retry-instructor-history">Retry</button></div>:page&&<>
      {page.events.length?page.events.map(event=><div className="roster-row" key={event.id} data-testid={`row-instructor-history-${event.id}`}><div style={{overflowWrap:'anywhere',minWidth:0}}>
        <strong>{event.action==='approved'?'Approved':'Revoked'} · {event.instructorUserId}</strong>
        <p className="small-muted">By {event.issuerUserId} · <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>{event.expiresAt?` · Approved access expires ${new Date(event.expiresAt).toLocaleString()}`:''}</p>
      </div></div>):<p data-testid="text-instructor-history-empty">No approvals or revocations recorded for this agreement.</p>}
      <div className="form-actions"><button className="button small" disabled={cursors.length===1} onClick={previous} data-testid="button-instructor-history-previous">Previous</button><span className="small-muted" data-testid="text-instructor-history-page">Page {cursors.length}</span><button className="button small" disabled={!page.nextCursor} onClick={next} data-testid="button-instructor-history-next">Next</button></div>
    </>}
  </section>;
}
