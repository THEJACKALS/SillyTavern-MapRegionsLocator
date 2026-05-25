import { loadMovingUIState } from '../../../power-user.js';
import { dragElement } from '../../../RossAscends-mods.js';
import { executeSlashCommands } from '../../../slash-commands.js';
import { extension_prompt_roles, extension_prompt_types, setExtensionPrompt } from '../../../../script.js';

const viewerId = 'map_viewer';
const mapPromptKey = 'SillyTavern-MapRegionLocator.activeRegion';

const viewerState = {
    project: null,
    activeRegionId: null,
    viewBox: { x: 0, y: 0, width: 1000, height: 1000 },
    pointer: null,
    buildRegionContext: null,
    markerIcons: {},
};

let sendHookBound = false;
let isReplayingSend = false;

export function openMapViewer({ project, buildRegionContext, markerIcons }) {
    if (!project) return;
    viewerState.project = project;
    viewerState.activeRegionId = null;
    viewerState.buildRegionContext = buildRegionContext;
    viewerState.markerIcons = markerIcons || {};
    viewerState.viewBox = {
        x: 0,
        y: 0,
        width: Number(project.backgroundImage?.width) || 1000,
        height: Number(project.backgroundImage?.height) || 1000,
    };

    makeViewerMovable();
    renderViewerShell();
    renderViewerMap();
    ensureActiveRegionChip();
    bindMapViewerAutoInject();
}

function makeViewerMovable() {
    $(`#${viewerId}`).remove();
    const template = $('#generic_draggable_template').html();
    const newElement = $(template);
    newElement.css('background-color', 'var(--SmartThemeBlurTintColor)');
    newElement.attr('forChar', viewerId);
    newElement.attr('id', viewerId);
    newElement.find('.drag-grabber').attr('id', `${viewerId}header`);
    newElement.find('.dragTitle').text('Map Region Locator');
    newElement.append('<div id="dragMapViewer" class="map-region-locator map-viewer"></div>');
    newElement.addClass('no-scrollbar map-shell map-viewer-shell');

    const closeButton = newElement.find('.dragClose');
    closeButton.attr('id', `${viewerId}close`);
    closeButton.attr('data-related-id', viewerId);

    $('body').append(newElement);
    loadMovingUIState();
    $(`.draggable[forChar="${viewerId}"]`).css('display', 'block');
    bringToFront(newElement);
    dragElement(newElement);

    $('body').off('click.mapRegionViewerClose').on('click.mapRegionViewerClose', `#${viewerId} .dragClose`, function () {
        $(`#${$(this).data('related-id')}`).remove();
    });
    newElement.on('mousedown pointerdown focusin', () => bringToFront(newElement));
}

function bringToFront(element) {
    const maxZIndex = Math.max(
        100000,
        ...$('body *').map((_, item) => Number($(item).css('z-index')) || 0).get().filter((value) => value < 1000000),
    );
    element.css('z-index', maxZIndex + 10);
}

function renderViewerShell() {
    $('#dragMapViewer').html(`
        <div class="map-viewer-workspace">
            <svg id="map_viewer_svg" class="map-canvas map-viewer-canvas" xmlns="http://www.w3.org/2000/svg"></svg>
            <div id="map_viewer_tooltip" class="map-tooltip"></div>
            <aside id="map_viewer_panel" class="map-region-panel map-viewer-panel"></aside>
        </div>`);
}

function renderViewerMap() {
    const svg = document.getElementById('map_viewer_svg');
    if (!svg || !viewerState.project) return;
    svg.innerHTML = '';
    applyViewerViewBox();

    const imageElement = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    imageElement.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', viewerState.project.backgroundImage.file);
    imageElement.setAttribute('x', '0');
    imageElement.setAttribute('y', '0');
    imageElement.setAttribute('width', viewerState.project.backgroundImage.width);
    imageElement.setAttribute('height', viewerState.project.backgroundImage.height);
    imageElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.appendChild(imageElement);

    viewerState.project.regions.forEach((region) => svg.appendChild(createViewerRegionElement(region)));
    bindViewerCanvasEvents(svg);
    renderViewerPanel();
}

