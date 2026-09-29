# Entity Portal // WebGPU

A Portal-Room visibility system in WebGPU, modelled on the Far Cry 1 (CryEngine 1) VisArea/Portal
system and SECTR (Sector/Portal/Occluder). It is one self-contained `index.html` and the world is
built entirely from data.

Open `index.html` in a WebGPU browser (Brave, Chrome, Edge). It needs no server. Drop another
scenario `.json` onto the page to load it.

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

The child's objects and sky then draw with stencil EQUAL, masked to the aperture exactly. Glass
panes are blended over the child afterwards. There are 127 refs per frame.

Key `3` cycles the masking mode: stencil, scissor rects, or none.

## Architecture from data

Walls, floors, ceilings, the exterior shell and roofs are generated from the area shapes:

- Edges shared with a neighbouring area get no exterior face.
- Underground parts get no shell.
- Portal apertures are cut out (convex polygon subtraction).
- Frames are generated for portals.
- `stairs` entities build step blocks.

### Sea, docks and the freighter

- **Coast:** `outdoor.terrain.coast` sinks the land below a shore line into a seabed. `flatten`
  rects level the ground (the quay), and `beachMat` paints sand near the water line.
- **Water:** `outdoor.water` is an animated plane with fresnel sky reflection and sun glints. It is
  drawn last in every outdoor visibility entry, masked by that entry's stencil ref.
- **Hull:** a `hull` entity extrudes a ship from its deck outline. The sides taper to the keel, with
  an antifouling band below the paint line and a bulwark with gaps. The deck is the outline minus
  the roofs of the interior areas under it.
- **Ship interiors:** these are ordinary areas with `shellFrom` (no outer walls below the deck),
  `terrain: false` and `nav: false`: an Engine Room and Cargo Hold below deck, and a Crew Deck and
  Bridge in the superstructure. They connect through `style: "ship"` automatic doors and hatches.
  The large cargo hatch cover uses `slide` and `lift`.
- **Gangway:** `stairs` with `open` treads and `rails`.

Lighting is per area: a low ambient, a sun factor, fog and up to 12 point lights with
`flicker`/`pulse` signals.

## Controls

Click for mouse look. `WASD` fly, `E/Q` up/down, `Shift` fast, `F` door status (all doors are automatic), `R` reset. Click
the minimap to teleport.

| Key | Toggle |
|---|---|
| `1` | portal culling |
| `2` | freeze visibility (fly out and inspect the frustums) |
| `3` | masking mode: stencil / scissor / none |
| `4` | portal lines |
| `5` | area volumes |
| `6` | occluders |
| `M` | minimap |
| `H` | help |

`window.portalDemo` exposes `world`, `vis`, `cam` and `opts` for debugging.
