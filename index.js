import { loadMovingUIState } from '../../../power-user.js';
import { dragElement } from '../../../RossAscends-mods.js';
import { registerSlashCommand, executeSlashCommands } from '../../../slash-commands.js';

const extensionFolderPath = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const storageKey = 'SillyTavern-MapRegionLocator.projects';
const currentLoadedMap = 'Japan.Json';

const state = {
    projects: [],
    project: null,
    activeRegionId: null,
    tool: 'select',
    drawing: null,
    selectedRegionId: null,
    viewBox: { x: 0, y: 0, width: 1000, height: 1000 },
    pointer: null,
};

const markerIcons = {
    city: 'fa-city',
    castle: 'fa-chess-rook',
    dungeon: 'fa-dungeon',
    village: 'fa-house-chimney',
    camp: 'fa-campground',
    ruins: 'fa-landmark-dome',
    marker: 'fa-location-dot',
};

jQuery(async () => {
    loadProjects();
    addMenuButton();
    addSettingsPanel();
    registerSlashCommand('show-map', showMapCommand, ['mp'], '– opens the interactive map', true, true);
    registerSlashCommand('map-region-context', injectActiveRegionCommand, ['mrc'], '– injects the active map region lore', true, true);
});

function addMenuButton() {
    const button = $(`
        <div id="map_start" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-map" title="Open interactive map"></div>
            Open Map
        </div>`);

    $('#extensionsMenu').append(button);
    $('#map_start').on('click', showMap);
}

function addSettingsPanel() {
    const settings = $(`
        <div class="map_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Map Region Locator</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="map-settings-grid">
                        <label for="mapSelections">Project</label>
                        <select id="mapSelections" name="map-selection" class="text_pole"></select>
                        <button id="map_load" class="menu_button menu_button_icon" type="button">
                            <i class="fa-solid fa-folder-open"></i><span>Open</span>
                        </button>
                        <button id="map_new" class="menu_button menu_button_icon" type="button">
                            <i class="fa-solid fa-plus"></i><span>New</span>
                        </button>
                        <button id="map_import_json" class="menu_button menu_button_icon" type="button">
                            <i class="fa-solid fa-file-import"></i><span>Import JSON</span>
                        </button>
                    </div>
                    <input id="map_json_file" type="file" accept="application/json,.json" hidden>
                </div>
            </div>
        </div>`);

    $('#extensions_settings2').append(settings);
    refreshProjectSelect();
    $('#map_load').on('click', showMap);
    $('#map_new').on('click', openImportWizard);
    $('#map_import_json').on('click', () => $('#map_json_file').trigger('click'));
    $('#map_json_file').on('change', handleJsonImport);
}

