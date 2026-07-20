const axios = require('axios');

const CDATA_URL = 'https://cloud.cdata.com/api/query';
const CONNECTION = process.env.CDATA_CONNECTION || 'BullhornCRM1';
const TABLE = `${CONNECTION}.BullhornCRM`;

function authHeader() {
  const token = Buffer.from(`${process.env.CDATA_USER}:${process.env.CDATA_PAT}`).toString('base64');
  return `Basic ${token}`;
}

// Single-quoted SQL string literal escape.
function esc(value) {
  return String(value).replace(/'/g, "''");
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

module.exports = { runQuery, esc, TABLE };
