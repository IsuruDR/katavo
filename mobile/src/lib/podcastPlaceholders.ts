/**
 * Curated rotation of demo topics for the onboarding first-podcast screen.
 * Hand-picked because the model produces noticeably better output on these
 * (rich named entities, dates, real-world data the deep research can land on).
 */

export const ONBOARDING_PLACEHOLDERS = [
  "the rise of espresso machines in early 20th century Italy",
  "why sourdough starters work",
  "the design history of the Sony Walkman",
  "the 1973 oil crisis",
  "how mechanical watches keep time",
  "why Wikipedia works",
  "the science behind dreaming",
  "how money laundering schemes get caught",
  "why some languages have grammatical gender",
  "the history of canned food",
];

export function pickOnboardingPlaceholder(): string {
  return ONBOARDING_PLACEHOLDERS[
    Math.floor(Math.random() * ONBOARDING_PLACEHOLDERS.length)
  ];
}
