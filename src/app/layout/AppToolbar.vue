<script setup lang="ts">
import { computed, watchEffect } from "vue";
import { useRoute } from "vue-router";
import { NButton, NIcon, NSpace, NTooltip } from "naive-ui";
import { MoonOutline, SunnyOutline } from "@vicons/ionicons5";
import { useI18n } from "vue-i18n";

import { useLocaleStore } from "@/app/store/locale";
import { useThemeStore } from "@/app/store/theme";

const route = useRoute();
const { t } = useI18n();
const localeStore = useLocaleStore();
const themeStore = useThemeStore();

const pageTitle = computed(() => {
  const key = route.meta.titleKey;
  return typeof key === "string" ? t(key) : "";
});

watchEffect(() => {
  document.title = pageTitle.value ? `${pageTitle.value} — Embedded Toolbox` : "Embedded Toolbox";
});
</script>

<template>
  <header class="app-toolbar">
    <span class="page-title">{{ pageTitle }}</span>
    <div class="toolbar-actions">
      <n-tooltip placement="bottom">
        <template #trigger>
          <n-button quaternary size="small" @click="localeStore.toggle()">
            <n-space :size="4" align="center">
              <span class="language-code">{{ localeStore.locale === "en" ? "EN" : "中" }}</span>
              <span>{{
                localeStore.locale === "en" ? t("toolbar.chinese") : t("toolbar.english")
              }}</span>
            </n-space>
          </n-button>
        </template>
        {{ t("toolbar.language") }}
      </n-tooltip>
      <n-tooltip placement="bottom">
        <template #trigger>
          <n-button quaternary circle size="small" @click="themeStore.toggle()">
            <template #icon>
              <n-icon :size="18">
                <MoonOutline v-if="themeStore.isDark" />
                <SunnyOutline v-else />
              </n-icon>
            </template>
          </n-button>
        </template>
        {{ themeStore.isDark ? t("toolbar.switchToLight") : t("toolbar.switchToDark") }}
      </n-tooltip>
    </div>
  </header>
</template>

<style scoped>
.app-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--et-toolbar-height);
  padding: 0 12px;
  background-color: var(--et-bg-surface);
  border-bottom: 1px solid var(--et-border-color);
  flex-shrink: 0;
}

.page-title {
  font-size: 13px;
  font-weight: 600;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.language-code {
  min-width: 18px;
  font-weight: 600;
  text-align: center;
}
</style>
