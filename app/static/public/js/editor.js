(() => {
  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------
  const modeBadge = document.getElementById('modeBadge');
  const canvasPlaceholder = document.getElementById('canvasPlaceholder');
  const canvasImage = document.getElementById('canvasImage');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const canvasActions = document.getElementById('canvasActions');
  const downloadBtn = document.getElementById('downloadBtn');
  const editContinueBtn = document.getElementById('editContinueBtn');
  const historyStrip = document.getElementById('historyStrip');
  const uploadPreview = document.getElementById('uploadPreview');
  const uploadThumb = document.getElementById('uploadThumb');
  const uploadLabel = document.getElementById('uploadLabel');
  const uploadRemove = document.getElementById('uploadRemove');
  const attachBtn = document.getElementById('attachBtn');
  const promptInput = document.getElementById('promptInput');
  const ratioSelect = document.getElementById('ratioSelect');
  const sendBtn = document.getElementById('sendBtn');
  const fileInput = document.getElementById('fileInput');

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let history = [];        // { id, prompt, imageDataUri, mode, timestamp }
  let currentIndex = -1;
  let isGenerating = false;
  let uploadedImageDataUri = null;  // user-uploaded image (base64 data URI)
  let editBaseImageUri = null;      // image used as base for iterative editing

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function toast(message, type) {
    if (typeof showToast === 'function') {
      showToast(message, type);
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Auto-resize textarea
  function autoResize() {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
  }
  promptInput.addEventListener('input', autoResize);

  // ---------------------------------------------------------------------------
  // Mode management
  // ---------------------------------------------------------------------------
  function getMode() {
    if (uploadedImageDataUri || editBaseImageUri) return 'edit';
    return 'generate';
  }

  function updateModeBadge() {
    const mode = getMode();
    if (mode === 'edit') {
      modeBadge.textContent = '图生图 / 编辑模式';
      modeBadge.className = 'editor-mode-badge edit-mode';
    } else {
      modeBadge.textContent = '文生图模式';
      modeBadge.className = 'editor-mode-badge';
    }
  }

  // ---------------------------------------------------------------------------
  // Canvas display
  // ---------------------------------------------------------------------------
  function showPlaceholder() {
    canvasPlaceholder.style.display = 'flex';
    canvasImage.style.display = 'none';
    loadingIndicator.style.display = 'none';
    canvasActions.style.display = 'none';
  }

  function showLoading() {
    canvasPlaceholder.style.display = 'none';
    canvasImage.style.display = 'none';
    loadingIndicator.style.display = 'block';
    canvasActions.style.display = 'none';
  }

  function showImage(dataUri) {
    canvasPlaceholder.style.display = 'none';
    loadingIndicator.style.display = 'none';
    canvasImage.src = dataUri;
    canvasImage.style.display = 'block';
    canvasActions.style.display = 'flex';
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------
  function addHistory(entry) {
    history.push(entry);
    currentIndex = history.length - 1;
    renderHistory();
  }

  function renderHistory() {
    if (history.length === 0) {
      historyStrip.innerHTML = '<span class="editor-history-empty">暂无历史</span>';
      return;
    }
    historyStrip.innerHTML = '';
    history.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'editor-history-item' + (idx === currentIndex ? ' active' : '');
      const img = document.createElement('img');
      img.src = item.imageDataUri;
      img.alt = item.prompt || 'image';
      div.appendChild(img);
      div.addEventListener('click', () => selectHistory(idx));
      historyStrip.appendChild(div);
    });
    // Scroll to active
    const active = historyStrip.querySelector('.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  function selectHistory(idx) {
    if (idx < 0 || idx >= history.length) return;
    currentIndex = idx;
    const entry = history[idx];
    showImage(entry.imageDataUri);
    renderHistory();
    // When selecting a history item, clear upload and set edit base
    clearUpload();
    editBaseImageUri = null;
    updateModeBadge();
  }

  // ---------------------------------------------------------------------------
  // Upload handling (attachBtn is a <label for="fileInput">, native trigger)
  // ---------------------------------------------------------------------------
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      toast('图片文件过大，最大 50MB', 'error');
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      uploadedImageDataUri = e.target.result;
      // Show upload preview
      uploadThumb.src = uploadedImageDataUri;
      uploadLabel.textContent = file.name;
      uploadPreview.classList.add('visible');
      attachBtn.classList.add('has-image');

      // Show the uploaded image on canvas
      showImage(uploadedImageDataUri);
      // Clear edit base since we have a fresh upload
      editBaseImageUri = null;
      updateModeBadge();
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
  });

  uploadRemove.addEventListener('click', () => {
    clearUpload();
    updateModeBadge();
  });

  function clearUpload() {
    uploadedImageDataUri = null;
    uploadPreview.classList.remove('visible');
    attachBtn.classList.remove('has-image');
  }

  // ---------------------------------------------------------------------------
  // "Continue editing" button
  // ---------------------------------------------------------------------------
  editContinueBtn.addEventListener('click', () => {
    if (currentIndex < 0 || !history[currentIndex]) return;
    editBaseImageUri = history[currentIndex].imageDataUri;
    clearUpload();
    updateModeBadge();
    promptInput.focus();
    toast('已设置当前图片为编辑基底，输入新提示词继续编辑', 'info');
  });

  // ---------------------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------------------
  downloadBtn.addEventListener('click', () => {
    const src = canvasImage.src;
    if (!src) return;
    const link = document.createElement('a');
    link.href = src;
    link.download = `grok-image-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // ---------------------------------------------------------------------------
  // Send / generate
  // ---------------------------------------------------------------------------
  sendBtn.addEventListener('click', doGenerate);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doGenerate();
    }
  });

  async function doGenerate() {
    if (isGenerating) return;
    const prompt = (promptInput.value || '').trim();
    if (!prompt) {
      toast('请输入提示词', 'warning');
      promptInput.focus();
      return;
    }

    const key = await ensurePublicKey();
    if (key === null) {
      window.location.href = '/login';
      return;
    }

    const ratio = ratioSelect.value || '1:1';
    const mode = getMode();
    const imageBase = uploadedImageDataUri || editBaseImageUri;

    isGenerating = true;
    sendBtn.disabled = true;
    showLoading();

    try {
      let data;
      if (mode === 'edit' && imageBase) {
        data = await callEditApi(prompt, imageBase, ratio, key);
      } else {
        data = await callGenerateApi(prompt, ratio, key);
      }

      if (data.images && data.images.length > 0) {
        const imageDataUri = data.images[0];
        showImage(imageDataUri);
        addHistory({
          id: uid(),
          prompt,
          imageDataUri,
          mode,
          timestamp: Date.now(),
        });

        // After generation, clear upload (but keep edit base as the new image for iterative)
        clearUpload();
        // Auto-set the newly generated image as the edit base for next iteration
        editBaseImageUri = imageDataUri;
        updateModeBadge();

        if (data.elapsed_ms) {
          toast(`生成完成，耗时 ${(data.elapsed_ms / 1000).toFixed(1)}s`, 'success');
        }
      } else {
        showImage(canvasImage.src || '');
        if (!canvasImage.src) showPlaceholder();
        toast('图片生成失败，请重试', 'error');
      }
    } catch (err) {
      console.error('Generate error:', err);
      if (canvasImage.src && canvasImage.style.display !== 'none') {
        showImage(canvasImage.src);
      } else {
        showPlaceholder();
      }
      toast(err.message || '请求失败', 'error');
    } finally {
      isGenerating = false;
      sendBtn.disabled = false;
      promptInput.value = '';
      autoResize();
    }
  }

  // ---------------------------------------------------------------------------
  // API calls
  // ---------------------------------------------------------------------------
  async function callGenerateApi(prompt, ratio, authKey) {
    const res = await fetch('/v1/public/editor/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(authKey),
      },
      body: JSON.stringify({ prompt, aspect_ratio: ratio, n: 1 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function callEditApi(prompt, imageDataUri, ratio, authKey) {
    const res = await fetch('/v1/public/editor/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(authKey),
      },
      body: JSON.stringify({ prompt, image: imageDataUri, aspect_ratio: ratio }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  async function init() {
    const key = await ensurePublicKey();
    if (key === null) {
      window.location.href = '/login';
      return;
    }
    showPlaceholder();
    updateModeBadge();
    promptInput.focus();
  }

  init();
})();
