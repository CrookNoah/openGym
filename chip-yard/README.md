# Chip Yard

A wood-chipper arcade puzzler for the Seasoned Tree Care website. Feed the chipper, fill the truck, don't jam it.

Everything lives in one file, `index.html`. No build step, no dependencies, no external assets. All art is drawn on a canvas and all sound is synthesized in the browser.

## How to play

- Pieces of wood (logs, branches, brush, stumps) fall into the hopper. Fill a row to chip it.
- Four rows at once is a **Full Feed**. Back-to-back Full Feeds pay 1.5x.
- **Oversize logs** show up from level 2. They're 4x2 and won't fit anywhere nice. Hit **SAW** to cut any piece in half. Cuts cost fuel; you earn a can back every 4 rows chipped.
- **Rocks** show up from level 3, hidden in brush. Chipping a rock costs a blade. Saw the rock loose, then hard-drop it to toss it over the wall for points instead.
- Every 10 rows fills the truck. It drives off, the level goes up, the feed speeds up, and one blade is repaired.
- Lose by jamming the hopper or destroying all three blades.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | ← → or A D | swipe on the hopper, or ◀ ▶ |
| Rotate | ↑ / X / W (clockwise), Z / Ctrl (counter) | tap the hopper, or ⟲ ⟳ |
| Soft drop | ↓ or S | drag down, or ▼ |
| Hard drop / toss rock | Space | flick down, or DROP |
| Hold | C or Shift | HOLD |
| Chainsaw | F or E | SAW |
| Pause | P or Esc | ⏸ button |
| Mute | M | 🔊 button |

The high score and mute setting are stored in the browser's `localStorage`.

## Embedding on the site

Upload `index.html` somewhere on the site (for example `/chip-yard/index.html`) and drop this where the game should appear:

```html
<iframe
  src="/chip-yard/index.html"
  title="Chip Yard"
  style="width:100%;max-width:1100px;aspect-ratio:16/10;border:0;border-radius:12px;display:block;margin:0 auto"
  allow="autoplay"
  loading="lazy"></iframe>
```

On phones a taller frame works better, for example `aspect-ratio:9/16`. Or link straight to the page for a full-screen experience. The game adapts to landscape and portrait on its own.

Nothing else on the site needs to change.
