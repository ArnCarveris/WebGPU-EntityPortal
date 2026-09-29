# Entity Portal // WebGPU

A Portal-Room visibility system in WebGPU, modelled on the Far Cry 1 (CryEngine 1) VisArea/Portal
system and SECTR (Sector/Portal/Occluder). It is one self-contained `index.html` and the world is
built entirely from data.

Open `index.html` in a WebGPU browser (Brave, Chrome, Edge). It needs no server. Drop another
scenario `.json` onto the page to load it.

Every push to `main` deploys the page to GitHub Pages (`.github/workflows/pages.yml`). This needs
**Settings → Pages → Source: GitHub Actions** turned on once for the repository.

## Concepts

| Here | Far Cry 1 | SECTR |
|---|---|---|
| **Area**: extruded 2D shape (`shape`, `y`, `height`) with `ambient`, `sun`, `fog`; may be underground | `CVisArea` (shape points + height, ambient color, AffectedBySun) | `SECTR_Sector` |
| **Outdoors**: implicit area 0, holds every portal that has only one area on it | outdoors + exit portals | – |
| **Portal**: planar convex hull; front/back found by probing both sides | portal VisArea, connections by overlap | `SECTR_Portal` |
| portal flags `closed`, `locked`, `passThrough`, `doubleSide`, `skyOnly`; `glass` pane | `m_bDoubleSide`, `m_bSkyOnly` | `PortalFlags.Closed/Locked/PassThrough` |
| **Traversal** from the camera's area only; clip the hull by the frustum, recurse with a narrower one | `DrawVolume` / `UpdatePortalCameraPlanes` | `SECTR_CullingCamera` |
| **Occluders**: convex hulls, optional `autoOrient: "y"` | `m_lstOcclAreas` | `SECTR_Occluder` |
| **Door** (`auto` opens for nearby actors) drives its portal's Closed flag | – | `SECTR_Door` |
| **Members**: objects belong to every area their AABB overlaps | – | `SECTR_Member` |
| **Drone** routes between areas over open portals and waits at auto doors | – | `SECTR_Graph` |

## Per-frame visibility

### 1. Portal traversal

The walk starts in the camera's area. Other rooms and the outdoors are reached only through open
portals, so a closed room never touches anything outside itself. Each visited (area, frustum) pair
is an entry in a tree.

### 2. Object trees

Each entry queries only its own area's tree:

- **Outdoors** uses a loose quadtree: terrain chunks, trees, rocks and building shells.
- **Each indoor area** has its own BVH of static members, plus a per-frame list of dynamic members
  (doors, drone).

Queries carry a plane mask, so a node fully inside a plane stops testing it.

### 3. Stencil masking

The portal tree is drawn depth-first. Each child's clipped portal polygon is written into the
stencil in three steps:

1. Where stencil == parent ref and depth passes, set bit 7.
2. Write the child's ref.
3. Clear bit 7.

The child's objects and sky then draw with stencil EQUAL, masked to the aperture exactly. There are
127 refs per frame.

Afterwards the portal is covered in the fog of the air in front of it, over the distance from the
eye to the portal. A glass pane carries that fog; an open portal gets a fog veil. So distant windows
and doorways fade into the fog like the walls around them, instead of showing an unfogged interior.

Key `3` cycles the masking mode: stencil, scissor rects, or none.

## Architecture from data

Walls, floors, ceilings, the exterior shell and roofs are generated from the area shapes:

- Edges shared with a neighbouring area get no exterior face.
- Underground parts get no shell.
- Portal apertures are cut out (convex polygon subtraction).
- Frames are generated for portals.
- Geometry that crosses a portal is cut along the portal plane (`splitMesh`): door and window frames,
  hatch rims, props and the door panels. Each half belongs to, and is lit by, the area on its side,
  so it draws only inside that area's stencil region. Door panels are split in local space, and each
  half keeps the area its face looks into, so a sliding hatch cover still looks closed from below.
- `stairs` entities build step blocks.

### Sea, docks and the freighter

- **Coast:** `outdoor.terrain.coast` sinks the land below a shore line into a seabed. `flatten`
  rects level the ground (the quay), and `beachMat` paints sand near the water line.
- **Water:** `outdoor.water` is an animated plane with fresnel sky reflection and sun glints. It is
  drawn last in every outdoor visibility entry, masked by that entry's stencil ref. Each hull cuts
  its waterline cross-section out of the water mesh, so the sea never draws inside a ship. The hold
  floor is below sea level, and the water would otherwise cover it wherever the outdoor view reaches
  the hold. That happens when the camera crosses the hatch, and in the scissor/none modes.