function loadProjects() {
    try {
        state.projects = JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch {
        state.projects = [];
    }
}

function saveProjects() {
    localStorage.setItem(storageKey, JSON.stringify(state.projects));
    refreshProjectSelect();
}

function refreshProjectSelect() {
    const select = $('#mapSelections');
    if (!select.length) return;
    select.empty();
    state.projects.forEach((project) => {
        select.append(`<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`);
    });
    select.append('<option value="sample">Sample: Japan</option>');
    if (state.project?.id) select.val(state.project.id);
}

async function showMap() {
    makeMovable();
    const selected = $('#mapSelections').val();
    if (selected && selected !== 'sample') {
        const project = state.projects.find((item) => item.id === selected);
        if (!project) {
            toastr.warning('Map project not found');
            return;
        }
        state.project = clone(project);
        initMap(state.project);
        return;
    }

    await loadSampleMap();
}

async function loadSampleMap() {
    const mapPath = `${extensionFolderPath}/${currentLoadedMap}`;
    $.getJSON(mapPath, (svgData) => {
        if (svgData.backgroundImage) svgData.backgroundImage.file = `${extensionFolderPath}/Japan.png`;
        state.project = normalizeProject(svgData, 'Japan Sample');
        initMap(state.project);
        toastr.info('Map loaded');
    }).fail(() => {
        toastr.error('Error loading map data');
        console.error('Error loading map data');
    });
}

function initMap(project) {
    state.project = normalizeProject(project, project.name || 'Untitled Map');
    state.activeRegionId = null;
    state.selectedRegionId = null;
    state.viewBox = {
        x: 0,
        y: 0,
        width: Number(state.project.backgroundImage.width) || 1000,
        height: Number(state.project.backgroundImage.height) || 1000,
    };
    renderEditorShell();
    renderMap();
}

function normalizeProject(data, fallbackName) {
    const id = data.id || createId('map');
    const backgroundImage = data.backgroundImage || {};
    const regions = data.regions || (data.shapes || []).map((shape) => ({
        id: shape.id || createId('region'),
        name: shape.name || shape.id || 'Region',
        type: shape.type || 'region',
        description: shape.description || '',
        shapeType: 'polygon',
        path: shape.path,
        color: shape.color || '#3ca6ff',
        script: shape.script || '',
        tags: shape.tags || [],
        linkedLorebook: shape.linkedLorebook || '',
        metadata: shape.metadata || {},
    }));

    return {
        id,
        name: data.name || fallbackName || 'Untitled Map',
        map: data.map || backgroundImage.file || '',
        globalLore: data.globalLore || '',
        linkedLorebook: data.linkedLorebook || '',
        backgroundImage: {
            file: resolveAssetPath(backgroundImage.file || data.map || ''),
            width: Number(backgroundImage.width) || 1000,
            height: Number(backgroundImage.height) || 1000,
        },
        regions,
    };
}

function makeMovable(id = 'map') {
    $(`#${id}`).remove();
    const template = $('#generic_draggable_template').html();
    const newElement = $(template);
    newElement.css('background-color', 'var(--SmartThemeBlurTintColor)');
    newElement.attr('forChar', id);
    newElement.attr('id', id);
    newElement.find('.drag-grabber').attr('id', `${id}header`);
    newElement.find('.dragTitle').text('Map Region Locator');
    newElement.append('<div id="dragMap" class="map-region-locator"></div>');
    newElement.addClass('no-scrollbar map-shell');

    const closeButton = newElement.find('.dragClose');
    closeButton.attr('id', `${id}close`);
    closeButton.attr('data-related-id', id);

    $('body').append(newElement);
    loadMovingUIState();
    $(`.draggable[forChar="${id}"]`).css('display', 'block');
    dragElement(newElement);

    $('body').off('click.mapRegionLocatorClose').on('click.mapRegionLocatorClose', '.dragClose', function () {
        $(`#${$(this).data('related-id')}`).remove();
    });
}

function renderEditorShell() {
    $('#dragMap').html(`
        <div class="map-toolbar">
            <div class="map-tool-group">
                ${toolButton('select', 'fa-arrow-pointer', 'Select')}
                ${toolButton('pan', 'fa-hand', 'Pan')}
                ${toolButton('rectangle', 'fa-vector-square', 'Rectangle')}
                ${toolButton('polygon', 'fa-draw-polygon', 'Polygon')}
                ${toolButton('marker', 'fa-location-dot', 'Marker')}
            </div>
            <div class="map-tool-group">
                <button id="map_zoom_out" class="menu_button menu_button_icon" type="button" title="Zoom out"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
                <button id="map_zoom_in" class="menu_button menu_button_icon" type="button" title="Zoom in"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
                <button id="map_fit" class="menu_button menu_button_icon" type="button" title="Fit map"><i class="fa-solid fa-expand"></i></button>
                <button id="map_export" class="menu_button menu_button_icon" type="button" title="Export JSON"><i class="fa-solid fa-file-export"></i><span>Export</span></button>
                <button id="map_save_project" class="menu_button menu_button_icon" type="button" title="Save project"><i class="fa-solid fa-save"></i><span>Save</span></button>
            </div>
        </div>
        <div class="map-workspace">
            <svg id="svg-container" class="map-canvas" xmlns="http://www.w3.org/2000/svg"></svg>
            <div id="map_tooltip" class="map-tooltip"></div>
            <aside id="map_region_panel" class="map-region-panel"></aside>
        </div>`);

    $('.map-tool').on('click', function () {
        state.tool = $(this).data('tool');
        $('.map-tool').removeClass('active');
        $(this).addClass('active');
    });
    $(`.map-tool[data-tool="${state.tool}"]`).addClass('active');
    $('#map_zoom_in').on('click', () => zoomMap(0.8));
    $('#map_zoom_out').on('click', () => zoomMap(1.25));
    $('#map_fit').on('click', fitMap);
    $('#map_export').on('click', exportProject);
    $('#map_save_project').on('click', persistCurrentProject);
}

function toolButton(tool, icon, label) {
    return `<button class="menu_button menu_button_icon map-tool" data-tool="${tool}" type="button" title="${label}">
        <i class="fa-solid ${icon}"></i><span>${label}</span>
    </button>`;
}

function renderMap() {
    const svg = document.getElementById('svg-container');
    if (!svg || !state.project) return;
    svg.innerHTML = '';
    applyViewBox();

    const imageElement = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    imageElement.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', state.project.backgroundImage.file);
    imageElement.setAttribute('x', '0');
    imageElement.setAttribute('y', '0');
    imageElement.setAttribute('width', state.project.backgroundImage.width);
    imageElement.setAttribute('height', state.project.backgroundImage.height);
    imageElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.appendChild(imageElement);

    state.project.regions.forEach((region) => svg.appendChild(createRegionElement(region)));
    bindCanvasEvents(svg);
    renderRegionPanel();
}

function createRegionElement(region) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', region.shapeType === 'marker' ? 'g' : 'path');
    element.dataset.regionId = region.id;
    element.classList.add('svg-path');
    if (region.id === state.selectedRegionId) element.classList.add('selected');

    if (region.shapeType === 'marker') {
        const point = region.point || { x: 0, y: 0 };
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', point.x);
        circle.setAttribute('cy', point.y);
        circle.setAttribute('r', Math.max(state.viewBox.width, state.viewBox.height) / 90);
        circle.setAttribute('fill', region.color || '#f7c948');
        circle.setAttribute('stroke', '#111');
        circle.setAttribute('stroke-width', '3');
        element.appendChild(circle);
    } else {
        element.setAttribute('d', region.path || pointsToPath(region.points || []));
        element.setAttribute('fill', 'transparent');
        element.setAttribute('stroke', region.color || '#3ca6ff');
        element.setAttribute('stroke-width', '3');
    }

    element.addEventListener('click', (event) => {
        event.stopPropagation();
        selectRegion(region.id);
        if (state.tool === 'select') showRegionDetail(region.id);
    });
    element.addEventListener('mousemove', (event) => showTooltip(region, event));
    element.addEventListener('mouseleave', hideTooltip);
    element.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        openRegionConfig(region);
    });
    return element;
}

