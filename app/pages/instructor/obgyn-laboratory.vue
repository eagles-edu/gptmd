<template>
  <section class="reference-sheet" aria-labelledby="pathology-title">
    <header class="page-header">
      <p class="eyebrow">Instructor workspace</p>
      <h1 id="pathology-title">OB/GYN Laboratory Pathology Reference</h1>
      <p class="intro">Select a checkbox beside a test to mark it reviewed for this teaching session.</p>
    </header>

    <h2 class="reference-section-heading">Laboratory tests</h2>

    <form class="reference-session" @submit.prevent>
      <label class="reference-patient-field">
        Patient name
        <input id="patient-name" v-model="patientName" name="patientName" type="text" autocomplete="off" placeholder="Enter patient name">
      </label>

      <div class="reference-progress" role="status" aria-live="polite">
        <strong>{{ completedCount }} of {{ checklistRows.length }} tests reviewed</strong>
        <span v-if="completedCount === checklistRows.length">All marked tests are reviewed.</span>
        <span v-else>Select the checkbox beside each marked test as it is reviewed.</span>
      </div>

      <section class="reference-table-scroll" tabindex="0" aria-labelledby="reference-table-heading">
        <h3 id="reference-table-heading" class="visually-hidden">Reference ranges and clinical purposes</h3>
        <table class="reference-table" aria-describedby="pathology-help">
          <caption id="pathology-help" class="visually-hidden">Select checkboxes only where shown in the source reference. The final two blank rows are retained from the source reference.</caption>
          <thead>
            <tr>
              <th scope="col" class="reference-selection-column"><span class="visually-hidden">Reviewed</span></th>
              <th scope="col">Diagnostic Category</th>
              <th scope="col">Test Name</th>
              <th scope="col">Standard Adult Reference Range</th>
              <th scope="col">Normal Pregnancy Target Range</th>
              <th scope="col">Primary Clinical Purpose</th>
              <th scope="col"><span class="visually-hidden">Additional clinical purpose</span></th>
              <th scope="col"><span class="visually-hidden">Additional reference detail</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" :class="[row.colorClass, { completed: completedRows[row.id] }]">
              <td class="reference-selection-cell">
                <input
                  v-if="row.sourceCheckbox"
                  :id="`row-${row.id}`"
                  v-model="completedRows[row.id]"
                  class="reference-checkbox"
                  type="checkbox"
                  :aria-label="`Mark ${row.cells[2]} reviewed`"
                >
              </td>
              <td class="category-cell">{{ row.cells[1] }}</td>
              <td>{{ row.cells[2] }}</td>
              <td>{{ row.cells[3] }}</td>
              <td>{{ row.cells[4] }}</td>
              <td>{{ row.cells[5] }}</td>
              <td>{{ row.cells[6] }}</td>
              <td>{{ row.cells[7] }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </form>
  </section>
</template>

<script setup lang="ts">
import { obgynPathologyRows } from '~/data/obgyn-pathology'

useHead({
  title: 'OB/GYN Laboratory Pathology Reference | GPTpatient',
  htmlAttrs: { lang: 'en' },
  meta: [
    {
      name: 'description',
      content: 'OB/GYN laboratory tests, adult reference ranges, pregnancy targets, and clinical purposes.'
    }
  ]
})

const rows = obgynPathologyRows
const checklistRows = rows.filter((row) => row.sourceCheckbox)
const patientName = ref<string>('')
const completedRows = ref<Record<number, boolean>>(
  Object.fromEntries(checklistRows.map((row) => [row.id, false]))
)
const completedCount = computed(() => Object.values(completedRows.value).filter(Boolean).length)
</script>
