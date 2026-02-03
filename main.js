/* =========================================================
   MAIN GAME FILE
   Engine: Matter.js physics sandbox
   Core Systems:
   - Player controller (force-based movement)
   - Box spawning & merging economy
   - Machine processing system
   - Room + door progression
   - Save/load persistence

   IMPORTANT:
   • Many systems rely on shared globals (engine, render, money, boxTypes).
   • Event order matters — do NOT rearrange listeners.
   • Screen-space UI math must not be converted to world-space.
   ========================================================= */
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const moveAccel = 0.0025;
const moveSpeed = 4;
const spawnSize = 50;
let money = 0;
let spawnFlashTimer = 0;
const mouse = { x: 0, y: 0 }; // world coordinates for hover
const discoveredRecipes = new Set();
const rooms = [];
let currentRoom;
const roomSize = 400;
const startX = 400, startY = 300;
const SAVE_KEY = "KineticLab-V1";

// --- Merge Recipes ---
const boxTypes = new Set(["red", "blue", "purple", "green"]); // Initialize with existing types
const MERGE_RECIPES = [
  { name: "purple", color: "#a0f", parents: ["red", "blue"], size: 40, mass: 40, sellPrice: 10 },
  { name: "crimson", color: "#d00", parents: ["red", "red"], size: 40, mass: 40, sellPrice: 3 },
  { name: "cobalt", color: "#00a", parents: ["blue", "blue"], size: 40, mass: 40, sellPrice: 3 },
  { name: "teal", color: "#0ff", parents: ["blue", "purple"], size: 40, mass: 40, sellPrice: 8 },
  { name: "magenta", color: "#f0f", parents: ["red", "purple"], size: 40, mass: 40, sellPrice: 8 },
  { name: "bloodstone", color: "#900", parents: ["crimson", "crimson"], size: 40, mass: 40, sellPrice: 10 },
  { name: "sapphire", color: "#007", parents: ["cobalt", "cobalt"], size: 40, mass: 40, sellPrice: 10 },
  { name: "amethyst", color: "#90e", parents: ["teal", "magenta"], size: 40, mass: 40, sellPrice: 5 },
  { name: "electric", color: "#ff0", parents: ["ElectricMachine", "purple"], size: 40, mass: 40, sellPrice: 5 },
  { name: "aquacore", color: "#008", parents: ["teal", "teal"], size: 40, mass: 40, sellPrice: 5 },
  { name: "luminous", color: "#fff", parents: ["amethyst", "sapphire"], size: 40, mass: 40, sellPrice: 90 },
];
function getColorForType(type) {
  const r = MERGE_RECIPES.find(rr => rr.name === type);
  if (r && r.color) return r.color;
  const defaults = { red: "#f00", blue: "#00f", purple: "#a0f", green: "#0f0" };
  return defaults[type] || "#999";
}

/* ---------- PHYSICS ENGINE SETUP ----------
   Creates the Matter.js engine and renderer.
   Gravity is usually low or zero for top-down games.
   World bodies are stored in engine.world.
------------------------------------------- */
const { Engine, Render, Runner, Bodies, Composite, Body, Query, Events } = Matter;
const engine = Engine.create();
engine.world.gravity.y = 0;

const render = Render.create({
  element: document.body,
  engine,
  options: { width: 800, height: 600, wireframes: false, background: "#1e1e1e" }
});
Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

/* ---------- PLAYER BODY ----------
   Dynamic square body controlled via forces.
   Movement uses acceleration + velocity clamping,
   not direct position setting (prevents tunneling).
----------------------------------- */
const player = Bodies.rectangle(400, 300, 40, 40, {
  label: "PLAYER",
  friction: 0,
  frictionAir: 0.2,
  restitution: 0,
  inertia: Infinity,
  render: { fillStyle: "#4CAF50" }
});
/*       WARNING 
 PLAYER MASS TUNED WITH MOVEMENT FORCES */
Body.setMass(player, 10);
Composite.add(engine.world, player);
render.options.hasBounds = true;
render.bounds.min.x = player.position.x - render.options.width / 2;
render.bounds.min.y = player.position.y - render.options.height / 2;
render.bounds.max.x = player.position.x + render.options.width / 2;
render.bounds.max.y = player.position.y + render.options.height / 2;

/* =========================================================
   ROOM CLASS
   A room is a square region with:
   - Static wall bodies
   - Optional door gaps
   - Box spawn points
   - Machine placement
   Rooms do NOT handle rendering — physics only.
   ========================================================= */
