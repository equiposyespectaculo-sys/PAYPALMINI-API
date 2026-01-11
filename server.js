import express from 'express';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

// Render env vars:
// PAYPAL_CLIENT_ID
// PAYPAL_CLIENT_SECRET
// PAYPAL_BASE: https://api-m.sandbox.paypal.com (sandbox)  |  https://api-m.paypal.com (live)
// RETURN_URL / CANCEL_URL

const PORT = process.env.PORT || 3000;
const PAYPAL_BASE = process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com';

const RETURN_URL = process.env.RETURN_URL || 'https://example.com/ok';
const CANCEL_URL = process.env.CANCEL_URL || 'https://example.com/cancel';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function getAccessToken() {
  const clientId = requireEnv('PAYPAL_CLIENT_ID');
  const secret = requireEnv('PAYPAL_CLIENT_SECRET');

  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const r = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`PayPal token error: ${r.status} ${t}`);
  }
  const j = await r.json();
  return j.access_token;
}

function buildOrderBody({ presupuesto, amount, currency }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid amount');

  const cur = (currency || 'EUR').toUpperCase();

  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: String(presupuesto || 'PRESU'),
        amount: { currency_code: cur, value: value.toFixed(2) },
        description: `Señal reserva - Presupuesto ${presupuesto || ''}`.trim(),
      },
    ],
    application_context: {
      user_action: 'PAY_NOW',
      return_url: RETURN_URL,
      cancel_url: CANCEL_URL,
    },
  };
}

async function createOrder({ presupuesto, amount, currency }) {
  const token = await getAccessToken();
  const body = buildOrderBody({ presupuesto, amount, currency });

  const r = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal create order error: ${r.status} ${JSON.stringify(data)}`);

  const approve = (data.links || []).find((l) => l.rel === 'approve');
  return { order_id: data.id, approve_url: approve?.href || null };
}

// Health check
app.get('/', (_req, res) => res.send('OK'));

// JSON endpoint (para VBA/curl)
app.post('/create-deposit-order', async (req, res) => {
  try {
    const { presupuesto, amount, currency } = req.body || {};
    const out = await createOrder({ presupuesto, amount, currency });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// CLICKABLE endpoint (para PDF/hipervínculo)
app.get('/redirect', async (req, res) => {
  try {
    const presupuesto = req.query.presupuesto || 'PRESU';
    const amount = req.query.amount;
    const currency = req.query.currency || 'EUR';

    const out = await createOrder({ presupuesto, amount, currency });
    if (!out.approve_url) return res.status(500).send('No approve_url');

    res.redirect(302, out.approve_url);
  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
