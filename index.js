import { loadMovingUIState } from '../../../power-user.js';
import { dragElement } from '../../../RossAscends-mods.js';
import { registerSlashCommand, executeSlashCommands } from '../../../slash-commands.js';
import { characters, getRequestHeaders } from '../../../../script.js';
import { world_names } from '../../../world-info.js';

const extensionFolderPath = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const storageKey = 'SillyTavern-MapRegionLocator.projects';
const databaseName = 'SillyTavern-MapRegionLocator';
const projectStoreName = 'projects';
const mapStorageIndexFile = 'SillyTavern-MapRegionLocator.projects.json';
const mapStorageFilePrefix = 'SillyTavern-MapRegionLocator';
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
    isTemporaryPan: false,
    lorebookNames: [],
    lorebookKeywordCache: {},
    undoStack: [],
    redoStack: [],
};

const markerIcons = {
    city: 'fa-city',
    castle: 'fa-chess-rook',
    dungeon: 'fa-dungeon',
    village: 'fa-house-chimney',
    camp: 'fa-campground',
    ruins: 'fa-landmark-dome',
    academy: 'fa-graduation-cap',
    fort: 'fa-shield-halved',
    cave: 'fa-mountain',
    port: 'fa-anchor',
    marker: 'fa-location-dot',
};

const defaultRegionTags = [
    'trade',
    'military',
    'dangerous',
    'safe',
    'capital',
    'settlement',
    'wilderness',
    'ruins',
    'dungeon',
    'academy',
    'fort',
    'cave',
    'market',
    'noble',
    'religious',
    'hidden',
    'quest',
    'portal',
    'faction',
    'travel',
    'port',
];

const dangerLevels = [
    'Friendly',
    'Neutral',
    'Low',
    'Medium',
    'High',
    'Hostile',
];

jQuery(async () => {
    await loadProjects();
    refreshLorebookNames();
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
    $('#map_start').on('click', showMapViewer);
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
                            <i class="fa-solid fa-pen-to-square"></i><span>Edit</span>
                        </button>
                        <button id="map_new" class="menu_button menu_button_icon" type="button">
                            <i class="fa-solid fa-plus"></i><span>New</span>
                        </button>
                        <button id="map_delete" class="menu_button menu_button_icon danger" type="button">
                            <i class="fa-solid fa-trash"></i><span>Delete</span>
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
    $(document).off('click.mapRegionLocatorNewProject', '#map_new');
    $(document).on('click.mapRegionLocatorNewProject', '#map_new', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openImportWizard();
    });
    $('#map_delete').on('click', deleteSelectedProject);
    $('#map_import_json').on('click', () => $('#map_json_file').trigger('click'));
    $('#map_json_file').on('change', handleJsonImport);
}

async function deleteSelectedProject() {
    const selected = String($('#mapSelections').val() || '');
    if (!selected || selected === 'sample') {
        toastr.warning('Sample map cannot be deleted');
        return;
    }

    const project = state.projects.find((item) => item.id === selected);
    if (!project) {
        toastr.warning('Map project not found');
        return;
    }

    if (!confirm(`Delete map project "${project.name}"? This cannot be undone.`)) return;

    await deleteStoredProject(project);

    state.projects = state.projects.filter((item) => item.id !== selected);
    if (state.project?.id === selected) {
        state.project = null;
        $('#map').remove();
    }

    await saveProjects();
    toastr.success('Map project deleted');
}

async function loadProjects() {
    try {
        state.projects = await getStoredProjects();
        await migrateLocalStorageProjects();
    } catch (error) {
        console.warn('Map Region Locator: failed to load projects', error);
        state.projects = [];
    }
}

async function saveProjects() {
    const savedProjects = await putStoredProjects(state.projects);
    if (Array.isArray(savedProjects)) {
        state.projects = savedProjects;
        if (state.project?.id) {
            const savedProject = state.projects.find((project) => project.id === state.project.id);
            if (savedProject) state.project = clone(savedProject);
        }
    }
    try {
        const index = state.projects.map((project) => ({ id: project.id, name: project.name }));
        localStorage.setItem(`${storageKey}.index`, JSON.stringify(index));
    } catch (error) {
        console.warn('Map Region Locator: failed to update project index cache', error);
    }
    refreshProjectSelect();
}

function openProjectDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(projectStoreName)) {
                db.createObjectStore(projectStoreName, { keyPath: 'id' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getStoredProjects() {
    try {
        const response = await fetch(`/user/files/${mapStorageIndexFile}?t=${Date.now()}`, { cache: 'no-cache' });
        if (response.status === 404) return [];
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const projects = await response.json();
        return Array.isArray(projects) ? projects.map(project => normalizeProject(project)) : [];
    } catch (error) {
        console.warn('Map Region Locator: server storage unavailable, falling back to browser storage', error);
        return getLegacyStoredProjects();
    }
}

async function getLegacyStoredProjects() {
    if (!('indexedDB' in window)) {
        return JSON.parse(localStorage.getItem(storageKey) || '[]');
    }

    const db = await openProjectDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(projectStoreName, 'readonly');
        const store = transaction.objectStore(projectStoreName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

async function putStoredProjects(projects) {
    try {
        const savedProjects = [];
        for (const project of projects) savedProjects.push(await saveProjectAssets(project));
        await uploadUserFile(mapStorageIndexFile, textToBase64(JSON.stringify(savedProjects, null, 2)));
        return savedProjects;
    } catch (error) {
        console.warn('Map Region Locator: failed to save to server storage, falling back to browser storage', error);
        await putLegacyStoredProjects(projects);
        return projects;
    }
}

async function putLegacyStoredProjects(projects) {
    if (!('indexedDB' in window)) {
        const slimProjects = projects.map((project) => ({
            ...project,
            backgroundImage: {
                ...project.backgroundImage,
                file: project.backgroundImage?.file?.startsWith('data:') ? '' : project.backgroundImage?.file || '',
            },
        }));
        localStorage.setItem(storageKey, JSON.stringify(slimProjects));
        return;
    }

    const db = await openProjectDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(projectStoreName, 'readwrite');
        const store = transaction.objectStore(projectStoreName);

        store.clear();
        projects.forEach((project) => store.put(project));

        transaction.oncomplete = () => {
            db.close();
            resolve();
        };
        transaction.onerror = () => {
            db.close();
            reject(transaction.error);
        };
        transaction.onabort = () => {
            db.close();
            reject(transaction.error);
        };
    });
}

async function deleteStoredProject(projectOrId) {
    try {
        const project = typeof projectOrId === 'object'
            ? projectOrId
            : state.projects.find(item => item.id === projectOrId);
        await deleteUserFile(project?.backgroundImage?.file);
    } catch (error) {
        console.warn('Map Region Locator: failed to delete from server storage', error);
    }
}

async function saveProjectAssets(project) {
    const copy = normalizeProject(project);
    const file = String(copy.backgroundImage?.file || '');
    if (!file.startsWith('data:')) return copy;

    const match = file.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid map image data');

    const extension = getImageExtension(match[1]);
    const fileName = `${mapStorageFilePrefix}.${safeStorageName(copy.id)}.${extension}`;
    await uploadUserFile(fileName, match[2]);
    copy.backgroundImage.file = `/user/files/${fileName}`;
    return copy;
}

async function uploadUserFile(name, base64Data) {
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            name,
            data: base64Data,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(error || `HTTP ${response.status}`);
    }
}

async function deleteUserFile(fileUrl) {
    const fileName = getUserFileName(fileUrl);
    if (!fileName) return;

    const response = await fetch('/api/files/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ path: `user/files/${fileName}` }),
    });

    if (!response.ok && response.status !== 404) {
        throw new Error(`HTTP ${response.status}`);
    }
}

function getUserFileName(fileUrl) {
    const match = String(fileUrl || '').match(/^\/?user\/files\/([^/?#]+)$/);
    return match ? decodeURIComponent(match[1]) : '';
}

function getImageExtension(mimeType) {
    switch (String(mimeType || '').toLowerCase()) {
        case 'image/png':
            return 'png';
        case 'image/jpeg':
            return 'jpg';
        case 'image/webp':
            return 'webp';
        default:
            throw new Error('Unsupported map image type');
    }
}

function textToBase64(value) {
    const bytes = new TextEncoder().encode(String(value));
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
}

function safeStorageName(value) {
    return String(value || '')
        .replace(/[^a-zA-Z0-9_.-]+/g, '_')
        .replace(/^\.+/, '')
        .slice(0, 80) || `map_${Date.now()}`;
}

async function migrateLocalStorageProjects() {
    const legacyProjects = localStorage.getItem(storageKey);
    const indexedDbProjects = await getLegacyStoredProjects().catch(() => []);

    try {
        const legacy = Array.isArray(indexedDbProjects) && indexedDbProjects.length
            ? indexedDbProjects
            : JSON.parse(legacyProjects || '[]');
        if (!Array.isArray(legacy) || !legacy.length) return;

        const existingIds = new Set(state.projects.map(project => project.id));
        const projects = legacy
            .map(project => normalizeProject(project))
            .filter(project => !existingIds.has(project.id));
        if (!projects.length) return;

        state.projects = [...state.projects, ...projects];
        const savedProjects = await putStoredProjects(state.projects);
        if (Array.isArray(savedProjects)) state.projects = savedProjects;
        localStorage.removeItem(storageKey);
    } catch (error) {
        console.warn('Map Region Locator: failed to migrate legacy projects', error);
    }
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
    const project = await getSelectedMapProject();
    if (!project) return;
    state.project = clone(project);
    initMap(state.project);
}

async function showMapViewer() {
    try {
        const project = await getSelectedMapProject();
        if (!project) return;
        state.project = clone(project);
        const { openMapViewer } = await import('./map-viewer.js');
        openMapViewer({
            project: state.project,
            buildRegionContext,
            markerIcons,
        });
    } catch (error) {
        console.error('Map Region Locator: failed to open viewer', error);
        toastr.error(`Failed to open map viewer: ${error.message || error}`);
    }
}

async function getSelectedMapProject() {
    const selected = $('#mapSelections').val();
    if (selected && selected !== 'sample') {
        const project = state.projects.find((item) => item.id === selected);
        if (!project) {
            toastr.warning('Map project not found');
            return null;
        }
        return normalizeProject(project, project.name || 'Untitled Map');
    }

    return await getSampleMapProject();
}

async function loadSampleMap() {
    const sampleProject = await getSampleMapProject();
    if (sampleProject) {
        state.project = sampleProject;
        initMap(state.project);
        toastr.info('Map loaded');
    }
}

async function getSampleMapProject() {
    try {
        const response = await fetch(`${extensionFolderPath}/${currentLoadedMap}`, { cache: 'no-cache' });
        if (!response.ok) throw new Error(response.statusText);
        const svgData = await response.json();
        if (svgData.backgroundImage) svgData.backgroundImage.file = `${extensionFolderPath}/Japan.png`;
        return normalizeProject(svgData, 'Japan Sample');
    } catch (error) {
        toastr.error('Error loading map data');
        console.error('Error loading map data', error);
        return null;
    }
}

function initMap(project) {
    state.project = normalizeProject(project, project.name || 'Untitled Map');
    state.activeRegionId = null;
    state.selectedRegionId = null;
    state.undoStack = [];
    state.redoStack = [];
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
        usesOtherCharacterCards: Boolean(data.usesOtherCharacterCards),
        linkedLorebook: normalizeLorebookLinks(data.linkedLorebook || data.linkedLorebooks),
        linkedLorebooks: normalizeLorebookLinks(data.linkedLorebooks || data.linkedLorebook),
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
    bringMapToFront(newElement);
    dragElement(newElement);

    $('body').off('click.mapRegionLocatorClose').on('click.mapRegionLocatorClose', '.dragClose', function () {
        $(`#${$(this).data('related-id')}`).remove();
    });
    newElement.on('mousedown pointerdown focusin', () => bringMapToFront(newElement));
    bindEditorHotkeys();
}

function bringMapToFront(element) {
    const maxZIndex = Math.max(
        100000,
        ...$('body *').map((_, item) => Number($(item).css('z-index')) || 0).get().filter((value) => value < 1000000),
    );
    element.css('z-index', maxZIndex + 10);
}

function bindEditorHotkeys() {
    $(document)
        .off('keydown.mapRegionLocator')
        .on('keydown.mapRegionLocator', (event) => {
            if (!$('#map').length) {
                $(document).off('keydown.mapRegionLocator');
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }

            const target = event.target;
            const isEditable = target?.matches?.('input, textarea, select, [contenteditable="true"]');
            if (isEditable || !state.project || !event.ctrlKey) return;

            const key = event.key.toLowerCase();
            if (key === 'z' && !event.shiftKey) {
                event.preventDefault();
                undoEditorChange();
                return;
            }

            if (key === 'y' || (key === 'z' && event.shiftKey)) {
                event.preventDefault();
                redoEditorChange();
            }
        });
}

function pushHistory() {
    if (!state.project) return;
    state.undoStack.push(clone(state.project));
    state.redoStack = [];
    if (state.undoStack.length > 60) state.undoStack.shift();
}

function restoreProjectSnapshot(snapshot) {
    if (!snapshot) return;
    state.project = clone(snapshot);
    state.activeRegionId = null;
    state.selectedRegionId = null;
    state.drawing = null;
    renderEditorShell();
    renderMap();
}

function undoEditorChange() {
    if (state.drawing?.type === 'polygon' && state.drawing.points.length) {
        state.drawing.points.pop();
        renderMap();
        if (state.drawing.points.length) {
            const preview = createRegion('Drawing Polygon', 'region', pointsToPath(state.drawing.points, false));
            preview.id = 'preview';
            preview.color = '#ffffff';
            document.getElementById('svg-container').appendChild(createRegionElement(preview));
        } else {
            state.drawing = null;
        }
        return;
    }

    const snapshot = state.undoStack.pop();
    if (!snapshot) {
        toastr.info('Nothing to undo');
        return;
    }

    state.redoStack.push(clone(state.project));
    restoreProjectSnapshot(snapshot);
}

function redoEditorChange() {
    const snapshot = state.redoStack.pop();
    if (!snapshot) {
        toastr.info('Nothing to redo');
        return;
    }

    state.undoStack.push(clone(state.project));
    restoreProjectSnapshot(snapshot);
}

async function saveProjectFromToolbar() {
    const button = $('#map_save_project');
    button.prop('disabled', true).addClass('disabled');
    try {
        await persistCurrentProject(true);
    } finally {
        button.prop('disabled', false).removeClass('disabled');
    }
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
    $('#map_save_project').on('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
            await saveProjectFromToolbar();
        } catch {
            // persistCurrentProject already reports the exact error through toastr.
        }
    });
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
        if (event.button === 1) {
            event.preventDefault();
            startTemporaryPan(event);
            return;
        }

        const point = svgPoint(event);
        if (state.tool === 'rectangle') startRectangle(point);
        if (state.tool === 'polygon') addPolygonPoint(point);
        if (state.tool === 'marker') createMarker(point);
        if (state.tool === 'pan') startPan(event);
    };
    svg.onpointermove = (event) => {
        const point = svgPoint(event);
        if (state.drawing?.type === 'rectangle') updateRectangle(point);
        if (state.pointer && (state.tool === 'pan' || state.isTemporaryPan)) panMap(event);
    };
    svg.onpointerup = () => {
        if (state.drawing?.type === 'rectangle') finishRectangle();
        state.pointer = null;
        state.isTemporaryPan = false;
    };
    svg.onpointerleave = () => {
        state.pointer = null;
        state.isTemporaryPan = false;
    };
    svg.onauxclick = (event) => {
        if (event.button === 1) event.preventDefault();
    };
    svg.ondblclick = () => {
        if (state.drawing?.type === 'polygon' && state.drawing.points.length > 2) finishPolygon();
    };
    svg.onwheel = (event) => {
        event.preventDefault();
        zoomMap(event.deltaY > 0 ? 1.12 : 0.88);
    };
}

function startPan(event) {
    state.pointer = { x: event.clientX, y: event.clientY, viewBox: { ...state.viewBox } };
    document.getElementById('svg-container')?.setPointerCapture?.(event.pointerId);
}

function startTemporaryPan(event) {
    state.isTemporaryPan = true;
    startPan(event);
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
    pushHistory();
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

    if (state.drawing.points.length >= 3 && isNearPoint(point, state.drawing.points[0])) {
        finishPolygon();
        return;
    }

    state.drawing.points.push(point);
    renderMap();
    const preview = createRegion('Drawing Polygon', 'region', pointsToPath(state.drawing.points, false));
    preview.id = 'preview';
    preview.color = '#ffffff';
    document.getElementById('svg-container').appendChild(createRegionElement(preview));
}

function isNearPoint(point, target) {
    const threshold = Math.max(state.viewBox.width, state.viewBox.height) / 70;
    return distance(point, target) <= threshold;
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function finishPolygon() {
    if (!state.drawing?.points || state.drawing.points.length < 3) return;
    pushHistory();
    const region = createRegion('New Region', 'region', pointsToPath(state.drawing.points));
    state.drawing = null;
    state.project.regions.push(region);
    state.tool = 'select';
    renderEditorShell();
    renderMap();
    openRegionConfig(region);
}

function createMarker(point) {
    pushHistory();
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
        linkedWorldInfo: getProjectLorebookLinksText(),
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

function getProjectLorebookLinksText() {
    return normalizeLorebookLinks(state.project?.linkedLorebooks || state.project?.linkedLorebook).join(', ');
}

function getRegionWorldInfo(region) {
    return String(region?.linkedWorldInfo || '').trim() || getProjectLorebookLinksText();
}

function projectUsesOtherCharacterCards() {
    return Boolean(state.project?.usesOtherCharacterCards);
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
        const regionId = $(this).data('region-id');
        selectRegion(regionId);
        showRegionDetail(regionId);
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
    const linkedWorldInfo = getRegionWorldInfo(region);
    const showCharacterCardField = projectUsesOtherCharacterCards();
    const modal = $(`
        <div class="map-modal-backdrop map-region-modal-backdrop">
            <form class="map-modal map-region-modal" novalidate>
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
                    <label>Faction
                        <div id="map_region_factions" class="map-token-selector"></div>
                    </label>
                    <label>Climate<input name="climate" class="text_pole" value="${escapeAttribute(region.metadata?.climate || '')}"></label>
                    <label>Danger Level
                        <select name="dangerLevel" class="text_pole">
                            <option value="">None</option>
                            ${dangerLevels.map((level) => `<option value="${escapeAttribute(level)}" ${region.metadata?.dangerLevel === level ? 'selected' : ''}>${escapeHtml(level)}</option>`).join('')}
                        </select>
                    </label>
                    <label>Population<input name="population" class="text_pole" value="${escapeAttribute(region.metadata?.population || '')}"></label>
                </div>
                <label>Tags
                    <div id="map_region_tags" class="map-token-selector"></div>
                </label>
                <label>Lorebook Entry / Primary Keyword
                    <div id="map_region_lorebook_entries" class="map-token-selector"></div>
                </label>
                ${showCharacterCardField ? `<label>Character Card
                    <div id="map_region_characters" class="map-token-selector"></div>
                </label>` : ''}
                <label>Scenario<input name="linkedScenario" class="text_pole" value="${escapeAttribute(region.linkedScenario || '')}"></label>
                <label>World Info<input name="linkedWorldInfo" class="text_pole" value="${escapeAttribute(linkedWorldInfo)}"></label>
                <label>Tavern Memory<input name="linkedMemory" class="text_pole" value="${escapeAttribute(region.linkedMemory || '')}"></label>
                <label>Notes<textarea name="notes" class="text_pole" rows="3">${escapeHtml(region.metadata?.notes || '')}</textarea></label>
                <label>Optional STscript on click<textarea name="script" class="text_pole" rows="2">${escapeHtml(region.script || '')}</textarea></label>
                <footer>
                    <button class="menu_button danger" id="map_delete_region" type="button">Delete</button>
                    <button class="menu_button" id="map_inject_region" type="button">Inject Context</button>
                    <button class="menu_button" id="map_save_region" type="submit">Save</button>
                </footer>
            </form>
        </div>`);

    $('body').append(modal);
    const tagSelector = createRegionTagSelector(modal.find('#map_region_tags'), region.tags || []);
    const factionSelector = createFactionSelector(modal.find('#map_region_factions'), region.metadata?.faction || []);
    const lorebookEntrySelector = createLorebookEntrySelector(modal.find('#map_region_lorebook_entries'), region.linkedLorebook || []);
    const characterSelector = showCharacterCardField
        ? createCharacterSelector(modal.find('#map_region_characters'), region.linkedCharacter || [])
        : null;
    const closeModal = () => {
        tagSelector.destroy();
        factionSelector.destroy();
        lorebookEntrySelector.destroy();
        characterSelector?.destroy();
        modal.remove();
    };

    modal.find('.map-modal-close').on('click', closeModal);
    modal.find('#map_delete_region').on('click', () => {
        pushHistory();
        state.project.regions = state.project.regions.filter((item) => item.id !== region.id);
        closeModal();
        renderMap();
    });
    modal.find('#map_inject_region').on('click', () => injectRegionContext(region));
    modal.find('#map_save_region').on('click', (event) => {
        event.preventDefault();
        modal.find('form')[0]?.requestSubmit();
    });
    modal.find('form').on('submit', async (event) => {
        event.preventDefault();
        const saveButton = modal.find('#map_save_region');
        saveButton.prop('disabled', true).text('Saving...');

        try {
            const data = Object.fromEntries(new FormData(event.currentTarget).entries());
            const field = (name) => String(data[name] ?? '').trim();
            pushHistory();
            Object.assign(region, {
                name: field('name') || 'Unnamed Region',
                description: field('description'),
                type: field('type') || 'region',
                color: field('color') || '#3ca6ff',
                tags: tagSelector.getSelected(),
                linkedLorebook: lorebookEntrySelector.getSelected(),
                linkedCharacter: showCharacterCardField ? characterSelector.getSelected() : '',
                linkedScenario: field('linkedScenario'),
                linkedWorldInfo: field('linkedWorldInfo') || getProjectLorebookLinksText(),
                linkedMemory: field('linkedMemory'),
                script: field('script'),
                metadata: {
                    faction: factionSelector.getSelected(),
                    climate: field('climate'),
                    dangerLevel: field('dangerLevel'),
                    population: field('population'),
                    notes: field('notes'),
                },
            });
            await persistCurrentProject(false);
            closeModal();
            renderMap();
            toastr.success('Region saved');
        } catch (error) {
            console.error('Map Region Locator: failed to save region', error);
            toastr.error(`Failed to save region: ${error.message || error}`);
            saveButton.prop('disabled', false).text('Save');
        }
    });
}

function openImportWizard() {
    $('.map-project-modal-backdrop').remove();
    const modal = $(`
        <div class="map-modal-backdrop map-project-modal-backdrop">
            <form class="map-modal map-project-modal" novalidate>
                <header><strong>New Map Project</strong><button class="menu_button menu_button_icon map-modal-close" type="button"><i class="fa-solid fa-xmark"></i></button></header>
                <label>Project Name<input name="name" class="text_pole"></label>
                <label>Map Image
                    <div class="map-image-picker">
                        <button id="map_choose_image" class="menu_button menu_button_icon" type="button">
                            <i class="fa-solid fa-image"></i><span>Choose Image</span>
                        </button>
                        <span id="map_image_name" class="map-image-name">No image selected</span>
                    </div>
                    <input id="map_image_file" name="image" class="map-file-input" type="file" accept="image/png,image/jpeg,image/webp">
                    <img id="map_image_preview" class="map-image-preview" alt="">
                </label>
                <label>Do you already have a Lorebook related to this map?
                    <select name="hasLorebook" class="text_pole">
                        <option value="yes">Yes, link an existing Lorebook</option>
                        <option value="no">No, use short global context</option>
                    </select>
                </label>
                <label>Is this Map also used by other Character Cards?
                    <select name="usesOtherCharacterCards" class="text_pole">
                        <option value="yes">Yes, I'm using this Card with other characters card than my main character.</option>
                        <option value="no">No, this card is only used with one character.</option>
                    </select>
                </label>
                <label class="map-lorebook-field">Linked Worlds / Lorebooks
                    <div id="map_project_lorebooks" class="map-token-selector"></div>
                </label>
                <label>Global Context<textarea name="globalLore" class="text_pole" rows="4" placeholder="Etheria adalah dunia fantasi dengan berbagai kerajaan..."></textarea></label>
                <footer><button id="map_create_project" class="menu_button" type="submit">Create</button></footer>
            </form>
        </div>`);

    $('body').append(modal);
    const lorebookSelector = createLorebookSelector(modal.find('#map_project_lorebooks'), []);
    modal.find('[name="hasLorebook"]').on('change', function () {
        modal.find('.map-lorebook-field').toggle($(this).val() === 'yes');
    }).trigger('change');
    modal.find('#map_choose_image').on('click', () => modal.find('#map_image_file').trigger('click'));
    modal.find('#map_image_file').on('change', function () {
        const file = this.files?.[0];
        const nameLabel = modal.find('#map_image_name');
        const preview = modal.find('#map_image_preview');
        if (!isValidImageFile(file)) {
            nameLabel.text('No image selected');
            preview.removeAttr('src').hide();
            return;
        }
        nameLabel.text(file.name);
        const previewUrl = URL.createObjectURL(file);
        preview.attr('src', previewUrl).show().one('load', () => URL.revokeObjectURL(previewUrl));
    });
    modal.find('.map-modal-close').on('click', () => {
        lorebookSelector.destroy();
        modal.remove();
    });
    let isCreatingProject = false;
    const createProject = async () => {
        if (isCreatingProject) return;
        const submitButton = modal.find('#map_create_project');
        submitButton.prop('disabled', true).text('Creating...');
        isCreatingProject = true;

        try {
            const form = modal.find('form')[0];
            const data = new FormData(form);
            const file = data.get('image');
            const projectName = String(data.get('name') || '').trim();

            if (!projectName) {
                toastr.warning('Project name is required');
                modal.find('[name="name"]').trigger('focus');
                return;
            }

            if (!isValidImageFile(file)) {
                toastr.warning('Please choose a PNG, JPG, or WEBP map image');
                modal.find('[name="image"]').trigger('focus');
                return;
            }

            const image = await readImageFile(file);
            const linkedLorebooks = data.get('hasLorebook') === 'yes' ? lorebookSelector.getSelected() : [];
            const project = normalizeProject({
                id: createId('map'),
                name: projectName,
                map: file.name,
                globalLore: data.get('globalLore'),
                usesOtherCharacterCards: data.get('usesOtherCharacterCards') === 'yes',
                linkedLorebook: linkedLorebooks,
                linkedLorebooks,
                backgroundImage: {
                    file: image.dataUrl,
                    width: image.width,
                    height: image.height,
                },
                regions: [],
            });
            state.project = project;
            await persistCurrentProject(false);
            lorebookSelector.destroy();
            modal.remove();
            makeMovable();
            initMap(state.project);
            toastr.success('Map project created');
        } catch (error) {
            console.error('Map Region Locator: failed to create project', error);
            toastr.error(`Failed to create map project: ${error.message || error}`);
        } finally {
            isCreatingProject = false;
            submitButton.prop('disabled', false).text('Create');
        }
    };

    modal.find('form').on('submit', async (event) => {
        event.preventDefault();
        await createProject();
    });
    modal.find('#map_create_project').on('click', async (event) => {
        event.preventDefault();
        await createProject();
    });
}

function handleJsonImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            state.project = normalizeProject(JSON.parse(reader.result), file.name.replace(/\.json$/i, ''));
            await persistCurrentProject(false);
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

async function persistCurrentProject(showToast = true) {
    if (!state.project) return;
    const index = state.projects.findIndex((project) => project.id === state.project.id);
    const copy = clone(state.project);
    if (index >= 0) state.projects[index] = copy;
    else state.projects.push(copy);
    try {
        await saveProjects();
        if (showToast) toastr.info('Map project saved');
    } catch (error) {
        console.error('Map Region Locator: failed to save project', error);
        toastr.error(`Failed to save map project: ${error.message || error}`);
        throw error;
    }
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
        state.project.linkedLorebooks?.length ? `Linked Map Lorebooks: ${state.project.linkedLorebooks.join(', ')}` : '',
        region.description ? `Region Lore: ${region.description}` : '',
        normalizeFactions(metadata.faction).length ? `Faction: ${normalizeFactions(metadata.faction).join(', ')}` : '',
        metadata.climate ? `Climate: ${metadata.climate}` : '',
        metadata.dangerLevel ? `Danger Level: ${metadata.dangerLevel}` : '',
        metadata.population ? `Population: ${metadata.population}` : '',
        region.tags?.length ? `Tags: ${region.tags.join(', ')}` : '',
        normalizeLorebookLinks(region.linkedLorebook).length ? `Linked Lorebook Entries: ${normalizeLorebookLinks(region.linkedLorebook).join(', ')}` : '',
        normalizeLorebookLinks(region.linkedCharacter).length ? `Linked Characters: ${normalizeLorebookLinks(region.linkedCharacter).join(', ')}` : '',
        region.linkedScenario ? `Linked Scenario: ${region.linkedScenario}` : '',
        getRegionWorldInfo(region) ? `Linked World Info: ${getRegionWorldInfo(region)}` : '',
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

function isValidImageFile(file) {
    return file instanceof File
        && file.size > 0
        && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
}

function svgPoint(event) {
    const svg = document.getElementById('svg-container');
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
    return { x: transformed.x, y: transformed.y };
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

function createRegionTagSelector(container, selectedValues = []) {
    const selected = normalizeTags(selectedValues);
    const element = $(`
        <div class="map-token-box">
            <div class="map-token-list"></div>
            <input class="map-token-input" type="text" autocomplete="off" placeholder="Type or choose region tags">
            <div class="map-token-suggestions"></div>
        </div>`);
    container.empty().append(element);

    const input = element.find('.map-token-input');
    const suggestions = element.find('.map-token-suggestions');
    const eventNamespace = `.mapRegionTagSelector_${createId('selector')}`;

    function render() {
        element.find('.map-token-list').html(selected.map((tag) => `
            <span class="map-token-chip" data-name="${escapeAttribute(tag)}">
                <span>${escapeHtml(tag)}</span>
                <button class="map-token-remove" data-name="${escapeAttribute(tag)}" type="button" title="Remove ${escapeAttribute(tag)}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </span>`).join(''));
    }

    function renderSuggestions() {
        const query = input.val().toLowerCase().trim();
        const names = getRegionTagNames()
            .filter((tag) => !selected.includes(tag))
            .filter((tag) => !query || tag.toLowerCase().includes(query))
            .slice(0, 14);

        const customTag = normalizeTag(input.val());
        const shouldOfferCustom = customTag && !selected.includes(customTag) && !names.includes(customTag);
        const customButton = shouldOfferCustom
            ? `<button class="map-token-suggestion" data-name="${escapeAttribute(customTag)}" type="button">
                <i class="fa-solid fa-plus"></i><span>Create "${escapeHtml(customTag)}"</span>
            </button>`
            : '';

        suggestions.html(`${customButton}${names.map((tag) => `
            <button class="map-token-suggestion" data-name="${escapeAttribute(tag)}" type="button">
                <i class="fa-solid fa-square-check"></i><span>${escapeHtml(tag)}</span>
            </button>`).join('')}`);
        suggestions.toggle((names.length > 0 || shouldOfferCustom) && document.activeElement === input[0]);
    }

    function add(tag) {
        const cleanTag = normalizeTag(tag);
        if (!cleanTag || selected.includes(cleanTag)) return;
        selected.push(cleanTag);
        input.val('');
        render();
        renderSuggestions();
    }

    function remove(tag) {
        const index = selected.indexOf(tag);
        if (index >= 0) selected.splice(index, 1);
        render();
        renderSuggestions();
    }

    element.on('mousedown click', '.map-token-remove', function (event) {
        event.preventDefault();
        event.stopPropagation();
        remove($(this).data('name'));
        input.trigger('focus');
    });

    element.on('mousedown click', '.map-token-suggestion', function (event) {
        event.preventDefault();
        event.stopPropagation();
        add($(this).data('name'));
        input.trigger('focus');
    });

    input.on('input focus', renderSuggestions);
    input.on('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const firstSuggestion = suggestions.find('.map-token-suggestion').first().data('name');
            add(firstSuggestion || input.val());
        }
        if (event.key === 'Backspace' && !input.val() && selected.length) {
            selected.pop();
            render();
            renderSuggestions();
        }
        if (event.key === 'Escape') suggestions.hide();
    });
    $(document).on(`mousedown${eventNamespace}`, (event) => {
        if (!element[0].contains(event.target)) suggestions.hide();
    });

    render();
    return {
        getSelected: () => [...selected],
        destroy: () => $(document).off(eventNamespace),
    };
}

function createFactionSelector(container, selectedValues = []) {
    const selected = normalizeFactions(selectedValues);
    const element = $(`
        <div class="map-token-box">
            <div class="map-token-list"></div>
            <input class="map-token-input" type="text" autocomplete="off" placeholder="Type or choose factions">
            <div class="map-token-suggestions"></div>
        </div>`);
    container.empty().append(element);

    const input = element.find('.map-token-input');
    const suggestions = element.find('.map-token-suggestions');
    const eventNamespace = `.mapFactionSelector_${createId('selector')}`;

    function render() {
        element.find('.map-token-list').html(selected.map((name) => `
            <span class="map-token-chip" data-name="${escapeAttribute(name)}">
                <span>${escapeHtml(name)}</span>
                <button class="map-token-remove" data-name="${escapeAttribute(name)}" type="button" title="Remove ${escapeAttribute(name)}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </span>`).join(''));
    }

    function renderSuggestions() {
        const query = input.val().toLowerCase().trim();
        const names = getFactionNames()
            .filter((name) => !selected.includes(name))
            .filter((name) => !query || name.toLowerCase().includes(query))
            .slice(0, 12);

        const customName = normalizeFaction(input.val());
        const shouldOfferCustom = customName && !selected.includes(customName) && !names.includes(customName);
        const customButton = shouldOfferCustom
            ? `<button class="map-token-suggestion" data-name="${escapeAttribute(customName)}" type="button">
                <i class="fa-solid fa-plus"></i><span>Create "${escapeHtml(customName)}"</span>
            </button>`
            : '';

        suggestions.html(`${customButton}${names.map((name) => `
            <button class="map-token-suggestion" data-name="${escapeAttribute(name)}" type="button">
                <i class="fa-solid fa-flag"></i><span>${escapeHtml(name)}</span>
            </button>`).join('')}`);
        suggestions.toggle((names.length > 0 || shouldOfferCustom) && document.activeElement === input[0]);
    }

    function add(name) {
        const cleanName = normalizeFaction(name);
        if (!cleanName || selected.includes(cleanName)) return;
        selected.push(cleanName);
        input.val('');
        render();
        renderSuggestions();
    }

    function remove(name) {
        const index = selected.indexOf(name);
        if (index >= 0) selected.splice(index, 1);
        render();
        renderSuggestions();
    }

    element.on('mousedown click', '.map-token-remove', function (event) {
        event.preventDefault();
        event.stopPropagation();
        remove($(this).data('name'));
        input.trigger('focus');
    });

    element.on('mousedown click', '.map-token-suggestion', function (event) {
        event.preventDefault();
        event.stopPropagation();
        add($(this).data('name'));
        input.trigger('focus');
    });

    input.on('input focus', renderSuggestions);
    input.on('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const firstSuggestion = suggestions.find('.map-token-suggestion').first().data('name');
            add(firstSuggestion || input.val());
        }
        if (event.key === 'Backspace' && !input.val() && selected.length) {
            selected.pop();
            render();
            renderSuggestions();
        }
        if (event.key === 'Escape') suggestions.hide();
    });
    $(document).on(`mousedown${eventNamespace}`, (event) => {
        if (!element[0].contains(event.target)) suggestions.hide();
    });

    render();
    return {
        getSelected: () => [...selected],
        destroy: () => $(document).off(eventNamespace),
    };
}

function createCharacterSelector(container, selectedValues = []) {
    const selected = normalizeLorebookLinks(selectedValues);
    const element = $(`
        <div class="map-token-box">
            <div class="map-token-list"></div>
            <input class="map-token-input" type="text" autocomplete="off" placeholder="Type or choose characters">
            <div class="map-token-suggestions"></div>
        </div>`);
    container.empty().append(element);

    const input = element.find('.map-token-input');
    const suggestions = element.find('.map-token-suggestions');
    const eventNamespace = `.mapCharacterSelector_${createId('selector')}`;

    function render() {
        element.find('.map-token-list').html(selected.map((name) => `
            <span class="map-token-chip" data-name="${escapeAttribute(name)}">
                <span>${escapeHtml(name)}</span>
                <button class="map-token-remove" data-name="${escapeAttribute(name)}" type="button" title="Remove ${escapeAttribute(name)}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </span>`).join(''));
    }

    function renderSuggestions() {
        const query = input.val().toLowerCase().trim();
        const names = getCharacterNames()
            .filter((name) => !selected.includes(name))
            .filter((name) => !query || name.toLowerCase().includes(query))
            .slice(0, 14);

        const customName = String(input.val() || '').trim();
        const shouldOfferCustom = customName && !selected.includes(customName) && !names.includes(customName);
        const customButton = shouldOfferCustom
            ? `<button class="map-token-suggestion" data-name="${escapeAttribute(customName)}" type="button">
                <i class="fa-solid fa-plus"></i><span>Create "${escapeHtml(customName)}"</span>
            </button>`
            : '';

        suggestions.html(`${customButton}${names.map((name) => `
            <button class="map-token-suggestion" data-name="${escapeAttribute(name)}" type="button">
                <i class="fa-solid fa-user"></i><span>${escapeHtml(name)}</span>
            </button>`).join('')}`);
        suggestions.toggle((names.length > 0 || shouldOfferCustom) && document.activeElement === input[0]);
    }

    function add(name) {
        const cleanName = String(name || '').trim();
        if (!cleanName || selected.includes(cleanName)) return;
        selected.push(cleanName);
        input.val('');
        render();
        renderSuggestions();
    }

    function remove(name) {
        const index = selected.indexOf(name);
        if (index >= 0) selected.splice(index, 1);
        render();
        renderSuggestions();
    }

    element.on('mousedown click', '.map-token-remove', function (event) {
        event.preventDefault();
        event.stopPropagation();
        remove($(this).data('name'));
        input.trigger('focus');
    });

    element.on('mousedown click', '.map-token-suggestion', function (event) {
        event.preventDefault();
        event.stopPropagation();
        add($(this).data('name'));
        input.trigger('focus');
    });

    input.on('input focus', renderSuggestions);
    input.on('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const firstSuggestion = suggestions.find('.map-token-suggestion').first().data('name');
            add(firstSuggestion || input.val());
        }
        if (event.key === 'Backspace' && !input.val() && selected.length) {
            selected.pop();
            render();
            renderSuggestions();
        }
        if (event.key === 'Escape') suggestions.hide();
    });
    $(document).on(`mousedown${eventNamespace}`, (event) => {
        if (!element[0].contains(event.target)) suggestions.hide();
    });

    render();
    return {
        getSelected: () => [...selected],
        destroy: () => $(document).off(eventNamespace),
    };
}

