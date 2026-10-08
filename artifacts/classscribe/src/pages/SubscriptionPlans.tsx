import { useState, type FormEvent } from "react";
import { useUser } from "@clerk/react";
import { Link } from "wouter";
import { ArrowRight, Check, GraduationCap, Info, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRequestEduAccess } from "@workspace/api-client-react";
import { trackEvent } from "@/lib/analytics";
import { getStudentLevel, STUDENT_LEVELS } from "@/lib/student-level";

const tiers = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    lead: "The essentials, on your own time.",
    features: ["5 recording hours / month", "Live transcripts & search", "AI summaries and smart notes", "3 courses"],
    action: "Current plan",
  },
  {
    name: "Student",
    price: "$7.99",
    cadence: "/month",
    lead: "A little more room for a full semester.",
    features: ["40 recording hours / month", "Unlimited courses", "Class Memory across the semester", "Study guides, flashcards, quizzes", "Document analysis & exports"],
    action: "Choose Student",
  },
  {
    name: "Pro",
    price: "$12.99",
    cadence: "/month",
    lead: "For the courses that ask for everything.",
    features: ["120 recording hours / month", "Advanced tutoring & Finals Mode", "Semester-wide analysis", "Advanced collaboration", "More storage"],
    action: "Choose Pro",
  },
] as const;

const privacyPoints = [
  "Consent before every session",
  "Always-visible recording indicator with pause and discard controls",
  "Private by default: sharing is deliberate, limited to your course group, and can be undone",
  "No exam predictions: Exam Center shows what got the most attention in course materials, never claims to know what will be on a test",
  "Accessibility first: students with a recording accommodation can note it in the consent step",
];

