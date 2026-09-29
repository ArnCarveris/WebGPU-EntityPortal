'use strict';
// Game: builds the world from a scenario and runs the frame.
//
// Frame order:
//   world update (vehicles first, so riders use this frame's pose) -> player -> portal traversal
//   (or the frozen one) -> FrameBuilder command list -> debug lines -> render -> minimap, HUD

const MASK_MODES = ['stencil', 'scissor', 'none'];

class Game {
    constructor(canvas, mapCanvas) {
        this.canvas = canvas;
        this.renderer = new Renderer();
        this.input = new InputSystem(this, canvas);
        this.hud = new Hud(this);
        this.minimap = new Minimap(this, mapCanvas);
        this.mapCanvas = mapCanvas;
        this.onError = (e) => console.error(e);
        this.world = null;
        this.loader = null;             // ScenarioLoader (set by main.js)
        this.player = null;
        this.vis = null;
        this.frozen = null;
        this.opts = { culling: true, freeze: false, mode: 'stencil', portals: true, volumes: false, map: true, help: true, occluders: true, walk: true, island: false };
        this.stats = { fps: 0, visMs: 0, draws: 0, tris: 0, objs: 0 };
        this.frameStats = null;
        this.frameMode = 'stencil';
        this.running = false;
        this.lastT = performance.now();
    }

    get cam() { return this.player && this.player.cam; }

    async start() {
        await this.renderer.init(this.canvas);
        this.input.attach();
    }

    // build a world from scenario data and make it current (throws on errors in the data)
    load(scn) {
        const world = new World(scn);
        this.world = world;
        this.vis = new PortalVis(world);
        this.frameBuilder = new FrameBuilder(world);
        this.debugLines = new DebugLines(world);
        this.renderer.upload(world);
        this.frozen = null;
        this.opts.freeze = false;
        this.player = new PlayerController(this, scn.camera, scn.player);
        if (world.warnings.length) this.hud.toast(`${world.warnings.length} scenario warning(s), see console`);
        else this.hud.toast(`Loaded "${scn.name || 'scenario'}": ${world.areas.length - 1} areas, ${world.portals.length} portals`);
        if (!this.running) { this.running = true; requestAnimationFrame(n => this.frame(n)); }
    }

    onKey(code) {
        const o = this.opts, P = this.player, hud = this.hud;
        switch (code) {
            case 'Digit1': o.culling = !o.culling; hud.toast(`Portal culling ${o.culling ? 'ON' : 'OFF'}`); break;
            case 'Digit2': o.freeze = !o.freeze; this.frozen = null; hud.toast(o.freeze ? 'Visibility frozen: fly around to inspect' : 'Visibility live'); break;
            case 'Digit3': o.mode = MASK_MODES[(MASK_MODES.indexOf(o.mode) + 1) % MASK_MODES.length]; hud.toast(`Portal masking: ${o.mode}`); break;
            case 'Digit4': o.portals = !o.portals; break;
            case 'Digit5': o.volumes = !o.volumes; break;
            case 'Digit6': o.occluders = !o.occluders; hud.toast(`Occluders ${o.occluders ? 'ON' : 'OFF'}`); break;
            case 'KeyM': o.map = !o.map; break;
            case 'KeyH': o.help = !o.help; break;
            case 'KeyR': if (P.driving) hud.toast(P.toggleHelm()); P.cam.reset(); P.reset(P.cam.pos); break;
            case 'KeyV': if (P.driving) hud.toast(P.toggleHelm()); o.walk = !o.walk; if (o.walk) P.reset(P.cam.pos); hud.toast(o.walk ? 'Walk mode' : 'Fly mode (noclip)'); break;
            case 'KeyN': o.island = !o.island; break;
            case 'KeyL': this.loader?.pick(); break;
            case 'KeyF': { const msg = P.toggleHelm(); if (msg) hud.toast(msg); else this.useDoor(); break; }
        }
    }

