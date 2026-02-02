
  /* -- Mod loader: drop this into your script (after MERGE_RECIPES / boxTypes are defined) -- */
(function setupModLoader() {
  const LS_KEY = "physicsRoomInstalledMods";

  // Create mod panel UI
  const modPanel = document.createElement("div");
  modPanel.style = `
    position: fixed;
    right: 10px;
    bottom: 10px;
    background: rgba(0,0,0,0.65);
    color: #fff;
    padding: 8px;
    border-radius: 6px;
    font-family: sans-serif;
    z-index: 9999;
    max-width: 260px;
  `;
  modPanel.innerHTML = `
    <strong style="display:block;margin-bottom:6px">Mods</strong>
    <input id="modFileInput" type="file" accept=".json" style="display:block;margin-bottom:6px" />
    <button id="clearModsBtn" style="display:inline-block;margin-bottom:6px">Clear Mods</button>
    <div id="installedModsList" style="font-size:13px; margin-top:6px; max-height:140px; overflow:auto;"></div>
  `;
  document.body.appendChild(modPanel);

  const fileInput = document.getElementById("modFileInput");
  const installedModsList = document.getElementById("installedModsList");
  const clearModsBtn = document.getElementById("clearModsBtn");

  // Utility: show a small ephemeral toast
  function toast(msg, time = 2000) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style = "position:fixed;left:50%;transform:translateX(-50%);bottom:20px;background:#222;color:#fff;padding:8px 12px;border-radius:6px;z-index:10000;opacity:0.95;font-family:sans-serif";
    document.body.appendChild(t);
    setTimeout(()=>t.remove(), time);
  }

  // Validation: mod can be object {name, recipes[], boxTypes[]} OR an array of recipes directly
  function validateMod(raw) {
    if (!raw) return { ok: false, err: "Empty mod" };
    // If user supplied array, wrap it
    if (Array.isArray(raw)) {
      raw = { name: "unnamed-array-mod", recipes: raw, boxTypes: [] };
    }
    if (typeof raw !== "object") return { ok: false, err: "Mod must be an object or recipe array" };
    if (!raw.name || typeof raw.name !== "string") return { ok: false, err: "Mod must have a string 'name' property" };
    if (!Array.isArray(raw.recipes)) return { ok: false, err: "Mod must have a 'recipes' array" };

    for (let i = 0; i < raw.recipes.length; i++) {
      const r = raw.recipes[i];
      if (!r || typeof r !== "object") return { ok: false, err: `Recipe #${i} invalid` };
      if (!r.name || typeof r.name !== "string") return { ok: false, err: `Recipe #${i} missing name` };
      if (!Array.isArray(r.parents) || r.parents.length < 2 || r.parents.some(p => typeof p !== "string"))
        return { ok: false, err: `Recipe '${r.name}' must have a 'parents' array of strings (length >= 2)` };
      // optional checks for color/size/mass/sellPrice
      if (r.color && typeof r.color !== "string") return { ok: false, err: `Recipe '${r.name}' color must be string` };
      if (r.size && typeof r.size !== "number") return { ok: false, err: `Recipe '${r.name}' size must be number` };
      if (r.mass && typeof r.mass !== "number") return { ok: false, err: `Recipe '${r.name}' mass must be number` };
      if (r.sellPrice && typeof r.sellPrice !== "number") return { ok: false, err: `Recipe '${r.name}' sellPrice must be number` };
    }

    if (raw.boxTypes && (!Array.isArray(raw.boxTypes) || raw.boxTypes.some(t => typeof t !== "string")))
      return { ok: false, err: "boxTypes must be an array of strings" };

    return { ok: true, mod: raw };
  }

  // Apply mod contents to running game (merge recipes and types)
  function applyMod(mod) {
    // Add types
    if (Array.isArray(mod.boxTypes)) {
      mod.boxTypes.forEach(t => boxTypes.add(t));
    }

    // Add recipes, avoid duplicate recipe names
    if (Array.isArray(mod.recipes)) {
      mod.recipes.forEach(r => {
        const exists = MERGE_RECIPES.some(existing => existing.name === r.name);
        if (exists) {
          // If recipe exists, skip or optionally replace — currently we skip
          console.warn(`Mod recipe skipped (duplicate): ${r.name}`);
        } else {
          // push a normalized recipe object with defaults
          MERGE_RECIPES.push({
            name: r.name,
            parents: Array.from(r.parents),
            color: r.color || "#999",
            size: typeof r.size === "number" ? r.size : 40,
            mass: typeof r.mass === "number" ? r.mass : 40,
            sellPrice: typeof r.sellPrice === "number" ? r.sellPrice : 1
          });
        }
      });
    }
  }

  // Persist installed mods to localStorage
  function saveInstalledMods(mods) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(mods));
    } catch (err) {
      console.error("Failed to save mods", err);
    }
  }

  // Load installed mods from localStorage
  function loadInstalledMods() {
    const txt = localStorage.getItem(LS_KEY);
    if (!txt) return [];
    try {
      const arr = JSON.parse(txt);
      if (!Array.isArray(arr)) return [];
      return arr;
    } catch (err) {
      console.error("Failed to parse installed mods from localStorage", err);
      return [];
    }
  }

  // Update UI list of installed mods
  function refreshInstalledModsUI(installed) {
    installedModsList.innerHTML = "";
    if (!installed || installed.length === 0) {
      installedModsList.innerHTML = `<em style="opacity:0.7">No mods installed</em>`;
      return;
    }
    installed.forEach((m, idx) => {
      const el = document.createElement("div");
      el.style = "margin-bottom:6px;border-bottom:1px dashed rgba(255,255,255,0.06);padding-bottom:6px";
      el.innerHTML = `<strong>${escapeHtml(m.name)}</strong><div style="font-size:12px;opacity:0.85">${(m.recipes||[]).length} recipes, ${(m.boxTypes||[]).length} types</div>`;
      installedModsList.appendChild(el);
    });
  }

  // Helper to escape HTML for UI
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Install a mod object and persist
  function installMod(modObj) {
    const installed = loadInstalledMods();
    // prevent duplicate mod name
    if (installed.some(m => m.name === modObj.name)) {
      toast(`Mod already installed: ${modObj.name}`);
      return;
    }
    applyMod(modObj);
    installed.push(modObj);
    saveInstalledMods(installed);
    refreshInstalledModsUI(installed);
    toast(`Mod installed: ${modObj.name}`);
  }

  // Handle file input
  fileInput.addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const v = validateMod(parsed);
        if (!v.ok) {
          toast(`Mod invalid: ${v.err}`);
          console.warn("Mod validation failed", v.err);
          return;
        }
        installMod(v.mod);
      } catch (err) {
        console.error("Failed to parse mod file", err);
        toast("Failed to parse JSON file");
      } finally {
        // clear input so same file can be re-uploaded if needed
        fileInput.value = "";
      }
    };
    reader.onerror = () => {
      toast("Failed to read file");
      fileInput.value = "";
    };
    reader.readAsText(f);
  });

  // Clear mods (remove from storage and reload page to reset state)
  clearModsBtn.addEventListener("click", () => {
    if (!confirm("Clear installed mods and reload the page?")) return;
    localStorage.removeItem(LS_KEY);
    location.reload();
  });

  // On startup, load installed mods and apply them
  (function init() {
    const installed = loadInstalledMods();
    if (installed && installed.length) {
      installed.forEach(m => {
        const v = validateMod(m);
        if (v.ok) applyMod(v.mod);
      });
    }
    refreshInstalledModsUI(installed);
  })();

})();
