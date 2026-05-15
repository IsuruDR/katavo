/**
 * HTML template for the share page. Pure: takes already-signed
 * URLs and serializable values, returns a string. No I/O. All
 * user-supplied text is HTML-escaped; the inline JSON blob has
 * its `</script>` escape applied to prevent script breakout.
 */

const STORE_APP = "https://apps.apple.com/app/katavo/id0000000000"; // TODO real id
const STORE_PLAY = "https://play.google.com/store/apps/details?id=co.katavo.app";

export interface ShareEpisode {
  id: string;
  topic: string;
  durationSeconds: number | null;
  chapters: { timestampSeconds: number; title: string }[];
  audioUrl: string;
  coverUrl: string | null;
  /**
   * For descendants, the parent chapter this expansion was spawned from.
   * Null on the root episode. Drives the genealogy display in the "More
   * from this series" section.
   */
  sourceChapterTitle: string | null;
}

export interface ShareTemplateInput {
  shareUrl: string;
  root: ShareEpisode;
  descendants: ShareEpisode[]; // ordered by created_at ascending
  defaultOgImage: string; // absolute URL to /og/default.png
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function formatMinutes(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "";
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function renderSharePage(input: ShareTemplateInput): string {
  const { root, descendants, shareUrl, defaultOgImage } = input;
  const ogImage = root.coverUrl ?? defaultOgImage;
  const episodesBlob = escapeScriptJson({
    [root.id]: {
      topic: root.topic,
      chapters: root.chapters,
      audioUrl: root.audioUrl,
      durationLabel: formatMinutes(root.durationSeconds),
    },
    ...Object.fromEntries(
      descendants.map((d) => [
        d.id,
        {
          topic: d.topic,
          chapters: d.chapters,
          audioUrl: d.audioUrl,
          durationLabel: formatMinutes(d.durationSeconds),
        },
      ]),
    ),
  });

  const chapterItems = root.chapters
    .map(
      (ch) =>
        `<li><button type="button" data-seek="${ch.timestampSeconds}" class="ch-seek"><span class="ts">${formatTimestamp(
          ch.timestampSeconds,
        )}</span><span class="ch-title">${htmlEscape(ch.title)}</span></button><a href="#get-app" class="ch-expand">Expand in app ›</a></li>`,
    )
    .join("\n          ");

  const seriesSection = descendants.length
    ? `
      <section class="series">
        <h2 class="eyebrow">More from this series</h2>
        <ul>
          ${descendants
            .map((d) => {
              const dur = formatMinutes(d.durationSeconds);
              const chapterAnchor = d.sourceChapterTitle
                ? htmlEscape(d.sourceChapterTitle)
                : htmlEscape(d.topic);
              const lede = d.sourceChapterTitle
                ? `A ${dur || "deep"} dive expanded from this chapter.`
                : `A ${dur || "deep"} dive on this topic.`;
              return `<li>
              <h3 class="series-title">${chapterAnchor}</h3>
              <p class="series-body">${lede}</p>
              <button type="button" data-episode="${htmlEscape(d.id)}" class="series-listen">Listen ›</button>
            </li>`;
            })
            .join("\n          ")}
        </ul>
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${htmlEscape(root.topic)} · Katavo</title>
    <meta name="robots" content="noindex,nofollow" />

    <meta property="og:title" content="${htmlEscape(root.topic)}" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${htmlEscape(ogImage)}" />
    <meta property="og:url" content="${htmlEscape(shareUrl)}" />
    <meta property="og:description" content="Listen to this Katavo episode." />
    <meta property="og:audio" content="${htmlEscape(root.audioUrl)}" />
    <meta property="og:audio:type" content="audio/mpeg" />
    <!-- og:audio rots after the 1h signed URL TTL; the in-page <audio>
         re-signs on each page render and works forever. Acceptable
         trade-off so messaging apps that inline-play (iMessage) work
         on first share. -->

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${htmlEscape(root.topic)}" />
    <meta name="twitter:image" content="${htmlEscape(ogImage)}" />

    <style>
      :root{--paper:#FBF8F1;--ink:#1A1B1F;--ink-2:#84858C;--hair:#E8E2D2;--accent:#2D5040;}
      *,*::before,*::after{box-sizing:border-box}
      body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:var(--paper);color:var(--ink);line-height:1.5}
      header{padding:24px;border-bottom:1px solid var(--hair)}
      header .brand{font-weight:600;letter-spacing:0.3px}
      main{max-width:680px;margin:0 auto;padding:32px 24px 96px}
      .hero-eyebrow{font-size:11px;letter-spacing:0.8px;text-transform:uppercase;color:var(--accent);font-weight:600;margin:0 0 8px}
      .topic{font-family:Georgia,"IBM Plex Serif",serif;font-size:36px;line-height:1.12;margin:0 0 8px;letter-spacing:-0.4px}
      .meta-row{color:var(--ink-2);font-size:14px;margin:0 0 16px}
      .hero-rule{width:56px;height:1px;background:var(--accent);margin:0 0 32px}
      audio{width:100%;margin:0 0 32px}
      .eyebrow{font-size:11px;letter-spacing:0.8px;text-transform:uppercase;color:var(--accent);font-weight:600;margin:0 0 16px}
      section.chapters ol{list-style:none;padding:0;margin:0;display:grid;gap:0}
      section.chapters li{display:flex;align-items:flex-start;gap:12px;border-bottom:1px solid var(--hair);padding:12px 0}
      section.chapters li:last-child{border-bottom:0}
      section.chapters .ch-seek{appearance:none;background:none;border:0;color:var(--ink);text-align:left;flex:1;padding:0;font:inherit;cursor:pointer;display:flex;align-items:flex-start;gap:0;min-width:0}
      section.chapters .ts{display:inline-block;min-width:48px;color:var(--ink-2);font-variant-numeric:tabular-nums;flex-shrink:0}
      section.chapters .ch-title{flex:1;min-width:0}
      section.chapters .ch-expand{font-size:12px;color:var(--accent);text-decoration:none;font-weight:600;letter-spacing:0.2px;white-space:nowrap;padding-top:1px}
      section.series{margin-top:56px;padding-top:32px;border-top:1px solid var(--hair)}
      section.series ul{list-style:none;padding:0;margin:0;display:grid;gap:0}
      section.series li{padding:20px 0;border-bottom:1px solid var(--hair)}
      section.series li:last-child{border-bottom:0}
      section.series .series-title{font-family:Georgia,"IBM Plex Serif",serif;font-size:20px;line-height:1.3;margin:0 0 6px;color:var(--ink);font-weight:600;letter-spacing:-0.2px}
      section.series .series-body{font-size:14px;color:var(--ink-2);margin:0 0 12px;line-height:1.5}
      section.series .series-listen{appearance:none;background:none;border:0;color:var(--accent);font-size:14px;font-weight:600;cursor:pointer;padding:0;font:inherit;letter-spacing:0.2px}
      footer{border-top:1px solid var(--hair);padding:32px 24px;text-align:center;color:var(--ink-2)}
      footer p{margin:0 0 16px;font-family:Georgia,"IBM Plex Serif",serif;font-size:16px;color:var(--ink)}
      footer .badges{display:flex;gap:12px;justify-content:center;align-items:center;flex-wrap:wrap}
      footer .badges a{display:inline-flex;align-items:center;height:48px}
      footer img{height:40px;width:auto;display:block}
    </style>
  </head>
  <body>
    <header><span class="brand">Katavo</span></header>
    <main>
      <p class="hero-eyebrow">Katavo</p>
      <h1 class="topic" id="topic">${htmlEscape(root.topic)}</h1>
      <p class="meta-row" id="meta-row">${formatMinutes(root.durationSeconds)} · ${root.chapters.length} chapters</p>
      <div class="hero-rule" aria-hidden="true"></div>
      <audio id="player" controls preload="metadata" src="${htmlEscape(root.audioUrl)}"></audio>

      <section class="chapters">
        <h2 class="eyebrow">Chapters</h2>
        <ol id="chapter-list">
          ${chapterItems}
        </ol>
      </section>
      ${seriesSection}
    </main>
    <footer id="get-app">
      <p>Make your own podcast with Katavo.</p>
      <div class="badges">
        <a href="${STORE_APP}"><img src="/og/app-store.svg" alt="Download on the App Store" /></a>
        <a href="${STORE_PLAY}"><img src="/og/play-store.png" alt="Get it on Google Play" /></a>
      </div>
    </footer>
    <script>
      window.__EPISODES__ = ${episodesBlob};
      (function () {
        var audio = document.getElementById("player");
        var list = document.getElementById("chapter-list");
        var topicEl = document.getElementById("topic");
        var metaEl = document.getElementById("meta-row");

        function escapeHtml(s) {
          return s.replace(/[&<>"']/g, function (c) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
          });
        }
        function fmt(t) {
          var m = Math.floor(t / 60), s = Math.floor(t % 60);
          return m + ":" + (s < 10 ? "0" + s : s);
        }
        function renderChapters(chapters) {
          list.innerHTML = chapters
            .map(function (ch) {
              return '<li><button type="button" data-seek="' + ch.timestampSeconds + '" class="ch-seek"><span class="ts">' +
                fmt(ch.timestampSeconds) + '</span><span class="ch-title">' + escapeHtml(ch.title) +
                '</span></button><a href="#get-app" class="ch-expand">Expand in app ›</a></li>';
            })
            .join("");
        }
        document.addEventListener("click", function (ev) {
          var t = ev.target.closest("[data-seek]");
          if (t) {
            audio.currentTime = parseFloat(t.getAttribute("data-seek"));
            audio.play();
            return;
          }
          var ep = ev.target.closest("[data-episode]");
          if (ep) {
            var id = ep.getAttribute("data-episode");
            var data = window.__EPISODES__[id];
            if (!data) return;
            audio.pause();
            audio.src = data.audioUrl;
            audio.load();
            renderChapters(data.chapters);
            topicEl.textContent = data.topic;
            metaEl.textContent = data.durationLabel + " · " + data.chapters.length + " chapters";
            document.title = data.topic + " · Katavo";
            window.scrollTo(0, 0);
          }
        });
      })();
    </script>
  </body>
</html>`;
}