class Room {
  constructor(x, y, size, name) {
    this.x = x; this.y = y; this.size = size; this.name = name;
    this.walls = []; this.doors = []; this.spawnPoints = []; this.boxes = [];
  }
  /* Builds perimeter walls.
     If a door exists on an edge, wall is split to leave gap.
     This must run AFTER doors are defined. */
  createWalls() {
    const t = 20;
    const s = this.size;

    const door = this.doors[0]; // assuming one door per room for now
    const doorWidth = door ? door.bounds.max.x - door.bounds.min.x : 0;
    const doorX = door ? door.position.x : 0;
    const doorY = door ? door.position.y : 0;

    // Top wall split into two parts around the door (if door exists)
    if (door && doorY === this.y - s / 2) {
      const halfDoorWidth = doorWidth / 2;
      const leftWallWidth = (doorX - halfDoorWidth) - (this.x - s / 2);
      const rightWallWidth = (this.x + s / 2) - (doorX + halfDoorWidth);

      // Left part of top wall
      if (leftWallWidth > 0) {
        this.walls.push(Bodies.rectangle(
          this.x - s / 2 + leftWallWidth / 2,
          this.y - s / 2,
          leftWallWidth,
          t,
          { isStatic: true }
        ));
      }

      // Right part of top wall
      if (rightWallWidth > 0) {
        this.walls.push(Bodies.rectangle(
          doorX + halfDoorWidth + rightWallWidth / 2,
          this.y - s / 2,
          rightWallWidth,
          t,
          { isStatic: true }
        ));
      }
    } else {
      // No door, full top wall
      this.walls.push(Bodies.rectangle(this.x, this.y - s / 2, s, t, { isStatic: true }));
    }

    // Add other 3 walls here inside the method
    this.walls.push(Bodies.rectangle(this.x, this.y + s / 2, s, t, { isStatic: true }));
    this.walls.push(Bodies.rectangle(this.x - s / 2, this.y, t, s, { isStatic: true }));
    this.walls.push(Bodies.rectangle(this.x + s / 2, this.y, t, s, { isStatic: true }));

    Composite.add(engine.world, this.walls);
  }
  /* Creates a static door body.
     Door contains metadata for:
     - Cost
     - Deterministic ID
     - Save/load restoration */
  addDoor(offsetX, offsetY, width, height, cost = 0) {
    const doorX = this.x + offsetX;
    const doorY = this.y + offsetY;
    const door = Bodies.rectangle(doorX, doorY, width, height, {
      isStatic: true, label: "DOOR", render: { fillStyle: "#ffaa00" }
    });
  
    door.doorCost = cost;
    const meta = { room: this.name || "", x: doorX, y: doorY, w: width, h: height };
    meta.id = deterministicDoorId(meta);
    door._meta = meta;
  
    this.doors.push(door);
    Composite.add(engine.world, door);
  }

  addSpawnPoint(xOffset, yOffset, label) {
    this.spawnPoints.push({ x: this.x + xOffset, y: this.y + yOffset, label });
  }

  getSpawnPoint(label) {
    return this.spawnPoints.find(p => p.label === label);
  }
}
const room1 = new Room(startX, startY, roomSize, "Room 1");
let machines = [];
/* =========================================================
   MACHINE CLASS
   Machines convert input boxes → output boxes over time.
   Processing is tick-driven, not timer-based, so it
   remains deterministic under lag.
   ========================================================= */
/*       WARNING 
 MACHINE STATE MACHINE
   This is a finite state system. Changing flags or timing
   logic can permanently deadlock machines. */
class Machine {
  // x,y = world coords; w,h = size; name = display name;
  // defaultDurationSec used when recipe doesn't specify processDurationSec
  constructor(x, y, w = 80, h = 40, name = "Machine", defaultDurationSec = 5) {
    this.x = x; this.y = y;
    this.w = w; this.h = h;
    this.name = name;
    this.defaultDuration = (defaultDurationSec || 5) * 1000;

    this.busy = false;
    this.processing = null; // { start, duration, inputLabel, outputLabel, producedByRecipe }

    this.body = Bodies.rectangle(x, y, w, h, {
      isStatic: true,
      label: "MACHINE",
      render: { fillStyle: "#333", strokeStyle: "#fff", lineWidth: 2 }
    });
    this.body._machine = this;
    Composite.add(engine.world, this.body);
    machines.push(this);
  }