function createLorebookEntrySelector(container, selectedValues = []) {
    const selected = normalizeLorebookLinks(selectedValues);
    const element = $(`
        <div class="map-token-box">
            <div class="map-token-list"></div>
            <input class="map-token-input" type="text" autocomplete="off" placeholder="Type or choose primary keywords">
            <div class="map-token-suggestions"></div>
        </div>`);
    container.empty().append(element);

    const input = element.find('.map-token-input');
    const suggestions = element.find('.map-token-suggestions');
    const eventNamespace = `.mapLorebookEntrySelector_${createId('selector')}`;
    let availableKeywords = [];

    function render() {
        element.find('.map-token-list').html(selected.map((name) => `
            <span class="map-token-chip" data-name="${escapeAttribute(name)}">
                <span>${escapeHtml(name)}</span>
                <button class="map-token-remove" data-name="${escapeAttribute(name)}" type="button" title="Remove ${escapeAttribute(name)}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </span>`).join(''));
    }

    function renderSuggestions() {
        const query = input.val().toLowerCase().trim();
        const names = availableKeywords
            .filter((name) => !selected.includes(name))
            .filter((name) => !query || name.toLowerCase().includes(query))
            .slice(0, 14);

        suggestions.html(names.map((name) => `
            <button class="map-token-suggestion" data-name="${escapeAttribute(name)}" type="button">
                <i class="fa-solid fa-key"></i><span>${escapeHtml(name)}</span>
            </button>`).join(''));
        suggestions.toggle(names.length > 0 && document.activeElement === input[0]);
    }

    function add(name) {
        const cleanName = String(name || '').trim();
        if (!cleanName || selected.includes(cleanName)) return;
        selected.push(cleanName);
        input.val('');
        render();
        renderSuggestions();
    }

    function remove(name) {
        const index = selected.indexOf(name);
        if (index >= 0) selected.splice(index, 1);
        render();
        renderSuggestions();
    }

    element.on('mousedown click', '.map-token-remove', function (event) {
        event.preventDefault();
        event.stopPropagation();
        remove($(this).data('name'));
        input.trigger('focus');
    });

    element.on('mousedown click', '.map-token-suggestion', function (event) {
        event.preventDefault();
        event.stopPropagation();
        add($(this).data('name'));
        input.trigger('focus');
    });

    input.on('input focus', async () => {
        availableKeywords = await getProjectLorebookEntryKeywords();
        renderSuggestions();
    });
    input.on('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const firstSuggestion = suggestions.find('.map-token-suggestion').first().data('name');
            add(firstSuggestion || input.val());
        }
        if (event.key === 'Backspace' && !input.val() && selected.length) {
            selected.pop();
            render();
            renderSuggestions();
        }
        if (event.key === 'Escape') suggestions.hide();
    });
    $(document).on(`mousedown${eventNamespace}`, (event) => {
        if (!element[0].contains(event.target)) suggestions.hide();
    });

    getProjectLorebookEntryKeywords().then((names) => {
        availableKeywords = names;
    });
    render();
    return {
        getSelected: () => [...selected],
        destroy: () => $(document).off(eventNamespace),
    };
}

