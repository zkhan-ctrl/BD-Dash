const params = new URLSearchParams(location.search);
const bdmFromUrl = params.get('bdm');
const PAGE_SIZE = 25;

const fmtMoney = (v) => (v || v === 0) ? Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—';
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const bucketLabel = (b) => ({ '0-30': '0–30', '31-60': '31–60', '61-90': '61–90', '91+': '91+', 'no-activity': 'No activity' }[b] || b);

async function loadBdms() {
  const select = document.getElementById('bdmSelect');
  const goBtn = document.getElementById('goBtn');
  try {
    const bdms = await fetch('/api/bdms').then((r) => r.json());
    select.innerHTML = '<option value="">Select your name…</option>' +
      bdms.map((name) => `<option value="${name}">${name}</option>`).join('');
    if (bdmFromUrl && bdms.includes(bdmFromUrl)) {
      select.value = bdmFromUrl;
      goBtn.disabled = false;
      showDashboard(bdmFromUrl);
    }
  } catch (err) {
    select.innerHTML = '<option value="">Failed to load BDMs</option>';
    console.error(err);
  }
  select.addEventListener('change', () => { goBtn.disabled = !select.value; });
  goBtn.addEventListener('click', () => {
    if (select.value) {
      history.pushState({}, '', `/?bdm=${encodeURIComponent(select.value)}`);
      showDashboard(select.value);
    }
  });
}

let accountsData = [];
let proposalsData = [];
const accountsState = { bucket: 'all', letter: 'all', search: '', page: 1 };

async function showDashboard(bdm) {
  document.getElementById('picker').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('bdmName').textContent = bdm;

  const [accounts, proposals] = await Promise.all([
    fetch(`/api/accounts?bdm=${encodeURIComponent(bdm)}`).then((r) => r.json()),
    fetch(`/api/proposals?bdm=${encodeURIComponent(bdm)}`).then((r) => r.json()),
  ]);
  accountsData = accounts;
  proposalsData = proposals;
  buildAzStrip();
  renderAccounts();
  renderProposals('all');
}

function buildAzStrip() {
  const present = new Set(accountsData.map((a) => (a.companyName || '?').trim()[0]?.toUpperCase()));
  const strip = document.getElementById('azStrip');
  const letters = ['ALL', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
  strip.innerHTML = letters.map((l) => {
    const val = l === 'ALL' ? 'all' : l;
    const disabled = l !== 'ALL' && !present.has(l);
    return `<button class="az-btn ${val === 'all' ? 'active' : ''}" data-letter="${val}" ${disabled ? 'disabled' : ''}>${l === 'ALL' ? 'All' : l}</button>`;
  }).join('');
  strip.querySelectorAll('.az-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      strip.querySelectorAll('.az-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      accountsState.letter = btn.dataset.letter;
      accountsState.page = 1;
      renderAccounts();
    });
  });
}

function getFilteredAccounts() {
  return accountsData.filter((a) => {
    if (accountsState.bucket !== 'all' && a.bucket !== accountsState.bucket) return false;
    if (accountsState.letter !== 'all' && (a.companyName || '?').trim()[0]?.toUpperCase() !== accountsState.letter) return false;
    if (accountsState.search && !(a.companyName || '').toLowerCase().includes(accountsState.search.toLowerCase())) return false;
    return true;
  });
}

