import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { GradebookPanel } from "../instructor-src/features";

test("CSV download is offered only in the instructor gradebook, including empty/loading courses", () => {
  const props = {
    base: "/courses/example-course",
    api: async <T,>() => ({}) as T,
    roster: [], assignments: [], review() {},
  };
  const instructor = renderToStaticMarkup(<GradebookPanel {...props} owner />);
  assert.match(instructor, /data-testid="button-gradebook-export"/);
  assert.match(instructor, /Download CSV/);
  assert.match(instructor, /aria-label="Loading"/);
  const member = renderToStaticMarkup(<GradebookPanel {...props} owner={false} />);
  assert.doesNotMatch(member, /button-gradebook-export|Download CSV/);
  assert.match(member, /Your scores and feedback/);
});