    // report the nearest door (all doors in the scenario are automatic, manual ones toggle)
    useDoor() {
        let best = null, bd = 4.5;
        for (const d of this.world.doors) {
            const dist = v3.dist(this.cam.pos, d.portal.center);
            if (dist < bd) { bd = dist; best = d; }
        }
        if (!best) { this.hud.toast('No door in reach'); return; }
        const r = best.toggle();
        if (r === 'locked') this.hud.toast(`${best.name}: LOCKED (portal flag Locked)`);
        else if (r === 'auto') this.hud.toast(`${best.name}: automatic door`);
        else this.hud.toast(`${best.name}: ${best.target > 0.5 ? 'opening' : 'closing'}`);
    }

    frame(now) {
        requestAnimationFrame(n => this.frame(n));
        try { this.tick(now); } catch (e) { this.onError(e); throw e; }
    }

    tick(now) {
        const dt = Math.min(0.05, (now - this.lastT) / 1000), t = now / 1000;
        this.lastT = now;
        const { canvas, renderer: R, world: w, opts: o, player, stats } = this;
        stats.fps = stats.fps * 0.93 + (1 / Math.max(dt, 1e-4)) * 0.07;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const W = Math.max(1, Math.floor(canvas.clientWidth * dpr)), H = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        R.resize(W, H);
        w.update(dt, t, [player.cam.pos]);        // vehicles first, so riding players use this frame's pose
        player.update(dt, this.input.keys);

        const { fwd, up } = player.basis(), eye = player.cam.pos;
        const proj = m4.perspective(player.cam.fov, W / H, 0.05, 400);
        const viewProj = m4.mul(proj, m4.lookAt(eye, v3.add(eye, fwd), up));

        const t0 = performance.now();
        let vis;
        if (o.freeze && this.frozen) vis = this.frozen.vis;
        else {
            vis = this.vis.compute(eye, viewProj, W, H, o.culling);
            if (!o.occluders) vis.occluders = [];
            if (o.freeze) this.frozen = { vis, eye: eye.slice(), basis: player.basis(), aspect: W / H };
        }
        // stencil masks and scissor rects only make sense for the view the traversal was computed for
        const mode = (!o.culling || o.freeze) ? 'none' : o.mode;
        const fr = this.frameBuilder.build(vis, mode, W, H);
        stats.visMs = stats.visMs * 0.9 + (performance.now() - t0) * 0.1;
        stats.draws = fr.cmds.filter(c => c.op === 'draw').length;
        stats.tris = fr.cmds.reduce((s, c) => s + (c.op === 'draw' ? c.chunk.count / 3 : 0), 0);
        stats.objs = fr.objs.length;
        this.frameStats = fr.stats;
        this.frameMode = mode;

        const lines = this.debugLines.build(vis, o, o.freeze ? this.frozen : null, player.cam.fov);
        R.render({ globals: this.globals(viewProj, eye, t, W, H, mode === 'stencil'), areas: w.lightingTable(t), draws: fr.draws, cmds: fr.cmds, polys: fr.polys, stencil: mode === 'stencil', lines: lines.data, lineDepthCount: lines.depthCount });

        if (o.map) this.minimap.draw(vis);
        this.mapCanvas.style.display = o.map ? 'block' : 'none';
        this.hud.tick(now, vis);
    }

    // Globals uniform: view-projection (+ inverse), eye, sun, sky colours, time, viewport and whether the
    // scene shader fogs through portals (stencil mode)
    globals(viewProj, eye, t, W, H, portalFog) {
        const sc = this.world.scn.outdoor || {}, g = new Float32Array(56);
        g.set(viewProj, 0);
        g.set(m4.invert(viewProj), 16);
        g.set([eye[0], eye[1], eye[2], 1], 32);
        g.set([...v3.norm(sc.sunDir || [0.4, 0.8, 0.3]), 0], 36);
        g.set([...(sc.sunColor || [1.2, 1.1, 1.0]), 1], 40);
        g.set([...(sc.skyTop || [0.3, 0.55, 1.3]), 1], 44);
        g.set([...(sc.skyHorizon || [1.0, 1.15, 1.35]), 1], 48);
        g.set([t, W, H, portalFog ? 1 : 0], 52);
        return g;
    }
}
