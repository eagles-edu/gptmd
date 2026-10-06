<script setup>
import { computed, markRaw, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import SystemNode from './SystemNode.vue'
import { makeDetailGraph, overviewGraph, stepOrder, stepText } from './graph.js'

const graph = ref({ ...overviewGraph })
const selectedId = ref('talk')
const detailId = ref(null)
const currentStep = ref(-1)
const playing = ref(false)
const speed = ref('normal')
const reduceMotion = ref(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
const graphNodeTypes = markRaw({ system: SystemNode })
const stageIds = stepOrder
const stageTitle = {
  'sign-in': 'Sign in & start',
  prepare: 'Prepare patient',
  talk: 'Talk to patient',
  save: 'Save & review',
}
const detail = computed(() => detailId.value ? makeDetailGraph(detailId.value) : null)
const selectedNode = computed(() => graph.value.nodes.find(node => node.id === selectedId.value))
const selectedTitle = computed(() => selectedNode.value?.data.title || (detailId.value ? detail.value?.title : 'Whole visit'))
const selectedStatus = computed(() => selectedNode.value?.data.status || 'working')
const selectedParts = computed(() => selectedNode.value?.data.parts || [])
const selectedCopy = computed(() => {
  if (detailId.value) return selectedNode.value?.data.detail || detail.value?.intro || ''
  if (currentStep.value >= 0) return stepText[stageIds[currentStep.value]]
  return selectedNode.value?.data.detail || 'Follow the path from learner sign in through the saved visit.'
})
const activeStage = computed(() => currentStep.value >= 0 ? stageIds[currentStep.value] : selectedId.value)
const displayStep = computed(() => currentStep.value >= 0 ? currentStep.value + 1 : Math.max(stageIds.indexOf(selectedId.value) + 1, 1))
const currentFlowText = computed(() => currentStep.value >= 0 ? stepText[stageIds[currentStep.value]] : selectedNode.value?.data.detail || 'Play the visit to follow one action at a time.')
const detailNote = computed(() => detail.value?.states || [])
const mapNodes = computed(() => [...graph.value.nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x))

const { fitView } = useVueFlow('system-map')
let timer

const statusName = status => ({ working: 'Works today', partial: 'Partly verified', planned: 'Planned' })[status] || 'System part'

function selectNode({ node }) {
  selectedId.value = node.id
  currentStep.value = stageIds.indexOf(node.id)
}

function syncActiveEdge() {
  const activeNode = detailId.value ? selectedId.value : activeStage.value
  const nodes = graph.value.nodes.map(node => ({
    ...node,
    class: node.id === activeNode ? 'current-flow-node' : '',
  }))
  const edges = graph.value.edges.map(edge => ({ ...edge, animated: false, class: '' }))
  if (detailId.value) {
    const focus = edges.find(edge => edge.source === selectedId.value || edge.target === selectedId.value)
    if (focus && !reduceMotion.value) {
      focus.animated = true
      focus.class = 'active-flow-edge'
    }
    graph.value = { ...graph.value, nodes, edges }
    return
  }

  if (currentStep.value >= 0) {
    const stage = stageIds[currentStep.value]
    const active = edges.filter(edge => {
      if (stage === 'sign-in') return edge.id === 'sign-prepare'
      if (stage === 'prepare') return edge.id === 'prepare-talk'
      if (stage === 'talk') return ['reply-sign', 'talk-save'].includes(edge.id)
      return false
    })
    if (!reduceMotion.value) active.forEach(edge => { edge.animated = true; edge.class = 'active-flow-edge' })
    graph.value = { ...graph.value, nodes, edges }
  } else {
    graph.value = { ...graph.value, nodes, edges }
  }
}

function clearTimer() {
  if (timer) window.clearInterval(timer)
  timer = undefined
  playing.value = false
}

function setStep(index) {
  const bounded = (index + stageIds.length) % stageIds.length
  currentStep.value = bounded
  selectedId.value = stageIds[bounded]
  syncActiveEdge()
}

function advance() {
  if (currentStep.value >= stageIds.length - 1) {
    clearTimer()
    return
  }
  setStep(currentStep.value + 1)
}

function playFlow() {
  if (playing.value) {
    clearTimer()
    return
  }
  if (currentStep.value < 0 || currentStep.value >= stageIds.length - 1) setStep(0)
  playing.value = true
  timer = window.setInterval(advance, speed.value === 'slow' ? 3000 : speed.value === 'fast' ? 1400 : 2200)
}

function openDetails(id = selectedId.value) {
  if (!makeDetailGraph(id)) return
  clearTimer()
  detailId.value = id
  graph.value = makeDetailGraph(id)
  selectedId.value = graph.value.nodes[0]?.id || id
  nextTick(() => fitView({ padding: 0.22, duration: reduceMotion.value ? 0 : 450 }))
}

function backToMap() {
  clearTimer()
  const parentId = detailId.value
  detailId.value = null
  selectedId.value = parentId || 'talk'
  currentStep.value = stageIds.indexOf(selectedId.value)
  graph.value = { ...overviewGraph, nodes: [...overviewGraph.nodes], edges: [...overviewGraph.edges] }
  nextTick(() => fitView({ padding: 0.08, duration: reduceMotion.value ? 0 : 400 }))
}

function resetMap() {
  if (detailId.value) backToMap()
  else fitView({ padding: 0.08, duration: reduceMotion.value ? 0 : 300 })
}

function handleKeydown(event) {
  if (event.key === 'Escape' && detailId.value) backToMap()
  if (event.key === ' ' && event.target?.tagName !== 'BUTTON' && event.target?.tagName !== 'SELECT') {
    event.preventDefault()
    playFlow()
  }
  if (event.key === 'ArrowRight' && event.altKey) advance()
}

watch([currentStep, reduceMotion, detailId], syncActiveEdge)
watch(speed, () => { if (playing.value) { clearTimer(); playFlow() } })
window.addEventListener('keydown', handleKeydown)
onBeforeUnmount(() => {
  clearTimer()
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <main class="explorer-shell">
    <header class="topbar">
      <a class="brand" href="#top" aria-label="GPTMD System Explorer home">
        <span class="brand-mark" aria-hidden="true">G</span>
        <span>GPTMD <strong>System Explorer</strong></span>
      </a>
      <div class="top-actions">
        <span class="view-path"><button class="text-button" :disabled="!detailId" @click="backToMap">Whole system</button><span v-if="detailId" class="path-divider">/</span><span v-if="detailId">{{ stageTitle[detailId] }}</span></span>
        <button v-if="detailId" class="button button-light" @click="backToMap">← Back to whole system</button>
        <button class="button button-primary" :aria-pressed="playing" @click="playFlow">
          <span aria-hidden="true">{{ playing ? 'Ⅱ' : '▶' }}</span>
          {{ playing ? 'Pause flow' : 'Play the visit' }}
        </button>
      </div>
    </header>

    <section id="top" class="page-heading">
      <div>
        <h1>How GPTMD works</h1>
        <p>Four steps from sign in to a saved visit. Select a step to see who does what.</p>
      </div>
      <div class="view-tools" aria-label="Map controls">
        <button class="tool-button" @click="resetMap">Fit map</button>
        <span class="zoom-hint">Drag to move · scroll to zoom</span>
      </div>
    </section>

    <section class="workspace" :class="{ 'detail-view': detailId }">
      <div class="map-shell">
        <div class="map-caption">
          <span class="map-caption-title">{{ detailId ? detail.title : 'The visit, from start to finish' }}</span>
          <span class="map-caption-note">{{ detailId ? 'A closer look at one part of the visit' : 'Read left to right · click a step to see what happens' }}</span>
        </div>
        <div class="map-stage" aria-label="Interactive map showing the GPTMD visit flow">
          <VueFlow
            id="system-map"
            :nodes="graph.nodes"
            :edges="graph.edges"
            :node-types="graphNodeTypes"
            :nodes-draggable="false"
            :nodes-connectable="false"
            :edges-updatable="false"
            :elements-selectable="false"
            :min-zoom="0.22"
            :max-zoom="1.65"
            :fit-view-on-init="true"
            :fit-view-options="{ padding: 0.08 }"
            :default-viewport="{ x: 0, y: 0, zoom: 0.64 }"
            :zoom-on-double-click="false"
            :pan-on-drag="true"
            :selection-on-drag="false"
            @node-click="selectNode"
            @node-double-click="({ node }) => openDetails(node.id)"
          >
            <Controls position="bottom-left" :show-interactive="false" />
            <MiniMap v-if="detailId" position="bottom-right" pannable zoomable aria-label="Map overview" />
          </VueFlow>
          <div class="mobile-flow" :class="{ 'mobile-detail-list': detailId }">
            <template v-for="(node, index) in mapNodes" :key="node.id">
              <button class="mobile-flow-node" :class="[`state-${node.data.status}`, { active: activeStage === node.id || (detailId && selectedId === node.id) }]" @click="selectNode({ node })">
                <span class="mobile-node-index">{{ index + 1 }}</span><span class="mobile-node-copy"><strong>{{ node.data.title }}</strong><small>{{ node.data.label }}</small></span><span class="state-dot" :class="`dot-${node.data.status}`"/>
              </button>
              <div v-if="!detailId && index < mapNodes.length - 1" class="mobile-arrow" aria-hidden="true">↓</div>
            </template>
          </div>
          <div v-if="!detailId" class="map-instruction">Select a step · double click or use the button to open its detail</div>
        </div>
        <div v-if="!detailId" class="service-strip" aria-label="Services behind the visit">
          <span class="service-intro">Services behind the visit</span>
          <span class="service-name"><i class="status-dot partial"/>Supabase</span>
          <span class="service-name"><i class="status-dot working"/>Express API</span>
          <span class="service-name"><i class="status-dot partial"/>OpenAI Responses</span>
          <span class="service-name"><i class="status-dot working"/>Redis</span>
          <span class="service-name"><i class="status-dot working"/>PostgreSQL</span>
        </div>
          <div class="flow-footer" :class="{ 'detail-footer': detailId }">
          <div class="flow-current" aria-live="polite">
            <span class="current-index">{{ currentStep >= 0 ? `STEP ${displayStep} OF ${stageIds.length}` : `SELECTED · STEP ${displayStep}` }}</span>
            <p>{{ currentFlowText }}</p>
          </div>
          <div v-if="!detailId" class="journey-track" aria-label="Visit stages">
            <button v-for="(stage, index) in stageIds" :key="stage" class="journey-stop" :class="{ current: activeStage === stage, complete: currentStep > index }" :aria-current="activeStage === stage ? 'step' : undefined" @click="setStep(index)">
              <span class="stop-dot">{{ index + 1 }}</span><span class="stop-name">{{ stageTitle[stage] }}</span>
            </button>
          </div>
          <div v-if="!detailId" class="flow-controls">
            <button class="button button-light" :disabled="currentStep <= 0" @click="setStep(currentStep - 1)">Previous</button>
            <button class="button button-primary" @click="currentStep < 0 ? setStep(Math.max(0, stageIds.indexOf(selectedId) + 1)) : advance()">{{ currentStep >= stageIds.length - 1 ? 'Done' : 'Next step →' }}</button>
          </div>
        </div>
      </div>

      <aside class="inspector" aria-label="Selected stage details">
        <div class="inspector-head">
          <div class="inspector-breadcrumb"><span>{{ detailId ? 'DETAIL VIEW' : 'SELECTED STEP' }}</span><span class="inspector-number">{{ detailId ? 'ZOOMED IN' : `STEP ${displayStep}` }}</span></div>
          <h2>{{ selectedTitle }}</h2>
          <div v-if="!detailId" class="status-line"><span class="status-pill" :class="`status-${selectedStatus}`"><i/>{{ statusName(selectedStatus) }}</span></div>
        </div>
        <p class="inspector-copy">{{ selectedCopy }}</p>

        <div v-if="!detailId && selectedParts.length" class="parts-list">
          <h3>Parts involved</h3>
          <ul><li v-for="part in selectedParts" :key="part">{{ part }}</li></ul>
        </div>
        <div v-if="detailId && detailNote.length" class="state-notes">
          <h3>What is still in progress</h3>
          <p v-for="note in detailNote" :key="note">{{ note }}</p>
        </div>

        <button v-if="!detailId && makeDetailGraph(selectedId)" class="button button-open" @click="openDetails()">Open this part in detail <span aria-hidden="true">↗</span></button>
        <div v-if="detailId" class="detail-navigation">
          <button class="button button-light" @click="backToMap">← Whole visit</button>
        </div>

        <div class="status-key">
          <h3>How to read the colors</h3>
          <div><span class="status-dot working"/><span><strong>Works today</strong><small>Implemented in the current app</small></span></div>
          <div><span class="status-dot partial"/><span><strong>Partly verified</strong><small>A live provider step still needs checking</small></span></div>
          <div><span class="status-dot planned"/><span><strong>Planned</strong><small>Shown for context; not implemented yet</small></span></div>
        </div>
      </aside>
    </section>

    <footer class="bottom-bar">
      <p><strong>Current system:</strong> The learner can sign in, prepare a patient, complete text conversation turns, save visit events, and submit an unscored assessment.</p>
      <label class="motion-setting"><input v-model="reduceMotion" type="checkbox"> Reduce animation</label>
      <label class="speed-setting">Tour speed <select v-model="speed"><option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fast</option></select></label>
    </footer>
  </main>
</template>
