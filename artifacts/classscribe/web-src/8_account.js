/* ---------- ACCOUNT (created on first open; nothing about the student is hardcoded) ---------- */
const LEVELS=['High School','College','Graduate'];
const displayName=p=>p?[p.firstName,p.lastName].filter(Boolean).join(' '):'';
function loadProfileLocal(){try{return JSON.parse(localStorage.getItem('cs_profile')||'null')}catch(e){return null}}
const HOME_LAYOUT_CHOICES=[['class-first','Class-first (default)'],['study-first','Study-first'],['simple','Simple']];
const APPEARANCE_CHOICES=[['auto','Automatic (match my device)'],['light','Light'],['dark','Dark']];
const validHomeLayout=v=>['class-first','study-first','simple'].includes(v)?v:'class-first';
const validAppearance=v=>['auto','light','dark'].includes(v)?v:'auto';
const profileCacheKey=uid=>'cs_profile_v2_'+uid;
const pendingProfileKey=uid=>'cs_pending_profile_v2_'+uid;
let profileWriteQueue=Promise.resolve(),profilePending={};
let profileWatchUid=null,profileWatchUnsubscribe=null;
let ACCOUNT_FORM_BASELINE=null;
let exampleChoiceGuard={};
let PROFILE_PHOTO_URL=null,profilePhotoScopeUid=null,profilePhotoLoadedUid=null,profilePhotoLoadedAt=0,profilePhotoLoadingUid=null,profilePhotoLoadingRequest=0,profilePhotoRequest=0,profilePhotoBusy=false,profilePhotoAccountActive=false,profilePhotoRefreshPending=false,profilePhotoLocalId=null,profilePhotoLocalNoticeAvailable=false,profilePhotoLocalNoticeCheckedAt=0,profilePhotoLocalNoticeRequest=0;
const PROFILE_PHOTO_MAX_BYTES=3*1024*1024;
const PROFILE_PHOTO_TYPES=['image/jpeg','image/png','image/webp'];
const PROFILE_PHOTO_REFRESH_MS=5*60*1000;
const PROFILE_PHOTO_LOCAL_DB='classscribe-profile-photos-v1';
const PROFILE_PHOTO_LOCAL_SCOPE_KEY='cs_local_profile_photo_library_v1';
let PRIVACY_CONFIG=null,PRIVACY_STATUS=null,PRIVACY_LINK_STATUS=null,privacyStatusRequest=0,privacyAgePersistedKey='',privacyDeletionComplete=false;
let clerkSignupAgeBand=null,clerkAgeGateRequested=false;
function privacyLibraryCode(){
  return String(window.CS_SYNC&&window.CS_SYNC.code||S.uid||'');
}
function privacyRequestHeaders(expectedCode,hasBody,token){
  const headers={};
  if(hasBody)headers['Content-Type']='application/json';
  if(expectedCode)headers['X-CS-User']=expectedCode;
  if(token)headers.Authorization='Bearer '+token;
  else if(expectedCode)headers.Authorization='Bearer '+expectedCode;
  return headers;
}
async function privacyRequest(path,method='GET',body,expectedCode=privacyLibraryCode()){
  const expectedUid=S.uid;
  let token='';
  if(clerkClient&&clerkClient.user){
    if(!clerkClient.session)throw new Error('Your signed-in account session is unavailable. Refresh Account and try again.');
    token=await clerkClient.session.getToken({skipCache:true});
    if(!token)throw new Error('Your signed-in account could not be authenticated. Refresh Account and try again.');
  }
  const headers=privacyRequestHeaders(expectedCode,body!==undefined,token);
  if(expectedCode!==privacyLibraryCode()||expectedUid!==S.uid)throw new Error('Your active library changed. Reopen Privacy and try again.');
  const response=await fetch('/api/privacy'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'include',cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status===403&&clerkClient&&clerkClient.user)throw new Error('This signed-in account is not linked to the selected library. Open Account → Privacy and your data and explicitly link this library, or reconnect to the library already linked to this account. No request was redirected to another library.');
    throw new Error(data.error||data.message||'Privacy service is temporarily unavailable. Please try again.');
  }
  if(expectedCode!==privacyLibraryCode()||expectedUid!==S.uid)throw new Error('Your active library changed. The result was not applied to this library.');
  return data;
}
async function privacyLibraryLinkRequest(method='GET',body,expectedCode=privacyLibraryCode()){
  const uid=S.uid;
  if(!clerkClient||!clerkClient.user||!clerkClient.session)throw new Error('Sign in to the account you want to link to this library.');
  const token=await clerkClient.session.getToken({skipCache:true});
  if(!token)throw new Error('Your signed-in account could not be authenticated. Refresh Account and try again.');
  const headers={Authorization:'Bearer '+token};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(method==='POST'&&expectedCode)headers['X-CS-User']=expectedCode;
  if(expectedCode!==privacyLibraryCode()||uid!==S.uid)throw new Error('Your active library changed. Reopen Account and try again.');
  const response=await fetch('/api/library-link',{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'include',cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||data.message||'The library link could not be checked.');
  if(expectedCode!==privacyLibraryCode()||uid!==S.uid)throw new Error('Your active library changed. Reopen Account and try again.');
  return data;
}
async function loadPrivacyConfig(force=false){
  if(PRIVACY_CONFIG&&!force)return PRIVACY_CONFIG;
  const response=await fetch('/api/privacy/config',{cache:'no-store'});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.consent||!Array.isArray(result.consent.statements)||result.consent.statements.length!==2||typeof result.consent.version!=='string')throw new Error(result.error||'Privacy settings could not be loaded. Please try again.');
  PRIVACY_CONFIG=result;return result;
}
async function loadPrivacyStatus(){
  if(S.mode!=='db'||!clerkClient||!clerkClient.user){PRIVACY_STATUS=null;PRIVACY_LINK_STATUS=null;renderPrivacyStatus();return null}
  const code=privacyLibraryCode(),uid=S.uid,request=++privacyStatusRequest;
  PRIVACY_LINK_STATUS={state:'loading'};PRIVACY_STATUS=null;renderPrivacyStatus();
  try{
    const link=await privacyLibraryLinkRequest('GET',undefined,code);
    if(request!==privacyStatusRequest||code!==privacyLibraryCode()||uid!==S.uid)return null;
    if(!link.linked){
      PRIVACY_LINK_STATUS={state:'unlinked'};PRIVACY_STATUS={error:'This account is not linked to the selected library. Explicitly link it below to manage privacy requests; the app will not switch to another account’s free library.'};renderPrivacyStatus();return null;
    }
    if(link.code!==code){
      PRIVACY_LINK_STATUS={state:'different',code:String(link.code||'')};PRIVACY_STATUS={error:`This account is linked to a different library (${String(link.code||'code unavailable')}). Reconnect to that library explicitly; the current library was not changed.`};renderPrivacyStatus();return null;
    }
    PRIVACY_LINK_STATUS={state:'linked',code};
    const status=await privacyRequest('/status','GET',undefined,code);
    if(request!==privacyStatusRequest||code!==privacyLibraryCode()||uid!==S.uid)return null;
    PRIVACY_STATUS=status;renderPrivacyStatus();return status;
  }catch(error){
    if(request===privacyStatusRequest&&code===privacyLibraryCode()&&uid===S.uid){
      PRIVACY_LINK_STATUS={state:'error'};PRIVACY_STATUS={error:error.message};renderPrivacyStatus();
    }
    return null;
  }
}
async function linkCurrentPrivacyLibrary(){
  const button=$('[data-act="privacyLinkLibrary"]'),code=privacyLibraryCode();
  if(!clerkClient||!clerkClient.user){clerkAccountMessage('Sign in to the account you want to link to this library first.');return}
  if(!/^u_[A-Za-z0-9]{16,40}$/.test(code)){PRIVACY_STATUS={error:'The active library sync code is unavailable. Reopen this library and try again.'};renderPrivacyStatus();return}
  if(button)button.disabled=true;
  try{
    const result=await privacyLibraryLinkRequest('POST',{code},code);
    if(!result||result.linked!==true)throw new Error('The server did not confirm linking this selected library.');
    PRIVACY_LINK_STATUS={state:'linked',code};
    await loadPrivacyStatus();
    toast('This library is linked to your signed-in account.');
  }catch(error){
    PRIVACY_STATUS={error:error.message||'Could not link this library to the signed-in account.'};renderPrivacyStatus();
    if(button)button.disabled=false;
  }
}
function openPrivacyReconnect(){
  const code=PRIVACY_LINK_STATUS&&PRIVACY_LINK_STATUS.code;
  if(!code||!window.CS_SYNC||typeof window.CS_SYNC.use!=='function')return;
  openModal(`<div class="spread"><div><p class="eyebrow">Reconnect library</p><h2 id="privacy-reconnect-heading">Switch to your linked library?</h2></div><button type="button" class="btn ghost sm" data-act="privacyReconnectCancel" aria-label="Close">${ic('x')}Close</button></div><p>Your signed-in account is linked to <code class="mono">${esc(code)}</code>, not the library currently open in this browser.</p><p class="small muted">Reconnecting changes the active library. Unsynced local changes may be carried into the destination library. Nothing will be switched unless you confirm.</p><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="privacyReconnectCancel">Keep current library</button><button type="button" class="btn primary" data-act="privacyReconnectConfirm">Reconnect to linked library</button></div>`);
  const dialog=$('#modal-root .modal');if(dialog)dialog.setAttribute('aria-labelledby','privacy-reconnect-heading');
}
async function confirmPrivacyReconnect(){
  const code=PRIVACY_LINK_STATUS&&PRIVACY_LINK_STATUS.code;
  if(!code||!window.CS_SYNC||typeof window.CS_SYNC.use!=='function')return;
  const button=$('[data-act="privacyReconnectConfirm"]');if(button)button.disabled=true;
  try{await window.CS_SYNC.use(code);closeModal();toast('Reconnected to your linked library.')}
  catch(error){if(button)button.disabled=false;PRIVACY_STATUS={error:error.message||'Could not reconnect to the linked library. The current library is unchanged.'};renderPrivacyStatus()}
}
function renderPrivacyStatus(){
  const el=$('#privacy-status');
  if(!el)return;
  const exportButton=$('[data-act="privacyExport"]');
  const linkButton=$('[data-act="privacyLinkLibrary"]'),reconnectButton=$('[data-act="privacyReconnectLibrary"]');
  const deleteButton=$('[data-act="privacyDelete"]'),hasLinkedLibrary=!!(PRIVACY_LINK_STATUS&&PRIVACY_LINK_STATUS.state==='linked');
  if(exportButton)exportButton.disabled=!(S.mode==='db'&&clerkClient&&clerkClient.user&&PRIVACY_LINK_STATUS&&PRIVACY_LINK_STATUS.state==='linked');
  if(deleteButton)deleteButton.disabled=!privacyLibraryCode()||!!(clerkClient&&clerkClient.user&&!hasLinkedLibrary);
  if(linkButton){const show=!!(PRIVACY_LINK_STATUS&&PRIVACY_LINK_STATUS.state==='unlinked');linkButton.hidden=!show;linkButton.style.display=show?'inline-flex':'none'}
  if(reconnectButton){const show=!!(PRIVACY_LINK_STATUS&&PRIVACY_LINK_STATUS.state==='different'&&PRIVACY_LINK_STATUS.code&&window.CS_SYNC&&typeof window.CS_SYNC.use==='function');reconnectButton.hidden=!show;reconnectButton.style.display=show?'inline-flex':'none'}
  const s=PRIVACY_STATUS;
  if(!s){el.textContent=S.mode==='db'?'Sign in with the account linked to this library to manage its privacy requests.':'Privacy requests for this browser-only library are available after it is synced.';return}
  if(s.error){el.textContent=s.error;return}
  const allowed=s.exportNextAllowedAt?new Date(s.exportNextAllowedAt).toLocaleString():null;
  el.textContent=`Age band: ${s.ageBand||'not set'} · Subscription: ${s.activeSubscription?'active':'not active'}${s.provider?` (${s.provider})`:''}${s.reauthenticationRequired?' · fresh sign-in required for deletion':''}${allowed?` · next export available ${allowed}`:''}`;
  const button=$('[data-act="privacyExport"]');if(button)button.disabled=!!(s.exportNextAllowedAt&&new Date(s.exportNextAllowedAt).getTime()>Date.now());
}
function privacyEscrowKey(code){return'cs_privacy_consent_queue_v1_'+encodeURIComponent(code||'local')}
function readPrivacyConsentQueue(code=privacyLibraryCode()){try{return JSON.parse(localStorage.getItem(privacyEscrowKey(code))||'[]')}catch(e){return[]}}
function writePrivacyConsentQueue(items,code=privacyLibraryCode()){
  try{localStorage.setItem(privacyEscrowKey(code),JSON.stringify(items));return true}catch(e){return false}
}
function queuePrivacyConsent(record,code=privacyLibraryCode()){
  const rows=readPrivacyConsentQueue(code).filter(item=>item.sessionId!==record.sessionId);
  rows.push(record);return writePrivacyConsentQueue(rows,code);
}
async function persistRecordingConsent(record,code=privacyLibraryCode()){
  if(!writePrivacyConsentQueue([...readPrivacyConsentQueue(code).filter(item=>item.sessionId!==record.sessionId),record],code))throw new Error('Could not save consent in this browser. Recording did not start.');
  if(!navigator.onLine)return {queued:true};
  const submission={...record};delete submission.consentId;
  const result=await privacyRequest('/consents','POST',submission,code);
  const consentId=String(result.consentId||result.id||'');
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(consentId))throw new Error('The consent service did not return a valid consent ID. Recording did not start.');
  record.consentId=consentId;
  writePrivacyConsentQueue(readPrivacyConsentQueue(code).filter(item=>item.sessionId!==record.sessionId),code);
  return {queued:false,consentId};
}
async function flushPrivacyConsentQueue(code=privacyLibraryCode()){
  const requestCode=code;
  for(const record of readPrivacyConsentQueue(code)){
    if(requestCode!==privacyLibraryCode())return;
    try{
      const submission={...record};delete submission.consentId;
      await privacyRequest('/consents','POST',submission,requestCode);
      writePrivacyConsentQueue(readPrivacyConsentQueue(requestCode).filter(item=>item.sessionId!==record.sessionId),requestCode);
    }catch(e){return}
  }
}
window.addEventListener('online',()=>{if(privacyLibraryCode())void flushPrivacyConsentQueue()});
function currentAgeBand(month,year){
  const m=Number(month),y=Number(year);
  if(!Number.isInteger(m)||m<1||m>12||!Number.isInteger(y)||y<1900||y>new Date().getFullYear())return'';
  const today=new Date(),age=today.getFullYear()-y-(today.getMonth()+1<m?1:0);
  return age<13?'under13':age<18?'13-17':'18+';
}
function privacyDeleteModalError(message){
  const el=$('#privacy-delete-error');if(el){el.hidden=!message;el.textContent=message||''}
}
function openPrivacyDelete(){
  const status=PRIVACY_STATUS;
  const authenticated=!!(clerkClient&&clerkClient.user);
  if(!privacyLibraryCode()||S.mode!=='db'&&!window.CS_SYNC){
    toast('This library has no server sync code to delete.');return;
  }
  const billing=currentBillingStatus()||{};
  const active=!!((status&&status.activeSubscription)||billingSubscriptionActive(billing));
  openModal(`<h2>Delete this library</h2>
    <p class="small muted">This immediately deletes the library’s app data and revokes pending exports. External provider cleanup may continue and resume in the background. Encrypted backups, if any, age out according to the published retention schedule.</p>
    ${active?`<section class="panel stack" style="gap:8px"><b>Your subscription is active.</b><p class="small muted">Cancel or manage billing first. Deletion will not cancel billing automatically. If you still want to delete while billing remains active, explicitly confirm below.</p><button type="button" class="btn sm" data-act="privacyManageBilling">Manage or cancel subscription</button><label class="check"><input type="checkbox" id="privacy-active-override"><span>I understand the subscription is active and still want to delete this library.</span></label></section>`:''}
    ${authenticated?'':`<p class="small muted">This older unlinked library will be identified by its private sync code. Keep the code private; typed confirmation is required.</p>`}
    <label class="f">Type DELETE to confirm<input class="in" id="privacy-delete-typed" autocomplete="off" spellcheck="false"></label>
    <p id="privacy-delete-error" class="small" role="alert" style="color:var(--rec)" hidden></p>
    <div class="row"><button type="button" class="btn" data-act="close">Keep my library</button><button type="button" class="btn rec" data-act="privacyDeleteConfirm">Delete library</button></div>`);
}
function privacyFirstFactorAgeMinutes(session){
  const age=session&&session.factorVerificationAge;
  return Array.isArray(age)&&Number.isFinite(Number(age[0]))?Number(age[0]):Infinity;
}
async function ensurePrivacyFreshFirstFactor(){
  const session=clerkClient&&clerkClient.session;
  if(!session||typeof session.startVerification!=='function')throw new Error('This Clerk session cannot reverify your identity. Sign out and sign in again before deleting.');
  let verification=await session.startVerification({level:'first_factor'});
  if(verification.status==='complete')return;
  const factors=verification.supportedFirstFactors||[];
  const password=factors.find(f=>f.strategy==='password');
  const email=factors.find(f=>f.strategy==='email_code');
  if(password){
    const secret=await privacyPromptSecret('Verify your password','Password','password');
    if(secret===null)throw new Error('Identity verification was cancelled. Your library was not deleted.');
    verification=await session.attemptFirstFactorVerification({strategy:'password',password:secret});
  }else if(email){
    verification=await session.prepareFirstFactorVerification({strategy:'email_code',emailAddressId:email.emailAddressId});
    const code=await privacyPromptSecret('Check your email for a verification code','Verification code','text');
    if(code===null)throw new Error('Identity verification was cancelled. Your library was not deleted.');
    verification=await session.attemptFirstFactorVerification({strategy:'email_code',code});
  }else{
    throw new Error('Clerk has no supported first-factor method for this session. Sign out and sign in again before deleting.');
  }
  if(verification.status!=='complete')throw new Error('Clerk could not verify a fresh first factor. Your library was not deleted.');
  if(privacyFirstFactorAgeMinutes(verification.session)>10)throw new Error('Clerk did not confirm a first-factor verification within the last 10 minutes. Your library was not deleted.');
  session.clearCache();
  const token=await session.getToken({skipCache:true});
  if(!token)throw new Error('A fresh first-factor session token could not be obtained. Your library was not deleted.');
}
function privacyPromptSecret(title,label,type){
  return new Promise(resolve=>{
    const id='privacy-factor-input';
    openModal(`<h2>${esc(title)}</h2><label class="f">${esc(label)}<input class="in" id="${id}" type="${type==='password'?'password':'text'}" autocomplete="${type==='password'?'current-password':'one-time-code'}" autofocus></label><p id="privacy-factor-error" class="small" role="alert" style="color:var(--rec)" hidden></p><div class="row"><button class="btn" type="button" data-act="privacyFactorCancel">Cancel</button><button class="btn primary" type="button" data-act="privacyFactorSubmit">Verify</button></div>`);
    window._privacyFactorResolve=resolve;
  });
}
async function submitPrivacyFactor(){
  const input=$('#privacy-factor-input'),resolve=window._privacyFactorResolve;
  if(!input||!resolve)return;
  const value=input.value.trim();
  if(!value){const error=$('#privacy-factor-error');if(error){error.hidden=false;error.textContent='Enter your verification information.'}return}
  window._privacyFactorResolve=null;closeModal();resolve(value);
}
function cancelPrivacyFactor(){
  const resolve=window._privacyFactorResolve;window._privacyFactorResolve=null;closeModal();if(resolve)resolve(null);
}
async function deletePrivacyLibrary(){
  const status=PRIVACY_STATUS||{};
  const typed=$('#privacy-delete-typed'),override=$('#privacy-active-override');
  if(!typed||typed.value!=='DELETE'){privacyDeleteModalError('Type DELETE exactly to confirm.');return}
  if((status.activeSubscription||billingSubscriptionActive(currentBillingStatus()||{}))&&!(override&&override.checked)){privacyDeleteModalError('Confirm the active-subscription override or cancel/manage billing first.');return}
  const button=$('[data-act="privacyDeleteConfirm"]');if(button)button.disabled=true;
  const code=privacyLibraryCode(),uid=S.uid,ownedLectureIds=Object.keys(S.lectures||{});
  try{
    if(clerkClient&&clerkClient.user)await ensurePrivacyFreshFirstFactor();
    const result=await privacyRequest('/delete','POST',{confirmation:'DELETE',confirmActiveSubscription:!!(override&&override.checked)},code);
    if(!result||result.deleted!==true)throw new Error('The server did not confirm library deletion.');
    if(code!==privacyLibraryCode()||uid!==S.uid)return;
    await privacyClearLocalLibrary(code,ownedLectureIds);
    closeModal();privacyDeletionComplete=true;
    openModal(`<h2>Library deleted</h2><p class="small">${result.providersPending?'App data is deleted. Some external provider cleanup is still pending and will resume automatically.':'App data is deleted and provider cleanup is complete.'}</p><p class="small muted">A private backup may remain in platform backups until it ages out within ${result.backupDays||30} days. This does not claim that platform backups were erased.</p><p class="small muted">This device’s library storage and private local audio have been cleared. Sign out to finish.</p><div class="row"><button type="button" class="btn primary" data-act="privacyDeleteFinish">Sign out and finish</button></div>`);
  }catch(error){privacyDeleteModalError(error.message||'Could not delete this library.');if(button)button.disabled=false}
}
async function finishPrivacyDeletion(){
  if(!privacyDeletionComplete)return;
  privacyDeletionComplete=false;closeModal();
  try{if(clerkClient&&clerkClient.user)await clerkClient.signOut()}catch(e){}
  window.location.assign('/');
}
async function privacyClearLocalLibrary(code,libraryLectureIds=Object.keys(S.lectures||{})){
  const ids=[...new Set(libraryLectureIds.map(String))],photos=profilePhotoScopeKey();
  ids.forEach(id=>{const url=typeof AUDIO_URLS!=='undefined'&&AUDIO_URLS[id];if(url){URL.revokeObjectURL(url);delete AUDIO_URLS[id]}});
  try{
    if(S.mode==='local'){localStorage.removeItem('cs_lib');localStorage.removeItem('cs_profile')}
    if(S.uid){localStorage.removeItem(profileCacheKey(S.uid));localStorage.removeItem(pendingProfileKey(S.uid))}
    localStorage.removeItem(privacyEscrowKey(code));
    localStorage.removeItem(`cs_recording_consent_draft_v1_${encodeURIComponent(code)}`);
    localStorage.removeItem(`cs_recording_reserve_retry_v1_${encodeURIComponent(code)}`);
    localStorage.removeItem(`cs_pending_recording_actions_v1_${encodeURIComponent(code)}`);
  }catch(e){throw new Error('The server deletion completed, but some local library cache could not be cleared. Keep this browser signed out and retry local cleanup.')}
  if(window.indexedDB){
    try{
      const req=indexedDB.open('classscribe-audio',1);
      await new Promise((resolve,reject)=>{
        req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('audio'))req.result.createObjectStore('audio')};
        req.onerror=()=>reject(new Error('Could not open local audio storage.'));
        req.onsuccess=()=>{
          const db=req.result;
          try{
            const tx=db.transaction('audio','readwrite'),store=tx.objectStore('audio');ids.forEach(id=>store.delete(id));
            tx.oncomplete=()=>{db.close();resolve()};
            tx.onerror=()=>{db.close();reject(new Error('Could not clear this library’s local audio.'))};
            tx.onabort=()=>{db.close();reject(new Error('Local audio cleanup was interrupted.'))};
          }catch(error){db.close();reject(error)}
        };
      });
    }catch(e){throw new Error('The server deletion completed, but local audio cleanup failed: '+(e.message||'retry from this device.'))}
    if(photos&&String(photos).startsWith('local:'))await profilePhotoLocalStore('delete',photos.slice('local:'.length)).catch(error=>{throw new Error('The server deletion completed, but local profile-photo cleanup failed: '+(error.message||'retry from this device.'))});
  }else if(ids.length||photos&&String(photos).startsWith('local:'))throw new Error('The server deletion completed, but this browser cannot clear local audio or profile-photo storage.');
  revokeProfilePhotoUrl();
}
async function requestPrivacyExport(){
  if(!clerkClient||!clerkClient.user||!privacyLibraryCode()){toast('Sign in with the account linked to this library to export it.');return}
  const code=privacyLibraryCode(),uid=S.uid,button=$('[data-act="privacyExport"]');
  if(button)button.disabled=true;
  try{
    const result=await privacyRequest('/export','POST',{},code);
    if(code!==privacyLibraryCode()||uid!==S.uid)return;
    const url=new URL(result.url,location.origin);
    const expires=Date.parse(result.expiresAt);
    if(url.origin!==location.origin||!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+24*60*60*1000+60000)throw new Error('The export response was incomplete or unsafe.');
    const a=document.createElement('a');a.href=url.pathname+url.search;a.download='ClassScribe-private-export.zip';a.rel='noopener';a.hidden=true;document.body.appendChild(a);a.click();a.remove();
    const msg=$('#privacy-export-status');if(msg)msg.textContent=`Your private ZIP is ready and expires ${new Date(result.expiresAt).toLocaleString()}.`;
    await loadPrivacyStatus();
  }catch(error){const msg=$('#privacy-export-status');if(msg)msg.textContent=error.message||'Could not create your export.'}
  finally{if(button&&button.isConnected)button.disabled=!!(PRIVACY_STATUS&&PRIVACY_STATUS.exportNextAllowedAt&&new Date(PRIVACY_STATUS.exportNextAllowedAt).getTime()>Date.now())}
}
async function persistProfileAgeBand(ageBand){
  if(!['13-17','18+'].includes(ageBand)||!clerkClient||!clerkClient.user||!privacyLibraryCode())return;
  const persistedKey=clerkClient.user.id+':'+ageBand;
  if(privacyAgePersistedKey===persistedKey)return;
  const code=privacyLibraryCode(),uid=S.uid;
  await privacyRequest('/age','POST',{ageBand},code);
  if(code!==privacyLibraryCode()||uid!==S.uid)return;
  if(ageBand==='13-17'&&S.mode==='db'&&uid&&S.profile)try{await DB.doc('members/'+uid).set({name:S.profile.firstName||'Student',school:S.profile.school||'',at:Date.now()})}catch(e){}
  if(ageBand==='13-17'&&S.mode==='db'&&uid){
    const owned=Object.values(S.lectures||{}).filter(lecture=>!isExampleRecord('lectures',lecture));
    for(const lecture of owned){
      const sharedId=lecture.id+'-'+String(uid).slice(-6);
      try{await DB.collection('shared').doc(sharedId).delete();delete S.shared[sharedId]}
      catch(error){throw new Error('Your age band was verified, but an older shared lecture could not be removed. Sharing remains disabled; please retry from this device.')}
    }
  }
  privacyAgePersistedKey=persistedKey;
}
function updateWelcomeAgeGate(){
  const month=$('#pf-birth-month'),year=$('#pf-birth-year'),message=$('#pf-age-gate-message');
  if(!month||!year||!message)return;
  const band=currentAgeBand(month.value,year.value),button=$('[data-form="welcome"] button[type="submit"]');
  if(band==='under13'){message.hidden=false;message.textContent='ClassScribe is not available to children under 13. You can’t create a library or sign up. Your month and year are not saved.'}
  else if(!band){message.hidden=true;message.textContent=''}
  else{message.hidden=true;message.textContent=''}
  if(button)button.disabled=band==='under13'||!band;
}
function localProfilePhotoLibraryId(){
  if(profilePhotoLocalId)return profilePhotoLocalId;
  let id='';
  try{
    id=localStorage.getItem(PROFILE_PHOTO_LOCAL_SCOPE_KEY)||'';
    if(!/^[a-zA-Z0-9_-]{8,80}$/.test(id)){
      id=uid();
      localStorage.setItem(PROFILE_PHOTO_LOCAL_SCOPE_KEY,id);
    }
  }catch(e){id='browser-local-library'}
  profilePhotoLocalId=id;
  return id;
}
function profilePhotoScopeKey(){
  if(S.mode==='db'&&S.uid)return S.uid;
  if(S.mode==='local')return `local:${localProfilePhotoLibraryId()}`;
  return null;
}
function profilePhotoIsCurrent(){
  if(!PROFILE_PHOTO_URL)return false;
  try{return profilePhotoScopeUid===profilePhotoScopeKey()}catch(e){return false}
}
function profilePhotoRequestIsActive(request,scopeKey,mode){
  if(request!==profilePhotoRequest||S.mode!==mode||profilePhotoScopeUid!==scopeKey)return false;
  try{return profilePhotoScopeKey()===scopeKey}catch(e){return false}
}
function profilePhotoLocalStore(action,key,value){
  if(!window.indexedDB)return Promise.reject(new Error('This browser does not support IndexedDB, so profile photos cannot be saved locally.'));
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open(PROFILE_PHOTO_LOCAL_DB,1);
    let settled=false;
    const fail=(message,db)=>{
      if(settled)return;
      settled=true;
      if(db)db.close();
      reject(new Error(message));
    };
    open.onupgradeneeded=()=>{
      const db=open.result;
      if(!db.objectStoreNames.contains('photos'))db.createObjectStore('photos');
    };
    open.onerror=()=>fail('Could not open local photo storage. Your photo was not changed.');
    open.onblocked=()=>fail('Local photo storage is busy in another tab. Close other ClassScribe tabs and try again.');
    open.onsuccess=()=>{
      const db=open.result;
      if(settled){db.close();return}
      let transaction;
      try{
        transaction=db.transaction('photos',action==='get'?'readonly':'readwrite');
        const store=transaction.objectStore('photos');
        const request=action==='get'?store.get(key):action==='put'?store.put(value,key):store.delete(key);
        let result;
        request.onsuccess=()=>{result=request.result};
        transaction.oncomplete=()=>{if(settled)return;settled=true;db.close();resolve(result)};
        transaction.onerror=()=>fail('Local photo storage failed. Your previous photo was kept.',db);
        transaction.onabort=()=>fail('Local photo storage was interrupted. Your previous photo was kept.',db);
      }catch(error){fail('Local photo storage is unavailable. Your previous photo was kept.',db)}
    };
  });
}
async function validateProfilePhotoDecode(file){
  let temporaryUrl=null;
  try{
    if(typeof window.createImageBitmap==='function'){
      const bitmap=await createImageBitmap(file);
      const valid=bitmap.width>0&&bitmap.height>0&&bitmap.width*bitmap.height<=40000000;
      bitmap.close();
      if(!valid)throw new Error('Choose an image with valid dimensions under 40 megapixels.');
      return;
    }
    temporaryUrl=URL.createObjectURL(file);
    const image=new Image();
    image.src=temporaryUrl;
    if(typeof image.decode==='function')await image.decode();
    else await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject});
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000)throw new Error('Choose an image with valid dimensions under 40 megapixels.');
  }catch(error){
    throw error&&error.message?error:new Error('This file could not be decoded as an image. Choose a valid JPEG, PNG, or WebP.');
  }finally{if(temporaryUrl)URL.revokeObjectURL(temporaryUrl)}
}
function revokeProfilePhotoUrl(){
  if(PROFILE_PHOTO_URL)URL.revokeObjectURL(PROFILE_PHOTO_URL);
  PROFILE_PHOTO_URL=null;
}
function profilePhotoInitial(){return String((S.profile&&S.profile.firstName)||'?').trim().charAt(0).toUpperCase()||'?'}
function profilePhotoMarkup(className='avatar'){
  const current=profilePhotoIsCurrent();
  return `<span class="${className}${current?' has-photo':''}" data-profile-photo-avatar>${current?`<img src="${esc(PROFILE_PHOTO_URL)}" alt="">`:esc(profilePhotoInitial())}</span>`;
}
function paintProfilePhoto(){
  const current=profilePhotoIsCurrent();
  document.querySelectorAll('[data-profile-photo-avatar]').forEach(el=>{
    el.innerHTML=current?`<img src="${esc(PROFILE_PHOTO_URL)}" alt="">`:esc(profilePhotoInitial());
    el.classList.toggle('has-photo',!!current);
  });
  const remove=$('[data-profile-photo-action="remove"]');
  if(remove)remove.hidden=!current;
  const pick=$('[data-profile-photo-action="pick"]');
  if(pick)pick.textContent=current?'Replace photo':'Upload photo';
}
function setProfilePhotoStatus(message,state=''){
  const status=$('#profile-photo-status');
  if(!status)return;
  status.textContent=message;
  status.dataset.state=state;
}
function profilePhotoErrorMessage(response,fallback){
  return response.json().then(body=>body.message||body.error||fallback).catch(()=>fallback);
}
async function refreshLocalProfilePhoto(scopeKey,force=false){
  if(S.mode!=='local'||!scopeKey||profilePhotoBusy)return;
  if(profilePhotoLoadingUid===scopeKey)return;
  if(profilePhotoScopeUid!==scopeKey){
    profilePhotoRequest++;
    revokeProfilePhotoUrl();
    profilePhotoScopeUid=scopeKey;
    profilePhotoLoadedUid=null;
    profilePhotoLoadedAt=0;
    profilePhotoLoadingUid=null;
    profilePhotoLoadingRequest=0;
  }
  if(!force&&profilePhotoLoadedUid===scopeKey&&Date.now()-profilePhotoLoadedAt<PROFILE_PHOTO_REFRESH_MS)return;
  const request=++profilePhotoRequest;
  profilePhotoLoadingUid=scopeKey;
  profilePhotoLoadingRequest=request;
  const active=()=>profilePhotoRequestIsActive(request,scopeKey,'local');
  try{
    const localId=scopeKey.slice('local:'.length);
    const record=await profilePhotoLocalStore('get',localId);
    if(!active())return;
    if(record===undefined){
      revokeProfilePhotoUrl();
      profilePhotoLoadedUid=scopeKey;
      profilePhotoLoadedAt=Date.now();
      paintProfilePhoto();
      return;
    }
    if(!record||!(record.blob instanceof Blob)||!PROFILE_PHOTO_TYPES.includes(record.contentType)||record.blob.type!==record.contentType||record.blob.size>PROFILE_PHOTO_MAX_BYTES)throw new Error('The browser-stored profile photo is invalid. Replace it with a valid image.');
    await validateProfilePhotoDecode(record.blob);
    if(!active())return;
    revokeProfilePhotoUrl();
    PROFILE_PHOTO_URL=URL.createObjectURL(record.blob);
    profilePhotoLoadedUid=scopeKey;
    profilePhotoLoadedAt=Date.now();
    paintProfilePhoto();
  }catch(error){
    if(!active())return;
    profilePhotoLoadedUid=scopeKey;
    profilePhotoLoadedAt=Date.now();
    if(S.view.name==='account')setProfilePhotoStatus(error.message||'Could not load your browser-stored photo.','error');
  }finally{
    if(profilePhotoLoadingRequest===request){
      profilePhotoLoadingUid=null;
      profilePhotoLoadingRequest=0;
    }
  }
}
async function refreshProfilePhoto(uid=S.uid,force=false){
  if(S.mode==='local')return refreshLocalProfilePhoto(uid,force);
  if(S.mode!=='db'||!uid||profilePhotoBusy)return;
  if(profilePhotoLoadingUid===uid)return;
  if(profilePhotoScopeUid!==uid){
    profilePhotoRequest++;
    revokeProfilePhotoUrl();
    profilePhotoScopeUid=uid;
    profilePhotoLoadedUid=null;
    profilePhotoLoadedAt=0;
    profilePhotoLoadingUid=null;
    profilePhotoLoadingRequest=0;
    profilePhotoRefreshPending=false;
  }
  if(!force&&profilePhotoLoadedUid===uid&&Date.now()-profilePhotoLoadedAt<PROFILE_PHOTO_REFRESH_MS)return;
  const request=++profilePhotoRequest;
  profilePhotoLoadingUid=uid;
  profilePhotoLoadingRequest=request;
  const active=()=>request===profilePhotoRequest&&S.mode==='db'&&S.uid===uid&&profilePhotoScopeUid===uid;
  try{
    const response=await fetch('/api/profile-photo',{headers:{'X-CS-User':uid},cache:'no-store'});
    if(!active())return;
    if(response.status===404){
      revokeProfilePhotoUrl();
      profilePhotoLoadedUid=uid;
      profilePhotoLoadedAt=Date.now();
      paintProfilePhoto();
      return;
    }
    if(!response.ok)throw new Error(await profilePhotoErrorMessage(response,'Could not load your profile photo.'));
    const blob=await response.blob();
    if(!active())return;
    if(blob.type!=='image/webp')throw new Error('The saved profile photo could not be displayed.');
    revokeProfilePhotoUrl();
    PROFILE_PHOTO_URL=URL.createObjectURL(blob);
    profilePhotoLoadedUid=uid;
    profilePhotoLoadedAt=Date.now();
    paintProfilePhoto();
  }catch(error){
    if(!active())return;
    profilePhotoLoadedUid=uid;
    profilePhotoLoadedAt=Date.now();
    if(S.view.name==='account')setProfilePhotoStatus(error.message||'Could not load your profile photo.','error');
  }finally{
    if(profilePhotoLoadingRequest===request){
      profilePhotoLoadingUid=null;
      profilePhotoLoadingRequest=0;
    }
  }
}
function syncProfilePhotoScope(){
  let uid=null;
  try{uid=profilePhotoScopeKey()}catch(error){
    profilePhotoRequest++;
    revokeProfilePhotoUrl();
    profilePhotoScopeUid=null;
    profilePhotoLoadedUid=null;
    profilePhotoLoadedAt=0;
    profilePhotoLoadingUid=null;
    profilePhotoLoadingRequest=0;
    profilePhotoBusy=false;
    profilePhotoRefreshPending=false;
    paintProfilePhoto();
    if(S.view.name==='account')setProfilePhotoStatus(error.message||'Local photo storage could not be opened.','error');
  }
  const isAccount=S.view.name==='account';
  const enteredAccount=isAccount&&!profilePhotoAccountActive;
  profilePhotoAccountActive=isAccount;
  if(uid!==profilePhotoScopeUid){
    profilePhotoRequest++;
    revokeProfilePhotoUrl();
    profilePhotoScopeUid=uid;
    profilePhotoLoadedUid=null;
    profilePhotoLoadedAt=0;
    profilePhotoLoadingUid=null;
    profilePhotoLoadingRequest=0;
    profilePhotoRefreshPending=false;
    profilePhotoBusy=false;
    paintProfilePhoto();
  }
  const shouldRefresh=enteredAccount||profilePhotoRefreshPending||profilePhotoLoadedUid!==uid||Date.now()-profilePhotoLoadedAt>=PROFILE_PHOTO_REFRESH_MS;
  if(uid&&shouldRefresh){
    if(profilePhotoBusy)profilePhotoRefreshPending=true;
    else{
      const force=enteredAccount||profilePhotoRefreshPending;
      profilePhotoRefreshPending=false;
      void refreshProfilePhoto(uid,force);
    }
  }
}
async function uploadLocalProfilePhoto(file){
  let scopeKey;
  try{scopeKey=profilePhotoScopeKey()}catch(error){setProfilePhotoStatus(error.message||'Local photo storage could not be opened.','error');return}
  if(!scopeKey||!scopeKey.startsWith('local:')){setProfilePhotoStatus('This browser-only library is not available.','error');return}
  const request=++profilePhotoRequest,oldUrl=PROFILE_PHOTO_URL;
  profilePhotoLoadingUid=null;
  profilePhotoLoadingRequest=0;
  profilePhotoBusy=true;
  const pick=$('[data-profile-photo-action="pick"]'),remove=$('[data-profile-photo-action="remove"]');
  if(pick)pick.disabled=true;
  if(remove)remove.disabled=true;
  setProfilePhotoStatus('Checking your image…');
  let previewUrl=null;
  try{
    await validateProfilePhotoDecode(file);
    if(!profilePhotoRequestIsActive(request,scopeKey,'local'))return;
    const blob=new Blob([file],{type:file.type});
    previewUrl=URL.createObjectURL(blob);
    PROFILE_PHOTO_URL=previewUrl;
    paintProfilePhoto();
    setProfilePhotoStatus('Saving your photo in this browser…');
    await profilePhotoLocalStore('put',scopeKey.slice('local:'.length),{blob,contentType:file.type,updatedAt:Date.now()});
    profilePhotoLocalNoticeRequest++;
    profilePhotoLocalNoticeAvailable=true;
    profilePhotoLocalNoticeCheckedAt=Date.now();
    if(!profilePhotoRequestIsActive(request,scopeKey,'local')){URL.revokeObjectURL(previewUrl);return}
    if(oldUrl&&oldUrl!==previewUrl)URL.revokeObjectURL(oldUrl);
    profilePhotoLoadedUid=scopeKey;
    profilePhotoLoadedAt=Date.now();
    setProfilePhotoStatus('Profile photo saved in this browser only.','success');
  }catch(error){
    if(!profilePhotoRequestIsActive(request,scopeKey,'local')){if(previewUrl)URL.revokeObjectURL(previewUrl);return}
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    PROFILE_PHOTO_URL=oldUrl;
    paintProfilePhoto();
    setProfilePhotoStatus(error.message||'Could not save your photo in this browser. Your previous photo was kept.','error');
  }finally{
    if(request===profilePhotoRequest){
      profilePhotoBusy=false;
      if(pick)pick.disabled=false;
      if(remove)remove.disabled=false;
      if(profilePhotoRequestIsActive(request,scopeKey,'local'))syncProfilePhotoScope();
    }
  }
}
async function removeLocalProfilePhoto(){
  if(!PROFILE_PHOTO_URL||profilePhotoBusy)return;
  if(!window.confirm('Remove your browser-only profile photo? This cannot be undone.'))return;
  let scopeKey;
  try{scopeKey=profilePhotoScopeKey()}catch(error){setProfilePhotoStatus(error.message||'Local photo storage could not be opened.','error');return}
  if(!scopeKey||!scopeKey.startsWith('local:'))return;
  const request=++profilePhotoRequest;
  profilePhotoLoadingUid=null;
  profilePhotoLoadingRequest=0;
  profilePhotoBusy=true;
  const pick=$('[data-profile-photo-action="pick"]'),remove=$('[data-profile-photo-action="remove"]');
  if(pick)pick.disabled=true;
  if(remove)remove.disabled=true;
  setProfilePhotoStatus('Removing your browser-only photo…');
  try{
    await profilePhotoLocalStore('delete',scopeKey.slice('local:'.length));
    profilePhotoLocalNoticeRequest++;
    profilePhotoLocalNoticeAvailable=false;
    profilePhotoLocalNoticeCheckedAt=Date.now();
    if(!profilePhotoRequestIsActive(request,scopeKey,'local'))return;
    revokeProfilePhotoUrl();
    profilePhotoLoadedUid=scopeKey;
    profilePhotoLoadedAt=Date.now();
    paintProfilePhoto();
    setProfilePhotoStatus('Browser-only profile photo removed.','success');
  }catch(error){
    if(!profilePhotoRequestIsActive(request,scopeKey,'local'))return;
    setProfilePhotoStatus(error.message||'Could not remove your photo. Your previous photo was kept.','error');
  }finally{
    if(request===profilePhotoRequest){
      profilePhotoBusy=false;
      if(pick)pick.disabled=false;
      if(remove)remove.disabled=false;
      if(profilePhotoRequestIsActive(request,scopeKey,'local'))syncProfilePhotoScope();
    }
  }
}
function refreshLocalPhotoNotice(){
  const notice=$('#profile-photo-local-notice');
  if(!notice)return;
  if(S.mode!=='db'||!S.uid){notice.hidden=true;return}
  if(Date.now()-profilePhotoLocalNoticeCheckedAt<PROFILE_PHOTO_REFRESH_MS){
    notice.hidden=!profilePhotoLocalNoticeAvailable;
    return;
  }
  const uid=S.uid,request=++profilePhotoLocalNoticeRequest;
  let localId;
  try{localId=localProfilePhotoLibraryId()}catch(e){notice.hidden=true;return}
  profilePhotoLocalStore('get',localId).then(record=>{
    if(request!==profilePhotoLocalNoticeRequest||S.mode!=='db'||S.uid!==uid||S.view.name!=='account')return;
    profilePhotoLocalNoticeAvailable=!!(record&&record.blob instanceof Blob&&PROFILE_PHOTO_TYPES.includes(record.contentType)&&record.blob.type===record.contentType&&record.blob.size<=PROFILE_PHOTO_MAX_BYTES);
    profilePhotoLocalNoticeCheckedAt=Date.now();
    notice.hidden=!profilePhotoLocalNoticeAvailable;
  }).catch(()=>{
    if(request===profilePhotoLocalNoticeRequest&&S.mode==='db'&&S.uid===uid){profilePhotoLocalNoticeAvailable=false;profilePhotoLocalNoticeCheckedAt=Date.now();notice.hidden=true}
  });
}
async function uploadProfilePhoto(file){
  if(!file)return;
  if(!PROFILE_PHOTO_TYPES.includes(file.type)){setProfilePhotoStatus('Choose a JPEG, PNG, or WebP image.','error');return}
  if(file.size>PROFILE_PHOTO_MAX_BYTES){setProfilePhotoStatus('Choose an image that is 3 MB or smaller.','error');return}
  if(S.mode==='local')return uploadLocalProfilePhoto(file);
  if(S.mode!=='db'||!S.uid){setProfilePhotoStatus('Photo uploads are available after this library is synced.','error');return}
  const uid=S.uid,request=++profilePhotoRequest,oldUrl=PROFILE_PHOTO_URL,previewUrl=URL.createObjectURL(file);
  profilePhotoLoadingUid=null;
  profilePhotoLoadingRequest=0;
  profilePhotoScopeUid=uid;
  PROFILE_PHOTO_URL=previewUrl;
  profilePhotoBusy=true;
  paintProfilePhoto();
  const pick=$('[data-profile-photo-action="pick"]'),remove=$('[data-profile-photo-action="remove"]');
  if(pick)pick.disabled=true;
  if(remove)remove.disabled=true;
  setProfilePhotoStatus('Uploading your photo…');
  try{
    const response=await fetch('/api/profile-photo',{method:'POST',headers:{'X-CS-User':uid,'Content-Type':file.type},body:file});
    if(request!==profilePhotoRequest||S.mode!=='db'||S.uid!==uid){URL.revokeObjectURL(previewUrl);return}
    if(!response.ok)throw new Error(await profilePhotoErrorMessage(response,'Could not upload your photo.'));
    const result=await response.json().catch(()=>null);
    if(!result||typeof result.updatedAt!=='string')throw new Error('The upload response was incomplete. Please try again.');
    if(request!==profilePhotoRequest||S.mode!=='db'||S.uid!==uid){URL.revokeObjectURL(previewUrl);return}
    if(oldUrl&&oldUrl!==previewUrl)URL.revokeObjectURL(oldUrl);
    profilePhotoLoadedUid=uid;
    profilePhotoLoadedAt=Date.now();
    setProfilePhotoStatus('Profile photo updated.','success');
  }catch(error){
    if(request!==profilePhotoRequest||S.mode!=='db'||S.uid!==uid){URL.revokeObjectURL(previewUrl);return}
    URL.revokeObjectURL(previewUrl);
    PROFILE_PHOTO_URL=oldUrl;
    paintProfilePhoto();
    setProfilePhotoStatus(error.message||'Could not upload your photo.','error');
  }finally{
    if(request===profilePhotoRequest){
      profilePhotoBusy=false;
      if(pick)pick.disabled=false;
      if(remove)remove.disabled=false;
      if(S.mode==='db'&&S.uid===uid)syncProfilePhotoScope();
    }
  }
}
async function removeProfilePhoto(){
  if(S.mode==='local')return removeLocalProfilePhoto();
  if(S.mode!=='db'||!S.uid){setProfilePhotoStatus('Photo removal is available after this library is synced.','error');return}
  if(!PROFILE_PHOTO_URL||profilePhotoBusy)return;
  if(!window.confirm('Remove your profile photo? This cannot be undone.'))return;
  const uid=S.uid,request=++profilePhotoRequest;
  profilePhotoLoadingUid=null;
  profilePhotoLoadingRequest=0;
  profilePhotoBusy=true;
  const pick=$('[data-profile-photo-action="pick"]'),remove=$('[data-profile-photo-action="remove"]');
  if(pick)pick.disabled=true;
  if(remove)remove.disabled=true;
  setProfilePhotoStatus('Removing your photo…');
  try{
    const response=await fetch('/api/profile-photo',{method:'DELETE',headers:{'X-CS-User':uid}});
    if(request!==profilePhotoRequest||S.mode!=='db'||S.uid!==uid)return;
    if(!response.ok)throw new Error(await profilePhotoErrorMessage(response,'Could not remove your photo.'));
    revokeProfilePhotoUrl();
    profilePhotoLoadedUid=uid;
    profilePhotoLoadedAt=Date.now();
    paintProfilePhoto();
    setProfilePhotoStatus('Profile photo removed.','success');
  }catch(error){
    if(request!==profilePhotoRequest||S.mode!=='db'||S.uid!==uid)return;
    setProfilePhotoStatus(error.message||'Could not remove your photo.','error');
  }finally{
    if(request===profilePhotoRequest){
      profilePhotoBusy=false;
      if(pick)pick.disabled=false;
      if(remove)remove.disabled=false;
      if(S.mode==='db'&&S.uid===uid)syncProfilePhotoScope();
    }
  }
}
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-profile-photo-action]');
  if(!action)return;
  if(action.dataset.profilePhotoAction==='pick')$('#profile-photo-file')?.click();
  if(action.dataset.profilePhotoAction==='remove')void removeProfilePhoto();
});
document.addEventListener('change',event=>{
  const input=event.target;
  if(input.id!=='profile-photo-file')return;
  const file=input.files&&input.files[0];
  input.value='';
  if(file)void uploadProfilePhoto(file);
});
function legacyExamplesHidden(){try{return localStorage.getItem('cs_hideEx_v2')==='1'}catch(e){return false}}
function applyExamplePreference(profile=S.profile){
  if(profile&&typeof profile.showExamples==='boolean'){
    S.showEx=profile.showExamples;
    try{localStorage.removeItem('cs_hideEx_v2')}catch(e){}
  }else if(legacyExamplesHidden()){
    S.showEx=false;
    queueProfilePatch({showExamples:false,showExamplesUpdated:Date.now()}).catch(()=>{});
  }else S.showEx=true;
  S.showExReady=true;
}
async function setExamplePreference(show){
  S.showEx=!!show;S.showExReady=true;
  if(show){try{localStorage.removeItem('cs_hideEx_v2')}catch(e){}}
  return queueProfilePatch({showExamples:!!show,showExamplesUpdated:Date.now()});
}
function homeLayoutValue(){return validHomeLayout(S.profile&&S.profile.homeLayout)}
function appearanceValue(){return validAppearance(S.profile&&S.profile.appearance)}
function applyAppearancePreference(profile=S.profile){
  if(window.CS_APPEARANCE)window.CS_APPEARANCE.sync(profile||null);
  paintAppearanceChoices();
}
function paintAppearanceChoices(){
  document.querySelectorAll('[data-act="appearancePick"]').forEach(el=>{
    const selected=el.dataset.appearance===appearanceValue();
    el.setAttribute('aria-checked',String(selected));
    const check=el.querySelector('.appearance-check');
    if(check)check.textContent=selected?'✓':'';
  });
}
function appearanceQuickChoices(){
  return `<div class="appearance-quick"><span>Appearance</span><div class="seg-toggle" role="radiogroup" aria-label="Appearance">${[['auto','Auto'],['light','Light'],['dark','Dark']].map(([id,label])=>`<button type="button" role="radio" aria-checked="${appearanceValue()===id}" aria-label="${id==='auto'?'Automatic (match my device)':label}" data-act="appearancePick" data-appearance="${id}">${label}</button>`).join('')}</div></div>`;
}
function paintHomeLayoutChoices(){
  document.querySelectorAll('[data-act="homeLayoutPick"]').forEach(el=>{
    const selected=el.dataset.layout===homeLayoutValue();
    el.setAttribute('aria-checked',String(selected));
    const check=el.querySelector('.home-view-check');
    if(check)check.textContent=selected?'✓':'';
  });
}
function applyRemoteProfile(uid,remote){
  if(uid!==S.uid)return;
  const pending=pendingProfilePatch(uid);
  let next=remote?{...remote,...pending}:Object.keys(pending).length?{...pending}:null;
  const guard=exampleChoiceGuard[uid];
  if(guard&&!Object.prototype.hasOwnProperty.call(pending,'showExamples')&&remote&&typeof remote.showExamples==='boolean'){
    const remoteChoiceAt=Number(remote.showExamplesUpdated)||0;
    if(remote.showExamples===guard.show&&remoteChoiceAt>=guard.updated)delete exampleChoiceGuard[uid];
    else if(remoteChoiceAt<=guard.updated)next={...(next||{}),showExamples:guard.show,showExamplesUpdated:guard.updated};
    else delete exampleChoiceGuard[uid];
  }
  applyAppearancePreference(next);
  applyExamplePreference(next);
  if(JSON.stringify(next)===JSON.stringify(S.profile))return;
  S.profile=next;
  if(next)persistProfileLocal(next);
  paintHomeLayoutChoices();
  paintAppearanceChoices();
  if(S.view.name==='home'||S.view.name==='account')render();
}
function watchProfile(uid){
  if(S.mode!=='db'||!uid||profileWatchUid===uid)return;
  if(profileWatchUnsubscribe){try{profileWatchUnsubscribe()}catch(e){}}
  profileWatchUid=uid;
  profileWatchUnsubscribe=DB.doc('data/users/'+uid+'/profile').onSnapshot(snap=>applyRemoteProfile(uid,snap.exists?snap.data():null),()=>{});
}
function persistProfileLocal(p){
  try{
    if(S.mode==='db'&&S.uid)localStorage.setItem(profileCacheKey(S.uid),JSON.stringify(p));
    else localStorage.setItem('cs_profile',JSON.stringify(p));
  }catch(e){}
}
function pendingProfilePatch(uid){
  if(profilePending[uid])return profilePending[uid];
  try{profilePending[uid]=JSON.parse(localStorage.getItem(pendingProfileKey(uid))||'{}')}catch(e){profilePending[uid]={}}
  if(!profilePending[uid]||typeof profilePending[uid]!=='object'||Array.isArray(profilePending[uid]))profilePending[uid]={};
  return profilePending[uid];
}
async function flushProfilePatches(uid=S.uid){
  if(S.mode!=='db'||!uid)return;
  const run=async()=>{
    while(S.mode==='db'&&uid===S.uid){
      const pending=pendingProfilePatch(uid),keys=Object.keys(pending);
      if(!keys.length)return;
      const batch={...pending};
      await DB.doc('data/users/'+uid+'/profile').update(batch);
      const latest=pendingProfilePatch(uid);
      Object.keys(batch).forEach(k=>{if(Object.prototype.hasOwnProperty.call(latest,k)&&JSON.stringify(latest[k])===JSON.stringify(batch[k]))delete latest[k]});
      try{localStorage.setItem(pendingProfileKey(uid),JSON.stringify(latest))}catch(e){}
      const merged={...(S.profile||{})};
      Object.keys(batch).forEach(k=>{if(!Object.prototype.hasOwnProperty.call(latest,k))merged[k]=batch[k]});
      if(S.uid===uid){S.profile=merged;persistProfileLocal(merged)}
    }
  };
  const task=profileWriteQueue.catch(()=>{}).then(run);
  profileWriteQueue=task.catch(()=>{});
  return task;
}
async function queueProfilePatch(patch){
  const clean={...patch,updated:Date.now()};
  if(Object.prototype.hasOwnProperty.call(clean,'showExamples'))exampleChoiceGuard[S.uid||'local']={show:!!clean.showExamples,updated:Number(clean.showExamplesUpdated)||clean.updated};
  S.profile={...(S.profile||{}),...clean};
  applyAppearancePreference(S.profile);
  applyExamplePreference(S.profile);
  persistProfileLocal(S.profile);
  if(S.mode!=='db')return;
  const uid=S.uid,pending=pendingProfilePatch(uid);
  Object.assign(pending,clean);
  try{localStorage.setItem(pendingProfileKey(uid),JSON.stringify(pending))}catch(e){}
  await flushProfilePatches(uid);
}
async function setHomeLayoutChoice(layout){return queueProfilePatch({homeLayout:validHomeLayout(layout)})}
async function setAppearanceChoice(appearance){return queueProfilePatch({appearance:validAppearance(appearance)})}
async function saveProfile(patch){
  // General profile saves cannot change preferences; only their controls can.
  const {homeLayout,appearance,showExamples,showExamplesUpdated,...profileFields}=patch;
  return queueProfilePatch(profileFields);
}
window.CS_FLUSH_PROFILE_PATCHES=async uid=>flushProfilePatches(uid||S.uid);
window.CS_MOVE_PROFILE_PATCHES=(fromUid,toUid)=>{
  if(!fromUid||!toUid)return;
  const source=pendingProfilePatch(fromUid);
  if(!Object.keys(source).length)return;
  const target=pendingProfilePatch(toUid);
  Object.assign(target,source);
  localStorage.setItem(pendingProfileKey(toUid),JSON.stringify(target));
  const oldCache=JSON.parse(localStorage.getItem(profileCacheKey(fromUid))||'null')||{};
  localStorage.setItem(profileCacheKey(toUid),JSON.stringify({...oldCache,...source}));
  profilePending[toUid]=target;
  delete profilePending[fromUid];
  localStorage.removeItem(pendingProfileKey(fromUid));
};
async function loadProfile(){
  const uid=S.uid;
  let local=loadProfileLocal();
  if(S.mode==='db'&&uid){try{local=JSON.parse(localStorage.getItem(profileCacheKey(uid))||'null')||local}catch(e){}}
  if(S.mode!=='db'){S.profile=local;applyAppearancePreference(S.profile);applyExamplePreference(S.profile);return}
  let remote=null;
  try{
    const snap=await DB.doc('data/users/'+uid+'/profile').get();
    if(snap.exists)remote=snap.data();
  }catch(e){}
  if(uid!==S.uid)return;
  S.profile=remote||local||null;
  const pending=pendingProfilePatch(uid);
  if(Object.keys(pending).length)S.profile={...(S.profile||{}),...pending};
  const hadLegacyExampleHide=legacyExamplesHidden();
  applyAppearancePreference(S.profile);
  applyExamplePreference(S.profile);
  if(!Object.prototype.hasOwnProperty.call(pending,'showExamples')&&(!remote||typeof remote.showExamples!=='boolean')&&local&&typeof local.showExamples==='boolean'&&!hadLegacyExampleHide){
    queueProfilePatch({showExamples:local.showExamples,showExamplesUpdated:Number(local.showExamplesUpdated)||Date.now()}).catch(()=>{});
  }
  if(S.profile){persistProfileLocal(S.profile);try{await DB.doc('members/'+uid).set({name:S.profile.ageBand==='13-17'?S.profile.firstName||'Student':displayName(S.profile),school:S.profile.school||'',at:Date.now()})}catch(e){}}
  if(uid!==S.uid)return;
  watchProfile(uid);
  flushProfilePatches(uid).catch(()=>{});
}
function profileFields(p,ageGate=false){
  p=p||{};
  const previousLevel=p.level&&!LEVELS.includes(p.level);
  const learningMode=['online','in-person'].includes(p.learningMode)?p.learningMode:'';
  return `<div class="grid2"><label class="f">First name<input class="in" id="pf-first" required autocomplete="given-name" value="${esc(p.firstName||'')}" autofocus></label><label class="f"><span>Last name <span style="font-weight:400">(optional)</span></span><input class="in" id="pf-last" autocomplete="family-name" value="${esc(p.lastName||'')}"></label></div>
  ${ageGate?`<div class="grid2"><label class="f">Birth month<select class="in" id="pf-birth-month" required><option value="">Choose month</option>${Array.from({length:12},(_,i)=>`<option value="${i+1}">${new Date(2000,i,1).toLocaleString(undefined,{month:'long'})}</option>`).join('')}</select></label><label class="f">Birth year<input class="in" id="pf-birth-year" type="number" inputmode="numeric" min="1900" max="${new Date().getFullYear()}" required autocomplete="off"></label></div><p class="small muted">We use month and year only to check age. Your birth date is not saved.</p><p id="pf-age-gate-message" class="small" role="alert" aria-live="polite" style="color:var(--warn)" hidden></p>`:`<p class="small muted">Age band: ${esc(p.ageBand==='13-17'?'13–17':p.ageBand==='18+'?'18+':'not set')}. Only your age band is stored.</p>`}
  <label class="f">School<input class="in" id="pf-school" autocomplete="organization" placeholder="e.g. University of Michigan" value="${esc(p.school||'')}"></label>
  <div class="grid2"><label class="f">Level<select class="in" id="pf-level" required>${previousLevel?'<option value="" disabled selected>Choose a level</option>':''}${LEVELS.map(l=>`<option ${l===(p.level||'College')?'selected':''}>${l}</option>`).join('')}</select></label><label class="f"><span>Major or program <span style="font-weight:400">(optional)</span></span><input class="in" id="pf-major" placeholder="Biology" value="${esc(p.major||'')}"></label></div>
  <label class="f">Current term<input class="in" id="pf-term" value="${esc(p.term||curSemester())}"></label>
  <label class="f">Class format<select class="in" id="pf-learning-mode"><option value="" ${learningMode?'':'selected'}>Choose a format (optional)</option><option value="online" ${learningMode==='online'?'selected':''}>Online</option><option value="in-person" ${learningMode==='in-person'?'selected':''}>In-person</option></select><small class="muted">This setting syncs with this library across your devices and does not change billing.</small></label>`;
}
function readProfileForm(prev){
  const profile={...(prev||{}),firstName:$('#pf-first').value.trim(),lastName:$('#pf-last').value.trim(),school:$('#pf-school').value.trim(),level:$('#pf-level').value,major:$('#pf-major').value.trim(),term:$('#pf-term').value.trim()||curSemester(),created:(prev&&prev.created)||Date.now(),updated:Date.now()};
  if($('#pf-birth-month')&&$('#pf-birth-year'))profile.ageBand=currentAgeBand($('#pf-birth-month').value,$('#pf-birth-year').value);
  delete profile.birthDate;delete profile.dateOfBirth;delete profile.birthMonth;delete profile.birthYear;
  const learningMode=$('#pf-learning-mode').value;
  if(learningMode==='online'||learningMode==='in-person')profile.learningMode=learningMode;
  return profile;
}
VIEWS.welcome=()=>`
  <div class="welcome">
    <div class="brand" style="padding:0;margin-bottom:22px"><span class="brand-mark">${ic('wave')}</span><div><b>ClassScribe</b><small>Your academic memory</small></div></div>
    <h1>Set up your library</h1>
    <p class="sub muted" style="margin:8px 0 20px">Your classes. Captured. Organized. Understood. Tell us a little about you to get started.</p>
    <form class="panel stack" data-form="welcome">
      ${profileFields(null,true)}
      <hr class="hr">
      <label class="check"><input type="checkbox" id="pf-consent" required><span>I’ll only record classes where my instructor and school allow it, and I’ll share recordings only where sharing is allowed.</span></label>
      <button class="btn primary" style="justify-content:center;padding:12px">Create library</button>
      <p class="small muted">${S.mode==='db'?'Your account is tied to your claude.ai sign-in. Only your name is visible to classmates in class groups.':'Your account is saved in this browser. Sign in to claude.ai to sync it across devices and join class groups.'}</p>
    </form>
  </div>`;
