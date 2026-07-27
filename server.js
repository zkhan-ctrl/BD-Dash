require('dotenv').config();
const express = require('express');
const { getDashboardData, getAccountDetail } = require('./src/queries');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/api/dashboard', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    res.json(await getDashboardData({ force }));
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

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  getDashboardData().catch((err) => console.error('Cache warm-up failed:', err.message));
});