function bindCanvasEvents(svg) {
    svg.onpointerdown = (event) => {
        const point = svgPoint(event);
        if (state.tool === 'rectangle') startRectangle(point);
        if (state.tool === 'polygon') addPolygonPoint(point);
        if (state.tool === 'marker') createMarker(point);
        if (state.tool === 'pan') state.pointer = { x: event.clientX, y: event.clientY, viewBox: { ...state.viewBox } };
    };
    svg.onpointermove = (event) => {
        const point = svgPoint(event);
        if (state.drawing?.type === 'rectangle') updateRectangle(point);
        if (state.pointer && state.tool === 'pan') panMap(event);
    };
    svg.onpointerup = () => {
        if (state.drawing?.type === 'rectangle') finishRectangle();
        state.pointer = null;
    };
    svg.ondblclick = () => {
        if (state.drawing?.type === 'polygon' && state.drawing.points.length > 2) finishPolygon();
    };
    svg.onwheel = (event) => {
        event.preventDefault();
        zoomMap(event.deltaY > 0 ? 1.12 : 0.88);
    };
}

function startRectangle(point) {
    state.drawing = { type: 'rectangle', start: point, current: point };
}

function updateRectangle(point) {
    state.drawing.current = point;
    const preview = {
        id: 'preview',
        shapeType: 'polygon',
        path: rectanglePath(state.drawing.start, state.drawing.current),
        color: '#ffffff',
    };
    renderMap();
    document.getElementById('svg-container').appendChild(createRegionElement(preview));
}

function finishRectangle() {
    const region = createRegion('New Region', 'region', rectanglePath(state.drawing.start, state.drawing.current));
    state.drawing = null;
    state.project.regions.push(region);
    state.tool = 'select';
    renderEditorShell();
    renderMap();
    openRegionConfig(region);
}

function addPolygonPoint(point) {
    if (!state.drawing || state.drawing.type !== 'polygon') {
        state.drawing = { type: 'polygon', points: [] };
    }
    state.drawing.points.push(point);
    renderMap();
    const preview = createRegion('Drawing Polygon', 'region', pointsToPath(state.drawing.points, false));
    preview.id = 'preview';
    preview.color = '#ffffff';
    document.getElementById('svg-container').appendChild(createRegionElement(preview));
}

function finishPolygon() {
    const region = createRegion('New Region', 'region', pointsToPath(state.drawing.points));
    state.drawing = null;
    state.project.regions.push(region);
    state.tool = 'select';
    renderEditorShell();
    renderMap();
    openRegionConfig(region);
}

