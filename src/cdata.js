const axios = require('axios');

const CDATA_URL = 'https://cloud.cdata.com/api/query';
const CONNECTION = process.env.CDATA_CONNECTION || 'BullhornCRM1';
const TABLE = `${CONNECTION}.BullhornCRM`;

function authHeader() {
  const token = Buffer.from(`${process.env.CDATA_USER}:${process.env.CDATA_PAT}`).toString('base64');
  return `Basic ${token}`;
}

// This connector does NOT support standard SQL '' apostrophe-escaping (it's translated
// to Bullhorn's own query language underneath and errors on it). Values containing an
// apostrophe are matched with LIKE, substituting '_' (matches exactly one char) for the
// apostrophe, which gives an exact-length match without ever emitting a raw quote.
function literal(value) {
  const str = String(value);
  if (str.includes("'")) {
    return { op: 'LIKE', value: str.replace(/'/g, '_') };
  }
  return { op: '=', value: str };
}

function esc(value) {
  // Only safe for values guaranteed not to contain an apostrophe (e.g. enum-like stage names).
  return String(value).replace(/'/g, '');
}

// Builds `(column = 'a' OR column LIKE 'b_c' OR ...)` across a list of values,
// working around the apostrophe-escaping limitation above.
function matchAny(column, values) {
  const clauses = values.map((v) => {
    const { op, value } = literal(v);
    return `${column} ${op} '${value}'`;
  });
  return `(${clauses.join(' OR ')})`;
}

async function runQuery(query) {
  const res = await axios.post(
    CDATA_URL,
    { query, connection: CONNECTION },
    {
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 60000,
    }
  );

  if (res.data.error) {
    throw new Error(res.data.error.message || 'CData query failed');
  }

  const result = res.data.results?.[0];
  if (!result) return [];

  const columns = result.schema.map((c) => c.columnLabel);
  return result.rows.map((row) => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

module.exports = { runQuery, esc, matchAny, TABLE };