  /* Attempts to consume a box if a valid recipe exists.
   Removes the box immediately and begins a timed job. */
  startProcessing(boxBody) {
    if (this.busy) return false;
    if (!boxBody || !boxBody.label) return false;

    const inputLabel = boxBody.label;
    const machineName = this.name;

    // Find a recipe which includes both the input label and the machine name as parents
    const recipeMatch = MERGE_RECIPES.find(r => {
      if (!Array.isArray(r.parents)) return false;
      return r.parents.includes(inputLabel) && r.parents.includes(machineName);
    });

    if (!recipeMatch) {
      // No recipe found => machine does not accept this box
      return false;
    }

    const duration = (typeof recipeMatch.processDurationSec === "number")
      ? recipeMatch.processDurationSec * 1000
      : this.defaultDuration;

    this.busy = true;
    this.processing = {
      start: Date.now(),
      duration,
      inputLabel,
      outputLabel: recipeMatch.name,
      producedByRecipe: recipeMatch.name
    };

    Composite.remove(engine.world, boxBody); // consume the input
    playThunk();
    this.body.render.fillStyle = "#555";
    return true;
  }

  /* Called every physics tick.
   Completes job when duration reached and spawns output. */
  update() {
    if (!this.busy || !this.processing) return false;
    try {
      const elapsed = Date.now() - this.processing.start;
  
      // Safety: if processing has wildly overrun (duration + 10s), force-reset and log
      const overrunLimit = this.processing.duration + 10000; // 10s grace
      if (elapsed > overrunLimit) {
        klog(`[Machine:${this.name}] processing overrun (${elapsed}ms > ${overrunLimit}ms). Auto-resetting.`);
        // Attempt to safely reset; do NOT throw
        this.busy = false;
        this.processing = null;
        try { this.body.render.fillStyle = "#333"; } catch (_) {}
        return false;
      }
  
      if (elapsed < this.processing.duration) return false;
  
      // spawn output (guarded)
      const spawnX = this.x;
      const spawnY = this.y - (this.h / 2) - 24;
      const outType = this.processing.outputLabel;
  
      // create box with safe color lookup
      const color = (() => {
        try { return getColorForType(outType); } catch (e) { klog(`[Machine:${this.name}] getColorForType error for ${outType}`); return "#999"; }
      })();
  
      const box = Bodies.rectangle(spawnX, spawnY, 40, 40, {
        label: outType,
        friction: 0.2,
        frictionAir: 0.05,
        render: { fillStyle: color },
        sellPrice: (MERGE_RECIPES.find(r => r.name === outType) || {}).sellPrice || 1
      });
  
      Body.setMass(box, 40);
      box._processedBy = this.name;
      Composite.add(engine.world, box);
      boxTypes.add(outType);
  
      // record recipe discovery but guard it so errors don't prevent reset
      try { recordRecipe(outType); } catch (e) { klog(`[Machine:${this.name}] recordRecipe error: ${e && e.message}`); }
  
      this.busy = false;
      this.processing = null;
      try { this.body.render.fillStyle = "#333"; } catch (_) {}
      playThunk();
      return true;
    } catch (err) {
      // Log into the on-screen panel instead of console
      try { klog(`[Machine:${this.name}] update error: ${err && err.message}`); } catch (_) {}
      // Ensure machine is reset so it doesn't remain stuck
      try {
        this.busy = false;
        this.processing = null;
        this.body.render.fillStyle = "#333";
      } catch (_) {}
      return false;
    }
  }

  getProgress() {
    if (!this.busy || !this.processing) return 0;
    const elapsed = Date.now() - this.processing.start;
    return Math.min(1, elapsed / this.processing.duration);
  }
}
/* ---------- COLLISION: MACHINE INTAKE ----------
   When a dynamic box contacts a machine body,
   machine.startProcessing is attempted.
------------------------------------------------ */
/* WARNING 
 DO NOT REORDER EVENT LISTENERS
   Execution order affects physics resolution and UI sync */
Events.on(engine, "collisionStart", event => {
  event.pairs.forEach(pair => {
    const a = pair.bodyA, b = pair.bodyB;
    let machineBody = null, boxBody = null;

    if (a.label === "MACHINE" && !b.isStatic && boxTypes.has(b.label)) {
      machineBody = a; boxBody = b;
    } else if (b.label === "MACHINE" && !a.isStatic && boxTypes.has(a.label)) {
      machineBody = b; boxBody = a;
    }

    if (machineBody && boxBody) {
      const machine = machineBody._machine;
      if (!machine) return;
      // attempt to start processing; startProcessing will check MERGE_RECIPES
      machine.startProcessing(boxBody);
    }
  });
});

