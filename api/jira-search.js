// Serverless function: consulta Jira Cloud en vivo para un proyecto arbitrario.
// Requiere las variables de entorno JIRA_EMAIL y JIRA_API_TOKEN configuradas en Vercel.

const JIRA_SITE = 'https://justtimeconsulting.atlassian.net';

function authHeader() {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error('MISSING_CREDENTIALS');
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function jiraFetch(path, options = {}, attempt = 0) {
  const res = await fetch(`${JIRA_SITE}${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (res.status === 429 && attempt < 5) {
    const retryAfter = parseFloat(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 400 * Math.pow(2, attempt);
    await sleep(waitMs);
    return jiraFetch(path, options, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Ejecuta `fn` sobre `items` con un máximo de `limit` llamadas en vuelo,
// para no saturar el rate-limit de Jira cuando hay muchas issues/vinculadas.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

let cachedEstimationFieldId;
async function findEstimationFieldId() {
  if (cachedEstimationFieldId !== undefined) return cachedEstimationFieldId;
  const fields = await jiraFetch('/rest/api/3/field');
  const match = fields.find(f => /estimaci.*total/i.test(f.name));
  cachedEstimationFieldId = match ? match.id : null;
  return cachedEstimationFieldId;
}

async function searchIssues(projectKey, estimationFieldId, limit) {
  const fieldsList = ['summary', 'status', 'issuetype', 'created', 'updated', 'issuelinks'];
  if (estimationFieldId) fieldsList.push(estimationFieldId);

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
      issueKey,
    }))
    .filter(e => e.consultant !== 'Sin asignar' && e.hours > 0);
}

function extractLinks(issue) {
  const links = issue.fields.issuelinks || [];
  const keys = new Set();
  const ftStatuses = {};
  links.forEach(link => {
    const linked = link.outwardIssue || link.inwardIssue;
    if (linked) {
      keys.add(linked.key);
      if (/FT-\d+$/.test(linked.key)) {
        const st = linked.fields?.status?.name || 'Desconocido';
        ftStatuses[st] = (ftStatuses[st] || 0) + 1;
      }
    }
  });
  return { keys: [...keys], statuses: ftStatuses };
}

module.exports = async (req, res) => {
  const projectKey = String(req.query.project || '').trim().toUpperCase();
  // Por defecto trae TODOS los casos del proyecto (paginando de a 100);
  // el tope de 1000 es sólo una salvaguarda ante proyectos enormes.
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 1000));

  if (!projectKey) {
    res.status(400).json({ error: 'Falta el parámetro "project"' });
    return;
  }

  try {
    const estimationFieldId = await findEstimationFieldId();
    const issues = await searchIssues(projectKey, estimationFieldId, limit);

    const cases = [];
    const worklogData = {};

    await mapWithConcurrency(issues, 6, async issue => {
        const key = issue.key;
        const fields = issue.fields;
        const { keys: linkedKeys, statuses: linkedStatuses } = extractLinks(issue);

        const ownWl = await getAllWorklogs(key);
        const linkedWl = await mapWithConcurrency(linkedKeys, 4, getAllWorklogs);
        const entries = ownWl.concat(...linkedWl).sort((a, b) => a.date.localeCompare(b.date));
        worklogData[key] = entries;

        const tipoActividad = fields.issuetype?.name || '';

        const estRaw = estimationFieldId ? fields[estimationFieldId] : null;
        const estimacionTotal = estRaw && typeof estRaw === 'object' ? (estRaw.value ?? '') : (estRaw ?? '');

        cases.push({
          key,
          summary: fields.summary || '',
          status: fields.status?.name || '',
          tipoActividad,
          estimacionTotal,
          created: (fields.created || '').slice(0, 10),
          updated: (fields.updated || '').slice(0, 10),
          linkedCount: linkedKeys.length,
          linkedStatuses,
        });
    });

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
