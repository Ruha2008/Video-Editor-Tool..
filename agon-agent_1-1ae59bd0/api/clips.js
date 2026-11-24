import supabase from './db-client.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'GET') {
      let q = supabase.from('ve_clips').select('*').order('position', { ascending: true });
      if (req.query.project_id) q = q.eq('project_id', Number(req.query.project_id));
      const { data, error } = await q; if (error) throw error; return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      const b = req.body || {};
      if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Clip name is required.' });
      const dur = Number(b.duration_sec);
      if (!dur || dur <= 0 || dur > 3600) return res.status(400).json({ error: 'Duration must be between 0.1 and 3600 seconds.' });
      const ts = Number(b.trim_start ?? 0), te = Number(b.trim_end ?? dur);
      if (ts < 0 || te > dur || te - ts < 0.5) return res.status(400).json({ error: 'Invalid trim: need 0 <= start < end <= duration and at least 0.5s long.' });
      const row = { project_id: Number(b.project_id), name: String(b.name).trim(), source: b.source || String(b.name).trim(), duration_sec: dur, trim_start: ts, trim_end: te, position: Number(b.position ?? 0), color: b.color || '#6366f1' };
      const { data, error } = await supabase.from('ve_clips').insert(row).select('*').single();
      if (error) throw error; return res.status(201).json(data);
    }
    if (req.method === 'PUT') {
      const b = req.body || {};
      const patch = {};
      ['name','source','duration_sec','trim_start','trim_end','position','color'].forEach(k => { if (b[k] !== undefined) patch[k] = b[k]; });
      if (patch.trim_start !== undefined && patch.trim_end !== undefined && Number(patch.trim_end) - Number(patch.trim_start) < 0.5) return res.status(400).json({ error: 'Trimmed clip must be at least 0.5s long.' });
      const { data, error } = await supabase.from('ve_clips').update(patch).eq('id', b.id).select('*').single();
      if (error) throw error; return res.status(200).json(data);
    }
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      const { error } = await supabase.from('ve_clips').delete().eq('id', id);
      if (error) throw error; return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) { console.error(err); return res.status(500).json({ error: err.message }); }
}
