/**
 * Cover artwork generator — turns a podcast's topic + chapter count + duration
 * into a 1024x1024 PNG that surfaces on the OS lock-screen via Now Playing.
 *
 * Treats every podcast as a one-of-one printed pamphlet cover: warm paper,
 * editorial Plex Serif topic, quiet Plex Sans meta line, single accent rule.
 * No app logo dominance; the topic IS the artwork.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import satori, { type Font } from "satori";
import { Resvg } from "@resvg/resvg-js";

// Tokens mirror the mobile design system.
const COLOR = {
  paper: "#FBF8F1",
  ink: "#1A1B1F",
  inkSecondary: "#84858C",
  accent: "#2D5040",
} as const;

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve from this file's location through node_modules so the bundled
// fonts are reliably found regardless of how the pipeline is run.
function fontPath(rel: string): string {
  // src/podcast_pipeline/nodes/coverArtwork.ts -> repo root -> node_modules
  return resolve(__dirname, "../../..", "node_modules", rel);
}

let cachedFonts: Font[] | null = null;

function loadFonts(): Font[] {
  if (cachedFonts) return cachedFonts;
  cachedFonts = [
    {
      name: "Plex Serif",
      weight: 700,
      data: readFileSync(
        fontPath(
          "@expo-google-fonts/ibm-plex-serif/700Bold/IBMPlexSerif_700Bold.ttf",
        ),
      ),
    },
    {
      name: "Plex Sans",
      weight: 500,
      data: readFileSync(
        fontPath(
          "@expo-google-fonts/ibm-plex-sans/500Medium/IBMPlexSans_500Medium.ttf",
        ),
      ),
    },
    {
      name: "Plex Sans",
      weight: 600,
      data: readFileSync(
        fontPath(
          "@expo-google-fonts/ibm-plex-sans/600SemiBold/IBMPlexSans_600SemiBold.ttf",
        ),
      ),
    },
  ];
  return cachedFonts;
}

interface CoverInput {
  topic: string;
  chapterCount: number;
  durationMinutes: number;
}

/**
 * Build the satori element tree. Satori accepts React-like elements but
 * doesn't require a React runtime; plain `{ type, props }` objects work.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTree({ topic, chapterCount, durationMinutes }: CoverInput): any {
  const meta = `${chapterCount} ${chapterCount === 1 ? "chapter" : "chapters"} · ${durationMinutes} min`;

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        backgroundColor: COLOR.paper,
        padding: "96px",
      },
      children: [
        // Top block: eyebrow + topic
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "32px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Plex Sans",
                    fontWeight: 600,
                    fontSize: 22,
                    color: COLOR.accent,
                    letterSpacing: 5,
                    textTransform: "uppercase",
                  },
                  children: "Katavo",
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Plex Serif",
                    fontWeight: 700,
                    fontSize: 92,
                    lineHeight: 1.08,
                    letterSpacing: -1.6,
                    color: COLOR.ink,
                    // Soft clamp: satori wraps text naturally inside the
                    // flex container; if the topic is unusually long, it
                    // overflows visually but the artwork still renders.
                    overflow: "hidden",
                  },
                  children: topic,
                },
              },
            ],
          },
        },
        // Bottom block: meta + hairline rule
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "40px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Plex Sans",
                    fontWeight: 500,
                    fontSize: 30,
                    color: COLOR.inkSecondary,
                    letterSpacing: 0.3,
                  },
                  children: meta,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    width: 220,
                    height: 4,
                    backgroundColor: COLOR.accent,
                    borderRadius: 2,
                  },
                },
              },
            ],
          },
        },
      ],
    },
  };
}

/**
 * Render the cover as a 1024x1024 PNG buffer.
 * Returns the bytes ready for Supabase Storage upload.
 */
export async function generateCoverArtwork(
  input: CoverInput,
): Promise<Buffer> {
  const fonts = loadFonts();
  const svg = await satori(buildTree(input), {
    width: 1024,
    height: 1024,
    fonts,
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1024 },
  });
  return Buffer.from(resvg.render().asPng());
}
