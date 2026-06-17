// =====================================================
// AUTOZUK — UI layer
// =====================================================

function htmlEscape(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function editorNumber(id, fallback = 99) {
  let value = Number(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}
function getSelectedGear() {
  let gear = {};
  for (let slot of GEAR_SLOTS) {
    let input = document.getElementById("gear-slot-" + slot);
    gear[slot] = input?.value.trim() || "";
  }
  return gear;
}
function populateGearStaticControls() {
  let prayer = document.getElementById("gearPrayer"),
    magic = document.getElementById("gearMagicBoost"),
    def = document.getElementById("gearDefBoost");
  if (prayer && !prayer.options.length)
    for (let [key, value] of Object.entries(GEAR_PRAYERS)) {
      let option = document.createElement("option");
      option.value = key;
      option.textContent = value.name;
      prayer.appendChild(option);
    }
  if (magic && !magic.options.length)
    for (let [key, value] of Object.entries(MAGIC_BOOSTS)) {
      let option = document.createElement("option");
      option.value = key;
      option.textContent = value.name;
      magic.appendChild(option);
    }
  if (def && !def.options.length)
    for (let [key, value] of Object.entries(DEF_BOOSTS)) {
      let option = document.createElement("option");
      option.value = key;
      option.textContent = value.name;
      def.appendChild(option);
    }
  renderGearSlots();
}
function renderGearSlots() {
  let container = document.getElementById("gearSlots");
  if (!container) return;
  if (container.childNodes.length === 0) {
    for (let slot of GEAR_SLOTS) {
      let field = document.createElement("div");
      field.className = "gear-field" + (slot === "weapon" ? " weapon-slot" : "");
      let label = document.createElement("label");
      label.textContent = GEAR_LABELS[slot];
      let input = document.createElement("input");
      input.id = "gear-slot-" + slot;
      input.type = "text";
      input.placeholder = "None";
      input.setAttribute("list", "wiki-slot-" + slot);
      input.addEventListener("input", () => {
        if (!isRenderingGear) recalculateGearDraft();
      });
      let list = document.createElement("datalist");
      list.id = "wiki-slot-" + slot;
      field.append(label, input, list);
      container.appendChild(field);
    }
  }
  if (!wikiEquipment.length) return;
  for (let slot of GEAR_SLOTS) {
    let list = document.getElementById("wiki-slot-" + slot);
    if (!list) continue;
    list.innerHTML = "";
    let fragment = document.createDocumentFragment();
    for (let item of wikiEquipment.filter((i) => i.slot === slot)) {
      let option = document.createElement("option");
      option.value = wikiItemLabel(item);
      fragment.appendChild(option);
    }
    list.appendChild(fragment);
  }
}
function validateGearAgainstWiki(config) {
  if (!wikiEquipment.length) return;
  for (let slot of GEAR_SLOTS) {
    let label = config.gear?.[slot];
    if (label && !resolveWikiItem(label)) config.gear[slot] = "";
  }
}
async function loadWikiGearData() {
  if (wikiEquipment.length) {
    renderGearSlots();
    recalculateGearDraft();
    return;
  }
  if (wikiLoadStarted) return;
  wikiLoadStarted = true;
  try {
    let data = window.autozukDesktop?.getWikiEquipment
      ? await window.autozukDesktop.getWikiEquipment()
      : await fetch(WIKI_EQUIPMENT_URL).then((response) => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        });
    wikiEquipment = (Array.isArray(data) ? data : Object.values(data || {})).filter(
      (item) => item?.name && GEAR_SLOTS.includes(item.slot),
    );
    wikiEquipment.sort((a, b) => wikiItemLabel(a).localeCompare(wikiItemLabel(b)));
    for (let key in gearConfigs) validateGearAgainstWiki(gearConfigs[key]);
    renderGearSlots();
    renderGearDraft(currentLoadoutKey);
  } catch (error) {
    wikiLoadStarted = false;
    renderGearStatsPanel(null, error.message);
  }
}
function getEditorGearConfig() {
  return {
    levels: {
      magic: clampStat(editorNumber("gearLvlMagic", 99)),
      def: clampStat(editorNumber("gearLvlDef", 99)),
      hp: clampHp(editorNumber("gearLvlHp", 99)),
    },
    prayer: document.getElementById("gearPrayer")?.value || "augury",
    magicBoost: document.getElementById("gearMagicBoost")?.value || "none",
    defBoost: document.getElementById("gearDefBoost")?.value || "brew",
    gear: getSelectedGear(),
  };
}
function renderGearDraft(key = currentLoadoutKey) {
  let config =
    gearConfigs[key] || cloneGearConfig(DEFAULT_GEAR_CONFIGS[key] || DEFAULT_GEAR_CONFIGS.ayak);
  gearConfigs[key] = config;
  isRenderingGear = true;
  let magic = document.getElementById("gearLvlMagic"),
    def = document.getElementById("gearLvlDef"),
    hp = document.getElementById("gearLvlHp"),
    prayer = document.getElementById("gearPrayer"),
    magicBoost = document.getElementById("gearMagicBoost"),
    defBoost = document.getElementById("gearDefBoost");
  if (magic) magic.value = config.levels?.magic ?? 99;
  if (def) def.value = config.levels?.def ?? 99;
  if (hp) hp.value = config.levels?.hp ?? 99;
  if (prayer) prayer.value = config.prayer || "augury";
  if (magicBoost) magicBoost.value = config.magicBoost || "none";
  if (defBoost) defBoost.value = config.defBoost || "brew";
  for (let slot of GEAR_SLOTS) {
    let input = document.getElementById("gear-slot-" + slot);
    if (input) input.value = config.gear?.[slot] || "";
  }
  isRenderingGear = false;
  recalculateGearDraft();
}
function recalculateGearDraft() {
  if (isRenderingGear) return;
  if (!document.getElementById("gearStatsPanel")) return;
  let config = syncSharedGearConfig(currentLoadoutKey, getEditorGearConfig());
  let magicCurrent = document.getElementById("gearCurrentMagic"),
    defCurrent = document.getElementById("gearCurrentDef");
  if (magicCurrent)
    magicCurrent.textContent = currentMagicLevel(config.levels.magic, config.magicBoost);
  if (defCurrent) defCurrent.textContent = currentDefLevel(config.levels.def, config.defBoost);
  try {
    gearDraftStats = calculateGearDraft(config, currentLoadoutKey);
    renderGearStatsPanel(gearDraftStats);
  } catch (error) {
    gearDraftStats = null;
    renderGearStatsPanel(null, error.message);
  }
}
function renderGearStatsPanel(draft, errorMessage) {
  let panel = document.getElementById("gearStatsPanel");
  if (!panel) return;
  let loadout = LOADOUTS[currentLoadoutKey] || LOADOUTS.ayak;
  renderSpecialEffects(draft);
  let title = errorMessage
    ? `<div class="gear-note" style="color:#ff7777">${htmlEscape(errorMessage)}</div>`
    : "";
  if (!draft) {
    panel.innerHTML = title;
    return;
  }
  let liveMaxHit = loadout.maxHit || 0;
  let maxHitRow = `<span>Max Hit</span><input id="draft-max-hit" type="number" min="0" max="200" step="1" value="${Math.max(0, Math.round(draft.maxHit || 0))}"><span class="live">${liveMaxHit}</span>`;
  let playerRows = PLAYER_ACCURACY_TARGETS.map((type) => {
    let values = draft.playerAcc[type] || [0, 0],
      live = loadout.playerAcc[type] || [0, 0];
    return `<span>${PLAYER_ACCURACY_LABELS[type]}</span><input id="draft-player-${type}-hit" type="number" min="0" max="100" step="0.01" value="${formatPctInput(values[0])}"><input id="draft-player-${type}-miss" type="number" min="0" max="100" step="0.01" value="${formatPctInput(values[1])}"><span class="live">${formatPctDisplay(live[0])} / ${formatPctDisplay(live[1])}</span>`;
  }).join("");
  let monsterRows = INCOMING_ACCURACY_ROWS.map((row) => {
    let draftValue = draft.monsterAcc[row.id] || 0,
      liveValue = getLiveIncomingAcc(loadout, row);
    return `<span>${row.label}</span><input id="draft-monster-${row.id}" type="number" min="0" max="100" step="0.01" value="${formatPctInput(draftValue)}"><span class="live">${formatPctDisplay(liveValue)}</span>`;
  }).join("");
  let warning = draft.warnings.length
    ? `<div class="gear-note" style="color:#ffb86b">${draft.warnings.map(htmlEscape).join("<br>")}</div>`
    : "";
  panel.innerHTML = `${title}
    <h3>Damage</h3>
    <div class="stat-table monster"><span class="head">Value</span><span class="head">Draft</span><span class="head live">Live</span>${maxHitRow}</div>
    <h3>Player Accuracy</h3>
    <div class="stat-table"><span class="head">Target</span><span class="head">Draft Hit</span><span class="head">Draft Miss</span><span class="head live">Live</span>${playerRows}</div>
    <h3>Incoming Accuracy</h3>
    <div class="stat-table monster"><span class="head">Enemy</span><span class="head">Draft</span><span class="head live">Live</span>${monsterRows}</div>
    ${warning}`;
}
function renderSpecialEffects(draft) {
  let box = document.getElementById("gearSpecialEffects");
  if (!box) return;
  let effects = draft?.special?.effects || draft?.recoil?.effects || [];
  if (!effects.length) {
    box.textContent = "No active special effects.";
    return;
  }
  box.innerHTML = effects.map((effect) => `<div>${htmlEscape(effect)}</div>`).join("");
}
function collectDraftStatsFromInputs() {
  if (!gearDraftStats) return null;
  let draft = JSON.parse(JSON.stringify(gearDraftStats));
  draft.maxHit = Math.max(
    0,
    Math.round(Number(document.getElementById("draft-max-hit")?.value) || draft.maxHit || 0),
  );
  for (let type of PLAYER_ACCURACY_TARGETS) {
    draft.playerAcc[type] = [
      parsePctInput(`draft-player-${type}-hit`, draft.playerAcc[type]?.[0]),
      parsePctInput(`draft-player-${type}-miss`, draft.playerAcc[type]?.[1]),
    ];
  }
  for (let row of INCOMING_ACCURACY_ROWS)
    draft.monsterAcc[row.id] = parsePctInput(`draft-monster-${row.id}`, draft.monsterAcc[row.id]);
  return draft;
}
function applyGearStats() {
  let draft = collectDraftStatsFromInputs(),
    status = document.getElementById("gearStatus");
  if (!draft) {
    if (status) status.textContent = "No draft stats ready yet.";
    return;
  }
  let loadout = LOADOUTS[currentLoadoutKey] || LOADOUTS.ayak;
  for (let type of PLAYER_ACCURACY_TARGETS)
    loadout.playerAcc[type] = [
      clamp01(draft.playerAcc[type][0]),
      clamp01(draft.playerAcc[type][1]),
    ];
  for (let row of INCOMING_ACCURACY_ROWS)
    setLiveIncomingAcc(loadout, row, draft.monsterAcc[row.id]);
  loadout.maxHit = Math.max(0, Math.round(draft.maxHit || loadout.maxHit || 0));
  loadout.startingHp = clampHp(draft.config?.levels?.hp || loadout.startingHp || 99);
  loadout.hasRingRecoil = !!draft.recoil.hasRingRecoil;
  loadout.hasEchoBoots = !!draft.recoil.hasEchoBoots;
  loadout.hasRecoil = loadout.hasRingRecoil || loadout.hasEchoBoots;
  loadout.hasBloodSceptre = !!draft.special?.hasBloodSceptre;
  currentLoadout = loadout;
  gearDraftStats = draft;
  renderGearStatsPanel(draft);
  updateActiveLoadoutSummary();
  if (sim) {
    resetSim();
    setStatus(
      "Gear stats updated; manual simulation reset to avoid mixing old and new rolls.",
      "info",
    );
  }
  if (status) status.textContent = "Live AUTOZUK values updated";
}
function openEquipmentSelector() {
  populateGearStaticControls();
  document.getElementById("gearModal")?.classList.add("open");
  currentLoadout = LOADOUTS[currentLoadoutKey] || LOADOUTS.ayak;
  renderGearDraft(currentLoadoutKey);
  loadWikiGearData();
}
function closeEquipmentSelector() {
  document.getElementById("gearModal")?.classList.remove("open");
}
function updateActiveLoadoutSummary() {
  let select = document.getElementById("activeLoadoutSelect");
  if (select) select.value = currentLoadoutKey;
}
function initializeEquipmentSelector() {
  populateGearStaticControls();
  updateActiveLoadoutSummary();
  let modal = document.getElementById("gearModal");
  if (modal)
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeEquipmentSelector();
    });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("gearModal")?.classList.contains("open"))
      closeEquipmentSelector();
  });
}
function toggleLegend() {
  let popup = document.getElementById("legendPopup");
  let btn = document.getElementById("legendBtn");
  if (btn.style.display !== "none") {
    btn.style.display = "none";
    let content = document.createElement("div");
    content.className = "legend-content";
    content.id = "legendContent";
    content.onclick = toggleLegend;
    content.innerHTML = `
      <div class="legend-item"><div class="legend-swatch" style="background:var(--mager-color)">M</div>Mager</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--ranger-color)">R</div>Ranger</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--meleer-color);border:1px solid #888">X</div>Meleer</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--blob-color)">B</div>Blob</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--bat-color)">Y</div>Bat</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--nibbler-color)">N</div>Nibbler</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--bloblet-mage)">a</div>Bloblet-M</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--bloblet-range)">b</div>Bloblet-R</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--bloblet-melee)">c</div>Bloblet-X</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--player-color)">P</div>Player</div>`;
    popup.appendChild(content);
  } else {
    btn.style.display = "";
    let content = document.getElementById("legendContent");
    if (content) content.remove();
  }
}
function updatePrayerStrip() {
  let strip = document.getElementById("prayerStrip");
  let seq = activePrayerSeq;
  if (!seq && playerPlacement) {
    let pk = `${playerPlacement.x},${playerPlacement.y}`;
    if (autozukResults[pk]) seq = autozukResults[pk].prayer;
  }
  if (!seq) {
    strip.style.display = "none";
    return;
  }
  strip.style.display = "flex";
  let displayOrder = [1, 2, 3, 0],
    labels = ["START", "T1", "T2", "T3"];
  let prayColors = { mage: "#4488ff", range: "#44cc44", melee: "#888" };
  let html = "";
  for (let i = 0; i < 4; i++) {
    let p = seq[displayOrder[i]];
    html += `<div style="display:flex;flex-direction:column;align-items:center;gap:1px"><img src="${PRAYER_IMG_DATA[p]}" style="width:20px;height:20px;image-rendering:pixelated"><span style="font-size:7px;font-weight:700;color:${prayColors[p]};letter-spacing:0.5px">${labels[i]}</span></div>`;
  }
  strip.innerHTML = html;
}
// ===== UI UPDATES =====
function syncStatusBox() {
  let statusBox = document.getElementById("statusBox");
  if (statusBox) statusBox.style.display = sim && sim.tick >= 1 ? "" : "none";
}
function updateUI() {
  document.getElementById("tickDisplay").innerHTML = `<span>TICK</span><br>${sim ? sim.tick : "—"}`;
  syncStatusBox();
  // Player status
  if (sim) {
    let p = sim.player;
    let isDead = p.hp !== undefined && p.hp <= 0;
    let hpColor = isDead ? "#ff4444" : p.hp > 66 ? "#00ff00" : p.hp > 33 ? "#ffff00" : "#ff4444";
    let hpText = isDead
      ? "\u2620 / " + (p.maxHp || 99)
      : (p.hp !== undefined ? p.hp : 99) + "/" + (p.maxHp || 99);
    let prayInfo = "";
    {
      let pray = getEffectivePrayerForTick(sim.tick);
      if (pray) {
        let pn = { mage: "Mage", range: "Range", melee: "Melee" };
        prayInfo = ` | Prayer: ${pn[pray] || "?"}`;
      }
    }
    document.getElementById("playerStatus").innerHTML =
      `<div class="mob-info-row"><span class="name" style="color:#bb88ff">P Player</span><span class="hp" style="color:${hpColor}">${hpText}</span><span class="pos">(${p.x},${p.y})${prayInfo}</span></div>`;
  } else {
    document.getElementById("playerStatus").innerHTML = "No simulation loaded";
  }
  let html = "";
  if (sim) {
    let alive = sim.mobs.filter((m) => !m.dead && m.dying <= 0);
    for (let m of alive)
      html += `<div class="mob-info-row"><span class="name" style="color:${isDarkColor(m.color) ? "#aaa" : m.color}">${m.letter} #${m.id}</span><span class="hp">${m.hp}/${m.maxHp}</span><span class="pos">(${m.x},${m.y})</span></div>`;
  }
  document.getElementById("mobInfo").innerHTML = html || "No mobs alive";
  updateTickGrid();
  updateEventList();
  render();
}
function rebuildTickGridHeader() {
  let html = '<tr><th class="tick-col">T</th>';
  if (practiceState.open)
    html += '<th class="mob-col practice-you-col" title="Your active prayer">YOU</th>';
  for (let col of gridMobColumns) {
    let tc = isDarkColor(col.color) ? "#fff" : "#000";
    html += `<th class="mob-col"><span class="mob-col-badge" style="background:${col.color};color:${tc}">${col.letter}</span></th>`;
  }
  html += "</tr>";
  document.getElementById("tickGridHead").innerHTML = html;
  document.getElementById("tickGridBody").innerHTML = "";
}
function updateTickGrid() {
  if (!sim) return;
  let currentTick = sim.tick,
    tbody = document.getElementById("tickGridBody");
  let hitCount = 0;
  for (let t in tickHits) hitCount += tickHits[t].length;
  document.getElementById("tickGridCount").textContent = `${hitCount} hits`;
  let startT = sim.startTick || 0;
  if (tbody.rows.length) {
    let lastTick = parseInt(tbody.rows[tbody.rows.length - 1].dataset.tick, 10);
    startT = isNaN(lastTick) ? startT : lastTick + 1;
  }
  for (let t = startT; t <= currentTick; t++) {
    let tr = document.createElement("tr");
    tr.dataset.tick = t;
    let tdTick = document.createElement("td");
    tdTick.className = "tick-col";
    // Prayer icon + tick number — show if tile has an AUTOZUK prayer solution
    let praySeq = activePrayerSeq;
    if (!praySeq && playerPlacement) {
      let pk = `${playerPlacement.x},${playerPlacement.y}`;
      if (autozukResults[pk]) praySeq = autozukResults[pk].prayer;
    }
    if (praySeq && (!practiceState.open || t >= 16)) {
      let pray = praySeq[solutionPrayerIndexForTick(t)];
      let src = PRAYER_IMG_DATA[pray];
      if (src) {
        let img = document.createElement("img");
        img.src = src;
        img.style.cssText =
          "width:12px;height:12px;vertical-align:middle;margin-right:2px;image-rendering:pixelated";
        tdTick.appendChild(img);
      }
    }
    tdTick.appendChild(document.createTextNode(t));
    tr.appendChild(tdTick);
    if (practiceState.open) {
      let tdPractice = document.createElement("td");
      tdPractice.className = "practice-prayer-cell";
      let actual = practicePrayerForTick(t),
        expected = expectedPracticePrayerForTick(t);
      if (actual) tdPractice.innerHTML = practiceGridIcon(actual);
      else {
        tdPractice.textContent = "-";
        tdPractice.classList.add("waiting");
      }
      if (expected) {
        tdPractice.classList.add(actual === expected ? "correct" : "incorrect");
        tdPractice.title = actual === expected ? "Correct prayer" : "Missed prayer";
      }
      tr.appendChild(tdPractice);
    }
    for (let col of gridMobColumns) {
      let td = document.createElement("td");
      let hits = (tickHits[t] || []).filter((h) => h.mobId === col.id);
      for (let h of hits) {
        let block = document.createElement("span");
        block.className = "hit-block" + (h.isScan ? " scan" : "");
        block.style.background = h.color;
        // Color red if off-prayer
        if (!h.isScan && h.style) {
          let pray = practiceState.open ? getEffectivePrayerForTick(t) : null;
          if (!practiceState.open) {
            let usePraySeq = activePrayerSeq;
            if (!usePraySeq && playerPlacement) {
              let pk = `${playerPlacement.x},${playerPlacement.y}`;
              if (autozukResults[pk]) usePraySeq = autozukResults[pk].prayer;
            }
            if (usePraySeq) pray = usePraySeq[solutionPrayerIndexForTick(t)];
          }
          if ((practiceState.open && practiceState.solution) || (!practiceState.open && pray)) {
            let blocked =
              (h.style === "magic" && pray === "mage") ||
              (h.style === "range" && pray === "range") ||
              (h.style === "melee" && pray === "melee");
            if (!blocked) {
              block.style.background = "#ff2222";
              block.style.boxShadow = "0 0 3px #ff0000";
              block.title = "OFF PRAYER: " + h.style + " vs protect " + (pray || "none");
            }
          }
        }
        td.appendChild(block);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  for (let row of tbody.rows) row.classList.remove("current-tick");
  let currentRow = Array.from(tbody.rows).find(
    (row) => parseInt(row.dataset.tick, 10) === currentTick,
  );
  if (currentRow) currentRow.classList.add("current-tick");
  let wrapper = document.getElementById("tickGridWrapper");
  if (!tickGridUserScrolled) wrapper.scrollTop = wrapper.scrollHeight;
}
function updateEventList() {
  let container = document.getElementById("eventListBody");
  let events = tickEvents.filter((e) => e.isHit || e.isScan || e.isPlayerAttack || e.isResurrect);
  document.getElementById("eventCount").textContent = `${events.length} events`;
  if (events.length === 0) {
    container.innerHTML =
      '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">No events yet</div>';
    return;
  }
  let html = "";
  for (let e of events) {
    let bc = e.type;
    if (bc === "blobletMage") bc = "bloblet-mage";
    if (bc === "blobletRange") bc = "bloblet-range";
    if (bc === "blobletMelee") bc = "bloblet-melee";
    if (bc === "player-atk") bc = "player-atk";
    html += `<div class="tick-entry${e.isScan ? " scan" : ""}"><span class="tick-num">T${e.tick}</span><span class="tick-badge ${bc}">${MOB_DEFS[e.type]?.letter || "P"}</span><span class="tick-detail">${e.detail}</span></div>`;
  }
  container.innerHTML = html;
  let wrapper = document.getElementById("eventListBody");
  if (!eventListUserScrolled) wrapper.scrollTop = wrapper.scrollHeight;
}
function setStatus(msg, type) {}
function showSpawnCodeError() {
  let el = document.getElementById("spawnCodeError"),
    input = document.getElementById("spawnCode");
  if (el) {
    el.textContent = "Input wave code or click dice button";
    el.classList.add("show");
  }
  if (input) {
    input.classList.add("input-error");
    input.focus();
  }
}
function clearSpawnCodeError() {
  document.getElementById("spawnCodeError")?.classList.remove("show");
  document.getElementById("spawnCode")?.classList.remove("input-error");
}
// ===== SCROLL/RESIZE =====
function initScrollResizeHandlers() {
  document.getElementById("tickGridWrapper").addEventListener("scroll", function () {
    tickGridUserScrolled = this.scrollHeight - this.scrollTop - this.clientHeight > 30;
  });
  document.getElementById("eventListBody").addEventListener("scroll", function () {
    eventListUserScrolled = this.scrollHeight - this.scrollTop - this.clientHeight > 30;
  });
  (function () {
    let handle = document.getElementById("resizeHandle"),
      section = document.getElementById("eventlistSection"),
      dragging = false,
      startY,
      startH;
    handle.addEventListener("mousedown", function (e) {
      dragging = true;
      startY = e.clientY;
      startH = section.offsetHeight;
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      section.style.height = Math.max(80, Math.min(500, startH + startY - e.clientY)) + "px";
    });
    document.addEventListener("mouseup", function () {
      if (dragging) {
        dragging = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    });
  })();
}
// ===== EVENT HANDLERS =====
function initEventHandlers() {
  window.addEventListener("resize", resizeCanvas);
  canvas.addEventListener("click", function (e) {
    let rect = canvas.getBoundingClientRect();
    let gx, gy;
    if (facingSouth) {
      gx = ARENA_X_MAX - Math.floor((e.clientX - rect.left) / TILE_SIZE);
      gy = ARENA_Y_MAX - Math.floor((e.clientY - rect.top) / TILE_SIZE);
    } else {
      gx = Math.floor((e.clientX - rect.left) / TILE_SIZE) + ARENA_X_MIN;
      gy = Math.floor((e.clientY - rect.top) / TILE_SIZE) + ARENA_Y_MIN;
    }
    if (gx < ARENA_X_MIN || gx > ARENA_X_MAX || gy < ARENA_Y_MIN || gy > ARENA_Y_MAX) return;
    // Always set player placement
    playerPlacement = { x: gx, y: gy };
    if (autozukMode && !autozukRunning) {
      let key = `${gx},${gy}`;
      if (autozukResults[key]) {
        selectedTile = { x: gx, y: gy };
        activePrayerSeq = autozukResults[key].prayer;
        showTileDetail(gx, gy);
        setStatus(`Player placed at (${gx}, ${gy}) — click STEP/PLAY to sim`, "info");
        render();
        return;
      } else if (excludedTiles.has(key)) {
        setStatus(`Player placed at (${gx}, ${gy}) — excluded tile`, "info");
        render();
        return;
      }
    }
    setStatus(`Player placed at (${gx}, ${gy})`, "info");
    render();
  });
}

function togglePillar(key) {
  pillars[key] = !pillars[key];
  document.getElementById("pillar" + key).classList.toggle("active");
  updatePreview();
  render();
}
function updatePreview() {
  let code = document.getElementById("spawnCode").value;
  previewMobs = [];
  if (!code.trim()) {
    render();
    return;
  }
  let parsed = parseSpawnCode(code);
  if (parsed.error) {
    render();
    return;
  }
  for (let spawn of parsed.spawns) {
    if (spawn.type === "nothing") continue;
    let d = MOB_DEFS[spawn.type];
    previewMobs.push({
      x: spawn.x,
      y: spawn.y,
      size: d.size,
      color: d.color,
      letter: d.letter,
      type: spawn.type,
    });
  }
  render();
}
function changeLoadout(key) {
  currentLoadoutKey = key || currentLoadoutKey;
  currentLoadout = LOADOUTS[currentLoadoutKey] || LOADOUTS.ayak;
  updateActiveLoadoutSummary();
  if (document.getElementById("gearModal")?.classList.contains("open"))
    renderGearDraft(currentLoadoutKey);
}
function pasteSpawnCode() {
  navigator.clipboard
    .readText()
    .then((text) => {
      text = text.trim();
      // Strip digits to count mob chars, validate 9 positions with optional index digits
      let stripped = text.replace(/[1-9]/g, "");
      if (
        stripped.length === 9 &&
        /^[MRXBYOmrxbyo]{9}$/i.test(stripped) &&
        text.length <= 18 &&
        /^[MRXBYOmrxbyo1-9]+$/i.test(text)
      ) {
        document.getElementById("spawnCode").value = text.toUpperCase();
        document.getElementById("spawnCode").dispatchEvent(new Event("input"));
      }
    })
    .catch(() => {});
}
function randomSpawnCode() {
  let monsters = ["M", "R"];
  if (Math.random() < 0.5) monsters.push("X");
  let addOns = [["B", "B"], ["B", "Y"], ["B", "Y", "Y"], ["B"]];
  monsters.push(...addOns[Math.floor(Math.random() * addOns.length)]);
  let slots = Array.from({ length: 9 }, (_, i) => i);
  for (let i = slots.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  let codeSlots = Array(9).fill("O");
  for (let i = 0; i < monsters.length; i++) codeSlots[slots[i]] = monsters[i];
  let order = Array.from({ length: monsters.length }, (_, i) => i + 1);
  for (let i = order.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let monsterIndex = 0;
  let code = codeSlots.map((ch) => (ch === "O" ? "O" : ch + order[monsterIndex++])).join("");
  let input = document.getElementById("spawnCode");
  input.value = code;
  input.dispatchEvent(new Event("input"));
}

function resetAutozuk() {
  if (autozukRunning) return;
  if (practiceState.open) closePracticeMode(true);
  stopSolverVisualPreview();
  autozukMode = false;
  autozukResults = {};
  excludedTiles = new Set();
  selectedTile = null;
  activePrayerSeq = null;
  autozukHidden = false;
  document.getElementById("progressFill").style.width = "0%";
  document.getElementById("autozukStatus").textContent = "";
  document.getElementById("detailPanel").classList.add("detail-hidden");
  document.getElementById("liveDetailPanel").style.display = "none";
  document.getElementById("liveFeedPanel").style.display = "none";
  document.getElementById("phase1Panel").style.display = "";
  document.getElementById("eventlistSection").style.display = "";

  document.getElementById("resizeHandle").style.display = "";
  document.getElementById("exportSection").style.display = "";
  document.getElementById("btnHideAZ").textContent = "HIDE";
  document.getElementById("btnHideAZ").style.background = "";
  setStatus("AUTOZUK data cleared", "info");
  render();
}
function toggleHideAutozuk() {
  autozukHidden = !autozukHidden;
  let btn = document.getElementById("btnHideAZ");
  if (autozukHidden) {
    btn.textContent = "SHOW";
    btn.style.background = "var(--accent-dim)";
  } else {
    btn.textContent = "HIDE";
    btn.style.background = "";
  }
  render();
}
function ensureTickGridView() {
  if (!document.getElementById("detailPanel").classList.contains("detail-hidden"))
    closeTileDetail();
}
function initInputHandlers() {
  document.getElementById("speedSlider").addEventListener("input", function () {
    document.getElementById("speedLabel").textContent = `${this.value} t/s`;
    if (playing) {
      clearInterval(playInterval);
      startPlay();
    }
  });
  document.getElementById("spawnCode").addEventListener("input", function () {
    if (practiceState.open) closePracticeMode(true);
    clearSpawnCodeError();
    if (sim) {
      sim = null;
      tickEvents = [];
      tickHits = {};
      gridMobColumns = [];
      tickGridUserScrolled = false;
      eventListUserScrolled = false;
      document.getElementById("tickGridHead").innerHTML = '<tr><th class="tick-col">T</th></tr>';
      document.getElementById("tickGridBody").innerHTML = "";
      document.getElementById("tickGridCount").textContent = "0 hits";
      document.getElementById("eventCount").textContent = "0 events";
      document.getElementById("eventListBody").innerHTML =
        '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">Load a wave to see events</div>';
      document.getElementById("tickDisplay").innerHTML = "<span>TICK</span><br>—";
      syncStatusBox();
    }
    autozukMode = false;
    autozukResults = {};
    excludedTiles = new Set();
    selectedTile = null;
    document.getElementById("detailPanel").classList.add("detail-hidden");
    document.getElementById("phase1Panel").style.display = "";
    updatePreview();
  });
}

// ===== PHASE 2: TILE DETAIL PANEL =====
function showTileDetail(x, y) {
  let key = `${x},${y}`,
    result = autozukResults[key];
  if (!result) {
    document.getElementById("detailPanel").classList.add("detail-hidden");
    return;
  }

  // Switch right panel to detail view
  document.getElementById("phase1Panel").style.display = "none";
  document.getElementById("liveDetailPanel").style.display = "none";
  document.getElementById("eventlistSection").style.display = "none";

  document.getElementById("resizeHandle").style.display = "none";
  let dp = document.getElementById("detailPanel");
  dp.classList.remove("detail-hidden");

  let prayerHtml = '<div class="prayer-sequence">';
  let prayerNames = { mage: "MAGE", range: "RANGE", melee: "MELEE" };
  let displayOrder = [1, 2, 3, 0],
    slotLabels = ["START", "T1", "T2", "T3"];
  for (let i = 0; i < 4; i++) {
    let p = result.prayer[displayOrder[i]];
    prayerHtml += `<div class="prayer-slot ${p}"><div class="slot-num">${slotLabels[i]}</div>${prayerNames[p]}</div>`;
  }
  prayerHtml += "</div>";

  let dmgClass = result.avgDamage < 15 ? "good" : result.avgDamage < 30 ? "warn" : "bad";
  let o50Class = result.over50Pct < 10 ? "good" : result.over50Pct < 30 ? "warn" : "bad";
  let scoreLabel = currentLoadout.isBloodBarrage ? "Avg Max HP Deficit" : "Avg Damage";
  let over50Label = currentLoadout.isBloodBarrage ? "Runs > 50 deficit" : "Runs > 50 dmg";
  let scoreLabelClass = currentLoadout.isBloodBarrage ? "" : " score-active";
  let deathLabelClass = currentLoadout.isBloodBarrage ? " score-active" : "";
  let deathRateRow =
    result.deathPct !== undefined
      ? `<div class="detail-stat"><span class="label${deathLabelClass}">Death Rate</span><span class="value ${result.deathPct > 30 ? "bad" : result.deathPct > 10 ? "warn" : "good"}">${result.deathPct.toFixed(1)}%</span></div>`
      : "";

  dp.innerHTML = `
    <h3>Tile (${x}, ${y})</h3>
    <div style="margin-bottom:8px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Prayer Sequence (repeating)</label></div>
    ${prayerHtml}
    <div class="detail-stat"><span class="label${scoreLabelClass}">${scoreLabel}</span><span class="value ${dmgClass}">${result.avgDamage.toFixed(1)}</span></div>
    <div class="detail-stat"><span class="label">${over50Label}</span><span class="value ${o50Class}">${result.over50Pct.toFixed(1)}%</span></div>
    <div class="detail-stat"><span class="label">Avg Completion</span><span class="value">${Math.round(result.avgTicks)} ticks (${result.avgTime}s)</span></div>
    <div class="detail-stat"><span class="label">Invalid Runs</span><span class="value">${result.invalidPct.toFixed(1)}%</span></div>
    <div class="detail-stat"><span class="label">Total Sims</span><span class="value">${result.totalSims}</span></div>
    ${deathRateRow}
    <div style="margin-top:12px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Damage Distribution</label></div>
    <div class="histogram"><canvas id="histCanvas" width="340" height="70"></canvas></div>
    <div style="margin-top:8px;text-align:center">
      <button class="btn btn-secondary" onclick="closeTileDetail()" style="font-size:10px;padding:6px 16px">← Back to Tick Grid</button>
    </div>
  `;

  // Draw histogram
  requestAnimationFrame(() => {
    let hc = document.getElementById("histCanvas");
    if (!hc) return;
    let hctx = hc.getContext("2d");
    hc.width = hc.parentElement.clientWidth;
    hc.height = 70;
    let buckets = new Array(20).fill(0);
    let maxDmg = Math.max(...result.damages, 100);
    for (let d of result.damages) {
      let b = Math.min(Math.floor((d / maxDmg) * 20), 19);
      buckets[b]++;
    }
    let maxB = Math.max(...buckets, 1);
    let bw = hc.width / 20;
    for (let i = 0; i < 20; i++) {
      let h = (buckets[i] / maxB) * 60;
      let dmgVal = ((i + 0.5) / 20) * maxDmg;
      hctx.fillStyle = histogramColor(dmgVal);
      hctx.fillRect(i * bw + 1, 70 - h, bw - 2, h);
    }
    // Red line at 50
    let x50 = (50 / maxDmg) * hc.width;
    if (x50 < hc.width) {
      hctx.strokeStyle = "#ff0000";
      hctx.lineWidth = 2;
      hctx.setLineDash([4, 2]);
      hctx.beginPath();
      hctx.moveTo(x50, 0);
      hctx.lineTo(x50, 70);
      hctx.stroke();
      hctx.setLineDash([]);
    }
  });
}

function updateLiveDetail(x, y, result) {
  let dp = document.getElementById("liveDetailPanel");
  let prayerHtml = '<div class="prayer-sequence">';
  let prayerNames = { mage: "MAGE", range: "RANGE", melee: "MELEE" };
  let slotLabels = ["START", "T1", "T2", "T3"],
    displayOrder = [1, 2, 3, 0];
  for (let i = 0; i < 4; i++) {
    let p = result.prayer[displayOrder[i]];
    prayerHtml += `<div class="prayer-slot ${p}"><div class="slot-num">${slotLabels[i]}</div>${prayerNames[p]}</div>`;
  }
  prayerHtml += "</div>";
  let dmgClass = result.avgDamage < 15 ? "good" : result.avgDamage < 30 ? "warn" : "bad";
  let o50Class = result.over50Pct < 10 ? "good" : result.over50Pct < 30 ? "warn" : "bad";
  let scoreLabel = currentLoadout.isBloodBarrage ? "Avg Max HP Deficit" : "Avg Damage";
  let over50Label = currentLoadout.isBloodBarrage ? "Runs > 50 deficit" : "Runs > 50 dmg";
  dp.innerHTML = `
    <h3 style="font-family:'JetBrains Mono',monospace;color:var(--accent);font-size:13px;font-weight:800;margin-bottom:6px;letter-spacing:1px">Tile (${x}, ${y})</h3>
    <div class="detail-stat"><span class="label">${scoreLabel}</span><span class="value ${dmgClass}">${result.avgDamage.toFixed(1)}</span></div>
    <div class="detail-stat"><span class="label">${over50Label}</span><span class="value ${o50Class}">${result.over50Pct.toFixed(1)}%</span></div>
    <div class="detail-stat"><span class="label">Avg Completion</span><span class="value">${Math.round(result.avgTicks)} ticks (${result.avgTime}s)</span></div>
    <div class="detail-stat"><span class="label">Sims</span><span class="value">${result.totalSims}</span></div>
    <div style="margin-top:8px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Prayer Sequence</label></div>
    ${prayerHtml}
    <div style="margin-top:8px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Damage Distribution</label></div>
    <div class="histogram"><canvas id="liveHistCanvas" width="340" height="70"></canvas></div>
  `;
  requestAnimationFrame(() => {
    let hc = document.getElementById("liveHistCanvas");
    if (!hc) return;
    let hctx = hc.getContext("2d");
    hc.width = hc.parentElement.clientWidth;
    hc.height = 70;
    let buckets = new Array(20).fill(0);
    let maxDmg = Math.max(...result.damages, 100);
    for (let d of result.damages) {
      let b = Math.min(Math.floor((d / maxDmg) * 20), 19);
      buckets[b]++;
    }
    let maxB = Math.max(...buckets, 1);
    let bw = hc.width / 20;
    for (let i = 0; i < 20; i++) {
      let h = (buckets[i] / maxB) * 60;
      let dmgVal = ((i + 0.5) / 20) * maxDmg;
      hctx.fillStyle = histogramColor(dmgVal);
      hctx.fillRect(i * bw + 1, 70 - h, bw - 2, h);
    }
    let x50 = (50 / maxDmg) * hc.width;
    if (x50 < hc.width) {
      hctx.strokeStyle = "#ff0000";
      hctx.lineWidth = 2;
      hctx.setLineDash([4, 2]);
      hctx.beginPath();
      hctx.moveTo(x50, 0);
      hctx.lineTo(x50, 70);
      hctx.stroke();
      hctx.setLineDash([]);
    }
  });
}

function closeTileDetail() {
  document.getElementById("detailPanel").classList.add("detail-hidden");
  document.getElementById("phase1Panel").style.display = "";
  document.getElementById("eventlistSection").style.display = "";

  document.getElementById("resizeHandle").style.display = "";
  document.getElementById("exportSection").style.display = "";
  selectedTile = null;
  activePrayerSeq = null;
  render();
}
let practiceState = {
  open: false,
  running: false,
  tick: 1,
  interval: null,
  active: null,
  pending: undefined,
  visual: new Set(),
  clientOrder: [],
  records: {},
  solution: null,
  metronomeStart: 1,
  restoreAutozukHidden: null,
  restoreTile: null,
  popoutReady: false,
  popoutPos: null,
  dragging: null,
};

function openPracticeMode() {
  if (practiceState.open) {
    closePracticeMode(true);
    return;
  }
  initializePracticeIcons();
  let code = document.getElementById("spawnCode").value;
  if (!code.trim()) {
    showSpawnCodeError();
    setStatus("Enter a spawn code first", "error");
    return;
  }
  let parsed = parseSpawnCode(code);
  if (parsed.error) {
    setStatus(parsed.error, "error");
    return;
  }
  if (!playerPlacement) {
    let status = document.getElementById("exportStatus");
    status.textContent = "Click a start tile first";
    status.style.color = "var(--accent)";
    setTimeout(() => {
      status.textContent = "";
      status.style.color = "";
    }, 1800);
    return;
  }
  practiceState.open = true;
  practiceState.running = false;
  practiceState.tick = 1;
  practiceState.active = null;
  practiceState.pending = undefined;
  practiceState.visual = new Set();
  practiceState.clientOrder = [];
  practiceState.records = {};
  practiceState.solution = getSelectedPrayerSequence();
  practiceState.metronomeStart = 1 + Math.floor(Math.random() * 4);
  practiceState.restoreAutozukHidden = autozukMode ? autozukHidden : null;
  practiceState.restoreTile = getPracticeRestoreTile();
  stopPlay();
  clearPracticeManualState();
  document.getElementById("practicePanel").classList.add("show");
  initializePracticePopout();
  positionPracticePopout();
  setPracticeButtonText();
  document.getElementById("detailPanel").classList.add("detail-hidden");
  document.getElementById("liveDetailPanel").style.display = "none";
  document.getElementById("phase1Panel").style.display = "";
  document.getElementById("eventlistSection").style.display = "";
  document.getElementById("resizeHandle").style.display = "";
  if (autozukMode && !autozukHidden) toggleHideAutozuk();
  recordPracticeTick(1);
  renderPracticeMode();
  startPracticeTimer();
}
function closePracticeMode(resetManual) {
  stopPracticeTimer();
  let restoreHidden = practiceState.restoreAutozukHidden,
    restoreTile = practiceState.restoreTile;
  practiceState.open = false;
  practiceState.tick = 1;
  practiceState.active = null;
  practiceState.pending = undefined;
  practiceState.visual = new Set();
  practiceState.clientOrder = [];
  practiceState.records = {};
  practiceState.restoreAutozukHidden = null;
  practiceState.restoreTile = null;
  document.getElementById("practicePanel")?.classList.remove("show");
  setPracticeButtonText();
  renderPracticeButtons();
  if (resetManual) clearPracticeManualState();
  restorePracticeUiState(restoreTile, restoreHidden);
}
function startPracticeTimer() {
  if (practiceState.interval) clearInterval(practiceState.interval);
  practiceState.running = true;
  practiceState.interval = setInterval(advancePracticeTick, 600);
}
function stopPracticeTimer() {
  if (practiceState.interval) clearInterval(practiceState.interval);
  practiceState.interval = null;
  practiceState.running = false;
}
function advancePracticeTick() {
  practiceState.tick++;
  if (practiceState.pending !== undefined) practiceState.active = practiceState.pending;
  practiceState.pending = undefined;
  practiceState.visual = new Set(practiceState.active ? [practiceState.active] : []);
  practiceState.clientOrder = practiceState.active ? [practiceState.active] : [];
  recordPracticeTick(practiceState.tick);
  if (practiceState.tick === 15) startPracticeSimulationAtSpawn();
  else if (practiceState.tick > 15) {
    if (!sim) startPracticeSimulationAtSpawn();
    if (sim && sim.tick < practiceState.tick) simulateTick();
  }
  renderPracticeMode();
}
function clickPracticePrayer(type) {
  if (!practiceState.open || !PRACTICE_PRAYERS[type]) return;
  let turningOff = practiceState.visual.has(type);
  if (turningOff) {
    practiceState.visual.delete(type);
    practiceState.clientOrder = practiceState.clientOrder.filter((p) => p !== type);
    practiceState.pending = practiceState.clientOrder.length
      ? practiceState.clientOrder[practiceState.clientOrder.length - 1]
      : null;
  } else {
    practiceState.visual.add(type);
    practiceState.clientOrder = practiceState.clientOrder.filter((p) => p !== type);
    practiceState.clientOrder.push(type);
    practiceState.pending = type;
  }
  renderPracticeButtons();
  playPracticePrayerSound(type, !turningOff);
}
function initializePracticeIcons() {
  for (let type of ["mage", "range", "melee"]) {
    let btn = document.getElementById(
      "practicePrayer" + (type === "range" ? "Range" : type === "mage" ? "Mage" : "Melee"),
    );
    if (btn && !btn.dataset.iconReady) {
      btn.innerHTML = `<img src="${PRAYER_IMG_DATA[type]}" alt="" draggable="false">`;
      btn.dataset.iconReady = "1";
    }
  }
}
function initializePracticePopout() {
  if (practiceState.popoutReady) return;
  let panel = document.getElementById("practicePanel"),
    handle = document.getElementById("practiceDragHandle");
  if (!panel || !handle) return;
  handle.addEventListener("pointerdown", (e) => {
    let r = panel.getBoundingClientRect();
    practiceState.dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  document.addEventListener("pointermove", (e) => {
    if (!practiceState.dragging) return;
    movePracticePopout(
      e.clientX - practiceState.dragging.dx,
      e.clientY - practiceState.dragging.dy,
    );
  });
  document.addEventListener("pointerup", () => {
    practiceState.dragging = null;
  });
  window.addEventListener("resize", () => {
    if (practiceState.popoutPos)
      movePracticePopout(practiceState.popoutPos.x, practiceState.popoutPos.y);
  });
  practiceState.popoutReady = true;
}
function positionPracticePopout() {
  let panel = document.getElementById("practicePanel");
  if (!panel) return;
  if (practiceState.popoutPos) {
    movePracticePopout(practiceState.popoutPos.x, practiceState.popoutPos.y);
    return;
  }
  panel.style.left = "18px";
  panel.style.bottom = "18px";
  panel.style.top = "auto";
  panel.style.right = "auto";
}
function movePracticePopout(x, y) {
  let panel = document.getElementById("practicePanel");
  if (!panel) return;
  let r = panel.getBoundingClientRect(),
    pad = 8;
  let maxX = Math.max(pad, window.innerWidth - r.width - pad),
    maxY = Math.max(pad, window.innerHeight - r.height - pad);
  x = Math.max(pad, Math.min(maxX, x));
  y = Math.max(pad, Math.min(maxY, y));
  panel.style.left = x + "px";
  panel.style.top = y + "px";
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  practiceState.popoutPos = { x, y };
}
function clearPracticeManualState() {
  stopPlay();
  sim = null;
  tickEvents = [];
  tickHits = {};
  gridMobColumns = [];
  tickGridUserScrolled = false;
  eventListUserScrolled = false;
  document.getElementById("tickGridHead").innerHTML = '<tr><th class="tick-col">T</th></tr>';
  document.getElementById("tickGridBody").innerHTML = "";
  document.getElementById("tickGridCount").textContent = "0 hits";
  document.getElementById("eventCount").textContent = "0 events";
  document.getElementById("eventListBody").innerHTML =
    '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">Load a wave to see events</div>';
  document.getElementById("tickDisplay").innerHTML = "<span>TICK</span><br>&mdash;";
  syncStatusBox();
  updatePreview();
  render();
}
function startPracticeSimulationAtSpawn() {
  if (sim) return;
  let code = document.getElementById("spawnCode").value;
  sim = initSim(code, playerPlacement, 15);
  if (!sim) {
    closePracticeMode(false);
    return;
  }
  sim.practiceMode = true;
  rebuildTickGridHeader();
  document.getElementById("tickGridBody").innerHTML = "";
  tickGridUserScrolled = false;
  eventListUserScrolled = false;
  setStatus(
    `Practice sim started! ${sim.mobs.filter((m) => !m.dead).length} mobs spawned on tick 15.`,
    "info",
  );
  updateUI();
}
function getSelectedPrayerSequence() {
  if (activePrayerSeq) return activePrayerSeq.slice();
  if (playerPlacement) {
    let pk = `${playerPlacement.x},${playerPlacement.y}`;
    if (autozukResults[pk]) return autozukResults[pk].prayer.slice();
  }
  return null;
}
function getPracticeRestoreTile() {
  if (selectedTile) return { x: selectedTile.x, y: selectedTile.y };
  if (playerPlacement && autozukResults[`${playerPlacement.x},${playerPlacement.y}`])
    return { x: playerPlacement.x, y: playerPlacement.y };
  return null;
}
function restorePracticeUiState(tile, hidden) {
  if (hidden !== null && autozukMode && autozukHidden !== hidden) toggleHideAutozuk();
  if (tile && autozukMode) {
    let key = `${tile.x},${tile.y}`;
    if (autozukResults[key]) {
      selectedTile = { x: tile.x, y: tile.y };
      playerPlacement = { x: tile.x, y: tile.y };
      activePrayerSeq = autozukResults[key].prayer;
      showTileDetail(tile.x, tile.y);
      return;
    }
  }
  render();
}
function expectedPracticePrayerForTick(tick) {
  if (!practiceState.open || !practiceState.solution || tick < 16) return null;
  return practiceState.solution[solutionPrayerIndexForTick(tick)];
}
function getEffectivePrayerForTick(tick) {
  if (practiceState.open) {
    let actual = practicePrayerForTick(tick);
    if (actual) return actual;
    return null;
  }
  let seq = getSelectedPrayerSequence();
  return seq ? seq[solutionPrayerIndexForTick(tick)] : null;
}
function solutionPrayerIndexForTick(tick) {
  return (tick + 1) % 4;
}
function recordPracticeTick(tick) {
  practiceState.records[tick] = practiceState.active;
}
function practicePrayerForTick(tick) {
  return practiceState.records[tick] || null;
}
function practiceGridIcon(prayer) {
  let src = PRAYER_IMG_DATA[prayer];
  return src ? `<span class="practice-grid-prayer"><img src="${src}" alt=""></span>` : "-";
}
function renderPracticeButtons() {
  initializePracticeIcons();
  for (let type of ["mage", "range", "melee"]) {
    document
      .getElementById(
        "practicePrayer" + (type === "range" ? "Range" : type === "mage" ? "Mage" : "Melee"),
      )
      ?.classList.toggle("lit", practiceState.visual.has(type));
  }
}
function renderPracticeMode() {
  document.getElementById("practiceTick").textContent = practiceState.tick;
  document.getElementById("practiceMetronome").textContent = practiceMetronomeValue();
  if (!sim)
    document.getElementById("tickDisplay").innerHTML = `<span>TICK</span><br>${practiceState.tick}`;
  renderPracticeButtons();
}
function practiceMetronomeValue() {
  return ((practiceState.metronomeStart - 1 + practiceState.tick - 1) % 4) + 1;
}
function setPracticeButtonText() {
  let btn = document.getElementById("practiceToggleBtn");
  if (btn) btn.textContent = practiceState.open ? "CLOSE PRACTICE" : "PRACTICE";
}
function exportTilemarker() {
  let pos = playerPlacement;
  if (!pos) {
    document.getElementById("exportStatus").textContent = "No tile selected";
    return;
  }
  // Map game coords to RuneLite tilemarker format
  // regionX = gameX + 16, regionY = 47 - gameY
  let regionX = pos.x + 16,
    regionY = 47 - pos.y;
  let marker = [{ regionId: 9043, regionX, regionY, z: 0, color: "#FF51B4BA", label: "Start" }];
  let json = JSON.stringify(marker);
  navigator.clipboard
    .writeText(json)
    .then(() => {
      document.getElementById("exportStatus").textContent = "Copied to clipboard!";
      document.getElementById("exportStatus").style.color = "var(--accent)";
      setTimeout(() => {
        document.getElementById("exportStatus").textContent = "";
        document.getElementById("exportStatus").style.color = "";
      }, 2000);
    })
    .catch(() => {
      // Fallback
      let ta = document.createElement("textarea");
      ta.value = json;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      document.getElementById("exportStatus").textContent = "Copied to clipboard!";
      document.getElementById("exportStatus").style.color = "var(--accent)";
      setTimeout(() => {
        document.getElementById("exportStatus").textContent = "";
        document.getElementById("exportStatus").style.color = "";
      }, 2000);
    });
}
