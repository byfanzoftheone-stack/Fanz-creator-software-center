(() => {
  'use strict';

  const APP_KEY = 'creatorCenter.state.v1';
  const DB_NAME = 'creatorCenterMedia';
  const DB_STORE = 'blobs';
  const ACCENTS = {
    violet: ['#7c3cff', '#c56cff'],
    cyan: ['#00a8cc', '#4de6ff'],
    rose: ['#d93d7a', '#ff87b2'],
    lime: ['#48a868', '#8cf4a5']
  };

  const templates = [
    { id: 'hook', name: '3-Second Hook', category: 'Short-form', title: 'Stop scrolling — try this', caption: 'Lead with the payoff, then show the fastest path to the result.', cta: 'Watch the full breakdown', colors: ['#4317a5','#d766f5'] },
    { id: 'tutorial', name: 'Fast Tutorial', category: 'Education', title: 'How to do it in 3 steps', caption: 'A clean teaching format with a clear outcome and compact steps.', cta: 'Save this for later', colors: ['#123f82','#2bc5d9'] },
    { id: 'launch', name: 'Product Launch', category: 'Marketing', title: 'Introducing something new', caption: 'Feature the value, proof, and one focused call to action.', cta: 'See what changed', colors: ['#671a4d','#ff7d90'] },
    { id: 'podcast', name: 'Podcast Clip', category: 'Audio', title: 'The part everyone remembers', caption: 'Pair the strongest quote with a clean waveform-led visual.', cta: 'Hear the full episode', colors: ['#1d2a61','#8f58ff'] },
    { id: 'portfolio', name: 'Creator Portfolio', category: 'Showcase', title: 'Selected work', caption: 'A minimal creator reel format for showing projects and case studies.', cta: 'View the project', colors: ['#173d3f','#4bc8a8'] },
    { id: 'story', name: 'Story Sequence', category: 'Social', title: 'A story worth finishing', caption: 'Hook, context, turning point, result, and call to action.', cta: 'Continue the story', colors: ['#54247c','#ff9b69'] }
  ];

  const defaultState = {
    version: 1,
    activeProjectId: 'p1',
    projects: [
      { id:'p1', name:'Travel Vlog: Japan', status:'draft', progress:75, updatedAt:Date.now()-7200000, createdAt:Date.now()-86400000*3, title:'A week in Japan', caption:'Temples, trains, street food, and the moments between.', cta:'Watch the journey', accent:'#7c3cff', accent2:'#c56cff', mediaId:null, notes:'' },
      { id:'p2', name:'Product Launch Reel', status:'in-progress', progress:45, updatedAt:Date.now()-18000000, createdAt:Date.now()-86400000*5, title:'Meet the new release', caption:'A concise product story built around benefits, motion, and proof.', cta:'Explore the launch', accent:'#1447b8', accent2:'#4de6ff', mediaId:null, notes:'' },
      { id:'p3', name:'Weekly Tips Series', status:'scheduled', progress:92, updatedAt:Date.now()-86400000, createdAt:Date.now()-86400000*8, title:'Three creator shortcuts', caption:'Small workflow upgrades that save real time every week.', cta:'Save these tips', accent:'#5b2fc4', accent2:'#9e70ff', mediaId:null, notes:'' }
    ],
    media: [],
    schedules: [{ id:'s1', projectId:'p3', channel:'Local schedule', datetime:new Date(Date.now()+86400000*2).toISOString(), createdAt:Date.now()-86400000 }],
    ideas: [],
    wireframe: {
      layout: 'list',
      selectedId: 'w1',
      elements: [
        { id:'w1', type:'hero', label:'Creator headline' },
        { id:'w2', type:'image', label:'Featured media' },
        { id:'w3', type:'text', label:'Supporting story' },
        { id:'w4', type:'button', label:'Primary action' }
      ]
    },
    prototype: { transition:'slide', duration:450, haptics:true },
    settings: { accentName:'violet', projectView:'grid', creatorName:'Creator' },
    activity: [
      { id:'a1', icon:'✦', title:'Workspace created', detail:'Creator Center is ready.', time:Date.now()-3600000 },
      { id:'a2', icon:'▣', title:'Project updated', detail:'Travel Vlog: Japan', time:Date.now()-7200000 },
      { id:'a3', icon:'↝', title:'Post scheduled', detail:'Weekly Tips Series', time:Date.now()-86400000 }
    ]
  };

  let state = loadState();
  let currentRoute = 'dashboard';
  let currentMediaSearch = '';
  let currentProjectSearch = '';
  let mediaRecorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let voiceBlob = null;
  let voiceBlobUrl = null;
  let voiceAudioBuffer = null;
  let installPrompt = null;
  const mediaUrls = new Map();

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const root = $('#viewRoot');

  function uid(prefix='id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function loadState() {
    try {
      const raw = localStorage.getItem(APP_KEY);
      if (!raw) return clone(defaultState);
      const parsed = JSON.parse(raw);
      return {
        ...clone(defaultState),
        ...parsed,
        settings: { ...clone(defaultState.settings), ...(parsed.settings || {}) },
        wireframe: { ...clone(defaultState.wireframe), ...(parsed.wireframe || {}) },
        prototype: { ...clone(defaultState.prototype), ...(parsed.prototype || {}) }
      };
    } catch (e) {
      console.warn('Could not load local state:', e);
      return clone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(APP_KEY, JSON.stringify(state));
    updateStorageMeter();
  }

  function logActivity(title, detail='', icon='✦') {
    state.activity.unshift({ id:uid('a'), title, detail, icon, time:Date.now() });
    state.activity = state.activity.slice(0, 40);
  }

  function escapeHTML(value='') {
    return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
  }

  function fmtDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  }

  function timeAgo(ts) {
    const s = Math.max(0, (Date.now() - Number(ts)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    if (s < 604800) return `${Math.floor(s/86400)}d ago`;
    return fmtDate(ts);
  }

  function bytes(n=0) {
    if (!n) return '0 B';
    const units = ['B','KB','MB','GB'];
    const i = Math.min(Math.floor(Math.log(n)/Math.log(1024)), units.length-1);
    return `${(n / Math.pow(1024,i)).toFixed(i ? 1 : 0)} ${units[i]}`;
  }

  function activeProject() {
    return state.projects.find(p => p.id === state.activeProjectId) || null;
  }

  function applyAccent() {
    const pair = ACCENTS[state.settings.accentName] || ACCENTS.violet;
    document.documentElement.style.setProperty('--accent', pair[0]);
    document.documentElement.style.setProperty('--accent2', pair[1]);
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toast.classList.remove('show'), 2300);
  }

  function routeTo(route) {
    currentRoute = route;
    if (location.hash !== `#/${route}`) history.replaceState(null, '', `#/${route}`);
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.route === route));
    $$('#mobileNav button').forEach(b => b.classList.toggle('active', b.dataset.route === route));
    render();
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  function setHeader(title, eyebrow='CREATOR SOFTWARE CENTER') {
    $('#pageTitle').textContent = title;
    $('#pageEyebrow').textContent = eyebrow;
  }

  function openModal({ title, eyebrow='CREATE', body='', actions=[] }) {
    $('#modalTitle').textContent = title;
    $('#modalEyebrow').textContent = eyebrow;
    $('#modalBody').innerHTML = body;
    const area = $('#modalActions');
    area.innerHTML = '';
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = a.className || 'primary-button';
      btn.textContent = a.label;
      btn.addEventListener('click', a.onClick);
      area.appendChild(btn);
    });
    $('#modal').showModal();
  }

  function closeModal() { $('#modal').close(); }

  function newProjectModal(prefill={}) {
    openModal({
      title:'New creator project',
      eyebrow:'PROJECT',
      body:`
        <div class="field"><label>Project name</label><input id="newProjectName" maxlength="80" value="${escapeHTML(prefill.name || '')}" placeholder="e.g. Launch Reel" /></div>
        <div class="field-row" style="margin-top:12px">
          <div class="field"><label>Status</label><select id="newProjectStatus"><option value="draft">Draft</option><option value="in-progress">In progress</option><option value="scheduled">Scheduled</option></select></div>
          <div class="field"><label>Starting progress</label><input id="newProjectProgress" type="number" min="0" max="100" value="${Number(prefill.progress ?? 10)}" /></div>
        </div>
      `,
      actions:[
        { label:'Cancel', className:'ghost-button', onClick:closeModal },
        { label:'Create project', onClick:() => {
          const name = $('#newProjectName').value.trim();
          if (!name) return showToast('Give the project a name.');
          const p = {
            id:uid('p'), name, status:$('#newProjectStatus').value, progress:Math.min(100,Math.max(0,Number($('#newProjectProgress').value)||0)),
            updatedAt:Date.now(), createdAt:Date.now(), title:prefill.title || name, caption:prefill.caption || 'Shape the story, media, and call to action in Creator Studio.', cta:prefill.cta || 'Learn more',
            accent:prefill.accent || (ACCENTS[state.settings.accentName] || ACCENTS.violet)[0], accent2:prefill.accent2 || (ACCENTS[state.settings.accentName] || ACCENTS.violet)[1],
            mediaId:null, notes:''
          };
          state.projects.unshift(p); state.activeProjectId = p.id; logActivity('Project created', name, '＋'); saveState(); closeModal(); showToast('Project created.'); routeTo('studio');
        }}
      ]
    });
    setTimeout(() => $('#newProjectName')?.focus(), 50);
  }

  function quickSearchModal() {
    openModal({
      title:'Search Creator Center', eyebrow:'QUICK FIND',
      body:`<div class="search-box"><input id="globalSearch" placeholder="Search projects, media, templates…" /></div><div id="globalResults" style="margin-top:14px"></div>`,
      actions:[{label:'Close', className:'ghost-button', onClick:closeModal}]
    });
    const input = $('#globalSearch');
    const renderResults = () => {
      const q = input.value.trim().toLowerCase();
      const projects = state.projects.filter(p => p.name.toLowerCase().includes(q)).slice(0,5);
      const media = state.media.filter(m => m.name.toLowerCase().includes(q)).slice(0,5);
      const temps = templates.filter(t => `${t.name} ${t.category}`.toLowerCase().includes(q)).slice(0,5);
      $('#globalResults').innerHTML = `
        ${projects.map(p=>`<button class="palette-button search-result" data-type="project" data-id="${p.id}"><b>${escapeHTML(p.name)}</b><span>Project • ${escapeHTML(p.status)}</span></button>`).join('')}
        ${media.map(m=>`<button class="palette-button search-result" data-type="media" data-id="${m.id}"><b>${escapeHTML(m.name)}</b><span>Media • ${escapeHTML(m.type)}</span></button>`).join('')}
        ${temps.map(t=>`<button class="palette-button search-result" data-type="template" data-id="${t.id}"><b>${escapeHTML(t.name)}</b><span>Template • ${escapeHTML(t.category)}</span></button>`).join('')}
        ${projects.length+media.length+temps.length===0?'<div class="empty"><strong>No matches</strong>Try a different search.</div>':''}
      `;
      $$('.search-result', $('#globalResults')).forEach(btn => btn.onclick = () => {
        closeModal();
        if (btn.dataset.type==='project') { state.activeProjectId = btn.dataset.id; saveState(); routeTo('studio'); }
        else if (btn.dataset.type==='media') { currentMediaSearch = state.media.find(m=>m.id===btn.dataset.id)?.name || ''; routeTo('media'); }
        else routeTo('templates');
      });
    };
    input.addEventListener('input', renderResults); renderResults(); setTimeout(()=>input.focus(),50);
  }

  function render() {
    const map = {
      dashboard: renderDashboard,
      projects: renderProjects,
      studio: renderStudio,
      media: renderMedia,
      templates: renderTemplates,
      ideas: renderIdeas,
      wireframes: renderWireframes,
      prototype: renderPrototype,
      voice: renderVoice,
      analytics: renderAnalytics,
      settings: renderSettings
    };
    (map[currentRoute] || renderDashboard)();
  }

  function renderDashboard() {
    setHeader(`Good ${partOfDay()}, ${state.settings.creatorName || 'Creator'}`, 'CREATOR SOFTWARE CENTER');
    const active = state.projects.filter(p => p.status !== 'scheduled').length;
    const scheduled = state.schedules.filter(s => new Date(s.datetime).getTime() > Date.now()).length;
    const next = state.schedules.filter(s=>new Date(s.datetime).getTime()>Date.now()).sort((a,b)=>new Date(a.datetime)-new Date(b.datetime))[0];
    root.innerHTML = `
      <div class="page-grid">
        <section class="hero-card glass-card span-2">
          <div class="hero-orb" aria-hidden="true"></div>
          <div class="hero-copy">
            <div class="eyebrow">CREATOR OPERATING SYSTEM</div>
            <h2>Idea to publish,<br>inside one center.</h2>
            <p>Plan projects, organize media, compose screens, test interaction ideas, record audio, and schedule content — with local data staying in your browser.</p>
            <div class="hero-actions"><button class="primary-button" data-go="studio">Open Creator Studio</button><button class="secondary-button" data-go="ideas">Generate ideas</button></div>
          </div>
        </section>

        <section class="grid-4">
          ${statCard('▣', state.projects.length, 'Projects')}
          ${statCard('◫', state.media.length, 'Media assets')}
          ${statCard('↝', scheduled, 'Scheduled')}
          ${statCard('✦', active, 'Active drafts')}
        </section>

        <section class="glass-card card-pad span-2">
          <div class="section-title-row"><div><h2>Quick actions</h2><p>Jump directly into your creation workflow.</p></div></div>
          <div class="quick-grid">
            ${quickCard('◉','Capture / Upload','Add images, video, or audio.','media')}
            ${quickCard('✎','Edit Project','Compose the current project screen.','studio')}
            ${quickCard('▦','Use Template','Start from a creator-ready structure.','templates')}
            ${quickCard('✧','Find an Idea','Generate an offline idea board.','ideas')}
          </div>
        </section>

        <section class="grid-2">
          <div class="glass-card card-pad">
            <div class="section-title-row"><div><h2>Recent projects</h2><p>Your latest creator work.</p></div><button class="ghost-button" data-go="projects">View all</button></div>
            <div class="activity-list">
              ${state.projects.slice().sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,4).map(p=>`
                <button class="activity-row project-open" data-id="${p.id}" style="width:100%;background:none;border:0;color:inherit;text-align:left">
                  <div class="activity-dot">▣</div><div><b>${escapeHTML(p.name)}</b><p>${escapeHTML(p.status)} • ${p.progress}% complete</p></div><time>${timeAgo(p.updatedAt)}</time>
                </button>`).join('') || '<div class="empty"><strong>No projects yet</strong>Create one to begin.</div>'}
            </div>
          </div>
          <div class="glass-card card-pad">
            <div class="section-title-row"><div><h2>Next publish</h2><p>Local scheduling queue.</p></div></div>
            ${next ? (()=>{const p=state.projects.find(x=>x.id===next.projectId);return `<div style="padding:20px;border:1px solid var(--line);border-radius:17px;background:rgba(124,60,255,.08)"><div class="eyebrow">${escapeHTML(next.channel)}</div><h3 style="font-size:23px;margin:8px 0">${escapeHTML(p?.name || 'Project')}</h3><p class="muted">${fmtDateTime(next.datetime)}</p><button class="secondary-button schedule-open" data-id="${next.id}">Manage schedule</button></div>`})() : '<div class="empty"><strong>No scheduled content</strong>Open a project in Studio to schedule it.</div>'}
          </div>
        </section>

        <section class="glass-card card-pad">
          <div class="section-title-row"><div><h2>Recent activity</h2><p>Local events in this workspace.</p></div></div>
          <div class="activity-list">${activityHTML(state.activity.slice(0,6))}</div>
        </section>
      </div>`;
    $$('[data-go]',root).forEach(b=>b.onclick=()=>routeTo(b.dataset.go));
    $$('.project-open',root).forEach(b=>b.onclick=()=>{state.activeProjectId=b.dataset.id;saveState();routeTo('studio')});
    $$('.schedule-open',root).forEach(b=>b.onclick=()=>scheduleManagerModal(b.dataset.id));
  }

  function partOfDay() {
    const h = new Date().getHours();
    return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  }

  function statCard(icon, num, label) {
    return `<div class="stat-card glass-card"><div class="stat-icon">${icon}</div><div><strong>${num}</strong><span>${label}</span></div></div>`;
  }
  function quickCard(icon,title,desc,route) {
    return `<button class="quick-card" data-go="${route}"><span class="qicon">${icon}</span><b>${title}</b><small>${desc}</small></button>`;
  }
  function activityHTML(items) {
    return items.map(a=>`<div class="activity-row"><div class="activity-dot">${a.icon||'✦'}</div><div><b>${escapeHTML(a.title)}</b><p>${escapeHTML(a.detail||'')}</p></div><time>${timeAgo(a.time)}</time></div>`).join('') || '<div class="empty"><strong>No activity yet</strong>Your creator actions will appear here.</div>';
  }

  function renderProjects() {
    setHeader('Projects', 'PLAN • CREATE • SHIP');
    const q = currentProjectSearch.toLowerCase();
    const projects = state.projects.filter(p => p.name.toLowerCase().includes(q));
    root.innerHTML = `
      <div class="section-title-row"><div><h2>Creator projects</h2><p>Manage drafts, active work, and scheduled releases.</p></div><button class="primary-button" id="projectAdd">＋ New project</button></div>
      <div class="toolbar">
        <div class="search-box"><input id="projectSearch" value="${escapeHTML(currentProjectSearch)}" placeholder="Search projects…" /></div>
        <button class="secondary-button view-toggle" data-view="grid">▦ Grid</button>
        <button class="secondary-button view-toggle" data-view="list">☷ List</button>
      </div>
      <div class="projects-grid ${state.settings.projectView==='list'?'list-view':''}" id="projectsGrid">
        ${projects.map(projectCardHTML).join('') || '<div class="empty"><strong>No matching projects</strong>Try another search or create a new project.</div>'}
      </div>`;
    $('#projectAdd').onclick=()=>newProjectModal();
    $('#projectSearch').oninput=e=>{currentProjectSearch=e.target.value;renderProjects()};
    $$('.view-toggle',root).forEach(b=>b.onclick=()=>{state.settings.projectView=b.dataset.view;saveState();renderProjects()});
    $$('.project-card',root).forEach(card=>card.onclick=e=>{
      if (e.target.closest('.project-menu')) return;
      state.activeProjectId=card.dataset.id;saveState();routeTo('studio');
    });
    $$('.project-menu',root).forEach(btn=>btn.onclick=e=>{e.stopPropagation();projectActionsModal(btn.closest('.project-card').dataset.id)});
  }

  function projectCardHTML(p) {
    const st = p.status === 'draft' ? 'draft' : p.status === 'scheduled' ? 'scheduled' : '';
    return `<article class="project-card glass-card" data-id="${p.id}">
      <div class="project-thumb" style="background:linear-gradient(140deg,${p.accent||'#7c3cff'},${p.accent2||'#211943'})"></div>
      <div class="project-card-body"><div class="project-card-top"><span class="status-pill ${st}">${escapeHTML(p.status)}</span><button class="icon-button project-menu">⋯</button></div><h3>${escapeHTML(p.name)}</h3><p class="project-meta">Updated ${timeAgo(p.updatedAt)} • ${p.progress}% complete</p><div class="progress"><i style="width:${p.progress}%"></i></div></div>
    </article>`;
  }

  function projectActionsModal(projectId) {
    const p = state.projects.find(x=>x.id===projectId); if(!p)return;
    openModal({title:p.name,eyebrow:'PROJECT ACTIONS',body:`
      <div class="field"><label>Rename</label><input id="renameProject" value="${escapeHTML(p.name)}" /></div>
      <div class="field-row" style="margin-top:12px"><div class="field"><label>Status</label><select id="projectStatus"><option value="draft" ${p.status==='draft'?'selected':''}>Draft</option><option value="in-progress" ${p.status==='in-progress'?'selected':''}>In progress</option><option value="scheduled" ${p.status==='scheduled'?'selected':''}>Scheduled</option></select></div><div class="field"><label>Progress</label><input type="number" min="0" max="100" id="projectProgress" value="${p.progress}"></div></div>`,actions:[
      {label:'Delete',className:'danger-button',onClick:()=>{ if(confirm(`Delete “${p.name}”?`)){state.projects=state.projects.filter(x=>x.id!==p.id);state.schedules=state.schedules.filter(s=>s.projectId!==p.id);if(state.activeProjectId===p.id)state.activeProjectId=state.projects[0]?.id||null;logActivity('Project deleted',p.name,'×');saveState();closeModal();renderProjects();}}},
      {label:'Open Studio',className:'secondary-button',onClick:()=>{state.activeProjectId=p.id;saveState();closeModal();routeTo('studio')}},
      {label:'Save',onClick:()=>{p.name=$('#renameProject').value.trim()||p.name;p.status=$('#projectStatus').value;p.progress=Math.min(100,Math.max(0,Number($('#projectProgress').value)||0));p.updatedAt=Date.now();logActivity('Project updated',p.name,'▣');saveState();closeModal();renderProjects();}}
    ]});
  }

  function renderStudio() {
    setHeader('Creator Studio', 'COMPOSE • PREVIEW • SCHEDULE');
    let p = activeProject();
    if (!p) {
      root.innerHTML = `<div class="empty"><strong>No active project</strong>Create a project to open the studio.<br><br><button class="primary-button" id="studioCreate">＋ New project</button></div>`;
      $('#studioCreate').onclick=()=>newProjectModal(); return;
    }
    root.innerHTML = `
      <div class="studio-layout">
        <aside class="studio-panel glass-card">
          <div class="section-title-row"><div><h3>Project</h3><p>Choose your active workspace.</p></div></div>
          <div class="field"><label>Active project</label><select id="studioProjectSelect">${state.projects.map(x=>`<option value="${x.id}" ${x.id===p.id?'selected':''}>${escapeHTML(x.name)}</option>`).join('')}</select></div>
          <div class="field" style="margin-top:12px"><label>Project name</label><input id="studioName" value="${escapeHTML(p.name)}"></div>
          <div class="field" style="margin-top:12px"><label>Headline</label><input id="studioTitle" value="${escapeHTML(p.title||'')}"></div>
          <div class="field" style="margin-top:12px"><label>Caption</label><textarea id="studioCaption">${escapeHTML(p.caption||'')}</textarea></div>
          <div class="field" style="margin-top:12px"><label>Call to action</label><input id="studioCta" value="${escapeHTML(p.cta||'')}"></div>
          <div class="field-row" style="margin-top:12px"><div class="field"><label>Accent</label><input id="studioAccent" type="color" value="${p.accent||'#7c3cff'}"></div><div class="field"><label>Secondary</label><input id="studioAccent2" type="color" value="${p.accent2||'#c56cff'}"></div></div>
          <div class="field" style="margin-top:12px"><label>Featured media</label><select id="studioMedia"><option value="">No media</option>${state.media.map(m=>`<option value="${m.id}" ${m.id===p.mediaId?'selected':''}>${escapeHTML(m.name)}</option>`).join('')}</select></div>
          <div style="display:flex;gap:8px;margin-top:16px"><button class="primary-button" id="saveStudio">Save changes</button><button class="ghost-button" id="studioTemplate">Template</button></div>
        </aside>

        <section class="phone-stage glass-card">
          <div class="phone-frame"><div class="phone-screen">
            <div class="phone-status"><span>9:41</span><span>● ◔ ▰</span></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><b style="font-size:13px">Good ${partOfDay()}, ${escapeHTML(state.settings.creatorName||'Creator')} 👋</b><div style="font-size:9px;color:#787184">Ready to make something great?</div></div><div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#ddd7f0,#8b78b6)"></div></div>
            <div style="height:34px;border:1px solid #dedbe6;border-radius:13px;display:flex;align-items:center;padding:0 10px;font-size:9px;color:#81788c;margin-bottom:10px">⌕ &nbsp; Search ideas, templates, projects…</div>
            <div class="preview-hero" id="studioHero" style="background:linear-gradient(135deg,${p.accent},${p.accent2})"><small>🔥 Featured project</small><h3 id="previewTitle">${escapeHTML(p.title||p.name)}</h3><p id="previewCaption">${escapeHTML(p.caption||'')}</p><b id="previewCta" style="font-size:10px">${escapeHTML(p.cta||'Learn more')} →</b></div>
            <div class="preview-media" id="studioMediaPreview"><span style="font-size:10px;color:#756e80">Featured media preview</span></div>
            <div class="preview-actions"><div class="preview-action"><span>◉</span>Capture</div><div class="preview-action"><span>≋</span>Edit</div><div class="preview-action"><span>▦</span>Templates</div><div class="preview-action"><span>✧</span>Ideas</div></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin:2px 0 6px;font-size:11px"><b>My Projects</b><span style="color:${p.accent}">View all</span></div>
            <div class="preview-list">${state.projects.slice(0,3).map(x=>`<div class="preview-row"><i style="background:linear-gradient(135deg,${x.accent},${x.accent2})"></i><div><b>${escapeHTML(x.name)}</b><small>${escapeHTML(x.status)} • ${x.progress}%</small></div></div>`).join('')}</div>
            <div class="phone-bottom"><div class="active"><span>⌂</span>Home</div><div><span>▣</span>Projects</div><div class="active"><span>＋</span>Create</div><div><span>▥</span>Analytics</div><div><span>◉</span>Profile</div></div>
          </div></div>
        </section>

        <aside class="studio-panel glass-card">
          <h3>Publish center</h3>
          <div class="notice">This build schedules content locally. Real posting to YouTube, TikTok, Instagram, etc. needs each platform’s API, authentication, and permissions.</div>
          <div style="display:grid;gap:9px;margin-top:14px"><button class="primary-button" id="scheduleProject">↝ Schedule project</button><button class="secondary-button" id="exportPreview">⇩ Export preview PNG</button><button class="secondary-button" id="exportProject">{} Export project JSON</button></div>
          <div class="section-title-row" style="margin-top:22px"><div><h3>Notes</h3><p>Keep handoff notes with the project.</p></div></div>
          <div class="field"><textarea id="studioNotes" placeholder="Direction, shots, copy, checklist…">${escapeHTML(p.notes||'')}</textarea></div>
          <button class="ghost-button" id="saveNotes" style="margin-top:9px">Save notes</button>
          <div class="section-title-row" style="margin-top:22px"><div><h3>Progress</h3></div><b>${p.progress}%</b></div>
          <input type="range" id="studioProgress" min="0" max="100" value="${p.progress}">
        </aside>
      </div>`;

    $('#studioProjectSelect').onchange=e=>{state.activeProjectId=e.target.value;saveState();renderStudio()};
    const live = () => {
      $('#previewTitle').textContent = $('#studioTitle').value || $('#studioName').value;
      $('#previewCaption').textContent = $('#studioCaption').value;
      $('#previewCta').textContent = `${$('#studioCta').value || 'Learn more'} →`;
      $('#studioHero').style.background = `linear-gradient(135deg,${$('#studioAccent').value},${$('#studioAccent2').value})`;
    };
    ['studioName','studioTitle','studioCaption','studioCta','studioAccent','studioAccent2'].forEach(id=>$('#'+id).addEventListener('input',live));
    $('#studioMedia').onchange=()=>loadStudioMedia($('#studioMedia').value);
    $('#saveStudio').onclick=()=>{saveStudioFields();showToast('Project saved.')};
    $('#saveNotes').onclick=()=>{p.notes=$('#studioNotes').value;p.updatedAt=Date.now();logActivity('Notes updated',p.name,'✎');saveState();showToast('Notes saved.')};
    $('#studioProgress').onchange=e=>{p.progress=Number(e.target.value);p.updatedAt=Date.now();saveState();showToast(`Progress set to ${p.progress}%`)};
    $('#scheduleProject').onclick=()=>{saveStudioFields();scheduleProjectModal(p.id)};
    $('#exportProject').onclick=()=>{saveStudioFields();downloadJSON(p, `${slug(p.name)}.project.json`)};
    $('#exportPreview').onclick=()=>{saveStudioFields();exportPreviewPNG(p)};
    $('#studioTemplate').onclick=()=>routeTo('templates');
    loadStudioMedia(p.mediaId);
  }

  function saveStudioFields() {
    const p = activeProject(); if(!p)return;
    p.name = $('#studioName')?.value.trim() || p.name;
    p.title = $('#studioTitle')?.value.trim() || p.name;
    p.caption = $('#studioCaption')?.value || '';
    p.cta = $('#studioCta')?.value || '';
    p.accent = $('#studioAccent')?.value || p.accent;
    p.accent2 = $('#studioAccent2')?.value || p.accent2;
    p.mediaId = $('#studioMedia')?.value || null;
    p.updatedAt=Date.now(); logActivity('Project saved',p.name,'✎'); saveState();
  }

  async function loadStudioMedia(mediaId) {
    const el = $('#studioMediaPreview'); if(!el) return;
    if(!mediaId){el.innerHTML='<span style="font-size:10px;color:#756e80">Featured media preview</span>';return;}
    const m = state.media.find(x=>x.id===mediaId); if(!m)return;
    const url = await mediaURL(mediaId); if(!url)return;
    if(m.type.startsWith('image/')) el.innerHTML=`<img src="${url}" alt="${escapeHTML(m.name)}">`;
    else if(m.type.startsWith('video/')) el.innerHTML=`<video src="${url}" muted loop autoplay playsinline></video>`;
    else if(m.type.startsWith('audio/')) el.innerHTML=`<audio src="${url}" controls style="width:90%"></audio>`;
    else el.textContent=m.name;
  }

  function scheduleProjectModal(projectId) {
    const p=state.projects.find(x=>x.id===projectId); if(!p)return;
    const local = new Date(Date.now()+3600000);
    const val = new Date(local.getTime()-local.getTimezoneOffset()*60000).toISOString().slice(0,16);
    openModal({title:`Schedule ${p.name}`,eyebrow:'LOCAL PUBLISH QUEUE',body:`
      <div class="notice">This creates a local schedule entry and project status. It does not post to external social networks.</div>
      <div class="field-row" style="margin-top:14px"><div class="field"><label>Channel label</label><select id="scheduleChannel"><option>Local schedule</option><option>YouTube plan</option><option>TikTok plan</option><option>Instagram plan</option><option>Podcast plan</option></select></div><div class="field"><label>Date & time</label><input id="scheduleDate" type="datetime-local" value="${val}"></div></div>`,actions:[
      {label:'Cancel',className:'ghost-button',onClick:closeModal},
      {label:'Add to schedule',onClick:()=>{const dt=$('#scheduleDate').value;if(!dt)return showToast('Choose a date and time.');const s={id:uid('s'),projectId:p.id,channel:$('#scheduleChannel').value,datetime:new Date(dt).toISOString(),createdAt:Date.now()};state.schedules.push(s);p.status='scheduled';p.progress=Math.max(p.progress,90);p.updatedAt=Date.now();logActivity('Post scheduled',`${p.name} • ${fmtDateTime(s.datetime)}`,'↝');saveState();closeModal();showToast('Added to local schedule.');renderStudio();}}
    ]});
  }

  function scheduleManagerModal(scheduleId) {
    const s=state.schedules.find(x=>x.id===scheduleId); if(!s)return; const p=state.projects.find(x=>x.id===s.projectId);
    openModal({title:p?.name||'Scheduled project',eyebrow:'SCHEDULE',body:`<div class="glass-card card-pad"><div class="eyebrow">${escapeHTML(s.channel)}</div><h3>${fmtDateTime(s.datetime)}</h3><p class="muted">Stored locally in this browser.</p></div>`,actions:[
      {label:'Remove schedule',className:'danger-button',onClick:()=>{state.schedules=state.schedules.filter(x=>x.id!==s.id);if(p&&p.status==='scheduled')p.status='draft';saveState();closeModal();showToast('Schedule removed.');renderDashboard();}},
      {label:'Close',className:'ghost-button',onClick:closeModal}
    ]});
  }

  async function exportPreviewPNG(p) {
    try {
      const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;const ctx=canvas.getContext('2d');
      const grd=ctx.createLinearGradient(0,0,1080,1920);grd.addColorStop(0,p.accent||'#7c3cff');grd.addColorStop(1,p.accent2||'#c56cff');ctx.fillStyle=grd;ctx.fillRect(0,0,1080,1920);
      ctx.fillStyle='rgba(255,255,255,.08)';ctx.beginPath();ctx.arc(870,320,300,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(140,1640,260,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='700 46px system-ui';ctx.fillText('CREATOR CENTER',72,110);ctx.font='900 88px system-ui';wrapCanvasText(ctx,p.title||p.name,72,300,920,104);ctx.font='400 40px system-ui';ctx.fillStyle='rgba(255,255,255,.86)';wrapCanvasText(ctx,p.caption||'',72,760,860,58);
      if(p.mediaId){const m=state.media.find(x=>x.id===p.mediaId);if(m?.type.startsWith('image/')){const blob=await getBlob(p.mediaId);if(blob){const img=await blobToImage(blob);ctx.save();roundedRect(ctx,72,1050,936,500,42);ctx.clip();const scale=Math.max(936/img.width,500/img.height);const w=img.width*scale,h=img.height*scale;ctx.drawImage(img,72+(936-w)/2,1050+(500-h)/2,w,h);ctx.restore();}}}
      ctx.fillStyle='#fff';ctx.font='800 38px system-ui';ctx.fillText(`${p.cta||'Learn more'}  →`,72,1750);
      canvas.toBlob(blob=>{if(blob)downloadBlob(blob,`${slug(p.name)}-preview.png`)},'image/png');showToast('Preview exported.');
    } catch(e){console.error(e);showToast('Could not export preview.');}
  }

  function wrapCanvasText(ctx,text,x,y,maxWidth,lineHeight){const words=String(text).split(' ');let line='',yy=y;for(const word of words){const test=line+word+' ';if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,yy);line=word+' ';yy+=lineHeight}else line=test}if(line)ctx.fillText(line,x,yy)}
  function roundedRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
  function blobToImage(blob){return new Promise((res,rej)=>{const img=new Image();const u=URL.createObjectURL(blob);img.onload=()=>{URL.revokeObjectURL(u);res(img)};img.onerror=rej;img.src=u})}

  function renderMedia() {
    setHeader('Media Library', 'CAPTURE • ORGANIZE • REUSE');
    const q=currentMediaSearch.toLowerCase(); const items=state.media.filter(m=>m.name.toLowerCase().includes(q));
    root.innerHTML=`
      <div class="section-title-row"><div><h2>Media Library</h2><p>Images, video, and audio are stored locally in IndexedDB.</p></div><button class="primary-button" id="uploadMediaButton">＋ Add media</button></div>
      <div class="asset-drop" id="dropZone"><input id="mediaInput" type="file" accept="image/*,video/*,audio/*" multiple><strong>Drop media here</strong><p>or click to choose image, video, or audio files</p><button class="secondary-button" type="button">Choose files</button></div>
      <div class="toolbar" style="margin-top:18px"><div class="search-box"><input id="mediaSearch" value="${escapeHTML(currentMediaSearch)}" placeholder="Search media…"></div><span class="muted small">${items.length} asset${items.length===1?'':'s'} • ${bytes(items.reduce((a,b)=>a+(b.size||0),0))}</span></div>
      <div class="media-grid" id="mediaGrid">${items.map(mediaCardHTML).join('')||'<div class="empty"><strong>No media yet</strong>Upload files to build your local creator library.</div>'}</div>`;
    const input=$('#mediaInput'),drop=$('#dropZone');
    $('#uploadMediaButton').onclick=()=>input.click(); drop.querySelector('button').onclick=()=>input.click(); input.onchange=()=>handleMediaFiles(input.files);
    ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('dragover')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('dragover')}));drop.addEventListener('drop',e=>handleMediaFiles(e.dataTransfer.files));
    $('#mediaSearch').oninput=e=>{currentMediaSearch=e.target.value;renderMedia()};
    hydrateMediaCards();
    $$('.media-delete',root).forEach(b=>b.onclick=e=>{e.stopPropagation();deleteMediaItem(b.dataset.id)});
    $$('.media-use',root).forEach(b=>b.onclick=()=>{const p=activeProject();if(!p)return newProjectModal();p.mediaId=b.dataset.id;p.updatedAt=Date.now();saveState();showToast('Media attached to active project.');routeTo('studio')});
    $$('.media-download',root).forEach(b=>b.onclick=()=>downloadMedia(b.dataset.id));
  }

  function mediaCardHTML(m){const icon=m.type.startsWith('video/')?'▶':m.type.startsWith('audio/')?'◉':'▧';return `<article class="media-card" data-id="${m.id}"><div class="media-preview" data-media-preview="${m.id}"><span class="media-type-icon">${icon}</span></div><div class="media-actions"><button class="icon-button media-use" data-id="${m.id}" title="Use in project">＋</button><button class="icon-button media-download" data-id="${m.id}" title="Download">⇩</button><button class="icon-button media-delete" data-id="${m.id}" title="Delete">×</button></div><div class="media-info"><b>${escapeHTML(m.name)}</b><small>${bytes(m.size)} • ${fmtDate(m.createdAt)}</small></div></article>`}

  async function handleMediaFiles(fileList){const files=[...fileList].filter(f=>/^(image|video|audio)\//.test(f.type));if(!files.length)return showToast('Choose image, video, or audio files.');for(const file of files){const id=uid('m');await putBlob(id,file);state.media.unshift({id,name:file.name,type:file.type||'application/octet-stream',size:file.size,createdAt:Date.now()});logActivity('Media added',file.name,'◫')}saveState();showToast(`${files.length} media file${files.length===1?'':'s'} added.`);renderMedia()}
  async function hydrateMediaCards(){for(const m of state.media){const el=$(`[data-media-preview="${CSS.escape(m.id)}"]`,root);if(!el)continue;const url=await mediaURL(m.id);if(!url)continue;if(m.type.startsWith('image/'))el.innerHTML=`<img src="${url}" alt="${escapeHTML(m.name)}">`;else if(m.type.startsWith('video/'))el.innerHTML=`<video src="${url}" muted playsinline preload="metadata"></video>`;else if(m.type.startsWith('audio/'))el.innerHTML=`<audio src="${url}" controls preload="metadata"></audio>`}}
  async function deleteMediaItem(id){const m=state.media.find(x=>x.id===id);if(!m)return;if(!confirm(`Delete “${m.name}” from local media?`))return;await deleteBlob(id);state.media=state.media.filter(x=>x.id!==id);state.projects.forEach(p=>{if(p.mediaId===id)p.mediaId=null});const u=mediaUrls.get(id);if(u){URL.revokeObjectURL(u);mediaUrls.delete(id)}logActivity('Media deleted',m.name,'×');saveState();renderMedia()}
  async function downloadMedia(id){const m=state.media.find(x=>x.id===id);const b=await getBlob(id);if(m&&b)downloadBlob(b,m.name)}

  function renderTemplates(){setHeader('Templates','START FAST • MAKE IT YOURS');root.innerHTML=`<div class="section-title-row"><div><h2>Creator templates</h2><p>Reusable structures inspired by the supplied mobile creator concept.</p></div></div><div class="template-grid">${templates.map(t=>`<article class="template-card glass-card"><div class="template-art" style="background:linear-gradient(145deg,${t.colors[0]},${t.colors[1]})"><div class="eyebrow" style="color:#fff;opacity:.8">${escapeHTML(t.category)}</div><div class="mock-title">${escapeHTML(t.title)}</div><div class="mock-pill">${escapeHTML(t.cta)}</div><div class="mock-shape"></div></div><div class="template-meta"><h3>${escapeHTML(t.name)}</h3><p>${escapeHTML(t.caption)}</p><div class="template-actions"><button class="primary-button use-template" data-id="${t.id}">Use template</button><button class="ghost-button preview-template" data-id="${t.id}">Preview</button></div></div></article>`).join('')}</div>`;$$('.use-template',root).forEach(b=>b.onclick=()=>applyTemplate(b.dataset.id));$$('.preview-template',root).forEach(b=>b.onclick=()=>templatePreviewModal(b.dataset.id))}
  function applyTemplate(id){const t=templates.find(x=>x.id===id);if(!t)return;let p=activeProject();if(!p){p={id:uid('p'),name:t.name,status:'draft',progress:15,updatedAt:Date.now(),createdAt:Date.now(),mediaId:null,notes:''};state.projects.unshift(p);state.activeProjectId=p.id}Object.assign(p,{title:t.title,caption:t.caption,cta:t.cta,accent:t.colors[0],accent2:t.colors[1],updatedAt:Date.now()});logActivity('Template applied',`${t.name} → ${p.name}`,'▦');saveState();showToast('Template applied.');routeTo('studio')}
  function templatePreviewModal(id){const t=templates.find(x=>x.id===id);if(!t)return;openModal({title:t.name,eyebrow:t.category,body:`<div class="template-art" style="height:300px;background:linear-gradient(145deg,${t.colors[0]},${t.colors[1]})"><div class="mock-title" style="font-size:36px">${escapeHTML(t.title)}</div><div class="mock-pill">${escapeHTML(t.cta)}</div><div class="mock-shape" style="width:220px;height:220px"></div></div><p class="muted">${escapeHTML(t.caption)}</p>`,actions:[{label:'Close',className:'ghost-button',onClick:closeModal},{label:'Use template',onClick:()=>{closeModal();applyTemplate(id)}}]})}

  function renderIdeas(){setHeader('Idea Lab','OFFLINE BRAINSTORMING');root.innerHTML=`
    <div class="grid-2">
      <section class="glass-card card-pad"><div class="eyebrow">IDEA ENGINE</div><h2 style="font-size:34px;margin:8px 0">Generate your next creator angle.</h2><p class="muted">This generator runs locally using structured creative prompts — no external AI call is required.</p><div class="field" style="margin-top:18px"><label>Topic or niche</label><input id="ideaTopic" placeholder="e.g. home studio setup, fitness coaching, indie game dev"></div><div class="field-row" style="margin-top:12px"><div class="field"><label>Format</label><select id="ideaFormat"><option>Short video</option><option>Long video</option><option>Carousel</option><option>Podcast</option><option>Newsletter</option></select></div><div class="field"><label>Audience</label><select id="ideaAudience"><option>Beginners</option><option>Fans</option><option>Customers</option><option>Creators</option><option>Professionals</option></select></div></div><button class="primary-button" id="generateIdeas" style="margin-top:15px">✧ Generate 6 ideas</button></section>
      <section class="glass-card card-pad"><div class="eyebrow">PROMPT FORMULA</div><h3>Hook → Value → Proof → Action</h3><p class="muted">Strong ideas usually become easier to execute when the outcome, audience, and proof are explicit.</p><div class="quick-grid" style="grid-template-columns:1fr 1fr;margin-top:16px">${quickCard('⚡','Hook','Earn attention immediately.','ideas')}${quickCard('◎','Value','Promise a useful result.','ideas')}${quickCard('✓','Proof','Show, demonstrate, compare.','ideas')}${quickCard('→','Action','Give one next step.','ideas')}</div></section>
    </div>
    <div class="idea-results" id="ideaResults">${state.ideas.length?state.ideas.slice(0,8).map(ideaCardHTML).join(''):'<div class="empty" style="grid-column:1/-1"><strong>Your idea board is empty</strong>Enter a topic and generate a batch.</div>'}</div>`;
    $('#generateIdeas').onclick=generateIdeas; wireIdeaSaveButtons();
  }
  function generateIdeas(){const topic=$('#ideaTopic').value.trim()||'your topic';const format=$('#ideaFormat').value;const audience=$('#ideaAudience').value;const hooks=[`3 mistakes people make with ${topic}`,`I tried ${topic} the fast way — here’s what happened`,`The beginner’s shortcut to ${topic}`,`What nobody tells you before starting ${topic}`,`A before-and-after breakdown of ${topic}`,`If I had 30 minutes to improve ${topic}, I’d do this`];const outcomes=['save time','avoid common mistakes','get a cleaner result','build a repeatable workflow','make the process easier to understand','turn one idea into multiple pieces of content'];const batch=hooks.map((h,i)=>({id:uid('idea'),topic,format,audience,title:h,hook:`Open with a visible promise for ${audience.toLowerCase()}.`,outline:`Show the problem, give ${i%3+2} practical steps, add one proof point, and explain how to ${outcomes[i]}.`,cta:['Save this','Try it today','Share with a creator','Comment your version','Follow for part two','Use this as a checklist'][i],createdAt:Date.now()}));state.ideas=[...batch,...state.ideas].slice(0,40);logActivity('Ideas generated',topic,'✧');saveState();renderIdeas();showToast('6 ideas generated.')}
  function ideaCardHTML(x,i=0){return `<article class="idea-card"><div class="idea-number">${String(i+1).padStart(2,'0')}</div><h3>${escapeHTML(x.title)}</h3><p><b style="color:#d9cdfb">Hook:</b> ${escapeHTML(x.hook)}<br><br><b style="color:#d9cdfb">Outline:</b> ${escapeHTML(x.outline)}</p><footer><span class="muted small">${escapeHTML(x.format)} • ${escapeHTML(x.audience)}</span><button class="secondary-button save-idea" data-id="${x.id}">Make project</button></footer></article>`}
  function wireIdeaSaveButtons(){$$('.save-idea',root).forEach(b=>b.onclick=()=>{const x=state.ideas.find(i=>i.id===b.dataset.id);if(!x)return;const p={id:uid('p'),name:x.title.slice(0,60),status:'draft',progress:10,updatedAt:Date.now(),createdAt:Date.now(),title:x.title,caption:x.outline,cta:x.cta,accent:(ACCENTS[state.settings.accentName]||ACCENTS.violet)[0],accent2:(ACCENTS[state.settings.accentName]||ACCENTS.violet)[1],mediaId:null,notes:`Audience: ${x.audience}\nFormat: ${x.format}\nHook: ${x.hook}`};state.projects.unshift(p);state.activeProjectId=p.id;logActivity('Idea turned into project',p.name,'＋');saveState();showToast('Project created from idea.');routeTo('studio')})}

  function renderWireframes(){setHeader('Wireframe Station','NAVIGATION • COMPONENTS • DEVICE LAYOUT');const wf=state.wireframe;root.innerHTML=`
    <div class="wireframe-layout">
      <aside class="studio-panel glass-card"><h3>Components</h3><div class="component-palette">${[['hero','Hero / Banner'],['text','Text block'],['image','Media placeholder'],['card','Content card'],['button','Action button']].map(([t,n])=>`<button class="palette-button add-wire" data-type="${t}"><b>${n}</b><span>Add to phone layout</span></button>`).join('')}</div><div class="section-title-row" style="margin-top:20px"><div><h3>Layout</h3></div></div><div class="chip-row"><button class="chip wire-layout ${wf.layout==='list'?'active':''}" data-layout="list">List view</button><button class="chip wire-layout ${wf.layout==='grid'?'active':''}" data-layout="grid">Grid view</button></div></aside>
      <section class="wireframe-stage glass-card"><div class="wire-phone"><div class="wire-canvas ${wf.layout==='grid'?'grid':''}" id="wireCanvas">${wf.elements.map(wireElementHTML).join('')}</div></div></section>
      <aside class="studio-panel glass-card"><h3>Inspector</h3><div id="wireInspector">${wireInspectorHTML()}</div><div style="display:grid;gap:8px;margin-top:14px"><button class="secondary-button" id="moveWireUp">↑ Move up</button><button class="secondary-button" id="moveWireDown">↓ Move down</button><button class="danger-button" id="deleteWire">Delete selected</button><button class="primary-button" id="saveWire">Save wireframe</button></div></aside>
    </div>`;
    $$('.add-wire',root).forEach(b=>b.onclick=()=>{const el={id:uid('w'),type:b.dataset.type,label:defaultWireLabel(b.dataset.type)};wf.elements.push(el);wf.selectedId=el.id;saveState();renderWireframes()});
    $$('.wire-layout',root).forEach(b=>b.onclick=()=>{wf.layout=b.dataset.layout;saveState();renderWireframes()});
    $$('.wire-el',root).forEach(el=>el.onclick=()=>{wf.selectedId=el.dataset.id;saveState();renderWireframes()});
    const label=$('#wireLabel');if(label)label.oninput=e=>{const el=wf.elements.find(x=>x.id===wf.selectedId);if(el){el.label=e.target.value;saveState();const target=$(`.wire-el[data-id="${CSS.escape(el.id)}"] b`,root);if(target)target.textContent=el.label}};
    $('#moveWireUp').onclick=()=>moveWire(-1);$('#moveWireDown').onclick=()=>moveWire(1);$('#deleteWire').onclick=deleteSelectedWire;$('#saveWire').onclick=()=>{logActivity('Wireframe saved',`${wf.elements.length} components • ${wf.layout} view`,'⌘');saveState();showToast('Wireframe saved locally.')};
  }
  function wireElementHTML(el){return `<div class="wire-el ${el.type} ${state.wireframe.selectedId===el.id?'selected':''}" data-id="${el.id}"><span class="wire-tag">${escapeHTML(el.type)}</span><b>${escapeHTML(el.label)}</b></div>`}
  function wireInspectorHTML(){const el=state.wireframe.elements.find(x=>x.id===state.wireframe.selectedId);if(!el)return '<div class="empty"><strong>Select a component</strong>Choose an element on the phone.</div>';return `<div class="field"><label>Component type</label><input value="${escapeHTML(el.type)}" disabled></div><div class="field" style="margin-top:12px"><label>Label / content</label><input id="wireLabel" value="${escapeHTML(el.label)}"></div>`}
  function defaultWireLabel(t){return {hero:'Creator headline',text:'Supporting text',image:'Media placeholder',card:'Project card',button:'Primary action'}[t]||'Component'}
  function moveWire(delta){const wf=state.wireframe;const i=wf.elements.findIndex(x=>x.id===wf.selectedId);const j=i+delta;if(i<0||j<0||j>=wf.elements.length)return;[wf.elements[i],wf.elements[j]]=[wf.elements[j],wf.elements[i]];saveState();renderWireframes()}
  function deleteSelectedWire(){const wf=state.wireframe;if(!wf.selectedId)return;wf.elements=wf.elements.filter(x=>x.id!==wf.selectedId);wf.selectedId=wf.elements[0]?.id||null;saveState();renderWireframes()}

  function renderPrototype(){setHeader('Prototype Dynamics','ANIMATION • TIMING • HAPTICS');const pr=state.prototype;root.innerHTML=`
    <div class="proto-layout">
      <aside class="glass-card card-pad"><div class="eyebrow">MOTION LAB</div><h2>Prototype a screen transition.</h2><p class="muted">Test overlay, push, fade, and spring behaviors on a creator-style phone mockup.</p><div class="field" style="margin-top:18px"><label>Transition</label><select id="protoTransition"><option value="slide" ${pr.transition==='slide'?'selected':''}>Slide overlay</option><option value="push" ${pr.transition==='push'?'selected':''}>Push content</option><option value="fade" ${pr.transition==='fade'?'selected':''}>Fade</option><option value="spring" ${pr.transition==='spring'?'selected':''}>Spring</option></select></div><div class="field" style="margin-top:14px"><label>Duration: <span id="durationLabel">${pr.duration}</span>ms</label><input type="range" id="protoDuration" min="150" max="1200" step="25" value="${pr.duration}"></div><div class="settings-row"><div><h3>Haptic cue</h3><p>Uses vibration where supported.</p></div><input type="checkbox" id="protoHaptic" ${pr.haptics?'checked':''}></div><button class="primary-button" id="runPrototype" style="width:100%;margin-top:14px">▶ Run transition</button><button class="secondary-button" id="resetPrototype" style="width:100%;margin-top:8px">Reset</button></aside>
      <section class="proto-stage glass-card"><div class="proto-phone" id="protoPhone"><div class="proto-screen first"><div class="proto-block"></div><div class="proto-row"></div><div class="proto-row"></div><div class="proto-row"></div><div class="proto-fab">＋</div></div><div class="proto-screen second"><div style="font-size:24px;font-weight:900;margin:8px 0 14px">Project details</div><div class="proto-block" style="height:150px;background:linear-gradient(135deg,var(--accent),var(--accent2))"></div><div class="proto-row"></div><div class="proto-row"></div><button class="primary-button" style="width:100%;margin-top:10px">Continue</button></div></div></section>
    </div>`;
    $('#protoTransition').onchange=e=>{pr.transition=e.target.value;saveState()};$('#protoDuration').oninput=e=>{$('#durationLabel').textContent=e.target.value;pr.duration=Number(e.target.value);saveState()};$('#protoHaptic').onchange=e=>{pr.haptics=e.target.checked;saveState()};$('#runPrototype').onclick=runPrototype;$('#resetPrototype').onclick=()=>resetPrototype();
  }
  function resetPrototype(){const phone=$('#protoPhone');if(!phone)return;phone.className='proto-phone';$$('.proto-screen',phone).forEach(s=>s.style.transitionDuration=`${state.prototype.duration}ms`)}
  function runPrototype(){const phone=$('#protoPhone');if(!phone)return;resetPrototype();requestAnimationFrame(()=>requestAnimationFrame(()=>phone.classList.add(`preview-${state.prototype.transition}`)));if(state.prototype.haptics&&navigator.vibrate)navigator.vibrate(20);logActivity('Prototype previewed',`${state.prototype.transition} • ${state.prototype.duration}ms`,'↝');saveState()}

  function renderVoice(){setHeader('Voice Lab','RECORD • ANALYZE • PLAYBACK');root.innerHTML=`
    <div class="voice-layout">
      <section class="wave-card glass-card"><div class="eyebrow">SOURCE AUDIO</div><h2>Record or load a vocal sample.</h2><canvas id="waveCanvas" width="900" height="260"></canvas><div class="transport" style="margin-top:14px"><button class="record-button" id="recordVoice" title="Record"></button><div><b id="recordStatus">Ready to record</b><div class="muted small">Microphone requires localhost/HTTPS permission.</div></div><input type="file" id="voiceFile" accept="audio/*" hidden><button class="secondary-button" id="voiceUpload">Upload audio</button></div><audio id="voicePlayer" controls style="width:100%;margin-top:15px"></audio></section>
      <aside class="audio-panel glass-card"><div class="eyebrow">VOCAL ENGINE TUNER</div><h2>Playback shaping</h2><div class="notice">These controls shape playback in your browser only. For a real AI copy of a voice, use the consent-first Voice Clone panel below — it needs the owner's recorded permission and your approval.</div><div class="voice-controls" style="margin-top:18px"><div class="range-row"><label>Character</label><input type="range" id="voiceRate" min="0.65" max="1.45" step="0.01" value="1"><output id="voiceRateOut">1.00×</output></div><div class="range-row"><label>Volume</label><input type="range" id="voiceVolume" min="0" max="1" step="0.01" value="1"><output id="voiceVolumeOut">100%</output></div><div class="range-row"><label>Warmth (display only)</label><input type="range" id="voiceWarmth" min="0" max="100" value="50"><output id="voiceWarmthOut">50</output></div></div><div style="display:grid;gap:8px;margin-top:18px"><button class="primary-button" id="saveVoiceMedia">Save sample to Media Library</button><button class="secondary-button" id="downloadVoice">Download sample</button></div></aside>
    </div>`;
    if(window.VoiceClone)window.VoiceClone.mount(root,{showToast,putBlob,getBlob,state,saveState,logActivity,uid,escapeHTML,downloadBlob,bytes,getCurrentSample:()=>voiceBlob});
    drawIdleWave();$('#recordVoice').onclick=toggleRecording;$('#voiceUpload').onclick=()=>$('#voiceFile').click();$('#voiceFile').onchange=e=>{const f=e.target.files[0];if(f)loadVoiceBlob(f)};$('#voiceRate').oninput=e=>{const v=Number(e.target.value);$('#voicePlayer').playbackRate=v;$('#voiceRateOut').textContent=`${v.toFixed(2)}×`};$('#voiceVolume').oninput=e=>{const v=Number(e.target.value);$('#voicePlayer').volume=v;$('#voiceVolumeOut').textContent=`${Math.round(v*100)}%`};$('#voiceWarmth').oninput=e=>$('#voiceWarmthOut').textContent=e.target.value;$('#saveVoiceMedia').onclick=saveVoiceToLibrary;$('#downloadVoice').onclick=()=>{if(!voiceBlob)return showToast('Record or load audio first.');downloadBlob(voiceBlob,`creator-voice-${Date.now()}.${voiceBlob.type.includes('ogg')?'ogg':'webm'}`)};
  }
  function drawIdleWave(){const c=$('#waveCanvas');if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle='rgba(124,60,255,.25)';ctx.lineWidth=2;for(let y=30;y<c.height;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(c.width,y);ctx.stroke()}ctx.strokeStyle='#4de6ff';ctx.lineWidth=3;ctx.beginPath();for(let x=0;x<c.width;x++){const y=c.height/2+Math.sin(x*.035)*18*Math.sin(x*.006);x?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke()}
  async function toggleRecording(){if(mediaRecorder&&mediaRecorder.state==='recording'){mediaRecorder.stop();return}if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return showToast('Audio recording is not supported in this browser.');try{recordingStream=await navigator.mediaDevices.getUserMedia({audio:true});recordingChunks=[];mediaRecorder=new MediaRecorder(recordingStream);mediaRecorder.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data)};mediaRecorder.onstop=()=>{voiceBlob=new Blob(recordingChunks,{type:mediaRecorder.mimeType||'audio/webm'});recordingStream.getTracks().forEach(t=>t.stop());recordingStream=null;loadVoiceBlob(voiceBlob);$('#recordVoice').classList.remove('recording');$('#recordStatus').textContent='Recording ready';logActivity('Voice sample recorded',bytes(voiceBlob.size),'◉');saveState()};mediaRecorder.start();$('#recordVoice').classList.add('recording');$('#recordStatus').textContent='Recording… click again to stop';}catch(e){console.error(e);showToast('Microphone permission was not granted.')}}
  async function loadVoiceBlob(blob){voiceBlob=blob;if(voiceBlobUrl)URL.revokeObjectURL(voiceBlobUrl);voiceBlobUrl=URL.createObjectURL(blob);const player=$('#voicePlayer');if(player)player.src=voiceBlobUrl;try{const ab=await blob.arrayBuffer();const ac=new (window.AudioContext||window.webkitAudioContext)();voiceAudioBuffer=await ac.decodeAudioData(ab.slice(0));drawAudioBuffer(voiceAudioBuffer);ac.close()}catch(e){console.warn(e);drawIdleWave()}}
  function drawAudioBuffer(buffer){const c=$('#waveCanvas');if(!c)return;const ctx=c.getContext('2d'),data=buffer.getChannelData(0);ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#0c081a';ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle='#4de6ff';ctx.lineWidth=2;ctx.beginPath();const step=Math.ceil(data.length/c.width);for(let x=0;x<c.width;x++){let min=1,max=-1;for(let j=0;j<step;j++){const d=data[x*step+j];if(d===undefined)break;if(d<min)min=d;if(d>max)max=d}const y1=(1+min)*.5*c.height,y2=(1+max)*.5*c.height;ctx.moveTo(x,y1);ctx.lineTo(x,y2)}ctx.stroke()}
  async function saveVoiceToLibrary(){if(!voiceBlob)return showToast('Record or load audio first.');const id=uid('m');await putBlob(id,voiceBlob);state.media.unshift({id,name:`Voice Sample ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.webm`,type:voiceBlob.type||'audio/webm',size:voiceBlob.size,createdAt:Date.now()});logActivity('Voice sample saved','Added to Media Library','◉');saveState();showToast('Voice sample saved to Media Library.')}

  function renderAnalytics(){setHeader('Analytics','LOCAL WORKSPACE METRICS');const totalSize=state.media.reduce((a,b)=>a+(b.size||0),0);const statuses={draft:0,'in-progress':0,scheduled:0};state.projects.forEach(p=>statuses[p.status]=(statuses[p.status]||0)+1);const max=Math.max(1,...state.projects.map(p=>p.progress));root.innerHTML=`
    <div class="analytics-grid">${statCard('▣',state.projects.length,'Total projects')}${statCard('◫',state.media.length,'Media assets')}${statCard('↝',state.schedules.length,'Schedule entries')}${statCard('◎',bytes(totalSize),'Media stored')}</div>
    <div class="grid-2" style="margin-top:16px"><section class="chart-card glass-card"><div class="section-title-row"><div><h2>Project progress</h2><p>Completion across current projects.</p></div></div><div class="bars">${state.projects.slice(0,8).map(p=>`<div class="bar-item"><i style="height:${Math.max(6,p.progress/max*100)}%"></i><small>${escapeHTML(p.name.slice(0,10))}</small></div>`).join('')||'<div class="empty">No projects</div>'}</div></section><section class="chart-card glass-card"><div class="section-title-row"><div><h2>Project status</h2><p>Drafts, active work, and scheduled content.</p></div></div><div class="donut" style="background:conic-gradient(var(--accent) 0 ${percent(statuses['in-progress'],state.projects.length)}%,var(--cyan) ${percent(statuses['in-progress'],state.projects.length)}% ${percent(statuses['in-progress']+statuses.scheduled,state.projects.length)}%,var(--yellow) ${percent(statuses['in-progress']+statuses.scheduled,state.projects.length)}% 100%)"><div class="donut-label"><div><b>${state.projects.length}</b><small>projects</small></div></div></div><div class="chip-row" style="justify-content:center"><span class="chip">${statuses['in-progress']} active</span><span class="chip">${statuses.scheduled} scheduled</span><span class="chip">${statuses.draft} draft</span></div></section></div>
    <section class="glass-card card-pad" style="margin-top:16px"><div class="section-title-row"><div><h2>Activity</h2><p>Recent local workspace events.</p></div></div><div class="activity-list">${activityHTML(state.activity.slice(0,12))}</div></section>`}
  function percent(n,total){return total?Math.round(n/total*100):0}

  function renderSettings(){setHeader('Settings','WORKSPACE • BACKUP • INSTALL');const pair=ACCENTS[state.settings.accentName]||ACCENTS.violet;root.innerHTML=`<div class="settings-stack">
    <section class="settings-card glass-card"><div class="section-title-row"><div><h2>Creator profile</h2><p>Local display settings.</p></div></div><div class="settings-row"><div><h3>Creator name</h3><p>Used in dashboard and preview UI.</p></div><div class="field" style="min-width:220px"><input id="creatorName" value="${escapeHTML(state.settings.creatorName||'Creator')}"></div></div><div class="settings-row"><div><h3>Accent theme</h3><p>Changes the software center’s visual accent.</p></div><div class="swatches">${Object.entries(ACCENTS).map(([name,c])=>`<button class="swatch ${state.settings.accentName===name?'active':''}" data-accent="${name}" style="--swatch:${c[0]}" title="${name}"></button>`).join('')}</div></div></section>
    <section class="settings-card glass-card"><div class="section-title-row"><div><h2>Backup & transfer</h2><p>Move workspace metadata between browsers.</p></div></div><div class="notice">Workspace JSON includes projects, ideas, schedules, wireframes, and media metadata. Large media blobs are stored separately in IndexedDB and are not embedded in the JSON export.</div><div class="settings-row"><div><h3>Export workspace JSON</h3><p>Download the current local metadata.</p></div><button class="secondary-button" id="exportWorkspace">Export</button></div><div class="settings-row"><div><h3>Import workspace JSON</h3><p>Replace current metadata with a previous export.</p></div><div><input type="file" id="importWorkspaceFile" accept="application/json" hidden><button class="secondary-button" id="importWorkspace">Import</button></div></div></section>
    <section class="settings-card glass-card"><div class="section-title-row"><div><h2>App & storage</h2><p>Install and manage this local-first build.</p></div></div><div class="settings-row"><div><h3>Install as an app</h3><p>Available when your browser offers PWA installation.</p></div><button class="secondary-button" id="settingsInstall" ${installPrompt?'':'disabled'}>${installPrompt?'Install':'Not currently available'}</button></div><div class="settings-row"><div><h3>Reset sample data</h3><p>Restore the initial demo projects. Media blobs are not deleted.</p></div><button class="danger-button" id="resetWorkspace">Reset workspace</button></div><div class="settings-row"><div><h3>Delete all local media</h3><p>Removes IndexedDB media blobs and metadata from this browser.</p></div><button class="danger-button" id="clearMedia">Delete media</button></div></section>
  </div>`;
    $('#creatorName').onchange=e=>{state.settings.creatorName=e.target.value.trim()||'Creator';saveState();showToast('Creator name saved.')};$$('.swatch',root).forEach(b=>b.onclick=()=>{state.settings.accentName=b.dataset.accent;saveState();applyAccent();renderSettings()});$('#exportWorkspace').onclick=()=>downloadJSON(state,'creator-center-workspace.json');$('#importWorkspace').onclick=()=>$('#importWorkspaceFile').click();$('#importWorkspaceFile').onchange=importWorkspace;$('#settingsInstall').onclick=promptInstall;$('#resetWorkspace').onclick=()=>{if(confirm('Reset workspace metadata to the included demo state?')){state=clone(defaultState);saveState();applyAccent();showToast('Workspace reset.');renderSettings()}};$('#clearMedia').onclick=clearAllMedia;
  }

  async function importWorkspace(e){const file=e.target.files[0];if(!file)return;try{const parsed=JSON.parse(await file.text());if(!parsed||!Array.isArray(parsed.projects))throw new Error('Invalid workspace');if(!confirm('Replace current workspace metadata with this import?'))return;state={...clone(defaultState),...parsed,settings:{...clone(defaultState.settings),...(parsed.settings||{})},wireframe:{...clone(defaultState.wireframe),...(parsed.wireframe||{})},prototype:{...clone(defaultState.prototype),...(parsed.prototype||{})}};saveState();applyAccent();showToast('Workspace imported.');renderSettings()}catch(err){console.error(err);showToast('That file is not a valid Creator Center workspace.')}}
  async function clearAllMedia(){if(!confirm('Delete all local media blobs and metadata? This cannot be undone.'))return;const ids=state.media.map(m=>m.id);for(const id of ids)await deleteBlob(id);state.media=[];state.projects.forEach(p=>p.mediaId=null);for(const u of mediaUrls.values())URL.revokeObjectURL(u);mediaUrls.clear();logActivity('Media library cleared','All local media removed','×');saveState();showToast('Local media cleared.');renderSettings()}

  function downloadJSON(obj,name){downloadBlob(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),name)}
  function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
  function slug(v='project'){return v.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'project'}

  async function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DB_STORE))req.result.createObjectStore(DB_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  async function putBlob(id,blob){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(blob,id);tx.oncomplete=()=>{db.close();res()};tx.onerror=()=>{db.close();rej(tx.error)}})}
  async function getBlob(id){try{const db=await openDB();return await new Promise((res,rej)=>{const tx=db.transaction(DB_STORE,'readonly');const req=tx.objectStore(DB_STORE).get(id);req.onsuccess=()=>{db.close();res(req.result||null)};req.onerror=()=>{db.close();rej(req.error)}})}catch(e){console.warn(e);return null}}
  async function deleteBlob(id){try{const db=await openDB();return await new Promise((res,rej)=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).delete(id);tx.oncomplete=()=>{db.close();res()};tx.onerror=()=>{db.close();rej(tx.error)}})}catch(e){console.warn(e)}}
  async function mediaURL(id){if(mediaUrls.has(id))return mediaUrls.get(id);const b=await getBlob(id);if(!b)return null;const u=URL.createObjectURL(b);mediaUrls.set(id,u);return u}

  function updateStorageMeter(){const total=state.media.reduce((a,b)=>a+(b.size||0),0);const text=$('#storageText'),bar=$('#storageBar');if(text)text.textContent=`${bytes(total)} local media`;if(bar)bar.style.width=`${Math.min(100,Math.max(4,total/(250*1024*1024)*100))}%`}

  function registerPWA(){if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW registration failed',e));window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;const b=$('#installButton');if(b)b.hidden=false;if(currentRoute==='settings')renderSettings()});$('#installButton').onclick=promptInstall}
  async function promptInstall(){if(!installPrompt)return showToast('Install is not currently offered by this browser.');installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('#installButton').hidden=true;if(currentRoute==='settings')renderSettings()}

  // Global controls
  $('#newProjectButton').onclick=()=>newProjectModal();
  $('#quickSearchButton').onclick=quickSearchModal;
  $$('#navStack [data-route],#mobileNav [data-route]').forEach(b=>b.onclick=()=>routeTo(b.dataset.route));
  window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();quickSearchModal()}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='n'){e.preventDefault();newProjectModal()}});
  window.addEventListener('hashchange',()=>{const r=location.hash.replace('#/','');if(r)routeTo(r)});

  applyAccent();
  updateStorageMeter();
  registerPWA();
  const initial=location.hash.replace('#/',''); if(initial&&['dashboard','projects','studio','media','templates','ideas','wireframes','prototype','voice','analytics','settings'].includes(initial))currentRoute=initial;
  routeTo(currentRoute);
})();
