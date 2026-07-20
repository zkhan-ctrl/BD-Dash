const { runQuery, esc, TABLE } = require('./cdata');

// Deal stages that count as a contract/proposal having been sent (per BD process,
// "contract sent" is treated as "proposal sent"). "Contract Sent" itself is the
// stage that still needs BD follow-up; the rest are past it.
const SENT_STAGES = ['Contract Sent', 'Contract Signed-Intake Call Needed', 'Converted', 'Closed-Won'];
const OPEN_SENT_STAGE = 'Contract Sent';

// CData/Bullhorn handles a few hundred IDs per IN-list fine; chunk defensively
// for BDMs with very large books of business.
const ID_CHUNK_SIZE = 400;

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

async function getBdmList() {
  const rows = await runQuery(
    `SELECT DISTINCT BusinessDevelopmentManager FROM ${TABLE}.ClientCorporation`
  );
  return rows
    .map((r) => r.BusinessDevelopmentManager)
    .filter((name) => name && /[a-zA-Z]{2,}\s+[a-zA-Z]{2,}/.test(name)) // drop blanks / bare IDs
    .sort((a, b) => a.localeCompare(b));
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

async function getAccountsForBdm(bdm) {
  const companies = await runQuery(
    `SELECT ID, CompanyName, Status, DateLastModified, BDSource, LeadSource
     FROM ${TABLE}.ClientCorporation
     WHERE BusinessDevelopmentManager = '${esc(bdm)}'`
  );
  const ids = companies.map((c) => c.ID);

  const [oppActivity, placementCounts, noteActivity] = await Promise.all([
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
    runForIds(ids, (batch) => `
      SELECT Companyid AS Companyid, MAX(LastNote) AS LastNote
      FROM ${TABLE}.ClientContact
      WHERE Companyid IN (${batch})
      GROUP BY Companyid
    `),
  ]);

  const oppByCompany = new Map(oppActivity.map((r) => [String(r.Companyid), r.LastOppActivity]));
  const placementsByCompany = new Map(placementCounts.map((r) => [String(r.Companyid), Number(r.PlacementCount) || 0]));
  const noteByCompany = new Map(noteActivity.map((r) => [String(r.Companyid), r.LastNote]));

  const accounts = companies.map((c) => {
    const lastActivity = latestOf(c.DateLastModified, oppByCompany.get(String(c.ID)), noteByCompany.get(String(c.ID)));
    const days = daysSince(lastActivity);
    return {
      id: c.ID,
      companyName: c.CompanyName,
      status: c.Status,
      leadSource: c.LeadSource || c.BDSource || null,
      lastActivity,
      daysSinceActivity: days,
      bucket: bucketFor(days),
      placementsTotal: placementsByCompany.get(String(c.ID)) || 0,
    };
  });

  accounts.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));
  return accounts;
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

async function getProposalsForBdm(bdm) {
  const stageList = SENT_STAGES.map((s) => `'${esc(s)}'`).join(',');
  const rows = await runQuery(
    `SELECT o.ID AS ID, o.Title AS Title, o.DealStage AS DealStage, o.DealValue AS DealValue,
            o.ExpectedCloseDate AS ExpectedCloseDate, o.DateLastModified AS DateLastModified,
            cc.CompanyName AS CompanyName
     FROM ${TABLE}.Opportunity o
     JOIN ${TABLE}.ClientCorporation cc ON cc.ID = o.Companyid
     WHERE cc.BusinessDevelopmentManager = '${esc(bdm)}' AND o.DealStage IN (${stageList})`
  );

  return rows
    .map((r) => ({
      id: r.ID,
      title: r.Title,
      companyName: r.CompanyName,
      dealStage: r.DealStage,
      dealValue: r.DealValue,
      contractSentDate: r.DateLastModified,
      expectedCloseDate: r.ExpectedCloseDate,
      needsFollowUp: r.DealStage === OPEN_SENT_STAGE,
    }))
    .sort((a, b) => new Date(b.contractSentDate) - new Date(a.contractSentDate));
}

module.exports = { getBdmList, getAccountsForBdm, getAccountDetail, getProposalsForBdm };
