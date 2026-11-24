import supabase from './db-client.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('ve_projects').select('*').order('id', { ascending: false });
      if (error) throw error; return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      const { name, description } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Project name is required.' });
      const { data, error } = await supabase.from('ve_projects').insert({ name: String(name).trim(), description: description || '' }).select('*').single();
      if (error) throw error; return res.status(201).json(data);
    }
    if (req.method === 'PUT') {
      const { id, name, description } = req.body || {};
      const { data, error } = await supabase.from('ve_projects').update({ name, description }).eq('id', id).select('*').single();
      if (error) throw error; return res.status(200).json(data);
    }
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      await supabase.from('ve_clips').delete().eq('project_id', id);
      await supabase.from('ve_jobs').delete().eq('project_id', id);
      const { error } = await supabase.from('ve_projects').delete().eq('id', id);
      if (error) throw error; return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) { console.error(err); return res.status(500).json({ error: err.message }); }
}
