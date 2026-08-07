# Web viewer

This workspace contains two dependency-free browser simulations.

## Run

From the repository root:

```powershell
.\scripts\serve-web.ps1
```

Open `http://127.0.0.1:4173/viewer-web/`.

- `wave.html`: **Ripple Tank**, a 2D surface-wave field with reflective rock obstacles
- `index.html`: **Flow Paint** and **Sparks**, the two GPU flow modes
- `liquid.html`: **Pour & Spill**, the particle liquid and open bowl

There is no backend simulation and no asset build. `index.html`, `styles.css`, and `app.js` are served as-is; all physics and rendering run in the browser.

## Interaction

- click or tap the liquid scenario for a short stream at that location
- hold to keep pouring; move while held to steer the stream and push nearby liquid
- multiple fingers pour and push independently in both live simulations
- drag its liquid over the open rim to spill it off screen
- tap or click clear water in **Ripple Tank** to create a ripple; waves interfere and reflect from the rocks
- drag or touch the ink mixer to inject momentum and color
- **Add fluid** / **Add ink** adds a larger impulse
- **Auto** toggles automatic input
- **Settings** contains gravity/swirl, surface response, and persistence controls
- the top-right controls reset, pause, toggle automatic flow, change scenes, and open settings
- the centered scene picker switches between **Ripple Tank**, **Flow Paint**, **Sparks**, and **Pour & Spill**
- clicking away from a menu or pressing Escape dismisses it
- Space pauses, Enter adds a burst, and M switches feel
