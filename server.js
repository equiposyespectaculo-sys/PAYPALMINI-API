import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// PayPal configuration (Sandbox by default)
const PAYPAL_BASE = process.env.PAYPAL_BASE || "https://api-m.sandbox.paypal.com";
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;

const RETURN_URL = process.env.RETURN_URL;   // e.g. https://your-service.onrender.com/return
const CANCEL_URL = process.env.CANCEL_URL;   // e.g. https://your-service.onrender.com/cancel

async function getAccessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.status}`);
  }
  const data = await response.json();
  return data.access_token;
}

// Health check
app.get("/", (req, res) => {
  res.send("OK paypal-mini-api");
});

// Create deposit order (returns approve_url)
app.post("/create-deposit-order", async (req, res) => {
  try {
    const { presupuesto, amount, currency = "EUR" } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const accessToken = await getAccessToken();

    const payload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: String(presupuesto || "PRESU"),
          description: `Senal 20% - Presupuesto ${presupuesto || ""}`.trim(),
          amount: {
            currency_code: currency,
            value: amt.toFixed(2)
          }
        }
      ],
      application_context: {
        return_url: `${RETURN_URL}?presupuesto=${encodeURIComponent(presupuesto || "")}`,
        cancel_url: `${CANCEL_URL}?presupuesto=${encodeURIComponent(presupuesto || "")}`,
        user_action: "PAY_NOW"
      }
    };

    const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const approveUrl = (data.links || []).find(l => l.rel === "approve")?.href;
    res.json({ order_id: data.id, approve_url: approveUrl });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Return URL: capture payment
app.get("/return", async (req, res) => {
  try {
    const orderId = req.query.token;
    if (!orderId) {
      return res.status(400).send("Missing token");
    }

    const accessToken = await getAccessToken();

    const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).send(`Capture error: ${JSON.stringify(data)}`);
    }

    res.send("Pago confirmado. Puedes cerrar esta pagina.");
  } catch (err) {
    res.status(500).send(String(err.message || err));
  }
});

app.get("/cancel", (req, res) => {
  res.send("Pago cancelado.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
