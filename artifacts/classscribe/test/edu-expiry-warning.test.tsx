import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {ExpiryWarningCard} from '../instructor-src/school';
import type {EduSchool} from '../instructor-src/api';

const school:EduSchool={
  signedAgreementRef:'verified-school-agreement',adminUserId:'admin',
  verifiedAt:'2026-01-01T00:00:00Z',expiresAt:'2026-11-01T12:00:00Z',
  instructors:[],expiryWarning:{enabled:false,due:false,startsAt:'2026-10-02T12:00:00Z'},
};
const render=(enabled:boolean,due:boolean,busy=false)=>renderToStaticMarkup(
  <ExpiryWarningCard school={{...school,expiryWarning:{...school.expiryWarning,enabled,due}}} busy={busy} onToggle={()=>{}}/>
);

test('warning stays off until opted in, with truthful channel and access copy',()=>{
  const html=render(false,false);
  assert.doesNotMatch(html,/checked=""|role="alert"/);
  assert.match(html,/no email or push notification is sent/);
  assert.match(html,/does not renew your agreement or extend access/);
  assert.match(html,/stored records are kept/);
});
test('enabled warning shows schedule before the window and alert when due',()=>{
  assert.match(render(true,false),/checked=""[\s\S]*Warning starts/);
  const due=render(true,true);
  assert.match(due,/role="alert"/);
  assert.match(due,/verified-school-agreement/);
  assert.match(due,/Your EDU agreement expires soon/);
  assert.doesNotMatch(due,/Warning starts/);
  assert.match(render(true,true,true),/disabled=""/);
});
