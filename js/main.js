'use strict';
// Entry point.

function showFallback(e) {
    console.error(e);
    document.getElementById('error-message').textContent = String(e && e.stack || e);
    document.getElementById('fallback').classList.add('show');
}

window.addEventListener('DOMContentLoaded', async () => {
    const game = new Game(document.getElementById('view'), document.getElementById('map'));
    game.renderer.onError = showFallback;
    game.onError = showFallback;
    window.portalDemo = game;       // handy from the devtools console: world, vis, cam, opts
    const loader = game.loader = new ScenarioLoader(game);
    try {
        await game.start();
        loader.attach();
        await loader.loadInitial();
    } catch (err) {
        showFallback(err);
    }
});
