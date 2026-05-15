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
  parentPodcastId: string | null;
  topic: string;
  durationSeconds: number | null;
  chapters: { timestampSeconds: number; title: string }[];
  audioUrl: string;
  coverUrl: string | null;
  /**
   * For descendants, the parent chapter this expansion was spawned from.
   * Null on the root episode. Drives the genealogy display in the "More
   * from this series" section and the client-side Listen-vs-Expand
   * affordance after an episode swap.
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

  // For every podcast in the tree, the JS-side renderChapters needs id,
  // parentPodcastId, and sourceChapterTitle so it can derive the
  // per-chapter Listen-vs-Expand affordance after an episode swap.
  // The root's parent is null and source is null; descendants carry both.
  const episodesBlob = escapeScriptJson({
    [root.id]: {
      id: root.id,
      parentPodcastId: null,
      sourceChapterTitle: null,
      topic: root.topic,
      chapters: root.chapters,
      audioUrl: root.audioUrl,
      durationLabel: formatMinutes(root.durationSeconds),
    },
    ...Object.fromEntries(
      descendants.map((d) => [
        d.id,
        {
          id: d.id,
          parentPodcastId: d.parentPodcastId,
          sourceChapterTitle: d.sourceChapterTitle,
          topic: d.topic,
          chapters: d.chapters,
          audioUrl: d.audioUrl,
          durationLabel: formatMinutes(d.durationSeconds),
        },
      ]),
    ),
  });

  // Map of chapter title -> expansion id, for the root podcast's chapters.
  // Each chapter row uses this to decide: Listen (if expanded) or Expand
  // in app (if not). Client-side renderChapters builds the same map per
  // podcast when an episode swap happens.
  const rootExpansionsByChapter = new Map<string, string>();
  for (const d of descendants) {
    if (d.sourceChapterTitle) {
      rootExpansionsByChapter.set(d.sourceChapterTitle, d.id);
    }
  }

  const chapterItems = root.chapters
    .map((ch) => {
      const expansionId = rootExpansionsByChapter.get(ch.title);
      const action = expansionId
        ? `<button type="button" data-episode="${htmlEscape(expansionId)}" class="ch-listen">Listen ›</button>`
        : `<button type="button" class="ch-expand" data-prompt-expand>Expand in app ›</button>`;
      return `<li><button type="button" data-seek="${ch.timestampSeconds}" class="ch-seek"><span class="ts">${formatTimestamp(
        ch.timestampSeconds,
      )}</span><span class="ch-title">${htmlEscape(ch.title)}</span></button>${action}</li>`;
    })
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
      section.chapters .ch-expand,section.chapters .ch-listen{appearance:none;background:none;border:0;font:inherit;color:var(--accent);font-size:12px;font-weight:600;letter-spacing:0.2px;white-space:nowrap;padding:0;cursor:pointer;align-self:flex-start;padding-top:1px}
      section.series{margin-top:56px;padding-top:32px;border-top:1px solid var(--hair)}
      section.series ul{list-style:none;padding:0;margin:0;display:grid;gap:0}
      section.series li{padding:20px 0;border-bottom:1px solid var(--hair)}
      section.series li:last-child{border-bottom:0}
      section.series .series-title{font-family:Georgia,"IBM Plex Serif",serif;font-size:20px;line-height:1.3;margin:0 0 6px;color:var(--ink);font-weight:600;letter-spacing:-0.2px}
      section.series .series-body{font-size:14px;color:var(--ink-2);margin:0 0 12px;line-height:1.5}
      section.series .series-listen{appearance:none;background:none;border:0;color:var(--accent);font-size:14px;font-weight:600;cursor:pointer;padding:0;font:inherit;letter-spacing:0.2px}
      footer{border-top:1px solid var(--hair);padding:32px 24px;text-align:center;color:var(--ink-2)}
      footer p{margin:0 0 16px;font-family:Georgia,"IBM Plex Serif",serif;font-size:16px;color:var(--ink)}
      .badges{display:flex;gap:12px;justify-content:center;align-items:center;flex-wrap:wrap}
      .badges a{display:flex;align-items:center;justify-content:center;width:160px;height:52px}
      .badges img{max-width:100%;max-height:100%;width:auto;height:auto;display:block}
      .modal{position:fixed;inset:0;z-index:50;display:flex;align-items:flex-end;justify-content:center;visibility:hidden;opacity:0;transition:opacity 200ms ease}
      .modal[aria-hidden="false"]{visibility:visible;opacity:1}
      .modal-scrim{position:absolute;inset:0;background:rgba(26,27,31,0.45);border:0;cursor:pointer;width:100%;padding:0}
      .modal-sheet{position:relative;background:var(--paper);border-radius:24px 24px 0 0;padding:24px 24px 28px;max-width:480px;width:100%;text-align:center;transform:translateY(100%);transition:transform 220ms cubic-bezier(0.22,1,0.36,1)}
      .modal[aria-hidden="false"] .modal-sheet{transform:translateY(0)}
      .modal-grab{width:36px;height:4px;border-radius:2px;background:var(--hair);margin:0 auto 16px}
      .modal-eyebrow{font-size:11px;letter-spacing:0.8px;text-transform:uppercase;color:var(--accent);font-weight:600;margin:0 0 8px}
      .modal-title{font-family:Georgia,"IBM Plex Serif",serif;font-size:26px;line-height:1.2;margin:0 0 8px;color:var(--ink);letter-spacing:-0.3px;font-weight:700}
      .modal-body{color:var(--ink-2);margin:0 0 20px;font-size:15px;line-height:1.5}
      .modal-close{appearance:none;background:none;border:0;color:var(--ink-2);font-size:14px;cursor:pointer;padding:12px;font:inherit;margin-top:8px}
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

    <div id="expand-modal" class="modal" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button type="button" class="modal-scrim" data-close-modal aria-label="Close"></button>
      <div class="modal-sheet">
        <div class="modal-grab" aria-hidden="true"></div>
        <p class="modal-eyebrow">Expand chapter</p>
        <h3 class="modal-title" id="modal-title">Open it up in the app.</h3>
        <p class="modal-body">Chapter expansions live in the Katavo app — pick the chapter, get a fresh ten-minute deep dive that builds on it.</p>
        <div class="badges">
          <a href="${STORE_APP}"><img src="/og/app-store.svg" alt="Download on the App Store" /></a>
          <a href="${STORE_PLAY}"><img src="/og/play-store.png" alt="Get it on Google Play" /></a>
        </div>
        <button type="button" class="modal-close" data-close-modal>Maybe later</button>
      </div>
    </div>

    <script>
      window.__EPISODES__ = ${episodesBlob};
      (function () {
        var audio = document.getElementById("player");
        var list = document.getElementById("chapter-list");
        var topicEl = document.getElementById("topic");
        var metaEl = document.getElementById("meta-row");
        var modal = document.getElementById("expand-modal");

        function escapeHtml(s) {
          return s.replace(/[&<>"']/g, function (c) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
          });
        }
        function fmt(t) {
          var m = Math.floor(t / 60), s = Math.floor(t % 60);
          return m + ":" + (s < 10 ? "0" + s : s);
        }
        // For the given podcast id, build a map of chapter-title -> the
        // descendant id that was expanded from that chapter. Mirrors the
        // server-side rootExpansionsByChapter logic so per-chapter
        // affordances stay consistent after an episode swap.
        function expansionsFor(podcastId) {
          var map = {};
          var episodes = window.__EPISODES__;
          for (var k in episodes) {
            if (!Object.prototype.hasOwnProperty.call(episodes, k)) continue;
            var e = episodes[k];
            if (e.parentPodcastId === podcastId && e.sourceChapterTitle) {
              map[e.sourceChapterTitle] = e.id;
            }
          }
          return map;
        }
        function renderChapters(podcastId) {
          var ep = window.__EPISODES__[podcastId];
          if (!ep) return;
          var expansions = expansionsFor(podcastId);
          list.innerHTML = ep.chapters
            .map(function (ch) {
              var expansionId = expansions[ch.title];
              var action = expansionId
                ? '<button type="button" data-episode="' + escapeHtml(expansionId) + '" class="ch-listen">Listen ›</button>'
                : '<button type="button" class="ch-expand" data-prompt-expand>Expand in app ›</button>';
              return '<li><button type="button" data-seek="' + ch.timestampSeconds + '" class="ch-seek"><span class="ts">' +
                fmt(ch.timestampSeconds) + '</span><span class="ch-title">' + escapeHtml(ch.title) +
                '</span></button>' + action + '</li>';
            })
            .join("");
        }
        function openExpandModal() {
          if (!modal) return;
          modal.setAttribute("aria-hidden", "false");
          document.body.style.overflow = "hidden";
        }
        function closeExpandModal() {
          if (!modal) return;
          modal.setAttribute("aria-hidden", "true");
          document.body.style.overflow = "";
        }
        document.addEventListener("click", function (ev) {
          if (ev.target.closest("[data-prompt-expand]")) {
            openExpandModal();
            return;
          }
          if (ev.target.closest("[data-close-modal]")) {
            closeExpandModal();
            return;
          }
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
            renderChapters(id);
            topicEl.textContent = data.topic;
            metaEl.textContent = data.durationLabel + " · " + data.chapters.length + " chapters";
            document.title = data.topic + " · Katavo";
            window.scrollTo(0, 0);
          }
        });
        document.addEventListener("keydown", function (ev) {
          if (ev.key === "Escape") closeExpandModal();
        });
      })();
    </script>
  </body>
</html>`;
}