// update machines on each tick
Events.on(engine, "afterUpdate", () => {
  machines.forEach(m => m.update());
});

// draw machine name + progress bar
Events.on(render, "afterRender", () => {
  const ctx = render.context;
  const bounds = render.bounds;
  const scaleX = render.options.width / (bounds.max.x - bounds.min.x);
  const scaleY = render.options.height / (bounds.max.y - bounds.min.y);

  machines.forEach(m => {
    const sx = (m.x - bounds.min.x) * scaleX;
    const sy = (m.y - bounds.min.y) * scaleY;

    // name
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = "#fff";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(m.name, sx, sy - (m.h/2 * scaleY) - 10);
    ctx.restore();

    if (!m.busy) return;

    // progress bar
    const barW = 80;
    const barH = 8;
    const px = sx - barW / 2;
    const py = sy - (m.h/2 * scaleY) - 28;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(px - 2, py - 2, barW + 4, barH + 4);
    ctx.fillStyle = "#4CAF50"; ctx.fillRect(px, py, barW * m.getProgress(), barH);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(px, py, barW, barH);
    ctx.fillStyle = "#fff"; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(`${Math.round(m.getProgress()*100)}%`, px + barW/2, py - 8);
    ctx.restore();
  });
});
// Move spawn point near left bottom corner of room1
room1.addSpawnPoint(-room1.size / 2 + 75, room1.size / 2 - 75, "red");
room1.addSpawnPoint(-room1.size / 2 + 75, room1.size / 2 - 75, "blue");
room1.addDoor(0, -roomSize/2, 60, 20, 50); // door to next room
room1.createWalls();
rooms.push(room1);
currentRoom = room1;
new Machine(80, 60, 88, 40, "ElectricMachine", 5);
let unlockedDoors = []; // array of door _meta objects that have been unlocked/removed

/*       WARNING 
 SAVE-COMPAT IDENTIFIER
   ID format must remain stable across versions. */
function deterministicDoorId(meta) {
  // normalize/round numeric values and sanitize room name
  const room = (meta.room || "room").toString().trim().replace(/\s+/g, "_").toLowerCase();
  const x = Math.round(meta.x);
  const y = Math.round(meta.y);
  const w = Math.round(meta.w);
  const h = Math.round(meta.h);
  return `${room}_${x}_${y}_${w}_${h}`;
}

/* ---------- SAVE SYSTEM ----------
   Stored in localStorage under SAVE_KEY.
   Saves economy + progression only,
   not physics state.
---------------------------------- */
/*       WARNING 
   SAVE FORMAT CONTRACT
   Backwards compatibility required. */