function renderAccounts() {
  const filtered = getFilteredAccounts();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  accountsState.page = Math.min(accountsState.page, totalPages);
  const start = (accountsState.page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  document.getElementById('accountsCount').textContent = `${filtered.length} account${filtered.length === 1 ? '' : 's'}`;
  const tbody = document.querySelector('#accountsTable tbody');

  if (!pageRows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No accounts match this filter.</td></tr>';
  } else {
    tbody.innerHTML = pageRows.map((a) => `
      <tr class="clickable" data-id="${a.id}">
        <td>${a.companyName || '—'}</td>
        <td>${a.status || '—'}</td>
        <td>${a.leadSource || '—'}</td>
        <td>${fmtDate(a.lastActivity)}</td>
        <td>${a.daysSinceActivity === null ? '—' : a.daysSinceActivity}</td>
        <td><span class="badge b-${a.bucket}">${bucketLabel(a.bucket)}</span></td>
        <td>${a.placementsTotal}</td>
      </tr>
    `).join('');
    tbody.querySelectorAll('tr.clickable').forEach((row) => {
      row.addEventListener('click', () => openAccountModal(row.dataset.id));
    });
  }

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const el = document.getElementById('accountsPagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button id="prevPage" ${accountsState.page === 1 ? 'disabled' : ''}>&larr; Prev</button>
    <span>Page ${accountsState.page} of ${totalPages}</span>
    <button id="nextPage" ${accountsState.page === totalPages ? 'disabled' : ''}>Next &rarr;</button>
  `;
  document.getElementById('prevPage')?.addEventListener('click', () => { accountsState.page--; renderAccounts(); });
  document.getElementById('nextPage')?.addEventListener('click', () => { accountsState.page++; renderAccounts(); });
}

document.getElementById('accountSearch').addEventListener('input', (e) => {
  accountsState.search = e.target.value;
  accountsState.page = 1;
  renderAccounts();
});

async function openAccountModal(id) {
  const overlay = document.getElementById('modalOverlay');
  const body = document.getElementById('modalBody');
  overlay.classList.remove('hidden');
  body.innerHTML = 'Loading…';

  try {
    const detail = await fetch(`/api/accounts/${id}`).then((r) => r.json());
    if (detail.error) throw new Error(detail.error);

    const contactsHtml = detail.contacts.length
      ? `<ul class="mini-list">${detail.contacts.map((c) => `
          <li>
            <span>${c.name}${c.title ? ` — ${c.title}` : ''}${c.email ? `<br><span class="muted">${c.email}</span>` : ''}</span>
            <span class="muted">${c.lastNote ? `Last note: ${fmtDate(c.lastNote)}` : 'No notes'}</span>
          </li>`).join('')}</ul>`
      : '<div class="mini-empty">No contacts on file.</div>';

    const oppsHtml = detail.opportunities.length
      ? `<ul class="mini-list">${detail.opportunities.map((o) => `
          <li>
            <span>${o.title || 'Untitled opportunity'}<br><span class="muted">${o.dealStage}</span></span>
            <span class="muted">${fmtMoney(o.dealValue)}<br>${fmtDate(o.dateLastModified)}</span>
          </li>`).join('')}</ul>`
      : '<div class="mini-empty">No opportunities on file.</div>';

    body.innerHTML = `
      <h2>${detail.companyName}</h2>
      <div class="modal-sub">${detail.status || '—'}${detail.leadSource ? ` · ${detail.leadSource}` : ''}${detail.website ? ` · ${detail.website}` : ''}${detail.phone ? ` · ${detail.phone}` : ''}</div>
      <div class="stat-row">
        <div class="stat"><div class="stat-label">Last Activity</div><div class="stat-value">${fmtDate(detail.lastActivity)}</div></div>
        <div class="stat"><div class="stat-label">Bucket</div><div class="stat-value"><span class="badge b-${detail.bucket}">${bucketLabel(detail.bucket)}</span></div></div>
        <div class="stat"><div class="stat-label">Placements Total</div><div class="stat-value">${detail.placementsTotal}</div></div>
      </div>
      <h3>Contacts (${detail.contacts.length})</h3>
      ${contactsHtml}
      <h3>Opportunities (${detail.opportunities.length})</h3>
      ${oppsHtml}
    `;
  } catch (err) {
    body.innerHTML = `<p class="mini-empty">Failed to load account: ${err.message}</p>`;
  }
}

document.getElementById('modalClose').addEventListener('click', () => {
  document.getElementById('modalOverlay').classList.add('hidden');
});
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') document.getElementById('modalOverlay').classList.add('hidden');
});

function renderProposals(followFilter) {
  const rows = followFilter === 'pending' ? proposalsData.filter((p) => p.needsFollowUp) : proposalsData;
  const tbody = document.querySelector('#proposalsTable tbody');
  document.getElementById('proposalsCount').textContent = `${rows.length} proposal${rows.length === 1 ? '' : 's'}`;

  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No proposals in this range.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((p) => `
    <tr>
      <td>${p.companyName || '—'}</td>
      <td>${p.title || '—'}</td>
      <td>${fmtMoney(p.dealValue)}</td>
      <td>${p.dealStage}</td>
      <td>${fmtDate(p.contractSentDate)}</td>
      <td>${fmtDate(p.expectedCloseDate)}</td>
      <td>${p.needsFollowUp ? '<span class="followup-badge">Follow up</span>' : ''}</td>
    </tr>
  `).join('');
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
});

document.querySelectorAll('#tab-accounts .filter-row .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#tab-accounts .filter-row .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    accountsState.bucket = chip.dataset.bucket;
    accountsState.page = 1;
    renderAccounts();
  });
});

document.querySelectorAll('#tab-proposals .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#tab-proposals .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    renderProposals(chip.dataset.follow);
  });
});

loadBdms();
