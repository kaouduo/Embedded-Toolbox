<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import ConversionTable from "@/modules/converter/components/ConversionTable.vue";
import ConverterInput from "@/modules/converter/components/ConverterInput.vue";
import { DATA_LAYOUTS } from "@/modules/converter/core/byte-order";
import { convertAll, normalizeHex } from "@/modules/converter/core/data-converter";
import type { InputFormat } from "@/modules/converter/core/data-converter";

const { t } = useI18n();

const inputFormat = ref<InputFormat>("decimal");
const inputValue = ref("123");

const rows = computed(() => convertAll(inputValue.value, inputFormat.value, DATA_LAYOUTS));
const normalizedHex = computed(() => {
  if (inputFormat.value !== "hex") return null;
  const result = normalizeHex(inputValue.value);
  return "bytes" in result ? result.formatted : null;
});
</script>

<template>
  <div class="data-converter-view">
    <header class="page-header">
      <h1>{{ t("tools.dataConverter") }}</h1>
      <p>{{ t("converter.description") }}</p>
    </header>

    <ConverterInput v-model="inputValue" v-model:format="inputFormat" />

    <p v-if="normalizedHex" class="normalized-value">
      {{ t("converter.normalizedHex") }}：<code>{{ normalizedHex }}</code>
    </p>

    <section class="results-section">
      <h2>{{ t("converter.results") }}</h2>
      <ConversionTable :rows="rows" :input-format="inputFormat" />
    </section>

    <aside class="order-note">
      <strong>{{ t("converter.orderNoteTitle") }}</strong>
      <span>{{ t("converter.orderNote") }}</span>
    </aside>
  </div>
</template>

<style scoped>
.data-converter-view {
  width: 100%;
  max-width: 1280px;
}

.page-header {
  margin-bottom: 16px;
}

.page-header h1 {
  margin: 0 0 5px;
  font-size: 19px;
  font-weight: 600;
}

.page-header p {
  max-width: 900px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  opacity: 0.68;
}

.normalized-value {
  min-height: 18px;
  margin: 8px 0 0;
  font-size: 11px;
  opacity: 0.7;
}

.normalized-value code {
  font-family: Consolas, "Cascadia Mono", monospace;
}

.results-section {
  margin-top: 18px;
}

.results-section h2 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
}

.order-note {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-left: 9px;
  border-left: 2px solid var(--et-border-color);
  font-size: 11px;
  line-height: 1.6;
  opacity: 0.65;
}

@media (max-width: 720px) {
  .order-note {
    display: block;
  }

  .order-note strong {
    display: block;
  }
}
</style>
