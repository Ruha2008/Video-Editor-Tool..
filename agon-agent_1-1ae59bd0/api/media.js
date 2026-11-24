import supabase from './db-client.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('ve_media').select('*').order('id', { ascending: true });
      if (error) throw error; return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      const b = req.body || {};
      if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Media name is required.' });
      const dur = Number(b.duration_sec);
      if (!dur || dur <= 0 || dur > 3600) return res.status(400).json({ error: 'Duration must be 1-3600 seconds.' });
      const allowed = ['mp4','mov','webm','mkv','avi'];
      const fmt = String(b.format || 'mp4').toLowerCase();
      if (!allowed.includes(fmt)) return res.status(400).json({ error: 'Unsupported format. Use mp4, mov, webm, mkv or avi.' });
      const row = { name: String(b.name).trim(), filename: b.filename || (String(b.name).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-') + '.' + fmt), duration_sec: dur, format: fmt, size_mb: Number(b.size_mb || Math.max(1, Math.round(dur * 1.8))), resolution: b.resolution || '1920x1080', color: b.color || '#0ea5e9', is_sample: false };
      const { data, error } = await supabase.from('ve_media').insert(row).select('*').single();
      if (error) throw error; return res.status(201).json(data);
    }
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      const { error } = await supabase.from('ve_media').delete().eq('id', id);
      if (error) throw error; return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) { console.error(err); return res.status(500).json({ error: err.message }); }
}
