// api/delete-account.js
// Deletes a user's account from Supabase auth and profiles table
// Requires valid user token

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Get user from token
    const userRes = await fetch(`${sbUrl}/auth/v1/user`, {
      headers: { 'apikey': sbKey, 'Authorization': `Bearer ${token}` }
    });
    const user = await userRes.json();
    if (!user || !user.id) return res.status(401).json({ error: 'Invalid token' });

    // Delete profile
    await fetch(`${sbUrl}/rest/v1/profiles?id=eq.${user.id}`, {
      method: 'DELETE',
      headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`, 'Prefer': 'return=minimal' }
    });

    // Delete auth user
    const deleteRes = await fetch(`${sbUrl}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` }
    });

    if (!deleteRes.ok) {
      const err = await deleteRes.json();
      throw new Error(err.message || 'Failed to delete auth user');
    }

    console.log('[delete-account] Deleted user:', user.id);
    return res.status(200).json({ success: true });

  } catch(e) {
    console.error('[delete-account] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
