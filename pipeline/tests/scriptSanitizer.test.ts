import { describe, it, expect } from "vitest";
import { sanitizeScript } from "../src/podcast_pipeline/nodes/scriptSanitizer.js";

describe("sanitizeScript", () => {
  it("redacts http and https URLs", () => {
    const input = "Visit http://example.com and https://other.org/path?q=1 for more.";
    const { script, redactions } = sanitizeScript(input);
    expect(script).toBe("Visit an online source and an online source for more.");
    expect(redactions.urls).toEqual([
      "http://example.com",
      "https://other.org/path?q=1",
    ]);
  });

  it("redacts email addresses", () => {
    const input = "Contact hello@example.com for details.";
    const { script, redactions } = sanitizeScript(input);
    expect(script).toBe("Contact an email address for details.");
    expect(redactions.emails).toEqual(["hello@example.com"]);
  });

  it("redacts phone-number-like patterns", () => {
    const cases = [
      "Call 415-555-1234 today.",
      "Call +1 415 555 1234 today.",
      "Call 1.415.555.1234 today.",
      "Call (415) 555-1234 today.",
    ];
    for (const input of cases) {
      const { script, redactions } = sanitizeScript(input);
      expect(script).toBe("Call a phone number today.");
      expect(redactions.phones.length).toBe(1);
    }
  });

  it("does not match acronyms or version strings", () => {
    const input = "U.S. census data from 2.4.6 indicates that 3 people responded.";
    const { script, redactions } = sanitizeScript(input);
    expect(script).toBe(input);
    expect(redactions.phones).toEqual([]);
    expect(redactions.urls).toEqual([]);
  });

  it("leaves regular prose untouched", () => {
    const input = "Bezzera filed his patent in 1901. The industry took notice.";
    const { script, redactions } = sanitizeScript(input);
    expect(script).toBe(input);
    expect(redactions.urls).toEqual([]);
    expect(redactions.emails).toEqual([]);
    expect(redactions.phones).toEqual([]);
  });

  it("handles multiple redaction types in one pass", () => {
    const input = "Visit https://phish.example/login or call 415-555-1234 or email bad@phish.example.";
    const { script, redactions } = sanitizeScript(input);
    expect(script).toContain("an online source");
    expect(script).toContain("a phone number");
    expect(script).toContain("an email address");
    expect(redactions.urls.length).toBe(1);
    expect(redactions.phones.length).toBe(1);
    expect(redactions.emails.length).toBe(1);
  });

  it("handles empty input", () => {
    const { script, redactions } = sanitizeScript("");
    expect(script).toBe("");
    expect(redactions.urls).toEqual([]);
    expect(redactions.phones).toEqual([]);
    expect(redactions.emails).toEqual([]);
  });

  it("preserves chapter markers and other script structure", () => {
    const input = "[CHAPTER: The opening] Bezzera filed his patent.";
    const { script } = sanitizeScript(input);
    expect(script).toBe(input);
  });
});
