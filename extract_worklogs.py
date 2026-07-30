import json
import sys

file = r'C:\Users\MauricioPacheco\.claude\projects\D--OneDrive---jtc-com-co-501-ProjectsClaude-501-04-AgenteJira\b21fd942-f7a8-4566-b34c-6243aeb68c2c\tool-results\mcp-9d77504d-bb55-41d1-b4f4-9b984f81db0d-searchJiraIssuesUsingJql-1785419343785.txt'

with open(file, 'r', encoding='utf-8') as f:
    data = json.load(f)

nodes = data['issues']['nodes']

atihd_keys = {
    'ATIHD-50', 'ATIHD-148', 'ATIHD-136', 'ATIHD-134', 'ATIHD-118',
    'ATIHD-150', 'ATIHD-144', 'ATIHD-139', 'ATIHD-158', 'ATIHD-151',
    'ATIHD-128', 'ATIHD-149', 'ATIHD-137'
}

result = {}

for issue in nodes:
    key = issue.get('key', '')
    fields = issue.get('fields', {})
    issuelinks = fields.get('issuelinks', [])
    linked_atihd = set()
    for link in issuelinks:
        for direction in ('outwardIssue', 'inwardIssue'):
            linked = link.get(direction)
            if linked:
                lkey = linked.get('key', '')
                if lkey in atihd_keys:
                    linked_atihd.add(lkey)
    if not linked_atihd:
        continue

    worklog_data = fields.get('worklog', {})
    worklogs = worklog_data.get('worklogs', [])
    wl_total = worklog_data.get('total', 0)
    wl_max = worklog_data.get('maxResults', 0)
    if wl_total > wl_max and len(worklogs) == wl_max:
        print(f'WARNING: {key} has {wl_total} worklogs but only {len(worklogs)} returned', file=sys.stderr)

    for wl in worklogs:
        author = wl.get('author', {})
        name = author.get('displayName', 'Unknown')
        if name == 'Sin asignar':
            continue
        started_raw = wl.get('started', '')
        date = started_raw[:10] if started_raw else ''
        secs = wl.get('timeSpentSeconds', 0)
        if secs == 0:
            continue
        hours = round(secs / 3600, 2)
        entry = {'consultant': name, 'date': date, 'hours': hours}
        for ahd in linked_atihd:
            if ahd not in result:
                result[ahd] = []
            result[ahd].append(entry)

# Sort entries by date
for k in result:
    result[k].sort(key=lambda x: x['date'])

# Build JS output
lines = []
lines.append('const WORKLOG_DATA = {')

atihd_order = sorted(result.keys(), key=lambda x: int(x.split('-')[1]))
for i, ahd in enumerate(atihd_order):
    entries = result[ahd]
    comma = ',' if i < len(atihd_order) - 1 else ''
    lines.append(f"  '{ahd}': [")
    for j, e in enumerate(entries):
        ecomma = ',' if j < len(entries) - 1 else ''
        lines.append(f"    {{ consultant: '{e['consultant']}', date: '{e['date']}', hours: {e['hours']} }}{ecomma}")
    lines.append(f'  ]{comma}')

lines.append('};')

output = '\n'.join(lines)
outfile = r'C:\Users\MauricioPacheco\.claude\projects\D--OneDrive---jtc-com-co-501-ProjectsClaude-501-04-AgenteJira\b21fd942-f7a8-4566-b34c-6243aeb68c2c\scratchpad\atihd-worklogs-by-date.js'
with open(outfile, 'w', encoding='utf-8') as f:
    f.write(output)

total = sum(len(v) for v in result.values())
all_dates = [e['date'] for v in result.values() for e in v if e['date']]
print(f'Written: {outfile}')
print(f'Total entries: {total}')
if all_dates:
    print(f'Date range: {min(all_dates)} to {max(all_dates)}')
print(f'Cases written ({len(atihd_order)}):')
for k in atihd_order:
    print(f'  {k}: {len(result[k])} entries')
