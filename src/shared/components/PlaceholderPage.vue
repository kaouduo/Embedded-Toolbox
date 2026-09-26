<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  titleKey: string;
  descriptionKey: string;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="placeholder-page">
    <h2 class="placeholder-title">{{ t(titleKey) }}</h2>
    <p class="placeholder-description">{{ t(descriptionKey) }}</p>
    <span class="placeholder-badge">{{ t("app.comingSoon") }}</span>
  </div>
</template>

<style scoped>
.placeholder-page {
  max-width: 720px;
}

.placeholder-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
}

.placeholder-description {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--et-text-secondary);
}

.placeholder-badge {
  display: inline-block;
  padding: 2px 10px;
  font-size: 12px;
  border: 1px solid var(--et-border-color);
  border-radius: 3px;
  color: var(--et-text-muted);
  background: var(--et-bg-elevated);
}
</style>