- **Hull:** a `hull` entity extrudes a ship from its deck outline. The sides taper to the keel, with
  an antifouling band below the paint line and a bulwark with gaps. The deck is the outline minus
  the roofs of the interior areas under it.
- **Ship interiors:** these are ordinary areas with `shellFrom` (no outer walls below the deck),
  `terrain: false` and `nav: false`: an Engine Room and Cargo Hold below deck, and a Crew Deck and
  Bridge in the superstructure. They connect through `style: "ship"` automatic doors and hatches.
  The large cargo hatch cover uses `slide` and `lift`.
- **Gangway:** `stairs` with `open` treads and `rails`, tagged `vehicle` and `dockedOnly`, so it is only
  there while the ship is at the quay.

### The freighter voyage (`vehicles`)

A vehicle is a moving group of areas, portals, objects and lights. Everything inside the hull
outline (or tagged with `vehicle`) is authored at the docked pose, and that pose is the vehicle's
local space.

Each frame one transform carries the vehicle along a closed Catmull-Rom `route`, evaluated on the
spline itself. The hull yaws toward the tangent through a critically damped spring (`yawResponse`),
so turns start and end without jolts. The ship accelerates, cruises, brakes to rest exactly on the
dock mark and waits there. On top of that come heel from steering (the ship leans out of the turn)
and pitch, roll and heave from the waves. The waves ease down to calm while docked.

The vehicle's areas keep their BVHs in vehicle space. Visibility queries transform the frustum
planes into that space instead of moving trees. Portals, lights, doors and the waterline hole in
the sea are placed in world space every frame. The island falls off into the sea at the terrain
extent (`terrain.island`).

### Taking the helm (`helm` entity)

Press `F` at the ship's wheel on the bridge to take control. `W`/`S` move the throttle lever from
half astern to full ahead, `A`/`D` turn the wheel (the rudder self-centres), `X` stops the engines,
`Space` centres the rudder and `F` leaves.

- **Handling:** the rudder only bites with water flowing past it, so turn rate scales with speed and
  reverses astern. The ship heels out of turns.
- **Collisions:** the hull is checked against the seabed along its keel line and against structures
  below deck height (the quay) along its deck line. A turn that would swing the stern into the quay
  goes straight instead; a collision ahead bumps the ship to a stop.
- **Helm animation:** the spoked wheel turns with the rudder and the lever follows the throttle.
  Both are dynamic members riding the ship, and they also move on autopilot.
- **Camera:** while you drive, it is locked to the helm stand and follows the hull's full rotation,
  so you roll and pitch with the ship.
- **Autopilot:** when you let go, it steers back onto the route by pure pursuit, backing off if it
  bumps into something. Once back on the line it resumes the cruise and docking cycle.

### Walking (default, `V` toggles fly)

- **Collision:** built from the scene triangles. Floors (upward-facing triangles) and walls (XZ
  segments with a height range) are hashed on a 2 m grid, and each vehicle has its own set in
  vehicle space.
- **Movement:** a 0.3 m walker with gravity, jumping, 0.55 m steps (sampled under the walker's whole
  footprint, so short treads work) and wall sliding.
- **Doors, ladders, water:** closed doors block, and closed hatch covers can be stood on. Ladders
  climb with `W`/`S`. You can swim in the sea and climb out onto the quay.
- **Riding:** standing on or inside a vehicle stores your position in vehicle space, so you ride
  with it, turning when it turns. Walk up the gangway while it's docked, then explore the deck,
  crew deck, bridge, engine room and hold at sea.

Lighting is per area: a low ambient, a sun factor, fog and up to 12 point lights with
`flicker`/`pulse` signals.

## Controls

Click for mouse look. `WASD` move, `Space` jump, `Shift` run, `W/S` on ladders. `V` switches to fly
mode, where `E/Q` move up and down. `F` shows door status (all doors are automatic), `R` resets.
The minimap is centred on you. Click it to teleport; clicking the ship lands you on its deck. `F` at
the ship's wheel takes the helm.

| Key | Toggle |
|---|---|
| `1` | portal culling |
| `2` | freeze visibility (fly out and inspect the frustums) |
| `3` | masking mode: stencil / scissor / none |
| `4` | portal lines |
| `5` | area volumes |
| `6` | occluders |
| `M` | minimap |
| `N` | minimap span: near (110 m) / island (420 m), always centred on you |
| `H` | help |

`window.portalDemo` exposes `world`, `vis`, `cam` and `opts` for debugging.
