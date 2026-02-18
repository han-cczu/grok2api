(() => {
  const chatContainer = document.getElementById('chatContainer');
  const modelSelect = document.getElementById('modelSelect');
  const messagesContainer = document.getElementById('chatMessages');
  const emptyState = document.getElementById('chatEmpty');
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const clearBtn = document.getElementById('clearBtn');

  let messages = [];
  let isSending = false;

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

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

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
    isSending = !enabled;
  }

  /* ── Send message ── */
  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || isSending) return;

    const authHeader = await ensurePublicKey();
    if (authHeader === null) {
      toast('请先配置 Public Key', 'error');
      window.location.href = '/login';
      return;
    }

    messages.push({ role: 'user', content: text });
    chatInput.value = '';
    chatInput.style.height = 'auto';
    updateEmpty();
    appendMessage('user', text);
    setInputEnabled(false);

    const model = modelSelect.value;
    const bubble = appendMessage('assistant', '');
    let fullContent = '';

    try {
      const headers = buildAuthHeaders(authHeader);
      headers['Content-Type'] = 'application/json';

      const res = await fetch('/v1/public/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, stream: true }),
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
    messagesContainer.innerHTML = '';
    updateEmpty();
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

  sendBtn.addEventListener('click', sendMessage);
  clearBtn.addEventListener('click', clearConversation);

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
  updateEmpty();
  loadModels();
})();
