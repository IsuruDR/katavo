// Preview script — renders a sample cover and writes to /tmp.
// Run with: cd pipeline && node --import tsx scripts/preview-cover.mjs
import fs from "node:fs";
import { generateCoverArtwork } from "../src/podcast_pipeline/nodes/coverArtwork.ts";

const png = await generateCoverArtwork({
  topic: "The impact of quantum computing on cryptography",
  chapterCount: 7,
  durationMinutes: 11,
});

fs.writeFileSync("/tmp/cover-preview.png", png);
console.log(`Wrote /tmp/cover-preview.png (${png.length} bytes)`);
