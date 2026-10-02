<script setup>
import { computed, ref, watch } from 'vue';
import StandardManualNodeEditModal from './StandardManualNodeEditModal.vue';
import EasyProxySourceEditModal from './EasyProxySourceEditModal.vue';
const props = defineProps({ show: Boolean, isNew: Boolean, editingNode: Object, groups: { type: Array, default: () => [] } });
const emit = defineEmits(['update:show', 'confirm', 'input-url']);
const advanced = ref(false);
watch(() => props.show, () => { advanced.value = false; });
const sourceEditor = computed(() => advanced.value || props.editingNode?.kind === 'connector');
</script>

<template>
    <EasyProxySourceEditModal v-if="sourceEditor" v-bind="props"
        @update:show="emit('update:show', $event)" @confirm="emit('confirm', $event)" @input-url="emit('input-url', $event)" />
    <StandardManualNodeEditModal v-else v-bind="props" @advanced="advanced = true"
        @update:show="emit('update:show', $event)" @confirm="emit('confirm', $event)" @input-url="emit('input-url', $event)" />
</template>