VIEWS.account=()=>{const p=S.profile||{};ACCOUNT_FORM_BASELINE={...p};return `
  <div class="page-h"><div><p class="eyebrow">Account</p><h1>${esc(displayName(p)||'Your account')}</h1><p class="sub">${esc([LEVELS.includes(p.level)?'ClassScribe '+p.level:'',p.school,p.major].filter(Boolean).join(' · '))}</p></div></div>
  <section class="panel profile-photo-card" aria-labelledby="profile-photo-heading">
    ${profilePhotoMarkup('profile-photo-preview')}
    <div class="profile-photo-content"><div><h2 id="profile-photo-heading">Profile photo</h2><p class="small muted">Add a photo to personalize your ClassScribe profile.</p></div>
      <div class="row profile-photo-actions"><input id="profile-photo-file" type="file" accept="image/jpeg,image/png,image/webp" hidden${S.mode==='db'||S.mode==='local'?'':' disabled'}><button type="button" class="btn sm" data-profile-photo-action="pick"${S.mode==='db'||S.mode==='local'?'':' disabled'}>Upload photo</button><button type="button" class="btn sm" data-profile-photo-action="remove" hidden>Remove</button></div>
      <p id="profile-photo-status" class="small muted" role="status" aria-live="polite">${S.mode==='local'?'Saved only in this browser · JPEG, PNG, or WebP up to 3 MB':S.mode==='db'?'Synced photo · JPEG, PNG, or WebP up to 3 MB':'Photo upload is unavailable in this mode.'}</p>
      <p id="profile-photo-local-notice" class="small profile-photo-local-notice" role="status" aria-live="polite" hidden>A browser-only photo is still saved on this device; it has not been synced to this library. To sync a photo, select it again using Upload or Replace.</p>
    </div>
  </section>
  <form class="panel stack" data-form="account" style="max-width:640px">${profileFields(p)}
    <div class="row"><button class="btn primary">Save changes</button><span class="small muted">Classmates see your name in class groups.</span></div></form>
  <div style="max-width:640px;margin-top:14px">${billingStatusPanel()}${creditsSummaryMarkup()}</div>
  <section class="panel stack" style="max-width:640px;margin-top:14px;gap:10px" aria-labelledby="privacy-heading">
    <div><h3 id="privacy-heading">Privacy and your data</h3><p class="small muted" style="margin-top:4px">Request a private export or delete this library. For an anonymous sync library, sign in and explicitly link this library to the account before making authenticated privacy requests. The app will not silently redirect requests to a different free library.</p></div>
    <p id="privacy-status" class="small muted" role="status" aria-live="polite">${S.mode==='db'?'Loading privacy status…':'Privacy requests for this browser-only library are available after it is synced.'}</p>
    <div class="row"><button type="button" class="btn sm" data-act="privacyLinkLibrary" hidden>Link this library to my account</button><button type="button" class="btn sm" data-act="privacyReconnectLibrary" hidden>Reconnect to my linked library</button></div>
    <div class="row"><button type="button" class="btn" data-act="privacyExport"${S.mode==='db'&&clerkClient&&clerkClient.user?'':' disabled'}>Export my data</button><button type="button" class="btn rec" data-act="privacyDelete"${privacyLibraryCode()?'':' disabled'}>Delete this library</button></div>
    <p id="privacy-export-status" class="small muted" role="status" aria-live="polite"></p>
    <p class="small muted">Read our <a href="/privacy.html">Privacy Policy</a> and <a href="/terms.html">Terms of Service</a>.</p>
  </section>
  <section class="panel stack" style="max-width:640px;margin-top:14px;gap:10px" aria-labelledby="home-layout-heading">
    <div><h3 id="home-layout-heading">Home layout</h3><p class="small muted" style="margin-top:4px">Saved right away for this library and shared with your other devices.</p></div>
    <div class="stack" role="radiogroup" aria-label="Home layout">${HOME_LAYOUT_CHOICES.map(([id,label])=>`<button type="button" class="home-view-option" role="radio" aria-checked="${homeLayoutValue()===id}" data-act="homeLayoutPick" data-layout="${id}"><span><strong>${label}</strong></span><span class="home-view-check" aria-hidden="true">${homeLayoutValue()===id?'✓':''}</span></button>`).join('')}</div>
  </section>
  <section class="panel stack" style="max-width:640px;margin-top:14px;gap:10px" aria-labelledby="appearance-heading">
    <div><h3 id="appearance-heading">Appearance</h3><p class="small muted" style="margin-top:4px">Saved for this library and shared with your other devices.</p></div>
    <div class="stack" role="radiogroup" aria-label="Appearance">${APPEARANCE_CHOICES.map(([id,label])=>`<button type="button" class="home-view-option" role="radio" aria-checked="${appearanceValue()===id}" aria-label="${label}" data-act="appearancePick" data-appearance="${id}"><span><strong>${label}</strong><small>${id==='auto'?'Use the light or dark setting of this device':id==='light'?'Always use light colors':'Always use dark colors'}</small></span><span class="appearance-check" aria-hidden="true">${appearanceValue()===id?'✓':''}</span></button>`).join('')}</div>
  </section>
  <section class="panel stack" style="max-width:640px;margin-top:14px;gap:10px" aria-labelledby="clerk-account-heading">
    <style>#clerk-account-forgot-fallback[hidden],#clerk-password-reset-panel[hidden],#clerk-reset-email-row[hidden],#clerk-reset-code-row[hidden],#clerk-reset-password-row[hidden],#clerk-reset-error[hidden],#clerk-reset-notice[hidden],[data-act="clerkResetResend"][hidden]{display:none!important}</style>
    <div><h3 id="clerk-account-heading">Optional account sign-in</h3><p class="small muted" style="margin-top:5px">This optional sign-in is separate from your sync code. It does not link or move your library unless you explicitly choose “Link this library to my account” in Privacy and your data. Your sync code remains the way to use the same library on another device.</p></div>
    <div id="clerk-account-state" class="small muted" role="status" aria-live="polite">Checking account sign-in availability…</div>
    <button id="clerk-signup-age-start" type="button" class="btn sm" data-act="clerkSignupAgeStart" hidden>Create a new account</button>
    <section id="clerk-age-gate" class="panel stack" style="gap:8px" aria-label="Age check" hidden>
      <b>Confirm your age before creating an account</b><p class="small muted">We check month and year only and do not save your birth date. Under-13 users cannot create an account.</p>
      <div class="grid2"><label class="f">Birth month<select class="in" id="clerk-birth-month"><option value="">Choose month</option>${Array.from({length:12},(_,i)=>`<option value="${i+1}">${new Date(2000,i,1).toLocaleString(undefined,{month:'long'})}</option>`).join('')}</select></label><label class="f">Birth year<input class="in" id="clerk-birth-year" type="number" inputmode="numeric" min="1900" max="${new Date().getFullYear()}" autocomplete="off"></label></div>
      <p id="clerk-age-gate-message" class="small" role="alert" aria-live="polite" style="color:var(--warn)" hidden></p><div class="row"><button type="button" class="btn" data-act="clerkAgeGateCancel">Cancel</button><button type="button" class="btn primary" data-act="clerkAgeGateSubmit">Continue to account creation</button></div>
    </section>
    <p id="clerk-account-error" class="small" role="alert" style="color:var(--rec)" hidden></p>
    <div id="clerk-account-methods" class="stack" style="gap:8px" hidden></div>
    <p id="clerk-apple-note" class="small muted" role="status" aria-live="polite"></p>
    <div id="clerk-account-widget"></div>
    <div id="clerk-account-forgot-fallback" class="row" style="justify-content:flex-end"><button type="button" class="btn sm" data-act="clerkForgotPassword">Forgot password?</button></div>
    <section id="clerk-password-reset-panel" class="panel stack" style="margin-top:10px" aria-labelledby="clerk-reset-heading" hidden>
      <div><h3 id="clerk-reset-heading">Reset your password</h3><p id="clerk-reset-help" class="small muted" style="margin-top:4px">Enter your account email address and we’ll send you a reset code.</p></div>
      <p id="clerk-reset-error" class="small" role="alert" style="color:var(--rec)" hidden></p>
      <p id="clerk-reset-notice" class="small muted" role="status" aria-live="polite" hidden></p>
      <label id="clerk-reset-email-row" class="stack small">Email address<input id="clerk-reset-email" class="in" type="email" autocomplete="email" placeholder="you@school.edu"></label>
      <label id="clerk-reset-code-row" class="stack small" hidden>Reset code<input id="clerk-reset-code" class="in" inputmode="numeric" autocomplete="one-time-code" placeholder="Reset code"></label>
      <label id="clerk-reset-password-row" class="stack small" hidden>New password<span class="row"><input id="clerk-reset-password" class="in" type="password" autocomplete="new-password" placeholder="New password" style="flex:1"><button type="button" class="btn sm" aria-label="Show password" data-act="clerkResetVisibility">Show</button></span></label>
      <div class="row"><button type="button" class="btn primary" data-act="clerkResetSubmit">Send reset code</button><button type="button" class="btn" data-act="clerkResetResend" hidden>Send a new code</button><button type="button" class="btn" data-act="clerkResetBack">Back to sign in</button></div>
    </section>
  </section>
  ${window.CS_SYNC?`<section class="panel stack" style="max-width:640px;margin-top:14px;gap:10px"><h3>Sync with your phone</h3><div id="sync-code-replaced" role="alert" hidden style="padding:12px;border-radius:10px;background:var(--warn-soft);color:var(--warn)"><b>This library code was replaced.</b><p class="small" style="margin:5px 0 0">Background sync stopped, but unsynced changes are saved in this browser. Enter your library’s replacement code below to reconnect. Class invite codes are unchanged.</p></div><p class="small muted">Enter this code in the ClassScribe iPhone app (Account → Sync with the web) to use one library on both. Keep it private: anyone with it can open your library.</p><div class="row"><code class="mono" style="padding:8px 10px;background:var(--surface-2);border-radius:8px;user-select:all">${esc(window.CS_SYNC.code)}</code><button class="btn sm" data-act="copySync">Copy</button></div><div class="row"><input class="in" id="sync-in" placeholder="Use a code from another device: u_…" style="flex:1;min-width:200px"><button class="btn sm" data-act="useSync">${window.CS_SYNC.replaced?'Use replacement code':'Use code'}</button></div><button class="btn sm" data-act="rotateSync">Replace compromised sync code</button><p class="small muted">Moves your library to a new code and blocks the old one. Update your other devices with the new code. Class invite codes stay the same.</p></section>`:''}
  <section class="panel" style="max-width:640px;margin-top:14px"><div class="spread" style="align-items:center"><div><h3>Example courses</h3><p class="small muted" style="margin-top:4px">BIO 101 and CHEM 110 with sample lectures, notes and a class group, for trying every feature.</p></div>${examplesVisible()?`<button class="btn" data-act="hideEx">Hide examples</button>`:`<button class="btn primary" data-act="showEx">Show example courses</button>`}</div></section>
  <section class="panel" style="max-width:640px;margin-top:14px"><h3>Where your data lives</h3><p class="small muted" style="margin-top:6px">${S.mode==='db'?'Synced to your signed-in ClassScribe library. Your library is private to you; only lectures you choose to share and posts you write are visible to your class group.':'Saved in this browser only. Sign in to sync.'}</p><p class="small muted" style="margin-top:8px"><a href="/privacy.html">Privacy Policy</a> · <a href="/terms.html">Terms of Service</a></p></section>`};

