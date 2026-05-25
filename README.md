# SillyTavern Map Region Locator

Interactive map editor and chat map attachment extension for SillyTavern.

This extension turns a PNG/JPG/WEBP map into a saved map project with regions, markers, tags, lore references, character references, and chat-time context injection. It has two main modes:

- **Edit** from Extension Settings: build and configure the map.
- **Open Map** from the wand/extensions menu near the message bar: select a region while chatting and attach it to the next user message.

## Features

- Create map projects from uploaded PNG/JPG/WEBP images.
- Store map projects and images as physical files through SillyTavern's built-in file storage.
- Full MovingUI map editor with zoom, pan, rectangle, polygon, and marker tools.
- Region configuration popup with:
  - region name and description
  - type, color, faction, climate, danger level, population
  - tags
  - Lorebook Entry / Primary Keyword selector
  - World Info / Lorebook references
  - Character Card selector when the map is shared across multiple character cards
  - scenario, Tavern Memory, notes, and optional STscript on click
- New map setup can link existing World/Lorebooks.
- New map setup can mark whether the map is also used by other Character Cards.
- Primary keywords are pulled from attached World/Lorebooks and shown like tag selectors.
- Character Card choices are pulled from Character Management.
- Sidebar region list can open the region configuration in editor mode.
- Show-map mode displays only the map and markers, without editor tools.
- Clicking a marker or region in show-map mode attaches `Map: <region name>` above the chat input.
- Sending the next message injects that region context invisibly through an extension prompt and decorates the sent user message with the selected map region.
- Project export/import as JSON.
- Backward compatibility with the prototype `shapes` JSON format.

## Storage

This extension does not require changes to SillyTavern core files.

Saved map data uses SillyTavern's built-in `/api/files/upload` endpoint, so projects are available to other clients connected to the same SillyTavern server.

Physical files are stored under:

```text
data/default-user/user/files
```

The project index is saved as:

```text
SillyTavern-MapRegionLocator.projects.json
```

Uploaded map images are saved with names like:

```text
SillyTavern-MapRegionLocator.<map-id>.png
SillyTavern-MapRegionLocator.<map-id>.jpg
SillyTavern-MapRegionLocator.<map-id>.webp
```

Older browser-stored projects from IndexedDB/localStorage are migrated automatically when possible.

## Usage

### Create Or Edit A Map

1. Open **Extensions** settings.
2. Expand **Map Region Locator**.
3. Click **New** to create a map project, or **Edit** to open the selected project.
<img width="740" height="615" alt="image" src="https://github.com/user-attachments/assets/b1c30c88-28e3-4b35-942e-c1c76549f08b" />
4. Upload a PNG/JPG/WEBP map image.
5. Choose whether the map has related World/Lorebooks.
6. Choose whether this map is also used by other Character Cards.
7. Draw regions or place markers.
8. Configure each region.
9. Click **Save** in the editor.

### Use A Map In Chat

1. Open the wand/extensions menu near the message bar.
2. Click **Open Map**.
<img width="265" height="426" alt="image" src="https://github.com/user-attachments/assets/43a3c3ef-984b-44d1-b75d-3790b653654f" />
3. Select a marker or region.
<img width="1653" height="870" alt="image" src="https://github.com/user-attachments/assets/ba9bd62a-0e72-4fe8-9ca8-0c78226634fa" />
4. A chip like `Map: Forestome Hall` appears above the message box.
<img width="1071" height="492" alt="image" src="https://github.com/user-attachments/assets/c47f2aba-1b5e-4a0d-85e4-801e9452a0b7" />
5. Send your message.

The selected region context is injected invisibly for that message. The chat will show a small map badge on the user message, but it will not create a separate visible system message.

### Slash Commands

Open the editor:

```text
/show-map
```

Alias:

```text
/mp
```

Inject the currently active region context manually:

```text
/map-region-context
```

Alias:

```text
/mrc
```

## Region Fields

- **Tags**: short labels for classification, filtering, or compact injection, such as `trade`, `military`, `holy`, `dangerous`, or `forest`.
- **Lorebook Entry / Primary Keyword**: specific lore entry keyword from attached World/Lorebooks.
- **Character Card**: related characters from Character Management. This field is shown only when the map is marked as shared with other character cards.
- **Scenario**: story situation tied to the region.
- **World Info**: broader World/Lorebook references linked to the region.
- **Tavern Memory**: memory or persistent note related to the region.
- **Notes**: freeform private notes.
- **Optional STscript on click**: advanced automation script that can run when the region is selected or injected.

## Project JSON

Exported projects use this general structure:

```json
{
  "id": "map_abc123",
  "name": "Etheria Map",
  "map": "etheria_worldmap.png",
  "globalLore": "Etheria is a kingdom from the lore of Journey of the Lost Etheria.",
  "usesOtherCharacterCards": true,
  "linkedLorebook": ["Etheria Forbidden Portals"],
  "linkedLorebooks": ["Etheria Forbidden Portals", "Etheria Additional Lorebooks"],
  "backgroundImage": {
    "file": "/user/files/SillyTavern-MapRegionLocator.map_abc123.png",
    "width": 1792,
    "height": 1024
  },
  "regions": [
    {
      "id": "region_001",
      "name": "Forestome Hall",
      "type": "academy",
      "description": "An academy region tied to local lore.",
      "shapeType": "marker",
      "point": { "x": 320, "y": 540 },
      "color": "#ffffff",
      "tags": ["academy", "dwarf", "library"],
      "linkedLorebook": ["Forestome Hall"],
      "linkedWorldInfo": "Etheria Forbidden Portals, Etheria Additional Lorebooks",
      "linkedCharacterCard": ["Captain Rhea"],
      "metadata": {
        "faction": ["Scholar Guild"],
        "climate": "",
        "dangerLevel": "Neutral",
        "population": "2034",
        "notes": "Useful region for academy scenes."
      }
    }
  ]
}
```

The bundled `Japan.Json` sample still uses the original `shapes` format and is normalized automatically when loaded.