function saveGame() {
  try {
    const data = {
      money: money,
      discoveredRecipes: Array.from(discoveredRecipes),
      unlockedDoors: unlockedDoors
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    // console.debug("Game saved", data);
  } catch (err) {
    console.error("Failed to save game", err);
  }
}
function loadGame() {
  try {
    const txt = localStorage.getItem(SAVE_KEY);
    if (!txt) return;
    const data = JSON.parse(txt);
    if (typeof data.money === "number") {
      money = data.money;
    }
    if (Array.isArray(data.discoveredRecipes)) {
      data.discoveredRecipes.forEach(r => discoveredRecipes.add(r));
      // repopulate recipe list UI
      const ul = document.getElementById("recipeList");
      if (ul) {
        ul.innerHTML = "";
        discoveredRecipes.forEach(name => {
          const recipe = MERGE_RECIPES.find(rr => rr.name === name);
          const li = document.createElement("li");
          if (recipe) {
            li.textContent = `${recipe.name.toUpperCase()} = ${recipe.parents.map(p=>p.toUpperCase()).join(" + ")}`;
          } else {
            li.textContent = name.toUpperCase();
          }
          ul.appendChild(li);
        });
      }
    }
    if (Array.isArray(data.unlockedDoors)) {
      unlockedDoors = data.unlockedDoors;
      // Remove matching doors from the world (doors were originally added during init)
      removeSavedDoorsFromWorld();
    }
    updateMoneyDisplay();
    // console.debug("Game loaded", data);
  } catch (err) {
    console.error("Failed to load game", err);
  }
}
loadGame();

// Helper to compare door meta - allows slight float differences
function doorMetaMatches(a, b) {
  if (!a || !b) return false;
  const eps = 1.0; // tolerance in world units
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps &&
         Math.abs(a.w - b.w) <= eps && Math.abs(a.h - b.h) <= eps;
}

function removeSavedDoorsFromWorld() {
  if (!Array.isArray(unlockedDoors) || unlockedDoors.length === 0) return;

  const doorBodies = Composite.allBodies(engine.world).filter(b => b.label === "DOOR");
  let migrated = false;

  doorBodies.forEach(b => {
    const meta = b._meta || {
      id: null,
      room: "",
      x: b.position.x,
      y: b.position.y,
      w: b.bounds.max.x - b.bounds.min.x,
      h: b.bounds.max.y - b.bounds.min.y
    };

    // Ensure this body has a deterministic id (use its meta if available)
    if (!meta.id) {
      meta.id = deterministicDoorId(meta);
      b._meta = Object.assign({}, b._meta, { id: meta.id });
    }

    // 1) exact id match
    const matchedById = unlockedDoors.some(saved => saved && saved.id && saved.id === meta.id);
    if (matchedById) {
      Composite.remove(engine.world, b);
      console.debug("Removed saved door by id:", meta.id);
      return;
    }

    // 2) fallback: legacy entry without id (match by approx meta)
    const legacyIndex = unlockedDoors.findIndex(saved => saved && !saved.id && doorMetaMatches(saved, meta));
    if (legacyIndex !== -1) {
      // migrate legacy entry to id
      unlockedDoors[legacyIndex].id = meta.id;
      migrated = true;
      Composite.remove(engine.world, b);
      console.debug("Removed saved door by legacy meta and migrated to id:", meta.id);
      return;
    }
  });

  if (migrated) saveGame();
}
/*       WARNING 
   SCREEN-SPACE DRAWING
   Transform reset is REQUIRED.
   Removing this causes camera offset bugs. */
function screenToWorld(screenX, screenY) {
  const bounds = render.bounds;
  const scaleX = render.options.width / (bounds.max.x - bounds.min.x);
  const scaleY = render.options.height / (bounds.max.y - bounds.min.y);

  return {
    x: bounds.min.x + screenX / scaleX,
    y: bounds.min.y + screenY / scaleY
  };
}

// Draw UI in screen space anchored to the current room viewport so
// pixel sizes match click detection and remain stable when camera moves/zooms.
function drawUI() {
  const ctx = render.context;
  ctx.save();

  const bounds = render.bounds;
  const scaleX = render.options.width / (bounds.max.x - bounds.min.x);
  const scaleY = render.options.height / (bounds.max.y - bounds.min.y);

  // smaller sizes in pixels
  const buttonWidthPx = 60;
  const buttonHeightPx = 30;
  const paddingPx = 8;

  const baseXWorld = currentRoom.x + currentRoom.size / 2 - (buttonWidthPx / scaleX) * 2 - (paddingPx / scaleX) * 2;
  const baseYWorld = currentRoom.y + currentRoom.size / 2 - (buttonHeightPx / scaleY) - (paddingPx / scaleY);
  const baseXScreen = (baseXWorld - bounds.min.x) * scaleX;
  const baseYScreen = (baseYWorld - bounds.min.y) * scaleY;

  // draw in screen space with identity transform to get pixel-perfect UI
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Red Button
  ctx.fillStyle = "#FF5252";
  ctx.fillRect(baseXScreen, baseYScreen, buttonWidthPx, buttonHeightPx);

  // Blue Button
  ctx.fillStyle = "#1E88E5";
  ctx.fillRect(baseXScreen + buttonWidthPx + paddingPx, baseYScreen, buttonWidthPx, buttonHeightPx);

  // Text on Buttons - center text vertically based on buttonHeightPx
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const textY = baseYScreen + buttonHeightPx / 2;

  ctx.fillText("Spawn Red", baseXScreen + buttonWidthPx / 2, textY - 6);
  ctx.fillText("Price: $0", baseXScreen + buttonWidthPx / 2, textY + 8);

  ctx.fillText("Spawn Blue", baseXScreen + buttonWidthPx + paddingPx + buttonWidthPx / 2, textY - 6);
  ctx.fillText("Price: $1", baseXScreen + buttonWidthPx + paddingPx + buttonWidthPx / 2, textY + 8);

  // Spawn indicator (keep small)
  const spawn = currentRoom.getSpawnPoint("red") || { x: 0, y: 0 };
  const indicatorSizePx = 30;
  const spawnScreenX = (spawn.x - bounds.min.x) * scaleX;
  const spawnScreenY = (spawn.y - bounds.min.y) * scaleY;
  ctx.fillStyle = "rgba(128, 128, 128, 0.5)";
  ctx.fillRect(spawnScreenX - indicatorSizePx / 2, spawnScreenY - indicatorSizePx / 2, indicatorSizePx, indicatorSizePx);

  ctx.restore();
}
// Call drawUI within the 'afterRender' event to update the canvas
Events.on(render, "afterRender", drawUI);

/* ---------- SPAWN BOX ----------
   Checks:
   1) Spawn area not occupied
   2) Player has money (for blue)
   3) Adds body + registers type
-------------------------------- */
function spawnBox(type) {
  const room = currentRoom;
  const spawn = room.getSpawnPoint(type);
  if (!spawn) return;

  const region = {
    min: { x: spawn.x - 20, y: spawn.y - 20 },
    max: { x: spawn.x + 20, y: spawn.y + 20 }
  };
  /*       WARNING 
   SPAWN SAFETY CHECK
   Prevents body overlap instability. */
  const hits = Query.region(Composite.allBodies(engine.world), region)
                   .filter(b => b.label !== "PLAYER" && boxTypes.has(b.label)); // Check with dynamic types

  if (hits.length > 0) {
    spawnFlashTimer = 10;
    playThunk();
    return;
  }

  if (type === "blue" && money < 1) {
    spawnFlashTimer = 10;
    playThunk();
    return;
  }

  if (type === "blue") { 
    money -= 1; 
    updateMoneyDisplay(); 
  }

  const box = Bodies.rectangle(spawn.x, spawn.y, 40, 40, {
    label: type,
    friction: 0.2, 
    frictionAir: 0.05,
    render: { fillStyle: type === "red" ? "#f00" : "#00f" },
    sellPrice: type == "red" ? 1 : 3
  });
  /*       WARNING 
 BASE BOX MASS BALANCED FOR STACK STABILITY */
  Body.setMass(box, 40);
  Composite.add(engine.world, box);
  room.boxes.push(box);
  boxTypes.add(type); // Add new box type dynamically
}

/* ---------- BOX MERGING ----------
   When two compatible boxes collide,
   they are replaced by a higher-tier box.
   Merge recipes are defined in MERGE_RECIPES.
---------------------------------- */
/*       WARNING 
 MERGE ATOMICITY
   Parents must be removed BEFORE child added. */
function mergeBoxes(a, b, recipe) {
  if (!recipe) return;
  if (a.isMerging || b.isMerging) return;
  a.isMerging = b.isMerging = true;

  const x = (a.position.x + b.position.x) / 2;
  const y = (a.position.y + b.position.y) / 2;
  Composite.remove(engine.world, a);
  Composite.remove(engine.world, b);

  const merged = Bodies.rectangle(x, y, recipe.size, recipe.size, {
    label: recipe.name,
    friction: 0.3,
    frictionAir: 0.05,
    render: { fillStyle: recipe.color },
    sellPrice: recipe.sellPrice  // Set sell price properly here
  });
  Body.setMass(merged, recipe.mass);
  Composite.add(engine.world, merged);
  recordRecipe(recipe.name);
}

function findMergeRecipe(a, b) {
  if (!a || !b) return null;
  const la = a.label;
  const lb = b.label;
  return MERGE_RECIPES.find(r => parentsMatch(r.parents, la, lb)) || null;
}

function parentsMatch(parents, labelA, labelB) {
  if (!Array.isArray(parents) || parents.length !== 2) return false;
  // match ordered (p1==a && p2==b) OR swapped (p1==b && p2==a)
  return (parents[0] === labelA && parents[1] === labelB) ||
         (parents[0] === labelB && parents[1] === labelA);
}
// --- Record Recipe ---
function recordRecipe(recipeName) {
  if (discoveredRecipes.has(recipeName)) return;
  discoveredRecipes.add(recipeName);

  const recipe = MERGE_RECIPES.find(r => r.name === recipeName);
  if (!recipe) return;

  const ul = document.getElementById("recipeList");
  const li = document.createElement("li");
  const nameUpper = recipe.name.toUpperCase();
  const parentsUpper = recipe.parents.map(p => p.toUpperCase()).join(" + ");
  li.textContent = `${nameUpper} = ${parentsUpper}`;
  ul.appendChild(li);

  saveGame(); // persist newly discovered recipe
}

/* ---------- MOUSE INPUT ----------
   Screen-space → world-space conversion required.
   Handles:
   • Spawn buttons
   • Selling boxes by click
---------------------------------- */
window.addEventListener("mousemove", e => {
  const rect = render.canvas.getBoundingClientRect();
  const wp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  mouse.x = wp.x;
  mouse.y = wp.y;
});
window.addEventListener("mousedown", e => {
  const rect = render.canvas.getBoundingClientRect();
  const mouseScreenX = e.clientX - rect.left;
  const mouseScreenY = e.clientY - rect.top;

  const bounds = render.bounds;
  const scaleX = render.options.width / (bounds.max.x - bounds.min.x);
  const scaleY = render.options.height / (bounds.max.y - bounds.min.y);

  // same sizes as drawUI
  const buttonWidthPx = 60;
  const buttonHeightPx = 30;
  const paddingPx = 8;

  const baseXWorld = currentRoom.x + currentRoom.size / 2 - (buttonWidthPx / scaleX) * 2 - (paddingPx / scaleX) * 2;
  const baseYWorld = currentRoom.y + currentRoom.size / 2 - (buttonHeightPx / scaleY) - (paddingPx / scaleY);
  const baseXScreen = (baseXWorld - bounds.min.x) * scaleX;
  const baseYScreen = (baseYWorld - bounds.min.y) * scaleY;

  // Red button click (screen coords)
  if (mouseScreenX >= baseXScreen && mouseScreenX <= baseXScreen + buttonWidthPx &&
      mouseScreenY >= baseYScreen && mouseScreenY <= baseYScreen + buttonHeightPx) {
    spawnBox("red");
    return;
  }

  // Blue button click (screen coords)
  if (mouseScreenX >= baseXScreen + buttonWidthPx + paddingPx &&
      mouseScreenX <= baseXScreen + buttonWidthPx * 2 + paddingPx &&
      mouseScreenY >= baseYScreen && mouseScreenY <= baseYScreen + buttonHeightPx) {
    spawnBox("blue");
    return;
  }

  // fallback: sell bodies using world coords
  const mouseWorld = screenToWorld(mouseScreenX, mouseScreenY);
  const bodies = Composite.allBodies(engine.world).filter(b => !b.isStatic && b.label !== "PLAYER");
  bodies.forEach(body => {
    if (mouseWorld.x >= body.bounds.min.x && mouseWorld.x <= body.bounds.max.x &&
        mouseWorld.y >= body.bounds.min.y && mouseWorld.y <= body.bounds.max.y) {
      money += body.sellPrice || 0;
      updateMoneyDisplay();
      Composite.remove(engine.world, body);
    }
  });
});

// --- Player Controls (keyboard) ---
const keys = {};
window.addEventListener("keydown", e => keys[e.key] = true);
window.addEventListener("keyup", e => keys[e.key] = false);

/* ---------- PLAYER MOVEMENT ----------
   Force-based acceleration
   Normalized vector prevents faster diagonal movement
   Velocity clamped to moveSpeed
-------------------------------------- */
function handleMovement() {
  let vx = 0, vy = 0;
  if (keys.w || keys.ArrowUp) vy -= 1;
  if (keys.s || keys.ArrowDown) vy += 1;
  if (keys.a || keys.ArrowLeft) vx -= 1;
  if (keys.d || keys.ArrowRight) vx += 1;

  if (vx !== 0 || vy !== 0) {
    const len = Math.sqrt(vx*vx + vy*vy);
    vx = vx / len;
    vy = vy / len;
    // apply a small force in that direction
    Body.applyForce(player, player.position, { x: vx * moveAccel * player.mass, y: vy * moveAccel * player.mass });
    // clamp velocity to moveSpeed if needed
    const maxSpeed = moveSpeed;
    if (player.velocity) {
      const speed = Math.sqrt(player.velocity.x*player.velocity.x + player.velocity.y*player.velocity.y);
      if (speed > maxSpeed) {
        Body.setVelocity(player, { x: (player.velocity.x / speed) * maxSpeed, y: (player.velocity.y / speed) * maxSpeed });
      }
    }
  }
}

// Attach movement handler
Events.on(engine, "beforeUpdate", handleMovement);

// --- Money Display ---
function updateMoneyDisplay() { 
  const el = document.getElementById("moneyAmount");
  if (el) el.textContent = money;
  // persist money and other state whenever UI updates money
  saveGame();
}

// --- Spawn flash sound ---
function playThunk() {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square"; osc.frequency.value = 120;
  gain.gain.value = 0.15;
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + 0.08);
}

