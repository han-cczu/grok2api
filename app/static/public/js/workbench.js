(() => {
  /* === DOM Refs === */
  const wbEmpty = document.getElementById('wbEmpty');
  const wbTimeline = document.getElementById('wbTimeline');
  const wbInspector = document.getElementById('wbInspector');
  const wbExportStatus = document.getElementById('wbExportStatus');
  const wbExportFill = document.getElementById('wbExportFill');
  const wbExportPhase = document.getElementById('wbExportPhase');
  const wbExportPercent = document.getElementById('wbExportPercent');
  const wbUploadBtn = document.getElementById('wbUploadBtn');
  const wbClearBtn = document.getElementById('wbClearBtn');
  const wbExportBtn = document.getElementById('wbExportBtn');
  const wbFileInput = document.getElementById('wbFileInput');
  const wbPreviewVideo = document.getElementById('wbPreviewVideo');
  const wbTrimStart = document.getElementById('wbTrimStart');
  const wbTrimEnd = document.getElementById('wbTrimEnd');
  const wbTrimStartVal = document.getElementById('wbTrimStartVal');
  const wbTrimEndVal = document.getElementById('wbTrimEndVal');
  const wbTrimDuration = document.getElementById('wbTrimDuration');
  const wbTransitionType = document.getElementById('wbTransitionType');
  const wbTransitionDur = document.getElementById('wbTransitionDur');

  /* === State === */
  const state = {
    clips: [],
    selectedClipId: null,
    ffmpegLoaded: false,
    exporting: false,
    exportProgress: 0,
    exportPhase: '',
  };

  let ffmpegInstance = null;
  let clipIdCounter = 0;

  /* === FFmpeg Util (inline, @ffmpeg/util has no UMD build) === */
  async function toBlobURL(url, mimeType) {
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const blob = new Blob([buf], { type: mimeType });
    return URL.createObjectURL(blob);
  }

  async function fetchFile(data) {
    if (data instanceof Blob) {
      return new Uint8Array(await data.arrayBuffer());
    }
    if (typeof data === 'string') {
      const resp = await fetch(data);
      return new Uint8Array(await resp.arrayBuffer());
    }
    return new Uint8Array();
  }

  /* === Helpers === */
  function uid() {
    return 'clip_' + (++clipIdCounter) + '_' + Date.now();
  }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type);
  }

  function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0.0s';
    return seconds.toFixed(1) + 's';
  }

  /* === Thumbnail Generation === */
  function generateThumbnail(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';
      video.src = url;

      video.addEventListener('loadeddata', () => {
        video.currentTime = Math.min(0.1, video.duration / 2);
      });

      video.addEventListener('seeked', () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 160;
          canvas.height = 90;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const thumbUrl = canvas.toDataURL('image/jpeg', 0.6);
          URL.revokeObjectURL(url);
          resolve(thumbUrl);
        } catch (e) {
          URL.revokeObjectURL(url);
          resolve('');
        }
      });

      video.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        resolve('');
      });
    });
  }

  function getVideoDuration(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = url;
      video.addEventListener('loadedmetadata', () => {
        const dur = video.duration;
        URL.revokeObjectURL(url);
        resolve(isFinite(dur) ? dur : 0);
      });
      video.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        resolve(0);
      });
    });
  }

  /* === Clip CRUD === */
  async function addClipFromUrl(url, name) {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error('fetch failed');
      const blob = await response.blob();
      await addClipFromBlob(blob, name || 'Video');
    } catch (e) {
      toast('添加视频到工作台失败: ' + e.message, 'error');
    }
  }

  async function addClipFromFile(file) {
    const blob = new Blob([file], { type: file.type });
    await addClipFromBlob(blob, file.name);
  }

  async function addClipFromBlob(blob, name) {
    const duration = await getVideoDuration(blob);
    if (!duration) {
      toast('无法读取视频时长', 'error');
      return;
    }
    const thumbnailUrl = await generateThumbnail(blob);
    const sourceUrl = URL.createObjectURL(blob);

    const clip = {
      id: uid(),
      name: name || 'Clip',
      sourceUrl,
      sourceBlob: blob,
      duration,
      trimStart: 0,
      trimEnd: duration,
      transition: 'none',
      transitionDuration: 0.5,
      thumbnailUrl,
    };

    state.clips.push(clip);
    renderAll();
    toast('已添加到工作台', 'success');
  }

  function removeClip(id) {
    const idx = state.clips.findIndex(c => c.id === id);
    if (idx === -1) return;
    const clip = state.clips[idx];
    if (clip.sourceUrl) URL.revokeObjectURL(clip.sourceUrl);
    state.clips.splice(idx, 1);
    if (state.selectedClipId === id) {
      state.selectedClipId = null;
    }
    renderAll();
  }

  function clearAllClips() {
    state.clips.forEach(c => {
      if (c.sourceUrl) URL.revokeObjectURL(c.sourceUrl);
    });
    state.clips = [];
    state.selectedClipId = null;
    renderAll();
  }

  function selectClip(id) {
    state.selectedClipId = id;
    renderAll();
  }

  function getSelectedClip() {
    if (!state.selectedClipId) return null;
    return state.clips.find(c => c.id === state.selectedClipId) || null;
  }

  function reorderClip(draggedId, targetId) {
    const fromIdx = state.clips.findIndex(c => c.id === draggedId);
    const toIdx = state.clips.findIndex(c => c.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = state.clips.splice(fromIdx, 1);
    state.clips.splice(toIdx, 0, moved);
    renderAll();
  }

  /* === Rendering === */
  function renderAll() {
    if (state.clips.length === 0) {
      if (wbEmpty) wbEmpty.classList.remove('hidden');
      if (wbTimeline) wbTimeline.classList.add('hidden');
      if (wbInspector) wbInspector.classList.add('hidden');
    } else {
      if (wbEmpty) wbEmpty.classList.add('hidden');
      if (wbTimeline) wbTimeline.classList.remove('hidden');
      renderTimeline();
      renderInspector();
    }
  }

  function renderTimeline() {
    if (!wbTimeline) return;
    wbTimeline.innerHTML = '';

    state.clips.forEach((clip, index) => {
      if (index > 0) {
        const arrow = document.createElement('div');
        arrow.className = 'wb-transition-arrow';
        arrow.textContent = '\u2192';
        wbTimeline.appendChild(arrow);
      }

      const card = document.createElement('div');
      card.className = 'wb-clip';
      card.dataset.clipId = clip.id;
      if (clip.id === state.selectedClipId) {
        card.classList.add('selected');
      }

      const thumb = document.createElement('div');
      thumb.className = 'wb-clip-thumb';
      if (clip.thumbnailUrl) {
        thumb.style.backgroundImage = 'url(' + clip.thumbnailUrl + ')';
      }

      const nameEl = document.createElement('div');
      nameEl.className = 'wb-clip-name';
      nameEl.textContent = clip.name;
      nameEl.title = clip.name;

      const timeEl = document.createElement('div');
      timeEl.className = 'wb-clip-time';
      timeEl.textContent = formatTime(clip.trimStart) + ' - ' + formatTime(clip.trimEnd);

      card.appendChild(thumb);
      card.appendChild(nameEl);
      card.appendChild(timeEl);

      if (clip.transition && clip.transition !== 'none') {
        const transTag = document.createElement('div');
        transTag.className = 'wb-clip-transition-tag';
        transTag.textContent = clip.transition;
        card.appendChild(transTag);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'wb-clip-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = '\u79fb\u9664';
      removeBtn.dataset.clipId = clip.id;
      card.appendChild(removeBtn);

      /* Click to select */
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('wb-clip-remove')) return;
        selectClip(clip.id);
      });

      /* Drag-to-reorder */
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', clip.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId && draggedId !== clip.id) {
          reorderClip(draggedId, clip.id);
        }
      });

      wbTimeline.appendChild(card);
    });
  }

  function renderInspector() {
    const clip = getSelectedClip();
    if (!clip) {
      if (wbInspector) wbInspector.classList.add('hidden');
      return;
    }

    if (wbInspector) wbInspector.classList.remove('hidden');

    if (wbPreviewVideo) {
      if (wbPreviewVideo.src !== clip.sourceUrl) {
        wbPreviewVideo.src = clip.sourceUrl;
      }
      wbPreviewVideo.currentTime = clip.trimStart;
    }

    if (wbTrimStart) {
      wbTrimStart.max = clip.duration.toString();
      wbTrimStart.value = clip.trimStart.toString();
    }
    if (wbTrimEnd) {
      wbTrimEnd.max = clip.duration.toString();
      wbTrimEnd.value = clip.trimEnd.toString();
    }
    if (wbTrimStartVal) wbTrimStartVal.textContent = formatTime(clip.trimStart);
    if (wbTrimEndVal) wbTrimEndVal.textContent = formatTime(clip.trimEnd);
    if (wbTrimDuration) wbTrimDuration.textContent = formatTime(clip.trimEnd - clip.trimStart);

    if (wbTransitionType) wbTransitionType.value = clip.transition || 'none';
    if (wbTransitionDur) wbTransitionDur.value = clip.transitionDuration || 0.5;
  }

  /* === Export === */
  function updateExportProgress(progress, phase) {
    state.exportProgress = progress;
    state.exportPhase = phase || '';
    if (wbExportFill) wbExportFill.style.width = Math.round(progress) + '%';
    if (wbExportPercent) wbExportPercent.textContent = Math.round(progress) + '%';
    if (wbExportPhase) wbExportPhase.textContent = phase || '';
  }

  function showExportStatus(show) {
    if (wbExportStatus) {
      wbExportStatus.classList.toggle('hidden', !show);
    }
  }

  async function loadFFmpeg() {
    if (state.ffmpegLoaded && ffmpegInstance) return ffmpegInstance;

    if (typeof FFmpegWASM === 'undefined') {
      throw new Error('FFmpeg.wasm \u672a\u52a0\u8f7d\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u8fde\u63a5');
    }

    updateExportProgress(0, '\u52a0\u8f7d FFmpeg WASM...');

    const { FFmpeg } = FFmpegWASM;
    const ffmpeg = new FFmpeg();

    const coreURL = await toBlobURL(
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
      'text/javascript'
    );
    const wasmURL = await toBlobURL(
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
      'application/wasm'
    );

    await ffmpeg.load({ coreURL, wasmURL });

    ffmpegInstance = ffmpeg;
    state.ffmpegLoaded = true;
    return ffmpeg;
  }

  async function exportWorkbench() {
    if (state.clips.length === 0) {
      toast('\u5de5\u4f5c\u53f0\u4e2d\u6ca1\u6709\u89c6\u9891\u7247\u6bb5', 'error');
      return;
    }
    if (state.exporting) {
      toast('\u6b63\u5728\u5bfc\u51fa\u4e2d', 'warning');
      return;
    }

    state.exporting = true;
    showExportStatus(true);

    try {
      const ffmpeg = await loadFFmpeg();
      const clips = state.clips;
      const totalClips = clips.length;

      /* Check total size */
      let totalSize = 0;
      clips.forEach(c => { totalSize += c.sourceBlob.size; });
      if (totalSize > 500 * 1024 * 1024) {
        toast('\u89c6\u9891\u603b\u5927\u5c0f\u8d85\u8fc7 500MB\uff0c\u53ef\u80fd\u5bfc\u81f4\u5904\u7406\u5931\u8d25', 'warning');
      }

      /* Phase 1: Trim and normalize each clip */
      const trimmedFiles = [];
      const durations = [];
      for (let i = 0; i < totalClips; i++) {
        const clip = clips[i];
        const inputName = 'input_' + i + '.mp4';
        const outputName = 'trimmed_' + i + '.mp4';

        updateExportProgress(
          (i / totalClips) * 60,
          '\u88c1\u526a\u7247\u6bb5 ' + (i + 1) + '/' + totalClips + '...'
        );

        await ffmpeg.writeFile(inputName, await fetchFile(clip.sourceBlob));

        const trimArgs = [
          '-i', inputName,
          '-ss', clip.trimStart.toString(),
          '-to', clip.trimEnd.toString(),
          '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30',
          '-pix_fmt', 'yuv420p',
          '-preset', 'ultrafast',
          '-y', outputName
        ];

        await ffmpeg.exec(trimArgs);
        await ffmpeg.deleteFile(inputName);
        trimmedFiles.push(outputName);
        durations.push(clip.trimEnd - clip.trimStart);
      }

      /* Phase 2: Concatenate */
      let outputFile;

      if (totalClips === 1) {
        outputFile = trimmedFiles[0];
      } else {
        const hasTransitions = clips.some((c, i) => i < clips.length - 1 && c.transition && c.transition !== 'none');

        if (!hasTransitions) {
          /* Simple concat with concat demuxer */
          updateExportProgress(65, '\u62fc\u63a5\u89c6\u9891...');

          let concatList = '';
          trimmedFiles.forEach(f => {
            concatList += "file '" + f + "'\n";
          });

          const encoder = new TextEncoder();
          await ffmpeg.writeFile('concat.txt', encoder.encode(concatList));

          await ffmpeg.exec([
            '-f', 'concat', '-safe', '0',
            '-i', 'concat.txt',
            '-c', 'copy',
            '-y', 'output.mp4'
          ]);

          await ffmpeg.deleteFile('concat.txt');
          outputFile = 'output.mp4';
        } else {
          /* Concat with xfade transitions */
          updateExportProgress(65, '\u5e94\u7528\u8f6c\u573a\u6548\u679c...');

          let filterParts = [];
          let inputArgs = [];
          trimmedFiles.forEach(f => {
            inputArgs.push('-i', f);
          });

          let prevLabel = '0:v';
          let accumulatedDur = durations[0];

          for (let i = 0; i < totalClips - 1; i++) {
            const clip = clips[i];
            const trans = (clip.transition && clip.transition !== 'none') ? clip.transition : 'fade';
            const transDur = Math.min(
              clip.transitionDuration || 0.5,
              accumulatedDur - 0.1,
              durations[i + 1] - 0.1
            );
            const offset = Math.max(0, accumulatedDur - transDur);
            const outLabel = i < totalClips - 2 ? 'xf' + i : 'vout';

            filterParts.push(
              '[' + prevLabel + '][' + (i + 1) + ':v]xfade=transition=' + trans + ':duration=' + transDur.toFixed(2) + ':offset=' + offset.toFixed(2) + '[' + outLabel + ']'
            );

            accumulatedDur = offset + durations[i + 1];
            prevLabel = outLabel;
          }

          const videoFilter = filterParts.join(';');

          /* Try with audio first, fallback to video-only */
          let ret = await ffmpeg.exec([
            ...inputArgs,
            '-filter_complex', videoFilter,
            '-map', '[vout]',
            '-an',
            '-preset', 'ultrafast',
            '-y', 'output.mp4'
          ]);

          if (ret !== 0) {
            throw new Error('FFmpeg xfade \u5904\u7406\u5931\u8d25');
          }

          outputFile = 'output.mp4';
        }

        /* Clean up trimmed files */
        for (const f of trimmedFiles) {
          try { await ffmpeg.deleteFile(f); } catch (e) { /* ignore */ }
        }
      }

      updateExportProgress(90, '\u751f\u6210\u6587\u4ef6...');

      const data = await ffmpeg.readFile(outputFile);
      try { await ffmpeg.deleteFile(outputFile); } catch (e) { /* ignore */ }

      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      const downloadUrl = URL.createObjectURL(blob);

      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = 'workbench_' + Date.now() + '.mp4';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);

      updateExportProgress(100, '\u5bfc\u51fa\u5b8c\u6210!');
      toast('\u89c6\u9891\u5bfc\u51fa\u6210\u529f', 'success');

      setTimeout(() => {
        showExportStatus(false);
        state.exporting = false;
      }, 2000);

    } catch (e) {
      console.error('Export error:', e);
      toast('\u5bfc\u51fa\u5931\u8d25: ' + (e.message || e || 'unknown error'), 'error');
      updateExportProgress(0, '\u5bfc\u51fa\u5931\u8d25');
      state.exporting = false;
      setTimeout(() => showExportStatus(false), 3000);
    }
  }

  /* === Event Listeners === */

  /* Upload button */
  if (wbUploadBtn && wbFileInput) {
    wbUploadBtn.addEventListener('click', () => wbFileInput.click());
  }

  if (wbFileInput) {
    wbFileInput.addEventListener('change', async () => {
      const files = wbFileInput.files;
      if (!files || !files.length) return;
      for (const file of files) {
        await addClipFromFile(file);
      }
      wbFileInput.value = '';
    });
  }

  /* Clear button */
  if (wbClearBtn) {
    wbClearBtn.addEventListener('click', () => {
      if (state.exporting) {
        toast('\u5bfc\u51fa\u4e2d\uff0c\u65e0\u6cd5\u6e05\u7a7a', 'warning');
        return;
      }
      clearAllClips();
    });
  }

  /* Export button */
  if (wbExportBtn) {
    wbExportBtn.addEventListener('click', () => exportWorkbench());
  }

  /* Timeline remove button (delegated) */
  if (wbTimeline) {
    wbTimeline.addEventListener('click', (e) => {
      const target = e.target;
      if (target.classList.contains('wb-clip-remove')) {
        const clipId = target.dataset.clipId;
        if (clipId) removeClip(clipId);
      }
    });
  }

  /* Inspector: trim start */
  if (wbTrimStart) {
    wbTrimStart.addEventListener('input', () => {
      const clip = getSelectedClip();
      if (!clip) return;
      let val = parseFloat(wbTrimStart.value) || 0;
      if (val >= clip.trimEnd) val = Math.max(0, clip.trimEnd - 0.1);
      clip.trimStart = val;
      wbTrimStart.value = val.toString();
      if (wbTrimStartVal) wbTrimStartVal.textContent = formatTime(val);
      if (wbTrimDuration) wbTrimDuration.textContent = formatTime(clip.trimEnd - clip.trimStart);
      if (wbPreviewVideo) wbPreviewVideo.currentTime = val;
      renderTimeline();
    });
  }

  /* Inspector: trim end */
  if (wbTrimEnd) {
    wbTrimEnd.addEventListener('input', () => {
      const clip = getSelectedClip();
      if (!clip) return;
      let val = parseFloat(wbTrimEnd.value) || 0;
      if (val <= clip.trimStart) val = clip.trimStart + 0.1;
      clip.trimEnd = val;
      wbTrimEnd.value = val.toString();
      if (wbTrimEndVal) wbTrimEndVal.textContent = formatTime(val);
      if (wbTrimDuration) wbTrimDuration.textContent = formatTime(clip.trimEnd - clip.trimStart);
      renderTimeline();
    });
  }

  /* Inspector: transition type */
  if (wbTransitionType) {
    wbTransitionType.addEventListener('change', () => {
      const clip = getSelectedClip();
      if (!clip) return;
      clip.transition = wbTransitionType.value;
      renderTimeline();
    });
  }

  /* Inspector: transition duration */
  if (wbTransitionDur) {
    wbTransitionDur.addEventListener('input', () => {
      const clip = getSelectedClip();
      if (!clip) return;
      clip.transitionDuration = parseFloat(wbTransitionDur.value) || 0.5;
    });
  }

  /* Listen for workbench:add from video.js */
  window.addEventListener('workbench:add', (e) => {
    const { url, name } = e.detail || {};
    if (url) addClipFromUrl(url, name);
  });

  /* Init */
  renderAll();
})();
