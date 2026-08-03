const PAGE_SIZE = 25;
const BULLHORN_BASE = 'https://cls32.bullhornstaffing.com/BullhornSTAFFING/OpenWindow.cfm';
const bullhornUrl = (entity, id) => `${BULLHORN_BASE}?Entity=${entity}&id=${id}`;

const fmtMoney = (v) => (v || v === 0) ? Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : '—';
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const fmtDateTime = (v) => v ? new Date(v).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const bucketLabel = (b) => ({ '0-30': '0–30', '31-60': '31–60', '61-90': '61–90', '91+': '91+', 'no-activity': 'No activity' }[b] || b);

let dashboard = { bdms: [], accounts: [], proposals: [] };
let allStatuses = [];
let allStages = [];
let selectedBdms = new Set();
let selectedStatuses = new Set();
let selectedStages = new Set();

const accountsState = { bucket: 'all', letter: 'all', search: '', page: 1, dateFrom: '', dateTo: '' };
const proposalsState = {
  follow: 'all', bucket: 'all', letter: 'all', search: '', page: 1,
  dateFrom: '', dateTo: '', activityFrom: '', activityTo: '',
};

async function loadDashboard(force = false) {
  document.getElementById('lastUpdated').textContent = 'Loading live data from Bullhorn…';
  const data = await fetch(`/api/dashboard${force ? '?refresh=1' : ''}`).then((r) => r.json());
  dashboard = data;
  selectedBdms = new Set(data.bdms);
  allStatuses = [...new Set(data.accounts.map((a) => a.status).filter(Boolean))].sort();
  selectedStatuses = new Set(allStatuses);
  allStages = [...new Set(data.proposals.map((p) => p.dealStage).filter(Boolean))].sort();
  selectedStages = new Set(allStages);

  document.getElementById('lastUpdated').textContent = `Live data as of ${fmtDateTime(data.generatedAt)}`;

  buildBdmDropdown();
  buildStatusDropdown();
  buildStageDropdown();
  buildAzStrip();
  buildProposalsAzStrip();
  renderAccounts();
  renderProposals();
}

function buildBdmDropdown() {
  const list = document.getElementById('bdmCheckboxList');
  list.innerHTML = dashboard.bdms.map((name) => `
    <label><input type="checkbox" value="${name}" ${selectedBdms.has(name) ? 'checked' : ''}> ${name}</label>
  `).join('');
  list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedBdms.add(cb.value); else selectedBdms.delete(cb.value);
      updateBdmButtonLabel();
      accountsState.page = 1;
      proposalsState.page = 1;
      renderAccounts();
      renderProposals();
    });
  });
  updateBdmButtonLabel();
}

function updateBdmButtonLabel() {
  const btn = document.getElementById('bdmDropdownBtn');
  const n = selectedBdms.size;
  btn.innerHTML = (n === dashboard.bdms.length ? 'BDs: All' : n === 0 ? 'BDs: None' : `BDs: ${n} selected`) + ' <span class="caret">&#9662;</span>';
}

function buildStatusDropdown() {
  const list = document.getElementById('statusCheckboxList');
  list.innerHTML = allStatuses.map((s) => `
    <label><input type="checkbox" value="${s}" ${selectedStatuses.has(s) ? 'checked' : ''}> ${s}</label>
  `).join('');
  list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedStatuses.add(cb.value); else selectedStatuses.delete(cb.value);
      updateStatusButtonLabel();
      accountsState.page = 1;
      renderAccounts();
    });
  });
  updateStatusButtonLabel();
}

function updateStatusButtonLabel() {
  const btn = document.getElementById('statusDropdownBtn');
  const n = selectedStatuses.size;
  btn.innerHTML = (n === allStatuses.length ? 'Status: All' : n === 0 ? 'Status: None' : `Status: ${n} selected`) + ' <span class="caret">&#9662;</span>';
}

