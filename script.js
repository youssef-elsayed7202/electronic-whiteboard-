(() => {
  'use strict';

  // =========================
  // Smart Study Board - v1.0
  // No external libraries required.
  // =========================

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const canvas = $('#boardCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const app = $('#app');
  const statusEl = $('#boardStatus');
  const modalHost = $('#modalHost');

  const BOARD_W = 2400;
  const BOARD_H = 1600;
  const STORAGE_KEY = 'youssef_smart_board_v2';
  const CALC_HISTORY_KEY = 'smartCalcHistory_v2';

  const storage = (() => {
    try {
      const probe = '__board_storage_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch {
      const memory = new Map();
      return {
        getItem: key => memory.has(key) ? memory.get(key) : null,
        setItem: (key, value) => memory.set(key, String(value)),
        removeItem: key => memory.delete(key),
        clear: () => memory.clear()
      };
    }
  })();

  const MAX_HISTORY = 25;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 3.5;

  const contentCanvas = document.createElement('canvas');
  contentCanvas.width = BOARD_W;
  contentCanvas.height = BOARD_H;

  const contentCtx = contentCanvas.getContext('2d');
  contentCtx.imageSmoothingEnabled = true;

  let state = loadState();

  let activeFolderId = state.folders[0].id;
  let activeBoardId = state.folders[0].boards[0].id;

  let tool = 'pen';
  let color = '#111827';
  let penSize = 5;
  let highlighter = false;
  let shapeType = 'line';
  let backgroundType = 'white';

  let dpr = 1;
  let viewW = 1;
  let viewH = 1;
  let zoom = 1;
  let viewX = 0;
  let viewY = 0;

  let pointerDown = false;
  let lastPoint = null;
  let lastPointerBoard = { x: 150, y: 150 };

  let currentShapeStart = null;
  let shapeBackupCanvas = null;

  let spacePanning = false;
  let panStart = null;

  let touchGesture = null;
  const activeTouchPointers = new Set();
  let gestureMode = false;

  let autoSaveTimer = null;
  let statusTimer = null;

  let timerInterval = null;
  let timerSeconds = 25 * 60;

  let selection = null;
  let selectionMoving = false;
  let moveBaseCanvas = null;
  let moveOffset = { x: 0, y: 0 };

  // -------------------------
  // Storage / state
  // -------------------------

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function now() {
    return new Date().toLocaleString('ar-EG');
  }

  function makeBoard(name = 'سبورة 1') {
    return {
      id: uid('board'),
      name,
      createdAt: now(),
      updatedAt: now(),
      background: 'white',
      data: null,
      history: [],
      future: []
    };
  }

  function defaultState() {
    const folder = {
      id: uid('folder'),
      name: 'مذاكرتي',
      createdAt: now(),
      boards: [makeBoard('سبورة 1')]
    };

    return {
      version: 2,
      active: {
        folderId: folder.id,
        boardId: folder.boards[0].id
      },
      folders: [folder]
    };
  }

  function normalizeLoadedState(parsed) {
    if (
      !parsed ||
      !Array.isArray(parsed.folders) ||
      parsed.folders.length === 0
    ) {
      return defaultState();
    }

    for (const folder of parsed.folders) {
      folder.id ||= uid('folder');
      folder.name ||= 'ملف بدون اسم';

      folder.boards = Array.isArray(folder.boards)
        ? folder.boards
        : [];

      if (!folder.boards.length) {
        folder.boards.push(makeBoard('سبورة 1'));
      }

      for (const board of folder.boards) {
        board.id ||= uid('board');
        board.name ||= 'سبورة';
        board.background ||= 'white';

        board.history = Array.isArray(board.history)
          ? board.history.slice(-MAX_HISTORY)
          : [];

        board.future = Array.isArray(board.future)
          ? board.future.slice(-MAX_HISTORY)
          : [];
      }
    }

    return parsed;
  }

  function loadState() {
    try {
      const raw = storage.getItem(STORAGE_KEY);

      return raw
        ? normalizeLoadedState(JSON.parse(raw))
        : defaultState();

    } catch (error) {
      console.error('State load failed:', error);
      return defaultState();
    }
  }

  function getFolder(folderId = activeFolderId) {
    return (
      state.folders.find(folder => folder.id === folderId) ||
      state.folders[0]
    );
  }

  function getBoard(
    boardId = activeBoardId,
    folder = getFolder()
  ) {
    return (
      folder?.boards.find(board => board.id === boardId) ||
      folder?.boards[0]
    );
  }

  function currentBoard() {
    return getBoard(activeBoardId, getFolder());
  }

  function encodeCanvas(canvasEl, quality = 0.78) {
    try {
      return canvasEl.toDataURL('image/webp', quality);
    } catch {
      return canvasEl.toDataURL('image/png');
    }
  }

  function saveState(showMessage = false) {
    try {
      state.active = {
        folderId: activeFolderId,
        boardId: activeBoardId
      };

      storage.setItem(
        STORAGE_KEY,
        JSON.stringify(state)
      );

      if (showMessage) {
        showStatus('تم الحفظ ✅');
      }

    } catch (error) {
      console.error('Save failed:', error);

      showStatus(
        'التخزين المحلي امتلأ. صدّر السبورات كصور ثم احذف نسخًا قديمة.'
      );
    }
  }

  function persistCurrentBoard(showMessage = false) {
    const board = currentBoard();

    if (!board) return;

    board.data = encodeCanvas(contentCanvas, 0.78);
    board.background = backgroundType;
    board.updatedAt = now();

    saveState(false);

    if (showMessage) {
      showStatus('تم حفظ السبورة ✅');
    }
  }

  function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);

    autoSaveTimer = setTimeout(() => {
      persistCurrentBoard(false);
    }, 650);

    showStatus('حفظ تلقائي…', true);
  }

  // -------------------------
  // UI status
  // -------------------------

  function showStatus(message, fade = false) {
    statusEl.textContent = message;

    statusEl.classList.remove('fade');

    clearTimeout(statusTimer);

    if (fade) {
      statusTimer = setTimeout(() => {
        statusEl.classList.add('fade');
      }, 1300);
    }
  }

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>'"]/g,
      ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[ch])
    );
  }

  function sanitizeFilename(name) {
    return (
      String(name)
        .replace(/[\\/:*?"<>|]/g, '-')
        .slice(0, 70) ||
      'board'
    );
  }

  // -------------------------
  // Viewport / rendering
  // -------------------------

  function clampView() {
    const visibleBoardW = viewW / zoom;
    const visibleBoardH = viewH / zoom;

    viewX = Math.max(
      0,
      Math.min(
        Math.max(0, BOARD_W - visibleBoardW),
        viewX
      )
    );

    viewY = Math.max(
      0,
      Math.min(
        Math.max(0, BOARD_H - visibleBoardH),
        viewY
      )
    );
  }

  function resizeVisibleCanvas() {
    const oldCssW = viewW;
    const oldCssH = viewH;

    viewW = Math.max(1, app.clientWidth);
    viewH = Math.max(1, app.clientHeight);

    dpr = Math.max(
      1,
      Math.min(window.devicePixelRatio || 1, 3)
    );

    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);

    canvas.style.width = `${viewW}px`;
    canvas.style.height = `${viewH}px`;

    if (oldCssW && oldCssH && zoom === 1) {
      viewX = Math.max(
        0,
        viewX + (oldCssW - viewW) / 2
      );

      viewY = Math.max(
        0,
        viewY + (oldCssH - viewH) / 2
      );
    }

    clampView();
    render();
  }

  function drawBackground(
    targetCtx,
    width,
    height,
    offsetX = 0,
    offsetY = 0,
    scale = 1
  ) {
    targetCtx.save();

    targetCtx.fillStyle =
      backgroundType === 'black'
        ? '#050505'
        : '#ffffff';

    targetCtx.fillRect(
      0,
      0,
      width,
      height
    );

    const stroke =
      backgroundType === 'black'
        ? '#303030'
        : '#d8dee8';

    targetCtx.strokeStyle = stroke;
    targetCtx.fillStyle = stroke;

    targetCtx.lineWidth =
      Math.max(0.7, 1 * scale);

    if (backgroundType === 'grid') {
      const step = 28;

      const startX =
        Math.floor(offsetX / step) * step;

      const endX =
        offsetX + width / scale;

      const startY =
        Math.floor(offsetY / step) * step;

      const endY =
        offsetY + height / scale;

      for (
        let x = startX;
        x <= endX;
        x += step
      ) {
        const sx =
          (x - offsetX) * scale;

        targetCtx.beginPath();
        targetCtx.moveTo(sx, 0);
        targetCtx.lineTo(sx, height);
        targetCtx.stroke();
      }

      for (
        let y = startY;
        y <= endY;
        y += step
      ) {
        const sy =
          (y - offsetY) * scale;

        targetCtx.beginPath();
        targetCtx.moveTo(0, sy);
        targetCtx.lineTo(width, sy);
        targetCtx.stroke();
      }
    }

    if (backgroundType === 'ruled') {
      const step = 30;

      const startY =
        Math.floor(offsetY / step) * step;

      const endY =
        offsetY + height / scale;

      for (
        let y = startY;
        y <= endY;
        y += step
      ) {
        const sy =
          (y - offsetY) * scale;

        targetCtx.beginPath();
        targetCtx.moveTo(0, sy);
        targetCtx.lineTo(width, sy);
        targetCtx.stroke();
      }
    }

    if (backgroundType === 'dots') {
      const step = 22;

      const startX =
        Math.floor(offsetX / step) * step;

      const endX =
        offsetX + width / scale;

      const startY =
        Math.floor(offsetY / step) * step;

      const endY =
        offsetY + height / scale;

      const radius =
        Math.max(0.75, scale);

      for (
        let x = startX;
        x <= endX;
        x += step
      ) {
        for (
          let y = startY;
          y <= endY;
          y += step
        ) {
          targetCtx.beginPath();

          targetCtx.arc(
            (x - offsetX) * scale,
            (y - offsetY) * scale,
            radius,
            0,
            Math.PI * 2
          );

          targetCtx.fill();
        }
      }
    }

    targetCtx.restore();
  }

  function render() {
    if (!viewW || !viewH) return;

    ctx.setTransform(
      1,
      0,
      0,
      1,
      0,
      0
    );

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    drawBackground(
      ctx,
      canvas.width,
      canvas.height,
      viewX,
      viewY,
      dpr * zoom
    );

    const sx = viewX;
    const sy = viewY;

    const sw = viewW / zoom;
    const sh = viewH / zoom;

    ctx.drawImage(
      contentCanvas,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      viewW * dpr,
      viewH * dpr
    );

    drawSelectionFrame();
  }

  function screenToBoard(clientX, clientY) {
    const rect =
      canvas.getBoundingClientRect();

    return {
      x:
        (clientX - rect.left) / zoom +
        viewX,

      y:
        (clientY - rect.top) / zoom +
        viewY
    };
  }

  function boardToScreen(x, y) {
    return {
      x: (x - viewX) * zoom,
      y: (y - viewY) * zoom
    };
  }

  function zoomAt(
    clientX,
    clientY,
    factor
  ) {
    const before =
      screenToBoard(
        clientX,
        clientY
      );

    zoom = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_ZOOM,
        zoom * factor
      )
    );

    const rect =
      canvas.getBoundingClientRect();

    const sx =
      clientX - rect.left;

    const sy =
      clientY - rect.top;

    viewX =
      before.x - sx / zoom;

    viewY =
      before.y - sy / zoom;

    clampView();
    render();
  }

  // -------------------------
  // Board load / save / history
  // -------------------------

  function clearContent() {
    contentCtx.setTransform(
      1,
      0,
      0,
      1,
      0,
      0
    );

    contentCtx.clearRect(
      0,
      0,
      BOARD_W,
      BOARD_H
    );
  }

  function loadImageIntoContent(dataUrl) {
    clearContent();

    if (!dataUrl) {
      render();
      return;
    }

    const image = new Image();

    image.onload = () => {
      contentCtx.clearRect(
        0,
        0,
        BOARD_W,
        BOARD_H
      );

      contentCtx.drawImage(
        image,
        0,
        0,
        BOARD_W,
        BOARD_H
      );

      render();
    };

    image.onerror = () => {
      showStatus(
        'تعذر فتح محتوى السبورة.'
      );

      render();
    };

    image.src = dataUrl;
  }

  function loadActiveBoard() {
    const board = currentBoard();

    if (!board) return;

    backgroundType =
      board.background || 'white';

    zoom = 1;
    viewX = 0;
    viewY = 0;

    selection = null;

    document
      .querySelector('.selection-box')
      ?.remove();

    loadImageIntoContent(board.data);

    refreshTitles();
  }

  function saveHistory() {
    const board = currentBoard();

    if (!board) return;

    board.history ||= [];
    board.future ||= [];

    board.history.push(
      encodeCanvas(
        contentCanvas,
        0.65
      )
    );

    if (
      board.history.length >
      MAX_HISTORY
    ) {
      board.history.shift();
    }

    board.future.length = 0;
  }

  async function restoreContentData(
    dataUrl
  ) {
    await new Promise(resolve => {
      if (!dataUrl) {
        clearContent();
        render();
        resolve();
        return;
      }

      const image = new Image();

      image.onload = () => {
        clearContent();

        contentCtx.drawImage(
          image,
          0,
          0,
          BOARD_W,
          BOARD_H
        );

        render();
        resolve();
      };

      image.onerror = () => {
        resolve();
      };

      image.src = dataUrl;
    });
  }

  async function undo() {
    const board = currentBoard();

    if (!board) return;

    board.history ||= [];
    board.future ||= [];

    if (!board.history.length) {
      return showStatus(
        'مفيش خطوة سابقة.'
      );
    }

    board.future.push(
      encodeCanvas(
        contentCanvas,
        0.65
      )
    );

    const previous =
      board.history.pop();

    await restoreContentData(
      previous
    );

    scheduleAutoSave();
  }

  async function redo() {
    const board = currentBoard();

    if (!board) return;

    board.history ||= [];
    board.future ||= [];

    if (!board.future.length) {
      return showStatus(
        'مفيش خطوة لإعادتها.'
      );
    }

    board.history.push(
      encodeCanvas(
        contentCanvas,
        0.65
      )
    );

    const next =
      board.future.pop();

    await restoreContentData(
      next
    );

    scheduleAutoSave();
  }

  function clearBoard() {
    saveHistory();

    clearContent();

    render();

    scheduleAutoSave();
  }

  // -------------------------
  // Drawing
  // -------------------------

  function setupStrokeContext() {
    contentCtx.lineCap = 'round';
    contentCtx.lineJoin = 'round';

    contentCtx.lineWidth =
      Math.max(1, penSize);

    contentCtx.strokeStyle = color;

    contentCtx.globalAlpha =
      highlighter ? 0.34 : 1;

    contentCtx.globalCompositeOperation =
      tool === 'eraser'
        ? 'destination-out'
        : 'source-over';
  }

  function beginStroke(point) {
    saveHistory();

    pointerDown = true;
    lastPoint = point;

    setupStrokeContext();

    contentCtx.beginPath();

    contentCtx.moveTo(
      point.x,
      point.y
    );

    contentCtx.lineTo(
      point.x + 0.01,
      point.y + 0.01
    );

    contentCtx.stroke();

    render();
  }

  function continueStroke(point) {
    if (
      !pointerDown ||
      !lastPoint
    ) {
      return;
    }

    setupStrokeContext();

    contentCtx.beginPath();

    contentCtx.moveTo(
      lastPoint.x,
      lastPoint.y
    );

    contentCtx.lineTo(
      point.x,
      point.y
    );

    contentCtx.stroke();

    lastPoint = point;

    render();
  }

  function endStroke() {
    if (!pointerDown) return;

    pointerDown = false;
    lastPoint = null;

    contentCtx.globalAlpha = 1;

    contentCtx.globalCompositeOperation =
      'source-over';

    highlighter = false;

    scheduleAutoSave();
  }

  function drawArrow(
    c,
    x1,
    y1,
    x2,
    y2
  ) {
    const angle =
      Math.atan2(
        y2 - y1,
        x2 - x1
      );

    const size =
      Math.max(
        10,
        penSize * 2.2
      );

    c.moveTo(x1, y1);
    c.lineTo(x2, y2);

    c.moveTo(x2, y2);

    c.lineTo(
      x2 -
        size *
          Math.cos(
            angle - Math.PI / 6
          ),

      y2 -
        size *
          Math.sin(
            angle - Math.PI / 6
          )
    );

    c.moveTo(x2, y2);

    c.lineTo(
      x2 -
        size *
          Math.cos(
            angle + Math.PI / 6
          ),

      y2 -
        size *
          Math.sin(
            angle + Math.PI / 6
          )
    );
  }

  function beginShape(point) {
    saveHistory();

    pointerDown = true;

    currentShapeStart = point;

    shapeBackupCanvas =
      document.createElement(
        'canvas'
      );

    shapeBackupCanvas.width =
      BOARD_W;

    shapeBackupCanvas.height =
      BOARD_H;

    shapeBackupCanvas
      .getContext('2d')
      .drawImage(
        contentCanvas,
        0,
        0
      );

    drawShape(point);
  }

  function drawShape(point) {
    if (
      !currentShapeStart ||
      !shapeBackupCanvas ||
      !pointerDown
    ) {
      return;
    }

    const start =
      currentShapeStart;

    contentCtx.clearRect(
      0,
      0,
      BOARD_W,
      BOARD_H
    );

    contentCtx.drawImage(
      shapeBackupCanvas,
      0,
      0
    );

    contentCtx.save();

    contentCtx.globalCompositeOperation =
      'source-over';

    contentCtx.globalAlpha = 1;

    contentCtx.strokeStyle = color;

    contentCtx.lineWidth =
      Math.max(1, penSize);

    contentCtx.lineCap = 'round';
    contentCtx.lineJoin = 'round';

    const x = start.x;
    const y = start.y;

    const w = point.x - x;
    const h = point.y - y;

    contentCtx.beginPath();

    if (shapeType === 'line') {
      contentCtx.moveTo(x, y);
      contentCtx.lineTo(
        point.x,
        point.y
      );

    } else if (
      shapeType === 'arrow'
    ) {
      drawArrow(
        contentCtx,
        x,
        y,
        point.x,
        point.y
      );

    } else if (
      shapeType === 'rect'
    ) {
      contentCtx.rect(
        x,
        y,
        w,
        h
      );

    } else if (
      shapeType === 'circle'
    ) {
      const radius =
        Math.hypot(w, h) / 2;

      contentCtx.arc(
        (x + point.x) / 2,
        (y + point.y) / 2,
        radius,
        0,
        Math.PI * 2
      );

    } else if (
      shapeType === 'triangle'
    ) {
      contentCtx.moveTo(
        (x + point.x) / 2,
        y
      );

      contentCtx.lineTo(
        point.x,
        point.y
      );

      contentCtx.lineTo(
        x,
        point.y
      );

      contentCtx.closePath();
    }

    contentCtx.stroke();

    contentCtx.restore();

    render();
  }

  function finishShape() {
    if (!pointerDown) return;

    pointerDown = false;

    currentShapeStart = null;
    shapeBackupCanvas = null;

    scheduleAutoSave();
  }

  function drawText(
    text,
    x,
    y,
    options = {}
  ) {
    if (!text) return;

    saveHistory();

    contentCtx.save();

    contentCtx.globalCompositeOperation =
      'source-over';

    contentCtx.globalAlpha = 1;

    conten
      function finishSelection() {
    if (!selection?.selecting) return;

    const r = {
      x: selection.x,
      y: selection.y,
      width: selection.width,
      height: selection.height
    };

    if (
      r.width < 4 ||
      r.height < 4
    ) {
      selection = null;

      document
        .querySelector('.selection-box')
        ?.remove();

      showStatus(
        'حدد مساحة أكبر شوية.'
      );

      return;
    }

    const sx = Math.max(
      0,
      Math.floor(r.x)
    );

    const sy = Math.max(
      0,
      Math.floor(r.y)
    );

    const sw = Math.min(
      BOARD_W - sx,
      Math.floor(r.width)
    );

    const sh = Math.min(
      BOARD_H - sy,
      Math.floor(r.height)
    );

    if (
      sw < 2 ||
      sh < 2
    ) {
      selection = null;
      return;
    }

    saveHistory();

    try {
      selection.buffer =
        contentCtx.getImageData(
          sx,
          sy,
          sw,
          sh
        );

      contentCtx.clearRect(
        sx,
        sy,
        sw,
        sh
      );

      selection.x = sx;
      selection.y = sy;
      selection.width = sw;
      selection.height = sh;
      selection.selecting = false;

      contentCtx.putImageData(
        selection.buffer,
        sx,
        sy
      );

      render();

      showStatus(
        'التحديد جاهز. اضغط جواه واسحبه لمكان جديد.'
      );

    } catch (error) {
      console.error(error);

      selection = null;

      showStatus(
        'التحديد كبير جدًا على الذاكرة المتاحة.'
      );
    }
  }

  function pointInsideSelection(point) {
    return Boolean(
      selection &&
      !selection.selecting &&
      point.x >= selection.x &&
      point.x <=
        selection.x +
        selection.width &&
      point.y >= selection.y &&
      point.y <=
        selection.y +
        selection.height
    );
  }

  function beginSelectionMove(point) {
    if (
      !selection?.buffer
    ) {
      return false;
    }

    saveHistory();

    moveBaseCanvas =
      document.createElement(
        'canvas'
      );

    moveBaseCanvas.width =
      BOARD_W;

    moveBaseCanvas.height =
      BOARD_H;

    const baseCtx =
      moveBaseCanvas.getContext(
        '2d'
      );

    baseCtx.drawImage(
      contentCanvas,
      0,
      0
    );

    baseCtx.clearRect(
      selection.x,
      selection.y,
      selection.width,
      selection.height
    );

    moveOffset = {
      x:
        point.x -
        selection.x,

      y:
        point.y -
        selection.y
    };

    selectionMoving = true;

    return true;
  }

  function moveSelectedTo(point) {
    if (
      !selectionMoving ||
      !selection?.buffer ||
      !moveBaseCanvas
    ) {
      return;
    }

    const maxX =
      BOARD_W -
      selection.width;

    const maxY =
      BOARD_H -
      selection.height;

    selection.x =
      Math.max(
        0,
        Math.min(
          maxX,
          point.x -
            moveOffset.x
        )
      );

    selection.y =
      Math.max(
        0,
        Math.min(
          maxY,
          point.y -
            moveOffset.y
        )
      );

    const baseCtx =
      moveBaseCanvas.getContext(
        '2d'
      );

    contentCtx.clearRect(
      0,
      0,
      BOARD_W,
      BOARD_H
    );

    contentCtx.drawImage(
      moveBaseCanvas,
      0,
      0
    );

    contentCtx.putImageData(
      selection.buffer,
      Math.round(selection.x),
      Math.round(selection.y)
    );

    render();
  }

  function finishSelectionMove() {
    if (!selectionMoving) return;

    selectionMoving = false;
    moveBaseCanvas = null;

    selection.originalX =
      selection.x;

    selection.originalY =
      selection.y;

    scheduleAutoSave();

    showStatus(
      'تم تحريك التحديد ✅',
      true
    );
  }

  // -------------------------
  // Files / folders / boards
  // -------------------------

  function refreshTitles() {
    const folder = getFolder();
    const board = currentBoard();

    $('#folderTitle').textContent =
      folder?.name || 'ملف';

    $('#boardTitle').textContent =
      board?.name || 'سبورة';
  }

  function renderManager() {
    const folderList =
      $('#folderList');

    const boardList =
      $('#boardList');

    if (
      !folderList ||
      !boardList
    ) {
      return;
    }

    folderList.innerHTML = '';

    for (
      const folder of state.folders
    ) {
      const item =
        document.createElement(
          'div'
        );

      item.className =
        `folder-item ${
          folder.id === activeFolderId
            ? 'active'
            : ''
        }`;

      item.innerHTML = `
        <div class="folder-main">
          <div class="item-name">
            📁 ${escapeHtml(folder.name)}
          </div>

          <div class="item-sub">
            ${folder.boards.length} سبورة
          </div>
        </div>

        <div class="item-actions">
          <button
            class="mini-btn"
            data-folder-action="rename"
            data-id="${folder.id}"
            title="إعادة تسمية">
            ✏️
          </button>
        </div>
      `;

      item.addEventListener(
        'click',
        event => {
          const btn =
            event.target.closest(
              '[data-folder-action]'
            );

          if (btn) {
            return renameFolder(
              btn.dataset.id
            );
          }

          const firstBoard =
            folder.boards[0];

          if (firstBoard) {
            switchBoard(
              folder.id,
              firstBoard.id
            );
          }
        }
      );

      folderList.appendChild(item);
    }

    const folder =
      getFolder();

    boardList.innerHTML = `
      <div class="panel-title">
        سبورات «${escapeHtml(folder.name)}»
      </div>
    `;

    for (
      const board of folder.boards
    ) {
      const item =
        document.createElement(
          'div'
        );

      item.className =
        'board-item';

      item.innerHTML = `
        <div class="board-main">
          <div class="item-name">
            📝 ${escapeHtml(board.name)}
          </div>

          <div class="item-sub">
            آخر تعديل:
            ${escapeHtml(
              board.updatedAt ||
              board.createdAt ||
              ''
            )}
          </div>
        </div>

        <div class="item-actions">

          <button
            class="mini-btn"
            data-board-action="rename"
            data-id="${board.id}">
            ✏️
          </button>

          <button
            class="mini-btn"
            data-board-action="move"
            data-id="${board.id}">
            📦
          </button>

          <button
            class="mini-btn"
            data-board-action="delete"
            data-id="${board.id}">
            🗑️
          </button>

        </div>
      `;

      item.addEventListener(
        'click',
        event => {
          const btn =
            event.target.closest(
              '[data-board-action]'
            );

          if (!btn) {
            return switchBoard(
              folder.id,
              board.id
            );
          }

          handleBoardAction(
            btn.dataset.boardAction,
            board.id
          );
        }
      );

      boardList.appendChild(item);
    }
  }

  function openManager() {
    persistCurrentBoard(false);

    renderManager();

    $('#manager')
      .classList
      .remove('hidden');
  }

  function closeManager() {
    $('#manager')
      .classList
      .add('hidden');
  }

  function switchBoard(
    folderId,
    boardId
  ) {
    persistCurrentBoard(false);

    const folder =
      state.folders.find(
        f => f.id === folderId
      );

    const board =
      folder?.boards.find(
        b => b.id === boardId
      );

    if (!folder || !board) {
      return;
    }

    activeFolderId =
      folderId;

    activeBoardId =
      boardId;

    state.active = {
      folderId,
      boardId
    };

    loadActiveBoard();

    renderManager();

    closeManager();

    showStatus(
      `فتحت: ${board.name}`
    );
  }

  function addFolder() {
    const name =
      prompt(
        'اسم الملف الجديد:',
        `ملف ${state.folders.length + 1}`
      )?.trim();

    if (!name) return;

    const folder = {
      id: uid('folder'),
      name,
      createdAt: now(),
      boards: [
        makeBoard('سبورة 1')
      ]
    };

    state.folders.push(folder);

    activeFolderId =
      folder.id;

    activeBoardId =
      folder.boards[0].id;

    clearContent();

    backgroundType =
      'white';

    loadActiveBoard();

    saveState(false);

    renderManager();

    closeManager();
  }

  function addBoard(
    folderId = activeFolderId
  ) {
    persistCurrentBoard(false);

    const folder =
      getFolder(folderId);

    const board =
      makeBoard(
        `سبورة ${folder.boards.length + 1}`
      );

    folder.boards.push(board);

    activeFolderId =
      folder.id;

    activeBoardId =
      board.id;

    clearContent();

    backgroundType =
      'white';

    zoom = 1;
    viewX = 0;
    viewY = 0;

    selection = null;

    render();

    refreshTitles();

    saveState(false);

    renderManager();

    closeManager();

    showStatus(
      'تم إنشاء سبورة جديدة ✨'
    );
  }

  function renameFolder(folderId) {
    const folder =
      state.folders.find(
        f => f.id === folderId
      );

    if (!folder) return;

    const name =
      prompt(
        'اسم الملف الجديد:',
        folder.name
      )?.trim();

    if (!name) return;

    folder.name = name;

    saveState(false);

    renderManager();

    refreshTitles();
  }

  function renameBoard(boardId) {
    const folder =
      getFolder();

    const board =
      folder.boards.find(
        b => b.id === boardId
      );

    if (!board) return;

    const name =
      prompt(
        'اسم السبورة الجديد:',
        board.name
      )?.trim();

    if (!name) return;

    board.name = name;
    board.updatedAt = now();

    saveState(false);

    renderManager();

    refreshTitles();
  }

  function moveBoard(boardId) {
    const source =
      getFolder();

    const boardIndex =
      source.boards.findIndex(
        b => b.id === boardId
      );

    if (boardIndex < 0) return;

    if (state.folders.length < 2) {
      return showStatus(
        'اعمل ملف تاني الأول عشان تنقل السبورة.'
      );
    }

    if (source.boards.length <= 1) {
      return showStatus(
        'مينفعش تنقل آخر سبورة في الملف؛ لازم يفضل فيه سبورة واحدة.'
      );
    }

    const options =
      state.folders
        .map(
          (folder, index) =>
            `${index + 1}. ${folder.name}`
        )
        .join('\n');

    const selected =
      Number(
        prompt(
          `اختار رقم الملف الهدف:\n\n${options}`
        )
      );

    const target =
      state.folders[
        selected - 1
      ];

    if (
      !target ||
      target.id === source.id
    ) {
      return;
    }

    const [board] =
      source.boards.splice(
        boardIndex,
        1
      );

    target.boards.push(board);

    if (activeBoardId === boardId) {
      const replacement =
        source.boards[0] ||
        target.boards[
          target.boards.length - 1
        ];

      activeFolderId =
        replacement
          ? (
              source.boards.includes(
                replacement
              )
                ? source.id
                : target.id
            )
          : source.id;

      activeBoardId =
        replacement?.id ||
        boardId;

      if (
        !getBoard(
          activeBoardId,
          getFolder()
        )
      ) {
        activeFolderId =
          target.id;
      }

      loadActiveBoard();
    }

    saveState(false);

    renderManager();

    refreshTitles();
  }

  function deleteBoard(boardId) {
    const folder =
      getFolder();

    if (folder.boards.length <= 1) {
      return showStatus(
        'لازم يفضل في كل ملف سبورة واحدة على الأقل.'
      );
    }

    const board =
      folder.boards.find(
        b => b.id === boardId
      );

    if (
      !board ||
      !confirm(
        `حذف «${board.name}» نهائيًا؟`
      )
    ) {
      return;
    }

    folder.boards =
      folder.boards.filter(
        b => b.id !== boardId
      );

    if (activeBoardId === boardId) {
      activeBoardId =
        folder.boards[0].id;

      loadActiveBoard();
    }

    saveState(false);

    renderManager();

    refreshTitles();
  }

  function handleBoardAction(
    action,
    id
  ) {
    if (action === 'rename') {
      renameBoard(id);

    } else if (
      action === 'move'
    ) {
      moveBoard(id);

    } else if (
      action === 'delete'
    ) {
      deleteBoard(id);
    }
  }

  // -------------------------
  // Tools / panels / modals
  // -------------------------

  function closePanels() {
    $('#quickColorPanel')
      .classList
      .add('hidden');

    $('#toolsPanel')
      .classList
      .add('hidden');

    $('#shapePanel')
      .classList
      .add('hidden');
  }

  function setTool(nextTool) {
    tool = nextTool;

    if (nextTool !== 'pen') {
      highlighter = false;
    }

    $$('.dock-btn[data-tool]')
      .forEach(button => {
        button.classList.toggle(
          'active',
          button.dataset.tool ===
            nextTool
        );
      });

    canvas.style.cursor =
      nextTool === 'text'
        ? 'text'
        : nextTool === 'select'
          ? 'move'
          : 'crosshair';

    closePanels();

    showStatus(
      {
        pen: 'القلم',
        eraser: 'الممحاة',
        select: 'التحديد',
        text: 'الكتابة'
      }[nextTool] ||
        nextTool,
      true
    );
  }

  function openTextModal(
    point = lastPointerBoard
  ) {
    openModal(
      `<h3>✍️ كتابة على السبورة</h3>
      <div class="field">
        <label>النص</label>
        <textarea
          id="textValue"
          dir="auto"
          placeholder="اكتب عربي أو English..."></textarea>
      </div>
      <div class="field">
        <label>حجم الخط</label>
        <input
          id="textSize"
          type="range"
          min="12"
          max="100"
          value="30">
        <output id="textSizeOut">
          30
        </output>
      </div>
      <div class="field">
        <label>نوع الخط</label>
        <select id="textWeight">
          <option value="500">عادي</option>
          <option value="700">Bold</option>
        </select>
      </div>
      <div class="modal-actions">
        <button
          class="primary-btn"
          id="addTextBtn">
          إضافة
        </button>

        <button
          class="secondary-btn close-generated">
          إلغاء
        </button>
      </div>`,

      modal => {
        const size =
          $('#textSize', modal);

        size.addEventListener(
          'input',
          () => {
            $('#textSizeOut', modal)
              .textContent =
              size.value;
          }
        );

        $('#addTextBtn', modal)
          .addEventListener(
            'click',
            () => {
              const value =
                $('#textValue', modal)
                  .value
                  .trim();

              if (!value) return;

              drawText(
                value,
                point.x,
                point.y,
                {
                  size:
                    Number(
                      size.value
                    ),

                  bold:
                    $('#textWeight', modal)
                      .value === '700'
                }
              );

              closeModal();
            }
          );

        $('#textValue', modal)
          .focus();
      }
    );
  }

  function openNoteModal(
    point = lastPointerBoard
  ) {
    openModal(
      `<h3>🗒️ ملاحظة</h3>
      <div class="field">
        <label>المحتوى</label>
        <textarea
          id="noteValue"
          placeholder="اكتب ملاحظة للمذاكرة..."></textarea>
      </div>
      <div class="field">
        <label>حجم النص</label>
        <input
          id="noteSize"
          type="range"
          min="14"
          max="44"
          value="22">
      </div>
      <div class="modal-actions">
        <button
          class="primary-btn"
          id="addNoteBtn">
          إضافة
        </button>

        <button
          class="secondary-btn close-generated">
          إلغاء
        </button>
      </div>`,

      modal => {
        $('#addNoteBtn', modal)
          .addEventListener(
            'click',
            () => {
              const value =
                $('#noteValue', modal)
                  .value
                  .trim();

              if (!value) return;

              drawNote(
                value,
                point.x,
                point.y,
                {
                  size:
                    Number(
                      $('#noteSize', modal)
                        .value
                    )
                }
              );

              closeModal();
            }
          );
      }
    );
  }

  function openBackgroundModal() {
    openModal(
      `<h3>🎨 خلفية السبورة</h3>

      <div class="bg-grid">

        <button
          class="bg-option bg-white"
          data-bg="white">
          أبيض
        </button>

        <button
          class="bg-option bg-black"
          data-bg="black">
          أسود
        </button>

        <button
          class="bg-option bg-gridlines"
          data-bg="grid">
          مربعات
        </button>

        <button
          class="bg-option bg-ruled"
          data-bg="ruled">
          مسطر
        </button>

        <button
          class="bg-option bg-dots"
          data-bg="dots">
          نقط
        </button>

      </div>

      <div class="modal-actions">
        <button
          class="secondary-btn close-generated">
          إغلاق
        </button>
      </div>`,

      modal => {
        $$('[data-bg]', modal)
          .forEach(button => {
            button.addEventListener(
              'click',
              () => {
                backgroundType =
                  button.dataset.bg;

                if (
                  backgroundType ===
                    'black' &&
                  color === '#111827'
                ) {
                  color = '#ffffff';
                }

                if (
                  backgroundType !==
                    'black' &&
                  color === '#ffffff'
                ) {
                  color = '#111827';
                }

                currentBoard()
                  .background =
                  backgroundType;

                render();

                scheduleAutoSave();

                closeModal();
              }
            );
          });
      }
    );
  }

  function openShapesPanel() {
    closePanels();

    $('#shapePanel')
      .classList
      .remove('hidden');
  }

  function openModal(
    innerHtml,
    setup
  ) {
    modalHost.innerHTML = `
      <div class="overlay modal-overlay">
        <div class="modal">
          ${innerHtml}
        </div>
      </div>
    `;

    const overlay =
      $('.modal-overlay', modalHost);

    overlay.addEventListener(
      'click',
      event => {
        if (
          event.target === overlay
        ) {
          closeModal();
        }
      }
    );

    $('.close-generated', overlay)
      ?.addEventListener(
        'click',
        closeModal
      );

    setup?.(
      $('.modal', overlay)
    );

    return $('.modal', overlay);
  }

  function closeModal() {
    modalHost.innerHTML = '';
  }

  function openCalculatorModal() {
    openModal(
      `<h3>🔢 الحسبة العلمية</h3>

      <div class="field">
        <input
          id="calcDisplay"
      function openGraphModal() {
    openModal(
      `<h3>📊 رسم بياني</h3>

      <div class="field">
        <label>y = f(x)</label>

        <input
          id="graphExpr"
          value="x*x"
          dir="ltr"
          autocomplete="off">
      </div>

      <div class="field">
        <label>من x إلى x</label>

        <input
          id="graphRange"
          value="-10,10"
          dir="ltr">
      </div>

      <div class="modal-actions">

        <button
          class="primary-btn"
          id="drawGraphBtn">
          ارسم على السبورة
        </button>

        <button
          class="secondary-btn close-generated">
          إلغاء
        </button>

      </div>`,

      modal => {
        $('#drawGraphBtn', modal)
          .addEventListener(
            'click',
            () => {
              const expression =
                $('#graphExpr', modal)
                  .value
                  .trim();

              const parts =
                $('#graphRange', modal)
                  .value
                  .split(',')
                  .map(Number);

              if (
                parts.length !== 2 ||
                !parts.every(
                  Number.isFinite
                ) ||
                parts[0] >= parts[1]
              ) {
                return showStatus(
                  'اكتب حدودًا مثل -10,10.'
                );
              }

              drawGraph(
                expression,
                parts[0],
                parts[1]
              );

              closeModal();
            }
          );
      }
    );
  }

  function makeGraphFunction(
    expression
  ) {
    try {
      let s =
        String(expression)
          .replace(
            /\s+/g,
            ''
          )
          .toLowerCase()
          .replace(
            /π/g,
            'pi'
          )
          .replace(
            /\^/g,
            '**'
          );

      s = s.replace(
        /\bpi\b/g,
        'PI'
      );

      if (
        !/^[0-9x+\-*/%().,_A-Za-z*]+$/.test(
          s
        )
      ) {
        return null;
      }

      if (
        /\b(?!x\b|PI\b|sin\b|cos\b|tan\b|sqrt\b|abs\b|log\b|exp\b|ln\b)[a-z_]+\b/i.test(
          s
        )
      ) {
        return null;
      }

      return Function(
        'x',
        'PI',
        'sin',
        'cos',
        'tan',
        'sqrt',
        'abs',
        'log',
        'exp',
        'ln',
        `"use strict"; return (${s})`
      );

    } catch {
      return null;
    }
  }

  function drawGraph(
    expression,
    minX,
    maxX
  ) {
    const fn =
      makeGraphFunction(
        expression
      );

    if (!fn) {
      return showStatus(
        'الدالة غير صحيحة. استخدم x مع sin/cos/tan/sqrt/abs/log/exp/ln أو pi.'
      );
    }

    saveHistory();

    const centerX =
      viewX +
      (viewW / zoom) / 2;

    const centerY =
      viewY +
      (viewH / zoom) / 2;

    const scale =
      Math.max(
        12,
        Math.min(
          45,
          (viewW / zoom) /
            (maxX - minX + 4)
        )
      );

    contentCtx.save();

    contentCtx.globalCompositeOperation =
      'source-over';

    contentCtx.strokeStyle =
      '#64748b';

    contentCtx.lineWidth = 1;

    contentCtx.beginPath();

    contentCtx.moveTo(
      viewX,
      centerY
    );

    contentCtx.lineTo(
      viewX +
        viewW / zoom,
      centerY
    );

    contentCtx.moveTo(
      centerX,
      viewY
    );

    contentCtx.lineTo(
      centerX,
      viewY +
        viewH / zoom
    );

    contentCtx.stroke();

    contentCtx.fillStyle =
      '#64748b';

    contentCtx.font =
      '13px system-ui, Arial';

    for (
      let x = Math.ceil(minX);
      x <= maxX;
      x += 1
    ) {
      const px =
        centerX +
        x * scale;

      if (
        px < viewX ||
        px >
          viewX +
            viewW / zoom
      ) {
        continue;
      }

      contentCtx.beginPath();

      contentCtx.moveTo(
        px,
        centerY - 4
      );

      contentCtx.lineTo(
        px,
        centerY + 4
      );

      contentCtx.stroke();

      contentCtx.fillText(
        String(x),
        px + 3,
        centerY + 7
      );
    }

    contentCtx.strokeStyle =
      color;

    contentCtx.lineWidth =
      Math.max(
        1,
        penSize
      );

    contentCtx.lineCap =
      'round';

    contentCtx.beginPath();

    let started = false;

    const samples =
      Math.max(
        500,
        Math.floor(
          viewW * 1.5
        )
      );

    for (
      let i = 0;
      i <= samples;
      i += 1
    ) {
      const x =
        minX +
        (maxX - minX) *
          (i / samples);

      let y;

      try {
        y = Number(
          fn(
            x,
            Math.PI,
            Math.sin,
            Math.cos,
            Math.tan,
            Math.sqrt,
            Math.abs,
            Math.log,
            Math.exp,
            Math.log
          )
        );
      } catch {
        y = NaN;
      }

      if (
        !Number.isFinite(y) ||
        Math.abs(y) > 1e4
      ) {
        started = false;
        continue;
      }

      const px =
        centerX +
        x * scale;

      const py =
        centerY -
        y * scale;

      if (!started) {
        contentCtx.moveTo(
          px,
          py
        );

        started = true;
      } else {
        contentCtx.lineTo(
          px,
          py
        );
      }
    }

    contentCtx.stroke();

    contentCtx.restore();

    render();

    scheduleAutoSave();
  }

  function openTimerModal() {
    openModal(
      `<h3>⏱️ مؤقت المذاكرة</h3>

      <div
        id="timerDisplay"
        class="timer-display">
        25:00
      </div>

      <div class="timer-mode">

        <button
          class="secondary-btn"
          data-min="25">
          25 دقيقة
        </button>

        <button
          class="secondary-btn"
          data-min="45">
          45 دقيقة
        </button>

        <button
          class="secondary-btn"
          data-min="60">
          60 دقيقة
        </button>

      </div>

      <div class="modal-actions">

        <button
          class="primary-btn"
          id="timerStart">
          ابدأ
        </button>

        <button
          class="secondary-btn"
          id="timerPause">
          إيقاف
        </button>

        <button
          class="danger-btn"
          id="timerReset">
          إعادة
        </button>

        <button
          class="secondary-btn close-generated">
          إغلاق
        </button>

      </div>`,

      modal => {
        const display =
          $('#timerDisplay', modal);

        let running = false;

        const renderTimer =
          () => {
            const m =
              Math.floor(
                timerSeconds / 60
              );

            const s =
              timerSeconds % 60;

            display.textContent =
              `${String(m).padStart(
                2,
                '0'
              )}:${String(s).padStart(
                2,
                '0'
              )}`;
          };

        renderTimer();

        $$(
          '[data-min]',
          modal
        ).forEach(button => {
          button.addEventListener(
            'click',
            () => {
              clearInterval(
                timerInterval
              );

              running = false;

              timerSeconds =
                Number(
                  button.dataset.min
                ) * 60;

              renderTimer();
            }
          );
        });

        $('#timerStart', modal)
          .addEventListener(
            'click',
            () => {
              if (running) return;

              running = true;

              clearInterval(
                timerInterval
              );

              timerInterval =
                setInterval(
                  () => {
                    timerSeconds -= 1;

                    renderTimer();

                    if (
                      timerSeconds <= 0
                    ) {
                      clearInterval(
                        timerInterval
                      );

                      running = false;

                      showStatus(
                        'خلص وقت المذاكرة ⏰'
                      );

                      navigator
                        .vibrate
                        ?.(
                          250
                        );
                    }
                  },
                  1000
                );
            }
          );

        $('#timerPause', modal)
          .addEventListener(
            'click',
            () => {
              clearInterval(
                timerInterval
              );

              running = false;
            }
          );

        $('#timerReset', modal)
          .addEventListener(
            'click',
            () => {
              clearInterval(
                timerInterval
              );

              running = false;

              timerSeconds =
                25 * 60;

              renderTimer();
            }
          );
      }
    );
  }

  // -------------------------
  // Import / export
  // -------------------------

  function importImage(
    file,
    point = lastPointerBoard
  ) {
    if (!file) return;

    const reader =
      new FileReader();

    reader.onload =
      event => {
        const image =
          new Image();

        image.onload =
          () => {
            saveHistory();

            const maxW =
              Math.min(
                image.width,
                700
              );

            const ratio =
              maxW /
              image.width;

            const w =
              image.width *
              ratio;

            const h =
              image.height *
              ratio;

            const x =
              Math.max(
                0,
                Math.min(
                  BOARD_W - w,
                  point.x
                )
              );

            const y =
              Math.max(
                0,
                Math.min(
                  BOARD_H - h,
                  point.y
                )
              );

            contentCtx.save();

            contentCtx.globalCompositeOperation =
              'source-over';

            contentCtx.drawImage(
              image,
              x,
              y,
              w,
              h
            );

            contentCtx.restore();

            render();

            scheduleAutoSave();
          };

        image.src =
          event.target.result;
      };

    reader.readAsDataURL(file);
  }

  function makeExportCanvas() {
    const out =
      document.createElement(
        'canvas'
      );

    out.width =
      BOARD_W;

    out.height =
      BOARD_H;

    const outCtx =
      out.getContext('2d');

    drawBackground(
      outCtx,
      BOARD_W,
      BOARD_H,
      0,
      0,
      1
    );

    outCtx.drawImage(
      contentCanvas,
      0,
      0
    );

    return out;
  }

  function exportPNG() {
    persistCurrentBoard(false);

    const out =
      makeExportCanvas();

    const link =
      document.createElement(
        'a'
      );

    link.download =
      `${sanitizeFilename(
        currentBoard()?.name ||
          'سبورة'
      )}.png`;

    link.href =
      out.toDataURL(
        'image/png'
      );

    link.click();

    showStatus(
      'تم تصدير السبورة كصورة PNG 📸'
    );
  }

  // -------------------------
  // Pointer / touch / zoom
  // -------------------------

  function pointerDownHandler(
    event
  ) {
    if (
      event.pointerType ===
        'mouse' &&
      event.button !== 0
    ) {
      return;
    }

    if (
      event.pointerType ===
      'touch'
    ) {
      activeTouchPointers.add(
        event.pointerId
      );

      if (
        activeTouchPointers.size >
        1
      ) {
        if (
          pointerDown &&
          (
            tool === 'pen' ||
            tool === 'eraser'
          )
        ) {
          void undo();
        }

        pointerDown = false;
        selectionMoving = false;
        gestureMode = true;

        return;
      }
    }

    if (gestureMode) return;

    canvas.setPointerCapture?.(
      event.pointerId
    );

    const point =
      screenToBoard(
        event.clientX,
        event.clientY
      );

    lastPointerBoard = point;

    if (
      spacePanning ||
      event.shiftKey
    ) {
      pointerDown = true;

      panStart = {
        screenX:
          event.clientX,

        screenY:
          event.clientY,

        viewX,
        viewY
      };

      return;
    }

    if (tool === 'text') {
      openTextModal(point);
      return;
    }

    if (tool === 'select') {
      if (
        selection?.buffer &&
        pointInsideSelection(point)
      ) {
        beginSelectionMove(
          point
        );
      } else {
        selection = null;
        startSelection(point);
      }

      return;
    }

    if (tool === 'shape') {
      beginShape(point);
      return;
    }

    if (
      tool === 'pen' ||
      tool === 'eraser'
    ) {
      beginStroke(point);
    }
  }

  function pointerMoveHandler(
    event
  ) {
    if (gestureMode) return;

    const point =
      screenToBoard(
        event.clientX,
        event.clientY
      );

    lastPointerBoard = point;

    if (
      spacePanning &&
      pointerDown &&
      panStart
    ) {
      viewX =
        panStart.viewX -
        (
          event.clientX -
          panStart.screenX
        ) / zoom;

      viewY =
        panStart.viewY -
        (
          event.clientY -
          panStart.screenY
        ) / zoom;

      clampView();
      render();

      return;
    }

    if (tool === 'select') {
      if (selectionMoving) {
        moveSelectedTo(point);
      } else if (
        selection?.selecting
      ) {
        updateSelection(point);
      }

      return;
    }

    if (!pointerDown) return;

    if (tool === 'shape') {
      drawShape(point);
    } else if (
      tool === 'pen' ||
      tool === 'eraser'
    ) {
      continueStroke(point);
    }
  }

  function pointerUpHandler(
    event
  ) {
    if (
      event?.pointerType ===
      'touch'
    ) {
      activeTouchPointers.delete(
        event.pointerId
      );
    }

    if (
      activeTouchPointers.size ===
      0
    ) {
      gestureMode = false;
    }

    if (gestureMode) return;

    if (spacePanning) {
      pointerDown = false;
      panStart = null;
      return;
    }

    if (tool === 'select') {
      if (selectionMoving) {
        finishSelectionMove();
      } else if (
        selection?.selecting
      ) {
        finishSelection();
      }

      pointerDown = false;

      return;
    }

    if (tool === 'shape') {
      finishShape();
    } else {
      endStroke();
    }
  }

  function wheelHandler(
    event
  ) {
    event.preventDefault();

    zoomAt(
      event.clientX,
      event.clientY,
      event.deltaY < 0
        ? 1.12
        : 0.89
    );
  }

  function startTouchGesture(
    event
  ) {
    if (
      event.touches.length !== 2
    ) {
      return;
    }

    event.preventDefault();

    const center =
      midPoint(
        event.touches[0],
        event.touches[1]
      );

    touchGesture = {
      distance:
        touchDistance(
          event.touches[0],
          event.touches[1]
        ),

      zoom,
      center,
      viewX,
      viewY
    };
  }

  function moveTouchGesture(
    event
  ) {
    if (
      event.touches.length !== 2 ||
      !touchGesture
    ) {
      return;
    }

    event.preventDefault();

    const center =
      midPoint(
        event.touches[0],
        event.touches[1]
      );

    const scale =
      touchDistance(
        event.touches[0],
        event.touches[1]
      ) /
      touchGesture.distance;

    zoom =
      Math.max(
        MIN_ZOOM,
        Math.min(
          MAX_ZOOM,
          touchGesture.zoom *
            scale
        )
      );

    const rect =
      canvas.getBoundingClientRect();

    const sx =
      center.x -
      rect.left;

    const sy =
      center.y -
      rect.top;

    viewX =
      touchGesture.viewX +
      (
        touchGesture.center.x -
        rect.left -
        sx
      ) / zoom;

    viewY =
      touchGesture.viewY +
      (
        touchGesture.center.y -
        rect.top -
        sy
      ) / zoom;

    clampView();
    render();
  }

  function touchDistance(
    a,
    b
  ) {
    return Math.hypot(
      a.clientX - b.clientX,
      a.clientY - b.clientY
    );
  }

  function midPoint(
    a,
    b
  ) {
    return {
      x:
        (
          a.clientX +
          b.clientX
        ) / 2,

      y:
        (
          a.clientY +
          b.clientY
        ) / 2
    };
  }

  // -------------------------
  // Event wiring
  // -------------------------

  $('#boardsBtn')
    .addEventListener(
      'click',
      openManager
    );

  $('#fileBtn')
    .addEventListener(
      'click',
      () =>
        persistCurrentBoard(true)
    );

  $('#fullscreenBtn')
    .addEventListener(
      'click',
      async () => {
        try {
          if (
            !document.fullscreenElement
          ) {
            await document
              .documentElement
              .requestFullscreen();
          } else {
            await document
              .exitFullscreen();
          }
        } catch {
          showStatus(
            'ملء الشاشة غير متاح في المتصفح.'
          );
        }
      }
    );

  $('#toolsBtn')
    .addEventListener(
      'click',
      () => {
        const panel =
          $('#toolsPanel');

        panel.classList.toggle(
          'hidden'
        );

        $('#quickColorPanel')
          .classList
          .add('hidden');

        $('#shapePanel')
          .classList
          .add('hidden');
      }
    );

  $('#quickColorBtn')
    .addEventListener(
      'click',
      () => {
        const panel =
          $('#quickColorPanel');

        panel.classList.toggle(
          'hidden'
        );

        $('#toolsPanel')
          .classList
          .add('hidden');

        $('#shapePanel')
          .classList
          .add('hidden');
      }
    );

  $('#penSize')
    .addEventListener(
      'input',
      event => {
        penSize =
          Number(
            event.target.value
          );

        $('#penSizeValue')
          .textContent =
          String(penSize);
      }
    );

  $('#colorGrid')
    .addEventListener(
      'click',
      event => {
        const button =
          event.target.closest(
            '[data-color]'
          );

        if (!button) return;

        color =
          button.dataset.color;

        closePanels();

        showStatus(
          'تم اختيار اللون.',
          true
        );
      }
    );

  $('#customColorBtn')
    .addEventListener(
      'click',
      () => {
        const next =
          prompt(
            'اكتب لون HEX مثل #22c55e:',
            color
          )?.trim();

        if (
          next &&
          /^#[0-9a-fA-F]{6}$/.test(
            next
          )
        ) {
          color = next;

          showStatus(
            'تم تغيير اللون.'
          );
        }
      }
    );

  $('#highlighterBtn')
    .addEventListener(
      'click',
      () => {
        tool = 'pen';
        highlighter = true;

        closePanels();

        setTool('pen');

        highlighter = true;

        showStatus(
          'Highlighter جاهز ✨',
          true
        );
      }
    );

  $$('.dock-btn[data-tool]')
    .forEach(button => {
      button.addEventListener(
        'click',
        () =>
          setTool(
            button.dataset.tool
          )
      );
    });

  $$('[data-action]')
    .forEach(butt
             })();
