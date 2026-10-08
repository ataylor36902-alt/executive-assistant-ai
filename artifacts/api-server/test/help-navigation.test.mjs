import test from "node:test";
import assert from "node:assert/strict";
import { HELP_NAVIGATION_FACTS } from "../src/lib/classscribe-help-navigation.ts";
import {
  navigationSources, assertHelpNavigationContract, assertWebDestinations, assertMobileDestinations,
  assertHelpAnswerDestinations,
} from "./fixtures/help-navigation-contract.mjs";

test("Help directions match editable web, shipped web, React routes, and phone destinations", () => {
  assertHelpNavigationContract(HELP_NAVIGATION_FACTS);
});

test("release check rejects moved web destinations, stale labels, and disconnected controls", () => {
  const sources = navigationSources();
  for (const [before, after] of [
    ["['exam','cap','Exam Center']", "['old-exam','cap','Exam Center']"],
    ["['plans','tag','Plans & privacy']", "['plans','tag','Subscriptions']"],
    ["VIEWS.exam=", "VIEWS.retiredExam="],
    ["VIEWS.account=", "VIEWS.retiredAccount="],
    ["class=\"acct\" ${goAttr({name:'account'})}", "class=\"acct\" ${goAttr({name:'settings'})}"],
    ["name:'study',mode:'cards'", "name:'missing',mode:'cards'"],
    ['data-act="genGuide"', 'data-act="deletedGuide"'],
  ]) {
    assert.ok(sources.served.includes(before), `Mutation fixture must find ${before}`);
    assert.throws(() => assertWebDestinations(sources.served.replaceAll(before, after)), /Help navigation drift/);
  }
});

test("release check rejects missing phone screens and stale Account, Exam Center, and tool links", () => {
  const sources = navigationSources();
  for (const route of ["exam", "account", "plans", "cards", "tutor", "guide"]) {
    assert.throws(() => assertMobileDestinations({
      ...sources, mobileRoute: name => name !== route && sources.mobileRoute(name),
    }), new RegExp(`phone /${route} does not exist`));
  }
  for (const [file, before, after] of [
    ["home", "path: '/exam'", "path: '/old-exam'"],
    ["home", "router.push('/account')", "router.push('/settings')"],
    ["home", "label: 'See plans'", "label: 'Pricing'"],
    ["course", "pathname: '/exam'", "pathname: '/old-exam'"],
    ["exam", "pathname: '/cards'", "pathname: '/old-cards'"],
    ["exam", "pathname: '/tutor'", "pathname: '/old-tutor'"],
    ["exam", "pathname: '/guide'", "pathname: '/old-guide'"],
  ]) {
    assert.ok(sources[file].includes(before), `Mutation fixture must find ${before}`);
    assert.throws(() => assertMobileDestinations({
      ...sources, [file]: sources[file].replaceAll(before, after),
    }), /Help navigation drift/);
  }
});

test("release check rejects stale Help breadcrumbs even when the answer contains action words", () => {
  for (const [before, after] of [
    ["Home > Quick actions > Exam Center", "Home > Tools > Exam Center"],
    ["profile avatar on Home", "Settings > Account"],
    ["Generate study guide", "Open study guide"],
  ]) {
    assert.throws(() => assertHelpNavigationContract(HELP_NAVIGATION_FACTS.replace(before, after)), /Help facts changed/);
  }
  for (const answer of [
    "On mobile, tap Home > Tools > Exam Center.",
    "On web, open Account > Settings > Flashcards.",
    "On mobile, tap Settings > Account.",
  ]) assert.throws(() => assertHelpAnswerDestinations(answer), /unverified path/);
});
