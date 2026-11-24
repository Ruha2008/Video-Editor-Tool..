import supabase from './db-client.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'GET') {
      let q = supabase.from('ve_jobs').select('*').order('id', { ascending: true });
      if (req.query.project_id) q = q.eq('project_id', Number(req.query.project_id));
      const { data, error } = await q; if (error) throw error; return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      const b = req.body || {};
      if (!b.name) return res.status(400).json({ error: 'Job name is required.' });
      const row = { project_id: Number(b.project_id), name: String(b.name), format: b.format || 'mp4', resolution: b.resolution || '1080p', status: 'queued', progress: 0 };
      const { data, error } = await supabase.from('ve_jobs').insert(row).select('*').single();
      if (error) throw error; return res.status(201).json(data);
    }
    if (req.method === 'PUT') {
      const b = req.body || {};
      const patch = {}; ['status','progress','name','format','resolution'].forEach(k=>{ if(b[k]!==undefined) patch[k]=b[k]; });
      const { data, error } = await supabase.from('ve_jobs').update(patch).eq('id', b.id).select('*').single();
      if (error) throw error; return res.status(200).json(data);
    }
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      const { error } = await supabase.from('ve_jobs').delete().eq('id', id);
      if (error) throw error; return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) { console.error(err); return res.status(500).json({ error: err.message }); }
}