let clerkClient=null,clerkLoad=null,clerkBrowserLoad=null,clerkWidget=null,clerkResetOpen=false,clerkResetStep='email',clerkResetEmail='',clerkPasswordObserver=null;
function isEmbeddedPreview(){
  try{return window.top!==window.self}catch(e){return true}
}
function clerkAccountPageUrl(appleReturn=false){
  const url=new URL(window.location.pathname||'/',window.location.origin);
  url.searchParams.set('cs_account','1');
  if(appleReturn)url.searchParams.set('clerk_account_return','apple');
  return url.toString();
}
function clerkErrorDetail(error){
  const detail=error&&error.errors&&error.errors[0];
  return detail&&(detail.longMessage||detail.message)||error&&error.message||String(error||'Unknown Clerk error');
}
function clerkAccountError(message){
  const error=$('#clerk-account-error');
  if(error){error.hidden=!message;error.textContent=message||''}
}
function clerkProviderStrategies(){
  const settings=clerkClient&&clerkClient.__internal_environment&&clerkClient.__internal_environment.userSettings;
  const strategies=settings&&settings.socialProviderStrategies;
  if(!Array.isArray(strategies))return null;
  return strategies.map(item=>String(typeof item==='string'?item:item&&(item.strategy||item.provider||item.name)||'').toLowerCase()).filter(Boolean);
}
function clerkSupportsStrategy(strategy){
  const strategies=clerkProviderStrategies();
  if(strategies===null)return null;
  const requested=strategy.toLowerCase();
  if(requested==='oauth_apple')return strategies.includes('oauth_apple')||strategies.includes('apple');
  return strategies.includes(requested);
}
function clerkExternalAccounts(){
  const accounts=clerkClient&&clerkClient.user&&clerkClient.user.externalAccounts;
  return Array.isArray(accounts)?accounts:[];
}
function clerkProviderLabel(account){
  const provider=String(account&&(account.provider||account.strategy)||'').replace(/^oauth_/,'').toLowerCase();
  const names={apple:'Apple',google:'Google',github:'GitHub',twitter:'X',x:'X',facebook:'Facebook',microsoft:'Microsoft'};
  return names[provider]||provider.charAt(0).toUpperCase()+provider.slice(1)||'Connected provider';
}
function clerkIsAppleAccount(account){
  return /^(oauth_)?apple$/i.test(String(account&&(account.provider||account.strategy)||''));
}
function clerkIsVerifiedAppleAccount(account){
  return clerkIsAppleAccount(account)&&account.verification&&account.verification.status==='verified';
}
let clerkAppleReturnVerified=false;
async function finishClerkAppleReturn(){
  const returnUrl=new URL(location.href);
  if(returnUrl.searchParams.get('clerk_account_return')!=='apple')return;
  let expectedUserId='';
  try{expectedUserId=sessionStorage.getItem('cs_clerk_apple_link_user_id')||''}catch(e){}
  try{
    if(!expectedUserId)throw new Error('The original account could not be verified after returning from Apple.');
    let user=clerkClient&&clerkClient.user;
    if(!user)throw new Error('The Apple return is signed out. Sign in to the original ClassScribe account; Apple was not confirmed as linked.');
    if(user.id!==expectedUserId)throw new Error('The signed-in Clerk account changed during Apple linking. No link was confirmed for this account.');
    if(typeof user.reload!=='function')throw new Error('This Clerk client cannot refresh the account to verify Apple linking.');
    user=await user.reload();
    if(!user||user.id!==expectedUserId||(clerkClient.user&&clerkClient.user.id!==expectedUserId)){
      throw new Error('The original Clerk account did not persist through Apple linking. No verified Apple link was confirmed.');
    }
    const appleAccount=(user.externalAccounts||[]).find(clerkIsAppleAccount);
    if(!appleAccount)throw new Error('Clerk returned without an Apple account connection. No Apple link was confirmed.');
    const verification=appleAccount.verification;
    if(!verification||verification.status!=='verified'){
      if(verification&&verification.error)throw verification.error;
      throw new Error(verification&&verification.message||`Apple verification is ${verification&&verification.status||'not complete'}; no verified link was confirmed.`);
    }
    clerkAppleReturnVerified=true;
    clerkAccountError('');
    clerkAccountMessage('Apple is verified and connected to this existing ClassScribe account.');
  }catch(error){
    clerkAccountError(`Apple link not confirmed: ${clerkErrorDetail(error)}`);
    clerkAccountMessage('Your original sign-in and library remain available. No verified Apple link was confirmed.');
  }finally{
    try{sessionStorage.removeItem('cs_clerk_apple_link_user_id')}catch(e){}
    returnUrl.searchParams.delete('clerk_account_return');
    history.replaceState(history.state,'',returnUrl.toString());
  }
}
function renderClerkMethods(){
  const methods=$('#clerk-account-methods'),note=$('#clerk-apple-note');
  if(!methods||!note||!clerkClient||!clerkClient.user)return;
  const accounts=clerkExternalAccounts();
  const appleConnected=accounts.some(clerkIsVerifiedAppleAccount);
  const appleAccount=accounts.find(clerkIsAppleAccount);
  const supportsApple=clerkSupportsStrategy('oauth_apple');
  methods.hidden=false;
  methods.innerHTML=`<div><h3>Sign-in methods</h3><p class="small muted" style="margin-top:4px">These providers are connected to this Clerk account. Your ClassScribe library and sync code are unchanged.</p></div>
    <ul class="small" style="margin:0;padding-left:20px">${accounts.length?accounts.map(account=>`<li>${esc(clerkProviderLabel(account))}${clerkIsAppleAccount(account)&&!clerkIsVerifiedAppleAccount(account)?' · verification pending':''}${account.emailAddress?` · ${esc(account.emailAddress)}`:''}</li>`).join(''):'<li>Email/password or another non-social sign-in</li>'}</ul>
    ${supportsApple===true&&!appleAccount?'<button type="button" class="btn sm" data-act="clerkLinkApple">Link Apple to this account</button>':''}`;
  if(appleConnected){
    note.textContent='Apple is linked to this account. Apple may use a private relay email address (“Hide My Email”); it is still this same account, and ClassScribe does not merge accounts by email.';
  }else if(appleAccount){
    note.textContent='Apple verification is pending or incomplete. ClassScribe will only report Apple as connected after Clerk confirms verification.';
  }else if(supportsApple===false){
    note.textContent="Sign in with Apple isn't available here yet — use Google or email. Apple is not enabled for this Clerk environment, so it cannot be linked here. Your current sign-in, library, and sync code remain available.";
  }else if(supportsApple===true){
    note.textContent='Apple may use a private relay email address (“Hide My Email”). Linking adds Apple to this already signed-in account; it does not find or merge accounts by email.';
  }else{
    note.textContent='';
  }
}
async function linkClerkApple(button){
  if(isEmbeddedPreview()){
    clerkAccountMessage('To link Apple, open Account in a new tab first. Apple sign-in cannot complete inside the Replit preview frame.');
    return;
  }
  const user=clerkClient&&clerkClient.user;
  if(!user||typeof user.createExternalAccount!=='function'){
    clerkAccountError('Apple linking is unavailable because this Clerk client does not support external account linking.');
    return;
  }
  if(clerkSupportsStrategy('oauth_apple')===false){
    clerkAccountError('Apple is not enabled for this Clerk environment. Your existing account was not changed.');
    renderClerkMethods();
    return;
  }
  if(button)button.disabled=true;
  clerkAccountError('');
  clerkAccountMessage('Starting secure Apple linking…');
  try{
    try{sessionStorage.setItem('cs_clerk_apple_link_user_id',user.id)}catch(error){throw new Error('The original account could not be safely retained for Apple verification. Please allow session storage and try again.')}
    const redirectUrl=clerkAccountPageUrl(true);
    const result=await user.createExternalAccount({strategy:'oauth_apple',redirectUrl});
    const verification=result&&result.verification;
    if(verification&&verification.error)throw verification.error;
    const redirect=verification&&verification.externalVerificationRedirectURL;
    if(!redirect)throw new Error('Clerk did not provide an Apple verification URL. Your account was not changed.');
    clerkAccountMessage('Continue in Apple’s secure sign-in page. This links Apple to your existing ClassScribe account; it does not create or merge another account.');
    window.location.assign(redirect);
  }catch(error){
    try{sessionStorage.removeItem('cs_clerk_apple_link_user_id')}catch(e){}
    clerkAccountError(`Could not link Apple: ${clerkErrorDetail(error)}`);
    clerkAccountMessage('Your existing sign-in, library, and sync code are unchanged.');
    if(button)button.disabled=false;
  }
}
function loadClerkBrowser(){
  if(window.ClassScribeClerk&&typeof window.ClassScribeClerk.Clerk==='function')return Promise.resolve(window.ClassScribeClerk);
  if(!clerkBrowserLoad)clerkBrowserLoad=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='/clerk.browser.js';
    script.async=true;
    script.onload=()=>window.ClassScribeClerk&&typeof window.ClassScribeClerk.Clerk==='function'&&typeof window.ClassScribeClerk.ClerkUI==='function'?resolve(window.ClassScribeClerk):reject(new Error('Clerk browser asset did not initialize'));
    script.onerror=()=>reject(new Error('Clerk browser asset could not be loaded'));
    document.head.appendChild(script);
  });
  return clerkBrowserLoad;
}
function clerkAccountMessage(message){
  const state=$('#clerk-account-state');
  if(state)state.textContent=message;
}
function refreshClerkAccount(){
  const state=$('#clerk-account-state'),widget=$('#clerk-account-widget');
  if(!state||!widget||!clerkClient)return;
  if(clerkResetOpen)return;
  if(clerkClient.user){
    clerkSignupAgeBand=null;clerkAgeGateRequested=false;
    const forgot=$('#clerk-account-forgot-fallback');if(forgot)forgot.hidden=true;
    if(clerkPasswordObserver){clerkPasswordObserver.disconnect();clerkPasswordObserver=null}
    const user=clerkClient.user;
    const name=user.fullName||user.primaryEmailAddress?.emailAddress||'Signed in';
    state.innerHTML=`Signed in as <b>${esc(name)}</b>${user.primaryEmailAddress?.emailAddress&&name!==user.primaryEmailAddress.emailAddress?` <span class="muted">(${esc(user.primaryEmailAddress.emailAddress)})</span>`:''}`;
    widget.innerHTML='<button type="button" class="btn sm" data-act="clerkSignOut">Sign out</button>';
    if(clerkWidget){try{clerkClient.unmountSignIn(clerkWidget)}catch(e){}clerkWidget=null}
    const gate=$('#clerk-age-gate'),start=$('#clerk-signup-age-start');if(gate)gate.hidden=true;if(start)start.hidden=true;
    renderClerkMethods();
    if(S.view.name==='account'){
      void loadPrivacyStatus();
      const ageBand=S.profile&&S.profile.ageBand;
      if(ageBand==='13-17'||ageBand==='18+')persistProfileAgeBand(ageBand).catch(error=>clerkAccountError(error.message||'Could not save your age band.'));
    }
    if(clerkAppleReturnVerified)state.textContent=`Signed in as ${name}. Apple is verified and connected to this account.`;
    return;
  }
  PRIVACY_STATUS=null;PRIVACY_LINK_STATUS=null;renderPrivacyStatus();
  const ageGate=$('#clerk-age-gate'),ageStart=$('#clerk-signup-age-start');
  if(clerkAgeGateRequested){
    if(ageGate)ageGate.hidden=false;if(ageStart)ageStart.hidden=true;
    if(clerkWidget){try{clerkClient.unmountSignIn(clerkWidget)}catch(e){}clerkWidget=null}
    state.textContent='Confirm your age before creating a new account. Existing email sign-in remains available without this check.';
    widget.hidden=true;
    const methods=$('#clerk-account-methods');if(methods)methods.hidden=true;
    return;
  }
  if(ageGate)ageGate.hidden=true;if(ageStart)ageStart.hidden=!!clerkSignupAgeBand;
  widget.hidden=false;
  const methods=$('#clerk-account-methods');if(methods)methods.hidden=true;
  PRIVACY_STATUS=null;renderPrivacyStatus();
  const note=$('#clerk-apple-note');if(note)note.textContent=clerkSupportsStrategy('oauth_apple')===false?"Sign in with Apple isn't available here yet — use Google or email. Apple is not enabled for this Clerk environment. Your current account and library remain available.":'';
  if(isEmbeddedPreview()){
    if(clerkWidget){try{clerkClient.unmountSignIn(clerkWidget)}catch(e){}clerkWidget=null}
    state.textContent='Apple sign-in cannot complete inside the Replit preview frame. Open Account in a new tab to sign in safely.';
    widget.innerHTML=`<a class="btn primary" target="_blank" rel="noopener" href="${esc(clerkAccountPageUrl())}">Open sign-in in a new tab</a>`;
    return;
  }
  state.textContent=clerkSignupAgeBand?'Age check complete for this account-creation attempt. Sign in or create an account using the methods available for this ClassScribe environment.':'Sign in with an existing account. Creating an account requires a month-and-year age check first.';
  if(clerkWidget&&clerkWidget!==widget){try{clerkClient.unmountSignIn(clerkWidget)}catch(e){}clerkWidget=null}
  if(!clerkWidget){
    clerkWidget=widget;
    try{
      const css=getComputedStyle(document.documentElement);
      clerkClient.mountSignIn(widget,{routing:'virtual',withSignUp:!!clerkSignupAgeBand,transferable:!!clerkSignupAgeBand,unsafeMetadata:clerkSignupAgeBand?{ageBand:clerkSignupAgeBand}:undefined,appearance:{variables:{
        colorPrimary:css.getPropertyValue('--accent').trim(),
        colorBackground:css.getPropertyValue('--surface').trim(),
        colorText:css.getPropertyValue('--ink').trim(),
        colorInputBackground:css.getPropertyValue('--surface-2').trim(),
        colorInputText:css.getPropertyValue('--ink').trim(),
        colorNeutral:css.getPropertyValue('--line').trim(),
        borderRadius:'10px',fontFamily:getComputedStyle(document.body).fontFamily,
      }},initialValues:clerkResetEmail?{emailAddress:clerkResetEmail}:undefined});
      watchClerkPasswordField(widget);
    }catch(e){
      clerkWidget=null;
      clerkAccountError(`Account sign-in could not be displayed: ${clerkErrorDetail(e)}`);
      clerkAccountMessage('Your sync code and library still work normally. Please try again later.');
    }
  }
}
function clerkSignInResource(){return clerkClient&&clerkClient.client&&clerkClient.client.signIn}
function clerkResetError(error){
  const detail=error&&error.errors&&error.errors[0],message=detail&&(detail.longMessage||detail.message)||error&&error.message||'We could not complete that step. Please try again.';
  return /expired|invalid.*code|code.*invalid/i.test(`${detail&&detail.code||''} ${message}`)?'That code is invalid or has expired. Check the latest email or send a new code.':message;
}
function clerkResetMessage(message,isError){
  const error=$('#clerk-reset-error'),notice=$('#clerk-reset-notice');
  if(error){error.hidden=!isError;error.textContent=isError?message:''}
  if(notice){notice.hidden=!!isError;notice.textContent=isError?'':message}
}
function clerkResetRender(){
  const panel=$('#clerk-password-reset-panel'),widget=$('#clerk-account-widget'),fallback=$('#clerk-account-forgot-fallback');
  if(!panel||!widget)return;
  panel.hidden=!clerkResetOpen;
  widget.hidden=clerkResetOpen;
  if(fallback)fallback.hidden=clerkResetOpen;
  for(const [id,step] of [['clerk-reset-email-row','email'],['clerk-reset-code-row','code'],['clerk-reset-password-row','password']]){
    const row=$(`#${id}`);if(row)row.hidden=clerkResetStep!==step;
  }
  const submit=$('[data-act="clerkResetSubmit"]'),resend=$('[data-act="clerkResetResend"]');
  if(submit)submit.textContent=clerkResetStep==='email'?'Send reset code':clerkResetStep==='code'?'Verify reset code':'Save new password';
  if(resend)resend.hidden=clerkResetStep!=='code';
  const help=$('#clerk-reset-help');
  if(help)help.textContent=clerkResetStep==='email'?'Enter your account email address and we’ll send you a reset code.':clerkResetStep==='code'?`Enter the password reset code sent to ${clerkResetEmail}.`:'Your email is verified. Choose a new password for your account.';
}
function openClerkReset(){
  if(!clerkClient||clerkClient.user)return;
  const typed=$('#clerk-account-widget input[type="email"], #clerk-account-widget input[name="emailAddress"], #clerk-account-widget input[name="identifier"]');
  clerkResetEmail=(typed&&typed.value||$('#clerk-reset-email')&&$('#clerk-reset-email').value||'').trim();
  clerkResetOpen=true;clerkResetStep='email';
  const email=$('#clerk-reset-email');if(email)email.value=clerkResetEmail;
  clerkResetMessage('',false);
  if(clerkPasswordObserver){clerkPasswordObserver.disconnect();clerkPasswordObserver=null}
  if(clerkWidget){try{clerkClient.unmountSignIn(clerkWidget)}catch(e){}clerkWidget=null}
  clerkResetRender();
  if(email)email.focus();
}
async function submitClerkReset(){
  const resource=clerkSignInResource();
  if(!resource){clerkResetMessage('Account sign-in is not ready. Please try again.',true);return}
  const button=$('[data-act="clerkResetSubmit"]');if(button)button.disabled=true;
  const value=id=>{const input=$(`#${id}`);return input?(input.value||'').trim():''};
  clerkResetMessage('',false);
  try{
    if(clerkResetStep==='email'){
      clerkResetEmail=value('clerk-reset-email');
      if(!clerkResetEmail)throw new Error('Enter your email address to receive a reset code.');
      let result=await resource.reset();if(result&&result.error)throw result.error;
      result=await resource.create({identifier:clerkResetEmail});if(result&&result.error)throw result.error;
      result=await resource.resetPasswordEmailCode.sendCode();if(result&&result.error)throw result.error;
      clerkResetStep='code';clerkResetMessage('A password reset code was sent. Check your email.',false);
    }else if(clerkResetStep==='code'){
      const code=value('clerk-reset-code');if(!code)throw new Error('Enter the reset code sent to your email.');
      const result=await resource.resetPasswordEmailCode.verifyCode({code});if(result&&result.error)throw result.error;
      if(resource.status!=='needs_new_password')throw new Error('The reset code needs another verification step. Send a new code and try again.');
      clerkResetStep='password';
    }else{
      const password=value('clerk-reset-password');if(!password)throw new Error('Enter a new password.');
      const changed=await resource.resetPasswordEmailCode.submitPassword({password});if(changed&&changed.error)throw changed.error;
      if(resource.status!=='complete')throw new Error('Your password changed, but another sign-in step is required. Return to sign in and use your new password.');
      const finalized=await resource.finalize();if(finalized&&finalized.error)throw finalized.error;
      clerkResetOpen=false;clerkResetRender();refreshClerkAccount();return;
    }
    clerkResetRender();
  }catch(error){clerkResetMessage(clerkResetError(error),true)}
  finally{if(button)button.disabled=false}
}
function resendClerkReset(){
  const resource=clerkSignInResource(),button=$('[data-act="clerkResetResend"]');
  if(!resource||!resource.resetPasswordEmailCode)return;
  if(button)button.disabled=true;
  clerkResetMessage('',false);
  resource.resetPasswordEmailCode.sendCode().then(result=>{
    if(result&&result.error)throw result.error;
    const code=$('#clerk-reset-code');if(code)code.value='';
    clerkResetMessage('A new reset code was sent. Check your email.',false);
  }).catch(error=>clerkResetMessage(clerkResetError(error),true)).finally(()=>{if(button)button.disabled=false});
}
async function backFromClerkReset(){
  const resource=clerkSignInResource();
  let resetError='';
  if(resource&&typeof resource.reset==='function'){try{const result=await resource.reset();if(result&&result.error)throw result.error}catch(error){resetError=clerkResetError(error)}}
  const email=$('#clerk-reset-email');clerkResetEmail=(email&&email.value||clerkResetEmail).trim();
  clerkResetOpen=false;clerkResetStep='email';clerkResetRender();
  const widget=$('#clerk-account-widget');if(widget){clerkWidget=null;refreshClerkAccount()}
  if(resetError)clerkAccountMessage(`Could not reset sign-in cleanly: ${resetError}`);
}
function watchClerkPasswordField(widget){
  if(clerkPasswordObserver)clerkPasswordObserver.disconnect();
  const place=()=>{
    const input=widget.querySelector('input[type="password"],input[data-cs-password-visible="true"]');
    const fallback=$('#clerk-account-forgot-fallback');
    if(fallback)fallback.hidden=!!input;
    if(!input)return;
    const row=input.closest('.cl-formField,.cl-formFieldRow')||input.parentElement;
    if(!row||row.nextElementSibling&&row.nextElementSibling.dataset.csForgotPassword)return;
    const link=document.createElement('div');link.dataset.csForgotPassword='true';link.style.cssText='display:flex;justify-content:flex-end;padding-top:5px';
    const button=document.createElement('button');button.type='button';button.textContent='Forgot password?';button.className='cl-formFieldAction';button.style.cssText='border:0;background:transparent;color:var(--accent);font:inherit;font-size:13px;font-weight:600;cursor:pointer';
    button.addEventListener('click',openClerkReset);link.appendChild(button);row.insertAdjacentElement('afterend',link);
    const eye=document.createElement('button');eye.type='button';eye.textContent='Show';eye.setAttribute('aria-label','Show password');eye.className='btn sm';eye.style.marginTop='6px';
    eye.addEventListener('click',()=>{const visible=input.type==='password';input.type=visible?'text':'password';if(visible)input.dataset.csPasswordVisible='true';else delete input.dataset.csPasswordVisible;eye.textContent=visible?'Hide':'Show';eye.setAttribute('aria-label',visible?'Hide password':'Show password')});
    input.insertAdjacentElement('afterend',eye);
  };
  place();
  if(typeof MutationObserver!=='undefined'){clerkPasswordObserver=new MutationObserver(place);clerkPasswordObserver.observe(widget,{childList:true,subtree:true})}
}
ACT.clerkForgotPassword=()=>openClerkReset();
ACT.clerkLinkApple=el=>void linkClerkApple(el);
ACT.clerkResetSubmit=()=>void submitClerkReset();
ACT.clerkResetResend=()=>resendClerkReset();
ACT.clerkResetBack=()=>void backFromClerkReset();
ACT.clerkResetVisibility=el=>{const input=$('#clerk-reset-password');if(!input)return;const visible=input.type==='password';input.type=visible?'text':'password';el.textContent=visible?'Hide':'Show';el.setAttribute('aria-label',visible?'Hide password':'Show password')};
function clerkSignInMethodsAvailable(){
  const settings=clerkClient&&clerkClient.__internal_environment&&clerkClient.__internal_environment.userSettings;
  if(!settings)return null;
  return !!(settings.hasValidAuthFactor||(settings.socialProviderStrategies&&settings.socialProviderStrategies.length));
}
function initClerkAccount(){
  const state=$('#clerk-account-state'),widget=$('#clerk-account-widget');
  if(!state||!widget)return;
  if(isEmbeddedPreview()){
    state.textContent='Apple sign-in and account linking cannot complete inside the Replit preview frame. Open Account in a new tab to continue securely.';
    widget.innerHTML=`<a class="btn primary" target="_blank" rel="noopener" href="${esc(clerkAccountPageUrl())}">Open sign-in in a new tab</a>`;
    const forgot=$('#clerk-account-forgot-fallback');if(forgot)forgot.hidden=true;
    return;
  }
  const config=window.CS_CLERK_CONFIG||{};
  if(!config.publishableKey){
    clerkAccountMessage('Optional account sign-in is not configured in this build. Your sync code and library remain available as usual.');
    return;
  }
  if(clerkLoad){
    clerkLoad.then(refreshClerkAccount).catch(error=>{
      clerkAccountError(`Optional account sign-in failed to load: ${clerkErrorDetail(error)}`);
      clerkAccountMessage('Your sync code and library remain available as usual.');
    });
    return;
  }
  clerkAccountMessage('Loading optional account sign-in…');
  clerkLoad=loadClerkBrowser().then(async sdk=>{
    const Clerk=sdk.Clerk;
    if(typeof Clerk!=='function')throw new Error('Clerk client could not be loaded');
    clerkClient=new Clerk(config.publishableKey);
    await clerkClient.load({proxyUrl:config.proxyUrl||undefined,ui:{ClerkUI:sdk.ClerkUI}});
    await finishClerkAppleReturn();
    if(clerkSignInMethodsAvailable()===false){
      clerkAccountMessage('Optional account sign-in is not enabled for this Clerk environment yet. Your sync code and library remain available as usual.');
      return;
    }
    clerkClient.addListener(refreshClerkAccount);
    refreshClerkAccount();
  });
  clerkLoad.catch(error=>{
    clerkAccountError(`Optional account sign-in failed to load: ${clerkErrorDetail(error)}`);
    clerkAccountMessage('Your sync code and library remain available as usual.');
  });
}

