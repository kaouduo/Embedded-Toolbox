<script setup lang="ts">
import { computed } from "vue";
import { darkTheme, NConfigProvider, NMessageProvider } from "naive-ui";
import type { GlobalThemeOverrides } from "naive-ui";

import AppLayout from "@/app/layout/AppLayout.vue";
import { useThemeStore } from "@/app/store/theme";

const themeStore = useThemeStore();

const theme = computed(() => (themeStore.isDark ? darkTheme : null));

// Naive UI calculates derived colors at runtime and therefore needs concrete
// color values. Keep these values aligned with the CSS tokens in main.css.
const themeOverrides = computed<GlobalThemeOverrides>(() => {
  const palette = themeStore.isDark
    ? {
        primary: "#4da3e5",
        primaryHover: "#72b8eb",
        primaryPressed: "#3589c8",
        text1: "#e6e8eb",
        text2: "#b9bec7",
        text3: "#929aa6",
        textDisabled: "#69717d",
        border: "#454950",
        base: "#1e1f22",
        surface: "#25262a",
        elevated: "#2b2d31",
        hover: "#34373c",
        code: "#18191c",
        danger: "#ff6b7a",
      }
    : {
        primary: "#1261a0",
        primaryHover: "#0b73c9",
        primaryPressed: "#0b4f82",
        text1: "#20242a",
        text2: "#535b66",
        text3: "#737d89",
        textDisabled: "#9aa1aa",
        border: "#cbd0d6",
        base: "#f1f3f5",
        surface: "#ffffff",
        elevated: "#f7f8fa",
        hover: "#e7ebef",
        code: "#e9edf1",
        danger: "#c6283d",
      };

  return {
    common: {
      borderRadius: "3px",
      borderRadiusSmall: "2px",
      fontSize: "13px",
      primaryColor: palette.primary,
      primaryColorHover: palette.primaryHover,
      primaryColorPressed: palette.primaryPressed,
      primaryColorSuppl: palette.primaryHover,
      textColorBase: palette.text1,
      textColor1: palette.text1,
      textColor2: palette.text2,
      textColor3: palette.text3,
      textColorDisabled: palette.textDisabled,
      placeholderColor: palette.text3,
      iconColor: palette.text2,
      iconColorHover: palette.text1,
      dividerColor: palette.border,
      borderColor: palette.border,
      bodyColor: palette.base,
      cardColor: palette.surface,
      modalColor: palette.surface,
      popoverColor: palette.elevated,
      inputColor: palette.elevated,
      tableColor: palette.surface,
      tableHeaderColor: palette.elevated,
      hoverColor: palette.hover,
      codeColor: palette.code,
      errorColor: palette.danger,
    },
  };
});
</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <AppLayout />
    </n-message-provider>
  </n-config-provider>
</template>
