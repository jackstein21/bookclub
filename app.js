// ============================================================
// BOOKCLUB — Supabase Edition
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const SUPABASE_URL      = 'https://bgafaiybnrrbpfxewppx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnYWZhaXlibnJyYnBmeGV3cHB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4Nzg5NDYsImV4cCI6MjA5NDQ1NDk0Nn0.ZO62xgyU47oThk4G0LPRq11i6Q-yB7X0OUjRRcJKcw0';
const CLUB_ID           = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// STATE — in-memory cache, loaded from Supabase on login
// ============================================================
const State = {
  account:   null,  // { id, username, club_id }
  books:     [],
  deadlines: [],
  progress:  {},    // { jack: { currentPage, updatedAt, history: [] }, jordan: {...} }
  questions: [],
  notes:     [],    // each note: { id, bookId, author (username), accountId, text, page, createdAt }
  library:   {},    // { [bookId]: { jack: { id, startedAt, finishedAt }, jordan: {...} } }
};

// ============================================================
// DATA LOADING
// ============================================================
async function loadData() {
  if (!State.account) return;

  const [booksRes, deadlinesRes, progressRes, historyRes, questionsRes, notesRes, accountsRes, libraryRes] =
    await Promise.all([
      sb.from('books').select('*').eq('club_id', State.account.club_id).order('created_at'),
      sb.from('deadlines').select('*').order('date'),
      sb.from('progress').select('*'),
      sb.from('progress_history').select('*').order('recorded_at', { ascending: false }),
      sb.from('questions').select('*'),
      sb.from('notes').select('*').order('created_at', { ascending: false }),
      sb.from('accounts').select('id, username').eq('club_id', State.account.club_id),
      sb.from('library').select('*'),
    ]);

  const accountMap = {};
  (accountsRes.data || []).forEach(a => { accountMap[a.id] = a.username; });

  State.books = (booksRes.data || []).map(b => ({
    id: b.id, title: b.title, author: b.author,
    totalPages: b.total_pages, color: b.color || '#2D5A27',
    isActive: b.is_active, createdAt: b.created_at,
    coverUrl: b.cover_url || null,
    description: b.description || null,
    isbn: b.isbn || null,
    publishedYear: b.published_year || null,
  }));

  State.library = {};
  (libraryRes.data || []).forEach(row => {
    const username = accountMap[row.account_id];
    if (!username) return;
    if (!State.library[row.book_id]) State.library[row.book_id] = {};
    State.library[row.book_id][username] = {
      id: row.id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  });

  State.deadlines = (deadlinesRes.data || []).map(d => ({
    id: d.id, bookId: d.book_id, type: d.type, label: d.label,
    chapterNum: d.chapter_num, pageNum: d.page_num, date: d.date,
    isFinal: d.is_final, createdAt: d.created_at,
  }));

  State.progress = {};
  (progressRes.data || []).forEach(p => {
    const username = accountMap[p.account_id];
    if (username) State.progress[username] = { currentPage: p.current_page, updatedAt: p.updated_at, history: [] };
  });
  (historyRes.data || []).forEach(h => {
    const username = accountMap[h.account_id];
    if (username && State.progress[username])
      State.progress[username].history.push({ page: h.page, date: h.recorded_at });
  });

  State.questions = (questionsRes.data || []).map(q => ({
    weekId: q.week_id, bookId: q.book_id,
    jackWroteForJordan: q.jack_wrote_for_jordan,
    jordanWroteForJack: q.jordan_wrote_for_jack,
    answers: q.answers || { jack: {}, jordan: {} },
  }));

  State.notes = (notesRes.data || []).map(n => ({
    id: n.id, bookId: n.book_id,
    author: accountMap[n.account_id] || '?',
    accountId: n.account_id,
    text: n.content, page: n.page, createdAt: n.created_at,
  }));
}

// ============================================================
// DB — reads State (sync), writes Supabase + State (async)
// ============================================================
const DB = {
  getUser:      () => State.account?.username || null,
  getBooks:     () => State.books,
  getActiveBook: () => State.books.find(b => b.isActive) || State.books[0] || null,

  saveBook: async (b) => {
    const { error } = await sb.from('books').upsert({
      id: b.id, club_id: State.account.club_id,
      title: b.title, author: b.author, total_pages: b.totalPages,
      color: b.color, is_active: b.isActive,
      cover_url: b.coverUrl || null,
      description: b.description || null,
      isbn: b.isbn || null,
      published_year: b.publishedYear || null,
    });
    if (error) throw error;
    const i = State.books.findIndex(x => x.id === b.id);
    i >= 0 ? State.books[i] = b : State.books.push(b);
    if (b.isActive) State.books.forEach(x => { if (x.id !== b.id) x.isActive = false; });
  },

  getLibraryEntry: (bookId, username) => State.library[bookId]?.[username] || null,

  saveLibraryEntry: async (bookId, username, { startedAt, finishedAt }) => {
    const existing = State.library[bookId]?.[username];
    const payload = {
      book_id: bookId,
      account_id: State.account.id,
      started_at: startedAt || null,
      finished_at: finishedAt || null,
    };
    let error, rowId;
    if (existing?.id) {
      rowId = existing.id;
      ({ error } = await sb.from('library').update(payload).eq('id', rowId));
    } else {
      rowId = crypto.randomUUID();
      ({ error } = await sb.from('library').insert({ id: rowId, ...payload }));
    }
    if (error) throw error;
    if (!State.library[bookId]) State.library[bookId] = {};
    State.library[bookId][username] = { id: rowId, startedAt, finishedAt };
  },

  setActiveBook: async (id) => {
    await sb.from('books').update({ is_active: false }).eq('club_id', State.account.club_id);
    await sb.from('books').update({ is_active: true }).eq('id', id);
    State.books.forEach(b => { b.isActive = b.id === id; });
  },

  deleteBook: async (id) => {
    const { error } = await sb.from('books').delete().eq('id', id);
    if (error) throw error;
    State.books     = State.books.filter(b => b.id !== id);
    State.deadlines = State.deadlines.filter(d => d.bookId !== id);
    State.questions = State.questions.filter(q => q.bookId !== id);
    State.notes     = State.notes.filter(n => n.bookId !== id);
  },

  getDeadlines: () => [...State.deadlines].sort((a, b) => new Date(a.date) - new Date(b.date)),

  saveDeadline: async (d) => {
    const { error } = await sb.from('deadlines').upsert({
      id: d.id, book_id: d.bookId, type: d.type, label: d.label,
      chapter_num: d.chapterNum, page_num: d.pageNum, date: d.date, is_final: d.isFinal,
    });
    if (error) throw error;
    const i = State.deadlines.findIndex(x => x.id === d.id);
    i >= 0 ? State.deadlines[i] = d : State.deadlines.push(d);
  },

  deleteDeadline: async (id) => {
    const { error } = await sb.from('deadlines').delete().eq('id', id);
    if (error) throw error;
    State.deadlines = State.deadlines.filter(d => d.id !== id);
    State.questions = State.questions.filter(q => q.weekId !== id);
  },

  getProgress: () => State.progress,

  updateProgress: async (username, page) => {
    const book = DB.getActiveBook();
    if (!book) return;
    const current = State.progress[username]?.currentPage ?? 0;
    if (page <= current) return; // forward-only
    const { error: uErr } = await sb.from('progress').upsert({
      account_id: State.account.id, book_id: book.id,
      current_page: page,
    }, { onConflict: 'account_id,book_id' });
    if (uErr) throw uErr;
    const { error: hErr } = await sb.from('progress_history').insert({
      account_id: State.account.id, book_id: book.id, page,
    });
    if (hErr) throw hErr;
    if (!State.progress[username]) State.progress[username] = { history: [] };
    State.progress[username].currentPage = page;
    State.progress[username].updatedAt   = new Date().toISOString();
    State.progress[username].history     = [
      { page, date: new Date().toISOString() },
      ...(State.progress[username].history || []),
    ];
  },

  getQuestions: () => State.questions,
  getQuestion:  (wid) => State.questions.find(q => q.weekId === wid) || null,

  saveQuestion: async (q) => {
    const { error } = await sb.from('questions').upsert({
      week_id: q.weekId, book_id: q.bookId,
      jack_wrote_for_jordan: q.jackWroteForJordan,
      jordan_wrote_for_jack: q.jordanWroteForJack,
      answers: q.answers,
    }, { onConflict: 'week_id' });
    if (error) throw error;
    const i = State.questions.findIndex(x => x.weekId === q.weekId);
    i >= 0 ? State.questions[i] = q : State.questions.push(q);
  },

  getNotes: () => State.notes,

  saveNote: async (n) => {
    const { error } = await sb.from('notes').insert({
      id: n.id, book_id: n.bookId, account_id: State.account.id,
      content: n.text, page: n.page,
    });
    if (error) throw error;
    State.notes.unshift(n);
  },

  deleteNote: async (id) => {
    const { error } = await sb.from('notes').delete().eq('id', id);
    if (error) throw error;
    State.notes = State.notes.filter(n => n.id !== id);
  },
};

// ============================================================
// UTILS
// ============================================================
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function other(user) { return user === 'jack' ? 'jordan' : 'jack'; }

function fmtDate(str) {
  if (!str) return '';
  return new Date(str + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(str) {
  if (!str) return null;
  const today  = new Date(); today.setHours(0,0,0,0);
  const target = new Date(str + 'T00:00:00');
  return Math.ceil((target - today) / 86400000);
}

function isPast(str)     { return daysUntil(str) < 0; }
function isUpcoming(str) { return daysUntil(str) > 0; }

function timeOfDay() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function getWeeks(bookId) {
  return DB.getDeadlines()
    .filter(d => d.bookId === bookId)
    .map((d, i) => ({ weekId: d.id, weekNum: i + 1, label: `Week ${i + 1}`, deadline: d }));
}

function blankQuestion(weekId, bookId) {
  return {
    weekId, bookId,
    jackWroteForJordan: null,
    jordanWroteForJack: null,
    answers: {
      jack:   { resonated: null, disagreed: null, custom: null, submittedAt: null },
      jordan: { resonated: null, disagreed: null, custom: null, submittedAt: null },
    },
  };
}

function daysChip(days) {
  if (days === null)  return '';
  if (days < 0)       return `<span class="chip chip-red">Overdue ${Math.abs(days)}d</span>`;
  if (days === 0)     return `<span class="chip chip-amber">Due today</span>`;
  if (days <= 3)      return `<span class="chip chip-amber">${days}d left</span>`;
  return `<span class="chip chip-green">${days}d left</span>`;
}

// ============================================================
// ROUTER
// ============================================================
function getHash() { return window.location.hash.slice(1) || '/'; }
function navigate(path) { window.location.hash = path; }

async function handleRoute() {
  if (!State.account) { renderFull(pageLogin()); return; }

  await loadData();

  const hash  = getHash();
  const parts = hash.split('/').filter(Boolean);

  let content;
  if      (hash === '/' || hash === '')           content = pageDashboard();
  else if (hash === '/books')                     content = pageBooks();
  else if (hash === '/books/add')                 content = pageBookForm(null);
  else if (hash.startsWith('/books/edit/'))       content = pageBookForm(DB.getBooks().find(b => b.id === parts[2]));
  else if (hash.startsWith('/books/') && parts.length === 2) content = pageBookDetail(DB.getBooks().find(b => b.id === parts[1]));
  else if (hash === '/deadlines')                 content = pageDeadlines();
  else if (hash === '/deadlines/add')             content = pageAddDeadline(null);
  else if (hash.startsWith('/deadlines/edit/'))   content = pageAddDeadline(DB.getDeadlines().find(d => d.id === parts[2]));
  else if (hash === '/progress')                  content = pageProgress();
  else if (hash === '/questions')                 content = pageQuestions();
  else if (hash.startsWith('/questions/week/'))   content = pageWeekQuestions(parts[2]);
  else if (hash === '/notes')                     content = pageNotes();
  else                                            content = pageDashboard();

  renderWithShell(content);
}

window.addEventListener('hashchange', handleRoute);

// ============================================================
// RENDER
// ============================================================
function renderFull(html) {
  document.getElementById('app').innerHTML = html;
}

function renderWithShell(content) {
  const user = DB.getUser();
  const hash = getHash();

  const allNavItems = [
    { href: '/',          icon: icons.grid,     label: 'Home',      mobile: true,  match: () => hash === '/' || hash === '' },
    { href: '/books',     icon: icons.book,     label: 'Books',     mobile: false, match: () => hash.startsWith('/books') },
    { href: '/deadlines', icon: icons.calendar, label: 'Deadlines', mobile: true,  match: () => hash.startsWith('/deadlines') },
    { href: '/progress',  icon: icons.chart,    label: 'Progress',  mobile: true,  match: () => hash === '/progress' },
    { href: '/notes',     icon: icons.notes,    label: 'Notes',     mobile: true,  match: () => hash === '/notes' },
    { href: '/questions', icon: icons.chat,     label: 'Questions', mobile: true,  match: () => hash.startsWith('/questions') },
  ];

  const navLinks       = allNavItems.map(n => `
    <a href="#${n.href}" class="nav-link ${n.match() ? 'active' : ''}">
      ${n.icon}<span>${n.label}</span>
    </a>`).join('');
  const mobileNavLinks = allNavItems.filter(n => n.mobile).map(n => `
    <a href="#${n.href}" class="nav-link ${n.match() ? 'active' : ''}">
      ${n.icon}<span>${n.label}</span>
    </a>`).join('');

  document.getElementById('app').innerHTML = `
    <div class="layout">
      <header class="mobile-header">
        <div class="mobile-header-logo">${icons.mountain}<span>BookClub</span></div>
        <button class="mobile-user-btn" onclick="switchUser()" title="Sign out">
          <div class="user-avatar">${cap(user).charAt(0)}</div>
        </button>
      </header>
      <nav class="sidebar">
        <div class="sidebar-header">
          <div class="logo">${icons.mountain}<span>BookClub</span></div>
        </div>
        <div class="nav-links">${navLinks}</div>
        <div class="sidebar-footer">
          <div class="user-pill">
            <div class="user-avatar">${cap(user).charAt(0)}</div>
            <span>${cap(user)}</span>
            <button class="switch-user-btn" onclick="switchUser()">Sign out</button>
          </div>
        </div>
      </nav>
      <main class="main-content">${content}</main>
      <nav class="bottom-nav">${mobileNavLinks}</nav>
    </div>
  `;
}

// ============================================================
// ICONS (inline SVG)
// ============================================================
const icons = {
  mountain: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 20 9 4 15 13 18 9 21 20"/><line x1="3" y1="20" x2="21" y2="20"/></svg>`,
  grid:     `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>`,
  book:     `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  calendar: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  chart:    `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  chat:     `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  chevron:  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  notes:    `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
};

// ============================================================
// PAGE: LOGIN
// ============================================================
function pageLogin(mode = 'login') {
  const isSignup = mode === 'signup';
  return `
    <div class="user-select-page">
      <div class="user-select-inner">
        <div class="user-select-logo">${icons.mountain}</div>
        <h1>BookClub</h1>
        <p class="user-select-subtitle">Jack &amp; Jordan · Knowledge</p>

        ${isSignup ? `
          <form class="auth-form" onsubmit="handleSignup(event)">
            <div class="form-group">
              <input type="email" name="email" class="form-input" placeholder="Email" required autocomplete="email">
            </div>
            <div class="form-group">
              <input type="password" name="password" class="form-input" placeholder="Password (min 6 chars)" minlength="6" required autocomplete="new-password">
            </div>
            <div class="form-group">
              <p class="form-label" style="margin-bottom:10px">Who are you?</p>
              <div class="user-cards">
                <label class="user-card-radio">
                  <input type="radio" name="username" value="jack" required>
                  <span class="user-card">
                    <div class="user-card-avatar jack">J</div>
                    <div class="user-card-name">Jack</div>
                  </span>
                </label>
                <label class="user-card-radio">
                  <input type="radio" name="username" value="jordan" required>
                  <span class="user-card">
                    <div class="user-card-avatar jordan">J</div>
                    <div class="user-card-name">Jordan</div>
                  </span>
                </label>
              </div>
            </div>
            <div id="auth-error" class="auth-error"></div>
            <button type="submit" class="btn btn-primary auth-btn">Create Account</button>
            <p class="auth-switch">Already have an account? <a href="#" onclick="showLogin(event)">Sign in</a></p>
          </form>
        ` : `
          <form class="auth-form" onsubmit="handleLogin(event)">
            <div class="form-group">
              <input type="email" name="email" class="form-input" placeholder="Email" required autocomplete="email">
            </div>
            <div class="form-group">
              <input type="password" name="password" class="form-input" placeholder="Password" required autocomplete="current-password">
            </div>
            <div id="auth-error" class="auth-error"></div>
            <button type="submit" class="btn btn-primary auth-btn">Sign In</button>
            <p class="auth-switch">No account yet? <a href="#" onclick="showSignup(event)">Sign up</a></p>
          </form>
        `}
      </div>
    </div>
  `;
}

// Shown when a session exists but no accounts row yet (edge case: email confirmed after failed insert)
function pageCompleteProfile() {
  return `
    <div class="user-select-page">
      <div class="user-select-inner">
        <div class="user-select-logo">${icons.mountain}</div>
        <h1>BookClub</h1>
        <p class="user-select-subtitle">One more step — who are you?</p>
        <form class="auth-form" onsubmit="handleCompleteProfile(event)">
          <div class="form-group">
            <div class="user-cards">
              <label class="user-card-radio">
                <input type="radio" name="username" value="jack" required>
                <span class="user-card">
                  <div class="user-card-avatar jack">J</div>
                  <div class="user-card-name">Jack</div>
                </span>
              </label>
              <label class="user-card-radio">
                <input type="radio" name="username" value="jordan" required>
                <span class="user-card">
                  <div class="user-card-avatar jordan">J</div>
                  <div class="user-card-name">Jordan</div>
                </span>
              </label>
            </div>
          </div>
          <div id="auth-error" class="auth-error"></div>
          <button type="submit" class="btn btn-primary auth-btn">Continue</button>
        </form>
      </div>
    </div>
  `;
}

function showLogin(e)  { e.preventDefault(); renderFull(pageLogin('login')); }
function showSignup(e) { e.preventDefault(); renderFull(pageLogin('signup')); }

async function handleLogin(e) {
  e.preventDefault();
  const { email, password } = Object.fromEntries(new FormData(e.target));
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Signing in…';

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    document.getElementById('auth-error').textContent = error.message;
    btn.disabled = false; btn.textContent = 'Sign In';
    return;
  }
  await initApp();
}

async function handleSignup(e) {
  e.preventDefault();
  const { email, password, username } = Object.fromEntries(new FormData(e.target));
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Creating account…';

  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) {
    document.getElementById('auth-error').textContent = error.message;
    btn.disabled = false; btn.textContent = 'Create Account';
    return;
  }

  if (!data.session) {
    // Email confirmation required — unlikely if disabled in Supabase dashboard
    document.getElementById('auth-error').textContent = 'Check your email to confirm your account, then sign in.';
    btn.disabled = false; btn.textContent = 'Create Account';
    return;
  }

  const { error: accErr } = await sb.from('accounts').insert({ id: data.user.id, username, club_id: CLUB_ID });
  if (accErr) {
    document.getElementById('auth-error').textContent = accErr.message;
    btn.disabled = false; btn.textContent = 'Create Account';
    return;
  }

  await initApp();
}

async function handleCompleteProfile(e) {
  e.preventDefault();
  const { username } = Object.fromEntries(new FormData(e.target));
  const { data: { user } } = await sb.auth.getUser();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Saving…';

  const { error } = await sb.from('accounts').insert({ id: user.id, username, club_id: CLUB_ID });
  if (error) {
    document.getElementById('auth-error').textContent = error.message;
    btn.disabled = false; btn.textContent = 'Continue';
    return;
  }
  await initApp();
}

async function switchUser() {
  await sb.auth.signOut();
  State.account = null;
  renderFull(pageLogin('login'));
}

// ============================================================
// PAGE: DASHBOARD
// ============================================================
function pageDashboard() {
  const user    = DB.getUser();
  const book    = DB.getActiveBook();
  const prog    = DB.getProgress();
  const myProg  = prog[user];

  if (!book) return `
    <div class="page">
      <div class="page-header"><div><h1 class="page-title">Dashboard</h1><p class="page-subtitle">Good ${timeOfDay()}, ${cap(user)}</p></div></div>
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <h3>No book yet</h3>
        <p>Add your first book to get started.</p>
        <a href="#/books/add" class="btn btn-primary">Add a Book</a>
      </div>
    </div>`;

  const deadlines    = DB.getDeadlines().filter(d => d.bookId === book.id);
  const nextDeadline = deadlines.find(d => !isPast(d.date));
  const weeks        = getWeeks(book.id);

  const pendingWeeks = weeks.filter(w => {
    if (isUpcoming(w.deadline.date)) return false;
    const q = DB.getQuestion(w.weekId);
    return !q?.answers?.[user]?.submittedAt;
  });

  const nextWeek = weeks.find(w => isUpcoming(w.deadline.date));
  const nextQ    = nextWeek ? DB.getQuestion(nextWeek.weekId) : null;
  const wroteQ   = nextQ ? !!(user === 'jack' ? nextQ.jackWroteForJordan : nextQ.jordanWroteForJack) : true;

  const pctToDeadline = (myProg?.currentPage && nextDeadline)
    ? Math.min(100, Math.round(myProg.currentPage / nextDeadline.pageNum * 100))
    : 0;
  const pctBook = myProg?.currentPage
    ? Math.min(100, Math.round(myProg.currentPage / book.totalPages * 100))
    : 0;
  const pagesToDeadline = (myProg?.currentPage && nextDeadline)
    ? Math.max(0, nextDeadline.pageNum - myProg.currentPage)
    : null;
  const pagesLeft = myProg?.currentPage
    ? Math.max(0, book.totalPages - myProg.currentPage)
    : book.totalPages;

  function motivationLine(pct) {
    if (pct === 0)  return 'Ready to dive in?';
    if (pct < 10)   return 'Every page counts — keep going.';
    if (pct < 25)   return 'Good start. Build the habit.';
    if (pct < 50)   return 'Finding your rhythm — stay with it.';
    if (pct === 50) return "Halfway there. Don't stop now.";
    if (pct < 75)   return 'Past the halfway point — momentum is everything.';
    if (pct < 90)   return 'The end is in sight. Finish strong.';
    if (pct < 100)  return 'Almost done. See it through.';
    return 'Finished! Time to discuss.';
  }

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">Good ${timeOfDay()}, ${cap(user)}</p>
        </div>
      </div>

      <div class="dashboard-grid">

        <div class="card reading-progress-card">
          <div class="reading-progress-inner">
            <div class="reading-info">
              <div class="card-label">Currently Reading</div>
              <div class="book-spine-row">
                <div class="book-spine-bar" style="background:${book.color || '#2D5A27'}"></div>
                <div>
                  <h2 class="book-title-large">${book.title}</h2>
                  <p class="book-author">${book.author}</p>
                </div>
              </div>
              ${nextDeadline ? `
                <div class="deadline-inline">
                  <span class="deadline-type-badge-sm ${nextDeadline.type === 'chapter' ? 'badge-chapter' : 'badge-page'}">
                    ${nextDeadline.type === 'chapter' ? '📖 Ch.' : '🔖 Pg.'}
                  </span>
                  <span class="deadline-inline-label">${nextDeadline.label}</span>
                  <span class="deadline-inline-date">${fmtDate(nextDeadline.date)}</span>
                  ${daysChip(daysUntil(nextDeadline.date))}
                </div>
              ` : `<p class="muted" style="margin-top:12px"><a href="#/deadlines/add">Add a deadline →</a></p>`}
            </div>

            <div class="progress-inline">
              <div class="card-label">Your Progress</div>

              <div class="inline-page-row">
                <div id="page-display" class="page-display" onclick="startPageEdit()" title="Click to update">
                  <span class="progress-page">${myProg?.currentPage ?? '—'}</span>
                  <span class="progress-total"> / ${book.totalPages}</span>
                  <span class="page-edit-hint">edit</span>
                </div>
                <div id="page-input-wrap" class="page-input-wrap hidden">
                  <input id="inline-page-input" type="number" class="form-input page-inline-input"
                    value="${myProg?.currentPage || ''}" min="1" max="${book.totalPages}"
                    onkeydown="if(event.key==='Enter')savePageEdit();if(event.key==='Escape')cancelPageEdit();">
                  <button class="btn btn-primary btn-sm" onclick="savePageEdit()">Save</button>
                  <button class="btn btn-ghost btn-sm" onclick="cancelPageEdit()">×</button>
                </div>
              </div>

              <div class="motivation-stats">
                <div class="motivation-pct-wrap">
                  <div class="motivation-pct-bar">
                    <div class="motivation-pct-fill" style="width:${pctBook}%"></div>
                  </div>
                  <span class="motivation-pct-label">${pctBook}% of book</span>
                </div>
                ${myProg?.currentPage ? `
                  <div class="motivation-line">${motivationLine(pctBook)}</div>
                  <div class="motivation-stats-row">
                    ${pagesToDeadline !== null ? `
                      <div class="motivation-stat">
                        <span class="motivation-stat-val">${pagesToDeadline}</span>
                        <span class="motivation-stat-label">pages to deadline</span>
                      </div>
                    ` : ''}
                    <div class="motivation-stat">
                      <span class="motivation-stat-val">${pagesLeft}</span>
                      <span class="motivation-stat-label">pages left in book</span>
                    </div>
                  </div>
                ` : `<p class="muted" style="margin-top:6px;font-size:12.5px">Click the page number above to log where you are.</p>`}
              </div>

              <div class="progress-vs">
                ${cap(other(user))}: ${prog[other(user)]?.currentPage
                  ? `page ${prog[other(user)].currentPage} · ${Math.round(prog[other(user)].currentPage / book.totalPages * 100)}%`
                  : 'not started yet'}
              </div>
            </div>
          </div>
        </div>

        <div class="card questions-card">
          <div class="card-label">Questions</div>
          ${pendingWeeks.length > 0 ? `
            <div class="pending-questions">
              <span class="badge badge-amber">${pendingWeeks.length} unanswered</span>
              ${pendingWeeks.slice(0,2).map(w => `
                <a href="#/questions/week/${w.weekId}" class="pending-q-link">
                  ${w.label} — ${fmtDate(w.deadline.date)}
                </a>`).join('')}
            </div>
          ` : `<p class="muted" style="margin-bottom:8px">All caught up! ✓</p>`}
          ${!wroteQ && nextWeek ? `
            <div class="write-question-nudge">
              <span class="badge badge-pine">Write a question for ${cap(other(user))}</span>
              <a href="#/questions/week/${nextWeek.weekId}" class="pending-q-link">
                ${nextWeek.label} — ${fmtDate(nextWeek.deadline.date)}
              </a>
            </div>
          ` : ''}
          <a href="#/questions" class="btn btn-secondary mt-3">View All Weeks</a>
        </div>

        <div class="card" style="display:flex;flex-direction:column;gap:8px;justify-content:center">
          <div class="card-label">Jump To</div>
          <a href="#/deadlines/add" class="btn btn-secondary" style="justify-content:center">+ Add Deadline</a>
          <a href="#/books" class="btn btn-ghost" style="justify-content:center;border:1px solid var(--border-dark)">Manage Books</a>
          <a href="#/progress" class="btn btn-ghost" style="justify-content:center;border:1px solid var(--border-dark)">Full Progress</a>
        </div>

      </div>
    </div>`;
}

// ============================================================
// INLINE PAGE EDIT (dashboard)
// ============================================================
function startPageEdit() {
  document.getElementById('page-display')?.classList.add('hidden');
  const wrap = document.getElementById('page-input-wrap');
  wrap?.classList.remove('hidden');
  const input = document.getElementById('inline-page-input');
  if (input) { input.focus(); input.select(); }
}

function cancelPageEdit() {
  document.getElementById('page-input-wrap')?.classList.add('hidden');
  document.getElementById('page-display')?.classList.remove('hidden');
}

async function savePageEdit() {
  const input = document.getElementById('inline-page-input');
  const page  = parseInt(input?.value);
  if (isNaN(page) || page < 0) { cancelPageEdit(); return; }
  await DB.updateProgress(DB.getUser(), page);
  handleRoute();
}

// ============================================================
// LOG MODAL (progress page)
// ============================================================
function logModal(book, myProg) {
  return `
    <div id="log-modal" class="modal-backdrop hidden">
      <div class="modal">
        <div class="modal-header">
          <h3>Log Pages Read</h3>
          <button class="modal-close" onclick="closeLogModal()">×</button>
        </div>
        <div class="modal-body">
          <label class="form-label">Current page</label>
          <input type="number" id="log-page-input" class="form-input"
            placeholder="${myProg?.currentPage || ''}" min="1" max="${book?.totalPages || 9999}">
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeLogModal()">Cancel</button>
          <button class="btn btn-primary" onclick="submitLogPages()">Save</button>
        </div>
      </div>
    </div>`;
}

function openLogModal()  { document.getElementById('log-modal')?.classList.remove('hidden'); document.getElementById('log-page-input')?.focus(); }
function closeLogModal() { document.getElementById('log-modal')?.classList.add('hidden'); }

async function submitLogPages() {
  const input = document.getElementById('log-page-input');
  const page  = parseInt(input?.value);
  if (!page || page < 1) return;
  await DB.updateProgress(DB.getUser(), page);
  closeLogModal();
  handleRoute();
}

// ============================================================
// PAGE: BOOKS
// ============================================================
function pageBooks() {
  const books  = DB.getBooks();
  const active = DB.getActiveBook();

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Books</h1>
          <p class="page-subtitle">${books.length} book${books.length !== 1 ? 's' : ''}</p>
        </div>
        <a href="#/books/add" class="btn btn-primary">+ Add Book</a>
      </div>
      ${books.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">📖</div>
          <h3>No books yet</h3>
          <p>Add your first book to get started.</p>
          <a href="#/books/add" class="btn btn-primary">Add a Book</a>
        </div>
      ` : `
        <div class="book-list">
          ${books.map(b => `
            <div class="card book-list-card ${b.isActive ? 'book-active' : ''}">
              <div class="book-list-info">
                ${b.coverUrl
                  ? `<img src="${b.coverUrl.replace('-L.jpg','-M.jpg')}" class="book-list-cover" alt="">`
                  : `<div class="book-list-spine" style="background:${b.color || '#2D5A27'}"></div>`}
                <div>
                  <div class="book-list-title">${b.title}</div>
                  <div class="book-list-author">${b.author}</div>
                  <div class="book-list-pages">${b.totalPages} pages${b.publishedYear ? ` · ${b.publishedYear}` : ''}</div>
                </div>
              </div>
              <div class="book-list-actions">
                ${b.isActive
                  ? `<span class="badge badge-pine">Active</span>`
                  : `<button class="btn btn-ghost btn-sm" onclick="setActiveBook('${b.id}')">Set Active</button>`}
                <a href="#/books/${b.id}" class="btn btn-ghost btn-sm">Details</a>
                <a href="#/books/edit/${b.id}" class="btn btn-ghost btn-sm">Edit</a>
                <button class="btn btn-ghost btn-sm btn-danger" onclick="confirmDeleteBook('${b.id}')">Delete</button>
              </div>
            </div>`).join('')}
        </div>`}
    </div>`;
}

async function setActiveBook(id) {
  await DB.setActiveBook(id);
  navigate('/books');
}

async function confirmDeleteBook(id) {
  if (confirm('Delete this book? All deadlines and questions for it will also be removed.')) {
    await DB.deleteBook(id);
    navigate('/books');
  }
}

// ============================================================
// PAGE: BOOK DETAIL
// ============================================================
function pageBookDetail(book) {
  if (!book) return `<div class="page"><div class="empty-state"><p>Book not found.</p><a href="#/books" class="btn btn-ghost">← Back</a></div></div>`;

  const user    = DB.getUser();
  const them    = other(user);
  const myLib   = DB.getLibraryEntry(book.id, user);
  const theirLib= DB.getLibraryEntry(book.id, them);

  function dateInput(name, val, label) {
    return `
      <div class="lib-date-field">
        <label class="form-label">${label}</label>
        <input type="date" name="${name}" class="form-input lib-date-input" value="${val || ''}">
      </div>`;
  }

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">${book.title}</h1>
          <p class="page-subtitle">${book.author}${book.publishedYear ? ` · ${book.publishedYear}` : ''}</p>
        </div>
        <a href="#/books" class="btn btn-ghost">← Back</a>
      </div>

      <div class="book-detail-layout">

        <div class="book-detail-top">
          ${book.coverUrl ? `<img src="${book.coverUrl}" class="book-detail-cover" alt="${book.title} cover">` : ''}
          <div class="book-detail-meta">
            <div class="book-meta-row"><span class="meta-label">Author</span><span>${book.author}</span></div>
            <div class="book-meta-row"><span class="meta-label">Pages</span><span>${book.totalPages}</span></div>
            ${book.publishedYear ? `<div class="book-meta-row"><span class="meta-label">Published</span><span>${book.publishedYear}</span></div>` : ''}
            ${book.isbn ? `<div class="book-meta-row"><span class="meta-label">ISBN</span><span class="muted">${book.isbn}</span></div>` : ''}
            <div class="book-meta-actions">
              <a href="#/books/edit/${book.id}" class="btn btn-secondary btn-sm">Edit Book</a>
            </div>
          </div>
        </div>

        ${book.description ? `
          <div class="card">
            <div class="card-label">About</div>
            <p class="book-description">${book.description}</p>
          </div>
        ` : ''}

        <div class="card">
          <div class="card-label">Your Reading Dates</div>
          <form onsubmit="saveLibraryDates(event,'${book.id}')">
            <div class="lib-dates-row">
              ${dateInput('startedAt', myLib?.startedAt, 'Started')}
              ${dateInput('finishedAt', myLib?.finishedAt, 'Finished')}
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary btn-sm">Save Dates</button>
            </div>
          </form>
        </div>

        <div class="card">
          <div class="card-label">${cap(them)}'s Reading Dates</div>
          <div class="lib-dates-row">
            <div class="lib-date-field">
              <span class="meta-label">Started</span>
              <span>${theirLib?.startedAt ? fmtDate(theirLib.startedAt) : '—'}</span>
            </div>
            <div class="lib-date-field">
              <span class="meta-label">Finished</span>
              <span>${theirLib?.finishedAt ? fmtDate(theirLib.finishedAt) : '—'}</span>
            </div>
          </div>
        </div>

      </div>
    </div>`;
}

