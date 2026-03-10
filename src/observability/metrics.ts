type CounterName =
  | 'requests_total'
  | 'translation_requests_total'
  | 'cache_hits_total'
  | 'cache_misses_total'
  | 'upstream_requests_total';

interface Labels {
  lang?: string;
  status?: string;
  result?: string;
}

const counters = new Map<string, number>();

function key(name: CounterName, labels?: Labels): string {
  const serialized = labels
    ? Object.entries(labels)
        .filter(([, v]) => typeof v !== 'undefined')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',')
    : '';
  return `${name}{${serialized}}`;
}

export function incCounter(name: CounterName, labels?: Labels, by = 1): void {
  const metricKey = key(name, labels);
  counters.set(metricKey, (counters.get(metricKey) ?? 0) + by);
}

export function renderPrometheusMetrics(): string {
  const lines = [
    '# TYPE requests_total counter',
    '# TYPE translation_requests_total counter',
    '# TYPE cache_hits_total counter',
    '# TYPE cache_misses_total counter',
    '# TYPE upstream_requests_total counter',
  ];

  for (const [metricKey, value] of counters.entries()) {
    const braceIndex = metricKey.indexOf('{');
    const metricName = metricKey.slice(0, braceIndex);
    const labelsPart = metricKey.slice(braceIndex + 1, -1);

    if (!labelsPart) {
      lines.push(`${metricName} ${value}`);
      continue;
    }

    const labelString = labelsPart
      .split(',')
      .map((entry) => {
        const [k, v] = entry.split('=');
        return `${k}="${v}"`;
      })
      .join(',');

    lines.push(`${metricName}{${labelString}} ${value}`);
  }

  return `${lines.join('\n')}\n`;
}
