<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({ id: { type: String, required: true }, data: { type: Object, required: true } })
const statusLabel = computed(() => ({ working: 'Works today', partial: 'Partly verified', planned: 'Planned' })[props.data.status] || 'System part')
</script>

<template>
  <article class="map-node" :class="[`state-${data.status}`, { 'is-actor': id === 'learner' }]">
    <Handle type="target" :position="Position.Left" />
    <div class="node-topline">
      <span class="node-system">{{ data.system }}</span>
      <span class="state-dot" :aria-label="statusLabel" :title="statusLabel"/>
    </div>
    <h2>{{ data.title }}</h2>
    <p>{{ data.label }}</p>
    <span class="node-state">{{ statusLabel }}</span>
    <Handle v-if="data.returnSource" id="return-source" type="source" :position="Position.Bottom" />
    <Handle v-if="data.returnTarget" id="return-target" type="target" :position="Position.Bottom" />
    <Handle type="source" :position="Position.Right" />
  </article>
</template>