/*        WARNING
   DO NOT REORDER EVENT LISTENERS
   Execution order affects physics resolution and UI sync */
Events.on(engine, "collisionStart", event => {
  event.pairs.forEach(pair => {
    const a = pair.bodyA, b = pair.bodyB;

    // Merge boxes logic
    const recipe = findMergeRecipe(a, b);
    if (recipe) mergeBoxes(a, b, recipe);

    /* ---------- DOOR UNLOCK ----------
     Player collision with door:
     - Checks money
     - Deducts cost
     - Saves unlocked door ID
     - Removes body from world
    ----------------------------------- */
    let doorBody = null;
    let playerBody = null;

    if (a.label === "DOOR" && b.label === "PLAYER") {
      doorBody = a;
      playerBody = b;
    } else if (b.label === "DOOR" && a.label === "PLAYER") {
      doorBody = b;
      playerBody = a;
    }

    // REPLACE the door-unlock block inside your collision handler with this (records id)
  if (doorBody && playerBody) {
  const cost = doorBody.doorCost || 0;
  if (money >= cost) {
    money -= cost;
    updateMoneyDisplay();

    // prefer meta.id when available
    const meta = doorBody._meta || {
      id: null,
      x: doorBody.position.x,
      y: doorBody.position.y,
      w: doorBody.bounds.max.x - doorBody.bounds.min.x,
      h: doorBody.bounds.max.y - doorBody.bounds.min.y
    };

    // Avoid duplicates in unlockedDoors
    if (!unlockedDoors.some(u => (meta.id && u.id && u.id === meta.id) || (!meta.id && doorMetaMatches(u, meta)))) {
      unlockedDoors.push(meta);
    }

    Composite.remove(engine.world, doorBody); // remove door, allow passage

    saveGame(); // persist unlocked door
  } else {
    console.log("Not enough money to open the door!");
  }
}
  });
});

