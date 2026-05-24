# SillyTavern Map Region Locator

Interactive region mapping and lore injection extension for SillyTavern.

This extension turns a static PNG/JPG/WEBP map into an interactive map project with regions, markers, metadata, linked lore references, and contextual `/sys` injection for roleplay.

## Features

- Import a map image and create a saved project in browser storage
- Initial lore setup with either an existing Lorebook name or short global map context
- Fullscreen MovingUI map editor
- Zoom and pan
- Rectangle, polygon, and marker tools
- Region configuration popup with:
  - name and description
  - faction, climate, danger level, population, tags, notes
  - marker type such as city, castle, dungeon, village, camp, or ruins
  - linked Lorebook, Character Card, Scenario, World Info, and Tavern Memory references
  - optional STscript on click
- Hover tooltip and click-to-edit region details
- Context injection for the currently active region
- Project export/import as JSON
- Backward compatibility with the prototype `shapes` JSON format

## Usage

Open the extensions menu and click **Open Map**, or use:

```text
/show-map
```

To create a new map project:

1. Open **Map Region Locator** in extension settings.
2. Click **New**.
3. Upload a PNG/JPG/WEBP map image.
4. Choose whether the map already has a related Lorebook.
5. Add either a Lorebook name or a short global lore description.
6. Draw regions or place markers in the editor.
7. Save the project.

To inject the selected/active region context into chat:

```text
/map-region-context
```

Alias:

```text
/mrc
```

Clicking **Inject Active Region** in the side panel does the same thing.

## Project JSON

Map data is stored separately from the source image. Exported projects use this structure:

```json
{
  "id": "map_abc123",
  "name": "Etheria World Map",
  "map": "etheria_worldmap.png",
  "globalLore": "Etheria adalah dunia fantasi dengan berbagai kerajaan...",
  "linkedLorebook": "etheria_lore",
  "backgroundImage": {
    "file": "data:image/png;base64,...",
    "width": 1792,
    "height": 1024
  },
  "regions": [
    {
      "id": "silvaria_001",
      "name": "Silvaria",
      "type": "city",
      "description": "Kota perdagangan besar dengan pasar pusat dan barak militer.",
      "shapeType": "polygon",
      "path": "M 150 500 L 193 385 L 261 345 Z",
      "color": "#3ca6ff",
      "tags": ["trade", "military"],
      "linkedLorebook": "silvaria_lore",
      "metadata": {
        "faction": "Merchant League",
        "climate": "Temperate",
        "dangerLevel": "Medium",
        "population": "120000",
        "notes": "Controls the eastern trade road."
      }
    }
  ]
}
```

The bundled `Japan.Json` sample still uses the original `shapes` format and is normalized automatically when loaded.

## Notes

Projects created from uploaded images are stored in browser `localStorage`. Use **Export** to keep portable backups or move projects between SillyTavern installs.
