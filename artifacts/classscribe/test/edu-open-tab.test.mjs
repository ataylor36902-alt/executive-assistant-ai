import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const grant = { canCreateCourse: false, canJoinLicensedCourse: true, needsCredentials: false, canManageSchool: false };
const denied = { canCreateCourse: false, canJoinLicensedCourse: false, needsCredentials: true, canManageSchool: false };
const course = { id: 'bio', name: 'Biology', role: 'student', subject: 'BIO' };
const assignment = { id: 'lab', title: 'Lab report', instructions: 'Write a report', points: 20, dueAt: null, createdAt: '2026-01-01T00:00:00Z' };
const detail = { course, role: 'student', announcements: [], materials: [], assignments: [assignment] };
const grades = {
  assignments: [{ id: 'lab', title: 'Lab report', points: 20, dueAt: null }],
  students: [{ studentId: 'student-fixture', name: 'Test Student', grades: [{ assignmentId: 'lab', status: 'graded', score: 17, feedback: 'Private grade feedback', submittedAt: '2026-01-01T00:00:00Z' }], totals: { earned: 17, possible: 20, gradedCount: 1, ungradedCount: 0, missingCount: 0 } }],
};
const waitFor = async (predicate, label) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

async function withPortal(run) {
  // Bundle the real portal and gradebook UI; replace only the external identity provider.
  const { outputFiles } = await build({
    entryPoints: [fixture('edu-browser-entry.tsx')],
    bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic',
    alias: { '@clerk/react': fixture('edu-browser-clerk.tsx') },
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const bundle = outputFiles[0]?.contents;
  assert.ok(bundle, 'portal bundle must exist');
  const server = createServer((req, res) => {
    if (req.url === '/portal.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(bundle);
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<div id="root"></div><script src="/portal.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    await page.addInitScript(() => {
      const interval = window.setInterval;
      window.setInterval = (callback, delay, ...args) => {
        if (delay === 60000) window.__eduAccessTick = () => callback(...args);
        return interval(callback, delay, ...args);
      };
    });
    await run({ page, errors, url: `http://127.0.0.1:${server.address().port}/instructor/courses/bio` });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

for (const scenario of ['revocation and tab return', 'account switch']) {
test(`open student grades disappear on ${scenario}, even with stale responses`, { timeout: 30000 }, async () => {
  await withPortal(async ({ page, errors, url }) => {
    let access = grant;
    let holdAccess = false;
    let holdGrade = false;
    const waitingAccess = [];
    const waitingGrade = [];
    let accessCalls = 0;
    let gradeCalls = 0;
    const secondGrades = {
      ...grades,
      students: [{ ...grades.students[0], studentId: 'student-second', name: 'Second Student',
        grades: [{ ...grades.students[0].grades[0], score: 12, feedback: 'Second student feedback' }],
        totals: { ...grades.students[0].totals, earned: 12 } }],
    };
    const respond = (route, body, status = 200) => route.fulfill({ status, json: body });
    await page.route('**/api/edu/**', async route => {
      const path = new URL(route.request().url()).pathname.slice('/api/edu'.length);
      const secondAccount = route.request().headers().authorization === 'Bearer fixture-token-student-second';
      if (path === '/access') {
        accessCalls++;
        if (holdAccess) waitingAccess.push(route);
        else await respond(route, access);
      } else if (path === '/courses') await respond(route, { courses: [course] });
      else if (path === '/courses/bio') await respond(route, detail);
      else if (path === '/courses/bio/gradebook') {
        gradeCalls++;
        if (holdGrade) waitingGrade.push(route);
        else await respond(route, secondAccount ? secondGrades : grades);
      } else throw new Error(`Unexpected EDU request ${path}`);
    });
    const grade = page.getByText('17 / 20').first();
    const feedback = page.getByText('Private grade feedback');
    const openGradebook = async () => {
      await page.goto(url);
      try { await page.getByTestId('tab-gradebook').click(); }
      catch (error) { throw new Error(`Portal did not open: ${await page.locator('body').innerText()}; HTML: ${(await page.content()).slice(0, 400)}; requests: ${accessCalls}; browser errors: ${errors.join('; ')}`, { cause: error }); }
      await grade.waitFor();
      await feedback.waitFor();
      assert.ok(accessCalls > 0, 'initial access check completed');
    };

    await openGradebook();
    if (scenario === 'account switch') {
      // Keep an old request outstanding but restore the visible gradebook with
      // a newer refresh. The identity must change while private data is visible.
      holdGrade = true;
      await page.getByRole('button', { name: 'Refresh' }).last().click();
      await waitFor(() => waitingGrade.length === 1, 'original account delayed gradebook');
      holdGrade = false;
      await page.getByRole('button', { name: 'Refresh' }).last().click();
      await grade.waitFor();
      await feedback.waitFor();
      const originalUrl = page.url();
      const beforeSwitch = accessCalls;
      holdAccess = true;
      await page.evaluate(() => {
        window.__eduDocumentMarker = 'same open document';
        window.__eduSwitchAccount('student-second');
      });
      await waitFor(() => accessCalls > beforeSwitch && waitingAccess.length === 1, 'new identity access check');
      assert.equal(waitingAccess[0].request().headers().authorization, 'Bearer fixture-token-student-second');
      await grade.waitFor({ state: 'detached' });
      assert.equal(await feedback.count(), 0, 'previous feedback must vanish before new-account access completes');
      assert.equal(page.url(), originalUrl, 'account switch must not reload or navigate');
      assert.equal(await page.evaluate(() => window.__eduDocumentMarker), 'same open document');

      const lateResponse = page.waitForResponse(response => response.url().endsWith('/gradebook'));
      await respond(waitingGrade.shift(), grades);
      await (await lateResponse).finished();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await grade.count(), 0, 'delayed original grades cannot reappear while new access is pending');
      assert.equal(await feedback.count(), 0);
      assert.equal(waitingAccess.length, 1, 'new-account verifier must still be pending');

      holdAccess = false;
      await respond(waitingAccess.shift(), grant);
      await page.getByTestId('tab-gradebook').click();
      await page.getByText('12 / 20').first().waitFor();
      await page.getByText('Second student feedback').waitFor();
      assert.equal(await grade.count(), 0, 'new workspace must show only the second student’s grade');
      assert.equal(await feedback.count(), 0);
      assert.deepEqual(errors, []);
      return;
    }
    assert.equal(await page.evaluate(() => typeof window.__eduAccessTick), 'function', 'the portal must schedule its 60-second check');
    holdGrade = true;
    await page.getByRole('button', { name: 'Refresh' }).last().click();
    await waitFor(() => waitingGrade.length === 1, 'stale gradebook response');
    access = denied; // School agreement revoked while the student keeps this tab open.
    holdAccess = true;
    const beforeTick = accessCalls;
    await page.evaluate(() => window.__eduAccessTick());
    await waitFor(() => accessCalls > beforeTick, 'scheduled access check');
    await grade.waitFor({ state: 'detached' });
    assert.equal(await feedback.count(), 0, 'feedback must hide before the verifier replies');
    await respond(waitingAccess.shift(), denied);
    await page.getByText('Open your classroom.').waitFor();
    await respond(waitingGrade.shift(), grades);
    assert.equal(await grade.count(), 0, 'a late gradebook response must not restore grades');
    assert.equal(await feedback.count(), 0);

    // Re-enter with a valid session. The tab becomes visible before the access
    // response; a verifier outage must keep both scores and feedback hidden.
    holdAccess = false;
    holdGrade = false;
    access = grant;
    await openGradebook();
    holdAccess = true;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const beforeReturn = accessCalls;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => accessCalls > beforeReturn, 'tab-return access check');
    await grade.waitFor({ state: 'detached' });
    assert.equal(await feedback.count(), 0, 'tab return must hide private feedback before verification');
    await respond(waitingAccess.shift(), { error: 'Verifier temporarily unavailable' }, 503);
    await page.getByText('We couldn’t check your access.').waitFor();
    assert.equal(await grade.count(), 0, 'verifier failure must remain fail-closed');
    assert.equal(await feedback.count(), 0);
    assert.deepEqual(errors, []);
    assert.ok(gradeCalls >= 2, 'both visits must fetch real gradebook data');
  });
});
}

for (const trigger of ['scheduled refresh', 'tab return']) {
  test(`removed classroom membership hides open grades on ${trigger} despite stale responses`, { timeout: 30000 }, async () => {
    await withPortal(async ({ page, url }) => {
      await page.addInitScript(() => {
        window.__eduParsedResponses = {};
        const fetch = window.fetch;
        window.fetch = async (...args) => {
          const response = await fetch(...args);
          const json = response.json.bind(response);
          response.json = async () => {
            const body = await json();
            const path = new URL(response.url).pathname;
            window.__eduParsedResponses[path] = (window.__eduParsedResponses[path] || 0) + 1;
            return body;
          };
          return response;
        };
      });
      const otherCourse = { ...course, id: 'chem', name: 'Chemistry', subject: 'CHEM' };
      let enrolled = true;
      const held = { courses: [], detail: [], gradebook: [] };
      const holdNext = new Set();
      let courseListCalls = 0;
      const respond = (route, body, status = 200) => route.fulfill({ status, json: body });
      await page.route('**/api/edu/**', async route => {
        const path = new URL(route.request().url()).pathname.slice('/api/edu'.length);
        if (path === '/access') return respond(route, grant); // School access stays valid.
        const resource = path === '/courses' ? 'courses'
          : path === '/courses/bio' ? 'detail'
          : path === '/courses/bio/gradebook' ? 'gradebook' : null;
        assert.ok(resource, `Unexpected EDU request ${path}`);
        if (resource === 'courses') courseListCalls++;
        if (holdNext.delete(resource)) {
          held[resource].push(route);
          return;
        }
        if (resource === 'courses') return respond(route, { courses: enrolled ? [course, otherCourse] : [otherCourse] });
        return enrolled ? respond(route, resource === 'detail' ? detail : grades)
          : respond(route, { error: 'Classroom not found' }, 404);
      });

      const grade = page.getByText('17 / 20').first();
      const feedback = page.getByText('Private grade feedback');
      const courseLink = page.getByTestId('link-course-bio');
      const visibleGrades = async () => {
        await grade.waitFor();
        await feedback.waitFor();
        await courseLink.waitFor();
      };
      await page.goto(url);
      await page.getByTestId('tab-gradebook').click();
      await visibleGrades();

      // Keep one pre-removal course-detail response pending, while a newer
      // response renders the gradebook again. Both clicks happen in one turn.
      holdNext.add('detail');
      await page.getByTestId('button-refresh-course').evaluate(button => {
        button.click();
        button.click();
      });
      await waitFor(() => held.detail.length === 1, 'old course detail');
      await visibleGrades();
      // Do the same for gradebook data so membership is removed while scores
      // and feedback really are visible, not while a loading screen is shown.
      holdNext.add('gradebook');
      await page.getByRole('button', { name: 'Refresh', exact: true }).last().evaluate(button => {
        button.click();
        button.click();
      });
      await waitFor(() => held.gradebook.length === 1, 'old gradebook');
      await visibleGrades();

      enrolled = false; // Instructor removes just this student's course membership.
      holdNext.add('courses');
      const refreshAccess = () => page.evaluate(trigger => {
        if (trigger === 'scheduled refresh') window.__eduAccessTick();
        else {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
          document.dispatchEvent(new Event('visibilitychange'));
        }
      }, trigger);
      await refreshAccess();
      await waitFor(() => held.courses.length === 1, 'pending membership list');
      await grade.waitFor({ state: 'detached' });
      assert.equal(await feedback.count(), 0, 'feedback hides before membership verification completes');
      assert.equal(await courseLink.count(), 0, 'the course hides during verification');

      // A newer access refresh sees the removed membership. The held list
      // deliberately returns its older, pre-removal snapshot afterwards.
      const previousCalls = courseListCalls;
      await refreshAccess();
      await waitFor(() => courseListCalls > previousCalls, 'new membership list');
      await page.getByTestId('card-course-chem').waitFor();
      assert.equal(new URL(page.url()).pathname, '/instructor/');
      assert.equal(await courseLink.count(), 0);
      assert.equal(await grade.count(), 0);
      assert.equal(await feedback.count(), 0);
      assert.equal(await page.getByText('Open your classroom.').count(), 0, 'course removal must not revoke school credentials');

      // Watch for even transient restoration after any late response.
      await page.evaluate(() => {
        window.__restoredPrivateClassroom = false;
        new MutationObserver(() => {
          if (document.querySelector('[data-testid="link-course-bio"], [data-testid="card-course-bio"], [data-testid="tab-gradebook"]')
            || /Private grade feedback|17 \/ 20/.test(document.body.textContent)) {
            window.__restoredPrivateClassroom = true;
          }
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      const snapshots = { courses: { courses: [course, otherCourse] }, detail, gradebook: grades };
      const order = trigger === 'scheduled refresh' ? ['courses', 'detail', 'gradebook'] : ['gradebook', 'detail', 'courses'];
      for (const resource of order) {
        const path = new URL(held[resource][0].request().url()).pathname;
        const parsedBefore = await page.evaluate(path => window.__eduParsedResponses[path] || 0, path);
        await respond(held[resource].shift(), snapshots[resource]);
        await page.waitForFunction(({ path, parsedBefore }) => window.__eduParsedResponses[path] > parsedBefore, { path, parsedBefore });
        // Let fetch continuations and React commits run before inspecting the DOM.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await courseLink.count(), 0, `late ${resource} must not restore course access`);
        assert.equal(await grade.count(), 0, `late ${resource} must not restore scores`);
        assert.equal(await feedback.count(), 0, `late ${resource} must not restore feedback`);
        assert.equal(await page.evaluate(() => window.__restoredPrivateClassroom), false);
      }
      await page.getByTestId('card-course-chem').waitFor();

      // Revisiting the removed course cannot fetch/render its old gradebook.
      await page.goto(url);
      await page.getByTestId('card-course-chem').waitFor();
      assert.equal(await courseLink.count(), 0);
      assert.equal(await grade.count(), 0);
      assert.equal(await feedback.count(), 0);
    });
  });
}