function createLorebookSelector(container, selectedValues = []) {
    const selected = normalizeLorebookLinks(selectedValues);
    const element = $(`
        <div class="map-token-box">
            <div class="map-token-list"></div>
            <input class="map-token-input" type="text" autocomplete="off" placeholder="Type to search Worlds / Lorebooks">
            <div class="map-token-suggestions"></div>
        </div>`);
    container.empty().append(element);

    const input = element.find('.map-token-input');
    const suggestions = element.find('.map-token-suggestions');
    const eventNamespace = `.mapLorebookSelector_${createId('selector')}`;

    function render() {
        element.find('.map-token-list').html(selected.map((name) => `
            <span class="map-token-chip" data-name="${escapeAttribute(name)}">
                <span>${escapeHtml(name)}</span>
                <button class="map-token-remove" data-name="${escapeAttribute(name)}" type="button" title="Remove ${escapeAttribute(name)}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </span>`).join(''));
    }

    function renderSuggestions() {
        const query = input.val().toLowerCase().trim();
        const names = getLorebookNames()
            .filter((name) => !selected.includes(name))
            .filter((name) => !query || name.toLowerCase().includes(query))
            .slice(0, 10);

        suggestions.html(names.map((name) => `
            <button class="map-token-suggestion" data-name="${escapeAttribute(name)}" type="button">
                <i class="fa-solid fa-book-atlas"></i><span>${escapeHtml(name)}</span>
            </button>`).join(''));
        suggestions.toggle(names.length > 0 && document.activeElement === input[0]);
    }

    function add(name) {
        const cleanName = String(name || '').trim();
        if (!cleanName || selected.includes(cleanName)) return;
        selected.push(cleanName);
        input.val('');
        render();
        renderSuggestions();
    }

    function remove(name) {
        const index = selected.indexOf(name);
        if (index >= 0) selected.splice(index, 1);
        render();
        renderSuggestions();
    }

    element.on('mousedown click', '.map-token-remove', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const name = $(this).data('name');
        remove(name);
        input.trigger('focus');
    });

    element.on('mousedown click', '.map-token-suggestion', function (event) {
        event.preventDefault();
        event.stopPropagation();
        add($(this).data('name'));
        input.trigger('focus');
    });

    input.on('input focus', () => {
        refreshLorebookNames().finally(renderSuggestions);
    });
    input.on('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const firstSuggestion = suggestions.find('.map-token-suggestion').first().data('name');
            if (firstSuggestion) add(firstSuggestion);
        }
        if (event.key === 'Backspace' && !input.val() && selected.length) {
            selected.pop();
            render();
            renderSuggestions();
        }
        if (event.key === 'Escape') suggestions.hide();
    });
    $(document).on(`mousedown${eventNamespace}`, (event) => {
        if (!element[0].contains(event.target)) suggestions.hide();
    });

    render();
    return {
        getSelected: () => [...selected],
        destroy: () => $(document).off(eventNamespace),
    };
}

