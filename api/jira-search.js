// Serverless function: consulta Jira Cloud en vivo para un proyecto arbitrario.
// Requiere las variables de entorno JIRA_EMAIL y JIRA_API_TOKEN configuradas en Vercel.

const JIRA_SITE = 'https://justtimeconsulting.atlassian.net';

function authHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error('MISSING_CREDENTIALS');
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
}

async function jiraFetch(path, options = {}) {
  const res = await fetch(`${JIRA_SITE}${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

let cachedActivityFieldId;
async function findActivityFieldId() {
  if (cachedActivityFieldId !== undefined) return cachedActivityFieldId;
  const fields = await jiraFetch('/rest/api/3/field');
  const match = fields.find(f => /tipo.*activ/i.test(f.name));
  cachedActivityFieldId = match ? match.id : null;
  return cachedActivityFieldId;
}

async function searchIssues(projectKey, activityFieldId, limit) {
  const fieldsList = ['summary', 'status', 'created', 'updated', 'issuelinks'];
  if (activityFieldId) fieldsList.push(activityFieldId);

  let issues = [];
  let nextPageToken;
  do {
    const body = {
      jql: `project = "${projectKey}" ORDER BY updated DESC`,
      fields: fieldsList,
      maxResults: Math.min(100, limit - issues.length),
      ...(nextPageToken ? { nextPageToken } : {}),
    };
    const page = await jiraFetch('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    issues = issues.concat(page.issues || []);
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && issues.length < limit);

  return issues.slice(0, limit);
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

function extractLinks(issue) {
  const links = issue.fields.issuelinks || [];
  const keys = new Set();
  const statuses = {};
  links.forEach(link => {
    const linked = link.outwardIssue || link.inwardIssue;
    if (linked) {
      keys.add(linked.key);
      const st = linked.fields?.status?.name || 'Desconocido';
      statuses[st] = (statuses[st] || 0) + 1;
    }
  });
  return { keys: [...keys], statuses };
}

module.exports = async (req, res) => {
  const projectKey = String(req.query.project || '').trim().toUpperCase();
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

  if (!projectKey) {
    res.status(400).json({ error: 'Falta el parámetro "project"' });
    return;
  }

  try {
    const activityFieldId = await findActivityFieldId();
    const issues = await searchIssues(projectKey, activityFieldId, limit);

    const cases = [];
    const worklogData = {};

    await Promise.all(
      issues.map(async issue => {
        const key = issue.key;
        const fields = issue.fields;
        const { keys: linkedKeys, statuses: linkedStatuses } = extractLinks(issue);

        const ownWl = await getAllWorklogs(key);
        const linkedWl = await Promise.all(linkedKeys.map(getAllWorklogs));
        const entries = ownWl.concat(...linkedWl).sort((a, b) => a.date.localeCompare(b.date));
        worklogData[key] = entries;

        const tipoRaw = activityFieldId ? fields[activityFieldId] : null;
        const tipoActividad = tipoRaw && typeof tipoRaw === 'object' ? tipoRaw.value : tipoRaw || '';

        cases.push({
          key,
          summary: fields.summary || '',
          status: fields.status?.name || '',
          tipoActividad,
          created: (fields.created || '').slice(0, 10),
          updated: (fields.updated || '').slice(0, 10),
          linkedCount: linkedKeys.length,
          linkedStatuses,
        });
      })
    );

    cases.sort((a, b) => b.updated.localeCompare(a.updated));
    res.status(200).json({ project: projectKey, cases, worklogData });
  } catch (err) {
    if (err.message === 'MISSING_CREDENTIALS') {
      res.status(500).json({ error: 'Faltan las variables de entorno JIRA_EMAIL / JIRA_API_TOKEN en Vercel.' });
      return;
    }
    res.status(502).json({ error: err.message });
  }
};

module.exports.config = { maxDuration: 30 };
