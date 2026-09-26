<script setup lang="ts">
import { NButton, NInput, NRadioButton, NRadioGroup } from "naive-ui";
import { useI18n } from "vue-i18n";

import type { InputFormat } from "@/modules/converter/core/data-converter";

const format = defineModel<InputFormat>("format", { required: true });
const value = defineModel<string>({ required: true });

const { t } = useI18n();
</script>

<template>
  <section class="converter-input" :aria-label="t('converter.inputSection')">
    <div class="field-row">
      <span class="field-label">{{ t("converter.inputFormat") }}</span>
      <n-radio-group v-model:value="format" size="small">
        <n-radio-button value="decimal">{{ t("converter.decimal") }}</n-radio-button>
        <n-radio-button value="hex">{{ t("converter.hexadecimal") }}</n-radio-button>
      </n-radio-group>
    </div>

    <div class="field-row field-row--input">
      <label class="field-label" for="converter-value">{{ t("converter.inputValue") }}</label>
      <n-input
        id="converter-value"
        v-model:value="value"
        :placeholder="
          format === 'decimal' ? t('converter.decimalPlaceholder') : t('converter.hexPlaceholder')
        "
        clearable
        size="small"
        spellcheck="false"
        class="value-input"
      />
      <n-button size="small" @click="value = ''">{{ t("converter.clear") }}</n-button>
    </div>
  </section>
</template>

<style scoped>
.converter-input {
  padding: 12px;
  background: var(--et-bg-surface);
  border: 1px solid var(--et-border-color);
}

.field-row {
  display: flex;
  align-items: center;
  min-height: 32px;
  gap: 12px;
}

.field-row + .field-row {
  margin-top: 10px;
}

.field-label {
  width: 76px;
  flex: 0 0 76px;
  font-size: 12px;
  font-weight: 600;
}

.value-input {
  max-width: 680px;
  font-family: Consolas, "Cascadia Mono", monospace;
}

@media (max-width: 720px) {
  .field-row--input {
    flex-wrap: wrap;
  }

  .field-row--input .value-input {
    width: calc(100% - 88px);
  }
}
</style>