function buildStageDropdown() {
  const list = document.getElementById('stageCheckboxList');
  list.innerHTML = allStages.map((s) => `
    <label><input type="checkbox" value="${s}" ${selectedStages.has(s) ? 'checked' : ''}> ${s}</label>
  `).join('');
  list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedStages.add(cb.value); else selectedStages.delete(cb.value);
      updateStageButtonLabel();
      proposalsState.page = 1;
      renderProposals();
    });
  });
  updateStageButtonLabel();
}

function updateStageButtonLabel() {
  const btn = document.getElementById('stageDropdownBtn');
  const n = selectedStages.size;
  btn.innerHTML = (n === allStages.length ? 'Stage: All' : n === 0 ? 'Stage: None' : `Stage: ${n} selected`) + ' <span class="caret">&#9662;</span>';
}

function setupDropdown(btnId, panelId) {
  const btn = document.getElementById(btnId);
  const panel = document.getElementById(panelId);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.dropdown-panel').forEach((p) => { if (p !== panel) p.classList.add('hidden'); });
    panel.classList.toggle('hidden');
  });
  panel.querySelectorAll('.dropdown-panel-actions button').forEach((actionBtn) => {
    actionBtn.addEventListener('click', () => {
      const checkboxes = panel.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((cb) => { cb.checked = actionBtn.dataset.action === 'all'; cb.dispatchEvent(new Event('change')); });
    });
  });
}
document.addEventListener('click', () => document.querySelectorAll('.dropdown-panel').forEach((p) => p.classList.add('hidden')));
setupDropdown('bdmDropdownBtn', 'bdmDropdownPanel');
setupDropdown('statusDropdownBtn', 'statusDropdownPanel');
setupDropdown('stageDropdownBtn', 'stageDropdownPanel');

document.getElementById('refreshBtn').addEventListener('click', () => loadDashboard(true));

function buildAzStrip() {
  const present = new Set(dashboard.accounts.map((a) => (a.companyName || '?').trim()[0]?.toUpperCase()));
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

function buildProposalsAzStrip() {
  const present = new Set(dashboard.proposals.map((p) => (p.companyName || '?').trim()[0]?.toUpperCase()));
  const strip = document.getElementById('proposalsAzStrip');
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
      proposalsState.letter = btn.dataset.letter;
      proposalsState.page = 1;
      renderProposals();
    });
  });
}

function inDateRange(dateStr, from, to) {
  if (!from && !to) return true;
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1) return false;
  return true;
}

