// api/paypal-client-id.js
// Returns the PayPal client ID for the frontend JS SDK.
// Client IDs are safe to expose (like Stripe publishable keys).

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const clientId = process.env.PAYPAL_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'PAYPAL_CLIENT_ID not configured' });

  return res.status(200).json({ clientId });
}