function createMarker(point) {
    const region = createRegion('New Marker', 'marker', '');
    region.shapeType = 'marker';
    region.point = point;
    region.type = 'city';
    state.project.regions.push(region);
    state.tool = 'select';
    renderEditorShell();
    renderMap();
    openRegionConfig(region);
}

function createRegion(name, type, path) {
    return {
        id: createId('region'),
        name,
        type,
        description: '',
        shapeType: type === 'marker' ? 'marker' : 'polygon',
        path,
        color: '#3ca6ff',
        tags: [],
        linkedLorebook: '',
        linkedCharacter: '',
        linkedScenario: '',
        linkedWorldInfo: '',
        linkedMemory: '',
        metadata: {
            faction: '',
            climate: '',
            dangerLevel: '',
            population: '',
            notes: '',
        },
        script: '',
    };
}

function renderRegionPanel() {
    const panel = $('#map_region_panel');
    if (!panel.length || !state.project) return;
    const activeRegion = getRegion(state.activeRegionId);
    panel.html(`
        <div class="map-panel-header">
            <strong>${escapeHtml(state.project.name)}</strong>
            <small>${state.project.regions.length} regions</small>
        </div>
        <div class="map-global-lore">${escapeHtml(state.project.globalLore || 'No global lore set.')}</div>
        <div class="map-region-list">
            ${state.project.regions.map((region) => `
                <button class="map-region-row ${region.id === state.selectedRegionId ? 'active' : ''}" data-region-id="${escapeHtml(region.id)}" type="button">
                    <i class="fa-solid ${markerIcons[region.type] || markerIcons.marker}"></i>
                    <span>${escapeHtml(region.name)}</span>
                </button>`).join('')}
        </div>
        <button id="map_inject_context" class="menu_button wide100p" type="button" ${activeRegion ? '' : 'disabled'}>
            Inject Active Region
        </button>`);

    $('.map-region-row').on('click', function () {
        selectRegion($(this).data('region-id'));
    });
    $('#map_inject_context').on('click', () => injectRegionContext(activeRegion));
}

function selectRegion(regionId) {
    state.selectedRegionId = regionId;
    state.activeRegionId = regionId;
    renderMap();
}

function showRegionDetail(regionId) {
    const region = getRegion(regionId);
    if (!region) return;
    openRegionConfig(region);
}

function openRegionConfig(region) {
    const modal = $(`
        <div class="map-modal-backdrop">
            <form class="map-modal">
                <header>
                    <strong>Region Configuration</strong>
                    <button class="menu_button menu_button_icon map-modal-close" type="button"><i class="fa-solid fa-xmark"></i></button>
                </header>
                <label>Region Name<input name="name" class="text_pole" value="${escapeAttribute(region.name)}"></label>
                <label>Description<textarea name="description" class="text_pole" rows="4">${escapeHtml(region.description || '')}</textarea></label>
                <div class="map-form-grid">
                    <label>Type
                        <select name="type" class="text_pole">
                            ${Object.keys(markerIcons).map((type) => `<option value="${type}" ${region.type === type ? 'selected' : ''}>${type}</option>`).join('')}
                        </select>
                    </label>
                    <label>Color<input name="color" type="color" value="${escapeAttribute(region.color || '#3ca6ff')}"></label>
                    <label>Faction<input name="faction" class="text_pole" value="${escapeAttribute(region.metadata?.faction || '')}"></label>
                    <label>Climate<input name="climate" class="text_pole" value="${escapeAttribute(region.metadata?.climate || '')}"></label>
                    <label>Danger Level<input name="dangerLevel" class="text_pole" value="${escapeAttribute(region.metadata?.dangerLevel || '')}"></label>
                    <label>Population<input name="population" class="text_pole" value="${escapeAttribute(region.metadata?.population || '')}"></label>
                </div>
                <label>Tags<input name="tags" class="text_pole" value="${escapeAttribute((region.tags || []).join(', '))}"></label>
                <label>Lorebook Entry<input name="linkedLorebook" class="text_pole" value="${escapeAttribute(region.linkedLorebook || '')}"></label>
                <label>Character Card<input name="linkedCharacter" class="text_pole" value="${escapeAttribute(region.linkedCharacter || '')}"></label>
                <label>Scenario<input name="linkedScenario" class="text_pole" value="${escapeAttribute(region.linkedScenario || '')}"></label>
                <label>World Info<input name="linkedWorldInfo" class="text_pole" value="${escapeAttribute(region.linkedWorldInfo || '')}"></label>
                <label>Tavern Memory<input name="linkedMemory" class="text_pole" value="${escapeAttribute(region.linkedMemory || '')}"></label>
                <label>Notes<textarea name="notes" class="text_pole" rows="3">${escapeHtml(region.metadata?.notes || '')}</textarea></label>
                <label>Optional STscript on click<textarea name="script" class="text_pole" rows="2">${escapeHtml(region.script || '')}</textarea></label>
                <footer>
                    <button class="menu_button danger" id="map_delete_region" type="button">Delete</button>
                    <button class="menu_button" id="map_inject_region" type="button">Inject Context</button>
                    <button class="menu_button" type="submit">Save</button>
                </footer>
            </form>
        </div>`);

    $('body').append(modal);
    modal.find('.map-modal-close').on('click', () => modal.remove());
    modal.find('#map_delete_region').on('click', () => {
        state.project.regions = state.project.regions.filter((item) => item.id !== region.id);
        modal.remove();
        renderMap();
    });
    modal.find('#map_inject_region').on('click', () => injectRegionContext(region));
    modal.find('form').on('submit', (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget).entries());
        Object.assign(region, {
            name: data.name.trim() || 'Unnamed Region',
            description: data.description.trim(),
            type: data.type,
            color: data.color,
            tags: data.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
            linkedLorebook: data.linkedLorebook.trim(),
            linkedCharacter: data.linkedCharacter.trim(),
            linkedScenario: data.linkedScenario.trim(),
            linkedWorldInfo: data.linkedWorldInfo.trim(),
            linkedMemory: data.linkedMemory.trim(),
            script: data.script.trim(),
            metadata: {
                faction: data.faction.trim(),
                climate: data.climate.trim(),
                dangerLevel: data.dangerLevel.trim(),
                population: data.population.trim(),
                notes: data.notes.trim(),
            },
        });
        modal.remove();
        persistCurrentProject(false);
        renderMap();
    });
}

