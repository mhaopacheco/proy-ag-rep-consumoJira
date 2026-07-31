// Serverless function: sugiere proyectos de Jira que coincidan con lo escrito.
// Requiere JIRA_EMAIL y JIRA_API_TOKEN en Vercel (mismas credenciales que jira-search.js).

const JIRA_SITE = 'https://justtimeconsulting.atlassian.net';

function authHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error('MISSING_CREDENTIALS');
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
}

async function jiraFetch(path) {
  const res = await fetch(`${JIRA_SITE}${path}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

module.exports = async (req, res) => {
  const q = String(req.query.q || '').trim();

  try {
    const params = new URLSearchParams({ maxResults: '20', orderBy: 'name' });
    if (q) params.set('query', q);
    const data = await jiraFetch(`/rest/api/3/project/search?${params.toString()}`);
    const projects = (data.values || []).map(p => ({
      key: p.key,
      name: p.name,
      avatar: p.avatarUrls?.['16x16'] || null,
    }));
    res.status(200).json({ projects });
  } catch (err) {
    if (err.message === 'MISSING_CREDENTIALS') {
      res.status(500).json({ error: 'Faltan las variables de entorno JIRA_EMAIL / JIRA_API_TOKEN en Vercel.' });
      return;
    }
    res.status(502).json({ error: err.message });
  }
};
