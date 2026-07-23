(function () {
  "use strict";

  // ---------- 1. Inject the page-context script that captures OData responses ----------
  function injectPageScript() {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("inject.js");
    s.onload = function () {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(s);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectPageScript, { once: true });
  } else {
    injectPageScript();
  }

  // ---------- 2. State ----------
  const DAY_COLS = { M: 0, Tu: 1, W: 2, Th: 3, F: 4 };
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const GRID_START_MIN = 7 * 60; // 7:00 AM
  const GRID_END_MIN = 22 * 60; // 10:00 PM
  const DEFAULT_PANEL = { top: 70, left: null, right: 20, width: 880, height: 640 };

  let catalog = {}; // pkgId -> section object
  let plans = { "Plan A": [] }; // planName -> array of pkgIds
  let activePlan = "Plan A";
  let panelState = { ...DEFAULT_PANEL, collapsed: false };
  let panelOpen = false;

  // ---------- 3. Helpers ----------
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function currentSelected() {
    return new Set(plans[activePlan] || []);
  }

  function setSelected(setObj) {
    plans[activePlan] = Array.from(setObj);
  }

  function parseTimeToMinutes(t) {
    const m = t.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[3].toUpperCase();
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h * 60 + min;
  }

  // "Tu, Th 09:30 AM - 10:50 AM In Person @ Galbraith Hall Room 242\nFinal Examination ..."
  function parseSched(schedStr) {
    if (!schedStr) return [];
    const lines = schedStr.split("\n").map((l) => l.trim()).filter(Boolean);
    const meetings = [];
    for (const line of lines) {
      if (/^Final Examination/i.test(line)) continue;
      const m = line.match(/^([A-Za-z,\s]+?)\s+(\d{1,2}:\d{2}\s?[AP]M)\s*-\s*(\d{1,2}:\d{2}\s?[AP]M)\s+(.+)$/i);
      if (!m) continue;
      const days = m[1].split(",").map((d) => d.trim()).filter(Boolean);
      const start = m[2];
      const end = m[3];
      let rest = m[4];
      let location = "";
      const atIdx = rest.indexOf("@");
      if (atIdx !== -1) location = rest.slice(atIdx + 1).trim();
      meetings.push({
        days,
        start,
        end,
        startMin: parseTimeToMinutes(start),
        endMin: parseTimeToMinutes(end),
        location,
      });
    }
    return meetings;
  }

  function colorForCourse(courseCode) {
    let hash = 0;
    for (let i = 0; i < courseCode.length; i++) {
      hash = courseCode.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

  // ---------- 4. Ingest captured events into the catalog ----------
  function ingestEvents(events) {
    let changed = false;
    for (const ev of events) {
      const pkgId = ev.EventPkgObjid;
      if (!pkgId) continue;
      const label = ev.EventPkgText || "";
      const courseCode = label.split("(")[0].trim() || label;

      if (!catalog[pkgId]) {
        catalog[pkgId] = {
          pkgId,
          displayId: ev.EventPkgDisplayID,
          label,
          courseCode,
          seatsAvailable: ev.EventPkgSeatsAvailable,
          seatsLimit: ev.EventPkgLimit,
          waitlist: ev.EventPkgNumOnWaitl,
          meetings: [],
          notes: [],
        };
        changed = true;
      }

      const section = catalog[pkgId];
      if (!section.notes) section.notes = [];
      // Keep seat info fresh
      section.seatsAvailable = ev.EventPkgSeatsAvailable;
      section.seatsLimit = ev.EventPkgLimit;
      section.waitlist = ev.EventPkgNumOnWaitl;

      const parsed = parseSched(ev.Sched).map((m) => ({
        ...m,
        method: ev.TeachingMethod_Text,
        instructor: ev.InstructorName,
        eventId: ev.EventID,
      }));

      for (const pm of parsed) {
        const dup = section.meetings.some(
          (existing) =>
            existing.eventId === pm.eventId &&
            existing.start === pm.start &&
            existing.days.join(",") === pm.days.join(",")
        );
        if (!dup) {
          section.meetings.push(pm);
          changed = true;
        }
      }

      if (parsed.length === 0 && ev.Sched && ev.Sched.trim()) {
        const note = `${ev.TeachingMethod_Text}: ${ev.Sched.trim()}`;
        if (!section.notes.includes(note)) {
          section.notes.push(note);
          changed = true;
        }
      }
    }
    if (changed) {
      persist();
      render();
    }
  }

  // ---------- 5. Persistence ----------
  function persist() {
    try {
      chrome.storage.local.set({
        tss_schedule_catalog: catalog,
        tss_schedule_plans: plans,
        tss_schedule_active_plan: activePlan,
        tss_schedule_panel_state: panelState,
      });
    } catch (e) {
      /* extension context may be reloading; ignore */
    }
  }

  function loadPersisted(cb) {
    try {
      chrome.storage.local.get(
        [
          "tss_schedule_catalog",
          "tss_schedule_plans",
          "tss_schedule_active_plan",
          "tss_schedule_panel_state",
          "tss_schedule_selected", // legacy key from v0.1, migrated below
        ],
        (res) => {
          if (res.tss_schedule_catalog) catalog = res.tss_schedule_catalog;
          if (res.tss_schedule_plans) {
            plans = res.tss_schedule_plans;
          } else if (res.tss_schedule_selected) {
            // migrate old single-selection format into "Plan A"
            plans = { "Plan A": res.tss_schedule_selected };
          }
          if (res.tss_schedule_active_plan && plans[res.tss_schedule_active_plan]) {
            activePlan = res.tss_schedule_active_plan;
          } else {
            activePlan = Object.keys(plans)[0] || "Plan A";
            if (!plans[activePlan]) plans[activePlan] = [];
          }
          if (res.tss_schedule_panel_state) {
            panelState = { ...DEFAULT_PANEL, ...res.tss_schedule_panel_state };
          }
          cb && cb();
        }
      );
    } catch (e) {
      cb && cb();
    }
  }

  // ---------- 6. Message listener ----------
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "tss-schedule-ext" || msg.type !== "events") return;
    ingestEvents(msg.payload);
  });

  // ---------- 7. UI ----------
  function applyPanelGeometry(panelEl) {
    panelEl.style.top = panelState.top + "px";
    if (panelState.left != null) {
      panelEl.style.left = panelState.left + "px";
      panelEl.style.right = "auto";
    } else {
      panelEl.style.right = panelState.right + "px";
      panelEl.style.left = "auto";
    }
    panelEl.style.width = panelState.width + "px";
    panelEl.style.height = panelState.height + "px";
    panelEl.classList.toggle("collapsed", !!panelState.collapsed);
  }

  function makeDraggable(panelEl, handleEl) {
    let dragging = false;
    let startX, startY, startLeft, startTop;

    handleEl.addEventListener("mousedown", (e) => {
      if (e.target.closest("button, select")) return; // don't drag when clicking controls
      dragging = true;
      const rect = panelEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panelState.left = Math.max(0, startLeft + dx);
      panelState.top = Math.max(0, startTop + dy);
      panelEl.style.left = panelState.left + "px";
      panelEl.style.top = panelState.top + "px";
      panelEl.style.right = "auto";
    });

    window.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        persist();
      }
    });
  }

  function makeResizable(panelEl, handleEl) {
    let resizing = false;
    let startX, startY, startW, startH;

    handleEl.addEventListener("mousedown", (e) => {
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = panelEl.offsetWidth;
      startH = panelEl.offsetHeight;
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener("mousemove", (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panelState.width = Math.max(480, startW + dx);
      panelState.height = Math.max(320, startH + dy);
      panelEl.style.width = panelState.width + "px";
      panelEl.style.height = panelState.height + "px";
    });

    window.addEventListener("mouseup", () => {
      if (resizing) {
        resizing = false;
        persist();
      }
    });
  }

  function buildPanelSkeleton() {
    const wrap = document.createElement("div");
    wrap.id = "tss-sched-ext-root";
    wrap.innerHTML = `
      <button id="tss-sched-toggle" title="Toggle schedule builder">📅 Schedule</button>
      <div id="tss-sched-panel" class="hidden">
        <div class="tss-sched-header" id="tss-sched-drag-handle">
          <span>Schedule Builder</span>
          <div class="tss-sched-header-controls">
            <select id="tss-sched-plan-select" title="Switch schedule plan"></select>
            <button id="tss-sched-plan-new" title="New plan">+</button>
            <button id="tss-sched-plan-rename" title="Rename plan">✎</button>
            <button id="tss-sched-plan-delete" title="Delete plan">🗑</button>
            <button id="tss-sched-clear" title="Clear this plan's selections">Clear</button>
            <button id="tss-sched-minimize" title="Minimize">–</button>
            <button id="tss-sched-close" title="Close">✕</button>
          </div>
        </div>
        <div class="tss-sched-body">
          <div id="tss-sched-list" class="tss-sched-list"></div>
          <div id="tss-sched-grid" class="tss-sched-grid"></div>
        </div>
        <div id="tss-sched-resize-handle" title="Drag to resize"></div>
      </div>
    `;
    document.body.appendChild(wrap);

    const panelEl = wrap.querySelector("#tss-sched-panel");
    applyPanelGeometry(panelEl);
    makeDraggable(panelEl, wrap.querySelector("#tss-sched-drag-handle"));
    makeResizable(panelEl, wrap.querySelector("#tss-sched-resize-handle"));

    wrap.querySelector("#tss-sched-toggle").addEventListener("click", () => {
      panelOpen = !panelOpen;
      panelEl.classList.toggle("hidden", !panelOpen);
    });
    wrap.querySelector("#tss-sched-close").addEventListener("click", () => {
      panelOpen = false;
      panelEl.classList.add("hidden");
    });
    wrap.querySelector("#tss-sched-minimize").addEventListener("click", () => {
      panelState.collapsed = !panelState.collapsed;
      panelEl.classList.toggle("collapsed", panelState.collapsed);
      persist();
    });
    wrap.querySelector("#tss-sched-clear").addEventListener("click", () => {
      setSelected(new Set());
      persist();
      render();
    });
    wrap.querySelector("#tss-sched-plan-select").addEventListener("change", (e) => {
      activePlan = e.target.value;
      persist();
      render();
    });
    wrap.querySelector("#tss-sched-plan-new").addEventListener("click", () => {
      const name = prompt("Name this new schedule plan:", `Plan ${Object.keys(plans).length + 1}`);
      if (!name) return;
      if (plans[name]) {
        alert("A plan with that name already exists.");
        return;
      }
      plans[name] = [];
      activePlan = name;
      persist();
      render();
    });
    wrap.querySelector("#tss-sched-plan-rename").addEventListener("click", () => {
      const name = prompt("Rename current plan:", activePlan);
      if (!name || name === activePlan) return;
      if (plans[name]) {
        alert("A plan with that name already exists.");
        return;
      }
      plans[name] = plans[activePlan];
      delete plans[activePlan];
      activePlan = name;
      persist();
      render();
    });
    wrap.querySelector("#tss-sched-plan-delete").addEventListener("click", () => {
      const names = Object.keys(plans);
      if (names.length <= 1) {
        alert("You need at least one plan.");
        return;
      }
      if (!confirm(`Delete "${activePlan}"?`)) return;
      delete plans[activePlan];
      activePlan = Object.keys(plans)[0];
      persist();
      render();
    });
  }

  function renderPlanSelector() {
    const sel = document.getElementById("tss-sched-plan-select");
    if (!sel) return;
    sel.innerHTML = Object.keys(plans)
      .map((name) => `<option value="${escapeHtml(name)}" ${name === activePlan ? "selected" : ""}>${escapeHtml(name)}</option>`)
      .join("");
  }

  function renderList() {
      const listEl = document.getElementById("tss-sched-list");
      if (!listEl) return;
      const selected = currentSelected();

      const byCourse = {};
      Object.values(catalog).forEach((sec) => {
        if (!byCourse[sec.courseCode]) byCourse[sec.courseCode] = [];
        byCourse[sec.courseCode].push(sec);
      });

      const courseCodes = Object.keys(byCourse).sort();
      if (courseCodes.length === 0) {
        listEl.innerHTML = `<p class="tss-sched-empty">Open a course's "Class Sections" tab in TSS to see it here. (You don't need to click "Go To Booking" — just viewing sections is enough.)</p>`;
        return;
      }

      listEl.innerHTML = courseCodes
        .map((code) => {
          const sections = byCourse[code].sort((a, b) => a.label.localeCompare(b.label));
          const rows = sections
            .map((sec) => {
              const checked = selected.has(sec.pkgId) ? "checked" : "";
              const methods = Array.from(new Set(sec.meetings.map((m) => m.method))).join("/");
              const days = Array.from(new Set(sec.meetings.flatMap((m) => m.days))).join(",");
              const notesHtml = (sec.notes || [])
                .map((n) => `<span class="tss-sched-row-note">${escapeHtml(n)}</span>`)
                .join("");
              return `
                <label class="tss-sched-row">
                  <input type="checkbox" data-pkg="${escapeHtml(sec.pkgId)}" ${checked} />
                  <span class="tss-sched-row-main">
                    <strong>${escapeHtml(sec.label)}</strong>
                    <span class="tss-sched-row-sub">${escapeHtml(methods)} · ${escapeHtml(days || "TBA")} · ${escapeHtml(sec.seatsAvailable)}/${escapeHtml(sec.seatsLimit)} seats</span>
                    ${notesHtml}
                  </span>
                </label>
              `;
            })
            .join("");

          // Added a remove button (tss-sched-remove-course) next to course header
          return `
            <div class="tss-sched-course">
              <div class="tss-sched-course-header">
                <span class="tss-sched-course-title">${escapeHtml(code)}</span>
                <button class="tss-sched-remove-course" data-course="${escapeHtml(code)}" title="Remove ${escapeHtml(code)}">✕</button>
              </div>
              ${rows}
            </div>
          `;
        })
        .join("");

      // Handle checkbox change
      listEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
        cb.addEventListener("change", (e) => {
          const pkg = e.target.getAttribute("data-pkg");
          const sel = currentSelected();
          if (e.target.checked) sel.add(pkg);
          else sel.delete(pkg);
          setSelected(sel);
          persist();
          render();
        });
      });

      // Handle course delete click
      listEl.querySelectorAll(".tss-sched-remove-course").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const courseCode = e.currentTarget.getAttribute("data-course");
          
          // Remove all sections of this course from catalog & plan selections
          Object.keys(catalog).forEach((pkgId) => {
            if (catalog[pkgId].courseCode === courseCode) {
              delete catalog[pkgId];
              Object.keys(plans).forEach((planName) => {
                plans[planName] = plans[planName].filter((id) => id !== pkgId);
              });
            }
          });

          persist();
          render();
        });
      });
    }

  function renderGrid() {
    const gridEl = document.getElementById("tss-sched-grid");
    if (!gridEl) return;
    const selected = currentSelected();
    const selectedSections = Array.from(selected).map((pkgId) => catalog[pkgId]).filter(Boolean);

    // 1. Calculate minTime & maxTime strictly from selected classes
    let minTime = Infinity;
    let maxTime = -Infinity;

    selectedSections.forEach((sec) => {
      sec.meetings.forEach((m) => {
        if (m.startMin != null && m.endMin != null) {
          minTime = Math.min(minTime, m.startMin);
          maxTime = Math.max(maxTime, m.endMin);
        }
      });
    });

    // Fallback defaults if no classes are selected or times aren't parsed yet
    if (minTime === Infinity || maxTime === -Infinity) {
      minTime = 8 * 60;  // 8:00 AM
      maxTime = 17 * 60; // 5:00 PM
    }

    // 2. Add a 30-minute buffer padding above the earliest start & below the latest end
    // Snap to full hour boundaries
    const dynamicStartMin = Math.max(0, Math.floor((minTime - 30) / 60) * 60);
    const dynamicEndMin = Math.min(24 * 60, Math.ceil((maxTime + 30) / 60) * 60);

    const totalMin = dynamicEndMin - dynamicStartMin;
    
    // 3. Dynamically adjust pxPerMin so short schedules scale vertically and stay readable
    const pxPerMin = Math.max(1.3, 520 / totalMin);
    const gridHeight = totalMin * pxPerMin;

    // 4. Generate Hour Labels
    let hourLabels = "";
    for (let t = dynamicStartMin; t <= dynamicEndMin; t += 60) {
      const top = (t - dynamicStartMin) * pxPerMin;
      const h = Math.floor(t / 60);
      const label = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
      hourLabels += `<div class="tss-sched-hour" style="top:${top}px">${label}</div>`;
    }

    let dayCols = DAY_LABELS.map((d) => `<div class="tss-sched-daycol-label">${d}</div>`).join("");

    let blocks = "";
    let weekendNotes = [];
    let conflictPairs = [];

    // Flatten to per-day-meeting entries
    const perDay = { M: [], Tu: [], W: [], Th: [], F: [] };
    selectedSections.forEach((sec) => {
      sec.meetings.forEach((m) => {
        m.days.forEach((day) => {
          if (!(day in DAY_COLS)) {
            weekendNotes.push(`${sec.label}: meets ${day} ${m.start}-${m.end}`);
            return;
          }
          if (m.startMin == null || m.endMin == null) return;
          perDay[day].push({ sec, m });
        });
      });
    });

    Object.entries(perDay).forEach(([day, entries]) => {
      entries.sort((a, b) => a.m.startMin - b.m.startMin);
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i].m, b = entries[j].m;
          if (a.startMin < b.endMin && b.startMin < a.endMin) {
            entries[i].conflict = true;
            entries[j].conflict = true;
            conflictPairs.push(`${entries[i].sec.label} overlaps ${entries[j].sec.label} on ${day}`);
          }
        }
      }
      entries.forEach(({ sec, m, conflict }) => {
        const col = DAY_COLS[day];
        const color = conflict ? "#d64545" : colorForCourse(sec.courseCode);
        
        const top = Math.max(0, (m.startMin - dynamicStartMin) * pxPerMin);
        const height = Math.max(20, (m.endMin - m.startMin) * pxPerMin);
        
        const method = m.method ? ` (${m.method})` : "";
        const courseTitle = `${sec.courseCode}${method}`;
        const timeRange = `${m.start} - ${m.end}`;
        const location = m.location || "TBA";
        const instructor = m.instructor || "Staff";

        blocks += `
          <div class="tss-sched-block${conflict ? " conflict" : ""}" 
              style="left:calc(${col} * (100% / 5)); width:calc(100% / 5 - 4px); top:${top}px; height:${height}px; background:${color};" 
              title="${escapeHtml(sec.label)} (${escapeHtml(m.method)})\n${escapeHtml(timeRange)}\n${escapeHtml(location)}\n${escapeHtml(instructor)}">
            
            <div class="tss-block-course-line">
              ${escapeHtml(courseTitle)}${conflict ? " ⚠" : ""}
            </div>
            <div class="tss-block-time-line">
              ⏰ ${escapeHtml(timeRange)}
            </div>
            <div class="tss-block-room-line">
              📍 ${escapeHtml(location)}
            </div>
            <div class="tss-block-instructor-line">
              👤 ${escapeHtml(instructor)}
            </div>

          </div>
        `;
      });
    });

    gridEl.innerHTML = `
      <div class="tss-sched-daycols-header">${dayCols}</div>
      <div class="tss-sched-grid-scroll" style="height:${gridHeight}px">
        <div class="tss-sched-hours">${hourLabels}</div>
        <div class="tss-sched-columns">${blocks}</div>
      </div>
      ${conflictPairs.length ? `<div class="tss-sched-conflict-note">⚠ ${conflictPairs.map(escapeHtml).join("<br>⚠ ")}</div>` : ""}
      ${weekendNotes.length ? `<div class="tss-sched-weekend-note">${weekendNotes.map(escapeHtml).join("<br>")}</div>` : ""}
    `;
  }

  function render() {
    if (!document.getElementById("tss-sched-ext-root")) {
      buildPanelSkeleton();
    }
    renderPlanSelector();
    renderList();
    renderGrid();
  }

  // ---------- 8. Boot ----------
  function boot() {
    loadPersisted(render);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