function openImportWizard() {
    const modal = $(`
        <div class="map-modal-backdrop">
            <form class="map-modal">
                <header><strong>New Map Project</strong><button class="menu_button menu_button_icon map-modal-close" type="button"><i class="fa-solid fa-xmark"></i></button></header>
                <label>Project Name<input name="name" class="text_pole" required></label>
                <label>Map Image<input name="image" type="file" accept="image/png,image/jpeg,image/webp" required></label>
                <label>Do you already have a Lorebook related to this map?
                    <select name="hasLorebook" class="text_pole">
                        <option value="yes">Yes, link an existing Lorebook</option>
                        <option value="no">No, use short global context</option>
                    </select>
                </label>
                <label>Lorebook Name<input name="linkedLorebook" class="text_pole"></label>
                <label>Global Context<textarea name="globalLore" class="text_pole" rows="4" placeholder="Etheria adalah dunia fantasi dengan berbagai kerajaan..."></textarea></label>
                <footer><button class="menu_button" type="submit">Create</button></footer>
            </form>
        </div>`);

    $('body').append(modal);
    modal.find('.map-modal-close').on('click', () => modal.remove());
    modal.find('form').on('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const file = data.get('image');
        const image = await readImageFile(file);
        const project = normalizeProject({
            id: createId('map'),
            name: data.get('name'),
            map: file.name,
            globalLore: data.get('globalLore'),
            linkedLorebook: data.get('hasLorebook') === 'yes' ? data.get('linkedLorebook') : '',
            backgroundImage: {
                file: image.dataUrl,
                width: image.width,
                height: image.height,
            },
            regions: [],
        });
        state.project = project;
        persistCurrentProject(false);
        modal.remove();
        makeMovable();
        initMap(project);
    });
}

function handleJsonImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            state.project = normalizeProject(JSON.parse(reader.result), file.name.replace(/\.json$/i, ''));
            persistCurrentProject(false);
            makeMovable();
            initMap(state.project);
            toastr.info('Map project imported');
        } catch (error) {
            toastr.error('Invalid map project JSON');
            console.error(error);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function persistCurrentProject(showToast = true) {
    if (!state.project) return;
    const index = state.projects.findIndex((project) => project.id === state.project.id);
    const copy = clone(state.project);
    if (index >= 0) state.projects[index] = copy;
    else state.projects.push(copy);
    saveProjects();
    if (showToast) toastr.info('Map project saved');
}

function exportProject() {
    if (!state.project) return;
    const blob = new Blob([JSON.stringify(state.project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

function injectActiveRegionCommand() {
    const region = getRegion(state.activeRegionId);
    if (!region) {
        toastr.warning('No active map region selected');
        return '';
    }
    injectRegionContext(region);
    return '';
}

function injectRegionContext(region) {
    if (!region) return;
    state.activeRegionId = region.id;
    const context = buildRegionContext(region);
    executeSlashCommands(`/sys ${safeSlashText(context)}`);
    if (region.script) executeSlashCommands(region.script);
    toastr.info(`Injected map context: ${region.name}`);
}

function buildRegionContext(region) {
    const metadata = region.metadata || {};
    return [
        `[Map Context] Current Region: ${region.name}`,
        state.project.globalLore ? `Global Lore: ${state.project.globalLore}` : '',
        region.description ? `Region Lore: ${region.description}` : '',
        metadata.faction ? `Faction: ${metadata.faction}` : '',
        metadata.climate ? `Climate: ${metadata.climate}` : '',
        metadata.dangerLevel ? `Danger Level: ${metadata.dangerLevel}` : '',
        metadata.population ? `Population: ${metadata.population}` : '',
        region.tags?.length ? `Tags: ${region.tags.join(', ')}` : '',
        region.linkedLorebook ? `Linked Lorebook: ${region.linkedLorebook}` : '',
        region.linkedCharacter ? `Linked Character: ${region.linkedCharacter}` : '',
        region.linkedScenario ? `Linked Scenario: ${region.linkedScenario}` : '',
        region.linkedWorldInfo ? `Linked World Info: ${region.linkedWorldInfo}` : '',
        region.linkedMemory ? `Linked Tavern Memory: ${region.linkedMemory}` : '',
        metadata.notes ? `Notes: ${metadata.notes}` : '',
    ].filter(Boolean).join('\n');
}

function showTooltip(region, event) {
    const tooltip = $('#map_tooltip');
    tooltip.html(`<strong>${escapeHtml(region.name)}</strong><span>${escapeHtml(region.description || region.type || '')}</span>`);
    tooltip.css({ left: event.offsetX + 16, top: event.offsetY + 16, display: 'block' });
}

function hideTooltip() {
    $('#map_tooltip').hide();
}

function readImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
            const image = new Image();
            image.onload = () => resolve({ dataUrl: reader.result, width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = reject;
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function svgPoint(event) {
    const svg = document.getElementById('svg-container');
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
}

function panMap(event) {
    const scaleX = state.viewBox.width / $('#svg-container').width();
    const scaleY = state.viewBox.height / $('#svg-container').height();
    state.viewBox.x = state.pointer.viewBox.x - (event.clientX - state.pointer.x) * scaleX;
    state.viewBox.y = state.pointer.viewBox.y - (event.clientY - state.pointer.y) * scaleY;
    applyViewBox();
}

function zoomMap(factor) {
    const centerX = state.viewBox.x + state.viewBox.width / 2;
    const centerY = state.viewBox.y + state.viewBox.height / 2;
    state.viewBox.width *= factor;
    state.viewBox.height *= factor;
    state.viewBox.x = centerX - state.viewBox.width / 2;
    state.viewBox.y = centerY - state.viewBox.height / 2;
    applyViewBox();
}

function fitMap() {
    state.viewBox = {
        x: 0,
        y: 0,
        width: state.project.backgroundImage.width,
        height: state.project.backgroundImage.height,
    };
    applyViewBox();
}

function applyViewBox() {
    $('#svg-container').attr('viewBox', `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.width} ${state.viewBox.height}`);
}

function rectanglePath(start, end) {
    return `M ${start.x} ${start.y} L ${end.x} ${start.y} L ${end.x} ${end.y} L ${start.x} ${end.y} Z`;
}

function pointsToPath(points, close = true) {
    if (!points.length) return '';
    const lines = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`);
    if (close) lines.push('Z');
    return lines.join(' ');
}

function getRegion(regionId) {
    return state.project?.regions.find((region) => region.id === regionId);
}

function createId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function resolveAssetPath(value) {
    if (!value) return '';
    if (/^(data:|https?:|\/|scripts\/)/i.test(value)) return value;
    return `${extensionFolderPath}/${value}`;
}

function safeSlashText(value) {
    return String(value).replace(/\|/g, '¦');
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    }[char]));
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
}

function showMapCommand() {
    showMap();
    return '';
}