async function saveLibraryDates(e, bookId) {
  e.preventDefault();
  const d   = Object.fromEntries(new FormData(e.target));
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await DB.saveLibraryEntry(bookId, DB.getUser(), {
      startedAt:  d.startedAt  || null,
      finishedAt: d.finishedAt || null,
    });
    btn.textContent = 'Saved ✓';
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Save Dates'; }, 1500);
  } catch (err) {
    alert('Failed to save dates. Please try again.');
    btn.disabled = false; btn.textContent = 'Save Dates';
  }
}

// ============================================================
// PAGE: ADD / EDIT BOOK
// ============================================================
const SPINE_COLORS = ['#2D5A27','#4E7FA0','#8B6914','#7B5EA7','#B83232','#2C7873','#A06030'];

function pageBookForm(book) {
  const isEdit = !!book;
  return `
    <div class="page">
      <div class="page-header">
        <div><h1 class="page-title">${isEdit ? 'Edit Book' : 'Add a Book'}</h1></div>
        <a href="#/books" class="btn btn-ghost">← Back</a>
      </div>
      <div class="card form-card">
        ${!isEdit ? `
          <div class="form-group ol-search-group">
            <label class="form-label">Search Open Library <span class="form-optional">(autofill)</span></label>
            <div class="ol-search-row">
              <input id="ol-search-input" type="text" class="form-input" placeholder="Title to search…"
                onkeydown="if(event.key==='Enter'){event.preventDefault();searchOpenLibrary();}">
              <button id="ol-search-btn" type="button" class="btn btn-secondary" onclick="searchOpenLibrary()">Search</button>
            </div>
            <div id="ol-results" class="ol-results"></div>
          </div>
          <hr class="form-divider">
        ` : ''}
        <form onsubmit="saveBook(event,'${book?.id || ''}')">
          <input type="hidden" name="coverUrl" value="${book?.coverUrl || ''}">
          <input type="hidden" name="isbn" value="${book?.isbn || ''}">
          <input type="hidden" name="publishedYear" value="${book?.publishedYear || ''}">
          <input type="hidden" name="description" value="${book?.description || ''}">
          <div id="ol-cover-preview">
            ${book?.coverUrl ? `<img src="${book.coverUrl.replace('-L.jpg','-M.jpg')}" class="book-cover-preview">` : ''}
          </div>
          <div class="form-group">
            <label class="form-label">Title *</label>
            <input name="title" type="text" class="form-input" required value="${book?.title || ''}" placeholder="e.g. The Goldfinch">
          </div>
          <div class="form-group">
            <label class="form-label">Author *</label>
            <input name="author" type="text" class="form-input" required value="${book?.author || ''}" placeholder="e.g. Donna Tartt">
          </div>
          <div class="form-group">
            <label class="form-label">Total Pages *</label>
            <input name="totalPages" type="number" class="form-input" required min="1" value="${book?.totalPages || ''}" placeholder="e.g. 352">
          </div>
          <div class="form-group">
            <label class="form-label">Spine Color</label>
            <div class="color-picker">
              ${SPINE_COLORS.map(c => `
                <label class="color-option">
                  <input type="radio" name="color" value="${c}" ${(book?.color || SPINE_COLORS[0]) === c ? 'checked' : ''}>
                  <span class="color-swatch" style="background:${c}"></span>
                </label>`).join('')}
            </div>
          </div>
          <div class="form-actions">
            <a href="#/books" class="btn btn-ghost">Cancel</a>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Add Book'}</button>
          </div>
        </form>
      </div>
    </div>`;
}

