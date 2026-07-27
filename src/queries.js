const { runQuery, matchAny, esc, TABLE } = require('./cdata');

const ALLOWED_BDMS = [
  'Neal Duncan',
  "Dan O'Connor",
  'Matt May',
  'Matt Fuhrman',
  'Charles Ishee',
  'Ashlea Landrum',
];

// Deal stages that count as a contract/proposal having been sent (per BD process,
// "contract sent" is treated as "proposal sent"). "Contract Sent" itself is the
// stage that still needs BD follow-up; the rest are past it.
const SENT_STAGES = ['Contract Sent', 'Contract Signed-Intake Call Needed', 'Converted', 'Closed-Won'];
const OPEN_SENT_STAGE = 'Contract Sent';

// CData/Bullhorn handles a few hundred IDs per IN-list fine; chunk defensively.
const ID_CHUNK_SIZE = 400;
const CACHE_TTL_MS = 15 * 60 * 1000;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function runForIds(ids, buildSql) {
  if (!ids.length) return [];
  const results = await Promise.all(
    chunk(ids, ID_CHUNK_SIZE).map((batch) => runQuery(buildSql(batch.join(','))))
  );
  return results.flat();
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const diffMs = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function bucketFor(days) {
  if (days === null) return 'no-activity';
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '91+';
}

function latestOf(...dates) {
  const ms = dates.filter(Boolean).map((d) => new Date(d).getTime());
  return ms.length ? new Date(Math.max(...ms)).toISOString() : null;
}

let cache = { data: null, expiresAt: 0 };

async function getDashboardData({ force = false } = {}) {
  if (!force && cache.data && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  const bdmFilter = matchAny('BusinessDevelopmentManager', ALLOWED_BDMS);

  const companies = await runQuery(
    `SELECT ID, CompanyName, Status, BusinessDevelopmentManager, DateLastModified, BDSource, LeadSource
     FROM ${TABLE}.ClientCorporation
     WHERE ${bdmFilter}`
  );
  const ids = companies.map((c) => c.ID);

  const [oppActivity, placementCounts, proposalRows] = await Promise.all([
    runForIds(ids, (batch) => `
      SELECT Companyid AS Companyid, MAX(DateLastModified) AS LastOppActivity
      FROM ${TABLE}.Opportunity
      WHERE Companyid IN (${batch})
      GROUP BY Companyid
    `),
    runForIds(ids, (batch) => `
      SELECT Companyid AS Companyid, COUNT(*) AS PlacementCount
      FROM ${TABLE}.Placement
      WHERE Companyid IN (${batch})
      GROUP BY Companyid
    `),
    runQuery(`
      SELECT o.ID AS ID, o.Title AS Title, o.DealStage AS DealStage, o.DealValue AS DealValue,
             o.ExpectedCloseDate AS ExpectedCloseDate, o.DateLastModified AS DateLastModified,
             o.Companyid AS Companyid, cc.CompanyName AS CompanyName, cc.BusinessDevelopmentManager AS Bdm
      FROM ${TABLE}.Opportunity o
      JOIN ${TABLE}.ClientCorporation cc ON cc.ID = o.Companyid
      WHERE ${bdmFilter.replace(/BusinessDevelopmentManager/g, 'cc.BusinessDevelopmentManager')}
        AND o.DealStage IN (${SENT_STAGES.map((s) => `'${esc(s)}'`).join(',')})
    `),
  ]);

  const oppByCompany = new Map(oppActivity.map((r) => [String(r.Companyid), r.LastOppActivity]));
  const placementsByCompany = new Map(placementCounts.map((r) => [String(r.Companyid), Number(r.PlacementCount) || 0]));

  const activityByCompany = new Map();
  const accounts = companies.map((c) => {
    const lastActivity = latestOf(c.DateLastModified, oppByCompany.get(String(c.ID)));
    const days = daysSince(lastActivity);
    const bucket = bucketFor(days);
    activityByCompany.set(String(c.ID), { lastActivity, days, bucket });
    return {
      id: c.ID,
      companyName: c.CompanyName,
      bdm: c.BusinessDevelopmentManager,
      status: c.Status,
      leadSource: c.LeadSource || c.BDSource || null,
      lastActivity,
      daysSinceActivity: days,
      bucket,
      placementsTotal: placementsByCompany.get(String(c.ID)) || 0,
    };
  });
  accounts.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));

  const proposals = proposalRows
    .map((r) => {
      const activity = activityByCompany.get(String(r.Companyid)) || {};
      return {
        id: r.ID,
        title: r.Title,
        companyId: r.Companyid,
        companyName: r.CompanyName,
        bdm: r.Bdm,
        dealStage: r.DealStage,
        dealValue: r.DealValue,
        contractSentDate: r.DateLastModified,
        expectedCloseDate: r.ExpectedCloseDate,
        needsFollowUp: (r.DealStage || '').toLowerCase() === OPEN_SENT_STAGE.toLowerCase(),
        lastActivity: activity.lastActivity || null,
        daysSinceActivity: activity.days ?? null,
        bucket: activity.bucket || 'no-activity',
      };
    })
    .sort((a, b) => new Date(b.contractSentDate) - new Date(a.contractSentDate));

  const data = { bdms: ALLOWED_BDMS, accounts, proposals, generatedAt: new Date().toISOString() };
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

async function getAccountDetail(companyId) {
  const [companyRows, contacts, opportunities, placementRows] = await Promise.all([
    runQuery(`
      SELECT ID, CompanyName, Status, LeadSource, BDSource, DateLastModified, CompanyWebsite, MainPhone
      FROM ${TABLE}.ClientCorporation
      WHERE ID = ${Number(companyId)}
    `),
    runQuery(`
      SELECT ID, FirstName, LastName, Name, Email1, DirectPhone, Title, LastNote
      FROM ${TABLE}.ClientContact
      WHERE Companyid = ${Number(companyId)}
    `),
    runQuery(`
      SELECT ID, Title, DealStage, DealValue, DateLastModified
      FROM ${TABLE}.Opportunity
      WHERE Companyid = ${Number(companyId)}
    `),
    runQuery(`
      SELECT COUNT(*) AS PlacementCount
      FROM ${TABLE}.Placement
      WHERE Companyid = ${Number(companyId)}
    `),
  ]);

  const company = companyRows[0];
  if (!company) return null;

  const oppLastActivity = opportunities.length
    ? latestOf(...opportunities.map((o) => o.DateLastModified))
    : null;
  const noteLastActivity = contacts.length ? latestOf(...contacts.map((c) => c.LastNote)) : null;
  const lastActivity = latestOf(company.DateLastModified, oppLastActivity, noteLastActivity);
  const days = daysSince(lastActivity);

  return {
    id: company.ID,
    companyName: company.CompanyName,
    status: company.Status,
    leadSource: company.LeadSource || company.BDSource || null,
    website: company.CompanyWebsite || null,
    phone: company.MainPhone || null,
    lastActivity,
    daysSinceActivity: days,
    bucket: bucketFor(days),
    placementsTotal: Number(placementRows[0]?.PlacementCount) || 0,
    contacts: contacts
      .map((c) => ({
        id: c.ID,
        name: [c.FirstName, c.LastName].filter(Boolean).join(' ') || c.Name || 'Unnamed contact',
        title: c.Title || null,
        email: c.Email1 || null,
        phone: c.DirectPhone || null,
        lastNote: c.LastNote || null,
      }))
      .sort((a, b) => new Date(b.lastNote || 0) - new Date(a.lastNote || 0)),
    opportunities: opportunities
      .map((o) => ({
        id: o.ID,
        title: o.Title,
        dealStage: o.DealStage,
        dealValue: o.DealValue,
        dateLastModified: o.DateLastModified,
      }))
      .sort((a, b) => new Date(b.dateLastModified || 0) - new Date(a.dateLastModified || 0)),
  };
}

module.exports = { ALLOWED_BDMS, getDashboardData, getAccountDetail };
