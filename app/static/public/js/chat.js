(() => {
  const chatContainer = document.getElementById('chatContainer');
  const modelSelect = document.getElementById('modelSelect');
  const messagesContainer = document.getElementById('chatMessages');
  const emptyState = document.getElementById('chatEmpty');
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const clearBtn = document.getElementById('clearBtn');
  const attachBtn = document.getElementById('attachBtn');
  const attachCount = document.getElementById('attachCount');
  const fileInput = document.getElementById('fileInput');
  const roleCardSelect = document.getElementById('roleCardSelect');
  const roleManageBtn = document.getElementById('roleManageBtn');
  const roleManagerModal = document.getElementById('roleManagerModal');
  const roleModalCloseBtn = document.getElementById('roleModalCloseBtn');
  const roleCardList = document.getElementById('roleCardList');
  const roleForm = document.getElementById('roleForm');
  const roleFormId = document.getElementById('roleFormId');
  const roleNameInput = document.getElementById('roleNameInput');
  const roleDescriptionInput = document.getElementById('roleDescriptionInput');
  const roleOpeningInput = document.getElementById('roleOpeningInput');
  const rolePromptInput = document.getElementById('rolePromptInput');
  const roleFormResetBtn = document.getElementById('roleFormResetBtn');
  const roleFormSubmitBtn = document.getElementById('roleFormSubmitBtn');
  const roleSwitchModal = document.getElementById('roleSwitchModal');
  const roleSwitchText = document.getElementById('roleSwitchText');
  const switchClearBtn = document.getElementById('switchClearBtn');
  const switchKeepBtn = document.getElementById('switchKeepBtn');
  const switchCancelBtn = document.getElementById('switchCancelBtn');
  const roleModalBackdrop = roleManagerModal ? roleManagerModal.querySelector('[data-close-role-modal]') : null;
  const roleSwitchBackdrop = roleSwitchModal ? roleSwitchModal.querySelector('.chat-modal-backdrop') : null;

  let messages = [];
  let isSending = false;
  const MAX_PENDING_FILES = 5;
  let pendingFiles = [];
  const ROLE_STORAGE_KEY = 'chat.roleCards.v1';
  const ACTIVE_ROLE_STORAGE_KEY = 'chat.activeRoleCardId.v1';
  const MAX_ROLE_NAME_LENGTH = 30;
  const MAX_ROLE_DESC_LENGTH = 120;
  const MAX_ROLE_OPENING_LENGTH = 500;
  const MAX_ROLE_PROMPT_LENGTH = 4000;
  let roleCards = [];
  let activeRoleCardId = '';
  let pendingRoleSwitchId = '';
  let roleModalLastFocused = null;

  /* ── Marked + Highlight.js setup ── */
  marked.use({ gfm: true, breaks: true });

  function renderMarkdown(text) {
    return marked.parse(text);
  }

  function applyHighlight(el) {
    el.querySelectorAll('pre code').forEach(block => {
      if (!block.dataset.highlighted) hljs.highlightElement(block);
    });
  }

  function toast(message, type) {
    if (typeof showToast === 'function') showToast(message, type);
  }

  function isModalOpen(el) {
    return !!el && !el.classList.contains('hidden');
  }

  function syncModalBodyState() {
    if (isModalOpen(roleManagerModal) || isModalOpen(roleSwitchModal)) {
      document.body.classList.add('chat-modal-open');
    } else {
      document.body.classList.remove('chat-modal-open');
    }
  }

  function createRoleId() {
    return `role_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeRoleCard(item) {
    if (!item || typeof item !== 'object') return null;
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, MAX_ROLE_NAME_LENGTH) : '';
    const systemPrompt = typeof item.systemPrompt === 'string' ? item.systemPrompt.trim().slice(0, MAX_ROLE_PROMPT_LENGTH) : '';
    if (!name || !systemPrompt) return null;

    return {
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createRoleId(),
      name,
      description: typeof item.description === 'string' ? item.description.trim().slice(0, MAX_ROLE_DESC_LENGTH) : '',
      openingMessage: typeof item.openingMessage === 'string' ? item.openingMessage.trim().slice(0, MAX_ROLE_OPENING_LENGTH) : '',
      systemPrompt,
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Date.now(),
    };
  }

  function loadRoleCardsFromStorage() {
    try {
      const raw = localStorage.getItem(ROLE_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const cards = parsed.map(normalizeRoleCard).filter(Boolean);
      if (cards.length !== parsed.length) {
        localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(cards));
      }
      return cards;
    } catch (e) {
      localStorage.removeItem(ROLE_STORAGE_KEY);
      toast('角色卡数据读取失败，已重置', 'warning');
      return [];
    }
  }

  function saveRoleCardsToStorage() {
    localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(roleCards));
  }

  function loadActiveRoleId() {
    const value = localStorage.getItem(ACTIVE_ROLE_STORAGE_KEY) || '';
    return typeof value === 'string' ? value : '';
  }

  function saveActiveRoleId() {
    localStorage.setItem(ACTIVE_ROLE_STORAGE_KEY, activeRoleCardId || '');
  }

  function getRoleCardById(id) {
    if (!id) return null;
    return roleCards.find((card) => card.id === id) || null;
  }

  function getActiveRoleCard() {
    return getRoleCardById(activeRoleCardId);
  }

  function renderRoleCardSelect() {
    const previous = activeRoleCardId;
    roleCardSelect.innerHTML = '';

    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '未启用角色';
    roleCardSelect.appendChild(emptyOption);

    roleCards.forEach((card) => {
      const option = document.createElement('option');
      option.value = card.id;
      option.textContent = card.name;
      roleCardSelect.appendChild(option);
    });

    const selected = getRoleCardById(previous) ? previous : '';
    activeRoleCardId = selected;
    roleCardSelect.value = selected;
  }

  function createRoleCardAction(label, action, roleId, disabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'role-card-btn';
    btn.textContent = label;
    btn.dataset.action = action;
    btn.dataset.roleId = roleId;
    btn.disabled = Boolean(disabled);
    return btn;
  }

  function renderRoleCardList() {
    roleCardList.innerHTML = '';

    if (!roleCards.length) {
      const empty = document.createElement('div');
      empty.className = 'role-card-empty';
      empty.textContent = '暂无角色，请先创建。';
      roleCardList.appendChild(empty);
      return;
    }

    const sorted = [...roleCards].sort((a, b) => b.updatedAt - a.updatedAt);
    sorted.forEach((card) => {
      const item = document.createElement('div');
      item.className = 'role-card-item';
      if (card.id === activeRoleCardId) item.classList.add('is-active');

      const head = document.createElement('div');
      head.className = 'role-card-item-head';
      const name = document.createElement('h4');
      name.className = 'role-card-name';
      name.textContent = card.name;
      head.appendChild(name);
      if (card.id === activeRoleCardId) {
        const activeTag = document.createElement('span');
        activeTag.className = 'role-card-active-tag';
        activeTag.textContent = '当前启用';
        head.appendChild(activeTag);
      }

      const desc = document.createElement('p');
      desc.className = 'role-card-desc';
      desc.textContent = card.description || '无简介';

      const actions = document.createElement('div');
      actions.className = 'role-card-actions';
      actions.appendChild(createRoleCardAction('启用', 'activate', card.id, card.id === activeRoleCardId));
      actions.appendChild(createRoleCardAction('编辑', 'edit', card.id, false));
      actions.appendChild(createRoleCardAction('删除', 'delete', card.id, false));

      item.appendChild(head);
      item.appendChild(desc);
      item.appendChild(actions);
      roleCardList.appendChild(item);
    });
  }

  function resetRoleForm() {
    roleFormId.value = '';
    roleNameInput.value = '';
    roleDescriptionInput.value = '';
    roleOpeningInput.value = '';
    rolePromptInput.value = '';
    roleFormSubmitBtn.textContent = '保存角色';
  }

  function fillRoleForm(card) {
    roleFormId.value = card.id;
    roleNameInput.value = card.name || '';
    roleDescriptionInput.value = card.description || '';
    roleOpeningInput.value = card.openingMessage || '';
    rolePromptInput.value = card.systemPrompt || '';
    roleFormSubmitBtn.textContent = '更新角色';
    roleNameInput.focus();
  }

  function openRoleManager() {
    if (isModalOpen(roleSwitchModal)) return;
    roleModalLastFocused = document.activeElement;
    renderRoleCardList();
    roleManagerModal.classList.remove('hidden');
    roleManagerModal.setAttribute('aria-hidden', 'false');
    syncModalBodyState();
    roleNameInput.focus();
  }

  function closeRoleManager() {
    roleManagerModal.classList.add('hidden');
    roleManagerModal.setAttribute('aria-hidden', 'true');
    syncModalBodyState();
    if (roleModalLastFocused && typeof roleModalLastFocused.focus === 'function') {
      roleModalLastFocused.focus();
    }
  }

  function openRoleSwitchModal(nextRoleId) {
    const currentName = getActiveRoleCard()?.name || '未启用角色';
    const nextName = getRoleCardById(nextRoleId)?.name || '未启用角色';
    pendingRoleSwitchId = nextRoleId;
    roleSwitchText.textContent = `当前会话已有历史，将从「${currentName}」切换到「${nextName}」。建议清空并开始新会话以避免上下文污染。`;
    roleSwitchModal.classList.remove('hidden');
    roleSwitchModal.setAttribute('aria-hidden', 'false');
    syncModalBodyState();
    switchClearBtn.focus();
  }

  function closeRoleSwitchModal(restoreSelection) {
    roleSwitchModal.classList.add('hidden');
    roleSwitchModal.setAttribute('aria-hidden', 'true');
    if (restoreSelection) {
      roleCardSelect.value = activeRoleCardId || '';
    }
    pendingRoleSwitchId = '';
    syncModalBodyState();
  }

  function appendOpeningMessageIfNeeded(roleCard) {
    const opening = (roleCard?.openingMessage || '').trim();
    if (!opening) return;
    messages.push({ role: 'assistant', content: opening });
    appendMessage('assistant', opening);
    updateEmpty();
  }

  function commitRoleSwitch(nextRoleId, clearHistory) {
    const roleCard = getRoleCardById(nextRoleId);
    if (clearHistory) {
      clearConversation();
    }

    activeRoleCardId = roleCard ? roleCard.id : '';
    saveActiveRoleId();
    renderRoleCardSelect();
    renderRoleCardList();
    closeRoleSwitchModal(false);

    if (roleCard) {
      appendOpeningMessageIfNeeded(roleCard);
      toast(`已切换角色：${roleCard.name}`, 'success');
    } else {
      toast('已关闭角色卡', 'info');
    }
  }

  function requestRoleSwitch(nextRoleId) {
    if (nextRoleId === activeRoleCardId) return;
    if (isSending) {
      toast('生成回复中，请稍后再切换角色', 'warning');
      roleCardSelect.value = activeRoleCardId || '';
      return;
    }
    if (messages.length > 0) {
      openRoleSwitchModal(nextRoleId);
      return;
    }
    commitRoleSwitch(nextRoleId, false);
  }

  function buildRequestMessages() {
    const requestMessages = messages.map((message) => ({ role: message.role, content: message.content }));
    const roleCard = getActiveRoleCard();
    if (!roleCard) return requestMessages;
    const prompt = (roleCard.systemPrompt || '').trim();
    if (!prompt) return requestMessages;
    return [{ role: 'system', content: prompt }, ...requestMessages];
  }

  function validateRoleForm() {
    const editingId = roleFormId.value.trim();
    const name = roleNameInput.value.trim();
    const description = roleDescriptionInput.value.trim();
    const openingMessage = roleOpeningInput.value.trim();
    const systemPrompt = rolePromptInput.value.trim();

    if (!name) {
      toast('角色名称不能为空', 'error');
      roleNameInput.focus();
      return null;
    }
    if (!systemPrompt) {
      toast('角色提示词不能为空', 'error');
      rolePromptInput.focus();
      return null;
    }
    if (name.length > MAX_ROLE_NAME_LENGTH) {
      toast(`角色名称最多 ${MAX_ROLE_NAME_LENGTH} 字`, 'error');
      return null;
    }
    if (description.length > MAX_ROLE_DESC_LENGTH) {
      toast(`角色简介最多 ${MAX_ROLE_DESC_LENGTH} 字`, 'error');
      return null;
    }
    if (openingMessage.length > MAX_ROLE_OPENING_LENGTH) {
      toast(`开场白最多 ${MAX_ROLE_OPENING_LENGTH} 字`, 'error');
      return null;
    }
    if (systemPrompt.length > MAX_ROLE_PROMPT_LENGTH) {
      toast(`角色提示词最多 ${MAX_ROLE_PROMPT_LENGTH} 字`, 'error');
      return null;
    }

    const duplicated = roleCards.some(
      (card) => card.id !== editingId && card.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicated) {
      toast('角色名称已存在，请更换', 'error');
      roleNameInput.focus();
      return null;
    }

    return { editingId, name, description, openingMessage, systemPrompt };
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('read_failed'));
      reader.readAsDataURL(file);
    });
  }

  function updateAttachUI() {
    const count = pendingFiles.length;
    if (count > 0) {
      attachCount.textContent = count > 9 ? '9+' : String(count);
      attachCount.style.display = 'block';
      attachBtn.title = `已选择 ${count} 个附件`;
    } else {
      attachCount.textContent = '';
      attachCount.style.display = 'none';
      attachBtn.title = '添加附件';
    }
  }

  function buildUserContent(text, files) {
    if (!files.length) return text;
    const content = [];
    if (text) content.push({ type: 'text', text });
    files.forEach((f) => {
      content.push({
        type: 'file',
        file: {
          file_data: f.file_data,
          file_name: f.file_name,
          mime_type: f.mime_type,
        },
      });
    });
    return content;
  }

  function buildUserPreview(text, files) {
    if (!files.length) return text;
    const fileList = files.map(f => `[附件] ${f.file_name}`).join('\n');
    return text ? `${text}\n${fileList}` : fileList;
  }

  /* ── Thinking helpers ── */
  function splitThinking(text) {
    const start = text.indexOf('<think>');
    if (start === -1) return { thinking: '', content: text, done: true };
    const end = text.indexOf('</think>');
    if (end === -1) {
      return { thinking: text.slice(start + 7), content: '', done: false };
    }
    return {
      thinking: text.slice(start + 7, end),
      content: text.slice(end + 8).trimStart(),
      done: true,
    };
  }

  function stripThinking(text) {
    return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  }

  function renderBubble(bubble, fullText, streaming) {
    const { thinking, content, done } = splitThinking(fullText);

    // No thinking tags → render directly
    if (!thinking && done) {
      bubble.innerHTML = renderMarkdown(content);
      return;
    }

    // Ensure thinking DOM structure exists
    let block = bubble.querySelector('.thinking-block');
    let respDiv = bubble.querySelector('.response-content');
    if (!block) {
      bubble.innerHTML = '';
      block = document.createElement('details');
      block.className = 'thinking-block';
      block.open = true;
      const summary = document.createElement('summary');
      block.appendChild(summary);
      const textDiv = document.createElement('div');
      textDiv.className = 'thinking-text';
      block.appendChild(textDiv);
      bubble.appendChild(block);
      respDiv = document.createElement('div');
      respDiv.className = 'response-content';
      bubble.appendChild(respDiv);
    }

    const summary = block.querySelector('summary');
    const textDiv = block.querySelector('.thinking-text');

    if (!done) {
      summary.innerHTML = '<span class="thinking-indicator"></span> 思考中...';
      block.open = true;
    } else {
      summary.textContent = '已深度思考（点击展开）';
      // Auto-collapse once when thinking just finishes
      if (!bubble.dataset.thinkingClosed) {
        block.open = false;
        bubble.dataset.thinkingClosed = '1';
      }
    }

    textDiv.innerHTML = renderMarkdown(thinking);
    respDiv.innerHTML = content ? renderMarkdown(content) : '';
  }

  /* ── Models ── */
  async function loadModels() {
    try {
      const res = await fetch('/v1/public/chat/models');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const models = data.data || [];
      modelSelect.innerHTML = '';
      models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.display_name || m.id;
        modelSelect.appendChild(opt);
      });
      // 默认选中 grok-4.1-fast
      if (models.some(m => m.id === 'grok-4.1-fast')) {
        modelSelect.value = 'grok-4.1-fast';
      }
    } catch (e) {
      toast('加载模型列表失败', 'error');
    }
  }

  /* ── UI helpers ── */
  function updateEmpty() {
    if (messages.length === 0) {
      emptyState.classList.remove('hidden');
      messagesContainer.classList.add('hidden');
      chatContainer.classList.remove('has-messages');
    } else {
      emptyState.classList.add('hidden');
      messagesContainer.classList.remove('hidden');
      chatContainer.classList.add('has-messages');
    }
  }

  let autoScroll = true;

  function scrollToBottom() {
    if (!autoScroll) return;
    requestAnimationFrame(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
  }

  // 仅通过 wheel / touch 检测用户主动上滑，暂停自动滚动
  messagesContainer.addEventListener('wheel', (e) => {
    if (e.deltaY < 0 && isSending) autoScroll = false;
  }, { passive: true });

  let _touchY = 0;
  messagesContainer.addEventListener('touchstart', (e) => {
    _touchY = e.touches[0].clientY;
  }, { passive: true });
  messagesContainer.addEventListener('touchmove', (e) => {
    if (e.touches[0].clientY > _touchY && isSending) autoScroll = false;
    _touchY = e.touches[0].clientY;
  }, { passive: true });

  function appendMessage(role, content) {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-message ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';

    if (role === 'assistant' && content) {
      renderBubble(bubble, content, false);
      applyHighlight(bubble);
    } else if (role === 'user') {
      bubble.textContent = content;
    }

    wrapper.appendChild(bubble);
    messagesContainer.appendChild(wrapper);
    scrollToBottom();
    return bubble;
  }

  function setInputEnabled(enabled) {
    chatInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
    attachBtn.disabled = !enabled;
    fileInput.disabled = !enabled;
    roleCardSelect.disabled = !enabled;
    roleManageBtn.disabled = !enabled;
    isSending = !enabled;
  }

  /* ── Send message ── */
  async function sendMessage() {
    const text = chatInput.value.trim();
    if ((!text && pendingFiles.length === 0) || isSending) return;

    const authHeader = await ensurePublicKey();
    if (authHeader === null) {
      toast('请先配置 Public Key', 'error');
      window.location.href = '/login';
      return;
    }

    const filesForMessage = pendingFiles.map(f => ({ ...f }));
    const userContent = buildUserContent(text, filesForMessage);
    messages.push({ role: 'user', content: userContent });
    autoScroll = true;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    updateEmpty();
    appendMessage('user', buildUserPreview(text, filesForMessage));
    setInputEnabled(false);

    const model = modelSelect.value;
    const requestMessages = buildRequestMessages();
    const bubble = appendMessage('assistant', '');
    let fullContent = '';

    try {
      const headers = buildAuthHeaders(authHeader);
      headers['Content-Type'] = 'application/json';

      const res = await fetch('/v1/public/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: requestMessages, stream: true }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;

          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              renderBubble(bubble, fullContent, true);
              scrollToBottom();
            }
          } catch (_) { /* skip malformed chunks */ }
        }
      }

      // Final render with code highlighting
      renderBubble(bubble, fullContent, false);
      applyHighlight(bubble);
      // Strip thinking from conversation context
      messages.push({ role: 'assistant', content: stripThinking(fullContent) });
      // 仅在发送成功后清空待上传附件，失败时保留用于重试
      pendingFiles = [];
      updateAttachUI();
    } catch (e) {
      const errMsg = e.message || '请求失败';
      if (!fullContent) bubble.textContent = `错误: ${errMsg}`;
      toast(errMsg, 'error');
    } finally {
      setInputEnabled(true);
      chatInput.focus();
    }
  }

  function clearConversation() {
    messages = [];
    pendingFiles = [];
    fileInput.value = '';
    updateAttachUI();
    messagesContainer.innerHTML = '';
    updateEmpty();
  }

  function clearComposer() {
    const hasText = chatInput.value.trim().length > 0;
    const hasFiles = pendingFiles.length > 0;
    if (!hasText && !hasFiles) return false;

    chatInput.value = '';
    chatInput.style.height = 'auto';
    pendingFiles = [];
    fileInput.value = '';
    updateAttachUI();
    return true;
  }

  function handleClearClick() {
    if (clearComposer()) return;
    clearConversation();
  }

  async function handleFileSelect(e) {
    const selected = Array.from(e.target.files || []);
    fileInput.value = '';
    if (selected.length === 0) return;

    const room = MAX_PENDING_FILES - pendingFiles.length;
    if (room <= 0) {
      toast(`最多可添加 ${MAX_PENDING_FILES} 个附件`, 'error');
      return;
    }

    const toRead = selected.slice(0, room);
    if (selected.length > room) {
      toast(`最多可添加 ${MAX_PENDING_FILES} 个附件，已忽略超出文件`, 'error');
    }

    const results = await Promise.allSettled(toRead.map(async (file) => ({
      file_data: await readFileAsDataURL(file),
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
    })));

    const readyFiles = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
    const failedCount = results.length - readyFiles.length;

    if (readyFiles.length > 0) {
      pendingFiles = pendingFiles.concat(readyFiles);
      updateAttachUI();
      toast(`已添加 ${readyFiles.length} 个附件`, 'success');
    }

    if (failedCount > 0) {
      toast(`${failedCount} 个附件读取失败，请重试`, 'error');
    }
  }

  function handleRoleFormSubmit(e) {
    e.preventDefault();
    const data = validateRoleForm();
    if (!data) return;

    const now = Date.now();
    if (data.editingId) {
      const idx = roleCards.findIndex((card) => card.id === data.editingId);
      if (idx >= 0) {
        roleCards[idx] = {
          ...roleCards[idx],
          name: data.name,
          description: data.description,
          openingMessage: data.openingMessage,
          systemPrompt: data.systemPrompt,
          updatedAt: now,
        };
        toast('角色已更新', 'success');
      }
    } else {
      roleCards.push({
        id: createRoleId(),
        name: data.name,
        description: data.description,
        openingMessage: data.openingMessage,
        systemPrompt: data.systemPrompt,
        createdAt: now,
        updatedAt: now,
      });
      toast('角色已创建，可点击启用', 'success');
    }

    saveRoleCardsToStorage();
    renderRoleCardSelect();
    renderRoleCardList();
    resetRoleForm();
  }

  function handleRoleDelete(roleId) {
    const roleCard = getRoleCardById(roleId);
    if (!roleCard) return;
    const confirmed = window.confirm(`确定删除角色「${roleCard.name}」吗？`);
    if (!confirmed) return;

    roleCards = roleCards.filter((card) => card.id !== roleId);
    saveRoleCardsToStorage();

    if (activeRoleCardId === roleId) {
      activeRoleCardId = '';
      saveActiveRoleId();
      toast('已删除角色并关闭角色卡', 'info');
    } else {
      toast('角色已删除', 'success');
    }

    if (roleFormId.value === roleId) {
      resetRoleForm();
    }

    renderRoleCardSelect();
    renderRoleCardList();
  }

  function handleRoleCardListClick(e) {
    const button = e.target.closest('button[data-action][data-role-id]');
    if (!button) return;
    const action = button.dataset.action;
    const roleId = button.dataset.roleId;
    const roleCard = getRoleCardById(roleId);
    if (!roleCard) return;

    if (action === 'activate') {
      roleCardSelect.value = roleId;
      requestRoleSwitch(roleId);
      return;
    }
    if (action === 'edit') {
      fillRoleForm(roleCard);
      return;
    }
    if (action === 'delete') {
      handleRoleDelete(roleId);
    }
  }

  function initRoleCards() {
    roleCards = loadRoleCardsFromStorage();
    activeRoleCardId = loadActiveRoleId();
    if (activeRoleCardId && !getRoleCardById(activeRoleCardId)) {
      activeRoleCardId = '';
      saveActiveRoleId();
    }
    resetRoleForm();
    renderRoleCardSelect();
    renderRoleCardList();
  }

  /* ── Auto-resize textarea ── */
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);
  sendBtn.addEventListener('click', sendMessage);
  clearBtn.addEventListener('click', handleClearClick);
  roleManageBtn.addEventListener('click', openRoleManager);
  roleModalCloseBtn.addEventListener('click', closeRoleManager);
  roleModalBackdrop.addEventListener('click', closeRoleManager);
  roleForm.addEventListener('submit', handleRoleFormSubmit);
  roleFormResetBtn.addEventListener('click', resetRoleForm);
  roleCardList.addEventListener('click', handleRoleCardListClick);
  roleCardSelect.addEventListener('change', (e) => requestRoleSwitch(e.target.value || ''));

  switchClearBtn.addEventListener('click', () => {
    commitRoleSwitch(pendingRoleSwitchId, true);
  });
  switchKeepBtn.addEventListener('click', () => {
    commitRoleSwitch(pendingRoleSwitchId, false);
  });
  switchCancelBtn.addEventListener('click', () => {
    closeRoleSwitchModal(true);
  });
  roleSwitchBackdrop.addEventListener('click', () => {
    closeRoleSwitchModal(true);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isModalOpen(roleSwitchModal)) {
      closeRoleSwitchModal(true);
      return;
    }
    if (isModalOpen(roleManagerModal)) {
      closeRoleManager();
    }
  });

  /* ── Image lightbox ── */
  messagesContainer.addEventListener('click', (e) => {
    const img = e.target.closest('.chat-bubble img');
    if (!img) return;
    const overlay = document.createElement('div');
    overlay.className = 'chat-lightbox';
    const fullImg = document.createElement('img');
    fullImg.src = img.src;
    fullImg.alt = img.alt || '';
    overlay.appendChild(fullImg);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', () => overlay.remove());
    document.addEventListener('keydown', function handler(ev) {
      if (ev.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', handler);
      }
    });
  });

  /* ── Init ── */
  initRoleCards();
  updateEmpty();
  updateAttachUI();
  loadModels();
})();
