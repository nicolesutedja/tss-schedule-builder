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

  // ---------- 4. Ingest captured events into catalog ----------
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
      /* ignore extension reload errors */
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
          "tss_schedule_selected",
        ],
        (res) => {
          if (res.tss_schedule_catalog) catalog = res.tss_schedule_catalog;
          if (res.tss_schedule_plans) {
            plans = res.tss_schedule_plans;
          } else if (res.tss_schedule_selected) {
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
      if (e.target.closest("button, select")) return;
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
          <span>Schedule Builder TEST</span>
          <div class="tss-sched-header-controls">
            <select id="tss-sched-plan-select" title="Switch schedule plan"></select>
            <button id="tss-sched-plan-new" title="New plan">+</button>
            <button id="tss-sched-plan-rename" title="Rename plan">✎</button>
            <button id="tss-sched-plan-delete" title="Delete plan">🗑</button>
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
      listEl.innerHTML = `<p class="tss-sched-empty">Open a course's "Class Sections" tab in TSS to see it here.</p>`;
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

    listEl.querySelectorAll(".tss-sched-remove-course").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const courseCode = e.currentTarget.getAttribute("data-course");
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

    if (minTime === Infinity || maxTime === -Infinity) {
      minTime = 8 * 60;
      maxTime = 17 * 60;
    }

    const dynamicStartMin = Math.max(0, Math.floor((minTime - 30) / 60) * 60);
    const dynamicEndMin = Math.min(24 * 60, Math.ceil((maxTime + 30) / 60) * 60);
    const totalMin = dynamicEndMin - dynamicStartMin;
    const pxPerMin = Math.max(1.3, 520 / totalMin);
    const gridHeight = totalMin * pxPerMin;

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
      <div class="tss-sched-grid-scroll" style="height:${gridHeight}px; --hour-height:${60 * pxPerMin}px;"> 
        <div class="tss-sched-hours">${hourLabels}</div>
        <div class="tss-sched-columns">${blocks}</div>
      </div>
      ${conflictPairs.length ? `<div class="tss-sched-conflict-note">⚠ ${conflictPairs.map(escapeHtml).join("<br>⚠ ")}</div>` : ""}
      ${weekendNotes.length ? `<div class="tss-sched-weekend-note">${weekendNotes.map(escapeHtml).join("<br>")}</div>` : ""}
    `;
    }

  // ---------- 8. Export Helpers ----------
  function generateICS(selectedSections) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TSS Schedule Helper//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];

    const dayMap = {
      'M': 'MO', 'Mon': 'MO', 'Monday': 'MO',
      'T': 'TU', 'Tu': 'TU', 'Tue': 'TU', 'Tuesday': 'TU',
      'W': 'WE', 'Wed': 'WE', 'Wednesday': 'WE',
      'Th': 'TH', 'Thu': 'TH', 'Thursday': 'TH', 'R': 'TH',
      'F': 'FR', 'Fri': 'FR', 'Friday': 'FR',
      'Sa': 'SA', 'Sat': 'SA', 'Saturday': 'SA',
      'Su': 'SU', 'Sun': 'SU', 'Sunday': 'SU'
    };

    function getNextDateForDay(dayCode) {
      const targetDayMap = { 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6, 'SU': 0 };
      const targetDay = targetDayMap[dayCode];
      const today = new Date();
      const result = new Date(today);
      result.setDate(today.getDate() + ((targetDay + 7 - today.getDay()) % 7));
      return result;
    }

    function formatICSDate(date, minutesFromMidnight) {
      const h = Math.floor(minutesFromMidnight / 60);
      const m = minutesFromMidnight % 60;
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const hh = String(h).padStart(2, '0');
      const mi = String(m).padStart(2, '0');
      return `${yyyy}${mm}${dd}T${hh}${mi}00`;
    }

    const nowStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    selectedSections.forEach((sec) => {
      (sec.meetings || []).forEach((m, idx) => {
        const rawDays = Array.isArray(m.days) ? m.days : [m.days];
        const byDays = rawDays.map(d => dayMap[d.trim()]).filter(Boolean);

        if (byDays.length === 0 || m.startMin == null || m.endMin == null) return;

        const firstDate = getNextDateForDay(byDays[0]);
        const dtStart = formatICSDate(firstDate, m.startMin);
        const dtEnd = formatICSDate(firstDate, m.endMin);

        // Matches the exact title format from your schedule grid blocks
        const methodStr = m.method ? ` (${m.method})` : '';
        const cleanSummary = `${sec.courseCode}${methodStr}`;

        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${sec.pkgId || Math.random().toString(36).substring(2)}-${idx}@tss-helper`);
        lines.push(`DTSTAMP:${nowStamp}`);
        lines.push(`DTSTART:${dtStart}`);
        lines.push(`DTEND:${dtEnd}`);
        lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${byDays.join(',')}`);
        lines.push(`SUMMARY:${cleanSummary}`);
        lines.push(`LOCATION:${m.location || 'TBA'}`);
        lines.push(`DESCRIPTION:Section: ${sec.label || ''}\\nInstructor: ${m.instructor || 'TBA'}\\nSeats: ${sec.seatsAvailable || 0}/${sec.seatsLimit || 0}`);
        lines.push('END:VEVENT');
      });
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function downloadFile(content, fileName, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }
    
  function exportCalendarToPDF() {
    const gridEl = document.querySelector('.tss-sched-grid-scroll');
    const dayHeaderEl = document.querySelector('.tss-sched-daycols-header');

    if (!gridEl) {
      alert('No schedule calendar available to export.');
      return;
    }

    // Preserve computed background colors from live calendar blocks
    const originalBlocks = gridEl.querySelectorAll('.tss-sched-block');
    const clonedGrid = gridEl.cloneNode(true);
    const clonedBlocks = clonedGrid.querySelectorAll('.tss-sched-block');

    originalBlocks.forEach((origBlock, index) => {
      if (clonedBlocks[index]) {
        const computedBg = window.getComputedStyle(origBlock).backgroundColor;
        clonedBlocks[index].style.setProperty('background-color', computedBg, 'important');
      }
    });

    const appStyles = Array.from(
      document.querySelectorAll('style, link[rel="stylesheet"]')
    )
      .map(s => s.outerHTML)
      .join('\n');

    const iframe = document.createElement('iframe');

    Object.assign(iframe.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
      visibility: 'hidden'
    });

    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    const clonedHeader = dayHeaderEl ? dayHeaderEl.cloneNode(true) : null;

    doc.open();

    doc.write(`
  <!DOCTYPE html>
  <html>
  <head>
  <title>${escapeHtml(activePlan)}-Schedule</title>
  ${appStyles}
  <link rel="stylesheet" href="pdf-print.css">
  </head>

  <body>
  <div class="tss-pdf-container">
    <div class="tss-pdf-header">
      <h1>Weekly Schedule — ${escapeHtml(activePlan)}</h1>
      <p>Generated: ${new Date().toLocaleDateString()}</p>
    </div>
  </div>
  </body>
  </html>
  `);

    doc.close();

    const container = doc.querySelector('.tss-pdf-container');

    if (clonedHeader) {
      container.appendChild(clonedHeader);
    }

    container.appendChild(clonedGrid);

    iframe.onload = async () => {
      if (iframe.contentDocument.fonts) {
        await iframe.contentDocument.fonts.ready;
      }

      requestAnimationFrame(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();

        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      });
    };
  }

  function setupExportControls() {
    const headerEl = document.querySelector('.tss-sched-header');
    if (!headerEl || document.getElementById('tss-sched-export-group')) return;

    const exportGroup = document.createElement('div');
    exportGroup.className = 'tss-export-group';
    exportGroup.id = 'tss-sched-export-group';
    exportGroup.innerHTML = `
      <button class="tss-header-btn" id="tss-export-ics" title="Export to Calendar (.ics)">
        📅 ICS
      </button>
      <button class="tss-header-btn" id="tss-export-pdf" title="Export as PDF">
        📄 PDF
      </button>
    `;

    headerEl.querySelector('.tss-sched-header-controls').prepend(exportGroup);

    // Direct ICS Export
    document.getElementById('tss-export-ics').addEventListener('click', () => {
      const selected = currentSelected();
      const activeSections = Object.values(catalog).filter(sec => selected.has(sec.pkgId));
      if (activeSections.length === 0) {
        alert('No classes selected in active schedule to export.');
        return;
      }
      const icsContent = generateICS(activeSections);
      downloadFile(icsContent, `schedule-${activePlan.toLowerCase().replace(/\s+/g, '-')}.ics`, 'text/calendar;charset=utf-8;');
    });

    // Direct PDF Export
    document.getElementById('tss-export-pdf').addEventListener('click', () => {
      exportCalendarToPDF();
    });
  }

  function render() {
    if (!document.getElementById("tss-sched-ext-root")) {
      buildPanelSkeleton();
    }
    setupExportControls();
    renderPlanSelector();
    renderList();
    renderGrid();
  }

  // ---------- 9. Boot ----------
  function boot() {
    loadPersisted(render);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();