/* ---------- SCREEN-SPACE UI ----------
   Uses manual transform reset (setTransform(1,0,0,1,0,0))
   because Matter render is world-space by default.
-------------------------------------- */
Events.on(render, "afterRender", () => {
  const ctx = render.context;

  // spawn flash (world-space stroke; leave as-is)
  if (spawnFlashTimer > 0) {
    ctx.save();
    ctx.globalAlpha = spawnFlashTimer / 10;
    ctx.strokeStyle = "#ff5252"; ctx.lineWidth = 4;
    ctx.strokeRect(render.options.width / 2 - 20, render.options.height / 2 - 20, 40, 40);
    ctx.restore();
    spawnFlashTimer--;
  }

  /* ---------- HOVER LABELS ----------
   Displays box name + sell price when mouse overlaps body.
   Requires world→screen coordinate conversion.
  ----------------------------------- */
  const bounds = render.bounds;
  const scaleX = render.options.width / (bounds.max.x - bounds.min.x);
  const scaleY = render.options.height / (bounds.max.y - bounds.min.y);

  const bodies = Composite.allBodies(engine.world).filter(b => !b.isStatic);
  bodies.forEach(body => {
    if (mouse.x >= body.bounds.min.x && mouse.x <= body.bounds.max.x &&
        mouse.y >= body.bounds.min.y && mouse.y <= body.bounds.max.y) {

      // convert body world position -> screen (canvas pixels)
      const screenX = (body.position.x - bounds.min.x) * scaleX;
      const screenY = (body.position.y - bounds.min.y) * scaleY;

      ctx.save();
      // draw in screen-space so text isn't affected by view transform/scale
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#fff";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${body.label.toUpperCase()} - $${body.sellPrice || 0}`, screenX, screenY - 30);
      ctx.restore();
    }
  });
});

/* ---------- CAMERA FOLLOW ----------
   Render bounds are moved each tick to center on player.
   Render.lookAt syncs viewport.
----------------------------------- */
/*       WARNING 
 CAMERA SYSTEM
   Bounds and lookAt must stay paired. */
Events.on(engine, "afterUpdate", () => {
  const width = render.options.width;
  const height = render.options.height;

  render.bounds.min.x = player.position.x - width / 2;
  render.bounds.min.y = player.position.y - height / 2;
  render.bounds.max.x = player.position.x + width / 2;
  render.bounds.max.y = player.position.y + height / 2;

  // Translate the view accordingly
  Render.lookAt(render, player, { x: width, y: height });
});
