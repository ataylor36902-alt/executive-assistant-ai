import test from 'node:test';
import assert from 'node:assert/strict';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {InstructorHistory} from '../instructor-src/instructor-history';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const event={id:'event-1',issuerUserId:'former-admin',instructorUserId:'instructor-1',action:'revoked' as const,occurredAt:'2026-10-01T12:00:00Z',expiresAt:null};
const page={signedAgreementRef:'school-a',events:[event],nextCursor:'cursor-1'};
const button=(view:ReactTestRenderer,id:string)=>view.root.findByProps({'data-testid':id});

test('history shows actors, navigates pages, refreshes after mutations, and retries failures',async()=>{
  const paths:string[]=[];
  let fail=false;
  const api=async<T,>(path:string):Promise<T>=>{
    paths.push(path);
    if(fail)throw new Error('History unavailable');
    return (path.includes('cursor=')?{...page,events:[],nextCursor:null}:page) as T;
  };
  let view!:ReactTestRenderer;
  await act(async()=>{view=create(<InstructorHistory api={api} agreementRef="school-a" revision={0}/>)});
  assert.match(JSON.stringify(view.toJSON()),/former-admin/);
  assert.match(JSON.stringify(view.toJSON()),/Revoked/);
  assert.equal(button(view,'button-instructor-history-previous').props.disabled,true);
  await act(async()=>{button(view,'button-instructor-history-next').props.onClick()});
  assert.match(paths.at(-1)!,/cursor=cursor-1/);
  assert.ok(view.root.findByProps({'data-testid':'text-instructor-history-empty'}));
  assert.equal(button(view,'button-instructor-history-next').props.disabled,true);
  await act(async()=>{button(view,'button-instructor-history-previous').props.onClick()});
  assert.equal(paths.at(-1),'/school/instructor-history?limit=20');
  await act(async()=>{button(view,'button-instructor-history-next').props.onClick()});
  await act(async()=>{view.update(<InstructorHistory api={api} agreementRef="school-a" revision={1}/>)});
  assert.equal(paths.at(-1),'/school/instructor-history?limit=20');
  assert.equal(button(view,'button-instructor-history-previous').props.disabled,true);
  fail=true;
  await act(async()=>{button(view,'button-refresh-instructor-history').props.onClick()});
  assert.match(JSON.stringify(view.toJSON()),/History unavailable/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/former-admin/);
  fail=false;
  await act(async()=>{button(view,'button-retry-instructor-history').props.onClick()});
  assert.match(JSON.stringify(view.toJSON()),/former-admin/);
  await act(async()=>{view.unmount()});
});

test('history ignores late responses and rejects a mismatched agreement',async()=>{
  let resolveFirst!:(value:unknown)=>void;
  let calls=0;
  const api=async<T,>():Promise<T>=>{
    if(++calls===1)return new Promise(resolve=>{resolveFirst=resolve}) as Promise<T>;
    return {...page,events:[],nextCursor:null} as T;
  };
  let view!:ReactTestRenderer;
  await act(async()=>{view=create(<InstructorHistory api={api} agreementRef="school-a" revision={0}/>)});
  assert.match(JSON.stringify(view.toJSON()),/Loading instructor history/);
  await act(async()=>{view.update(<InstructorHistory api={api} agreementRef="school-a" revision={1}/>)});
  await act(async()=>{resolveFirst(page)});
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/former-admin/);
  const wrongApi=async<T,>():Promise<T>=>({...page,signedAgreementRef:'school-b'}) as T;
  await act(async()=>{view.update(<InstructorHistory api={wrongApi} agreementRef="school-a" revision={1}/>)});
  assert.match(JSON.stringify(view.toJSON()),/School agreement changed/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/former-admin/);
  await act(async()=>{view.unmount()});
});