export default function SubscriptionPlans() {
  const { user } = useUser();
  const level = getStudentLevel(user?.unsafeMetadata as Record<string, unknown> | undefined);
  const onboarding = new URLSearchParams(window.location.search).get("onboarding") === "1";
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const [contactError, setContactError] = useState("");
  const [contactForm, setContactForm] = useState({ name: "", email: "", school: "", role: "", message: "" });
  const requestEduAccess = useRequestEduAccess();
  const openEduInquiry = () => {
    setContactForm({ name: "", email: "", school: "", role: "", message: "" });
    setContactSubmitted(false);
    setContactError("");
    setContactOpen(true);
  };
  const sendEduInquiry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (requestEduAccess.isPending || contactSubmitted) return;
    setContactError("");
    try {
      const result = await requestEduAccess.mutateAsync({
        data: {
          name: contactForm.name.trim(),
          email: contactForm.email.trim(),
          school: contactForm.school.trim(),
          role: contactForm.role.trim(),
          message: contactForm.message.trim(),
        },
      });
      if (result.accepted !== true) throw new Error("Inquiry was not accepted");
      setContactSubmitted(true);
      // Count only confirmed inquiries, never contact details or free-form content.
      trackEvent("edu_inquiry_sent");
    } catch {
      setContactError("We couldn’t send your inquiry right now. Please try again.");
    }
  };
  return (
    <div className="mx-auto max-w-[1370px] px-5 pb-20 pt-8 sm:px-8 md:pt-11 lg:px-12">
      <header className="mb-9 max-w-3xl md:mb-12">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--plans-green)/0.25)] bg-[hsl(var(--plans-green-soft))] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--plans-green-ink))]">
          <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--plans-green))]" aria-hidden="true" />
          ClassScribe plans
        </div>
        <h1 className="max-w-2xl font-serif text-[clamp(2.5rem,5vw,4.5rem)] font-semibold leading-[1.08] tracking-[-0.045em] text-foreground" data-testid="heading-plans">
          Pick what fits <em className="font-normal text-[hsl(var(--plans-green))]">your semester</em>
        </h1>
        <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
          Every plan keeps the core study features. Plans differ mainly in recording hours.
        </p>
        {onboarding && (
          <div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-4">
            <p className="flex-1 text-sm leading-relaxed text-muted-foreground">Your account is ready. Take a look at the plans, then continue to your library. Billing isn&apos;t connected, so nothing is charged.</p>
            <Link href="/dashboard" data-testid="link-continue-after-signup" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--plans-green))] px-5 text-sm font-semibold text-white hover:bg-[hsl(var(--plans-green-ink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Continue to your library <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </header>

      <section aria-label="Subscription tiers">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 xl:gap-5">
          {tiers.map((tier) => (
            <article
              key={tier.name}
              data-testid={`card-plan-${tier.name.toLowerCase()}`}
              className={`relative flex min-w-0 flex-col rounded-[1.4rem] border bg-card p-6 shadow-sm transition-transform duration-300 hover:-translate-y-1 sm:p-7 ${
                tier.name === "Student"
                  ? "border-[hsl(var(--plans-green))] ring-1 ring-[hsl(var(--plans-green)/0.4)]"
                  : "border-border"
              }`}
            >
              {tier.name === "Student" && (
                <span className="absolute -top-3 left-6 rounded-full bg-[hsl(var(--plans-green))] px-3 py-1 text-[11px] font-bold tracking-wide text-[hsl(var(--plans-green-soft))]">
                  Most popular
                </span>
              )}
              <div className="mb-7">
                <p className="text-sm font-semibold tracking-[-0.01em] text-[hsl(var(--plans-green-ink))]">ClassScribe {tier.name}</p>
                <div className="mt-5 flex flex-wrap items-baseline gap-1.5">
                  <span className="font-serif text-[3.35rem] font-semibold tracking-[-0.06em] text-foreground" data-testid={`text-price-${tier.name.toLowerCase()}`}>{tier.price}</span>
                  <span className="text-sm text-muted-foreground">{tier.cadence}</span>
                </div>
                <p className="mt-2 min-h-10 text-sm leading-relaxed text-muted-foreground">{tier.lead}</p>
              </div>
              <div className="mb-7 h-px bg-border" />
              <ul className="mb-8 flex-1 space-y-4">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-[13px] leading-[1.5] text-foreground/85">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--plans-green))]" strokeWidth={2.5} aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant={tier.name === "Student" ? "default" : "outline"}
                disabled={tier.name === "Free"}
                onClick={() => setSelectedTier(tier.name)}
                data-testid={`button-plan-${tier.name.toLowerCase()}`}
                className={`min-h-11 w-full rounded-xl font-semibold ${
                  tier.name === "Student"
                    ? "border-[hsl(var(--plans-green))] bg-[hsl(var(--plans-green))] text-[hsl(var(--plans-green-soft))] hover:bg-[hsl(var(--plans-green-ink))]"
                    : ""
                }`}
              >
                {tier.action}
              </Button>
            </article>
          ))}
        </div>
        <div className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--plans-green))]" aria-hidden="true" />
          <p>Planned pricing. Billing isn&apos;t connected in this version, so every feature is open while you try it.</p>
        </div>
        {selectedTier && (
          <div role="status" aria-live="polite" data-testid="status-billing-notice" className="mt-5 flex items-start justify-between gap-4 rounded-xl border border-[hsl(var(--plans-green)/0.25)] bg-[hsl(var(--plans-green-soft))] p-4 text-sm leading-relaxed text-[hsl(var(--plans-green-ink))]">
            <p><strong>{selectedTier} sounds like a good fit.</strong> Billing isn&apos;t set up yet. Every feature is open while you try ClassScribe. Nothing is charged.</p>
            <button type="button" onClick={() => setSelectedTier(null)} aria-label="Dismiss billing note" data-testid="button-dismiss-billing" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-[hsl(var(--plans-green)/0.1)]"><X className="h-4 w-4" /></button>
          </div>
        )}
      </section>

      <section aria-labelledby="privacy-heading" className="mt-14 grid overflow-hidden rounded-[1.5rem] border border-border bg-card md:grid-cols-[0.85fr_1.15fr] lg:mt-20">
        <div className="bg-[hsl(var(--plans-green-soft))] p-7 sm:p-9 lg:p-12">
          <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl border border-[hsl(var(--plans-green)/0.2)] bg-card text-[hsl(var(--plans-green))]">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[hsl(var(--plans-green-ink))]">Built into every plan</p>
          <h2 id="privacy-heading" className="font-serif text-3xl leading-tight tracking-tight sm:text-4xl">Recording consent<br />&amp; privacy</h2>
          <p className="mt-5 text-sm leading-7 text-foreground/75">
            Universities and instructors set different recording policies, and recording laws vary by state and country. ClassScribe keeps consent visible instead of recording quietly in the background.
          </p>
        </div>
        <ul className="divide-y divide-border px-7 py-3 sm:px-9 lg:px-12">
          {privacyPoints.map((point, index) => (
            <li key={point} className="flex gap-5 py-5 text-sm leading-relaxed text-foreground/85">
              <span className="font-mono text-xs text-[hsl(var(--plans-green))]" aria-hidden="true">0{index + 1}</span>
              {point}
            </li>
          ))}
        </ul>
      </section>
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent data-testid="dialog-edu-contact" className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Bring ClassScribe to your school</DialogTitle>
            <DialogDescription id="edu-inquiry-privacy" className="pt-3 text-sm leading-relaxed">
              Share your contact and school details so the ClassScribe EDU team can respond. We use them only for this inquiry. Please don&apos;t include student records, grades, or other sensitive information. Sending a request does not start a subscription or billing.
            </DialogDescription>
          </DialogHeader>
          {contactSubmitted ? (
            <div role="status" aria-live="polite" className="mt-2 space-y-4 rounded-xl border border-border p-4 text-sm" data-testid="status-edu-inquiry-success">
              <p className="font-semibold">Your inquiry was sent.</p>
              <p>The ClassScribe EDU team will follow up at {contactForm.email}.</p>
              <Button onClick={() => setContactOpen(false)} data-testid="button-close-edu-contact" className="min-h-11">Done</Button>
            </div>
          ) : (
            <form className="mt-2 space-y-4" onSubmit={sendEduInquiry} aria-describedby="edu-inquiry-privacy">
              <label className="block space-y-1.5 text-sm font-medium">
                <span>Your name</span>
                <input autoComplete="name" required maxLength={120} value={contactForm.name} onChange={(event) => setContactForm((form) => ({ ...form, name: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3" data-testid="input-edu-contact-name" />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                <span>Work or school email</span>
                <input type="email" autoComplete="email" required maxLength={254} value={contactForm.email} onChange={(event) => setContactForm((form) => ({ ...form, email: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3" data-testid="input-edu-contact-email" />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                <span>School or institution</span>
                <input autoComplete="organization" required maxLength={160} value={contactForm.school} onChange={(event) => setContactForm((form) => ({ ...form, school: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3" data-testid="input-edu-contact-school" />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                <span>Your role</span>
                <input autoComplete="organization-title" required maxLength={120} value={contactForm.role} onChange={(event) => setContactForm((form) => ({ ...form, role: event.target.value }))} className="min-h-11 w-full rounded-lg border border-border bg-background px-3" data-testid="input-edu-contact-role" />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">
                <span>What would you like us to know? (optional)</span>
                <textarea maxLength={1200} rows={3} value={contactForm.message} onChange={(event) => setContactForm((form) => ({ ...form, message: event.target.value }))} className="w-full rounded-lg border border-border bg-background px-3 py-2" data-testid="input-edu-contact-message" />
              </label>
              {contactError && <p role="alert" className="text-sm text-destructive" data-testid="error-edu-inquiry">{contactError}</p>}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setContactOpen(false)} className="min-h-11">Cancel</Button>
                <Button type="submit" disabled={requestEduAccess.isPending} className="min-h-11" data-testid="button-submit-edu-inquiry">
                  {requestEduAccess.isPending ? "Sending…" : "Send inquiry"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <section aria-labelledby="headed-heading" className="mt-14 border-t border-border pt-9 lg:mt-20">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--plans-green-soft))] text-[hsl(var(--plans-green))]">
              <GraduationCap className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 id="headed-heading" className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">Where ClassScribe is headed</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Study looks different at every stage. Tell us where you are now.</p>
          </div>
          <Link href="/account" data-testid="link-account-level" className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg text-sm font-semibold text-[hsl(var(--plans-green-ink))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Change it in your account <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-7 flex flex-wrap gap-2.5" role="list" aria-label="Student levels">
          {STUDENT_LEVELS.map((item) => (
            <span key={item} role="listitem" data-testid={`chip-level-${item.toLowerCase().replace(" ", "-")}`} aria-current={level === item ? "true" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${level === item ? "border-[hsl(var(--plans-green))] bg-[hsl(var(--plans-green-soft))] text-[hsl(var(--plans-green-ink))]" : "border-border bg-card text-muted-foreground"}`}>
              {level === item && <Check className="h-4 w-4" aria-hidden="true" />}
              ClassScribe {item}
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="coming-soon-heading" className="mt-14 rounded-[1.5rem] border border-border bg-card p-7 sm:p-9 lg:mt-20">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[hsl(var(--plans-green-ink))]">On the horizon</p>
        <h2 id="coming-soon-heading" className="mt-2 font-serif text-2xl font-semibold tracking-tight sm:text-3xl">Coming soon</h2>
        <p className="mt-2 text-sm text-muted-foreground">These ClassScribe editions are planned, not available to subscribe to yet.</p>
        <ul className="mt-5 flex flex-wrap gap-2.5" aria-label="Planned editions">
          {["ClassScribe EDU", "ClassScribe Law", "ClassScribe Medicine"].map((edition) => (
            <li key={edition} className="rounded-full border border-border bg-[hsl(var(--plans-green-soft))] px-4 py-2 text-sm font-medium text-[hsl(var(--plans-green-ink))]">{edition}</li>
          ))}
        </ul>
        <Button type="button" variant="outline" onClick={openEduInquiry} data-testid="button-edu-contact" className="mt-5 min-h-11">
          Ask about future school access
        </Button>
      </section>
    </div>
  );
}