function paintSyncCodeReplacement(){
  const notice=$('#sync-code-replaced');
  if(notice)notice.hidden=!(window.CS_SYNC&&window.CS_SYNC.replaced);
  const button=$('[data-act="useSync"]');
  if(button&&window.CS_SYNC&&window.CS_SYNC.replaced)button.textContent='Use replacement code';
}
window.addEventListener('cs-sync-code-replaced',()=>{
  paintSyncCodeReplacement();
  toast('This library code was replaced. Open Account to enter the new code. Unsynced changes are saved in this browser.');
});
AFTER.account=()=>{syncProfilePhotoScope();refreshLocalPhotoNotice();paintSyncCodeReplacement();initClerkAccount();loadBillingStatus();loadCreditsStatus();void loadPrivacyConfig().catch(()=>{});renderPrivacyStatus()};
ACT.privacyExport=()=>void requestPrivacyExport();
ACT.privacyDelete=()=>openPrivacyDelete();
ACT.privacyLinkLibrary=()=>void linkCurrentPrivacyLibrary();
ACT.privacyReconnectLibrary=()=>openPrivacyReconnect();
ACT.privacyReconnectCancel=()=>closeModal();
ACT.privacyReconnectConfirm=()=>void confirmPrivacyReconnect();
ACT.privacyDeleteConfirm=()=>void deletePrivacyLibrary();
ACT.privacyDeleteFinish=()=>void finishPrivacyDeletion();
ACT.privacyManageBilling=()=>{closeModal();if(ACT.billingPortal)ACT.billingPortal()};
ACT.privacyFactorCancel=()=>cancelPrivacyFactor();
ACT.privacyFactorSubmit=()=>void submitPrivacyFactor();
ACT.clerkSignupAgeStart=()=>{
  clerkSignupAgeBand=null;clerkAgeGateRequested=true;
  if($('#clerk-age-gate-message')){$('#clerk-age-gate-message').hidden=true;$('#clerk-age-gate-message').textContent=''}
  refreshClerkAccount();
};
ACT.clerkAgeGateCancel=()=>{clerkAgeGateRequested=false;refreshClerkAccount()};
ACT.clerkAgeGateSubmit=async()=>{
  const month=$('#clerk-birth-month')?.value,year=$('#clerk-birth-year')?.value,band=currentAgeBand(month,year),message=$('#clerk-age-gate-message');
  if(!['13-17','18+'].includes(band)){
    if(message){message.hidden=false;message.textContent=band==='under13'?'ClassScribe is not available to children under 13. No account or library was created, and your month and year were not saved.':'Choose your birth month and year to continue. Your birth date is not saved.'}
    return;
  }
  if(message)message.hidden=true;
  if($('#clerk-birth-month'))$('#clerk-birth-month').value='';
  if($('#clerk-birth-year'))$('#clerk-birth-year').value='';
  try{await saveProfile({ageBand:band})}
  catch(error){if(message){message.hidden=false;message.textContent='Your age band could not be saved. '+(error.message||'Please try again.')}return}
  clerkSignupAgeBand=band;clerkAgeGateRequested=false;
  refreshClerkAccount();
};
document.addEventListener('change',event=>{if(event.target&&['pf-birth-month','pf-birth-year'].includes(event.target.id))updateWelcomeAgeGate()});
document.addEventListener('click',event=>{
  if(privacyDeletionComplete&&event.target.classList&&event.target.classList.contains('scrim')){event.preventDefault();event.stopImmediatePropagation();return}
  if(window._privacyFactorResolve&&event.target.classList&&event.target.classList.contains('scrim'))cancelPrivacyFactor();
},true);
document.addEventListener('keydown',event=>{
  if(privacyDeletionComplete&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();return}
  if(window._privacyFactorResolve&&event.key==='Escape')cancelPrivacyFactor();
},true);