function getFilteredAccounts() {
  return dashboard.accounts.filter((a) => {
    if (!selectedBdms.has(a.bdm)) return false;
    if (!selectedStatuses.has(a.status)) return false;
    if (accountsState.bucket !== 'all' && a.bucket !== accountsState.bucket) return false;
    if (accountsState.letter !== 'all' && (a.companyName || '?').trim()[0]?.toUpperCase() !== accountsState.letter) return false;
    if (accountsState.search && !(a.companyName || '').toLowerCase().includes(accountsState.search.toLowerCase())) return false;
    if (!inDateRange(a.lastActivity, accountsState.dateFrom, accountsState.dateTo)) return false;
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
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No accounts match this filter.</td></tr>';
  } else {
    tbody.innerHTML = pageRows.map((a) => `
      <tr class="clickable" data-id="${a.id}">
        <td>${a.companyName || '—'} <a href="${bullhornUrl('ClientCorporation', a.id)}" class="bh-link" title="Open in Bullhorn" onclick="event.stopPropagation()">&#8599;</a></td>
        <td>${a.bdm || '—'}</td>
        <td>${a.status || '—'}</td>
        <td>${a.leadSource || '—'}</td>
        <td class="num">${fmtDate(a.lastActivity)}</td>
        <td class="num">${a.daysSinceActivity === null ? '—' : a.daysSinceActivity}</td>
        <td><span class="badge b-${a.bucket}">${bucketLabel(a.bucket)}</span></td>
        <td class="num">${a.placementsTotal}</td>
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
document.getElementById('accountsDateFrom').addEventListener('change', (e) => { accountsState.dateFrom = e.target.value; accountsState.page = 1; renderAccounts(); });
document.getElementById('accountsDateTo').addEventListener('change', (e) => { accountsState.dateTo = e.target.value; accountsState.page = 1; renderAccounts(); });
document.getElementById('accountsDateClear').addEventListener('click', () => {
  accountsState.dateFrom = ''; accountsState.dateTo = '';
  document.getElementById('accountsDateFrom').value = '';
  document.getElementById('accountsDateTo').value = '';
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
            <span class="muted">${c.lastNote ? `Last note: <span class="num">${fmtDate(c.lastNote)}</span>` : 'No notes'}<br><a href="${bullhornUrl('ClientContact', c.id)}" class="bh-link">Open in Bullhorn &#8599;</a></span>
          </li>`).join('')}</ul>`
      : '<div class="mini-empty">No contacts on file.</div>';

    const oppsHtml = detail.opportunities.length
      ? `<ul class="mini-list">${detail.opportunities.map((o) => `
          <li>
            <span>${o.title || 'Untitled opportunity'}<br><span class="muted">${o.dealStage}</span></span>
            <span class="muted"><span class="num">${fmtMoney(o.dealValue)}<br>${fmtDate(o.dateLastModified)}</span><br><a href="${bullhornUrl('Opportunity', o.id)}" class="bh-link">Open in Bullhorn &#8599;</a></span>
          </li>`).join('')}</ul>`
      : '<div class="mini-empty">No opportunities on file.</div>';

    body.innerHTML = `
      <h2>${detail.companyName} <a href="${bullhornUrl('ClientCorporation', detail.id)}" class="bh-link" title="Open in Bullhorn">&#8599;</a></h2>
      <div class="modal-sub">${detail.status || '—'}${detail.leadSource ? ` · ${detail.leadSource}` : ''}${detail.website ? ` · ${detail.website}` : ''}${detail.phone ? ` · ${detail.phone}` : ''}</div>
      <p class="note">Real note/email content isn't reliably retrievable through this data connection (confirmed against your live Bullhorn — the notes exist there, just not queryable this way). Use "Open in Bullhorn" to see full note and email history for an account or contact.</p>
      <div class="stat-row">
        <div class="stat"><div class="stat-label">Last Activity</div><div class="stat-value num">${fmtDate(detail.lastActivity)}</div></div>
        <div class="stat"><div class="stat-label">Bucket</div><div class="stat-value"><span class="badge b-${detail.bucket}">${bucketLabel(detail.bucket)}</span></div></div>
        <div class="stat"><div class="stat-label">Placements Total</div><div class="stat-value num">${detail.placementsTotal}</div></div>
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

function getFilteredProposals() {
  return dashboard.proposals.filter((p) => {
    if (!selectedBdms.has(p.bdm)) return false;
    if (!selectedStages.has(p.dealStage)) return false;
    if (proposalsState.follow === 'pending' && !p.needsFollowUp) return false;
    if (proposalsState.bucket !== 'all' && p.bucket !== proposalsState.bucket) return false;
    if (proposalsState.letter !== 'all' && (p.companyName || '?').trim()[0]?.toUpperCase() !== proposalsState.letter) return false;
    if (proposalsState.search && !(p.companyName || '').toLowerCase().includes(proposalsState.search.toLowerCase())) return false;
    if (!inDateRange(p.contractSentDate, proposalsState.dateFrom, proposalsState.dateTo)) return false;
    if (!inDateRange(p.lastActivity, proposalsState.activityFrom, proposalsState.activityTo)) return false;
    return true;
  });
}

function renderProposals() {
  const filtered = getFilteredProposals();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  proposalsState.page = Math.min(proposalsState.page, totalPages);
  const start = (proposalsState.page - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);

  const tbody = document.querySelector('#proposalsTable tbody');
  document.getElementById('proposalsCount').textContent = `${filtered.length} proposal${filtered.length === 1 ? '' : 's'}`;

  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="10">No proposals match this filter.</td></tr>';
  } else {
    tbody.innerHTML = rows.map((p) => `
      <tr class="clickable" data-id="${p.companyId}">
        <td>${p.companyName || '—'}</td>
        <td>${p.bdm || '—'}</td>
        <td>${p.title || '—'} <a href="${bullhornUrl('Opportunity', p.id)}" class="bh-link" title="Open in Bullhorn" onclick="event.stopPropagation()">&#8599;</a></td>
        <td class="num">${fmtMoney(p.dealValue)}</td>
        <td>${p.dealStage}</td>
        <td class="num">${fmtDate(p.contractSentDate)}</td>
        <td class="num">${fmtDate(p.lastActivity)}</td>
        <td><span class="badge b-${p.bucket}">${bucketLabel(p.bucket)}</span></td>
        <td class="num">${fmtDate(p.expectedCloseDate)}</td>
        <td>${p.needsFollowUp ? '<span class="followup-badge">Follow up</span>' : ''}</td>
      </tr>
    `).join('');
    tbody.querySelectorAll('tr.clickable').forEach((row) => {
      row.addEventListener('click', () => openAccountModal(row.dataset.id));
    });
  }

  renderProposalsPagination(totalPages);
}

function renderProposalsPagination(totalPages) {
  const el = document.getElementById('proposalsPagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button id="proposalsPrevPage" ${proposalsState.page === 1 ? 'disabled' : ''}>&larr; Prev</button>
    <span>Page ${proposalsState.page} of ${totalPages}</span>
    <button id="proposalsNextPage" ${proposalsState.page === totalPages ? 'disabled' : ''}>Next &rarr;</button>
  `;
  document.getElementById('proposalsPrevPage')?.addEventListener('click', () => { proposalsState.page--; renderProposals(); });
  document.getElementById('proposalsNextPage')?.addEventListener('click', () => { proposalsState.page++; renderProposals(); });
}

document.getElementById('proposalSearch').addEventListener('input', (e) => {
  proposalsState.search = e.target.value;
  proposalsState.page = 1;
  renderProposals();
});
document.getElementById('proposalsDateFrom').addEventListener('change', (e) => { proposalsState.dateFrom = e.target.value; proposalsState.page = 1; renderProposals(); });
document.getElementById('proposalsDateTo').addEventListener('change', (e) => { proposalsState.dateTo = e.target.value; proposalsState.page = 1; renderProposals(); });
document.getElementById('proposalsDateClear').addEventListener('click', () => {
  proposalsState.dateFrom = ''; proposalsState.dateTo = '';
  document.getElementById('proposalsDateFrom').value = '';
  document.getElementById('proposalsDateTo').value = '';
  renderProposals();
});
document.getElementById('proposalsActivityFrom').addEventListener('change', (e) => { proposalsState.activityFrom = e.target.value; proposalsState.page = 1; renderProposals(); });
document.getElementById('proposalsActivityTo').addEventListener('change', (e) => { proposalsState.activityTo = e.target.value; proposalsState.page = 1; renderProposals(); });
document.getElementById('proposalsActivityClear').addEventListener('click', () => {
  proposalsState.activityFrom = ''; proposalsState.activityTo = '';
  document.getElementById('proposalsActivityFrom').value = '';
  document.getElementById('proposalsActivityTo').value = '';
  renderProposals();
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
});

document.querySelectorAll('#tab-accounts .filter-row .chip[data-bucket]').forEach((chip) => {
  chip.addEventListener('click', () => {
    chip.closest('.filter-row').querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    accountsState.bucket = chip.dataset.bucket;
    accountsState.page = 1;
    renderAccounts();
  });
});

document.querySelectorAll('#tab-proposals .chip[data-pbucket]').forEach((chip) => {
  chip.addEventListener('click', () => {
    chip.closest('.filter-row').querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    proposalsState.bucket = chip.dataset.pbucket;
    proposalsState.page = 1;
    renderProposals();
  });
});

document.querySelectorAll('#tab-proposals .chip[data-follow]').forEach((chip) => {
  chip.addEventListener('click', () => {
    chip.closest('.filter-row').querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    proposalsState.follow = chip.dataset.follow;
    proposalsState.page = 1;
    renderProposals();
  });
});

loadDashboard();
