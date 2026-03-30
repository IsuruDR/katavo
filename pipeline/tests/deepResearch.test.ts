import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());
const mockRetrieve = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    responses: {
      create: mockCreate,
      retrieve: mockRetrieve,
    },
  })),
}));

import { deepResearch } from "../src/podcast_pipeline/nodes/deepResearch.js";

describe("deepResearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should poll until complete and extract research document with sources", async () => {
    // First call returns in_progress (background: true)
    mockCreate.mockResolvedValue({
      id: "resp_abc123",
      status: "in_progress",
    });

    // Polling: first still in_progress, then completed
    mockRetrieve
      .mockResolvedValueOnce({
        id: "resp_abc123",
        status: "in_progress",
      })
      .mockResolvedValueOnce({
        id: "resp_abc123",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  sections: [
                    { title: "Introduction", content: "Quantum computing threatens current encryption..." },
                    { title: "Current State", content: "NIST has standardized post-quantum algorithms..." },
                  ],
                  sources: [
                    { url: "https://nist.gov/pqc", title: "NIST PQC Standards" },
                    { url: "https://arxiv.org/quantum", title: "Quantum Threat Analysis" },
                    { url: "https://ieee.org/crypto", title: "IEEE Crypto Review" },
                  ],
                }),
                annotations: [
                  { type: "url_citation", url: "https://nist.gov/pqc", title: "NIST PQC Standards" },
                  { type: "url_citation", url: "https://arxiv.org/quantum", title: "Quantum Threat Analysis" },
                  { type: "url_citation", url: "https://ieee.org/crypto", title: "IEEE Crypto Review" },
                ],
              },
            ],
          },
        ],
      });

    const state = {
      researchBrief: '{"scope":"quantum crypto","keyQuestions":["What is PQC?","When is Q-day?"]}',
      trustedSourceUrls: [],
      tier: "free",
      researchIterations: 0,
      credibilityReport: "",
    };

    const result = await deepResearch(state as any, {
      timeoutMs: 30_000,
      pollIntervalMs: 10,
    });

    expect(result.researchDocument).toBeDefined();
    expect((result.researchDocument as any).sections).toHaveLength(2);
    expect(result.sources).toHaveLength(3);
    expect(result.credibilityScore).toBeGreaterThan(0);
    expect(result.credibilityReport).toContain("3 unique sources");
    expect(result.status).toBe("scripting");

    // Verify background: true was used
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "o4-mini-deep-research",
        background: true,
      }),
    );
  });

  it("should use higher max_tool_calls for pro tier", async () => {
    mockCreate.mockResolvedValue({
      id: "resp_pro",
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                sections: [{ title: "Test", content: "Content" }],
                sources: [{ url: "https://a.com", title: "A" }, { url: "https://b.com", title: "B" }, { url: "https://c.com", title: "C" }],
              }),
              annotations: [
                { type: "url_citation", url: "https://a.com", title: "A" },
                { type: "url_citation", url: "https://b.com", title: "B" },
                { type: "url_citation", url: "https://c.com", title: "C" },
              ],
            },
          ],
        },
      ],
    });

    const state = {
      researchBrief: '{"scope":"test","keyQuestions":["q1"]}',
      trustedSourceUrls: [],
      tier: "pro",
      researchIterations: 0,
      credibilityReport: "",
    };

    await deepResearch(state as any);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tool_calls: 40,
      }),
    );
  });

  it("should include trusted sources in prompt for pro tier", async () => {
    mockCreate.mockResolvedValue({
      id: "resp_trusted",
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                sections: [{ title: "Test", content: "Content" }],
                sources: [{ url: "https://trusted.com", title: "Trusted" }, { url: "https://b.com", title: "B" }, { url: "https://c.com", title: "C" }],
              }),
              annotations: [
                { type: "url_citation", url: "https://trusted.com", title: "Trusted" },
                { type: "url_citation", url: "https://b.com", title: "B" },
                { type: "url_citation", url: "https://c.com", title: "C" },
              ],
            },
          ],
        },
      ],
    });

    const state = {
      researchBrief: '{"scope":"test","keyQuestions":["q1"]}',
      trustedSourceUrls: ["https://trusted.com"],
      tier: "pro",
      researchIterations: 0,
      credibilityReport: "",
    };

    await deepResearch(state as any);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.input).toContain("https://trusted.com");
  });

  it("should include retry context when researchIterations > 0", async () => {
    mockCreate.mockResolvedValue({
      id: "resp_retry",
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                sections: [{ title: "Retry", content: "Filled gaps" }],
                sources: [{ url: "https://a.com", title: "A" }, { url: "https://b.com", title: "B" }, { url: "https://c.com", title: "C" }],
              }),
              annotations: [
                { type: "url_citation", url: "https://a.com", title: "A" },
                { type: "url_citation", url: "https://b.com", title: "B" },
                { type: "url_citation", url: "https://c.com", title: "C" },
              ],
            },
          ],
        },
      ],
    });

    const state = {
      researchBrief: '{"scope":"test","keyQuestions":["q1"]}',
      trustedSourceUrls: [],
      tier: "free",
      researchIterations: 1,
      credibilityReport: "Missing coverage on quantum key distribution",
    };

    await deepResearch(state as any);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.input).toContain("Missing coverage on quantum key distribution");
  });

  it("should fail with retryable error on timeout", async () => {
    // Override timeout for test speed — the implementation accepts an optional timeout param
    mockCreate.mockResolvedValue({
      id: "resp_timeout",
      status: "in_progress",
    });

    // Always return in_progress (simulate timeout)
    mockRetrieve.mockResolvedValue({
      id: "resp_timeout",
      status: "in_progress",
    });

    const state = {
      researchBrief: '{"scope":"test","keyQuestions":["q1"]}',
      trustedSourceUrls: [],
      tier: "free",
      researchIterations: 0,
      credibilityReport: "",
    };

    // Use internal override for test — 100ms timeout, 50ms poll
    const result = await deepResearch(state as any, {
      timeoutMs: 100,
      pollIntervalMs: 50,
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("timed out");
  });

  it("should handle API failure gracefully", async () => {
    mockCreate.mockResolvedValue({
      id: "resp_fail",
      status: "failed",
      error: { message: "Rate limited" },
    });

    const state = {
      researchBrief: '{"scope":"test","keyQuestions":["q1"]}',
      trustedSourceUrls: [],
      tier: "free",
      researchIterations: 0,
      credibilityReport: "",
    };

    const result = await deepResearch(state as any);

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("Deep research failed");
  });
});
