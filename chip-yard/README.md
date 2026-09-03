# Chip Yard

A fast reaction game for the Seasoned Tree Care website. You run the chipper. Material slides down the feed table toward a 12-inch drum chipper and you make the call on every piece before it hits the feed rollers.

Everything lives in one file, `index.html`. No build step, no dependencies, no external assets. All art is drawn on a canvas and all sound is synthesized in the browser.

## How to play

- **Too big?** Logs over 12" won't fit the throat. Swipe them off the table.
- **Rock or steel?** Fence posts and rocks wreck the blades. Swipe them off too.
- **Brush facing the wrong way?** Brush goes in butt-first. If the leafy tips are pointed at the chipper, turn it.
- **Good wood?** It rides in on its own. Shove it in early for a Quick Feed bonus.
- Tossing good wood costs points and breaks your combo. Letting a bad piece reach the rollers is a strike.
- 12 loads fill the chip truck. It drives off, the next one pulls in, the feed gets faster, and one strike is cleared.
- Three strikes and the yard shuts down.
- Logs carry a size tag for the first two trucks. From truck 3 on you judge the diameter by eye against the throat.
- Rocks start showing up on truck 2, steel on truck 3.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Toss off the table | ← / A / ↑ / W | swipe left or up on the piece, or the TOSS button |
| Turn it around | ↓ / S / T / Shift | tap the piece, or the TURN button |
| Feed it in | → / D / Space | swipe right on the piece, or the FEED button |
| Pause | P / Esc | ⏸ button |
| Mute | M | 🔊 button |
| New game | N | tap after game over |

Keyboard actions apply to the piece closest to the chipper, marked with a bouncing arrow. Touch actions apply to the piece you touched.

The best score and mute setting are stored in the browser's `localStorage`.

## Embedding on the site

Upload `index.html` somewhere on the site (for example `/chip-yard/index.html`) and drop this where the game should appear:

```html
<iframe
  src="/chip-yard/index.html"
  title="Chip Yard"
  style="width:100%;max-width:1100px;aspect-ratio:16/9;border:0;border-radius:12px;display:block;margin:0 auto"
  allow="autoplay"
  loading="lazy"></iframe>
```

On phones the game switches to a portrait layout with big TOSS / TURN / FEED buttons, so a taller frame such as `aspect-ratio:9/16` works well there. Or link straight to the page for a full-screen experience.

Nothing else on the site needs to change.
