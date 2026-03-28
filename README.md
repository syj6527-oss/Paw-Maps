# 🗺️ RP World Tracker v0.2.0-beta

SillyTavern extension that auto-detects locations from RP text and tracks scene movement on a map.

## Features

### 🔍 Auto Detection
- Korean + English location detection (4 methods)
- Auto-registration with edit/cancel toast
- Case-insensitive matching, name/adjective/transit filters

### 🗺️ Dual Map Mode
- **📊 Node Graph** — SVG map with drag, pinch zoom, pan
- **🌍 Real Map** — Leaflet with CartoDB Voyager tiles
- Toggle between modes in the panel

### 🔎 Nominatim Search (Leaflet mode)
- Search for real places by name
- Auto-match coordinates to registered locations
- Click search results to place on map

### 🤖 AI Prompt Injection
- Current scene location injected into AI context
- Memory modes: Natural (fades) / Perfect (exact)
- Visit stats, nearby locations, movement history

### 📱 Mobile Compatible
- Triple event system (RECEIVED + RENDERED + GENERATION_ENDED)
- Safe toastr wrappers
- Distance-based SVG hit testing
- Inline popover & toast (no fixed positioning issues)

### 🧭 Compass
- Custom SVG compass rose (N/S/E/W petals)
- Fixed position overlay on map

## File Structure (11 files)
```
manifest.json          — Extension metadata
index.js              — Entry point, events, CDN loader
db.js                 — IndexedDB wrapper
location-manager.js   — CRUD + movement tracking
detector.js           — Korean/English location detection
prompt-injector.js    — AI prompt generation
map-renderer.js       — SVG node graph (zoom/pan/drag)
leaflet-renderer.js   — Leaflet real map + Nominatim
ui-manager.js         — Panel UI, popover, toast, search
style.css             — Mobile-first responsive styles
README.md             — This file
```

## Installation
1. Copy to `SillyTavern/data/default-user/extensions/third-party/rp-world-tracker/`
2. Enable in SillyTavern extensions menu
3. Start an RP chat — locations auto-detected!

## Debug Mode
Tap the 💭 emoji in settings 5 times to toggle debug mode.

## Roadmap
- [ ] Extension-specific AI model for detection
- [ ] Location memory system (text → summary → decay)
- [ ] Character card region auto-detect
- [ ] Coordinate-based node auto-layout
- [ ] Custom place words setting
- [ ] Lorebook integration