ACT.copySync=()=>copyText(window.CS_SYNC.code);
ACT.clerkSignOut=async el=>{
  if(!clerkClient)return;
  el.disabled=true;
  try{await clerkClient.signOut();refreshClerkAccount()}
  catch(e){el.disabled=false;clerkAccountError(`Could not sign out: ${clerkErrorDetail(e)}`);clerkAccountMessage('Your sync code and library remain available.')}
};
ACT.useSync=async el=>{const v=($('#sync-in').value||'').trim();if(!/^u_[A-Za-z0-9]{10,40}$/.test(v)){toast('That code doesn’t look right. Sync codes start with u_.');return}
  if(!el.dataset.armed){el.dataset.armed='1';el.textContent=window.CS_SYNC.replaced?'Tap again to reconnect':'Tap again to switch library';el.style.color='var(--rec)';return}
  if(window.CS_SYNC.replaced&&!confirm('Reconnect to the library for this replacement code? Unsynced changes saved in this browser will be carried into that library. Only continue if this is your library’s replacement code. Class invite codes will not change.')){delete el.dataset.armed;el.textContent='Use replacement code';el.style.color='';return}
  el.disabled=true;
  try{await window.CS_SYNC.use(v)}
  catch(e){toast((e&&e.message)||'Could not use that code. Your current library and saved changes are unchanged.');el.disabled=false;delete el.dataset.armed;el.textContent=window.CS_SYNC.replaced?'Use replacement code':'Use code';el.style.color=''}};
ACT.rotateSync=async el=>{
  if(el.dataset.busy)return;
  if(!confirm('Replace this library sync code? Your notes and courses will move. The old code will stop working, and you must update your other devices. Class invite codes will not change.'))return;
  el.dataset.busy='1';el.disabled=true;
  try{await window.CS_SYNC.rotate()}
  catch(e){toast((e&&e.message)||'Could not replace the code. Your library has not been switched. Try again.');el.disabled=false;delete el.dataset.busy}
};
ACT.homeLayoutPick=async el=>{
  const saving=setHomeLayoutChoice(el.dataset.layout);
  if(S.view.name==='account')paintHomeLayoutChoices();
  else{closeModal();render()}
  try{
    await saving;
  }catch(e){toast('Home layout is saved on this device and will retry: '+((e&&e.message)||'offline'))}
};
ACT.appearancePick=async el=>{
  const saving=setAppearanceChoice(el.dataset.appearance);
  paintAppearanceChoices();
  try{await saving}
  catch(e){toast('Appearance is saved on this device and will retry: '+((e&&e.message)||'offline'))}
};
