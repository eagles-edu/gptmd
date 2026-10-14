<template>
  <section class="ai-budget" aria-labelledby="ai-budget-title">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Organization allocation</p>
        <h2 id="ai-budget-title">AI time pool</h2>
      </div>
      <button type="button" :disabled="state === 'loading' || state === 'saving'" @click="save">
        {{ state === 'saving' ? 'Saving…' : 'Save draft' }}
      </button>
    </div>

    <p class="boundary-note">Token budgets define the intended entitlement. Minute values are estimates; no token-to-minute conversion is defined. This draft does not meter or block AI usage.</p>
    <p v-if="usage" class="usage-summary" role="status">
      Provider-reported usage in this organization period: {{ formatTokenCount(usage.totalTokens) }} tokens across {{ usage.responseCount }} responses. These tokens are not charged against the draft.
    </p>
    <p v-if="message" class="status-message" role="status">{{ message }}</p>
    <p v-if="state === 'loading'" class="status-message" role="status">Loading allocation draft…</p>

    <form v-if="settings" class="budget-form" @submit.prevent="save">
      <fieldset>
        <legend>Organization pool</legend>
        <div class="field-grid">
          <label>
            <span>Period length in months</span>
            <input v-model.number="settings.organizationPeriod.months" type="number" min="1" max="12" step="1">
          </label>
          <label>
            <span>First period start date</span>
            <input v-model="settings.organizationPeriod.anchorDate" type="date">
          </label>
          <label>
            <span>Token pool</span>
            <input v-model.number="settings.organizationPool.tokens" type="number" min="0" step="1">
          </label>
          <label>
            <span>Estimated minutes</span>
            <input v-model.number="settings.organizationPool.estimatedMinutes" type="number" min="0" step="1">
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>User groups</legend>
        <div class="fieldset-heading">
          <button type="button" class="secondary" @click="addGroup">Add group</button>
        </div>
        <div v-if="settings.groups.length" class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Group code</th>
                <th scope="col">Name</th>
                <th scope="col">Pool tokens</th>
                <th scope="col">Estimated pool minutes</th>
                <th scope="col">Monthly tokens per user</th>
                <th scope="col">Monthly estimated minutes per user</th>
                <th scope="col"><span class="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(group, index) in settings.groups" :key="group.code || index">
                <td><input v-model.trim="group.code" aria-label="Group code" type="text" maxlength="40"></td>
                <td><input v-model.trim="group.name" aria-label="Group name" type="text" maxlength="100"></td>
                <td><input v-model.number="group.tokenBudget" aria-label="Pool tokens" type="number" min="0" step="1"></td>
                <td><input v-model.number="group.estimatedMinuteBudget" aria-label="Estimated pool minutes" type="number" min="0" step="1"></td>
                <td><input :value="group.monthlyTokensPerUser ?? ''" aria-label="Monthly tokens per user" type="number" min="0" step="1" @input="setGroupLimit(group, 'monthlyTokensPerUser', $event)"></td>
                <td><input :value="group.monthlyEstimatedMinutesPerUser ?? ''" aria-label="Monthly estimated minutes per user" type="number" min="0" step="1" @input="setGroupLimit(group, 'monthlyEstimatedMinutesPerUser', $event)"></td>
                <td><button type="button" class="remove" :aria-label="`Remove ${group.name || 'user group'}`" @click="removeGroup(index)">×</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-state">No user groups defined.</p>
      </fieldset>

      <fieldset>
        <legend>Departments</legend>
        <div class="fieldset-heading">
          <button type="button" class="secondary" @click="addDepartment">Add department</button>
        </div>
        <div v-if="settings.departments.length" class="department-list">
          <div v-for="(department, index) in settings.departments" :key="department.code || index" class="department-row">
            <label>
              <span>Department code</span>
              <input v-model.trim="department.code" type="text" maxlength="40">
            </label>
            <label>
              <span>Department name</span>
              <input v-model.trim="department.name" type="text" maxlength="100">
            </label>
            <label>
              <span>Monthly tokens per user</span>
              <input :value="department.monthlyTokensPerUser ?? ''" type="number" min="0" step="1" @input="setDepartmentLimit(department, $event)">
            </label>
            <button type="button" class="remove" :aria-label="`Remove ${department.name || 'department'}`" @click="removeDepartment(index)">×</button>
          </div>
        </div>
        <p v-else class="empty-state">No departments defined.</p>
      </fieldset>

      <fieldset>
        <legend>Member assignments</legend>
        <div class="import-controls">
          <button type="button" class="secondary" @click="downloadRoster">Download roster spreadsheet</button>
          <label class="upload-control">
            <span>Import CSV spreadsheet</span>
            <input type="file" accept=".csv,text/csv" :disabled="state === 'saving'" @change="importRoster">
          </label>
        </div>
        <p class="empty-state">Use the downloaded roster as a template. Keep subject IDs unchanged; separate multiple group codes with semicolons. Existing visits keep their original department.</p>
        <div v-if="assignmentMembers.length" class="assignment-form">
          <label>
            <span>Workspace member</span>
            <select v-model="selectedSubjectId" @change="selectMemberAssignment">
              <option value="">Select a member</option>
              <option v-for="member in assignmentMembers" :key="member.subjectId" :value="member.subjectId">
                {{ member.subjectId }} · {{ member.role }}
              </option>
            </select>
          </label>
          <fieldset class="assignment-groups">
            <legend>Assigned groups</legend>
            <label v-for="group in assignmentGroups" :key="group.code" class="assignment-option">
              <input v-model="selectedGroupCodes" type="checkbox" :value="group.code">
              <span>{{ group.name }}</span>
            </label>
            <p v-if="!assignmentGroups.length" class="empty-state">Save at least one user group first.</p>
          </fieldset>
          <label>
            <span>Department</span>
            <select v-model="selectedDepartmentCode">
              <option :value="null">No department</option>
              <option v-for="department in assignmentDepartments" :key="department.code" :value="department.code">
                {{ department.name }}
              </option>
            </select>
          </label>
          <p v-if="departmentTokenPreview" class="allocation-preview" role="status">
            Department allowance preview: {{ formatTokenCount(String(departmentTokenPreview.tokens)) }} of
            {{ formatTokenCount(String(departmentTokenPreview.monthlyTokens)) }} monthly tokens
            ({{ Math.floor(departmentTokenPreview.fraction * 100) }}% for this calendar month).
            Usage enforcement is not active yet.
          </p>
          <button
            type="button"
            class="secondary"
            :disabled="state === 'saving' || !selectedSubjectId"
            @click="saveMemberAssignment"
          >Save member assignment</button>
        </div>
        <p v-else class="empty-state">No active workspace members are available for assignment.</p>
        <div v-if="assignmentMembers.length" class="table-wrap">
          <table class="assignment-table">
            <thead>
              <tr><th scope="col">Member subject</th><th scope="col">Groups</th><th scope="col">Department</th></tr>
            </thead>
            <tbody>
              <tr v-for="member in assignmentMembers" :key="member.subjectId">
                <td>{{ member.subjectId }}</td>
                <td>{{ member.groupCodes.join(', ') || 'Unassigned' }}</td>
                <td>{{ assignmentDepartments.find((department) => department.code === member.departmentCode)?.name || 'None' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </fieldset>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

type GroupBudget = {
  code: string
  name: string
  tokenBudget: number
  estimatedMinuteBudget: number
  monthlyTokensPerUser: number | null
  monthlyEstimatedMinutesPerUser: number | null
}
type Department = { code: string; name: string; monthlyTokensPerUser?: number | null }
type AssignmentMember = {
  subjectId: string
  role: 'learner' | 'instructor' | 'customer_admin'
  groupCodes: string[]
  departmentCode: string | null
  departmentAssignedAt?: string | null
}
type BudgetSettings = {
  schemaVersion: 1
  revision: number
  status: 'draft'
  organizationPeriod: { months: number; anchorDate: string }
  organizationPool: { tokens: number; estimatedMinutes: number }
  groups: GroupBudget[]
  departments: Department[]
}
type UsageSummary = { totalTokens: string; responseCount: number }

const props = defineProps<{ tenantId: string }>()
const settings = ref<BudgetSettings | null>(null)
const usage = ref<UsageSummary | null>(null)
const state = ref<'idle' | 'loading' | 'saving' | 'error'>('idle')
const message = ref('')
const assignmentMembers = ref<AssignmentMember[]>([])
const assignmentGroups = ref<Array<{ code: string; name: string }>>([])
const assignmentDepartments = ref<Department[]>([])
const selectedSubjectId = ref('')
const selectedGroupCodes = ref<string[]>([])
const selectedDepartmentCode = ref<string | null>(null)
const departmentTokenPreview = computed(() => {
  const department = assignmentDepartments.value.find((item) => item.code === selectedDepartmentCode.value)
  const member = assignmentMembers.value.find((item) => item.subjectId === selectedSubjectId.value)
  if (!department || department.monthlyTokensPerUser == null) return null
  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const assignedAt = selectedDepartmentCode.value === member?.departmentCode && member.departmentAssignedAt
    ? new Date(member.departmentAssignedAt)
    : now
  const allocationStart = assignedAt > periodStart && assignedAt < periodEnd ? assignedAt : periodStart
  const fraction = (periodEnd.getTime() - allocationStart.getTime()) / (periodEnd.getTime() - periodStart.getTime())
  return {
    monthlyTokens: department.monthlyTokensPerUser,
    fraction,
    tokens: Math.floor(department.monthlyTokensPerUser * fraction)
  }
})

function emptySettings(): BudgetSettings {
  return {
    schemaVersion: 1,
    revision: 0,
    status: 'draft',
    organizationPeriod: { months: 1, anchorDate: '' },
    organizationPool: { tokens: 0, estimatedMinutes: 0 },
    groups: [],
    departments: []
  }
}

function apiUrl(): string {
  const config = useRuntimeConfig()
  return `${String(config.public.apiBase).replace(/\/$/, '')}/api/admin/ai-time-budget`
}

async function load(): Promise<void> {
  state.value = 'loading'
  message.value = ''
  try {
    const result = await $fetch<{ settings: BudgetSettings | null; usage: UsageSummary | null }>(apiUrl(), {
      headers: await useGptmdAuth().accessHeaders()
    })
    settings.value = result.settings ?? emptySettings()
    usage.value = result.usage
    await loadAssignments()
    state.value = 'idle'
  } catch {
    state.value = 'error'
    message.value = 'AI-time budget draft could not be loaded.'
  }
}

async function loadAssignments(): Promise<void> {
  const result = await $fetch<{
    members: AssignmentMember[]
    groups: Array<{ code: string; name: string }>
    departments: Department[]
  }>(`${apiUrl()}/assignments`, { headers: await useGptmdAuth().accessHeaders() })
  assignmentMembers.value = result.members
  assignmentGroups.value = result.groups
  assignmentDepartments.value = result.departments
  if (!assignmentMembers.value.some((member) => member.subjectId === selectedSubjectId.value)) {
    selectedSubjectId.value = assignmentMembers.value[0]?.subjectId ?? ''
  }
  selectMemberAssignment()
}

function selectMemberAssignment(): void {
  const member = assignmentMembers.value.find((item) => item.subjectId === selectedSubjectId.value)
  selectedGroupCodes.value = member ? [...member.groupCodes] : []
  selectedDepartmentCode.value = member?.departmentCode ?? null
}

async function saveMemberAssignment(): Promise<void> {
  if (!selectedSubjectId.value || state.value === 'saving') return
  state.value = 'saving'
  message.value = ''
  try {
    const result = await $fetch<{ assignment: AssignmentMember }>(`${apiUrl()}/assignments`, {
      method: 'PUT',
      headers: await useGptmdAuth().accessHeaders(),
      body: {
        subjectId: selectedSubjectId.value,
        groupCodes: selectedGroupCodes.value,
        departmentCode: selectedDepartmentCode.value
      }
    })
    assignmentMembers.value = assignmentMembers.value.map((member) =>
      member.subjectId === result.assignment.subjectId ? result.assignment : member)
    message.value = 'Member assignment saved. Existing sessions keep their selected group.'
    state.value = 'idle'
  } catch {
    message.value = 'Member assignment was not saved. Confirm the group and department catalogs, then reload.'
    state.value = 'error'
  }
}

function formatTokenCount(value: string): string {
  try {
    return new Intl.NumberFormat().format(BigInt(value))
  } catch {
    return value
  }
}

function addGroup(): void {
  settings.value?.groups.push({
    code: '', name: '', tokenBudget: 0, estimatedMinuteBudget: 0,
    monthlyTokensPerUser: null, monthlyEstimatedMinutesPerUser: null
  })
}

function removeGroup(index: number): void {
  settings.value?.groups.splice(index, 1)
}

function addDepartment(): void {
  settings.value?.departments.push({ code: '', name: '', monthlyTokensPerUser: null })
}

function removeDepartment(index: number): void {
  settings.value?.departments.splice(index, 1)
}

function setGroupLimit(group: GroupBudget, key: 'monthlyTokensPerUser' | 'monthlyEstimatedMinutesPerUser', event: Event): void {
  const value = (event.target as HTMLInputElement).value
  group[key] = value === '' ? null : Number(value)
}

function setDepartmentLimit(department: Department, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  department.monthlyTokensPerUser = value === '' ? null : Number(value)
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function downloadRoster(): void {
  const rows = [
    ['subjectId', 'groupCodes', 'departmentCode'],
    ...assignmentMembers.value.map((member) => [
      member.subjectId,
      member.groupCodes.join(';'),
      member.departmentCode ?? ''
    ])
  ]
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'gptmd-member-department-roster.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (quoted && character === '"' && text[index + 1] === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') quoted = !quoted
    else if (!quoted && character === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else cell += character
  }
  if (quoted) throw new Error('Unclosed quote in CSV')
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

async function importRoster(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  state.value = 'saving'
  message.value = ''
  try {
    const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ''))
    const headers = rows.shift()?.map((header) => header.toLowerCase()) ?? []
    const subjectColumn = headers.indexOf('subjectid')
    const groupsColumn = headers.indexOf('groupcodes')
    const departmentColumn = headers.indexOf('departmentcode')
    if (subjectColumn < 0 || groupsColumn < 0 || departmentColumn < 0 || rows.length === 0) {
      throw new Error('Expected subjectId, groupCodes, departmentCode columns')
    }
    const assignments = rows.map((row) => ({
      subjectId: row[subjectColumn] ?? '',
      groupCodes: (row[groupsColumn] ?? '').split(';').map((code) => code.trim()).filter(Boolean),
      departmentCode: (row[departmentColumn] ?? '').trim() || null
    }))
    const result = await $fetch<{ imported: number; failures: Array<{ subjectId: string; error: string }> }>(`${apiUrl()}/assignments/import`, {
      method: 'POST',
      headers: await useGptmdAuth().accessHeaders(),
      body: { assignments }
    })
    await loadAssignments()
    message.value = result.failures.length
      ? `Imported ${result.imported} rows; ${result.failures.length} need correction: ${result.failures.map((failure) => `${failure.subjectId}: ${failure.error}`).join('; ')}`
      : `Imported ${result.imported} member assignments.`
    state.value = 'idle'
  } catch (error) {
    message.value = error instanceof Error && error.message.includes('Expected')
      ? error.message
      : 'Spreadsheet import failed. Check the CSV columns and member, group, and department codes.'
    state.value = 'error'
  } finally {
    input.value = ''
  }
}

async function save(): Promise<void> {
  if (!settings.value || state.value === 'saving') return
  state.value = 'saving'
  message.value = ''
  try {
    const result = await $fetch<{ settings: BudgetSettings; usage: UsageSummary }>(apiUrl(), {
      method: 'PUT',
      headers: await useGptmdAuth().accessHeaders(),
      body: settings.value
    })
    settings.value = result.settings
    usage.value = result.usage
    assignmentGroups.value = result.settings.groups.map(({ code, name }) => ({ code, name }))
    assignmentDepartments.value = result.settings.departments
    state.value = 'idle'
    message.value = 'Draft saved. AI usage remains unenforced.'
  } catch {
    state.value = 'error'
    message.value = 'Draft was not saved. Check the values and reload if another administrator changed them.'
  }
}

onMounted(load)
watch(() => props.tenantId, () => { void load() })
</script>

<style scoped>
.ai-budget {
  border-top: 1px solid #c9d7d3;
  margin-top: 1.5rem;
  padding-top: 1.25rem;
}

.section-heading,
.fieldset-heading {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.section-heading h2 {
  font-size: 1.25rem;
  margin: 0;
}

.eyebrow {
  color: #267a75;
  font-size: 0.75rem;
  font-weight: 700;
  margin: 0 0 0.2rem;
  text-transform: uppercase;
}

button {
  background: #146f6a;
  border: 1px solid #146f6a;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  min-height: 2.5rem;
  padding: 0.45rem 0.8rem;
}

button:disabled {
  cursor: wait;
  opacity: 0.6;
}

button.secondary {
  background: white;
  color: #165d59;
}

button.remove {
  background: transparent;
  border-color: transparent;
  color: #9c3127;
  font-size: 1.25rem;
  min-width: 2.5rem;
  padding: 0;
}

.boundary-note,
.usage-summary,
.status-message,
.empty-state {
  color: #475854;
  font-size: 0.9rem;
  margin: 0.8rem 0;
}

.boundary-note {
  border-left: 3px solid #bf7445;
  padding-left: 0.7rem;
}

fieldset {
  border: 0;
  border-top: 1px solid #dce5e2;
  margin: 1.1rem 0 0;
  min-width: 0;
  padding: 0.8rem 0 0;
}

legend {
  font-weight: 800;
  padding: 0 0.5rem 0 0;
}

.field-grid {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

label {
  display: grid;
  font-size: 0.84rem;
  font-weight: 700;
  gap: 0.35rem;
  min-width: 0;
}

input {
  background: white;
  border: 1px solid #aebfba;
  border-radius: 3px;
  box-sizing: border-box;
  color: #1c2826;
  font: inherit;
  font-weight: 400;
  min-height: 2.4rem;
  min-width: 0;
  padding: 0.4rem;
  width: 100%;
}

select {
  background: white;
  border: 1px solid #aebfba;
  border-radius: 3px;
  box-sizing: border-box;
  color: #1c2826;
  font: inherit;
  min-height: 2.4rem;
  min-width: 0;
  padding: 0.4rem;
  width: 100%;
}

.assignment-form {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: minmax(12rem, 1fr) minmax(12rem, 1fr);
  align-items: end;
}

.assignment-groups {
  border: 1px solid #dce5e2;
  grid-row: span 2;
  margin: 0;
  padding: 0.7rem;
}

.assignment-option {
  align-items: center;
  display: flex;
  gap: 0.55rem;
  margin: 0.3rem 0;
}

.assignment-option input {
  accent-color: #146f6a;
  min-height: 1rem;
  width: 1rem;
}

.assignment-table {
  min-width: 620px;
}

.table-wrap {
  overflow-x: auto;
}

table {
  border-collapse: collapse;
  min-width: 850px;
  width: 100%;
}

th,
td {
  border-bottom: 1px solid #dce5e2;
  padding: 0.45rem 0.35rem;
  text-align: left;
}

th {
  color: #475854;
  font-size: 0.75rem;
  line-height: 1.3;
}

.department-list {
  display: grid;
  gap: 0.7rem;
}

.department-row {
  align-items: end;
  display: grid;
  gap: 0.7rem;
  grid-template-columns: minmax(8rem, 1fr) minmax(10rem, 2fr) minmax(10rem, 1fr) auto;
}

.allocation-preview {
  color: #475854;
  font-size: 0.88rem;
  margin: 0;
}

.import-controls {
  align-items: end;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 0.8rem;
}

.upload-control {
  display: grid;
  gap: 0.3rem;
  max-width: 100%;
}

.upload-control span {
  font-size: 0.85rem;
  font-weight: 650;
}

.upload-control input {
  font: inherit;
  max-width: 100%;
}

.sr-only {
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

@media (width <= 760px) {
  .field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .assignment-form {
    grid-template-columns: 1fr;
  }

  .assignment-groups {
    grid-row: auto;
  }
}

@media (width <= 480px) {
  .field-grid,
  .department-row,
  .assignment-form {
    grid-template-columns: 1fr;
  }
}
</style>
