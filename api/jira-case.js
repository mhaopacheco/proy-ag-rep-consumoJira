// Serverless function: detalle de un caso ATIHD y sus issues vinculadas (ATIFT),
// con worklogs listos para agrupar por consultor y por mes.
// Requiere JIRA_EMAIL y JIRA_API_TOKEN configuradas en Vercel.

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

async function getIssue(key) {
  const fields = 'summary,status,assignee,created,updated,issuelinks';
  return jiraFetch(`/rest/api/3/issue/${key}?fields=${fields}`);
}

async function getAllWorklogs(issueKey) {
  let all = [];
  let startAt = 0;
  for (;;) {
    const page = await jiraFetch(`/rest/api/3/issue/${issueKey}/worklog?startAt=${startAt}&maxResults=100`);
    all = all.concat(page.worklogs || []);
    if (all.length >= page.total || (page.worklogs || []).length === 0) break;
    startAt += page.worklogs.length;
  }
  return all
    .map(w => ({
      consultant: w.author?.displayName || 'Sin asignar',
      date: (w.started || '').slice(0, 10),
      hours: Math.round(((w.timeSpentSeconds || 0) / 3600) * 100) / 100,
    }))
    .filter(e => e.consultant !== 'Sin asignar' && e.hours > 0);
}

function extractLinkedKeys(issue) {
  const links = issue.fields.issuelinks || [];
  const keys = new Set();
  links.forEach(link => {
    const linked = link.outwardIssue || link.inwardIssue;
    if (linked) keys.add(linked.key);
  });
  return [...keys];
}

module.exports = async (req, res) => {
  const key = String(req.query.key || '').trim().toUpperCase();
  if (!key) {
    res.status(400).json({ error: 'Falta el parámetro "key" (ej: ATIHD-50)' });
    return;
  }

  try {
    const issue = await getIssue(key);
    const linkedKeys = extractLinkedKeys(issue);

    const linked = await Promise.all(
      linkedKeys.map(async lkey => {
        const [lIssue, worklogs] = await Promise.all([
          getIssue(lkey).catch(() => null),
          getAllWorklogs(lkey),
        ]);
        return {
          key: lkey,
          summary: lIssue?.fields?.summary || '',
          status: lIssue?.fields?.status?.name || '',
          assignee: lIssue?.fields?.assignee?.displayName || 'Sin asignar',
          worklogs: worklogs.sort((a, b) => a.date.localeCompare(b.date)),
        };
      })
    );

    res.status(200).json({
      key,
      summary: issue.fields.summary || '',
      status: issue.fields.status?.name || '',
      assignee: issue.fields.assignee?.displayName || 'Sin asignar',
      created: (issue.fields.created || '').slice(0, 10),
      updated: (issue.fields.updated || '').slice(0, 10),
      linked,
    });
  } catch (err) {
    if (err.message === 'MISSING_CREDENTIALS') {
      res.status(500).json({ error: 'Faltan las variables de entorno JIRA_EMAIL / JIRA_API_TOKEN en Vercel.' });
      return;
    }
    if (/Jira API 404/.test(err.message)) {
      res.status(404).json({ error: `No se encontró el issue ${key}` });
      return;
    }
    res.status(502).json({ error: err.message });
  }
};

module.exports.config = { maxDuration: 30 };
