# TSS Schedule Builder (v0.1)

Rebuilds a Mon–Fri weekly calendar view for UCSD's TSS course search, since TSS
dropped the calendar view that WebReg used to have.

## How it works
- A page-context script (`inject.js`) patches `XMLHttpRequest` (and `fetch`, as
  a fallback) to watch for responses from the `YUCSD_CON_EVENTS` OData
  endpoint — the call TSS makes when you open a course's section list.
- `content.js` catches those responses, parses each section's `Sched` string
  into day/time/location, groups meetings by `EventPkgObjid` (the actual
  enrollable "section" — e.g. a lecture + its matching discussion), and
  renders a floating panel with a checklist + Mon–Fri grid.
- Selections and everything you've browsed so far persist in
  `chrome.storage.local`, so navigating between courses doesn't lose earlier
  ones.

## Load it (Chrome/Edge)
1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**, select this `tss-schedule-extension` folder.
4. Go to `https://tss.ucsd.edu`, log in, open the Schedule of Classes.
5. A **📅 Schedule** button appears bottom-right. Click into a few courses'
   **Class Sections** tab to populate the list — you don't need to click
   "Go To Booking"; that's a separate enrollment flow gated by your
   appointment window and has nothing to do with viewing sections.
6. Click **📅 Schedule** to open the panel, check off sections, and see them
   on the grid.

## What's new in this version
- **Panel is draggable** — click-drag the dark header bar to move it off
  whatever it's covering.
- **Panel is resizable** — drag the bottom-right corner handle.
- **Minimize (–)** collapses it to just the header bar without losing your
  selections.
- **Multiple named plans** — the dropdown in the header lets you switch
  between different hypothetical schedules (`+` new, `✎` rename, `🗑`
  delete). Each plan remembers its own checked sections independently, so
  you can compare "Plan A" vs "Plan B" side by side by switching between
  them.
- **Conflict detection** — overlapping meeting times on the same day turn
  red with a ⚠, and a note lists which sections clash.
- Position, size, and all plans persist across page reloads/navigation via
  `chrome.storage.local`.

## Known limitations / things to check while testing
- **Data travels inside `$batch` requests, not standalone `YUCSD_CON_EVENTS`
  calls.** SAP UI5 bundles multiple OData calls into one multipart HTTP
  request. The extension unpacks these automatically now, but if TSS changes
  how it batches things in the future, this is the first place to check.
- The section list only shows courses you've actually opened in TSS — it's
  passively capturing whatever you browse, not doing its own search. If you'd
  rather search/add courses directly from the panel without clicking into
  each one in TSS, that's doable but needs the exact request URL for the
  course-search OData call (grab it from DevTools → Network → Headers →
  Request URL) so a direct fetch can be wired up.
- Grid only plots Mon–Fri; anything meeting Sat/Sun shows as a text note
  below the grid instead of a block.
- `Sched` string parsing assumes the `"<Days> <start> - <end> ... [@ <location>]"`
  format seen so far (including the online-course variant with no `@`).
  If a section silently doesn't show a block or a note, paste me that
  section's raw `Sched` value and it can be added.