function getLorebookNames() {
    const importedNames = Array.isArray(world_names) ? world_names : [];
    const domNames = $('#world_info option, .character_world_info_selector option, .character_extra_world_info_selector option')
        .map((_, option) => option.textContent || option.label || option.value)
        .get()
        .filter(Boolean)
        .map((name) => String(name).trim())
        .filter((name) => name && !name.startsWith('--'))
        .filter((name) => !/^\d+$/.test(name));
    return [...new Set([...state.lorebookNames, ...importedNames, ...domNames].map((name) => String(name).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function refreshLorebookNames() {
    try {
        const response = await fetch('/api/settings/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({}),
            cache: 'no-cache',
        });
        if (!response.ok) return;
        const data = await response.json();
        state.lorebookNames = Array.isArray(data.world_names)
            ? data.world_names.map((name) => String(name).trim()).filter(Boolean)
            : [];
    } catch (error) {
        console.warn('Map Region Locator: failed to refresh Worlds/Lorebooks list', error);
    }
}

async function getProjectLorebookEntryKeywords() {
    const lorebooks = normalizeLorebookLinks(state.project?.linkedLorebooks || state.project?.linkedLorebook);
    const keywordLists = await Promise.all(lorebooks.map(loadLorebookPrimaryKeywords));
    return [...new Set(keywordLists.flat().map((name) => String(name).trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}

async function loadLorebookPrimaryKeywords(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return [];
    if (Array.isArray(state.lorebookKeywordCache[cleanName])) return state.lorebookKeywordCache[cleanName];

    try {
        const response = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name: cleanName }),
            cache: 'no-cache',
        });
        if (!response.ok) return [];
        const data = await response.json();
        const keywords = Object.values(data.entries || {})
            .flatMap((entry) => Array.isArray(entry.key) ? entry.key : [])
            .map((keyword) => String(keyword).trim())
            .filter(Boolean);
        state.lorebookKeywordCache[cleanName] = [...new Set(keywords)].sort((a, b) => a.localeCompare(b));
        return state.lorebookKeywordCache[cleanName];
    } catch (error) {
        console.warn(`Map Region Locator: failed to load Lorebook keywords from ${cleanName}`, error);
        return [];
    }
}

function normalizeLorebookLinks(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (!value) return [];
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function getRegionTagNames() {
    const projectTags = (state.project?.regions || [])
        .flatMap((region) => normalizeTags(region.tags || []));
    return [...new Set([...defaultRegionTags, ...projectTags])]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
}

function getFactionNames() {
    const projectFactions = (state.project?.regions || [])
        .flatMap((region) => normalizeFactions(region.metadata?.faction || []));
    return [...new Set(projectFactions)]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
}

function getCharacterNames() {
    return [...new Set((characters || [])
        .map((character) => String(character?.name || '').trim())
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}

function normalizeTags(value) {
    if (Array.isArray(value)) return [...new Set(value.map(normalizeTag).filter(Boolean))];
    if (!value) return [];
    return [...new Set(String(value).split(',').map(normalizeTag).filter(Boolean))];
}

function normalizeTag(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '');
}

function normalizeFactions(value) {
    if (Array.isArray(value)) return [...new Set(value.map(normalizeFaction).filter(Boolean))];
    if (!value) return [];
    return [...new Set(String(value).split(',').map(normalizeFaction).filter(Boolean))];
}

function normalizeFaction(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function clone(value) {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (error) {
            console.warn('Map Region Locator: falling back to JSON clone', error);
        }
    }
    return JSON.parse(JSON.stringify(value, serializableReplacer));
}

function serializableReplacer(key, value) {
    if (
        value
        && typeof value === 'object'
        && typeof value.x === 'number'
        && typeof value.y === 'number'
        && (key === 'point' || key === 'start' || key === 'current' || typeof value.matrixTransform === 'function')
    ) {
        return { x: value.x, y: value.y };
    }

    return value;
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
