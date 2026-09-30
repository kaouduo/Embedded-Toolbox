<script setup lang="ts">
import { NTabPane, NTabs } from "naive-ui";
import { ref } from "vue";
import { useI18n } from "vue-i18n";

import FrameToolPanel from "@/modules/protocol/components/FrameToolPanel.vue";
import { PROTOCOLS, PROTOCOL_IDS } from "@/modules/protocol/core/protocols";
import type { ProtocolId } from "@/modules/protocol/core/protocols";

const { t } = useI18n();

const activeTab = ref<ProtocolId>("rtu");
</script>

<template>
  <div class="modbus-view">
    <header class="page-header">
      <h1>{{ t("tools.modbus") }}</h1>
      <p>{{ t("modbus.introduction") }}</p>
    </header>

    <n-tabs v-model:value="activeTab" type="line" animated display-directive="show">
      <n-tab-pane v-for="id in PROTOCOL_IDS" :key="id" :name="id" :tab="t(`modbus.tabs.${id}`)">
        <FrameToolPanel :protocol="PROTOCOLS[id]" />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<style scoped>
.modbus-view {
  width: 100%;
  max-width: 1280px;
}

.page-header {
  margin-bottom: 12px;
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
  color: var(--et-text-secondary);
}
</style>
