<script setup lang="ts">
import { computed } from "vue";
import { darkTheme, NConfigProvider, NMessageProvider } from "naive-ui";
import type { GlobalThemeOverrides } from "naive-ui";

import AppLayout from "@/app/layout/AppLayout.vue";
import { useThemeStore } from "@/app/store/theme";

const themeStore = useThemeStore();

const theme = computed(() => (themeStore.isDark ? darkTheme : null));

// Keep the engineering-tool look: compact, sharp corners, denser text.
const themeOverrides: GlobalThemeOverrides = {
  common: {
    borderRadius: "3px",
    borderRadiusSmall: "2px",
    fontSize: "13px",
    primaryColor: "#18a058",
    primaryColorHover: "#36ad6a",
    primaryColorPressed: "#0c7a43",
    primaryColorSuppl: "#36ad6a",
  },
};
</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <AppLayout />
    </n-message-provider>
  </n-config-provider>
</template>
