require('dotenv').config();
const express = require('express');
const { getBdmList, getAccountsForBdm, getAccountDetail, getProposalsForBdm } = require('./src/queries');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/api/bdms', async (req, res) => {
  try {
    res.json(await getBdmList());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/accounts', async (req, res) => {
  const { bdm } = req.query;
  if (!bdm) return res.status(400).json({ error: 'bdm query param required' });
  try {
    res.json(await getAccountsForBdm(bdm));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/accounts/:id', async (req, res) => {
  try {
    const detail = await getAccountDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Account not found' });
    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/proposals', async (req, res) => {
  const { bdm } = req.query;
  if (!bdm) return res.status(400).json({ error: 'bdm query param required' });
  try {
    res.json(await getProposalsForBdm(bdm));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Dashboard running at http://localhost:${PORT}`));
