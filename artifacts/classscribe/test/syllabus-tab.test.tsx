import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SyllabusTab } from "../src/components/SyllabusTab";
import { state } from "./fixtures/syllabus-client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
assert.ok(process.env.SYLLABUS_UI_FIXTURE, "Run pnpm test:syllabus-links to generate saved API fixtures first");
const scenarios = JSON.parse(readFileSync(process.env.SYLLABUS_UI_FIXTURE, "utf8"));
assert.deepEqual(Object.keys(scenarios).sort(), ["repeatedCoursework", "repeatedDates", "unique", "unmatched"].sort(),
  "API fixtures must cover all four required matching cases");
const warning = "Title matches more than one date or coursework item. This date was not attached to coursework; no due date was set from it.";
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const text = (node: ReactTestInstance): string => node.children.map(child =>
  typeof child === "string" ? child : text(child)).join("");

for (const [name, scenario] of Object.entries(scenarios) as [string, any][]) {
  test(`${name}: review, confirm, reopen and full reload preserve date labels and coursework dates`, async () => {
    Object.assign(state, { scenario, saved: false, reads: 0, confirmations: [], toasts: [] });
    const originalFetch = globalThis.fetch;
    const originalWindow = (globalThis as any).window;
    const uploads: string[] = [];
    globalThis.fetch = (async (url: string, options: RequestInit) => {
      uploads.push(url);
      assert.equal(options.method, "POST");
      assert.equal(await (options.body as File).text(), "Test syllabus");
      return { ok: true };
    }) as any;
    (globalThis as any).window = {
      location: { href: "https://example.test/course?importSyllabus=1" },
      history: { replaceState() {} },
    };
    const clients: QueryClient[] = [];
    let view: ReactTestRenderer | undefined;
    const mount = async (client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) => {
      if (!clients.includes(client)) clients.push(client);
      await act(async () => {
        view = create(<QueryClientProvider client={client}><SyllabusTab courseId={scenario.reloaded.courseId} /></QueryClientProvider>);
        await settle();
      });
      await act(settle);
      return client;
    };
    const unmount = async () => { await act(async () => view!.unmount()); };
    const click = async (node: ReactTestInstance) => {
      await act(async () => { await node.props.onClick(); await settle(); });
      await act(settle);
    };
    const assertSaved = () => {
      const root = view!.root;
      assert.ok(!text(root).includes("Review Syllabus Details"));
      const datesSection = root.findAllByType("section").find(section => text(section).includes("Confirmed syllabus dates"))!;
      assert.ok(datesSection, "saved dates section is visible");
      const rows = datesSection.findAllByType("li");
      assert.equal(rows.length, scenario.reloaded.dates.length, "no confirmed dates disappear");
      rows.forEach((row, i) => {
        const date = scenario.reloaded.dates[i];
        assert.ok(text(row).includes(`${date.title} · ${date.dueDate}`));
        assert.ok(text(row).includes(date.linkStatus === "linked" ? "Linked to coursework" : "Standalone syllabus date"));
        assert.ok(!text(row).includes(date.linkStatus === "linked" ? "Standalone syllabus date" : "Linked to coursework"),
          "linked and standalone labels must remain distinct");
        const statuses = row.findAll(node => node.type === "p" && node.props.role === "status");
        assert.equal(statuses.length, date.linkStatus === "ambiguous" ? 1 : 0, "only ambiguous dates have warnings");
        if (statuses.length) assert.equal(text(statuses[0]), warning);
      });
      const coursework = root.findAllByType("section").find(section => text(section).includes("Syllabus coursework"))!;
      assert.ok(coursework);
      const noDateCount = scenario.reloaded.assignments.filter((a: any) => !a.dueDate).length;
      assert.equal(text(coursework).split("No confirmed date").length - 1, noDateCount);
      for (const assignment of scenario.reloaded.assignments) {
        if (assignment.dueDate) assert.ok(text(coursework).includes(`Due ${assignment.dueDate}`));
      }
      if (name.startsWith("repeated") || name === "unmatched") assert.ok(!text(coursework).includes(" · Due "));
    };
    try {
      const client = await mount();
      await act(async () => {
        view!.root.findByType("textarea").props.onChange({ target: { value: "Test syllabus" } });
      });
      await click(view!.root.findAllByType("button").find(button => text(button) === "Import pasted text")!);
      assert.equal(uploads.length, 1);
      assert.ok(text(view!.root).includes("Review Syllabus Details"));
      const choices = () => view!.root.findAll(node => node.type === "button" && typeof node.props["aria-pressed"] === "boolean");
      assert.equal(choices().length, scenario.input.selectedDates.length + scenario.input.selectedAssignments.length);
      assert.ok(choices().every(button => button.props["aria-pressed"] === false), "nothing selected by default");
      for (let i = 0; i < choices().length; i++) await click(choices()[i]);
      await click(view!.root.findAllByType("button").find(button => text(button) === "Confirm & Save")!);
      assert.deepEqual(state.confirmations, [{ id: scenario.reloaded.courseId, data: scenario.input }], "review selections reach confirmation intact");
      assert.ok(state.reads >= 2, "confirmation invalidates the saved syllabus query");
      assert.equal(state.toasts.at(-1).title, "Syllabus confirmed");
      if (name.startsWith("repeated")) assert.match(state.toasts.at(-1).description, /saved separately.*No due date was assigned/);
      assertSaved();
      await unmount();
      await mount(client); // Returning to the tab with the current query cache.
      assertSaved();
      await unmount();
      const readsBeforeReload = state.reads;
      await mount(); // Full reload: discard mutation state and cache, obtain a fresh saved GET.
      assert.ok(state.reads > readsBeforeReload);
      assertSaved();
    } finally {
      if (view) await unmount();
      clients.forEach(client => client.clear());
      globalThis.fetch = originalFetch;
      (globalThis as any).window = originalWindow;
    }
  });
}
