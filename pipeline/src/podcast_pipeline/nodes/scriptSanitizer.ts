/**
 * Deterministic post-processor between scriptWriter and tagInjector.
 *
 * Why this exists: the synthesizer's URL sanitizer (SEC-3) blocks bad URLs
 * from landing in research_contexts.sources, but a prompt-injected claim
 * can still steer the script writer into voicing an attacker-chosen URL,
 * phone number, or email out loud in the final MP3. Once the audio ships,
 * detection is hard, so we redact at the text layer where it's cheap.
 *
 * Strategy: regex-redact URLs, phone-number-like patterns, and emails out
 * of the script body. Each redacted span gets replaced with a neutral
 * substitute that keeps the prose readable.
 *
 *  - https://example.com/path        -> "an online source"
 *  - 415-555-1234 / +1 415 555 1234  -> "a phone number"
 *  - hello@example.com               -> "an email address"
 *
 * The function returns the cleaned script plus a summary of what was
 * redacted, so callers can log it.
 *
 * False-positive surface: phone-number regex is conservative (requires
 * 10+ digits with separators). Acronyms like "U.S." and version strings
 * like "2.4.6" are not matched. URLs require an explicit scheme.
 */

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
// Conservative phone-number match: optional country code (+ and 1-3 digits
// or a bare 1-3 digit prefix with a separator), then a 3-digit area code
// optionally wrapped in (), then two more digit groups in the NANP shape
// (3-3-4 / 3-4-4 split). Lookbehind/lookahead anchor against adjacent
// digits so a longer numeric token doesn't get partially eaten.
//
// Covers: 415-555-1234, +1 415 555 1234, 1.415.555.1234, (415) 555-1234,
//         14155551234. Skips: "2.4.6", "2024", "3 people".
const PHONE_PATTERN =
  /(?<!\d)(?:\+?\d{1,3}[ .\-]?)?\(?\d{3}\)?[ .\-]?\d{3}[ .\-]?\d{4}(?!\d)/g;

const REPLACEMENT_URL = "an online source";
const REPLACEMENT_PHONE = "a phone number";
const REPLACEMENT_EMAIL = "an email address";

export interface SanitizedScript {
  script: string;
  redactions: {
    urls: string[];
    emails: string[];
    phones: string[];
  };
}

export function sanitizeScript(input: string): SanitizedScript {
  const urls: string[] = [];
  const emails: string[] = [];
  const phones: string[] = [];

  let script = input.replace(URL_PATTERN, (match) => {
    urls.push(match);
    return REPLACEMENT_URL;
  });
  script = script.replace(EMAIL_PATTERN, (match) => {
    emails.push(match);
    return REPLACEMENT_EMAIL;
  });
  script = script.replace(PHONE_PATTERN, (match) => {
    phones.push(match);
    return REPLACEMENT_PHONE;
  });

  return { script, redactions: { urls, emails, phones } };
}
