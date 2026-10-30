(() => {
  'use strict';
  // Funções utilitárias e seletores: concentram o acesso aos elementos HTML em um único local.
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const loginView = $('#loginView');
  const teacherApp = $('#teacherApp');
  const monitorView = $('#monitorView');
  const pages = { home: $('#homePage'), monitors: $('#monitorsPage'), observation: $('#observationPage'), project: $('#projectPage') };
  const state = { data: null, selectedMonitor: 1, teacher: '' };
  let csrfToken = ''; // Token anti-CSRF da sessão; não é salvo no armazenamento do navegador.
  let toastTimer; // Controla quando a mensagem temporária desaparece.

  // Exibe uma mensagem de sucesso ou erro na parte superior da tela.
  function toast(message, error = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('error', error);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3300);
  }
  // Centraliza chamadas à API e inclui proteção CSRF em ações administrativas.
  async function api(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken && !headers.has('X-Monitor-Token')) {
      headers.set('X-CSRF-Token', csrfToken);
    }
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok || data.ok === false) throw new Error(data.erro || data.mensagem || 'Não foi possível concluir a operação.');
    return data;
  }
  // Formata uma data devolvida pelo servidor segundo o padrão brasileiro.
  function fmtDate(value) {
    if (!value) return '';
    try { return new Date(value).toLocaleString('pt-BR'); } catch { return value; }
  }
  // Exibe somente uma das áreas principais da aplicação.
  function setVisible(view) {
    [loginView, teacherApp, monitorView].forEach((el) => { el.hidden = el !== view; });
  }
  // Troca a página do painel e atualiza os dados necessários.
  function showPage(name) {
    document.body.classList.toggle('teacher-project-active', name === 'project');
    Object.entries(pages).forEach(([key, el]) => { el.hidden = key !== name; });
    $$('.nav-link').forEach((button) => button.classList.toggle('active', button.dataset.page === (name === 'home' ? 'home' : name === 'monitors' ? 'monitors' : '')));
    if (name === 'monitors') refreshState().catch((e) => toast(e.message, true));
    if (name === 'project') updateProjectPage().catch((e) => toast(e.message, true));
    if (name === 'home') refreshState().catch((e) => toast(e.message, true));
  }
  // Exibe imagens comuns ou as páginas PNG geradas a partir de um PDF.
  // Com isso, o monitor não precisa do visualizador de PDF do navegador.
  function setProjectViewer(container, project, fallbackDrawing = false) {
    const pageUrls = Array.isArray(project?.image_pages)
      ? project.image_pages
          .map((page) => typeof page === 'string' ? page : page?.url)
          .filter((url) => typeof url === 'string' && url.length > 0)
      : [];

    // PDF convertido no servidor: mostra todas as páginas como imagens empilhadas.
    if (pageUrls.length) {
      const pageKey = `${project.version || 1}|${pageUrls.join('|')}`;
      let pagesViewer = container.querySelector('.published-project-pages');

      if (!pagesViewer || pagesViewer.dataset.pageKey !== pageKey) {
        container.replaceChildren();
        pagesViewer = document.createElement('div');
        pagesViewer.className = 'published-project-pages';
        pagesViewer.dataset.pageKey = pageKey;
        pagesViewer.setAttribute('aria-label', 'Páginas do projeto técnico');
        pagesViewer.style.cssText = [
          'display:flex',
          'flex-direction:column',
          'align-items:center',
          'gap:8px',
          'box-sizing:border-box',
          'width:100%',
          'height:100%',
          'min-height:0',
          'overflow:auto',
          'padding:8px',
          'background:#dedede'
        ].join(';');

        pageUrls.forEach((url, index) => {
          const pageImage = document.createElement('img');
          pageImage.src = url;
          pageImage.alt = `Página ${index + 1} do projeto técnico`;
          pageImage.loading = index === 0 ? 'eager' : 'lazy';
          pageImage.decoding = 'async';
          pageImage.style.cssText = [
            'display:block',
            'width:auto',
            'height:auto',
            'max-width:100%',
            'flex:none',
            'object-fit:contain',
            'background:#fff'
          ].join(';');
          pagesViewer.append(pageImage);
        });

        container.replaceChildren(pagesViewer);
      }
      return;
    }

    // Em vez de exibir um PDF que o navegador não conseguiu converter,
    // apresenta a causa provável na própria tela.
    if (project?.type === 'application/pdf' && project?.image_conversion_error) {
      let errorBox = container.querySelector('.pdf-conversion-error');
      if (!errorBox) {
        container.replaceChildren();
        errorBox = document.createElement('div');
        errorBox.className = 'pdf-conversion-error';
        errorBox.style.cssText = 'padding:20px;color:#222;background:#fff;font:16px/1.5 sans-serif;overflow-wrap:anywhere;';
        container.append(errorBox);
      }
      errorBox.textContent = project.image_conversion_error;
      return;
    }

    if (project?.url) {
      const isImage = typeof project.type === 'string' && project.type.startsWith('image/');
      const tag = isImage ? 'img' : 'iframe';
      let viewer = container.querySelector(tag);
      if (!viewer) {
        container.replaceChildren();
        viewer = document.createElement(tag);
        if (isImage) {
          viewer.alt = 'Projeto técnico publicado';
          viewer.className = 'published-project-image';
        } else {
          viewer.title = 'Projeto técnico publicado';
          viewer.loading = 'eager';
        }
        container.append(viewer);
      }
      const viewerUrl = String(project.url);
      if (viewer.getAttribute('src') !== viewerUrl) viewer.setAttribute('src', viewerUrl);
      return;
    }

    container.replaceChildren();
    if (fallbackDrawing) {
      const img = document.createElement('img');
      img.src = '/images/Senai.png';
      img.alt = 'Desenho técnico de exemplo do PDF do SENAI';
      img.className = 'fallback-drawing';
      container.append(img);
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty-preview';
      empty.innerHTML = '<span>PDF</span><p>Nenhum projeto publicado</p>';
      container.append(empty);
    }
  }
  // Atualiza o resumo do projeto geral e dos projetos exclusivos por torno.
  function updateProjectSummary(project, monitors = {}) {
    const wrapper = $('#publishedProject');
    const exclusiveIds = Object.entries(monitors || {})
      .filter(([, monitor]) => monitor.has_project_override && monitor.project)
      .map(([id]) => id);
    if (!project && !exclusiveIds.length) {
      wrapper.hidden = true;
      $('#uploadStatus').textContent = 'Nenhum projeto publicado.';
      return;
    }
    wrapper.hidden = false;
    if (project) {
      $('#projectBadge').textContent = String(project.type || '').startsWith('image/') ? 'IMG' : 'PDF';
      $('#publishedName').textContent = project.name || 'Projeto geral';
      $('#publishedMeta').textContent = `${project.size_label || ''}${project.published_at ? ' · Publicado em ' + fmtDate(project.published_at) : ''} · Disponível para todos os monitores, salvo projetos exclusivos.`;
      $('#uploadStatus').textContent = 'Projeto geral publicado com sucesso.';
    } else {
      $('#projectBadge').textContent = 'LOCAL';
      $('#publishedName').textContent = 'Projetos exclusivos por monitor';
      $('#publishedMeta').textContent = `Desenhos publicados em: ${exclusiveIds.map((id) => `Monitor${id}`).join(', ')}.`;
      $('#uploadStatus').textContent = 'Existem projetos publicados somente em monitores específicos.';
    }
  }
  // Monta os seis cartões, o estado de conexão e as ações de cada monitor.
  function renderMonitorGrid(monitors, project) {
    const grid = $('#monitorGrid');
    grid.replaceChildren();
    for (let id = 1; id <= 6; id++) {
      const monitor = monitors[String(id)] || { online: false, teacher_note: '' };
      const effectiveProject = monitor.project || project;
      const wrapper = document.createElement('article');
      wrapper.className = 'monitor-card';

      const surface = document.createElement('div');
      surface.className = 'monitor-card-surface';
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'monitor-thumb';
      thumb.title = `Visualizar projeto do Monitor${id}`;
      thumb.setAttribute('aria-label', `Visualizar projeto do Monitor${id}`);
      const thumbFile = document.createElement('span');
      thumbFile.className = 'thumb-file';
      thumbFile.textContent = effectiveProject ? (String(effectiveProject.type || '').startsWith('image/') ? 'IMG' : 'PDF') : '▧';
      thumb.append(thumbFile);
      thumb.addEventListener('click', () => openProjectPage(id));

      const line = document.createElement('div');
      line.className = 'monitor-line';
      const title = document.createElement('strong');
      title.textContent = `Monitor${id}`;
      const dot = document.createElement('span');
      dot.className = `status-dot${monitor.online ? ' online' : ''}`;
      dot.title = monitor.online ? 'Monitor ligado e conectado' : 'Monitor desligado ou sem conexão';
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', monitor.online ? 'Monitor conectado' : 'Monitor desconectado');
      line.append(title, dot);
      surface.append(thumb, line);
      const scope = document.createElement('div');
      scope.className = `monitor-project-scope${monitor.has_project_override ? ' exclusive' : ''}`;
      scope.textContent = monitor.has_project_override ? 'Projeto exclusivo deste monitor' : (effectiveProject ? 'Projeto geral' : 'Nenhum projeto publicado');
      surface.append(scope);

      const note = document.createElement('button');
      note.type = 'button';
      note.className = 'monitor-note-link';
      note.textContent = 'Adicionar observação ao aluno';
      note.addEventListener('click', () => openObservation(id));

      
      const openMonitor = document.createElement('a');
      openMonitor.className = 'monitor-open-link';
      openMonitor.textContent = 'Abrir tela deste monitor';

      // Usa o endereço do servidor que abriu o painel.
      // O token privado continua protegido no fragmento da URL.
      const enderecoServidor = window.location.origin;

      openMonitor.href =
        `${enderecoServidor}/?monitor=${id}#token=${encodeURIComponent(monitor.access_token || '')}`;

      openMonitor.target = '_blank';
      openMonitor.rel = 'noopener noreferrer';
      wrapper.append(surface, note, openMonitor);


      if (monitor.has_project_override) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'monitor-reset-project';
        reset.textContent = project ? 'Usar projeto geral' : 'Remover projeto exclusivo';
        reset.title = project ? `Fazer o Monitor${id} voltar a exibir o projeto geral` : `Remover o projeto exclusivo do Monitor${id}`;
        reset.addEventListener('click', async () => {
          const question = project ? `O Monitor${id} voltará a mostrar o projeto geral. Deseja continuar?` : `O projeto exclusivo do Monitor${id} será removido. Não existe um projeto geral publicado. Deseja continuar?`;
          if (!confirm(question)) return;
          reset.disabled = true;
          try {
            const result = await api(`/api/monitor/${id}/project/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            await refreshState();
            toast(result.mensagem);
          } catch (e) {
            toast(e.message, true);
          } finally {
            reset.disabled = false;
          }
        });
        wrapper.append(reset);
      }
      grid.append(wrapper);
    }
  }

  // Mostra o histórico e adiciona exclusão individual protegida pela sessão do professor.
  function renderHistory(container, history, monitorId) {
    container.replaceChildren();
    const entries = Array.isArray(history) ? [...history].reverse() : [];
    if (!entries.length) {
      const empty = document.createElement('p'); empty.className = 'status-caption'; empty.textContent = 'Nenhuma observação enviada ainda.'; container.append(empty); return;
    }
    entries.slice(0, 100).forEach((item) => {
      const el = document.createElement('div'); el.className = 'history-item';
      const header = document.createElement('div'); header.className = 'history-item-header';
      const time = document.createElement('time'); time.textContent = fmtDate(item.created_at);
      header.append(time);
      if (item.id) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'history-delete-btn';
        remove.textContent = 'Apagar';
        remove.setAttribute('aria-label', `Apagar observação do Monitor${monitorId} enviada em ${fmtDate(item.created_at)}`);
        remove.addEventListener('click', async () => {
          if (!confirm(`Deseja apagar esta observação do Monitor${monitorId}? Esta ação não pode ser desfeita.`)) return;
          remove.disabled = true;
          try {
            const result = await api(`/api/monitor/${monitorId}/note/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
            await refreshState();
            openObservation(monitorId);
            toast(result.mensagem || 'Observação apagada com sucesso.');
          } catch (error) {
            toast(error.message || 'Não foi possível apagar a observação.', true);
            remove.disabled = false;
          }
        });
        header.append(remove);
      }
      const text = document.createElement('div'); text.className = 'history-item-text'; text.textContent = item.text || '';
      el.append(header, text); container.append(el);
    });
  }
  // Lê a situação atual do servidor e atualiza o painel do professor.
  async function refreshState() {
    const result = await api('/api/state');
    state.data = result;
    updateProjectSummary(result.project, result.monitors);
    renderMonitorGrid(result.monitors, result.project);
    const previewMonitor = result.monitors[String(state.selectedMonitor || 1)];
    const observationProject = previewMonitor?.project || result.project;
    setProjectViewer($('#observationPreview'), observationProject, !observationProject);
    return result;
  }
  // Abre o formulário e o histórico de observações de um torno.
  function openObservation(id) {
    state.selectedMonitor = id;
    $('#observationTitle').textContent = `Monitor${id}`;
    const monitor = state.data?.monitors?.[String(id)];
    $('#teacherNoteInput').value = monitor?.teacher_note || '';
    const observationProject = monitor?.project || state.data?.project;
    setProjectViewer($('#observationPreview'), observationProject, !observationProject);
    const history = Array.isArray(monitor?.teacher_history) ? monitor.teacher_history : [];
    const deleteCurrentButton = $('#deleteCurrentNoteButton');
    deleteCurrentButton.disabled = !history.length || !history[history.length - 1]?.id;
    deleteCurrentButton.title = deleteCurrentButton.disabled
      ? 'Não há observação enviada para apagar.'
      : 'Apagar a observação mais recente deste monitor';
    renderHistory($('#teacherHistory'), history, id);
    showPage('observation');
  }
  // Abre a prévia do desenho e as anotações relativas ao torno selecionado.
  function openProjectPage(id) {
    state.selectedMonitor = id;
    $('#projectMonitorSelect').value = String(id);
    showPage('project');
  }
  // Atualiza o desenho e a observação quando o professor escolhe outro torno.
  async function updateProjectPage() {
    const result = await api('/api/state');
    state.data = result;
    const id = Number($('#projectMonitorSelect').value || state.selectedMonitor);
    const monitor = result.monitors[String(id)];
    $('#projectTeacherNote').value = monitor?.teacher_note || '';
    const monitorProject = monitor?.project || result.project;
    setProjectViewer($('#teacherPdfViewer'), monitorProject, !monitorProject);
  }
  // Mostra o painel apenas depois de a API confirmar a sessão do professor.
  function login() {
    const teacher = state.teacher || 'Professor';
    $('#userDisplay').textContent = teacher;
    setVisible(teacherApp);
    showPage('home');
    refreshState().catch((e) => toast(e.message, true));
    if (window.teacherRefreshTimer) clearInterval(window.teacherRefreshTimer);
    window.teacherRefreshTimer = setInterval(() => {
      if (!teacherApp.hidden) refreshState().catch(() => {});
    }, 10000);
  }
  // Inicializa a tela de um monitor; as chamadas seguintes enviam o token por cabeçalho.
  function startMonitor(id, monitorToken) {
    id = Math.max(1, Math.min(6, Number(id) || 1));
    setVisible(monitorView);
    $('#monitorHeading').textContent = `Monitor${id}`;
    const connection = $('#monitorConnection');

    // Envia um sinal periódico; o servidor usa o horário recebido para colorir o status.
    async function heartbeat() {
      try {
        await api(`/api/monitor/${id}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Monitor-Token': monitorToken || '' },
          body: '{}'
        });
        connection.textContent = 'Conectado';
        connection.classList.remove('disconnected');
      } catch {
        connection.textContent = 'Sem conexão com o servidor';
        connection.classList.add('disconnected');
      }
    }

    // Atualiza o desenho e a observação deste torno, usando sua chave privada.
    async function refreshMonitor() {
      try {
        const result = await api(`/api/monitor/${id}/display`, { headers: { 'X-Monitor-Token': monitorToken || '' } });
        const monitor = result.monitor;
        const monitorProject = result.project;
        setProjectViewer($('#monitorPdfViewer'), monitorProject, false);
        $('#monitorProjectName').textContent = monitorProject?.name || 'Aguardando projeto do professor';
        $('#teacherFeedbackText').textContent = monitor.teacher_note || 'Nenhuma observação enviada.';
        connection.textContent = 'Conectado';
        connection.classList.remove('disconnected');
      } catch {
        connection.textContent = 'Sem conexão com o servidor';
        connection.classList.add('disconnected');
      }
    }

    heartbeat();
    refreshMonitor();
    if (window.monitorRefreshTimer) clearInterval(window.monitorRefreshTimer);
    window.monitorRefreshTimer = setInterval(() => {
      heartbeat();
      refreshMonitor();
    }, 10000);
  }


  // Envia as credenciais ao servidor para validação real; a senha não é comparada aqui.
  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#username').value.trim();
    const password = $('#password').value;
    if (!username || !password) return toast('Preencha o usuário e a senha.', true);
    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      state.teacher = result.username;
      csrfToken = result.csrf_token || '';
      $('#password').value = '';
      login();
    } catch (e) {
      toast(e.message, true);
    } finally {
      button.disabled = false;
    }
  });
  // Liga os botões do menu à navegação entre as páginas do painel.
  $$('.nav-link').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
  // Encerra a sessão do servidor e limpa o estado desta aba.
  $('#logoutButton').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* finaliza a tela local mesmo se a conexão cair */ }
    state.teacher = '';
    csrfToken = '';
    clearInterval(window.monitorRefreshTimer);
    clearInterval(window.teacherRefreshTimer);
    document.body.classList.remove('teacher-project-active');
    setVisible(loginView);
    // Ao sair, sempre apresenta o formulário de entrada, nunca o cadastro inicial.
    setAccessMode('login');
    $('#password').value = '';
  });
  // Abre a janela para trocar a senha do professor.
  $('#changePasswordButton').addEventListener('click', () => {
    $('#passwordChangeForm').reset();
    $('#passwordChangeDialog').showModal();
    $('#currentPasswordInput').focus();
  });
  // Fecha o diálogo de senha sem modificar a conta.
  $('#cancelPasswordChange').addEventListener('click', () => $('#passwordChangeDialog').close());
  // Troca a senha após conferir a senha atual e a confirmação.
  $('#passwordChangeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentPassword = $('#currentPasswordInput').value;
    const newPassword = $('#newPasswordInput').value;
    const confirmation = $('#confirmPasswordInput').value;
    if (newPassword.length < 8) return toast('Use uma senha com pelo menos 8 caracteres.', true);
    if (newPassword !== confirmation) return toast('As novas senhas não coincidem.', true);
    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
      csrfToken = result.csrf_token || csrfToken;
      $('#passwordChangeDialog').close();
      $('#passwordChangeForm').reset();
      toast(result.mensagem || 'Senha alterada com sucesso.');
    } catch (e) { toast(e.message, true); }
    finally { button.disabled = false; }
  });
  // Mostra o nome e o tamanho do arquivo escolhido antes de enviar.
  $('#pdfFile').addEventListener('change', () => { const f = $('#pdfFile').files[0]; $('#selectedFileName').textContent = f ? `${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)` : 'Clique para selecionar o arquivo PDF'; });
  // Desfaz a seleção de arquivo local, sem apagar um desenho já publicado.
  $('#clearSelectedFile').addEventListener('click', () => { $('#pdfFile').value = ''; $('#selectedFileName').textContent = 'Clique para selecionar um PDF ou imagem'; });
  // Envia o projeto e o destino selecionado para a API autenticada.
  $('#uploadForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = $('#pdfFile').files[0];
    if (!file) return toast('Selecione um PDF ou imagem primeiro.', true);
    const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
    const lowerName = file.name.toLowerCase();
    if (!allowedExtensions.some((ext) => lowerName.endsWith(ext))) return toast('Use PDF, PNG, JPG, JPEG, WEBP, GIF ou BMP.', true);
    if (file.size > 100 * 1024 * 1024) return toast('O arquivo precisa ter no máximo 100 MB.', true);
    const button = event.submitter || event.currentTarget.querySelector('button[type=submit]');
    button.disabled = true; button.textContent = 'Publicando...';
    try {
      const body = new FormData();
      body.append('arquivo', file);
      body.append('destino', $('#publishTarget').value || 'todos');
      const result = await api('/api/upload', { method: 'POST', body });
      $('#uploadStatus').textContent = result.mensagem;
      $('#pdfFile').value = ''; $('#selectedFileName').textContent = 'Clique para selecionar um PDF ou imagem';
      await refreshState();
      $('#uploadStatus').textContent = result.mensagem;
      toast(result.mensagem);
      showPage('home');
    } catch (e) { toast(e.message, true); }
    finally { button.disabled = false; button.textContent = 'Concluir'; }
  });
  // Abre a visualização do desenho publicado.
  $('#previewProjectButton').addEventListener('click', () => {
    let id = state.selectedMonitor || 1;
    const monitors = state.data?.monitors || {};
    if (!state.data?.project && !monitors[String(id)]?.project) {
      const firstAssigned = Object.keys(monitors).find((key) => monitors[key]?.project);
      if (firstAssigned) id = Number(firstAssigned);
    }
    openProjectPage(id);
  });
  // Pede confirmação antes de excluir todos os projetos publicados.
  $('#deleteProjectButton').addEventListener('click', async () => {
    if (!confirm('Deseja remover o projeto geral e todos os projetos exclusivos? Os seis monitores ficarão sem desenho.')) return;
    try { const result = await api('/api/project/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await refreshState(); toast(result.mensagem); }
    catch (e) { toast(e.message, true); }
  });
  // Salva a observação do professor para o monitor selecionado.
  $('#teacherNoteForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const note = $('#teacherNoteInput').value.trim();
    if (!note) return toast('Digite uma observação antes de enviar.', true);
    try {
      await api(`/api/monitor/${state.selectedMonitor}/note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'teacher', note }) });
      await refreshState(); openObservation(state.selectedMonitor); toast('Observação enviada ao monitor.');
    } catch (e) { toast(e.message, true); }
  });
  // Botão visível junto de Voltar/Enviar: apaga a última observação já salva.
  $('#deleteCurrentNoteButton').addEventListener('click', async () => {
    const monitorId = state.selectedMonitor;
    const monitor = state.data?.monitors?.[String(monitorId)];
    const history = Array.isArray(monitor?.teacher_history) ? monitor.teacher_history : [];
    const latest = history[history.length - 1];
    if (!latest?.id) return toast('Não há observação enviada para apagar.', true);
    if (!confirm(`Deseja apagar a última observação do Monitor${monitorId}? Esta ação não pode ser desfeita.`)) return;
    const button = $('#deleteCurrentNoteButton');
    button.disabled = true;
    try {
      const result = await api(`/api/monitor/${monitorId}/note/${encodeURIComponent(latest.id)}`, { method: 'DELETE' });
      await refreshState();
      openObservation(monitorId);
      toast(result.mensagem || 'Observação apagada com sucesso.');
    } catch (error) {
      toast(error.message || 'Não foi possível apagar a observação.', true);
      button.disabled = false;
    }
  });
  // Volta da anotação para a grade dos seis monitores.
  $('#backToMonitors').addEventListener('click', () => showPage('monitors'));
  // Ao trocar o monitor no seletor, atualiza o desenho e a observação.

  $('#projectMonitorSelect').addEventListener('change', updateProjectPage);
  // Salva uma observação a partir da tela de visualização do desenho.
  $('#saveProjectNote').addEventListener('click', async () => {
    const note = $('#projectTeacherNote').value.trim();
    if (!note) return toast('Digite uma observação antes de salvar.', true);
    const id = Number($('#projectMonitorSelect').value);
    try { await api(`/api/monitor/${id}/note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'teacher', note }) }); await refreshState(); toast(`Observação salva para o Monitor${id}.`); }
    catch (e) { toast(e.message, true); }
  });
  // Retorna à grade dos monitores após consultar um projeto.
  $('#backFromProject').addEventListener('click', () => showPage('monitors'));


  // Lê o número do monitor e o token no fragmento da URL. O fragmento não vai para o servidor.
  const url = new URL(window.location.href);
  const monitorId = url.searchParams.get('monitor') || (location.pathname.match(/^\/monitor\/([1-6])\/?$/) || [])[1];
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  // A leitura da query token é temporária, apenas para links antigos, durante a migração.
  const monitorToken = fragment.get('token') || url.searchParams.get('token') || '';
  if (monitorId) {
    // Apaga o token visível da barra de endereço assim que a página o guarda em memória.
    window.history.replaceState({}, document.title, `${url.pathname}?monitor=${encodeURIComponent(monitorId)}`);
    startMonitor(monitorId, monitorToken);
  } else {
    // Consulta a sessão; se já houver login válido, pede também o token anti-CSRF da sessão.
    api('/api/auth/status').then((auth) => {
      setupAvailable = Boolean(auth.setup_available);
      if (auth.authenticated) {
        state.teacher = auth.username || 'Professor';
        csrfToken = auth.csrf_token || '';
        login();
      } else {
        setVisible(loginView);
        $('#toggleSetupButton').hidden = !auth.setup_available;
        setAccessMode('login');
      }
    }).catch(() => {
      setVisible(loginView);
      toast('Não foi possível falar com o servidor. Confirme se ele está iniciado.', true);
    });
  }

  // Alterna os formulários pelo botão do cabeçalho: login primeiro, cadastro no primeiro acesso.
  let setupAvailable = false;
  function setAccessMode(mode) {
    const creating = mode === 'setup' && setupAvailable;
    $('#loginForm').hidden = creating;
    $('#recoveryForm').hidden = true;
    $('#setupForm').hidden = !creating;
    $('#toggleSetupButton').textContent = 'Criar usuário e senha';
    $('#toggleSetupButton').hidden = !setupAvailable || creating;
    $('#backToLoginButton').hidden = !creating;
    if (creating) $('#setupUsernameInput').focus();
    else $('#username').focus();
  }

  $('#toggleSetupButton').addEventListener('click', () => {
    setAccessMode('setup');
  });
  $('#backToLoginButton').addEventListener('click', () => {
    $('#setupForm').reset();
    setAccessMode('login');
  });


  $('#forgotPasswordButton').addEventListener('click', () => {
    $('#loginForm').hidden = true; $('#setupForm').hidden = true; $('#recoveryForm').hidden = false;
    $('#recoveryUsername').value = $('#username').value.trim(); $('#recoveryCode').focus();
  });
  $('#cancelRecoveryButton').addEventListener('click', () => { $('#recoveryForm').reset(); setAccessMode('login'); });
  $('#recoveryForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#recoveryUsername').value.trim();
    const recovery_code = $('#recoveryCode').value.trim();
    const new_password = $('#recoveryNewPassword').value;
    const confirmation = $('#recoveryConfirmPassword').value;
    if (new_password.length < 12) return toast('Use uma senha com pelo menos 12 caracteres.', true);
    if (new_password !== confirmation) return toast('As senhas não coincidem.', true);
    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const result = await api('/api/password/recover', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,recovery_code,new_password,confirmation})});
      alert('Senha redefinida com sucesso! O código mestre permanece o mesmo. Guarde-o em local seguro.');
      $('#recoveryForm').reset(); $('#username').value = username; setAccessMode('login'); toast(result.mensagem);
    } catch (e) { toast(e.message, true); } finally { button.disabled = false; }
  });

  // Cria a única conta inicial no próprio servidor; a API grava apenas o hash da senha.
  $('#setupForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#setupUsernameInput').value.trim();
    const password = $('#setupPasswordInput').value;
    const confirmation = $('#setupConfirmationInput').value;
    if (!username || username.length < 3) return toast('O usuário precisa ter pelo menos 3 caracteres.', true);
    if (password.length < 8) return toast('Use uma senha com pelo menos 8 caracteres.', true);
    if (password !== confirmation) return toast('As senhas não coincidem.', true);
    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, confirmation })
      });
      setupAvailable = false;
      state.teacher = result.username;
      csrfToken = result.csrf_token || '';
      $('#setupForm').reset();
      alert('CONTA CRIADA!\n\nO código mestre de recuperação é fixo e foi fornecido ao responsável pelo sistema. Guarde-o em local seguro.');
      $('#toggleSetupButton').hidden = true;
      $('#backToLoginButton').hidden = true;
      login();
      toast('Acesso criado. Você já entrou no ConecTorno.');
    } catch (e) {
      toast(e.message, true);
    } finally {
      button.disabled = false;
    }
  });

})();
