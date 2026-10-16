export type CompletionRecordDetails = {
  sessionId: string
  subjectId: string
  startedAt: string
  completedAt: string
  estimatedEngagementSeconds: number
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]!)
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString('en', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC'
  }) + ' UTC'
}

export function createCompletionRecordHtml(record: CompletionRecordDetails): string {
  const subject = escapeHtml(record.subjectId)
  const reference = escapeHtml(record.sessionId)
  const startedAt = escapeHtml(formatDate(record.startedAt))
  const completedAt = escapeHtml(formatDate(record.completedAt))
  const estimatedMinutes = Math.max(0, record.estimatedEngagementSeconds / 60).toFixed(1)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GPTpatient simulation completion record</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17241f; font: 16px/1.55 Arial, sans-serif; }
    main { max-width: 760px; margin: 48px auto; padding: 36px; border: 2px solid #286b55; }
    header { border-bottom: 1px solid #b9c9c1; padding-bottom: 20px; }
    .brand { color: #286b55; font-size: 13px; font-weight: 700; text-transform: uppercase; }
    h1 { margin: 12px 0 4px; font-family: Georgia, serif; font-size: 34px; font-weight: 500; }
    .lead { color: #52645c; }
    dl { display: grid; grid-template-columns: 190px 1fr; gap: 12px 20px; margin: 28px 0; }
    dt { color: #52645c; }
    dd { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
    .notice { margin-top: 30px; padding: 16px; border-left: 4px solid #a35b27; background: #f7eee5; }
    .reference { color: #52645c; font-size: 11px; overflow-wrap: anywhere; }
    @media print { main { max-width: none; margin: 0; padding: 12mm; } }
    @media (max-width: 600px) { main { margin: 12px; padding: 20px; } dl { grid-template-columns: 1fr; gap: 4px; } dd { margin-bottom: 12px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand">GPTpatient · OBGYN simulation</div>
      <h1>Simulation completion record</h1>
      <p class="lead">This record confirms a completed fictional standardized-patient training encounter.</p>
    </header>
    <dl>
      <dt>Participant subject</dt><dd>${subject}</dd>
      <dt>Encounter started</dt><dd>${startedAt}</dd>
      <dt>Encounter completed</dt><dd>${completedAt}</dd>
      <dt>Estimated active time</dt><dd>${estimatedMinutes} minutes</dd>
    </dl>
    <p>The active-time value is estimated from visible-page, recent-interaction activity pulses. It is not continuous monitoring or independently verified attendance.</p>
    <aside class="notice"><strong>No CEU credit is awarded or represented by this document.</strong> Accreditation, credit hours, and eligibility must be determined separately by the responsible educator or accrediting organization.</aside>
    <p class="reference">Internal session reference: ${reference}</p>
  </main>
</body>
</html>`
}
