export const creditsConfig = {
  currency: { code: "CRD", name: "Scribe Credits" },
  // This selector is deliberately staged by the durable database readiness
  // record; the target alone must never switch production traffic.
  selectorTarget: "CREDITS",
  offeringIdentifier: "credits",
  packs: [
    { id: "credits_10", credits: 10, priceCents: 199, name: "10 Scribe Credits", label: "" },
    { id: "credits_30", credits: 30, priceCents: 499, name: "30 Scribe Credits", label: "Best value" },
    { id: "credits_75", credits: 75, priceCents: 999, name: "75 Scribe Credits", label: "Most credits" },
  ],
  monthlyBonus: { student: 10, pro: 30 },
  welcomeBonus: 5,
  costs: {
    transcription10Minutes: 1,
    savedRecording: 2,
    studyGuide: 3,
    askQuestion: 1,
  },
} as const;