function createViewerRegionElement(region) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', region.shapeType === 'marker' ? 'g' : 'path');
    element.dataset.regionId = region.id;
    element.classList.add('svg-path');
    if (region.id === viewerState.activeRegionId) element.classList.add('selected');

    if (region.shapeType === 'marker') {
        const point = region.point || { x: 0, y: 0 };
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hitArea.setAttribute('cx', point.x);
        hitArea.setAttribute('cy', point.y);
        hitArea.setAttribute('r', Math.max(viewerState.viewBox.width, viewerState.viewBox.height) / 48);
        hitArea.setAttribute('fill', 'transparent');
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '1');
        hitArea.setAttribute('pointer-events', 'all');
        element.appendChild(hitArea);

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', point.x);
        circle.setAttribute('cy', point.y);
        circle.setAttribute('r', Math.max(viewerState.viewBox.width, viewerState.viewBox.height) / 90);
        circle.setAttribute('fill', region.color || '#f7c948');
        circle.setAttribute('stroke', '#111');
        circle.setAttribute('stroke-width', '3');
        element.appendChild(circle);
    } else {
        element.setAttribute('d', region.path || pointsToPath(region.points || []));
        element.setAttribute('fill', 'transparent');
        element.setAttribute('stroke', region.color || '#3ca6ff');
        element.setAttribute('stroke-width', '3');
        element.setAttribute('pointer-events', 'visibleStroke');
    }

    element.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
    element.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectViewerRegion(region.id);
    });
    element.addEventListener('mousemove', (event) => showViewerTooltip(region, event));
    element.addEventListener('mouseleave', hideViewerTooltip);
    return element;
}

function renderViewerPanel() {
    const panel = $('#map_viewer_panel');
    if (!panel.length || !viewerState.project) return;
    const activeRegion = getViewerRegion(viewerState.activeRegionId);
    panel.html(`
        <div class="map-panel-header">
            <strong>${escapeHtml(viewerState.project.name)}</strong>
            <small>${viewerState.project.regions.length} regions</small>
        </div>
        <div class="map-global-lore">${escapeHtml(activeRegion?.description || viewerState.project.globalLore || 'Select a region.')}</div>
        <div class="map-region-list">
            ${viewerState.project.regions.map((region) => `
                <button class="map-region-row ${region.id === viewerState.activeRegionId ? 'active' : ''}" data-region-id="${escapeHtml(region.id)}" type="button">
                    <i class="fa-solid ${viewerState.markerIcons[region.type] || viewerState.markerIcons.marker || 'fa-location-dot'}"></i>
                    <span>${escapeHtml(region.name)}</span>
                </button>`).join('')}
        </div>`);

    panel.find('.map-region-row').on('click', function () {
        selectViewerRegion($(this).data('region-id'));
    });
}

function selectViewerRegion(regionId) {
    viewerState.activeRegionId = regionId;
    renderViewerMap();
    updateActiveRegionChip();
    scrollViewerPanelToActiveRegion();
}

function scrollViewerPanelToActiveRegion() {
    const row = $(`#map_viewer_panel .map-region-row[data-region-id="${escapeSelector(viewerState.activeRegionId)}"]`);
    row[0]?.scrollIntoView?.({ block: 'nearest' });
}

function getViewerRegion(regionId) {
    return viewerState.project?.regions.find((region) => region.id === regionId);
}

function bindViewerCanvasEvents(svg) {
    svg.onpointerdown = (event) => {
        if (event.button !== 0 && event.button !== 1) return;
        event.preventDefault();
        viewerState.pointer = { x: event.clientX, y: event.clientY, viewBox: { ...viewerState.viewBox } };
        svg.setPointerCapture?.(event.pointerId);
    };
    svg.onpointermove = (event) => {
        if (!viewerState.pointer) return;
        panViewerMap(event);
    };
    svg.onpointerup = () => {
        viewerState.pointer = null;
    };
    svg.onpointerleave = () => {
        viewerState.pointer = null;
    };
    svg.onwheel = (event) => {
        event.preventDefault();
        zoomViewerMap(event.deltaY > 0 ? 1.12 : 0.88);
    };
}

function panViewerMap(event) {
    const scaleX = viewerState.viewBox.width / $('#map_viewer_svg').width();
    const scaleY = viewerState.viewBox.height / $('#map_viewer_svg').height();
    viewerState.viewBox.x = viewerState.pointer.viewBox.x - (event.clientX - viewerState.pointer.x) * scaleX;
    viewerState.viewBox.y = viewerState.pointer.viewBox.y - (event.clientY - viewerState.pointer.y) * scaleY;
    applyViewerViewBox();
}