async function searchOpenLibrary() {
  const input = document.getElementById('ol-search-input');
  const title = input?.value.trim();
  if (!title) return;
  const btn = document.getElementById('ol-search-btn');
  btn.textContent = 'Searching…'; btn.disabled = true;
  try {
    const res  = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&fields=key,title,author_name,number_of_pages_median,cover_i,first_publish_year,isbn&limit=5`);
    const data = await res.json();
    window._olDocs = data.docs || [];
    const container = document.getElementById('ol-results');
    if (!window._olDocs.length) { container.innerHTML = '<p class="muted-sm" style="margin-top:8px">No results found.</p>'; return; }
    container.innerHTML = window._olDocs.map((d, i) => `
      <button type="button" class="ol-result-item" onclick="selectOLResult(${i})">
        ${d.cover_i ? `<img src="https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg" class="ol-cover-thumb" alt="">` : '<div class="ol-no-cover"></div>'}
        <div class="ol-result-info">
          <div class="ol-result-title">${d.title}</div>
          <div class="ol-result-author">${(d.author_name || []).slice(0,2).join(', ')}</div>
          <div class="ol-result-meta">${[d.first_publish_year, d.number_of_pages_median ? d.number_of_pages_median + ' pages' : ''].filter(Boolean).join(' · ')}</div>
        </div>
      </button>`).join('');
  } catch {
    document.getElementById('ol-results').innerHTML = '<p class="muted-sm" style="margin-top:8px">Search failed — fill in manually.</p>';
  } finally {
    btn.textContent = 'Search'; btn.disabled = false;
  }
}

function selectOLResult(i) {
  const d = window._olDocs[i];
  const form = document.querySelector('form[onsubmit^="saveBook"]');
  form.querySelector('[name=title]').value      = d.title || '';
  form.querySelector('[name=author]').value     = (d.author_name || []).slice(0,2).join(', ');
  if (d.number_of_pages_median) form.querySelector('[name=totalPages]').value = d.number_of_pages_median;
  const coverUrl = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '';
  form.querySelector('[name=coverUrl]').value      = coverUrl;
  form.querySelector('[name=publishedYear]').value = d.first_publish_year || '';
  form.querySelector('[name=isbn]').value          = (d.isbn || [])[0] || '';
  document.getElementById('ol-results').innerHTML  = '';
  document.getElementById('ol-cover-preview').innerHTML = coverUrl
    ? `<img src="${coverUrl.replace('-L.jpg','-M.jpg')}" class="book-cover-preview">`
    : '';
}

async function saveBook(e, existingId) {
  e.preventDefault();
  const d       = Object.fromEntries(new FormData(e.target));
  const books   = DB.getBooks();
  const isFirst = books.length === 0 && !existingId;
  const existing = existingId ? books.find(b => b.id === existingId) : null;

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;

  try {
    await DB.saveBook({
      id:           existingId || crypto.randomUUID(),
      title:        d.title.trim(),
      author:       d.author.trim(),
      totalPages:   parseInt(d.totalPages),
      color:        d.color || SPINE_COLORS[0],
      isActive:     existing ? existing.isActive : isFirst,
      createdAt:    existing?.createdAt || new Date().toISOString(),
      coverUrl:     d.coverUrl || existing?.coverUrl || null,
      isbn:         d.isbn || existing?.isbn || null,
      publishedYear:d.publishedYear ? parseInt(d.publishedYear) : (existing?.publishedYear || null),
      description:  d.description || existing?.description || null,
    });
    navigate('/books');
  } catch (err) {
    alert('Failed to save book. Please try again.');
    btn.disabled = false;
  }
}

// ============================================================
// PAGE: DEADLINES
// ============================================================
function pageDeadlines() {
  const book = DB.getActiveBook();
  if (!book) return noBookPage('Deadlines');

  const deadlines = DB.getDeadlines().filter(d => d.bookId === book.id);

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Deadlines</h1>
          <p class="page-subtitle">${book.title}</p>
        </div>
        <a href="#/deadlines/add" class="btn btn-primary">+ Add Deadline</a>
      </div>
      <div class="deadlines-layout">
        <div>${miniCalendar(deadlines)}</div>
        <div>
          ${deadlines.length === 0 ? `
            <div class="empty-state">
              <div class="empty-icon">📅</div>
              <h3>No deadlines yet</h3>
              <p>Add chapter or page-stop deadlines to track your pace.</p>
              <a href="#/deadlines/add" class="btn btn-primary">Add First Deadline</a>
            </div>
          ` : `
            <div class="deadline-list">
              ${deadlines.map((d, i) => `
                <div class="card deadline-list-card ${isPast(d.date) ? 'deadline-past' : ''} ${d.isFinal ? 'deadline-final' : ''}">
                  <div class="deadline-list-week">
                    Week ${i+1}
                    ${d.isFinal ? '<span class="final-badge">Final</span>' : ''}
                  </div>
                  <div class="deadline-list-main">
                    <div class="deadline-type-badge ${d.type === 'chapter' ? 'badge-chapter' : 'badge-page'}">
                      ${d.type === 'chapter' ? '📖 End of Chapter' : '🔖 Page Stop'}
                    </div>
                    <div class="deadline-list-label">${d.label}</div>
                    <div class="deadline-list-page">Through page ${d.pageNum}</div>
                  </div>
                  <div class="deadline-list-right">
                    <div class="deadline-list-date">${fmtDate(d.date)}</div>
                    ${daysChip(daysUntil(d.date))}
                    <div class="deadline-actions">
                      <a href="#/deadlines/edit/${d.id}" class="btn btn-ghost btn-sm">Edit</a>
                      <button class="btn btn-ghost btn-sm btn-danger" onclick="confirmDeleteDeadline('${d.id}')">Delete</button>
                    </div>
                  </div>
                </div>`).join('')}
            </div>`}
        </div>
      </div>
    </div>`;
}

let _calOffset = 0;

function miniCalendar(deadlines) {
  const now   = new Date();
  const base  = new Date(now.getFullYear(), now.getMonth() + _calOffset, 1);
  const y     = base.getFullYear();
  const m     = base.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days  = new Date(y, m + 1, 0).getDate();
  const dlMap = {};
  deadlines.forEach(d => { dlMap[d.date] = d; });

  let cells = Array(first).fill(`<div class="cal-cell cal-empty"></div>`).join('');
  for (let d = 1; d <= days; d++) {
    const ds  = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dl  = dlMap[ds];
    const tod = _calOffset === 0 && d === now.getDate();
    const dotClass = dl ? (dl.isFinal ? 'cal-dot-final' : `cal-dot-${dl.type}`) : '';
    cells += `
      <div class="cal-cell ${tod ? 'cal-today' : ''} ${dl ? 'cal-has-deadline' : ''}">
        <span class="cal-day">${d}</span>
        ${dl ? `<span class="cal-dot ${dotClass}"></span>` : ''}
      </div>`;
  }

  const monthLabel = base.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return `
    <div class="card calendar-card">
      <div class="calendar-header">
        <button class="cal-nav" onclick="calNav(-1)">&#8249;</button>
        <span>${monthLabel}</span>
        <button class="cal-nav" onclick="calNav(1)">&#8250;</button>
      </div>
      <div class="cal-grid">
        ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => `<div class="cal-cell cal-header">${d}</div>`).join('')}
        ${cells}
      </div>
      <div class="cal-legend">
        <span class="cal-legend-item"><span class="cal-dot cal-dot-chapter"></span> End of chapter</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-page"></span> Page stop</span>
        <span class="cal-legend-item"><span class="cal-dot cal-dot-final"></span> Final</span>
      </div>
    </div>`;
}

function calNav(dir) {
  _calOffset += dir;
  const book      = DB.getActiveBook();
  const deadlines = DB.getDeadlines().filter(d => d.bookId === book?.id);
  const container = document.querySelector('.deadlines-layout > div:first-child');
  if (container) container.innerHTML = miniCalendar(deadlines);
}

async function confirmDeleteDeadline(id) {
  if (confirm('Delete this deadline?')) {
    await DB.deleteDeadline(id);
    navigate('/deadlines');
  }
}

// ============================================================
// PAGE: ADD DEADLINE
// ============================================================
function pageAddDeadline(existing) {
  const book  = DB.getActiveBook();
  const allDl = DB.getDeadlines().filter(d => d.bookId === book?.id);
  const week  = existing ? allDl.findIndex(d => d.id === existing.id) + 1 : allDl.length + 1;
  const isEdit    = !!existing;
  const isChapter = !existing || existing.type === 'chapter';

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">${isEdit ? 'Edit Deadline' : 'Add Deadline'}</h1>
          <p class="page-subtitle">${book?.title || ''} · Week ${week}</p>
        </div>
        <a href="#/deadlines" class="btn btn-ghost">← Back</a>
      </div>
      <div class="card form-card">
        <form onsubmit="saveDeadline(event)">
          ${isEdit ? `<input type="hidden" name="id" value="${existing.id}">` : ''}

          <div class="form-group">
            <label class="form-label">Deadline Type *</label>
            <div class="type-toggle">
              <label class="type-option">
                <input type="radio" name="type" value="chapter" ${isChapter ? 'checked' : ''} onchange="onTypeChange(this)">
                <span class="type-option-inner">
                  <span class="type-icon">📖</span>
                  <span class="type-label">End of Chapter</span>
                  <span class="type-desc">Read through the end of a complete chapter</span>
                </span>
              </label>
              <label class="type-option">
                <input type="radio" name="type" value="page" ${!isChapter ? 'checked' : ''} onchange="onTypeChange(this)">
                <span class="type-option-inner">
                  <span class="type-icon">🔖</span>
                  <span class="type-label">Page Stop</span>
                  <span class="type-desc">Stop partway through a chapter at a specific page</span>
                </span>
              </label>
            </div>
          </div>

          <div id="chapter-field" class="form-group" ${!isChapter ? 'style="display:none"' : ''}>
            <label class="form-label">Chapter Number *</label>
            <input id="chapter-num" type="number" name="chapterNum" class="form-input" min="1" placeholder="e.g. 5" ${!isChapter ? '' : 'required'} value="${existing?.chapterNum ?? ''}">
          </div>

          <div class="form-group">
            <label class="form-label">Through Page *</label>
            <p class="form-hint">The last page to be read by this deadline</p>
            <input type="number" name="pageNum" class="form-input" required min="1" max="${book?.totalPages || 9999}" placeholder="e.g. 87" value="${existing?.pageNum ?? ''}">
          </div>

          <div class="form-group">
            <label class="form-label">Custom Label <span class="form-optional">(optional)</span></label>
            <p class="form-hint">Leave blank to auto-generate, e.g. "End of Chapter 5" or "Page 87"</p>
            <input type="text" name="customLabel" class="form-input" placeholder="e.g. Through the dream sequence" value="${existing?.label ?? ''}">
          </div>

          <div class="form-group">
            <label class="form-label">Due Date *</label>
            <input type="date" name="date" class="form-input" required value="${existing?.date ?? ''}">
          </div>

          <div class="form-group">
            <label class="form-label checkbox-label">
              <input type="checkbox" name="isFinal" value="1" ${existing?.isFinal ? 'checked' : ''}>
              <span>Final deadline — end of book</span>
            </label>
            <p class="form-hint">Mark this as the last reading deadline for this book.</p>
          </div>

          <div class="form-actions">
            <a href="#/deadlines" class="btn btn-ghost">Cancel</a>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Add Deadline'}</button>
          </div>
        </form>
      </div>
    </div>`;
}

function onTypeChange(radio) {
  const field = document.getElementById('chapter-field');
  const input = document.getElementById('chapter-num');
  if (radio.value === 'chapter') {
    field.style.display = '';
    input.required = true;
  } else {
    field.style.display = 'none';
    input.required = false;
  }
}

async function saveDeadline(e) {
  e.preventDefault();
  const book = DB.getActiveBook();
  if (!book) return;
  const d       = Object.fromEntries(new FormData(e.target));
  const type    = d.type;
  const page    = parseInt(d.pageNum);
  const ch      = d.chapterNum ? parseInt(d.chapterNum) : null;
  const label   = d.customLabel?.trim() || (type === 'chapter' && ch ? `End of Chapter ${ch}` : `Page ${page}`);
  const isFinal = d.isFinal === '1';

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;

  try {
    const existing = d.id ? DB.getDeadlines().find(x => x.id === d.id) : null;
    await DB.saveDeadline({
      id: existing?.id || crypto.randomUUID(),
      bookId: book.id,
      type, label, chapterNum: ch, pageNum: page, date: d.date,
      isFinal,
      createdAt: existing?.createdAt || new Date().toISOString(),
    });
    navigate('/deadlines');
  } catch (err) {
    alert('Failed to save deadline. Please try again.');
    btn.disabled = false;
  }
}

// ============================================================
// PAGE: PROGRESS
// ============================================================
function pageProgress() {
  const user  = DB.getUser();
  const book  = DB.getActiveBook();
  const prog  = DB.getProgress();
  const jackP = prog.jack;
  const jorP  = prog.jordan;

  if (!book) return noBookPage('Progress');

  const deadlines = DB.getDeadlines().filter(d => d.bookId === book.id);

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Reading Progress</h1>
          <p class="page-subtitle">${book.title}</p>
        </div>
        <button class="btn btn-primary" onclick="openLogModal()">Log Pages</button>
      </div>

      <div class="progress-page-layout">

        <div class="card">
          <div class="card-label">Side by Side</div>
          <div class="progress-comparison">
            ${progressBar('Jack',   jackP?.currentPage, book.totalPages, 'var(--pine)')}
            ${progressBar('Jordan', jorP?.currentPage,  book.totalPages, 'var(--sky)')}
          </div>
        </div>

        ${deadlines.length > 0 ? `
          <div class="card">
            <div class="card-label">Deadline Checkpoints</div>
            <div class="deadline-progress-list">
              ${deadlines.map((d, i) => {
                const jDone = jackP?.currentPage >= d.pageNum;
                const rDone = jorP?.currentPage  >= d.pageNum;
                return `
                  <div class="deadline-progress-item">
                    <div class="deadline-progress-left">
                      <span class="deadline-progress-week">Wk ${i+1}</span>
                      <span class="deadline-type-badge-sm ${d.type === 'chapter' ? 'badge-chapter' : 'badge-page'}">
                        ${d.type === 'chapter' ? 'Ch.' : 'Pg.'}
                      </span>
                      <span class="deadline-progress-label">${d.label}</span>
                      <span class="deadline-progress-date muted">${fmtDate(d.date)}</span>
                    </div>
                    <div class="deadline-progress-right">
                      <span class="deadline-progress-user ${jDone ? 'done' : isPast(d.date) ? 'late' : ''}">
                        ${jDone ? '✓' : isPast(d.date) ? '✗' : '○'} Jack
                      </span>
                      <span class="deadline-progress-user ${rDone ? 'done' : isPast(d.date) ? 'late' : ''}">
                        ${rDone ? '✓' : isPast(d.date) ? '✗' : '○'} Jordan
                      </span>
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>` : ''}

        ${(jackP?.history?.length || jorP?.history?.length) ? `
          <div class="card">
            <div class="card-label">Recent Logs</div>
            <div class="history-list">
              ${[...(jackP?.history?.map(h => ({ ...h, who: 'Jack' })) || []),
                 ...(jorP?.history?.map(h => ({ ...h, who: 'Jordan' })) || [])]
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .slice(0, 12)
                .map(h => `
                  <div class="history-item">
                    <span class="history-user ${h.who.toLowerCase()}">${h.who}</span>
                    <span class="history-page">page ${h.page}</span>
                    <span class="history-date muted">${fmtDate(h.date.split('T')[0])}</span>
                  </div>`).join('')}
            </div>
          </div>` : ''}

      </div>

      ${logModal(book, prog[user])}
    </div>`;
}

function progressBar(name, currentPage, totalPages, color) {
  const pct = currentPage ? Math.min(100, Math.round(currentPage / totalPages * 100)) : 0;
  return `
    <div class="progress-bar-row">
      <div class="progress-bar-name">${name}</div>
      <div class="progress-bar-main">
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="progress-bar-pct">${pct}%</span>
      </div>
      <div class="progress-bar-page">${currentPage ? `Page ${currentPage}` : 'Not started'} / ${totalPages}</div>
    </div>`;
}

// ============================================================
// PAGE: QUESTIONS LIST
// ============================================================
function pageQuestions() {
  const book = DB.getActiveBook();
  if (!book) return noBookPage('Questions');

  const user  = DB.getUser();
  const weeks = getWeeks(book.id);

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Questions</h1>
          <p class="page-subtitle">${book.title}</p>
        </div>
      </div>
      ${weeks.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">💬</div>
          <h3>No reading weeks yet</h3>
          <p>Add deadlines to create weekly reading periods with discussion questions.</p>
          <a href="#/deadlines/add" class="btn btn-primary">Add a Deadline</a>
        </div>
      ` : `
        <div class="weeks-list">
          ${weeks.map(w => {
            const q           = DB.getQuestion(w.weekId);
            const mine        = !!q?.answers?.[user]?.submittedAt;
            const theirs      = !!q?.answers?.[other(user)]?.submittedAt;
            const upcoming    = isUpcoming(w.deadline.date);
            const iWrote      = user === 'jack' ? q?.jackWroteForJordan : q?.jordanWroteForJack;
            const theyWrote   = user === 'jack' ? q?.jordanWroteForJack : q?.jackWroteForJordan;
            const bothWrote   = !!(iWrote && theyWrote);

            return `
              <a href="#/questions/week/${w.weekId}" class="card week-card ${upcoming ? 'week-upcoming' : ''}">
                <div class="week-card-left">
                  <div class="week-number">${w.label}</div>
                  <div class="week-deadline-label">${w.deadline.label}</div>
                  <div class="week-date muted">${fmtDate(w.deadline.date)}</div>
                </div>
                <div class="week-card-right">
                  ${upcoming ? `<span class="badge badge-stone">Upcoming</span>` : ''}
                  ${upcoming && !iWrote ? `<span class="badge badge-amber">Write your question</span>` : ''}
                  ${upcoming && iWrote && !bothWrote ? `<span class="badge badge-sky">Waiting for ${cap(other(user))}</span>` : ''}
                  ${upcoming && bothWrote ? `<span class="badge badge-pine">Questions revealed</span>` : ''}
                  ${mine   ? `<span class="badge badge-pine">You answered</span>` : !upcoming ? `<span class="badge badge-amber">Needs answer</span>` : ''}
                  ${theirs ? `<span class="badge badge-pine">${cap(other(user))} answered</span>` : ''}
                  ${icons.chevron}
                </div>
              </a>`;
          }).join('')}
        </div>`}
    </div>`;
}

// ============================================================
// PAGE: WEEK QUESTIONS DETAIL
// ============================================================
function pageWeekQuestions(weekId) {
  const book  = DB.getActiveBook();
  const user  = DB.getUser();
  const them  = other(user);
  const weeks = book ? getWeeks(book.id) : [];
  const week  = weeks.find(w => w.weekId === weekId);

  if (!week) return `<div class="page"><div class="empty-state"><p>Week not found.</p><a href="#/questions" class="btn btn-ghost">← Back</a></div></div>`;

  const q             = DB.getQuestion(weekId) || blankQuestion(weekId, book.id);
  const upcoming      = isUpcoming(week.deadline.date);
  const myAnswers     = q.answers?.[user]  || {};
  const theirAnswers  = q.answers?.[them]  || {};
  const mySubmitted   = !!myAnswers.submittedAt;
  const theirSubmitted= !!theirAnswers.submittedAt;

  const jackQ     = q.jackWroteForJordan;
  const jordanQ   = q.jordanWroteForJack;
  const bothWrote = !!(jackQ && jordanQ);
  const questionForMe  = bothWrote ? (user === 'jack' ? jordanQ : jackQ) : null;
  const questionIWrote = user === 'jack' ? jackQ : jordanQ;

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">${week.label}</h1>
          <p class="page-subtitle">${week.deadline.label} · ${fmtDate(week.deadline.date)}</p>
        </div>
        <a href="#/questions" class="btn btn-ghost">← Back</a>
      </div>

      ${questionForMe ? `
        <div class="card question-preview-card" style="border-left:3px solid var(--sky);background:var(--sky-pale);margin-bottom:16px">
          <div class="card-label">💬 ${cap(them)}'s question for you</div>
          <p class="question-text">"${questionForMe}"</p>
          ${upcoming ? `<p class="muted-sm">Think about this while reading — you'll answer it when the deadline arrives.</p>` : ''}
        </div>
      ` : !bothWrote && upcoming ? `
        <div class="card" style="background:var(--cream);border-color:var(--border);margin-bottom:16px;padding:14px 18px">
          ${(user === 'jack' ? jordanQ : jackQ) ? `
            <p class="muted-sm">⏳ ${cap(them)} wrote a question for you — it'll appear once you've both submitted yours.</p>
          ` : `
            <p class="muted-sm">${cap(them)} hasn't written your question for this week yet.</p>
          `}
        </div>
      ` : ''}

      ${!questionIWrote ? `
        <div class="card write-question-card" style="margin-bottom:16px">
          <div class="card-label">✍️ Write a question for ${cap(them)}</div>
          <p class="muted" style="margin-bottom:12px">Both questions are revealed together once you've each submitted one.</p>
          <form onsubmit="saveCustomQ(event,'${weekId}')">
            <textarea name="question" class="form-input form-textarea" required
              placeholder="What do you want ${cap(them)} to reflect on this week?"></textarea>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Save Question</button>
            </div>
          </form>
        </div>
      ` : bothWrote ? `
        <div class="card write-question-card written" style="margin-bottom:16px">
          <div class="card-label">✍️ Your question for ${cap(them)}</div>
          <p class="question-text">"${questionIWrote}"</p>
          <p class="muted-sm">Both questions are now revealed</p>
        </div>
      ` : `
        <div class="card write-question-card written waiting" style="margin-bottom:16px">
          <div class="card-label">✍️ Your question for ${cap(them)}</div>
          <p class="question-text">"${questionIWrote}"</p>
          <p class="muted-sm">⏳ Waiting for ${cap(them)} to write their question — questions reveal together</p>
        </div>
      `}

      ${upcoming ? `
        <div class="card upcoming-notice" style="margin-bottom:16px">
          <div class="upcoming-notice-inner">
            <div class="upcoming-icon">🏔️</div>
            <div>
              <h3>Keep reading</h3>
              <p>This period ends on ${fmtDate(week.deadline.date)}. Come back then to answer the discussion questions.</p>
            </div>
          </div>
        </div>

      ` : mySubmitted ? `
        <div class="card answers-card" style="margin-bottom:16px">
          <div class="card-label">Your Answers · ${fmtDate(myAnswers.submittedAt?.split('T')[0])}</div>
          <div class="answer-block">
            <div class="answer-q">What resonated with you?</div>
            <div class="answer-a">${myAnswers.resonated || '—'}</div>
          </div>
          <div class="answer-block">
            <div class="answer-q">What did you disagree with?</div>
            <div class="answer-a">${myAnswers.disagreed || '—'}</div>
          </div>
          ${questionForMe && myAnswers.custom ? `
            <div class="answer-block">
              <div class="answer-q">${cap(them)} asked: "${questionForMe}"</div>
              <div class="answer-a">${myAnswers.custom}</div>
            </div>` : ''}
        </div>

        ${theirSubmitted ? `
          <div class="card answers-card answers-other" style="margin-bottom:16px">
            <div class="card-label">${cap(them)}'s Answers · ${fmtDate(theirAnswers.submittedAt?.split('T')[0])}</div>
            <div class="answer-block">
              <div class="answer-q">What resonated with them?</div>
              <div class="answer-a">${theirAnswers.resonated || '—'}</div>
            </div>
            <div class="answer-block">
              <div class="answer-q">What did they disagree with?</div>
              <div class="answer-a">${theirAnswers.disagreed || '—'}</div>
            </div>
            ${questionIWrote && theirAnswers.custom ? `
              <div class="answer-block">
                <div class="answer-q">You asked: "${questionIWrote}"</div>
                <div class="answer-a">${theirAnswers.custom}</div>
              </div>` : ''}
          </div>
        ` : `
          <div class="card waiting-card">
            <p class="muted">Waiting for ${cap(them)} to submit their answers…</p>
          </div>`}

      ` : `
        ${theirSubmitted ? `
          <div class="card" style="background:var(--pine-pale);border-color:var(--pine);padding:12px 18px;margin-bottom:16px">
            <p class="muted-sm">${cap(them)} has already answered. Submit yours to see their responses.</p>
          </div>` : ''}

        <div class="card answer-form-card" style="margin-bottom:16px">
          <div class="card-label">Your Answers</div>
          <form onsubmit="submitAnswers(event,'${weekId}')">
            <div class="form-group">
              <label class="form-label question-label">What resonated with you this week? *</label>
              <textarea name="resonated" class="form-input form-textarea" required
                placeholder="Something that moved you, clicked, or stuck with you…"></textarea>
            </div>
            <div class="form-group">
              <label class="form-label question-label">What did you disagree with? *</label>
              <textarea name="disagreed" class="form-input form-textarea" required
                placeholder="Something that didn't sit right, felt off, or you'd push back on…"></textarea>
            </div>
            ${questionForMe ? `
              <div class="form-group">
                <label class="form-label question-label custom-q-label">${cap(them)} asks: "${questionForMe}" *</label>
                <textarea name="custom" class="form-input form-textarea" required
                  placeholder="Your answer…"></textarea>
              </div>` : ''}
            <div class="form-actions" style="flex-direction:column;align-items:flex-start;gap:8px">
              <p class="muted-sm">Once you submit, ${cap(them)} can read your answers after they submit theirs.</p>
              <button type="submit" class="btn btn-primary">Submit Answers</button>
            </div>
          </form>
        </div>`}

    </div>`;
}

async function saveCustomQ(e, weekId) {
  e.preventDefault();
  const user = DB.getUser();
  const book = DB.getActiveBook();
  const q    = DB.getQuestion(weekId) || blankQuestion(weekId, book.id);
  const text = Object.fromEntries(new FormData(e.target)).question.trim();
  if (!text) return;

  if (user === 'jack') q.jackWroteForJordan = text;
  else                 q.jordanWroteForJack = text;

  await DB.saveQuestion(q);
  navigate(`/questions/week/${weekId}`);
}

async function submitAnswers(e, weekId) {
  e.preventDefault();
  const user = DB.getUser();
  const book = DB.getActiveBook();
  const q    = DB.getQuestion(weekId) || blankQuestion(weekId, book.id);
  const d    = Object.fromEntries(new FormData(e.target));

  q.answers[user] = {
    resonated:   d.resonated.trim(),
    disagreed:   d.disagreed.trim(),
    custom:      d.custom?.trim() || null,
    submittedAt: new Date().toISOString(),
  };

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await DB.saveQuestion(q);
    navigate(`/questions/week/${weekId}`);
  } catch (err) {
    alert('Failed to save answers. Please try again.');
    btn.disabled = false;
  }
}

// ============================================================
// PAGE: NOTES
// ============================================================
function pageNotes() {
  const user  = DB.getUser();
  const notes = DB.getNotes();

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Notes</h1>
          <p class="page-subtitle">Thoughts, reactions, and page references</p>
        </div>
      </div>

      <div class="card note-add-card">
        <div class="card-label">✍️ Add a note</div>
        <form onsubmit="addNote(event)" class="note-form">
          <textarea name="text" class="form-input form-textarea" required
            placeholder="What caught your attention?"></textarea>
          <div class="note-form-footer">
            <div class="note-page-field">
              <label class="form-label" style="margin-bottom:4px">Page</label>
              <input type="number" name="page" class="form-input note-page-input" placeholder="—" min="1">
            </div>
            <button type="submit" class="btn btn-primary">Add Note</button>
          </div>
        </form>
      </div>

      ${notes.length === 0 ? `
        <div class="empty-state" style="margin-top:24px">
          <div class="empty-icon">📝</div>
          <h3>No notes yet</h3>
          <p>Capture a thought while it's fresh — page numbers optional but useful for discussion.</p>
        </div>
      ` : `
        <div class="notes-feed">
          ${notes.map(n => `
            <div class="note-card card ${n.author === user ? 'note-mine' : 'note-theirs'}">
              <div class="note-meta">
                <span class="note-author">${cap(n.author)}</span>
                ${n.page ? `<span class="note-page">p. ${n.page}</span>` : ''}
                <span class="note-date muted">${fmtDate(n.createdAt.split('T')[0])}</span>
                ${n.author === user ? `
                  <button class="note-delete btn-ghost-sm" onclick="deleteNote('${n.id}')">✕</button>
                ` : ''}
              </div>
              <p class="note-text">${n.text}</p>
            </div>
          `).join('')}
        </div>
      `}
    </div>`;
}

async function addNote(e) {
  e.preventDefault();
  const book = DB.getActiveBook();
  const user = DB.getUser();
  const d    = Object.fromEntries(new FormData(e.target));
  const text = d.text.trim();
  if (!text) return;

  await DB.saveNote({
    id:        crypto.randomUUID(),
    bookId:    book?.id || null,
    author:    user,
    text,
    page:      d.page ? parseInt(d.page) : null,
    createdAt: new Date().toISOString(),
  });
  e.target.reset();
  navigate('/notes');
}

async function deleteNote(id) {
  await DB.deleteNote(id);
  navigate('/notes');
}

// ============================================================
// HELPER: NO BOOK STATE
// ============================================================
function noBookPage(title) {
  return `
    <div class="page">
      <div class="page-header"><div><h1 class="page-title">${title}</h1></div></div>
      <div class="empty-state">
        <p>Add a book first to use this section.</p>
        <a href="#/books/add" class="btn btn-primary">Add a Book</a>
      </div>
    </div>`;
}

// ============================================================
// INIT
// ============================================================
async function initApp() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { renderFull(pageLogin('login')); return; }

  const { data: account } = await sb.from('accounts').select('*').eq('id', session.user.id).single();
  if (!account) { renderFull(pageCompleteProfile()); return; }

  State.account = account;
  await loadData();
  handleRoute();
}

document.addEventListener('DOMContentLoaded', initApp);
