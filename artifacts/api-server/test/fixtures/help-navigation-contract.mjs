import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";

// Tests run both from the workspace root and from the API package's bundled tests.
let root = process.cwd();
while (!existsSync(resolve(root, "artifacts/classscribe/web-src"))) {
  const parent = dirname(root);
  assert.notEqual(parent, root, "Cannot find the ClassScribe workspace");
  root = parent;
}
const read = path => readFileSync(resolve(root, path), "utf8");

export function navigationSources() {
  return {
    web: ["4_views.js", "6_study_social.js", "8_account.js"].map(
      file => read(`artifacts/classscribe/web-src/${file}`),
    ).join("\n"),
    served: read("artifacts/classscribe/web-public/index.html"),
    react: read("artifacts/classscribe/src/App.tsx"),
    home: read("artifacts/classscribe-mobile/app/(tabs)/home/index.js"),
    course: read("artifacts/classscribe-mobile/app/course/[id].js"),
    exam: read("artifacts/classscribe-mobile/app/exam.js"),
    account: read("artifacts/classscribe-mobile/app/account.js"),
    mobileRoute: name => existsSync(resolve(root, `artifacts/classscribe-mobile/app/${name}.js`)),
  };
}

function has(source, pattern, message) {
  assert.match(source, pattern, `Help navigation drift: ${message}`);
}

export function assertWebDestinations(source) {
  const nav = source.match(/const NAV=(\[[^\n;]+\]);/);
  assert.ok(nav, "Help navigation drift: web sidebar NAV is missing");
  const entries = vm.runInNewContext(nav[1]);
  for (const [name, label] of [["exam", "Exam Center"], ["plans", "Plans & privacy"]]) {
    assert.ok(entries.some(entry => entry[0] === name && entry[2] === label),
      `Help navigation drift: sidebar ${label} must open ${name}`);
  }
  has(source, /NAV\.map\(\(\[n,i,l\]\)=>`<button \$\{goAttr\(\{name:n\}\)\}/, "sidebar entries must navigate");
  for (const name of ["exam", "account", "plans", "study", "tutor"]) {
    has(source, new RegExp(`VIEWS\\.${name}\\s*=`), `web destination ${name} is not registered`);
  }
  has(source, /class="acct" \$\{goAttr\(\{name:'account'\}\)\}/, "web profile button must open Account");
  has(source, /homeSection\('Quick actions'[\s\S]*?\['exam','cap','Exam Center'\][\s\S]*?goAttr\(\{name\}\)/, "Home Quick actions > Exam Center");
  has(source, /goAttr\(\{name:'exam',courseId:c\.id\}\)[^]*?>[^]*?Exam Center<\/button>/, "course Exam Center button");
  has(source, /goAttr\(\{name:'study',mode:'cards',\.\.\.scope\}\)[^]*?<h3>Flashcards<\/h3>/, "Flashcards must open the cards study mode");
  has(source, /goAttr\(\{name:'tutor',courseId:cid,[^]*?<h3>Study companion · [^]*?'Quiz me'/, "Quiz me must open the study companion");
  has(source, /data-act="genGuide"[^]*?<h3>\$\{guide\?'Regenerate study guide':'Generate study guide'\}/, "web study guide button");
  has(source, /ACT\.genGuide\s*=/, "study guide action must exist");
  has(source, /<h3>Example courses<\/h3>[^]*?data-act="hideEx"[^]*?Hide examples[^]*?data-act="showEx"[^]*?Show example courses/, "Account example-course controls");
  for (const action of ["showEx", "hideEx"]) has(source, new RegExp(`ACT\\.${action}\\s*=`), `${action} action must exist`);
}

export function assertMobileDestinations(sources) {
  for (const route of ["exam", "account", "plans", "cards", "tutor", "guide"]) {
    assert.ok(sources.mobileRoute(route), `Help navigation drift: phone /${route} does not exist`);
  }
  has(sources.home, /label: 'See plans', onPress: \(\) => router\.push\('\/plans'\)/, "Home > See plans");
  has(sources.home, /label: 'Exam Center',[^}]*path: '\/exam'/, "Home > Quick actions > Exam Center");
  has(sources.home, /title="Quick actions"[^]*?quick\.map[^]*?onPress=\{\(\) => router\.push\(q\.path\)\}/, "Quick actions must navigate");
  has(sources.home, /onPress=\{\(\) => router\.push\('\/account'\)\}[^>]*accessibilityLabel="Account"[^>]*testID="home-profile-avatar"/, "Home profile avatar > Account");
  has(sources.course, /title="Exam Center"[^]*?pathname: '\/exam'/, "course > Exam Center");
  for (const [label, route] of [["Study guide", "guide"], ["Flashcards", "cards"]]) {
    has(sources.exam, new RegExp(`title="${label}"[^\\n]*pathname: '/${route}'`), `Exam Center > ${label}`);
  }
  has(sources.exam, /accessibilityLabel="Study companion\. Start a quiz"[^]*?pathname: '\/tutor'[^]*?Study companion · Quiz me/, "Exam Center > Study companion · Quiz me");
  has(sources.account, /title="Example courses"[^]*?title="Show example courses"[^]*?<Switch value=\{st\.showEx\} onValueChange=\{st\.setShowEx\}/, "Account > Show example courses switch");
}

export function assertHelpNavigationContract(facts, sources = navigationSources()) {
  // Assert the actual prompt, not a second copy that can drift independently.
  for (const direction of [
    "On web, open Plans & privacy or Exam Center from the left sidebar.",
    "On web, Account is the profile button at the bottom of the left sidebar.",
    "Home > See plans", "Home > Quick actions > Exam Center",
    "open a course and choose Exam Center",
    "On mobile, open Account by tapping the profile avatar on Home.",
    "Inside Exam Center, choose Flashcards or Study companion · Quiz me.",
    "On web, choose Generate study guide or Regenerate study guide; on mobile, choose Study guide.",
    "Show example courses or Hide examples on web",
    "Show example courses switch on mobile",
  ]) assert.ok(facts.includes(direction), `Help facts changed: verify the real destination for "${direction}"`);
  assertWebDestinations(sources.web);
  assertWebDestinations(sources.served);
  assertMobileDestinations(sources);
  for (const route of ["/exam-center", "/account", "/plans"]) {
    has(sources.react, new RegExp(`<Route path="${route}" component=`), `React web route ${route}`);
  }
}

// Audit directions in the endpoint's answer too, not merely the AI prompt.
export function assertHelpAnswerDestinations(answer, sources = navigationSources()) {
  assertWebDestinations(sources.web);
  assertWebDestinations(sources.served);
  assertMobileDestinations(sources);
  const breadcrumbs = answer.replace(/ or open\b/g, ". Open").match(
    /\b(?:Home|Account|Settings|Library|Tools|Exam Center)(?:\s*>\s*[A-Za-z][A-Za-z &·-]*)+/g,
  ) || [];
  for (const breadcrumb of breadcrumbs) {
    assert.ok(["Home > See plans", "Home > Quick actions > Exam Center"].includes(breadcrumb.trim()),
      `Help answer has an unverified path: ${breadcrumb}`);
  }
  if (/\bAccount\b/.test(answer)) {
    assert.match(answer, /On web,.*profile button.*left sidebar/, "Account answer must identify the real web entry");
    assert.match(answer, /On mobile,.*profile avatar on Home/, "Account answer must identify the real phone entry");
  }
}