function zoomViewerMap(factor) {
    const centerX = viewerState.viewBox.x + viewerState.viewBox.width / 2;
    const centerY = viewerState.viewBox.y + viewerState.viewBox.height / 2;
    viewerState.viewBox.width *= factor;
    viewerState.viewBox.height *= factor;
    viewerState.viewBox.x = centerX - viewerState.viewBox.width / 2;
    viewerState.viewBox.y = centerY - viewerState.viewBox.height / 2;
    applyViewerViewBox();
    renderViewerMap();
}

function applyViewerViewBox() {
    $('#map_viewer_svg').attr('viewBox', `${viewerState.viewBox.x} ${viewerState.viewBox.y} ${viewerState.viewBox.width} ${viewerState.viewBox.height}`);
}

function ensureActiveRegionChip() {
    if ($('#map_active_region_chip').length) {
        updateActiveRegionChip();
        return;
    }

    const chip = $(`
        <div id="map_active_region_chip" class="map-active-region-chip" style="display: none;">
            <i class="fa-solid fa-map-location-dot"></i>
            <span></span>
            <button class="map-token-remove" type="button" title="Clear active map region">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>`);

    const sendForm = $('#send_form');
    if (sendForm.length) sendForm.before(chip);
    else $('#send_textarea').before(chip);

    chip.find('button').on('click', () => {
        viewerState.activeRegionId = null;
        updateActiveRegionChip();
        renderViewerMap();
    });
    updateActiveRegionChip();
}

function updateActiveRegionChip() {
    const region = getViewerRegion(viewerState.activeRegionId);
    const chip = $('#map_active_region_chip');
    if (!chip.length) return;
    chip.toggle(Boolean(region));
    chip.find('span').text(region ? `Map: ${region.name}` : '');
}

function bindMapViewerAutoInject() {
    if (sendHookBound) return;
    const sendButton = document.getElementById('send_but');
    const textarea = document.getElementById('send_textarea');
    sendButton?.addEventListener('click', interceptSendForMapContext, true);
    textarea?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
        interceptSendForMapContext(event);
    }, true);
    sendHookBound = true;
}

async function interceptSendForMapContext(event) {
    if (isReplayingSend) return;
    const region = getViewerRegion(viewerState.activeRegionId);
    const userText = String($('#send_textarea').val() || '').trim();
    if (!region || !userText || typeof viewerState.buildRegionContext !== 'function') return;

    event?.preventDefault();
    event?.stopImmediatePropagation();

    const previousUserMessageCount = $('#chat .mes[is_user="true"]').length;
    const context = viewerState.buildRegionContext(region);
    setExtensionPrompt(mapPromptKey, context, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    if (region.script) executeSlashCommands(region.script);

    isReplayingSend = true;
    document.getElementById('send_but')?.click();
    decorateSentMessageWithMapRegion(region, previousUserMessageCount);
    viewerState.activeRegionId = null;
    updateActiveRegionChip();
    renderViewerMap();
    setTimeout(() => {
        isReplayingSend = false;
    }, 0);
    setTimeout(() => {
        setExtensionPrompt(mapPromptKey, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    }, 5000);
}

function decorateSentMessageWithMapRegion(region, previousUserMessageCount, attempt = 0) {
    const userMessages = $('#chat .mes[is_user="true"]');
    if (userMessages.length > previousUserMessageCount) {
        const message = userMessages.last();
        if (!message.find('.map-message-region').length) {
            const badge = $(`
                <div class="map-message-region">
                    <i class="fa-solid fa-map-location-dot"></i>
                    <span>Map: ${escapeHtml(region.name)}</span>
                </div>`);
            const block = message.find('.mes_block').first();
            if (block.length) block.prepend(badge);
            else message.prepend(badge);
        }
        return;
    }

    if (attempt < 20) {
        setTimeout(() => decorateSentMessageWithMapRegion(region, previousUserMessageCount, attempt + 1), 100);
    }
}

function showViewerTooltip(region, event) {
    const tooltip = $('#map_viewer_tooltip');
    tooltip.html(`<strong>${escapeHtml(region.name)}</strong><span>${escapeHtml(region.description || region.type || '')}</span>`);
    tooltip.css({ left: event.offsetX + 16, top: event.offsetY + 16, display: 'block' });
}

function hideViewerTooltip() {
    $('#map_viewer_tooltip').hide();
}

function pointsToPath(points, close = true) {
    if (!points.length) return '';
    const lines = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`);
    if (close) lines.push('Z');
    return lines.join(' ');
}

function escapeSelector(value) {
    if (window.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
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
